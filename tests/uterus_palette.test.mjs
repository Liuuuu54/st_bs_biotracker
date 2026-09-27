// 子宫图配色：各主题依创作背景有专属配色；仿真与废土是单色萤幕，走主题代表色的单色调；iPhone 维持肉色写实。
import assert from 'node:assert/strict';
import test from 'node:test';

import { getUterusPalette } from '../scripts/uterus_render.js';

const rgb = (hex) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
const sum = (hex) => rgb(hex).reduce((a, v) => a + v, 0);
const THEMES = {
  retro: { name: 'retro', screen: '#87a96b', text: '#212526', border: '#1a1a1a' },
  wasteland: { name: 'wasteland', screen: '#0d120a', text: '#18ff62', border: '#3d4421' },
  cultivation: { name: 'cultivation', screen: '#e0f2f1', text: '#004d40', border: '#00695c' },
  'cyber-egypt': { name: 'cyber-egypt', screen: '#00f2ff', text: '#002b2b', border: '#002b2b' },
  sakura: { name: 'sakura', screen: '#ffffff', text: '#c2185b', border: '#f8bbd0' },
  gothic: { name: 'gothic', screen: '#1a1016', text: '#e8d8cf', border: '#8f3f4b' },
  ink: { name: 'ink', screen: 'rgba(243, 234, 216, 0.82)', text: '#1f2522', border: 'rgba(31, 37, 34, 0.42)' },
  iphone: { name: 'iphone', screen: '#ffffff', text: '#1c1c1e', border: 'rgba(60, 60, 67, 0.20)' },
};

test('单色萤幕的主题（仿真、废土）整张换成代表色的单色调', () => {
  for (const name of ['retro', 'wasteland']) {
    const palette = getUterusPalette(THEMES[name]);
    for (const key of ['fetus', 'wall', 'cavity', 'egg']) {
      const [r, g, b] = rgb(palette[key]);
      assert.ok(g >= r && g >= b, `${name} ${key} ${palette[key]} 应以绿为主`);
    }
  }
});

test('专属配色依主题背景：修仙白玉胎儿配金膜、埃及金黄宫壁配青胎儿、哥特血红宫壁配红眼', () => {
  const jade = getUterusPalette(THEMES.cultivation);
  const [jr, jg, jb] = rgb(jade.wall);
  assert.ok(jg > jr && jg > jb, '修仙的宫壁是绿玉');
  assert.ok(sum(jade.fetus) > 650, '修仙的胎儿是白玉');
  const [mr, mg, mb] = rgb(jade.water);
  assert.ok(mr > mb && mg > mb, '修仙的膜是金色');

  const cyber = getUterusPalette(THEMES['cyber-egypt']);
  const [cr, cg, cb] = rgb(cyber.wall);
  assert.ok(cr > cb && cg > cb, '埃及的宫壁是金黄');
  const [fr, , fb] = rgb(cyber.fetus);
  assert.ok(fb > fr, '埃及的胎儿是青色');
  assert.notEqual(cyber.signal, cyber.wall, '警示色不撞宫壁');

  const gothic = getUterusPalette(THEMES.gothic);
  const [gr, gg, gb] = rgb(gothic.wall);
  assert.ok(gr > gg * 2 && gr > gb * 2, '哥特的宫壁是血红');
  const [er, eg] = rgb(gothic.ink);
  assert.ok(er > eg * 3, '哥特的眼睛是红的');
});

test('浅底主题（樱花、水墨）的背景是浅色；水墨开启笔触处理、警示用朱砂', () => {
  assert.ok(sum(getUterusPalette(THEMES.sakura).bg) > 700);
  const ink = getUterusPalette(THEMES.ink);
  assert.ok(sum(ink.bg) > 650 && sum(ink.wallDark) < 150);
  assert.equal(ink.brush, true);
  const [sr, sg, sb] = rgb(ink.signal);
  assert.ok(sr > sg * 2 && sr > sb * 2);
});

test('每个主题的胎儿都比宫腔跳得出来', () => {
  for (const theme of Object.values(THEMES)) {
    const palette = getUterusPalette(theme);
    assert.ok(Math.abs(sum(palette.fetus) - sum(palette.cavity)) > 90, `${theme.name} 胎儿与宫腔对比不足`);
  }
});

test('iPhone 维持肉色；认不得、近乎黑白的主题用灰阶；没给主题时是原本的深紫肉色', () => {
  const [r, g, b] = rgb(getUterusPalette(THEMES.iphone).fetus);
  assert.ok(r > g && g > b, 'iPhone 的胎儿是肉色');
  const [xr, xg, xb] = rgb(getUterusPalette({ name: 'unknown', screen: '#dddddd', text: '#222222', border: '#555555' }).fetus);
  assert.ok(Math.max(xr, xg, xb) - Math.min(xr, xg, xb) <= 6);
  assert.equal(getUterusPalette({}).fetus, '#f8ae96');
});
