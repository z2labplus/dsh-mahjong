// MJAI ReplayEvent wire shape; storage is owned by the Cloudflare table.
export type ReplayEvent = {
  seq: number;
  at: number;
  type: string;
  public: any;
  private?: Record<string, any>;
};
