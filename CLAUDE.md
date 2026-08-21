# Arcanopolis — 專案層 CLAUDE.md

中世紀異世界都市建造經營遊戲（Anno 式等距視角）。Phaser 3 + TypeScript。
整體計劃見 PROGRESS.md 與 `C:\Users\q86865511\.claude\plans\misty-wondering-peacock.md`。

## 架構鐵則

1. **邏輯/呈現分離**：`src\core\` 是模擬核心——純 TypeScript、**零 Phaser 依賴**、可 headless 執行。
   `src\render\` 只讀 core 狀態繪製，玩家輸入轉為指令物件送回 core，不得反向寫入狀態。
2. **決定論模擬**：core 內禁用 `Date.now()`、`Math.random()`、`new Date()`；
   一律用注入的 seeded RNG 與固定時步 tick。同 seed＋同指令序列必須產出同結果。
3. **資料驅動**：建築成本/產率/需求/科技/種族等數值一律放 `data\*.json`，不寫死在程式碼；
   新增內容應只需改資料表。
4. **存檔相容**：存檔 schema 帶版本號；每次 schema 變更必附遷移函式與舊檔載入測試。
   存檔相關變更是 Codex 第二審固定對象。

## 美術管線

- 風格規格以 `docs\art-bible.md` 為唯一準則；生圖 prompt 的風格前綴逐字取自該檔。
- `assets\raw\` 是生圖原始檔，**永不覆蓋、永不手改**；後處理產物進 `assets\game\`。
- 生圖走 Codex $imagegen（codex-imagegen skill），後處理走 pixel-asset-pipeline skill。

## 開發指令

（M1 scaffold 後補：dev server、測試、快轉模擬器 CLI。）

## Git

- commit 訊息繁體中文，格式 `類型: 簡述`（功能/修正/重構/文件/測試）。
- 等距素材與 JSON 資料表變更：commit 訊息註明對應建築/資料表名。
