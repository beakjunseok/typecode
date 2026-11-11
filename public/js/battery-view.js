// 배터리 구조 SOS 화면(세로형). 원작 해상구조 SOS의 '왼쪽 나 vs 오른쪽 상대, 수직 탑 높이 경쟁' 구도.
// 위: 충전 드론 + 100% 충전선 / 가운데: 가로로 지나가는 아이템 / 양옆: 배터리 셀 탑 + 캐릭터 / 아래: 바다.
import { ARCADE_RULES } from './target-game.js';
import { drawDrone } from './drone-view.js';
import { BATTERY_RULES } from './battery-engine.js';
import { MASCOT_PALETTES, createRig, reactRig, updateRig, drawPhoneMascot, drawDrainBot } from './battery-characters.js';
import { setupCanvas, roundedRect, drawTokenLabel, ParticleSystem, easeOutCubic, easeOutBack, Spring, VisualStates, canvasFont, seededRandom } from './game-view.js';

const BEAM_SECONDS = 0.35;
const isPvp = engine => engine.mode === 'battery-pvp';
const rivalLabel = engine => engine.rivalName ?? '방전봇';
const wallSeconds = () => performance.now() / 1000;

const HUD_HEIGHT = 34;
const SEA_HEIGHT = 64;
const SIDE_STYLE = {
  me: { top: '#7dffc4', bottom: '#169a62', glow: '#4df0a6', label: '#4df0a6' },
  rival: { top: '#ffab7d', bottom: '#b8402a', glow: '#ff5d73', label: '#ff5d73' }
};
const SCENE = Object.freeze({
  skyTop: '#060916', skyMid: '#0d1330', skyHorizon: '#191e48',
  skyline: '#0a0e24', skylineEdge: '#1a2048', window: ['#ffb547', '#7fd8ff', '#ffe2a8'],
  seaTop: '#16306a', seaBottom: '#060a19', seaBack: '#0f1a3e', crest: '#7fa7f5',
  danger: '#7a1f3a', rail: '#4df0a6', ink: '#0e1222', paper: '#e9edf8', fog: '#8a93b8', dim: '#5a6288'
});
const ITEM_STYLE = {
  cell: { color: '#4df0a6', label: '+0.5' },
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
    // 캐릭터 리그(숨쉬기·시선·조준·반응 스프링). 시간은 실제 시계로 흘러 게임이 끝나도 승패 동작이 이어진다
    this.rigs = { me: createRig({ seed: 1, facing: 1 }), rival: createRig({ seed: 4, facing: -1 }) };
    this.rigClock = null;
    this.rivalKeys = 0;
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
    this.reactCharacters(type, payload);
    if (type === 'round-end') this.banner = {
      text: `ROUND ${payload.round} ${payload.mine ? 'WIN' : 'LOSE'}`,
      sub: `${payload.wins.mine} : ${payload.wins.theirs} · ${payload.how === 'charged' ? '100% 충전' : '상대 방전'}`,
      at: wallSeconds(), color: payload.mine ? '#4df0a6' : '#ff5d73'
    };
    else if (type === 'stage-clear') this.banner = { text: `STAGE ${payload.stage} CLEAR`, sub: payload.how === 'charged' ? '100% 충전 완료! 충전 드론이 구조했습니다' : '방전봇 침몰!', at: wallSeconds() };

    if (!this.context) return;
    const now = wallSeconds();
    if (type === 'rival-take') {
      const { x, y } = this.itemPosition(payload.item);
      this.beams.push({ from: this.characterPosition('rival'), to: { x, y }, color: '#ff5d73', at: now });
      this.particles.burst(x, y, { color: '#ff5d73', count: 16, speed: 160, life: 0.5 });
    } else if (type === 'rival-attack') {
      const target = this.characterPosition('me');
      this.beams.push({ from: this.characterPosition('rival'), to: target, color: '#ff5d73', at: now });
      this.particles.burst(target.x, target.y + 10, { color: '#ff7a45', count: 20, speed: 180, life: 0.6, gravity: 300 });
    } else if (type === 'item') {
      const { x, y } = this.itemPosition(payload.item);
      this.particles.burst(x, y, { color: ITEM_STYLE[payload.item.item].color, count: 26, speed: 200, life: 0.7 });
      const me = this.characterPosition('me');
      this.particles.burst(me.x, me.y, { color: '#4df0a6', count: 14, speed: 120, life: 0.6, gravity: -120 });
    } else if (type === 'drain') {
      const rival = this.characterPosition('rival');
      this.particles.burst(rival.x, rival.y + 8, { color: '#ffe08a', count: 22, speed: 200, life: 0.6, gravity: 300 });
    } else if (type === 'stage-clear') {
      this.particles.burst(this.surface.width / 2, this.goalY, { color: '#4df0a6', count: 60, speed: 300, life: 1.2, gravity: 200 });
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
    this.updateCharacters(engine);
    // 탑 높이는 부드럽게 따라간다(셀이 쑥 늘거나 깎일 때 출렁임)
    for (const side of ['me', 'rival']) {
      const target = Math.max(0, engine[side].cells);
      this.displayCells[side] += (target - this.displayCells[side]) * Math.min(1, frameSeconds * 10 || 0.2);
    }

    const { width, height } = this.surface;
    context.clearRect(0, 0, width, height);
    this.drawSky(context, width, engine);
    this.drawChargingDrone(context, engine);
    this.drawGoalLine(context, width, engine);
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
    this.drawBlackout(context, width, engine);
    this.drawBanner(context, width, engine);
  }

  // 밤하늘: 위는 깊은 남색, 수평선 쪽은 도시 불빛이 번진 따뜻한 남보라. 별·초승달·통신탑 실루엣
  drawSky(context, width, engine) {
    const sky = context.createLinearGradient(0, HUD_HEIGHT, 0, this.waterY);
    sky.addColorStop(0, SCENE.skyTop);
    sky.addColorStop(0.6, SCENE.skyMid);
    sky.addColorStop(1, SCENE.skyHorizon);
    context.fillStyle = sky;
    context.fillRect(0, 0, width, this.waterY);
    const glow = context.createRadialGradient(width / 2, this.waterY + 30, 10, width / 2, this.waterY + 30, width * 0.62);
    glow.addColorStop(0, 'rgba(255, 181, 71, 0.09)');
    glow.addColorStop(1, 'rgba(255, 181, 71, 0)');
    context.fillStyle = glow;
    context.fillRect(0, HUD_HEIGHT, width, this.waterY - HUD_HEIGHT);
    this.drawStars(context, width, engine);
    this.drawMoon(context, width);
    this.drawSkyline(context, width, engine);
  }

  // 별 48개: 위치는 고정, 크기 1~2px, 각자 다른 박자로 깜빡인다. O(48)
  drawStars(context, width, engine) {
    const random = seededRandom(7);
    const span = (this.waterY - HUD_HEIGHT) * 0.72;
    for (let star = 0; star < 48; star++) {
      const x = random() * width;
      const y = HUD_HEIGHT + 6 + random() * span;
      const size = random() < 0.18 ? 2 : 1;
      const twinkle = 0.5 + 0.5 * Math.sin(engine.gameTime * (0.8 + random() * 2.2) + star * 1.7);
      context.globalAlpha = (size === 2 ? 0.45 : 0.25) + twinkle * 0.4;
      context.fillStyle = random() < 0.2 ? '#ffe2a8' : '#b9cdfa';
      context.fillRect(Math.round(x), Math.round(y), size, size);
    }
    context.globalAlpha = 1;
  }

  drawMoon(context, width) {
    const x = width * 0.63;
    const y = this.goalY + 52;
    const halo = context.createRadialGradient(x, y, 4, x, y, 46);
    halo.addColorStop(0, 'rgba(233, 237, 248, 0.16)');
    halo.addColorStop(1, 'rgba(233, 237, 248, 0)');
    context.fillStyle = halo;
    context.fillRect(x - 46, y - 46, 92, 92);
    context.fillStyle = '#f3ecd6';
    context.beginPath();
    context.arc(x, y, 11, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = SCENE.skyTop;
    context.beginPath();
    context.arc(x + 5, y - 3, 10, 0, Math.PI * 2);
    context.fill();
  }

  // 수평선 위 도시 실루엣 + 이동통신 철탑(빨간 항공등 깜빡임, 가운데 철탑은 전파 고리를 내보낸다).
  // 건물 배치는 캔버스 폭마다 한 번만 만들어 캐시한다. 그리기는 건물 수 b, 창 수 w에 대해 O(b + w)
  skylineLayout(width) {
    if (this.skyline?.width === width) return this.skyline;
    const random = seededRandom(1234);
    const buildings = [];
    for (let x = -10; x < width + 10;) {
      const buildingWidth = 18 + random() * 34;
      const height = 10 + random() * random() * 46;
      const windows = [];
      for (let row = 6; row < height - 4; row += 7) {
        for (let column = 4; column < buildingWidth - 4; column += 7) {
          if (random() < 0.16) windows.push({ x: column, y: row, color: SCENE.window[Math.floor(random() * SCENE.window.length)], phase: random() * 40 });
        }
      }
      buildings.push({ x, width: buildingWidth, height, windows });
      x += buildingWidth + (random() < 0.3 ? 4 + random() * 10 : -2);
    }
    const towers = [0.07, 0.43, 0.94].map((ratio, index) => ({ x: width * ratio, height: 64 + index % 2 * 20 + random() * 10, phase: random() * 3 }));
    this.skyline = { width, buildings, towers };
    return this.skyline;
  }

  drawSkyline(context, width, engine) {
    const { buildings, towers } = this.skylineLayout(width);
    const base = this.waterY + 2;
    for (const tower of towers) this.drawCellTower(context, tower, base, engine);
    for (const building of buildings) {
      context.fillStyle = SCENE.skyline;
      context.fillRect(building.x, base - building.height, building.width, building.height);
      context.fillStyle = SCENE.skylineEdge;
      context.fillRect(building.x, base - building.height, building.width, 1);
      for (const light of building.windows) {
        // 창 불빛은 아주 느리게 켜졌다 꺼진다(40초 주기 중 일부만 꺼짐)
        if ((engine.gameTime + light.phase) % 40 > 36) continue;
        context.globalAlpha = 0.55;
        context.fillStyle = light.color;
        context.fillRect(building.x + light.x, base - building.height + light.y, 2, 2);
      }
      context.globalAlpha = 1;
    }
  }

  drawCellTower(context, tower, base, engine) {
    const { x, height } = tower;
    const top = base - height;
    context.strokeStyle = '#1c2350';
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(x - 9, base);
    context.lineTo(x - 2, top + 8);
    context.moveTo(x + 9, base);
    context.lineTo(x + 2, top + 8);
    // 격자 가새
    for (let step = 0; step < 5; step++) {
      const y0 = base - step * (height - 8) / 5;
      const y1 = base - (step + 1) * (height - 8) / 5;
      const half0 = 9 - 7 * step / 5;
      const half1 = 9 - 7 * (step + 1) / 5;
      context.moveTo(x - half0, y0);
      context.lineTo(x + half1, y1);
      context.moveTo(x + half0, y0);
      context.lineTo(x - half1, y1);
    }
    context.moveTo(x, top + 8);
    context.lineTo(x, top - 6);
    context.stroke();
    // 안테나 패널
    context.fillStyle = '#232b5c';
    context.fillRect(x - 6, top + 6, 3, 9);
    context.fillRect(x + 3, top + 6, 3, 9);
    // 항공등
    const on = Math.sin(engine.gameTime * 3.2 + tower.phase) > 0.2;
    context.fillStyle = on ? '#ff5d73' : '#4a1f2c';
    context.shadowColor = '#ff5d73';
    context.shadowBlur = on ? 10 : 0;
    context.fillRect(x - 1.5, top - 8, 3, 3);
    context.shadowBlur = 0;
    // 전파 고리: 가장 높은 철탑에서 2.4초마다 퍼진다
    if (height > 80) {
      const progress = ((engine.gameTime + tower.phase) % 2.4) / 2.4;
      context.strokeStyle = `rgba(127, 216, 255, ${0.35 * (1 - progress)})`;
      context.lineWidth = 1.2;
      for (const ring of [0, 0.35]) {
        const radius = 6 + (progress + ring) % 1 * 30;
        context.beginPath();
        context.arc(x, top - 6, radius, Math.PI * 1.2, Math.PI * 1.8);
        context.stroke();
      }
    }
  }

  // 충전 드론: 위에서 좌우로 천천히 오가며(이동 방향으로 살짝 기울어짐) 100% 선까지 충전 케이블을 늘어뜨린다
  drawChargingDrone(context, engine) {
    const sway = engine.gameTime * 0.8;
    const x = this.surface.width / 2 + Math.sin(sway) * 20;
    const y = HUD_HEIGHT + 28 + Math.sin(engine.gameTime * 2.2) * 2;
    const size = 1.25;
    const cableTop = y + 9 * size;
    context.strokeStyle = 'rgba(77, 240, 166, 0.6)';
    context.lineWidth = 1.6;
    context.beginPath();
    context.moveTo(x, cableTop);
    context.quadraticCurveTo(x - Math.cos(sway) * 10, (cableTop + this.goalY) / 2, x, this.goalY - 7);
    context.stroke();
    context.fillStyle = '#c9d4e0';
    roundedRect(context, x - 4, this.goalY - 9, 8, 7, 2);
    context.fill();
    context.fillStyle = '#4df0a6';
    context.fillRect(x - 2, this.goalY - 2, 1.5, 3);
    context.fillRect(x + 0.5, this.goalY - 2, 1.5, 3);
    drawDrone(context, { x, y, size, time: engine.gameTime, accent: '#4df0a6', tilt: Math.cos(sway) * 0.09, seed: 3 });
  }

  // 100% 구조선: 드론 플러그에서 양쪽으로 전기가 흐르는 충전 레일
  drawGoalLine(context, width, engine) {
    const y = Math.round(this.goalY);
    const band = context.createLinearGradient(0, y - 12, 0, y + 12);
    band.addColorStop(0, 'rgba(77, 240, 166, 0)');
    band.addColorStop(0.5, 'rgba(77, 240, 166, 0.12)');
    band.addColorStop(1, 'rgba(77, 240, 166, 0)');
    context.fillStyle = band;
    context.fillRect(0, y - 12, width, 24);
    context.fillStyle = 'rgba(77, 240, 166, 0.28)';
    context.fillRect(0, y - 1, width, 2);
    const offset = (engine.gameTime * 48) % 22;
    const center = width / 2;
    context.fillStyle = SCENE.rail;
    context.shadowColor = SCENE.rail;
    context.shadowBlur = 6;
    for (let x = center + offset; x < width; x += 22) context.fillRect(x, y - 1, 9, 2);
    for (let x = center - offset - 9; x > -9; x -= 22) context.fillRect(x, y - 1, 9, 2);
    context.shadowBlur = 0;

    context.font = canvasFont(12);
    context.textBaseline = 'middle';
    const label = '100% 구조선';
    const labelWidth = context.measureText(label).width + 14;
    context.fillStyle = 'rgba(8, 26, 20, 0.92)';
    roundedRect(context, 8, y - 10, labelWidth, 20, 10);
    context.fill();
    context.strokeStyle = 'rgba(77, 240, 166, 0.55)';
    context.lineWidth = 1;
    context.stroke();
    context.fillStyle = SCENE.rail;
    context.fillText(label, 15, y + 1);

    // 눈금: 칸마다 양 끝 짧은 선, 25·50·75%에는 숫자
    for (let cell = 1; cell < BATTERY_RULES.goalCells; cell++) {
      const tickY = Math.round(this.waterY - cell * this.cellHeight);
      const major = cell % 2 === 0;
      context.fillStyle = major ? 'rgba(138, 147, 184, 0.5)' : 'rgba(138, 147, 184, 0.25)';
      context.fillRect(0, tickY, major ? 8 : 5, 1);
      context.fillRect(width - (major ? 8 : 5), tickY, major ? 8 : 5, 1);
      // 좁은 화면에서는 % 숫자가 내 탑 낱말과 겹치므로 눈금만 남긴다
      if (major && width >= 520) {
        context.fillStyle = 'rgba(138, 147, 184, 0.45)';
        context.fillText(`${Math.round(cell / BATTERY_RULES.goalCells * 100)}%`, 12, tickY + 1);
      }
    }
  }

  // 배터리 셀을 쌓은 탑. 셀은 원통 음영 + 유광 줄 + 양극(+) 표시, 맨 위 셀은 남은 비율만큼 채운다. 물속 부분은 바다가 덮는다.
  drawTower(context, side, engine) {
    const style = SIDE_STYLE[side];
    const cells = this.displayCells[side];
    const x = this.towerX(side);
    const width = this.towerWidth();
    const left = x - width / 2;
    const cellHeight = this.cellHeight;
    const effects = engine[side];
    const heat = engine.gameTime < effects.heatUntil;
    const eco = engine.gameTime < effects.ecoUntil;
    const fullCells = Math.floor(cells);
    const total = Math.ceil(cells) + 2;
    const shading = context.createLinearGradient(left, 0, left + width, 0);
    shading.addColorStop(0, style.bottom);
    shading.addColorStop(0.32, style.top);
    shading.addColorStop(0.62, style.top);
    shading.addColorStop(1, style.bottom);
    for (let index = -2; index < total - 2; index++) {
      const fill = index < fullCells ? 1 : Math.max(0, cells - fullCells);
      const top = this.waterY - (index + 1) * cellHeight;
      const innerTop = top + 4;
      const innerHeight = cellHeight - 7;
      context.fillStyle = '#0a0f22';
      roundedRect(context, left, top + 2, width, cellHeight - 3, 6);
      context.fill();
      if (fill > 0 || index < 0) {
        const fillRatio = index < 0 ? 1 : fill;
        const fillTop = innerTop + innerHeight * (1 - fillRatio);
        context.fillStyle = shading;
        context.globalAlpha = heat && Math.sin(engine.gameTime * 20 + index) > 0 ? 0.72 : 1;
        roundedRect(context, left + 3, fillTop, width - 6, innerHeight * fillRatio, 4);
        context.fill();
        context.globalAlpha = 1;
        // 유광 줄
        context.fillStyle = 'rgba(255, 255, 255, 0.28)';
        context.fillRect(left + width * 0.22, fillTop + 3, 3, Math.max(0, innerHeight * fillRatio - 6));
        // 덜 찬 셀의 수면: 밝은 띠
        if (fillRatio < 1) {
          context.fillStyle = 'rgba(255, 255, 255, 0.55)';
          context.fillRect(left + 5, fillTop, width - 10, 1.5);
        }
        if (fillRatio > 0.55) {
          const plus = Math.max(6, Math.min(12, cellHeight * 0.28));
          context.fillStyle = 'rgba(10, 15, 34, 0.38)';
          context.fillRect(x - plus / 2 + 3, top + cellHeight / 2 - 1, plus, 2.5);
          context.fillRect(x + 3 - 1.25, top + cellHeight / 2 - plus / 2, 2.5, plus);
        }
      }
      context.strokeStyle = 'rgba(233, 237, 248, 0.16)';
      context.lineWidth = 1;
      roundedRect(context, left + 0.5, top + 2.5, width - 1, cellHeight - 4, 6);
      context.stroke();
    }
    // 양극 단자(금속)
    const topY = this.towerTopY(cells);
    const cap = context.createLinearGradient(x - 9, 0, x + 9, 0);
    cap.addColorStop(0, '#5d6690');
    cap.addColorStop(0.45, '#d9def0');
    cap.addColorStop(1, '#5d6690');
    context.fillStyle = cap;
    roundedRect(context, x - 9, topY - 4, 18, 6, 2);
    context.fill();
    // 탑 바깥 은은한 빛
    context.save();
    context.globalCompositeOperation = 'lighter';
    const aura = context.createLinearGradient(left - 14, 0, left + width + 14, 0);
    aura.addColorStop(0, 'rgba(0, 0, 0, 0)');
    aura.addColorStop(0.5, `${style.glow}14`);
    aura.addColorStop(1, 'rgba(0, 0, 0, 0)');
    context.fillStyle = aura;
    context.fillRect(left - 14, topY, width + 28, this.waterY - topY);
    context.restore();
    if (eco) {
      context.strokeStyle = `rgba(195, 232, 141, ${0.4 + 0.3 * Math.sin(engine.gameTime * 6)})`;
      context.lineWidth = 3;
      roundedRect(context, left - 6, topY - 6, width + 12, this.waterY - topY + 6, 8);
      context.stroke();
    }
    if (heat && Math.random() < 0.5) {
      this.particles.burst(x + (Math.random() - 0.5) * width, this.waterY - 4, { color: '#ff7a45', count: 1, speed: 30, life: 0.6, gravity: -200, size: 3 });
    }
  }

  // 방전의 바다: 뒤 물결 + 앞 물결 두 겹, 탑 그림자가 비치고 기포가 올라온다. 내 탑이 위험하면 붉게 맥박친다
  waveY(x, time, layer = 0) {
    return layer === 0
      ? this.waterY + Math.sin(x / 30 + time * 2.2) * 4 + Math.sin(x / 11 + time * 3.1) * 1.2
      : this.waterY - 5 + Math.sin(x / 44 - time * 1.4 + 1.3) * 3;
  }

  traceWave(context, width, time, layer) {
    for (let x = 0; x <= width + 8; x += 8) {
      const y = this.waveY(x, time, layer);
      if (x === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
  }

  drawSea(context, width, height, engine) {
    const time = engine.gameTime;
    const danger = engine.me.cells < 1.2 && engine.status === 'running';
    const pulse = danger ? (Math.sin(time * 8) + 1) / 2 : 0;

    context.beginPath();
    this.traceWave(context, width, time, 1);
    context.lineTo(width, height);
    context.lineTo(0, height);
    context.closePath();
    context.fillStyle = SCENE.seaBack;
    context.fill();

    context.beginPath();
    this.traceWave(context, width, time, 0);
    context.lineTo(width, height);
    context.lineTo(0, height);
    context.closePath();
    const sea = context.createLinearGradient(0, this.waterY, 0, height);
    sea.addColorStop(0, danger ? `rgba(${Math.round(22 + 100 * pulse)}, ${Math.round(48 - 18 * pulse)}, ${Math.round(106 - 48 * pulse)}, 0.94)` : 'rgba(22, 48, 106, 0.94)');
    sea.addColorStop(1, 'rgba(6, 10, 25, 0.99)');
    context.fillStyle = sea;
    context.fill();

    this.drawReflections(context, height, engine);

    // 물마루
    context.beginPath();
    this.traceWave(context, width, time, 0);
    context.strokeStyle = danger ? `rgba(255, 93, 115, ${0.5 + 0.4 * pulse})` : 'rgba(127, 167, 245, 0.85)';
    context.lineWidth = 1.6;
    context.stroke();

    // 기포 14개: 바닥에서 올라와 수면에서 사라진다. O(14)
    const random = seededRandom(99);
    for (let bubble = 0; bubble < 14; bubble++) {
      const speed = 10 + random() * 16;
      const x = random() * width + Math.sin(time * 2 + bubble) * 3;
      const travel = (time * speed + random() * 60) % (height - this.waterY);
      const y = height - travel;
      if (y < this.waterY + 6) continue;
      context.globalAlpha = 0.18 + 0.25 * (travel / (height - this.waterY));
      context.strokeStyle = '#9cc3ff';
      context.lineWidth = 1;
      context.beginPath();
      context.arc(x, y, 1.2 + random() * 1.6, 0, Math.PI * 2);
      context.stroke();
    }
    context.globalAlpha = 1;

    context.font = canvasFont(12);
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = danger ? `rgba(255, 141, 156, ${0.5 + 0.4 * pulse})` : 'rgba(156, 195, 255, 0.42)';
    context.fillText(danger ? '방전 직전! 셀을 충전하세요' : '0% · 방전의 바다', width / 2, height - 14);
    context.textAlign = 'start';
  }

  // 탑 빛이 물에 일렁이며 비친다. 줄 수 r에 대해 O(r)
  drawReflections(context, height, engine) {
    context.save();
    context.globalCompositeOperation = 'lighter';
    for (const side of ['me', 'rival']) {
      const x = this.towerX(side);
      const width = this.towerWidth();
      context.fillStyle = SIDE_STYLE[side].glow;
      for (let y = this.waterY + 4; y < height - 4; y += 4) {
        const depth = (y - this.waterY) / (height - this.waterY);
        const sway = Math.sin(y * 0.35 + engine.gameTime * 4 + (side === 'me' ? 0 : 2)) * 4 * (0.4 + depth);
        const span = width * (0.75 - depth * 0.35) * (0.8 + 0.2 * Math.sin(y * 0.9 + engine.gameTime * 6));
        context.globalAlpha = 0.16 * (1 - depth);
        context.fillRect(x - span / 2 + sway, y, span, 2);
      }
    }
    context.restore();
  }

  // 사건 → 캐릭터 반응. 내 쪽: 조준·한 타·오타·발사·충전 / 상대 쪽: 가져감·공격 / 판·스테이지 끝
  reactCharacters(type, payload) {
    const { me, rival } = this.rigs;
    if (type === 'lock') reactRig(me, 'lock');
    else if (type === 'keystroke') reactRig(me, 'key');
    else if (type === 'mistake' || type === 'claim-rejected') reactRig(me, 'oops');
    else if (type === 'throw') reactRig(me, 'cast');
    else if (type === 'item') reactRig(me, 'cheer');
    else if (type === 'drain') {
      reactRig(me, 'cheer');
      reactRig(rival, 'hurt');
    } else if (type === 'rival-take') {
      reactRig(rival, 'cheer');
      reactRig(me, 'oops');
    } else if (type === 'rival-attack') {
      reactRig(rival, 'cast');
      reactRig(me, 'hurt');
    } else if (type === 'stage-clear') {
      reactRig(me, 'cheer');
      reactRig(rival, 'hurt');
    } else if (type === 'round-end') {
      reactRig(payload.mine ? me : rival, 'cheer');
      reactRig(payload.mine ? rival : me, 'hurt');
    }
  }

  // 매 프레임: 상대가 한 글자 칠 때마다 손 까딱 + 두 캐릭터의 상태(조준 대상·위급·잠·승패)를 리그에 넘긴다. O(1)
  updateCharacters(engine) {
    const now = performance.now() / 1000;
    const seconds = this.rigClock === null ? 1 / 60 : now - this.rigClock;
    this.rigClock = now;
    const rivalKeys = engine.ai.targetId === null ? 0 : Math.floor(engine.ai.progress);
    if (rivalKeys > this.rivalKeys) reactRig(this.rigs.rival, 'key');
    this.rivalKeys = rivalKeys;
    for (const side of ['me', 'rival']) updateRig(this.rigs[side], this.characterState(side, engine), seconds);
  }

  characterState(side, engine) {
    const opponent = side === 'me' ? 'rival' : 'me';
    const position = this.characterPosition(side);
    const finished = engine.status === 'finished';
    const iWon = engine.me.cells >= engine.rival.cells;
    const sleeping = side === 'rival'
      ? engine.gameTime < engine.ai.pausedUntil
      : isPvp(engine) && engine.gameTime < (engine.blockedUntil ?? 0);
    const targetId = side === 'me' ? engine.targetId : engine.ai.targetId;
    const target = targetId === null || targetId === undefined ? null : engine.findEntity(targetId);
    let aimPoint = null;
    if (target && !(target.kind === 'item' && target.consumed)) {
      if (target.kind === 'item') aimPoint = this.itemPosition(target);
      else {
        const other = this.characterPosition(opponent);
        aimPoint = { x: other.x, y: other.y - 26 };
      }
    }
    const look = aimPoint ? { x: aimPoint.x - position.x, y: aimPoint.y - (position.y - 26) } : null;
    // 목표가 등 뒤에 있으면 돌아선다. 목표가 없으면 상대 쪽을 본다
    const defaultFacing = side === 'me' ? 1 : -1;
    const facing = look && Math.abs(look.x) > 24 ? Math.sign(look.x) : defaultFacing;
    const typing = side === 'me'
      ? targetId !== null && engine.typed.length > 0 && engine.status === 'running'
      : targetId !== null && engine.status === 'running';
    const cells = engine[side].cells;
    return {
      typing, look, facing, sleeping,
      worried: !finished && cells < 1.6,
      excited: !finished && cells / BATTERY_RULES.goalCells > 0.78,
      result: finished ? ((side === 'me') === iWon ? 'win' : 'lose') : null
    };
  }

  // 캐릭터: 내 폰(스마트폰 마스코트) / 상대(PvP 폰 · 방전봇). 몸놀림은 battery-characters.js의 리그가 정한다
  drawCharacter(context, side, engine) {
    const { x, y } = this.characterPosition(side);
    const rig = this.rigs[side];
    const state = this.characterState(side, engine);
    const percent = Math.max(0, Math.min(1, engine[side].cells / BATTERY_RULES.goalCells));
    context.save();
    context.translate(x, y - 2);
    if (side === 'me' || isPvp(engine)) {
      drawPhoneMascot(context, rig, {
        palette: side === 'me' ? MASCOT_PALETTES.me : MASCOT_PALETTES.opponent,
        percent, sleeping: state.sleeping, worried: state.worried, result: state.result
      });
    } else {
      drawDrainBot(context, rig, { paused: state.sleeping, worried: state.worried, result: state.result });
    }
    if (state.sleeping) {
      context.fillStyle = '#c792ea';
      context.font = canvasFont(12);
      context.textAlign = 'center';
      const drift = (rig.clock * 0.8) % 1;
      context.globalAlpha = 1 - drift;
      context.fillText('Z', rig.facing * 12 + drift * 8 * rig.facing, -50 - drift * 14);
      context.globalAlpha = 1;
      context.fillText('z', rig.facing * 8, -44);
      context.textAlign = 'start';
    }
    context.restore();
  }

  // 탑 꼭대기 셀 낱말: 상대 탑 = 내가 칠 낱말, 내 탑 = 방전봇이 노리는 낱말(AI 진행도 빨간 밑줄)
  drawTowerLabels(context, engine) {
    const compact = this.surface.width < 520;
    const rival = this.characterPosition('rival');
    const hidden = engine.gameTime < engine.hiddenUntil;
    const rivalPop = this.visuals.get(engine.rivalWord.id).labelPop.value * 0.4;
    const labelX = Math.min(this.surface.width - 70, Math.max(70, rival.x));
    if (hidden) {
      context.font = canvasFont(12);
      context.fillStyle = '#c792ea';
      context.textAlign = 'center';
      context.fillText('▒▒ 화면 꺼짐 ▒▒', labelX, rival.y - 66);
      context.textAlign = 'start';
    } else {
      drawTokenLabel(context, labelX, rival.y - 56 - rivalPop, engine.rivalWord, engine.getCharacterStates(engine.rivalWord), {
        active: engine.rivalWord.id === engine.targetId, accent: '#ff5d73', compact
      });
    }
    const me = this.characterPosition('me');
    const meX = Math.min(this.surface.width - 70, Math.max(70, me.x));
    context.save();
    context.globalAlpha = this.labelCrowded(engine, meX, me.y - 56) ? 0.18 : 0.85;
    drawTokenLabel(context, meX, me.y - 56, engine.myWord, engine.myWord.token.text.split('').map(() => 'pending'), {
      active: false, accent: '#ff5d73', compact, attacker: engine.aiProgressFor(engine.myWord.id)
    });
    context.restore();
    if (engine.ai.targetId === engine.myWord.id) {
      context.font = canvasFont(12);
      context.fillStyle = '#ff5d73';
      context.textAlign = 'center';
      context.fillText(`⚠ ${rivalLabel(engine)} 공격 중`, meX, me.y - 84);
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
    context.fillRect(-5, 0, 8, 2);
    context.fillRect(-2, -3, 2, 8);
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
    context.font = canvasFont(12);
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
    const origin = this.characterPosition('me');
    const start = { x: origin.x + this.rigs.me.facing * 22, y: origin.y + 4 };
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

  // 위 계기판: 양쪽에 배터리 게이지(아이콘 + 이름 + %), 가운데 스테이지/라운드 알약
  drawHud(context, width, engine) {
    const gradient = context.createLinearGradient(0, 0, 0, HUD_HEIGHT);
    gradient.addColorStop(0, 'rgba(14, 18, 34, 0.96)');
    gradient.addColorStop(1, 'rgba(9, 12, 24, 0.92)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, HUD_HEIGHT);
    context.fillStyle = 'rgba(42, 49, 82, 0.9)';
    context.fillRect(0, HUD_HEIGHT - 1, width, 1);
    const ratio = side => Math.max(0, Math.min(1, engine[side].cells / BATTERY_RULES.goalCells));
    const middle = HUD_HEIGHT / 2 + 1;
    context.font = canvasFont(12);
    context.textBaseline = 'middle';

    this.drawGauge(context, 12, middle, ratio('me'), SIDE_STYLE.me.label, false);
    context.fillStyle = SCENE.fog;
    context.fillText('나', 46, middle);
    context.fillStyle = SIDE_STYLE.me.label;
    context.fillText(`${Math.round(ratio('me') * 100)}%`, 64, middle);

    const rivalName = isPvp(engine) ? rivalLabel(engine).slice(0, 8) : '방전봇';
    this.drawGauge(context, width - 40, middle, ratio('rival'), SIDE_STYLE.rival.label, true);
    context.textAlign = 'right';
    context.fillStyle = SCENE.fog;
    const percentText = `${Math.round(ratio('rival') * 100)}%`;
    context.fillText(rivalName, width - 46, middle);
    context.fillStyle = SIDE_STYLE.rival.label;
    context.fillText(percentText, width - 52 - context.measureText(rivalName).width, middle);

    const center = isPvp(engine) ? `ROUND ${engine.round} · ${engine.wins.mine}:${engine.wins.theirs}` : `STAGE ${engine.stage}`;
    context.textAlign = 'center';
    const pillWidth = context.measureText(center).width + 22;
    context.fillStyle = 'rgba(28, 34, 64, 0.95)';
    roundedRect(context, width / 2 - pillWidth / 2, middle - 10, pillWidth, 20, 10);
    context.fill();
    context.strokeStyle = 'rgba(255, 181, 71, 0.35)';
    context.lineWidth = 1;
    context.stroke();
    context.fillStyle = '#ffb547';
    context.fillText(center, width / 2, middle + 1);
    context.textAlign = 'start';
  }

  // 배터리 아이콘 게이지(26×12): 20% 아래면 코럴로 바뀌어 깜빡인다. mirrored면 단자가 왼쪽
  drawGauge(context, x, centerY, ratio, color, mirrored) {
    const top = Math.round(centerY - 6);
    const low = ratio < 0.2;
    const tone = low ? '#ff5d73' : color;
    context.strokeStyle = 'rgba(233, 237, 248, 0.55)';
    context.lineWidth = 1.2;
    roundedRect(context, x + 0.5, top + 0.5, 25, 12, 2.5);
    context.stroke();
    context.fillStyle = 'rgba(233, 237, 248, 0.55)';
    context.fillRect(mirrored ? x - 2 : x + 26, top + 3.5, 2, 6);
    context.globalAlpha = low && Math.sin(performance.now() / 120) > 0 ? 0.45 : 1;
    context.fillStyle = tone;
    const inner = 21 * ratio;
    context.fillRect(mirrored ? x + 23 - inner : x + 3, top + 3, inner, 7);
    context.globalAlpha = 1;
  }

  // PvP: 상대가 '화면 꺼짐'을 가져가면 내 화면이 3초 동안 어두워지고 입력이 막힌다
  drawBlackout(context, width, engine) {
    const remaining = (engine.blockedUntil ?? 0) - engine.gameTime;
    if (!isPvp(engine) || remaining <= 0 || engine.status !== 'running') return;
    context.fillStyle = `rgba(3, 5, 9, ${Math.min(0.82, remaining * 2)})`;
    context.fillRect(0, HUD_HEIGHT, width, this.surface.height - HUD_HEIGHT);
    context.textAlign = 'center';
    context.fillStyle = '#c792ea';
    context.font = canvasFont(24);
    context.fillText(`화면 꺼짐 ${remaining.toFixed(1)}s`, width / 2, this.surface.height * 0.45);
    context.fillStyle = SCENE.fog;
    context.font = canvasFont(13, 'ui', 500);
    context.fillText(`${rivalLabel(engine)}이(가) 화면 꺼짐을 가져갔습니다`, width / 2, this.surface.height * 0.45 + 24);
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
    const bannerColor = this.banner.color ?? '#4df0a6';
    context.save();
    context.globalAlpha = alpha;
    context.translate(width / 2, this.surface.height * 0.42);
    context.scale(scale, scale);
    context.font = canvasFont(24);
    const panelWidth = Math.max(280, context.measureText(this.banner.text).width + 64);
    context.shadowColor = 'rgba(0, 0, 0, 0.5)';
    context.shadowBlur = 24;
    context.fillStyle = 'rgba(14, 18, 34, 0.94)';
    roundedRect(context, -panelWidth / 2, -38, panelWidth, 76, 14);
    context.fill();
    context.shadowBlur = 0;
    context.strokeStyle = 'rgba(42, 49, 82, 1)';
    context.lineWidth = 1;
    context.stroke();
    context.fillStyle = bannerColor;
    context.shadowColor = bannerColor;
    context.shadowBlur = 12;
    roundedRect(context, -panelWidth / 2 + 20, -38, panelWidth - 40, 3, 1.5);
    context.fill();
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(this.banner.text, 0, -7);
    context.shadowBlur = 0;
    context.fillStyle = SCENE.fog;
    context.font = canvasFont(13, 'ui', 500);
    context.fillText(this.banner.sub, 0, 19);
    context.restore();
    context.textAlign = 'start';
  }
}
