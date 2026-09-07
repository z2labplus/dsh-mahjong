import { serviceFetch } from "./service-network.js";
import { randomUUID } from "node:crypto";
import { createServiceSpectator } from "./service-spectator.js";

function fail(code, message) {
  return Object.assign(new Error(message), { code });
}
export function normalizeServiceUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw fail("INVALID_CONFIG", "service.url must be an absolute URL"); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && local)) ||
    url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw fail("INVALID_CONFIG", "service.url must be an HTTPS origin or a loopback HTTP origin");
  }
  return url.origin;
}

// The local Harness owns model credentials and sessions. Only game-control and
// per-seat capability tokens cross this connection.
export function createServiceControl(options = {}) {
  const origin = normalizeServiceUrl(options.url);
  const fetchImpl = options.fetchImpl ?? serviceFetch;
  const requestIdFactory = options.requestIdFactory ?? randomUUID;
  const endpoint = (gameId) => {
    if (typeof gameId !== "string" || !/^[a-f0-9-]{36}$/.test(gameId)) throw fail("INVALID_GAME_ID", "Invalid service game id");
    return `${origin}/v1/tables/${gameId}`;
  };
  const wsUrlForGame = (gameId) => `${endpoint(gameId).replace(/^http/, "ws")}/ws`;
  async function requestUrl(url, method, ownerApiToken, body, signal) {
    if (typeof ownerApiToken !== "string" || !ownerApiToken) throw fail("SERVICE_TOKEN_UNAVAILABLE", "请先配置牌局服务凭证");
    let response;
    try {
      response = await fetchImpl(url, {
        method, redirect: "error",
        headers: { Authorization: `Bearer ${ownerApiToken}`, "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.any([AbortSignal.timeout(15000), ...(signal ? [signal] : [])]),
      });
    } catch { throw fail("SERVICE_UNREACHABLE", "无法连接牌局服务"); }
    let result;
    try { result = await response.json(); }
    catch { throw fail("SERVICE_RESPONSE_INVALID", "牌局服务返回了无效响应"); }
    if (!response.ok || result?.ok !== true) {
      const code = typeof result?.errorCode === "string" && /^[A-Z][A-Z0-9_]{1,79}$/.test(result.errorCode) && !result.errorCode.includes(ownerApiToken)
        ? result.errorCode : "SERVICE_REQUEST_FAILED";
      const messages={HISTORY_QUOTA_REACHED:"记录数量已达配额，请联系管理员增加配额",ACTIVE_TABLE_QUOTA_REACHED:"进行中的牌桌已达配额，请先结束现有牌局",USER_REVOKED:"服务权限已被管理员撤销",FORBIDDEN:"当前账号没有此操作权限",INVALID_REPLAY:"牌谱格式不正确或版本不受支持",REPLAY_HIDDEN_STATE:"牌谱包含不允许导入的隐藏状态",GAME_NOT_FINISHED:"请等待牌局结束后再导出或分享",PRACTICE_STATE_UNAVAILABLE:"此记录只有展示数据，无法重建为练习",SHARE_LIMIT:"分享链接已达上限，请撤销不再使用的链接"};
      throw fail(code, messages[code] ?? "牌局服务拒绝了请求");
    }
    return result;
  }
  async function request(gameId, method, token, body, signal, suffix = "") {
    const result = await requestUrl(endpoint(gameId) + suffix, method, token, body, signal);
    if (result.gameId !== gameId) throw fail("SERVICE_RESPONSE_INVALID", "牌局服务返回的牌局不匹配");
    return result;
  }
  return Object.freeze({
    wsUrlForGame,
    origin,
    lessons: ({ownerApiToken}) => requestUrl(`${origin}/v1/coach/lessons`,"GET",ownerApiToken),
    startCoach: ({lessonId,ownerApiToken}) => request(requestIdFactory(),"PUT",ownerApiToken,{lessonId},undefined,"/coach"),
    coachStatus: ({gameId,ownerApiToken}) => request(gameId,"GET",ownerApiToken,undefined,undefined,"/coach"),
    library: ({ownerApiToken}) => requestUrl(`${origin}/v1/library`, "GET", ownerApiToken),
    history: ({gameId, ownerApiToken}) => request(gameId, "GET", ownerApiToken, undefined, undefined, "/history"),
    historyFrame: ({gameId, eventIndex, ownerApiToken}) => request(gameId, "GET", ownerApiToken, undefined, undefined, `/history/${eventIndex}`),
    exportReplay: ({gameId, ownerApiToken}) => request(gameId, "GET", ownerApiToken, undefined, undefined, "/replay"),
    importReplay: ({archive, ownerApiToken}) => request(requestIdFactory(), "PUT", ownerApiToken, archive, undefined, "/replay"),
    listShares: ({gameId, ownerApiToken}) => request(gameId, "GET", ownerApiToken, undefined, undefined, "/shares"),
    shareReplay: ({gameId, ownerApiToken}) => request(gameId, "POST", ownerApiToken, {}, undefined, "/shares"),
    revokeShare: ({gameId, shareId, ownerApiToken}) => request(gameId, "DELETE", ownerApiToken, undefined, undefined, `/shares/${shareId}`),
    revokeSeat: ({gameId, seat, ownerApiToken}) => request(gameId, "POST", ownerApiToken, {}, undefined, `/seats/${seat}/revoke`),
    manageUsers: ({ownerApiToken, command}) => requestUrl(`${origin}/v1/admin/users`,command ? "POST" : "GET",ownerApiToken,command),
    createPractice: async ({sourceGameId,eventIndex,ownerApiToken,table}) => {
      const gameId=requestIdFactory();
      const result=await requestUrl(`${endpoint(sourceGameId)}/practice`,"POST",ownerApiToken,{gameId,eventIndex,table});
      if(result.gameId!==gameId)throw fail("SERVICE_RESPONSE_INVALID", "练习牌局不匹配");
      return result;
    },
    createTable: ({ ownerApiToken, tableName, timeoutSeconds, seats, ruleset = "blood", ruleOptions = {}, signal }) => request(requestIdFactory(), "PUT", ownerApiToken, {
      ruleset, ruleOptions, tableName, timeoutSeconds,
      seats: seats.map(seat => seat.kind === "human"
        ? { seat: seat.seat, kind: "human", ...(seat.owner ? { owner: true } : {}) }
        : { seat: seat.seat, kind: "ai", modelId: seat.model, modelLabel: seat.modelLabel }),
    }, signal),
    resumeTable: ({ gameId, ownerApiToken, signal }) => request(gameId, "GET", ownerApiToken, undefined, signal),
    async connectSpectator(params) {
      const transport = await createServiceSpectator({ wsUrl: wsUrlForGame(params.gameId),
        ...(options.socketFactory ? { socketFactory: options.socketFactory } : {}) });
      return transport.connectSpectator(params);
    },
  });
}
