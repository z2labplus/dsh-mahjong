import { getApiBaseUrl, getLoginToken } from './user';
import type { AiHistoryItem, AiModelInfo, AiScene, AiTemplate } from '../server/protocol';

export type PaipuListItem = {
  gameId: string;
  createdAt: number;
  finishedAt: number;
  roomType: string | null;
  rules?: {
    variant: string;
    base: number;
    dealer: number;
    ruleVersion?: string | null;
    baseRuleScore?: number | null;
    pointsScale?: number | null;
  };
  mySeat: number;
  myResult: {
    startBeans: number;
    finalBeans: number | null;
    deltaBeans: number | null;
    pointsDelta?: number | null;
    ruleScoreDelta?: number | null;
    rank: number | null;
  };
  players: Array<{
    seat: number;
    nickname: string;
    avatarIndex: number;
    finalBeans: number | null;
    pointsDelta?: number | null;
    ruleScoreDelta?: number | null;
    rank: number | null;
  }>;
  share: {
    shared: boolean;
    shareId: string | null;
    shareCreatedAt: number | null;
    sharePath: string | null;
  };
};

export type PaipuDetail = {
  schema: string;
  gameId: string;
  createdAt: number;
  finishedAt: number;
  roomType: string | null;
  rules: {
    variant: string;
    base: number;
    dealer: number;
    ruleVersion?: string | null;
    baseRuleScore?: number | null;
    pointsScale?: number | null;
  };
  perspective: {
    kind: 'strict_self';
    ownerSeat: number;
  };
  summary: {
    mySeat: number;
    startBeans: number;
    finalBeans: number | null;
    deltaBeans: number | null;
    pointsDelta?: number | null;
    ruleScoreDelta?: number | null;
    rank: number | null;
  };
  players: Array<{
    seat: number;
    nickname: string;
    avatarIndex: number;
    startBeans: number;
    finalBeans: number | null;
    deltaBeans: number | null;
    pointsDelta?: number | null;
    ruleScoreDelta?: number | null;
    rank: number | null;
  }>;
  share: {
    access: 'mine' | 'share';
    shared: boolean;
    shareId: string | null;
    shareCreatedAt: number | null;
    sharePath: string | null;
  };
  endSummary: any;
  settlementHandsBySeat?: Record<string, Array<string>>;
  timeline: Array<{
    eventIndex: number;
    seq: number;
    at: number;
    type: string;
    seat: number | null;
    label: string;
    detail: string;
    highlight: boolean;
  }>;
  keyMoments: Array<{
    eventIndex: number;
    kind: string;
    label: string;
  }>;
  events: Array<any>;
};

type ApiMethod = 'GET' | 'POST' | 'DELETE';

export type PaipuAiSnapshot = {
  blood: any;
  things: Array<{ tileId: number; slotName: string }>;
  tileFacePublic: Array<[number, number | null]>;
  tileFaceSelf: Array<[number, number | null]>;
};

async function apiJson(path: string, params: { method: ApiMethod; auth?: boolean; body?: any }): Promise<any> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (params.auth) {
    const token = getLoginToken();
    if (!token) {
      throw new Error('missing login token');
    }
    headers.Authorization = `Bearer ${token}`;
  }
  const resp = await fetch(`${getApiBaseUrl()}${path.startsWith('/') ? '' : '/'}${path}`, {
    method: params.method,
    headers,
    body: params.body !== undefined ? JSON.stringify(params.body) : undefined,
  });
  const text = await resp.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!resp.ok) {
    const error = new Error(String(json?.error ?? `${resp.status} ${resp.statusText}`)) as Error & { status?: number; data?: any };
    error.status = resp.status;
    error.data = json;
    throw error;
  }
  return json;
}

export async function listMyPaipus(params?: { roomType?: string | null; variant?: string | null; shared?: 'shared' | 'unshared' | null }): Promise<{ items: Array<PaipuListItem> }> {
  const sp = new URLSearchParams();
  const roomType = typeof params?.roomType === 'string' ? params.roomType.trim() : '';
  const variant = typeof params?.variant === 'string' ? params.variant.trim() : '';
  const shared = typeof params?.shared === 'string' ? params.shared.trim() : '';
  if (roomType) sp.set('roomType', roomType);
  if (variant) sp.set('variant', variant);
  if (shared === 'shared' || shared === 'unshared') sp.set('shared', shared);
  const query = sp.toString();
  return apiJson(`/me/replays${query ? `?${query}` : ''}`, { method: 'GET', auth: true });
}

export async function fetchMyPaipu(gameId: string): Promise<PaipuDetail> {
  const id = String(gameId ?? '').trim();
  if (!id) throw new Error('missing gameId');
  return apiJson(`/me/replays/${encodeURIComponent(id)}`, { method: 'GET', auth: true });
}

export async function createPaipuShare(gameId: string): Promise<{ shareId: string; created: boolean; sharePath: string; createdAt: number }> {
  const id = String(gameId ?? '').trim();
  if (!id) throw new Error('missing gameId');
  return apiJson(`/me/replays/${encodeURIComponent(id)}/share`, { method: 'POST', auth: true });
}

export async function deletePaipu(gameId: string): Promise<{ ok: true; gameId: string }> {
  const id = String(gameId ?? '').trim();
  if (!id) throw new Error('missing gameId');
  return apiJson(`/me/replays/${encodeURIComponent(id)}`, { method: 'DELETE', auth: true });
}

export async function openPaipuShare(shareId: string): Promise<PaipuDetail> {
  const id = String(shareId ?? '').trim();
  if (!id) throw new Error('missing shareId');
  return apiJson(`/replay-shares/${encodeURIComponent(id)}`, { method: 'GET', auth: true });
}

export async function fetchAiTemplates(): Promise<{ templates: Array<AiTemplate>; models: Array<AiModelInfo> }> {
  return apiJson('/ai/templates', { method: 'GET', auth: true });
}

export async function requestPaipuAiRecommend(params: {
  gameId: string;
  scene: AiScene;
  prompt: string;
  templateId?: string | null;
  snapshot: PaipuAiSnapshot;
  eventIndex?: number | null;
  shareId?: string | null;
}): Promise<{ item: AiHistoryItem }> {
  const gameId = String(params.gameId ?? '').trim();
  const shareId = String(params.shareId ?? '').trim();
  if (!gameId && !shareId) throw new Error('missing replay target');
  const path = shareId
    ? `/replay-shares/${encodeURIComponent(shareId)}/ai/recommend`
    : `/me/replays/${encodeURIComponent(gameId)}/ai/recommend`;
  return apiJson(path, {
    method: 'POST',
    auth: true,
    body: {
      scene: params.scene,
      prompt: params.prompt,
      templateId: params.templateId ?? null,
      snapshot: params.snapshot,
      eventIndex: Number.isFinite(params.eventIndex) ? Math.trunc(params.eventIndex as number) : null,
    },
  });
}
