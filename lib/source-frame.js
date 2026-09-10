export const tileKey=id=>Math.floor(id/4);
export function buildFrame(data,index,seat=0){
 if(!Number.isInteger(index)||!data.snapshots[index]||!Number.isInteger(seat)||seat<0||seat>3)throw new Error('回放位置或选手无效');
 const s=data.snapshots[index],entries=[],seen=new Set(),slots=new Set();
 const put=(id,slotName,rotationIndex,publicFace=false,selfFace=false)=>{
  if(!Number.isInteger(id)||id<0||id>=108)throw new Error(`无效的108张血战牌 ${id}`);
  if(seen.has(id)||slots.has(slotName))throw new Error(`重复牌张或牌位 ${id} ${slotName}`);
  seen.add(id);slots.add(slotName);
  entries.push(['things',id,{slotName,rotationIndex,claimedBy:null,heldRotation:{x:0,y:0,z:0,w:1},shiftSlotName:null}],['tileFacePublic',id,publicFace?tileKey(id):null],['tileFaceSelf',id,!publicFace&&selfFace?tileKey(id):null]);
 };
 // Three winners end a blood-battle hand; the later broadcast score graphic
 // must not keep the final non-winning player's hand concealed in the replay.
 const phase=s.won.length>=3?'done':s.phase;
 const all=phase==='done';
 const match={dealer:data.dealer??0,honba:0,conditions:{gameType:'BLOOD_BATTLE',back:0,fives:'000',points:'25',dealType:'HANDS'},bloodConfig:{waitMode:'noTimeout',timeoutMs:null},sourceReplay:{revealedSeats:s.won,wallLayout:'schematic'}};
 entries.push(['match',0,match]);
 const players={};
 for(const p of data.players){
  const i=p.seat,hu=s.won.includes(i),exposed=hu||all;
  entries.push(['seats',`seat-${i}`,{seat:i,startBeans:0}],['nicks',`seat-${i}`,p.name]);
  const extra=s.drawn[i],hand=s.hands[i].filter(id=>id!==extra).sort((a,b)=>a-b);
  hand.forEach((id,n)=>put(id,`hand.${n}@${i}`,exposed&&i!==seat?1:0,exposed,i===seat));
  if(extra!==null&&s.hands[i].includes(extra))put(extra,`hand.extra@${i}`,exposed&&i!==seat?1:0,exposed,i===seat);
  s.melds[i].forEach((m,row)=>m.ids.forEach((id,n)=>put(id,`meld.${row}.${n}@${i}`,m.gangType==='an'?(n===0||n===3?2:0):n===m.called?1:0,true)));
  s.rivers[i].filter(r=>!r.taken).forEach((r,n)=>put(r.id,`discard.${n>=18?'stack.':''}${Math.floor((n%18)/6)}.${n%6}@${i}`,0,true));
  players[i]={seat:i,playerId:`seat-${i}`,dingque:index<2?null:p.dingque,dingqueReady:index>=2,hu,huTileKey:hu?tileKey(s.huTiles[i].id):null,huSource:hu?s.huTiles[i].source:null,beans:s.scores[i],kongGain:s.ledger.filter(x=>x.kind==='kong').flatMap(x=>x.transfers).filter(t=>t.toSeat===i).reduce((v,t)=>v+t.beans,0),melds:s.melds[i].map((m,row)=>({kind:m.kind,tileKey:tileKey(m.ids[0]),fromSeat:m.fromSeat,gangType:m.gangType,row}))};
 }
 let taken=0;
 for(const h of Object.values(s.huTiles))if(h.source==='discard'&&!seen.has(h.id))put(h.id,`hu.taken.${taken++}`,0,true);
 // These are display positions, not recovered source wall positions. Consume the
 // upper tile first; an odd final tile must rest on the table, not float above it.
 data.wallIds.forEach((id,n)=>{if(n>=s.drawCount)put(id,`wall.${Math.floor((n%38)/2)}.${n+1===data.wallIds.length&&n%2===0?0:1-n%2}@${Math.floor(n/38)}`,0)});
 if(seen.size!==108)throw new Error(`牌数不是108：${seen.size}`);
 entries.push(['blood',0,{version:1,base:1,initialBeans:0,initialBeansBySeat:Object.fromEntries(data.players.map(p=>[p.seat,p.initialHandPoints??0])),phase,dealer:data.dealer??0,turnSeat:s.turn,turnStep:s.mode==='discard'?'discard':'drawOrKong',wallOrder:Array(55).fill(null),wallIndex:s.drawCount,nextId:index+1,pending:null,swap3:null,ledger:s.ledger,players,revealAllHands:all}]);
 return {schema:'dsh-mahjong.frame.v1',gameId:data.gameId,eventIndex:index,at:Math.round(s.at*1000),phase,perspective:{seat},view:{entries}};
}
