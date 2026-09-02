import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const packageJson = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
const client = await readFile(new URL("client.js", root), "utf8");
const patch = await readFile(new URL("cordis.patch.yml", root), "utf8");

assert.equal(packageJson.name, "dsh-mahjong");
assert.equal(packageJson.exports["./client"], "./client.js");
assert.equal(packageJson.dsh.client.platform, "web");
assert.equal(packageJson.dsh.bundle.patch, "./cordis.patch.yml");
assert.match(client, /ctx\.slots\.inject\("conversation"/);
assert.match(client, /http:\/\/localhost:1234\/hand\//);
assert.match(client, /grid-template-columns: minmax\(0, 7fr\) minmax\(320px, 3fr\)/);
assert.doesNotMatch(client, /ctx\.slots\.register\(\s*\{\s*name: "root"/);
assert.match(patch, /name: dsh-mahjong/);

console.log("dsh-mahjong package contract OK");
