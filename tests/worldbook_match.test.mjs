// 主流模式的世界书：宿主自己算触发时要给对格式、排除名单要生效；后备的关键字比对贴近宿主规则。
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildWorldInfoScanChat, findWorldInfoMissingFromSnapshot, removeExcludedWorldInfoEntries, stripExcludedFromSnapshot } from '../scripts/worldinfo_resolve.js';
import { isOwnRequest, markOwnRequest } from '../scripts/own_requests.js';
import { worldbookEntryKeywordsMatch } from '../scripts/worldbook_match.js';

const said = (...texts) => texts.map((text, index) => ({ name: index % 2 ? '罗希娜' : '我', text }));

test('宿主扫描用的聊天：「名字: 内容」字串、最新的在前、略过系统讯息', () => {
  const chat = [
    { name: '我', mes: '第一句' },
    { name: '系统', mes: '旁白', is_system: true },
    { name: '罗希娜', mes: '第二句' },
  ];
  assert.deepEqual(buildWorldInfoScanChat(chat), ['罗希娜: 第二句', '我: 第一句']);
});

test('排除名单：角色侧名单管角色书、聊天书与人设书，全域名单只管全域书', () => {
  const data = {
    globalLore: [{ world: '通用', comment: '天气' }, { world: '通用', comment: '晚餐' }],
    characterLore: [{ world: '卡书', comment: '晚餐' }, { world: '卡书', comment: 'NPC/威廉' }],
    chatLore: [{ world: '聊天书', comment: 'NPC/威廉' }],
    personaLore: [],
  };
  const removed = removeExcludedWorldInfoEntries(data, {
    character: new Set(['NPC/威廉']),
    global: new Set(['通用 :: 天气']),
  });
  assert.equal(removed.length, 3);
  assert.deepEqual(data.globalLore.map((entry) => entry.comment), ['晚餐']);
  assert.deepEqual(data.characterLore.map((entry) => entry.comment), ['晚餐']);
  assert.deepEqual(data.chatLore, []);
});

test('后备比对只扫最近两则，条目自己的扫描深度优先', () => {
  const messages = said('聊起父亲', '嗯', '今晚吃什么');
  assert.equal(worldbookEntryKeywordsMatch({ key: ['父亲'] }, messages), false, '父亲在第三则之前，预设深度 2 扫不到');
  assert.equal(worldbookEntryKeywordsMatch({ key: ['父亲'], scanDepth: 3 }, messages), true);
  assert.equal(worldbookEntryKeywordsMatch({ key: ['吃什么'] }, messages), true);
});

test('后备比对：次要关键字照宿主的四种逻辑', () => {
  const messages = said('晚餐时聊起父亲');
  const entry = (selectiveLogic, keysecondary) => ({ key: ['晚餐'], keysecondary, selective: true, selectiveLogic });
  assert.equal(worldbookEntryKeywordsMatch(entry(0, ['父亲', '母亲']), messages), true, 'AND ANY');
  assert.equal(worldbookEntryKeywordsMatch(entry(1, ['父亲', '母亲']), messages), true, 'NOT ALL：没有全中');
  assert.equal(worldbookEntryKeywordsMatch(entry(2, ['父亲']), messages), false, 'NOT ANY：中了就不触发');
  assert.equal(worldbookEntryKeywordsMatch(entry(3, ['父亲', '母亲']), messages), false, 'AND ALL：要全中');
});

test('后备比对：支援 /正则/ 关键字，写坏的正则不触发', () => {
  assert.equal(worldbookEntryKeywordsMatch({ key: ['/罗希[娜那]/'] }, said('罗希那来了')), true);
  assert.equal(worldbookEntryKeywordsMatch({ key: ['/(/'] }, said('(')), false);
});

const ctx = { substituteParams: (text) => text.replaceAll('{{user}}', '先生') };
const NPC_YING = '应珩：大梁来的应龙，龙脉的守护者，外表是二十多岁的青年。';
const NPC_ALICE = '爱丽丝：user 的母亲，实验室里的声乐专家，擅长唤回失声者。';

test('快照补漏：宿主这一刻会触发、快照里没有的纯文字条目才补', () => {
  const snapshot = { messages: [{ role: 'user', content: `前情……${NPC_ALICE}……` }] };
  const resolved = {
    activationText: `${NPC_ALICE}\n${NPC_YING}\n<%= getvar('x') %>：模板条目的内容，长度足够比对用。`,
    candidateEntries: [
      { comment: 'NPC/爱丽丝', content: NPC_ALICE },
      { comment: 'NPC/应珩', content: NPC_YING },
      { comment: '模板', content: "<%= getvar('x') %>：模板条目的内容，长度足够比对用。" },
      { comment: '没触发', content: '这条这轮没有被宿主触发，所以不在试算结果里。' },
    ],
  };
  assert.deepEqual(findWorldInfoMissingFromSnapshot(ctx, snapshot, resolved).map((item) => item.name), ['NPC/应珩']);
});

test('快照排除：纯文字条目（巨集照宿主替换后）从快照删掉，含模板的回报认不出来', () => {
  const plain = { comment: 'NPC/威廉', content: '威廉：{{user}}的父亲，二十年前死于晶震铁路的隧道事故。' };
  const templated = { comment: '状态', content: "<%= getvar('stat_data') %> 这段会被主流渲染成别的样子。" };
  const snapshot = { messages: [
    { role: 'system', content: '威廉：先生的父亲，二十年前死于晶震铁路的隧道事故。' },
    { role: 'user', content: '其余背景' },
  ] };
  const result = stripExcludedFromSnapshot(ctx, snapshot, [plain, templated]);
  assert.deepEqual(result.stripped, ['NPC/威廉']);
  assert.deepEqual(result.unmatched, ['状态']);
  assert.deepEqual(result.snapshot.messages.map((message) => message.content), ['其余背景'], '删空的讯息整则拿掉');
  assert.equal(snapshot.messages.length, 2, '不改动原快照');
});

test('自己发出的请求只认那一个选项物件，同时间别人的请求照常拦截', () => {
  const mine = markOwnRequest({ method: 'POST' });
  assert.equal(isOwnRequest(mine), true);
  assert.equal(isOwnRequest({ method: 'POST' }), false);
  assert.equal(isOwnRequest(undefined), false);
});

test('快照比对忽略空白差异；常驻条目就算比对不到也不补', () => {
  const DEPTH_ENTRY = '<罗希娜_id2>\n对角色的理解与思考:\n\n  关于校正权能: |\n    冷酷的执行力源于权能';
  // 宿主合并深度注入时改了缩排与空行
  const snapshot = { messages: [{ role: 'system', content: '<罗希娜_id2>\n对角色的理解与思考:\n关于校正权能: |\n冷酷的执行力源于权能\n其他' }] };
  const resolved = {
    activationText: `${DEPTH_ENTRY}\n常驻但被别的扩充拿掉的内容，长度足够比对用。`,
    candidateEntries: [
      { comment: '二次解释', content: DEPTH_ENTRY },
      { comment: '[mvu_plot]格式', constant: true, content: '常驻但被别的扩充拿掉的内容，长度足够比对用。' },
    ],
  };
  assert.deepEqual(findWorldInfoMissingFromSnapshot(ctx, snapshot, resolved), []);
  const stripped = stripExcludedFromSnapshot(ctx, snapshot, [{ comment: '二次解释', content: DEPTH_ENTRY }]);
  assert.deepEqual(stripped.stripped, ['二次解释']);
  assert.equal(stripped.snapshot.messages[0].content.trim(), '其他');
});

test('世界书模式只剩主流与参考：旧的正常模式（exclude）读进来就是主流，排除名单照旧', async () => {
  const state = await import('../scripts/state.js');
  assert.equal(state.normalizeWorldbookMode('exclude'), 'mainflow');
  assert.equal(state.normalizeWorldbookMode(''), 'mainflow');
  assert.equal(state.normalizeWorldbookMode('allowlist_all'), 'allowlist_all');
  const ctx = { extensionSettings: { bs_biotracker: { trackerWorldbookMode: 'exclude', trackerWorldbookExcludeNames: 'NPC/威廉' } }, saveSettingsDebounced() {} };
  const settings = state.getSettings(ctx);
  assert.equal(settings.trackerWorldbookMode, 'mainflow');
  assert.equal(settings.trackerWorldbookExcludeNames, 'NPC/威廉');
});
