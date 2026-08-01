/* ============================================================
 * ai.js — DeepSeek V4 Flash[1M] 前端封装(直连模式)
 *
 * ⚠️ 安全说明:纯静态托管无法隐藏前端密钥,当前为直连模式,
 *    API Key 会出现在网页源码中。仅供学习测试;正式使用请:
 *    1. 在 DeepSeek 后台删除/轮换此 Key,或设置消费限额;
 *    2. 后续可接入 Cloudflare Worker 等服务端代理转发。
 * 用户可在任意页面通过 window.PP_AI.setKey() 替换为自己的 Key
 * (保存在浏览器 localStorage,优先于内置 Key)。
 * ============================================================ */
window.PP_AI = (() => {
  const BASE = 'https://api.deepseek.com';
  const MODEL = 'deepseek-v4-flash'; // DeepSeek V4 Flash[1M](官方模型 ID)
  const DEFAULT_KEY = 'sk-8816a160d58543009da612f419369389';

  const getKey = () => localStorage.getItem('pp_ai_key') || DEFAULT_KEY;
  const setKey = k => localStorage.setItem('pp_ai_key', k.trim());
  const isCustom = () => !!localStorage.getItem('pp_ai_key');

  /* 非流式对话 */
  async function chat(messages, { maxTokens = 4096, temperature = 0.4 } = {}) {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getKey()}` },
      body: JSON.stringify({ model: MODEL, messages, max_tokens: maxTokens, temperature })
    });
    if (!res.ok) throw new Error(`API 请求失败 (HTTP ${res.status}),请检查 Key 或额度`);
    const j = await res.json();
    const msg = j.choices && j.choices[0] && j.choices[0].message;
    return { text: (msg && msg.content) || '', reasoning: (msg && msg.reasoning_content) || '' };
  }

  /* 流式对话:onDelta(内容增量), onReasoning(思考增量) */
  async function chatStream(messages, { maxTokens = 4096, temperature = 0.4, onDelta, onReasoning, onDone } = {}) {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getKey()}` },
      body: JSON.stringify({ model: MODEL, messages, max_tokens: maxTokens, temperature, stream: true })
    });
    if (!res.ok) throw new Error(`API 请求失败 (HTTP ${res.status}),请检查 Key 或额度`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const d = t.slice(5).trim();
        if (!d || d === '[DONE]') continue;
        try {
          const j = JSON.parse(d);
          const ch = j.choices && j.choices[0];
          if (!ch) continue;
          if (ch.delta.reasoning_content && onReasoning) onReasoning(ch.delta.reasoning_content);
          if (ch.delta.content && onDelta) onDelta(ch.delta.content);
        } catch { /* 忽略不完整行 */ }
      }
    }
    if (onDone) onDone();
  }

  return { BASE, MODEL, getKey, setKey, isCustom, chat, chatStream };
})();
