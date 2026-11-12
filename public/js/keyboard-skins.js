// 키보드 스킨 50종 + 기본 스킨. 실제 키캡 세트의 배색·분위기만 참고한 오리지널 디자인(상표명은 쓰지 않는다).
// 키캡은 글자키(alpha)·기능키(mod)·포인트키(accent: Enter·Backspace) 3단 배색, 케이스(case)와 소재(material),
// LED는 평상시 무늬(pattern) + 터치 반응(reactive) + 팔레트로 이루어진다. 등급이 오를수록 LED가 화려해진다.

export const RARITY_ORDER = Object.freeze(['common', 'uncommon', 'rare', 'epic', 'legendary']);
// rate 등급 확률(합 1), refund 중복일 때 돌려주는 조각, price 조각 상점 가격
export const RARITIES = Object.freeze({
  common: Object.freeze({ label: '일반', color: '#9aa4ad', rate: 0.55, refund: 5, price: 40, stars: 1 }),
  uncommon: Object.freeze({ label: '고급', color: '#3ddc84', rate: 0.27, refund: 10, price: 80, stars: 2 }),
  rare: Object.freeze({ label: '희귀', color: '#3b9eff', rate: 0.12, refund: 25, price: 200, stars: 3 }),
  epic: Object.freeze({ label: '영웅', color: '#a855f7', rate: 0.045, refund: 60, price: 500, stars: 4 }),
  legendary: Object.freeze({ label: '전설', color: '#ff9f1c', rate: 0.015, refund: 150, price: 1200, stars: 5 })
});

// 소재: 키캡이 LED 빛을 얼마나 통과시키는지(glow), 글자가 LED 색으로 빛나는지(shine)
export const MATERIALS = Object.freeze({
  pbt: Object.freeze({ label: 'PBT 무광', glow: 0.45 }),
  shine: Object.freeze({ label: '샤인스루', glow: 0.55, shine: true }),
  pudding: Object.freeze({ label: '푸딩', glow: 1 }),
  crystal: Object.freeze({ label: '크리스탈', glow: 1, shine: true }),
  frost: Object.freeze({ label: '프로스트 케이스', glow: 0.8 }),
  ceramic: Object.freeze({ label: '세라믹', glow: 0.4 }),
  wood: Object.freeze({ label: '월넛·황동', glow: 0.5 }),
  metal: Object.freeze({ label: '아노다이징 알루미늄', glow: 0.55 }),
  blank: Object.freeze({ label: '블랭크·사이드 프린트', glow: 0.7, shine: true })
});

// '#rrggbb' → [h, s, l]
export function hexToHsl(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  const red = (value >> 16 & 255) / 255;
  const green = (value >> 8 & 255) / 255;
  const blue = (value & 255) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  if (max === min) return [0, 0, Math.round(lightness * 100)];
  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue;
  if (max === red) hue = (green - blue) / delta + (green < blue ? 6 : 0);
  else if (max === green) hue = (blue - red) / delta + 2;
  else hue = (red - green) / delta + 4;
  return [Math.round(hue * 60), Math.round(saturation * 100), Math.round(lightness * 100)];
}

// LED 팔레트: 너무 어두운 색은 LED로 안 보이니 밝기를 45~70% 안으로 맞춘다
const ledPalette = colors => colors === 'rainbow' ? 'rainbow' : colors.map(hex => {
  const [hue, saturation, lightness] = hexToHsl(hex);
  return [hue, Math.max(saturation, 55), Math.min(70, Math.max(45, lightness))];
});

// [id, 이름, 등급, 설명, 글자키 바탕, 글자키 글자, 기능키 바탕, 기능키 글자, 포인트 바탕, 포인트 글자, 케이스, 소재, LED 무늬, 터치 반응, LED 색, 추가]
const ROWS = [
  ['base', '블랙 RGB', 'common', '처음 받는 기본 키보드. 검은 키캡 아래로 무지개가 흐른다', '#1e2133', '#d8e0ff', '#161927', '#9aa4c8', '#232846', '#ffffff', '#0e1120', 'shine', 'wave', 'simple', 'rainbow'],

  ['null-pointer', '널 포인터', 'common', '흰 글자 검정 키. 가장 기본적인 흑백', '#171718', '#f7f2ea', '#232425', '#c9c4b8', '#393b3b', '#f7f2ea', '#0d0d0f', 'pbt', 'static', 'simple', ['#e8e6ff']],
  ['white-paper', '화이트 페이퍼', 'common', '검정 글자 흰 키. 불을 끈 종이처럼 담백하게', '#f7f2ea', '#171718', '#e2ddd2', '#303030', '#c5c7ca', '#171718', '#dcdcd8', 'pbt', 'off', 'none', ['#ffffff']],
  ['graphite', '그래파이트', 'common', '연필심 같은 차콜 단색', '#393b3b', '#d8d2c3', '#2c2e2e', '#aca693', '#727474', '#f0ece2', '#1e1f20', 'pbt', 'static', 'none', ['#9aa4ad']],
  ['office-1985', '오피스 1985', 'common', '80년대 사무실 베이지 키보드', '#d8d2c3', '#393b3b', '#aca693', '#2f3133', '#aca693', '#2f3133', '#cfc8b6', 'pbt', 'off', 'simple', ['#ffd9a0']],
  ['platinum', '플래티넘', 'common', '90년대 PC의 밝은 회색', '#c5c7ca', '#393b3b', '#9b9e9f', '#26282a', '#9b9e9f', '#26282a', '#d9d9d6', 'pbt', 'off', 'none', ['#ffffff']],
  ['breadbin', '브레드빈', 'common', '8비트 홈컴퓨터의 갈색 키와 호박색 불빛', '#5a3e2b', '#e8dcc4', '#4a3222', '#d8c6a4', '#8a6a4f', '#fff3dc', '#a89b84', 'pbt', 'static', 'none', ['#ffb347']],
  ['granite', '화강암', 'common', '차가운 회색 미니멀. 글자키와 기능키 불빛을 나눴다', '#b9bbbd', '#2f3133', '#8e9092', '#f2f2f2', '#e6e6e6', '#2f3133', '#8e9092', 'pbt', 'alphaMods', 'none', ['#cfe3ff', '#8fb5ff']],
  ['sage-desk', '세이지 데스크', 'common', '베이지 책상 위 세이지 화분', '#d8d2c3', '#171718', '#bdb6a4', '#2b2b2b', '#768e72', '#f4f1e8', '#bdb6a4', 'pbt', 'gradient', 'none', ['#a6d49f', '#f0e6c8']],
  ['midnight-navy', '미드나잇 네이비', 'common', '깊은 남색 단색에 푸른 백라이트', '#1b2a41', '#cfd8e3', '#14203a', '#9fb2cc', '#3a5272', '#ffffff', '#0f1826', 'shine', 'static', 'simple', ['#4f8dff']],
  ['mocha', '모카', 'common', '커피와 크림. 따뜻하게 숨쉰다', '#6f4e37', '#f3e9dc', '#5a3e2b', '#e2cdb4', '#a47e5f', '#ffffff', '#3b2a1e', 'pbt', 'breathing', 'none', ['#ffae6b']],
  ['olive-drab', '올리브 드랩', 'common', '군용 올리브 녹색', '#4b5320', '#e6e2c8', '#3b4219', '#d6d0ae', '#6b7445', '#f2efdc', '#2c3014', 'pbt', 'static', 'none', ['#b9d46a']],
  ['lavender-mist', '라벤더 미스트', 'common', '파스텔 보라 안개', '#c9b8e0', '#3b2f54', '#b39fd2', '#2c2340', '#9f88c4', '#ffffff', '#e9e3f2', 'pbt', 'gradient', 'simple', ['#c4a6ff', '#ffb8e6']],
  ['coral-reef', '코랄 리프', 'common', '산호색 바다', '#e8857a', '#3a1e1b', '#d9706b', '#2c1512', '#f2b8a0', '#3a1e1b', '#f6ece6', 'pbt', 'gradientSide', 'none', ['#ff7f6e', '#ffd0a6']],
  ['mint-chip', '민트 칩', 'common', '민트 아이스크림에 초콜릿 칩', '#b8e0d2', '#3b2a1e', '#6f4e37', '#e9f5f0', '#6f4e37', '#e9f5f0', '#e9f5f0', 'pbt', 'alphaMods', 'simple', ['#7fffd4', '#c08a5a']],
  ['sky-blue', '스카이 블루', 'common', '맑은 하늘색이 천천히 숨쉰다', '#a9cbe0', '#1f3a5f', '#8fb4cf', '#1a3050', '#6f9cc0', '#ffffff', '#eef4f8', 'pbt', 'breathing', 'none', ['#7cc4ff']],
  ['slate', '슬레이트', 'common', '청회색 석판', '#4a5563', '#e2e8f0', '#3a4452', '#c9d3e0', '#64748b', '#ffffff', '#1f2937', 'shine', 'static', 'simple', ['#9fc3ff']],
  ['wine-cellar', '와인 셀러', 'common', '버건디와 크림, 촛불처럼 숨쉰다', '#6b1f2e', '#f0d9c4', '#561824', '#e2c3a8', '#8d242f', '#ffe9d6', '#2a0d13', 'pbt', 'breathing', 'none', ['#ff5a6e']],
  ['amber-mono', '앰버 모노', 'common', '호박색 모노크롬 단말기. 친 글자가 잔상으로 남는다', '#1a1408', '#ffb000', '#140f05', '#c98a00', '#3a2a08', '#ffcc4d', '#0c0a05', 'shine', 'static', 'afterglow', ['#ffb000']],

  ['carbon-fiber', '카본 파이버', 'uncommon', '크림·차콜에 오렌지 포인트', '#e3d9c6', '#575d5e', '#575d5e', '#ed6b21', '#ed6b21', '#2b2e2f', '#2b2e2f', 'pbt', 'alphaMods', 'simple', ['#ffd9b0', '#ff7a2e']],
  ['rose-cream', '로즈 크림', 'uncommon', '크림·블랙·핑크. 누른 키가 분홍 잔상으로 남는다', '#e1dbd1', '#2b2b2b', '#2b2b2b', '#e8bdb5', '#e8bdb5', '#2b2b2b', '#1c1c1c', 'pbt', 'breathing', 'afterglow', ['#ff9ec2']],
  ['bento', '도시락', 'uncommon', '크림 밥에 파랑·빨강 반찬. 체크무늬로 번갈아 빛난다', '#eee2d0', '#4f7ba0', '#4f7ba0', '#eee2d0', '#e0464e', '#eee2d0', '#f5efe6', 'pbt', 'checker', 'simple', ['#ff5a63', '#5b9bff']],
  ['fusion-lilac', '퓨전 라일락', 'uncommon', '라이트그레이·보라·청록', '#c6c9c7', '#5d437e', '#727474', '#00a4a9', '#5d437e', '#ffffff', '#3a3c3c', 'pbt', 'gradientSide', 'wide', ['#9b6bff', '#00d1d6']],
  ['greenhouse', '온실', 'uncommon', '흰빛 잎과 세이지·숲색이 번갈아 숨쉰다', '#dde5ed', '#6f8a72', '#3e5d58', '#94a596', '#94a596', '#24372f', '#24372f', 'pbt', 'hueBreathing', 'simple', ['#7ddc8a', '#c8f0a0', '#3fb59a']],
  ['deep-sub', '심해 탐사선', 'uncommon', '네이비·청록·머스터드. 탐조등처럼 흔들린다', '#1b365d', '#00a4a9', '#1f2a44', '#e5a100', '#e5a100', '#1f2a44', '#101a2c', 'shine', 'pendulum', 'wide', ['#00c8cc', '#ffb800']],
  ['green-phosphor', '그린 포스퍼', 'uncommon', '녹색 인광 단말기. 글자가 잔상으로 남는다', '#0b1a0f', '#33ff66', '#08140b', '#22c24d', '#164d24', '#7dff9f', '#050c07', 'shine', 'static', 'afterglow', ['#33ff66']],
  ['moon-console', '달착륙 콘솔', 'uncommon', '크림·파우더블루에 빨강 경고등이 뛴다', '#e8dfc8', '#2f3e4e', '#5991ae', '#f4f1e8', '#ba1312', '#ffffff', '#d9d2bf', 'pbt', 'heartbeat', 'simple', ['#ff3b30']],
  ['teal-pulse', '틸 펄스', 'uncommon', '검정에 청록 맥박', '#1c1c1c', '#00a6b4', '#00a6b4', '#1c1c1c', '#ff6800', '#1c1c1c', '#0f0f0f', 'shine', 'heartbeat', 'wide', ['#00d6e8']],
  ['ink-hanji', '먹과 한지', 'uncommon', '극흑과 한지 흰색. 평소엔 꺼져 있다가 친 키만 밝힌다', '#0e0e10', '#f4f1ea', '#f4f1ea', '#0e0e10', '#c43d2f', '#f4f1ea', '#18181b', 'pbt', 'off', 'simple', ['#fff6e0']],
  ['soot-sprite', '숯검댕이', 'uncommon', '크림 알파, 검정 모디, 붉은 포인트', '#e9e2d0', '#2a2a2a', '#222222', '#e9e2d0', '#d9706b', '#ffffff', '#2a2a2a', 'pbt', 'gradient', 'simple', ['#ff8a7a', '#ffd6a0']],
  ['water-ripple', '물결', 'uncommon', '연청·진청·흰색 물살이 위에서 아래로', '#a9cbe0', '#1f3a5f', '#1f3a5f', '#a9cbe0', '#f4f4f0', '#1f3a5f', '#eaf2f7', 'pbt', 'waveVertical', 'wide', ['#5ab8ff', '#bfe6ff', '#2a6fdb']],
  ['rgb-granite', 'RGB 화강암', 'uncommon', '회색 키캡에 원색 빗방울', '#e6e6e6', '#3a3a3a', '#9a9c9e', '#ffffff', '#2a6fdb', '#ffffff', '#9a9c9e', 'pbt', 'raindrops', 'simple', ['#2a6fdb', '#d93a3a', '#3aa655', '#f2c230']],
  ['dune', '듄', 'uncommon', '사막 모래와 테라코타, 저녁노을이 순환한다', '#d9c7a3', '#5a4630', '#b5653a', '#f3e6cc', '#b5653a', '#f3e6cc', '#8a6a45', 'pbt', 'spectrum', 'afterglow', ['#ff9a3c', '#ff5f3c', '#ffd27a']],

  ['crimson-armor', '홍염 갑주', 'rare', '진홍 갑옷에 금장. 금빛 탐조등이 좌우로 훑는다', '#651d32', '#d9b46a', '#25282a', '#d9b46a', '#b9975b', '#3a0e1a', '#151517', 'metal', 'scanner', 'cross', ['#ffc85a', '#ff3b4e']],
  ['night-count', '자정의 백작', 'rare', '코드 에디터 다크 테마. 형광 색들이 물결친다', '#44475a', '#f8f8f2', '#282a36', '#bd93f9', '#ff79c6', '#282a36', '#1e1f29', 'shine', 'wave', 'nexus', ['#ff79c6', '#bd93f9', '#8be9fd', '#50fa7b', '#f1fa8c']],
  ['pudding-candy', '푸딩 캔디', 'rare', '옆면이 비치는 푸딩 키캡. 누를 때마다 키에 사탕 색이 칠해진다', '#f2f2f2', '#1a1a1a', '#e4e4e4', '#1a1a1a', '#ff6ad5', '#ffffff', '#111114', 'pudding', 'outIn', 'paint', ['#ff6ad5', '#a46bff']],
  ['frosted-glass', '서리 유리', 'rare', '반투명 프로스트 케이스 안에서 빛이 연못처럼 번진다', '#1c1f26', '#e8f4ff', '#161920', '#9fd8ff', '#2c3442', '#ffffff', '#cfe0ff', 'frost', 'pond', 'rowSweep', ['#6fd3ff', '#b6a6ff']],
  ['aqua-crystal', '아쿠아 크리스탈', 'rare', '투명 키캡 아래 물빛이 대각선으로 흐른다', '#78dcff', '#ffffff', '#5ccaf0', '#ffffff', '#a0ebff', '#0a1620', '#0a1620', 'crystal', 'waveDiagonal', 'wide', ['#00e0ff', '#7cfff0', '#4f8dff']],
  ['walnut-brass', '월넛 & 브라스', 'rare', '월넛 나무 케이스와 황동. 불씨 혜성이 달린다', '#efe6d6', '#3b2a1e', '#d9ccb4', '#3b2a1e', '#c9a24a', '#3b2a1e', '#5b3a24', 'wood', 'comet', 'drop', ['#ffc26b', '#ff8a3c']],
  ['celadon', '청자', 'rare', '유광 세라믹 비취색. 두 줄기 빛이 돈다', '#a8c3b0', '#2f4a3c', '#7fa58c', '#f2f7f3', '#2f4a3c', '#e8efe9', '#e8efe9', 'ceramic', 'dualBeacon', 'simple', ['#7fffc4', '#bfe8ff']],
  ['blank-shadow', '블랭크 섀도', 'rare', '윗면이 빈 키캡, 앞면 글자만 빛난다. 레이더가 돈다', '#111216', '#7cc8ff', '#0c0d10', '#7cc8ff', '#2a2d36', '#7cc8ff', '#08090b', 'blank', 'radar', 'cross', ['#4fb6ff']],
  ['anodized-violet', '아노다이즈 바이올렛', 'rare', '보라 알루미늄 케이스. 화살표 빛이 흐른다', '#e9e4f2', '#5b3e8f', '#cfc5e3', '#3b2560', '#5b3e8f', '#ffffff', '#5b3e8f', 'metal', 'chevron', 'nexus', ['#9b6bff', '#ff6bd5']],

  ['synth-laser', '신스 레이저', 'epic', '80년대 아웃런. 게임 소리와 음악에 맞춰 막대가 솟는다', '#1a1033', '#00e5ff', '#140a28', '#ff2a8a', '#7a2cff', '#ffffff', '#1a0730', 'shine', 'audio', 'ripple', ['#ff2a8a', '#7a2cff', '#00e5ff']],
  ['aurora', '오로라', 'epic', '극지방 하늘. 녹색·보라 커튼이 일렁이고 누르면 불꽃이 튄다', '#0b1320', '#d6fff4', '#081019', '#2de2a6', '#7b5cff', '#ffffff', '#060b14', 'pudding', 'aurora', 'sparkle', ['#2de2a6', '#7b5cff', '#40c4ff']],
  ['neon-district', '네온 디스트릭트', 'epic', '사이버펑크 클럽. 소리가 클수록 가운데가 번쩍인다', '#0a0a0a', '#fcee0a', '#121212', '#00f0ff', '#fcee0a', '#0a0a0a', '#121212', 'shine', 'audioPulse', 'shockwave', ['#fcee0a', '#00f0ff', '#ff2bd6']],
  ['abyss-glow', '심해 발광', 'epic', '깊은 바다 생물처럼 키들이 반짝이고 물결이 번진다', '#0d2340', '#5ff3ff', '#081a31', '#e5a100', '#e5a100', '#081a31', '#061326', 'crystal', 'starlight', 'ripple', ['#5ff3ff', '#3d8bff', '#b7fff6']],
  ['code-rain', '코드 레인', 'epic', '녹색 문자비가 쏟아지고 친 글자가 잔상으로 남는다', '#050805', '#00ff41', '#030503', '#00c033', '#0f3d1a', '#00ff41', '#000000', 'blank', 'digitalRain', 'afterglow', ['#00ff41']],

  ['prism-overdrive', '프리즘 오버드라이브', 'legendary', '풀 스펙트럼 바람개비. 콤보가 오를수록 빨리 돌고, 누르면 무지개 물결', '#0b0b10', '#ffffff', '#08080c', '#e6e6ff', '#1a1a24', '#ffffff', '#050507', 'pudding', 'pinwheel', 'splash', 'rainbow', { underglow: true, energy: true }],
  ['gilded-artisan', '금빛 아티산', 'legendary', '녹아내리는 금. 황동 경면 케이스 위로 금빛 불꽃이 일렁이고 금가루가 튄다', '#f3e7c9', '#6b4a12', '#e4d3a6', '#6b4a12', '#d4af37', '#3a2608', '#b8862b', 'metal', 'fire', 'sparkle', ['#fff1b8', '#ffd24a', '#ff9f1c', '#c4610a'], { underglow: true }],
  ['event-horizon', '이벤트 호라이즌', 'legendary', '블랙홀. 강착원반이 소용돌이치고 누른 곳의 빛을 삼킨다', '#050507', '#f5f5ff', '#030304', '#ffd36e', '#ff7a18', '#050507', '#000000', 'crystal', 'spiral', 'blackhole', ['#ff7a18', '#ffd36e', '#ff3d6e', '#7a2cff'], { underglow: true }],
  ['typecode-overclock', 'TYPE//CODE 오버클럭', 'legendary', '이 게임의 시그니처. 플라즈마가 흐르고 자주 치는 키가 뜨겁게 달아오른다. 콤보에 비례해 빨라진다', '#0a0f14', '#00f0ff', '#070b0f', '#ff2bd6', '#39ff88', '#05080b', '#05080b', 'shine', 'plasma', 'heatmap', ['#00f0ff', '#ff2bd6', '#39ff88'], { underglow: true, energy: true }]
];

export const SKINS = Object.freeze(ROWS.map(([id, name, rarity, description, alphaBg, alphaFg, modBg, modFg, accentBg, accentFg, caseColor, material, pattern, reactive, colors, extra = {}]) => Object.freeze({
  id, name, rarity, description, material,
  colors: Object.freeze({ alphaBg, alphaFg, modBg, modFg, accentBg, accentFg, case: caseColor }),
  led: Object.freeze({ pattern, reactive, palette: ledPalette(colors), speed: 1, energy: Boolean(extra.energy) }),
  underglow: Boolean(extra.underglow)
})));

export const DEFAULT_SKIN_ID = 'base';
export const SKIN_BY_ID = new Map(SKINS.map(skin => [skin.id, skin]));
export const COLLECTIBLE_SKINS = Object.freeze(SKINS.filter(skin => skin.id !== DEFAULT_SKIN_ID));
export const getSkin = id => SKIN_BY_ID.get(id) ?? SKIN_BY_ID.get(DEFAULT_SKIN_ID);

// 가진 스킨들이 쓰는 LED 무늬·터치 반응 = 내 키보드에 고를 수 있는 LED 모드(꺼짐·없음은 항상)
export function unlockedLedModes(ownedIds) {
  const patterns = new Set(['off']);
  const reactives = new Set(['none']);
  for (const id of ownedIds) {
    const skin = SKIN_BY_ID.get(id);
    if (!skin) continue;
    patterns.add(skin.led.pattern);
    reactives.add(skin.led.reactive);
  }
  return { patterns, reactives };
}

// 이 LED 모드를 쓰는 스킨들(잠긴 모드에 '어느 스킨에서 열리는지' 알려 줄 때)
export const skinsWithLedMode = (kind, mode) => SKINS.filter(skin => skin.led[kind] === mode);
