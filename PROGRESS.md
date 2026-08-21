# PROGRESS — Arcanopolis

## 目前狀態

M0 專案 bootstrap 進行中：骨架與文件已建，等待 art-bible 核可後進行等距一致性生圖驗證。

## 已完成

- [2026-08-21] 整體架構計劃核可（`~\.claude\plans\misty-wondering-peacock.md`）：
  三層疊加設計（中世紀經濟／威脅層／奇幻層）、M0–M9 里程碑、Claude+Codex 分工。
- [2026-08-21] 目錄骨架、git init、三文件（README/CLAUDE/PROGRESS）、.gitignore/.gitattributes（全 LF）。

## 進行中

- M0：art-bible 草案待使用者核可 → Codex trusted 設定、工具鏈檢查 → 等距一致性驗證生圖
  （3–5 張等距建築 montage 驗收）→ 端到端管線驗收。

## 待辦

- M1 模擬核心（tick／資源／建築資料表／存檔 v1／快轉模擬器）——以 /pipeline 執行。
- M2 呈現層；M3 居民；M4 生產鏈與經濟（MVP 驗收）；M5 塔防；M6 冒險者公會；M7 魔法；M8 種族；M9 上架。

## 已知問題

（無）

## 重要決策紀錄

- [2026-08-21] 視角定案：Anno 式等距（2:1）；俯視 2D 為保底方案，等距生圖一致性過不了時回報再裁決。
- [2026-08-21] 玩法定案：生產鏈+居民模擬為主、疊加危機事件；塔防與冒險者公會兩者都要；
  中世紀為主+魔法解鎖層+多種族（後兩者為資料驅動疊加層，MVP 不含）。
- [2026-08-21] 技術棧：Phaser 3 + TS + Vite；core 純 TS 決定論、零 Phaser 依賴；數值外部化 JSON。
- [2026-08-21] Git 模式：本 session 採預設 (b)——自動 commit，push/PR/merge 前經使用者確認。
