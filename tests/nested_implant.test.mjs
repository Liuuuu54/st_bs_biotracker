// bsImplantEmbryo 的 hostFetusIndex：把胚胎直接植入腹中某一胎体内，成为那一胎的孕中孕（炉蚜的外壳孕育）
import assert from 'node:assert/strict';
import test from 'node:test';

import * as state from '../scripts/state.js';
import { applyToolCall } from '../scripts/tools.js';

function carrier(name, race, fetuses) {
  return {
    name,
    initialized: true,
    profile: {
      base: { stage: '孕早期', days: 0, race, vitality: 100, sperms: [] },
      pregnant: {
        pregnantDays: 40,
        effectivePregnantDays: 40,
        fetusesCount: fetuses.length,
        fetuses,
        fetalEnergyDrain: 1,
        amnionDurability: 100,
        nextEmbryoId: fetuses.length + 1,
      },
      bio: { birthDifficulty: 1, breedTolerance: 0.5, impregnationDifficulty: 0.5 },
      immune: {},
      metabolism: {},
      children: [],
      notify: {},
    },
  };
}

const surrogateFetus = (overrides = {}) => ({
  embryoId: 1, fathers: '莱昂', provider: '委托母亲', providerSources: ['委托母亲'], race: '人类', gender: '女',
  embryoType: '胎生', weight: 1, tendencyAngle: 0, affinity: 0, tags: ['surrogacy'], ...overrides,
});

const implant = (chatState, args) => applyToolCall(chatState, { name: 'bsImplantEmbryo', arguments: { female: '蜜蜜', ...args } });

test('炉蚜把自己的胚胎嵌进代孕胎儿：成为那一胎的孕中孕，不受自然孕中孕的门槛限制，孩子留在她名下', () => {
  const chatState = state.createEmptyChatState();
  chatState.characters['蜜蜜'] = carrier('蜜蜜', '炉蚜', [surrogateFetus()]);

  const result = implant(chatState, { provider: '蜜蜜', fathers: '莱昂', race: '炉蚜', fatherRace: '人类', hostFetusIndex: 0 });
  assert.equal(result.applied, true, result.message);
  const [host, inner] = chatState.characters['蜜蜜'].profile.pregnant.fetuses;
  assert.equal(inner.nestedInEmbryoId, host.embryoId, '母亲是宿主胎儿');
  assert.ok(inner.tags.includes('nested'));
  assert.equal(inner.provider, null, '承载者自己的胚胎没有要转交的归属方');
  assert.equal(inner.race, '炉蚜', '雌核：随遗传母方种族');
  assert.equal(inner.pendingImplantation, true, '照常等共同着床窗口');
  assert.equal(host.weight, 1, '宿主胎重 1.0 也行，自然孕中孕要 1.5');
});

test('hostFetusIndex 的限制：只在孕早期的异期窗口、宿主要进得去、序号要有效；不给就是一般代孕', () => {
  const egg = state.createEmptyChatState();
  egg.characters['蜜蜜'] = carrier('蜜蜜', '炉蚜', [surrogateFetus({ embryoType: '卵胎生' })]);
  assert.match(implant(egg, { provider: '蜜蜜', race: '炉蚜', hostFetusIndex: 0 }).message, /不能当孕中孕宿主/);

  const wrong = state.createEmptyChatState();
  wrong.characters['蜜蜜'] = carrier('蜜蜜', '炉蚜', [surrogateFetus()]);
  assert.match(implant(wrong, { provider: '蜜蜜', race: '炉蚜', hostFetusIndex: 3 }).message, /invalid hostFetusIndex/);

  const late = state.createEmptyChatState();
  late.characters['蜜蜜'] = carrier('蜜蜜', '炉蚜', [surrogateFetus()]);
  late.characters['蜜蜜'].profile.base.stage = '孕中期';
  assert.equal(implant(late, { provider: '蜜蜜', race: '炉蚜', hostFetusIndex: 0 }).applied, false);

  const notPregnant = state.createEmptyChatState();
  notPregnant.characters['蜜蜜'] = carrier('蜜蜜', '炉蚜', []);
  notPregnant.characters['蜜蜜'].profile.base.stage = '卵泡期';
  assert.match(implant(notPregnant, { provider: '蜜蜜', race: '炉蚜', hostFetusIndex: 0 }).message, /needs an existing early pregnancy/);
  assert.match(implant(notPregnant, { provider: '蜜蜜', race: '炉蚜' }).message, /provider must differ/, '不植入胎儿时照旧不能自己代孕自己');

  const plain = state.createEmptyChatState();
  plain.characters['蜜蜜'] = carrier('蜜蜜', '炉蚜', [surrogateFetus()]);
  assert.equal(implant(plain, { provider: '委托母亲', race: '人类' }).applied, true);
  const added = plain.characters['蜜蜜'].profile.pregnant.fetuses[1];
  assert.equal(added.nestedInEmbryoId ?? null, null, '没给 hostFetusIndex 就不是孕中孕');
  assert.equal(added.provider, '委托母亲');
});
