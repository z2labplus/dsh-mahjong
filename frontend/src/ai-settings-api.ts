import { getApiBaseUrl, getLoginToken } from './user';

export type AiSource = 'official' | 'profile';

export type AiProfilePublic = {
  id: string;
  alias: string;
  provider: 'openai';
  model: string;
  last4: string;
  createdAt: number;
  updatedAt: number;
};

export type AiPref = { source: AiSource; profileId: string | null };

export function resolveEffectiveAiModelLabel(params: {
  effective: AiPref | null | undefined;
  profiles: ReadonlyArray<AiProfilePublic> | null | undefined;
  officialModel: string | null | undefined;
}): string | null {
  const effective = params.effective ?? null;
  const profiles = Array.isArray(params.profiles) ? params.profiles : [];
  const officialModel = typeof params.officialModel === 'string' ? params.officialModel.trim() : '';
  if (effective?.source === 'profile') {
    const pid = effective.profileId ?? null;
    const prof = pid ? profiles.find((p) => p.id === pid) ?? null : null;
    if (prof?.model) return prof.model;
  }
  return officialModel || null;
}

export type AiRulesResponse = {
  source: 'user' | 'global';
  effective: string;
  global: string;
  user: string | null;
};

export type AiRulesPatchResponse = AiRulesResponse & { ok: boolean; saved: string | null };

export async function fetchAiSettings(params?: { gameId?: string }): Promise<{
  apiBaseUrl?: string;
  gateway?: { id: string; name: string; baseUrl: string } | null;
  official: {
    model: string;
    globalDefaultModel?: string;
    overrideModel?: string;
    gatewayId?: string;
    points: number;
    enabled: boolean;
    canUse: boolean;
    configured: boolean;
  };
  models: Array<string>;
  officialModelOptions?: Array<{
    gatewayId: string;
    gatewayName: string;
    modelId: string;
    isSystemDefault?: boolean;
  }>;
  profileModels?: Array<string>;
  profiles: Array<AiProfilePublic>;
  default: AiPref;
  room: AiPref | null;
  effective: AiPref;
}> {
  const qs = params?.gameId ? `?gameId=${encodeURIComponent(params.gameId)}` : '';
  return apiJson(`/ai/settings${qs}`, { method: 'GET' });
}

export type AiBillingItem = {
  id: number;
  kind: 'ai_charge' | 'admin_adjust' | 'recharge';
  requestId: string | null;
  gameId: string | null;
  scene: string | null;
  aiKind: 'recommend' | 'followup' | null;
  modelId: string | null;
  usageInputTokens: number | null;
  usageOutputTokens: number | null;
  usageTotalTokens: number | null;
  billedTokens: number | null;
  fallbackCharged: boolean;
  priceVersion: string | null;
  changePoints: number;
  balanceBefore: number;
  balanceAfter: number;
  note: string | null;
  createdAt: number;
};

export async function fetchAiBilling(params?: { limit?: number; offset?: number }): Promise<{
  officialPoints: number;
  limit: number;
  offset: number;
  items: Array<AiBillingItem>;
}> {
  const qs = new URLSearchParams();
  if (typeof params?.limit === 'number') qs.set('limit', String(Math.trunc(params.limit)));
  if (typeof params?.offset === 'number') qs.set('offset', String(Math.trunc(params.offset)));
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return apiJson(`/ai/billing${suffix}`, { method: 'GET' });
}

export type UserPayChannel = 'alipay' | 'wechat_native';
export type UserPayMode = 'manual' | 'xorpay';
export type UserPayOrderStatus = 'created' | 'paid' | 'credited' | 'closed' | 'expired';

export type UserPayPackage = {
  id: string;
  title: string;
  priceCents: number;
  priceCny: number;
  points: number;
  enabled: boolean;
  sort: number;
};

export type UserPayOrder = {
  id: string;
  channel: UserPayChannel;
  status: UserPayOrderStatus;
  packageId: string;
  amountCents: number;
  amountYuan: number;
  amountYuanText: string;
  points: number;
  payUrl: string | null;
  providerOrderId: string | null;
  xorpayStatus: string | null;
  expiresAt: number | null;
  createdAt: number;
  paidAt: number | null;
  creditedAt: number | null;
  updatedAt: number;
};

export async function fetchPayConfig(): Promise<{
  paymentMode: UserPayMode;
  providers: Array<string>;
  channels: Array<UserPayChannel>;
  packages: Array<UserPayPackage>;
}> {
  return apiJson('/pay/config', { method: 'GET' });
}

export async function createPayOrder(params: {
  packageId: string;
  channel: UserPayChannel;
}): Promise<{ order: UserPayOrder }> {
  return apiJson('/pay/order/create', { method: 'POST', body: params });
}

export async function fetchPayOrder(orderId: string): Promise<{ order: UserPayOrder }> {
  const id = String(orderId ?? '').trim();
  if (!id) throw new Error('missing order id');
  return apiJson(`/pay/order/${encodeURIComponent(id)}`, { method: 'GET' });
}

export async function fetchAiRules(): Promise<AiRulesResponse> {
  return apiJson('/ai/rules', { method: 'GET' });
}

export async function setAiRules(rules: string | null): Promise<AiRulesPatchResponse> {
  return apiJson('/ai/rules', { method: 'PATCH', body: { rules } });
}

export async function setAiDefault(pref: AiPref): Promise<{ default: AiPref }> {
  return apiJson('/ai/default', { method: 'PATCH', body: pref });
}

export async function setAiOfficialModel(params: { modelId?: string | null; gatewayId?: string | null }): Promise<{
  ok: boolean;
  model: string;
  globalDefaultModel?: string;
  overrideModel?: string;
  gatewayId?: string;
  error?: string;
}> {
  return apiJson('/ai/official-model', { method: 'PATCH', body: params });
}

export async function createAiProfile(params: { alias: string; apiKey: string; model: string }): Promise<{ profile: AiProfilePublic }> {
  return apiJson('/ai/profiles', { method: 'POST', body: params });
}

export async function updateAiProfile(
  profileId: string,
  patch: { apiKey?: string; model?: string },
): Promise<{ profile: AiProfilePublic }> {
  return apiJson(`/ai/profiles/${encodeURIComponent(profileId)}`, { method: 'PATCH', body: patch });
}

export async function deleteAiProfile(profileId: string): Promise<{ ok: boolean; defaultChanged?: boolean }> {
  return apiJson(`/ai/profiles/${encodeURIComponent(profileId)}`, { method: 'DELETE' });
}

export async function testAiKey(params: { apiKey: string; model: string }): Promise<{ ok: boolean; error?: string }> {
  return apiJson('/ai/test', { method: 'POST', body: params });
}

export async function testAiProfile(profileId: string, params?: { model?: string }): Promise<{ ok: boolean; error?: string }> {
  return apiJson(`/ai/profiles/${encodeURIComponent(profileId)}/test`, { method: 'POST', body: params ?? {} });
}

export async function setRoomAiPref(gameId: string, pref: AiPref): Promise<{ room: AiPref }> {
  return apiJson(`/ai/rooms/${encodeURIComponent(gameId)}`, { method: 'PATCH', body: pref });
}

type ApiMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';
type ApiOptions = { method: ApiMethod; body?: any; timeoutMs?: number };

const DEFAULT_API_TIMEOUT_MS = 30_000;
const MIN_API_TIMEOUT_MS = 1_000;
const MAX_API_TIMEOUT_MS = 120_000;

async function apiJson(path: string, options: ApiOptions): Promise<any> {
  const base = getApiBaseUrl();
  const url = `${base}${path.startsWith('/') ? '' : '/'}${path}`;
  const token = getLoginToken();
  if (!token) {
    throw new Error('missing login token');
  }
  const timeoutMs = normalizeTimeoutMs(options.timeoutMs ?? DEFAULT_API_TIMEOUT_MS);
  const controller = new AbortController();
  const timeoutHandle = window.setTimeout(() => controller.abort(), timeoutMs);
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: options.method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
  } catch (err: unknown) {
    if (isAbortError(err)) {
      throw new Error('请求超时，请检查网络后重试');
    }
    throw err;
  } finally {
    window.clearTimeout(timeoutHandle);
  }
  const text = await resp.text();
  const json = safeParse(text);
  if (!resp.ok) {
    throw new Error(String(json?.error ?? `${resp.status} ${resp.statusText}`));
  }
  return json;
}

function safeParse(text: string): any {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function normalizeTimeoutMs(raw: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_API_TIMEOUT_MS;
  const i = Math.trunc(n);
  if (i < MIN_API_TIMEOUT_MS) return MIN_API_TIMEOUT_MS;
  if (i > MAX_API_TIMEOUT_MS) return MAX_API_TIMEOUT_MS;
  return i;
}

function isAbortError(err: unknown): boolean {
  if (!err) return false;
  if (typeof DOMException !== 'undefined' && err instanceof DOMException && err.name === 'AbortError') return true;
  const name = typeof (err as any)?.name === 'string' ? String((err as any).name) : '';
  return name === 'AbortError';
}
