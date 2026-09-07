import type { Entry, Message } from './protocol';

// The extracted rules need a collection store, not MJAI accounts or a Node server.
export class Game {
  readonly gameId: string;
  revision = 0;
  private collections = new Map<string, Map<string | number, any>>();
  constructor(gameId: string, entries: Entry[] = []) {
    this.gameId = gameId;
    this.systemUpdate(entries);
  }
  get(kind: string, key: string | number): any {
    return this.collections.get(kind)?.get(key) ?? null;
  }
  entries(kind: string): Array<[string | number, any]> {
    return [...(this.collections.get(kind)?.entries() ?? [])];
  }
  systemUpdate(entries: Entry[]): void {
    for (const [kind, key, value] of entries) {
      // Ephemeral presentation messages never become persisted game state.
      if (['sound', 'dice', 'bloodAction', 'gbAction'].includes(kind)) continue;
      if (!this.collections.has(kind)) this.collections.set(kind, new Map());
      if (value === null) this.collections.get(kind)!.delete(key);
      else this.collections.get(kind)!.set(key, value);
      this.revision++;
    }
  }
  snapshotEntries(): Entry[] {
    return structuredClone([...this.collections].flatMap(([kind, entries]) =>
      [...entries].map(([key, value]): Entry => [kind, key, value])));
  }
  getSeatForPlayer(playerId: string): number | null {
    const seat = this.get('seats', playerId)?.seat;
    return Number.isInteger(seat) && seat >= 0 && seat <= 3 ? seat : null;
  }
  sendToPlayer(_playerId: string, _message: Message): void {
    // Views are projected from the committed snapshot by the service transport.
  }
}
