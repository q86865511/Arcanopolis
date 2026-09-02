# 美術聖經（art-bible.md）——Arcanopolis

> 一頁文件，所有美術產出對照它。生圖 prompt 的風格前綴**逐字**取自本檔，不得改寫。
> 狀態：**已核可**（2026-08-21，經 5 張驗證批實圖確認）。

## 調色盤（DawnBringer DB32，32 色——風格指引）

採用社群標準 DB32 調色盤——AI 生圖模型對它熟悉度高，色調方向穩定。
**定位（2026-08-21 M2 使用者裁決）**：DB32 是生圖 prompt 的風格指引，**非硬約束**——
後處理量化為「每張 ≤32 色」（pngquant），**不做全域 remap**（實驗證實 remap 產生
紅點噪聲與偏色劣化）。後期全域色彩效果（夜間/季節濾鏡）以 shader 色調映射實現，
不依賴素材共用同一調色盤。`assets\palette.png`（DB32）保留作參考與實驗用。

| 用途 | Hex |
|---|---|
| 描邊／最深陰影 | #222034 |
| 石材主色系 | #9badb7 #847e87 #696a6a #595652 |
| 木材主色系 | #663931 #8f563b #d9a066 #eec39a |
| 屋頂強調（陶紅） | #ac3232 #d95763 |
| 植被 | #99e550 #6abe30 #4b692f #37946e |
| 魔法強調（後期） | #76428a #d77bba #5fcde4 #639bff |
| 其餘 | #000000 #45283c #df7126 #fbf236 #524b24 #323c39 #3f3f74 #306082 #5b6ee1 #cbdbfc #ffffff #8f974a #8a6f30 |

（固定調色盤檔：`assets\palette.png`——pngquant/remap 用，由後處理管線首次執行時生成）

## 解析度規格

- Tile 尺寸：等距菱形 **64×32**（2:1 投影）
- 地形 tile 一律套用精確二值菱形遮罩：以 `(32,16)` 為中心，判定式為
  `|x-32| + 2×|y-16| ≤ 32`；遮罩內 alpha = 255、遮罩外 alpha = 0，相鄰 tile
  的邊界像素必須重疊，鋪排後不得透出背景
- 地形 tile 的四條菱形接縫邊緣必須是**零透明像素**，不得以 trim、resize 或 alpha
  閾值化結果直接充當最終遮罩
- 地形類素材**不加 1px 描邊**，避免鋪排後形成黑色網格；描邊只用於建築與單位
- 建築：佔格 N×N tiles；sprite 畫布寬 = N×64px，高度依建築體量、上限 = 寬×1.5
  （塔類高建築放寬至 寬×1.75）；錨點 = 底面菱形中心（貼齊地格）
- **無底座規則**（2026-08-21 使用者裁決）：建築 sprite 不帶任何地面/草地/石板底座，
  地面由遊戲地形 tile 提供；建築底邊輪廓貼齊等距菱形佔格
- UI 圖示：24×24
- 單位/角色（村民等）：高 **28px**、寬依體型（實例：villager-01 13×28、villager-02 12×28）；
  無底座、站姿面向左下、錨點＝底邊中央；生圖前綴把 building 段換成
  「single small villager character standing, full body」（M3 定案）
- 遊戲內縮放倍數：×2（整數倍，禁非整數縮放）

## 光源與描邊

- 光源方向：**左上 45°**，全素材一致（等距建築左立面亮、右立面暗）
- 描邊：建築與單位使用 **1px 深色描邊（#222034）**；地形 tile 不使用描邊

## AoE2 北極星定調（2026-08-25 使用者定案）

視覺北極星＝**世紀帝國 II／Stronghold 的 2D 預算圖感**。現行地形素材照 DB32 鮮綠
（#99e550／#6abe30）生成，偏亮偏卡通——這是本定調要修正的偏差。自本日起所有
地形與建築素材依下列定調生成/重生：

- **暗橄欖基調**：草地以暗橄欖綠為主色（方向：#4b692f、#524b24、#8f974a 一帶），
  高飽和鮮綠（#99e550／#6abe30）降為極少量點綴；整體明度壓在中低段。
- **高雜色密度**：表面通篇忙碌，草簇/團塊/明暗斑的密度比現行高一級——
  AoE2 的地面沒有大片平色。
- **寫實偏暗**：色相貼近實物、飽和度壓低；「卡通感」（高飽和＋大平色塊）是要移除的方向。
- DB32 仍是風格指引（非硬約束，同上節裁決）；取用時偏向其暗段與土色系。

## $imagegen 風格前綴（每批生圖 prompt 逐字帶上）

```
pixel art, isometric 2:1 projection, medieval fantasy city-builder sprite,
DawnBringer DB32 32-color palette weighted toward its dark and earthy tones, muted
low-saturation colours in the mood of classic Age of Empires II, no candy-bright
colours, top-left 45-degree lighting so the left facade
is lit and the right facade is in shadow, 1px dark outline (#222034), flat shading
with subtle dithering, no anti-aliasing, crisp pixel edges, building only with no
ground base tile and no terrain under it, footprint aligned to an isometric diamond
grid, plain solid white background, no drop shadow
```

地形類素材（農田、道路、草地等本身即為 tile 者）改用以下前綴，不得帶建築／單位的
`1px dark outline`：

```
pixel art, isometric 2:1 projection, medieval fantasy city-builder terrain tile,
DawnBringer DB32 32-color palette, top-left 45-degree lighting, flat shading with
subtle dithering, no anti-aliasing, crisp pixel edges, subject is a single isometric
diamond terrain tile that fills the entire diamond with no blank pixels along any edge,
grid-aligned 64x32 footprint, plain solid white background, no drop shadow.
NO OUTLINE OF ANY KIND: do not draw a dark border, rim or contour around the diamond
or around any feature inside it; the terrain colours must run all the way to the edge.
SURFACE STRUCTURE IS MANDATORY: this image will be downsampled about 24 times, so any
feature narrower than 50 pixels disappears completely. Cover the whole diamond with
large, chunky, irregular patches of the terrain colour ramp - broad tonal blocks,
clumps and bare spots at least 60-120 pixels across. Never a flat single colour, and
never fine speckled noise (fine noise averages back into flat colour when downsampled).
NO CENTRED MOTIF: keep the detail asymmetric and off-centre, with no single recognisable
object in the middle, so that tiling many copies shows no repeating pattern.
DARK REALISTIC TONE IS MANDATORY: colour mood of classic Age of Empires II terrain -
dark olive greens and muted earthy tones, low saturation, overall slightly dark;
never bright cartoon greens or candy-saturated colours.
UNIFORM BRIGHTNESS TO EVERY EDGE: absolutely no vignette, no shading, no shadow and no
highlight concentrated near any edge of the diamond; the average brightness within 100
pixels of every edge must equal the average brightness of the centre.
```

UI 圖示（24×24）改用以下前綴——**正面平視、不是等距**，且降採樣倍率比任何其他素材都高
（1024 → 24 約 40 倍），極簡是唯一能存活的策略：

```
pixel art game UI icon, single centred object on a plain solid white background,
front-facing flat view (NOT isometric), DawnBringer DB32 32-color palette weighted
toward its dark and earthy tones, muted low-saturation colours in the mood of classic
Age of Empires II, bold 2px dark outline (#222034), flat shading with at most two
tones per material, no anti-aliasing, crisp pixel edges, no drop shadow, no text,
no frame, no border decoration.
EXTREME SIMPLICITY IS MANDATORY: the icon must read as a single bold silhouette at
24x24 pixels. Use ONE large object filling most of the canvas, chunky and blocky,
with a strong distinctive outline shape. NO small details, NO thin lines, NO texture,
NO multiple small objects, NO gradients. Think of a chunky emoji-like symbol.
```

（2026-08-25 M5-W2 實證：11 種資源圖示照此前綴一次通過，縮到 24×24 後剪影仍可辨。
後處理走 `scripts\process-icon-sprites.mjs`——最長邊縮 24 後置中補成正方形，
讓一列圖示的視覺重心對齊。）

三處要求各自對應一個實測缺陷（2026-08-24 修訂）：

- **NO OUTLINE OF ANY KIND**：舊版只寫 `no outline`，AI 照樣加黑邊，後處理得侵蝕 alpha 補救。
- **SURFACE STRUCTURE**：raw 1536 寬降到 64 寬是約 24 倍，raw 上 50px 才等於成品 2px。
  不講清楚這件事，AI 會畫細雜訊，而細雜訊降採樣後平均回純色——舊 grass 成品的中央標準差
  只有 2.9 就是這樣來的。
- **NO CENTRED MOTIF**：居中主體是鋪排出現壁紙感的唯一來源（舊 mountain 每格一座同樣的山）。
- **UNIFORM BRIGHTNESS TO EVERY EDGE**（2026-08-25 W2 加入）：AI 常在菱形邊緣畫「柔性陰影邊」
  （非硬描邊，erode 12 清不掉；實測 grass-03 v5 上緣不透明像素比中央暗 27%）。鋪排時菱形
  界像素交錯歸屬，暗邊變成深色虛線網格。後處理深侵蝕救不動（外擴回填會把邊緣附近的
  亮暗不均放大成亮虛線），只能在生圖時要求均亮到邊。驗法：量邊條「不透明像素」平均亮度
  與中央差 ≤10%。

### 地形 tile 的驗收（2026-08-24 訂，數值已由第一批 10 張實測校準）

跑 `node scripts\verify-terrain-tiles.mjs --tiles <名稱> --out <目錄>`：印指標並產 5×5 鋪排圖。
單張成品過關不算數，**一律要鋪 5×5 目視**。

#### 質性規則（決定性的是這三條，不是數字）

第一批 10 張有 8 張在鋪排時失敗，兩種失敗模式各自對應一條規則：

1. **禁方向性紋理**——帶、層理、浪紋、犁溝、任何平行走向。
   鋪排時它們會跨過格界連成貫穿整張地圖的斜條紋（rock「橫向岩層帶」、sand「帶狀起伏」、
   dirt「淺溝」三張都是這樣死的）。結構必須無方向性。
2. **禁高對比離散特徵物**——綠草上的橘色土斑、黃沙上的藍灰石礫。
   每一個都成為地標，眼睛立刻認出它們排成規律陣列。斑點與團塊必須與底色**同色系**，
   只差一階明暗，絕不用對比色相。
3. **目標形態＝同色系有機團塊的均勻地毯**——通篇忙碌多變，但質地處處均勻、沒有焦點。
   唯一一次通過的 grass-02 就是這樣（深綠草簇塊，只有明暗差）。

#### 量化指標（輔助篩選，不能取代目視）

| 指標 | 目標 | 說明 |
|---|---|---|
| 中央標準差＝地表結構強度 | **12–18** | 校準自實測：舊版純色是 2.2–2.9；通過的 grass-02 是 16.2；20.1／22.8 那兩張失敗 |
| 色數 | ≤ 32 | |
| 亮部散布 | 參考值 | **抓不到「居中主體」**——舊 mountain（每格一座山）只有 0.83，比別張低卻不足以定罪 |
| 對邊色差＝接縫 | 參考值 | **對有結構的 tile 會誤報**——通過的 grass-02 量到 16.1 卻看不出接縫 |

後兩項只當提示。「壁紙感」是「有沒有可辨識的形狀」的問題，統計量抓不到，只能靠鋪排目視。

## 參考圖組（每批生圖附上）

- `assets\refs\tavern-01.png`、`house-01.png`、`farm-01.png`、`wall-01.png`、`watchtower-01.png`
  ——M0 驗證批定調圖（2026-08-21 核可）。注意：這五張仍帶底座，僅供風格/角度/色調參考；
  底座規則已改為無底座，後續生圖以文字前綴為準。
