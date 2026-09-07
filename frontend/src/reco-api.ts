import type { LlmRecoInput } from '../server/reco/contract';
import type { RecoResolution } from '../server/reco/contract-validate';
import { getApiBaseUrl, getLoginToken } from './user';

type ApiMethod = 'POST';

async function apiJson(path: string, params: { method: ApiMethod; body: any }): Promise<any> {
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
    body: JSON.stringify(params.body),
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

export type RecoLlmJudgeResponse = {
  ok: true;
  prompt_version: string;
  model: string;
  usedOfficial: boolean;
  resolution: RecoResolution;
};

export async function requestRecoLlmJudge(params: {
  input: LlmRecoInput;
  confidence_engine: number;
  low_confidence_threshold?: number;
  model?: string;
  temperature?: number;
  max_output_tokens?: number;
  timeout_ms?: number;
  gameId?: string;
}): Promise<RecoLlmJudgeResponse> {
  const body: any = {
    input: params.input,
    confidence_engine: params.confidence_engine,
  };
  if (typeof params.low_confidence_threshold === 'number') body.low_confidence_threshold = params.low_confidence_threshold;
  if (typeof params.model === 'string') body.model = params.model;
  if (typeof params.temperature === 'number') body.temperature = params.temperature;
  if (typeof params.max_output_tokens === 'number') body.max_output_tokens = params.max_output_tokens;
  if (typeof params.timeout_ms === 'number') body.timeout_ms = params.timeout_ms;
  if (typeof params.gameId === 'string') body.gameId = params.gameId;

  return apiJson('/reco/llm-judge', { method: 'POST', body });
}

