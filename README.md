# d612.space — 운영 가이드

개인 포토그래피 사이트. Astro 정적 사이트 → GitHub → Vercel 자동 배포.

- **라이브**: https://d612.space
- **저장소**: https://github.com/RangeAreaScent/photography-website
- **호스팅**: Vercel (프로젝트명 `d612`)

---

## 빠른 시작

### 로컬에서 사이트 띄우기

Finder에서 `start.command` 더블클릭 → 브라우저가 자동으로 http://localhost:4321 열림.

또는 터미널:

```bash
cd "~/Projects/Photography website"
npm run dev
```

종료: Terminal 창 닫기 또는 Ctrl+C.

### Admin GUI로 사진 올리기 (가장 쉬움)

Finder에서 `admin.command` 더블클릭 → http://localhost:4322 자동 오픈.

**사이드바 (좌측)**
- Monthly / Works 목록, 각 항목 클릭으로 편집
- "+ new" 버튼으로 새 월간/시리즈 생성

**메인 편집 화면 (우측)** — 시리즈 기준:
- 제목·연도·순서·intro·slug 필드
- 드롭존: 사진을 드래그-드롭 (또는 클릭) → 자동으로 `originals/`에 저장
- **Photos in series** — 시리즈에 포함된 사진들
  - `⋮⋮` 드래그 핸들로 순서 변경
  - 파일명 **클릭 → 인라인 편집** (Enter 저장 / Esc 취소) — `originals/` + `src/content/` + `.md` 동시 업데이트
  - 각 사진에 **Title / Caption** 입력
  - `⤓` → candidates로 강등 (시리즈에서 빼고 보류 폴더로)
  - `×` 시리즈에서 제거 (파일은 top-level에 그대로 남음)
- **In folder, not in series** — `originals/[slug]/` top-level에 있지만 `.md`엔 없는 파일
  - `+ add` → 시리즈에 추가
  - `→ candidates` → 보류 폴더로
  - `+ add all to series` → 한 번에 다 추가
- **Candidates** — `originals/[slug]/_candidates/` 안의 보류 파일들
  - `+ add to series` → 다시 시리즈로 승격
  - `archive` → `_archive/` 로 이동 (영구 보관, 복구 가능)
- **Danger zone** (하단, 빨간색) — 시리즈 통째로 삭제
  - 사이트·git에서 제거
  - `originals/works/[slug]/` 전체가 `_archive/works/[slug]/`로 이동
  - 복구는 폴더 다시 옮기고 `.md` 재작성

**Publish 버튼** → `prepare-photos` 자동 실행 → git commit → push → Vercel 배포 (1~2분)

종료: Terminal 창 닫기.

### 배포

```bash
git add -A
git commit -m "설명"
git push
```

Push하면 Vercel이 자동으로 빌드·배포. 1~2분 후 https://d612.space 에 반영됨.

---

## 사진 운영 구조 (중요)

원본 사진은 **`originals/` 폴더**에 들어가고 (git에 안 올라감), 변환된 작은 파일이 자동으로 **`src/content/`** 에 생기는 구조입니다.

```
originals/                          ← 로컬에만, git에서 제외 (대용량 원본 보관)
├── monthly/
│   └── 2026-07.jpg                 (카메라 원본 그대로, 10~20MB)
├── works/
│   └── 02-concrete-geometry/
│       ├── 01.jpg                  (선정된 사진, .md에 포함됨)
│       └── _candidates/            ("나중에 쓸 수도" 보류 파일들)
│           └── unused.jpg
└── _archive/                       (완전히 폐기 — 복구 가능한 보관소)
    └── works/
        └── 02-old-series/          (삭제된 시리즈 또는 archive된 사진)
            └── ...

src/content/                        ← git에 들어감, 변환된 작은 파일
├── monthly/
│   ├── 2026-07.jpg                 (긴 쪽 3000px·JPEG 90%·GPS 제거, ~2MB)
│   └── 2026-07.md                  ← 메타데이터는 여기서 편집
└── works/...
```

**변환은 자동.** `npm run dev` 또는 `npm run build`를 실행하면 그 전에 `prepare-photos` 스크립트가 돌면서 `originals/`에 새 파일이 있으면 자동으로 변환해 `src/content/`에 떨굽니다. 수동으로 돌리고 싶으면 `npm run prepare-photos`.

`_` 접두사 폴더(`_candidates/`, `_archive/` 등) 안의 파일은 변환되지 않음 — 보류·폐기 파일을 같이 보관해도 사이트엔 영향 없음.

#### Orphan 정리 (선택)

가끔 admin/Finder 작업 중에 `.md`에선 빠졌는데 `src/content/`엔 남아있는 파일이 생길 수 있어요. 이런 orphan들이 누적되면 repo가 무거워집니다.

```bash
npm run prepare-photos -- --prune
```

`.md` 어느 곳에서도 참조되지 않는 src/content/ JPEG들을 자동으로 제거합니다. **`.md`가 현재 의도와 일치하는지 먼저 확인하세요** (잘못된 .md를 두고 --prune 하면 실제 보여줘야 할 사진까지 사라집니다).

### 사진의 4단계 라이프사이클

```
                    [시리즈 발표]
                          ↑
                      + add │ × remove (.md에서만)
                          ↓
            originals/works/[slug]/        ← top-level (활성)
                          │
                      ⤓   │   ↑ + add
                          ↓
            originals/works/[slug]/_candidates/   ← 시리즈 내 보류
                          │
                    archive│   (복구는 수동)
                          ↓
            originals/_archive/works/[slug]/      ← 완전 폐기, 영구 보관
```

| 상태 | 위치 | 사이트에 보임? | 변환됨? | 복구 |
|---|---|---|---|---|
| **시리즈 발표** | `originals/works/[slug]/file.jpg` + `.md`에 등록 | ✓ | ✓ | — |
| **top-level (untracked)** | `originals/works/[slug]/file.jpg`, `.md` 미등록 | ✗ | ✗ (prepare-photos가 만들 수도) | — |
| **시리즈 내 보류** | `originals/works/[slug]/_candidates/file.jpg` | ✗ | ✗ | admin에서 `+ add to series` |
| **완전 폐기** | `originals/_archive/works/[slug]/file.jpg` | ✗ | ✗ | 폴더 수동 이동 |

**영구 삭제는 없음** — 모든 "삭제" 액션이 archive로 비파괴적으로 이동합니다. 디스크 공간이 정말 부족할 때만 `_archive/` 폴더를 수동으로 비우세요.

### Archive에서 복구하기

```bash
# 단일 사진 복구 (시리즈로 되돌리기)
mv originals/_archive/works/02-foo/photo.jpg originals/works/02-foo/_candidates/
# → admin에서 candidates에 나타남 → "+ add to series" 클릭

# 시리즈 통째로 복구
mv originals/_archive/works/02-old-series originals/works/02-old-series
# → admin에서 "+ new" → slug를 02-old-series로 → "Refresh from disk" → "+ add all to series"
```

---

## 매달 사진 올리기 (Monthly)

### 1. 원본을 `originals/monthly/`에 떨구기

- Lightroom/Capture One/카메라 앱에서 export한 JPEG 원본
- 파일명: **소문자** `.jpg`, 날짜 기반 (예: `2026-07.jpg`)
- 원본 크기·메타 그대로 둬도 됩니다 — 스크립트가 알아서 줄이고 GPS 제거

### 2. `.md` 메타데이터 작성

`src/content/monthly/2026-07.md` 만들기:

### 3. `.md` 파일 내용

```markdown
---
date: 2026-07-15
photo: ./2026-07.jpg
caption: 사진 타이틀 (예: Raining forest)
---

여기에 그 달의 생각·맥락을 자유롭게 적습니다.

여러 단락도 OK. 마크다운 문법 (강조, 링크 등) 다 됩니다.
```

- `date`: YYYY-MM-DD 형식. 사이트는 이 날짜로 정렬·표시
- `photo`: 같은 폴더의 사진 파일 경로 (상대 경로 `./`로 시작)
- `caption`: **선택**. 사진 아래 첫 줄에 검정으로 표시 (없으면 날짜만 나옴)
- `---` 아래 본문: **선택**. Monthly 페이지에서만 보임. 날짜 아래 공백 하나 두고 가운데 정렬 단락으로 렌더링

### 4. Push

```bash
git add -A
git commit -m "monthly: 2026-07"
git push
```

→ https://d612.space/monthly 의 sub-nav에 자동으로 추가됨.

---

## 새 시리즈 추가 (Works)

작품집 형태로 여러 사진을 묶는 흐름.

### 1. 원본을 `originals/works/<slug>/`에 떨구기

```
originals/works/04-new-series/
├── 01.jpg
├── 02.jpg
└── _candidates/        ← 후보 사진은 여기, 변환 안 됨
    └── ...
```

- 슬러그(`new-series`)는 URL이 됨: `d612.space/works/04-new-series`
- 폴더명 = `.md` 파일명(확장자 제외)과 같게

### 2. `.md` 파일 작성

`src/content/works/04-new-series.md`:

```yaml
---
title: 시리즈 제목
year: 2026
order: 4
intro: (선택) 시리즈 짧은 설명. 비워두면 표시 안 됨.
photos:
  - src: ./04-new-series/01.jpg
    caption: (선택) 사진별 한 줄 설명
  - src: ./04-new-series/02.jpg
  - src: ./04-new-series/03.jpg
---
```

`./04-new-series/01.jpg` 경로는 **변환 후의 `src/content/` 안 경로** 기준. 스크립트가 알아서 그 자리에 변환본을 떨굽니다.

- `title`: 시리즈 제목 (좌측 sub-nav에 표시)
- `year`: 연도
- `order`: 정렬 순서 (낮을수록 먼저). 새 시리즈는 보통 마지막 번호 +1
- `intro`: 선택. 시리즈 헤더 아래 표시
- `photos`: 사진 목록. `caption`은 선택 — 없으면 사진만 표시

### 3. Push

```bash
git add -A
git commit -m "works: add 시리즈명"
git push
```

→ Works 메뉴 클릭 시 sub-nav에 시리즈 자동 등록.

---

## 기존 시리즈에 사진 추가

이미 있는 시리즈에 사진만 더 넣고 싶을 때.

1. `originals/works/<시리즈>/`에 새 원본 떨구기 (예: `04.jpg`)
2. 해당 `.md`의 `photos:` 목록에 한 줄 추가:

```yaml
photos:
  - src: ./01-first-light/01.jpg
  - src: ./01-first-light/02.jpg
  - src: ./01-first-light/03.jpg
  - src: ./01-first-light/04.jpg   ← 추가
```

3. Push.

---

## 캡션·intro 편집

각 `.md` 파일을 텍스트 에디터(또는 VS Code, Sublime 등)에서 직접 수정. 저장 후 push만 하면 반영됨.

---

## 사진 export 권장 (반복 작업)

매번 같은 export 프리셋 만들어두면 편함.

### Lightroom Classic 프리셋

`File → Export`:

- File Format: **JPEG**
- Quality: **90**
- Color Space: **sRGB**
- Image Sizing: **Long Edge 3000 pixels**
- Sharpening for: Screen, Standard
- Metadata: **Copyright Only** (개인정보·GPS 자동 제거)
- File Naming: `YYYY-MM` 또는 시리즈명-번호

이 설정을 `Export Preset`으로 저장해두면 매번 한 번 클릭.

### EXIF 메타 일괄 제거 (이미 export된 파일)

`exiftool` 설치되어 있음 (한 번 설치하면 끝):

```bash
brew install exiftool   # 처음만

# GPS·위치 메타만 제거 (이미지 품질 유지)
exiftool -gps:all= -location:all= -overwrite_original 파일경로.jpg
```

폴더 전체 한꺼번에:

```bash
exiftool -gps:all= -location:all= -overwrite_original src/content/monthly/*.jpg
```

---

## 자주 바꾸는 것

### 이름·브랜드명

- `src/components/Header.astro` — sidebar 상단 `Doohee Lee`
- `src/layouts/Base.astro` — `siteName`, default title
- `src/pages/about.astro` — title
- `src/pages/404.astro` — title

### 연락처

`src/pages/about.astro` 와 `src/components/Header.astro`의:

- `hello@example.com` → 실제 이메일
- `https://instagram.com` → 실제 인스타그램 URL

### 배경색·텍스트색

`src/styles/global.css` 상단 `:root` 블록:

```css
--bg: #eaeeee;            /* 배경 */
--text: #2a2c2c;          /* 주 텍스트 */
--text-muted: #6a6e6e;    /* 회색 텍스트 */
--text-faint: #9aa0a0;    /* 가장 옅은 회색 */
--rule: #cdd2d2;          /* 구분선 */
```

### 폰트

`src/styles/global.css`:

```css
--font-serif: 'Fraunces', 'Iowan Old Style', 'Source Serif Pro', Georgia, serif;
```

다른 Google Fonts로 바꾸려면 `src/layouts/Base.astro`의 `<link rel="stylesheet" href="https://fonts.googleapis.com/...">`도 같이 교체.

### 사이드바 폭

`src/components/Header.astro`의 `.site-nav { width: 200px }`. Sub-nav 폭은 `.sub-nav { width: 170px; left: 200px }`. 본문 `margin-left`는 `src/layouts/Base.astro`에서 `370px`.

세 값이 연동됨 — 사이드바 폭 바꾸면 sub-nav `left`와 본문 `margin-left`도 같이 조정.

---

## 파일 구조 요약

```
src/
├── pages/
│   ├── index.astro              # /         홈 (이번 달 monthly + 인사글)
│   ├── about.astro              # /about
│   ├── 404.astro                # 404
│   ├── monthly/
│   │   ├── index.astro          # /monthly  → 최신 월 자동 표시
│   │   └── [slug].astro         # /monthly/2026-06
│   └── works/
│       ├── index.astro          # /works    → 첫 시리즈 자동 표시
│       └── [slug].astro         # /works/01-first-light
│
├── content/                     # ← 사진과 메타 여기에 넣기
│   ├── monthly/
│   │   ├── 2026-06.jpg
│   │   └── 2026-06.md
│   └── works/
│       ├── 01-first-light.md
│       └── 01-first-light/
│           ├── 01.jpg
│           ├── 02.jpg
│           └── 03.jpg
│
├── components/
│   └── Header.astro             # 사이드바 + sub-nav
├── layouts/
│   └── Base.astro               # 전체 HTML 셸 + 메타 태그
├── styles/
│   └── global.css               # 색·폰트·타이포 토큰
├── lib/
│   └── og.ts                    # OpenGraph 이미지 생성 헬퍼
└── content.config.ts            # Content Collections 스키마

public/
└── robots.txt                   # 크롤러용

astro.config.mjs                 # site URL, sitemap 설정
package.json
README.md                        # 이 파일
start.command                    # 더블클릭으로 dev 서버 시작
```

---

## 문제 해결

### "build 실패" — 파일명 대소문자

macOS는 `Photo.JPG`와 `photo.jpg`를 같은 파일로 취급하지만 Vercel(Linux)은 다르게 봄. 모든 사진 파일명은 **소문자**.

```bash
# 확인
find src/content -name "*.JPG" -o -name "*.JPEG"

# 일괄 변경 (있다면)
for f in src/content/**/*.JPG; do mv "$f" "${f%.JPG}.jpg"; done
```

### "사진이 너무 무거움"

원본 RAW을 그대로 넣지 말고 Lightroom export로 긴 쪽 3000px·JPEG 90%로 줄이기. 한 장당 1~3MB 목표.

GitHub은 파일당 100MB 초과 시 push 거부. 50MB 넘으면 경고.

### "GPS 정보 노출 우려"

Repo가 public이면 원본 jpg를 누구나 다운받아 EXIF 추출 가능. Lightroom export에서 메타를 "Copyright Only"로 설정하거나, 위 `exiftool` 명령으로 일괄 제거.

### "사이트가 안 바뀜"

1. Push 했는지 확인: `git status` 깨끗해야 함
2. Vercel 빌드 상태: https://vercel.com/rangeareascent-s-projects/d612 의 Deployments 탭
3. 브라우저 캐시: Cmd+Shift+R로 강력 새로고침

### "이미지 깨짐 / 못 찾음"

`.md`의 `photo:` 또는 `src:` 경로가 잘못됐을 가능성. 같은 폴더 기준 상대 경로 — `./파일명.jpg`. 띄어쓰기 없는 ASCII만.

### Vercel 빌드 로그 보기

```bash
cd "~/Projects/Photography website"
npx vercel logs
```

또는 대시보드: https://vercel.com/rangeareascent-s-projects/d612

---

## 도메인 / DNS

- **도메인**: d612.space (Namecheap 등록)
- **DNS 레코드** (Namecheap에서 설정):
  - A `@` → `216.198.79.1` (Vercel 권장 IP)
  - CNAME `www` → `cname.vercel-dns.com`
- **SSL**: Vercel이 Let's Encrypt로 자동 발급·갱신

DNS 전파 확인:

```bash
dig d612.space
dig www.d612.space
```

---

## 의존성 / 기술 스택

- **[Astro 5](https://astro.build)** — 정적 사이트 빌더. 이미지 자동 최적화 (WebP/AVIF, srcset)
- **[Fraunces](https://fonts.google.com/specimen/Fraunces)** — Google Fonts (Cereal 매거진 결의 serif)
- **[@astrojs/sitemap](https://docs.astro.build/en/guides/integrations-guide/sitemap/)** — sitemap.xml 자동 생성
- **[Vercel](https://vercel.com)** — 호스팅 (Hobby 무료 티어)

업데이트:

```bash
npm outdated         # 새 버전 있는 패키지 확인
npm update           # minor·patch 업데이트
```

Major 업데이트(Astro 5 → 6 등)는 changelog 보고 수동.

---

## 백업

- **GitHub** = 코드 + 선택된 사진들의 영구 저장소
- **원본 RAW** = 별도 (Lightroom + 외장 SSD + 클라우드)
- **6개월에 한 번** 정도 repo 전체를 zip으로 별도 보관 (안전망)

```bash
cd ~/Projects
zip -r "photography-backup-$(date +%Y-%m-%d).zip" "Photography website" -x "*/node_modules/*" "*/dist/*" "*/.astro/*"
```
