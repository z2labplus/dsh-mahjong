export const DEFAULT_ACTION_TIMEOUT_SECONDS = 38;
export const MIN_ACTION_TIMEOUT_SECONDS = 10;
export const MAX_ACTION_TIMEOUT_SECONDS = 120;
export const DEFAULT_INITIAL_POINTS = 4_800;
export const MAX_INITIAL_POINTS = 1_000_000;

const START_KEYS = new Set(["sessionId", "tableName", "timeoutSeconds", "seats", "ruleset", "ruleOptions"]);
const HUMAN_SEAT_KEYS = new Set(["seat", "kind", "owner", "initialPoints"]);
const AI_SEAT_KEYS = new Set([
  "seat",
  "kind",
  "provider",
  "model",
  "modelLabel",
  "reasoningEffort",
  "maxTokens",
  "initialPoints",
]);

export class GameConfigError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "GameConfigError";
    this.code = code;
  }
}

function fail(code, message) {
  return new GameConfigError(code, message);
}

function plainObject(value, field) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw fail("INVALID_REQUEST", `${field} must be an object`);
  }
  return value;
}

function onlyKeys(value, keys, field) {
  const unknown = Object.keys(value).find((key) => !keys.has(key));
  if (unknown !== undefined) {
    throw fail("INVALID_REQUEST", `${field} contains unsupported field ${unknown}`);
  }
}

function text(value, field, maxLength) {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value !== value.trim() ||
    value.length > maxLength ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw fail("INVALID_REQUEST", `${field} must be a trimmed non-empty string`);
  }
  return value;
}

function optionalText(value, field, maxLength) {
  return value === undefined ? undefined : text(value, field, maxLength);
}

function catalogIndex(catalog) {
  const providers = new Map();
  for (const provider of catalog?.providers ?? []) {
    if (typeof provider?.id !== "string" || !Array.isArray(provider.models)) continue;
    providers.set(provider.id, {
      provider,
      models: new Map(
        provider.models
          .filter((model) => typeof model?.id === "string")
          .map((model) => [model.id, model]),
      ),
    });
  }
  return providers;
}

function normalizeHumanSeat(value, index) {
  onlyKeys(value, HUMAN_SEAT_KEYS, `seats[${index}]`);
  if (value.owner !== undefined && typeof value.owner !== "boolean") {
    throw fail("INVALID_REQUEST", `seats[${index}].owner must be a boolean`);
  }
  return Object.freeze({
    seat: value.seat,
    kind: "human",
    initialPoints: normalizeInitialPoints(value.initialPoints),
    ...(value.owner === true ? { owner: true } : {}),
  });
}

function normalizeAiSeat(value, index, providers) {
  onlyKeys(value, AI_SEAT_KEYS, `seats[${index}]`);
  const provider = text(value.provider, `seats[${index}].provider`, 120);
  const model = text(value.model, `seats[${index}].model`, 160);
  const providerEntry = providers.get(provider);
  if (providerEntry === undefined) {
    throw fail("PROVIDER_UNAVAILABLE", `seats[${index}] selected an unavailable provider`);
  }
  if (providerEntry.provider.credentialReady !== true) {
    throw fail(
      "MODEL_CREDENTIAL_UNAVAILABLE",
      `seats[${index}] selected a provider whose credential is unavailable`,
    );
  }
  const modelEntry = providerEntry.models.get(model);
  if (modelEntry === undefined) {
    throw fail("MODEL_UNAVAILABLE", `seats[${index}] selected an unavailable model`);
  }
  const requestedLabel = optionalText(
    value.modelLabel,
    `seats[${index}].modelLabel`,
    80,
  );
  const modelLabel = text(
    requestedLabel ?? modelEntry.name ?? model,
    `seats[${index}].modelLabel`,
    80,
  );
  const result = {
    seat: value.seat,
    kind: "ai",
    initialPoints: normalizeInitialPoints(value.initialPoints),
    provider,
    model,
    modelLabel,
  };
  if (value.reasoningEffort !== undefined) {
    result.reasoningEffort = text(
      value.reasoningEffort,
      `seats[${index}].reasoningEffort`,
      80,
    );
  }
  if (value.maxTokens !== undefined) {
    if (!Number.isSafeInteger(value.maxTokens) || value.maxTokens <= 0) {
      throw fail("INVALID_REQUEST", `seats[${index}].maxTokens must be positive`);
    }
    result.maxTokens = value.maxTokens;
  }
  return Object.freeze(result);
}

function normalizeInitialPoints(value = DEFAULT_INITIAL_POINTS) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_INITIAL_POINTS) {
    throw fail("INVALID_INITIAL_POINTS", "初始积分需为 0 到 1,000,000 的整数");
  }
  return value;
}

export function normalizeStartRequest(input, catalog) {
  const request = plainObject(input, "request");
  onlyKeys(request, START_KEYS, "request");
  const sessionId = text(request.sessionId, "sessionId", 300);
  const tableName = text(request.tableName ?? "麻将实验室", "tableName", 40);
  const ruleset = request.ruleset ?? "blood";
  if (!["blood", "guobiao"].includes(ruleset)) throw fail("INVALID_RULESET", "请选择血战到底或标准国标");
  const options = plainObject(request.ruleOptions ?? {}, "ruleOptions");
  onlyKeys(options, new Set(ruleset === "guobiao" ? ["autoBuhua"] : []), "ruleOptions");
  if (options.autoBuhua !== undefined && typeof options.autoBuhua !== "boolean") throw fail("INVALID_RULE_OPTIONS", "自动补花选项无效");
  const ruleOptions = Object.freeze(ruleset === "guobiao" ? {autoBuhua: options.autoBuhua ?? true} : {});
  const timeoutSeconds = request.timeoutSeconds ?? DEFAULT_ACTION_TIMEOUT_SECONDS;
  if (
    !Number.isInteger(timeoutSeconds) ||
    timeoutSeconds < MIN_ACTION_TIMEOUT_SECONDS ||
    timeoutSeconds > MAX_ACTION_TIMEOUT_SECONDS
  ) {
    throw fail(
      "INVALID_TIMEOUT",
      `timeoutSeconds must be an integer from ${MIN_ACTION_TIMEOUT_SECONDS} through ${MAX_ACTION_TIMEOUT_SECONDS}`,
    );
  }
  if (!Array.isArray(request.seats) || request.seats.length !== 4) {
    throw fail("INVALID_SEATS", "exactly four seats are required");
  }

  const providers = catalogIndex(catalog);
  const seats = request.seats.map((candidate, index) => {
    const seat = plainObject(candidate, `seats[${index}]`);
    if (!Number.isInteger(seat.seat) || seat.seat < 0 || seat.seat > 3) {
      throw fail("INVALID_SEATS", `seats[${index}].seat must be an integer from 0 through 3`);
    }
    if (seat.kind === "human") return normalizeHumanSeat(seat, index);
    if (seat.kind === "ai") return normalizeAiSeat(seat, index, providers);
    throw fail("INVALID_SEATS", `seats[${index}].kind must be human or ai`);
  });
  if (new Set(seats.map(({ seat }) => seat)).size !== 4) {
    throw fail("INVALID_SEATS", "seat numbers must be unique");
  }
  seats.sort((left, right) => left.seat - right.seat);

  const humans = seats.filter(({ kind }) => kind === "human");
  const owners = humans.filter(({ owner }) => owner === true);
  if (humans.length === 0 && owners.length !== 0) {
    throw fail("INVALID_SEATS", "an all-AI table cannot have a human owner seat");
  }
  if (humans.length > 0 && owners.length !== 1) {
    throw fail("INVALID_SEATS", "a table with humans requires exactly one owner seat");
  }

  return Object.freeze({
    sessionId,
    tableName,
    ruleset,
    ruleOptions,
    timeoutSeconds,
    ownerMode: humans.length === 0 ? "spectator" : "player",
    seats: Object.freeze(seats),
  });
}

export function publicSeatConfig(seat) {
  return Object.freeze({
    seat: seat.seat,
    kind: seat.kind,
    ...(seat.initialPoints !== undefined ? { initialPoints: seat.initialPoints } : {}),
    ...(seat.owner === true ? { owner: true } : {}),
    ...(seat.kind === "ai"
      ? {
          provider: seat.provider,
          model: seat.model,
          modelLabel: seat.modelLabel,
        }
      : {}),
  });
}
