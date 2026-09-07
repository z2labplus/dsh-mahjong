import { Quaternion, Vector2, Vector3 } from 'three';
import { Slot } from './slot';
import { Size } from './types';
import { SEAT_ROTATIONS } from './utils';

export function applyMobileHandLayout(slots: Map<string, Slot>, viewerSeat: number): void {
  // 目标：按 design/meld-layout-wireframe-v3.svg
  // - 上/下：副露与手牌同一横线（与 PC 一致：seat0 副露在右；seat2 副露在左）
  // - 左/右：副露与手牌同一竖线（左：手牌上/副露下；右：副露上/手牌下）
  // - 不再靠缩小左右两家：移动端通过“透视+相机取景”来塞下四家信息
  layoutPackedHandsAndMelds(slots, viewerSeat);
  layoutMarkers(slots);
  layoutDiscards(slots);
  // 新目标（移动端）：明牌尽量集中、看得更清晰
  // - 弃牌区贴中心盘（不再向外推开）
  // - 弃牌 ↔ 手牌/副露 之间只留“约 1 张牌宽”的间隙
  tightenHandDiscardGaps(slots, viewerSeat);
  // 角落避让：定缺标识可能与相邻玩家的明牌（尤其副露）发生遮挡，需要自动避让
  // （只移动标识，且只朝向“更靠近桌面中心”的方向移动，避免放大取景 bounds 导致明牌变小）。
  avoidMarkerOverlaps(slots);
}

const WORLD_SIZE = 174;
const STEP = Size.TILE.x; // 6
// 按需求：第二层弃牌“完全盖住”第一层，因此不做 XY 错位（shift=0）。
const DISCARD_STACK_SHIFT = 0;
// 第二层必须至少抬高 1 个“牌厚度”，否则会与第一层几何体穿插/抖动，视觉上像“贴图”不够立体。
const DISCARD_STACK_LIFT = Size.TILE.z + 0.05; // 与 setup-slots.ts 一致：≈ 4.05，略留缝隙避免 z-fighting
// 边缘内收：基于 852×393 设计稿，让四家信息更靠近中心，从而“最大化明牌占屏”。
const EDGE_INSET = STEP * 4; // 24
// 手牌/副露 与 弃牌之间的目标间隙（世界坐标）：参考 ref.jpg，约等于 1 张牌宽。
// 为保证“四家同构图”，不再按 viewerSeat 区分。
const HAND_DISCARD_GAP = STEP; // 6
// 左/右两家（相对本家）的 hand+meld+marker 额外向外侧平移（世界坐标）。
// 目的：消除与上家在角落处的“手牌/副露”重叠（不改斜度/不改相机）。
// 说明：该平移等价于“把侧家 hand↔discard 的 gap 增大 SIDE_HAND_MELD_OUT_SHIFT”。
const SIDE_HAND_MELD_OUT_SHIFT = 3.1;
// 设计稿约束：每家“手牌 + 副露”合计最多 18 张（不含弃牌/中心盘）。
// 该条形带用固定容量做“模板宽度”，不同对局内容只在条内变化，避免整体构图抖动。
const HAND_MELD_CAP = 18;
// 左/右两家（相对本家）的手牌略微缩小：为副露/明牌让位，避免在移动端被底部手牌条裁切。
// 注意：副露/弃牌必须保持 1（大小一致）。
const OTHER_HAND_SCALE_MAX = 0.9;
const OTHER_HAND_SCALE_MIN = 0.8;
// 左/右两家（相对本家）手牌牌间隙：希望“占用更少空间”但仍保留一点分隔感。
// 0.005 表示约 0.5% 的牌宽（按“缩放后的牌宽”计算）。
const OTHER_HAND_GAP_RATIO = 0.005;
// 定缺角标与手牌之间的间隙：按需求允许贴合（gap=0），避免角落区域与相邻玩家副露发生遮挡。
const MARKER_GAP = 0;
const EXTRA_GAP = STEP * 0.5; // 摸牌位(hand.extra)与手牌之间的“半格”间隙
// 手牌与副露之间的最小间隙：
// - 之前 0.5 格在正交“手牌条”视角下容易看起来像贴在一起
// - 提升到 0.75 格，让 UI 上能明显感知“手牌 vs 副露”的分区，但又不至于撑大 bounds 让牌变小
const HAND_MELD_GAP = STEP * 0.75;
// 极限压缩（仅在避免跨玩家遮挡时使用）：允许把手牌↔副露间隙压到约 0.2 张牌宽。
const HAND_MELD_GAP_TIGHT = STEP * 0.2;
// 左/右两家（相对本家）：手牌 ↔ 副露 之间更紧凑，给“4 组杠 + 2 张手牌”的极端情况留空间。
const HAND_MELD_GAP_SIDE = STEP * 0.1;
// 每组副露之间的小间隙：腾讯/手游会明显分组，但不宜过大（否则整体变长导致牌变小）。
const MELD_SET_GAP = STEP * 0.15;
// 角落安全区：避免相邻两家的“手牌/副露”在四个角落发生重叠（尤其是副露放在角落时）。
const CORNER_GAP = STEP * 2;
// /hand/ 桌面相机的 canonical bounds 底边是 y=42（见 src/hand.ts），低于此会被底部手牌视口裁掉。
// 固定模板 barMinU=33 会让“本家左右两家”的下侧内容落到 y<42，刷新后看起来像被手牌区挡住。
// 抬高 1 个牌面高度(9)即可对齐到 42，且不改变副露/弃牌的渲染尺寸。
const SIDE_BAR_MIN_U_SHIFT = Size.TILE.y; // 9
// 左玩家（屏幕左）手牌墙：为了与桌面矩形边框更平行，做轻微“整体旋转”。
// 含义：顶部相对底部在屏幕水平方向的目标偏移量（世界坐标单位，按 canonical 坐标系计算）。
// const LEFT_HAND_TOP_SHEAR = 0.55; // 0=不倾斜
const LEFT_HAND_TOP_SHEAR = 0; // 0=不倾斜
// 右玩家（屏幕右）手牌墙：同上，但可独立调参（避免左右联动）。
// const RIGHT_HAND_TOP_SHEAR = STEP * 0 // 3（默认与左一致）
const RIGHT_HAND_TOP_SHEAR = 0; // 0=不倾斜

const BASE_HAND_DIRECTIONS = new WeakMap<Slot, Vector2>();
const BASE_HAND_ROTATIONS = new WeakMap<Slot, Array<Quaternion>>();

function resetHandSlotGeometry(slot: Slot): void {
  let dir = BASE_HAND_DIRECTIONS.get(slot) ?? null;
  let rots = BASE_HAND_ROTATIONS.get(slot) ?? null;
  if (!dir || !rots) {
    dir = slot.direction.clone();
    rots = slot.rotations.map((r) => r.clone());
    BASE_HAND_DIRECTIONS.set(slot, dir);
    BASE_HAND_ROTATIONS.set(slot, rots);
    return;
  }
  // 性能：避免每次布局都 clone 新对象造成 GC 抖动；复位时就地 copy 即可。
  slot.direction.copy(dir);
  if (slot.rotations.length !== rots.length) {
    slot.rotations = rots.map((r) => r.clone());
    return;
  }
  for (let i = 0; i < rots.length; i++) {
    slot.rotations[i]?.copy(rots[i]);
  }
}

function layoutPackedHandsAndMelds(slots: Map<string, Slot>, viewerSeat: number): void {
  const minU = CORNER_GAP;
  const maxU = WORLD_SIZE - CORNER_GAP;
  const desiredCenter = (minU + maxU) * 0.5;
  // 852×393 设计稿：底部手牌条“白牌区”大约占 16%~18% 高度；
  // 对应世界坐标上，我们把“手牌+副露”压到一个固定宽度模板里（18 张），并锚定两端（手牌端/副露端）。
  const barSpanU = HAND_MELD_CAP * STEP;
  const barMinU = desiredCenter - barSpanU * 0.5;
  const barMaxU = desiredCenter + barSpanU * 0.5;

  // canonical(相对本家)坐标系里，Y 轴“向上”对应 world 坐标的哪个轴/方向（viewerSeat 旋转是 0/90/180/270 度）
  const viewerRot = ((viewerSeat % 4) + 4) % 4;
  const canonicalYWorldAxis: 'x' | 'y' =
    (viewerRot === 0 || viewerRot === 2) ? 'y' : 'x';
  const canonicalYWorldSign: number =
    viewerRot === 0 ? 1 :
    viewerRot === 1 ? -1 :
    viewerRot === 2 ? -1 :
    1; // viewerRot===3

  const prepareMeldSlot = (slot: Slot, seat: number, scale: number): void => {
    if (seat === 0) {
      slot.direction.set(-1, 1);
    } else if (seat === 2) {
      slot.direction.set(1, -1);
    } else if (seat === 1) {
      slot.direction.set(-1, -1);
    } else {
      slot.direction.set(1, 1);
    }
    // 极端情况下（例如 4 组明杠 + 少量手牌）会出现跨玩家遮挡：
    // - 优先压缩间隙
    // - 仍放不下时，对该玩家“手牌+副露”整体等比缩小（只影响 hand/meld/marker）
    slot.sizeScale = scale;
  };

  const computeMeldRowWidth = (rowSlots: Array<Slot>, axis: 'x' | 'y', fixed: number, meldColStep: number): number => {
    // 用临时坐标把这一组摆成一条线：rowStart=0，只关心组内宽度；平移不影响宽度。
    for (const slot of rowSlots) {
      const col = slot.indexes[1] ?? 0;
      const u = col * meldColStep;
      slot.origin = axis === 'x' ? new Vector3(u, fixed, 0) : new Vector3(fixed, u, 0);
      slot.offset.set(0, 0);
      slot.places = slot.rotations.map(slot.makePlace.bind(slot));
    }
    // 组内可能有横放/推位（push），需要先把 offset 算出来，再按真实 AABB 取宽度。
    for (const [source, target] of Slot.computePushes(rowSlots)) {
      target.handlePush(source);
    }

    let minEdge = Infinity;
    let maxEdge = -Infinity;
    for (const slot of rowSlots) {
      if (!slot.thing) continue;
      const rot = slot.thing.rotationIndex ?? 0;
      const place = slot.placeWithOffset(rot);
      const center = axis === 'x' ? place.position.x : place.position.y;
      const half = axis === 'x' ? place.size.x * 0.5 : place.size.y * 0.5;
      minEdge = Math.min(minEdge, center - half);
      maxEdge = Math.max(maxEdge, center + half);
    }
    if (!Number.isFinite(minEdge) || !Number.isFinite(maxEdge)) {
      return 0;
    }
    return maxEdge - minEdge;
  };

  for (let seat = 0; seat < 4; seat++) {
    const handSlots = [...slots.values()].filter((s) => s.seat === seat && s.group === 'hand');
    const meldSlots = [...slots.values()].filter((s) => s.seat === seat && s.group === 'meld');
    if (handSlots.length === 0 && meldSlots.length === 0) continue;

    for (const slot of handSlots) {
      resetHandSlotGeometry(slot);
    }
    for (const slot of meldSlots) {
      resetHandSlotGeometry(slot);
    }

    const mainHandSlots = handSlots.filter((s) => !s.name.startsWith('hand.extra'));
    const extra = handSlots.find((s) => s.name.startsWith('hand.extra')) ?? null;

    const axis: 'x' | 'y' = (seat === 0 || seat === 2) ? 'x' : 'y';
    const fixed =
      seat === 0 ? EDGE_INSET :
      seat === 2 ? WORLD_SIZE - EDGE_INSET :
      seat === 1 ? WORLD_SIZE - EDGE_INSET :
      EDGE_INSET;
    const handDir = (seat === 0 || seat === 1) ? 1 : -1; // seat0/1：索引递增沿 +u；seat2/3：沿 -u
    const rel = ((seat - viewerSeat) % 4 + 4) % 4; // 0=本家(下)，1=右，2=上，3=左（相对本家）
    const isSide = rel === 1 || rel === 3;
    const uToCanonicalSign = isSide && axis === canonicalYWorldAxis ? canonicalYWorldSign : 1;
    let handScale = isSide ? OTHER_HAND_SCALE_MAX : 1;
    let handTileU = STEP * handScale;
    let handGap = isSide ? handTileU * OTHER_HAND_GAP_RATIO : 0;
    let handStep = handTileU + handGap;
    const recomputeHandMetrics = (): void => {
      handTileU = STEP * handScale;
      handGap = isSide ? handTileU * OTHER_HAND_GAP_RATIO : 0;
      handStep = handTileU + handGap;
    };
    let seatBarMinU = barMinU;
    let seatBarMaxU = barMaxU;
    if (isSide) {
      // canonicalY min 对应 world 的一端：sign>0 => minU；sign<0 => maxU
      if (uToCanonicalSign > 0) {
        seatBarMinU = barMinU + SIDE_BAR_MIN_U_SHIFT;
      } else {
        seatBarMaxU = barMaxU - SIDE_BAR_MIN_U_SHIFT;
      }
    }
    const seatBarSpanU = seatBarMaxU - seatBarMinU;
    const markerSlot = [...slots.values()].find((s) => s.seat === seat && s.group === 'marker') ?? null;

    // 手牌有效长度：按“实际手牌张数”而不是 slot 最大索引，避免出现空洞时把布局/取景撑大。
    let handCount = 0;
    for (const s of mainHandSlots) {
      if (s.thing) handCount++;
    }
    const handSpanSlots = Math.min(14, Math.max(0, handCount));
    const hasExtra = !!extra?.thing;
    // 需求：只有“底部玩家(本家)”的摸牌(hand.extra)与手牌之间保留间隙；
    // 其余三家（左/右/上）不留缝，以减少遮挡风险并尽量缩短占用长度。
    const baseExtraGap = hasExtra && handSpanSlots > 0 ? (rel === 0 ? EXTRA_GAP : 0) : 0;
    let extraGapEnabled = baseExtraGap > 0;
    let extraGap = extraGapEnabled ? baseExtraGap * handScale : 0;
    const computeHandSpan = (): number => {
      if (handSpanSlots <= 0) {
        return hasExtra ? handTileU : 0;
      }
      if (hasExtra) {
        // n 张手牌占用：n*step + extraGap + tile
        // （其中 step=tile+gap，因此这会自然包含“手牌牌间隙”的占用）
        return handSpanSlots * handStep + extraGap + handTileU;
      }
      // n 张手牌占用：(n-1)*step + tile
      return (handSpanSlots - 1) * handStep + handTileU;
    };
    let handSpan = computeHandSpan();

    // 副露有效组数：按 row（0..3）统计，且每组占 4 张宽度（3+1 横放/推位）。
    let maxMeldRow = -1;
    for (const s of meldSlots) {
      if (!s.thing) continue;
      const row = s.indexes[0] ?? -1;
      if (row > maxMeldRow) maxMeldRow = row;
    }
    const meldSetCount = Math.max(0, maxMeldRow + 1);
    let meldColStep = STEP;
    // 稳健版：按“真实 AABB 宽度”计算每组副露占用（考虑横放/推位），避免碰牌(3张)额外空出1张宽。
    const rowWidths: Array<number> = meldSetCount > 0 ? new Array(meldSetCount).fill(0) : [];
    if (meldSetCount > 0) {
      for (let row = 0; row < meldSetCount; row++) {
        const rowSlots = meldSlots.filter((s) => (s.indexes[0] ?? 0) === row);
        for (const slot of rowSlots) {
          prepareMeldSlot(slot, seat, 1);
        }
        rowWidths[row] = computeMeldRowWidth(rowSlots, axis, fixed, meldColStep);
      }
    }
    const computeMeldRowStarts = (setGap: number): { rowStarts: Array<number>; span: number } => {
      const rowStarts: Array<number> = meldSetCount > 0 ? new Array(meldSetCount).fill(0) : [0];
      if (meldSetCount <= 0) {
        return { rowStarts, span: 0 };
      }
      for (let row = 1; row < meldSetCount; row++) {
        rowStarts[row] = rowStarts[row - 1] + (rowWidths[row - 1] ?? 0) + setGap;
      }
      const span = rowStarts[meldSetCount - 1] + (rowWidths[meldSetCount - 1] ?? 0);
      return { rowStarts, span };
    };
    let meldSetGap = MELD_SET_GAP;
    let { rowStarts: meldRowStarts, span: meldSpan } = computeMeldRowStarts(meldSetGap);

    // 固定模板条：手牌锚定一端，副露锚定另一端，未占用空间自然留在中间。
    // 若遇到“极端满载”导致模板装不下，则按优先级收缩间隙（不允许重叠）。
    let handMeldGap = meldSetCount > 0 ? (isSide ? HAND_MELD_GAP_SIDE : HAND_MELD_GAP) : 0;
    const computeRequired = (): number => handSpan + (meldSetCount > 0 ? (handMeldGap + meldSpan) : 0);
    let required = computeRequired();
    if (required > seatBarSpanU + 0.01) {
      // 先压缩“手牌↔副露”间隙（目标：~0.2 张牌宽）
      handMeldGap = Math.min(handMeldGap, HAND_MELD_GAP_TIGHT);
      required = computeRequired();
    }
    if (required > seatBarSpanU + 0.01 && extraGapEnabled && extraGap > 0) {
      extraGapEnabled = false;
      extraGap = 0;
      handSpan = computeHandSpan();
      required = computeRequired();
    }
    if (required > seatBarSpanU + 0.01 && meldSetGap > 0) {
      meldSetGap = 0;
      const res = computeMeldRowStarts(meldSetGap);
      meldRowStarts = res.rowStarts;
      meldSpan = res.span;
      required = computeRequired();
    }
    // 极端仍装不下：对该玩家“手牌+副露”整体等比缩小，避免跨玩家遮挡/角落重叠。
    // 说明：只缩放该玩家的 hand/meld（marker 在 layoutMarkers 中也会沿用 sizeScale），不影响弃牌/中心盘。
    let meldScale = 1;
    if (required > seatBarSpanU + 0.01) {
      const scale = seatBarSpanU > 0.01 ? seatBarSpanU / required : 1;
      if (Number.isFinite(scale) && scale > 0 && scale < 1) {
        meldScale = scale;
        // 缩放 tiles + 间隙（保持比例），并重新计算 span/starts
        handScale *= scale;
        recomputeHandMetrics();
        extraGap = extraGapEnabled ? baseExtraGap * handScale : 0;
        handSpan = computeHandSpan();
        handMeldGap *= scale;
        meldSetGap *= scale;
        meldColStep = STEP * scale;
        for (let i = 0; i < rowWidths.length; i++) {
          rowWidths[i] *= scale;
        }
        const res = computeMeldRowStarts(meldSetGap);
        meldRowStarts = res.rowStarts;
        meldSpan = res.span;
        required = computeRequired();
      }
    }

    // 兜底：若仍无法装下（理论上极少见），允许小幅溢出（维持旧逻辑）。
    const overflow = isSide && required > seatBarSpanU + 0.01 ? required - seatBarSpanU : 0;
    let expandedMinU = seatBarMinU;
    let expandedMaxU = seatBarMaxU;
    if (overflow > 0.01) {
      if (uToCanonicalSign > 0) {
        expandedMaxU += overflow;
      } else {
        expandedMinU -= overflow;
      }
    }

    if (markerSlot) {
      markerSlot.sizeScale = meldScale;
    }

    const setOrigin = (slot: Slot, u: number): void => {
      slot.origin = axis === 'x' ? new Vector3(u, fixed, 0) : new Vector3(fixed, u, 0);
      slot.offset.set(0, 0);
      slot.places = slot.rotations.map(slot.makePlace.bind(slot));
    };

    // 手牌 slots：只让“已使用前缀”展开；其余空槽堆叠在末尾，避免撑大取景/造成巨大空白。
    const baseHandU = handDir === 1 ? expandedMinU : expandedMaxU;
    for (const slot of mainHandSlots) {
      const idx = slot.indexes[0];
      if (idx === undefined) continue;
      const cap = Math.max(0, handSpanSlots - 1);
      const effectiveIdx = handSpanSlots > 0 ? Math.min(idx, cap) : 0;
      const u = baseHandU + handDir * effectiveIdx * handStep;
      slot.sizeScale = handScale;
      setOrigin(slot, u);
    }

    if (extra) {
      const u = baseHandU + handDir * (handSpanSlots * handStep + extraGap);
      extra.sizeScale = handScale;
      setOrigin(extra, u);
    }

    // 副露：与手牌同线，紧贴手牌末端；无副露时堆叠在手牌末端，避免空槽影响取景。
    const meldDir = -handDir; // seat0/1：向 -u 展开；seat2/3：向 +u 展开
    const baseMeldU = handDir === 1 ? expandedMaxU : expandedMinU;

    for (const slot of meldSlots) {
      const row = slot.indexes[0] ?? 0;
      const col = slot.indexes[1] ?? 0;
      const effectiveRow = meldSetCount > 0 ? Math.min(row, meldSetCount - 1) : 0;
      const effectiveCol = meldSetCount > 0 ? col : 0;
      const rowStart = meldRowStarts[effectiveRow] ?? 0;
      const visualOffset = rowStart + effectiveCol * meldColStep;
      const u = baseMeldU + meldDir * visualOffset;

      prepareMeldSlot(slot, seat, meldScale);
      setOrigin(slot, u);
    }

    // 左/右玩家（屏幕两侧）：整体旋转手牌墙（而不是逐张平移），避免出现“台阶/粘连”。
    // 目标：底部不动，顶部向外侧偏移（左=LEFT_HAND_TOP_SHEAR，右=RIGHT_HAND_TOP_SHEAR），并保持每张牌的朝向一致。
    const sideTiltSign = rel === 3 ? 1 : rel === 1 ? -1 : 0; // 左：向屏幕左偏；右：向屏幕右偏
    const sideShear =
      rel === 3 ? LEFT_HAND_TOP_SHEAR :
      rel === 1 ? RIGHT_HAND_TOP_SHEAR :
      0;
    if (sideTiltSign !== 0 && sideShear !== 0 && handSlots.length > 0) {
      const toCanonicalY = (p: Vector3): number =>
        canonicalYWorldAxis === 'x' ? canonicalYWorldSign * p.x : canonicalYWorldSign * p.y;

      const boundsSlots: Array<Slot> = mainHandSlots.length > 0 ? [...mainHandSlots] : [...handSlots];
      // 口径：侧边倾斜以“hand+meld 整体”为基准；当副露存在时必须纳入 span/pivot，
      // 否则在“多副露少手牌”时会出现大角度把副露甩出大位移（P1）。
      if (meldSetCount > 0) {
        boundsSlots.push(...meldSlots);
      }
      if (extra?.thing) {
        boundsSlots.push(extra);
      }

      let minY = Infinity;
      let maxY = -Infinity;
      let pivot: Vector3 | null = null;
      for (const slot of boundsSlots) {
        const y = toCanonicalY(slot.origin);
        if (!Number.isFinite(y)) continue;
        if (y < minY) {
          minY = y;
          pivot = slot.origin.clone();
        }
        if (y > maxY) {
          maxY = y;
        }
      }

      const span = maxY - minY;
      const desired = Math.abs(sideShear);
      if (pivot && Number.isFinite(span) && span > 0.01 && desired > 0.0001) {
        const ratio = Math.min(0.999, desired / span);
        const baseAngle = Math.asin(ratio);
        const shearSign = sideShear >= 0 ? 1 : -1;
        // 角度上限：避免极端牌形（跨度很短）导致角度过大、构图倾斜明显。
        const MAX_TILT_DEG = 3;
        const maxAngle = MAX_TILT_DEG * (Math.PI / 180);
        const rawAngle = sideTiltSign * shearSign * baseAngle;
        const angle = Math.max(-maxAngle, Math.min(maxAngle, rawAngle));
        const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), angle);

        const tiltSlots: Array<Slot> = [...handSlots, ...meldSlots];
        for (const slot of tiltSlots) {
          // 先旋转 origin（底部 pivot 不动）
          const p = slot.origin.clone().sub(pivot);
          p.applyQuaternion(q);
          slot.origin = p.add(pivot);
          // 再旋转牌本身朝向（避免“台阶”）
          for (const rot of slot.rotations) {
            rot.premultiply(q);
          }
          slot.offset.set(0, 0);
          slot.places = slot.rotations.map(slot.makePlace.bind(slot));
        }
      }
    }
  }
}

function layoutMarkers(slots: Map<string, Slot>): void {
  for (let seat = 0; seat < 4; seat++) {
    const markerSlots = [...slots.values()].filter((s) => s.seat === seat && s.group === 'marker');
    if (markerSlots.length === 0) continue;

    for (const slot of markerSlots) {
      // 需求：定缺角标要“清晰可见 + 不影响缩放”。
      // - 把 marker 放到“手牌线内侧”（靠近桌面中心的那一边），避免占用外侧空间导致相机缩小。
      // - 仍然锚定在手牌序列的起点（与副露相反侧），保持四家一致。
      const hand0 = slots.get(`hand.0@${seat}`) ?? null;
      if (!hand0) continue;

      // hand.0 旋转 0（STANDING）代表“手牌牌面”的标准尺寸
      const handPlace = hand0.places[0];
      const handSize = handPlace?.size ?? Size.TILE;

      const u = (seat === 0 || seat === 2) ? hand0.origin.x : hand0.origin.y;
      // 内侧边：沿“朝向桌面中心”的方向走 1 个手牌厚度（STANDING 的 size.y=4），贴到手牌线内侧
      if (seat === 0 || seat === 2) {
        // 底/顶：marker 放到手牌线上方/下方（朝中心）
        const innerY = hand0.origin.y + handSize.y * hand0.direction.y;
        slot.origin = new Vector3(u, innerY, 0);
      } else {
        // 左/右：marker 放到手牌线内侧（朝中心）
        const innerX = hand0.origin.x + handSize.x * hand0.direction.x;
        slot.origin = new Vector3(innerX, u, 0);
      }
      slot.offset.set(0, 0);
      slot.places = slot.rotations.map(slot.makePlace.bind(slot));
    }
  }
}

function layoutDiscards(slots: Map<string, Slot>): void {
  // 目标：弃牌区贴中心盘（与默认桌面一致），不做“向外推开”的二次偏移。
  // 这样可以消除“弃牌↔中心盘”之间的空白。
  for (let seat = 0; seat < 4; seat++) {
    const discardSlots = [...slots.values()].filter((s) => s.seat === seat && s.group === 'discard');
    if (discardSlots.length === 0) continue;

    // 用“基准 origin”（等价于 setup-slots.ts 的 discard 布局）重置全部弃牌位置。
    for (const slot of discardSlots) {
      const baseOrigin = computeDiscardBaseOrigin(slot);
      if (!baseOrigin) continue;
      slot.origin = baseOrigin;
      slot.offset.set(0, 0);
      slot.places = slot.rotations.map(slot.makePlace.bind(slot));
    }
  }
}

function tightenHandDiscardGaps(slots: Map<string, Slot>, viewerSeat: number): void {
  // 把“手牌/副露/定缺角标”往弃牌方向拉近，让弃牌与手牌之间只剩约 1 张牌宽的间隙。
  // 注意：弃牌区保持贴中心盘（layoutDiscards 已重置为基准 origin），我们只移动手牌侧内容，
  // 这样 bounds 会变小（更利于放大明牌），不会让明牌像素变小。
  for (let seat = 0; seat < 4; seat++) {
    // 只用“第一层弃牌区(6x3=18)”来做 gap 计算，避免第二层(叠层)空槽把 edge 推远导致布局抖动/留白。
    const discardSlots = [...slots.values()].filter(
      (s) => s.seat === seat && s.group === 'discard' && !s.name.startsWith('discard.stack')
    );
    if (discardSlots.length === 0) continue;

    const discardEdge = computeDiscardEdge(discardSlots, seat);
    // marker 可以位于“手牌↔弃牌”之间（设计稿需要），因此 gap 只以 hand+meld 为基准，不把 marker 当作边界。
    const handEdge = computeHandMeldEdge(slots, seat);
    if (discardEdge === null || handEdge === null) continue;

    // gap：弃牌外沿 ↔ 手牌/副露内沿
    // 统一为“期望 handEdge = discardEdge + sign * targetGap”：
    // - seat0/3：discardEdge - handEdge = gap，目标 gap=targetGap => handEdge = discardEdge - targetGap
    // - seat1/2：handEdge - discardEdge = gap，目标 gap=targetGap => handEdge = discardEdge + targetGap
    const sign = (seat === 0 || seat === 3) ? -1 : 1;
    // 侧家（屏幕左右）额外向外侧推一点，避免与上家在角落发生重叠。
    const rel = ((seat - viewerSeat) % 4 + 4) % 4; // 0=下(本家)，1=右，2=上，3=左（相对本家）
    const extra = (rel === 1 || rel === 3) ? SIDE_HAND_MELD_OUT_SHIFT : 0;
    const targetGap = HAND_DISCARD_GAP + extra;
    const targetHandEdge = discardEdge + sign * targetGap;
    const shift = targetHandEdge - handEdge; // shift>0: hand/meld/marker 向 +u 方向移动
    if (!Number.isFinite(shift) || Math.abs(shift) <= 0.01) {
      continue;
    }

    // 平移手牌/副露/marker，使 handEdge 精确贴合目标。
    const dx =
      seat === 1 ? shift :
      seat === 3 ? shift :
      0;
    const dy =
      seat === 0 ? shift :
      seat === 2 ? shift :
      0;

    for (const slot of slots.values()) {
      if (slot.seat !== seat) continue;
      if (slot.group !== 'hand' && slot.group !== 'meld' && slot.group !== 'marker') continue;
      slot.origin.x += dx;
      slot.origin.y += dy;
      slot.offset.set(0, 0);
      slot.places = slot.rotations.map(slot.makePlace.bind(slot));
    }
  }
}

type Rect = { minX: number; maxX: number; minY: number; maxY: number };

function rectFromSlotPlace(slot: Slot, rotationIndex: number): Rect | null {
  const place = slot.places[rotationIndex];
  if (!place) return null;
  const halfX = place.size.x * 0.5;
  const halfY = place.size.y * 0.5;
  return {
    minX: place.position.x - halfX,
    maxX: place.position.x + halfX,
    minY: place.position.y - halfY,
    maxY: place.position.y + halfY,
  };
}

function rectShift(rect: Rect, dx: number, dy: number): Rect {
  return { minX: rect.minX + dx, maxX: rect.maxX + dx, minY: rect.minY + dy, maxY: rect.maxY + dy };
}

function rectsOverlap(a: Rect, b: Rect, eps = 0.01): boolean {
  // 允许“贴边不算遮挡”，因此用 eps 处理浮点误差
  if (a.maxX <= b.minX + eps) return false;
  if (a.minX >= b.maxX - eps) return false;
  if (a.maxY <= b.minY + eps) return false;
  if (a.minY >= b.maxY - eps) return false;
  return true;
}

function avoidMarkerOverlaps(slots: Map<string, Slot>): void {
  // 只处理“已放置(thing!=null)的 marker”
  // 障碍物：所有可见 TILE + 其他 marker（按实际 rotationIndex 的 place 计算 bbox）
  const obstacles: Array<{ slot: Slot; rect: Rect }> = [];
  for (const slot of slots.values()) {
    if (!slot.thing) continue;
    const rot = slot.thing.rotationIndex ?? 0;
    const rect = rectFromSlotPlace(slot, rot);
    if (!rect) continue;
    obstacles.push({ slot, rect });
  }

  const step = STEP / 2; // 3，给一点细粒度避免“跳过”可行解
  const maxSteps = 16; // 最大偏移 48（足够从角落挪开，但仍在桌面可视范围内）

  for (let seat = 0; seat < 4; seat++) {
    const markerSlot = [...slots.values()].find((s) => s.seat === seat && s.group === 'marker' && !!s.thing) ?? null;
    if (!markerSlot || !markerSlot.thing) continue;

    const rot = markerSlot.thing.rotationIndex ?? 0;
    const baseRect = rectFromSlotPlace(markerSlot, rot);
    if (!baseRect) continue;

    const collides = (candidate: Rect): boolean => {
      for (const obs of obstacles) {
        if (obs.slot === markerSlot) continue;
        if (rectsOverlap(candidate, obs.rect)) {
          return true;
        }
      }
      return false;
    };

    if (!collides(baseRect)) {
      continue;
    }

    // 约束：只向“更靠近桌面中心”的方向搜索，避免 marker 外扩导致 fit-to-content 取景变小。
    const dxSign = (seat === 0 || seat === 3) ? 1 : -1;
    const dySign = (seat === 0 || seat === 1) ? 1 : -1;

    let bestDx = 0;
    let bestDy = 0;
    let found = false;

    // 以“最小移动量”为优先：按曼哈顿半径逐层搜索（0,1,2...）
    for (let total = 1; total <= maxSteps && !found; total++) {
      for (let dxSteps = 0; dxSteps <= total; dxSteps++) {
        const dySteps = total - dxSteps;
        const dx = dxSign * dxSteps * step;
        const dy = dySign * dySteps * step;
        const candidate = rectShift(baseRect, dx, dy);
        if (!collides(candidate)) {
          bestDx = dx;
          bestDy = dy;
          found = true;
          break;
        }
      }
    }

    if (!found) {
      // 保守兜底：找不到无碰撞位置就不动（避免引入更大的布局问题）
      continue;
    }

    markerSlot.origin.x += bestDx;
    markerSlot.origin.y += bestDy;
    markerSlot.offset.set(0, 0);
    markerSlot.places = markerSlot.rotations.map(markerSlot.makePlace.bind(markerSlot));
  }
}

export function computeHandMeldMarkerEdge(slots: Map<string, Slot>, seat: number): number | null {
  const relevant = [...slots.values()].filter((s) =>
    s.seat === seat && (s.group === 'hand' || s.group === 'meld' || s.group === 'marker')
  );
  if (relevant.length === 0) return null;

  let edge: number | null = null;
  for (const slot of relevant) {
    const rotationIndexes =
      slot.group === 'hand' ? [0] :
      slot.group === 'marker' ? [Math.min(1, slot.places.length - 1)] :
      [0, 1].filter((i) => i < slot.places.length);

    for (const rot of rotationIndexes) {
      const place = slot.places[rot];
      if (!place) continue;
      const minX = place.position.x - place.size.x * 0.5;
      const maxX = place.position.x + place.size.x * 0.5;
      const minY = place.position.y - place.size.y * 0.5;
      const maxY = place.position.y + place.size.y * 0.5;

      if (seat === 0) edge = edge === null ? maxY : Math.max(edge, maxY); // hand/meld 上沿
      else if (seat === 2) edge = edge === null ? minY : Math.min(edge, minY); // hand/meld 下沿
      else if (seat === 1) edge = edge === null ? minX : Math.min(edge, minX); // hand/meld 左沿
      else edge = edge === null ? maxX : Math.max(edge, maxX); // seat3 hand/meld 右沿
    }
  }
  return edge;
}

export function computeHandMeldEdge(slots: Map<string, Slot>, seat: number): number | null {
  const relevant = [...slots.values()].filter((s) => s.seat === seat && (s.group === 'hand' || s.group === 'meld'));
  if (relevant.length === 0) return null;

  let edge: number | null = null;
  for (const slot of relevant) {
    const rotationIndexes = slot.group === 'hand' ? [0] : [0, 1].filter((i) => i < slot.places.length);
    for (const rot of rotationIndexes) {
      const place = slot.places[rot];
      if (!place) continue;
      const minX = place.position.x - place.size.x * 0.5;
      const maxX = place.position.x + place.size.x * 0.5;
      const minY = place.position.y - place.size.y * 0.5;
      const maxY = place.position.y + place.size.y * 0.5;

      if (seat === 0) edge = edge === null ? maxY : Math.max(edge, maxY);
      else if (seat === 2) edge = edge === null ? minY : Math.min(edge, minY);
      else if (seat === 1) edge = edge === null ? minX : Math.min(edge, minX);
      else edge = edge === null ? maxX : Math.max(edge, maxX);
    }
  }
  return edge;
}

export function computeDiscardEdge(discardSlots: Array<Slot>, seat: number): number | null {
  let edge: number | null = null;
  for (const slot of discardSlots) {
    const rotationIndexes = [0, 1].filter((i) => i < slot.places.length);
    for (const rot of rotationIndexes) {
      const place = slot.places[rot];
      if (!place) continue;
      const minX = place.position.x - place.size.x * 0.5;
      const maxX = place.position.x + place.size.x * 0.5;
      const minY = place.position.y - place.size.y * 0.5;
      const maxY = place.position.y + place.size.y * 0.5;

      if (seat === 0) edge = edge === null ? minY : Math.min(edge, minY); // discard 下沿
      else if (seat === 2) edge = edge === null ? maxY : Math.max(edge, maxY); // discard 上沿
      else if (seat === 1) edge = edge === null ? maxX : Math.max(edge, maxX); // discard 右沿
      else edge = edge === null ? minX : Math.min(edge, minX); // seat3 discard 左沿
    }
  }
  return edge;
}

function computeDiscardBaseOrigin(slot: Slot): Vector3 | null {
  const seat = slot.seat;
  if (seat === null) return null;

  // seat0 下的 discard 基准 origin（未 rotate）来自 setup-slots.ts：
  // - discard: origin(69,60) + col*(0,-TILE.y) + row*(TILE.x,0)
  // - discard.extra: origin(69+6*TILE.x, 60-2*TILE.y) + i*(TILE.x,0)
  const isExtra = slot.name.startsWith('discard.extra');
  const isStack = slot.name.startsWith('discard.stack');
  const base = isExtra
    ? new Vector3(69 + 6 * Size.TILE.x, 60 - 2 * Size.TILE.y, 0)
    : new Vector3(69, 60, 0);

  if (isExtra) {
    const i = slot.indexes[0];
    if (i === undefined) return null;
    base.add(new Vector3(i * Size.TILE.x, 0, 0));
  } else {
    const col = slot.indexes[0];
    const row = slot.indexes[1];
    if (col === undefined || row === undefined) return null;
    base.add(new Vector3(row * Size.TILE.x, col * -Size.TILE.y, 0));
  }

  // 旋转到对应 seat 的世界坐标（等价于 Slot.rotate 的 origin 处理）
  const center = WORLD_SIZE / 2;
  const pos = base.clone().sub(new Vector3(center, center, 0));
  pos.applyQuaternion(SEAT_ROTATIONS[seat]);
  pos.add(new Vector3(center, center, 0));

  // 第二层弃牌：轻微错位 + 抬高（避免 z-fighting），并且“向各自玩家方向”偏移，避免压到中心盘。
  if (isStack) {
    if (seat === 0) pos.y -= DISCARD_STACK_SHIFT;
    else if (seat === 2) pos.y += DISCARD_STACK_SHIFT;
    else if (seat === 1) pos.x += DISCARD_STACK_SHIFT;
    else pos.x -= DISCARD_STACK_SHIFT;
    pos.z += DISCARD_STACK_LIFT;
  }
  return pos;
}

// NOTE: 本文件在极端情况下会对单个 seat 的 hand/meld/marker 做轻量 sizeScale 缩放，以避免跨玩家遮挡。
// 若将来需要更激进的紧凑化，优先考虑“相机取景/角落安全区/分行”等结构性方案。
