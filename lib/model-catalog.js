const SAFE_CODE = /^[A-Za-z0-9_.:-]{1,80}$/;

function safeCode(error, fallback = "MODEL_CATALOG_FAILED") {
  return typeof error?.code === "string" && SAFE_CODE.test(error.code)
    ? error.code
    : fallback;
}

function cleanText(value, fallback, maxLength = 160) {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength || /[\u0000-\u001f\u007f]/.test(trimmed)) {
    return fallback;
  }
  return trimmed;
}

function cleanModalities(value) {
  if (!Array.isArray(value)) return undefined;
  const supported = value.filter((item) => item === "text" || item === "image");
  return Object.freeze([...new Set(supported)]);
}

function modelView(model, providerId) {
  const id = cleanText(model?.id, "", 160);
  if (!id || model?.provider !== providerId) return undefined;
  const inputModalities = cleanModalities(model.inputModalities);
  return Object.freeze({
    id,
    name: cleanText(model.name, id, 160),
    ...(inputModalities === undefined ? {} : { inputModalities }),
  });
}

export async function readConfiguredModelCatalog(llm) {
  const host = llm?.llm === undefined ? { llm } : llm;
  llm = host.llm;
  if (
    llm === null ||
    typeof llm !== "object" ||
    typeof llm.listProviders !== "function" ||
    typeof llm.listModels !== "function"
  ) {
    const error = new Error("Harness LLM catalog service is unavailable");
    error.code = "HARNESS_LLM_UNAVAILABLE";
    throw error;
  }
  const rawProviders = llm.listProviders();
  if (!Array.isArray(rawProviders)) {
    const error = new Error("Harness returned an invalid provider catalog");
    error.code = "MODEL_CATALOG_INVALID";
    throw error;
  }

  const providers = [];
  const failures = [];
  const seen = new Set();
  for (const provider of rawProviders) {
    const id = cleanText(provider?.id, "", 120);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    try {
      const rawModels = await llm.listModels(id);
      if (!Array.isArray(rawModels)) throw Object.assign(new Error(), { code: "MODEL_CATALOG_INVALID" });
      const modelIds = new Set();
      const models = [];
      for (const rawModel of rawModels) {
        const model = modelView(rawModel, id);
        if (model === undefined || modelIds.has(model.id)) continue;
        modelIds.add(model.id);
        models.push(model);
      }
      providers.push(Object.freeze({
        id,
        name: cleanText(provider.name, id, 120),
        credentialReady: await credentialReadyForProvider(host, id),
        models: Object.freeze(models),
      }));
    } catch (error) {
      failures.push(Object.freeze({ provider: id, code: safeCode(error) }));
    }
  }
  return Object.freeze({
    providers: Object.freeze(providers),
    failures: Object.freeze(failures),
  });
}

function pathValue(value, path) {
  let current = value;
  for (const part of path) {
    if (current === null || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = current[part];
  }
  return current;
}

async function credentialReadyForProvider(host, providerId) {
  const directory = host.llm.listConfigurableProviders?.() ?? [];
  const entry = directory.find((candidate) => candidate?.provider === providerId);
  if (entry === undefined || !entry.settingsNs) return true;
  const descriptors = host.settings?.describe?.({ redactSecrets: true }) ?? [];
  const descriptor = descriptors.find((candidate) => candidate?.ns === entry.settingsNs);
  if (descriptor === undefined) return false;
  const profile = pathValue(descriptor.value, entry.settingsPath ?? []);
  const credentialRef = profile?.apiKeyEnv;
  if (credentialRef === undefined) return true;
  if (typeof credentialRef !== "string" || !credentialRef) return false;
  if (typeof host.credentials?.describe !== "function") return false;
  try {
    const info = await host.credentials.describe(credentialRef);
    return info?.configured === true;
  } catch {
    return false;
  }
}
