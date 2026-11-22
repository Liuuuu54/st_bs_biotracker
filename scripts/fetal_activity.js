// 胎动提示（1.5.3）：每个故事日、每一胎掷一次「今天的动静」，同一天不变（种子＝故事日＋胎儿编号），不存档。
// 孕体特写的胎动动画与主线提示读同一个值：今天好动的那胎，特写也踢得勤、正文也写得到。
// 纯计算，不碰状态。

import { seededRandom } from './egg_quality.js';

export const FETAL_ACTIVITY_LEVELS = Object.freeze(['安静', '一般', '好动', '激烈']);

const clamp = (value, min, max, fallback) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, num));
};

/**
 * 今天的动静 0–3（安静／一般／好动／激烈）。
 * 偏移：健康好、孕中晚（有效孕日 140 天以上）偏活跃；健康危急时偏安静（安静本身就是警讯）；母体情压高偏好动。
 */
export function getFetalDailyActivity(fetus, { storyDay = 0, effectiveDays = 0, stressRatio = 0 } = {}) {
  const random = seededRandom(`kick|${Math.floor(Number(storyDay) || 0)}|${fetus?.embryoId ?? 0}`);
  const health = clamp(fetus?.health, 0, 100, 50);
  let score = random() * 2 + 0.5; // 0.5～2.5，平均 1.5
  if (health < 20) score -= 1.2;
  else if (health < 35) score -= 0.5;
  else if (health > 65) score += 0.3;
  if (Number(effectiveDays) >= 140) score += 0.3;
  if (Number(effectiveDays) < 112) score -= 0.4;
  score += 0.6 * clamp(stressRatio, 0, 1, 0);
  return Math.max(0, Math.min(3, Math.floor(score)));
}

/** 胎背朝哪边，踢的就在另一边（「胎背朝左前」→ 往右侧踢）；看不出来回传空字串 */
export function kickSideOf(fetus) {
  const side = String(fetus?.backSide || '');
  if (side.startsWith('左')) return '右侧';
  if (side.startsWith('右')) return '左侧';
  return '';
}

/**
 * 给主线的一句：「老大今天格外好动，常往右侧踢；老二很安静」。
 * fetuses：角色已知、已着床、还没封在宿主里的胎儿（呼叫端过滤）。回传 { text, push }：
 * push＝今天有好动以上的胎儿，正文该带一笔胎动。
 */
export function describeMovementCue(fetuses, options = {}) {
  const list = Array.isArray(fetuses) ? fetuses : [];
  if (!list.length) return { text: '', push: false };
  const names = list.length === 1 ? ['腹中的孩子'] : list.map((_, index) => ['老大', '老二', '老三', '老四', '老五', '老六'][index] || `第 ${index + 1} 胎`);
  const levels = list.map((fetus) => getFetalDailyActivity(fetus, options));
  if (levels.every((level) => level === 0)) return { text: list.length === 1 ? '腹中整天都很安静' : '腹中的孩子们整天都很安静', push: false };
  const parts = list.map((fetus, index) => {
    const level = levels[index];
    const side = kickSideOf(fetus);
    if (level === 3) return `${names[index]}今天踢得很凶${side ? `，多在${side}` : ''}`;
    if (level === 2) return `${names[index]}今天格外好动${side ? `，常往${side}踢` : ''}`;
    if (level === 1) return `${names[index]}偶尔动一动`;
    return `${names[index]}很安静`;
  });
  return { text: parts.join('；'), push: levels.some((level) => level >= 2) };
}
