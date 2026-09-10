import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import {
  createDshMahjongHttpHandler,
  MAX_REQUEST_BYTES,
  REQUEST_TOKEN_HEADER,
} from "../lib/http-api.js";

async function serve(controller, requestToken = "process-request-token") {
  const server = createServer(createDshMahjongHttpHandler(
    Promise.resolve(controller),
    { requestToken },
  ));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    requestToken,
    async close() {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}

function authorizedHeaders(host, values = {}) {
  return {
    [REQUEST_TOKEN_HEADER]: host.requestToken,
    ...values,
  };
}

test("case opening preserves the process-token boundary and rejects invented request fields", async () => {
  const calls = [];
  const host = await serve({
    async openCase(value) {
      calls.push(value);
      return { phase: "active", mode: "case", ...value };
    },
  });
  try {
    const body = { sessionId: "case-session", eventIndex: 0 };
    const headers = authorizedHeaders(host, {
      "Content-Type": "application/json", Origin: host.origin,
      "Sec-Fetch-Site": "same-origin",
    });
    const request = (payload, requestHeaders = headers) => fetch(`${host.origin}/dsh-mahjong/api/cases/open`, {
      method: "POST", headers: requestHeaders, body: JSON.stringify(payload),
    });
    const denied = await request(body, { ...headers, [REQUEST_TOKEN_HEADER]: "wrong-token" });
    assert.equal(denied.status, 403);
    const invented = await request({ ...body, frame: { drawn: "3s" } });
    assert.equal(invented.status, 400);
    assert.equal((await invented.json()).error.code, "INVALID_REQUEST");
    assert.deepEqual(calls, []);
    const allowed = await request(body);
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get("cache-control"), "no-store");
    assert.deepEqual((await allowed.json()).state, { phase: "active", mode: "case", ...body });
    assert.deepEqual(calls, [body]);
  } finally {
    await host.close();
  }
});

test("serves model/state data with no-store headers and routes mutations to the controller", async () => {
  const calls = [];
  const controller = {
    models: async () => ({ providers: [], failures: [] }),
    state: (sessionId) => ({ phase: "setup", sessionId }),
    async start(value) {
      calls.push(["start", value]);
      return { phase: "active", sessionId: value.sessionId };
    },
    async retry(sessionId) {
      calls.push(["retry", sessionId]);
      return { phase: "active", sessionId };
    },
    async stop(sessionId) {
      calls.push(["stop", sessionId]);
      return { phase: "stopped", sessionId };
    },
  };
  const host = await serve(controller);
  try {
    const models = await fetch(`${host.origin}/dsh-mahjong/api/models`, {
      headers: authorizedHeaders(host),
    });
    assert.equal(models.status, 200);
    assert.equal(models.headers.get("cache-control"), "no-store");
    assert.deepEqual(await models.json(), {
      ok: true,
      catalog: { providers: [], failures: [] },
    });

    const state = await fetch(`${host.origin}/dsh-mahjong/api/state?sessionId=session-1`, {
      headers: authorizedHeaders(host),
    });
    assert.deepEqual(await state.json(), {
      ok: true,
      state: { phase: "setup", sessionId: "session-1" },
    });

    const started = await fetch(`${host.origin}/dsh-mahjong/api/games/start`, {
      method: "POST",
      headers: authorizedHeaders(host, {
        "Content-Type": "application/json",
        Origin: host.origin,
        "Sec-Fetch-Site": "same-origin",
      }),
      body: JSON.stringify({ sessionId: "session-1", seats: [] }),
    });
    assert.equal(started.status, 200);
    assert.deepEqual(calls, [["start", { sessionId: "session-1", seats: [] }]]);
  } finally {
    await host.close();
  }
});

test("rejects cross-origin, wrong content type, unsupported method, and oversized bodies", async () => {
  const host = await serve({
    models: async () => ({}),
    state: () => ({}),
    start: async () => ({}),
    retry: async () => ({}),
    stop: async () => ({}),
  });
  try {
    const crossOrigin = await fetch(`${host.origin}/dsh-mahjong/api/games/retry`, {
      method: "POST",
      headers: authorizedHeaders(host, {
        "Content-Type": "application/json",
        Origin: "http://evil.invalid",
        "Sec-Fetch-Site": "same-origin",
      }),
      body: JSON.stringify({ sessionId: "session-1" }),
    });
    assert.equal(crossOrigin.status, 403);
    assert.equal((await crossOrigin.json()).error.code, "ORIGIN_REJECTED");

    const wrongType = await fetch(`${host.origin}/dsh-mahjong/api/games/retry`, {
      method: "POST",
      headers: authorizedHeaders(host, {
        "Content-Type": "text/plain",
        Origin: host.origin,
        "Sec-Fetch-Site": "same-origin",
      }),
      body: "{}",
    });
    assert.equal(wrongType.status, 415);

    const method = await fetch(`${host.origin}/dsh-mahjong/api/games/start`, {
      method: "GET",
      headers: authorizedHeaders(host),
    });
    assert.equal(method.status, 405);
    assert.equal(method.headers.get("allow"), "POST");

    const oversized = await fetch(`${host.origin}/dsh-mahjong/api/games/retry`, {
      method: "POST",
      headers: authorizedHeaders(host, {
        "Content-Type": "application/json",
        Origin: host.origin,
        "Sec-Fetch-Site": "same-origin",
      }),
      body: JSON.stringify({ sessionId: "x".repeat(MAX_REQUEST_BYTES) }),
    });
    assert.equal(oversized.status, 413);
  } finally {
    await host.close();
  }
});

test("isolates every process token and rejects forged Host or cross-site fetch metadata", async () => {
  let stateCalls = 0;
  const controller = {
    models: async () => ({}),
    state: () => {
      stateCalls += 1;
      return { phase: "setup" };
    },
    start: async () => ({}),
    retry: async () => ({}),
    stop: async () => ({}),
  };
  const first = await serve(controller, "process-token-a");
  const second = await serve(controller, "process-token-b");
  try {
    for (const headers of [
      {},
      { [REQUEST_TOKEN_HEADER]: "wrong-token" },
      { [REQUEST_TOKEN_HEADER]: second.requestToken },
    ]) {
      const denied = await fetch(`${first.origin}/dsh-mahjong/api/state`, { headers });
      assert.equal(denied.status, 403);
      assert.equal((await denied.json()).error.code, "REQUEST_TOKEN_REJECTED");
    }

    const forgedHost = await fetch(`${first.origin}/dsh-mahjong/api/state`, {
      headers: authorizedHeaders(first, {
        Host: "attacker.invalid",
        Origin: "http://attacker.invalid",
        "Sec-Fetch-Site": "same-origin",
      }),
    });
    assert.equal(forgedHost.status, 403);
    assert.equal((await forgedHost.json()).error.code, "ORIGIN_REJECTED");

    const crossSite = await fetch(`${first.origin}/dsh-mahjong/api/state`, {
      headers: authorizedHeaders(first, {
        Origin: first.origin,
        "Sec-Fetch-Site": "cross-site",
      }),
    });
    assert.equal(crossSite.status, 403);
    assert.equal((await crossSite.json()).error.code, "ORIGIN_REJECTED");

    const httpsOrigin = first.origin.replace("http:", "https:");
    const trustedHttps = await fetch(`${first.origin}/dsh-mahjong/api/state`, {
      headers: authorizedHeaders(first, {
        Origin: httpsOrigin,
        "Sec-Fetch-Site": "same-origin",
      }),
    });
    assert.equal(trustedHttps.status, 200);
    assert.equal(stateCalls, 1, "rejected requests must not reach the controller");
  } finally {
    await first.close();
    await second.close();
  }
});

test('source catalog uses the client envelope, authenticated navigation rejects caller-supplied frames',async()=>{
 const calls=[];const host=await serve({sourceCases:()=>({ok:true,items:[{caseId:'local-case'}]}),stepSource:async value=>{calls.push(value);return {phase:'active'};}});
 try{
  const response=await fetch(host.origin+'/dsh-mahjong/api/sources',{headers:authorizedHeaders(host)});
  assert.deepEqual(await response.json(),{ok:true,items:[{caseId:'local-case'}]});
  const headers=authorizedHeaders(host,{'Content-Type':'application/json',Origin:host.origin,'Sec-Fetch-Site':'same-origin'});
  const body={sessionId:'s',eventIndex:77,seat:2,lesson:null,viewMode:'follow'};
  const rejected=await fetch(host.origin+'/dsh-mahjong/api/sources/step',{method:'POST',headers,body:JSON.stringify({...body,frame:{}})});assert.equal(rejected.status,400);
  const allowed=await fetch(host.origin+'/dsh-mahjong/api/sources/step',{method:'POST',headers,body:JSON.stringify(body)});assert.equal(allowed.status,200);assert.deepEqual(calls,[body]);
 }finally{await host.close();}
});

test('source editor accepts record drafts only with same-origin process authorization and no arbitrary file path',async()=>{
 const calls=[],host=await serve({sourceEdit:async(op,body)=>{calls.push([op,body]);return {saved:true};}});
 try{
  const headers=authorizedHeaders(host,{'Content-Type':'application/json',Origin:host.origin,'Sec-Fetch-Site':'same-origin'}),url=host.origin+'/dsh-mahjong/api/source-editor/draft';
  const body={sessionId:'s',clientId:'test-client',record:{events:[]},baseHash:'base',diskHash:'disk',selection:'event-1'};
  const post=(payload,overrides={})=>fetch(url,{method:'POST',headers:{...headers,...overrides},body:JSON.stringify(payload)});
  assert.equal((await post(body,{[REQUEST_TOKEN_HEADER]:'invalid'})).status,403);
  assert.equal((await post(body,{Origin:'https://foreign.example'})).status,403);
  assert.equal((await post({...body,recordPath:'/tmp/unregistered'})).status,400);
  assert.equal((await post({...body,record:{text:'x'.repeat(2*1024*1024)}})).status,413);
  assert.deepEqual(calls,[]);assert.equal((await post(body)).status,200);assert.equal(calls[0][0],'draft');
 }finally{await host.close();}
});
test('editor validation accepts an explicit base version but rejects supplied diagnostic or frame data',async()=>{
 const calls=[],host=await serve({sourceEdit:async(op,body)=>{calls.push([op,body]);return {ok:false,diagnostics:{baselineVersion:5}};}});
 try{
  const headers=authorizedHeaders(host,{'Content-Type':'application/json',Origin:host.origin,'Sec-Fetch-Site':'same-origin'}),url=host.origin+'/dsh-mahjong/api/source-editor/validate',body={sessionId:'s',record:{},baseHash:'a'.repeat(64),eventIndex:51};
  const allowed=await fetch(url,{method:'POST',headers,body:JSON.stringify(body)});assert.equal(allowed.status,200);assert.deepEqual(calls,[['validate',body]]);
  const rejected=await fetch(url,{method:'POST',headers,body:JSON.stringify({...body,diagnostics:{}})});assert.equal(rejected.status,400);assert.equal(calls.length,1);
 }finally{await host.close();}
});
test('source video endpoint cannot accept a browser-chosen local filesystem path',async()=>{
 const host=await serve({sourceVideo:()=>undefined});
 try{const headers=authorizedHeaders(host,{'Content-Type':'application/json',Origin:host.origin});const url=host.origin+'/dsh-mahjong/api/source-editor/video';
  assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify({sessionId:'s',path:'/etc/passwd'})})).status,400);
  assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify({sessionId:'s'})})).status,404);
 }finally{await host.close();}
});
