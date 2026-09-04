/**
 * 胎儿标签：给一颗胎儿标注「它是怎么来的／它现在处于什么特殊状态」。
 *
 * 分两类来源，合并后去重：
 * 1. 可从既有栏位推导的（嵌合体、代孕、自交）——不落盘。存量存档不需要迁移就能显示，
 *    也不会出现「资料改了但标签还留着旧的」这种两份真相打架的情况。
 * 2. 推导不出来的（同卵分裂，以及往后的胎内回归、异期复孕、孕中孕、雄雌核发生）
 *    ——写进 fetus.tags 落盘。这些事件的证据在发生当下就消失了：同卵分裂产生的复制体
 *    和原胚在栏位上完全一样，事后无从分辨；未来那几项则根本没有对应栏位。
 *
 * 本模块是纯资料层，不依赖引擎也不依赖宿主 API。
 */

/**
 * id 稳定且与语言无关（落盘的是 id，不是中文字），label 供介面显示，
 * short 只在该标签真的出现在本轮 payload 时才注入提示词——与种族短叙述同规则，
 * 没用到的标签不占 token。
 */
export const FETUS_TAG_CATALOG = [
  {
    id: 'chimera',
    label: '嵌合体',
    derived: true,
    short: '由两颗以上受精卵在着床前融合而成，同一个体身上带有多套来源的血统与性别倾向。',
  },
  {
    id: 'surrogacy',
    label: '代孕',
    derived: true,
    short: '承载者不是遗传母亲；卵来自 provider，孕育者只提供子宫。',
  },
  {
    id: 'selfing',
    label: '自交',
    derived: true,
    short: '父方与遗传母方是同一个人，后代的双亲同源。',
  },
  {
    id: 'identical',
    label: '同卵',
    short: '与同批其他带此标签、identicalGroup 相同的胎儿由同一颗受精卵分裂而来，基因一致。',
  },
  // ── 以下为预留：目前没有任何流程会产生，栏位与语义先定下来，
  //    等对应玩法实作时直接往 fetus.tags 里写 id 即可，不必再改资料结构。
  {
    id: 'womb_return',
    label: '胎内回归',
    short: '一名已出生的角色重新回到子宫内成为胎儿；产出后是新的个体，与原角色在系统上不是同一笔资料。',
  },
  {
    id: 'superfetation',
    label: '异期复孕',
    short: '在已有妊娠进行中再次受精形成的胎儿，与同腹其他胎儿的孕龄不同步。',
  },
  {
    id: 'nested',
    label: '孕中孕',
    short: '这名胎儿自身也怀有胎儿，形成套叠的妊娠。',
  },
  {
    id: 'androgenesis',
    label: '雄核发生',
    short: '细胞核只来自父方，母方仅提供卵细胞质与孕育环境。',
  },
  {
    id: 'gynogenesis',
    label: '雌核发生',
    short: '细胞核只来自母方，精子仅触发发育而不提供遗传物质。',
  },
];

const TAG_BY_ID = new Map(FETUS_TAG_CATALOG.map((tag) => [tag.id, tag]));
const TAG_ORDER = new Map(FETUS_TAG_CATALOG.map((tag, index) => [tag.id, index]));

export function isKnownFetusTag(id) {
  return TAG_BY_ID.has(String(id || ''));
}

/** 未收录的 id 一律丢弃：落盘资料只允许出现目录里有的标签 */
export function sanitizeFetusTagList(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  for (const item of value) {
    const id = String(item || '').trim();
    if (isKnownFetusTag(id)) seen.add(id);
  }
  return sortFetusTags([...seen]);
}

function sortFetusTags(ids) {
  return [...ids].sort((a, b) => (TAG_ORDER.get(a) ?? 999) - (TAG_ORDER.get(b) ?? 999));
}

function splitSources(value) {
  return String(value || '')
    .split(/\s*[×Xx]\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** 遗传母方名单：优先取 providerSources，再退到 provider，最后是嵌合体的母源 */
function maternalNames(fetus, carrierName) {
  if (Array.isArray(fetus?.providerSources) && fetus.providerSources.length > 0) {
    return fetus.providerSources.map((item) => String(item || '').trim()).filter(Boolean);
  }
  const provider = String(fetus?.provider || '').trim();
  if (provider) return splitSources(provider);
  if (Array.isArray(fetus?.chimera?.maternalSources) && fetus.chimera.maternalSources.length > 0) {
    return fetus.chimera.maternalSources.map((item) => String(item || '').trim()).filter(Boolean);
  }
  const carrier = String(carrierName || '').trim();
  return carrier ? [carrier] : [];
}

/**
 * 一颗胎儿（或一笔孩子记录）当前的完整标签集合。
 * @param context.carrierName 承载者名字；判断代孕与自交都要拿它作基准
 */
export function deriveFetusTags(fetus, { carrierName = '' } = {}) {
  if (!fetus || typeof fetus !== 'object') return [];
  const found = new Set(sanitizeFetusTagList(fetus.tags));
  const carrier = String(carrierName || '').trim();

  if (fetus.chimera) found.add('chimera');

  const mothers = maternalNames(fetus, carrier);
  if (carrier && mothers.some((name) => name && name !== carrier)) found.add('surrogacy');

  const fathers = splitSources(fetus.fathers).filter((name) => name && name !== '未知');
  if (fathers.length > 0 && mothers.length > 0 && fathers.some((name) => mothers.includes(name))) {
    found.add('selfing');
  }

  return sortFetusTags([...found]);
}

export function getFetusTagLabel(id) {
  return TAG_BY_ID.get(String(id || ''))?.label || String(id || '');
}

export function getFetusTagLabels(ids) {
  return (Array.isArray(ids) ? ids : []).map(getFetusTagLabel);
}

/** 提示词用：只描述本轮真的出现过的标签 */
export function describeFetusTags(ids) {
  const wanted = new Set((Array.isArray(ids) ? ids : []).filter(isKnownFetusTag));
  return FETUS_TAG_CATALOG
    .filter((tag) => wanted.has(tag.id))
    .map((tag) => `  - ${tag.id}（${tag.label}）：${tag.short}`);
}
