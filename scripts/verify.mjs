/* 站点自检:内联脚本语法 / 本地资源引用 / 内部链接 / 标签配平 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pages = ['index.html', 'market.html', 'chain.html', 'about.html', 'space.html', 'journal.html', 'papers.html', 'interpret.html'];
let errors = 0;

for (const p of pages) {
  const html = readFileSync(join(root, p), 'utf8');

  /* 1. 内联脚本语法 */
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
  let m, idx = 0;
  while ((m = re.exec(html))) {
    idx++;
    try { new Function(m[1]); }
    catch (e) { errors++; console.error(`✗ ${p} 内联脚本#${idx} 语法错误: ${e.message}`); }
  }
  console.log(`✓ ${p}: ${idx} 个内联脚本语法检查通过`);

  /* 2. 本地资源与链接 */
  const hrefs = [...html.matchAll(/(?:href|src)="([^"#]+?)(?:#[^"]*)?"/g)].map(x => x[1]);
  for (const h of hrefs) {
    if (/^https?:\/\//.test(h)) continue;
    const target = resolve(join(dirname(join(root, p)), h));
    if (!existsSync(target)) { errors++; console.error(`✗ ${p} → 缺失资源: ${h}`); }
  }

  /* 3. 标签配平(div/section/main/table/ul/svg/g) */
  for (const tag of ['div', 'section', 'main', 'table', 'ul', 'svg', 'g', 'nav', 'footer', 'header']) {
    const open = (html.match(new RegExp(`<${tag}[\\s>]`, 'g')) || []).length;
    const close = (html.match(new RegExp(`</${tag}>`, 'g')) || []).length;
    if (open !== close) { errors++; console.error(`✗ ${p}: <${tag}> 开 ${open} / 闭 ${close} 不平衡`); }
  }
  console.log(`✓ ${p}: 标签配平检查通过`);
}

/* 4. main.js 语法 */
try { new Function(readFileSync(join(root, 'assets/js/main.js'), 'utf8')); console.log('✓ main.js 语法通过'); }
catch (e) { errors++; console.error(`✗ main.js: ${e.message}`); }

console.log(errors ? `\n发现 ${errors} 处问题` : '\n全部检查通过 ✅');
process.exit(errors ? 1 : 0);
