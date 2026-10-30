import { getSpermQualityFactors } from './sires.js';

const amount = (value) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
const list = (value) => Array.isArray(value) ? value : [];
const snapshotKey = (source) => JSON.stringify([
  source.male, source.race || '人类', source.derivedType ?? null, source.bodySize ?? null,
  getSpermQualityFactors(source.quality).quality, source.bloodlineSource ?? null,
  Object.entries(source.bloodline || {}).sort(([left], [right]) => left.localeCompare(right)),
]);

/**
 * 预览、受精与排出共用的来源读取。可见残留决定物理总量，接触记录保留各自快照。
 * 旧存档未记接触的余量沿用原精源，不伪造接触编号或时间；失活记录仍占物理量。
 * 只返回副本，渲染不会迁移或改写存档。
 */
export function getSpermSources(base = {}) {
  const residues = new Map();
  for (const source of list(base.sperms)) {
    const entry = residues.get(source.male) || { rows: [], value: 0 };
    entry.rows.push({ ...source, value: amount(source.value) });
    entry.value += amount(source.value);
    residues.set(source.male, entry);
  }
  const totals = new Map();
  const knownSnapshots = new Map();
  for (const contact of list(base.spermContacts)) {
    totals.set(contact.male, (totals.get(contact.male) || 0) + amount(contact.value));
    const key = snapshotKey(contact);
    knownSnapshots.set(key, (knownSnapshots.get(key) || 0) + amount(contact.value));
  }
  const sources = list(base.spermContacts).map((contact) => {
    const total = totals.get(contact.male) || 0;
    const residue = residues.get(contact.male)?.value || 0;
    return { ...contact, value: amount(contact.value) * (total > residue ? residue / total : 1) };
  });
  for (const [male, { rows, value }] of residues) {
    const unknown = Math.max(0, value - (totals.get(male) || 0));
    if (!(unknown > 0)) continue;
    // 登记器允许同父多行旧精源：先扣同快照已知量，剩下的差额保留各行原快照。
    // 汇总行未保留旧快照时只能按剩余比例对账，不回查现时精方或伪造过去资料。
    const remaining = rows.map((row) => {
      const key = snapshotKey(row);
      const covered = Math.min(row.value, knownSnapshots.get(key) || 0);
      knownSnapshots.set(key, (knownSnapshots.get(key) || 0) - covered);
      return { ...row, value: row.value - covered };
    });
    const remainingTotal = remaining.reduce((total, row) => total + row.value, 0);
    for (const row of remaining) {
      if (row.value > 0) sources.push({ ...row, value: row.value * unknown / remainingTotal });
    }
  }
  return sources;
}

/** 写回独立接触量；零量记录保留给已受精胚胎与事后避孕的来源关联。 */
export function setSpermSources(base, sources) {
  base.spermContacts = sources.map((source) => ({ ...source, value: amount(source.value) }));
  const residues = new Map();
  for (const source of base.spermContacts) {
    if (!(source.value > 0)) continue;
    const previous = residues.get(source.male);
    // 面板仍按父方汇总；遗传、品质、失活状态以独立接触记录为准。
    const { male, race, bloodline, bloodlineSource, derivedType, bodySize, quality } = source;
    residues.set(male, {
      male, race, bloodline, bloodlineSource, derivedType, bodySize, quality,
      value: (previous?.value || 0) + source.value,
    });
  }
  base.sperms = [...residues.values()];
}

/** 伴生卵用同父、同快照的可受精材料总量；选中的接触编号和遗传资料仍各自保留。 */
export function getSpermSnapshotAmount(sources, selected) {
  const selectedKey = snapshotKey(selected);
  return sources.reduce((total, source) => total + (!source.blocked && snapshotKey(source) === selectedKey ? amount(source.value) : 0), 0);
}

/** 相同父方及品质沿用一份原有线性衰减；拆成多笔接触不增加每天流失量。 */
export function getSpermDecayKey(source) {
  // 独立计算器可以省略父方名字，此时至少按种族区分，避免不同种族共用自然流失。
  return JSON.stringify([source.male || '', source.male ? '' : source.race || '人类', getSpermQualityFactors(source.quality).quality]);
}
