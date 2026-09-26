// 子宫像素图的版面计算：只读状态、结果稳定，隐藏胎与待着床胚胎不出现。
import assert from 'node:assert/strict';
import test from 'node:test';

import { computeUterusLayout, MAX_DRAWN_FETUSES, quantizeAngle, wombRadius } from '../scripts/uterus_layout.js';

const fetus = (embryoId, over = {}) => ({
  embryoId, fusionCheckedWith: [], tags: [], fathers: `父${embryoId}`, race: '人类', fatherRace: '人类',
  gender: '女', embryoType: '胎生', weight: 1, tendencyAngle: 0, affinity: 0, amnionDurability: 100, descentStage: -2, ...over,
});

function profile(stage, fetuses = [], { days = 140, base = {}, pregnant = {} } = {}) {
  return {
    base: { stage, days: 0, race: '人类', libido: 0, uterinePressure: 0, sperms: [], ...base },
    pregnant: { pregnantDays: days, effectivePregnantDays: days, fetuses, presentingEmbryoId: null, ...pregnant },
    immune: {},
  };
}

test('没怀孕时仍有子宫，没有任何胎儿与胎囊', () => {
  const layout = computeUterusLayout(profile('卵泡期', [], { days: 0 }), { stageProgress: 0.5 });
  assert.equal(layout.fetuses.length, 0);
  assert.equal(layout.sacs.length, 0);
  assert.equal(layout.emptyStage, '卵泡期');
  assert.ok(layout.womb.rx > 0 && layout.womb.ry > 0);
  assert.match(layout.summary, /没有胎儿/);
});

test('子宫随孕程长大，未孕最小', () => {
  const empty = computeUterusLayout(profile('卵泡期', [], { days: 0 }));
  const mid = computeUterusLayout(profile('孕中期', [fetus(1)], { days: 140 }));
  const late = computeUterusLayout(profile('孕晚期', [fetus(1)], { days: 260 }));
  assert.ok(empty.womb.rx < mid.womb.rx && mid.womb.rx < late.womb.rx);
  assert.ok(late.womb.bottom <= 120 && late.tract.canalBottom <= 120 + 8);
});

test('未揭晓的异期胎与待着床胚胎不出现在版面里', () => {
  const layout = computeUterusLayout(profile('孕中期', [
    fetus(1),
    fetus(2, { conceivedAtDays: 100, tags: ['superfetation'] }),
    fetus(3, { pendingImplantation: true }),
  ]));
  assert.deepEqual(layout.fetuses.map((item) => item.embryoId), [1]);
  assert.match(layout.summary, /1 胎/);
});

test('月经周期里还没着床的受精卵不画', () => {
  const layout = computeUterusLayout(profile('黄体期', [fetus(1)], { days: 0 }));
  assert.equal(layout.fetuses.length, 0);
  assert.equal(layout.emptyStage, '黄体期');
});

test('超过 5 胎只画 5 个，其余以 hiddenCount 回传；先露胎一定在内', () => {
  const fetuses = Array.from({ length: 7 }, (_, i) => fetus(i + 1));
  const layout = computeUterusLayout(profile('第一产程', fetuses, {
    days: 280, pregnant: { presentingEmbryoId: 7, laborPhase: '潜伏期' },
  }));
  assert.equal(layout.fetuses.length, MAX_DRAWN_FETUSES);
  assert.equal(layout.hiddenCount, 2);
  assert.ok(layout.fetuses.some((item) => item.embryoId === 7 && item.presenting));
  const ids = layout.fetuses.map((item) => item.embryoId);
  assert.deepEqual([...ids].sort((a, b) => a - b), ids, '维持原本的左右顺序');
});

test('同一胎囊合成一个膜，范围涵盖全部成员', () => {
  const twin = { identicalGroup: 1, tags: ['identical'] };
  const layout = computeUterusLayout(profile('孕晚期', [fetus(1, twin), fetus(2, twin), fetus(3)], { days: 220 }));
  assert.equal(layout.sacs.length, 2);
  const shared = layout.sacs.find((sac) => sac.embryoIds.length === 2);
  for (const id of [1, 2]) {
    const item = layout.fetuses.find((f) => f.embryoId === id);
    assert.ok(Math.abs(item.x - shared.cx) <= shared.rx && Math.abs(item.y - shared.cy) <= shared.ry, `胎儿 ${id} 在膜内`);
  }
});

test('孕早期还不画胎囊；破水的胎囊耐久带出来', () => {
  assert.equal(computeUterusLayout(profile('孕早期', [fetus(1)], { days: 40 })).sacs.length, 0);
  const broken = computeUterusLayout(profile('第一产程', [fetus(1, { amnionDurability: 0 })], { days: 280 }));
  assert.equal(broken.sacs[0].durability, 0);
});

test('同一状态重算结果完全相同', () => {
  const state = profile('孕晚期', [fetus(1, { descentStage: -3 }), fetus(2), fetus(3, { descentStage: -1 })], { days: 230 });
  assert.deepEqual(computeUterusLayout(state), computeUterusLayout(state));
});

test('产道内的胎儿在中轴上，位置低于子宫底部', () => {
  const layout = computeUterusLayout(profile('第二产程', [fetus(1, { descentStage: 2 }), fetus(2, { descentStage: -1 })], {
    days: 280, pregnant: { presentingEmbryoId: 1, laborPhase: '胎体下降' },
  }));
  const canal = layout.fetuses.find((item) => item.embryoId === 1);
  assert.equal(canal.x, layout.womb.cx);
  assert.ok(canal.y > layout.womb.bottom - 6);
});

test('胎儿留在子宫壁内侧', () => {
  const fetuses = Array.from({ length: 5 }, (_, i) => fetus(i + 1, { descentStage: [-3, -2, -1, -2, -3][i] }));
  const layout = computeUterusLayout(profile('孕晚期', fetuses, { days: 250 }));
  for (const item of layout.fetuses) {
    const edge = wombRadius(layout.womb, item.y);
    assert.ok(Math.abs(item.x - layout.womb.cx) <= edge, `胎儿 ${item.embryoId} 越出子宫壁`);
  }
});

test('各胚型与自身孕龄选到对应的图块；异期胎按自己的孕龄', () => {
  const layout = computeUterusLayout(profile('孕晚期', [
    fetus(1, { embryoType: '卵生' }),
    fetus(2, { embryoType: '不定型', conceivedAtDays: 150, revealed: true, tags: ['superfetation'] }),
  ], { days: 230 }));
  const [egg, amorphous] = layout.fetuses;
  assert.deepEqual([egg.sprite.type, egg.sprite.stage], ['卵生', 2]);
  assert.deepEqual([amorphous.sprite.type, amorphous.sprite.stage], ['不定型', 0]);
  assert.ok(amorphous.size < egg.size, '晚到的异期胎较小');
});

test('孕中孕的内胎挂在宿主身上，不占格位', () => {
  const layout = computeUterusLayout(profile('孕晚期', [
    fetus(1),
    fetus(2, { nestedInEmbryoId: 1, conceivedAtDays: 100, revealed: true, tags: ['superfetation', 'nested'] }),
  ], { days: 230 }));
  assert.equal(layout.fetuses.length, 1);
  assert.deepEqual(layout.fetuses[0].inner.map((inner) => inner.embryoId), [2]);
});

test('胎位角量化成 8 个方向', () => {
  assert.deepEqual([0, 20, 23, 170, 359, -30, 720].map(quantizeAngle), [0, 0, 45, 180, 0, 315, 0]);
});

test('宫压、性欲、精液依上限换算', () => {
  const calm = computeUterusLayout(profile('卵泡期', [], { days: 0, base: { uterinePressure: 0, libido: 0 } }), { pressureCap: 50, libidoCap: 100 });
  const hot = computeUterusLayout(profile('卵泡期', [], { days: 0, base: { uterinePressure: 50, libido: 100, sperms: [{ male: 'M', value: 60 }] } }), { pressureCap: 50, libidoCap: 100 });
  assert.equal(calm.pressureLevel, 0);
  assert.equal(hot.pressureLevel, 3);
  assert.equal(calm.libidoHeat, 0);
  assert.equal(hot.libidoHeat, 1);
  assert.equal(calm.fluidHeight, 0);
  assert.ok(hot.fluidHeight > 0);
  const pregnantFluid = computeUterusLayout(profile('孕晚期', [fetus(1)], { days: 260, base: { sperms: [{ male: 'M', value: 60 }] } }));
  assert.ok(pregnantFluid.fluidHeight < hot.fluidHeight, '同样的量在大子宫里摊得比较薄');
});

test('阻塞的胎儿带出阻塞类型；非真实模式没有阻塞', () => {
  const stuck = (realisticLabor) => ({
    ...profile('第二产程', [fetus(1, { descentStage: 3, shoulderDystocia: true }), fetus(2)], {
      days: 280, pregnant: { presentingEmbryoId: 1, laborPhase: '胎体娩出' },
    }),
    immune: { realisticLabor },
  });
  const layout = computeUterusLayout(stuck(true));
  assert.equal(layout.obstruction.type, 'shoulder_dystocia');
  assert.deepEqual(layout.obstruction.embryoIds, [1]);
  assert.match(layout.obstruction.message, /肩/);
  assert.equal(layout.fetuses.find((item) => item.embryoId === 1).obstruction, 'shoulder_dystocia');
  assert.equal(layout.fetuses.find((item) => item.embryoId === 2).obstruction, null);
  assert.equal(computeUterusLayout(stuck(false)).obstruction, null);
});

test('胎背朝右的图块镜像；胎背朝后的脸朝外', () => {
  const layout = computeUterusLayout(profile('孕晚期', [
    fetus(1, { backSide: '左前' }), fetus(2, { backSide: '右前' }), fetus(3, { backSide: '左后' }), fetus(4, { backSide: '右后' }),
  ], { days: 230 }));
  assert.deepEqual(layout.fetuses.map((item) => [item.sprite.mirror, item.sprite.posterior]), [[false, false], [true, false], [false, true], [true, true]]);
});
