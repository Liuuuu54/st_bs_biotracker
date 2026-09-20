import {
  calculateDerivedInheritancePreview,
  calculateFertilizationPreview,
  calculateOffspringPreview,
  calculateRaceImplantationDays,
  getDerivedInheritanceSeed,
} from './calculator.js';
import {
  DERIVED_TYPE_RACES,
  getMergedRacePhysiologyProfile,
} from './race_config.js';

let nextSpermRowId = 1;

function numberValue(id, fallback = 0) {
  const value = Number(document.getElementById(id)?.value);
  return Number.isFinite(value) ? value : fallback;
}

function selectedValue(id, fallback = '') {
  return String(document.getElementById(id)?.value || fallback);
}

function formatNumber(value, digits = 2) {
  if (!Number.isFinite(Number(value))) return '—';
  return Number(value).toLocaleString('zh-CN', { maximumFractionDigits: digits });
}

function formatPercent(value) {
  return `${formatNumber(Number(value) * 100, 2)}%`;
}

function setOutput(id, lines) {
  const output = document.getElementById(id);
  if (output) output.textContent = Array.isArray(lines) ? lines.join('\n') : String(lines || '');
}

function fillSelect(select, values, { emptyLabel = null, defaultValue = null } = {}) {
  if (!(select instanceof HTMLSelectElement)) return;
  const previous = select.value;
  select.replaceChildren();
  if (emptyLabel !== null) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = emptyLabel;
    select.append(option);
  }
  values.forEach((value) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    select.append(option);
  });
  select.value = values.includes(previous) || (emptyLabel !== null && previous === '')
    ? previous
    : (defaultValue ?? values[0] ?? '');
}

function populateStaticSelects() {
  ['bs-bt-calc-derived-mother', 'bs-bt-calc-derived-father'].forEach((id) => {
    fillSelect(document.getElementById(id), DERIVED_TYPE_RACES, { emptyLabel: '无' });
  });
}

function createSpermRow(race = '人类', value = 20) {
  const row = document.createElement('div');
  row.className = 'bs-bt-calculator-sperm-row';
  const heading = document.createElement('div');
  heading.className = 'bs-bt-calculator-sperm-heading';
  const order = document.createElement('span');
  order.className = 'bs-bt-calculator-sperm-order';
  const amountLabel = document.createElement('span');
  amountLabel.className = 'bs-bt-calculator-sperm-amount-label';
  amountLabel.textContent = '精液量';
  const controls = document.createElement('div');
  controls.className = 'bs-bt-calculator-sperm-controls';
  const raceInputId = `bs-bt-calc-sperm-race-${nextSpermRowId++}`;
  const racePicker = document.createElement('div');
  racePicker.className = 'bs-bt-race-picker-wrap';
  const raceInputRow = document.createElement('div');
  raceInputRow.className = 'bs-bt-race-input-row';
  const raceInput = document.createElement('input');
  raceInput.id = raceInputId;
  raceInput.className = 'text_pole';
  raceInput.type = 'text';
  raceInput.value = String(race || '人类');
  raceInput.dataset.calcSpermRace = '';
  raceInput.setAttribute('aria-label', '精源种族');
  const raceButton = document.createElement('button');
  raceButton.type = 'button';
  raceButton.className = 'bs-bt-race-picker-button';
  raceButton.dataset.racePickerTarget = raceInputId;
  raceButton.title = '种族调色盘';
  raceButton.setAttribute('aria-label', '精源种族调色盘');
  raceButton.textContent = '☥';
  const raceAnchor = document.createElement('div');
  raceAnchor.id = `${raceInputId}-palette-anchor`;
  raceAnchor.dataset.racePaletteAnchor = '';
  raceInputRow.append(raceInput, raceButton);
  racePicker.append(raceInputRow, raceAnchor);
  const input = document.createElement('input');
  input.className = 'text_pole';
  input.type = 'number';
  input.min = '0';
  input.step = '1';
  input.value = String(value);
  input.dataset.calcSpermValue = '';
  input.setAttribute('aria-label', '精液量');
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'menu_button bs-bt-calculator-remove';
  remove.dataset.calcSpermRemove = '';
  remove.textContent = '移除';
  heading.append(order, amountLabel);
  controls.append(racePicker, input, remove);
  row.append(heading, controls);
  return row;
}

function renumberSpermRows() {
  document.querySelectorAll('#bs-bt-calc-sperm-list .bs-bt-calculator-sperm-row').forEach((row, index) => {
    const order = row.querySelector('.bs-bt-calculator-sperm-order');
    if (order) order.textContent = `精源 ${index + 1}`;
  });
}

function addSpermRow(race = '人类', value = 20) {
  const list = document.getElementById('bs-bt-calc-sperm-list');
  if (!list || list.children.length >= 8) return;
  list.append(createSpermRow(race, value));
  renumberSpermRows();
}

function setCalculatorTab(tab) {
  const selected = ['fertilization', 'offspring', 'derived'].includes(tab) ? tab : 'fertilization';
  document.querySelectorAll('#bs-bt-calculator-tabs [data-calculator-tab]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.calculatorTab === selected);
  });
  document.querySelectorAll('[data-calculator-panel]').forEach((panel) => {
    const active = panel.dataset.calculatorPanel === selected;
    panel.hidden = !active;
  });
}

function calculateFertilization() {
  const eggRace = selectedValue('bs-bt-calc-fert-egg-race', '人类');
  const spermSources = [...document.querySelectorAll('#bs-bt-calc-sperm-list .bs-bt-calculator-sperm-row')]
    .map((row) => ({
      race: String(row.querySelector('[data-calc-sperm-race]')?.value || '人类'),
      value: Number(row.querySelector('[data-calc-sperm-value]')?.value) || 0,
    }));
  const result = calculateFertilizationPreview({
    eggRace,
    impregnationDifficulty: null,
    elapsedDays: numberValue('bs-bt-calc-fert-days', 1),
    chanceFactor: 1,
    spermSources,
  });
  const lines = [
    `当前精液量：${formatNumber(result.totalSperm)}　有效暴露：${formatNumber(result.effectiveExposureDays, 3)} 天`,
    `暴露期平均有效量：${formatNumber(result.effectiveTotalSperm, 3)}　剂量降难倍率：×${formatNumber(result.spermDoseBonus, 3)}`,
    `至少一方受精：${formatPercent(result.successChance)}　全部失败：${formatPercent(result.failureChance)}`,
  ];
  if (!result.sources.length) lines.push('没有精液量大于 0 的有效精源。');
  result.sources.forEach((source, index) => {
    const notes = [source.sameRace ? '同种' : '异种'];
    if (source.embryoTypeMismatch) notes.push('胚型不同 ×1.25 难度');
    lines.push(
      `${index + 1}. ${source.race}：有效 ${formatNumber(source.exposureDays, 3)} 天；份额 ${formatPercent(source.share)}；本源机会 ${formatPercent(source.chance)}；最终胜出 ${formatPercent(source.winChance)}（${notes.join('、')}）`,
    );
  });
  lines.push(`成功受精后约 ${formatNumber(calculateRaceImplantationDays(eggRace), 3)} 天进行着床判定。`);
  setOutput('bs-bt-calc-fert-output', lines);
}

function calculateOffspring() {
  const result = calculateOffspringPreview({
    eggRace: selectedValue('bs-bt-calc-offspring-egg-race', '人类'),
    spermRace: selectedValue('bs-bt-calc-offspring-sperm-race', '人类'),
    spermValue: numberValue('bs-bt-calc-offspring-sperm', 20),
    conceptionStage: selectedValue('bs-bt-calc-offspring-stage', '排卵期'),
  });
  const inheritance = result.inheritanceTag ? `（胎儿标签：${result.inheritanceTag}）` : '';
  const genderText = result.genderRatio === null
    ? '双性体系'
    : Number(result.genderRatio) === -1
      ? '无性／非二元体系'
      : Number.isFinite(Number(result.genderRatio))
        ? `${formatNumber(result.genderRatio)}% 雄性／${formatNumber(100 - Number(result.genderRatio))}% 雌性`
        : '依种族配置';
  const lines = [
    `核型：卵方 ${result.eggInheritanceMode} × 精方 ${result.spermInheritanceMode}`,
    `后代种族：${result.fetusRace}${inheritance}`,
    `胚型：${result.embryoType}（由最长孕期成分「${result.embryoTypeSource}」决定）`,
    `着床周期：成功受精后约 ${formatNumber(result.implantationDays, 3)} 天判定`,
    `种族基准孕期：约 ${formatNumber(result.gestationDays, 2)} 天　性别率：${genderText}`,
    `同卵分裂率：${formatNumber(result.identicalProbability, 2)}%`,
    `初始胎重：${formatNumber(result.fetalWeightRange.min, 3)}～${formatNumber(result.fetalWeightRange.max, 3)}（中心 ${formatNumber(result.fetalWeightRange.typical, 3)}；${result.conceptionStage}）`,
  ];
  if (result.clutchSizeMean > 1) {
    lines.push(
      `纯种卵群均值：${formatNumber(result.clutchSizeMean)}　精液倍率：×${formatNumber(result.clutchMultiplier, 3)}`,
      `本次卵群预测：${result.clutchRange.min}～${result.clutchRange.max}（中心 ${result.clutchRange.typical}）`,
      '范围对应正式抽取的 ±10%；祖谱仍只记录其中能成功长大繁育的一位。',
    );
  }
  setOutput('bs-bt-calc-offspring-output', lines);
}

function applyDerivedSeed() {
  const seed = getDerivedInheritanceSeed(
    selectedValue('bs-bt-calc-derived-mother') || null,
    selectedValue('bs-bt-calc-derived-father') || null,
  );
  const affinity = document.getElementById('bs-bt-calc-derived-affinity');
  const progress = document.getElementById('bs-bt-calc-derived-progress');
  if (affinity) affinity.value = String(seed.affinity);
  if (progress) progress.value = String(seed.progress);
  calculateDerived();
}

function calculateDerived() {
  const options = {
    motherDerivedType: selectedValue('bs-bt-calc-derived-mother') || null,
    fatherDerivedType: selectedValue('bs-bt-calc-derived-father') || null,
    fetusRace: selectedValue('bs-bt-calc-derived-race', '人类'),
    affinity: numberValue('bs-bt-calc-derived-affinity', 0),
    currentProgress: numberValue('bs-bt-calc-derived-progress', 0),
    passedDays: numberValue('bs-bt-calc-derived-days', 0),
    gestationModifierMultiplier: 1,
  };
  const result = calculateDerivedInheritancePreview(options);
  const direction = result.direction > 0 ? '母方（正轴）' : result.direction < 0 ? '父方（负轴）' : '无可推进来源';
  const threshold = result.wholeDaysToInherit === null
    ? '无法抵达（缺少对应衍生来源或当前速度为 0）'
    : `约第 ${result.wholeDaysToInherit} 个完整日严格越线（数学判定点 ${formatNumber(result.exactDaysToThreshold, 3)} 天）`;
  const speciesSpeed = getMergedRacePhysiologyProfile(options.fetusRace)?.gestationSpeciesSpeed ?? 1;
  setOutput('bs-bt-calc-derived-output', [
    `推进方向：${direction}${result.activeDerivedType ? `「${result.activeDerivedType}」` : ''}`,
    `胎儿种族妊娠速度：×${formatNumber(speciesSpeed, 3)}　每日遗传轴变化：${result.dailyDelta >= 0 ? '+' : ''}${formatNumber(result.dailyDelta, 4)}`,
    `经过 ${formatNumber(options.passedDays)} 天：${formatNumber(result.currentProgress, 3)} → ${formatNumber(result.nextProgress, 3)}`,
    `越过 ±75：${threshold}`,
    result.inheritedType ? `按当前经过天数，分娩时会遗传：${result.inheritedType}` : '按当前经过天数，尚未形成可判定的衍生遗传。',
  ]);
}

function bindEvents(root) {
  if (root.dataset.calculatorBound === 'true') return;
  root.dataset.calculatorBound = 'true';
  document.querySelectorAll('#bs-bt-calculator-tabs [data-calculator-tab]').forEach((button) => {
    button.addEventListener('click', () => setCalculatorTab(button.dataset.calculatorTab));
  });
  document.getElementById('bs-bt-calc-sperm-add')?.addEventListener('click', () => addSpermRow());
  document.getElementById('bs-bt-calc-sperm-list')?.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('[data-calc-sperm-remove]') : null;
    if (!button) return;
    button.closest('.bs-bt-calculator-sperm-row')?.remove();
    renumberSpermRows();
  });
  document.getElementById('bs-bt-calc-fert-run')?.addEventListener('click', calculateFertilization);
  document.getElementById('bs-bt-calc-offspring-run')?.addEventListener('click', calculateOffspring);
  document.getElementById('bs-bt-calc-derived-seed')?.addEventListener('click', applyDerivedSeed);
  document.getElementById('bs-bt-calc-derived-run')?.addEventListener('click', calculateDerived);
}

export function initializeCalculatorUi() {
  const root = document.querySelector('[data-encyclopedia-page="calculator"]');
  if (!(root instanceof HTMLElement)) return;
  populateStaticSelects();
  if (!document.querySelector('#bs-bt-calc-sperm-list .bs-bt-calculator-sperm-row')) addSpermRow();
  bindEvents(root);
  setCalculatorTab(
    document.querySelector('#bs-bt-calculator-tabs .is-active')?.dataset?.calculatorTab || 'fertilization',
  );
}
