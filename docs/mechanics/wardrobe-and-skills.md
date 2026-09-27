# 服裝與技能機制

[返回機制索引](README.md) · [逐項工具參考](tool-reference.md)

## 衣櫃與當前穿著是兩份資料

`profile.wardrobe.items` 存長期擁有的衣物；`profile.outfit` 存此刻主服、配件 ID、暫時衣物、穿著狀態與孕期合身評估。衣櫃預設有不可刪的 `id=0`「全裸」，但當前主服 `mainItemId=null` 表示**衣著未記錄**，`mainItemId=0` 才是**明確全裸**。暫時衣物只存在於目前穿著，脫掉後會從 `transientItems` 移除。[預設值](../../scripts/state.js#L754)、[換裝實作](../../scripts/tools.js#L6257)。

### 衣物數值

主服用 `fitProfile` 的四個離散檔位轉為數值；配件最多兩項不同維度的效果，每項對相應維度加／減 2。穿著時主服與配件相加，四個總值各限制在 0–10。[衣物設定](../../scripts/wardrobe_config.js#L1)、[穿著總值](../../scripts/tools.js#L668)。

| 維度 | 主服檔位與數值 | 解讀 |
| --- | --- | --- |
| `masking` | `very_low=2`、`low=4`、`medium=6`、`high=8` | 遮蔽／隱藏。 |
| `support` | `none=0`、`normal=4`、`strong=8` | 支撐。 |
| `capacity` | `tight=1`、`fitted=3`、`stretch=7`、`loose=9` | 容身空間。 |
| `convenience` | `inconvenient=2`、`normal=5`、`convenient=8` | 行動或處理身體需求的方便程度。 |

配件 `category` 可是 `underwear`、`outerwear`、`footwear`、`headwear`、`ornament`、`support`、`other`；`effects` 使用如 `capacity_up`、`support_down` 的八種上下效果。同一維度重複效果只保留一項，最多兩個效果。主服 `parts` 最多保留六個非空部件。[正規化](../../scripts/wardrobe_config.js#L65)。這些維度目前主要用於**穿著壓力評估**，不能把 `support=8` 解讀成會直接降低宮壓或改變受孕率。

### 孕期合身

孕期穿著壓力由有效孕日進度與胎兒能量負擔計算：`clamp(0.5 + (min(1.25, 有效孕日/280)^1.35 × 6) + max(0, fetalEnergyDrain−0.1) × 1.5, 0, 10)`。產後恢復從 4 線性降至 0；胎內回歸從 10 隨剩餘時間線性降至 0。四個 `gap` 分別是該維度穿著總值減壓力；主服未記錄時 `pregFit=null`。[孕期壓力](../../scripts/tools.js#L677)、[產後／回歸壓力](../../scripts/tools.js#L1006)、[重新計算](../../scripts/tools.js#L1027)。

增刪衣物、換裝、時間推進或孕期狀態變化都可能重新計算 `pregFit`。它是服裝適應度提示，不會回寫胎重、宮壓等生理值。[相關工具](../../scripts/tools.js#L6186)。

### 三個服裝工具

| 工具 | 操作與限制 |
| --- | --- |
| [`bsAddWardrobeItem`](../../scripts/tools.js#L6186) | `female`、`item` 必填；`item` 要有 `name`、`note`、`slot`。指定正整數 `id` 更新該 ID；省略 ID 時按名稱更新，找不到才新增。`id=0` 保留。更新會替換整筆正規化衣物。 |
| [`bsRemoveWardrobeItem`](../../scripts/tools.js#L6220) | `female`、`itemId` 必填；ID 或準確名稱皆可。刪除正在穿的主服會使主服變成未記錄，刪配件則自當前配件清單移除。`id=0` 不可刪。 |
| [`bsChangeOutfit`](../../scripts/tools.js#L6257) | `female` 必填。可用既有 ID／名稱，也可在 `main`、`accessories` 直接建立並穿上；`scope=owned` 存衣櫃，`temporary` 僅暫存。`accessoryItemIds` 覆蓋整表；`addAccessoryItemIds`／`removeAccessoryItemIds` 在現有清單增減。主服變更時若未指定 `wearState`，預設回「整齊」。無效引用會拒絕整次換裝。 |

`wearState` 是動態文字標籤，移除 `|`、`;` 與換行並截至 12 個字元；它不改衣物的長期 `note` 或四維數值。[sanitizeWearState](../../scripts/wardrobe_config.js#L113)。

## 技能目錄、角色技能與天賦

`chatState.skillCatalog` 是**本聊天共用**的技能定義（ID、名稱、描述）；`profile.skills` 是角色已覺醒技能的等級／經驗；`profile.talents` 是角色資質；`profile.skillHistory` 記錄升級事件。技能 ID 隨 `nextSkillId` 遞增，同名定義會重用。註冊角色時也可推論初始技能和天賦。[狀態](../../scripts/state.js#L648)、[定義規則](../../scripts/skill_config.js#L57)、[初始化](../../scripts/registry.js#L1689)。

### 技能升級

角色技能從 Lv1 開始，下一級需求是 `100 × 目前等級²` 經驗；一次可跨多級，最高 Lv10，滿級的經驗歸零。`bsTrainSkill` 只接受已登記的技能 ID／名稱、非負整數 `skillExp` 和非空 `reason`。角色沒有該技能時，須明確傳 `awaken=true`；覺醒後從 Lv1 起算。升級會寫入最多保留 100 筆的歷史並產生通知。[requiredExp](../../scripts/skill_config.js#L52)、[加經驗](../../scripts/skill_config.js#L207)、[訓練](../../scripts/tools.js#L6458)。

### 天賦與胎兒承接

角色自己的天賦對 LLM 工具**唯讀**，不能藉 `bsTrainSkill` 的 `talentExp` 修改；使用者可在外部介面編輯。天賦是一條可跨零的有號進度軸：正側表示擅長，負側表示苦手；從 Lv0 到正／負 Lv1 各需 100 點，之後沿用技能等級需求，界限為 ±Lv5。[天賦算法](../../scripts/skill_config.js#L228)、[訓練拒絕](../../scripts/tools.js#L6470)。

孕中期、孕晚期、臨產期、逾期、產兆前驅或第一產程的訓練，會隨機選一名已著床胎兒。轉移量為 `round(skillExp × |affinity| / 50) × sign(affinity)`，加到該胎兒對應技能的天賦；親近度零則不轉移。第二、第三產程不傳。這是胎兒天賦更新，不會扣掉母體獲得的技能經驗。[胎兒承接](../../scripts/tools.js#L6458)。
