import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createSourceCaseCatalog} from '../lib/source-cases.js';
import {createDshMahjongGameController} from '../lib/game-controller.js';
import {createMemorySessionGameStore} from '../lib/session-game-store.js';
import {buildFrame} from '../lib/source-frame.js';
function fixture(){
 const players=['甲','乙','丙','丁'].map((name,seat)=>({name,seat,dingque:'s'}));
 const hands=[Array.from({length:14},(_,i)=>i),...Array.from({length:3},(_,s)=>Array.from({length:13},(_,i)=>14+s*13+i))];
 const first={seq:0,at:0,title:'发牌',phase:'playing',info:'',hands,melds:[[],[],[],[]],rivers:[[],[],[],[]],drawn:[13,null,null,null],huTiles:{},won:[],scores:[0,0,0,0],ledger:[],drawCount:0,turn:0,mode:'discard'};
 const second=structuredClone(first);second.hands[0].pop();second.drawn[0]=null;second.rivers[0].push({id:13,seq:1,taken:false});second.turn=1;second.title='甲弃四万';
 return {schema:'dsh-mahjong.source-case.v1',caseId:'test-case',title:'测试案例',keyIndex:0,keySeat:0,notice:'历史原分',lessons:[],data:{gameId:'00000000-0000-4000-8000-000000000001',players,wallIds:Array.from({length:55},(_,i)=>i+53),snapshots:[first,second]}};
}
async function setup(){const directory=await mkdtemp(path.join(tmpdir(),'dsh-source-test-'));await writeFile(path.join(directory,'test-case.json'),JSON.stringify(fixture()));return {directory,catalog:createSourceCaseCatalog(directory)};}
test('catalog distinguishes an available lesson from a withdrawn lesson after correction',async()=>{
 const {directory,catalog}=await setup();try{
  assert.equal(catalog.list()[0].hasLessons,false);
  const c=fixture();c.lessons=[{step:0,title:'测试讲解',lines:['待验证']}];await writeFile(path.join(directory,'test-case.json'),JSON.stringify(c));catalog.reload(c.caseId);assert.equal(catalog.list()[0].hasLessons,true);
  c.lessons=[];await writeFile(path.join(directory,'test-case.json'),JSON.stringify(c));catalog.reload(c.caseId);assert.equal(catalog.list()[0].hasLessons,false);
 }finally{await rm(directory,{recursive:true});}
});
test('source wall conserves every physical tile and never leaves an unsupported upper tile',()=>{
 const data=fixture().data;
 for(let drawn=0;drawn<=55;drawn++){
  const s=data.snapshots[0];s.drawCount=drawn;s.rivers=[[],[],[],[]];
  data.wallIds.slice(0,drawn).forEach((id,i)=>s.rivers[i%4].push({id,taken:false}));
  const f=buildFrame(data,0),things=f.view.entries.filter(([k])=>k==='things');
  assert.equal(new Set(things.map(([,id])=>id)).size,108);
  const walls=new Set(things.map(([,id,v])=>v.slotName).filter(n=>n.startsWith('wall.')));
  assert.equal(walls.size,55-drawn);
  for(const slot of walls)if(slot.includes('.1@'))assert.ok(walls.has(slot.replace('.1@','.0@')),slot);
 }
 const invalid=fixture().data;invalid.wallIds[0]=108;
 assert.throws(()=>buildFrame(invalid,0),/无效/);
});
test('curated replay carries an explicit visibility policy for publicly revealed winners',()=>{
 const data=fixture().data,s=data.snapshots[0];s.won=[1];s.huTiles={1:{id:s.hands[1][0],source:'self'}};
 const f=buildFrame(data,0,0),match=f.view.entries.find(([k])=>k==='match')[2];
 assert.deepEqual(match.sourceReplay,{revealedSeats:[1],wallLayout:'schematic'});
 const faces=new Map(f.view.entries.filter(([k])=>k==='tileFacePublic').map(([,id,v])=>[id,v]));
 for(const id of s.hands[1])assert.notEqual(faces.get(id),null);
 for(const id of s.hands[2])assert.equal(faces.get(id),null);
});
test('source frame validates bounds, keeps all 108 tiles and hides the active opponents',async()=>{
 const {directory,catalog}=await setup();try{
  for(let seat=0;seat<4;seat++)for(let eventIndex=0;eventIndex<2;eventIndex++){
   const f=catalog.frame({caseId:'test-case',seat,eventIndex});const entries=f.view.entries;
   assert.equal(entries.filter(([k])=>k==='things').length,108);
   assert.equal(entries.filter(([k])=>k==='nicks').length,4);
   const things=new Map(entries.filter(([k])=>k==='things').map(([,id,v])=>[id,v]));
   for(const [kind,id,face] of entries)if(kind==='tileFaceSelf'&&face!==null)assert.ok(things.get(id).slotName.endsWith('@'+seat));
  }
  assert.throws(()=>catalog.frame({caseId:'test-case',seat:4,eventIndex:0}));
  assert.throws(()=>catalog.frame({caseId:'test-case',seat:0,eventIndex:2}));
  assert.throws(()=>catalog.frame({caseId:'test-case',sourceHash:'changed',seat:0,eventIndex:0}),{code:'SOURCE_CASE_CHANGED'});
 }finally{await rm(directory,{recursive:true});}
});
test('third source winner ends the hand before a delayed score graphic and reveals the remaining player',async()=>{
 const c=fixture(),s=c.data.snapshots[0];
 s.won=[0,2];
 for(const seat of [0,2,3]){s.huTiles[seat]={id:s.hands[seat][0],source:'self'};s.drawn[seat]=s.hands[seat][0];}
 const earlier=buildFrame(c.data,0,0);
 assert.equal(earlier.phase,'playing');
 const earlierFaces=new Map(earlier.view.entries.filter(([k])=>k==='tileFacePublic').map(([,id,v])=>[id,v]));
 for(const id of s.hands[1])assert.equal(earlierFaces.get(id),null);
 s.won.push(3); // The imported snapshot still says playing: broadcast settlement is later.
 const directory=await mkdtemp(path.join(tmpdir(),'dsh-source-terminal-'));
 try{
  await writeFile(path.join(directory,'test-case.json'),JSON.stringify(c));
  const frame=createSourceCaseCatalog(directory).frame({caseId:'test-case',seat:0,eventIndex:0});
  const blood=frame.view.entries.find(([k])=>k==='blood')[2];
  assert.equal(frame.phase,'done');assert.equal(blood.phase,'done');assert.equal(blood.revealAllHands,true);
  const faces=new Map(frame.view.entries.filter(([k])=>k==='tileFacePublic').map(([,id,v])=>[id,v]));
  for(const id of s.hands[1])assert.notEqual(faces.get(id),null);
 }finally{await rm(directory,{recursive:true});}
});
test('source navigation persists while Q&A stays on its original step and seat',async()=>{
 const {directory,catalog}=await setup();let store=createMemorySessionGameStore();
 const ctx={agents:{get:id=>({id,session:{header:{id},append(){}}}),list:()=>[]},on:()=>()=>{}};
 const options={ctx,store,control:{},handUrlBase:'http://127.0.0.1:8787/hand/',sourceCases:catalog};
 const c=await createDshMahjongGameController(options);
 try{
  await c.openSource({sessionId:'s',caseId:'test-case',eventIndex:0,seat:0});
  const before=c.qnaSnapshot('s');await c.stepSource({sessionId:'s',eventIndex:1,seat:2});
  assert.equal(c.state('s').game.historyIndex,1);assert.equal(c.state('s').game.sourceReplay.seat,2);assert.deepEqual(c.qnaSnapshot('s'),before);
  await assert.rejects(c.stepSource({sessionId:'s',eventIndex:999,seat:2}));assert.equal(c.state('s').game.historyIndex,1);
  const restoredStore=createMemorySessionGameStore(store.list()),restored=await createDshMahjongGameController({...options,store:restoredStore});
  assert.equal(restored.state('s').game.historyIndex,1);assert.deepEqual(restored.qnaSnapshot('s'),before);await restored.dispose();
  await assert.rejects(c.openSource({sessionId:'s',caseId:'test-case',eventIndex:1,seat:2}),{code:'HISTORY_STEP_LOCKED'});
  await c.openSource({sessionId:'q',caseId:'test-case',eventIndex:1,seat:2});assert.equal(c.qnaSnapshot('q').frame.eventIndex,1);
  assert.equal(c.qnaSnapshot('q').frame.perspective.seat,2);assert.equal(c.state('q').game.canPractice,false);
 }finally{await c.dispose();await rm(directory,{recursive:true});}
});
