/* ============================================================
 * test-e2e.mjs — 端到端功能测试(Playwright + Chromium)
 * 用法:
 *   LOCAL=1 node scripts/test-e2e.mjs   # 测本地 http://127.0.0.1:8321
 *   node scripts/test-e2e.mjs           # 测线上 GitHub Pages
 * ============================================================ */
import { chromium } from 'playwright';
import { writeFileSync, createReadStream, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, extname } from 'node:path';

const PROXY = 'http://127.0.0.1:7897';
const LOCAL = process.env.LOCAL === '1';
const BASE = LOCAL ? 'http://127.0.0.1:8321' : 'https://tuair-1.github.io/petropulse';
const PDF = 'C:/Users/Tuhao/AppData/Local/Temp/pp_test.pdf';

/* ---------- 最小合法 PDF ---------- */
function makePdf() {
  const objs = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n',
    '4 0 obj << /Length 74 >> stream\nBT /F1 16 Tf 72 720 Td (Petroleum reservoir engineering test paper 2026) Tj ET\nendstream endobj\n',
    '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n'
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  let pos = body.length;
  objs.forEach((o) => { offsets.push(pos); body += o; pos += o.length; });
  const xrefPos = pos;
  body += 'xref\n0 6\n0000000000 65535 f \n';
  for (let i = 1; i <= 5; i++) body += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  body += `trailer << /Size 6 /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  if (!existsSync(PDF)) writeFileSync(PDF, body, "binary");
}

/* ---------- 本地静态服务器 ---------- */
function startServer() {
  const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
  return new Promise(resolve => {
    const srv = createServer((req, res) => {
      const p = req.url === '/' ? '/index.html' : req.url.split('?')[0];
      const f = join('D:/petropulse', p);
      if (!existsSync(f)) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream' });
      createReadStream(f).pipe(res);
    });
    srv.listen(8321, () => resolve(srv));
  });
}

const browser = await chromium.launch(LOCAL ? {} : { proxy: { server: PROXY } });
const results = [];

async function runTest(name, url, setup, check) {
  const page = await browser.newPage();
  const errs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push('[console] ' + m.text().slice(0, 160)); });
  page.on('pageerror', e => errs.push('[pageerror] ' + String(e).slice(0, 300)));
  page.on('requestfailed', r => errs.push('[reqfail] ' + r.url().slice(-70) + ' :: ' + (r.failure() && r.failure().errorText)));
  let ok = false, report = '';
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 90000 });
    await setup(page);
    report = await check(page);
    ok = true;
  } catch (e) {
    report = '异常: ' + String(e).slice(0, 200);
  }
  results.push({ name, ok, report, errors: errs.slice(0, 8) });
  await page.close();
}

makePdf();
if (LOCAL) await startServer();

/* interpret: 选文件 → 解读 → 等待报告 */
await runTest(
  'interpret.html PDF 解读',
  `${BASE}/interpret.html`,
  async page => {
    const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 10000 }), page.click('#dropZone')]);
    await chooser.setFiles(PDF);
    await page.waitForSelector('#fileInfo', { state: 'visible', timeout: 10000 });
    await page.click('#btnInterpret');
  },
  async page => {
    await page.waitForFunction(() => {
      const r = document.getElementById('report');
      const t = r ? r.textContent : '';
      return t.includes('解读失败') || (t.length > 100 && !t.includes('解读报告将显示在这里'));
    }, { timeout: LOCAL ? 30000 : 150000, polling: 2000 });
    const t = await page.textContent('#report');
    if (t.includes('解读失败')) return '解读失败: ' + t.slice(0, 150);
    return '✅ 解读输出 ' + t.length + ' 字: ' + t.slice(0, 80).replace(/\n/g, ' ');
  }
);

/* papers: 拖 PDF 解析入文本框 */
await runTest(
  'papers.html PDF 拖拽解析',
  `${BASE}/papers.html`,
  async page => {
    const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 10000 }), page.click('#miniDrop')]);
    await chooser.setFiles(PDF);
  },
  async page => {
    await page.waitForFunction(() => {
      const s = document.getElementById('mdState').textContent;
      return s.includes('已提取') || s.includes('失败');
    }, { timeout: 30000, polling: 1000 });
    const state = await page.textContent('#mdState');
    const len = await page.evaluate(() => document.getElementById('paperText').value.length);
    return state.includes('失败') ? '解析失败: ' + state : `✅ ${state} | 文本框 ${len} 字`;
  }
);

await browser.close();

console.log(`\n========== E2E 测试结果(${LOCAL ? '本地' : '线上'}) ==========`);
for (const r of results) {
  console.log(`\n[${r.ok && !r.report.includes('失败') && !r.report.includes('异常') ? '✅' : '❌'}] ${r.name}`);
  console.log('  结果:', r.report);
  if (r.errors && r.errors.length) {
    console.log('  错误:');
    r.errors.forEach(e => console.log('    ' + e));
  }
}
process.exit(results.every(r => r.ok && !r.report.includes('失败') && !r.report.includes('异常')) ? 0 : 1);
