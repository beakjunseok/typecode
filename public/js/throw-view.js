// 휴대폰 던지기 화면. 캐릭터는 모두 코드로 그린다(외부 이미지 없음).
// 움직임 원칙: 등장은 easeOutBack으로 튀어 들어오고, 피격은 스프링(찌그러짐·넉백)으로 출렁이며,
// 처치는 부풀었다 회전하며 사라진다. 모든 애니메이션은 게임 시간 기준이라 일시정지·탭 전환에도 일관된다.
import { ARCADE_RULES } from './target-game.js';
import { THROW_RULES } from './throw-engine.js';
import {
  setupCanvas, roundedRect, drawTokenLabel, ParticleSystem, drawHud, easeOutCubic, easeOutBack, Spring, VisualStates
} from './game-view.js';

const ROBOT_STYLE = {
  basic: { name: '버그봇', body: '#2f5d72', bodyLight: '#4b8aa6', trim: '#7fdbca', eye: '#36e2ff', width: 36, height: 44, stride: 7 },
  fast: { name: '스피드봇', body: '#b14a2c', bodyLight: '#e0703f', trim: '#ffcb6b', eye: '#ffe08a', width: 30, height: 38, stride: 14 },
  tank: { name: '헤비봇', body: '#353d49', bodyLight: '#566273', trim: '#8a98aa', eye: '#ff4d6d', width: 58, height: 56, stride: 4 }
};
const ITEM_STYLE = {
  laptop: { color: '#c792ea', fill: '#2a1f3d' },
  battery: { color: '#39ff88', fill: '#123321' }
};

export class ThrowRenderer {
  constructor(canvas) {
    this.surface = setupCanvas(canvas);
    this.particles = new ParticleSystem();
    this.lastGameTime = 0;
    this.accent = '#36e2ff';
    this.visuals = new VisualStates(() => ({
      squash: new Spring(0, { stiffness: 340, damping: 14 }),
      knock: new Spring(0, { stiffness: 180, damping: 13 }),
      labelPop: new Spring(0, { stiffness: 420, damping: 18 })
    }));
    this.player = {
      arm: new Spring(0, { stiffness: 200, damping: 12 }),
      recoil: new Spring(0, { stiffness: 260, damping: 14 }),
      hurt: new Spring(0, { stiffness: 220, damping: 10 }),
      throwLane: 1
    };
  }

  get context() {
    return this.surface.context;
  }

  laneY(lane) {
    const top = 64;
    const laneHeight = (this.surface.height - top - 16) / THROW_RULES.lanes;
    return top + laneHeight * (lane + 0.78);
  }

  toX(x) {
    return x * this.surface.width;
  }

  // 엔진 이벤트 → 스프링 충격·파티클
  onEvent(type, payload) {
    if (type === 'throw') {
      this.player.arm.kick(-26);
      this.player.recoil.kick(-60);
      this.player.throwLane = payload.target.lane;
    } else if (type === 'lock') {
      this.visuals.get(payload.target.id).labelPop.kick(14);
    } else if (type === 'mistake' && payload.target) {
      this.visuals.get(payload.target.id).labelPop.kick(-10);
    } else if (type === 'hit') {
      const visual = this.visuals.get(payload.robot.id);
      visual.squash.kick(payload.weapon === 'laptop' ? 14 : 9);
      visual.knock.kick(payload.weapon === 'laptop' ? 520 : 300);
    }
    if (!this.context) return;
    if (type === 'hit' || type === 'kill') {
      const robot = payload.robot;
      const style = ROBOT_STYLE[robot.type];
      const x = this.toX(robot.x);
      const y = this.laneY(robot.lane) - style.height / 2;
      if (type === 'kill') {
        this.particles.burst(x, y, { color: style.bodyLight, count: 18, speed: 240, life: 0.8, size: 4, gravity: 420 });
        this.particles.burst(x, y, { color: style.eye, count: 14, speed: 160, life: 0.5, size: 2.5 });
        this.particles.burst(x, y, { color: '#ffffff', count: 8, speed: 90, life: 0.25, size: 5 });
      } else {
        this.particles.burst(x - 6, y, { color: '#ffcb6b', count: 10, speed: 150, life: 0.35, size: 2.5 });
      }
    } else if (type === 'item') {
      const item = payload.item;
      this.particles.burst(this.toX(item.x), this.laneY(item.lane) - 16, { color: ITEM_STYLE[item.item].color, count: 32, speed: 220, life: 0.8 });
    } else if (type === 'damage') {
      this.player.hurt.kick(30);
      this.particles.burst(this.toX(THROW_RULES.playerX), this.laneY(payload.cause.robot.lane) - 24, { color: '#ff4d6d', count: 26, speed: 200, life: 0.6, gravity: 300 });
    }
  }

  render(engine, { accent }) {
    const context = this.context;
    if (!context) return;
    this.surface.resize?.();
    this.accent = accent;
    const frameSeconds = Math.min(0.1, Math.max(0, engine.gameTime - this.lastGameTime)) || (engine.status === 'running' ? 0 : 1 / 60);
    this.lastGameTime = engine.gameTime;
    this.particles.update(frameSeconds);
    this.visuals.step(frameSeconds, new Set([...engine.robots, ...engine.items].map(entity => entity.id)));
    for (const spring of [this.player.arm, this.player.recoil, this.player.hurt]) spring.step(frameSeconds);

    const { width, height } = this.surface;
    context.clearRect(0, 0, width, height);
    this.drawBackground(context, width, height, engine);
    const sorted = [...engine.robots].sort((first, second) => first.lane - second.lane || second.x - first.x);
    for (const robot of sorted) this.drawShadow(context, robot);
    for (const item of engine.items) if (!item.consumed || engine.projectiles.some(projectile => projectile.targetId === item.id)) this.drawItem(context, item, engine);
    for (const robot of sorted) this.drawRobot(context, robot, engine);
    this.drawPlayer(context, engine);
    for (const projectile of engine.projectiles) this.drawProjectile(context, projectile, engine);
    this.drawLabels(context, engine);
    this.particles.draw(context);
    drawHud(context, {
      lives: engine.lives, maxLives: ARCADE_RULES.startLives, livesLabel: 'HP',
      powerLabel: '💻 노트북 ×3', powerRemaining: engine.laptopRemaining(), powerSeconds: THROW_RULES.laptopSeconds, accent: '#c792ea'
    });
    if (engine.status === 'ready') this.drawCenterText(context, '첫 글자를 치면 시작 · 로봇 머리 위 토큰을 다 치면 휴대폰 발사');
  }

  drawBackground(context, width, height, engine) {
    const gradient = context.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, '#0b1017');
    gradient.addColorStop(1, '#101824');
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
    // 서버실 랙 실루엣 + 깜빡이는 LED
    for (let rack = 0; rack < 9; rack++) {
      const x = width * 0.18 + rack * (width * 0.095);
      context.fillStyle = '#0e151e';
      context.fillRect(x, 26, width * 0.07, 28);
      for (let led = 0; led < 4; led++) {
        const on = Math.sin(engine.gameTime * (2 + led) + rack * 1.7) > 0.3;
        context.fillStyle = on ? (led === 3 ? '#ff4d6d' : '#39ff88') : '#1b2430';
        context.fillRect(x + 6 + led * 8, 34, 4, 3);
      }
    }
    // 레인 바닥: 원근감 있는 타일 줄무늬가 왼쪽으로 흐른다
    for (let lane = 0; lane < THROW_RULES.lanes; lane++) {
      const y = this.laneY(lane);
      context.fillStyle = lane % 2 ? 'rgba(54, 226, 255, 0.025)' : 'rgba(54, 226, 255, 0.04)';
      context.fillRect(this.toX(THROW_RULES.playerX), y - 30, width, 36);
      context.strokeStyle = 'rgba(138, 152, 170, 0.14)';
      context.setLineDash([6, 12]);
      context.lineDashOffset = engine.gameTime * 30;
      context.beginPath();
      context.moveTo(this.toX(THROW_RULES.playerX) + 18, y + 6);
      context.lineTo(width, y + 6);
      context.stroke();
    }
    context.setLineDash([]);
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

  drawShadow(context, robot) {
    if (robot.state === 'crashed') return;
    const style = ROBOT_STYLE[robot.type];
    context.fillStyle = 'rgba(0, 0, 0, 0.35)';
    context.beginPath();
    context.ellipse(this.toX(robot.x), this.laneY(robot.lane) + 2, style.width * 0.6, 5, 0, 0, Math.PI * 2);
    context.fill();
  }

  // 개발자: 후드티, 바리케이드 책상 뒤. 던질 때 팔이 스프링으로 휘두르고, 맞으면 몸이 흔들린다.
  drawPlayer(context, engine) {
    const deskX = this.toX(THROW_RULES.playerX);
    const top = this.laneY(0) - 58;
    const bottom = this.laneY(THROW_RULES.lanes - 1) + 10;
    const laptopMode = engine.laptopRemaining() > 0;
    // 책상(바리케이드)
    const deskGradient = context.createLinearGradient(deskX - 16, 0, deskX + 6, 0);
    deskGradient.addColorStop(0, '#1b2430');
    deskGradient.addColorStop(1, '#2a3646');
    context.fillStyle = deskGradient;
    roundedRect(context, deskX - 16, top, 22, bottom - top, 5);
    context.fill();
    context.fillStyle = 'rgba(54, 226, 255, 0.35)';
    context.fillRect(deskX + 3, top + 6, 2, bottom - top - 12);
    // 레인마다 모니터
    for (let lane = 0; lane < THROW_RULES.lanes; lane++) {
      const y = this.laneY(lane);
      context.fillStyle = '#0d131b';
      roundedRect(context, deskX - 50, y - 36, 32, 24, 3);
      context.fill();
      context.fillStyle = laptopMode ? '#c792ea' : '#36e2ff';
      context.globalAlpha = 0.35 + 0.2 * Math.sin(engine.gameTime * 2.4 + lane * 1.3);
      context.fillRect(deskX - 47, y - 33, 26, 16);
      context.globalAlpha = 1;
      context.fillStyle = '#1b2430';
      context.fillRect(deskX - 36, y - 12, 4, 6);
    }
    // 개발자 본체: 던지는 레인 쪽으로 살짝 몸을 기울인다
    const laneCenter = this.laneY(this.player.throwLane) - 30;
    const baseY = (this.laneY(1) + this.laneY(2)) / 2 - 14;
    const leanY = baseY + (laneCenter - baseY) * 0.25;
    const idle = Math.sin(engine.gameTime * 2.2) * 1.5;
    const hurt = this.player.hurt.value;
    context.save();
    context.translate(deskX - 32 + this.player.recoil.value * 0.05 + Math.sin(hurt) * hurt * 0.15, leanY + idle);
    // 후드 몸통
    context.fillStyle = '#2b3a4d';
    roundedRect(context, -13, -4, 26, 30, 9);
    context.fill();
    context.fillStyle = '#36e2ff';
    context.fillRect(-2, 4, 4, 10);
    // 머리 + 헤드셋
    context.fillStyle = '#e8d5c4';
    context.beginPath();
    context.arc(0, -14, 10, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#1b2430';
    context.beginPath();
    context.arc(0, -16, 11, Math.PI, 0);
    context.fill();
    context.strokeStyle = '#36e2ff';
    context.lineWidth = 2;
    context.beginPath();
    context.arc(0, -14, 12, Math.PI * 1.1, Math.PI * 1.9);
    context.stroke();
    // 눈: 맞은 직후엔 질끈
    context.fillStyle = '#0b1017';
    if (Math.abs(hurt) > 4) {
      context.fillRect(-5, -13, 4, 1.5);
      context.fillRect(2, -13, 4, 1.5);
    } else {
      context.fillRect(-4, -14, 2, 3);
      context.fillRect(3, -14, 2, 3);
    }
    // 던지는 팔
    const armAngle = -0.6 + this.player.arm.value * 0.08;
    context.save();
    context.translate(9, 2);
    context.rotate(armAngle);
    context.fillStyle = '#2b3a4d';
    roundedRect(context, 0, -3, 18, 7, 3);
    context.fill();
    if (laptopMode) this.drawLaptopShape(context, 20, 0, 0.6, 0.2);
    else this.drawPhoneShape(context, 20, 0, 0.3);
    context.restore();
    context.restore();
  }

  drawRobot(context, robot, engine) {
    const style = ROBOT_STYLE[robot.type];
    const visual = this.visuals.get(robot.id);
    const age = engine.gameTime - robot.spawnedAt;
    const sinceState = engine.gameTime - robot.stateAt;
    let scale = easeOutBack(Math.min(1, age / 0.35));
    let rotation = 0;
    let alpha = Math.min(1, age / 0.2);
    if (robot.state === 'dying') {
      const progress = Math.min(1, sinceState / THROW_RULES.dyingSeconds);
      scale = progress < 0.3 ? 1 + progress : Math.max(0, 1.3 * (1 - (progress - 0.3) / 0.7));
      rotation = progress * 2.4;
      alpha = 1 - progress * 0.6;
    } else if (robot.state === 'crashed') {
      const progress = Math.min(1, sinceState / THROW_RULES.dyingSeconds);
      scale = 1 - progress;
      alpha = 1 - progress;
    }
    if (scale <= 0.01) return;

    const walkPhase = (engine.gameTime + robot.id * 0.37) * style.stride;
    const bob = robot.state === 'walking' ? Math.abs(Math.sin(walkPhase)) * (robot.type === 'tank' ? 1.5 : 3) : 0;
    const squash = visual.squash.value * 0.025;
    const x = this.toX(robot.x) + visual.knock.value * 0.06;
    const y = this.laneY(robot.lane) - bob;
    const hitFlash = engine.gameTime - robot.hitAt < 0.1;
    const stunned = engine.gameTime - robot.hitAt < 0.25;

    context.save();
    context.globalAlpha = alpha;
    context.translate(x, y);
    context.rotate(rotation + (robot.type === 'fast' ? -0.12 : 0));
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
        context.arc(eyeX - 1, eyeY, radius, 0, Math.PI * 2);
        context.fill();
      }
      if (angry && !stunned) {
        context.lineWidth = 2;
        context.beginPath();
        context.moveTo(eyeX - radius - 2, eyeY - radius - (eyeX < 0 ? 3 : 1));
        context.lineTo(eyeX + radius + 2, eyeY - radius - (eyeX < 0 ? 1 : 3));
        context.stroke();
      }
    }
    context.shadowBlur = 0;
  }

  isBlinking(engine, robot) {
    return ((engine.gameTime + robot.id * 1.3) % 3.2) < 0.12;
  }

  // 기본 로봇 '버그봇': 모니터 머리, 팔다리를 번갈아 흔들며 걷는다
  drawBugBot(context, style, phase, engine, robot, hitFlash, stunned) {
    const { width, height } = style;
    const swing = Math.sin(phase) * 0.5;
    context.fillStyle = '#1b2430';
    for (const [legX, direction] of [[-7, 1], [7, -1]]) {
      context.save();
      context.translate(legX, -12);
      context.rotate(swing * direction);
      roundedRect(context, -3, 0, 6, 12, 3);
      context.fill();
      context.restore();
    }
    const bodyGradient = context.createLinearGradient(-width / 2, 0, width / 2, 0);
    bodyGradient.addColorStop(0, style.bodyLight);
    bodyGradient.addColorStop(1, style.body);
    context.fillStyle = hitFlash ? '#ffffff' : bodyGradient;
    roundedRect(context, -width / 2 + 4, -height * 0.55, width - 8, height * 0.45, 7);
    context.fill();
    context.fillStyle = Math.sin(engine.gameTime * 5 + robot.id) > 0 ? '#39ff88' : '#1b2430';
    context.beginPath();
    context.arc(0, -height * 0.33, 3, 0, Math.PI * 2);
    context.fill();
    // 팔
    context.strokeStyle = style.body;
    context.lineWidth = 5;
    context.lineCap = 'round';
    for (const [armX, direction] of [[-width / 2 + 4, -1], [width / 2 - 4, 1]]) {
      context.beginPath();
      context.moveTo(armX, -height * 0.48);
      context.lineTo(armX + direction * 7, -height * 0.3 - swing * direction * 6);
      context.stroke();
    }
    // 모니터 머리
    context.fillStyle = hitFlash ? '#ffffff' : style.body;
    roundedRect(context, -width / 2, -height, width, height * 0.46, 7);
    context.fill();
    context.strokeStyle = style.trim;
    context.lineWidth = 1.5;
    context.stroke();
    context.fillStyle = '#081016';
    roundedRect(context, -width / 2 + 4, -height + 4, width - 8, height * 0.46 - 8, 4);
    context.fill();
    this.drawEyes(context, [[-6, -height * 0.78], [6, -height * 0.78]], 3, style.eye, { blink: this.isBlinking(engine, robot), stunned });
    // 안테나(스프링처럼 흔들림)
    const antennaSway = Math.sin(phase * 0.5) * 3;
    context.strokeStyle = style.trim;
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(0, -height);
    context.quadraticCurveTo(antennaSway, -height - 6, antennaSway * 1.5, -height - 10);
    context.stroke();
    context.fillStyle = '#ff4d6d';
    context.beginPath();
    context.arc(antennaSway * 1.5, -height - 11, 2.5, 0, Math.PI * 2);
    context.fill();
  }

  // 빠른 로봇 '스피드봇': 앞으로 기운 유선형 몸체, 회전하는 바퀴, 배기 불꽃
  drawSpeedBot(context, style, phase, engine, robot, hitFlash, stunned) {
    const { width, height } = style;
    if (robot.state === 'walking' && Math.random() < 0.5) {
      this.particles.burst(this.toX(robot.x) + width / 2 + 4, this.laneY(robot.lane) - 10, { color: '#ffb547', count: 1, speed: 60, life: 0.3, size: 2 });
    }
    // 속도선
    context.strokeStyle = 'rgba(255, 203, 107, 0.45)';
    context.lineWidth = 2;
    for (let line = 0; line < 3; line++) {
      const offset = ((engine.gameTime * 120 + line * 13) % 26);
      context.beginPath();
      context.moveTo(width / 2 + 4 + offset * 0.3, -height * (0.35 + line * 0.18));
      context.lineTo(width / 2 + 18 + offset, -height * (0.35 + line * 0.18));
      context.stroke();
    }
    // 바퀴
    context.fillStyle = '#121a24';
    context.beginPath();
    context.arc(0, -7, 7, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = '#8a98aa';
    context.lineWidth = 1.5;
    for (let spoke = 0; spoke < 3; spoke++) {
      const angle = -phase * 0.8 + (spoke * Math.PI * 2) / 3;
      context.beginPath();
      context.moveTo(0, -7);
      context.lineTo(Math.cos(angle) * 6, -7 + Math.sin(angle) * 6);
      context.stroke();
    }
    // 유선형 몸체
    const bodyGradient = context.createLinearGradient(0, -height, 0, -12);
    bodyGradient.addColorStop(0, style.bodyLight);
    bodyGradient.addColorStop(1, style.body);
    context.fillStyle = hitFlash ? '#ffffff' : bodyGradient;
    context.beginPath();
    context.moveTo(-width / 2, -14);
    context.quadraticCurveTo(-width / 2 - 4, -height, 2, -height);
    context.quadraticCurveTo(width / 2 + 6, -height + 4, width / 2, -14);
    context.closePath();
    context.fill();
    context.strokeStyle = style.trim;
    context.lineWidth = 1.5;
    context.stroke();
    // 바이저: 좌우로 훑는 단일 눈
    context.fillStyle = '#0b1017';
    roundedRect(context, -width / 2 + 3, -height + 9, width - 6, 9, 4);
    context.fill();
    const scan = Math.sin(engine.gameTime * 6 + robot.id) * (width / 2 - 8);
    if (stunned) {
      this.drawEyes(context, [[scan - 4, -height + 13.5]], 3, style.eye, { blink: false, stunned: true });
    } else {
      context.fillStyle = style.eye;
      context.shadowColor = style.eye;
      context.shadowBlur = 12;
      roundedRect(context, scan - 6, -height + 11, 10, 5, 2.5);
      context.fill();
      context.shadowBlur = 0;
    }
  }

  // 피 많은 로봇 '헤비봇': 궤도, 리벳 박힌 장갑, 화난 눈썹, 체력 칸
  drawHeavyBot(context, style, phase, engine, robot, hitFlash, stunned) {
    const { width, height } = style;
    // 궤도 + 흐르는 무늬
    context.fillStyle = '#141b24';
    roundedRect(context, -width / 2 - 3, -13, width + 6, 14, 7);
    context.fill();
    context.fillStyle = '#4b5767';
    const treadShift = (phase * 3) % 8;
    for (let mark = -width / 2; mark < width / 2; mark += 8) {
      context.fillRect(mark + treadShift - 4, -12, 3, 12);
    }
    // 몸통
    const bodyGradient = context.createLinearGradient(-width / 2, -height, width / 2, 0);
    bodyGradient.addColorStop(0, style.bodyLight);
    bodyGradient.addColorStop(1, style.body);
    context.fillStyle = hitFlash ? '#ffffff' : bodyGradient;
    roundedRect(context, -width / 2, -height, width, height - 12, 9);
    context.fill();
    context.strokeStyle = style.trim;
    context.lineWidth = 2;
    context.stroke();
    // 어깨 장갑판
    context.fillStyle = hitFlash ? '#ffffff' : '#2a313b';
    roundedRect(context, -width / 2 - 6, -height + 10, 10, 20, 4);
    context.fill();
    roundedRect(context, width / 2 - 4, -height + 10, 10, 20, 4);
    context.fill();
    // 얼굴창 + 화난 눈
    context.fillStyle = '#0b1017';
    roundedRect(context, -width / 2 + 8, -height + 8, width - 16, 16, 5);
    context.fill();
    this.drawEyes(context, [[-9, -height + 16], [9, -height + 16]], 3.2, style.eye, { blink: this.isBlinking(engine, robot), stunned, angry: true });
    // 리벳 + 장갑 줄
    context.fillStyle = 'rgba(201, 212, 224, 0.35)';
    for (const [rivetX, rivetY] of [[-width / 2 + 6, -height + 30], [width / 2 - 6, -height + 30], [-width / 2 + 6, -20], [width / 2 - 6, -20]]) {
      context.beginPath();
      context.arc(rivetX, rivetY, 1.8, 0, Math.PI * 2);
      context.fill();
    }
    context.fillStyle = 'rgba(138, 152, 170, 0.3)';
    context.fillRect(-width / 2 + 10, -height + 32, width - 20, 3);
    context.fillRect(-width / 2 + 10, -height + 38, width - 20, 3);
    // 체력 칸
    const pipWidth = (width - 6) / robot.maxHp;
    for (let pip = 0; pip < robot.maxHp; pip++) {
      context.fillStyle = pip < robot.hp ? '#ff4d6d' : '#2b3442';
      roundedRect(context, -width / 2 + 3 + pip * pipWidth, -height - 8, pipWidth - 3, 4, 2);
      context.fill();
    }
  }

  drawItem(context, item, engine) {
    const style = ITEM_STYLE[item.item];
    const x = this.toX(item.x);
    const float = Math.sin(engine.gameTime * 3.5 + item.id) * 4;
    const y = this.laneY(item.lane) - 14 + float;
    context.save();
    context.translate(x, y);
    context.rotate(Math.sin(engine.gameTime * 2 + item.id) * 0.08);
    context.shadowColor = style.color;
    context.shadowBlur = 14 + Math.sin(engine.gameTime * 6) * 6;
    context.fillStyle = style.fill;
    roundedRect(context, -19, -16, 38, 28, 6);
    context.fill();
    context.strokeStyle = style.color;
    context.lineWidth = 2;
    context.stroke();
    context.shadowBlur = 0;
    if (item.item === 'battery') this.drawBatteryShape(context, 0, -2);
    else this.drawLaptopShape(context, 0, -3, 1, 0);
    context.restore();
  }

  drawBatteryShape(context, x, y) {
    context.fillStyle = '#c9d4e0';
    roundedRect(context, x - 11, y - 6, 20, 12, 2);
    context.fill();
    context.fillRect(x + 9, y - 3, 3, 6);
    context.fillStyle = '#39ff88';
    context.fillRect(x - 9, y - 4, 16, 8);
    context.fillStyle = '#123321';
    context.beginPath();
    context.moveTo(x - 1, y - 4);
    context.lineTo(x - 4, y + 1);
    context.lineTo(x, y + 1);
    context.lineTo(x - 2, y + 4);
    context.lineTo(x + 3, y - 1);
    context.lineTo(x - 1, y - 1);
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
    roundedRect(context, -5, -9, 10, 18, 3);
    context.fill();
    context.strokeStyle = '#8a98aa';
    context.lineWidth = 1;
    context.stroke();
    context.fillStyle = '#36e2ff';
    context.fillRect(-3.5, -7, 7, 12);
    context.restore();
  }

  // 손에서 목표까지 포물선, 회전, 잔상
  drawProjectile(context, projectile, engine) {
    const target = engine.findEntity(projectile.targetId);
    if (!target) return;
    const raw = Math.min(1, (engine.gameTime - projectile.launchedAt) / ARCADE_RULES.projectileSeconds);
    const pointAt = progress => {
      const eased = easeOutCubic(progress);
      const startX = this.toX(THROW_RULES.playerX) - 6;
      const startY = this.laneY(target.lane) - 40;
      const endX = this.toX(target.x);
      const endY = this.laneY(target.lane) - (target.kind === 'item' ? 14 : 30);
      return {
        x: startX + (endX - startX) * eased,
        y: startY + (endY - startY) * eased - Math.sin(eased * Math.PI) * 46
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

  drawLabels(context, engine) {
    const entities = [...engine.robots.filter(robot => robot.state === 'walking' && !robot.doomed), ...engine.items.filter(item => !item.consumed)];
    for (const entity of entities) {
      const isRobot = entity.kind === 'robot';
      const visual = this.visuals.get(entity.id);
      const age = engine.gameTime - (entity.spawnedAt ?? 0);
      const top = (isRobot ? this.laneY(entity.lane) - ROBOT_STYLE[entity.type].height - 16 : this.laneY(entity.lane) - 36) - visual.labelPop.value * 0.4;
      context.save();
      if (isRobot && age < 0.35) context.globalAlpha = age / 0.35;
      drawTokenLabel(context, this.toX(entity.x) + (isRobot ? visual.knock.value * 0.06 : 0), top, entity, engine.getCharacterStates(entity), {
        active: entity.id === engine.targetId, accent: isRobot ? this.accent : ITEM_STYLE[entity.item].color
      });
      context.restore();
    }
  }

  drawCenterText(context, text) {
    const { width, height } = this.surface;
    context.font = "600 14px 'JetBrains Mono', ui-monospace, monospace";
    context.textAlign = 'center';
    context.fillStyle = '#8a98aa';
    context.fillText(text, width / 2, height - 14);
    context.textAlign = 'start';
  }
}
