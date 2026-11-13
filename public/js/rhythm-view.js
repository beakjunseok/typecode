// 리듬 모드 화면: 4레인(손가락 구역), 위에서 떨어지는 큰 원 글자 노트, 아래 판정선, 맨 위에 지금 만드는 낱말.
// 노트 위치 = 판정선 − (정박 시각 − 게임 시간) ÷ 떨어지는 시간 × 레인 높이. 게임 시간은 오디오 시계를 따른다.
import { setupCanvas, roundedRect, ParticleSystem, canvasFont, CANVAS_FONTS } from './game-view.js';
import { RHYTHM_LANES, RHYTHM_RULES } from './rhythm-engine.js';
import { TOKEN_KINDS } from './tokens.js';

const HUD_HEIGHT = 34;
const WORD_AREA = 74;
const JUDGE_FROM_BOTTOM = 68;
const JUDGEMENT_STYLE = Object.freeze({
  perfect: { label: 'PERFECT', color: '#ffe066' },
  great: { label: 'GREAT', color: '#39ff88' },
  good: { label: 'GOOD', color: '#36e2ff' },
  bad: { label: 'BAD', color: '#c792ea' },
  miss: { label: 'MISS', color: '#ff4d6d' }
});
const FEVER_COLORS = Object.freeze(['#5a6b85', '#36e2ff', '#39ff88', '#ffe066', '#ffb547', '#ff4d6d']);
const MODIFIER_LABELS = Object.freeze({ autoPlay: 'AUTO', noFail: 'NF', suddenDeath: 'SD', perfectOnly: 'PF', hidden: 'HD', fadeIn: 'FI', mirror: 'MR' });
function modifierTags(options) {
  if (!options) return '';
  const tags = Object.entries(MODIFIER_LABELS).filter(([key]) => options[key]).map(([, label]) => label);
  if (options.speed !== 1) tags.push(`x${options.speed}`);
  return tags.join(' ');
}
const visibleCharacter = character => character === ' ' ? '␣' : character;

export class RhythmRenderer {
  constructor(canvas) {
    this.surface = setupCanvas(canvas);
    this.particles = new ParticleSystem();
    this.laneFlash = RHYTHM_LANES.map(() => ({ amount: 0, color: '#ffffff' }));
    this.popup = null;
    this.wordFlash = null;
    this.lastGameTime = 0;
  }

  get context() {
    return this.surface.context;
  }

  layout() {
    const { width, height } = this.surface;
    const laneWidth = Math.min(130, (width - 24) / RHYTHM_LANES.length);
    const left = (width - laneWidth * RHYTHM_LANES.length) / 2;
    const judgeY = height - JUDGE_FROM_BOTTOM;
    const radius = Math.max(16, Math.min(30, laneWidth * 0.36));
    return { width, height, laneWidth, left, judgeY, topY: HUD_HEIGHT + WORD_AREA, radius };
  }

  // 미러 옵션이면 화면에서만 레인을 좌우로 뒤집는다(판정은 그대로)
  laneCenter(lane, layout) {
    const visual = this.mirror ? RHYTHM_LANES.length - 1 - lane : lane;
    return layout.left + layout.laneWidth * (visual + 0.5);
  }

  // 히든·페이드인: 노트가 레인의 어디쯤(1 = 맨 위, 0 = 판정선)에 있느냐로 투명도를 정한다
  noteAlpha(y, layout, options) {
    const progress = (layout.judgeY - y) / Math.max(1, layout.judgeY - layout.topY);
    const clamp = value => Math.max(0, Math.min(1, value));
    if (options.hidden) return clamp((progress - 0.22) / 0.18);
    if (options.fadeIn) return clamp((0.62 - progress) / 0.2);
    return 1;
  }

  noteY(hitTime, engine, layout) {
    const ahead = (hitTime - engine.gameTime) / engine.fallSeconds;
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
        this.particles.burst(this.laneCenter(payload.lane, layout), layout.judgeY, { color: style.color, count: payload.judgement === 'perfect' ? 24 : 14, speed: 220, life: 0.5, gravity: 280 });
      }
    } else if (type === 'miss') {
      const flash = this.laneFlash[payload.note.lane];
      flash.amount = 0.8;
      flash.color = JUDGEMENT_STYLE.miss.color;
      this.popup = { ...JUDGEMENT_STYLE.miss, at: performance.now(), combo: 0, delta: null };
    } else if (type === 'word') {
      this.wordFlash = { word: payload.word, clean: payload.clean, bonus: payload.bonus, at: performance.now() };
      if (payload.clean) this.particles.burst(layout.width / 2, HUD_HEIGHT + WORD_AREA / 2, { color: '#ffe066', count: 30, speed: 260, life: 0.7 });
    }
  }

  render(engine, { accent }) {
    const context = this.context;
    if (!context) return;
    this.mirror = engine.options?.mirror === true;
    this.surface.resize?.();
    const layout = this.layout();
    const { width, height, laneWidth, left, judgeY, topY, radius } = layout;
    const frameSeconds = Math.min(0.1, Math.max(0, engine.gameTime - this.lastGameTime)) || 1 / 60;
    this.lastGameTime = engine.gameTime;
    this.particles.update(frameSeconds);
    for (const flash of this.laneFlash) flash.amount = Math.max(0, flash.amount - frameSeconds * 3.5);

    const beatPhase = engine.status === 'running' ? ((engine.gameTime / engine.beatSeconds) % 1 + 1) % 1 : 0.5;
    const pulse = Math.max(0, 1 - beatPhase * 3.5);
    const totalWidth = laneWidth * RHYTHM_LANES.length;

    context.fillStyle = '#05070c';
    context.fillRect(0, 0, width, height);

    // 레인 바탕 + 맞힌 레인 번쩍임
    RHYTHM_LANES.forEach((lane, index) => {
      const x = this.laneCenter(index, layout) - laneWidth / 2;
      const gradient = context.createLinearGradient(0, topY, 0, judgeY);
      gradient.addColorStop(0, 'rgba(255, 255, 255, 0)');
      gradient.addColorStop(1, hexAlpha(lane.color, 0.07 + this.laneFlash[index].amount * 0.25));
      context.fillStyle = gradient;
      context.fillRect(x, topY, laneWidth, judgeY - topY);
      context.fillStyle = 'rgba(120, 140, 170, 0.16)';
      context.fillRect(x, topY, 1, height - topY);
    });
    context.fillStyle = 'rgba(120, 140, 170, 0.16)';
    context.fillRect(left + totalWidth, topY, 1, height - topY);

    // 박·마디 선(노트와 같은 속도로 내려온다)
    if (engine.status !== 'ready') {
      const firstBeat = Math.ceil(engine.gameTime / engine.beatSeconds);
      const lastBeat = Math.floor((engine.gameTime + engine.fallSeconds) / engine.beatSeconds);
      for (let beat = firstBeat; beat <= lastBeat; beat++) {
        const y = this.noteY(beat * engine.beatSeconds, engine, layout);
        const bar = (beat - engine.leadInBeats) % engine.beatsPerBar === 0;
        context.fillStyle = bar ? 'rgba(160, 180, 220, 0.2)' : 'rgba(160, 180, 220, 0.07)';
        context.fillRect(left, Math.round(y), totalWidth, bar ? 2 : 1);
      }
    }

    // 판정 원(레인마다 빈 고리) + 판정선
    RHYTHM_LANES.forEach((lane, index) => {
      const x = this.laneCenter(index, layout);
      context.beginPath();
      context.arc(x, judgeY, radius + 3, 0, Math.PI * 2);
      context.lineWidth = 2;
      context.strokeStyle = hexAlpha(this.laneFlash[index].amount > 0 ? this.laneFlash[index].color : lane.color, 0.35 + pulse * 0.25 + this.laneFlash[index].amount * 0.5);
      context.stroke();
    });
    context.save();
    context.shadowColor = accent;
    context.shadowBlur = 8 + pulse * 16;
    context.fillStyle = accent;
    context.globalAlpha = 0.35 + pulse * 0.4;
    context.fillRect(left, judgeY - 1, totalWidth, 2);
    context.restore();

    // 레인 이름
    context.font = canvasFont(11, 'ui', 600);
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    RHYTHM_LANES.forEach((lane, index) => {
      context.fillStyle = hexAlpha(lane.color, 0.8);
      context.fillText(lane.label, this.laneCenter(index, layout), judgeY + radius + 18);
    });

    // 노트: 늦게 닿는 것부터 그려 가까운(아래) 노트가 위에 오게
    const head = engine.headNote();
    const notes = engine.visibleNotes().sort((first, second) => second.hitTime - first.hitTime);
    for (const note of notes) {
      const x = this.laneCenter(note.lane, layout);
      if (note.state === 'pending') {
        const y = this.noteY(note.hitTime, engine, layout);
        const alpha = this.noteAlpha(y, layout, engine.options ?? {});
        if (alpha <= 0) continue;
        context.save();
        context.globalAlpha = alpha;
        this.drawNote(context, note, x, y, radius, note === head, accent);
        context.restore();
      } else {
        this.drawResolved(context, note, x, judgeY, radius, engine);
      }
    }
    this.particles.draw(context);

    this.drawHud(context, engine, layout);
    this.drawWord(context, engine, layout);
    this.drawPopup(context, layout);
    this.drawCountIn(context, engine, layout);
    context.textAlign = 'left';
    context.textBaseline = 'alphabetic';
  }

  // 큰 원 노트: 레인 색 테두리, 글자는 낱말 종류 색. 다음에 칠 노트는 밝게 빛난다
  drawNote(context, note, x, y, radius, isHead, accent) {
    const laneColor = RHYTHM_LANES[note.lane].color;
    context.save();
    const fill = context.createRadialGradient(x - radius * 0.3, y - radius * 0.35, radius * 0.1, x, y, radius);
    fill.addColorStop(0, isHead ? '#2b3550' : '#1c2338');
    fill.addColorStop(1, isHead ? '#151b2c' : '#0d111d');
    context.fillStyle = fill;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
    context.lineWidth = isHead ? 3 : 2;
    context.strokeStyle = isHead ? '#ffffff' : laneColor;
    if (isHead) {
      context.shadowColor = laneColor;
      context.shadowBlur = 16;
    }
    context.stroke();
    context.shadowBlur = 0;
    context.fillStyle = TOKEN_KINDS[note.word.token.kind]?.color ?? '#e9edf8';
    context.font = `700 ${Math.round(radius * 1.05)}px ${CANVAS_FONTS.code}`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(visibleCharacter(note.character), x, y + 1);
    context.restore();
    if (isHead && accent) {
      context.fillStyle = 'rgba(255, 255, 255, 0.06)';
    }
  }

  // 판정된 노트: 판정선에서 판정 색 고리가 퍼지며 사라진다
  drawResolved(context, note, x, judgeY, radius, engine) {
    const age = (engine.gameTime - note.resolvedAt) / 0.4;
    context.globalAlpha = Math.max(0, 1 - age);
    context.strokeStyle = JUDGEMENT_STYLE[note.judgement].color;
    context.lineWidth = 3;
    context.beginPath();
    context.arc(x, judgeY, radius * (1 + age * 0.7), 0, Math.PI * 2);
    context.stroke();
    context.globalAlpha = 1;
  }

  // 맨 위: 지금 만드는 낱말(판정된 글자는 판정 색, 다음 글자에 밑줄) + 다음 낱말. 완성 직후 잠깐 완성 표시
  drawWord(context, engine, layout) {
    const centerY = HUD_HEIGHT + WORD_AREA / 2 - 2;
    const flash = this.wordFlash && performance.now() - this.wordFlash.at < 650 ? this.wordFlash : null;
    const word = flash?.word ?? engine.currentWord;
    context.textBaseline = 'middle';
    if (!word) return;
    const notes = word.noteIds.map(id => engine.findEntity(id));
    const size = Math.min(34, Math.max(20, (layout.width - 40) / Math.max(notes.length, 4) * 0.9));
    context.font = `700 ${size}px ${CANVAS_FONTS.code}`;
    const characterWidth = context.measureText('M').width;
    const start = layout.width / 2 - characterWidth * notes.length / 2;
    const kindColor = TOKEN_KINDS[word.token.kind]?.color ?? '#e9edf8';
    const lift = flash ? Math.min(1, (performance.now() - flash.at) / 650) : 0;
    context.save();
    if (flash) {
      context.globalAlpha = 1 - lift * 0.6;
      context.shadowColor = flash.clean ? '#ffe066' : '#ff4d6d';
      context.shadowBlur = 18;
    }
    notes.forEach((note, index) => {
      const x = start + index * characterWidth;
      if (note.state === 'pending') {
        context.fillStyle = note === engine.headNote() ? '#ffffff' : 'rgba(201, 212, 224, 0.4)';
        if (note === engine.headNote()) context.fillRect(x, centerY + size * 0.55, characterWidth - 2, 3);
      } else {
        context.fillStyle = note.judgement === 'miss' ? JUDGEMENT_STYLE.miss.color : note.judgement === 'bad' ? JUDGEMENT_STYLE.bad.color : kindColor;
      }
      context.textAlign = 'left';
      context.fillText(visibleCharacter(note.character), x, centerY - lift * 10);
    });
    context.restore();
    context.font = canvasFont(11, 'ui', 600);
    context.textAlign = 'center';
    if (flash) {
      context.fillStyle = flash.clean ? '#ffe066' : '#8a98aa';
      context.fillText(flash.clean ? `완성! +${flash.bonus}` : '완성', layout.width / 2, centerY + size * 0.85);
    } else {
      const next = engine.words[word.index + 1];
      context.fillStyle = '#5c6a7e';
      if (next) context.fillText(`다음  ${next.token.text}`, layout.width / 2, centerY + size * 0.85);
    }
  }

  drawHud(context, engine, layout) {
    const { width } = layout;
    const snapshot = engine.snapshot();
    const barWidth = Math.min(200, width * 0.36);
    context.fillStyle = 'rgba(255, 255, 255, 0.08)';
    roundedRect(context, 12, 10, barWidth, 9, 4.5);
    context.fill();
    const health = snapshot.health / 100;
    context.fillStyle = health > 0.5 ? '#39ff88' : health > 0.25 ? '#ffcb6b' : '#ff4d6d';
    roundedRect(context, 12, 10, Math.max(5, barWidth * health), 9, 4.5);
    context.fill();
    context.font = canvasFont(10, 'ui', 600);
    context.fillStyle = '#8a98aa';
    context.textBaseline = 'top';
    context.textAlign = 'left';
    context.fillText(`HP ${Math.round(snapshot.health)} · 낱말 ${snapshot.wordsCompleted}/${engine.words.length}`, 12, 22);
    context.textAlign = 'right';
    const chart = engine.chart;
    context.fillText(`${engine.song.title} · ${Math.round(snapshot.progress * 100)}%`, width - 12, 22);
    context.fillStyle = chart.color;
    context.fillText(`${chart.label} ${engine.levelNumber()}`, width - 12, 36);
    context.fillStyle = 'rgba(255, 255, 255, 0.08)';
    context.fillRect(width - 12 - barWidth, 13, barWidth, 4);
    context.fillStyle = '#36e2ff';
    context.fillRect(width - 12 - barWidth, 13, barWidth * snapshot.progress, 4);
    this.drawFever(context, engine, layout, snapshot.fever);
    const tags = modifierTags(engine.options);
    if (tags) {
      context.textAlign = 'left';
      context.font = canvasFont(10, 'ui', 700);
      context.fillStyle = engine.options.autoPlay ? '#ffb547' : '#c792ea';
      context.fillText(tags, 12, 36);
    }
  }

  // 피버 게이지(판정선 오른쪽 세로 막대) + 레벨 표시
  drawFever(context, engine, layout, fever) {
    if (!fever) return;
    const x = layout.left + layout.laneWidth * RHYTHM_LANES.length + 14;
    const top = layout.topY + 10;
    const height = layout.judgeY - top;
    if (x + 10 > layout.width) return;
    context.fillStyle = 'rgba(255, 255, 255, 0.07)';
    roundedRect(context, x, top, 8, height, 4);
    context.fill();
    const color = FEVER_COLORS[Math.min(FEVER_COLORS.length - 1, fever.level)];
    const fill = height * Math.min(1, fever.gauge / 100);
    context.fillStyle = color;
    roundedRect(context, x, top + height - fill, 8, Math.max(4, fill), 4);
    context.fill();
    if (fever.level > 0) {
      context.save();
      context.textAlign = 'center';
      context.textBaseline = 'bottom';
      context.font = canvasFont(12);
      context.shadowColor = color;
      context.shadowBlur = 10;
      context.fillStyle = color;
      context.fillText(`FEVER x${(1 + fever.level * RHYTHM_RULES.fever.bonusPerLevel).toFixed(1)}`, x + 4, top - 2);
      context.restore();
    }
  }

  drawPopup(context, layout) {
    const popup = this.popup;
    if (!popup) return;
    const age = (performance.now() - popup.at) / 1000;
    if (age > 0.6) return;
    const y = layout.judgeY - layout.radius - 70 - age * 16;
    const scale = 1 + Math.max(0, 0.16 - age) * 2;
    context.save();
    context.globalAlpha = Math.max(0, 1 - Math.max(0, age - 0.3) / 0.3);
    context.translate(layout.width / 2, y);
    context.scale(scale, scale);
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = canvasFont(24);
    context.shadowColor = popup.color;
    context.shadowBlur = 14;
    context.fillStyle = popup.color;
    context.fillText(popup.label, 0, 0);
    context.shadowBlur = 0;
    if (popup.combo >= 2) {
      context.font = canvasFont(13);
      context.fillStyle = '#e9edf8';
      context.fillText(`${popup.combo} COMBO`, 0, 24);
    }
    if (popup.delta !== null && Math.abs(popup.delta) > RHYTHM_RULES.windows.perfect) {
      context.font = canvasFont(10, 'ui', 600);
      context.fillStyle = '#8a98aa';
      context.fillText(`${popup.delta < 0 ? 'EARLY' : 'LATE'} ${Math.round(Math.abs(popup.delta) * 1000)}ms`, 0, -22);
    }
    context.restore();
  }

  // 리드인: 첫 노트 전 남은 박을 크게 센다(마지막 4박)
  drawCountIn(context, engine, layout) {
    if (engine.status !== 'running') return;
    const firstHit = engine.notes[0]?.hitTime ?? 0;
    const beatsLeft = Math.ceil((firstHit - engine.gameTime) / engine.beatSeconds);
    if (beatsLeft < 1 || beatsLeft > 4) return;
    const phase = ((engine.gameTime / engine.beatSeconds) % 1 + 1) % 1;
    context.save();
    context.globalAlpha = 1 - phase * 0.8;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = canvasFont(56 + (1 - phase) * 14);
    context.fillStyle = '#e9edf8';
    context.shadowColor = '#36e2ff';
    context.shadowBlur = 20;
    context.fillText(String(beatsLeft), layout.width / 2, layout.height * 0.45);
    context.restore();
  }
}

function hexAlpha(hex, alpha) {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgba(${value >> 16 & 255}, ${value >> 8 & 255}, ${value & 255}, ${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
}
