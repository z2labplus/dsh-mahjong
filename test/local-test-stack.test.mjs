import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {parseCommand,isExpectedProcessCommand,ownerToken,PORTS,waitReady} from '../scripts/local-test-stack.mjs';
test('independent launcher validates commands and never stops an unrelated reused PID',()=>{
 assert.equal(parseCommand([]),'start');assert.equal(parseCommand(['connect','https://mahjong.example']),'connect');
 assert.throws(()=>parseCommand(['reset']));assert.throws(()=>parseCommand(['stop','all']));
 assert.equal(isExpectedProcessCommand('node --profile another','--profile dsh-mahjong-standalone'),false);
 assert.equal(isExpectedProcessCommand('node --profile dsh-mahjong-standalone','--profile dsh-mahjong-standalone'),true);
 assert.deepEqual(PORTS,{service:8787,harness:3082});
});
test('local owner bootstrap is scoped, expiring and correctly signed',()=>{
 const secret='test'.repeat(12);const token=ownerToken(secret,1800000000000);const [prefix,payload,signature]=token.split('.');
 assert.equal(signature,createHmac('sha256',secret).update(prefix+'.'+payload).digest('base64url'));
 const claims=JSON.parse(Buffer.from(payload,'base64url'));assert.equal(claims.kind,'owner');assert.equal(claims.admin,true);assert.equal(claims.exp,1800000000000+30*86400000);
});
test('clean launcher uses independent service and official Harness, with private credentials and no legacy backend',async()=>{
 const source=await readFile(new URL('../scripts/local-test-stack.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(source,/MJAI|postgres|1234|1235|autotable|loginToken/);
 assert.match(source,/mode:0o600/);assert.match(source,/DSH_MAHJONG_SERVICE_TOKEN:token/);
 assert.doesNotMatch(source,/console\.(?:log|error)\(token/);assert.match(source,/dsh-mahjong-standalone/);
});

test('startup reports a remote network failure without suggesting unrelated local logs',async()=>{
 await assert.rejects(waitReady('https://mahjong.example/health',{
  timeoutMs:5,pollMs:1,label:'Cloudflare 牌局服务',
  fetchImpl:async()=>{throw new DOMException('deadline','TimeoutError');},
 }),error=>{
  assert.match(error.message,/Cloudflare 牌局服务连接失败（网络连接超时）/);
  assert.match(error.message,/代理/);assert.doesNotMatch(error.message,/\.local|日志/);return true;
 });
});

test('startup reports local HTTP failure with the Harness log and retries readiness',async()=>{
 await assert.rejects(waitReady('http://127.0.0.1:3082/',{
  timeoutMs:5,pollMs:1,label:'本地 Harness',logPath:'/test/harness.log',
  fetchImpl:async()=>new Response('not ready',{status:503}),
 }),/本地 Harness连接失败（HTTP 503）。请查看日志：\/test\/harness.log/);
 let attempts=0;
 await waitReady('http://127.0.0.1:3082/',{
  timeoutMs:1000,pollMs:1,
  fetchImpl:async()=>new Response('',{status:++attempts===1?503:200}),
 });
 assert.equal(attempts,2);
});
