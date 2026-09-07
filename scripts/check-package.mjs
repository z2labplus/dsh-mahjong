import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const packageJson = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
const client = await readFile(new URL("client.js", root), "utf8");
const controller = await readFile(new URL("lib/game-controller.js", root), "utf8");
const httpApi = await readFile(new URL("lib/http-api.js", root), "utf8");
const patch = await readFile(new URL("cordis.patch.yml", root), "utf8");

assert.equal(packageJson.name, "dsh-mahjong");
assert.equal(packageJson.exports["./client"], "./client.js");
assert.equal(packageJson.dsh.client.platform, "web");
assert.equal(packageJson.dsh.bundle.patch, "./cordis.patch.yml");
assert.equal(packageJson.peerDependencies["@deepseek-ai/cordis"], "^4.0.1");
assert.equal(packageJson.peerDependencies["@deepseek-ai/dsh-agent-loop"], "^0.1.0-rc.8");
assert.equal(packageJson.peerDependencies["@deepseek-ai/dsh-client-connection"], "^0.1.0-rc.8");
assert.equal(packageJson.peerDependencies["@deepseek-ai/dsh-client-runtime"], "^0.1.0-rc.8");
assert.equal(packageJson.peerDependencies["@deepseek-ai/dsh-client-ui-conversation"], "^0.1.0-rc.8");
assert.equal(packageJson.peerDependencies["@deepseek-ai/dsh-client-ui-layout"], "^0.1.0-rc.8");
assert.equal(packageJson.peerDependencies["@deepseek-ai/dsh-client-ui-sidebar"], "^0.1.0-rc.8");
assert.equal(packageJson.peerDependencies["@deepseek-ai/dsh-client-ui-workspace"], "^0.1.0-rc.8");
assert.equal(packageJson.peerDependencies["@deepseek-ai/dsh-host-webserver"], "^0.1.0-rc.8");
assert.equal(packageJson.peerDependencies["@deepseek-ai/dsh-session-persistence"], "^0.1.0-rc.8");
assert.equal(packageJson.peerDependencies["@deepseek-ai/dsh-system-prompt"], "^0.1.0-rc.8");
for (const dependency of [
  "@deepseek-ai/dsh-client-runtime",
  "@deepseek-ai/dsh-client-connection",
  "@deepseek-ai/dsh-client-ui-conversation",
  "@deepseek-ai/dsh-client-ui-layout",
  "@deepseek-ai/dsh-client-ui-sidebar",
  "@deepseek-ai/dsh-client-ui-workspace",
]) {
  assert.ok(packageJson.dsh.client.inject.includes(dependency));
}
assert.ok(packageJson.files.includes("scripts"));
assert.match(client, /ctx\.slots\.inject\("shell\.overlay"/);
assert.match(client, /ctx\.slots\.inject\("conversation\.session\.header\.utilities"/);
assert.match(client, /safeHandUrl/);
assert.match(controller, /http:\/\/127\.0\.0\.1:8787\/hand\//);
assert.match(client, /TABLE_RATIO = 1280 \/ 720/);
assert.match(client, /data-dsh-mahjong-overlay/);
assert.match(client, /data-dsh-mahjong-frame/);
assert.doesNotMatch(client, /name: "(?:root|conversation|conversation\.session|conversation\.session\.header|conversation\.composer|details)"/);
assert.doesNotMatch(client, /ctx\.sessions\.scope|conversation\.send|toggleSidebar/);
assert.match(patch, /name: dsh-mahjong/);
assert.doesNotMatch(patch, /seats:|mjai:/);
assert.match(patch, /tokenEnv: DSH_MAHJONG_SERVICE_TOKEN/);
assert.match(patch, /url: http:\/\/127\.0\.0\.1:8787/);
assert.match(patch, /handUrlBase: http:\/\/127\.0\.0\.1:8787\/hand\//);
assert.doesNotMatch(patch, /gameId:|MJAI_AI_SEAT_/);
assert.match(httpApi, /\/models/);
assert.match(httpApi, /\/state/);
assert.match(httpApi, /\/games\/start/);

console.log("dsh-mahjong package contract OK");
