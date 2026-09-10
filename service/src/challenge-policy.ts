import {challengeAnalysis} from './challenge-analysis';
import type { TableCore } from './table-core';
import { BloodEngine } from './engine/blood-engine';
import { shantenPinghu } from './engine/core/ev-engine';
export type Cue={id:string;seq:number;seat:number;action:string;tile?:string;triggerEventId?:string;triggerSeq?:number;fromSeat?:number};
export type ChallengeState={version:1;sourceHash:string;sourceVersion:number;sourceTitle:string;keySeq:number;seat:number;names:string[];seed:number;startScores:number[];historicalNet:number;referenceNet?:number;events:Cue[];drawCursors:number[];anchors:number[];lastSourceDiscard:string|null;log:Array<{seat:number;kind:string;tile?:string;reason:string;sourceSeq?:number;timeout?:boolean}>;quality:Array<{tile:string;shanten:number;effective:number;bestShanten:number;bestEffective:number;timeout:boolean}>};
const key=(tile:string)=>'mps'.indexOf(tile[1]!)*9+Number(tile[0])-1;
const code=(k:number)=>`${k%9+1}${'mps'[Math.floor(k/9)]}`;
export function shuffled<T>(input:T[],seed:number):T[]{const a=input.slice();let x=seed>>>0;for(let i=a.length-1;i>0;i--){x=(Math.imul(x,1664525)+1013904223)>>>0;const j=x%(i+1);[a[i],a[j]]=[a[j]!,a[i]!];}return a;}
// Only the server sees the guide. A requested tile must still physically be in
// the remaining wall. A skip consumes the guide entry, never somebody's hand.
export function prepareChallengeDraw(core:TableCore){
 const c=core.challenge!,s=core.state;
 if(!(core.engine instanceof BloodEngine)||s.phase!=='playing'||s.pending||s.turnStep!=='drawOrKong'||s.players[s.turnSeat]?.hu||Object.values(s.players).filter((p:any)=>p.hu).length>=3||s.wallIndex>=s.wallOrder.length)return;
 if(core.game.entries('things').some(([,v])=>v.slotName===`hand.extra@${s.turnSeat}`))return;
 const seat=s.turnSeat,guide=c.events.filter(e=>e.seat===seat&&e.action.startsWith('draw'));
 let picked=-1,anchor=-1;const skipped:string[]=[];
 while(c.drawCursors[seat]!<guide.length){const e=guide[c.drawCursors[seat]!]!;c.drawCursors[seat]!++;
  picked=s.wallOrder.findIndex((id:number,n:number)=>n>=s.wallIndex&&core.engine instanceof BloodEngine&&core.engine.tileKeyForId(id)===key(e.tile!));
  if(picked>=0){anchor=e.seq;c.log.push({seat,kind:'draw',tile:e.tile,sourceSeq:e.seq,reason:skipped.length?`原定摸牌 ${skipped.join('、')} 已不在余牌中，顺延至该玩家后续原摸牌`:'沿用该玩家原摸牌'});break;}skipped.push(e.tile!);
 }
 if(picked<0){picked=s.wallIndex;c.log.push({seat,kind:'draw',tile:code(core.engine.tileKeyForId(s.wallOrder[picked])!),reason:skipped.length?`原定摸牌 ${skipped.join('、')} 已不在余牌中，改用固定种子的剩余牌`:'该玩家原摸牌记录已用完，使用固定种子的剩余牌'});}
 c.anchors[seat]=anchor;
 const wall=s.wallOrder.slice();[wall[s.wallIndex],wall[picked]]=[wall[picked],wall[s.wallIndex]];
 core.game.systemUpdate([['blood',0,{...s,wallOrder:wall}]]);
}
function distance(counts:number[],melds:number){const standard=shantenPinghu({counts,fixedMeldCount:melds});if(melds)return standard;const pairs=counts.reduce((n,c)=>n+Math.floor(c/2),0);return Math.min(standard,6-pairs);}
// A narrow, reproducible efficiency measure, not a hidden-information EV score.
// Counts come exclusively from the actor's concealed hand and public tiles.
export function discardEfficiency(catalog:any):Array<{legalActionId:string;tile:string;shanten:number;effective:number}>{
 const counts=Array(27).fill(0),seen=Array(27).fill(0);for(const t of catalog.handState.concealedTiles){counts[key(t.tile)]++;seen[key(t.tile)]++;}
 for(const [seat,p] of Object.entries(catalog.publicState.playersBySeat) as Array<[string,any]>){for(const m of p.melds)seen[key(m.tile)]+=m.kind==='gang'?4:3;for(const t of catalog.publicState.discardsBySeat[seat]??[])seen[key(t)]++;}
 if(catalog.visibleCounts)for(let i=0;i<27;i++)seen[i]=catalog.visibleCounts[i];
 const melds=catalog.publicState.playersBySeat[catalog.seat].melds.length;
 return catalog.publicActions.filter((a:any)=>a.kind==='discard').map((a:any)=>{const k=key(a.tile);counts[k]--;const shanten=distance(counts,melds);let effective=0;
  for(let i=0;i<27;i++){if(code(i)[1]===catalog.handState.dingque||counts[i]>=4)continue;counts[i]++;if(distance(counts,melds)<shanten)effective+=Math.max(0,4-seen[i]);counts[i]--;}
  counts[k]++;return {legalActionId:a.legalActionId,tile:a.tile,shanten,effective};
 }).sort((a:any,b:any)=>a.shanten-b.shanten||b.effective-a.effective||key(a.tile)-key(b.tile));
}
function matches(a:any,e:Cue){if(e.action==='discard')return a.kind==='discard'&&a.tile===e.tile;
 if(e.action==='hu_tsumo')return a.kind==='hu';
 if(e.action==='hu_ron')return a.kind==='claim'&&a.action==='hu';
 if(e.action==='peng'||e.action==='gang_exposed')return a.kind==='claim'&&a.action===(e.action==='peng'?'peng':'gang');
 if(e.action==='gang_concealed'||e.action==='gang_added')return a.kind==='kong'&&a.tile===e.tile&&a.gangType===(e.action==='gang_concealed'?'an':'add');return false;}
export function challengeAction(core:TableCore,seat:number,catalog=core.catalog(seat)):{action:any;reason:string;cue?:Cue}{
 const c=core.challenge!,actions=catalog.publicActions,claim=catalog.publicState.claim;
 let cue:Cue|undefined;
 if(claim&&c.lastSourceDiscard){cue=c.events.find(e=>e.seat===seat&&['hu_ron','peng','gang_exposed'].includes(e.action)&&(e.triggerEventId===c.lastSourceDiscard||e.triggerSeq===c.events.find(x=>x.id===c.lastSourceDiscard)?.seq)&&e.tile===claim.tile&&e.fromSeat===claim.fromSeat);
 }else if(c.anchors[seat]!>=0){cue=c.events.find(e=>e.seat===seat&&e.seq>c.anchors[seat]!);if(cue?.action.startsWith('draw'))cue=undefined;}
 const original=cue&&actions.find((a:any)=>matches(a,cue!));
 if(original)return {action:original,reason:'沿用原谱动作',cue};
 if(claim&&c.lastSourceDiscard&&!cue){const pass=actions.find((a:any)=>a.kind==='claim'&&a.action==='pass');if(pass)return {action:pass,reason:'原谱对此弃牌未作响应，沿用过牌'};}
 const win=actions.find((a:any)=>a.kind==='hu'||a.kind==='claim'&&a.action==='hu');
 if(win)return {action:win,reason:'原动作无法沿用，采用当前合法胡牌'};
 const rank=discardEfficiency(catalog);if(rank.length)return {action:actions.find((a:any)=>a.legalActionId===rank[0]!.legalActionId),reason:cue?'原动作在当前局面不合法，按向听数和可见进张选择弃牌':'当前回合没有可对应的原动作，按向听数和可见进张选择弃牌'};
 return {action:actions.find((a:any)=>a.kind==='claim'&&a.action==='pass')??actions[0],reason:'原动作无法沿用，使用合法过牌（新局面不强行碰杠）'};
}
export function recordChallengeAction(core:TableCore,seat:number,catalog:any,id:string,timeout:boolean){
 const c=core.challenge!,actual=catalog.publicActions.find((a:any)=>a.legalActionId===id),selected=challengeAction(core,seat,catalog),matched=selected.cue&&matches(actual,selected.cue);
 if(seat===c.seat&&actual.kind==='discard'){const ranks=discardEfficiency(catalog),r=ranks.find(a=>a.legalActionId===id)!;c.quality.push({tile:r.tile,shanten:r.shanten,effective:r.effective,bestShanten:ranks[0]!.shanten,bestEffective:ranks[0]!.effective,timeout});}
 const reason=seat===c.seat&&!timeout?'玩家自由选择':selected.action.legalActionId===id?selected.reason:'陪练未采用推荐动作';
 c.log.push({seat,kind:actual.kind==='claim'?actual.action:actual.kind,tile:actual.tile,reason,...(matched?{sourceSeq:selected.cue!.seq}:{}),...(timeout?{timeout:true}:{})});
 if(matched)c.anchors[seat]=selected.cue!.seq;
 if(actual.kind==='discard'||actual.kind==='kong')c.lastSourceDiscard=matched?selected.cue!.id??null:null;
}
export function challengeSummary(core:TableCore){const c=core.challenge!,finished=['settling','done'].includes(core.state.phase),net=core.state.players[c.seat].beans-c.startScores[c.seat]!;
 return {version:1,mode:'training',policy:'source-priority-v1',sourceVersion:c.sourceVersion,sourceHash:c.sourceHash,seat:c.seat,name:c.names[c.seat],names:c.names,finished,net,
  rules:'接手前保留录像积分与杠分关系；接手后按血战训练规则 v1、底分 1 结算，包含胡牌、杠分和流局查叫／退税，非完整赛事规则。未知尾墙使用固定种子，属于训练重建。',
  ...(finished?{seed:c.seed,referenceNet:c.referenceNet,historicalNet:c.historicalNet,difference:c.referenceNet===undefined?null:net-c.referenceNet,quality:c.quality,
   decisionQuality:challengeAnalysis.sourceHash===c.sourceHash&&challengeAnalysis.keySeq===c.keySeq&&challengeAnalysis.seat===c.seat?{...challengeAnalysis,chosenTile:c.quality[0]?.tile,automatic:c.quality[0]?.timeout??false}:null,
   qualityNotice:'下面是逐步出牌效率，只看向听数与可见进张；关键步的多次模拟另列，不以单次输赢或效率指标证明水平超过选手。',log:c.log}: {adjustments:c.log.filter(x=>!x.reason.startsWith('沿用')&&x.reason!=='玩家自由选择').length})};}
