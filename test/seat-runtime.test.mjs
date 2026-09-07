import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createSeatRuntime,
} from "../lib/seat-runtime.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createClock(start = 0) {
  let nowMs = start;
  let nextTimerId = 1;
  const timers = new Map();

  function runDue() {
    for (;;) {
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.at <= nowMs)
        .sort((left, right) => left[1].at - right[1].at || left[0] - right[0]);
      if (due.length === 0) return;
      const [id, timer] = due[0];
      timers.delete(id);
      timer.callback();
    }
  }

  return {
    clearTimeout(id) {
      timers.delete(id);
    },
    now() {
      return nowMs;
    },
    setTimeout(callback, delayMs) {
      const id = nextTimerId++;
      timers.set(id, { at: nowMs + delayMs, callback });
      return id;
    },
    tickTo(value) {
      assert.ok(value >= nowMs);
      nowMs = value;
      runDue();
    },
  };
}

class FakeSocket {
  constructor(url) {
    this.url = url;
    this.closed = [];
    this.handlers = new Map();
    this.sent = [];
  }

  on(name, handler) {
    const handlers = this.handlers.get(name) ?? [];
    handlers.push(handler);
    this.handlers.set(name, handlers);
    return this;
  }

  emit(name, ...args) {
    for (const handler of this.handlers.get(name) ?? []) handler(...args);
  }

  open() {
    this.emit("open");
  }

  receive(message) {
    this.emit("message", JSON.stringify(message));
  }

  disconnect() {
    this.emit("close", 1006, Buffer.from("network"));
  }

  send(raw) {
    this.sent.push(JSON.parse(raw));
  }

  close(code, reason) {
    this.closed.push({ code, reason });
  }
}

function createSockets() {
  const sockets = [];
  return {
    socketFactory(url) {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    sockets,
  };
}

function createAgentManagerFactory() {
  const calls = {
    closeDecision: [],
    create: [],
    disposeCount: 0,
    openDecision: [],
  };
  let options;
  const manager = {
    closeDecision(value) {
      calls.closeDecision.push(value);
      return true;
    },
    async dispose() {
      calls.disposeCount += 1;
    },
    getDecision() {
      return undefined;
    },
    async openDecision(value) {
      calls.openDecision.push(value);
      return {
        seatId: value.seatId,
        decisionId: value.decisionId,
        status: "prompted",
      };
    },
  };
  return {
    calls,
    factory: async (value) => {
      options = value;
      calls.create.push(value);
      return manager;
    },
    get options() {
      return options;
    },
    manager,
  };
}

function seat(overrides = {}) {
  return {
    gameId: "game-1",
    wsUrl: "ws://127.0.0.1:8787/v1/tables/game-1/ws",
    seat: 1,
    seatCredential: "secret-seat-credential",
    provider: "deepseek",
    model: "deepseek-chat",
    modelLabel: "DeepSeek-Chat",
    ...overrides,
  };
}

async function setup(overrides = {}) {
  const clock = overrides.clock ?? createClock();
  const socketHarness = createSockets();
  const agentHarness = createAgentManagerFactory();
  let requestSequence = 0;
  const runtime = await createSeatRuntime({
    ctx: {},
    seats: [seat()],
    clock,
    socketFactory: socketHarness.socketFactory,
    seatAgentManagerFactory: agentHarness.factory,
    requestIdFactory: () => `request-${++requestSequence}`,
    ...overrides,
  });
  return {
    agentHarness,
    clock,
    runtime,
    socketHarness,
  };
}

function completeHandshake(socket) {
  socket.open();
  socket.receive({ type: "DSH_SEAT_JOINED", gameId: "game-1", seat: 1,
    kind: "ai", ok: true, resumeCredential: "resume-seat-secret" });
  socket.receive({
    type: "JOINED",
    gameId: "game-1",
    playerId: "player-ai-1",
    isFirst: false,
    authoritative: true,
  });
  socket.receive({
    type: "AI_SEAT_BIND_ACK",
    gameId: "game-1",
    seat: 1,
    ok: true,
    modelId: "deepseek-chat",
    modelLabel: "DeepSeek-Chat",
  });
}

test("redeems a DSH seat credential, keeps its resume credential in memory, and skips mutable seat updates", async () => {
  const clock = createClock();
  const { runtime, socketHarness } = await setup({
    clock,
    seats: [seat({ seatCredential: "one-time-seat-secret" })],
  });
  const first = socketHarness.sockets[0];
  first.open();
  assert.deepEqual(first.sent, [{
    type: "DSH_SEAT_JOIN",
    gameId: "game-1",
    seat: 1,
    seatCredential: "one-time-seat-secret",
  }]);
  first.receive({
    type: "JOINED",
    gameId: "game-1",
    playerId: "player-ai-1",
    isFirst: false,
    authoritative: true,
  });
  assert.equal(first.sent.length, 1, "binding waits for the credential ACK");
  first.receive({
    type: "DSH_SEAT_JOINED",
    gameId: "game-1",
    seat: 1,
    kind: "ai",
    ok: true,
    resumeCredential: "resume-seat-secret",
  });
  assert.deepEqual(first.sent.slice(1), [{
    type: "AI_SEAT_BIND",
    gameId: "game-1",
    seat: 1,
    modelId: "deepseek-chat",
    modelLabel: "DeepSeek-Chat",
  }]);
  first.receive({
    type: "AI_SEAT_BIND_ACK",
    gameId: "game-1",
    seat: 1,
    ok: true,
  });
  first.disconnect();
  clock.tickTo(250);
  const second = socketHarness.sockets[1];
  second.open();
  assert.deepEqual(second.sent[0], {
    type: "DSH_SEAT_JOIN",
    gameId: "game-1",
    seat: 1,
    seatCredential: "resume-seat-secret",
  });
  await runtime.dispose();
});

test("redacts DSH claim and resume credentials echoed through join or bind errorCode", async () => {
  const claimCredential = "one-time-seat-secret";
  const joinErrors = [];
  const joining = await setup({
    seats: [seat({ seatCredential: claimCredential })],
    onError(error) {
      joinErrors.push({ code: error.code, message: error.message });
    },
  });
  joining.socketHarness.sockets[0].open();
  joining.socketHarness.sockets[0].receive({
    type: "DSH_SEAT_JOINED",
    gameId: "game-1",
    seat: 1,
    kind: "ai",
    ok: false,
    errorCode: `LEAK_${claimCredential}`,
    error: `server echoed ${claimCredential}`,
  });
  assert.equal(joinErrors.at(-1)?.code, "DSH_SEAT_JOIN_REJECTED");
  assert.doesNotMatch(JSON.stringify(joinErrors), new RegExp(claimCredential));
  await joining.runtime.dispose();

  const resumeCredential = "resume-seat-secret";
  const bindErrors = [];
  const binding = await setup({
    seats: [seat({ seatCredential: claimCredential })],
    onError(error) {
      bindErrors.push({ code: error.code, message: error.message });
    },
  });
  const socket = binding.socketHarness.sockets[0];
  socket.open();
  socket.receive({
    type: "JOINED",
    gameId: "game-1",
    playerId: "player-ai-1",
    isFirst: false,
    authoritative: true,
  });
  socket.receive({
    type: "DSH_SEAT_JOINED",
    gameId: "game-1",
    seat: 1,
    kind: "ai",
    ok: true,
    resumeCredential,
  });
  socket.receive({
    type: "AI_SEAT_BIND_ACK",
    gameId: "game-1",
    seat: 1,
    ok: false,
    errorCode: `LEAK_${resumeCredential}`,
    error: `server echoed ${resumeCredential}`,
  });
  assert.equal(bindErrors.at(-1)?.code, "AI_SEAT_BIND_REJECTED");
  assert.doesNotMatch(JSON.stringify(bindErrors), new RegExp(resumeCredential));
  assert.doesNotMatch(JSON.stringify(bindErrors), new RegExp(claimCredential));
  await binding.runtime.dispose();
});

test("passes the untouched server decision envelope and legal action ids to the seat agent", async () => {
  const { agentHarness, runtime, socketHarness } = await setup();
  const socket = socketHarness.sockets[0];
  completeHandshake(socket);
  const decision = {
    schemaVersion: 1,
    gameId: "game-1",
    seat: 1,
    decisionId: "decision-1",
    openedAtMs: 10_000,
    deadlineAtMs: 48_000,
    ownHand: ["1m", "2m"],
    legalActions: [
      { legalActionId: "legal-a", label: "打一万" },
      { legalActionId: "legal-b", label: "打二万" },
    ],
  };
  socket.receive({ type: "AI_DECISION", gameId: "game-1", seat: 1, decision });
  await Promise.resolve();

  assert.deepEqual(agentHarness.calls.openDecision, [
    {
      seatId: "game-1:1",
      decisionId: "decision-1",
      stateBlock: JSON.stringify(decision),
      actionIds: ["legal-a", "legal-b"],
      openedAtMs: 10_000,
      deadlineAtMs: 48_000,
    },
  ]);
  await runtime.dispose();
});

test("does not lose a decision synchronously published before the bind ACK", async () => {
  const { agentHarness, runtime, socketHarness } = await setup();
  const socket = socketHarness.sockets[0];
  socket.open();
  socket.receive({
    type: "JOINED",
    gameId: "game-1",
    playerId: "player-ai-1",
    isFirst: false,
    authoritative: true,
  });
  socket.receive({type: "DSH_SEAT_JOINED", gameId: "game-1", seat: 1,
    kind: "ai", ok: true, resumeCredential: "resume-seat-secret"});
  const decision = {
    schemaVersion: 1,
    gameId: "game-1",
    seat: 1,
    decisionId: "decision-before-ack",
    openedAtMs: 1_000,
    deadlineAtMs: 39_000,
    legalActions: [{ legalActionId: "legal-a" }],
  };
  socket.receive({ type: "AI_DECISION", gameId: "game-1", seat: 1, decision });
  assert.equal(agentHarness.calls.openDecision.length, 0);

  socket.receive({
    type: "AI_SEAT_BIND_ACK",
    gameId: "game-1",
    seat: 1,
    ok: true,
  });
  await Promise.resolve();
  assert.equal(agentHarness.calls.openDecision.length, 1);
  assert.equal(agentHarness.calls.openDecision[0].decisionId, "decision-before-ack");
  assert.deepEqual(socket.sent.at(-1), {
    type: "AI_DECISION_GET",
    gameId: "game-1",
  });

  await runtime.dispose();
});

test("never carries a pre-bind decision across socket generations", async () => {
  const clock = createClock();
  const { agentHarness, runtime, socketHarness } = await setup({ clock });
  const first = socketHarness.sockets[0];
  first.open();
  first.receive({
    type: "JOINED",
    gameId: "game-1",
    playerId: "player-ai-1",
    isFirst: false,
    authoritative: true,
  });
  first.receive({
    type: "AI_DECISION",
    gameId: "game-1",
    seat: 1,
    decision: {
      gameId: "game-1",
      seat: 1,
      decisionId: "stale-from-first-socket",
      openedAtMs: 0,
      deadlineAtMs: 38_000,
      legalActions: [{ legalActionId: "legal-a" }],
    },
  });
  first.disconnect();
  clock.tickTo(250);

  const second = socketHarness.sockets[1];
  completeHandshake(second);
  await Promise.resolve();
  assert.equal(agentHarness.calls.openDecision.length, 0);
  assert.deepEqual(second.sent.at(-1), {
    type: "AI_DECISION_GET",
    gameId: "game-1",
  });

  await runtime.dispose();
});

test("correlates ACTION_ACK and keeps one idempotent requestId across reconnect", async () => {
  const clock = createClock();
  const { agentHarness, runtime, socketHarness } = await setup({ clock });
  const first = socketHarness.sockets[0];
  completeHandshake(first);
  const signal = new AbortController().signal;
  let settled = false;
  const submission = agentHarness.options.submitAction({
    seatId: "game-1:1",
    decisionId: "decision-1",
    actionId: "legal-a",
    signal,
  }).then(() => {
    settled = true;
  });
  assert.deepEqual(first.sent.at(-1), {
    type: "ACTION",
    gameId: "game-1",
    actionId: "request-1",
    action: {
      kind: "aiDecision",
      decisionId: "decision-1",
      legalActionId: "legal-a",
    },
  });

  first.receive({
    type: "ACTION_ACK",
    gameId: "game-1",
    actionId: "another-request",
    ok: true,
  });
  await Promise.resolve();
  assert.equal(settled, false);

  first.disconnect();
  clock.tickTo(250);
  assert.equal(socketHarness.sockets.length, 2);
  const second = socketHarness.sockets[1];
  completeHandshake(second);
  assert.deepEqual(second.sent.slice(-2), [
    {
      type: "ACTION",
      gameId: "game-1",
      actionId: "request-1",
      action: {
        kind: "aiDecision",
        decisionId: "decision-1",
        legalActionId: "legal-a",
      },
    },
    { type: "AI_DECISION_GET", gameId: "game-1" },
  ]);

  second.receive({
    type: "ACTION_ACK",
    gameId: "game-1",
    actionId: "request-1",
    ok: true,
  });
  await submission;
  assert.equal(settled, true);
  await runtime.dispose();
});

test("reconnects with exponential backoff and always rebinds before GET", async () => {
  const clock = createClock();
  const { runtime, socketHarness } = await setup({ clock });
  const first = socketHarness.sockets[0];
  completeHandshake(first);
  first.disconnect();

  clock.tickTo(249);
  assert.equal(socketHarness.sockets.length, 1);
  clock.tickTo(250);
  assert.equal(socketHarness.sockets.length, 2);
  const second = socketHarness.sockets[1];
  second.open();
  second.disconnect();

  clock.tickTo(749);
  assert.equal(socketHarness.sockets.length, 2);
  clock.tickTo(750);
  assert.equal(socketHarness.sockets.length, 3);
  const third = socketHarness.sockets[2];
  completeHandshake(third);
  assert.deepEqual(
    third.sent.map(({ type }) => type),
    ["DSH_SEAT_JOIN", "AI_SEAT_BIND", "AI_DECISION_GET"],
  );

  await runtime.dispose();
});

test("maps timeout_top1 closure to an immediate seat-agent timeout close", async () => {
  const { agentHarness, runtime, socketHarness } = await setup();
  const socket = socketHarness.sockets[0];
  completeHandshake(socket);
  socket.receive({
    type: "AI_DECISION_CLOSED",
    gameId: "game-1",
    seat: 1,
    decisionId: "decision-1",
    source: "timeout_top1",
    reason: "resolved",
    ok: true,
  });

  assert.deepEqual(agentHarness.calls.closeDecision, [
    {
      seatId: "game-1:1",
      decisionId: "decision-1",
      reason: "timeout",
    },
  ]);
  await runtime.dispose();
});

test("defers an agent-source close until its earlier server ACK settles", async () => {
  const { agentHarness, runtime, socketHarness } = await setup();
  const socket = socketHarness.sockets[0];
  completeHandshake(socket);
  const submission = agentHarness.options.submitAction({
    seatId: "game-1:1",
    decisionId: "decision-1",
    actionId: "legal-a",
    signal: new AbortController().signal,
  });
  socket.receive({
    type: "AI_DECISION_CLOSED",
    gameId: "game-1",
    seat: 1,
    decisionId: "decision-1",
    source: "agent",
    reason: "resolved",
    ok: true,
  });
  assert.equal(agentHarness.calls.closeDecision.length, 0);
  socket.receive({
    type: "ACTION_ACK",
    gameId: "game-1",
    actionId: "request-1",
    ok: true,
  });
  await submission;
  await Promise.resolve();
  assert.deepEqual(agentHarness.calls.closeDecision, [
    {
      seatId: "game-1:1",
      decisionId: "decision-1",
      reason: "resolved",
    },
  ]);
  await runtime.dispose();
});

test("keeps ACK-then-close ordering idempotent within the same event turn", async () => {
  const { agentHarness, runtime, socketHarness } = await setup();
  const socket = socketHarness.sockets[0];
  completeHandshake(socket);
  const submission = agentHarness.options.submitAction({
    seatId: "game-1:1",
    decisionId: "decision-1",
    actionId: "legal-a",
    signal: new AbortController().signal,
  });
  socket.receive({
    type: "ACTION_ACK",
    gameId: "game-1",
    actionId: "request-1",
    ok: true,
  });
  socket.receive({
    type: "AI_DECISION_CLOSED",
    gameId: "game-1",
    seat: 1,
    decisionId: "decision-1",
    source: "agent",
    reason: "resolved",
    ok: true,
  });
  assert.equal(agentHarness.calls.closeDecision.length, 0);

  await submission;
  await Promise.resolve();
  assert.deepEqual(agentHarness.calls.closeDecision, [
    {
      seatId: "game-1:1",
      decisionId: "decision-1",
      reason: "resolved",
    },
  ]);
  await runtime.dispose();
});

test("dispose closes sockets, rejects pending ACKs, and disposes the manager once", async () => {
  const { agentHarness, runtime, socketHarness } = await setup();
  const socket = socketHarness.sockets[0];
  completeHandshake(socket);
  const pending = agentHarness.options.submitAction({
    seatId: "game-1:1",
    decisionId: "decision-1",
    actionId: "legal-a",
    signal: new AbortController().signal,
  });

  const first = runtime.dispose();
  const second = runtime.dispose();
  assert.equal(first, second);
  await assert.rejects(pending, (error) => error?.code === "RUNTIME_DISPOSED");
  await first;
  assert.equal(socket.closed.length, 1);
  assert.equal(agentHarness.calls.disposeCount, 1);
});

test("reports a terminal seat halt so host status cannot retain a stale ready count", async () => {
  const events = [];
  const { runtime, socketHarness } = await setup({
    onEvent(event) {
      events.push(event);
    },
  });
  const socket = socketHarness.sockets[0];
  completeHandshake(socket);
  socket.receive({ type: "ERROR", error: "binding is no longer valid" });

  assert.deepEqual(events.at(-1), {
    type: "connection-halted",
    seatId: "game-1:1",
  });
  assert.equal(socket.closed.length, 1);
  await runtime.dispose();
});

test("rejects request ids whose server-normalized ACK could not correlate", async () => {
  const { agentHarness, runtime, socketHarness } = await setup({
    requestIdFactory: () => " request-1 ",
  });
  completeHandshake(socketHarness.sockets[0]);
  assert.throws(
    () => agentHarness.options.submitAction({
      seatId: "game-1:1",
      decisionId: "decision-1",
      actionId: "legal-a",
      signal: new AbortController().signal,
    }),
    (error) => error?.code === "REQUEST_ID_INVALID",
  );
  await runtime.dispose();
});

test("strictly rejects invalid config and non-WebSocket URLs", async () => {
  const socketHarness = createSockets();
  const agentHarness = createAgentManagerFactory();
  const common = {
    ctx: {},
    socketFactory: socketHarness.socketFactory,
    seatAgentManagerFactory: agentHarness.factory,
  };

  await assert.rejects(
    createSeatRuntime({ ...common, seats: [seat({ wsUrl: "https://example.com" })] }),
    (error) => error?.code === "INVALID_CONFIG",
  );
  await assert.rejects(
    createSeatRuntime({ ...common, seats: [seat({ wsUrl: "ws://example.com" })] }),
    (error) => error?.code === "INVALID_CONFIG",
  );
  await assert.rejects(
    createSeatRuntime({
      ...common,
      seats: [seat({ wsUrl: "wss://mahjong.example.com/socket?token=must-not-travel" })],
    }),
    (error) => error?.code === "INVALID_CONFIG",
  );
  await assert.rejects(
    createSeatRuntime({ ...common, seats: [seat({ seat: 4 })] }),
    (error) => error?.code === "INVALID_CONFIG",
  );
  await assert.rejects(
    createSeatRuntime({ ...common, seats: [seat({ unexpected: true })] }),
    (error) => error?.code === "INVALID_CONFIG",
  );
  await assert.rejects(
    createSeatRuntime({
      ...common,
      seats: [
        seat({ seat: 0 }),
        seat({ seat: 1 }),
      ],
    }),
    (error) =>
      error?.code === "INVALID_CONFIG" &&
      !error.message.includes("secret-seat-credential"),
  );

  const secureRemote = await createSeatRuntime({
    ...common,
    seats: [seat({ wsUrl: "wss://mahjong.example.com" })],
  });
  assert.equal(socketHarness.sockets.at(-1).url, "wss://mahjong.example.com");
  await secureRemote.dispose();
});

test("never exposes the seat credential through events, diagnostics, or errors", async () => {
  const exposed = [];
  const token = "do-not-log-this-token";
  const { agentHarness, runtime, socketHarness } = await setup({
    seats: [seat({ seatCredential: token })],
    onEvent(event) {
      exposed.push(event);
    },
    onError(error) {
      exposed.push({ code: error.code, message: error.message });
    },
  });
  const socket = socketHarness.sockets[0];
  completeHandshake(socket);
  const action = agentHarness.options.submitAction({
    seatId: "game-1:1",
    decisionId: "decision-1",
    actionId: "legal-a",
    signal: new AbortController().signal,
  });
  socket.receive({
    type: "ACTION_ACK",
    gameId: "game-1",
    actionId: "request-1",
    ok: false,
    errorCode: "AI_REJECTED",
    error: `server accidentally echoed ${token}`,
  });
  await assert.rejects(action, (error) => {
    exposed.push({ code: error.code, message: error.message });
    return error?.code === "ACTION_REJECTED";
  });
  socket.emit("error", new Error(`network accidentally echoed ${token}`));

  assert.doesNotMatch(JSON.stringify(exposed), new RegExp(token));
  const source = await readFile(new URL("../lib/seat-runtime.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /console\.(?:log|info|warn|error|debug)/);
  await runtime.dispose();
});

test("legacy API authentication and an omitted socket address are rejected before connecting", async () => {
  for (const overrides of [{apiToken: 'legacy-token'}, {wsUrl: undefined}, {seatCredential: undefined}]) {
    await assert.rejects(setup({seats: [seat(overrides)]}), {code: 'INVALID_CONFIG'});
  }
});

test("a replaced AI seat stops retrying and rejects any pending action", async () => {
  const errors = [];
  const {runtime, socketHarness, agentHarness, clock} = await setup({onError: error => errors.push(error.code)});
  const socket = socketHarness.sockets[0];
  completeHandshake(socket);
  const pending = agentHarness.options.submitAction({seatId: "game-1:1", decisionId: "decision-1", actionId: "legal-a", signal: new AbortController().signal});
  agentHarness.manager.getDecision = () => ({decisionId: "decision-1"});
  socket.emit("close", 4001);
  await assert.rejects(pending, {code: "SEAT_REPLACED"});
  clock.tickTo(60000);
  assert.equal(socketHarness.sockets.length, 1);
  assert.deepEqual(errors, ["SEAT_REPLACED"]);
  assert.deepEqual(agentHarness.calls.closeDecision, [{seatId: "game-1:1", decisionId: "decision-1", reason: "connection-halted"}]);
  await runtime.dispose();
});
