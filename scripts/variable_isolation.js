// 插件与卡片的变量系统互不干扰。插件注入给主流的状态（<bs_biotracker> 段）是一大段 JSON，
// 路径长得像变量，变量系统的模型会照抄成更新：
// - MVU：另外送一次「额外模型解析」，曾把插件字段写成 /角色/profile/pregnant/laborEffort 的 JSONPatch，
//   MVU 套不上而报错。解析请求送出前把插件那段拿掉（见 index.js 的 installVariableIsolation）。
// - 小白 X 变量 2.0：由主流模型在回复里直接写 <state> 区块，不能把注入从主流请求拿掉，靠注入里的说明防范。
// - 酒馆本身的变量（/setvar、{{getvar}}）只由脚本与宏写入，模型回复不会写进去，不受影响。
// 讯息里这些变量更新区块不是剧情，送给追踪模型前去掉。
const BIOTRACKER_BLOCK = /<bs_biotracker>[\s\S]*?<\/bs_biotracker>/g;
const MVU_UPDATE_BLOCK = /<UpdateVariable>[\s\S]*?(?:<\/UpdateVariable>|$)/gi;
// <state> 太通用，有些卡拿来做状态栏；只在小白 X 的变量模组载入时才当成变量更新
const LWB_STATE_BLOCK = /<state(?:\s[^>]*)?>[\s\S]*?<\/state>/gi;

function stripText(text, pattern) {
  return String(text).replace(pattern, '').replace(/\n{3,}/g, '\n\n').trim();
}

/** 从一组聊天补全讯息里拿掉插件注入的状态段；整则只剩空白就移除。回传拿掉了几段 */
export function stripBioTrackerInjection(messages) {
  if (!Array.isArray(messages)) return 0;
  let removed = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || typeof message.content !== 'string' || !message.content.includes('<bs_biotracker>')) continue;
    removed += (message.content.match(BIOTRACKER_BLOCK) || []).length;
    const content = stripText(message.content, BIOTRACKER_BLOCK);
    if (content) message.content = content;
    else messages.splice(index, 1);
  }
  return removed;
}

/** 讯息正文去掉变量系统的更新区块：MVU 的 <UpdateVariable>，以及小白 X 载入时的 <state> */
export function stripVariableUpdateBlocks(text, { lwbState = Boolean(globalThis.LWB_StateV2) } = {}) {
  let value = String(text ?? '');
  if (value.includes('<UpdateVariable')) value = stripText(value, MVU_UPDATE_BLOCK);
  if (lwbState && /<state[\s>]/i.test(value)) value = stripText(value, LWB_STATE_BLOCK);
  return value;
}
