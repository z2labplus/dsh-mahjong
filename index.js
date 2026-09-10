import { createHandAssetsHandler, HAND_ASSET_PREFIX } from "./lib/hand-assets.js";
import { randomBytes } from "node:crypto";
import { createServiceControl, normalizeServiceUrl } from "./lib/service-control.js";

import { createHarnessSessionGameStore } from "./lib/session-game-store.js";
import { createDshMahjongGameController } from "./lib/game-controller.js";
import { createDshMahjongHttpHandler, API_PREFIX } from "./lib/http-api.js";

const PLUGIN_CONFIG_KEYS = new Set(["service"]);
const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const CLIENT_BOOT_SCHEMA = "dsh-mahjong.client.v1";
const CLIENT_BOOT_GLOBAL = "__DSH_MAHJONG_BOOT__";

class DshMahjongPluginError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DshMahjongPluginError";
    this.code = code;
  }
}

function fail(code, message) {
  return new DshMahjongPluginError(code, message);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertOnlyKeys(value, allowed, field) {
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw fail("INVALID_CONFIG", `${field} contains unsupported fields`);
  }
}

function normalizePluginConfig(config, environment) {
  const value = config ?? {};
  if (!isPlainObject(value)) {
    throw fail("INVALID_CONFIG", "dsh-mahjong config must be an object");
  }
  assertOnlyKeys(value, PLUGIN_CONFIG_KEYS, "dsh-mahjong config");
  if (!isPlainObject(environment)) {
    throw fail("INVALID_CONFIG", "the plugin environment must be an object");
  }
  if (!isPlainObject(value.service)) {
    throw fail("INVALID_CONFIG", "config.service is required; configure the standalone game service");
  }
  assertOnlyKeys(value.service, new Set(["url", "tokenEnv", "handUrlBase"]), "config.service");
  const tokenEnv = value.service.tokenEnv ?? "DSH_MAHJONG_SERVICE_TOKEN";
  if (typeof tokenEnv !== "string" || !ENVIRONMENT_NAME.test(tokenEnv)) throw fail("INVALID_CONFIG", "service.tokenEnv must name one environment variable");
  const token = environment[tokenEnv];
  if (token !== undefined && (typeof token !== "string" || !token || token.trim() !== token)) throw fail("INVALID_CONFIG", "service token must be a trimmed string");
  const origin = normalizeServiceUrl(value.service.url);
  const service = Object.freeze({ url: origin, ownerApiToken: token, handUrlBase: value.service.handUrlBase ?? `${origin}/hand/` });
  return service;
}

function injectClientBoot(html, apiBase, requestToken, workspacePath) {
  if (typeof html !== "string") {
    throw fail("CLIENT_BOOT_INVALID", "Harness index html must be a string");
  }
  const json = JSON.stringify({
    schema: CLIENT_BOOT_SCHEMA,
    ...(apiBase === undefined ? {} : { apiBase }),
    ...(requestToken === undefined ? {} : { requestToken }),
    ...(workspacePath === undefined ? {} : { workspacePath }),
  })
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
  const script = `<script>window.${CLIENT_BOOT_GLOBAL}=${json}<\/script>`;
  const head = html.indexOf("<head>");
  if (head !== -1) return `${html.slice(0, head + 6)}${script}${html.slice(head + 6)}`;
  return `${script}${html}`;
}

export const name = "dsh-mahjong";
export const inject = [
  "tools",
  "agents",
  "agentLoop",
  "webServer",
  "sessionPersistence",
  "systemPrompt",
  "llm",
  "storageDomain",
  "settings",
  "credentials",
];

export function apply(ctx, config, internals = {}) {
  const environment = internals.environment ?? process.env;
  const backend = normalizePluginConfig(config, environment);
  const requestToken = internals.requestToken ?? randomBytes(32).toString("base64url");
  ctx.effect(
    () => ctx.webServer.tapIndex((html) => injectClientBoot(
      html,
      API_PREFIX,
      requestToken,
      process.cwd(),
    )),
    "dsh-mahjong: client game bootstrap",
  );

  ctx.effect(() => ctx.webServer.register({kind:"prefix",path:HAND_ASSET_PREFIX.slice(0,-1),handler:createHandAssetsHandler()}), "dsh-mahjong: embedded real hand assets");

  let resolveController;
  let rejectController;
  const controllerPromise = new Promise((resolve, reject) => {
    resolveController = resolve;
    rejectController = reject;
  });
  void controllerPromise.catch(() => {});
  ctx.effect(async () => {
    try {
      const store = await createHarnessSessionGameStore(ctx, {
        ...(internals.gameStore === undefined ? {} : { store: internals.gameStore }),
        ...(internals.domainRuntime === undefined
          ? {}
          : { domainRuntime: internals.domainRuntime }),
      });
      const control = internals.control ?? createServiceControl({
        url: backend.url,
        ...(internals.controlSocketFactory ? { socketFactory: internals.controlSocketFactory } : {}),
      });
      const controller = await createDshMahjongGameController({
        ctx,
        store,
        control,
        ownerApiToken: backend.ownerApiToken,
        handUrlBase: backend.handUrlBase,
        ...(internals.dynamicRuntimeFactory === undefined
          ? {}
          : { runtimeFactory: internals.dynamicRuntimeFactory }),
        ...(internals.modelCatalogReader === undefined
          ? {}
          : { modelCatalogReader: internals.modelCatalogReader }),
        ...(internals.now === undefined ? {} : { now: internals.now }),
      });
      resolveController(controller);
      return () => controller.dispose();
    } catch (error) {
      rejectController(error);
      throw error;
    }
  }, "dsh-mahjong: dynamic game controller");
  ctx.effect(
    () => ctx.webServer.register({
      kind: "prefix",
      path: API_PREFIX,
      handler: createDshMahjongHttpHandler(controllerPromise, { requestToken }),
    }),
    "dsh-mahjong: same-origin API",
  );
}

export { DshMahjongPluginError };
