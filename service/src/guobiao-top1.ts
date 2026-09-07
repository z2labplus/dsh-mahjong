// Deterministic public-information fallback. This is a local heuristic, not a
// model call: minimize distance to a complete hand, then preserve useful links.
export function guobiaoDistance(tiles: number[], openMelds=0): number {
 const counts=Array<number>(34).fill(0);for(const t of tiles)if(t<34)counts[t]++;
 let best=8;
 const visit=(start:number,melds:number,pair:number,blocks:number)=>{
  while(start<34&&!counts[start])start++;
  if(start===34){best=Math.min(best,8-2*(melds+openMelds)-Math.min(blocks,4-melds-openMelds)-pair);return;}
  if(counts[start]>=3){counts[start]-=3;visit(start,melds+1,pair,blocks);counts[start]+=3;}
  if(start<27&&start%9<7&&counts[start+1]&&counts[start+2]){counts[start]--;counts[start+1]--;counts[start+2]--;visit(start,melds+1,pair,blocks);counts[start]++;counts[start+1]++;counts[start+2]++;}
  if(counts[start]>=2){counts[start]-=2;if(!pair)visit(start,melds,1,blocks);visit(start,melds,pair,blocks+1);counts[start]+=2;}
  if(start<27)for(const gap of [1,2])if(start%9+gap<9&&counts[start+gap]){counts[start]--;counts[start+gap]--;visit(start,melds,pair,blocks+1);counts[start]++;counts[start+gap]++;}
  counts[start]--;visit(start,melds,pair,blocks);counts[start]++;
 };
 visit(0,0,0,0);
 if(!openMelds){
  best=Math.min(best,6-counts.reduce((n,c)=>n+Math.floor(c/2),0));
  const terminals=[0,8,9,17,18,26,27,28,29,30,31,32,33];
  best=Math.min(best,13-terminals.filter(k=>counts[k]>0).length-Number(terminals.some(k=>counts[k]>=2)));
 }
 return best;
}
export function guobiaoTop1(hand:{tileId:number;tileKey:number}[],meldCount:number,actions:any[]):any {
 const immediate=actions.find(a=>a.kind==='hu'||a.action==='hu')??actions.find(a=>a.kind==='buhua');if(immediate)return immediate;
 const turn=actions.filter(a=>a.kind==='discard');
 if(!turn.length)return actions.find(a=>a.action==='pass')??actions[0];
 const kong=actions.find(a=>a.kind==='anGang'||a.kind==='addGang');if(kong)return kong;
 const score=(action:any)=>{
  const tiles=hand.filter(t=>t.tileId!==action.tileId).map(t=>t.tileKey);
  const key=hand.find(t=>t.tileId===action.tileId)!.tileKey;
  const utility=tiles.reduce((sum,t)=>sum+(t===key?8:key<27&&t<27&&Math.floor(t/9)===Math.floor(key/9)?Math.max(0,3-Math.abs(t-key)):0),0);
  return guobiaoDistance(tiles,meldCount)*100+utility;
 };
 return turn.map((action,index)=>({action,index,score:score(action)})).sort((a,b)=>a.score-b.score||a.index-b.index)[0]!.action;
}
