'use strict';

/**
 * 화면 문구의 한국어/영어 전환.
 *
 * 언어는 서버가 정한다. server.js가 Accept-Language를 보고 이미 그 언어로 HTML을 만들어
 * 내려주므로, 여기서는 <html lang>에 적힌 서버의 결정을 그대로 따른다. 자바스크립트를
 * 돌리지 않는 검색엔진도 제 언어로 페이지를 읽게 하려면 이 순서여야 한다.
 *
 * 반면 광고 지역 판정(isKorea)은 계속 기기의 표준시간대로 한다. 서버 헤더로 국가를 받으면
 * /api/ads 응답이 CDN에 공유 캐시되면서 한 사람의 국가가 다른 사람에게 새어 나갈 수 있다.
 */

(function () {
  function detectKorea() {
    // ?lang=en / ?lang=ko 로 강제 전환. 국외 화면을 국내에서 확인할 때 쓴다.
    const forced = new URLSearchParams(location.search).get('lang');
    if (forced === 'en') return false;
    if (forced === 'ko') return true;

    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz) return tz === 'Asia/Seoul';
    } catch (err) {
      /* 표준시간대를 못 읽으면 브라우저 언어로 되짚는다 */
    }
    return String(navigator.language || '').toLowerCase().indexOf('ko') === 0;
  }

  /**
   * 화면 문구의 언어. ?lang= 이 가장 세고, 그다음이 서버가 내려준 언어다.
   * 서버를 거치지 않고 파일을 직접 연 경우에만 표준시간대로 되짚는다.
   */
  function detectLang() {
    // 서버가 이미 ?lang= 까지 보고 정한 언어다. 화면과 HTML이 어긋나지 않게 이쪽을 먼저 본다.
    const root = document.documentElement;
    if (root.getAttribute('data-lang-source') === 'server') {
      const served = root.getAttribute('lang');
      if (served === 'en' || served === 'ko') return served;
    }

    // 여기부터는 서버를 거치지 않고 파일을 직접 연 경우다
    const forced = new URLSearchParams(location.search).get('lang');
    if (forced === 'en' || forced === 'ko') return forced;
    return detectKorea() ? 'ko' : 'en';
  }

  const isKorea = detectKorea();
  const lang = detectLang();

  const STR = (typeof window !== 'undefined' && window.__I18N_STR) || {};

  function t(key, vars) {
    const entry = STR[key];
    let text = entry ? (entry[lang] != null ? entry[lang] : entry.ko) : key;
    if (vars) {
      for (const name in vars) text = text.split('{' + name + '}').join(vars[name]);
    }
    return text;
  }

  /** 설정 객체에서 언어에 맞는 값을 고른다. 영어 값이 없으면 원문을 그대로 쓴다. */
  function pick(source, field) {
    if (!source) return '';
    if (lang === 'en' && source[field + 'En']) return source[field + 'En'];
    return source[field] || '';
  }

  /** data-i18n 계열 속성이 붙은 요소를 한 번에 번역한다. */
  function apply(root) {
    const scope = root || document;
    scope.querySelectorAll('[data-i18n]').forEach((node) => {
      node.textContent = t(node.getAttribute('data-i18n'));
    });
    scope.querySelectorAll('[data-i18n-html]').forEach((node) => {
      node.innerHTML = t(node.getAttribute('data-i18n-html'));
    });
    scope.querySelectorAll('[data-i18n-title]').forEach((node) => {
      node.title = t(node.getAttribute('data-i18n-title'));
    });
  }

  window.I18N = { lang, isKorea, t, pick, apply };

  document.documentElement.lang = lang;

  /** head의 SEO 태그를 현재 언어에 맞춘다. HTML에는 한국어가 박혀 있다. */
  function applyMeta(isMobile) {
    const title = t(isMobile ? 'meta.mobileTitle' : 'meta.desktopTitle');
    const desc = t('meta.desktopDesc');

    document.title = title;

    const set = (selector, value) => {
      const node = document.querySelector(selector);
      if (node) node.setAttribute('content', value);
    };
    set('meta[name="description"]', desc);
    set('meta[name="keywords"]', t('meta.keywords'));
    set('meta[property="og:title"]', title);
    set('meta[property="og:description"]', t('meta.ogDesc'));
    set('meta[name="twitter:title"]', title);
    set('meta[name="twitter:description"]', t('meta.ogDesc'));
    set('meta[property="og:locale"]', isKorea ? 'ko_KR' : 'en_US');
    set('meta[property="og:locale:alternate"]', isKorea ? 'en_US' : 'ko_KR');

    // 구조화 데이터도 같은 설명을 말하게 맞춘다
    const ld = document.getElementById('ldJson');
    if (ld) {
      try {
        const data = JSON.parse(ld.textContent);
        data.description = desc;
        data.inLanguage = lang;
        ld.textContent = JSON.stringify(data, null, 2);
      } catch (err) {
        /* 구조화 데이터가 깨져도 화면은 그대로 간다 */
      }
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    apply();
    applyMeta(document.body.classList.contains('mobile-page'));
  });
})();
