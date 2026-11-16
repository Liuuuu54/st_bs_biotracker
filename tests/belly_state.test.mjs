// 孕体特写：追踪器状态 → 特写状态的换算。
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildBellyCloseupState, getBellyCueAction, getBellyThrustReach, resolveBellyCuePair, getBellyHormoneStage, getBellyLaborPhase, isBellyNude } from '../scripts/belly_state.js';

const input = (over = {}) => ({
  drawable: true, sigma: 0.4, body: { build: 55, bust: 72, hip: 60 }, bellySize: 7, stage: '孕晚期', laborPhase: null, stageProgress: 0.5,
  effectiveDays: 270, births: 1,
  stats: { vitality: { value: 60, cap: 120 }, libido: { value: 30, cap: 100 }, stress: { value: 0, cap: 110 }, uterine: { value: 10, cap: 100 } },
  needs: { hunger: { value: 75, cap: 150 }, sleep: { value: 150, cap: 150 }, excretion: { value: 100, cap: 200 }, milk: { value: 30, cap: 150 }, odor: { value: 0, cap: 150 } },
  outfit: { enabled: true, main: { name: '连衣裙' }, wearState: '整齐' },
  fetuses: [{ embryoId: 'a', ownAge: 270, weight: 1.2, bulkRatio: 1, healthRatio: 0.8, canMove: true }, { embryoId: 'b', ownAge: 135, weight: 1, bulkRatio: 0.5, healthRatio: 0.2, canMove: false }],
  womb: { womb: { cx: 48, top: 20, bottom: 80, rx: 20 }, fetuses: [{ embryoId: 'a', x: 40, y: 35 }, { embryoId: 'b', x: 58, y: 70 }] },
  ...over,
});

test('身体量直接沿用：体型、当下的胸臀体重、孕肚大小', () => {
  const state = buildBellyCloseupState(input());
  assert.equal(state.sigma, 0.4);
  assert.deepEqual([state.cup, state.build, state.hip, state.pressure], [72, 55, 60, 7]);
  assert.equal(state.days, 270);
  assert.equal(state.births, 1);
  assert.equal(state.stageProgress, 50);
  // 超出范围的夹住
  const wild = buildBellyCloseupState(input({ sigma: 9, body: { build: 400, bust: 999, hip: -5 }, bellySize: 30 }));
  assert.deepEqual([wild.sigma, wild.cup, wild.build, wild.hip, wild.pressure], [3, 150, 100, 0, 15]);
});

test('状态值与需求换成占上限的百分比；免除乳意的不涨不漏', () => {
  const state = buildBellyCloseupState(input());
  assert.deepEqual([state.vitality, state.libido, state.stress, state.uterine], [50, 30, 0, 10]);
  assert.deepEqual([state.hunger, state.sleep, state.excretion, state.milk, state.odor], [50, 100, 50, 20, 0]);
  assert.equal(state.noMilk, false);
  const undead = buildBellyCloseupState(input({ needs: { ...input().needs, milk: null, sleep: null } }));
  assert.equal(undead.noMilk, true);
  assert.equal(undead.milk, 0);
  assert.equal(undead.sleep, 0);
});

test('穿着：衣柜没开或有穿主衣物照有穿画，没有主衣物或写明全裸才画全裸', () => {
  assert.equal(isBellyNude({ enabled: false }), false);
  assert.equal(isBellyNude(null), false);
  assert.equal(isBellyNude({ enabled: true, main: { name: '衬衫' }, wearState: '整齐' }), false);
  assert.equal(isBellyNude({ enabled: true, main: { name: '衬衫' }, wearState: '半脱' }), false);
  assert.equal(isBellyNude({ enabled: true, main: null, wearState: '整齐' }), true);
  assert.equal(isBellyNude({ enabled: true, main: { name: '衬衫' }, wearState: '全裸' }), true);
  const clothed = buildBellyCloseupState(input());
  assert.deepEqual([clothed.showBra, clothed.showShorts, clothed.strapless], [true, true, true]);
  const nude = buildBellyCloseupState(input({ outfit: { enabled: true, main: null } }));
  assert.deepEqual([nude.showBra, nude.showShorts, nude.strapless], [false, false, false]);
});

test('阶段：荷尔蒙阶段与产程的宫缩节奏', () => {
  assert.equal(getBellyHormoneStage('孕中期'), 'pregnant');
  assert.equal(getBellyHormoneStage('第二产程'), 'pregnant');
  assert.equal(getBellyHormoneStage('假孕期'), 'pseudo');
  assert.equal(getBellyHormoneStage('产后恢复'), 'postpartum');
  assert.equal(getBellyHormoneStage('卵泡期'), 'cycle');
  assert.equal(getBellyLaborPhase('孕晚期', null), 'none');
  assert.equal(getBellyLaborPhase('产兆前驱', null), 'prodromal');
  assert.equal(getBellyLaborPhase('第一产程', '活跃期'), 'active');
  assert.equal(getBellyLaborPhase('第一产程', null), 'latent');
  assert.equal(getBellyLaborPhase('第二产程', '胎体娩出'), 'delivery');
  assert.equal(getBellyLaborPhase('第二产程', '间歇期'), 'interval');
  assert.equal(getBellyLaborPhase('第三产程', null), 'placenta');
  const pushing = buildBellyCloseupState(input({ stage: '第二产程', laborPhase: '胎体下降', laborEffort: 'push', pushFatigue: 70 }));
  assert.deepEqual([pushing.laborPhase, pushing.laborEffort, pushing.pushFatigue], ['descent', 'push', 70]);
});

test('每一胎：份量、健康、能不能动，位置照子宫图里的高低', () => {
  const { fetuses, count } = buildBellyCloseupState(input());
  assert.equal(count, 2);
  assert.ok(Math.abs(fetuses[0].size - 270 / 280 * 1.2) < 1e-9);
  assert.ok(Math.abs(fetuses[1].size - 135 / 280 * 0.5) < 1e-9);
  assert.deepEqual([fetuses[0].health, fetuses[1].health], [80, 20]);
  assert.deepEqual([fetuses[0].canMove, fetuses[1].canMove], [true, false]);
  assert.ok(fetuses[0].zone.v < fetuses[1].zone.v, '在子宫里比较高的那一胎，在孕肚上也比较高');
  assert.ok(fetuses[0].zone.w < fetuses[1].zone.w);
  // 没有子宫图的位置时不给 zone，由动画依顺序分段
  assert.equal(buildBellyCloseupState(input({ womb: null })).fetuses[0].zone, undefined);
  assert.equal(buildBellyCloseupState(input({ fetuses: [] })).count, 1);
});

test('不能画的角色回传 null；画面事件对应到特写的动作', () => {
  assert.equal(buildBellyCloseupState(input({ drawable: false })), null);
  assert.equal(buildBellyCloseupState(null), null);
  assert.deepEqual(getBellyCueAction('falseContraction'), { trigger: 'falseContraction' });
  assert.deepEqual(getBellyCueAction('insert'), { trigger: 'thrust', options: { count: 3 } });
  assert.deepEqual(getBellyCueAction('ejaculate'), { trigger: 'thrust', options: { count: 1 } });
  // 顶不顶得到宫颈口：相称与剑大到明显不合为止顶得到，只进一半、进不去、鞘大都够不到
  assert.equal(getBellyThrustReach(null), true);
  assert.equal(getBellyThrustReach({ tier: 0, direction: 0 }), true);
  assert.equal(getBellyThrustReach({ tier: 2, direction: 1 }), true);
  assert.equal(getBellyThrustReach({ tier: 3, direction: 1 }), false);
  assert.equal(getBellyThrustReach({ tier: 1, direction: -1 }), false);
  assert.equal(getBellyCueAction('ovulation'), null);
});

test('孕前虚影：妊娠到产后恢复期间带孕前的身材，平常没有', () => {
  const baseline = { build: 50, bust: 60, hip: 55 };
  assert.deepEqual(buildBellyCloseupState(input({ baseline })).ghost, { cup: 60, build: 50, hip: 55 });
  assert.deepEqual(buildBellyCloseupState(input({ baseline, stage: '产后恢复' })).ghost, { cup: 60, build: 50, hip: 55 });
  assert.equal(buildBellyCloseupState(input({ baseline, stage: '卵泡期' })).ghost, undefined);
  assert.equal(buildBellyCloseupState(input()).ghost, undefined);
});

test('高潮与两胎互动的画面事件对应到特写的动作', () => {
  assert.deepEqual(getBellyCueAction('orgasm'), { trigger: 'orgasm' });
  assert.deepEqual(getBellyCueAction('siblingKick'), { trigger: 'sibling', options: { interaction: 'kick' }, pair: true });
  assert.equal(getBellyCueAction('siblingShove').options.interaction, 'shove');
  assert.equal(getBellyCueAction('siblingCuddle').options.interaction, 'cuddle');
  // 事件记了是哪两胎：换成特写里的顺位（动手的在前）；找不到、不会动或旧事件没记时回传 null
  const list = [{ embryoId: 7 }, { embryoId: 9 }, { embryoId: 4, canMove: false }];
  assert.deepEqual(resolveBellyCuePair({ fetuses: [9, 7] }, list), { actor: 1, target: 0 });
  assert.equal(resolveBellyCuePair({ fetuses: [9, 4] }, list), null);
  assert.equal(resolveBellyCuePair({ fetuses: [9, 5] }, list), null);
  assert.equal(resolveBellyCuePair({ type: 'siblingKick' }, list), null);
});

test('第 6 胎起排在前面 5 胎的背后；孕中孕的内胎记下宿主、自己没有位置', () => {
  const ids = [1, 2, 3, 4, 5, 6, 7, 8];
  const fetuses = ids.map((embryoId) => ({ embryoId, ownAge: 200, weight: 1, bulkRatio: 1, healthRatio: 0.5, canMove: true }));
  // 第 8 个是第 1 胎体内的内胎
  fetuses[7] = { ...fetuses[7], nestedInEmbryoId: 1 };
  const spots = [1, 2, 3, 4, 5].map((embryoId, k) => ({ embryoId, x: 30 + k * 9, y: 25 + k * 11 }));
  const build = () => buildBellyCloseupState(input({ fetuses, womb: { womb: { cx: 48, top: 20, bottom: 80, rx: 20 }, fetuses: spots } })).fetuses;
  const list = build();
  // 第 6、7 胎照第 1、2 胎（k mod 5）的高低，往背侧退
  for (const [back, ahead] of [[5, 0], [6, 1]]) {
    assert.equal(list[back].behind, true);
    assert.ok(Math.abs(list[back].zone.v - list[ahead].zone.v) <= 0.08 + 1e-9, `${back} ${JSON.stringify(list[back].zone)}`);
    assert.ok(list[back].zone.w >= list[ahead].zone.w + 0.25 - 1e-9);
  }
  assert.deepEqual(build()[5].zone, list[5].zone, '重绘不跳');
  assert.equal(list[7].host, 0);
  assert.equal(list[7].zone, undefined);
  assert.equal(list[0].behind, undefined);
  // 胎囊破了（已被宿主生出来）就是独立的胎
  fetuses[7] = { ...fetuses[7], nestedReleased: true };
  assert.equal(build()[7].host, undefined);
  assert.equal(build()[7].behind, true);
});
