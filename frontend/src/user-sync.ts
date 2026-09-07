import type { Client } from './client';
// Identity, nickname and avatar are assigned by the authoritative seat service.
export async function syncProfileToGameClient(_client: Client, _options?: { strictExistingToken?: boolean }): Promise<boolean> { return true; }
