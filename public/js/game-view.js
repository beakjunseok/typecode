// 아케이드 캔버스 공통 도구: 고해상도(DPR) 캔버스, 토큰 라벨, 파티클, HUD(생명·아이템 게이지).
// 2D 컨텍스트가 없는 환경(테스트용 가상 DOM 등)에서는 모든 그리기가 아무 일도 하지 않는다.
import { TOKEN_KINDS } from './tokens.js';

export const LABEL_FONT = "600 14px 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace";
// 캔버스 글꼴 역할: display = Galmuri11 픽셀 글꼴(12px 격자라 12의 배수에서 또렷함), ui = Pretendard, code = JetBrains Mono
export const CANVAS_FONTS = Object.freeze({
  display: "'Galmuri11', 'Pretendard Variable', ui-monospace, monospace",
  ui: "'Pretendard Variable', Pretendard, -apple-system, 'Apple SD Gothic Neo', system-ui, sans-serif",
  code: "'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace"
});
export const canvasFont = (size, family = 'display', weight = 400) => `${weight} ${size}px ${CANVAS_FONTS[family]}`;

// 시드 고정 난수(mulberry32): 배경 실루엣처럼 매 프레임 같은 모양이어야 하는 장식에 쓴다
export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
const MAX_PARTICLES = 400;

export function setupCanvas(canvas) {
  const context = canvas?.getContext?.('2d') ?? null;
  // maxRatio: 화면 배율 상한(기본 2). 느린 기기에서는 낮춰 픽셀 수를 줄인다
  const surface = { canvas, context, width: 0, height: 0, ratio: 1, maxRatio: 2 };
  const resize = () => {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(globalThis.devicePixelRatio || 1, surface.maxRatio);
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    // 크기가 같으면 캔버스를 다시 할당하지 않는다(매 프레임 호출돼도 비용 없음).
    if (width === surface.width && height === surface.height && ratio === surface.ratio) return;
    surface.width = width;
    surface.height = height;
    surface.ratio = ratio;
    canvas.width = Math.round(surface.width * ratio);
    canvas.height = Math.round(surface.height * ratio);
    context?.setTransform(ratio, 0, 0, ratio, 0, 0);
  };
  resize();
  if (typeof ResizeObserver === 'function' && canvas) new ResizeObserver(resize).observe(canvas);
  surface.resize = resize;
  surface.setMaxRatio = value => {
    surface.maxRatio = Math.max(1, Number(value) || 2);
    resize();
  };
  return surface;
}

// ---------- 자동 화질 조절(모든 아케이드 게임 공용) ----------
// 프레임 간격(지수 평균)을 재서 1.5초 넘게 느리면(24ms↑) 저사양 모드, 4초 넘게 60fps 근처(18ms↓)면 되돌린다.
// 왔다 갔다 하지 않도록 두 번째로 저사양이 되면 그 뒤로는 되돌리지 않는다.
// 저사양 모드: 그림자 흐림(shadowBlur)·필터(filter)를 끄고(둘 다 그릴 때마다 픽셀을 다시 훑어 가장 비싸다) 화면 배율을 1.5로 낮춘다.
// 그리는 코드를 고치지 않도록 그 캔버스 context의 두 속성만 가로챈다. 같은 캔버스를 쓰는 렌더러끼리 하나를 나눠 쓴다
const QUALITY_BY_CANVAS = new WeakMap();

export class QualityGovernor {
  constructor(context) {
    this.lowFx = false;
    this.frameMs = 16;
    this.slowSince = null;
    this.fastSince = null;
    this.lastAt = null;
    this.downgrades = 0;
    this.surfaces = new Set();
    this.listeners = new Set();
    this.install(context);
  }

  install(context) {
    const prototype = context && Object.getPrototypeOf(context);
    const shadow = prototype && Object.getOwnPropertyDescriptor(prototype, 'shadowBlur');
    const filter = prototype && Object.getOwnPropertyDescriptor(prototype, 'filter');
    const governor = this;
    try {
      if (shadow?.set) Object.defineProperty(context, 'shadowBlur', { configurable: true, get() { return shadow.get.call(this); }, set(value) { shadow.set.call(this, governor.lowFx ? 0 : value); } });
      if (filter?.set) Object.defineProperty(context, 'filter', { configurable: true, get() { return filter.get.call(this); }, set(value) { filter.set.call(this, governor.lowFx ? 'none' : value); } });
    } catch {
      /* 가로챌 수 없는 환경이면 그대로 둔다 */
    }
  }

  // 매 프레임 한 번. running이 아니면(결과 화면 등) 재지 않는다. 5초 넘는 공백(탭 이동)은 버리고, 큰 간격은 100ms로 자른다
  tick(running, now = (globalThis.performance?.now() ?? Date.now()) / 1000) {
    const delta = this.lastAt == null ? 0 : now - this.lastAt;
    this.lastAt = now;
    if (!running || !(delta > 0) || delta > 5) return;
    this.frameMs += (Math.min(0.1, delta) * 1000 - this.frameMs) * 0.1;
    if (!this.lowFx) {
      this.slowSince = this.frameMs > 24 ? this.slowSince ?? now : null;
      if (this.slowSince != null && now - this.slowSince > 1.5) this.setLowFx(true);
    } else {
      if (this.downgrades >= 2) return;
      this.fastSince = this.frameMs < 18 ? this.fastSince ?? now : null;
      if (this.fastSince != null && now - this.fastSince > 4) this.setLowFx(false);
    }
  }

  setLowFx(enabled) {
    if (enabled && !this.lowFx) this.downgrades++;
    this.lowFx = Boolean(enabled);
    this.slowSince = null;
    this.fastSince = null;
    for (const surface of this.surfaces) surface.setMaxRatio?.(this.lowFx ? 1.5 : 2);
    for (const listener of this.listeners) listener(this.lowFx);
  }

  onChange(listener) {
    this.listeners.add(listener);
  }
}

// 이 캔버스의 화질 조절기(없으면 만든다)
export function qualityFor(surface) {
  const canvas = surface?.canvas;
  if (!canvas || !surface.context) return new QualityGovernor(null);
  let governor = QUALITY_BY_CANVAS.get(canvas);
  if (!governor) {
    governor = new QualityGovernor(surface.context);
    QUALITY_BY_CANVAS.set(canvas, governor);
  }
  governor.surfaces.add(surface);
  return governor;
}

// 배경 그림을 한 번만 불러 둔다(브라우저가 아니면 null). 그릴 때는 isArtReady로 다 받았는지 확인한다
export function loadArt(source) {
  if (typeof Image === 'undefined') return null;
  return Object.assign(new Image(), { src: source, decoding: 'async' });
}

export const isArtReady = image => Boolean(image?.complete && image.naturalWidth);

// 그림이 상자를 빈틈없이 덮도록 비율을 지켜 키운다. focusX/focusY(0~1)는 잘릴 때 남길 기준점.
// 그림이 아직 없으면 아무것도 그리지 않고 false를 돌려준다(호출한 쪽이 그리던 배경을 그대로 쓴다)
export function drawCoverArt(context, image, { x = 0, y = 0, width, height, focusX = 0.5, focusY = 0.5, alpha = 1 }) {
  if (!isArtReady(image) || !(width > 0) || !(height > 0)) return false;
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  context.save();
  context.globalAlpha = alpha;
  context.drawImage(image, x + (width - drawWidth) * focusX, y + (height - drawHeight) * focusY, drawWidth, drawHeight);
  context.restore();
  return true;
}

export function roundedRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

// 개발용 위치 기록: globalThis.__TYPECODE_RECT__ 배열이 있을 때만(게임 방법 캡처 스크립트) 그린 사각형의 화면 위치(CSS px)를 남긴다
export function recordRect(context, key, left, top, width, height) {
  const recorder = globalThis.__TYPECODE_RECT__;
  if (!Array.isArray(recorder)) return;
  const matrix = context.getTransform();
  const scale = context.canvas.width / Math.max(1, context.canvas.clientWidth);
  const point = (x, y) => ({ x: (matrix.a * x + matrix.c * y + matrix.e) / scale, y: (matrix.b * x + matrix.d * y + matrix.f) / scale });
  const first = point(left, top), second = point(left + width, top + height);
  recorder.push({ key, left: Math.min(first.x, second.x), top: Math.min(first.y, second.y), width: Math.abs(second.x - first.x), height: Math.abs(second.y - first.y) });
}

// 목표 머리 위 토큰 라벨: 조준 중이면 테두리 강조, 글자는 맞음(종류 색)/틀림(빨강)/다음(밑줄)/대기.
export const LABEL_FONT_COMPACT = "600 12px 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace";

export function drawTokenLabel(context, centerX, bottomY, entity, states, { active, accent, dimmed = false, compact = false, attacker = null }) {
  const text = entity.token.text;
  const kindColor = TOKEN_KINDS[entity.token.kind]?.color ?? '#c9d4e0';
  context.font = compact ? LABEL_FONT_COMPACT : LABEL_FONT;
  const characterWidth = context.measureText('M').width;
  const width = characterWidth * text.length + (compact ? 12 : 16);
  const height = compact ? 21 : 24;
  const left = Math.round(centerX - width / 2);
  const top = Math.round(bottomY - height);

  recordRect(context, entity.id, left, top, width, height);
  context.globalAlpha = dimmed ? 0.45 : 1;
  roundedRect(context, left, top, width, height, 6);
  context.fillStyle = active ? 'rgba(16, 21, 28, 0.96)' : 'rgba(10, 13, 18, 0.82)';
  context.fill();
  context.lineWidth = active ? 2 : 1;
  context.strokeStyle = active ? accent : 'rgba(75, 87, 103, 0.9)';
  if (active) {
    context.shadowColor = accent;
    context.shadowBlur = 12;
  }
  context.stroke();
  context.shadowBlur = 0;

  context.textBaseline = 'middle';
  const padding = compact ? 6 : 8;
  [...text].forEach((character, index) => {
    const x = left + padding + index * characterWidth;
    const state = states[index];
    // 상대(AI)가 이 낱말을 치는 중이면 진행한 글자에 빨간 밑줄
    if (attacker && index < attacker) {
      context.fillStyle = 'rgba(255, 77, 109, 0.85)';
      context.fillRect(x, top + 2, characterWidth, 2);
    }
    if (state === 'wrong') {
      context.fillStyle = 'rgba(255, 77, 109, 0.45)';
      context.fillRect(x, top + 3, characterWidth, height - 6);
      context.fillStyle = '#ffffff';
    } else if (state === 'correct') {
      context.fillStyle = kindColor;
    } else if (state === 'current') {
      context.fillStyle = '#ffffff';
      context.fillRect(x, top + height - 5, characterWidth, 2);
    } else {
      context.fillStyle = active ? '#8a98aa' : '#c9d4e0';
    }
    context.fillText(character === ' ' ? '·' : character, x, top + height / 2 + 1);
  });
  context.globalAlpha = 1;
  // 종류 표시 점
  context.fillStyle = kindColor;
  context.beginPath();
  context.arc(left + width - 4, top + 4, 2.5, 0, Math.PI * 2);
  context.fill();
}

export class ParticleSystem {
  constructor() {
    this.particles = [];
  }

  // 원형으로 퍼지는 불꽃. 오래된 것부터 버려 최대 개수를 지킨다.
  burst(x, y, { color = '#ffb547', count = 16, speed = 160, life = 0.6, size = 3, gravity = 0 } = {}) {
    for (let index = 0; index < count; index++) {
      const angle = (Math.PI * 2 * index) / count + Math.random() * 0.5;
      const velocity = speed * (0.4 + Math.random() * 0.8);
      this.particles.push({
        x, y, vx: Math.cos(angle) * velocity, vy: Math.sin(angle) * velocity,
        life, age: 0, color, size: size * (0.6 + Math.random() * 0.8), gravity
      });
    }
    if (this.particles.length > MAX_PARTICLES) this.particles.splice(0, this.particles.length - MAX_PARTICLES);
  }

  update(frameSeconds) {
    for (const particle of this.particles) {
      particle.age += frameSeconds;
      particle.x += particle.vx * frameSeconds;
      particle.y += particle.vy * frameSeconds;
      particle.vy += particle.gravity * frameSeconds;
      particle.vx *= 0.96;
      particle.vy *= 0.96;
    }
    this.particles = this.particles.filter(particle => particle.age < particle.life);
  }

  draw(context) {
    for (const particle of this.particles) {
      const progress = particle.age / particle.life;
      context.globalAlpha = 1 - progress;
      context.fillStyle = particle.color;
      context.shadowColor = particle.color;
      context.shadowBlur = 8;
      context.beginPath();
      context.arc(particle.x, particle.y, particle.size * (1 - progress * 0.5), 0, Math.PI * 2);
      context.fill();
    }
    context.shadowBlur = 0;
    context.globalAlpha = 1;
  }
}

// 동작 줄이기 설정이면 흔들림·번쩍임을 크게 줄인다(브라우저가 아니면 그대로)
const REDUCED_MOTION = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const JUICE_LIMITS = Object.freeze({ popups: 24, rings: 16, maxShake: 14 });

// 게임 손맛(게임 주스) 효과 묶음: 트라우마 방식 화면 흔들림, 떠오르는 점수 글씨, 퍼지는 충격파 고리,
// 화면 번쩍임, 위기 때 붉은 가장자리. 시간은 실제 초(hit-stop 중에도 연출은 흘러가게)를 쓴다. 효과 수 k에 대해 O(k)
export class Juice {
  constructor() {
    this.trauma = 0;
    this.popups = [];
    this.rings = [];
    this.flashes = [];
    this.danger = 0;
    this.time = 0;
  }

  // amount(0~1)만큼 흔들림을 더한다. 흔들림 크기는 trauma²에 비례해 큰 사건만 확 흔들린다
  shake(amount) {
    this.trauma = Math.min(1, this.trauma + amount * (REDUCED_MOTION ? 0.25 : 1));
  }

  popup(x, y, text, { color = '#ffe08a', size = 18, rise = 46, life = 0.9 } = {}) {
    this.popups.push({ x, y, text, color, size, rise, life, age: 0 });
    if (this.popups.length > JUICE_LIMITS.popups) this.popups.shift();
  }

  ring(x, y, { color = '#ffffff', radius = 60, life = 0.4, width = 4 } = {}) {
    this.rings.push({ x, y, color, radius, life, width, age: 0 });
    if (this.rings.length > JUICE_LIMITS.rings) this.rings.shift();
  }

  flash(color, strength = 0.35, life = 0.25) {
    if (REDUCED_MOTION) strength *= 0.3;
    this.flashes.push({ color, strength, life, age: 0 });
  }

  // 0~1: 클수록 화면 가장자리가 붉게 맥박친다(생명이 1칸 남았을 때 등)
  setDanger(level) {
    this.danger = Math.max(0, Math.min(1, level));
  }

  step(seconds) {
    const frame = Math.max(0, Math.min(0.1, seconds || 0));
    this.time += frame;
    this.trauma = Math.max(0, this.trauma - frame * 1.6);
    const age = list => list.filter(effect => (effect.age += frame) < effect.life);
    this.popups = age(this.popups);
    this.rings = age(this.rings);
    this.flashes = age(this.flashes);
  }

  // 그리기 전에 부른다: 흔들린 만큼 옮겨 둔다. 짝이 되는 context.restore()는 endShake가 한다
  beginShake(context) {
    context.save();
    const power = this.trauma * this.trauma * JUICE_LIMITS.maxShake;
    if (power < 0.05) return;
    const wobble = seed => Math.sin(this.time * 61 + seed) * Math.cos(this.time * 37 + seed * 2.3);
    context.translate(wobble(1) * power, wobble(4) * power);
    context.rotate(wobble(7) * power * 0.002);
  }

  endShake(context) {
    context.restore();
  }

  // 흔들리지 않는 맨 위 층: 고리 → 글씨 → 번쩍임 → 위기 가장자리
  drawOverlay(context, width, height) {
    for (const ring of this.rings) {
      const progress = ring.age / ring.life;
      context.globalAlpha = 1 - progress;
      context.strokeStyle = ring.color;
      context.lineWidth = ring.width * (1 - progress) + 0.5;
      context.beginPath();
      context.arc(ring.x, ring.y, ring.radius * easeOutCubic(progress), 0, Math.PI * 2);
      context.stroke();
    }
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    for (const popup of this.popups) {
      const progress = popup.age / popup.life;
      const pop = progress < 0.15 ? easeOutBack(progress / 0.15) : 1;
      context.globalAlpha = progress < 0.7 ? 1 : 1 - (progress - 0.7) / 0.3;
      context.font = canvasFont(Math.round(popup.size * (0.6 + 0.4 * pop)), 'display', 700);
      context.lineWidth = 4;
      context.strokeStyle = 'rgba(5, 7, 15, 0.85)';
      const y = popup.y - popup.rise * easeOutCubic(progress);
      context.strokeText(popup.text, popup.x, y);
      context.fillStyle = popup.color;
      context.fillText(popup.text, popup.x, y);
    }
    for (const flash of this.flashes) {
      context.globalAlpha = flash.strength * (1 - flash.age / flash.life);
      context.fillStyle = flash.color;
      context.fillRect(0, 0, width, height);
    }
    if (this.danger > 0) {
      const pulse = 0.55 + 0.45 * Math.sin(this.time * 6);
      const edge = context.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.35, width / 2, height / 2, Math.max(width, height) * 0.75);
      edge.addColorStop(0, 'rgba(255, 40, 70, 0)');
      edge.addColorStop(1, `rgba(255, 40, 70, ${0.32 * this.danger * pulse})`);
      context.globalAlpha = 1;
      context.fillStyle = edge;
      context.fillRect(0, 0, width, height);
    }
    context.globalAlpha = 1;
  }
}

// 아이템 등급 표시(희귀 이상): 아이템 위 작은 알약 모양 글씨 + 전설은 도는 빛살. 일반은 아무것도 그리지 않는다
export function drawRarityTag(context, x, y, rarity, time = 0, { label, color, scale = 1 } = {}) {
  if (!rarity || rarity === 'common' || !label) return;
  context.save();
  context.translate(x, y);
  context.scale(scale, scale);
  if (rarity === 'legendary') {
    context.globalAlpha = 0.35;
    context.fillStyle = color;
    for (let ray = 0; ray < 8; ray++) {
      const angle = time * 0.8 + (ray * Math.PI) / 4;
      context.beginPath();
      context.moveTo(0, 22);
      context.arc(0, 22, 46, angle - 0.09, angle + 0.09);
      context.closePath();
      context.fill();
    }
    context.globalAlpha = 1;
  }
  context.font = "700 10px 'Pretendard', 'Noto Sans KR', system-ui, sans-serif";
  const width = context.measureText(label).width + 12;
  roundedRect(context, -width / 2, -8, width, 15, 7);
  context.fillStyle = 'rgba(8, 10, 20, 0.88)';
  context.fill();
  context.lineWidth = 1.5;
  context.strokeStyle = color;
  context.stroke();
  context.fillStyle = color;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(label, 0, 0.5);
  context.restore();
}

// 좌상단 HUD: 생명(♥/SLA)과 아이템 남은 시간 게이지
export function drawHud(context, { lives, maxLives, livesLabel, powerLabel, powerRemaining, powerSeconds, accent }) {
  context.font = "600 13px 'JetBrains Mono', ui-monospace, monospace";
  context.textBaseline = 'middle';
  context.fillStyle = '#8a98aa';
  context.fillText(livesLabel, 12, 16);
  const labelWidth = context.measureText(livesLabel).width;
  for (let index = 0; index < maxLives; index++) {
    context.fillStyle = index < lives ? '#ff4d6d' : '#2b3442';
    context.fillText('♥', 20 + labelWidth + index * 18, 16);
  }
  if (powerRemaining > 0) {
    const x = 20 + labelWidth + maxLives * 18 + 16;
    const width = 120;
    context.fillStyle = accent;
    context.fillText(`${powerLabel} ${powerRemaining.toFixed(1)}s`, x, 16);
    const textWidth = context.measureText(`${powerLabel} 0.0s`).width;
    context.fillStyle = '#1f2732';
    context.fillRect(x + textWidth + 8, 13, width, 6);
    context.fillStyle = accent;
    context.fillRect(x + textWidth + 8, 13, width * Math.min(1, powerRemaining / powerSeconds), 6);
  }
}

export function easeOutCubic(progress) {
  return 1 - (1 - progress) ** 3;
}

export function easeOutBack(progress) {
  const overshoot = 1.70158;
  return 1 + (overshoot + 1) * (progress - 1) ** 3 + overshoot * (progress - 1) ** 2;
}

export function easeInOutSine(progress) {
  return -(Math.cos(Math.PI * progress) - 1) / 2;
}

// 감쇠 스프링: 목표값으로 출렁이며 돌아온다. 맞았을 때 찌그러짐·넉백·라벨 튀어오름에 쓴다.
// 고정 시간 간격(1/120초)으로 적분해 프레임 속도와 무관하게 같은 움직임을 낸다.
export class Spring {
  constructor(value = 0, { stiffness = 260, damping = 16 } = {}) {
    this.value = value;
    this.target = value;
    this.velocity = 0;
    this.stiffness = stiffness;
    this.damping = damping;
  }

  kick(impulse) {
    this.velocity += impulse;
  }

  step(frameSeconds) {
    const fixedStep = 1 / 120;
    for (let remaining = Math.min(frameSeconds, 0.1); remaining > 0; remaining -= fixedStep) {
      const dt = Math.min(fixedStep, remaining);
      const force = -this.stiffness * (this.value - this.target) - this.damping * this.velocity;
      this.velocity += force * dt;
      this.value += this.velocity * dt;
    }
    return this.value;
  }
}

// 엔티티 id별 시각 상태(스프링 묶음). 화면에서 사라진 엔티티는 정리한다.
export class VisualStates {
  constructor(factory) {
    this.factory = factory;
    this.states = new Map();
  }

  get(id) {
    if (!this.states.has(id)) this.states.set(id, this.factory());
    return this.states.get(id);
  }

  step(frameSeconds, aliveIds) {
    for (const [id, state] of this.states) {
      if (!aliveIds.has(id)) {
        this.states.delete(id);
        continue;
      }
      for (const value of Object.values(state)) if (value instanceof Spring) value.step(frameSeconds);
    }
  }
}
