import { readFileSync, writeFileSync } from 'node:fs';

let s = readFileSync('scripts/registry.js', 'utf8');
const sub = (from, to, label) => {
  const n = s.split(from).length - 1;
  if (n !== 1) throw new Error(`${label}: 锚点 ${n} 次`);
  s = s.replace(from, to);
};

// import
sub(
  `import {\n  syncCharacterStageFromProfile,`,
  `import { sanitizeFetusTagList } from './fetus_tags.js';\nimport {\n  syncCharacterStageFromProfile,`,
  'import',
);

// ── 白名单放行特殊胎儿栏位 ────────────────────────────────────
sub(
  `          affinity: Number.isFinite(Number(item.affinity)) ? clampNumber(item.affinity, -50, 50, 0) : undefined,
          talents: normalizeTalentList(item.talents ?? item.inheritedTalents),`,
  `          affinity: Number.isFinite(Number(item.affinity)) ? clampNumber(item.affinity, -50, 50, 0) : undefined,
          // 特殊来历：让角色卡开场就能是同卵双胞胎、异期复孕、孕中孕或胎内回归。
          // 只放行目录内的标签，支撑栏位在 normalizeRegisteredPregnancy 里对齐。
          tags: sanitizeFetusTagList(item.tags),
          conceivedAtDays: Number.isFinite(Number(item.conceivedAtDays)) ? Number(item.conceivedAtDays) : undefined,
          identicalGroup: Number.isFinite(Number(item.identicalGroup)) ? Math.floor(Number(item.identicalGroup)) : undefined,
          nestedInIndex: Number.isFinite(Number(item.nestedInIndex)) ? Math.floor(Number(item.nestedInIndex)) : undefined,
          revealed: item.revealed === undefined ? undefined : Boolean(item.revealed),
          talents: normalizeTalentList(item.talents ?? item.inheritedTalents),`,
  '白名单',
);

// ── 正规化：把模型给的标签与支撑栏位对齐成自洽状态 ────────────────
sub(
  `  pregnant.fetusesCount = pregnant.fetuses.length;
  pregnant.pregnantDays = Math.max(1, Math.floor(Number(pregnant.pregnantDays) || 1));`,
  `  normalizeRegisteredFetusTags(pregnant);
  pregnant.fetusesCount = pregnant.fetuses.length;
  pregnant.pregnantDays = Math.max(1, Math.floor(Number(pregnant.pregnantDays) || 1));`,
  '呼叫正规化',
);

sub(
  `function normalizeRegisteredPregnancy(profile) {`,
  `/**
 * 把注册时给的特殊胎儿标签整理成自洽状态。
 *
 * 让模型直接写 tags 是有意的——「开场就已经在角色子宫里」这种设定没有别的表达方式。
 * 代价是它可能写出自相矛盾的组合，所以这里逐项对齐：落单的同卵会被撤掉标签、
 * 指不到宿主的孕中孕会被撤掉标签、异期复孕的受精点会被夹进合法范围。
 * 宁可少一个标签，也不要留一个指向虚空的关系。
 */
function normalizeRegisteredFetusTags(pregnant) {
  const fetuses = Array.isArray(pregnant.fetuses) ? pregnant.fetuses : [];
  if (fetuses.length === 0) return;

  fetuses.forEach((fetus, index) => {
    if (!Number.isInteger(Number(fetus.embryoId)) || Number(fetus.embryoId) <= 0) fetus.embryoId = index + 1;
    fetus.tags = sanitizeFetusTagList(fetus.tags);
  });

  // 孕中孕：模型给的是阵列索引（它写不出内部编号），换成宿主的 embryoId
  for (const [index, fetus] of fetuses.entries()) {
    const target = Number(fetus.nestedInIndex);
    delete fetus.nestedInIndex;
    const valid = Number.isInteger(target) && target >= 0 && target < fetuses.length && target !== index;
    if (valid) fetus.nestedInEmbryoId = fetuses[target].embryoId;
    if (!fetus.nestedInEmbryoId) fetus.tags = fetus.tags.filter((tag) => tag !== 'nested');
  }
  // 宿主自己也是被套的那颗时整条链不成立，一起撤掉
  for (const fetus of fetuses) {
    if (!fetus.nestedInEmbryoId) continue;
    const host = fetuses.find((item) => item.embryoId === fetus.nestedInEmbryoId);
    if (!host || host.nestedInEmbryoId) {
      delete fetus.nestedInEmbryoId;
      fetus.tags = fetus.tags.filter((tag) => tag !== 'nested');
    }
  }

  // 同卵：标了却没给组别时自动分同一组；组内只有自己的撤掉标签
  const lonely = fetuses.filter((fetus) => fetus.tags.includes('identical') && !fetus.identicalGroup);
  if (lonely.length >= 2) for (const fetus of lonely) fetus.identicalGroup = lonely[0].embryoId;
  for (const fetus of fetuses) {
    const group = Number(fetus.identicalGroup);
    const mates = group ? fetuses.filter((item) => Number(item.identicalGroup) === group) : [];
    if (mates.length >= 2) {
      if (!fetus.tags.includes('identical')) fetus.tags = sanitizeFetusTagList([...fetus.tags, 'identical']);
    } else {
      delete fetus.identicalGroup;
      fetus.tags = fetus.tags.filter((tag) => tag !== 'identical');
    }
  }

  // 异期复孕：受精点必须落在这次妊娠之内，且与标签互相对齐
  const effectiveDays = Math.max(0, Number(pregnant.effectivePregnantDays) || 0);
  for (const fetus of fetuses) {
    const conceivedAt = Number(fetus.conceivedAtDays);
    if (Number.isFinite(conceivedAt) && conceivedAt > 0) {
      fetus.conceivedAtDays = Math.min(Math.max(conceivedAt, 0), Math.max(effectiveDays - 1, 0));
      fetus.tags = sanitizeFetusTagList([...fetus.tags, 'superfetation']);
    } else {
      delete fetus.conceivedAtDays;
      fetus.tags = fetus.tags.filter((tag) => tag !== 'superfetation' && tag !== 'nested');
      delete fetus.nestedInEmbryoId;
    }
  }

  // 模型没说藏不藏时，照运行期的规则判定：一般异期胎进孕中期揭晓，孕中孕要到孕晚期
  for (const fetus of fetuses) {
    if (!fetus.conceivedAtDays) { delete fetus.revealed; continue; }
    if (fetus.revealed === undefined) {
      const threshold = fetus.nestedInEmbryoId ? 189 : 84;
      fetus.revealed = effectiveDays >= threshold;
    }
    if (!fetus.revealed) delete fetus.revealed;
  }

  for (const fetus of fetuses) if (fetus.tags.length === 0) delete fetus.tags;
}

function normalizeRegisteredPregnancy(profile) {`,
  '正规化函式',
);

// ── 供养力也用每胎自己的孕龄 ──────────────────────────────────
sub(
  `    const weight = clampNumber(fetus?.weight, 0.33, 3.0, 1.0);
    const ageInDays = pregnant.effectivePregnantDays * weight;`,
  `    const weight = clampNumber(fetus?.weight, 0.33, 3.0, 1.0);
    // 与运行期一致：异期胎用自己的孕龄，不按先来者的进度算负担
    const ownAge = Math.max(0, pregnant.effectivePregnantDays - (Number(fetus?.conceivedAtDays) || 0));
    const ageInDays = ownAge * weight;`,
  '每胎年龄',
);

writeFileSync('scripts/registry.js', s, 'utf8');
console.log('ok');
