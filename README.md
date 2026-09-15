# phone2pc — 폰에서 찍은 사진을 PC로

카카오톡 나에게 보내기, 이메일, Keep을 거치지 않고
**PC에서 QR을 띄우고 → 폰으로 찍고 → 사진을 고르면 → PC 화면에 바로** 뜨는 웹앱입니다.

설치도 로그인도 필요 없고, **사진은 어디에도 저장되지 않습니다.** 서버 메모리에 잠깐 들고 있다가 PC가 받아가면 버립니다.

## 로컬에서 실행

```bash
npm install
node server.js
```

`http://localhost:8080` 으로 접속합니다. 로컬 실행에서는 같은 와이파이의 폰이 바로 접속할 수 있도록 PC의 LAN IP를 감지해 QR에 넣습니다.

## 배포 (Firebase Hosting + Cloud Run)

**자동 배포는 걸려 있지 않습니다.** `git push` 만으로는 서비스가 바뀌지 않으니,
아래 세 단계를 순서대로 직접 실행합니다.

> **Windows에서는 `gcloud.cmd` / `firebase.cmd` 로 부릅니다.**
> PowerShell 실행 정책이 기본값(Restricted)이면 `gcloud` 는 `gcloud.ps1` 을 타다 막힙니다.
> `.cmd` 는 cmd.exe가 실행하므로 정책과 무관합니다. 실행 정책을 바꿀 필요는 없습니다.

> **`--source .` 는 반드시 프로젝트 폴더에서.**
> 현재 폴더를 통째로 올리는 옵션입니다. 다른 곳(예: Cloud Shell 홈)에서 실행하면
> 엉뚱한 소스가 올라가 `COPY failed: no source files were specified` 로 빌드가 깨집니다.
> Cloud Shell에서 하려면 `git clone` 후 그 폴더로 `cd` 한 뒤 실행하세요.

### 1. GitHub (소스 보관)

```bash
git add -A
git commit -m "설명"
git push origin main
```

배포에 꼭 필요하지는 않지만, 먼저 올려 두면 어느 코드가 서비스 중인지 나중에 확인할 수 있습니다.

### 2. Cloud Run (서버)

`Dockerfile` 이 그대로 쓰입니다. 빌드 단계가 없어서 이미지가 가볍습니다. 3~5분 걸립니다.

```bash
gcloud.cmd run deploy phone2pc --source . --region asia-northeast3 --allow-unauthenticated --max-instances 1 --concurrency 10 --memory 1Gi --timeout 120
```

> **`--max-instances 1` 은 필수입니다.**
> 세션이 인스턴스 메모리에만 있어서, 인스턴스가 2개 이상이면 폰이 업로드한 인스턴스와
> PC가 폴링하는 인스턴스가 갈려 "사진을 보냈는데 PC에 안 뜨는" 현상이 생깁니다.
> 세션 어피니티로는 해결되지 않습니다 — 폰과 PC는 서로 다른 클라이언트라 각자 다른 인스턴스에 붙습니다.

> **`--memory 1Gi --concurrency 10` 도 함께 지정하세요.**
> 한 번에 120장(약 100MB)을 받을 수 있게 하면서 컨테이너가 죽지 않으려면 둘이 짝입니다.
> 업로드 본문은 메모리에 통째로 올라오므로, 보관량 500MB + 동시 업로드 10 × 20MB + 여유분으로 1Gi를 잡습니다.
> 동시 처리 수를 기본값(80)으로 두면 업로드가 겹칠 때 메모리를 넘겨 컨테이너가 재시작되고,
> 그 순간 **모든 사용자의 세션이 한꺼번에 사라집니다.**

### 3. Firebase Hosting (정적 파일)

```bash
firebase.cmd deploy --only hosting
```

`firebase.json` 이 `public/` 을 CDN으로 서빙하고 나머지 모든 경로를 Cloud Run(`phone2pc`, `asia-northeast3`)으로 넘깁니다.

**반드시 Cloud Run 다음에 실행하세요.** 순서를 바꾸면 `/ko`, `/en` 처럼 서버가 만드는 주소가
잠깐 404가 됩니다.

### 4. 배포 확인

```bash
curl -s -o /dev/null -w "%{http_code} " https://phone2pc.iuser.kr/ko https://phone2pc.iuser.kr/en https://phone2pc.iuser.kr/og-image.png https://phone2pc.iuser.kr/sitemap.xml
```

`200 200 200 200` 이면 정상입니다. 언어 협상은 이렇게 봅니다.

```bash
curl -s -H "Accept-Language: en-US" https://phone2pc.iuser.kr/ | grep -o "<title>[^<]*"
```

첫 화면 문구나 공유 카드를 바꿨다면 [카카오 OG 캐시 초기화](https://developers.kakao.com/tool/clear/og)도
해주세요. 안 하면 카톡 공유 카드에 옛 내용이 그대로 남습니다.

## 동작 방식

```
PC                                    서버(Cloud Run)              폰
──────────────────────────────────────────────────────────────────────────
POST /api/session          ──▶  세션 생성 (메모리)
QR 생성 (브라우저에서)                                    ◀── QR 스캔
                                                          POST /api/hello/:id
GET /api/poll/:id  (1.2~5초) ──▶  목록만 반환
                                  ◀── POST /api/upload/:id  (raw 바이트)
GET /api/file/:id/:fid     ──▶  이미지 원본
```

설계상 짚어둘 점:

- **실시간은 폴링**입니다. SSE는 Firebase Hosting의 60초 요청 타임아웃에 걸립니다.
- **폴링 응답에는 메타데이터만** 담고 이미지는 별도 요청으로 받습니다. base64로 실어 보내면 용량이 33% 늘고, 폴링마다 수 MB가 오갑니다.
- 폴링은 **1.2초에서 시작해 변화가 없으면 5초까지 늘어나고**, 탭이 가려지면 8초로 떨어집니다. Cloud Run은 요청 수로 과금되므로 대기 중 호출을 줄이는 게 곧 비용입니다.
- 세션 ID는 `crypto.randomBytes` 기반 12자입니다.
- 폰에서는 기본적으로 긴 변 2048px / JPEG 0.85로 줄여서 보냅니다. 원본이 필요하면 스위치로 끕니다.

## 설정 (환경변수)

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `PORT` | `8080` | 서버 포트 (Cloud Run이 자동 주입) |
| `MAX_FILE_MB` | `20` | 파일 1개 최대 크기 |
| `MAX_SESSION_MB` | `150` | 세션 1개가 들고 있을 수 있는 총량 |
| `MAX_TOTAL_MB` | `500` | 서버 전체 메모리 상한. 넘으면 오래된 세션부터 버림 |
| `MAX_ITEMS` | `120` | 세션당 최대 파일 수 |
| `MAX_ORIGINAL_ITEMS` | `20` | 그중 원본 화질로 받을 수 있는 수 |
| `SESSION_TTL_MIN` | `30` | 이 시간 동안 아무 요청 없으면 세션 삭제 |
| `SESSIONS_PER_IP_HOUR` | `30` | IP 하나가 한 시간에 만들 수 있는 QR 수 |
| `UPLOAD_GB_PER_IP_DAY` | `3` | IP 하나가 하루에 올릴 수 있는 총량 |
| `DAILY_EGRESS_GB` | `6` | 하루 전송량 상한. 넘으면 새 세션만 막음 (월 $30 예산 기준) |
| `STATS_TOKEN` | 없음 | 설정하면 `/api/stats?token=…` 가 맞아야 열림 |
| `HOST_IP` | 자동 감지 | 로컬 실행 시 QR에 넣을 IP 고정 |

## 대량 전송 (100장 보내기)

한 세션에 **축소 모드 120장 / 원본 화질 20장**까지 받습니다. 원본은 장당 3~5MB라
100장이면 400MB를 넘기 때문에 따로 묶었습니다. 폰이 `X-Shrunk` 헤더로 둘을 구분해 알려줍니다.

100장을 보낼 때 실제로 일어나는 일:

- 폰은 **한 장을 보내는 동안 다음 장을 준비**합니다. CPU(줄이기)와 네트워크(전송)를 겹쳐서
  100장 기준 2~4분이 걸립니다.
- 끊기면 **최대 3번까지 다시 보냅니다.** 100장 중 몇 장은 모바일 망에서 반드시 끊깁니다.
  그래도 실패한 것은 「실패한 N장 다시 보내기」 버튼으로 모아서 재시도합니다.
- 전송 중에는 **Wake Lock으로 화면이 꺼지지 않게** 잡습니다. 화면이 꺼지면 브라우저가 멈춰
  전송이 중단되기 때문입니다. (지원하지 않는 기기에서는 문구로 안내)
- 폰이 **PC 목록용 작은 미리보기(긴 변 320px)를 따로 만들어 함께 보냅니다.** PC가 원본을
  미리보기로 쓰면 같은 사진이 두 번 나가서 전송비가 두 배가 됩니다.
- PC에서 **저장이 끝난 파일은 서버에서 바로 지웁니다**(`?once=1`). 세션 메모리를 붙잡는
  시간이 짧아져야 여러 사람이 동시에 쓸 수 있습니다.

운영 중 상태는 `/api/stats` 로 봅니다. 보관 중인 용량과 그날 전송량이 함께 나옵니다.

```bash
curl -s https://phone2pc.iuser.kr/api/stats
```

## 구조

```
server.js          Express 서버 (세션·업로드·폴링·ZIP)
src/zip.js         store 방식 ZIP 생성기 (메모리/디스크 양쪽 지원)
public/qr.js       의존성 없는 QR 생성기 — 브라우저에서 실행
public/desktop.*   PC 화면
public/mobile.*    폰 화면
public/i18n-strings.js  화면 문구표 (서버·브라우저 공용)
public/i18n.js     브라우저 쪽 문구 적용
tools/og-image.ps1 공유 카드 이미지(public/og-image.png) 생성기
tools/resize-promo.ps1   상품 사진을 화면 크기에 맞게 줄이는 도구
public/promo/      하단 배너 상품 사진 (배포됨)
promo-src/         그 원본 사진 보관 (배포 안 됨)
Dockerfile         Cloud Run 이미지
firebase.json      Hosting → Cloud Run 리라이트
```

## 주소와 언어 (SEO)

| 주소 | 언어 | 쓰임 |
|---|---|---|
| `/` | Accept-Language로 결정 | 도메인만 치고 들어온 사람. 색인 대상이 아니며 `canonical`이 내보낸 언어 쪽(`/ko` 또는 `/en`)을 가리킨다 |
| `/ko` | 한국어 고정 | 검색엔진이 색인하는 한국어 주소 |
| `/en` | 영어 고정 | 검색엔진이 색인하는 영어 주소 |
| `/s/:id` | Accept-Language로 결정 | 폰 화면. 1회용이라 `noindex` |

화면 문구는 `public/i18n-strings.js` 한 곳에만 둡니다. 서버가 이 표를 읽어 HTML을 언어별로 만들어
내려주므로, 자바스크립트를 돌리지 않는 검색엔진도 제 언어로 페이지를 읽습니다.
HTML만 고치고 표를 안 고치면 서버가 뜰 때 경고를 찍습니다.

`?lang=ko` / `?lang=en` 을 붙이면 강제로 바꿀 수 있습니다. 국내에서 국외 화면을 확인할 때 씁니다.

> 광고 지역 판정(`I18N.isKorea`)은 계속 브라우저의 표준시간대로 합니다. 서버 헤더로 국가를 정하면
> `/api/ads` 응답이 CDN에 공유 캐시되면서 한 사람의 국가가 다른 사람에게 새어 나갈 수 있습니다.

문구나 공유 카드 문안을 바꿨다면 `tools/og-image.ps1` 을 다시 돌려 이미지도 맞춰 주세요.

## 남은 과제

> 공개 운영 시의 남용 위험과 대응 상태는 [OPERATIONS.md](OPERATIONS.md)에 따로 정리해 두었습니다.

- **동시 사용자 확장** — 지금은 `max-instances=1` 로 묶어야 합니다. 인스턴스를 늘리려면 세션 저장소를 Firestore/Redis로, 파일 본문을 Cloud Storage로 빼야 합니다.
- **남용 방지** — 로그인이 없어 세션 생성이 무제한입니다. 공개 운영 전에 IP당 세션 생성 제한이나 App Check를 붙이는 게 좋습니다.
- **개인정보 처리방침** — 사진을 보관하지는 않지만 일시적으로 서버를 지나갑니다. 공개 서비스라면 그 사실을 고지하는 편이 안전합니다.

## 하단 배너 (구글 애드센스 · 네이버 쇼핑 커넥트)

설정은 프로젝트 루트 **`banners.json` 한 파일**에서만 관리합니다. 값이 비어 있으면 실제 광고 대신 자리만 표시되어 레이아웃이 흔들리지 않습니다.

```json
{
  "adsense": { "client": "ca-pub-...", "slotDesktop": "1234567890", "slotMobile": "0987654321" },
  "naver": { "items": [ { "badge": "...", "title": "...", "description": "...", "url": "https://naver.me/..." } ] }
}
```

- `adsense.client` 를 채우면 **`/ads.txt` 가 자동으로 생성**됩니다. (`google.com, pub-..., DIRECT, f08c47fec0942fa0`)
- Cloud Run 환경변수 `ADSENSE_CLIENT`, `ADSENSE_SLOT_DESKTOP`, `ADSENSE_SLOT_MOBILE` 이 있으면 그쪽이 우선합니다.
- 네이버 링크는 `rel="sponsored noopener noreferrer"` 로 나가고, 수수료 고지 문구가 항상 함께 표시됩니다.
- 로컬 실행 중에는 `banners.json` 을 고치고 **새로고침만** 하면 반영됩니다. (클라우드에서는 재배포 시 반영)

### 상품 사진

상품 사진은 `public/promo/` 에 두고 `banners.json` 에서 `/promo/파일명.jpg` 로 가리킵니다.
새 사진을 넣은 뒤에는 한 번 줄여 주세요. 원본은 `promo-src/` 로 옮겨 보관하고,
이미 작은 파일은 건너뛰므로 여러 번 돌려도 안전합니다.

```bash
powershell -ExecutionPolicy Bypass -File tools/resize-promo.ps1
```

썸네일은 PC 74px, 폰 76px로 나갑니다. 3배 화면까지 또렷하도록 240px로 맞춥니다.
500px 원본 6장 기준 279KB → 65KB 로 줄어듭니다.

이미지는 `firebase.json` 에서 30일 캐시로 잡혀 있습니다. **상품을 교체할 때는 같은 파일명을
덮어쓰지 말고 `_2` 처럼 새 이름으로 올려 주세요.** 덮어쓰면 재방문자에게 최대 30일 동안
옛 사진이 보입니다. 새 상품을 추가하는 경우에는 파일명이 어차피 다르므로 신경 쓰지 않아도 됩니다.

## 도메인 연결 (phone2pc.iuser.kr)

1. Firebase 콘솔 → Hosting → **맞춤 도메인 추가** → `phone2pc.iuser.kr`
2. 안내되는 **A 레코드 2개**(또는 TXT 소유권 확인)를 `iuser.kr` DNS에 등록
3. 인증서 발급까지 보통 수십 분 ~ 몇 시간
4. 연결 후 `https://phone2pc.iuser.kr/ads.txt` 가 열리는지 확인 (애드센스가 이 파일을 봅니다)
