const STORAGE_KEY = 'mjlab.playerId';

export function getStoredPlayerId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function storePlayerId(playerId: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, playerId);
  } catch {
    // ignore
  }
}

export function getOrCreatePlayerId(): string {
  const existing = getStoredPlayerId();
  if (existing) {
    return existing;
  }
  const created = generatePlayerId();
  storePlayerId(created);
  return created;
}

function generatePlayerId(): string {
  try {
    if (typeof crypto !== 'undefined' && 'getRandomValues' in crypto) {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    }
  } catch {
    // ignore
  }

  // Fallback (weaker), but good enough for local-only uniqueness.
  return (
    Math.random().toString(16).slice(2) +
    Math.random().toString(16).slice(2)
  ).slice(0, 32);
}
