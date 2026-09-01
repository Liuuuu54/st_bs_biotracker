import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import { callOpenAICompatible, fetchModelList, isApiDeadlineError, isApiTimeoutError, resolveApiTimeoutMs, resolveOverallDeadlineMs } from '../scripts/api.js';

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
  // 宿主代理鉴权失败会整个 session 停用代理（见 disableHostProxyForSession），
  // 用例之间必须重置，否则前一个 403 案例会让后续案例直接跳过代理
  delete globalThis.__bs_biotracker_host_proxy_disabled__;
});

function installBrowserHost(fetchImpl) {
  globalThis.window = {};
  globalThis.document = { cookie: 'csrf_token=test-csrf' };
  globalThis.location = {
    origin: 'http://localhost:8000',
    href: 'http://localhost:8000/',
  };
  globalThis.SillyTavern = {
    getContext: () => null,
    getRequestHeaders: () => ({ 'X-ST-Header': 'host-value' }),
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

test('fetchModelList uses the SillyTavern backend proxy for a cross-origin API', async () => {
  const calls = [];
  installBrowserHost(async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({ response: JSON.stringify({ models: [{ name: 'grok-4' }, 'ollama-local'] }) });
  });

  const models = await fetchModelList({
    apiUrl: 'https://example-model-host.test/v1',
    apiKey: '',
  });

  assert.deepEqual(models, ['grok-4', 'ollama-local']);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/backends/chat-completions/status');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers['X-ST-Header'], 'host-value');
  assert.equal(calls[0].options.headers['X-CSRF-Token'], 'test-csrf');
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.chat_completion_source, 'custom');
  assert.equal(body.custom_url, 'https://example-model-host.test/v1');
  assert.equal(body.reverse_proxy, 'https://example-model-host.test/v1');
  assert.equal(body.proxy_password, '');
  // 无密钥时 ST 后端代理仍应带自定义 UA（node-fetch 默认 UA 的覆盖与密钥无关）
  assert.equal(
    body.custom_include_headers,
    'User-Agent: BS-BioTracker (+https://github.com/Liuuuu54/st_bs_biotracker)',
  );
});

test('callOpenAICompatible sends chat completions through the SillyTavern backend proxy', async () => {
  const calls = [];
  installBrowserHost(async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({
      choices: [{ message: { content: JSON.stringify({ operations: [] }) } }],
    });
  });

  const result = await callOpenAICompatible({
    apiUrl: 'https://example-model-host.test/v1/chat/completions',
    apiKey: 'secret-key',
    model: 'grok-compatible',
  }, { recent_messages: [] }, 'Return JSON.');

  assert.deepEqual(result, { operations: [] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/backends/chat-completions/generate');
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.chat_completion_source, 'custom');
  assert.equal(body.custom_url, 'https://example-model-host.test/v1');
  assert.equal(body.proxy_password, 'secret-key');
  // ST 后端代理必须带自定义 UA（覆盖 node-fetch 默认），且不能破坏 Authorization 行
  assert.deepEqual(
    body.custom_include_headers.split('\n').sort(),
    [
      'Authorization: Bearer secret-key',
      'User-Agent: BS-BioTracker (+https://github.com/Liuuuu54/st_bs_biotracker)',
    ].sort(),
  );
  assert.equal(body.model, 'grok-compatible');
  assert.equal(body.stream, false);
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.equal(Array.isArray(body.messages), true);
});

test('fetchModelList falls back to direct access when the SillyTavern proxy returns 403', async () => {
  const calls = [];
  installBrowserHost(async (url, options) => {
    calls.push({ url, options });
    if (url === '/api/backends/chat-completions/status') {
      return {
        ok: false,
        status: 403,
        async text() {
          return '<!DOCTYPE html><pre>Forbidden</pre>';
        },
      };
    }
    assert.equal(url, 'https://relay.example.test/v1/models');
    return jsonResponse({ data: [{ id: 'relay-model' }] });
  });

  const models = await fetchModelList({
    apiUrl: 'https://relay.example.test/v1',
    apiKey: 'relay-key',
  });

  assert.deepEqual(models, ['relay-model']);
  assert.deepEqual(calls.map((call) => call.url), [
    '/api/backends/chat-completions/status',
    'https://relay.example.test/v1/models',
  ]);
  assert.equal(calls[1].options.headers.Authorization, 'Bearer relay-key');
});

test('callOpenAICompatible falls back to direct access when the SillyTavern proxy returns 403', async () => {
  const calls = [];
  installBrowserHost(async (url, options) => {
    calls.push({ url, options });
    if (url === '/api/backends/chat-completions/generate') {
      return {
        ok: false,
        status: 403,
        async text() {
          return '<!DOCTYPE html><pre>Forbidden</pre>';
        },
      };
    }
    assert.equal(url, 'https://relay.example.test/v1/chat/completions');
    return jsonResponse({
      choices: [{ message: { content: JSON.stringify({ operations: [] }) } }],
    });
  });

  const result = await callOpenAICompatible({
    apiUrl: 'https://relay.example.test/v1',
    apiKey: 'relay-key',
    model: 'relay-model',
  }, { recent_messages: [] }, 'Return JSON.');

  assert.deepEqual(result, { operations: [] });
  assert.deepEqual(calls.map((call) => call.url), [
    '/api/backends/chat-completions/generate',
    'https://relay.example.test/v1/chat/completions',
  ]);
  assert.equal(calls[1].options.headers.Authorization, 'Bearer relay-key');
});

test('callOpenAICompatible aborts a hanging request instead of waiting forever', async () => {
  const calls = [];
  installBrowserHost((url, options) => {
    calls.push({ url, options });
    return new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => {
        const error = new Error('The operation was aborted.');
        error.name = 'AbortError';
        reject(error);
      });
    });
  });

  await assert.rejects(
    callOpenAICompatible({
      apiUrl: 'https://relay.example.test/v1',
      apiKey: 'relay-key',
      model: 'relay-model',
      apiTimeoutMs: 1000,
    }, { recent_messages: [] }, 'Return JSON.'),
    (error) => isApiTimeoutError(error) && /自动终止/.test(error.message),
  );

  // 超时不重试，只发一次；也不会退回直连再卡一轮
  assert.deepEqual(calls.map((call) => call.url), ['/api/backends/chat-completions/generate']);
});

test('resolveApiTimeoutMs clamps input and treats 0 as unlimited', () => {
  assert.equal(resolveApiTimeoutMs({}), 180000);
  assert.equal(resolveApiTimeoutMs({ apiTimeoutMs: 0 }), 0);
  assert.equal(resolveApiTimeoutMs({ apiTimeoutMs: 500 }), 1000);
  assert.equal(resolveApiTimeoutMs({ apiTimeoutMs: 99999999 }), 1800000);
});

test('resolveOverallDeadlineMs bounds even an unlimited per-request timeout', () => {
  // 一整轮 = (maxRetries 3 + 1) 次，所以是单次超时的 4 倍
  assert.equal(resolveOverallDeadlineMs({}), 180000 * 4);
  assert.equal(resolveOverallDeadlineMs({ apiTimeoutMs: 30000 }), 120000);
  // 单次超时设为 0（不限制）时仍有终点，不会永远挂着
  assert.equal(resolveOverallDeadlineMs({ apiTimeoutMs: 0 }), 180000 * 4);
});

test('the retry counter counts total tries so 3/3 can no longer hide a 4th attempt', async () => {
  const warnings = [];
  const previousToastr = globalThis.toastr;
  globalThis.toastr = { warning: (message) => warnings.push(String(message)) };
  const badContent = { choices: [{ message: { content: '这不是 JSON' } }] };
  const goodContent = { choices: [{ message: { content: JSON.stringify({ operations: [] }) } }] };
  let call = 0;
  installBrowserHost(async () => {
    call += 1;
    // 第 1 轮的 primary + JSON 纠错子请求都坏 → 触发一次重试；第 2 轮 primary 就好
    return jsonResponse(call <= 2 ? badContent : goodContent);
  });

  try {
    const result = await callOpenAICompatible({
      apiUrl: 'https://relay.example.test/v1',
      apiKey: 'k',
      model: 'm',
      apiTimeoutMs: 180000,
    }, { recent_messages: [] }, 'Return JSON.');
    assert.deepEqual(result, { operations: [] });
    assert.equal(warnings.length, 1, '应只重试一次');
    // 分母是总轮次 4，而不是旧的 maxRetries 3
    assert.match(warnings[0], /第 1\/4 次失败/);
    assert.doesNotMatch(warnings[0], /\/3 /);
  } finally {
    if (previousToastr === undefined) delete globalThis.toastr;
    else globalThis.toastr = previousToastr;
  }
});

test('the overall deadline terminates a run that keeps failing, without hanging forever', async () => {
  const badContent = { choices: [{ message: { content: '仍然不是 JSON' } }] };
  let calls = 0;
  installBrowserHost(async () => {
    calls += 1;
    return jsonResponse(badContent);
  });

  // 单次超时 1s → 总时限 4s。响应很快但一直坏，重试在第 3 次的 3s 间隔里撞上总时限，
  // 循环下一轮开头发现已到点，抛出总时限错误而不是继续无止境地试。
  await assert.rejects(
    callOpenAICompatible({
      apiUrl: 'https://relay.example.test/v1',
      apiKey: 'k',
      model: 'm',
      apiTimeoutMs: 1000,
    }, { recent_messages: [] }, 'Return JSON.'),
    (error) => isApiDeadlineError(error) && /总时限/.test(error.message),
  );
  assert.ok(calls > 0 && calls < 20, `请求次数应有界，实际 ${calls}`);
});

const RESPONSES_RESULT = {
  output: [{
    type: 'message',
    role: 'assistant',
    content: [{ type: 'output_text', text: JSON.stringify({ operations: [] }) }],
  }],
};

test('openai_responses format on vanilla SillyTavern goes through the /proxy/ transparent proxy', async () => {
  const calls = [];
  installBrowserHost(async (url, options) => {
    calls.push({ url, options });
    return jsonResponse(RESPONSES_RESULT);
  });

  const result = await callOpenAICompatible({
    apiUrl: 'https://opencode.example.test/zen/go/v1',
    apiKey: 'go-key',
    model: 'muse-spark-1.2-contributor',
    apiFormat: 'openai_responses',
  }, { recent_messages: [] }, 'Return JSON.');

  assert.deepEqual(result, { operations: [] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/proxy/https://opencode.example.test/zen/go/v1/responses');
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.model, 'muse-spark-1.2-contributor');
  assert.equal(body.store, false);
  assert.equal(Array.isArray(body.input), true);
  assert.equal(body.input[0].role, 'developer');
  assert.deepEqual(body.text, { format: { type: 'json_object' } });
  assert.equal(calls[0].options.headers.Authorization, 'Bearer go-key');
  assert.equal(calls[0].options.headers['X-CSRF-Token'], 'test-csrf');
});

test('openai_responses format falls back to direct when the transparent proxy is disabled (404)', async () => {
  const calls = [];
  installBrowserHost(async (url, options) => {
    calls.push({ url, options });
    if (url.startsWith('/proxy/')) {
      return {
        ok: false,
        status: 404,
        async text() {
          return 'CORS proxy is disabled. Enable it in config.yaml or use the --corsProxy flag.';
        },
      };
    }
    return jsonResponse(RESPONSES_RESULT);
  });

  const result = await callOpenAICompatible({
    apiUrl: 'https://opencode.example.test/zen/go/v1',
    apiKey: 'go-key',
    model: 'muse-spark-1.2-contributor',
    apiFormat: 'openai_responses',
  }, { recent_messages: [] }, 'Return JSON.');

  assert.deepEqual(result, { operations: [] });
  assert.deepEqual(calls.map((call) => call.url), [
    '/proxy/https://opencode.example.test/zen/go/v1/responses',
    'https://opencode.example.test/zen/go/v1/responses',
  ]);
});

test('openai_responses format on TauriTavern uses the format-aware host proxy', async () => {
  const calls = [];
  globalThis.__TAURITAVERN__ = {};
  try {
    installBrowserHost(async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({ choices: [{ message: { content: JSON.stringify({ operations: [] }) } }] });
    });

    const result = await callOpenAICompatible({
      apiUrl: 'https://opencode.example.test/zen/go/v1',
      apiKey: 'go-key',
      model: 'muse-spark-1.2-contributor',
      apiFormat: 'openai_responses',
    }, { recent_messages: [] }, 'Return JSON.');

    assert.deepEqual(result, { operations: [] });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/api/backends/chat-completions/generate');
    const body = JSON.parse(calls[0].options.body);
    assert.equal(body.custom_api_format, 'openai_responses');
    assert.equal(body.model, 'muse-spark-1.2-contributor');
    assert.equal(Array.isArray(body.messages), true);
  } finally {
    delete globalThis.__TAURITAVERN__;
  }
});

test('claude_messages format converts to Anthropic shape through the transparent proxy', async () => {
  const calls = [];
  installBrowserHost(async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({ content: [{ type: 'text', text: JSON.stringify({ operations: [] }) }] });
  });

  const result = await callOpenAICompatible({
    apiUrl: 'https://opencode.example.test/zen/go/v1',
    apiKey: 'go-key',
    model: 'qwen3.8-max',
    apiFormat: 'claude_messages',
  }, { recent_messages: [] }, 'Return JSON.');

  assert.deepEqual(result, { operations: [] });
  assert.equal(calls[0].url, '/proxy/https://opencode.example.test/zen/go/v1/messages');
  const body = JSON.parse(calls[0].options.body);
  assert.equal(typeof body.system, 'string');
  assert.ok(body.max_tokens >= 1);
  assert.equal(body.messages.every((m) => m.role === 'user' || m.role === 'assistant'), true);
  assert.equal(calls[0].options.headers['x-api-key'], 'go-key');
  assert.equal(calls[0].options.headers['anthropic-version'], '2023-06-01');
});

const GEMINI_RESULT = {
  status: 'completed',
  steps: [{
    type: 'model_output',
    content: [{ type: 'text', text: JSON.stringify({ operations: [] }) }],
  }],
};

test('gemini_interactions format builds steps + system_instruction and injects /v1beta', async () => {
  const calls = [];
  installBrowserHost(async (url, options) => {
    calls.push({ url, options });
    return jsonResponse(GEMINI_RESULT);
  });

  const result = await callOpenAICompatible({
    // 裸主机名（无 /v1 或 /v1beta）：插件必须自动补 /v1beta，与 TauriTavern build_gemini_url 一致
    apiUrl: 'https://generativelanguage.googleapis.com',
    apiKey: 'goog-key',
    model: 'gemini-2.5-pro',
    apiFormat: 'gemini_interactions',
  }, { recent_messages: [] }, 'Return JSON.');

  assert.deepEqual(result, { operations: [] });
  assert.equal(calls[0].url, '/proxy/https://generativelanguage.googleapis.com/v1beta/interactions');
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.model, 'gemini-2.5-pro');
  assert.equal(body.stream, false);
  assert.equal(body.store, false);
  assert.equal(typeof body.system_instruction, 'string');
  assert.ok(body.system_instruction.length > 0);
  assert.equal(Array.isArray(body.input), true);
  assert.equal(body.input.every((s) => s.type === 'user_input' || s.type === 'model_output'), true);
  assert.equal(body.input.some((s) => s.type === 'user_input'), true);
  assert.ok(body.input.every((s) => Array.isArray(s.content) && s.content.every((b) => b.type === 'text')));
  assert.equal(calls[0].options.headers['x-goog-api-key'], 'goog-key');
  assert.equal(calls[0].options.headers.Authorization, undefined);
});

test('gemini_interactions keeps an explicit /v1beta base without double-prefixing', async () => {
  const calls = [];
  installBrowserHost(async (url, options) => {
    calls.push({ url, options });
    return jsonResponse(GEMINI_RESULT);
  });

  await callOpenAICompatible({
    apiUrl: 'https://generativelanguage.googleapis.com/v1beta',
    apiKey: 'goog-key',
    model: 'gemini-2.5-pro',
    apiFormat: 'gemini_interactions',
  }, { recent_messages: [] }, 'Return JSON.');

  assert.equal(calls[0].url, '/proxy/https://generativelanguage.googleapis.com/v1beta/interactions');
});

test('gemini_interactions on TauriTavern accepts already-normalized OpenAI choices', async () => {
  const calls = [];
  globalThis.__TAURITAVERN__ = {};
  try {
    installBrowserHost(async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({ choices: [{ message: { content: JSON.stringify({ operations: [] }) } }] });
    });

    const result = await callOpenAICompatible({
      apiUrl: 'https://generativelanguage.googleapis.com/v1beta',
      apiKey: 'goog-key',
      model: 'gemini-2.5-pro',
      apiFormat: 'gemini_interactions',
    }, { recent_messages: [] }, 'Return JSON.');

    assert.deepEqual(result, { operations: [] });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/api/backends/chat-completions/generate');
    const body = JSON.parse(calls[0].options.body);
    assert.equal(body.custom_api_format, 'gemini_interactions');
    assert.equal(Array.isArray(body.messages), true);
    assert.equal(body.custom_include_headers, 'x-goog-api-key: goog-key');
    assert.doesNotMatch(body.custom_include_headers, /Authorization/);
  } finally {
    delete globalThis.__TAURITAVERN__;
  }
});

test('gemini_interactions rejects a completed response with no model_output text', async () => {
  installBrowserHost(async () => jsonResponse({
    status: 'completed',
    steps: [{ type: 'thought', signature: '' }],
  }));

  await assert.rejects(
    callOpenAICompatible({
      apiUrl: 'https://generativelanguage.googleapis.com/v1beta',
      apiKey: 'goog-key',
      model: 'gemini-2.5-pro',
      apiFormat: 'gemini_interactions',
      apiTimeoutMs: 1000,
    }, { recent_messages: [] }, 'Return JSON.'),
    (error) => /没有可消费的文本|总时限/.test(error.message),
  );
});

test('gemini_interactions surfaces a failed status as a retriable error', async () => {
  installBrowserHost(async () => jsonResponse({
    status: 'failed',
    error: { message: 'model overloaded' },
  }));

  await assert.rejects(
    callOpenAICompatible({
      apiUrl: 'https://generativelanguage.googleapis.com/v1beta',
      apiKey: 'goog-key',
      model: 'gemini-2.5-pro',
      apiFormat: 'gemini_interactions',
      apiTimeoutMs: 1000,
    }, { recent_messages: [] }, 'Return JSON.'),
    // failed 是可重试的上游错误：可能直接抛出，也可能在重试链里撞上总时限
    (error) => /Gemini Interactions 回传失败|总时限/.test(error.message),
  );
});
