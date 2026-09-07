import {normalizeTable,TableCore,type Checkpoint} from './table-core';
import {ServiceError,type Access} from './auth';
import {coachLesson} from './coach-lessons';
const HANDS:Record<string,string[]>={
 swap3:['1m','2m','3m','4m','5m','6m','7m','8m','9m','1s','1s','2p','5p','8p'],
 dingque:['1m','2m','3m','4m','5m','6m','2s','3s','4s','6s','7s','8s','1p','9p'],
 discard:['1m','2m','3m','4m','5m','6m','7m','8m','9m','1s','2s','3s','5s','9p'],
 yaojiu:['1m','2m','3m','7m','8m','9m','1s','2s','3s','7s','8s','9s','1m','1m'],
};
export function createCoachCheckpoint(lessonId:string,owner:Access,gameId:string,now:number):Checkpoint {
 const lesson=coachLesson(lessonId);if(!lesson)throw new ServiceError('LESSON_NOT_FOUND',404);
 const metadata=normalizeTable({ruleset:'blood',tableName:lesson.title,timeoutSeconds:120,seats:[0,1,2,3].map(seat=>seat===0?{seat,kind:'human',owner:true}:{seat,kind:'ai',modelId:'coach-script',modelLabel:'教学陪练'})},owner,gameId,now);
 const core=new TableCore(metadata);for(let s=0;s<4;s++)core.join(s,now);
 const saved=core.checkpoint();
 const secret=saved.engine.secret.tileKeyById;
 const keys=new Map<number,number>(secret);
 const tiles=saved.entries.filter(([kind,,v])=>kind==='things'&&v?.slotName.startsWith('hand.')&&v.slotName.endsWith('@0')).map(([,id])=>Number(id));
 const locked=new Set<number>();
 const wanted=HANDS[lessonId]!.map(code=>({m:0,p:9,s:18}[code[1]!]!+Number(code[0])-1));
 for(let i=0;i<tiles.length;i++){
  const id=tiles[i]!,value=wanted[i]!;
  const swap=[...keys].find(([other,key])=>!locked.has(other)&&key===value)?.[0];
  if(swap===undefined)throw new Error('Invalid teaching deck');
  const old=keys.get(id)!;keys.set(id,value);keys.set(swap,old);locked.add(id);
 }
 saved.engine.secret.tileKeyById=[...keys];
 const state=saved.entries.find(([kind])=>kind==='blood')![2];
 state.phase=lessonId==='swap3'?'swap3':lessonId==='dingque'?'dingque':'playing';
 if(lessonId!=='swap3')state.swap3=null;
 if(state.phase==='playing')for(const player of Object.values(state.players) as any[]){player.dingque='p';player.dingqueReady=true;}
 saved.metadata={...saved.metadata,mode:'coach',coach:{lessonId:lesson.id,status:'active'},joined:[1,2,3]};
 saved.windows={};saved.receipts=[];
 return new TableCore(saved).checkpoint();
}
