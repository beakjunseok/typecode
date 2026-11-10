// 배터리 구조 SOS 화면(세로형). 원작 해상구조 SOS의 '왼쪽 나 vs 오른쪽 상대, 수직 탑 높이 경쟁' 구도.
// 위: 충전 드론 + 100% 충전선 / 가운데: 가로로 지나가는 아이템 / 양옆: 배터리 셀 탑 + 캐릭터 / 아래: 바다.
import { ARCADE_RULES } from './target-game.js';
import { drawDrone } from './drone-view.js';
import { BATTERY_RULES } from './battery-engine.js';
import { setupCanvas, roundedRect, drawTokenLabel, ParticleSystem, easeOutCubic, easeOutBack, Spring, VisualStates } from './game-view.js';

const BEAM_SECONDS = 0.35;
const wallSeconds = () => performance.now() / 1000;

const HUD_HEIGHT = 34;
const SEA_HEIGHT = 64;
const SIDE_STYLE = {
  me: { top: '#5dffb0', bottom: '#1f9e62', glow: '#39ff88' },
  rival: { top: '#ff9a6b', bottom: '#b8402a', glow: '#ff4d6d' }
};
const ITEM_STYLE = {
  cell: { color: '#39ff88', label: '+0.5' },
  powerbank: { color: '#36e2ff', label: '+1' },
  eco: { color: '#c3e88d', label: 'ECO' },
  heat: { color: '#ff7a45', label: 'HEAT' },
  blackout: { color: '#c792ea', label: 'OFF' }
};

export class BatteryRenderer {
  constructor(canvas) {
    this.surface = setupCanvas(canvas);
    this.particles = new ParticleSystem();
    this.lastGameTime = 0;
    this.accent = '#36e2ff';
    // 빔·배너는 연출이라 게임 시계(gameTime)가 아닌 실제 시계로 잰다: 게임이 끝나 시계가 멈추거나 재시작해 0으로 돌아가도 반드시 사라진다
    this.beams = [];
    this.banner = null;
    this.visuals = new VisualStates(() => ({ labelPop: new Spring(0, { stiffness: 420, damping: 18 }) }));
    this.bounce = { me: new Spring(0, { stiffness: 200, damping: 9 }), rival: new Spring(0, { stiffness: 200, damping: 9 }) };
    this.displayCells = { me: BATTERY_RULES.startCells, rival: BATTERY_RULES.startCells };
  }

  get context() {
    return this.surface.context;
  }

  get goalY() {
    return HUD_HEIGHT + 58;
  }

  get waterY() {
    return this.surface.height - SEA_HEIGHT;
  }

  get cellHeight() {
    return (this.waterY - this.goalY) / BATTERY_RULES.goalCells;
  }

  towerX(side) {
    return this.surface.width * (side === 'me' ? 0.2 : 0.8);
  }

  towerWidth() {
    return Math.max(40, Math.min(64, this.surface.width * 0.15));
  }

  towerTopY(cells) {
    return this.waterY - Math.max(0, cells) * this.cellHeight;
  }

  itemPosition(item) {
    return { x: item.x * this.surface.width, y: this.goalY + 40 + item.y * (this.waterY - this.goalY - 80) };
  }

  characterPosition(side) {
    return { x: this.towerX(side), y: this.towerTopY(this.displayCells[side]) };
  }

  onEvent(type, payload, engine) {
    if (type === 'lock') this.visuals.get(payload.target.id).labelPop.kick(14);
    else if (type === 'mistake' && payload.target) this.visuals.get(payload.target.id).labelPop.kick(-10);
    else if (type === 'item' || type === 'drain') this.bounce[type === 'item' ? 'me' : 'rival'].kick(type === 'item' ? -140 : 160);
    else if (type === 'rival-take') this.bounce.rival.kick(-140);
    else if (type === 'rival-attack') this.bounce.me.kick(160);
    else if (type === 'stage-clear') this.banner = { text: `STAGE ${payload.stage} CLEAR`, sub: payload.how === 'charged' ? '100% 충전 완료! 충전 드론이 구조했습니다' : '방전봇 침몰!', at: wallSeconds() };

    if (!this.context) return;
    const now = wallSeconds();
    if (type === 'rival-take') {
      const { x, y } = this.itemPosition(payload.item);
      this.beams.push({ from: this.characterPosition('rival'), to: { x, y }, color: '#ff4d6d', at: now });
      this.particles.burst(x, y, { color: '#ff4d6d', count: 16, speed: 160, life: 0.5 });
    } else if (type === 'rival-attack') {
      const target = this.characterPosition('me');
      this.beams.push({ from: this.characterPosition('rival'), to: target, color: '#ff4d6d', at: now });
      this.particles.burst(target.x, target.y + 10, { color: '#ff7a45', count: 20, speed: 180, life: 0.6, gravity: 300 });
    } else if (type === 'item') {
      const { x, y } = this.itemPosition(payload.item);
      this.particles.burst(x, y, { color: ITEM_STYLE[payload.item.item].color, count: 26, speed: 200, life: 0.7 });
      const me = this.characterPosition('me');
      this.particles.burst(me.x, me.y, { color: '#39ff88', count: 14, speed: 120, life: 0.6, gravity: -120 });
    } else if (type === 'drain') {
      const rival = this.characterPosition('rival');
      this.particles.burst(rival.x, rival.y + 8, { color: '#ffe08a', count: 22, speed: 200, life: 0.6, gravity: 300 });
    } else if (type === 'stage-clear') {
      this.particles.burst(this.surface.width / 2, this.goalY, { color: '#39ff88', count: 60, speed: 300, life: 1.2, gravity: 200 });
    }
  }

  // 수명이 끝난 빔을 지운다(실제 시계 기준). 빔 수 k에 대해 O(k)
  pruneEffects() {
    const wallNow = wallSeconds();
    this.beams = this.beams.filter(beam => wallNow - beam.at < BEAM_SECONDS);
  }

  render(engine, { accent }) {
    this.pruneEffects();
    const context = this.context;
    if (!context) return;
    this.surface.resize?.();
    this.accent = accent;
    const frameSeconds = Math.min(0.1, Math.max(0, engine.gameTime - this.lastGameTime)) || (engine.status === 'running' ? 0 : 1 / 60);
    this.lastGameTime = engine.gameTime;
    this.particles.update(frameSeconds);
    this.visuals.step(frameSeconds, new Set([...engine.items.map(item => item.id), engine.rivalWord.id, engine.myWord.id]));
    this.bounce.me.step(frameSeconds);
    this.bounce.rival.step(frameSeconds);
    // 탑 높이는 부드럽게 따라간다(셀이 쑥 늘거나 깎일 때 출렁임)
    for (const side of ['me', 'rival']) {
      const target = Math.max(0, engine[side].cells);
      this.displayCells[side] += (target - this.displayCells[side]) * Math.min(1, frameSeconds * 10 || 0.2);
    }

    const { width, height } = this.surface;
    context.clearRect(0, 0, width, height);
    this.drawSky(context, width, engine);
    this.drawChargingDrone(context, engine);
    this.drawGoalLine(context, width);
    this.drawTower(context, 'me', engine);
    this.drawTower(context, 'rival', engine);
    this.drawSea(context, width, height, engine);
    this.drawCharacter(context, 'me', engine);
    this.drawCharacter(context, 'rival', engine);
    this.drawTowerLabels(context, engine);
    // 지나가는 아이템은 탑·캐릭터·탑 낱말 위에 그려서 칠 낱말이 가려지지 않게 한다
    for (const item of engine.items) this.drawItem(context, item, engine);
    for (const projectile of engine.projectiles) this.drawBolt(context, projectile, engine);
    for (const beam of this.beams) this.drawBeam(context, beam, engine);
    this.particles.draw(context);
    this.drawHud(context, width, engine);
    this.drawBanner(context, width, engine);
  }

  drawSky(context, width, engine) {
    const gradient = context.createLinearGradient(0, 0, 0, this.waterY);
    gradient.addColorStop(0, '#0a1020');
    gradient.addColorStop(1, '#14223a');
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, this.waterY);
    // 별(충전 표시등처럼 깜빡임)
    for (let star = 0; star < 24; star++) {
      const x = (star * 97.3) % width;
      const y = HUD_HEIGHT + ((star * 53.7) % (this.waterY * 0.55));
      context.globalAlpha = 0.2 + 0.25 * Math.sin(engine.gameTime * 2 + star);
      context.fillStyle = '#9cc3ff';
      context.fillRect(x, y, 2, 2);
    }
    context.globalAlpha = 1;
  }

  // 충전 드론: 위에서 좌우로 천천히 오가며(이동 방향으로 살짝 기울어짐) 100% 선까지 충전 케이블을 늘어뜨린다
  drawChargingDrone(context, engine) {
    const sway = engine.gameTime * 0.8;
    const x = this.surface.width / 2 + Math.sin(sway) * 20;
    const y = HUD_HEIGHT + 28 + Math.sin(engine.gameTime * 2.2) * 2;
    const size = 1.25;
    const cableTop = y + 9 * size;
    context.strokeStyle = 'rgba(57, 255, 136, 0.55)';
    context.lineWidth = 1.6;
    context.beginPath();
    context.moveTo(x, cableTop);
    context.quadraticCurveTo(x - Math.cos(sway) * 10, (cableTop + this.goalY) / 2, x, this.goalY - 7);
    context.stroke();
    context.fillStyle = '#c9d4e0';
    roundedRect(context, x - 4, this.goalY - 9, 8, 7, 2);
    context.fill();
    context.fillStyle = '#39ff88';
    context.fillRect(x - 2, this.goalY - 2, 1.5, 3);
    context.fillRect(x + 0.5, this.goalY - 2, 1.5, 3);
    drawDrone(context, { x, y, size, time: engine.gameTime, accent: '#39ff88', tilt: Math.cos(sway) * 0.09, seed: 3 });
  }

  drawGoalLine(context, width) {
    context.strokeStyle = 'rgba(57, 255, 136, 0.45)';
    context.setLineDash([8, 6]);
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(0, this.goalY);
    context.lineTo(width, this.goalY);
    context.stroke();
    context.setLineDash([]);
    context.font = "600 10px 'JetBrains Mono', monospace";
    context.fillStyle = '#39ff88';
    context.fillText('100% ▸ 구조', 6, this.goalY - 5);
    // 칸 눈금
    context.fillStyle = 'rgba(138, 152, 170, 0.4)';
    for (let cell = 1; cell < BATTERY_RULES.goalCells; cell++) {
      const y = this.waterY - cell * this.cellHeight;
      context.fillRect(0, y, 5, 1);
      context.fillRect(width - 5, y, 5, 1);
    }
  }

  // 배터리 셀을 쌓은 탑. 맨 위 셀은 남은 비율만큼 채운다. 물속 부분은 바다가 덮는다.
  drawTower(context, side, engine) {
    const style = SIDE_STYLE[side];
    const cells = this.displayCells[side];
    const x = this.towerX(side);
    const width = this.towerWidth();
    const cellHeight = this.cellHeight;
    const effects = engine[side];
    const heat = engine.gameTime < effects.heatUntil;
    const eco = engine.gameTime < effects.ecoUntil;
    const fullCells = Math.floor(cells);
    const total = Math.ceil(cells) + 2;
    for (let index = -2; index < total - 2; index++) {
      const fill = index < fullCells ? 1 : Math.max(0, cells - fullCells);
      const top = this.waterY - (index + 1) * cellHeight;
      context.fillStyle = '#0c121a';
      roundedRect(context, x - width / 2, top + 2, width, cellHeight - 3, 5);
      context.fill();
      if (fill > 0 || index < 0) {
        const fillRatio = index < 0 ? 1 : fill;
        const gradient = context.createLinearGradient(x - width / 2, 0, x + width / 2, 0);
        gradient.addColorStop(0, style.bottom);
        gradient.addColorStop(0.45, style.top);
        gradient.addColorStop(1, style.bottom);
        context.fillStyle = gradient;
        context.globalAlpha = heat && Math.sin(engine.gameTime * 20 + index) > 0 ? 0.75 : 1;
        roundedRect(context, x - width / 2 + 3, top + 2 + (cellHeight - 3) * (1 - fillRatio) + 2, width - 6, (cellHeight - 3) * fillRatio - 4, 4);
        context.fill();
        context.globalAlpha = 1;
        context.fillStyle = 'rgba(255, 255, 255, 0.55)';
        context.font = `700 ${Math.round(cellHeight * 0.38)}px 'JetBrains Mono', monospace`;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        if (fillRatio > 0.5) context.fillText('+', x, top + cellHeight / 2 + 1);
        context.textAlign = 'start';
      }
      context.strokeStyle = 'rgba(201, 212, 224, 0.25)';
      context.lineWidth = 1;
      roundedRect(context, x - width / 2, top + 2, width, cellHeight - 3, 5);
      context.stroke();
    }
    // 단자
    const topY = this.towerTopY(cells);
    context.fillStyle = '#8a98aa';
    roundedRect(context, x - 8, topY - 3, 16, 5, 2);
    context.fill();
    if (eco) {
      context.strokeStyle = `rgba(195, 232, 141, ${0.4 + 0.3 * Math.sin(engine.gameTime * 6)})`;
      context.lineWidth = 3;
      roundedRect(context, x - width / 2 - 6, topY - 6, width + 12, this.waterY - topY + 6, 8);
      context.stroke();
    }
    if (heat && Math.random() < 0.5) {
      this.particles.burst(x + (Math.random() - 0.5) * width, this.waterY - 4, { color: '#ff7a45', count: 1, speed: 30, life: 0.6, gravity: -200, size: 3 });
    }
  }

  drawSea(context, width, height, engine) {
    const meDanger = engine.me.cells < 1.2;
    context.beginPath();
    context.moveTo(0, height);
    for (let x = 0; x <= width; x += 10) {
      context.lineTo(x, this.waterY + Math.sin(x / 30 + engine.gameTime * 2.2) * 4);
    }
    context.lineTo(width, height);
    context.closePath();
    const sea = context.createLinearGradient(0, this.waterY, 0, height);
    sea.addColorStop(0, meDanger && Math.sin(engine.gameTime * 8) > 0 ? 'rgba(120, 30, 50, 0.92)' : 'rgba(18, 52, 96, 0.92)');
    sea.addColorStop(1, 'rgba(6, 14, 28, 0.98)');
    context.fillStyle = sea;
    context.fill();
    context.strokeStyle = '#5b8bd6';
    context.lineWidth = 2;
    context.beginPath();
    for (let x = 0; x <= width; x += 10) {
      const y = this.waterY + Math.sin(x / 30 + engine.gameTime * 2.2) * 4;
      if (x === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.stroke();
    context.font = "600 10px 'JetBrains Mono', monospace";
    context.fillStyle = 'rgba(156, 195, 255, 0.45)';
    context.textAlign = 'center';
    context.fillText('0% 방전의 바다', width / 2, height - 12);
    context.textAlign = 'start';
  }

  // 캐릭터: 내 폰(스마트폰 마스코트) / 방전봇(플러그 머리 로봇). 위험하면 땀, 이기면 환호.
  drawCharacter(context, side, engine) {
    const { x, y } = this.characterPosition(side);
    const bounce = this.bounce[side].value * 0.06;
    const cells = engine[side].cells;
    const worried = cells < 1.6;
    const bob = Math.sin(engine.gameTime * 3 + (side === 'me' ? 0 : 1.5)) * 2;
    context.save();
    context.translate(x, y - 4 + bob + bounce);
    if (side === 'me') this.drawPhoneMascot(context, engine, worried);
    else this.drawDrainBot(context, engine, worried);
    context.restore();
  }

  drawPhoneMascot(context, engine, worried) {
    // 다리
    context.strokeStyle = '#c9d4e0';
    context.lineWidth = 3;
    context.lineCap = 'round';
    context.beginPath();
    context.moveTo(-6, -4);
    context.lineTo(-7, 0);
    context.moveTo(6, -4);
    context.lineTo(7, 0);
    context.stroke();
    // 몸(폰)
    context.fillStyle = '#1b2430';
    roundedRect(context, -15, -44, 30, 42, 7);
    context.fill();
    context.strokeStyle = '#8a98aa';
    context.lineWidth = 1.5;
    context.stroke();
    const screen = context.createLinearGradient(0, -40, 0, -8);
    screen.addColorStop(0, '#36e2ff');
    screen.addColorStop(1, '#1a7fa0');
    context.fillStyle = screen;
    roundedRect(context, -12, -40, 24, 32, 4);
    context.fill();
    // 얼굴
    context.fillStyle = '#05111a';
    const blink = (engine.gameTime % 3.4) < 0.12;
    if (blink) {
      context.fillRect(-7, -29, 5, 2);
      context.fillRect(2, -29, 5, 2);
    } else {
      context.beginPath();
      context.arc(-5, -28, 2.5, 0, Math.PI * 2);
      context.arc(5, -28, 2.5, 0, Math.PI * 2);
      context.fill();
    }
    context.strokeStyle = '#05111a';
    context.lineWidth = 2;
    context.beginPath();
    if (worried) context.arc(0, -15, 4, Math.PI * 1.15, Math.PI * 1.85);
    else context.arc(0, -20, 4, Math.PI * 0.15, Math.PI * 0.85);
    context.stroke();
    // 배터리 표시(머리 위 상태바)
    const percent = Math.max(0, Math.min(1, engine.me.cells / BATTERY_RULES.goalCells));
    context.fillStyle = '#0b1017';
    context.fillRect(-9, -38, 14, 5);
    context.fillStyle = percent < 0.2 ? '#ff4d6d' : '#39ff88';
    context.fillRect(-8, -37, 12 * percent, 3);
    // 팔: 위급하면 허우적, 아니면 손 흔들기
    const wave = Math.sin(engine.gameTime * (worried ? 14 : 4)) * (worried ? 8 : 4);
    context.strokeStyle = '#c9d4e0';
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(-15, -26);
    context.lineTo(-23, -34 - wave);
    context.moveTo(15, -26);
    context.lineTo(23, -32 + wave);
    context.stroke();
    if (worried) {
      context.fillStyle = '#9cc3ff';
      context.beginPath();
      context.arc(16, -44 + ((engine.gameTime * 30) % 10), 2.5, 0, Math.PI * 2);
      context.fill();
    }
  }

  drawDrainBot(context, engine, worried) {
    const paused = engine.gameTime < engine.ai.pausedUntil;
    context.fillStyle = '#1b2430';
    context.fillRect(-10, -8, 6, 8);
    context.fillRect(4, -8, 6, 8);
    const body = context.createLinearGradient(-16, -40, 16, 0);
    body.addColorStop(0, '#6a3a55');
    body.addColorStop(1, '#3b1f33');
    context.fillStyle = body;
    roundedRect(context, -17, -40, 34, 34, 9);
    context.fill();
    context.strokeStyle = '#ff4d6d';
    context.lineWidth = 1.5;
    context.stroke();
    // 플러그 머리(두 갈래 단자)
    context.fillStyle = '#c9d4e0';
    context.fillRect(-8, -50, 4, 11);
    context.fillRect(4, -50, 4, 11);
    // 얼굴창: 화면 꺼짐이면 어둡고 Zz
    context.fillStyle = paused ? '#05080c' : '#0b1017';
    roundedRect(context, -12, -34, 24, 14, 4);
    context.fill();
    if (paused) {
      context.fillStyle = '#c792ea';
      context.font = "700 10px 'JetBrains Mono', monospace";
      context.fillText('z', 2, -24);
      context.fillText('Z', 8, -30 - Math.sin(engine.gameTime * 3) * 2);
    } else {
      context.strokeStyle = '#ff4d6d';
      context.shadowColor = '#ff4d6d';
      context.shadowBlur = 8;
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(-9, -30);
      context.lineTo(-3, -26);
      context.moveTo(9, -30);
      context.lineTo(3, -26);
      context.stroke();
      context.shadowBlur = 0;
    }
    // 타이핑 중이면 팔이 빠르게 움직인다
    const typing = engine.ai.targetId !== null && !paused;
    const arm = Math.sin(engine.gameTime * (typing ? 26 : 3)) * (typing ? 4 : 2);
    context.strokeStyle = '#6a3a55';
    context.lineWidth = 4;
    context.lineCap = 'round';
    context.beginPath();
    context.moveTo(-17, -22);
    context.lineTo(-24, -14 + arm);
    context.moveTo(17, -22);
    context.lineTo(24, -14 - arm);
    context.stroke();
    if (worried) {
      context.fillStyle = '#ffe08a';
      context.fillRect(-20 + Math.random() * 40, -44 + Math.random() * 30, 2, 2);
    }
  }

  // 탑 꼭대기 셀 낱말: 상대 탑 = 내가 칠 낱말, 내 탑 = 방전봇이 노리는 낱말(AI 진행도 빨간 밑줄)
  drawTowerLabels(context, engine) {
    const compact = this.surface.width < 520;
    const rival = this.characterPosition('rival');
    const hidden = engine.gameTime < engine.hiddenUntil;
    const rivalPop = this.visuals.get(engine.rivalWord.id).labelPop.value * 0.4;
    const labelX = Math.min(this.surface.width - 70, Math.max(70, rival.x));
    if (hidden) {
      context.font = "700 12px 'JetBrains Mono', monospace";
      context.fillStyle = '#c792ea';
      context.textAlign = 'center';
      context.fillText('▒▒ 화면 꺼짐 ▒▒', labelX, rival.y - 66);
      context.textAlign = 'start';
    } else {
      drawTokenLabel(context, labelX, rival.y - 56 - rivalPop, engine.rivalWord, engine.getCharacterStates(engine.rivalWord), {
        active: engine.rivalWord.id === engine.targetId, accent: '#ff4d6d', compact
      });
    }
    const me = this.characterPosition('me');
    const meX = Math.min(this.surface.width - 70, Math.max(70, me.x));
    context.save();
    context.globalAlpha = this.labelCrowded(engine, meX, me.y - 56) ? 0.18 : 0.85;
    drawTokenLabel(context, meX, me.y - 56, engine.myWord, engine.myWord.token.text.split('').map(() => 'pending'), {
      active: false, accent: '#ff4d6d', compact, attacker: engine.aiProgressFor(engine.myWord.id)
    });
    context.restore();
    if (engine.ai.targetId === engine.myWord.id) {
      context.font = "600 10px 'JetBrains Mono', monospace";
      context.fillStyle = '#ff4d6d';
      context.textAlign = 'center';
      context.fillText('⚠ 방전봇 공격 중', meX, me.y - 84);
      context.textAlign = 'start';
    }
  }

  // 아이템 낱말이 탑 낱말 근처를 지나가면 탑 낱말을 흐리게(겹쳐 읽기 어려운 것 방지). 아이템 수 k에 대해 O(k)
  labelCrowded(engine, labelX, labelY) {
    return engine.items.some(item => {
      if (item.consumed) return false;
      const { x, y } = this.itemPosition(item);
      return Math.abs(x - labelX) < 130 && Math.abs(y + 34 - labelY) < 40;
    });
  }

  drawItem(context, item, engine) {
    const style = ITEM_STYLE[item.item];
    let { x, y } = this.itemPosition(item);
    let alpha = 1;
    let scale = easeOutBack(Math.min(1, (engine.gameTime - item.spawnedAt) / 0.4));
    if (item.consumed && item.takenAt !== undefined) {
      const progress = Math.min(1, (engine.gameTime - item.takenAt) / 0.6);
      const target = this.characterPosition(item.takenBy === 'rival' ? 'rival' : 'me');
      x += (target.x - x) * easeOutCubic(progress);
      y += (target.y - 20 - y) * easeOutCubic(progress);
      alpha = 1 - progress;
      scale *= 1 - progress * 0.5;
    }
    if (alpha <= 0) return;
    y += Math.sin(engine.gameTime * 3 + item.id) * 3;
    context.save();
    context.globalAlpha = alpha;
    context.translate(x, y);
    context.scale(scale, scale);
    context.shadowColor = style.color;
    context.shadowBlur = 12;
    if (item.item === 'cell') this.drawCellIcon(context, style.color);
    else if (item.item === 'powerbank') this.drawPowerbankDrone(context, engine);
    else if (item.item === 'eco') this.drawEcoIcon(context, style.color);
    else if (item.item === 'heat') this.drawHeatIcon(context, engine);
    else this.drawBlackoutIcon(context, style.color);
    context.shadowBlur = 0;
    context.restore();
    if (!item.consumed) {
      const pop = this.visuals.get(item.id).labelPop.value * 0.4;
      drawTokenLabel(context, x, y + 34 - pop, item, engine.getCharacterStates(item), {
        active: item.id === engine.targetId, accent: style.color, compact: this.surface.width < 520,
        attacker: engine.aiProgressFor(item.id)
      });
    }
  }

  drawCellIcon(context, color) {
    context.fillStyle = '#0c121a';
    roundedRect(context, -16, -10, 30, 20, 4);
    context.fill();
    context.fillStyle = color;
    roundedRect(context, -13, -7, 24, 14, 3);
    context.fill();
    context.fillStyle = '#c9d4e0';
    context.fillRect(14, -4, 4, 8);
    context.fillStyle = '#0c121a';
    context.font = "800 12px 'JetBrains Mono', monospace";
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('+', -1, 1);
    context.textAlign = 'start';
  }

  // 보조배터리 드론: 공용 드론이 집게로 보조배터리(충전 칸 4개)를 물고 간다
  drawPowerbankDrone(context, engine) {
    context.fillStyle = '#c9d4e0';
    roundedRect(context, -12, -6, 24, 16, 3);
    context.fill();
    context.fillStyle = '#1b2430';
    roundedRect(context, -10, -1, 20, 8, 2);
    context.fill();
    const charged = 1 + Math.floor((engine.gameTime * 2) % 4);
    for (let bar = 0; bar < 4; bar++) {
      context.fillStyle = bar < charged ? '#36e2ff' : '#28394a';
      context.fillRect(-8.5 + bar * 4.5, 1, 3, 4);
    }
    drawDrone(context, { x: 0, y: -16, size: 0.68, time: engine.gameTime, accent: '#36e2ff', seed: 11, claws: true });
  }

  drawEcoIcon(context, color) {
    context.fillStyle = '#14240f';
    context.beginPath();
    context.arc(0, 0, 15, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = color;
    context.lineWidth = 2;
    context.stroke();
    context.fillStyle = color;
    context.beginPath();
    context.moveTo(-6, 6);
    context.quadraticCurveTo(-8, -8, 7, -8);
    context.quadraticCurveTo(8, 6, -6, 6);
    context.fill();
  }

  drawHeatIcon(context, engine) {
    context.fillStyle = '#2b1a14';
    context.beginPath();
    context.arc(0, 2, 13, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = '#ff7a45';
    context.lineWidth = 2;
    context.stroke();
    const flicker = Math.sin(engine.gameTime * 20) * 2;
    context.fillStyle = '#ffcb6b';
    context.beginPath();
    context.moveTo(0, -18 - flicker);
    context.quadraticCurveTo(7, -10, 3, -6);
    context.quadraticCurveTo(0, -9, -3, -6);
    context.quadraticCurveTo(-7, -10, 0, -18 - flicker);
    context.fill();
    context.fillStyle = '#ff7a45';
    context.font = "800 10px 'JetBrains Mono', monospace";
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('°C', 0, 3);
    context.textAlign = 'start';
  }

  drawBlackoutIcon(context, color) {
    context.fillStyle = '#05080c';
    roundedRect(context, -11, -16, 22, 32, 5);
    context.fill();
    context.strokeStyle = color;
    context.lineWidth = 2;
    context.stroke();
    context.fillStyle = color;
    context.beginPath();
    context.arc(0, 0, 6, Math.PI * 0.3, Math.PI * 1.7);
    context.arc(3, -1, 5, Math.PI * 1.55, Math.PI * 0.45, true);
    context.fill();
  }

  // 내 폰 → 목표로 날아가는 전기 볼트
  drawBolt(context, projectile, engine) {
    const target = engine.findEntity(projectile.targetId);
    if (!target) return;
    const progress = easeOutCubic(Math.min(1, (engine.gameTime - projectile.launchedAt) / ARCADE_RULES.projectileSeconds));
    const start = this.characterPosition('me');
    const end = target.kind === 'item' ? this.itemPosition(target) : this.characterPosition('rival');
    const x = start.x + (end.x - start.x) * progress;
    const y = start.y - 30 + (end.y - 20 - start.y + 30) * progress - Math.sin(progress * Math.PI) * 40;
    context.fillStyle = '#36e2ff';
    context.shadowColor = '#36e2ff';
    context.shadowBlur = 16;
    context.beginPath();
    context.moveTo(x + 2, y - 9);
    context.lineTo(x - 5, y + 1);
    context.lineTo(x, y + 1);
    context.lineTo(x - 2, y + 9);
    context.lineTo(x + 5, y - 1);
    context.lineTo(x, y - 1);
    context.closePath();
    context.fill();
    context.shadowBlur = 0;
  }

  drawBeam(context, beam, engine) {
    const progress = Math.min(1, (wallSeconds() - beam.at) / BEAM_SECONDS);
    context.strokeStyle = beam.color;
    context.globalAlpha = 1 - progress;
    context.lineWidth = 3;
    context.shadowColor = beam.color;
    context.shadowBlur = 12;
    context.beginPath();
    const steps = 6;
    for (let index = 0; index <= steps; index++) {
      const t = index / steps;
      const jitter = index === 0 || index === steps ? 0 : (Math.random() - 0.5) * 14;
      const x = beam.from.x + (beam.to.x - beam.from.x) * t + jitter;
      const y = beam.from.y - 30 + (beam.to.y - beam.from.y + 10) * t + jitter;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.stroke();
    context.shadowBlur = 0;
    context.globalAlpha = 1;
  }

  drawHud(context, width, engine) {
    context.fillStyle = 'rgba(7, 10, 15, 0.88)';
    context.fillRect(0, 0, width, HUD_HEIGHT);
    context.textBaseline = 'middle';
    const percent = side => Math.round(Math.max(0, Math.min(1, engine[side].cells / BATTERY_RULES.goalCells)) * 100);
    context.font = "700 13px 'JetBrains Mono', monospace";
    context.fillStyle = '#39ff88';
    context.fillText(`📱 나 ${percent('me')}%`, 10, HUD_HEIGHT / 2);
    context.textAlign = 'right';
    context.fillStyle = '#ff4d6d';
    context.fillText(`방전봇 ${percent('rival')}% 🔌`, width - 10, HUD_HEIGHT / 2);
    context.textAlign = 'center';
    context.fillStyle = '#c9d4e0';
    context.font = "700 12px 'JetBrains Mono', monospace";
    context.fillText(`STAGE ${engine.stage}`, width / 2, HUD_HEIGHT / 2);
    context.textAlign = 'start';
  }

  drawBanner(context, width, engine) {
    if (!this.banner) return;
    const age = wallSeconds() - this.banner.at;
    if (age > 1.8) {
      this.banner = null;
      return;
    }
    const scale = easeOutBack(Math.min(1, age / 0.3));
    const alpha = age > 1.4 ? 1 - (age - 1.4) / 0.4 : 1;
    context.save();
    context.globalAlpha = alpha;
    context.translate(width / 2, this.surface.height * 0.42);
    context.scale(scale, scale);
    context.fillStyle = 'rgba(7, 10, 15, 0.85)';
    roundedRect(context, -150, -34, 300, 68, 12);
    context.fill();
    context.strokeStyle = '#39ff88';
    context.lineWidth = 2;
    context.stroke();
    context.textAlign = 'center';
    context.fillStyle = '#39ff88';
    context.font = "800 22px 'JetBrains Mono', monospace";
    context.fillText(this.banner.text, 0, -8);
    context.fillStyle = '#c9d4e0';
    context.font = "600 12px 'JetBrains Mono', monospace";
    context.fillText(this.banner.sub, 0, 18);
    context.restore();
    context.textAlign = 'start';
  }
}
