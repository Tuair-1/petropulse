/* ============================================================
 * fetch-quotes.mjs — 行情抓取脚本(GitHub Actions 定时执行)
 *
 * 数据源(逐源容错,失败不影响其他源):
 *   1. 新浪期货实时  hq.sinajs.cn  (nf_ 连续合约, GBK, 需 Referer)
 *   2. 新浪期货日K   stock2.finance.sina.com.cn InnerFuturesNewService.getDailyKLine
 *   3. Yahoo         query1.finance.yahoo.com/v8/finance/chart (布伦特 BZ=F / WTI CL=F)
 *   4. 新浪外盘(仅布伦特, Yahoo 失败时兜底) hf_OIL
 * 无期货的品种(乙烯/丙烯/苯/PX)保留演示数据并标注 live:false。
 * 输出: data/quotes.json — 有变化才写文件,避免无意义提交。
 * ============================================================ */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data', 'quotes.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';
const SINA_REFERER = 'https://finance.sina.com.cn';

/* ---------- 工具 ---------- */
async function fetchText(url, headers = {}, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA, ...headers } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.arrayBuffer();
  } finally { clearTimeout(t); }
}

function decodeGBK(buf) {
  try { return new TextDecoder('gbk').decode(buf); }
  catch { return new TextDecoder('utf-8').decode(buf); }
}

const round2 = n => Math.round(n * 100) / 100;

/* ---------- 1+2. 新浪期货:实时 + 日K ---------- */
const SINA_FUTURES = [
  { code: 'SC0', nm: '原油期货 SC',  unit: '元/桶', hist: 'sc' },
  { code: 'PP0', nm: '聚丙烯 PP',    unit: '元/吨', hist: 'pp' },
  { code: 'L0',  nm: '聚乙烯 L',     unit: '元/吨', hist: 'l' },
  { code: 'V0',  nm: 'PVC',          unit: '元/吨', hist: 'v' },
  { code: 'MA0', nm: '甲醇',         unit: '元/吨', hist: 'ma' },
  { code: 'EG0', nm: '乙二醇 EG',    unit: '元/吨', hist: 'eg' },
  { code: 'EB0', nm: '苯乙烯 EB',    unit: '元/吨', hist: 'eb' },
  { code: 'UR0', nm: '尿素',         unit: '元/吨', hist: 'ur' },
  { code: 'TA0', nm: 'PTA',          unit: '元/吨', hist: 'ta' }
];

async function fetchSinaRealtime() {
  const codes = SINA_FUTURES.map(f => `nf_${f.code}`).join(',');
  const buf = await fetchText(`https://hq.sinajs.cn/list=${codes}`, { Referer: SINA_REFERER });
  const text = decodeGBK(buf);
  const out = [];
  for (const f of SINA_FUTURES) {
    const m = text.match(new RegExp(`var hq_str_nf_${f.code}="([^"]*)"`));
    if (!m || !m[1]) continue;
    const p = m[1].split(',');
    const px = parseFloat(p[8]);
    const prev = parseFloat(p[10]);
    if (!px || !prev) continue;
    out.push({
      nm: f.nm, px, unit: f.unit,
      ch: round2((px - prev) / prev * 100),
      live: true, src: 'sina',
      tradeTime: p[1], date: p[17] || ''
    });
  }
  return out;
}

async function fetchSinaDaily(code) {
  const url = `https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var%20_=/InnerFuturesNewService.getDailyKLine?symbol=${code}`;
  let text = decodeGBK(await fetchText(url, { Referer: SINA_REFERER }));
  text = text.replace(/^[\s\S]*?var _=/, '').trim()
    .replace(/^\(([\s\S]*)\)\s*;?\s*$/, '$1'); // JSONP 外包裹的圆括号
  const arr = JSON.parse(text);
  const N = 260;
  return {
    labels: arr.slice(-N).map(k => k.d),
    values: arr.slice(-N).map(k => parseFloat(k.c))
  };
}

/* ---------- 3. Yahoo:布伦特 / WTI ---------- */
const YAHOO_SYMS = [
  { sym: 'BZ=F', key: 'brent', nm: '布伦特原油', unit: '美元/桶' },
  { sym: 'CL=F', key: 'wti',   nm: 'WTI 原油',   unit: '美元/桶' }
];

async function fetchYahoo() {
  const quotes = [], history = {};
  for (const s of YAHOO_SYMS) {
    try {
      const buf = await fetchText(`https://query1.finance.yahoo.com/v8/finance/chart/${s.sym}?range=1y&interval=1d`, { Accept: 'application/json' }, 20000);
      const j = JSON.parse(new TextDecoder().decode(buf));
      const r = j.chart.result[0];
      if (!r) continue;
      const closes = r.indicators.quote[0].close || [];
      const px = r.meta.regularMarketPrice;
      const prev = r.meta.chartPreviousClose;
      if (!px) continue;
      quotes.push({
        nm: s.nm, px: round2(px), unit: s.unit,
        ch: prev ? round2((px - prev) / prev * 100) : 0,
        live: true, src: 'yahoo'
      });
      const labels = (r.timestamp || []).map(ts => {
        const d = new Date(ts * 1000);
        return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
      });
      const vals = closes.map(c => round2(c));
      history[s.key] = { labels, values: vals };
    } catch { /* 该源失败,跳过 */ }
  }
  return { quotes, history };
}

/* ---------- 4. 新浪外盘:布伦特兜底(仅实时价) ---------- */
async function fetchSinaHF() {
  const buf = await fetchText('https://hq.sinajs.cn/list=hf_OIL', { Referer: SINA_REFERER });
  const text = decodeGBK(buf);
  const m = text.match(/var hq_str_hf_OIL="([^"]*)"/);
  if (!m || !m[1]) return null;
  const p = m[1].split(',');
  const px = parseFloat(p[7]);
  const prev = parseFloat(p[0]);
  if (!px) return null;
  return {
    nm: '布伦特原油', px: round2(px), unit: '美元/桶',
    ch: prev ? round2((px - prev) / prev * 100) : 0,
    live: true, src: 'sina-hf'
  };
}

/* ---------- 演示数据(无期货品种) ---------- */
const DEMO_QUOTES = [
  { nm: '乙烯',   px: 765, ch: -1.40, unit: '美元/吨', live: false, src: 'demo' },
  { nm: '丙烯',   px: 798, ch: +0.62, unit: '美元/吨', live: false, src: 'demo' },
  { nm: '苯',     px: 845, ch: +1.85, unit: '美元/吨', live: false, src: 'demo' },
  { nm: '对二甲苯', px: 936, ch: +0.44, unit: '美元/吨', live: false, src: 'demo' }
];

/* ---------- 主流程 ---------- */
const sources = [];
const quotes = [];
const history = {};

try {
  const q = await fetchSinaRealtime();
  if (q.length) { sources.push('sina'); quotes.push(...q); }
} catch { console.error('[sina-realtime] 失败'); }

for (const f of SINA_FUTURES) {
  try {
    const h = await fetchSinaDaily(f.code);
    if (h.values.length) history[f.hist] = h;
  } catch { console.error(`[sina-daily] ${f.code} 失败`); }
}

let yahooOK = false;
try {
  const y = await fetchYahoo();
  if (y.quotes.length) { sources.push('yahoo'); quotes.unshift(...y.quotes); yahooOK = true; }
  Object.assign(history, y.history);
} catch { console.error('[yahoo] 失败'); }

if (!yahooOK) {
  try {
    const hf = await fetchSinaHF();
    if (hf) { sources.push('sina-hf'); quotes.unshift(hf); }
  } catch { console.error('[sina-hf] 失败'); }
}

quotes.push(...DEMO_QUOTES);

const payload = {
  updated_at: new Date().toISOString(),
  sources,
  quotes,
  history
};

/* 有变化才写入 */
mkdirSync(join(ROOT, 'data'), { recursive: true });
const prev = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
const next = JSON.stringify(payload);
if (prev === next) {
  console.log('[no-change] 数据无变化,跳过提交');
} else {
  writeFileSync(OUT, next);
  console.log(`[written] ${OUT} — 报价 ${quotes.length} 条,历史 ${Object.keys(history).length} 组,来源 [${sources.join(', ')}]`);
}
