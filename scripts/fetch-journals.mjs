/* ============================================================
 * fetch-journals.mjs — 学报爬虫 + AI 分析(多源, GitHub Actions 每日执行)
 *
 * 数据源:
 *   1. 化工学报(founderss 方正系统): 官网首页最新论文
 *   2. 石油实验地质(自有系统): 当期 + 递归前 2 期,油气地质类
 * 分析:DeepSeek V4 Flash[1M] 批量生成导读 + 陆上/海上×浅层/深层分类 + 期刊洞察
 * 输出: data/journal.json — 有变化才写文件
 * ============================================================ */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data', 'journal.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36';

const API_KEY = process.env.DEEPSEEK_API_KEY || '';
const MODEL = process.env.AI_MODEL || 'deepseek-v4-flash';
const API_BASE = 'https://api.deepseek.com';
const BATCH_SIZE = 6;      // AI 分批篇数(推理模型 token 占用大,取 8 稳妥)
const MAX_PER_SOURCE = 50; // 单源最多篇数

/* ---------- 工具 ---------- */
async function fetchText(url, headers = {}, timeoutMs = 25000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA, ...headers }, redirect: 'follow' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally { clearTimeout(t); }
}

const strip = s => (s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

/* 过滤非论文条目(目次/封页/会讯等) */
const BAD_TITLES = /^(目次|目录|封面|封底|总目录|会讯|征稿|期刊介绍|广告|编委|理事会|欢迎订阅|封面人物|卷首语|序言|序|致谢|更正|勘误|新闻|简讯)/;

/* ============ 源 1: 化工学报(founderss 方正系统) ============ */
async function crawlFounderss(src) {
  const home = await fetchText(src.home);
  const ids = [...new Set([...home.matchAll(/\/zh\/article\/(\d+)\//g)].map(m => m[1]))].slice(0, MAX_PER_SOURCE);
  const out = [];
  for (const id of ids) {
    try {
      const html = await fetchText(src.articleBase + id + '/');
      const grab = re => { const m = html.match(re); return m ? m[1].trim() : null; };
      const title = grab(/citation_title" content="([^"]*)/) || grab(/<title>([^<]*)/) || '';
      if (!title || BAD_TITLES.test(title)) continue;
      const authors = [...html.matchAll(/citation_author" content="([^"]+)/g)].map(m => m[1]);
      const absZh = html.match(/"abstractsZh"[^>]*>([\s\S]*?)<\/div>/);
      out.push({
        title,
        authors: authors.slice(0, 12),
        date: grab(/citation_date" content="([^"]*)/),
        year: grab(/citation_year" content="([^"]*)/),
        volume: grab(/citation_volume" content="([^"]*)/),
        issue: grab(/citation_issue" content="([^"]*)/),
        doi: (grab(/citation_doi" content="([^"]*)/) || grab(/"doi":"([^"]*)/) || '').trim() || null,
        url: src.articleBase + id + '/',
        abstract: absZh ? strip(absZh[1]).slice(0, 500) : (grab(/name="description" content="([^"]*)/) || '').slice(0, 500),
        source: src.id
      });
    } catch { /* 单篇失败跳过 */ }
  }
  return out;
}

/* ============ 源 2: 石油实验地质(当期 + 前 2 期) ============ */
async function crawlSysydz(src) {
  const out = [];
  let url = src.currentUrl;
  const seen = new Set();
  for (let issue = 0; issue < 3 && url && out.length < MAX_PER_SOURCE; issue++) {
    let html;
    try { html = await fetchText(url); } catch (e) { console.error(`[crawl] ${src.name} 期次失败: ${e.message}`); break; }
    /* 列表条目:标题链接 + 作者 + 摘要 */
    const blocks = [...html.matchAll(/article-list-title[^>]*>\s*<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]{0,1200}?<\/div>[\s\S]{0,400}?<\/div>/g)];
    let added = 0;
    for (const b of blocks) {
      const href = b[1];
      const title = strip(b[2]);
      if (!href || !title || BAD_TITLES.test(title) || seen.has(href)) continue;
      /* 在条目块内再提取作者与摘要 */
      const block = b[0];
      const authorMatch = block.match(/article-list-author[^>]*>([\s\S]*?)<\/div>/);
      const absMatch = block.match(/search-article-abstract[^>]*>([\s\S]*?)<\/div>/);
      seen.add(href);
      out.push({
        title: title.slice(0, 200),
        authors: (authorMatch ? strip(authorMatch[1]) : '').split(/[,，;；]/).map(s => s.trim()).filter(Boolean).slice(0, 12),
        doi: (href.match(/doi\/([^"\/]+)/) || [])[1] || null,
        url: href.startsWith('http') ? href : src.base + href,
        abstract: absMatch ? strip(absMatch[1]).slice(0, 500) : null,
        source: src.id,
        issue: url.match(/\/article\/([0-9]+\/[0-9]+)/)?.[1] || null
      });
      added++;
      if (out.length >= MAX_PER_SOURCE) break;
    }
    console.log(`[crawl] ${src.name} ${url.match(/\/article\/([0-9]+\/[0-9]+)/)?.[1] || ''}: ${added} 篇`);
    /* 上一期链接 */
    const prev = html.match(/href="(https?:\/\/[^"]*\/article\/[0-9]+\/[0-9]+)"[^>]*>[\s\S]{0,30}?上一期/);
    url = prev ? prev[1] : null;
    if (!url) break;
  }
  return out;
}

/* ============ DeepSeek AI ============ */
async function aiChat(system, user, maxTokens = 8000) {
  if (!API_KEY) throw new Error('DEEPSEEK_API_KEY 未配置');
  const r = await fetch(`${API_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      temperature: 0.25,
      max_tokens: maxTokens
    })
  });
  if (!r.ok) throw new Error(`AI API HTTP ${r.status}`);
  const j = await r.json();
  return (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
}

function parseJsonObj(text) {
  let s = text.trim();
  s = s.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = s.indexOf('{'), end = s.lastIndexOf('}');
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  try { return JSON.parse(s); } catch { return null; }
}

const SYS_ANALYZE = `你是石油化工与油气地质领域的资深学术审稿专家。用户会给你一批论文(标题+摘要),请对每篇输出分析。

输出严格 JSON(不要任何多余文字),格式:
{"list":[{"i":1,"brief":"60-100字中文导读","location":"onshore|offshore|both|na","depth":"shallow|deep|na","tags":["标签1","标签2","标签3"]}]}

分类规则(油气勘探开发类论文必须给出明确判断):
- location: 涉及海洋/海上/深海/浅海/浮式/水下/海相沉积/大陆架 → offshore;涉及陆上/陆相/盆地/沙漠/山地/丘陵/陆源 → onshore;两者都涉及 → both;论文完全不涉及油气储层/勘探开发(如通用化工、材料、教育类)→ na
- depth: 涉及深层/超深层/深部/高温高压/深层油气/深埋 → deep;涉及浅层/中浅层/浅部/近地表/浅埋 → shallow;无法判断或与深度无关 → na
- brief 用中文,客观概括研究对象、方法与发现;tags 给出 2-3 个研究领域标签(如"致密砂岩""超压预测""CO2捕集")`;

const SYS_INSIGHTS = `你是石油化工与油气地质领域的学术主编。用户会给你当期论文清单,请输出:
{"hotspots":["热点1","热点2","热点3"],"overview":"80-120字当期总体学术动态点评","highlight":"本期最值得关注的论文及其理由(50-80字)"}
严格输出 JSON,不要多余文字。`;

/* ---------- 主流程 ---------- */
const SOURCES = [
  {
    id: 'hgxb', name: '化工学报', en: 'CIESC Journal', issn: '0438-1157', kind: 'founderss',
    home: 'https://www.hgxb.com.cn/zh/home/',
    articleBase: 'https://www.hgxb.com.cn/zh/article/'
  },
  {
    id: 'sysydz', name: '石油实验地质', en: 'Petroleum Geology & Experiment', issn: '1001-6112', kind: 'sysydz',
    base: 'https://www.sysydz.net',
    currentUrl: 'https://www.sysydz.net/cn/article/current'
  }
];

const prevData = existsSync(OUT) ? (() => { try { return JSON.parse(readFileSync(OUT, 'utf8')); } catch { return null; } })() : null;

const articles = [];
const sourcesMeta = [];
let crawlErr = null;

for (const src of SOURCES) {
  try {
    const list = src.kind === 'founderss' ? await crawlFounderss(src) : await crawlSysydz(src);
    articles.push(...list);
    sourcesMeta.push({ id: src.id, name: src.name, en: src.en, issn: src.issn, count: list.length });
    console.log(`[crawl] ${src.name}: 共 ${list.length} 篇`);
  } catch (e) {
    console.error(`[crawl] ${src.name} 失败: ${e.message}`);
    crawlErr = (crawlErr ? crawlErr + '; ' : '') + `${src.name}: ${e.message}`;
  }
}

/* AI 分析 */
let aiMap = null;
let insights = null;
if (articles.length) {
  try {
    const aiResults = [];
    for (let i = 0; i < articles.length; i += BATCH_SIZE) {
      const batch = articles.slice(i, i + BATCH_SIZE);
      const list = batch.map((a, j) =>
        `${j + 1}. 《${a.title}》${a.abstract ? ` 摘要:${a.abstract.slice(0, 100)}` : ''}`).join('\n');
      const out = parseJsonObj(await aiChat(SYS_ANALYZE, `论文列表:\n${list}`));
      if (out && Array.isArray(out.list)) {
        for (const item of out.list) {
          const a = batch[item.i - 1];
          if (a && typeof item.i === 'number') {
            aiResults.push({ idx: i + item.i - 1, brief: item.brief, location: item.location, depth: item.depth, tags: item.tags });
          }
        }
      }
      await new Promise(r => setTimeout(r, 300));
      console.log(`[ai] 批次 ${i / BATCH_SIZE + 1}/${Math.ceil(articles.length / BATCH_SIZE)} 完成`);
    }
    aiMap = Object.fromEntries(aiResults.map(r => [r.idx, r]));
    const titles = articles.map((a, i) => `${i + 1}. 《${a.title}》`).join('\n');
    insights = parseJsonObj(await aiChat(SYS_INSIGHTS, `本期论文清单:\n${titles}`));
    insights.generated_at = new Date().toISOString();
    console.log(`[ai] 洞察完成,热点 ${(insights.hotspots || []).length} 个`);
  } catch (e) {
    console.error(`[ai] 分析失败: ${e.message}`);
  }
}

/* 组装 */
const payload = {
  updated_at: new Date().toISOString(),
  sources: sourcesMeta,
  crawl_note: crawlErr ? `部分期刊源暂不可用: ${crawlErr}` : null,
  articles: articles.map((a, i) => ({ ...a, ai: aiMap ? aiMap[i] : null })),
  insights
};

mkdirSync(join(ROOT, 'data'), { recursive: true });
const prev = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
const next = JSON.stringify(payload);
if (prev === next) {
  console.log('[no-change] 数据无变化,跳过提交');
} else {
  writeFileSync(OUT, next);
  console.log(`[written] ${OUT} — ${articles.length} 篇论文, ${Object.keys(aiMap || {}).length} 篇有AI分析`);
}
