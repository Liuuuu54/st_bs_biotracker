/**
 * 血缘视窗的视图模型：把 lineage 图整理成「按世代分列 + 每个节点的关系摘要」。
 * 只做资料整形，不产生 DOM，也不依赖任何宿主 API。
 */
import { buildLineageGraph, focusLineage } from './lineage.js';
import { formatBloodline } from './race_config.js';

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

const EDGE_LABELS = { mother: '母', father: '父', carrier: '承载', rebirth: '前身' };

/**
 * 写实世界族谱的人生阶段：年龄未满门槛即属该段。少年从初潮（约 12 岁）起，
 * 中年从更年期（约 45 岁）起。按显示的整数岁判定，与卡片上的岁数一致。
 */
export const LIFE_STAGE_AGE_BOUNDS = Object.freeze([
  [3, '婴儿'],
  [12, '孩童'],
  [18, '少年'],
  [45, '成人'],
  [60, '中年'],
  [Infinity, '长者'],
]);

/**
 * 节点的人生阶段。未注册的人只有配子来源这层身分：当父方（含胎内回归的前身）是精方、
 * 当遗传母方是卵方，两者都当过或都没有就判断不了；已注册角色与孩子按年龄分段，没有年龄也回 null，
 * 由渲染层退回姓名首字。
 */
export function getLifeStage(kind, age, childRelations = []) {
  if (kind === 'unregistered') {
    const sire = childRelations.some((relation) => relation === '父' || relation === '前身');
    const dam = childRelations.includes('母');
    if (sire === dam) return null;
    return sire ? '精方' : '卵方';
  }
  const value = Number(age);
  if (age === null || age === undefined || age === '' || !Number.isFinite(value)) return null;
  const years = Math.max(0, Math.round(value));
  return LIFE_STAGE_AGE_BOUNDS.find(([limit]) => years < limit)[1];
}

/**
 * 年龄取整数岁，与追踪页概览同一套算法——同一个角色在两个画面显示不同岁数
 * 会被当成 bug。未注册的路人没有年龄资料，回空字串让渲染层整行略过。
 */
function ageLabel(age) {
  const value = Number(age);
  if (!Number.isFinite(value)) return '';
  return `${Math.round(value)}岁`;
}

/**
 * 同一世代里把「遗传亲代完全相同」的人聚成一丛，渲染层才画得出手足共用的连接线。
 * 没有亲代的（图上被截断的祖先、手动注册的角色）各自成丛，不会被误并成一家。
 */
function buildClusters(rowNodes) {
  const clusters = [];
  const byKey = new Map();
  for (const node of rowNodes) {
    const key = node.geneticParents.length > 0
      ? node.geneticParents.map((item) => `${item.relation}:${item.id}`).sort().join('|')
      : `solo:${node.id}`;
    let cluster = byKey.get(key);
    if (!cluster) {
      cluster = { key, parents: node.geneticParents, nodes: [] };
      byKey.set(key, cluster);
      clusters.push(cluster);
    }
    cluster.nodes.push(node);
  }
  return clusters;
}

export function buildLineageView(chatState, centerName, { up = 2, down = 2 } = {}) {
  const graph = buildLineageGraph(chatState);
  const centerId = `char:${String(centerName || '').trim()}`;
  const focused = focusLineage(graph, centerId, { up, down });
  if (focused.nodes.length === 0) {
    return { centerId, centerName: String(centerName || ''), generations: [], nodes: [], empty: true };
  }

  const byId = new Map(focused.nodes.map((node) => [node.id, node]));
  // 母方（卵源）血统：族谱图示平手时取母系占比较高的种族。用完整资料图找，母亲不在聚焦范围内也算；多位母源取平均
  const graphById = new Map(graph.nodes.map((node) => [node.id, node]));
  const motherBloodlineOf = (id) => {
    const mothers = graph.edges.filter((edge) => edge.to === id && edge.type === 'mother')
      .map((edge) => graphById.get(edge.from)?.bloodline).filter((value) => value && typeof value === 'object');
    if (mothers.length === 0) return null;
    const merged = {};
    for (const bloodline of mothers) for (const [name, share] of Object.entries(bloodline)) merged[name] = (merged[name] || 0) + share / mothers.length;
    return merged;
  };
  // 无名的孩子也可能当亲代（孕中孕的母亲就是同胎的另一个孩子），
  // 没有 fallback 的话关系栏会印出原始节点 id
  const nameOf = (id) => {
    const node = byId.get(id);
    if (!node) return id;
    return node.name || '未命名';
  };

  /**
   * 同一对关系可能有多条边——自交时同一人既是母也是父，代孕时承载者与遗传母
   * 各有一条。按对方节点去重，关系标签合并成「母·父」，否则清单里会重复出现同一人。
   */
  const collapse = (list) => {
    const merged = new Map();
    for (const item of list) {
      const existing = merged.get(item.id);
      if (existing) {
        if (!existing.relations.includes(item.relation)) existing.relations.push(item.relation);
        continue;
      }
      merged.set(item.id, { id: item.id, name: item.name, relations: [item.relation] });
    }
    return [...merged.values()].map((item) => ({ ...item, relation: item.relations.join('·') }));
  };

  const nodes = focused.nodes.map((node) => {
    const parents = collapse(focused.edges
      .filter((edge) => edge.to === node.id)
      .map((edge) => ({ id: edge.from, name: nameOf(edge.from), relation: EDGE_LABELS[edge.type] || edge.type })));
    const childrenOf = collapse(focused.edges
      .filter((edge) => edge.from === node.id)
      .map((edge) => ({ id: edge.to, name: nameOf(edge.to), relation: EDGE_LABELS[edge.type] || edge.type })));
    // 承载者不是遗传亲代，不进族谱上的亲代标注，只在详情栏另列一行。
    // 「前身」是胎内回归者：他确实提供了这一胎的父系血统，所以算遗传亲代，
    // 只是标签不写「父」——那个位置上站的往往是女角色。
    const isGenetic = (item) => item.relations.some((relation) => relation === '母' || relation === '父' || relation === '前身');
    return {
      ...node,
      isCenter: node.id === centerId,
      displayName: node.name || '未命名',
      raceLabel: raceLabel(node.race, node.derivedType),
      bloodlineLabel: formatBloodline(node.race, node.bloodline, node.bloodlineSource),
      motherBloodline: motherBloodlineOf(node.id),
      ageLabel: ageLabel(node.age),
      lifeStage: getLifeStage(node.kind, node.age, childrenOf.flatMap((item) => item.relations)),
      parents,
      geneticParents: parents.filter(isGenetic),
      carriers: parents.filter((item) => !isGenetic(item)),
      children: childrenOf,
      carriedChildren: childrenOf.filter((item) => !isGenetic(item)),
      // 未注册的路人不能点进详情，没有可展开的资料
      hasDetail: node.kind !== 'unregistered',
    };
  });

  const generations = [...new Set(nodes.map((node) => node.generation))]
    .sort((a, b) => a - b)
    .map((generation) => {
      const rowNodes = nodes.filter((node) => node.generation === generation);
      return {
        generation,
        label: generationLabel(generation),
        nodes: rowNodes,
        clusters: buildClusters(rowNodes),
      };
    });

  return { centerId, centerName: String(centerName || ''), generations, nodes, empty: false };
}

/** 供渲染层查询某个节点该高亮哪些邻居 */
export function relatedNodeIds(view, nodeId) {
  const node = (view?.nodes || []).find((item) => item.id === nodeId);
  if (!node) return [];
  return [...node.parents.map((item) => item.id), ...node.children.map((item) => item.id)];
}
