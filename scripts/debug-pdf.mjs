/* 调试:本地服务器 + 捕获 PDF 解析的具体错误 */
import { chromium } from 'playwright';
import { createReadStream, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, extname } from 'node:path';

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const srv = createServer((req, res) => {
  const p = req.url.split('?')[0];
  if (p === '/test.pdf') {
    res.writeHead(200, { 'Content-Type': 'application/pdf' });
    createReadStream('C:/Users/Tuhao/AppData/Local/Temp/pp_test.pdf').pipe(res);
    return;
  }
  const f = join('D:/petropulse', p);
  if (!existsSync(f)) { res.writeHead(404); res.end('404'); return; }
  res.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream' });
  createReadStream(f).pipe(res);
});
await new Promise(r => srv.listen(8321, r));

const browser = await chromium.launch();
const page = await browser.newPage();
const errs = [];
page.on('console', m => { if (m.type() === 'error') errs.push('[console] ' + m.text().slice(0, 300)); });
page.on('pageerror', e => errs.push('[pageerror] ' + String(e).slice(0, 400)));
page.on('requestfailed', r => errs.push('[reqfail] ' + r.url().slice(-70) + ' :: ' + (r.failure() && r.failure().errorText)));
page.on('dialog', async d => { console.log('[dialog]', d.message().slice(0, 300)); await d.accept(); });

await page.goto('http://127.0.0.1:8321/papers.html', { waitUntil: 'networkidle' });

/* 手动跑 pdfjs 全流程,打印每步结果 */
const detail = await page.evaluate(async () => {
  const out = { step: [] };
  try {
    const buf = await (await fetch('/test.pdf')).arrayBuffer();
    out.step.push('fetch OK, ' + buf.byteLength + ' bytes');
    const base = document.baseURI;
    const pdfjs = await import(new URL('assets/js/vendor/pdf.min.mjs', base).href);
    out.step.push('import OK, getDocument: ' + typeof pdfjs.getDocument);
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('assets/js/vendor/pdf.worker.min.mjs', base).href;
    const doc = await pdfjs.getDocument({ data: buf }).promise;
    out.step.push('getDocument OK, pages=' + doc.numPages);
    const pages = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      pages.push(tc.items.map(i => i.str).join(' '));
      out.step.push(`page ${p}: items=${tc.items.length} text="${tc.items.map(i => i.str).join(' ').slice(0, 40)}"`);
    }
    out.text = pages.join('\n');
    out.textLen = out.text.length;
  } catch (e) {
    out.error = String(e).slice(0, 300);
  }
  return out;
});
console.log('=== pdfjs 手动流程 ===');
(detail.step || []).forEach(s => console.log(' ', s));
if (detail.error) console.log('  ERROR:', detail.error);
console.log('  提取文本长度:', detail.textLen);

const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 10000 }), page.click('#miniDrop')]);
await chooser.setFiles('C:/Users/Tuhao/AppData/Local/Temp/pp_test.pdf');
await page.waitForTimeout(15000);
console.log('mdState:', await page.textContent('#mdState'));
console.log('=== 页面错误 ===');
errs.forEach(e => console.log(e));
await browser.close();
srv.close();
process.exit(0);
