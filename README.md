# TYPE//CODE

코드 문법 토큰(`const`, `=>`, `fmt.Println()`, `GROUP BY` …)을 하나씩 치는 개발자용 타자연습 게임.
토큰은 종류(keyword · type · builtin · operator · literal · decorator · directive)별로 에디터처럼 색이 입혀지고,
오타는 에러 로그로 남는다. 주간 랭킹은 서버에 저장된다.

**플레이:** https://typecode-coral.vercel.app

## 규칙
- 언어 7종(JavaScript · Python · Java · C · Go · Rust · SQL), 시간 30 · 60 · 120초. 첫 키 입력부터 타이머 시작
- 토큰을 끝까지 맞게 채우면 자동으로 다음 토큰. 틀린 글자는 빨갛게 남고 `Backspace`로 지우면 원래 색으로 돌아온다
  (`Ctrl/Alt + Backspace`: 토큰 전체 삭제)
- 점수 = 토큰 글자 수 × 10 × 배율, **토큰 완성 시 한 번만** 지급(지웠다 다시 쳐서 점수를 불릴 수 없음)
- 오타 없이 끝낸 토큰이 이어지면 콤보: 10개 이상 ×1.5, 30개 이상 ×2.0. 한 번 틀린 토큰은 고쳐도 콤보 0
- 틀린 토큰은 20% 확률로 다시 출제. 결과 화면에 WPM 추이(5초 이동 평균)와 자주 틀린 토큰 TOP 3

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
| 종료 | 상행 아르페지오 | 결과 모달 |

`prefers-reduced-motion`이 켜져 있으면 흔들림·파티클·애니메이션을 끈다.

## 구조
```
public/                  정적 클라이언트 (빌드 없음, ES Modules)
  index.html, styles.css
  js/engine.js           순수 게임 엔진: 규칙·점수·콤보·타이머 (DOM 없음, 시각을 인자로 받음)
  js/tokens.js           언어별 토큰 사전 + 종류/색
  js/week.js             KST ISO 주차 계산 (클라이언트·서버 공용)
  js/audio.js            효과음 합성 엔진
  js/effects.js          파티클·흔들림
  js/ui.js               렌더링 전담
  js/api.js              서버 호출 + 로컬 랭킹 폴백
  js/main.js             엔진 이벤트 → 화면·소리·서버 연결
api/                     Vercel Functions
  _lib.js                세션 서명, 제출 검증, Blob 저장/조회 (engine.js·tokens.js의 상수를 그대로 import)
  session.js             POST  게임 시작 시 서버 시각 기반 세션 토큰 발급
  scores.js              GET 주간 TOP 10 / POST 점수 제출
tests/                   node --test (엔진·토큰·서버)
```

엔진은 `onEvent(type, payload)`로 `start · keystroke · backspace · mistake · token · warning · finish`를 내보내고,
`main.js`가 이를 소리·효과·로그에 연결한다. 서버는 같은 `engine.js`의 점수 상수로 검증하므로 규칙을 바꿔도 어긋나지 않는다.

### 랭킹 설계
- **초기화 배치 없음**: 점수는 `lb/{KST ISO 주차}/` 경로에 쌓이고, 주가 바뀌면 새 경로를 읽는다.
- **append-only**: 점수 1건 = Blob 1개. 기존 파일을 고치지 않으므로 동시에 제출해도 기록이 덮어써지지 않는다.
- **세션 서명**: 게임 시작 시 서버가 `{sid, language, duration, startedAt}`에 HMAC 서명한 토큰을 발급. 경과 시간은 서버 시각으로만 판단한다.
- **제출 검증**: 서명 불일치 401 · 형식/시간/속도/점수 상한 위반 422 · 같은 세션 재제출 409. WPM·정확도는 서버가 다시 계산한다.
- 서버를 못 쓰는 환경에서는 브라우저 로컬 랭킹으로 자동 대체.

### 알려진 한계
- 키 입력 수는 상한만 검증하므로 상한 안쪽의 조작까지 막지는 못한다.
- IP 단위 rate limit이 없다. 필요하면 Vercel Firewall 규칙으로 `/api/*`에 건다.

## 개발
```bash
npm install
npm test            # 엔진·토큰·서버 테스트
npx vercel dev      # 로컬 실행 (Blob 토큰 필요: vercel env pull)
```
Vercel 프로젝트에 Blob 스토어를 연결하면 `BLOB_READ_WRITE_TOKEN`이 자동 주입된다.
별도 서명 키를 쓰려면 `TYPECODE_SESSION_SECRET`을 설정한다(없으면 Blob 토큰에서 파생).
