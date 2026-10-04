# 機制說明（v1.1.0）

這份文件依目前程式碼整理，給想理解規則、排查狀態或修改機制的人閱讀。畫面文字可能簡化了運算；遇到差異時，以各節連結的程式碼為準。入門操作請看[使用說明](../guide.md)。

## 閱讀順序

1. [角色註冊與初始值](registration.md)：活力／情壓七級、起始狀態、開局妊娠和再次註冊。
2. [追蹤、API 與存檔](tracking-and-state.md)：一則訊息怎樣變成工具呼叫，以及怎樣避免重複處理。
3. [時間、週期與受孕](cycles-and-conception.md)：時間單位、排卵、精源、受精、著床、種族繼承。
4. [妊娠、供養與分娩](pregnancy-and-labor.md)：孕程、胎位、羊膜、宮壓、產程和出生。
5. [代謝與角色附屬系統](character-systems.md)：需求、心理、技能、衣櫃、日記和經歷。
6. [服裝與技能機制](wardrobe-and-skills.md)：衣物數值、孕期合身、換裝及技能／天賦計算。
7. [全部工具參考](tool-reference.md)：23 個公開工具和 6 個 UI 診斷工具逐項說明。
8. [特殊流程與資料不變條件](special-cases.md)：九種胚胎 tag 的生成、胚胎移植、胎內回歸、隱藏胎與直接流產。
9. [呈現與程式地圖](presentation-and-source-map.md)：PDA、子宮畫板、主流程提示，以及模組索引。
10. [系統設定、百科與計算器](settings-and-encyclopedia.md)：連接與追蹤設定、功能開關、參數覆寫、世界基準、提示詞名錄與計算器。

11. [生殖認知與避孕](reproductive-tracking.md)：統一紀錄工具、單側心理、逐次避孕、自然線索與迁移。

## 核心資料流

```mermaid
flowchart LR
    A[角色卡、世界書、近期訊息] --> B[追蹤 payload]
    C[本聊天角色狀態] --> B
    B --> D[OpenAI 相容 API]
    D --> E[解析 tool_calls]
    E --> F[依序執行工具]
    F --> G[角色狀態與聊天時間]
    G --> H[快照及宿主存檔]
    G --> I[PDA、子宮畫板、主流程提示]
```

追蹤模型負責判斷故事發生了甚麼；[工具分派器](../../scripts/tools.js#L7806)才負責真正修改狀態。`bsPassedTime` 是大量生理規則的入口：它一次推進本聊天的全部已註冊角色。模型回傳的 `scene_summary`、最後原始結果及工具操作紀錄分別存入聊天狀態，方便 UI 顯示和排錯。見 [applyToolCallsResult](../../scripts/tools.js#L7864)。

## 幾個容易混淆的量

| 欄位 | 含義 |
| --- | --- |
| `base.days` | 目前生理階段已走過的天數。 |
| `pregnant.pregnantDays` | 實際孕日；每次按故事經過的天數增加。 |
| `pregnant.effectivePregnantDays` | 有效孕日；依妊娠速度增加，用來判定孕期階段。 |
| `pregnant.laborHours` / `effectiveLaborHours` | 實際產程時間與經宮壓等因素換算後的有效進度。 |
| `chatState.minutesPassed` | 這個聊天經 `bsPassedTime` 累積的故事分鐘數。 |
| `runtime.*CarryMinutes` | 每角色的時、日、週零頭；避免多次短時間推進漏掉整點。 |
| `profile.notify` | 最新一次運算產生的三層提示，會隨後續操作更新。 |

資料結構見 [state.js](../../scripts/state.js#L662)，時間運算見 [tools.js](../../scripts/tools.js#L6032)。

## 說明邊界

機率抽樣、模型輸出、世界書內容和手動工具都會改變實際結果。本文列出程式中的條件與公式；同一段對話不保證每次抽到相同結果。`bsDebug*` 工具可直接建立或改寫狀態，故不適合用來推論自然流程的機率。
