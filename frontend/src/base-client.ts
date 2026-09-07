/* eslint no-console: 0 */

import { EventEmitter } from 'events';

import { Message, Entry, type FriendConfig, type FriendRoomGameType, type GuobiaoConfig } from '../server/protocol';
import { getOrCreatePlayerId, storePlayerId } from './player-id';

export interface Game {
  gameId: string;
  playerId: string;
  authoritative: boolean;
}

type ActionDiagnostic = {
  actionId: string;
  actionKind: string;
  sentAt: number;
  interactionAt?: number;
  firstUpdateAt?: number;
  stateAppliedAt?: number;
  renderedAt?: number;
  ackAt?: number;
  ackOk?: boolean;
};

const ACTION_DIAGNOSTIC_TIMEOUT_MS = 30_000;
const ACTION_ACK_TIMEOUT_MS = 12_000;
const HEARTBEAT_INTERVAL_MS = 10_000;
const HEARTBEAT_TIMEOUT_MS = 30_000;

export type ConnectionState = 'disconnected' | 'connecting' | 'synchronizing' | 'recovering' | 'ready' | 'replaced';

type ReliableAction = {
  message: Extract<Message, { type: 'ACTION' }>;
  lastSentAt: number;
  ackTimer: number | null;
};

function diagnosticNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function diagnosticsEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const query = new URLSearchParams(window.location.search).get('wsdiag');
    if (query === '1') return true;
    if (query === '0') return false;
    return window.localStorage.getItem('mjlab.wsDiagnostics') === '1';
  } catch {
    return false;
  }
}

function utf8Bytes(value: string): number {
  try {
    return new TextEncoder().encode(value).byteLength;
  } catch {
    return value.length;
  }
}

function roundedMs(value: number | undefined): number | undefined {
  return value === undefined ? undefined : Math.round(value * 100) / 100;
}

function logDiagnostic(event: string, fields: Record<string, unknown>): void {
  if (!diagnosticsEnabled()) return;
  console.info(`[wsdiag] ${JSON.stringify({ scope: 'client', event, at: Date.now(), ...fields })}`);
}

export class BaseClient {
  private ws: WebSocket | null = null;
  private game: Game | null = null;
  private events: EventEmitter = new EventEmitter();
  private pending: Array<Entry> | null = null;
  private localPlayerId: string;
  private connectedAt: number | null = null;
  private actionDiagnostics: Map<string, ActionDiagnostic> = new Map();
  private connectionStateValue: ConnectionState = 'disconnected';
  private reliableActions: Map<string, ReliableAction> = new Map();
  private awaitingFullSync: boolean = false;
  private decisionId: string | null = null;
  private heartbeatTimer: number | null = null;
  private heartbeatNonce: string | null = null;
  private heartbeatSentAt: number = 0;
  private heartbeatSeq: number = 0;

  constructor() {
    this.events.setMaxListeners(50);
    this.localPlayerId = getOrCreatePlayerId();
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') this.checkConnectionHealth();
      });
    }
  }

  joinDshHuman(url: string, gameId: string, seat: number, humanInviteTicket: string): void {
    this.clearReliableActionsForOtherGame(gameId);
    this.connect(url, () => {
      this.send({
        type: 'DSH_SEAT_JOIN',
        gameId,
        seat,
        humanInviteTicket,
      });
    });
  }

  spectateDsh(url: string, gameId: string, spectatorEmbedTicket: string): void {
    this.clearReliableActionsForOtherGame(gameId);
    this.connect(url, () => {
      this.send({ type: 'DSH_SPECTATE', gameId, spectatorEmbedTicket });
    });
  }

  disconnect(): void {
    this.ws?.close();
  }

  private connect(url: string, start: () => void): void {
    if (this.ws || this.connectionStateValue === 'replaced') {
      return;
    }
    this.setConnectionState('connecting');
    const socket = new WebSocket(url);
    this.ws = socket;
    const connectingAt = diagnosticNow();
    socket.onopen = () => {
      if (this.ws !== socket) return;
      this.connectedAt = diagnosticNow();
      logDiagnostic('connection.open', {
        connectMs: roundedMs(this.connectedAt - connectingAt),
        extensions: socket.extensions || 'none',
      });
      this.startHeartbeat();
      start();
    };
    socket.onclose = event => {
      if (this.ws !== socket) return;
      this.ws = null;
      this.finishClose(event);
    };
    socket.onerror = () => {
      if (this.ws !== socket) return;
      logDiagnostic('connection.error', {});
    };

    socket.onmessage = event => {
      if (this.ws !== socket) return;
      const receivedAt = diagnosticNow();
      const raw = event.data as string;
      const message = JSON.parse(raw) as Message;
      const messageFields: Record<string, unknown> = {
        messageType: message.type,
        bytes: utf8Bytes(raw),
      };
      if (message.type === 'UPDATE') {
        messageFields.entryCount = message.entries.length;
        messageFields.full = message.full;
        const collectionCounts: Record<string, number> = {};
        for (const [kind] of message.entries) {
          collectionCounts[kind] = (collectionCounts[kind] ?? 0) + 1;
        }
        messageFields.collections = collectionCounts;
        const candidate = Array.from(this.actionDiagnostics.values()).find(item => item.firstUpdateAt === undefined);
        if (candidate) {
          candidate.firstUpdateAt = receivedAt;
          messageFields.candidateActionId = candidate.actionId;
          messageFields.sendToFirstUpdateMs = roundedMs(receivedAt - candidate.sentAt);
        }
      } else if (message.type === 'ACTION_ACK') {
        messageFields.actionId = message.actionId;
        messageFields.ok = message.ok;
      }
      logDiagnostic('message.receive', messageFields);
      // console.log('recv', message);
      this.onMessage(message);
    };
  }

  on(what: 'connect', handler: (game: Game, isFirst: boolean) => void): void;
  on(what: 'disconnect', handler: (game: Game | null) => void): void;
  on(what: 'connectionState', handler: (state: ConnectionState) => void): void;
  on(what: 'update', handler: (things: Array<Entry>, full: boolean) => void): void;
  on(what: 'serverError', handler: (error: string) => void): void;
  on(what: 'actionAck', handler: (ack: Extract<Message, { type: 'ACTION_ACK' }>) => void): void;
  on(what: 'friendConfigSetAck', handler: (msg: Extract<Message, { type: 'FRIEND_CONFIG_SET_ACK' }>) => void): void;
  on(what: 'bloodConfigSetAck', handler: (msg: Extract<Message, { type: 'BLOOD_CONFIG_SET_ACK' }>) => void): void;
  on(what: 'guobiaoConfigSetAck', handler: (msg: Extract<Message, { type: 'GUOBIAO_CONFIG_SET_ACK' }>) => void): void;
  on(what: 'aiTemplates', handler: (msg: Extract<Message, { type: 'AI_TEMPLATES' }>) => void): void;
  on(what: 'aiTemplateSaved', handler: (msg: Extract<Message, { type: 'AI_TEMPLATE_SAVED' }>) => void): void;
  on(what: 'aiTemplateDeleted', handler: (msg: Extract<Message, { type: 'AI_TEMPLATE_DELETED' }>) => void): void;
  on(what: 'aiTemplateDefaultSet', handler: (msg: Extract<Message, { type: 'AI_TEMPLATE_DEFAULT_SET' }>) => void): void;
  on(what: 'aiHistory', handler: (msg: Extract<Message, { type: 'AI_HISTORY' }>) => void): void;
  on(what: 'aiPreview', handler: (msg: Extract<Message, { type: 'AI_PREVIEW' }>) => void): void;
  on(what: 'aiDelta', handler: (msg: Extract<Message, { type: 'AI_DELTA' }>) => void): void;
  on(what: 'aiResult', handler: (msg: Extract<Message, { type: 'AI_RESULT' }>) => void): void;
  on(what: 'aiError', handler: (msg: Extract<Message, { type: 'AI_ERROR' }>) => void): void;
  on(what: 'dshSeatJoined', handler: (msg: Extract<Message, { type: 'DSH_SEAT_JOINED' }>) => void): void;
  on(what: 'dshSpectating', handler: (msg: Extract<Message, { type: 'DSH_SPECTATING' }>) => void): void;

  on(what: string, handler: (...args: any[]) => void): void {
    this.events.on(what, handler);
  }

  transaction(func: () => void): void {
    this.pending = [];
    try {
      func();
      if (this.pending !== null && this.pending.length > 0) {
        const filtered = this.filterOutgoingEntries(this.pending);
        if (filtered.length > 0) {
          this.send({ type: 'UPDATE', entries: filtered, full: false });
        }
      }
    } finally {
      this.pending = null;
    }
  }

  update(entries: Array<Entry>): void {
    const filtered = this.filterOutgoingEntries(entries);
    if (filtered.length === 0) {
      return;
    }
    if (this.pending !== null) {
      this.pending.push(...filtered);
    } else {
      this.send({ type: 'UPDATE', entries: filtered, full: false });
    }
  }

  protected send(message: Message): void {
    // The standalone service owns every collection; presentation updates stay local.
    if (message.type === 'UPDATE') return;
    if (message.type === 'ACTION') {
      Object.assign(message, { decisionId: this.decisionId });
      const actionId = String(message.actionId ?? '').trim();
      if (actionId && !this.reliableActions.has(actionId)) {
        this.reliableActions.set(actionId, { message, lastSentAt: 0, ackTimer: null });
      }
    }
    if (!this.open()) {
      return;
    }
    this.sendNow(message);
  }

  private sendNow(message: Message): void {
    const socket = this.ws;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    const data = JSON.stringify(message);
    if (message.type === 'ACTION') {
      this.trackActionSend(message, data);
    }
    try {
      socket.send(data);
    } catch {
      if (message.type === 'ACTION') this.invalidateConnection('action_send_failed');
    }
  }

  private trackActionSend(message: Extract<Message, { type: 'ACTION' }>, data: string): void {
    const actionId = String(message.actionId ?? '').trim();
    if (!actionId) return;
    const reliable = this.reliableActions.get(actionId);
    if (reliable) {
      if (reliable.ackTimer !== null) window.clearTimeout(reliable.ackTimer);
      reliable.lastSentAt = Date.now();
      reliable.ackTimer = window.setTimeout(() => {
        const current = this.reliableActions.get(actionId);
        if (!current || current.lastSentAt !== reliable.lastSentAt) return;
        logDiagnostic('action.ack-timeout', {
          actionId,
          actionKind: String((message.action as any)?.kind ?? 'unknown'),
          elapsedMs: Date.now() - current.lastSentAt,
        });
        if (this.pageVisible()) this.invalidateConnection('action_ack_timeout');
      }, ACTION_ACK_TIMEOUT_MS);
    }

    if (!diagnosticsEnabled()) return;
    const sentAt = diagnosticNow();
    const actionKind = String((message.action as any)?.kind ?? 'unknown');
    this.actionDiagnostics.set(actionId, { actionId, actionKind, sentAt });
    window.setTimeout(() => {
      const item = this.actionDiagnostics.get(actionId);
      if (!item) return;
      logDiagnostic('action.timeout', {
        actionId,
        actionKind: item.actionKind,
        elapsedMs: roundedMs(diagnosticNow() - item.sentAt),
        ackReceived: item.ackAt !== undefined,
        stateApplied: item.stateAppliedAt !== undefined,
        rendered: item.renderedAt !== undefined,
      });
      this.actionDiagnostics.delete(actionId);
    }, ACTION_DIAGNOSTIC_TIMEOUT_MS);
    logDiagnostic('action.send', {
      actionId,
      actionKind,
      bytes: utf8Bytes(data),
      bufferedAmount: this.ws?.bufferedAmount ?? 0,
    });
  }

  markActionInteraction(actionId: string, interactionAt: number): void {
    const item = this.actionDiagnostics.get(actionId);
    if (!item || !Number.isFinite(interactionAt)) return;
    item.interactionAt = interactionAt;
    logDiagnostic('action.interaction', {
      actionId,
      actionKind: item.actionKind,
      interactionToSendMs: roundedMs(item.sentAt - interactionAt),
    });
  }

  markActionStateApplied(actionId: string, source: string): void {
    const item = this.actionDiagnostics.get(actionId);
    if (!item || item.stateAppliedAt !== undefined) return;
    item.stateAppliedAt = diagnosticNow();
    logDiagnostic('action.state-applied', {
      actionId,
      actionKind: item.actionKind,
      source,
      sendToStateAppliedMs: roundedMs(item.stateAppliedAt - item.sentAt),
      receiveToStateAppliedMs:
        item.firstUpdateAt === undefined ? undefined : roundedMs(item.stateAppliedAt - item.firstUpdateAt),
    });
  }

  markActionRendered(actionId: string): void {
    const item = this.actionDiagnostics.get(actionId);
    if (!item || item.renderedAt !== undefined) return;
    item.renderedAt = diagnosticNow();
    logDiagnostic('action.rendered', {
      actionId,
      actionKind: item.actionKind,
      interactionToSendMs:
        item.interactionAt === undefined ? undefined : roundedMs(item.sentAt - item.interactionAt),
      sendToFirstUpdateMs:
        item.firstUpdateAt === undefined ? undefined : roundedMs(item.firstUpdateAt - item.sentAt),
      sendToStateAppliedMs:
        item.stateAppliedAt === undefined ? undefined : roundedMs(item.stateAppliedAt - item.sentAt),
      stateAppliedToRenderMs:
        item.stateAppliedAt === undefined ? undefined : roundedMs(item.renderedAt - item.stateAppliedAt),
      sendToAckMs: item.ackAt === undefined ? undefined : roundedMs(item.ackAt - item.sentAt),
      sendToRenderMs: roundedMs(item.renderedAt - item.sentAt),
      interactionToRenderMs:
        item.interactionAt === undefined ? undefined : roundedMs(item.renderedAt - item.interactionAt),
      ackOk: item.ackOk,
    });
    if (item.ackAt !== undefined) {
      this.actionDiagnostics.delete(actionId);
    }
  }

  private open(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  connected(): boolean {
    return this.open() && this.game !== null;
  }

  connectionState(): ConnectionState {
    return this.connectionStateValue;
  }

  actionsReady(): boolean {
    return this.connected() && this.connectionStateValue === 'ready';
  }

  playerId(): string {
    return this.game?.playerId ?? this.localPlayerId;
  }

  gameId(): string | null {
    return this.game?.gameId ?? null;
  }

  isAuthoritative(): boolean {
    return this.game?.authoritative ?? false;
  }

  setLocalGame(game: Game | null): void {
    this.game = game;
    this.awaitingFullSync = false;
    this.setConnectionState(game ? 'ready' : 'disconnected');
  }

  applyLocalSnapshot(entries: Entry[]): void {
    if (this.ws) throw new Error('Local replay cannot replace a connected game');
    this.events.emit('update', entries, true);
  }

  private setConnectionState(state: ConnectionState): void {
    if (this.connectionStateValue === state) return;
    this.connectionStateValue = state;
    this.events.emit('connectionState', state);
  }

  private filterOutgoingEntries(entries: Array<Entry>): Array<Entry> {
    if (!this.isAuthoritative()) {
      return entries;
    }
    // In authoritative mode, the server is the only source of truth for these
    // collections. Clients must use ACTION instead.
    const forbidden = new Set<string>(['match', 'things', 'blood', 'bloodAction', 'gb', 'gbAction']);
    return entries.filter(([kind]) => !forbidden.has(kind));
  }

  private finishClose(event?: CloseEvent, reason?: string): void {
    const now = diagnosticNow();
    this.stopHeartbeat();
    for (const pending of this.reliableActions.values()) {
      if (pending.ackTimer !== null) window.clearTimeout(pending.ackTimer);
      pending.ackTimer = null;
    }
    logDiagnostic('connection.close', {
      code: event?.code,
      clean: event?.wasClean,
      reason: reason ?? event?.reason,
      connectedMs: this.connectedAt === null ? undefined : roundedMs(now - this.connectedAt),
      pendingActionCount: this.reliableActions.size,
    });
    this.connectedAt = null;
    this.awaitingFullSync = false;
    const game = this.game;
    this.game = null;
    if (event?.code === 4001) {
      // A newer page owns this seat. Automatic retries would evict it again;
      // discard pending actions and require an explicit page reload to take over.
      this.clearReliableActions();
      this.setConnectionState('replaced');
    } else this.setConnectionState('disconnected');
    this.events.emit('disconnect', game);
  }

  private pageVisible(): boolean {
    return typeof document === 'undefined' || document.visibilityState === 'visible';
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = window.setInterval(() => this.checkConnectionHealth(), HEARTBEAT_INTERVAL_MS);
    this.checkConnectionHealth();
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) window.clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.heartbeatNonce = null;
    this.heartbeatSentAt = 0;
  }

  private checkConnectionHealth(): void {
    if (!this.open() || !this.pageVisible()) return;
    const now = Date.now();
    const oldestAction = Array.from(this.reliableActions.values())
      .filter(item => item.lastSentAt > 0)
      .sort((a, b) => a.lastSentAt - b.lastSentAt)[0];
    if (oldestAction && now - oldestAction.lastSentAt >= ACTION_ACK_TIMEOUT_MS) {
      this.invalidateConnection('action_ack_timeout');
      return;
    }
    if (this.heartbeatNonce && now - this.heartbeatSentAt >= HEARTBEAT_TIMEOUT_MS) {
      this.invalidateConnection('heartbeat_timeout');
      return;
    }
    if (this.heartbeatNonce) return;
    this.heartbeatSeq += 1;
    this.heartbeatNonce = `h-${now}-${this.heartbeatSeq}`;
    this.heartbeatSentAt = now;
    this.sendNow({ type: 'HEARTBEAT', nonce: this.heartbeatNonce });
  }

  private invalidateConnection(reason: string): void {
    const socket = this.ws;
    if (!socket) return;
    this.ws = null;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    try {
      socket.close(4000, reason.slice(0, 120));
    } catch {
      // The local connection state is still retired below.
    }
    this.finishClose(undefined, reason);
  }

  private resendReliableActions(): void {
    const gameId = this.game?.gameId ?? null;
    if (!gameId) return;
    const pending = Array.from(this.reliableActions.values())
      .filter(item => item.message.gameId === gameId)
      .sort((a, b) => a.lastSentAt - b.lastSentAt);
    if (pending.length === 0) {
      this.setConnectionState('ready');
      return;
    }
    this.setConnectionState('recovering');
    for (const item of pending) this.sendNow(item.message);
  }

  private forgetReliableAction(actionId: string): void {
    const item = this.reliableActions.get(actionId);
    if (item && item.ackTimer !== null) window.clearTimeout(item.ackTimer);
    this.reliableActions.delete(actionId);
  }

  private clearReliableActions(): void {
    for (const actionId of Array.from(this.reliableActions.keys())) this.forgetReliableAction(actionId);
  }

  private clearReliableActionsForOtherGame(gameId: string): void {
    for (const [actionId, pending] of Array.from(this.reliableActions.entries())) {
      if (pending.message.gameId !== gameId) this.forgetReliableAction(actionId);
    }
  }

  private onMessage(message: Message): void {
    switch (message.type) {
      case 'AI_DECISION':
        this.decisionId = (message as any).decision?.decisionId ?? null;
        break;
      case 'AI_DECISION_CLOSED':
        if ((message as any).decisionId === this.decisionId) this.decisionId = null;
        break;
      case 'JOINED':
        this.localPlayerId = message.playerId;
        storePlayerId(message.playerId);
        this.game = {
          gameId: message.gameId,
          playerId: message.playerId,
          authoritative: !!message.authoritative,
        };
        this.events.emit('connect', this.game, message.isFirst);
        this.awaitingFullSync = true;
        this.setConnectionState('synchronizing');
        break;

      case 'UPDATE':
        this.events.emit('update', message.entries, message.full);
        if (message.full && this.awaitingFullSync) {
          this.awaitingFullSync = false;
          this.resendReliableActions();
        }
        break;

      case 'HEARTBEAT_ACK':
        if (message.nonce === this.heartbeatNonce) {
          this.heartbeatNonce = null;
          this.heartbeatSentAt = 0;
        }
        break;

      case 'ERROR':
        this.events.emit('serverError', message.error);
        break;

      case 'ACTION_ACK':
        {
          this.forgetReliableAction(message.actionId);
          const item = this.actionDiagnostics.get(message.actionId);
          if (item) {
            item.ackAt = diagnosticNow();
            item.ackOk = message.ok;
            logDiagnostic('action.ack', {
              actionId: message.actionId,
              actionKind: item.actionKind,
              ok: message.ok,
              sendToAckMs: roundedMs(item.ackAt - item.sentAt),
            });
            if (!message.ok || item.renderedAt !== undefined) {
              this.actionDiagnostics.delete(message.actionId);
            }
          }
        }
        this.events.emit('actionAck', message);
        if (this.connectionStateValue === 'recovering' && this.reliableActions.size === 0) {
          this.setConnectionState('ready');
        }
        break;

      case 'FRIEND_CONFIG_SET_ACK':
        this.events.emit('friendConfigSetAck', message);
        break;

      case 'BLOOD_CONFIG_SET_ACK':
        this.events.emit('bloodConfigSetAck', message);
        break;

      case 'GUOBIAO_CONFIG_SET_ACK':
        this.events.emit('guobiaoConfigSetAck', message);
        break;

      case 'AI_TEMPLATES':
        this.events.emit('aiTemplates', message);
        break;

      case 'AI_TEMPLATE_SAVED':
        this.events.emit('aiTemplateSaved', message);
        break;

      case 'AI_TEMPLATE_DELETED':
        this.events.emit('aiTemplateDeleted', message);
        break;

      case 'AI_TEMPLATE_DEFAULT_SET':
        this.events.emit('aiTemplateDefaultSet', message);
        break;

      case 'AI_HISTORY':
        this.events.emit('aiHistory', message);
        break;

      case 'AI_PREVIEW':
        this.events.emit('aiPreview', message);
        break;

      case 'AI_DELTA':
        this.events.emit('aiDelta', message);
        break;

      case 'AI_RESULT':
        this.events.emit('aiResult', message);
        break;

      case 'AI_ERROR':
        this.events.emit('aiError', message);
        break;

      case 'DSH_SEAT_JOINED':
        this.events.emit('dshSeatJoined', message);
        break;

      case 'DSH_SPECTATING':
        this.events.emit('dshSpectating', message);
        break;
    }
  }
}
