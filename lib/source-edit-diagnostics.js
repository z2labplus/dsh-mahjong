import {sortTiles} from './source-record.js';

const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const eventFields=['seat','action','tile','fromSeat','triggerEventId','meldEventId','atSeconds','scoreTransfers'];
const seatOK=s=>Number.isInteger(s)&&s>=0&&s<4;
const tileCode=id=>`${Math.floor(id/4)%9+1}${'mps'[Math.floor(id/36)]}`;
const tilesDelta=(before,after)=>{
  const remaining=before.slice(),more=[];
  for(const tile of after){const i=remaining.indexOf(tile);if(i<0)more.push(tile);else remaining.splice(i,1);}
  return {more:sortTiles(more),less:sortTiles(remaining)};
};

/** Explain a failed draft relative to its saved base, without guessing a fix. */
export function sourceEditDiagnostics(base,result){
  if(result.ok)return null;
  const before=base.record,draft=result.record,issue=result.issues?.[0];
  if(!Array.isArray(before?.events)||!Array.isArray(draft?.events)||!issue)return null;
  if(![...before.events,...draft.events].every(e=>e&&typeof e.id==='string'))return null;
  const old=new Map(before.events.map(e=>[e.id,e])),current=new Map(draft.events.map(e=>[e.id,e]));
  const commonBefore=before.events.filter(e=>current.has(e.id)).map(e=>e.id),commonAfter=draft.events.filter(e=>old.has(e.id)).map(e=>e.id);
  const changes=[];
  for(const e of draft.events){
    const b=old.get(e.id),fields=b?eventFields.filter(k=>!same(b[k],e[k])):['added'];
    if(b&&commonBefore.indexOf(e.id)!==commonAfter.indexOf(e.id))fields.push('order');
    if(fields.length)changes.push({eventId:e.id,seq:e.seq,seat:e.seat,fields,before:b??null,after:e});
  }
  for(const e of before.events)if(!current.has(e.id))changes.push({eventId:e.id,seq:e.seq,seat:e.seat,fields:['deleted'],before:e,after:null});
  const setupChanges=[];
  for(const p of Array.isArray(draft.players)?draft.players:[]){
    if(!p)continue;
    const b=before.players?.find(x=>x.seat===p.seat);
    const fields=['dealtHand','openingHand','dingque','initialHandPoints'].filter(k=>!same(b?.[k],p[k]));
    if(fields.length)setupChanges.push({seat:p.seat,fields});
  }
  for(const field of ['dealer','exchange','timing'])if(!same(before[field],draft[field]))setupChanges.push({fields:[field]});

  const failureIndex=draft.events.findIndex(e=>e.id===issue.eventId),failureEvent=draft.events[failureIndex];
  const handDifferences=[];
  // Compare the state immediately BEFORE the same failing event on both sides.
  // Using a later/after-event snapshot could manufacture differences from a kong.
  if(issue.field==='events'&&failureIndex>=0){
    const draftPriorId=failureIndex?draft.events[failureIndex-1].id:'phase-dingque';
    const d=result.partialSnapshots?.at(-1),baseIndex=base.data?.snapshots.findIndex(s=>s.eventId===issue.eventId)??-1;
    const b=baseIndex>0?base.data.snapshots[baseIndex-1]:null;
    if(b&&d?.eventId===draftPriorId)for(let seat=0;seat<4;seat++){
      const beforeHand=sortTiles(b.hands[seat].map(tileCode)),draftHand=sortTiles(d.hands[seat].map(tileCode));
      const delta=tilesDelta(beforeHand,draftHand);
      if(delta.more.length||delta.less.length)handDifferences.push({seat,beforeHand,draftHand,...delta});
    }
  }
  const suspectIds=new Set();
  for(const change of changes){
    const i=draft.events.findIndex(e=>e.id===change.eventId),e=draft.events[i];
    if(!e||failureIndex<0||i>failureIndex)continue;
    // These are candidates for inspection, NOT a claim of causal responsibility.
    if(e.seat===issue.seat||change.before?.seat===issue.seat){
      suspectIds.add(e.id);
      const next=draft.events[i+1],prev=draft.events[i-1];
      if(['draw','draw_replacement'].includes(e.action)&&next?.seat===e.seat&&next.action==='discard')suspectIds.add(next.id);
      if(e.action==='discard'&&prev?.seat===e.seat&&['draw','draw_replacement'].includes(prev.action))suspectIds.add(prev.id);
    }
  }
  const suspectedEvents=draft.events.filter(e=>suspectIds.has(e.id)).map(e=>({eventId:e.id,seq:e.seq,seat:e.seat,action:e.action,tile:e.tile}));
  return {baselineVersion:before.version??base.recordVersion,changes,setupChanges,handDifferences,suspectedEvents,
    failure:failureEvent?{eventId:failureEvent.id,seq:failureEvent.seq,seat:seatOK(issue.seat)?issue.seat:failureEvent.seat}:null,
    notice:'差异来自草稿与修改前版本的计算对照；建议检查的步骤不代表已确定错误，请结合原视频核对。'};
}
