'use strict';

// 데스크탑 화면: 세션을 만들고 QR을 그린 뒤, 폴링으로 도착한 파일을 보여준다.
// (SSE는 Firebase Hosting의 60초 요청 타임아웃에 걸려서 폴링을 쓴다.)

const el = (id) => document.getElementById(id);
const grid = el('grid');
const emptyBox = el('empty');
const countBadge = el('count');
const statusBox = el('status');
const statusText = el('statusText');
const qrFrame = el('qrFrame');
const urlText = el('urlText');
const hostRow = el('hostRow');
const hostSelect = el('hostSelect');
const zipBtn = el('zipBtn');
const clearBtn = el('clearBtn');
const autoDownload = el('autoDownload');
const toastBox = el('toast');

const POLL_MIN_MS = 1200;
const POLL_MAX_MS = 5000;
const POLL_HIDDEN_MS = 8000;   // 탭이 안 보일 때는 느리게

let sessionId = null;
let net = { mode: 'cloud', hosts: [], port: null, suggested: null };
let shareUrl = '';
let files = [];
let pollDelay = POLL_MIN_MS;
let pollTimer = null;
let stopped = false;

// ------------------------------------------------------------------ 화면 보조

let toastTimer = null;
function toast(message) {
  toastBox.textContent = message;
  toastBox.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastBox.classList.remove('show'), 2400);
}

function setStatus(state, message) {
  statusBox.className = 'status ' + state;
  statusText.textContent = message;
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function formatTime(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// -------------------------------------------------------------------- 세션

async function boot() {
  try {
    net = await fetch('/api/net').then((r) => r.json());
  } catch (err) {
    setStatus('off', '서버에 연결하지 못했습니다');
    return;
  }

  if (net.mode === 'local') {
    hostRow.hidden = false;
    hostSelect.replaceChildren();
    const options = net.hosts.map((h) => ({ value: h.address, label: `${h.address}  (${h.name})` }));
    if (options.length === 0) options.push({ value: location.hostname, label: location.hostname });
    for (const opt of options) {
      const node = document.createElement('option');
      node.value = opt.value;
      node.textContent = opt.label;
      hostSelect.appendChild(node);
    }
    const saved = localStorage.getItem('hp2pc.host');
    hostSelect.value = (saved && options.some((o) => o.value === saved)) ? saved : net.suggested;
    if (!hostSelect.value) hostSelect.value = options[0].value;
  } else {
    hostRow.hidden = true;
  }

  await newSession();
}

async function newSession() {
  stopPolling();
  files = [];
  render();
  qrFrame.classList.add('loading');
  qrFrame.textContent = 'QR 만드는 중…';
  setStatus('', '세션 준비 중…');

  try {
    const data = await fetch('/api/session', { method: 'POST' }).then((r) => r.json());
    sessionId = data.id;
  } catch (err) {
    setStatus('off', '세션을 만들지 못했습니다');
    return;
  }

  updateQr();
  setStatus('on', '대기 중 — 폰에서 QR을 찍으세요');
  startPolling();
}

function updateQr() {
  if (!sessionId) return;

  if (net.mode === 'local') {
    const host = hostSelect.value || location.hostname;
    localStorage.setItem('hp2pc.host', host);
    shareUrl = `http://${host}:${net.port}/s/${sessionId}`;
  } else {
    shareUrl = `${location.origin}/s/${sessionId}`;
  }
  urlText.textContent = shareUrl;

  // QR은 서버를 거치지 않고 브라우저에서 바로 그린다
  try {
    const qr = QR.encode(shareUrl, 'M');
    qrFrame.classList.remove('loading');
    qrFrame.innerHTML = QR.toSvg(qr, { border: 2 });
  } catch (err) {
    qrFrame.classList.add('loading');
    qrFrame.textContent = 'QR을 만들지 못했습니다';
  }
}

// -------------------------------------------------------------------- 폴링

function startPolling() {
  stopped = false;
  pollDelay = POLL_MIN_MS;
  schedule(0);
}

function stopPolling() {
  stopped = true;
  clearTimeout(pollTimer);
  pollTimer = null;
}

function schedule(delay) {
  clearTimeout(pollTimer);
  if (stopped) return;
  pollTimer = setTimeout(poll, delay);
}

async function poll() {
  if (stopped || !sessionId) return;

  // 탭이 가려져 있으면 굳이 자주 물어볼 필요가 없다 (요청 수 = 비용)
  if (document.hidden) return schedule(POLL_HIDDEN_MS);

  try {
    const res = await fetch(`/api/poll/${sessionId}`, { cache: 'no-store' });
    if (res.status === 404) {
      stopPolling();
      setStatus('off', '세션이 만료되었습니다 — 새 QR을 만들어 주세요');
      return;
    }
    if (!res.ok) throw new Error('poll failed');
    const data = await res.json();

    const changed = data.items.length !== files.length ||
      data.items.some((item, i) => !files[i] || files[i].id !== item.id);
    const added = data.items.filter((item) => !files.some((f) => f.id === item.id));

    files = data.items;
    if (changed) render();

    if (added.length > 0) {
      setStatus('on', `폰 연결됨 — ${files.length}개 받음`);
      if (autoDownload.checked) for (const file of added) download(file);
      pollDelay = POLL_MIN_MS;          // 방금 왔으니 잠깐 촘촘하게 본다
    } else if (data.phoneSeen) {
      setStatus('on', files.length > 0 ? `폰 연결됨 — ${files.length}개 받음` : '폰 연결됨 — 사진을 고르세요');
      pollDelay = Math.min(POLL_MAX_MS, Math.round(pollDelay * 1.2));
    } else {
      setStatus('on', '대기 중 — 폰에서 QR을 찍으세요');
      pollDelay = Math.min(POLL_MAX_MS, Math.round(pollDelay * 1.2));
    }
    schedule(pollDelay);
  } catch (err) {
    setStatus('off', '다시 연결하는 중…');
    schedule(Math.min(POLL_MAX_MS, Math.round(pollDelay * 1.6)));
  }
}

// 탭으로 돌아오면 즉시 한 번 확인한다
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !stopped) {
    pollDelay = POLL_MIN_MS;
    schedule(0);
  }
});

// ---------------------------------------------------------------- 파일 목록

const tiles = new Map();

function fileUrl(file, forDownload) {
  return `/api/file/${sessionId}/${file.id}` + (forDownload ? '?dl=1' : '');
}

function render() {
  for (const [id, node] of tiles) {
    if (!files.some((f) => f.id === id)) { node.remove(); tiles.delete(id); }
  }
  // 오래된 것부터 앞에 끼워 넣으면 결과적으로 최신 파일이 맨 위에 온다
  for (const file of files) {
    if (tiles.has(file.id)) continue;
    const node = tile(file);
    tiles.set(file.id, node);
    grid.prepend(node);
  }
  countBadge.textContent = String(files.length);
  zipBtn.disabled = files.length === 0;
  clearBtn.disabled = files.length === 0;
  emptyBox.style.display = files.length === 0 ? '' : 'none';
}

function tile(file) {
  const node = document.createElement('div');
  node.className = 'tile';

  const thumb = document.createElement('div');
  thumb.className = 'thumb';
  if (file.type.startsWith('image/')) {
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.src = fileUrl(file);
    img.alt = file.name;
    thumb.appendChild(img);
  } else if (file.type.startsWith('video/')) {
    const video = document.createElement('video');
    video.src = fileUrl(file);
    video.controls = true;
    video.preload = 'metadata';
    thumb.appendChild(video);
  } else {
    const ext = document.createElement('span');
    ext.className = 'ext';
    ext.textContent = (file.name.split('.').pop() || 'FILE').toUpperCase().slice(0, 5);
    thumb.appendChild(ext);
  }

  const meta = document.createElement('div');
  meta.className = 'meta';
  const name = document.createElement('div');
  name.className = 'name';
  name.textContent = file.name;
  name.title = file.name;
  const sub = document.createElement('div');
  sub.className = 'sub';
  sub.textContent = `${formatSize(file.size)} · ${formatTime(file.at)}`;
  meta.append(name, sub);

  const actions = document.createElement('div');
  actions.className = 'actions';

  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn primary';
  saveBtn.textContent = '저장';
  saveBtn.onclick = () => download(file);
  actions.appendChild(saveBtn);

  if (file.type.startsWith('image/')) {
    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn';
    copyBtn.textContent = '복사';
    copyBtn.title = '클립보드로 복사해서 바로 붙여넣기';
    copyBtn.onclick = () => copyImage(file, copyBtn);
    actions.appendChild(copyBtn);
  }

  const delBtn = document.createElement('button');
  delBtn.className = 'btn danger';
  delBtn.textContent = '삭제';
  delBtn.onclick = () => remove(file);
  actions.appendChild(delBtn);

  node.append(thumb, meta, actions);
  return node;
}

function download(file) {
  const a = document.createElement('a');
  a.href = fileUrl(file, true);
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function copyImage(file, button) {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = '복사 중…';
  try {
    const blob = await fetch(fileUrl(file)).then((r) => r.blob());
    // 클립보드는 PNG만 안정적으로 받으므로 캔버스로 변환한다
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    const png = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    toast('클립보드에 복사했습니다 — Ctrl+V로 붙여넣으세요');
  } catch (err) {
    toast('복사에 실패했습니다: ' + err.message);
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

async function remove(file) {
  try {
    await fetch(`/api/file/${sessionId}/${file.id}`, { method: 'DELETE' });
    files = files.filter((f) => f.id !== file.id);
    render();
  } catch (err) {
    toast('삭제하지 못했습니다');
  }
}

// ------------------------------------------------------------------ 이벤트

el('copyUrl').onclick = async () => {
  try {
    await navigator.clipboard.writeText(shareUrl);
    toast('주소를 복사했습니다');
  } catch (err) {
    toast('복사에 실패했습니다');
  }
};

el('newSession').onclick = () => {
  if (files.length > 0 && !confirm('받은 파일 목록이 사라집니다. 새 QR을 만들까요?')) return;
  newSession();
};

hostSelect.onchange = updateQr;

zipBtn.onclick = () => {
  window.location.href = `/api/zip/${sessionId}`;
};

clearBtn.onclick = async () => {
  if (!confirm('받은 파일을 모두 지울까요? PC에 저장하지 않은 파일은 사라집니다.')) return;
  await fetch(`/api/clear/${sessionId}`, { method: 'POST' });
  files = [];
  render();
};

autoDownload.checked = localStorage.getItem('hp2pc.autoDownload') === '1';
autoDownload.onchange = () => {
  localStorage.setItem('hp2pc.autoDownload', autoDownload.checked ? '1' : '0');
  if (autoDownload.checked) toast('브라우저가 “여러 파일 다운로드 허용”을 물으면 허용해 주세요');
};

boot();
