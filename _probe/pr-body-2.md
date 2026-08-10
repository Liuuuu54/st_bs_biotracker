## 動機

角色卡需要扶她（futanari）這類「女性身體＋男性性器官，既能使人受孕也能自身受孕」的種族時，目前只能借用現有雙性種族（史萊姆、寶箱怪等怪物系）或靠使用者自行覆蓋生理參數。本 PR 直接提供內建「扶她」種族，並包含混血合併修復與全新的蘋果（Apple）毛玻璃主題、備裝界面增強。

## 改動

**`scripts/race_config.js`（扶她種族 + 混血修復）**
- `VIVIPAROUS_RACES`（胎生組）加入「扶她」——調色盤、種族圖鑒、註冊/推演流程自動生效，胚胎類型判定為胎生；`RACE_PHYSIOLOGY_PROFILES` 新增扶她生理配置（`genderRatio: null` = 雙性）。
- 混血 `genderRatio` 合併優先級修正：null（雙性）＞ -1（無性）＞ 數值平均——「扶她x人類」不再被抹成普通男女（50→null）。
- 混血合併去重：同基種族帶不同裝飾子項（「獸耳族-兔x獸耳族-貓」）時按基種族去重，避免雙重加權。
- 未知混血成分不靜默丟棄：`hasUnknownRace` 標記讓提示詞注明「數值僅供參考」。

**`scripts/race_prompt_context.js`**
- 混血平均提示補 `hasUnknownRace` 說明行。
- 妊娠生理偏移計算與工具側對齊（天數調和平均，不再按胎重加權），提示詞顯示的數值與系統實際推進一致。

**蘋果（Apple）主題（設定類，主題列表第 13 項）**
- iPhone 玻璃後殼風格：鈦金屬軸向漸變外殼 + 磨砂玻璃屏幕（`backdrop-filter: blur(28px) saturate(200%)` + 半透明白蒙 0.14）+ 亮頂邊 + 蘋果藍 `#007aff` 激活態 + SF/system-ui 字體棧。
- **背景圖**：可選琪露諾冰藍壁紙（`assets/backgrounds/cirno-ice-blue.png`，720×1440）作為屏幕毛玻璃底——貼圖只進屏幕區域（`.bs-bt-screen::before` + `filter: blur(48px)` 直接模糊，環境無關），手機 `position 50% 0%`、平板 `50% 30%`（kimi 視覺模型定裁剪）。
- 雙兜底（`@supports not` / `prefers-reduced-transparency`）選擇器集合一致；`::after` 白蒙顯式 `opacity:1`（不被基礎掃描線規則稀釋）。
- 設置項 `<small>` 解釋文字可讀性修復（base 全局 + 蘋果主題加深）。

**備裝界面增強**
- 「參考服裝風格世界書」複選框（持久化）：開啟後把 `assets/wardrobe-style-book.json` 中除「服裝描寫強化」外的 22 條性格穿搭風格併入備裝提示詞，供模型參考生成符合角色氣質的衣柜；只發送條目正文，附 token 消耗警告（約 2 萬 token，僅生成備裝時發送一次）。

**`index.js` / `settings.html`**
- 主題註冊三處一致（THEME_CONFIG + 列表按鈕 + CSS 變量塊）；世界書複選框接線與持久化。

## 測試

`tests/race_hybrid.test.mjs`（新增）：扶她x人類 genderRatio=null / 未知成分 hasUnknownRace / 同基去重。完整版 181 測試全過。

## 備註

- 分三 PR 提交：本 PR（扶她種族 + 混血修復 + 蘋果主題 + 備裝 UI）、PR#1（MVU 相容）、PR#3（工具/API/註冊/宿主修復 + v4 格式化 + 世界書邏輯）。
- 蘋果主題視覺經 kimi-k2.7-code 多輪審查（初始診斷 → 回爐 v3 → 背景圖 → 磨砂調優），最終「合格可交付」。
- bundle 構建產物與「酒館助手」JSON 為未追蹤本地工具，發版前需手動重建。

## 安全审查修复（2026-08-10，防御式编程）

新增安全性修复（独立复核后确认的真实 P1/P2）：

- **P1 mainflow 提示注入**：状态 JSON 序列化后转义 `</` 与换行——角色卡/注册内容（描述/日记/种族名）含 `</bs_biotracker>` 曾可闭合包裹标签向主线 LLM 注入任意指令（经 setExtensionPrompt 可达主模型）
- **P1 bsPassedTime CPU 冻结**：各分量独立 clamp 后合计可达 2.6e8 分钟 → ~1e9 轮妊娠代谢循环冻结 UI；总量现封顶一年（365 天），上界收敛至 ~3.65M 轮（10-30ms）
- **P2 race 提示注入**：`<bs_race>` 高优先级块内全部 8 处 race/derivedType/精子/胎儿插值经消毒（剥离换行/`</`/控制字符含 C1 区）
- **P2 API http 明文旁路**：`assertSafeDirectApiBase` 改为无条件调用，覆盖 host-proxy 路径（key 经 proxy_password/custom_include_headers 交给 ST 后端的明文风险）
- **P2 toastr HTML sink**：bootstrap 时包装 `globalThis.toastr` 四方法，消息/标题经 escapeHtml 转义（ST toastr 以 .html() 插入，角色名/工具消息未转义曾可 DOM XSS）
- **P2 `__proto__` 原型污染**：characters 改 `Object.create(null)`（`__proto__`/constructor 角色名不再污染原型），getChatState 迁移存量 plain-object 并丢弃污染键

新增回归测试（本分支）覆盖上述各项；测试数同步更新。