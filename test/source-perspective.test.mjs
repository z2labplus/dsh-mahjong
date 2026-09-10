import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {compileSourceRecord} from '../lib/source-record.js';
import {createSourceCaseCatalog,sourceActorSeat,sourcePerspective} from '../lib/source-cases.js';
import {createDshMahjongGameController} from '../lib/game-controller.js';
import {createMemorySessionGameStore,createHarnessSessionGameStore} from '../lib/session-game-store.js';

function fixture(){
  const result=compileSourceRecord(JSON.parse(fs.readFileSync(new URL('./fixtures/s6-source-hand.json',import.meta.url))));
  assert.equal(result.ok,true,JSON.stringify(result.issues));
  return {schema:'dsh-mahjong.source-case.v1',caseId:result.record.caseId,title:result.record.title,record:result.record,data:result.data,lessons:[],keyIndex:8,keySeat:3,notice:'测试'};
}
function setup(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-follow-')),cases=path.join(root,'cases'),directory=path.join(root,'source-records');fs.mkdirSync(cases);fs.mkdirSync(directory);
  const c=fixture(),sourcePath=path.join(root,'record.json');fs.writeFileSync(sourcePath,JSON.stringify(c.record));
  c.editMeta={sourceFileHash:createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex')};
  fs.writeFileSync(path.join(cases,c.caseId+'.json'),JSON.stringify(c));fs.writeFileSync(path.join(directory,c.caseId+'.json'),JSON.stringify({recordPath:sourcePath}));
  return {c,root,directory,sourcePath,catalog:createSourceCaseCatalog(cases),cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};
}
const ctx={agents:{get:id=>({id,session:{header:{id},append(){}}}),list:()=>[]},on:()=>()=>{}};
const options=f=>({ctx,store:createMemorySessionGameStore(),control:{},handUrlBase:'http://127.0.0.1:8787/hand/',sourceCases:f.catalog,sourceEditorDirectory:f.directory});

test('follow uses all 84 recorded actors through forward, reverse and seek; draws stay separately visible',()=>{
  const f=setup();try{
    const {c,catalog}=f,indices=c.data.snapshots.map((_,i)=>i);
    assert.equal(indices.length,88);
    for(const index of [...indices,...indices.toReversed(),8,46,69,72,86,0,87]){
      const s=c.data.snapshots[index],expected=index<3?0:index===87?2:c.record.events[index-3].seat;
      const meta=catalog.perspective({caseId:c.caseId,eventIndex:index,seat:1,viewMode:'follow'}),view=catalog.view(meta);
      assert.equal(meta.seat,expected,`${index}: ${s.title}`);assert.equal(meta.fixedSeat,1);assert.equal(view.followAvailable,true);
      assert.equal(view.frame.perspective.seat,expected);
      const entries=view.frame.view.entries,things=new Map(entries.filter(([k])=>k==='things').map(([,id,v])=>[id,v]));
      for(const [k,id,face] of entries)if(k==='tileFaceSelf'&&face!==null)assert.ok(things.get(id).slotName.endsWith('@'+expected));
      if(s.drawn[expected]!=null)assert.equal(things.get(s.drawn[expected]).slotName,'hand.extra@'+expected);
    }
    assert.equal(sourceActorSeat(c,8),3); // 春光摸五条：screen was previously fixed on 弟弟.
    assert.equal(sourceActorSeat(c,9),3); // His discard stays with 春光, even though turn is now 龙公子.
    assert.equal(c.data.snapshots[9].turn,0);assert.equal(sourceActorSeat(c,10),2); // 周猩猩碰二筒，跳过原本的下一家。
    assert.deepEqual(c.record.events.filter(e=>e.action.startsWith('hu_')).map(e=>sourceActorSeat(c,e.seq+2)),[0,3,2]);
  }finally{f.cleanup();}
});

test('stable event IDs survive reordering; claims follow claimant, missing actor data never guesses from turn',()=>{
  const c=fixture(),index=8,s=c.data.snapshots[index],event=c.record.events.find(e=>e.id===s.eventId);
  c.record.events.reverse();assert.equal(sourceActorSeat(c,index),3);
  for(const action of ['peng','gang_exposed','gang_concealed','gang_added','hu_ron','hu_tsumo']){
    event.action=action;event.seat=2;s.turn=1;assert.equal(sourceActorSeat(c,index),2);
  }
  delete s.eventId;assert.equal(sourceActorSeat(c,index),2); // Older compiled snapshots carry seq.
  delete c.record;
  assert.equal(sourceActorSeat(c,index),null);
  assert.throws(()=>sourcePerspective(c,{eventIndex:index,seat:1,viewMode:'follow'}),/缺少/);
  assert.equal(sourcePerspective(c,{eventIndex:index,seat:1}).seat,1);
});

test('fixed choice survives follow mode, navigation, restart and new step Q&A; invalid requests do not mutate',async()=>{
  const f=setup(),o=options(f),controller=await createDshMahjongGameController(o);
  try{
    await controller.openSource({sessionId:'s',caseId:f.c.caseId,eventIndex:8,seat:1});const q=controller.qnaSnapshot('s');
    await controller.stepSource({sessionId:'s',eventIndex:8,seat:1,viewMode:'follow'});
    assert.equal(controller.state('s').game.sourceReplay.seat,3);
    for(const index of [9,10,69,72,86,87,8])await controller.stepSource({sessionId:'s',eventIndex:index,seat:3});
    assert.equal(controller.state('s').game.sourceReplay.fixedSeat,1);assert.deepEqual(controller.qnaSnapshot('s'),q);
    const saved=o.store.list(),restored=await createDshMahjongGameController({...o,store:createMemorySessionGameStore(saved)});
    assert.equal(restored.state('s').game.sourceReplay.viewMode,'follow');assert.equal(restored.state('s').game.historyFrame.perspective.seat,3);await restored.dispose();
    const before=controller.state('s');
    for(const invalid of [{viewMode:'omniscient'},{seat:4},{eventIndex:999}])await assert.rejects(controller.stepSource({sessionId:'s',eventIndex:8,seat:3,...invalid}));
    assert.deepEqual(controller.state('s'),before);
    await controller.stepSource({sessionId:'s',eventIndex:10,viewMode:'fixed',seat:3});
    assert.equal(controller.state('s').game.sourceReplay.seat,1);
    await controller.stepSource({sessionId:'s',eventIndex:8,seat:2});assert.equal(controller.state('s').game.sourceReplay.seat,2);
    await controller.openSource({sessionId:'q',caseId:f.c.caseId,eventIndex:8,seat:2,viewMode:'follow'});
    assert.equal(controller.qnaSnapshot('q').frame.perspective.seat,3);assert.equal(controller.state('q').game.sourceReplay.fixedSeat,2);
    await controller.stepSource({sessionId:'q',eventIndex:10,seat:3});assert.equal(controller.state('q').game.historyFrame.perspective.seat,2);
    assert.equal(controller.qnaSnapshot('q').frame.perspective.seat,3);assert.equal(controller.qnaSnapshot('q').frame.eventIndex,8);
  }finally{await controller.dispose();f.cleanup();}
});

test('Harness persistence schema retains mode and remembered fixed seat, including old sessions',async()=>{
  const rows=new Map();let schema;
  const store=await createHarnessSessionGameStore({storageDomain:{open:async spec=>{schema=spec.tables.sessions;return {table:()=>({get:k=>rows.get(k),entries:()=>rows.entries(),put:(k,v)=>rows.set(k,schema.parse(v))}),close(){}};}}},{domainRuntime:{z,defineDomain:v=>v,domainTable:v=>v}});
  const sourceReplay={caseId:'s',sourceHash:'hash',eventIndex:8,seat:3,fixedSeat:1,viewMode:'follow',lesson:null,questionIndex:0,questionSeat:1,questionLesson:null};
  await store.put('s',{schemaVersion:1,sessionId:'s',phase:'active',locked:true,sourceReplay});
  assert.deepEqual(store.get('s').sourceReplay,sourceReplay);
  const old={...sourceReplay};delete old.viewMode;delete old.fixedSeat;
  await store.put('old',{schemaVersion:1,sessionId:'old',phase:'active',locked:true,sourceReplay:old});assert.deepEqual(store.get('old').sourceReplay,old);
  await assert.rejects(store.put('s',{schemaVersion:1,sessionId:'s',phase:'active',locked:true,sourceReplay:{...sourceReplay,viewMode:'other'}}));
  assert.deepEqual(store.get('s').sourceReplay,sourceReplay);await store.close();
});

test('correction preview and commit keep following selected event, and preserve the previous Q&A',async()=>{
  const f=setup(),controller=await createDshMahjongGameController(options(f));
  try{
    await controller.openSource({sessionId:'s',caseId:f.c.caseId,eventIndex:4,seat:1,viewMode:'follow'});const q=controller.qnaSnapshot('s');
    const preview=await controller.sourceEdit('validate',{sessionId:'s',record:f.c.record,eventIndex:8});assert.equal(preview.ok,true);assert.equal(preview.preview.perspective.seat,3);
    const g=await controller.sourceEdit('get',{sessionId:'s',clientId:'follow-test'}),record=structuredClone(g.record);record.players[3].name='春光更正';
    const result=await controller.sourceEdit('commit',{sessionId:'s',clientId:'follow-test',record,baseHash:g.baseHash,diskHash:g.diskHash,operationId:'follow-commit-1',selectedEventId:'event-6'});
    assert.equal(result.saved,true);assert.equal(result.state.game.historyIndex,8);assert.equal(result.state.game.sourceReplay.viewMode,'follow');assert.equal(result.state.game.sourceReplay.seat,3);assert.equal(result.state.game.sourceReplay.fixedSeat,1);assert.deepEqual(controller.qnaSnapshot('s'),q);
  }finally{await controller.dispose();f.cleanup();}
});
