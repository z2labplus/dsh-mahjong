import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("the plugin uses the public conversation slot and leaves root alone", async () => {
  const source = await readFile(new URL("client.js", root), "utf8");
  assert.match(source, /ctx\.slots\.inject\("conversation"/);
  assert.match(source, /name: "conversation",\s*priority: -1,/);
  assert.doesNotMatch(source, /name: "root"/);
});

test("the default sidebar collapse waits until the workspace is mounted", async () => {
  const source = await readFile(new URL("client.js", root), "utf8");
  assert.match(source, /react\.useEffect\(\(\) => \{\s*if \(window\.__DSH_MAHJONG_SIDEBAR_INITIALIZED__\) return;/);
  assert.match(source, /toggleSidebar: \(\) => ctx\.layout\.toggleSidebar\(\)/);
  assert.doesNotMatch(source, /function apply\(ctx\) \{\s*if \(!window\.__DSH_MAHJONG_SIDEBAR_INITIALIZED__\)/);
});

test("the game surface embeds the real hand route", async () => {
  const source = await readFile(new URL("client.js", root), "utf8");
  assert.match(source, /DEFAULT_HAND_URL = "http:\/\/localhost:1234\/hand\/"/);
  assert.match(source, /parsed\.origin === "http:\/\/localhost:1234"/);
  assert.match(source, /return isLocalDevelopmentOrigin && path === "\/hand"/);
  assert.doesNotMatch(source, /path === "\/dsh-mahjong\/hand"/);
  assert.match(source, /parsed\.searchParams\.set\("parentOrigin", window\.location\.origin\)/);
  assert.match(source, /react\.createElement\("iframe"/);
  assert.doesNotMatch(source, /tiles\.svg|mahjong-tile/);
});

test("the table becomes live only after a trusted hand message", async () => {
  const source = await readFile(new URL("client.js", root), "utf8");
  assert.match(source, /event\.source !== frame\.contentWindow \|\| event\.origin !== expectedOrigin/);
  assert.match(source, /data\.type !== HAND_READY_MESSAGE/);
  assert.match(source, /data\.gameId !== expectedGameId/);
  assert.match(source, /setFrameStatus\("live"\)/);
  assert.match(source, /牌桌页面已载入，等待对局/);
  assert.match(source, /type: HAND_READY_REQUEST_MESSAGE/);
  assert.match(source, /requestHandReady\(frameRef\.current, frameUrl\)/);
});

test("composer state is isolated by Harness session", async () => {
  const source = await readFile(new URL("client.js", root), "utf8");
  assert.match(source, /COMPOSER_BY_SESSION\.get\(sessionKey\)/);
  assert.match(source, /COMPOSER_BY_SESSION\.set\(sessionKey,/);
  assert.match(source, /MAX_COMPOSER_CACHE_SIZE = 64/);
  assert.match(source, /targetSessionKey = sessionKey/);
  assert.doesNotMatch(source, /var draftPair = react\.useState\(""\)/);
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
