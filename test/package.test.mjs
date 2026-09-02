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

async function loadClient(candidate) {
  const source = await readFile(clientUrl, "utf8");
  let definition;
  const origin = "http://127.0.0.1:3081";
  const search = candidate === undefined
    ? ""
    : `?dshMahjongHandUrl=${encodeURIComponent(candidate)}`;
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
    window: {
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
    assert.equal(name, "react");
    return fakeReact();
  });
  const injections = [];
  const registrations = [];
  plugin.apply({
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
  });
  return { injections, registrations, source };
}

function findElement(node, predicate) {
  if (!node || typeof node !== "object") return undefined;
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

test("the plugin uses only additive official Harness slots", async () => {
  const { injections, registrations } = await loadClient();
  assert.deepEqual(
    [...injections].sort(),
    ["conversation.session.header.utilities", "shell.overlay"].sort(),
  );
  assert.deepEqual(
    registrations.map(({ options }) => options.name).sort(),
    ["conversation.session.header.utilities", "shell.overlay"].sort(),
  );
  assert.deepEqual(
    registrations.map(({ options }) => options.id).sort(),
    ["dsh-mahjong-hand", "dsh-mahjong-toggle"].sort(),
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

test("the plugin preserves the native Harness conversation and composer", async () => {
  const { source } = await loadClient();
  assert.doesNotMatch(source, /ctx\.sessions\.scope/);
  assert.doesNotMatch(source, /conversation\.send/);
  assert.doesNotMatch(source, /react\.createElement\("textarea"/);
  assert.doesNotMatch(source, /dsh-mj-compose|dsh-mj-messages/);
  assert.doesNotMatch(source, /toggleSidebar/);
  assert.match(source, /\[data-composer-seat\]/);
});

test("the game surface embeds only the trusted real hand route", async () => {
  const allowed = [
    "http://localhost:1234/hand/?gameId=g1",
    "http://127.0.0.1:1234/hand/?gameId=g2",
  ];
  for (const candidate of allowed) {
    const { registrations } = await loadClient(candidate);
    const overlay = registrations.find(({ options }) => options.name === "shell.overlay");
    const tree = overlay.component({ useSessions: (select) => select({ current: "s1" }) });
    const iframe = findElement(tree, (node) => node.type === "iframe");
    const parsed = new URL(iframe.props.src);
    assert.equal(parsed.origin, new URL(candidate).origin);
    assert.equal(parsed.pathname, "/hand/");
    assert.equal(parsed.searchParams.get("gameId"), new URL(candidate).searchParams.get("gameId"));
    assert.equal(parsed.searchParams.get("parentOrigin"), "http://127.0.0.1:3081");
  }

  const rejected = [
    "https://example.com/hand/?gameId=remote",
    "http://localhost:9999/hand/?gameId=wrong-port",
    "https://localhost:1234/hand/?gameId=https",
    "http://localhost:1234/hand/extra?gameId=extra",
    "http://localhost:1234/hand//?gameId=extra-slash",
    "http://user:secret@localhost:1234/hand/?gameId=credentials",
    "/hand/?gameId=same-origin",
    "javascript:alert(1)",
    "data:text/html,unsafe",
    "not a valid url",
  ];
  for (const candidate of rejected) {
    const { registrations } = await loadClient(candidate);
    const overlay = registrations.find(({ options }) => options.name === "shell.overlay");
    const tree = overlay.component({ useSessions: (select) => select({ current: "s1" }) });
    const iframe = findElement(tree, (node) => node.type === "iframe");
    const parsed = new URL(iframe.props.src);
    assert.equal(parsed.origin, "http://localhost:1234");
    assert.equal(parsed.pathname, "/hand/");
    assert.equal(parsed.searchParams.get("gameId"), null);
    assert.equal(parsed.searchParams.get("parentOrigin"), "http://127.0.0.1:3081");
  }
});

test("the hand iframe is not keyed to a session or layout mode", async () => {
  const { registrations } = await loadClient();
  const overlay = registrations.find(({ options }) => options.name === "shell.overlay");
  const tree = overlay.component({ useSessions: (select) => select({ current: "s1" }) });
  const iframe = findElement(tree, (node) => node.type === "iframe");
  assert.equal(iframe.props.key, undefined);
  assert.equal(iframe.props["data-dsh-mahjong-frame"], "true");
  assert.equal(tree.props["data-mode"], "large");
});

test("the table has exact 16:9 geometry and no visual shell", async () => {
  const { source } = await loadClient();
  assert.match(source, /TABLE_RATIO = 1280 \/ 720/);
  assert.match(source, /height \* TABLE_RATIO/);
  assert.match(source, /ResizeObserver/);
  assert.match(source, /MutationObserver/);
  assert.match(source, /transitionrun/);
  assert.match(source, /event\.target !== appFrame \|\| event\.propertyName !== "grid-template-columns"/);
  assert.match(source, /resizeObserver\.unobserve\(previous\)/);
  assert.match(source, /\[active, mode, currentSessionId\]/);
  assert.match(source, /react\.useLayoutEffect\(\(\) => installStyles\(\), \[\]\)/);
  assert.match(source, /Math\.min\(scrollRect\.bottom, Math\.max\(scrollRect\.top, composerRect\.top\)\)/);
  assert.match(source, /\.dsh-mj-overlay \{[\s\S]*pointer-events: none !important/);
  assert.match(source, /\.dsh-mj-stage \{[\s\S]*pointer-events: auto/);
  assert.match(source, /\.dsh-mj-stage \{[\s\S]*border-radius: 0/);
  assert.match(source, /\.dsh-mj-stage \{[\s\S]*box-shadow: none/);
  assert.match(source, /\.dsh-mj-frame \{[\s\S]*border-radius: 0/);
  assert.match(source, /\.dsh-mj-frame \{[\s\S]*box-shadow: none/);
  assert.doesNotMatch(source, /window\.addEventListener\("resize"/);
});

test("the table switches to compact mode when native questioning begins", async () => {
  const { source, registrations } = await loadClient();
  const utility = registrations.find(
    ({ options }) => options.name === "conversation.session.header.utilities",
  );
  const tree = utility.component({});
  assert.equal(tree.type, "button");
  assert.equal(tree.props["data-dsh-mahjong-toggle"], "true");
  assert.equal(tree.props["aria-label"], "提问这一步");
  assert.match(source, /target\.closest\("\[data-composer-seat\]"\)/);
  assert.match(source, /setOverlayMode\("compact"\)/);
  assert.match(source, /focusNativeComposer\(\)/);
});

test("the table becomes live only after a trusted hand message", async () => {
  const { source } = await loadClient();
  assert.match(source, /event\.source !== frame\.contentWindow \|\| event\.origin !== expectedOrigin/);
  assert.match(source, /data\.type !== HAND_READY_MESSAGE/);
  assert.match(source, /data\.gameId !== expectedGameId/);
  assert.match(source, /setFrameStatus\("live"\)/);
  assert.match(source, /type: HAND_READY_REQUEST_MESSAGE/);
  assert.match(source, /requestHandReady\(frameRef\.current, frameUrl\)/);
});

test("the M0 server status keeps the game bridge explicitly disconnected", async () => {
  const plugin = await import(new URL("index.js", root));
  const registrations = [];
  const ctx = {
    effect(effect) {
      effect();
    },
    tools: {
      register(tool) {
        registrations.push(tool);
        return () => {};
      },
    },
  };

  plugin.apply(ctx);
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].name, "dsh_mahjong_m0_status");
  assert.equal(registrations[0].execute().serverDecisionBridge, "not-connected");
});
