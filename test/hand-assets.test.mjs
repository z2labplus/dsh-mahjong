import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,writeFile,rm,mkdir,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHandAssetsHandler,HAND_ASSET_PREFIX} from '../lib/hand-assets.js';
test('embedded assets serve only the dedicated build, including HEAD and traversal rejection',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'dsh-hand-assets-')),dir=path.join(root,'build');await mkdir(dir);
 await writeFile(path.join(dir,'index.html'),'<title>real-hand-test</title>');await writeFile(path.join(dir,'app.js'),'export const ok=true;');await writeFile(path.join(dir,'voice.MP3'),'sample');await writeFile(path.join(dir,'sound.wav'),'sample');
 await writeFile(path.join(root,'secret.js'),'private');await symlink(path.join(root,'secret.js'),path.join(dir,'escape.js'));await writeFile(path.join(dir,'private.json'),'private');
 const server=createServer(createHandAssetsHandler(dir));await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 try{
  const html=await fetch(origin+HAND_ASSET_PREFIX+'hand/');assert.equal(html.status,200);assert.match(await html.text(),/real-hand-test/);
  const script=await fetch(origin+HAND_ASSET_PREFIX+'app.js');assert.match(script.headers.get('content-type'),/javascript/);
  for(const name of ['voice.MP3','sound.wav'])assert.match((await fetch(origin+HAND_ASSET_PREFIX+name)).headers.get('content-type'),/^audio/);
  const head=await fetch(origin+HAND_ASSET_PREFIX+'hand/',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
  for(const relative of ['%2e%2e%2fsecret.js','escape.js','private.json','missing.js'])assert.equal((await fetch(origin+HAND_ASSET_PREFIX+relative)).status,404);
  assert.equal((await fetch(origin+HAND_ASSET_PREFIX+'hand/',{method:'POST'})).status,405);
 }finally{await new Promise(r=>server.close(r));await rm(root,{recursive:true});}
});
