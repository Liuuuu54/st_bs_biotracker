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
