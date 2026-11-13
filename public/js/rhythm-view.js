// 리듬 모드 화면: 4레인, 위에서 떨어지는 낱말 노트, 아래 판정선. 박마다 판정선이 숨쉬고, 박·마디 선이 노트와 함께 내려온다.
// 노트 위치 = 판정선 − (정박 시각 − 게임 시간) ÷ 떨어지는 시간 × 레인 높이. 게임 시간은 오디오 시계를 따른다.
import { setupCanvas, roundedRect, drawTokenLabel, ParticleSystem, canvasFont } from './game-view.js';
import { RHYTHM_LANES, RHYTHM_RULES, BEAT_SECONDS } from './rhythm-engine.js';

const HUD_HEIGHT = 40;
const JUDGE_FROM_BOTTOM = 64;
const JUDGEMENT_STYLE = Object.freeze({
  perfect: { label: 'PERFECT', color: '#ffe066' },
  great: { label: 'GREAT', color: '#39ff88' },
  good: { label: 'GOOD', color: '#36e2ff' },
  bad: { label: 'BAD', color: '#c792ea' },
  miss: { label: 'MISS', color: '#ff4d6d' }
});

export class RhythmRenderer {
  constructor(canvas) {
    this.surface = setupCanvas(canvas);
    this.particles = new ParticleSystem();
    this.laneFlash = RHYTHM_LANES.map(() => ({ amount: 0, color: '#ffffff' }));
    this.popup = null;
    this.lastGameTime = 0;
  }

  get context() {
    return this.surface.context;
  }

  // 레인 위치: 가운데 정렬, 레인당 최대 140px
  layout() {
    const { width, height } = this.surface;
    const laneWidth = Math.min(140, (width - 24) / RHYTHM_LANES.length);
    const left = (width - laneWidth * RHYTHM_LANES.length) / 2;
    const judgeY = height - JUDGE_FROM_BOTTOM;
    return { width, height, laneWidth, left, judgeY, topY: HUD_HEIGHT + 6 };
  }

  laneCenter(lane, layout) {
    return layout.left + layout.laneWidth * (lane + 0.5);
  }

  noteY(note, engine, layout) {
    const ahead = (note.hitTime - engine.gameTime) / engine.fallSeconds;
    return layout.judgeY - ahead * (layout.judgeY - layout.topY);
  }

  onEvent(type, payload) {
    const layout = this.layout();
    if (type === 'judge') {
      const style = JUDGEMENT_STYLE[payload.judgement];
      const flash = this.laneFlash[payload.lane];
      flash.amount = 1;
      flash.color = style.color;
      this.popup = { ...style, at: performance.now(), combo: payload.combo, delta: payload.delta };
      if (payload.judgement !== 'bad') {
        this.particles.burst(this.laneCenter(payload.lane, layout), layout.judgeY, { color: style.color, count: payload.judgement === 'perfect' ? 26 : 16, speed: 200, life: 0.5, gravity: 260 });
      }
    } else if (type === 'miss') {
      const flash = this.laneFlash[payload.note.lane];
      flash.amount = 0.8;
      flash.color = JUDGEMENT_STYLE.miss.color;
      this.popup = { ...JUDGEMENT_STYLE.miss, at: performance.now(), combo: 0, delta: null };
    }
  }

  render(engine, { accent }) {
    const context = this.context;
    if (!context) return;
    this.surface.resize?.();
    const layout = this.layout();
    const { width, height, laneWidth, left, judgeY, topY } = layout;
    const frameSeconds = Math.min(0.1, Math.max(0, engine.gameTime - this.lastGameTime)) || 1 / 60;
    this.lastGameTime = engine.gameTime;
    this.particles.update(frameSeconds);
    for (const flash of this.laneFlash) flash.amount = Math.max(0, flash.amount - frameSeconds * 3.5);

    const beatPhase = engine.status === 'running' ? ((engine.gameTime / BEAT_SECONDS) % 1 + 1) % 1 : 0.5;
    const pulse = Math.max(0, 1 - beatPhase * 3.5);

    context.fillStyle = '#05070c';
    context.fillRect(0, 0, width, height);

    // 레인 바탕 + 맞힌 레인 번쩍임
    RHYTHM_LANES.forEach((lane, index) => {
      const x = left + index * laneWidth;
      const gradient = context.createLinearGradient(0, topY, 0, judgeY);
      gradient.addColorStop(0, 'rgba(255, 255, 255, 0)');
      gradient.addColorStop(1, hexAlpha(lane.color, 0.08 + this.laneFlash[index].amount * 0.25));
      context.fillStyle = gradient;
      context.fillRect(x, topY, laneWidth, judgeY - topY);
      context.fillStyle = 'rgba(120, 140, 170, 0.18)';
      context.fillRect(x, topY, 1, height - topY);
      if (this.laneFlash[index].amount > 0) {
        context.fillStyle = hexAlpha(this.laneFlash[index].color, this.laneFlash[index].amount * 0.35);
        context.fillRect(x, judgeY - 90, laneWidth, 90);
      }
    });
    context.fillStyle = 'rgba(120, 140, 170, 0.18)';
    context.fillRect(left + laneWidth * RHYTHM_LANES.length, topY, 1, height - topY);

    // 박·마디 선(노트와 같은 속도로 내려온다)
    if (engine.status !== 'ready') {
      const firstBeat = Math.ceil(engine.gameTime / BEAT_SECONDS);
      const lastBeat = Math.floor((engine.gameTime + engine.fallSeconds) / BEAT_SECONDS);
      for (let beat = firstBeat; beat <= lastBeat; beat++) {
        const y = this.noteY({ hitTime: beat * BEAT_SECONDS }, engine, layout);
        const bar = beat % RHYTHM_RULES.beatsPerBar === 0;
        context.fillStyle = bar ? 'rgba(160, 180, 220, 0.22)' : 'rgba(160, 180, 220, 0.08)';
        context.fillRect(left, Math.round(y), laneWidth * RHYTHM_LANES.length, bar ? 2 : 1);
      }
    }

    // 판정선: 박마다 밝아진다
    context.save();
    context.shadowColor = accent;
    context.shadowBlur = 10 + pulse * 18;
    context.fillStyle = accent;
    context.globalAlpha = 0.55 + pulse * 0.45;
    context.fillRect(left, judgeY - 1.5, laneWidth * RHYTHM_LANES.length, 3);
    context.restore();

    // 레인 이름
    context.font = canvasFont(11, 'ui', 600);
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    RHYTHM_LANES.forEach((lane, index) => {
      context.fillStyle = hexAlpha(lane.color, 0.85);
      context.fillText(lane.label, this.laneCenter(index, layout), judgeY + 26);
    });
    context.textAlign = 'left';

    // 노트: 늦게 떨어지는 것부터 그려 가까운(아래) 노트가 위에 오게
    const compact = laneWidth < 110;
    const notes = engine.visibleNotes().sort((first, second) => second.hitTime - first.hitTime);
    for (const note of notes) {
      const y = this.noteY(note, engine, layout);
      const centerX = this.clampLabel(this.laneCenter(note.lane, layout), note, compact);
      if (note.state === 'pending') {
        const active = engine.targetId === note.id || (!engine.targetId && engine.targetables()[0]?.id === note.id);
        const states = engine.getCharacterStates(note);
        if (active && engine.targetId !== note.id) states[0] = 'current';
        drawTokenLabel(context, centerX, y + (compact ? 10.5 : 12), note, states, { active, accent, compact });
      } else {
        // 판정된 노트는 판정선에서 퍼지며 사라진다
        const age = (engine.gameTime - note.resolvedAt) / 0.4;
        context.globalAlpha = Math.max(0, 1 - age);
        context.strokeStyle = JUDGEMENT_STYLE[note.judgement].color;
        context.lineWidth = 2;
        const spread = 18 + age * 30;
        roundedRect(context, centerX - spread, judgeY - 10 - age * 6, spread * 2, 20 + age * 12, 8);
        context.stroke();
        context.globalAlpha = 1;
      }
    }
    this.particles.draw(context);

    this.drawHud(context, engine, layout);
    this.drawPopup(context, engine, layout);
    this.drawCountIn(context, engine, layout);
  }

  // 긴 낱말이 화면 밖으로 나가지 않게
  clampLabel(centerX, note, compact) {
    const half = note.token.text.length * (compact ? 3.7 : 4.3) + 10;
    return Math.max(half + 4, Math.min(this.surface.width - half - 4, centerX));
  }

  drawHud(context, engine, layout) {
    const { width } = layout;
    const snapshot = engine.snapshot();
    // 체력 바
    const barWidth = Math.min(220, width * 0.42);
    context.fillStyle = 'rgba(255, 255, 255, 0.08)';
    roundedRect(context, 12, 12, barWidth, 10, 5);
    context.fill();
    const health = snapshot.health / 100;
    context.fillStyle = health > 0.5 ? '#39ff88' : health > 0.25 ? '#ffcb6b' : '#ff4d6d';
    roundedRect(context, 12, 12, Math.max(6, barWidth * health), 10, 5);
    context.fill();
    context.font = canvasFont(10, 'ui', 600);
    context.fillStyle = '#8a98aa';
    context.textBaseline = 'top';
    context.fillText(`HP ${Math.round(snapshot.health)}`, 12, 26);
    // 진행 바 + BPM
    context.textAlign = 'right';
    context.fillText(`♩=${snapshot.bpm} · ${Math.round(snapshot.progress * 100)}%`, width - 12, 26);
    context.fillStyle = 'rgba(255, 255, 255, 0.08)';
    context.fillRect(width - 12 - barWidth, 15, barWidth, 4);
    context.fillStyle = '#36e2ff';
    context.fillRect(width - 12 - barWidth, 15, barWidth * snapshot.progress, 4);
    context.textAlign = 'left';
    context.textBaseline = 'alphabetic';
  }

  drawPopup(context, engine, layout) {
    const popup = this.popup;
    if (!popup) return;
    const age = (performance.now() - popup.at) / 1000;
    if (age > 0.7) return;
    const centerX = layout.width / 2;
    const y = layout.judgeY - 120 - age * 18;
    const scale = 1 + Math.max(0, 0.18 - age) * 2;
    context.save();
    context.globalAlpha = Math.max(0, 1 - Math.max(0, age - 0.35) / 0.35);
    context.translate(centerX, y);
    context.scale(scale, scale);
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = canvasFont(26);
    context.shadowColor = popup.color;
    context.shadowBlur = 16;
    context.fillStyle = popup.color;
    context.fillText(popup.label, 0, 0);
    context.shadowBlur = 0;
    if (popup.combo >= 2) {
      context.font = canvasFont(14);
      context.fillStyle = '#e9edf8';
      context.fillText(`${popup.combo} COMBO`, 0, 26);
    }
    if (popup.delta !== null && Math.abs(popup.delta) > RHYTHM_RULES.windows.perfect) {
      context.font = canvasFont(10, 'ui', 600);
      context.fillStyle = '#8a98aa';
      context.fillText(`${popup.delta < 0 ? 'EARLY' : 'LATE'} ${Math.round(Math.abs(popup.delta) * 1000)}ms`, 0, -24);
    }
    context.restore();
  }

  // 리드인: 첫 노트 전 남은 박을 크게 센다(마지막 4박)
  drawCountIn(context, engine, layout) {
    if (engine.status !== 'running') return;
    const firstHit = engine.notes[0]?.hitTime ?? 0;
    const beatsLeft = Math.ceil((firstHit - engine.gameTime) / BEAT_SECONDS);
    if (beatsLeft < 1 || beatsLeft > 4) return;
    const phase = ((engine.gameTime / BEAT_SECONDS) % 1 + 1) % 1;
    context.save();
    context.globalAlpha = 1 - phase * 0.8;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = canvasFont(56 + (1 - phase) * 14);
    context.fillStyle = '#e9edf8';
    context.shadowColor = '#36e2ff';
    context.shadowBlur = 20;
    context.fillText(String(beatsLeft), layout.width / 2, layout.height * 0.42);
    context.restore();
  }
}

function hexAlpha(hex, alpha) {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgba(${value >> 16 & 255}, ${value >> 8 & 255}, ${value & 255}, ${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
}
