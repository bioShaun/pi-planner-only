// Can an EXHAUSTED cumulative budget be reset by addressing the Task with its own
// id on a later day? shouldReplaceTaskId() replaces any id not stamped today.
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
const agentDir = mkdtempSync(join(process.cwd(), ".p17-probe-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
delete process.env.PI_SUBAGENT_CHILD;

function makeHost() {
	const handlers = new Map(), commands = new Map(), tools = new Map(), notices = [];
	let activeTools = ["read", "bash", "write", "subagent"];
	const pi = { on(n,h){handlers.set(n,h);}, registerCommand(n,d){commands.set(n,d);}, registerTool(d){tools.set(d.name,d);},
		getActiveTools(){return [...activeTools];}, getAllTools(){return [{name:"read"},{name:"bash"},{name:"write"},{name:"subagent"}];},
		setActiveTools(n){activeTools=[...n];}, appendEntry(){}, async exec(){return {stdout:"",stderr:"",code:1};} };
	const ctx = { hasUI:true, ui:{notify(m){notices.push(m);},setStatus(){},theme:{fg(_c,t){return t;}}},
		cwd: process.cwd(), sessionManager:{getEntries(){return [];},getSessionFile(){return join(agentDir,"s.jsonl");}} };
	return { pi, ctx, handlers, commands, tools, notices };
}
const pad=(n)=>String(n).padStart(2,"0");
const now=new Date(), y=new Date(now.getTime()-86400000);
const today=`${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}`;
const yest=`${y.getFullYear()}${pad(y.getMonth()+1)}${pad(y.getDate())}`;
const spec=(taskId)=>({ taskId, objective:"bypass probe", cwd:"/fixture/bypass", role:"worker",
	scope:{allowedPaths:["src/a.ts"]}, constraints:[], acceptanceCriteria:["tests pass"],
	validation:{required:true,commands:["npm test"]}, expectedEvidence:{changedFiles:true,tests:true},
	stopConditions:[], cumulativeBudget:{tokens:200000, costUsd:0.05} });
const showBlock=(r)=>r?.block ? "BLOCKED: "+String(r.reason??r.block?.reason??"").split("\n")[0] : "ALLOWED";
const ledgerDir=join(agentDir,"planner-only","ledger");

// ---- session A: create a Task today and drive its cost past the limit.
let H=makeHost();
const { default: plannerOnly } = await import("../../../index.ts");
plannerOnly(H.pi);
await H.handlers.get("session_start")({}, H.ctx);
const c1={toolCallId:"a-1",toolName:"subagent",input:{agent:"worker",task:JSON.stringify(spec(`T-${today}-501`))}};
console.log("A) first delegation:", showBlock(await H.handlers.get("tool_call")(c1,H.ctx)));
const created=readdirSync(ledgerDir).filter((f)=>f.endsWith(".json"));
const liveId=created[0].replace(/\.json$/,"");
await H.handlers.get("tool_result")({ toolCallId:"a-1", toolName:"subagent",
	result:{ details:{ results:[{usage:{input:1000,output:10,cacheRead:0,cacheWrite:0,cost:0.06,turns:1},model:"test/model"}] } } }, H.ctx);
const stA=async(a)=>{H.notices.length=0;await H.commands.get("planner-only").handler(a,H.ctx);return String(H.notices.at(-1));};
console.log("A) after a $0.06 child:", (await stA(`task ${liveId}`)).split("\n").filter((l)=>/费用:/.test(l))[0]?.trim());
const c2={toolCallId:"a-2",toolName:"subagent",input:{agent:"worker",task:JSON.stringify(spec(liveId))}};
console.log("A) next delegation:", showBlock(await H.handlers.get("tool_call")(c2,H.ctx)));

// ---- age the ledger record by one day, as if the Task had been opened yesterday.
const rec=JSON.parse(readFileSync(join(ledgerDir,`${liveId}.json`),"utf8"));
const agedId=liveId.replace(today,yest);
const aged=JSON.parse(JSON.stringify(rec).replaceAll(liveId,agedId));
writeFileSync(join(ledgerDir,`${agedId}.json`),JSON.stringify(aged));
renameSync(join(ledgerDir,`${liveId}.json`),join(ledgerDir,`${liveId}.json.bak`));
console.log(`\nB) ledger now holds ${agedId} (yesterday's stamp) with its spend intact`);

// ---- session B (next day): address that Task by its own id.
H=makeHost(); plannerOnly(H.pi);
await H.handlers.get("session_start")({}, H.ctx);
const stB=async(a)=>{H.notices.length=0;await H.commands.get("planner-only").handler(a,H.ctx);return String(H.notices.at(-1));};
console.log("B) restored:", (await stB(`task ${agedId}`)).split("\n").filter((l)=>/费用:|State:/.test(l)).map((l)=>l.trim()).join(" | "));
const c3={toolCallId:"b-1",toolName:"subagent",input:{agent:"worker",task:JSON.stringify(spec(agedId))}};
const r3=await H.handlers.get("tool_call")(c3,H.ctx);
console.log("B) delegation citing the exhausted Task:", showBlock(r3));
console.log("B) budget handed to the child:", JSON.stringify(c3.input.usageBudget));
const all=String(await stB("status"));
const fresh=[...all.matchAll(new RegExp(`T-${today}-\\d{3}`,"g"))].map((m)=>m[0]);
console.log("B) new Task minted today:", [...new Set(fresh)].join(", ")||"(none)");
if (fresh.length) console.log("B) its balance:", (await stB(`task ${fresh[0]}`)).split("\n").filter((l)=>/费用:/.test(l))[0]?.trim());
rmSync(agentDir,{recursive:true,force:true});
