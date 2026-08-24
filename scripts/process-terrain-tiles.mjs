import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..')
// 地形 tile 清單：新增地形素材時加進來即可（輸入一律取自 assets\raw 的同名原始生圖）
const tileNames = [
  'tile-grass-01.png',
  'tile-grass-02.png',
  'tile-dirt-01.png',
  'tile-water-01.png',
  'tile-sand-01.png',
  'tile-forest-01.png',
  'tile-rock-01.png',
  'tile-ore-01.png',
  'tile-mountain-01.png',
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
  for (const tileName of tileNames) {
    const rawPath = path.join(projectRoot, 'assets', 'raw', tileName)
    const outputPath = path.join(projectRoot, 'assets', 'game', tileName)
    const backgroundRemovedPath = path.join(workDir, `${tileName}.background-removed.png`)
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
      '(', '+clone', '-alpha', 'extract', '-morphology', 'Erode', 'Diamond:12', ')',
      '-alpha', 'off', '-compose', 'CopyAlpha', '-composite',
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
