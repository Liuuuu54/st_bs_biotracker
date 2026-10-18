// 插件与卡片的变量系统互不干扰：MVU 额外解析看不到插件的状态段；追踪看不到变量系统的更新区块。
import assert from 'node:assert/strict';
import test from 'node:test';

import * as state from '../scripts/state.js';
import { stripBioTrackerInjection, stripVariableUpdateBlocks } from '../scripts/variable_isolation.js';
import { buildMainFlowStatePrompt, buildTrackerSystemPrompt } from '../scripts/tracker_prompt_context.js';

test('MVU 额外解析的请求拿掉插件状态段；整则只剩空白就移除，其余内容保留', () => {
  const messages = [
    { role: 'system', content: '角色卡设定' },
    { role: 'system', content: '<bs_biotracker>\n[当前已注册角色状态]\n{"甲":{"profile":{}}}\n</bs_biotracker>' },
    { role: 'user', content: '前文\n<bs_biotracker>状态</bs_biotracker>\n后文' },
  ];
  assert.equal(stripBioTrackerInjection(messages), 2);
  assert.deepEqual(messages.map((message) => message.content), ['角色卡设定', '前文\n\n后文']);
  assert.equal(stripBioTrackerInjection(null), 0);
});

test('讯息正文去掉 MVU 的 UpdateVariable 区块，没有就原样', () => {
  const text = '她又推了二十分钟。\n\n<UpdateVariable>\n<JSONPatch>[{"op":"delta","path":"/甲/profile/pregnant/pushFatigue"}]</JSONPatch>\n</UpdateVariable>\n\n<StatusPlaceHolderImpl/>';
  assert.equal(stripVariableUpdateBlocks(text), '她又推了二十分钟。\n\n<StatusPlaceHolderImpl/>');
  assert.equal(stripVariableUpdateBlocks('普通正文'), '普通正文');
  assert.equal(stripVariableUpdateBlocks('写到一半<UpdateVariable>{"op"'), '写到一半', '没收尾的区块也去掉');
});

test('小白 X 的 <state> 只在它的变量模组载入时才去掉，免得误删卡片自己的状态栏', () => {
  const text = '正文\n<state>\n数据.背包.0.数量: 4\n</state>';
  assert.equal(stripVariableUpdateBlocks(text, { lwbState: true }), '正文');
  assert.equal(stripVariableUpdateBlocks(text, { lwbState: false }), text);
});

test('送给追踪的近期讯息不带 MVU 更新区块', () => {
  const ctx = { chatId: 'mvu-isolation', chat: [{ name: '甲', mes: '正文<UpdateVariable>patch</UpdateVariable>' }], extensionSettings: {}, saveSettingsDebounced() {} };
  globalThis.SillyTavern = { getContext: () => ctx };
  const [message] = state.buildRecentMessages(ctx, state.getSettings(ctx));
  assert.equal(message.text, '正文');
});

test('注入给主流的状态说明不是 MVU 变量；穿越只跳过日历、实际度过的时间照常推进', () => {
  const mainflow = buildMainFlowStatePrompt({ existing_state: { 甲: { name: '甲', profile: { base: { stage: '卵泡期' } } } } });
  assert.match(mainflow, /不是 MVU、小白 X 或任何变量系统的变量/);
  const tracker = buildTrackerSystemPrompt('', null, {});
  assert.match(tracker, /日历的跳动本身不推进时间/);
  assert.match(tracker, /实际度过的时间照常用 bsPassedTime 推进/);
});
