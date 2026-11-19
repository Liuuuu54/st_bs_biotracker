// 胎儿生长型的小图：横轴是自身孕程（到足月后一小段逾期），纵轴是胎量（足月为 1）。
// 只用 currentColor 与透明度，跟着各主题的文字色走。百科物种页画大图，编辑器画六型缩图。

import { FETAL_GROWTH_SHAPE_LABELS, getFetalGrowth } from './fetal_growth.js';
import { DUE_DATE_DAYS, PREGNANCY_STAGE_DAYS } from './stage_config.js';

const MAX_T = 1.15;
const MAX_G = 1.2;

function curvePoints(shape, width, height, pad) {
  const points = [];
  for (let step = 0; step <= 92; step += 1) {
    const t = (MAX_T * step) / 92;
    const g = getFetalGrowth(t * DUE_DATE_DAYS, shape);
    const x = pad.left + (t / MAX_T) * (width - pad.left - pad.right);
    const y = height - pad.bottom - (Math.min(g, MAX_G) / MAX_G) * (height - pad.top - pad.bottom);
    points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return points.join(' ');
}

/** 大图：这一型实线、人类型虚线对照，标出孕早／孕中／孕晚与足月 */
export function buildGrowthChartSvg(shape, { title = '' } = {}) {
  const width = 280;
  const height = 132;
  const pad = { left: 8, right: 8, top: 10, bottom: 22 };
  const xAt = (days) => pad.left + (days / DUE_DATE_DAYS / MAX_T) * (width - pad.left - pad.right);
  const yAt = (g) => height - pad.bottom - (g / MAX_G) * (height - pad.top - pad.bottom);
  const midStart = PREGNANCY_STAGE_DAYS.孕早期;
  const lateStart = midStart + PREGNANCY_STAGE_DAYS.孕中期;
  const label = (x, text) => `<text x="${x.toFixed(1)}" y="${height - 6}" text-anchor="middle">${text}</text>`;
  const human = shape === 'human' ? '' : `<polyline class="bs-bt-growth-ref" points="${curvePoints('human', width, height, pad)}"/>`;
  return `<svg class="bs-bt-growth-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${title || FETAL_GROWTH_SHAPE_LABELS[shape] || ''}胎量曲线">
  <line class="bs-bt-growth-axis" x1="${pad.left}" y1="${yAt(0)}" x2="${width - pad.right}" y2="${yAt(0)}"/>
  <line class="bs-bt-growth-grid" x1="${xAt(midStart).toFixed(1)}" y1="${pad.top}" x2="${xAt(midStart).toFixed(1)}" y2="${yAt(0)}"/>
  <line class="bs-bt-growth-grid" x1="${xAt(lateStart).toFixed(1)}" y1="${pad.top}" x2="${xAt(lateStart).toFixed(1)}" y2="${yAt(0)}"/>
  <line class="bs-bt-growth-term" x1="${xAt(DUE_DATE_DAYS).toFixed(1)}" y1="${pad.top}" x2="${xAt(DUE_DATE_DAYS).toFixed(1)}" y2="${yAt(0)}"/>
  <line class="bs-bt-growth-grid" x1="${pad.left}" y1="${yAt(1).toFixed(1)}" x2="${width - pad.right}" y2="${yAt(1).toFixed(1)}"/>
  ${human}
  <polyline class="bs-bt-growth-line" points="${curvePoints(shape, width, height, pad)}"/>
  ${label(xAt(midStart / 2), '孕早')}${label(xAt((midStart + lateStart) / 2), '孕中')}${label(xAt((lateStart + DUE_DATE_DAYS) / 2), '孕晚')}${label(xAt(DUE_DATE_DAYS), '足月')}
</svg>`;
}

/** 缩图：只有曲线与足月线，给编辑器的六型选择用 */
export function buildGrowthThumbSvg(shape) {
  const width = 64;
  const height = 34;
  const pad = { left: 3, right: 3, top: 3, bottom: 3 };
  const termX = pad.left + (1 / MAX_T) * (width - pad.left - pad.right);
  return `<svg class="bs-bt-growth-thumb-svg" viewBox="0 0 ${width} ${height}" aria-hidden="true">
  <line class="bs-bt-growth-term" x1="${termX.toFixed(1)}" y1="${pad.top}" x2="${termX.toFixed(1)}" y2="${height - pad.bottom}"/>
  <polyline class="bs-bt-growth-line" points="${curvePoints(shape, width, height, pad)}"/>
</svg>`;
}
