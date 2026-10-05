# 呈現與程式地圖

[返回機制索引](README.md)

## 畫面讀到甚麼

PDA 從聊天狀態讀資料；部分欄位會經過解釋、裁切或視覺化。追蹤器另產生 `existing_state` 的精簡投影給非同步模型，[buildTrackerPayload](../../scripts/tracker.js#L1301)；主流程提示使用[buildMainFlowStatePrompt](../../scripts/tracker_prompt_context.js#L435)將狀態轉成給聊天模型看的文字。兩者並非完整存檔，也不保證顯示每個內部欄位。種族與胚胎的背景提示分別由 [race_prompt_context.js](../../scripts/race_prompt_context.js#L539)及 [embryo_prompt_context.js](../../scripts/embryo_prompt_context.js#L80)組成。

像素子宮畫板先由 [computeUterusLayout](../../scripts/uterus_layout.js#L140)根據已知且可顯示的胎兒、胎位、宮壓等計算位置；同屏最多繪製五胎。接著 [fetus_sprite.js](../../scripts/fetus_sprite.js#L308)產生胎兒格點，[uterus_render.js](../../scripts/uterus_render.js#L520)負責色盤、像素、動態及親近表情。畫板是狀態的視圖，繪圖本身不會推進妊娠。

家系圖由 [lineage.js](../../scripts/lineage.js#L31)把子女和父母來源組成圖，再由 [lineage_view.js](../../scripts/lineage_view.js#L65)建立聚焦視圖。若來源欄位不完整，圖上自然只能呈現已記錄的關係。

家系卡片的肖像顯示種族圖示（七巧板風，見 [race_icons.js](../../scripts/race_icons.js)）：每個內建種族一個象徵物，衍生類型加上專屬外框（修煉八卦爻、魔導法陣與盧恩、妖怪勾玉、神祇光芒祭壇、不死棺木、血族蝙蝠血滴、星際行星、機械齒輪、器靈劍魂、變異輻射、序列階章、獸化爪痕）。混血時圖示取有圖示的成分中血統占比最高者；平手時取母方（遺傳母親，代孕時為卵源）占比較高的，母方也平手才取種族文字中排在前面的。血統比例本身仍是父母各半，母系只在選圖示時稍占上風，並在底下墊按血統占比斜切的拼色底；自訂或未知種族沒有圖示，肖像退回姓名首字。圖形以 `currentColor` 填色，隨主題變色。

## 模組索引

| 模組 | 責任 |
| --- | --- |
| [index.js](../../index.js) | 擴充入口、設定與 PDA 介面接線。 |
| [host.js](../../scripts/host.js) | SillyTavern、TauriTavern、Luker 的聊天、設定、世界書與保存介面。 |
| [state.js](../../scripts/state.js) | 預設值、正規化、角色與聊天狀態、訊息簽名及快照。 |
| [tracker.js](../../scripts/tracker.js) | 輪詢門控、逐樓分析、上下文投影和快照對帳。 |
| [api.js](../../scripts/api.js) | OpenAI 相容 API、端點、安全檢查、超時和回覆解析。 |
| [registry.js](../../scripts/registry.js) | 角色初始化及心理、衣櫃、日記、技能相關推論。 |
| [registry_config.js](../../scripts/registry_config.js) | 初始化欄位與提示設定。 |
| [registry_psy_config.js](../../scripts/registry_psy_config.js) | 心理欄位、階段及解釋。 |
| [tools.js](../../scripts/tools.js) | 工具定義與分派，生理、時間、代謝及分娩狀態轉換。 |
| [calculator.js](../../scripts/calculator.js) | 精源暴露、受精／著床預覽、後代及衍生類型計算。 |
| [stage_config.js](../../scripts/stage_config.js) | 月經、孕期、產程基準常數。 |
| [race_config.js](../../scripts/race_config.js) | 種族生理合成、遺傳、胚胎型態與伴生卵。 |
| [skill_config.js](../../scripts/skill_config.js) | 技能定義、等級、經驗、天賦與歷史。 |
| [wardrobe_config.js](../../scripts/wardrobe_config.js) | 衣物欄位、尺寸、配件與正規化。 |
| [tracker_prompt_context.js](../../scripts/tracker_prompt_context.js) | 追蹤提示與主流程狀態提示。 |
| [race_prompt_context.js](../../scripts/race_prompt_context.js) | 種族提示文字。 |
| [embryo_prompt_context.js](../../scripts/embryo_prompt_context.js) | 胚胎型態提示文字。 |
| [fetus_tags.js](../../scripts/fetus_tags.js) | 胎兒特殊標記與標籤。 |
| [fetus_sprite.js](../../scripts/fetus_sprite.js) | 胎兒像素格點。 |
| [uterus_layout.js](../../scripts/uterus_layout.js) | 子宮畫板的位置與比例。 |
| [uterus_render.js](../../scripts/uterus_render.js) | 子宮畫板繪製。 |
| [lineage.js](../../scripts/lineage.js) | 家系資料圖。 |
| [lineage_view.js](../../scripts/lineage_view.js) | 家系聚焦視圖。 |
| [race_icons.js](../../scripts/race_icons.js) | 種族圖示、衍生外框與混血拼色底的 SVG。 |
| [calculator_ui.js](../../scripts/calculator_ui.js) | 計算器畫面的輸入與結果。 |
| [doc_viewer.js](../../scripts/doc_viewer.js) | 插件內的說明閱讀器，讀取隨插件安裝的 docs。 |

## 查一個數值時的路線

先從 [state.js](../../scripts/state.js#L685)確認欄位預設值，再到 [tools.js](../../scripts/tools.js#L7817)找哪個工具會改它；若涉及時間，從 [applyTimeToCharacter](../../scripts/tools.js#L6133)追到該階段分支。機率與預覽看 [calculator.js](../../scripts/calculator.js)，種族係數看 [race_config.js](../../scripts/race_config.js)，畫面解釋則看 `index.js` 及對應的 render 模組。最後檢查 [tracker.js](../../scripts/tracker.js#L1301)是否把該欄位提供給模型；有些內部數值只參與程式計算。
