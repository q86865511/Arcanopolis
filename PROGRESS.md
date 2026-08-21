# PROGRESS — Arcanopolis

## 目前狀態

**M2 呈現層完成**（177 tests 全綠、tsc 零錯誤）：遊戲已可玩——等距地圖、建築擺放/拆除、
資源 HUD、即時模擬（10 tick/秒）、Playwright 截圖迴路。待使用者實玩驗收後進 M3（居民系統）。

## 已完成

- [2026-08-22] **M2-W2 完成**：core 建築指令（placeBuilding/removeBuilding＋佔格＋成本，TDD）、
  擺放 UI＋HUD＋固定時步遊戲迴圈（雙攝影機、sprite diff）、Playwright 截圖工具（npm run screenshot）。
  雙審（Claude 全波＋Codex 限 T2 存檔面）合併 12 項全修：指令數值/字串邊界、**id 帶 #tick 防 ABA**、
  **SAVE_SCHEMA_VERSION 升 v2＋no-op 遷移**（清掉 v1 端到端遷移測試債）、CLI defs 注入、
  HUD 誤觸防護、size 上限。終態 177 tests 綠。
- [2026-08-21] **M2-W1 完成**：素材批（等距地形 tile×3＋伐木場/採石場，Codex 生圖）、
  等距座標模組 iso.ts（TDD）、Phaser 3.90 接線（Boot/City 場景、攝影機、修復 lock 檔既有損壞）。
  單審 16 條全修；調色盤經 remap 實驗裁決放寬（DB32 為指引非硬約束）；
  素材管線 v3（tile 用 fuzz 白背去除修邊緣光暈）。

- [2026-08-21] **M1-W2 完成**：資料驅動層（ResourceDef/BuildingDef、loader 嚴格驗證、
  data 兩表、production system）＋存檔 v1（SAVE_SCHEMA_VERSION、pendingCommands 入 state、
  serialize/deserialize 逐欄驗證、applyMigrations＋gap 偵測）＋快轉 CLI
  （`npm run simulate`，--buildings 情境、CSV 曲線；Codex gpt-5.6-sol 實作）。
  單審（依使用者指示不派 Codex 第二審）出 13 條全修；複審 13/13 落實（突變驗證），
  殘留 R2-1/2/3/5/8 修畢、R2-9 主迴圈實測誤報。終態 128 tests 綠。

- [2026-08-21] **M1-W1 完成**：Vite+TS+Vitest scaffold；決定論模擬核心（mulberry32 RNG、
  時間系統 600 tick/日×30 日/季×四季、GameState、System 介面、指令佇列、固定時步 Simulation）。
  TDD（紅綠證據＋manifest）；雙審（reviewer 突變測試＋Codex 探針）出 14 條裁決，1-11 全修，
  複審 16 突變全殺再出 N 系列，N1-N5/N8-N11 全修；終態 50 tests 綠、tsc 0 錯。
  證據：`.pipeline/reviews/`（3 檔）與 `.pipeline/tdd/`。

- [2026-08-21] **M0 完成**：art-bible 經 5 張實圖核可（DB32/等距 64×32/左上光源/1px 描邊/
  無底座規則）；工具鏈裝齊（rembg 2.0.76、ImageMagick 7.1.2、pngquant 2.17.0）；
  Codex $imagegen → 搬運 → rembg → 點採樣 → pngquant 全管線驗證通過（5 張 32 色達標）；
  定調參考圖存 `assets\refs\`；Codex trusted 已設定。
- [2026-08-21] 整體架構計劃核可（`~\.claude\plans\misty-wondering-peacock.md`）：
  三層疊加設計（中世紀經濟／威脅層／奇幻層）、M0–M9 里程碑、Claude+Codex 分工。
- [2026-08-21] 目錄骨架、git init、三文件（README/CLAUDE/PROGRESS）、.gitignore/.gitattributes（全 LF）。

## 進行中

（無——M2 已收尾，待使用者實玩驗收）

## 待辦

- M3 居民；M4 生產鏈與經濟（MVP 驗收）；M5 塔防；M6 冒險者公會；M7 魔法；M8 種族；M9 上架。
- [審查登記] 存檔載入 UI（未來任務）落地時：載入後對 buildings type 做進場全量檢查（未知 type 目前於
  首 tick 才爆）；並統一 occupancy（1×1 fallback）與 production（throw）對未知 type 的策略。
- [審查登記] pending 指令語意隨資料表版本漂移屬資料驅動設計限制（存檔綁資料表版本）；未來 schema
  升版任務評估是否對指令快照成本。遷移撰寫紀律：每次升版同步擴充 deserialize 欄位驗證。
- [審查登記] fastforward main 接線無自動化測試（I/O 皮層排除）；改動 main 參數傳遞時手動冒煙。
- [審查登記] uiCamera 尺寸取 create 當下值：改用 RESIZE/FIT scale 模式時需同步處理 HUD 裁切。
- ~~SAVE_SCHEMA_VERSION 升 v2 必補端到端遷移測試~~——已於 M2-W2 修正批完成（v1 存檔經 no-op 遷移
  載入＋無遷移 throw＋續跑測試均已落地）。

## 已知問題

（無）

## 重要決策紀錄

- [2026-08-21] 調色盤定案：DB32 為風格指引非硬約束，每張素材獨立 ≤32 色量化、不做全域 remap
  （實驗證實 remap 劣化）；全域色彩效果留給 shader。素材後處理管線：tile 類用 fuzz 白背去除
  （非 rembg），建築類 rembg＋alpha 閾值化。
- [2026-08-21] 建築佔格與素材對齊：lumber-camp/quarry/farm 資料表改 1×1（配 64 寬 sprite）；
  2×2 建築（tavern 等）需 128 寬素材，量產時依 art-bible 尺寸規格。

- [2026-08-21] 建築 sprite 無底座規則：地面一律由遊戲地形 tile 提供，生圖前綴帶
  「building only with no ground base tile」；地形類素材另有 tile 版前綴（見 art-bible）。

- [2026-08-21] 視角定案：Anno 式等距（2:1）；俯視 2D 為保底方案，等距生圖一致性過不了時回報再裁決。
- [2026-08-21] 玩法定案：生產鏈+居民模擬為主、疊加危機事件；塔防與冒險者公會兩者都要；
  中世紀為主+魔法解鎖層+多種族（後兩者為資料驅動疊加層，MVP 不含）。
- [2026-08-21] 技術棧：Phaser 3 + TS + Vite；core 純 TS 決定論、零 Phaser 依賴；數值外部化 JSON。
- [2026-08-21] Git 模式：本 session 採預設 (b)——自動 commit，push/PR/merge 前經使用者確認。
