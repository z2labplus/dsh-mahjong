import assert from "node:assert/strict";
import test from "node:test";

import {
  createServiceSpectator,
  normalizeServiceWsUrl,
} from "../lib/service-spectator.js";

class FakeSocket {
  constructor(url) {
    this.url = url;
    this.handlers = new Map();
    this.sent = [];
    this.closed = false;
  }
  on(name, handler) {
    const values = this.handlers.get(name) ?? [];
    values.push(handler);
    this.handlers.set(name, values);
  }
  emit(name, value) {
    for (const handler of this.handlers.get(name) ?? []) handler(value);
  }
  open() {
    this.emit("open");
  }
  receive(value) {
    this.emit("message", JSON.stringify(value));
  }
  send(value) {
    this.sent.push(JSON.parse(value));
  }
  close() {
    this.closed = true;
  }
}

function harness() {
  const sockets = [];
  return {
    sockets,
    async control() {
      return createServiceSpectator({
    wsUrl: "ws://127.0.0.1:8787/v1/tables/game-1/ws",
        socketFactory(url) {
          const socket = new FakeSocket(url);
          sockets.push(socket);
          return socket;
        },
        requestTimeoutMs: 60_000,
      });
    },
  };
}

test("opens an owner-authorized observer and releases the pre-ready baseline only after scope validation", async () => {
  const testHarness = harness();
  const control = await testHarness.control();
  const snapshots = [];
  const pending = control.connectSpectator({
    gameId: "game-1",
    ownerApiToken: "owner-secret",
    onSnapshot: (value) => snapshots.push(value),
  });
  const socket = testHarness.sockets[0];
  socket.open();
  assert.deepEqual(socket.sent[0], {
    type: "DSH_SPECTATE",
    gameId: "game-1",
    apiToken: "owner-secret",
  });
  const baseline = { type: "UPDATE", full: true, entries: [["match", 0, { round: 1 }]] };
  const earlyDelta = { type: "UPDATE", full: false, entries: [["avatars", "player-1", 0]] };
  socket.receive(baseline);
  socket.receive(earlyDelta);
  assert.deepEqual(snapshots, [], "unvalidated data must not cross the observer boundary");
  socket.receive({
    type: "DSH_SPECTATING",
    gameId: "game-1",
    ok: true,
    scope: "self",
    ownerSeat: 0,
  });
  const observer = await pending;
  const liveDelta = { type: "UPDATE", full: false, entries: [["turn", "current", 8]] };
  socket.receive(liveDelta);
  assert.deepEqual(snapshots, [baseline, earlyDelta, liveDelta]);
  assert.equal(observer.scope, "self");
  observer.dispose();
  assert.equal(socket.closed, true);
});

test("does not reconnect when the initial spectator handshake is rejected", async () => {
  const callbacks = [];
  const sockets = [];
  const control = await createServiceSpectator({
    wsUrl: "ws://127.0.0.1:8787/v1/tables/game-1/ws",
    socketFactory(url) {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    requestTimeoutMs: 60_000,
    clock: {
      setTimeout(callback) {
        callbacks.push(callback);
        return callbacks.length;
      },
      clearTimeout() {},
    },
  });
  const pending = control.connectSpectator({
    gameId: "game-1",
    ownerApiToken: "owner-secret",
  });
  sockets[0].open();
  sockets[0].receive({ type: "ERROR", errorCode: "SPECTATE_FORBIDDEN" });

  await assert.rejects(pending, (error) => error.code === "SPECTATE_FORBIDDEN");
  for (const callback of callbacks.slice(1)) callback();
  assert.equal(sockets.length, 1);
  assert.equal(sockets[0].closed, true);
});

test("rejects a spectator scope that does not match the caller's privacy boundary", async () => {
  for (const { expectedScope, receivedScope } of [
    { expectedScope: "self", receivedScope: "full" },
    { expectedScope: "full", receivedScope: "self" },
  ]) {
    const testHarness = harness();
    const control = await testHarness.control();
    const snapshots = [];
    const pending = control.connectSpectator({
      gameId: "game-1",
      ownerApiToken: "owner-secret",
      expectedScope,
      onSnapshot: (value) => snapshots.push(value),
    });
    const socket = testHarness.sockets[0];
    socket.open();
    socket.receive({ type: "UPDATE", full: true, entries: [["tileFaceSelf", 0, ["secret-hand"]]] });
    socket.receive({
      type: "DSH_SPECTATING",
      gameId: "game-1",
      ok: true,
      scope: receivedScope,
    });
    await assert.rejects(pending, (error) => error?.code === "SPECTATE_REJECTED");
    assert.deepEqual(snapshots, [], "scope mismatch must discard every buffered snapshot");
    assert.equal(socket.closed, true);
  }
});

test("never accepts an owner credential echoed inside an upstream errorCode", async () => {
  const secret = "owner-secret-value";
  const leakedCode = `LEAK_${secret}`;
  const scenarios = [
    {
      fallback: "SPECTATE_REJECTED",
      begin: (control) => control.connectSpectator({
        gameId: "game-1",
        ownerApiToken: secret,
        expectedScope: "self",
      }),
      response: {
        type: "DSH_SPECTATING",
        gameId: "game-1",
        ok: false,
        errorCode: leakedCode,
      },
    },
  ];

  for (const scenario of scenarios) {
    const testHarness = harness();
    const control = await testHarness.control();
    const pending = scenario.begin(control);
    const socket = testHarness.sockets[0];
    socket.open();
    socket.receive(scenario.response);
    await assert.rejects(pending, (error) => {
      assert.equal(error?.code, scenario.fallback);
      assert.doesNotMatch(`${error?.code}:${error?.message}`, new RegExp(secret));
      return true;
    });
  }
});

test("rejects WebSocket query credentials instead of forwarding them", () => {
  assert.throws(
    () => normalizeServiceWsUrl("wss://mahjong.example.test/socket?token=must-not-travel"),
    (error) => error?.code === "INVALID_CONFIG",
  );
  assert.equal(normalizeServiceWsUrl("wss://mahjong.example.test/socket"), "wss://mahjong.example.test/socket");
});

test("spectator requires an explicit endpoint and exposes no legacy table commands", async () => {
  await assert.rejects(createServiceSpectator({}), { code: "INVALID_CONFIG" });
  const control = await harness().control();
  assert.equal(control.createTable, undefined);
  assert.equal(control.resumeTable, undefined);
});

test("the pre-ready snapshot buffer remains bounded after reconnect", async () => {
  const sockets = [];
  const timers = new Map();
  const errors = [];
  let sequence = 0;
  const control = await createServiceSpectator({
    wsUrl: "ws://127.0.0.1:8787/v1/tables/game-1/ws",
    socketFactory(url) {const socket = new FakeSocket(url); sockets.push(socket); return socket;},
    clock: {
      setTimeout(fn) {const id = ++sequence; timers.set(id, fn); return id;},
      clearTimeout(id) {timers.delete(id);},
    },
  });
  const pending = control.connectSpectator({gameId: "game-1", ownerApiToken: "owner-secret", expectedScope: "self", onError: error => errors.push(error.code)});
  sockets[0].open();
  sockets[0].receive({type: "DSH_SPECTATING", gameId: "game-1", ok: true, scope: "self"});
  const observer = await pending;
  sockets[0].emit("close");
  const retry = [...timers.values()][0]; timers.clear(); retry();
  sockets[1].open();
  sockets[1].receive({type: "UPDATE", full: true, entries: []});
  for (let i = 0; i < 129; i++) sockets[1].receive({type: "UPDATE", full: false, entries: []});
  assert.equal(sockets[1].closed, true);
  assert.deepEqual(errors, ["SNAPSHOT_BUFFER_OVERFLOW"]);
  assert.equal(timers.size, 1, "overflow retires the connection and schedules one retry");
  observer.dispose();
  assert.equal(timers.size, 0);
});
