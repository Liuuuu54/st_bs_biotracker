// 对照第一PR修复后的默认算法与显式启用的实验池；不是未修复上游的旧算法。
// 执行：node tests/repro_sperm_pool.mjs；原版对照另见 repro_sperm_consistency.mjs。
import { calculateFertilizationPreview } from '../scripts/calculator.js';
import { applyToolCall } from '../scripts/tools.js';
import { enablePooledConception } from '../scripts/pooled_reproduction.js';
import { createDefaultFemaleState, createEmptyChatState } from '../scripts/state.js';
const percent = (p) => `${(p * 100).toFixed(6)}%`;
const cases = [
  ['1×20', [20]], ['2×10 (same total)', [10, 10]],
  ['1×40', [40]], ['2×20 (same total)', [20, 20]],
];
console.table(cases.map(([input, amounts]) => {
  const options = { eggRace: '人类', elapsedDays: 1, uterusVolumeFactor: 1,
    spermSources: amounts.map((value) => ({ male: 'same-donor', race: '人类', value, quality: 1 })) };
  return { input, defaultFixed: percent(calculateFertilizationPreview(options).successChance),
    pooled: percent(calculateFertilizationPreview({ ...options, model: 'pooled-v1' }).successChance) };
}));
console.log('These are single-egg, no-new-input mathematical projections, not browser/clinical results.');

// 直接执行公开工具；默认路径保留第一PR的修复，不以手写公式冒充原生结果。
function runDrain(rows, attempts, pooled) {
  const chat = createEmptyChatState();
  const mother = createDefaultFemaleState('母方');
  mother.initialized = true;
  Object.assign(mother.profile.base, { age: 24, race: '人类', bodySize: 4, stage: '卵泡期', days: 3, sperms: rows.map((row) => ({ ...row })) });
  chat.characters['母方'] = mother;
  if (pooled) enablePooledConception(mother.profile.base, 0, { seed: 'drain-reproduction' });
  for (const amount of attempts) {
    const result = applyToolCall(chat, { name: 'bsDrainSperm', arguments: { female: '母方', amount } });
    if (!result.applied) throw new Error(result.message);
  }
  return chat.characters['母方'].profile.base.sperms.reduce((n, row) => n + row.value, 0);
}
const high = [{ male: 'A', race: '人类', value: 40, quality: 4 }];
const mixed = [{ male: 'A', race: '人类', value: 20, quality: .25 }, { male: 'B', race: '人类', value: 20, quality: 4 }];
console.table([
  ['40/q4, effort20', high, [20]], ['40/q4, effort10+10', high, [10, 10]],
  ['40/q4, effort80', high, [80]], ['40/q4, effort20x4', high, [20, 20, 20, 20]],
  ['mixed, effort20', mixed, [20]], ['mixed, effort10+10', mixed, [10, 10]],
].map(([input, rows, attempts]) => ({ input,
  defaultFixedRemaining: runDrain(rows, attempts, false), pooledRemaining: runDrain(rows, attempts, true) })));
console.log('Drain rows use actual bsDrainSperm dispatch at one world minute; no clock advancement.');
