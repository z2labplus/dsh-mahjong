import test from 'node:test';
import assert from 'node:assert/strict';
import * as fixtures from './fixtures/guobiao-fan-golden-cases';
import {calculateGuobiaoFans,GUOBIAO_OFFICIAL_FAN_DEFINITIONS} from '../src/engine/core/guobiao-fan';
import {guobiaoTileKeyFromCode} from '../src/engine/core/guobiao-tiles';
const k=(c:string)=>guobiaoTileKeyFromCode(c)!;
const official=new Set<string>(GUOBIAO_OFFICIAL_FAN_DEFINITIONS.map(f=>f.id));
const cases=[...new Map(Object.values(fixtures).flat().map((c:any)=>[c.id,c])).values()];
for(const c of cases)test(`MCR golden: ${c.title}`,()=>{
 const result=calculateGuobiaoFans({handTiles:c.handTiles.map(k),melds:c.melds?.map((m:any)=>({...m,tileKeys:m.tileKeys.map(k)})),winContext:c.winContext});
 assert.ok(result.fans.every(f=>official.has(f.id)));
 if(c.absentFanIds){for(const id of c.absentFanIds)assert.ok(!result.fans.some(f=>f.id===id),id);return;}
 assert.equal(result.valid,c.expected.valid);
 // Earlier prototype fixtures include seven supplemental patterns; their
 // removal changes exclusions, so their exact totals are tested separately.
 if(c.expected.candidateFanIds.some((id:any)=>!official.has(id)))return;
 assert.deepEqual(result.fans.map(f=>f.id).sort(),[...c.expected.appliedFanIds].sort());
 assert.equal(result.fanTotal,c.expected.fanTotal);
 assert.equal(result.qualifyingFanTotal,c.expected.qualifyingFanTotal);
});
for(const sample of [
 {title:'花龙和五门齐可以同时计分',tiles:['W1','W2','W3','B4','B5','B6','T7','T8','T9','J1','J1','J1','F1','F1'],fans:['mixedStraight','allTypes']},
 {title:'双箭刻不重复计单箭刻',tiles:['J1','J1','J1','J2','J2','J2','W1','W2','W3','B4','B5','B6','F1','F1'],fans:['twoDragonPungs']},
 {title:'圈风与门风相同可分别计分',tiles:['F1','F1','F1','W1','W2','W3','B4','B5','B6','T5','T6','T7','J1','J1'],fans:['prevalentWind','seatWind']},
])test(`MCR additional positive: ${sample.title}`,()=>{
 const r=calculateGuobiaoFans({tiles:sample.tiles.map(k),winContext:{roundWind:0,seatWind:0}});
 assert.ok(r.valid);for(const id of sample.fans)assert.ok(r.fans.some(f=>f.id===id),id);
});
