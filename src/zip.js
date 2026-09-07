'use strict';

// 압축 없이(store 방식) ZIP 파일을 스트리밍으로 만들어 주는 최소 구현.
// 사진/동영상은 이미 압축돼 있어 deflate 이득이 거의 없으므로 store로 충분하다.

const fs = require('fs');

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

function write(stream, buf) {
  return new Promise((resolve, reject) => {
    if (stream.destroyed) return reject(new Error('stream closed'));
    stream.write(buf, (err) => (err ? reject(err) : resolve()));
  });
}

// 같은 이름이 여러 번 나오면 "사진 (2).jpg" 처럼 번호를 붙인다
function uniqueName(name, used) {
  if (!used.has(name)) { used.add(name); return name; }
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let n = 2;
  let candidate;
  do { candidate = `${base} (${n++})${ext}`; } while (used.has(candidate));
  used.add(candidate);
  return candidate;
}

/**
 * entries: [{ name, mtime, data | diskPath }]
 *   data     — 메모리에 들고 있는 Buffer (클라우드 모드)
 *   diskPath — 디스크에서 읽어올 경로 (로컬 모드)
 * stream: 쓰기 가능한 스트림 (http.ServerResponse 등)
 */
async function writeZip(stream, entries) {
  const central = [];
  const used = new Set();
  let offset = 0;

  for (const entry of entries) {
    let data;
    if (entry.data) {
      data = entry.data;
    } else {
      try {
        data = await fs.promises.readFile(entry.diskPath);
      } catch (err) {
        continue;  // 이미 지워진 파일은 건너뛴다
      }
    }
    const name = uniqueName(entry.name, used);
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const { time, date } = dosDateTime(entry.mtime || new Date());

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);   // 로컬 파일 헤더 시그니처
    local.writeUInt16LE(20, 4);           // 필요 버전
    local.writeUInt16LE(0x0800, 6);       // 플래그: 파일명 UTF-8
    local.writeUInt16LE(0, 8);            // 압축 방식: store
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); // 압축 크기
    local.writeUInt32LE(data.length, 22); // 원본 크기
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);           // extra 길이

    await write(stream, local);
    await write(stream, nameBuf);
    await write(stream, data);

    central.push({ nameBuf, crc, size: data.length, time, date, offset });
    offset += local.length + nameBuf.length + data.length;
  }

  const centralStart = offset;
  for (const c of central) {
    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0);   // 중앙 디렉터리 시그니처
    head.writeUInt16LE(20, 4);           // 만든 버전
    head.writeUInt16LE(20, 6);           // 필요 버전
    head.writeUInt16LE(0x0800, 8);       // 플래그
    head.writeUInt16LE(0, 10);           // store
    head.writeUInt16LE(c.time, 12);
    head.writeUInt16LE(c.date, 14);
    head.writeUInt32LE(c.crc, 16);
    head.writeUInt32LE(c.size, 20);
    head.writeUInt32LE(c.size, 24);
    head.writeUInt16LE(c.nameBuf.length, 28);
    head.writeUInt16LE(0, 30);           // extra 길이
    head.writeUInt16LE(0, 32);           // 주석 길이
    head.writeUInt16LE(0, 34);           // 디스크 번호
    head.writeUInt16LE(0, 36);           // 내부 속성
    head.writeUInt32LE(0, 38);           // 외부 속성
    head.writeUInt32LE(c.offset, 42);    // 로컬 헤더 위치

    await write(stream, head);
    await write(stream, c.nameBuf);
    offset += head.length + c.nameBuf.length;
  }

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);                     // 이 디스크 번호
  eocd.writeUInt16LE(0, 6);                     // 중앙 디렉터리 시작 디스크
  eocd.writeUInt16LE(central.length, 8);
  eocd.writeUInt16LE(central.length, 10);
  eocd.writeUInt32LE(offset - centralStart, 12);
  eocd.writeUInt32LE(centralStart, 16);
  eocd.writeUInt16LE(0, 20);                    // 주석 길이
  await write(stream, eocd);
}

module.exports = { writeZip, crc32 };
