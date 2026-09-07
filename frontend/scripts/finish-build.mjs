import { mkdir, rename, writeFile, readFile, cp, rm } from 'node:fs/promises';
// Parcel's cached output stays untouched. The release layout is assembled separately.
const dist = new URL('../dist/', import.meta.url);
await rm(dist, {recursive: true, force: true});
await cp(new URL('../.hand-build/', import.meta.url), dist, {recursive: true});
await mkdir(new URL('hand/', dist), { recursive: true });
const entry = new URL('index.html', dist);
const hand = await readFile(entry, 'utf8');
if (!hand.includes('id="full"') && !hand.includes('id=full')) throw new Error('Parcel output is not the Mahjong entry');
await writeFile(entry, hand.replace(/<!doctype html>/i, '<!DOCTYPE html><base href="/">'));
await rename(entry, new URL('hand/index.html', dist));
await writeFile(new URL('_headers', dist), '/*\n  Referrer-Policy: no-referrer\n  X-Content-Type-Options: nosniff\n');
await writeFile(new URL('index.html',dist),await readFile(new URL('../service-home.html',import.meta.url),'utf8'));
