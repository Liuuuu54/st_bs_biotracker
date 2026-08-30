# PRD - Fix BioTracker Regex UI UI persistent and doc

## Goal

修复 SillyTavern BioTracker 插件中历史消息正则处理（History Regex Pipeline）的一系列问题，包括：
1. 解决因触发分析或刷新历史视图导致的 SillyTavern 循环登录弹窗问题（recurring login popups）。
2. 重构正则设置 UI，优化布局（每条规则单行展示，去除多余换行、对齐不当等情况，并在底部放置 Add/Delete 等按钮）。
3. 彻底删除设置面板中的当前楼层预览功能代码及对应 UI 元素。
4. 确保正则规则通过 SillyTavern / TauriTavern 的 extensionSettings 存储机制持久化，在切换聊天或刷新页面后依然能够正常保存与恢复。
5. 编写历史消息正则功能的 Markdown 说明文档。

## Requirements

1. **解决登录弹窗 Bug**
   - 之前在 Tauri 环境或特定宿主环境下，自动/手动分析或调用 API 时会弹出 SillyTavern 的登录弹窗。
   - 需要排查请求鉴权头中的 authorization、CSRF token、以及与宿主通讯的 `refreshHostChatView` 和 `api.js` 中 `fetchText`/`fetch` 行为，确保正常通过 host proxy 转发或退回直连时，不触发登录验证。
   - 彻底修复 `scripts/host.js` 中对 Tauri 或是 SillyTavern 接口的可能触发验证的安全认证行为（比如对 credentials 的携带、CSRF Header 缺失导致的验证提示等）。

2. **重构设置 UI 布局**
   - 当前在 `settings.html` 中的历史消息正则列表比较臃肿，含有 checkbox 以及较多的按钮。
   - 优化正则设置 UI 布局：让每个正则规则在一行（row）内完整展示，结构应当紧凑：
     - 类型下拉框（提取/排除） + 正则文本输入框（Text input） + 上移/下移按钮 + 启用/禁用复选框 + 删除按钮。
     - 动作按钮（新增规则）放置在列表底部。

3. **删除预览功能**
   - 彻底移除 "预览当前楼层提取结果" 按钮以及相关的预览逻辑。
   - 包括删除 `settings.html` 中的 `bs-bt-history-regex-preview-range`、`bs-bt-history-regex-preview` 按钮、状态提示框、预览结果展示容器 `<div id="bs-bt-history-regex-preview-output">` 等。
   - 删除 `index.js` 中的 `previewHistoryRegex` 方法及事件监听器 `bs-bt-history-regex-preview`，仅保留核心正则编译、匹配和替换管道逻辑。

4. **实现持久化与跨会话存储**
   - 确保 `historyRegexRules` 在用户点击插件的 "设置已保存" (`#bs-bt-save` / `#bs-bt-connect`) 或是保存其他设置时，能正确序列化并写入 SillyTavern / TauriTavern 宿主的插件 settings (即 `extensionSettings`)。
   - 在加载/渲染设置弹窗时，能从 `getSettings(ctx)` 读取出已保存的 `historyRegexRules` 并正确还原到 UI 表单里。

5. **编写 Markdown 说明文档**
   - 编写 `docs/history_regex.md`，对历史消息正则功能的设计目的、处理顺序（按楼层独立执行，自上而下流水线处理）、支持的正则语法（例如 `/pattern/flags` 和纯正则）、提取与排除规则差异（如何取第一个有定义的捕获组或完整匹配）等进行详尽归档。

## Acceptance Criteria

- [ ] **Tauri/SillyTavern API 鉴权稳定性**：运行 `tests/api.test.mjs` 和 `tests/host_proxy_csrf.test.mjs` 以及所有单元测试，全数通过。在 Tauri 环境下加载/翻页时，绝不因缺少 Headers 或无效 credentials 触发登录验证。
- [ ] **UI 布局重构**：规则列表的 HTML/CSS 布局合理，每行包含类型下拉、正则输入、上下移动、启用勾选、删除按钮；新增规则按钮在下方。
- [ ] **预览功能删除**：设置页里没有任何与“预览”相关的按钮、输入框、日志输出等；`index.js` 和 `settings.html` 中所有 preview 相关的代码全部清除。
- [ ] **跨会话持久化**：在设置界面修改正则规则并点击保存后，数据正确写入宿主 Settings。刷新页面或重新打开小手机面板时，规则顺序与勾选状态与保存前完全一致。
- [ ] **文档完备性**：`docs/history_regex.md` 存在且格式正确，清晰描述本功能使用与实现。

