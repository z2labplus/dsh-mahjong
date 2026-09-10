import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {issueAccess} from '../src/auth.ts';
import {createServiceControl} from '../../lib/service-control.js';
const record=JSON.parse(readFileSync(new URL('../../test/fixtures/s6-challenge-v6.json',import.meta.url),'utf8'));
test('challenge worker creation, capability negotiation and owner-scoped recovery hide all future data',async()=>{
 const secret='challenge-test-secret'.repeat(4);
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:fileURLToPath(new URL('../dist/worker.js',import.meta.url)),compatibilityDate:'2026-09-01',compatibilityFlags:['nodejs_compat'],bindings:{SERVICE_SECRET:secret},durableObjects:{TABLES:{className:'MahjongTable',useSQLite:true},DIRECTORY:{className:'MahjongDirectory',useSQLite:true}},port:0}));
 try{
  const origin=(await mf.ready).origin,control=createServiceControl({url:origin});assert.ok((await control.capabilities()).features.includes('takeover-ready-v1'));
  const token=await issueAccess(secret,{v:1,kind:'owner',tenant:'challenge-test',owner:'alice',exp:Date.now()+60000});
  const created=await control.startChallenge({record,keySeq:75,seat:2,seed:20260910,ownerApiToken:token});
  assert.equal(created.mode,'challenge');assert.equal(created.ownerSeat,2);assert.equal(created.challenge.net,0);assert.equal(created.seats.filter(s=>s.kind==='ai').length,3);
  assert.equal(created.challenge.status,'ready');assert.deepEqual(created.challenge.wonNames,['龙公子','春光']);
  assert.equal(created.challenge.events,undefined);assert.equal(created.challenge.decisionQuality,undefined);assert.equal(created.challenge.referenceNet,undefined);
  const url=`${origin}/v1/tables/${created.gameId}/challenge`;
  const good=await fetch(url,{headers:{authorization:'Bearer '+token}});assert.equal(good.status,200);assert.deepEqual((await good.json()).challenge,created.challenge);
  const other=await issueAccess(secret,{v:1,kind:'owner',tenant:'challenge-test',owner:'bob',exp:Date.now()+60000});
  assert.equal((await fetch(url,{headers:{authorization:'Bearer '+other}})).status,403);
  assert.equal((await fetch(url,{method:'POST',headers:{authorization:'Bearer '+other,'content-type':'application/json'},body:JSON.stringify({action:'begin'})})).status,403);
  assert.equal((await fetch(url,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({action:'begin',seat:1})})).status,400);
  assert.equal((await control.resumeTable({gameId:created.gameId,ownerApiToken:token})).challenge.status,'ready');
  const begun=await control.beginChallenge({gameId:created.gameId,ownerApiToken:token});assert.equal(begun.challenge.status,'active');assert.equal(begun.challenge.net,0);
  assert.deepEqual((await control.beginChallenge({gameId:created.gameId,ownerApiToken:token})).challenge,begun.challenge);
  assert.equal((await control.resumeTable({gameId:created.gameId,ownerApiToken:token})).challenge.status,'active');
  await assert.rejects(control.startChallenge({record,keySeq:76,seat:2,seed:1,ownerApiToken:token}),{code:'CHALLENGE_KEY_NOT_PLAYABLE'});
 }finally{await mf.dispose();}
});
