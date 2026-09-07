import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const clientUrl = new URL("client.js", root);

function fakeReact() {
  return {
    createElement(type, properties, ...children) {
      return {
        type,
        props: Object.assign({}, properties, { children }),
      };
    },
    useEffect() {},
    useLayoutEffect() {},
    useMemo(factory) {
      return factory();
    },
    useRef(value) {
      return { current: value };
    },
    useState(value) {
      return [value, () => {}];
    },
    useSyncExternalStore(_subscribe, getSnapshot) {
      return getSnapshot();
    },
  };
}

async function loadClient(options = {}) {
  const source = await readFile(clientUrl, "utf8");
  let definition;
  const origin = "http://127.0.0.1:3081";
  const search = "";
  const listSnapshot = {
    current: undefined,
    ids: [],
    byId: {},
    phase: "ready",
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  };
  const sessionList = {
    getSnapshot: () => listSnapshot,
    subscribe: () => () => {},
  };
  const openedSessions = [];
  const storage = new Map();
  const connection = {
    api: {
      sessions: options.sessionApi ?? {},
    },
  };
  const context = vm.createContext({
    Element: class Element {},
    Map,
    MutationObserver: class MutationObserver {},
    ResizeObserver: class ResizeObserver {},
    Set,
    Symbol,
    URL,
    URLSearchParams,
    cancelAnimationFrame() {},
    document: {},
    performance: { now: () => 0 },
    requestAnimationFrame() {},
    setTimeout,
    clearTimeout,
    fetch: options.fetchImpl,
    window: {
      __DSH_MAHJONG_BOOT__: options.clientBoot,
      localStorage: {
        getItem(key) { return storage.get(key) ?? null; },
        setItem(key, value) { storage.set(key, value); },
      },
      __ModuleLoader__: {
        load(value) {
          definition = value;
        },
      },
      location: {
        href: `${origin}/${search}`,
        origin,
        search,
      },
    },
  });
  vm.runInContext(source, context);
  assert.ok(definition, "client bundle should register with the module loader");
  const plugin = definition.factory((name) => {
    if (name === "react") return fakeReact();
    if (name === "@deepseek-ai/dsh-client-ui-primitives") {
      return new Proxy({}, {
        get(_target, property) {
          return function Primitive(props) {
            return { type: String(property), props: { ...props, children: [] } };
          };
        },
      });
    }
    throw new Error(`unexpected browser dependency: ${name}`);
  });
  const injections = [];
  const registrations = [];
  const ctx = {
    sessions: {
      list: sessionList,
      open(sessionId) { openedSessions.push(sessionId); },
    },
    workspaces: options.workspacesService ?? {},
    get(name) {
      if (name === "connection") return connection;
      throw new Error(`unexpected service: ${name}`);
    },
    slots: {
      inject(name, effect) {
        injections.push(name);
        return effect();
      },
      register(options, component) {
        registrations.push({ options, component });
        return () => {};
      },
    },
  };
  plugin.apply(ctx);
  return {
    ctx,
    definition,
    injections,
    listSnapshot,
    openedSessions,
    plugin,
    registrations,
    source,
    storage,
  };
}

async function loadResizeGeometry() {
  const source = await readFile(clientUrl, "utf8");
  const start = source.indexOf("    function resizeAlignmentForEdge(");
  const end = source.indexOf("    function applyStageGeometry(", start);
  assert.notEqual(start, -1, "resize geometry functions should exist");
  assert.notEqual(end, -1, "resize geometry functions should have a stable boundary");
  const functionsSource = source.slice(start, end);
  return vm.runInNewContext(
    `(() => { const TABLE_RATIO = 1280 / 720; ${functionsSource}; return { calculateStageGeometry, focusPreferenceForWidth, focusPreferenceFromPointer, resizeAnchorPositionForEdge, resizeMaximumWidthForAnchor }; })()`,
  );
}

async function loadStageGeometry() {
  return (await loadResizeGeometry()).calculateStageGeometry;
}

function findElement(node, predicate) {
  if (!node || typeof node !== "object") return undefined;
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = findElement(child, predicate);
      if (match) return match;
    }
    return undefined;
  }
  if (predicate(node)) return node;
  const children = node.props && Array.isArray(node.props.children)
    ? node.props.children
    : [];
  for (const child of children) {
    const match = findElement(child, predicate);
    if (match) return match;
  }
  return undefined;
}

function findAllElements(node, predicate, results = []) {
  if (!node || typeof node !== "object") return results;
  if (Array.isArray(node)) {
    for (const child of node) findAllElements(child, predicate, results);
    return results;
  }
  if (predicate(node)) results.push(node);
  const children = node.props && Array.isArray(node.props.children)
    ? node.props.children
    : [];
  for (const child of children) findAllElements(child, predicate, results);
  return results;
}

function renderFunctionalNode(node) {
  if (!node || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map(renderFunctionalNode);
  if (typeof node.type === "function") return renderFunctionalNode(node.type(node.props));
  const children = node.props && Array.isArray(node.props.children)
    ? node.props.children.map(renderFunctionalNode)
    : [];
  return {
    ...node,
    props: node.props ? { ...node.props, children } : node.props,
  };
}

function globalSlotProps(current, controller) {
  const sessionState = {
    current,
    ids: current ? [current] : [],
    byId: current ? { [current]: { id: current, blank: false } } : {},
  };
  return {
    controller,
    useSessions: (select) => select(sessionState),
    useWorkspaces: (select) => select({
      items: [],
      recentWorkspaceId: undefined,
    }),
  };
}

function fixedController(snapshot) {
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    loadSession: async () => null,
    loadCatalog: async () => snapshot.catalog,
    closePanel() {},
    closeInvites() {},
    openEntry() {},
    openInvites() {},
    retryGame() {},
    startGame: async () => {},
  };
}

function createHostHarness() {
  const effects = [];
  const httpRegistrations = [];
  const indexTransforms = [];
  const registrations = [];
  const ctx = {
    agents: {
      create() {
        throw new Error("the injected runtime factory owns this test boundary");
      },
    },
    effect(execute, label) {
      const record = { disposer: undefined, label, setup: undefined };
      effects.push(record);
      let result;
      try {
        result = execute();
      } catch (error) {
        record.setup = Promise.reject(error);
        return async () => record.setup;
      }
      record.setup = Promise.resolve(result).then((disposer) => {
        assert.equal(typeof disposer, "function");
        record.disposer = disposer;
      });
      return async () => {
        await record.setup;
        await record.disposer();
      };
    },
    tools: {
      register(tool) {
        registrations.push(tool);
        return () => {};
      },
    },
    webServer: {
      register(options) {
        httpRegistrations.push(options);
        return () => {
          const index = httpRegistrations.indexOf(options);
          if (index !== -1) httpRegistrations.splice(index, 1);
        };
      },
      tapIndex(transform) {
        indexTransforms.push(transform);
        return () => {
          const index = indexTransforms.indexOf(transform);
          if (index !== -1) indexTransforms.splice(index, 1);
        };
      },
    },
  };
  return {
    ctx,
    effects,
    httpRegistrations,
    indexTransforms,
    registrations,
    renderIndex(html) {
      return indexTransforms.reduce((current, transform) => transform(current), html);
    },
    async settle() {
      await Promise.all(effects.map(({ setup }) => setup));
    },
    async dispose() {
      for (const effect of [...effects].reverse()) {
        await effect.setup;
        await effect.disposer();
      }
    },
  };
}

test("the plugin uses only additive official Harness slots", async () => {
  const { injections, registrations } = await loadClient();
  assert.deepEqual(
    [...injections].sort(),
    [
      "conversation.session.header.utilities",
      "conversation.session.header.utilities",
      "conversation.session.header.utilities",
      "shell.overlay",
      "sidebar.footer.action",
    ].sort(),
  );
  assert.deepEqual(
    registrations.map(({ options }) => options.name).sort(),
    [
      "conversation.session.header.utilities",
      "conversation.session.header.utilities",
      "conversation.session.header.utilities",
      "shell.overlay",
      "sidebar.footer.action",
    ].sort(),
  );
  assert.deepEqual(
    registrations.map(({ options }) => options.id).sort(),
    ["dsh-mahjong-case", "dsh-mahjong-entry", "dsh-mahjong-hand", "dsh-mahjong-invites", "dsh-mahjong-toggle"].sort(),
  );

  const forbidden = new Set([
    "root",
    "conversation",
    "conversation.session",
    "conversation.session.header",
    "conversation.composer",
    "details",
  ]);
  for (const { options } of registrations) {
    assert.equal(forbidden.has(options.name), false);
  }
});

test("the official footer action exposes the approved Mahjong entry", async () => {
  const { registrations } = await loadClient();
  const entry = registrations.find(({ options }) => options.name === "sidebar.footer.action");
  assert.ok(entry);
  const props = {
    ...globalSlotProps(undefined, entry.options.inject().controller),
    wide: true,
  };
  const tree = renderFunctionalNode(entry.component(props));
  const button = findElement(tree, (node) => node.type === "button");
  assert.equal(button.props["data-dsh-mahjong-launch"], "true");
  assert.equal(button.props["aria-label"], "打开麻将实验室");
  assert.ok(findElement(tree, (node) => node.type === "span" && node.props.children.includes("麻将实验室")));
});

test("the plugin preserves the native Harness conversation and composer", async () => {
  const { source } = await loadClient();
  assert.doesNotMatch(source, /ctx\.sessions\.scope/);
  assert.doesNotMatch(source, /conversation\.send/);
  assert.doesNotMatch(source, /react\.createElement\("textarea"/);
  assert.doesNotMatch(source, /dsh-mj-compose|dsh-mj-messages/);
  assert.doesNotMatch(source, /toggleSidebar/);
  assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML/);
  assert.match(source, /\[data-composer-seat\]/);
});

test("only a mapped Mahjong session embeds a trusted real hand route", async () => {
  const allowed = [
    "http://localhost:8787/hand/?gameId=g1",
    "http://127.0.0.1:8787/hand/?gameId=g2",
    "https://play.example.test/hand/?gameId=g3#spectatorEmbedTicket=view-g3",
  ];
  for (const candidate of allowed) {
    const { registrations } = await loadClient();
    const overlay = registrations.find(({ options }) => options.name === "shell.overlay");
    const gameId = new URL(candidate).searchParams.get("gameId");
    const controller = fixedController({
      panelOpen: false,
      catalogStatus: "ready",
      catalog: { providers: [], failures: [] },
      formStatus: "idle",
      formError: null,
      pendingSessionId: null,
      lastSessionId: "s1",
      statesBySession: {
        s1: { phase: "active", game: { gameId, handUrl: candidate } },
      },
    });
    const tree = renderFunctionalNode(overlay.component(globalSlotProps("s1", controller)));
    const iframe = findElement(tree, (node) => node.type === "iframe");
    assert.ok(iframe);
    const parsed = new URL(iframe.props.src);
    assert.equal(parsed.origin, new URL(candidate).origin);
    assert.equal(parsed.pathname, "/hand/");
    assert.equal(parsed.searchParams.get("gameId"), gameId);
    assert.equal(parsed.searchParams.get("parentOrigin"), "http://127.0.0.1:3081");
    assert.equal(parsed.hash, new URL(candidate).hash);
    assert.equal(parsed.searchParams.has("spectatorEmbedTicket"), false);
    assert.equal(iframe.props.referrerPolicy, "no-referrer");
  }

  const rejected = [
    "https://example.com/not-hand/?gameId=remote",
    "http://localhost:9999/hand/?gameId=wrong-port",
    "http://play.example.test/hand/?gameId=insecure-remote",
    "http://localhost:8787/hand/extra?gameId=extra",
    "http://localhost:8787/hand//?gameId=extra-slash",
    "http://user:secret@localhost:8787/hand/?gameId=credentials",
    "/hand/?gameId=same-origin",
    "javascript:alert(1)",
    "data:text/html,unsafe",
    "not a valid url",
  ];
  for (const candidate of rejected) {
    const { registrations } = await loadClient();
    const overlay = registrations.find(({ options }) => options.name === "shell.overlay");
    const controller = fixedController({
      panelOpen: false,
      catalogStatus: "ready",
      catalog: { providers: [], failures: [] },
      formStatus: "idle",
      formError: null,
      pendingSessionId: null,
      lastSessionId: "s1",
      statesBySession: {
        s1: { phase: "active", game: { gameId: "expected", handUrl: candidate } },
      },
    });
    const tree = renderFunctionalNode(overlay.component(globalSlotProps("s1", controller)));
    assert.equal(findElement(tree, (node) => node.type === "iframe"), undefined);
    assert.ok(findElement(tree, (node) => node.props?.role === "alert"));
  }
});

test("ordinary Harness sessions never render the Mahjong iframe", async () => {
  const { registrations } = await loadClient();
  const overlay = registrations.find(({ options }) => options.name === "shell.overlay");
  const controller = fixedController({
    panelOpen: false,
    catalogStatus: "idle",
    catalog: { providers: [], failures: [] },
    formStatus: "idle",
    formError: null,
    pendingSessionId: null,
    lastSessionId: null,
    statesBySession: {},
  });
  const tree = renderFunctionalNode(overlay.component(globalSlotProps("normal-session", controller)));
  assert.equal(findElement(tree, (node) => node.type === "iframe"), undefined);
});

test("resizing controls keep the hand iframe at a stable position across focus and compact modes", async () => {
  const { registrations, source } = await loadClient();
  const overlay = registrations.find(({ options }) => options.name === "shell.overlay");
  const utility = registrations.find(({ options }) => options.id === "dsh-mahjong-toggle");
  const controller = fixedController({
    panelOpen: false,
    catalogStatus: "ready",
    catalog: { providers: [], failures: [] },
    formStatus: "idle",
    formError: null,
    pendingSessionId: null,
    lastSessionId: "s1",
    statesBySession: {
      s1: {
        phase: "active",
        game: {
          gameId: "blood-game-001",
          handUrl: "http://localhost:8787/hand/?gameId=blood-game-001",
        },
      },
    },
  });
  const largeTree = renderFunctionalNode(overlay.component(globalSlotProps("s1", controller)));
  const largeStage = findElement(largeTree, (node) => node.props?.["data-dsh-mahjong-stage"] === "true");
  const largeIframe = findElement(largeTree, (node) => node.type === "iframe");
  const largeHandles = findAllElements(
    largeTree,
    (node) => typeof node.props?.["data-dsh-mahjong-resize-edge"] === "string",
  ).map((node) => node.props["data-dsh-mahjong-resize-edge"]);
  assert.deepEqual(largeHandles, ["left", "right", "bottom", "bottom-left", "bottom-right"]);
  assert.equal(largeStage.props.children[0].type, "iframe");
  assert.equal(largeIframe.props.key, undefined);
  assert.equal(largeIframe.props["data-dsh-mahjong-frame"], "true");
  assert.equal(largeTree.props["data-mode"], "large");

  const toggle = utility.component({ controller, sessionId: "s1" });
  toggle.props.onClick();
  const compactTree = renderFunctionalNode(overlay.component(globalSlotProps("s1", controller)));
  const compactStage = findElement(compactTree, (node) => node.props?.["data-dsh-mahjong-stage"] === "true");
  const compactIframe = findElement(compactTree, (node) => node.type === "iframe");
  assert.equal(compactTree.props["data-mode"], "compact");
  assert.equal(findAllElements(compactTree, (node) => node.props?.["data-dsh-mahjong-resize-edge"]).length, 0);
  assert.equal(compactStage.props.children[0].type, largeStage.props.children[0].type);
  assert.equal(compactIframe.props.src, largeIframe.props.src);
  assert.equal(compactIframe.props.key, largeIframe.props.key);
  assert.match(source, /\}, \[frameUrl, game && game\.caseFrame, game && game\.historyFrame\]\);/);
});

test("the setup panel covers seat, model, timeout, empty, and spectator states", async () => {
  const { registrations, source } = await loadClient();
  const overlay = registrations.find(({ options }) => options.name === "shell.overlay");
  const controller = fixedController({
    panelOpen: true,
    catalogStatus: "ready",
    catalog: {
      providers: [{ id: "deepseek", name: "DeepSeek", models: [{ id: "chat", name: "DeepSeek Chat" }] }],
      failures: [],
    },
    formStatus: "idle",
    formError: null,
    pendingSessionId: null,
    lastSessionId: null,
    statesBySession: {},
  });
  const tree = renderFunctionalNode(overlay.component(globalSlotProps(undefined, controller)));
  const panel = findElement(tree, (node) => node.props?.["data-dsh-mahjong-setup"] === "true");
  assert.ok(panel);
  assert.equal(findAllElements(tree, (node) => node.type === "article").length, 4);
  const timeout = findElement(tree, (node) => node.type === "input" && node.props.type === "number");
  assert.equal(timeout.props.value, "38");
  assert.equal(timeout.props.min, 10);
  assert.equal(timeout.props.max, 120);
  assert.match(source, /四个座位均为 AI，你将作为旁观者观看整局/);
  assert.match(source, /暂无可用 AI 模型/);
  assert.match(source, /正在读取 Harness 已配置模型/);
  assert.match(source, /开局后锁定座位、模型与初始积分/);
  const pointInputs = findAllElements(tree, node => node.type === "input" && node.props["aria-label"]?.endsWith("家初始积分"));
  assert.equal(pointInputs.length, 4);
  for (const input of pointInputs) {
    assert.equal(input.props.value, "4800");
    assert.equal(input.props.min, 0);
    assert.equal(input.props.max, 1000000);
    assert.equal(input.props.required, true);
  }
});

test("providers without credentials stay visible but cannot be selected", async () => {
  const { registrations } = await loadClient();
  const overlay = registrations.find(({ options }) => options.name === "shell.overlay");
  const controller = fixedController({
    panelOpen: true,
    catalogStatus: "ready",
    catalog: {
      providers: [
        { id: "missing", name: "未配置供应商", credentialReady: false, models: [{ id: "m1", name: "模型一" }] },
        { id: "ready", name: "可用供应商", credentialReady: true, models: [{ id: "m2", name: "模型二" }] },
      ],
      failures: [],
    },
    formStatus: "idle",
    formError: null,
    inviteSessionId: null,
    pendingSessionId: null,
    lastSessionId: null,
    statesBySession: {},
  });
  const tree = renderFunctionalNode(overlay.component(globalSlotProps(undefined, controller)));
  const groups = findAllElements(tree, (node) => node.type === "optgroup");
  const unavailable = groups.find((node) => node.props.label === "未配置供应商（未配置）");
  const available = groups.find((node) => node.props.label === "可用供应商");
  assert.equal(unavailable.props.disabled, true);
  assert.equal(available.props.disabled, false);
});

test("a stopped game remains a recognized terminal state", async () => {
  const { registrations } = await loadClient({
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return { ok: true, state: { phase: "stopped", sessionId: "s1", locked: true, game: { gameId: "g1" } } };
      },
    }),
  });
  const overlay = registrations.find(({ options }) => options.name === "shell.overlay");
  const controller = overlay.options.inject().controller;
  const state = await controller.loadSession("s1", true);
  assert.equal(state.phase, "stopped");
  assert.equal(state.locked, true);
});

test("additional human seats have a session-scoped invitation surface", async () => {
  const { registrations, source } = await loadClient();
  const snapshot = {
    panelOpen: false,
    catalogStatus: "ready",
    catalog: { providers: [], failures: [] },
    formStatus: "idle",
    formError: null,
    inviteSessionId: "s1",
    pendingSessionId: null,
    lastSessionId: "s1",
    statesBySession: {
      s1: {
        phase: "active",
        game: {
          gameId: "g1",
          handUrl: "http://localhost:8787/hand/?gameId=g1",
          seatInvites: [{ seat: 1, invitationUrl: "http://localhost:8787/hand/?gameId=g1&seat=1&humanInviteTicket=limited", expiresAtMs: Date.now() + 60_000 }],
        },
      },
    },
  };
  const controller = fixedController(snapshot);
  const overlay = registrations.find(({ options }) => options.name === "shell.overlay");
  const overlayTree = renderFunctionalNode(overlay.component(globalSlotProps("s1", controller)));
  const dialog = findElement(overlayTree, (node) => node.props?.["data-dsh-mahjong-invites"] === "true");
  assert.ok(dialog);
  const inviteInput = findElement(dialog, (node) => node.type === "input" && node.props.readOnly === true);
  assert.match(inviteInput.props.value, /humanInviteTicket=limited/);

  const utility = registrations.find(({ options }) => options.id === "dsh-mahjong-invites");
  const utilityTree = utility.component({ controller, sessionId: "s1" });
  assert.equal(utilityTree.props["data-dsh-mahjong-invite-action"], "true");
  assert.match(source, /链接只对应一个座位/);
  assert.doesNotMatch(source, /localStorage\.setItem\([^\n]*invitationUrl/);
});

test("the table has exact 16:9 geometry and no visual shell", async () => {
  const { source } = await loadClient();
  assert.match(source, /TABLE_RATIO = 1280 \/ 720/);
  assert.match(source, /if \(mode === "large"\)/);
  assert.match(source, /top: scrollRect\.top/);
  assert.match(source, /maximumWidth = Math\.min\(scrollRect\.width, usableHeight \* TABLE_RATIO\)/);
  assert.match(source, /height \* TABLE_RATIO/);
  assert.match(source, /targetHeight = usableHeight \* 0\.5/);
  assert.match(source, /ResizeObserver/);
  assert.match(source, /MutationObserver/);
  assert.match(source, /transitionrun/);
  assert.match(source, /event\.target === appFrame && event\.propertyName === "grid-template-columns"/);
  assert.match(source, /resizeObserver\.unobserve\(previous\)/);
  assert.match(source, /\[active, mode, currentSessionId\]/);
  assert.match(source, /react\.useLayoutEffect\(\(\) => installStyles\(\), \[\]\)/);
  assert.match(source, /Math\.min\(scrollRect\.bottom, Math\.max\(scrollRect\.top, composerRect\.top\)\)/);
  assert.match(source, /\.dsh-mj-overlay\{[^}]*pointer-events:none!important/);
  assert.match(source, /\.dsh-mj-stage\{[^}]*pointer-events:auto/);
  assert.match(source, /\.dsh-mj-stage\{[^}]*border-radius:0/);
  assert.match(source, /\.dsh-mj-stage\{[^}]*box-shadow:none/);
  assert.match(source, /\.dsh-mj-frame\{[^}]*border-radius:0/);
  assert.match(source, /\.dsh-mj-frame\{[^}]*box-shadow:none/);
  assert.match(source, /\.dsh-mj-stage\[data-resizing="true"\] \.dsh-mj-frame\{pointer-events:none/);
  assert.match(source, /handle\.setPointerCapture\(pointerId\)/);
  assert.match(source, /"pointercancel", onPointerCancel/);
  assert.match(source, /"mouseup", onMouseUp/);
  assert.match(source, /"lostpointercapture", onLostPointerCapture/);
  assert.match(source, /"blur", onWindowBlur/);
  assert.doesNotMatch(source, /window\.addEventListener\("resize"/);
});

test("all five resize handles preserve ratio, clamp size, and use the specified anchor", async () => {
  const { focusPreferenceFromPointer, resizeAnchorPositionForEdge, resizeMaximumWidthForAnchor } = await loadResizeGeometry();
  const cases = [
    { edge: "left", dx: -160, dy: 0, align: "right" },
    { edge: "right", dx: 160, dy: 0, align: "left" },
    { edge: "bottom", dx: 0, dy: 90, align: "center" },
    { edge: "bottom-left", dx: -160, dy: 90, align: "right" },
    { edge: "bottom-right", dx: 160, dy: 90, align: "left" },
  ];
  for (const fixture of cases) {
    const preference = focusPreferenceFromPointer(fixture.edge, 960, 1280, fixture.dx, fixture.dy, 0.42);
    assert.ok(Math.abs(preference.scale - 0.875) < 1e-12, fixture.edge);
    assert.equal(preference.align, fixture.align, fixture.edge);
    assert.equal(preference.position, 0.42, fixture.edge);
  }
  assert.equal(focusPreferenceFromPointer("right", 960, 1280, -1000, 0).scale, 480 / 1280);
  assert.equal(focusPreferenceFromPointer("right", 960, 1280, 1000, 0).scale, 1);
  assert.equal(focusPreferenceFromPointer("right", 400, 400, -1000, 0).scale, 1);
  assert.equal(resizeAnchorPositionForEdge("left", 200, 600, 100, 1000), 0.7);
  assert.equal(resizeAnchorPositionForEdge("bottom-left", 200, 600, 100, 1000), 0.7);
  assert.equal(resizeAnchorPositionForEdge("right", 200, 600, 100, 1000), 0.1);
  assert.equal(resizeAnchorPositionForEdge("bottom-right", 200, 600, 100, 1000), 0.1);
  assert.equal(resizeAnchorPositionForEdge("bottom", 200, 600, 100, 1000), 0.4);
  assert.equal(resizeMaximumWidthForAnchor("left", 0.7, 1000, 1280), 700);
  assert.equal(resizeMaximumWidthForAnchor("right", 0.1, 1000, 1280), 900);
  assert.equal(resizeMaximumWidthForAnchor("bottom", 0.4, 1000, 1280), 800);
  assert.equal(
    focusPreferenceFromPointer("bottom", 600, 1280, 0, 500, 0.4, 800).scale,
    800 / 1280,
  );
});

test("large mode is flush in the common one, two, and three column layouts", async () => {
  const calculateStageGeometry = await loadStageGeometry();
  const layouts = [
    { name: "one column", left: 56, width: 1205 },
    { name: "two columns", left: 280, width: 981 },
    { name: "three columns", left: 280, width: 640 },
  ];
  for (const layout of layouts) {
    const scroller = {
      getBoundingClientRect: () => ({
        left: layout.left,
        top: 76,
        right: layout.left + layout.width,
        bottom: 902,
        width: layout.width,
        height: 826,
      }),
    };
    const composer = {
      getBoundingClientRect: () => ({ left: layout.left, top: 776, right: layout.left + layout.width, bottom: 902, width: layout.width, height: 126 }),
    };
    const geometry = calculateStageGeometry(scroller, composer, "large");
    assert.equal(geometry.left, layout.left, `${layout.name} left edge`);
    assert.equal(geometry.top, 76, `${layout.name} top edge`);
    assert.equal(geometry.width, layout.width, `${layout.name} width`);
    assert.equal(geometry.height, layout.width / (1280 / 720), `${layout.name} height`);
    assert.equal(geometry.left + geometry.width, layout.left + layout.width, `${layout.name} right edge`);
  }
});

test("large mode preserves contain scaling on an unusually wide and short workspace", async () => {
  const calculateStageGeometry = await loadStageGeometry();
  const scroller = {
    getBoundingClientRect: () => ({ left: 55, top: 76, right: 1920, bottom: 1000, width: 1865, height: 924 }),
  };
  const composer = {
    getBoundingClientRect: () => ({ left: 55, top: 900, right: 1912, bottom: 1000, width: 1857, height: 100 }),
  };
  const geometry = calculateStageGeometry(scroller, composer, "large");
  assert.equal(geometry.top, 76);
  assert.ok(Math.abs(geometry.height - 824) < 1e-9);
  assert.ok(Math.abs(geometry.width - 824 * (1280 / 720)) < 1e-9);
  assert.equal(geometry.left + geometry.width / 2, 55 + 1865 / 2);
  assert.ok(geometry.top + geometry.height <= 900 + 1e-9);
});

test("manual focus size is recomputed within each one, two, and three column layout", async () => {
  const calculateStageGeometry = await loadStageGeometry();
  const layouts = [
    { left: 56, width: 1205 },
    { left: 280, width: 981 },
    { left: 280, width: 640 },
  ];
  for (const layout of layouts) {
    const scroller = {
      getBoundingClientRect: () => ({
        left: layout.left,
        top: 76,
        right: layout.left + layout.width,
        bottom: 902,
        width: layout.width,
        height: 826,
      }),
    };
    const composer = {
      getBoundingClientRect: () => ({ left: layout.left, top: 776, right: layout.left + layout.width, bottom: 902, width: layout.width, height: 126 }),
    };
    const expectedWidth = layout.width * 0.8;
    for (const align of ["left", "center", "right"]) {
      const geometry = calculateStageGeometry(scroller, composer, "large", { scale: 0.8, align });
      assert.equal(geometry.top, 76);
      assert.ok(Math.abs(geometry.width - expectedWidth) < 1e-9);
      assert.ok(Math.abs(geometry.width / geometry.height - 1280 / 720) < 1e-9);
      if (align === "left") assert.equal(geometry.left, layout.left);
      if (align === "center") assert.equal(geometry.left + geometry.width / 2, layout.left + layout.width / 2);
      if (align === "right") assert.equal(geometry.left + geometry.width, layout.left + layout.width);
    }
  }

  const scroller = {
    getBoundingClientRect: () => ({ left: 280, top: 76, right: 1245, bottom: 886, width: 965, height: 810 }),
  };
  const composer = {
    getBoundingClientRect: () => ({ left: 280, top: 760, right: 1245, bottom: 886, width: 965, height: 126 }),
  };
  const leftAnchor = calculateStageGeometry(scroller, composer, "large", { scale: 0.5, align: "left", position: 0.3 });
  const rightAnchor = calculateStageGeometry(scroller, composer, "large", { scale: 0.5, align: "right", position: 0.8 });
  const centerAnchor = calculateStageGeometry(scroller, composer, "large", { scale: 0.5, align: "center", position: 0.6 });
  assert.equal(leftAnchor.left, 280 + 965 * 0.3);
  assert.equal(rightAnchor.left + rightAnchor.width, 280 + 965 * 0.8);
  assert.equal(centerAnchor.left + centerAnchor.width / 2, 280 + 965 * 0.6);
});

test("compact mode uses exactly half the visible area without changing the table ratio", async () => {
  const calculateStageGeometry = await loadStageGeometry();
  const scroller = {
    getBoundingClientRect: () => ({ left: 280, top: 76, right: 1261, bottom: 902, width: 981, height: 826 }),
  };
  const composer = {
    getBoundingClientRect: () => ({ left: 280, top: 776, right: 1253, bottom: 902, width: 973, height: 126 }),
  };
  const geometry = calculateStageGeometry(scroller, composer, "compact");
  assert.ok(geometry.left > 280);
  assert.equal(geometry.top, 76);
  assert.equal(geometry.height, 350);
  assert.equal(geometry.width, 350 * (1280 / 720));
  assert.ok(geometry.top + geometry.height <= 776);
  assert.ok(Math.abs(geometry.width / geometry.height - 1280 / 720) < 1e-9);

  const narrowScroller = {
    getBoundingClientRect: () => ({ left: 280, top: 76, right: 780, bottom: 902, width: 500, height: 826 }),
  };
  const narrowGeometry = calculateStageGeometry(narrowScroller, composer, "compact");
  assert.equal(narrowGeometry.width, 500);
  assert.equal(narrowGeometry.height, 500 / (1280 / 720));
  assert.equal(narrowGeometry.left, 280);
  assert.ok(narrowGeometry.top + narrowGeometry.height <= 776);
});

test("the table switches to compact mode when native questioning begins", async () => {
  const { source, registrations } = await loadClient();
  const utility = registrations.find(
    ({ options }) => options.name === "conversation.session.header.utilities",
  );
  const controller = fixedController({
    panelOpen: false,
    catalogStatus: "ready",
    catalog: { providers: [], failures: [] },
    formStatus: "idle",
    formError: null,
    pendingSessionId: null,
    lastSessionId: "s1",
    statesBySession: { s1: { phase: "active", game: { gameId: "g1" } } },
  });
  const tree = utility.component({ controller, sessionId: "s1" });
  assert.equal(tree.type, "button");
  assert.equal(tree.props["data-dsh-mahjong-toggle"], "true");
  assert.equal(tree.props["aria-label"], "提问这一步");
  assert.match(source, /addEventListener\("pointerdown", onComposerPointerDown, true\)/);
  assert.match(source, /target\.closest\("\[data-composer-seat\]"\)/);
  assert.match(source, /setOverlayMode\("compact"\)/);
  assert.match(source, /focusNativeComposer\(\)/);
  assert.doesNotMatch(source, /addEventListener\("focusin"/);
});

test("the table becomes live only after a trusted hand message", async () => {
  const { source } = await loadClient();
  assert.match(source, /event\.source !== frame\.contentWindow \|\| event\.origin !== expectedOrigin/);
  assert.match(source, /data\.type !== HAND_READY_MESSAGE \|\| data\.gameId !== expectedGameId/);
  assert.match(source, /setFrameStatus\("live"\)/);
  assert.match(source, /type: HAND_READY_REQUEST_MESSAGE/);
  assert.match(source, /requestHandReady\(frameRef\.current, frameUrl\)/);
  assert.match(source, /data-frame-status="live"/);
});

test("the client uses the same-origin API and persists only public session ids", async () => {
  const { source } = await loadClient();
  assert.match(source, /API_BASE = CLIENT_BOOT/);
  assert.match(source, /API_REQUEST_TOKEN = CLIENT_BOOT/);
  assert.match(source, /headers\["X-DSH-Mahjong-Request-Token"\] = API_REQUEST_TOKEN/);
  assert.match(source, /requestJson\("\/models"\)/);
  assert.match(source, /requestJson\("\/state\?sessionId="/);
  assert.match(source, /requestJson\(snapshot\.practiceSource \? "\/practice\/start" : "\/games\/start"/);
  assert.match(source, /"X-DSH-Mahjong-Client": "web"/);
  const storageWriter = source.match(/function writeStoredClientState[\s\S]*?\n    }\n\n    function responseError/)?.[0];
  assert.ok(storageWriter);
  assert.match(storageWriter, /sessionIds/);
  assert.match(storageWriter, /lastSessionId/);
  assert.doesNotMatch(storageWriter, /handUrl|gameId|token|credential|provider|model/);
});

test("starting a table uses the Workspace runtime and the per-process request token", async () => {
  const apiCalls = [];
  let listSnapshot;
  const sessionApi = {
    async rename(payload) {
      apiCalls.push({ method: "session.rename", payload });
      return { result: { ok: true, value: { title: payload.title, seq: 1 } } };
    },
  };
  const fetchCalls = [];
  const loaded = await loadClient({
    clientBoot: {
      apiBase: "/dsh-mahjong/api",
      requestToken: "process-request-token",
    },
    sessionApi,
    workspacesService: {
      async connectWorkspace(workspaceId) {
        apiCalls.push({ method: "workspace.connect", workspaceId });
        listSnapshot.byId["mahjong-session"] = { id: "mahjong-session", blank: true };
        listSnapshot.ids.push("mahjong-session");
        return "mahjong-session";
      },
    },
    fetchImpl: async (url, init) => {
      fetchCalls.push({ url, init });
      return {
        ok: true,
        async json() {
          return {
            ok: true,
            state: {
              phase: "active",
              sessionId: "mahjong-session",
              locked: true,
              game: {
                gameId: "game-1",
                handUrl: "http://localhost:8787/hand/?gameId=game-1#spectatorEmbedTicket=memory-only",
              },
            },
          };
        },
      };
    },
  });
  listSnapshot = loaded.listSnapshot;
  const overlay = loaded.registrations.find(({ options }) => options.name === "shell.overlay");
  const controller = overlay.options.inject().controller;
  await controller.startGame({
    tableName: "测试桌",
    timeoutSeconds: 38,
    seats: [
      { seat: 0, kind: "human", owner: true },
      { seat: 1, kind: "ai", provider: "deepseek", model: "chat", modelLabel: "DeepSeek Chat" },
      { seat: 2, kind: "ai", provider: "qwen", model: "plus", modelLabel: "通义千问 Plus" },
      { seat: 3, kind: "ai", provider: "openai", model: "gpt", modelLabel: "GPT" },
    ],
  }, "workspace-1");

  assert.deepEqual(JSON.parse(JSON.stringify(apiCalls)), [
    { method: "workspace.connect", workspaceId: "workspace-1" },
    {
      method: "session.rename",
      payload: { sessionId: "mahjong-session", title: "麻将实验室 · 测试桌" },
    },
  ]);
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, "/dsh-mahjong/api/games/start");
  assert.equal(fetchCalls[0].init.method, "POST");
  assert.equal(fetchCalls[0].init.headers["X-DSH-Mahjong-Client"], "web");
  assert.equal(
    fetchCalls[0].init.headers["X-DSH-Mahjong-Request-Token"],
    "process-request-token",
  );
  assert.equal(JSON.parse(fetchCalls[0].init.body).sessionId, "mahjong-session");
  assert.deepEqual(loaded.openedSessions, ["mahjong-session"]);
  const stored = [...loaded.storage.values()].join("\n");
  assert.match(stored, /mahjong-session/);
  assert.doesNotMatch(stored, /game-1|memory-only|deepseek|qwen|openai/);
});

test("each dynamic plugin process wires one fresh request token into boot and HTTP", async () => {
  const plugin = await import(new URL("index.js", root));

  async function startProcess() {
    const harness = createHostHarness();
    const store = {
      get() { return undefined; },
      list() { return []; },
      async put() {},
      async delete() { return false; },
      async close() {},
    };
    plugin.apply(harness.ctx, {
      service: {
        tokenEnv: "DSH_MAHJONG_TEST_OWNER",
        url: "http://127.0.0.1:8787",
        handUrlBase: "http://localhost:8787/hand/",
      },
    }, {
      environment: { DSH_MAHJONG_TEST_OWNER: "owner-secret" },
      gameStore: store,
      control: { wsUrlForGame: id => `ws://127.0.0.1:8787/v1/tables/${id}/ws` },
      modelCatalogReader: async () => ({ providers: [], failures: [] }),
      dynamicRuntimeFactory: async () => ({ async dispose() {} }),
    });
    await harness.settle();
    const html = harness.renderIndex("<html><head></head><body></body></html>");
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    assert.ok(script);
    const browser = { window: {} };
    vm.runInNewContext(script, browser);
    return { harness, boot: browser.window.__DSH_MAHJONG_BOOT__ };
  }

  async function invoke(handler, requestToken) {
    let status;
    let body = "";
    const response = {
      headersSent: false,
      writableEnded: false,
      writeHead(nextStatus) {
        status = nextStatus;
        this.headersSent = true;
      },
      end(value) {
        body = String(value ?? "");
        this.writableEnded = true;
      },
    };
    await handler({
      method: "GET",
      url: "/dsh-mahjong/api/state?sessionId=visible-1",
      headers: {
        host: "localhost:3081",
        origin: "http://localhost:3081",
        "sec-fetch-site": "same-origin",
        "x-dsh-mahjong-request-token": requestToken,
      },
      socket: { remoteAddress: "127.0.0.1" },
    }, response);
    return { status, payload: JSON.parse(body) };
  }

  const first = await startProcess();
  const second = await startProcess();
  try {
    assert.equal(first.boot.apiBase, "/dsh-mahjong/api");
    assert.match(first.boot.requestToken, /^[0-9A-Za-z_-]{40,}$/);
    assert.match(second.boot.requestToken, /^[0-9A-Za-z_-]{40,}$/);
    assert.notEqual(first.boot.requestToken, second.boot.requestToken);
    assert.equal(JSON.stringify(first.boot).includes("owner-secret"), false);
    assert.equal(first.harness.httpRegistrations.length, 1);
    assert.equal(
      first.harness.registrations.some((tool) => tool.name === "dsh_mahjong_m0_status"),
      false,
      "dynamic seat mode must not expose the obsolete static-runtime status tool",
    );

    const accepted = await invoke(
      first.harness.httpRegistrations[0].handler,
      first.boot.requestToken,
    );
    assert.equal(accepted.status, 200);
    assert.equal(accepted.payload.ok, true);

    const crossProcess = await invoke(
      first.harness.httpRegistrations[0].handler,
      second.boot.requestToken,
    );
    assert.equal(crossProcess.status, 403);
    assert.equal(crossProcess.payload.error.code, "REQUEST_TOKEN_REJECTED");
  } finally {
    await first.harness.dispose();
    await second.harness.dispose();
  }
});

test("plugin rejects legacy and missing service config before registering any effects", async () => {
  const plugin = await import(new URL("index.js", root));
  for (const config of [undefined, {}, {mjai: {}}, {seats: []}, {service: {url: "http://127.0.0.1:8787"}, seats: []}]) {
    const harness = createHostHarness();
    assert.throws(() => plugin.apply(harness.ctx, config, {environment: {}}), {code: "INVALID_CONFIG"});
    assert.equal(harness.registrations.length, 0);
    assert.equal(harness.httpRegistrations.length, 0);
  }
});

test("service bootstrap escapes inline script content without exposing the service credential", async () => {
  const plugin = await import(new URL("index.js", root));
  const taps = [];
  const requestToken = "</script><script>window.pwned=true</script>";
  plugin.apply({
    effect(fn, label) { if (label === "dsh-mahjong: client game bootstrap") fn(); },
    webServer: {tapIndex(fn) {taps.push(fn); return () => {};}}
  }, {service: {url: "https://mahjong.example"}}, {
    environment: {DSH_MAHJONG_SERVICE_TOKEN: "private-owner-token"}, requestToken
  });
  const html = taps[0]("<html><head></head><body></body></html>");
  assert.equal(html.includes(requestToken), false);
  assert.equal(html.includes("private-owner-token"), false);
  const browser = {window: {}};
  vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], browser);
  assert.equal(browser.window.__DSH_MAHJONG_BOOT__.requestToken, requestToken);
  assert.equal(browser.window.pwned, undefined);
});


test("setup serializes individual initial points and rejects empty, fractional or out-of-range scores", async () => {
  const source = await readFile(clientUrl, "utf8");
  const start = source.indexOf("    function initialDraft(");
  const end = source.indexOf("    function resolveWorkspaceId(", start);
  assert.ok(start > 0 && end > start);
  const { initialDraft, serializeDraft } = vm.runInNewContext(`(() => { ${source.slice(start, end)}; return { initialDraft, serializeDraft }; })()`);
  const draft = initialDraft();
  draft.seats.forEach(seat => { seat.provider = "test"; seat.model = "test"; });
  assert.deepEqual(Array.from(serializeDraft(draft).seats, s => s.initialPoints), [4800, 4800, 4800, 4800]);
  [0, 25000, 50000, 1000000].forEach((points, seat) => { draft.seats[seat].initialPoints = String(points); });
  assert.deepEqual(Array.from(serializeDraft(draft).seats, s => s.initialPoints), [0, 25000, 50000, 1000000]);
  for (const value of ["", " ", "-1", "1.5", "1000001", "Infinity", "abc"]) {
    for (const seat of [0, 1]) {
      const invalid = structuredClone(draft); invalid.seats[seat].initialPoints = value;
      assert.throws(() => serializeDraft(invalid), /家初始积分需为/);
    }
  }
});
