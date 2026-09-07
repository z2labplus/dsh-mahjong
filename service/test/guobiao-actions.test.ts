import test from 'node:test';
import assert from 'node:assert/strict';
import {TableCore,normalizeTable} from '../src/table-core';
import {GuobiaoEngine} from '../src/engine/guobiao-engine';
import {guobiaoTileKeyFromCode as key} from '../src/engine/core/guobiao-tiles';
const now=1800000000000;
function fixture(hands:string[][]){
 let core=new TableCore(normalizeTable({ruleset:'guobiao',ruleOptions:{autoBuhua:false},seats:[0,1,2,3].map(seat=>({seat,kind:'human',owner:seat===0}))},{v:1,kind:'owner',tenant:'test',owner:'test',exp:now+100000},crypto.randomUUID(),now));
 for(let seat=0;seat<4;seat++)core.join(seat,now);
 const saved=core.checkpoint(),keys=new Map(saved.engine.secret.tileKeyById),locked=new Set();
 hands.forEach((codes,seat)=>{
  const ids=(core.engine as GuobiaoEngine).listHandTilesForSeat(seat).map(t=>t.tileId);
  assert.equal(codes.length,ids.length);
  codes.forEach((code,i)=>{const id=ids[i]!,wanted=key(code)!;const other=[...keys].find(([id,k])=>!locked.has(id)&&k===wanted)?.[0];assert.notEqual(other,undefined);const old=keys.get(id)!;keys.set(id,wanted);keys.set(other!,old);locked.add(id);});
 });
 saved.engine.secret.tileKeyById=[...keys];saved.windows={};saved.receipts=[];
 core=new TableCore(saved);core.progress(now);return core;
}
const hand=['W1','W2','W3','W4','W5','W6','B2','B3','B4','T6','T7','T8','F2','F3'];
function take(core:TableCore,seat:number,predicate:(a:any)=>boolean){
 const c=core.catalog(seat);assert.ok(c);const raw=[...c.rawByActionId.values()].find(predicate);assert.ok(raw);
 core.submitHuman(seat,{actionId:crypto.randomUUID(),decisionId:core.decision(seat)!.decisionId,action:raw},now+1);
}
for(const claim of ['chi','peng','mingGang'])test(`Guobiao ${claim}: real pending claim, restore and continue`,()=>{
 const other=claim==='chi'?['W1','W2','B1','B2','B3','B5','B6','B7','T2','T3','T4','J2','J3']:
 ['W3','W3','W3','B1','B2','B3','B5','B6','B7','T2','T3','J2','J3'];
 let core=fixture([hand,other]);
 const id=(core.engine as GuobiaoEngine).listHandTilesForSeat(0).find(t=>t.tileKey===key('W3'))!.tileId;
 take(core,0,a=>a.kind==='discard'&&a.tileId===id);
 core=new TableCore(core.checkpoint());take(core,1,a=>a.kind==='claim'&&a.action===claim);
 for(const seat of [2,3])if(core.decision(seat))take(core,seat,a=>a.kind==='claim'&&a.action==='pass');
 assert.equal(core.state.players[1].melds[0].kind,claim);assert.equal(core.state.turnSeat,1);
 assert.ok(core.decision(1));assert.deepEqual(new TableCore(core.checkpoint()).state,core.state);
 if(claim==='chi')assert.equal(core.state.players[1].melds[0].fromSeat,0);
});
test('Guobiao concealed kong supplements from the wall and stays hidden from other seats',()=>{
 const core=fixture([['W1','W1','W1','W1','W2','W3','B2','B3','B4','T6','T7','T8','F2','F3']]);
 const tail=core.state.wallTailIndex;take(core,0,a=>a.kind==='anGang');
 assert.equal(core.state.players[0].melds[0].kind,'anGang');assert.ok(core.state.wallTailIndex<tail);
 assert.deepEqual(core.view(1).entries.find(r=>r[0]==='gb')![2].players[0].melds[0].tileKeys,[]);
 assert.equal((core.engine as GuobiaoEngine).listHandTilesForSeat(0).length,11);
});
test('Guobiao manual flower replacement and preference changes survive recovery',()=>{
 const core=fixture([['H1',...hand.slice(1)]]);const tail=core.state.wallTailIndex;
 take(core,0,a=>a.kind==='buhua');assert.ok(core.state.wallTailIndex<tail);assert.ok(core.state.players[0].flowers.includes(key('H1')));
 core.submitHuman(0,{actionId:'flowers-on',action:{kind:'setAutoBuhua',enabled:true}},now+2);
 assert.equal(new TableCore(core.checkpoint()).state.autoBuhuaBySeat[0],true);
});
