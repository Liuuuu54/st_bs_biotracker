// v1.1.5 real native-host checks using temporary config/data and a workspace plugin junction; no model is called.
// Usage: node tests/check-v115-host.mjs D:/SillyTavern sillytavern
//        node tests/check-v115-host.mjs D:/Luker luker
// Covers: schema 7 → 8 description migration (live state and floor snapshots) through a real save/reload,
// tracker payload description objects and stale-field naming, encyclopedia body size / body plan fields and the
// short-description catalog preview, track-page body size row and description update-age tooltips,
// lineage stranger fathers with father body size, and no placeholder-key shells.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

const hostRoot = resolve(process.argv[2] || '');
const kind = process.argv[3];
if (!['sillytavern', 'luker'].includes(kind) || !process.argv[2]) throw Error('Provide an installed host root and kind');
const root = fileURLToPath(new URL('../', import.meta.url));
const artifacts = mkdtempSync(join(tmpdir(), 'biotracker-v115-' + kind + '-'));
const dataRoot = join(artifacts, 'data');
const extensionRoot = join(dataRoot, 'default-user', 'extensions');
mkdirSync(extensionRoot, { recursive: true });
const extensionName = 'st_bs_biotracker_v115_test';
const base = '/scripts/extensions/third-party/' + extensionName;
symlinkSync(root, join(extensionRoot, extensionName), 'junction');
const defaults = JSON.parse(readFileSync(join(hostRoot, 'default/content/settings.json'), 'utf8'));
defaults.firstRun = false;
defaults.extension_settings ||= {};
defaults.extension_settings.disabledExtensions = readdirSync(join(hostRoot, 'public/scripts/extensions/third-party')).map(name => 'third-party/' + name);
writeFileSync(join(dataRoot, 'default-user', 'settings.json'), JSON.stringify(defaults));
const socket = createServer(); await new Promise(ok => socket.listen(0, '127.0.0.1', ok));
const port = socket.address().port; await new Promise(ok => socket.close(ok));
const configPath = join(artifacts, 'config.yaml');
writeFileSync(configPath, `dataRoot: ${JSON.stringify(dataRoot.replaceAll('\\', '/'))}\nport: ${port}\nlisten: false\nenableIPv6: false\nenableIPv4: true\nenableUserAccounts: false\nbasicAuthMode: false\nenableServerPlugins: false\nextensions:\n  enabled: true\n  autoUpdate: false\n  models:\n    autoDownload: false\n`);
const server = spawn(process.execPath, ['server.js', '--configPath', configPath, '--dataRoot', dataRoot, '--port', String(port), '--browserLaunchEnabled', 'false', '--listen', 'false'], { cwd: hostRoot, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', value => { serverLog += value; }); server.stderr.on('data', value => { serverLog += value; });
let browser, ws, sequence = 0; const pending = new Map(); const exceptions = [];
const rpc = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }));
  setTimeout(() => { if (pending.delete(id)) reject(Error('Timeout ' + method)); }, 30000).unref();
});
async function evaluate(expression) {
  const r = await rpc('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function expect(expression, label, tries = 300) {
  for (let i = 0; i < tries; i++) { try { if (await evaluate(expression)) return; } catch {} await sleep(100); }
  throw Error(label);
}
async function screenshot(name) {
  const { data } = await rpc('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(artifacts, name), Buffer.from(data, 'base64'));
}
const CARD = 'BS115验收';
// Shared page helpers, re-installed after each navigation
const PRELUDE = `
  window.__v115 = {
    ctx: () => (globalThis.Luker || globalThis.SillyTavern).getContext(),
    assert: (condition, message) => { if (!condition) throw Error(message); },
    wait: (ms = 300) => new Promise(ok => setTimeout(ok, ms)),
    async mods() {
      return {
        s: await import('${base}/scripts/state.js'),
        r: await import('${base}/scripts/registry.js'),
        rc: await import('${base}/scripts/race_config.js'),
        t: await import('${base}/scripts/tracker.js'),
      };
    },
    async openCard(chatId = sessionStorage.getItem('v115-chat')) {
      const ctx = this.ctx();
      await ctx.getCharacters();
      const id = ctx.characters.findIndex(card => card.name === '${CARD}');
      this.assert(id >= 0, 'Test card not listed');
      await ctx.selectCharacterById(id);
      const host = await import('${base}/scripts/host.js');
      for (let i = 0; i < 100 && (!host.getHostChatId(this.ctx()) || host.isPlaceholderHostChatId(this.ctx())); i++) await new Promise(ok => setTimeout(ok, 100));
      this.assert(!host.isPlaceholderHostChatId(this.ctx()), 'Chat id never resolved');
      if (chatId && this.ctx().getCurrentChatId() !== chatId) {
        await this.ctx().openCharacterChat(chatId);
        for (let i = 0; i < 100 && this.ctx().getCurrentChatId() !== chatId; i++) await new Promise(ok => setTimeout(ok, 100));
      }
      this.assert(!chatId || this.ctx().getCurrentChatId() === chatId, 'Could not reopen chat ' + chatId);
      sessionStorage.setItem('v115-chat', this.ctx().getCurrentChatId());
      const { s } = await this.mods();
      await s.hydrateChatStateFromHost(this.ctx(), s.getSettings(this.ctx()));
      return id;
    },
    async openPanel(view) {
      const modal = document.querySelector('#bs-biotracker-modal');
      if (!modal.classList.contains('is-open')) document.querySelector('#bs-biotracker-menu-item').click();
      for (let i = 0; i < 100 && !modal.classList.contains('is-open'); i++) await new Promise(ok => setTimeout(ok, 50));
      this.assert(modal.classList.contains('is-open'), 'Panel did not open');
      document.querySelector('[data-nav-view="' + view + '"]').click();
      await new Promise(ok => setTimeout(ok, 300));
    },
    async openTrack(name, tab) {
      await this.openPanel('track-list');
      const button = [...document.querySelectorAll('.bs-bt-track-character-button')].find(b => b.textContent.includes(name));
      this.assert(button, name + ' not listed'); button.click(); await this.wait(400);
      if (tab) { document.querySelector('[data-track-tab="' + tab + '"]').click(); await this.wait(300); }
    },
  };
  true`;
async function boot() {
  await expect("!!document.querySelector('#bs-biotracker-modal') && !!document.querySelector('#bs-biotracker-menu-item') && !!(globalThis.Luker||globalThis.SillyTavern)?.getContext", 'Workspace plugin did not mount', 600);
  await evaluate(PRELUDE);
}
async function reload() {
  await rpc('Page.reload', { ignoreCache: true });
  await sleep(1500);
  await boot();
  await evaluate('__v115.openCard()');
  await sleep(500);
}

const results = {};
try {
  let ready = false;
  for (let i = 0; i < 1200; i++) {
    if (server.exitCode !== null) throw Error('Host exited during startup');
    try { ready = (await fetch('http://127.0.0.1:' + port + '/')).ok; } catch {}
    if (ready) break; await sleep(100);
  }
  if (!ready) throw Error('Host startup timed out');
  const profile = join(artifacts, 'browser');
  browser = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--no-first-run', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let browserPort;
  for (let i = 0; i < 80; i++) { try { browserPort = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; break; } catch {} await sleep(100); }
  if (!browserPort) throw Error('Browser startup timed out');
  const targets = await (await fetch(`http://127.0.0.1:${browserPort}/json/list`)).json();
  ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((ok, fail) => { ws.addEventListener('open', ok, { once: true }); ws.addEventListener('error', fail, { once: true }); });
  ws.addEventListener('message', event => {
    const m = JSON.parse(event.data);
    if (pending.has(m.id)) { const task = pending.get(m.id); pending.delete(m.id); m.error ? task.reject(Error('CDP failed: ' + JSON.stringify(m.error))) : task.resolve(m.result); }
    else if (m.method === 'Runtime.exceptionThrown') exceptions.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text);
  });
  await rpc('Runtime.enable'); await rpc('Page.enable');
  await rpc('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });
  await rpc('Page.navigate', { url: `http://127.0.0.1:${port}/` });
  await boot();

  // 0. Source identity and card import
  results.source = await evaluate(`(async()=>{
    const { ctx, assert } = __v115;
    const extensionModule = await import('/scripts/extensions.js');
    assert(extensionModule.extensionTypes['third-party/${extensionName}'] === 'local', 'Workspace extension must take precedence');
    const source = await (await fetch('${base}/index.js')).text();
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source)))).map(n => n.toString(16).padStart(2, '0')).join('');
    const card = { spec: 'chara_card_v2', spec_version: '2.0', data: { name: '${CARD}', description: '临时验收角色。', personality: '', scenario: '', first_mes: '验收开始。', mes_example: '', creator_notes: '', system_prompt: '', post_history_instructions: '', alternate_greetings: [], tags: [], creator: 'test', character_version: '1.1.5', extensions: {} } };
    const form = new FormData(); form.set('file_type', 'json'); form.set('avatar', new File([JSON.stringify(card)], 'fixture.json', { type: 'application/json' }));
    const headers = { ...ctx().getRequestHeaders() }; delete headers['Content-Type']; delete headers['content-type'];
    const response = await fetch('/api/characters/import', { method: 'POST', headers, body: form });
    assert(response.ok, 'Card import failed');
    await __v115.openCard();
    // Luker 新聊天要先落盘，重载才会回到同一个聊天
    await ctx().saveChat?.();
    return { hash };
  })()`);
  const expectedHash = createHash('sha256').update(readFileSync(join(root, 'index.js'))).digest('hex');
  if (results.source.hash !== expectedHash) throw Error('Loaded source differs from workspace');
  results.source = { matchesWorkspace: true };

  // 1. Schema 7 save with string descriptions (live state and a floor snapshot) → migrated to 8 after a real reload
  results.seed = await evaluate(`(async()=>{
    const { ctx, mods } = __v115; const { s, r } = await mods();
    const chat = s.getChatState(ctx(), s.getSettings(ctx()));
    r.applyRegistryResult(chat, { name: '旧档描述', profile: { base: { race: '人类', age: 24, bodySize: 4.2 } } });
    const profile = chat.characters['旧档描述'].profile;
    profile.descriptions = { normalDescription: '状态|疲惫;;表情|皱眉|咬唇;;随手一段;;', pregnantDescription: '' };
    chat.minutesPassed = 4320;
    chat.schemaVersion = 7;
    s.recordChatStateSnapshot(ctx(), chat, { reason: 'v115-legacy' });
    s.saveSettings(ctx()); await s.saveSettingsNow(ctx());
    return { key: s.getChatKey(ctx()) };
  })()`);
  await reload();
  results.migration = await evaluate(`(async()=>{
    const { ctx, assert, mods } = __v115; const { s } = await mods();
    const chat = s.getChatState(ctx(), s.getSettings(ctx()));
    assert(chat.characters['旧档描述'], 'Seeded chat lost after reload');
    assert(chat.schemaVersion === 8, 'Schema not migrated: ' + chat.schemaVersion);
    const list = chat.characters['旧档描述'].profile.descriptions.normalDescription;
    assert(Array.isArray(list), 'Description is not a list: ' + JSON.stringify(list));
    const names = list.map(e => e.name).join('|');
    assert(names === '状态|表情|未分类', 'Unexpected fields: ' + names);
    assert(list[1].value === '皱眉|咬唇', 'Value with | was split: ' + list[1].value);
    assert(list.every(e => e.updatedAt === 4320), 'Migration timestamp not the chat clock');
    // 回溯楼层快照也必须是新结构
    const snapshot = chat.snapshots.find(item => item.reason === 'v115-legacy');
    assert(snapshot, 'Legacy snapshot missing');
    const probe = structuredClone(chat);
    s.restoreChatStateFromSnapshot(probe, snapshot);
    const restored = probe.characters['旧档描述'].profile.descriptions.normalDescription;
    assert(Array.isArray(restored) && restored[0].name === '状态', 'Snapshot not migrated: ' + JSON.stringify(restored));
    await s.saveSettingsNow(ctx());
    return { schema: chat.schemaVersion, fields: names, snapshotMigrated: true };
  })()`);
  await reload();
  results.migration.persistedAfterSecondReload = await evaluate(`(async()=>{
    const { ctx, mods } = __v115; const { s } = await mods();
    const chat = s.getChatState(ctx(), s.getSettings(ctx()));
    return chat.schemaVersion === 8 && Array.isArray(chat.characters['旧档描述'].profile.descriptions.normalDescription);
  })()`);
  if (!results.migration.persistedAfterSecondReload) throw Error('Migration did not persist');

  // 2. Tracker payload: descriptions as { name: value } objects and stale fields named after a day of game time
  results.trackerPayload = await evaluate(`(async()=>{
    const { ctx, assert, mods } = __v115; const { s, t } = await mods();
    const settings = s.getSettings(ctx());
    const chat = s.getChatState(ctx(), settings);
    chat.minutesPassed = 4320 + 1500;
    chat.characters['旧档描述'].profile.descriptions.normalDescription[1].updatedAt = 4320 + 1400;
    const payload = t.buildTrackerPayload(ctx(), settings, 'manual');
    const sent = payload.existing_state['旧档描述'].profile;
    assert(JSON.stringify(sent.descriptions.normalDescription) === JSON.stringify({ 状态: '疲惫', 表情: '皱眉|咬唇', 未分类: '随手一段' }), 'Sent descriptions: ' + JSON.stringify(sent.descriptions));
    assert(JSON.stringify(sent.staleDescriptionFields) === JSON.stringify({ normalDescription: ['状态', '未分类'] }), 'Stale fields: ' + JSON.stringify(sent.staleDescriptionFields));
    s.saveSettings(ctx()); await s.saveSettingsNow(ctx());
    return { objectSent: true, stale: sent.staleDescriptionFields.normalDescription };
  })()`);

  // 3. Track page: body size row and description update-age tooltips
  results.trackPage = await evaluate(`(async()=>{
    const { assert } = __v115;
    await __v115.openTrack('旧档描述');
    const rows = Object.fromEntries([...document.querySelectorAll('.bs-bt-track-meta-row')].map(r => [r.querySelector('.bs-bt-track-meta-label')?.textContent, r.querySelector('.bs-bt-track-meta-value')?.textContent]));
    assert(rows['体型'] === '4.2 级（人类）', 'Body size row: ' + rows['体型']);
    document.querySelector('[data-track-tab="description"]').click(); await __v115.wait(300);
    const items = Object.fromEntries([...document.querySelectorAll('.bs-bt-track-description-item')].map(e => [e.querySelector('.bs-bt-track-description-title').textContent, e.title]));
    assert(/1 天 1 小时前更新（已超过一天/.test(items['状态']), 'Stale tooltip: ' + items['状态']);
    assert(items['表情'] === '游戏时间 1 小时前更新', 'Fresh tooltip: ' + items['表情']);
    return { bodySize: rows['体型'], tooltips: items };
  })()`);
  await screenshot('track-description.png');

  // 4. Encyclopedia: body fields, body plan in the species text, override persisting across reload, catalog preview
  await evaluate(`__v115.openPanel('race-encyclopedia')`);
  results.encyclopedia = await evaluate(`(async()=>{
    const { assert, wait } = __v115;
    document.querySelector('[data-encyclopedia-tab="race"]').click(); await wait();
    const select = document.querySelector('#bs-bt-race-select');
    select.value = '半人马'; select.dispatchEvent(new Event('change', { bubbles: true })); await wait();
    const text = document.querySelector('#bs-bt-race-output').textContent;
    assert(/- 体型: 常态 5 级/.test(text) && /变化态 4 级/.test(text), 'Centaur body size line missing');
    assert(/- 体态: 半人形：人类上身接非人下半身/.test(text), 'Centaur body plan line missing');
    document.querySelector('#bs-bt-race-open-editor').click(); await wait();
    const field = id => document.querySelector('#bs-bt-race-field-' + id);
    const values = ['bodySize', 'bodySizeSd', 'altFormBodySize', 'bodyPlan'].map(id => field(id).value);
    assert(values.join('|') === '5|0.4|4|hybrid', 'Editor values: ' + values.join('|'));
    const hint = document.querySelector('.bs-bt-race-editor-hint');
    assert(/名录提示预览：Centaur，上身为人、下身为马的亚人$/.test(hint.textContent), 'Catalog preview: ' + hint.textContent);
    const intro = document.querySelector('#bs-bt-race-introduction-line');
    const original = intro.value;
    intro.value = '马人，上身为人；其余略。'; intro.dispatchEvent(new Event('input', { bubbles: true }));
    assert(/名录提示预览：马人，上身为人$/.test(hint.textContent), 'Preview did not follow input: ' + hint.textContent);
    intro.value = original; intro.dispatchEvent(new Event('input', { bubbles: true }));
    field('bodyPlan').value = 'any';
    document.querySelector('#bs-bt-race-save-override').click(); await wait(500);
    return { values, previewLive: true };
  })()`);
  const diskSettings = () => JSON.parse(readFileSync(join(dataRoot, 'default-user', 'settings.json'), 'utf8')).extension_settings?.bs_biotracker || {};
  for (let i = 0; i < 100 && diskSettings().racePhysiologyOverrides?.['半人马']?.bodyPlan !== 'any'; i++) await sleep(100);
  if (diskSettings().racePhysiologyOverrides?.['半人马']?.bodyPlan !== 'any') throw Error('Body plan override never reached settings.json');
  await reload();
  results.encyclopedia.overridePersisted = await evaluate(`(async()=>{
    const { assert, wait } = __v115;
    await __v115.openPanel('race-encyclopedia');
    document.querySelector('[data-encyclopedia-tab="race"]').click(); await wait();
    const select = document.querySelector('#bs-bt-race-select');
    select.value = '半人马'; select.dispatchEvent(new Event('change', { bubbles: true })); await wait();
    assert(/- 体态: 任意/.test(document.querySelector('#bs-bt-race-output').textContent), 'Override not shown after reload');
    document.querySelector('#bs-bt-race-open-editor').click(); await wait();
    assert(document.querySelector('#bs-bt-race-field-bodyPlan').value === 'any', 'Editor lost override');
    document.querySelector('#bs-bt-race-reset-override').click(); await wait(500);
    assert(/- 体态: 半人形/.test(document.querySelector('#bs-bt-race-output').textContent), 'Override not cleared');
    return true;
  })()`);
  await screenshot('encyclopedia-centaur.png');

  // 5. Lineage: a stranger father with a recorded body size is selectable; spouses read 同辈
  results.lineage = await evaluate(`(async()=>{
    const { ctx, assert, mods, wait } = __v115; const { s } = await mods();
    const chat = s.getChatState(ctx(), s.getSettings(ctx()));
    chat.characters['旧档描述'].profile.children = [
      { id: 'v115-1', name: '虫仔', gender: '男', race: '独居虫族x人类', bloodline: { 独居虫族: 0.5, 人类: 0.5 }, fathers: '大蟑螂', fatherRace: '独居虫族-蟑螂', fatherBloodline: { 独居虫族: 1 }, fatherBodySize: 4.5, age: 3, talents: [] },
    ];
    s.recordChatStateSnapshot(ctx(), chat, { reason: 'v115-lineage' });
    s.saveSettings(ctx()); await s.saveSettingsNow(ctx());
    document.querySelector('[aria-label="HOME"]')?.click(); await wait();
    await __v115.openTrack('旧档描述', 'experience');
    document.querySelector('[data-lineage-center="旧档描述"]').click(); await wait(500);
    const roach = document.querySelector('[data-lineage-node="name:大蟑螂"]');
    assert(roach && !roach.disabled, 'Stranger father not selectable');
    roach.click(); await wait();
    const detail = document.querySelector('.bs-bt-lineage__detail').innerText;
    assert(/体型\\s*4\\.5 级（高大）（据子女记录）/.test(detail), 'Father body size missing: ' + detail);
    assert(/世代\\s*同辈/.test(detail), 'Spouse generation label: ' + detail);
    return { strangerSelectable: true, fatherBodySize: '4.5 级' };
  })()`);
  await screenshot('lineage-roach.png');
  await evaluate(`(async()=>{ document.querySelector('.bs-bt-lineage__close')?.click(); await __v115.wait(200); return true; })()`);

  // 6. Card switches and reloads above must not leave placeholder-key shells in the saved settings
  await evaluate(`(async()=>{ const { s } = await __v115.mods(); await s.saveSettingsNow(__v115.ctx()); return true; })()`);
  await sleep(1500);
  const storedKeys = Object.keys(diskSettings().chatStates || {});
  results.placeholderShells = storedKeys.filter(key => /^(?:\d+|char):(?:solo|\d+)$/.test(key));
  if (results.placeholderShells.length) throw Error('Placeholder chat states persisted: ' + results.placeholderShells.join(', '));

  const unexpected = exceptions.filter(Boolean);
  const output = { kind, hostVersion: JSON.parse(readFileSync(join(hostRoot, 'package.json'))).version, pluginVersion: JSON.parse(readFileSync(join(root, 'manifest.json'))).version, ...results, unhandledExceptions: unexpected, isolatedData: true, artifacts };
  writeFileSync(join(artifacts, 'receipt.json'), JSON.stringify(output, null, 2));
  console.log(JSON.stringify(output, null, 2));
  if (unexpected.length) throw Error('Unhandled exceptions: ' + unexpected.join(' | '));
} catch (error) {
  try { await screenshot('failure.png'); } catch {}
  console.log(JSON.stringify({ kind, error: error.message, results, exceptions, artifacts }, null, 2));
  process.exitCode = 1;
} finally {
  writeFileSync(join(artifacts, 'server.log'), serverLog);
  if (ws) { try { await rpc('Browser.close'); } catch {} ws.close(); }
  browser?.kill(); server.kill();
}
