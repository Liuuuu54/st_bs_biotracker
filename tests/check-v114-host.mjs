// v1.1.4 real native-host checks using temporary config/data and a workspace plugin junction; no model is called.
// Usage: node tests/check-v114-host.mjs D:/SillyTavern sillytavern
//        node tests/check-v114-host.mjs D:/Luker luker
// Covers: schema 6 → 7 race renames through a real save/reload, derived need tiles (flux spans two rows),
// species count and human preset button, realistic-world and per-tool switches persisting across reloads.
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
const artifacts = mkdtempSync(join(tmpdir(), 'biotracker-v114-' + kind + '-'));
const dataRoot = join(artifacts, 'data');
const extensionRoot = join(dataRoot, 'default-user', 'extensions');
mkdirSync(extensionRoot, { recursive: true });
const extensionName = 'st_bs_biotracker_v114_test';
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
const CARD = 'BS114验收';
// Shared page helpers, re-installed after each navigation
const PRELUDE = `
  window.__v114 = {
    ctx: () => (globalThis.Luker || globalThis.SillyTavern).getContext(),
    assert: (condition, message) => { if (!condition) throw Error(message); },
    async mods() {
      return {
        s: await import('${base}/scripts/state.js'),
        r: await import('${base}/scripts/registry.js'),
        rc: await import('${base}/scripts/race_config.js'),
        t: await import('${base}/scripts/tracker.js'),
        w: await import('${base}/scripts/world_mode.js'),
      };
    },
    async openCard(chatId = sessionStorage.getItem('v114-chat')) {
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
      sessionStorage.setItem('v114-chat', this.ctx().getCurrentChatId());
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
  await evaluate('__v114.openCard()');
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
    const { ctx, assert } = __v114;
    const extensionModule = await import('/scripts/extensions.js');
    assert(extensionModule.extensionTypes['third-party/${extensionName}'] === 'local', 'Workspace extension must take precedence');
    const source = await (await fetch('${base}/index.js')).text();
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source)))).map(n => n.toString(16).padStart(2, '0')).join('');
    const card = { spec: 'chara_card_v2', spec_version: '2.0', data: { name: '${CARD}', description: '临时验收角色。', personality: '', scenario: '', first_mes: '验收开始。', mes_example: '', creator_notes: '', system_prompt: '', post_history_instructions: '', alternate_greetings: [], tags: [], creator: 'test', character_version: '1.1.4', extensions: {} } };
    const form = new FormData(); form.set('file_type', 'json'); form.set('avatar', new File([JSON.stringify(card)], 'fixture.json', { type: 'application/json' }));
    const headers = { ...ctx().getRequestHeaders() }; delete headers['Content-Type']; delete headers['content-type'];
    const response = await fetch('/api/characters/import', { method: 'POST', headers, body: form });
    assert(response.ok, 'Card import failed');
    await __v114.openCard();
    // Luker 新聊天要先落盘，重载才会回到同一个聊天
    await ctx().saveChat?.();
    return { hash };
  })()`);
  const expectedHash = createHash('sha256').update(readFileSync(join(root, 'index.js'))).digest('hex');
  if (results.source.hash !== expectedHash) throw Error('Loaded source differs from workspace');
  results.source = { matchesWorkspace: true };

  // 1. Schema 6 save with pre-1.1.4 race names → migrated to 7 after a real reload
  results.seed = await evaluate(`(async()=>{
    const { ctx, assert, mods } = __v114; const { s, r } = await mods();
    const settings = s.getSettings(ctx());
    const chat = s.getChatState(ctx(), settings);
    r.applyRegistryResult(chat, { name: '旧档月兔', profile: { base: { race: '人类' } } });
    r.applyRegistryResult(chat, { name: '旧档欧克', profile: { base: { race: '人类' } } });
    const rabbit = chat.characters['旧档月兔'].profile.base;
    Object.assign(rabbit, { race: '月兔族x人类', bloodline: { 月兔族: 0.5, 人类: 0.5 }, age: 24 });
    const orc = chat.characters['旧档欧克'].profile.base;
    Object.assign(orc, { race: '兽人', bloodline: { 兽人: 1 }, age: 24 });
    chat.schemaVersion = 6;
    s.saveSettings(ctx()); await s.saveSettingsNow(ctx());
    const host = await import('${base}/scripts/host.js');
    const stored = await host.loadHostChatState(ctx());
    return { key: s.getChatKey(ctx()), storedChars: Object.keys(stored?.characters || {}), storedSchema: stored?.schemaVersion };
  })()`);
  await reload();
  results.migration = await evaluate(`(async()=>{
    const { ctx, assert, mods } = __v114; const { s } = await mods();
    const settings = s.getSettings(ctx());
    const chat = s.getChatState(ctx(), settings);
    assert(chat.characters['旧档月兔'], 'Seeded chat lost after reload: key=' + s.getChatKey(ctx()) + ' keys=' + Object.keys(settings.chatStates || {}).join('|') + ' chars=' + Object.keys(chat.characters).join('|') + ' schema=' + chat.schemaVersion);
    assert(chat.schemaVersion === 7, 'Schema not migrated: ' + chat.schemaVersion);
    const rabbit = chat.characters['旧档月兔'].profile.base;
    const orc = chat.characters['旧档欧克'].profile.base;
    assert(rabbit.race === '月兔x人类', 'Rabbit race not renamed: ' + rabbit.race);
    assert(rabbit.bloodline['月兔'] === 0.5 && !('月兔族' in rabbit.bloodline), 'Rabbit bloodline key not renamed');
    assert(orc.race === '欧克' && orc.bloodline['欧克'] === 1, 'Orc not renamed: ' + orc.race);
    await s.saveSettingsNow(ctx());
    return { schema: chat.schemaVersion, rabbit: rabbit.race, orc: orc.race };
  })()`);
  await reload();
  results.migration.persistedAfterSecondReload = await evaluate(`(async()=>{
    const { ctx, mods } = __v114; const { s } = await mods();
    const chat = s.getChatState(ctx(), s.getSettings(ctx()));
    return chat.schemaVersion === 7 && chat.characters['旧档欧克'].profile.base.race === '欧克';
  })()`);
  if (!results.migration.persistedAfterSecondReload) throw Error('Migration did not persist');

  // 2. Derived need tiles: 4 needs left/right, flux spanning both rows in the middle
  await evaluate(`(async()=>{
    const { ctx, mods } = __v114; const { s, r } = await mods();
    const chat = s.getChatState(ctx(), s.getSettings(ctx()));
    r.applyRegistryResult(chat, { name: '血族验收', profile: { base: { race: '[血族]人类' } } });
    chat.characters['血族验收'].profile.base.age = 24;
    s.saveSettings(ctx()); await s.saveSettingsNow(ctx());
    return true;
  })()`);
  await evaluate(`__v114.openPanel('track-list')`);
  results.derivedTiles = await evaluate(`(async()=>{
    const { assert } = __v114;
    const button = [...document.querySelectorAll('.bs-bt-track-character-button')].find(b => b.textContent.includes('血族验收'));
    assert(button, 'Derived character not listed'); button.click();
    await new Promise(ok => setTimeout(ok, 400));
    const grid = document.querySelector('.bs-bt-track-metabolism-grid.is-derived');
    assert(grid, 'Derived grid missing');
    grid.scrollIntoView();
    const tiles = [...grid.querySelectorAll('.bs-bt-need-tile')];
    const keys = tiles.map(t => [...t.classList].find(c => /^bs-bt-need-tile--(flux|excretion|hunger|sleep|milk|odor|companionship)$/.test(c)).replace('bs-bt-need-tile--', ''));
    assert(tiles.length === 5, 'Expected 5 tiles, got ' + tiles.length + ': ' + keys);
    assert(!keys.includes('hunger') && !keys.includes('excretion'), '血族 should exempt hunger and excretion: ' + keys);
    const rect = el => el.getBoundingClientRect();
    const flux = rect(tiles[keys.indexOf('flux')]);
    const others = tiles.filter((_, i) => keys[i] !== 'flux').map(rect);
    assert(others.every(o => Math.abs(o.height - others[0].height) < 1), 'Need tiles differ in height');
    const top = Math.min(...others.map(o => o.top)), bottom = Math.max(...others.map(o => o.bottom));
    assert(Math.abs(flux.top - top) < 1 && Math.abs(flux.bottom - bottom) < 1, 'Flux does not span both rows');
    assert(others.filter(o => o.right <= flux.left + 1).length === 2 && others.filter(o => o.left >= flux.right - 1).length === 2, 'Needs are not split left/right of flux');
    return { keys, fluxHeight: Math.round(flux.height), needHeight: Math.round(others[0].height) };
  })()`);
  await screenshot('derived-tiles.png');

  // 3. Species tab: 81 species and the human preset button
  await evaluate(`__v114.openPanel('race-encyclopedia')`);
  results.species = await evaluate(`(async()=>{
    const { assert } = __v114;
    const wait = () => new Promise(ok => setTimeout(ok, 250));
    document.querySelector('[data-encyclopedia-tab="race"]').click(); await wait();
    const count = document.querySelector('#bs-bt-race-count').textContent;
    assert(/81/.test(count), 'Species count: ' + count);
    const select = document.querySelector('#bs-bt-race-select');
    const options = [...select.options].map(o => o.value).filter(Boolean);
    assert(options.includes('人类') && options.includes('欧克') && options.includes('月兔'), 'Renamed species missing from select');
    assert(!options.includes('兽人') && !options.includes('月兔族'), 'Old names still listed');
    const read = () => Object.fromEntries([...document.querySelectorAll('[data-race-physiology-field]')].map(i => [i.dataset.racePhysiologyField, i.value]));
    const pick = async name => { select.value = name; select.dispatchEvent(new Event('change', { bubbles: true })); await wait(); document.querySelector('#bs-bt-race-open-editor').click(); await wait(); };
    await pick('人类'); const human = read(); document.querySelector('#bs-bt-race-editor-close').click(); await wait();
    await pick('哥布林'); const goblin = read();
    assert(JSON.stringify(goblin) !== JSON.stringify(human), 'Goblin editor equals human before preset');
    document.querySelector('#bs-bt-race-use-human').click(); await wait();
    const filled = read();
    assert(JSON.stringify(filled) === JSON.stringify(human), 'Human preset did not fill the editor');
    assert(/人类数值/.test(document.querySelector('#bs-bt-race-editor-status').textContent), 'Preset status missing');
    document.querySelector('#bs-bt-race-editor-close').click(); await wait();
    return { count: count.trim(), fields: Object.keys(human).length, humanPresetFills: true };
  })()`);

  // 4. Realistic world and special tool switches: effect on tracker tools/payload, persistence across reload
  results.switches = await evaluate(`(async()=>{
    const { ctx, assert, mods } = __v114; const { s, t, w } = await mods();
    const wait = () => new Promise(ok => setTimeout(ok, 400));
    document.querySelector('[data-encyclopedia-tab="world"]').click(); await wait();
    const realistic = document.querySelector('#bs-bt-realistic-world');
    const womb = document.querySelector('#bs-bt-special-tool-wombReturn');
    assert(!realistic.checked && womb.checked, 'Unexpected switch defaults');
    const names = () => t.getTrackerToolDefinitions(s.getSettings(ctx()), s.getChatState(ctx(), s.getSettings(ctx()))).map(d => d.function?.name || d.name);
    assert(names().includes('bsWombReturn'), 'bsWombReturn missing by default');
    realistic.click(); await wait();
    womb.click(); await wait();
    const settings = s.getSettings(ctx());
    assert(w.isRealisticWorld(settings) === true || settings.realisticWorld === true, 'Realistic switch not saved');
    const after = names();
    assert(!after.includes('bsWombReturn'), 'Disabled tool still offered');
    assert(after.includes('bsImplantEmbryo') && after.includes('bsExtendPregnancy'), 'Other special tools disappeared');
    const payload = JSON.stringify(t.buildTrackerPayload(ctx(), settings, 'manual'));
    assert(/realistic_world"?\\s*:\\s*true/.test(payload), 'Payload lacks realistic_world');
    assert(/bsWombReturn/.test(payload), 'Payload lacks disabled tool list');
    await s.saveSettingsNow(ctx());
    return { realistic: true, disabledToolHidden: true, othersKept: true, payloadFlags: true };
  })()`);
  // Luker 只有宿主的防抖存档：等设定真正写到磁盘再重载
  const diskSettings = () => JSON.parse(readFileSync(join(dataRoot, 'default-user', 'settings.json'), 'utf8')).extension_settings?.bs_biotracker || {};
  for (let i = 0; i < 100 && !(diskSettings().realisticWorld === true && diskSettings().specialTools?.wombReturn === false); i++) await sleep(100);
  results.switches.onDisk = diskSettings().realisticWorld === true && diskSettings().specialTools?.wombReturn === false;
  if (!results.switches.onDisk) throw Error('Switches never reached settings.json');
  await reload();
  results.switches.persisted = await evaluate(`(async()=>{
    const { assert } = __v114;
    await __v114.openPanel('race-encyclopedia');
    document.querySelector('[data-encyclopedia-tab="world"]').click(); await new Promise(ok => setTimeout(ok, 400));
    const realistic = document.querySelector('#bs-bt-realistic-world');
    const womb = document.querySelector('#bs-bt-special-tool-wombReturn');
    assert(realistic.checked && !womb.checked, 'Switches did not persist across reload');
    assert(document.querySelector('#bs-bt-special-tool-implantEmbryo').checked, 'Untouched tool lost');
    return true;
  })()`);
  await screenshot('world-switches.png');

  // 4b. Realistic lineage: life-stage icons and stage labels instead of the human hand
  results.realisticLineage = await evaluate(`(async()=>{
    const { ctx, assert, mods } = __v114; const { s } = await mods();
    const wait = ms => new Promise(ok => setTimeout(ok, ms));
    const chat = s.getChatState(ctx(), s.getSettings(ctx()));
    chat.characters['旧档月兔'].profile.children = [
      { id: 'v114-1', name: '小兔', gender: '女', race: '人类', bloodline: { 人类: 1 }, fathers: '路人', age: 5, talents: [] },
      { id: 'v114-2', name: '代孕儿', gender: '男', race: '人类', bloodline: { 人类: 1 }, fathers: '路人', provider: '捐卵者', age: 0, talents: [] },
    ];
    s.recordChatStateSnapshot(ctx(), chat, { reason: 'v114-lineage' });
    s.saveSettings(ctx()); await s.saveSettingsNow(ctx());
    document.querySelector('[aria-label="HOME"]')?.click(); await wait(300);
    await __v114.openPanel('track-list');
    [...document.querySelectorAll('.bs-bt-track-character-button')].find(b => b.textContent.includes('旧档月兔')).click(); await wait(400);
    document.querySelector('[data-track-tab="experience"]').click(); await wait(300);
    document.querySelector('[data-lineage-center="旧档月兔"]').click(); await wait(500);
    const cards = Object.fromEntries([...document.querySelectorAll('#bs-bt-lineage .bs-bt-lineage__card')].map(card => [
      card.querySelector('.bs-bt-lineage__card-name').textContent,
      { icon: card.querySelector('.bs-bt-life-icon')?.getAttribute('aria-label') || null, subs: [...card.querySelectorAll('.bs-bt-lineage__card-sub')].map(n => n.textContent).join('|') },
    ]));
    const expected = { 旧档月兔: '成人', 小兔: '孩童', 代孕儿: '婴儿', 路人: '精方', 捐卵者: '卵方' };
    for (const [name, stage] of Object.entries(expected)) {
      assert(cards[name]?.icon === stage && cards[name]?.subs === stage, name + ' should show ' + stage + ': ' + JSON.stringify(cards[name]));
    }
    return expected;
  })()`);
  await screenshot('lineage-realistic.png');
  await evaluate(`(async()=>{
    const { assert } = __v114; const wait = ms => new Promise(ok => setTimeout(ok, ms));
    document.querySelector('.bs-bt-lineage__close')?.click(); await wait(200);
    document.querySelector('[aria-label="HOME"]')?.click(); await wait(300);
    await __v114.openPanel('race-encyclopedia');
    document.querySelector('[data-encyclopedia-tab="world"]').click(); await wait(400);
    const realistic = document.querySelector('#bs-bt-realistic-world');
    const womb = document.querySelector('#bs-bt-special-tool-wombReturn');
    realistic.click(); await wait(400);
    womb.click(); await wait(400);
    assert(!realistic.checked && womb.checked, 'Switches did not toggle back');
    return true;
  })()`);

  // 5. Card switches and reloads above must not leave placeholder-key shells in the saved settings
  await evaluate(`(async()=>{ const { s } = await __v114.mods(); await s.saveSettingsNow(__v114.ctx()); return true; })()`);
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
