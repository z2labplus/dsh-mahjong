import { guobiaoTop1 } from './guobiao-top1';
import { coachLesson, coachPassed, type CoachState } from './coach-lessons';
import { GuobiaoEngine } from './engine/guobiao-engine';
import { guobiaoCatalog, guobiaoEnvelope } from './guobiao-adapter';
import { ServiceError, type Access } from './auth';
import { Game } from './engine/game';
import { BloodEngine, type BloodState } from './engine/blood-engine';
import { buildBloodAiDecisionCatalog, buildBloodAiDecisionEnvelope } from './engine/blood-ai-decision-envelope';
import { BloodTop1ActionPicker } from './engine/blood-top1-action-picker';
import type { Entry } from './engine/protocol';
import type { ReplayEvent } from './engine/replay-store';
import { prepareChallengeDraw, challengeAction, recordChallengeAction, challengeSummary, type ChallengeState } from './challenge-policy';

export const DEFAULT_INITIAL_POINTS = 4_800;
export const MAX_INITIAL_POINTS = 1_000_000;
export type Seat = { seat: number; kind: 'ai' | 'human'; owner?: boolean; modelId?: string; modelLabel?: string; initialPoints?: number };
export type TableMetadata = {
  gameId: string; tenant: string; owner: string; tableName: string; ruleset: 'blood' | 'guobiao'; ruleVersion?: string; ruleOptions?: { autoBuhua?: boolean };
  timeoutMs: number; createdAtMs: number; seats: Seat[]; joined: number[]; mode?: 'practice' | 'live' | 'coach' | 'challenge'; coach?:CoachState; source?: {gameId:string;eventIndex:number}; seatEpochs?: Record<number,number>;
};
type Window = { decisionId: string; snapshotKey: string; openedAtMs: number; deadlineAtMs: number };
type Receipt = { seat: number; actionId: string; fingerprint: string; humanFingerprint?: string; ack: any };
export type Checkpoint = {
  version: 1; metadata: TableMetadata; entries: Entry[];
  engine: ReturnType<BloodEngine['exportCheckpoint']> | ReturnType<GuobiaoEngine['exportCheckpoint']>;
  windows: Record<number, Window>; receipts: Receipt[];
  challenge?: ChallengeState;
};
function shortText(value: unknown, max: number, fallback?: string): string {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value)) throw new ServiceError('INVALID_TABLE');
  return value;
}
export function normalizeTable(input: any, owner: Access, gameId: string, now: number): TableMetadata {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
    Object.keys(input).some(key => !['tableName', 'timeoutSeconds', 'seats', 'ruleset', 'ruleOptions'].includes(key))) throw new ServiceError('INVALID_TABLE');
  if (input.ruleset !== undefined && !['blood', 'guobiao'].includes(input.ruleset)) throw new ServiceError('RULESET_NOT_READY', 422);
  const ruleset = input.ruleset ?? 'blood';
  const ruleOptions = input.ruleOptions ?? {};
  if (!ruleOptions || typeof ruleOptions !== 'object' || Array.isArray(ruleOptions) || Object.keys(ruleOptions).some(k => ruleset !== 'guobiao' || k !== 'autoBuhua') || (ruleOptions.autoBuhua !== undefined && typeof ruleOptions.autoBuhua !== 'boolean')) throw new ServiceError('INVALID_RULE_OPTIONS');
  const timeoutSeconds = input.timeoutSeconds ?? 38;
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 10 || timeoutSeconds > 120) throw new ServiceError('INVALID_TIMEOUT');
  if (!Array.isArray(input.seats) || input.seats.length !== 4) throw new ServiceError('INVALID_SEATS');
  const seats: Seat[] = input.seats.map((candidate: any) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate) ||
      !Number.isInteger(candidate.seat) || candidate.seat < 0 || candidate.seat > 3 ||
      !['human', 'ai'].includes(candidate.kind)) throw new ServiceError('INVALID_SEATS');
    const allowed = candidate.kind === 'human' ? ['seat', 'kind', 'owner', 'initialPoints'] : ['seat', 'kind', 'modelId', 'modelLabel', 'initialPoints'];
    if (Object.keys(candidate).some(key => !allowed.includes(key))) throw new ServiceError('INVALID_SEATS');
    const initialPoints = candidate.initialPoints === undefined ? DEFAULT_INITIAL_POINTS : candidate.initialPoints;
    if (!Number.isSafeInteger(initialPoints) || initialPoints < 0 || initialPoints > MAX_INITIAL_POINTS) throw new ServiceError('INVALID_INITIAL_POINTS');
    if (candidate.kind === 'human') {
      if (candidate.owner !== undefined && typeof candidate.owner !== 'boolean') throw new ServiceError('INVALID_SEATS');
      return { seat: candidate.seat, kind: 'human', owner: candidate.owner === true, initialPoints };
    }
    return { seat: candidate.seat, kind: 'ai', modelId: shortText(candidate.modelId, 120), modelLabel: shortText(candidate.modelLabel, 80, candidate.modelId), initialPoints };
  }).sort((a: Seat, b: Seat) => a.seat - b.seat);
  if (new Set(seats.map(s => s.seat)).size !== 4 || seats.filter(s => s.owner).length !== (seats.some(s => s.kind === 'human') ? 1 : 0)) throw new ServiceError('INVALID_SEATS');
  return { gameId, tenant: owner.tenant, owner: owner.owner, tableName: shortText(input.tableName, 80, '麻将牌局'), ruleset, ruleVersion: ruleset === 'guobiao' ? 'mcr-81-v1' : 'blood-v1', ruleOptions: ruleset === 'guobiao' ? { autoBuhua: ruleOptions.autoBuhua ?? true } : {}, timeoutMs: timeoutSeconds * 1000, createdAtMs: now, seats, joined: [] };
}

export class TableCore {
  challenge?: ChallengeState;
  metadata: TableMetadata;
  readonly game: Game;
  readonly engine: BloodEngine | GuobiaoEngine;
  private catalogCache = new Map<number, any>();
  readonly events: ReplayEvent[] = [];
  readonly resolutions: Record<string, 'agent' | 'timeout_top1'> = {};
  windows: Record<number, Window> = {};
  private receipts: Receipt[] = [];
  constructor(source: TableMetadata | Checkpoint) {
    const saved = 'version' in source ? structuredClone(source) : null;
    this.challenge = saved?.challenge;
    this.metadata = structuredClone(saved ? saved.metadata : source as TableMetadata);
    this.game = new Game(this.metadata.gameId, saved?.entries);
    this.engine = new (this.metadata.ruleset === 'guobiao' ? GuobiaoEngine : BloodEngine)(this.game, { appendReplayEvents: events => this.events.push(...events) });
    if (saved) {
      if (saved.version !== 1) throw new ServiceError('SNAPSHOT_VERSION_UNSUPPORTED', 503);
      this.engine.restoreCheckpoint(saved.engine as any);
      this.windows = structuredClone(saved.windows);
      this.receipts = structuredClone(saved.receipts);
    } else {
      this.game.systemUpdate([
        ['match', 0, { dealer: 0, honba: 0, roomType: 'friend', conditions: { gameType: this.metadata.ruleset === 'guobiao' ? 'GUOBIAO' : 'BLOOD_BATTLE', back: 0, fives: '000', points: '25', dealType: 'HANDS' }, friendConfig: { waitMode: 'noTimeout', timeoutMs: null }, guobiaoConfig: { autoBuhuaBySeat: Object.fromEntries([0,1,2,3].map(seat => [seat, this.metadata.ruleOptions?.autoBuhua ?? true])) }, seatActors: Object.fromEntries(this.metadata.seats.map(s => [s.seat, { ...s, kind: `${s.kind}-pending` }])) }],
      ]);
    }
  }
  get state(): any { return this.engine instanceof GuobiaoEngine ? this.engine.currentState() : this.game.get('blood', 0); }
  get ownerSeat(): number | null { return this.metadata.seats.find(s => s.owner)?.seat ?? null; }
  owns(access: Access): boolean { return access.tenant === this.metadata.tenant && access.owner === this.metadata.owner; }
  authorize(access: Access): void {
    if (!this.owns(access) || (access.kind !== 'owner' && access.gameId !== this.metadata.gameId)) throw new ServiceError('FORBIDDEN', 403);
    if (access.kind === 'ai' || access.kind === 'human') {
      if ((access.seatEpoch ?? 0) !== (this.metadata.seatEpochs?.[access.seat!] ?? 0) || this.metadata.seats[access.seat!]?.kind !== access.kind) throw new ServiceError('FORBIDDEN', 403);
    }
  }
  join(seat: number, now: number): void {
    if (this.metadata.joined.includes(seat)) return;
    const config = this.metadata.seats[seat];
    if (!config) throw new ServiceError('INVALID_SEAT');
    this.metadata.joined.push(seat);
    const match = this.game.get('match', 0);
    this.game.systemUpdate([
      // Persisted tables without initialPoints retain their original zero baseline.
      ['seats', `seat-${seat}`, { seat, startBeans: config.initialPoints ?? 0 }],
      ['nicks', `seat-${seat}`, (this.challenge ? this.challenge.names[seat] : config.modelLabel) ?? `玩家 ${seat + 1}`],
      ['match', 0, { ...match, seatActors: { ...match.seatActors, [seat]: config } }],
    ]);
    this.progress(now);
  }
  catalog(seat: number): any {
    if (!this.catalogCache.has(seat)) this.catalogCache.set(seat, this.engine instanceof GuobiaoEngine
      ? guobiaoCatalog(this.game, this.engine, seat)
      : this.state ? buildBloodAiDecisionCatalog({ game: this.game, engine: this.engine, state: this.state, seat }) : null);
    const catalog=this.catalogCache.get(seat);
    if(this.challenge && catalog){
      const seen=new Map<number,number>(this.game.entries('tileFacePublic').map(([id,k])=>[Number(id),k]));
      for(const [id,t] of this.game.entries('things'))if(t.slotName?.startsWith('hand.')&&t.slotName.endsWith(`@${seat}`)&&this.engine instanceof BloodEngine)seen.set(Number(id),this.engine.tileKeyForId(Number(id))!);
      const counts=Array(27).fill(0);for(const k of seen.values())if(Number.isInteger(k)&&k>=0&&k<27)counts[k]++;
      catalog.visibleCounts=counts;
    }
    return catalog;
  }
  progress(now: number): void {
    this.catalogCache.clear();
    if (this.metadata.joined.length < 4 || (this.metadata.coach && this.metadata.coach.status !== 'active')) {this.windows = {}; return;}
    for (let i = 0; i < 12; i++) {
      const revision = this.game.revision;
      if(this.challenge)prepareChallengeDraw(this);
      this.engine.tick(now);
      if (this.game.revision === revision) break;
      if (i === 11) throw new ServiceError('ENGINE_DID_NOT_SETTLE', 500);
    }
    for (let seat = 0; seat < 4; seat++) {
      if(this.metadata.coach && seat!==0){delete this.windows[seat];continue;}
      const catalog = this.catalog(seat);
      if (!catalog || !catalog.publicActions.length) { delete this.windows[seat]; continue; }
      if (this.windows[seat]?.snapshotKey === catalog.snapshotKey) continue;
      this.windows[seat] = { decisionId: crypto.randomUUID(), snapshotKey: catalog.snapshotKey, openedAtMs: now, deadlineAtMs: now + (this.challenge&&seat===this.challenge.seat?120000:this.metadata.timeoutMs) };
    }
  }
  decision(seat: number) {
    const window = this.windows[seat];
    const catalog = this.catalog(seat);
    if (!window || !catalog || window.snapshotKey !== catalog.snapshotKey) return null;
    const config = this.metadata.seats[seat]!;
    const envelope = (this.metadata.ruleset === 'guobiao' ? guobiaoEnvelope : buildBloodAiDecisionEnvelope)(catalog, { gameId: this.metadata.gameId, seat, ...window, modelId: config.modelId, modelLabel: config.modelLabel });
    return this.challenge && config.kind==='ai' ? {...envelope,sourcePriority:{policy:'source-priority-v1',legalActionId:challengeAction(this,seat).action.legalActionId}} : envelope;
  }
  submit(seat: number, message: any, now: number): any {
    const actionId = shortText(message.actionId, 120);
    const action = message.action;
    if (!action || action.kind !== 'aiDecision' || typeof action.decisionId !== 'string' || typeof action.legalActionId !== 'string' ||
      Object.keys(action).some(key => !['kind', 'decisionId', 'legalActionId'].includes(key))) throw new ServiceError('INVALID_ACTION');
    const fingerprint = JSON.stringify([action.decisionId, action.legalActionId]);
    const previous = this.receipts.find(row => row.seat === seat && row.actionId === actionId);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new ServiceError('ACTION_ID_CONFLICT', 409);
      return previous.ack;
    }
    const window = this.windows[seat];
    if (!window || window.decisionId !== action.decisionId) throw new ServiceError('AI_DECISION_STALE', 409);
    if (now >= window.deadlineAtMs) throw new ServiceError('AI_DECISION_EXPIRED', 409);
    const catalog = this.catalog(seat);
    if (!catalog || catalog.snapshotKey !== window.snapshotKey) throw new ServiceError('AI_DECISION_STALE', 409);
    const raw = catalog.rawByActionId.get(action.legalActionId);
    if (!raw) throw new ServiceError('AI_ACTION_NOT_LEGAL', 422);
    if(this.challenge&&this.metadata.seats[seat]?.kind==='ai'&&challengeAction(this,seat).action.legalActionId!==action.legalActionId)throw new ServiceError('CHALLENGE_POLICY_REQUIRED',422);
    const teaching=this.metadata.coach && seat===0 ? {
      passed:coachPassed(this.metadata.coach.lessonId,raw,id=>this.engine instanceof BloodEngine?this.engine.tileKeyForId(id):null),
      lesson:coachLesson(this.metadata.coach.lessonId)!,
    }:null;
    const result = this.engine.handleAction(`seat-${seat}`, raw, now);
    if (!result.ok) throw new ServiceError('AI_ENGINE_REJECTED', 422);
    if(this.challenge)recordChallengeAction(this,seat,catalog,action.legalActionId,false);
    this.recordResolution(seat, window, catalog, now, 'agent', action.legalActionId);
    delete this.windows[seat];
    if(teaching)this.metadata.coach={...this.metadata.coach!,status:teaching.passed?'passed':'retry',score:teaching.passed?100:0,feedback:teaching.passed?teaching.lesson.success:teaching.lesson.retry};
    this.progress(now);
    const ack = { type: 'ACTION_ACK', gameId: this.metadata.gameId, actionId, ok: true };
    this.receipts.push({ seat, actionId, fingerprint, ack });
    this.receipts = this.receipts.slice(-128);
    return ack;
  }
  submitHuman(seat: number, message: any, now: number): any {
    if (this.metadata.seats[seat]?.kind !== 'human') throw new ServiceError('FORBIDDEN', 403);
    const actionId = shortText(message.actionId, 120);
    const fingerprint = JSON.stringify([message.decisionId, message.action]);
    const previous = this.receipts.find(row => row.seat === seat && row.actionId === actionId);
    if (previous) {
      if (previous.humanFingerprint !== fingerprint) throw new ServiceError('ACTION_ID_CONFLICT', 409);
      return previous.ack;
    }
    if (this.engine instanceof GuobiaoEngine && message.action?.kind === 'setAutoBuhua') {
      if (Object.keys(message.action).length !== 2 || typeof message.action.enabled !== 'boolean') throw new ServiceError('INVALID_ACTION');
      const result = this.engine.handleAction(`seat-${seat}`, message.action, now);
      if (!result.ok) throw new ServiceError('AI_ACTION_NOT_LEGAL', 422);
      this.progress(now);
      const ack = {type:'ACTION_ACK',gameId:this.metadata.gameId,actionId,ok:true};
      this.receipts.push({seat,actionId,fingerprint,humanFingerprint:fingerprint,ack});
      this.receipts = this.receipts.slice(-128);
      return ack;
    }
    const window = this.windows[seat];
    if (!window || message.decisionId !== window.decisionId) throw new ServiceError('AI_DECISION_STALE', 409);
    if (now >= window.deadlineAtMs) throw new ServiceError('AI_DECISION_EXPIRED', 409);
    const catalog = this.catalog(seat);
    const action = message.action;
    const legal = catalog && [...catalog.rawByActionId].find(([, raw]) =>
      action && typeof action === 'object' && !Array.isArray(action) &&
      Object.keys(action).length === Object.keys(raw as object).length && sameAction(raw, action));
    if (!legal) throw new ServiceError('AI_ACTION_NOT_LEGAL', 422);
    const ack = this.submit(seat, { ...message, action: { kind: 'aiDecision', decisionId: window.decisionId, legalActionId: legal[0] } }, now);
    this.receipts.find(row => row.seat === seat && row.actionId === actionId)!.humanFingerprint = fingerprint;
    return ack;
  }

  alarm(now: number): void {
    if(this.metadata.coach && this.windows[0]?.deadlineAtMs<=now){
      this.metadata.coach={...this.metadata.coach,status:'retry',score:0,feedback:'本次练习超时，请查看提示后重新开始。'};this.windows={};return;
    }
    // Resolve at most one expensive Top1 calculation per invocation. Other expired
    // windows retain their original deadlines and are handled by the next alarm.
    const entry = Object.entries(this.windows).find(([, w]) => w.deadlineAtMs <= now);
    if (entry) {
      const seat = Number(entry[0]);
      const window = entry[1];
      const catalog = this.catalog(seat);
      if (catalog && catalog.snapshotKey === window.snapshotKey) {
        const raw = this.challenge ? catalog.rawByActionId.get(challengeAction(this,seat).action.legalActionId) : this.engine instanceof GuobiaoEngine ? guobiaoTop1(this.engine.listHandTilesForSeat(seat),this.state.players[seat].melds.filter((m:any)=>m.kind!=='flower').length,[...catalog.rawByActionId.values()])
          : new BloodTop1ActionPicker().pickAction({ game: this.game, engine: this.engine, state: this.state!, seat, scene: catalog.scene });
        const legal = [...catalog.rawByActionId].find(([, value]) => sameAction(value, raw));
        if (!legal) throw new ServiceError('FALLBACK_NOT_LEGAL', 500);
        const result = this.engine.handleAction(`seat-${seat}`, legal[1], now);
        if (!result.ok) throw new ServiceError('FALLBACK_REJECTED', 500);
        if(this.challenge)recordChallengeAction(this,seat,catalog,legal[0],true);
        this.recordResolution(seat, window, catalog, now, 'timeout_top1', legal[0]);
      }
      delete this.windows[seat];
    }
    this.progress(now);
  }
  private recordResolution(seat: number, window: Window, catalog: NonNullable<ReturnType<TableCore['catalog']>>, now: number, source: 'agent' | 'timeout_top1', legalActionId: string) {
    this.resolutions[window.decisionId] = source;
    const config = this.metadata.seats[seat]!;
    if (config.kind === 'human' && source === 'agent') return;
    const action = catalog.publicActions.find((a: any) => a.legalActionId === legalActionId)!;
    this.engine.recordAiDecisionResolution({ seat, decisionId: window.decisionId, scene: catalog.scene,
      modelId: config.modelId ?? 'human', modelLabel: config.modelLabel ?? '玩家',
      elapsedMs: now - window.openedAtMs, source, legalActionId,
      actionKind: action.kind, actionLabel: action.kind, privateActionLabel: JSON.stringify(action) });
  }
  nextAlarm(): number | null {
    const deadlines = Object.values(this.windows).map(w => w.deadlineAtMs);
    if (this.state?.swap3?.animatingSince != null) deadlines.push(this.state.swap3.animatingSince + 1200);
    if (this.state?.phase === 'settling' && this.state.settlingSince != null) deadlines.push(this.state.settlingSince + (this.metadata.ruleset === 'guobiao' ? 5000 : 16000));
    return deadlines.length ? Math.min(...deadlines) : null;
  }
  view(seat: number | null, full = false): { type: 'UPDATE'; full: true; entries: Entry[] } {
    if (full && this.ownerSeat !== null) throw new ServiceError('FORBIDDEN', 403);
    const entries = this.game.snapshotEntries().filter(([kind]) => ['match', 'blood', 'gb', 'things', 'seats', 'nicks', 'tileFacePublic'].includes(kind));
    if (this.engine instanceof GuobiaoEngine) {
      const row = entries.find(([kind]) => kind === 'gb'); if (row) row[2] = this.engine.viewState(seat);
    }
    for (const [kind, , value] of entries) {
      if (kind === 'match' && value) {
        // Present the service deadline through the original HUD configuration;
        // the extracted engine still delegates timeouts to TableCore.
        value.friendConfig = { waitMode: 'timeoutAuto', timeoutMs: this.challenge&&seat===this.challenge.seat?120000:this.metadata.timeoutMs };
        if(this.metadata.coach)value.coach={...this.metadata.coach,title:coachLesson(this.metadata.coach.lessonId)!.title,goal:coachLesson(this.metadata.coach.lessonId)!.goal};
        if(this.challenge)value.challenge=challengeSummary(this);
      }
      if (!['blood','gb'].includes(kind) || !value) continue;
      // Preserve the wall count for presentation without revealing future tile IDs.
      value.wallOrder = value.wallOrder.map(() => null);
      if (value.swap3) value.swap3.selections = Object.fromEntries([0, 1, 2, 3].map(s => [s, s === seat ? value.swap3.selections[s] : value.swap3.selections[s] === null ? null : []]));
      if (value.pending) {
        value.pending.options = seat === null ? {} : { [seat]: value.pending.options[seat] };
        value.pending.responses = seat === null ? {} : { [seat]: value.pending.responses[seat] };
      }
    }
    const wallIds = new Set(this.game.entries('things').filter(([,t]) => t.slotName?.startsWith('wall.')).map(([id]) => id));
    for (const row of entries) if (row[0] === 'tileFacePublic' && wallIds.has(row[1])) row[2] = null;
    const visibleSeats = full ? [0, 1, 2, 3] : seat === null ? [] : [seat];
    for (const visibleSeat of visibleSeats) entries.push(...this.engine.dshObserverTileFaceEntries(visibleSeat, false));
    return { type: 'UPDATE', full: true, entries };
  }
  checkpoint(): Checkpoint {
    return structuredClone({ version: 1, metadata: this.metadata, entries: this.game.snapshotEntries(), engine: this.engine.exportCheckpoint(), windows: this.windows, receipts: this.receipts,...(this.challenge?{challenge:this.challenge}:{}) });
  }
}
function sameAction(a: any, b: any): boolean {
  if (!b || a.kind !== b.kind) return false;
  return Object.keys(a).every(key => key === 'tileIds'
    ? Array.isArray(b[key]) && [...a[key]].sort().join(',') === [...b[key]].sort().join(',')
    : a[key] === b[key]);
}
