import { getApiBaseUrl, getLoginToken } from './user';

export type PracticeBranchStatus = 'locked' | 'ready' | 'active' | 'done';
export type PracticeBranchScene = 'turn' | 'claim' | 'swap3' | 'dingque' | 'snapshot';

export type PracticeBranchSummary = {
  branchId: string;
  sourceGameId: string;
  sourceRoomType: string | null;
  sourceSeat: number;
  snapshotKey: string;
  scene: PracticeBranchScene;
  phase: string;
  turnSeat: number | null;
  turnStep: string | null;
  pendingId: number | null;
  wallIndex: number | null;
  title: string | null;
  note: string | null;
  status: PracticeBranchStatus;
  practiceGameId: string | null;
  unlockedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

type ApiMethod = 'GET' | 'POST';

async function apiJson(path: string, params: { method: ApiMethod; body?: any }): Promise<any> {
  const token = getLoginToken();
  if (!token) {
    throw new Error('missing login token');
  }
  const resp = await fetch(`${getApiBaseUrl()}${path.startsWith('/') ? '' : '/'}${path}`, {
    method: params.method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
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

export async function createPracticeBranch(params: {
  gameId: string;
  title?: string | null;
  note?: string | null;
}): Promise<{ created: boolean; branch: PracticeBranchSummary }> {
  return apiJson('/practice-branches', {
    method: 'POST',
    body: {
      gameId: params.gameId,
      title: params.title ?? null,
      note: params.note ?? null,
    },
  });
}

export async function listPracticeBranches(): Promise<{ items: Array<PracticeBranchSummary> }> {
  return apiJson('/me/practice-branches', { method: 'GET' });
}

export async function enterPracticeBranch(branchId: string): Promise<{ branch: PracticeBranchSummary; gameId: string }> {
  const id = String(branchId ?? '').trim();
  if (!id) {
    throw new Error('missing branchId');
  }
  return apiJson(`/practice-branches/${encodeURIComponent(id)}/enter`, { method: 'POST' });
}

export async function deletePracticeBranch(branchId: string): Promise<{ ok: true; branchId: string }> {
  const id = String(branchId ?? '').trim();
  if (!id) {
    throw new Error('missing branchId');
  }
  return apiJson(`/practice-branches/${encodeURIComponent(id)}/delete`, { method: 'POST' });
}
