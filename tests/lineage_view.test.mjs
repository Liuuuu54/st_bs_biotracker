import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLineageView, relatedNodeIds } from '../scripts/lineage_view.js';

const ch = (name, children = [], base = {}) => ({
  name, initialized: true, profile: { base: { race: '人类', ...base }, children },
});

function sample() {
  return {
    characters: {
      祖母: ch('祖母', [{ id: 'k1', name: '母', fathers: '祖父', registeredAs: '母' }]),
      母: ch('母', [{ id: 'k2', name: '我', fathers: '父', registeredAs: '我' }], { race: '精灵' }),
      我: ch('我', [{ id: 'k3', name: '长子', gender: '男', race: '精灵x人类', fathers: '配偶' }]),
      父: ch('父'),
      配偶: ch('配偶', [], { race: '龙族' }),
    },
  };
}

test('视图按世代分列并标出中心', () => {
  const view = buildLineageView(sample(), '我');
  assert.equal(view.empty, false);
  assert.deepEqual(view.generations.map((row) => row.label), ['祖辈', '父母辈', '本人', '子女']);
  const center = view.nodes.find((node) => node.isCenter);
  assert.equal(center.displayName, '我');
});

test('节点带上关系摘要与种族显示字串', () => {
  const view = buildLineageView(sample(), '我');
  const son = view.nodes.find((node) => node.displayName === '长子');
  assert.deepEqual(son.parents.map((p) => `${p.relation}=${p.name}`).sort(), ['母=我', '父=配偶']);
  const mother = view.nodes.find((node) => node.displayName === '母');
  assert.equal(mother.raceLabel, '精灵');
});

test('未注册的路人不可展开详情', () => {
  const view = buildLineageView(sample(), '我');
  const stranger = view.nodes.find((node) => node.displayName === '祖父');
  assert.equal(stranger.kind, 'unregistered');
  assert.equal(stranger.hasDetail, false);
});

test('relatedNodeIds 回传该节点的亲代与子代', () => {
  const view = buildLineageView(sample(), '我');
  const center = view.nodes.find((node) => node.isCenter);
  const related = relatedNodeIds(view, center.id);
  const names = related.map((id) => view.nodes.find((node) => node.id === id)?.displayName).sort();
  assert.deepEqual(names, ['长子', '母', '父'].sort());
});

test('中心角色不存在时回传空视图', () => {
  const view = buildLineageView({ characters: {} }, '不存在');
  assert.equal(view.empty, true);
  assert.deepEqual(view.generations, []);
});

test('自交与代孕的重复关系会合并，不会同一人列两次', () => {
  const view = buildLineageView({
    characters: {
      艾拉: ch('艾拉', [
        // 自交：同一人既是母也是父，两条边
        { id: 'c1', name: '孤生子', fathers: '艾拉' },
        // 代孕：艾拉是承载者，遗传母是琪拉
        { id: 'c2', name: '寄养儿', fathers: '凯', provider: '琪拉', providerSources: ['琪拉'] },
      ]),
      琪拉: ch('琪拉'),
    },
  }, '艾拉');

  const center = view.nodes.find((node) => node.isCenter);
  const soloEntries = center.children.filter((item) => item.name === '孤生子');
  assert.equal(soloEntries.length, 1, '自交的孩子不该在子代清单里出现两次');
  assert.equal(soloEntries[0].relation, '母·父', '两种关系应合并成一个标签');

  const solo = view.nodes.find((node) => node.displayName === '孤生子');
  assert.equal(solo.parents.length, 1);
  assert.equal(solo.parents[0].relation, '母·父');

  // 代孕仍要能分辨承载与遗传母
  const foster = view.nodes.find((node) => node.displayName === '寄养儿');
  assert.deepEqual(
    foster.parents.map((item) => `${item.relation}:${item.name}`).sort(),
    ['母:琪拉', '承载:艾拉', '父:凯'].sort(),
  );
});
