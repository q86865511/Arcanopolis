// UI 樣式 token：HUD、選單、面板共用的色票與字體設定的單一真相來源。
//
// 為什麼要有這一層：在此之前同一個黃銅色以 BAR_EDGE_COLOR / PANEL_EDGE / BUTTON_EDGE /
// SLOT_SELECTED / PROGRESS_FILL / HOTKEY_COLOR / TITLE_COLOR 七個名字散在四個檔案裡，
// 各檔的註解得互相寫「與某某同一個顏色」才說得清它們是一件事。抽成 token 之後這件事
// 由型別系統保證，改色只改一處。
//
// 色票分數值型（0x，Phaser Graphics 用）與字串型（#，Phaser Text 用）兩組：這是 Phaser
// API 的要求而非重複，所以同色的兩種寫法放在相鄰欄位，漏改一邊會很顯眼。
//
// 本檔零 Phaser 依賴（純資料），繪製 helper 在 ./draw.ts。

export const UI_COLOR = {
  /** 深墨：面板底、格子邊框、進度條底槽。 */
  ink: 0x16131c,

  /** 黃銅：全遊戲唯一的強調色——選中框、面板邊、進度條、快捷鍵、速度指示都用它。 */
  brass: 0xd9a441,
  brassText: '#d9a441',

  /** 「可以」的綠：放置預覽合法時。 */
  ok: 0x5ac54f,

  /** 「不行」的紅：拆除預覽、買不起的格子、暫停狀態、警告文字——全遊戲一致。 */
  danger: 0xd95763,
  dangerText: '#d95763',

  /** 主文字。 */
  text: '#f2efe6',
  /** 弱化文字：次要數值、停用狀態、買不起的快捷鍵。 */
  textDim: '#7a7266',

  /** 面板與格子的底色：與世界的泥土/木頭色系同調，避免純黑方塊壓在像素畫上顯得突兀。 */
  surface: 0x3a2c22,
  /** 停用的按鈕底。 */
  surfaceDisabled: 0x2a2620,

  /** 買不起時縮圖的壓暗 tint。 */
  thumbDimmed: 0x6b6259,
  /** 正常縮圖 tint（Phaser 需要顯式白色才能取消壓暗）。 */
  thumbNormal: 0xffffff,
} as const;

/** 文字樣式：全 UI 統一 monospace ＋ 黑描邊，讓文字壓在任何地形上都讀得到。 */
export const UI_FONT = {
  family: 'monospace',
  stroke: '#000000',
  strokeThickness: 3,
} as const;

/** 面板與格子的框線樣式。半像素偏移的理由見 ./draw.ts 的 strokeFramedRect。 */
export const UI_FRAME = {
  /** 面板外框的線寬與透明度。 */
  panelEdgeAlpha: 0.7,
  /** 選單格子未選中時的框線透明度。 */
  slotEdgeAlpha: 0.8,
  /** 選中格子加粗到 2px 並不透明——選取狀態要一眼可分，不能只靠顏色。 */
  selectedEdgeWidth: 2,
  defaultEdgeWidth: 1,
} as const;
