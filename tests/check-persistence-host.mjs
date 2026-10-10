// Persistence repro on real hosts; no model is called. Registration is simulated by the exact tail of runRegistry
// (applyRegistryResult → recordChatStateSnapshot → saveSettings) so only the save path is under test.
// Usage: node tests/check-persistence-host.mjs D:/SillyTavern sillytavern
//        node tests/check-persistence-host.mjs D:/Luker luker
//        node tests/check-persistence-host.mjs - tauritavern   (drives the user's installed TauriTavern on WebView2
//                                                              debug port 9333; back up its data folder first)
// S1: reload 0.2 s / 1.2 s / 3 s after a registration — does the debounced save reach disk in time?
// S2: a stale second tab saves settings after the first tab registered — does it overwrite the new character?
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
const artifacts = mkdtempSync(join(tmpdir(), 'biotracker-persist-' + kind + '-'));
const dataRoot = tauri ? join(process.env.APPDATA, 'com.tauritavern.client', 'data') : join(artifacts, 'data');
const extensionName = tauri ? 'st_bs_biotracker' : 'st_bs_biotracker_persist_test';
const base = '/scripts/extensions/third-party/' + extensionName;
const CARD = 'BS存档复现';

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
const dialogs = [];
// 「确定离开？」对话框：等 0.8 秒再按离开，模拟真人反应的时间
const DIALOG_ACCEPT_DELAY_MS = 800;
async function connect(wsUrl, label) {
  const ws = new WebSocket(wsUrl);
  const pending = new Map(); let sequence = 0;
  await new Promise((ok, fail) => { ws.addEventListener('open', ok, { once: true }); ws.addEventListener('error', fail, { once: true }); });
  ws.addEventListener('message', event => {
    const m = JSON.parse(event.data);
    if (pending.has(m.id)) { const task = pending.get(m.id); pending.delete(m.id); m.error ? task.reject(Error('CDP failed: ' + JSON.stringify(m.error))) : task.resolve(m.result); }
    else if (m.method === 'Runtime.exceptionThrown') exceptions.push(label + ': ' + (m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text));
    else if (m.method === 'Page.javascriptDialogOpening') {
      dialogs.push(label + ': ' + m.params.type);
      setTimeout(() => { rpc('Page.handleJavaScriptDialog', { accept: true }).catch(() => {}); }, DIALOG_ACCEPT_DELAY_MS);
    }
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

const PRELUDE = `
  window.__p = {
    ctx: () => (globalThis.Luker || globalThis.SillyTavern).getContext(),
    assert: (condition, message) => { if (!condition) throw Error(message); },
    wait: (ms = 300) => new Promise(ok => setTimeout(ok, ms)),
    async mods() {
      return { s: await import('${base}/scripts/state.js'), r: await import('${base}/scripts/registry.js'), h: await import('${base}/scripts/host.js') };
    },
    async openCard(chatId = localStorage.getItem('persist-chat')) {
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
      this.assert(!chatId || this.ctx().getCurrentChatId() === chatId, 'Could not reopen chat ' + chatId);
      localStorage.setItem('persist-chat', this.ctx().getCurrentChatId());
      await s.hydrateChatStateFromHost(this.ctx(), s.getSettings(this.ctx()));
      return this.ctx().getCurrentChatId();
    },
    // runRegistry 写入后的同一段：套用结果、记快照、走宿主的延迟存档
    async register(name) {
      const { s, r } = await this.mods();
      const ctx = this.ctx();
      const chat = s.getChatState(ctx, s.getSettings(ctx));
      r.applyRegistryResult(chat, { name, profile: { base: { race: '人类', age: 24 } } });
      s.recordChatStateSnapshot(ctx, chat, { reason: 'registry' });
      s.saveSettings(ctx);
      return Object.keys(chat.characters);
    },
    async names() {
      const { s } = await this.mods();
      const ctx = this.ctx();
      await s.hydrateChatStateFromHost(ctx, s.getSettings(ctx));
      return Object.keys(s.getChatState(ctx, s.getSettings(ctx)).characters);
    },
  };
  true`;

async function boot(page) {
  for (let i = 0; i < 600; i++) {
    try { if (await page.evaluate("!!document.querySelector('#bs-biotracker-menu-item') && !!(globalThis.Luker||globalThis.SillyTavern)?.getContext")) break; } catch {}
    await sleep(100);
  }
  await page.evaluate(PRELUDE);
  // 插件比宿主读完设定更早挂上；宿主设定就绪前它会把所有存档都改排成延迟存档，真实使用者碰不到这段
  for (let i = 0; i < 300; i++) {
    try { if (await page.evaluate("(async()=>{ try { return (await import('/script.js')).settingsReady !== false; } catch { return true; } })()")) break; } catch {}
    await sleep(100);
  }
}
// 用页面自己的 location.reload()：CDP 的 Page.reload 不触发 beforeunload，量不到离开前的补存
async function reload(page) {
  // 真实使用者一定点过页面；Chrome 要有过使用者操作，离开时才会跳确认框
  for (const type of ['mousePressed', 'mouseReleased']) await page.rpc('Input.dispatchMouseEvent', { type, x: 5, y: 5, button: 'left', clickCount: 1 });
  await page.rpc('Runtime.evaluate', { expression: 'setTimeout(() => location.reload(), 0); true' });
  await sleep(1500);
  await boot(page);
  await page.evaluate('__p.openCard()');
  await sleep(500);
}

const results = { kind, S1: {}, S2: null };
let pageA, pageB;
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
  pageA = await connect(targets.find(t => t.type === 'page').webSocketDebuggerUrl, 'A');
  if (tauri) await pageA.rpc('Page.reload', { ignoreCache: true });
  else await pageA.rpc('Page.navigate', { url: `http://127.0.0.1:${port}/` });
  await sleep(1500);
  await boot(pageA);

  // Card import and chat
  await pageA.evaluate(`(async()=>{
    const { ctx, assert } = __p;
    localStorage.removeItem('persist-chat');
    await ctx().getCharacters();
    if (!ctx().characters.some(card => card.name === '${CARD}')) {
      const card = { spec: 'chara_card_v2', spec_version: '2.0', data: { name: '${CARD}', description: '存档复现用临时角色。', personality: '', scenario: '', first_mes: '复现开始。', mes_example: '', creator_notes: '', system_prompt: '', post_history_instructions: '', alternate_greetings: [], tags: [], creator: 'test', character_version: '1.1.5', extensions: {} } };
      const form = new FormData(); form.set('file_type', 'json'); form.set('avatar', new File([JSON.stringify(card)], 'persist.json', { type: 'application/json' }));
      const headers = { ...ctx().getRequestHeaders() }; delete headers['Content-Type']; delete headers['content-type'];
      assert((await fetch('/api/characters/import', { method: 'POST', headers, body: form })).ok, 'Card import failed');
    }
    await __p.openCard(null);
    await ctx().saveChat?.();
    return true;
  })()`);

  // S1: reload shortly after a registration
  for (const delay of [200, 1200, 3000]) {
    const name = '延迟' + delay;
    await pageA.evaluate(`__p.register(${JSON.stringify(name)})`);
    await sleep(delay);
    await reload(pageA);
    const names = await pageA.evaluate('__p.names()');
    results.S1[delay + 'ms'] = names.includes(name) ? 'kept' : 'LOST';
  }

  // S2: a stale second tab saves after tab A registered (browser tabs only; TauriTavern has a single window)
  if (!tauri) {
    const created = await (await fetch(`http://127.0.0.1:${browserPort}/json/new?about:blank`, { method: 'PUT' })).json();
    pageB = await connect(created.webSocketDebuggerUrl, 'B');
    await pageB.rpc('Page.navigate', { url: `http://127.0.0.1:${port}/` });
    await sleep(1500);
    await boot(pageB);
    await pageB.evaluate('__p.openCard()');
    await sleep(500);
    const staleView = await pageB.evaluate('__p.names()');
    await pageA.evaluate(`(async()=>{ await __p.register('双分页'); const { s } = await __p.mods(); await s.saveSettingsNow(__p.ctx()); return true; })()`);
    await sleep(1500);
    // 旧分页 B 做任何会存设定的事（这里直接触发宿主的存档）
    await pageB.evaluate(`(async()=>{ const { s } = await __p.mods(); s.saveSettings(__p.ctx()); await __p.wait(2500); return true; })()`);
    await sleep(1000);
    await reload(pageA);
    const afterA = await pageA.evaluate('__p.names()');
    results.S2 = { staleTabSawBefore: staleView, newCharacterAfterStaleSave: afterA.includes('双分页') ? 'kept' : 'LOST' };
  }

  // Clean up the test card and its chat state on the installed TauriTavern
  if (tauri) {
    await pageA.evaluate(`(async()=>{
      const ctx = __p.ctx(); const { s } = await __p.mods();
      await ctx.executeSlashCommandsWithOptions?.('/closechat');
      await ctx.getCharacters();
      const card = ctx.characters.find(c => c.name === '${CARD}');
      if (card) await fetch('/api/characters/delete', { method: 'POST', headers: ctx.getRequestHeaders(), body: JSON.stringify({ avatar_url: card.avatar, delete_chats: true }) });
      return true;
    })()`);
  }
  results.unloadDialogs = dialogs;
  results.exceptions = exceptions.filter(Boolean);
  results.artifacts = artifacts;
  console.log(JSON.stringify(results, null, 2));
} catch (error) {
  console.log(JSON.stringify({ kind, error: error.message, results, exceptions, artifacts }, null, 2));
  process.exitCode = 1;
} finally {
  if (serverLog) writeFileSync(join(artifacts, 'server.log'), serverLog);
  for (const page of [pageA, pageB]) { try { page?.ws.close(); } catch {} }
  browser?.kill(); server?.kill();
}
