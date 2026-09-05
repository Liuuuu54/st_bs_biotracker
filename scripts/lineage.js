/**
 * 血缘关系图：从 chatState 读出节点与边，不修改任何状态、不依赖引擎逻辑。
 *
 * 图的形状是 DAG 而不是族谱树——嵌合体让一个个体可能有多位亲代，代孕让
 * 「母亲」分成遗传母与承载者。按既定取舍，嵌合体只连首位父母，其余来源
 * 保留在节点上供渲染层显示。
 *
 * 身分即名字：characters 以名字为键，所以 children[*].fathers 这个字串
 * 直接就能对回角色节点；对不上的（路人）当作未注册叶节点。
 */

/** 双父／多母源会合并成 "A×B"，与 registry 的拆分规则一致 */
function splitSources(value) {
  return String(value || '')
    .split(/\s*[×Xx]\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function firstSource(list, fallbackText) {
  if (Array.isArray(list) && list.length > 0) {
    const first = String(list[0] || '').trim();
    if (first) return { first, all: list.map((item) => String(item || '').trim()).filter(Boolean) };
  }
  const parts = splitSources(fallbackText);
  return { first: parts[0] || '', all: parts };
}

export function buildLineageGraph(chatState) {
  const characters = (chatState && typeof chatState.characters === 'object' && chatState.characters) || {};
  const characterNames = Object.keys(characters);
  const isRegistered = (name) => Object.prototype.hasOwnProperty.call(characters, name);

  const nodes = new Map();
  const edges = [];

  const characterNodeId = (name) => `char:${name}`;
  const unregisteredNodeId = (name) => `name:${name}`;

  /**
   * 解析一个亲代名字到节点；未注册的当叶节点。
   * race/derivedType 只在能明确对应时才补——嵌合体有多位父源时
   * 那串合并种族对不回单一个人，宁可留空也不要标错血统。
   */
  const resolveParent = (name, traits = null) => {
    const value = String(name || '').trim();
    if (!value) return null;
    if (isRegistered(value)) return characterNodeId(value);
    const id = unregisteredNodeId(value);
    if (!nodes.has(id)) nodes.set(id, { id, kind: 'unregistered', name: value });
    const node = nodes.get(id);
    if (traits?.race && !node.race) node.race = traits.race;
    if (traits?.derivedType && !node.derivedType) node.derivedType = traits.derivedType;
    return id;
  };

  // 先建立所有已注册角色的节点，孤立角色也要出现在图上
  for (const name of characterNames) {
    const profile = characters[name]?.profile || {};
    nodes.set(characterNodeId(name), {
      id: characterNodeId(name),
      kind: 'character',
      name,
      race: profile.base?.race ?? null,
      derivedType: profile.base?.derivedType ?? null,
      age: profile.base?.age ?? null,
    });
  }

  for (const ownerName of characterNames) {
    const owner = characters[ownerName];
    const children = Array.isArray(owner?.profile?.children) ? owner.profile.children : [];
    for (const child of children) {
      if (!child || typeof child !== 'object') continue;

      // 孩子注册成角色后，两者是同一个体：节点合并到角色上
      const registeredAs = String(child.registeredAs || '').trim();
      const childNodeId = registeredAs && isRegistered(registeredAs)
        ? characterNodeId(registeredAs)
        : `child:${child.id || `${ownerName}#${children.indexOf(child)}`}`;

      if (!nodes.has(childNodeId)) {
        nodes.set(childNodeId, {
          id: childNodeId,
          kind: 'child',
          name: child.name ?? null,
          race: child.race ?? null,
          derivedType: child.derivedType ?? null,
          gender: child.gender ?? null,
          age: child.age ?? null,
        });
      }
      // 合并到角色节点时不写 registeredAs——那会指向它自己。
      // 「这个角色是在故事里被生下来的」判定 kind === 'character' 且有 childId 即可。
      const childNode = nodes.get(childNodeId);
      childNode.childId = child.id ?? null;

      // 孕中孕：母亲是同胎次的另一个孩子（宿主胎儿），承载者只是承载。
      // 这条边不能走名字——胎儿没有名字，靠出生时解析出来的 nestedInChildId 指过去。
      // 母系：provider 存在代表 owner 只是承载者，遗传母是 provider。
      // 这两个在下面算 extraSources 时还要用，宣告留在外层。
      const providerInfo = firstSource(child.providerSources, child.provider);
      const chimeraMaternal = firstSource(child.chimera?.maternalSources, '');
      const nestedInChildId = String(child.nestedInChildId || '').trim();
      const geneticMother = providerInfo.first || chimeraMaternal.first;
      if (nestedInChildId) {
        edges.push({ from: `child:${nestedInChildId}`, to: childNodeId, type: 'mother' });
        edges.push({ from: characterNodeId(ownerName), to: childNodeId, type: 'carrier' });
      } else if (geneticMother && geneticMother !== ownerName) {
        const from = resolveParent(geneticMother);
        if (from) edges.push({ from, to: childNodeId, type: 'mother' });
        edges.push({ from: characterNodeId(ownerName), to: childNodeId, type: 'carrier' });
      } else {
        edges.push({ from: characterNodeId(ownerName), to: childNodeId, type: 'mother' });
      }

      // 父系：嵌合体优先读 fatherSources，否则拆 "A×B"，都只取首位。
      // 胎内回归的「父」其实是回到子宫里的那个人，与一般父系不是同一回事，
      // 边型另外标出来，免得族谱上把一名女角色挂在「父」底下。
      const isRebirth = Array.isArray(child.tags) && child.tags.includes('rebirth');
      const fatherInfo = firstSource(child.chimera?.fatherSources, child.fathers);
      if (fatherInfo.first && fatherInfo.first !== '未知') {
        const singleFather = fatherInfo.all.length <= 1;
        const from = resolveParent(fatherInfo.first, singleFather
          ? { race: child.fatherRace ?? null, derivedType: child.fatherDerivedType ?? null }
          : null);
        if (from) edges.push({ from, to: childNodeId, type: isRebirth ? 'rebirth' : 'father' });
      }

      // 其余来源不连线，但保留下来供渲染层标注「另有 N 位来源」
      const extraSources = [
        ...providerInfo.all.slice(1),
        ...chimeraMaternal.all.slice(1),
        ...fatherInfo.all.slice(1),
      ];
      if (extraSources.length > 0) childNode.extraSources = extraSources;
    }
  }

  return { nodes: [...nodes.values()], edges };
}

/**
 * 以某个节点为中心裁切血缘图，并标上世代。
 *
 * 全图在手机上很快就糊了，实际想看的多半是「这孩子谁生的、跟谁有血缘」。
 * 中心为第 0 代，祖先为负、后代为正，渲染层照 generation 分代横排即可。
 *
 * 近亲繁殖（自交、胎内回归）会让同一个人同时出现在两个世代距离上，
 * 此处取最近的一条——分代横排只能给每人一列，取近的比取远的直观。
 */
export function focusLineage(graph, centerId, { up = 2, down = 2 } = {}) {
  const allNodes = new Map((graph?.nodes || []).map((node) => [node.id, node]));
  const edges = graph?.edges || [];
  if (!allNodes.has(centerId)) return { nodes: [], edges: [], centerId };

  const generation = new Map([[centerId, 0]]);

  // 往上找亲代：边的 to 是当前节点
  const walk = (direction, limit) => {
    let frontier = [centerId];
    for (let step = 1; step <= limit; step += 1) {
      const next = [];
      for (const id of frontier) {
        for (const edge of edges) {
          const isMatch = direction < 0 ? edge.to === id : edge.from === id;
          if (!isMatch) continue;
          const neighbour = direction < 0 ? edge.from : edge.to;
          if (generation.has(neighbour)) continue;
          generation.set(neighbour, direction * step);
          next.push(neighbour);
        }
      }
      if (next.length === 0) break;
      frontier = next;
    }
  };
  walk(-1, Math.max(0, up));
  walk(1, Math.max(0, down));

  // 补上共同亲代：往下走只会捞到中心的后代，另一位亲代既不是中心的祖先
  // 也不是后代，会整个缺席，族谱上看起来就像孩子只有一个亲代。
  // 只补一层、不再往上递归，避免把整张图拉进来。
  for (const [id, gen] of [...generation.entries()]) {
    if (gen < 0) continue;
    for (const edge of edges) {
      if (edge.to !== id || generation.has(edge.from)) continue;
      generation.set(edge.from, gen - 1);
    }
  }

  const nodes = [...generation.entries()]
    .filter(([id]) => allNodes.has(id))
    .map(([id, gen]) => ({ ...allNodes.get(id), generation: gen }))
    .sort((a, b) => a.generation - b.generation);

  const kept = new Set(nodes.map((node) => node.id));
  return {
    centerId,
    nodes,
    edges: edges.filter((edge) => kept.has(edge.from) && kept.has(edge.to)),
  };
}
