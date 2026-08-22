# PROGRESS — Arcanopolis

## 目前狀態

**M3 居民系統完成**（292 tests 全綠、tsc 零錯誤）：村民會出生、吃飯、上工、走路——
人口成長/飢餓/職業指派/A* 尋路/無狀態移動全數落地，平衡常數定案 C 組
（人均 100 糧/日、1 日儲備門檻）。待使用者實玩驗收後進 M4（生產鏈與經濟，MVP 驗收里程碑）。

## 已完成

- [2026-08-22] **M3.9-W3 完成**：大地圖適配。`distanceField` 加入節點預算（省略即無界、向後相容，
  審查以 400 張隨機地圖 92497 次查詢比對舊實作 mismatch 0）；movement 改為有預算上限的最佳努力
  搜尋；jobs 依 home 的 Manhattan 距離指派最近空缺。
  **效能實測：200×200／40 居民／300 tick 從 7834ms 降到 4ms；1000×1000／50 居民／100 tick 為 3ms**
  ——百萬格世界在模擬端證實可行（配合 W1 的地形隨用隨算與 T2 的分塊渲染方案，三根支柱齊備）。
  單審三裁決項兩過一不過：快取未破壞無狀態不變式（以「同實例連跑 400 vs 兩實例各跑 200 深等」證明）、
  嚴格下降在四連通格上數學排除所有循環（3000 情境零循環）；**F1 不通過——貪婪退化遇任何凸出障礙
  即永久凍結**（一棟 1×1 建築擋在直線正中就夠，實測 20000 tick 不動、真實地圖 4-6% 居民凍結），
  根因是**主迴圈規格過寬**（測試明文允許「卡死不動」為合法結果，故永遠不會紅）。
  修法改為有界最佳努力搜尋並**收緊測試**（移除卡死放寬、鎖定單障礙必須繞過抵達）。
  修正後實測：凍結比例 4-6% → **0.0%**，繞路成本正好 +2 步（10 格通勤第 120 tick 抵達、
  20 格第 220 tick 抵達）。終態 486 tests 綠。

- [2026-08-22] **M3.9-W2 完成**：地形綁定生產與資源耗竭再生。伐木場需鄰接森林並消耗之、
  採石場需蓋在石礦上、農田要草地、民居草地或沙灘；`canBuildAt` 成為 placeBuilding 第四關；
  砍光的森林轉草地並記 `depletedDay`，5 遊戲日後回復，礦脈不再生；新增 `regrowth` system。
  單審 12 條全修，其中 **F1 是主迴圈的規格錯誤**——原規格把「地形作為擺放條件」與「地形作為
  被消耗的資源」混為一談，導致農田（on: grass，而草地容量 0）永遠產 0 糧、demo 世界 8 日內
  全員餓死，而 449 個測試對此完全無感（審查以反向突變證實翻轉行為仍全綠）。修法為拆出獨立的
  `terrain.consumes` 欄位並補真實資料表測試。另修：F2 regrowth 從未接線（死碼）、F3 平衡
  （森林 60→2400、石礦 120→4800，一格約撐 2 遊戲日）、F4 改為真正資料驅動（原本容量硬寫在
  core，改 JSON 無效）、F5 擺放預覽接上 canBuildAt、F8 CLI 的 full-sim 改用決定論的地形感知
  落點（原本建築全落在海上，曲線無意義）。終態 459 tests 綠。
  實測自證：農田在草地 10 tick 產 30 糧且不消耗地形；森林格第 1200 tick 耗盡＝正好 2 遊戲日。

- [2026-08-22] **M3.9-W1 完成**：地形核心（hash noise 程序生成、島嶼遮罩、terrainAt 查詢、
  terrainOverrides 差異表）＋存檔 v4（三欄位＋from:3 遷移）。雙審 12 條全修：**C1 地形演算法
  版本欄位**（防日後改生成常數使舊檔地圖變形而無錯誤訊息）、C2 遷移時為舊檔建築/居民腳下建
  grass override、C3 override 鍵格式與越界驗證、C4 seed uint32 正規化、F1 序列化端守門、
  F3 小數座標 fail fast、F4 own-property 測試改為原型污染式（原測試恆真）、F5 worldSize 下限 10
  （代數保證在 size<5 崩潰）、F6 生成器指紋測試（原性質門檻擋不住常數突變）。終態 379 tests 綠。
  **T2 渲染方案定案：分塊 RenderTexture、視野內才烘**（見 `.pipeline/reviews/2026-08-22-spike-
  terrain-render.md`）——1000×1000 下 heap ~30MB 且初始化與世界大小解耦；Phaser 內建 isometric
  Tilemap 遭否決（heap 256MB、cull 每幀掃全圖（原始碼確認）、且有未解的格間縫隙缺陷）。

- [2026-08-22] **M3.5 視覺打磨波完成**（使用者實玩回報後插入）：視窗改 `Scale.RESIZE` 填滿
  （2K 全螢幕不再是小方框＋黑框，HUD 橫貫上下緣，另修 Phaser 邊界夾制把地圖釘左上角的問題）；
  村民走進建築格即隱藏＝「進屋工作」（探針 220 筆取樣零違反）。單審三個裁決項全通過
  （攝影機邊界改動 21 組數值比對等價、dev 全域 production 零命中、隱藏時機不誤判第三方建築），
  找到並修掉 F1 潛伏 bug（場景重啟後攝影機失去邊界——改為無狀態化根治）＋F2-F5；
  另抽出 `cameraBounds`/`hudLayout` 純函式補 17 條單元測試。終態 309 tests 綠。

- [2026-08-22] **M3 完成**（三波）：W1 居民資料模型＋存檔 v3（Citizen、v2→v3 遷移、housing/jobs
  欄位、population.json；T1 例外 Codex 雙審，F1-F3 修畢）；W2 人口/職業/在職率生產＋A* 尋路
  ＋movement（雙審 12 條：movement 經裁決重工為無狀態純函數步進模型——穿牆/存檔不一致/抖動
  全滅，距離場 BFS 順帶把 40×40 效能從 407ms 壓到 0.165ms）；W3 村民渲染（Codex 生圖 2 款）
  ＋HUD 人口＋快轉 --full-sim 人口曲線（單審 13 條，F1-F9/F11 修畢，平衡三候選實測後定案 C）。

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

- M4 生產鏈與經濟（MVP 驗收）；M5 塔防；M6 冒險者公會；M7 魔法；M8 種族；M9 上架。
- [審查登記 M3-W3] 2×2 建築落地時：工人在建築格內的 depth 遮擋語義（F10）；拆民居會靜默蒸發住戶、
  職業指派依陣列序（F13）——M4 做 UX 警告與指派策略時一併裁決。
- [審查登記 M3-W3] expandBuildingSpecs 容量上限改 grid×grid（預設 144）且 --grid 綁 --full-sim：
  非 full-sim 大量建築掃描（>144 棟）目前做不到，需要時再放寬。
- [審查登記 M3] 遊戲速度：首個日界＝實時 60 秒（600 tick×100ms），人口事件節奏慢——
  M4 或打磨期考慮加速檔位（1×/2×/4×）。
- [登記 M3.9-W2] 快轉 CLI 的 `--full-sim` 目前把建築直接放進 state.buildings、不經地形檢查，
  座標也不考慮地形——地形綁定後這些建築可能落在水上而產出恆為 0。W3 的 1000×1000 壓測前
  必須讓 fullSim 具備地形感知落點（或自動選可建格），否則壓測數字沒有意義。
- [登記 M3.9-W2] 規格缺口：一棟建築同時有地形綁定又產出多種資源時，地形資源池如何在多個
  產出項間分配未定義（目前所有帶 terrain 的建築都只產單一資源）。M4 加工鏈出現複合產出時補。
- [登記 M3.9-W2] `src\render\demoWorld.ts` 的 `applyDemoTerrain` 是暫時 fixture：demo 區 12×12
  落在 200×200 世界角落、core 判定為 water，故先覆寫成草地＋森林＋石礦讓產出鏈可跑。
  **W4 讓 render 直接讀 core 地形後整段刪除**。
- [登記 M3.9-W2 審查] F6 多格建築的 near 偏移只套在 footprint 原點（2×2 伐木場可靠腳下那格
  通過檢查並砍掉身下地形）；F9 `isAreaFree` 被執行兩次；F10 applyCommand 直呼路徑帶非整數座標
  會 throw 而非靜默跳過；F11 耗盡的 rock override 永不移除，長局可能撞上 200000 上限導致
  「能玩但存不了檔」；F12 每 tick 每建築重複呼叫 terrainAt 可省一半。
- **[設計約束 M3.9-W3 實測] 通勤半徑上限約 30 格**：居民速度 0.1 格/tick、半日 300 tick，
  等於單程最多 30 格；有繞路時更少（實測 30 格通勤＋一個障礙需 320 tick > 300 而永遠到不了，
  居民會走到一半就折返，形成永不抵達的來回擺盪）。大地圖上 jobs 的距離感知指派**還不夠**——
  需要一個硬上限：超出可通勤半徑的工作不得指派（否則居民空轉且該工作永遠沒人做）。
  M4 或 W4 落地大地圖時必須處理；同時考慮提高移動速度或縮短工作日。
- [登記 M3.9-W2 審查] 建議凍結一份「911c638 實際寫出的 v4 存檔字串」當 fixture——現有舊檔
  載入測試是拿當前 state 物件序列化而來，證明的是「當前 shape 少一欄可載入」，不是真實舊檔。
- [審查登記 M2-W1，補登] 地形渲染擴張路徑：現行每格一個 Phaser Image（12×12＝144 個），
  地圖 >64×64 時必須改 Tilemap 或烘成 RenderTexture／Blitter，否則物件數爆炸。**M3.9-W1 處理**。
- [審查登記 M3.5] 三項存疑/延後：(F6) `scene.remove()` 直接銷毀不 emit SHUTDOWN，resize 監聽
  理論上殘留（restart 路徑實測無洩漏，監聽數恆 5）；(F7) 日夜目標翻轉時折返中的居民最壞
  連續 0.5 秒被誤判為在建築內而隱藏（純美觀）；(F8) 多格建築的隱藏判定點是 origin 格
  ＝等距後上角，2×2 落地後村民會在建築背面消失——與 F10 的 depth 語義一起處理。
- [審查登記 M3.5] HUD 字級縮放用 monospace 字寬估算（0.62×字級）而非 Phaser 實際量測，
  極窄視窗（<200px）理論上仍可能小幅溢出；若之後 HUD 換字體需重校此係數。
- [缺口 2026-08-22] **地形無資料模型**：`terrainTextureAt(gx,gy)` 是 render 端純函數，
  地形不在 GameState、不進存檔；且生產與地點完全無關（伐木場不需要森林）。
  大地圖／自然資源／地形綁定生產都卡在這裡——見下方「重要決策紀錄」的地圖規模討論。
- [審查登記] 存檔載入 UI（未來任務）落地時：載入後對 buildings type 做進場全量檢查（未知 type 目前於
  首 tick 才爆）；並統一 occupancy（1×1 fallback）與 production（throw）對未知 type 的策略。
- [審查登記] pending 指令語意隨資料表版本漂移屬資料驅動設計限制（存檔綁資料表版本）；未來 schema
  升版任務評估是否對指令快照成本。遷移撰寫紀律：每次升版同步擴充 deserialize 欄位驗證。
- [審查登記] fastforward main 接線無自動化測試（I/O 皮層排除）；改動 main 參數傳遞時手動冒煙。
- [審查登記] uiCamera 尺寸取 create 當下值：改用 RESIZE/FIT scale 模式時需同步處理 HUD 裁切。
- [審查登記 M3] A* 效能：popLowest O(n) 掃描＋日界全城同步重算，40×40/150 人實測 407ms/tick——
  擴圖前需 binary heap＋錯峰/分幀；jobs 無空缺仍每 tick 全掃屬同類（F6/F11）。
- [審查登記 M3] 負糧食時日界消耗反向補正至 0（現無觸發路徑，F9）；在職率使資源出現小數，
  日後 cost 可負擔判定與糧食比較需注意浮點（F10 已修顯示層）。
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
