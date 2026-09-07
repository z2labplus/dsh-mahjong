import { Vector3 } from 'three';

import { Client } from './client';
import type { GuobiaoAction, GuobiaoChiOption, GuobiaoHuKind, GuobiaoState, GuobiaoTileMeld } from './guobiao';
import { guobiaoTileLabel, isGuobiaoFlower } from './guobiao-tiles';
import { GameType, type Place } from './types';
import { World } from './world';
import type { MainView } from './main-view';
import { computeDiscardEdge, computeHandMeldEdge } from './mobile-hand-layout';
import { calculateGuobiaoFans, type GuobiaoFanMeld, type GuobiaoWinContext } from '../server/core/guobiao-fan';
import { isGuobiaoLastTileSelfDraw } from '../server/core/guobiao-win-context';

type RectPx = { left: number; top: number; right: number; bottom: number };

type PanelButton = {
  label: string;
  cls?: string;
  disabled?: boolean;
  hidden?: boolean;
  onClick?: () => void;
};

type HandTile = { tileId: number; tileKey: number; slotName: string };

type GangUiOption =
  | { kind: 'anGang'; tileKey: number; tileIds: Array<number> }
  | { kind: 'addGang'; tileKey: number; tileId: number; meldId: number };

type HuCheck = {
  canHu: boolean;
  huKind: GuobiaoHuKind;
  fanTotal: number;
  qualifyingFanTotal: number;
  baseRuleScore: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const PROJECT_CORNERS = Array.from({ length: 8 }, () => new Vector3());

function projectAabbToNdc(
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
  camera: any,
): { minX: number; maxX: number; minY: number; maxY: number } | null {
  PROJECT_CORNERS[0].set(minX, minY, minZ);
  PROJECT_CORNERS[1].set(minX, minY, maxZ);
  PROJECT_CORNERS[2].set(minX, maxY, minZ);
  PROJECT_CORNERS[3].set(minX, maxY, maxZ);
  PROJECT_CORNERS[4].set(maxX, minY, minZ);
  PROJECT_CORNERS[5].set(maxX, minY, maxZ);
  PROJECT_CORNERS[6].set(maxX, maxY, minZ);
  PROJECT_CORNERS[7].set(maxX, maxY, maxZ);

  let outMinX = Infinity;
  let outMaxX = -Infinity;
  let outMinY = Infinity;
  let outMaxY = -Infinity;
  for (const corner of PROJECT_CORNERS) {
    corner.project(camera);
    outMinX = Math.min(outMinX, corner.x);
    outMaxX = Math.max(outMaxX, corner.x);
    outMinY = Math.min(outMinY, corner.y);
    outMaxY = Math.max(outMaxY, corner.y);
  }
  if (!Number.isFinite(outMinX) || !Number.isFinite(outMaxX) || !Number.isFinite(outMinY) || !Number.isFinite(outMaxY)) {
    return null;
  }
  return { minX: outMinX, maxX: outMaxX, minY: outMinY, maxY: outMaxY };
}

function projectPlaceToRectPx(
  place: Place,
  camera: any,
  tableVp: { left: number; top: number; width: number; height: number },
): RectPx | null {
  const hx = place.size.x * 0.5;
  const hy = place.size.y * 0.5;
  const hz = place.size.z * 0.5;
  const ndc = projectAabbToNdc(
    place.position.x - hx,
    place.position.y - hy,
    place.position.z - hz,
    place.position.x + hx,
    place.position.y + hy,
    place.position.z + hz,
    camera,
  );
  if (!ndc) return null;

  let left = tableVp.left + ((ndc.minX + 1) * 0.5) * tableVp.width;
  let right = tableVp.left + ((ndc.maxX + 1) * 0.5) * tableVp.width;
  let top = tableVp.top + ((1 - ndc.maxY) * 0.5) * tableVp.height;
  let bottom = tableVp.top + ((1 - ndc.minY) * 0.5) * tableVp.height;
  if (!Number.isFinite(left) || !Number.isFinite(right) || !Number.isFinite(top) || !Number.isFinite(bottom)) {
    return null;
  }
  if (left > right) [left, right] = [right, left];
  if (top > bottom) [top, bottom] = [bottom, top];
  return { left, top, right, bottom };
}

function projectPointToPx(
  p: Vector3,
  camera: any,
  tableVp: { left: number; top: number; width: number; height: number },
): { x: number; y: number } | null {
  const ndc = p.clone().project(camera);
  if (!Number.isFinite(ndc.x) || !Number.isFinite(ndc.y)) return null;
  const x = tableVp.left + ((ndc.x + 1) * 0.5) * tableVp.width;
  const y = tableVp.top + ((1 - ndc.y) * 0.5) * tableVp.height;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

export class GuobiaoUi {
  private client: Client;
  private world: World;
  private mainView: MainView;
  private root: HTMLElement;
  private mainEl: HTMLElement | null = null;
  private panelEl: HTMLDivElement | null = null;
  private flowerHintLayerEl: HTMLDivElement | null = null;
  private interactiveEnabled: boolean;

  constructor(client: Client, world: World, mainView: MainView, root: HTMLElement, options?: { interactive?: boolean }) {
    this.client = client;
    this.world = world;
    this.mainView = mainView;
    this.root = root;
    this.mainEl = document.getElementById('main');
    this.interactiveEnabled = options?.interactive !== false;
    this.client.gb.on('update', this.render.bind(this));
    this.client.seats.on('update', this.render.bind(this));
    this.client.match.on('update', this.render.bind(this));
    this.client.tileFaceSelf.on('update', this.render.bind(this));
    this.client.tileFacePublic.on('update', this.render.bind(this));
    this.client.on('actionAck', () => this.render());
    this.render();
  }

  private send(action: GuobiaoAction): void {
    this.client.sendGbAction(action);
  }

  private hide(): void {
    this.root.innerHTML = '';
    this.root.style.display = 'none';
    this.panelEl = null;
    this.flowerHintLayerEl = null;
  }

  private render(): void {
    if (!this.interactiveEnabled) {
      return;
    }
    const match = this.client.match.get(0);
    if (!match) {
      this.hide();
      return;
    }
    if (match.conditions.gameType !== GameType.GUOBIAO) {
      return;
    }
    const seat = this.client.seat;
    const state = this.client.gb.get(0) as GuobiaoState | null;
    if (seat === null || !state) {
      this.hide();
      return;
    }

    const buttons: Array<PanelButton> = [];
    let title = '国标麻将';

    if (state.phase === 'done' || state.phase === 'settling') {
      this.hide();
      return;
    }

    const pending = state.pending;
    if (pending) {
      const opt = pending.options?.[seat] ?? null;
      const response = pending.responses?.[seat] ?? null;
      const any = !!(opt && (opt.hu || opt.mingGang || opt.peng || opt.chi.length > 0));
      if (!any || response !== null || seat === pending.fromSeat) {
        if (response !== null && any) {
          const responseIsWrongHu = response.action === 'hu' && opt?.huKind === 'wrongHuRisk';
          this.showPanel('等待其他玩家响应', [
            {
              label: response.action === 'mingGang'
                ? '杠'
                : response.action === 'chi'
                  ? '吃'
                  : response.action === 'peng'
                    ? '碰'
                    : response.action === 'hu'
                      ? (responseIsWrongHu ? '错和' : '和')
                      : '过',
              disabled: true,
              cls: responseIsWrongHu ? 'action-wrong-hu' : responseClass(response.action),
            },
          ]);
          return;
        }
        this.hide();
        return;
      }

      if (opt.hu) {
        const sendHu = () => this.send({ kind: 'claim', pendingId: pending.id, action: 'hu' });
        const wrongHuRisk = opt.huKind === 'wrongHuRisk';
        buttons.push({
          label: wrongHuRisk ? '错和' : '和',
          cls: wrongHuRisk ? 'action-wrong-hu' : 'action-hu',
          onClick: () => {
            if (wrongHuRisk) {
              this.showWrongHuConfirm(state, null, sendHu);
              return;
            }
            sendHu();
          },
        });
      }
      if (opt.mingGang) {
        buttons.push({
          label: '杠',
          cls: 'action-gang action-gang-act',
          onClick: () => this.send({ kind: 'claim', pendingId: pending.id, action: 'mingGang' }),
        });
      }
      if (opt.peng) {
        buttons.push({
          label: '碰',
          cls: 'action-peng action-peng-act',
          onClick: () => this.send({ kind: 'claim', pendingId: pending.id, action: 'peng' }),
        });
      }
      if (opt.chi.length === 1) {
        buttons.push({
          label: '吃',
          cls: 'action-chi action-chi-act',
          onClick: () => this.send({ kind: 'claim', pendingId: pending.id, action: 'chi', optionId: opt.chi[0]!.optionId }),
        });
      } else if (opt.chi.length > 1) {
        buttons.push({
          label: '吃',
          cls: 'action-chi action-chi-act',
          onClick: () => this.showChiPanel(pending.id, opt.chi),
        });
      }
      buttons.push({
        label: '过',
        cls: 'secondary action-pass',
        onClick: () => this.send({ kind: 'claim', pendingId: pending.id, action: 'pass' }),
      });
      this.showPanel(pending.kind === 'robGangHu' ? '可抢杠和' : '', buttons);
      return;
    }

    if (state.turnSeat === seat && state.turnStep === 'discard') {
      title = '轮到你出牌';
      const player = state.players?.[seat] ?? null;
      const selfHu = this.computeSelfHu(state, seat, { ignoreWrongHu: player?.wrongHu === true });
      let lockedHuMessage: string | null = null;
      if (selfHu.canHu) {
        if (player?.wrongHu === true) {
          lockedHuMessage = '本盘已错和，不能再胡';
        } else {
          const sendSelfHu = () => this.send({ kind: 'hu', source: 'self' });
          const wrongHuRisk = selfHu.huKind === 'wrongHuRisk';
          buttons.push({
            label: wrongHuRisk ? '错和' : '和',
            cls: wrongHuRisk ? 'action-wrong-hu' : 'action-hu',
            onClick: () => {
              if (wrongHuRisk) {
                this.showWrongHuConfirm(state, selfHu, sendSelfHu);
                return;
              }
              sendSelfHu();
            },
          });
        }
      }
      const flower = this.findActionFlowerInHand(seat);
      let hasFlowerAction = false;
      if (flower !== null) {
        if (this.canBuhuaNow(state, seat, flower)) {
          hasFlowerAction = true;
          buttons.push({
            label: '补花',
            cls: 'action-buhua',
            onClick: () => this.send({ kind: 'buhua', tileId: flower.tileId }),
          });
        }
        hasFlowerAction = true;
        buttons.push({
          label: '打出',
          cls: 'action-flower-discard',
          onClick: () => this.send({ kind: 'discard', tileId: flower.tileId }),
        });
      }
      const gangOptions = this.findGangOptions(state, seat);
      if (gangOptions.length === 1) {
        buttons.push({
          label: '杠',
          cls: 'action-gang action-gang-act',
          onClick: () => this.sendGang(gangOptions[0]!),
        });
      } else if (gangOptions.length > 1) {
        buttons.push({
          label: '杠',
          cls: 'action-gang action-gang-act',
          onClick: () => this.showGangPanel(gangOptions),
        });
      }
      if (buttons.length === 0 && lockedHuMessage === null) {
        this.hide();
        return;
      }
      const flowerHints = hasFlowerAction ? this.findBuhuaHintFlowers(state, seat) : [];
      this.showPanel(hasFlowerAction ? '' : title, buttons, lockedHuMessage ?? undefined);
      this.renderFlowerHints(flowerHints);
      return;
    }

    this.hide();
  }

  private showChiPanel(pendingId: number, options: Array<GuobiaoChiOption>): void {
    const buttons: Array<PanelButton> = options.map((option) => ({
      label: shortSequenceLabel(option.sequence),
      cls: 'action-chi action-chi-act',
      onClick: () => this.send({ kind: 'claim', pendingId, action: 'chi', optionId: option.optionId }),
    }));
    buttons.push({
      label: '过',
      cls: 'secondary action-pass',
      onClick: () => this.send({ kind: 'claim', pendingId, action: 'pass' }),
    });
    this.showPanel('选择吃法', buttons);
  }

  private showGangPanel(options: Array<GangUiOption>): void {
    const buttons: Array<PanelButton> = options.map((option) => ({
      label: shortTileLabel(option.tileKey),
      cls: 'action-gang action-gang-act',
      onClick: () => this.sendGang(option),
    }));
    buttons.push({
      label: '过',
      cls: 'secondary action-pass',
      onClick: () => this.hide(),
    });
    this.showPanel('选择杠牌', buttons);
  }

  private showWrongHuConfirm(state: GuobiaoState, huCheck: HuCheck | null, onConfirm: () => void): void {
    const baseRuleScore = huCheck?.baseRuleScore ?? state.baseRuleScore;
    const pointPenalty = 10 * state.pointsScale;
    const fanText = huCheck
      ? `当前可计入起和 ${huCheck.qualifyingFanTotal} 番，未达 ${baseRuleScore} 番。`
      : `当前牌型未达 ${baseRuleScore} 番。`;
    this.showPanel('未达 8 番', [
      {
        label: '返回',
        cls: 'secondary',
        onClick: () => this.render(),
      },
      {
        label: '确认错和',
        cls: 'action-wrong-hu',
        onClick: onConfirm,
      },
    ], `${fanText}确认后按错和处理，向其他三家各付 ${pointPenalty} 积分，本局不能再和。`);
  }

  private sendGang(option: GangUiOption): void {
    if (option.kind === 'anGang') {
      this.send({ kind: 'anGang', tileKey: option.tileKey, tileIds: option.tileIds });
      return;
    }
    this.send({ kind: 'addGang', tileId: option.tileId, meldId: option.meldId });
  }

  private showPanel(titleText: string, buttons: Array<PanelButton>, messageText?: string): void {
    this.root.style.display = 'block';
    this.root.innerHTML = '';
    this.panelEl = null;
    const panel = document.createElement('div');
    panel.className = 'blood-panel';
    if (titleText.trim().length > 0) {
      const title = document.createElement('div');
      title.className = 'blood-title';
      title.textContent = titleText;
      panel.appendChild(title);
    }
    if (messageText && messageText.trim().length > 0) {
      const message = document.createElement('div');
      message.className = 'blood-title';
      message.textContent = messageText;
      message.style.maxWidth = 'calc(var(--action-btn, 56px) * 5.4)';
      message.style.whiteSpace = 'normal';
      message.style.textAlign = 'center';
      message.style.lineHeight = '1.35';
      message.style.fontSize = 'calc(var(--action-btn, 56px) * 0.22)';
      message.style.fontWeight = '700';
      panel.appendChild(message);
    }
    if (buttons.length > 0) {
      const row = document.createElement('div');
      row.className = 'blood-row';
      for (const b of buttons) {
        const btn = document.createElement('button');
        btn.className = `blood-btn${b.cls ? ` ${b.cls}` : ''}`;
        btn.type = 'button';
        if (b.label.length > 1) {
          const label = document.createElement('span');
          label.textContent = b.label;
          label.style.display = 'inline-block';
          label.style.fontSize = b.label.length >= 4
            ? 'calc(var(--action-btn, 56px) * 0.26)'
            : 'calc(var(--action-btn, 56px) * 0.38)';
          label.style.transform = 'scaleX(0.86)';
          label.style.transformOrigin = 'center';
          btn.appendChild(label);
        } else {
          btn.textContent = b.label;
        }
        const hidden = b.hidden === true;
        btn.disabled = b.disabled === true || hidden;
        if (hidden) {
          btn.style.visibility = 'hidden';
          btn.style.pointerEvents = 'none';
          btn.tabIndex = -1;
        }
        btn.onclick = () => {
          if (btn.disabled) return;
          btn.disabled = true;
          this.world.onSelect([]);
          b.onClick?.();
        };
        row.appendChild(btn);
      }
      panel.appendChild(row);
    }
    this.root.appendChild(panel);
    this.panelEl = panel;
    this.update();
  }

  private renderFlowerHints(flowers: Array<HandTile>): void {
    if (flowers.length === 0) {
      this.flowerHintLayerEl?.remove();
      this.flowerHintLayerEl = null;
      return;
    }

    const layer = document.createElement('div');
    layer.className = 'gb-flower-hints';
    for (const flower of flowers) {
      const hint = document.createElement('div');
      hint.className = 'gb-flower-hint';
      hint.dataset.tileId = String(flower.tileId);
      hint.textContent = '可补';
      layer.appendChild(hint);
    }
    this.root.appendChild(layer);
    this.flowerHintLayerEl = layer;
    this.updateFlowerHints();
  }

  private renderSettlement(state: GuobiaoState, seat: number): void {
    this.root.style.display = 'block';
    this.root.innerHTML = '';
    this.panelEl = null;
    const panel = document.createElement('div');
    panel.className = 'blood-panel readonly';
    const title = document.createElement('div');
    title.className = 'blood-title';
    const summary = state.endSummary ?? null;
    title.textContent = summary?.kind === 'hu'
      ? (summary.fromSeat === null ? '本局结束：自摸' : '本局结束：点和')
      : '本局结束：荒牌';
    panel.appendChild(title);

    const row = document.createElement('div');
    row.className = 'blood-row';
    row.style.flexDirection = 'column';
    row.style.alignItems = 'stretch';
    const players = state.players ?? {};
    for (let s = 0; s < 4; s++) {
      const ps = players[s];
      if (!ps) continue;
      const line = document.createElement('div');
      line.style.display = 'flex';
      line.style.justifyContent = 'space-between';
      line.style.gap = '12px';
      line.style.fontSize = '13px';
      const delta = (ps.points ?? 0) - (state.initialPointsBySeat?.[s] ?? 0);
      line.textContent = `${s === seat ? '我' : `玩家${s + 1}`}  ${formatSigned(delta)}  当前 ${ps.points ?? 0}`;
      row.appendChild(line);
    }
    if (summary?.fans?.length) {
      const fans = document.createElement('div');
      fans.style.marginTop = '6px';
      fans.style.fontSize = '12px';
      fans.textContent = summary.fans.map((f) => `${f.name}${f.points}`).join(' / ');
      row.appendChild(fans);
    }
    panel.appendChild(row);
    this.root.appendChild(panel);
  }

  update(): void {
    if (!this.interactiveEnabled) return;
    this.updateFlowerHints();
    if (!this.panelEl) return;
    const targetRect = this.computeBottomRightActionRectPx();
    if (!targetRect) return;

    const center = { x: (targetRect.left + targetRect.right) * 0.5, y: (targetRect.top + targetRect.bottom) * 0.5 };
    const viewerSeat = this.client.seat;
    const tilePx = viewerSeat !== null ? this.estimateDiscardTilePx(viewerSeat) : null;
    const actionBtnPx = Math.round(clamp((tilePx ?? 50) * 1.25, 44, 60));

    this.panelEl.style.setProperty('--action-btn', `${actionBtnPx}px`);
    this.panelEl.style.left = `${center.x}px`;
    this.panelEl.style.top = `${center.y}px`;
    this.panelEl.style.transform = 'translate(-50%, -50%)';

    const tableVp = this.mainView.getTableViewport();
    const vpLeft = tableVp.left;
    const vpRight = tableVp.left + tableVp.width;
    const vpTop = tableVp.top;
    const vpBottom = tableVp.top + tableVp.height;
    const rect = this.rectToStagePx(this.panelEl.getBoundingClientRect());
    const clampLeft = vpLeft;
    const clampTop = vpTop;
    const clampRight = Math.min(vpRight, targetRect.right);
    const clampBottom = Math.min(vpBottom, targetRect.bottom);

    let dxClamp = 0;
    let dyClamp = 0;
    if (rect.left < clampLeft) dxClamp = clampLeft - rect.left;
    if (rect.right > clampRight) dxClamp = clampRight - rect.right;
    if (rect.top < clampTop) dyClamp = clampTop - rect.top;
    if (rect.bottom > clampBottom) dyClamp = clampBottom - rect.bottom;
    if (dxClamp !== 0 || dyClamp !== 0) {
      this.panelEl.style.transform = `translate(-50%, -50%) translate(${dxClamp}px, ${dyClamp}px)`;
    }
  }

  private updateFlowerHints(): void {
    const layer = this.flowerHintLayerEl;
    if (!layer) return;

    const tableVp = this.mainView.getTableViewport();
    const camera: any = this.mainView.camera;
    const hints = Array.from(layer.querySelectorAll<HTMLElement>('.gb-flower-hint'));
    let visible = 0;
    for (const hint of hints) {
      const tileId = Math.trunc(Number(hint.dataset.tileId ?? NaN));
      const place = Number.isFinite(tileId) ? this.getHandTileDisplayPlace(tileId) : null;
      const rect = place ? projectPlaceToRectPx(place, camera, tableVp) : null;
      if (!rect) {
        hint.style.display = 'none';
        continue;
      }
      const tilePx = Math.max(1, Math.min(rect.right - rect.left, rect.bottom - rect.top));
      const left = (rect.left + rect.right) * 0.5;
      const top = rect.top - Math.max(5, tilePx * 0.16);
      hint.style.display = 'block';
      hint.style.left = `${left}px`;
      hint.style.top = `${top}px`;
      hint.style.setProperty('--gb-flower-hint-font', `${Math.round(clamp(tilePx * 0.32, 10, 15))}px`);
      visible++;
    }
    layer.style.display = visible > 0 ? 'block' : 'none';
  }

  private rectToStagePx(rect: DOMRect): { left: number; top: number; right: number; bottom: number; width: number; height: number } {
    const main = this.mainEl;
    if (!main) {
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
    }
    const stageRect = main.getBoundingClientRect();
    const scaleX = stageRect.width / Math.max(1, main.clientWidth);
    const scaleY = stageRect.height / Math.max(1, main.clientHeight);
    const invScaleX = Number.isFinite(scaleX) && scaleX > 1e-6 ? 1 / scaleX : 1;
    const invScaleY = Number.isFinite(scaleY) && scaleY > 1e-6 ? 1 / scaleY : 1;
    const left = (rect.left - stageRect.left) * invScaleX;
    const top = (rect.top - stageRect.top) * invScaleY;
    const width = rect.width * invScaleX;
    const height = rect.height * invScaleY;
    return { left, top, right: left + width, bottom: top + height, width, height };
  }

  private estimateDiscardTilePx(seat: number): number | null {
    const tableVp = this.mainView.getTableViewport();
    const camera: any = this.mainView.camera;
    const slot = this.world.slots.get(`discard.1.0@${seat}`) ?? null;
    const place = slot?.places?.[0] ?? null;
    if (!place) return null;
    const rect = projectPlaceToRectPx(place, camera, tableVp);
    if (!rect) return null;
    return Math.max(1, Math.min(rect.right - rect.left, rect.bottom - rect.top));
  }

  private computeBottomRightActionRectPx(): RectPx | null {
    const viewerSeat = this.client.seat;
    if (viewerSeat === null) return null;

    const tableVp = this.mainView.getTableViewport();
    const camera: any = this.mainView.camera;

    const bottomSeat = viewerSeat;
    const rightSeat = (viewerSeat + 1) % 4;

    const isXSeat = (seat: number): boolean => seat === 1 || seat === 3;
    const seatX = isXSeat(bottomSeat) ? bottomSeat : rightSeat;
    const seatY = isXSeat(bottomSeat) ? rightSeat : bottomSeat;

    const discardSlotsX = [...this.world.slots.values()].filter(
      (s) => s.seat === seatX && s.group === 'discard' && !s.name.startsWith('discard.stack'),
    );
    const discardSlotsY = [...this.world.slots.values()].filter(
      (s) => s.seat === seatY && s.group === 'discard' && !s.name.startsWith('discard.stack'),
    );

    const discardEdgeX = computeDiscardEdge(discardSlotsX, seatX);
    const handEdgeX = computeHandMeldEdge(this.world.slots, seatX);
    const discardEdgeY = computeDiscardEdge(discardSlotsY, seatY);
    const handEdgeY = computeHandMeldEdge(this.world.slots, seatY);
    if (discardEdgeX === null || handEdgeX === null || discardEdgeY === null || handEdgeY === null) return null;

    const x0 = Math.min(discardEdgeX, handEdgeX);
    const x1 = Math.max(discardEdgeX, handEdgeX);
    const y0 = Math.min(discardEdgeY, handEdgeY);
    const y1 = Math.max(discardEdgeY, handEdgeY);
    if (!Number.isFinite(x0) || !Number.isFinite(x1) || !Number.isFinite(y0) || !Number.isFinite(y1)) return null;
    if (Math.abs(x1 - x0) < 1e-6 || Math.abs(y1 - y0) < 1e-6) return null;

    const zWorld = Math.max(
      this.world.slots.get(`discard.1.0@${seatX}`)?.places?.[0]?.position?.z ?? 0,
      this.world.slots.get(`discard.1.0@${seatY}`)?.places?.[0]?.position?.z ?? 0,
    );

    const points = [
      new Vector3(x0, y0, zWorld),
      new Vector3(x1, y0, zWorld),
      new Vector3(x0, y1, zWorld),
      new Vector3(x1, y1, zWorld),
    ].map((p) => projectPointToPx(p, camera, tableVp));

    if (points.some((p) => p === null)) return null;
    const pts = points as Array<{ x: number; y: number }>;
    let left = Math.min(...pts.map((p) => p.x));
    let right = Math.max(...pts.map((p) => p.x));
    let top = Math.min(...pts.map((p) => p.y));
    let bottom = Math.max(...pts.map((p) => p.y));

    const vpLeft = tableVp.left;
    const vpRight = tableVp.left + tableVp.width;
    const vpTop = tableVp.top;
    const vpBottom = tableVp.top + tableVp.height;
    left = clamp(left, vpLeft, vpRight);
    right = clamp(right, vpLeft, vpRight);
    top = clamp(top, vpTop, vpBottom);
    bottom = clamp(bottom, vpTop, vpBottom);
    if (right - left < 4 || bottom - top < 4) return null;

    return { left, top, right, bottom };
  }

  private computeSelfHu(state: GuobiaoState, seat: number, options?: { ignoreWrongHu?: boolean }): HuCheck {
    const baseRuleScore = state.baseRuleScore;
    const none: HuCheck = { canHu: false, huKind: 'none', fanTotal: 0, qualifyingFanTotal: 0, baseRuleScore };
    const handTiles = this.listHandTiles(seat);
    const tiles = handTiles.map((tile) => tile.tileKey);
    const player = state.players?.[seat] ?? null;
    if (!player || (!options?.ignoreWrongHu && player.wrongHu === true)) return none;
    const currentSelfDraw = this.findCurrentSelfDrawForHu(state, seat, handTiles);
    const isHeavenlyHand = this.isHeavenlyHand(state, seat);
    if (!isHeavenlyHand && currentSelfDraw === null) return none;
    const selfHuTileKey = currentSelfDraw?.tileKey ?? null;
    if (!isHeavenlyHand && selfHuTileKey !== null && isGuobiaoFlower(selfHuTileKey)) return none;
    const flowerCount = player?.flowers?.length ?? 0;
    const melds = this.buildSelfFanMelds(player);
    if (melds === null) return none;
    const winContext: GuobiaoWinContext = {
      isSelfDrawn: true,
      isKongDraw: this.isImmediateKongSupplementWin(state, seat, currentSelfDraw),
      isLastTileDraw: state.wallHeadIndex > state.wallTailIndex,
      isLastTile: isGuobiaoLastTileSelfDraw(selfHuTileKey, this.client.tileFacePublic.entries(), handTiles),
      isHeavenlyHand,
      isHumanHandTwo: this.isHumanHandTwoSelfDraw(state, seat, currentSelfDraw),
      winningTileKey: isHeavenlyHand ? undefined : selfHuTileKey ?? undefined,
      seatWind: seat,
      roundWind: state.roundWind,
    };
    const result = calculateGuobiaoFans({
      tiles,
      melds,
      flowerCount,
      winContext,
    });
    if (!result.valid) return none;
    return {
      canHu: true,
      huKind: result.qualifyingFanTotal >= baseRuleScore ? 'legal' : 'wrongHuRisk',
      fanTotal: result.fanTotal,
      qualifyingFanTotal: result.qualifyingFanTotal,
      baseRuleScore,
    };
  }

  private findCurrentSelfDrawForHu(state: GuobiaoState, seat: number, handTiles: Array<HandTile>): HandTile | null {
    const lastDraw = state.lastDraw ?? null;
    if (!lastDraw || lastDraw.seat !== seat) return null;
    const tile = handTiles.find((x) => x.tileId === lastDraw.tileId) ?? null;
    if (!tile) return null;
    return tile;
  }

  private isImmediateKongSupplementWin(state: GuobiaoState, seat: number, currentSelfDraw: HandTile | null): boolean {
    const lastDraw = state.lastDraw ?? null;
    if (!lastDraw || lastDraw.seat !== seat || lastDraw.source !== 'kongSupplement') return false;
    return currentSelfDraw !== null && currentSelfDraw.tileId === lastDraw.tileId;
  }

  private isHeavenlyHand(state: GuobiaoState, seat: number): boolean {
    return seat === state.dealer
      && state.turnSeat === seat
      && state.turnStep === 'discard'
      && state.initialEventInterrupted !== true
      && this.totalDiscardCount(state) === 0
      && !this.hasNonFlowerMeld(state);
  }

  private isHumanHandTwoSelfDraw(state: GuobiaoState, seat: number, currentSelfDraw: HandTile | null): boolean {
    const lastDraw = state.lastDraw ?? null;
    return seat !== state.dealer
      && state.initialEventInterrupted !== true
      && this.drawCountForSeat(state, seat) === 1
      && lastDraw !== null
      && lastDraw.seat === seat
      && lastDraw.source === 'wall'
      && currentSelfDraw !== null
      && currentSelfDraw.tileId === lastDraw.tileId
      && !this.hasNonFlowerMeld(state);
  }

  private drawCountForSeat(state: GuobiaoState, seat: number): number {
    return state.drawCountBySeat?.[seat] ?? 0;
  }

  private totalDiscardCount(state: GuobiaoState): number {
    if (state.discardCountBySeat) {
      return [0, 1, 2, 3].reduce((sum, x) => sum + (state.discardCountBySeat?.[x] ?? 0), 0);
    }
    let count = 0;
    for (const [, info] of this.client.things.entries()) {
      const slotName = String(info?.slotName ?? '');
      if (slotName.startsWith('discard.')) count += 1;
    }
    return count;
  }

  private hasNonFlowerMeld(state: GuobiaoState): boolean {
    for (let x = 0; x < 4; x++) {
      const melds = state.players?.[x]?.melds ?? [];
      if (melds.some((meld) => meld.kind !== 'flower')) return true;
    }
    return false;
  }

  private buildSelfFanMelds(player: GuobiaoState['players'][number] | null): Array<GuobiaoFanMeld> | null {
    const out: Array<GuobiaoFanMeld> = [];
    for (const meld of player?.melds ?? []) {
      if (meld.kind === 'flower') continue;
      if (meld.kind === 'anGang') {
        const tileKeys = Array.isArray(meld.tileKeys) && meld.tileKeys.length === 4
          ? meld.tileKeys
          : this.hydrateConcealedMeldTileKeys(meld);
        if (tileKeys === null) return null;
        out.push({ kind: meld.kind, tileKeys, concealed: meld.concealed, fromSeat: meld.fromSeat });
        continue;
      }
      out.push({ kind: meld.kind, tileKeys: meld.tileKeys, concealed: meld.concealed, fromSeat: meld.fromSeat });
    }
    return out;
  }

  private hydrateConcealedMeldTileKeys(meld: GuobiaoTileMeld): Array<number> | null {
    const tileIds = Array.isArray(meld.tileIds) ? meld.tileIds : [];
    if (tileIds.length !== 4) return null;
    const tileKeys: Array<number> = [];
    for (const rawId of tileIds) {
      const tileId = Math.trunc(Number(rawId));
      if (!Number.isFinite(tileId)) return null;
      const tileKey = this.client.tileFaceSelf.get(tileId) ?? this.client.tileFacePublic.get(tileId) ?? null;
      if (typeof tileKey !== 'number' || !Number.isFinite(tileKey)) return null;
      tileKeys.push(Math.trunc(tileKey));
    }
    return tileKeys;
  }

  private findActionFlowerInHand(seat: number): HandTile | null {
    const flowers = this.listHandTiles(seat).filter((tile) => isGuobiaoFlower(tile.tileKey));
    if (flowers.length === 0) return null;
    const selectedIds = new Set(this.world.getSelectedThingIds().map((id) => Math.trunc(id)));
    const selected = flowers.find((tile) => selectedIds.has(tile.tileId)) ?? null;
    if (selected) return selected;
    const extra = flowers.find((tile) => tile.slotName.startsWith('hand.extra')) ?? null;
    if (extra) return extra;
    return flowers[0]!;
  }

  private findBuhuaHintFlowers(state: GuobiaoState, seat: number): Array<HandTile> {
    return this.listHandTiles(seat)
      .filter((tile) => isGuobiaoFlower(tile.tileKey) && this.canBuhuaNow(state, seat, tile));
  }

  private canBuhuaNow(state: GuobiaoState, seat: number, tile: HandTile): boolean {
    if (state.wallHeadIndex > state.wallTailIndex) return false;
    return true;
  }

  private findGangOptions(state: GuobiaoState, seat: number): Array<GangUiOption> {
    if (state.wallHeadIndex > state.wallTailIndex) return [];
    const hand = this.listHandTiles(seat).filter((tile) => !isGuobiaoFlower(tile.tileKey));
    const byKey = new Map<number, Array<HandTile>>();
    for (const tile of hand) {
      const xs = byKey.get(tile.tileKey) ?? [];
      xs.push(tile);
      byKey.set(tile.tileKey, xs);
    }

    const options: Array<GangUiOption> = [];
    for (const [tileKey, tiles] of byKey.entries()) {
      if (tiles.length >= 4) {
        options.push({ kind: 'anGang', tileKey, tileIds: tiles.slice(0, 4).map((tile) => tile.tileId) });
      }
    }

    const melds = (state.players?.[seat]?.melds ?? []).filter((meld): meld is GuobiaoTileMeld => meld.kind === 'peng');
    for (const meld of melds) {
      const tileKey = typeof meld.claimedTileKey === 'number' ? meld.claimedTileKey : meld.tileKeys[0] ?? null;
      if (tileKey === null) continue;
      const tile = byKey.get(tileKey)?.[0] ?? null;
      if (!tile) continue;
      options.push({ kind: 'addGang', tileKey, tileId: tile.tileId, meldId: meld.id });
    }

    options.sort((a, b) => a.tileKey - b.tileKey || (a.kind === b.kind ? 0 : a.kind === 'anGang' ? -1 : 1));
    return options;
  }

  private listHandTiles(seat: number): Array<HandTile> {
    const out: Array<HandTile> = [];
    for (const [tileId, info] of this.client.things.entries()) {
      if (!info || info.slotName === undefined) continue;
      if (!info.slotName.startsWith('hand.') || !info.slotName.endsWith(`@${seat}`)) continue;
      if (info.rotationIndex === undefined || info.claimedBy !== null) continue;
      const key = this.client.tileFaceSelf.get(tileId) ?? this.client.tileFacePublic.get(tileId) ?? null;
      if (typeof key === 'number' && Number.isFinite(key)) {
        out.push({ tileId, tileKey: Math.trunc(key), slotName: info.slotName });
      }
    }
    out.sort((a, b) => a.slotName.localeCompare(b.slotName) || a.tileId - b.tileId);
    return out;
  }

  private getHandTileDisplayPlace(tileId: number): Place | null {
    const mobilePlace = this.world.getMobileSelfHandDisplayPlace(tileId);
    if (mobilePlace) return mobilePlace;
    const info = this.client.things.get(tileId) ?? null;
    const slotName = info?.slotName ?? null;
    if (!slotName) return null;
    const slot = this.world.slots.get(slotName) ?? null;
    const rotationIndex = Math.trunc(Number(info?.rotationIndex ?? 0));
    const place = slot?.places?.[Number.isFinite(rotationIndex) ? rotationIndex : 0] ?? slot?.places?.[0] ?? null;
    return place;
  }
}

function formatSigned(value: number): string {
  const n = Number.isFinite(value) ? Math.trunc(value) : 0;
  return n > 0 ? `+${n}` : String(n);
}

function responseClass(action: string): string {
  if (action === 'hu') return 'action-hu';
  if (action === 'mingGang') return 'action-gang action-gang-act';
  if (action === 'peng') return 'action-peng action-peng-act';
  if (action === 'chi') return 'action-chi action-chi-act';
  return 'secondary action-pass';
}

function shortSequenceLabel(sequence: Array<number>): string {
  return sequence.map((tileKey) => {
    const label = guobiaoTileLabel(tileKey);
    const m = /^(\d)/.exec(label);
    return m?.[1] ?? label.slice(0, 1);
  }).join('');
}

function shortTileLabel(tileKey: number): string {
  const label = guobiaoTileLabel(tileKey);
  const m = /^(\d)(.)/.exec(label);
  if (m) return `${m[1]}${m[2]}`;
  return label.slice(0, 2);
}
