# 代謝與角色附屬系統

[返回機制索引](README.md)

服裝四維數值、孕期合身、技能升級與胎兒天賦轉移另見[服裝與技能機制](wardrobe-and-skills.md)；所有工具的參數與拒絕條件見[全部工具參考](tool-reference.md)。

## 需求累積與處理

`metabolism` 包含排泄、飢餓、睡眠、泌乳、氣味、陪伴與衍生類型的 `flux`。需求的上限可受妊娠症狀的容量擴張影響；種族衍生類型還可能免除個別需求。`immune.metabolism` 會阻止孕期需求累積和 `bsExcreteMetabolism` 的處理。[需求容量與免除](../../scripts/tools.js#L2559)。

在場角色可產生被動需求；整日自然恢復會減少排泄、飢餓、睡眠等數值，每週例行又處理氣味與陪伴。孕期每整小時增加額外負擔，細節見[妊娠機制](pregnancy-and-labor.md#供養力與胎重)。角色不在場會跳過部分被動增長，並非停止所有需求更新。[被動累積](../../scripts/tools.js#L2861)、[自然恢復](../../scripts/tools.js#L3061)、[每週例行](../../scripts/tools.js#L3104)。

`bsExcreteMetabolism` 有兩種用法：不帶 `options` 時，普通角色預設減少排泄 30、飢餓 40、睡眠 40、泌乳 30；指定 `options` 時只對指定項目給直接減量。衍生類型未帶選項時預設釋放 `flux`。堵塞可使一次處理只生效一部分；處理飢餓會回加部分排泄和睡眠，處理睡眠會回加部分飢餓，排泄／泌乳會增加氣味，加速症狀則可能反彈。[工具實作](../../scripts/tools.js#L3388)。

孕期症狀分堵塞、加速、擴張。堵塞影響處理效率，加速影響累積或反彈，擴張影響容量；選取有階段機率及可用項目限制，同輪避免撞到同一需求鍵。[症狀抽取](../../scripts/tools.js#L2650)、[刷新](../../scripts/tools.js#L2797)。

## 心理、互動和經歷

心理資料分月經側 `mens` 與妊娠側 `preg`，另有各階段偏好。初始化可透過獨立的繁殖心理推論取得；欄位定義、布林欄位、階段解釋集中在 [registry_psy_config.js](../../scripts/registry_psy_config.js#L7)。`bsUpdatePsychology` 更新目前適用側的值，並受每故事小時一次的冷卻限制。[工具實作](../../scripts/tools.js#L6553)。沒有心理推論資料時，追蹤器不會無條件開放心理更新工具。[工具過濾](../../scripts/tracker.js#L706)。

`bsMaternalFetalInteraction` 處理母胎互動，亦受每故事小時一次限制；胎兒的親近度限制在 -50 至 50，母方結果受情壓影響。[互動實作](../../scripts/tools.js#L5533)。畫面上的親近詞是這個數值的呈現映射。[呈現函式](../../scripts/uterus_render.js#L503)。

經歷資料包含貞操、近期性伴、情感／婚姻伴侶、懷孕、自然產、手術產與流產次數。部分由生理流程自動更新，`bsUpdateExperience` 可記錄故事中辨識到的事件；子女會隨分娩建立，再由 `bsNameChild` 補名。[預設資料](../../scripts/state.js#L714)、[經歷工具](../../scripts/tools.js#L6387)、[子女工具](../../scripts/tools.js#L6420)。

`bsWriteDiary` 追加角色主觀日記；工具定義要求同一角色每故事日最多一篇，日期標題需是故事日期而非時刻。日記是模型產生的敘述記錄，不參與時間或生理公式。[定義](../../scripts/tools.js#L110)、[實作](../../scripts/tools.js#L6022)。

## 技能與天賦

技能目錄是聊天共用的定義，角色各自保存技能、天賦與歷史。技能最高 10 級、天賦最高 5 級，歷史最多保留 100 筆；技能經驗門檻及升級由 [skill_config.js](../../scripts/skill_config.js#L1)計算。`bsRegisterSkillDefinition` 建立／重用定義；`bsTrainSkill` 須有原因和整數技能經驗，尚未覺醒的技能還須 `awaken=true`。LLM 工具不能直接修改角色天賦。孕中期至部分產程階段，訓練可依隨機選中的已著床胎兒親近度，將正或負的經驗傳至其天賦。[定義工具](../../scripts/tools.js#L6443)、[訓練工具](../../scripts/tools.js#L6458)。初始化時也可由角色卡推論初始技能與天賦，[註冊子流程](../../scripts/registry.js#L1689)。

## 衣櫃、服裝和描述

衣櫃保存長期物件；`outfit` 保存目前主服、配件、臨時衣物及穿著狀態。衣物有遮蔽、支撐、容納、方便四維度，主服與配件另有各自的欄位規則。[欄位及正規化](../../scripts/wardrobe_config.js#L1)。`bsAddWardrobeItem`、`bsRemoveWardrobeItem`、`bsChangeOutfit` 改變資料；懷孕和產後穿著壓力依身體狀態與衣物尺寸計算，供 PDA 顯示。[衣物工具](../../scripts/tools.js#L6186)、[穿著壓力](../../scripts/tools.js#L677)。

`descriptions.normalDescription` 與 `pregnantDescription` 是角色狀態文字，`bsSetDescription` 可合併／替換。這些文字隨提示投影送給模型；它們本身不是生理數值的計算來源。[描述工具](../../scripts/tools.js#L6125)、[追蹤狀態投影](../../scripts/tracker.js#L1276)。
