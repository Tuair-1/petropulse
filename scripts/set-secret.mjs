/* ============================================================
 * set-secret.mjs — 将 DeepSeek API Key 存入 GitHub Actions Secret(加密)
 * 用法: DEEPSEEK_API_KEY=<key> node scripts/set-secret.mjs [repo]
 * key 值仅通过加密通道传输,绝不落盘、绝不打印。
 * ============================================================ */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const TOKEN = process.env.GH_TOKEN || '';
const REPO = process.argv[2] || 'Tuair-1/petropulse';
const KEY = process.env.DEEPSEEK_API_KEY || '';

if (!TOKEN || !KEY) {
  console.error('需要 GH_TOKEN 与 DEEPSEEK_API_KEY 环境变量');
  process.exit(1);
}

const sodium = require('libsodium-wrappers');
await sodium.ready;

const headers = {
  Authorization: `Bearer ${TOKEN}`,
  'User-Agent': 'claude-code-deploy',
  Accept: 'application/vnd.github+json'
};

/* 1. 获取仓库公钥 */
const keyResp = await fetch(`https://api.github.com/repos/${REPO}/actions/secrets/public-key`, { headers });
const pk = await keyResp.json();
if (!pk.key_id) { console.error('获取公钥失败:', JSON.stringify(pk)); process.exit(1); }

/* 2. 加密 secret 值(注意: seal 返回 Uint8Array,必须经 Buffer 再 base64) */
const encrypted = Buffer.from(
  sodium.crypto_box_seal(Buffer.from(KEY, 'utf8'), Buffer.from(pk.key, 'base64'))
).toString('base64');

/* 3. 写入 secret */
const resp = await fetch(`https://api.github.com/repos/${REPO}/actions/secrets/DEEPSEEK_API_KEY`, {
  method: 'PUT',
  headers: { ...headers, 'Content-Type': 'application/json' },
  body: JSON.stringify({ encrypted_value: encrypted, key_id: pk.key_id })
});

console.log(`PUT secret => HTTP ${resp.status}${resp.status === 201 ? ' (已创建)' : resp.status === 204 ? ' (已更新)' : ''}`);
