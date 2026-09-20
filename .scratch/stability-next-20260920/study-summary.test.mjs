import assert from 'node:assert/strict';
import { summarize, assessQuality } from './study-summary.mjs';
const usage = { input: 2, output: 3, cacheRead: 4, cacheWrite: 0 };
const id = { requestId:'r', ownerRunId:'o', nodeId:'n' };
const rows = [
 {kind:'launcher',event:'request',...id},
 {kind:'launcher',event:'update',...id,usage},
 {kind:'launcher',event:'cancel',...id},
 {kind:'host',hook:'before_provider_request',requests:[{}]},
 {kind:'launcher',event:'response',...id,status:'cancelled',usage},
 {kind:'launcher',event:'response',...id,status:'cancelled',usage},
 {kind:'host',hook:'message_end',usage,provider:'p',model:'m',answer:'ok'}
];
const natural = summarize(rows);
assert.equal(natural.closureObserved,false,'child CANCEL alone is not Root closure');
assert.equal(natural.child.input,2,'deduplicate terminal, exclude UPDATE');
assert.equal(natural.failedAttempts,1,'cancelled attempt remains in totals');
assert.equal(natural.childUsageIncomplete,false);
assert.equal(natural.monetaryCost,null);
const closed = summarize([...rows,{kind:'host',hook:'before_provider_request',requests:[{closedReason:'deadline'}]}]);
assert.equal(closed.afterClosure.modelHooks,1);
assert.equal(summarize([{kind:'launcher',event:'request',...id}]).childUsageIncomplete,true);
console.log('study-summary: PASS');

assert.equal(assessQuality({name:'count',expected:'ANSWER=10',answer:'ANSWER=100',changed:''}),false);
assert.equal(assessQuality({name:'count',expected:'ANSWER=10',answer:'ANSWER=10\n',changed:''}),true);
assert.equal(assessQuality({name:'edit',expected:'ANSWER=enabled',answer:'ANSWER=enabled',changed:'M value.json',fileText:'invalid JSON'}),false);
assert.equal(assessQuality({name:'edit',expected:'ANSWER=enabled',answer:'ANSWER=enabled',changed:'M value.json',fileText:'{ "enabled": true }'}),true);

assert.equal(summarize([{kind:'host',hook:'before_provider_request'}]).rootUsageIncomplete,true);
assert.equal(assessQuality({name:'edit',expected:'ANSWER=enabled',answer:'ANSWER=enabled',changed:'D value.json'}),false);
