import type { AiHistoryItem, AiScene, AiTemplate } from '../server/protocol';
import type { BloodState } from './blood';
import type { AiPref, AiProfilePublic } from './ai-settings-api';
import { fetchAiSettings, resolveEffectiveAiModelLabel } from './ai-settings-api';
import { fetchAiTemplates, requestPaipuAiRecommend, type PaipuAiSnapshot } from './paipu-api';
import type { Client } from './client';
import type { World } from './world';
import { createHudLucideIcon } from './hud-lucide';

type SceneLabel = { scene: AiScene; label: string };
type ReplayAiContext = {
  gameId: string;
  shareId: string | null;
  getEventIndex?: (() => number | null) | null;
};

const SCENE_LABELS: Array<SceneLabel> = [
  { scene: 'swap3', label: '换三张' },
  { scene: 'dingque', label: '定缺' },
  { scene: 'turn', label: '轮到你' },
  { scene: 'claim', label: '碰/杠/胡' },
];

const DEFAULT_HISTORY_TAKE = 30;
const HISTORY_PAGE_SIZE = 30;
const AI_INFLIGHT_TIMEOUT_MS = 600_000;
const HOSTED_AI_INFLIGHT_TIMEOUT_MS = 20_000;

const FOLLOWUP_EXPLAIN_TEMPLATE = `你是血战到底麻将教练，请用“跟玩家聊天”的口吻答疑（简短、口语化、别写长篇分析）。

规则（MJLab 血战到底·权威模式，来自 BLOOD_RULES.md）：
{{BLOOD_RULES}}

你刚刚在【同一局面】做过一次荐牌，现在用户对那次荐牌提出追问。

【上一条荐牌结果】（这是你要解释的对象）：
{{LAST_RECOMMEND}}

【用户追问】：
{{QUESTION}}

任务：
1) 只解释“为什么上一条会这样推荐”，并直接回答用户追问。
2) 不要重新给新的荐牌建议；不要输出 JSON；不要输出 action_id 或 action_index。
3) 若发现上一条荐牌结果与 allowed_actions 不一致或局面已变化：说明原因，并提示“请重新荐牌”。
4) 若用户问到 risk_raw：请说明它来自哪些因素（至少提到牌效风险/点炮风险/明杠风险中的相关项），并说明与 gain_raw、ev_raw 的关系（ev_raw≈gain_raw-risk_raw_effective）。

强约束（务必遵守）：
- 不要复述整段规则/整段状态块/整手牌；不要写“分析如下/当前状态/状态块”等元话术。
- 每条要点只写 1 句话，尽量短（像教练一句话点拨）。

输出格式（必须严格按这个结构）：
结论：<一句话>
1) <一句话>
2) <一句话>
3) <可选，一句话>
4) <可选，一句话>

{{STATE_BLOCK}}`;

const RISK_EXPLAIN_QUESTION = '请结合上一条荐牌，解释 risk_raw 是怎么计算出来的，并说明它与 gain_raw、ev_raw 的关系。';

type ParsedMetrics = {
  riskRaw: number | null;
  gainRaw: number | null;
  evRaw: number | null;
};

function sceneLabel(scene: AiScene): string {
  return SCENE_LABELS.find((x) => x.scene === scene)?.label ?? scene;
}

function isDingqueCommitted(player: { dingque: BloodState['players'][number]['dingque']; dingqueReady?: boolean } | null | undefined): boolean {
  if (!player) return false;
  return player.dingqueReady === true || player.dingque !== null;
}

function computeAiScene(blood: BloodState, seat: number): AiScene | null {
  const me = blood.players?.[seat] ?? null;
  if (!me || me.hu) return null;

  if (blood.phase === 'swap3') {
    const swap3 = blood.swap3 ?? null;
    if (!swap3 || swap3.animatingSince !== null) return null;
    const picked = swap3.selections?.[seat] ?? null;
    return picked === null ? 'swap3' : null;
  }

  if (blood.phase === 'dingque') {
    return isDingqueCommitted(me) ? null : 'dingque';
  }

  if (blood.phase === 'playing') {
    const pending = blood.pending;
    if (pending && pending.kind === 'claim') {
      if (seat === pending.fromSeat) return null;
      if (pending.responses?.[seat] !== null) return null;
      const opt = pending.options?.[seat] ?? null;
      if (!opt || (!opt.hu && !opt.peng && !opt.gang)) return null;
      return 'claim';
    }
    if (pending === null && blood.turnSeat === seat && blood.turnStep === 'discard' && me.dingque !== null) {
      return 'turn';
    }
  }

  return null;
}

function computeAiDecisionKey(blood: BloodState, seat: number, scene: AiScene): string {
  const me = blood.players?.[seat] ?? null;
  const dingque = me?.dingque ?? null;
  const pendingId = (blood as any)?.pending?.id ?? null;
  const swapSince = (blood as any)?.swap3?.since ?? null;
  const swapAnimating = (blood as any)?.swap3?.animatingSince ?? null;
  return [
    'mjlab.ai.snapshot.v1',
    `scene=${scene}`,
    `phase=${blood.phase}`,
    `turnSeat=${blood.turnSeat}`,
    `turnStep=${blood.turnStep}`,
    `pendingId=${pendingId}`,
    `swapSince=${swapSince}`,
    `swapAnim=${swapAnimating}`,
    `dingque=${dingque ?? ''}`,
    `hu=${me?.hu ? 1 : 0}`,
    `wallIndex=${blood.wallIndex}`,
    `nextId=${blood.nextId}`,
  ].join('|');
}

function isFiniteInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && Math.trunc(v) === v;
}

function validateHostedAction(
  scene: AiScene,
  action: unknown,
  blood: BloodState,
  seat: number
): { ok: true; action: any } | { ok: false; reason: string } {
  if (!action || typeof action !== 'object') {
    return { ok: false, reason: 'AI 返回的 action 不是对象' };
  }
  const kind = (action as any).kind;
  if (typeof kind !== 'string') {
    return { ok: false, reason: 'AI 返回的 action.kind 非法' };
  }

  if (scene === 'swap3') {
    if (kind !== 'swap3') return { ok: false, reason: `AI action.kind 不匹配当前场景（期望 swap3，得到 ${kind}）` };
    const tileIds = (action as any).tileIds;
    if (!Array.isArray(tileIds)) return { ok: false, reason: 'AI swap3.tileIds 非法（期望数组）' };
    const ids = tileIds.filter(isFiniteInt);
    if (ids.length !== 3) return { ok: false, reason: 'AI swap3.tileIds 非法（期望 3 个 tileId）' };
    if (new Set(ids).size !== 3) return { ok: false, reason: 'AI swap3.tileIds 非法（tileId 重复）' };
    return { ok: true, action };
  }

  if (scene === 'dingque') {
    if (kind !== 'dingque') return { ok: false, reason: `AI action.kind 不匹配当前场景（期望 dingque，得到 ${kind}）` };
    const suit = (action as any).suit;
    if (suit !== 'm' && suit !== 'p' && suit !== 's') return { ok: false, reason: 'AI dingque.suit 非法（期望 m/p/s）' };
    return { ok: true, action };
  }

  if (scene === 'turn') {
    if (kind === 'discard') {
      const tileId = (action as any).tileId;
      if (!isFiniteInt(tileId)) return { ok: false, reason: 'AI discard.tileId 非法（期望整数）' };
      return { ok: true, action };
    }
    if (kind === 'hu') {
      const source = (action as any).source;
      if (source !== 'self') return { ok: false, reason: 'AI hu.source 非法（期望 self）' };
      return { ok: true, action };
    }
    if (kind === 'kong') {
      const gt = (action as any).gangType;
      if (gt !== 'an' && gt !== 'add') return { ok: false, reason: 'AI kong.gangType 非法（期望 an/add）' };
      const tileKey = (action as any).tileKey;
      if (!isFiniteInt(tileKey)) return { ok: false, reason: 'AI kong.tileKey 非法（期望整数）' };
      if (tileKey < 0 || tileKey >= 27) return { ok: false, reason: 'AI kong.tileKey 非法（期望 0..26）' };
      return { ok: true, action };
    }
    return { ok: false, reason: `AI action.kind 不匹配当前场景（期望 discard/hu/kong，得到 ${kind}）` };
  }

  if (scene === 'claim') {
    if (kind !== 'claim') return { ok: false, reason: `AI action.kind 不匹配当前场景（期望 claim，得到 ${kind}）` };
    const pendingId = (action as any).pendingId;
    if (!isFiniteInt(pendingId)) return { ok: false, reason: 'AI claim.pendingId 非法（期望整数）' };
    const pending = blood.pending;
    if (!pending || pending.kind !== 'claim') return { ok: false, reason: '当前不在 claim 场景（pending 缺失）' };
    if (pendingId !== pending.id) return { ok: false, reason: 'AI claim.pendingId 与当前 pending 不一致（结果过期）' };
    const act = (action as any).action;
    if (act !== 'hu' && act !== 'peng' && act !== 'gang' && act !== 'pass') {
      return { ok: false, reason: 'AI claim.action 非法（期望 hu/peng/gang/pass）' };
    }
    if (act !== 'pass') {
      const opt = pending.options?.[seat] ?? null;
      const allowed = act === 'hu' ? !!opt?.hu : act === 'peng' ? !!opt?.peng : !!opt?.gang;
      if (!allowed) return { ok: false, reason: `AI 返回了不可用动作：${act}` };
    }
    return { ok: true, action };
  }

  return { ok: false, reason: `未知场景：${scene}` };
}

function pickDefaultTemplate(templates: Array<AiTemplate>, scene: AiScene): AiTemplate | null {
  const inScene = templates.filter((t) => t.scene === scene);
  if (inScene.length === 0) return null;
  const explicit = inScene.find((t) => t.isDefault);
  if (explicit) return explicit;
  let best: AiTemplate | null = null;
  for (const t of inScene) {
    if (t.lastUsedAt === null) continue;
    if (!best || (best.lastUsedAt ?? 0) < t.lastUsedAt) {
      best = t;
    }
  }
  return best ?? inScene[0] ?? null;
}

function formatTime(ms: number): string {
  try {
    const d = new Date(ms);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  } catch {
    return String(ms);
  }
}

function formatParsedSummary(parsed: any): string | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const action = (parsed as any).action;
  const reason = typeof (parsed as any).reason === 'string' ? (parsed as any).reason.trim() : '';
  const metrics = extractParsedMetrics(parsed);
  const metricsText = hasAnyParsedMetric(metrics) ? `；${formatParsedMetricsLine(metrics)}` : '';
  if (!action || typeof action !== 'object') return reason ? `理由：${reason}` : null;
  const kind = String((action as any).kind ?? '');
  if (!kind) return reason ? `理由：${reason}` : null;
  if (kind === 'discard') {
    const tile = (action as any).tile ?? null;
    const tileId = (action as any).tileId ?? null;
    const head = tile ? `建议：出 ${tile}` : tileId ? `建议：出 tileId=${tileId}` : '建议：出牌';
    return reason ? `${head}（${reason}）${metricsText}` : `${head}${metricsText}`;
  }
  if (kind === 'dingque') {
    const suit = (action as any).suit ?? null;
    const head = suit ? `建议：定缺 ${suit}` : '建议：定缺';
    return reason ? `${head}（${reason}）${metricsText}` : `${head}${metricsText}`;
  }
  if (kind === 'swap3') {
    const tiles = Array.isArray((action as any).tiles) ? (action as any).tiles.join(' ') : '';
    const head = tiles ? `建议：换出 ${tiles}` : '建议：换三张';
    return reason ? `${head}（${reason}）${metricsText}` : `${head}${metricsText}`;
  }
  if (kind === 'claim') {
    const a = (action as any).action ?? null;
    const head = a ? `建议：${a}` : '建议：响应';
    return reason ? `${head}（${reason}）${metricsText}` : `${head}${metricsText}`;
  }
  if (kind === 'kong') {
    const tile = (action as any).tile ?? null;
    const gt = (action as any).gangType ?? null;
    const head = `建议：${gt ?? '杠'}${tile ? ' ' + tile : ''}`;
    return reason ? `${head}（${reason}）${metricsText}` : `${head}${metricsText}`;
  }
  if (kind === 'hu') {
    const head = '建议：自摸胡';
    return reason ? `${head}（${reason}）${metricsText}` : `${head}${metricsText}`;
  }
  return reason ? `建议：${kind}（${reason}）${metricsText}` : `建议：${kind}${metricsText}`;
}

function formatParsedAction(action: any): string {
  if (!action || typeof action !== 'object' || Array.isArray(action)) return '建议';
  const kind = String((action as any).kind ?? '').trim();
  const suitLabel = (s: any): string => {
    if (s === 'm') return '万';
    if (s === 'p') return '筒';
    if (s === 's') return '条';
    return String(s ?? '');
  };
  if (kind === 'discard') {
    const tile = (action as any).tile ?? null;
    const tileId = (action as any).tileId ?? null;
    if (tile) return `出 ${tile}`;
    if (tileId !== null && tileId !== undefined) return `出 tileId=${tileId}`;
    return '出牌';
  }
  if (kind === 'dingque') {
    const suit = (action as any).suit ?? null;
    return suit ? `定缺 ${suitLabel(suit)}` : '定缺';
  }
  if (kind === 'swap3') {
    const tiles = Array.isArray((action as any).tiles) ? (action as any).tiles.join(' ') : '';
    return tiles ? `换三张 ${tiles}` : '换三张';
  }
  if (kind === 'kong') {
    const tile = (action as any).tile ?? null;
    const gt = String((action as any).gangType ?? '').trim();
    const head = gt === 'an' ? '暗杠' : gt === 'add' ? '加杠' : '杠';
    return tile ? `${head} ${tile}` : head;
  }
  if (kind === 'hu') {
    return '胡';
  }
  if (kind === 'claim') {
    const a = String((action as any).action ?? '').trim();
    if (a === 'pass') return '过';
    if (a === 'hu') return '胡';
    if (a === 'gang') return '杠';
    if (a === 'peng') return '碰';
    return a ? `响应 ${a}` : '响应';
  }
  return kind || '建议';
}

function toFiniteNumber(value: any): number | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return Number(value);
  }
  if (typeof value === 'string') {
    const s = value.trim();
    if (!s) return null;
    const n = Number(s);
    if (!Number.isFinite(n)) return null;
    return n;
  }
  return null;
}

function firstFiniteNumber(source: any, keys: Array<string>): number | null {
  if (!source || typeof source !== 'object') return null;
  for (const key of keys) {
    if (!(key in source)) continue;
    const n = toFiniteNumber((source as any)[key]);
    if (n !== null) return n;
  }
  return null;
}

function extractParsedMetrics(parsed: any): ParsedMetrics {
  if (!parsed || typeof parsed !== 'object') {
    return { riskRaw: null, gainRaw: null, evRaw: null };
  }
  const nested = (parsed as any).metrics;
  const riskRaw = firstFiniteNumber(parsed, ['risk_raw', 'riskRaw']) ?? firstFiniteNumber(nested, ['risk_raw', 'riskRaw']);
  const gainRaw = firstFiniteNumber(parsed, ['gain_raw', 'gainRaw']) ?? firstFiniteNumber(nested, ['gain_raw', 'gainRaw']);
  const evRaw = firstFiniteNumber(parsed, ['ev_raw', 'evRaw']) ?? firstFiniteNumber(nested, ['ev_raw', 'evRaw']);
  return { riskRaw, gainRaw, evRaw };
}

function hasAnyParsedMetric(metrics: ParsedMetrics): boolean {
  return metrics.riskRaw !== null || metrics.gainRaw !== null || metrics.evRaw !== null;
}

function hasParsedMetricsInHistoryItem(item: AiHistoryItem | null | undefined): boolean {
  if (!item || item.kind !== 'recommend' || !item.ok) return false;
  if (!item.parsed || typeof item.parsed !== 'object') return false;
  return hasAnyParsedMetric(extractParsedMetrics(item.parsed));
}

function formatBeanValue(value: number | null): string {
  if (value === null) return '--';
  if (!Number.isFinite(value)) return '--';
  const rounded = Math.round(value * 100) / 100;
  const n = Object.is(rounded, -0) ? 0 : rounded;
  const prefix = n > 0 ? '+' : '';
  return `${prefix}${n}`;
}

function formatParsedMetricsLine(metrics: ParsedMetrics): string {
  return `risk_raw：${formatBeanValue(metrics.riskRaw)} 豆 · gain_raw：${formatBeanValue(metrics.gainRaw)} 豆 · ev_raw：${formatBeanValue(metrics.evRaw)} 豆`;
}

function normalizeClientRequestId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  return s ? s : null;
}

function computeHandViewportRatio(viewportRatio: number): number {
  if (viewportRatio >= 2.5) return 0.15;
  if (viewportRatio >= 2.0) return 0.17;
  if (viewportRatio >= 1.8) return 0.19;
  return 0.21;
}

export class BloodAiOverlay {
  private client: Client;
  private world: World;
  private root: HTMLElement;
  private anchorBtn: HTMLButtonElement;
  private onClose: () => void;
  private replayAiContext: ReplayAiContext | null = null;

  private open = false;
  private scene: AiScene | null = null;
  private lastSnapshotId: string | null = null;
  private followupOpen = false;
  private followupExplain = false;
  private statusText = '';
  private activeInflightClientRequestId: string | null = null;
  private inflightKind: 'manual' | 'hosted' | null = null;
  private clientRequestSeq = 0;
  private inflightStartedAtMs: number | null = null;
  private inflightTicker: number | null = null;
  private inflightTimeoutTimer: number | null = null;

  private readerOpen = false;

  private templates: Array<AiTemplate> = [];
  private history: Array<AiHistoryItem> = [];
  private historyTake = DEFAULT_HISTORY_TAKE;

  private aiProfiles: Array<AiProfilePublic> = [];
  private aiDefault: AiPref = { source: 'official', profileId: null };
  private aiRoom: AiPref | null = null;
  private aiEffective: AiPref = { source: 'official', profileId: null };
  private aiOfficial: { model: string; points: number; enabled: boolean; canUse: boolean; configured: boolean } = {
    model: 'gpt-5.2',
    points: 0,
    enabled: false,
    canUse: false,
    configured: false,
  };
  private aiModelIds: Array<string> = [];
  private aiSettingsReqSeq = 0;
  private aiSettingsInFlight: { gameId: string; seq: number } | null = null;
  private aiSettingsError: string | null = null;

  private panel: HTMLDivElement;
  private bodyEl: HTMLDivElement;
  private bodyScrollDrag: { pointerId: number; startY: number; startScrollTop: number; capturing: boolean } | null = null;
  private collapseBtn: HTMLButtonElement;
  private sendBtn: HTMLButtonElement;
  private templateSelect: HTMLSelectElement;

  private openReaderBtn: HTMLButtonElement;
  private readerBackdropEl: HTMLDivElement;
  private readerEl: HTMLDivElement;
  private readerTitleEl: HTMLDivElement;
  private readerBodyEl: HTMLDivElement;

  private resultEl: HTMLDivElement;
  private resultActionEl: HTMLDivElement;
  private resultReasonEl: HTMLDivElement;
  private resultMetricsEl: HTMLDivElement;
  private resultDetailsEl: HTMLDetailsElement;
  private resultRawResponsePre: HTMLPreElement;
  private resultRawPromptPre: HTMLPreElement;

  private questionInput: HTMLInputElement;
  private followupBtn: HTMLButtonElement;
  private followupExplainLabel: HTMLLabelElement;
  private followupExplainInput: HTMLInputElement;
  private followupRiskBtn: HTMLButtonElement;

  private modelEl: HTMLDivElement;

  private historySectionEl: HTMLDivElement;
  private historyBodyEl: HTMLDivElement;
  private historyInfoEl: HTMLDivElement;
  private historyMoreBtn: HTMLButtonElement;
  private historyAllBtn: HTMLButtonElement;
  private historyEl: HTMLDivElement;

  private selectedTemplateId: string | null = null;

  private hostedEnabled = false;
  private hostedRequestedDecisionKey: string | null = null;
  private hostedLastActedDecisionKey: string | null = null;
  private hostedPendingActionIds: Set<string> = new Set();
  private hostedToggleLabel: HTMLLabelElement;
  private hostedToggleInput: HTMLInputElement;
  private templatesLoaded = false;
  private aiSettingsLoaded = false;
  private replayTemplatesReqSeq = 0;

  private onHostedChange: ((enabled: boolean, reason?: string) => void) | null = null;

  constructor(params: {
    client: Client;
    world: World;
    root: HTMLElement;
    anchorBtn: HTMLButtonElement;
    onClose: () => void;
    onHostedChange?: (enabled: boolean, reason?: string) => void;
  }) {
    this.client = params.client;
    this.world = params.world;
    this.root = params.root;
    this.anchorBtn = params.anchorBtn;
    this.onClose = params.onClose;
    this.onHostedChange = params.onHostedChange ?? null;

    const stop = (e: Event) => e.stopPropagation();

    this.panel = document.createElement('div');
    this.panel.className = 'ai-panel';
    this.panel.style.display = 'none';
    // Prevent underlying game interactions when interacting with the AI panel.
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'click', 'wheel'] as const) {
      this.panel.addEventListener(type, stop);
    }
    this.root.appendChild(this.panel);

    const topbar = document.createElement('div');
    topbar.className = 'ai-topbar';
    this.panel.appendChild(topbar);

    this.bodyEl = document.createElement('div');
    this.bodyEl.className = 'ai-body';
    this.panel.appendChild(this.bodyEl);

    // /hand/ 的舞台层会禁用原生 touch scroll（`#main { touch-action: none; }`），
    // 因此在 AI 面板内为触摸设备提供“拖动滚动”兜底（不影响桌面滚轮滚动）。
    const isScrollDragBlockedTarget = (target: EventTarget | null): boolean => {
      const el = target instanceof HTMLElement ? target : null;
      if (!el) return false;
      // Interactive elements should keep native interactions (click/focus/caret/selection).
      return !!el.closest('button, input, textarea, select, summary, details, a');
    };
    const clearBodyScrollDrag = (): void => {
      if (!this.bodyScrollDrag) return;
      const pointerId = this.bodyScrollDrag.pointerId;
      this.bodyScrollDrag = null;
      try {
        this.bodyEl.releasePointerCapture(pointerId);
      } catch {
        // ignore
      }
    };
    this.bodyEl.addEventListener('pointerdown', (event: PointerEvent) => {
      if (event.pointerType !== 'touch') return;
      if (this.bodyScrollDrag) return;
      if (isScrollDragBlockedTarget(event.target)) return;
      this.bodyScrollDrag = {
        pointerId: event.pointerId,
        startY: event.clientY,
        startScrollTop: this.bodyEl.scrollTop,
        capturing: false,
      };
    });
    this.bodyEl.addEventListener(
      'pointermove',
      (event: PointerEvent) => {
        const drag = this.bodyScrollDrag;
        if (!drag) return;
        if (event.pointerType !== 'touch' || event.pointerId !== drag.pointerId) return;
        const dy = event.clientY - drag.startY;
        if (!drag.capturing) {
          if (Math.abs(dy) < 6) return;
          drag.capturing = true;
          try {
            this.bodyEl.setPointerCapture(drag.pointerId);
          } catch {
            // ignore
          }
        }
        this.bodyEl.scrollTop = drag.startScrollTop - dy;
        event.preventDefault();
      },
      { passive: false }
    );
    this.bodyEl.addEventListener('pointerup', (event: PointerEvent) => {
      const drag = this.bodyScrollDrag;
      if (!drag) return;
      if (event.pointerType !== 'touch' || event.pointerId !== drag.pointerId) return;
      clearBodyScrollDrag();
    });
    this.bodyEl.addEventListener('pointercancel', (event: PointerEvent) => {
      const drag = this.bodyScrollDrag;
      if (!drag) return;
      if (event.pointerType !== 'touch' || event.pointerId !== drag.pointerId) return;
      clearBodyScrollDrag();
    });

    this.collapseBtn = document.createElement('button');
    this.collapseBtn.type = 'button';
    this.collapseBtn.className = 'ai-icon-btn';
    this.collapseBtn.appendChild(createHudLucideIcon('x'));
    this.collapseBtn.onclick = () => this.setOpen(false);
    topbar.appendChild(this.collapseBtn);

    this.sendBtn = document.createElement('button');
    this.sendBtn.type = 'button';
    this.sendBtn.className = 'ai-btn primary ai-send-btn';
    this.sendBtn.textContent = '发送';
    this.sendBtn.onclick = () => this.onSend();
    topbar.appendChild(this.sendBtn);

    this.followupBtn = document.createElement('button');
    this.followupBtn.type = 'button';
    this.followupBtn.className = 'ai-btn';
    this.followupBtn.textContent = '追问';
    this.followupBtn.onclick = () => this.toggleFollowup();
    topbar.appendChild(this.followupBtn);

    this.templateSelect = document.createElement('select');
    this.templateSelect.className = 'ai-select ai-template-select';
    this.templateSelect.onchange = () => {
      this.selectedTemplateId = this.templateSelect.value || null;
      this.followupOpen = false;
      this.questionInput.value = '';
      this.questionInput.style.display = 'none';
      this.render();
    };
    topbar.appendChild(this.templateSelect);

    this.hostedToggleLabel = document.createElement('label');
    this.hostedToggleLabel.className = 'ai-hosted-toggle';
    this.hostedToggleInput = document.createElement('input');
    this.hostedToggleInput.type = 'checkbox';
    this.hostedToggleInput.className = 'ai-hosted-check';
    this.hostedToggleInput.checked = this.hostedEnabled;
    this.hostedToggleInput.onchange = () => {
      this.setHosted(this.hostedToggleInput.checked, this.hostedToggleInput.checked ? '用户开启托管' : '用户取消托管');
    };
    this.hostedToggleLabel.appendChild(this.hostedToggleInput);
    const hostedText = document.createElement('span');
    hostedText.className = 'ai-hosted-text';
    hostedText.textContent = '托管';
    this.hostedToggleLabel.appendChild(hostedText);
    topbar.appendChild(this.hostedToggleLabel);

    this.resultEl = document.createElement('div');
    this.resultEl.className = 'ai-result';
    this.bodyEl.appendChild(this.resultEl);

    this.resultActionEl = document.createElement('div');
    this.resultActionEl.className = 'ai-result-action';
    this.resultEl.appendChild(this.resultActionEl);

    this.resultReasonEl = document.createElement('div');
    this.resultReasonEl.className = 'ai-result-reason';
    this.resultEl.appendChild(this.resultReasonEl);

    this.resultMetricsEl = document.createElement('div');
    this.resultMetricsEl.className = 'ai-result-metrics';
    this.resultMetricsEl.textContent = '';
    this.resultMetricsEl.style.display = 'none';
    this.resultEl.appendChild(this.resultMetricsEl);

    const resultTools = document.createElement('div');
    resultTools.className = 'ai-result-tools';
    this.resultEl.appendChild(resultTools);

    this.openReaderBtn = document.createElement('button');
    this.openReaderBtn.type = 'button';
    this.openReaderBtn.className = 'ai-btn ai-open-reader';
    this.openReaderBtn.textContent = '查看全文';
    this.openReaderBtn.onclick = () => this.setReaderOpen(true);
    resultTools.appendChild(this.openReaderBtn);

    this.resultDetailsEl = document.createElement('details');
    this.resultDetailsEl.className = 'ai-details ai-raw-details';
    this.resultDetailsEl.style.display = 'none';
    this.resultEl.appendChild(this.resultDetailsEl);

    const rawSummary = document.createElement('summary');
    rawSummary.textContent = '展开原始信息';
    this.resultDetailsEl.appendChild(rawSummary);

    const rawRespLabel = document.createElement('div');
    rawRespLabel.className = 'ai-raw-label';
    rawRespLabel.textContent = '原始响应';
    this.resultDetailsEl.appendChild(rawRespLabel);

    this.resultRawResponsePre = document.createElement('pre');
    this.resultRawResponsePre.textContent = '';
    this.resultDetailsEl.appendChild(this.resultRawResponsePre);

    const rawPromptLabel = document.createElement('div');
    rawPromptLabel.className = 'ai-raw-label';
    rawPromptLabel.textContent = '发送给模型';
    this.resultDetailsEl.appendChild(rawPromptLabel);

    this.resultRawPromptPre = document.createElement('pre');
    this.resultRawPromptPre.textContent = '';
    this.resultDetailsEl.appendChild(this.resultRawPromptPre);

    const followup = document.createElement('div');
    followup.className = 'ai-followup';
    this.bodyEl.appendChild(followup);

    this.questionInput = document.createElement('input');
    this.questionInput.className = 'ai-input ai-followup-input';
    this.questionInput.placeholder = '请输入追问内容…';
    this.questionInput.style.display = 'none';
    followup.appendChild(this.questionInput);

    this.followupExplainLabel = document.createElement('label');
    this.followupExplainLabel.className = 'ai-followup-explain';
    this.followupExplainLabel.style.display = 'none';
    followup.appendChild(this.followupExplainLabel);

    this.followupExplainInput = document.createElement('input');
    this.followupExplainInput.type = 'checkbox';
    this.followupExplainInput.className = 'ai-followup-explain-check';
    this.followupExplainInput.checked = this.followupExplain;
    this.followupExplainInput.onchange = () => {
      this.followupExplain = this.followupExplainInput.checked;
      this.render();
    };
    this.followupExplainLabel.appendChild(this.followupExplainInput);

    const followupExplainText = document.createElement('span');
    followupExplainText.textContent = '解释上次荐牌';
    this.followupExplainLabel.appendChild(followupExplainText);

    this.followupRiskBtn = document.createElement('button');
    this.followupRiskBtn.type = 'button';
    this.followupRiskBtn.className = 'ai-btn ai-followup-risk-btn';
    this.followupRiskBtn.textContent = '追问：risk_raw 怎么来的';
    this.followupRiskBtn.onclick = () => this.askRiskExplain();
    followup.appendChild(this.followupRiskBtn);

    this.modelEl = document.createElement('div');
    this.modelEl.className = 'ai-model';
    this.bodyEl.appendChild(this.modelEl);

    this.historySectionEl = document.createElement('div');
    this.historySectionEl.className = 'ai-history-section';
    this.bodyEl.appendChild(this.historySectionEl);

    const historyHead = document.createElement('div');
    historyHead.className = 'ai-history-head';
    this.historySectionEl.appendChild(historyHead);

    const historyTitle = document.createElement('div');
    historyTitle.className = 'ai-history-title';
    historyTitle.textContent = '对话历史';
    historyHead.appendChild(historyTitle);

    this.historyInfoEl = document.createElement('div');
    this.historyInfoEl.className = 'ai-history-info';
    this.historyInfoEl.setAttribute('role', 'button');
    this.historyInfoEl.tabIndex = 0;
    const openReader = () => {
      if (!this.open) return;
      if (!this.historyInfoEl.classList.contains('clickable')) return;
      this.setReaderOpen(true);
    };
    this.historyInfoEl.onclick = () => openReader();
    this.historyInfoEl.onkeydown = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      openReader();
    };
    historyHead.appendChild(this.historyInfoEl);

    this.historyMoreBtn = document.createElement('button');
    this.historyMoreBtn.type = 'button';
    this.historyMoreBtn.className = 'ai-btn';
    this.historyMoreBtn.textContent = '更多';
    this.historyMoreBtn.onclick = () => this.loadMoreHistory();
    historyHead.appendChild(this.historyMoreBtn);

    this.historyAllBtn = document.createElement('button');
    this.historyAllBtn.type = 'button';
    this.historyAllBtn.className = 'ai-btn';
    this.historyAllBtn.textContent = '最早';
    this.historyAllBtn.onclick = () => this.showAllHistory();
    historyHead.appendChild(this.historyAllBtn);

    this.historyBodyEl = document.createElement('div');
    this.historyBodyEl.className = 'ai-history-body';
    this.historySectionEl.appendChild(this.historyBodyEl);

    this.historyEl = document.createElement('div');
    this.historyEl.className = 'ai-history';
    this.historyBodyEl.appendChild(this.historyEl);

    this.client.on('aiTemplates', (msg) => {
      this.templatesLoaded = true;
      this.templates = Array.isArray(msg.templates) ? msg.templates : [];
      this.render();
      this.maybeRequestHosted();
    });
    this.client.on('aiTemplateSaved', (msg) => {
      const t = msg.template;
      this.templates = [...this.templates.filter((x) => x.id !== t.id), t];
      this.render();
    });
    this.client.on('aiTemplateDeleted', (msg) => {
      this.templates = this.templates.filter((t) => t.id !== msg.templateId);
      if (this.selectedTemplateId === msg.templateId) {
        this.selectedTemplateId = null;
      }
      this.render();
    });
    this.client.on('aiTemplateDefaultSet', (_msg) => {
      this.client.aiGetTemplates();
    });
    this.client.on('aiHistory', (msg) => {
      const items = Array.isArray(msg.items) ? msg.items : [];
      // Newest first for easier scanning on mobile.
      this.history = items.slice().sort((a, b) => b.at - a.at);
      this.lastSnapshotId = this.pickLatestSnapshotIdForCurrentScene();
      this.render();
    });
    this.client.on('aiResult', (msg) => {
      const item = msg.item;
      const incomingClientRequestId = normalizeClientRequestId((item as any)?.clientRequestId);
      const inflightEnded = this.isInflight() && this.isInflightForClientRequest(incomingClientRequestId);
      if (!this.isInflight()) {
        this.statusText = '';
      } else if (inflightEnded) {
        this.stopInflight();
        this.statusText = '';
      }
      // Newest first for easier scanning on mobile.
      this.history = [...this.history, item].sort((a, b) => b.at - a.at);
      if (item.scene === this.scene) {
        this.lastSnapshotId = item.snapshotId;
      }
      this.maybeApplyHostedResult(item);
      if (this.hostedEnabled && inflightEnded) {
        this.maybeRequestHosted();
      }
      this.render();
      this.bodyEl.scrollTop = 0;
    });
    this.client.on('aiError', (msg) => {
      const incomingClientRequestId = normalizeClientRequestId((msg as any)?.clientRequestId);
      const wasHostedInflight = this.inflightKind === 'hosted' && this.isInflightForClientRequest(incomingClientRequestId);
      const inflightEnded = this.isInflight() && this.isInflightForClientRequest(incomingClientRequestId);
      if (!this.isInflight()) {
        this.statusText = msg.error;
      } else if (inflightEnded) {
        this.stopInflight();
        this.statusText = msg.error;
      }
      if (this.hostedEnabled && wasHostedInflight) {
        this.setHosted(false, msg.error || 'AI 请求失败');
        return;
      }
      if (this.hostedEnabled && inflightEnded) {
        this.maybeRequestHosted();
      }
      this.render();
    });
    this.client.on('actionAck', (ack) => {
      if (!this.hostedEnabled) return;
      if (!this.hostedPendingActionIds.has(ack.actionId)) return;
      this.hostedPendingActionIds.delete(ack.actionId);
      if (ack.ok) return;
      this.setHosted(false, ack.error || '托管操作失败');
    });
    this.client.on('disconnect', () => {
      if (!this.isInflight()) return;
      this.stopInflight();
      this.statusText = '连接已断开，请重试';
      this.render();
    });

    this.client.blood.on('update', () => {
      this.onBloodUpdate();
    });

    this.readerBackdropEl = document.createElement('div');
    this.readerBackdropEl.className = 'mj-ai-reader-backdrop';
    this.readerBackdropEl.style.display = 'none';
    this.readerBackdropEl.onclick = () => this.setReaderOpen(false);
    document.body.appendChild(this.readerBackdropEl);

    this.readerEl = document.createElement('div');
    this.readerEl.className = 'mj-ai-reader';
    this.readerEl.style.display = 'none';
    this.readerEl.addEventListener('click', (e) => e.stopPropagation());
    document.body.appendChild(this.readerEl);

    const readerHead = document.createElement('div');
    readerHead.className = 'mj-ai-reader-head';
    this.readerEl.appendChild(readerHead);

    const readerBack = document.createElement('button');
    readerBack.type = 'button';
    readerBack.className = 'mj-ai-reader-btn';
    readerBack.appendChild(createHudLucideIcon('arrowLeft'));
    readerBack.onclick = () => this.setReaderOpen(false);
    readerHead.appendChild(readerBack);

    this.readerTitleEl = document.createElement('div');
    this.readerTitleEl.className = 'mj-ai-reader-title';
    readerHead.appendChild(this.readerTitleEl);

    const readerClose = document.createElement('button');
    readerClose.type = 'button';
    readerClose.className = 'mj-ai-reader-btn';
    readerClose.appendChild(createHudLucideIcon('x'));
    readerClose.onclick = () => this.setOpen(false);
    readerHead.appendChild(readerClose);

    this.readerBodyEl = document.createElement('div');
    this.readerBodyEl.className = 'mj-ai-reader-body';
    this.readerEl.appendChild(this.readerBodyEl);

    window.addEventListener('resize', () => this.layout());
  }

  isHosted(): boolean {
    return this.hostedEnabled;
  }

  setReplayAiContext(context: ReplayAiContext | null): void {
    const next =
      context && typeof context.gameId === 'string' && context.gameId.trim()
        ? {
            gameId: context.gameId.trim(),
            shareId: context.shareId ? String(context.shareId).trim() || null : null,
            getEventIndex: typeof context.getEventIndex === 'function' ? context.getEventIndex : null,
          }
        : null;
    this.replayAiContext = next;
    this.templatesLoaded = false;
    this.templates = [];
    this.history = [];
    this.lastSnapshotId = null;
    this.followupOpen = false;
    this.questionInput.value = '';
    this.questionInput.style.display = 'none';
    if (this.hostedEnabled) {
      this.setHosted(false, '牌谱模式不支持托管');
    } else {
      this.hostedToggleInput.checked = false;
      this.hostedToggleLabel.classList.remove('on');
      this.world.setAiHosted(false, 'teach');
    }
    if (this.open) {
      this.refreshContext();
    }
    this.render();
  }

  setHosted(enabled: boolean, reason?: string): void {
    if (enabled && this.replayAiContext) {
      this.statusText = '牌谱模式暂不支持托管';
      this.render();
      return;
    }
    const next = !!enabled;
    if (this.hostedEnabled === next) return;
    this.hostedEnabled = next;
    this.hostedToggleInput.checked = next;
    this.hostedToggleLabel.classList.toggle('on', next);
    this.world.setAiHosted(next, 'teach');

    this.followupOpen = false;
    this.questionInput.value = '';
    this.questionInput.style.display = 'none';
    this.followupExplainLabel.style.display = 'none';

    if (!next) {
      this.hostedRequestedDecisionKey = null;
      this.hostedLastActedDecisionKey = null;
      this.hostedPendingActionIds.clear();
      if (this.inflightKind === 'hosted') {
        this.stopInflight();
      }
      this.statusText = reason ? `托管已关闭：${reason}` : '';
      this.onHostedChange?.(false, reason);
      this.render();
      return;
    }

    this.statusText = '';
    this.onHostedChange?.(true);
    this.render();

    // Ensure AI context is ready for background托管.
    this.client.aiGetTemplates();
    const gid = this.client.gameId();
    if (gid) {
      void this.refreshAiSettings(gid);
    }
    this.maybeRequestHosted();
  }

  setScene(scene: AiScene | null): void {
    if (this.scene === scene) return;
    this.scene = scene;
    this.lastSnapshotId = this.pickLatestSnapshotIdForCurrentScene();
    this.historyTake = DEFAULT_HISTORY_TAKE;
    this.followupOpen = false;
    this.questionInput.value = '';
    this.questionInput.style.display = 'none';
    if (!this.isInflight()) {
      this.statusText = '';
    }
    this.render();
  }

  setOpen(open: boolean): void {
    const next = !!open;
    if (this.open === next) return;
    this.open = next;
    this.panel.style.display = this.open ? 'block' : 'none';
    if (this.open) {
      this.panel.classList.add('compact');
      this.historyTake = DEFAULT_HISTORY_TAKE;
      this.followupOpen = false;
      this.questionInput.value = '';
      this.questionInput.style.display = 'none';
      if (!this.isInflight()) {
        this.statusText = '';
      }
      this.refreshContext();
      this.layout();
    } else {
      if (!this.isInflight()) {
        this.statusText = '';
      }
      this.setReaderOpen(false);
      this.onClose();
    }
    this.render();
  }

  private isInflight(): boolean {
    return this.inflightStartedAtMs !== null;
  }

  private isInflightForClientRequest(clientRequestId: string | null): boolean {
    if (!this.isInflight()) return false;
    const active = this.activeInflightClientRequestId;
    if (!active || !clientRequestId) return false;
    return active === clientRequestId;
  }

  private nextClientRequestId(): string {
    this.clientRequestSeq += 1;
    const suffix = Math.random().toString(36).slice(2, 8);
    const prefix = this.hostedEnabled ? 'host' : 'cr';
    return `${prefix}-${Date.now()}-${this.clientRequestSeq}-${suffix}`;
  }

  private getInflightStatusText(): string | null {
    const startedAt = this.inflightStartedAtMs;
    if (startedAt === null) return null;
    const elapsedSec = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    return `请求中（${elapsedSec}s）`;
  }

  private refreshInflightTickUi(): void {
    if (!this.open) return;
    const statusText = this.getInflightStatusText();
    if (!statusText) return;
    // Tick-only update: avoid full render to preserve reader interactive state.
    this.resultActionEl.textContent = '提示';
    this.resultReasonEl.textContent = statusText;
  }

  private startInflight(clientRequestId: string, params?: { kind?: 'manual' | 'hosted'; timeoutMs?: number }): void {
    this.activeInflightClientRequestId = clientRequestId;
    this.inflightKind = params?.kind ?? 'manual';
    this.inflightStartedAtMs = Date.now();
    if (this.inflightTicker !== null) {
      window.clearInterval(this.inflightTicker);
      this.inflightTicker = null;
    }
    this.inflightTicker = window.setInterval(() => {
      if (this.inflightStartedAtMs === null) {
        if (this.inflightTicker !== null) {
          window.clearInterval(this.inflightTicker);
          this.inflightTicker = null;
        }
        return;
      }
      this.refreshInflightTickUi();
    }, 1000);
    if (this.inflightTimeoutTimer !== null) {
      window.clearTimeout(this.inflightTimeoutTimer);
      this.inflightTimeoutTimer = null;
    }
    const expectedClientRequestId = clientRequestId;
    const timeoutMs = params?.timeoutMs ?? AI_INFLIGHT_TIMEOUT_MS;
    this.inflightTimeoutTimer = window.setTimeout(() => {
      if (!this.isInflightForClientRequest(expectedClientRequestId)) return;
      const kind = this.inflightKind;
      this.stopInflight();
      this.statusText = '请求超时，请重试';
      if (this.hostedEnabled && kind === 'hosted') {
        this.setHosted(false, 'AI 请求超时');
        return;
      }
      if (this.hostedEnabled && kind === 'manual') {
        this.maybeRequestHosted();
      }
      this.render();
    }, timeoutMs);
  }

  private stopInflight(): void {
    this.activeInflightClientRequestId = null;
    this.inflightStartedAtMs = null;
    this.inflightKind = null;
    if (this.inflightTicker !== null) {
      window.clearInterval(this.inflightTicker);
      this.inflightTicker = null;
    }
    if (this.inflightTimeoutTimer !== null) {
      window.clearTimeout(this.inflightTimeoutTimer);
      this.inflightTimeoutTimer = null;
    }
  }

  private setReaderOpen(open: boolean): void {
    const next = !!open;
    if (this.readerOpen === next) return;
    this.readerOpen = next;
    this.readerBackdropEl.style.display = next ? 'block' : 'none';
    this.readerEl.style.display = next ? 'flex' : 'none';
    if (next) {
      this.renderReader();
      this.readerBodyEl.scrollTop = 0;
    }
  }

  private renderReader(): void {
    if (!this.readerOpen) return;

    const gid = this.client.gameId();

    this.readerTitleEl.textContent = '本局对话';

    const items = gid ? this.history.filter((it) => it.gameId === gid) : [];
    const ordered = items.slice().sort((a, b) => b.at - a.at); // newest -> oldest

    this.readerBodyEl.innerHTML = '';

    if (!gid) {
      const empty = document.createElement('div');
      empty.className = 'mj-ai-reader-empty';
      empty.textContent = '暂无记录';
      this.readerBodyEl.appendChild(empty);
      return;
    }

    if (ordered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'mj-ai-reader-empty';
      empty.textContent = '暂无记录';
      this.readerBodyEl.appendChild(empty);
      return;
    }

    for (const it of ordered) {
      const card = document.createElement('div');
      card.className = `mj-ai-reader-item ${it.ok ? 'ok' : 'err'}`;

      const meta = document.createElement('div');
      meta.className = 'mj-ai-reader-meta';
      meta.textContent = `${formatTime(it.at)} · ${sceneLabel(it.scene)} · ${it.kind === 'recommend' ? '荐牌' : '追问'} · ${it.model}${it.ok ? '' : ' · 失败'}`;
      card.appendChild(meta);

      if (!it.ok) {
        const msg = document.createElement('div');
        msg.className = 'mj-ai-reader-text';
        msg.textContent = it.error || 'AI 返回失败';
        card.appendChild(msg);
      } else if (it.kind === 'recommend' && it.parsed && typeof it.parsed === 'object') {
        const action = (it.parsed as any).action ?? null;
        const reasonRaw = typeof (it.parsed as any).reason === 'string' ? String((it.parsed as any).reason).trim() : '';
        const reason = reasonRaw || '未提供理由';
        const metrics = extractParsedMetrics(it.parsed);
        const actionText = action && typeof action === 'object' ? formatParsedAction(action) : '已收到回复';
        const head = document.createElement('div');
        head.className = 'mj-ai-reader-action';
        head.textContent = actionText;
        card.appendChild(head);

        const msg = document.createElement('div');
        msg.className = 'mj-ai-reader-text';
        msg.textContent = reason;
        card.appendChild(msg);

        if (hasAnyParsedMetric(metrics)) {
          const metricsEl = document.createElement('div');
          metricsEl.className = 'mj-ai-reader-metrics';
          metricsEl.textContent = formatParsedMetricsLine(metrics);
          card.appendChild(metricsEl);
        }
      } else {
        const msg = document.createElement('div');
        msg.className = 'mj-ai-reader-text';
        msg.textContent = it.response || '';
        card.appendChild(msg);
      }

      const details = document.createElement('details');
      details.className = 'mj-ai-reader-details';
      const sum = document.createElement('summary');
      sum.textContent = '原始信息';
      details.appendChild(sum);

      const labelR = document.createElement('div');
      labelR.className = 'mj-ai-reader-label';
      labelR.textContent = '原始响应';
      details.appendChild(labelR);
      const preR = document.createElement('pre');
      preR.className = 'mj-ai-reader-pre';
      preR.textContent = it.response || '';
      details.appendChild(preR);

      const labelP = document.createElement('div');
      labelP.className = 'mj-ai-reader-label';
      labelP.textContent = '发送给模型';
      details.appendChild(labelP);
      const preP = document.createElement('pre');
      preP.className = 'mj-ai-reader-pre';
      preP.textContent = it.prompt || '';
      details.appendChild(preP);

      card.appendChild(details);
      this.readerBodyEl.appendChild(card);
    }
  }

  private refreshContext(): void {
    const blood = this.client.blood.get(0) as BloodState | null;
    const seat = this.world.seat;
    if (!blood || seat === null) {
      this.setScene(null);
      return;
    }
    const s = computeAiScene(blood, seat);
    this.setScene(s);
    if (this.replayAiContext) {
      void this.refreshReplayTemplates();
    } else {
      this.client.aiGetTemplates();
    }
    const gid = this.client.gameId();
    if (gid) {
      if (!this.replayAiContext) {
        this.client.aiGetHistory(gid);
      }
      void this.refreshAiSettings(gid);
    }
  }

  private async refreshReplayTemplates(): Promise<void> {
    const seq = ++this.replayTemplatesReqSeq;
    try {
      const data = await fetchAiTemplates();
      if (seq !== this.replayTemplatesReqSeq) return;
      this.templatesLoaded = true;
      this.templates = Array.isArray(data.templates) ? data.templates : [];
      this.render();
    } catch (err: unknown) {
      if (seq !== this.replayTemplatesReqSeq) return;
      this.templatesLoaded = true;
      this.templates = [];
      this.statusText = `荐牌模板加载失败：${String((err as any)?.message ?? err)}`;
      this.render();
    }
  }

  private buildReplayAiSnapshot(): PaipuAiSnapshot | null {
    const blood = this.client.blood.get(0) as BloodState | null;
    if (!blood) return null;
    const things = Array.from(this.client.things.entries()).map(([tileId, info]) => ({
      tileId: Math.trunc(Number(tileId)),
      slotName: typeof (info as any)?.slotName === 'string' ? String((info as any).slotName) : '',
    }));
    const tileFacePublic = Array.from(this.client.tileFacePublic.entries()).map(([tileId, tileKey]) => [
      Math.trunc(Number(tileId)),
      typeof tileKey === 'number' && Number.isFinite(tileKey) ? Math.trunc(tileKey) : null,
    ]) as Array<[number, number | null]>;
    const tileFaceSelf = Array.from(this.client.tileFaceSelf.entries()).map(([tileId, tileKey]) => [
      Math.trunc(Number(tileId)),
      typeof tileKey === 'number' && Number.isFinite(tileKey) ? Math.trunc(tileKey) : null,
    ]) as Array<[number, number | null]>;
    return {
      blood: JSON.parse(JSON.stringify(blood)),
      things: things.filter((item) => Number.isFinite(item.tileId) && !!item.slotName),
      tileFacePublic,
      tileFaceSelf,
    };
  }

  private async refreshAiSettings(gameId: string): Promise<void> {
    const gid = (gameId ?? '').trim();
    if (!gid) return;
    if (this.aiSettingsInFlight?.gameId === gid) return;
    const seq = ++this.aiSettingsReqSeq;
    this.aiSettingsInFlight = { gameId: gid, seq };
    try {
      const data = await fetchAiSettings({ gameId: gid });
      if (seq !== this.aiSettingsReqSeq) return;
      this.aiSettingsLoaded = true;
      this.aiSettingsError = null;
      this.aiProfiles = Array.isArray(data.profiles) ? data.profiles : [];
      this.aiDefault = (data.default as any) ?? { source: 'official', profileId: null };
      this.aiRoom = (data.room as any) ?? null;
      this.aiEffective = (data.effective as any) ?? this.aiDefault;
      {
        const official: any = (data.official as any) ?? this.aiOfficial;
        const rawPoints = typeof official?.points === 'number' ? official.points : 0;
        const points = Number.isFinite(rawPoints) ? Math.trunc(rawPoints) : 0;
        this.aiOfficial = { ...this.aiOfficial, ...official, points };
      }
      this.aiModelIds = Array.isArray((data as any).models) ? ((data as any).models as Array<any>).map((x) => String(x ?? '').trim()).filter(Boolean) : [];
      this.render();
      this.maybeRequestHosted();
    } catch (err: unknown) {
      if (seq !== this.aiSettingsReqSeq) return;
      this.aiSettingsLoaded = true;
      this.aiProfiles = [];
      this.aiRoom = null;
      this.aiEffective = this.aiDefault;
      this.aiSettingsError = `AI 设置加载失败：${String((err as any)?.message ?? err)}`;
      this.render();
      this.maybeRequestHosted();
    } finally {
      if (this.aiSettingsInFlight?.seq === seq) {
        this.aiSettingsInFlight = null;
      }
    }
  }

  private canUseAi(): boolean {
    if (this.aiEffective.source === 'profile') {
      const pid = this.aiEffective.profileId ?? null;
      const prof = pid ? this.aiProfiles.find((p) => p.id === pid) ?? null : null;
      if (prof) return true;
    }
    return !!this.aiOfficial.enabled && !!this.aiOfficial.configured && this.aiOfficial.points > 0;
  }

  private getAiBlockedReason(): string {
    if (this.aiEffective.source === 'profile') {
      return '当前 AI 配置不可用，请检查设置';
    }
    if (!this.aiOfficial.configured) {
      return 'AI 网关未配置，请联系管理员';
    }
    if (this.aiOfficial.points <= 0) {
      return '荐牌点不足，请联系管理员充值';
    }
    return '当前 AI 不可用，请检查配置或额度';
  }

  private pickLatestSnapshotIdForCurrentScene(): string | null {
    const gid = this.client.gameId();
    if (!gid || !this.scene) return null;
    let best: AiHistoryItem | null = null;
    for (const it of this.history) {
      if (it.gameId !== gid) continue;
      if (it.scene !== this.scene) continue;
      if (!best || best.at < it.at) best = it;
    }
    return best?.snapshotId ?? null;
  }

  layout(): void {
    if (!this.open) return;
    const rect = this.anchorBtn.getBoundingClientRect();
    const gap = 8;
    const rootPos = window.getComputedStyle(this.root).position;

    const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

    const applyDocked = (bounds: { left: number; top: number; width: number; height: number }, btnLeft: number): void => {
      const viewportRatio = bounds.width / Math.max(1, bounds.height);
      const handRatio = computeHandViewportRatio(viewportRatio);
      const handHeight = Math.max(1, Math.floor(bounds.height * handRatio));
      const tableHeight = Math.max(1, Math.floor(bounds.height) - handHeight);
      const handTop = bounds.top + tableHeight;

      const right = btnLeft - gap;
      const rightClamped = clamp(right, bounds.left, bounds.left + bounds.width);
      const top = bounds.top;
      const height = Math.max(1, handTop - top);
      const availableWidth = Math.max(0, rightClamped - bounds.left);
      const width = availableWidth >= 220 ? Math.min(420, availableWidth) : Math.max(1, availableWidth);

      this.panel.style.boxSizing = 'border-box';
      this.panel.style.left = `${rightClamped}px`;
      this.panel.style.top = `${clamp(top, bounds.top, bounds.top + bounds.height)}px`;
      this.panel.style.transform = 'translate(-100%, 0)';
      this.panel.style.width = `${Math.floor(width)}px`;
      this.panel.style.height = `${Math.floor(height)}px`;
      this.panel.style.maxHeight = `${Math.floor(height)}px`;
    };

    if (rootPos === 'fixed') {
      const main = document.getElementById('main') as HTMLElement | null;
      if (main) {
        const stageRect = main.getBoundingClientRect();
        applyDocked({ left: stageRect.left, top: stageRect.top, width: stageRect.width, height: stageRect.height }, rect.left);
        return;
      }
      applyDocked({ left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }, rect.left);
      return;
    }

    // /hand/：teach-ui 被收进 1280×720 舞台（absolute + scale），面板布局用“舞台像素”。
    const main = document.getElementById('main') as HTMLElement | null;
    if (!main) {
      applyDocked({ left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }, rect.left);
      return;
    }
    const stageRect = main.getBoundingClientRect();
    const stageW = main.clientWidth;
    const stageH = main.clientHeight;
    const scaleX = stageRect.width / Math.max(1, stageW);
    const invScaleX = Number.isFinite(scaleX) && scaleX > 1e-6 ? 1 / scaleX : 1;
    const left = (rect.left - stageRect.left) * invScaleX;
    applyDocked({ left: 0, top: 0, width: stageW, height: stageH }, left);
  }


  private toggleFollowup(): void {
    if (!this.open) return;
    this.followupOpen = !this.followupOpen;
    this.questionInput.style.display = this.followupOpen ? 'block' : 'none';
    this.followupExplainLabel.style.display = this.followupOpen ? 'flex' : 'none';
    if (this.followupOpen) {
      this.questionInput.focus();
    } else {
      this.questionInput.value = '';
    }
    this.render();
  }

  private askRiskExplain(): void {
    if (!this.open) return;
    if (this.followupRiskBtn.disabled) return;
    this.followupOpen = true;
    this.followupExplain = true;
    this.questionInput.value = RISK_EXPLAIN_QUESTION;
    this.questionInput.style.display = 'block';
    this.followupExplainLabel.style.display = 'flex';
    this.render();
    this.questionInput.focus();
    const len = this.questionInput.value.length;
    this.questionInput.setSelectionRange(len, len);
  }

  private onSend(): void {
    if (this.isInflight()) {
      this.render();
      return;
    }
    const gid = this.client.gameId();
    if (!gid) return;
    const scene = this.scene;
    if (!scene) {
      this.statusText = '当前不可操作';
      this.render();
      return;
    }
    if (!this.canUseAi()) {
      this.statusText = this.getAiBlockedReason();
      this.render();
      return;
    }

    const chosen =
      (this.selectedTemplateId ? this.templates.find((t) => t.id === this.selectedTemplateId && t.scene === scene) ?? null : null) ??
      pickDefaultTemplate(this.templates, scene);
    if (!chosen) {
      this.statusText = '当前场景暂无提示词模板';
      this.render();
      return;
    }

    if (this.followupOpen) {
      const snapshotId = this.lastSnapshotId;
      if (!snapshotId) {
        this.statusText = '请先发送一次荐牌（生成快照）';
        this.render();
        return;
      }
      const q = this.questionInput.value.trim();
      if (!q) {
        this.statusText = '请输入追问内容';
        this.render();
        return;
      }
      const clientRequestId = this.nextClientRequestId();
      this.statusText = '';
      this.startInflight(clientRequestId, { kind: 'manual' });
      this.render();
      const followupPrompt = this.followupExplain ? FOLLOWUP_EXPLAIN_TEMPLATE : chosen.body;
      this.client.aiFollowup({
        clientRequestId,
        gameId: gid,
        scene,
        snapshotId,
        prompt: followupPrompt,
        question: q,
      });
      this.questionInput.value = '';
      return;
    }

    const clientRequestId = this.nextClientRequestId();
    this.statusText = '';
    this.startInflight(clientRequestId, { kind: 'manual' });
    this.render();
    if (this.replayAiContext) {
      const snapshot = this.buildReplayAiSnapshot();
      if (!snapshot) {
        this.stopInflight();
        this.statusText = '当前牌谱快照不可用';
        this.render();
        return;
      }
      void requestPaipuAiRecommend({
        gameId: this.replayAiContext.gameId,
        shareId: this.replayAiContext.shareId,
        scene,
        templateId: this.selectedTemplateId,
        prompt: chosen.body,
        snapshot,
        eventIndex: this.replayAiContext.getEventIndex?.() ?? null,
      })
        .then((resp) => {
          const item = resp?.item ?? null;
          this.stopInflight();
          this.statusText = '';
          if (!item) {
            this.statusText = '荐牌返回为空';
            this.render();
            return;
          }
          this.history = [...this.history, item].sort((a, b) => b.at - a.at);
          if (item.scene === this.scene) {
            this.lastSnapshotId = item.snapshotId;
          }
          this.render();
          this.bodyEl.scrollTop = 0;
        })
        .catch((err: unknown) => {
          this.stopInflight();
          this.statusText = String((err as any)?.message ?? err);
          this.render();
        });
      return;
    }
    this.client.aiRecommend({
      clientRequestId,
      gameId: gid,
      scene,
      templateId: this.selectedTemplateId,
      prompt: chosen.body,
    });
  }

  private loadMoreHistory(): void {
    if (!this.open) return;
    const gid = this.client.gameId();
    if (!gid) return;
    const scene = this.scene;
    const filtered = this.history.filter((it) => it.gameId === gid && (!scene || it.scene === scene));
    const total = filtered.length;
    if (total <= 0) return;
    if (this.historyTake === Number.POSITIVE_INFINITY) return;
    const prevTop = this.bodyEl.scrollTop;
    this.historyTake = Math.min(total, this.historyTake + HISTORY_PAGE_SIZE);
    this.render();
    // Newest-first order: "load more" appends older items at the bottom, so keep the current viewport.
    this.bodyEl.scrollTop = prevTop;
  }

  private showAllHistory(): void {
    if (!this.open) return;
    const gid = this.client.gameId();
    if (!gid) return;
    this.historyTake = Number.POSITIVE_INFINITY;
    this.render();
    // Oldest is at the bottom when newest-first ordering is used.
    this.bodyEl.scrollTop = this.bodyEl.scrollHeight;
  }

  private render(): void {
    if (!this.open) return;

    const scene = this.scene;
    const gid = this.client.gameId();

    // Template dropdown (top bar)
    this.templateSelect.innerHTML = '';
    if (!scene) {
      this.templateSelect.appendChild(new Option('当前不可操作', ''));
      this.templateSelect.disabled = true;
    } else {
      const list = this.templates.filter((t) => t.scene === scene);
      if (list.length === 0) {
        this.templateSelect.appendChild(new Option('暂无模板', ''));
      } else {
        for (const t of list) {
          const opt = new Option(t.name, t.id);
          this.templateSelect.appendChild(opt);
        }
      }
      const def = pickDefaultTemplate(this.templates, scene);
      const selected = this.hostedEnabled
        ? (def?.id ?? (list[0]?.id ?? null))
        : (this.selectedTemplateId && list.some((t) => t.id === this.selectedTemplateId) ? this.selectedTemplateId : null) ??
          def?.id ??
          (list[0]?.id ?? null);
      this.selectedTemplateId = selected;
      if (selected) {
        this.templateSelect.value = selected;
      }
      this.templateSelect.disabled = this.hostedEnabled || list.length === 0;
    }

    const canOperate = !!scene && !!gid;
    const replayMode = !!this.replayAiContext;
    const canUseAi = this.canUseAi();
    const inflight = this.isInflight();
    const riskFollowupAvailable = (() => {
      if (!scene || !gid || !this.lastSnapshotId) return false;
      if (scene !== 'turn' && scene !== 'claim') return false;
      for (const it of this.history) {
        if (it.gameId !== gid) continue;
        if (it.scene !== scene) continue;
        if (it.snapshotId !== this.lastSnapshotId) continue;
        if (!hasParsedMetricsInHistoryItem(it)) continue;
        return true;
      }
      return false;
    })();
    this.sendBtn.disabled = this.hostedEnabled || !canOperate || !canUseAi || !this.selectedTemplateId || inflight;
    this.followupBtn.disabled = replayMode || this.hostedEnabled || !canOperate || !canUseAi || !this.lastSnapshotId;
    this.followupRiskBtn.disabled = replayMode || !canOperate || !canUseAi || !riskFollowupAvailable;
    this.followupBtn.style.display = replayMode ? 'none' : '';
    this.hostedToggleLabel.style.display = replayMode ? 'none' : '';

    const allowFollowupUi = !replayMode && this.followupOpen && !this.hostedEnabled;
    this.questionInput.style.display = allowFollowupUi ? 'block' : 'none';
    this.followupExplainLabel.style.display = allowFollowupUi ? 'flex' : 'none';
    this.followupRiskBtn.style.display = allowFollowupUi && riskFollowupAvailable ? 'inline-flex' : 'none';
    this.followupExplainInput.checked = this.followupExplain;
    this.hostedToggleInput.checked = this.hostedEnabled;
    this.hostedToggleLabel.classList.toggle('on', this.hostedEnabled);

    // Model display (read-only)
    const modelLabel = resolveEffectiveAiModelLabel({
      effective: this.aiEffective,
      profiles: this.aiProfiles,
      officialModel: this.aiOfficial.model,
    });
    this.modelEl.textContent = `模型：${modelLabel || '--'}`;

    // Result + history (newest first)
    const allInGame = gid ? this.history.filter((it) => it.gameId === gid) : [];
    const totalAll = allInGame.length;
    const filtered = gid ? this.history.filter((it) => it.gameId === gid && (!scene || it.scene === scene)) : [];
    const total = filtered.length;
    const take = this.historyTake === Number.POSITIVE_INFINITY ? total : Math.min(total, this.historyTake);
    const shown = filtered.slice(0, take);
    const latest = shown[0] ?? null;

    this.openReaderBtn.disabled = totalAll === 0;

    // Result block (latest)
    const statusText = this.getInflightStatusText() ?? this.statusText;
    if (statusText) {
      this.resultActionEl.textContent = '提示';
      this.resultReasonEl.textContent = statusText;
      this.resultMetricsEl.textContent = '';
      this.resultMetricsEl.style.display = 'none';
      this.resultDetailsEl.style.display = 'none';
    } else if (!latest) {
      if (!canUseAi) {
        this.resultActionEl.textContent = '提示';
        this.resultReasonEl.textContent = this.getAiBlockedReason();
      } else {
        this.resultActionEl.textContent = this.hostedEnabled ? '托管中' : '点击“发送”获取建议';
        this.resultReasonEl.textContent = '';
      }
      this.resultMetricsEl.textContent = '';
      this.resultMetricsEl.style.display = 'none';
      this.resultDetailsEl.style.display = 'none';
    } else if (!latest.ok) {
      this.resultActionEl.textContent = '失败';
      this.resultReasonEl.textContent = latest.error || 'AI 返回失败';
      this.resultMetricsEl.textContent = '';
      this.resultMetricsEl.style.display = 'none';
      this.resultDetailsEl.style.display = 'block';
      this.resultRawResponsePre.textContent = latest.response || '';
      this.resultRawPromptPre.textContent = latest.prompt || '';
    } else if (latest.kind === 'recommend' && latest.parsed && typeof latest.parsed === 'object') {
      const action = (latest.parsed as any).action ?? null;
      const reasonRaw = typeof (latest.parsed as any).reason === 'string' ? String((latest.parsed as any).reason).trim() : '';
      const reason = reasonRaw || '未提供理由';
      const metrics = extractParsedMetrics(latest.parsed);
      const actionText = action && typeof action === 'object' ? formatParsedAction(action) : '已收到回复';
      this.resultActionEl.textContent = actionText;
      this.resultReasonEl.textContent = reason;
      if (hasAnyParsedMetric(metrics)) {
        this.resultMetricsEl.textContent = formatParsedMetricsLine(metrics);
        this.resultMetricsEl.style.removeProperty('display');
      } else {
        this.resultMetricsEl.textContent = '';
        this.resultMetricsEl.style.display = 'none';
      }
      this.resultDetailsEl.style.display = 'block';
      this.resultRawResponsePre.textContent = latest.response || '';
      this.resultRawPromptPre.textContent = latest.prompt || '';
    } else {
      // followup or unparsed recommend: show plain text
      this.resultActionEl.textContent = latest.kind === 'followup' ? '追问回复' : '已收到回复';
      this.resultReasonEl.textContent = latest.response || '';
      this.resultMetricsEl.textContent = '';
      this.resultMetricsEl.style.display = 'none';
      this.resultDetailsEl.style.display = 'block';
      this.resultRawResponsePre.textContent = latest.response || '';
      this.resultRawPromptPre.textContent = latest.prompt || '';
    }

    // 对局态：不在小面板里展示“原始信息”，统一交给阅读态。
    this.resultDetailsEl.style.display = 'none';

    // History header
    this.historyInfoEl.textContent = totalAll === 0 ? '暂无记录' : `对话 ${totalAll} 条`;
    this.historyInfoEl.classList.toggle('clickable', totalAll > 0);
    this.historyMoreBtn.disabled = true;
    this.historyAllBtn.disabled = true;
    this.historyMoreBtn.style.display = 'none';
    this.historyAllBtn.style.display = 'none';

    // History list (exclude latest shown in result block)
    this.historyEl.innerHTML = '';

    // 对局态：历史仅做“存在感提示”，全文在阅读态查看。
    this.historyBodyEl.style.display = 'none';

    this.layout();
    this.renderReader();
  }

  private onBloodUpdate(): void {
    const blood = this.client.blood.get(0) as BloodState | null;
    const seat = this.world.seat;
    if (!blood || seat === null) {
      if (this.hostedEnabled) {
        this.setHosted(false, '未加入牌局');
      }
      this.setScene(null);
      return;
    }
    const s = computeAiScene(blood, seat);
    this.setScene(s);
    this.maybeRequestHosted();
  }

  private maybeRequestHosted(): void {
    if (!this.hostedEnabled) return;
    const gid = this.client.gameId();
    if (!gid) return;

    const blood = this.client.blood.get(0) as BloodState | null;
    const seat = this.world.seat;
    const scene = blood && seat !== null ? computeAiScene(blood, seat) : null;
    if (!blood || seat === null || !scene) return;

    if (!this.templatesLoaded) {
      this.client.aiGetTemplates();
      return;
    }
    if (!this.aiSettingsLoaded) {
      void this.refreshAiSettings(gid);
      return;
    }
    if (!this.canUseAi()) {
      this.setHosted(false, this.getAiBlockedReason());
      return;
    }
    if (this.isInflight()) return;

    const decisionKey = computeAiDecisionKey(blood, seat, scene);
    if (decisionKey === this.hostedLastActedDecisionKey) return;
    if (decisionKey === this.hostedRequestedDecisionKey) return;

    const chosen = pickDefaultTemplate(this.templates, scene);
    if (!chosen) {
      this.setHosted(false, '当前场景暂无提示词模板');
      return;
    }

    this.hostedRequestedDecisionKey = decisionKey;
    const clientRequestId = this.nextClientRequestId();
    this.statusText = '';
    this.startInflight(clientRequestId, { kind: 'hosted', timeoutMs: HOSTED_AI_INFLIGHT_TIMEOUT_MS });
    this.client.aiRecommend({
      clientRequestId,
      gameId: gid,
      scene,
      templateId: chosen.id,
      prompt: chosen.body,
    });
  }

  private maybeApplyHostedResult(item: AiHistoryItem): void {
    if (!this.hostedEnabled) return;
    if (!item || item.kind !== 'recommend') return;
    if (!item.ok) {
      this.setHosted(false, item.error || 'AI 返回失败');
      return;
    }
    const parsed = item.parsed;
    const action = parsed && typeof parsed === 'object' ? (parsed as any).action : null;
    if (!action || typeof action !== 'object') {
      this.setHosted(false, 'AI 返回不包含可执行 action');
      return;
    }

    const gid = this.client.gameId();
    if (!gid || item.gameId !== gid) return;

    const blood = this.client.blood.get(0) as BloodState | null;
    const seat = this.world.seat;
    if (!blood || seat === null) return;
    const scene = computeAiScene(blood, seat);
    if (!scene || scene !== item.scene) return;

    const currentKey = computeAiDecisionKey(blood, seat, scene);
    const requestedKey = this.hostedRequestedDecisionKey;
    if (!requestedKey) return;
    if (currentKey !== requestedKey) {
      // State changed while AI was thinking; ignore stale result and request again.
      this.hostedRequestedDecisionKey = null;
      this.maybeRequestHosted();
      return;
    }

    // Prevent double execution on the same decision.
    if (this.hostedLastActedDecisionKey === requestedKey) {
      this.hostedRequestedDecisionKey = null;
      return;
    }

    const validated = validateHostedAction(scene, action, blood, seat);
    if (!validated.ok) {
      this.setHosted(false, validated.reason);
      return;
    }

    const actionId = this.client.sendBloodAction(validated.action as any);
    if (actionId) {
      this.hostedPendingActionIds.add(actionId);
    }
    this.hostedLastActedDecisionKey = requestedKey;
    this.hostedRequestedDecisionKey = null;
  }
}
