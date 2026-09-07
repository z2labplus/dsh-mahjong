import { createServiceSocketFactory } from "./service-network.js";
import { randomUUID } from "node:crypto";

import { createSeatAgentManager } from "./seat-agent-manager.js";


const DEFAULT_RECONNECT_BASE_MS = 250;
const DEFAULT_RECONNECT_MAX_MS = 10_000;
const SOCKET_DISPOSE_CODE = 1000;
const SOCKET_DISPOSE_REASON = "dsh-mahjong disposed";
const SAFE_ERROR_CODE = /^[A-Za-z0-9_.:-]{1,80}$/;

const SEAT_CONFIG_KEYS = new Set([
  "gameId",
  "seat",
  "seatCredential",
  "provider",
  "model",
  "modelLabel",
  "sessionId",
  "wsUrl",
  "reasoningEffort",
  "maxTokens",
]);

const RUNTIME_OPTION_KEYS = new Set([
  "ctx",
  "seats",
  "clock",
  "socketFactory",
  "seatAgentManagerFactory",
  "agentRuntime",
  "requestIdFactory",
  "reconnectBaseMs",
  "reconnectMaxMs",
  "onEvent",
  "onError",
]);

class SeatRuntimeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SeatRuntimeError";
    this.code = code;
  }
}

function fail(code, message) {
  return new SeatRuntimeError(code, message);
}

function assertPlainObject(value, field, code = "INVALID_CONFIG") {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw fail(code, `${field} must be an object`);
  }
  return value;
}

function assertKnownKeys(value, allowed, field) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw fail("INVALID_CONFIG", `${field} contains unknown field ${JSON.stringify(unknown[0])}`);
  }
}

function assertString(value, field, { maxLength } = {}) {
  if (typeof value !== "string" || value.trim() === "" || value !== value.trim()) {
    throw fail("INVALID_CONFIG", `${field} must be a non-empty trimmed string`);
  }
  if (maxLength !== undefined && value.length > maxLength) {
    throw fail("INVALID_CONFIG", `${field} exceeds ${maxLength} characters`);
  }
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw fail("INVALID_CONFIG", `${field} contains control characters`);
  }
  return value;
}

function assertPositiveNumber(value, field) {
  if (!Number.isFinite(value) || value <= 0) {
    throw fail("INVALID_CONFIG", `${field} must be a positive finite number`);
  }
  return value;
}

function isLoopbackHostname(hostname) {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host === "localhost.") return true;
  if (/^127(?:\.[0-9]{1,3}){3}$/.test(host)) return true;
  const unbracketed = host.startsWith("[") && host.endsWith("]")
    ? host.slice(1, -1)
    : host;
  return unbracketed === "::1" || /^(?:0{1,4}:){7}0{0,3}1$/.test(unbracketed);
}

function normalizeWsUrl(value) {
  const wsUrl = assertString(value, "seat.wsUrl", {
    maxLength: 2_048,
  });
  let parsed;
  try {
    parsed = new URL(wsUrl);
  } catch {
    throw fail("INVALID_CONFIG", "seat.wsUrl must be a valid WebSocket URL");
  }
  if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
    throw fail("INVALID_CONFIG", "seat.wsUrl must use ws: or wss:");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw fail("INVALID_CONFIG", "seat.wsUrl cannot contain credentials, a query, or a fragment");
  }
  if (parsed.protocol === "ws:" && !isLoopbackHostname(parsed.hostname)) {
    throw fail(
      "INVALID_CONFIG",
      "seat.wsUrl must use wss: when the game service server is not on loopback",
    );
  }
  return wsUrl;
}

function normalizeSeat(input) {
  const seat = assertPlainObject(input, "seat");
  assertKnownKeys(seat, SEAT_CONFIG_KEYS, "seat");
  const gameId = assertString(seat.gameId, "seat.gameId", { maxLength: 160 });
  if (!Number.isInteger(seat.seat) || seat.seat < 0 || seat.seat > 3) {
    throw fail("INVALID_CONFIG", "seat.seat must be an integer from 0 through 3");
  }
  const model = assertString(seat.model, "seat.model", { maxLength: 120 });
  const normalized = {
    gameId,
    seat: seat.seat,
    seatId: `${gameId}:${seat.seat}`,
    seatCredential: assertString(seat.seatCredential, "seat.seatCredential"),
    provider: assertString(seat.provider, "seat.provider", { maxLength: 120 }),
    model,
    modelLabel: assertString(seat.modelLabel ?? model, "seat.modelLabel", {
      maxLength: 80,
    }),
    sessionId: assertString(
      seat.sessionId ?? `dsh-mahjong:hidden-v1:${gameId}:seat-${seat.seat}`,
      "seat.sessionId",
      { maxLength: 300 },
    ),
    wsUrl: normalizeWsUrl(seat.wsUrl),
  };
  if (seat.reasoningEffort !== undefined) {
    normalized.reasoningEffort = assertString(
      seat.reasoningEffort,
      "seat.reasoningEffort",
      { maxLength: 80 },
    );
  }
  if (seat.maxTokens !== undefined) {
    if (!Number.isInteger(seat.maxTokens) || seat.maxTokens <= 0) {
      throw fail("INVALID_CONFIG", "seat.maxTokens must be a positive integer");
    }
    normalized.maxTokens = seat.maxTokens;
  }
  return Object.freeze(normalized);
}

function defaultClock() {
  return {
    now: () => Date.now(),
    setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
    clearTimeout: (timer) => globalThis.clearTimeout(timer),
  };
}

function normalizeClock(clock) {
  const resolved = clock ?? defaultClock();
  for (const method of ["now", "setTimeout", "clearTimeout"]) {
    if (typeof resolved[method] !== "function") {
      throw fail("INVALID_CONFIG", `clock.${method} must be a function`);
    }
  }
  return resolved;
}

async function defaultSocketFactory() {
  return createServiceSocketFactory();
}

function agentSeatConfig(seat) {
  return {
    seatId: seat.seatId,
    sessionId: seat.sessionId,
    provider: seat.provider,
    model: seat.model,
    ...(seat.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: seat.reasoningEffort }),
    ...(seat.maxTokens === undefined ? {} : { maxTokens: seat.maxTokens }),
  };
}

function safeErrorText(error) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "unknown error";
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function exactGameSeat(message, seat) {
  return message.gameId === seat.gameId && message.seat === seat.seat;
}

function normalizeIncomingDecision(value, seat) {
  const decision = assertPlainObject(value, "AI_DECISION.decision", "INVALID_MESSAGE");
  if (decision.gameId !== seat.gameId || decision.seat !== seat.seat) {
    throw fail("INVALID_MESSAGE", "AI decision game or seat does not match its socket");
  }
  if (typeof decision.decisionId !== "string" || decision.decisionId.trim() === "") {
    throw fail("INVALID_MESSAGE", "AI decision has no decisionId");
  }
  if (!Number.isFinite(decision.openedAtMs) || !Number.isFinite(decision.deadlineAtMs)) {
    throw fail("INVALID_MESSAGE", "AI decision timestamps must be finite");
  }
  if (decision.deadlineAtMs <= decision.openedAtMs) {
    throw fail("INVALID_MESSAGE", "AI decision deadline must follow its open time");
  }
  if (!Array.isArray(decision.legalActions) || decision.legalActions.length === 0) {
    throw fail("INVALID_MESSAGE", "AI decision has no legal actions");
  }
  const actionIds = decision.legalActions.map((action, index) => {
    if (
      action === null ||
      typeof action !== "object" ||
      Array.isArray(action) ||
      typeof action.legalActionId !== "string" ||
      action.legalActionId.trim() === ""
    ) {
      throw fail("INVALID_MESSAGE", `AI decision legalActions[${index}] is invalid`);
    }
    return action.legalActionId;
  });
  if (new Set(actionIds).size !== actionIds.length) {
    throw fail("INVALID_MESSAGE", "AI decision legalActionId values must be unique");
  }
  return {
    seatId: seat.seatId,
    decisionId: decision.decisionId,
    stateBlock: JSON.stringify(decision),
    actionIds,
    openedAtMs: decision.openedAtMs,
    deadlineAtMs: decision.deadlineAtMs,
  };
}

class SeatRuntime {
  #agentManager;
  #clock;
  #disposePromise;
  #disposed = false;
  #onError;
  #onEvent;
  #reconnectBaseMs;
  #reconnectMaxMs;
  #requestIdFactory;
  #seatAgentManagerFactory;
  #seats = new Map();
  #socketFactory;
  #usedRequestIds = new Set();

  static async create(options) {
    const input = assertPlainObject(options, "runtime options");
    assertKnownKeys(input, RUNTIME_OPTION_KEYS, "runtime options");
    if (!Array.isArray(input.seats) || input.seats.length === 0) {
      throw fail("INVALID_CONFIG", "seats must be a non-empty array");
    }
    const seats = input.seats.map(normalizeSeat);
    if (new Set(seats.map(({ seatId }) => seatId)).size !== seats.length) {
      throw fail("INVALID_CONFIG", "configured game/seat pairs must be unique");
    }
    if (new Set(seats.map(({ sessionId }) => sessionId)).size !== seats.length) {
      throw fail("INVALID_CONFIG", "seat.sessionId values must be unique");
    }
    const credentials = seats.map((seat) => seat.seatCredential);
    if (new Set(credentials).size !== seats.length) {
      throw fail("INVALID_CONFIG", "each configured AI seat requires a distinct credential");
    }
    if (
      input.seatAgentManagerFactory !== undefined &&
      typeof input.seatAgentManagerFactory !== "function"
    ) {
      throw fail("INVALID_CONFIG", "seatAgentManagerFactory must be a function");
    }
    if (input.socketFactory !== undefined && typeof input.socketFactory !== "function") {
      throw fail("INVALID_CONFIG", "socketFactory must be a function");
    }
    if (input.requestIdFactory !== undefined && typeof input.requestIdFactory !== "function") {
      throw fail("INVALID_CONFIG", "requestIdFactory must be a function");
    }
    const reconnectBaseMs = assertPositiveNumber(
      input.reconnectBaseMs ?? DEFAULT_RECONNECT_BASE_MS,
      "reconnectBaseMs",
    );
    const reconnectMaxMs = assertPositiveNumber(
      input.reconnectMaxMs ?? DEFAULT_RECONNECT_MAX_MS,
      "reconnectMaxMs",
    );
    if (reconnectMaxMs < reconnectBaseMs) {
      throw fail("INVALID_CONFIG", "reconnectMaxMs cannot be less than reconnectBaseMs");
    }

    const runtime = new SeatRuntime({
      clock: normalizeClock(input.clock),
      onError: input.onError,
      onEvent: input.onEvent,
      reconnectBaseMs,
      reconnectMaxMs,
      requestIdFactory: input.requestIdFactory ?? randomUUID,
      seatAgentManagerFactory: input.seatAgentManagerFactory ?? createSeatAgentManager,
      seats,
      socketFactory: input.socketFactory ?? (await defaultSocketFactory()),
    });
    await runtime.#initialize(input.ctx, input.agentRuntime);
    return runtime;
  }

  constructor({
    clock,
    onError,
    onEvent,
    reconnectBaseMs,
    reconnectMaxMs,
    requestIdFactory,
    seatAgentManagerFactory,
    seats,
    socketFactory,
  }) {
    this.#clock = clock;
    this.#onError = typeof onError === "function" ? onError : () => {};
    this.#onEvent = typeof onEvent === "function" ? onEvent : () => {};
    this.#reconnectBaseMs = reconnectBaseMs;
    this.#reconnectMaxMs = reconnectMaxMs;
    this.#requestIdFactory = requestIdFactory;
    this.#seatAgentManagerFactory = seatAgentManagerFactory;
    this.#socketFactory = socketFactory;
    for (const config of seats) {
      this.#seats.set(config.seatId, {
        config,
        socket: undefined,
        socketGeneration: 0,
        reconnectAttempt: 0,
        reconnectTimer: undefined,
        phase: "disconnected",
        playerId: undefined,
        dshJoinAcknowledged: false,
        resumeCredential: undefined,
        preBindDecision: undefined,
        pendingActions: new Map(),
        ackSettlingDecisions: new Set(),
        halted: false,
      });
    }
  }

  async #initialize(ctx, agentRuntime) {
    try {
      this.#agentManager = await this.#seatAgentManagerFactory({
        ctx,
        seats: [...this.#seats.values()].map(({ config }) => agentSeatConfig(config)),
        clock: this.#clock,
        ...(agentRuntime === undefined ? {} : { runtime: agentRuntime }),
        submitAction: (input) => this.#submitAction(input),
        onEvent: (event) => this.#emit(event),
        onError: (error) => this.#report(undefined, "AGENT_RUNTIME_ERROR", error),
      });
      for (const seat of this.#seats.values()) this.#connect(seat);
    } catch (error) {
      this.#disposed = true;
      if (this.#agentManager !== undefined) {
        await this.#agentManager.dispose().catch(() => {});
      }
      throw error;
    }
  }

  #redact(seat, value) {
    let text = safeErrorText(value);
    const tokens = new Set(
      [seat, ...this.#seats.values()]
        .flatMap((entry) => [
          entry?.config.seatCredential,
          entry?.resumeCredential,
        ])
        .filter((token) => typeof token === "string" && token !== ""),
    );
    for (const token of tokens) text = text.split(token).join("[redacted]");
    return text;
  }

  #emit(event) {
    try {
      this.#onEvent(Object.freeze(event));
    } catch (error) {
      this.#report(undefined, "EVENT_CALLBACK_FAILED", error);
    }
  }

  #report(seat, code, error) {
    const safeCode = this.#safeErrorCode(seat, code, "RUNTIME_ERROR");
    const safe = fail(safeCode, this.#redact(seat, error));
    try {
      this.#onError(safe, Object.freeze({
        seatId: seat?.config.seatId,
        phase: seat?.phase,
      }));
    } catch {
      // Diagnostics must not affect transport state or disclose credentials.
    }
  }

  #safeErrorCode(seat, value, fallback) {
    if (typeof value !== "string" || !SAFE_ERROR_CODE.test(value)) return fallback;
    return this.#redact(seat, value) === value ? value : fallback;
  }

  #validateSocket(socket) {
    if (
      socket === null ||
      typeof socket !== "object" ||
      typeof socket.on !== "function" ||
      typeof socket.send !== "function" ||
      typeof socket.close !== "function"
    ) {
      throw fail("SOCKET_INVALID", "socketFactory returned an invalid socket");
    }
  }

  #connect(seat) {
    if (this.#disposed || seat.halted || seat.socket !== undefined) return;
    if (seat.reconnectTimer !== undefined) {
      this.#clock.clearTimeout(seat.reconnectTimer);
      seat.reconnectTimer = undefined;
    }
    seat.phase = "connecting";
    let socket;
    try {
      socket = this.#socketFactory(seat.config.wsUrl);
      this.#validateSocket(socket);
    } catch (error) {
      this.#report(seat, "SOCKET_CONNECT_FAILED", error);
      this.#scheduleReconnect(seat);
      return;
    }

    seat.socket = socket;
    seat.socketGeneration += 1;
    socket.on("open", () => this.#onOpen(seat, socket));
    socket.on("message", (data) => this.#onMessage(seat, socket, data));
    socket.on("close", (code) => {
      if (this.#disposed || seat.socket !== socket) return;
      if (code === 4001) {
        this.#haltSeat(seat, "SEAT_REPLACED", "AI 座位已由另一连接接管，请在需要时重新连接牌局");
        return;
      }
      this.#retireSocket(seat, socket, false);
    });
    socket.on("error", (error) => {
      this.#report(seat, "SOCKET_ERROR", error);
      this.#retireSocket(seat, socket, true);
    });
    this.#emit({
      type: "connection-started",
      seatId: seat.config.seatId,
      attempt: seat.reconnectAttempt,
    });
  }

  #onOpen(seat, socket) {
    if (this.#disposed || seat.socket !== socket) return;
    seat.phase = "joining";
    seat.dshJoinAcknowledged = false;
    this.#send(seat, {
      type: "DSH_SEAT_JOIN",
      gameId: seat.config.gameId,
      seat: seat.config.seat,
      seatCredential: seat.resumeCredential ?? seat.config.seatCredential,
    });
  }

  #send(seat, message) {
    const socket = seat.socket;
    if (this.#disposed || socket === undefined) return false;
    try {
      socket.send(JSON.stringify(message));
      return true;
    } catch (error) {
      this.#report(seat, "SOCKET_SEND_FAILED", error);
      this.#retireSocket(seat, socket, true);
      return false;
    }
  }

  #onMessage(seat, socket, data) {
    if (this.#disposed || seat.socket !== socket) return;
    let message;
    try {
      const raw = typeof data === "string" ? data : data?.toString?.();
      message = JSON.parse(raw);
      assertPlainObject(message, "server message", "INVALID_MESSAGE");
    } catch (error) {
      this.#report(seat, "INVALID_MESSAGE", error);
      this.#retireSocket(seat, socket, true);
      return;
    }

    switch (message.type) {
      case "DSH_SEAT_JOINED":
        this.#onDshSeatJoined(seat, message);
        break;
      case "JOINED":
        this.#onJoined(seat, message);
        break;
      case "AI_SEAT_BIND_ACK":
        this.#onBindAck(seat, message);
        break;
      case "AI_DECISION":
        this.#onDecision(seat, message);
        break;
      case "AI_DECISION_CLOSED":
        this.#onDecisionClosed(seat, message);
        break;
      case "ACTION_ACK":
        this.#onActionAck(seat, message);
        break;
      case "ERROR":
        this.#haltSeat(seat, "SERVER_ERROR", message.error ?? "game service server error");
        break;
      default:
        break;
    }
  }

  #onJoined(seat, message) {
    if (seat.phase !== "joining" || message.gameId !== seat.config.gameId) return;
    if (typeof message.playerId !== "string" || message.playerId.trim() === "") {
      this.#haltSeat(seat, "JOIN_INVALID", "JOINED did not contain a playerId");
      return;
    }
    seat.playerId = message.playerId;
    if (!seat.dshJoinAcknowledged) return;
    this.#beginBinding(seat);
  }

  #onDshSeatJoined(seat, message) {
    if (seat.phase !== "joining" || !exactGameSeat(message, seat.config)) return;
    if (message.ok !== true || message.kind !== "ai") {
      this.#haltSeat(
        seat,
        this.#safeErrorCode(seat, message.errorCode, "DSH_SEAT_JOIN_REJECTED"),
        message.error ?? "game service rejected the DSH seat credential",
      );
      return;
    }
    if (
      typeof message.resumeCredential !== "string" ||
      message.resumeCredential.trim() === "" ||
      message.resumeCredential !== message.resumeCredential.trim()
    ) {
      this.#haltSeat(seat, "DSH_SEAT_JOIN_INVALID", "game service did not return a resume credential");
      return;
    }
    seat.resumeCredential = message.resumeCredential;
    seat.dshJoinAcknowledged = true;
    if (seat.playerId !== undefined) this.#beginBinding(seat);
  }

  #beginBinding(seat) {
    if (seat.phase !== "joining" || seat.playerId === undefined) return;
    seat.phase = "binding";
    this.#send(seat, {
      type: "AI_SEAT_BIND",
      gameId: seat.config.gameId,
      seat: seat.config.seat,
      modelId: seat.config.model,
      modelLabel: seat.config.modelLabel,
    });
  }

  #onBindAck(seat, message) {
    if (seat.phase !== "binding" || !exactGameSeat(message, seat.config)) return;
    if (message.ok !== true) {
      this.#haltSeat(
        seat,
        this.#safeErrorCode(seat, message.errorCode, "AI_SEAT_BIND_REJECTED"),
        message.error ?? "game service rejected the AI seat binding",
      );
      return;
    }
    seat.phase = "ready";
    seat.reconnectAttempt = 0;
    this.#emit({ type: "connection-ready", seatId: seat.config.seatId });
    const preBindDecision = seat.preBindDecision;
    seat.preBindDecision = undefined;
    if (preBindDecision !== undefined) this.#onDecision(seat, preBindDecision);
    for (const pending of seat.pendingActions.values()) {
      this.#sendPendingAction(seat, pending);
    }
    this.#send(seat, { type: "AI_DECISION_GET", gameId: seat.config.gameId });
  }

  #onDecision(seat, message) {
    if (!exactGameSeat(message, seat.config)) return;
    if (seat.phase === "binding") {
      seat.preBindDecision = message;
      return;
    }
    if (seat.phase !== "ready") return;
    if (message.decision === null) {
      const current = this.#agentManager.getDecision?.(seat.config.seatId);
      if (current !== undefined) {
        this.#agentManager.closeDecision({
          seatId: seat.config.seatId,
          decisionId: current.decisionId,
          reason: "unavailable",
        });
      }
      return;
    }
    let decision;
    try {
      decision = normalizeIncomingDecision(message.decision, seat.config);
    } catch (error) {
      this.#report(seat, "INVALID_DECISION", error);
      return;
    }
    void this.#agentManager.openDecision(decision).catch((error) => {
      this.#report(seat, error?.code ?? "AGENT_DECISION_FAILED", error);
    });
  }

  #pendingForDecision(seat, decisionId) {
    for (const pending of seat.pendingActions.values()) {
      if (pending.decisionId === decisionId) return pending;
    }
    return undefined;
  }

  #closeAgentDecision(seat, message) {
    this.#agentManager.closeDecision({
      seatId: seat.config.seatId,
      decisionId: message.decisionId,
      reason: message.source === "timeout_top1" ? "timeout" : message.reason,
    });
  }

  #onDecisionClosed(seat, message) {
    if (!exactGameSeat(message, seat.config) || typeof message.decisionId !== "string") return;
    if (seat.preBindDecision?.decision?.decisionId === message.decisionId) {
      seat.preBindDecision = undefined;
    }
    const pending = this.#pendingForDecision(seat, message.decisionId);
    if (message.source === "agent" && pending !== undefined) {
      pending.deferredClose = message;
      return;
    }
    if (message.source === "agent" && seat.ackSettlingDecisions.has(message.decisionId)) {
      queueMicrotask(() => {
        if (!this.#disposed) this.#closeAgentDecision(seat, message);
      });
      return;
    }
    this.#closeAgentDecision(seat, message);
  }

  #onActionAck(seat, message) {
    if (message.gameId !== seat.config.gameId || typeof message.actionId !== "string") return;
    const pending = seat.pendingActions.get(message.actionId);
    if (pending === undefined) return;
    const deferredClose = pending.deferredClose;
    seat.ackSettlingDecisions.add(pending.decisionId);
    if (message.ok === true) {
      this.#settlePending(seat, pending, undefined);
    } else {
      this.#settlePending(
        seat,
        pending,
        fail(
          "ACTION_REJECTED",
          this.#redact(
            seat,
            `${message.errorCode ?? "ACTION_REJECTED"}: ${message.error ?? "game service rejected the action"}`,
          ),
        ),
      );
    }
    queueMicrotask(() => seat.ackSettlingDecisions.delete(pending.decisionId));
    if (deferredClose !== undefined) {
      queueMicrotask(() => {
        if (!this.#disposed) this.#closeAgentDecision(seat, deferredClose);
      });
    }
  }

  #retireSocket(seat, socket, closeSocket) {
    if (seat.socket !== socket) return;
    seat.socket = undefined;
    seat.playerId = undefined;
    seat.dshJoinAcknowledged = false;
    seat.preBindDecision = undefined;
    seat.phase = this.#disposed ? "disposed" : "disconnected";
    if (closeSocket) {
      try {
        socket.close();
      } catch {
        // The local generation is already retired.
      }
    }
    if (!this.#disposed && !seat.halted) this.#scheduleReconnect(seat);
  }

  #scheduleReconnect(seat) {
    if (this.#disposed || seat.halted || seat.reconnectTimer !== undefined) return;
    const delayMs = Math.min(
      this.#reconnectMaxMs,
      this.#reconnectBaseMs * (2 ** seat.reconnectAttempt),
    );
    seat.reconnectAttempt += 1;
    seat.reconnectTimer = this.#clock.setTimeout(() => {
      seat.reconnectTimer = undefined;
      this.#connect(seat);
    }, delayMs);
    this.#emit({
      type: "reconnect-scheduled",
      seatId: seat.config.seatId,
      delayMs,
    });
  }

  #haltSeat(seat, code, error) {
    const safeCode = this.#safeErrorCode(seat, code, "SEAT_FAILED");
    seat.halted = true;
    const current = this.#agentManager.getDecision?.(seat.config.seatId);
    if (current?.decisionId) {
      this.#agentManager.closeDecision({seatId: seat.config.seatId, decisionId: current.decisionId, reason: "connection-halted"});
    }
    const socket = seat.socket;
    if (socket !== undefined) this.#retireSocket(seat, socket, true);
    seat.phase = "failed";
    this.#emit({ type: "connection-halted", seatId: seat.config.seatId });
    this.#report(seat, safeCode, error);
    const failure = fail(safeCode, this.#redact(seat, error));
    for (const pending of [...seat.pendingActions.values()]) {
      this.#settlePending(seat, pending, failure);
    }
  }

  #nextRequestId() {
    const requestId = this.#requestIdFactory();
    if (
      typeof requestId !== "string" ||
      requestId.trim() === "" ||
      requestId !== requestId.trim() ||
      /[\u0000-\u001f\u007f]/.test(requestId)
    ) {
      throw fail("REQUEST_ID_INVALID", "requestIdFactory must return a trimmed non-empty string");
    }
    if (this.#usedRequestIds.has(requestId)) {
      throw fail("REQUEST_ID_COLLISION", "requestIdFactory returned a duplicate id");
    }
    this.#usedRequestIds.add(requestId);
    return requestId;
  }

  #sendPendingAction(seat, pending) {
    if (seat.phase !== "ready" || seat.socket === undefined) return;
    if (pending.sentGeneration === seat.socketGeneration) return;
    if (this.#send(seat, pending.message)) {
      pending.sentGeneration = seat.socketGeneration;
    }
  }

  #settlePending(seat, pending, error) {
    if (seat.pendingActions.get(pending.requestId) !== pending) return;
    seat.pendingActions.delete(pending.requestId);
    pending.signal?.removeEventListener?.("abort", pending.onAbort);
    if (error === undefined) pending.result.resolve();
    else pending.result.reject(error);
  }

  #submitAction({ seatId, decisionId, actionId, signal }) {
    if (this.#disposed) throw fail("RUNTIME_DISPOSED", "the game service seat runtime is disposed");
    const seat = this.#seats.get(seatId);
    if (seat === undefined) throw fail("UNKNOWN_SEAT", "the AI seat is not configured");
    if (seat.halted) throw fail("SEAT_HALTED", "the AI seat connection is halted");
    if (signal?.aborted) throw fail("ACTION_ABORTED", "the AI action was aborted");
    const requestId = this.#nextRequestId();
    const result = createDeferred();
    const pending = {
      requestId,
      decisionId,
      signal,
      result,
      sentGeneration: undefined,
      deferredClose: undefined,
      message: {
        type: "ACTION",
        gameId: seat.config.gameId,
        actionId: requestId,
        action: {
          kind: "aiDecision",
          decisionId,
          legalActionId: actionId,
        },
      },
      onAbort: undefined,
    };
    pending.onAbort = () => {
      this.#settlePending(
        seat,
        pending,
        fail("ACTION_ABORTED", "the AI action was aborted"),
      );
    };
    signal?.addEventListener?.("abort", pending.onAbort, { once: true });
    seat.pendingActions.set(requestId, pending);
    this.#sendPendingAction(seat, pending);
    return result.promise;
  }

  dispose() {
    if (this.#disposePromise !== undefined) return this.#disposePromise;
    this.#disposed = true;
    for (const seat of this.#seats.values()) {
      if (seat.reconnectTimer !== undefined) {
        this.#clock.clearTimeout(seat.reconnectTimer);
        seat.reconnectTimer = undefined;
      }
      const socket = seat.socket;
      seat.socket = undefined;
      seat.phase = "disposed";
      if (socket !== undefined) {
        try {
          socket.close(SOCKET_DISPOSE_CODE, SOCKET_DISPOSE_REASON);
        } catch {
          // The runtime still owns and retires its local state.
        }
      }
      const error = fail("RUNTIME_DISPOSED", "the game service seat runtime is disposed");
      for (const pending of [...seat.pendingActions.values()]) {
        this.#settlePending(seat, pending, error);
      }
    }
    this.#disposePromise = Promise.resolve(this.#agentManager?.dispose()).then(() => undefined);
    return this.#disposePromise;
  }
}

export function createSeatRuntime(options) {
  return SeatRuntime.create(options);
}

export { SeatRuntimeError };
