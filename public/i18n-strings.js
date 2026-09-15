'use strict';

/**
 * 화면에 나가는 문구표. ko가 원본, en이 번역이다.
 *
 * 브라우저와 서버가 같은 표를 쓴다. 서버는 첫 화면 HTML을 언어에 맞춰 미리 만들 때 쓰고
 * (검색엔진이 자바스크립트 없이도 제 언어로 읽게 하려고), 브라우저는 ?lang= 전환에 쓴다.
 * 한쪽에만 문구가 있으면 두 화면이 달라지므로 표는 이 파일 하나로만 둔다.
 */

(function (root, factory) {
  const STR = factory();
  if (typeof module === 'object' && module.exports) module.exports = STR;   // server.js
  else root.__I18N_STR = STR;                                              // 브라우저
})(typeof self !== 'undefined' ? self : this, function () {
  return {
    // ------------------------------------------------------------------ 공통
    'meta.desktopTitle': {
      ko: 'Phone2PC - 휴대폰 사진을 PC로 바로 전송',
      en: 'Phone2PC - Transfer Photos from Phone to PC'
    },
    'meta.desktopDesc': {
      ko: '휴대폰 사진과 파일을 PC로 전송하세요. 앱 설치, 로그인, 이메일, 클라우드가 필요 없습니다. QR 코드를 스캔하고 바로 보내세요.',
      en: 'Transfer photos and files from your phone to your PC. No app, login, email, or cloud storage required. Scan a QR code and send.'
    },
    // 공유 카드(og/twitter)용. 카드에는 두 줄만 보이므로 검색용 설명보다 짧게 쓴다.
    'meta.ogDesc': {
      ko: '휴대폰 사진과 파일을 PC로 바로 보내세요. 앱 설치, 로그인, 이메일, 클라우드가 필요 없습니다.',
      en: 'Send photos and files from your phone directly to your PC. No app, login, email, or cloud required.'
    },
    // 구글은 keywords를 보지 않는다. 국내 검색엔진과 내부 정리용으로만 둔다.
    'meta.keywords': {
      ko: '핸드폰 사진 PC로 옮기기, 휴대폰 사진 컴퓨터로 옮기기, 핸드폰 사진 컴퓨터로 보내기, 휴대폰 사진 PC 전송, 핸드폰 파일 PC로 보내기, 휴대폰 파일 컴퓨터로 옮기기, 휴대폰 사진 옮기기, 휴대폰 사진 전송, QR 사진 전송, 와이파이 파일 전송, 휴대폰 PC 파일 전송',
      en: 'phone to pc, transfer photos from phone to pc, phone to computer, send photos from phone to pc, transfer files from phone to pc, phone file transfer, phone to pc file transfer, transfer photos to computer, wireless file transfer, phone to computer file transfer'
    },
    'meta.ogImageAlt': {
      ko: 'Phone2PC — QR 코드를 찍어 휴대폰 사진을 PC로 전송',
      en: 'Phone2PC — scan the QR code to send phone photos to your PC'
    },
    'meta.mobileTitle': { ko: 'PC로 보내기 — Phone2PC', en: 'Send to PC — Phone2PC' },

    // ---------------------------------------------------------------- PC 화면
    // 화면 맨 위 H1과 그 아래 머리말. 검색 결과의 제목/설명과 같은 말을 한다.
    'd.h1': {
      ko: '휴대폰 사진을 PC로 바로 전송',
      en: 'Transfer Photos from Phone to PC'
    },
    'd.heroLede': {
      ko: '<b>앱 설치 없이 휴대폰 사진을 PC로 바로 보내세요.</b><br>'
        + '로그인도, 이메일도, 클라우드도 필요 없습니다. QR 코드를 찍고 바로 보내면 됩니다.',
      en: '<b>No app. No login. No cloud.</b><br>'
        + 'Simply scan the QR code and send your photos directly to your PC.'
    },
    'd.aboutTitle': { ko: 'Phone2PC란?', en: 'What is Phone2PC?' },
    'd.aboutLead': {
      ko: 'Phone2PC는 휴대폰 사진과 파일을 PC로 옮기는 가장 간단한 방법입니다.',
      en: 'Phone2PC is a simple way to transfer photos and files from your phone to your PC.'
    },
    'd.aboutBody': {
      ko: '앱 설치도, 로그인도, 이메일도, 클라우드도 필요 없습니다. PC 화면에 뜬 QR 코드를 휴대폰으로 찍고 '
        + '사진이나 파일을 고르면 PC로 바로 전송됩니다. 와이파이든 데이터든 상관없고, 보낸 파일은 PC에 '
        + '저장하는 즉시 서버에서 지워집니다.',
      en: 'No app, login, email, or cloud storage required. Scan the QR code with your phone, pick your photos, '
        + 'and they go straight to your PC — over Wi-Fi or mobile data. Files are deleted from the server the '
        + 'moment you save them on your PC.'
    },

    'd.status.booting': { ko: '준비 중…', en: 'Getting ready…' },
    'd.status.noServer': { ko: '서버에 연결하지 못했습니다', en: 'Could not reach the server' },
    'd.status.session': { ko: '세션 준비 중…', en: 'Preparing a session…' },
    'd.status.sessionFail': { ko: '세션을 만들지 못했습니다', en: 'Could not create a session' },
    'd.status.waiting': {
      ko: '대기 중 — 폰에서 QR을 찍으세요',
      en: 'Waiting — scan the QR code with your phone'
    },
    'd.status.expired': {
      ko: '세션이 만료되었습니다 — 새 QR을 만들어 주세요',
      en: 'Session expired — please create a new QR code'
    },
    'd.status.received': { ko: '폰 연결됨 — {n}개 받음', en: 'Phone connected — {n} received' },
    'd.status.pickPhoto': { ko: '폰 연결됨 — 사진을 고르세요', en: 'Phone connected — pick a photo' },
    'd.status.reconnect': { ko: '다시 연결하는 중…', en: 'Reconnecting…' },

    'd.step': {
      ko: '<b>폰 카메라</b>로 아래 QR을 비추세요',
      en: 'Point your <b>phone camera</b> at the QR code below'
    },
    'd.qr.making': { ko: 'QR 만드는 중…', en: 'Creating QR code…' },
    'd.qr.fail': { ko: 'QR을 만들지 못했습니다', en: 'Could not create the QR code' },
    'd.copy': { ko: '복사', en: 'Copy' },
    'd.copyUrlTitle': { ko: '주소 복사', en: 'Copy address' },
    'd.newSession': { ko: '새 QR 만들기', en: 'New QR code' },
    'd.hostSummary': {
      ko: '폰에서 안 열리면 여기를 눌러 주소를 바꿔보세요',
      en: 'Not opening on your phone? Tap here to try another address'
    },
    'd.hostHint': {
      ko: '네트워크 어댑터가 여러 개면 폰이 붙어 있는 와이파이와 같은 대역의 주소를 골라야 합니다.',
      en: 'With several network adapters, pick the address on the same Wi-Fi network as your phone.'
    },
    'd.hint1': {
      ko: '폰에 앱을 깔 필요 없습니다. 기본 카메라로 QR만 비추면 됩니다.',
      en: 'No app needed on your phone — just point the built-in camera at the QR code.'
    },
    'd.hint2': {
      ko: '사진은 <b>저장되지 않습니다.</b> PC에 저장하면 서버에서 바로 지워집니다.',
      en: 'Photos are <b>never stored.</b> Once you save them on this PC, the server deletes them.'
    },
    'd.hint3': { ko: '이 창을 닫으면 전송도 멈춥니다.', en: 'Closing this window stops the transfer.' },

    'd.filesTitle': { ko: '받은 파일', en: 'Received files' },
    'd.autoSave': { ko: '받는 즉시 자동 저장', en: 'Save on arrival' },
    'd.zip': { ko: '전체 ZIP 저장', en: 'Download all as ZIP' },
    'd.clear': { ko: '비우기', en: 'Clear' },
    'd.empty': {
      ko: '아직 받은 파일이 없습니다.<br>폰에서 QR을 찍고 사진을 고르면 여기에 바로 나타납니다.',
      en: 'No files yet.<br>Scan the QR code with your phone and pick a photo — it will show up here.'
    },
    'd.save': { ko: '저장', en: 'Save' },
    'd.delete': { ko: '삭제', en: 'Delete' },
    'd.copying': { ko: '복사 중…', en: 'Copying…' },
    'd.copyImageTitle': {
      ko: '클립보드로 복사해서 바로 붙여넣기',
      en: 'Copy to the clipboard and paste anywhere'
    },
    'd.copied': {
      ko: '클립보드에 복사했습니다 — Ctrl+V로 붙여넣으세요',
      en: 'Copied to the clipboard — press Ctrl+V to paste'
    },
    'd.copyFailWith': { ko: '복사에 실패했습니다: {msg}', en: 'Copy failed: {msg}' },
    'd.deleteFail': { ko: '삭제하지 못했습니다', en: 'Could not delete the file' },
    'd.urlCopied': { ko: '주소를 복사했습니다', en: 'Address copied' },
    'd.copyFail': { ko: '복사에 실패했습니다', en: 'Copy failed' },
    'd.confirmNew': {
      ko: '받은 파일 목록이 사라집니다. 새 QR을 만들까요?',
      en: 'The received file list will be cleared. Create a new QR code?'
    },
    'd.confirmClear': {
      ko: '받은 파일을 모두 지울까요? PC에 저장하지 않은 파일은 사라집니다.',
      en: 'Delete every received file? Anything not saved to this PC will be lost.'
    },
    'd.autoDlNote': {
      ko: '브라우저가 “여러 파일 다운로드 허용”을 물으면 허용해 주세요',
      en: 'If the browser asks to allow multiple downloads, please allow it'
    },
    'd.savedRemoved': {
      ko: '저장한 파일은 서버에서 바로 지워집니다',
      en: 'Saved files are deleted from the server right away'
    },
    'd.countTitle': { ko: '{n}장 / 한 세션 최대 {max}장', en: '{n} of {max} files per session' },
    'd.zipBigConfirm': {
      ko: 'ZIP 용량이 약 {mb}MB입니다. 인터넷이 느리면 내려받다가 끊길 수 있어요.\n'
        + '「받는 즉시 자동 저장」을 켜면 한 장씩 안전하게 받을 수 있습니다.\n\n그래도 ZIP으로 받을까요?',
      en: 'This ZIP is about {mb}MB. On a slow connection the download may time out.\n'
        + 'Turning on “Save on arrival” downloads them one by one instead.\n\nDownload the ZIP anyway?'
    },

    // ---------------------------------------------------------------- 폰 화면
    'm.head': { ko: 'PC로 보내기', en: 'Send to PC' },
    'm.checking': { ko: '연결 확인 중…', en: 'Checking the connection…' },
    'm.noPc': {
      ko: 'PC에 연결하지 못했습니다. 네트워크 상태를 확인해 주세요.',
      en: 'Could not reach the PC. Please check your network.'
    },
    'm.ready': {
      ko: 'PC와 연결되었습니다. 보낼 사진을 고르세요.',
      en: 'Connected to the PC. Pick the photos to send.'
    },
    'm.cameraT': { ko: '지금 찍어서 보내기', en: 'Take a photo and send' },
    'm.cameraD': { ko: '카메라를 열어 바로 촬영합니다', en: 'Opens the camera to shoot right away' },
    'm.galleryT': { ko: '앨범에서 고르기', en: 'Pick from your album' },
    'm.galleryD': { ko: '사진·동영상 여러 개를 한 번에', en: 'Several photos or videos at once' },
    'm.fileT': { ko: '파일 고르기', en: 'Pick a file' },
    'm.fileD': { ko: 'PDF 등 다른 파일도 보낼 수 있어요', en: 'PDFs and other files work too' },
    'm.originalT': { ko: '원본 화질로 보내기', en: 'Send at original quality' },
    'm.originalD': {
      ko: '평소엔 2048px로 줄여 빠르게 보냅니다',
      en: 'Normally resized to 2048px for a faster send'
    },
    'm.expiredT': { ko: '세션이 만료되었습니다', en: 'This session has expired' },
    'm.expiredD': {
      ko: 'PC 화면에서 <b>새 QR 만들기</b>를 누른 뒤 다시 찍어 주세요.',
      en: 'Press <b>New QR code</b> on the PC screen, then scan again.'
    },
    'm.photoName': { ko: '사진', en: 'photo' },
    'm.queued': { ko: '대기 중', en: 'Queued' },
    'm.preparing': { ko: '준비 중…', en: 'Preparing…' },
    'm.sending': { ko: '보내는 중…', en: 'Sending…' },
    'm.sent': { ko: '전송 완료', en: 'Sent' },
    'm.sentCount': { ko: '{n}개 전송 완료 — PC 화면을 확인하세요.', en: '{n} sent — check your PC screen.' },
    'm.failedWith': { ko: '실패: {msg}', en: 'Failed: {msg}' },
    'm.retrying': { ko: '다시 보내는 중… ({n}/{max})', en: 'Retrying… ({n}/{max})' },
    'm.progress': {
      ko: '{done} / {total}장 보내는 중 — 화면을 켜 두세요',
      en: 'Sending {done} of {total} — keep the screen on'
    },
    'm.allDone': { ko: '{n}장 모두 보냈습니다', en: 'All {n} files sent' },
    'm.doneWithFailed': {
      ko: '{done}장 전송, {failed}장 실패',
      en: '{done} sent, {failed} failed'
    },
    'm.retryFailed': { ko: '실패한 {n}장 다시 보내기', en: 'Retry {n} failed files' },
    'm.overLimit': {
      ko: '한 번에 {max}장까지 보낼 수 있습니다. {n}장은 담지 않았어요. PC에서 저장한 뒤 새 QR로 이어서 보내 주세요.',
      en: 'Up to {max} files per session — {n} were left out. Save them on your PC, then continue with a new QR code.'
    },
    'm.overOriginalLimit': {
      ko: '원본 화질은 {max}장까지입니다. {n}장은 담지 않았어요. 많이 보내려면 원본 화질을 꺼 주세요.',
      en: 'Original quality is limited to {max} files — {n} were left out. Turn off original quality to send more.'
    },
    'm.convertFail': { ko: '변환 실패', en: 'Conversion failed' },
    'm.tooBig': {
      ko: '파일이 너무 큽니다. 원본 화질을 꺼 주세요.',
      en: 'That file is too large. Turn off original quality.'
    },
    'm.serverError': { ko: '서버 오류 ({code})', en: 'Server error ({code})' },
    'm.disconnected': { ko: '연결이 끊겼습니다', en: 'The connection dropped' },
    'm.canceled': { ko: '취소됨', en: 'Canceled' },

    // ------------------------------------------------------------------ 하단
    'f.adLabel': { ko: '광고', en: 'Ad' },
    'f.adPlaceholder': {
      ko: 'Google AdSense 반응형 디스플레이 광고 영역',
      en: 'Google AdSense responsive display ad slot'
    },
    'f.adPlaceholderSub': {
      ko: 'banners.json 에 client / slot 값을 넣으면 실제 광고가 나갑니다',
      en: 'Fill in client / slot in banners.json to serve real ads'
    },
    'f.moreInfo': { ko: '이용 안내 · 주의사항', en: 'How it works · Notes' },
    'f.domain': { ko: '공식 도메인', en: 'Official domain' },
    'f.contact': { ko: '문의·제휴', en: 'Contact' },
    'f.pending': { ko: '준비 중입니다', en: 'Coming soon' }
  };
});
