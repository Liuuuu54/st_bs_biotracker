// 纪录摘要整理：胎儿事件堆与认知纪录超过保存上限时，最旧的条目并进摘要并排进 pending；
// 追踪结束、记下快照之前，对有 pending 的角色各发一次请求，把 pending 连同旧的 notes 改写成新的 notes。
// 放在快照之前，整理结果才会跟着快照走：之后的追踪从快照还原时不会丢掉要点、也不会重复整理。
// 整理失败只留着 pending，下一轮追踪再送；不影响这一轮的追踪结果。
import { callOpenAICompatible } from './api.js';
import { buildRecordNotesSystemPrompt } from './prompts/rules.js';
import {
  COGNITION_METHOD_LABELS, RECORD_NOTES_MAX_CHARS, describeFetalEventChange, describeFetalEventKind, labelFetalEventTarget,
} from './fetal_health.js';
import { isFetusKnownToCharacter } from './tools.js';

const pendingOf = (summary) => (Array.isArray(summary?.pending) ? summary.pending : []);

/** 这名角色要送去整理的内容；没有 pending 回传 null */
export function buildRecordNotesPayload(name, profile) {
  const pregnant = profile?.pregnant || {};
  const eventSummary = pregnant.fetalEventSummary;
  const cognitionSummary = profile?.cognitionSummary;
  const events = pendingOf(eventSummary);
  const records = pendingOf(cognitionSummary);
  if (events.length === 0 && records.length === 0) return null;
  const visibleFetuses = (Array.isArray(pregnant.fetuses) ? pregnant.fetuses : []).filter(isFetusKnownToCharacter);
  return {
    target_character: name,
    ...(events.length > 0 ? {
      fetal_events: {
        previous_notes: String(eventSummary?.notes || ''),
        folded: events.map((event) => ({
          time: event.time,
          kind: describeFetalEventKind(event.kind),
          ...(event.change ? { change: describeFetalEventChange(event.change) } : {}),
          target: labelFetalEventTarget(event, visibleFetuses),
          content: event.content,
        })),
      },
    } : {}),
    ...(records.length > 0 ? {
      cognition: {
        previous_notes: String(cognitionSummary?.notes || ''),
        folded: records.map((record) => ({ time: record.time, method: COGNITION_METHOD_LABELS[record.method] || record.method, content: record.content })),
      },
    } : {}),
  };
}

function cleanNotes(value) {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, RECORD_NOTES_MAX_CHARS) : null;
}

/**
 * 套用整理结果：只清掉这次送出去的那几条 pending（等待期间新并进来的留到下次）。
 * 模型没给某一项、或给的不是字串，那一项就当失败，pending 原样保留。
 */
export function applyRecordNotesResult(profile, payload, result) {
  const applied = [];
  const settle = (summary, sent, notes, label) => {
    if (!summary || !sent || notes === null) return;
    summary.notes = notes;
    summary.pending = pendingOf(summary).slice(sent);
    if (summary.pending.length === 0) delete summary.pending;
    applied.push(label);
  };
  settle(profile?.pregnant?.fetalEventSummary, payload?.fetal_events?.folded?.length || 0, cleanNotes(result?.fetal_event_notes), 'fetal_events');
  settle(profile?.cognitionSummary, payload?.cognition?.folded?.length || 0, cleanNotes(result?.cognition_notes), 'cognition');
  return applied;
}

/** isCurrent()：请求回来时聊天与楼层还是同一个，否则结果作废 */
export async function summarizePendingRecords(settings, chatState, isCurrent = () => true) {
  const systemPrompt = buildRecordNotesSystemPrompt({ maxChars: RECORD_NOTES_MAX_CHARS });
  for (const [name, character] of Object.entries(chatState?.characters || {})) {
    const payload = buildRecordNotesPayload(name, character?.profile);
    if (!payload) continue;
    try {
      const result = await callOpenAICompatible(settings, payload, systemPrompt, { flow: 'notes' });
      if (!isCurrent()) return;
      const profile = chatState.characters?.[name]?.profile;
      if (profile) applyRecordNotesResult(profile, payload, result);
    } catch (error) {
      console.warn(`[BS BioTracker] ${name} 的纪录摘要整理失败，下次追踪再试`, error);
    }
  }
}
