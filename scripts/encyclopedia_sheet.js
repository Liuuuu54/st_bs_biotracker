// 百科资料卡（物种与衍生）的 HTML：给人看的排版，不是提示词。数值与白话句子来自 rules.js 的 buildRaceEncyclopediaView。
import { buildGrowthChartSvg } from './growth_chart.js';
import { buildRaceEncyclopediaView, getEmbryoTypeReferenceText } from './prompts/rules.js';
import { raceIconSvg } from './race_icons.js';
import { OUTLET_LAYOUT_LABELS, getRaceCanalTexture, getRaceOutletLayout, getRaceOutletOptions, getRaceSwordSuggestion } from './race_config.js';
import { describeOutletLook } from './outlet_look.js';
import { describeSwordTraits } from './sires.js';
import { getPouchDefault } from './belly_pouch.js';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 一行白话的说明；多行的（Flux 描述：总述、[平衡]、[正极]、[负极]）逐行分开，方括号标签做成粗体小标，
 * 免得整段挤成一堵字墙
 */
function renderNoteHtml(note) {
  const lines = String(note || '').split(/\n+/).map((line) => line.trim()).filter(Boolean);
  if (lines.length <= 1) return `<small class="bs-bt-sheet-note">${escapeHtml(lines[0] || '')}</small>`;
  return `<small class="bs-bt-sheet-note bs-bt-sheet-note--lines">${lines.map((line) => {
    const tagged = line.match(/^\[([^\]]{1,8})\]\s*(.*)$/);
    return tagged
      ? `<span class="bs-bt-sheet-note-line"><b class="bs-bt-sheet-note-tag">${escapeHtml(tagged[1])}</b>${escapeHtml(tagged[2])}</span>`
      : `<span class="bs-bt-sheet-note-line">${escapeHtml(line)}</span>`;
  }).join('')}</small>`;
}

/** 百科资料卡：标题列（图示、名称、标签）、短敘述、分组的「栏名／数值／一行白话」，另可附折叠段落 */
export function renderSheetHtml({ title, icon = '', tags = [], introduction = '', sections = [], extra = '' }) {
  const rowHtml = (row) => `
      <div class="bs-bt-sheet-row">
        <span class="bs-bt-sheet-label">${escapeHtml(row.label)}</span>
        <span class="bs-bt-sheet-value">${escapeHtml(row.value)}</span>
        ${row.note ? renderNoteHtml(row.note) : ''}
        ${row.chartHtml || ''}
      </div>`;
  return `
    <div class="bs-bt-sheet-head">
      ${icon ? `<span class="bs-bt-sheet-icon" aria-hidden="true">${icon}</span>` : ''}
      <div class="bs-bt-sheet-heading">
        <div class="bs-bt-sheet-title">${escapeHtml(title)}</div>
        <div class="bs-bt-sheet-tags">${tags.map((tag) => `<span class="bs-bt-sheet-tag">${escapeHtml(tag)}</span>`).join('')}</div>
      </div>
    </div>
    ${introduction ? `<p class="bs-bt-sheet-intro">${escapeHtml(introduction)}</p>` : ''}
    ${sections.map((section) => `
    <details class="bs-bt-track-section bs-bt-sheet-section bs-bt-sheet-fold">
      <summary class="bs-bt-track-section-title">${escapeHtml(section.title)}</summary>
      ${section.rows.map(rowHtml).join('')}
    </details>`).join('')}
    ${extra}`;
}

// 外口布局写成百科的说法（这一族本来长什么样，不讲系统怎么用）
const LAYOUT_LORE = Object.freeze({
  separate: '阴道、尿道与肛门各自分开，与人类相同。',
  cloaca: '泄殖腔：排泄与生殖共用一个外口，没有独立的肛门。',
  tube: '产道末端延伸成一根管，交配与生产都经过管口；肛门另外分开。',
});
const VARIANT_LORE = Object.freeze({
  separate: '下身化为人形的个体，外口与人类一样分开。',
  cloaca: '以鸟、爬虫或虫的真身示人时，外口是泄殖腔。',
  tube: '带产卵管的个体，产道末端是一根管。',
});

/**
 * 生殖器（1.6.0）：这一族的外口、外观、产道、雄性的剑与育儿袋，照外阴分页与子宫剖面用的同一份种族表写成百科的说法。
 */
export function buildGenitalSection(race) {
  const options = getRaceOutletOptions(race);
  const layout = options[0];
  const variants = options.slice(1).map((value) => VARIANT_LORE[value]).filter(Boolean);
  const look = describeOutletLook({ race });
  const texture = getRaceCanalTexture(race);
  const sword = describeSwordTraits(getRaceSwordSuggestion(race));
  const rows = [
    { label: '外口', value: OUTLET_LAYOUT_LABELS[layout], note: [LAYOUT_LORE[layout], ...variants].join('') },
    ...(look ? [{ label: '外观', value: `${look}。` }] : []),
    { label: '产道', value: texture ? texture.replace(/（.*）$/, '') : '血肉', note: texture ? `内壁是${texture.replace(/^[^（]*（|）$/g, '')}，不是湿热的肉壁。` : '内壁是柔软的肉褶。' },
    { label: '雄性', value: sword ? `${sword}。` : '与人类相仿。' },
    ...(getPouchDefault(race) === 'on' ? [{ label: '育儿袋', value: '有', note: '雌性下腹有一道袋口，幼体出生后在袋里长大，到能离袋为止。' }] : []),
  ];
  return { title: '生殖器', rows };
}

/** 物种资料卡；生长型那一栏附胎量曲线，胚型的长篇设定收在折叠段落 */
export function renderRaceSheetHtml(race) {
  const view = buildRaceEncyclopediaView(race);
  if (!view) return `<p class="bs-bt-sheet-intro">${escapeHtml(race)}：暂无资料。</p>`;
  const lore = getEmbryoTypeReferenceText(view.embryoType).split('\n').filter(Boolean);
  const loreHtml = lore.length > 0 ? `
    <details class="bs-bt-track-section bs-bt-sheet-section bs-bt-sheet-fold bs-bt-sheet-lore">
      <summary class="bs-bt-track-section-title">胚型设定：${escapeHtml(view.embryoType)}</summary>
      ${lore.slice(1).map((line) => `<p>${escapeHtml(line.replace(/^-/, ''))}</p>`).join('')}
    </details>` : '';
  return renderSheetHtml({
    title: race,
    icon: raceIconSvg({ race }),
    tags: view.tags,
    introduction: view.introduction,
    sections: view.sections.map((section) => ({
      ...section,
      rows: section.rows.map((row) => (row.chart === 'growth'
        ? { ...row, chartHtml: `<div class="bs-bt-sheet-chart">${buildGrowthChartSvg(view.growthShape)}<small class="bs-bt-sheet-note">实线是这一族，虚线是人类型；横线是足月的胎量。</small></div>` }
        : row)),
    })).concat([buildGenitalSection(race)]),
    extra: loreHtml,
  });
}
