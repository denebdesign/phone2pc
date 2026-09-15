'use strict';

// 모바일 화면: 사진을 골라 순서대로 업로드한다.
//
// 100장씩 보내는 사람을 기준으로 만들었다. 그래서 세 가지를 지킨다.
//   1) 한 장을 보내는 동안 다음 장을 미리 준비한다 (CPU와 네트워크를 겹쳐서 시간을 줄인다)
//   2) 실패하면 몇 번 다시 보낸다 (모바일 망은 100장 중 몇 장은 반드시 끊긴다)
//   3) 미리보기는 원본이 아니라 줄인 사진으로 만든다 (100장을 원본으로 그리면 폰이 뻗는다)

const el = (id) => document.getElementById(id);
const list = el('list');
const headNote = el('headNote');
const originalToggle = el('original');
const progressCard = el('progressCard');
const progressNote = el('progressNote');
const limitNote = el('limitNote');
const progressFill = el('progressFill');
const retryBtn = el('retryBtn');

const T = (key, vars) => window.I18N.t(key, vars);

const sessionId = location.pathname.split('/')[2] || '';
const MAX_EDGE = 2048;        // 원본 끄기를 선택했을 때 줄일 최대 변 길이
const JPEG_QUALITY = 0.85;
const THUMB_EDGE = 320;       // PC 목록에 쓸 미리보기
const THUMB_QUALITY = 0.72;
const MAX_TRIES = 3;

// 서버가 세션을 만들 때 함께 내려준다. 못 받으면 보수적인 기본값을 쓴다.
let limits = { maxItems: 120, maxOriginalItems: 20, maxFileMB: 20, maxSessionMB: 150 };

const queue = [];
let sending = false;
let sentCount = 0;
let acceptedCount = 0;   // 대기열에 넣은 총 개수 (한도 계산용)
let failedItems = [];
let wakeLock = null;

// ------------------------------------------------------------------ 시작

async function boot() {
  if (!sessionId) return showExpired();
  try {
    const res = await fetch(`/api/hello/${sessionId}`, { method: 'POST' });
    if (!res.ok) return showExpired();
    const data = await res.json().catch(() => ({}));
    if (data && data.limits) limits = data.limits;
  } catch (err) {
    headNote.textContent = T('m.noPc');
    return;
  }
  el('main').hidden = false;
  headNote.textContent = T('m.ready');
  originalToggle.checked = localStorage.getItem('phone2pc.original') === '1';
}

function showExpired() {
  el('main').hidden = true;
  el('expired').hidden = false;
  headNote.textContent = '';
}

// -------------------------------------------------------------- 업로드 큐

/**
 * 고른 파일을 대기열에 넣는다.
 *
 * 한도를 넘는 만큼은 아예 담지 않고 그 자리에서 알려준다. 100장을 고른 뒤
 * 마지막 몇 장이 빨간 실패로 남는 것보다, 처음에 몇 장까지인지 아는 편이 낫다.
 */
function enqueue(fileList) {
  const picked = Array.from(fileList);
  const cap = originalToggle.checked ? limits.maxOriginalItems : limits.maxItems;
  const room = Math.max(0, cap - acceptedCount);
  const accepted = picked.slice(0, room);
  const dropped = picked.length - accepted.length;

  for (const file of accepted) {
    const item = { file, name: file.name || `${T('m.photoName')}-${Date.now()}.jpg`, row: null, bar: null, status: null };
    queue.push(item);
    acceptedCount++;
    addRow(item);
  }

  // 안내는 진행 문구와 따로 둔다. headNote에 쓰면 다음 장이 전송되는 순간 덮인다.
  limitNote.hidden = dropped === 0;
  if (dropped > 0) {
    limitNote.textContent = originalToggle.checked
      ? T('m.overOriginalLimit', { max: limits.maxOriginalItems, n: dropped })
      : T('m.overLimit', { max: limits.maxItems, n: dropped });
    progressCard.hidden = false;
  }
  if (accepted.length > 0) {
    updateProgress();
    if (!sending) pump();
  }
}

function addRow(item) {
  const row = document.createElement('div');
  row.className = 'card m-item';

  // 미리보기는 업로드 준비 단계에서 만든 작은 사진으로 채운다. 원본으로 채우면
  // 100장을 고르는 순간 폰 메모리가 터져 탭이 새로고침된다.
  const thumb = document.createElement('img');
  thumb.className = 'th';
  thumb.alt = '';

  const info = document.createElement('div');
  info.className = 'info';
  const name = document.createElement('div');
  name.className = 'nm';
  name.textContent = item.name;
  const status = document.createElement('div');
  status.className = 'st';
  status.textContent = T('m.queued');
  const bar = document.createElement('div');
  bar.className = 'bar';
  const fill = document.createElement('i');
  bar.appendChild(fill);
  info.append(name, status, bar);

  row.append(thumb, info);
  list.prepend(row);

  item.row = row;
  item.bar = fill;
  item.status = status;
  item.thumbNode = thumb;
}

function showRowThumb(item, blob) {
  if (!item.thumbNode || !blob) return;
  const url = URL.createObjectURL(blob);
  item.thumbNode.src = url;
  item.thumbNode.onload = () => URL.revokeObjectURL(url);
}

function updateProgress() {
  const total = acceptedCount;
  const done = sentCount;
  progressCard.hidden = total === 0;
  progressFill.style.width = total ? Math.round((done / total) * 100) + '%' : '0%';

  if (sending) {
    progressNote.textContent = T('m.progress', { done, total });
  } else if (failedItems.length > 0) {
    progressNote.textContent = T('m.doneWithFailed', { done, failed: failedItems.length });
  } else if (total > 0) {
    progressNote.textContent = T('m.allDone', { n: done });
  }

  retryBtn.hidden = sending || failedItems.length === 0;
  if (!retryBtn.hidden) retryBtn.textContent = T('m.retryFailed', { n: failedItems.length });
}

/**
 * 한 장을 보내는 동안 다음 장을 준비한다.
 *
 * 준비(캔버스로 줄이기)는 CPU, 전송은 네트워크라서 겹쳐 돌리면 100장 기준으로
 * 전체 시간이 눈에 띄게 줄어든다. 순서는 그대로 지킨다.
 */
async function pump() {
  sending = true;
  await keepScreenAwake();
  updateProgress();

  let next = queue.length ? prepareNext() : null;
  while (next) {
    const ready = await next;
    next = queue.length ? prepareNext() : null;
    if (ready) await sendOne(ready);
  }

  sending = false;
  releaseScreen();
  updateProgress();
  headNote.textContent = failedItems.length > 0
    ? T('m.doneWithFailed', { done: sentCount, failed: failedItems.length })
    : T('m.sentCount', { n: sentCount });
}

async function prepareNext() {
  const item = queue.shift();
  if (!item) return null;
  try {
    item.status.textContent = T('m.preparing');
    const payload = await prepare(item.file);
    showRowThumb(item, payload.thumb || null);
    return { item, payload };
  } catch (err) {
    markFailed(item, err.message);
    return null;
  }
}

async function sendOne(ready) {
  const { item, payload } = ready;
  try {
    item.status.textContent = T('m.sending');
    await uploadWithRetry(item, payload);
    item.status.textContent = T('m.sent');
    item.status.className = 'st done';
    item.bar.style.width = '100%';
    sentCount++;
    headNote.textContent = T('m.sentCount', { n: sentCount });
    updateProgress();
  } catch (err) {
    markFailed(item, err.message);
  }
}

function markFailed(item, message) {
  item.status.textContent = T('m.failedWith', { msg: message });
  item.status.className = 'st err';
  item.bar.style.width = '0%';
  if (!failedItems.includes(item)) failedItems.push(item);
  updateProgress();
}

// 실패한 것만 다시 대기열에 넣는다. 준비가 끝난 것은 준비를 건너뛴다.
retryBtn.onclick = () => {
  if (sending || failedItems.length === 0) return;
  const retrying = failedItems;
  failedItems = [];
  for (const item of retrying) {
    item.status.className = 'st';
    item.status.textContent = T('m.queued');
    queue.push(item);
  }
  pump();
};

// 원본 전송이 꺼져 있고 사진이면 캔버스로 줄여서 보낸다
async function prepare(file) {
  const isImage = file.type.startsWith('image/');
  const isShrinkable = isImage && file.type !== 'image/gif' && !originalToggle.checked;

  if (!isShrinkable) {
    const name = file.name || `${T('m.photoName')}-${Date.now()}.jpg`;
    const type = file.type || 'application/octet-stream';
    return { blob: file, name, type, shrunk: false, thumb: isImage ? await makeThumb(file) : null };
  }

  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const blob = await drawToJpeg(bitmap, MAX_EDGE, JPEG_QUALITY);
    const thumb = await drawToJpeg(bitmap, THUMB_EDGE, THUMB_QUALITY).catch(() => null);
    bitmap.close();
    if (!blob) throw new Error(T('m.convertFail'));
    const base = (file.name || T('m.photoName')).replace(/\.[^.]+$/, '');
    return { blob, name: `${base}.jpg`, type: 'image/jpeg', shrunk: true, thumb };
  } catch (err) {
    // 변환에 실패하면 원본을 그대로 보낸다
    return {
      blob: file,
      name: file.name || `${T('m.photoName')}-${Date.now()}.jpg`,
      type: file.type || 'application/octet-stream',
      shrunk: false,
      thumb: null
    };
  }
}

/** 비트맵을 긴 변 maxEdge에 맞춰 JPEG으로 만든다. 확대는 하지 않는다. */
function drawToJpeg(bitmap, maxEdge, quality) {
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

/** 원본을 그대로 보낼 때도 PC 목록용 작은 사진은 따로 만들어 준다. */
async function makeThumb(file) {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const thumb = await drawToJpeg(bitmap, THUMB_EDGE, THUMB_QUALITY);
    bitmap.close();
    return thumb;
  } catch (err) {
    return null;
  }
}

/**
 * 끊기면 다시 보낸다.
 *
 * 한도 초과(409)나 너무 큰 파일(413)처럼 다시 보내도 결과가 같은 것은 바로 포기한다.
 * 연결이 끊긴 경우와 서버가 혼잡한 경우(5xx, 429)만 잠깐 쉬었다가 다시 시도한다.
 */
async function uploadWithRetry(item, payload) {
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    try {
      const fileId = await upload(item, payload);
      if (payload.thumb) sendThumb(fileId, payload.thumb);
      return;
    } catch (err) {
      lastError = err;
      if (err.permanent || attempt === MAX_TRIES) break;
      item.status.textContent = T('m.retrying', { n: attempt, max: MAX_TRIES });
      await sleep(700 * attempt);
    }
  }
  throw lastError || new Error(T('m.disconnected'));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function upload(item, payload) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/upload/${sessionId}`);
    xhr.setRequestHeader('Content-Type', payload.type || 'application/octet-stream');
    xhr.setRequestHeader('X-Filename', encodeURIComponent(payload.name));
    // 서버가 원본/축소를 구분해 한도를 다르게 적용한다
    xhr.setRequestHeader('X-Shrunk', payload.shrunk ? '1' : '0');

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      item.bar.style.width = Math.round((event.loaded / event.total) * 100) + '%';
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        let fileId = '';
        try { fileId = (JSON.parse(xhr.responseText).file || {}).id || ''; } catch (_) { /* 미리보기만 포기한다 */ }
        return resolve(fileId);
      }
      // 413은 서버가 연결을 끊으면서 본문이 안 올 수 있어 여기서 문구를 만든다
      let message = xhr.status === 413
        ? T('m.tooBig')
        : T('m.serverError', { code: xhr.status });
      // 서버는 한국어(error)와 영어(error_en)를 함께 보낸다
      try {
        const body = JSON.parse(xhr.responseText);
        message = (window.I18N.lang === 'en' && body.error_en) || body.error || message;
      } catch (_) { /* 그대로 둔다 */ }
      if (xhr.status === 404) showExpired();

      const err = new Error(message);
      // 4xx는 다시 보내도 같은 답이 온다. 다만 429는 잠시 뒤에 풀린다.
      err.permanent = xhr.status >= 400 && xhr.status < 500 && xhr.status !== 429;
      reject(err);
    };
    xhr.onerror = () => reject(new Error(T('m.disconnected')));
    xhr.onabort = () => reject(new Error(T('m.canceled')));
    xhr.send(payload.blob);
  });
}

/** 미리보기 전송은 실패해도 그냥 넘어간다. PC는 미리보기가 없으면 원본을 쓴다. */
function sendThumb(fileId, blob) {
  if (!fileId) return;
  fetch(`/api/thumb/${sessionId}/${fileId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/jpeg' },
    body: blob
  }).catch(() => { /* 미리보기는 없어도 동작한다 */ });
}

// ------------------------------------------------------------ 화면 꺼짐 방지

/**
 * 100장이면 2~4분이 걸린다. 그동안 화면이 꺼지면 브라우저가 멈춰 전송이 중단된다.
 * Wake Lock을 지원하지 않는 기기에서는 그냥 넘어간다(문구로 안내).
 */
async function keepScreenAwake() {
  if (wakeLock || !('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch (err) {
    wakeLock = null;
  }
}

function releaseScreen() {
  if (!wakeLock) return;
  try { wakeLock.release(); } catch (err) { /* 이미 풀렸다 */ }
  wakeLock = null;
}

// 다른 앱에 갔다 오면 잠금이 풀린다. 아직 보내는 중이면 다시 잡는다.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && sending) keepScreenAwake();
});

// ------------------------------------------------------------------ 입력

function wire(buttonId, inputId) {
  const input = el(inputId);
  el(buttonId).onclick = () => input.click();
  input.onchange = () => {
    if (input.files && input.files.length > 0) enqueue(Array.from(input.files));
    input.value = '';  // 같은 파일을 다시 골라도 change가 뜨도록
  };
}

wire('cameraBtn', 'cameraInput');
wire('galleryBtn', 'galleryInput');
wire('fileBtn', 'fileInput');

originalToggle.onchange = () => {
  localStorage.setItem('phone2pc.original', originalToggle.checked ? '1' : '0');
};

boot();
