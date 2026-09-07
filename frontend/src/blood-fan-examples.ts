import type { HuEvents, HuMethod } from './blood-calc-engine';

export type BloodFanExampleDef = {
  title: string;
  subtitle?: string;
  concealed: string;
  melds: string;
  huMethod: HuMethod;
  remainingOpponents?: number;
  events?: HuEvents;
  // /hand?debugFans=1 专用：允许用例通过“真实对局动作”自动推进（例如先杠再补张再自摸）。
  script?: { kind: 'gangShangKaiHua'; gangType: 'an' | 'add'; kongTile: string; winTile: string };
};

export const BLOOD_FAN_EXAMPLE_GROUPS: Array<{ group: string; items: Array<BloodFanExampleDef> }> = [
  {
    group: '基础牌型',
    items: [
      {
        title: '平胡（点炮）',
        subtitle: '无额外加番，演示最基础计分',
        concealed: '123456789m12311p',
        melds: '',
        huMethod: 'dianpao',
      },
      {
        title: '平胡（自摸）',
        subtitle: '展示“自摸×2 + 平胡×1”',
        concealed: '123456789m12311p',
        melds: '',
        huMethod: 'zimo',
        remainingOpponents: 3,
      },
      {
        title: '断幺九（自摸）',
        subtitle: '无 1/9，展示“自摸×2 + 断幺九×2”',
        concealed: '223334445m55678p',
        melds: '',
        huMethod: 'zimo',
        remainingOpponents: 3,
      },
      {
        title: '幺九（点炮）',
        subtitle: '全部刻子/顺子/将都含 1 或 9',
        concealed: '12378911m111999p',
        melds: '',
        huMethod: 'dianpao',
      },
      {
        title: '碰碰胡（自摸）',
        subtitle: '四刻子 + 将',
        concealed: '11122255m333444p',
        melds: '',
        huMethod: 'zimo',
        remainingOpponents: 2,
      },
      {
        title: '将（点炮）',
        subtitle: '全手牌仅 2/5/8（示例同时满足“碰碰胡×2”）',
        concealed: '222555888m22255p',
        melds: '',
        huMethod: 'dianpao',
      },
      {
        title: '清一色（自摸）',
        subtitle: '同一花色（万/筒/条）',
        concealed: '12345678911122m',
        melds: '',
        huMethod: 'zimo',
        remainingOpponents: 3,
      },
      {
        title: '清一色 + 碰碰胡（点炮）',
        subtitle: '展示“清一色×4 + 碰碰胡×2”',
        concealed: '11122233344455m',
        melds: '',
        huMethod: 'dianpao',
      },
      {
        title: '1根（点炮）',
        subtitle: '四张同牌算 1 根（杠也算根）',
        concealed: '111123456789m11p',
        melds: '',
        huMethod: 'dianpao',
      },
    ],
  },
  {
    group: '七对系列（必须无副露）',
    items: [
      {
        title: '七对（自摸）',
        concealed: '112233m44556677p',
        melds: '',
        huMethod: 'zimo',
        remainingOpponents: 3,
      },
      {
        title: '七对 + 1根（点炮）',
        subtitle: '四张同牌=1根，展示“七对×4 × 1根×2”',
        concealed: '11112233m445566p',
        melds: '',
        huMethod: 'dianpao',
      },
      {
        title: '七对 + 2根（自摸）',
        subtitle: '两组四张同牌=2根，展示“七对×4 × 2根×4”',
        concealed: '111122223344m55p',
        melds: '',
        huMethod: 'zimo',
        remainingOpponents: 3,
      },
      {
        title: '七对 + 3根（点炮）',
        subtitle: '三组四张同牌=3根，展示“七对×4 × 3根×8”',
        concealed: '111122223333m44p',
        melds: '',
        huMethod: 'dianpao',
      },
      {
        title: '清一色 + 七对（自摸）',
        subtitle: '展示“清一色×4 × 七对×4”',
        concealed: '11223344556677m',
        melds: '',
        huMethod: 'zimo',
        remainingOpponents: 2,
      },
      {
        title: '将 + 七对（自摸）',
        subtitle: '两门 2/5/8 的七对必含至少 1 根，展示“将×4 × 七对×4 × 1根×2”',
        concealed: '22225588m225588p',
        melds: '',
        huMethod: 'zimo',
        remainingOpponents: 3,
      },
    ],
  },
  {
    group: '金钩/四杠（副露 4 组）',
    items: [
      {
        title: '金钩钓（点炮）',
        subtitle: '副露 4 组，结构番=金钩钓×4（不再另计碰碰胡）',
        concealed: '55m',
        melds: ['碰 1m', '碰 2m', '碰 3p', '碰 4p'].join('\n'),
        huMethod: 'dianpao',
      },
      {
        title: '清一色 + 金钩钓（自摸）',
        subtitle: '展示“清一色×4 × 金钩钓×4”',
        concealed: '55m',
        melds: ['碰 1m', '碰 2m', '碰 3m', '碰 4m'].join('\n'),
        huMethod: 'zimo',
        remainingOpponents: 3,
      },
      {
        title: '金钩钓 + 4根（点炮）',
        subtitle: '四杠=4根，展示“金钩钓×4 × 4根×16”',
        concealed: '55m',
        melds: ['杠 1m', '杠 2m', '杠 3m', '杠 4p'].join('\n'),
        huMethod: 'dianpao',
      },
      {
        title: '清一色 + 金钩钓 + 4根（自摸）',
        subtitle: '展示“清一色×4 × 金钩钓×4 × 4根×16 × 自摸×2”',
        concealed: '55m',
        melds: ['杠 1m', '杠 2m', '杠 3m', '杠 4m'].join('\n'),
        huMethod: 'zimo',
        remainingOpponents: 3,
      },
    ],
  },
  {
    group: '事件番（×2）',
    items: [
      {
        title: '杠上开花（自摸）',
        subtitle: '真实流程：暗杠 1m → 补张 9m 自摸（自动识别“杠上开花×2”）',
        // 起手为“刚摸到 1m（hand.extra）”，可暗杠；补张固定摸到 9m 后自摸成胡。
        concealed: '11123456778m11p1m',
        melds: '',
        huMethod: 'zimo',
        remainingOpponents: 3,
        script: { kind: 'gangShangKaiHua', gangType: 'an', kongTile: '1m', winTile: '9m' },
      },
      {
        title: '海底捞月（自摸）',
        subtitle: '事件番：海底捞月×2（需自摸）',
        concealed: '123456789m12311p',
        melds: '',
        huMethod: 'zimo',
        remainingOpponents: 1,
        events: { haiDi: true },
      },
      {
        title: '杠上炮（点炮）',
        subtitle: '事件番：杠上炮×2（需点炮）',
        concealed: '123456789m12311p',
        melds: '',
        huMethod: 'dianpao',
        events: { gangShangPao: true },
      },
      {
        title: '抢杠胡（点炮）',
        subtitle: '事件番：抢杠胡×2（需点炮）',
        concealed: '123456789m12311p',
        melds: '',
        huMethod: 'dianpao',
        events: { qiangGangHu: true },
      },
    ],
  },
];
