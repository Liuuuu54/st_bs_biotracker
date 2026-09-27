# BS BioTracker

![芭絲特查看 BS BioTracker PDA 的品牌插畫](assets/branding/bs-biotracker-cover.png)

BS BioTracker 是用於角色扮演的生理狀態追蹤擴充，現已推出 **v1.0.0**。它會根據對話更新角色狀態，並讓角色的生理週期、妊娠、需求與時間流逝持續影響故事。

支援 SillyTavern、TauriTavern、Luker；SillyTavern 已知測試版本為 `1.19.0`。

## 安裝與開始使用

1. 在擴充安裝介面使用 Git URL 安裝：`https://github.com/Liuuuu54/st_bs_biotracker`，然後重新載入。
2. 打開 **BS BioTracker**，設定 OpenAI 相容 API 的 Base URL、API Key 與模型。模型需能穩定輸出 JSON。
3. 啟用異步追蹤，註冊角色，再於角色追蹤頁手動分析一次對話以確認設定。

插件也提供角色狀態查看、時間推進、種族資料、技能與天賦、衣櫃，以及多種介面主題。各功能的詳細操作會另寫說明文件。

## 升級提醒

v1.0.0 以新的存檔結構作為正式基準，不再讀取或轉換 0.x 的舊存檔；從舊版升級請開新聊天。版本變更見 [Changelog](Changelog.md)。
