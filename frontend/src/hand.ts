import { Box3, Camera, Group, OrthographicCamera, Quaternion, Vector3 } from 'three';
import { AssetLoader } from './asset-loader';
import { Client } from './client';
import { ObjectView } from './object-view';
import { SoundPlayer } from './sound-player';
import { HAND_TAP_RAISE_RATIO, World } from './world';
import { MainView } from './main-view';
import { TouchUi } from './touch-ui';
import { ensurePwaManifestLink } from './pwa-manifest';
import { getBasePath, getWsUrl } from './ws-url';
import { GameType, Size, ThingType } from './types';
import { BloodUi } from './blood-ui';
import { GuobiaoUi } from './guobiao-ui';
import { BloodController } from './blood-controller';
import { BloodState } from './blood';
import { HandHudOverlay } from './hand-hud';
import { HistoryRuntime } from './history-runtime';
import { HandPaipuRuntime } from './hand-paipu-runtime';
import { applyPartialCase, receivePartialCase } from './partial-case-runtime';
import { GuobiaoPaipuRuntime } from './guobiao-paipu-runtime';
import { fetchMyPaipu, openPaipuShare, type PaipuDetail } from './paipu-api';
import { guobiaoConfigForCurrentPlayer } from './guobiao-preferences';
import { mostCommon } from './utils';
import {
  disableTrustee,
  ensureUser,
  fetchActiveGame,
  fetchMatchPointsInfo,
  fetchTrusteeStatus,
  getLoginToken,
  guobiaoNewbieNew,
  guobiaoNewbieStart,
  newbieNew,
  newbieStart,
} from './user';
import { syncProfileToGameClient } from './user-sync';
import { initHudActionButton, setHudActionButtonIcon, type HudActionButtonParts } from './hud-action-button';
import { createFirefliesFx, type FirefliesFxHandle } from './fireflies-fx';
import { resolveHandParentOrigin, shouldReplyToHandReadyRequest } from './hand-embed-bridge';
import { getDshHandBootstrap, removeDshCapabilitiesFromUrl } from './dsh-hand-bootstrap';

ensurePwaManifestLink();

const overlay = document.getElementById('overlay') as HTMLElement;
const loading = document.getElementById('loading') as HTMLElement;
const loadingText = document.getElementById('loading-text') as HTMLElement | null;
const loadingHint = document.getElementById('loading-hint') as HTMLElement | null;
const loadingSeatText = document.getElementById('loading-seat-text') as HTMLElement | null;
const loadingSeatNodes = Array.from(document.querySelectorAll<HTMLElement>('#loading-seats .boot-seat'));
const loadingStepNodes = Array.from(document.querySelectorAll<HTMLElement>('#loading-steps .boot-step'));
const mainRoot = document.getElementById('main') as HTMLElement;
const huDebug = document.getElementById('hu-debug') as HTMLElement | null;
const huAnchorDebug = document.getElementById('hu-anchor-debug') as HTMLElement | null;
const fullscreenBtn = document.getElementById('fullscreen-btn') as HTMLButtonElement | null;
const fullRoot = document.getElementById('full') as HTMLElement;
const CHATGPT_HAND_DECISION_MESSAGE = 'mjlabai:hand-decision-context-changed';
const HAND_READY_MESSAGE = 'mjlabai:hand-ready';
const handEmbedQuery = new URLSearchParams(window.location.search);
const handParentOrigin = resolveHandParentOrigin(
  window.location.origin,
  handEmbedQuery.get('parentOrigin'),
);

// Route product navigation through the local Harness shell while preserving
// the original HUD, rendering, and native interaction handlers for gameplay.
document.addEventListener('click', event => {
  if (window.parent === window) return;
  const button=(event.target as Element | null)?.closest('button');
  if (!button || button.disabled) return;
  const kind=button.dataset.kind;
  const label=button.textContent?.trim() ?? '';
  const action=kind==='home'?'home':kind==='playAgain'?'new':kind==='practice'||label.includes('练习分支')?'practice':label==='查看本局牌谱'?'replay':label==='生成分享链接'?'share':null;
  if (!action) return;
  event.preventDefault();event.stopImmediatePropagation();
  window.parent.postMessage({type:'dsh-mahjong:navigate',gameId:handEmbedQuery.get('gameId'),action},handParentOrigin);
},true);

// /hand/：背景资源用 JS 注入到 CSS 变量，避免在 /hand/ 子路径下出现相对 URL 解析偏差（导致白底）。
const stageBg1xUrl = new URL('../img/hand-ui-layout/stage_bg@1x.png', import.meta.url).toString();
const stageBg2xUrl = new URL('../img/hand-ui-layout/stage_bg@2x.png', import.meta.url).toString();
const outerFillBgUrl = new URL('../img/hand-ui-layout/bg.jpg', import.meta.url).toString();
const huFontSvgUrl = new URL('../img/svg/hu.svg', import.meta.url).toString();
const guoFontSvgUrl = new URL('../img/svg/guo.svg', import.meta.url).toString();
const gangFontSvgUrl = new URL('../img/svg/gang.svg', import.meta.url).toString();
const pengFontSvgUrl = new URL('../img/svg/peng.svg', import.meta.url).toString();
const quedingFontSvgUrl = new URL('../img/svg/queding.svg', import.meta.url).toString();
const wanFontSvgUrl = new URL('../img/svg/wan.svg', import.meta.url).toString();
const tongFontSvgUrl = new URL('../img/svg/tong.svg', import.meta.url).toString();
const tiaoFontSvgUrl = new URL('../img/svg/tiao.svg', import.meta.url).toString();
const dingquezhongFontSvgUrl = new URL('../img/svg/dingquezhong.svg', import.meta.url).toString();

fullRoot.style.setProperty('--hand-outer-fill-bg', `url("${outerFillBgUrl}")`);
fullRoot.style.setProperty('--hand-hu-font', `url("${huFontSvgUrl}")`);
fullRoot.style.setProperty('--hand-guo-font', `url("${guoFontSvgUrl}")`);
fullRoot.style.setProperty('--hand-gang-font', `url("${gangFontSvgUrl}")`);
fullRoot.style.setProperty('--hand-peng-font', `url("${pengFontSvgUrl}")`);
fullRoot.style.setProperty('--hand-queding-font', `url("${quedingFontSvgUrl}")`);
fullRoot.style.setProperty('--hand-wan-font', `url("${wanFontSvgUrl}")`);
fullRoot.style.setProperty('--hand-tong-font', `url("${tongFontSvgUrl}")`);
fullRoot.style.setProperty('--hand-tiao-font', `url("${tiaoFontSvgUrl}")`);
fullRoot.style.setProperty('--hand-dingquezhong-font', `url("${dingquezhongFontSvgUrl}")`);
// 胡牌按钮：优先显示 SVG 字形；若加载失败则保留原始“胡”文字兜底（避免空白按钮）。
const huFontImg = new Image();
huFontImg.crossOrigin = 'anonymous';
huFontImg.decoding = 'async';
huFontImg.onload = () => {
  fullRoot.classList.add('hand-hu-font-ready');
};
huFontImg.onerror = () => {
  // ignore
};
huFontImg.src = huFontSvgUrl;

// “过”按钮：优先显示 SVG 字形；若加载失败则保留原始“过”文字兜底。
const guoFontImg = new Image();
guoFontImg.crossOrigin = 'anonymous';
guoFontImg.decoding = 'async';
guoFontImg.onload = () => {
  fullRoot.classList.add('hand-guo-font-ready');
};
guoFontImg.onerror = () => {
  // ignore
};
guoFontImg.src = guoFontSvgUrl;

// “杠”按钮：优先显示 SVG 字形；若加载失败则保留原始“杠”文字兜底。
const gangFontImg = new Image();
gangFontImg.crossOrigin = 'anonymous';
gangFontImg.decoding = 'async';
gangFontImg.onload = () => {
  fullRoot.classList.add('hand-gang-font-ready');
};
gangFontImg.onerror = () => {
  // ignore
};
gangFontImg.src = gangFontSvgUrl;

// “碰”按钮：优先显示 SVG 字形；若加载失败则保留原始“碰”文字兜底。
const pengFontImg = new Image();
pengFontImg.crossOrigin = 'anonymous';
pengFontImg.decoding = 'async';
pengFontImg.onload = () => {
  fullRoot.classList.add('hand-peng-font-ready');
};
pengFontImg.onerror = () => {
  // ignore
};
pengFontImg.src = pengFontSvgUrl;

// “确定”按钮：优先显示 SVG 字形；若加载失败则保留原始“确定”文字兜底。
const quedingFontImg = new Image();
quedingFontImg.crossOrigin = 'anonymous';
quedingFontImg.decoding = 'async';
quedingFontImg.onload = () => {
  fullRoot.classList.add('hand-queding-font-ready');
};
quedingFontImg.onerror = () => {
  // ignore
};
quedingFontImg.src = quedingFontSvgUrl;

// 定缺按钮（万/筒/条）：优先显示 SVG 字形；若加载失败则保留原始文字兜底。
const wanFontImg = new Image();
wanFontImg.crossOrigin = 'anonymous';
wanFontImg.decoding = 'async';
wanFontImg.onload = () => {
  fullRoot.classList.add('hand-wan-font-ready');
};
wanFontImg.onerror = () => {
  // ignore
};
wanFontImg.src = wanFontSvgUrl;

const tongFontImg = new Image();
tongFontImg.crossOrigin = 'anonymous';
tongFontImg.decoding = 'async';
tongFontImg.onload = () => {
  fullRoot.classList.add('hand-tong-font-ready');
};
tongFontImg.onerror = () => {
  // ignore
};
tongFontImg.src = tongFontSvgUrl;

const tiaoFontImg = new Image();
tiaoFontImg.crossOrigin = 'anonymous';
tiaoFontImg.decoding = 'async';
tiaoFontImg.onload = () => {
  fullRoot.classList.add('hand-tiao-font-ready');
};
tiaoFontImg.onerror = () => {
  // ignore
};
tiaoFontImg.src = tiaoFontSvgUrl;

// HUD 角标：“定缺中”字样。优先显示 SVG 字形；若加载失败则保留原始文字兜底。
const dingquezhongFontImg = new Image();
dingquezhongFontImg.crossOrigin = 'anonymous';
dingquezhongFontImg.decoding = 'async';
dingquezhongFontImg.onload = () => {
  fullRoot.classList.add('hand-dingquezhong-font-ready');
};
dingquezhongFontImg.onerror = () => {
  // ignore
};
dingquezhongFontImg.src = dingquezhongFontSvgUrl;

// /hand/：虚拟舞台（唯一设计分辨率）
const STAGE_WIDTH = 1280;
const STAGE_HEIGHT = 720;
const STAGE_RATIO = STAGE_WIDTH / STAGE_HEIGHT;
const MATCH_POINTS_DENIED_ERROR = '对局积分不足，无法开始对局';
const GAME_NOT_FOUND_ERROR = '牌局不存在或已结束';

let stageBg2xUpgradeScheduled = false;
let stageBg1xWarmStarted = false;
let stageBg1xApplied = false;

function applyStageBg1x(): void {
  if (stageBg1xApplied) return;
  stageBg1xApplied = true;
  mainRoot.style.setProperty('--hand-stage-bg', `url("${stageBg1xUrl}")`);
}

function warmStageBg1x(): void {
  if (stageBg1xWarmStarted) return;
  stageBg1xWarmStarted = true;

  // 先用低优先级预热 1x，避免脚本一执行就拉大图；真正展示时再兜底应用。
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.decoding = 'async';
  (img as any).fetchPriority = 'low';
  img.onload = () => {
    applyStageBg1x();
  };
  img.onerror = () => {
    // ignore; hideBoot() 会兜底应用 1x
  };
  img.src = stageBg1xUrl;
}

function shouldUpgradeStageBg2x(): boolean {
  if ((window.devicePixelRatio || 1) < 2) return false;
  const connection = (navigator as any).connection;
  if (connection && typeof connection === 'object') {
    if (connection.saveData) return false;
    const effectiveType = String(connection.effectiveType ?? '').toLowerCase();
    if (effectiveType === 'slow-2g' || effectiveType === '2g') return false;
  }
  return true;
}

function scheduleStageBg2xUpgrade(): void {
  if (stageBg2xUpgradeScheduled) return;
  if (!shouldUpgradeStageBg2x()) return;
  stageBg2xUpgradeScheduled = true;

  // 避免与首屏关键资源争抢：延迟一点再开始下载 2x。
  window.setTimeout(() => {
    if (!shouldUpgradeStageBg2x()) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    (img as any).fetchPriority = 'low';
    img.onload = () => {
      if (!shouldUpgradeStageBg2x()) return;
      mainRoot.style.setProperty('--hand-stage-bg', `url("${stageBg2xUrl}")`);
    };
    img.onerror = () => {
      // ignore; keep 1x background.
    };
    img.src = stageBg2xUrl;
  }, 900);
}

function computeHandViewportRatio(viewportRatio: number): number {
  // 设计稿基准：852×393（≈2.168），ref.jpg 的手牌条高度约占 16%~18%。
  // 目标：让“桌面区域”尽量高（上下占满），手牌条只占必要高度。
  if (viewportRatio >= 2.5) return 0.15;
  if (viewportRatio >= 2.0) return 0.17;
  if (viewportRatio >= 1.8) return 0.19;
  return 0.21;
}

function ensureHudActionsRoot(): HTMLDivElement | null {
  const mainEl = document.getElementById('main');
  if (!mainEl) return null;
  const existing = document.getElementById('hud-actions') as HTMLDivElement | null;
  if (existing) return existing;
  const root = document.createElement('div');
  root.id = 'hud-actions';
  mainEl.appendChild(root);
  return root;
}

const WORLD_CENTER = new Vector3(World.WIDTH * 0.5, World.WIDTH * 0.5, 0);
const Z_AXIS = new Vector3(0, 0, 1);
const ROTATE_CORNERS = Array.from({ length: 8 }, () => new Vector3());

// /hand/：胡牌“红框”位置调试（基于弃牌区中间一行的交点）
const SHOW_HU_ANCHOR_DEBUG = false;
const HU_ANCHOR_BOXES: Array<HTMLDivElement | null> = [null, null, null, null];
const HU_ANCHOR_TMP_NDC = new Vector3();
const HU_ANCHOR_TMP_PX = { x: 0, y: 0 };
const HU_OVERLAY_OUTWARD_SHIFT = Size.TILE.y * 0.8;
const HU_OVERLAY_OUTWARD_DIR = [
  new Vector3(0, -1, 0), // seat0：屏幕下
  new Vector3(1, 0, 0),  // seat1：屏幕右
  new Vector3(0, 1, 0),  // seat2：屏幕上
  new Vector3(-1, 0, 0), // seat3：屏幕左
];

function ensureHuAnchorBoxes(): void {
  if (!huAnchorDebug) return;
  for (let i = 0; i < 4; i++) {
    if (HU_ANCHOR_BOXES[i]) continue;
    const div = document.createElement('div');
    div.className = 'hu-anchor';
    huAnchorDebug.appendChild(div);
    HU_ANCHOR_BOXES[i] = div;
  }
}

function projectWorldToTablePx(mainView: MainView, world: Vector3, out: { x: number; y: number }): { x: number; y: number } {
  const vp = mainView.getTableViewport();
  HU_ANCHOR_TMP_NDC.copy(world).project(mainView.camera);
  out.x = ((HU_ANCHOR_TMP_NDC.x + 1) * 0.5) * vp.width + vp.left;
  out.y = ((1 - HU_ANCHOR_TMP_NDC.y) * 0.5) * vp.height + vp.top;
  return out;
}

function renderHuAnchorDebugRects(world: World, mainView: MainView): void {
  if (!SHOW_HU_ANCHOR_DEBUG) {
    if (huAnchorDebug) huAnchorDebug.innerHTML = '';
    return;
  }
  if (!huAnchorDebug) return;
  const viewerSeat = world.seat;
  if (viewerSeat === null) {
    huAnchorDebug.innerHTML = '';
    return;
  }
  ensureHuAnchorBoxes();

  const bottomSeat = viewerSeat;
  const rightSeat = (viewerSeat + 1) % 4;
  const topSeat = (viewerSeat + 2) % 4;
  const leftSeat = (viewerSeat + 3) % 4;

  type Line2 = { x0: number; y0: number; x1: number; y1: number; z: number };
  const getDiscardMidRowLine = (seat: number): Line2 | null => {
    const slot0 = world.slots.get(`discard.1.0@${seat}`) ?? null;
    const slot5 = world.slots.get(`discard.1.5@${seat}`) ?? null;
    if (!slot0 || !slot5) return null;
    const rot = slot0.thing?.rotationIndex ?? slot5.thing?.rotationIndex ?? 0;
    const idx0 = Math.max(0, Math.min(rot, slot0.places.length - 1));
    const idx5 = Math.max(0, Math.min(rot, slot5.places.length - 1));
    const p0 = slot0.places[idx0]?.position;
    const p1 = slot5.places[idx5]?.position;
    if (!p0 || !p1) return null;
    return { x0: p0.x, y0: p0.y, x1: p1.x, y1: p1.y, z: Math.max(p0.z, p1.z) };
  };

  const intersect2d = (a: Line2 | null, b: Line2 | null): Vector3 | null => {
    if (!a || !b) return null;
    const ax = a.x1 - a.x0;
    const ay = a.y1 - a.y0;
    const bx = b.x1 - b.x0;
    const by = b.y1 - b.y0;
    const denom = ax * by - ay * bx;
    if (!Number.isFinite(denom) || Math.abs(denom) < 1e-6) return null;
    const cx = b.x0 - a.x0;
    const cy = b.y0 - a.y0;
    const t = (cx * by - cy * bx) / denom;
    if (!Number.isFinite(t)) return null;
    const x = a.x0 + t * ax;
    const y = a.y0 + t * ay;
    const z = Math.max(a.z, b.z);
    return new Vector3(x, y, z);
  };

  const lineBottom = getDiscardMidRowLine(bottomSeat);
  const lineTop = getDiscardMidRowLine(topSeat);
  const lineLeft = getDiscardMidRowLine(leftSeat);
  const lineRight = getDiscardMidRowLine(rightSeat);

  // rel=0..3：下/右/上/左（与屏幕方向一致）
  const anchors: Array<Vector3 | null> = [
    intersect2d(lineBottom, lineRight), // 右下：下玩家
    intersect2d(lineTop, lineRight), // 右上：右玩家
    intersect2d(lineTop, lineLeft), // 左上：上玩家
    intersect2d(lineBottom, lineLeft), // 左下：左玩家
  ];

  const halfW = Size.TILE.x * 0.5;
  const halfH = Size.TILE.y * 0.5;
  const halfZ = Size.TILE.z * 0.5;
  const corners = [new Vector3(), new Vector3(), new Vector3(), new Vector3()];
  // 红框调试：每个方位的胡牌牌面朝向 = 该玩家弃牌 FACE_UP 朝向（与 world.getBloodMobileHuOverlays 保持一致）
  const seatByRel = [bottomSeat, rightSeat, topSeat, leftSeat];
  const isFaceUpRotationIndex = (rot: number): boolean => rot === 0 || rot === 1;
  const pickMostCommonFaceUpRotation = (things: Array<any>): Quaternion | null => {
    const candidates = things.filter((t) => isFaceUpRotationIndex(t.rotationIndex));
    const rot = mostCommon(candidates, (t) => t.rotationIndex);
    if (rot === null) return null;
    const sample = candidates.find((t) => t.rotationIndex === rot) ?? candidates[0] ?? null;
    return sample ? (sample.place().rotation as Quaternion).clone() : null;
  };
  const overlayRotsByRel: Array<Quaternion | null> = seatByRel.map((seat) => {
    const discardTiles: Array<any> = [];
    const meldTiles: Array<any> = [];
    for (const thing of world.things.values()) {
      if (thing.type !== ThingType.TILE) continue;
      const slot = thing.slot;
      if (slot.seat !== seat) continue;
      if (slot.group === 'discard') discardTiles.push(thing);
      else if (slot.group === 'meld') meldTiles.push(thing);
    }
    return (
      pickMostCommonFaceUpRotation(discardTiles) ??
      pickMostCommonFaceUpRotation(meldTiles) ??
      ((world.slots.get(`discard.0.0@${seat}`)?.places?.[0]?.rotation as Quaternion | undefined) ?? null)
    );
  });
  const tmp = { x: 0, y: 0 };

  const dbg = (window as any).handDebug ?? null;
  const debugAnchors: Array<any> = [];

  for (let rel = 0; rel < 4; rel++) {
    const div = HU_ANCHOR_BOXES[rel];
    const seat = seatByRel[rel];
    const a0 = anchors[rel];
    const a = a0 ? a0.clone() : null;
    if (a) {
      const dir = HU_OVERLAY_OUTWARD_DIR[seat];
      a.x += dir.x * HU_OVERLAY_OUTWARD_SHIFT;
      a.y += dir.y * HU_OVERLAY_OUTWARD_SHIFT;
    }
    if (!div || !a) {
      if (div) div.style.display = 'none';
      debugAnchors.push(null);
      continue;
    }

    // 红框应该对齐“胡牌牌面”的可见区域。
    // 胡牌牌面是 tile 的顶面（z = center + halfZ），并且会按该玩家 discard 的朝向（绕 Z 轴）旋转。
    const overlayRot = overlayRotsByRel[rel];
    if (overlayRot) {
      corners[0].set(-halfW, -halfH, halfZ).applyQuaternion(overlayRot).add(a);
      corners[1].set(halfW, -halfH, halfZ).applyQuaternion(overlayRot).add(a);
      corners[2].set(halfW, halfH, halfZ).applyQuaternion(overlayRot).add(a);
      corners[3].set(-halfW, halfH, halfZ).applyQuaternion(overlayRot).add(a);
    } else {
      // 兜底：仍用轴对齐矩形（不旋转、不抬到顶面）
      corners[0].set(a.x - halfW, a.y - halfH, a.z);
      corners[1].set(a.x + halfW, a.y - halfH, a.z);
      corners[2].set(a.x + halfW, a.y + halfH, a.z);
      corners[3].set(a.x - halfW, a.y + halfH, a.z);
    }

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const c of corners) {
      projectWorldToTablePx(mainView, c, tmp);
      minX = Math.min(minX, tmp.x);
      maxX = Math.max(maxX, tmp.x);
      minY = Math.min(minY, tmp.y);
      maxY = Math.max(maxY, tmp.y);
    }

    const left = minX;
    const top = minY;
    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);

    div.style.display = 'block';
    div.style.left = `${left}px`;
    div.style.top = `${top}px`;
    div.style.width = `${width}px`;
    div.style.height = `${height}px`;

    projectWorldToTablePx(mainView, a, HU_ANCHOR_TMP_PX);
    debugAnchors.push({
      rel,
      world: { x: a.x, y: a.y, z: a.z },
      px: { x: HU_ANCHOR_TMP_PX.x, y: HU_ANCHOR_TMP_PX.y },
      rect: { left, top, width, height },
    });
  }

  if (dbg) {
    dbg.huAnchorDebug = {
      viewerSeat,
      seats: { bottomSeat, rightSeat, topSeat, leftSeat },
      lines: { bottom: lineBottom, right: lineRight, top: lineTop, left: lineLeft },
      anchors: debugAnchors,
    };
  }
}

// 移动端布局（src/mobile-hand-layout.ts）里用到的关键常量：这里做“相机取景的设计基准”。
const MOBILE_STEP = Size.TILE.x; // 6
const MOBILE_CORNER_GAP = MOBILE_STEP * 2; // 12
const MOBILE_EDGE_INSET = MOBILE_STEP * 3; // 18
// /mobile-hand-layout.ts 的 tightenHandDiscardGaps 会把“手牌/副露/marker”往弃牌方向推，
// 这里用一个保守的基准 y，保证 handViewport 的固定 bounds 能覆盖实际布局。
// 设计稿：HAND_DISCARD_GAP=6，弃牌区最外沿在 42。
// 手牌条为了“同一模板不抖动”，按最大深度（副露平放 tile 深度=9）来对齐：
//   hand/meld 内侧边 = 42 - 6 = 36
//   baseY = 36 - 9 = 27
const CANONICAL_HAND_BASE_Y = 27;
const HAND_SLOTS = 14;
const HAND_EXTRA_GAP = MOBILE_STEP * 0.5; // 3

function fillCanonicalTableBounds(bounds: Box3): Box3 {
  // 基于 ref.jpg 的构图：桌面视口里不包含“自家底部手牌条”，因此底边上移一档；
  // 其余三家信息 + 明牌区尽量铺满。
  // NOTE: 桌面取景不包含自家底部“手牌条”，因此这里的 minY 应该贴近弃牌区的最外沿，
  // 否则会在桌面视口底部留下大块空桌布，导致“手牌离桌面太远/空间利用率低”。
  // 固定设计稿（无牌墙）：桌面视口只需要覆盖：
  // - 三家明牌（手牌背面 + 副露）
  // - 四家弃牌（6×3，>18 进第二层叠放但仍在同一区域）
  // - 中央盘
  //
  // 关键：bounds 必须足够“紧”，否则 fit-to-bounds 会让所有牌变小，出现“大块空桌布”。
  //
  // 这些数值与 src/mobile-hand-layout.ts 的：
  // - HAND_DISCARD_GAP = 1 张牌宽（6）
  // - 手牌为 STANDING（y 厚度=4）
  // - 弃牌基准格最外沿在 42（setup-slots.ts: discard origin y=60, 3 列 => 42）
  // 对齐，目标是让桌面与底部手牌条之间几乎无浪费。
  const discardOuter = 42;
  const discardOuterOpp = World.WIDTH - discardOuter; // 132
  const gap = MOBILE_STEP; // 6
  // 边界外扩：以“可能出现的最大牌面外扩”为准（FACE_UP_SIDEWAYS 时宽度=9）。
  // 这样即使碰/吃里有横放牌，也不会被 fit bounds 裁切。
  const maxTileSpan = Size.TILE.y; // 9

  const minX = discardOuter - gap - maxTileSpan; // 27
  const maxX = discardOuterOpp + gap + maxTileSpan; // 147
  const minY = discardOuter; // 42（桌面视口不包含自家底部手牌条）
  const maxY = discardOuterOpp + gap + maxTileSpan; // 147

  bounds.min.set(minX, minY, 0);
  // 桌面不再包含牌墙等高物体：z 上限只需覆盖“竖牌(≈9)”与弃牌第二层(≈8.1)
  bounds.max.set(maxX, maxY, 10);
  return bounds;
}

function fillCanonicalHandBounds(bounds: Box3): Box3 {
  // 手牌条 bounds：只覆盖“本家手牌+副露（合计≤18）”的固定模板宽度（不随对局内容变化）。
  // marker 被放在手牌线内侧（见 mobile-hand-layout.ts），不会额外扩大 x/y 的外侧边界。
  const handMeldCap = 18;
  const spanU = handMeldCap * MOBILE_STEP; // 108
  const minU = WORLD_CENTER.x - spanU * 0.5; // 33
  const maxU = WORLD_CENTER.x + spanU * 0.5; // 141

  bounds.min.set(minU, CANONICAL_HAND_BASE_Y, 0);
  // y：需要覆盖副露平放的深度(9) + marker 在手牌上沿内侧(4+6=10)
  const maxY = CANONICAL_HAND_BASE_Y + Math.max(Size.TILE.y, Size.TILE.z + Size.MARKER.y);
  bounds.max.set(maxU, maxY, Math.max(Size.TILE.y, Size.TILE.z));
  return bounds;
}

function rotateBoundsForSeat(canonical: Box3, seat: number, out: Box3): Box3 {
  const angle = seat * Math.PI * 0.5;
  const min = canonical.min;
  const max = canonical.max;
  ROTATE_CORNERS[0].set(min.x, min.y, min.z);
  ROTATE_CORNERS[1].set(min.x, min.y, max.z);
  ROTATE_CORNERS[2].set(min.x, max.y, min.z);
  ROTATE_CORNERS[3].set(min.x, max.y, max.z);
  ROTATE_CORNERS[4].set(max.x, min.y, min.z);
  ROTATE_CORNERS[5].set(max.x, min.y, max.z);
  ROTATE_CORNERS[6].set(max.x, max.y, min.z);
  ROTATE_CORNERS[7].set(max.x, max.y, max.z);

  out.makeEmpty();
  for (const corner of ROTATE_CORNERS) {
    corner.sub(WORLD_CENTER);
    corner.applyAxisAngle(Z_AXIS, angle);
    corner.add(WORLD_CENTER);
    out.expandByPoint(corner);
  }
  return out;
}

const NDC_CORNERS = Array.from({ length: 8 }, () => new Vector3());

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

type InsetsPx = { top: number; right: number; bottom: number; left: number };
type ViewportPx = { left: number; top: number; width: number; height: number };
type NdcInsets = { left: number; right: number; top: number; bottom: number };

let safeAreaProbe: HTMLDivElement | null = null;

function getSafeAreaInsetsPx(): InsetsPx {
  if (!safeAreaProbe) {
    safeAreaProbe = document.createElement('div');
    safeAreaProbe.style.position = 'fixed';
    safeAreaProbe.style.left = '0';
    safeAreaProbe.style.top = '0';
    safeAreaProbe.style.width = '0';
    safeAreaProbe.style.height = '0';
    safeAreaProbe.style.visibility = 'hidden';
    safeAreaProbe.style.pointerEvents = 'none';
    // iOS: requires <meta name="viewport" content="..., viewport-fit=cover"> to be non-zero on notched devices.
    safeAreaProbe.style.paddingTop = 'env(safe-area-inset-top)';
    safeAreaProbe.style.paddingRight = 'env(safe-area-inset-right)';
    safeAreaProbe.style.paddingBottom = 'env(safe-area-inset-bottom)';
    safeAreaProbe.style.paddingLeft = 'env(safe-area-inset-left)';
    document.body.appendChild(safeAreaProbe);
  }
  const style = getComputedStyle(safeAreaProbe);
  const toPx = (v: string): number => Number.parseFloat(v) || 0;
  return {
    top: toPx(style.paddingTop),
    right: toPx(style.paddingRight),
    bottom: toPx(style.paddingBottom),
    left: toPx(style.paddingLeft),
  };
}

function computeSafeNdcInsetsForViewport(
  viewport: ViewportPx,
  full: { width: number; height: number },
  safePx: InsetsPx,
): NdcInsets {
  const touchesLeft = viewport.left <= 0;
  const touchesRight = viewport.left + viewport.width >= full.width;
  const touchesTop = viewport.top <= 0;
  const touchesBottom = viewport.top + viewport.height >= full.height;

  const w = Math.max(1, viewport.width);
  const h = Math.max(1, viewport.height);
  return {
    left: clamp((2 * (touchesLeft ? safePx.left : 0)) / w, 0, 0.45),
    right: clamp((2 * (touchesRight ? safePx.right : 0)) / w, 0, 0.45),
    top: clamp((2 * (touchesTop ? safePx.top : 0)) / h, 0, 0.45),
    bottom: clamp((2 * (touchesBottom ? safePx.bottom : 0)) / h, 0, 0.45),
  };
}

function projectBoundsToNdc(bounds: Box3, camera: Camera): { minX: number; maxX: number; minY: number; maxY: number } {
  const min = bounds.min;
  const max = bounds.max;
  NDC_CORNERS[0].set(min.x, min.y, min.z);
  NDC_CORNERS[1].set(min.x, min.y, max.z);
  NDC_CORNERS[2].set(min.x, max.y, min.z);
  NDC_CORNERS[3].set(min.x, max.y, max.z);
  NDC_CORNERS[4].set(max.x, min.y, min.z);
  NDC_CORNERS[5].set(max.x, min.y, max.z);
  NDC_CORNERS[6].set(max.x, max.y, min.z);
  NDC_CORNERS[7].set(max.x, max.y, max.z);

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const corner of NDC_CORNERS) {
    corner.project(camera);
    minX = Math.min(minX, corner.x);
    maxX = Math.max(maxX, corner.x);
    minY = Math.min(minY, corner.y);
    maxY = Math.max(maxY, corner.y);
  }

  return { minX, maxX, minY, maxY };
}

const PLACE_MIN = new Vector3();
const PLACE_MAX = new Vector3();

function expandBoundsWithPlace(bounds: Box3, place: { position: Vector3; size: Vector3 }): void {
  PLACE_MIN.copy(place.position).addScaledVector(place.size, -0.5);
  PLACE_MAX.copy(place.position).addScaledVector(place.size, 0.5);
  bounds.expandByPoint(PLACE_MIN);
  bounds.expandByPoint(PLACE_MAX);
}

function computeVisibleHandContentBoundsFromPlaces(world: World, client: Client, seat: number): Box3 | null {
  const bounds = new Box3();
  bounds.makeEmpty();
  let any = false;

  const isBlood = world.conditions.gameType === GameType.BLOOD_BATTLE;
  const bloodState = isBlood ? (client.blood.get(0) as BloodState | null) : null;
  const revealAllHands = !!(bloodState && bloodState.revealAllHands);
  const dingque = isBlood ? (bloodState?.players?.[seat]?.dingque ?? null) : null;

  for (const thing of world.things.values()) {
    const slot = thing.slot;
    if (slot.seat !== seat) continue;
    if (slot.group !== 'hand' && slot.group !== 'meld' && slot.group !== 'marker') continue;

    // /hand/ 已用 HUD 展示定缺；血战场景里的“万/筒/条”marker 不再显示，因此不计入 bounds。
    if (isBlood && slot.group === 'marker') {
      continue;
    }

    // 血战：没定缺时 marker 完全不显示（MarkerThingGroup 会 visible=false），因此不计入 bounds。
    if (slot.group === 'marker' && isBlood && dingque === null) {
      continue;
    }

    // 血战：自摸胡时 hand.extra 那张会被隐藏（scale=0），因此也不计入 bounds。
    if (
      isBlood &&
      !revealAllHands &&
      thing.type === ThingType.TILE &&
      slot.name === `hand.extra@${seat}` &&
      !!(bloodState?.players?.[seat]?.hu && bloodState?.players?.[seat]?.huSource === 'self')
    ) {
      continue;
    }

    const place =
      slot.group === 'hand' && thing.type === ThingType.TILE
        ? slot.placeWithOffset(0) // 移动端手牌永远竖牌（rotationIndex=0），翻背不改变尺寸
        : thing.place();

    expandBoundsWithPlace(bounds, place);
    any = true;
  }

  return any ? bounds : null;
}

const MESH_CORNERS = Array.from({ length: 8 }, () => new Vector3());
const MESH_TMP_WORLD_BOX = new Box3();

function projectMeshToNdc(mesh: any, camera: Camera): { minX: number; maxX: number; minY: number; maxY: number } | null {
  if (!mesh) {
    return null;
  }

  // Marker 等会挂子节点（dingque 文字面片）；此时用 setFromObject 做兜底。
  if (Array.isArray(mesh.children) && mesh.children.length > 0) {
    MESH_TMP_WORLD_BOX.setFromObject(mesh);
    if (!Number.isFinite(MESH_TMP_WORLD_BOX.min.x) || !Number.isFinite(MESH_TMP_WORLD_BOX.max.x) || MESH_TMP_WORLD_BOX.isEmpty()) {
      return null;
    }
    return projectBoundsToNdc(MESH_TMP_WORLD_BOX, camera);
  }

  const geometry = mesh.geometry;
  if (!geometry) {
    return null;
  }
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox as Box3 | null | undefined;
  if (!bb || bb.isEmpty()) {
    return null;
  }

  const min = bb.min;
  const max = bb.max;
  MESH_CORNERS[0].set(min.x, min.y, min.z);
  MESH_CORNERS[1].set(min.x, min.y, max.z);
  MESH_CORNERS[2].set(min.x, max.y, min.z);
  MESH_CORNERS[3].set(min.x, max.y, max.z);
  MESH_CORNERS[4].set(max.x, min.y, min.z);
  MESH_CORNERS[5].set(max.x, min.y, max.z);
  MESH_CORNERS[6].set(max.x, max.y, min.z);
  MESH_CORNERS[7].set(max.x, max.y, max.z);

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const corner of MESH_CORNERS) {
    corner.applyMatrix4(mesh.matrixWorld);
    corner.project(camera);
    minX = Math.min(minX, corner.x);
    maxX = Math.max(maxX, corner.x);
    minY = Math.min(minY, corner.y);
    maxY = Math.max(maxY, corner.y);
  }

  return { minX, maxX, minY, maxY };
}

function computeVisibleHandContentNdc(
  world: World,
  client: Client,
  objectView: ObjectView,
  seat: number,
  camera: Camera,
): { minX: number; maxX: number; minY: number; maxY: number; meshCount: number } | null {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let meshCount = 0;

  const isBlood = world.conditions.gameType === GameType.BLOOD_BATTLE;
  const bloodState = isBlood ? (client.blood.get(0) as BloodState | null) : null;
  const revealAllHands = !!(bloodState && bloodState.revealAllHands);
  const dingque = isBlood ? (bloodState?.players?.[seat]?.dingque ?? null) : null;

  for (const thing of world.things.values()) {
    const slot = thing.slot;
    if (slot.seat !== seat) continue;
    if (slot.group !== 'hand' && slot.group !== 'meld' && slot.group !== 'marker') continue;

    // 血战：没定缺时 marker 完全不显示（MarkerThingGroup 会 visible=false），因此不计入 bounds。
    if (slot.group === 'marker' && isBlood && dingque === null) {
      continue;
    }

    // 血战：自摸胡时 hand.extra 那张会被隐藏（scale=0），因此也不计入 bounds。
    if (
      isBlood &&
      !revealAllHands &&
      thing.type === ThingType.TILE &&
      slot.name === `hand.extra@${seat}` &&
      !!(bloodState?.players?.[seat]?.hu && bloodState?.players?.[seat]?.huSource === 'self')
    ) {
      continue;
    }

    const mesh = objectView.getMeshForThing(thing.type, thing.index);
    if (!mesh) continue;
    if (!mesh.visible) continue;
    if (mesh.scale?.x !== undefined && mesh.scale.x <= 1e-6) continue;
    if (!mesh.layers.test(camera.layers)) continue;

    const ndc = projectMeshToNdc(mesh, camera);
    if (!ndc) continue;

    minX = Math.min(minX, ndc.minX);
    maxX = Math.max(maxX, ndc.maxX);
    minY = Math.min(minY, ndc.minY);
    maxY = Math.max(maxY, ndc.maxY);
    meshCount += 1;
  }

  if (meshCount <= 0 || !Number.isFinite(maxY) || !Number.isFinite(minY)) {
    return null;
  }
  return { minX, maxX, minY, maxY, meshCount };
}

type OverlayAction = {
  label: string;
  onClick: () => void;
};

type EntryGateWaiter = {
  resolve: () => void;
};

const ENTRY_GATE_RETURN_URL = `${getBasePath()}mobile/`;
let entryGateEnabled = false;
let entryGatePassed = false;
let entryGateWaiter: EntryGateWaiter | null = null;

function getFullscreenElementCompat(): Element | null {
  const docAny = document as any;
  return (document.fullscreenElement ?? docAny.webkitFullscreenElement ?? null) as Element | null;
}

function hasFullscreenApi(): boolean {
  const rootAny = document.documentElement as any;
  return typeof (rootAny.requestFullscreen || rootAny.webkitRequestFullscreen) === 'function';
}

function isStandaloneMode(): boolean {
  const anyNav = navigator as any;
  if (typeof window.matchMedia === 'function') {
    try {
      if (window.matchMedia('(display-mode: standalone)').matches) return true;
    } catch {
      // ignore
    }
  }
  return anyNav?.standalone === true;
}

function isIosDevice(): boolean {
  const ua = navigator.userAgent ?? '';
  const isIpadDesktopUa = /Macintosh/i.test(ua) && (navigator.maxTouchPoints ?? 0) > 1;
  return /iPhone|iPad|iPod/i.test(ua) || isIpadDesktopUa;
}

function shouldEnforceEntryGate(): boolean {
  const ua = navigator.userAgent ?? '';
  const isIpadDesktopUa = /Macintosh/i.test(ua) && (navigator.maxTouchPoints ?? 0) > 1;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || isIpadDesktopUa;
}

function isFullscreenActive(): boolean {
  return !!getFullscreenElementCompat();
}

function isEntryGateReady(): boolean {
  if (!shouldEnforceEntryGate()) return true;
  return isLandscape();
}

function resolveEntryGateIfReady(): boolean {
  if (!entryGateEnabled || entryGatePassed) return false;
  if (!isEntryGateReady()) return false;
  entryGateEnabled = false;
  entryGatePassed = true;
  const waiter = entryGateWaiter;
  entryGateWaiter = null;
  if (waiter) {
    waiter.resolve();
  }
  return true;
}

function buildGateStatusLine(label: string, ready: boolean): HTMLDivElement {
  const line = document.createElement('div');
  line.style.display = 'flex';
  line.style.alignItems = 'center';
  line.style.justifyContent = 'space-between';
  line.style.gap = '12px';

  const left = document.createElement('div');
  left.textContent = label;
  left.style.fontSize = '14px';
  left.style.color = 'rgba(255,255,255,0.82)';
  line.appendChild(left);

  const right = document.createElement('div');
  right.textContent = ready ? '已就绪' : '未就绪';
  right.style.fontSize = '14px';
  right.style.fontWeight = '900';
  right.style.color = ready ? '#f2c94c' : 'rgba(255,255,255,0.92)';
  line.appendChild(right);
  return line;
}

function buildGateButton(label: string, onClick: () => void, options?: { primary?: boolean; disabled?: boolean }): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = label;
  btn.style.height = '40px';
  btn.style.padding = '0 14px';
  btn.style.borderRadius = '6px';
  btn.style.border = options?.primary ? '1px solid rgba(242,201,76,0.75)' : '1px solid rgba(255,255,255,0.3)';
  btn.style.background = options?.primary ? 'rgba(242,201,76,0.22)' : 'rgba(255,255,255,0.12)';
  btn.style.color = 'rgba(255,255,255,0.95)';
  btn.style.fontWeight = '900';
  btn.style.fontSize = '14px';
  btn.style.cursor = options?.disabled ? 'not-allowed' : 'pointer';
  btn.style.opacity = options?.disabled ? '0.55' : '1';
  btn.style.width = '100%';
  btn.style.touchAction = 'manipulation';
  btn.style.setProperty('-webkit-tap-highlight-color', 'transparent');
  btn.disabled = !!options?.disabled;
  btn.onclick = onClick;
  return btn;
}

function showEntryGateOverlay(): void {
  overlay.innerHTML = '';

  const landscapeReady = isLandscape();
  const fullscreenReady = isFullscreenActive();
  const standaloneReady = isStandaloneMode();
  const immersiveReady = fullscreenReady || standaloneReady;
  const fullscreenSupported = hasFullscreenApi();

  const wrap = document.createElement('div');
  wrap.style.display = 'flex';
  wrap.style.flexDirection = 'column';
  wrap.style.gap = '10px';
  wrap.style.alignItems = 'stretch';
  wrap.style.width = 'min(90vw, 420px)';
  wrap.style.padding = '14px';
  wrap.style.border = '1px solid rgba(255,255,255,0.2)';
  wrap.style.borderRadius = '6px';
  wrap.style.background = 'rgba(0,0,0,0.35)';

  const title = document.createElement('div');
  title.textContent = '进入对局前请先横屏（推荐沉浸模式）';
  title.style.fontWeight = '900';
  title.style.fontSize = '16px';
  title.style.lineHeight = '1.35';
  wrap.appendChild(title);

  const sub = document.createElement('div');
  sub.textContent = '请先完成以下检查，再进入牌桌。';
  sub.style.fontSize = '13px';
  sub.style.color = 'rgba(255,255,255,0.82)';
  sub.style.lineHeight = '1.35';
  wrap.appendChild(sub);

  const statusBox = document.createElement('div');
  statusBox.style.display = 'flex';
  statusBox.style.flexDirection = 'column';
  statusBox.style.gap = '8px';
  statusBox.style.padding = '10px';
  statusBox.style.border = '1px solid rgba(255,255,255,0.12)';
  statusBox.style.borderRadius = '6px';
  statusBox.style.background = 'rgba(255,255,255,0.05)';
  statusBox.appendChild(buildGateStatusLine('横屏', landscapeReady));
  statusBox.appendChild(buildGateStatusLine('沉浸（可选）', immersiveReady));
  wrap.appendChild(statusBox);

  const hint = document.createElement('div');
  if (!landscapeReady) {
    if (isIosDevice() && !standaloneReady) {
      hint.textContent = '请将手机旋转为横屏后继续。iPhone 浏览器无法网页全屏，可直接进入；想更沉浸请“添加到主屏幕”（分享按钮 → 添加到主屏幕）。';
    } else if (!fullscreenSupported) {
      hint.textContent = '请将手机旋转为横屏后继续。当前浏览器不支持网页全屏，可直接进入。';
    } else {
      hint.textContent = '请将手机旋转为横屏后继续。进入后可点右上角“全屏”获得更沉浸体验。';
    }
  } else {
    hint.textContent = '检查通过，正在进入对局…';
  }
  hint.style.fontSize = '13px';
  hint.style.lineHeight = '1.35';
  hint.style.color = 'rgba(255,255,255,0.9)';
  wrap.appendChild(hint);

  const actions = document.createElement('div');
  actions.style.display = 'flex';
  actions.style.flexDirection = 'column';
  actions.style.gap = '8px';
  actions.appendChild(buildGateButton(
    '我已旋转，继续进入',
    () => {
      updateOverlay();
    },
    { primary: true }
  ));
  actions.appendChild(buildGateButton(
    '返回房间',
    () => {
      window.location.assign(ENTRY_GATE_RETURN_URL);
    },
    undefined
  ));
  wrap.appendChild(actions);

  overlay.appendChild(wrap);
  overlay.style.display = 'flex';
}

function waitForEntryGate(): Promise<void> {
  if (entryGatePassed) return Promise.resolve();
  if (!shouldEnforceEntryGate()) {
    entryGateEnabled = false;
    entryGatePassed = true;
    return Promise.resolve();
  }
  entryGateEnabled = true;
  if (resolveEntryGateIfReady()) return Promise.resolve();
  return new Promise<void>((resolve) => {
    entryGateWaiter = { resolve };
    updateOverlay();
  });
}

function showOverlay(
  text: string,
  options?: { hint?: string | null; action?: OverlayAction | null }
): void {
  overlay.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.style.display = 'flex';
  wrap.style.flexDirection = 'column';
  wrap.style.gap = '10px';
  wrap.style.alignItems = 'center';
  wrap.style.maxWidth = 'min(90vw, 420px)';

  const main = document.createElement('div');
  main.textContent = text;
  main.style.fontWeight = '800';
  main.style.lineHeight = '1.4';
  main.style.wordBreak = 'break-word';
  wrap.appendChild(main);

  const hintText = (options?.hint ?? '').trim();
  if (hintText) {
    const hint = document.createElement('div');
    hint.textContent = hintText;
    hint.style.fontSize = '13px';
    hint.style.color = 'rgba(255,255,255,0.8)';
    hint.style.lineHeight = '1.35';
    wrap.appendChild(hint);
  }

  const action = options?.action ?? null;
  if (action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = action.label;
    btn.style.height = '38px';
    btn.style.padding = '0 14px';
    btn.style.borderRadius = '6px';
    btn.style.border = '1px solid rgba(255,255,255,0.28)';
    btn.style.background = 'rgba(255,255,255,0.14)';
    btn.style.color = 'rgba(255,255,255,0.95)';
    btn.style.fontWeight = '900';
    btn.style.cursor = 'pointer';
    btn.onclick = action.onClick;
    wrap.appendChild(btn);
  }

  overlay.appendChild(wrap);
  overlay.style.display = 'flex';
}

function hideOverlay(): void {
  overlay.style.display = 'none';
  overlay.innerHTML = '';
}

function isBloodDingqueCommitted(player: BloodState['players'][number] | null | undefined): boolean {
  return player?.dingqueReady === true || player?.dingque !== null;
}

function computeChatgptHandDecisionSignal(state: BloodState | null, seat: number | null): { scene: string; key: string } | null {
  if (!state || seat === null || seat < 0 || seat > 3) return null;
  const me = state.players?.[seat] ?? null;
  if (!me || me.hu) return null;

  if (state.phase === 'swap3') {
    const swap3 = state.swap3 ?? null;
    if (!swap3 || swap3.animatingSince !== null) return null;
    const picked = (swap3.selections as any)?.[seat] ?? null;
    return picked === null
      ? {
          scene: 'swap3',
          key: [
            'swap3',
            `seat=${seat}`,
            `since=${swap3.since ?? ''}`,
            `dir=${swap3.dir ?? ''}`,
            `wall=${state.wallIndex}`,
            `next=${state.nextId}`,
          ].join('|'),
        }
      : null;
  }

  if (state.phase === 'dingque') {
    return isBloodDingqueCommitted(me)
      ? null
      : {
          scene: 'dingque',
          key: [
            'dingque',
            `seat=${seat}`,
            `phase=${state.phase}`,
            `wall=${state.wallIndex}`,
            `next=${state.nextId}`,
          ].join('|'),
        };
  }

  if (state.phase !== 'playing') return null;

  const pending = state.pending;
  if (pending?.kind === 'claim') {
    if (seat === pending.fromSeat) return null;
    const response = pending.responses?.[seat] ?? null;
    if (response !== null) return null;
    const option = pending.options?.[seat] ?? { hu: false, peng: false, gang: false };
    if (!option.hu && !option.peng && !option.gang) return null;
    return {
      scene: 'claim',
      key: [
        'claim',
        `seat=${seat}`,
        `pending=${pending.id}`,
        `from=${pending.fromSeat}`,
        `tile=${pending.tileKey}`,
        `hu=${option.hu ? 1 : 0}`,
        `peng=${option.peng ? 1 : 0}`,
        `gang=${option.gang ? 1 : 0}`,
        `wall=${state.wallIndex}`,
        `next=${state.nextId}`,
      ].join('|'),
    };
  }

  if (pending === null && state.turnSeat === seat && state.turnStep === 'discard' && me.dingque !== null) {
    return {
      scene: 'turn',
      key: [
        'turn',
        `seat=${seat}`,
        `turn=${state.turnSeat}`,
        `step=${state.turnStep}`,
        `dingque=${me.dingque}`,
        `wall=${state.wallIndex}`,
        `next=${state.nextId}`,
        `melds=${me.melds?.length ?? 0}`,
        `kong=${me.kongGain}`,
      ].join('|'),
    };
  }

  return null;
}

function postChatgptHandDecisionMessage(gameId: string, signal: { scene: string; key: string } | null): void {
  if (window.parent === window) return;
  window.parent.postMessage({
    type: CHATGPT_HAND_DECISION_MESSAGE,
    gameId,
    available: signal !== null,
    scene: signal?.scene ?? null,
    decisionKey: signal?.key ?? null,
    at: new Date().toISOString(),
  }, handParentOrigin);
}

function postHandReadyMessage(): void {
  if (window.parent === window) return;
  const embeddedGameId = (handEmbedQuery.get('gameId') ?? '').trim();
  if (embeddedGameId === '') return;
  window.parent.postMessage({
    type: HAND_READY_MESSAGE,
    gameId: embeddedGameId,
    at: new Date().toISOString(),
  }, handParentOrigin);
}

function setupFullscreenButton(): void {
  if (!fullscreenBtn) return;
  const root = ensureHudActionsRoot();
  if (root) root.appendChild(fullscreenBtn);

  const docAny = document as any;
  const rootAny = document.documentElement as any;
  const requestFn = rootAny.requestFullscreen || rootAny.webkitRequestFullscreen;
  const exitFn = document.exitFullscreen || docAny.webkitExitFullscreen;
  const supported = typeof requestFn === 'function';

  const getFullscreenElement = (): Element | null =>
    (document.fullscreenElement ?? docAny.webkitFullscreenElement ?? null) as Element | null;

  const parts: HudActionButtonParts = initHudActionButton(fullscreenBtn, {
    label: '全屏',
    icon: 'maximize2',
    kind: 'fullscreen',
    title: '全屏',
  });

	  const update = (): void => {
	    const on = !!getFullscreenElement();
      fullscreenBtn.classList.toggle('active', on);
      fullscreenBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
      setHudActionButtonIcon(parts, on ? 'minimize2' : 'maximize2');
	  };

  if (!supported) {
    fullscreenBtn.disabled = true;
    fullscreenBtn.title = '当前浏览器不支持全屏（Fullscreen API）';
    update();
    return;
  }

  fullscreenBtn.addEventListener('click', async () => {
    try {
      if (getFullscreenElement()) {
        if (typeof exitFn === 'function') {
          await exitFn.call(document);
        }
      } else {
        await requestFn.call(document.documentElement);
      }
    } catch {
      // 忽略：用户取消/浏览器策略禁止时不会影响游戏
    } finally {
      update();
    }
  });
  document.addEventListener('fullscreenchange', update);
  document.addEventListener('webkitfullscreenchange' as any, update);
  update();
}

function setupHomeButton(): void {
  const root = ensureHudActionsRoot();
  if (!root) return;
  const homeBtn =
    (document.getElementById('home-btn') as HTMLButtonElement | null) ??
    (() => {
      const el = document.createElement('button');
      el.id = 'home-btn';
      el.type = 'button';
      root.appendChild(el);
      return el;
    })();
  if (homeBtn.parentElement !== root) {
    root.appendChild(homeBtn);
  }

  initHudActionButton(homeBtn, {
    label: '首页',
    icon: 'house',
    kind: 'home',
    title: '首页',
  });
  homeBtn.onclick = () => {
    window.location.assign(getBasePath());
  };
}

function isLandscape(): boolean {
  return window.innerWidth >= window.innerHeight;
}

function getViewportRatio(): number {
  const scene = document.getElementById('scene');
  const w = scene?.clientWidth ?? window.innerWidth;
  const h = scene?.clientHeight ?? window.innerHeight;
  return w / Math.max(1, h);
}

let bootReleased = false;
let bootHardStop = false;
let bootAssetsReady = false;
let bootWsReady = false;
let bootSyncReady = false;
let bootSceneReady = false;
let bootFirstFrameReady = false;
let bootSeatCount: number | null = null;
let bootHasGameState = false;
let bootHasServerTiles = false;

window.addEventListener('message', event => {
  const embeddedGameId = (handEmbedQuery.get('gameId') ?? '').trim();
  if (!shouldReplyToHandReadyRequest({
    eventOrigin: event.origin,
    expectedParentOrigin: handParentOrigin,
    isParentSource: event.source === window.parent,
    embeddedGameId,
    data: event.data,
    isReady: bootReleased,
  })) return;
  postHandReadyMessage();
});
const BOOT_PHASE_ORDER = ['assets', 'network', 'sync', 'scene', 'frame'] as const;
type BootPhase = (typeof BOOT_PHASE_ORDER)[number];
const BOOT_PHASE_PROGRESS: Record<BootPhase, number> = {
  assets: 12,
  network: 30,
  sync: 52,
  scene: 76,
  frame: 92,
};
const BOOT_PHASE_HINT: Record<BootPhase, string> = {
  assets: '首次进入会稍慢，静态资源会缓存到浏览器。',
  network: '网络波动时会自动重连，不需要手动刷新。',
  sync: '正在同步房间和牌局快照。',
  scene: '牌桌初始化后会自动进入对局。',
  frame: '即将完成，准备进入牌桌。',
};
let bootPhase: BootPhase = 'assets';

function isBootPhase(value: string | undefined): value is BootPhase {
  return value === 'assets' || value === 'network' || value === 'sync' || value === 'scene' || value === 'frame';
}

function setBootPhase(phase: BootPhase): void {
  bootPhase = phase;
  loading.style.setProperty('--boot-progress', String(BOOT_PHASE_PROGRESS[phase]));
  const activeIndex = BOOT_PHASE_ORDER.indexOf(phase);
  for (const node of loadingStepNodes) {
    const rawPhase = node.dataset.phase;
    const idx = isBootPhase(rawPhase) ? BOOT_PHASE_ORDER.indexOf(rawPhase) : -1;
    node.classList.toggle('is-done', idx >= 0 && idx < activeIndex);
    node.classList.toggle('is-active', idx >= 0 && idx === activeIndex);
  }
  if (loadingHint) {
    loadingHint.textContent = BOOT_PHASE_HINT[phase];
  }
}

function setBootSeatUi(seatCount: number | null): void {
  const normalized = seatCount === null ? 0 : Math.round(clamp(seatCount, 0, 4));
  if (loadingSeatText) {
    if (seatCount === null) {
      loadingSeatText.textContent = '正在加载资源，完成后同步座位…';
    } else if (seatCount < 4) {
      loadingSeatText.textContent = `等待玩家入座（${normalized}/4）`;
    } else {
      loadingSeatText.textContent = '玩家已就位，正在开局…';
    }
  }
  for (let i = 0; i < loadingSeatNodes.length; i++) {
    loadingSeatNodes[i].classList.toggle('occupied', i < normalized);
  }
}

function showBoot(message: string, busy: boolean = true, phase: BootPhase = bootPhase): void {
  if (loadingText) {
    loadingText.textContent = message;
  } else {
    loading.textContent = message;
  }
  setBootPhase(phase);
  setBootSeatUi(bootSeatCount);
  loading.classList.toggle('static', !busy);
  loading.setAttribute('aria-busy', busy ? 'true' : 'false');
  loading.classList.remove('hidden');
}

function hideBoot(): void {
  if (bootReleased) return;
  setBootPhase('frame');
  setBootSeatUi(4);
  for (const node of loadingStepNodes) {
    node.classList.remove('is-active');
    node.classList.add('is-done');
  }
  loading.style.setProperty('--boot-progress', '100');
  bootReleased = true;
  applyStageBg1x();
  mainRoot.classList.remove('boot-main-hidden');
  loading.classList.add('hidden');
  scheduleStageBg2xUpgrade();
  postHandReadyMessage();
}

function stopBootWithMessage(message: string): void {
  bootHardStop = true;
  showBoot(message, false, bootPhase);
}

function countOccupiedSeats(client: Client): number {
  const occupied = new Set<number>();
  for (const [, seatInfo] of client.seats.entries()) {
    if (seatInfo?.seat !== null && seatInfo?.seat !== undefined) {
      occupied.add(seatInfo.seat);
    }
  }
  return occupied.size;
}

function refreshBoot(client: Client | null): void {
  if (bootReleased || bootHardStop) return;
  if (!bootAssetsReady) {
    showBoot('正在加载静态资源…', true, 'assets');
    return;
  }
  if (!bootWsReady) {
    showBoot('正在连接服务器…', true, 'network');
    return;
  }
  if (!bootSyncReady) {
    showBoot('正在同步房间状态…', true, 'sync');
    return;
  }
  if (client?.isAuthoritative() && bootSeatCount !== null && bootSeatCount < 4 && !bootHasGameState) {
    showBoot(`等待玩家入座（${bootSeatCount}/4）…`, true, 'scene');
    return;
  }
  if (!bootSceneReady) {
    if (bootSeatCount !== null) {
      if (bootSeatCount < 4) {
        if (client?.isAuthoritative()) {
          showBoot(`等待玩家入座（${bootSeatCount}/4）…`, true, 'scene');
        } else {
          showBoot('等待房主开始对局…', true, 'scene');
        }
        return;
      }
      showBoot('玩家已就位，正在开局…', true, 'scene');
      return;
    }
    showBoot('正在等待牌局数据…', true, 'scene');
    return;
  }
  if (!bootFirstFrameReady) {
    showBoot('正在渲染首帧…', true, 'frame');
    return;
  }
  hideBoot();
}

let fatalMessage: string | null = null;
let fatalHint: string | null = null;
let fatalAction: OverlayAction | null = null;
let transientMessage: string | null = null;
let connectionTransientMessage: string | null = null;
let connectionRecoveryActive = false;

function setFatalMessage(
  message: string | null,
  options?: { hint?: string | null; action?: OverlayAction | null }
): void {
  fatalMessage = message;
  fatalHint = options?.hint ?? null;
  fatalAction = options?.action ?? null;
}

function updateOverlay(): void {
  if (entryGateEnabled && !entryGatePassed) {
    if (resolveEntryGateIfReady()) {
      hideOverlay();
      return;
    }
    showEntryGateOverlay();
    return;
  }
  if (fatalMessage) {
    showOverlay(fatalMessage, { hint: fatalHint, action: fatalAction });
    return;
  }
  if (transientMessage) {
    showOverlay(transientMessage);
    return;
  }
  hideOverlay();
}

window.addEventListener('resize', updateOverlay);
window.addEventListener('orientationchange', updateOverlay);
document.addEventListener('fullscreenchange', updateOverlay);
document.addEventListener('webkitfullscreenchange' as any, updateOverlay);
setupFullscreenButton();
setupHomeButton();
showBoot('正在加载静态资源…', true, 'assets');

const q = new URLSearchParams(window.location.search);
const gameId = (q.get('gameId') ?? '').trim();
const replayShareId = (q.get('share') ?? '').trim();
const caseMode = q.get('mode') === 'case';
const historyMode = ['history','archive'].includes(q.get('mode') ?? '');
const replayMode = caseMode || historyMode || (q.get('mode') ?? '').trim().toLowerCase() === 'paipu';
const dshHandBootstrap = replayMode ? { mode: 'standard' as const } : getDshHandBootstrap();
const isDshSpectator = dshHandBootstrap.mode === 'spectator';
const isNewbieRoomRoute = (q.get('room') ?? '').trim().toLowerCase() === 'newbie';
const isGuobiaoNewbieRoute = isNewbieRoomRoute && (q.get('variant') ?? '').trim().toLowerCase() === 'guobiao';
const hasReplayTarget = replayMode ? !!(gameId || replayShareId) : !!gameId;
type PaipuRuntime = HandPaipuRuntime | GuobiaoPaipuRuntime;
const routeError = dshHandBootstrap.mode === 'invalid' ? dshHandBootstrap.error : null;
if (!hasReplayTarget || routeError) {
  const message = routeError ?? (replayMode ? '缺少牌谱定位参数：请从结算页、个人中心或分享链接进入。' : '缺少 gameId：请从 /mobile/ 创建房间并使用分享链接进入。');
  setFatalMessage(message);
  updateOverlay();
  stopBootWithMessage(message);
} else {
  void (async () => {
    if (shouldEnforceEntryGate()) {
      const tip = isIosDevice() && !isStandaloneMode()
        ? '进入对局前请先横屏。iPhone 建议“添加到主屏幕”获得更沉浸体验。'
        : '进入对局前请先横屏。';
      showBoot(tip, false, 'assets');
    }
    await waitForEntryGate();
    updateOverlay();
    showBoot('正在加载静态资源…', true, 'assets');
    warmStageBg1x();

    const assetLoader = new AssetLoader();
    const audioPrefsPromise: Promise<{ bgmEnabled: boolean; sfxEnabled: boolean }> = ensureUser({ strictExistingToken: true })
      .then(({ user }) => ({
        bgmEnabled: user.bgmEnabled !== false,
        sfxEnabled: user.sfxEnabled !== false,
      }))
      .catch(() => ({
        bgmEnabled: false,
        sfxEnabled: true,
      }));
    Promise.all([assetLoader.loadAll(), audioPrefsPromise]).then(async ([, audioPrefs]) => {
    bootAssetsReady = true;
    const viewportRatio = STAGE_RATIO;
    const mainGroup = new Group();
    const client = new Client();
    const objectView = new ObjectView(mainGroup, assetLoader, client, {
      showTable: false,
      showSticks: false,
      showTrays: false,
      // 不靠“放大桌布”来消灭黑边：桌布保持默认比例，靠相机取景(cover)来铺满画面
      // 仅用于“填满屏幕背景”：加大桌布平面，避免相机视野看到桌布边缘外的黑底
      tableScale: 4,
      centerStyle: 'mahjongMobile',
      // /hand/ 已有 HUD 卡片展示定缺，不需要再在 3D 场景里显示“万/筒/条”角标。
      showBloodDingqueMarkers: false,
    });
    const soundPlayer = new SoundPlayer(client);
    soundPlayer.setPreferences(audioPrefs);
    const world = new World(objectView, soundPlayer, client, { layoutMode: 'mobileHand' });
    const mainView = new MainView(mainGroup, { showStats: false, virtualViewport: { width: STAGE_WIDTH, height: STAGE_HEIGHT } });
    // 先把 1280×720 舞台尺寸/缩放落地，避免后续 UI/相机初始化拿到 0×0 的 viewport。
    mainView.updateViewport();
    // /hand/ 桌布背景：轻量“萤火虫”动效（只作用于背景，不盖住 3D 牌面）
    const firefliesFx: FirefliesFxHandle = createFirefliesFx(mainRoot, {
      stageWidth: STAGE_WIDTH,
      stageHeight: STAGE_HEIGHT,
      getStageScale: () => mainView.getStageScale(),
    });
    window.addEventListener('beforeunload', () => firefliesFx.destroy(), { once: true });
    const touchUi = new TouchUi(world, mainGroup, { enabled: !replayMode && !isDshSpectator });
    const bloodUiRoot = document.getElementById('blood-ui') as HTMLElement;
    const bloodUi = new BloodUi(client, world, mainView, bloodUiRoot, {
      interactive: !replayMode && !isDshSpectator,
      replayReadonly: replayMode,
    });
    const guobiaoUi = new GuobiaoUi(client, world, mainView, bloodUiRoot, {
      interactive: !replayMode && !isDshSpectator,
    });
    let bloodController: BloodController | null = null;
    let paipuRuntime: PaipuRuntime | null = null;
    let paipuDetail: PaipuDetail | null = null;
    const handHud = new HandHudOverlay(mainView, client, world, objectView, {
      ledgerPlacement: 'byFullscreen',
      dingqueBadgeBySuit: true,
      hudLayout: 'fixed',
    });
    // 便于在 /hand/ 里用 DevTools 排查 match/seats/blood 状态
    (window as any).handDebug = { client, world, bloodController, bloodUi, mainView, objectView, touchUi, handHud, paipuRuntime, firefliesFx, handCrop: {} };
    mainView.setPerspective(true);
    // 移动端：让 canvas 透明，任何“取景之外的空白”都显示为 HTML 桌布背景（而不是黑边）
    mainView.setClearAlpha(0);
    // 双相机：底部手牌/副露视口（更像手游）
    const handViewportRatio = computeHandViewportRatio(viewportRatio);
    mainView.setHandViewport(handViewportRatio);
    let cameraDirty = true;
    // 方案3：开局阶段允许收敛，但稳定后只应用一次裁切并锁定，避免出牌阶段分屏边界/缩放出现“1px 级抖动”。
    let handViewportLocked = false;
    let handViewportLockedRatio = handViewportRatio;
    let handViewportAutoStartedAt = 0;
    let handViewportAutoTimeoutFired = false;
    let handViewportAutoLastHeight: number | null = null;
    let handViewportAutoStableSamples = 0;
    let handViewportAutoMaxCroppedHeight: number | null = null;
    let handViewportAutoRerunFramesLeft = 0;
    const HAND_VIEWPORT_LOCK_STABLE_SAMPLES = 2;
    const HAND_VIEWPORT_LOCK_TIMEOUT_MS = 1000;
    const HAND_VIEWPORT_LOCK_SAFE_PAD_PX = 1;
    // seat/gameType 确定但牌面还没同步到 world.things 时，先延迟裁切，等内容就绪后再触发一次 cameraDirty。
    let handCropPending = false;
    let handCropPendingFrames = 0;
    const HAND_CROP_PENDING_MAX_FRAMES = 240;
    const updateHandCropDebug = (patch: Record<string, unknown>): void => {
      const dbg = (window as any).handDebug;
      if (!dbg) return;
      dbg.handCrop = { ...(dbg.handCrop ?? {}), ...patch };
    };

				    // 刷新后“手牌顶端出现大空隙”的根因（之一）：
				    // - 首次 cameraDirty 往往发生在服务端全量同步之前，导致裁切基于“半成品布局”
				    // - 即便收到了 full update，客户端也可能立刻发起/收到一轮后续 things update（例如移动端手牌旋转归一、避让等）
				    //   这会改变实际可见 bounds，但我们没有再次触发取景/裁切，从而留下顶部空隙
				    // 因此：full-update 必须触发一次；且后续“会影响本家 hand/meld/marker”的增量更新也要触发一次。
				    let sawThingsFullUpdate = false;
				    let handCropSettleUpdates = 0;
            let seatsInitialized = false;
            let matchInitialized = false;
            let allowAuthoritativeSeat = false;
            let reconnectTimer: number | null = null;
            let newbieRecovering = false;
            let newbieRecoveryAttempts = 0;
            let guobiaoPrivateFaceResyncTimer: number | null = null;
            const NEWBIE_RECOVERY_MAX_ATTEMPTS = 3;
            const wsUrl = getWsUrl();
            let dshHumanInviteClaimed = false;
            const connectToGame = (): void => {
              if (dshHandBootstrap.mode === 'spectator') {
                client.spectateDsh(wsUrl, gameId, dshHandBootstrap.spectatorEmbedTicket);
                return;
              }
              if (dshHandBootstrap.mode === 'human-invite') {
                client.joinDshHuman(wsUrl, gameId, dshHandBootstrap.seat, dshHandBootstrap.humanInviteTicket);
                return;
              }
              throw new Error('牌桌身份无效，请从 DeepSeek Harness 重新打开。');
            };
            const isGuobiaoAuthoritativeGame = (): boolean => {
              if (!client.connected() || !client.isAuthoritative()) return false;
              const match = client.match.get(0);
              return match?.conditions?.gameType === GameType.GUOBIAO || isGuobiaoNewbieRoute;
            };
            const scheduleGuobiaoPrivateFaceResync = (): void => {
              if (!isGuobiaoAuthoritativeGame()) return;
              if (guobiaoPrivateFaceResyncTimer !== null) return;
              guobiaoPrivateFaceResyncTimer = window.setTimeout(() => {
                guobiaoPrivateFaceResyncTimer = null;
                if (!isGuobiaoAuthoritativeGame()) return;
                const token = getLoginToken();
                if (token) client.bindLoginToken(token);
              }, 0);
            };
            const syncBootState = (): void => {
              bootSyncReady = seatsInitialized && matchInitialized;
              bootSeatCount = countOccupiedSeats(client);
              bootHasGameState = client.blood.get(0) !== null || client.gb.get(0) !== null;
              let hasServerTiles = false;
              for (const [, thingInfo] of client.things.entries()) {
                if (thingInfo !== null) {
                  hasServerTiles = true;
                  break;
                }
              }
              bootHasServerTiles = hasServerTiles;
              bootSceneReady = bootHasGameState || bootHasServerTiles;
              refreshBoot(client);
            };
            const applyReplayDetail = (detail: PaipuDetail, access: 'mine' | 'share'): void => {
              const ownerPlayerId = `paipu-owner-${detail.gameId}`;
              if (detail.rules?.variant === 'guobiao') {
                paipuRuntime = new GuobiaoPaipuRuntime(detail, ownerPlayerId);
              } else {
                const tileIds = Array.from({ length: 108 }, (_, index) => index);
                paipuRuntime = new HandPaipuRuntime(detail, tileIds, ownerPlayerId);
              }
              paipuDetail = detail;
              paipuRuntime.bindClient(client);
              seatsInitialized = true;
              matchInitialized = true;
              bootWsReady = true;
              syncBootState();
              handHud.setReplayControls({
                canPrev: () => paipuRuntime?.canPrev() ?? false,
                canNext: () => paipuRuntime?.canNext() ?? false,
                onPrev: () => {
                  if (!paipuRuntime) return;
                  if (!paipuRuntime.prev(client)) return;
                  cameraDirty = true;
                },
                onNext: () => {
                  if (!paipuRuntime) return;
                  if (!paipuRuntime.next(client)) return;
                  cameraDirty = true;
                },
                canShare: access === 'mine',
              });
              handHud.setReplayAiContext({
                gameId: detail.gameId,
                shareId: access === 'share' ? (detail.share.shareId ?? replayShareId ?? null) : null,
                getEventIndex: () => paipuRuntime?.currentEventIndex() ?? null,
              });
              (window as any).handDebug = { ...(window as any).handDebug, paipuRuntime, paipuDetail };
              transientMessage = null;
              updateOverlay();
            };
            const loadReplayDetail = async (): Promise<{ detail: PaipuDetail; access: 'mine' | 'share' }> => {
              showBoot('正在加载牌谱…', true, 'sync');
              if (replayShareId) {
                await ensureUser({ strictExistingToken: true });
                return { detail: await openPaipuShare(replayShareId), access: 'share' };
              }
              await ensureUser({ strictExistingToken: true });
              return { detail: await fetchMyPaipu(gameId), access: 'mine' };
            };
				    const isHandViewportRelevantUpdate = (entries: Array<[number, any | null]>): boolean => {
				      const viewerSeat = world.seat;
				      for (const [, thingInfo] of entries) {
				        const slotName = thingInfo?.slotName;
				        if (typeof slotName !== 'string') continue;
			        const at = slotName.lastIndexOf('@');
			        if (at < 0) continue;
			        const seat = Number(slotName.slice(at + 1));
			        if (!Number.isFinite(seat)) continue;
			        const base = slotName.slice(0, at);
			        const group = base.split('.')[0] ?? '';
			        if (group !== 'hand' && group !== 'meld' && group !== 'marker') continue;
			        if (viewerSeat === null || seat === viewerSeat) {
			          return true;
			        }
			      }
			      return false;
			    };
				    client.things.on('update', (entries, full) => {
              syncBootState();
              if (handViewportLocked) {
                // 锁定后：不再因对局内容变化调整分屏高度（避免出牌阶段抖动）。
                return;
              }
				      if (full) {
				        if (sawThingsFullUpdate) return;
				        sawThingsFullUpdate = true;
				        handCropSettleUpdates = 6;
				        cameraDirty = true;
			        handCropPending = false;
			        handCropPendingFrames = 0;
              handViewportAutoStartedAt = 0;
              handViewportAutoTimeoutFired = false;
              handViewportAutoLastHeight = null;
              handViewportAutoStableSamples = 0;
              handViewportAutoMaxCroppedHeight = null;
              handViewportAutoRerunFramesLeft = 0;
			        updateHandCropDebug({ trigger: 'things-full-update', settleLeft: handCropSettleUpdates });
			        return;
			      }
			      if (handCropSettleUpdates > 0) {
			        handCropSettleUpdates -= 1;
			        cameraDirty = true;
			        handCropPending = false;
			        handCropPendingFrames = 0;
			        updateHandCropDebug({ trigger: 'things-settle-update', settleLeft: handCropSettleUpdates });
			        return;
			      }
			      // 增量更新：只在“会影响本家 hand/meld/marker 的可见 bounds”时重跑裁切。
			      if (!isHandViewportRelevantUpdate(entries)) {
			        return;
			      }
			      cameraDirty = true;
			      handCropPending = false;
				      handCropPendingFrames = 0;
				      updateHandCropDebug({ trigger: 'things-hand-update' });
				    });
            let lastChatgptHandDecisionKey: string | null = null;
            client.blood.on('update', () => {
              syncBootState();
              if (!client.connected()) return;
              const signal = computeChatgptHandDecisionSignal(client.blood.get(0) as BloodState | null, client.seat);
              const nextKey = signal?.key ?? null;
              if (nextKey !== lastChatgptHandDecisionKey) {
                lastChatgptHandDecisionKey = nextKey;
                postChatgptHandDecisionMessage(gameId, signal);
              }
              if (!isDshSpectator) void refreshTrusteeStatus();
            });
            client.gb.on('update', () => {
              syncBootState();
            });

    const errText = (err: unknown): string => String((err as any)?.message ?? err);
    const trusteeBtn = document.createElement('button');
    trusteeBtn.type = 'button';
    trusteeBtn.textContent = '托管中，点击接管';
    trusteeBtn.className = 'btn btn-warning text-dark btn-sm';
    trusteeBtn.style.position = 'fixed';
    trusteeBtn.style.right = '12px';
    trusteeBtn.style.bottom = '84px';
    trusteeBtn.style.zIndex = '90';
    trusteeBtn.style.display = 'none';
    trusteeBtn.style.fontWeight = '800';
    trusteeBtn.style.boxShadow = '0 8px 20px rgba(0,0,0,0.32)';
    trusteeBtn.style.pointerEvents = 'auto';
    trusteeBtn.style.touchAction = 'manipulation';
    mainRoot.appendChild(trusteeBtn);
    const stopTrusteeEventBubble = (event: Event): void => {
      event.stopPropagation();
    };
    trusteeBtn.addEventListener('pointerdown', stopTrusteeEventBubble);
    trusteeBtn.addEventListener('pointermove', stopTrusteeEventBubble);
    trusteeBtn.addEventListener('pointerup', stopTrusteeEventBubble);
    trusteeBtn.addEventListener('pointercancel', stopTrusteeEventBubble);
    trusteeBtn.addEventListener('touchstart', stopTrusteeEventBubble, { passive: true });
    trusteeBtn.addEventListener('touchmove', stopTrusteeEventBubble, { passive: true });
    trusteeBtn.addEventListener('touchend', stopTrusteeEventBubble, { passive: true });
    trusteeBtn.addEventListener('touchcancel', stopTrusteeEventBubble, { passive: true });

    let trusteePollInFlight = false;
    let trusteePollTimer: number | null = null;
    let trusteeClickBusy = false;
    let trusteeTransientMessageTimer: number | null = null;
    let trusteeTransientMessageToken = 0;

    const setTrusteeBtnVisible = (visible: boolean): void => {
      trusteeBtn.style.display = visible ? 'inline-flex' : 'none';
    };
    const clearTrusteeTransientMessageTimer = (): void => {
      if (trusteeTransientMessageTimer === null) return;
      window.clearTimeout(trusteeTransientMessageTimer);
      trusteeTransientMessageTimer = null;
    };
    const showTrusteeTransientMessage = (message: string): void => {
      trusteeTransientMessageToken += 1;
      const token = trusteeTransientMessageToken;
      transientMessage = message;
      updateOverlay();
      clearTrusteeTransientMessageTimer();
      // 托管接管失败属于可恢复错误：短暂提示后自动收起，避免遮罩长期阻塞交互。
      trusteeTransientMessageTimer = window.setTimeout(() => {
        trusteeTransientMessageTimer = null;
        if (trusteeTransientMessageToken !== token) return;
        if (transientMessage === message) {
          transientMessage = null;
          updateOverlay();
        }
      }, 2200);
    };
    const refreshTrusteeStatus = async (): Promise<void> => {
      if (trusteePollInFlight) return;
      trusteePollInFlight = true;
      try {
        const out = await fetchTrusteeStatus(gameId);
        const enabled = !!((out as any)?.trustee?.enabled);
        setTrusteeBtnVisible(enabled);
      } catch {
        // ignore
      } finally {
        trusteePollInFlight = false;
      }
    };
    const startTrusteePolling = (): void => {
      return; // No MJAI account service polling in the standalone table.
      if (trusteePollTimer !== null) return;
      trusteePollTimer = window.setInterval(() => {
        if (!client.connected()) return;
        if (fatalMessage) return;
        void refreshTrusteeStatus();
      }, 2000);
    };
    const stopTrusteePolling = (): void => {
      if (trusteePollTimer === null) return;
      window.clearInterval(trusteePollTimer);
      trusteePollTimer = null;
    };
	    trusteeBtn.onclick = async () => {
	      if (trusteeClickBusy) return;
	      trusteeClickBusy = true;
	      trusteeBtn.disabled = true;
	      trusteeBtn.textContent = '接管中...';
	      try {
	        if (client.connected()) {
	          // Only Blood (non-Guobiao) supports the blood trustee action. In Guobiao games this would
	          // be routed to the Guobiao engine and ACK as "invalid action", creating user-visible noise.
	          const match = client.match.get(0) as any;
	          const gameType = (match?.conditions?.gameType ?? null) as string | null;
	          const isGuobiaoGame = gameType === GameType.GUOBIAO || (gameType === null && isGuobiaoNewbieRoute);
	          if (!isGuobiaoGame) {
	            client.sendBloodAction({ kind: 'trustee', enabled: false } as any);
	          }
	        }
	        await disableTrustee(gameId);
	        setTrusteeBtnVisible(false);
	      } catch (err: unknown) {
	        showTrusteeTransientMessage(`取消托管失败：${errText(err)}`);
	      } finally {
        trusteeBtn.textContent = '托管中，点击接管';
        trusteeBtn.disabled = false;
        trusteeClickBusy = false;
      }
    };
    const buildHandUrl = (nextGameId: string): string => {
      const params = new URLSearchParams();
      params.set('gameId', nextGameId);
      if (isNewbieRoomRoute) {
        params.set('room', 'newbie');
      }
      if (isGuobiaoNewbieRoute) {
        params.set('variant', 'guobiao');
      }
      return `${getBasePath()}hand/?${params.toString()}`;
    };
    const shouldUseGuobiaoVariant = (gameType: string | null): boolean => {
      if (String(gameType ?? '').toUpperCase() === GameType.GUOBIAO) return true;
      return gameType === null && isGuobiaoNewbieRoute;
    };
    const buildHandUrlForRoom = (nextGameId: string, roomType: string | null, gameType: string | null = null): string => {
      const params = new URLSearchParams();
      params.set('gameId', nextGameId);
      if (roomType === 'newbie') {
        params.set('room', 'newbie');
      }
      if (shouldUseGuobiaoVariant(gameType)) {
        params.set('variant', 'guobiao');
      }
      return `${getBasePath()}hand/?${params.toString()}`;
    };
    const normalizeActiveGame = (raw: any): { gameId: string; roomType: string | null; gameType: string | null } | null => {
      const nextGameId = typeof raw?.gameId === 'string' ? raw.gameId.trim() : '';
      if (!nextGameId) return null;
      const roomType = typeof raw?.roomType === 'string' ? raw.roomType.trim() || null : null;
      const gameType = typeof raw?.gameType === 'string' ? raw.gameType.trim() || null : null;
      return { gameId: nextGameId, roomType, gameType };
    };
	    const toPersonalCenter = (): void => {
	      window.location.href = `${getBasePath()}me/`;
	    };
	    const toHomePage = (): void => {
	      window.location.href = `${getBasePath()}`;
	    };
	    const formatAmount = (value: number): string => {
	      return String(Math.max(0, Math.trunc(value)));
	    };
    let matchPointsDeniedHandling = false;
    let matchPointsDeniedTimeoutId: number | null = null;
    let matchPointsDeniedIntervalId: number | null = null;
    const clearMatchPointsDeniedTimers = (): void => {
      if (matchPointsDeniedTimeoutId !== null) {
        window.clearTimeout(matchPointsDeniedTimeoutId);
        matchPointsDeniedTimeoutId = null;
      }
      if (matchPointsDeniedIntervalId !== null) {
        window.clearInterval(matchPointsDeniedIntervalId);
        matchPointsDeniedIntervalId = null;
      }
    };
    const renderMatchPointsDenied = (message: string, remainSeconds: number): void => {
      setFatalMessage(message, {
        hint: `${remainSeconds} 秒后将跳转个人中心。`,
        action: {
          label: '立即前往个人中心',
          onClick: () => {
            clearMatchPointsDeniedTimers();
            toPersonalCenter();
          },
        },
      });
      updateOverlay();
      stopBootWithMessage(message);
    };
	    const handleMatchPointsDenied = async (): Promise<void> => {
      if (matchPointsDeniedHandling) return;
      matchPointsDeniedHandling = true;
      clearMatchPointsDeniedTimers();
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      bootHardStop = true;
      transientMessage = null;

      renderMatchPointsDenied('对局积分不足，正在跳转个人中心…', 3);
      client.disconnect();

      let message = '对局积分不足，无法开始对局。';
      try {
        const info = await fetchMatchPointsInfo();
        if (info.canClaimDaily) {
          message = `对局积分不足。今日可领取 ${formatAmount(info.dailyClaimAmount ?? 4000)} 对局积分。`;
        } else {
          message = '对局积分不足。今日领取次数已用完。';
        }
      } catch {
        // fallback to generic wording when user info is unavailable
      }

      let remain = 3;
      renderMatchPointsDenied(message, remain);
      matchPointsDeniedTimeoutId = window.setTimeout(() => {
        clearMatchPointsDeniedTimers();
        toPersonalCenter();
      }, 3000);
	      matchPointsDeniedIntervalId = window.setInterval(() => {
        remain -= 1;
        if (remain <= 0) {
          clearMatchPointsDeniedTimers();
          return;
        }
        renderMatchPointsDenied(message, remain);
	      }, 1000);
	    };
	    const haltWithFatal = (params: { message: string; hint?: string; action?: OverlayAction }): void => {
	      if (reconnectTimer !== null) {
	        clearTimeout(reconnectTimer);
	        reconnectTimer = null;
	      }
	      bootHardStop = true;
	      transientMessage = null;
	      setFatalMessage(params.message, {
	        hint: params.hint ?? null,
	        action: params.action ?? null,
	      });
	      updateOverlay();
	      stopBootWithMessage(params.message);
	      client.disconnect();
	    };

    client.on('dshSeatJoined', (message) => {
      if (message.ok) return;
      haltWithFatal({
        message: '无法使用这张真人座位邀请。',
        hint: String(message.error ?? '').trim() || '邀请可能已使用、已过期，或与该座位不匹配。',
      });
    });

    client.on('dshSpectating', (message) => {
      if (message.ok) {
        window.history.replaceState(null, '', removeDshCapabilitiesFromUrl(window.location.href));
        return;
      }
      haltWithFatal({
        message: '无法进入这局 AI 麻将的旁观视角。',
        hint: String(message.error ?? '').trim() || '旁观票据可能已过期，请回到 DeepSeek Harness 重新打开牌桌。',
      });
    });

    const maybeAutoSeat = (): void => {
      if (isDshSpectator || dshHandBootstrap.mode === 'human-invite') {
        return;
      }
      if (!client.connected() || !seatsInitialized) {
        return;
      }

      // In authoritative mode, server requires identity binding (loginToken/apiToken)
      // before allowing seat claims. Ensure we don't send a seat UPDATE too early,
      // otherwise the attempt can be rejected and we may never retry.
      if (client.isAuthoritative() && !allowAuthoritativeSeat) {
        return;
      }

      if (client.seat !== null) {
        return;
      }

      const occupied = new Set<number>();
      for (const [, seatInfo] of client.seats.entries()) {
        if (seatInfo.seat !== null) {
          occupied.add(seatInfo.seat);
        }
      }

	      if (occupied.size >= 4) {
	        setFatalMessage('房间已满（4 人），无法加入。');
	        updateOverlay();
          if (!bootReleased) {
            stopBootWithMessage('房间已满（4 人），无法加入。');
          }
	        client.disconnect();
	        return;
	      }

      for (let seat = 0; seat < 4; seat++) {
        if (!occupied.has(seat)) {
          client.seats.set(client.playerId(), { seat });
          return;
        }
      }
    };

	    const recoverNewbieRoom = async (): Promise<void> => {
	      if (!isNewbieRoomRoute || newbieRecovering) {
	        return;
	      }
	      if (newbieRecoveryAttempts >= NEWBIE_RECOVERY_MAX_ATTEMPTS) {
	        haltWithFatal({
	          message: '新手房恢复失败：请返回首页重试。',
	          hint: '你可以回到首页，继续旧牌局或放弃后新开。',
	          action: {
	            label: '返回首页',
	            onClick: toHomePage,
	          },
	        });
	        return;
	      }
      newbieRecovering = true;
      newbieRecoveryAttempts += 1;
      transientMessage = '鉴权失效，正在恢复新手房…';
      updateOverlay();

	      try {
	        try {
	          await ensureUser({ strictExistingToken: true });
	          const resumed = isGuobiaoNewbieRoute ? await guobiaoNewbieStart() : await newbieStart();
          const resumedGameId = String(resumed.gameId ?? '').trim();
          if (!resumedGameId) {
            throw new Error('恢复失败：缺少 gameId');
          }
          if (resumedGameId !== gameId) {
            window.location.href = buildHandUrl(resumedGameId);
            return;
          }
          allowAuthoritativeSeat = true;
          transientMessage = '新手房已恢复，正在重连…';
          updateOverlay();
          if (reconnectTimer !== null) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
          }
          window.setTimeout(() => {
            if (!client.connected() && !fatalMessage) {
              connectToGame();
            }
          }, 50);
          return;
        } catch (err: unknown) {
          const active = normalizeActiveGame((err as any)?.data?.activeGame);
          if ((err as any)?.status === 409 && active && active.gameId !== String(gameId ?? '')) {
            transientMessage = '你已在其他对局中，正在跳转…';
            updateOverlay();
            window.location.href = buildHandUrlForRoom(active.gameId, active.roomType, active.gameType);
            return;
          }
          // fallback to force-create a new newbie room
        }

	        try {
	          await ensureUser();
	          const fresh = isGuobiaoNewbieRoute ? await guobiaoNewbieNew() : await newbieNew();
	          const freshGameId = String(fresh.gameId ?? '').trim();
	          if (!freshGameId) {
            throw new Error('新开失败：缺少 gameId');
          }
          window.location.href = buildHandUrl(freshGameId);
          return;
        } catch (newErr: unknown) {
          const active = normalizeActiveGame((newErr as any)?.data?.activeGame);
          if ((newErr as any)?.status === 409 && active && active.gameId !== String(gameId ?? '')) {
            transientMessage = '你已在其他对局中，正在跳转…';
            updateOverlay();
            window.location.href = buildHandUrlForRoom(active.gameId, active.roomType, active.gameType);
            return;
          }
          transientMessage = `恢复新手房失败：${errText(newErr)}`;
          updateOverlay();
        }
      } finally {
        newbieRecovering = false;
      }
    };

            client.match.on('update', (_entries, full) => {
              if (full) {
                matchInitialized = true;
                scheduleGuobiaoPrivateFaceResync();
              }
              syncBootState();
            });

	    client.seats.on('update', (_entries, full) => {
	      if (full) {
	        seatsInitialized = true;
	        scheduleGuobiaoPrivateFaceResync();
	      }
              syncBootState();
	      maybeAutoSeat();
	    });

	    client.on('serverError', (error: string) => {
	      const errorText = String(error ?? '');
	      const lowerError = errorText.toLowerCase();
	      if (errorText.includes(MATCH_POINTS_DENIED_ERROR)) {
	        void handleMatchPointsDenied();
	        return;
	      }
      if (errorText.includes('你已在其他对局中')) {
        void (async () => {
          try {
            await ensureUser({ strictExistingToken: true });
            const out = await fetchActiveGame();
            const active = normalizeActiveGame((out as any)?.activeGame);
            if (active && active.gameId !== String(gameId ?? '')) {
              haltWithFatal({
                message: '你已在其他对局中，无法同时开始多个对局。',
                hint: '请先回到进行中的对局，或回到创建房间页放弃旧牌局。',
                action: {
                  label: '前往进行中的对局',
                  onClick: () => {
                    window.location.href = buildHandUrlForRoom(active.gameId, active.roomType, active.gameType);
                  },
                },
              });
              return;
            }
          } catch {
            // ignore
          }
	          haltWithFatal({
	            message: '你已在其他对局中，无法同时开始多个对局。',
	            hint: '请回到首页继续旧牌局，或放弃旧牌局后新开。',
	            action: {
	              label: '返回首页',
	              onClick: toHomePage,
	            },
	          });
        })();
        return;
      }
      const gameNotFound = errorText.includes(GAME_NOT_FOUND_ERROR) || lowerError.includes('game not found');
	      if (gameNotFound) {
	        haltWithFatal({
	          message: '牌局不存在或已结束。',
	          hint: '该链接可能已过期，请返回首页继续。',
	          action: {
	            label: '返回首页',
	            onClick: toHomePage,
	          },
	        });
        return;
      }
	      const unauthorized = lowerError.includes('unauthorized');
	      if (unauthorized && isNewbieRoomRoute && !client.connected()) {
	        void recoverNewbieRoom();
	        return;
	      }
	      if (unauthorized && !isNewbieRoomRoute) {
	        haltWithFatal({
	          message: '账号鉴权失效，无法进入该牌局。',
	          hint: '请前往个人中心重新登录后，再从入口页进入。',
	          action: {
	            label: '前往个人中心',
	            onClick: toPersonalCenter,
	          },
	        });
	        return;
	      }
		      if (unauthorized) {
		        void (async () => {
		          try {
		            await syncProfileToGameClient(client, { strictExistingToken: true });
		          } catch {
		            // profile sync failure should not block seat claim retry
		          }
		          allowAuthoritativeSeat = true;
		          maybeAutoSeat();
		        })();
		        return;
	      }
	      transientMessage = `服务器错误：${errorText}`;
	      updateOverlay();
	    });

	    client.on('connect', () => {
              if (dshHandBootstrap.mode === 'human-invite') {
                // JOINED is emitted only after the server atomically claimed the requested seat.
                // Remove the one-time ticket from browser history before any refresh/reconnect.
                dshHumanInviteClaimed = true;
                window.history.replaceState(null, '', removeDshCapabilitiesFromUrl(window.location.href));
              }
              bootWsReady = true;
              syncBootState();
	      if (!isDshSpectator) {
	        // Standalone timeout fallback is per-decision, not an account trustee.
	        void refreshTrusteeStatus();
	      }
	      newbieRecovering = false;
	      newbieRecoveryAttempts = 0;
	      if (!client.isAuthoritative() && bloodController === null) {
	        bloodController = new BloodController(client, world);
	        (window as any).handDebug = { ...(window as any).handDebug, bloodController };
      }
		      // Sync nickname/avatar from user profile (if logged in on this device).
		      if (!isDshSpectator) void (async () => {
		        try {
		          await syncProfileToGameClient(client, { strictExistingToken: true });
		        } catch {
		          // profile sync failure should not block seat claim retry
		        }
		        allowAuthoritativeSeat = true;
		        // Retry seating after identity binding (important for authoritative mode).
		        maybeAutoSeat();
        // Extra retries in case the server hasn't processed BIND_USER yet.
        let tries = 0;
        const retry = (): void => {
          if (!client.connected() || client.seat !== null) return;
          if (tries >= 6) return;
          tries += 1;
          maybeAutoSeat();
          setTimeout(retry, 500);
        };
        setTimeout(retry, 500);
		      })();
	      if (reconnectTimer !== null) {
	        clearTimeout(reconnectTimer);
	        reconnectTimer = null;
	      }
	      clearTrusteeTransientMessageTimer();
	      trusteeTransientMessageToken += 1;
	      transientMessage = null;
	      updateOverlay();
              syncBootState();
	      maybeAutoSeat();
	    });

    client.on('connectionState', state => {
      if (fatalMessage) return;
      if (state === 'replaced') {
        haltWithFatal({
          message: '这张牌桌已在其他页面打开。',
          hint: '请在最新打开的页面继续；也可以选择在此页面继续。',
          action: { label: '在此页面继续', onClick: () => window.location.reload() },
        });
        return;
      }
      if (state === 'disconnected') connectionRecoveryActive = true;
      const message = state === 'synchronizing'
        ? connectionRecoveryActive ? '连接已恢复，正在同步牌局…' : null
        : state === 'recovering'
          ? connectionRecoveryActive ? '正在确认断线前的操作…' : null
          : state === 'disconnected'
            ? '连接已断开，正在重试…'
            : null;
      if (message) {
        connectionTransientMessage = message;
        transientMessage = message;
        updateOverlay();
        return;
      }
      if (state === 'ready' && transientMessage === connectionTransientMessage) {
        transientMessage = null;
        connectionTransientMessage = null;
        connectionRecoveryActive = false;
        updateOverlay();
      }
    });

		    client.on('disconnect', () => {
		      setTrusteeBtnVisible(false);
		      stopTrusteePolling();
		      if (fatalMessage) {
		        return;
		      }
		      handViewportLocked = false;
		      handViewportLockedRatio = handViewportRatio;
		      handViewportAutoStartedAt = 0;
			      handViewportAutoTimeoutFired = false;
			      handViewportAutoLastHeight = null;
			      handViewportAutoStableSamples = 0;
			      handViewportAutoMaxCroppedHeight = null;
			      handViewportAutoRerunFramesLeft = 0;
		              if (!bootReleased) {
		                bootWsReady = false;
		                bootSyncReady = false;
		                bootSceneReady = false;
	                bootHasGameState = false;
                bootHasServerTiles = false;
                showBoot('连接已断开，正在重试…', true, 'network');
              }
	      sawThingsFullUpdate = false;
	      handCropSettleUpdates = 0;
	      if (isNewbieRoomRoute && newbieRecovering) {
	        transientMessage = '鉴权恢复中…';
	        updateOverlay();
                syncBootState();
	        return;
	      }
	      transientMessage = '连接已断开，正在重试…';
	      updateOverlay();
              syncBootState();

      if (reconnectTimer === null) {
        reconnectTimer = window.setTimeout(() => {
          reconnectTimer = null;
          if (!client.connected() && !fatalMessage) {
            connectToGame();
          }
        }, 2000);
      }
    });

            bootWsReady = replayMode;
            bootSyncReady = false;
            bootSceneReady = false;
            bootFirstFrameReady = false;
            bootSeatCount = null;
            bootHasGameState = false;
            bootHasServerTiles = false;
            refreshBoot(client);
            if (historyMode) {
              try {
                const runtime=new HistoryRuntime(client,gameId,handParentOrigin,()=>{cameraDirty=true;syncBootState();});
                await runtime.start(q.get('share')??undefined);
                handHud.setReplayControls({canPrev:()=>runtime.canPrev(),canNext:()=>runtime.canNext(),onPrev:()=>runtime.prev(),onNext:()=>runtime.next(),canShare:false});
                seatsInitialized=true;matchInitialized=true;bootWsReady=true;syncBootState();
                (window as any).handDebug={...(window as any).handDebug,historyRuntime:runtime};
              } catch(err) {
                const message=err instanceof Error?err.message:'牌谱加载失败';setFatalMessage(message);updateOverlay();stopBootWithMessage(message);return;
              }
            } else if (caseMode) {
              try {
                const frame = await receivePartialCase(gameId, Number(q.get('eventIndex')), handParentOrigin);
                applyPartialCase(client, frame);
                handHud.setReplayControls({ canPrev: () => false, canNext: () => false, onPrev: () => {}, onNext: () => {}, canShare: false });
                seatsInitialized = true;
                matchInitialized = true;
                bootWsReady = true;
                syncBootState();
              } catch (err) {
                const message = err instanceof Error ? err.message : '案例加载失败';
                setFatalMessage(message);
                updateOverlay();
                stopBootWithMessage(message);
                return;
              }
            } else if (replayMode) {
              try {
                const replay = await loadReplayDetail();
                applyReplayDetail(replay.detail, replay.access);
              } catch (err: unknown) {
                const detail = String((err as any)?.message ?? err ?? '').trim() || '牌谱加载失败';
                setFatalMessage(detail, {
                  hint: '请从结算页、个人中心或分享链接重新进入。',
                });
                updateOverlay();
                stopBootWithMessage(detail);
                return;
              }
            } else {
	      connectToGame();
            }
    window.addEventListener('beforeunload', stopTrusteePolling);

    const tableBounds = new Box3();
    const handBounds = new Box3();
    const canonicalTableBounds = fillCanonicalTableBounds(new Box3());
    const canonicalHandBounds = fillCanonicalHandBounds(new Box3());
    let boundsSeat: number | null = null;
    let boundsGameType: string | null = null;

    const SHOW_HU_DEBUG = false;
    const renderHuDebugZones = (state: BloodState | null): void => {
      if (!SHOW_HU_DEBUG) {
        if (huDebug) huDebug.innerHTML = '';
        return;
      }
      if (!huDebug) return;
      huDebug.innerHTML = '';
      if (!state) return;
      const zones = world.getBloodMobileHuZones(state);
      if (!zones.some(Boolean)) return;

      const tableVp = mainView.getTableViewport();
      const toCss = (x: number, y: number): { left: number; top: number } => {
        // world coords -> NDC -> pixel (table viewport)
        const ndc = new Vector3(x, y, 0).project(mainView.camera);
        const px = ((ndc.x + 1) * 0.5) * tableVp.width + tableVp.left;
        const py = ((1 - ndc.y) * 0.5) * tableVp.height + tableVp.top;
        return { left: px, top: py };
      };

      for (const zone of zones) {
        if (!zone) continue;
        const [p0, , p2] = zone.corners;
        const c0 = toCss(p0.x, p0.y);
        const c2 = toCss(p2.x, p2.y);
        const left = Math.min(c0.left, c2.left);
        const top = Math.min(c0.top, c2.top);
        const width = Math.abs(c0.left - c2.left);
        const height = Math.abs(c0.top - c2.top);
        const div = document.createElement('div');
        div.className = 'hu-zone';
        div.style.left = `${left}px`;
        div.style.top = `${top}px`;
        div.style.width = `${width}px`;
        div.style.height = `${height}px`;
        huDebug.appendChild(div);
      }
    };

	    const loop = (): void => {
	      requestAnimationFrame(loop);
	      world.updateView();
	      mainView.updateViewport();
			      // 目标：取景只跟“设备尺寸/seat”走，不跟对局内容走（避免缩放抖动、避免不同玩家看到不同占屏）。
			      const gameType = world.conditions.gameType;
			      if (boundsSeat !== world.seat || boundsGameType !== gameType) {
			        const prevSeat = boundsSeat;
			        const prevGameType = boundsGameType;
			        boundsSeat = world.seat;
			        boundsGameType = gameType;
			        cameraDirty = true;
			        handCropPending = false;
			        handCropPendingFrames = 0;
			        // seat/gameType 变化：锁定结果不再可信，必须重置并重新采样。
			        handViewportLocked = false;
			        handViewportLockedRatio = handViewportRatio;
			        handViewportAutoStartedAt = 0;
			        handViewportAutoTimeoutFired = false;
			        handViewportAutoLastHeight = null;
			        handViewportAutoStableSamples = 0;
			        handViewportAutoMaxCroppedHeight = null;
			        handViewportAutoRerunFramesLeft = 0;
			        updateHandCropDebug({ trigger: 'hand-viewport-reset', prevSeat, seat: boundsSeat, prevGameType, gameType });
			      }
            if (sawThingsFullUpdate && !handViewportLocked && handViewportAutoRerunFramesLeft > 0 && world.seat !== null) {
              handViewportAutoRerunFramesLeft -= 1;
              cameraDirty = true;
            }
	          if (sawThingsFullUpdate && !handViewportLocked && handViewportAutoStartedAt > 0 && !handViewportAutoTimeoutFired) {
	            const now = performance.now();
	            if (now - handViewportAutoStartedAt > HAND_VIEWPORT_LOCK_TIMEOUT_MS) {
	              handViewportAutoTimeoutFired = true;
	              cameraDirty = true;
	              updateHandCropDebug({ trigger: 'hand-viewport-lock-timeout', sinceAutoMs: now - handViewportAutoStartedAt });
	            }
	          }
		      if (cameraDirty) {
		        // 先恢复到“基准手牌条高度”（由 viewportRatio 决定），再做裁切；
		        // 否则如果上一轮已经裁过，会导致本轮把“已裁后的高度”当成基准，出现牌大小漂移。
		        mainView.setHandViewport(handViewportRatio);

        // Safe-area（刘海/圆角/系统手势区）：把 px inset 转成 NDC，分别应用到 table/hand 视口，
        // 让“取景尽量放大”的同时避免关键内容落入不可用区域。
	        // /hand/ 的 1280×720 舞台允许压到刘海/圆角下，因此取景不做 safe-area 让步。
	        const safePx = { top: 0, right: 0, bottom: 0, left: 0 };
	        // 约定：手牌区顶部/底部固定留 1 个“渲染物理像素”，避免贴边裁切/取整抖动。
	        // - three.js renderer pixelRatio 被 clamp 到 3（见 MainView.updateViewport），因此这里用同一口径。
	        const renderPixelRatio = Math.min(window.devicePixelRatio * mainView.getStageScale(), 3);
	        const oneRenderPx = 1 / Math.max(1, renderPixelRatio);

        const tableVp0 = mainView.getTableViewport();
        const handVp0 = mainView.getHandViewport();
        if (mainView.handCamera instanceof OrthographicCamera) {
          // viewOffset 会改变投影矩阵；fit 与“测 topGapPx”必须在清掉 offset 的“完整视口”下完成。
          mainView.handCamera.clearViewOffset();
        }

        const seat = world.seat;
        if (seat !== null) {
          rotateBoundsForSeat(canonicalTableBounds, seat, tableBounds);
          rotateBoundsForSeat(canonicalHandBounds, seat, handBounds);
        } else {
          tableBounds.copy(canonicalTableBounds);
          handBounds.copy(canonicalHandBounds);
        }

	        // 先用“基准 hand viewport（未裁切）”fit 手牌相机，然后只裁掉顶部空白。
	        if (handVp0) {
	          const baseHandW = handVp0.width;
	          const baseHandH = handVp0.height;
	          const fullVp0 = {
            width: tableVp0.width,
            height: tableVp0.height + baseHandH,
          };

          const tableSafeNdc0 = computeSafeNdcInsetsForViewport(tableVp0, fullVp0, safePx);
          const handSafeNdc0 = computeSafeNdcInsetsForViewport(handVp0, fullVp0, safePx);

	          const minHandSafeNdc = clamp((2 * oneRenderPx) / Math.max(1, baseHandH), 0, 0.45);

	          const tableFitOptions0 = {
	            margin: 0.02,
	            coverScale: 1,
            maximizeFill: true,
            anchorBottom: true,
            elevationRatio: viewportRatio >= 2.0 ? 2.30 : 2.20,
            safeNdc: tableSafeNdc0,
          };
	          let handFitOptions0 = {
	            margin: 0.02,
	            coverScale: 0.94,
	            elevationRatio: 0.55,
	            minBack: World.WIDTH * 0.26,
	            iterations: 8,
	            recenter: true,
	            anchorBottom: true,
	            safeBottom: Math.max(minHandSafeNdc, handSafeNdc0.bottom),
	            safeTop: Math.max(minHandSafeNdc, handSafeNdc0.top),
	            safeLeft: handSafeNdc0.left,
	            safeRight: handSafeNdc0.right,
	          };

          // 基准相机（未裁切高度）：
          // - 桌面相机后面会因为 viewport 变化而重建，因此这里 fit 主要是为了“完整 fullVp0 下的 safeNdc”一致；
          // - 手牌相机必须先 fit，才能准确测出 topGapPx。
	          mainView.updateTableCameraFitToBounds(world.seat, tableBounds, tableFitOptions0);
	          mainView.updateHandCameraFitToBounds(world.seat, handBounds, handFitOptions0);

			          let desiredHandHeightInt: number | null = null;
			          let visibleReady = true;
			          if (seat !== null && mainView.handCamera) {
			            // 为“点选上抬”预留顶部空间：避免手牌条裁切后抬起的牌被顶边裁掉。
			            // 计算方式：将“上抬位移”投影到 NDC，确保 safeTop >= 抬起所需的 NDC 余量。
			            const slot0 = world.slots.get(`hand.0@${seat}`) ?? null;
			            const tileH = slot0 ? slot0.placeWithOffset(0).size.z : Size.TILE.y;
			            const raiseWorld = tileH * HAND_TAP_RAISE_RATIO;
			            const p0 = WORLD_CENTER.clone();
			            const p1 = WORLD_CENTER.clone();
			            if (seat === 0) p1.y += raiseWorld;
			            else if (seat === 1) p1.x -= raiseWorld;
			            else if (seat === 2) p1.y -= raiseWorld;
			            else p1.x += raiseWorld;
			            const ndc0 = p0.project(mainView.handCamera);
			            const ndc1 = p1.project(mainView.handCamera);
			            const raiseNdc = Math.abs(ndc1.y - ndc0.y);
			            const desiredSafeTop = clamp(Math.max(handFitOptions0.safeTop, raiseNdc + minHandSafeNdc), 0, 0.45);
			            if (desiredSafeTop > handFitOptions0.safeTop + 0.0005) {
			              handFitOptions0 = { ...handFitOptions0, safeTop: desiredSafeTop };
			              mainView.updateHandCameraFitToBounds(world.seat, handBounds, handFitOptions0);
			            }

			            const ndc = computeVisibleHandContentNdc(world, client, objectView, seat, mainView.handCamera);
			            if (ndc) {
			              const topGapPx = ((1 - ndc.maxY) * 0.5) * baseHandH;
			              const safeTopPx = (handFitOptions0.safeTop * baseHandH) / 2;
		              const extraTopPx = topGapPx - safeTopPx;
		              updateHandCropDebug({
		                seat,
		                baseHandW,
		                baseHandH,
		                ndcMaxY: ndc.maxY,
		                ndcMinY: ndc.minY,
		                measuredAt: performance.now(),
		                ndcSource: 'mesh',
		                meshCount: ndc.meshCount,
		                topGapPx,
		                safeTopPx,
		                extraTopPx,
		                oneRenderPx,
		                minHandSafeNdc,
		                handSafeNdc0,
		              });
		              if (Number.isFinite(extraTopPx) && extraTopPx > oneRenderPx * 0.51) {
		                const desired = Math.max(1, baseHandH - extraTopPx);
		                desiredHandHeightInt = Math.max(1, Math.round(desired));
		              }
		            } else {
		              // seat 已知但 mesh/内容还没 ready：延迟一帧后再触发一次 cameraDirty 来做裁切。
		              visibleReady = false;
		            }
		          } else if (seat === null) {
		            updateHandCropDebug({ seat: null });
		          }
	          if (!visibleReady && seat !== null) {
	            handCropPending = true;
	            handCropPendingFrames = 0;
	            updateHandCropDebug({ pending: true });
	          } else if (visibleReady) {
	            handCropPending = false;
	            handCropPendingFrames = 0;
	            updateHandCropDebug({ pending: false });
	          }

		          // 方案3：开局收敛时只“采样”裁切高度，稳定后只应用一次并锁定，避免出牌阶段抖动。
		          let lockHeightInt: number | null = null;
		          if (!handViewportLocked && sawThingsFullUpdate && seat !== null && visibleReady) {
		            if (handViewportAutoStartedAt <= 0) {
		              handViewportAutoStartedAt = performance.now();
		            }
		            const candidateHeightInt = desiredHandHeightInt ?? baseHandH;
		            if (handViewportAutoLastHeight === candidateHeightInt) {
		              handViewportAutoStableSamples += 1;
		            } else {
		              handViewportAutoStableSamples = 1;
	            }
	            handViewportAutoLastHeight = candidateHeightInt;
	            if (candidateHeightInt < baseHandH) {
	              handViewportAutoMaxCroppedHeight =
	                handViewportAutoMaxCroppedHeight === null
	                  ? candidateHeightInt
	                  : Math.max(handViewportAutoMaxCroppedHeight, candidateHeightInt);
	            }
	            updateHandCropDebug({
	              lockCandidateH: candidateHeightInt,
	              lockStable: handViewportAutoStableSamples,
	              lockTimeout: handViewportAutoTimeoutFired,
	              settleLeft: handCropSettleUpdates,
	            });

		            const stableEnough = handViewportAutoStableSamples >= HAND_VIEWPORT_LOCK_STABLE_SAMPLES;
		            const settleDone = handCropSettleUpdates <= 0;
		            if (settleDone && !stableEnough && !handViewportAutoTimeoutFired) {
		              const need = HAND_VIEWPORT_LOCK_STABLE_SAMPLES - handViewportAutoStableSamples;
		              if (need > 0) {
		                handViewportAutoRerunFramesLeft = Math.max(handViewportAutoRerunFramesLeft, need);
		              }
		            }
		            const shouldLockNow = (stableEnough && settleDone) || handViewportAutoTimeoutFired;
		            if (shouldLockNow) {
		              let targetHeightInt = candidateHeightInt;
		              // timeout 兜底：不追求“最瘦”，优先保证不裁切（保守取历史观测到的最大裁切高度=最少裁切）。
	              if (!stableEnough && handViewportAutoTimeoutFired && targetHeightInt < baseHandH && handViewportAutoMaxCroppedHeight !== null) {
	                targetHeightInt = Math.max(targetHeightInt, handViewportAutoMaxCroppedHeight);
	              }
	              targetHeightInt = Math.min(baseHandH, Math.max(1, targetHeightInt + HAND_VIEWPORT_LOCK_SAFE_PAD_PX));
	              lockHeightInt = targetHeightInt;
	            }
	          }

	          if (lockHeightInt !== null) {
	            // 变更 hand viewport 高度（只裁顶部）：table viewport 会随之变高。
	            if (Math.abs(lockHeightInt - baseHandH) >= 1) {
	              const fullHeight = tableVp0.height + baseHandH;
	              const ratio = (lockHeightInt + 0.01) / Math.max(1, fullHeight);
	              mainView.setHandViewport(ratio);
	              handViewportLockedRatio = ratio;
	            } else {
	              handViewportLockedRatio = handViewportRatio;
	            }
	            handViewportLocked = true;
	            updateHandCropDebug({ locked: true, lockedRatio: handViewportLockedRatio, lockedHandH: lockHeightInt });
	          }
	          if (handViewportLocked && lockHeightInt === null && Math.abs(handViewportLockedRatio - handViewportRatio) >= 0.0001) {
	            // cameraDirty 会先把 viewport 恢复到基准值：已锁定时需要把它还原回锁定值，避免丢失裁切结果。
	            mainView.setHandViewport(handViewportLockedRatio);
	          }

          // viewport 可能已变化：重建后的 table 相机需要按新 table viewport 再 fit 一次。
          const tableVp1 = mainView.getTableViewport();
          const handVp1 = mainView.getHandViewport();
          const fullVp1 = {
            width: tableVp1.width,
            height: tableVp1.height + (handVp1?.height ?? 0),
          };
          const tableSafeNdc1 = computeSafeNdcInsetsForViewport(tableVp1, fullVp1, safePx);
          const tableFitOptions1 = { ...tableFitOptions0, safeNdc: tableSafeNdc1 };
          mainView.updateTableCameraFitToBounds(world.seat, tableBounds, tableFitOptions1);

	          // 关键：用 OrthographicCamera.viewOffset 做“裁切而不缩放”。
	          // 让像素尺寸仍按 baseHandH 计算，但只渲染底部 [baseHandH - handH .. baseHandH] 这一段。
	          if (mainView.handCamera instanceof OrthographicCamera && handVp1) {
	            const newHandH = handVp1.height;
	            if (newHandH < baseHandH - 0.5) {
	              const offsetY = Math.max(0, Math.round(baseHandH - newHandH));
	              mainView.handCamera.setViewOffset(baseHandW, baseHandH, 0, offsetY, baseHandW, newHandH);
	              updateHandCropDebug({ applied: true, newHandH, offsetY, viewEnabled: true });
	            } else {
	              mainView.handCamera.clearViewOffset();
	              updateHandCropDebug({ applied: false, newHandH, offsetY: 0, viewEnabled: false });
	            }
	          }
	        }

	        cameraDirty = false;
	      }
	      // 有 seat 但手牌内容还没 ready：等 world.things 出现后触发一次 cameraDirty，让裁切真正落地。
	      if (!cameraDirty && handCropPending) {
	        handCropPendingFrames += 1;
	        const seatNow = world.seat;
	        if (seatNow === null || handCropPendingFrames > HAND_CROP_PENDING_MAX_FRAMES) {
	          handCropPending = false;
	          handCropPendingFrames = 0;
	          updateHandCropDebug({ pending: false, pendingReason: seatNow === null ? 'seat-null' : 'timeout' });
		        } else {
		          const visibleNow = computeVisibleHandContentBoundsFromPlaces(world, client, seatNow);
		          if (visibleNow) {
		            handCropPending = false;
		            handCropPendingFrames = 0;
		            cameraDirty = true;
	            updateHandCropDebug({ pending: false, pendingReason: 'ready->rerun' });
	          }
	        }
	      }
	      mainView.updateOutline(objectView.selectedObjects);
	      if (mainView.handCamera) {
	        touchUi.setCamera(mainView.handCamera);
	        touchUi.setViewport(mainView.getHandViewport());
      } else {
        touchUi.setCamera(mainView.camera);
      touchUi.setViewport(null);
      }
	      touchUi.updateObjects();
		      touchUi.update();
		      bloodUi.update();
		      guobiaoUi.update();
		      handHud.update();
		      renderHuDebugZones(client.blood.get(0) ?? null);
		      renderHuAnchorDebugRects(world, mainView);
		      mainView.render();
          if (!bootFirstFrameReady) {
            bootFirstFrameReady = true;
            refreshBoot(client);
          }
	    };
	    loop();
    }).catch((err) => {
	    // eslint-disable-next-line no-console
	    console.error(err);
      const detail = String((err as any)?.message ?? err ?? '').trim();
      const isWebglInitError = /webgl|getshaderprecisionformat|shaderprecision|three\.webglrenderer/i.test(detail.toLowerCase());
	    const msg = isWebglInitError
        ? (detail !== '' ? `图形初始化失败：${detail}` : '图形初始化失败：当前设备的 WebGL 环境异常，请稍后重试。')
        : (detail !== '' ? `资源加载失败：${detail}` : '资源加载失败，请刷新重试。');
	    setFatalMessage(msg);
      updateOverlay();
      stopBootWithMessage(msg);
    });
  })();
}
