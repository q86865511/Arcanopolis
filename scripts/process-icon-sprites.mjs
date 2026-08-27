// UI 圖示的後處理：assets\raw 的原圖 → assets\game 的 24×24 圖示。
//
// 走建築/裝飾類管線（白底 floodfill 去背 → trim → Lanczos → pngquant 32），
// 與裝飾物的差別只在目標尺寸的算法：裝飾物按高度縮、任由寬度自由，
// 圖示要塞進固定的方形欄位（art-bible「UI 圖示：24×24」），所以縮到「最長邊 24」
// 之後置中補到 24×24 畫布——不同圖示的視覺重心才會對齊，排成一列時不會忽高忽低。
//
// 用法：node scripts/process-icon-sprites.mjs

import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..')

/** 成品邊長（art-bible「解析度規格」的 UI 圖示 24×24）。 */
const ICON_SIZE = 24

/**
 * 圖示清單：`raw` 是 assets\raw 的原圖，`out` 是 assets\game 的成品。
 * 命名對應 data\resources.json 的資源 id（HUD 依 id 找圖示 texture key）。
 * 原圖不存在的項目會略過，方便分批生圖時逐步補齊。
 */
const iconSprites = [
  { raw: 'icon-wood.png', out: 'icon-wood.png' },
  { raw: 'icon-stone.png', out: 'icon-stone.png' },
  { raw: 'icon-food.png', out: 'icon-food.png' },
  { raw: 'icon-gold.png', out: 'icon-gold.png' },
  { raw: 'icon-grain.png', out: 'icon-grain.png' },
  { raw: 'icon-flour.png', out: 'icon-flour.png' },
  { raw: 'icon-plank.png', out: 'icon-plank.png' },
  { raw: 'icon-iron-ore.png', out: 'icon-iron-ore.png' },
  { raw: 'icon-iron.png', out: 'icon-iron.png' },
  { raw: 'icon-ale.png', out: 'icon-ale.png' },
  { raw: 'icon-tools.png', out: 'icon-tools.png' },
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

function run(executable, args) {
  const result = spawnSync(executable, args, { cwd: projectRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${path.basename(executable)} 執行失敗 (${result.status}): ${result.stderr?.trim()}`)
  }
  return result.stdout?.toString().trim() ?? ''
}

const magick = findMagick()
// 與其他兩支同樣的 fallback：worktree 下寫死的相對路徑會落空。
const pngquantLocal = path.resolve(projectRoot, '..', 'tools', 'pngquant', 'pngquant.exe')
const pngquant = existsSync(pngquantLocal) ? pngquantLocal : 'pngquant'
const workDir = mkdtempSync(path.join(tmpdir(), 'arcanopolis-icon-'))

try {
  for (const { raw, out } of iconSprites) {
    const rawPath = path.join(projectRoot, 'assets', 'raw', raw)
    if (!existsSync(rawPath)) {
      console.log(`${raw}: 原圖不存在，略過`)
      continue
    }
    const outputPath = path.join(projectRoot, 'assets', 'game', out)
    const trimmedPath = path.join(workDir, `${raw}.trimmed.png`)
    const resizedPath = path.join(workDir, `${raw}.resized.png`)

    // 只 floodfill 外圍連通的白背景，物件內部的白色（麵粉、亮面）不會被挖掉。
    run(magick, [
      rawPath,
      '-bordercolor', 'white', '-border', '1',
      '-alpha', 'set', '-channel', 'RGBA', '-fuzz', '12%',
      '-fill', 'none', '-draw', 'alpha 0,0 floodfill',
      '-shave', '1x1', '-trim', '+repage',
      trimmedPath,
    ])

    // `24x24>` 是「最長邊縮到 24、比例不變」；再 -extent 置中補齊透明邊成正方形。
    // Lanczos 不用 point：原圖到成品是 40 倍以上的降採樣，point 會把描邊打散。
    run(magick, [
      trimmedPath,
      '-filter', 'Lanczos', '-resize', `${ICON_SIZE}x${ICON_SIZE}>`,
      '-background', 'none', '-gravity', 'center', '-extent', `${ICON_SIZE}x${ICON_SIZE}`,
      resizedPath,
    ])

    run(pngquant, ['--force', '--output', outputPath, '--quality', '0-100', '--speed', '1', '--nofs', '32', resizedPath])

    const geometry = run(magick, [outputPath, '-format', '%wx%h', 'info:'])
    const colors = run(magick, [outputPath, '-format', '%k', 'info:'])
    console.log(`${out}: ${geometry}, 色數=${colors}`)
  }
} finally {
  rmSync(workDir, { recursive: true, force: true })
}
