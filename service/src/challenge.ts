import {compileSourceRecord} from '../../lib/source-record.js';
import {buildFrame} from '../../lib/source-frame.js';
import {TableCore,normalizeTable,type Checkpoint} from './table-core';
import {BloodEngine} from './engine/blood-engine';
import {ServiceError,type Access} from './auth';
import {shuffled,challengeAction,challengeSummary,type Cue} from './challenge-policy';
export function createChallengeCheckpoint(input:any,owner:Access,gameId:string,now:number):Checkpoint{
 if(!input||Object.keys(input).some(k=>!['record','keySeq','seat','seed'].includes(k))||!Number.isInteger(input.keySeq)||!Number.isInteger(input.seat)||input.seat<0||input.seat>3||!Number.isInteger(input.seed)||input.seed<0||input.seed>0xffffffff)throw new ServiceError('INVALID_CHALLENGE');
 const result=compileSourceRecord(input.record,{gameId});if(!result.ok)throw new ServiceError('CHALLENGE_SOURCE_INVALID',422);
 const {data,record}=result,index=data.snapshots.findIndex((s:any)=>s.seq===input.keySeq&&s.phase==='playing'),snapshot=data.snapshots[index];
 if(!snapshot||snapshot.mode!=='discard'||snapshot.turn!==input.seat||snapshot.won.includes(input.seat))throw new ServiceError('CHALLENGE_KEY_NOT_PLAYABLE',422);
 const metadata=normalizeTable({tableName:`接手续打 · ${data.players[input.seat].name}`,ruleset:'blood',timeoutSeconds:38,seats:data.players.map((p:any)=>p.seat===input.seat?{seat:p.seat,kind:'human',owner:true,initialPoints:0}:{seat:p.seat,kind:'ai',modelId:'source-priority-v1',modelLabel:p.name,initialPoints:0})},owner,gameId,now);
 metadata.mode='challenge';metadata.joined=[0,1,2,3];
 const entries=buildFrame(data,index,input.seat).view.entries.filter(([kind]:any)=>kind!=='tileFaceSelf');
 const state=entries.find(([kind]:any)=>kind==='blood')[2];state.wallOrder=[...data.wallIds.slice(0,state.wallIndex),...shuffled(data.wallIds.slice(state.wallIndex),input.seed)];
 const match=entries.find(([kind]:any)=>kind==='match')[2];match.roomType='friend';delete match.sourceReplay;match.seatActors=Object.fromEntries(metadata.seats.map(s=>[s.seat,s]));
 // Keep existing public score transfers: they are historical facts, including
 // liabilities for a pre-key kong refund. Only future transfers use blood-v1.
 const engine=(new TableCore(metadata).engine as BloodEngine).exportCheckpoint();engine.secret.tileKeyById=Array.from({length:108},(_,id)=>[id,Math.floor(id/4)]);engine.secret.pendingDingqueBySeat=data.players.map((p:any)=>[p.seat,p.dingque]);
 const events:Cue[]=record.events.filter((e:any)=>e.seq>input.keySeq).map(({id,seq,seat,action,tile,triggerEventId,triggerSeq,fromSeat}:any)=>({id,seq,seat,action,tile,triggerEventId,triggerSeq,fromSeat}));
 const saved:Checkpoint={version:1,metadata,entries,engine,windows:{},receipts:[],challenge:{version:1,sourceHash:data.provenance.sourceRecordSha256,sourceVersion:record.version,sourceTitle:data.title,keySeq:input.keySeq,seat:input.seat,names:data.players.map((p:any)=>p.name),seed:input.seed,startScores:snapshot.scores.slice(),historicalNet:data.snapshots.at(-1).scores[input.seat]-snapshot.scores[input.seat],events,drawCursors:[0,0,0,0],anchors:[0,1,2,3].map(seat=>seat===input.seat?input.keySeq:-1),lastSourceDiscard:null,log:[],quality:[]}};
 // Counterfactual reference uses exactly the same checkpoint, draw guide, tail,
 // rules and fallback. Never compare a training payout directly to video points.
 const reference=new TableCore(saved);reference.progress(now);
 for(let n=0;n<500&&!['settling','done'].includes(reference.state.phase);n++){
  const seat=Object.keys(reference.windows).map(Number)[0];if(seat===undefined)throw new ServiceError('CHALLENGE_REFERENCE_STALLED',422);
  const choice=challengeAction(reference,seat),decision=reference.decision(seat)!;
  reference.submit(seat,{actionId:`reference-${n}`,action:{kind:'aiDecision',decisionId:decision.decisionId,legalActionId:choice.action.legalActionId}},now+n+1);
 }
 if(!['settling','done'].includes(reference.state.phase))throw new ServiceError('CHALLENGE_REFERENCE_UNFINISHED',422);
 saved.challenge!.referenceNet=challengeSummary(reference).net;
 // Joining the owning human starts clocks. The other seats already have their
 // original hand positions; reconnecting must never reset them or their names.
 saved.metadata.joined=[0,1,2,3].filter(seat=>seat!==input.seat);
 return saved;
}
