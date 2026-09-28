import assert from 'node:assert/strict';
import test from 'node:test';

import * as state from '../scripts/state.js';

function makeSettings(overrides = {}) {
  const ctx = { chatId: 'api-profile-chat', extensionSettings: {}, saveSettingsDebounced() {} };
  return Object.assign(state.getSettings(ctx), overrides);
}

test('saving captures url, format, key and model under a name; same name overwrites', () => {
  const settings = makeSettings({ apiUrl: 'https://a.example/v1', apiFormat: 'openai_compat', apiKey: 'sk-a', model: 'model-a' });
  assert.equal(state.saveApiProfile(settings, '  主力  '), false);
  assert.deepEqual(settings.apiProfiles, [{
    name: '主力', apiUrl: 'https://a.example/v1', apiFormat: 'openai_compat', apiKey: 'sk-a', model: 'model-a',
    temperatureMode: 'legacy', temperature: null, reasoningEffort: 'auto', formattedOutputV4: true,
  }]);

  settings.model = 'model-b';
  assert.equal(state.saveApiProfile(settings, '主力'), true);
  assert.equal(settings.apiProfiles.length, 1);
  assert.equal(settings.apiProfiles[0].model, 'model-b');
  assert.throws(() => state.saveApiProfile(settings, '   '), /名称/);
});

test('applying a profile restores its connection fields and drops the stale model list', () => {
  const settings = makeSettings({
    apiUrl: 'https://a.example/v1', apiFormat: 'claude_messages', apiKey: 'sk-a', model: 'model-a',
    temperatureMode: 'manual', temperature: 0.7, reasoningEffort: 'high', formattedOutputV4: false,
  });
  state.saveApiProfile(settings, '备用');
  Object.assign(settings, {
    apiUrl: 'https://b.example', apiFormat: 'openai_compat', apiKey: 'sk-b', model: 'model-b', modelOptions: ['x', 'y'],
    temperatureMode: 'omit', temperature: null, reasoningEffort: 'auto', formattedOutputV4: true,
  });

  state.applyApiProfile(settings, '备用');
  assert.equal(settings.apiUrl, 'https://a.example/v1');
  assert.equal(settings.apiFormat, 'claude_messages');
  assert.equal(settings.apiKey, 'sk-a');
  assert.equal(settings.model, 'model-a');
  assert.equal(settings.temperatureMode, 'manual');
  assert.equal(settings.temperature, 0.7);
  assert.equal(settings.reasoningEffort, 'high');
  assert.equal(settings.formattedOutputV4, false);
  assert.deepEqual(settings.modelOptions, []);
  assert.throws(() => state.applyApiProfile(settings, '不存在'), /找不到/);
});

test('deleting removes only that profile and leaves the live connection alone', () => {
  const settings = makeSettings({ apiUrl: 'https://a.example/v1', apiKey: 'sk-a' });
  state.saveApiProfile(settings, '甲');
  state.saveApiProfile(settings, '乙');
  state.deleteApiProfile(settings, '甲');
  assert.deepEqual(settings.apiProfiles.map((profile) => profile.name), ['乙']);
  assert.equal(settings.apiKey, 'sk-a');
  assert.throws(() => state.deleteApiProfile(settings, '甲'), /找不到/);
});

test('loading drops malformed and duplicate profiles and normalizes the format', () => {
  const ctx = {
    chatId: 'api-profile-load',
    extensionSettings: {},
    saveSettingsDebounced() {},
  };
  const first = state.getSettings(ctx);
  first.apiProfiles = [
    { name: '甲', apiUrl: ' https://a ', apiFormat: 'bogus', apiKey: 'k', model: 'm' },
    { name: '甲', apiUrl: 'dup' },
    { name: '' },
    null,
    'text',
  ];
  const loaded = state.getSettings(ctx);
  assert.deepEqual(loaded.apiProfiles, [{
    name: '甲', apiUrl: 'https://a', apiFormat: state.normalizeApiFormat('bogus'), apiKey: 'k', model: 'm',
    temperatureMode: 'legacy', temperature: null, reasoningEffort: 'auto', formattedOutputV4: true,
  }]);
});
