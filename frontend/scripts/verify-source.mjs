import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('../../docs/hand-parity-manifest.json', import.meta.url), 'utf8'));
const allowed = new Set([...manifest.transportAdaptations,...(manifest.rulesAdaptations??[])]);
for (const file of manifest.files) {
  const bytes = await readFile(new URL(file.source, root));
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (hash !== file.vendoredSha256) throw new Error(`Snapshot changed without updating its record: ${file.source}`);
  if (!allowed.has(file.source) && hash !== file.sha256) throw new Error(`Original visual source changed: ${file.source}`);
  if (file.category === 'asset' && hash !== file.sha256) throw new Error(`Original asset changed: ${file.source}`);
}
console.log(`Verified ${manifest.files.length} original files, ${manifest.files.filter(f => f.category === 'asset').length} unchanged assets and ${allowed.size} documented transport/rule adapters`);

const browserFan=await readFile(new URL('server/core/guobiao-fan.ts',root),'utf8');
const serverFan=await readFile(new URL('../service/src/engine/core/guobiao-fan.ts',root),'utf8');
if(browserFan!==serverFan)throw new Error('Browser and service MCR scoring must remain identical');
