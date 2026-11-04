import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// 运行：node --experimental-vm-modules tests/benchmark_pooled_events.mjs
// 这是 Node 原生模块入口的微基准，不是浏览器性能或端到端 UI 测量。
// 新旧模块只插入完整角色入口计数；积分、随机、时间调度和公开分发逻辑均保持原样。
const root = fileURLToPath(new URL('../', import.meta.url));
const oldRevision = '206b441';
const marker = 'function applyTimeToCharacter(character, tick) {';
if (typeof vm.SourceTextModule !== 'function') {
  throw new Error('请用 node --experimental-vm-modules tests/benchmark_pooled_events.mjs 运行。');
}
async function loadRuntime(revision) {
  const context = vm.createContext({ console, URL, URLSearchParams, TextEncoder, TextDecoder,
    structuredClone, setTimeout, clearTimeout, performance, crypto: globalThis.crypto });
  context.__nativePooledBatchCalls = [];
  const cache = new Map();
  const pending = new Map();
  const load = (relative) => {
    if (pending.has(relative)) return pending.get(relative);
    const promise = (async () => {
      const original = revision
        ? execFileSync('git', ['show', `${revision}:${relative}`], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
        : await readFile(path.join(root, relative), 'utf8');
      let code = original;
      if (relative === 'scripts/tools.js') {
        assert.equal(original.split(marker).length, 2, '计数插桩只允许匹配真实角色入口一次');
        code = original.replace(marker, `${marker}\n  globalThis.__nativePooledBatchCalls.push(character.name);`);
      }
      const module = new vm.SourceTextModule(code, { context, identifier: relative,
        initializeImportMeta(meta) { meta.url = pathToFileURL(path.join(root, relative)).href; } });
      cache.set(relative, module);
      return module;
    })();
    pending.set(relative, promise);
    return promise;
  };
  const tools = await load('scripts/tools.js');
  await tools.link((specifier, referencing) => {
    assert.ok(specifier.startsWith('.'), `基准仅加载仓库内真实依赖：${specifier}`);
    return load(path.posix.normalize(path.posix.join(path.posix.dirname(referencing.identifier), specifier)));
  });
  await tools.evaluate();
  return { context, tools: tools.namespace, state: cache.get('scripts/state.js').namespace,
    pooled: cache.get('scripts/pooled_reproduction.js').namespace, modules: cache.size };
}
function fixture(runtime) {
  const chat = runtime.state.createEmptyChatState();
  for (const [name, pooled] of [['混合池角色', true], ['默认角色', false]]) {
    const character = runtime.state.createDefaultFemaleState(name);
    character.initialized = true;
    Object.assign(character.profile.base, { age: 24, race: '人类', bodySize: 4,
      stage: pooled ? '孕早期' : '无经期', days: pooled ? 50 : 0, eggs: pooled ? 2 : 0,
      isHere: false, vitality: 100, libido: 0, psyStress: 0 });
    character.profile.bio.identicalProbability = 0;
    character.profile.immune.metabolism = true;
    character.runtime = { dayCarryMinutes: 0, hourCarryMinutes: 0, lifestyleWeekCarryMinutes: 0 };
    if (pooled) {
      const sources = [0.25, 1, 4].map((quality, i) => ({ id: i + 1, male: `父方${i}`, race: '人类',
        value: 30, quality, bodySize: 4, genetic: { snapshot: `固定${i}` }, minutesPassed: 0 }));
      character.profile.base.spermContacts = sources;
      character.profile.base.sperms = sources.map((source) => ({ ...source }));
      Object.assign(character.profile.pregnant, { pregnantDays: 50, effectivePregnantDays: 50,
        fetusesCount: 1, fetuses: [{ embryoId: 1, fathers: '原父方', race: '人类', gender: '女',
          embryoType: '胎生', weight: 1, tendencyAngle: 0, backSide: 'left_anterior', affinity: 0,
          amnionDurability: 100, tags: [] }] });
      runtime.pooled.enablePooledConception(character.profile.base, 0, { seed: '真实工具性能固定种子' });
      for (const egg of character.profile.base.spermPool.eggs) egg.threshold = egg.remainingHazard = 100;
    }
    chat.characters[name] = character;
  }
  return chat;
}
function sample(runtime, day) {
  const chat = fixture(runtime);
  runtime.context.__nativePooledBatchCalls = [];
  const start = performance.now();
  const result = runtime.tools.applyToolCall(chat, { name: 'bsPassedTime', arguments: { day } });
  const milliseconds = performance.now() - start;
  assert.equal(result.applied, true, result.message);
  const pool = chat.characters['混合池角色'].profile.base.spermPool;
  assert.equal(chat.minutesPassed, day * 1440);
  assert.equal(pool.lastMinute, chat.minutesPassed);
  return { milliseconds, fullCharacterCalls: runtime.context.__nativePooledBatchCalls.length,
    perCharacter: Object.fromEntries(['混合池角色', '默认角色'].map((name) => [name,
      runtime.context.__nativePooledBatchCalls.filter((value) => value === name).length])),
    worldMinute: chat.minutesPassed, poolMinute: pool.lastMinute,
    events: result.conceptionEvents?.length ?? 0 };
}
function summarize(runtime, revision, day, repeats) {
  const samples = Array.from({ length: repeats }, () => sample(runtime, day));
  const sorted = samples.map((item) => item.milliseconds).sort((a, b) => a - b);
  return { revision, days: day, repetitions: repeats, medianMilliseconds: sorted[Math.floor(sorted.length / 2)],
    samples, modulesLoaded: runtime.modules };
}

const current = await loadRuntime(null);
// 先做一笔新入口预热；旧入口不额外预热，避免重复旧分钟算法的昂贵遍历。
sample(current, 1);
const rows = [];
for (const day of [1, 7, 32, 180, 365]) {
  const row = summarize(current, '当前工作树', day, 3);
  assert.ok(row.samples.every((sample) => sample.fullCharacterCalls === 2));
  rows.push(row);
  console.log(JSON.stringify({ 阶段: '当前', 天数: day, 中位毫秒: row.medianMilliseconds, 每次完整角色调用: 2 }));
}
const old = await loadRuntime(oldRevision);
for (const day of [1, 7]) {
  const row = summarize(old, oldRevision, day, 1);
  rows.push(row);
  console.log(JSON.stringify({ 阶段: '旧分钟基线', 天数: day, 毫秒: row.medianMilliseconds,
    完整角色调用: row.samples[0].fullCharacterCalls }));
}
console.log(JSON.stringify({ environment: `Node ${process.version} / ${process.platform} ${process.arch}`,
  measurement: '真实tools.applyToolCall；旧提交全部依赖通过git show在内存加载；仅入口计数插桩；不代表浏览器；计时排除模块加载和fixture创建',
  fixture: '同一两角色配置：一名已启用混合池孕早期角色，三品质固定精源各30、两颗高预算卵和一胎；一名未启用默认角色',
  rows }, null, 2));
