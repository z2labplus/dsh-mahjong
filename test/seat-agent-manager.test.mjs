import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DEFAULT_DECISION_TIMEOUT_MS,
  SUBMIT_ACTION_TOOL_NAME,
  createSeatAgentManager,
} from "../lib/seat-agent-manager.js";

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

  function runDueTimers() {
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
      assert.ok(value >= nowMs, "fake time cannot move backwards");
      nowMs = value;
      runDueTimers();
    },
  };
}

function createHarness({ persistedHeaders = [], listError, resumeError } = {}) {
  const records = {
    agents: new Map(),
    createOptions: [],
    definedTools: [],
    disposed: [],
    installedSelections: [],
    messages: [],
    persistenceListCount: 0,
    resumeOptions: [],
    sessionIds: [],
  };
  let messageSequence = 0;

  const runtime = {
    createUserMessage(input) {
      const message = Object.freeze({
        ...input,
        id: `message-${++messageSequence}`,
        role: "user",
      });
      records.messages.push(message);
      return message;
    },
    defineTool(options) {
      records.definedTools.push(options);
      return options;
    },
    installModelSelection(agentCtx, selection) {
      records.installedSelections.push({ agentCtx, selection });
      return () => {};
    },
    SessionId(value) {
      records.sessionIds.push(value);
      return value;
    },
  };

  async function createFakeAgent(options, sessionId) {
        const calls = {
          cancels: [],
          disposeCount: 0,
          followups: [],
          events: new Map(),
          idleQueue: [],
          register: [],
          restrict: [],
          sections: [],
          variables: [],
          whenIdleCount: 0,
        };
        const agent = {
          cancel(cause) {
            calls.cancels.push(cause);
          },
          followup(message) {
            calls.followups.push(message);
          },
          whenIdle() {
            calls.whenIdleCount += 1;
            return calls.idleQueue.shift() ?? Promise.resolve();
          },
        };
        const agentCtx = {
          agent,
          on(name, callback) { calls.events.set(name, callback); return () => calls.events.delete(name); },
          systemPrompt: {
            section(section) {
              calls.sections.push(section);
              return () => {};
            },
            variable(name, provider) {
              calls.variables.push({ name, provider });
              return () => {};
            },
          },
          tools: {
            register(tool) {
              calls.register.push(tool);
              return () => {};
            },
            restrict(filter) {
              calls.restrict.push(filter);
              return () => {};
            },
          },
        };
        await options.setup(agentCtx);
        const handle = {
          agent,
          async dispose() {
            calls.disposeCount += 1;
            records.disposed.push(sessionId);
          },
        };
        records.agents.set(sessionId, { agentCtx, calls, handle });
        return handle;
  }

  const ctx = {
    agents: {
      async create(options) {
        records.createOptions.push(options);
        return createFakeAgent(options, options.sessionId);
      },
      get(sessionId) {
        return records.agents.get(sessionId)?.handle.agent;
      },
      async resume(options) {
        records.resumeOptions.push(options);
        if (resumeError !== undefined) throw resumeError;
        return createFakeAgent(options, options.resumeSessionId);
      },
    },
    sessionPersistence: {
      async list() {
        records.persistenceListCount += 1;
        if (listError !== undefined) throw listError;
        return persistedHeaders;
      },
    },
  };

  return { ctx, records, runtime };
}

function seat(overrides = {}) {
  return {
    seatId: "game-1:east",
    sessionId: "dsh-mahjong:game-1:east",
    provider: "deepseek",
    model: "deepseek-chat",
    ...overrides,
  };
}

function decision(overrides = {}) {
  return {
    seatId: "game-1:east",
    decisionId: "decision-1",
    stateBlock: "private hand for east plus public table state",
    actionIds: ["action-a", "action-b"],
    openedAtMs: 0,
    deadlineAtMs: DEFAULT_DECISION_TIMEOUT_MS,
    ...overrides,
  };
}

function execution() {
  const controller = new AbortController();
  let concludes = 0;
  return {
    exec: {
      signal: controller.signal,
      concludeTurn() {
        concludes += 1;
      },
    },
    get concludes() {
      return concludes;
    },
  };
}

function getAgent(records, sessionId = "dsh-mahjong:game-1:east") {
  const entry = records.agents.get(sessionId);
  assert.ok(entry, `missing fake agent ${sessionId}`);
  return entry;
}

test("creates one persistent, isolated Harness agent per AI seat", async () => {
  const clock = createClock();
  const { ctx, records, runtime } = createHarness();
  const manager = await createSeatAgentManager({
    ctx,
    runtime,
    clock,
    submitAction: async () => {},
    seats: [
      seat(),
      seat({
        seatId: "game-1:south",
        sessionId: "dsh-mahjong:game-1:south",
        provider: "openai",
        model: "gpt-4.1-mini",
      }),
    ],
  });

  assert.equal(records.createOptions.length, 2);
  assert.deepEqual(records.sessionIds, [
    "dsh-mahjong:game-1:east",
    "dsh-mahjong:game-1:south",
  ]);
  assert.deepEqual(
    records.createOptions.map(({ agentOptions }) => agentOptions),
    [
      { provider: "deepseek", model: "deepseek-chat" },
      { provider: "openai", model: "gpt-4.1-mini" },
    ],
  );
  assert.deepEqual(
    records.createOptions.map(({ meta }) => meta),
    [
      { origin: "subagent", delegationDepth: 1 },
      { origin: "subagent", delegationDepth: 1 },
    ],
  );
  assert.equal(records.persistenceListCount, 1);
  assert.equal(records.resumeOptions.length, 0);
  assert.deepEqual(
    records.installedSelections.map(({ selection }) => selection.current),
    [
      { provider: "deepseek", model: "deepseek-chat" },
      { provider: "openai", model: "gpt-4.1-mini" },
    ],
  );

  for (const entry of records.agents.values()) {
    assert.deepEqual(entry.calls.restrict, [{ allow: [] }]);
    assert.equal(entry.calls.register.length, 1);
    assert.equal(entry.calls.sections.length, 1);
    assert.equal(entry.calls.sections[0].name, "dsh-mahjong:current-seat-state");
    assert.equal(entry.calls.variables.length, 1);
    assert.equal(entry.calls.variables[0].name, "cwd");
    assert.equal(entry.calls.variables[0].provider(), process.cwd());
    assert.equal(entry.calls.register[0].name, SUBMIT_ACTION_TOOL_NAME);
    assert.deepEqual(Object.keys(entry.calls.register[0].parameters).sort(), [
      "actionId",
      "decisionId",
    ]);
  }

  await manager.openDecision(decision());
  await manager.openDecision(
    decision({
      decisionId: "decision-2",
      deadlineAtMs: 76_000,
    }),
  );
  assert.equal(records.createOptions.length, 2, "new decisions must reuse the seat agent");

  await manager.dispose();
});

test("resumes a persisted hidden seat session and rejects metadata collisions", async () => {
  const clock = createClock();
  const hiddenHeader = {
    version: 0,
    id: "dsh-mahjong:game-1:east",
    createdAt: 1,
    origin: "subagent",
    delegationDepth: 1,
  };
  const resumedHarness = createHarness({ persistedHeaders: [hiddenHeader] });
  const manager = await createSeatAgentManager({
    ctx: resumedHarness.ctx,
    runtime: resumedHarness.runtime,
    clock,
    seats: [seat()],
    submitAction: async () => {},
  });

  assert.equal(resumedHarness.records.createOptions.length, 0);
  assert.equal(resumedHarness.records.resumeOptions.length, 1);
  assert.equal(
    resumedHarness.records.resumeOptions[0].resumeSessionId,
    "dsh-mahjong:game-1:east",
  );
  await manager.dispose();

  const collisionHarness = createHarness({
    persistedHeaders: [{ ...hiddenHeader, origin: undefined, delegationDepth: undefined }],
  });
  await assert.rejects(
    createSeatAgentManager({
      ctx: collisionHarness.ctx,
      runtime: collisionHarness.runtime,
      clock: createClock(),
      seats: [seat()],
      submitAction: async () => {},
    }),
    (error) => error?.code === "SEAT_SESSION_METADATA_MISMATCH",
  );
  assert.equal(collisionHarness.records.createOptions.length, 0);
  assert.equal(collisionHarness.records.resumeOptions.length, 0);
});

test("propagates persistence and resume failures without falling back to create", async () => {
  const listFailure = new Error("persistence unavailable");
  const listHarness = createHarness({ listError: listFailure });
  await assert.rejects(
    createSeatAgentManager({
      ctx: listHarness.ctx,
      runtime: listHarness.runtime,
      clock: createClock(),
      seats: [seat()],
      submitAction: async () => {},
    }),
    (error) => error === listFailure,
  );
  assert.equal(listHarness.records.createOptions.length, 0);
  assert.equal(listHarness.records.resumeOptions.length, 0);

  const resumeFailure = new Error("persisted log is corrupt");
  const resumeHarness = createHarness({
    persistedHeaders: [{
      version: 0,
      id: "dsh-mahjong:game-1:east",
      createdAt: 1,
      origin: "subagent",
      delegationDepth: 1,
    }],
    resumeError: resumeFailure,
  });
  await assert.rejects(
    createSeatAgentManager({
      ctx: resumeHarness.ctx,
      runtime: resumeHarness.runtime,
      clock: createClock(),
      seats: [seat()],
      submitAction: async () => {},
    }),
    (error) => error === resumeFailure,
  );
  assert.equal(resumeHarness.records.resumeOptions.length, 1);
  assert.equal(resumeHarness.records.createOptions.length, 0);
});

test("keeps the private hand out of durable messages and only exposes it in the live system section", async () => {
  const clock = createClock();
  const { ctx, records, runtime } = createHarness();
  const manager = await createSeatAgentManager({
    ctx,
    runtime,
    clock,
    seats: [seat()],
    submitAction: async () => {},
  });
  const privateState = "private concealed hand: 1m 2m 3m";
  await manager.openDecision(decision({ stateBlock: privateState }));
  const entry = getAgent(records);
  const section = entry.calls.sections[0];

  assert.equal(records.messages.length, 1);
  assert.doesNotMatch(records.messages[0].content[0].text, /private concealed hand/);
  assert.match(records.messages[0].content[0].text, /立即调用 submit_mahjong_action/);
  assert.match(records.messages[0].content[0].text, /禁止输出分析、解释、复述/);
  assert.match(section.text({}), /private concealed hand: 1m 2m 3m/);
  assert.match(section.text({}), /实时座位动作控制器/);
  assert.match(section.text({}), /工具调用必须是响应的第一项/);

  manager.closeDecision({
    seatId: "game-1:east",
    decisionId: "decision-1",
    reason: "server-closed",
  });
  assert.equal(section.text({}), "");
  await manager.dispose();
});

test("accepts at 37,999 ms and closes at the 38,000 ms half-open boundary", async () => {
  const clock = createClock();
  const { ctx, records, runtime } = createHarness();
  const submissions = [];
  const manager = await createSeatAgentManager({
    ctx,
    runtime,
    clock,
    seats: [seat()],
    async submitAction(value) {
      submissions.push(value);
    },
  });
  await manager.openDecision(decision());

  const entry = getAgent(records);
  const tool = entry.calls.register[0];
  clock.tickTo(37_999);
  const acceptedExecution = execution();
  const accepted = await tool.execute(
    { decisionId: "decision-1", actionId: "action-a" },
    acceptedExecution.exec,
  );
  assert.deepEqual(accepted, {
    decisionId: "decision-1",
    actionId: "action-a",
  });
  assert.equal(acceptedExecution.concludes, 1);
  assert.deepEqual(submissions, [
    {
      seatId: "game-1:east",
      decisionId: "decision-1",
      actionId: "action-a",
      signal: acceptedExecution.exec.signal,
    },
  ]);

  await manager.openDecision(
    decision({
      decisionId: "decision-2",
      actionIds: ["action-c"],
      openedAtMs: 38_000,
      deadlineAtMs: 76_000,
    }),
  );
  clock.tickTo(76_000);
  const lateExecution = execution();
  await assert.rejects(
    tool.execute(
      { decisionId: "decision-2", actionId: "action-c" },
      lateExecution.exec,
    ),
    (error) => error?.code === "DECISION_CLOSED",
  );
  assert.equal(submissions.length, 1);
  assert.equal(lateExecution.concludes, 0);

  await manager.dispose();
});

test("timeout closes the gate before cancel and never waits for idle", async () => {
  const clock = createClock();
  const { ctx, records, runtime } = createHarness();
  const events = [];
  const manager = await createSeatAgentManager({
    ctx,
    runtime,
    clock,
    seats: [seat()],
    submitAction: async () => {},
    onEvent(event) {
      events.push(event);
    },
  });
  await manager.openDecision(decision());
  const entry = getAgent(records);
  const neverIdle = deferred();
  entry.calls.idleQueue.push(neverIdle.promise);
  const idleCallsBeforeTimeout = entry.calls.whenIdleCount;

  entry.agentCtx.agent.cancel = (cause) => {
    assert.equal(manager.getDecision("game-1:east").status, "timed-out");
    events.push({ type: "agent-cancel", cause });
  };
  clock.tickTo(38_000);

  assert.equal(entry.calls.whenIdleCount, idleCallsBeforeTimeout);
  assert.deepEqual(
    events.slice(-2).map(({ type }) => type),
    ["decision-closed", "agent-cancel"],
  );
  assert.equal(events.at(-2).reason, "timeout");
  assert.deepEqual(events.at(-1).cause, {
    kind: "hook",
    reason: "dsh-mahjong decision timeout",
  });

  neverIdle.resolve();
  await manager.dispose();
});

test("a pre-deadline submission trusts a successful authoritative ACK after the deadline", async () => {
  const clock = createClock();
  const { ctx, records, runtime } = createHarness();
  const transport = deferred();
  const manager = await createSeatAgentManager({
    ctx,
    runtime,
    clock,
    seats: [seat()],
    submitAction: async () => transport.promise,
  });
  await manager.openDecision(decision());
  const tool = getAgent(records).calls.register[0];
  const pendingExecution = execution();

  clock.tickTo(37_999);
  const pending = tool.execute(
    { decisionId: "decision-1", actionId: "action-a" },
    pendingExecution.exec,
  );
  assert.equal(manager.getDecision("game-1:east").status, "submitting");

  clock.tickTo(38_000);
  assert.equal(manager.getDecision("game-1:east").status, "submitting");
  transport.resolve();
  assert.deepEqual(await pending, {
    decisionId: "decision-1",
    actionId: "action-a",
  });
  assert.equal(manager.getDecision("game-1:east").status, "submitted");
  assert.equal(pendingExecution.concludes, 1);

  await manager.dispose();
});

test("an authoritative timeout close still wins an in-flight submission", async () => {
  const clock = createClock();
  const { ctx, records, runtime } = createHarness();
  const transport = deferred();
  const manager = await createSeatAgentManager({
    ctx,
    runtime,
    clock,
    seats: [seat()],
    submitAction: async () => transport.promise,
  });
  await manager.openDecision(decision());
  const tool = getAgent(records).calls.register[0];
  const pendingExecution = execution();
  clock.tickTo(37_999);
  const pending = tool.execute(
    { decisionId: "decision-1", actionId: "action-a" },
    pendingExecution.exec,
  );

  clock.tickTo(38_000);
  assert.equal(manager.getDecision("game-1:east").status, "submitting");
  assert.equal(manager.closeDecision({
    seatId: "game-1:east",
    decisionId: "decision-1",
    reason: "timeout",
  }), true);
  assert.equal(manager.getDecision("game-1:east").status, "timed-out");
  transport.resolve();
  await assert.rejects(pending, (error) => error?.code === "DECISION_CLOSED");
  assert.equal(pendingExecution.concludes, 0);

  await manager.dispose();
});

test("a new decision drains the previous agent before sending its prompt", async () => {
  const clock = createClock();
  const { ctx, records, runtime } = createHarness();
  const manager = await createSeatAgentManager({
    ctx,
    runtime,
    clock,
    seats: [seat()],
    submitAction: async () => {},
  });
  await manager.openDecision(decision());
  const entry = getAgent(records);
  assert.equal(entry.calls.followups.length, 1);

  const drain = deferred();
  entry.calls.idleQueue.push(drain.promise);
  const opening = manager.openDecision(
    decision({
      decisionId: "decision-2",
      openedAtMs: 1_000,
      deadlineAtMs: 39_000,
    }),
  );
  await Promise.resolve();
  assert.equal(entry.calls.followups.length, 1);

  drain.resolve();
  assert.deepEqual(await opening, {
    seatId: "game-1:east",
    decisionId: "decision-2",
    status: "prompted",
  });
  assert.equal(entry.calls.followups.length, 2);
  assert.match(entry.calls.followups[1].content[0].text, /decision-2/);
  assert.match(entry.calls.followups[1].content[0].text, /action-a/);

  await manager.dispose();
});

test("a deadline reached while draining resolves immediately and sends no stale prompt", async () => {
  const clock = createClock();
  const { ctx, records, runtime } = createHarness();
  const manager = await createSeatAgentManager({
    ctx,
    runtime,
    clock,
    seats: [seat()],
    submitAction: async () => {},
  });
  await manager.openDecision(decision());
  const entry = getAgent(records);
  const drain = deferred();
  entry.calls.idleQueue.push(drain.promise);
  const opening = manager.openDecision(
    decision({
      decisionId: "decision-2",
      openedAtMs: 1_000,
      deadlineAtMs: 2_000,
    }),
  );

  clock.tickTo(2_000);
  assert.deepEqual(await opening, {
    seatId: "game-1:east",
    decisionId: "decision-2",
    status: "timed-out",
  });
  assert.equal(entry.calls.followups.length, 1);

  drain.resolve();
  await Promise.resolve();
  assert.equal(entry.calls.followups.length, 1);

  await manager.dispose();
});

test("the scoped tool rejects extra fields, stale decisions, and unlisted actions", async () => {
  const clock = createClock();
  const { ctx, records, runtime } = createHarness();
  let submissions = 0;
  const manager = await createSeatAgentManager({
    ctx,
    runtime,
    clock,
    seats: [seat()],
    async submitAction() {
      submissions += 1;
    },
  });
  await manager.openDecision(decision());
  const tool = getAgent(records).calls.register[0];

  await assert.rejects(
    tool.execute(
      { decisionId: "decision-1", actionId: "action-a", tile: "5m" },
      execution().exec,
    ),
    (error) => error?.code === "INVALID_TOOL_ARGUMENTS",
  );
  await assert.rejects(
    tool.execute(
      { decisionId: "stale-decision", actionId: "action-a" },
      execution().exec,
    ),
    (error) => error?.code === "DECISION_MISMATCH",
  );
  await assert.rejects(
    tool.execute(
      { decisionId: "decision-1", actionId: "not-allowed" },
      execution().exec,
    ),
    (error) => error?.code === "ACTION_NOT_ALLOWED",
  );
  assert.equal(submissions, 0);

  await manager.dispose();
});

test("dispose is idempotent, closes gates first, and disposes every AgentHandle once", async () => {
  const clock = createClock();
  const { ctx, records, runtime } = createHarness();
  const events = [];
  const manager = await createSeatAgentManager({
    ctx,
    runtime,
    clock,
    seats: [seat()],
    submitAction: async () => {},
    onEvent(event) {
      events.push(event);
    },
  });
  await manager.openDecision(decision());
  const entry = getAgent(records);
  entry.agentCtx.agent.cancel = () => {
    assert.equal(manager.getDecision("game-1:east").status, "disposed");
  };

  const first = manager.dispose();
  const second = manager.dispose();
  assert.equal(first, second);
  await first;
  assert.equal(entry.calls.disposeCount, 1);
  assert.equal(events.at(-1).reason, "dispose");
  await assert.rejects(
    manager.openDecision(decision({ decisionId: "decision-after-dispose" })),
    (error) => error?.code === "MANAGER_DISPOSED",
  );
});

test("the production loader names only rc.8 public package roots", async () => {
  const source = await readFile(
    new URL("../lib/seat-agent-manager.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /import\("@deepseek-ai\/dsh-agent"\)/);
  assert.match(source, /import\("@deepseek-ai\/dsh-llm"\)/);
  assert.match(source, /import\("@deepseek-ai\/dsh-session"\)/);
  assert.match(source, /import\("@deepseek-ai\/dsh-tools"\)/);
  assert.doesNotMatch(source, /@deepseek-ai\/(?:dsh-[^"']+)\/src\//);
});


test("model quota errors close the local gate and report a safe status without provider details", async () => {
  const clock=createClock(), {ctx,records,runtime}=createHarness(), events=[];
  const manager=await createSeatAgentManager({ctx,runtime,clock,seats:[seat()],submitAction:async()=>{},onEvent:event=>events.push(event)});
  await manager.openDecision(decision());
  const entry=getAgent(records);
  entry.calls.events.get("session/event")({}, {type:"turn/end",data:{reason:{kind:"error",error:{code:"QUOTA",status:402,message:"private provider message"}}}});
  assert.equal(manager.getDecision("game-1:east").status,"failed");
  assert.deepEqual(events.find(e=>e.type==="model-error"),{type:"model-error",seatId:"game-1:east",code:"MODEL_QUOTA"});
  assert.equal(JSON.stringify(events).includes("private provider message"),false);
  await manager.dispose();
});
