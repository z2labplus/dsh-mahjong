import { Vector3, Vector2, Euler, Quaternion } from "three";
import { Slot } from "./slot";
import { Size, ThingType, GameType } from "./types";

const WORLD_SIZE = 174;

const Rotation = {
  FACE_UP: new Quaternion().setFromEuler(new Euler(0, 0, 0)),
  FACE_UP_SIDEWAYS: new Quaternion().setFromEuler(new Euler(0, 0, Math.PI / 2)),
  STANDING: new Quaternion().setFromEuler(new Euler(Math.PI / 2, 0, 0)),
  FACE_DOWN: new Quaternion().setFromEuler(new Euler(Math.PI, 0, 0)),
  FACE_DOWN_SIDEWAYS: new Quaternion().setFromEuler(new Euler(Math.PI, 0, Math.PI / 2)),
  FACE_DOWN_REVERSE: new Quaternion().setFromEuler(new Euler(Math.PI, 0, Math.PI)),
};

type SlotOp = (slots: Array<Slot>) => Array<Slot>;
type SlotGroup = Array<SlotOp>;

export function makeSlots(gameType: GameType): Array<Slot> {
  const slots = [];

  for (const group of SLOT_GROUPS[gameType]) {
    let current: Array<Slot> = [];
    for (const op of group) {
      current = op(current);
    }
    slots.push(...current);
  }

  fixupSlots(slots, gameType);
  return slots;
}

function start(name: string): SlotOp {
  return _ => [START[name]];
}

interface RepeatOptions {
  stack?: boolean;
  shift?: boolean;
  push?: boolean;
}

function repeat(count: number, offset: Vector3, options: RepeatOptions = {}): SlotOp {
  return (slots: Array<Slot>) => {
    const result: Array<Slot> = [];
    for (const slot of slots) {
      const totalOffset = new Vector3(0, 0, 0);
      for (let i = 0; i < count; i++) {
        const copied = slot.copy(`.${i}`);
        copied.origin = copied.origin.clone().add(totalOffset);
        copied.indexes.push(i);
        result.push(copied);
        totalOffset.add(offset);

        if (i < count - 1) {
          const next = `${slot.name}.${i+1}`;
          if (options.stack) copied.linkDesc.up = next;
          if (options.shift) copied.linkDesc.shiftRight = next;
          if (options.push) copied.linkDesc.push = next;
        }

        if (i > 0) {
          const prev = `${slot.name}.${i-1}`;
          if (options.stack) copied.linkDesc.down = prev;
          if (options.shift) copied.linkDesc.shiftLeft = prev;
        }
      }
    }
    return result;
  };
}

function row(count: number, dx?: number, options: RepeatOptions = {}): SlotOp {
  return repeat(count, new Vector3(dx ?? Size.TILE.x, 0, 0), options);
}

function column(count: number, dy?: number): SlotOp {
  return repeat(count, new Vector3(0, dy ?? Size.TILE.y, 0));
}

function stack(dz?: number): SlotOp {
  return repeat(2, new Vector3(0, 0, dz ?? Size.TILE.z), {stack: true});
}

function seats(which?: Array<number>): SlotOp {
  const seats = which ?? [0, 1, 2, 3];
  return (slots: Array<Slot>) => {
    const result: Array<Slot> = [];
    for (const seat of seats) {
      for (const slot of slots) {
        const copied = slot.copy(`@${seat}`);
        copied.rotate(seat, WORLD_SIZE);
        result.push(copied);
      }
    }
    return result;
  };
}

const START: Record<string, Slot> = {
  'hand': new Slot({
    name: 'hand',
    group: 'hand',
    origin: new Vector3(46, 0, 0),
    rotations: [Rotation.STANDING, Rotation.FACE_UP, Rotation.FACE_DOWN],
    canFlipMultiple: true,
    drawShadow: true,
    shadowRotation: 1,
    rotateHeld: true,
  }),

  'hand.3p': new Slot({
    name: 'hand',
    group: 'hand',
    origin: new Vector3(37, 0, 0),
    rotations: [Rotation.STANDING, Rotation.FACE_UP, Rotation.FACE_DOWN],
    canFlipMultiple: true,
    drawShadow: true,
    shadowRotation: 1,
    rotateHeld: true,
  }),

  'hand.extra': new Slot({
    name: `hand.extra`,
    group: `hand`,
    origin: new Vector3(
      46 + 14.5*Size.TILE.x,
      0,
      0,
    ),
    rotations: [Rotation.STANDING, Rotation.FACE_UP, Rotation.FACE_DOWN],
    canFlipMultiple: true,
    rotateHeld: true,
  }),

  'meld': new Slot({
    name: `meld`,
    group: `meld`,
    origin: new Vector3(174, 0, 0),
    direction: new Vector2(-1, 1),
    rotations: [Rotation.FACE_UP, Rotation.FACE_UP_SIDEWAYS, Rotation.FACE_DOWN],
  }),

  'kita': new Slot({
    name: `kita`,
    group: `kita`,
    origin: new Vector3(146, 0, 0),
    direction: new Vector2(-1, 1),
    rotations: [Rotation.FACE_UP],
  }),

  'wall': new Slot({
    name: 'wall',
    group: 'wall',
    origin: new Vector3(30, 20, 0),
    rotations: [Rotation.FACE_DOWN, Rotation.FACE_UP],
  }),

  'wall.demo': new Slot({
    name: 'wall',
    group: 'wall',
    origin: new Vector3(30, 20, 0),
    rotations: [Rotation.FACE_DOWN, Rotation.FACE_UP],
    canFlipMultiple: true,
  }),

  'wall.open': new Slot({
    name: 'wall.open',
    group: 'wall.open',
    origin: new Vector3(36, 14, 0),
    rotations: [Rotation.STANDING, Rotation.FACE_DOWN],
    canFlipMultiple: true,
  }),

  'discard': new Slot({
    name: `discard`,
    group: `discard`,
    origin: new Vector3(69, 60, 0),
    direction: new Vector2(1, 1),
    rotations: [Rotation.FACE_UP, Rotation.FACE_UP_SIDEWAYS, Rotation.FACE_DOWN, Rotation.FACE_DOWN_SIDEWAYS],
    drawShadow: true,
  }),

  // 弃牌“第二层”：用于移动端血战在弃牌>18时不外溢（轻微错位+抬高，避免完全遮住底层）。
  // 注意：这里只定义槽位模板；具体的“按 seat 向外错位”的细节在 fixupSlots 里做（因为此时 seat 已知）。
  'discard.stack': new Slot({
    name: `discard.stack`,
    group: `discard`,
    origin: new Vector3(69, 60, 0),
    direction: new Vector2(1, 1),
    rotations: [Rotation.FACE_UP, Rotation.FACE_UP_SIDEWAYS, Rotation.FACE_DOWN, Rotation.FACE_DOWN_SIDEWAYS],
    // 不要在默认桌面渲染“占位阴影”，避免 PC 视图出现双层格子提示
    drawShadow: false,
  }),

  'discard.extra': new Slot({
    name: `discard.extra`,
    group: `discard`,
    origin: new Vector3(69 + 6 * Size.TILE.x, 60 - 2 * Size.TILE.y, 0),
    direction: new Vector2(1, 1),
    rotations: [Rotation.FACE_UP, Rotation.FACE_UP_SIDEWAYS, Rotation.FACE_DOWN, Rotation.FACE_DOWN_SIDEWAYS],
  }),

  'tray': new Slot({
    name: `tray`,
    group: `tray`,
    type: ThingType.STICK,
    origin: new Vector3(15, -25, 0),
    rotations: [Rotation.FACE_UP],
  }),

  'payment': new Slot({
    name: 'payment',
    group: 'payment',
    type: ThingType.STICK,
    origin: new Vector3(42, 42, 0),
    rotations: [Rotation.FACE_UP_SIDEWAYS],
  }),

  'riichi': new Slot({
    name: 'riichi',
    group: 'riichi',
    type: ThingType.STICK,
    origin: new Vector3(
      (WORLD_SIZE - Size.STICK.x) / 2,
      71.5,
      1.5,
    ),
    rotations: [Rotation.FACE_UP],
  }),

  'marker': new Slot({
    name: 'marker',
    group: 'marker',
    type: ThingType.MARKER,
    origin: new Vector3(
      166, -8, 0,
    ),
    rotations: [Rotation.FACE_DOWN_REVERSE, Rotation.FACE_UP],
  }),

  // 点炮胡（方案B）：把“被胡的那张弃牌”移动到隐藏槽位，避免继续留在弃牌区。
  // 说明：这里只做物理牌的“收纳”，真正展示仍由 blood-hu-overlay.ts 负责（每个胡家各显示一张复制的胡牌）。
  'hu.taken': new Slot({
    name: 'hu.taken',
    group: 'hu.taken',
    origin: new Vector3(-10000, -10000, 0),
    rotations: [Rotation.FACE_UP],
    drawShadow: false,
  }),

  'flower.store': new Slot({
    name: 'flower.store',
    group: 'flower.store',
    origin: new Vector3(-10000, -10000, 0),
    rotations: [Rotation.FACE_UP],
    drawShadow: false,
  }),
};

export const SLOT_GROUPS: Record<GameType, Array<SlotGroup>> = {
  FOUR_PLAYER: [
    [start('hand'), row(14, undefined, {shift: true}), seats()],
    [start('hand.extra'), seats()],
    [start('meld'), column(4), row(4, -Size.TILE.x, {push: true, shift: true}), seats()],
    [start('wall'), row(19), stack(), seats()],
    [start('discard'), column(3, -Size.TILE.y), row(6, undefined, {push: true}), seats()],
    [start('discard.extra'), row(4, undefined, {push: true}), seats()],

    [start('tray'), row(6, 24), column(10, -3), seats()],
    [start('payment'), row(8, 3), seats()],
    [start('riichi'), seats()],
    [start('marker'), seats()],
  ],

  BLOOD_BATTLE: [
    [start('hand'), row(14, undefined, {shift: true}), seats()],
    [start('hand.extra'), seats()],
    [start('meld'), column(4), row(4, -Size.TILE.x, {push: true, shift: true}), seats()],
    [start('wall'), row(19), stack(), seats()],
    [start('discard'), column(3, -Size.TILE.y), row(6, undefined, {push: true}), seats()],
    // 血战：弃牌可能到 28 张左右，默认 6x3=18 不够；这里增加“第二层”6x3=18，容量 36。
    [start('discard.stack'), column(3, -Size.TILE.y), row(6, undefined, {push: true}), seats()],
    // 点炮胡（方案B）：最多 3 人胡，预留 16 个“被胡弃牌”隐藏槽位，避免 slotName unique 冲突。
    [start('hu.taken'), row(16)],

    [start('tray'), row(6, 24), column(10, -3), seats()],
    [start('payment'), row(8, 3), seats()],
    [start('riichi'), seats()],
    [start('marker'), seats()],
  ],

  GUOBIAO: [
    [start('hand'), row(14, undefined, {shift: true}), seats()],
    [start('hand.extra'), seats()],
    [start('meld'), column(4), row(4, -Size.TILE.x, {push: true, shift: true}), seats()],
    [start('wall'), row(19), stack(), seats()],
    [start('discard'), column(3, -Size.TILE.y), row(6, undefined, {push: true}), seats()],
    [start('discard.stack'), column(3, -Size.TILE.y), row(6, undefined, {push: true}), seats()],
    [start('hu.taken'), row(16)],
    [start('flower.store'), row(8), seats()],

    [start('tray'), row(6, 24), column(10, -3), seats()],
    [start('payment'), row(8, 3), seats()],
    [start('riichi'), seats()],
    [start('marker'), seats()],
  ],

  FOUR_PLAYER_DEMO: [
    [start('hand'), row(14, undefined, {shift: true}), seats()],
    [start('hand.extra'), seats()],
    [start('meld'), column(4), row(4, -Size.TILE.x, {push: true, shift: true}), seats()],
    [start('wall.demo'), row(19), stack(), seats()],
    [start('discard'), column(3, -Size.TILE.y), row(6, undefined, {push: true}), seats()],
    [start('discard.extra'), row(4, undefined, {push: true}), seats()],

    [start('tray'), row(6, 24), column(10, -3), seats()],
    [start('payment'), row(8, 3), seats()],
    [start('riichi'), seats()],
    [start('marker'), seats()],
  ],

  THREE_PLAYER: [
    [start('hand.3p'), row(14, undefined, {shift: true}), seats([0, 1, 2])],
    [start('meld'), column(4), row(4, -Size.TILE.x, {push: true, shift: true}), seats([0, 1, 2])],
    [start('kita'), row(4, -Size.TILE.x, {shift: true}), seats([0, 1, 2])],
    [start('wall'), row(19), stack(), seats()],
    [start('discard'), column(3, -Size.TILE.y), row(6, undefined, {push: true}), seats([0, 1, 2])],
    [start('discard.extra'), row(4, undefined, {push: true}), seats([0, 1, 2])],

    [start('tray'), row(6, 24), column(10, -3), seats([0, 1, 2])],
    [start('payment'), row(8, 3), seats()],
    [start('riichi'), seats([0, 1, 2])],
    [start('marker'), seats([0, 1, 2])],
  ],

  BAMBOO: [
    [start('hand'), row(14, undefined, {shift: true}), seats([0, 2])],
    [start('hand.extra'), seats([0, 2])],
    [start('meld'), column(4), row(4, -Size.TILE.x, {push: true, shift: true}), seats([0, 2])],
    [start('wall'), row(19), stack(), seats([0, 2])],
    [start('discard'), column(3, -Size.TILE.y), row(6, undefined, {push: true}), seats([0, 2])],

    [start('tray'), row(6, 24), column(10, -3), seats([0, 2])],
    [start('payment'), row(8, 3), seats()],
    [start('riichi'), seats([0, 2])],
    [start('marker'), seats([0, 2])],
  ],

  MINEFIELD: [
    [start('hand'), row(13, undefined, {shift: true}), seats([0, 2])],
    [start('wall'), row(19), stack(), seats([1, 3])],
    [start('wall.open'), column(2, Size.TILE.y * 1.6), row(17, undefined, {shift: true}), seats([0, 2])],
    [start('discard'), column(3, -Size.TILE.y), row(6, undefined, {push: true}), seats([0, 2])],

    [start('tray'), row(6, 24), column(10, -3), seats([0, 2])],
    [start('payment'), row(8, 3), seats()],
    [start('riichi'), seats([0, 2])],
    [start('marker'), seats([0, 2])],
  ],
};

function fixupSlots(slots: Array<Slot>, _gameType: GameType): void {
  // 按需求：第二层弃牌“完全盖住”第一层，因此不做 XY 错位（shift=0）。
  const DISCARD_STACK_SHIFT = 0;
  // 第二层必须至少抬高 1 个“牌厚度”，否则会与第一层几何体穿插，视觉上像“贴图”不够立体。
  const DISCARD_STACK_LIFT = Size.TILE.z + 0.05; // ≈ 4.05，略留一点缝隙避免 z-fighting

  for (const slot of slots) {
    if (slot.name.startsWith('discard.extra')) {
      slot.linkDesc.requires = `discard.2.5@${slot.seat}`;
    }
    if (slot.name.startsWith('discard.2.5')) {
      slot.linkDesc.push = `discard.extra.0@${slot.seat}`;
    }
    // 弃牌第二层：必须等第一层填满（discard.2.5）后才可用；同位覆盖并抬高（避免穿插/闪烁）
    if (slot.name.startsWith('discard.stack')) {
      slot.linkDesc.requires = `discard.2.5@${slot.seat}`;
      if (slot.seat === 0) slot.origin.y -= DISCARD_STACK_SHIFT;
      else if (slot.seat === 2) slot.origin.y += DISCARD_STACK_SHIFT;
      else if (slot.seat === 1) slot.origin.x += DISCARD_STACK_SHIFT;
      else if (slot.seat === 3) slot.origin.x -= DISCARD_STACK_SHIFT;
      slot.origin.z += DISCARD_STACK_LIFT;
      slot.places = slot.rotations.map(slot.makePlace.bind(slot));
    }
    if (slot.group === 'wall' &&
        slot.indexes[0] !== 0 && slot.indexes[0] !== 18 && slot.indexes[1] === 0) {
      slot.drawShadow = true;
    }
    if (slot.group === 'meld' && slot.indexes[0] > 0) {
      slot.linkDesc.requires = `meld.${slot.indexes[0]-1}.1@${slot.seat}`;
    }
    if (slot.group === 'wall.open' && slot.indexes[0] === 1 && slot.indexes[1] === 16) {
      slot.linkDesc.shiftRight = `wall.open.0.0@${slot.seat}`;
    }
    if (slot.group === 'wall.open' && slot.indexes[0] === 0 && slot.indexes[1] === 0) {
      slot.linkDesc.shiftLeft = `wall.open.1.16@${slot.seat}`;
    }
  }
}
