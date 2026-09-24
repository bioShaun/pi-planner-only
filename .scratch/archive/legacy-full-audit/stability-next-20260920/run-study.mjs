// Ordinary terminal ONLY. Never execute in a sandboxed agent executor.
// Required env: STUDY_ROOT_MODEL=provider/model, STUDY_CHILD_MODEL=provider/model.
// Optional: STUDY_THINKING=low, STUDY_MODELS_FILE, STUDY_AUTH_FILE, STUDY_ARM,
// STUDY_CASE=count|json|edit, STUDY_REPEATS=1..5. --tui --tui-scenario=queued|scheduled|combined uses the real PTY.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { summarize, assessQuality, verifyModelIdentity } from './study-summary.mjs';
import { assertClearSlotAudit } from './slot-audit-gate.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const launcher = path.join(os.homedir(), '.pi/agent/npm/node_modules/pi-subagents');
const baseline = '85bdd2a93b994d3e4894e7534ab91cf6b16c9043';
const tui = process.argv.includes('--tui');
const tuiScenario = process.argv.find(a=>a.startsWith('--tui-scenario='))?.split('=')[1] ?? 'plain';
if (!['plain','queued','scheduled','combined'].includes(tuiScenario)) throw new Error('invalid TUI scenario');
const repeats = tui ? 1 : Number(process.env.STUDY_REPEATS ?? 1);
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 5) throw new Error('STUDY_REPEATS must be 1..5');
function model(key) {
 const raw = process.env[key];
 if (!raw || !/^[^/\s]+\/\S+$/.test(raw)) throw new Error(`${key}=provider/model is required`);
 const i = raw.indexOf('/'); return { raw, provider: raw.slice(0,i), id: raw.slice(i+1) };
}
const rootModel = model('STUDY_ROOT_MODEL');
const childModel = model('STUDY_CHILD_MODEL');
const thinking = process.env.STUDY_THINKING ?? 'low';
if (!['off','minimal','low','medium','high','xhigh','max'].includes(thinking)) throw new Error('invalid thinking');
function run(command,args,options={}) {
 const result = spawnSync(command,args,{encoding:'utf8',maxBuffer:16*1024*1024,...options});
 if (result.error || result.signal || result.status !== 0) throw new Error(`${command} failed: ${result.error?.code ?? result.signal ?? result.status}`);
 return result.stdout;
}
if (!fs.statSync('/project/tmp').isDirectory()) throw new Error('/project/tmp must already exist');
const gitParent = spawnSync('git',['-C','/project/tmp','rev-parse','--git-dir'],{encoding:'utf8'});
if (gitParent.error || gitParent.signal || gitParent.status !== 128) throw new Error('/project/tmp must be outside a Git worktree');
const runtime = fs.mkdtempSync('/project/tmp/planner-study-');
fs.chmodSync(runtime,0o700);
const evidence = fs.mkdtempSync(path.join(here,'study-run-'));
const write = (name,value) => fs.writeFileSync(path.join(evidence,name),typeof value === 'string' ? value : JSON.stringify(value,null,2)+'\n');
const cleanEnv = {...process.env,TMPDIR:runtime,TMP:runtime,TEMP:runtime};
for (const k of Object.keys(cleanEnv)) if (k.startsWith('PI_PLANNER_ONLY') || k === 'PI_SUBAGENT_CHILD') delete cleanEnv[k];
const versions = { baseline, node:process.version, host:run('pi',['--version']).trim(),
 launcher:JSON.parse(fs.readFileSync(path.join(launcher,'package.json'))).version,
 rootModel:rootModel.raw, childModel:childModel.raw, thinking, runtime,
 source:Object.fromEntries(fs.readdirSync(repo).filter(f=>f.endsWith('.ts') || f==='package.json').map(f=>[f,createHash('sha256').update(fs.readFileSync(path.join(repo,f))).digest('hex')])) };
write('versions.json',versions);
if (versions.host !== '0.85.1' || versions.launcher !== '0.69.0') throw new Error('Version drift: require an explicit new study design for host/launcher');
const old = path.join(runtime,'baseline'); fs.mkdirSync(old);
for (const f of run('git',['ls-tree','--name-only',baseline],{cwd:repo}).trim().split('\n')) {
 if (!/\.(ts|json)$/.test(f)) continue;
 fs.writeFileSync(path.join(old,f),run('git',['show',`${baseline}:${f}`],{cwd:repo}));
}
fs.symlinkSync(path.join(repo,'node_modules'),path.join(old,'node_modules'),'dir');
const cases = {
 count: { files:{'fixture.txt':'The quick brown fox jumps over the lazy dog today.\n'}, prompt:'Read fixture.txt and return its word count. Make no changes. End your response with ANSWER=10.', expected:'ANSWER=10' },
 json: { files:{'fixture.json':'{"service":{"port":4317,"retries":2}}\n'}, prompt:'Read fixture.json and report service.port. Make no changes. End your response with ANSWER=4317.', expected:'ANSWER=4317' },
 edit: { files:{'value.json':'{"enabled":false}\n'}, prompt:'Change value.json enabled from false to true. Preserve valid JSON and change no other files. Verify the saved value. End your response with ANSWER=enabled.', expected:'ANSWER=enabled' },
 stop: { files:{'fixture.txt':'stop probe\n'}, prompt:'Delegate a worker to run sleep 90 and then write done.txt with done. Wait for the worker to finish. Do not perform that command yourself.', expected:null },
};
// Do not disclose the answer to measurement models.
cases.count.prompt = cases.count.prompt.replace('ANSWER=10','ANSWER=<word count>');
cases.json.prompt = cases.json.prompt.replace('ANSWER=4317','ANSWER=<port>');
const arms = tui ? ['optimized'] : process.env.STUDY_ARM ? [process.env.STUDY_ARM] : ['direct','baseline','optimized'];
const names = tui ? ['stop'] : process.env.STUDY_CASE ? [process.env.STUDY_CASE] : ['count','json','edit'];
if (arms.some(a=>!['direct','baseline','optimized'].includes(a)) || names.some(n=>!cases[n])) throw new Error('invalid arm/case');
const schedule=[];
for(let repeat=0;repeat<repeats;repeat++) for(const [caseIndex,name] of names.entries()) {
 const rotation=(repeat+caseIndex)%arms.length;
 const order=[...arms.slice(rotation),...arms.slice(0,rotation)];
 for(const arm of order) schedule.push({repeat:repeat+1,arm,name});
}
write('design.json',{repeats,tuiScenario,baseline,rootModel:rootModel.raw,childModel:childModel.raw,thinking,
 order:'Deterministic rotation by repetition and task; fixed before the first trial',
 localCache:'Fresh isolated workspace and agent session per trial',providerCache:'Uncontrolled; cache usage retained',
 prices:'User selected token/completion/latency only; monetaryCost=null',
 baselineModelControl:'Private agentOverrides for builtins; public runtime-agent-register:v1 model/thinking fields for planner-scout, applied before launcher. Baseline source and tools unchanged.',schedule});
const results=[];
for (const {arm,name,repeat} of schedule) {
 const label=`${repeats>1?'r'+repeat+'-':''}${arm}-${name}`, c=cases[name];
 const dir=path.join(runtime,label);fs.mkdirSync(dir);
 const work=path.join(dir,'workspace'), agent=path.join(dir,'agent');fs.mkdirSync(work);fs.mkdirSync(agent,{mode:0o700});
 for(const [file,body] of Object.entries(c.files)) fs.writeFileSync(path.join(work,file),body);
 run('git',['init','-q'],{cwd:work});run('git',['add','.'],{cwd:work});
 run('git',['-c','user.name=study','-c','user.email=study@invalid','commit','-qm','fixture'],{cwd:work});
 // Credentials stay ONLY in the private runtime directory, never evidence.
 for(const [file,source] of [['models.json',process.env.STUDY_MODELS_FILE??path.join(os.homedir(),'.pi/agent/models.json')],['auth.json',process.env.STUDY_AUTH_FILE??path.join(os.homedir(),'.pi/agent/auth.json')]]) {
  if(fs.existsSync(source)) {fs.copyFileSync(source,path.join(agent,file));fs.chmodSync(path.join(agent,file),0o600);}
 }
 const settings=arm==='baseline'?{subagents:{agentOverrides:Object.fromEntries(['worker','oracle','reviewer'].map(name=>[name,{model:childModel.raw,thinking}]))}}:{};
 fs.writeFileSync(path.join(agent,'settings.json'),JSON.stringify(settings)+'\n');
 write(`${label}-model-control.json`,{settings,runtimeScout:arm==='baseline'?{model:childModel.raw,thinking}:null});
 const eventFile=path.join(evidence,`${label}-events.jsonl`);
 const env={...cleanEnv,PI_CODING_AGENT_DIR:agent,PI_PLANNER_ONLY:arm==='direct'?'0':'1',PI_PLANNER_ONLY_SEED_PRICING:'0',STUDY_EVENTS:eventFile};
 if(arm==='optimized') {
  env.PI_PLANNER_ONLY_ROLE_MODELS='1';
  for(const role of ['WORKER','EXPLORER','VALIDATOR','REVIEWER']) {env[`PI_PLANNER_ONLY_MODEL_${role}`]=childModel.raw;env[`PI_PLANNER_ONLY_THINKING_${role}`]=thinking;}
 }
 if(tui) { env.PI_PLANNER_ONLY_REQUEST_ACTIVE_MS='45000'; env.STUDY_TUI_SCENARIO=tuiScenario; env.PYTHONDONTWRITEBYTECODE='1'; }
 const args=[...(tui?[]:['-p','--mode','json']),'--no-extensions','--no-skills','--no-prompt-templates',
  ...(arm==='baseline'?['-e',path.join(here,'baseline-model-pin.ts')]:[]),
  ...(arm==='direct'?[]:['-e',path.join(launcher,'index.ts'),'-e',path.join(arm==='baseline'?old:repo,'index.ts')]),
  '-e',path.join(here,'study-observer.ts'),'--provider',rootModel.provider,'--model',rootModel.id,'--thinking',thinking,c.prompt];
 // Capture both preflights before each paid/heavy run. Do not kill other jobs.
 for (const check of ['audit','status']) {
  const preflight=spawnSync('slot',[check],{env,encoding:'utf8'});
  write(`${label}-slot-${check}.json`,{status:preflight.status,signal:preflight.signal,error:preflight.error?.code,stdout:preflight.stdout,stderr:preflight.stderr});
  if(preflight.error || preflight.signal || preflight.status!==0) throw new Error(`slot ${check} failed; inspect recorded preflight`);
  if(check==='audit') assertClearSlotAudit(preflight.stdout ?? '',preflight.stderr ?? '');
 }
 const stdout=fs.openSync(path.join(evidence,`${label}-stdout.log`),'w');
 const stderr=fs.openSync(path.join(evidence,`${label}-stderr.log`),'w');
 let commandArgs=['cpu','--','timeout','300','pi',...args];
 if(tui) {
  const commandFile=path.join(dir,'command.json');fs.writeFileSync(commandFile,JSON.stringify(['pi',...args]));
  commandArgs=['cpu','--','python3',path.join(here,'tui-driver.py'),commandFile,eventFile,path.join(evidence,`${label}-pty.json`),tuiScenario];
 }
 const started=Date.now();
 const result=spawnSync('slot',commandArgs,{cwd:work,env,stdio:['ignore',stdout,stderr]});fs.closeSync(stdout);fs.closeSync(stderr);
 const events=fs.existsSync(eventFile)?fs.readFileSync(eventFile,'utf8').trim().split('\n').filter(Boolean).map(l=>JSON.parse(l)):[];
 const summary=summarize(events);
 const identity=verifyModelIdentity(events,{rootModel:rootModel.raw,childModel:childModel.raw,thinking});
 const changed=run('git',['status','--porcelain'],{cwd:work}).trim();
 const quality=tui?null:assessQuality({name, expected:c.expected, answer:summary.finalAnswer, changed,
  fileText:name==='edit' && fs.existsSync(path.join(work,'value.json')) ? fs.readFileSync(path.join(work,'value.json'),'utf8') : undefined});
 const row={arm,case:name,repeat,label,status:result.status,signal:result.signal,error:result.error?.code,durationMs:Date.now()-started,quality,identity,changed,sentinelExists:tui?fs.existsSync(path.join(work,'done.txt')):undefined,...summary};
 results.push(row);write(`${label}-summary.json`,row);write('results.json',results);
 console.log(JSON.stringify({label,status:row.status,quality,childClaims:row.childClaims,durationMs:row.durationMs,evidence}));
 if(!identity.verified) { console.error('Actual model identity is unproven; stopping the predefined schedule. Retain this incomplete run.'); break; }
}
write('results.json',results);
const sourceAfter=Object.fromEntries(Object.keys(versions.source).map(f=>[f,createHash('sha256').update(fs.readFileSync(path.join(repo,f))).digest('hex')]));
write('source-after.json',sourceAfter);
if(JSON.stringify(sourceAfter)!==JSON.stringify(versions.source)) throw new Error('Source drift during study');
console.log(`Evidence: ${evidence}\nPrivate runtime: ${runtime}\nNo price/savings conclusion; examine each quality, usage completeness, route identity and TUI trace.`);
if(results.length!==schedule.length || results.some(r=>r.status!==0 || r.signal || r.error || r.quality===false || !r.identity.verified || r.sentinelExists===true || (tui&&r.changed!==''))) process.exitCode=1;
