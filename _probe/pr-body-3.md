## 動機

對插件做了一次獨立審計（靜態走讀 + 最小復現），確認並修復工具層／API 層／註冊層／宿主層的多個問題；後續按用戶需求新增 v4 格式化輸出對齊 MVU、DeepSeek 自動切換與備裝風格世界書參考。MVU 相容與扶她種族的改動另開 PR。

## 改動

**tools.js**
- `bsAddSperm` 拒絕負數 `amount`：扣除精液一律走 `bsDrainSperm`。原行為會在扣精的同時重置 `latestSexDays`／`latestSexPartner`、甚至設置 `virginity`（「扣精＝破處」）。
- `bsChildbirth` 增加階段門禁：僅著床後的妊娠／產程階段（孕早期起）可調用；假孕期、未著床、非妊娠階段拒絕，並給出引導。
- `bsAbortion` 拒絕無胎兒的假孕期：原行為會進入產後恢復並 +1 流產經驗；結束假孕應走 `bsSetMenstrualPhases`。
- 性欲下降（負 delta）不再觸發泌乳（`applyMilkFromLibido` 提前返回）。
- `bsSetCharacterPresence` 要求顯式傳入 `isPresent`（缺省拒絕，避免隱式預設值）。
- `bsAddSperm` 工具描述同步為「僅加入，扣除請用 bsDrainSperm」。

**api.js**
- 直連 API Base 安全校驗 `assertSafeDirectApiBase`：`http://` 僅放行 localhost/127.0.0.1/::1（含 IPv6 方括號修正、畸形 `http:/host` 前綴繞過防堵）；代理→直連回退分支同樣校驗。
- 代理回退白名單擴充（401/403/404/405/429/5xx + 文本特徵）；`top_k` 透傳；配置類錯誤（無法解析/僅允許 localhost）排除出無意義重試。
- **格式化輸出對齊 MVU（新增）**：`response_format: json_object` 普通模式由設置開關控制；**模型名含 ds/deepseek 自動升級為完整 v4 兼容**（額外內嵌輸出結構指令，僅 tracker 流程注入，不影響 registry/備裝/日記/技能/繁育推演各自的 JSON schema），不受開關限制。
- **備裝風格世界書參考（新增）**：備裝生成可選併入 `assets/wardrobe-style-book.json`（用戶提供）中除「服裝描寫強化」外的 22 條性格穿搭風格條目；只發送條目正文 content，skill 化觸發提示（key/triggerWhen）與說明（ACU_SKILL_META）一律剔除；瀏覽器/Node/bundle 三種環境加載路徑完備。

**registry.js**
- 混血胎兒種族持久化修復：`race` 為胎兒完整種族（父×母），僅顯式 `fatherRace` 時才按「父系×母系」重算，杜絕二次混血污染（曾持久化出「XxYx人類」）。
- `sanitizeChildren` 保留 providerSources/chimera 元數據，兜底按 ×/x/X 分隔符拆分複合提供者。
- 備裝/註冊名解析對齊（大小寫/空格容差）。

**host.js**
- TT `refreshHostChatView` 分頁期間切聊天防護：每頁後復讀 chatId，不一致即放棄重試，不再把 A 聊天頁寫進 B 聊天緩存槽。

**state.js**
- 新增 `wardrobePrepStyleBook` 設置（備裝風格世界書開關，持久化）。

## 測試

`tests/audit_fixes.test.mjs`（新增）：負精液/分娩門禁/假孕流產/泌乳/presence/混血種族/未知成分/同基去重/api 安全校驗/DeepSeek 自動切換/世界書過濾等回歸覆蓋。完整版 181 測試全過。

## 備註

- 分三 PR 提交：本 PR（tools/api/registry/host/state 上游修復 + 新功能）、PR#1（MVU 相容）、PR#2（扶她種族 + 混血修復 + 蘋果主題）。
- bundle 構建產物與「酒館助手」JSON 為未追蹤本地工具，發版前需手動重建（`node _bundle/build.mjs`）。

## 安全审查修复（2026-08-10，防御式编程）

新增安全性修复（独立复核后确认的真实 P1/P2）：

- **P1 mainflow 提示注入**：状态 JSON 序列化后转义 `</` 与换行——角色卡/注册内容（描述/日记/种族名）含 `</bs_biotracker>` 曾可闭合包裹标签向主线 LLM 注入任意指令（经 setExtensionPrompt 可达主模型）
- **P1 bsPassedTime CPU 冻结**：各分量独立 clamp 后合计可达 2.6e8 分钟 → ~1e9 轮妊娠代谢循环冻结 UI；总量现封顶一年（365 天），上界收敛至 ~3.65M 轮（10-30ms）
- **P2 race 提示注入**：`<bs_race>` 高优先级块内全部 8 处 race/derivedType/精子/胎儿插值经消毒（剥离换行/`</`/控制字符含 C1 区）
- **P2 API http 明文旁路**：`assertSafeDirectApiBase` 改为无条件调用，覆盖 host-proxy 路径（key 经 proxy_password/custom_include_headers 交给 ST 后端的明文风险）
- **P2 toastr HTML sink**：bootstrap 时包装 `globalThis.toastr` 四方法，消息/标题经 escapeHtml 转义（ST toastr 以 .html() 插入，角色名/工具消息未转义曾可 DOM XSS）
- **P2 `__proto__` 原型污染**：characters 改 `Object.create(null)`（`__proto__`/constructor 角色名不再污染原型），getChatState 迁移存量 plain-object 并丢弃污染键

新增回归测试（本分支）覆盖上述各项；测试数同步更新。