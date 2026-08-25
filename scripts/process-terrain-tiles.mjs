import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..')
/**
 * 地形 tile 清單。兩種寫法：
 * - 字串：raw 檔名與輸出檔名相同（一般情況，新增素材時直接加檔名即可）。
 * - `{ raw, out }`：raw 用新檔名，輸出蓋到既有的遊戲素材檔名上。
 *
 * 為什麼需要後者：`assets\raw` 永不覆蓋（它是重跑管線的輸入源，必須保留每一代的原圖），
 * 但重生的素材得落到渲染層已經在用的 texture key 上，畫面才會變、才驗證得了改善。
 * 兩個要求同時成立的唯一辦法就是把「輸入檔名」與「輸出檔名」拆開。
 */
const tileNames = [
  // 2026-08-24 批次 1 重生：舊版原圖是純色加細雜訊，降採樣後只剩單一顏色
  // （實測中央標準差 2.2-2.9）。-v2 原圖依修訂後的地形前綴生成，帶大塊地表結構。
  // v2 那批 10 張只有 grass-02 與 forest-01 通過鋪排目視；其餘 8 張因方向性紋理
  // （岩層帶／浪紋／犁溝）或高對比地標（橘土斑／藍石礫）在鋪排時形成明顯陣列，
  // 已於 v3 重生。判準與失敗模式見 docs\art-bible.md 的「地形 tile 的驗收」。
  // 2026-08-25 W1 定調重生：草地/森林依 art-bible「AoE2 北極星定調」轉暗橄欖低飽和
  // （前一代照 DB32 鮮綠生成，中心均色 (109,172,52)；新代約 (90,91,38)）。
  // grass-01/03 走到 v5：v4 的孤立淺卡其亮斑（grass-01）與單一大型深色團塊（grass-03）
  // 鋪排時都成可辨陣列，v5 改要求亮部柔和連續／小型多樣均佈團塊。
  // grass-01 下緣、grass-03 上緣有柔性陰影邊（不透明像素亮度比中央低 15%/27%），
  // 混鋪時菱形界像素交錯歸屬成深色虛線網格；深侵蝕（48）＋加大外擴（116%）清除。
  { raw: 'tile-grass-01-v5.png', out: 'tile-grass-01.png', erode: 48, stretch: '116%' },
  { raw: 'tile-grass-02-v3.png', out: 'tile-grass-02.png' },
  // grass-03 v5 的邊緣陰影深到侵蝕救不動（深侵蝕反把亮內容外擴成亮虛線），v6 重生
  // 時 prompt 明令均亮到邊。
  { raw: 'tile-grass-03-v6.png', out: 'tile-grass-03.png' },
  // forest 沿用「連續林冠、樹冠互相咬合」教訓（v2 樹冠成陣列、v3 分離綠球如高爾夫球）。
  { raw: 'tile-forest-01-v6.png', out: 'tile-forest-01.png' },
  { raw: 'tile-forest-02-v5.png', out: 'tile-forest-02.png' },
  { raw: 'tile-sand-01-v3.png', out: 'tile-sand-01.png' },
  { raw: 'tile-sand-02-v3.png', out: 'tile-sand-02.png' },
  { raw: 'tile-rock-01-v3.png', out: 'tile-rock-01.png' },
  { raw: 'tile-rock-02-v3.png', out: 'tile-rock-02.png' },
  { raw: 'tile-dirt-01-v3.png', out: 'tile-dirt-01.png' },
  // 2026-08-25 W1 順手項：water/ore 舊版是純色（標準差 4.6-5.3），依 AoE2 定調重生。
  { raw: 'tile-water-01-v3.png', out: 'tile-water-01.png' },
  { raw: 'tile-ore-01-v3.png', out: 'tile-ore-01.png' },
  // 批次 2a 山地重構：舊 mountain 每格畫一座有尖頂的完整小山，鋪排成整齊的山峰陣列，
  // 而且過暗（亮度 55/255）與明亮草地並排時把畫面切成兩塊。
  // 三張改為「無主體的岩石坡面紋理」，供渲染層混用鋪成連續高地。
  { raw: 'tile-mountain-01-v2.png', out: 'tile-mountain-01.png' },
  { raw: 'tile-mountain-02-v2.png', out: 'tile-mountain-02.png' },
  { raw: 'tile-mountain-03-v2.png', out: 'tile-mountain-03.png' },
  // 單邊過渡 tile：檔名後綴是「過渡到另一種地形的那條菱形邊」在螢幕上的方位。
  // tl=左上邊、tr=右上邊、br=右下邊、bl=左下邊，與 TerrainRenderer 的鄰格對應表一致。
  'tile-water-shore-tl.png',
  'tile-water-shore-tr.png',
  'tile-water-shore-br.png',
  'tile-water-shore-bl.png',
  'tile-sand-grass-tl.png',
  'tile-sand-grass-tr.png',
  'tile-sand-grass-br.png',
  'tile-sand-grass-bl.png',
  // 階地側壁（W3 斜坡）：raw 自帶左亮右暗光影，裙邊疊層時下緣兩條邊帶分別呈現
  // bl（受光）/br（背光）坡面，取代舊的 dirt+tint 垂直土壁。
  { raw: 'tile-slope-A.png', out: 'tile-slope-01.png' },
]

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

function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: projectRoot,
    encoding: options.binary ? null : 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })

  if (result.error) throw result.error
  if (result.status !== 0) {
    const stderr = result.stderr?.toString().trim()
    throw new Error(`${path.basename(executable)} 執行失敗 (${result.status}): ${stderr}`)
  }
  return result.stdout?.toString().trim() ?? ''
}

function createDiamondMask(outputPath) {
  const width = 64
  const height = 32
  const pixels = Buffer.alloc(width * height)
  let opaquePixels = 0

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      // Boundary-inclusive integer diamond centred at (32, 16). Its 1055 pixels
      // exceed the 1024-pixel lattice cell, so neighbouring tiles share edges.
      if (Math.abs(x - 32) + 2 * Math.abs(y - 16) <= 32) {
        pixels[y * width + x] = 255
        opaquePixels += 1
      }
    }
  }

  const header = Buffer.from(`P5\n${width} ${height}\n255\n`, 'ascii')
  writeFileSync(outputPath, Buffer.concat([header, pixels]))
  return opaquePixels
}

const magick = findMagick()
// git worktree 下 projectRoot 的上一層是 .claude\worktrees，不是工具目錄，寫死的相對路徑
// 會落空；找不到就退回 PATH 上的 pngquant，主 repo 與 worktree 都跑得起來。
const pngquantLocal = path.resolve(projectRoot, '..', 'tools', 'pngquant', 'pngquant.exe')
const pngquant = existsSync(pngquantLocal) ? pngquantLocal : 'pngquant'
const workDir = mkdtempSync(path.join(tmpdir(), 'arcanopolis-terrain-'))
const maskPath = path.join(workDir, 'diamond-mask.pgm')
const opaquePixels = createDiamondMask(maskPath)

try {
  for (const entry of tileNames) {
    const tileName = typeof entry === 'string' ? entry : entry.raw
    const outputName = typeof entry === 'string' ? entry : entry.out
    // AI 的「柔性陰影邊」比硬黑邊更深（實測可達 raw 上約 40px），預設 12 清不掉時
    // 以 { erode } 個別加深；侵蝕加深時 { stretch } 也要跟著放大，外擴回填才蓋得住
    // 被侵蝕的外圈（垂直向半高只有約 384px，112% 只能蓋約 23px 的侵蝕）。
    const erodeSize = typeof entry === 'string' ? 12 : (entry.erode ?? 12)
    const stretchPct = typeof entry === 'string' ? '112%' : (entry.stretch ?? '112%')
    const rawPath = path.join(projectRoot, 'assets', 'raw', tileName)
    const outputPath = path.join(projectRoot, 'assets', 'game', outputName)
    const backgroundRemovedPath = path.join(workDir, `${tileName}.background-removed.png`)
    const erodedPath = path.join(workDir, `${tileName}.eroded.png`)
    const resizedPath = path.join(workDir, `${tileName}.resized.png`)
    const maskedPath = path.join(workDir, `${tileName}.masked.png`)

    // Flood-fill only the connected outer white background so white flowers and
    // highlights inside a tile remain intact. The alpha is then trimmed to source art.
    run(magick, [
      rawPath,
      '-bordercolor', 'white', '-border', '1',
      '-alpha', 'set', '-channel', 'RGBA', '-fuzz', '12%',
      '-fill', 'none', '-draw', 'alpha 0,0 floodfill',
      '-shave', '1x1', '-trim', '+repage',
      backgroundRemovedPath,
    ])

    // Use the central 40% (always inside the diamond) as a stable surface-colour
    // estimate. Erode the original subject matte before flattening so the generated
    // dark outline is replaced by terrain colour instead of becoming a grid line.
    const surfaceColor = run(magick, [
      backgroundRemovedPath,
      '-gravity', 'center', '-crop', '40%x40%+0+0', '+repage',
      '-alpha', 'off', '-resize', '1x1!', '-depth', '8',
      '-format', '%[pixel:p{0,0}]', 'info:',
    ])

    run(magick, [
      backgroundRemovedPath,
      '(', '+clone', '-alpha', 'extract', '-morphology', 'Erode', `Diamond:${erodeSize}`, ')',
      '-alpha', 'off', '-compose', 'CopyAlpha', '-composite',
      erodedPath,
    ])
    const erodedGeometry = run(magick, [erodedPath, '-format', '%wx%h', 'info:'])

    // Refill the eroded rim by stretching the tile's own content outwards, not by
    // flooding it with one averaged colour.
    //
    // Flooding with surfaceColor gives every tile a rim of flat mid-grey while the
    // interior keeps its light and shade; once tiled, those identical rims line up
    // into visible grid lines (measured: old grass-01 rim was 7 levels brighter than
    // its centre). Stretching keeps each rim pixel close to whatever sits next to it,
    // so neighbouring tiles meet without a seam. surfaceColor stays as a last-resort
    // backstop for any corner the stretch still fails to cover.
    run(magick, [
      erodedPath,
      '(', '+clone', '-resize', stretchPct, '-gravity', 'center', '-extent', erodedGeometry, ')',
      '+swap', '-compose', 'over', '-composite',
      '-background', surfaceColor, '-alpha', 'remove', '-alpha', 'off',
      '-filter', 'Lanczos', '-resize', '64x32!',
      resizedPath,
    ])

    // Copy the exact binary mask into alpha after resize; every in-mask pixel is 255.
    run(magick, [
      resizedPath,
      maskPath,
      '-alpha', 'off', '-compose', 'CopyAlpha', '-composite',
      maskedPath,
    ])

    run(pngquant, [
      '--force', '--output', outputPath,
      '--quality', '0-100', '--speed', '1', '--nofs', '32',
      maskedPath,
    ])

    console.log(`${tileName}: surface=${surfaceColor}, output=${outputPath}`)
  }

  console.log(`mask: 64x32, opaque=${opaquePixels}`)
} finally {
  rmSync(workDir, { recursive: true, force: true })
}
