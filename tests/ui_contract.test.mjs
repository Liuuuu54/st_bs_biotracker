import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

test('home grid and manual skill/wardrobe controls stay wired in markup and controller', async () => {
  const [html, controller, css] = await Promise.all([
    readFile(new URL('settings.html', root), 'utf8'),
    readFile(new URL('index.js', root), 'utf8'),
    readFile(new URL('style.css', root), 'utf8'),
  ]);
  const homeSection = html.match(/<section id="bs-bt-view-home"[\s\S]*?<\/section>/)?.[0] || '';
  const views = [...homeSection.matchAll(/data-nav-view="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(views, [
    'tracker-preset', 'worldbook-filter', 'register',
    'skill-catalog', 'track-list', 'wardrobe',
    'full-state', 'race-encyclopedia', 'theme',
  ]);
  for (const id of [
    'bs-bt-skill-catalog-list', 'bs-bt-skill-definition-detail', 'bs-bt-skill-detail-characters',
    'bs-bt-wardrobe-tabs', 'bs-bt-wardrobe-list', 'bs-bt-wardrobe-characters-page', 'bs-bt-wardrobe-add-page',
    'bs-bt-register-source', 'bs-bt-register-source-summary',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  const registerTabs = [...html.matchAll(/data-register-tab="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(registerTabs, ['inference', 'registry', 'wardrobe', 'diary', 'skills']);
  const registryPage = html.match(/data-register-page="registry"[\s\S]*?data-register-page="wardrobe"/)?.[0] || '';
  assert.match(registryPage, /id="bs-bt-register-custom-notes"/);
  assert.equal((html.match(/id="bs-bt-register-custom-notes"/g) || []).length, 1);
  assert.match(html, /id="bs-bt-register-skill-prompt"/);
  assert.doesNotMatch(html, /id="bs-bt-register-skill-config"/);
  assert.doesNotMatch(html, /id="bs-bt-register-skill-template"/);
  assert.doesNotMatch(html, /id="bs-bt-register-skill-apply"/);
  assert.match(html, /id="bs-bt-register-skill-generate"/);
  assert.match(html, /id="bs-bt-register-skill-write"/);
  assert.match(html, /id="bs-bt-register-skill-result"/);
  assert.doesNotMatch(html, /id="bs-bt-register-skill-load-child"/);
  assert.doesNotMatch(html, /用自然语言描述角色注册时应具备的技能与天赋/);
  assert.doesNotMatch(html, /选择已备装角色后，可直接调整衣物、当前穿着与穿着状态/);
  assert.deepEqual([...html.matchAll(/data-wardrobe-tab="([^"]+)"/g)].map((match) => match[1]), ['characters', 'add']);
  assert.match(controller, /skillPrompt/);
  assert.match(controller.slice(0, 500), /applyInitialSkillTalentConfig/);
  assert.doesNotMatch(controller, />查看<\/button>/);
  assert.doesNotMatch(controller, /data-character-skill-save/);
  assert.doesNotMatch(controller, /data-character-skill-remove/);
  assert.doesNotMatch(controller, /data-skill-history-save/);
  assert.doesNotMatch(controller, /data-skill-history-remove/);
  assert.match(controller, /profile\.skillHistory/);
  assert.match(controller, /技能 history Lv/);
  assert.match(controller, /manual_character_skill_auto_update/);
  assert.match(controller, /icons\.dataset\.tooltip = tooltipText/);
  assert.match(controller, /icons\.removeAttribute\('title'\)/);
  assert.match(html, /id="bs-bt-status-icons"[^>]*tabindex="0"/);
  assert.match(css, /\.bs-bt-status-icons::after/);
  assert.match(css, /\.bs-bt-status-icons:focus-visible::after/);
  assert.match(controller, /data-skill-definition-delete/);
  assert.match(controller, /class="bs-bt-wardrobe-row-delete"/);
  assert.match(controller, /id="bs-bt-wardrobe-item-character"/);
  assert.match(controller, /id="bs-bt-wardrobe-item-layer-field"[\s\S]*?data-wardrobe-type-field="accessory" hidden/);
  assert.match(controller, /id="bs-bt-wardrobe-item-parts-field"[\s\S]*?data-wardrobe-type-field="main"/);
  assert.match(controller, /function updateWardrobeAddTypeFields\(\)/);
  assert.match(controller, /function renderFetalTalentDebugEditor\(/);
  assert.match(controller, /function renderTrackDebug\(viewModel, fetalTalentHtml = ''\)/);
  assert.match(controller, /胎儿自主活动调试[\s\S]*?\$\{fetalTalentHtml\}[\s\S]*?妊娠变速效果/);
  assert.match(controller, /function applyFetalTalentDebugChange\(/);
  assert.match(controller, /data-fetal-talent-save/);
  assert.match(controller, /data-fetal-talent-delete/);
  assert.match(controller, /manual_fetal_talent_update/);
  assert.match(controller, /manual_fetal_talent_delete/);
  assert.match(controller, /function renderRegisterChildSourceOptions\(/);
  assert.match(controller, /function syncRegisterChildSourceFields\(/);
  assert.match(controller, /sourceChild/);
  assert.doesNotMatch(controller, /data-wardrobe-item-edit/);
  assert.doesNotMatch(controller, /data-wardrobe-item-new/);
  assert.doesNotMatch(html, /id="bs-bt-skill-definition-delete-select"/);
  assert.doesNotMatch(html, /id="bs-bt-skill-definition-delete"/);
  assert.match(css, /#bs-bt-skill-catalog-overview\[hidden\][\s\S]*?display:\s*none/);
  assert.match(css, /#bs-bt-wardrobe-add-page\[hidden\][\s\S]*?display:\s*none/);
  for (const action of [
    'data-skill-definition-open',
    'data-wardrobe-initialize', 'data-wardrobe-item-save', 'data-wardrobe-item-delete', 'data-wardrobe-outfit-apply',
  ]) {
    assert.match(controller, new RegExp(action));
  }
});
