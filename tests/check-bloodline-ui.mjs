// Local mock-host smoke check; requires Chrome and Node 22+, no live chat is touched.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
const root = fileURLToPath(new URL('../', import.meta.url));
const artifacts = mkdtempSync(join(tmpdir(), 'biotracker-bloodline-ui-'));
const server = createServer((request, response) => {
  try {
    const path = resolve(root, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
    if (!path.startsWith(resolve(root) + sep)) throw Error('Outside root');
    let body = readFileSync(path);
    if (path.endsWith('ui-harness.html')) body = Buffer.from(body.toString().replace("await import('/index.js');", `
      Object.assign(chatState.characters.艾拉.profile.base, {race:'精灵x人类',bloodline:{精灵:0.25,人类:0.75},bloodlineSource:'explicit'});
      await import('/index.js');`));
    response.setHeader('Content-Type', path.endsWith('.html') ? 'text/html;charset=utf-8' : path.endsWith('.css') ? 'text/css' : 'text/javascript;charset=utf-8');
    response.end(body);
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(ok => server.listen(0, '127.0.0.1', ok));
const chrome = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--remote-debugging-port=0', '--user-data-dir='+artifacts, '--no-first-run', '--disable-background-networking', 'about:blank'], {windowsHide:true,stdio:'ignore'});
let ws, sequence = 0;
const pending = new Map(), errors = [];
const call = (method,params={}) => new Promise((resolve,reject) => {
  const id=++sequence; pending.set(id,{resolve,reject}); ws.send(JSON.stringify({id,method,params}));
  setTimeout(()=>{if(pending.delete(id))reject(Error('Timeout: '+method))},15000).unref();
});
async function evaluate(expression) {
  const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
  if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
try {
  let port;for(let i=0;i<100;i++){try{port=readFileSync(join(artifacts,'DevToolsActivePort'),'utf8').split('\n')[0];break}catch{}await sleep(100)}
  if(!port)throw Error('Chrome did not start');
  const targets=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise((ok,fail)=>{ws.addEventListener('open',ok,{once:true});ws.addEventListener('error',fail,{once:true})});
  ws.addEventListener('message',event=>{const message=JSON.parse(event.data);if(pending.has(message.id)){const task=pending.get(message.id);pending.delete(message.id);message.error?task.reject(Error(JSON.stringify(message.error))):task.resolve(message.result)}else if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.text)});
  await call('Runtime.enable');await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride',{width:1400,height:1000,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/tests/ui-harness.html`});
  for(let i=0;i<150;i++){if(await evaluate("!!document.querySelector('[data-nav-view=\"track-list\"]')"))break;await sleep(100)}
  for(let i=0;i<100;i++){if(await evaluate("document.querySelector('#bs-biotracker-modal')?.getBoundingClientRect().width>0"))break;await sleep(100)}
  if(!await evaluate("document.querySelector('#bs-biotracker-modal')?.getBoundingClientRect().width>0"))throw Error('Panel did not open');
  await evaluate(`document.querySelector('[data-nav-view="track-list"]').click(); [...document.querySelectorAll('.bs-bt-track-character-button')].find(b=>b.querySelector('.bs-bt-track-character-name').textContent==='艾拉').click()`);
  if(!await evaluate("document.body.textContent.includes('精灵 25%')&&document.body.textContent.includes('人类 75%')"))throw Error('Overview bloodline missing');
  await evaluate(`document.querySelector('[data-track-tab="experience"]').click();document.querySelector('[data-lineage-center="艾拉"]').click()`);
  if(!await evaluate("document.querySelector('#bs-bt-lineage').textContent.includes('精灵 25%')"))throw Error('Lineage bloodline missing');
  if(!await evaluate("document.querySelector('#bs-bt-lineage').getBoundingClientRect().width>0"))throw Error('Lineage is hidden');
  if(errors.length)throw Error(JSON.stringify(errors));
  const {data}=await call('Page.captureScreenshot',{format:'png'});writeFileSync(join(artifacts,'lineage.png'),Buffer.from(data,'base64'));
  await evaluate(`document.querySelector('.bs-bt-lineage__close').click();document.querySelector('[data-nav-view="register"]').click();
    document.querySelector('#bs-bt-register-race').value='[血族-魔女]精灵50%x人类50%';
    document.querySelector('[data-race-picker-target="bs-bt-register-race"]').click()`);
  const palette = await evaluate(`(async()=>{
    const assert=(value,message)=>{if(!value)throw Error(message)};
    const modal=document.querySelector('#bs-bt-race-palette-modal');
    const numbers=()=>[...modal.querySelectorAll('input[type="number"][data-race-share-index]')];
    const edit=(index,value,type='number')=>{const input=modal.querySelector('input[type="'+type+'"][data-race-share-index="'+index+'"]');input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));return input};
    assert(!modal.hidden&&numbers().length===2,'Existing races not loaded');
    const list=modal.querySelector('.bs-bt-race-share-list');
    assert(Boolean(modal.querySelector('[data-race-action="append"]').compareDocumentPosition(list)&Node.DOCUMENT_POSITION_FOLLOWING),'Selected races must follow the add controls');
    assert(Boolean(list.compareDocumentPosition(modal.querySelector('[data-race-action="confirm"]'))&Node.DOCUMENT_POSITION_FOLLOWING),'Confirm must follow selected races');
    assert(modal.querySelector('#bs-bt-race-derived').value==='血族'&&modal.querySelector('#bs-bt-race-derived-subtype').value==='魔女','Derived subtype lost');
    edit(0,25);assert(Number(numbers()[1].value)===75,'Number balancing');
    const slider=edit(0,40,'range');assert(slider.isConnected&&Number(numbers()[0].value)===40&&Number(numbers()[1].value)===60,'Slider balancing or focus rebuild');
    edit(0,101);assert(modal.querySelector('[data-race-action="confirm"]').disabled,'Invalid input accepted');
    edit(0,25);assert(!modal.querySelector('[data-race-action="confirm"]').disabled,'Valid input did not recover');
    modal.querySelector('[data-race-action="equalize"]').click();assert(numbers().every(n=>Number(n.value)===50),'Equal distribution');
    edit(0,25);
    const select=modal.querySelector('#bs-bt-race-primary');select.value='矮人';select.dispatchEvent(new Event('change',{bubbles:true}));
    modal.querySelector('[data-race-action="append"]').click();assert(numbers().length===3,'Third race missing');
    assert(Math.abs(Number(numbers()[0].value)/Number(numbers()[1].value)-1/3)<1e-10,'Adding changed relative weights');
    modal.querySelector('[data-race-remove-index="2"]').click();assert(numbers().length===2&&Math.abs(Number(numbers()[0].value)-25)<1e-10,'Removal balancing');
    edit(0,25);
    return {numberInput:true,slider:true,autoBalance:true,invalidInput:true,equalize:true,addRemove:true,derivedSubtype:true};
  })()`);
  const desktop=await call('Page.captureScreenshot',{format:'png'});writeFileSync(join(artifacts,'palette-desktop.png'),Buffer.from(desktop.data,'base64'));
  await evaluate(`document.querySelector('#bs-bt-race-palette-modal [data-race-action="confirm"]').click()`);
  await evaluate(`(async()=>{const input=document.querySelector('#bs-bt-register-race');const {parseRaceDescriptor}=await import('/scripts/race_config.js');const parsed=parseRaceDescriptor(input.value);
    if(parsed.bloodline.精灵!==0.25||parsed.bloodline.人类!==0.75||parsed.derivedType!=='血族-魔女')throw Error('Weighted form value lost');
    const {applyRegistryResult}=await import('/scripts/registry.js');const {createEmptyChatState}=await import('/scripts/state.js');const chat=createEmptyChatState();applyRegistryResult(chat,{name:'比例测试',profile:{base:{race:input.value}}});
    if(Math.abs(280/chat.characters.比例测试.profile.bio.gestationSpeciesSpeed-350)>1e-10)throw Error('Registration is not weighted');
    document.querySelector('[data-race-picker-target="bs-bt-register-race"]').click();
    if(Number(document.querySelector('#bs-bt-race-palette-modal input[type="number"]').value)!==25)throw Error('Reopen lost weights');
  })()`);
  await call('Emulation.setDeviceMetricsOverride',{width:320,height:900,deviceScaleFactor:1,mobile:false});
  if(!await evaluate(`(()=>{const modal=document.querySelector('#bs-bt-race-palette-modal');return modal.scrollWidth<=modal.clientWidth&&document.documentElement.scrollWidth<=320})()`))throw Error('Mobile palette overflow');
  const mobile=await call('Page.captureScreenshot',{format:'png'});writeFileSync(join(artifacts,'palette-mobile.png'),Buffer.from(mobile.data,'base64'));
  // 写实世界：族谱改用人生阶段图示与类别名，不显示种族与血脉
  await call('Emulation.setDeviceMetricsOverride',{width:1400,height:1000,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/tests/ui-harness.html?realistic=1`});
  for(let i=0;i<150;i++){if(await evaluate("!!document.querySelector('[data-nav-view=\"track-list\"]')&&document.querySelector('#bs-biotracker-modal')?.getBoundingClientRect().width>0"))break;await sleep(100)}
  const realistic=await evaluate(`(async()=>{
    const wait=ms=>new Promise(ok=>setTimeout(ok,ms));
    document.querySelector('[data-nav-view="track-list"]').click();await wait(200);
    [...document.querySelectorAll('.bs-bt-track-character-button')].find(b=>b.querySelector('.bs-bt-track-character-name').textContent==='妈妈').click();await wait(200);
    document.querySelector('[data-track-tab="experience"]').click();document.querySelector('[data-lineage-center="妈妈"]').click();await wait(300);
    const cards=Object.fromEntries([...document.querySelectorAll('#bs-bt-lineage .bs-bt-lineage__card')].map(card=>[card.querySelector('.bs-bt-lineage__card-name').textContent,{
      icon:card.querySelector('.bs-bt-life-icon')?.getAttribute('aria-label')||null,
      raceIcon:!!card.querySelector('.bs-bt-race-icon:not(.bs-bt-life-icon)'),
      subs:[...card.querySelectorAll('.bs-bt-lineage__card-sub')].map(n=>n.textContent)}]));
    return cards;
  })()`);
  const expectedStages={外公:'精方',捐卵者:'卵方',宝宝:'婴儿',弟弟:'孩童',妹妹:'少年',晓雯:'成人',妈妈:'中年',外婆:'长者'};
  for(const [name,stage] of Object.entries(expectedStages)){
    const card=realistic[name];
    if(!card)throw Error('Realistic lineage missing '+name+': '+Object.keys(realistic));
    if(card.icon!==stage||card.raceIcon)throw Error(`${name} should show the ${stage} icon: ${JSON.stringify(card)}`);
    if(card.subs.join('|')!==stage)throw Error(`${name} should be labelled ${stage} without race or bloodline: ${card.subs}`);
  }
  const lifeShot=await call('Page.captureScreenshot',{format:'png'});writeFileSync(join(artifacts,'lineage-realistic.png'),Buffer.from(lifeShot.data,'base64'));
  if(errors.length)throw Error(JSON.stringify(errors));
  console.log(JSON.stringify({overview:true,lineage:true,realisticLineage:Object.keys(expectedStages).length,palette:{...palette,registration:true,reopen:true,mobileWidth:320},browserErrors:errors,artifacts,mockHost:true}));
} finally {
  if(ws){try{await call('Browser.close')}catch{}ws.close()}chrome.kill();server.close();
}
