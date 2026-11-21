export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { passcode, action, json, files = [] } = req.body || {};
  const expected = process.env.ADMIN_PASSCODE || 'BARZ2026';
  if (passcode !== expected) return res.status(401).json({ error: 'Wrong passcode' });
  if (action === 'auth') return res.status(200).json({ ok: true });

  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || 'main';
  if (!token || !repo) return res.status(500).json({ error: 'Missing env vars' });

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
  };

  async function saveFile(path, contentBase64, message) {
    const url = `https://api.github.com/repos/${repo}/contents/${path}`;
    let sha;
    const cur = await fetch(`${url}?ref=${branch}`, { headers });
    if (cur.ok) sha = (await cur.json()).sha;
    const put = await fetch(url, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ message, content: contentBase64, branch, ...(sha ? { sha } : {}) }),
    });
    if (!put.ok) throw new Error(await put.text());
  }

  try {
    for (const f of files) {
      if (f.path && f.b64) await saveFile(f.path, f.b64, `Add ${f.path}`);
    }
    if (json) await saveFile('articles.json', Buffer.from(json).toString('base64'), 'Update articles.json');
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
