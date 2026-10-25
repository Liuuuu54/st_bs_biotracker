// 精子品质（1.2.0，精方计划第 3 期）：受精有效量 ×q^0.5、每天流失 ×q^-0.5、排出 ×q^-0.25；品质 1 与旧行为完全相同。
import assert from 'node:assert/strict';
import test from 'node:test';

import * as state from '../scripts/state.js';
import { calculateFertilizationPreview } from '../scripts/calculator.js';
import { describeSpermQuality, getSpermQualityFactors, normalizeSireRecord } from '../scripts/sires.js';
import { applyToolCall } from '../scripts/tools.js';

const call = (chat, name, args) => applyToolCall(chat, { name, arguments: args });

function chatWithMother() {
  const chat = state.createEmptyChatState();
  const mother = state.createDefaultFemaleState('艾拉');
  mother.initialized = true;
  mother.profile.base.race = '人类';
  mother.profile.base.bodySize = 4;
  mother.profile.base.age = 24;
  chat.characters['艾拉'] = mother;
  return chat;
}

test('品质倍率：1 时全是 1；4 时有效量 ×2、流失减半、排出约七成', () => {
  assert.deepEqual(getSpermQualityFactors(undefined), { quality: 1, amount: 1, decay: 1, drain: 1 });
  const high = getSpermQualityFactors(4);
  assert.equal(high.amount, 2);
  assert.equal(high.decay, 0.5);
  assert.ok(Math.abs(high.drain - 0.7071) < 0.001);
});

test('受精：同量同时间，品质 4 的胜出权重约为品质 1 的两倍；没写品质与品质 1 完全相同', () => {
  const base = { eggRace: '人类', elapsedDays: 0.25 };
  const preview = calculateFertilizationPreview({ ...base, spermSources: [{ race: '人类', value: 20, quality: 4 }, { race: '人类', value: 20, quality: 1 }] });
  const [strong, plain] = preview.sources;
  const ratio = strong.chance / plain.chance;
  assert.ok(ratio > 1.9 && ratio < 2.2, `ratio ${ratio}`);
  const legacy = calculateFertilizationPreview({ ...base, spermSources: [{ race: '人类', value: 20 }] });
  const explicit = calculateFertilizationPreview({ ...base, spermSources: [{ race: '人类', value: 20, quality: 1 }] });
  assert.equal(legacy.successChance, explicit.successChance);
});

test('射精当下记品质快照；之后改档案不影响已射进去的；一次性对象记 1', () => {
  const chat = chatWithMother();
  chat.sires['凯'] = normalizeSireRecord({ race: '人类', spermQuality: 4 });
  call(chat, 'bsAddSperm', { female: '艾拉', male: '凯', race: '人类', action: 'insert', amount: 0 });
  call(chat, 'bsAddSperm', { female: '艾拉', male: '凯', race: '人类', action: 'deposit', amount: 20 });
  chat.sires['凯'].spermQuality = 1;
  const base = chat.characters['艾拉'].profile.base;
  assert.equal(base.sperms[0].quality, 4);
  assert.equal(base.spermContacts.at(-1).quality, 4);
  call(chat, 'bsAddSperm', { female: '艾拉', male: '路人', race: '人类', action: 'insert', amount: 0 });
  call(chat, 'bsAddSperm', { female: '艾拉', male: '路人', race: '人类', action: 'deposit', amount: 20 });
  assert.equal(chat.characters['艾拉'].profile.base.sperms.find((x) => x.male === '路人').quality, 1);
});

test('留存：一天后品质 4 剩得比品质 1 多（流失 5 对 10）', () => {
  const chat = chatWithMother();
  chat.characters['艾拉'].profile.base.sperms = [{ male: 'A', race: '人类', value: 30, quality: 4 }, { male: 'B', race: '人类', value: 30, quality: 1 }];
  chat.characters['艾拉'].profile.base.eggs = 0;
  // 固定在卵泡期第 3 天：预设阶段是随机的，推进进月经期会把精液整个清掉
  Object.assign(chat.characters['艾拉'].profile.base, { stage: '卵泡期', days: 3 });
  call(chat, 'bsPassedTime', { day: 1 });
  const sperms = chat.characters['艾拉'].profile.base.sperms;
  const a = sperms.find((x) => x.male === 'A')?.value ?? 0;
  const b = sperms.find((x) => x.male === 'B')?.value ?? 0;
  assert.ok(Math.abs(a - 25) < 0.5, `A ${a}`);
  assert.ok(Math.abs(b - 20) < 0.5, `B ${b}`);
});

test('难洗：品质 4 排一次约七成，回覆写明还留多少；品质 1 全排照旧清空', () => {
  const chat = chatWithMother();
  chat.characters['艾拉'].profile.base.sperms = [{ male: '凯', race: '人类', value: 40, quality: 4 }];
  const result = call(chat, 'bsDrainSperm', { female: '艾拉', amount: 40 });
  assert.equal(chat.characters['艾拉'].profile.base.sperms[0].value, 11);
  assert.match(result.message, /还留着 11/);
  assert.match(result.message, /凯 的精液浓稠难洗/);
  chat.characters['艾拉'].profile.base.sperms = [{ male: '路人', race: '人类', value: 40 }];
  assert.match(call(chat, 'bsDrainSperm', { female: '艾拉', amount: 50 }).message, /cleared all/);
});

test('分级描述：一般不写，其余按门槛', () => {
  assert.equal(describeSpermQuality(0.25), '精水稀薄，阳物平平');
  assert.equal(describeSpermQuality(1), '');
  assert.equal(describeSpermQuality(2), '精力旺盛，阳物粗壮');
  assert.equal(describeSpermQuality(4), '精力极旺，阳物雄伟，一次就能灌满');
});
