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
- 描邊：**1px 深色描邊（#222034）**，全素材一致

## $imagegen 風格前綴（每批生圖 prompt 逐字帶上）

```
pixel art, isometric 2:1 projection, medieval fantasy city-builder sprite,
DawnBringer DB32 32-color palette, top-left 45-degree lighting so the left facade
is lit and the right facade is in shadow, 1px dark outline (#222034), flat shading
with subtle dithering, no anti-aliasing, crisp pixel edges, building only with no
ground base tile and no terrain under it, footprint aligned to an isometric diamond
grid, plain solid white background, no drop shadow
```

（地形類素材——農田、道路、草地等本身即為 tile 者——把「building only…no terrain」段
換回「subject is a single isometric diamond terrain tile」，其餘前綴不變。）

## 參考圖組（每批生圖附上）

- `assets\refs\tavern-01.png`、`house-01.png`、`farm-01.png`、`wall-01.png`、`watchtower-01.png`
  ——M0 驗證批定調圖（2026-08-21 核可）。注意：這五張仍帶底座，僅供風格/角度/色調參考；
  底座規則已改為無底座，後續生圖以文字前綴為準。
