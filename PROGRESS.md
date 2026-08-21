# PROGRESS — Arcanopolis

## 目前狀態

**M1 模擬核心完成**（128 tests 全綠、tsc 零錯誤）。下一里程碑：M2 呈現層（tile 地圖渲染、建築擺放 UI、Phaser 接線）。

## 已完成

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

（無——M0 已收尾，待啟動 M1）

## 待辦

- M2 呈現層；M3 居民；M4 生產鏈與經濟（MVP 驗收）；M5 塔防；M6 冒險者公會；M7 魔法；M8 種族；M9 上架。
- [審查登記] SAVE_SCHEMA_VERSION 升 v2 的任務必補：真實舊版存檔端到端遷移測試＋「版本落後無遷移即 throw」
  情境（v1 結構上無法測，使用者核可等價覆蓋）；遷移撰寫紀律——每次升版須同步擴充 deserialize 欄位驗證（R2-7）。
- [審查登記] M2 接存檔讀取 UI 時：載入後對 buildings type 做進場全量檢查（R2-4，目前未知 type 於首 tick 才爆）。
- [審查登記] fastforward main 接線無自動化測試（I/O 皮層排除，R2-6）；改動 main 參數傳遞時手動冒煙。

## 已知問題

（無）

## 重要決策紀錄

- [2026-08-21] 建築 sprite 無底座規則：地面一律由遊戲地形 tile 提供，生圖前綴帶
  「building only with no ground base tile」；地形類素材另有 tile 版前綴（見 art-bible）。

- [2026-08-21] 視角定案：Anno 式等距（2:1）；俯視 2D 為保底方案，等距生圖一致性過不了時回報再裁決。
- [2026-08-21] 玩法定案：生產鏈+居民模擬為主、疊加危機事件；塔防與冒險者公會兩者都要；
  中世紀為主+魔法解鎖層+多種族（後兩者為資料驅動疊加層，MVP 不含）。
- [2026-08-21] 技術棧：Phaser 3 + TS + Vite；core 純 TS 決定論、零 Phaser 依賴；數值外部化 JSON。
- [2026-08-21] Git 模式：本 session 採預設 (b)——自動 commit，push/PR/merge 前經使用者確認。
