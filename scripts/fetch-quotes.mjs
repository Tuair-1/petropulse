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

/* 可选代理:本地验证设置 PP_PROXY=http://127.0.0.1:7897;Actions 环境不设,直连。
   undici 通过 npm install --no-save undici 本地安装;未安装时回退直连。 */
const PROXY = process.env.PP_PROXY || process.env.HTTPS_PROXY || '';
let dispatcher;
if (PROXY) {
  try {
    const { ProxyAgent } = await import('undici');
    dispatcher = new ProxyAgent(PROXY);
  } catch { console.log('[proxy] undici 未安装,回退直连'); }
}

/* ---------- 工具 ---------- */
async function fetchText(url, headers = {}, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal, dispatcher, headers: { 'User-Agent': UA, ...headers } });
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
  { code: 'SC0', key: 'sc',   nm: '原油期货 SC',  unit: '元/桶', hist: 'sc' },
  { code: 'PP0', key: 'pp',   nm: '聚丙烯 PP',    unit: '元/吨', hist: 'pp' },
  { code: 'L0',  key: 'l',    nm: '聚乙烯 L',     unit: '元/吨', hist: 'l' },
  { code: 'V0',  key: 'v',    nm: 'PVC',          unit: '元/吨', hist: 'v' },
  { code: 'MA0', key: 'ma',   nm: '甲醇',         unit: '元/吨', hist: 'ma' },
  { code: 'EG0', key: 'eg',   nm: '乙二醇 EG',    unit: '元/吨', hist: 'eg' },
  { code: 'EB0', key: 'eb',   nm: '苯乙烯 EB',    unit: '元/吨', hist: 'eb' },
  { code: 'UR0', key: 'ur',   nm: '尿素',         unit: '元/吨', hist: 'ur' },
  { code: 'TA0', key: 'ta',   nm: 'PTA',          unit: '元/吨', hist: 'ta' },
  { code: 'PX0', key: 'px',   nm: '对二甲苯 PX',  unit: '元/吨', hist: 'px' }
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
      key: f.key, nm: f.nm, px, unit: f.unit,
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
  { sym: 'BZ=F', key: 'brent', histKey: 'brent', nm: '布伦特原油', unit: '美元/桶' },
  { sym: 'CL=F', key: 'wti',   histKey: 'wti',   nm: 'WTI 原油',   unit: '美元/桶' }
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
      /* chartPreviousClose 在部分 symbol 上不可靠,优先取历史序列倒数第二根收盘 */
      const prev = closes.length >= 2 && closes[closes.length - 2] != null
        ? closes[closes.length - 2]
        : (r.meta.chartPreviousClose || null);
      if (!px) continue;
      quotes.push({
        key: s.key, nm: s.nm, px: round2(px), unit: s.unit,
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
    key: 'brent', nm: '布伦特原油', px: round2(px), unit: '美元/桶',
    ch: prev ? round2((px - prev) / prev * 100) : 0,
    live: true, src: 'sina-hf'
  };
}

/* ---------- 5. 生意社现货基准价(纯苯/丙烯, 日更) ---------- */
/* 页面有 JS 反爬校验(HW_CHECK cookie): 第一次请求拿 cookie, 二次请求取真实页面 */
const PPI_SPOTS = [
  { sfId: 120, key: 'benzene',   nm: '纯苯', regex: /([0-9]+)月([0-9]+)日生意社纯苯基准价为([0-9.]+)元\/吨/g },
  { sfId: 505, key: 'propylene', nm: '丙烯', regex: /([0-9]+)月([0-9]+)日生意社丙烯基准价为([0-9.]+)元\/吨/g }
];

async function fetchPPISpot({ sfId, key, nm, regex }) {
  const url = `https://www.100ppi.com/sf/${sfId}.html`;
  const headers = { Referer: 'https://www.100ppi.com/', Accept: 'text/html' };
  const fetchHtml = async (cookie) => {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 20000);
    try {
      const r = await fetch(url, { signal: c.signal, headers: { ...headers, 'User-Agent': UA, ...(cookie ? { Cookie: cookie } : {}) } });
      return await r.text();
    } finally { clearTimeout(t); }
  };
  const tryParse = html => {
    regex.lastIndex = 0;
    if (html.includes('正在进行安全检查')) return null;
    const raw = [];
    let m;
    while ((m = regex.exec(html)) && raw.length < 24) {
      raw.push({ date: `${m[1]}月${m[2]}日`, px: parseFloat(m[3]) });
    }
    if (!raw.length) return null;
    /* 页面同一日期出现两次(标题/alt),按日期去重 */
    const hits = [];
    for (const h of raw) if (!hits.some(x => x.date === h.date)) hits.push(h);
    const latest = hits[0].px;
    const prev = hits.length > 1 ? hits[1].px : null;
    return {
      key, nm, px: latest, unit: '元/吨',
      ch: prev ? round2((latest - prev) / prev * 100) : 0,
      live: true, src: '100ppi',
      tradeDate: hits[0].date
    };
  };

  /* 第一跳: 通常直连即返回真实页,直接解析 */
  let html = await fetchHtml('');
  let hit = tryParse(html);
  if (hit) return hit;

  /* 校验页: cookie 由页面 JS 写入,提取 32 位 hex 后二次请求 */
  const ck = html.match(/"[0-9a-f]{32}"/);
  const cookie = ck ? `HW_CHECK=${ck[0].replace(/"/g, '')}` : '';
  for (let i = 0; i < 3; i++) {
    html = await fetchHtml(cookie);
    hit = tryParse(html);
    if (hit) return hit;
  }
  throw new Error(`${nm} 现货解析失败`);
}

/* ---------- 演示数据(无免费源的品种) ---------- */
const DEMO_QUOTES = [
  { key: 'ethylene', nm: '乙烯 CIF', px: 765, ch: -1.40, unit: '美元/吨', live: false, src: 'demo' }
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

/* 上次成功值缓存:抓取失败时保留最近值而非清空 */
const prevData = existsSync(OUT) ? (() => { try { return JSON.parse(readFileSync(OUT, 'utf8')); } catch { return null; } })() : null;
const prevQuote = key => prevData && prevData.quotes ? prevData.quotes.find(q => q.key === key) : null;

if (!yahooOK) {
  try {
    const hf = await fetchSinaHF();
    if (hf) { sources.push('sina-hf'); quotes.unshift(hf); }
  } catch { console.error('[sina-hf] 失败'); }
  const oldWti = prevQuote('wti');
  quotes.push({
    key: 'wti', nm: 'WTI 原油',
    px: oldWti ? oldWti.px : 56.74, ch: oldWti ? oldWti.ch : 1.02,
    unit: '美元/桶', live: false, src: 'demo', note: '外盘源暂不可用'
  });
}

/* 生意社现货(纯苯/丙烯),失败则回落上一次值(标注演示) */
for (const spot of PPI_SPOTS) {
  try {
    const q = await fetchPPISpot(spot);
    if (q) { sources.push('100ppi'); quotes.push(q); }
  } catch {
    console.error(`[100ppi] ${spot.nm} 失败`);
    const old = prevQuote(spot.key);
    quotes.push({
      key: spot.key, nm: spot.nm,
      px: old ? old.px : 7800, ch: old ? old.ch : 0,
      unit: '元/吨', live: false, src: 'demo', note: '现货源暂不可用'
    });
  }
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
