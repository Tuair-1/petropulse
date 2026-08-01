/* PetroPulse 石化脉动 — 共享前端逻辑 */
'use strict';

/* ---------- 导航 ---------- */
const nav = document.querySelector('.nav');
const burger = document.querySelector('.nav-burger');
const navLinks = document.querySelector('.nav-links');

const onScroll = () => nav && nav.classList.toggle('scrolled', window.scrollY > 10);
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

if (burger && navLinks) {
  burger.addEventListener('click', () => {
    navLinks.classList.toggle('open');
    burger.classList.toggle('open');
  });
  navLinks.addEventListener('click', e => {
    if (e.target.tagName === 'A') { navLinks.classList.remove('open'); burger.classList.remove('open'); }
  });
}

/* 高亮当前页导航 */
document.querySelectorAll('.nav-links a').forEach(a => {
  const here = location.pathname.split('/').pop() || 'index.html';
  if (a.getAttribute('href') === here) a.classList.add('active');
});

/* ---------- 滚动显现 ---------- */
const io = new IntersectionObserver(entries => {
  entries.forEach(en => {
    if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
  });
}, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
document.querySelectorAll('.reveal').forEach(el => io.observe(el));

/* ---------- 数字滚动 ---------- */
function countUp(el) {
  const target = parseFloat(el.dataset.count);
  const suffix = el.dataset.suffix || '';
  const decimals = (el.dataset.count.match(/\.\d+/) || [''])[0].length - 1;
  const dur = 1600;
  const t0 = performance.now();
  const fmt = n => n.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + suffix;
  function step(t) {
    const p = Math.min((t - t0) / dur, 1);
    el.textContent = fmt(target * (1 - Math.pow(1 - p, 3)));
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}
const numIO = new IntersectionObserver(entries => {
  entries.forEach(en => {
    if (en.isIntersecting) { countUp(en.target); numIO.unobserve(en.target); }
  });
}, { threshold: 0.5 });
document.querySelectorAll('[data-count]').forEach(el => numIO.observe(el));

/* ---------- 行情数据:三级降级(仓库 JSON → Yahoo 直连 → 演示) ---------- */
window.PP = window.PP || {}; // 先占位,避免下方赋值早于 PP 定义
window.PP_DEMO_QUOTES = [
  { nm: '布伦特原油',  px: 59.92, ch: +0.85, unit: '美元/桶', src: 'demo' },
  { nm: 'WTI 原油',    px: 56.74, ch: +1.02, unit: '美元/桶', src: 'demo' },
  { nm: '乙烯 CIF',    px: 765,   ch: -1.40, unit: '美元/吨', src: 'demo' },
  { nm: '丙烯 FOB',    px: 798,   ch: +0.62, unit: '美元/吨', src: 'demo' },
  { nm: '苯 CIF',      px: 845,   ch: +1.85, unit: '美元/吨', src: 'demo' },
  { nm: '对二甲苯 PX', px: 936,   ch: +0.44, unit: '美元/吨', src: 'demo' },
  { nm: '甲醇 CFR',    px: 292,   ch: -0.35, unit: '美元/吨', src: 'demo' },
  { nm: '聚乙烯 PE',   px: 918,   ch: +0.28, unit: '美元/吨', src: 'demo' },
  { nm: '聚丙烯 PP',   px: 896,   ch: +1.10, unit: '美元/吨', src: 'demo' },
  { nm: 'PVC',         px: 648,   ch: -0.72, unit: '美元/吨', src: 'demo' },
  { nm: '乙二醇 MEG',  px: 512,   ch: +2.30, unit: '美元/吨', src: 'demo' },
  { nm: '尿素',        px: 2385,  ch: +0.19, unit: '元/吨',   src: 'demo' }
];
window.PP_QUOTES = PP_DEMO_QUOTES.slice();

/* Yahoo 直连(浏览器兜底,仅布伦特/WTI) */
async function ppYahooDirect() {
  const syms = [['BZ=F', '布伦特原油', 'brent'], ['CL=F', 'WTI 原油', 'wti']];
  const quotes = [], history = {};
  for (const [sym, nm, key] of syms) {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?range=1y&interval=1d`, { cache: 'no-store' });
    if (!r.ok) continue;
    const j = await r.json();
    const res = j.chart && j.chart.result && j.chart.result[0];
    if (!res) continue;
    const closes = res.indicators.quote[0].close || [];
    const px = res.meta.regularMarketPrice;
    /* chartPreviousClose 部分 symbol 不可靠,优先取历史序列倒数第二根 */
    const prev = closes.length >= 2 && closes[closes.length - 2] != null
      ? closes[closes.length - 2]
      : (res.meta.chartPreviousClose || null);
    if (px == null) continue;
    quotes.push({
      nm, px: +px.toFixed(2), unit: '美元/桶',
      ch: prev ? +(((px - prev) / prev) * 100).toFixed(2) : 0,
      live: true, src: 'yahoo'
    });
    history[key] = {
      labels: (res.timestamp || []).map(ts => {
        const d = new Date(ts * 1000);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      }),
      values: closes.map(c => +c.toFixed(2))
    };
  }
  return quotes.length ? { quotes, history } : null;
}

/* 三级加载 */
window.PP.loadQuotes = async function () {
  try {
    const r = await fetch('data/quotes.json?t=' + Date.now(), { cache: 'no-store' });
    if (r.ok) {
      const j = await r.json();
      if (j && Array.isArray(j.quotes) && j.quotes.length) {
        return { quotes: j.quotes, history: j.history || {}, sources: j.sources || [], updated_at: j.updated_at, tier: 'json' };
      }
    }
  } catch (e) { /* 忽略,进入下一级 */ }
  try {
    const y = await ppYahooDirect();
    if (y) {
      const demo = PP_DEMO_QUOTES.filter(q => q.nm !== '布伦特原油' && q.nm !== 'WTI 原油');
      return { quotes: [...y.quotes, ...demo], history: y.history, sources: ['yahoo'], updated_at: new Date().toISOString(), tier: 'yahoo' };
    }
  } catch (e) { /* 忽略 */ }
  return { quotes: PP_DEMO_QUOTES.slice(), history: {}, sources: [], updated_at: null, tier: 'demo' };
};

/* ---------- 行情条渲染 ---------- */
function renderTicker(qs) {
  const track = document.querySelector('.ticker-track');
  if (!track) return;
  const isDemo = q => q.src === 'demo' || q.live === false;
  const item = q => `
    <div class="ticker-item">
      <span class="nm">${q.nm}${isDemo(q) ? '<span class="demo-chip" title="演示数据">演</span>' : ''}</span>
      <span class="px">${q.px.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}</span>
      <span class="ch ${q.ch >= 0 ? 'up' : 'down'}">${q.ch >= 0 ? '▲' : '▼'} ${Math.abs(q.ch).toFixed(2)}%</span>
      <span class="unit">${q.unit}</span>
    </div>`;
  track.innerHTML = qs.map(item).join('') + qs.map(item).join('');
}

/* ---------- 数据源徽章 ---------- */
function renderBadge(state) {
  const host = document.querySelector('.ticker') || document.querySelector('.page-hero .container');
  if (!host) return;
  let b = document.querySelector('.data-status');
  if (!b) {
    b = document.createElement('div');
    b.className = 'data-status';
    const crumbs = host.querySelector('.crumbs');
    if (crumbs) host.insertBefore(b, crumbs);
    else host.appendChild(b);
  }
  let label, cls;
  if (state.tier === 'json' && state.sources.length) { label = '实时行情 · 自动抓取'; cls = 'live'; }
  else if (state.tier === 'json') { label = '仓库缓存数据'; cls = 'cache'; }
  else if (state.tier === 'yahoo') { label = '直连行情'; cls = 'live'; }
  else { label = '演示数据'; cls = 'demo'; }
  let time = '';
  if (state.updated_at) {
    const mins = Math.max(0, Math.floor((Date.now() - new Date(state.updated_at).getTime()) / 60000));
    time = ` · ${mins < 1 ? '刚刚更新' : mins + ' 分钟前更新'}`;
  }
  b.innerHTML = `<span class="ds-dot ${cls}"></span>${label}${time}`;
  b.title = '数据源: ' + (state.sources.join(', ') || 'demo');
}

/* ---------- KPI 数据绑定 ---------- */
function bindQuotes(qs) {
  document.querySelectorAll('[data-quote]').forEach(el => {
    const q = qs.find(x => x.nm === el.dataset.quote);
    if (!q) return;
    const v = el.querySelector('.v');
    if (v) {
      v.innerHTML = (el.dataset.prefix || '') + q.px.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
        + (el.dataset.unit ? `<span style="font-size:15px;color:var(--t-3)"> ${el.dataset.unit}</span>` : '');
    }
    const d = el.querySelector('.d');
    if (d && !(q.src === 'demo' || q.live === false)) {
      d.innerHTML = `实时涨跌 <b class="${q.ch >= 0 ? '' : 'fall'}">${q.ch >= 0 ? '+' : ''}${q.ch.toFixed(2)}%</b>`;
    }
  });
  document.querySelectorAll('[data-demo]').forEach(el => {
    if (!el.querySelector('.demo-chip')) {
      const chip = document.createElement('span');
      chip.className = 'demo-chip';
      chip.title = '演示数据';
      chip.textContent = '演';
      (el.querySelector('.k') || el).appendChild(chip);
    }
  });
}

/* ---------- 初始化与定时刷新 ---------- */
async function initMarketData() {
  const st = await PP.loadQuotes();
  window.PP_QUOTES = st.quotes;
  renderTicker(st.quotes);
  renderBadge(st);
  bindQuotes(st.quotes);
  window.dispatchEvent(new CustomEvent('pp:quotes', { detail: st }));
  return st;
}

/* 每 5 分钟静默刷新(仅在有真实数据时重绘,演示数据不反复刷新) */
setInterval(async () => {
  const st = await PP.loadQuotes();
  if (st.tier === 'demo') return;
  const changed = JSON.stringify(st.quotes) !== JSON.stringify(window.PP_QUOTES);
  window.PP_QUOTES = st.quotes;
  if (changed) renderTicker(st.quotes);
  renderBadge(st);
  bindQuotes(st.quotes);
  window.dispatchEvent(new CustomEvent('pp:quotes', { detail: st }));
}, 5 * 60 * 1000);

document.addEventListener('DOMContentLoaded', initMarketData);

/* ---------- 确定性伪随机(数据演示) ---------- */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/* 生成平滑随机游走序列(用于演示图表) */
function genSeries(seed, start, points, vol, drift = 0) {
  const rnd = mulberry32(seed);
  const out = [];
  let v = start;
  for (let i = 0; i < points; i++) {
    v += (rnd() - 0.5) * 2 * vol + drift;
    v = Math.max(v, start * 0.45);
    out.push(+v.toFixed(1));
  }
  return out;
}

/* 月份标签序列 */
function monthLabels(startYear, startMonth, n) {
  const out = [];
  let y = startYear, m = startMonth;
  for (let i = 0; i < n; i++) { out.push(`${y}.${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; y++; } }
  return out;
}

window.PP = Object.assign(window.PP || {}, { mulberry32, genSeries, monthLabels });

/* 图表公共主题 */
window.PP_CHART_THEME = {
  textStyle: { color: '#aab6cf', fontFamily: '"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif' },
  tooltip: {
    backgroundColor: 'rgba(13,21,38,.94)',
    borderColor: 'rgba(246,168,33,.35)',
    borderWidth: 1,
    textStyle: { color: '#eef2fb', fontSize: 12.5 },
    axisPointer: { lineStyle: { color: 'rgba(246,168,33,.5)' } }
  },
  legend: {
    textStyle: { color: '#93a1bd' },
    icon: 'roundRect',
    itemWidth: 12, itemHeight: 12, itemGap: 20,
    top: 6
  },
  grid: { left: 14, right: 18, top: 46, bottom: 8, containLabel: true },
  xAxis: {
    axisLine: { lineStyle: { color: 'rgba(255,255,255,.12)' } },
    axisTick: { show: false },
    axisLabel: { color: '#6b7893', fontSize: 11.5 },
    splitLine: { show: false }
  },
  yAxis: {
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: '#6b7893', fontSize: 11.5 },
    splitLine: { lineStyle: { color: 'rgba(255,255,255,.055)' } }
  }
};
