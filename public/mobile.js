'use strict';

// 모바일 화면: 사진을 골라 순서대로 업로드한다.

const el = (id) => document.getElementById(id);
const list = el('list');
const headNote = el('headNote');
const originalToggle = el('original');

const sessionId = location.pathname.split('/')[2] || '';
const MAX_EDGE = 2048;        // 원본 끄기를 선택했을 때 줄일 최대 변 길이
const JPEG_QUALITY = 0.85;

const queue = [];
let sending = false;
let sentCount = 0;

// ------------------------------------------------------------------ 시작

async function boot() {
  if (!sessionId) return showExpired();
  try {
    const res = await fetch(`/api/hello/${sessionId}`, { method: 'POST' });
    if (!res.ok) return showExpired();
  } catch (err) {
    headNote.textContent = 'PC에 연결하지 못했습니다. 네트워크 상태를 확인해 주세요.';
    return;
  }
  el('main').hidden = false;
  headNote.textContent = 'PC와 연결되었습니다. 보낼 사진을 고르세요.';
  originalToggle.checked = localStorage.getItem('hp2pc.original') === '1';
}

function showExpired() {
  el('main').hidden = true;
  el('expired').hidden = false;
  headNote.textContent = '';
}

// -------------------------------------------------------------- 업로드 큐

function enqueue(fileList) {
  for (const file of fileList) {
    const item = { file, name: file.name || `사진-${Date.now()}.jpg`, row: null, bar: null, status: null };
    queue.push(item);
    addRow(item);
  }
  if (!sending) pump();
}

function addRow(item) {
  const row = document.createElement('div');
  row.className = 'card m-item';

  const thumb = document.createElement('img');
  thumb.className = 'th';
  if (item.file.type.startsWith('image/')) {
    const objectUrl = URL.createObjectURL(item.file);
    thumb.src = objectUrl;
    thumb.onload = () => URL.revokeObjectURL(objectUrl);
  } else {
    thumb.alt = '';
  }

  const info = document.createElement('div');
  info.className = 'info';
  const name = document.createElement('div');
  name.className = 'nm';
  name.textContent = item.name;
  const status = document.createElement('div');
  status.className = 'st';
  status.textContent = '대기 중';
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
}

async function pump() {
  sending = true;
  while (queue.length > 0) {
    const item = queue.shift();
    try {
      item.status.textContent = '준비 중…';
      const payload = await prepare(item.file);
      item.status.textContent = '보내는 중…';
      await upload(item, payload.blob, payload.name, payload.type);
      item.status.textContent = '전송 완료';
      item.status.className = 'st done';
      item.bar.style.width = '100%';
      sentCount++;
      headNote.textContent = `${sentCount}개 전송 완료 — PC 화면을 확인하세요.`;
    } catch (err) {
      item.status.textContent = '실패: ' + err.message;
      item.status.className = 'st err';
    }
  }
  sending = false;
}

// 원본 전송이 꺼져 있고 사진이면 캔버스로 줄여서 보낸다
async function prepare(file) {
  const isShrinkable = file.type.startsWith('image/') &&
    file.type !== 'image/gif' &&
    !originalToggle.checked;
  if (!isShrinkable) {
    return { blob: file, name: file.name || `사진-${Date.now()}.jpg`, type: file.type || 'application/octet-stream' };
  }

  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
    if (!blob) throw new Error('변환 실패');
    const base = (file.name || '사진').replace(/\.[^.]+$/, '');
    return { blob, name: `${base}.jpg`, type: 'image/jpeg' };
  } catch (err) {
    // 변환에 실패하면 원본을 그대로 보낸다
    return { blob: file, name: file.name || `사진-${Date.now()}.jpg`, type: file.type || 'application/octet-stream' };
  }
}

function upload(item, blob, name, type) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/upload/${sessionId}`);
    xhr.setRequestHeader('Content-Type', type || 'application/octet-stream');
    xhr.setRequestHeader('X-Filename', encodeURIComponent(name));

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      item.bar.style.width = Math.round((event.loaded / event.total) * 100) + '%';
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      // 413은 서버가 연결을 끊으면서 본문이 안 올 수 있어 여기서 문구를 만든다
      let message = xhr.status === 413
        ? '파일이 너무 큽니다. 원본 화질을 꺼 주세요.'
        : `서버 오류 (${xhr.status})`;
      try { message = JSON.parse(xhr.responseText).error || message; } catch (_) { /* 그대로 둔다 */ }
      if (xhr.status === 404) showExpired();
      reject(new Error(message));
    };
    xhr.onerror = () => reject(new Error('연결이 끊겼습니다'));
    xhr.onabort = () => reject(new Error('취소됨'));
    xhr.send(blob);
  });
}

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
  localStorage.setItem('hp2pc.original', originalToggle.checked ? '1' : '0');
};

boot();
