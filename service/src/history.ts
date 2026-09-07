import { ServiceError, validGameId } from './auth';
import { TableCore, type Checkpoint, type TableMetadata } from './table-core';
import type { Entry } from './engine/protocol';

export const MAX_HISTORY_FRAMES = 1200;
export type HistoryFrame = {
  schema: 'dsh-mahjong.frame.v1'; gameId: string; eventIndex: number; at: number;
  ruleset: 'blood' | 'guobiao'; ruleVersion: string; ruleOptions: object;
  tableName: string; perspective: {seat: number; scope: 'self'};
  phase: string; label: string; view: {entries: Entry[]};
};
export function projectFrame(saved: Checkpoint, eventIndex: number, at: number): HistoryFrame {
  const core = new TableCore(saved);
  // Even the all-AI owner's exported record defaults to one seat's knowledge.
  const seat = core.ownerSeat ?? 0;
  const phase = core.state?.phase ?? 'waiting';
  const labels: Record<string,string> = {waiting:'等待入座',swap3:'换三张',dingque:'定缺',playing:'行牌',settling:'结算',done:'结束'};
  return {schema:'dsh-mahjong.frame.v1',gameId:core.metadata.gameId,eventIndex,at,
    ruleset:core.metadata.ruleset,ruleVersion:core.metadata.ruleVersion ?? 'blood-v1',ruleOptions:core.metadata.ruleOptions ?? {},
    tableName:core.metadata.tableName,perspective:{seat,scope:'self'},phase,label:labels[phase] ?? phase,
    view:{entries:core.view(seat).entries}};
}
export function practiceCheckpoint(saved: Checkpoint, metadata: TableMetadata, eventIndex: number, now: number): Checkpoint {
  const source = new TableCore(saved);
  if (!['swap3','dingque','playing'].includes(source.state?.phase) || metadata.ruleset !== source.metadata.ruleset ||
      metadata.ruleVersion !== source.metadata.ruleVersion || JSON.stringify(metadata.ruleOptions) !== JSON.stringify(source.metadata.ruleOptions)) throw new ServiceError('PRACTICE_STATE_UNAVAILABLE',422);
  const branch = structuredClone(saved);
  branch.metadata = {...metadata,mode:'practice',source:{gameId:source.metadata.gameId,eventIndex},joined:[]};
  branch.windows = {}; branch.receipts = [];
  const initialPointsBySeat = Object.fromEntries(metadata.seats.map(seat => [seat.seat, seat.initialPoints ?? 0]));
  for (const [kind,,value] of branch.entries) {
    if (!value) continue;
    if (kind === 'seats') value.startBeans = initialPointsBySeat[value.seat];
    if (kind === 'match') {
      value.seatActors = Object.fromEntries(metadata.seats.map(s=>[s.seat,{...s,kind:`${s.kind}-pending`}]));
      value.friendConfig = {waitMode:'noTimeout',timeoutMs:null};
    }
    if (kind !== 'blood' && kind !== 'gb') continue;
    value.ledger = []; delete value.endSummary; value.settlingSince = null;
    if (kind === 'blood') {
      value.initialBeans = initialPointsBySeat[0];
      value.initialBeansBySeat = { ...initialPointsBySeat };
    } else value.initialPointsBySeat = { ...initialPointsBySeat };
    if (value.turnSince !== undefined) value.turnSince = now;
    if (value.dingqueSince !== undefined) value.dingqueSince = now;
    if (value.swap3?.animatingSince) value.swap3.animatingSince = now;
    for (const [seat, player] of Object.entries(value.players) as [string, any][]) {
      if (kind === 'blood') {player.beans = initialPointsBySeat[Number(seat)]; player.kongGain = 0;}
      else {player.points = initialPointsBySeat[Number(seat)]; player.ruleScore = 0;}
    }
  }
  // Secret tile order and outstanding simultaneous responses stay server-side.
  branch.engine.replaySeq = now; branch.engine.replayMetaLogged = false;
  if ('replayHandsLogged' in branch.engine) branch.engine.replayHandsLogged = false;
  return new TableCore(branch).checkpoint();
}

export function validateArchive(input: any) {
  if (input?.schema !== 'dsh-mahjong.replay.v1' || !validGameId(input.gameId) ||
      !Array.isArray(input.frames) || !input.frames.length || input.frames.length > MAX_HISTORY_FRAMES) throw new ServiceError('INVALID_REPLAY');
  const permitted = new Set(['match','blood','gb','things','seats','nicks','tileFacePublic','tileFaceSelf']);
  const frames: HistoryFrame[] = input.frames.map((raw: any,index: number) => {
    if (raw?.schema !== 'dsh-mahjong.frame.v1' || raw.gameId !== input.gameId || raw.eventIndex !== index ||
        !['blood','guobiao'].includes(raw.ruleset) || raw.ruleVersion !== (raw.ruleset === 'blood' ? 'blood-v1' : 'mcr-81-v1') ||
        !Number.isInteger(raw.perspective?.seat) || raw.perspective.seat < 0 || raw.perspective.seat > 3 ||
        !Number.isSafeInteger(raw.at) || raw.at < 0 || !Array.isArray(raw.view?.entries) || raw.view.entries.length > 700 ||
        typeof raw.tableName !== 'string' || raw.tableName.length > 80 || !['waiting','swap3','dingque','playing','settling','done'].includes(raw.phase)) throw new ServiceError('INVALID_REPLAY');
    if(JSON.stringify(raw).length>200000)throw new ServiceError('INVALID_REPLAY');
    const entries: Entry[] = structuredClone(raw.view.entries);
    const object=(v:any)=>v!==null&&typeof v==='object'&&!Array.isArray(v);
    const tileId=(v:any)=>Number.isInteger(v)&&v>=0&&v<(raw.ruleset==='blood'?108:144);
    const slot=(v:any)=>typeof v==='string'&&/^(?:hand|wall|discard|meld|flower|hu)[a-zA-Z0-9.]*@[0-3]$/.test(v)&&v.length<50;
    const forbidden=new Set(['__proto__','constructor','prototype','secret','tileKeyById','pendingResponsesById','snapshotKey']);
    const inspect=(v:any,depth=0)=>{if(depth>24)throw new ServiceError('INVALID_REPLAY');if(v&&typeof v==='object')for(const [key,value] of Object.entries(v)){if(forbidden.has(key))throw new ServiceError('REPLAY_HIDDEN_STATE');inspect(value,depth+1);}};
    inspect(entries);
    const keys = new Set();
    for (const row of entries) {
      if (!Array.isArray(row) || row.length !== 3 || !permitted.has(row[0]) || !['number','string'].includes(typeof row[1])) throw new ServiceError('INVALID_REPLAY');
      const key = JSON.stringify(row.slice(0,2)); if (keys.has(key)) throw new ServiceError('INVALID_REPLAY'); keys.add(key);
      const [kind,id,value]=row;
      if(['things','tileFacePublic','tileFaceSelf'].includes(kind)&&!tileId(id))throw new ServiceError('INVALID_REPLAY');
      if(kind==='things' && (!object(value)||!slot(value.slotName)||!Number.isInteger(value.rotationIndex)||value.rotationIndex<0||value.rotationIndex>3||!object(value.heldRotation)||['x','y','z','w'].some(k=>!Number.isFinite(value.heldRotation[k]))))throw new ServiceError('INVALID_REPLAY');
      if(kind==='seats' && (!/^seat-[0-3]$/.test(String(id))||!object(value)||value.seat!==Number(String(id).slice(-1))||!Number.isFinite(value.startBeans)))throw new ServiceError('INVALID_REPLAY');
      if(kind==='nicks' && (typeof value!=='string'||value.length>200))throw new ServiceError('INVALID_REPLAY');
      if(kind==='match' && (id!==0||!object(value)||!object(value.conditions)||value.conditions.gameType!==(raw.ruleset==='blood'?'BLOOD_BATTLE':'GUOBIAO')))throw new ServiceError('INVALID_REPLAY');
      if (['blood','gb'].includes(row[0]) && row[2]) {
        if(id!==0||kind!==(raw.ruleset==='blood'?'blood':'gb')||!object(value)||!object(value.players)||[0,1,2,3].some(s=>!object(value.players[s])||!Array.isArray(value.players[s].melds)))throw new ServiceError('INVALID_REPLAY');
        if (!Array.isArray(row[2].wallOrder) || row[2].wallOrder.length > 144 || row[2].wallOrder.some((id: any)=>id!==null)) throw new ServiceError('REPLAY_HIDDEN_STATE');
        if (row[2].phase !== raw.phase) throw new ServiceError('INVALID_REPLAY');
      }
    }
    const things = new Map(entries.filter(([k])=>k==='things').map(([,id,v])=>[id,v]));
    for (const row of entries) {
      if (!['tileFaceSelf','tileFacePublic'].includes(row[0]) || row[2] === null) continue;
      if (!Number.isInteger(row[2]) || row[2] < 0 || row[2] >= (raw.ruleset === 'blood'?27:42)) throw new ServiceError('INVALID_REPLAY');
      const slot = things.get(row[1])?.slotName;
      if (typeof slot !== 'string' || slot.startsWith('wall.')) throw new ServiceError('REPLAY_HIDDEN_STATE');
      if (!['settling','done'].includes(raw.phase) && slot.startsWith('hand.') && !slot.endsWith(`@${raw.perspective.seat}`)) throw new ServiceError('REPLAY_HIDDEN_STATE');
    }
    return {schema:'dsh-mahjong.frame.v1',gameId:input.gameId,eventIndex:index,at:raw.at,
      ruleset:raw.ruleset,ruleVersion:raw.ruleVersion,ruleOptions:raw.ruleset==='guobiao'?{autoBuhua:raw.ruleOptions?.autoBuhua !== false}:{},
      tableName:raw.tableName,perspective:{seat:raw.perspective.seat,scope:'self'},phase:raw.phase,label:raw.phase,view:{entries}};
  });
  if (frames.some(f=>f.ruleset!==frames[0]!.ruleset || f.perspective.seat!==frames[0]!.perspective.seat || JSON.stringify(f.ruleOptions)!==JSON.stringify(frames[0]!.ruleOptions))) throw new ServiceError('INVALID_REPLAY');
  return {schema:'dsh-mahjong.replay.v1',gameId:input.gameId,frames};
}
