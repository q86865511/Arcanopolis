// scripts/screenshot.mjs
// 一鍵對遊戲畫面截圖的驗證工具：啟動 vite dev server → chromium headless 截圖 → 關閉 server。
// 用法：node scripts/screenshot.mjs [--port 5199] [--wait 5000] [--out screenshots/latest.png]
// 5173 可能被其他 dev server 佔用，預設一律用 5199。

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const values = new Map();
  const supported = new Set(['--port', '--wait', '--out']);

  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    if (!supported.has(key)) {
      throw new Error(`screenshot: 不支援的參數，收到 ${key}`);
    }
    const value = argv[index + 1];
    if (value === undefined) {
      throw new Error(`screenshot: ${key} 缺少值`);
    }
    values.set(key, value);
  }

  const port = values.has('--port') ? Number(values.get('--port')) : 5199;
  const wait = values.has('--wait') ? Number(values.get('--wait')) : 5000;
  const out = values.get('--out') ?? 'screenshots/latest.png';

  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`screenshot: --port 必須是正整數，收到 ${values.get('--port')}`);
  }
  if (!Number.isInteger(wait) || wait < 0) {
    throw new Error(`screenshot: --wait 必須是非負整數，收到 ${values.get('--wait')}`);
  }

  return { port, wait, out };
}

/** 啟動 vite dev server（子程序），stdout 出現 "Local:"（server ready）才 resolve，逾時或提早結束則 reject */
function startViteServer(port) {
  return new Promise((resolvePromise, reject) => {
    // Windows 的 npx 是 .cmd（批次檔），spawn 不加 shell:true 直接執行會噴 EINVAL。
    // port 已在 parseArgs 驗證為正整數，字串拼接進 shell 指令無注入疑慮；
    // 用單一指令字串（不傳 args 陣列）呼叫 shell:true，避免 Node 的 DEP0190 警告。
    const child =
      process.platform === 'win32'
        ? spawn(`npx.cmd vite --port ${port} --strictPort`, {
            cwd: projectRoot,
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: true,
          })
        : spawn('npx', ['vite', '--port', String(port), '--strictPort'], {
            cwd: projectRoot,
            stdio: ['ignore', 'pipe', 'pipe'],
          });

    let settled = false;
    let output = '';
    // 逾時／提早結束都要先關掉子程序樹再 reject，否則 vite 會變成殭屍程序（留在背景佔用 port）
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      killProcessTree(child).finally(() => {
        reject(new Error(`screenshot: vite dev server 在逾時內未就緒，輸出：\n${output}`));
      });
    }, 30_000);

    const onData = (chunk) => {
      output += chunk.toString();
      // vite 的 stdout 帶 ANSI 色碼，"Local" 與 ":" 之間會被色碼插斷；"http://localhost:" 本身不受影響，只比對這段
      if (!settled && /https?:\/\/localhost:/.test(output)) {
        settled = true;
        clearTimeout(timeout);
        resolvePromise(child);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(err);
    });
    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new Error(`screenshot: vite dev server 提早結束（exit ${code}），輸出：\n${output}`));
    });
  });
}

/** 關閉 vite 子程序：Windows 用 taskkill /T /F 連整個子程序樹一起關，避免留下殭屍 node 程序 */
function killProcessTree(child) {
  return new Promise((resolvePromise) => {
    if (child.pid === undefined || child.exitCode !== null) {
      resolvePromise();
      return;
    }
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      killer.on('exit', () => resolvePromise());
      killer.on('error', () => resolvePromise());
    } else {
      child.kill('SIGKILL');
      resolvePromise();
    }
  });
}

export async function main(argv = process.argv.slice(2)) {
  const { port, wait, out } = parseArgs(argv);
  const outPath = resolve(projectRoot, out);
  mkdirSync(dirname(outPath), { recursive: true });

  let viteProcess;
  let browser;
  try {
    viteProcess = await startViteServer(port);

    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

    // 頁面錯誤偵測：截圖成功不代表畫面正常（Phaser 炸掉也可能停在黑畫面），
    // 收集 pageerror 與 console error，截圖前一併對照 canvas 是否存在。
    const pageErrors = [];
    page.on('pageerror', (err) => {
      pageErrors.push(err instanceof Error ? err.message : String(err));
    });
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        pageErrors.push(msg.text());
      }
    });

    await page.goto(`http://localhost:${port}`, { waitUntil: 'load' });
    await page.waitForTimeout(wait);

    const hasCanvas = (await page.locator('canvas').count()) > 0;
    if (!hasCanvas || pageErrors.length > 0) {
      console.error(
        `screenshot: 頁面異常（canvas 存在=${hasCanvas}，錯誤數=${pageErrors.length}）：\n${pageErrors.join('\n')}`,
      );
      process.exitCode = 1;
    }

    // 即使頁面異常仍嘗試截圖：異常畫面本身就是除錯用的證據
    await page.screenshot({ path: outPath });
    console.log(`screenshot: 已截圖至 ${outPath}`);
  } finally {
    // 先關 vite子程序、再關 browser：兩步各自 try/catch，一方失敗不阻斷另一方
    // （沒有這層隔離，browser.close() 拋錯會讓 vite 永遠沒被關掉、留下殭屍程序）。
    if (viteProcess !== undefined) {
      try {
        await killProcessTree(viteProcess);
      } catch (err) {
        console.error(`screenshot: 關閉 vite dev server 失敗：${err instanceof Error ? err.message : err}`);
      }
    }
    if (browser !== undefined) {
      try {
        await browser.close();
      } catch (err) {
        console.error(`screenshot: 關閉 browser 失敗：${err instanceof Error ? err.message : err}`);
      }
    }
  }
}

const entryPath = process.argv[1]?.replaceAll('\\', '/').toLowerCase();
const modulePath = decodeURIComponent(new URL(import.meta.url).pathname).toLowerCase();
if (entryPath !== undefined && (modulePath === entryPath || modulePath === `/${entryPath}`)) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
