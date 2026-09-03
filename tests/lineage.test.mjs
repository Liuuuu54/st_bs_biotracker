// 血缘关系图：纯读取 chatState，验证六种场景的节点与边。
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildLineageGraph } from '../scripts/lineage.js';

function character(name, children = [], base = {}) {
  return { name, initialized: true, profile: { base: { race: '人类', ...base }, children } };
}

/** 取出指向某节点的所有边，方便断言 */
function parentsOf(graph, childNodeId) {
  return graph.edges
    .filter((edge) => edge.to === childNodeId)
    .map((edge) => `${edge.type}:${edge.from}`)
    .sort();
}

function childNode(graph, name) {
  return graph.nodes.find((node) => node.kind === 'child' && node.name === name);
}

test('一般生育：父母各一条边，未注册的父亲成为叶节点', () => {
  const graph = buildLineageGraph({
    characters: { 艾拉: character('艾拉', [{ id: 'c1', name: '小龙', fathers: '凯' }]) },
  });
  const child = childNode(graph, '小龙');
  assert.ok(child, '孩子应有节点');
  assert.deepEqual(parentsOf(graph, child.id), ['father:name:凯', 'mother:char:艾拉']);
  // 凯没注册，当叶节点
  assert.equal(graph.nodes.find((node) => node.id === 'name:凯').kind, 'unregistered');
});

test('百合：父方指向已注册角色 B，B 不会被当成路人', () => {
  const graph = buildLineageGraph({
    characters: {
      A: character('A', [{ id: 'c1', name: '孩子', fathers: 'B' }]),
      B: character('B'),
    },
  });
  const child = childNode(graph, '孩子');
  assert.deepEqual(parentsOf(graph, child.id), ['father:char:B', 'mother:char:A']);
  assert.equal(graph.nodes.find((node) => node.id === 'char:B').kind, 'character');
});

test('自交：同一节点连出母与父两条边', () => {
  const graph = buildLineageGraph({
    characters: { 苔妮: character('苔妮', [{ id: 'c1', name: '孢子', fathers: '苔妮' }], { race: '真菌亚人' }) },
  });
  const child = childNode(graph, '孢子');
  assert.deepEqual(parentsOf(graph, child.id), ['father:char:苔妮', 'mother:char:苔妮']);
});

test('代孕：遗传母与承载者用不同边型区分', () => {
  const graph = buildLineageGraph({
    characters: {
      承载者: character('承载者', [{ id: 'c1', name: '寄养儿', fathers: '凯', provider: '遗传母', providerSources: ['遗传母'] }]),
      遗传母: character('遗传母'),
    },
  });
  const child = childNode(graph, '寄养儿');
  assert.deepEqual(parentsOf(graph, child.id), ['carrier:char:承载者', 'father:name:凯', 'mother:char:遗传母']);
});

test('嵌合体：只连首位父母，其余来源保留在节点上', () => {
  const graph = buildLineageGraph({
    characters: {
      艾拉: character('艾拉', [{
        id: 'c1', name: '融合儿', fathers: '凯×莱恩',
        chimera: { fatherSources: ['凯', '莱恩'], maternalSources: ['艾拉'] },
      }]),
    },
  });
  const child = childNode(graph, '融合儿');
  // 只有首位父亲连线
  assert.deepEqual(parentsOf(graph, child.id), ['father:name:凯', 'mother:char:艾拉']);
  assert.deepEqual(child.extraSources, ['莱恩'], '第二位父源保留但不连线');
  assert.equal(graph.nodes.some((node) => node.name === '莱恩'), false, '未连线的来源不该产生节点');
});

test('胎内回归：A 是父方，孩子注册成 A+ 并能继续往下长', () => {
  const graph = buildLineageGraph({
    characters: {
      A: character('A'),
      B: character('B', [{ id: 'c1', name: '重生儿', fathers: 'A', registeredAs: 'A+' }]),
      'A+': character('A+', [{ id: 'c2', name: '第三代', fathers: '路人' }]),
    },
  });
  // 孩子节点与 A+ 合并成同一个体
  assert.equal(childNode(graph, '重生儿'), undefined, '注册后的孩子不该另开节点');
  assert.deepEqual(parentsOf(graph, 'char:A+'), ['father:char:A', 'mother:char:B']);
  // A+ 自己的后代照常挂上去
  const grandChild = childNode(graph, '第三代');
  assert.deepEqual(parentsOf(graph, grandChild.id), ['father:name:路人', 'mother:char:A+']);
});

test('孤立角色也会出现在图上', () => {
  const graph = buildLineageGraph({ characters: { 独身: character('独身') } });
  assert.equal(graph.nodes.length, 1);
  assert.equal(graph.edges.length, 0);
});

test('空状态不会炸', () => {
  assert.deepEqual(buildLineageGraph(null), { nodes: [], edges: [] });
  assert.deepEqual(buildLineageGraph({}), { nodes: [], edges: [] });
});

test('未注册的父亲带上血统，且只在单一父源时才标', () => {
  const graph = buildLineageGraph({
    characters: {
      艾拉: character('艾拉', [
        { id: 'c1', name: '独子', fathers: '凯', fatherRace: '龙族', fatherDerivedType: '血族' },
        {
          id: 'c2', name: '融合儿', fathers: '甲×乙',
          fatherRace: '龙族x人类',
          chimera: { fatherSources: ['甲', '乙'] },
        },
      ]),
    },
  });
  const kai = graph.nodes.find((node) => node.name === '凯');
  assert.equal(kai.race, '龙族', '单一父源应带上血统');
  assert.equal(kai.derivedType, '血族');
  // 嵌合体的 fatherRace 是合并字串，对不回单一个人，宁可留空
  const jia = graph.nodes.find((node) => node.name === '甲');
  assert.equal(jia.race, undefined, '多父源时不该给首位父亲标上合并血统');
});

test('注册后的孩子节点不写指向自己的 registeredAs', () => {
  const graph = buildLineageGraph({
    characters: {
      B: character('B', [{ id: 'c1', name: '重生儿', fathers: 'A', registeredAs: 'A+' }]),
      'A+': character('A+'),
      A: character('A'),
    },
  });
  const node = graph.nodes.find((item) => item.id === 'char:A+');
  assert.equal(node.registeredAs, undefined, 'registeredAs 会指向自己，是冗余');
  assert.equal(node.childId, 'c1', '来自哪笔孩子记录仍要保留');
});
