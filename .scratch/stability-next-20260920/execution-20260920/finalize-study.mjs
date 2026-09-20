// Ordinary-terminal final evidence capture; never copies agent config/credentials.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {assessQuality, verifyModelIdentity} from "../study-summary.mjs";
import {aggregateStudy} from "../study-report.mjs";
const here=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const name=process.argv[2];
assert.match(name??"",/^study-run-[A-Za-z0-9]+$/);
const dir=path.join(here,name);
const read=f=>JSON.parse(fs.readFileSync(path.join(dir,f),"utf8"));
const versions=read("versions.json"), design=read("design.json"), rows=read("results.json");
assert.equal(design.repeats,3);assert.equal(design.schedule.length,27);assert.equal(rows.length,27);
assert.deepEqual(rows.map(r=>({repeat:r.repeat,arm:r.arm,name:r.case})),design.schedule);
assert.deepEqual(read("source-after.json"),versions.source);
const audit=[];
for(const row of rows){
 const workspace=path.join(versions.runtime,row.label,"workspace");
 assert.ok(workspace.startsWith("/project/tmp/planner-study-"));
 const git=spawnSync("git",["status","--porcelain"],{cwd:workspace,encoding:"utf8"});
 assert.equal(git.error,undefined);assert.equal(git.signal,null);assert.equal(git.status,0);
 const changed=git.stdout.trim();
 const filename={count:"fixture.txt",json:"fixture.json",edit:"value.json"}[row.case];
 const filePath=path.join(workspace,filename);
 const body=fs.existsSync(filePath)?fs.readFileSync(filePath,"utf8"):null;
 const expected={count:"ANSWER=10",json:"ANSWER=4317",edit:"ANSWER=enabled"}[row.case];
 const quality=assessQuality({name:row.case,expected,answer:row.finalAnswer,changed,fileText:body??undefined});
 const events=fs.readFileSync(path.join(dir,row.label+"-events.jsonl"),"utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
 const identity=verifyModelIdentity(events,{rootModel:versions.rootModel,childModel:versions.childModel,thinking:versions.thinking});
 assert.deepEqual(identity,row.identity);assert.equal(identity.verified,true);
 assert.equal(changed,row.changed);assert.equal(quality,row.quality);
 assert.equal(row.monetaryCost,null);
 audit.push({label:row.label,filename,body,sha256:body===null?null:createHash("sha256").update(body).digest("hex"),
  gitStatus:changed,quality,identity,observedAt:new Date().toISOString()});
}
fs.writeFileSync(path.join(dir,"quality-audit.json"),JSON.stringify(audit,null,2)+"\n");
const report=aggregateStudy(rows);
report.designComplete=true;report.identityVerified=true;
report.models={root:versions.rootModel,child:versions.childModel,thinking:versions.thinking};
report.latencyBasis="From slot submission through host process exit; includes any queue, startup, model/tool work and plugin quiescence/review. Not pure provider latency.";
report.cachePolicy=design.providerCache;
report.baselineModelControl=design.baselineModelControl;
report.byCase=Object.fromEntries(["count","json","edit"].map(c=>[c,aggregateStudy(rows.filter(r=>r.case===c)).groups]));
const terminals=rows.flatMap(r=>fs.readFileSync(path.join(dir,r.label+"-events.jsonl"),"utf8").trim().split("\n")
 .filter(Boolean).map(JSON.parse).filter(e=>e.kind==="launcher"&&e.event==="response"));
report.childDurationMs={basis:"Launcher terminal usage.durationMs, not TaskExecutionRecord launch timestamps",
 observations:terminals.length,max:Math.max(...terminals.map(t=>t.usage?.durationMs??0)),
 overFiveMinutes:terminals.filter(t=>(t.usage?.durationMs??0)>300000).length,
 overTenMinutes:terminals.filter(t=>(t.usage?.durationMs??0)>600000).length};
fs.writeFileSync(path.join(dir,"study-summary.json"),JSON.stringify(report,null,2)+"\n");
const lines=["# P3 token、完成率与延迟","",
 "Root: "+versions.rootModel+"; child: "+versions.childModel+"; thinking: "+versions.thinking+".",
 "","三组 × 词数、JSON、小修改 × 三次重复；预先固定交错顺序，27 次全部保留。","",
 "| 组 | 完成 | 总 token | 每次完成 token | 延迟中位数（秒） | 失败 child 尝试 |",
 "|---|---:|---:|---:|---:|---:|",
 ...report.groups.map(g=>`| ${g.arm} | ${g.completed}/${g.trials} | ${g.totalTokens??"unknown"} | ${g.tokensPerCompleted===null?"unknown":Math.round(g.tokensPerCompleted)} | ${(g.medianDurationMs/1000).toFixed(2)} | ${g.childFailedAttempts} |`),
 "","总 token 为 Root + child 的 input/output/cacheRead/cacheWrite 之和，包含失败尝试；缓存分量和逐尝试明细在 JSON 中。没有按价格加权，monetaryCost 全部为 null。",
 "",report.latencyBasis,"",report.baselineModelControl,
 "","每次创建独立本地 session 和工作区；远端缓存不可控，按返回 usage 如实记录。最终文件快照及重新计算的质量结果在 quality-audit.json。这里的完成率验证答案、JSON 内容和文件范围，不等同真实项目交付质量。",
 "","这组小任务只能描述当前配置。它不证明十分钟优于五分钟，也不支持直接扩展 Root 的读取或写入政策。",
 "","| 任务 | 组 | 完成 | 总 token | 延迟中位数（秒） |",
 "|---|---|---:|---:|---:|",
 ...Object.entries(report.byCase).flatMap(([c,groups])=>groups.map(g=>`| ${c} | ${g.arm} | ${g.completed}/${g.trials} | ${g.totalTokens??"unknown"} | ${(g.medianDurationMs/1000).toFixed(2)} |`)),""];
fs.writeFileSync(path.join(dir,"study-summary.md"),lines.join("\n"));
console.log(JSON.stringify({directory:dir,designComplete:report.designComplete,identityVerified:report.identityVerified,
 groups:report.groups,childDurationMs:report.childDurationMs},null,2));
