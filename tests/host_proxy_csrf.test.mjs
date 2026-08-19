// 回归测试：使用者回报 ST 后端 console 被 ForbiddenError: Invalid CSRF token 灌爆。
//
// 宿主代理鉴权失败（CSRF token 对不上）时我们会回退直连，直连成功后使用者端
// 完全看不到异常——但每一次追踪请求都会先撞一次代理，于是伺服器 log 每轮加一笔。
// 撞到一次就该整个 session 停用代理。
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import { callOpenAICompatible } from '../scripts/api.js';

const ORIGINAL_FETCH = globalThis.fetch;
const PROXY_DISABLED_KEY = '__bs_biotracker_host_proxy_disabled__';

afterEach(() => {
  if (ORIGINAL_FETCH === undefined) delete globalThis.fetch;
  else globalThis.fetch = ORIGINAL_FETCH;
  delete globalThis[PROXY_DISABLED_KEY];
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.location;
  delete globalThis.SillyTavern;
});

function installBrowserLikeRuntime() {
  // shouldUseHostProxy 要求浏览器环境 + 跨来源 URL
  // isCrossOriginUrl 读的是裸的全域 location，不是 window.location
  globalThis.location = { origin: 'http://localhost:8000', href: 'http://localhost:8000/' };
  globalThis.window = { location: globalThis.location };
  globalThis.document = { cookie: '' };
  globalThis.SillyTavern = { getRequestHeaders: () => ({ 'Content-Type': 'application/json' }) };
}

function makeSettings() {
  return {
    apiUrl: 'https://api.example.com/v1',
    apiKey: 'k',
    model: 'test-model',
    apiTimeoutMs: 5000,
    formattedOutputV4: false,
  };
}

test('宿主代理回 403 CSRF 后，同一 session 不再重复打代理', async () => {
  installBrowserLikeRuntime();
  const hits = { proxy: 0, direct: 0 };
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.includes('/api/backends/chat-completions/generate')) {
      hits.proxy += 1;
      return {
        ok: false,
        status: 403,
        async text() { return 'ForbiddenError: Invalid CSRF token. Please refresh the page and try again.'; },
      };
    }
    hits.direct += 1;
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({ choices: [{ message: { content: JSON.stringify({ tool_calls: [] }) } }] });
      },
    };
  };

  for (let i = 0; i < 5; i += 1) {
    await callOpenAICompatible(makeSettings(), { recent_messages: [] }, 'sys');
  }

  assert.equal(hits.proxy, 1, `代理只该被撞一次，实际 ${hits.proxy} 次`);
  assert.equal(hits.direct, 5, '其余请求应直接走直连');
  assert.equal(globalThis[PROXY_DISABLED_KEY], true, '应标记本 session 停用代理');
});
