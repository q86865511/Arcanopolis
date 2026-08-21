# Arcanopolis

中世紀異世界都市建造經營遊戲。你是一座邊境自由城的執政官：從伐木採石與農牧起家，
建立層層加工的生產鏈，滿足居民的溫飽與信仰；同時面對異界裂隙滲出的魔物潮——
築牆設塔守城，或向冒險者公會懸賞，派人深入巢穴除掉源頭。城市壯大後，
魔力節點、法師塔與多種族移民將把這座中世紀城市推向魔法都市 Arcanopolis。

## 特色

- **生產鏈與居民模擬**：Anno/Banished 式供需經濟，資源逐級加工增值。
- **雙軌威脅應對**：塔防式守城（治標）×冒險者公會間接派遣（治本）的資源分配張力。
- **三層疊加設計**：中世紀經濟基底 → 危機威脅層 → 魔法與多種族奇幻層，逐步解鎖。
- **等距像素美術**：2:1 等距視角，AI 生圖＋自動化後處理管線。

## 技術

- Phaser 3 + TypeScript + Vite；測試 Vitest + Playwright。
- 模擬核心（`src/core`）純 TS 決定論設計，可 headless 快轉模擬做數值平衡。
- 數值全外部化於 `data/*.json` 資料表。
- 發佈路線:網頁版（itch.io）→ Electron + Steam。

## 目錄

```
src/core/     模擬核心（sim 時序、world 世界狀態、systems 邏輯系統）
src/render/   Phaser 呈現層
src/data/     型別與資料表載入器
data/         JSON 數值資料表
assets/       raw 生圖原始檔 / game 遊戲用素材 / refs 生圖參考
docs/         art-bible.md 等設計文件
```

## 開發狀態

進行中（M0 bootstrap）。進度見 [PROGRESS.md](PROGRESS.md)。
