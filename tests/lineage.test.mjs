// 血缘关系图：纯读取 chatState，验证六种场景的节点与边。
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildLineageGraph, focusLineage } from '../scripts/lineage.js';

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

test('以角色为中心裁切并标上世代', () => {
  const graph = buildLineageGraph({
    characters: {
      祖母: character('祖母', [{ id: 'k1', name: '母', fathers: '祖父', registeredAs: '母' }]),
      母: character('母', [{ id: 'k2', name: '我', fathers: '父', registeredAs: '我' }]),
      我: character('我', [{ id: 'k3', name: '子', fathers: '配偶' }]),
      父: character('父'),
      配偶: character('配偶'),
    },
  });
  const focused = focusLineage(graph, 'char:我', { up: 2, down: 2 });
  const byGeneration = (gen) => focused.nodes.filter((node) => node.generation === gen).map((node) => node.name).sort();
  assert.deepEqual(byGeneration(-2), ['祖父', '祖母'].sort());
  assert.deepEqual(byGeneration(-1), ['父', '母'].sort());
  // 配偶是「子」的共同亲代，会被补进同一世代（见下方的共同亲代测试）
  assert.deepEqual(byGeneration(0), ['我', '配偶'].sort());
  assert.deepEqual(byGeneration(1), ['子']);
  // 范围外的边不该留下
  assert.ok(focused.edges.every((edge) => focused.nodes.some((node) => node.id === edge.from)));
  assert.ok(focused.edges.every((edge) => focused.nodes.some((node) => node.id === edge.to)));
});

test('深度上限会截断更远的世代', () => {
  const graph = buildLineageGraph({
    characters: {
      祖母: character('祖母', [{ id: 'k1', name: '母', fathers: '祖父', registeredAs: '母' }]),
      母: character('母', [{ id: 'k2', name: '我', fathers: '父', registeredAs: '我' }]),
      我: character('我'),
      父: character('父'),
    },
  });
  const shallow = focusLineage(graph, 'char:我', { up: 1, down: 0 });
  assert.deepEqual(shallow.nodes.map((node) => node.name).sort(), ['我', '父', '母'].sort());
  assert.equal(shallow.nodes.some((node) => node.name === '祖母'), false, '第二代祖先应被截断');
});

test('自交时同一节点只占一个世代', () => {
  const graph = buildLineageGraph({
    characters: { 苔妮: character('苔妮', [{ id: 'c1', name: '孢子', fathers: '苔妮' }]) },
  });
  const focused = focusLineage(graph, 'child:c1', { up: 2, down: 2 });
  const mother = focused.nodes.filter((node) => node.name === '苔妮');
  assert.equal(mother.length, 1, '同一个人不该重复出现');
  assert.equal(mother[0].generation, -1);
});

test('中心节点不存在时回传空图', () => {
  const graph = buildLineageGraph({ characters: { A: character('A') } });
  assert.deepEqual(focusLineage(graph, 'char:不存在'), { nodes: [], edges: [], centerId: 'char:不存在' });
});

test('往下裁切时补上共同亲代，孩子不会只剩一位亲代', () => {
  const graph = buildLineageGraph({
    characters: {
      我: character('我', [{ id: 'k1', name: '长子', fathers: '配偶' }]),
      配偶: character('配偶'),
    },
  });
  const focused = focusLineage(graph, 'char:我', { up: 0, down: 1 });
  const spouse = focused.nodes.find((node) => node.name === '配偶');
  assert.ok(spouse, '共同亲代应被补进来');
  assert.equal(spouse.generation, 0, '共同亲代与中心同世代');
  const childEdges = focused.edges.filter((edge) => edge.to.startsWith('child:'));
  assert.equal(childEdges.length, 2, '孩子应有母与父两条边');
});

test('补共同亲代只补一层，不会把祖辈整串拉进来', () => {
  const graph = buildLineageGraph({
    characters: {
      我: character('我', [{ id: 'k1', name: '长子', fathers: '配偶' }]),
      配偶: character('配偶'),
      配偶之母: character('配偶之母', [{ id: 'k2', name: '配偶', registeredAs: '配偶' }]),
    },
  });
  const focused = focusLineage(graph, 'char:我', { up: 0, down: 1 });
  assert.equal(focused.nodes.some((node) => node.name === '配偶'), true);
  assert.equal(focused.nodes.some((node) => node.name === '配偶之母'), false, '不该继续往上递归');
});
