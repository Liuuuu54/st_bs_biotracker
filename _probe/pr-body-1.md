## 動機

BS BioTracker 在正文出完後會立刻發送生理追蹤請求。當角色卡使用 MVU 變量框架並開啟「額外模型解析」時，MVU 會在正文出完後再次呼叫 API 更新變量——兩條請求並行，第一條追蹤請求白耗額度；且 MVU 解析完成後會把 `<UpdateVariable>` 追加到該樓訊息，觸發「分析期間訊息被修改」的防呆，使第一條請求作廢並再發第二條（雙重消耗）。

## 改動

新增設定「MVU 額外模型解析相容」（系統設定頁，預設開啟，可關閉）：

- 偵測到 MVU 開啟「額外模型解析」時，把自動追蹤請求延遲到該輪變量更新結束後再發送。
- 多信號判定（任一命中即等待）：
  1. **fetch 鉤子**：觀測正文之後仍有非本插件的 chat-completions/generate 請求在飛行（TT 下設置與 Mvu 全域常讀不到，但 MVU 的請求必然走頁面 fetch——最可靠的硬信號）。
  2. 輪詢 `Mvu.isDuringExtraAnalysis()`。
  3. 監聽 `mag_variable_update_ended` 事件。
  4. 寬限期（4 秒）等待信號出現；僅「曾見過 MVU 信號」的環境才走寬限期，非 MVU 卡零延遲。
- **重擲/編輯防呆（round-2 修復）**：同 id 重擲或編輯後，內容指紋（buildSignature 內容哈希）變化會重置等待窗口（`pendingContentKey`），舊寬限期不立即放行；ended 事件需 roundKey + contentKey 雙匹配才放行，避免誤用上一輪的結束事件。
- `after_user` 觸發時機不受影響；自動請求關閉、首樓等不會解析的情況直接放行。
- **mainflow 快照 chatKey 綁定（round-2 修復）**：捕獲側拿不到聊天綁定就不寫快照（`index.js captureMainflowRequestBody`）；讀取側要求快照 chatKey 非空且匹配當前聊天（`tracker.js getMainflowContextSnapshot`），跨聊天/舊格式一律拒絕，杜絕跨聊天污染。
- mainflow 快照捕獲跳過 MVU 額外解析請求，避免追蹤上下文被 MVU 更新提示詞污染。
- 每輪等待時 toast 提示一次，方便肉眼確認門控生效。

## 檔案

- `scripts/tracker.js`：門控邏輯（fetch 鉤子 / Mvu 輪詢 / 事件 / 寬限期 / 內容指紋重擲重置 / 快照 chatKey 讀側校驗）
- `scripts/state.js`：新設定 `mvuExtraAnalysisCompat`（預設 true）
- `settings.html` / `index.js`：設定 UI 與讀寫、快照捕獲 chatKey 綁定
- `tests/mvu_gate.test.mjs`：門控單元測試（含重擲重置、快照 chatKey 綁定用例）

## 測試

- 本分支：`node --test tests/*.test.mjs` 167 全過（含門控 18+ 例）。
- TauriTavern + 酒館助手環境實測：MVU 卡開「額外模型解析」時，正文出完出現「MVU 兼容」toast，等待變量更新完成後才發送追蹤請求，單輪僅一條追蹤請求。

## 備註

- 分三 PR 提交：本 PR（MVU 相容）、PR#2（扶她種族 + 混血修復 + 蘋果主題）、PR#3（工具/API/註冊/宿主修復 + v4 格式化 + 備裝世界書）。

## 安全审查修复（2026-08-10，防御式编程）

新增安全性修复（独立复核后确认的真实 P1/P2）：

- **P1 mainflow 提示注入**：状态 JSON 序列化后转义 `</` 与换行——角色卡/注册内容（描述/日记/种族名）含 `</bs_biotracker>` 曾可闭合包裹标签向主线 LLM 注入任意指令（经 setExtensionPrompt 可达主模型）
- **P1 bsPassedTime CPU 冻结**：各分量独立 clamp 后合计可达 2.6e8 分钟 → ~1e9 轮妊娠代谢循环冻结 UI；总量现封顶一年（365 天），上界收敛至 ~3.65M 轮（10-30ms）
- **P2 race 提示注入**：`<bs_race>` 高优先级块内全部 8 处 race/derivedType/精子/胎儿插值经消毒（剥离换行/`</`/控制字符含 C1 区）
- **P2 API http 明文旁路**：`assertSafeDirectApiBase` 改为无条件调用，覆盖 host-proxy 路径（key 经 proxy_password/custom_include_headers 交给 ST 后端的明文风险）
- **P2 toastr HTML sink**：bootstrap 时包装 `globalThis.toastr` 四方法，消息/标题经 escapeHtml 转义（ST toastr 以 .html() 插入，角色名/工具消息未转义曾可 DOM XSS）
- **P2 `__proto__` 原型污染**：characters 改 `Object.create(null)`（`__proto__`/constructor 角色名不再污染原型），getChatState 迁移存量 plain-object 并丢弃污染键

新增回归测试（本分支）覆盖上述各项；测试数同步更新。