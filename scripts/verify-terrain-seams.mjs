import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..')
const tileNames = [
  'tile-grass-01.png',
  'tile-grass-02.png',
  'tile-dirt-01.png',
]
const background = [0x26, 0x2b, 0x44]

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

function run(executable, args, { binary = false } = {}) {
  const result = spawnSync(executable, args, {
    cwd: projectRoot,
    encoding: binary ? null : 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const stderr = result.stderr?.toString().trim()
    throw new Error(`${path.basename(executable)} 執行失敗 (${result.status}): ${stderr}`)
  }
  return result.stdout
}

function parseArguments() {
  const outIndex = process.argv.indexOf('--out')
  if (outIndex === -1 || !process.argv[outIndex + 1]) {
    throw new Error('用法：node scripts/verify-terrain-seams.mjs --out <patch.png>')
  }
  return path.resolve(process.argv[outIndex + 1])
}

function isDiamondPixel(x, y) {
  return Math.abs(x - 32) + 2 * Math.abs(y - 16) <= 32
}

function readRgba(magick, imagePath, width, height) {
  const buffer = run(magick, [imagePath, '-depth', '8', 'rgba:-'], { binary: true })
  const expectedBytes = width * height * 4
  if (buffer.length !== expectedBytes) {
    throw new Error(`RGBA 資料長度錯誤：預期 ${expectedBytes}，實得 ${buffer.length}`)
  }
  return buffer
}

const outputPath = parseArguments()
mkdirSync(path.dirname(outputPath), { recursive: true })
const magick = findMagick()
const scratchDir = mkdtempSync(path.join(tmpdir(), 'arcanopolis-seam-check-'))
const transparentPatch = path.join(scratchDir, 'patch-transparent.png')

const width = 384
const height = 224
const originX = 192
const originY = 48
const placements = []

for (let gy = 0; gy < 5; gy += 1) {
  for (let gx = 0; gx < 5; gx += 1) {
    const tileName = tileNames[(gx + gy) % tileNames.length]
    placements.push({
      tilePath: path.join(projectRoot, 'assets', 'game', tileName),
      left: originX + (gx - gy) * 32 - 32,
      top: originY + (gx + gy) * 16 - 16,
    })
  }
}

try {
  const composeArgs = ['-size', `${width}x${height}`, 'xc:none']
  for (const placement of placements) {
    composeArgs.push(
      '(', placement.tilePath, ')',
      '-geometry', `+${placement.left}+${placement.top}`,
      '-compose', 'over', '-composite',
    )
  }
  composeArgs.push(transparentPatch)
  run(magick, composeArgs)

  run(magick, [
    '-size', `${width}x${height}`, 'xc:#262b44',
    transparentPatch, '-compose', 'over', '-composite',
    outputPath,
  ])

  const transparentRgba = readRgba(magick, transparentPatch, width, height)
  const visibleRgba = readRgba(magick, outputPath, width, height)
  const expected = new Uint8Array(width * height)

  for (const placement of placements) {
    for (let y = 0; y < 32; y += 1) {
      for (let x = 0; x < 64; x += 1) {
        if (isDiamondPixel(x, y)) {
          expected[(placement.top + y) * width + placement.left + x] = 1
        }
      }
    }
  }

  let checkedPixels = 0
  let holes = 0
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x
      if (!expected[index]) continue

      // Erode only the outer patch contour by one pixel. Internal tile seams remain
      // fully included because the expected union is continuous there.
      let internal = true
      for (let dy = -1; dy <= 1 && internal; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (!expected[(y + dy) * width + x + dx]) {
            internal = false
            break
          }
        }
      }
      if (!internal) continue

      checkedPixels += 1
      const offset = index * 4
      const transparent = transparentRgba[offset + 3] !== 255
      const isBackground = visibleRgba[offset] === background[0]
        && visibleRgba[offset + 1] === background[1]
        && visibleRgba[offset + 2] === background[2]
      if (transparent || isBackground) holes += 1
    }
  }

  const samples = {}
  for (const tileName of tileNames) {
    const tilePath = path.join(projectRoot, 'assets', 'game', tileName)
    const rgba = readRgba(magick, tilePath, 64, 32)
    const alphaAt = (x, y) => rgba[(y * 64 + x) * 4 + 3]
    samples[tileName] = {
      '0,16': alphaAt(0, 16),
      '48,24': alphaAt(48, 24),
      '32,0': alphaAt(32, 0),
      '32,31': alphaAt(32, 31),
      '16,8': alphaAt(16, 8),
    }
  }

  console.log(JSON.stringify({
    patch: outputPath,
    checkedPixels,
    holes,
    samples,
  }, null, 2))

  if (holes !== 0) process.exitCode = 1
} finally {
  rmSync(scratchDir, { recursive: true, force: true })
}
