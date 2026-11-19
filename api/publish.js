// Vercel serverless function: commits articles.json + images/*.webp to GitHub, which triggers a Vercel redeploy.
// Env vars (Vercel > Settings > Environment Variables): ADMIN_PASSCODE, GITHUB_TOKEN, GITHUB_REPO (owner/repo), GITHUB_BRANCH (default main)
const crypto = require('crypto');
const eq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { ADMIN_PASSCODE: PW, GITHUB_TOKEN: T, GITHUB_REPO: R, GITHUB_BRANCH: B = 'main' } = process.env;
  if (!PW) return res.status(500).json({ error: 'ADMIN_PASSCODE is not set on the server' });
  const b = req.body || {};
  if (!eq(b.passcode || '', PW)) return res.status(401).json({ error: 'Wrong passcode' });
  if (b.action === 'auth') return res.status(200).json({ ok: true });
  if (!T || !R) return res.status(500).json({ error: 'GITHUB_TOKEN / GITHUB_REPO not set' });
  try { JSON.parse(b.json); } catch (e) { return res.status(400).json({ error: 'Invalid JSON' }); }
  const files = [{ path: 'articles.json', content: Buffer.from(b.json, 'utf8').toString('base64') }];
  for (const f of b.files || []) {
    if (!/^images\/[a-z0-9_-]+\.webp$/i.test(f.path)) return res.status(400).json({ error: 'Bad path ' + f.path });
    files.push({ path: f.path, content: f.b64 });
  }
  const gh = async (p, m = 'GET', body) => {
    const r = await fetch('https://api.github.com/repos/' + R + p, { method: m, headers: { Authorization: 'Bearer ' + T, Accept: 'application/vnd.github+json', 'User-Agent': 'barz-cms', 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
    const j = await r.json(); if (!r.ok) throw new Error(j.message || r.status); return j;
  };
  try {
    const ref = await gh('/git/ref/heads/' + B), parent = ref.object.sha, c = await gh('/git/commits/' + parent);
    const tree = await Promise.all(files.map(async f => ({ path: f.path, mode: '100644', type: 'blob', sha: (await gh('/git/blobs', 'POST', { content: f.content, encoding: 'base64' })).sha })));
    const t = await gh('/git/trees', 'POST', { base_tree: c.tree.sha, tree });
    const nc = await gh('/git/commits', 'POST', { message: 'CMS publish ' + new Date().toISOString(), tree: t.sha, parents: [parent] });
    await gh('/git/refs/heads/' + B, 'PATCH', { sha: nc.sha });
    res.status(200).json({ ok: true, commit: nc.sha });
  } catch (e) { res.status(500).json({ error: e.message }); }
};
module.exports.config = { api: { bodyParser: { sizeLimit: '4.5mb' } } };
