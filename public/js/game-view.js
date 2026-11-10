// 아케이드 캔버스 공통 도구: 고해상도(DPR) 캔버스, 토큰 라벨, 파티클, HUD(생명·아이템 게이지).
// 2D 컨텍스트가 없는 환경(테스트용 가상 DOM 등)에서는 모든 그리기가 아무 일도 하지 않는다.
import { TOKEN_KINDS } from './tokens.js';

export const LABEL_FONT = "600 14px 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace";
const MAX_PARTICLES = 400;

export function setupCanvas(canvas) {
  const context = canvas?.getContext?.('2d') ?? null;
  const surface = { canvas, context, width: 0, height: 0, ratio: 1 };
  const resize = () => {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(globalThis.devicePixelRatio || 1, 2);
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
  return surface;
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

// 목표 머리 위 토큰 라벨: 조준 중이면 테두리 강조, 글자는 맞음(종류 색)/틀림(빨강)/다음(밑줄)/대기.
export function drawTokenLabel(context, centerX, bottomY, entity, states, { active, accent, dimmed = false }) {
  const text = entity.token.text;
  const kindColor = TOKEN_KINDS[entity.token.kind]?.color ?? '#c9d4e0';
  context.font = LABEL_FONT;
  const characterWidth = context.measureText('M').width;
  const width = characterWidth * text.length + 16;
  const height = 24;
  const left = Math.round(centerX - width / 2);
  const top = Math.round(bottomY - height);

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
  [...text].forEach((character, index) => {
    const x = left + 8 + index * characterWidth;
    const state = states[index];
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
