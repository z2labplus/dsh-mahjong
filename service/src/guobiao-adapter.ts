import { GuobiaoEngine } from './engine/guobiao-engine';
import { Game } from './engine/game';
import { guobiaoTileCode, isGuobiaoFlower } from './engine/core/guobiao-tiles';

// Only this seat's visible hand and public state leave the rule adapter.
export function guobiaoCatalog(game: Game, engine: GuobiaoEngine, seat: number) {
  const state = engine.currentState();
  if (!state || state.phase !== 'playing') return null;
  const me = state.players[seat];
  if (!me?.playerId) return null;
  const hand = engine.listHandTilesForSeat(seat);
  const actions: any[] = [];
  let scene: string;
  if (state.pending) {
    const p = state.pending;
    if (seat === p.fromSeat || p.responses[seat] != null) return null;
    const opt = engine.claimOptionsForSeat(state, seat);
    if (!opt || !(opt.hu || opt.chi.length || opt.peng || opt.mingGang)) return null;
    scene = 'claim';
    if (opt.hu && opt.huKind === 'legal') actions.push({kind:'claim',pendingId:p.id,action:'hu'});
    if (opt.mingGang) actions.push({kind:'claim',pendingId:p.id,action:'mingGang'});
    if (opt.peng) actions.push({kind:'claim',pendingId:p.id,action:'peng'});
    for (const chi of opt.chi) actions.push({kind:'claim',pendingId:p.id,action:'chi',optionId:chi.optionId});
    actions.push({kind:'claim',pendingId:p.id,action:'pass'});
  } else {
    if (state.turnSeat !== seat || state.turnStep !== 'discard') return null;
    scene = 'turn';
    const hu = engine.selfHuFanResultForSeat(state, seat);
    if (hu?.valid && hu.qualifyingFanTotal >= state.baseRuleScore) actions.push({kind:'hu',source:'self'});
    if (state.wallHeadIndex <= state.wallTailIndex) {
      for (const tile of hand) if (isGuobiaoFlower(tile.tileKey)) actions.push({kind:'buhua',tileId:tile.tileId});
      for (const tileKey of new Set(hand.filter(t => !isGuobiaoFlower(t.tileKey)).map(t => t.tileKey))) {
        if (hand.filter(t => t.tileKey === tileKey).length === 4) actions.push({kind:'anGang',tileKey,tileIds:hand.filter(t=>t.tileKey===tileKey).map(t=>t.tileId)});
      }
      for (const meld of me.melds) if (meld.kind === 'peng') {
        for (const tile of hand.filter(t => t.tileKey === meld.tileKeys[0])) actions.push({kind:'addGang',tileId:tile.tileId,meldId:meld.id});
      }
    }
    for (const tile of hand) actions.push({kind:'discard',tileId:tile.tileId});
  }
  // Reject edge cases (flower supplement restrictions, robbed kongs, dead hands)
  // against an isolated copy of the actual rules, never the live game.
  const valid = actions.filter(action => {
    const copy = new Game(game.gameId, game.snapshotEntries());
    const validator = new GuobiaoEngine(copy, {appendReplayEvents:()=>{}});
    validator.restoreCheckpoint(engine.exportCheckpoint());
    return validator.handleAction(me.playerId!, action, state.turnSince).ok;
  });
  if (!valid.length) return null;
  const rawByActionId = new Map<string, any>();
  const publicActions = valid.map((raw,index) => {
    const legalActionId = `gb-${index}`; rawByActionId.set(legalActionId,raw);
    const action: any = {legalActionId,kind:raw.kind};
    if (raw.action) action.action = raw.action;
    if (raw.source) action.source = raw.source;
    if (raw.tileId !== undefined) action.tile = guobiaoTileCode(hand.find(t=>t.tileId===raw.tileId)!.tileKey);
    if (raw.tileKey !== undefined) action.tile = guobiaoTileCode(raw.tileKey);
    if (raw.optionId) action.sequence = engine.claimOptionsForSeat(state,seat).chi.find(c=>c.optionId===raw.optionId)!.sequence.map(guobiaoTileCode);
    return action;
  });
  const publicState = {
    phase:state.phase,turnSeat:state.turnSeat,turnStep:state.turnStep,dealer:state.dealer,roundWind:state.roundWind,
    wallRemaining:Math.max(0,state.wallTailIndex-state.wallHeadIndex+1),
    pending:state.pending ? {kind:state.pending.kind,fromSeat:state.pending.fromSeat,tile:guobiaoTileCode(state.pending.tileKey)} : null,
    players:Object.fromEntries([0,1,2,3].map(s=>{
      const p=engine.viewState(seat)!.players[s]!;
      return [s,{points:p.points,wrongHu:p.wrongHu,flowers:p.flowers.map(guobiaoTileCode),concealedTileCount:engine.listHandTilesForSeat(s).length,
        melds:p.melds.map(m=>m.kind==='flower'?{kind:m.kind,tile:guobiaoTileCode(m.tileKey)}:{kind:m.kind,tiles:m.tileKeys.map(guobiaoTileCode),fromSeat:m.fromSeat})}];
    })),
    discards:[...game.entries('things')].filter(([,t])=>t.slotName.startsWith('discard.')).map(([id,t])=>({seat:Number(t.slotName.split('@')[1]),tile:guobiaoTileCode(game.get('tileFacePublic',id))})),
  };
  const snapshotKey = JSON.stringify([scene,state.turnSince,state.pending?.id,hand,valid]);
  return {snapshotKey,scene,rawByActionId,publicActions,publicState,
    handState:{concealedTiles:hand.map(t=>guobiaoTileCode(t.tileKey))}};
}
export function guobiaoEnvelope(catalog: NonNullable<ReturnType<typeof guobiaoCatalog>>, metadata: any) {
  const {gameId,seat,decisionId,openedAtMs,deadlineAtMs,modelId,modelLabel} = metadata;
  return {schemaVersion:1,ruleset:'guobiao',ruleVersion:'mcr-81-v1',rules:'标准国标 81 番种，8 番起和，花牌不计起和门槛；无定缺、无换三张；吃限上家。牌码 W=万，B=筒，T=条，F=东南西北，J=中发白，H=花。',
    gameId,seat,decisionId,openedAtMs,deadlineAtMs,modelId,modelLabel,snapshotId:decisionId,scene:catalog.scene,handState:catalog.handState,publicState:catalog.publicState,legalActions:catalog.publicActions};
}
