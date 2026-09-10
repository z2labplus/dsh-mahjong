function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function assertSessionId(sessionId) {
  if (typeof sessionId !== "string" || sessionId.trim() === "") {
    throw new TypeError("sessionId must be a non-empty string");
  }
  return sessionId;
}

export function createMemorySessionGameStore(initial = []) {
  const rows = new Map(initial.map((row) => [row.sessionId, clone(row)]));
  let closed = false;
  const readable = () => {
    if (closed) throw new Error("session game store is closed");
  };
  return {
    get(sessionId) {
      readable();
      return clone(rows.get(assertSessionId(sessionId)));
    },
    list() {
      readable();
      return [...rows.values()].map(clone);
    },
    async put(sessionId, value) {
      readable();
      rows.set(assertSessionId(sessionId), clone(value));
    },
    async delete(sessionId) {
      readable();
      return rows.delete(assertSessionId(sessionId));
    },
    async close() {
      closed = true;
      rows.clear();
    },
  };
}

async function loadDomainRuntime() {
  const [{ defineDomain, domainTable }, { z }] = await Promise.all([
    import("@deepseek-ai/dsh-storage-domain"),
    import("zod"),
  ]);
  return { defineDomain, domainTable, z };
}

function createDomainSpec({ defineDomain, domainTable, z }) {
  const publicSeat = z.object({
    seat: z.number().int().min(0).max(3),
    kind: z.union([z.literal("human"), z.literal("ai")]),
    owner: z.boolean().optional(),
    provider: z.string().optional(),
    model: z.string().optional(),
    modelLabel: z.string().optional(),
    initialPoints: z.number().int().min(0).max(1_000_000).optional(),
  });
  const game = z.object({
    gameId: z.string().min(1),
    mode:z.enum(["live","practice","coach","challenge"]).optional(),
    challenge:z.unknown().optional(),
    coach:z.object({lessonId:z.string(),status:z.enum(["active","passed","retry"]),feedback:z.string().optional(),score:z.number().optional()}).optional(),
    source:z.object({gameId:z.string(),eventIndex:z.number().int().nonnegative()}).optional(),
    tableName: z.string().min(1),
    ruleset: z.enum(["blood", "guobiao"]).optional(),
    ruleVersion: z.string().optional(),
    ruleOptions: z.object({autoBuhua:z.boolean().optional()}).optional(),
    timeoutSeconds: z.number().int().min(10).max(120),
    ownerMode: z.union([z.literal("player"), z.literal("spectator")]),
    viewerRole: z.union([z.literal("player"), z.literal("spectator")]),
    viewerSeat: z.number().int().min(0).max(3).optional(),
    seats: z.array(publicSeat).length(4),
    createdAtMs: z.number().int().nonnegative(),
  });
  const record = z.object({
    schemaVersion: z.literal(1),
    sessionId: z.string().min(1),
    phase: z.union([
      z.literal("active"),
      z.literal("error"),
      z.literal("stopped"),
    ]),
    locked: z.literal(true),
    lastErrorCode: z.string().optional(),
    retryable: z.boolean().optional(),
    replay:z.object({gameId:z.string(),eventIndex:z.number().int().nonnegative(),frame:z.unknown(),canPractice:z.boolean(),totalFrames:z.number().int().positive(),firstFrame:z.number().int().nonnegative().optional()}).optional(),
    sourceReplay:z.object({viewMode:z.enum(["fixed","follow"]).optional(),fixedSeat:z.number().int().min(0).max(3).optional(),caseId:z.string(),sourceHash:z.string(),questionHash:z.string().optional(),eventIndex:z.number().int().nonnegative(),seat:z.number().int().min(0).max(3),lesson:z.number().int().nonnegative().nullable(),questionIndex:z.number().int().nonnegative(),questionSeat:z.number().int().min(0).max(3),questionLesson:z.number().int().nonnegative().nullable()}).optional(),
    caseStudy: z.object({
      gameId: z.literal("case-tianfu-20260706-8-8"),
      eventIndex: z.number().int().min(0).max(2),
    }).optional(),
    game: game.optional(),
  });
  return defineDomain({
    name: "dsh_mahjong",
    version: 0,
    tables: { sessions: domainTable(record) },
  });
}

export async function createHarnessSessionGameStore(ctx, internals = {}) {
  if (internals.store !== undefined) return internals.store;
  if (typeof ctx?.storageDomain?.open !== "function") {
    const error = new Error("Harness storage domain service is unavailable");
    error.code = "HARNESS_STORAGE_UNAVAILABLE";
    throw error;
  }
  const runtime = internals.domainRuntime ?? (await loadDomainRuntime());
  const domain = await ctx.storageDomain.open(createDomainSpec(runtime));
  const table = domain.table("sessions");
  return {
    get(sessionId) {
      return clone(table.get(assertSessionId(sessionId)));
    },
    list() {
      return [...table.entries()].map(([, value]) => clone(value));
    },
    async put(sessionId, value) {
      await table.put(assertSessionId(sessionId), clone(value));
    },
    async delete(sessionId) {
      return table.delete(assertSessionId(sessionId));
    },
    async close() {
      await domain.close();
    },
  };
}
