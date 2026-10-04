// Real native-host integration using temporary config/data and a workspace plugin junction.
// Usage: node tests/check-card-settings-host.mjs D:/SillyTavern sillytavern
//        node tests/check-card-settings-host.mjs D:/Luker luker
// Retains isolated evidence/data in the OS temp folder; never touches normal user chats.
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
const artifacts = mkdtempSync(join(tmpdir(), 'biotracker-' + kind + '-real-'));
const dataRoot = join(artifacts, 'data');
const extensionRoot = join(dataRoot, 'default-user', 'extensions');
mkdirSync(extensionRoot, { recursive: true });
const extensionName = 'st_bs_biotracker_v113_test';
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
let browser, ws, sequence = 0; const pending = new Map(); let exceptions = 0;
const rpc = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }));
  setTimeout(() => { if (pending.delete(id)) reject(Error('Timeout ' + method)); }, 15000).unref();
});
async function evaluate(expression) {
  const r = await rpc('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function expect(expression, label) {
  for (let i = 0; i < 150; i++) { if (await evaluate(expression)) return; await sleep(100); }
  throw Error(label);
}
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
    if (pending.has(m.id)) { const task = pending.get(m.id); pending.delete(m.id); m.error ? task.reject(Error('CDP failed')) : task.resolve(m.result); }
    else if (m.method === 'Runtime.exceptionThrown') exceptions++;
  });
  await rpc('Runtime.enable'); await rpc('Page.enable');
  await rpc('Page.navigate', { url: `http://127.0.0.1:${port}/` });
  await expect("!!document.querySelector('#bs-biotracker-modal') && !!(globalThis.Luker||globalThis.SillyTavern)?.getContext", 'Workspace plugin did not mount');
  const receipt = await evaluate(`(async()=>{
    const ctx=()=> (globalThis.Luker||globalThis.SillyTavern).getContext();
    const assert=(condition,message)=>{if(!condition)throw Error(message)};
    const extensionModule = await import('/scripts/extensions.js');
    const base=extensionModule.extensionTypes['third-party/st_bs_biotracker_v113_test']==='local'
      ? '/scripts/extensions/third-party/st_bs_biotracker_v113_test' : null;
    assert(base,'Workspace extension must take precedence');
    const source=await(await fetch(base+'/index.js')).text();
    const sourceHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(source)))).map(n=>n.toString(16).padStart(2,'0')).join('');
    const s=await import(base+'/scripts/state.js');
    const c=await import(base+'/scripts/card_settings.js');
    const payload={version:1,racePhysiologyOverrides:{西方龙:{breedTolerance:3,embryoType:'胎生'}},reproductiveSettings:{condomReliability:0},worldBaselinePrompt:'测试世界',skills:{catalog:[{name:'剑术',description:'长剑实战'}],baselinePrompt:'冒险技能'}};
    const name='BS113隔离验收';
    const card={spec:'chara_card_v2',spec_version:'2.0',data:{name,description:'临时验收角色。',personality:'',scenario:'',first_mes:'验收开始。',mes_example:'',creator_notes:'',system_prompt:'',post_history_instructions:'',alternate_greetings:[],tags:[],creator:'test',character_version:'1.1.3',extensions:{bs_biotracker:payload,other:{keep:true}}}};
    const form=new FormData();form.set('file_type','json');form.set('avatar',new File([JSON.stringify(card)],'fixture.json',{type:'application/json'}));
    const headers={...ctx().getRequestHeaders()};delete headers['Content-Type'];delete headers['content-type'];
    const response=await fetch('/api/characters/import',{method:'POST',headers,body:form});
    assert(response.ok,'Card import failed');const imported=await response.json();assert(!imported.error,'Import rejected');
    await ctx().getCharacters();const id=ctx().characters.findIndex(card=>card.name===name);assert(id>=0,'Imported card not listed');
    await ctx().selectCharacterById(id);
    await s.hydrateChatStateFromHost(ctx(),s.getSettings(ctx()));
    const settings=s.getSettings(ctx());const chat=s.getChatState(ctx(),settings);
    assert(chat.cardSkillSeedApplied && chat.skillCatalog[0]?.name==='剑术','Automatic seed failed');
    await c.updateCardSettings(ctx(),{racePhysiologyOverrides:{西方龙:{embryoType:'胎生'}},worldBaselinePrompt:''});
    const read=async()=>{const r=await fetch('/api/characters/get',{method:'POST',headers:ctx().getRequestHeaders(),body:JSON.stringify({avatar_url:ctx().characters[id].avatar})});assert(r.ok,'Stored card unreadable');return r.json()};
    let stored=await read();assert(stored.data.extensions.bs_biotracker.racePhysiologyOverrides.西方龙.breedTolerance===undefined,'Deleted field returned from disk');assert(stored.data.extensions.other.keep,'Other extension lost');
    assert(c.getEffectiveSettings(ctx(),settings).worldBaselinePrompt==='','Empty card baseline ignored');
    await c.updateCardSettings(ctx(),{skills:c.exportCardSkillSeed(chat)});
    stored=await read();assert(!('id' in stored.data.extensions.bs_biotracker.skills.catalog[0]),'Skill ID exported');
    await c.updateCardSettings(ctx(),{skills:undefined,racePhysiologyOverrides:undefined,worldBaselinePrompt:undefined,reproductiveSettings:undefined});
    stored=await read();assert(!('bs_biotracker' in stored.data.extensions),'Final namespace not deleted');assert(stored.data.extensions.other.keep,'Sibling lost on delete');
    return {sourceHash,automaticSeed:true,persistentNestedDelete:true,skillExportWithoutIds:true,namespaceDelete:true,siblingPreserved:true,writeApi:typeof ctx().writeExtensionField};
  })()`);
  const expectedHash = createHash('sha256').update(readFileSync(join(root, 'index.js'))).digest('hex');
  if (receipt.sourceHash !== expectedHash) throw Error('Loaded source differs from workspace');
  const output = { kind, hostVersion: JSON.parse(readFileSync(join(hostRoot, 'package.json'))).version, pluginVersion: JSON.parse(readFileSync(join(root, 'manifest.json'))).version, ...receipt, unhandledExceptions: exceptions, isolatedData: true, artifacts };
  writeFileSync(join(artifacts, 'receipt.json'), JSON.stringify(output, null, 2));
  console.log(JSON.stringify(output, null, 2));
} catch (error) {
  console.log(JSON.stringify({ kind, error: error.message, artifacts })); throw error;
} finally {
  writeFileSync(join(artifacts, 'server.log'), serverLog);
  if (ws) { try { await rpc('Browser.close'); } catch {} ws.close(); }
  browser?.kill(); server.kill();
}
