// 휴대폰 던지기(세로형). 원작 케이크 던지기의 '↓ 무대' 구도: 로봇이 낱말 발판을 타고 위에서 내려오고,
// 플레이어는 아래 가운데에서 위로 던진다. 멀리(위) 있는 로봇은 작게, 가까울수록 크게 그려 원근감을 준다.
// 엔진 좌표 x(1=출현 지점 → playerX=책상)를 화면 y로, lane을 세로 열로 바꿔 그린다.
import { ARCADE_RULES } from './target-game.js';
import { drawDrone } from './drone-view.js';
import { drawDeskSetup, drawDeveloper, throwPose, chargePose, THROW_TIMING, SKIN, PHONE_HELD_SCALE } from './developer-view.js';
import { THROW_RULES, BOSS_RULES, ROBOT_TYPES, BOSS_SKILLS, FORMATIONS } from './throw-engine.js';
import { qualityFor,
  setupCanvas, roundedRect, drawTokenLabel, ParticleSystem, easeOutCubic, easeOutBack, Spring, VisualStates, canvasFont,
  loadArt, drawCoverArt, Juice } from './game-view.js';

// 서버실 복도 그림(AI 생성, public/art/throw-stage.webp). 소실점이 화면 가운데 위로 오게 깐다
const STAGE_ART = loadArt('/art/throw-stage.webp');

const ROBOT_STYLE = {
  basic: { name: '버그봇', body: '#2f5d72', bodyLight: '#4b8aa6', trim: '#7fdbca', eye: '#36e2ff', width: 40, height: 46, stride: 7 },
  fast: { name: '스피드봇', body: '#b14a2c', bodyLight: '#e0703f', trim: '#ffcb6b', eye: '#ffe08a', width: 32, height: 40, stride: 14 },
  slow: { name: '달팽봇', body: '#3f6b3a', bodyLight: '#6fae5c', trim: '#c9f29b', eye: '#b6ff6b', shell: '#c7834a', shellLight: '#f0b878', width: 54, height: 44, stride: 3 },
  // 보스는 로컬 좌표(발 y=0, 왕관 끝 y=-168, 팔 끝까지 너비 약 340)로 그리고 bossScale로 화면에 맞춘다
  boss: { name: '보스 서버봇', body: '#3a1020', bodyLight: '#9a2c46', trim: '#ffcf5a', eye: '#ff3355', metal: '#2a2f3d', metalLight: '#4a5266', width: 340, height: 168, stride: 1.4 },
  tank: { name: '헤비봇', body: '#353d49', bodyLight: '#566273', trim: '#8a98aa', eye: '#ff4d6d', width: 60, height: 56, stride: 4 },
  // 특수 로봇: 기존 몸체(버그봇·헤비봇)를 다른 색으로 쓰고 장식을 얹는다
  shield: { name: '방패봇', body: '#24435f', bodyLight: '#3f6f96', trim: '#9fd3ff', eye: '#7fe3ff', width: 60, height: 56, stride: 3.5 },
  twin: { name: '쌍둥이봇', body: '#7a2a63', bodyLight: '#c04d9c', trim: '#ffb3e6', eye: '#ffd1f3', width: 40, height: 46, stride: 7 },
  chameleon: { name: '카멜레온봇', body: '#2f6b4a', bodyLight: '#4fb07a', trim: '#c4ffd9', eye: '#e8ff7a', width: 40, height: 46, stride: 6 },
  splitter: { name: '분열봇', body: '#4b2a7a', bodyLight: '#7c4dc0', trim: '#d6b8ff', eye: '#ff9df5', width: 60, height: 56, stride: 3.5 },
  mini: { name: '꼬마봇', body: '#7c4dc0', bodyLight: '#a982e8', trim: '#ead9ff', eye: '#ff9df5', width: 40, height: 46, stride: 11 },
  mirror: { name: '거울봇', body: '#5d6b7a', bodyLight: '#c9d6e3', trim: '#ffffff', eye: '#9ff0ff', width: 40, height: 46, stride: 7 },
  // 보스 2종(서버봇과 같은 로컬 좌표·크기)
  printer: { name: '보스 프린터봇', body: '#2d2f3a', bodyLight: '#e6e9f0', trim: '#ffb547', eye: '#ff3355', metal: '#2a2f3d', metalLight: '#4a5266', width: 340, height: 168, stride: 1.2 },
  hacker: { name: '보스 해커봇', body: '#0d1a12', bodyLight: '#1f3a2a', trim: '#39ff88', eye: '#39ff88', metal: '#1a1f2a', metalLight: '#3a4458', width: 340, height: 168, stride: 1.6 }
};
const isBossType = type => Boolean(ROBOT_TYPES[type]?.boss);
// 난이도 레벨마다 일반 로봇의 색과 표정을 바꾼다(보스는 그대로).
//  1 입문: 파스텔빛, 웃는 눈(^ ^)과 발그레한 볼  2 보통: 기본
//  3 숙련: 주황빛으로 달아오르고 화난 눈썹       4 장애 대응: 검붉게 오염, 붉은 눈, 가끔 지직
const LEVEL_LOOKS = Object.freeze({
  1: Object.freeze({ tint: '#bfefff', amount: 0.38, eye: '#9dffcf', mood: 'happy' }),
  2: Object.freeze({ tint: null, amount: 0, eye: null, mood: 'normal' }),
  3: Object.freeze({ tint: '#ff6a2a', amount: 0.32, eye: '#ffb347', mood: 'angry' }),
  4: Object.freeze({ tint: '#16061c', amount: 0.58, eye: '#ff2244', mood: 'corrupt' })
});

// '#rrggbb' 두 색을 amount(0~1)만큼 섞는다
function mixHex(from, to, amount) {
  const parse = hex => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));
  const [a, b] = [parse(from), parse(to)];
  return `#${a.map((value, index) => Math.round(value + (b[index] - value) * amount).toString(16).padStart(2, '0')).join('')}`;
}

// 레벨 색을 입힌 로봇 스타일(레벨·종류별로 한 번만 만든다)
const levelStyleCache = new Map();
function levelStyle(type, level) {
  const look = LEVEL_LOOKS[level] ?? LEVEL_LOOKS[2];
  const base = ROBOT_STYLE[type];
  if (isBossType(type) || !look.tint) return base;
  const key = `${type}:${level}`;
  if (!levelStyleCache.has(key)) {
    const tinted = { ...base, eye: look.eye ?? base.eye };
    for (const field of ['body', 'bodyLight', 'trim', 'shell', 'shellLight']) {
      if (base[field]) tinted[field] = mixHex(base[field], look.tint, field === 'trim' ? look.amount * 0.6 : look.amount);
    }
    levelStyleCache.set(key, Object.freeze(tinted));
  }
  return levelStyleCache.get(key);
}

const ITEM_STYLE = {
  laptop: { color: '#c792ea', fill: '#2a1f3d', label: '노트북 ×2' },
  battery: { color: '#39ff88', fill: '#123321', label: 'HP +1' }
};
// 금 단계별 화면색(금이 갈수록 어두워지고 붉어진다)과 금 무늬(단계마다 누적되는 선분 묶음, 화면 좌표 -4.5~4.5 × -8~6)
// 쥔 휴대폰을 손 위로 올리는 정도(휴대폰 좌표 단위)
const GRIP_PHONE_LIFT = 2.2;
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
    this.quality = qualityFor(this.surface);
    this.particles = new ParticleSystem();
    this.juice = new Juice();
    this.lastWallSeconds = null;
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

  // 보스 크기: 늘이지 않고 비율 그대로 키운다. 너비는 화면의 82%까지, 키는 등장 위치에서 머리가 HUD 아래에 들어오는 만큼
  bossScale() {
    const style = ROBOT_STYLE.boss;
    const room = this.toY(BOSS_RULES.spawnX) - HUD_HEIGHT - 30;
    return Math.max(0.5, Math.min((this.surface.width * 0.82) / style.width, room / style.height));
  }

  // 가로로 넓은 화면에서는 어깨 포드와 팔만 조금 더 벌린다(몸통은 그대로). 1 ~ 1.45
  bossSpread() {
    const style = ROBOT_STYLE.boss;
    return Math.max(1, Math.min(1.45, (this.surface.width * 0.6) / (this.bossScale() * style.width)));
  }

  // 보스 가슴 대포의 화면 위치(패드가 나오는 곳, 충전·발사 연출 기준점)
  bossCannonPoint(boss) {
    return { x: this.columnX(boss.lane), y: this.toY(boss.x) - 74 * this.bossScale() };
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
      const heavy = payload.weapon === 'laptop' || robot.maxHp > 1;
      if (type === 'kill') {
        this.juice.shake(heavy ? 0.45 : 0.3);
        this.juice.ring(x, y, { color: style.eye, radius: (heavy ? 90 : 64) * scale, width: 5 });
        this.juice.ring(x, y, { color: '#ffffff', radius: 34 * scale, life: 0.22, width: 3 });
        this.juice.popup(x, y - 24 * scale, `+${payload.bounty}`, { color: '#ffe08a', size: heavy ? 24 : 20 });
        this.particles.burst(x, y, { color: style.bodyLight, count: 18, speed: 240, life: 0.8, size: 4, gravity: 420 });
        this.particles.burst(x, y, { color: style.eye, count: 14, speed: 160, life: 0.5, size: 2.5 });
        this.particles.burst(x, y, { color: '#ffffff', count: 8, speed: 90, life: 0.25, size: 5 });
      } else {
        this.juice.shake(isBossType(robot.type) ? 0.4 : payload.weapon === 'laptop' ? 0.3 : 0.18);
        this.juice.ring(x, y, { color: '#ffcb6b', radius: 40 * scale, life: 0.25, width: 3 });
        if (robot.hp > 0) this.juice.popup(x + 22 * scale, y - 10, `HP ${robot.hp}`, { color: '#ffcb6b', size: 15, rise: 28, life: 0.6 });
        this.particles.burst(x, y + 10, { color: '#ffcb6b', count: 10, speed: 150, life: 0.35, size: 2.5 });
      }
    } else if (type === 'item') {
      const item = payload.item;
      this.particles.burst(this.columnX(item.lane), this.toY(item.x) - 14, { color: ITEM_STYLE[item.item].color, count: 32, speed: 220, life: 0.8 });
      this.juice.flash(ITEM_STYLE[item.item].color, 0.18, 0.3);
      this.juice.ring(this.columnX(item.lane), this.toY(item.x) - 14, { color: ITEM_STYLE[item.item].color, radius: 110, life: 0.5, width: 6 });
      this.juice.popup(this.columnX(item.lane), this.toY(item.x) - 40, item.item === 'laptop' ? '💻 두 개씩!' : '🔋 +1', { color: ITEM_STYLE[item.item].color, size: 22 });
    } else if (type === 'boss-warning') {
      this.juice.shake(0.5);
      this.juice.flash('#ff2846', 0.3, 0.6);
    } else if (type === 'boss-appear') {
      const x = this.columnX(payload.boss.lane);
      const y = this.toY(payload.boss.x);
      this.juice.shake(0.9);
      this.juice.flash('#ffffff', 0.35, 0.3);
      this.juice.ring(x, y - 60, { color: '#ff3355', radius: 260, life: 0.7, width: 8 });
      this.particles.burst(x, y - 60, { color: '#ff3355', count: 40, speed: 320, life: 0.9, size: 4 });
    } else if (type === 'boss-reached') {
      this.juice.shake(0.4);
      this.juice.popup(this.surface.width / 2, this.dangerY - 70, '⚠ 보스 근접!', { color: '#ff5d73', size: 22, life: 1 });
    } else if (type === 'boss-windup') {
      this.juice.popup(this.surface.width / 2, this.dangerY - 70, '펀치 온다! 맞혀서 밀어내!', { color: '#ffcf5a', size: 18, life: BOSS_RULES.punchWindupSeconds });
    } else if (type === 'boss-pushed') {
      this.juice.popup(this.surface.width / 2, this.dangerY - 70, '밀어냈다!', { color: '#4df0a6', size: 20, life: 0.8 });
    } else if (type === 'boss-punch') {
      const { x, y } = this.playerPosition();
      this.juice.shake(0.9);
      this.juice.flash('#ffffff', 0.4, 0.15);
      this.juice.ring(x, y - 40, { color: '#ffcf5a', radius: 200, life: 0.45, width: 9 });
      this.juice.popup(x, y - 110, 'PUNCH!', { color: '#ffcf5a', size: 32, rise: 20, life: 0.9 });
      this.particles.burst(x, y - 40, { color: '#ffcf5a', count: 36, speed: 380, life: 0.7, size: 4, gravity: 500 });
    } else if (type === 'boss-charge') {
      const cannon = this.bossCannonPoint(payload.boss);
      const skill = BOSS_SKILLS[payload.skill] ?? BOSS_SKILLS.cannon;
      this.juice.popup(cannon.x, cannon.y - 96 * this.bossScale(), `${skill.icon} ${skill.label}!`, { color: '#36e2ff', size: 20, life: 1 });
      this.juice.shake(0.12);
    } else if (type === 'boss-fire') {
      const cannon = this.bossCannonPoint(payload.boss);
      this.juice.shake(0.55);
      this.juice.flash('#36e2ff', 0.18, 0.2);
      this.juice.ring(cannon.x, cannon.y, { color: '#36e2ff', radius: 90, life: 0.35, width: 7 });
      this.particles.burst(cannon.x, cannon.y, { color: '#9aa6b8', count: 22, speed: 180, life: 0.7, size: 4, gravity: -60 });
      this.particles.burst(cannon.x, cannon.y, { color: '#36e2ff', count: 16, speed: 300, life: 0.35 });
    } else if (type === 'boss-mask') {
      this.juice.flash('#39ff88', 0.25, 0.3);
      this.juice.shake(0.3);
      this.juice.popup(this.surface.width / 2, this.surface.height * 0.4, '🕶 화면 해킹! 글자가 가려져요', { color: '#39ff88', size: 20, life: 1.4 });
    } else if (type === 'boss-decoy') {
      this.juice.popup(this.surface.width / 2, HUD_HEIGHT + 60, `🤖 봇 ${payload.minions.length}대 소환`, { color: '#ff9df5', size: 18, life: 1.1 });
    } else if (type === 'boss-dash') {
      this.juice.shake(0.6);
      this.juice.popup(this.surface.width / 2, this.dangerY - 90, '💨 돌진!', { color: '#ff5d73', size: 22, life: 0.8 });
    } else if (type === 'formation') {
      const label = FORMATIONS[payload.formation]?.label ?? '';
      if (label) this.juice.popup(this.surface.width / 2, HUD_HEIGHT + 46, `⚠ ${label}`, { color: '#9fd3ff', size: 16, rise: 10, life: 1.2 });
    } else if (type === 'morph') {
      const robot = payload.robot;
      const x = this.columnX(robot.lane), y = this.toY(robot.x) - 24 * this.depthScale(robot.x);
      this.juice.ring(x, y, { color: '#e8ff7a', radius: 50 * this.depthScale(robot.x), life: 0.35, width: 3 });
      this.particles.burst(x, y, { color: '#4fb07a', count: 10, speed: 120, life: 0.4 });
    } else if (type === 'split') {
      const robot = payload.robot;
      const x = this.columnX(robot.lane), y = this.toY(robot.x) - 24 * this.depthScale(robot.x);
      this.juice.popup(x, y - 30, '분열!', { color: '#d6b8ff', size: 18, life: 0.8 });
      this.particles.burst(x, y, { color: '#d6b8ff', count: 24, speed: 220, life: 0.6, gravity: 300 });
    } else if (type === 'twin-hit') {
      const x = (this.columnX(payload.robot.lane) + this.columnX(payload.twin.lane)) / 2;
      this.juice.popup(x, this.toY(payload.robot.x) - 60, '♊ 동시 격파!', { color: '#ffb3e6', size: 18, life: 0.9 });
    } else if (type === 'pad-blocked') {
      const x = this.columnX(payload.pad.lane);
      const y = this.toY(payload.pad.x) - 30;
      this.juice.shake(0.25);
      this.juice.ring(x, y, { color: '#36e2ff', radius: 70, life: 0.35, width: 5 });
      this.juice.popup(x, y - 20, `BLOCK! +${payload.bonus}`, { color: '#36e2ff', size: 20 });
      this.particles.burst(x, y, { color: '#36e2ff', count: 26, speed: 260, life: 0.6, gravity: 300 });
    } else if (type === 'heal') {
      this.juice.popup(70, HUD_HEIGHT + 22, '+1 🔋', { color: '#4df0a6', size: 18, rise: 24, life: 0.9 });
      this.juice.ring(40, HUD_HEIGHT / 2, { color: '#4df0a6', radius: 46, life: 0.4, width: 4 });
    } else if (type === 'goal') {
      this.juice.flash('#ffffff', 0.55, 0.5);
      this.juice.shake(0.6);
      this.juice.popup(this.surface.width / 2, this.surface.height * 0.45, payload.boss ? 'BOSS DOWN!' : 'MISSION CLEAR!', { color: '#4df0a6', size: 34, rise: 30, life: 1.6 });
    } else if (type === 'throw' && payload.combo > 0 && payload.combo % 10 === 0) {
      const { x, y } = this.playerPosition();
      this.juice.popup(x, y - 70, `${payload.combo} COMBO!`, { color: this.accent, size: 24, life: 1.1 });
    } else if (type === 'mistake') {
      this.juice.shake(0.12);
    } else if (type === 'damage') {
      this.player.hurt.kick(30);
      this.juice.shake(0.75);
      this.juice.flash('#ff2846', 0.32, 0.35);
      const hitX = this.columnX((payload.cause.robot ?? payload.cause.pad).lane);
      this.juice.popup(hitX, this.dangerY - 18, '-1 🔋', { color: '#ff5d73', size: 22 });
      this.particles.burst(hitX, this.dangerY, { color: '#ff4d6d', count: 26, speed: 200, life: 0.6, gravity: 300 });
    }
  }

  render(engine, { accent }) {
    this.quality.tick(engine.status === 'running');
    const context = this.context;
    if (!context) return;
    this.surface.resize?.();
    this.accent = accent;
    this.lanes = engine.lanes;
    this.levelLook = LEVEL_LOOKS[engine.level] ?? LEVEL_LOOKS[2];
    const frameSeconds = Math.min(0.1, Math.max(0, engine.gameTime - this.lastGameTime)) || (engine.status === 'running' ? 0 : 1 / 60);
    this.lastGameTime = engine.gameTime;
    this.particles.update(frameSeconds);
    this.visuals.step(frameSeconds, new Set([...engine.robots, ...engine.items].map(entity => entity.id)));
    this.player.hurt.step(frameSeconds);
    const wallNow = performance.now() / 1000;
    this.juice.step(this.lastWallSeconds == null ? 0 : wallNow - this.lastWallSeconds);
    this.lastWallSeconds = wallNow;
    this.juice.setDanger(engine.status === 'running' && engine.lives === 1 ? 1 : 0);
    this.updateBodyMotion(engine, frameSeconds);

    const { width, height } = this.surface;
    context.clearRect(0, 0, width, height);
    this.juice.beginShake(context);
    this.drawBackground(context, width, height, engine);
    // 먼 것(위)부터 그려 가까운 로봇이 앞을 가리게 한다
    const sorted = [...engine.robots].sort((first, second) => second.x - first.x);
    for (const item of engine.items) if (!item.consumed || engine.projectiles.some(projectile => projectile.targetId === item.id)) this.drawItem(context, item, engine);
    this.drawTwinLinks(context, engine);
    const hidden = this.hiddenRobotIds(engine.robots, engine.targetId);
    for (const robot of sorted) this.drawRobot(context, robot, engine, hidden.has(robot.id));
    for (const pad of engine.pads) if (!pad.consumed || engine.projectiles.some(projectile => projectile.targetId === pad.id)) this.drawPad(context, pad, engine);
    if (engine.isMasked?.()) this.drawMaskStatic(context, width, height, engine);
    this.drawDangerLine(context, width, engine);
    this.drawPlayer(context, engine);
    for (const projectile of engine.projectiles) this.drawProjectile(context, projectile, engine);
    this.particles.draw(context);
    this.juice.endShake(context);
    this.juice.drawOverlay(context, width, height);
    this.drawBossBanner(context, width, engine);
    this.drawHud(context, engine);
  }

  drawBackground(context, width, height, engine) {
    const gradient = context.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, '#060916');
    gradient.addColorStop(0.55, '#0c1230');
    gradient.addColorStop(1, '#141a3a');
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
    // 그림은 낱말·로봇이 잘 보이게 어둡게 깔고, 아래(책상 쪽)로 갈수록 더 어둡게 덮는다
    if (drawCoverArt(context, STAGE_ART, { y: HUD_HEIGHT, width, height: height - HUD_HEIGHT, focusY: 0.35, alpha: 0.62 })) {
      const shade = context.createLinearGradient(0, HUD_HEIGHT, 0, height);
      shade.addColorStop(0, 'rgba(6, 9, 22, 0.15)');
      shade.addColorStop(0.6, 'rgba(6, 9, 22, 0.35)');
      shade.addColorStop(1, 'rgba(6, 9, 22, 0.8)');
      context.fillStyle = shade;
      context.fillRect(0, HUD_HEIGHT, width, height - HUD_HEIGHT);
    }
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

  // 같은 줄에서 더 가까운(아래) 로봇 몸에 가려진 로봇: 몸이 안 보이는데 낱말만 떠 있지 않게 낱말을 숨긴다.
  // 가린 로봇이 부서지거나 서로 벌어지면 다시 보인다. 지금 치고 있는 대상은 숨기지 않는다. O(n²), n = 화면의 로봇 수(작음)
  hiddenRobotIds(robots, targetId) {
    const hidden = new Set();
    const blockers = robots.filter(robot => robot.state === 'walking');
    for (const robot of blockers) {
      if (robot.id === targetId) continue;
      const footY = this.toY(robot.x);
      const covered = blockers.some(front => {
        if (front === robot || front.lane !== robot.lane || front.x >= robot.x) return false;
        const frontBody = ROBOT_STYLE[front.type].height * this.depthScale(front.x);
        return this.toY(front.x) - footY < frontBody * 0.85;
      });
      if (covered) hidden.add(robot.id);
    }
    return hidden;
  }

  drawRobot(context, robot, engine, labelHidden = false) {
    const style = levelStyle(robot.type, engine.level);
    const visual = this.visuals.get(robot.id);
    // 보스가 아닌 로봇의 표정 분위기(레벨): drawEyes가 읽는다
    const boss = isBossType(robot.type);
    this.robotMood = boss ? 'boss' : (this.levelLook?.mood ?? 'normal');
    const age = engine.gameTime - robot.spawnedAt;
    const sinceState = engine.gameTime - robot.stateAt;
    let scale = easeOutBack(Math.min(1, age / 0.35)) * (boss ? this.bossScale() : this.depthScale(robot.x));
    let rotation = 0;
    let alpha = Math.min(1, age / 0.2);
    // 몸 움직임(보스 제외): offsetX/offsetY는 화면 픽셀, tilt는 기울기, stretch는 세로로 늘어나는 정도
    let offsetX = 0;
    let offsetY = 0;
    let tilt = 0;
    let stretch = 0;
    const side = robot.id % 2 === 0 ? 1 : -1;
    if (robot.state === 'dying') {
      // 맞은 반대쪽으로 튕겨 올라 빙글 돌며 사라진다
      const progress = Math.min(1, sinceState / THROW_RULES.dyingSeconds);
      scale *= progress < 0.3 ? 1 + progress : Math.max(0, 1.3 * (1 - (progress - 0.3) / 0.7));
      rotation = side * progress * 3.2;
      alpha = 1 - progress * 0.6;
      offsetX = side * progress * 26;
      offsetY = -Math.sin(progress * Math.PI) * 34;
    } else if (robot.state === 'crashed') {
      // 책상으로 몸을 던져 덮친다
      const progress = Math.min(1, sinceState / THROW_RULES.dyingSeconds);
      scale *= 1 + progress * 0.4;
      alpha = 1 - progress;
      offsetY = easeOutCubic(progress) * 30;
      tilt = side * progress * 0.3;
    }
    if (scale <= 0.01) return;
    const time = engine.gameTime;
    const sinceHit = time - robot.hitAt;
    const motion = {
      // 맞은 직후 0→1→0: 움찔하며 뒤로 젖혀진다
      flinch: sinceHit >= 0 && sinceHit < 0.35 ? Math.sin((sinceHit / 0.35) * Math.PI) : 0,
      // 책상에 가까울수록 0→1: 팔을 치켜들고 부들부들 떤다
      menace: robot.state === 'walking' ? Math.min(1, Math.max(0, (THROW_RULES.playerX + 0.22 - robot.x) / 0.22)) : 0
    };

    const walkPhase = (engine.gameTime + robot.id * 0.37) * style.stride;
    let bob = robot.state === 'walking' ? Math.abs(Math.sin(walkPhase)) * (robot.type === 'tank' ? 1.5 : 3) : 0;
    if (robot.state === 'walking' && !boss) {
      if (robot.type === 'basic' || robot.type === 'twin' || robot.type === 'mirror' || robot.type === 'chameleon' || robot.type === 'mini') {
        // 뒤뚱뒤뚱: 걸음마다 좌우로 기울고, 가끔 폴짝 뛴다
        tilt = Math.sin(walkPhase) * 0.09;
        const hop = (time * 0.7 + robot.id * 0.31) % 1;
        if (hop < 0.18) bob += Math.sin((hop / 0.18) * Math.PI) * 9;
      } else if (robot.type === 'fast') {
        // 지그재그: 좌우로 미끄러지며 그쪽으로 몸을 눕히고, 달리는 방향으로 길쭉해진다
        const weave = time * 6 + robot.id;
        offsetX = Math.sin(weave) * 7 * scale;
        tilt = Math.cos(weave) * 0.2;
        stretch = 0.07;
      } else if (robot.type === 'tank' || robot.type === 'shield' || robot.type === 'splitter') {
        // 쿵, 쿵: 천천히 들렸다가 뚝 떨어지고, 떨어질 때 납작해지며 먼지가 난다
        const stomp = Math.abs(Math.sin(walkPhase));
        bob = stomp ** 0.5 * 4;
        tilt = Math.sin(walkPhase) * 0.035;
        if (stomp < 0.12) {
          stretch = -0.05;
          if (Math.random() < 0.35) this.particles.burst(this.columnX(robot.lane) + (Math.random() - 0.5) * 40 * scale, this.toY(robot.x), { color: '#8a98aa', count: 1, speed: 50, life: 0.35, size: 2.5, gravity: -80 });
        }
      } else if (robot.type === 'slow') {
        // 꿈틀꿈틀: 몸을 늘였다 줄였다 하며 긴다(세로로 숨 쉬듯)
        stretch = Math.sin(walkPhase) * 0.04;
      }
      tilt -= side * motion.flinch * 0.22;
      offsetY -= motion.flinch * 5;
      offsetX += Math.sin(time * 42 + robot.id) * 1.6 * motion.menace;
    }
    const squash = visual.squash.value * 0.025;
    const x = this.columnX(robot.lane) + offsetX;
    const footY = this.toY(robot.x) + visual.knock.value * 0.05;
    const hitFlash = engine.gameTime - robot.hitAt < 0.1;
    const stunned = engine.gameTime - robot.hitAt < 0.25;

    // 낱말 발판(원작: 로봇이 단어를 타고 온다) — 로봇 발밑에 먼저 그린다
    if (robot.state === 'walking' && !robot.doomed && !labelHidden) {
      const pop = visual.labelPop.value * 0.4;
      const guarded = engine.isGuarded?.(robot);
      context.save();
      context.globalAlpha = Math.min(1, age / 0.3);
      const [shown, states] = this.labelView(robot, engine.getCharacterStates(robot), engine);
      drawTokenLabel(context, this.columnX(robot.lane), footY + 26 - pop, shown, states, {
        active: robot.id === engine.targetId, accent: this.accent, compact: this.surface.width < 520, dimmed: guarded
      });
      if (guarded) {
        context.font = canvasFont(14, 'ui', 700);
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText('🔒', this.columnX(robot.lane), footY + 14 - pop);
      }
      context.restore();
    }
    // 그림자
    context.fillStyle = 'rgba(0, 0, 0, 0.35)';
    context.beginPath();
    context.ellipse(x, footY + 1, style.width * 0.55 * scale, 4 * scale, 0, 0, Math.PI * 2);
    context.fill();

    context.save();
    context.globalAlpha = alpha;
    // 장애 대응(Lv.4): 가끔 몸이 옆으로 지직 튄다
    if (this.robotMood === 'corrupt' && robot.state === 'walking' && Math.sin(engine.gameTime * 5.3 + robot.id * 1.9) > 0.94) {
      offsetX += Math.sin(engine.gameTime * 80) * 4 * scale;
    }
    context.translate(this.columnX(robot.lane) + offsetX, footY - bob * scale + offsetY);
    context.rotate(rotation + tilt);
    context.scale(scale * (1 + squash - stretch), scale * (1 - squash + stretch));
    if (robot.type === 'basic') this.drawBugBot(context, style, walkPhase, engine, robot, hitFlash, stunned, motion);
    else if (robot.type === 'fast') this.drawSpeedBot(context, style, walkPhase, engine, robot, hitFlash, stunned, motion);
    else if (robot.type === 'slow') this.drawSnailBot(context, style, walkPhase, engine, robot, hitFlash, stunned, motion);
    else if (robot.type === 'boss') this.drawBossBot(context, style, walkPhase, engine, robot, hitFlash, stunned, this.bossSpread());
    else if (robot.type === 'printer') this.drawPrinterBoss(context, style, walkPhase, engine, robot, hitFlash);
    else if (robot.type === 'hacker') this.drawHackerBoss(context, style, walkPhase, engine, robot, hitFlash);
    else if (robot.type === 'shield') {
      this.drawHeavyBot(context, style, walkPhase, engine, robot, hitFlash, stunned, motion);
      this.drawShieldPlate(context, style, engine, robot, hitFlash);
    } else if (robot.type === 'splitter') {
      this.drawHeavyBot(context, style, walkPhase, engine, robot, hitFlash, stunned, motion);
      this.drawSplitSeam(context, style, engine, robot);
    } else if (robot.type === 'mini') {
      context.scale(0.7, 0.7);
      this.drawBugBot(context, style, walkPhase, engine, robot, hitFlash, stunned, motion);
    } else if (robot.type === 'chameleon') {
      this.drawBugBot(context, this.chameleonStyle(style, engine, robot), walkPhase, engine, robot, hitFlash, stunned, motion);
    } else if (robot.type === 'twin' || robot.type === 'mirror') {
      this.drawBugBot(context, style, walkPhase, engine, robot, hitFlash, stunned, motion);
      if (robot.type === 'twin') this.drawTwinMark(context, style, engine, robot);
      else this.drawMirrorSheen(context, style, engine, robot);
    }
    else this.drawHeavyBot(context, style, walkPhase, engine, robot, hitFlash, stunned, motion);
    context.restore();
  }

  drawEyes(context, positions, radius, color, { blink, stunned, angry = false }) {
    const mood = this.robotMood ?? 'normal';
    if (mood === 'angry' || mood === 'corrupt') angry = true;
    if (mood === 'happy') angry = false;
    if (mood === 'happy' && !stunned && !blink) {
      this.drawHappyEyes(context, positions, radius, color);
      return;
    }
    if (mood === 'corrupt') radius *= 1.1;
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

  // 입문(Lv.1) 표정: 웃는 눈 ^ ^ 과 발그레한 볼
  drawHappyEyes(context, positions, radius, color) {
    context.strokeStyle = color;
    context.shadowColor = color;
    context.shadowBlur = 8;
    context.lineWidth = Math.max(1.6, radius * 0.6);
    context.lineCap = 'round';
    for (const [eyeX, eyeY] of positions) {
      context.beginPath();
      context.arc(eyeX, eyeY + radius * 0.5, radius, Math.PI * 1.15, Math.PI * 1.85);
      context.stroke();
    }
    context.shadowBlur = 0;
    if (positions.length < 2) return;
    context.fillStyle = 'rgba(255, 140, 170, 0.55)';
    for (const [eyeX, eyeY] of positions) {
      context.beginPath();
      context.ellipse(eyeX + Math.sign(eyeX) * radius * 0.8, eyeY + radius * 1.6, radius * 0.9, radius * 0.5, 0, 0, Math.PI * 2);
      context.fill();
    }
  }

  isBlinking(engine, robot) {
    return ((engine.gameTime + robot.id * 1.3) % 3.2) < 0.12;
  }

  // 기본 로봇 '버그봇'(정면): 모니터 머리 + 몸통 + 팔다리를 번갈아 흔들며 걷는다
  drawBugBot(context, style, phase, engine, robot, hitFlash, stunned, motion = { flinch: 0, menace: 0 }) {
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
    // 팔: 걸을 땐 번갈아 흔들고, 맞거나 책상에 가까워지면 번쩍 치켜든다(가까우면 파닥파닥)
    const raise = Math.max(motion.flinch, motion.menace) * (16 + Math.sin(engine.gameTime * 18 + robot.id) * 4 * motion.menace);
    context.lineTo(-width / 2 - 2 - raise * 0.35, -height * 0.3 + swing * 5 - raise);
    context.moveTo(width / 2 - 6, -height * 0.5);
    context.lineTo(width / 2 + 2 + raise * 0.35, -height * 0.3 - swing * 5 - raise);
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
    else if (motion.menace > 0.4) context.fillRect(-4, -height * 0.69, 8, 5);
    else if (this.robotMood === 'angry' || this.robotMood === 'corrupt') { context.fillRect(-5, -height * 0.65, 2, 2); context.fillRect(-3, -height * 0.67, 6, 2); context.fillRect(3, -height * 0.65, 2, 2); }
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
  drawSpeedBot(context, style, phase, engine, robot, hitFlash, stunned, motion = { flinch: 0, menace: 0 }) {
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
    // 가까워지면 뒤(위)로 불꽃을 뿜으며 막판 질주
    if (motion.menace > 0) {
      const flame = 10 + motion.menace * 14 + Math.sin(engine.gameTime * 40 + robot.id) * 4;
      context.fillStyle = 'rgba(255, 181, 71, 0.85)';
      context.beginPath();
      context.moveTo(-7, -height + 2);
      context.lineTo(0, -height - flame);
      context.lineTo(7, -height + 2);
      context.closePath();
      context.fill();
    }
    context.fillStyle = '#121a24';
    roundedRect(context, -6 + Math.sin(phase * 2) * 1.5, -14, 12, 14, 6);
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
  drawHeavyBot(context, style, phase, engine, robot, hitFlash, stunned, motion = { flinch: 0, menace: 0 }) {
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
    // 어깨 장갑: 걸음마다 번갈아 들썩이고, 맞으면 몸 쪽으로 움츠려 막는다. 가까워지면 양쪽을 치켜든다
    const brace = motion.flinch * 5;
    const lift = motion.menace * 7;
    roundedRect(context, -width / 2 - 8 + brace, -height + 8 - Math.max(0, Math.sin(phase)) * 3 - lift, 12, 22, 4);
    context.fill();
    roundedRect(context, width / 2 - 4 - brace, -height + 8 - Math.max(0, -Math.sin(phase)) * 3 - lift, 12, 22, 4);
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
    // 가슴 환기구: 숨 쉬듯 밝아졌다 어두워진다(가까워지면 붉게)
    const breath = 0.3 + 0.25 * Math.sin(engine.gameTime * 3 + robot.id);
    context.fillStyle = motion.menace > 0.3 ? `rgba(255, 77, 109, ${breath + 0.2})` : `rgba(138, 152, 170, ${breath})`;
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

  // 느린 로봇 '달팽봇'(정면): 납작한 몸이 꿈틀대며 기어오고, 등에 소용돌이 껍데기, 더듬이 끝에 눈.
  // 한 방 맞으면 껍데기에 금이 간다. 머리 위 칸은 남은 체력(휴대폰 두 방)
  drawSnailBot(context, style, phase, engine, robot, hitFlash, stunned, motion = { flinch: 0, menace: 0 }) {
    const { width, height } = style;
    const crawl = Math.sin(phase) * 5;
    // 몸통(바닥에 붙은 납작한 발)
    context.fillStyle = hitFlash ? '#ffffff' : style.body;
    roundedRect(context, -width / 2 - crawl / 2, -12, width + crawl, 12, 6);
    context.fill();
    // 껍데기
    const shellRadius = height * 0.42;
    // 껍데기는 몸보다 한 박자 늦게 출렁인다
    const shellY = -12 - shellRadius * 0.85 + Math.sin(phase - 0.9) * 1.8;
    const shellGradient = context.createRadialGradient(-6, shellY - 6, 2, 0, shellY, shellRadius);
    shellGradient.addColorStop(0, style.shellLight);
    shellGradient.addColorStop(1, style.shell);
    context.fillStyle = hitFlash ? '#ffffff' : shellGradient;
    context.beginPath();
    context.arc(0, shellY, shellRadius, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = 'rgba(70, 40, 18, 0.75)';
    context.lineWidth = 2.5;
    context.beginPath();
    for (let step = 0; step <= 40; step++) {
      const angle = step * 0.42 + engine.gameTime * 0.6;
      const radius = shellRadius * 0.85 * (1 - step / 44);
      const pointX = Math.cos(angle) * radius;
      const pointY = shellY + Math.sin(angle) * radius;
      if (step === 0) context.moveTo(pointX, pointY);
      else context.lineTo(pointX, pointY);
    }
    context.stroke();
    if (robot.hp < robot.maxHp) {
      context.strokeStyle = '#2a1608';
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(-shellRadius * 0.2, shellY - shellRadius);
      context.lineTo(shellRadius * 0.05, shellY - shellRadius * 0.45);
      context.lineTo(-shellRadius * 0.25, shellY - shellRadius * 0.1);
      context.lineTo(shellRadius * 0.15, shellY + shellRadius * 0.4);
      context.stroke();
    }
    // 앞머리와 더듬이 눈
    context.fillStyle = hitFlash ? '#ffffff' : style.bodyLight;
    roundedRect(context, -13, -24, 26, 16, 7);
    context.fill();
    context.strokeStyle = style.bodyLight;
    context.lineWidth = 3;
    context.lineCap = 'round';
    const sway = Math.sin(engine.gameTime * 2 + robot.id) * 3;
    // 맞으면 더듬이 눈을 쏙 움츠린다. 가까워지면 꼿꼿이 세운다
    const stalk = -40 + motion.flinch * 15 - motion.menace * 4;
    const eyes = [[-9 + sway, stalk], [9 + sway, stalk]];
    for (const [eyeX, eyeY] of eyes) {
      context.beginPath();
      context.moveTo(eyeX * 0.6 - sway * 0.5, -22);
      context.lineTo(eyeX, eyeY);
      context.stroke();
    }
    context.fillStyle = '#0b1017';
    for (const [eyeX, eyeY] of eyes) {
      context.beginPath();
      context.arc(eyeX, eyeY, 4.5, 0, Math.PI * 2);
      context.fill();
    }
    this.drawEyes(context, eyes, 3, style.eye, { blink: this.isBlinking(engine, robot), stunned });
    const pipWidth = 34 / robot.maxHp;
    for (let pip = 0; pip < robot.maxHp; pip++) {
      context.fillStyle = pip < robot.hp ? style.eye : '#2b3442';
      roundedRect(context, -17 + pip * pipWidth, -height - 10, pipWidth - 3, 5, 2);
      context.fill();
    }
  }

  // 보스 '서버봇'(정면): 궤도 다리 두 짝 위에 역사다리꼴 서버랙 몸통, 가슴 대포, 큰 어깨 포드와 동그란 손이 달린 팔, 뿔 달린 머리와 왕관.
  // 움직임: 쿵쿵 걷는 흔들림, 팔 흔들기, 대포 충전(팔을 벌려 버티고 포구에 빛이 모임), 발사 반동,
  // 맞으면 뒤로 젖혀짐, 체력 3 이하면 붉게 달아오른다. spread는 어깨·팔을 옆으로 벌리는 정도
  drawBossBot(context, style, phase, engine, robot, hitFlash, stunned, spread = 1) {
    const time = engine.gameTime;
    const charge = robot.chargeUntil != null
      ? 1 - Math.max(0, robot.chargeUntil - time) / BOSS_RULES.cannonChargeSeconds : 0;
    const sinceFire = time - (robot.firedAt ?? -Infinity);
    const recoil = sinceFire < 0.35 ? Math.sin((sinceFire / 0.35) * Math.PI) : 0;
    const sinceHit = time - robot.hitAt;
    const flinch = sinceHit < 0.3 ? Math.sin((sinceHit / 0.3) * Math.PI) : 0;
    const enraged = robot.hp <= 3;
    const pulse = 0.5 + 0.5 * Math.sin(time * (enraged ? 9 : 4));
    // 펀치(근접): windup 0→1 팔을 어깨 뒤로 당겨 주먹을 쥠 → strike 0→1 곧게 내지름(명중 순간 1) → 맞힌 뒤 retract 0→1 거둠.
    // 팔은 펀치마다 번갈아 쓴다
    const punchSide = (robot.punchCount ?? 1) % 2 === 1 ? 1 : -1;
    const windupTime = robot.punchStartAt != null ? time - robot.punchStartAt : -1;
    const pullSeconds = BOSS_RULES.punchWindupSeconds * 0.82;
    const windup = windupTime < 0 ? 0 : easeOutCubic(Math.min(1, windupTime / pullSeconds));
    const strike = windupTime < pullSeconds ? 0
      : Math.min(1, (windupTime - pullSeconds) / (BOSS_RULES.punchWindupSeconds - pullSeconds)) ** 2;
    const sincePunch = time - (robot.punchedAt ?? -Infinity);
    const retract = sincePunch < 0.45 ? sincePunch / 0.45 : -1;
    const punching = windupTime >= 0 || retract >= 0;
    const walk = robot.inMelee ? Math.sin(time * 2) * 0.25 : Math.sin(phase);
    const paint = color => (hitFlash ? '#ffffff' : color);
    const podX = 104 * spread;

    // 붉은 기운(타원)
    context.save();
    context.scale(1.5 * spread, 1);
    const aura = context.createRadialGradient(0, -80, 10, 0, -80, 130);
    aura.addColorStop(0, `rgba(255, 51, 85, ${(enraged ? 0.34 : 0.18) + pulse * 0.14 + charge * 0.2})`);
    aura.addColorStop(1, 'rgba(255, 51, 85, 0)');
    context.fillStyle = aura;
    context.beginPath();
    context.arc(0, -80, 130, 0, Math.PI * 2);
    context.fill();
    context.restore();

    // 궤도 다리 두 짝: 걸음마다 번갈아 살짝 들린다
    for (const side of [-1, 1]) {
      const lift = Math.max(0, side * walk) * 3;
      context.fillStyle = '#12151d';
      roundedRect(context, side * 52 - 40, -26 - lift, 80, 26, 11);
      context.fill();
      context.strokeStyle = '#3c4454';
      context.lineWidth = 2;
      context.stroke();
      for (let wheel = -1; wheel <= 1; wheel++) {
        context.fillStyle = '#3c4454';
        context.beginPath();
        context.arc(side * 52 + wheel * 24, -13 - lift, 7, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = '#12151d';
        context.beginPath();
        context.arc(side * 52 + wheel * 24, -13 - lift, 2.5, 0, Math.PI * 2);
        context.fill();
      }
      // 다리 기둥
      context.fillStyle = style.metal;
      roundedRect(context, side * 44 - 11, -46, 22, 24 - lift, 5);
      context.fill();
    }

    // 위몸: 걸음 흔들림 + 발사 반동 + 맞으면 뒤로 젖혀짐
    context.save();
    // 몸도 펀치를 따라 뒤로 젖혔다가(windup) 앞으로 쏠린다(strike·retract 초반)
    const lunge = retract >= 0 ? 1 - retract : strike;
    context.translate(0, -Math.abs(walk) * 2.5 - recoil * 6 - windup * (1 - strike) * 8 + lunge * 12);
    context.rotate(walk * 0.012 - flinch * 0.05 - punchSide * windup * (1 - strike) * 0.07 + punchSide * lunge * 0.06);

    // 팔(어깨 포드에서 동그란 손까지) — 몸통보다 먼저 그려 뒤에 오게. 펀치하는 오른팔은 맨 앞에 따로 그린다
    for (const side of [-1, 1]) {
      if (side === punchSide && punching) continue;
      const swing = side * walk * 7;
      const brace = charge * 16 + recoil * 12;
      const elbow = { x: side * (podX + 22 + brace * 0.6), y: -74 };
      const hand = { x: side * (podX + 34 + brace), y: -36 + swing - brace * 0.5 };
      this.drawBossArm(context, style, { x: side * podX, y: -92 }, elbow, hand, 14, paint);
    }

    // 허리
    context.fillStyle = style.metal;
    roundedRect(context, -42, -56, 84, 16, 5);
    context.fill();

    // 몸통: 어깨가 넓은 역사다리꼴 서버랙
    const torso = context.createLinearGradient(0, -128, 0, -50);
    torso.addColorStop(0, enraged ? `rgb(${160 + pulse * 60}, 44, 70)` : style.bodyLight);
    torso.addColorStop(1, style.body);
    context.fillStyle = paint(torso);
    context.beginPath();
    context.moveTo(-84, -116);
    context.quadraticCurveTo(-84, -128, -72, -128);
    context.lineTo(72, -128);
    context.quadraticCurveTo(84, -128, 84, -116);
    context.lineTo(62, -58);
    context.quadraticCurveTo(60, -50, 50, -50);
    context.lineTo(-50, -50);
    context.quadraticCurveTo(-60, -50, -62, -58);
    context.closePath();
    context.fill();
    context.strokeStyle = style.trim;
    context.lineWidth = 3;
    context.stroke();
    // 랙 칸과 LED(대포 양옆 3칸씩, 아래로 갈수록 좁아짐)
    for (const side of [-1, 1]) {
      for (let row = 0; row < 3; row++) {
        const slotY = -118 + row * 17;
        const slotWidth = 36 - row * 5;
        const slotX = side > 0 ? 32 : -32 - slotWidth;
        context.fillStyle = 'rgba(8, 10, 18, 0.72)';
        roundedRect(context, slotX, slotY, slotWidth, 11, 3);
        context.fill();
        for (let led = 0; led < Math.floor((slotWidth - 6) / 8); led++) {
          const on = Math.sin(time * (3 + row) + led * 1.7 + side) > 0.2;
          context.fillStyle = on ? (enraged ? '#ff5d73' : row % 2 ? '#4df0a6' : '#ffb547') : '#22283a';
          context.fillRect(slotX + 4 + led * 8, slotY + 4, 4, 3);
        }
      }
    }
    // 가슴 대포: 금테 포신 + 안쪽 고리, 충전되면 포구에 빛이 모인다
    context.fillStyle = '#0c0f17';
    context.beginPath();
    context.arc(0, -90, 25, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = style.trim;
    context.lineWidth = 5;
    context.stroke();
    context.strokeStyle = '#555f73';
    context.lineWidth = 2.5;
    context.beginPath();
    context.arc(0, -90, 16, 0, Math.PI * 2);
    context.stroke();
    context.beginPath();
    context.arc(0, -90, 8, 0, Math.PI * 2);
    context.stroke();
    const glow = Math.max(charge, recoil);
    if (glow > 0) {
      context.shadowColor = '#36e2ff';
      context.shadowBlur = 12 + glow * 34;
      context.fillStyle = `rgba(160, 240, 255, ${0.35 + glow * 0.65})`;
      context.beginPath();
      context.arc(0, -90, 5 + glow * 13, 0, Math.PI * 2);
      context.fill();
      context.shadowBlur = 0;
    }

    // 어깨 포드: 몸통과 이음쇠로 연결된 큰 장갑. 위에 경고등, 앞면에 줄무늬
    for (const side of [-1, 1]) {
      context.fillStyle = style.metal;
      context.fillRect(Math.min(side * 78, side * podX), -112, Math.abs(podX - 78), 12);
      const pod = context.createLinearGradient(0, -134, 0, -84);
      pod.addColorStop(0, style.metalLight);
      pod.addColorStop(1, style.metal);
      context.fillStyle = paint(pod);
      roundedRect(context, side * podX - 30, -134, 60, 50, 14);
      context.fill();
      context.strokeStyle = style.trim;
      context.lineWidth = 2.5;
      context.stroke();
      context.fillStyle = paint(style.bodyLight);
      for (let stripe = 0; stripe < 3; stripe++) roundedRect(context, side * podX - 18, -112 + stripe * 8, 36, 4, 2), context.fill();
      context.fillStyle = pulse > 0.5 ? '#ff3355' : '#5a1020';
      context.shadowColor = '#ff3355';
      context.shadowBlur = pulse * 14;
      context.beginPath();
      context.arc(side * podX, -124, 5, 0, Math.PI * 2);
      context.fill();
      context.shadowBlur = 0;
    }

    // 머리: 목, 뿔 안테나, 바이저와 화난 눈, 왕관. 몸보다 살짝 늦게 끄덕인다
    context.translate(0, Math.sin(phase - 0.6) * 1.5);
    context.fillStyle = style.metal;
    context.fillRect(-12, -134, 24, 8);
    for (const side of [-1, 1]) {
      context.strokeStyle = style.metalLight;
      context.lineWidth = 5;
      context.lineCap = 'round';
      context.beginPath();
      context.moveTo(side * 30, -146);
      context.lineTo(side * 44, -158);
      context.stroke();
      context.fillStyle = pulse > 0.5 ? '#ff3355' : '#5a1020';
      context.beginPath();
      context.arc(side * 44, -158, 3.5, 0, Math.PI * 2);
      context.fill();
    }
    context.fillStyle = paint(style.metalLight);
    roundedRect(context, -34, -160, 68, 30, 11);
    context.fill();
    context.strokeStyle = style.trim;
    context.lineWidth = 2;
    context.stroke();
    context.fillStyle = '#0b0e16';
    roundedRect(context, -27, -153, 54, 15, 6);
    context.fill();
    this.drawEyes(context, [[-12, -146], [12, -146]], 5, style.eye, { blink: false, stunned, angry: true });
    // 입(환기구)
    context.fillStyle = '#0b0e16';
    for (let slit = -2; slit <= 2; slit++) context.fillRect(slit * 6 - 1.5, -136, 3, 4);
    const crownY = -160;
    context.fillStyle = paint(style.trim);
    context.beginPath();
    context.moveTo(-22, crownY);
    context.lineTo(-24, crownY - 14);
    context.lineTo(-11, crownY - 6);
    context.lineTo(0, crownY - 20);
    context.lineTo(11, crownY - 6);
    context.lineTo(24, crownY - 14);
    context.lineTo(22, crownY);
    context.closePath();
    context.fill();
    context.fillStyle = '#ff3355';
    for (const gemX of [-11, 0, 11]) {
      context.beginPath();
      context.arc(gemX, crownY - 4, 2.4, 0, Math.PI * 2);
      context.fill();
    }
    // 펀치하는 팔(맨 앞): 쉬는 자리 → 어깨 옆 뒤로 당김 → 가운데 아래(플레이어)로 곧게 내지름 → 다시 쉬는 자리.
    // 손은 당길 때 조금, 내지를 때 화면 앞으로 다가오듯 크게 커진다
    if (punching) {
      const mix = (from, to, amount) => ({ x: from.x + (to.x - from.x) * amount, y: from.y + (to.y - from.y) * amount });
      const rest = { x: punchSide * (podX + 34), y: -36 };
      const back = { x: punchSide * (podX + 46), y: -112 };
      const out = { x: punchSide * 6, y: 36 };
      let hand;
      let grow;
      if (retract >= 0) {
        const eased = easeOutCubic(retract);
        hand = mix(out, rest, eased);
        grow = 3.2 - 2.2 * eased;
      } else {
        hand = mix(mix(rest, back, windup), out, strike);
        grow = 1 + windup * 0.35 + strike * 1.85;
      }
      const shoulder = { x: punchSide * podX, y: -92 };
      // 팔꿈치: 당길 땐 바깥으로 접히고, 뻗을수록 어깨–손 직선에 가까워진다
      const middle = mix(shoulder, hand, 0.5);
      const bend = (retract >= 0 ? retract : 1 - strike) * 22;
      const elbow = { x: middle.x + punchSide * bend, y: middle.y - bend * 0.4 };
      if (strike > 0.05 && retract < 0) {
        const tail = mix(back, out, Math.max(0, strike - 0.4));
        context.strokeStyle = 'rgba(255, 207, 90, 0.3)';
        context.lineWidth = 14 * grow * 1.5;
        context.lineCap = 'round';
        context.beginPath();
        context.moveTo(tail.x, tail.y);
        context.lineTo(hand.x, hand.y);
        context.stroke();
      }
      this.drawBossArm(context, style, shoulder, elbow, hand, 14 * grow, paint);
    }
    context.restore();
  }

  // 보스 팔 한 쪽: 어깨→팔꿈치→손 금속 팔, 팔꿈치 관절, 끝에 금색 동그란 손(handRadius)
  drawBossArm(context, style, shoulder, elbow, hand, handRadius, paint) {
    context.strokeStyle = style.metal;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.lineWidth = 15;
    context.beginPath();
    context.moveTo(shoulder.x, shoulder.y);
    context.lineTo(elbow.x, elbow.y);
    context.lineTo(hand.x, hand.y);
    context.stroke();
    context.fillStyle = style.metalLight;
    context.beginPath();
    context.arc(elbow.x, elbow.y, 7, 0, Math.PI * 2);
    context.fill();
    const shine = context.createRadialGradient(hand.x - handRadius * 0.35, hand.y - handRadius * 0.35, handRadius * 0.1, hand.x, hand.y, handRadius);
    shine.addColorStop(0, '#fff1c2');
    shine.addColorStop(1, style.trim);
    context.fillStyle = paint(shine);
    context.beginPath();
    context.arc(hand.x, hand.y, handRadius, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = '#b8862c';
    context.lineWidth = Math.max(2, handRadius * 0.12);
    context.stroke();
  }

  // ---------- 특수 로봇·보스 꾸밈 ----------
  // 낱말 표시용 사본: 거울봇은 글자와 상태를 거꾸로, 해커봇의 화면 가리기 중에는 아직 안 친 글자 일부를 '?'로(첫 글자는 남겨 조준은 되게)
  labelView(entity, states, engine) {
    let text = entity.token.text;
    let shownStates = states;
    if (engine.isMasked?.()) {
      text = [...text].map((character, index) => (index > 0 && states[index] === 'pending' && (index + entity.id) % 2 === 0 ? '?' : character)).join('');
    }
    if (entity.mirror) {
      text = [...text].reverse().join('');
      shownStates = [...states].reverse();
    }
    if (text === entity.token.text && shownStates === states) return [entity, states];
    return [{ ...entity, token: { ...entity.token, text } }, shownStates];
  }

  // 카멜레온봇: 몸 색이 천천히 무지개로 돌고, 낱말이 바뀐 직후 번쩍
  chameleonStyle(style, engine, robot) {
    const hue = (engine.gameTime * 60 + robot.id * 47) % 360;
    const morphed = engine.gameTime - (robot.morphedAt ?? -Infinity) < 0.25;
    return { ...style, body: `hsl(${hue} 45% ${morphed ? 70 : 32}%)`, bodyLight: `hsl(${(hue + 30) % 360} 60% ${morphed ? 85 : 52}%)`, trim: `hsl(${(hue + 180) % 360} 90% 75%)` };
  }

  // 방패봇: 몸 앞에 육각 방패(맞으면 금이 가고, 체력이 1이면 반쯤 깨진 모양)
  drawShieldPlate(context, style, engine, robot, hitFlash) {
    const { height } = style;
    const cracked = robot.hp < robot.maxHp;
    const glow = 0.5 + 0.5 * Math.sin(engine.gameTime * 4 + robot.id);
    context.save();
    context.translate(0, -height * 0.45);
    context.beginPath();
    for (let corner = 0; corner < 6; corner++) {
      const angle = Math.PI / 6 + corner * Math.PI / 3;
      context[corner ? 'lineTo' : 'moveTo'](Math.cos(angle) * 26, Math.sin(angle) * 30);
    }
    context.closePath();
    context.fillStyle = hitFlash ? '#ffffff' : `rgba(127, 227, 255, ${0.22 + glow * 0.12})`;
    context.fill();
    context.lineWidth = 3;
    context.strokeStyle = style.trim;
    context.shadowColor = style.eye;
    context.shadowBlur = 10;
    context.stroke();
    context.shadowBlur = 0;
    if (cracked) {
      context.strokeStyle = '#ffffff';
      context.lineWidth = 1.6;
      context.beginPath();
      context.moveTo(-4, -22); context.lineTo(3, -6); context.lineTo(-6, 6); context.lineTo(5, 20);
      context.moveTo(3, -6); context.lineTo(14, -2);
      context.stroke();
    }
    context.restore();
  }

  // 분열봇: 몸 가운데로 갈라질 듯 빛나는 이음선(쓰러지면 둘로 나뉜다는 표시)
  drawSplitSeam(context, style, engine, robot) {
    const { height } = style;
    const pulse = 0.5 + 0.5 * Math.sin(engine.gameTime * 6 + robot.id);
    context.save();
    context.strokeStyle = style.eye;
    context.globalAlpha = 0.6 + pulse * 0.4;
    context.lineWidth = 2.5;
    context.setLineDash([4, 3]);
    context.beginPath();
    context.moveTo(0, -height - 2);
    context.lineTo(0, -6);
    context.stroke();
    context.setLineDash([]);
    context.restore();
  }

  // 쌍둥이봇: 머리 위 ♊ 표시
  drawTwinMark(context, style, engine, robot) {
    context.save();
    context.fillStyle = style.trim;
    context.font = canvasFont(13, 'ui', 700);
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('♊', 0, -style.height - 22 + Math.sin(engine.gameTime * 4 + robot.id) * 2);
    context.restore();
  }

  // 거울봇: 얼굴 화면 위로 비스듬한 반사광이 지나간다
  drawMirrorSheen(context, style, engine) {
    const { width, height } = style;
    const sweep = ((engine.gameTime * 0.8) % 1.6) - 0.3;
    context.save();
    roundedRect(context, -width / 2 + 5, -height + 3, width - 10, height * 0.48 - 10, 5);
    context.clip();
    context.fillStyle = 'rgba(255, 255, 255, 0.45)';
    context.beginPath();
    const x = -width / 2 + sweep * width;
    context.moveTo(x, -height); context.lineTo(x + 8, -height); context.lineTo(x - 4, -height * 0.4); context.lineTo(x - 12, -height * 0.4);
    context.fill();
    context.restore();
  }

  // 쌍둥이 둘을 잇는 분홍 점선(같은 낱말이라는 표시)
  drawTwinLinks(context, engine) {
    const drawn = new Set();
    for (const robot of engine.robots) {
      if (robot.twinId == null || robot.state !== 'walking' || drawn.has(robot.id)) continue;
      const twin = engine.robots.find(other => other.id === robot.twinId && other.state === 'walking');
      if (!twin) continue;
      drawn.add(twin.id);
      const from = { x: this.columnX(robot.lane), y: this.toY(robot.x) - 30 * this.depthScale(robot.x) };
      const to = { x: this.columnX(twin.lane), y: this.toY(twin.x) - 30 * this.depthScale(twin.x) };
      context.save();
      context.strokeStyle = 'rgba(255, 179, 230, 0.7)';
      context.lineWidth = 2;
      context.setLineDash([6, 6]);
      context.lineDashOffset = -engine.gameTime * 30;
      context.beginPath();
      context.moveTo(from.x, from.y);
      context.lineTo(to.x, to.y);
      context.stroke();
      context.restore();
    }
  }

  // 화면 가리기 중: 초록 잡음 줄이 화면을 훑고 가장자리가 어두워진다
  drawMaskStatic(context, width, height, engine) {
    context.save();
    context.fillStyle = 'rgba(0, 20, 8, 0.18)';
    context.fillRect(0, 0, width, height);
    context.fillStyle = 'rgba(57, 255, 136, 0.08)';
    for (let line = 0; line < 6; line++) {
      const y = ((engine.gameTime * 140 + line * 97) % height);
      context.fillRect(0, y, width, 2 + (line % 3));
    }
    context.restore();
  }

  // 프린터봇이 뱉은 종이: 팔랑이며 떨어지는 A4(두루마리는 길게 말린 종이)
  drawPaperPad(context, pad, engine, x, y, scale) {
    const age = engine.gameTime - pad.firedAt;
    context.save();
    context.translate(x + Math.sin(age * 5 + pad.id) * 6 * scale, y);
    context.scale(scale, scale);
    context.rotate(Math.sin(age * 4 + pad.id) * 0.35);
    context.shadowColor = '#ffb547';
    context.shadowBlur = 10;
    if (pad.scroll) {
      context.fillStyle = '#f4efe2';
      roundedRect(context, -26, -10, 52, 20, 9);
      context.fill();
      context.shadowBlur = 0;
      context.fillStyle = '#d9cfb8';
      context.beginPath(); context.ellipse(-26, 0, 6, 10, 0, 0, Math.PI * 2); context.fill();
      context.beginPath(); context.ellipse(26, 0, 6, 10, 0, 0, Math.PI * 2); context.fill();
    } else {
      context.fillStyle = '#fbfbf8';
      context.beginPath();
      context.moveTo(-14, -18); context.lineTo(8, -18); context.lineTo(14, -12); context.lineTo(14, 18); context.lineTo(-14, 18);
      context.closePath();
      context.fill();
      context.shadowBlur = 0;
      context.fillStyle = '#d6d6cf';
      context.beginPath(); context.moveTo(8, -18); context.lineTo(8, -12); context.lineTo(14, -12); context.fill();
      context.fillStyle = '#9aa0ac';
      for (let row = 0; row < 5; row++) context.fillRect(-10, -10 + row * 5.5, row % 2 ? 16 : 20, 1.6);
    }
    context.restore();
  }

  // 보스 프린터봇(로컬 좌표: 발 y=0, 키 약 168): 큰 복합기 몸통, 위 스캐너 뚜껑 사이로 훑는 빛, 가운데 LCD 얼굴,
  // 아래 배출구에서 종이가 혀처럼 나오고, 기술을 모으면 배출구가 붉게 달아오르며 종이가 떨린다
  drawPrinterBoss(context, style, phase, engine, robot, hitFlash) {
    const time = engine.gameTime;
    const charge = robot.chargeUntil != null ? 1 - Math.max(0, robot.chargeUntil - time) / BOSS_RULES.cannonChargeSeconds : 0;
    const paint = color => (hitFlash ? '#ffffff' : color);
    const enraged = robot.hp <= 3;
    const lean = robot.punchStartAt != null ? Math.min(1, (time - robot.punchStartAt) / BOSS_RULES.punchWindupSeconds) : 0;
    const walk = Math.sin(phase);
    context.save();
    context.translate(0, -lean * 10);
    // 다리 바퀴
    context.fillStyle = '#1b1e27';
    for (const side of [-1, 1]) {
      roundedRect(context, side * 70 - 22, -26 + Math.max(0, side * walk) * 4, 44, 26, 10);
      context.fill();
      context.fillStyle = '#ffb547';
      context.fillRect(side * 70 - 14, -8, 28, 3);
      context.fillStyle = '#1b1e27';
    }
    // 몸통
    const body = context.createLinearGradient(0, -150, 0, -24);
    body.addColorStop(0, paint(style.bodyLight));
    body.addColorStop(1, paint('#9aa0ac'));
    context.fillStyle = body;
    roundedRect(context, -120, -150, 240, 128, 16);
    context.fill();
    context.strokeStyle = style.body;
    context.lineWidth = 4;
    context.stroke();
    // 스캐너 뚜껑(위)과 훑는 빛
    context.fillStyle = paint(style.body);
    roundedRect(context, -128, -168, 256, 24, 8);
    context.fill();
    const scanX = -110 + ((time * 0.9) % 1) * 220;
    context.fillStyle = `rgba(120, 255, 210, ${0.5 + 0.3 * Math.sin(time * 10)})`;
    context.fillRect(scanX, -146, 6, 8);
    // LCD 얼굴
    context.fillStyle = '#0b1420';
    roundedRect(context, -64, -132, 128, 52, 8);
    context.fill();
    const eyeColor = enraged ? '#ff3355' : '#7fe3ff';
    context.fillStyle = eyeColor;
    context.shadowColor = eyeColor;
    context.shadowBlur = 10;
    const blink = Math.sin(time * 1.7 + 1) > 0.96;
    for (const side of [-1, 1]) {
      context.save();
      context.translate(side * 26, -108);
      context.rotate(side * (enraged ? 0.35 : 0.18));
      context.fillRect(-14, blink ? -1 : -6, 28, blink ? 2 : 12);
      context.restore();
    }
    context.shadowBlur = 0;
    context.fillStyle = eyeColor;
    context.font = canvasFont(10, 'code', 700);
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(enraged ? 'PAPER JAM!!' : charge > 0 ? 'PRINTING…' : 'READY', 0, -88);
    // 배출구 + 혀처럼 나온 종이
    context.fillStyle = '#1b1e27';
    roundedRect(context, -80, -72, 160, 16, 6);
    context.fill();
    if (charge > 0) {
      context.fillStyle = `rgba(255, 90, 60, ${0.3 + charge * 0.6})`;
      roundedRect(context, -80, -72, 160, 16, 6);
      context.fill();
    }
    const tongue = 18 + Math.sin(time * 3) * 4 + charge * 26;
    context.fillStyle = paint('#fbfbf8');
    context.beginPath();
    context.moveTo(-50, -60);
    context.lineTo(50, -60);
    context.lineTo(46 + Math.sin(time * 9) * charge * 4, -60 + tongue);
    context.lineTo(-46 - Math.sin(time * 9) * charge * 4, -60 + tongue);
    context.closePath();
    context.fill();
    context.fillStyle = '#b8bcc6';
    for (let row = 0; row < 3; row++) context.fillRect(-36, -54 + row * 6, row === 1 ? 50 : 70, 2);
    // 옆 용지함 팔(종이 뭉치를 쥔 집게)
    for (const side of [-1, 1]) {
      const swing = Math.sin(time * 2 + side) * 6 - charge * 10 * side;
      context.strokeStyle = style.metal;
      context.lineWidth = 12;
      context.lineCap = 'round';
      context.beginPath();
      context.moveTo(side * 118, -110);
      context.lineTo(side * 150, -80 + swing);
      context.lineTo(side * 160, -46 + swing);
      context.stroke();
      context.fillStyle = paint('#fbfbf8');
      context.save();
      context.translate(side * 160, -40 + swing);
      context.rotate(side * 0.2);
      roundedRect(context, -14, -10, 28, 20, 3);
      context.fill();
      context.restore();
    }
    // 토너 램프
    context.fillStyle = enraged ? (Math.sin(time * 12) > 0 ? '#ff3355' : '#5a1020') : '#4df0a6';
    context.beginPath();
    context.arc(96, -136, 5, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  // 보스 해커봇(로컬 좌표): 후드 쓴 몸통, 얼굴은 초록 터미널 화면(눈은 '> <', 입은 흐르는 코드),
  // 양옆에 떠 있는 홀로그램 키보드를 두드리고, 기술을 모으거나 맞으면 몸이 가로 줄무늬로 지직 어긋난다
  drawHackerBoss(context, style, phase, engine, robot, hitFlash) {
    const time = engine.gameTime;
    const charge = robot.chargeUntil != null ? 1 - Math.max(0, robot.chargeUntil - time) / BOSS_RULES.cannonChargeSeconds : 0;
    const glitch = charge > 0 || time - robot.hitAt < 0.3 || robot.hp <= 3;
    const paint = color => (hitFlash ? '#ffffff' : color);
    const bob = Math.sin(time * 2) * 4;
    context.save();
    context.translate(0, bob - 10);
    // 그림자처럼 떠 있는 발 대신 아래로 흩어지는 코드 꼬리
    context.fillStyle = 'rgba(57, 255, 136, 0.5)';
    context.font = canvasFont(10, 'code', 700);
    context.textAlign = 'center';
    for (let column = -3; column <= 3; column++) {
      const drop = (time * 60 + column * 23) % 40;
      context.fillText(column % 2 ? '1' : '0', column * 16, -4 + drop * 0.6);
    }
    // 후드 몸통(사다리꼴)
    const body = context.createLinearGradient(0, -168, 0, -10);
    body.addColorStop(0, paint(style.bodyLight));
    body.addColorStop(1, paint(style.body));
    context.fillStyle = body;
    context.beginPath();
    context.moveTo(-60, -158);
    context.quadraticCurveTo(0, -176, 60, -158);
    context.lineTo(96, -20);
    context.lineTo(-96, -20);
    context.closePath();
    context.fill();
    context.strokeStyle = style.trim;
    context.lineWidth = 2;
    context.globalAlpha = 0.6;
    context.stroke();
    context.globalAlpha = 1;
    // 얼굴 화면
    context.fillStyle = '#020a05';
    roundedRect(context, -44, -150, 88, 62, 10);
    context.fill();
    context.fillStyle = style.eye;
    context.shadowColor = style.eye;
    context.shadowBlur = 12;
    context.font = canvasFont(20, 'code', 700);
    context.textBaseline = 'middle';
    context.fillText(robot.hp <= 3 ? '> <' : charge > 0 ? 'ಠ ಠ' : '^ ^', 0, -130);
    context.shadowBlur = 0;
    context.font = canvasFont(8, 'code', 700);
    const code = 'sudo rm -rf /typing && echo pwned ';
    const offset = Math.floor(time * 8) % code.length;
    context.fillText((code + code).slice(offset, offset + 14), 0, -102);
    // 가슴 해골 대신 자물쇠 깨진 아이콘
    context.fillStyle = style.trim;
    context.font = canvasFont(22, 'ui', 700);
    context.fillText('🔓', 0, -58);
    // 홀로그램 키보드 두 개(손이 두드린다)
    for (const side of [-1, 1]) {
      context.save();
      context.translate(side * 130, -70 + Math.sin(time * 3 + side) * 5);
      context.rotate(side * -0.25);
      context.fillStyle = 'rgba(57, 255, 136, 0.15)';
      context.strokeStyle = 'rgba(57, 255, 136, 0.8)';
      context.lineWidth = 1.5;
      roundedRect(context, -40, -14, 80, 28, 4);
      context.fill();
      context.stroke();
      for (let key = 0; key < 12; key++) {
        const lit = Math.sin(time * 14 + key * 2.3 + side) > 0.6;
        context.fillStyle = lit ? '#39ff88' : 'rgba(57, 255, 136, 0.35)';
        context.fillRect(-36 + (key % 6) * 12.5, -10 + Math.floor(key / 6) * 11, 10, 8);
      }
      context.restore();
      context.strokeStyle = paint(style.metal);
      context.lineWidth = 10;
      context.lineCap = 'round';
      context.beginPath();
      context.moveTo(side * 70, -110);
      context.lineTo(side * 108, -88 + Math.sin(time * 14 + side) * 4);
      context.stroke();
    }
    context.restore();
    // 지직: 몸을 가로띠로 잘라 옆으로 밀어 그린 것처럼(밝은 띠를 덧그린다)
    if (glitch) {
      context.save();
      for (let band = 0; band < 4; band++) {
        const y = -170 + ((time * 300 + band * 47) % 160);
        context.fillStyle = band % 2 ? 'rgba(255, 51, 85, 0.35)' : 'rgba(57, 255, 136, 0.35)';
        context.fillRect(-100 + Math.sin(time * 40 + band) * 14, y, 200, 4 + band);
      }
      context.restore();
    }
  }

  // 보스가 쏜 패드: 빙글 돌며 대포에서 곧장 날아오고, 뒤로 빛줄기가 남는다. 아래에 막을 낱말
  drawPad(context, pad, engine) {
    const x = this.columnX(pad.lane);
    const y = this.toY(pad.x) - 30 * this.depthScale(pad.x);
    const scale = this.depthScale(pad.x) * 1.15;
    const boss = engine.boss();
    if (!pad.consumed && boss) {
      const from = this.bossCannonPoint(boss);
      const streak = context.createLinearGradient(x, y, x, Math.min(from.y, y - 10));
      streak.addColorStop(0, 'rgba(54, 226, 255, 0.55)');
      streak.addColorStop(1, 'rgba(54, 226, 255, 0)');
      context.strokeStyle = streak;
      context.lineWidth = 10 * scale;
      context.lineCap = 'round';
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(x, Math.max(from.y, y - 120));
      context.stroke();
    }
    if (pad.paper) {
      this.drawPaperPad(context, pad, engine, x, y, scale);
      if (!pad.consumed) {
        const [shown, states] = this.labelView(pad, engine.getCharacterStates(pad), engine);
        drawTokenLabel(context, x, y + 34 * scale, shown, states, { active: pad.id === engine.targetId, accent: '#ffb547', compact: this.surface.width < 520 });
      }
      return;
    }
    context.save();
    context.translate(x, y);
    context.scale(scale, scale);
    context.rotate((engine.gameTime - pad.firedAt) * 9);
    context.shadowColor = '#36e2ff';
    context.shadowBlur = 16;
    context.fillStyle = '#1b2233';
    roundedRect(context, -18, -13, 36, 26, 5);
    context.fill();
    context.shadowBlur = 0;
    context.strokeStyle = '#9aa6b8';
    context.lineWidth = 2;
    context.stroke();
    const screen = context.createLinearGradient(-14, -10, 14, 10);
    screen.addColorStop(0, '#36e2ff');
    screen.addColorStop(1, '#c792ea');
    context.fillStyle = screen;
    roundedRect(context, -14, -9, 28, 18, 3);
    context.fill();
    context.restore();
    if (!pad.consumed) {
      const [shown, states] = this.labelView(pad, engine.getCharacterStates(pad), engine);
      drawTokenLabel(context, x, y + 34 * scale, shown, states, {
        active: pad.id === engine.targetId, accent: '#ff5d73', compact: this.surface.width < 520
      });
    }
  }

  // 보스전 화면 위 표시: 경고 중에는 붉은 띠에 WARNING이 깜빡이고, 싸우는 중에는 보스 체력 막대
  drawBossBanner(context, width, engine) {
    if (engine.bossPhase === 'warning') {
      const blink = Math.sin(engine.gameTime * 12) > -0.2;
      const bandY = this.surface.height * 0.38;
      context.fillStyle = `rgba(120, 10, 30, ${blink ? 0.78 : 0.55})`;
      context.fillRect(0, bandY - 30, width, 60);
      context.fillStyle = '#ff3355';
      context.fillRect(0, bandY - 30, width, 3);
      context.fillRect(0, bandY + 27, width, 3);
      context.font = canvasFont(Math.min(30, width / 18), 'display', 700);
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillStyle = blink ? '#ffe0e6' : '#ff8fa3';
      const kindName = ROBOT_STYLE[engine.bossKind]?.name?.replace('보스 ', '') ?? 'BOSS';
      context.fillText(`⚠ WARNING · ${kindName} 접근 중`, width / 2, bandY);
      return;
    }
    const boss = engine.boss();
    if (engine.bossPhase !== 'fight' || !boss) return;
    const barWidth = Math.min(420, width - 40);
    const barX = (width - barWidth) / 2;
    // 서버 벽 띠(로봇이 나오는 문 높이)에 겹쳐 그려 로봇·낱말을 가리지 않게 한다
    const barY = HUD_HEIGHT + 8;
    const ratio = boss.hp / boss.maxHp;
    context.fillStyle = 'rgba(10, 12, 24, 0.85)';
    roundedRect(context, barX - 2, barY - 2, barWidth + 4, 14, 7);
    context.fill();
    const fill = context.createLinearGradient(barX, 0, barX + barWidth, 0);
    fill.addColorStop(0, '#ff3355');
    fill.addColorStop(1, '#ffb547');
    context.fillStyle = fill;
    roundedRect(context, barX, barY, Math.max(6, barWidth * ratio), 10, 5);
    context.fill();
    for (let tick = 1; tick < boss.maxHp; tick++) {
      context.fillStyle = 'rgba(10, 12, 24, 0.6)';
      context.fillRect(barX + (barWidth * tick) / boss.maxHp, barY, 1.5, 10);
    }
    context.font = canvasFont(10, 'display', 700);
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = '#1a0610';
    context.fillText(`👑 ${ROBOT_STYLE[boss.type]?.name?.replace('보스 ', '') ?? 'BOSS'} ${boss.hp}/${boss.maxHp}`, width / 2, barY + 5.5);
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
      const [shown, states] = this.labelView(item, engine.getCharacterStates(item), engine);
      drawTokenLabel(context, x, y + 32 * scale, shown, states, {
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
      // 손은 그대로, 휴대폰만 화면 쪽이 보이게 돌리고 손 위로 조금 올려 쥔다
      context.save();
      context.translate(0, -GRIP_PHONE_LIFT);
      this.drawPhoneFront(context, cracks);
      context.restore();
      this.drawSwooshGrip(context);
      context.restore();
      return;
    }
    this.drawPhoneFront(context, cracks);
    context.restore();
  }

  drawPhoneFront(context, cracks) {
    context.fillStyle = '#0f141b';
    roundedRect(context, -6, -10, 12, 20, 3);
    context.fill();
    context.strokeStyle = '#8a98aa';
    context.lineWidth = 1;
    context.stroke();
    context.fillStyle = PHONE_SCREEN_COLORS[Math.min(cracks, PHONE_SCREEN_COLORS.length - 1)];
    context.fillRect(-4.5, -8, 9, 14);
    if (cracks > 0) this.drawPhoneCracks(context, cracks);
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
      { from: { x: -3.9, y: 4.6 }, to: { x: 6.3, y: 0.4 }, width: 2.35 },
      { from: { x: -2.9, y: 6.4 }, to: { x: 6.6, y: 2.7 }, width: 2.45 },
      { from: { x: -1.9, y: 8.1 }, to: { x: 6.4, y: 5 }, width: 2.35 },
      { from: { x: -0.9, y: 9.7 }, to: { x: 5.9, y: 7.2 }, width: 2.05 }
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
    for (const { from, to, width } of fingers.slice(0, -1)) capsule({ x: from.x, y: from.y + 0.45 }, { x: Math.min(to.x, 5.6), y: to.y + 0.45 }, width);
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
    const endY = isBossType(target.type) ? this.toY(target.x) - 74 * this.bossScale()
      : this.toY(target.x) - (target.kind === 'item' ? 18 : 30 * this.depthScale(target.x));
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
    // 가운데: 목표까지 처치 수
    context.textAlign = 'center';
    context.fillStyle = engine.winAt != null ? '#4df0a6' : engine.bossPhase ? '#ff5d73' : '#e6e9f5';
    const progress = engine.bossPhase ? '👑 FINAL WAVE' : `🤖 ${Math.min(engine.totalKills(), THROW_RULES.goalKills)} / ${THROW_RULES.goalKills}`;
    context.fillText(progress, width / 2, HUD_HEIGHT / 2);
    const laptop = engine.laptopRemaining();
    context.textAlign = 'right';
    context.font = canvasFont(12);
    if (laptop > 0) {
      context.fillStyle = '#c792ea';
      context.fillText(`💻 노트북 ×2 · ${laptop.toFixed(1)}s`, width - 10, HUD_HEIGHT / 2);
      context.fillRect(width - 130, HUD_HEIGHT - 5, 120 * (laptop / THROW_RULES.laptopSeconds), 3);
    } else {
      context.fillStyle = '#8a93b8';
      context.fillText('📱 휴대폰', width - 10, HUD_HEIGHT / 2);
    }
    context.textAlign = 'start';
  }
}
