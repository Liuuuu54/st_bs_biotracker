// 种族混血回归测试（PR#2 扶她/混血归属）：性别比优先级、未知成分标记、同基去重。
import assert from 'node:assert/strict';
import test from 'node:test';

import { getMergedRacePhysiologyProfile } from '../scripts/race_config.js';

test('扶她x人类 混血保持双性（genderRatio null 优先）', () => {
  const merged = getMergedRacePhysiologyProfile('扶她x人类');
  assert.equal(merged.genderRatio, null);
});

test('未知混血成分被标记而非静默丢弃', () => {
  const merged = getMergedRacePhysiologyProfile('人类x不存在种族');
  assert.equal(merged.hasUnknownRace, true);
});

test('同基种族 subtype 混血不重复加权', () => {
  const merged = getMergedRacePhysiologyProfile('兽耳族-兔x人类x兽耳族-猫');
  assert.ok(Math.abs(merged.gestationSpeciesSpeed - 1.2307692307692308) < 0.0001);
});
