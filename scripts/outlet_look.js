// 外口的样子（1.6.0）：外阴分页画出来、跟人类明显不同的那几样，写成一句送提示词，文字才对得上画面。
// 照外阴种族表（vulva_race_presets.js，画面用的同一份）与角色当下的外口布局；跟人类差不多的（唇形、阴蒂长短）不送。
// 种族表是固定的，所以这一句跟布局一样等于注册后锁住（plan/REGISTRATION_LOCK_PLAN.md）。

import { VULVA_RACE_PRESETS } from './vulva_race_presets.js';
import { getBaseRaceName, getCharacterOutletLayout, pickDominantRaceName } from './race_config.js';
import { toTraditionalName } from './race_names.js';

// 外缘装饰（分离开口、管状与泄殖腔都画）
const EDGE_LOOK = Object.freeze({
  scales: '外缘一圈细鳞', feathers: '外缘一圈羽纹', wax: '外缘是蜡滴的边', seams: '外缘是球关节与金属接缝',
  metal: '外缘一圈细密的金属格', pixel: '外缘带着扫描线', shadow: '外缘是流动的影纹', ink: '外缘晕着墨色',
  facets: '外缘是晶体的切面', mottle: '外缘带着色斑',
});
// 泄殖腔口上方的装饰
const OUTLET_LOOK = Object.freeze({
  feathers: '口上方覆着羽纹', scales: '口上方覆着细鳞', ridges: '口上方一道道横褶', veins: '口周浮着经脉', mixed: '口上方鳞与羽交错',
});
// 泄殖腔的口缘
const RIM_LOOK = Object.freeze({ marsupial: '口缘是一圈短软褶（有袋类的样子）', monotreme: '口缘是平滑的细唇' });

function presetOf(base) {
  const race = base?.race || '人类';
  const name = getBaseRaceName(pickDominantRaceName(race, base?.bloodline || null) || race);
  return VULVA_RACE_PRESETS[toTraditionalName(name)] || VULVA_RACE_PRESETS[name] || null;
}

/** 外口的样子写成一句；跟人类差不多时回传空字串 */
export function describeOutletLook(base) {
  const preset = presetOf(base);
  if (!preset) return '';
  const layout = getCharacterOutletLayout(base);
  const parts = [];
  if (layout === 'cloaca') {
    if (RIM_LOOK[preset['cloacal-rim']]) parts.push(RIM_LOOK[preset['cloacal-rim']]);
    if (OUTLET_LOOK[preset['outlet-decoration']]) parts.push(OUTLET_LOOK[preset['outlet-decoration']]);
  }
  if (EDGE_LOOK[preset['edge-decoration']]) parts.push(EDGE_LOOK[preset['edge-decoration']]);
  return parts.join('，');
}

/** 育儿袋写成一句（有袋才有）：袋口在下腹、没有肚脐；产后恢复期袋里有幼体时写几个、是什么 */
export function describePouch(view) {
  if (!view) return '';
  const brood = view.brood;
  const text = '有育儿袋：下腹一道横向的袋口，没有肚脐';
  if (!brood) return text;
  const inside = brood.kind === 'egg' ? `袋里有 ${brood.count} 颗蛋，下腹鼓着`
    : brood.kind === 'blob' ? '袋里的幼体没有固定形状，下腹鼓着、慢慢蠕动'
      : `袋里有 ${brood.count} 个幼体，下腹鼓着，偶尔从袋口探出一点头再缩回去`;
  return `${text}；${inside}`;
}
