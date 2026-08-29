// 契约测试：技能区块一次列出全部技能，而不是走一次只显示一张卡的轮播；
// 左右切换按钮改为直接读 data-card-count，避免漏掉某个 kind 时静默失效。
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [controller, css] = await Promise.all([
  readFile(new URL('../index.js', import.meta.url), 'utf8'),
  readFile(new URL('../style.css', import.meta.url), 'utf8'),
]);

test('skills render as a wrapping tile grid instead of a single-card carousel', () => {
  assert.match(controller, /function renderTrackSkillSection\(viewModel\)/);
  assert.ok(controller.includes('${renderTrackSkillSection(viewModel)}'), '经历页必须调用技能方格墙');
  assert.doesNotMatch(controller, /renderCardCarouselSection\(\s*'技能'/, '技能不应再走轮播');

  const section = controller.match(/function renderTrackSkillSection\(viewModel\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(section, /skills\.map\(/, '必须遍历全部技能');
  assert.match(section, /renderTrackTitle\('技能'\)/, '标题只保留「技能」两个字，不带数量角标');
  assert.match(section, /bs-bt-skill-grid/);
  assert.match(section, /当前无技能记录/);
  // 天赋是右上角的楔形角标，不再是技能名后面的整段标签、也不是数字
  assert.match(section, /renderTalentChevrons\(talentLevel\)/);
  assert.doesNotMatch(section, /bs-bt-track-talent-tag/);
  assert.doesNotMatch(section, /talentLevel > 0 \? '\+' : '−'/, '天赋不再写成 +N／−N');
  // 经验只体现在填色上，格子里不直接列出 exp 数字
  assert.doesNotMatch(section, /bs-bt-skill-tile-exp/);
  // 不挂 title：原生气泡会从复古机身里弹出来，破坏沉浸感
  assert.doesNotMatch(section, /title="/, '技能格不应有原生 tooltip');
});

test('talent renders as a military-style chevron stack', () => {
  const chevrons = controller.match(/function renderTalentChevrons\(talentLevel\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.ok(chevrons.length > 0, '找不到楔形角标渲染函数');
  // 楔形数量 = 等级绝对值，朝向 = 正负
  assert.match(chevrons, /const count = Math\.abs\(level\)/);
  assert.match(chevrons, /const pointsUp = level > 0/);
  assert.match(chevrons, /for \(let index = 0; index < count; index \+= 1\)/);
  assert.match(chevrons, /is-positive.*is-negative|pointsUp \? 'is-positive' : 'is-negative'/);
  // 等级必须夹在 ±TALENT_MAX_LEVEL，不能让脏数据画出一长串楔形
  assert.match(chevrons, /Math\.max\(-TALENT_MAX_LEVEL, Math\.min\(TALENT_MAX_LEVEL/);
  // 天赋为 0 不画角标
  assert.match(chevrons, /if \(!level\) return ''/);
});

test('the level numeral doubles as the exp meter', () => {
  assert.match(controller, /const SKILL_ROMAN_NUMERALS = \['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'\]/);
  const numeral = controller.match(/function formatSkillLevelNumeral\(level\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(numeral, /SKILL_ROMAN_NUMERALS\[value\] \|\| String\(value\)/, '超出罗马数字表要退回阿拉伯数字');

  const svg = controller.match(/function renderSkillLevelNumeral\(numeral, fillPercent, uniqueKey\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(svg, /clipPath id="\$\{escapeHtml\(clipId\)\}"/, '填色靠 clipPath 裁出底部比例');
  assert.match(svg, /y="\$\{60 - fillHeight\}"/, '填色从底部往上长');
  assert.match(svg, /bs-bt-skill-numeral-base/);
  assert.match(svg, /bs-bt-skill-numeral-fill/);
  // clipPath id 必须带上索引与 skillId，否则同页多格会互相串用
  assert.match(controller, /const uniqueKey = `\$\{index\}-\$\{Number\(item\?\.skillId\) \|\| 0\}`/);
});

test('card carousel arrows read their own count instead of remapping by kind', () => {
  const handler = controller.match(/data-card-nav\]'\)\.forEach\([\s\S]*?\n {2}\);/)?.[0] || '';
  assert.ok(handler.length > 0, '找不到轮播按钮处理器');
  assert.match(handler, /data-card-count/);
  // 旧写法按 kind 逐一映射回 viewModel，漏了 skills 就整组失效
  assert.doesNotMatch(handler, /kind === '(sperms|fetuses|children|diary|skills)'/);
});

test('the skill tile grid has its own styling', () => {
  for (const selector of [
    '.bs-bt-skill-grid',
    '.bs-bt-skill-tile',
    '.bs-bt-skill-tile-talent',
    '.bs-bt-skill-tile-numeral',
    '.bs-bt-skill-numeral-base',
    '.bs-bt-skill-numeral-fill',
    '.bs-bt-skill-tile-name',
  ]) {
    assert.ok(css.includes(`#bs-biotracker-settings ${selector} {`), `${selector} 缺少样式`);
  }
  // 一行三格，格子多时列表内部滚动，不撑开整个手机屏
  assert.match(css, /\.bs-bt-skill-grid \{[\s\S]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)[\s\S]*?max-height:[\s\S]*?overflow-y: auto/);
  assert.ok(css.includes('#bs-biotracker-settings .bs-bt-skill-tile-numeral text {'), '罗马数字缺少文字规则');
});

test('numerals follow each theme font instead of being forced to serif', () => {
  // 不再维护「有衬线／无衬线」主题名单，也不再写死字体
  assert.doesNotMatch(css, /--bsbt-font-numeral/, '不应再有独立的数字字体变量');
  const rule = css.match(/\.bs-bt-skill-tile-numeral text \{[\s\S]*?\n\}/)?.[0] || '';
  assert.ok(rule.length > 0, '找不到罗马数字的文字规则');
  assert.doesNotMatch(rule, /font-family/, '数字字体应直接继承主题');

  // 无衬线主题的大写 I 是光杆竖线，靠字距拉开才分得出 II 与 III。
  // 必须用 em：fitSkillNumerals 改 font-size 时字距要跟着缩放。
  assert.match(rule, /letter-spacing: 0\.16em/);
});

test('numerals are auto-fitted to the tile after render', () => {
  const fit = controller.match(/function fitSkillNumerals\(root\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.ok(fit.length > 0, '找不到自动缩放函数');
  // 宽高都要收进 viewBox，取较小的缩放比
  assert.match(fit, /Math\.min\(SKILL_NUMERAL_FIT_WIDTH \/ box\.width, SKILL_NUMERAL_FIT_HEIGHT \/ box\.height\)/);
  // 缩放后要重新水平居中：字距会在末字后留一份空隙
  assert.match(fit, /const nextX = 50 \+ \(50 - \(fitted\.x \+ fitted\.width \/ 2\)\)/);
  // 元素不可见时 getBBox 量不到，必须安全跳过而不是抛错
  assert.match(fit, /try \{[\s\S]*?getBBox\(\)[\s\S]*?\} catch \{[\s\S]*?return;/);

  // 渲染后与打开面板时都要跑一次（面板隐藏时量不到）
  // \r?\n：Windows 上 checkout 会把工作区转成 CRLF，裸写 \n 会匹配不到
  assert.match(controller, /content\.innerHTML = renderTrackCharacterContent\(viewModel\);\r?\n\s*fitSkillNumerals\(content\);/);
  assert.match(controller, /ensureModalPosition\(modal\);[\s\S]{0,120}fitSkillNumerals\(modal\);/);
});

test('talent range is narrowed to +/-5 everywhere', async () => {
  const skillConfig = await readFile(new URL('../scripts/skill_config.js', import.meta.url), 'utf8');
  const registry = await readFile(new URL('../scripts/registry.js', import.meta.url), 'utf8');
  const trackerPrompt = await readFile(new URL('../scripts/tracker_prompt_context.js', import.meta.url), 'utf8');

  assert.match(skillConfig, /export const TALENT_MAX_LEVEL = 5;/);
  // 技能仍是 10 级，只收窄天赋
  assert.match(skillConfig, /export const SKILL_MAX_LEVEL = 10;/);

  // 提示词与注册说明必须同步，否则 LLM 会继续按 +/-10 输出
  assert.match(trackerPrompt, /最高 ±Lv5/);
  assert.match(registry, /天赋 level 为 -5 到 5/);

  // UI 与校验不能再硬编码 10
  assert.doesNotMatch(controller, /level < -10 \|\| level > 10/);
  assert.match(controller, /level < -TALENT_MAX_LEVEL \|\| level > TALENT_MAX_LEVEL/);
  assert.match(controller, /Math\.abs\(Number\(talent\?\.level\)\) >= TALENT_MAX_LEVEL/);
});
