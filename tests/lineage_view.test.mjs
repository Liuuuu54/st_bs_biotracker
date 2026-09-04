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

test('同一代里亲代相同的手足聚成一丛，亲代不同的分开', () => {
  const view = buildLineageView({
    characters: {
      我: ch('我', [
        { id: 'a1', name: '长子', fathers: '甲' },
        { id: 'a2', name: '次子', fathers: '甲' },
        { id: 'b1', name: '三子', fathers: '乙' },
      ]),
    },
  }, '我');
  const row = view.generations.find((item) => item.generation === 1);
  assert.deepEqual(
    row.clusters.map((cluster) => cluster.nodes.map((node) => node.displayName)),
    [['长子', '次子'], ['三子']],
  );
  assert.deepEqual(row.clusters[0].parents.map((p) => `${p.relation} ${p.name}`), ['母 我', '父 甲']);
});

test('没有亲代的人各自成丛，不会被并成一家', () => {
  const view = buildLineageView(sample(), '我');
  const top = view.generations[0];
  assert.ok(top.clusters.every((cluster) => cluster.nodes.length === 1));
  assert.ok(top.clusters.every((cluster) => cluster.parents.length === 0));
});

test('代孕的承载者不算遗传亲代，另外列出', () => {
  const view = buildLineageView({
    characters: {
      琪拉: ch('琪拉'),
      贝拉: ch('贝拉', [{ id: 's1', name: '寄养儿', provider: '琪拉', fathers: '凯' }]),
      凯: ch('凯'),
    },
  }, '贝拉');
  const child = view.nodes.find((node) => node.displayName === '寄养儿');
  assert.deepEqual(child.geneticParents.map((p) => `${p.relation} ${p.name}`), ['母 琪拉', '父 凯']);
  assert.deepEqual(child.carriers.map((p) => p.name), ['贝拉']);
  // 亲代标注只挂遗传亲代，承载者不进族谱上的膠囊
  const row = view.generations.find((item) => item.generation === 1);
  assert.deepEqual(row.clusters[0].parents.map((p) => p.name), ['琪拉', '凯']);
  const carrier = view.nodes.find((node) => node.isCenter);
  assert.deepEqual(carrier.carriedChildren.map((p) => p.name), ['寄养儿']);
});

test('节点带上整数岁的年龄标签，未注册的路人留空', () => {
  const view = buildLineageView({
    characters: {
      艾拉: {
        name: '艾拉', initialized: true,
        profile: {
          base: { race: '人类', age: 24.7 },
          children: [{ id: 'k1', name: '幼子', fathers: '路人甲', age: 0.4 }],
        },
      },
    },
  }, '艾拉');
  const center = view.nodes.find((node) => node.isCenter);
  assert.equal(center.ageLabel, '25岁', '与追踪页概览同样取整');
  const baby = view.nodes.find((node) => node.displayName === '幼子');
  assert.equal(baby.ageLabel, '0岁');
  const stranger = view.nodes.find((node) => node.displayName === '路人甲');
  assert.equal(stranger.ageLabel, '', '未注册的路人没有年龄资料');
});
