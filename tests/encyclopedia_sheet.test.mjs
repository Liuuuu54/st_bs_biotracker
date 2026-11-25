// 1.4.1 百科资料卡：分组的栏位、生长型附曲线、胚型设定收折，内容经过跳脱。
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildRaceEncyclopediaView } from '../scripts/prompts/rules.js';
import { renderRaceSheetHtml, renderSheetHtml } from '../scripts/encyclopedia_sheet.js';
import { buildGrowthChartSvg, buildGrowthThumbSvg } from '../scripts/growth_chart.js';
import { FETAL_GROWTH_SHAPES } from '../scripts/fetal_growth.js';

test('物种资料：标签、五组栏位，数值短、白话另一行', () => {
  const view = buildRaceEncyclopediaView('玛坦戈');
  assert.deepEqual(view.tags, ['卵生', '晚成型', '雄核']);
  assert.deepEqual(view.sections.map((section) => section.title), ['周期与受孕', '妊娠', '分娩与恢复', '体型', '代谢']);
  // 代谢（1.5.4）：玛坦戈是光合／吸收型，不水栖、不独居
  assert.equal(view.sections.at(-1).rows.length, 1);
  const rows = Object.fromEntries(view.sections.flatMap((section) => section.rows).map((row) => [row.label, row]));
  assert.equal(rows.孕期.value, '约 93 天');
  assert.equal(rows.生长型.chart, 'growth');
  assert.equal(rows.伴生卵.value, '约 8 颗');
  assert.equal(rows.性别比.value, '雌雄同体');
  assert.equal(rows.代谢型.value, '光合／吸收');
  for (const row of Object.values(rows)) assert.ok(row.value.length <= 16, `${row.label}：${row.value}`);
  assert.deepEqual(buildRaceEncyclopediaView('人类').tags, ['胎生', '人类型'], '核型一般时不标');
  assert.equal(buildRaceEncyclopediaView('不存在的族'), null);
});

test('资料卡 HTML：附胎量曲线与胚型设定，文字经过跳脱', () => {
  const html = renderRaceSheetHtml('熊人族');
  assert.match(html, /bs-bt-growth-chart/);
  assert.match(html, /<details[^>]*bs-bt-sheet-lore/);
  assert.match(html, /胚型设定：胎生/);
  assert.match(html, /<svg/, '族谱图示');
  // 每一组都是折叠段落，预设收起
  assert.equal((html.match(/<details/g) || []).length, 6);
  assert.ok(!/<details[^>]* open/.test(html), '预设都不展开');
  const escaped = renderSheetHtml({ title: '<b>x</b>', tags: ['"q"'], sections: [{ title: 's', rows: [{ label: 'a', value: '<i>', note: '&' }] }] });
  assert.ok(!escaped.includes('<b>x</b>') && escaped.includes('&lt;b&gt;') && escaped.includes('&amp;'));
});

test('曲线图：每一型都画得出来，非人类型附人类型虚线对照', () => {
  for (const shape of FETAL_GROWTH_SHAPES) {
    const svg = buildGrowthChartSvg(shape);
    assert.match(svg, /bs-bt-growth-line/);
    assert.equal(svg.includes('bs-bt-growth-ref'), shape !== 'human');
    assert.ok(!/NaN/.test(svg) && !/NaN/.test(buildGrowthThumbSvg(shape)), shape);
  }
});
