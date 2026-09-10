import fs from "node:fs";
import { pipeline } from "node:stream/promises";
import { timingSafeEqual } from "node:crypto";

const API_PREFIX = "/dsh-mahjong/api";
const MAX_REQUEST_BYTES = 64 * 1024;
const SAFE_CODE = /^[A-Za-z0-9_.:-]{1,80}$/;
const REQUEST_TOKEN_HEADER = "x-dsh-mahjong-request-token";

function loopbackAddress(value) {
  if (typeof value !== "string") return false;
  const address = value.toLowerCase();
  return address === "::1" || address === "127.0.0.1" || address.startsWith("127.") || address === "::ffff:127.0.0.1" || address.startsWith("::ffff:127.");
}

function safeCode(error) {
  return typeof error?.code === "string" && SAFE_CODE.test(error.code)
    ? error.code
    : "INTERNAL_ERROR";
}

function writeJson(res, status, value, extraHeaders = {}) {
  if (res.headersSent || res.writableEnded) return;
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    Pragma: "no-cache",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    ...extraHeaders,
  });
  res.end(body);
}

function loopbackHost(value) {
  if (typeof value !== "string" || !value) return false;
  try {
    const parsed = new URL(`http://${value}`);
    const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return hostname === "localhost" || hostname === "localhost." || loopbackAddress(hostname);
  } catch {
    return false;
  }
}

function requestOriginAllowed(req) {
  const origin = req.headers.origin;
  const host = req.headers.host;
  const fetchSite = req.headers["sec-fetch-site"];
  if (!loopbackHost(host) || (fetchSite !== undefined && fetchSite !== "same-origin")) return false;
  if (origin === undefined) return req.method === "GET";
  if (typeof origin !== "string" || typeof host !== "string") return false;
  try {
    const parsed = new URL(origin);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      parsed.host === host &&
      parsed.pathname === "/"
    );
  } catch {
    return false;
  }
}

function requestTokenAllowed(req, expected) {
  const actual = req.headers[REQUEST_TOKEN_HEADER];
  if (typeof actual !== "string" || typeof expected !== "string" || !actual || !expected) return false;
  const left = Buffer.from(actual, "utf8");
  const right = Buffer.from(expected, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

async function readJson(req, limit = MAX_REQUEST_BYTES) {
  const contentType = req.headers["content-type"];
  if (typeof contentType !== "string" || contentType.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    const error = new Error("请求必须使用 application/json");
    error.code = "CONTENT_TYPE_REQUIRED";
    error.status = 415;
    throw error;
  }
  const declared = Number(req.headers["content-length"] ?? 0);
  if (Number.isFinite(declared) && declared > limit) {
    const error = new Error("请求内容过大");
    error.code = "REQUEST_TOO_LARGE";
    error.status = 413;
    throw error;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      const error = new Error("请求内容过大");
      error.code = "REQUEST_TOO_LARGE";
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  let value;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("请求 JSON 无效");
    error.code = "INVALID_JSON";
    error.status = 400;
    throw error;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    const error = new Error("请求 JSON 必须是对象");
    error.code = "INVALID_REQUEST";
    error.status = 400;
    throw error;
  }
  return value;
}

function exactKeys(value, allowed) {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown !== undefined) {
    const error = new Error(`请求包含不支持的字段 ${unknown}`);
    error.code = "INVALID_REQUEST";
    error.status = 400;
    throw error;
  }
}

function oneQuery(url, name, required = false) {
  for (const key of url.searchParams.keys()) {
    if (key !== name) {
      const error = new Error("请求查询参数无效");
      error.code = "INVALID_REQUEST";
      error.status = 400;
      throw error;
    }
  }
  const values = url.searchParams.getAll(name);
  if (values.length > 1 || (required && (values.length !== 1 || !values[0]))) {
    const error = new Error(`${name} 参数无效`);
    error.code = "INVALID_REQUEST";
    error.status = 400;
    throw error;
  }
  return values[0] ?? null;
}

function routeMethod(pathname) {
  if(/^\/dsh-mahjong\/api\/source-editor\/(get|draft|validate|commit|restore|reread|version|video)$/.test(pathname))return "POST";
  if(pathname===`${API_PREFIX}/sources`)return "GET";
  if(["sources/open","sources/step"].some(p=>pathname===`${API_PREFIX}/${p}`))return "POST";
  if (pathname === `${API_PREFIX}/library` || pathname === `${API_PREFIX}/coach/lessons`) return "GET";
  if (["challenge/start","coach/start","coach/status","history/open","practice/start","replays/export","replays/import","replays/share","replays/shares","replays/revokeShare","replays/revokeSeat","replays/users"].some(path=>pathname===`${API_PREFIX}/${path}`)) return "POST";
  if (pathname === `${API_PREFIX}/models`) return "GET";
  if (pathname === `${API_PREFIX}/state`) return "GET";
  if (pathname === `${API_PREFIX}/games/start`) return "POST";
  if (pathname === `${API_PREFIX}/cases/open`) return "POST";
  if (pathname === `${API_PREFIX}/games/retry`) return "POST";
  if (pathname === `${API_PREFIX}/games/stop`) return "POST";
  return undefined;
}

export function createDshMahjongHttpHandler(controllerPromise, options = {}) {
  const requestToken = options.requestToken;
  return async function dshMahjongHttpHandler(req, res) {
    if (!loopbackAddress(req.socket?.remoteAddress)) {
      writeJson(res, 403, { ok: false, error: { code: "LOOPBACK_REQUIRED", message: "仅允许本机访问" } });
      return;
    }
    if (!requestOriginAllowed(req)) {
      writeJson(res, 403, { ok: false, error: { code: "ORIGIN_REJECTED", message: "请求来源无效" } });
      return;
    }
    if (!requestTokenAllowed(req, requestToken)) {
      writeJson(res, 403, { ok: false, error: { code: "REQUEST_TOKEN_REJECTED", message: "请求授权无效" } });
      return;
    }
    let url;
    try {
      url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
    } catch {
      writeJson(res, 400, { ok: false, error: { code: "INVALID_URL", message: "请求地址无效" } });
      return;
    }
    const expectedMethod = routeMethod(url.pathname);
    if (expectedMethod === undefined) {
      writeJson(res, 404, { ok: false, error: { code: "NOT_FOUND", message: "接口不存在" } });
      return;
    }
    if (req.method !== expectedMethod) {
      writeJson(
        res,
        405,
        { ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "请求方法不受支持" } },
        { Allow: expectedMethod },
      );
      return;
    }

    try {
      const controller = await controllerPromise;
      if(url.pathname === `${API_PREFIX}/coach/lessons`){oneQuery(url,"unused");writeJson(res,200,await controller.lessons());return;}
      if (url.pathname === `${API_PREFIX}/library`) {
        oneQuery(url,"unused");writeJson(res,200,await controller.library());return;
      }
      if (url.pathname === `${API_PREFIX}/models`) {
        oneQuery(url, "unused");
        writeJson(res, 200, { ok: true, catalog: await controller.models() });
        return;
      }
      if (url.pathname === `${API_PREFIX}/state`) {
        const sessionId = oneQuery(url, "sessionId");
        writeJson(res, 200, { ok: true, state: controller.state(sessionId) });
        return;
      }
      if(url.pathname===`${API_PREFIX}/sources`){oneQuery(url,"unused");writeJson(res,200,await controller.sourceCases());return;}
      const body = await readJson(req,url.pathname===`${API_PREFIX}/replays/import`?24*1024*1024:url.pathname.startsWith(`${API_PREFIX}/source-editor/`)?2*1024*1024:MAX_REQUEST_BYTES);
      if(url.pathname.startsWith(`${API_PREFIX}/source-editor/`)){
        const op=url.pathname.split('/').pop();
        if(op==='video'){
          exactKeys(body,['sessionId']);const file=controller.sourceVideo(body.sessionId);
          if(!file||!fs.existsSync(file))throw Object.assign(new Error('本地视频未关联或文件已移动，请在面板补选视频'),{status:404,code:'VIDEO_UNAVAILABLE'});
          const stat=fs.statSync(file);res.writeHead(200,{'Content-Type':file.endsWith('.webm')?'video/webm':'video/mp4','Content-Length':stat.size,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
          await pipeline(fs.createReadStream(file),res);return;
        }
        const fields={get:['sessionId','clientId'],draft:['sessionId','clientId','record','baseHash','diskHash','selection','reason'],validate:['sessionId','record','eventIndex','baseHash'],commit:['sessionId','clientId','record','baseHash','diskHash','operationId','reason','selectedEventId'],restore:['sessionId','clientId','baseHash','diskHash','operationId','restoreHash','selectedEventId'],reread:['sessionId'],version:['sessionId','versionHash']};
        exactKeys(body,fields[op]);writeJson(res,200,{ok:true,result:await controller.sourceEdit(op,body)});return;
      }
      if(url.pathname===`${API_PREFIX}/sources/open`){exactKeys(body,["sessionId","caseId","eventIndex","seat","lesson","viewMode"]);writeJson(res,200,{ok:true,state:await controller.openSource(body)});return;}
      if(url.pathname===`${API_PREFIX}/sources/step`){exactKeys(body,["sessionId","eventIndex","seat","lesson","viewMode"]);writeJson(res,200,{ok:true,state:await controller.stepSource(body)});return;}
      if(url.pathname===`${API_PREFIX}/challenge/start`){exactKeys(body,["sessionId","caseId"]);writeJson(res,200,{ok:true,state:await controller.startChallenge(body)});return;}
      if(url.pathname===`${API_PREFIX}/coach/start`){exactKeys(body,["sessionId","lessonId"]);writeJson(res,200,{ok:true,state:await controller.startCoach(body)});return;}
      if(url.pathname===`${API_PREFIX}/coach/status`){exactKeys(body,["sessionId"]);writeJson(res,200,await controller.coachStatus(body));return;}
      if(url.pathname===`${API_PREFIX}/history/open`){
        exactKeys(body,["sessionId","gameId","eventIndex"]);
        writeJson(res,200,{ok:true,state:await controller.openHistory(body)});return;
      }
      if(url.pathname===`${API_PREFIX}/practice/start`){
        writeJson(res,200,{ok:true,state:await controller.startPractice(body)});return;
      }
      if(url.pathname.startsWith(`${API_PREFIX}/replays/`)){
        const operation=url.pathname.split("/").pop();
        const fields={export:["gameId"],import:["archive"],share:["gameId"],shares:["gameId"],revokeShare:["gameId","shareId"],revokeSeat:["gameId","seat"],users:["command"]};
        exactKeys(body,fields[operation]);
        writeJson(res,200,await controller.replayAction(operation,body));return;
      }
      if (url.pathname === `${API_PREFIX}/cases/open`) {
        exactKeys(body, ["sessionId", "eventIndex"]);
        writeJson(res, 200, { ok: true, state: await controller.openCase(body) });
        return;
      }
      if (url.pathname === `${API_PREFIX}/games/start`) {
        writeJson(res, 200, { ok: true, state: await controller.start(body) });
        return;
      }
      exactKeys(body, ["sessionId"]);
      if (typeof body.sessionId !== "string" || !body.sessionId.trim()) {
        const error = new Error("sessionId 无效");
        error.code = "INVALID_REQUEST";
        error.status = 400;
        throw error;
      }
      const state = url.pathname.endsWith("/retry")
        ? await controller.retry(body.sessionId)
        : await controller.stop(body.sessionId);
      writeJson(res, 200, { ok: true, state });
    } catch (error) {
      const code = safeCode(error);
      const clientError = code !== "INTERNAL_ERROR";
      const status = Number.isInteger(error?.status)
        ? error.status
        : code === "GAME_LOCKED" || code === "OPERATION_IN_PROGRESS"
          ? 409
          : code.endsWith("UNAVAILABLE")
            ? 503
            : clientError
              ? 400
              : 500;
      writeJson(res, status, {
        ok: false,
        error: {
          code,
          message: clientError && typeof error?.message === "string"
            ? error.message
            : "服务暂时不可用",
        },
      });
    }
  };
}

export { API_PREFIX, MAX_REQUEST_BYTES, REQUEST_TOKEN_HEADER };
