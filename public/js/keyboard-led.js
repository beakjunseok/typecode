// 키보드 LED 효과 엔진(순수 계산). 화면 키보드의 키마다 매 프레임 색을 정한다.
// 평상시 무늬(AMBIENT)와 키를 누를 때 반응(REACTIVE)을 따로 고르고 겹친다.
// 색은 { h: 0~360, s: 0~100, l: 0~100, a: 0~1 }. 키 좌표는 x = 0~15(키 단위), y = 0~4(줄).

export const BOARD = Object.freeze({ width: 15, height: 4, centerX: 7.5, centerY: 2 });
const TAU = Math.PI * 2;
const RAINBOW = 'rainbow';

const clamp01 = value => Math.max(0, Math.min(1, value));
const fract = value => value - Math.floor(value);
// 키 번호·시각 칸으로 0~1 난수(같은 입력이면 같은 값 — 무작위처럼 보이지만 상태가 필요 없다)
const hash = (first, second = 0) => fract(Math.sin(first * 127.1 + second * 311.7) * 43758.5453);
// 부드러운 1차원 잡음: 정수 칸의 난수를 이어 붙인다
function smoothNoise(position, seed) {
  const cell = Math.floor(position);
  const blend = position - cell;
  const eased = blend * blend * (3 - 2 * blend);
  return hash(cell, seed) * (1 - eased) + hash(cell + 1, seed) * eased;
}

// 팔레트에서 위치 p(0~1, 순환)의 색. 'rainbow'면 무지개, 아니면 [h, s, l] 목록을 고리로 이어 섞는다
export function paletteColor(palette, position) {
  const p = fract(position);
  if (palette === RAINBOW || !palette?.length) return { h: p * 360, s: 95, l: 58 };
  if (palette.length === 1) return { h: palette[0][0], s: palette[0][1], l: palette[0][2] };
  const scaled = p * palette.length;
  const index = Math.floor(scaled);
  const from = palette[index];
  const to = palette[(index + 1) % palette.length];
  const blend = scaled - index;
  let hueDelta = to[0] - from[0];
  if (hueDelta > 180) hueDelta -= 360;
  if (hueDelta < -180) hueDelta += 360;
  return {
    h: (from[0] + hueDelta * blend + 360) % 360,
    s: from[1] + (to[1] - from[1]) * blend,
    l: from[2] + (to[2] - from[2]) * blend
  };
}

const polar = key => {
  const dx = key.x - BOARD.centerX;
  const dy = (key.y - BOARD.centerY) * 2.2;
  return { angle: Math.atan2(dy, dx), distance: Math.hypot(dx, dy) };
};
const lit = (color, alpha = 1) => ({ ...color, a: clamp01(alpha) });
// 회전하는 빛줄기: 각도 차이가 0일 때 1, 뒤로 갈수록 꼬리처럼 어두워진다
const sweepTail = (angle, head, tail) => {
  const behind = fract((head - angle) / TAU);
  return behind < tail ? 1 - behind / tail : 0;
};

// ---------- 평상시 무늬 ----------
// 각 함수: (key, t초, env) → 색. env = { palette, bands(소리 대역 0~1 배열), level(소리 크기 0~1) }
export const AMBIENT = Object.freeze({
  off: () => ({ h: 0, s: 0, l: 0, a: 0 }),
  // 고정: 한 가지 색
  static: (key, t, env) => lit(paletteColor(env.palette, 0), 0.8),
  // 글자키·기능키 두 색
  alphaMods: (key, t, env) => lit(paletteColor(env.palette, key.mod ? 0.5 : 0), 0.8),
  // 위아래·좌우 그라데이션
  gradient: (key, t, env) => lit(paletteColor(env.palette, key.y / BOARD.height * 0.8), 0.8),
  gradientSide: (key, t, env) => lit(paletteColor(env.palette, key.x / BOARD.width * 0.8), 0.8),
  // 숨쉬기: 부드럽게 밝아졌다 어두워진다(4초 주기)
  breathing: (key, t, env) => lit(paletteColor(env.palette, 0), 0.12 + 0.88 * Math.sin(t * TAU / 4 / 2) ** 2),
  // 색 바뀌는 숨쉬기: 숨을 쉴 때마다 다음 색으로
  hueBreathing: (key, t, env) => {
    const breath = t / 4;
    return lit(paletteColor(env.palette, Math.floor(breath) * 0.21), 0.1 + 0.9 * Math.sin(fract(breath) * Math.PI) ** 2);
  },
  // 심장박동: 쿵-쿵 두 번 뛰고 쉰다
  heartbeat: (key, t, env) => {
    const beat = fract(t / 1.3);
    const pulse = Math.exp(-((beat - 0.08) ** 2) / 0.003) + 0.7 * Math.exp(-((beat - 0.3) ** 2) / 0.004);
    const reach = 1 - polar(key).distance / 12;
    return lit(paletteColor(env.palette, 0), 0.12 + pulse * (0.4 + 0.6 * reach));
  },
  // 스펙트럼: 모든 키가 같은 색으로 천천히 순환
  spectrum: (key, t, env) => lit(paletteColor(env.palette, t * 0.08), 0.85),
  // 웨이브: 왼쪽에서 오른쪽 / 위에서 아래 / 대각선
  wave: (key, t, env) => lit(paletteColor(env.palette, key.x / BOARD.width - t * 0.22), 0.9),
  waveVertical: (key, t, env) => lit(paletteColor(env.palette, key.y / BOARD.height * 0.7 - t * 0.22), 0.9),
  waveDiagonal: (key, t, env) => lit(paletteColor(env.palette, (key.x + key.y * 2) / 22 - t * 0.2), 0.9),
  // 화살표(갈매기) 무늬가 옆으로 흐른다
  chevron: (key, t, env) => lit(paletteColor(env.palette, key.x / BOARD.width + Math.abs(key.y - BOARD.centerY) * 0.14 - t * 0.22), 0.9),
  // 가운데에서 바깥으로 색이 퍼진다
  outIn: (key, t, env) => lit(paletteColor(env.palette, polar(key).distance / 10 - t * 0.2), 0.9),
  // 연못 물결: 가운데에서 밝은 고리가 계속 번져 나간다
  pond: (key, t, env) => {
    const ring = Math.sin(polar(key).distance * 1.1 - t * 3.2);
    return lit(paletteColor(env.palette, polar(key).distance / 14), 0.15 + 0.85 * Math.max(0, ring) ** 2);
  },
  // 바람개비: 가운데를 축으로 색이 회전
  pinwheel: (key, t, env) => lit(paletteColor(env.palette, polar(key).angle / TAU + t * 0.18), 0.9),
  // 소용돌이: 회전하면서 바깥으로 말려 나간다
  spiral: (key, t, env) => {
    const { angle, distance } = polar(key);
    return lit(paletteColor(env.palette, angle / TAU + distance * 0.09 - t * 0.2), 0.9);
  },
  // 등대 두 개: 반대 방향 두 빛줄기가 돈다
  dualBeacon: (key, t, env) => {
    const side = Math.cos(polar(key).angle - t * 1.4);
    return lit(paletteColor(env.palette, side > 0 ? 0 : 0.5), 0.12 + 0.88 * Math.abs(side) ** 2.5);
  },
  // 레이더: 빛줄기 하나가 꼬리를 끌며 돈다
  radar: (key, t, env) => lit(paletteColor(env.palette, 0), 0.07 + 0.93 * sweepTail(polar(key).angle + Math.PI, fract(t / 3) * TAU, 0.45) ** 1.6),
  // 스캐너: 세로 띠가 좌우로 왕복
  scanner: (key, t, env) => {
    const phase = fract(t / 2.4);
    const head = (phase < 0.5 ? phase * 2 : 2 - phase * 2) * BOARD.width;
    const gap = Math.abs(key.x - head);
    return lit(paletteColor(env.palette, 0), 0.06 + 0.94 * Math.max(0, 1 - gap / 2.6) ** 1.5);
  },
  // 혜성: 빛 한 점이 줄을 따라 지그재그로 달리며 꼬리를 남긴다
  comet: (key, t, env) => {
    const path = key.y * BOARD.width + (key.y % 2 === 0 ? key.x : BOARD.width - key.x);
    const total = BOARD.width * (BOARD.height + 1);
    const behind = fract((t * 22 - path) / total) * total;
    return lit(paletteColor(env.palette, path / total), 0.06 + 0.94 * Math.max(0, 1 - behind / 14) ** 2);
  },
  // 빗방울: 키마다 제멋대로 색이 바뀐다
  raindrops: (key, t, env) => {
    const slot = t / 1.6 + hash(key.index, 3);
    const mix = Math.min(1, fract(slot) * 4);
    const previous = paletteColor(env.palette, hash(key.index, Math.floor(slot) - 1));
    const next = paletteColor(env.palette, hash(key.index, Math.floor(slot)));
    return lit(paletteColor([[previous.h, previous.s, previous.l], [next.h, next.s, next.l]], mix * 0.5), 0.8);
  },
  // 별빛: 키들이 제각각 반짝인다
  starlight: (key, t, env) => {
    const twinkle = Math.max(0, Math.sin(t * (0.8 + hash(key.index, 7) * 1.6) + hash(key.index, 9) * TAU)) ** 8;
    return lit(paletteColor(env.palette, hash(key.index, 11)), 0.05 + 0.95 * twinkle);
  },
  // 문자비: 세로줄마다 빛이 위에서 아래로 떨어진다
  digitalRain: (key, t, env) => {
    const column = Math.round(key.x);
    const span = BOARD.height + 5;
    const head = fract(t * (0.25 + hash(column, 5) * 0.3) + hash(column, 6)) * span - 1;
    const above = head - key.y;
    if (above < 0 || above > 3.2) return lit(paletteColor(env.palette, 0), 0.04);
    const color = paletteColor(env.palette, 0);
    return above < 0.5 ? { h: color.h, s: 30, l: 88, a: 1 } : lit(color, 1 - above / 3.2);
  },
  // 불꽃: 아래가 뜨겁고 위로 갈수록 일렁이며 식는다
  fire: (key, t, env) => {
    const flicker = smoothNoise(t * 3.2 + key.x * 0.7, Math.round(key.x)) * 0.6 + smoothNoise(t * 6 + key.x, 40) * 0.4;
    const heat = clamp01((key.y / BOARD.height) * 0.75 + flicker * 0.7 - 0.25);
    return lit(paletteColor(env.palette, heat * 0.49), heat ** 1.3);
  },
  // 오로라: 느린 색 커튼이 일렁인다
  aurora: (key, t, env) => {
    const curtain = 0.5 + 0.5 * Math.sin(key.x * 0.45 + t * 0.5 + Math.sin(key.y * 0.9 - t * 0.3));
    return lit(paletteColor(env.palette, curtain * 0.49 + t * 0.01), 0.3 + 0.7 * curtain);
  },
  // 플라즈마: 여러 물결이 겹친 무늬
  plasma: (key, t, env) => {
    const value = Math.sin(key.x * 0.5 + t) + Math.sin(key.y * 1.3 - t * 0.7) + Math.sin((key.x + key.y * 2) * 0.3 + t * 0.5);
    return lit(paletteColor(env.palette, value / 6 + 0.5 + t * 0.03), 0.85);
  },
  // 진자: 색이 좌우로 흔들린다
  pendulum: (key, t, env) => lit(paletteColor(env.palette, key.x / BOARD.width * 0.5 + 0.25 * Math.sin(t * 1.2)), 0.85),
  // 체크무늬가 번갈아 깜빡인다
  checker: (key, t, env) => {
    const even = (Math.round(key.x) + key.y) % 2 === 0;
    const swing = 0.5 + 0.5 * Math.sin(t * 2.2);
    return lit(paletteColor(env.palette, even ? 0 : 0.5), 0.12 + 0.88 * (even ? swing : 1 - swing));
  },
  // 소리 반응: 게임 소리·음악의 대역별 크기만큼 막대가 솟는다. 소리가 없으면 낮게 숨쉰다
  audio: (key, t, env) => {
    const bands = env.bands;
    if (!bands?.length) return lit(paletteColor(env.palette, key.x / BOARD.width), 0.1 + 0.15 * Math.sin(t * 1.5) ** 2);
    const band = bands[Math.min(bands.length - 1, Math.floor(key.x / BOARD.width * bands.length))] ?? 0;
    const height = (BOARD.height - key.y + 0.5) / (BOARD.height + 1);
    const on = clamp01((band * 1.25 - height) * 6 + 0.5);
    return lit(paletteColor(env.palette, key.x / BOARD.width * 0.8), 0.07 + 0.93 * on);
  },
  // 소리 맥박: 소리가 클수록 가운데에서 크게 번쩍인다
  audioPulse: (key, t, env) => {
    const level = env.level ?? 0;
    const reach = clamp01(1.15 - polar(key).distance / (2 + level * 14));
    return lit(paletteColor(env.palette, t * 0.05 + polar(key).distance / 20), 0.08 + 0.92 * reach * (0.3 + level));
  }
});

// ---------- 터치 반응 ----------
// 각 항목: life 한 번 누른 효과가 남는 시간(초), color(key, hit, age, env) → 그 키에 더할 빛(없으면 null).
// hit = { x, y, index, time, ok, order }
const fade = (age, life) => Math.max(0, 1 - age / life);
const hitColor = (env, hit, shift = 0) => hit.ok === false ? { h: 350, s: 95, l: 60 } : paletteColor(env.reactivePalette ?? env.palette, shift + hit.order * 0.13);
const distanceTo = (key, hit) => Math.hypot(key.x - hit.x, (key.y - hit.y) * 1.6);

export const REACTIVE = Object.freeze({
  none: null,
  // 누른 키만 켜졌다 꺼진다
  simple: { life: 0.55, color: (key, hit, age, env) => key.index === hit.index ? lit(hitColor(env, hit), fade(age, 0.55)) : null },
  // 누른 키가 오래 남는다(잔광)
  afterglow: { life: 2.4, color: (key, hit, age, env) => key.index === hit.index ? lit(hitColor(env, hit), fade(age, 2.4) ** 1.5) : null },
  // 주변 키까지 번진다
  wide: {
    life: 0.7,
    color: (key, hit, age, env) => {
      const near = 1 - distanceTo(key, hit) / 2.6;
      return near > 0 ? lit(hitColor(env, hit), near * fade(age, 0.7)) : null;
    }
  },
  // 같은 줄·같은 열이 십자로 켜진다
  cross: {
    life: 0.7,
    color: (key, hit, age, env) => {
      const sameRow = key.y === hit.y;
      const sameColumn = Math.abs(key.x - hit.x) < 0.8;
      return sameRow || sameColumn ? lit(hitColor(env, hit), fade(age, 0.7)) : null;
    }
  },
  // 십자 방향으로 빛이 달려 나간다
  nexus: {
    life: 0.9,
    color: (key, hit, age, env) => {
      const sameRow = key.y === hit.y;
      const sameColumn = Math.abs(key.x - hit.x) < 0.8;
      if (!sameRow && !sameColumn) return null;
      const travelled = sameRow ? Math.abs(key.x - hit.x) : Math.abs(key.y - hit.y) * 3;
      const gap = Math.abs(travelled - age * 18);
      return gap < 2 ? lit(hitColor(env, hit), (1 - gap / 2) * fade(age, 0.9)) : null;
    }
  },
  // 물결: 누른 곳에서 고리가 퍼져 나간다
  ripple: {
    life: 1.1,
    color: (key, hit, age, env) => {
      const gap = Math.abs(distanceTo(key, hit) - age * 14);
      return gap < 1.3 ? lit(hitColor(env, hit), (1 - gap / 1.3) * fade(age, 1.1)) : null;
    }
  },
  // 무지개 물결: 고리가 퍼지면서 색이 바뀐다
  splash: {
    life: 1.2,
    color: (key, hit, age) => {
      const distance = distanceTo(key, hit);
      const gap = Math.abs(distance - age * 13);
      return gap < 1.6 ? lit(paletteColor(RAINBOW, distance / 9 + hit.order * 0.17), (1 - gap / 1.6) * fade(age, 1.2)) : null;
    }
  },
  // 충격파: 속이 찬 원이 퍼지며 사라진다
  shockwave: {
    life: 0.6,
    color: (key, hit, age, env) => distanceTo(key, hit) < age * 26 ? lit(hitColor(env, hit), fade(age, 0.6) ** 2) : null
  },
  // 줄 훑기: 누른 줄 전체로 빛이 좌우로 갈라져 달린다
  rowSweep: {
    life: 0.7,
    color: (key, hit, age, env) => {
      if (key.y !== hit.y) return null;
      const gap = Math.abs(Math.abs(key.x - hit.x) - age * 24);
      return gap < 2.2 ? lit(hitColor(env, hit), (1 - gap / 2.2) * fade(age, 0.7)) : null;
    }
  },
  // 낙하: 누른 자리에서 빛방울이 아래로 떨어진다
  drop: {
    life: 0.8,
    color: (key, hit, age, env) => {
      if (Math.abs(key.x - hit.x) > 0.8 || key.y < hit.y) return null;
      const gap = Math.abs(key.y - hit.y - age * 7);
      return gap < 1 ? lit(hitColor(env, hit), 1 - gap) : null;
    }
  },
  // 불꽃놀이: 주변 키들이 무작위로 튄다
  sparkle: {
    life: 0.8,
    color: (key, hit, age, env) => {
      const distance = distanceTo(key, hit);
      if (distance > 4.2) return null;
      const chosen = key.index === hit.index || hash(key.index, hit.order) > 0.55;
      const delay = distance * 0.05;
      return chosen && age > delay ? lit(hitColor(env, hit, hash(key.index, hit.order + 5) * 0.4), fade(age - delay, 0.6)) : null;
    }
  },
  // 블랙홀: 누른 곳 주변의 불빛이 잠깐 꺼진다(평상시 무늬가 있을 때 잘 보인다)
  blackhole: {
    life: 0.9,
    color: (key, hit, age) => {
      const near = 1 - distanceTo(key, hit) / 4;
      return near > 0 ? { dim: near * fade(age, 0.9) } : null;
    }
  }
});

// 열 지도·물감은 누적 상태가 필요해서 따로 다룬다
export const STATEFUL_REACTIVE = Object.freeze(['heatmap', 'paint']);
export const REACTIVE_NAMES = Object.freeze([...Object.keys(REACTIVE), ...STATEFUL_REACTIVE]);
export const AMBIENT_NAMES = Object.freeze(Object.keys(AMBIENT));

export const LED_LABELS = Object.freeze({
  off: '꺼짐', static: '고정', alphaMods: '두 색', gradient: '세로 그라데이션', gradientSide: '가로 그라데이션',
  breathing: '숨쉬기', hueBreathing: '색 바뀌는 숨쉬기', heartbeat: '심장박동', spectrum: '스펙트럼 순환',
  wave: '웨이브', waveVertical: '세로 웨이브', waveDiagonal: '대각선 웨이브', chevron: '화살표 웨이브', outIn: '안에서 밖으로',
  pond: '연못 물결', pinwheel: '바람개비', spiral: '소용돌이', dualBeacon: '쌍등대', radar: '레이더', scanner: '스캐너',
  comet: '혜성', raindrops: '빗방울', starlight: '별빛', digitalRain: '문자비', fire: '불꽃', aurora: '오로라', plasma: '플라즈마',
  pendulum: '진자', checker: '체크 점멸', audio: '소리 막대', audioPulse: '소리 맥박',
  none: '없음', simple: '누른 키', afterglow: '잔광', wide: '주변 번짐', cross: '십자', nexus: '십자 질주', ripple: '물결',
  splash: '무지개 물결', shockwave: '충격파', rowSweep: '줄 훑기', drop: '낙하', sparkle: '불꽃놀이', blackhole: '블랙홀',
  heatmap: '열 지도', paint: '물감'
});

const MAX_HITS = 14;
const HEAT_PER_HIT = 0.34;
const HEAT_SPREAD = 0.12;
const HEAT_COOLING_PER_SECOND = 0.16;

// 키보드 하나의 LED 상태(누른 기록·열·물감)를 들고 매 프레임 키 색을 계산한다. O(키 수 × 남은 타격 수)
export function createLedState(keys) {
  let hits = [];
  let order = 0;
  let heat = new Float32Array(keys.length);
  let paint = new Int16Array(keys.length).fill(-1);
  let lastTime = null;

  function reset() {
    hits = [];
    heat = new Float32Array(keys.length);
    paint = new Int16Array(keys.length).fill(-1);
    lastTime = null;
  }

  // 키를 눌렀다고 알린다. ok === false면 오타(빨강)
  function hit(index, time, ok = true) {
    const key = keys[index];
    if (!key) return;
    order++;
    hits.push({ x: key.x, y: key.y, index, time, ok, order });
    if (hits.length > MAX_HITS) hits.shift();
    heat[index] = Math.min(1, heat[index] + HEAT_PER_HIT);
    for (const other of keys) {
      const distance = Math.hypot(other.x - key.x, (other.y - key.y) * 1.6);
      if (other.index !== index && distance < 1.8) heat[other.index] = Math.min(1, heat[other.index] + HEAT_SPREAD);
    }
    paint[index] = paint[index] === order % 6 ? -1 : order % 6;
  }

  // led = { pattern, reactive, palette, reactivePalette, speed, strength }. 결과를 out[키 번호]에 쓴다
  function frame(time, led, env = {}, out = []) {
    const dt = lastTime === null ? 0 : Math.max(0, Math.min(10, time - lastTime));
    lastTime = time;
    for (let index = 0; index < heat.length; index++) heat[index] = Math.max(0, heat[index] - HEAT_COOLING_PER_SECOND * dt);
    const reactive = REACTIVE[led.reactive] ?? null;
    const longest = reactive?.life ?? 0;
    hits = hits.filter(entry => time - entry.time <= Math.max(longest, 0.05));
    const ambient = AMBIENT[led.pattern] ?? AMBIENT.off;
    const scene = { palette: led.palette, reactivePalette: led.reactivePalette, bands: env.bands, level: env.level };
    const speed = (led.speed ?? 1) * (1 + (env.energy ?? 0) * (led.energy ? 1.5 : 0));
    const strength = (led.strength ?? 1) * (led.energy ? 0.7 + 0.3 * (env.energy ?? 0) : 1);

    for (const key of keys) {
      const color = ambient(key, time * speed, scene);
      let { h, s, l } = color;
      let alpha = color.a * strength;
      if (reactive) {
        for (const entry of hits) {
          const glow = reactive.color(key, entry, time - entry.time, scene);
          if (!glow) continue;
          if (glow.dim !== undefined) {
            alpha *= 1 - clamp01(glow.dim);
          } else if (glow.a > 0.01) {
            if (glow.a >= alpha * 0.6) ({ h, s, l } = glow);
            alpha = Math.max(alpha, glow.a);
          }
        }
      } else if (led.reactive === 'heatmap') {
        const warmth = heat[key.index];
        if (warmth > 0.02) {
          h = 240 - 240 * warmth;
          s = 95;
          l = 50 + warmth * 12;
          alpha = Math.max(alpha, 0.25 + 0.75 * warmth);
        }
      } else if (led.reactive === 'paint' && paint[key.index] >= 0) {
        ({ h, s, l } = paletteColor(led.reactivePalette ?? RAINBOW, paint[key.index] / 6));
        alpha = Math.max(alpha, 0.9);
      }
      const target = out[key.index] ?? (out[key.index] = { h: 0, s: 0, l: 0, a: 0 });
      target.h = h;
      target.s = s;
      target.l = l;
      target.a = clamp01(alpha);
    }
    return out;
  }

  return { hit, frame, reset };
}
