// 地形 tile 驗收：量化指標 ＋ 5×5 鋪排圖。
//
// 用法：node scripts/verify-terrain-tiles.mjs [--tiles a,b,c] [--out <dir>] [--zoom 3]
//   --tiles  只驗這幾張（不含副檔名），省略＝驗 assets\game 下所有 tile-*.png
//   --out    鋪排圖輸出目錄，省略＝不產圖只印表
//
// 為什麼要有這支：art-bible 規定 tile 單張過關不算數，一律要鋪 5×5 看整體
// （舊 mountain 就是單張沒問題、鋪排才暴露成壁紙陣列）。而目視很花時間又主觀，
// 所以四個指標先做程式化篩選，鋪排圖留給最後的人眼確認。
//
// **標準差高不等於不重複**：規律排列的結構標準差一樣高，照樣鋪出網格。
// 指標只能否決，不能替代鋪排目視。

import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..')
const gameDir = path.join(projectRoot, 'assets', 'game')

function findMagick() {
  const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files'
  const install = readdirSync(programFiles, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('ImageMagick-'))
    .map((entry) => entry.name)
    .sort()
    .at(-1)
  if (!install) throw new Error('找不到 ImageMagick 安裝目錄')
  return path.join(programFiles, install, 'magick.exe')
}

function run(executable, args) {
  const result = spawnSync(executable, args, { cwd: projectRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`magick 執行失敗 (${result.status}): ${result.stderr?.trim()}`)
  }
  return result.stdout?.toString().trim() ?? ''
}

function parseArgs(argv) {
  const values = new Map()
  const supported = new Set(['--tiles', '--out', '--zoom'])
  for (let i = 0; i < argv.length; i += 2) {
    if (!supported.has(argv[i])) throw new Error(`verify-terrain-tiles: 不支援的參數 ${argv[i]}`)
    if (argv[i + 1] === undefined) throw new Error(`verify-terrain-tiles: ${argv[i]} 缺少值`)
    values.set(argv[i], argv[i + 1])
  }
  const zoom = Number(values.get('--zoom') ?? 3)
  if (!Number.isInteger(zoom) || zoom <= 0) throw new Error('verify-terrain-tiles: --zoom 必須是正整數')
  return { tiles: values.get('--tiles')?.split(','), out: values.get('--out'), zoom }
}

// 菱形四條邊各取五個落在邊線上的點（滿足 |x-32| + 2|y-16| == 32）。
// 鋪排時「左上邊」接鄰格的「右下邊」、「右上邊」接「左下邊」，所以這兩對的色差
// 就是接縫可見度——同一張 tile 重複鋪時，它自己的對邊就是接縫的兩側。
const EDGE_SAMPLES = {
  tl: [[4, 14], [10, 11], [16, 8], [22, 5], [28, 2]],
  br: [[59, 17], [53, 20], [47, 23], [41, 26], [35, 29]],
  tr: [[36, 2], [42, 5], [48, 8], [54, 11], [60, 14]],
  bl: [[27, 29], [21, 26], [15, 23], [9, 20], [3, 17]],
}

function edgeMean(lookup, points) {
  const values = points.map(([x, y]) => lookup.get(`${x},${y}`)?.lum).filter((v) => v !== undefined)
  if (values.length === 0) return 0
  return values.reduce((s, v) => s + v, 0) / values.length
}

/** 讀出菱形內的所有像素（x, y, 亮度）。64×32 只有 2048 格，一次讀完比多次呼叫 magick 快。 */
function readPixels(magick, file) {
  const text = run(magick, [file, '-depth', '8', 'txt:-'])
  const pixels = []
  for (const line of text.split('\n')) {
    const m = /^(\d+),(\d+): \((\d+),(\d+),(\d+),(\d+)\)/.exec(line.trim())
    if (m === null) continue
    const alpha = Number(m[6])
    if (alpha === 0) continue
    pixels.push({
      x: Number(m[1]),
      y: Number(m[2]),
      rgb: `${m[3]},${m[4]},${m[5]}`,
      lum: (Number(m[3]) + Number(m[4]) + Number(m[5])) / 3,
    })
  }
  return pixels
}

/**
 * 亮部集中度：取最亮的 10% 像素，看它們在空間上散得多開。
 *
 * 這是「居中主體」的指紋。第一版用「邊緣環亮度 − 中央亮度」，在舊 mountain 上量到 −2.0
 * 完全沒抓到——山峰受光面在中央偏上、山腳陰影在下方，四條邊平均後正負相抵了。
 * 改看亮部的空間分布就穩：一座山的受光面是一整塊集中的亮區，
 * 而均勻地表紋理的亮部會散布全格。
 *
 * 回傳值＝亮部座標標準差 ÷ 全體像素座標標準差。1.0 附近＝亮部跟整體一樣散開（好），
 * 明顯小於 1＝亮部擠在一塊（有主體）。
 */
function highlightSpread(pixels) {
  const sorted = [...pixels].sort((a, b) => b.lum - a.lum)
  const top = sorted.slice(0, Math.max(8, Math.round(sorted.length * 0.1)))
  const spread = (set) => {
    const mx = set.reduce((s, p) => s + p.x, 0) / set.length
    const my = set.reduce((s, p) => s + p.y, 0) / set.length
    // y 乘 2 還原等距壓縮，讓 x/y 的散布可比
    return Math.sqrt(set.reduce((s, p) => s + (p.x - mx) ** 2 + ((p.y - my) * 2) ** 2, 0) / set.length)
  }
  return spread(top) / spread(pixels)
}

/**
 * 全部指標都從同一份像素資料算，每張 tile 只呼叫 magick 一次。
 * 先前每個指標各呼叫一次（一張 8 次），在 Windows 上光是 magick 啟動就讓
 * 八張 tile 跑掉三分鐘。
 */
function measure(magick, file) {
  const pixels = readPixels(magick, file)
  const lookup = new Map(pixels.map((p) => [`${p.x},${p.y}`, p]))

  // 中央 40%：|x-32|<=12 且 |y-16|<=6，一定落在菱形內，取不到遮罩外的透明區
  const centre = pixels.filter((p) => Math.abs(p.x - 32) <= 12 && Math.abs(p.y - 16) <= 6)
  const centreLum = centre.reduce((s, p) => s + p.lum, 0) / centre.length
  const centreStd = Math.sqrt(centre.reduce((s, p) => s + (p.lum - centreLum) ** 2, 0) / centre.length)

  const means = Object.fromEntries(
    Object.entries(EDGE_SAMPLES).map(([dir, pts]) => [dir, edgeMean(lookup, pts)]),
  )

  return {
    colors: new Set(pixels.map((p) => p.rgb)).size,
    centreStd,
    centreLum,
    spread: highlightSpread(pixels),
    // 對邊色差＝鋪排接縫可見度
    seam: Math.max(Math.abs(means.tl - means.br), Math.abs(means.tr - means.bl)),
  }
}

/**
 * 過渡 tile：檔名帶方位後綴（-tl/-tr/-br/-bl）的單邊過渡素材。
 * 它們的量測門檻與均勻地表 tile 完全不同，一律跳過旗標判定。
 */
function isTransitionTile(name) {
  // slope 是階地側壁貼圖：自帶左亮右暗光影與層理，均勻地表門檻同樣不適用。
  return /-(tl|tr|br|bl)$/.test(name) || /^tile-slope-/.test(name)
}

/** 5×5 等距鋪排：格 (c,r) 落在 ((c-r)*32, (c+r)*16)。 */
function tileGrid(magick, src, out, zoom, n = 5) {
  const width = (n * 2 - 1) * 32 + 64
  const height = (n * 2 - 1) * 16 + 32
  const args = ['-size', `${width}x${height}`, 'xc:none']
  for (let r = 0; r < n; r += 1) {
    for (let c = 0; c < n; c += 1) {
      args.push(src, '-geometry', `+${(c - r) * 32 + (n - 1) * 32}+${(c + r) * 16}`, '-composite')
    }
  }
  // point 放大：檢查鋪排時要看清像素邊界，插值會把接縫糊掉反而看不出問題
  args.push('-filter', 'point', '-resize', `${zoom * 100}%`, out)
  run(magick, args)
}

const { tiles, out, zoom } = parseArgs(process.argv.slice(2))
const magick = findMagick()

const names = tiles ?? readdirSync(gameDir)
  .filter((f) => f.startsWith('tile-') && f.endsWith('.png'))
  .map((f) => f.replace(/\.png$/, ''))

if (out !== undefined) mkdirSync(path.resolve(projectRoot, out), { recursive: true })

console.log('tile                     色數  中央std   亮度  亮部散布   接縫')
let failures = 0
for (const name of names) {
  const file = path.join(gameDir, `${name}.png`)
  if (!existsSync(file)) {
    console.log(`${name.padEnd(24)} 檔案不存在`)
    failures += 1
    continue
  }
  const m = measure(magick, file)
  const flags = []
  if (m.colors > 32) flags.push('色數超標')
  // 提示而非判定：有結構的 tile 對邊本來就不同色，這個值會誤報。
  // 通過驗收的 grass-02 量到 16.1 卻完全看不出接縫。
  //
  // 過渡 tile 直接免除：它們的兩條對邊本來就是不同地形（浪花對深水、草緣對沙），
  // 色差大正是設計本意，量到 52-160 全是誤報。同理它們的中央標準差與亮部散布也
  // 無從比較——那些門檻是為「均勻地表」訂的。
  if (!isTransitionTile(name)) {
    if (m.centreStd < 12) flags.push('結構不足')
    if (m.centreStd > 18) flags.push('結構過強')
    if (m.spread < 0.85) flags.push('亮部偏集中→鋪排務必目視')
    if (m.seam >= 25) flags.push('對邊色差大→鋪排務必目視')
  }
  if (flags.length > 0) failures += 1
  console.log(
    `${name.padEnd(24)} ${String(m.colors).padStart(4)} ${m.centreStd.toFixed(1).padStart(8)}` +
    ` ${m.centreLum.toFixed(1).padStart(6)} ${m.spread.toFixed(2).padStart(10)}` +
    ` ${m.seam.toFixed(1).padStart(6)}  ${flags.join(' ')}`,
  )
  if (out !== undefined) {
    tileGrid(magick, file, path.resolve(projectRoot, out, `grid-${name}.png`), zoom)
  }
}

if (out !== undefined) console.log(`\n鋪排圖已輸出至 ${path.resolve(projectRoot, out)}`)
console.log(
  '\n判讀：中央std＝地表結構強度，目標 12-18（校準自 2026-08-24 第一批實測）；' +
  '亮部散布＝提示值（越小＝亮部越擠在一塊）；接縫 <10。\n' +
  '「居中主體／壁紙感」沒有可靠的程式化判準——舊 mountain 的亮部散布只有 0.83，\n' +
  '比其他 tile 低卻不足以定罪；通過驗收的 grass-02 對邊色差 16.1 卻看不出接縫。\n' +
  '那是「有沒有可辨識形狀」的問題，統計量抓不到。\n' +
  '指標全過**不代表**不重複——規律排列的結構照樣鋪出網格，鋪排圖務必目視。\n' +
  '鋪排的兩個死因（art-bible 有完整版）：方向性紋理（帶/層/浪/溝）會連成貫穿地圖的\n' +
  '斜條紋；與底色對比的離散特徵物（綠草上的橘土斑）會變成一眼認出的地標陣列。',
)
process.exitCode = failures > 0 ? 1 : 0
