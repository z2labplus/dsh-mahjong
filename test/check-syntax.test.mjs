import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checker = path.join(repositoryRoot, "scripts", "check-syntax.mjs");

test("syntax check visits every JavaScript file under lib", () => {
  const fixtureRoot = mkdtempSync(path.join(repositoryRoot, ".syntax-fixture-"));
  try {
    mkdirSync(path.join(fixtureRoot, "lib"));
    writeFileSync(path.join(fixtureRoot, "index.js"), "export const ok = true;\n");
    writeFileSync(path.join(fixtureRoot, "client.js"), "globalThis.client = true;\n");
    writeFileSync(path.join(fixtureRoot, "lib", "a-valid.js"), "export {};\n");
    writeFileSync(path.join(fixtureRoot, "lib", "z-invalid.js"), "export const broken = ;\n");

    const result = spawnSync(process.execPath, [checker, fixtureRoot], {
      encoding: "utf8",
    });
    assert.notEqual(
      result.status,
      0,
      `checker unexpectedly succeeded: ${result.stdout}\n${result.stderr}`,
    );
    assert.match(`${result.stdout}\n${result.stderr}`, /z-invalid\.js/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
