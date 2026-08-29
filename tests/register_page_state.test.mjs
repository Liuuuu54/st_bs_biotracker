// 契约测试：注册页的推演草稿／进行中请求必须跨越「关掉小手机再打开」。
// 弹窗只是隐藏而非销毁，过去每次打开都无条件重置，导致推演结果消失、
// 注册状态清空，且注册按钮没有节流会被重复触发。
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const controller = await readFile(new URL('../index.js', import.meta.url), 'utf8');

test('opening the modal no longer wipes the register page unconditionally', () => {
  // 重置逻辑集中到 resetRegisterPageState，且只能由 syncRegisterPageOnOpen 在换聊天时调用
  assert.match(controller, /function resetRegisterPageState\(\)/);
  assert.equal((controller.match(/resetRegisterPageState\(\)/g) || []).length, 2);
  const sync = controller.match(/function syncRegisterPageOnOpen\(ctx\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(sync, /registerPageChatKey === chatKey/);
  assert.match(sync, /!isSameChat && !hasPendingRegistryOperations\(\)/);
  assert.match(sync, /restorePendingRegistryOperations\(\)/);

  // applySettingsToForm 不再直接清空草稿
  const applyForm = controller.match(/function applySettingsToForm\(ctx\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(applyForm, /syncRegisterPageOnOpen\(ctx\)/);
  assert.doesNotMatch(applyForm, /registryBreedingInferenceDraft = null/);
});

test('the breeding inference draft is only cleared once the character is registered', () => {
  assert.match(controller, /function clearBreedingInferenceDraftFor\(registeredName\)/);
  const clear = controller.match(/function clearBreedingInferenceDraftFor\(registeredName\)[\s\S]*?\n\}/)?.[0] || '';
  assert.match(clear, /registryBreedingInferenceDraft\?\.targetName !== name/);
  // 注册成功后才调用
  assert.match(controller, /const character = await runRegistry\(ctx[\s\S]*?clearBreedingInferenceDraftFor\(character\.name\)/);
});

test('every async register-page action is throttled and restorable', () => {
  for (const key of ['register', 'inference', 'wardrobe', 'diary', 'skill']) {
    assert.match(controller, new RegExp(`isRegistryOperationPending\\('${key}'\\)`), `${key} 缺少重复触发保护`);
    assert.match(controller, new RegExp(`beginRegistryOperation\\('${key}'`), `${key} 未登记为进行中`);
    assert.match(controller, new RegExp(`endRegistryOperation\\('${key}'\\)`), `${key} 未在结束时释放`);
  }
  // \r?\n：Windows 上 checkout 会把工作区转成 CRLF，裸写 \n 会匹配不到
  const restore = controller.match(/function restorePendingRegistryOperations\(\)[\s\S]*?\r?\n\}\r?\n/)?.[0] || '';
  assert.match(restore, /button\.disabled = true/);
  assert.match(restore, /ui\.setStatus\(message\)/);
});

test('base.days validation matches the engine 0-based stage day', () => {
  // 引擎每次切换阶段都写 base.days = 0，界面再按「第 N+1 天」显示，
  // 所以完整变量的校验不能要求 >= 1，否则刚换排卵周期的角色改不了变量。
  assert.doesNotMatch(controller, /profile\.base\.days 必须大于等于 1/);
  assert.match(controller, /profile\.base\?\.days === 'number' && profile\.base\.days < 0/);
  assert.match(controller, /profile\.base\.days 不能是负数/);
});
