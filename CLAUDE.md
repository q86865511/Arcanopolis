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
- 生圖走 Codex $imagegen（codex-imagegen skill）。**後處理一律用專案的三支腳本，不要手打指令**：
  `scripts\process-terrain-tiles.mjs`（地形 tile：套菱形遮罩、按 64×32 縮）、
  `scripts\process-building-sprites.mjs`（建築：按寬度 N×64 縮）、
  `scripts\process-decor-sprites.mjs`（裝飾散佈物：按高度縮）、
  `scripts\process-icon-sprites.mjs`（UI 圖示：最長邊縮 24 後置中補成 24×24 方形）。
  四支的 `tileNames`／`buildingSprites`／`decorSprites`／`iconSprites` 清單支援 `{raw, out}` 映射——
  `assets\raw` 永不覆蓋，重生的素材靠映射落到現用的 texture key 上。
- **降採樣一律 Lanczos，不得用 `-filter point`**：12 倍以上降採樣時 point 會把風車葉片、
  梯子、旗桿這類 1px 細長結構整條打散。
- 地形 tile 驗收跑 `node scripts\verify-terrain-tiles.mjs [--tiles a,b] [--out <dir>]`：
  印量化指標並產 5×5 鋪排圖。**單張過關不算數，一律要鋪 5×5 目視**——
  判準與兩種鋪排失敗模式見 `docs\art-bible.md` 的「地形 tile 的驗收」。

## 開發指令

- `npm run test`（vitest run）；`npm run typecheck`（tsc --noEmit）——宣稱完成前兩者都要實跑。
- `npm run dev`（Vite dev server）；`npm run build`。
- 快轉模擬器 CLI：`npm run simulate -- --seed 1 --ticks 3000 --sample-every 600 --buildings "lumber-camp:2,farm:1" [--out curve.csv]`
  ——headless 跑 N ticks 輸出曲線 CSV（欄位 tick,totalDay,population,資源…）。預設為「理想產能」
  模式（滿編就業且忽略地形限制）；加 `--full-sim` 才套用完整的人口與地形耗竭規則
  （jobs+production+population+movement，人口從 0 成長，
  可配 `--grid <n>` 地圖邊長與 `--population-config <path>` 覆寫平衡常數，兩者僅 --full-sim 下有效）。
- 視覺驗證截圖：`npm run screenshot -- [--out path.png] [--wait ms] [--port n] [--center gx,gy] [--click x,y] [--hover x,y]`
  ——自起 vite（預設 5199）→ chromium 截圖 → 關閉；頁面無 canvas 或有 pageerror 時 exit 1。
  `--center` 把鏡頭移到指定格（驗證海岸線、礦脈等開局視野外的地方）。
  `--click`／`--hover` 是畫面像素座標，截圖前先點一下、再移滑鼠過去（驗切頁籤、懸停資訊卡這類互動後才出現的 UI）。
  render 層改動收尾必跑一次產證據圖。
  **內建瀏覽器（Browser pane）不能用來驗證本專案**：canvas 為 0×0，Phaser 場景起不來
  （已登記為環境限制非 bug），視覺驗證一律走本指令的 Playwright 路徑。
- **render 改動後分頁必須硬重載**：Vite HMR 對 Phaser 場景不乾淨，長開的分頁會停在新舊混雜狀態
  （曾造成「整格地形沒畫出來」的假象）。回報視覺異常時先在乾淨 port 探測重現，再開始追 bug。

## core 慣例（M1 起生效）

- 資源讀寫一律走 `src\core\world\state.ts` 的 `getResource`/`addResource`（own-property 語義），
  不得直接索引 `state.resources`（資源 id 可能與 Object.prototype 成員同名）。
- `System.update` 必須同步；ctx 僅在該 tick 內有效，不得留存 ctx.rng 跨 tick 使用。
- 指令一律經 `Simulation.enqueue`（入口驗證），於下一 tick 開頭 FIFO 套用。
- **在職＝到崗**（M4.5-W1 起）：production 計算在職人數時必須確認 citizen 站在建築 footprint 上，
  只看 `citizen.job` 不算數。任何新增的「依人力運作」機制都沿用此語義，
  否則通勤距離會再次與經濟脫鉤。座標比較用精確相等——movement 抵達時會貼齊格中心。

## render 慣例（M5 起生效）

- UI 的色票、字體、框線樣式一律取自 `src\render\ui\theme.ts` 的 token，**不得在各面板自行
  宣告色值**；繪製走 `ui\draw.ts` 的 `drawFramedRect` / `uiTextStyle`。
  例外只有 `game.ts` 的引擎背景色與 `Minimap` 的地形代表色（那是資料視覺化不是 UI chrome）。
- 地形選圖走 `src\render\terrainTiles.ts` 的 `terrainTextureKeyFor`，**必須是 state 的純函數**
  ——分塊 RenderTexture 會重烘，選圖不穩定會讓畫面閃爍。多邊臨界時取 `EDGE_OFFSETS` 的固定
  優先序，該陣列順序不可任意調換。
- 新增依賴鄰格的渲染時，`TerrainRenderer.invalidateTile` 必須連鄰格所屬 chunk 一起標髒。
- **階梯高度是純視覺屬性**：core 的 `elevationLevelAt`（seed 純函數、不吃 override）給每格
  0–3 階，render 的 `src\render\elevation.ts` 決定階高（`ELEVATION_STEP`）與所有座標修正。
  玩法系統（movement/buildable/jobs）**不得讀取階層**——高度影響玩法屬未來獨立裁決。
  新增任何「畫在格子上」的物件時，y 一律加 `elevationOffsetY`（整數格）或
  `floatElevationOffsetY`（浮點座標，居民用）；滑鼠拾取一律走 `pickElevatedTile`，
  不要直接用平面版 `hitTile`——階地會讓平面拾取選到視覺格的後方格。

## Git

- commit 訊息繁體中文，格式 `類型: 簡述`（功能/修正/重構/文件/測試）。
- 等距素材與 JSON 資料表變更：commit 訊息註明對應建築/資料表名。
