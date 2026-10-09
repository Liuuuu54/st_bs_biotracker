# 全部工具參考

[返回機制索引](README.md) · [服裝與技能細節](wardrobe-and-skills.md)

本頁按[公開工具定義](../../scripts/tools.js#L104)與[實際分派器](../../scripts/tools.js#L7940)逐項核對。`female` 是已註冊角色名稱，除 `bsRegisterSkillDefinition` 以外的公開工具都要指定它；未知角色會拒絕。`applied=false` 表示該次呼叫未完成其預定變更。多個工具依回覆順序執行，不會整批回滾。[結果紀錄](../../scripts/tools.js#L7998)。

下表的「必填」依模型可見的 schema；實作仍會再次檢查有效值。`bsDebug*` 有分派實作，但不在公開 `TOOL_DEFINITIONS` 中；它們由 UI 診斷功能呼叫。[UI 入口](../../index.js#L5582)。

## 時間與基本狀態

| 工具 | 參數 | 成功效果與拒絕條件 |
| --- | --- | --- |
| [`bsPassedTime`](../../scripts/tools.js#L6609) | `minute`、`hour`、`day`、`week`、`month`、`year`，至少一個正數。 | 單位相加，月=30 日、年=365 日，推進**整個聊天所有角色**，並增加 `minutesPassed`。沒有正時間則拒絕；胎內回歸且承載者仍在的角色凍結。時間零頭和各階段規則見[時間機制](cycles-and-conception.md#時間怎樣推進)。 |
| [`bsUpdateCharacterStatus`](../../scripts/tools.js#L6645) | 必填 `female`、`options`；可傳 `vitality`、`psyStress`、`libido`、`uterinePressure`，以及布林 `orgasm`。 | 四項都是**增減量**，受各自上限限制。`orgasm=true` 表示劇情中高潮：系統把性欲推到上限、走高潮排卵結算，結束後性欲歸零；冷卻中或不排卵的物種也歸零，不會停在上限。活力會連動代謝，性欲連動乳意，達上限時可能高潮排卵（額外排卵傾向的每一顆按當前活力占比排出；每週期黃體期前、黃體期各一次），宮壓可磨損羊膜並更新風險。空 `options` 在實作中仍會回報套用，但沒有數值變化。 |
| [`bsSetCharacterPresence`](../../scripts/tools.js#L6903) | 必填 `female`、明示布林 `isPresent`。 | 寫入 `base.isHere`；離場後追蹤 payload 預設不送完整狀態，部分在場代謝略過。設回在場也會解除 `wombReturnHost` 凍結；省略布林值會拒絕。 |
| [`bsSetMenstrualPhases`](../../scripts/tools.js#L7329) | 必填 `female`、`stage`。 | 只接受卵泡、排卵、黃體、月經、產後恢復、假孕；階段天數歸零並調整排卵冷卻：切到排卵期重新允許高潮排卵，切到黃體期也吃到黃體期那一次刷新。已有胚胎、受精進度、真妊娠、回歸期、產兆或產程時拒絕，不能用它直接設成懷孕。 |

## 精源、受孕與分娩

代孕／注卵（`bsImplantEmbryo`）、延產（`bsExtendPregnancy`）、胎歸（`bsWombReturn`）可在百科「基準」頁個別關閉；關閉時不提供給追蹤模型。

| 工具 | 參數 | 成功效果與拒絕條件 |
| --- | --- | --- |
| [`bsAddSperm`](../../scripts/tools.js) | 必填 `female/male/race/action/amount`；`action=insert/deposit/withdraw`，可傳 bool `hasCondom`；insert 另可傳 `maleBodySize`（精方個體體型）與 bool `femaleAltForm`、`maleAltForm`、`sizeBridge`。 | insert／withdraw 的量為 0；deposit 必須來源相同且已插入，量須正數。insert 預設未戴套，deposit 省略時承接、明示時更新。量超容量必失敗，否則抽可靠度；成功全擋，失敗全進。每次有效 deposit 有來源時間，重試不重抽，不清旧殘留。受精留待時間推進。insert 結算體型契合，只影響敘述（見[物種體型](settings-and-encyclopedia.md#物種體型)）。 |
| [`bsDrainSperm`](../../scripts/tools.js#L7294) | 必填 `female`、正數 `amount`。 | 按各精源目前比例減少殘留；量足夠時全清。清空後下次時間推進便沒有該批精源的受孕機會。零、負數或非有限值拒絕。 |
| [`bsImplantEmbryo`](../../scripts/tools.js#L5448) | 必填 `female`、`provider`；可傳 `fathers`、`count`（1–50）、`race`、`fatherRace`。 | 建立外源、**尚未著床**的胚胎；`provider` 必須異於承載者。`count` 是有效胎兒卡數，不是伴生卵枚數。孕期追加只允許孕早期有已著床胎且異期窗口未關閉；回歸期拒絕。供體歸屬與種族細節見[特殊流程](special-cases.md#外源胚胎植入)。 |
| [`bsAbortion`](../../scripts/tools.js) | 必填 `female`；可傳 `purpose=emergency/termination/miscarriage`（省略為 termination）；非 emergency 可傳 `fetusIndex/force`。 | emergency 只处理服用前、來源與時間已知的著床前接觸，逐次成功率為 `E × max(0, 1−d/T)`，T 沿用角色著床時長（標準人類 6 天）；不能 force、選胎或繞过免疫，保留殘留、不计損失、不保護未來。確定結果分別累計人工終止／自然流產，著床前不计损失；減胎未結束整次妊娠時不计整次損失。 |
| [`bsExtendPregnancy`](../../scripts/tools.js#L4584) | 必填 `female`、`action=extend/induce`、`reason`。 | `extend`：在逾期，或由逾期／延產期進入的產兆前驅延產，第一次延到 52 週、之後每次 28 天，第二次起子宮乏力 +1；已破水、已進產程時拒絕。`induce`：只在延產期，立即進入產兆前驅。 |
| [`bsWombReturn`](../../scripts/tools.js#L909) | 必填 `female`、`returner`；可傳 `returnerRace`、非負 `hours`。 | 清空承載者原有子宮內容、建立回歸胎並按小時過渡；已註冊回歸者凍結。只可在月經階段／無經期使用，不可自我回歸或重複回歸。詳見[胎內回歸](special-cases.md#胎內回歸)。 |
| [`bsChildbirth`](../../scripts/tools.js#L5604) | 必填 `female`；可傳 `mode`（`surgical` 預設、`natural`）。 | 將剩餘已著床胎兒轉為 `children`，結束妊娠並進產後恢復；直接呼叫記為手術產，自然走完產程則記自然產。`mode=natural` 用來同步劇情搶在第二產程前寫出的自然分娩，記為自然產；孕早期、孕中期拒絕自然產。沒有已著床胎兒或未進入妊娠／產兆／產程時拒絕。 |
| [`bsAssistFetalPosition`](../../scripts/tools.js#L5865) | 必填 `female`、`action`；可傳 `fetusIndex`、`targetAngle`、`backSide`、`actor`。 | `rotate` 轉角／胎背或解肩難產，`lift` 托高，`descend` 推低，`rupture` 破膜，`extract` 助產取出先露胎。未指定索引時選領頭胎；索引按可見胎。`actor=fetus` 不耗母體活力，但不可自行 `extract` 或解自己的肩難產；階段、胎位、體力、宮壓不符會拒絕。[胎位與羊膜](pregnancy-and-labor.md#胎位羊膜與宮壓)。 |
| [`bsMaternalFetalInteraction`](../../scripts/tools.js#L6015) | 必填 `female`；可傳 `direction=fetal/maternal/sibling`、`change=slight_increase/significant_increase/slight_decrease/significant_decrease`。 | 預設 `direction=fetal`，須給有效 `change`，按 ±0.5／±1 更新隨機已著床胎親近度；`maternal` 不用 `change`，由情壓決定安撫是否成功並隨機變化。`sibling` 須給有效 `change`，隨機挑一對相鄰且角色已知的胎兒：`slight_decrease` 一胎踢另一胎，對方偏轉 10–20°（已入盆則不動）；`significant_decrease` 推擠，可自由活動時左右換位；兩種 `increase` 為依偎，位置不變；不改親近度。三種方向共用每角色每故事小時一次的限制；無已著床胎、或 `sibling` 找不到相鄰已知的兩胎時拒絕。 |

## 代謝、心理與記錄

| 工具 | 參數 | 成功效果與拒絕條件 |
| --- | --- | --- |
| [`bsExcreteMetabolism`](../../scripts/tools.js#L3629) | 必填 `female`；可在 `options` 傳 `excretion`、`hunger`、`sleep`、`milk`、`odor`、`companionship`、`flux` 的非負減量。 | 普通角色不帶選項時使用預設直接減量；衍生類型不帶選項時預設釋放 `flux`。堵塞降低效果，進食／睡眠／排泄有交叉回升，處理前後需求等級還會影響胎兒供養。代謝免疫會拒絕。[代謝細節](character-systems.md#需求累積與處理)。 |
| [`bsUpdatePsychology`](../../scripts/tools.js) | 必填 `female/options`，數值為變化量；mens 可改 `mastery/desire/autonomy`，preg 可改 `confidence/bonding/stance`。 | 只改当前侧已初始化的值，未知 null 不累加；恢復期、轉側待推演、未啟用或本故事小時已成功更新时拒絕。數值夾在 0–100，無心理 bool。 |
| [`bsWriteDiary`](../../scripts/tools.js#L6564) | 必填 `female`、日期標題 `time`、正文 `content`。 | 追加一則主觀日記並記錄故事日；同角色同故事日（`floor(minutesPassed/1440)`）已有日記時拒絕。`time` 是文字標題，不決定故事日索引；角色離場仍可寫。 |
| [`bsSetDescription`](../../scripts/tools.js#L6869) | 必填 `female`、`options.normalDescription` 或 `pregnantDescription`，值為以欄位名為鍵的物件。 | 只傳有變化或被點名待確認的欄位，未傳的保留。逐欄處理：不存在的欄位名只略過那一欄並回報，其餘照常更新；內容與原文相同算「確認未變」，刷新時間戳；空字串不改。原本空白的描述可首次建立欄位。過渡期仍接受舊的「欄名|內容;;」字串。[合併實作](../../scripts/descriptions.js#L84)。 |
| [`bsRecordExperience`](../../scripts/tools.js) | 必填 `female/action/time`；`cognition` 另需 `method/content`，方法為 `perception/guess/informed/test/prenatal`；四種關係 action 需 `partner`；`child` 需從 0 起的 `childIndex` 及 `name` 或 `selectedFather`。 | action 參數互斥，認知只追加角色主觀紀錄；關係每次改一人且婚姻與交往互不連動。`selectedFather=null` 取消、省略保留，不改實際血緣與後臺經驗次數。 |

## 服裝與技能

| 工具 | 參數 | 成功效果與拒絕條件 |
| --- | --- | --- |
| [`bsAddWardrobeItem`](../../scripts/tools.js#L6700) | 必填 `female`、`item`；衣物須有 `name/note/slot`，可帶 ID、`parts/fitProfile` 或 `category/effects`。 | 更新或新增長期衣櫃；主服與配件資料按各自規則正規化。`id=0` 保留，無效物件拒絕。詳見[衣櫃](wardrobe-and-skills.md#衣櫃與當前穿著是兩份資料)。 |
| [`bsRemoveWardrobeItem`](../../scripts/tools.js#L6754) | 必填 `female`、`itemId`（ID 或名稱）。 | 永久刪除長期衣物，並清掉目前穿著對它的引用；找不到或 `id=0` 時拒絕。 |
| [`bsChangeOutfit`](../../scripts/tools.js#L6791) | 必填 `female`；可傳 `mainItemId`、`main`、`accessories`、`scope`、配件 ID 清單或增減清單、`wearState`。 | 同一次呼叫內換主服與配件，可引用既有或建立新衣。`mainItemId=0` 為全裸，`null` 為未記錄；無效引用拒絕整次提交。細節與數值見[服裝機制](wardrobe-and-skills.md#三個服裝工具)。 |
| [`bsRegisterSkillDefinition`](../../scripts/tools.js#L6927) | 必填非空 `name`、`description`。 | 向本聊天圖鑑註冊技能定義並取得新 ID；同名時重用舊定義，此次 `applied=false`，不會讓角色覺醒。 |
| [`bsTrainSkill`](../../scripts/tools.js#L6942) | 必填 `female`、已登記技能 `skill`（ID／名稱）、整數 `skillExp`（0–1,000,000）、非空 `reason`；可傳 `awaken`。 | 對角色技能加經驗、升級並記歷史；未覺醒時須 `awaken=true`。LLM 不可直接改角色天賦；特定孕期會把部分經驗轉為隨機胎兒的有號天賦經驗。[技能機制](wardrobe-and-skills.md#技能目錄角色技能與天賦)。 |

## UI 診斷工具

以下六個工具由[診斷 UI](../../index.js#L5582)透過 `applyToolCall` 呼叫，沒有列入模型的公開 `TOOL_DEFINITIONS`。它們可直接改寫或清除狀態，與自然故事流程的機率／階段門檻不同。每次 UI 成功操作會記錄快照並保存。

| 工具 | 主要參數 | 效果與限制 |
| --- | --- | --- |
| [`bsDebugInjectPregnancy`](../../scripts/tools.js#L7405) | `female`、`mode`（`normal/surrogacy/womb_return/superfetation/nested`）、`father/race/fetusCount/genders/equivalentDays`，以及模式用的 provider、returner、host 索引與強制同卵／嵌合旗標。 | 直接建立測試胚胎或指定有效孕日；`fetusCount` 夾在 1–9，`equivalentDays` 夾在 0–300。追加異期／巢狀胚胎須在孕早期窗口、有已著床胎；強制嵌合限一般／代孕且至少兩個基礎胚胎。 |
| [`bsDebugClearContainers`](../../scripts/tools.js#L7691) | `female`、`container=sperms/fetuses/children`。 | 清精源、子女紀錄或受孕狀態；清已著床妊娠會轉產後恢復並增加流產經歷，清著床前則只清胚胎。空容器拒絕。 |
| [`bsDebugSetGestationModifier`](../../scripts/tools.js#L7775) | `female`、`clear`，或 `name/multiplier/description`。 | 設定／清除妊娠速度修飾器；倍率夾在 0–30，0 可凍結有效孕日。調試面板用對數刻度拉桿（0.03–30）加「凍結」勾選設定，並即時換算整個孕期長度。非清除操作須有名稱，已有孕胎時重算孕期生理。 |
| [`bsDebugFetalActivity`](../../scripts/tools.js#L7834) | `female`、非空 `activityText`。 | 把最多 500 字的胎動敘述附加到通知；須有胎兒且處於妊娠／產兆／產程。它不直接改胎位。 |
| [`bsDebugSetFetalPosition`](../../scripts/tools.js#L7869) | `female`、**完整胎兒陣列**的 `fetusIndex`；可傳 `tendencyAngle/backSide/descentStage/makePresenting/allowPathologicalState`。 | 直接設定胎位與先露，再經下降位置校正；待著床胎拒絕。`allowPathologicalState` 限真實分娩模式下測試互鎖雙胎，與公開助產工具的可見胎索引不同。 |
| [`bsDebugSetProdromal`](../../scripts/tools.js#L7914) | `female`、`progressPercent`（0–100）。 | 在孕晚期、臨產期、逾期或已有產兆時，直接設前驅進度、剩餘小時及疼痛；其他階段拒絕。 |

## 工具間共用的邊界

人名參數中的完整 `user`、`{user}`、`{{user}}`、`<user>` 別名會解析成宿主使用者名稱，避免同一人在精源、子女和族譜裡變成多個節點。[名稱解析](../../scripts/tools.js#L785)。每次工具前會同步胚胎 ID、羊膜與背向，工具後會同步供養「爆」扣分、巢狀胎釋放、先露參照與下降位置。[統一入口](../../scripts/tools.js#L7917)。若某工具被拒絕，仍須看操作紀錄中的 `applied` 與訊息，不應只根據模型曾呼叫它就認定故事狀態已改變。
