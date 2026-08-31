import { getEmbryoTypeByRace } from './race_config.js';

const EMBRYO_TYPE_REFERENCE = {
  胎生: [
    '胎生 (Viviparous)',
    '-遵循常規哺乳類生理，未受精時子宮內膜脫落出血。表現為週期性的血液排出與腰腹墜脹，伴隨明顯的激素波動。',
    '-胚胎依賴胎盤與母體循環交換營養；多胎妊娠時需注意絨毛膜與羊膜共用所引發的發育風險。',
    '-新生兒出生時生理成熟度較低，極度脆弱，分娩後需母體長期的哺乳與照護方能存活。',
    '-分娩難度高度取決於胎位；正位（頭位，tendencyAngle 0/360）最為順利，倒位（臀位，tendencyAngle 180）或橫位會導致產程大幅延長及風險遞增。',
  ].join('\n'),
  卵生: [
    '卵生 (Oviparous)',
    '-週期性排出未受精的「空卵」。由於卵生種族通常具備多產特徵，月經期會伴隨強烈的產道擴張感，排出多枚體積較小、無殼或薄殼的透明卵體。',
    '-母體能量主要消耗於卵黃積累與蛋殼鈣化，而非胚胎本體的快速發育，孕期負擔隨結殼進度增加。',
    '-產後母體即進入恢復期，卵體於體外獨立孵化且環境依賴性高；孵化後的幼體通常具備初步自立能力。',
    '-對胚位要求較低，正位與倒位分娩難度基本一致，僅在卵體呈現長軸橫位時才會增加排出阻力。',
  ].join('\n'),
  卵胎生: [
    '卵胎生 (Ovoviviparous)',
    '-本質為退化的結卵過程。未受精的卵體結構極度脆弱，在通過產道排出時會因壓力而破碎，最終表現為排出大量透明、膠狀且高度黏稠的物質，而非單純血液。',
    '-前期為卵黃供能發育，於孕晚期或臨盆前在宮內破卵；分娩出後即為可自由活動、具備狩獵或自立能力的幼體。',
    '-宮內破卵後，幼體失去卵殼保護並在有限空間內產生競爭，多胎極易發生同胞相殘或吞噬弱者的現象。',
    '-由於幼體活動度高且結構相對複雜，分娩前需極其精準的胚位校正，若位置偏移極易造成難產。',
  ].join('\n'),
  胎转卵生: [
    '胎轉卵生 (Metoviviparous)',
    '-子宮內膜不以血液形式脫落，而是高度凝聚成塊。排出物為半固體的肉質「卵囊」，排出時伴隨類似分娩的強烈收縮感。',
    '-孕期經歷從胎盤供能到卵黃儲備的轉化，母體需消耗巨量能源以支應產後漫長的體外孵化需求。',
    '-孕晚期因卵體巨大化且羊水相對枯竭，母體會產生劇烈的內部摩擦感與沈重墜脹感，分娩過程極其緩慢且耗費體力。',
    '-因卵體接近球形，多軸向路徑皆可通適，但若重心偏離產道中軸線，將導致產力分散，增加排出難度。',
  ].join('\n'),
  不定型: [
    '不定型 (Amorphous)',
    '-無外部排泄表現。未受精的生殖能量或組織會在體內被重新吸收、轉化或降解，生理上不存在「月經」概念，僅表現為核心能量的週期性閃爍或體溫波動。',
    '-不依賴傳統胎盤或卵黃，胚胎形態隨發育階段大幅扭曲或重組，呈現高度的物種特異性。',
    '-多為構造體或靈體化生命，異種繁衍時存在極高的生殖隔離壁壘，受孕與著床過程極不穩定。',
    '-胎位與產道適應性完全不可預測，分娩模式從「分裂」、「排泄」到「重構」皆有可能，無通用規律可循。',
  ].join('\n'),
};

const EMBRYO_TYPE_ORDER = ['胎生', '卵生', '卵胎生', '胎转卵生', '不定型'];

function pushEmbryoType(target, type) {
  const value = String(type || '').trim();
  if (!value || target.includes(value)) return;
  target.push(value);
}

function addEmbryoTypeFromRace(target, race) {
  const value = String(race || '').trim();
  if (!value) return;
  pushEmbryoType(target, getEmbryoTypeByRace(value));
}

function collectEmbryoTypesFromCharacterState(target, characterState) {
  const profile = characterState?.profile || {};
  const base = profile.base || {};
  const pregnant = profile.pregnant || {};
  const children = Array.isArray(profile.children) ? profile.children : [];
  addEmbryoTypeFromRace(target, base.race);
  for (const sperm of (Array.isArray(base.sperms) ? base.sperms : [])) addEmbryoTypeFromRace(target, sperm?.race);
  for (const candidate of (Array.isArray(base.conceptionCandidates) ? base.conceptionCandidates : [])) addEmbryoTypeFromRace(target, candidate?.race);
  for (const fetus of (Array.isArray(pregnant.fetuses) ? pregnant.fetuses : [])) {
    addEmbryoTypeFromRace(target, fetus?.race);
    addEmbryoTypeFromRace(target, fetus?.fatherRace);
    const embryoType = String(fetus?.embryoType || '').trim();
    if (embryoType) pushEmbryoType(target, embryoType);
  }
  for (const child of children) addEmbryoTypeFromRace(target, child?.race);
}

export function getRelevantEmbryoTypes(payload = {}) {
  const found = [];
  addEmbryoTypeFromRace(found, payload?.declared_race);
  if (payload?.existing_state && typeof payload.existing_state === 'object') {
    for (const characterState of Object.values(payload.existing_state)) collectEmbryoTypesFromCharacterState(found, characterState);
  }
  return found.filter((type) => EMBRYO_TYPE_ORDER.includes(type));
}

export function buildEmbryoTypeLorePrompt(payload = {}, { includeAllIfEmpty = false } = {}) {
  const relevantTypes = getRelevantEmbryoTypes(payload);
  const finalTypes = relevantTypes.length > 0 ? relevantTypes : (includeAllIfEmpty ? EMBRYO_TYPE_ORDER : []);
  if (finalTypes.length === 0) return '';
  return [
    '[胚胎类型补充设定]',
    '以下文本来自项目内的胚胎类型 lore，请将其视为高优先级设定。',
    '当母体和胎兒父源种族涉及不同生殖体系时，需要同时参考多个胚胎类型文本；不要只保留单一类型。',
    '例如人类母体怀有龙族胎儿时，应同时参考「胎生」与「胎转卵生」。',
    '',
    ...finalTypes.map((type) => EMBRYO_TYPE_REFERENCE[type]).filter(Boolean),
  ].join('\n');
}

export function getEmbryoTypeReferenceText(embryoType) {
  return EMBRYO_TYPE_REFERENCE[String(embryoType || '').trim()] || '';
}
