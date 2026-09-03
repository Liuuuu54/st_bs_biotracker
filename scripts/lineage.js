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

  /** 解析一个亲代名字到节点；未注册的当叶节点 */
  const resolveParent = (name) => {
    const value = String(name || '').trim();
    if (!value) return null;
    if (isRegistered(value)) {
      const id = characterNodeId(value);
      if (!nodes.has(id)) nodes.set(id, { id, kind: 'character', name: value });
      return id;
    }
    const id = unregisteredNodeId(value);
    if (!nodes.has(id)) nodes.set(id, { id, kind: 'unregistered', name: value });
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
        });
      }
      const childNode = nodes.get(childNodeId);
      childNode.childId = child.id ?? null;
      if (registeredAs) childNode.registeredAs = registeredAs;

      // 母系：provider 存在代表 owner 只是承载者，遗传母是 provider
      const providerInfo = firstSource(child.providerSources, child.provider);
      const chimeraMaternal = firstSource(child.chimera?.maternalSources, '');
      const geneticMother = providerInfo.first || chimeraMaternal.first;
      if (geneticMother && geneticMother !== ownerName) {
        const from = resolveParent(geneticMother);
        if (from) edges.push({ from, to: childNodeId, type: 'mother' });
        edges.push({ from: characterNodeId(ownerName), to: childNodeId, type: 'carrier' });
      } else {
        edges.push({ from: characterNodeId(ownerName), to: childNodeId, type: 'mother' });
      }

      // 父系：嵌合体优先读 fatherSources，否则拆 "A×B"，都只取首位
      const fatherInfo = firstSource(child.chimera?.fatherSources, child.fathers);
      if (fatherInfo.first && fatherInfo.first !== '未知') {
        const from = resolveParent(fatherInfo.first);
        if (from) edges.push({ from, to: childNodeId, type: 'father' });
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
