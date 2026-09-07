import assert from "node:assert/strict";
import test from "node:test";

import { createDshMahjongGameController } from "../lib/game-controller.js";
import { createMemorySessionGameStore } from "../lib/session-game-store.js";

const catalog = {
  providers: [{
    id: "deepseek-official",
    name: "DeepSeek",
    credentialReady: true,
    models: [{ id: "deepseek-v4", name: "DeepSeek V4" }],
  }],
  failures: [],
};

function visibleAgent(sessionId = "visible-1") {
  const installed = {
    contexts: [],
    followups: [],
    tools: [],
    contextDisposals: 0,
    toolDisposals: 0,
  };
  const agent = {
    id: sessionId,
    session: { header: { id: sessionId } },
    followup(message) {
      installed.followups.push(message);
    },
    ctx: {
      effect(setup) {
        const dispose = setup();
        return async () => dispose();
      },
      tools: {
        register(tool) {
          installed.tools.push(tool);
          return () => { installed.toolDisposals += 1; };
        },
      },
      systemPrompt: {
        context(context) {
          installed.contexts.push(context);
          return () => { installed.contextDisposals += 1; };
        },
      },
    },
  };
  return { agent, installed };
}

function createHarness(agent) {
  const listeners = new Map();
  const calls = { resolve: [] };
  return {
    calls,
    emit(name, value) {
      listeners.get(name)?.(value);
    },
    ctx: {
      agents: {
        get: (id) => id === agent.id ? agent : undefined,
        list: () => [agent],
      },
      llm: {
        async resolveCallConfig(value) {
          calls.resolve.push(value);
          return value;
        },
      },
      on(name, handler) {
        listeners.set(name, handler);
        return () => listeners.delete(name);
      },
    },
  };
}

function mixedRequest() {
  return {
    sessionId: "visible-1",
    tableName: "混合测试桌",
    seats: [
      { seat: 0, kind: "human", owner: true },
      { seat: 1, kind: "ai", provider: "deepseek-official", model: "deepseek-v4" },
      { seat: 2, kind: "ai", provider: "deepseek-official", model: "deepseek-v4" },
      { seat: 3, kind: "human" },
    ],
  };
}

function allAiRequest() {
  return {
    sessionId: "visible-1",
    tableName: "全 AI 桌",
    seats: [0, 1, 2, 3].map((seat) => ({
      seat,
      kind: "ai",
      provider: "deepseek-official",
      model: "deepseek-v4",
    })),
  };
}

function fragmentParams(value) {
  return new URLSearchParams(new URL(value).hash.slice(1));
}

function tableResponse(ownerMode = "player") {
  const allAi = ownerMode === "spectator";
  return {
    ok: true,
    gameId: "game-1",
    roomType: "friend",
    ruleset: "blood",
    ownerMode,
    aiDecisionTimeoutMs: 38_000,
    ...(allAi ? { spectatorEmbedTicket: "embed-ticket" } : {}),
    seats: allAi
      ? [0, 1, 2, 3].map((seat) => ({ seat, kind: "ai", initialPoints: 4800, seatCredential: `ai-${seat}` }))
      : [
          { seat: 0, kind: "human", owner: true, humanInviteTicket: "human-owner-ticket" },
          { seat: 1, kind: "ai", seatCredential: "ai-1" },
          { seat: 2, kind: "ai", seatCredential: "ai-2" },
          {
            seat: 3,
            kind: "human",
            humanInviteTicket: "human-invite",
            credentialExpiresAtMs: 123_000,
          },
        ].map(seat => ({ ...seat, initialPoints: 4800 })),
  };
}

async function setup({
  initial = [],
  response = tableResponse(),
  resume,
  spectatorError,
  spectatorScope,
  spectatorSnapshots,
  handUrlBase,
} = {}) {
  const { agent, installed } = visibleAgent();
  const harness = createHarness(agent);
  const store = createMemorySessionGameStore(initial);
  const calls = { create: [], resume: [], runtime: [], spectator: [], runtimeDisposals: 0 };
  const control = {
    wsUrlForGame: id => `ws://localhost:8787/v1/tables/${id}/ws`,
    async createTable(value) {
      calls.create.push(value);
      return response;
    },
    async resumeTable(value) {
      calls.resume.push(value);
      return resume;
    },
    async connectSpectator(options) {
      if (spectatorError) throw spectatorError;
      calls.spectator.push({ expectedScope: options.expectedScope });
      const scope = spectatorScope ?? (response.ownerMode === "spectator" ? "full" : "self");
      if (scope === options.expectedScope) {
        options.onEvent({ type: "spectator-ready", scope });
        const snapshots = spectatorSnapshots ?? [{
          type: "UPDATE",
          gameId: "game-1",
          full: true,
          entries: [
            ["turn", "current", 7],
            ["apiToken", "value", "must-be-removed"],
            ["private", "seatCredential", "must-also-be-removed"],
          ],
        }];
        for (const snapshot of snapshots) options.onSnapshot(snapshot);
      }
      return {
        scope,
        dispose() {},
      };
    },
  };
  const controller = await createDshMahjongGameController({
    ctx: harness.ctx,
    store,
    control,
    ownerApiToken: "owner-secret",
    ...(handUrlBase === undefined ? {} : { handUrlBase }),
    modelCatalogReader: async () => catalog,
    runtimeFactory: async (options) => {
      calls.runtime.push(options);
      for (const seat of options.seats) {
        options.onEvent({ type: "connection-ready", seatId: `${seat.gameId}:${seat.seat}` });
      }
      return { async dispose() { calls.runtimeDisposals += 1; } };
    },
    now: () => 50_000,
  });
  return { calls, controller, harness, installed, store, control };
}

test("a case session is immutable, isolated from live games, and has no live runtime or automatic model turn", async () => {
  const { calls, controller, installed, store } = await setup();
  const state = await controller.openCase({ sessionId: 'visible-1', eventIndex: 0 });
  assert.equal(state.game.mode, 'case');
  assert.equal(state.game.caseFrame.drawn, null);
  assert.match(installed.contexts[0].text(), /步骤 0/);
  assert.equal(installed.followups.length, 0);
  assert.deepEqual(store.list()[0].caseStudy, { gameId: 'case-tianfu-20260706-8-8', eventIndex: 0 });
  assert.equal(calls.create.length, 0);
  assert.equal(calls.runtime.length, 0);
  await assert.rejects(controller.openCase({ sessionId: 'visible-1', eventIndex: 2 }), { code: 'CASE_STEP_LOCKED' });
  await assert.rejects(controller.openCase({ sessionId: 'hidden-or-missing', eventIndex: 0 }), { code: 'VISIBLE_SESSION_UNAVAILABLE' });
  await assert.rejects(controller.start(mixedRequest()), { code: 'GAME_LOCKED' });
  assert.equal(controller.qnaSnapshot('visible-1').frame.eventIndex, 0, 'late tool calls remain on the original step');
  assert.equal(controller.qnaSnapshot('another-session').available, false);
  await controller.dispose();
});

test('case bindings restore without an MJAI connection and stay isolated across steps', async () => {
  const initial = [{ schemaVersion: 1, sessionId: 'visible-1', phase: 'active', locked: true,
    caseStudy: { gameId: 'case-tianfu-20260706-8-8', eventIndex: 2 } }];
  const { controller, calls } = await setup({ initial });
  assert.equal(controller.qnaSnapshot('visible-1').frame.eventIndex, 2);
  assert.equal(controller.state('visible-1').game.caseFrame.score, 32);
  assert.equal(calls.resume.length, 0);
  await controller.stop('visible-1');
  assert.equal(controller.qnaSnapshot('visible-1').available, false);
  await assert.rejects(controller.openCase({ sessionId: 'visible-1', eventIndex: 0 }), { code: 'CASE_STEP_LOCKED' });
  await controller.dispose();
});

test("starts a mixed table, locks its lineup, persists only public data, and installs Q&A", async () => {
  const { calls, controller, harness, installed, store } = await setup();
  const state = await controller.start(mixedRequest());

  assert.equal(state.phase, "active");
  assert.equal(state.locked, true);
  assert.equal(state.game.timeoutSeconds, 38);
  assert.equal(state.game.runtime.readySeats, 2);
  assert.equal(state.game.seatInvites.length, 1);
  const invitation = new URL(state.game.seatInvites[0].invitationUrl);
  assert.equal(invitation.searchParams.has("humanInviteTicket"), false);
  assert.equal(fragmentParams(invitation).get("humanInviteTicket"), "human-invite");
  assert.deepEqual(calls.spectator, [{ expectedScope: "self" }]);
  assert.equal(state.game.handUrl.includes("owner-secret"), false);
  assert.equal(harness.calls.resolve.length, 1, "duplicate models share one exact validation");
  assert.deepEqual(calls.runtime[0].seats.map((seat) => ({
    seat: seat.seat,
    seatCredential: seat.seatCredential,
    provider: seat.provider,
    model: seat.model,
  })), [
    { seat: 1, seatCredential: "ai-1", provider: "deepseek-official", model: "deepseek-v4" },
    { seat: 2, seatCredential: "ai-2", provider: "deepseek-official", model: "deepseek-v4" },
  ]);

  const persisted = store.get("visible-1");
  assert.deepEqual(persisted.game.seats.map(s => s.initialPoints), [4800, 4800, 4800, 4800]);
  const serialized = JSON.stringify(persisted);
  assert.equal(serialized.includes("ai-1"), false);
  assert.equal(serialized.includes("human-invite"), false);
  assert.equal(serialized.includes("owner-secret"), false);
  assert.equal(installed.tools.length, 1);
  assert.equal(installed.contexts.length, 1);
  assert.equal(installed.followups.length, 1);
  assert.equal(installed.followups[0].role, "user");
  assert.deepEqual(installed.followups[0].source, {
    kind: "plugin",
    plugin: "dsh-mahjong",
    form: "notice",
    summary: "牌局问答已连接",
  });
  assert.match(installed.followups[0].content[0].text, /不要替玩家操作/);
  const qna = await installed.tools[0].execute();
  assert.equal(qna.available, true);
  assert.equal(JSON.stringify(qna).includes("must-be-removed"), false);
  assert.match(installed.contexts[0].text(), /不得代表用户出牌/);

  await assert.rejects(controller.start(mixedRequest()), (error) => error.code === "GAME_LOCKED");
  await controller.dispose();
  assert.equal(installed.toolDisposals, 1);
  assert.equal(installed.contextDisposals, 1);
});

test("Q&A keeps a complete current state across filtered incremental updates", async () => {
  const { controller } = await setup({
    spectatorSnapshots: [
      {
        type: "UPDATE",
        gameId: "game-1",
        full: false,
        entries: [["turn", "current", 6]],
      },
      {
        type: "UPDATE",
        gameId: "game-1",
        full: true,
        entries: [
          ["turn", "current", 7],
          ["tileFaceSelf", 0, ["一万", "二万"]],
          ["discards", 0, ["九条"]],
          ["ephemeral", "sound", true],
          ["sound", "latest", "discard"],
          ["private", "apiToken", "must-not-survive"],
        ],
      },
      {
        type: "UPDATE",
        gameId: "game-1",
        full: false,
        entries: [
          ["turn", "current", 8],
          ["tileFaceSelf", 0, ["一万", "三万"]],
          ["discards", 0, null],
          ["sound", "latest", "draw"],
          ["avatars", "player-1", 0],
        ],
      },
    ],
  });
  await controller.start(mixedRequest());

  const qna = controller.qnaSnapshot("visible-1");
  assert.equal(qna.state.full, true);
  const entries = new Map(qna.state.entries.map(([kind, key, value]) => [JSON.stringify([kind, key]), value]));
  assert.equal(entries.get(JSON.stringify(["turn", "current"])), 8);
  assert.deepEqual(entries.get(JSON.stringify(["tileFaceSelf", 0])), ["一万", "三万"]);
  assert.equal(entries.has(JSON.stringify(["discards", 0])), false);
  assert.equal(entries.get(JSON.stringify(["avatars", "player-1"])), 0);
  assert.equal(entries.has(JSON.stringify(["sound", "latest"])), false);
  assert.equal(JSON.stringify(qna).includes("must-not-survive"), false);
  assert.equal(JSON.stringify(qna).includes("\"current\",6"), false, "pre-baseline deltas are ignored");

  await controller.dispose();
});

test("uses a configured HTTPS hand route for remote human invitations", async () => {
  const { controller } = await setup({
    handUrlBase: "https://play.example.test/hand/?discarded=true",
  });
  const state = await controller.start(mixedRequest());
  const invitation = new URL(state.game.seatInvites[0].invitationUrl);
  assert.equal(invitation.origin, "https://play.example.test");
  assert.equal(invitation.pathname, "/hand/");
  assert.equal(invitation.searchParams.has("discarded"), false);
  assert.equal(invitation.searchParams.get("gameId"), "game-1");
  assert.equal(invitation.searchParams.has("humanInviteTicket"), false);
  assert.equal(fragmentParams(invitation).get("seat"), "3");
  assert.equal(fragmentParams(invitation).get("humanInviteTicket"), "human-invite");
  await controller.dispose();
});

test("rejects an insecure non-loopback or non-hand embed base", async () => {
  await assert.rejects(
    setup({ handUrlBase: "http://play.example.test:8787/hand/" }),
    (error) => error.code === "INVALID_CONFIG",
  );
  await assert.rejects(
    setup({ handUrlBase: "https://play.example.test/not-hand/" }),
    (error) => error.code === "INVALID_CONFIG",
  );
});

test("removes and reinstalls visible Q&A exactly once across agent lifecycle events", async () => {
  const { controller, harness, installed } = await setup();
  await controller.start(mixedRequest());

  harness.emit("agent/disposed", { agent: harness.ctx.agents.get("visible-1") });
  await Promise.resolve();
  assert.equal(installed.toolDisposals, 1);
  assert.equal(installed.contextDisposals, 1);

  harness.emit("agent/created", { agent: harness.ctx.agents.get("visible-1") });
  assert.equal(installed.tools.length, 2);
  assert.equal(installed.contexts.length, 2);
  assert.equal(installed.followups.length, 1, "agent recreation must not repeat the welcome turn");

  await controller.dispose();
  assert.equal(installed.toolDisposals, 2);
  assert.equal(installed.contextDisposals, 2);
});

test("supports four AI seats and exposes only the scoped spectator embed ticket to the iframe", async () => {
  const response = tableResponse("spectator");
  const { calls, controller, store } = await setup({ response });
  const state = await controller.start(allAiRequest());
  assert.equal(calls.runtime[0].seats.length, 4);
  const hand = new URL(state.game.handUrl);
  assert.equal(hand.searchParams.get("gameId"), "game-1");
  assert.equal(hand.searchParams.has("spectatorEmbedTicket"), false);
  assert.equal(fragmentParams(hand).get("spectatorEmbedTicket"), "embed-ticket");
  assert.deepEqual(calls.spectator, [{ expectedScope: "full" }]);
  assert.equal(JSON.stringify(store.get("visible-1")).includes("embed-ticket"), false);
  assert.equal(controller.qnaSnapshot("visible-1").viewer.scope, "full");
  await controller.dispose();
});

test("rejects a spectator scope that is broader or narrower than the table owner mode", async () => {
  const cases = [
    { response: tableResponse("player"), request: mixedRequest(), received: "full", expected: "self" },
    { response: tableResponse("spectator"), request: allAiRequest(), received: "self", expected: "full" },
  ];
  for (const entry of cases) {
    const { calls, controller } = await setup({
      response: entry.response,
      spectatorScope: entry.received,
    });
    await assert.rejects(
      controller.start(entry.request),
      (error) => error?.code === "SPECTATOR_SCOPE_INVALID",
    );
    assert.deepEqual(calls.spectator, [{ expectedScope: entry.expected }]);
    const state = controller.state("visible-1");
    assert.equal(state.phase, "error");
    assert.equal(state.lastErrorCode, "SPECTATOR_SCOPE_INVALID");
    const qna = controller.qnaSnapshot("visible-1");
    assert.equal(qna.state, null);
    assert.equal(qna.viewer.scope, undefined);
    await controller.dispose();
  }
});

test("rehydrates a persisted table through owner-authorized resume without stored credentials", async () => {
  const record = {
    schemaVersion: 1,
    sessionId: "visible-1",
    phase: "active",
    locked: true,
    game: {
      gameId: "game-1",
      ruleset: "blood",
      tableName: "恢复桌",
      timeoutSeconds: 38,
      ownerMode: "spectator",
      viewerRole: "spectator",
      seats: [0, 1, 2, 3].map((seat) => ({
        seat,
        kind: "ai",
        provider: "deepseek-official",
        model: "deepseek-v4",
        modelLabel: "DeepSeek V4",
      })),
      createdAtMs: 10,
    },
  };
  const resume = {

    ...tableResponse("spectator"),
    ok: true,
    gameId: "game-1",
    spectatorEmbedTicket: "fresh-embed",
    seats: [0, 1, 2, 3].map((seat) => ({
      seat,
      kind: "ai",
      seatCredential: `fresh-${seat}`,
    })),
  };
  const { calls, controller } = await setup({ initial: [record], response: tableResponse("spectator"), resume });
  assert.equal(calls.resume.length, 1);
  assert.equal(calls.runtime[0].seats[0].seatCredential, "fresh-0");
  assert.match(controller.state("visible-1").game.handUrl, /fresh-embed/);
  await controller.dispose();
});

test("restores a fresh invitation only for an unclaimed human seat", async () => {
  const record = {
    schemaVersion: 1,
    sessionId: "visible-1",
    phase: "active",
    locked: true,
    game: {
      gameId: "game-1",
      ruleset: "blood",
      tableName: "混合恢复桌",
      timeoutSeconds: 38,
      ownerMode: "player",
      viewerRole: "player",
      viewerSeat: 0,
      seats: [
        { seat: 0, kind: "human", owner: true },
        { seat: 1, kind: "ai", provider: "deepseek-official", model: "deepseek-v4", modelLabel: "DeepSeek V4" },
        { seat: 2, kind: "ai", provider: "deepseek-official", model: "deepseek-v4", modelLabel: "DeepSeek V4" },
        { seat: 3, kind: "human" },
      ],
      createdAtMs: 10,
    },
  };
  const resume = {

    ...tableResponse("player"),
    ok: true,
    gameId: "game-1",
    seats: [
      { seat: 0, kind: "human", owner: true, humanInviteTicket: "human-owner-ticket" },
      { seat: 1, kind: "ai", seatCredential: "fresh-1" },
      { seat: 2, kind: "ai", seatCredential: "fresh-2" },
      {
        seat: 3,
        kind: "human",
        humanInviteTicket: "fresh-human-invite",
        credentialExpiresAtMs: 999_000,
      },
    ],
  };
  const { controller } = await setup({ initial: [record], resume });
  const invites = controller.state("visible-1").game.seatInvites;
  assert.equal(invites.length, 1);
  const invitation = new URL(invites[0].invitationUrl);
  assert.equal(invitation.searchParams.has("humanInviteTicket"), false);
  assert.equal(fragmentParams(invitation).get("humanInviteTicket"), "fresh-human-invite");
  assert.equal(invites[0].expiresAtMs, 999_000);
  await controller.dispose();
});

test("rejects incomplete seat authorization during restore", async () => {
  const record = {
    schemaVersion: 1,
    sessionId: "visible-1",
    phase: "active",
    locked: true,
    game: {
      gameId: "game-1",
      ruleset: "blood",
      tableName: "已加入真人恢复桌",
      timeoutSeconds: 38,
      ownerMode: "player",
      viewerRole: "player",
      viewerSeat: 0,
      seats: [
        { seat: 0, kind: "human", owner: true },
        { seat: 1, kind: "ai", provider: "deepseek-official", model: "deepseek-v4", modelLabel: "DeepSeek V4" },
        { seat: 2, kind: "ai", provider: "deepseek-official", model: "deepseek-v4", modelLabel: "DeepSeek V4" },
        { seat: 3, kind: "human" },
      ],
      createdAtMs: 10,
    },
  };
  const resume = {

    ...tableResponse("player"),
    ok: true,
    gameId: "game-1",
    seats: [
      { seat: 0, kind: "human", owner: true, humanInviteTicket: "human-owner-ticket" },
      { seat: 1, kind: "ai", seatCredential: "fresh-1" },
      { seat: 2, kind: "ai", seatCredential: "fresh-2" },
      { seat: 3, kind: "human" },
    ],
  };
  const { controller } = await setup({ initial: [record], resume });
  assert.equal(controller.state("visible-1").phase, "error");
  assert.equal(controller.state("visible-1").lastErrorCode, "HUMAN_INVITE_MISSING");
  await controller.dispose();
});

test("retry disposes a partially started AI runtime when spectator recovery fails", async () => {
  const spectatorError = Object.assign(new Error("observer rejected"), {
    code: "SPECTATOR_RECOVERY_FAILED",
  });
  const resume = {

    ...tableResponse("spectator"),
    ok: true,
    gameId: "game-1",
    spectatorEmbedTicket: "fresh-embed",
    seats: [0, 1, 2, 3].map((seat) => ({
      seat,
      kind: "ai",
      seatCredential: `fresh-${seat}`,
    })),
  };
  const { calls, controller, store } = await setup({
    response: tableResponse("spectator"),
    resume,
    spectatorError,
  });
  await store.put("visible-1", {
    schemaVersion: 1,
    sessionId: "visible-1",
    phase: "error",
    locked: true,
    lastErrorCode: "PREVIOUS_FAILURE",
    retryable: true,
    game: {
      gameId: "game-1",
      ruleset: "blood",
      tableName: "重试清理桌",
      timeoutSeconds: 38,
      ownerMode: "spectator",
      viewerRole: "spectator",
      seats: [0, 1, 2, 3].map((seat) => ({
        seat,
        kind: "ai",
        provider: "deepseek-official",
        model: "deepseek-v4",
        modelLabel: "DeepSeek V4",
      })),
      createdAtMs: 10,
    },
  });

  await assert.rejects(
    controller.retry("visible-1"),
    (error) => error.code === "SPECTATOR_RECOVERY_FAILED",
  );
  assert.equal(calls.runtimeDisposals, 1);
  assert.equal(controller.state("visible-1").phase, "error");
  assert.equal(controller.state("visible-1").retryable, true);
  assert.equal(controller.state("visible-1").lastErrorCode, "SPECTATOR_RECOVERY_FAILED");
  await controller.dispose();
});


test('standalone owner opens their human seat while AI-only owner opens the viewer', async () => {
  const response = tableResponse(); response.seats[0].humanInviteTicket = 'human-owner-ticket';
  const mixed = await setup({ response, standalone: true, handUrlBase: 'http://localhost:8787/hand/' });
  const state = await mixed.controller.start(mixedRequest());
  assert.equal(fragmentParams(state.game.handUrl).get('seat'), '0');
  assert.equal(fragmentParams(state.game.handUrl).get('humanInviteTicket'), 'human-owner-ticket');
  await mixed.controller.dispose();
  const bots = await setup({ standalone: true, response: tableResponse('spectator'), handUrlBase: 'https://hand.example/hand/' });
  const spectator = await bots.controller.start(allAiRequest());
  assert.equal(fragmentParams(spectator.game.handUrl).get('spectatorEmbedTicket'), 'embed-ticket');
  await bots.controller.dispose();
});

test('history Q&A is immutable across source updates, navigation, caller mutation and controller restart',async()=>{
 const env=await setup({standalone:true,handUrlBase:'http://127.0.0.1:8788/hand/'});
 const {controller,control,store,harness}=env;
 const frame={schema:'dsh-mahjong.frame.v1',gameId:'history-1',eventIndex:4,ruleset:'guobiao',phase:'playing',view:{entries:[['tileFaceSelf',1,3]]}};
 control.history=async()=>({items:[{eventIndex:4,phase:'playing'}]});
 control.historyFrame=async()=>({frame:structuredClone(frame),canPractice:true});
 const first=await controller.openHistory({sessionId:'visible-1',gameId:'history-1',eventIndex:4});
 assert.equal(first.game.mode,'replay');assert.equal(first.game.historyIndex,4);
 frame.view.entries[0][2]=9;
 const view=controller.qnaSnapshot('visible-1');view.frame.view.entries[0][2]=99;
 assert.equal(controller.qnaSnapshot('visible-1').frame.view.entries[0][2],3);
 await assert.rejects(controller.openHistory({sessionId:'visible-1',gameId:'history-1',eventIndex:5}),{code:'HISTORY_STEP_LOCKED'});
 assert.equal(env.calls.runtime.length,0);assert.equal(env.installed.followups.length,0);
 const saved=store.list();await controller.dispose();
 const restored=await createDshMahjongGameController({ctx:harness.ctx,store:createMemorySessionGameStore(saved),control,ownerApiToken:'owner-secret'});
 assert.equal(restored.qnaSnapshot('visible-1').frame.view.entries[0][2],3);
 await restored.dispose();
});

test('local hand routes support configured ports and reject misleading loopback hostnames',async()=>{
 const env=await setup({handUrlBase:'http://127.0.0.1:8788/hand/'});await env.controller.dispose();
 await assert.rejects(setup({handUrlBase:'http://127.evil.example:8788/hand/'}),{code:'INVALID_CONFIG'});
});


test("service descriptions must match the locked rules and roster, including on resume", async () => {
  for (const mutate of [
    value => {delete value.ruleset;},
    value => {value.seats[1].kind = "human";},
    value => {value.seats[2].seat = 1;},
    value => {value.seats[0].owner = false;},
    value => {value.seats[1].initialPoints = 0;},
    value => {delete value.seats[0].initialPoints;},
  ]) {
    const response = tableResponse(); mutate(response);
    const env = await setup({response});
    await assert.rejects(env.controller.start(mixedRequest()), {code: "SERVICE_RESPONSE_INVALID"});
    assert.equal(env.calls.runtime.length, 0);
    await env.controller.dispose();
  }
  const first = await setup();
  await first.controller.start(mixedRequest());
  const initial = first.store.list();
  await first.controller.dispose();
  const wrongGame = tableResponse(); wrongGame.gameId = "another-game";
  const restored = await setup({initial, resume: wrongGame});
  assert.equal(restored.controller.state("visible-1").phase, "error");
  assert.equal(restored.calls.runtime.length, 0);
  await restored.controller.dispose();
});
