'use strict';

/**
 * phone2pc — 폰에서 찍은 사진을 QR 한 번으로 PC로 옮기는 웹앱.
 *
 * Cloud Run에서 돌아가는 것을 전제로 한다. 사진은 어디에도 저장하지 않고
 * 서버 메모리에 잠시 들고 있다가 PC가 가져가면 버린다.
 *
 * 로컬에서 그냥 `node server.js` 로 띄우면 같은 와이파이 안에서도 그대로 쓸 수 있다.
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const { writeZip } = require('./src/zip');
const I18N_STR = require('./public/i18n-strings.js');

const PORT = Number(process.env.PORT) || 8080;
const PUBLIC_DIR = path.join(__dirname, 'public');

// 검색엔진에 알리는 공식 주소. 다른 도메인에 올릴 일이 있으면 이 값만 바꾸면 된다.
const SITE_ORIGIN = (process.env.SITE_ORIGIN || 'https://phone2pc.iuser.kr').replace(/\/$/, '');

// Cloud Run이 자동으로 넣어주는 값. 있으면 클라우드, 없으면 로컬로 본다.
const IS_CLOUD = Boolean(process.env.K_SERVICE);

const MB = 1024 * 1024;
const MAX_FILE_BYTES = Number(process.env.MAX_FILE_MB || 20) * MB;
const MAX_SESSION_BYTES = Number(process.env.MAX_SESSION_MB || 80) * MB;
const MAX_TOTAL_BYTES = Number(process.env.MAX_TOTAL_MB || 320) * MB;  // 컨테이너 메모리 대비 여유분
const MAX_ITEMS_PER_SESSION = Number(process.env.MAX_ITEMS || 40);
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MIN || 30) * 60 * 1000;

const ID_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';  // 헷갈리는 글자(i, l, o, 0, 1) 제외

const EXT_BY_MIME = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif',
  'image/webp': '.webp', 'image/heic': '.heic', 'image/heif': '.heif',
  'video/mp4': '.mp4', 'video/quicktime': '.mov', 'application/pdf': '.pdf'
};

// 일부 안드로이드 브라우저는 형식을 안 알려준다. 확장자로 되짚어 썸네일이 뜨게 한다.
const MIME_BY_EXT = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
  '.webp': 'image/webp', '.heic': 'image/heic', '.heif': 'image/heif', '.bmp': 'image/bmp',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.m4v': 'video/mp4', '.pdf': 'application/pdf'
};

// ---------------------------------------------------------------- 세션 저장소

/**
 * 세션은 전부 메모리에만 있다. 컨테이너가 교체되면 사라진다.
 * 그래서 Cloud Run 서비스는 반드시 --max-instances=1 로 배포해야 한다.
 * (폰과 PC는 서로 다른 클라이언트라 세션 어피니티로는 같은 인스턴스가 보장되지 않는다.)
 */
const sessions = new Map();
let totalBytes = 0;

function randomId(len) {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
  return out;
}

function createSession() {
  let id;
  do { id = randomId(12); } while (sessions.has(id));
  const session = {
    id,
    createdAt: Date.now(),
    lastSeen: Date.now(),
    phoneSeen: false,
    items: [],
    bytes: 0
  };
  sessions.set(id, session);
  return session;
}

function dropSession(session) {
  if (!sessions.delete(session.id)) return;
  totalBytes -= session.bytes;
  session.items.length = 0;
  session.bytes = 0;
}

/** 전체 메모리가 상한에 닿으면 오래 안 쓴 세션부터 버린다. */
function makeRoom(incoming) {
  if (totalBytes + incoming <= MAX_TOTAL_BYTES) return true;
  const byAge = [...sessions.values()].sort((a, b) => a.lastSeen - b.lastSeen);
  for (const session of byAge) {
    if (totalBytes + incoming <= MAX_TOTAL_BYTES) break;
    if (session.bytes === 0) continue;
    dropSession(session);
  }
  return totalBytes + incoming <= MAX_TOTAL_BYTES;
}

setInterval(() => {
  const now = Date.now();
  for (const session of [...sessions.values()]) {
    if (now - session.lastSeen > SESSION_TTL_MS) dropSession(session);
  }
}, 60 * 1000).unref();

// ------------------------------------------------------------------ 유틸리티

function lanAddresses() {
  const result = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const info of ifaces[name] || []) {
      if (info.family !== 'IPv4' && info.family !== 4) continue;
      if (info.internal) continue;
      result.push({ name, address: info.address });
    }
  }
  const rank = (ip) => {
    if (ip.startsWith('192.168.')) return 0;
    if (ip.startsWith('10.')) return 1;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 2;
    if (ip.startsWith('169.254.')) return 9;  // 링크 로컬은 사실상 연결 불가
    return 3;
  };
  result.sort((a, b) => rank(a.address) - rank(b.address));
  return result;
}

function safeName(raw) {
  const base = String(raw || '').split(/[\\/]/).pop();
  const cleaned = base.replace(/[\x00-\x1f<>:"|?*]/g, '_').replace(/^\.+/, '').trim();
  return cleaned.slice(0, 180) || 'file';
}

function publicMeta(item) {
  return { id: item.id, name: item.name, type: item.type, size: item.size, at: item.at };
}

// --------------------------------------------------------------------- 라우팅

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);  // Firebase Hosting / Cloud Run 앞단 프록시

// 정적 파일. Firebase Hosting을 앞에 두면 이 경로들은 CDN이 먼저 응답한다.
app.use(express.static(PUBLIC_DIR, {
  maxAge: IS_CLOUD ? '1h' : 0,
  index: false
}));

app.get('/healthz', (req, res) => res.type('text').send('ok'));

// ------------------------------------------------------------------ 배너 설정

// banners.json 한 파일이 하단 광고의 유일한 설정 출처다. 환경변수가 있으면 그쪽이 이긴다.
function loadBanners() {
  let config = { adsense: {}, naver: { items: [] } };
  try {
    config = JSON.parse(fs.readFileSync(path.join(__dirname, 'banners.json'), 'utf8'));
  } catch (err) {
    console.warn('banners.json을 읽지 못했습니다:', err.message);
  }
  config.adsense = config.adsense || {};
  if (process.env.ADSENSE_CLIENT) config.adsense.client = process.env.ADSENSE_CLIENT;
  if (process.env.ADSENSE_SLOT_DESKTOP) config.adsense.slotDesktop = process.env.ADSENSE_SLOT_DESKTOP;
  if (process.env.ADSENSE_SLOT_MOBILE) config.adsense.slotMobile = process.env.ADSENSE_SLOT_MOBILE;
  return config;
}

// 운영 중에는 매 요청 파일을 읽지 않도록 한 번만 읽어 둔다
let bannersCache = loadBanners();
if (!IS_CLOUD) {
  // 로컬에서는 파일을 고칠 때마다 새로고침만 하면 반영되도록 매번 읽는다
  app.get('/api/ads', (req, res) => res.json(loadBanners()));
} else {
  app.get('/api/ads', (req, res) => {
    res.set('Cache-Control', 'public, max-age=600');
    res.json(bannersCache);
  });
}

// AdSense가 소유권 확인에 쓰는 파일. 도메인 루트에서 열려야 한다.
app.get('/ads.txt', (req, res) => {
  const client = (IS_CLOUD ? bannersCache : loadBanners()).adsense.client || '';
  const pubId = client.replace(/^ca-/, '');   // ca-pub-123... → pub-123...
  res.type('text');
  if (!pubId) return res.send('# AdSense 승인 후 banners.json의 adsense.client를 채우면 자동으로 채워집니다\n');
  res.send(`google.com, ${pubId}, DIRECT, f08c47fec0942fa0\n`);
});

// ------------------------------------------------------------------ 화면 언어

/**
 * HTML을 언어에 맞춰 만들어 내려준다.
 *
 * 예전에는 한국어 HTML을 내려보내고 브라우저가 표준시간대를 보고 영어로 바꿔 끼웠다.
 * 그런데 구글 크롤러는 UTC로 페이지를 렌더링하므로 국내용 주소인데도 영어판이 색인되는
 * 문제가 있었다. 그래서 언어 판정을 서버로 옮기고, 언어마다 고정 주소(/ko, /en)를 따로 둔다.
 * 검색엔진에는 그 두 주소를 hreflang으로 짝지어 알려주고, 사람이 도메인만 치고 들어오는
 * '/' 에서는 Accept-Language를 보고 골라 준다.
 */

/** Accept-Language 헤더에서 화면 언어를 고른다. */
function preferredLang(header) {
  // 크롤러 상당수는 이 헤더를 보내지 않는다. 본진이 한국이므로 그때는 한국어다.
  if (!header) return 'ko';

  const tags = String(header)
    .split(',')
    .map((part) => {
      const bits = part.trim().split(';');
      const q = bits.slice(1).map((b) => b.trim()).find((b) => b.startsWith('q='));
      return { tag: bits[0].trim().toLowerCase(), q: q ? Number(q.slice(2)) : 1 };
    })
    .filter((item) => item.tag && !Number.isNaN(item.q) && item.q > 0)
    .sort((a, b) => b.q - a.q);

  for (const { tag } of tags) {
    if (tag === '*' || tag.startsWith('ko')) return 'ko';
    if (tag.startsWith('en')) return 'en';
  }
  // 한국어도 영어도 아닌 사람에게는 영어가 낫다
  return tags.length ? 'en' : 'ko';
}

/** ?lang= 이 가장 세다. 국내에서 국외 화면을 확인할 때 쓴다. */
function langFor(req) {
  const forced = String(req.query.lang || '');
  if (forced === 'ko' || forced === 'en') return forced;
  return preferredLang(req.headers['accept-language']);
}

function hreflangTags() {
  return [
    '<link rel="alternate" hreflang="ko" href="' + SITE_ORIGIN + '/ko">',
    '<link rel="alternate" hreflang="en" href="' + SITE_ORIGIN + '/en">',
    '<link rel="alternate" hreflang="x-default" href="' + SITE_ORIGIN + '/">'
  ].join('\n');
}

/**
 * 파일에 박힌 한국어를 영어로 바꿔 끼운다.
 *
 * 문구가 '통째로' 같을 때만 바꾼다. 표에는 '사진'처럼 짧은 낱말도 있어서, 그냥 이어붙여
 * 치환하면 '휴대폰 사진을 PC로'가 '휴대폰 photo을 PC로'처럼 문장 속이 갉아먹힌다.
 */
function escapeRe(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const KO_TO_EN = new Map();
const EN_RULES = [];

for (const key of Object.keys(I18N_STR)) {
  const entry = I18N_STR[key];
  if (!entry || !entry.ko || !entry.en || entry.ko === entry.en) continue;
  KO_TO_EN.set(entry.ko, entry.en);

  const k = escapeRe(key);
  const ko = escapeRe(entry.ko);
  // 요소 안의 글: <p data-i18n="d.step">...</p>
  EN_RULES.push({
    re: new RegExp('(data-i18n(?:-html)?="' + k + '"[^>]*>\\s*)' + ko + '(\\s*<)', 'g'),
    en: entry.en
  });
  // title 속성: <button data-i18n-title="d.copyUrlTitle" title="...">
  EN_RULES.push({
    re: new RegExp('(data-i18n-title="' + k + '"[^>]*title=")' + ko + '(")', 'g'),
    en: entry.en
  });
}

function swapWhole(value) {
  return KO_TO_EN.has(value) ? KO_TO_EN.get(value) : value;
}

function toEnglish(html) {
  for (const rule of EN_RULES) {
    html = html.replace(rule.re, (whole, before, after) => before + rule.en + after);
  }
  // 머리 태그와 구조화 데이터. 값이 표의 한국어와 통째로 같을 때만 바꾼다.
  html = html.replace(/<title>([^<]*)<\/title>/g, (whole, value) => '<title>' + swapWhole(value) + '</title>');
  html = html.replace(/(content=")([^"]*)(")/g, (whole, a, value, b) => a + swapWhole(value) + b);
  html = html.replace(/("description":\s*")([^"]*)(")/g, (whole, a, value, b) => a + swapWhole(value) + b);
  return html;
}

function checkTranslations(file) {
  const html = fs.readFileSync(path.join(PUBLIC_DIR, file), 'utf8');
  const keys = new Set();
  const re = /data-i18n(?:-html|-title)?="([^"]+)"/g;
  let found;
  while ((found = re.exec(html))) keys.add(found[1]);

  const broken = [...keys].filter((key) => !I18N_STR[key] || html.indexOf(I18N_STR[key].ko) === -1);
  if (broken.length) {
    console.warn(file + ': 문구표(public/i18n-strings.js)와 맞지 않아 영어로 바뀌지 않습니다 — ' + broken.join(', '));
  }
}
['desktop.html', 'mobile.html'].forEach(checkTranslations);

function renderPage(file, lang, canonicalPath) {
  let html = fs.readFileSync(path.join(PUBLIC_DIR, file), 'utf8');

  if (lang === 'en') html = toEnglish(html);

  html = html.replace('<html lang="ko">', '<html lang="' + lang + '" data-lang-source="server">');

  // 공유 카드의 언어 표시도 같이 맞춘다 (문구표에 없는 값이라 따로 바꾼다)
  if (lang === 'en') {
    html = html
      .replace('<meta property="og:locale" content="ko_KR">', '<meta property="og:locale" content="en_US">')
      .replace('<meta property="og:locale:alternate" content="en_US">', '<meta property="og:locale:alternate" content="ko_KR">');
  }
  html = html.split('https://phone2pc.iuser.kr').join(SITE_ORIGIN);

  // 색인시킬 주소는 언어별 고정 주소다. '/' 는 방금 내보낸 언어 쪽을 가리킨다.
  const canonical = SITE_ORIGIN + canonicalPath;
  html = html.replace(
    '<link rel="canonical" href="' + SITE_ORIGIN + '/">',
    '<link rel="canonical" href="' + canonical + '">\n' + hreflangTags()
  );
  html = html.replace(
    '<meta property="og:url" content="' + SITE_ORIGIN + '/">',
    '<meta property="og:url" content="' + canonical + '">'
  );
  return html;
}

// 클라우드에서는 요청마다 파일을 읽지 않도록 미리 만들어 둔다
const pageCache = new Map();
function page(file, lang, canonicalPath) {
  const key = file + '|' + lang + '|' + canonicalPath;
  if (!IS_CLOUD) return renderPage(file, lang, canonicalPath);   // 로컬에서는 고치면 바로 보이게
  if (!pageCache.has(key)) pageCache.set(key, renderPage(file, lang, canonicalPath));
  return pageCache.get(key);
}

function sendPage(res, html, cache) {
  res.set('Cache-Control', cache);
  res.type('html').send(html);
}

// 도메인만 치고 들어온 사람. 언어를 헤더로 고르므로 CDN이 한 벌을 공유하면 안 된다.
app.get('/', (req, res) => {
  const lang = langFor(req);
  res.set('Vary', 'Accept-Language');
  sendPage(res, page('desktop.html', lang, '/' + lang), 'private, no-store');
});

// 언어별 고정 주소. 검색엔진과 공유 링크는 이쪽을 쓴다.
app.get('/ko', (req, res) => sendPage(res, page('desktop.html', 'ko', '/ko'), 'public, max-age=300'));
app.get('/en', (req, res) => sendPage(res, page('desktop.html', 'en', '/en'), 'public, max-age=300'));

// 폰 화면. 1회용 주소라 색인 대상이 아니고, 캐시에 남아서도 안 된다.
app.get('/s/:id', (req, res) => {
  const lang = langFor(req);
  res.set('Vary', 'Accept-Language');
  sendPage(res, page('mobile.html', lang, '/'), 'private, no-store');
});

// 접속 주소 정보. 클라우드에서는 브라우저가 자기 origin을 쓰므로 hosts가 비어 있다.
app.get('/api/net', (req, res) => {
  if (IS_CLOUD) return res.json({ mode: 'cloud', hosts: [], port: null, suggested: null });
  const hosts = lanAddresses();
  res.json({
    mode: 'local',
    hosts,
    port: PORT,
    suggested: process.env.HOST_IP || (hosts[0] && hosts[0].address) || 'localhost'
  });
});

app.post('/api/session', (req, res) => {
  const session = createSession();
  res.json({ id: session.id });
});

// 세션을 찾아 lastSeen을 갱신한다. 없으면 404를 내고 null을 돌려준다.
function requireSession(req, res) {
  const session = sessions.get(String(req.params.id || ''));
  if (!session) {
    res.status(404).json({
      error: '세션이 없습니다. PC 화면에서 QR을 다시 만들어 주세요.',
      error_en: 'This session is gone. Create a new QR code on your PC.'
    });
    return null;
  }
  session.lastSeen = Date.now();
  return session;
}

// PC가 주기적으로 호출한다. 사진 자체는 넣지 않고 목록만 돌려준다.
app.get('/api/poll/:id', (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  res.set('Cache-Control', 'no-store');
  res.json({
    ok: true,
    phoneSeen: session.phoneSeen,
    items: session.items.map(publicMeta)
  });
});

app.post('/api/hello/:id', (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  session.phoneSeen = true;
  res.json({ ok: true });
});

// 폰이 사진을 올린다. base64가 아니라 raw 바이트로 받는다(용량 33% 절약).
app.post('/api/upload/:id',
  express.raw({ type: () => true, limit: MAX_FILE_BYTES }),
  (req, res) => {
    const session = requireSession(req, res);
    if (!session) return;

    const data = req.body;
    if (!Buffer.isBuffer(data) || data.length === 0) {
      return res.status(400).json({
        error: '사진 데이터가 비어 있습니다.',
        error_en: 'The photo data was empty.'
      });
    }
    if (session.items.length >= MAX_ITEMS_PER_SESSION) {
      return res.status(409).json({
        error: `한 세션에 최대 ${MAX_ITEMS_PER_SESSION}장까지 보낼 수 있습니다.`,
        error_en: `A session can hold up to ${MAX_ITEMS_PER_SESSION} files.`
      });
    }
    if (session.bytes + data.length > MAX_SESSION_BYTES) {
      return res.status(409).json({
        error: `세션 용량 한도(${Math.round(MAX_SESSION_BYTES / MB)}MB)를 넘었습니다. PC에서 저장한 뒤 비워 주세요.`,
        error_en: `Session limit (${Math.round(MAX_SESSION_BYTES / MB)}MB) reached. Save the files on your PC, then clear them.`
      });
    }
    if (!makeRoom(data.length)) {
      return res.status(503).json({
        error: '서버가 혼잡합니다. 잠시 뒤 다시 시도해 주세요.',
        error_en: 'The server is busy. Please try again in a moment.'
      });
    }

    const rawName = req.get('x-filename') ? decodeURIComponent(req.get('x-filename')) : '';
    const name = safeName(rawName);
    const declaredType = String(req.get('content-type') || '').split(';')[0].trim();
    const ext = path.extname(name).toLowerCase().slice(0, 12) || EXT_BY_MIME[declaredType] || '';
    const type = (declaredType && declaredType !== 'application/octet-stream')
      ? declaredType
      : (MIME_BY_EXT[ext] || 'application/octet-stream');

    const item = { id: randomId(14), name, type, size: data.length, at: Date.now(), data };
    session.items.push(item);
    session.bytes += data.length;
    totalBytes += data.length;
    session.phoneSeen = true;

    res.json({ ok: true, file: publicMeta(item) });
  });

app.get('/api/file/:id/:fileId', (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  const item = session.items.find((f) => f.id === req.params.fileId);
  if (!item) return res.status(404).json({ error: '파일을 찾을 수 없습니다.', error_en: 'File not found.' });

  if (req.query.dl === '1') {
    const ascii = item.name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
    res.set('Content-Disposition',
      `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(item.name)}`);
    res.set('Cache-Control', 'no-store');
  } else {
    res.set('Cache-Control', 'private, max-age=300');
  }
  res.type(item.type).send(item.data);
});

app.delete('/api/file/:id/:fileId', (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  const index = session.items.findIndex((f) => f.id === req.params.fileId);
  if (index === -1) return res.status(404).json({ error: '파일을 찾을 수 없습니다.', error_en: 'File not found.' });
  const [item] = session.items.splice(index, 1);
  session.bytes -= item.size;
  totalBytes -= item.size;
  res.json({ ok: true });
});

app.post('/api/clear/:id', (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  const removed = session.items.length;
  totalBytes -= session.bytes;
  session.items.length = 0;
  session.bytes = 0;
  res.json({ ok: true, removed });
});

app.get('/api/zip/:id', async (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  if (session.items.length === 0) {
    return res.status(400).json({ error: '받은 파일이 없습니다.', error_en: 'No files received yet.' });
  }

  const stamp = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const zipName = `phone2pc-${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}` +
    `-${pad(stamp.getHours())}${pad(stamp.getMinutes())}.zip`;

  res.writeHead(200, {
    'Content-Type': 'application/zip',
    'Cache-Control': 'no-store',
    'Content-Disposition': `attachment; filename="${zipName}"`
  });

  try {
    await writeZip(res, session.items.map((f) => ({ data: f.data, name: f.name, mtime: new Date(f.at) })));
    res.end();
  } catch (err) {
    console.error('ZIP 생성 실패:', err);
    res.destroy();
  }
});

app.use('/api', (req, res) => res.status(404).json({ error: '없는 경로입니다.', error_en: 'No such endpoint.' }));

// 라우트에서 던진 오류를 사람이 읽을 수 있는 메시지로 바꿔준다. 반드시 맨 뒤에 있어야 한다.
app.use((err, req, res, next) => {
  if (err && (err.type === 'entity.too.large' || err.status === 413)) {
    return res.status(413).json({
      error: `파일이 너무 큽니다 (최대 ${Math.round(MAX_FILE_BYTES / MB)}MB). 폰에서 원본 화질을 꺼 주세요.`,
      error_en: `That file is too large (max ${Math.round(MAX_FILE_BYTES / MB)}MB). Turn off original quality on your phone.`
    });
  }
  console.error('요청 처리 중 오류:', err);
  if (!res.headersSent) res.status(500).json({ error: '서버 오류', error_en: 'Server error' });
});

// -------------------------------------------------------------------- 시작

const server = app.listen(PORT, '0.0.0.0', () => {
  if (IS_CLOUD) {
    console.log(`phone2pc listening on ${PORT} (service=${process.env.K_SERVICE}, revision=${process.env.K_REVISION})`);
    return;
  }
  const hosts = lanAddresses();
  console.log('');
  console.log('  phone2pc 실행 중 — 폰에서 찍은 사진을 PC로');
  console.log('  ─────────────────────────────────────────');
  console.log(`  이 PC에서 열기 :  http://localhost:${PORT}`);
  for (const host of hosts) {
    console.log(`  같은 와이파이  :  http://${host.address}:${PORT}   (${host.name})`);
  }
  if (hosts.length === 0) {
    console.log('  경고: 외부에서 접속 가능한 IP를 찾지 못했습니다. 와이파이 연결을 확인하세요.');
  }
  console.log('  ─────────────────────────────────────────');
  console.log('  종료하려면 Ctrl+C');
  console.log('');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  ${PORT}번 포트를 이미 다른 프로그램이 쓰고 있습니다.`);
    console.error('  다른 포트로 실행하세요:  set PORT=8081 && node server.js\n');
    process.exit(1);
  }
  throw err;
});

// Cloud Run은 컨테이너를 종료할 때 SIGTERM을 보낸다. 진행 중인 응답을 마저 내보낸다.
function shutdown(signal) {
  console.log(`${signal} 수신 — 종료합니다.`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 8000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
