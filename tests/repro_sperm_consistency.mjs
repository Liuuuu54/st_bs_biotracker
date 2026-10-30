// 对照首个最小一致性修复的上游基线；只读 git 对象，不修改工作区或调用外部服务。
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import * as current from '../scripts/tools.js';
import * as calculator from '../scripts/calculator.js';
import { createEmptyChatState, createDefaultFemaleState } from '../scripts/state.js';
import { setSpermSources } from '../scripts/sperm_sources.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const baselineRef = '4e0311df080fefc1994e7876d49810f2e6e49b29';
const originalSource = (path) => execFileSync('git', ['show', `${baselineRef}:${path}`], { cwd: root, encoding: 'utf8' });
const moduleUrl = (source, replacements = {}) => {
  const rewritten = source.replace(/from '\.\/([^']+)'/g, (_, path) => `from '${replacements[path] || pathToFileURL(resolve(root, 'scripts', path)).href}'`);
  return `data:text/javascript;base64,${Buffer.from(rewritten).toString('base64')}`;
};
const originalCalculatorUrl = moduleUrl(originalSource('scripts/calculator.js'));
const originalCalculator = await import(originalCalculatorUrl);
const originalTools = await import(moduleUrl(originalSource('scripts/tools.js'), { 'calculator.js': originalCalculatorUrl }));
const source = (value, patch = {}) => ({ male: 'A', race: '人类', quality: 1, value, ...patch });
const chances = (api, sources) => api.calculateFertilizationPreview({ spermSources: sources }).successChance;
console.log(`上游基线 ${baselineRef.slice(0, 7)}；新旧均调用实际计算器/工具分派器。`);
console.table([
  ['同父20一笔', [source(20)]],
  ['同父10+10两笔', [source(10), source(10)]],
  ['A40+B20', [source(40), source(20, { male: 'B' })]],
  ['A20+A20+B20', [source(20), source(20), source(20, { male: 'B' })]],
].map(([scenario, sources]) => {
  const old = originalCalculator.calculateFertilizationPreview({ spermSources: sources });
  const fixed = calculator.calculateFertilizationPreview({ spermSources: sources });
  const fatherA = (result) => result.sources.filter((row) => row.male === 'A').reduce((n, row) => n + row.winnerWeight, 0);
  return { scenario, oldChance: chances(originalCalculator, sources), fixedChance: chances(calculator, sources), oldFatherA: fatherA(old), fixedFatherA: fatherA(fixed) };
}));

function setup(sources, eggs = 0, count = 1) {
  const chat = createEmptyChatState();
  for (let i = 0; i < count; i++) {
    const name = `F${i}`;
    const female = createDefaultFemaleState(name);
    female.initialized = true;
    Object.assign(female.profile.base, { stage: '卵泡期', days: 0, race: '人类', bodySize: 4, age: 24, eggs, vitality: 100, libido: 0, psyStress: 0, uterinePressure: 0 });
    female.profile.bio.impregnationDifficulty = 1;
    setSpermSources(female.profile.base, sources.map((row, index) => ({ ...row, id: index + 1, minutesPassed: 0 })));
    chat.characters[name] = female;
  }
  return chat;
}
const call = (api, chat, name, args) => api.applyToolCall(chat, { name, arguments: args });
const drain = (api, sources, attempts) => {
  const chat = setup(sources);
  for (const amount of attempts) call(api, chat, 'bsDrainSperm', { female: 'F0', amount });
  return chat.characters.F0.profile.base.sperms.reduce((n, row) => n + row.value, 0);
};
console.table([
  ['40品质4 / 20一次', [source(40, { quality: 4 })], [20]],
  ['40品质4 / 10两次', [source(40, { quality: 4 })], [10, 10]],
  ['40品质4 / 80一次', [source(40, { quality: 4 })], [80]],
  ['40品质4 / 20四次', [source(40, { quality: 4 })], [20, 20, 20, 20]],
  ['混合品质 / 80一次', [source(10, { quality: 0.25 }), source(90, { male: 'B', quality: 4 })], [80]],
  ['混合品质 / 40两次', [source(10, { quality: 0.25 }), source(90, { male: 'B', quality: 4 })], [40, 40]],
].map(([scenario, sources, attempts]) => ({ scenario, oldRemaining: drain(originalTools, sources, attempts), fixedRemaining: drain(current, sources, attempts) })));

// 只量同步 Node 分派，不冒充浏览器帧率；预热后取21次的中位数，建立状态不计时。
const benchmark = (api, days, count) => {
  const times = [];
  const random = Math.random;
  Math.random = () => 0.99;
  try {
    for (let i = 0; i < 24; i++) {
      const chat = setup([source(40)], 1, count);
      const start = performance.now();
      const result = call(api, chat, 'bsPassedTime', { day: days });
      const ms = performance.now() - start;
      if (!result.applied) throw new Error(result.message);
      if (i >= 3) times.push(ms);
    }
  } finally { Math.random = random; }
  return times.sort((a, b) => a - b)[Math.floor(times.length / 2)];
};
console.table([[1, 1], [7, 1], [31, 1], [7, 4], [365, 4]].map(([days, characters]) => ({
  days, characters, oldMedianMs: benchmark(originalTools, days, characters), fixedMedianMs: benchmark(current, days, characters),
})));
