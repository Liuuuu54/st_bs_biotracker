// 物种体型：内置资料、百科覆写的清理、混血加权与提示词的体型行。
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ALL_BUILTIN_RACES,
  BODY_SIZE_INDIVIDUAL,
  getMergedRaceBodySize,
  getMergedRacePhysiologyProfile,
  getRacePhysiologyProfile,
  sanitizeRacePhysiologyProfilePatch,
  setRacePhysiologyOverrides,
} from '../scripts/race_config.js';
import { buildSingleRacePhysiologyText } from '../scripts/race_prompt_context.js';

test('81 个内置物种都有体型资料，值在合法范围内', () => {
  assert.equal(ALL_BUILTIN_RACES.length, 81);
  for (const race of ALL_BUILTIN_RACES) {
    const { bodySize, bodySizeSd, altFormBodySize } = getRacePhysiologyProfile(race);
    if (typeof bodySize === 'number') {
      assert.ok(Number.isInteger(bodySize) && bodySize >= 1 && bodySize <= 7, `${race} bodySize ${bodySize}`);
      assert.ok(typeof bodySizeSd === 'number' && bodySizeSd > 0 && bodySizeSd <= 3, `${race} bodySizeSd ${bodySizeSd}`);
    } else {
      assert.ok(bodySize === null || bodySize === BODY_SIZE_INDIVIDUAL, `${race} bodySize ${bodySize}`);
      assert.equal(bodySizeSd, null, `${race} 可变与依个体不带标准差`);
      assert.equal(altFormBodySize, null, `${race} 可变与依个体没有变化态`);
    }
    if (altFormBodySize !== null) {
      assert.ok(Number.isInteger(altFormBodySize) && altFormBodySize >= 1 && altFormBodySize <= 7, `${race} altFormBodySize ${altFormBodySize}`);
    }
  }
});

test('人类为 4 级、标准差 0.4、没有变化态；变形种族的常态记人态', () => {
  assert.deepEqual(pickBodySize(getRacePhysiologyProfile('人类')), { bodySize: 4, bodySizeSd: 0.4, altFormBodySize: null });
  assert.deepEqual(pickBodySize(getRacePhysiologyProfile('东方龙')), { bodySize: 4, bodySizeSd: 0.5, altFormBodySize: 7 });
  assert.deepEqual(pickBodySize(getRacePhysiologyProfile('妖精')), { bodySize: 1, bodySizeSd: 0.4, altFormBodySize: 4 });
  assert.equal(getRacePhysiologyProfile('史萊姆').bodySize, null);
  assert.equal(getRacePhysiologyProfile('怪兽类').bodySize, BODY_SIZE_INDIVIDUAL);
  assert.equal(getRacePhysiologyProfile('活体铠甲').bodySize, null);
});

test('混血按血统加权；可变与依个体不参与平均', () => {
  assert.deepEqual(getMergedRaceBodySize('人类'), { bodySize: 4, bodySizeSd: 0.4, altFormBodySize: null });
  // 巨人(6, 0.7) × 半身人(2, 0.3)：σ² = ½(0.49 + 4) + ½(0.09 + 4) = 4.29
  assert.deepEqual(getMergedRaceBodySize('巨人x半身人'), { bodySize: 4, bodySizeSd: 2.07, altFormBodySize: null });
  assert.deepEqual(getMergedRaceBodySize('史萊姆x人类'), { bodySize: 4, bodySizeSd: 0.4, altFormBodySize: null });
  assert.deepEqual(getMergedRaceBodySize('怪兽类x人类'), { bodySize: 4, bodySizeSd: 0.4, altFormBodySize: null });
  assert.deepEqual(getMergedRaceBodySize('史萊姆x影魔'), { bodySize: null, bodySizeSd: null, altFormBodySize: null });
  assert.deepEqual(getMergedRaceBodySize('怪兽类x史萊姆'), { bodySize: BODY_SIZE_INDIVIDUAL, bodySizeSd: null, altFormBodySize: null });
});

test('混血变化态：没有变化态的成分以常态参与加权', () => {
  assert.deepEqual(getMergedRaceBodySize('东方龙x人类'), { bodySize: 4, bodySizeSd: 0.45, altFormBodySize: 5.5 });
  assert.equal(getMergedRaceBodySize('东方龙x人类', { 东方龙: 0.75, 人类: 0.25 }).altFormBodySize, 6.3);
});

test('混血生理档带上体型栏位，其他栏位不受影响', () => {
  const merged = getMergedRacePhysiologyProfile('巨人x半身人');
  assert.equal(merged.bodySize, 4);
  assert.equal(merged.bodySizeSd, 2.07);
  assert.equal(merged.genderRatio, getMergedRacePhysiologyProfile('巨人x半身人').genderRatio);
});

test('百科覆写的体型：整数夹在 1–7，接受可变与依个体，丢掉无效值', () => {
  assert.deepEqual(sanitizeRacePhysiologyProfilePatch({ bodySize: 9, bodySizeSd: 5, altFormBodySize: 0 }), { bodySize: 7, bodySizeSd: 3, altFormBodySize: 1 });
  assert.deepEqual(sanitizeRacePhysiologyProfilePatch({ bodySize: 4.6, bodySizeSd: 0.333 }), { bodySize: 5, bodySizeSd: 0.33 });
  assert.deepEqual(sanitizeRacePhysiologyProfilePatch({ bodySize: null, altFormBodySize: null }), { bodySize: null, altFormBodySize: null });
  assert.deepEqual(sanitizeRacePhysiologyProfilePatch({ bodySize: BODY_SIZE_INDIVIDUAL }), { bodySize: BODY_SIZE_INDIVIDUAL });
  assert.equal(sanitizeRacePhysiologyProfilePatch({ bodySize: 'abc', altFormBodySize: '' }), null);
});

test('覆写生效：可从数值改成可变，也能改回', () => {
  try {
    setRacePhysiologyOverrides({ 人类: { bodySize: null }, 史萊姆: { bodySize: 3, bodySizeSd: 0.2 } });
    assert.equal(getRacePhysiologyProfile('人类').bodySize, null);
    assert.deepEqual(pickBodySize(getRacePhysiologyProfile('史萊姆')), { bodySize: 3, bodySizeSd: 0.2, altFormBodySize: null });
    assert.deepEqual(getMergedRaceBodySize('史萊姆x人类'), { bodySize: 3, bodySizeSd: 0.2, altFormBodySize: null });
  } finally {
    setRacePhysiologyOverrides({});
  }
});

test('物种生理块含体型行；变化态标出常态，可变与依个体各有说法', () => {
  const lastLine = (race) => buildSingleRacePhysiologyText(race).split('\n').find((line) => line.startsWith('- 体型'));
  assert.equal(lastLine('人类'), '- 体型: 4 级（人类，约 150–190 cm）；族内个体差异约 ±0.4 级。1–7 级，人类为 4。');
  assert.match(lastLine('东方龙'), /^- 体型: 常态 4 级（人类，约 150–190 cm）；族内个体差异约 ±0\.5 级；变化态 7 级（巨兽，6 m 以上）。/);
  assert.match(lastLine('史萊姆'), /可变，能随对象调整形体，与任何对象都恰好契合/);
  assert.match(lastLine('怪兽类'), /依个体而定/);
});

function pickBodySize({ bodySize, bodySizeSd, altFormBodySize }) {
  return { bodySize, bodySizeSd, altFormBodySize };
}

test('体态：四种分类、蝎罗氏为半人形、混血按血统且任意不投票，覆写可改', async () => {
  const { RACE_BODY_PLANS, getMergedRaceBodyPlan } = await import('../scripts/race_config.js');
  const counts = {};
  for (const race of ALL_BUILTIN_RACES) {
    const plan = getRacePhysiologyProfile(race).bodyPlan;
    assert.ok(RACE_BODY_PLANS.includes(plan), `${race} bodyPlan ${plan}`);
    counts[plan] = (counts[plan] || 0) + 1;
  }
  assert.deepEqual(counts, { humanoid: 61, beast: 3, hybrid: 5, any: 12 });
  assert.equal(getRacePhysiologyProfile('蝎罗氏').bodyPlan, 'hybrid');
  assert.equal(getRacePhysiologyProfile('修格斯').bodyPlan, 'any');
  assert.equal(getMergedRaceBodyPlan('史萊姆x人类'), 'humanoid', '任意不参与投票');
  assert.equal(getMergedRaceBodyPlan('修格斯x史萊姆'), 'any');
  assert.equal(getMergedRaceBodyPlan('半人马x人类', { 半人马: 0.75, 人类: 0.25 }), 'hybrid');
  assert.equal(getMergedRaceBodyPlan('半人马x人类'), 'humanoid', '平手取较接近人类的');
  assert.equal(sanitizeRacePhysiologyProfilePatch({ bodyPlan: 'x' }), null);
  try {
    setRacePhysiologyOverrides({ 眼魔: { bodyPlan: 'humanoid' } });
    assert.equal(getRacePhysiologyProfile('眼魔').bodyPlan, 'humanoid');
  } finally {
    setRacePhysiologyOverrides({});
  }
  assert.match(buildSingleRacePhysiologyText('半人马'), /- 体态: 半人形：人类上身接动物下半身，只有胸围适用，子宫与孕肚在下半身/);
});

test('变形种族的人态不全是 4：西方龙、空鲸、海德拉高大，麒麟、独角兽娇小，真身不变', () => {
  const pairs = Object.fromEntries(['西方龙', '空鲸', '海德拉', '麒麟', '独角兽'].map((race) => {
    const { bodySize, altFormBodySize } = getRacePhysiologyProfile(race);
    return [race, [bodySize, altFormBodySize]];
  }));
  assert.deepEqual(pairs, { 西方龙: [5, 7], 空鲸: [5, 7], 海德拉: [5, 7], 麒麟: [3, 5], 独角兽: [3, 5] });
});
