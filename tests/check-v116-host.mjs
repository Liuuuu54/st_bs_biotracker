// v1.1.6 real-host checks; no model is called.
// Usage: node tests/check-v116-host.mjs D:/SillyTavern sillytavern
//        node tests/check-v116-host.mjs D:/Luker luker
//        node tests/check-v116-host.mjs - tauritavern   (drives the user's installed TauriTavern on WebView2
//                                                       debug port 9333; back up its data folder first)
// Covers: host world-info resolution (scan depth, exclusion list), snapshot repair (strip excluded, add entries the
// reply triggered), capture skipping only the plugin's own requests, settings migration through real reloads
// (normal mode → mainflow, old "off" → master on + auto off), the master switch clearing the injected prompt,
// and the two switches keeping box and label on one line at phone width.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const kind = process.argv[3];
if (!['sillytavern', 'luker', 'tauritavern'].includes(kind)) throw Error('Provide a host root and kind');
const tauri = kind === 'tauritavern';
const hostRoot = tauri ? '' : resolve(process.argv[2] || '');
const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const artifacts = mkdtempSync(join(tmpdir(), 'biotracker-v116-' + kind + '-'));
const dataRoot = tauri ? join(process.env.APPDATA, 'com.tauritavern.client', 'data') : join(artifacts, 'data');
const extensionName = tauri ? 'st_bs_biotracker' : 'st_bs_biotracker_v116_test';
const base = '/scripts/extensions/third-party/' + extensionName;
const CARD = 'BS116验收';
const BOOK = 'BS116验收书';

let server = null; let serverLog = ''; let port = 0; let browser = null; let browserPort = 0;
if (!tauri) {
  const extensionRoot = join(dataRoot, 'default-user', 'extensions');
  mkdirSync(extensionRoot, { recursive: true });
  symlinkSync(repoRoot, join(extensionRoot, extensionName), 'junction');
  const defaults = JSON.parse(readFileSync(join(hostRoot, 'default/content/settings.json'), 'utf8'));
  defaults.firstRun = false;
  defaults.extension_settings ||= {};
  defaults.extension_settings.disabledExtensions = readdirSync(join(hostRoot, 'public/scripts/extensions/third-party')).map(name => 'third-party/' + name);
  writeFileSync(join(dataRoot, 'default-user', 'settings.json'), JSON.stringify(defaults));
  const socket = createServer(); await new Promise(ok => socket.listen(0, '127.0.0.1', ok));
  port = socket.address().port; await new Promise(ok => socket.close(ok));
  const configPath = join(artifacts, 'config.yaml');
  writeFileSync(configPath, `dataRoot: ${JSON.stringify(dataRoot.replaceAll('\\', '/'))}\nport: ${port}\nlisten: false\nenableIPv6: false\nenableIPv4: true\nenableUserAccounts: false\nbasicAuthMode: false\nenableServerPlugins: false\nextensions:\n  enabled: true\n  autoUpdate: false\n  models:\n    autoDownload: false\n`);
  server = spawn(process.execPath, ['server.js', '--configPath', configPath, '--dataRoot', dataRoot, '--port', String(port), '--browserLaunchEnabled', 'false', '--listen', 'false'], { cwd: hostRoot, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', value => { serverLog += value; }); server.stderr.on('data', value => { serverLog += value; });
}

const exceptions = [];
async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const pending = new Map(); let sequence = 0;
  await new Promise((ok, fail) => { ws.addEventListener('open', ok, { once: true }); ws.addEventListener('error', fail, { once: true }); });
  ws.addEventListener('message', event => {
    const m = JSON.parse(event.data);
    if (pending.has(m.id)) { const task = pending.get(m.id); pending.delete(m.id); m.error ? task.reject(Error('CDP failed: ' + JSON.stringify(m.error))) : task.resolve(m.result); }
    else if (m.method === 'Runtime.exceptionThrown') exceptions.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text);
    else if (m.method === 'Page.javascriptDialogOpening') setTimeout(() => { rpc('Page.handleJavaScriptDialog', { accept: true }).catch(() => {}); }, 300);
  });
  const rpc = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (pending.delete(id)) reject(Error('Timeout ' + method)); }, 30000).unref();
  });
  const evaluate = async (expression) => {
    const r = await rpc('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  await rpc('Runtime.enable'); await rpc('Page.enable');
  return { ws, rpc, evaluate };
}

// 世界书：常驻一条、关键字三条；橘子只在第三则之前提过，宿主预设扫描深度 2 扫不到
const ENTRY = (uid, comment, content, extra = {}) => ({
  uid, comment, content, key: [], keysecondary: [], constant: false, vectorized: false, selective: true, selectiveLogic: 0,
  addMemo: true, order: 100, position: 0, disable: false, excludeRecursion: false, preventRecursion: false,
  delayUntilRecursion: false, probability: 100, useProbability: true, depth: 4, group: '', groupOverride: false,
  groupWeight: 100, scanDepth: null, caseSensitive: null, matchWholeWords: null, useGroupScoring: null,
  automationId: '', role: null, sticky: 0, cooldown: 0, delay: 0, displayIndex: uid, ...extra,
});
const BOOK_DATA = { entries: {
  0: ENTRY(0, '常驻背景', '常驻背景：这是一段常驻条目的内容，长度足够比对用。', { constant: true }),
  1: ENTRY(1, '苹果条目', '苹果条目：红色的果子，长在宅邸后院的老树上。', { key: ['苹果'] }),
  2: ENTRY(2, '香蕉条目', '香蕉条目：黄色的果子，从南方港口运来的稀罕货。', { key: ['香蕉'] }),
  3: ENTRY(3, '橘子条目', '橘子条目：只在三则之前提过，预设扫描深度扫不到。', { key: ['橘子'] }),
} };

const PRELUDE = `
  window.__v = {
    ctx: () => (globalThis.Luker || globalThis.SillyTavern).getContext(),
    assert: (condition, message) => { if (!condition) throw Error(message); },
    wait: (ms = 300) => new Promise(ok => setTimeout(ok, ms)),
    async mods() {
      return {
        s: await import('${base}/scripts/state.js'), r: await import('${base}/scripts/registry.js'),
        h: await import('${base}/scripts/host.js'), w: await import('${base}/scripts/worldinfo_resolve.js'),
        o: await import('${base}/scripts/own_requests.js'), t: await import('${base}/scripts/tracker.js'),
      };
    },
    async openCard(chatId = localStorage.getItem('v116-chat')) {
      const ctx = this.ctx();
      await ctx.getCharacters();
      const id = ctx.characters.findIndex(card => card.name === '${CARD}');
      this.assert(id >= 0, 'Test card not listed');
      await ctx.selectCharacterById(id);
      const { h, s } = await this.mods();
      for (let i = 0; i < 100 && (!h.getHostChatId(this.ctx()) || h.isPlaceholderHostChatId(this.ctx())); i++) await this.wait(100);
      if (chatId && this.ctx().getCurrentChatId() !== chatId) {
        await this.ctx().openCharacterChat(chatId);
        for (let i = 0; i < 100 && this.ctx().getCurrentChatId() !== chatId; i++) await this.wait(100);
      }
      localStorage.setItem('v116-chat', this.ctx().getCurrentChatId());
      await s.hydrateChatStateFromHost(this.ctx(), s.getSettings(this.ctx()));
      return this.ctx().getCurrentChatId();
    },
    async openPanel() {
      const modal = document.querySelector('#bs-biotracker-modal');
      if (!modal.classList.contains('is-open')) document.querySelector('#bs-biotracker-menu-item').click();
      for (let i = 0; i < 100 && !modal.classList.contains('is-open'); i++) await this.wait(50);
      this.assert(modal.classList.contains('is-open'), 'Panel did not open');
    },
    oneLine(id) {
      const box = document.getElementById(id); const label = document.querySelector('label[for="' + id + '"]');
      const b = box.getBoundingClientRect(); const l = label.getBoundingClientRect();
      return b.height > 0 && Math.abs((b.top + b.bottom) / 2 - (l.top + l.bottom) / 2) < 8 && l.left > b.left;
    },
    injected() {
      const prompts = this.ctx().extensionPrompts;
      return prompts ? String(prompts['bs_biotracker_mainflow']?.value || '').length : null;
    },
  };
  true`;

async function boot(page) {
  for (let i = 0; i < 600; i++) {
    try { if (await page.evaluate("!!document.querySelector('#bs-biotracker-menu-item') && !!(globalThis.Luker||globalThis.SillyTavern)?.getContext")) break; } catch {}
    await sleep(100);
  }
  await page.evaluate(PRELUDE);
  for (let i = 0; i < 300; i++) {
    try { if (await page.evaluate("(async()=>{ try { return (await import('/script.js')).settingsReady !== false; } catch { return true; } })()")) break; } catch {}
    await sleep(100);
  }
}
async function reload(page) {
  await page.rpc('Runtime.evaluate', { expression: 'setTimeout(() => location.reload(), 0); true' });
  await sleep(1500);
  await boot(page);
  await page.evaluate('__v.openCard()');
  await sleep(500);
}

const results = { kind };
let page;
try {
  if (!tauri) {
    let ready = false;
    for (let i = 0; i < 1200; i++) {
      if (server.exitCode !== null) throw Error('Host exited during startup');
      try { ready = (await fetch('http://127.0.0.1:' + port + '/')).ok; } catch {}
      if (ready) break; await sleep(100);
    }
    if (!ready) throw Error('Host startup timed out');
    const profile = join(artifacts, 'browser');
    browser = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--no-first-run', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
    for (let i = 0; i < 80; i++) { try { browserPort = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; break; } catch {} await sleep(100); }
    if (!browserPort) throw Error('Browser startup timed out');
  }
  const listPort = tauri ? 9333 : browserPort;
  let targets = [];
  for (let i = 0; i < 300 && !targets.some(t => t.type === 'page'); i++) { try { targets = await (await fetch(`http://127.0.0.1:${listPort}/json/list`)).json(); } catch {} await sleep(200); }
  page = await connect(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  if (tauri) await page.rpc('Page.reload', { ignoreCache: true });
  else await page.rpc('Page.navigate', { url: `http://127.0.0.1:${port}/` });
  await sleep(1500);
  await boot(page);
  results.hostVersion = tauri ? 'installed TauriTavern' : JSON.parse(readFileSync(join(hostRoot, 'package.json'))).version;
  results.pluginVersion = await page.evaluate(`(async()=>(await (await fetch('${base}/manifest.json')).json()).version)()`);

  // 0. 世界书、角色卡与五则对话
  await page.evaluate(`(async()=>{
    const { ctx, assert } = __v;
    localStorage.removeItem('v116-chat');
    const headers = ctx().getRequestHeaders();
    assert((await fetch('/api/worldinfo/edit', { method: 'POST', headers, body: JSON.stringify({ name: '${BOOK}', data: ${JSON.stringify(BOOK_DATA)} }) })).ok, 'World book create failed');
    await ctx().getCharacters();
    if (!ctx().characters.some(card => card.name === '${CARD}')) {
      const card = { spec: 'chara_card_v2', spec_version: '2.0', data: { name: '${CARD}', description: '1.1.6 验收用临时角色。', personality: '', scenario: '', first_mes: '验收开始。', mes_example: '', creator_notes: '', system_prompt: '', post_history_instructions: '', alternate_greetings: [], tags: [], creator: 'test', character_version: '1.1.6', extensions: { world: '${BOOK}' } } };
      const form = new FormData(); form.set('file_type', 'json'); form.set('avatar', new File([JSON.stringify(card)], 'v116.json', { type: 'application/json' }));
      const formHeaders = { ...headers }; delete formHeaders['Content-Type']; delete formHeaders['content-type'];
      assert((await fetch('/api/characters/import', { method: 'POST', headers: formHeaders, body: form })).ok, 'Card import failed');
    }
    await __v.openCard(null);
    for (const command of ['/send 我顺口提了一句橘子。', '/sendas name="${CARD}" 嗯。', '/send 今天想吃苹果。', '/sendas name="${CARD}" 还有香蕉。']) {
      await ctx().executeSlashCommandsWithOptions(command);
      await __v.wait(200);
    }
    await ctx().saveChat?.();
    return true;
  })()`);

  // 1. 宿主试算：扫描深度 2、常驻照送，排除名单在载入条目时拿掉
  results.resolve = await page.evaluate(`(async()=>{
    const { ctx, assert, mods } = __v; const { s, w } = await mods();
    const settings = s.getSettings(ctx());
    settings.trackerWorldbookExcludeNames = '';
    const plain = await w.resolveHostWorldInfo(ctx(), settings, { collectEntries: true });
    assert(plain, 'Host world info resolution returned nothing');
    const has = (text, name) => text.includes(${JSON.stringify(Object.fromEntries(Object.values(BOOK_DATA.entries).map(e => [e.comment, e.content])))}[name]);
    const fired = ['常驻背景', '苹果条目', '香蕉条目', '橘子条目'].filter(name => has(plain.activationText, name));
    assert(fired.join('|') === '常驻背景|苹果条目|香蕉条目', 'Unexpected activation: ' + fired.join('|'));
    settings.trackerWorldbookExcludeNames = '苹果条目';
    const excluded = await w.resolveHostWorldInfo(ctx(), settings, { collectEntries: true });
    settings.trackerWorldbookExcludeNames = '';
    assert(!has(excluded.activationText, '苹果条目'), 'Excluded entry still activated');
    assert(excluded.removedEntries.some(entry => entry.comment === '苹果条目'), 'Excluded entry not reported');
    // 快照补漏与删除：快照里有常驻与苹果，没有香蕉
    const snapshot = { messages: [{ role: 'system', content: '常驻背景：这是一段常驻条目的内容，长度足够比对用。\\n苹果条目：红色的果子，长在宅邸后院的老树上。' }] };
    const stripped = w.stripExcludedFromSnapshot(ctx(), snapshot, excluded.removedEntries);
    assert(stripped.stripped.includes('苹果条目') && !stripped.snapshot.messages[0].content.includes('苹果条目'), 'Excluded entry not stripped from snapshot');
    const missing = w.findWorldInfoMissingFromSnapshot(ctx(), snapshot, plain).map(item => item.name);
    assert(missing.join('|') === '香蕉条目', 'Unexpected missing entries: ' + missing.join('|'));
    return { fired, excludedRemoved: true, snapshotStripped: true, snapshotAdded: missing };
  })()`);

  // 2. 只略过插件自己的请求：别人的请求照样抓进快照
  results.capture = await page.evaluate(`(async()=>{
    const { assert, mods } = __v; const { o } = await mods();
    const send = (content, own) => {
      const init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content }] }) };
      return fetch('/api/bs116-capture-probe', own ? o.markOwnRequest(init) : init).catch(() => null);
    };
    const snap = () => (globalThis.__bs_biotracker_mainflow_context_snapshot__?.messages || []).map(m => m.content).join('|');
    await send('来自其他扩充的请求', false);
    assert(snap().includes('来自其他扩充的请求'), 'Foreign request not captured: ' + snap());
    await send('插件自己的请求', true);
    assert(!snap().includes('插件自己的请求'), 'Own request captured');
    return { foreignCaptured: true, ownSkipped: true };
  })()`);

  // 3. 旧设定换算，经过真实重载：正常模式 → 主流；旧的「关」→ 总开关开、自动追踪关
  const priorSwitches = await page.evaluate(`(async()=>{
    const { ctx, mods } = __v; const { s } = await mods();
    const settings = s.getSettings(ctx());
    const prior = { enabled: settings.enabled, autoTrackEnabled: settings.autoTrackEnabled, mode: settings.trackerWorldbookMode };
    settings.trackerWorldbookMode = 'exclude';
    settings.enabled = false;
    delete settings.autoTrackEnabled;
    await s.saveSettingsNow(ctx());
    return prior;
  })()`);
  await sleep(1500);
  await reload(page);
  await sleep(1500);
  await reload(page);
  results.migration = await page.evaluate(`(async()=>{
    const { ctx, assert, mods } = __v; const { s } = await mods();
    const settings = s.getSettings(ctx());
    assert(settings.trackerWorldbookMode === 'mainflow', 'Mode not migrated: ' + settings.trackerWorldbookMode);
    assert(settings.enabled === true && settings.autoTrackEnabled === false, 'Switches not migrated: ' + JSON.stringify([settings.enabled, settings.autoTrackEnabled]));
    return { mode: settings.trackerWorldbookMode, enabled: settings.enabled, autoTrackEnabled: settings.autoTrackEnabled };
  })()`);

  // 4. 总开关清掉注入、再打开恢复；自动追踪不影响注入。两个开关在手机宽度下框与字同一行
  await page.rpc('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
  results.switches = await page.evaluate(`(async()=>{
    const { ctx, assert, mods, wait } = __v; const { s, r } = await mods();
    const chat = s.getChatState(ctx(), s.getSettings(ctx()));
    r.applyRegistryResult(chat, { name: '开关验收', profile: { base: { race: '人类', age: 24 } } });
    s.saveSettings(ctx());
    await __v.openPanel();
    document.querySelector('#bs-bt-system-button').click(); await wait(400);
    const master = document.getElementById('bs-bt-enabled');
    assert(__v.oneLine('bs-bt-enabled'), 'Master switch wraps');
    assert(master.checked, 'Master switch should start on after migration');
    // 先关再开，让注入以当前状态重算一次
    master.click(); await wait(300);
    const off = __v.injected();
    master.click(); await wait(300);
    const on = __v.injected();
    assert(off === 0 || off === null, 'Prompt still injected while off: ' + off);
    assert(on === null || on > 0, 'Prompt not restored when on');
    document.querySelector('[data-nav-view="track-list"]').click(); await wait(400);
    assert(__v.oneLine('bs-bt-auto-track'), 'Auto-track switch wraps');
    const auto = document.getElementById('bs-bt-auto-track');
    const autoBefore = auto.checked; auto.click(); await wait(200);
    const injectedAfterAuto = __v.injected();
    const autoSetting = s.getSettings(ctx()).autoTrackEnabled;
    assert(autoSetting === !autoBefore, 'Auto-track toggle not saved');
    assert(injectedAfterAuto === on, 'Auto-track toggle changed the injection');
    const modes = [...document.querySelectorAll('#bs-bt-tracker-worldbook-mode option')].map(o => o.value);
    assert(modes.join('|') === 'mainflow|allowlist_all', 'Worldbook modes: ' + modes.join('|'));
    return { injectedWhenOff: off, injectedWhenOn: on, autoToggleKeepsInjection: true, modes, oneLine: true };
  })()`);
  await page.rpc('Emulation.clearDeviceMetricsOverride');

  // 测试前的开关与模式还原，再清掉测试卡、聊天、世界书与插件状态
  await page.evaluate(`(async()=>{
    const { ctx, mods } = __v; const { s } = await mods();
    const settings = s.getSettings(ctx()); const prior = ${JSON.stringify(priorSwitches)};
    const chatKey = s.getChatKey(ctx());
    settings.enabled = prior.enabled; settings.autoTrackEnabled = prior.autoTrackEnabled ?? true; settings.trackerWorldbookMode = prior.mode || 'mainflow';
    await ctx().executeSlashCommandsWithOptions?.('/closechat');
    delete settings.chatStates?.[chatKey];
    await s.saveSettingsNow(ctx());
    await ctx().getCharacters();
    const card = ctx().characters.find(c => c.name === '${CARD}');
    const headers = ctx().getRequestHeaders();
    if (card) await fetch('/api/characters/delete', { method: 'POST', headers, body: JSON.stringify({ avatar_url: card.avatar, delete_chats: true }) });
    await fetch('/api/worldinfo/delete', { method: 'POST', headers, body: JSON.stringify({ name: '${BOOK}' }) });
    return true;
  })()`);
  results.exceptions = exceptions.filter(Boolean);
  results.artifacts = artifacts;
  console.log(JSON.stringify(results, null, 2));
  if (results.exceptions.length) process.exitCode = 1;
} catch (error) {
  console.log(JSON.stringify({ kind, error: error.message, results, exceptions, artifacts }, null, 2));
  process.exitCode = 1;
} finally {
  if (serverLog) writeFileSync(join(artifacts, 'server.log'), serverLog);
  try { page?.ws.close(); } catch {}
  browser?.kill(); server?.kill();
}
