#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const ROOT = resolve(import.meta.dirname, "..");
const SCRATCH = "/project/tmp/ppo-bench";

export function approxTokens(text) {
  let cjk = 0, other = 0;
  for (const char of text) /[\u3000-\u9fff\uff00-\uffef]/u.test(char) ? cjk++ : other++;
  return Math.ceil(cjk + other / 4);
}
function fakePi() {
  const tools = new Map(), handlers = new Map();
  let active = ["read", "bash", "edit", "write", "subagents_enable", "subagent"];
  const pi = { registerTool: t => tools.set(t.name, t), registerCommand() {}, on: (n,h) => handlers.set(n,h), getActiveTools: () => active, setActiveTools: n => { active=n; }, exec: async () => ({stdout:"",stderr:"",code:0}), events: {on(){},emit(){}} };
  return { pi, tools, handlers };
}
function snapshotPath(ref) {
  if (!ref) return ROOT;
  const rev = spawnSync("git", ["rev-parse", "--verify", `${ref}^{commit}`], { cwd: ROOT, encoding: "utf8" });
  if (rev.status !== 0) throw new Error(`cannot resolve ref ${ref}: ${rev.stderr.trim()}`);
  const sha = rev.stdout.trim(), dest = join(SCRATCH, "plugins", sha);
  if (!existsSync(join(dest, "index.ts"))) {
    mkdirSync(dest, { recursive: true });
    const archive = spawnSync("git", ["archive", sha], { cwd: ROOT, encoding: "buffer", maxBuffer: 64 * 1024 * 1024 });
    if (archive.status !== 0) throw new Error(`git archive ${ref} failed`);
    const untar = spawnSync("tar", ["-x", "-C", dest], { input: archive.stdout, encoding: "utf8" });
    if (untar.status !== 0) throw new Error(`extracting ${ref} failed: ${untar.stderr}`);
  }
  if (!existsSync(join(dest,"node_modules"))) symlinkSync(join(ROOT,"node_modules"),join(dest,"node_modules"));
  return dest;
}
async function measure(ref) {
  const label = ref ?? "WORKTREE";
  const prior = Object.fromEntries(["PI_PLANNER_ONLY","PI_PLANNER_ONLY_STRICT","PI_SUBAGENT_CHILD"].map(k=>[k,process.env[k]]));
  try {
    const dir=snapshotPath(ref); process.env.PI_PLANNER_ONLY="1"; delete process.env.PI_SUBAGENT_CHILD;
    const {default: extension, HIDDEN_HOST_TOOLS=[]}=await import(pathToFileURL(join(dir,"index.ts")).href+`?bench=${encodeURIComponent(label)}-${Date.now()}`);
    const modes=[];
    for (const strict of [false,true]) {
      process.env.PI_PLANNER_ONLY_STRICT=strict?"1":"0";
      const host=fakePi(); extension(host.pi);
      const handler=host.handlers.get("before_agent_start");
      if (!handler) throw new Error("extension did not register before_agent_start");
      const event={systemPrompt:"BASE",systemPromptOptions:{selectedTools:["read","bash","edit","write","subagents_enable","subagent"]}};
      const response=await handler(event,{});
      if (!response?.systemPrompt?.startsWith("BASE")) throw new Error("before_agent_start did not append prompt");
      const appended=response.systemPrompt.slice(4);
      const tools=[...host.tools.values()].map(t=>{
        const desc=t.description??"", snippet=t.promptSnippet??"", guidelines=t.promptGuidelines??"", params=JSON.stringify(t.parameters??{});
        return {name:t.name,descriptionChars:desc.length,promptSnippetChars:snippet.length,promptGuidelinesChars:guidelines.length,parametersChars:params.length,totalChars:desc.length+snippet.length+guidelines.length+params.length};
      });
      modes.push({strict,prompt:{chars:appended.length,approxTokens:approxTokens(appended)},tools,toolTotalChars:tools.reduce((n,t)=>n+t.totalChars,0),hiddenHostTools:HIDDEN_HOST_TOOLS.length?[...HIDDEN_HOST_TOOLS]:["subagents_enable","subagent"]});
    }
    return {ref:label,modes};
  } catch(e) { return {ref:label,error:e instanceof Error?e.message:String(e)}; }
  finally { for(const [k,v] of Object.entries(prior)) v===undefined?delete process.env[k]:process.env[k]=v; }
}
function showStatic(results) {
  for(const r of results){ console.log(`\n${r.ref}${r.error?`: ERROR ${r.error}`:""}`); if(r.error) continue;
    for(const m of r.modes){ console.log(`${m.strict?"strict":"non-strict"}: appended prompt ${m.prompt.chars} chars (~${m.prompt.approxTokens} tokens); tool definitions ${m.toolTotalChars} chars; hidden host tools: ${m.hiddenHostTools.join(", ")}`);
      console.log("tool             description  snippet  guidelines  parameters  total");
      for(const t of m.tools) console.log(`${t.name.padEnd(16)} ${String(t.descriptionChars).padStart(11)} ${String(t.promptSnippetChars).padStart(7)} ${String(t.promptGuidelinesChars).padStart(11)} ${String(t.parametersChars).padStart(11)} ${String(t.totalChars).padStart(7)}`);
    }
  }
  if(results.length===2&&results.every(r=>!r.error)){ console.log("\nDelta (second - first):"); for(let i=0;i<2;i++){const a=results[0].modes[i],b=results[1].modes[i]; console.log(`${b.strict?"strict":"non-strict"}: prompt ${b.prompt.chars-a.prompt.chars}, tools ${b.toolTotalChars-a.toolTotalChars} chars`); for(const t of b.tools){const old=a.tools.find(x=>x.name===t.name);if(old)console.log(`  ${t.name}: description ${t.descriptionChars-old.descriptionChars}, snippet ${t.promptSnippetChars-old.promptSnippetChars}, guidelines ${t.promptGuidelinesChars-old.promptGuidelinesChars}, parameters ${t.parametersChars-old.parametersChars}, total ${t.totalChars-old.totalChars} chars`);}} }
}
function filesIn(inputs){const out=[]; function walk(p){try{const s=statSync(p);if(s.isDirectory()){for(const x of readdirSync(p))walk(join(p,x));}else if(p.endsWith(".jsonl"))out.push(p);}catch{}} for(const x of inputs)walk(resolve(x));return out;}
function corpus(inputs){
  const runs=[]; const totals=new Map(); let pluginChars=0, allChars=0;
  for(const file of filesIn(inputs)){let valid=false, turns=0;const results=[];
    for(const line of readFileSync(file,"utf8").split("\n")){if(!line)continue;let e;try{e=JSON.parse(line);}catch{continue;}if(!e||typeof e.type!=="string")continue;valid=true;
      if(e.type!=="message_end")continue;const m=e.message;if(m?.role==="assistant")turns++;
      if(m?.role!=="toolResult")continue;const name=m.toolName??m.name??"unknown";const text=Array.isArray(m.content)?m.content.filter(c=>c?.type==="text").map(c=>c.text??"").join(""):"";results.push({name,chars:text.length,turnAt:turns});
    }
    if(!valid||turns===0)continue;
    const carried=new Map();for(const r of results){const later=Math.max(0,turns-r.turnAt);r.carried=r.chars*later;const t=totals.get(r.name)??{count:0,chars:0,carried:0,sizes:[]};t.count++;t.chars+=r.chars;t.carried+=r.carried;t.sizes.push(r.chars);totals.set(r.name,t);allChars+=r.chars;if(["delegate","git_audit","git_commit","handoff"].includes(r.name))pluginChars+=r.chars;}
    runs.push({file,assistantTurns:turns,toolResults:results.length,tools:results});
  }
  const aggregate=[...totals].map(([name,t])=>{t.sizes.sort((a,b)=>a-b);const mid=Math.floor(t.sizes.length/2),median=t.sizes.length%2?t.sizes[mid]:(t.sizes[mid-1]+t.sizes[mid])/2;return{name,...t,median,max:Math.max(...t.sizes),approxTokens:Math.ceil((t.cjk??0)+Math.ceil((t.chars-(t.cjk??0))/4))};});
  return {runs,aggregate,pluginToolChars:pluginChars,allToolResultChars:allChars,pluginShare:allChars?pluginChars/allChars:0};
}
function showCorpus(data){for(const r of data.runs)console.log(`${r.file}: ${r.assistantTurns} assistant turns, ${r.toolResults} tool results`);console.log("\nTool             count  chars  median  max  approx tokens  carried chars");for(const t of data.aggregate)console.log(`${t.name.padEnd(16)} ${String(t.count).padStart(5)} ${String(t.chars).padStart(7)} ${String(t.median).padStart(7)} ${String(t.max).padStart(5)} ${String(t.approxTokens).padStart(14)} ${String(t.carried).padStart(14)}`);console.log(`Plugin tool-result share: ${(100*data.pluginShare).toFixed(1)}% (${data.pluginToolChars}/${data.allToolResultChars} chars)`);}
function jsonArg(args){const i=args.indexOf("--json");return i<0?undefined:args[i+1];}
const [command,...args]=process.argv.slice(2), out=jsonArg(args);
if(command==="static"){
  const refs=[];for(let i=0;i<args.length;i++)if(args[i]==="--ref"&&args[i+1])refs.push(args[++i]);
  if(refs.length>2){console.error("static accepts at most two --ref arguments");process.exitCode=2;}else{const results=await Promise.all((refs.length===2?refs:refs.length===1?[refs[0],null]:[null]).map(measure));showStatic(results);if(out)await import("node:fs/promises").then(fs=>fs.writeFile(out,JSON.stringify(results,null,2)+"\n"));}
}else if(command==="corpus"){
  const inputs=args.filter((x,i)=>x!=="--json"&&args[i-1]!=="--json");const data=corpus(inputs);showCorpus(data);if(out)await import("node:fs/promises").then(fs=>fs.writeFile(out,JSON.stringify(data,null,2)+"\n"));
}else{console.error("usage: overhead.mjs static [--ref REF] [--ref REF] [--json OUT] | corpus <file-or-dir...> [--json OUT]");process.exitCode=2;}
