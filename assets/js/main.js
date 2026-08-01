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

/* ---------- 行情数据(演示) ---------- */
window.PP_QUOTES = [
  { nm: '布伦特原油',  px: 59.92, ch: +0.85, unit: '美元/桶' },
  { nm: 'WTI 原油',    px: 56.74, ch: +1.02, unit: '美元/桶' },
  { nm: '乙烯 CIF',    px: 765,   ch: -1.40, unit: '美元/吨' },
  { nm: '丙烯 FOB',    px: 798,   ch: +0.62, unit: '美元/吨' },
  { nm: '苯 CIF',      px: 845,   ch: +1.85, unit: '美元/吨' },
  { nm: '对二甲苯 PX', px: 936,   ch: +0.44, unit: '美元/吨' },
  { nm: '甲醇 CFR',    px: 292,   ch: -0.35, unit: '美元/吨' },
  { nm: '聚乙烯 PE',   px: 918,   ch: +0.28, unit: '美元/吨' },
  { nm: '聚丙烯 PP',   px: 896,   ch: +1.10, unit: '美元/吨' },
  { nm: 'PVC',         px: 648,   ch: -0.72, unit: '美元/吨' },
  { nm: '乙二醇 MEG',  px: 512,   ch: +2.30, unit: '美元/吨' },
  { nm: '尿素',        px: 2385,  ch: +0.19, unit: '元/吨' }
];

function buildTicker() {
  const track = document.querySelector('.ticker-track');
  if (!track) return;
  const item = q => `
    <div class="ticker-item">
      <span class="nm">${q.nm}</span>
      <span class="px">${q.px.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}</span>
      <span class="ch ${q.ch >= 0 ? 'up' : 'down'}">${q.ch >= 0 ? '▲' : '▼'} ${Math.abs(q.ch).toFixed(2)}%</span>
      <span style="color:var(--t-3);font-size:11px">${q.unit}</span>
    </div>`;
  track.innerHTML = PP_QUOTES.map(item).join('') + PP_QUOTES.map(item).join('');
}
document.addEventListener('DOMContentLoaded', buildTicker);

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

window.PP = { mulberry32, genSeries, monthLabels };

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
