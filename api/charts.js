// Vercel serverless function: /api/charts
// Reads public music charts so the studio's Chart Generator can analyze them.
// Setup in Vercel: ADMIN_PASSCODE (already set for publishing) and YOUTUBE_API_KEY (free, from Google Cloud: enable "YouTube Data API v3").
const BASKET = ['us', 'gb', 'ng', 'za', 'br', 'in', 'de', 'fr'];
const NAMES = { ke: 'Kenya', us: 'United States', gb: 'United Kingdom', ng: 'Nigeria', za: 'South Africa', br: 'Brazil', in: 'India', de: 'Germany', fr: 'France' };

async function jf(url, ms = 8000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'user-agent': 'BarzDailyCharts/1.0' } });
    if (!r.ok) {
      let m = '';
      try { m = ((await r.json()).error || {}).message || ''; } catch (e) {}
      throw new Error('HTTP ' + r.status + (m ? ': ' + m : ''));
    }
    return await r.json();
  } finally { clearTimeout(t); }
}

async function apple(cc) {
  const j = await jf(`https://rss.applemarketingtools.com/api/v2/${cc}/music/most-played/50/songs.json`);
  return ((j.feed && j.feed.results) || []).map((x, i) => ({
    rank: i + 1, title: x.name, artist: x.artistName,
    genres: (x.genres || []).map(g => g.name).filter(g => g && g !== 'Music'),
    img: (x.artworkUrl100 || '').replace('100x100', '300x300'), url: x.url
  }));
}

async function youtube(cc) {
  const key = process.env.YOUTUBE_API_KEY;
  const j = await jf(`https://www.googleapis.com/youtube/v3/videos?part=snippet&chart=mostPopular&videoCategoryId=10&regionCode=${cc.toUpperCase()}&maxResults=50&key=${key}`);
  return (j.items || []).map((x, i) => {
    const s = x.snippet || {};
    let title = s.title || '';
    let artist = (s.channelTitle || '').replace(/\s*-\s*Topic$|VEVO$/i, '').trim();
    const m = title.split(/\s+[-–—]\s+/);
    if (m.length >= 2) { artist = m[0].trim(); title = m.slice(1).join(' - ').trim(); }
    title = title.replace(/\s*[\(\[][^\)\]]*(official|video|audio|lyric|visuali)[^\)\]]*[\)\]]/gi, '').trim();
    const th = s.thumbnails || {};
    return { rank: i + 1, title, artist, yt: x.id, img: (th.medium || th.default || {}).url };
  });
}

async function deezer(name, fallbackGlobal) {
  const q = await jf(`https://api.deezer.com/search/playlist?q=${encodeURIComponent(name)}&limit=25`);
  const list = q.data || [];
  const want = name.toLowerCase();
  const pl = list.find(p => (p.title || '').toLowerCase() === want && /deezer/i.test((p.user && p.user.name) || '')) ||
             list.find(p => (p.title || '').toLowerCase() === want);
  let tracks;
  if (pl) tracks = (await jf(`https://api.deezer.com/playlist/${pl.id}/tracks?limit=50`)).data;
  else if (fallbackGlobal) tracks = (await jf('https://api.deezer.com/chart/0/tracks?limit=50')).data;
  else throw new Error(`Deezer has no "${name}" chart`);
  return (tracks || []).map((x, i) => ({
    rank: i + 1, title: x.title_short || x.title, artist: x.artist && x.artist.name,
    img: x.album && (x.album.cover_medium || x.album.cover), url: x.link
  }));
}

module.exports = async (req, res) => {
  res.setHeader('cache-control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
  b = b || {};
  if (!process.env.ADMIN_PASSCODE || b.passcode !== process.env.ADMIN_PASSCODE) return res.status(401).json({ error: 'Unauthorized' });

  const ke = b.chart !== 'global';
  const countries = ke ? ['ke'] : BASKET;
  const jobs = [];
  const add = (platform, id, label, fn) => jobs.push(
    fn().then(items => ({ id, platform, label, ok: items.length > 0, items, error: items.length ? '' : 'Empty chart' }))
        .catch(e => ({ id, platform, label, ok: false, items: [], error: String((e && e.message) || e) }))
  );
  countries.forEach(cc => {
    add('apple', 'apple:' + cc, 'Apple Music · ' + NAMES[cc], () => apple(cc));
    if (process.env.YOUTUBE_API_KEY) add('youtube', 'youtube:' + cc, 'YouTube · ' + NAMES[cc], () => youtube(cc));
  });
  if (!process.env.YOUTUBE_API_KEY) jobs.push(Promise.resolve({ id: 'youtube:none', platform: 'youtube', label: 'YouTube', ok: false, items: [], error: 'Add YOUTUBE_API_KEY in Vercel' }));
  add('deezer', 'deezer:' + (ke ? 'ke' : 'world'), ke ? 'Deezer · Kenya' : 'Deezer · Worldwide', () => deezer(ke ? 'Top Kenya' : 'Top Worldwide', !ke));

  res.status(200).json({ fetchedAt: Date.now(), chart: ke ? 'ke' : 'global', sources: await Promise.all(jobs) });
};
