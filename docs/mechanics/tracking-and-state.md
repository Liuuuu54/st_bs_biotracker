# 追蹤、API 與存檔

[返回機制索引](README.md)

## 角色從哪裡來

角色需先初始化／註冊；沒有已註冊角色時追蹤直接跳過。[runRegistry](../../scripts/registry.js#L2407)讀取指定目標、角色卡、世界書與既有資料，呼叫 API，再由 [applyRegistryResult](../../scripts/registry.js#L1771)寫入角色。目標名稱由呼叫端決定，不能靠模型輸出重新命名。技能初始化、心理推論、衣櫃準備、日記補建是註冊流程中各自的子流程；不是每次追蹤都重新初始化。相關入口見 [registry.js](../../scripts/registry.js#L761)。

每個聊天有獨立的 `chatState`，包含角色字典、累積時間、技能目錄、場景摘要、最後結果與快照。角色的 `profile` 再分成 `base`、`pregnant`、`experience`、`psychology`、`bio`、`metabolism`、`wardrobe` 等區塊；另有 `runtime` 儲存時間零頭與生理原值。[預設結構](../../scripts/state.js#L662)中的角色字典使用無原型物件，避免特殊角色名碰到 JavaScript 內建屬性。

概覽階段進度直接讀取角色生理時鐘，與引擎共用門檻；各階段起算點、分母與單位見[階段進度核對](../v110-ui-stage-progress.md)。

## 一樓訊息的處理路徑

1. [runTracker](../../scripts/tracker.js#L1741)先從宿主載入聊天狀態與最新聊天視圖，並取得已註冊角色。
2. 自動輪詢確認宿主生成完成、Agent 提交完成、AI 訊息已穩定；啟用 MVU 額外分析時還會等其結束。Luker 多智能體安全模式預設要求手動分析。相同對話的失敗自動重試會暫停。
3. 對帳快照後逐樓處理。手動分析使用自己的尾樓重放路徑；自動分析從尚未處理的樓層繼續。[主迴圈](../../scripts/tracker.js#L1839)。
4. [buildTrackerPayload](../../scripts/tracker.js#L1301)組出角色卡、世界書或主流程上下文、近期訊息、已註冊角色、優先角色、精簡既有狀態、可用工具和功能開關。這是給模型看的投影，不是整份持久化資料。
5. [callOpenAICompatible](../../scripts/api.js#L1520)送往所選 OpenAI 相容端點，按設定套用 API 格式、超時、預設提示與 JSON 回覆模式。若 JSON 解析失敗，API 層有修正請求／重試路徑。
6. 回覆正規化後，[applyToolCallsResult](../../scripts/tools.js#L7875)按順序執行每個工具；呼叫順序會影響結果。它保存場景摘要、原始結果摘要和每步操作紀錄。
7. 處理完成後記錄對應訊息簽名與快照。若請求期間聊天被編輯或刪除，當次結果可被丟棄，交由下一輪重新對帳。[單樓處理](../../scripts/tracker.js#L1591)。

### 為甚麼有時候沒有追蹤

常見跳過條件包括空聊天、正在跑另一輪、沒有已註冊角色、宿主仍在生成、Agent 還沒提交、訊息尚未穩定、沒有新內容、MVU 額外解析未結束，以及同一聊天簽名上次已失敗。[門控集中在此](../../scripts/tracker.js#L1741)。輪詢還會辨識宿主無聲替換尾樓正文的情形，重新錨定簽名。手動分析可用於上次失敗的訊息。

`lastAttemptedSignature`、`lastProcessedSignature`、`lastFailedChatSignature` 的用途不同：發起過、成功處理過、整段聊天上次失敗。最後一項阻止聊天毫無變化時不停自動重送。[簽名建構](../../scripts/state.js#L1606)、[重試判定](../../scripts/tracker.js#L127)。

## 工具呼叫是狀態邊界

模型只能選擇[公開工具定義](../../scripts/tools.js#L101)中的名稱與參數。分派器再次處理角色名和參數；未知工具或未知角色會回報未套用。[applyToolCall](../../scripts/tools.js#L7794)在前後整理胚胎 ID、羊膜、胎位與供養扣分。多個工具不是交易：前一步已成功套用時，後一步跳過不會自動撤回前一步。工具結果及 `applied` 旗標會進操作紀錄。

主要工具分組：

| 類別 | 工具 |
| --- | --- |
| 時間與身體 | `bsPassedTime`、`bsUpdateCharacterStatus`、`bsExcreteMetabolism`、`bsSetMenstrualPhases`、`bsSetCharacterPresence` |
| 生殖與分娩 | `bsAddSperm`、`bsDrainSperm`、`bsImplantEmbryo`、`bsAbortion`、`bsChildbirth`、`bsAssistFetalPosition`、`bsMaternalFetalInteraction`、`bsWombReturn` |
| 記錄與描述 | `bsWriteDiary`、`bsRecordExperience`、`bsSetDescription`、`bsUpdatePsychology` |
| 技能與衣物 | `bsRegisterSkillDefinition`、`bsTrainSkill`、`bsAddWardrobeItem`、`bsRemoveWardrobeItem`、`bsChangeOutfit` |
| 測試／診斷 | `bsDebugInjectPregnancy`、`bsDebugClearContainers`、`bsDebugSetGestationModifier`、`bsDebugFetalActivity`、`bsDebugSetProdromal`、`bsDebugSetFetalPosition` |

實際支援的名稱以[分派器](../../scripts/tools.js#L7817)為準；可送給追蹤模型的清單還會依設定及角色狀態過濾，見 [getTrackerToolDefinitions](../../scripts/tracker.js#L705)。

這個投影有兩個容易踩到的邊界。世界書排除／白名單處理後，會重新建立只含書名與通過篩選條目的物件；宿主原物件的 `originalData` 可能仍有被排除的完整條目，不能整包傳給模型。[世界書投影](../../scripts/state.js#L1236)。角色狀態則遞迴省略 `null`、空字串、空陣列與空物件，但保留 `outfit.mainItemId=null`，因為它表示「衣著未記錄」。只有妊娠相關階段才傳 `pregnantDescription`。[狀態投影](../../scripts/tracker.js#L1058)、[妊娠欄位條件](../../scripts/tracker.js#L732)。

衣櫃與技能是可關閉的擴充系統，由系統頁的 `着衣系统`、`技能系统` 開關決定（預設開啟）。開啟時即使全員衣著未記錄，衣櫃工具與資料也照送，模型可直接換裝；關閉著衣系統時不送衣櫃工具、衣櫃說明與 wardrobe／outfit，關閉技能系統時不送技能工具、技能圖鑑、技能基準、技能說明與角色／胎兒／孩子的技能天賦。模型即使呼叫已關閉系統的工具也不執行。[開關](../../scripts/state.js#L881)、[工具過濾](../../scripts/tracker.js#L705)、[狀態投影](../../scripts/tracker.js#L1097)。

## 快照與宿主保存

快照與聊天訊息邊界綁定。回頭編輯訊息後，[對帳邏輯](../../scripts/tracker.js#L1427)會尋找仍吻合的最近快照，將狀態還原到該邊界再往前處理；不能假設會從最早一則訊息完整重跑。快照以差量為主，定期或差量過大時改存完整內容，修剪時保留可還原的基底。[快照記錄／還原](../../scripts/state.js#L1978)、[匹配](../../scripts/state.js#L2250)。

SillyTavern 的聊天狀態在擴充設定內；TauriTavern／Luker 使用每聊天的宿主 sidecar。載入前避免把空狀態覆寫尚未水合的資料，保存會合併／延遲，必要時立即 flush。[宿主載入](../../scripts/host.js#L455)、[延遲保存](../../scripts/host.js#L575)、[立即保存](../../scripts/host.js#L595)。

樓層快照不保存 `runtime` 的時間進位等暫態，但會保存孕期的孕前原值（`runtime.originalPregnancyBio`），回溯後分娩才能還原正確的承載耐受、分娩難度與孕速。

聊天狀態帶有存檔結構版本 `schemaVersion`（1.0.5 以前的存檔沒有此欄位，視為 1）。讀取時若版本較舊，會逐版遷移角色資料與每一層樓層快照，完成後寫回。v2（1.0.6）把仍等於舊內置值的承載耐受換成新內置值（自訂過的不動），並為不在產後恢復的角色按新公式重算恢復天數。v3（1.0.7）補上延產次數、延產到期日與子宮乏力級數，舊存檔一律從「沒延產過、沒有乏力」開始。[v2→v3](../../scripts/state_migration.js#L100)。[遷移入口](../../scripts/state.js#L1133)、[v1→v2](../../scripts/state_migration.js#L61)。


v4（v1.1.0）遷移關係名單、舊損失歸入流產、單側心理與子女選定身份，也保留原資料備查。認知、接觸來源、抽樣与來源去重隨角色快照還原；詳見[生殖認知與避孕](reproductive-tracking.md)。
