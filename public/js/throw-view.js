// 휴대폰 던지기(세로형). 원작 케이크 던지기의 '↓ 무대' 구도: 로봇이 낱말 발판을 타고 위에서 내려오고,
// 플레이어는 아래 가운데에서 위로 던진다. 멀리(위) 있는 로봇은 작게, 가까울수록 크게 그려 원근감을 준다.
// 엔진 좌표 x(1=출현 지점 → playerX=책상)를 화면 y로, lane을 세로 열로 바꿔 그린다.
import { ARCADE_RULES } from './target-game.js';
import { drawDrone } from './drone-view.js';
import { drawDeskSetup, drawDeveloper, throwPose, chargePose, THROW_TIMING, SKIN, PHONE_HELD_SCALE } from './developer-view.js';
import { THROW_RULES } from './throw-engine.js';
import {
  setupCanvas, roundedRect, drawTokenLabel, ParticleSystem, easeOutCubic, easeOutBack, Spring, VisualStates, canvasFont } from './game-view.js';

const ROBOT_STYLE = {
  basic: { name: '버그봇', body: '#2f5d72', bodyLight: '#4b8aa6', trim: '#7fdbca', eye: '#36e2ff', width: 40, height: 46, stride: 7 },
  fast: { name: '스피드봇', body: '#b14a2c', bodyLight: '#e0703f', trim: '#ffcb6b', eye: '#ffe08a', width: 32, height: 40, stride: 14 },
  tank: { name: '헤비봇', body: '#353d49', bodyLight: '#566273', trim: '#8a98aa', eye: '#ff4d6d', width: 60, height: 56, stride: 4 }
};
const ITEM_STYLE = {
  laptop: { color: '#c792ea', fill: '#2a1f3d', label: '노트북 ×3' },
  battery: { color: '#39ff88', fill: '#123321', label: 'HP +1' }
};
// 금 단계별 화면색(금이 갈수록 어두워지고 붉어진다)과 금 무늬(단계마다 누적되는 선분 묶음, 화면 좌표 -4.5~4.5 × -8~6)
const PHONE_SCREEN_COLORS = ['#36e2ff', '#2fb8d1', '#2a7f95', '#5a2b3a'];
const PHONE_CRACK_PATHS = [
  [[[4.5, -8], [1.5, -4], [2.5, -1], [-0.5, 2]], [[1.5, -4], [-2, -5.5]]],
  [[[-4.5, 6], [-1.5, 2.5], [-0.5, 2], [3, 3.5], [4.5, 6]], [[-0.5, 2], [-4.5, -1]], [[-0.5, 2], [0.5, 6]]],
  [[[-4.5, -8], [-1, -3], [-0.5, 2]], [[4.5, -3], [2.5, -1]], [[-3, -6], [0, -8]], [[2, 4.5], [4.5, 1.5]]]
];
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
      hurt: new Spring(0, { stiffness: 220, damping: 10 }),
      aimX: 0.5,
      aimTarget: 0.5,
      throwAt: -Infinity,
      pose: { ...chargePose(0), held: 1, front: 1 },
      trail: [],
      // 살아 있는 몸짓: 키 칠 때 손끝·고개 스프링, 최근 타자 활동, 번갈아 치는 손가락, 게임 오버 시각(실제 시계)
      keyPulse: new Spring(0, { stiffness: 900, damping: 26 }),
      typing: 0,
      keySide: 1,
      strokes: 0,
      finishedAt: null
    };
    this.handPosition = null;
    this.projectileStarts = new WeakMap();
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
      this.player.aimX = payload.target.lane / Math.max(1, this.lanes - 1);
      this.player.aimTarget = this.player.aimX;
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
    this.player.hurt.step(frameSeconds);
    this.updateBodyMotion(engine, frameSeconds);

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
    gradient.addColorStop(0, '#060916');
    gradient.addColorStop(0.55, '#0c1230');
    gradient.addColorStop(1, '#141a3a');
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
    // 저 멀리 서버실: 레인마다 랙 문이 열려 있고(로봇이 나오는 곳) 문 사이 랙에는 LED가 깜빡인다
    const wallTop = HUD_HEIGHT;
    context.fillStyle = '#0a0e22';
    context.fillRect(0, wallTop, width, 26);
    context.fillStyle = 'rgba(42, 49, 82, 0.8)';
    context.fillRect(0, wallTop + 26, width, 1);
    for (let led = 0; led < Math.floor(width / 9); led++) {
      const x = 4 + led * 9;
      const blink = Math.sin(engine.gameTime * (1.5 + (led * 7) % 5) + led * 2.3) > 0.55;
      context.fillStyle = blink ? (led % 3 === 0 ? '#ffb547' : '#4df0a6') : '#1a2140';
      context.fillRect(x, wallTop + 7 + (led % 3) * 5, 3, 2);
    }
    for (let lane = 0; lane < this.lanes; lane++) {
      const x = this.columnX(lane);
      const doorway = context.createLinearGradient(0, wallTop + 2, 0, wallTop + 26);
      doorway.addColorStop(0, '#03050c');
      doorway.addColorStop(1, '#1b2350');
      context.fillStyle = doorway;
      roundedRect(context, x - 24, wallTop + 2, 48, 25, 3);
      context.fill();
      context.strokeStyle = '#2a3266';
      context.lineWidth = 1;
      context.stroke();
      const on = Math.sin(engine.gameTime * 3 + lane * 1.9) > 0.2;
      context.fillStyle = on ? '#ff5d73' : '#3a1a28';
      context.shadowColor = '#ff5d73';
      context.shadowBlur = on ? 8 : 0;
      context.fillRect(x - 4, wallTop + 5, 8, 2);
      context.shadowBlur = 0;
    }
    // 레인 바닥: 가운데로 모이는 원근 줄 + 아래로 흐르는 바닥 타일
    for (let lane = 0; lane <= this.lanes; lane++) {
      const bottomX = (width * lane) / this.lanes;
      const topX = width / 2 + (bottomX - width / 2) * 0.82;
      context.strokeStyle = 'rgba(127, 167, 245, 0.09)';
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(topX, HUD_HEIGHT + 27);
      context.lineTo(bottomX, this.dangerY);
      context.stroke();
    }
    const tileSpacing = 34;
    const offset = (engine.gameTime * 26) % tileSpacing;
    context.strokeStyle = 'rgba(138, 147, 184, 0.07)';
    for (let y = HUD_HEIGHT + 27 + offset; y < this.dangerY; y += tileSpacing) {
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

  // 아래 가운데: 책상·모니터(developer-view) → 개발자(어깨 너머 뒷모습) → 의자 등받이. 손 위치를 투사체 출발점으로 기억
  drawPlayer(context, engine) {
    const { width } = this.surface;
    const { x, y } = this.playerPosition();
    const laptopMode = engine.laptopRemaining() > 0;
    const gameOver = engine.status === 'finished';
    const hurt = this.player.hurt.value;
    drawDeskSetup(context, { x, y, width, time: engine.gameTime, laptopMode, hurt: Math.abs(hurt), gameOver });
    const pose = this.updateThrowPose(engine);
    const cracks = this.phoneCracks(engine);
    const slump = this.player.finishedAt === null ? 0 : (performance.now() - this.player.finishedAt) / 700;
    const hand = drawDeveloper(context, {
      x, y: y + 12, scale: 1.3, time: engine.gameTime, aim: (this.player.aimX - 0.5) * 1.1, pose, trail: this.player.trail,
      hurt, lives: engine.lives, gameOver, laptopMode,
      motion: {
        keyPulse: this.player.keyPulse.value, keySide: this.player.keySide, typing: this.player.typing,
        tension: this.tension(engine), recoil: hurt, slump
      },
      drawHeld: (heldContext, heldX, heldY, angle, size, laptop, grip) => {
        const scale = Math.max(0.01, size);
        if (laptop) this.drawLaptopShape(heldContext, heldX, heldY, 0.6 * scale, angle);
        else this.drawPhoneShape(heldContext, heldX, heldY, angle, cracks, PHONE_HELD_SCALE * scale, grip);
      }
    });
    this.handPosition = hand;
    // 휘두르는 동안(풀린 뒤 0.16초까지)만 손 궤적을 남긴다
    const sinceThrow = engine.gameTime - this.player.throwAt;
    if (!gameOver && sinceThrow >= 0 && sinceThrow < 0.16) {
      this.player.trail.push({ x: hand.x, y: hand.y });
      if (this.player.trail.length > 7) this.player.trail.shift();
    } else if (this.player.trail.length) {
      this.player.trail.shift();
    }
  }

  // 던지기 자세: 지금 노리는 낱말을 친 비율만큼 팔을 장전하고, 던진 직후엔 휘두르기 동작(throwPose).
  // 목표 자세를 그대로 쓰지 않고 빠르게 따라가게(지수 평활) 해 연속 투척·조준 변경에도 끊기지 않는다. O(1)
  updateThrowPose(engine) {
    const latest = engine.projectiles.reduce((max, projectile) => Math.max(max, projectile.launchedAt), -Infinity);
    if (latest > this.player.throwAt) this.player.throwAt = latest;
    const target = engine.target;
    const charge = target && target.token ? engine.typed.length / target.token.text.length : 0;
    if (target && target.lane !== undefined) this.player.aimTarget = target.lane / Math.max(1, this.lanes - 1);
    const sinceThrow = engine.gameTime - this.player.throwAt;
    const goal = throwPose({ charge, sinceThrow });
    const frameSeconds = Math.max(0, Math.min(0.05, engine.gameTime - (this.player.poseTime ?? engine.gameTime)));
    this.player.poseTime = engine.gameTime;
    // 던지는 동작 전체(휘두르기~복귀)는 throwPose 곡선을 그대로 쓰고, 그 밖(장전·조준 변경)은 부드럽게 따라간다.
    // 복귀 경로는 한 바퀴(2π) 다른 각도로 이어 붙이므로 평활하면 팔이 한 바퀴 돌아 버린다
    const swinging = sinceThrow >= 0 && sinceThrow < THROW_TIMING.recover;
    const follow = swinging ? 1 : 1 - Math.exp(-frameSeconds * 22);
    const current = this.player.pose;
    for (const joint of ['upper', 'bend', 'lean', 'twist']) current[joint] += (goal[joint] - current[joint]) * follow;
    current.held = goal.held;
    current.front = goal.front;
    if (!swinging) this.player.aimX += (this.player.aimTarget - this.player.aimX) * (1 - Math.exp(-frameSeconds * 10));
    return current;
  }

  // 키를 칠 때마다 손끝 스프링을 튕기고 치는 손가락 쪽을 바꾼다. 최근 0.6초 안에 쳤으면 '타자 중'으로 서서히 올라간다. O(1)
  updateBodyMotion(engine, frameSeconds) {
    const player = this.player;
    const strokes = engine.correctKeystrokes + engine.wrongKeystrokes;
    if (strokes < player.strokes) player.strokes = strokes;
    if (strokes > player.strokes) {
      player.keyPulse.kick(70);
      player.keySide = -player.keySide;
      player.lastKeyAt = engine.gameTime;
      player.strokes = strokes;
    }
    player.keyPulse.step(frameSeconds);
    const typingNow = engine.status === 'running' && engine.gameTime - (player.lastKeyAt ?? -Infinity) < 0.6 ? 1 : 0;
    player.typing += (typingNow - player.typing) * (1 - Math.exp(-frameSeconds * (typingNow ? 14 : 3)));
    if (engine.status === 'finished') player.finishedAt ??= performance.now();
    else player.finishedAt = null;
  }

  // 가장 가까운 로봇이 위험선에 다가올수록 0 → 1 (몸이 앞으로 굽고 숨이 빨라진다). 로봇 수 r에 대해 O(r)
  tension(engine) {
    if (engine.status !== 'running') return 0;
    let nearest = 1;
    for (const robot of engine.robots) if (robot.state === 'walking') nearest = Math.min(nearest, robot.x);
    return Math.max(0, Math.min(1, 1 - (nearest - THROW_RULES.playerX) / 0.3));
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
    // 공용 드론이 집게로 상자를 물고 내려온다(드론 눈·LED는 아이템 색)
    drawDrone(context, { x: 0, y: -29, size: 0.85, time: engine.gameTime, accent: style.color, seed: item.id, claws: true });
    context.shadowColor = style.color;
    context.shadowBlur = 14 + Math.sin(engine.gameTime * 6) * 6;
    context.fillStyle = style.fill;
    roundedRect(context, -20, -16, 40, 28, 6);
    context.fill();
    context.strokeStyle = style.color;
    context.lineWidth = 2;
    context.stroke();
    context.shadowBlur = 0;
    if (item.item === 'battery') this.drawBatteryShape(context, 0, -2, engine.gameTime);
    else this.drawLaptopShape(context, 0, -3, 1, 0);
    context.restore();
    if (!item.consumed) {
      drawTokenLabel(context, x, y + 32 * scale, item, engine.getCharacterStates(item), {
        active: item.id === engine.targetId, accent: style.color, compact: this.surface.width < 520
      });
    }
  }

  // 회복 아이템: 가로로 누운 AA 건전지(+극 캡, 초록 충전 띠, 번개). 충전 띠가 천천히 차오르며 반짝인다
  drawBatteryShape(context, x, y, time) {
    const width = 26;
    const height = 13;
    const left = x - width / 2;
    const top = y - height / 2;
    context.fillStyle = '#1b2430';
    roundedRect(context, left, top, width, height, 3);
    context.fill();
    context.strokeStyle = '#c9d4e0';
    context.lineWidth = 1.5;
    context.stroke();
    context.fillStyle = '#c9d4e0';
    context.fillRect(left + width, y - 3, 3, 6);
    const level = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(time * 4));
    context.fillStyle = '#39ff88';
    roundedRect(context, left + 2, top + 2, (width - 4) * level, height - 4, 2);
    context.fill();
    context.fillStyle = '#0b1a12';
    context.beginPath();
    context.moveTo(x + 2, top + 1.5);
    context.lineTo(x - 4, y + 1);
    context.lineTo(x - 0.5, y + 1);
    context.lineTo(x - 2, top + height - 1.5);
    context.lineTo(x + 4, y - 1);
    context.lineTo(x + 0.5, y - 1);
    context.closePath();
    context.fill();
  }

  // HUD 생명 칸: 건전지 아이콘. 남은 칸은 초록(1칸 남으면 빨간 깜빡임), 잃은 칸은 빈 껍데기
  drawLifeBattery(context, x, y, state, time) {
    const width = 20;
    const height = 11;
    context.strokeStyle = state === 'empty' ? '#3a4656' : '#c9d4e0';
    context.lineWidth = 1.5;
    roundedRect(context, x, y - height / 2, width, height, 2.5);
    context.stroke();
    context.fillStyle = context.strokeStyle;
    context.fillRect(x + width, y - 2.5, 2.5, 5);
    if (state === 'empty') return;
    const low = state === 'low';
    context.globalAlpha = low ? 0.55 + 0.45 * Math.abs(Math.sin(time * 6)) : 1;
    context.fillStyle = low ? '#ff4d6d' : '#39ff88';
    roundedRect(context, x + 2, y - height / 2 + 2, width - 4, height - 4, 1.5);
    context.fill();
    context.globalAlpha = 1;
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

  // 휴대폰: 잃은 건전지 칸 수(cracks 0~3)만큼 화면에 금이 간다. 금 무늬는 고정 좌표라 매 프레임 같은 모양 — O(1)
  // grip: 손에 쥔 모양까지 그린다(휴대폰 좌표계: 가로 12 · 세로 20, 아래쪽 +y가 손목 쪽)
  // grip: 손에 쥔 휴대폰(화면이 보이는 쪽) + 오른손 손등(휴대폰 좌표계: 가로 12 · 세로 20, 아래쪽 +y가 손목·팔 쪽)
  drawPhoneShape(context, x, y, angle, cracks = 0, scale = 1, grip = false) {
    context.save();
    context.translate(x, y);
    context.rotate(angle);
    context.scale(scale, scale);
    if (grip) {
      this.drawPhoneBack(context, cracks);
      this.drawSwooshGrip(context);
      context.restore();
      return;
    }
    context.fillStyle = '#0f141b';
    roundedRect(context, -6, -10, 12, 20, 3);
    context.fill();
    context.strokeStyle = '#8a98aa';
    context.lineWidth = 1;
    context.stroke();
    context.fillStyle = PHONE_SCREEN_COLORS[Math.min(cracks, PHONE_SCREEN_COLORS.length - 1)];
    context.fillRect(-4.5, -8, 9, 14);
    if (cracks > 0) this.drawPhoneCracks(context, cracks);
    context.restore();
  }

  // 휴대폰 뒷면: 케이스 + 왼쪽 위 카메라 모듈(렌즈 둘 + 플래시). 생명을 잃을수록 뒷유리에도 금이 간다
  drawPhoneBack(context, cracks) {
    context.fillStyle = '#2b3556';
    roundedRect(context, -6, -10, 12, 20, 3);
    context.fill();
    context.strokeStyle = '#8a98aa';
    context.lineWidth = 1;
    context.stroke();
    context.fillStyle = 'rgba(255, 255, 255, 0.06)';
    roundedRect(context, -4.6, -8.6, 2.2, 17, 1.1);
    context.fill();
    context.fillStyle = '#151b30';
    roundedRect(context, -4.8, -8.8, 5, 5, 1.6);
    context.fill();
    context.fillStyle = '#05070d';
    for (const [lensX, lensY] of [[-3.3, -7.3], [-3.3, -5.3]]) {
      context.beginPath();
      context.arc(lensX, lensY, 0.85, 0, Math.PI * 2);
      context.fill();
    }
    context.fillStyle = '#ffe2a8';
    context.beginPath();
    context.arc(-1.4, -7.3, 0.45, 0, Math.PI * 2);
    context.fill();
    if (cracks > 0) this.drawPhoneCracks(context, cracks);
  }

  // 휴대폰을 쥔 오른손 — 뒤에서 본 손등(화면 쪽에서 찍은 '휴대폰 쥔 손' 사진을 반대편에서 본 모습).
  // 손이 휴대폰 왼쪽 아래 모서리를 받쳐 쥐고, 엄지는 왼쪽 옆면을 타고 절반 높이까지(나이키 로고의 짧은 획),
  // 네 손가락은 뒷면을 비스듬히 가로질러 오른쪽 옆면을 감아 넘어간다(긴 획). 손목은 왼쪽 아래(WRIST_IN_PHONE)로 빠진다.
  // 윤곽선 없이 면으로만: 손가락 사이는 아래쪽 반투명 그늘로만 구분
  drawSwooshGrip(context) {
    const fingers = [
      { from: { x: -3.9, y: 4.6 }, to: { x: 6.3, y: 2.7 }, width: 2.35 },
      { from: { x: -2.9, y: 6.4 }, to: { x: 6.6, y: 5 }, width: 2.45 },
      { from: { x: -1.9, y: 8.1 }, to: { x: 6.4, y: 7.2 }, width: 2.35 },
      { from: { x: -0.9, y: 9.7 }, to: { x: 5.8, y: 9.3 }, width: 2.05 }
    ];
    const capsule = (from, to, width) => {
      context.lineWidth = width;
      context.beginPath();
      context.moveTo(from.x, from.y);
      context.lineTo(to.x, to.y);
      context.stroke();
    };
    context.lineCap = 'round';
    // 손가락 아래 그늘(겹친 손가락 사이를 선 없이 구분)
    context.strokeStyle = 'rgba(214, 150, 112, 0.28)';
    for (const { from, to, width } of fingers) capsule({ x: from.x, y: from.y + 0.45 }, { x: Math.min(to.x, 5.6), y: to.y + 0.45 }, width);
    context.strokeStyle = SKIN.base;
    for (const { from, to, width } of fingers) capsule(from, to, width);
    // 오른쪽 옆면을 감아 넘어가는 손가락 끝(살짝 어둡게 말려 들어감)
    context.fillStyle = 'rgba(239, 184, 148, 0.6)';
    for (const { to, width } of fingers) {
      context.beginPath();
      context.ellipse(to.x + width * 0.1, to.y, width * 0.32, width * 0.45, 0, -Math.PI / 2, Math.PI / 2);
      context.fill();
    }
    // 엄지: 손등 왼쪽에서 왼쪽 옆면을 따라 휴대폰 절반 높이까지
    context.fillStyle = SKIN.base;
    context.beginPath();
    context.moveTo(-4.6, 8.6);
    context.bezierCurveTo(-6.6, 7.6, -7.4, 4.4, -7.3, 1.4);
    context.quadraticCurveTo(-7.25, -0.6, -6.3, -0.9);
    context.quadraticCurveTo(-5.2, -1, -5.1, 0.6);
    context.bezierCurveTo(-5, 3.2, -4.6, 5.2, -3.2, 6.6);
    context.closePath();
    context.fill();
    // 엄지손톱(등 쪽)
    context.fillStyle = 'rgba(255, 244, 236, 0.85)';
    context.beginPath();
    context.ellipse(-6.25, 0.1, 0.62, 0.85, 0.05, 0, Math.PI * 2);
    context.fill();
    // 손등: 손목(왼쪽 아래)에서 손가락 밑동(마디 줄)까지 한 덩어리 — 엄지·손가락 밑동을 덮어 이음매가 없다
    context.fillStyle = SKIN.base;
    context.beginPath();
    context.moveTo(-5.6, 14.2);
    context.bezierCurveTo(-7, 11.6, -6.6, 7.4, -5.2, 4.8);
    context.quadraticCurveTo(-4.4, 3.2, -3.2, 3.9);
    context.bezierCurveTo(-1.6, 5.6, -0.4, 7.8, 0.1, 9.9);
    context.quadraticCurveTo(0.4, 11.2, -0.6, 12.4);
    context.bezierCurveTo(-1.2, 13.4, -1.4, 14.2, -1.6, 14.8);
    context.closePath();
    context.fill();
    // 손등 빛(마디 쪽이 둥글게 솟음)
    context.globalAlpha = 0.45;
    context.fillStyle = SKIN.light;
    context.beginPath();
    context.ellipse(-3.2, 8.2, 1.3, 3, -0.5, 0, Math.PI * 2);
    context.fill();
    context.globalAlpha = 1;
  }

  drawPhoneCracks(context, cracks) {
    context.save();
    context.beginPath();
    context.rect(-4.5, -8, 9, 14);
    context.clip();
    context.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    context.lineWidth = 0.7;
    context.lineCap = 'round';
    for (const path of PHONE_CRACK_PATHS.slice(0, Math.min(cracks, PHONE_CRACK_PATHS.length)).flat()) {
      context.beginPath();
      path.forEach(([pointX, pointY], index) => (index === 0 ? context.moveTo(pointX, pointY) : context.lineTo(pointX, pointY)));
      context.stroke();
    }
    context.restore();
  }


  // 아래 가운데에서 목표까지 포물선(위로 솟았다 떨어짐) + 회전 + 잔상
  drawProjectile(context, projectile, engine) {
    const target = engine.findEntity(projectile.targetId);
    if (!target) return;
    // 휴대폰은 팔을 휘두르는 RELEASE 시점에 손을 떠난다 → 그 전엔 손에 있고, 남은 시간 동안 날아가 같은 순간에 맞는다
    const elapsed = engine.gameTime - projectile.launchedAt;
    if (elapsed < THROW_TIMING.release) return;
    const raw = Math.min(1, (elapsed - THROW_TIMING.release) / (ARCADE_RULES.projectileSeconds - THROW_TIMING.release));
    // 개발자 손에서 출발(던질 때 기억한 손 위치), 없으면 화면 아래 가운데
    if (!this.projectileStarts.has(projectile)) {
      const fallback = this.playerPosition();
      this.projectileStarts.set(projectile, this.handPosition ? { ...this.handPosition } : { x: fallback.x, y: fallback.y - 30 });
    }
    const start = this.projectileStarts.get(projectile);
    const endX = this.columnX(target.lane);
    const endY = this.toY(target.x) - (target.kind === 'item' ? 18 : 30 * this.depthScale(target.x));
    const pointAt = progress => {
      const eased = easeOutCubic(progress);
      return {
        x: start.x + (endX - start.x) * eased + Math.sin(eased * Math.PI) * (endX > start.x ? 24 : -24),
        y: start.y + (endY - start.y) * eased
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
    else this.drawPhoneShape(context, x, y, angle, this.phoneCracks(engine), 1.15);
  }

  // 잃은 건전지 칸 수 = 휴대폰 금 단계(0 멀쩡 · 1 한 줄 · 2 거미줄 · 3 산산조각)
  phoneCracks(engine) {
    return Math.max(0, ARCADE_RULES.startLives - engine.lives);
  }

  // 원작의 하트 자리(왼쪽 위)에 건전지 생명, 오른쪽 위 현재 무기
  drawHud(context, engine) {
    const { width } = this.surface;
    const gradient = context.createLinearGradient(0, 0, 0, HUD_HEIGHT);
    gradient.addColorStop(0, 'rgba(14, 18, 34, 0.96)');
    gradient.addColorStop(1, 'rgba(9, 12, 24, 0.92)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, HUD_HEIGHT);
    context.fillStyle = 'rgba(42, 49, 82, 0.9)';
    context.fillRect(0, HUD_HEIGHT - 1, width, 1);
    context.font = canvasFont(12);
    context.textBaseline = 'middle';
    for (let index = 0; index < ARCADE_RULES.startLives; index++) {
      const state = index >= engine.lives ? 'empty' : engine.lives === 1 ? 'low' : 'full';
      this.drawLifeBattery(context, 10 + index * 30, HUD_HEIGHT / 2, state, engine.gameTime);
    }
    const laptop = engine.laptopRemaining();
    context.textAlign = 'right';
    context.font = canvasFont(12);
    if (laptop > 0) {
      context.fillStyle = '#c792ea';
      context.fillText(`💻 노트북 ×3 · ${laptop.toFixed(1)}s`, width - 10, HUD_HEIGHT / 2);
      context.fillRect(width - 130, HUD_HEIGHT - 5, 120 * (laptop / THROW_RULES.laptopSeconds), 3);
    } else {
      context.fillStyle = '#8a93b8';
      context.fillText('📱 휴대폰', width - 10, HUD_HEIGHT / 2);
    }
    context.textAlign = 'start';
  }
}
