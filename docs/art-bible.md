# 美術聖經（art-bible.md）——Arcanopolis

> 一頁文件，所有美術產出對照它。生圖 prompt 的風格前綴**逐字**取自本檔，不得改寫。
> 狀態：草案，待使用者核可（2026-08-21）。

## 調色盤（DawnBringer DB32，32 色）

採用社群標準 DB32 調色盤——AI 生圖模型對它熟悉度高，量化偏移小。

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
- 建築：佔格 N×N tiles；sprite 畫布寬 = N×64px，高度依建築體量、上限 = 寬×1.5；
  錨點 = 底面菱形中心（貼齊地格）
- UI 圖示：24×24
- 遊戲內縮放倍數：×2（整數倍，禁非整數縮放）

## 光源與描邊

- 光源方向：**左上 45°**，全素材一致（等距建築左立面亮、右立面暗）
- 描邊：**1px 深色描邊（#222034）**，全素材一致

## $imagegen 風格前綴（每批生圖 prompt 逐字帶上）

```
pixel art, isometric 2:1 projection, medieval fantasy city-builder sprite,
DawnBringer DB32 32-color palette, top-left 45-degree lighting so the left facade
is lit and the right facade is in shadow, 1px dark outline (#222034), flat shading
with subtle dithering, no anti-aliasing, crisp pixel edges, subject centered on an
isometric diamond base tile, plain solid white background, no drop shadow
```

## 參考圖組（每批生圖附上）

- （尚無——M0 等距一致性驗證的首批合格素材將作為定調參考圖存入 `assets\refs\`）
