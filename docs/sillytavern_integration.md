# 宿主集成、外部 API 与接口端点说明

为了便于开发者后续进行代码维护、调试与快速定位，本文件详细列出了插件在**哪个文件**的**哪个函数**中，通过**哪个接口端点（全局变量、API、网络端点）**与宿主（SillyTavern / Luker / TauriTavern）及外部大模型接口进行数据交互，以及其提取/发送的信息和具体功能作用。

---

## 一、 宿主核心上下文与感知端点 (SillyTavern)

### 1. 运行上下文提取端点
- **接口端点**：`globalThis.SillyTavern?.getContext?.()` 或 `globalThis.Luker?.getContext?.()`
- **文件定位**：`scripts/host.js` -> 函数 `getHostContext()`
- **提取信息**：获取宿主的核心运行时上下文对象 `ctx`（包含酒馆当前加载的角色数据、群组数据、聊天配置、事件管理器等）。
- **对应功能**：作为插件获取一切酒馆运行时状态和交互动作的基石入口。

### 2. 宿主类型感知端点
- **接口端点**：`globalThis.__TAURITAVERN__` 和 `globalThis.Luker` 全局对象是否存在。
- **文件定位**：`scripts/host.js` -> 函数 `getHostKind()`
- **提取信息**：返回 `'tauritavern'`、`'luker'` 或 `'sillytavern'`。
- **对应功能**：让插件在不同客户端下自动选择不同的读写持久化路径（例如普通网页版使用插件 Settings，而 TauriTavern/Luker 端会独立持久化）。

---

## 二、 聊天数据与会话状态端点 (SillyTavern)

### 1. 历史消息提取
- **接口端点**：`ctx.chat`
- **文件定位**：`scripts/host.js` -> 函数 `getHostChat(ctx)`
- **提取信息**：当前聊天会话的整轨消息数组（每一个消息对象含 `name`、`text`、`is_user`、`extra` 等信息）。
- **对应功能**：Tracker 追踪时需要拉取最近的 `contextSize` 条消息，分析剧情并提取工具调用指令。

### 2. 远期对话历史翻页加载 (TauriTavern 特有)
- **接口端点**：`api.current.handle().history.tail({ limit })` 与 `before(page, { limit })`
- **文件定位**：`scripts/host.js` -> 函数 `refreshHostChatView(ctx)`
- **提取信息**：翻页获取大对话中的远期楼层数据。
- **对应功能**：用于解决桌面端只缓存了最末几楼前文的问题，Tracker 能够向前追溯拉取足量上下文。

### 3. 会话 ID 隔离
- **接口端点**：`ctx?.getCurrentChatId?.()` / `ctx?.chatId` 以及辅助的 `ctx?.characterId` / `ctx?.groupId`
- **文件定位**：`scripts/host.js` -> 函数 `getFallbackHostChatId(ctx)`、`resolveHostChatId(ctx)`
- **提取信息**：当前会话的唯一 Hash 或 UUID 标识。
- **对应功能**：实现会话级别的状态物理隔离，防止不同群聊、不同人设卡身上的生理状态和妊娠数据发生串行污染。

---

## 三、 角色卡与世界书端点 (SillyTavern)

### 1. 角色数据与用户名替换宏
- **接口端点**：`ctx.characters` 与 `ctx.substituteParamsExtended(raw)` / `ctx.substituteParams(raw)`
- **文件定位**：`scripts/host.js` -> 函数 `getHostCharacters(ctx)`；以及 `scripts/registry.js` -> 函数 `resolveRegistryTargetName(ctx, value)`
- **提取信息**：酒馆加载的角色卡详情（名字、描述等），并将名字中的 `{{user}}`/`user` 等宏替换为真实的玩家用户名。
- **对应功能**：用于注册时自动分析该角色的特征，并在工具执行时精准识别人名称呼。

### 2. 绑定的世界书信息读取
- **接口端点**：`ctx.loadWorldInfo` / `globalThis.ST_API?.worldBook?.get({ name, scope })`
- **文件定位**：`scripts/host.js` -> 函数 `loadHostWorldInfo(ctx, name)`、`getHostWorldBook(name, scope)` ；以及 `scripts/registry.js` -> 函数 `getCharacterWorldBook(ctx)`
- **提取信息**：获取指定名称的世界百科（Lorebook）条目详情。
- **对应功能**：角色注册时利用世界书配置繁殖常数，或在选用 `database` 外部记忆源时检索对应世界书中的数据库纪要。

### 3. 世界书编译后 Prompt 生成
- **接口端点**：`ctx.getWorldInfoPrompt(chat, maxContext, includeNames)`
- **文件定位**：`scripts/host.js` -> 函数 `getHostWorldInfoPrompt(...)`
- **提取信息**：获取当前场景下经酒馆系统处理完毕、即将拼接发送给大模型的 Prompt 文本。
- **对应功能**：为 Tracker 和注册生成包含当前世界百科设定的提示词上下文。

---

## 四、 第三方扩展插件交互端点 (外部记忆源)

当在设置中启用外部记忆源时，插件会向第三方扩展的公开端点提取总结记忆：

### 1. Anima 扩展端点
- **接口端点**：`globalThis.TavernHelper` -> `getChatWorldbookName('current')` 和 `getWorldbook(bookName)`
- **文件定位**：`scripts/memory_sources.js` -> 函数 `readAnima(recentMessages, limit)`
- **提取信息**：获取由 Anima 插件自动在当前会话记录并生成的历史总结 Lore 碎片列表。
- **对应功能**：选用 `anima` 记忆源时，从 Anima 百科中筛选出与当前剧情最相关的历史事件碎片提供给 Tracker 作背景。

### 2. 柏宝书扩展端点
- **接口端点**：`globalThis.STBaiBaiBook` -> `STBaiBaiBook.getInjectedHistory()`
- **文件定位**：`scripts/memory_sources.js` -> 函数 `readBaiBai()`
- **提取信息**：获取柏宝书插件总结的相对记忆文本。
- **对应功能**：选用 `baibai` 记忆源时，提取其总结的长历史做背景上下文。

---

## 五、 数据持久化存储与 UI 注册端点 (SillyTavern)

### 1. 宿主插件设置存盘
- **接口端点**：`ctx.extensionSettings` 与 `ctx?.saveSettingsDebounced?.()`
- **文件定位**：`scripts/host.js` -> 函数 `getHostExtensionSettings(ctx)`、`saveHostSettings(ctx)`
- **对应功能**：读写酒馆官方扩展设置字段，并触发酒馆后台防抖自动保存全局选项（如主题样式、轮询间隔等）。

### 2. 聊天专属 Sidecar 存档 (TauriTavern / Luker 端)
- **接口端点**：`handle.store.getJson` / `setJson` 以及 `ctx.updateChatState`
- **文件定位**：`scripts/host.js` -> 函数 `loadHostChatState(ctx)`、`scheduleHostChatStateSave(ctx, chatState)`
- **对应功能**：由于多角色追踪数据量很大，在此端点下将其以独立 JSON 保存在当前会话的 Sidecar 附件中，不占用酒馆主 Settings 空间。

### 3. UI 扩展面板挂载
- **接口端点**：`globalThis.ST_API?.ui?.registerExtensionsMenuItem(options)`
- **文件定位**：`scripts/host.js` -> 函数 `registerHostExtensionMenuItem(options)`
- **对应功能**：将插件注册到酒馆侧边栏扩展项中，供玩家点击呼出控制面板。

---

## 六、 外部 API 网络发送端点 (向外通信端点)

当插件需要分析会话内容、拉取模型或进行角色初始推演时，会通过网络与外部的 OpenAI 兼容 API 发起通信：

### 1. 对话补全接口 (Tracker 追踪与注册推演)
- **外部发送端点**：`apiBase + '/chat/completions'`
- **文件定位**：`scripts/api.js` -> 函数 `callOpenAICompatible(payload, settings)`
- **通信协议**：`POST` 请求。通过 `globalThis.fetch(url, options)` 直接发送或通过酒馆后端转发（Tauri 代理）。
- **发送信息**：
  - **Headers**：`Content-Type: application/json` 和 `Authorization: Bearer <API_KEY>`（直接通信时）或带 `X-CSRF-Token` 的酒馆代理头。
  - **Payload**：
    - `model`：在 SYSTEM 设置页所填写的模型名称。
    - `messages`：包含组装好的 Tracker 引导 System Prompt、当前角色的 `existing_state` JSON 状态文本、近期对话上下文（`contextSize` 楼层数）、以及通过外部记忆源检索出的长记忆。
      > **注意**：从安全与隐私角度出发，为了**禁止记忆（外部历史记忆源摘要）泄露到主线 user 消息或在直接通信 Payload 中过度传输**，Payload 的 `safePayload` 会显式删除 `memory_context`（外部记忆上下文文本）与 `memory_source`（记忆源标识）这两个可能包含敏感历史总结的字段。
    - `response_format`：设置为 `{"type": "json_object"}` 限制输出格式。
    - 推理参数：`temperature`、`top_p`、`frequency_penalty` 等。
- **作用**：向大模型发送上下文让其解析剧情，并返回符合格式的调度指令 `tool_calls`。

### 2. 模型列表获取接口 (API 连接测试)
- **外部发送端点**：`apiBase + '/models'`
- **文件定位**：`scripts/api.js` -> 函数 `fetchModelList(settings)`
- **通信协议**：`GET` 请求。
- **发送信息**：带鉴权的 Headers，不含 Payload。
- **作用**：拉取 API 支持的模型列表，供玩家在 SYSTEM 设置页的下拉菜单直接选择。

---

## 七、 宿主生命周期事件监听端点 (SillyTavern)

插件通过 `subscribeHostEvent` 挂载宿主的事件监听器：

- **`ctx.eventSource` 上的 `ctx.event_types.APP_READY`**
  - **对应功能**：酒馆及所有扩展模块加载完毕后，启动 BioTracker 的轮询心跳（Poller），防止未挂载完全时操作报错。
- **`ctx.event_types.CHAT_CHANGED` / `CHAT_CREATED`**
  - **对应功能**：重置当前状态并立即调用 `hydrateChatStateFromHost` 加载或继承新会话的生理数据。
- **`ctx.event_types.CHAT_DELETED` / `GROUP_CHAT_DELETED`**
  - **对应功能**：同步销毁 Sidecar 对应的聊天存档。
