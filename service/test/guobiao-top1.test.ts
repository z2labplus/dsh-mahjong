import test from 'node:test';
import assert from 'node:assert/strict';
import {guobiaoDistance,guobiaoTop1} from '../src/guobiao-top1';
test('guobiao fallback preserves a ready hand instead of discarding its first tile',()=>{
 const tiles=[0,1,2,9,10,11,18,19,20,27,27,27,31,33];
 const hand=tiles.map((tileKey,tileId)=>({tileKey,tileId}));
 const actions=hand.map(t=>({kind:'discard',tileId:t.tileId}));
 const picked=guobiaoTop1(hand,0,actions);
 assert.ok([12,13].includes(picked.tileId));
 assert.equal(guobiaoDistance(tiles.filter((_,i)=>i!==picked.tileId)),0);
 assert.deepEqual(guobiaoTop1(hand,0,[{kind:'hu'},...actions]),{kind:'hu'});
 assert.deepEqual(guobiaoTop1(hand,0,[{kind:'claim',action:'chi'},{kind:'claim',action:'pass'}]),{kind:'claim',action:'pass'});
});
