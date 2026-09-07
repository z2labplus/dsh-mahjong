import test from 'node:test';
import assert from 'node:assert/strict';
import { TableCore, normalizeTable } from '../src/table-core';
import { GuobiaoEngine } from '../src/engine/guobiao-engine';
import { calculateGuobiaoFans } from '../src/engine/core/guobiao-fan';
import { guobiaoTileKeyFromCode } from '../src/engine/core/guobiao-tiles';
import { GUOBIAO_OFFICIAL_FAN_DEFINITIONS } from '../src/engine/core/guobiao-fan-definitions';
const now=1800000000000;
const owner={v:1 as const,kind:'owner' as const,tenant:'test',owner:'alice',exp:now+3600000};
function table(humans=0) {
 const core=new TableCore(normalizeTable({ruleset:'guobiao',seats:[0,1,2,3].map(seat=>seat<humans?{seat,kind:'human',owner:seat===0}:{seat,kind:'ai',modelId:'test'}).map(s=>({...s,...(humans===4?{initialPoints:[0,25000,50000,1000000][s.seat]}:{})}))},owner,crypto.randomUUID(),now));
 for(let seat=0;seat<4;seat++)core.join(seat,now);return core;
}
test('standard MCR uses 81 official patterns and excludes prototype supplemental scores',()=>{
 assert.equal(GUOBIAO_OFFICIAL_FAN_DEFINITIONS.length,81);
 const input={tiles:['W1','W2','W3','W4','W5','W6','B7','B8','B9','T7','T8','T9','W5','W5'].map(c=>guobiaoTileKeyFromCode(c)!),winContext:{isSelfDrawn:true}};
 const normal=calculateGuobiaoFans(input);const extra=calculateGuobiaoFans({...input,winContext:{...input.winContext,isHeavenlyHand:true,isHumanHandTwo:true}});
 assert.ok(normal.valid);assert.deepEqual(extra.fans,normal.fans);
 assert.ok(extra.fans.every(f=>GUOBIAO_OFFICIAL_FAN_DEFINITIONS.some(d=>d.id===f.id)));
});
test('guobiao private envelopes and reconnect views do not reveal opponents or wall',()=>{
 const core=table();const engine=core.engine as GuobiaoEngine;
 const before=core.checkpoint();
 for(const seat of [0,1,2,3]){
  const view=core.view(seat);assert.equal(view.entries.filter(([kind,,v])=>kind==='tileFaceSelf'&&v!==null).length,engine.listHandTilesForSeat(seat).length);
  assert.ok(view.entries.find(([kind])=>kind==='gb')![2].wallOrder.every((id:any)=>id===null));
  const decision=core.decision(seat);if(decision)assert.doesNotMatch(JSON.stringify(decision),/tileId|wallOrder|pendingResponsesById|tileKeyById/);
 }
 assert.deepEqual(core.checkpoint(),before);
 assert.deepEqual(new TableCore(before).checkpoint(),before);
 const seat=[0,1,2,3].find(s=>core.decision(s))!;
 assert.throws(()=>core.submit(seat,{actionId:crypto.randomUUID(),action:{kind:'aiDecision',decisionId:core.decision(seat)!.decisionId,legalActionId:'blood-action'}},now),{code:'AI_ACTION_NOT_LEGAL'});
 assert.deepEqual(core.checkpoint(),before);
});
for(let humans=0;humans<=4;humans++)test(`complete independent guobiao with ${humans} humans and restore after every move`,{timeout:60000},()=>{
 let core=table(humans),time=now,moves=0;
 while(core.state?.phase!=='done'&&moves<700){
  core=new TableCore(core.checkpoint());
  const seat=[0,1,2,3].find(s=>core.decision(s));
  if(seat===undefined){const alarm=core.nextAlarm();assert.notEqual(alarm,null);time=alarm!;core.alarm(time);continue;}
  const decision=core.decision(seat)!;const id=decision.legalActions[0]!.legalActionId;
  if(seat<humans)core.submitHuman(seat,{actionId:crypto.randomUUID(),decisionId:decision.decisionId,action:core.catalog(seat).rawByActionId.get(id)},++time);
  else core.submit(seat,{actionId:crypto.randomUUID(),action:{kind:'aiDecision',decisionId:decision.decisionId,legalActionId:id}},++time);
  moves++;
 }
 assert.equal(core.state.phase,'done');assert.ok(moves>10);
 const expected=core.metadata.seats.map(s=>s.initialPoints!);
 const initialTotal=expected.reduce((sum,points)=>sum+points,0);
 for(const entry of core.state.ledger)for(const transfer of entry.transfers){expected[transfer.fromSeat]-=transfer.points;expected[transfer.toSeat]+=transfer.points;}
 assert.deepEqual([0,1,2,3].map(s=>core.state.players[s].points),expected);
 assert.deepEqual(core.state.endSummary.pointsDeltaBySeat,Object.fromEntries(core.metadata.seats.map(s=>[s.seat,expected[s.seat]-s.initialPoints!])));
 assert.equal(Object.values(core.state.players as Record<number,{points:number}>).reduce((s,p)=>s+p.points,0),initialTotal);
});
