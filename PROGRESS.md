# PROGRESS — Arcanopolis

## 目前狀態

M0 完成：art-bible 已核可、生圖與後處理管線端到端驗證通過，等待使用者啟動 M1（/pipeline）。

## 已完成

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

- M1 模擬核心（tick／資源／建築資料表／存檔 v1／快轉模擬器）——以 /pipeline 執行。
- M2 呈現層；M3 居民；M4 生產鏈與經濟（MVP 驗收）；M5 塔防；M6 冒險者公會；M7 魔法；M8 種族；M9 上架。

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
