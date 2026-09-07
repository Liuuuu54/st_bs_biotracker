import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import {
  buildOpenCodeSessionId,
  callOpenAICompatible,
  fetchModelList,
  getAuthHeaders,
  isOpenCodeApiBase,
  resolveOpenCodeFlow,
} from '../scripts/api.js';

const ORIGINAL_GLOBALS = {
  fetch: globalThis.fetch,
  window: globalThis.window,
  document: globalThis.document,
  location: globalThis.location,
  SillyTavern: globalThis.SillyTavern,
};

afterEach(() => {
  Object.entries(ORIGINAL_GLOBALS).forEach(([key, value]) => {
    if (value === undefined) delete globalThis[key];
    else globalThis[key] = value;
  });
  delete globalThis.__bs_biotracker_host_proxy_disabled__;
});

function installBrowserHost(fetchImpl, origin = 'http://localhost:8000') {
  globalThis.window = {};
  globalThis.document = { cookie: 'csrf_token=test-csrf' };
  globalThis.location = { origin, href: `${origin}/` };
  globalThis.SillyTavern = {
    getContext: () => null,
    getRequestHeaders: () => ({}),
  };
  globalThis.fetch = fetchImpl;
}

function jsonResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(data);
    },
  };
}

const TRACKER_SETTINGS = {
  apiUrl: 'https://opencode.ai/zen/go/v1/chat/completions',
  apiKey: 'go-key',
  model: 'muse-spark-1.3-contributor',
};

function trackerPayload(cardName, chatId = 'chat-1') {
  return { recent_messages: [], chat_id: chatId, current_character: { name: cardName } };
}

test('isOpenCodeApiBase 只认 opencode.ai 归属域名', () => {
  assert.equal(isOpenCodeApiBase('https://opencode.ai/zen/go/v1/chat/completions'), true);
  assert.equal(isOpenCodeApiBase('https://opencode.ai/zen/go/v1'), true);
  assert.equal(isOpenCodeApiBase('https://OPENCODE.AI/zen/go/v1'), true);
  assert.equal(isOpenCodeApiBase('https://go.opencode.ai/v1'), true);
  assert.equal(isOpenCodeApiBase('opencode.ai/zen/go/v1'), true);
  assert.equal(isOpenCodeApiBase('https://example-model-host.test/v1'), false);
  assert.equal(isOpenCodeApiBase('https://opencode.ai.evil.test/v1'), false);
  assert.equal(isOpenCodeApiBase('https://notopencode.ai/v1'), false);
  assert.equal(isOpenCodeApiBase(''), false);
  assert.equal(isOpenCodeApiBase('/v1'), false);
});

test('buildOpenCodeSessionId 非 opencode 渠道恒为空', () => {
  assert.equal(buildOpenCodeSessionId('https://example-model-host.test/v1', trackerPayload('A'), 'tracker'), '');
  assert.equal(buildOpenCodeSessionId('', trackerPayload('A'), 'tracker'), '');
});

test('buildOpenCodeSessionId 同 flow 同卡稳定、跨 flow 跨卡隔离', () => {
  const first = buildOpenCodeSessionId(TRACKER_SETTINGS.apiUrl, trackerPayload('愛麗絲'), 'tracker');
  const second = buildOpenCodeSessionId(TRACKER_SETTINGS.apiUrl, trackerPayload('愛麗絲'), 'tracker');
  assert.match(first, /^bsbt-tracker-[0-9a-f]{8}$/);
  assert.equal(second, first);
  const otherCard = buildOpenCodeSessionId(TRACKER_SETTINGS.apiUrl, trackerPayload('Bob'), 'tracker');
  assert.match(otherCard, /^bsbt-tracker-[0-9a-f]{8}$/);
  assert.notEqual(otherCard, first);
  const otherFlow = buildOpenCodeSessionId(TRACKER_SETTINGS.apiUrl, trackerPayload('愛麗絲'), 'diary');
  assert.match(otherFlow, /^bsbt-diary-[0-9a-f]{8}$/);
  assert.notEqual(otherFlow, first);
});

test('buildOpenCodeSessionId 同卡不同聊天隔离、无 chat_id 回退卡级', () => {
  const chat1 = buildOpenCodeSessionId(TRACKER_SETTINGS.apiUrl, trackerPayload('愛麗絲', 'chat-1'), 'tracker');
  const chat1Again = buildOpenCodeSessionId(TRACKER_SETTINGS.apiUrl, trackerPayload('愛麗絲', 'chat-1'), 'tracker');
  assert.equal(chat1Again, chat1);
  const chat2 = buildOpenCodeSessionId(TRACKER_SETTINGS.apiUrl, trackerPayload('愛麗絲', 'chat-2'), 'tracker');
  assert.match(chat2, /^bsbt-tracker-[0-9a-f]{8}$/);
  assert.notEqual(chat2, chat1);
  const noChat = buildOpenCodeSessionId(TRACKER_SETTINGS.apiUrl, { recent_messages: [], current_character: { name: '愛麗絲' } }, 'tracker');
  const noChatAgain = buildOpenCodeSessionId(TRACKER_SETTINGS.apiUrl, { recent_messages: [], current_character: { name: '愛麗絲' } }, 'tracker');
  assert.match(noChat, /^bsbt-tracker-[0-9a-f]{8}$/);
  assert.equal(noChatAgain, noChat);
});

test('resolveOpenCodeFlow 没传 flow 时按 target_character 回退', () => {
  assert.equal(resolveOpenCodeFlow({ recent_messages: [] }, ''), 'tracker');
  assert.equal(resolveOpenCodeFlow({ target_character: 'A' }, ''), 'registry');
  assert.equal(resolveOpenCodeFlow({ target_character: 'A' }, 'nope'), 'registry');
  assert.equal(resolveOpenCodeFlow({ target_character: 'A' }, 'skill'), 'skill');
  const fallback = buildOpenCodeSessionId(TRACKER_SETTINGS.apiUrl, { target_character: 'A' });
  assert.match(fallback, /^bsbt-registry-[0-9a-f]{8}$/);
});

test('getAuthHeaders 只在给了会话 ID 时带会话头', () => {
  assert.equal(getAuthHeaders({ apiKey: 'k' })['x-opencode-session'], undefined);
  assert.equal(getAuthHeaders({ apiKey: 'k' }, 'bsbt-tracker-1234abcd')['x-opencode-session'], 'bsbt-tracker-1234abcd');
  // 非法值直接丢弃：换行注入与伪造格式到不了发包头
  assert.equal(getAuthHeaders({ apiKey: 'k' }, 'bsbt-tracker-1234abcd\nX-Injected: 1')['x-opencode-session'], undefined);
  assert.equal(getAuthHeaders({ apiKey: 'k' }, 'not-a-session')['x-opencode-session'], undefined);
});

test('宿主代理路径：opencode 带会话头、其他渠道不带', async () => {
  const calls = [];
  installBrowserHost(async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({ choices: [{ message: { content: JSON.stringify({ operations: [] }) } }] });
  });

  await callOpenAICompatible(TRACKER_SETTINGS, trackerPayload('愛麗絲'), 'Return JSON.', { flow: 'tracker' });
  await callOpenAICompatible(
    { apiUrl: 'https://example-model-host.test/v1/chat/completions', apiKey: 'k', model: 'm' },
    trackerPayload('愛麗絲'),
    'Return JSON.',
    { flow: 'tracker' },
  );

  assert.equal(calls.length, 2);
  const sessionLines = (index) => JSON.parse(calls[index].options.body)
    .custom_include_headers.split('\n').filter((line) => line.startsWith('x-opencode-session: '));
  assert.equal(sessionLines(0).length, 1);
  assert.match(sessionLines(0)[0], /^x-opencode-session: bsbt-tracker-[0-9a-f]{8}$/);
  assert.deepEqual(sessionLines(1), []);
});

test('中途切换预设到非 opencode：头自动消失，切回即恢复同一 ID', async () => {
  const seen = [];
  installBrowserHost(async (url, options) => {
    seen.push(JSON.parse(options.body).custom_include_headers);
    return jsonResponse({ choices: [{ message: { content: JSON.stringify({ operations: [] }) } }] });
  });
  const otherPreset = { apiUrl: 'https://example-model-host.test/v1/chat/completions', apiKey: 'k', model: 'm' };

  await callOpenAICompatible(TRACKER_SETTINGS, trackerPayload('愛麗絲'), 'Return JSON.', { flow: 'tracker' });
  await callOpenAICompatible(otherPreset, trackerPayload('愛麗絲'), 'Return JSON.', { flow: 'tracker' });
  await callOpenAICompatible(TRACKER_SETTINGS, trackerPayload('愛麗絲'), 'Return JSON.', { flow: 'tracker' });

  assert.equal(seen.length, 3);
  const sessionOf = (headers) => headers.split('\n').find((line) => line.startsWith('x-opencode-session: '));
  assert.match(sessionOf(seen[0]), /^x-opencode-session: bsbt-tracker-[0-9a-f]{8}$/);
  assert.equal(sessionOf(seen[1]), undefined);
  // 切回 opencode 是同一 ID：缓存继续命中，无粘性状态残留
  assert.equal(sessionOf(seen[2]), sessionOf(seen[0]));
});

test('宿主代理路径：同 flow 同卡多轮复用同一会话 ID', async () => {
  const seen = [];
  installBrowserHost(async (url, options) => {
    seen.push(JSON.parse(options.body).custom_include_headers);
    return jsonResponse({ choices: [{ message: { content: JSON.stringify({ operations: [] }) } }] });
  });

  await callOpenAICompatible(TRACKER_SETTINGS, trackerPayload('愛麗絲'), 'Return JSON.', { flow: 'tracker' });
  await callOpenAICompatible(TRACKER_SETTINGS, trackerPayload('愛麗絲'), 'Return JSON.', { flow: 'tracker' });

  assert.equal(seen.length, 2);
  assert.equal(seen[0], seen[1]);
  assert.match(seen[0], /x-opencode-session: bsbt-tracker-[0-9a-f]{8}/);
});

test('直连路径：opencode 带会话头、其他渠道不带', async () => {
  const calls = [];
  installBrowserHost(async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({ choices: [{ message: { content: JSON.stringify({ operations: [] }) } }] });
  }, 'https://opencode.ai');

  await callOpenAICompatible(TRACKER_SETTINGS, trackerPayload('愛麗絲'), 'Return JSON.', { flow: 'tracker' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://opencode.ai/zen/go/v1/chat/completions');
  assert.match(calls[0].options.headers['x-opencode-session'], /^bsbt-tracker-[0-9a-f]{8}$/);

  const directCalls = [];
  installBrowserHost(async (url, options) => {
    directCalls.push({ url, options });
    return jsonResponse({ choices: [{ message: { content: JSON.stringify({ operations: [] }) } }] });
  }, 'https://my-proxy.test');
  await callOpenAICompatible(
    { apiUrl: 'https://my-proxy.test/v1', apiKey: 'k', model: 'm' },
    trackerPayload('愛麗絲'),
    'Return JSON.',
    { flow: 'tracker' },
  );
  assert.equal(directCalls.length, 1);
  assert.equal(directCalls[0].options.headers['x-opencode-session'], undefined);
});

test('模型列表探测不带会话头（无 prompt、无缓存意义）', async () => {
  const calls = [];
  installBrowserHost(async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({ data: [{ id: 'muse-spark-1.3-contributor' }] });
  });

  const models = await fetchModelList({ apiUrl: 'https://opencode.ai/zen/go/v1', apiKey: 'go-key' });
  assert.deepEqual(models, ['muse-spark-1.3-contributor']);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/backends/chat-completions/status');
  const includeHeaders = JSON.parse(calls[0].options.body).custom_include_headers;
  assert.equal(includeHeaders.includes('x-opencode-session'), false);
});
