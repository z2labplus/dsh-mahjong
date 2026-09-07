import assert from "node:assert/strict";
import test from "node:test";

import { readConfiguredModelCatalog } from "../lib/model-catalog.js";

test("returns only registered providers and safe model metadata without credentials", async () => {
  const secret = "sk-never-return-this";
  const catalog = await readConfiguredModelCatalog({
    llm: {
      listProviders: () => [
        { id: "openai", name: "OpenAI" },
        { id: "broken", name: "Broken" },
      ],
      listConfigurableProviders: () => [
        {
          provider: "openai",
          settingsNs: "llm-pi-ai",
          settingsPath: ["providers", "openai"],
        },
      ],
      async listModels(provider) {
        if (provider === "broken") throw Object.assign(new Error(`failed ${secret}`), { code: "AUTH" });
        return [{
          provider,
          id: "gpt-4.1-mini",
          name: "GPT-4.1 mini",
          description: secret,
          inputModalities: ["text", "image", "audio"],
        }];
      },
    },
    settings: {
      describe: () => [{
        ns: "llm-pi-ai",
        value: { providers: { openai: { apiKeyEnv: "OPENAI_API_KEY" } } },
      }],
    },
    credentials: {
      describe: async (ref) => {
        assert.equal(ref, "OPENAI_API_KEY");
        return { configured: true, source: secret, writable: true };
      },
    },
  });

  assert.deepEqual(catalog, {
    providers: [{
      id: "openai",
      name: "OpenAI",
      credentialReady: true,
      models: [{
        id: "gpt-4.1-mini",
        name: "GPT-4.1 mini",
        inputModalities: ["text", "image"],
      }],
    }],
    failures: [{ provider: "broken", code: "AUTH" }],
  });
  assert.equal(JSON.stringify(catalog).includes(secret), false);
});

test("marks a configured route unavailable when its named credential is absent", async () => {
  const catalog = await readConfiguredModelCatalog({
    llm: {
      listProviders: () => [{ id: "deepseek-official", name: "DeepSeek" }],
      listConfigurableProviders: () => [{
        provider: "deepseek-official",
        settingsNs: "llm-deepseek",
        settingsPath: [],
      }],
      listModels: async () => [{
        provider: "deepseek-official",
        id: "deepseek-v4",
        name: "DeepSeek V4",
      }],
    },
    settings: {
      describe: () => [{ ns: "llm-deepseek", value: { apiKeyEnv: "DEEPSEEK_API_KEY" } }],
    },
    credentials: { describe: async () => ({ configured: false, writable: true }) },
  });
  assert.equal(catalog.providers[0].credentialReady, false);
});
