import {createHash} from 'node:crypto';

export const TILE_CODES = [...'spm'].flatMap(s=>Array.from({length:9},(_,i)=>`${i+1}${s}`));
export const ACTION_NAMES = {draw:'摸牌',discard:'弃牌',peng:'碰',gang_exposed:'明杠',gang_concealed:'暗杠',gang_added:'补杠',draw_replacement:'杠后补牌',hu_ron:'点炮胡',hu_tsumo:'自摸',end:'流局结束'};
export const tileName=t=>typeof t==='string'&&/^[1-9][mps]$/.test(t)?'一二三四五六七八九'[+t[0]-1]+({m:'万',p:'筒',s:'条'}[t[1]]):'未选牌';
export const sortTiles=xs=>xs.slice().sort((a,b)=>TILE_CODES.indexOf(a)-TILE_CODES.indexOf(b));
export const recordHash=r=>createHash('sha256').update(JSON.stringify(r)).digest('hex');
const clone=x=>structuredClone(x);
const counts=xs=>xs.reduce((a,t)=>(a[t]=(a[t]??0)+1,a),{});
const tileCode=id=>`${Math.floor(id/4)%9+1}${'mps'[Math.floor(id/36)]}`;
const tileKey=t=>'mps'.indexOf(t[1])*9+Number(t[0])-1;
const same=(a,b)=>JSON.stringify(sortTiles(a))===JSON.stringify(sortTiles(b));

export function normalizeSourceRecord(input){
 const r=clone(input);
 if(!r||typeof r!=='object'||Array.isArray(r))throw new Error('牌谱必须是对象');
 if(Array.isArray(r.events)){
  const ids=new Map(r.events.map((e,i)=>[e.seq??i+1,e.id??`event-${e.seq??i+1}`]));
  r.events=r.events.map((e,i)=>({...e,id:e.id??`event-${e.seq??i+1}`,seq:i+1,...(e.triggerSeq&&!e.triggerEventId?{triggerEventId:ids.get(e.triggerSeq)??`missing-${e.triggerSeq}`}:{})}));
 }
 if(Array.isArray(r.players))r.players=r.players.map(p=>({...p,...Object.fromEntries(['dealtHand','openingHand'].filter(k=>Array.isArray(p[k])).map(k=>[k,sortTiles(p[k])]))})).sort((a,b)=>a.seat-b.seat);
 r.observations??=[];if(Array.isArray(r.observations))r.observations=r.observations.map((o,i)=>({...o,id:o.id??`observation-${i+1}`}));
 return r;
}

export function isWinningHand(tiles,meldCount){
 const need=4-meldCount;if(tiles.length!==need*3+2)return false;
 const c=counts(tiles);
 if(meldCount===0&&Object.values(c).every(n=>n%2===0))return true;
 const sets=(v,n)=>{
  const t=Object.keys(v).sort((a,b)=>tileKey(a)-tileKey(b)).find(k=>v[k]>0);if(!t)return n===0;if(n<1)return false;
  const k=+t[0],s=t[1];const choices=[];
  if(v[t]>=3)choices.push([t,t,t]);
  if(k<=7&&v[`${k+1}${s}`]>0&&v[`${k+2}${s}`]>0)choices.push([t,`${k+1}${s}`,`${k+2}${s}`]);
  return choices.some(group=>{const w={...v};group.forEach(t=>w[t]--);return sets(w,n-1);});
 };
 return Object.keys(c).some(t=>{if(c[t]<2)return false;const w={...c};w[t]-=2;return sets(w,need);});
}

/** Pure generator: validation never mutates an installed case or source file. */
export function compileSourceRecord(input,{gameId='source-record',requireComplete=true}={}){
 let r;const snapshots=[],warnings=[],issues=[];let context={field:'record'};
 const fail=(code,message,extra={})=>{throw Object.assign(new Error(message),{issue:{...context,code,message,...extra}});};
 const must=(ok,code,message,extra)=>{if(!ok)fail(code,message,extra);};
 const seatOK=s=>Number.isInteger(s)&&s>=0&&s<4;
 const tilesOK=xs=>Array.isArray(xs)&&xs.length<=108&&xs.every(t=>TILE_CODES.includes(t));
 try{
  r=normalizeSourceRecord(input);
  must(r.schema==='dsh-mahjong.source-hand.v1'&&(!r.ruleset||r.ruleset==='blood'),'SCHEMA','仅支持血战到底原始牌谱');
  must(Array.isArray(r.players)&&r.players.length===4,'PLAYERS','需要四位玩家');
  must(seatOK(r.dealer),'DEALER','请选择庄家');
  must(Array.isArray(r.events)&&r.events.length<=996,'EVENTS','最多支持996条行牌动作');
  const ids=new Set();for(const e of r.events){must(typeof e.id==='string'&&/^[\w-]{1,100}$/.test(e.id)&&!ids.has(e.id),'EVENT_ID','动作标识缺失或重复');ids.add(e.id);}
  const used=new Set(),drawIds=[];
  const allocate=t=>{const id=[0,1,2,3].map(i=>tileKey(t)*4+i).find(id=>!used.has(id));must(id!==undefined,'FIFTH_TILE',`${tileName(t)}超过四张`,{tile:t});used.add(id);return id;};
  for(let i=0;i<4;i++){
   context={field:'players',seat:i};const p=r.players[i];
   must(p.seat===i&&typeof p.name==='string'&&p.name.trim().length>0&&p.name.length<=80,'PLAYER','玩家座位或昵称无效');
   must(tilesOK(p.dealtHand)&&p.dealtHand.length===(i===r.dealer?14:13),'DEALT_HAND',`${p.name}换牌前应有${i===r.dealer?14:13}张牌`);
   must(['m','p','s'].includes(p.dingque),'DINGQUE',`${p.name}需要选择定缺花色`);
   must(Number.isSafeInteger(p.initialHandPoints??0),'POINTS','初始积分必须是整数');
  }
  let hands=r.players.map(p=>{context={field:'players',seat:p.seat};return p.dealtHand.map(allocate);}),melds=[[],[],[],[]],rivers=[[],[],[],[]],drawn=[null,null,null,null],won=[],huTiles={},scores=r.players.map(p=>p.initialHandPoints??0),ledger=[],turn=r.dealer,mode='discard',last=null,drawCount=0;
  const initialTotal=scores.reduce((a,b)=>a+b,0);
  const save=(eventId,seq,at,title,phase,info='')=>snapshots.push(clone({eventId,seq,at,title,phase,info,hands,melds,rivers,drawn,won,huTiles,scores,ledger,turn,mode,drawCount}));
  const take=(s,t)=>{const n=hands[s].findIndex(id=>tileCode(id)===t);must(n>=0,'MISSING_TILE',`${r.players[s].name}当前手中没有${tileName(t)}，请检查此前摸牌、起手或换牌`,{tile:t,seat:s});return hands[s].splice(n,1)[0];};
  const next=s=>[1,2,3,4].map(k=>(s+k)%4).find(i=>!won.includes(i));
  const handCounts=()=>{for(let i=0;i<4;i++)if(!won.includes(i)){const expected=13-melds[i].length*3+(i===turn&&mode==='discard'?1:0);must(hands[i].length===expected,'HAND_COUNT',`${r.players[i].name}手牌应为${expected}张，实际${hands[i].length}张`,{seat:i});}};
  const startAt=r.timing?.dealt??r.exchange?.sourceRange?.[0]??0;
  const exchangeAt=r.timing?.exchanged??r.exchange?.sourceRange?.[1]??startAt;
  const dingqueAt=r.timing?.dingque??r.dingqueSourceRange?.[1]??exchangeAt;
  must([startAt,exchangeAt,dingqueAt].every(n=>Number.isFinite(n)&&n>=0)&&startAt<=exchangeAt&&exchangeAt<=dingqueAt,'TIME','开局、换牌和定缺时间须按顺序');
  save('phase-dealt',0,startAt,'发牌完成，准备换三张','swap3','换牌前手牌的原始证据状态按记录保留。');
  context={field:'exchange'};const transfers=r.exchange?.transfers;
  must(Array.isArray(transfers)&&transfers.length===4,'EXCHANGE','需要四家的换三张记录');
  must(new Set(transfers.map(t=>t.fromSeat)).size===4&&new Set(transfers.map(t=>t.toSeat)).size===4,'EXCHANGE','四家必须各送出、收到一次');
  const offsets=new Set(transfers.map(t=>(t.toSeat-t.fromSeat+4)%4));
  must(offsets.size===1&&!offsets.has(0),'EXCHANGE_DIRECTION','四家换牌方向必须一致');
  const declared={previous_in_turn_order:3,next_in_turn_order:1,opposite:2}[r.exchange.direction];
  if(declared!==undefined)must(offsets.has(declared),'EXCHANGE_DIRECTION','接收玩家与选择的换牌方向不一致');
  const moved=transfers.map(t=>{must(seatOK(t.fromSeat)&&seatOK(t.toSeat)&&tilesOK(t.tiles)&&t.tiles.length===3&&new Set(t.tiles.map(x=>x[1])).size===1,'EXCHANGE','换出三张必须同花色且玩家有效');context={field:'exchange',seat:t.fromSeat};return {...t,ids:t.tiles.map(x=>take(t.fromSeat,x))};});
  moved.forEach(t=>hands[t.toSeat].push(...t.ids));
  for(const p of r.players){context={field:'openingHand',seat:p.seat};must(tilesOK(p.openingHand)&&same(hands[p.seat].map(tileCode),p.openingHand),'OPENING_MISMATCH',`${p.name}换牌后记录与起手牌、换牌计算不一致`,{expected:sortTiles(hands[p.seat].map(tileCode)),actual:p.openingHand});}
  save('phase-exchanged',0,exchangeAt,'换三张完成','dingque');
  save('phase-dingque',0,dingqueAt,'四家定缺，开始行牌','playing',r.players.map(p=>p.name+'缺'+({m:'万',p:'筒',s:'条'}[p.dingque])).join('；'));
  let previousAt=dingqueAt;
  for(const e of r.events){
   context={eventId:e.id,seq:e.seq,seat:e.seat,field:'events'};
   const s=e.seat,a=e.action,t=e.tile;
   must(seatOK(s),'SEAT','行动玩家无效');must(Object.hasOwn(ACTION_NAMES,a),'ACTION','动作类型无效');
   must(Number.isFinite(e.atSeconds)&&e.atSeconds>=previousAt,'TIME','事件时间不得早于前一步');previousAt=e.atSeconds;
   must(mode!=='done','AFTER_END','本副已结束，不能继续行牌');must(!won.includes(s),'WINNER_ACTING',`${r.players[s].name}已胡牌退出`);
   if(a!=='end')must(TILE_CODES.includes(t),'TILE','请选择有效的牌张');
   if(a==='draw'||a==='draw_replacement'){
    must(s===turn&&mode===(a==='draw'?'draw':'replacement'),'TURN',`现在应由${r.players[turn].name}${mode==='replacement'?'杠后补牌':mode==='discard'?'弃牌':'摸牌'}`);
    const id=allocate(t);hands[s].push(id);drawIds.push(id);drawCount++;drawn[s]=id;mode='discard';last=null;
   }else if(a==='discard'){
    must(s===turn&&mode==='discard','TURN','当前不轮到该玩家弃牌');
    must(!hands[s].some(id=>tileCode(id)[1]===r.players[s].dingque)||t[1]===r.players[s].dingque,'MISSING_SUIT','尚有定缺花色，必须先打缺牌');
    e.discardMatchesDrawnValue=drawn[s]!==null&&tileCode(drawn[s])===t;
    const id=take(s,t);rivers[s].push({id,seq:e.seq,eventId:e.id,taken:false});drawn[s]=null;last={id,s,eventId:e.id,seq:e.seq,kind:'discard',claimed:false};turn=next(s);mode='draw';
   }else if(a==='peng'||a==='gang_exposed'||a==='hu_ron'){
    must(last&&last.kind==='discard'&&last.s!==s&&last.s===e.fromSeat&&tileCode(last.id)===t,'CLAIM_SOURCE','该碰杠胡与前一弃牌的玩家、牌张不一致');
    must(e.triggerEventId===last.eventId,'CLAIM_REFERENCE','关联弃牌事件不正确，请重新选择来源');e.triggerSeq=last.seq;
    must(t[1]!==r.players[s].dingque,'MISSING_SUIT','不能碰杠胡定缺花色');
    if(a==='hu_ron'){
     must(!last.claimed||last.claimed==='hu','CLAIMED','该弃牌已被碰杠取走');
     must(!hands[s].some(id=>tileCode(id)[1]===r.players[s].dingque)&&isWinningHand([...hands[s].map(tileCode),t],melds[s].length),'INVALID_HU','手牌不满足胡牌形或仍有缺牌');
     won.push(s);huTiles[s]={id:last.id,source:'discard'};last.claimed='hu';rivers[last.s].at(-1).taken=true;turn=next(s);mode=won.length>=3?'done':'draw';drawn[s]=null;
    }else{
     must(!last.claimed,'CLAIMED','这张弃牌已被取走');const n=a==='peng'?2:3;const ids=Array.from({length:n},()=>take(s,t));const rel=(e.fromSeat-s+4)%4,called=rel===3?2:rel===2?1:0;ids.splice(called,0,last.id);
     melds[s].push({id:e.id,kind:a==='peng'?'peng':'gang',tile:t,fromSeat:e.fromSeat,gangType:a==='peng'?null:'ming',ids,called});rivers[last.s].at(-1).taken=true;drawn[s]=null;turn=s;mode=a==='peng'?'discard':'replacement';last=null;
    }
   }else if(a==='gang_concealed'||a==='gang_added'){
    must(s===turn&&mode==='discard','TURN','当前不能由该玩家杠牌');must(t[1]!==r.players[s].dingque,'MISSING_SUIT','不能杠定缺花色');
    if(a==='gang_concealed')melds[s].push({id:e.id,kind:'gang',tile:t,fromSeat:null,gangType:'an',ids:Array.from({length:4},()=>take(s,t)),called:null});
    else{const m=melds[s].find(m=>m.id===e.meldEventId&&m.kind==='peng'&&m.tile===t);must(m,'MELD_REFERENCE','补杠必须关联本家的同牌碰');m.ids.push(take(s,t));m.kind='gang';m.gangType='add';}
    drawn[s]=null;last=null;mode='replacement';
   }else if(a==='hu_tsumo'){
    must(s===turn&&mode==='discard'&&drawn[s]!==null&&tileCode(drawn[s])===t,'DRAWN_HU','自摸牌必须是本次摸入的牌');
    must(!hands[s].some(id=>tileCode(id)[1]===r.players[s].dingque)&&isWinningHand(hands[s].map(tileCode),melds[s].length),'INVALID_HU','自摸手牌不满足胡牌形或仍有缺牌');
    huTiles[s]={id:drawn[s],source:'self'};won.push(s);turn=next(s);mode=won.length>=3?'done':'draw';last=null;
   }else if(a==='end'){
    must(drawCount===55&&mode==='draw','EARLY_END','流局结束须已摸完余牌并完成最后一次弃牌');mode='done';
   }
   if(e.scoreTransfers!==undefined){must(Array.isArray(e.scoreTransfers)&&e.scoreTransfers.length<=12,'TRANSFERS','转账记录无效');for(const tr of e.scoreTransfers){must(seatOK(tr.fromSeat)&&seatOK(tr.toSeat)&&tr.fromSeat!==tr.toSeat&&Number.isSafeInteger(tr.points)&&tr.points>0&&tr.points<=1e9,'TRANSFERS','转账需有效玩家和正整数分数');scores[tr.fromSeat]-=tr.points;scores[tr.toSeat]+=tr.points;}
    if(e.scoreTransfers.length)ledger.push({kind:a.startsWith('gang')?'kong':'hu',label:ACTION_NAMES[a],seat:s,fromSeat:e.fromSeat,multiplier:e.scoreTransfers[0].points,transfers:e.scoreTransfers.map(t=>({fromSeat:t.fromSeat,toSeat:t.toSeat,beans:t.points})),at:e.atSeconds*1000,note:'原谱转账；赛事完整计分规则未独立校验。'});
   }
   must(scores.every(Number.isSafeInteger)&&scores.reduce((a,b)=>a+b,0)===initialTotal,'SCORE','积分转账不守恒');handCounts();
   const verb={draw:'摸',discard:'打',peng:'碰',gang_exposed:'明杠',gang_concealed:'暗杠',gang_added:'补杠',draw_replacement:'杠后补',hu_ron:'胡',hu_tsumo:'自摸',end:'流局结束'}[a];
   save(e.id,e.seq,e.atSeconds,r.players[s].name+verb+(a==='end'?'':tileName(t)),mode==='done'?'done':'playing',e.evidence?.explanation??'视频未逐项核实');
  }
  context={field:'events'};if(requireComplete)must(mode==='done','INCOMPLETE','本副尚未结束，请补齐后续动作；可先保存草稿');
  const remaining=Array.from({length:108},(_,i)=>i).filter(i=>!used.has(i));
  r.unplayedWall={...r.unplayedWall,count:remaining.length,tileMultiset:sortTiles(remaining.map(tileCode)),orderKnown:false,note:'余牌构成由已记录的起手与摸牌计算；尾墙真实顺序未核实。'};
  r.settlementBySeat=Object.fromEntries(r.players.map(p=>[p.seat,scores[p.seat]]));
  r.settlement=Object.fromEntries(r.players.map(p=>[r.players.filter(x=>x.name===p.name).length>1?p.name+'（座位'+(p.seat+1)+'）':p.name,scores[p.seat]]));
  must(Number.isFinite(r.timing?.settlement??previousAt)&&(r.timing?.settlement??previousAt)>=previousAt,'TIME','结算时间不得早于最后动作');
  const finalAt=r.timing?.settlement??previousAt;
  if(mode==='done')save('phase-settlement',r.events.length,finalAt,'本副结算','done',r.players.map(p=>`${p.name} ${scores[p.seat]}`).join('；'));
  const observationResults=[];
  must(Array.isArray(r.observations)&&r.observations.length<=2000,'OBSERVATIONS','核对记录格式无效');
  const observationIds=new Set();
  for(const o of r.observations){
   context={field:'observations',eventId:o.eventId,seat:o.seat};
   must(typeof o.id==='string'&&o.id.length<=100&&!observationIds.has(o.id)&&['partial','complete'].includes(o.scope)&&(o.scope==='complete'||o.tiles?.length>0)&&seatOK(o.seat)&&['hand','river','meld'].includes(o.area)&&tilesOK(o.tiles)&&Number.isFinite(o.atSeconds??0)&&(o.atSeconds??0)>=0,'OBSERVATION','视频实见记录需要有效玩家、区域和牌张');
   observationIds.add(o.id);
   const snap=snapshots.find(s=>s.eventId===o.eventId);
   if(!snap){observationResults.push({id:o.id,eventId:o.eventId,status:'missing',message:'对应事件已删除，请重新定位'});continue;}
   const actual=o.area==='hand'?snap.hands[o.seat].map(tileCode):o.area==='river'?snap.rivers[o.seat].filter(x=>!x.taken).map(x=>tileCode(x.id)):snap.melds[o.seat].flatMap(m=>m.ids.map(tileCode));
   const ac=counts(actual),oc=counts(o.tiles),matches=o.scope==='partial'?Object.keys(oc).every(k=>oc[k]<= (ac[k]??0)):same(actual,o.tiles);
   observationResults.push({id:o.id,eventId:o.eventId,seat:o.seat,status:matches?'match':'mismatch',actual:sortTiles(actual),observed:sortTiles(o.tiles)});
  }
  warnings.push('程序校验通过不代表已逐项核实视频；赛事完整计分规则和未摸尾墙顺序未核实。');
  if(observationResults.some(o=>o.status!=='match'))warnings.push('存在与视频实见记录不一致或已失去关联的核对点。');
  r.verification={...r.verification,historicalActionsComplete:mode==='done',actionCount:r.events.length,drawCount,discardCount:r.events.filter(e=>e.action==='discard').length,pengCount:r.events.filter(e=>e.action==='peng').length,gangCount:r.events.filter(e=>e.action.startsWith('gang_')).length,winCount:won.length,tileMultiplicityPassed:true,handSizePassed:true,turnOrderPassed:true,dingquePassed:true,winningShapesPassed:true,settlementTransfersPassed:true,historicalWallTailKnown:false,videoAuditStatus:'未完成逐项视频核对',dataValidation:'passed'};
  const data={schema:'dsh-mahjong.source-view.v1',gameId,title:r.title,players:r.players.map(({seat,name,dingque,initialHandPoints})=>({seat,name,dingque,initialHandPoints:initialHandPoints??0})),dealer:r.dealer,wallIds:[...drawIds,...remaining],snapshots,provenance:{scoreMode:'observed_transfers',sourceRecordVersion:r.version,sourceRecordSha256:recordHash(r),tailOrder:'unknown',wallPosition:'hidden',tileIdentity:'interchangeable_display_copies'}};
  return {ok:true,record:r,data,issues,warnings,observationResults};
 }catch(error){issues.push(error.issue??{...context,code:'INVALID_RECORD',message:error.message});return {ok:false,record:r??input,issues,warnings,partialSnapshots:snapshots};}
}
