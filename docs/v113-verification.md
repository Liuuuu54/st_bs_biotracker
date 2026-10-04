# v1.1.3 綁卡與技能種子驗證

日期：2026-10-04。測試對象為 v1.1.3 工作樹，聊天 schema 6；這份紀錄區分離線、mock 瀏覽器與真實宿主證據，不宣告完整實機驗收或公開發行。

## 實作範圍

- [`card_settings.js`](../scripts/card_settings.js)：卡片欄位清理、逐欄位合併、名錄／基準整份取代、技能種子、能力探測、序列化寫入與刪除。
- [`state.js`](../scripts/state.js)：舊聊天與快照遷移、sidecar 確認後才帶入種子，保留種子標記與聊天 ID 分配器。
- [`index.js`](../index.js)、[`settings.html`](../settings.html)：全域／卡片編輯範圍、來源標示、清除後回落、技能帶入／存卡／清除；系統頁保存不會把百科的卡片值寫入全域。
- 註冊、追蹤、工具與百科共用生效設定。群聊忽略卡片；API、主題與開關仍為全域；角色技能等級、天賦與生理快照不匯出為種子，也不因編輯卡片而重算。

## 自動回歸

環境：Windows、Node v22.16.0。`node --experimental-default-type=module --test` 加上 `tests/` 中所有 `*.test.mjs`；詳細執行紀錄留在 OS 臨時日誌。

最終完整回歸 **865 項通過，0 失敗、0 跳過**，包含新功能的 17 項 [`card_settings.test.mjs`](../tests/card_settings.test.mjs)。涵蓋綁卡優先序、技能種子、舊聊天遷移、保存失敗與刪除，以及既有保險套容量／可靠度／重試、事後避孕時間窗口與逐來源結算。日誌：`%TEMP%/bs-biotracker-v113-regression-complete.tap`。

第一輪全套的 UI 靜態檢查曾因匯入順序改變失敗，恢復受檢查的匯入位置後通過；最終回歸也包含這項檢查。

## Mock 瀏覽器

命令：`node tests/check-card-settings-ui.mjs`。獨立 headless Chrome、1400 × 1000，另捕捉 320 × 900 截圖；使用現有 harness 的副本注入 fixture，沒有更動正常聊天或呼叫模型。

| 案例 | SillyTavern mock | TauriTavern mock | Luker mock |
|---|---|---|---|
| 自動技能種子／存卡／清除後聊天資料保留 | 通過 | 通過 | 通過 |
| 世界基準存卡與全域隔離 | 通過 | 通過 | 通過 |
| 物種覆寫保存／清除後回落全域 | 通過 | 通過 | 通過 |
| 生殖基準保存／清除、種子與其他擴充保留 | 通過 | 通過 | 通過 |
| 未處理瀏覽器例外 | 0 | 0 | 0 |

這些只證明模擬介面與流程接線；不能證明原生宿主匯出卡片、WebView、真實保存 API 或模型選工具。

## 真實宿主

[`check-card-settings-host.mjs`](../tests/check-card-settings-host.mjs) 使用明確指定的本機安裝，另建立臨時設定、資料與工作樹插件 junction；以宿主匯入一張臨時卡，核對載入源码 hash，再測技能種子、實際卡片保存／回讀、巢狀刪除與其他擴充保留。測試資料保留於 OS 臨時目錄，程式結束會停止其測試宿主與瀏覽器。

| 宿主 | 狀態 |
|---|---|
| SillyTavern 1.19.0 | 隔離實機通過：匯入卡片、自動技能種子、保存回讀、巢狀刪除、種子匯出不含 ID、命名空間刪除與其他擴充保留；未處理例外 0 |
| Luker 2.7.0 | 隔離實機通過：匯入卡片、自動技能種子、保存回讀、巢狀刪除、種子匯出不含 ID、命名空間刪除與其他擴充保留；未處理例外 0 |
| TauriTavern 2.3.0 | 正常安裝以 WebView2 除錯埠驅動（非隔離，先備份資料夾，測試卡與聊天事後刪除）通過：匯入卡片、自動技能種子、存卡回讀、巢狀刪除、命名空間刪除與其他擴充保留；百科「目前角色卡」選項、存世界基準、清除卡片基準回落全域、技能頁帶入／存卡／清除按鈕；切到別張卡不帶出卡片設定 |

重現命令：`node tests/check-card-settings-host.mjs D:/SillyTavern sillytavern`、`node tests/check-card-settings-host.mjs D:/Luker luker`。兩者使用獨立插件名稱 `st_bs_biotracker_v113_test`，避開宿主全域插件路徑優先載入舊版檔案的情況；正常使用的設定、卡片與插件沒有被本次測試改寫。

最終實機日誌與結果位於 `%TEMP%/biotracker-sillytavern-real-kgYaUh`、`%TEMP%/biotracker-luker-real-ddS72c`；mock 截圖與結果位於 `%TEMP%/biotracker-card-ui-E7To7p`。實機載入的 `index.js` SHA-256 為 `ed03bcc16ea461b7dec7abd8b54086926687fe0eaf70bdef33b46e1bcaf599aa`，兩宿主均與工作樹比對一致。

TauriTavern 實測發現：它的 `writeExtensionField` 與 SillyTavern 相同，走 `/api/characters/merge-attributes` 深合併並處理巢狀刪除標記，原本只對 SillyTavern 送標記，導致刪掉的巢狀欄位（例如卡片上某物種的單一參數）留在磁碟、重載後復活；`/api/characters/get` 也可用。現改為除 Luker 外都送刪除標記，並在 TauriTavern 一併回讀核對；修正後重測通過，回歸 866 項通過。

## 不花錢的實機回歸（2026-10-04）

不呼叫模型：工具結算直接呼叫插件的 `applyToolCallsResult`，聊天訊息用 `/send`、`/cut`。SillyTavern 1.19.0、Luker 2.7.0 用臨時資料目錄與工作樹 junction 隔離；TauriTavern 2.3.0 在使用者安裝上以 WebView2 除錯埠驅動，測試卡、聊天、群組與自動備份事後刪除，插件檔案還原。

| 項目 | SillyTavern | Luker | TauriTavern |
|---|---|---|---|
| 三張卡（A、B、無設定）切換：各自生效、不串卡、全域不被改寫 | 通過 | 通過 | — |
| 重載後卡片設定與技能種子不重複 | 通過 | 通過 | — |
| 匯出 PNG／JSON 再匯入，`bs_biotracker` 與其他擴充欄位保留 | 通過 | 通過 | — |
| 跨宿主：ST 匯出匯入 Luker、TauriTavern；Luker 匯出匯入 ST | 通過 | 通過 | 通過 |
| 技能種子：清空不重帶、技能頁手動帶入、總開關關閉不帶、開回後新聊天帶入、schema 5 舊聊天遷移不帶 | 通過 | 通過 | — |
| 群聊忽略卡片設定、隱藏寫卡 | 通過 | 通過 | 通過 |
| R1–R3：卡A 可靠度 0 → 破裂；卡B 容量 5 → 撐爆全進；無設定卡用全域 → 全擋 | 通過 | 通過 | — |
| R5–R6：即時事後避孕結算、同來源重試不重抽、無接觸不建立保護 | 通過 | 通過 | — |
| R8：破套與事後避孕結果重載保留；刪兩樓退回、再重載仍一致；技能種子標記不受回退影響 | 通過 | 修正後通過 | 通過（見下） |
| schema 4 舊存檔遷移到 6：由種族字串推出血脈比例 | 通過 | 通過 | — |
| 族譜圖示在真實宿主顯示（13 張卡） | 通過 | 通過 | — |

Luker 的 R8 原本失敗：重載後追蹤資料消失。追查發現 Luker 2.7.0 的 `getChatState`／`updateChatState` 回傳 `{ok, state}` 外殼且失敗不拋錯，插件仍按舊的 `{version, chatState}` 讀取，每次都讀成沒有存檔；重載後帶入技能種子並存檔，把原資料覆蓋。修正見 [`host.js`](../scripts/host.js)，回歸 867 項通過。

TauriTavern 刪樓後，回退要等下一次追蹤或重載才套用（宿主只提供分頁聊天視圖，`getChatState` 不在稀疏視圖下比對快照）；重載後狀態正確。這是既有設計，本版未改。

宿主主題（Dark Lite、Cappuccino、Celestial Macaron、Azure）不影響插件面板，族譜圖示的配色跟著插件自己的主題。

## 宿主介面來源與限制

`writeExtensionField(characterId, key, value)`、`UNSET_VALUE`、`getRequestHeaders()` 與 `/api/characters/get` 依本機 SillyTavern 1.19.0、Luker 2.7.0 的 `public/scripts/extensions.js`、`st-context.js`、`src/endpoints/characters.js` 查證。SillyTavern 的伺服器會深合併並處理刪除標記；Luker 的寫入宣告為命名空間整份取代。原生寫卡介面可能記錄 HTTP 失敗後仍正常返回，因此插件在提供讀取介面的宿主回讀已保存卡片核對。

各宿主只按實際暴露的寫卡函式探測（TauriTavern 2.3.0 有提供）；未提供時隱藏寫卡操作、仍讀取卡片設定，沒有發明另一套寫卡 API。插件沒有新增第三方函式庫或遠端載入依賴。

真實模型對避孕結果的承接（R4、R7）、開分支，以及 TauriTavern 的切卡、匯出再匯入與技能種子細項仍需實機證據。無此避孕手段的世界觀開關未新增；本版沿用世界基準文字與既有工具約束。
