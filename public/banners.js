'use strict';

// 하단 제휴·광고 영역. 설정은 프로젝트 루트의 banners.json 한 곳에서만 관리한다.
// 값이 비어 있으면 실제 광고 대신 자리만 표시해서 레이아웃이 흔들리지 않게 한다.

(function () {
  const mount = document.getElementById('siteFooter');
  if (!mount) return;

  const isMobilePage = document.body.classList.contains('mobile-page');

  const T = (key, vars) => window.I18N.t(key, vars);
  const P = (source, field) => window.I18N.pick(source, field);

  function loadJson(url) {
    return fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  }

  /**
   * 회사정보와 광고 설정을 따로 불러온다.
   *
   * 광고 차단기를 쓰면 /api/ads 요청이 막힌다. 한 번에 받아 오면 그때 하단 전체가
   * 사라져서 약관·문의 링크까지 없어진다. 광고는 못 받아도 회사정보는 항상 그린다.
   */
  Promise.all([loadJson('/api/site'), loadJson('/api/ads')])
    .then(([siteConfig, ads]) => {
      const site = (siteConfig && siteConfig.site) || (ads && ads.site) || {};
      render(ads, site);
    })
    .catch(() => { /* 하단을 못 그려도 서비스 본체는 그대로 동작해야 한다 */ });

  function render(config, site) {
    // 광고 설정을 못 받았으면(차단기 등) 광고 자리는 아예 만들지 않는다
    if (config) mount.appendChild(adsPart(config));
    mount.appendChild(siteInfo(site));
  }

  function adsPart(config) {
    const naver = config.naver || {};
    const items = Array.isArray(naver.items) ? naver.items : [];
    const adsense = config.adsense || {};
    const slot = isMobilePage ? adsense.slotMobile : adsense.slotDesktop;

    /**
     * 네이버 쇼핑 커넥트는 국내 접속이면서 한국어 화면일 때만 노출한다.
     *
     * 표준시간대만 보면 한국에서 영어 화면(/en)을 열었을 때 영어 페이지에 한국어 상품
     * 배너가 끼어든다. 상품 문구가 한국어뿐이라 언어 조건을 함께 본다.
     */
    const forKorea = window.I18N.isKorea && window.I18N.lang === 'ko';
    const shown = forKorea ? pickRandom(items, naver.showCount) : [];

    // 제휴·광고는 본문과 같은 밝은 카드로, 회사 정보는 페이지 끝을 알리는 짙은 띠로 나눈다
    const top = document.createElement('div');
    top.className = 'footer-top';
    if (shown.length > 0) top.appendChild(naverSection(naver, shown));
    top.appendChild(adSection(adsense.client, slot));

    if (adsense.client && slot) loadAdsense(adsense.client);
    return top;
  }

  // ------------------------------------------------------- 네이버 쇼핑 커넥트

  /** 등록된 상품 중 count개를 무작위로 고른다. 원본 배열은 건드리지 않는다. */
  function pickRandom(items, count) {
    const size = Math.max(1, Number(count) || 2);
    const pool = items.slice();
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const swap = pool[i];
      pool[i] = pool[j];
      pool[j] = swap;
    }
    return pool.slice(0, size);
  }

  function naverSection(naver, items) {
    const section = document.createElement('section');
    section.className = 'promo';

    const head = document.createElement('div');
    head.className = 'promo-head';
    const tag = document.createElement('span');
    tag.className = 'promo-tag';
    tag.textContent = '네이버쇼핑';
    const title = document.createElement('span');
    title.textContent = naver.title || '함께 보면 좋은 상품';
    head.append(tag, title);

    const list = document.createElement('div');
    list.className = 'promo-items';
    for (const item of items) list.appendChild(promoCard(item));

    const note = document.createElement('p');
    note.className = 'promo-note';
    note.textContent =
      '* 본 배너는 네이버 쇼핑 커넥트 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.';

    section.append(head, list, note);
    return section;
  }

  function promoCard(item) {
    const ready = Boolean(item.url);
    const card = document.createElement(ready ? 'a' : 'div');
    card.className = 'promo-card' + (ready ? '' : ' pending');
    if (ready) {
      card.href = item.url;
      card.target = '_blank';
      // 제휴 링크는 원본 페이지 정보를 넘기지 않고, 탭 탈취도 막는다
      card.rel = 'sponsored noopener noreferrer';
    }

    // 썸네일은 선택 사항이다. 주소가 막히거나 깨지면 글씨만 남기고 조용히 빠진다.
    if (item.image) {
      const thumb = document.createElement('img');
      thumb.className = 'promo-thumb';
      thumb.src = item.image;
      thumb.alt = '';
      thumb.loading = 'lazy';
      thumb.referrerPolicy = 'no-referrer';
      thumb.onerror = () => thumb.remove();
      card.appendChild(thumb);
    }

    const body = document.createElement('div');
    body.className = 'promo-body';

    if (item.badge) {
      const badge = document.createElement('span');
      badge.className = 'promo-badge';
      badge.textContent = item.badge;
      body.appendChild(badge);
    }

    const name = document.createElement('div');
    name.className = 'promo-name';
    name.textContent = item.title || '네이버쇼핑 추천 상품';

    const desc = document.createElement('div');
    desc.className = 'promo-desc';
    desc.textContent = item.description || '';

    const go = document.createElement('div');
    go.className = 'promo-go';
    go.textContent = ready ? '네이버에서 보기 →' : '링크 준비 중';

    body.append(name, desc, go);
    card.appendChild(body);
    return card;
  }

  // -------------------------------------------------------------- 구글 애드센스

  function adSection(client, slot) {
    const section = document.createElement('section');
    section.className = 'adslot';

    const label = document.createElement('div');
    label.className = 'adslot-label';
    const tag = document.createElement('span');
    tag.className = 'adslot-tag';
    tag.textContent = 'AD';
    const text = document.createElement('span');
    text.textContent = T('f.adLabel');
    label.append(tag, text);
    section.appendChild(label);

    if (client && slot) {
      const ins = document.createElement('ins');
      ins.className = 'adsbygoogle';
      ins.style.display = 'block';
      ins.style.width = '100%';
      ins.style.minHeight = '90px';
      ins.setAttribute('data-ad-client', client);
      ins.setAttribute('data-ad-slot', slot);
      ins.setAttribute('data-ad-format', 'auto');
      ins.setAttribute('data-full-width-responsive', 'true');
      section.appendChild(ins);
    } else {
      const placeholder = document.createElement('div');
      placeholder.className = 'adslot-empty';
      placeholder.innerHTML =
        T('f.adPlaceholder') + '<br><small>' + T('f.adPlaceholderSub') + '</small>';
      section.appendChild(placeholder);
    }
    return section;
  }

  let adsenseLoaded = false;
  function loadAdsense(client) {
    if (adsenseLoaded) return;
    adsenseLoaded = true;
    const script = document.createElement('script');
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.src =
      'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' +
      encodeURIComponent(client);
    script.onload = () => {
      try {
        (window.adsbygoogle = window.adsbygoogle || []).push({});
      } catch (err) {
        /* 광고 차단기가 있어도 화면은 그대로 둔다 */
      }
    };
    document.head.appendChild(script);
  }

  // ---------------------------------------------------------------- 회사 정보

  const SVG_NS = 'http://www.w3.org/2000/svg';

  // 선 아이콘. currentColor를 쓰므로 라이트/다크 모두 자동으로 맞는다.
  const ICON_PATHS = {
    logo: ['M4 3h6.5v18H4z', 'M14.5 12h6.5', 'M18 9l3 3-3 3'],
    shield: ['M12 3l7.5 3v5.2c0 4.6-3.1 8.4-7.5 10.3C7.6 19.6 4.5 15.8 4.5 11.2V6L12 3z'],
    book: ['M4.5 5.5A2.5 2.5 0 017 3h12.5v14.5H7A2.5 2.5 0 004.5 20V5.5z', 'M19.5 17.5V21H7'],
    info: ['M12 21a9 9 0 100-18 9 9 0 000 18z', 'M12 11v5', 'M12 7.8h.01'],
    chat: ['M20.5 11.5a7.5 7.5 0 01-10.6 6.8L4 20l1.7-5.4A7.5 7.5 0 1120.5 11.5z'],
    bug: ['M8 7a4 4 0 018 0', 'M6 10.5h12v3.5a6 6 0 01-12 0v-3.5z', 'M4 11H2.5', 'M21.5 11H20', 'M4.5 17.5L3 18.5', 'M19.5 17.5l1.5 1'],
    ad: ['M3 9.5h4l6-4.5v14l-6-4.5H3v-5z', 'M17.5 8.5a5 5 0 010 7'],
    ext: ['M14 4h6v6', 'M20 4l-8.5 8.5', 'M18 14v5.5a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 014 19.5v-11A1.5 1.5 0 015.5 7H11']
  };

  function icon(name, size) {
    const paths = ICON_PATHS[name];
    if (!paths) return null;
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.7');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    for (const d of paths) {
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', d);
      svg.appendChild(path);
    }
    return svg;
  }

  /** url이 없으면 클릭 불가한 span으로 만들어 깨진 링크가 나가지 않게 한다. */
  function linkNode(link, className) {
    const ready = Boolean(link.url);
    const node = document.createElement(ready ? 'a' : 'span');
    node.className = className + (ready ? '' : ' pending') + (link.accent ? ' accent' : '');
    if (ready) {
      node.href = link.url;
      node.target = '_blank';
      node.rel = 'noopener noreferrer';
    } else {
      node.title = T('f.pending');
    }
    const glyph = link.icon ? icon(link.icon, 15) : null;
    if (glyph) node.appendChild(glyph);
    node.appendChild(document.createTextNode(P(link, 'label')));
    if (ready) {
      const ext = icon('ext', 12);
      ext.classList.add('ext-mark');
      node.appendChild(ext);
    }
    return node;
  }

  /** 첫 문장만 잘라 쓴다. summary 값이 없을 때의 대비책이다. */
  function firstSentence(text) {
    const cut = String(text).match(/^[^.!?]{10,90}[.!?]/);
    return cut ? cut[0].trim() : String(text).slice(0, 90).trim();
  }

  function siteInfo(site) {
    const band = document.createElement('div');
    band.className = 'site-info-band';

    const box = document.createElement('div');
    box.className = 'site-info';
    band.appendChild(box);

    // 1열: 로고 · 한 줄 소개 · 도메인
    const about = document.createElement('div');
    about.className = 'si-about';

    const head = document.createElement('div');
    head.className = 'si-head';
    const logo = document.createElement('span');
    logo.className = 'si-logo';
    logo.appendChild(icon('logo', 20));
    const name = document.createElement('span');
    name.className = 'si-name';
    name.textContent = P(site, 'name') || 'phone2pc';
    head.append(logo, name);
    about.appendChild(head);

    const taglineText = P(site, 'tagline');
    const noticeText = P(site, 'notice');
    const summaryText = P(site, 'summary') || (taglineText ? firstSentence(taglineText) : '');

    if (summaryText) {
      const summary = document.createElement('p');
      summary.className = 'si-summary';
      summary.textContent = summaryText;
      about.appendChild(summary);
    }

    /**
     * 긴 소개와 이용 고지는 접어 둔다.
     * 하단이 화면을 다 차지하면 정작 서비스가 안 보인다. 특히 폰에서.
     */
    if (taglineText || noticeText) {
      const more = document.createElement('details');
      more.className = 'si-more';
      const label = document.createElement('summary');
      label.textContent = T('f.moreInfo');
      more.appendChild(label);

      if (taglineText) {
        const tagline = document.createElement('p');
        tagline.className = 'si-tagline';
        tagline.textContent = taglineText;
        more.appendChild(tagline);
      }
      if (noticeText) {
        const notice = document.createElement('p');
        notice.className = 'si-notice';
        notice.textContent = noticeText;
        more.appendChild(notice);
      }
      about.appendChild(more);
    }

    const meta = document.createElement('div');
    meta.className = 'si-meta';
    if (site.domain) {
      const wrap = document.createElement('span');
      wrap.append(T('f.domain') + ': ');
      wrap.appendChild(linkNode(
        { label: site.domain, url: site.domainUrl }, 'si-domain'
      ));
      meta.appendChild(wrap);
    }
    if (site.boardUrl) {
      const sep = document.createElement('span');
      sep.className = 'si-sep';
      sep.textContent = '·';
      const wrap = document.createElement('span');
      wrap.append(T('f.contact') + ': ');
      wrap.appendChild(linkNode(
        { label: site.boardLabel || site.boardUrl, url: site.boardUrl }, 'si-board'
      ));
      meta.append(sep, wrap);
    }
    if (meta.childNodes.length > 0) about.appendChild(meta);

    box.appendChild(about);

    // 2~3열: 링크 묶음
    for (const group of (site.groups || [])) {
      const col = document.createElement('nav');
      col.className = 'si-group';

      const title = document.createElement('div');
      title.className = 'si-group-title';
      title.textContent = P(group, 'title');
      col.appendChild(title);

      for (const link of (group.links || [])) col.appendChild(linkNode(link, 'si-link'));
      box.appendChild(col);
    }

    // 하단 바: 저작권 + 축약 링크
    const bottom = document.createElement('div');
    bottom.className = 'si-bottom';

    const copy = document.createElement('div');
    copy.className = 'si-copy';
    copy.textContent =
      `© ${new Date().getFullYear()} ${P(site, 'copyright') || 'phone2pc'}. All rights reserved.`;
    bottom.appendChild(copy);

    const mini = document.createElement('div');
    mini.className = 'si-mini';
    (site.bottomLinks || []).forEach((link, index) => {
      if (index > 0) {
        const sep = document.createElement('span');
        sep.className = 'si-sep';
        sep.textContent = '·';
        mini.appendChild(sep);
      }
      mini.appendChild(linkNode(link, 'si-mini-link'));
    });
    if (mini.childNodes.length > 0) bottom.appendChild(mini);

    box.appendChild(bottom);
    return band;
  }
})();
