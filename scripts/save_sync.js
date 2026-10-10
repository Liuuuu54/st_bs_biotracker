/**
 * 存档的跨分页同步与未完成存档的追踪。
 *
 * 宿主把插件资料整份写回：SillyTavern 存在 settings.json，TauriTavern／Luker 存在聊天旁的档案。
 * 另一个分页（或同机的另一个视窗）记忆体里若是旧资料，它存一次就会把新资料盖掉。这里给每个聊天
 * 状态一个存档版本号，最新版本记在同源分页共享的 localStorage：
 * - 存档前先比对，发现别的分页已存过更新的版本，就不写入，改为从宿主重新读取（见 state.js）
 * - 确实写入后用 BroadcastChannel 通知其他分页同步
 * 跨装置（手机与电脑）不共享 localStorage，这里管不到。
 *
 * 另外追踪「已排程但还没写完」的存档：宿主的设定存档有约 1 秒的延迟，关页面时也不会补存，
 * 页面在这段时间内关闭或刷新会丢资料。index.js 在 beforeunload 时据此立即补存并挡一下离开。
 */

const CHANNEL_NAME = 'bs_biotracker_save_sync';
const REVISION_KEY_PREFIX = 'bs_biotracker:chat_revision:';
// 宿主设定存档的延迟（SillyTavern 为 1 秒）；排程后至少过这么久的完成事件才算包含这次改动
const HOST_SETTINGS_SETTLE_MS = 1000;
// 宿主不发「设定已存」事件时的保底：排程超过这么久就不再视为待存，免得离开页面时一直跳确认
const HOST_SETTINGS_PENDING_MAX_MS = 4000;

const TAB_ID = Math.random().toString(36).slice(2);
let channel = null;
let settingsPendingSince = 0;
let pendingSidecarWrites = 0;
const unannouncedRevisions = new Map();

function storage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

export function readLatestChatRevision(chatKey) {
  try {
    return Number(storage()?.getItem(REVISION_KEY_PREFIX + chatKey)) || 0;
  } catch {
    return 0;
  }
}

/**
 * 为这次存档取得新的版本号。记忆体里的版本比别的分页存过的旧，回传 stale，呼叫端不得写入；
 * force 用于这个分页刚有新改动的冲突情形：以这个分页为准，领一个比别人都新的版本。
 */
export function claimChatRevision(chatKey, currentRevision, { force = false } = {}) {
  const latest = readLatestChatRevision(chatKey);
  const current = Number(currentRevision) || 0;
  if (latest > current && !force) return { stale: true, latest };
  const revision = Math.max(Date.now(), latest + 1, current + 1);
  try {
    storage()?.setItem(REVISION_KEY_PREFIX + chatKey, String(revision));
  } catch {}
  return { stale: false, revision };
}

/** 设定档存档完成后才通知：先记下来，等宿主回报写入 */
export function queueRevisionAnnouncement(chatKey, revision) {
  unannouncedRevisions.set(chatKey, revision);
}

export function announceSavedRevisions(revisions) {
  if (!channel || !revisions || Object.keys(revisions).length === 0) return;
  try {
    channel.postMessage({ type: 'saved', from: TAB_ID, revisions });
  } catch {}
}

export function markHostSettingsPending() {
  settingsPendingSince = Date.now();
}

/** 自己发起的立即存档写完了：这次存档开始前的待存标记都已涵盖 */
export function clearHostSettingsPendingUpTo(startedAt) {
  if (settingsPendingSince && settingsPendingSince <= startedAt) settingsPendingSince = 0;
}

/** 宿主回报设定写入完成：涵盖排程之后才开始的存档时，清掉待存标记并通知其他分页 */
export function settleHostSettingsSave() {
  if (settingsPendingSince && Date.now() - settingsPendingSince >= HOST_SETTINGS_SETTLE_MS) settingsPendingSince = 0;
  if (unannouncedRevisions.size === 0) return;
  const revisions = Object.fromEntries(unannouncedRevisions);
  unannouncedRevisions.clear();
  announceSavedRevisions(revisions);
}

/** 聊天旁档案（TauriTavern／Luker）的写入：开始与结束各记一次 */
export function trackSidecarWrite(promise, onWritten = null) {
  pendingSidecarWrites += 1;
  const settle = () => { pendingSidecarWrites = Math.max(0, pendingSidecarWrites - 1); };
  return promise.then((value) => {
    settle();
    try { onWritten?.(); } catch {}
    return value;
  }, (error) => {
    settle();
    throw error;
  });
}

export function hasPendingHostSave({ sidecarQueued = 0 } = {}) {
  const settingsPending = settingsPendingSince > 0 && Date.now() - settingsPendingSince < HOST_SETTINGS_PENDING_MAX_MS;
  return settingsPending || pendingSidecarWrites > 0 || sidecarQueued > 0;
}

/**
 * 只装一次。onRemoteSaved 收到别的分页的 { 聊天键: 版本 }。
 * BroadcastChannel 不存在的环境（极旧的 WebView）就只剩存档前的比对。
 */
export function installSaveSync({ onRemoteSaved } = {}) {
  if (channel || typeof globalThis.BroadcastChannel !== 'function') return;
  try {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = (event) => {
      const data = event?.data;
      if (!data || data.type !== 'saved' || data.from === TAB_ID) return;
      onRemoteSaved?.(data.revisions || {});
    };
  } catch {
    channel = null;
  }
}
