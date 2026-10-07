# 服裝與技能機制

[返回機制索引](README.md) · [逐項工具參考](tool-reference.md)

## 衣櫃與當前穿著是兩份資料

`profile.wardrobe.items` 存長期擁有的衣物；`profile.outfit` 存此刻主服、配件 ID、暫時衣物、穿著狀態與孕期合身評估。衣櫃預設有不可刪的 `id=0`「全裸」，但當前主服 `mainItemId=null` 表示**衣著未記錄**，`mainItemId=0` 才是**明確全裸**。暫時衣物只存在於目前穿著，脫掉後會從 `transientItems` 移除；要留下就用 `bsAddWardrobeItem` 引用它（或在衣櫃頁按「收進衣櫃」），會轉成長期衣物，id 與穿著不變。[預設值](../../scripts/state.js#L792)、[換裝實作](../../scripts/tools.js#L6710)。

### 衣物數值

主服用 `fitProfile` 的四個離散檔位轉為數值；配件最多兩項不同維度的效果，每項對相應維度加／減 2。穿著時主服與配件相加，四個總值各限制在 0–10。[衣物設定](../../scripts/wardrobe_config.js#L1)、[穿著總值](../../scripts/tools.js#L704)。

| 維度 | 主服檔位與數值 | 解讀 |
| --- | --- | --- |
| `masking` | `very_low=2`、`low=4`、`medium=6`、`high=8` | 遮蔽／隱藏。 |
| `support` | `none=0`、`normal=4`、`strong=8` | 支撐。 |
| `capacity` | `tight=1`、`fitted=3`、`stretch=7`、`loose=9` | 容身空間。 |
| `convenience` | `inconvenient=2`、`normal=5`、`convenient=8` | 行動或處理身體需求的方便程度。 |

配件 `category` 可是 `underwear`、`outerwear`、`footwear`、`headwear`、`ornament`、`support`、`other`；`effects` 使用如 `capacity_up`、`support_down` 的八種上下效果。同一維度重複效果只保留一項，最多兩個效果。主服 `parts` 最多保留六個非空部件。[正規化](../../scripts/wardrobe_config.js#L65)。這些維度目前主要用於**穿著壓力評估**，不能把 `support=8` 解讀成會直接降低宮壓或改變受孕率。

### 孕期合身

孕期穿著壓力由有效孕日進度與肚子實際裝的量計算：`clamp(0.5 + (min(1.25, 有效孕日/280)^1.35 × 5) + 胎量 × 1.5, 0, 10)`，其中胎量＝每胎「自身孕齡/280 ×（胎重 + 伴生卵數 × 0.15）」加總。胎量與 `fetalEnergyDrain` 同源但**不除以承載耐受**：耐受影響的是扛不扛得住（代謝、流產、恢復），衣服合不合身只看肚子多大，所以同樣的胎在任何母體種族上壓力相同。校準錨點為足月單胎 7、雙胎 8.5、三胎才碰到上限 10；兩胎各 1.3 到 42 週約 9.9，一胎帶九顆伴生卵約在 44 週頂滿。[胎量](../../scripts/tools.js#L724)。產後恢復從 4 線性降至 0；胎內回歸從 10 隨剩餘時間線性降至 0。四個 `gap` 分別是該維度穿著總值減壓力；主服未記錄時 `pregFit=null`。[孕期壓力](../../scripts/tools.js#L737)、[產後／回歸壓力](../../scripts/tools.js#L1071)、[重新計算](../../scripts/tools.js#L1066)。

增刪衣物、換裝、時間推進或孕期狀態變化都可能重新計算 `pregFit`。它是服裝適應度提示，不會回寫胎重、宮壓等生理值。[相關工具](../../scripts/tools.js#L6619)。

### 三個服裝工具

| 工具 | 操作與限制 |
| --- | --- |
| [`bsAddWardrobeItem`](../../scripts/tools.js#L6687) | `female`、`item` 必填；`item` 要有 `name`、`note`、`slot`。指定正整數 `id` 更新該 ID；省略 ID 時按名稱更新，找不到才新增。衣櫃裡沒有、但 ID 或名稱對上正在穿的暫時衣物時，改為把它收進衣櫃（槽位以正在穿的為準）。`id=0` 保留。更新會替換整筆正規化衣物。 |
| [`bsRemoveWardrobeItem`](../../scripts/tools.js#L6741) | `female`、`itemId` 必填；ID 或準確名稱皆可。刪除正在穿的主服會使主服變成未記錄，刪配件則自當前配件清單移除。`id=0` 不可刪。 |
| [`bsChangeOutfit`](../../scripts/tools.js#L6778) | `female` 必填。可用既有 ID／名稱，也可在 `main`、`accessories` 直接建立並穿上；`scope=owned` 存衣櫃，`temporary` 僅暫存。`accessoryItemIds` 覆蓋整表；`addAccessoryItemIds`／`removeAccessoryItemIds` 在現有清單增減。主服變更時若未指定 `wearState`，預設回「整齊」。無效引用會拒絕整次換裝。 |

衣櫃頁的「備裝」讓模型代入角色整理衣櫃，結果是 `{items, remove}`：`items` 逐件以 `bsAddWardrobeItem` 寫入，`remove` 是要丟的既有衣物 id 與理由。套用時先丟後加，正在穿的、`id=0` 與找不到的丟棄項會跳過並回報，任一新增失敗整份不寫。[備裝套用](../../scripts/registry.js#L568)。

`wearState` 是動態文字標籤，移除 `|`、`;` 與換行並截至 12 個字元；它不改衣物的長期 `note` 或四維數值。[sanitizeWearState](../../scripts/wardrobe_config.js#L113)。

## 技能目錄、角色技能與天賦

`chatState.skillCatalog` 是**本聊天共用**的技能定義（ID、名稱、描述）；`profile.skills` 是角色已覺醒技能的等級／經驗；`profile.talents` 是角色資質；`profile.skillHistory` 記錄升級事件。技能 ID 隨 `nextSkillId` 遞增，同名定義會重用。註冊角色時也可推論初始技能和天賦。[狀態](../../scripts/state.js#L664)、[定義規則](../../scripts/skill_config.js#L57)、[初始化](../../scripts/registry.js#L1951)。

技能頁的「技能基準」按聊天保存，送入初始技能推演與追蹤，約束要建立、成長哪些方向的技能；它不刪除已有的技能，留空即不限制。「可選預設技能」把一組預設技能（部位開發、行為與傾向）按聊天匯入圖鑑，兩組可各自匯入，重複匯入會自動去重；這個聊天還沒有技能基準時，匯入會一併把基準設成「只追蹤調教類技能」。每個技能的描述會隨圖鑑送進追蹤，作為技能成立與成長的判斷標準。[預設技能](../../scripts/skill_config.js#L144)。

### 角色卡技能種子

v1.1.3 起，技能頁可把目前圖鑑與基準「存到角色卡」，或「從角色卡帶入」。卡片只保存名稱、描述和基準，不保存聊天技能 ID、角色等級、經驗與天賦。

新聊天的圖鑑與基準都空時會自動帶入一次，技能按聊天的 ID 分配器編號。已有圖鑑或基準時不自動合併，清空後也不再自動帶；手動帶入沿用同名定義，保留已有基準。清除卡片種子不刪聊天資料。技能總開關關閉時不帶入，卡片資料保留；舊聊天與舊快照在遷移時標為已處理，避免升級後突然出現新技能。

### 技能升級

角色技能從 Lv1 開始，下一級需求是 `100 × 目前等級²` 經驗；一次可跨多級，最高 Lv10，滿級的經驗歸零。`bsTrainSkill` 只接受已登記的技能 ID／名稱、非負整數 `skillExp` 和非空 `reason`。角色沒有該技能時，須明確傳 `awaken=true`；覺醒後從 Lv1 起算。升級會寫入最多保留 100 筆的歷史並產生通知。[requiredExp](../../scripts/skill_config.js#L52)、[加經驗](../../scripts/skill_config.js#L221)、[訓練](../../scripts/tools.js#L6911)。

### 天賦與胎兒承接

角色自己的天賦對 LLM 工具**唯讀**，不能藉 `bsTrainSkill` 的 `talentExp` 修改；使用者可在外部介面編輯。天賦是一條可跨零的有號進度軸：正側表示擅長，負側表示苦手；從 Lv0 到正／負 Lv1 各需 100 點，之後沿用技能等級需求，界限為 ±Lv5。[天賦算法](../../scripts/skill_config.js#L242)、[訓練拒絕](../../scripts/tools.js#L6923)。

孕中期、孕晚期、臨產期、逾期、產兆前驅或第一產程的訓練，會隨機選一名已著床胎兒。轉移量為 `round(skillExp × |affinity| / 50) × sign(affinity)`，加到該胎兒對應技能的天賦；親近度零則不轉移。第二、第三產程不傳。這是胎兒天賦更新，不會扣掉母體獲得的技能經驗。[胎兒承接](../../scripts/tools.js#L6911)。
