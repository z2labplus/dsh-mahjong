export type GuobiaoClientConfig = {
  autoBuhua?: boolean;
  autoBuhuaBySeat?: Record<number, boolean>;
};

const AUTO_BUHUA_KEY = 'mjlab.guobiao.autoBuhua';

export function readGuobiaoAutoBuhuaPreference(): boolean {
  try {
    const raw = localStorage.getItem(AUTO_BUHUA_KEY);
    if (raw === 'false') return false;
    if (raw === 'true') return true;
  } catch {
    // ignore storage errors and keep the production default.
  }
  return true;
}

export function writeGuobiaoAutoBuhuaPreference(enabled: boolean): void {
  try {
    localStorage.setItem(AUTO_BUHUA_KEY, enabled ? 'true' : 'false');
  } catch {
    // The current hand state still updates through the server even if storage is unavailable.
  }
}

export function guobiaoConfigForCurrentPlayer(): GuobiaoClientConfig {
  return { autoBuhua: readGuobiaoAutoBuhuaPreference() };
}

export function guobiaoConfigForSeat(seat: number): GuobiaoClientConfig {
  const autoBuhua = readGuobiaoAutoBuhuaPreference();
  return { autoBuhua, autoBuhuaBySeat: { [seat]: autoBuhua } };
}
