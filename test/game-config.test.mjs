import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_ACTION_TIMEOUT_SECONDS,
  DEFAULT_INITIAL_POINTS,
  normalizeStartRequest,
  publicSeatConfig,
} from "../lib/game-config.js";

const catalog = {
  providers: [
    {
      id: "deepseek-official",
      name: "DeepSeek",
      credentialReady: true,
      models: [{ id: "deepseek-v4", name: "DeepSeek V4" }],
    },
    {
      id: "openai",
      name: "OpenAI",
      credentialReady: true,
      models: [{ id: "gpt-4.1-mini", name: "GPT-4.1 mini" }],
    },
  ],
};

function request(seats) {
  return {
    sessionId: "visible-session-1",
    tableName: "周五血战",
    seats,
  };
}

test("normalizes four seats, defaults to 38 seconds, and permits duplicate models", () => {
  const value = normalizeStartRequest(request([
    { seat: 0, kind: "human", owner: true },
    { seat: 1, kind: "ai", provider: "deepseek-official", model: "deepseek-v4" },
    { seat: 2, kind: "ai", provider: "deepseek-official", model: "deepseek-v4" },
    { seat: 3, kind: "human" },
  ]), catalog);

  assert.equal(value.timeoutSeconds, DEFAULT_ACTION_TIMEOUT_SECONDS);
  assert.deepEqual(value.seats.map(s => s.initialPoints), Array(4).fill(DEFAULT_INITIAL_POINTS));
  assert.equal(value.ownerMode, "player");
  assert.deepEqual(value.seats.map(({ seat }) => seat), [0, 1, 2, 3]);
  assert.equal(value.seats[1].modelLabel, "DeepSeek V4");
  assert.equal(value.seats[2].model, value.seats[1].model);
});

test("supports four independent AI seats and spectator ownership", () => {
  const value = normalizeStartRequest({
    ...request([0, 1, 2, 3].map((seat) => ({
      seat,
      kind: "ai",
      provider: seat % 2 ? "openai" : "deepseek-official",
      model: seat % 2 ? "gpt-4.1-mini" : "deepseek-v4",
    }))),
    timeoutSeconds: 120,
  }, catalog);
  assert.equal(value.ownerMode, "spectator");
  assert.equal(value.seats.filter(({ kind }) => kind === "ai").length, 4);
});

test("individual initial points are validated for both human and AI seats and remain public metadata", () => {
  const seats = [0, 1, 2, 3].map(seat => ({ seat, kind: "human", owner: seat === 0, initialPoints: [0, 10000, 50000, 1000000][seat] }));
  seats[1] = { seat: 1, kind: "ai", provider: "deepseek-official", model: "deepseek-v4", initialPoints: 10000 };
  const value = normalizeStartRequest(request(seats), catalog);
  assert.deepEqual(value.seats.map(publicSeatConfig).map(s => s.initialPoints), [0, 10000, 50000, 1000000]);
  assert.throws(() => { value.seats[0].initialPoints = 1; }, TypeError);
  assert.equal(Object.hasOwn(publicSeatConfig({ seat: 0, kind: "human" }), "initialPoints"), false);
  for (const initialPoints of [-1, 1.5, 1000001, Infinity, NaN, null, "10000", true]) {
    for (const index of [0, 1]) {
      const invalid = structuredClone(seats); invalid[index].initialPoints = initialPoints;
      assert.throws(() => normalizeStartRequest(request(invalid), catalog), { code: "INVALID_INITIAL_POINTS" });
    }
  }
});

test("blocks missing model credentials, invalid timeout, and ambiguous human ownership", () => {
  const unavailable = structuredClone(catalog);
  unavailable.providers[0].credentialReady = false;
  assert.throws(
    () => normalizeStartRequest(request([
      { seat: 0, kind: "human", owner: true },
      { seat: 1, kind: "ai", provider: "deepseek-official", model: "deepseek-v4" },
      { seat: 2, kind: "human" },
      { seat: 3, kind: "human" },
    ]), unavailable),
    (error) => error.code === "MODEL_CREDENTIAL_UNAVAILABLE",
  );
  assert.throws(
    () => normalizeStartRequest({ ...request([
      { seat: 0, kind: "human", owner: true },
      { seat: 1, kind: "human" },
      { seat: 2, kind: "human" },
      { seat: 3, kind: "human" },
    ]), timeoutSeconds: 9 }, catalog),
    (error) => error.code === "INVALID_TIMEOUT",
  );
  assert.throws(
    () => normalizeStartRequest(request([
      { seat: 0, kind: "human", owner: true },
      { seat: 1, kind: "human", owner: true },
      { seat: 2, kind: "human" },
      { seat: 3, kind: "human" },
    ]), catalog),
    (error) => error.code === "INVALID_SEATS",
  );
});
