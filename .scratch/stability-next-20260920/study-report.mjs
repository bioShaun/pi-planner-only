import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function aggregateStudy(rows) {
 const groups=[];
 for(const arm of ["direct","baseline","optimized"]) {
  const trials=rows.filter(r=>r.arm===arm);
  if(!trials.length)continue;
  const components=["input","output","cacheRead","cacheWrite"];
  const usageComplete=trials.every(r=>!r.rootUsageIncomplete&&!r.childUsageIncomplete
   &&["root","child"].every(w=>components.every(k=>Number.isFinite(r[w]?.[k]))));
  const root=Object.fromEntries(components.map(k=>[k,trials.reduce((n,r)=>n+(r.root?.[k]??0),0)]));
  const child=Object.fromEntries(components.map(k=>[k,trials.reduce((n,r)=>n+(r.child?.[k]??0),0)]));
  const tokenLowerBound=components.reduce((n,k)=>n+root[k]+child[k],0);
  const durations=trials.map(r=>r.durationMs).sort((a,b)=>a-b);
  const completed=trials.filter(r=>r.status===0&&!r.error&&!r.signal&&r.quality===true).length;
  groups.push({arm,trials:trials.length,completed,completionRate:completed/trials.length,
   failedTrials:trials.length-completed,childFailedAttempts:trials.reduce((n,r)=>n+r.failedAttempts,0),
   childClaims:trials.reduce((n,r)=>n+r.childClaims,0),usageComplete,root,child,tokenLowerBound,
   totalTokens:usageComplete?tokenLowerBound:null,
   tokensPerCompleted:usageComplete&&completed?tokenLowerBound/completed:null,
   durationMs:durations.reduce((a,b)=>a+b,0),medianDurationMs:durations[Math.floor(durations.length/2)],
   maxDurationMs:durations.at(-1),monetaryCost:null});
 }
 return {trials:rows.length,groups,monetaryCost:null,
  interpretation:"Descriptive paired small-task measurements only. All trials and failed child attempts retained. Fresh local sessions; remote provider cache uncontrolled and reported separately. No monetary or broad policy conclusion."};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
 const dir=path.resolve(process.argv[2]);
 const rows=JSON.parse(fs.readFileSync(path.join(dir,"results.json")));
 const result=aggregateStudy(rows);
 fs.writeFileSync(path.join(dir,"study-summary.json"),JSON.stringify(result,null,2)+"\n");
 const lines=["# P3 token / completion / latency measurements","",
 "| Arm | Completed | Total tokens* | Tokens per completion* | Median seconds | Failed child attempts |",
 "|---|---:|---:|---:|---:|---:|",
 ...result.groups.map(g=>`| ${g.arm} | ${g.completed}/${g.trials} | ${g.totalTokens??"unknown"} | ${g.tokensPerCompleted===null?"unknown":Math.round(g.tokensPerCompleted)} | ${(g.medianDurationMs/1000).toFixed(2)} | ${g.childFailedAttempts} |`),
 "","*Total includes input, output, cache-read and cache-write tokens from both Root and children, including failures. It is not a price-weighted cost.",
 "",result.interpretation,""];
 fs.writeFileSync(path.join(dir,"study-summary.md"),lines.join("\n"));
 console.log(JSON.stringify(result,null,2));
}
