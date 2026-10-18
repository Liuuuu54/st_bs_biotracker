# 追蹤、API 與存檔

[返回機制索引](README.md)

## 角色從哪裡來

角色需先初始化／註冊；沒有已註冊角色時追蹤直接跳過。[runRegistry](../../scripts/registry.js#L2440)讀取指定目標、角色卡、世界書與既有資料，呼叫 API，再由 [applyRegistryResult](../../scripts/registry.js#L1802)寫入角色。目標名稱由呼叫端決定，不能靠模型輸出重新命名。技能初始化、心理推論、衣櫃準備、日記補建是註冊流程中各自的子流程；不是每次追蹤都重新初始化。相關入口見 [registry.js](../../scripts/registry.js#L712)。

每個聊天有獨立的 `chatState`，包含角色字典、累積時間、技能目錄、場景摘要、最後結果與快照。角色的 `profile` 再分成 `base`、`pregnant`、`experience`、`psychology`、`bio`、`metabolism`、`wardrobe` 等區塊；另有 `runtime` 儲存時間零頭與生理原值。[預設結構](../../scripts/state.js#L676)中的角色字典使用無原型物件，避免特殊角色名碰到 JavaScript 內建屬性。

概覽階段進度直接讀取角色生理時鐘，與引擎共用門檻；各階段起算點、分母與單位見[階段進度核對](../v110-ui-stage-progress.md)。

## 一樓訊息的處理路徑

1. [runTracker](../../scripts/tracker.js#L1809)先從宿主載入聊天狀態與最新聊天視圖，並取得已註冊角色。
2. 自動輪詢確認宿主生成完成、Agent 提交完成、AI 訊息已穩定；啟用 MVU 額外分析時還會等其結束。Luker 多智能體安全模式預設要求手動分析。相同對話的失敗自動重試會暫停。
3. 對帳快照後逐樓處理。手動分析使用自己的尾樓重放路徑；自動分析從尚未處理的樓層繼續。[主迴圈](../../scripts/tracker.js#L1846)。
4. [buildTrackerPayload](../../scripts/tracker.js#L1349)組出角色卡、世界書或主流程上下文、近期訊息、已註冊角色、優先角色、精簡既有狀態、可用工具和功能開關。這是給模型看的投影，不是整份持久化資料。近期訊息裡，上一次實際送去分析的樓層以前的訊息會標上 `already_settled`：它們只供理解前情，提示詞要求模型只為新訊息結算時間、技能、衣著等，避免同一件事被算兩次（只記 skip 的使用者訊息不算已分析）。
5. [callOpenAICompatible](../../scripts/api.js#L1565)送往所選 OpenAI 相容端點，按設定套用 API 格式、超時、預設提示與 JSON 回覆模式。若 JSON 解析失敗，API 層有修正請求／重試路徑。
6. 回覆正規化後，[applyToolCallsResult](../../scripts/tools.js#L8303)按順序執行每個工具；呼叫順序會影響結果。它保存場景摘要、原始結果摘要和每步操作紀錄。
7. 處理完成後記錄對應訊息簽名與快照。若請求期間聊天被編輯或刪除，當次結果可被丟棄，交由下一輪重新對帳。[單樓處理](../../scripts/tracker.js#L1597)。

### 為甚麼有時候沒有追蹤

常見跳過條件包括空聊天、正在跑另一輪、沒有已註冊角色、宿主仍在生成、Agent 還沒提交、訊息尚未穩定、沒有新內容、MVU 額外解析未結束，以及同一聊天簽名上次已失敗。[門控集中在此](../../scripts/tracker.js#L1748)。輪詢還會辨識宿主無聲替換尾樓正文的情形，重新錨定簽名。手動分析可用於上次失敗的訊息。

`lastAttemptedSignature`、`lastProcessedSignature`、`lastFailedChatSignature` 的用途不同：發起過、成功處理過、整段聊天上次失敗。最後一項阻止聊天毫無變化時不停自動重送。[簽名建構](../../scripts/state.js#L1861)、[重試判定](../../scripts/tracker.js#L133)。

## 工具呼叫是狀態邊界

模型只能選擇[公開工具定義](../../scripts/tools.js#L106)中的名稱與參數。分派器再次處理角色名和參數；未知工具或未知角色會回報未套用。[applyToolCall](../../scripts/tools.js#L8177)在前後整理胚胎 ID、羊膜、胎位與供養扣分。多個工具不是交易：前一步已成功套用時，後一步跳過不會自動撤回前一步。工具結果及 `applied` 旗標會進操作紀錄。

主要工具分組：

| 類別 | 工具 |
| --- | --- |
| 時間與身體 | `bsPassedTime`、`bsUpdateCharacterStatus`、`bsExcreteMetabolism`、`bsSetMenstrualPhases`、`bsSetCharacterPresence` |
| 生殖與分娩 | `bsAddSperm`、`bsDrainSperm`、`bsImplantEmbryo`、`bsAbortion`、`bsChildbirth`、`bsAssistFetalPosition`、`bsMaternalFetalInteraction`、`bsWombReturn` |
| 記錄與描述 | `bsWriteDiary`、`bsRecordExperience`、`bsSetDescription`、`bsUpdatePsychology` |
| 技能與衣物 | `bsRegisterSkillDefinition`、`bsTrainSkill`、`bsAddWardrobeItem`、`bsRemoveWardrobeItem`、`bsChangeOutfit` |
| 測試／診斷 | `bsDebugInjectPregnancy`、`bsDebugClearContainers`、`bsDebugSetGestationModifier`、`bsDebugFetalActivity`、`bsDebugSetProdromal`、`bsDebugSetFetalPosition` |

實際支援的名稱以[分派器](../../scripts/tools.js#L8167)為準；可送給追蹤模型的清單還會依設定及角色狀態過濾，見 [getTrackerToolDefinitions](../../scripts/tracker.js#L738)。

這個投影有兩個容易踩到的邊界。世界書排除／白名單處理後，會重新建立只含書名與通過篩選條目的物件；宿主原物件的 `originalData` 可能仍有被排除的完整條目，不能整包傳給模型。[世界書投影](../../scripts/state.js#L1490)。角色狀態則遞迴省略 `null`、空字串、空陣列與空物件，但保留 `outfit.mainItemId=null`，因為它表示「衣著未記錄」。只有妊娠相關階段才傳 `pregnantDescription`。[狀態投影](../../scripts/tracker.js#L1082)、[妊娠欄位條件](../../scripts/tracker.js#L733)。

**與變數系統隔離（1.1.7）**：插件注入給主流的 `<bs_biotracker>` 狀態段是一段 JSON，變數系統的模型會把它當成自己的變數。MVU 會另外送一次額外解析：送出前（提示詞就緒或設定就緒時）若正在進行 MVU 額外解析，就把整段拿掉。[隔離](../../index.js#L10024)。小白 X 變數 2.0 由主流模型在回覆裡寫 `<state>`，無法從主流請求拿掉，改由注入裡的說明防範：這段不是 MVU、小白 X 或任何變數系統的變數，不得輸出變數更新。酒館本身的變數只由腳本與巨集寫入，不受影響。送給追蹤模型的近期訊息先去掉 MVU 的 `<UpdateVariable>`，小白 X 的變數模組載入時也去掉 `<state>`（這個標籤太通用，有些卡拿來做狀態欄，所以只在小白 X 載入時處理）。[去掉更新區塊](../../scripts/variable_isolation.js#L32)。

**主流模式的世界書（1.1.6）**：世界書傳輸模式只有主流與參考兩種。參考模式只送手動勾選的條目；主流模式送酒館這一刻觸發的條目，排除名單在這裡生效，舊版的「正常模式」讀設定時就改成主流模式。[模式](../../scripts/state.js#L929)。主流模式追蹤請求的世界書依序取自三處。
- **主流快照**：攔截主流送出前的最終請求，原樣複製；它保留了 EJS、酒館助手／MVU、小白 X 等擴充處理後的樣子，插件不必認識任何一套生態。只收酒館正式生成的那一次請求，兩道條件都要滿足：在酒館生成期間（`GENERATION_STARTED` 開門，背景生成 quiet 與只算 token 的試算不開，生成結束或停止關門），而且請求本身的 `type` 是正式生成（`normal`、`swipe`、`regenerate`、`continue` 等；借酒館發的背景請求是 `quiet`，插件自己直接打 API 的沒有這個欄位）。收下一份就關門。資料庫的劇情推進與紀要召回在主流送出前跑、填表在回覆後跑，MVU 額外解析、總結類插件也各自發請求，這些都不會蓋掉快照（1.1.7）。插件自己發出的請求另外記下選項物件略過，追蹤期間不停止攔截，追蹤還沒跑完就送出下一句也不會漏抓。主流由酒館助手腳本代為生成的卡不經過酒館的生成流程，收不到快照，改走下面的宿主試算。[攔截](../../index.js#L1532)、[開關門](../../scripts/mainflow_capture_gate.js#L9)、[自己的請求](../../scripts/own_requests.js#L12)。快照是「產生這則回覆的那次請求」，有兩個缺口，由宿主試算這一刻的世界書補上：被排除條目的原文從快照刪掉（含 `<% %>` 或巨集的條目渲染後對不上原文，刪不掉，主控台會列出）；回覆裡才觸發、快照裡沒有的關鍵字條目，以純文字附在 `mainflow_new_worldinfo`，常駐條目與含模板語法的條目不補。比對都忽略空白差異，因為宿主合併深度注入時會改縮排與空行。[補快照](../../scripts/tracker.js#L1304)、[補漏](../../scripts/worldinfo_resolve.js#L145)、[刪排除](../../scripts/worldinfo_resolve.js#L165)。
- **宿主試算**：沒有快照時（重新整理或切換聊天後、文字補全），呼叫宿主的 `getWorldInfoPrompt` 試跑：聊天照宿主格式「名字: 內容」、新的在前，觸發完全由宿主依掃描深度、包含組、機率、遞迴與 EJS `@@` 裝飾器判斷，不推進黏著與冷卻。排除名單在宿主載入條目時就從候選拿掉。這條路的條目內容是原文，`<% %>` 不會渲染。[試算](../../scripts/worldinfo_resolve.js#L70)。
- **插件自己比對關鍵字**：只在宿主沒有試算 API 時使用。只掃最近 2 則（條目自訂的掃描深度優先），次要關鍵字照宿主的四種邏輯，支援 `/正則/`；包含組、機率、黏著冷卻與遞迴不模擬。[後備比對](../../scripts/worldbook_match.js#L51)。

衣櫃與技能是可關閉的擴充系統，由系統頁的 `着衣系统`、`技能系统` 開關決定（預設開啟）。開啟時即使全員衣著未記錄，衣櫃工具與資料也照送，模型可直接換裝；關閉著衣系統時不送衣櫃工具、衣櫃說明與 wardrobe／outfit，關閉技能系統時不送技能工具、技能圖鑑、技能基準、技能說明與角色／胎兒／孩子的技能天賦。模型即使呼叫已關閉系統的工具也不執行。[開關](../../scripts/state.js#L907)、[工具過濾](../../scripts/tracker.js#L708)、[狀態投影](../../scripts/tracker.js#L1121)。

## 快照與宿主保存

快照與聊天訊息邊界綁定。回頭編輯訊息後，[對帳邏輯](../../scripts/tracker.js#L1424)會尋找仍吻合的最近快照，將狀態還原到該邊界再往前處理；不能假設會從最早一則訊息完整重跑。快照以差量為主，定期或差量過大時改存完整內容，修剪時保留可還原的基底。[快照記錄／還原](../../scripts/state.js#L2236)、[匹配](../../scripts/state.js#L2508)。

SillyTavern 的聊天狀態在擴充設定內；TauriTavern／Luker 使用每聊天的宿主 sidecar。載入前避免把空狀態覆寫尚未水合的資料，保存會合併／延遲，必要時立即 flush。[宿主載入](../../scripts/host.js#L488)、[延遲保存](../../scripts/host.js#L609)、[立即保存](../../scripts/host.js#L634)。

**存檔時機與多分頁（1.1.5）**：宿主把插件資料整份寫回，舊做法有兩個丟資料的情況，三個宿主都重現過：
- **存完很快就重新整理**：SillyTavern 的設定存檔有約 1 秒延遲，送出前還要先壓縮整份設定；頁面在這之前刷新，資料就沒寫進去。離開確認框跳出時頁面腳本是暫停的，補存也送不出去。現在插件只合併 0.05 秒內的連續存檔，隨即呼叫宿主的立即存檔並依序送出；TauriTavern／Luker 的聊天旁檔案延遲同樣是 0.05 秒。仍有存檔沒寫完時關閉或刷新，會跳確認框，讓正在傳的請求傳完。[設定存檔排程](../../scripts/state.js#L1245)、[離開前防護](../../index.js#L10043)。
- **舊分頁蓋掉新資料**：每個聊天狀態帶存檔版本號 `saveRevision`，最新版本記在同源分頁共享的 `localStorage`；內容真的變了才領新號，載入時的例行存檔不搶號。存檔前，記憶體裡比別的分頁舊、而且自己沒改過的聊天先從宿主讀回，不拿舊副本覆蓋；這個分頁剛有改動的則以它為準。存檔寫完後用 `BroadcastChannel` 通知其他分頁讀回並重繪。只涵蓋同一個瀏覽器的分頁，跨裝置（手機與電腦）不共享 `localStorage`，管不到。[版本號](../../scripts/save_sync.js#L48)、[領號](../../scripts/state.js#L1218)、[讀回](../../scripts/state.js#L1148)。

刪除聊天時，宿主的刪除事件帶著被刪聊天的名稱（SillyTavern 傳檔名字串，其他宿主可能包成物件），插件只清掉那一個聊天的狀態；認不出是哪個聊天就什麼都不清，不會牽連目前開著的聊天。[刪除事件解析](../../scripts/host.js#L178)。

樓層快照不保存 `runtime` 的時間進位等暫態，但會保存孕期的孕前原值（`runtime.originalPregnancyBio`），回溯後分娩才能還原正確的承載耐受、分娩難度與孕速。

聊天狀態帶有存檔結構版本 `schemaVersion`（1.0.5 以前的存檔沒有此欄位，視為 1）。讀取時若版本較舊，會逐版遷移角色資料與每一層樓層快照，完成後寫回。v2（1.0.6）把仍等於舊內置值的承載耐受換成新內置值（自訂過的不動），並為不在產後恢復的角色按新公式重算恢復天數。v3（1.0.7）補上延產次數、延產到期日與子宮乏力級數，舊存檔一律從「沒延產過、沒有乏力」開始。v8（1.1.5）把角色描述從「欄名|內容;;」字串改成帶時間戳的陣列，見[角色系統](character-systems.md#衣櫃服裝和描述)。[v2→v3](../../scripts/state_migration.js#L106)。[遷移入口](../../scripts/state.js#L1387)、[v1→v2](../../scripts/state_migration.js#L67)。


v4（v1.1.0）遷移關係名單、舊損失歸入流產、單側心理與子女選定身份，也保留原資料備查。認知、接觸來源、抽樣与來源去重隨角色快照還原；詳見[生殖認知與避孕](reproductive-tracking.md)。

v5（v1.1.2）依種族補上血統比例。[v4→v5](../../scripts/state_migration.js#L148)。v6（v1.1.3）把既有聊天與樓層快照標記為已處理卡片技能種子，升級後不會突然新增技能。v7（v1.1.4）把存下的種族字串與血統比例的鍵改寫成新名稱（百足姬→百足氏、獸人→歐克等），繁體或混寫的內建名稱一併收斂成規範字形；只認種族欄位，人名不動，查不到的自訂種族原樣保留。[v6→v7](../../scripts/state_migration.js#L205)。
