import { createServiceSocketFactory } from "./service-network.js";

const SAFE_CODE = /^[A-Za-z0-9_.:-]{1,80}$/;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const MAX_PENDING_SNAPSHOT_MESSAGES = 128;

export class ServiceSpectatorError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ServiceSpectatorError";
    this.code = code;
  }
}

function fail(code, message) {
  return new ServiceSpectatorError(code, message);
}

function safeCode(value, fallback, secrets = []) {
  if (typeof value !== "string" || !SAFE_CODE.test(value)) return fallback;
  return secrets.some((secret) => typeof secret === "string" && secret && value.includes(secret))
    ? fallback
    : value;
}

function redact(value, secrets) {
  let text = value instanceof Error ? value.message : String(value ?? "unknown error");
  for (const secret of secrets) {
    if (typeof secret === "string" && secret) text = text.split(secret).join("[redacted]");
  }
  return text;
}

function loopback(hostname) {
  const host = hostname.toLowerCase();
  return host === "localhost" || host === "localhost." || /^127(?:\.[0-9]{1,3}){3}$/.test(host) || host === "[::1]" || host === "::1";
}

export function normalizeServiceWsUrl(value) {
  if (typeof value !== "string" || value.trim() !== value || !value) {
    throw fail("INVALID_CONFIG", "service.wsUrl must be a trimmed WebSocket URL");
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw fail("INVALID_CONFIG", "service.wsUrl must be a valid WebSocket URL");
  }
  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw fail("INVALID_CONFIG", "service.wsUrl must use ws: or wss:");
  }
  if (url.protocol === "ws:" && !loopback(url.hostname)) {
    throw fail("INVALID_CONFIG", "non-loopback game service endpoints must use wss:");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw fail("INVALID_CONFIG", "service.wsUrl cannot contain credentials, a query, or a fragment");
  }
  return value;
}

async function defaultSocketFactory() {
  return createServiceSocketFactory();
}

function assertSocket(socket) {
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

function parseMessage(data) {
  const raw = typeof data === "string" ? data : data?.toString?.();
  const message = JSON.parse(raw);
  if (message === null || typeof message !== "object" || Array.isArray(message)) {
    throw new TypeError("game service message must be an object");
  }
  return message;
}

function defaultClock() {
  return {
    setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
    clearTimeout: (timer) => globalThis.clearTimeout(timer),
  };
}

export async function createServiceSpectator(options = {}) {
  const wsUrl = normalizeServiceWsUrl(options.wsUrl);
  const socketFactory = options.socketFactory ?? (await defaultSocketFactory());
  const clock = options.clock ?? defaultClock();
  const timeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  if (typeof socketFactory !== "function") {
    throw fail("INVALID_CONFIG", "game service control factories must be functions");
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw fail("INVALID_CONFIG", "requestTimeoutMs must be positive");
  }

  const connectSpectator = ({ gameId, ownerApiToken, expectedScope, onSnapshot, onEvent, onError }) =>
    new Promise((resolve, reject) => {
      const secrets = [ownerApiToken];
      let disposed = false;
      let ready = false;
      let initialSettled = false;
      let socket;
      let reconnectTimer;
      let requestTimer;
      let reconnectAttempt = 0;
      const report = (code, error) => {
        try {
          onError?.(fail(code, redact(error, secrets)));
        } catch {
          // Diagnostics cannot affect observation.
        }
      };
      const settleInitial = (error, value) => {
        if (initialSettled) return;
        initialSettled = true;
        if (requestTimer !== undefined) clock.clearTimeout(requestTimer);
        if (error === undefined) resolve(value);
        else reject(error);
      };
      const failInitial = (error) => {
        if (initialSettled) return false;
        disposed = true;
        if (reconnectTimer !== undefined) clock.clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
        const current = socket;
        socket = undefined;
        try {
          current?.close();
        } catch {
          // The caller never received a disposer, so initial failure is terminal.
        }
        settleInitial(error);
        return true;
      };
      const scheduleReconnect = () => {
        if (disposed || reconnectTimer !== undefined) return;
        const delay = Math.min(10_000, 250 * (2 ** reconnectAttempt));
        reconnectAttempt += 1;
        reconnectTimer = clock.setTimeout(() => {
          reconnectTimer = undefined;
          connect();
        }, delay);
        onEvent?.({ type: "spectator-reconnect-scheduled", delayMs: delay });
      };
      const retire = (candidate, causedByError = false) => {
        if (socket !== candidate) return;
        socket = undefined;
        ready = false;
        if (causedByError) {
          try {
            candidate.close();
          } catch {
            // Already retired.
          }
        }
        scheduleReconnect();
      };
      const connect = () => {
        if (disposed || socket !== undefined) return;
        let pendingSnapshots = [];
        let candidate;
        try {
          candidate = socketFactory(wsUrl);
          assertSocket(candidate);
        } catch (error) {
          report("SOCKET_CONNECT_FAILED", error);
          if (!failInitial(fail("SOCKET_CONNECT_FAILED", redact(error, secrets)))) {
            scheduleReconnect();
          }
          return;
        }
        socket = candidate;
        candidate.on("open", () => {
          if (disposed || socket !== candidate) return;
          try {
            candidate.send(JSON.stringify({
              type: "DSH_SPECTATE",
              gameId,
              apiToken: ownerApiToken,
            }));
          } catch (error) {
            report("SOCKET_SEND_FAILED", error);
            if (failInitial(fail("SOCKET_SEND_FAILED", redact(error, secrets)))) return;
            retire(candidate, true);
          }
        });
        candidate.on("message", (data) => {
          if (disposed || socket !== candidate) return;
          let message;
          try {
            message = parseMessage(data);
          } catch (error) {
            report("INVALID_MESSAGE", error);
            return;
          }
          if (message.type === "ERROR") {
            const error = fail(safeCode(message.errorCode, "SERVICE_REQUEST_FAILED", secrets), "game service rejected observation");
            if (failInitial(error)) return;
            report(error.code, error);
            retire(candidate, true);
            return;
          }
          if (!ready && message.type === "UPDATE") {
            if (message.full === true) pendingSnapshots = [message];
            else if (pendingSnapshots.length > 0) pendingSnapshots.push(message);
            if (pendingSnapshots.length > MAX_PENDING_SNAPSHOT_MESSAGES) {
              const error = fail("SNAPSHOT_BUFFER_OVERFLOW", "game service sent too many updates before observation was ready");
              pendingSnapshots = [];
              if (!failInitial(error)) {
                report(error.code, error);
                retire(candidate, true);
              }
            }
            return;
          }
          if (message.type === "DSH_SPECTATING" && message.gameId === gameId) {
            if (
              message.ok !== true ||
              (message.scope !== "self" && message.scope !== "full") ||
              (expectedScope !== undefined && message.scope !== expectedScope)
            ) {
              const error = fail(safeCode(message.errorCode, "SPECTATE_REJECTED", secrets), "game service rejected observation");
              if (failInitial(error)) return;
              report(error.code, error);
              retire(candidate, true);
              return;
            }
            ready = true;
            reconnectAttempt = 0;
            const view = Object.freeze({
              scope: message.scope,
              ...(Number.isInteger(message.ownerSeat) ? { ownerSeat: message.ownerSeat } : {}),
            });
            onEvent?.({ type: "spectator-ready", ...view });
            for (const snapshot of pendingSnapshots) onSnapshot?.(snapshot);
            pendingSnapshots = [];
            settleInitial(undefined, Object.freeze({
              ...view,
              dispose,
            }));
            return;
          }
          if (ready && message.type === "UPDATE") onSnapshot?.(message);
        });
        candidate.on("error", (error) => {
          report("SOCKET_ERROR", error);
          if (failInitial(fail("SOCKET_ERROR", redact(error, secrets)))) return;
          retire(candidate, true);
        });
        candidate.on("close", () => {
          if (failInitial(fail("SOCKET_CLOSED", "game service closed before observation was ready"))) return;
          retire(candidate);
        });
      };
      const dispose = () => {
        if (disposed) return;
        disposed = true;
        if (reconnectTimer !== undefined) clock.clearTimeout(reconnectTimer);
        if (requestTimer !== undefined) clock.clearTimeout(requestTimer);
        const current = socket;
        socket = undefined;
        try {
          current?.close();
        } catch {
          // Disposal is idempotent.
        }
        if (!initialSettled) settleInitial(fail("CONTROL_DISPOSED", "game service observation was disposed"));
      };
      requestTimer = clock.setTimeout(() => {
        if (!initialSettled) {
          settleInitial(fail("REQUEST_TIMEOUT", "game service observation timed out"));
          dispose();
        }
      }, timeoutMs);
      connect();
    });

  return Object.freeze({ connectSpectator });
}
