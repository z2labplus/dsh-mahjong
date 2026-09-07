// Centralized tile asset URLs for Parcel builds.
// Keep all tile URL imports in one place to avoid ad-hoc runtime path strings.
// @ts-ignore
import t0m from 'url:../img/mahjong/0m.svg';
// @ts-ignore
import t1m from 'url:../img/mahjong/1m.svg';
// @ts-ignore
import t2m from 'url:../img/mahjong/2m.svg';
// @ts-ignore
import t3m from 'url:../img/mahjong/3m.svg';
// @ts-ignore
import t4m from 'url:../img/mahjong/4m.svg';
// @ts-ignore
import t5m from 'url:../img/mahjong/5m.svg';
// @ts-ignore
import t6m from 'url:../img/mahjong/6m.svg';
// @ts-ignore
import t7m from 'url:../img/mahjong/7m.svg';
// @ts-ignore
import t8m from 'url:../img/mahjong/8m.svg';
// @ts-ignore
import t9m from 'url:../img/mahjong/9m.svg';

// @ts-ignore
import t0p from 'url:../img/mahjong/0p.svg';
// @ts-ignore
import t1p from 'url:../img/mahjong/1p.svg';
// @ts-ignore
import t2p from 'url:../img/mahjong/2p.svg';
// @ts-ignore
import t3p from 'url:../img/mahjong/3p.svg';
// @ts-ignore
import t4p from 'url:../img/mahjong/4p.svg';
// @ts-ignore
import t5p from 'url:../img/mahjong/5p.svg';
// @ts-ignore
import t6p from 'url:../img/mahjong/6p.svg';
// @ts-ignore
import t7p from 'url:../img/mahjong/7p.svg';
// @ts-ignore
import t8p from 'url:../img/mahjong/8p.svg';
// @ts-ignore
import t9p from 'url:../img/mahjong/9p.svg';

// @ts-ignore
import t0s from 'url:../img/mahjong/0s.svg';
// @ts-ignore
import t1s from 'url:../img/mahjong/1s.svg';
// @ts-ignore
import t2s from 'url:../img/mahjong/2s.svg';
// @ts-ignore
import t3s from 'url:../img/mahjong/3s.svg';
// @ts-ignore
import t4s from 'url:../img/mahjong/4s.svg';
// @ts-ignore
import t5s from 'url:../img/mahjong/5s.svg';
// @ts-ignore
import t6s from 'url:../img/mahjong/6s.svg';
// @ts-ignore
import t7s from 'url:../img/mahjong/7s.svg';
// @ts-ignore
import t8s from 'url:../img/mahjong/8s.svg';
// @ts-ignore
import t9s from 'url:../img/mahjong/9s.svg';

// @ts-ignore
import t1z from 'url:../img/mahjong/1z.svg';
// @ts-ignore
import t2z from 'url:../img/mahjong/2z.svg';
// @ts-ignore
import t3z from 'url:../img/mahjong/3z.svg';
// @ts-ignore
import t4z from 'url:../img/mahjong/4z.svg';
// @ts-ignore
import t5z from 'url:../img/mahjong/5zplus.svg';
// @ts-ignore
import t6z from 'url:../img/mahjong/6z.svg';
// @ts-ignore
import t7z from 'url:../img/mahjong/7z.svg';

// @ts-ignore
import tChun from 'url:../img/mahjong/chun.svg';
// @ts-ignore
import tXia from 'url:../img/mahjong/xia.svg';
// @ts-ignore
import tQiu from 'url:../img/mahjong/qiu.svg';
// @ts-ignore
import tDongFlower from 'url:../img/mahjong/dong.svg';
// @ts-ignore
import tMei from 'url:../img/mahjong/mei.svg';
// @ts-ignore
import tLan from 'url:../img/mahjong/lan.svg';
// @ts-ignore
import tZu from 'url:../img/mahjong/zu.svg';
// @ts-ignore
import tJu from 'url:../img/mahjong/ju.svg';

// @ts-ignore
import tBack0 from 'url:../img/mahjong/back0.png';
// @ts-ignore
import tBack1 from 'url:../img/mahjong/back1.png';

export const MAHJONG_TILE_URLS = {
  '0m': t0m,
  '1m': t1m,
  '2m': t2m,
  '3m': t3m,
  '4m': t4m,
  '5m': t5m,
  '6m': t6m,
  '7m': t7m,
  '8m': t8m,
  '9m': t9m,

  '0p': t0p,
  '1p': t1p,
  '2p': t2p,
  '3p': t3p,
  '4p': t4p,
  '5p': t5p,
  '6p': t6p,
  '7p': t7p,
  '8p': t8p,
  '9p': t9p,

  '0s': t0s,
  '1s': t1s,
  '2s': t2s,
  '3s': t3s,
  '4s': t4s,
  '5s': t5s,
  '6s': t6s,
  '7s': t7s,
  '8s': t8s,
  '9s': t9s,

  '1z': t1z,
  '2z': t2z,
  '3z': t3z,
  '4z': t4z,
  '5z': t5z,
  '6z': t6z,
  '7z': t7z,

  'chun': tChun,
  'xia': tXia,
  'qiu': tQiu,
  'dong': tDongFlower,
  'mei': tMei,
  'lan': tLan,
  'zu': tZu,
  'ju': tJu,

  'back': tBack0,
  'back0': tBack0,
  'back1': tBack1,
} as const;

export type MahjongTileCode = keyof typeof MAHJONG_TILE_URLS;
