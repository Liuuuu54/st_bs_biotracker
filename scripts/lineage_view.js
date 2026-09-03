/**
 * 血缘视窗的视图模型：把 lineage 图整理成「按世代分列 + 每个节点的关系摘要」。
 * 只做资料整形，不产生 DOM，也不依赖任何宿主 API。
 */
import { buildLineageGraph, focusLineage } from './lineage.js';

const GENERATION_LABELS = new Map([
  [-3, '曾祖辈'],
  [-2, '祖辈'],
  [-1, '父母辈'],
  [0, '本人'],
  [1, '子女'],
  [2, '孙辈'],
  [3, '曾孙辈'],
]);

function generationLabel(generation) {
  if (GENERATION_LABELS.has(generation)) return GENERATION_LABELS.get(generation);
  return generation < 0 ? `上${Math.abs(generation)}代` : `下${generation}代`;
}

/** 种族与衍生类型合成一个显示字串，与追踪页的写法一致 */
function raceLabel(race, derivedType) {
  const base = String(race || '').trim();
  const derived = String(derivedType || '').trim();
  if (!base) return '';
  return derived ? `[${derived}]${base}` : base;
}

const EDGE_LABELS = { mother: '母', father: '父', carrier: '承载' };

export function buildLineageView(chatState, centerName, { up = 2, down = 2 } = {}) {
  const graph = buildLineageGraph(chatState);
  const centerId = `char:${String(centerName || '').trim()}`;
  const focused = focusLineage(graph, centerId, { up, down });
  if (focused.nodes.length === 0) {
    return { centerId, centerName: String(centerName || ''), generations: [], nodes: [], empty: true };
  }

  const byId = new Map(focused.nodes.map((node) => [node.id, node]));
  const nameOf = (id) => byId.get(id)?.name || id;

  const nodes = focused.nodes.map((node) => {
    const parents = focused.edges
      .filter((edge) => edge.to === node.id)
      .map((edge) => ({ id: edge.from, name: nameOf(edge.from), relation: EDGE_LABELS[edge.type] || edge.type }));
    const childrenOf = focused.edges
      .filter((edge) => edge.from === node.id)
      .map((edge) => ({ id: edge.to, name: nameOf(edge.to), relation: EDGE_LABELS[edge.type] || edge.type }));
    return {
      ...node,
      isCenter: node.id === centerId,
      displayName: node.name || '未命名',
      raceLabel: raceLabel(node.race, node.derivedType),
      parents,
      children: childrenOf,
      // 未注册的路人不能点进详情，没有可展开的资料
      hasDetail: node.kind !== 'unregistered',
    };
  });

  const generations = [...new Set(nodes.map((node) => node.generation))]
    .sort((a, b) => a - b)
    .map((generation) => ({
      generation,
      label: generationLabel(generation),
      nodes: nodes.filter((node) => node.generation === generation),
    }));

  return { centerId, centerName: String(centerName || ''), generations, nodes, empty: false };
}

/** 供渲染层查询某个节点该高亮哪些邻居 */
export function relatedNodeIds(view, nodeId) {
  const node = (view?.nodes || []).find((item) => item.id === nodeId);
  if (!node) return [];
  return [...node.parents.map((item) => item.id), ...node.children.map((item) => item.id)];
}
