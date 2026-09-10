import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {normalizeSourceRecord,compileSourceRecord,sortTiles} from '../lib/source-record.js';
import {createSourceCaseCatalog} from '../lib/source-cases.js';
import {createSourceEditorStore} from '../lib/source-editor-store.js';
import {buildFrame} from '../lib/source-frame.js';
import {createDshMahjongGameController} from '../lib/game-controller.js';
import {createMemorySessionGameStore} from '../lib/session-game-store.js';
const s6=()=>normalizeSourceRecord(JSON.parse(fs.readFileSync(new URL('./fixtures/s6-source-hand.json',import.meta.url))));
const check=r=>{const v=compileSourceRecord(r);assert.equal(v.ok,true,JSON.stringify(v.issues));return v;};
function smallHand(){
 const pair=s=>[1,2,3,4,5,6].flatMap(n=>[n+s,n+s]).concat('7'+s);
 const opening=[['8m','8m','8m','9m','9m','9m','8p','8p','8p','9p','9p','9p','8s','8s'],pair('m'),pair('p'),pair('s')];
 const transfers=[['1m','1m','2m'],['1p','1p','2p'],['1s','1s','2s'],['8m','8m','8m']].map((tiles,fromSeat)=>({fromSeat,toSeat:(fromSeat+1)%4,tiles}));
 const dealt=structuredClone(opening);for(const t of transfers){for(const tile of t.tiles)dealt[t.toSeat].splice(dealt[t.toSeat].indexOf(tile),1);}for(const t of transfers)dealt[t.fromSeat].push(...t.tiles);
 return normalizeSourceRecord({schema:'dsh-mahjong.source-hand.v1',caseId:'small-hand',version:1,title:'独立七对验收样例',dealer:0,players:['甲','乙','丙','丁'].map((name,seat)=>({name,seat,dingque:seat===3?'m':'s',initialHandPoints:100,openingHand:opening[seat],dealtHand:dealt[seat]})),exchange:{direction:'next_in_turn_order',sourceRange:[0,0],transfers},events:[{seat:0,action:'discard',tile:'8s'},...[1,2,3].flatMap(s=>[{seat:s,action:'draw',tile:'7'+'mps'[s-1]},{seat:s,action:'hu_tsumo',tile:'7'+'mps'[s-1],scoreTransfers:[{fromSeat:0,toSeat:s,points:s*10}]}])].map((e,i)=>({...e,seq:i+1,atSeconds:i+1})),observations:[]});
}
function setup(record=smallHand(),fault){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'mahjong-editor-')),cases=path.join(root,'cases'),directory=path.join(root,'source-records');fs.mkdirSync(cases);fs.mkdirSync(directory);
 const result=check(record),sourcePath=path.join(root,'record.json'),caseId=record.caseId;
 fs.writeFileSync(sourcePath,JSON.stringify(result.record,null,2)+'\n');const diskHash=createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex');
 const caseFile=path.join(cases,caseId+'.json');fs.writeFileSync(caseFile,JSON.stringify({schema:'dsh-mahjong.source-case.v1',caseId,title:record.title,keyIndex:0,keySeat:0,notice:'待视频核对',lessons:[],record:result.record,data:result.data,editMeta:{sourceFileHash:diskHash}}));
 fs.writeFileSync(path.join(directory,caseId+'.json'),JSON.stringify({recordPath:sourcePath}));
 const catalog=createSourceCaseCatalog(cases),store=createSourceEditorStore({catalog,directory,fault});
 return {root,cases,directory,sourcePath,caseFile,catalog,store,caseId,clientId:'test-client-1',cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};
}
function commitArgs(f,g,record,operationId='test-operation-1'){return {caseId:f.caseId,clientId:f.clientId,record,baseHash:g.baseHash,diskHash:g.diskHash,operationId};}

test('S6 retains all three winners, 88 snapshots, corrected tiles, scores and 108 physical tiles',()=>{
 const result=check(s6()),data=result.data,last=data.snapshots.at(-1);
 assert.equal(data.snapshots.length,88);assert.deepEqual(last.won,[0,3,2]);assert.deepEqual(last.scores,[4,-3,0,-1]);assert.equal(result.record.events[43].tile,'7m');assert.equal(result.record.events[22].tile,'8s');
 for(let i=0;i<data.snapshots.length;i++)for(let seat=0;seat<4;seat++){const frame=buildFrame(data,i,seat);assert.equal(new Set(frame.view.entries.filter(([k])=>k==='things').map(([,id])=>id)).size,108);}
 assert.equal(result.record.unplayedWall.orderKnown,false);assert.equal(result.record.unplayedWall.count,19);
});
test('linked draft can be saved while invalid, repaired in a second edit and committed once; diagnostics use the explicit base version',async()=>{
 const f=setup(s6()),sessionStore=createMemorySessionGameStore(),ctx={agents:{get:id=>({id,session:{header:{id},append(){}}}),list:()=>[]},on:()=>()=>{}};
 const controller=await createDshMahjongGameController({ctx,store:sessionStore,control:{},handUrlBase:'http://127.0.0.1:8787/hand/',sourceCases:f.catalog,sourceEditorDirectory:f.directory});
 try{
  await controller.openSource({sessionId:'linked-test',caseId:f.caseId,eventIndex:51,seat:3});
  const g=f.store.get(f.caseId,f.clientId),r=structuredClone(g.record),original=fs.readFileSync(f.sourcePath,'utf8');r.events[48].tile='5m';
  f.store.saveDraft({...commitArgs(f,g,r),selection:'event-49'});
  const invalid=await controller.sourceEdit('validate',{sessionId:'linked-test',record:r,eventIndex:51,baseHash:g.baseHash});
  assert.equal(invalid.ok,false);assert.equal(invalid.preview,null);assert.equal(invalid.partialSnapshots,undefined);assert.equal(invalid.diagnostics.failure.seq,70);assert.deepEqual(invalid.diagnostics.handDifferences[0].more,['5m']);
  assert.equal(f.store.commit(commitArgs(f,g,r)).saved,false);assert.equal(fs.readFileSync(f.sourcePath,'utf8'),original);
  const reloaded=createSourceEditorStore({catalog:f.catalog,directory:f.directory}).get(f.caseId,f.clientId);assert.equal(reloaded.draft.record.events[48].tile,'5m');
  const repaired=structuredClone(reloaded.draft.record);repaired.events[49].tile='5m';
  const saved=await controller.sourceEdit('commit',{sessionId:'linked-test',...commitArgs(f,g,repaired,'linked-success'),selectedEventId:'event-50'});
  assert.equal(saved.saved,true);assert.equal(saved.version,g.record.version+1);assert.equal(saved.state.game.historyIndex,52);assert.deepEqual(saved.changes.map(x=>x.eventId),['event-49','event-50']);
  const historical=await controller.sourceEdit('validate',{sessionId:'linked-test',record:r,baseHash:g.baseHash});assert.deepEqual(historical.diagnostics.changes.map(x=>x.eventId),['event-49']);
  const current=await controller.sourceEdit('validate',{sessionId:'linked-test',record:r,baseHash:saved.hash});assert.deepEqual(current.diagnostics.changes.map(x=>x.eventId),['event-50']);
 }finally{await controller.dispose();f.cleanup();}
});
test('paired corrections propagate into river and wall, while a lone impossible discard fails at event 44',()=>{
 const r=s6();r.events[42].tile='5m';r.events[43].tile='5m';const before=check(r);
 r.events[43].tile='7m';const invalid=compileSourceRecord(r);assert.equal(invalid.ok,false);assert.equal(invalid.issues[0].seq,44);assert.equal(invalid.issues[0].code,'MISSING_TILE');
 r.events[42].tile='7m';const after=check(r);assert.notDeepEqual(before.record.unplayedWall.tileMultiset,after.record.unplayedWall.tileMultiset);
 assert.deepEqual(before.data.snapshots[46].hands[0],after.data.snapshots[46].hands[0]);assert.notDeepEqual(before.data.snapshots[46].rivers[0],after.data.snapshots[46].rivers[0]);
 r.events[21].tile='1s';r.events[22].tile='1s';const old=check(r);r.events[21].tile='8s';r.events[22].tile='8s';const corrected=check(r);assert.deepEqual(old.data.snapshots[25].hands[2],corrected.data.snapshots[25].hands[2]);
});
test('unrelated legal case has seven events, different scores and unknown tail, without S6 constants',()=>{
 const sample=smallHand();sample.verification={drawCount:99,winCount:1,actionCount:84};const result=check(sample);assert.equal(result.record.verification.drawCount,3);assert.equal(result.record.verification.winCount,3);assert.equal(result.record.verification.actionCount,7);assert.equal(result.data.snapshots.length,11);assert.deepEqual(result.data.snapshots.at(-1).won,[1,2,3]);assert.deepEqual(result.data.snapshots.at(-1).scores,[40,110,120,130]);assert.equal(result.record.unplayedWall.count,52);
 const r=smallHand();r.events[2].tile='8m';assert.equal(compileSourceRecord(r).issues[0].code,'DRAWN_HU');
});
test('initial hand / exchange discrepancy is explicit and no input is silently repaired',()=>{
 const r=s6();r.players[0].openingHand[0]='9s';const bytes=JSON.stringify(r),bad=compileSourceRecord(r);assert.equal(bad.issues[0].code,'OPENING_MISMATCH');assert.ok(bad.issues[0].expected);assert.equal(JSON.stringify(r),bytes);
 const s=s6();s.exchange.transfers[0].tiles[0]='1m';assert.equal(compileSourceRecord(s).ok,false);
 assert.deepEqual(sortTiles(['2m','1s','2p','1s']),['1s','1s','2p','2m']);
});
test('insert/delete preserves event IDs and claim references; removed draw fails then reinsertion recovers',()=>{
 const r=s6(),claim=r.events.find(e=>e.triggerEventId),originalId=claim.triggerEventId,draw=r.events.splice(42,1)[0];
 assert.equal(normalizeSourceRecord(r).events.find(e=>e.id===claim.id).triggerEventId,originalId);assert.equal(compileSourceRecord(r).ok,false);r.events.splice(42,0,draw);check(r);
 const discardIndex=r.events.findIndex(e=>e.id===originalId);r.events[discardIndex].id='replacement-id';assert.equal(compileSourceRecord(r).issues[0].code,'CLAIM_REFERENCE');
});
test('independent observed tile mismatch warns despite internally valid replay',()=>{
 const r=s6();r.observations=[{id:'obs-1',eventId:'event-23',seat:2,area:'river',scope:'partial',tiles:['1s']}];const v=check(r);assert.equal(v.observationResults[0].status,'mismatch');assert.match(v.record.verification.videoAuditStatus,/未完成/);
 r.observations[0].tiles=['8s'];assert.equal(check(r).observationResults[0].status,'match');
});
test('draft persists invalid record across store reconstruction, never changes live source',()=>{
 const f=setup();try{const g=f.store.get(f.caseId,f.clientId),r=structuredClone(g.record),before=fs.readFileSync(f.sourcePath,'utf8');r.events[0].tile='7m';f.store.saveDraft({...commitArgs(f,g,r),selection:'event-1',reason:'补记原视频依据'});
 const restarted=createSourceEditorStore({catalog:f.catalog,directory:f.directory});assert.equal(restarted.get(f.caseId,f.clientId).draft.record.events[0].tile,'7m');assert.equal(restarted.get(f.caseId,f.clientId).draft.reason,'补记原视频依据');assert.equal(fs.readFileSync(f.sourcePath,'utf8'),before);assert.equal(restarted.commit(commitArgs(f,g,r)).saved,false);
 f.store.saveDraft({...commitArgs(f,g,g.record),reason:'纠正牌谱'});assert.equal(restarted.get(f.caseId,f.clientId).draft,null);assert.equal(fs.readFileSync(f.sourcePath,'utf8'),before);
 }finally{f.cleanup();}
});
test('atomic commit, idempotency, history and restore preserve intermediate revisions',()=>{
 const f=setup();try{const g=f.store.get(f.caseId,f.clientId),r=structuredClone(g.record);r.players[0].name='甲更正';const args=commitArgs(f,g,r),saved=f.store.commit(args);assert.equal(saved.saved,true);assert.equal(f.store.commit(args).hash,saved.hash);
 assert.equal(JSON.parse(fs.readFileSync(f.sourcePath)).players[0].name,'甲更正');assert.equal(f.catalog.get(f.caseId).data.players[0].name,'甲更正');assert.equal(f.catalog.get(f.caseId,g.baseHash).data.players[0].name,'甲');assert.equal(f.catalog.get(f.caseId).analysisStatus,'needs-review');
 const fresh=f.store.get(f.caseId,f.clientId),restored=f.store.restore({...commitArgs(f,fresh,null,'restore-operation-1'),restoreHash:g.baseHash});assert.equal(restored.version,3);assert.equal(f.catalog.get(f.caseId).data.players[0].name,'甲');assert.equal(f.store.versions(f.caseId).length,3);
 }finally{f.cleanup();}
});
test('concurrent windows and external JSON cannot be overwritten, explicit reread permits import',()=>{
 const f=setup();try{const a=f.store.get(f.caseId,f.clientId),b=f.store.get(f.caseId,'other-client'),r=structuredClone(a.record);r.players[0].name='新昵称';f.store.commit(commitArgs(f,a,r));assert.throws(()=>f.store.commit(commitArgs(f,b,r,'other-operation-1')),{code:'SOURCE_EDIT_CONFLICT'});
 const current=f.store.get(f.caseId,f.clientId);const external=JSON.parse(fs.readFileSync(f.sourcePath));external.players[1].name='外部更正';fs.writeFileSync(f.sourcePath,JSON.stringify(external));assert.throws(()=>f.store.commit(commitArgs(f,current,r,'external-operation')),{code:'SOURCE_EDIT_CONFLICT'});
 const reopen=f.store.get(f.caseId,f.clientId);assert.equal(reopen.externalChanged,true);assert.throws(()=>f.store.commit(commitArgs(f,reopen,r,'external-overwrite')),{code:'SOURCE_EDIT_CONFLICT'});
 const disk=f.store.reread(f.caseId);assert.equal(f.store.commit({...commitArgs(f,reopen,disk.record,'import-operation-1'),diskHash:disk.diskHash}).saved,true);assert.equal(f.catalog.get(f.caseId).data.players[1].name,'外部更正');
 }finally{f.cleanup();}
});
for(const stage of ['beforeSource','beforeCase','afterCase'])test('injected failure '+stage+' retains a complete usable version',()=>{
 const f=setup(undefined,s=>{if(s===stage)throw new Error('injected write failure');});try{const g=f.store.get(f.caseId,f.clientId),r=structuredClone(g.record);r.players[0].name='更正';if(stage==='afterCase')assert.equal(f.store.commit(commitArgs(f,g,r)).saved,true);else assert.throws(()=>f.store.commit(commitArgs(f,g,r)),{code:'SAVE_FAILED'});
 const source=JSON.parse(fs.readFileSync(f.sourcePath)),c=JSON.parse(fs.readFileSync(f.caseFile));assert.equal(source.players[0].name,c.record.players[0].name);assert.equal(c.record.players[0].name,c.data.players[0].name);assert.equal(c.record.players[0].name,stage==='afterCase'?'更正':'甲');check(source);
 }finally{f.cleanup();}
});
test('controller saves new frame at same event and seat while old Q&A stays on archived version',async()=>{
 const f=setup(),sessionStore=createMemorySessionGameStore(),ctx={agents:{get:id=>({id,session:{header:{id},append(){}}}),list:()=>[]},on:()=>()=>{}};
 const controller=await createDshMahjongGameController({ctx,store:sessionStore,control:{},handUrlBase:'http://127.0.0.1:8787/hand/',sourceCases:f.catalog,sourceEditorDirectory:f.directory});
 try{await controller.openSource({sessionId:'test-session',caseId:f.caseId,eventIndex:3,seat:2});const q=controller.qnaSnapshot('test-session'),g=await controller.sourceEdit('get',{sessionId:'test-session',clientId:f.clientId}),r=structuredClone(g.record);r.players[0].name='更正';
 const result=await controller.sourceEdit('commit',{sessionId:'test-session',...commitArgs(f,g,r),selectedEventId:'event-1'});assert.equal(result.state.game.historyIndex,3);assert.equal(result.state.game.sourceReplay.seat,2);assert.notEqual(result.state.game.sourceReplay.sourceHash,g.baseHash);assert.deepEqual(controller.qnaSnapshot('test-session'),q);
 const preview=await controller.sourceEdit('validate',{sessionId:'test-session',record:r,eventIndex:4});assert.equal(preview.preview.perspective.seat,2);assert.equal(preview.preview.eventIndex,4);
 }finally{await controller.dispose();f.cleanup();}
});

test('serialized canonical source regenerates identical replay bytes',()=>{
 const first=check(s6()),record=JSON.parse(JSON.stringify(first.record)),second=check(record);
 assert.equal(JSON.stringify(first.data),JSON.stringify(second.data));
});
test('invalid winning shape is rejected independently of the drawn tile',()=>{
 const r=smallHand();for(const key of ['openingHand','dealtHand'])r.players[1][key][r.players[1][key].indexOf('7m')]='8m';
 assert.equal(compileSourceRecord(r).issues[0].code,'INVALID_HU');
});
test('concealed kong requires a replacement draw and retains four meld tiles',()=>{
 const r=smallHand();for(const key of ['openingHand','dealtHand']){const hand=r.players[0][key];hand[hand.indexOf('8s')]='8m';hand[hand.indexOf('8s')]='4p';}
 r.events=[{seat:0,action:'gang_concealed',tile:'8m'},{seat:0,action:'draw_replacement',tile:'9m'},{seat:0,action:'discard',tile:'4p'}].map((e,i)=>({...e,id:'kong-'+i,seq:i+1,atSeconds:i+1}));
 const v=compileSourceRecord(r,{requireComplete:false});assert.equal(v.ok,true,JSON.stringify(v.issues));assert.equal(v.data.snapshots.at(-1).melds[0][0].gangType,'an');assert.equal(v.data.snapshots.at(-1).melds[0][0].ids.length,4);for(let i=0;i<v.data.snapshots.length;i++)buildFrame(v.data,i,0);
 r.events[1].action='draw';assert.equal(compileSourceRecord(r,{requireComplete:false}).issues[0].code,'TURN');
});
test('added kong is linked to its original peng and uses the real hand runtime gang type',()=>{
 const r=smallHand();for(const key of ['openingHand','dealtHand']){const hand=r.players[0][key];hand[hand.indexOf('8s')]='3m';hand[hand.indexOf('8s')]='4p';}
 r.events=[{seat:0,action:'discard',tile:'3m'}, {seat:1,action:'peng',tile:'3m',fromSeat:0,triggerEventId:'add-0'}, {seat:1,action:'discard',tile:'7m'},
 {seat:2,action:'draw',tile:'8s'},{seat:2,action:'discard',tile:'8s'}, {seat:3,action:'draw',tile:'9m'},{seat:3,action:'discard',tile:'9m'},
 {seat:0,action:'draw',tile:'9s'},{seat:0,action:'discard',tile:'9s'}, {seat:1,action:'draw',tile:'3m'}, {seat:1,action:'gang_added',tile:'3m',meldEventId:'add-1'},
 {seat:1,action:'draw_replacement',tile:'8s'},{seat:1,action:'discard',tile:'8s'}].map((e,i)=>({...e,id:'add-'+i,seq:i+1,atSeconds:i+1}));
 const v=compileSourceRecord(r,{requireComplete:false});assert.equal(v.ok,true,JSON.stringify(v.issues));assert.equal(v.data.snapshots.at(-1).melds[1][0].gangType,'add');assert.equal(v.data.snapshots.at(-1).melds[1][0].ids.length,4);
 for(let i=0;i<v.data.snapshots.length;i++)for(let seat=0;seat<4;seat++)buildFrame(v.data,i,seat);
 r.events[10].meldEventId='missing';assert.equal(compileSourceRecord(r,{requireComplete:false}).issues[0].code,'MELD_REFERENCE');
});
