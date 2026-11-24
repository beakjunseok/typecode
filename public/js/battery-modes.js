// 배터리 구조 SOS 판 꾸미기: 방전봇 성격(상대 라인업), 아이템 모양, 바다 날씨.
// 엔진(battery-engine.js)은 여기 값만 읽어 쓰고, 화면은 얼굴·색·대사를 읽어 그린다

// ---------- 방전봇 성격 6종 ----------
// ai: attack = 내 탑을 노릴 확률, speed = 타자 속도 배율, think = 생각 시간 배율, startCells = 시작 셀,
//     burst = 가끔 아주 빠르게(chance 확률로 factor배), snipe = 내가 치던 아이템을 가로채려 함, mirror = 지난 판 나를 흉내
// look: 기본 캐릭터(레벨 1~4 디자인) 위에 덮을 색, taunts: 상황별 도발 대사(무작위 하나)
export const PERSONAS = Object.freeze({
  rusher: Object.freeze({
    name: '돌격봇', icon: '⚔', blurb: '셀만 뺏어요 — 아이템은 거의 안 봄',
    ai: Object.freeze({ attack: 0.92, speed: 1, think: 0.8 }),
    look: Object.freeze({ base: 2, body: '#8a2a2a', bodyDark: '#4a1010', trim: '#ff6b4a', glow: '#ff6b4a' }),
    taunts: Object.freeze({ start: ['돌격 앞으로!', '네 배터리 내 거야!'], attack: ['한 칸 더!', '빼앗는 게 제일 빨라'], hurt: ['어딜 감히?!'], win: ['방전 완료!'], lose: ['후퇴… 후퇴다…'] })
  }),
  guardian: Object.freeze({
    name: '수비봇', icon: '🛡', blurb: '아이템만 노려요 — 지나가는 걸 먼저 쳐야 해요',
    ai: Object.freeze({ attack: 0.06, speed: 1.05, think: 0.9 }),
    look: Object.freeze({ base: 1, body: '#2e5b4a', bodyDark: '#163027', trim: '#7fffc4', glow: '#7fffc4' }),
    taunts: Object.freeze({ start: ['아이템은 내가 다 줍지'], take: ['이것도 내 거', '줍줍'], hurt: ['앗, 내 셀…'], win: ['차곡차곡 모은 승리'], lose: ['다음엔 더 모을 거야'] })
  }),
  gambler: Object.freeze({
    name: '도박봇', icon: '🎲', blurb: '평소엔 느린데 가끔 엄청 빠르게 쳐요',
    ai: Object.freeze({ attack: 0.35, speed: 0.75, think: 1, burst: Object.freeze({ chance: 0.28, factor: 2.6 }) }),
    look: Object.freeze({ base: 3, body: '#6b5a14', bodyDark: '#33290a', trim: '#ffe14d', glow: '#ffe14d' }),
    taunts: Object.freeze({ start: ['오늘은 운이 좋아'], burst: ['올인!!', '잭팟 타이핑!'], attack: ['한 판 붙자'], hurt: ['꽝이네…'], win: ['역시 운빨'], lose: ['다음 판은 다를걸'] })
  }),
  sniper: Object.freeze({
    name: '얌체봇', icon: '🦊', blurb: '내가 치던 아이템을 가로채요 — 짧은 걸 먼저!',
    ai: Object.freeze({ attack: 0.25, speed: 1.1, think: 0.85, snipe: true }),
    look: Object.freeze({ base: 2, body: '#7a3f8a', bodyDark: '#3a1a44', trim: '#ff9df5', glow: '#ff9df5' }),
    taunts: Object.freeze({ start: ['네가 치는 건 내 거야'], steal: ['고마워~ 잘 먹을게', '느리다 느려'], hurt: ['칫'], win: ['얌체가 이긴다'], lose: ['다음엔 더 몰래…'] })
  }),
  sloth: Object.freeze({
    name: '느림보 보스', icon: '🐢', blurb: '느리지만 셀이 6칸으로 시작해요',
    ai: Object.freeze({ attack: 0.3, speed: 0.6, think: 1.3, startCells: 6 }),
    look: Object.freeze({ base: 4, body: '#3a4a2a', bodyDark: '#1a2410', trim: '#c9f29b', glow: '#c9f29b' }),
    taunts: Object.freeze({ start: ['처언처언히… 이기면… 돼…'], attack: ['영차…'], hurt: ['아야… 느리게… 아파…'], win: ['거북이가… 이겼다…'], lose: ['다음엔… 더 천천히…'] })
  }),
  mirror: Object.freeze({
    name: '미러봇', icon: '🪞', blurb: '지난 판 내 타자 속도와 공격 습관을 따라 해요',
    ai: Object.freeze({ attack: 0.3, speed: 1, think: 1, mirror: true }),
    look: Object.freeze({ base: 1, body: '#5d6b7a', bodyDark: '#2a323c', trim: '#e8f4ff', glow: '#9ff0ff' }),
    taunts: Object.freeze({ start: ['나는 너야', '거울 앞에 선 기분 어때?'], attack: ['너도 이렇게 쳤잖아'], hurt: ['…그것도 너답네'], win: ['나를 못 이기네'], lose: ['더 빨라졌구나'] })
  })
});
export const PERSONA_ORDER = Object.freeze(['rusher', 'guardian', 'gambler', 'sniper', 'sloth', 'mirror']);

// 미러봇이 따라 할 내 습관: 지난 판 초당 글자 수와 공격 비율(없으면 보통 값). 범위를 벗어나지 않게 자른다
export function mirrorProfile(summary) {
  const seconds = Number(summary?.survivedSeconds ?? summary?.elapsedSeconds) || 0;
  const keystrokes = Number(summary?.correctKeystrokes) || 0;
  const drains = Number(summary?.drains) || 0;
  const items = Object.values(summary?.collected ?? {}).reduce((sum, count) => sum + (Number(count) || 0), 0);
  const cps = seconds > 5 && keystrokes > 0 ? keystrokes / seconds : 2;
  const attack = drains + items > 0 ? drains / (drains + items) : 0.3;
  return { cps: Math.max(1, Math.min(6, cps * 0.85)), attack: Math.max(0.1, Math.min(0.9, attack)) };
}

// ---------- 아이템 ----------
// 배터리 셀은 기본 아이템. 혼자 하기는 12종 전부 무작위(battery-engine chooseItemType)
// DECK_SIZE: 시험·재현용 고정 목록(options.deck)의 최대 크기
export const DECK_SIZE = 4;
export const BASE_ITEM = 'cell';

// ---------- 바다 날씨 5종 ----------
export const WEATHERS = Object.freeze({
  calm: Object.freeze({ name: '잔잔함', icon: '🌤', blurb: '평소 바다' }),
  waves: Object.freeze({ name: '파도', icon: '🌊', blurb: '10초마다 큰 파도 — 두 탑이 크게 가라앉아요', every: 10, seconds: 1, sink: 0.4 }),
  storm: Object.freeze({ name: '폭풍', icon: '⛈', blurb: '아이템이 2배로 많지만 빨리 지나가요', itemRate: 2, itemSpeed: 1.45 }),
  current: Object.freeze({ name: '해류', icon: '🌀', blurb: '아이템이 모두 방전봇 쪽에서 와요', direction: -1, itemSpeed: 1.2 }),
  ebb: Object.freeze({ name: '썰물', icon: '🏖', blurb: '가라앉는 속도가 느려요', sink: 0.6 })
});
export const WEATHER_ORDER = Object.freeze(['calm', 'waves', 'storm', 'current', 'ebb']);

// 판마다 무작위로 고른다(같은 날씨 연속은 피한다)
export function pickWeather(random = Math.random, previous = null) {
  const choices = WEATHER_ORDER.filter(key => key !== previous);
  return choices[Math.floor(random() * choices.length)] ?? 'calm';
}

// 아이템 아이콘·색(준비 화면 목록과 바다 위 아이콘이 같이 쓴다)
export const ITEM_LOOKS = Object.freeze({
  cell: Object.freeze({ icon: '🔋', color: '#4df0a6', tag: '+0.5' }),
  powerbank: Object.freeze({ icon: '🛸', color: '#36e2ff', tag: '+1' }),
  eco: Object.freeze({ icon: '🍃', color: '#c3e88d', tag: 'ECO' }),
  heat: Object.freeze({ icon: '🔥', color: '#ff7a45', tag: 'HEAT' }),
  blackout: Object.freeze({ icon: '🌑', color: '#c792ea', tag: 'OFF' }),
  reflect: Object.freeze({ icon: '🪞', color: '#9ff0ff', tag: 'MIRROR' }),
  obfuscate: Object.freeze({ icon: '🌀', color: '#ff9df5', tag: 'OBF' }),
  magnet: Object.freeze({ icon: '🧲', color: '#ff5d73', tag: 'MAG' }),
  overclock: Object.freeze({ icon: '⚙', color: '#ffe14d', tag: '×2' }),
  cleanse: Object.freeze({ icon: '💊', color: '#7fffc4', tag: 'CURE' }),
  trap: Object.freeze({ icon: '🪤', color: '#ffb547', tag: 'TRAP' }),
  lucky: Object.freeze({ icon: '🎣', color: '#4fc3ff', tag: 'LUCK' })
});
