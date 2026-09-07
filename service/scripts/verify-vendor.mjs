import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('source-manifest.json', root), 'utf8'));
for (const entry of manifest.files) {
  const bytes = await readFile(new URL(entry.target, root));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.vendoredSha256, `Extracted engine changed: ${entry.target}. Review the adaptation and update its manifest deliberately.`);
}
const license = await readFile(new URL('licenses/mjai-COPYING', root), 'utf8');
assert.match(license, /license \(MIT\)/);
console.log(`Verified ${manifest.files.length} extracted source files and upstream license`);
