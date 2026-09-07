/*
 * 의존성 없는 QR 코드 생성기 (byte 모드, 버전 1~40).
 * ISO/IEC 18004 기반. Node(require)와 브라우저(window.QR) 양쪽에서 동작한다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QR = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 오류정정 레벨의 포맷 비트 값 (L, M, Q, H 순서)
  var ECL_FORMAT_BITS = [1, 0, 3, 2];
  var ECL_INDEX = { L: 0, M: 1, Q: 2, H: 3 };

  // 블록당 오류정정 코드워드 수 [레벨][버전]
  var ECC_CODEWORDS_PER_BLOCK = [
    [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]
  ];

  // 오류정정 블록 수 [레벨][버전]
  var NUM_ERROR_CORRECTION_BLOCKS = [
    [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81]
  ];

  var PENALTY_N1 = 3, PENALTY_N2 = 3, PENALTY_N3 = 40, PENALTY_N4 = 10;

  function getNumRawDataModules(ver) {
    var result = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      var numAlign = Math.floor(ver / 7) + 2;
      result -= (25 * numAlign - 10) * numAlign - 55;
      if (ver >= 7) result -= 36;
    }
    return result;
  }

  function getNumDataCodewords(ver, eclIdx) {
    return Math.floor(getNumRawDataModules(ver) / 8) -
      ECC_CODEWORDS_PER_BLOCK[eclIdx][ver] * NUM_ERROR_CORRECTION_BLOCKS[eclIdx][ver];
  }

  function getAlignmentPatternPositions(ver) {
    if (ver === 1) return [];
    var numAlign = Math.floor(ver / 7) + 2;
    var size = ver * 4 + 17;
    var step = (ver === 32) ? 26 : Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
    var result = [6];
    for (var pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
    return result;
  }

  // ---- GF(256) 연산 ----
  function gfMultiply(x, y) {
    var z = 0;
    for (var i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11D);
      z ^= ((y >>> i) & 1) * x;
    }
    return z & 0xFF;
  }

  function rsComputeDivisor(degree) {
    var result = new Uint8Array(degree);
    result[degree - 1] = 1;
    var root = 1;
    for (var i = 0; i < degree; i++) {
      for (var j = 0; j < degree; j++) {
        result[j] = gfMultiply(result[j], root);
        if (j + 1 < degree) result[j] ^= result[j + 1];
      }
      root = gfMultiply(root, 0x02);
    }
    return result;
  }

  function rsComputeRemainder(data, divisor) {
    var result = new Uint8Array(divisor.length);
    for (var i = 0; i < data.length; i++) {
      var factor = data[i] ^ result[0];
      result.copyWithin(0, 1);
      result[result.length - 1] = 0;
      for (var j = 0; j < divisor.length; j++) {
        result[j] ^= gfMultiply(divisor[j], factor);
      }
    }
    return result;
  }

  // ---- 문자열 → UTF-8 바이트 ----
  function toUtf8Bytes(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) {
        out.push(c);
      } else if (c < 0x800) {
        out.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F));
      } else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < str.length) {
        var cp = 0x10000 + ((c - 0xD800) << 10) + (str.charCodeAt(i + 1) - 0xDC00);
        i++;
        out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3F), 0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F));
      } else {
        out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
      }
    }
    return out;
  }

  function encode(text, eclName) {
    var eclIdx = ECL_INDEX[eclName || 'M'];
    if (eclIdx === undefined) throw new Error('알 수 없는 오류정정 레벨: ' + eclName);
    var bytes = toUtf8Bytes(String(text));

    // 데이터가 들어가는 최소 버전 선택
    var ver = 0;
    for (var v = 1; v <= 40; v++) {
      var ccBits = (v <= 9) ? 8 : 16;
      if (4 + ccBits + bytes.length * 8 <= getNumDataCodewords(v, eclIdx) * 8) { ver = v; break; }
    }
    if (ver === 0) throw new Error('데이터가 너무 깁니다');

    var dataCapacityBits = getNumDataCodewords(ver, eclIdx) * 8;
    var countBits = (ver <= 9) ? 8 : 16;

    var bb = [];
    function appendBits(val, len) {
      for (var i = len - 1; i >= 0; i--) bb.push((val >>> i) & 1);
    }
    appendBits(0x4, 4);                   // 모드 지시자: byte
    appendBits(bytes.length, countBits);  // 문자 수 지시자
    for (var i = 0; i < bytes.length; i++) appendBits(bytes[i], 8);

    appendBits(0, Math.min(4, dataCapacityBits - bb.length));  // 종료 패턴
    appendBits(0, (8 - bb.length % 8) % 8);                    // 바이트 정렬
    for (var pad = 0xEC; bb.length < dataCapacityBits; pad ^= 0xEC ^ 0x11) appendBits(pad, 8);

    var dataCodewords = new Uint8Array(bb.length / 8);
    for (var k = 0; k < bb.length; k++) dataCodewords[k >>> 3] |= bb[k] << (7 - (k & 7));

    return buildMatrix(addEccAndInterleave(dataCodewords, ver, eclIdx), ver, eclIdx);
  }

  function addEccAndInterleave(data, ver, eclIdx) {
    var numBlocks = NUM_ERROR_CORRECTION_BLOCKS[eclIdx][ver];
    var blockEccLen = ECC_CODEWORDS_PER_BLOCK[eclIdx][ver];
    var rawCodewords = Math.floor(getNumRawDataModules(ver) / 8);
    var numShortBlocks = numBlocks - rawCodewords % numBlocks;
    var shortBlockLen = Math.floor(rawCodewords / numBlocks);

    var blocks = [];
    var rsDiv = rsComputeDivisor(blockEccLen);
    for (var i = 0, k = 0; i < numBlocks; i++) {
      var datLen = shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1);
      var dat = data.slice(k, k + datLen);
      k += datLen;
      blocks.push({ data: dat, ecc: rsComputeRemainder(dat, rsDiv) });
    }

    // 블록 인터리빙: 데이터 코드워드 먼저, 그 다음 오류정정 코드워드
    var result = new Uint8Array(rawCodewords);
    var idx = 0;
    var maxDatLen = shortBlockLen - blockEccLen + 1;
    for (var j = 0; j < maxDatLen; j++) {
      for (var b = 0; b < numBlocks; b++) {
        if (j < blocks[b].data.length) result[idx++] = blocks[b].data[j];
      }
    }
    for (var j2 = 0; j2 < blockEccLen; j2++) {
      for (var b2 = 0; b2 < numBlocks; b2++) result[idx++] = blocks[b2].ecc[j2];
    }
    return result;
  }

  function buildMatrix(allCodewords, ver, eclIdx) {
    var size = ver * 4 + 17;
    var modules = [];
    var isFunction = [];
    for (var y = 0; y < size; y++) {
      modules.push(new Array(size).fill(false));
      isFunction.push(new Array(size).fill(false));
    }

    function setFunctionModule(x, y, isDark) {
      modules[y][x] = isDark;
      isFunction[y][x] = true;
    }

    function drawFinderPattern(x, y) {
      for (var dy = -4; dy <= 4; dy++) {
        for (var dx = -4; dx <= 4; dx++) {
          var dist = Math.max(Math.abs(dx), Math.abs(dy));
          var xx = x + dx, yy = y + dy;
          if (xx >= 0 && xx < size && yy >= 0 && yy < size) {
            setFunctionModule(xx, yy, dist !== 2 && dist !== 4);
          }
        }
      }
    }

    function drawAlignmentPattern(x, y) {
      for (var dy = -2; dy <= 2; dy++) {
        for (var dx = -2; dx <= 2; dx++) {
          setFunctionModule(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    }

    function drawFormatBits(mask) {
      var data = ECL_FORMAT_BITS[eclIdx] << 3 | mask;
      var rem = data;
      for (var i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      var bits = ((data << 10) | rem) ^ 0x5412;

      for (var a = 0; a <= 5; a++) setFunctionModule(8, a, ((bits >>> a) & 1) !== 0);
      setFunctionModule(8, 7, ((bits >>> 6) & 1) !== 0);
      setFunctionModule(8, 8, ((bits >>> 7) & 1) !== 0);
      setFunctionModule(7, 8, ((bits >>> 8) & 1) !== 0);
      for (var b = 9; b < 15; b++) setFunctionModule(14 - b, 8, ((bits >>> b) & 1) !== 0);

      for (var c = 0; c < 8; c++) setFunctionModule(size - 1 - c, 8, ((bits >>> c) & 1) !== 0);
      for (var d = 8; d < 15; d++) setFunctionModule(8, size - 15 + d, ((bits >>> d) & 1) !== 0);
      setFunctionModule(8, size - 8, true);  // 항상 검정인 모듈
    }

    function drawVersionBits() {
      if (ver < 7) return;
      var rem = ver;
      for (var i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
      var bits = ver << 12 | rem;
      for (var j = 0; j < 18; j++) {
        var bit = ((bits >>> j) & 1) !== 0;
        var a = size - 11 + j % 3;
        var b = Math.floor(j / 3);
        setFunctionModule(a, b, bit);
        setFunctionModule(b, a, bit);
      }
    }

    // 기능 패턴
    for (var t = 0; t < size; t++) {
      setFunctionModule(6, t, t % 2 === 0);
      setFunctionModule(t, 6, t % 2 === 0);
    }
    drawFinderPattern(3, 3);
    drawFinderPattern(size - 4, 3);
    drawFinderPattern(3, size - 4);

    var alignPos = getAlignmentPatternPositions(ver);
    var numAlign = alignPos.length;
    for (var ai = 0; ai < numAlign; ai++) {
      for (var aj = 0; aj < numAlign; aj++) {
        // 세 모서리의 파인더 패턴 자리는 건너뛴다
        var isCorner = (ai === 0 && aj === 0) ||
          (ai === 0 && aj === numAlign - 1) ||
          (ai === numAlign - 1 && aj === 0);
        if (!isCorner) drawAlignmentPattern(alignPos[ai], alignPos[aj]);
      }
    }
    drawFormatBits(0);  // 임시값. 마스크 확정 후 다시 그린다
    drawVersionBits();

    // 데이터 배치 (오른쪽 아래에서 지그재그로 올라감)
    var bitIdx = 0;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) {
        for (var jj = 0; jj < 2; jj++) {
          var x = right - jj;
          var upward = ((right + 1) & 2) === 0;
          var yy2 = upward ? size - 1 - vert : vert;
          if (!isFunction[yy2][x] && bitIdx < allCodewords.length * 8) {
            modules[yy2][x] = ((allCodewords[bitIdx >>> 3] >>> (7 - (bitIdx & 7))) & 1) !== 0;
            bitIdx++;
          }
        }
      }
    }

    function applyMask(mask) {
      for (var y = 0; y < size; y++) {
        for (var x = 0; x < size; x++) {
          if (isFunction[y][x]) continue;
          var invert;
          switch (mask) {
            case 0: invert = (x + y) % 2 === 0; break;
            case 1: invert = y % 2 === 0; break;
            case 2: invert = x % 3 === 0; break;
            case 3: invert = (x + y) % 3 === 0; break;
            case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
            case 5: invert = x * y % 2 + x * y % 3 === 0; break;
            case 6: invert = (x * y % 2 + x * y % 3) % 2 === 0; break;
            case 7: invert = ((x + y) % 2 + x * y % 3) % 2 === 0; break;
          }
          if (invert) modules[y][x] = !modules[y][x];
        }
      }
    }

    function finderPenaltyAddHistory(runLength, history) {
      if (history[0] === 0) runLength += size;  // 바깥 여백을 흰색 실행으로 간주
      history.pop();
      history.unshift(runLength);
    }

    function finderPenaltyCountPatterns(history) {
      var n = history[1];
      var core = n > 0 && history[2] === n && history[3] === n * 3 && history[4] === n && history[5] === n;
      return (core && history[0] >= n * 4 && history[6] >= n ? 1 : 0) +
        (core && history[6] >= n * 4 && history[0] >= n ? 1 : 0);
    }

    function finderPenaltyTerminateAndCount(runColor, runLength, history) {
      if (runColor) {
        finderPenaltyAddHistory(runLength, history);
        runLength = 0;
      }
      runLength += size;
      finderPenaltyAddHistory(runLength, history);
      return finderPenaltyCountPatterns(history);
    }

    function getPenaltyScore() {
      var result = 0;
      var x, y, run, color, history;

      // 가로 방향 연속 모듈
      for (y = 0; y < size; y++) {
        color = false; run = 0; history = [0, 0, 0, 0, 0, 0, 0];
        for (x = 0; x < size; x++) {
          if (modules[y][x] === color) {
            run++;
            if (run === 5) result += PENALTY_N1;
            else if (run > 5) result++;
          } else {
            finderPenaltyAddHistory(run, history);
            if (!color) result += finderPenaltyCountPatterns(history) * PENALTY_N3;
            color = modules[y][x];
            run = 1;
          }
        }
        result += finderPenaltyTerminateAndCount(color, run, history) * PENALTY_N3;
      }

      // 세로 방향 연속 모듈
      for (x = 0; x < size; x++) {
        color = false; run = 0; history = [0, 0, 0, 0, 0, 0, 0];
        for (y = 0; y < size; y++) {
          if (modules[y][x] === color) {
            run++;
            if (run === 5) result += PENALTY_N1;
            else if (run > 5) result++;
          } else {
            finderPenaltyAddHistory(run, history);
            if (!color) result += finderPenaltyCountPatterns(history) * PENALTY_N3;
            color = modules[y][x];
            run = 1;
          }
        }
        result += finderPenaltyTerminateAndCount(color, run, history) * PENALTY_N3;
      }

      // 2x2 동일 색상 블록
      for (y = 0; y < size - 1; y++) {
        for (x = 0; x < size - 1; x++) {
          var c = modules[y][x];
          if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) {
            result += PENALTY_N2;
          }
        }
      }

      // 검정 모듈 비율 편중
      var dark = 0;
      for (y = 0; y < size; y++) {
        for (x = 0; x < size; x++) if (modules[y][x]) dark++;
      }
      var total = size * size;
      result += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * PENALTY_N4;
      return result;
    }

    var bestMask = 0;
    var minPenalty = Infinity;
    for (var m = 0; m < 8; m++) {
      applyMask(m);
      drawFormatBits(m);
      var penalty = getPenaltyScore();
      if (penalty < minPenalty) { minPenalty = penalty; bestMask = m; }
      applyMask(m);  // XOR이므로 다시 적용하면 원복된다
    }
    applyMask(bestMask);
    drawFormatBits(bestMask);

    return { size: size, version: ver, mask: bestMask, modules: modules };
  }

  function toSvg(qr, opts) {
    opts = opts || {};
    var border = opts.border == null ? 2 : opts.border;
    var dark = opts.dark || '#0f172a';
    var light = opts.light || '#ffffff';
    var dim = qr.size + border * 2;
    var parts = [];
    for (var y = 0; y < qr.size; y++) {
      for (var x = 0; x < qr.size; x++) {
        if (qr.modules[y][x]) parts.push('M' + (x + border) + ',' + (y + border) + 'h1v1h-1z');
      }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + dim + ' ' + dim + '" ' +
      'shape-rendering="crispEdges" width="100%" height="100%">' +
      '<rect width="100%" height="100%" fill="' + light + '"/>' +
      '<path d="' + parts.join('') + '" fill="' + dark + '"/></svg>';
  }

  return { encode: encode, toSvg: toSvg };
});
