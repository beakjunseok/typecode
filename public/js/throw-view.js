// 휴대폰 던지기(세로형). 원작 케이크 던지기의 '↓ 무대' 구도: 로봇이 낱말 발판을 타고 위에서 내려오고,
// 플레이어는 아래 가운데에서 위로 던진다. 멀리(위) 있는 로봇은 작게, 가까울수록 크게 그려 원근감을 준다.
// 엔진 좌표 x(1=출현 지점 → playerX=책상)를 화면 y로, lane을 세로 열로 바꿔 그린다.
import { ARCADE_RULES } from './target-game.js';
import { THROW_RULES } from './throw-engine.js';
import {
  setupCanvas, roundedRect, drawTokenLabel, ParticleSystem, easeOutCubic, easeOutBack, Spring, VisualStates
} from './game-view.js';

const ROBOT_STYLE = {
  basic: { name: '버그봇', body: '#2f5d72', bodyLight: '#4b8aa6', trim: '#7fdbca', eye: '#36e2ff', width: 40, height: 46, stride: 7 },
  fast: { name: '스피드봇', body: '#b14a2c', bodyLight: '#e0703f', trim: '#ffcb6b', eye: '#ffe08a', width: 32, height: 40, stride: 14 },
  tank: { name: '헤비봇', body: '#353d49', bodyLight: '#566273', trim: '#8a98aa', eye: '#ff4d6d', width: 60, height: 56, stride: 4 }
};
const ITEM_STYLE = {
  laptop: { color: '#c792ea', fill: '#2a1f3d', label: '노트북 ×3' },
  charger: { color: '#39ff88', fill: '#123321', label: 'HP +1' }
};
const HUD_HEIGHT = 34;
const PLAYER_ZONE = 104;

export class ThrowRenderer {
  constructor(canvas) {
    this.surface = setupCanvas(canvas);
    this.particles = new ParticleSystem();
    this.lastGameTime = 0;
    this.accent = '#36e2ff';
    this.lanes = THROW_RULES.lanes;
    this.visuals = new VisualStates(() => ({
      squash: new Spring(0, { stiffness: 340, damping: 14 }),
      knock: new Spring(0, { stiffness: 180, damping: 13 }),
      labelPop: new Spring(0, { stiffness: 420, damping: 18 })
    }));
    this.player = {
      arm: new Spring(0, { stiffness: 220, damping: 12 }),
      hurt: new Spring(0, { stiffness: 220, damping: 10 }),
      aimX: 0.5
    };
  }

  get context() {
    return this.surface.context;
  }

  get dangerY() {
    return this.surface.height - PLAYER_ZONE;
  }

  // 엔진의 거리(x)를 화면 높이로: 출현(위) → 위험선(아래)
  toY(distance) {
    const top = HUD_HEIGHT + 22;
    const progress = (THROW_RULES.spawnX - distance) / (THROW_RULES.spawnX - THROW_RULES.playerX);
    return top + progress * (this.dangerY - top);
  }

  depthScale(distance) {
    const progress = Math.min(1, Math.max(0, (THROW_RULES.spawnX - distance) / (THROW_RULES.spawnX - THROW_RULES.playerX)));
    const columnFit = Math.min(1, (this.surface.width / this.lanes) / 100);
    return (0.68 + 0.32 * progress) * Math.max(0.62, columnFit);
  }

  columnX(lane) {
    return (this.surface.width * (lane + 0.5)) / this.lanes;
  }

  playerPosition() {
    return { x: this.surface.width / 2, y: this.surface.height - 52 };
  }

  onEvent(type, payload) {
    if (type === 'throw') {
      this.player.arm.kick(-30);
      this.player.aimX = payload.target.lane / Math.max(1, this.lanes - 1);
    } else if (type === 'lock') {
      this.visuals.get(payload.target.id).labelPop.kick(14);
    } else if (type === 'mistake' && payload.target) {
      this.visuals.get(payload.target.id).labelPop.kick(-10);
    } else if (type === 'hit') {
      const visual = this.visuals.get(payload.robot.id);
      visual.squash.kick(payload.weapon === 'laptop' ? 14 : 9);
      visual.knock.kick(payload.weapon === 'laptop' ? -520 : -300);
    }
    if (!this.context) return;
    if (type === 'hit' || type === 'kill') {
      const robot = payload.robot;
      const style = ROBOT_STYLE[robot.type];
      const scale = this.depthScale(robot.x);
      const x = this.columnX(robot.lane);
      const y = this.toY(robot.x) - (style.height * scale) / 2;
      if (type === 'kill') {
        this.particles.burst(x, y, { color: style.bodyLight, count: 18, speed: 240, life: 0.8, size: 4, gravity: 420 });
        this.particles.burst(x, y, { color: style.eye, count: 14, speed: 160, life: 0.5, size: 2.5 });
        this.particles.burst(x, y, { color: '#ffffff', count: 8, speed: 90, life: 0.25, size: 5 });
      } else {
        this.particles.burst(x, y + 10, { color: '#ffcb6b', count: 10, speed: 150, life: 0.35, size: 2.5 });
      }
    } else if (type === 'item') {
      const item = payload.item;
      this.particles.burst(this.columnX(item.lane), this.toY(item.x) - 14, { color: ITEM_STYLE[item.item].color, count: 32, speed: 220, life: 0.8 });
    } else if (type === 'damage') {
      this.player.hurt.kick(30);
      this.particles.burst(this.columnX(payload.cause.robot.lane), this.dangerY, { color: '#ff4d6d', count: 26, speed: 200, life: 0.6, gravity: 300 });
    }
  }

  render(engine, { accent }) {
    const context = this.context;
    if (!context) return;
    this.surface.resize?.();
    this.accent = accent;
    this.lanes = engine.lanes;
    const frameSeconds = Math.min(0.1, Math.max(0, engine.gameTime - this.lastGameTime)) || (engine.status === 'running' ? 0 : 1 / 60);
    this.lastGameTime = engine.gameTime;
    this.particles.update(frameSeconds);
    this.visuals.step(frameSeconds, new Set([...engine.robots, ...engine.items].map(entity => entity.id)));
    this.player.arm.step(frameSeconds);
    this.player.hurt.step(frameSeconds);

    const { width, height } = this.surface;
    context.clearRect(0, 0, width, height);
    this.drawBackground(context, width, height, engine);
    // 먼 것(위)부터 그려 가까운 로봇이 앞을 가리게 한다
    const sorted = [...engine.robots].sort((first, second) => second.x - first.x);
    for (const item of engine.items) if (!item.consumed || engine.projectiles.some(projectile => projectile.targetId === item.id)) this.drawItem(context, item, engine);
    for (const robot of sorted) this.drawRobot(context, robot, engine);
    this.drawDangerLine(context, width, engine);
    this.drawPlayer(context, engine);
    for (const projectile of engine.projectiles) this.drawProjectile(context, projectile, engine);
    this.particles.draw(context);
    this.drawHud(context, engine);
  }

  drawBackground(context, width, height, engine) {
    const gradient = context.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, '#070a0f');
    gradient.addColorStop(0.5, '#0d141d');
    gradient.addColorStop(1, '#121b27');
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
    // 저 멀리 서버실 문: 로봇이 나오는 곳
    context.fillStyle = '#0b1118';
    context.fillRect(0, HUD_HEIGHT, width, 26);
    for (let lane = 0; lane < this.lanes; lane++) {
      const x = this.columnX(lane);
      context.fillStyle = '#05080c';
      roundedRect(context, x - 22, HUD_HEIGHT + 2, 44, 24, 3);
      context.fill();
      const on = Math.sin(engine.gameTime * 3 + lane * 1.9) > 0.2;
      context.fillStyle = on ? '#ff4d6d' : '#2b1a1f';
      context.fillRect(x - 3, HUD_HEIGHT + 5, 6, 3);
    }
    // 레인 바닥: 가운데로 모이는 원근 줄 + 아래로 흐르는 바닥 타일
    for (let lane = 0; lane <= this.lanes; lane++) {
      const bottomX = (width * lane) / this.lanes;
      const topX = width / 2 + (bottomX - width / 2) * 0.82;
      context.strokeStyle = 'rgba(54, 226, 255, 0.07)';
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(topX, HUD_HEIGHT + 26);
      context.lineTo(bottomX, this.dangerY);
      context.stroke();
    }
    const tileSpacing = 34;
    const offset = (engine.gameTime * 26) % tileSpacing;
    context.strokeStyle = 'rgba(138, 152, 170, 0.06)';
    for (let y = HUD_HEIGHT + 26 + offset; y < this.dangerY; y += tileSpacing) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }
    if (engine.laptopRemaining() > 0) {
      const pulse = 0.4 + 0.25 * Math.sin(engine.gameTime * 8);
      context.strokeStyle = `rgba(199, 146, 234, ${pulse})`;
      context.lineWidth = 3;
      context.shadowColor = '#c792ea';
      context.shadowBlur = 20;
      context.strokeRect(2, 2, width - 4, height - 4);
      context.shadowBlur = 0;
    }
  }

  // 위험선: 로봇이 넘어오면 HP −1. 가까운 로봇이 있으면 빨갛게 맥박친다.
  drawDangerLine(context, width, engine) {
    const nearest = Math.min(...engine.robots.filter(robot => robot.state === 'walking').map(robot => robot.x), 1);
    const danger = Math.max(0, 1 - (nearest - THROW_RULES.playerX) / 0.25);
    context.strokeStyle = `rgba(255, 77, 109, ${0.25 + danger * 0.55 * (0.6 + 0.4 * Math.sin(engine.gameTime * 12))})`;
    context.lineWidth = 2;
    context.setLineDash([10, 8]);
    context.beginPath();
    context.moveTo(0, this.dangerY);
    context.lineTo(width, this.dangerY);
    context.stroke();
    context.setLineDash([]);
  }

  // 아래 가운데: 책상 + 개발자(뒷모습 3/4). 던질 때 팔이 위로 휘두르고, 맞으면 몸이 흔들린다.
  drawPlayer(context, engine) {
    const { width, height } = this.surface;
    const { x, y } = this.playerPosition();
    const laptopMode = engine.laptopRemaining() > 0;
    // 책상 상판
    const deskGradient = context.createLinearGradient(0, height - 34, 0, height);
    deskGradient.addColorStop(0, '#2a3646');
    deskGradient.addColorStop(1, '#141b24');
    context.fillStyle = deskGradient;
    context.fillRect(0, height - 30, width, 30);
    context.fillStyle = 'rgba(54, 226, 255, 0.35)';
    context.fillRect(0, height - 30, width, 2);
    // 듀얼 모니터(양옆)
    for (const side of [-1, 1]) {
      const monitorX = x + side * Math.min(110, width * 0.3);
      context.fillStyle = '#0d131b';
      roundedRect(context, monitorX - 30, height - 62, 60, 36, 4);
      context.fill();
      context.fillStyle = laptopMode ? '#c792ea' : '#36e2ff';
      context.globalAlpha = 0.3 + 0.15 * Math.sin(engine.gameTime * 2 + side);
      context.fillRect(monitorX - 26, height - 58, 52, 26);
      context.globalAlpha = 1;
      context.fillStyle = 'rgba(201, 212, 224, 0.35)';
      for (let line = 0; line < 3; line++) context.fillRect(monitorX - 22, height - 54 + line * 7, 18 + ((line * 13 + Math.floor(engine.gameTime * 4)) % 22), 2);
    }
    const hurt = this.player.hurt.value;
    const idle = Math.sin(engine.gameTime * 2.4) * 1.5;
    context.save();
    context.translate(x + Math.sin(hurt) * hurt * 0.2, y + idle);
    // 의자 등받이
    context.fillStyle = '#1b2430';
    roundedRect(context, -24, -6, 48, 40, 10);
    context.fill();
    // 후드 몸통
    context.fillStyle = '#2b3a4d';
    roundedRect(context, -18, -14, 36, 34, 12);
    context.fill();
    context.fillStyle = '#36e2ff';
    context.fillRect(-1, -12, 2, 20);
    // 머리(뒤통수) + 헤드셋
    context.fillStyle = '#1b2430';
    context.beginPath();
    context.arc(0, -26, 13, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = '#36e2ff';
    context.lineWidth = 3;
    context.beginPath();
    context.arc(0, -27, 14, Math.PI * 1.05, Math.PI * 1.95);
    context.stroke();
    context.fillStyle = '#36e2ff';
    context.fillRect(-16, -30, 4, 9);
    context.fillRect(12, -30, 4, 9);
    // 던지는 팔: 목표 열 쪽으로 향하고, 던질 때 스프링으로 휘두름
    const aim = (this.player.aimX - 0.5) * 1.1;
    context.save();
    context.translate(14, -10);
    context.rotate(-Math.PI / 2 + aim + this.player.arm.value * 0.05);
    context.fillStyle = '#2b3a4d';
    roundedRect(context, 0, -4, 22, 8, 4);
    context.fill();
    if (laptopMode) this.drawLaptopShape(context, 26, 0, 0.6, Math.PI / 2);
    else this.drawPhoneShape(context, 26, 0, Math.PI / 2);
    context.restore();
    context.restore();
  }

  drawRobot(context, robot, engine) {
    const style = ROBOT_STYLE[robot.type];
    const visual = this.visuals.get(robot.id);
    const age = engine.gameTime - robot.spawnedAt;
    const sinceState = engine.gameTime - robot.stateAt;
    let scale = easeOutBack(Math.min(1, age / 0.35)) * this.depthScale(robot.x);
    let rotation = 0;
    let alpha = Math.min(1, age / 0.2);
    if (robot.state === 'dying') {
      const progress = Math.min(1, sinceState / THROW_RULES.dyingSeconds);
      scale *= progress < 0.3 ? 1 + progress : Math.max(0, 1.3 * (1 - (progress - 0.3) / 0.7));
      rotation = progress * 2.4;
      alpha = 1 - progress * 0.6;
    } else if (robot.state === 'crashed') {
      const progress = Math.min(1, sinceState / THROW_RULES.dyingSeconds);
      scale *= 1 + progress * 0.4;
      alpha = 1 - progress;
    }
    if (scale <= 0.01) return;

    const walkPhase = (engine.gameTime + robot.id * 0.37) * style.stride;
    const bob = robot.state === 'walking' ? Math.abs(Math.sin(walkPhase)) * (robot.type === 'tank' ? 1.5 : 3) : 0;
    const squash = visual.squash.value * 0.025;
    const x = this.columnX(robot.lane);
    const footY = this.toY(robot.x) + visual.knock.value * 0.05;
    const hitFlash = engine.gameTime - robot.hitAt < 0.1;
    const stunned = engine.gameTime - robot.hitAt < 0.25;

    // 낱말 발판(원작: 로봇이 단어를 타고 온다) — 로봇 발밑에 먼저 그린다
    if (robot.state === 'walking' && !robot.doomed) {
      const pop = visual.labelPop.value * 0.4;
      context.save();
      context.globalAlpha = Math.min(1, age / 0.3);
      drawTokenLabel(context, x, footY + 26 - pop, robot, engine.getCharacterStates(robot), {
        active: robot.id === engine.targetId, accent: this.accent, compact: this.surface.width < 520
      });
      context.restore();
    }
    // 그림자
    context.fillStyle = 'rgba(0, 0, 0, 0.35)';
    context.beginPath();
    context.ellipse(x, footY + 1, style.width * 0.55 * scale, 4 * scale, 0, 0, Math.PI * 2);
    context.fill();

    context.save();
    context.globalAlpha = alpha;
    context.translate(x, footY - bob * scale);
    context.rotate(rotation);
    context.scale(scale * (1 + squash), scale * (1 - squash));
    if (robot.type === 'basic') this.drawBugBot(context, style, walkPhase, engine, robot, hitFlash, stunned);
    else if (robot.type === 'fast') this.drawSpeedBot(context, style, walkPhase, engine, robot, hitFlash, stunned);
    else this.drawHeavyBot(context, style, walkPhase, engine, robot, hitFlash, stunned);
    context.restore();
  }

  drawEyes(context, positions, radius, color, { blink, stunned, angry = false }) {
    context.fillStyle = color;
    context.strokeStyle = color;
    context.shadowColor = color;
    context.shadowBlur = 10;
    for (const [eyeX, eyeY] of positions) {
      if (stunned) {
        context.lineWidth = 2;
        context.beginPath();
        context.moveTo(eyeX - radius, eyeY - radius);
        context.lineTo(eyeX + radius, eyeY + radius);
        context.moveTo(eyeX + radius, eyeY - radius);
        context.lineTo(eyeX - radius, eyeY + radius);
        context.stroke();
      } else if (blink) {
        context.fillRect(eyeX - radius, eyeY - 1, radius * 2, 2);
      } else {
        context.beginPath();
        context.arc(eyeX, eyeY + 1, radius, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = '#ffffff';
        context.beginPath();
        context.arc(eyeX - radius * 0.35, eyeY, radius * 0.35, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = color;
      }
      if (angry && !stunned) {
        context.lineWidth = 2.5;
        context.beginPath();
        context.moveTo(eyeX - radius - 3, eyeY - radius - (eyeX < 0 ? 4 : 1));
        context.lineTo(eyeX + radius + 3, eyeY - radius - (eyeX < 0 ? 1 : 4));
        context.stroke();
      }
    }
    context.shadowBlur = 0;
  }

  isBlinking(engine, robot) {
    return ((engine.gameTime + robot.id * 1.3) % 3.2) < 0.12;
  }

  // 기본 로봇 '버그봇'(정면): 모니터 머리 + 몸통 + 팔다리를 번갈아 흔들며 걷는다
  drawBugBot(context, style, phase, engine, robot, hitFlash, stunned) {
    const { width, height } = style;
    const swing = Math.sin(phase);
    context.fillStyle = '#1b2430';
    roundedRect(context, -11, -14 + Math.max(0, swing) * 3, 8, 14, 3);
    context.fill();
    roundedRect(context, 3, -14 + Math.max(0, -swing) * 3, 8, 14, 3);
    context.fill();
    const bodyGradient = context.createLinearGradient(0, -height * 0.6, 0, -12);
    bodyGradient.addColorStop(0, style.bodyLight);
    bodyGradient.addColorStop(1, style.body);
    context.fillStyle = hitFlash ? '#ffffff' : bodyGradient;
    roundedRect(context, -width / 2 + 6, -height * 0.58, width - 12, height * 0.46, 8);
    context.fill();
    context.fillStyle = Math.sin(engine.gameTime * 5 + robot.id) > 0 ? '#39ff88' : '#1b2430';
    context.beginPath();
    context.arc(0, -height * 0.36, 3.5, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = style.body;
    context.lineWidth = 6;
    context.lineCap = 'round';
    context.beginPath();
    context.moveTo(-width / 2 + 6, -height * 0.5);
    context.lineTo(-width / 2 - 2, -height * 0.3 + swing * 5);
    context.moveTo(width / 2 - 6, -height * 0.5);
    context.lineTo(width / 2 + 2, -height * 0.3 - swing * 5);
    context.stroke();
    context.fillStyle = hitFlash ? '#ffffff' : style.body;
    roundedRect(context, -width / 2, -height - 2, width, height * 0.48, 8);
    context.fill();
    context.strokeStyle = style.trim;
    context.lineWidth = 1.5;
    context.stroke();
    context.fillStyle = '#081016';
    roundedRect(context, -width / 2 + 5, -height + 3, width - 10, height * 0.48 - 10, 5);
    context.fill();
    this.drawEyes(context, [[-7, -height * 0.8], [7, -height * 0.8]], 3.5, style.eye, { blink: this.isBlinking(engine, robot), stunned });
    // 입: 픽셀 스마일 → 맞으면 찡그림
    context.fillStyle = style.eye;
    if (stunned) context.fillRect(-5, -height * 0.66, 10, 2);
    else { context.fillRect(-5, -height * 0.67, 2, 2); context.fillRect(-3, -height * 0.65, 6, 2); context.fillRect(3, -height * 0.67, 2, 2); }
    const sway = Math.sin(phase * 0.5) * 3;
    context.strokeStyle = style.trim;
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(0, -height - 2);
    context.quadraticCurveTo(sway, -height - 8, sway * 1.5, -height - 12);
    context.stroke();
    context.fillStyle = '#ff4d6d';
    context.beginPath();
    context.arc(sway * 1.5, -height - 13, 3, 0, Math.PI * 2);
    context.fill();
  }

  // 빠른 로봇 '스피드봇'(정면): 유선형 헬멧 + 외바퀴 + 뒤로 흩날리는 속도선
  drawSpeedBot(context, style, phase, engine, robot, hitFlash, stunned) {
    const { width, height } = style;
    if (robot.state === 'walking' && Math.random() < 0.4) {
      this.particles.burst(this.columnX(robot.lane) + (Math.random() - 0.5) * 12, this.toY(robot.x) - 4, { color: '#ffb547', count: 1, speed: 40, life: 0.3, size: 2, gravity: -200 });
    }
    context.strokeStyle = 'rgba(255, 203, 107, 0.45)';
    context.lineWidth = 2;
    for (let line = -1; line <= 1; line++) {
      const offset = (engine.gameTime * 140 + line * 17) % 24;
      context.beginPath();
      context.moveTo(line * 10, -height - 6 - offset * 0.3);
      context.lineTo(line * 10, -height - 18 - offset);
      context.stroke();
    }
    context.fillStyle = '#121a24';
    roundedRect(context, -6, -14, 12, 14, 6);
    context.fill();
    context.strokeStyle = '#8a98aa';
    context.lineWidth = 1.5;
    const spin = (phase * 4) % 14;
    context.beginPath();
    context.moveTo(-6, -14 + spin);
    context.lineTo(6, -14 + spin);
    context.stroke();
    const bodyGradient = context.createLinearGradient(-width / 2, 0, width / 2, 0);
    bodyGradient.addColorStop(0, style.bodyLight);
    bodyGradient.addColorStop(1, style.body);
    context.fillStyle = hitFlash ? '#ffffff' : bodyGradient;
    context.beginPath();
    context.moveTo(-width / 2, -14);
    context.quadraticCurveTo(-width / 2 - 2, -height, 0, -height - 4);
    context.quadraticCurveTo(width / 2 + 2, -height, width / 2, -14);
    context.closePath();
    context.fill();
    context.strokeStyle = style.trim;
    context.lineWidth = 1.5;
    context.stroke();
    context.fillStyle = '#0b1017';
    roundedRect(context, -width / 2 + 4, -height + 8, width - 8, 10, 5);
    context.fill();
    const scan = Math.sin(engine.gameTime * 6 + robot.id) * (width / 2 - 9);
    if (stunned) {
      this.drawEyes(context, [[0, -height + 12]], 3, style.eye, { blink: false, stunned: true });
    } else {
      context.fillStyle = style.eye;
      context.shadowColor = style.eye;
      context.shadowBlur = 12;
      roundedRect(context, scan - 5, -height + 10, 10, 6, 3);
      context.fill();
      context.shadowBlur = 0;
    }
    // 번개 마크
    context.fillStyle = style.trim;
    context.beginPath();
    context.moveTo(2, -height * 0.55);
    context.lineTo(-4, -height * 0.38);
    context.lineTo(0, -height * 0.38);
    context.lineTo(-2, -height * 0.24);
    context.lineTo(4, -height * 0.42);
    context.lineTo(0, -height * 0.42);
    context.closePath();
    context.fill();
  }

  // 피 많은 로봇 '헤비봇'(정면): 무한궤도, 어깨 장갑, 화난 눈, 체력 칸. 맞으면 전기 스파크(원작 R 로봇 오마주)
  drawHeavyBot(context, style, phase, engine, robot, hitFlash, stunned) {
    const { width, height } = style;
    context.fillStyle = '#141b24';
    roundedRect(context, -width / 2 - 2, -14, 16, 14, 4);
    context.fill();
    roundedRect(context, width / 2 - 14, -14, 16, 14, 4);
    context.fill();
    context.fillStyle = '#4b5767';
    const treadShift = (phase * 3) % 6;
    for (let mark = -14; mark < 0; mark += 6) {
      context.fillRect(-width / 2, mark + treadShift, 12, 2);
      context.fillRect(width / 2 - 12, mark + treadShift, 12, 2);
    }
    const damaged = robot.hp < robot.maxHp;
    const bodyGradient = context.createLinearGradient(-width / 2, -height, width / 2, 0);
    bodyGradient.addColorStop(0, damaged ? '#7a5a3a' : style.bodyLight);
    bodyGradient.addColorStop(1, damaged ? '#4a3524' : style.body);
    context.fillStyle = hitFlash ? '#ffffff' : bodyGradient;
    roundedRect(context, -width / 2, -height, width, height - 12, 10);
    context.fill();
    context.strokeStyle = style.trim;
    context.lineWidth = 2;
    context.stroke();
    context.fillStyle = hitFlash ? '#ffffff' : '#2a313b';
    roundedRect(context, -width / 2 - 8, -height + 8, 12, 22, 4);
    context.fill();
    roundedRect(context, width / 2 - 4, -height + 8, 12, 22, 4);
    context.fill();
    context.fillStyle = '#0b1017';
    roundedRect(context, -width / 2 + 9, -height + 8, width - 18, 17, 5);
    context.fill();
    this.drawEyes(context, [[-10, -height + 16], [10, -height + 16]], 3.5, style.eye, { blink: this.isBlinking(engine, robot), stunned, angry: true });
    context.fillStyle = 'rgba(201, 212, 224, 0.35)';
    for (const [rivetX, rivetY] of [[-width / 2 + 6, -height + 32], [width / 2 - 6, -height + 32], [-width / 2 + 6, -20], [width / 2 - 6, -20]]) {
      context.beginPath();
      context.arc(rivetX, rivetY, 2, 0, Math.PI * 2);
      context.fill();
    }
    context.fillStyle = 'rgba(138, 152, 170, 0.3)';
    context.fillRect(-width / 2 + 12, -height + 33, width - 24, 3);
    context.fillRect(-width / 2 + 12, -height + 39, width - 24, 3);
    // 손상되면 전기 스파크
    if (damaged && Math.sin(engine.gameTime * 23 + robot.id) > 0.55) {
      context.strokeStyle = '#ffe08a';
      context.lineWidth = 1.5;
      context.beginPath();
      context.moveTo(-width / 2 + 4, -height + 30);
      context.lineTo(-width / 2 - 4, -height + 24);
      context.lineTo(-width / 2 + 2, -height + 20);
      context.lineTo(-width / 2 - 6, -height + 12);
      context.stroke();
    }
    const pipWidth = (width - 6) / robot.maxHp;
    for (let pip = 0; pip < robot.maxHp; pip++) {
      context.fillStyle = pip < robot.hp ? '#ff4d6d' : '#2b3442';
      roundedRect(context, -width / 2 + 3 + pip * pipWidth, -height - 9, pipWidth - 3, 5, 2);
      context.fill();
    }
  }

  drawItem(context, item, engine) {
    const style = ITEM_STYLE[item.item];
    const x = this.columnX(item.lane);
    const y = this.toY(item.x) - 18 + Math.sin(engine.gameTime * 3.5 + item.id) * 4;
    const scale = this.depthScale(item.x);
    context.save();
    context.translate(x, y);
    context.scale(scale, scale);
    context.rotate(Math.sin(engine.gameTime * 2 + item.id) * 0.1);
    // 작은 프로펠러 드론이 상자를 들고 내려온다
    const spin = Math.sin(engine.gameTime * 40) * 10;
    context.strokeStyle = '#8a98aa';
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(-14 - spin, -26);
    context.lineTo(-14 + spin, -26);
    context.moveTo(14 - spin, -26);
    context.lineTo(14 + spin, -26);
    context.moveTo(-14, -26);
    context.lineTo(-8, -16);
    context.moveTo(14, -26);
    context.lineTo(8, -16);
    context.stroke();
    context.shadowColor = style.color;
    context.shadowBlur = 14 + Math.sin(engine.gameTime * 6) * 6;
    context.fillStyle = style.fill;
    roundedRect(context, -20, -16, 40, 28, 6);
    context.fill();
    context.strokeStyle = style.color;
    context.lineWidth = 2;
    context.stroke();
    context.shadowBlur = 0;
    if (item.item === 'charger') this.drawChargerShape(context, 0, -2);
    else this.drawLaptopShape(context, 0, -3, 1, 0);
    context.restore();
    if (!item.consumed) {
      drawTokenLabel(context, x, y + 32 * scale, item, engine.getCharacterStates(item), {
        active: item.id === engine.targetId, accent: style.color, compact: this.surface.width < 520
      });
    }
  }

  drawChargerShape(context, x, y) {
    context.fillStyle = '#c9d4e0';
    roundedRect(context, x - 8, y - 8, 16, 12, 3);
    context.fill();
    context.fillRect(x - 5, y - 13, 2, 5);
    context.fillRect(x + 3, y - 13, 2, 5);
    context.strokeStyle = '#39ff88';
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(x, y + 4);
    context.quadraticCurveTo(x + 4, y + 10, x + 12, y + 8);
    context.stroke();
    context.fillStyle = '#123321';
    context.beginPath();
    context.moveTo(x + 1, y - 6);
    context.lineTo(x - 3, y - 1);
    context.lineTo(x, y - 1);
    context.lineTo(x - 1, y + 3);
    context.lineTo(x + 3, y - 2);
    context.lineTo(x, y - 2);
    context.closePath();
    context.fill();
  }

  drawLaptopShape(context, x, y, scale, angle) {
    context.save();
    context.translate(x, y);
    context.rotate(angle);
    context.scale(scale, scale);
    context.fillStyle = '#8a98aa';
    roundedRect(context, -11, -9, 22, 13, 2);
    context.fill();
    context.fillStyle = '#c792ea';
    context.fillRect(-9, -7, 18, 9);
    context.fillStyle = '#c9d4e0';
    roundedRect(context, -13, 4, 26, 4, 2);
    context.fill();
    context.restore();
  }

  drawPhoneShape(context, x, y, angle) {
    context.save();
    context.translate(x, y);
    context.rotate(angle);
    context.fillStyle = '#0f141b';
    roundedRect(context, -6, -10, 12, 20, 3);
    context.fill();
    context.strokeStyle = '#8a98aa';
    context.lineWidth = 1;
    context.stroke();
    context.fillStyle = '#36e2ff';
    context.fillRect(-4.5, -8, 9, 14);
    context.restore();
  }

  // 아래 가운데에서 목표까지 포물선(위로 솟았다 떨어짐) + 회전 + 잔상
  drawProjectile(context, projectile, engine) {
    const target = engine.findEntity(projectile.targetId);
    if (!target) return;
    const raw = Math.min(1, (engine.gameTime - projectile.launchedAt) / ARCADE_RULES.projectileSeconds);
    const start = this.playerPosition();
    const endX = this.columnX(target.lane);
    const endY = this.toY(target.x) - (target.kind === 'item' ? 18 : 30 * this.depthScale(target.x));
    const pointAt = progress => {
      const eased = easeOutCubic(progress);
      return {
        x: start.x + (endX - start.x) * eased + Math.sin(eased * Math.PI) * (endX > start.x ? 24 : -24),
        y: start.y - 30 + (endY - start.y + 30) * eased
      };
    };
    for (let trail = 3; trail >= 1; trail--) {
      const point = pointAt(Math.max(0, raw - trail * 0.06));
      context.globalAlpha = 0.12 * (4 - trail);
      context.fillStyle = projectile.weapon === 'laptop' ? '#c792ea' : '#36e2ff';
      context.beginPath();
      context.arc(point.x, point.y, 5 - trail, 0, Math.PI * 2);
      context.fill();
    }
    context.globalAlpha = 1;
    const { x, y } = pointAt(raw);
    const angle = raw * Math.PI * (projectile.weapon === 'laptop' ? 3 : 5);
    if (projectile.weapon === 'laptop') this.drawLaptopShape(context, x, y, 1.15, angle);
    else this.drawPhoneShape(context, x, y, angle);
  }

  // 원작처럼 왼쪽 위 하트, 오른쪽 위 현재 무기
  drawHud(context, engine) {
    const { width } = this.surface;
    context.fillStyle = 'rgba(7, 10, 15, 0.85)';
    context.fillRect(0, 0, width, HUD_HEIGHT);
    context.font = "700 18px 'JetBrains Mono', ui-monospace, monospace";
    context.textBaseline = 'middle';
    for (let index = 0; index < ARCADE_RULES.startLives; index++) {
      context.fillStyle = index < engine.lives ? '#ff4d6d' : '#2b3442';
      context.fillText('♥', 10 + index * 22, HUD_HEIGHT / 2 + 1);
    }
    const laptop = engine.laptopRemaining();
    context.textAlign = 'right';
    context.font = "600 12px 'JetBrains Mono', ui-monospace, monospace";
    if (laptop > 0) {
      context.fillStyle = '#c792ea';
      context.fillText(`💻 노트북 ×3 · ${laptop.toFixed(1)}s`, width - 10, HUD_HEIGHT / 2);
      context.fillRect(width - 130, HUD_HEIGHT - 5, 120 * (laptop / THROW_RULES.laptopSeconds), 3);
    } else {
      context.fillStyle = '#8a98aa';
      context.fillText('📱 휴대폰', width - 10, HUD_HEIGHT / 2);
    }
    context.textAlign = 'start';
  }
}
