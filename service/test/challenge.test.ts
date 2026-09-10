import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {URL} from 'node:url';
import {createChallengeCheckpoint} from '../src/challenge';
import {challengeAction,challengeSummary,discardEfficiency,prepareChallengeDraw} from '../src/challenge-policy';
import {TableCore} from '../src/table-core';
import type {Access} from '../src/auth';
const record=JSON.parse(readFileSync(new URL('../../test/fixtures/s6-challenge-v6.json',import.meta.url),'utf8'));
const now=1800000000000,gameId='11111111-1111-4111-8111-111111111111';
const owner:Access={v:1,kind:'owner',tenant:'test',owner:'test',exp:now+1000000};
const start=()=>createChallengeCheckpoint({record,keySeq:75,seat:2,seed:20260910},owner,gameId,now);
function action(core:TableCore,seat:number,id:string,n=0){return core.submit(seat,{actionId:`test-${n}`,action:{kind:'aiDecision',decisionId:core.decision(seat)!.decisionId,legalActionId:id}},now+n);}
function assertTiles(core:TableCore){const ids=core.game.entries('things').map(([id])=>id);assert.equal(ids.length,108);assert.equal(new Set(ids).size,108);const s=core.state;const wall=core.game.entries('things').filter(([,t])=>t.slotName.startsWith('wall.')).map(([id])=>id);assert.equal(wall.length,s.wallOrder.length-s.wallIndex);assert.deepEqual(wall.sort(),s.wallOrder.slice(s.wallIndex).sort());assert.equal(Object.values(s.players).reduce((n:number,p:any)=>n+p.beans,0),0);}
test('preparation, joining, alarms and recovery never play a move before explicit begin',()=>{
 let core=new TableCore(start());core.join(2,now);
 const untouched=core.checkpoint();assert.equal(challengeSummary(core).status,'ready');
 assert.equal(core.decision(2),null);assert.equal(core.nextAlarm(),null);
 for(const delay of [120000,86400000,7*86400000]){
  core.alarm(now+delay);core=new TableCore(core.checkpoint());core.join(2,now+delay);
  assert.deepEqual(core.checkpoint(),untouched);
 }
 assert.deepEqual(challengeSummary(core).wonNames,['龙公子','春光']);assert.equal(challengeSummary(core).net,0);
 assert.throws(()=>core.submitHuman(2,{actionId:'before-start',decisionId:null,action:{kind:'discard'}},now),{code:'AI_DECISION_STALE'});
 core.beginChallenge(now);const active=core.checkpoint();
 core.beginChallenge(now+10000);assert.deepEqual(core.checkpoint(),active,'duplicate begin must not reset a decision or hand');
 assert.equal(challengeSummary(core).status,'active');assert.ok(core.decision(2));assert.equal(core.nextAlarm(),null);
});
test('human training waits indefinitely, including a restored old timed window, while AI stays timed',()=>{
 let core=new TableCore(start());core.join(2,now);core.beginChallenge(now);
 const saved=core.checkpoint();delete saved.challenge!.status;saved.windows[2]!.deadlineAtMs=now+120000;
 core=new TableCore(saved);const before=core.checkpoint();
 core.alarm(now+7*86400000);assert.deepEqual(core.checkpoint(),before);
 assert.equal(core.decision(2)!.deadlineAtMs,null);
 assert.deepEqual(core.view(2).entries.find(([k])=>k==='match')![2].friendConfig,{waitMode:'noTimeout',timeoutMs:null});
 const catalog=core.catalog(2),chosen=catalog.publicActions.find((a:any)=>a.tile==='6m');
 core.submitHuman(2,{actionId:'after-week',decisionId:core.decision(2)!.decisionId,action:catalog.rawByActionId.get(chosen.legalActionId)},now+7*86400000);
 assert.equal(core.windows[1]!.deadlineAtMs,now+7*86400000+38000);assert.equal(core.challenge!.quality[0]!.timeout,false);assertTiles(core);
});
test('begin before browser join remains playable, and a finished challenge cannot restart in place',()=>{
 const core=new TableCore(start());core.beginChallenge(now);assert.equal(core.decision(2),null);
 core.join(2,now+50000);assert.ok(core.decision(2));
 core.game.systemUpdate([['blood',0,{...core.state,phase:'done'}]]);
 const before=core.checkpoint();assert.throws(()=>core.beginChallenge(now+60000),{code:'CHALLENGE_FINISHED'});assert.deepEqual(core.checkpoint(),before);
});
test('v6 checkpoint preserves all four hands, winners, score history, and training comparison',()=>{
 const before=JSON.stringify(record),saved=start(),core=new TableCore(saved);core.join(2,now);core.beginChallenge(now);
 assert.equal(saved.challenge!.referenceNet,2);assert.equal(saved.challenge!.historicalNet,2);

 assert.equal(core.state.ledger.length,4);assert.deepEqual(Object.values(core.state.players).map((p:any)=>p.beans),[4,-1,-2,-1]);
 assert.deepEqual(Object.values(core.state.players).filter((p:any)=>p.hu).map((p:any)=>p.seat),[0,3]);assert.equal(core.game.get('nicks','seat-2'),'周猩猩');
 assert.equal(core.windows[2]!.deadlineAtMs,null);assert.equal(core.state.wallOrder.length-core.state.wallIndex,23);
 const rank=discardEfficiency(core.catalog(2));assert.equal(rank[0]!.tile,'6m');assert.equal(rank[0]!.shanten,0);assert.equal(rank[0]!.effective,1);
 assert.equal(JSON.stringify(record),before);assert.ok(JSON.stringify(saved).length<128*1024);assertTiles(core);
});
test('all nine initial discards finish legally with identical results after checkpoint restore',()=>{
 for(const first of ['1m','2m','3m','4m','6m','7m','8m','3p','5p']){
  const play=(restore:boolean)=>{let core=new TableCore(start());core.join(2,now);core.beginChallenge(now);let n=0;
   while(!['settling','done'].includes(core.state.phase)&&n<500){const seat=Number(Object.keys(core.windows)[0]);const chosen=n===0?core.catalog(seat).publicActions.find((a:any)=>a.tile===first):challengeAction(core,seat).action;action(core,seat,chosen.legalActionId,n++);assertTiles(core);if(restore)core=new TableCore(core.checkpoint());}
   assert.ok(n<500);return challengeSummary(core);};
  const uninterrupted=play(false);assert.deepEqual(play(true),uninterrupted);assert.ok('referenceNet' in uninterrupted);assert.equal(uninterrupted.referenceNet,2);if(first==='6m')assert.equal(uninterrupted.net,2);
 }
});
test('live views and AI decisions contain no future draws, reference result, seed, or other concealed hands',()=>{
 const core=new TableCore(start());core.join(2,now);core.beginChallenge(now);const v=core.view(2).entries,summary=v.find(([k])=>k==='match')![2].challenge;
 for(const field of ['events','drawCursors','anchors','log','quality','seed','referenceNet','historicalNet'])assert.equal(summary[field],undefined);
 assert.ok(v.find(([k])=>k==='blood')![2].wallOrder.every((x:any)=>x===null));
 action(core,2,core.catalog(2).publicActions.find((a:any)=>a.tile==='6m').legalActionId);
 const d=core.decision(1) as any;assert.equal(d.sourcePriority.policy,'source-priority-v1');assert.ok(d.legalActions.some((a:any)=>a.legalActionId===d.sourcePriority.legalActionId));assert.equal(d.events,undefined);assert.equal(d.publicState.playersBySeat[2].concealedTiles,undefined);
});
test('unavailable original draw skips only remaining-wall entries and resumes the later own draw',()=>{
 const core=new TableCore(start());core.join(2,now);core.beginChallenge(now);const s=core.state;
 core.challenge!.events=[{id:'missing',seq:76,seat:2,action:'draw',tile:'2p'},{id:'available',seq:77,seat:2,action:'draw',tile:'1s'}];
 const extra=core.game.entries('things').find(([,t])=>t.slotName==='hand.extra@2')!;
 core.game.systemUpdate([['things',extra[0],{...extra[1],slotName:'hand.12@2'}],['blood',0,{...s,turnStep:'drawOrKong'}]]);
 prepareChallengeDraw(core);assert.equal(core.challenge!.drawCursors[2],2);assert.equal(core.challenge!.anchors[2],77);assert.match(core.challenge!.log.at(-1)!.reason,/顺延/);assertTiles(core);
 core.challenge!.events=[];core.challenge!.drawCursors=[0,0,0,0];prepareChallengeDraw(core);assert.match(core.challenge!.log.at(-1)!.reason,/固定种子/);assertTiles(core);
});
test('timeout follows source policy, duplicate submissions do not advance twice, stale actions cannot mutate',()=>{
 const core=new TableCore(start());core.join(2,now);core.beginChallenge(now);const id=core.catalog(2).publicActions.find((a:any)=>a.tile==='6m').legalActionId;
 const msg={actionId:'same',action:{kind:'aiDecision',decisionId:core.decision(2)!.decisionId,legalActionId:id}};core.submit(2,msg,now);const before=core.checkpoint();core.submit(2,msg,now);assert.deepEqual(core.checkpoint(),before);
 const expected=challengeAction(core,1).action;core.alarm(core.windows[1]!.deadlineAtMs!);assert.equal(core.challenge!.log.find(l=>l.timeout)?.tile,expected.tile);assertTiles(core);
 const frozen=core.checkpoint();assert.throws(()=>core.submit(2,{...msg,actionId:'stale'},now),{code:'AI_DECISION_STALE'});assert.deepEqual(core.checkpoint(),frozen);
});
test('invalid checkpoints and changed source tiles are rejected',()=>{
 assert.throws(()=>createChallengeCheckpoint({record,keySeq:76,seat:2,seed:1},owner,gameId,now),{code:'CHALLENGE_KEY_NOT_PLAYABLE'});
 const broken=structuredClone(record);broken.events[75].tile='9s';assert.throws(()=>createChallengeCheckpoint({record:broken,keySeq:75,seat:2,seed:1},owner,gameId,now));
});

test('evaluation is version-bound and normal practice does not inherit a private challenge guide',async()=>{
 const {practiceCheckpoint}=await import('../src/history');const {normalizeTable}=await import('../src/table-core');
 const saved=start(),core=new TableCore(saved);core.join(2,now);core.beginChallenge(now);
 const metadata=normalizeTable({seats:[0,1,2,3].map(seat=>({seat,kind:'human',owner:seat===2}))},owner,crypto.randomUUID(),now);
 const practice=practiceCheckpoint(core.checkpoint(),metadata,0,now);assert.equal(practice.challenge,undefined);
 core.game.systemUpdate([['blood',0,{...core.state,phase:'done'}]]);
 let report=challengeSummary(core);assert.ok('decisionQuality' in report&&report.decisionQuality);assert.equal(report.decisionQuality.samples,96);
 core.challenge!.sourceHash='changed-source';report=challengeSummary(core);assert.ok('decisionQuality' in report);assert.equal(report.decisionQuality,null);
});
