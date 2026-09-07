// Transport boundary for the standalone table. No MJAI identity or account API.
export type UserPublic = {
  id: string;
  nickname: string;
  avatarIndex: number;
  avatarUrl?: string | null;
  matchPoints: number;
  bgmEnabled: boolean;
  sfxEnabled: boolean;
  createdAt: number;
  updatedAt: number;
};

export type MatchPointsInfo = {
  matchPoints: number;
  canClaimDaily: boolean;
  dailyClaimAmount: number;
  todayKey: string;
  lastClaimDay: string | null;
};

export type ActiveGameInfo = {
  gameId: string;
  seat: number;
  roomType: string | null;
  gameType?: string | null;
};

export type TrusteeStatusInfo = {
  gameId: string;
  seat: number;
  enabled: boolean;
  offlineSince: number | null;
};

type EnsureUserResult = { created: boolean; loginToken: string; apiToken: string | null; user: UserPublic };
type EnsureUserOptions = { strictExistingToken?: boolean };


export function getLoginToken(): string | null { return null; }
export function getApiBaseUrl(): string { throw new Error('此功能尚未接入独立牌桌，请返回 DeepSeek Harness。'); }
export async function ensureUser(_options?: EnsureUserOptions): Promise<EnsureUserResult> {
  return { created: false, loginToken: '', apiToken: null, user: {
    id: 'local-view', nickname: '', avatarIndex: 0, matchPoints: 0,
    bgmEnabled: false, sfxEnabled: true, createdAt: 0, updatedAt: 0,
  } };
}
export async function fetchTrusteeStatus(_gameId: string): Promise<{ trustee: TrusteeStatusInfo | null }> { return { trustee: null }; }
export async function disableTrustee(_gameId: string): Promise<{ ok: true; trustee: null }> { return { ok: true, trustee: null }; }
export async function fetchActiveGame(): Promise<{ activeGame: ActiveGameInfo | null }> { return { activeGame: null }; }
export async function fetchMatchPointsInfo(): Promise<MatchPointsInfo> { throw new Error('独立牌桌不使用对局积分账户。'); }
export async function newbieNew(): Promise<{ gameId: string }> { throw new Error('请在 DeepSeek Harness 新建牌局。'); }
export async function newbieStart(): Promise<{ gameId: string; reused: boolean }> { throw new Error('请在 DeepSeek Harness 新建牌局。'); }
export const guobiaoNewbieNew = newbieNew;
export const guobiaoNewbieStart = newbieStart;
