import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {compileSourceRecord} from '../lib/source-record.js';
import {sourceEditDiagnostics} from '../lib/source-edit-diagnostics.js';

const fixture=()=>{
  const v=compileSourceRecord(JSON.parse(fs.readFileSync(new URL('./fixtures/s6-source-hand.json',import.meta.url))));
  assert.equal(v.ok,true);return {record:v.record,data:v.data};
};
function helpers(){
  const source=fs.readFileSync(new URL('../client.js',import.meta.url),'utf8');
  const start=source.indexOf('    function editDrawPair('),end=source.indexOf('    function editorLayout(',start);
  assert.ok(start>=0&&end>start);
  return vm.runInNewContext(`(()=>{${source.slice(start,end)};return {editDrawPair,editDrawChoice,editRestoredDraft,editDraftWriter};})()`);
}
test('spring draw-only mistake points from failed hu back to changed draw and related discard, with exact tile differences',()=>{
  const base=fixture(),draft=structuredClone(base.record);draft.events[48].tile='5m';
  const result=compileSourceRecord(draft),d=sourceEditDiagnostics(base,result);
  assert.equal(result.ok,false);assert.equal(result.issues[0].code,'INVALID_HU');assert.equal(d.failure.eventId,'event-70');
  assert.deepEqual(d.changes.map(x=>[x.eventId,x.fields]),[['event-49',['tile']]]);
  assert.deepEqual(d.suspectedEvents.map(x=>x.eventId),['event-49','event-50']);
  assert.deepEqual(d.handDifferences.map(x=>({seat:x.seat,more:x.more,less:x.less})),[{seat:3,more:['5m'],less:['7m']}]);
  assert.match(d.notice,/不代表已确定错误/);
  draft.events[49].tile='5m';const fixed=compileSourceRecord(draft);assert.equal(fixed.ok,true);assert.equal(sourceEditDiagnostics(base,fixed),null);
});
test('diagnostics match stable IDs across insertion and deletion, never treating shifted sequence numbers as all changed',()=>{
  const base=fixture(),draft=structuredClone(base.record);
  draft.events.splice(49,0,{...draft.events[49],id:'inserted',action:'draw',tile:'1m'});
  const d=sourceEditDiagnostics(base,compileSourceRecord(draft));
  assert.equal(d.failure.eventId,'inserted');assert.deepEqual(d.changes.map(x=>x.eventId),['inserted']);assert.equal(d.handDifferences.length,0);
  const removed=structuredClone(base.record);removed.events.splice(48,1);
  const rd=sourceEditDiagnostics(base,compileSourceRecord(removed));
  assert.deepEqual(rd.changes.map(x=>[x.eventId,x.fields]),[['event-49',['deleted']]]);
  assert.ok(rd.changes[0].before);assert.equal(rd.changes[0].after,null);
});
test('setup, early fifth tile and malformed input retain original validation failures without diagnostic exceptions',()=>{
  const base=fixture();
  const setup=structuredClone(base.record);setup.players[3].openingHand[0]='1m';
  assert.equal(sourceEditDiagnostics(base,compileSourceRecord(setup)).setupChanges[0].seat,3);
  const fifth=structuredClone(base.record);fifth.events[48].tile='2s';
  const v=compileSourceRecord(fifth);assert.equal(v.ok,false);assert.equal(v.issues[0].code,'FIFTH_TILE');
  const d=sourceEditDiagnostics(base,v);assert.equal(d.failure.eventId,'event-49');assert.equal(d.handDifferences.length,0);
  for(const input of [null,{}, {events:[null]}, {events:[],players:{}}, {events:[],players:[null]}]){
    const result=compileSourceRecord(input);assert.equal(result.ok,false);assert.doesNotThrow(()=>sourceEditDiagnostics(base,result));
  }
});
test('unrelated changed player stays in change list without being asserted as the cause of another player error',()=>{
  const base=fixture(),draft=structuredClone(base.record);
  draft.events[48].tile='5m';draft.events[0].atSeconds+=.1;
  const d=sourceEditDiagnostics(base,compileSourceRecord(draft));
  assert.deepEqual(d.changes.map(x=>x.eventId),['event-1','event-49']);
  assert.deepEqual(d.suspectedEvents.map(x=>x.eventId),['event-49','event-50']);
});
test('pair choice never changes the record before selection; only-draw and both-draw-discard are separate options',()=>{
  const {editDrawPair,editDrawChoice}=helpers(),base=fixture().record,before=JSON.stringify(base);
  const pair=editDrawPair(base,'event-49','5m');assert.equal(pair.discardId,'event-50');assert.equal(JSON.stringify(base),before);
  const only=editDrawChoice(base,pair,false);assert.equal(only.events[48].tile,'5m');assert.equal(only.events[49].tile,'7m');
  const both=editDrawChoice(base,pair,true);assert.equal(both.events[48].tile,'5m');assert.equal(both.events[49].tile,'5m');
  assert.equal(JSON.stringify(base),before);assert.equal(compileSourceRecord(both).ok,true);
  assert.deepEqual(base.events.filter((e,i)=>JSON.stringify(e)!==JSON.stringify(both.events[i])).map(e=>e.id),['event-49','event-50']);
});
test('drawn tile can be discarded differently; kong interruption, unchanged tile and stale pair cannot silently update a later move',()=>{
  const {editDrawPair,editDrawChoice}=helpers(),base=fixture().record;
  const pair=editDrawPair(base,'event-6','6s');assert.equal(pair.discardTile,'2p');
  assert.equal(editDrawChoice(base,pair,false).events[6].tile,'2p');
  assert.equal(editDrawPair(base,'event-49','7m'),null);assert.equal(editDrawPair(base,'event-49',''),null);
  const interrupted=structuredClone(base);interrupted.events[49].action='gang_added';assert.equal(editDrawPair(interrupted,'event-49','5m'),null);
  const stale=structuredClone(base);stale.events[6].tile='3p';assert.throws(()=>editDrawChoice(stale,pair,true),/步骤已变化/);assert.equal(stale.events[5].tile,base.events[5].tile);
  const replacement=structuredClone(base);replacement.events[48].action='draw_replacement';assert.equal(editDrawPair(replacement,'event-49','5m').discardId,'event-50');
});
test('undoing all edits overrides the old server draft, including a delayed server timestamp',()=>{
  const {editRestoredDraft}=helpers(),record=fixture().record,changed=structuredClone(record);changed.events[48].tile='5m';
  const server={record:changed,reason:'纠正牌谱',at:'2030-01-01'},data={record,draft:server};
  assert.equal(editRestoredDraft(data,{record,reason:'纠正牌谱',at:'2026-01-01'}),null);
  assert.equal(editRestoredDraft(data,null),server);
  const latest={record:changed,reason:'核对中',at:'2026-01-01'};assert.equal(editRestoredDraft(data,latest),latest);
  assert.equal(editRestoredDraft({record,draft:null},null),null);
});
test('draft writes are serialized so a slow older edit cannot overwrite undo; a failed write does not block later saves',async()=>{
  const {editDraftWriter}=helpers(),record=fixture().record,changed=structuredClone(record);changed.events[48].tile='5m';
  let release,stored;const calls=[];
  const write=editDraftWriter(async payload=>{calls.push(payload);if(calls.length===1)await new Promise(resolve=>release=resolve);stored=payload;return payload;});
  const old=write(changed),undo=write(record);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls.length,1);release();await Promise.all([old,undo]);assert.equal(stored,record);assert.deepEqual(calls,[changed,record]);
  let attempts=0;const retry=editDraftWriter(async payload=>{if(attempts++===0)throw new Error('offline');return payload;});
  const failed=retry(changed);await assert.rejects(failed,/offline/);assert.equal(await retry(record),record);
});
