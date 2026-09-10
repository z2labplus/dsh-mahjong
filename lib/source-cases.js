import {readFileSync,readdirSync,existsSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {buildFrame} from './source-frame.js';
const bad=(message,code='INVALID_SOURCE_CASE')=>Object.assign(new Error(message),{code});
// A post-discard snapshot already points turn at the next player. Follow the
// recorded event's actor instead; settlement retains the last action's actor.
export function sourceActorSeat(c,index){
  if(!Number.isInteger(index)||!c.data?.snapshots[index]||!Array.isArray(c.record?.events))return null;
  for(let i=index;i>=0;i--){
    const s=c.data.snapshots[i];
    if(s.eventId==='phase-settlement')continue;
    if(s.eventId?.startsWith('phase-')||s.seq===0)return c.data.dealer??c.record?.dealer??0;
    const event=c.record?.events?.find(e=>s.eventId?e.id===s.eventId:e.seq===s.seq);
    if(Number.isInteger(event?.seat)&&event.seat>=0&&event.seat<4)return event.seat;
    return null;
  }
  return null;
}
export function sourcePerspective(c,meta){
  const viewMode=meta.viewMode??'fixed',fixedSeat=meta.fixedSeat??meta.seat;
  if(!['fixed','follow'].includes(viewMode))throw bad('观察模式无效');
  if(!Number.isInteger(meta.eventIndex)||!c.data.snapshots[meta.eventIndex]||![meta.seat,fixedSeat].every(seat=>Number.isInteger(seat)&&seat>=0&&seat<4))throw bad('回放步骤或视角无效');
  const seat=viewMode==='follow'?sourceActorSeat(c,meta.eventIndex):fixedSeat;
  if(seat===null)throw bad('这份牌谱缺少当前步骤的行动玩家记录，请使用固定玩家模式');
  return {...meta,seat,fixedSeat,viewMode};
}
export function createSourceCaseCatalog(directory=path.resolve(import.meta.dirname,'../.local/cases')) {
  const cases=new Map();
  if(existsSync(directory))for(const file of readdirSync(directory)) {
    if(!/^[a-z0-9-]+\.json$/.test(file))continue;
    const bytes=readFileSync(path.join(directory,file)),c=JSON.parse(bytes);
    if(c.schema!=='dsh-mahjong.source-case.v1'||file!==c.caseId+'.json'||!Array.isArray(c.data?.snapshots)||c.data.snapshots.length<1||c.data.snapshots.length>1000||c.data.players?.length!==4)throw bad('本地赛事案例格式无效');
    for(let i=0;i<c.data.snapshots.length;i++)for(let seat=0;seat<4;seat++)buildFrame(c.data,i,seat);
    cases.set(c.caseId,{...c,hash:createHash('sha256').update(bytes).digest('hex')});
  }
  function reload(id){const file=path.join(directory,id+'.json');if(!/^[a-z0-9-]+$/.test(id)||!existsSync(file))return;const bytes=readFileSync(file);const c=JSON.parse(bytes);cases.set(id,{...c,hash:createHash('sha256').update(bytes).digest('hex')});}
  function get(id,hash){let c=cases.get(id);if(c&&hash&&hash!==c.hash&&/^[a-f0-9]{64}$/.test(hash)){const archived=path.resolve(directory,'../source-records',id,'versions',hash+'.json');if(existsSync(archived)){const v=JSON.parse(readFileSync(archived));c={...v.case,record:v.case.record??v.record,hash:v.hash};}}if(!c)throw bad('本机尚未安装这份赛事牌谱','SOURCE_CASE_UNAVAILABLE');if(hash&&hash!==c.hash)throw bad('该案例已更新，请从赛事案例重新打开','SOURCE_CASE_CHANGED');return c;}
  function frame(meta){
    const c=get(meta.caseId,meta.sourceHash),index=meta.eventIndex,seat=meta.seat;
    if(!Number.isInteger(index)||!c.data.snapshots[index]||!Number.isInteger(seat)||seat<0||seat>3)throw bad('回放步骤或视角无效');
    let data=c.data,lesson=meta.lesson===null||meta.lesson===undefined?null:c.lessons?.[meta.lesson];
    if(meta.lesson!==null&&meta.lesson!==undefined&&(!Number.isInteger(meta.lesson)||!lesson))throw bad('讲解章节无效');
    if(lesson&&!(lesson.sequence??[lesson.step]).includes(index))throw bad('讲解章节与牌谱步骤不一致');
    if(lesson?.hypothesis){
      data=structuredClone(data);const s=data.snapshots[index];const n=s.hands[c.keySeat].findIndex(id=>['m','p','s'][Math.floor(id/36)]+(Math.floor(id/4)%9+1)===lesson.hypothesis.slice(-1)+lesson.hypothesis.slice(0,-1));
      if(n<0)throw bad('假设弃牌不在手中');
      const id=s.hands[c.keySeat].splice(n,1)[0];s.rivers[c.keySeat].push({id,seq:s.seq+1,taken:false});s.drawn[c.keySeat]=null;s.turn=[1,2,3,4].map(offset=>(c.keySeat+offset)%4).find(seat=>!s.won.includes(seat));s.mode='draw';
    }
    const s=data.snapshots[index],f=buildFrame(data,index,seat);
    f.tableName=c.title;f.ruleset='blood';f.ruleVersion='source-observed';f.label=s.title;
    f.sourceFacts={notice:c.notice,label:s.title,sourceSeconds:s.at,hypothesis:lesson?.hypothesis??null,scoring:'仅保存原谱记录的历史转账，完整赛事规则未确认；不得套用默认断幺九番。'};
    return f;
  }
  return {
    directory,reload,get,frame,perspective:meta=>sourcePerspective(get(meta.caseId,meta.sourceHash),meta),
    list:()=>[...cases.values()].map(c=>({caseId:c.caseId,title:c.title,count:c.data.snapshots.length,players:c.data.players,keyIndex:c.keyIndex,keySeat:c.keySeat,hasLessons:(c.lessons?.length??0)>0,challengeAvailable:!!c.record&&c.data.snapshots[c.keyIndex]?.mode==='discard',notice:c.notice})),
    view(meta){const c=get(meta.caseId,meta.sourceHash);return {caseId:c.caseId,notice:c.notice,players:c.data.players,keyIndex:c.keyIndex,keySeat:c.keySeat,
      items:c.data.snapshots.map((s,i)=>({index:i,label:s.title,at:s.at,eventId:s.eventId??(i===c.data.snapshots.length-1?"phase-settlement":s.seq?`event-${s.seq}`:["phase-dealt","phase-exchanged","phase-dingque"][i]),seq:s.seq})),lessons:c.lessons?.map(({voice,...scene})=>scene)??[],lesson:meta.lesson??null,
      questionIndex:meta.questionIndex,questionSeat:meta.questionSeat,questionLesson:meta.questionLesson??null,
      seat:meta.seat,viewMode:meta.viewMode??'fixed',fixedSeat:meta.fixedSeat??meta.seat,followAvailable:c.data.snapshots.every((_,i)=>sourceActorSeat(c,i)!==null),frame:frame(meta),sourceHash:c.hash,version:c.recordVersion??c.record?.version??1,questionHash:meta.questionHash??meta.sourceHash};}
  };
}
