# TYPE//CODE

코드 문법 토큰(`const`, `=>`, `fmt.Println()`, `GROUP BY` …)을 치는 개발자용 타자연습 게임.
**연습** 모드와, 한컴타자연습의 추억의 게임을 패러디한 아케이드 모드 2종(**📱 휴대폰 던지기**, **🔋 배터리 구조 SOS**)이 있다.
토큰은 종류(keyword · type · builtin · operator · literal · decorator · directive)별로 에디터처럼 색이 입혀지고,
오타는 에러 로그로 남는다. 주간 랭킹은 서버에 저장된다.

**플레이:** https://typecode-coral.vercel.app

## 규칙
- 언어 12종(JavaScript · TypeScript · Python · Java · C · C++ · C# · Go · Rust · Kotlin · Swift · SQL), 시간 30 · 60 · 120초. 첫 키 입력부터 타이머 시작
- 출제 비율은 종류 단위로 고정(keyword 34% · builtin 22% · type 14% · operator 12% · 나머지). 토큰 수가 많은 언어에서도 한 종류만 쏟아지지 않음
- 토큰을 끝까지 맞게 채우면 자동으로 다음 토큰. 틀린 글자는 빨갛게 남고 `Backspace`로 지우면 원래 색으로 돌아온다
  (`Ctrl/Alt + Backspace`: 토큰 전체 삭제)
- 점수 = 토큰 글자 수 × 10 × 배율, **토큰 완성 시 한 번만** 지급(지웠다 다시 쳐서 점수를 불릴 수 없음)
- 오타 없이 끝낸 토큰이 이어지면 콤보: 10개 이상 ×1.5, 30개 이상 ×2.0. 한 번 틀린 토큰은 고쳐도 콤보 0
- 틀린 토큰은 20% 확률로 다시 출제. 결과 화면에 WPM 추이(5초 이동 평균)와 자주 틀린 토큰 TOP 3

## 아케이드 모드
공통: 첫 글자로 목표를 조준(화면의 목표끼리 첫 글자가 겹치지 않게 출제) → 토큰을 다 맞게 치면 발사. 오타·Backspace 규칙은 연습과 같다.
생명 3, 시간이 갈수록 빨라지고 자주 나온다. 난이도 Lv.1~4. 랭킹은 모드별로 따로 집계.

**📱 휴대폰 던지기** (케이크 던지기 패러디, 세로 화면) — 로봇이 낱말 발판을 타고 위에서 내려온다(가까울수록 커짐).
발판 낱말을 다 치면 아래 책상의 개발자가 휴대폰을 던진다. 빨간 선을 넘으면 건전지 생명 −1칸(왼쪽 위 건전지 3개, 마지막 1칸은 빨갛게 깜빡임). 좁은 화면은 3레인·짧은 낱말.
| 적 | 체력 | 속도 | 보너스 | 등장 |
|---|---|---|---|---|
| 버그봇(기본) | 1 | 보통 | 50 | 처음 |
| 스피드봇(빠른) | 1 | 2배 | 80 | 15초 |
| 헤비봇(피 많은) | 3, 맞을 때마다 새 낱말 | 느림 | 150 | 35초 |

아이템(드론이 운반): 💻 노트북(8초간 위력 ×3, 헤비봇 한 방) · 🔋 건전지(생명이 깎이면 6~10초 뒤, 이후 깎여 있는 동안 14~22초마다 등장 · 생명 +1칸)

**🔋 배터리 구조 SOS** (해상구조 SOS 패러디) — 왼쪽 내 폰 vs 오른쪽 방전봇, 두 배터리 셀 탑이 계속 방전의 바다로 가라앉는다.
지나가는 아이템 낱말을 치면 내 탑 충전, 방전봇 탑 위 낱말을 치면 상대 −0.5칸. 방전봇도 같은 아이템을 노리고(빨간 밑줄 = 진행도) 먼저 치면 뺏긴다.
8칸(100%)을 먼저 채우면 스테이지 클리어 → 탑 초기화, 다음 스테이지는 더 빠름. 0%가 되거나 방전봇이 먼저 채우면 패배.
아이템: 🔋 셀(+0.5) · 보조배터리 드론(+1) · 🍃 저전력(내 방전 4초 감속) · 🔥 발열(상대 4초 급방전) · 🌙 화면 꺼짐(방전봇 3초 정지)

모바일: 게임 화면 아래 입력창(`>`)에 지금 치는 낱말과 오타가 보이고, 화면 키보드가 올라와도 게임 높이를 다시 맞춘다.
조합형 입력(Gboard·삼성 키보드)·자동수정·스와이프도 값 비교 방식으로 처리한다.

## 화면 키보드 (연습 모드)
블랙 RGB 키보드(US 배열). 다음에 칠 키에 주황 점, 대문자·기호는 반대손 Shift 표시, 오타가 남아 있으면 Backspace 안내,
키캡 하단 색 = 담당 손가락, 누른 키는 초록(맞음)/빨강(틀림)으로 번쩍. `KBD` 버튼으로 끄고 켠다.

## 키 소리
| 상황 | 소리 | 방식 |
|---|---|---|
| 맞는 키 | 청축(클리키): 높은 '찰칵' + 스프링 '칭' → 바닥 소리 → 올라올 때 '찰칵' | Web Audio 합성 |
| 틀린 키 | 적축(리니어): 누름 → 70~105ms 뒤 올라옴 | **실제 녹음** 12+12개 중 직전과 다른 것, ±18 cents·±2 dB 변화 |
| Backspace | 넓은 키 누름·올라옴 | 실제 녹음 3+3개 |

- 키 위치대로 좌우 배치(q는 왼쪽, p는 오른쪽), 짧은 방 울림. 키 소리는 BGM과 다른 출력(전용 limiter)으로 보내 BGM에 묻히지 않는다.
- 녹음은 `public/sounds/linear.wav` 한 파일(32 kHz stereo, 319 KB)에 묶어 첫 입력 뒤에 한 번 받는다. 받기 전이나 실패 시에는 합성음으로 대신한다.
- 출처: [gabrimatic/switchtone](https://github.com/gabrimatic/switchtone) `Resources/Sounds/linear` (MIT) ← Sony Keyboard Sound Dataset (MIT, Copyright 2020 Sony Corporation). 전문: `public/sounds/LICENSES.txt`.
  다시 만들기: `python3 scripts/build-key-samples.py <switchtone>/Resources/Sounds/linear` (ffmpeg 필요)

## BGM (Web Audio 실시간 합성 — 음원 파일·저작권 없음)
| 모드 | 곡 | 반응 |
|---|---|---|
| 연습 | "Commit & Push" — F장조 120BPM 신스팝, 2:32 | 콤보 단계마다 층 추가 |
| 휴대폰 던지기 | "Robot Rush" — A단조 150BPM 칩튠 록, 2:21 | 노트북 모드에선 필터 개방·파워 층 |
| 배터리 구조 SOS | "Full Charge" — D단조 138BPM 일렉트로, 2:19 | 배터리가 낮으면 경보·심장박동 층 + 템포 상승 |

세 곡 모두 인트로–벌스–프리코러스–코러스–브리지 구성에 섹션마다 조옮김·필인이 달라 반복감이 적다.
`BGM` 버튼으로 따로 끄고 켠다. 모드를 바꾸면 크로스페이드, 결과창에서는 볼륨을 낮춘다.

## 연출
| 상황 | 소리 (Web Audio 합성) | 화면 |
|---|---|---|
| 정타 | 밴드패스 노이즈 클릭(기계식 키보드 느낌) | 글자에 종류 색 + 글로우 |
| 지우기 | 낮고 둔한 클릭 | 글자 색 원복 |
| 오타 | 어긋난 두 톱니파 버즈 | 빨간 글자, 스테이지 흔들림, 에러 로그 |
| 토큰 완성 | 콤보에 따라 펜타토닉 음계 상승 | 다음 토큰 슬라이드 인 |
| 콤보 10단위 | 비조화 배음 메탈릭 핑 | 네온 파티클 (blur 4px→0→2px) |
| 배율 단계 상승 | 상승 스윕 + 종소리 + 고역 반짝임 | 테마 색 전환 시안 → 앰버 → 마젠타, 플래시 |
| 마지막 5초 | 초마다 비프 | 타이머 깜빡임 |
| 종료 | 상행 아르페지오(연습) / 단조 하행(아케이드) | 결과 모달 |
| 발사 | 휙(휴대폰) / 무거운 휘익(노트북) / 퐁(패치 튜브) | 포물선 + 회전 + 잔상 |
| 명중 · 처치 | 금속 충돌 · 저역 폭발 / 구조 2음 | 스프링 찌그러짐·넉백, 부풀었다 회전하며 폭발 |
| 등장 | 삐뽀(로봇 종류별 음높이) / 첨벙 | easeOutBack으로 튀어 등장 |
| 생명 감소 | 하강 경보 / 꼬르륵 | 화면 흔들림 |
| 아이템 | 등장 반짝임 · 획득 파워업 / 롤백 역스윕 · 효과 종료음 | 테두리 발광 |
| 주간 1위 | 팡파르 | |

`prefers-reduced-motion`이 켜져 있으면 흔들림·파티클·애니메이션을 끈다.

## 구조
```
public/                  정적 클라이언트 (빌드 없음, ES Modules)
  index.html, styles.css
  js/engine.js           순수 게임 엔진: 규칙·점수·콤보·타이머 (DOM 없음, 시각을 인자로 받음)
  js/tokens.js           토큰 사전 공개 창구: 종류·색·출제 비율, 가중치 풀 생성
  js/tokens.generated.js 자동 생성된 언어별 토큰 목록 (직접 수정 금지)
  js/week.js             KST ISO 주차 계산 (클라이언트·서버 공용)
  js/audio.js            효과음 엔진(합성 + 적축 녹음 스프라이트 재생)
  js/key-samples.js      적축 스프라이트 오프셋(scripts/build-key-samples.py가 생성)
  js/effects.js          파티클·흔들림
  js/ui.js               렌더링 전담
  js/api.js              서버 호출 + 로컬 랭킹 폴백
  js/target-game.js      아케이드 공통 엔진: 조준·입력·콤보·생명·투사체·요약 (모드는 훅으로 확장)
  js/throw-engine.js     휴대폰 던지기 규칙: 로봇 3종·레인·아이템
  js/battery-engine.js   배터리 구조 SOS 규칙: 셀 탑·방전·아이템·방전봇 AI·스테이지
  js/input.js            숨은 입력칸 값 비교 → 글자/지우기 (모바일 IME 대응)
  js/game-view.js        캔버스 공통: DPR, 토큰 라벨, 파티클, 스프링, HUD
  js/throw-view.js, js/battery-view.js   모드별 캐릭터·배경 그리기
  js/keyboard.js         블랙 RGB 화면 키보드
  js/songs.js            BGM 곡 데이터 3곡(섹션·코드·멜로디)
  js/bgm.js              BGM 시퀀서 + 악기 합성
  js/main.js             모드 전환, 엔진 이벤트 → 화면·소리·키보드·서버 연결
api/                     Vercel Functions
  _lib.js                세션 서명, 제출 검증, Blob 저장/조회 (engine.js·tokens.js의 상수를 그대로 import)
  session.js             POST  게임 시작 시 서버 시각 기반 세션 토큰 발급
  scores.js              GET 주간 TOP 10 / POST 점수 제출
scripts/
  token-sources.mjs      언어별 추출 설정: 사용할 문법 소스, 제외 목록, 직접 고른 토큰
  generate-tokens.mjs    highlight.js + tree-sitter + 직접 목록 → tokens.generated.js
  grammars/              추출 전용 의존성(배포 제외, 네이티브 빌드 없이 설치)
tests/                   node --test (엔진·토큰·서버·생성 파일 동기화)
```

엔진은 `onEvent(type, payload)`로 `start · keystroke · backspace · mistake · token · warning · finish`를 내보내고,
`main.js`가 이를 소리·효과·로그에 연결한다. 서버는 같은 `engine.js`의 점수 상수로 검증하므로 규칙을 바꿔도 어긋나지 않는다.

### 토큰 소스
| 종류 | 출처 |
|---|---|
| keyword | [highlight.js](https://github.com/highlightjs/highlight.js) 키워드 ∪ [tree-sitter](https://tree-sitter.github.io/) 문법의 키워드 노드, 미사용 예약어·문법 조각은 제외 목록으로 제거 (SQL은 hljs ∩ tree-sitter-sql) |
| operator | tree-sitter `node-types.json`의 기호 노드 (주석·문자열·괄호 구분자 제외) |
| type · builtin · literal | highlight.js |
| 관용구 · decorator · directive | 직접 고른 목록 (`console.log()`, `@Override`, `#include` 등) |

생성 결과는 커밋되어 있어 배포 시 빌드가 필요 없다. 소스나 설정을 바꾸면:
```bash
npm run grammars   # 최초 1회: scripts/grammars에 highlight.js·tree-sitter 문법 설치
npm run tokens     # tokens.generated.js 재생성 + 언어별 출처 리포트 출력
npm test           # 생성 파일이 설정과 일치하는지까지 검사
```

### 랭킹 설계
- **초기화 배치 없음**: 점수는 `lb/{KST ISO 주차}/` 경로에 쌓이고, 주가 바뀌면 새 경로를 읽는다.
- **append-only**: 점수 1건 = Blob 1개. 기존 파일을 고치지 않으므로 동시에 제출해도 기록이 덮어써지지 않는다.
- **세션 서명**: 게임 시작 시 서버가 `{sid, language, duration, startedAt}`에 HMAC 서명한 토큰을 발급. 경과 시간은 서버 시각으로만 판단한다.
- **제출 검증**: 서명 불일치 401 · 형식/시간/속도/점수 상한 위반 422 · 같은 세션 재제출 409. WPM·정확도는 서버가 다시 계산한다.
- **모드별 랭킹**: `lb/`(연습) · `lb-throw/` · `lb-battery/`. 아케이드는 생존 시간이 서버가 잰 경과 시간을 넘을 수 없고,
  점수 상한은 각 엔진이 내보내는 글자당 최대 점수(던지기 95, 배터리 35)를 서버가 그대로 import해 쓴다.
- 서버를 못 쓰는 환경에서는 브라우저 로컬 랭킹으로 자동 대체.

### 알려진 한계
- 키 입력 수는 상한만 검증하므로 상한 안쪽의 조작까지 막지는 못한다.
- IP 단위 rate limit이 없다. 필요하면 Vercel Firewall 규칙으로 `/api/*`에 건다.

## 개발
```bash
npm install
npm test            # 엔진·토큰·서버 테스트 (문법 소스 미설치 시 동기화 검사는 skip)
npx vercel dev      # 로컬 실행 (Blob 토큰 필요: vercel env pull)
```
Vercel 프로젝트에 Blob 스토어를 연결하면 `BLOB_READ_WRITE_TOKEN`이 자동 주입된다.
별도 서명 키를 쓰려면 `TYPECODE_SESSION_SECRET`을 설정한다(없으면 Blob 토큰에서 파생).
