// 手动修改尾楼后的重追判断：追踪时记下这一楼的正文，使用者改了这一楼以后，
// 先把改动前后的差异交给决策模型，按几类生理相关的事实逐项问「有没有变」，
// 任意一项变了才重新追踪；都没变就沿用上次的追踪结果。
// 决策接口（/v1/systemone）只回答预设选项并附概率，不生成文字，单次花费可忽略；
// 它与聊天接口格式不同，宿主的 chat-completions 转发带不了，只能在网页里直连。
// 判断失败、超时、没填好接口一律照常重追——宁可多追一轮，也不漏追。
import { assertSafeDirectApiBase } from './api.js';
import { markOwnRequest } from './own_requests.js';

export const EDIT_GATE_TIMEOUT_MS = 20000;
/** 任意一项「改变了」的概率达到这个百分比就重追（实测 60% 能分开错字、措辞与体内改体外之类的改动） */
export const DEFAULT_EDIT_GATE_THRESHOLD_PERCENT = 60;
/** 追踪时记下最近几楼的正文：删掉最新几楼后再改变成最新的那一楼，也有正文可比 */
export const DEFAULT_EDIT_GATE_KEEP_FLOORS = 3;
export const MAX_EDIT_GATE_KEEP_FLOORS = 10;
/** 追踪时记下的正文超过这个长度就不记，改了照常重追 */
export const EDIT_GATE_BASELINE_MAX_CHARS = 30000;
/** 改动的内容（删掉的加上新增的）超过这个长度就当作大改，不问模型直接重追 */
export const EDIT_GATE_MAX_CHANGED_CHARS = 4000;
const EDIT_GATE_CONTEXT_CHARS = 120;

const CHANGED_LABEL = '改变了';
const UNCHANGED_LABEL = '没改变';

/** 逐项询问的生理相关事实；问题键名只用于对回答 */
export const EDIT_GATE_TOPICS = Object.freeze({
  sex: '是否发生性行为、插入方式、是否射精、射在体内还是体外、是否高潮',
  contraception: '是否使用避孕措施（避孕套、避孕药等）',
  time: '剧情里经过了多少时间',
  clothing: '角色穿着什么、是否换衣服或脱衣服',
  presence: '哪些角色在场、谁离开或到来',
  body: '月经、排卵、怀孕、分娩、哺乳、受伤或疾病',
  eating: '进食、喝水、饥饿或口渴',
  excretion: '排尿、排便',
  sleep: '睡觉、小睡、醒来或熬夜',
  hygiene: '洗澡、清洗身体、清理体内的精液',
});

export const EDIT_GATE_TOPIC_LABELS = Object.freeze({
  sex: '性行为',
  contraception: '避孕',
  time: '经过时间',
  clothing: '衣着',
  presence: '在场角色',
  body: '身体状况',
  eating: '进食',
  excretion: '排泄',
  sleep: '睡眠',
  hygiene: '清洁',
});

function toFiniteNumber(value) {
  // 清空输入框得到 '' / null：Number 会把它们当成 0，按没填处理、回到默认值
  if (value === null || value === undefined || String(value).trim() === '') return NaN;
  return Number(value);
}

export function normalizeEditGateKeepFloors(value) {
  const raw = toFiniteNumber(value);
  if (!Number.isFinite(raw)) return DEFAULT_EDIT_GATE_KEEP_FLOORS;
  return Math.min(MAX_EDIT_GATE_KEEP_FLOORS, Math.max(1, Math.floor(raw)));
}

export function normalizeEditGateThresholdPercent(value) {
  const raw = toFiniteNumber(value);
  if (!Number.isFinite(raw)) return DEFAULT_EDIT_GATE_THRESHOLD_PERCENT;
  return Math.min(99, Math.max(1, Math.round(raw)));
}

/** 接口地址有问题时回传给使用者看的说明；没填或没问题回传空字符串 */
export function describeEditGateUrlProblem(apiUrl) {
  const url = String(apiUrl || '').trim();
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) return '接口地址要以 http:// 或 https:// 开头。';
  try {
    assertSafeDirectApiBase(url);
  } catch (error) {
    return String(error?.message || error);
  }
  return '';
}

export function isEditGateConfigured(settings) {
  return /^https?:\/\//i.test(String(settings?.editGateApiUrl || '').trim())
    && Boolean(String(settings?.editGateApiKey || '').trim())
    && Boolean(String(settings?.editGateModel || '').trim());
}

/** 去掉相同的开头与结尾，只留改动的那一段，前后各带一小段没改的上下文。 */
export function diffEditWindow(before, after, context = EDIT_GATE_CONTEXT_CHARS) {
  const prev = String(before || '');
  const next = String(after || '');
  let start = 0;
  while (start < prev.length && start < next.length && prev[start] === next[start]) start += 1;
  let endBefore = prev.length;
  let endAfter = next.length;
  while (endBefore > start && endAfter > start && prev[endBefore - 1] === next[endAfter - 1]) {
    endBefore -= 1;
    endAfter -= 1;
  }
  return {
    lead: prev.slice(Math.max(0, start - context), start),
    removed: prev.slice(start, endBefore),
    added: next.slice(start, endAfter),
    tail: prev.slice(endBefore, endBefore + context),
  };
}

function stripWhitespaceAndPunctuation(text) {
  return String(text || '').replace(/[\s\p{P}\p{S}]/gu, '');
}

/** 数字连同夹在数字之间、紧跟其后的符号（1.5、1-2、3:30、50%）：这些标点一改，意思就变了 */
const NUMERIC_TOKEN_PATTERN = /\p{Nd}+(?:[^\p{L}\p{Nd}\s]+\p{Nd}+)*[%％‰]?/gu;

function numericTokens(text) {
  return (String(text || '').match(NUMERIC_TOKEN_PATTERN) || []).join('|');
}

/**
 * 不问模型就能定的改动：
 * same / cosmetic（只动了空白或标点，数字里的不算）→ 沿用；append（只在末尾接了内容，多半是续写）
 * 与 too_large（大段改写）→ 直接重追；其余交给决策模型。
 */
export function classifyTailEdit(before, after) {
  const prev = String(before || '');
  const next = String(after || '');
  if (prev === next) return 'same';
  if (stripWhitespaceAndPunctuation(prev) === stripWhitespaceAndPunctuation(next)
    && numericTokens(prev) === numericTokens(next)) return 'cosmetic';
  const kept = prev.trimEnd();
  if (next.length > kept.length && next.startsWith(kept)) return 'append';
  const { removed, added } = diffEditWindow(prev, next);
  if (removed.length + added.length > EDIT_GATE_MAX_CHANGED_CHARS) return 'too_large';
  return 'needs_decision';
}

export function buildEditGateState(before, after) {
  const { lead, removed, added, tail } = diffEditWindow(before, after);
  return [
    '同一楼 AI 回复被用户手动修改。下面是改动的地方（前后各带一小段没改的上下文）。',
    `【改动前后的上下文】…${lead}［此处被修改］${tail}…`,
    `【修改前这一处写的是】${removed || '（空，表示这里是新增内容）'}`,
    `【修改后这一处写的是】${added || '（空，表示这里的内容被删掉了）'}`,
  ].join('\n');
}

export function buildEditGateRequestBody(model, before, after) {
  const questions = {};
  for (const [key, topic] of Object.entries(EDIT_GATE_TOPICS)) {
    questions[key] = {
      type: 'choice',
      instructions: `对比修改前后，关于「${topic}」的事实有没有被增加、删除或改变？只看这一项，措辞、语气、心理和其它方面的变化不算。`,
      criteria: {
        [CHANGED_LABEL]: `修改后关于「${topic}」的事实与修改前不同（新增、删掉或改了内容），哪怕只差一个词`,
        [UNCHANGED_LABEL]: `修改前后关于「${topic}」的事实完全相同，或这处修改与它无关`,
      },
    };
  }
  return { model, state: buildEditGateState(before, after), questions };
}

/**
 * 概率可能是 { 选项: p } 或 [{ choice, probability }]。
 * 没给（缺项、null、空字符串）回传 null，由调用方改看选项；
 * 给了却不是 0–1 之间的数回传 NaN——Number(null) 之类会悄悄变成 0，不能当真。
 */
function readLabelProbability(probabilities, label) {
  let raw;
  if (Array.isArray(probabilities)) {
    const entry = probabilities.find((item) => (item?.choice ?? item?.label ?? item?.option) === label);
    if (!entry) return null;
    raw = entry.probability ?? entry.p;
  } else if (probabilities && typeof probabilities === 'object') {
    raw = probabilities[label];
  } else {
    return null;
  }
  if (raw === null || raw === undefined || (typeof raw === 'string' && !raw.trim())) return null;
  const value = typeof raw === 'number' || typeof raw === 'string' ? Number(raw) : NaN;
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : NaN;
}

/**
 * 每一项都要有回答，缺一项就当判断失败（照常重追）。
 * 回传 { retrack, maxChanged, changedTopics }：changedTopics 是达到门槛的那几项。
 */
export function interpretEditGateResponse(payload, threshold = DEFAULT_EDIT_GATE_THRESHOLD_PERCENT / 100) {
  const answers = payload?.answers;
  if (!answers || typeof answers !== 'object') throw new Error('决策接口没有返回回答');
  const scores = {};
  for (const key of Object.keys(EDIT_GATE_TOPICS)) {
    const answer = answers[key];
    if (!answer || typeof answer !== 'object') throw new Error(`决策接口少了「${key}」这一项的回答`);
    const probability = readLabelProbability(answer.probabilities, CHANGED_LABEL);
    if (Number.isNaN(probability)) throw new Error(`决策接口「${key}」这一项的概率无效`);
    if (probability !== null) scores[key] = probability;
    else if (answer.choice === CHANGED_LABEL || answer.choice === UNCHANGED_LABEL) scores[key] = answer.choice === CHANGED_LABEL ? 1 : 0;
    else throw new Error(`决策接口「${key}」这一项的回答读不出来`);
  }
  const maxChanged = Math.max(...Object.values(scores));
  const changedTopics = Object.keys(scores).filter((key) => scores[key] >= threshold);
  return { retrack: maxChanged >= threshold, maxChanged, changedTopics, scores };
}

/** 发一次判断请求；失败、超时或回答不全时抛错，由调用方照常重追。 */
export async function requestEditGateDecision(settings, before, after, { fetchImpl = globalThis.fetch, timeoutMs = EDIT_GATE_TIMEOUT_MS } = {}) {
  const url = String(settings?.editGateApiUrl || '').trim();
  if (!isEditGateConfigured(settings)) throw new Error('修改判断的接口地址、Key 或模型没有填好');
  assertSafeDirectApiBase(url);
  if (typeof fetchImpl !== 'function') throw new Error('当前环境不能发请求');
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const init = markOwnRequest({
      method: 'POST',
      headers: {
        Authorization: `Bearer ${String(settings.editGateApiKey).trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildEditGateRequestBody(String(settings.editGateModel).trim(), before, after)),
      signal: controller?.signal,
    });
    const response = await fetchImpl(url, init);
    const text = await response.text();
    if (!response.ok) throw new Error(`决策接口返回 HTTP ${response.status}：${String(text || '').slice(0, 200)}`);
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error('决策接口返回的不是 JSON');
    }
    return interpretEditGateResponse(payload, normalizeEditGateThresholdPercent(settings?.editGateThresholdPercent) / 100);
  } catch (error) {
    // 超时中止可能发生在等回应头或读回应体时，两处都换成看得懂的说法
    if (controller?.signal?.aborted) throw new Error(`决策接口 ${Math.round(timeoutMs / 1000)} 秒内没有回应`);
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
