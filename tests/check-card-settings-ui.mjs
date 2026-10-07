// Browser interaction regression against isolated mock hosts; no live chats or model calls.
// node tests/check-card-settings-ui.mjs (Chrome / Node 22+; CHROME_PATH may override executable)
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
const artifacts = mkdtempSync(join(tmpdir(), 'biotracker-card-ui-'));
const fixture = `
  const { createEmptyChatState } = await import('/scripts/state.js');
  const kind = new URLSearchParams(location.search).get('host');
  const fresh = createEmptyChatState();
  fresh.characters = chatState.characters;
  const initial = {version:1,skills:{catalog:[{name:'剑术',description:'长剑实战'}],baselinePrompt:'冒险技能'},
    worldBaselinePrompt:'卡片世界', reproductiveSettings:{condomReliability:0},
    racePhysiologyOverrides:{西方龙:{embryoType:'胎生'}}};
  ctx.characters[0].data = {extensions:{bs_biotracker:initial,other:{keep:true}}};
  Object.assign(ctx.extensionSettings.bs_biotracker,{worldBaselinePrompt:'全域世界',
    reproductiveSettings:{condomReliability:0.75,condomCapacity:60},
    racePhysiologyOverrides:{西方龙:{breedTolerance:3,embryoType:'卵生'}},
    chatStates:kind==='sillytavern'?{[CHAT_KEY]:fresh}:{}});
  let stored = structuredClone(fresh);
  ctx.writeExtensionField = async (id,key,value) => {
    if(value==='__@@UNSET@@__')delete ctx.characters[id].data.extensions[key];
    else ctx.characters[id].data.extensions[key]=structuredClone(value);
  };
  if(kind==='tauritavern')globalThis.__TAURITAVERN__={ready:Promise.resolve(),api:{chat:{current:{handle:()=>({
    stableId:async()=> 'ui-card-stable',store:{getJson:async()=>({version:1,chatState:structuredClone(stored)}),setJson:async({value})=>{stored=structuredClone(value.chatState)}}
  })}}}};
  if(kind==='luker'){
    ctx.getChatState=async()=>({version:1,chatState:structuredClone(stored)});
    ctx.updateChatState=async(namespace,updater)=>{stored=structuredClone((await updater({version:1,chatState:stored})).chatState)};
    globalThis.Luker={getContext:()=>ctx};
  }
  globalThis.__cardUiCtx=ctx;
  globalThis.__cardUiStored=()=>stored;
`;
const server = createServer((request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    const path = resolve(root, '.' + decodeURIComponent(url.pathname));
    if (!path.startsWith(resolve(root) + sep)) throw Error('Outside root');
    let body = readFileSync(path);
    if (path.endsWith('ui-harness.html')) body = Buffer.from(body.toString().replace("await import('/index.js');", fixture + "\nawait import('/index.js');"));
    response.setHeader('Content-Type', path.endsWith('.html') ? 'text/html;charset=utf-8' : path.endsWith('.css') ? 'text/css' : path.endsWith('.json') ? 'application/json' : 'text/javascript;charset=utf-8');
    response.end(body);
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(ok => server.listen(0, '127.0.0.1', ok));
const browser = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + artifacts, '--no-first-run', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
let ws, sequence = 0;
const pending = new Map(), errors = [], receipts = [];
const rpc = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }));
  setTimeout(() => { if (pending.delete(id)) reject(Error('Timeout: ' + method)); }, 15000).unref();
});
async function evaluate(expression) {
  const result = await rpc('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
async function expect(expression, label) {
  for (let i = 0; i < 80; i++) { if (await evaluate(expression)) return; await sleep(100); }
  throw Error(label);
}
async function click(selector) {
  const box = await evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});n?.scrollIntoView({block:'center'});const r=n?.getBoundingClientRect();return r&&{x:r.x+(n.tagName==='SUMMARY'?12:r.width/2),y:r.y+r.height/2,w:r.width,h:r.height,disabled:n.disabled};})()`);
  if (!box?.w || !box?.h || box.disabled) throw Error('Control unavailable: ' + selector);
  await rpc('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
  await rpc('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
}
async function set(selector, value) {
  await evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});n.value=${JSON.stringify(value)};n.dispatchEvent(new Event(n.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`);
}
try {
  let port;
  for (let i = 0; i < 80; i++) { try { port = readFileSync(join(artifacts, 'DevToolsActivePort'), 'utf8').split('\n')[0]; break; } catch {} await sleep(100); }
  if (!port) throw Error('Browser did not start');
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  ws = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((ok, fail) => { ws.addEventListener('open', ok, { once: true }); ws.addEventListener('error', fail, { once: true }); });
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (pending.has(message.id)) { const task = pending.get(message.id); pending.delete(message.id); message.error ? task.reject(Error(JSON.stringify(message.error))) : task.resolve(message.result); }
    else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
  });
  await rpc('Runtime.enable'); await rpc('Page.enable');
  await rpc('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });
  for (const host of ['sillytavern', 'tauritavern', 'luker']) {
    const beforeErrors = errors.length;
    await rpc('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/tests/ui-harness.html?host=${host}` });
    await expect("document.querySelector('#bs-biotracker-modal')?.getBoundingClientRect().width>0", host + ': panel');
    await evaluate(`(async()=>{globalThis.__cardUiState=await import('/scripts/state.js');globalThis.__cardUiChat=()=>__cardUiState.getChatState(__cardUiCtx,__cardUiState.getSettings(__cardUiCtx));})()`);
    await expect('__cardUiChat().skillCatalog.length===1 && __cardUiChat().cardSkillSeedApplied', host + ': auto seed');
    await click('#bs-bt-home-button');
    await click('[data-nav-view="skill-catalog"]');
    await set('#bs-bt-skill-baseline-prompt', '当前聊天规则'); await click('#bs-bt-skill-baseline-save');
    await click('#bs-bt-card-skills-save');
    await expect("__cardUiCtx.characters[0].data.extensions.bs_biotracker.skills.baselinePrompt==='当前聊天规则'", host + ': save seed');
    await expect("!document.querySelector('#bs-bt-card-skills-save').disabled", host + ': save done');
    await click('#bs-bt-card-skills-remove');
    await expect('!__cardUiCtx.characters[0].data.extensions.bs_biotracker.skills && __cardUiChat().skillCatalog.length===1', host + ': remove seed preserves chat');
    await expect("!document.querySelector('#bs-bt-card-skills-save').disabled", host + ': remove done');
    await click('#bs-bt-card-skills-save');
    await expect("!document.querySelector('#bs-bt-card-skills-save').disabled", host + ': resave done');
    await click('#bs-bt-home-button');
    await click('[data-nav-view="race-encyclopedia"]');
    await click('[data-encyclopedia-tab="world"]');
    await expect("document.querySelector('#bs-bt-world-baseline-prompt').value==='全域世界'", host + ': global editor');
    await expect("!!document.querySelector('[data-catalog-kind=\"race\"][data-catalog-name=\"人类\"]')", host + ': human catalog checkbox');
    await set('#bs-bt-world-setting-target', 'card');
    await expect("document.querySelector('#bs-bt-world-baseline-prompt').value==='卡片世界'", host + ': card editor');
    await set('#bs-bt-world-baseline-prompt', '保存的卡片世界'); await click('#bs-bt-world-baseline-save');
    await expect("__cardUiCtx.characters[0].data.extensions.bs_biotracker.worldBaselinePrompt==='保存的卡片世界' && __cardUiState.getSettings(__cardUiCtx).worldBaselinePrompt==='全域世界'", host + ': baseline isolation');
    await click('#bs-bt-realistic-world');
    await expect("__cardUiCtx.characters[0].data.extensions.bs_biotracker.realisticWorld===true && __cardUiState.getSettings(__cardUiCtx).realisticWorld!==true && document.querySelector('#bs-bt-catalog-checklist').classList.contains('is-disabled')", host + ': realistic world on card');
    await click('#bs-bt-special-tool-wombReturn');
    await expect("__cardUiCtx.characters[0].data.extensions.bs_biotracker.specialTools.wombReturn===false && !('implantEmbryo' in __cardUiCtx.characters[0].data.extensions.bs_biotracker.specialTools)", host + ': special tool on card');
    await click('#bs-bt-realistic-world');
    await expect("__cardUiCtx.characters[0].data.extensions.bs_biotracker.realisticWorld===false && !document.querySelector('#bs-bt-catalog-checklist').classList.contains('is-disabled')", host + ': realistic world off');
    await click('[data-encyclopedia-tab="race"]');
    await expect("[...document.querySelectorAll('#bs-bt-race-select option')].some((option) => option.value==='人类') && document.querySelector('#bs-bt-race-count').textContent.startsWith('物种数量：81')", host + ': human in encyclopedia');
    await set('#bs-bt-race-select', '西方龙'); await click('#bs-bt-race-open-editor');
    await expect("document.querySelector('#bs-bt-race-introduction-line').value.startsWith('Western Dragon')", host + ': builtin introduction prefilled');
    await set('#bs-bt-race-field-breedTolerance', '4'); await click('#bs-bt-race-save-override');
    await expect("__cardUiCtx.characters[0].data.extensions.bs_biotracker.racePhysiologyOverrides.西方龙.breedTolerance===4 && __cardUiState.getSettings(__cardUiCtx).racePhysiologyOverrides.西方龙.breedTolerance===3", host + ': physiology isolation');
    await expect("!('introductionLine' in __cardUiCtx.characters[0].data.extensions.bs_biotracker.racePhysiologyOverrides.西方龙)", host + ': unchanged introduction not saved');
    await click('#bs-bt-race-open-editor'); await click('#bs-bt-race-reset-override');
    await expect("!__cardUiCtx.characters[0].data.extensions.bs_biotracker.racePhysiologyOverrides && document.querySelector('#bs-bt-race-output').textContent.includes('卵生')", host + ': clear card fallback');
    await click('[data-encyclopedia-tab="world"]');
    if (!await evaluate("document.querySelector('[data-encyclopedia-page=\"world\"] details').open")) await click('[data-encyclopedia-page="world"] summary');
    await expect("document.querySelector('[data-encyclopedia-page=\"world\"] details').open", host + ': reproductive disclosure');
    await set('#bs-bt-reproductive-condomCapacity', '25'); await click('#bs-bt-reproductive-save');
    await expect("__cardUiCtx.characters[0].data.extensions.bs_biotracker.reproductiveSettings.condomCapacity===25 && __cardUiState.getSettings(__cardUiCtx).reproductiveSettings.condomCapacity===60", host + ': reproductive isolation');
    await click('#bs-bt-card-baseline-reset');
    await expect("document.querySelector('#bs-bt-world-baseline-prompt').value==='全域世界' && !__cardUiCtx.characters[0].data.extensions.bs_biotracker.reproductiveSettings && !!__cardUiCtx.characters[0].data.extensions.bs_biotracker.skills", host + ': baseline clear preserves seed');
    await rpc('Emulation.setDeviceMetricsOverride', { width: 320, height: 900, deviceScaleFactor: 1, mobile: false });
    const shot = await rpc('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(artifacts, host + '-card-mobile.png'), Buffer.from(shot.data, 'base64'));
    if (errors.length > beforeErrors) throw Error(host + ': unhandled browser exceptions');
    receipts.push({ host, automaticSeed: true, skillSaveRemove: true, worldBaseline: true, physiologySaveReset: true, reproductiveSaveReset: true, siblingExtensionPreserved: await evaluate('__cardUiCtx.characters[0].data.extensions.other.keep===true'), mockHost: true });
    await rpc('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });
  }
  console.log(JSON.stringify({ receipts, browserErrors: errors, artifacts }, null, 2));
} catch (error) {
  try {
    console.log(JSON.stringify(await evaluate(`({view:document.querySelector('#bs-biotracker-settings')?.dataset.view,activePage:document.querySelector('[data-encyclopedia-page].is-active')?.dataset.encyclopediaPage,raceModalHidden:document.querySelector('#bs-bt-race-editor-modal')?.hidden,focused:document.activeElement?.id})`)));
    const shot = await rpc('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(artifacts, 'failure.png'), Buffer.from(shot.data, 'base64'));
    console.log('Artifacts: ' + artifacts);
  } catch {}
  throw error;
} finally {
  if (ws) { try { await rpc('Browser.close'); } catch {} ws.close(); }
  browser.kill(); server.close();
}
