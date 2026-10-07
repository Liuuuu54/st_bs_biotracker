# 代謝與角色附屬系統

[返回機制索引](README.md)

服裝四維數值、孕期合身、技能升級與胎兒天賦轉移另見[服裝與技能機制](wardrobe-and-skills.md)；所有工具的參數與拒絕條件見[全部工具參考](tool-reference.md)。

## 需求累積與處理

`metabolism` 包含排泄、飢餓、睡眠、泌乳、氣味、陪伴與衍生類型的 `flux`。需求的上限可受妊娠症狀的容量擴張影響；種族衍生類型還可能免除個別需求。`immune.metabolism` 會阻止孕期需求累積和 `bsExcreteMetabolism` 的處理。[需求容量與免除](../../scripts/tools.js#L2676)。

在場角色可產生被動需求；整日自然恢復會減少排泄、飢餓、睡眠等數值，每週例行又處理氣味與陪伴。孕期每整小時增加額外負擔，細節見[妊娠機制](pregnancy-and-labor.md#供養力與胎重)。角色不在場會跳過部分被動增長，並非停止所有需求更新。[被動累積](../../scripts/tools.js#L2981)、[自然恢復](../../scripts/tools.js#L3256)、[每週例行](../../scripts/tools.js#L3299)。

需求偏高時，系統提醒（`notify.thirdly`）在追蹤模型那邊寫成工具建議，例如「應優先使用 `bsExcreteMetabolism`」。送給寫劇情的主模型時改寫成中性的身體狀態，例如「泄意爆：可自然體現身體狀態，不要求本輪處理」，並刪掉供養力的獎懲與照料建議；破水禁令等限制照常保留。三欄通知裡指示呼叫工具的句子或分句（例如破水的「必须先调用 bsAssistFetalPosition」、難產警示的「或使用 bsChildbirth」）也一併拿掉，只留狀態與禁令。何時處理需求由劇情決定。

`bsExcreteMetabolism` 有兩種用法：不帶 `options` 時，普通角色預設減少排泄 30、飢餓 40、睡眠 40、泌乳 30；指定 `options` 時只對指定項目給直接減量。衍生類型未帶選項時預設釋放 `flux`。堵塞可使一次處理只生效一部分；處理飢餓會回加部分排泄和睡眠，處理睡眠會回加部分飢餓，排泄／泌乳會增加氣味，加速症狀則可能反彈。[工具實作](../../scripts/tools.js#L3587)。

孕期症狀分堵塞、加速、擴張。堵塞影響處理效率，加速影響累積或反彈，擴張影響容量；選取有階段機率及可用項目限制，同輪避免撞到同一需求鍵。[症狀抽取](../../scripts/tools.js#L2897)、[刷新](../../scripts/tools.js#L2917)。

## 心理、互動和經歷

心理只在使用者啟用推演後存在。月經側為掌控／欲望／自主，妊娠側為母職信心／接納與聯結／社會展現；四個旧旗標及认知數值軸已撤除。只初始化当前侧三軸与六階段角色解释，转侧重新推演，產後恢復暫停；未知值為 null，不補成 0 或接受 delta。`bsUpdatePsychology` 仍受每故事小時一次的冷卻。[欄位定義](../../scripts/registry_psy_config.js)、[生命週期与紀錄](reproductive-tracking.md)。

`bsMaternalFetalInteraction` 處理母胎互動與多胎之間的互踢、推擠、依偎（`direction=sibling`，只改角度或左右位置），三者共用每故事小時一次的限制；胎兒的親近度限制在 -50 至 50，母方結果受情壓影響。[互動實作](../../scripts/tools.js#L5909)。畫面上的親近詞是這個數值的呈現映射。[呈現函式](../../scripts/uterus_render.js#L505)。

`experience` 保存初次／近期性伴、獨立的交往与婚姻名單及後臺懷孕／生產／損失次數。`bsRecordExperience` 以必填 `female/action/time` 定位角色与分支；認知追加至 `profile.cognitionRecords`，關係與子女更新长期資料。子女 `selectedFather` 是角色選定身份，`fathers` 仍是實際遺傳来源。[工具參考](tool-reference.md)、[詳細機制](reproductive-tracking.md)。

`bsWriteDiary` 追加角色主觀日記；工具定義要求同一角色每故事日最多一篇，日期標題需是故事日期而非時刻。日記是模型產生的敘述記錄，不參與時間或生理公式。[定義](../../scripts/tools.js#L120)、[實作](../../scripts/tools.js#L6438)。

## 技能與天賦

技能目錄是聊天共用的定義，角色各自保存技能、天賦與歷史。技能最高 10 級、天賦最高 5 級，歷史最多保留 100 筆；技能經驗門檻及升級由 [skill_config.js](../../scripts/skill_config.js#L1)計算。`bsRegisterSkillDefinition` 建立／重用定義；`bsTrainSkill` 須有原因和整數技能經驗，尚未覺醒的技能還須 `awaken=true`。LLM 工具不能直接修改角色天賦。孕中期至部分產程階段，訓練可依隨機選中的已著床胎兒親近度，將正或負的經驗傳至其天賦。[定義工具](../../scripts/tools.js#L6896)、[訓練工具](../../scripts/tools.js#L6911)。初始化時也可由角色卡推論初始技能與天賦，[註冊子流程](../../scripts/registry.js#L1951)。

## 衣櫃、服裝和描述

衣櫃保存長期物件；`outfit` 保存目前主服、配件、臨時衣物及穿著狀態。衣物有遮蔽、支撐、容納、方便四維度，主服與配件另有各自的欄位規則。[欄位及正規化](../../scripts/wardrobe_config.js#L1)。`bsAddWardrobeItem`、`bsRemoveWardrobeItem`、`bsChangeOutfit` 改變資料；懷孕和產後穿著壓力依身體狀態與衣物尺寸計算，供 PDA 顯示。[衣物工具](../../scripts/tools.js#L6619)、[穿著壓力](../../scripts/tools.js#L737)。

`descriptions.normalDescription` 與 `pregnantDescription` 是角色狀態文字，`bsSetDescription` 可合併／替換。這些文字隨提示投影送給模型；它們本身不是生理數值的計算來源。[描述工具](../../scripts/tools.js#L6558)、[追蹤狀態投影](../../scripts/tracker.js#L1303)。

認知時間軸每筆標題預設折疊，點擊展開內容；刷新與切頁保留手動開合狀態，新追加紀錄預設折疊。
