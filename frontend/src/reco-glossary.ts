export type RecoGlossaryEntry = {
  key: string;
  title: string;
  plain: string;
  inGame: string;
  example: string;
  aliases?: Array<string>;
};

const ENTRIES: Array<RecoGlossaryEntry> = [
  {
    key: '向听',
    title: '向听',
    plain: '离“听牌”还差几步；数字越小越接近听牌，0 向听表示已听牌。',
    inGame: '拆牌面板里向听按“路线”分别计算（标准型/七对不混算），用于排序与对比候选动作。',
    example: '1 向听表示再改进 1 步就能听牌；0 向听表示已经听牌。',
    aliases: ['向听数'],
  },
  {
    key: '进张U(K种)',
    title: '进张 U/K',
    plain: '下一摸能让当前路线向听严格变小的牌；K=种类数，U=剩余张数总和。',
    inGame: '当前只统计“向听严格变小”的进张，不含同向听改良；0 向听也统一显示进张。',
    example: '进张 8(3 种) 表示有 3 种牌合计还剩 8 张，摸到其中之一可让向听变小。',
    aliases: ['进张', '进张U(K)', '进张U/K'],
  },
  {
    key: '进张口径',
    title: '进张口径',
    plain: '计算“进张”时采用的统计规则与范围。',
    inGame: '目前口径：只算向听严格变小，不算“同向听但更好”的改良张；用于让排序更稳定、更可复现。',
    example: '摸到某张牌只让形状更好但向听不变时，这张牌不会计入进张。',
  },
  {
    key: 'P≈U/N',
    title: 'P≈U/N',
    plain: '下一摸命中进张的近似概率。',
    inGame: 'U=进张总数；N=未知牌池（牌墙剩余 + 所有对手未公开暗手）。所以这是近似值，用于对比候选。',
    example: 'U=8、N=40，则 P≈8/40=20%。',
    aliases: ['P', '命中概率'],
  },
  {
    key: '预估得分',
    title: '预估得分',
    plain: '对“收益”的粗估，用于对比候选动作在当前路线下的进攻价值。',
    inGame: '0 向听时更关注“平均点炮”；非 0 向听时展示“点炮区间”。这是排序参考，不承诺精确。',
    example: '预估点炮区间=80–140，表示该路线的收益大致落在这个范围内。',
    aliases: ['预估收益'],
  },
  {
    key: '窗口分W',
    title: '窗口分 W',
    plain: '标准型的粗粒度形状指标：1/9=1，2/8=2，3–7=3。',
    inGame: '只在标准型页展示/参与排序；窗口分不能等同于“搭子分类”，仅作快速判断形状的辅助指标。',
    example: '窗口分 3 往往表示更偏中张结构（如 4–6 附近）。',
    aliases: ['窗口分', 'W'],
  },
  {
    key: '安全分k/n',
    title: '安全分 k/n',
    plain: '定缺“硬安全”口径下的相对安全评分。',
    inGame: '安全分只表示定缺硬安全，不与熟/壁/筋混成总分；安全相关排序为：安全分 → 熟 → 壁 → 筋。',
    example: '安全分 0.67 通常比 0.35 更安全（同口径对比）。',
    aliases: ['安全分'],
  },
  {
    key: '熟↑x',
    title: '熟↑x（熟牌）',
    plain: '这张候选弃牌在公开区里已出现 x 张；熟↑0 就等于生牌。',
    inGame: '熟越多一般越安全（别人更难再用同张做进攻），但仍需结合定缺与局况综合判断。',
    example: '熟↑2 表示这张牌已在公开区出现 2 张。',
    aliases: ['熟', '熟牌'],
  },
  {
    key: '壁↑x',
    title: '壁↑x（满壁）',
    plain: '只算“满壁”证据：看相邻牌是否 4 张全见；x 只会是 0/1/2 等小整数。',
    inGame: '壁证据越多通常越安全；该指标用于辅助安全排序，避免把安全拆成过多细项导致误读。',
    example: '壁↑1 表示存在 1 个方向形成满壁证据。',
    aliases: ['壁', '满壁'],
  },
  {
    key: '筋↑x',
    title: '筋↑x（筋）',
    plain: '看同花色 ±3 的两张牌在公开区出现多少张，总和越大筋证据越强。',
    inGame: '筋用于辅助评估“是否容易被点炮”的风险；在同安全分时，用熟/壁/筋做细分排序。',
    example: '筋↑3 表示两张筋牌在公开区合计出现 3 张。',
    aliases: ['筋', '筋牌'],
  },
  {
    key: '定缺',
    title: '定缺',
    plain: '确定缺门（万/筒/条）。定缺后未清缺前，缺门牌不能碰/杠/胡。',
    inGame: '拆牌面板若提示“清缺中”，表示你仍有缺门牌，需要优先打完缺门牌后再做更细的效率/安全对比。',
    example: '定缺筒：手里还有筒子时，优先把筒子打掉。',
    aliases: ['缺门'],
  },
  {
    key: '清缺',
    title: '清缺',
    plain: '把缺门牌打到 0（或满足规则允许的清缺条件）。',
    inGame: '清缺中会优先给清缺建议；缺门限制会影响可行动作与指标可用性（例如部分向听/进张口径可能暂停）。',
    example: '定缺筒后，先连续打出所有筒子，进入“清缺完成”。',
  },
  {
    key: '标准型',
    title: '标准型',
    plain: '常规成型路线（顺子/刻子为主），区别于七对等特殊路线。',
    inGame: '拆牌面板里标准型与七对分开计算、分开排序；标准型页会额外展示窗口分等指标。',
    example: '同一手牌标准型可能 1 向听，七对可能 2 向听。',
    aliases: ['标准'],
  },
  {
    key: '七对',
    title: '七对',
    plain: '以凑齐七个对子为目标的成型路线。',
    inGame: '七对页不看窗口分，也不展示递归树；排序口径与标准型略有差异，但同样遵循“向听→进张→收益→安全”。',
    example: '已有 6 对 + 2 张孤张时，七对往往比标准型更接近听牌。',
    aliases: ['七对路线'],
  },
  {
    key: '排序',
    title: '排序',
    plain: '用固定指标顺序对候选动作排序，保证推荐稳定可复现。',
    inGame: '标准型：向听 → U → K → 预估得分 → 窗口分 → 安全；七对：向听 → U → K → 预估得分 → 安全。',
    example: '当两张候选向听相同，就继续比进张 U；还相同再比 K 与预估得分。',
    aliases: ['排序口径', '推荐顺序'],
  },
];

const BY_KEY = new Map<string, RecoGlossaryEntry>(ENTRIES.map((e) => [e.key, e]));
const BY_ALIAS = new Map<string, RecoGlossaryEntry>();
for (const e of ENTRIES) {
  for (const a of e.aliases ?? []) {
    if (!BY_ALIAS.has(a)) BY_ALIAS.set(a, e);
  }
}

export const RECO_GLOSSARY_ENTRIES: Array<RecoGlossaryEntry> = ENTRIES;

export function findRecoGlossaryEntry(rawKey: unknown): RecoGlossaryEntry | null {
  const key = typeof rawKey === 'string' ? rawKey.trim() : '';
  if (!key) return null;
  return BY_KEY.get(key) ?? BY_ALIAS.get(key) ?? null;
}

