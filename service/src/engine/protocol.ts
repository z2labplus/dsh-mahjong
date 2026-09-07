export type FriendRoomGameType = 'BLOOD_BATTLE' | 'GUOBIAO';
export type FriendWaitMode = 'noTimeout' | 'timeoutAuto';

export type FriendConfig = {
  waitMode: FriendWaitMode;
  timeoutMs?: number | null;
};

export type GuobiaoConfig = {
  autoBuhua?: boolean;
  autoBuhuaBySeat?: Record<number, boolean>;
};

export type DshTableSeatConfig =
  | { seat: number; kind: 'human'; owner?: boolean }
  | { seat: number; kind: 'ai'; modelId: string; modelLabel?: string | null };

interface DshTableCreateMessage {
  type: 'DSH_TABLE_CREATE';
  requestId: string;
  apiToken: string;
  tableName?: string | null;
  aiDecisionTimeoutMs?: number | null;
  seats: Array<DshTableSeatConfig>;
}

interface DshTableCreatedMessage {
  type: 'DSH_TABLE_CREATED';
  requestId: string;
  ok: boolean;
  gameId?: string;
  roomType?: 'friend';
  aiDecisionTimeoutMs?: number;
  ownerMode?: 'player' | 'spectator';
  // Only returned for an all-AI table. Safe to pass to the embedded /hand/ viewer.
  spectatorEmbedTicket?: string;
  spectatorEmbedTicketExpiresAtMs?: number;
  seats?: Array<{
    seat: number;
    kind: 'human' | 'ai';
    modelId?: string;
    modelLabel?: string;
    // AI credentials are server-to-server only. Human tickets may appear in an invite URL.
    seatCredential?: string;
    humanInviteTicket?: string;
    credentialExpiresAtMs?: number;
  }>;
  error?: string;
  errorCode?: string;
}

interface DshTableResumeMessage {
  type: 'DSH_TABLE_RESUME';
  requestId: string;
  gameId: string;
  apiToken: string;
}

interface DshTableResumedMessage {
  type: 'DSH_TABLE_RESUMED';
  requestId: string;
  gameId: string;
  ok: boolean;
  seats?: Array<{
    seat: number;
    kind: 'human' | 'ai';
    credentialMode?: 'claim' | 'resume';
    seatCredential?: string;
    humanInviteTicket?: string;
    credentialExpiresAtMs?: number;
  }>;
  spectatorEmbedTicket?: string;
  spectatorEmbedTicketExpiresAtMs?: number;
  error?: string;
  errorCode?: string;
}

interface DshSeatJoinMessage {
  type: 'DSH_SEAT_JOIN';
  gameId: string;
  seat: number;
  seatCredential?: string;
  humanInviteTicket?: string;
  loginToken?: string;
}

interface DshSeatJoinedMessage {
  type: 'DSH_SEAT_JOINED';
  gameId: string;
  seat: number;
  kind: 'human' | 'ai';
  ok: boolean;
  // Returned only to an AI server transport after its single-use claim credential is redeemed.
  resumeCredential?: string;
  error?: string;
  errorCode?: string;
}

interface DshSpectateMessage {
  type: 'DSH_SPECTATE';
  gameId: string;
  apiToken?: string;
  spectatorEmbedTicket?: string;
}

interface DshSpectatingMessage {
  type: 'DSH_SPECTATING';
  gameId: string;
  ok: boolean;
  scope?: 'self' | 'full';
  ownerSeat?: number | null;
  error?: string;
  errorCode?: string;
}

interface NewMessage {
  type: 'NEW';
  playerId?: string;
  // Optional friend-room gameplay. Missing values keep the legacy blood-battle default.
  gameType?: FriendRoomGameType;
  // Optional friend-room waiting behavior. New friend-room entries write this at room creation.
  friendConfig?: FriendConfig;
  // Optional guobiao preferences used to initialize the creator's next hand.
  guobiaoConfig?: GuobiaoConfig;
  // Optional MJLab login token to bind this session to a userId for replays.
  loginToken?: string;
  // Optional MJLab API token (for non-browser clients like Python bots).
  apiToken?: string;
}

interface JoinMessage {
  type: 'JOIN';
  gameId: string;
  playerId?: string;
  // AI seat transports opt into a restricted view before Game.join sends state.
  // The server only honors this role when apiToken authentication succeeds.
  clientRole?: 'ai-seat';
  // Optional guobiao preference for the joining player before they pick a seat.
  guobiaoConfig?: GuobiaoConfig;
  // Optional MJLab login token to bind this session to a userId for replays.
  loginToken?: string;
  // Optional MJLab API token (for non-browser clients like Python bots).
  apiToken?: string;
}

interface JoinedMessage {
  type: 'JOINED';
  gameId: string;
  playerId: string;
  isFirst: boolean;
  authoritative?: boolean;
}

interface ActionMessage {
  type: 'ACTION';
  gameId: string;
  // Client-generated id for retry/idempotency (scoped to one game + authenticated user).
  actionId: string;
  action: any;
}

interface ActionAckMessage {
  type: 'ACTION_ACK';
  gameId: string;
  actionId: string;
  ok: boolean;
  error?: string;
  errorCode?: string;
}

interface AiSeatBindMessage {
  type: 'AI_SEAT_BIND';
  gameId: string;
  seat: number;
  modelId: string;
  modelLabel?: string | null;
}

interface AiSeatBindAckMessage {
  type: 'AI_SEAT_BIND_ACK';
  gameId: string;
  seat: number;
  ok: boolean;
  modelId?: string;
  modelLabel?: string;
  error?: string;
  errorCode?: string;
}

interface AiDecisionGetMessage {
  type: 'AI_DECISION_GET';
  gameId: string;
}

interface AiDecisionMessage {
  type: 'AI_DECISION';
  gameId: string;
  seat: number;
  decision: any | null;
}

interface AiDecisionClosedMessage {
  type: 'AI_DECISION_CLOSED';
  gameId: string;
  seat: number;
  decisionId: string;
  source: 'agent' | 'timeout_top1' | null;
  reason: 'resolved' | 'stale' | 'unavailable';
  ok: boolean;
  error?: string;
}

interface HeartbeatMessage {
  type: 'HEARTBEAT';
  nonce: string;
}

interface HeartbeatAckMessage {
  type: 'HEARTBEAT_ACK';
  nonce: string;
}

interface UpdateMessage {
  type: 'UPDATE';
  // kind, key, value
  entries: Array<Entry>;
  full: boolean;
}

interface BindUserMessage {
  type: 'BIND_USER';
  loginToken: string;
}

interface ReplayLogMessage {
  type: 'REPLAY_LOG';
  events: Array<any>;
}

interface ReplaySubscribeMessage {
  type: 'REPLAY_SUBSCRIBE';
  apiToken: string;
  gameId: string;
  shareId?: string;
  // full is reserved for the owner of an all-AI DSH table.
  scope: 'public' | 'self' | 'full';
  fromSeq?: number;
}

interface ReplaySubscribedMessage {
  type: 'REPLAY_SUBSCRIBED';
  gameId: string;
  scope: 'public' | 'self' | 'full';
  ownerSeat: number | null;
  lastSeq: number;
}

interface ReplayEventMessage {
  type: 'REPLAY_EVENT';
  gameId: string;
  event: any;
}

interface ErrorMessage {
  type: 'ERROR';
  error: string;
}

export type BloodWaitMode = FriendWaitMode;

export type BloodConfig = {
  waitMode: BloodWaitMode;
  timeoutMs?: number | null;
};

interface FriendConfigSetMessage {
  type: 'FRIEND_CONFIG_SET';
  gameId: string;
  config: FriendConfig;
}

interface FriendConfigSetAckMessage {
  type: 'FRIEND_CONFIG_SET_ACK';
  gameId: string;
  ok: boolean;
  error?: string;
  config?: FriendConfig;
}

interface BloodConfigSetMessage {
  type: 'BLOOD_CONFIG_SET';
  gameId: string;
  config: BloodConfig;
}

interface BloodConfigSetAckMessage {
  type: 'BLOOD_CONFIG_SET_ACK';
  gameId: string;
  ok: boolean;
  error?: string;
  config?: BloodConfig;
}

interface GuobiaoConfigSetMessage {
  type: 'GUOBIAO_CONFIG_SET';
  gameId: string;
  config: GuobiaoConfig;
}

interface GuobiaoConfigSetAckMessage {
  type: 'GUOBIAO_CONFIG_SET_ACK';
  gameId: string;
  ok: boolean;
  error?: string;
  config?: GuobiaoConfig;
}

export type AiScene = 'swap3' | 'dingque' | 'turn' | 'claim';

export type AiFollowupMode = 'strict' | 'free';

export type AiModelInfo = {
  id: string;
  label?: string;
  hint?: string;
};

export type AiTemplate = {
  id: string;
  scene: AiScene;
  name: string;
  model: string;
  body: string;
  isDefault: boolean;
  lastUsedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export type AiHistoryItem = {
  requestId: string;
  clientRequestId?: string | null;
  gameId: string;
  scene: AiScene;
  snapshotId: string;
  kind: 'recommend' | 'followup';
  ok: boolean;
  error?: string;
  model: string;
  prompt: string;
  stateBlock: string;
  response: string;
  parsed?: any;
  at: number;
};

interface AiTemplatesGetMessage {
  type: 'AI_TEMPLATES_GET';
}

interface AiTemplatesMessage {
  type: 'AI_TEMPLATES';
  templates: Array<AiTemplate>;
  models: Array<AiModelInfo>;
}

interface AiTemplateSaveMessage {
  type: 'AI_TEMPLATE_SAVE';
  mode: 'create' | 'update' | 'clone';
  template: Partial<Pick<AiTemplate, 'id'>> & Pick<AiTemplate, 'scene' | 'name' | 'model' | 'body'>;
  setDefault?: boolean;
}

interface AiTemplateSavedMessage {
  type: 'AI_TEMPLATE_SAVED';
  template: AiTemplate;
}

interface AiTemplateDeleteMessage {
  type: 'AI_TEMPLATE_DELETE';
  templateId: string;
}

interface AiTemplateDeletedMessage {
  type: 'AI_TEMPLATE_DELETED';
  templateId: string;
}

interface AiTemplateSetDefaultMessage {
  type: 'AI_TEMPLATE_SET_DEFAULT';
  scene: AiScene;
  templateId: string | null;
}

interface AiTemplateDefaultSetMessage {
  type: 'AI_TEMPLATE_DEFAULT_SET';
  scene: AiScene;
  templateId: string | null;
}

interface AiHistoryGetMessage {
  type: 'AI_HISTORY_GET';
  gameId: string;
}

interface AiHistoryMessage {
  type: 'AI_HISTORY';
  gameId: string;
  items: Array<AiHistoryItem>;
}

interface AiRecommendMessage {
  type: 'AI_RECOMMEND';
  clientRequestId?: string | null;
  gameId: string;
  scene: AiScene;
  templateId?: string | null;
  model?: string | null;
  prompt: string;
}

interface AiFollowupMessage {
  type: 'AI_FOLLOWUP';
  clientRequestId?: string | null;
  gameId: string;
  scene: AiScene;
  snapshotId: string;
  followupMode?: AiFollowupMode | null;
  model?: string | null;
  prompt: string;
  question: string;
}

interface AiPreviewGetMessage {
  type: 'AI_PREVIEW_GET';
  gameId: string;
  scene: AiScene;
  kind: 'recommend' | 'followup';
  snapshotId?: string | null;
  model?: string | null;
  prompt: string;
  question?: string | null;
}

interface AiPreviewMessage {
  type: 'AI_PREVIEW';
  gameId: string;
  scene: AiScene;
  kind: 'recommend' | 'followup';
  snapshotId: string;
  model: string;
  prompt: string;
  stateBlock: string;
  at: number;
}

interface AiResultMessage {
  type: 'AI_RESULT';
  item: AiHistoryItem;
}

interface AiDeltaMessage {
  type: 'AI_DELTA';
  clientRequestId?: string | null;
  delta: string;
}

interface AiErrorMessage {
  type: 'AI_ERROR';
  error: string;
  clientRequestId?: string | null;
}

export type Entry = [string, string | number, any | null];

export type Message = NewMessage
  | DshTableCreateMessage
  | DshTableCreatedMessage
  | DshTableResumeMessage
  | DshTableResumedMessage
  | DshSeatJoinMessage
  | DshSeatJoinedMessage
  | DshSpectateMessage
  | DshSpectatingMessage
  | JoinMessage
  | JoinedMessage
  | ActionMessage
  | ActionAckMessage
  | AiSeatBindMessage
  | AiSeatBindAckMessage
  | AiDecisionGetMessage
  | AiDecisionMessage
  | AiDecisionClosedMessage
  | HeartbeatMessage
  | HeartbeatAckMessage
  | UpdateMessage
  | BindUserMessage
  | ReplayLogMessage
  | ReplaySubscribeMessage
  | ReplaySubscribedMessage
  | ReplayEventMessage
  | ErrorMessage
  | FriendConfigSetMessage
  | FriendConfigSetAckMessage
  | BloodConfigSetMessage
  | BloodConfigSetAckMessage
  | GuobiaoConfigSetMessage
  | GuobiaoConfigSetAckMessage
  | AiTemplatesGetMessage
  | AiTemplatesMessage
  | AiTemplateSaveMessage
  | AiTemplateSavedMessage
  | AiTemplateDeleteMessage
  | AiTemplateDeletedMessage
  | AiTemplateSetDefaultMessage
  | AiTemplateDefaultSetMessage
  | AiHistoryGetMessage
  | AiHistoryMessage
  | AiRecommendMessage
  | AiFollowupMessage
  | AiPreviewGetMessage
  | AiPreviewMessage
  | AiDeltaMessage
  | AiResultMessage
  | AiErrorMessage;
