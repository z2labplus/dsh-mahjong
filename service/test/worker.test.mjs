import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import WebSocket from '../../node_modules/ws/index.js';
import { createServiceControl } from '../../lib/service-control.js';
import { createSeatRuntime } from '../../lib/seat-runtime.js';
import { issueAccess } from '../src/auth.ts';
import { BaseClient } from '../../frontend/src/base-client.ts';

const secret = 'test-only-deployment-secret-'.repeat(3);
async function until(read, timeout = 12000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = read(); if (value) return value; await new Promise(r => setTimeout(r, 20)); }
  throw new Error('condition timed out');
}
async function connect(url, options) {
  const socket = new WebSocket(url, options);
  const messages = [];
  socket.on('message', raw => messages.push(JSON.parse(raw.toString())));
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  return { socket, messages, send: message => socket.send(JSON.stringify(message)) };
}

test('browser seat takeover stops the old page retry loop while ordinary disconnects recover', {timeout:30000}, async () => {
  const mf = new Miniflare(convertV4MiniflareOptions({modules:true,
    scriptPath:fileURLToPath(new URL('../dist/worker.js',import.meta.url)),compatibilityDate:'2026-09-01',compatibilityFlags:['nodejs_compat'],
    bindings:{SERVICE_SECRET:secret},durableObjects:{TABLES:{className:'MahjongTable',useSQLite:true},DIRECTORY:{className:'MahjongDirectory',useSQLite:true}},port:0}));
  const previousWindow=Object.getOwnPropertyDescriptor(globalThis,'window');
  const previousSocket=Object.getOwnPropertyDescriptor(globalThis,'WebSocket');
  const sockets=[], retries=new Set();
  const browsers=[];
  let finishing=false;
  try {
    const origin=(await mf.ready).origin;
    const control=createServiceControl({url:origin});
    const token=await issueAccess(secret,{v:1,kind:'owner',tenant:'browser-takeover',owner:'alice',exp:Date.now()+60000});
    const game=await control.createTable({ownerApiToken:token,timeoutSeconds:120,seats:[0,1,2,3].map(seat=>({seat,kind:'human',owner:seat===0}))});
    const response=await fetch(`${origin}/v1/tables/${game.gameId}/session?seat=0`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({credential:game.seats[0].humanInviteTicket})});
    assert.equal(response.status,200);
    const cookie=response.headers.get('set-cookie').split(';')[0];
    class BrowserSocket extends WebSocket {
      constructor(url) { super(url,{headers:{Origin:origin,Cookie:cookie}});sockets.push(this); }
    }
    Object.defineProperty(globalThis,'WebSocket',{configurable:true,writable:true,value:BrowserSocket});
    Object.defineProperty(globalThis,'window',{configurable:true,writable:true,value:{setTimeout,clearTimeout,setInterval,clearInterval}});
    const url=`${control.wsUrlForGame(game.gameId)}?seat=0`;
    const join=client=>client.joinDshHuman(url,game.gameId,0,'');
    const browser=()=>{
      const client=new BaseClient();browsers.push(client);
      // Even an already-scheduled automatic retry cannot reclaim a replaced seat.
      client.on('disconnect',()=>{
        if(finishing)return;
        const timer=setTimeout(()=>{retries.delete(timer);join(client);},5);retries.add(timer);
      });
      return client;
    };
    const oldPage=browser();join(oldPage);
    await until(()=>oldPage.actionsReady());
    const newPage=browser();join(newPage);
    await until(()=>oldPage.connectionState()==='replaced'&&newPage.actionsReady());
    await new Promise(r=>setTimeout(r,50));
    assert.equal(sockets.length,2);
    assert.equal(oldPage.connected(),false);
    assert.equal(newPage.actionsReady(),true);
    // A genuine network loss still reconnects with the same cookie and full state.
    sockets[1].terminate();
    await until(()=>sockets.length===3&&newPage.actionsReady());
    assert.equal(oldPage.connectionState(),'replaced');
    // Explicit reload creates a fresh client and can intentionally take the seat.
    const reloadedPage=browser();join(reloadedPage);
    await until(()=>newPage.connectionState()==='replaced'&&reloadedPage.actionsReady());
    await new Promise(r=>setTimeout(r,50));
    assert.equal(sockets.length,4);
    assert.equal(reloadedPage.playerId(),'seat-0');
  } finally {
    finishing=true;
    for(const timer of retries)clearTimeout(timer);
    for(const client of browsers)client.disconnect();
    for(const socket of sockets)socket.terminate();
    await new Promise(r=>setTimeout(r,20));
    if(previousSocket)Object.defineProperty(globalThis,'WebSocket',previousSocket);else delete globalThis.WebSocket;
    if(previousWindow)Object.defineProperty(globalThis,'window',previousWindow);else delete globalThis.window;
    await mf.dispose();
  }
});

// Uses real workerd, SQLite-backed Durable Objects and WebSocket connections.
// No MJAI process, MJAI database, model API key, or Cloudflare login is involved.
test('Cloudflare service + local Harness transports, isolation and persisted recovery', { timeout: 60000 }, async () => {
  const persistence = await mkdtemp(path.join(tmpdir(), 'dsh-mahjong-worker-test-'));
  const options = { modules: true, scriptPath: fileURLToPath(new URL('../dist/worker.js', import.meta.url)), compatibilityDate: '2026-09-01', compatibilityFlags: ['nodejs_compat'],
    bindings: { SERVICE_SECRET: secret }, durableObjects: { TABLES: { className: 'MahjongTable', useSQLite: true }, DIRECTORY: { className: 'MahjongDirectory', useSQLite: true } },
    resourcePersistencePath: persistence, port: 0 };
  let mf = new Miniflare(convertV4MiniflareOptions(options));
  let runtime;
  let spectator;
  const clients = [];
  try {
    let origin = (await mf.ready).origin;
    const owner = { v: 1, kind: 'owner', tenant: 'one', owner: 'alice', exp: Date.now() + 60000 };
    const token = await issueAccess(secret, owner);
    const control = createServiceControl({ url: origin });
    const created = await control.createTable({ ownerApiToken: token, tableName: 'Integration', timeoutSeconds: 10, seats: [0, 1, 2, 3].map(seat => ({ seat, kind: 'ai', model: 'test', modelLabel: 'test' })) });
    assert.equal(created.ownerMode, 'spectator');
    const secondToken = await issueAccess(secret, { ...owner, tenant: 'two' });
    await assert.rejects(control.resumeTable({ gameId: created.gameId, ownerApiToken: secondToken }), { code: 'FORBIDDEN' });
    const changedOwnerToken = await issueAccess(secret, { ...owner, owner: 'bob' });
    await assert.rejects(control.resumeTable({ gameId: created.gameId, ownerApiToken: changedOwnerToken }), { code: 'FORBIDDEN' });

    const snapshots = [];
    spectator = await control.connectSpectator({ gameId: created.gameId, ownerApiToken: token, expectedScope: 'full', onSnapshot: s => snapshots.push(s) });
    let managerOptions;
    const decisions = new Map();
    const errors = [];
    const transportTrace = [];
    const runtimeSeats = created.seats.map(seat => ({ gameId: created.gameId, seat: seat.seat, seatCredential: seat.seatCredential, provider: 'test', model: 'test', wsUrl: control.wsUrlForGame(created.gameId) }));
    runtime = await createSeatRuntime({ ctx: {}, seats: runtimeSeats, socketFactory: url => { const socket = new WebSocket(url); const id = transportTrace.length; transportTrace.push([]); socket.on('message', raw => { const m = JSON.parse(raw.toString()); transportTrace[id].push({ type: m.type, code: m.errorCode, seat: m.seat }); }); socket.on('close', (code, reason) => transportTrace[id].push({ close: code, reason: reason.toString() })); return socket; }, onError: e => errors.push(e), seatAgentManagerFactory: async opts => {
      managerOptions = opts;
      return { openDecision: async decision => { decisions.set(decision.seatId, decision); }, closeDecision: () => true, dispose: async () => {} };
    } });
    await until(() => { if (errors.length) throw new Error(errors.map(e => e.code + ': ' + e.message).join('; ')); return decisions.size === 4; }).catch(error => { error.message += JSON.stringify(transportTrace); throw error; });
    assert.equal(errors.length, 0);
    const first = decisions.get(`${created.gameId}:0`);
    const oldDeadline = first.deadlineAtMs;
    await assert.rejects(managerOptions.submitAction({ seatId: first.seatId, decisionId: first.decisionId, actionId: 'invented-action' }), { code: 'ACTION_REJECTED' });
    await managerOptions.submitAction({ seatId: first.seatId, decisionId: first.decisionId, actionId: first.actionIds[0] });
    const initialSnapshot = await until(() => snapshots.find(s => s.entries.some(([kind]) => kind === 'blood')));
    assert.equal(initialSnapshot.entries.filter(([kind]) => kind === 'tileFaceSelf').length, 53);

    // A table viewer credential cannot join an AI seat or submit an action.
    const bad = await connect(control.wsUrlForGame(created.gameId)); clients.push(bad.socket);
    bad.send({ type: 'DSH_SEAT_JOIN', gameId: created.gameId, seat: 1, seatCredential: created.spectatorEmbedTicket });
    const denied = await until(() => bad.messages.find(m => m.type === 'ERROR'));
    assert.equal(denied.errorCode, 'FORBIDDEN');

    const secondBefore = decisions.get(`${created.gameId}:1`);
    await runtime.dispose(); runtime = undefined;
    spectator.dispose(); spectator = undefined;
    for (const socket of clients) socket.close();
    await mf.dispose();
    // Restart the complete worker process against the same SQLite files.
    mf = new Miniflare(convertV4MiniflareOptions(options));
    origin = (await mf.ready).origin;
    const restarted = createServiceControl({ url: origin });
    const restored = await restarted.resumeTable({ gameId: created.gameId, ownerApiToken: token });
    assert.equal(restored.gameId, created.gameId);
    const seat = await connect(restarted.wsUrlForGame(created.gameId)); clients.push(seat.socket);
    seat.send({ type: 'DSH_SEAT_JOIN', gameId: created.gameId, seat: 1, seatCredential: restored.seats[1].seatCredential });
    await until(() => seat.messages.find(m => m.type === 'DSH_SEAT_JOINED'));
    seat.send({ type: 'AI_SEAT_BIND', gameId: created.gameId, seat: 1, modelId: 'test' });
    const resumed = await until(() => seat.messages.find(m => m.type === 'AI_DECISION'));
    assert.equal(resumed.decision.decisionId, secondBefore.decisionId);
    assert.equal(resumed.decision.deadlineAtMs, oldDeadline);
    assert.deepEqual(resumed.decision.handState, JSON.parse(secondBefore.stateBlock).handState);
    assert.equal(seat.messages.some(m => m.type === 'UPDATE'), false);
    // The real Durable Object alarm must close the old decision after its original
    // deadline, even though all model runtimes disconnected before restart.
    const closed = await until(() => seat.messages.find(m => m.type === 'AI_DECISION_CLOSED' && m.decisionId === secondBefore.decisionId), 15000);
    assert.equal(closed.source, 'timeout_top1');
  } finally {
    if (runtime) await runtime.dispose();
    spectator?.dispose();
    for (const socket of clients) socket.close();
    await mf.dispose();
    await rm(persistence, { recursive: true, force: true });
  }
});


test('browser invitation exchange, seat-scoped recovery and incremental human actions', { timeout: 30000 }, async () => {
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true,
    scriptPath: fileURLToPath(new URL('../dist/worker.js', import.meta.url)), compatibilityDate: '2026-09-01', compatibilityFlags: ['nodejs_compat'],
    bindings: { SERVICE_SECRET: secret }, durableObjects: { TABLES: { className: 'MahjongTable', useSQLite: true }, DIRECTORY: { className: 'MahjongDirectory', useSQLite: true } }, port: 0 }));
  const clients = [];
  try {
    const origin = (await mf.ready).origin;
    const control = createServiceControl({ url: origin });
    const token = await issueAccess(secret, { v: 1, kind: 'owner', tenant: 'browser', owner: 'alice', exp: Date.now() + 60000 });
    const created = await control.createTable({ ownerApiToken: token, timeoutSeconds: 120, seats: [0,1,2,3].map(seat => ({seat,kind:'human',owner:seat===0})) });
    const endpoint = `${origin}/v1/tables/${created.gameId}/session?seat=0`;
    const exchange = originHeader => fetch(endpoint, { method:'POST', headers:{ Origin:originHeader, 'Content-Type':'application/json' }, body:JSON.stringify({credential:created.seats[0].humanInviteTicket}) });
    assert.equal((await exchange('https://untrusted.example')).status, 403);
    const exchanged = await exchange(origin);
    assert.equal(exchanged.status, 200);
    const cookie = exchanged.headers.get('set-cookie').split(';')[0];
    assert.match(exchanged.headers.get('set-cookie'), /HttpOnly/);
    assert.equal((await fetch(endpoint,{headers:{Cookie:cookie}})).status,200);
    assert.equal((await fetch(endpoint.replace('seat=0','seat=1'),{headers:{Cookie:cookie}})).status,401);
    const human = await connect(`${control.wsUrlForGame(created.gameId)}?seat=0`,{headers:{Cookie:cookie,Origin:origin}});clients.push(human.socket);
    human.send({type:'DSH_SEAT_JOIN',gameId:created.gameId,seat:0,humanInviteTicket:''});
    await until(()=>human.messages.find(m=>m.type==='DSH_SEAT_JOINED'));
    for(const seat of [1,2,3]){
      const peer = await connect(control.wsUrlForGame(created.gameId));clients.push(peer.socket);
      peer.send({type:'DSH_SEAT_JOIN',gameId:created.gameId,seat,humanInviteTicket:created.seats[seat].humanInviteTicket});
      await until(()=>peer.messages.find(m=>m.type==='DSH_SEAT_JOINED'));
    }
    const decision = (await until(()=>human.messages.find(m=>m.type==='AI_DECISION'))).decision;
    const entries = human.messages.filter(m=>m.type==='UPDATE').flatMap(m=>m.entries);
    const faces = new Map(entries.filter(([kind])=>kind==='tileFaceSelf').map(([,id,key])=>[id,key]));
    assert.equal(faces.size,14);
    const suit = [...faces.values()].map(key=>Math.floor(key/9)).find(suit=>[...faces.values()].filter(key=>Math.floor(key/9)===suit).length>=3);
    const tileIds = [...faces].filter(([,key])=>Math.floor(key/9)===suit).slice(0,3).map(([id])=>id);
    const before = human.messages.length;
    const message={type:'ACTION',gameId:created.gameId,actionId:crypto.randomUUID(),decisionId:decision.decisionId,action:{kind:'swap3',tileIds}};
    human.send(message);
    assert.equal((await until(()=>human.messages.slice(before).find(m=>m.type==='ACTION_ACK'))).ok,true);
    const delta=await until(()=>human.messages.slice(before).find(m=>m.type==='UPDATE'&&m.entries.some(([kind,,value])=>kind==='blood'&&value.swap3?.selections[0])));
    assert.equal(delta.full,false);
    assert.ok(delta.entries.length<entries.length);
    human.send(message);
    await until(()=>human.messages.filter(m=>m.type==='ACTION_ACK'&&m.actionId===message.actionId).length===2);
    assert.equal(human.messages.filter(m=>m.type==='UPDATE'&&m.full).length,1);
    const resumed=await connect(`${control.wsUrlForGame(created.gameId)}?seat=0`,{headers:{Cookie:cookie,Origin:origin}});clients.push(resumed.socket);
    resumed.send({type:'DSH_SEAT_JOIN',gameId:created.gameId,seat:0,humanInviteTicket:''});
    const full=await until(()=>resumed.messages.find(m=>m.type==='UPDATE'&&m.full));
    assert.deepEqual([...full.entries.find(([kind])=>kind==='blood')[2].swap3.selections[0]].sort((a,b)=>a-b),[...tileIds].sort((a,b)=>a-b));
    assert.equal(resumed.messages.some(m=>m.type==='AI_DECISION'),false);
  } finally {for(const socket of clients)socket.close();await mf.dispose();}
});

test('users, single-use grants, replay import/share/revoke and server-verified practice', {timeout:90000},async()=>{
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:fileURLToPath(new URL('../dist/worker.js',import.meta.url)),compatibilityDate:'2026-09-01',compatibilityFlags:['nodejs_compat'],bindings:{SERVICE_SECRET:secret},durableObjects:{TABLES:{className:'MahjongTable',useSQLite:true},DIRECTORY:{className:'MahjongDirectory',useSQLite:true}},port:0}));
 const clients=[];
 try{
  const origin=(await mf.ready).origin;
  const admin=await issueAccess(secret,{v:1,kind:'owner',tenant:'product',owner:'admin',admin:true,exp:Date.now()+120000});
  const api=async(path,token=admin,method='GET',body)=>{const r=await fetch(origin+path,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,body:await r.json()};};
  const grant=await api('/v1/admin/users',admin,'POST',{owner:'learner',operation:'invite',maxTables:4,maxActive:1});assert.equal(grant.status,200);
  assert.equal((await api('/v1/library',grant.body.invitation)).status,403);
  const redeemed=await api('/v1/invitations/redeem',admin,'POST',{invitation:grant.body.invitation});assert.equal(redeemed.status,200);
  assert.equal((await api('/v1/invitations/redeem',admin,'POST',{invitation:grant.body.invitation})).status,409);
  const token=redeemed.body.ownerApiToken;
  assert.equal((await api('/v1/admin/users',token)).status,403);
  const control=createServiceControl({url:origin});
  const spec={ownerApiToken:token,ruleset:'guobiao',tableName:'国标完整牌谱',timeoutSeconds:120,seats:[0,1,2,3].map(seat=>({seat,kind:'ai',model:'test',modelLabel:'test'}))};
  const created=await control.createTable(spec);
  await assert.rejects(control.createTable(spec),{code:'ACTIVE_TABLE_QUOTA_REACHED'});
  for(const seat of created.seats){
   const client=await connect(control.wsUrlForGame(created.gameId));clients.push(client.socket);
   client.socket.on('message',raw=>{const m=JSON.parse(raw.toString());if(m.type==='AI_DECISION')client.send({type:'ACTION',gameId:created.gameId,actionId:crypto.randomUUID(),action:{kind:'aiDecision',decisionId:m.decision.decisionId,legalActionId:m.decision.legalActions[0].legalActionId}});});
   client.send({type:'DSH_SEAT_JOIN',gameId:created.gameId,seat:seat.seat,seatCredential:seat.seatCredential});await until(()=>client.messages.find(m=>m.type==='DSH_SEAT_JOINED'));
   client.send({type:'AI_SEAT_BIND',gameId:created.gameId,seat:seat.seat,modelId:'test'});
  }
  let library;
  await until(async()=>false,1).catch(()=>{});
  for(let i=0;i<250;i++){library=await api('/v1/library',token);if(library.body.items[0]?.phase==='done')break;await new Promise(r=>setTimeout(r,100));}
  assert.equal(library.body.items[0].phase,'done');
  const history=await api(`/v1/tables/${created.gameId}/history`,token);assert.ok(history.body.items.length>20);assert.equal(history.body.canPractice,true);
  const exported=await api(`/v1/tables/${created.gameId}/replay`,token);assert.equal(exported.status,200);assert.doesNotMatch(JSON.stringify(exported.body),/tileKeyById|snapshotKey|pendingResponsesById/);
  const copiedId=crypto.randomUUID();assert.equal((await api(`/v1/tables/${copiedId}/replay`,token,'PUT',exported.body)).status,201);
  assert.equal((await api(`/v1/tables/${copiedId}/practice`,token,'POST',{eventIndex:4,gameId:crypto.randomUUID(),table:{}})).status,422);
  const shared=await api(`/v1/tables/${created.gameId}/shares`,token,'POST',{});assert.equal(shared.status,201);
  const sharePath=`/v1/shares/${created.gameId}/${shared.body.shareId}`;
  assert.equal((await fetch(origin+sharePath)).status,200);
  const shares=await control.listShares({gameId:created.gameId,ownerApiToken:token});assert.equal(shares.items[0].shareId,shared.body.shareId);
  await assert.rejects(control.listShares({gameId:created.gameId,ownerApiToken:admin}),{code:'FORBIDDEN'});
  assert.equal((await api(`/v1/tables/${created.gameId}/shares/${shared.body.shareId}`,token,'DELETE')).status,200);
  assert.equal((await fetch(origin+sharePath)).status,404);
  assert.equal((await control.listShares({gameId:created.gameId,ownerApiToken:token})).items.length,0);
  const index=history.body.items.find(i=>i.phase==='playing').eventIndex;
  const branchId=crypto.randomUUID();
  const branch=await api(`/v1/tables/${created.gameId}/practice`,token,'POST',{eventIndex:index,gameId:branchId,table:{ruleset:'guobiao',timeoutSeconds:120,seats:[0,1,2,3].map(seat=>({seat,kind:'human',owner:seat===0}))}});
  assert.equal(branch.status,201,JSON.stringify(branch.body));assert.equal(branch.body.source.gameId,created.gameId);
  const endpoint=`/v1/tables/${branchId}/session?seat=0`;
  const exchange=()=>fetch(origin+endpoint,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({credential:branch.body.seats[0].humanInviteTicket})});
  const first=await exchange();assert.equal(first.status,200);const cookie=first.headers.get('set-cookie').split(';')[0];assert.equal((await exchange()).status,409);
  assert.equal((await api(`/v1/tables/${branchId}/seats/0/revoke`,token,'POST',{})).status,200);
  assert.equal((await fetch(origin+endpoint,{headers:{Cookie:cookie}})).status,403);
  const before=await api(`/v1/tables/${created.gameId}/replay`,token);assert.deepEqual(before.body,exported.body);
  assert.equal((await api('/v1/admin/users',admin,'POST',{operation:'revoke',owner:'learner'})).status,200);
  assert.equal((await api(`/v1/tables/${branchId}`,token)).status,403);
 }finally{for(const socket of clients)socket.close();await mf.dispose();}
});
