# 项目工作流与系统运行机制

本文件阐述 **BS BioTracker** 插件在宿主环境中的挂载方式、异步追踪的执行流程，以及核心的状态流转和冲突避免机制。

---

## 1. 宿主集成与初始化

当 SillyTavern 等宿主加载扩展时，`index.js` 会执行如下挂载逻辑：
1. **全局时钟与轮询锁**：初始化 `globalThis[BOOTSTRAP_RUNTIME_KEY]` 避免重复加载。
2. **UI 构建与模态窗口**：在 SillyTavern 的扩展面板注入菜单项，并绑定弹窗（`bs-biotracker-modal`）的 DOM 构建。
3. **事件订阅**：
   - 监听宿主的生命周期事件：`APP_READY`、`CHAT_CHANGED`、`CHAT_CREATED`、`CHAT_DELETED`。
   - 切换聊天时，调用 `hydrateChatStateFromHost()` 重新载入对应聊天的状态。若为新对话，则调用 `inheritChatStateFromMatchingChat()` 尝试从同名历史对话继承状态，或者新建空状态。

---

## 2. 异步 Tracker 执行环 (The Async Tracking Cycle)

当启用「异步生理状态追踪」后，整个更新过程完全是自动执行的。其核心逻辑在 `scripts/tracker.js` 中的 `runTracker()` 内实现：

```
[ 新消息到达 ]
      │
      ▼ (宿主事件触发 after_ai / after_user)
┌─────────────────────────────┐
│    检查消息是否需触发追踪    │ (过滤掉不合规的角色/无关短语)
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│     MVU 额外模型解析门控     │ (mvuGateState 检测 MVU 是否正在解析变量)
└─────────────┬───────────────┘
              │ (等待 MVU 运行完成，宽限期内放行)
              ▼
┌─────────────────────────────┐
│       检查 Tracker 运行锁    │ (RUN_RUNTIME_KEY，防止并发)
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│    组装 Payload 发送请求    │ (结合 existing_state + 历史对话 + 外部记忆)
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│     解析工具调用响应 (JSON)  │ (api.js 的 extractJson 处理 DeepSeek 双重约束)
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│     执行 tools.js 进行更新  │ (根据 tool_calls 触发对应的 bsPassedTime 等)
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│    保存状态并拍摄快照(Snapshot)│ (压缩并使用 Patch 存储到宿主存档里)
└─────────────────────────────┘
```

### 关键细节说明：

#### A. 触发与轮询
- 触发时机支持 `after_ai`（AI 生成完后）和 `after_user`（用户送出消息后）。
- 在检测到新消息时，系统会加上一定的延迟时间（如 `AFTER_AI_SETTLE_MS`），以确保前台动画和数据写入已沉淀，然后再启动 `runTracker`。

#### B. MVU 门控协同 (MVU Gate)
- 当用户开启了另一个变量插件 MVU (Magical Variable Update) 的额外模型解析时，如果在正文刚输出完毕就立刻发 BioTracker 请求，会导致 API 重复并发，极大消耗 Token 并产生网络竞争。
- `tracker.js` 内部设计了 `mvuGateState`：通过订阅宿主的 `mag_variable_update_ended` 事件，并在 `fetch` 底层做钩子观测。如果确认本轮对话触发了 MVU 的解析，BioTracker 会挂起并等待，直到 MVU 更新结束后才放行 Tracker。

#### C. 死锁看门狗 (Run Watchdog)
- 为防止 API 长时间挂起、网络中断或宿主保存异常导致运行锁 `RUN_RUNTIME_KEY` 永远死锁，系统包含看门狗机制：如果距离上次标记 `RUN_STARTED_AT_KEY` 超过了设定的 API 时效（默认为 API Timeout + 2分钟），看门狗会强行释放锁，避免后续追踪再也无法触发。

---

## 3. 状态快照与 Patch 修补机制

因为 SillyTavern 的聊天存档通常是全部变量整体读写，当插件的角色数据、升级历史、主观日记和衣柜项目非常庞大时，会极大拖慢存档速度，甚至导致卡死或内存溢出。
为此，`scripts/state.js` 实现了一套高效的快照引擎：
1. **多级撤销/回退**：保存最近 24 次的对话快照。当用户在 SillyTavern 中撤回消息、重新生成时，插件检测到消息总数变少，会自动从 Snapshots 中回滚到对应那一楼的生理状态。
2. **Patch 压缩**：除了每 8 轮记录一次完整快照外，其余快照只记录增量 Patch。
   - 使用自定义的深度 Diff 算法：检测对象增删、数组追加（用特殊符号表示，如 `__bs_bt_array_append__`），删除项用 `__bs_bt_deleted__` 标记。
   - 这避免了全量保存造成的空间膨胀，在保存时进行差分，而在载入时执行 `restoreChatStateFromSnapshot` 进行完整还原。

### 3.1 楼层 Checkpoint 与 Swipe 隔离

每次成功的状态快照还会绑定到对应的 `ctx.chat[messageCount - 1].extra.bs_biotracker_checkpoint`。
Checkpoint 只保存快照记录及其楼层签名，不写入 `message.mes`，因此不会进入模型上下文；写入时仅合并插件自己的字段，保留其他扩展的 `extra` 数据。

在 SillyTavern 支持 Swipe 的消息上，同一份 Checkpoint 会同步写入当前 `swipe_info[swipe_id].extra`。读取时使用当前消息的 `extra`，由宿主在切换 Swipe 时同步对应槽位，从而避免不同候选回复共用状态。

Tracker 的手动、轮询入口都会先对账：校验 Checkpoint 的版本、楼层边界签名和内外层元数据；尾部删除后，超出当前聊天长度的快照被丢弃，最近仍存在且签名匹配的快照用于恢复完整 state，再从该楼继续分析。损坏或不完整的 Checkpoint 会被忽略，不覆盖已有 sidecar 状态。快照仍受最近 24 条保留上限和原有 Full/Patch 压缩策略约束。

---

## 4. 工具调度 (Tool Calls) 与闭环

Tracker LLM 的 System Prompt 指引其作为一个工具调度器。它无法直接改写角色的变量（避免 AI 编造离奇的数据或格式损坏），它只能且必须通过输出指定的 `tool_calls` 来影响状态。

- `api.js` 将接收到的 JSON 进行还原。
- `tools.js` 的 `applyToolCallsResult()` 会逐一校验工具名称和入参。
- 只有已定义的工具被调用后，其计算出的生理变化才会作用于 `state`。
- 执行成功后，系统会记录日志到角色 profile 的 `notify`（通知历史）或 `diary`（主观日记）中，UI 接收到气泡更新事件后在前端进行刷新，从而构成了一个完整的闭环。
