// 진입점: 모드(연습 · 휴대폰 던지기 · 에러 구조 SOS · 리듬)를 고르고, 엔진 이벤트를 화면·효과음·키보드·서버 호출에 연결한다.
import { TypingEngine, DURATIONS, getTierIndex } from './engine.js';
import { TimeAttackEngine, TIME_ATTACK_RULES } from './time-attack-engine.js';
import { LANGUAGES, getTokenPool } from './tokens.js';
import { ThrowEngine, ROBOT_TYPES, BOSS_SKILLS, FORMATIONS } from './throw-engine.js';
import { BatteryEngine, BATTERY_ITEMS, itemEffectText } from './battery-engine.js';
import { ITEM_RARITIES, RARITY_ORDER } from './item-rarity.js';
import { PERSONAS, PERSONA_ORDER, WEATHERS, DECK_SIZE, BASE_ITEM, DEFAULT_DECK, ITEM_LOOKS, mirrorProfile, pickWeather } from './battery-modes.js';
import { BatteryPvpHostEngine, BatteryPvpGuestEngine, PVP_RULES, PVP_PROTOCOL_VERSION } from './battery-pvp.js';
import { hostRoom, joinRoom } from './pvp-connection.js';
import { createPvpLobby } from './pvp-lobby.js';
import { DIFFICULTY_LEVELS } from './target-game.js';
import { ThrowRenderer } from './throw-view.js';
import { BatteryRenderer } from './battery-view.js';
import { RhythmEngine, normalizeRhythmOptions, RHYTHM_LANES, RHYTHM_RULES, RHYTHM_GAUGES, laneOfCharacter, lampOrder } from './rhythm-engine.js';
import { RhythmRenderer } from './rhythm-view.js';
import { RhythmMusic, midiToFrequency, createPreview } from './rhythm-music.js';
import { RHYTHM_DIFFICULTIES, SONG_BY_ID, DEFAULT_SONG_ID, getSong } from './rhythm-songs.js';
import { renderSongSelect, stepSong, stepDifficulty, stepSpeed, LAMP_LABELS, lampOfRecord } from './song-select.js';
import { createInputDiffer, INPUT_SENTINEL, createShiftTracker } from './input.js';
import { SoundEngine } from './audio.js';
import { BgmEngine } from './bgm.js';
import { emitSparks, pulseClass } from './effects.js';
import { createKeyboard } from './keyboard.js';
import { loadSkinOverrides } from './skin-overrides.js';
import { createKeyboardCollection } from './gacha-view.js';
import { EARNING } from './gacha.js';
import { DefenseEngine, DEFENSE_RULES, TOWER_TYPES, ATTACK_TYPES } from './defense-engine.js';
import { cardById, CARD_RARITIES as CARD_RARITY_ORDER } from './defense-cards.js';
import { DefenseRenderer } from './defense-view.js';
import { rewardBreakdown, describeReward } from './rewards.js';
import { requestSession, submitScore, fetchBoard, localBoard, preferences } from './api.js';
import { createUi, TIER_COLORS } from './ui.js';
import { getWeekLabel } from './week.js';
import { createGuide } from './guide.js';

const TICK_INTERVAL_MS = 100;
const NARROW_WIDTH = 520;
const IME_WARNING_INTERVAL_MS = 4000;

const MODE_CONFIG = Object.freeze({
  practice: { label: '연습', arcade: false },
  throw: {
    label: '휴대폰 던지기', arcade: true, title: 'phone-throw.exe', resultTitle: 'GAME OVER',
    hint: '로봇 발밑 낱말을 다 치면 휴대폰 발사 · 🔋 건전지로 생명 회복', Renderer: ThrowRenderer,
    // 좁은 세로 화면: 레인 3개, 토큰 14자 이하(라벨이 열 너비를 넘지 않게)
    createEngine: options => new ThrowEngine({
      ...options, lanes: options.narrow ? 3 : 4, maxTokenLength: options.narrow ? 14 : 22, specials: true
    })
  },
  battery: {
    label: '배터리 구조 SOS', arcade: true, title: 'battery-rescue.sh', resultTitle: 'BATTERY REPORT',
    hint: '지나가는 셀 낱말로 충전 · 방전봇 탑 낱말로 공격', Renderer: BatteryRenderer,
    createEngine: options => new BatteryEngine({ ...options, maxTokenLength: options.narrow ? 14 : 18, ...batteryMatchOptions() })
  },
  defense: {
    label: '컴퓨터 디펜스', arcade: true, title: 'firewall.sys', resultTitle: 'SYSTEM HACKED',
    hint: '낱말을 쳐서 코인 벌기 · 상점을 눌러 타워 설치 · 타워·컴퓨터를 눌러 강화', Renderer: DefenseRenderer,
    createEngine: options => new DefenseEngine({ ...options, maxTokenLength: options.narrow ? 12 : 16, randomMap: true, cards: true })
  },
  rhythm: {
    label: '코딩 리듬', arcade: true, title: 'beat-compiler.wav', resultTitle: 'STAGE CLEAR',
    hint: '떨어지는 글자가 판정선에 닿을 때 그 글자를 치세요', Renderer: RhythmRenderer,
    // 오디오 시계로 박자를 맞춘다(소리를 꺼 두면 성능 시계)
    createEngine: options => new RhythmEngine({ ...options, getAudioContext: () => sound.context })
  }
});

// 연습 모드의 세부 방식: 고정 제한 시간(30·60·120초) 또는 시간 연장(⏳). 랭킹은 따로 집계한다
const PRACTICE_VARIANTS = Object.freeze(['timed', 'timeattack']);
const BOARD_LABELS = Object.freeze({ practice: '연습', timeattack: '연습 · 시간 연장', throw: '휴대폰 던지기', battery: '배터리 구조 SOS', rhythm: '코딩 리듬', defense: '컴퓨터 디펜스' });

const ui = createUi(document);
const sound = new SoundEngine();
const bgm = new BgmEngine(sound);
const rhythmMusic = new RhythmMusic(sound);
const songPreview = createPreview(sound);
const keyboard = createKeyboard(ui.elements.keyboardSection);
// 키 위치 편집기에서 서버에 저장한 키 좌표·글씨 색을 받아 지금 키보드에 바로 반영
loadSkinOverrides().then(applied => { if (applied) keyboard.refreshArt(); });
keyboard.setAudioSource(() => sound.spectrum(8));
const renderers = {};
const savedMode = preferences.get('mode', 'practice') === 'rescue' ? 'battery' : preferences.get('mode', 'practice');
const settings = {
  mode: MODE_CONFIG[savedMode] ? savedMode : 'practice',
  languageKey: LANGUAGES[preferences.get('lang', 'javascript')] ? preferences.get('lang', 'javascript') : 'javascript',
  durationSeconds: DURATIONS.includes(preferences.get('duration', 60)) ? preferences.get('duration', 60) : 60,
  practiceVariant: PRACTICE_VARIANTS.includes(preferences.get('practiceVariant', 'timed')) ? preferences.get('practiceVariant', 'timed') : 'timed',
  level: DIFFICULTY_LEVELS[preferences.get('level', 2)] ? Number(preferences.get('level', 2)) : 2,
  batteryVariant: preferences.get('batteryVariant', 'ai') === 'pvp' ? 'pvp' : 'ai',
  keyboardVisible: preferences.get('keyboard', true) !== false,
  // 게임(휴대폰 던지기·배터리 구조) 화면의 키보드는 기본으로 숨긴다
  keyboardInGame: preferences.get('keyboardGame', false) === true,
  // 리듬은 누를 때 키보드 4구역이 빛나므로 기본으로 보인다(따로 기억)
  keyboardInRhythm: preferences.get('keyboardRhythm', true) !== false,
  // 리듬 모드: 고른 곡과 난이도
  rhythmSong: SONG_BY_ID.has(preferences.get('rhythmSong', DEFAULT_SONG_ID)) ? preferences.get('rhythmSong', DEFAULT_SONG_ID) : DEFAULT_SONG_ID,
  rhythmDifficulty: RHYTHM_DIFFICULTIES[preferences.get('rhythmDifficulty', 'normal')] ? preferences.get('rhythmDifficulty', 'normal') : 'normal',
  // 리듬 옵션(속도·오프셋·모드). 지난 판 평균 타이밍(ms)은 오프셋 추천에 쓴다
  rhythmOptions: normalizeRhythmOptions(preferences.get('rhythmOptions', null)),
  rhythmLastDeltaMs: Number.isFinite(preferences.get('rhythmLastDelta', null)) ? preferences.get('rhythmLastDelta', null) : null
};
const run = { engine: null, generation: 0, sessionPromise: null, submitted: false, tickId: null, frameId: null, highlightId: null, lastTier: 0, powerActive: false, lastImeWarning: 0 };
const now = () => performance.now();
const modeConfig = () => MODE_CONFIG[settings.mode];
const isArcade = () => modeConfig().arcade;
const isTimeAttack = () => settings.mode === 'practice' && settings.practiceVariant === 'timeattack';
// 서버·로컬 랭킹에서 쓰는 모드 이름(연습의 시간 연장은 'timeattack')
const boardMode = () => (isTimeAttack() ? 'timeattack' : settings.mode);
// 휴대폰 던지기·배터리 구조는 난이도마다 랭킹이 따로다(그 외 모드는 null)
const LEVELED_BOARDS = Object.freeze(['throw', 'battery', 'defense']);
const boardLevel = (mode = boardMode()) => (LEVELED_BOARDS.includes(mode) ? settings.level : null);
// 랭킹은 언어마다 따로다: 제목에 언어도 붙인다
const boardLabel = (mode = boardMode(), level = boardLevel(mode), language = settings.languageKey) => {
  const parts = [BOARD_LABELS[mode] ?? mode, LANGUAGES[language]?.label ?? language];
  if (level) parts.push(DIFFICULTY_LEVELS[level]?.label ?? `Lv.${level}`);
  return parts.join(' · ');
};
// 배터리 구조 PvP(친구와 1:1). 연결·경기 단계는 pvp 객체 하나에 모은다
const isPvp = () => settings.mode === 'battery' && settings.batteryVariant === 'pvp';
const pvp = {
  connection: null, role: null, opponentName: '상대', hostSettings: null, phase: 'menu',
  abort: null, countdownTimer: null, lastStateSentAt: 0, finalStateSent: false, rematchRequested: false, lastOutcome: null
};
const pvpConnected = () => pvp.connection !== null;
const rivalName = () => run.engine?.rivalName ?? '방전봇';

function visible(character) {
  return { ' ': '␣', '\n': '↵', '\t': '⇥' }[character] ?? character;
}

// ---------- 연습 모드 이벤트 ----------
function handlePracticeEvent(type, payload) {
  switch (type) {
    case 'start':
      run.sessionPromise = startSession(run.generation);
      sound.play('gameStart');
      ui.log('sys', `run started · ${LANGUAGES[settings.languageKey].label} · ${isTimeAttack() ? `⏳ 시간 연장 ${TIME_ATTACK_RULES.startSeconds}s` : `${settings.durationSeconds}s`}`);
      break;
    case 'keystroke':
      sound.play('key', { character: run.lastCharacter });
      break;
    case 'backspace':
      sound.play('erase');
      break;
    case 'skip':
      sound.play('keyWrong');
      sound.play('error');
      bgm.setIntensity(0);
      pulseClass(ui.elements.stage, 'shake', 200);
      if (payload.comboLost >= 5) ui.log('warn', `combo ${payload.comboLost} dropped`);
      ui.log('err', `SkipError: '${payload.token.text}' 건너뜀 — 틀린 토큰으로 기록 (#${payload.tokenNumber})`);
      break;
    case 'mistake':
      sound.play('keyWrong', { character: payload.typed });
      sound.play('error');
      pulseClass(ui.elements.stage, 'shake', 200);
      if (payload.comboLost >= 5) ui.log('warn', `combo ${payload.comboLost} dropped`);
      ui.log('err', `SyntaxError: unexpected '${visible(payload.typed)}' in '${payload.token.text}' — expected '${visible(payload.expected)}' (#${payload.tokenNumber}:${payload.position + 1})`);
      break;
    case 'token':
      handlePracticeToken(payload);
      break;
    case 'warning':
      sound.play('warning', payload);
      break;
    case 'finish':
      handleFinish(payload.summary);
      break;
    default:
      break;
  }
}

function handlePracticeToken({ token, clean, combo, tier, tierUp, milestone, timeBonus }) {
  sound.play('key', { character: run.lastCharacter });
  ui.celebrateToken({ clean, combo, color: ui.kindColor(token.kind) });
  if (clean && combo >= 10) emitSparks(ui.elements.currentView, { color: TIER_COLORS[tier], count: Math.min(18, 4 + Math.floor(combo / 10) * 2), distance: 60 });
  if (timeBonus > 0) ui.showTimeBonus(timeBonus);
  bgm.setIntensity(tier);
  if (tierUp) {
    sound.play('tierUp', { tier });
    emitSparks(ui.elements.currentView, { color: TIER_COLORS[tier], count: 22, distance: 110 });
    pulseClass(ui.elements.stage, 'tier-flash', 600);
    ui.log('info', `combo ${combo} → multiplier ×${tier === 2 ? '2.0' : '1.5'}`);
  } else if (milestone) {
    sound.play('milestone');
    emitSparks(ui.elements.currentView, { color: TIER_COLORS[tier] });
  } else {
    sound.play(clean ? 'token' : 'tokenDirty', { combo });
  }
}

// ---------- 아케이드 모드 이벤트 ----------
function handleArcadeEvent(type, payload) {
  const renderer = renderers[settings.mode];
  renderer?.onEvent(type, payload, run.engine);
  if (settings.mode === 'defense' && handleDefenseEvent(type, payload)) return;
  const battery = settings.mode === 'battery';
  if (battery && handleBatteryModeEvent(type, payload)) return;
  switch (type) {
    case 'start':
      if (battery) updateBatteryPrep();
      if (settings.mode === 'rhythm') {
        sound.ensureContext();
        songPreview.stop();
        bgm.stop();
        rhythmMusic.reset();
        updateSongSelect();
      } else sound.play('gameStart');
      if (isPvp()) {
        ui.log('sys', `PvP 시작 · vs ${pvp.opponentName} · ${LANGUAGES[pvp.hostSettings.language].label} · ${DIFFICULTY_LEVELS[pvp.hostSettings.level].label}`);
        break;
      }
      run.sessionPromise = startSession(run.generation);
      ui.log('sys', `${modeConfig().label} started · ${LANGUAGES[settings.languageKey].label} · ${settings.mode === 'rhythm' ? rhythmLabel() : DIFFICULTY_LEVELS[settings.level].label}`);
      break;
    case 'spawn':
      sound.play('spawnRobot', { type: payload.robot.type });
      break;
    case 'lock':
      sound.play('lock');
      break;
    case 'keystroke':
      sound.play('key', { character: run.lastCharacter });
      break;
    case 'backspace':
      sound.play('erase');
      break;
    case 'mistake':
      sound.play('keyWrong', { character: payload.typed });
      // 리듬 공POOR: 콤보가 안 끊기므로 흔들기·에러음 없이 키 소리와 빨간 구역 빛만
      if (payload.emptyPoor) break;
      sound.play('error');
      pulseClass(ui.elements.arcadeStage, 'shake', 200);
      ui.log('err', payload.target
        ? `SyntaxError: unexpected '${visible(payload.typed)}' in '${payload.target.token.text}' — expected '${visible(payload.expected)}'`
        : `TargetNotFound: '${visible(payload.typed)}'로 시작하는 낱말이 없습니다`);
      break;
    case 'throw':
      sound.play('key', { character: run.lastCharacter });
      sound.play(battery ? 'splash' : payload.weapon === 'laptop' ? 'throwLaptop' : 'throwPhone');
      if (payload.tier > run.lastTier) {
        sound.play('tierUp', { tier: payload.tier });
        pulseClass(ui.elements.arcadeStage, 'tier-flash', 600);
        ui.log('info', `combo ${payload.combo} → multiplier ×${payload.tier === 2 ? '2.0' : '1.5'}`);
      }
      run.lastTier = payload.tier;
      break;
    case 'hit':
      if (battery) sound.play('hit');
      else sound.play('robotHit', { type: payload.robot.type, weapon: payload.weapon, remainingHp: payload.robot.hp, combo: run.engine?.combo ?? 1 });
      break;
    case 'kill':
      {
        const combo = run.engine?.combo ?? 1;
        sound.play(battery ? 'explode' : 'robotKill', { type: payload.robot.type, combo, tier: getTierIndex(combo) });
        // 타격 정지: 큰 놈·노트북일수록 조금 더 길게 멈춘다
        run.engine?.hitStop?.(payload.weapon === 'laptop' || payload.robot.maxHp > 1 ? 0.085 : 0.05);
      }
      ui.log('ok', `${ROBOT_TYPES[payload.robot.type].label} 처치 (+${payload.bounty})`);
      break;
    case 'goal':
      sound.play('newRecord');
      startMusic();
      run.engine?.hitStop?.(0.22);
      pulseClass(ui.elements.arcadeStage, 'tier-flash', 900);
      ui.log('ok', payload.boss ? '👑 보스 서버봇 격파 — 미션 클리어!' : `🤖 로봇 ${payload.kills}대 처치 — 미션 클리어!`);
      break;
    case 'boss-warning':
      sound.play('warning', { remainingSeconds: 1 });
      startMusic();
      bgm.setIntensity(2);
      ui.log('warn', `🤖 ${payload.kills}대 처치! 마지막 웨이브 — 보스가 다가와요`);
      break;
    case 'boss-appear':
      sound.play('explode');
      run.engine?.hitStop?.(0.15);
      pulseClass(ui.elements.arcadeStage, 'shake', 400);
      ui.log('err', '👑 보스 서버봇 등장! 책상에 닿으면 바로 끝나요');
      break;
    case 'boss-charge': {
      sound.play('powerUp');
      const skill = BOSS_SKILLS[payload.skill] ?? BOSS_SKILLS.cannon;
      ui.log('warn', `${skill.icon} 보스 기술 준비: ${skill.label}`);
      break;
    }
    case 'boss-mask':
      sound.play('zap');
      ui.log('err', `🕶 해커봇이 화면을 가렸어요 (${payload.seconds}초) — 첫 글자는 보여요`);
      break;
    case 'boss-decoy':
      sound.play('spawnRobot', { type: 'basic' });
      break;
    case 'boss-dash':
      sound.play('explode');
      break;
    case 'formation':
      sound.play('warning', { remainingSeconds: 3 });
      ui.log('warn', `⚠ ${FORMATIONS[payload.formation]?.label ?? '편대'} 등장`);
      break;
    case 'morph':
      sound.play('gachaTick');
      break;
    case 'split':
      sound.play('explode');
      break;
    case 'twin-hit':
      sound.play('tierUp', { tier: 2 });
      break;
    case 'boss-fire':
      sound.play('explode');
      break;
    case 'pad-blocked':
      sound.play('glassCrack');
      ui.log('ok', `🛡 패드 막음 (+${payload.bonus})`);
      break;
    case 'pad-hit':
      ui.log('err', '📱 패드에 맞았어요');
      break;
    case 'heal':
      sound.play('powerUp');
      ui.log('ok', `🔋 보스 타격 — 건전지 회복 (${payload.lives}칸)`);
      break;
    case 'boss-reached':
      sound.play('warning', { remainingSeconds: 1 });
      ui.log('err', '👑 보스가 눈앞까지 왔어요 — 맞혀서 밀어내세요');
      break;
    case 'boss-windup':
      sound.play('powerUp');
      break;
    case 'boss-pushed':
      ui.log('ok', '🛡 보스를 밀어내 펀치를 막았어요');
      break;
    case 'shield-block':
      sound.play('glassCrack');
      ui.log('ok', `🛡 보호막이 막았어요 (남은 보호막 ${payload.shields})`);
      break;
    case 'boss-punch':
      sound.play('explode');
      run.engine?.hitStop?.(0.1);
      ui.log('err', '👊 보스의 펀치! 건전지 -1');
      break;
    case 'item-spawn':
      sound.play('itemSpawn');
      if (!battery) {
        const rarity = payload.item.rarity && payload.item.rarity !== 'common' ? `${ITEM_RARITIES[payload.item.rarity]?.label ?? ''} ` : '';
        ui.log('info', payload.item.item === 'battery' ? `🔋 ${rarity}건전지 등장 — 치면 생명 회복` : `💻 ${rarity}노트북 상자 등장`);
      }
      if (['epic', 'legendary'].includes(payload.item.rarity)) sound.play('tierUp', { tier: payload.item.rarity === 'legendary' ? 3 : 2 });
      break;
    case 'item':
      sound.play(battery && payload.item.item === 'heat' ? 'explode' : 'powerUp');
      ui.log('ok', battery ? batteryItemLog(payload.item, rivalName()) : throwItemLog(payload));
      break;
    case 'drain':
      sound.play('hit');
      ui.log('ok', `${rivalName()} 탑 −0.5칸`);
      break;
    case 'rival-take':
      sound.play('error');
      ui.log('warn', `${rivalName()}이(가) ${batteryItemName(payload.item)}을(를) 가져갔습니다`);
      break;
    case 'rival-attack':
      sound.play('lifeLost');
      pulseClass(ui.elements.arcadeStage, 'shake', 260);
      ui.log('err', `${rivalName()} 공격 — 내 탑 −0.5칸`);
      break;
    case 'target-lost':
      if (payload.reason === 'stolen') ui.log('warn', `치던 낱말을 ${rivalName()}이(가) 먼저 쳤습니다!`);
      break;
    case 'claim-rejected':
      sound.play('error');
      ui.log('warn', `'${payload.text}' — ${rivalName()}이(가) 한발 먼저 쳤습니다`);
      break;
    case 'round-end':
      sound.play(payload.mine ? 'newRecord' : 'sink');
      pulseClass(ui.elements.arcadeStage, payload.mine ? 'tier-flash' : 'shake', 700);
      ui.log(payload.mine ? 'ok' : 'err', `ROUND ${payload.round} ${payload.mine ? '승리' : '패배'} — ${payload.how === 'charged' ? '100% 충전' : '상대 방전'} (${payload.wins.mine}:${payload.wins.theirs})`);
      run.lastTier = 0;
      break;
    case 'stage-clear':
      sound.play('newRecord');
      run.engine?.hitStop?.(0.18);
      pulseClass(ui.elements.arcadeStage, 'tier-flash', 800);
      ui.log('ok', `STAGE ${payload.stage} CLEAR — ${payload.how === 'charged' ? '100% 충전 구조' : '방전봇 침몰'} (+${payload.bonus})`);
      break;
    case 'damage':
      sound.play(battery ? 'sink' : 'lifeLost');
      run.engine?.hitStop?.(0.12);
      if (!battery) sound.play('glassCrack');
      pulseClass(ui.elements.arcadeStage, 'shake', 300);
      ui.log('err', battery ? (payload.cause.how === 'sunk' ? '배터리 0% — 방전의 바다에 빠졌습니다' : '방전봇이 먼저 100% 충전했습니다')
        : `로봇이 빨간 선 돌파 — 건전지 ${payload.lives}칸 · 휴대폰에 금이 갔습니다`);
      run.lastTier = 0;
      break;
    case 'judge':
      sound.play('rhythmHit', { frequency: midiToFrequency(payload.note.midi), judgement: payload.judgement });
      if (payload.tier > run.lastTier) {
        sound.play('tierUp', { tier: payload.tier });
        pulseClass(ui.elements.arcadeStage, 'tier-flash', 600);
        ui.log('info', `combo ${payload.combo} → multiplier ×${payload.tier === 2 ? '2.0' : '1.5'}`);
      }
      run.lastTier = payload.tier;
      if (payload.judgement === 'bad') ui.log('warn', `BAD '${visible(payload.character)}' — ${payload.delta < 0 ? '빠름' : '늦음'} ${Math.round(Math.abs(payload.delta) * 1000)}ms`);
      break;
    case 'miss':
      sound.play('rhythmMiss');
      ui.log('err', `MISS '${visible(payload.note.character)}' in '${payload.note.word.token.text}' — 판정선을 지나갔습니다`);
      run.lastTier = 0;
      break;
    case 'word':
      if (payload.clean) sound.play('rhythmWord', { frequency: midiToFrequency(run.engine.findEntity(payload.word.noteIds.at(-1))?.midi ?? 72) });
      ui.log(payload.clean ? 'ok' : 'info', `${payload.word.token.text} ${payload.clean ? `완성 (+${payload.bonus})` : '완성 — 놓친 글자 있음'}`);
      break;
    case 'finish':
      rhythmMusic.reset();
      handleFinish(payload.summary);
      break;
    default:
      break;
  }
}

// 아이템 이름·획득 로그(등급 포함). 상대 이름은 AI면 '방전봇', PvP면 상대 이름
const batteryItemName = item => {
  const rarity = item?.rarity && item.rarity !== 'common' && item.item !== 'cell' ? `${ITEM_RARITIES[item.rarity]?.label ?? ''} ` : '';
  return `${rarity}${BATTERY_ITEMS[item?.item]?.label ?? '아이템'}`;
};
const batteryItemLog = (item, rival) => `${batteryItemName(item)} — ${itemEffectText(item.item, item.rarity).replace('상대', rival)}`;
const throwItemLog = payload => {
  const rarity = payload.item.rarity && payload.item.rarity !== 'common' ? `${ITEM_RARITIES[payload.item.rarity]?.label ?? ''} ` : '';
  if (payload.item.item === 'battery') return `${rarity}건전지 — 생명 +${payload.restored ?? 1}${payload.shieldsGained ? `, 보호막 +${payload.shieldsGained}` : ''} (생명 ${payload.lives}칸)`;
  return `${rarity}노트북 — ${Math.round(payload.laptopSeconds ?? 0)}초간 ${payload.shots ?? 2}개씩 던지기`;
};

// ---------- 세션 · 제출 ----------
function startSession(generation) {
  const mode = boardMode();
  const level = boardLevel(mode);
  return requestSession({ mode, language: settings.languageKey, ...(mode === 'practice' ? { durationSeconds: settings.durationSeconds } : {}), ...(level ? { level } : {}) }).catch(error => {
    if (generation === run.generation) ui.log('warn', `session 발급 실패 (${error.message}) — 이번 판은 로컬 랭킹에만 저장`);
    return null;
  });
}

function buildSubmission(summary, token, name) {
  return {
    token, name, score: summary.score, maxCombo: summary.maxCombo,
    correctKeystrokes: summary.correctKeystrokes, wrongKeystrokes: summary.wrongKeystrokes,
    ...(summary.survivedSeconds !== undefined ? { survivedSeconds: summary.survivedSeconds } : {})
  };
}

async function handleSave(event) {
  event.preventDefault();
  const engine = run.engine;
  if (!engine || engine.status !== 'finished' || run.submitted || engine.score <= 0) return;
  const generation = run.generation;
  const mode = boardMode();
  const level = boardLevel(mode);
  const name = ui.elements.playerName.value.trim().slice(0, 16) || 'anonymous';
  preferences.set('name', name);
  ui.setSaveButton({ label: '등록 중…', disabled: true });
  ui.setSaveStatus('');

  const token = await run.sessionPromise;
  if (generation !== run.generation) return;
  const summary = engine.summary();
  if (!token) {
    saveLocally(summary, name, mode, level);
    return;
  }
  try {
    const result = await submitScore(buildSubmission(summary, token, name));
    if (generation !== run.generation) return;
    run.submitted = true;
    run.highlightId = result.myEntry.id;
    ui.renderBoard(result.entries, { week: result.week, isLive: true, highlightId: run.highlightId, modeLabel: boardLabel(mode, level) });
    ui.setSaveButton({ label: '등록 완료', disabled: true });
    ui.setSaveStatus(`이번 주 ${boardLabel(mode, level)} ${result.myRank}위로 등록됐습니다.`, 'ok');
    if (result.myRank === 1) sound.play('newRecord');
    ui.log('ok', `ranking updated: ${name} · #${result.myRank} (${result.week})`);
  } catch (error) {
    if (generation !== run.generation) return;
    ui.setSaveStatus(`[${error.status || 'NET'}] ${error.message}`, 'err');
    ui.setSaveButton({ label: error.isFinal ? '등록 불가' : '다시 시도', disabled: error.isFinal });
    ui.log('err', `SubmitError ${error.status || ''} ${error.code || ''}: ${error.message}`);
  }
}

function saveLocally(summary, name, mode, level = null) {
  const entry = {
    id: `local-${Date.now()}`, name, language: settings.languageKey, score: summary.score,
    wpm: summary.wordsPerMinute, cpm: summary.charactersPerMinute, accuracy: summary.accuracy, achievedAt: Date.now(),
    ...(summary.survivedSeconds !== undefined ? { survivedSeconds: summary.survivedSeconds } : {})
  };
  run.submitted = true;
  run.highlightId = entry.id;
  ui.renderBoard(localBoard.save(entry, mode, level), { week: getWeekLabel(), isLive: false, highlightId: entry.id, modeLabel: boardLabel(mode, level) });
  ui.setSaveButton({ label: '로컬 저장됨', disabled: true });
  ui.setSaveStatus('서버에 연결하지 못해 이 브라우저에만 저장했습니다.', 'warn');
}

async function refreshBoard() {
  const mode = boardMode();
  const level = boardLevel(mode);
  const language = settings.languageKey;
  const modeLabel = boardLabel(mode, level, language);
  // 응답이 오는 사이 모드·난이도·언어를 바꿨으면 그리지 않는다
  const stale = () => mode !== boardMode() || level !== boardLevel() || language !== settings.languageKey;
  try {
    const result = await fetchBoard(mode, level, language);
    if (stale()) return;
    ui.renderBoard(result.entries, { week: result.week, isLive: true, highlightId: run.highlightId, modeLabel });
  } catch (error) {
    if (stale()) return;
    ui.renderBoard(localBoard.load(mode, level, language), { week: getWeekLabel(), isLive: false, highlightId: run.highlightId, modeLabel });
  }
}

// ---------- 결과 ----------
const RHYTHM_MODIFIER_NAMES = Object.freeze({ noFail: '노페일', suddenDeath: '서든데스', perfectOnly: '퍼펙트', hidden: '히든', fadeIn: '페이드인', mirror: '미러', autoPlay: '자동 연주' });
function arcadeSubtitle(summary) {
  if (summary.mode === 'rhythm') {
    const j = summary.judgements;
    const timing = summary.averageDeltaMs === 0 ? '타이밍 딱 맞음' : `평균 ${Math.abs(summary.averageDeltaMs)}ms ${summary.averageDeltaMs > 0 ? '늦게' : '일찍'}`;
    const modifiers = summary.modifiers?.length ? ` · 옵션 ${summary.modifiers.map(key => RHYTHM_MODIFIER_NAMES[key] ?? key).join('·')}` : '';
    return `${summary.songTitle} · ${RHYTHM_DIFFICULTIES[summary.difficulty]?.label ?? ''} · ${LANGUAGES[settings.languageKey].label} · 랭크 ${summary.rank} · EX ${summary.exScore}/${summary.exMax} (${summary.exRate.toFixed(2)}%) · ${RHYTHM_GAUGES[summary.gauge]?.label ?? ''} 게이지 ${Math.round(summary.gaugeEnd)}% · 낱말 ${summary.completedTokens}/${summary.totalWords} (깨끗이 ${summary.cleanTokens}) · PERFECT ${j.perfect} · GREAT ${j.great} · GOOD ${j.good} · BAD ${j.bad} · MISS ${j.miss}${summary.emptyPoors ? ` · 공POOR ${summary.emptyPoors}` : ''}${summary.holds?.total ? ` · 롱노트 ${summary.holds.done}/${summary.holds.total}` : ''} · FAST ${summary.fast} · LATE ${summary.late} (${timing})${summary.speed !== 1 ? ` · 속도 x${summary.speed}` : ''}${modifiers}`;
  }
  const base = `${LANGUAGES[settings.languageKey].label} · ${DIFFICULTY_LEVELS[summary.level].label} · 생존 ${summary.survivedSeconds}s`;
  if (summary.mode === 'battery') {
    const result = { rescued: '승리: 100% 충전 구조', 'rival-sunk': '승리: 방전봇 침몰', 'rival-charged': '패배: 방전봇 선충전' }[summary.outcome] ?? '패배: 방전';
    return `${base} · 공격 ${summary.drains} · 아이템 ${summary.itemsCollected} · 뺏김 ${summary.stolen} · ${result}`;
  }
  if (summary.mode === 'defense') {
    const { packet = 0, spam = 0, malware = 0, ransomware = 0 } = summary.kills;
    return `${base} · 웨이브 ${summary.wavesCleared}/${summary.waves} 막음 · 처치 패킷 ${packet} · 스팸 ${spam} · 악성 파일 ${malware}${ransomware ? ' · 🔓 랜섬웨어' : ''} · 타워 ${summary.towersBuilt} · 코인 ${summary.coinsEarned}🪙 · 무피해 웨이브 ${summary.noDamageWaves}`;
  }
  const { basic = 0, fast = 0, slow = 0, tank = 0 } = summary.kills;
  return `${base}${summary.bossDefeated ? ' · 👑 보스 격파' : ''} · 처치 ${summary.totalKills}/${summary.goalKills} (기본 ${basic} · 빠른 ${fast} · 달팽 ${slow} · 헤비 ${tank}) · 아이템 ${summary.itemsCollected}`;
}

function timeAttackSubtitle(summary) {
  return `${LANGUAGES[settings.languageKey].label} · ⏳ 시간 연장 · 생존 ${summary.survivedSeconds}s (시작 ${summary.startSeconds}s + 획득 ${summary.timeBonusTotal}s) · 토큰 ${summary.completedTokens}개 (클린 ${summary.cleanTokens})${summary.skippedTokens ? ` · 건너뜀 ${summary.skippedTokens}` : ''}`;
}

const PVP_RESULT_TITLES = Object.freeze({ win: 'YOU WIN 🏆', lose: 'YOU LOSE', disconnect: '연결 끊김' });

function pvpSubtitle(summary) {
  const wins = summary.pvp?.wins ?? { mine: 0, theirs: 0 };
  const opponent = summary.pvp?.opponentName ?? pvp.opponentName;
  if (summary.outcome === 'disconnect') return `vs ${opponent} · ${wins.mine}:${wins.theirs}에서 상대와 연결이 끊겼습니다`;
  return `vs ${opponent} · 라운드 ${wins.mine}:${wins.theirs} · 공격 ${summary.drains} · 아이템 ${summary.itemsCollected} · 뺏김 ${summary.stolen}`;
}

// 아케이드 승리 조건: 배터리는 구조되거나 방전봇이 가라앉음, 던지기는 목표 처치 수 달성
const ARCADE_WIN_OUTCOMES = Object.freeze(['rescued', 'rival-sunk', 'cleared']);
const ARCADE_WIN_TITLES = Object.freeze({ battery: 'RESCUED 🚁', throw: 'BOSS DOWN 🏆', defense: 'SYSTEM SECURE 🛡' });
const arcadeWon = summary => ARCADE_WIN_OUTCOMES.includes(summary.outcome);

// 결과창 제목·부제(모드별). PvP는 랭킹 등록 폼을 숨긴다
function resultHeading(summary) {
  if (summary.mode === 'battery-pvp') return { title: PVP_RESULT_TITLES[summary.outcome] ?? 'PvP', subtitle: pvpSubtitle(summary), saveable: false };
  if (summary.mode === 'timeattack') return { title: 'TIME UP', subtitle: timeAttackSubtitle(summary) };
  if (summary.mode === 'rhythm') {
    const lamp = summary.clearLamp && summary.clearLamp !== 'FAILED' ? ` · ${LAMP_LABELS[summary.clearLamp]}` : '';
    const title = summary.autoPlay ? 'AUTO PLAY' : summary.outcome === 'cleared' ? `STAGE CLEAR · ${summary.rank}${lamp}` : 'STAGE FAILED';
    return { title, subtitle: arcadeSubtitle(summary), ...(summary.autoPlay ? { saveable: false, unsavedNote: '자동 연주는 랭킹·최고 기록에 남지 않아요.' } : {}) };
  }
  if (isArcade()) return { title: arcadeWon(summary) ? ARCADE_WIN_TITLES[summary.mode] : modeConfig().resultTitle, subtitle: arcadeSubtitle(summary) };
  return {};
}

// 모드별 개인 최고 점수를 기기에 저장하고, 이번 판이 그 기록을 넘었는지 돌려준다(첫 판은 0점이 아니면 기록)
function recordPersonalBest(summary) {
  const key = `best:${summary.mode}`;
  const best = Number(preferences.get(key, 0)) || 0;
  if (!(summary.score > best)) return false;
  preferences.set(key, summary.score);
  return true;
}

// 끝 효과음: 이기면(PvP 승리·개인 최고 기록) 승리음, 지면(PvP 패배·연결 끊김, 아케이드 게임 오버) 패배음, 그 밖엔 완료음
function endSound(summary, newBest) {
  if (isPvp()) return summary.outcome === 'win' ? 'victory' : 'defeat';
  if (newBest) return 'victory';
  if (summary.mode === 'rhythm') return summary.outcome === 'cleared' ? 'finish' : 'defeat';
  if (isArcade()) return arcadeWon(summary) ? 'victory' : 'defeat';
  return 'finish';
}

// 결과창 그림 고르기: 대결은 승패, 리듬은 클리어 여부, 아케이드는 승리 조건을 채웠는지.
// 최고 기록 여부는 그림이 아니라 부제(🏆)로만 알린다. 연습처럼 끝까지 친 판은 승리 그림
function resultMood(summary) {
  if (isPvp()) return summary.outcome === 'win' ? 'win' : 'lose';
  if (summary.mode === 'rhythm') return summary.outcome === 'cleared' ? 'win' : 'lose';
  if (isArcade()) return arcadeWon(summary) ? 'win' : 'lose';
  return 'win';
}

function handleFinish(summary) {
  // 판이 끝나면 숨겼던 메뉴를 다시 보여 준다(결과창·랭킹)
  queueMicrotask(updateMobilePlay);
  advanceBatteryPrep(summary);
  if (isPvp()) {
    pvp.phase = 'ended';
    pvp.lastOutcome = summary.outcome;
  }
  stopTicking();
  const autoPlay = summary.autoPlay === true;
  const newBest = !isPvp() && !autoPlay && recordPersonalBest(summary);
  if (summary.mode === 'rhythm') {
    recordRhythmBest(summary);
    rememberRhythmTiming(summary);
  }
  sound.play(endSound(summary, newBest));
  bgm.duck(true);
  ui.elements.hiddenInput.blur();
  renderStats();
  ui.setFocusState({ focused: false, finished: true, arcade: isArcade() });
  keyboard.setNext(null);
  ui.log('sys', `run finished · score ${summary.score} · ${summary.charactersPerMinute}타 (${summary.wordsPerMinute} WPM) · ${summary.accuracy}%`);
  // 결과창은 무슨 일이 있어도 띄운다: 제목·포인트 계산에서 오류가 나도 기본 결과로 보여 준다
  let heading = {};
  try {
    heading = resultHeading(summary);
  } catch (error) {
    console.error(error);
  }
  let earned = 0;
  try {
    // 판마다 키보드 뽑기 포인트 적립(결과창에 표시)
    // 난이도·진행도·첫 클리어를 반영한 포인트(rewards.js). 내역을 결과창에 그대로 보여 준다
    const reward = autoPlay ? null : rewardBreakdown({ ...summary, autoPlay }, { firstClears: collection.firstClears() });
    earned = reward ? collection.earnPoints(reward.total, reward.firstClearKey) : 0;
    const pointsLine = document.getElementById('resultPoints');
    if (pointsLine) {
      pointsLine.hidden = false;
      pointsLine.innerHTML = earned
        ? `🎁 뽑기 포인트 <b>+${earned}P</b> · 보유 ${collection.points()}P<br><small>${describeReward(reward)}</small>`
        : autoPlay ? `🎁 자동 연주는 포인트가 없어요 · 보유 ${collection.points()}P`
          : `🎁 이번 판은 포인트가 없어요(맞게 친 글자 ${EARNING.minimumCharacters}개 이상부터) · 보유 ${collection.points()}P`;
    }
  } catch (error) {
    console.error(error);
  }
  run.lastResult = {
    summary,
    options: {
      languageKey: settings.languageKey,
      playerName: preferences.get('name', ''),
      ...heading,
      mood: resultMood(summary),
      ...(newBest ? { subtitle: `🏆 개인 최고 기록${heading.subtitle ? ` · ${heading.subtitle}` : ''}` } : {})
    }
  };
  showLastResult();
}

// 마지막 결과창을 (다시) 띄운다. 그리기 중 오류가 나도 창 자체는 열리게 한다
function showLastResult() {
  if (!run.lastResult) return;
  try {
    ui.showResult(run.lastResult.summary, run.lastResult.options);
  } catch (error) {
    console.error(error);
    ui.log('warn', '결과 화면을 그리다 문제가 생겼어요 — 기본 결과만 보여 줍니다');
  } finally {
    ui.elements.resultModal.hidden = false;
  }
}

// ---------- 진행 ----------
function renderStats() {
  const engine = run.engine;
  if (!engine) return;
  const snapshot = isArcade() ? engine.snapshot() : engine.snapshot(now());
  ui.renderStats(snapshot);
  // 콤보가 오를수록 키보드 LED(전설 스킨)가 빨라지고 밝아진다: 30콤보(×2 단계)에서 최대
  keyboard.setEnergy((snapshot.combo ?? 0) / 30);
}

function startTicking() {
  if (run.tickId || isArcade()) return;
  run.tickId = setInterval(() => {
    const engine = run.engine;
    engine.update(now());
    if (engine.status === 'running') renderStats();
  }, TICK_INTERVAL_MS);
}

function stopTicking() {
  clearInterval(run.tickId);
  run.tickId = null;
}

// 아케이드는 requestAnimationFrame으로 엔진 진행과 그리기를 함께 한다(탭이 숨으면 자동으로 멈춤).
function startFrameLoop() {
  cancelAnimationFrame(run.frameId);
  const loop = () => {
    const engine = run.engine;
    if (!isArcade() || !engine) return;
    engine.update(now());
    if (pvpConnected()) pumpPvp();
    const snapshot = engine.snapshot();
    if (settings.mode === 'rhythm') rhythmMusic.pump(engine, snapshot.tierProgress.index);
    renderers[settings.mode]?.render(engine, { accent: TIER_COLORS[snapshot.tierProgress.index] });
    if (settings.mode === 'rhythm') updateRhythmZones();
    if (engine.status === 'running') {
      renderStats();
      updateArcadeMusic(snapshot);
      renderInputBar();
    }
    run.frameId = requestAnimationFrame(loop);
  };
  run.frameId = requestAnimationFrame(loop);
}

// C major 한 옥타브: 낱말 안 몇 번째 글자인지로 음을 고른다(도레미…)
const C_MAJOR_MIDI = Object.freeze([72, 74, 76, 77, 79, 81, 83, 84]);

// 컴퓨터 디펜스 설치 모드: 마우스는 유령 타워 미리보기, 누르거나 탭하면 그 자리에 설치(길·컴퓨터 둘레·다른 타워 위는 거절).
// 입력창 포커스는 그대로 두어 키보드로 계속 칠 수 있게 한다
function bindDefensePointer(canvas) {
  if (!canvas) return;
  const localPoint = event => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const activeRenderer = () => (settings.mode === 'defense' && (run.engine?.buildMode || run.engine?.phase === 'draft') && run.engine.status === 'running' ? renderers.defense : null);
  canvas.addEventListener('pointermove', event => {
    const renderer = activeRenderer();
    const point = renderer ? localPoint(event) : null;
    renderers.defense?.setPointer(point);
    // 카드 위에 올라가면 '틱'
    if (point && run.engine?.phase === 'draft') {
      const index = renderers.defense.draftCardAt(point.x, point.y);
      if (index >= 0 && index !== run.hoveredCard) sound.play('cardHover');
      run.hoveredCard = index;
    }
  });
  canvas.addEventListener('pointerleave', () => renderers.defense?.setPointer(null));
  canvas.addEventListener('pointerdown', event => {
    if (settings.mode !== 'defense' || run.engine?.status !== 'running') return;
    const point = localPoint(event);
    // 강화 카드 고르기 중: 카드를 누르면 그 카드, 다른 곳은 무시
    if (run.engine.phase === 'draft') {
      event.preventDefault();
      const index = renderers.defense?.draftCardAt(point.x, point.y) ?? -1;
      if (index >= 0) run.engine.chooseCard(index);
      ui.elements.hiddenInput?.focus({ preventScroll: true });
      return;
    }
    // 상점 칸을 누르면 그 품목 고르기(타워 → 설치 모드, 수리 → 바로 구매)
    const shopItem = renderers.defense?.shopItemAt(run.engine, point.x, point.y);
    if (shopItem) {
      event.preventDefault();
      run.engine.selectShopItem(shopItem);
      ui.elements.hiddenInput?.focus({ preventScroll: true });
      return;
    }
    const defenseRenderer = renderers.defense;
    // 설치 모드가 아닐 때: 강화 카드 버튼 → 강화·판매, 타워 → 고르기(이미 고른 타워를 다시 누르면 강화), 빈 곳 → 카드 닫기
    if (!run.engine.buildMode && defenseRenderer) {
      const computerSelected = defenseRenderer.selectedTowerId === 'computer';
      const selected = run.engine.towers.find(tower => tower.id === defenseRenderer.selectedTowerId);
      const action = defenseRenderer.cardActionAt(point.x, point.y);
      if (action && computerSelected) {
        event.preventDefault();
        if (action === 'upgrade') run.engine.upgradeComputer();
        return;
      }
      if (action && selected) {
        event.preventDefault();
        if (action === 'upgrade') run.engine.upgradeTower(selected);
        else if (action === 'sell') run.engine.sellTower(selected);
        return;
      }
      const tower = run.engine.towerAt(defenseRenderer.toField(point.x, point.y));
      // 컴퓨터를 누르면 컴퓨터 강화 카드(이미 골랐으면 바로 강화)
      if (!tower && defenseRenderer.isComputerAt(point.x, point.y)) {
        event.preventDefault();
        if (computerSelected) run.engine.upgradeComputer();
        else {
          defenseRenderer.selectTower('computer');
          sound.play('lock');
        }
        ui.elements.hiddenInput?.focus({ preventScroll: true });
        return;
      }
      if (tower) {
        event.preventDefault();
        if (selected === tower) run.engine.upgradeTower(tower);
        else {
          defenseRenderer.selectTower(tower.id);
          sound.play('lock');
        }
      } else defenseRenderer.selectTower(null);
      ui.elements.hiddenInput?.focus({ preventScroll: true });
      return;
    }
    const renderer = activeRenderer();
    if (!renderer) return;
    event.preventDefault();
    run.engine.placeAtPoint(renderer.toField(point.x, point.y));
    renderer.setPointer(event.pointerType === 'mouse' ? point : null);
  });
}

// 타워 발사음: 방화벽 = 화르륵, 허니팟 = (puddle 이벤트에서), 백신 = 레이저, EMP = 충전, 요격포 = 미사일 발사 → 0.18초 뒤 폭발
function playTowerShotSound(tower) {
  const type = tower?.type;
  if (type === 'firewall') sound.play('ignite');
  else if (type === 'antivirus') sound.play('laserShot');
  else if (type === 'emp') sound.play('empCharge');
  else if (type === 'interceptor') {
    sound.play('missileLaunch');
    sound.play('missileBoom', { delay: 0.18 });
  }
}

// 컴퓨터 디펜스 전용 이벤트(소리·로그). 처리했으면 true, 공통 처리(lock·mistake 등)는 false
function handleDefenseEvent(type, payload) {
  switch (type) {
    case 'keystroke': {
      // 타자 연주: 맞게 친 글자마다 C major 음을 올라간다
      const index = Math.max(0, (run.engine?.typed?.length ?? 1) - 1);
      sound.play('key', { character: run.lastCharacter });
      sound.play('rhythmHit', { frequency: midiToFrequency(C_MAJOR_MIDI[index % (C_MAJOR_MIDI.length - 1)]), judgement: 'great' });
      return true;
    }
    case 'throw':
      sound.play('key', { character: run.lastCharacter });
      // 낱말 끝: 한 옥타브 위 도로 해결되는 짧은 아르페지오
      sound.play('rhythmWord', { frequency: midiToFrequency(C_MAJOR_MIDI.at(-1)) });
      if (payload.target?.kind === 'bug') sound.play('throwPhone');
      if (payload.tier > run.lastTier) {
        sound.play('tierUp', { tier: payload.tier });
        pulseClass(ui.elements.arcadeStage, 'tier-flash', 600);
      }
      run.lastTier = payload.tier;
      return true;
    case 'spawn':
      sound.play('spawnRobot', { type: ATTACK_TYPES[payload.bug.type]?.boss ? 'boss' : 'basic' });
      return true;
    case 'word-done':
      sound.play('rhythmWord', { frequency: midiToFrequency(C_MAJOR_MIDI.at(-1)) });
      sound.play('itemSpawn');
      return true;
    case 'boss-phase':
      sound.play('explode');
      sound.play('tierUp', { tier: 4 });
      pulseClass(ui.elements.arcadeStage, 'shake', 500);
      ui.log('err', `💢 PHASE 2 — ${payload.label}: 빨라지고 졸개를 부르며 타워를 잠가요`);
      return true;
    case 'boss-summon':
      sound.play('spawnRobot', { type: 'basic' });
      return true;
    case 'draft': {
      // 카드가 한 장씩 깔리는 '샥' → 뒤집힐 때 등급음, 전설이 있으면 등장음까지(화면 연출 시간과 맞춘다)
      payload.hand.forEach((id, index) => {
        const rarity = CARD_RARITY_ORDER.indexOf(cardById(id)?.rarity);
        sound.play('cardDeal', { delay: index * 0.14 });
        sound.play('cardReveal', { delay: index * 0.14 + 0.34, rarity: Math.max(0, rarity) });
        if (rarity === 3) sound.play('cardLegend', { delay: index * 0.14 + 0.34 });
      });
      ui.log('info', `🃏 WAVE ${payload.wave} 돌파 — 강화 카드 ${payload.hand.length}장 중 1장을 고르세요`);
      return true;
    }
    case 'card-picked': {
      const card = cardById(payload.card);
      sound.play('cardPick', { rarity: Math.max(0, CARD_RARITY_ORDER.indexOf(payload.rarity)) });
      emitSparks(ui.elements.arcadeStage, { color: { common: '#9fb3c8', rare: '#36e2ff', epic: '#c77dff', legendary: '#ffc94d' }[payload.rarity] ?? '#36e2ff', count: payload.rarity === 'legendary' ? 28 : 12 });
      if (payload.rarity === 'legendary') pulseClass(ui.elements.arcadeStage, 'tier-flash', 700);
      if (card) ui.log('info', `${card.icon} ${card.name}: ${card.text}`);
      return true;
    }
    case 'jackpot':
      sound.play('gachaReveal', { rarity: 3 });
      ui.log('info', `🎰 잭팟! 코인 +${payload.coins}`);
      return true;
    case 'shutter-block':
      sound.play('lock');
      ui.log('info', '🚪 방화 셔터가 공격을 막았어요');
      return true;
    case 'counter-hack':
      sound.play('zap');
      return true;
    case 'kill-blast':
      sound.play('missileBoom');
      return true;
    case 'backup-restore':
      sound.play('tierUp', { tier: 4 });
      pulseClass(ui.elements.arcadeStage, 'tier-flash', 600);
      ui.log('warn', `💾 백업 서버 가동 — 체력 ${payload.health}으로 복구`);
      return true;
    case 'tower-locked':
      sound.play('error');
      ui.log('warn', `🔒 ${TOWER_TYPES[payload.tower.type].label}가 ${payload.seconds ?? 3}초 잠겼어요`);
      return true;
    case 'air-warning':
      sound.play('warning', { remainingSeconds: 1 });
      ui.log('warn', '✈ 드론 출현 — 길을 무시하고 날아와요. 요격포(5)·EMP포(4)·컴퓨터가 맞힐 수 있어요');
      return true;
    case 'bug-blocked':
      return true;
    case 'puddle':
      sound.play('honeyLob');
      sound.play('honeySplat', { delay: 0.32 });
      return true;
    case 'tower-sold':
      sound.play('sell');
      ui.log('info', `💰 ${TOWER_TYPES[payload.tower.type].label} 판매 (+${payload.refund}🪙)`);
      return true;
    case 'bug-hit':
      sound.play('robotHit', { type: 'tank', weapon: 'phone', remainingHp: payload.bug.hp });
      return true;
    case 'bug-kill':
      sound.play('robotKill', { type: ATTACK_TYPES[payload.bug.type]?.boss ? 'boss' : 'basic', combo: run.engine?.combo ?? 1, tier: getTierIndex(run.engine?.combo ?? 1), withReward: payload.source === 'typing' });
      if (ATTACK_TYPES[payload.bug.type]?.boss) {
        run.engine?.hitStop?.(0.2);
        ui.log('ok', payload.bug.type === 'rootkit' ? '👑 루트킷 격파! 권한 회수' : '🔓 랜섬웨어 격파!');
      }
      return true;
    case 'tower-shot':
      playTowerShotSound(payload.tower);
      return true;
    case 'splash':
      sound.play('empBlast', { delay: 0.15 });
      return true;
    case 'air-jammed':
      sound.play('zap', { delay: 0.15 });
      return true;
    case 'guardian-spawn':
      sound.play('powerUp');
      ui.log('ok', payload.respawn ? '🤖 가디언 봇 재출동!' : '🤖 가디언 봇 출동! 컴퓨터 둘레의 적과 싸워요');
      return true;
    case 'guardian-hit':
      sound.play('robotHit', { type: 'basic', weapon: 'laptop', remainingHp: payload.bug.hp });
      return true;
    case 'guardian-hurt':
      sound.play('hit');
      return true;
    case 'boss-laser-charge':
      sound.play('bossLaserCharge');
      return true;
    case 'boss-laser':
      sound.play('bossLaser');
      return true;
    case 'guardian-down':
      sound.play('explode');
      ui.log('warn', `🤖 가디언 봇이 쓰러졌어요 — 8초 뒤 재출동`);
      return true;
    case 'guard-shot':
      sound.play('throwPhone');
      return true;
    case 'guard-hit':
      if (payload.bug) sound.play('laserShot');
      return true;
    case 'computer-upgraded':
      sound.play('upgrade', { maxed: payload.maxed });
      ui.log('ok', `🖥 컴퓨터 Lv.${payload.level}${payload.maxed ? ` ★ ${payload.stats.perk}` : ''} — 체력 ${Math.round(run.engine.health)}/${run.engine.maxHealth} (-${payload.price}🪙)`);
      renderInputBar();
      return true;
    case 'honey-step':
      sound.play('honeyStep');
      return true;
    case 'coins':
      if (payload.reason !== 'tower') sound.play('itemSpawn');
      return true;
    case 'build-mode':
      sound.play('lock');
      ui.log('info', `🛠 ${TOWER_TYPES[payload.tower].label} ${payload.upgrade ? '업그레이드' : '설치'} — 길이 아닌 곳을 누르거나 자리 번호 키 · Esc 취소`);
      return true;
    case 'place-denied':
      sound.play('error');
      ui.log('warn', { path: '근처에 빈자리가 없어요', computer: '근처에 빈자리가 없어요', blocked: '근처에 빈자리가 없어요', outside: '들판 밖이에요', 'max-level': '이미 최고 레벨이에요', 'max-towers': `타워는 ${DEFENSE_RULES.maxTowers}개까지예요`, coins: `코인이 모자라요 (${payload.price}🪙)` }[payload.reason] ?? '여기에는 세울 수 없어요');
      return true;
    case 'build-cancel':
      ui.log('info', '설치 취소');
      return true;
    case 'tower-built':
    case 'tower-upgraded':
      // 설치는 낙하가 끝나 착지하는 0.45초에 '쿵', 강화는 충전 → 터짐 화음
      if (type === 'tower-built') sound.play('towerLand', { delay: 0.45 });
      else sound.play('upgrade', { maxed: Boolean(payload.perk) });
      ui.log('ok', `🛡 ${TOWER_TYPES[payload.tower.type].label} ${type === 'tower-built' ? `설치${payload.nudged ? '(빈자리로 옮김)' : ''}` : `Lv.${payload.tower.level}${payload.perk ? ` ★ ${payload.perk.label}` : ''}`} (-${payload.price}🪙)`);
      return true;
    case 'repair':
      sound.play('powerUp');
      ui.log('ok', `🔧 컴퓨터 수리 — 체력 ${Math.round(payload.health)}`);
      return true;
    case 'shop-denied':
      sound.play('error');
      ui.log('warn', { coins: `코인이 모자라요 (${payload.price}🪙 필요, ${payload.coins}🪙 보유)`, 'no-slot': '설치·업그레이드할 자리가 없어요', full: '체력이 이미 가득해요' }[payload.reason] ?? '살 수 없어요');
      return true;
    case 'wave-intro':
      sound.play('warning', { remainingSeconds: 1 });
      bgm.setTempoBpm(payload.bpm);
      ui.log('warn', `🌊 WAVE ${payload.wave} — BPM ${payload.bpm}${payload.tierUp ? ` · ⚠ 적 업그레이드 v${payload.tier}(더 단단하고 빨라요)` : ''}`);
      return true;
    case 'wave-start':
      bgm.setTempoBpm(payload.bpm);
      return true;
    case 'breakpoint':
      sound.play('glassCrack');
      ui.log('ok', `⏸ 브레이크포인트 — 모든 적 ${payload.seconds}초 멈춤`);
      return true;
    case 'wave-clear':
      sound.play('newRecord');
      ui.log('ok', `WAVE ${payload.wave} CLEAR (+${payload.bonus}🪙${payload.perfect ? ' · 무피해' : ''})`);
      return true;
    case 'boss-appear':
      sound.play('explode');
      pulseClass(ui.elements.arcadeStage, 'shake', 400);
      ui.log('err', payload.bug?.type === 'rootkit' ? '👑 루트킷 등장! 최종 보스 — 체력 절반에서 2페이즈' : '🔒 랜섬웨어 등장! 체력 절반에서 2페이즈');
      return true;
    case 'danger':
      sound.play('warning', { remainingSeconds: 1 });
      ui.log('err', '⚠ 방화벽 체력 30% 아래 — 수리(patch)하세요');
      return true;
    case 'damage':
      sound.play('lifeLost');
      sound.play('glassCrack');
      run.engine?.hitStop?.(0.08);
      pulseClass(ui.elements.arcadeStage, 'shake', 300);
      ui.log('err', `해킹 공격이 컴퓨터에 닿음 — 체력 ${Math.max(0, Math.round(payload.health))}`);
      renderInputBar();
      return true;
    case 'goal':
      sound.play('newRecord');
      run.engine?.hitStop?.(0.22);
      pulseClass(ui.elements.arcadeStage, 'tier-flash', 900);
      ui.log('ok', '🛡 모든 웨이브를 막았어요 — 시스템 안전!');
      return true;
    default:
      return false;
  }
}

// 게임 상황 → BGM: 던지기는 콤보 단계, 구조는 SLA 위기도. 아이템 효과가 끝나면 종료음.
function updateArcadeMusic(snapshot) {
  if (settings.mode === 'rhythm') return;
  if (settings.mode === 'defense') {
    // 웨이브 BPM(110→130)은 wave 이벤트로, 위험(체력 30% 미만)이면 고음을 깎아 먹먹하게
    bgm.setIntensity(snapshot.danger ? 2 : Math.min(2, Math.floor((snapshot.wave - 1) / 2)));
    bgm.setTempoBpm(snapshot.bpm);
    bgm.setMuffled(snapshot.danger && snapshot.status === 'running');
    return;
  }
  const powerActive = snapshot.powerRemaining > 0;
  if (run.powerActive && !powerActive) sound.play('powerDown');
  run.powerActive = powerActive;
  if (settings.mode === 'battery') {
    const danger = snapshot.myCells < 1.5 ? 2 : snapshot.myCells < 2.5 ? 1 : 0;
    bgm.setIntensity(Math.max(danger, snapshot.tierProgress.index), { tempoBoost: snapshot.myCells < 1.5 ? 1.08 : 1, power: powerActive });
  } else {
    bgm.setIntensity(snapshot.lives <= 1 ? Math.max(snapshot.tierProgress.index, 1) : snapshot.tierProgress.index, { power: powerActive });
  }
}

// 리듬 모드는 BGM 대신 게임이 직접 박자에 맞춘 반주를 낸다. 곡을 고르는 동안(시작 전)에는 대기 음악을 튼다
function startMusic() {
  if (settings.mode === 'rhythm') {
    if (run.engine?.status === 'ready' && !isPvp()) bgm.play('lobby');
    else bgm.stop();
    return;
  }
  // 휴대폰 던지기 보스전(경고~싸움)에는 전용 곡. 보스를 쓰러뜨리거나 새 판을 시작하면 원래 곡으로 돌아온다
  const bossWave = settings.mode === 'throw' && ['warning', 'fight'].includes(run.engine?.bossPhase);
  bgm.play(bossWave ? 'boss' : settings.mode);
}

// ---------- 배터리 구조 판 준비(혼자 하기) ----------
// 상대는 라인업 순서대로(이기면 다음 상대), 날씨는 판마다 무작위(같은 날씨 연속 없음), 덱은 고른 대로 저장
const batteryPrep = {
  ladder: Math.max(0, Number(preferences.get('batteryLadder', 0)) || 0),
  deck: sanitizeDeck(preferences.get('batteryDeck', DEFAULT_DECK)),
  mirror: preferences.get('batteryMirror', null),
  weather: pickWeather(Math.random, preferences.get('batteryWeather', null))
};

function sanitizeDeck(deck) {
  const valid = (Array.isArray(deck) ? deck : []).filter(key => BATTERY_ITEMS[key] && key !== BASE_ITEM);
  return [...new Set(valid)].slice(0, DECK_SIZE);
}

const currentPersona = () => PERSONA_ORDER[batteryPrep.ladder % PERSONA_ORDER.length];

function batteryMatchOptions() {
  return { persona: currentPersona(), deck: batteryPrep.deck, weather: batteryPrep.weather, mirrorProfile: batteryPrep.mirror ?? undefined };
}

// 배터리 판 꾸미기 이벤트(성격 대사·날씨·새 아이템). 소리·기록만, 그림은 화면(BatteryRenderer)이 한다. 처리했으면 true
function handleBatteryModeEvent(type, payload) {
  switch (type) {
    case 'taunt':
      return true;
    case 'big-wave':
      sound.play('splash');
      ui.log('warn', '🌊 큰 파도! 두 탑이 가라앉아요');
      return true;
    case 'reflect':
      sound.play('glassCrack');
      ui.log(payload.attacker === 'me' ? 'err' : 'ok', payload.attacker === 'me' ? '🪞 방전봇의 반사 방패에 막혀 되레 뺏겼어요' : '🪞 반사 방패! 뺏으려던 걸 되돌려 받았어요');
      return true;
    case 'trap-sprung':
      sound.play(payload.victim === 'me' ? 'lifeLost' : 'powerUp');
      ui.log(payload.victim === 'me' ? 'err' : 'ok', payload.victim === 'me' ? `🪤 함정 셀이었어요! −${Math.round((payload.item.trapLoss ?? 1) * 10) / 10}칸` : `🪤 ${rivalName()}이(가) 함정에 걸렸어요`);
      return true;
    case 'magnet-take':
      sound.play(payload.owner === 'me' ? 'itemSpawn' : 'error');
      return true;
    case 'immune-block':
      sound.play('glassCrack');
      ui.log(payload.attacker === 'me' ? 'warn' : 'ok', payload.attacker === 'me' ? `💊 ${rivalName()}이(가) 면역 중이라 못 뺏었어요` : '💊 면역! 뺏기를 막았어요');
      return true;
    default:
      return false;
  }
}

// 판이 끝나면: 이겼으면 다음 상대, 내 습관을 미러봇용으로 기억, 다음 판 날씨를 새로 뽑는다
function advanceBatteryPrep(summary) {
  if (summary.mode !== 'battery' || isPvp() || summary.autoPlay) return;
  if (summary.outcome === 'rescued' || summary.outcome === 'rival-sunk') {
    batteryPrep.ladder++;
    preferences.set('batteryLadder', batteryPrep.ladder);
  }
  batteryPrep.mirror = mirrorProfile(summary);
  preferences.set('batteryMirror', batteryPrep.mirror);
  preferences.set('batteryWeather', batteryPrep.weather);
  batteryPrep.weather = pickWeather(Math.random, batteryPrep.weather);
}

// 준비 판: 혼자 하기에서 아직 시작 전일 때만 보인다
function updateBatteryPrep() {
  const panel = document.getElementById('batteryPrep');
  if (!panel) return;
  const show = settings.mode === 'battery' && !isPvp() && run.engine?.status === 'ready';
  panel.hidden = !show;
  if (!show) return;
  const personaKey = currentPersona();
  const persona = PERSONAS[personaKey];
  const round = Math.floor(batteryPrep.ladder / PERSONA_ORDER.length) + 1;
  const rival = document.getElementById('prepRival');
  rival.style.setProperty('--persona', persona.look.glow);
  rival.innerHTML = '';
  rival.append(
    Object.assign(document.createElement('span'), { className: 'prep-icon', textContent: persona.icon }),
    Object.assign(document.createElement('div'), { className: 'prep-text' })
  );
  rival.lastChild.append(
    Object.assign(document.createElement('b'), { textContent: `상대 ${batteryPrep.ladder % PERSONA_ORDER.length + 1}/${PERSONA_ORDER.length}${round > 1 ? ` (${round}회차)` : ''} · ${persona.name}` }),
    Object.assign(document.createElement('small'), { textContent: persona.blurb })
  );
  const weather = WEATHERS[batteryPrep.weather];
  const weatherCard = document.getElementById('prepWeather');
  weatherCard.style.setProperty('--persona', '#4fc3ff');
  weatherCard.innerHTML = '';
  weatherCard.append(
    Object.assign(document.createElement('span'), { className: 'prep-icon', textContent: weather.icon }),
    Object.assign(document.createElement('div'), { className: 'prep-text' })
  );
  weatherCard.lastChild.append(
    Object.assign(document.createElement('b'), { textContent: `날씨 · ${weather.name}` }),
    Object.assign(document.createElement('small'), { textContent: weather.blurb })
  );
  document.getElementById('prepDeckCount').textContent = `${batteryPrep.deck.length}/${DECK_SIZE}`;
  const chips = document.getElementById('prepDeck');
  chips.replaceChildren(...Object.entries(BATTERY_ITEMS).filter(([key]) => key !== BASE_ITEM).map(([key, item]) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'prep-chip';
    chip.dataset.item = key;
    chip.title = `${item.label} — 등급이 높을수록 세져요\n${RARITY_ORDER.map(rarity => `${ITEM_RARITIES[rarity].label}: ${itemEffectText(key, rarity)}`).join('\n')}`;
    chip.style.setProperty('--chip', ITEM_LOOKS[key]?.color ?? '#36e2ff');
    chip.setAttribute('aria-pressed', String(batteryPrep.deck.includes(key)));
    chip.textContent = `${ITEM_LOOKS[key]?.icon ?? ''} ${item.label}`;
    return chip;
  }));
}

// 덱 칩 누르기: 넣기/빼기(꽉 차 있으면 흔들기). 아직 시작 전이라 판을 새 덱으로 다시 만든다
function toggleDeckItem(key) {
  const deck = batteryPrep.deck;
  if (deck.includes(key)) batteryPrep.deck = deck.filter(entry => entry !== key);
  else if (deck.length >= DECK_SIZE) {
    const chip = document.querySelector(`.prep-chip[data-item="${key}"]`);
    chip?.classList.remove('full');
    void chip?.offsetWidth;
    chip?.classList.add('full');
    sound.play('error');
    ui.log('warn', `덱은 ${DECK_SIZE}종까지예요 — 하나를 빼고 넣으세요`);
    return;
  } else batteryPrep.deck = [...deck, key];
  preferences.set('batteryDeck', batteryPrep.deck);
  sound.play('uiClick');
  if (run.engine?.status === 'ready') resetGame();
  else updateBatteryPrep();
}

function createEngine() {
  if (!isArcade()) {
    if (isTimeAttack()) return new TimeAttackEngine({ tokenPool: getTokenPool(settings.languageKey), onEvent: handlePracticeEvent });
    return new TypingEngine({
      tokenPool: getTokenPool(settings.languageKey),
      durationSeconds: settings.durationSeconds,
      onEvent: handlePracticeEvent
    });
  }
  if (isPvp() && pvpConnected()) return createPvpEngine();
  const config = modeConfig();
  const rhythmOptions = settings.mode === 'rhythm' ? { songId: settings.rhythmSong, difficulty: settings.rhythmDifficulty, rhythmOptions: settings.rhythmOptions } : {};
  return config.createEngine({
    ...rhythmOptions,
    tokenPool: getTokenPool(settings.languageKey), level: settings.level, onEvent: handleArcadeEvent,
    narrow: ui.elements.arcadeCanvas.getBoundingClientRect().width < NARROW_WIDTH || window.innerWidth < NARROW_WIDTH
  });
}

function resetGame() {
  stopTicking();
  cancelAnimationFrame(run.frameId);
  run.generation++;
  run.sessionPromise = null;
  run.submitted = false;
  run.lastTier = 0;
  run.powerActive = false;
  run.engine = createEngine();
  rhythmMusic.reset();
  bgm.setIntensity(0);
  bgm.duck(false);
  ui.hideResult();
  run.lastResult = null;
  if (isArcade()) {
    const config = modeConfig();
    fitArcadeCanvas();
    renderers[settings.mode] ??= new config.Renderer(ui.elements.arcadeCanvas);
    const rhythm = settings.mode === 'rhythm';
    ui.elements.arcadeTitle.textContent = rhythm ? `${settings.rhythmSong}.mid` : config.title;
    ui.elements.arcadeHint.textContent = `${LANGUAGES[settings.languageKey].label} · ${rhythm ? rhythmLabel() : DIFFICULTY_LEVELS[settings.level].label}`;
    startFrameLoop();
  } else {
    ui.elements.fileName.textContent = LANGUAGES[settings.languageKey].file;
    ui.renderToken(run.engine);
    updateKeyboardHint();
  }
  updateBatteryPrep();
  renderStats();
  renderInputBar();
  updateFocusState();
}

// ---------- 리듬 곡 선택 ----------
const rhythmLabel = () => `${getSong(settings.rhythmSong).title} · ${RHYTHM_DIFFICULTIES[settings.rhythmDifficulty].label}`;

// 곡·난이도별 레벨 숫자: 고정 시드로 악보를 한 번 만들어 재고 언어별로 기억한다(글자 수가 낱말 길이에 따라 조금 달라서)
const rhythmLevelCache = new Map();
function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
function rhythmLevel(songId, difficulty) {
  const key = `${settings.languageKey}:${songId}:${difficulty}`;
  if (!rhythmLevelCache.has(key)) {
    let level = 1;
    try {
      level = new RhythmEngine({ tokenPool: getTokenPool(settings.languageKey), random: seededRandom(7), songId, difficulty }).levelNumber();
    } catch (error) {
      /* 낱말이 모자란 언어 등: 1로 표시 */
    }
    rhythmLevelCache.set(key, level);
  }
  return rhythmLevelCache.get(key);
}

// 곡·난이도별 최고 기록 {score, rank}(이 기기). 점수가 더 높을 때만 바꾼다
function rhythmBest(songId, difficulty) {
  const all = preferences.get('rhythmBest', {});
  return all && typeof all === 'object' ? all[`${songId}:${difficulty}`] ?? null : null;
}
// 점수·EX 비율·클리어 램프는 각각 따로 더 좋은 것을 남긴다(램프: FAILED < ASSIST < EASY < CLEAR < HARD < FC < AP).
// 자동 연주는 기록하지 않는다. 예전 기록의 mark(FC/AP)는 램프로 이어 쓴다
function recordRhythmBest(summary) {
  if (summary.autoPlay) return;
  const all = { ...(preferences.get('rhythmBest', {}) || {}) };
  const key = `${summary.songId}:${summary.difficulty}`;
  const previous = all[key] ?? null;
  const previousLamp = lampOfRecord(previous);
  const lamp = lampOrder(summary.clearLamp) > lampOrder(previousLamp) ? summary.clearLamp : previousLamp;
  const better = !previous || summary.score > previous.score;
  const previousEx = Number.isFinite(previous?.exRate) ? previous.exRate : -1;
  const exRate = Number.isFinite(summary.exRate) ? Math.max(summary.exRate, previousEx) : previousEx;
  all[key] = {
    score: better ? summary.score : previous.score,
    rank: better ? summary.rank : previous.rank,
    ...(lamp ? { lamp } : {}),
    ...(exRate >= 0 ? { exRate } : {})
  };
  preferences.set('rhythmBest', all);
}

// 결과의 평균 타이밍을 남겨 다음 곡 선택에서 오프셋 추천에 쓴다(노트 20개 이상 친 판만)
function rememberRhythmTiming(summary) {
  const hits = summary.judgements.perfect + summary.judgements.great + summary.judgements.good + summary.judgements.bad;
  if (summary.autoPlay || hits < 20) return;
  const suggested = Math.max(-200, Math.min(200, Math.round((summary.offsetMs + summary.averageDeltaMs) / 5) * 5));
  settings.rhythmLastDeltaMs = suggested;
  preferences.set('rhythmLastDelta', suggested);
}

// 옵션 바꾸기: 저장하고 악보를 새로 만든다(속도·모드가 엔진에 들어가므로)
function changeRhythmOptions(patch) {
  if (run.engine?.status !== 'ready') return;
  const next = normalizeRhythmOptions({ ...settings.rhythmOptions, ...patch });
  // 켠 쪽이 이기게: 노페일을 켜면 서든데스·퍼펙트가, 서든데스·퍼펙트를 켜면 노페일이 꺼진다
  const adjusted = (patch.suddenDeath || patch.perfectOnly) ? normalizeRhythmOptions({ ...next, noFail: false, suddenDeath: patch.suddenDeath ?? next.suddenDeath, perfectOnly: patch.perfectOnly ?? next.perfectOnly })
    : patch.fadeIn ? normalizeRhythmOptions({ ...next, hidden: false, fadeIn: true }) : next;
  settings.rhythmOptions = adjusted;
  preferences.set('rhythmOptions', { ...adjusted });
  resetGame();
  sound.play('uiClick');
}

// 리듬 모드에서 아직 시작 전이면 곡 선택 화면을 보인다(시작하면 숨김)
function updateSongSelect() {
  const visible = settings.mode === 'rhythm' && run.engine?.status === 'ready' && !isPvp();
  renderSongSelect(ui.elements.songSelect, {
    visible,
    songId: settings.rhythmSong,
    difficulty: settings.rhythmDifficulty,
    focused: document.activeElement === ui.elements.hiddenInput,
    levelOf: rhythmLevel,
    bestOf: rhythmBest,
    options: settings.rhythmOptions,
    suggestedOffsetMs: settings.rhythmLastDeltaMs
  });
  if (!visible) songPreview.stop();
}

// 곡·난이도를 바꾸면 저장하고 악보를 새로 만든다. 곡이 바뀌면 미리듣기
function chooseRhythm({ songId = settings.rhythmSong, difficulty = settings.rhythmDifficulty }) {
  if (run.engine?.status !== 'ready') return;
  const songChanged = songId !== settings.rhythmSong;
  if (!songChanged && difficulty === settings.rhythmDifficulty) return;
  settings.rhythmSong = songId;
  settings.rhythmDifficulty = difficulty;
  preferences.set('rhythmSong', songId);
  preferences.set('rhythmDifficulty', difficulty);
  resetGame();
  sound.play('uiClick');
  if (songChanged) {
    startMusic();
    songPreview.play(getSong(songId));
    // 미리듣기 동안 대기 음악을 줄였다가 끝나면 되돌린다
    bgm.duck(true);
    clearTimeout(run.previewDuckTimer);
    run.previewDuckTimer = setTimeout(() => bgm.duck(false), 8500);
  }
}

// 곡 선택 중 방향키: ↑↓ 곡, ←→ 난이도. 처리했으면 true
function handleSongSelectKey(event) {
  if (settings.mode !== 'rhythm' || run.engine?.status !== 'ready') return false;
  const moves = {
    ArrowUp: () => ({ songId: stepSong(settings.rhythmSong, -1) }),
    ArrowDown: () => ({ songId: stepSong(settings.rhythmSong, 1) }),
    ArrowLeft: () => ({ difficulty: stepDifficulty(settings.rhythmDifficulty, -1) }),
    ArrowRight: () => ({ difficulty: stepDifficulty(settings.rhythmDifficulty, 1) })
  };
  if (!moves[event.key]) return false;
  event.preventDefault();
  chooseRhythm(moves[event.key]());
  return true;
}

function bindSongSelect() {
  ui.elements.songSelect.addEventListener('click', event => {
    const option = event.target.closest('[data-option]');
    if (option) {
      const delta = Number(option.dataset.delta) || 0;
      const kind = option.dataset.option;
      if (kind === 'speed') changeRhythmOptions({ speed: stepSpeed(settings.rhythmOptions.speed, delta) });
      else if (kind === 'offset') changeRhythmOptions({ offsetMs: settings.rhythmOptions.offsetMs + delta * 5 });
      else if (kind === 'offset-suggest' && Number.isFinite(settings.rhythmLastDeltaMs)) changeRhythmOptions({ offsetMs: settings.rhythmLastDeltaMs });
      else if (kind === 'gauge' && option.dataset.key) changeRhythmOptions({ gauge: option.dataset.key });
      else if (kind === 'toggle' && option.dataset.key) changeRhythmOptions({ [option.dataset.key]: !settings.rhythmOptions[option.dataset.key] });
      focusTypingArea();
      return;
    }
    const row = event.target.closest('[data-song]');
    const chip = event.target.closest('[data-difficulty]');
    if (row) chooseRhythm({ songId: row.dataset.song });
    if (chip) chooseRhythm({ difficulty: chip.dataset.difficulty });
  });
}

// ---------- 화면 키보드(연습 모드 전용) ----------
function updateKeyboardHint() {
  if (isArcade()) return;
  const engine = run.engine;
  if (engine.status === 'finished') {
    keyboard.setNext(null);
    return;
  }
  keyboard.setNext(engine.wrongInBuffer > 0 ? 'Backspace' : engine.current.text[engine.cursor]);
}

// 연습·게임·리듬 화면의 키보드 표시는 따로 기억한다(게임은 기본 숨김, 리듬은 기본 보임)
const keyboardShown = () => (settings.mode === 'rhythm' ? settings.keyboardInRhythm
  : isArcade() ? settings.keyboardInGame : settings.keyboardVisible);

function applyKeyboardVisibility() {
  updateRhythmZones();
  const shown = keyboardShown();
  keyboard.setVisible(shown);
  ui.elements.keyboardToggle.hidden = false;
  ui.elements.keyboardToggle.textContent = '⌨';
  ui.elements.keyboardToggle.title = `${isArcade() ? '게임 화면' : '화면'} 키보드 ${shown ? '숨기기' : '보이기'}`;
  ui.elements.keyboardToggle.classList.toggle('off', !shown);
  ui.elements.keyboardToggle.setAttribute('aria-pressed', String(shown));
  if (isArcade()) requestAnimationFrame(fitArcadeCanvas);
}

// 게임 화면 키보드: 잡고 있는 낱말의 다음 글자(오타가 있으면 Backspace)를 표시한다
// 리듬 시작 전(곡 선택~첫 원이 오기 직전)에는 키보드를 레인 4구역 색으로 칠해 둔다. 그 밖에는 끈다
function updateRhythmZones() {
  const engine = run.engine;
  let waiting = false;
  if (settings.mode === 'rhythm' && engine && engine.status !== 'finished') {
    if (engine.status === 'ready') waiting = true;
    else {
      const head = engine.headNote?.();
      waiting = Boolean(head) && head === engine.notes?.[0]
        && head.hitTime - (engine.gameTime - (engine.offset ?? 0)) > RHYTHM_RULES.startGrace;
    }
  }
  keyboard.showZones(waiting ? RHYTHM_LANES : null);
}

function updateArcadeKeyboardHint() {
  updateRhythmZones();
  if (!isArcade() || !keyboardShown()) return;
  const engine = run.engine;
  if (settings.mode === 'rhythm') {
    // 대문자는 소문자로 쳐도 되므로 Shift 없이 그 글자 키만 표시
    const next = engine?.status === 'running' ? engine.nextCharacter() : null;
    keyboard.setNext(next && /[A-Z]/.test(next) ? next.toLowerCase() : next);
    return;
  }
  const target = engine?.target;
  if (!target || engine.status === 'finished') {
    keyboard.setNext(null);
    return;
  }
  keyboard.setNext(engine.wrongInBuffer > 0 ? 'Backspace' : target.token.text[engine.typed.length] ?? null);
}

// ---------- 입력 ----------
// 숨은 textarea의 값 변화를 글자·지우기로 바꾼다(input.js). 모바일 조합 입력·스와이프·자동수정도 같은 규칙.
const shiftTracker = createShiftTracker();
const inputDiffer = createInputDiffer({
  onCharacter: character => applyCharacter(character),
  resolveCase: character => shiftTracker.resolve(character),
  onBackspace: () => applyBackspace(false),
  onIgnored: () => warnIme(),
  onHangul: () => showInputNotice('한→영 자동 변환'),
  onEnter: () => applyEnter()
});

function resetInputBuffer() {
  ui.elements.hiddenInput.value = inputDiffer.reset();
}

function warnIme() {
  showInputNotice('⚠ 영문 키보드로 바꿔 주세요');
  if (Date.now() - run.lastImeWarning < IME_WARNING_INTERVAL_MS) return;
  run.lastImeWarning = Date.now();
  ui.log('warn', '영문 자판에 없는 글자는 무시됩니다 — 키보드를 영문으로 바꿔 주세요');
}

// PvP는 카운트다운이 끝나야 입력을 받는다(로비·대기 중 입력이 엔진에 들어가지 않게)
const pvpInputBlocked = () => isPvp() && pvp.phase !== 'playing';

function applyCharacter(character) {
  if (pvpInputBlocked()) return;
  run.lastCharacter = character;
  startMusic();
  const engine = run.engine;
  if (isArcade()) {
    const result = engine.input(character, now());
    if (result?.accepted) keyboard.press(character, result.correct !== false);
    if (settings.mode === 'rhythm') {
      // 아무 키나 누르면 그 키가 속한 레인(키보드 1/4)이 빛난다: 감점(오타)이면 빨강, 아니면 레인 색. 첫 키로 곡이 시작되면 대기 음악을 끈다
      flashRhythmZone(character, result?.accepted && result.correct === false);
      if (result?.started) startMusic();
    }
    renderStats();
    renderInputBar();
    return;
  }
  const tokenNumberBefore = engine.tokenNumber;
  const result = engine.input(character, now());
  if (!result.accepted) return;
  keyboard.press(character, result.correct);
  if (engine.status === 'running') startTicking();
  ui.renderToken(engine, { full: engine.tokenNumber !== tokenNumberBefore });
  renderStats();
  updateKeyboardHint();
}

function applyBackspace(wholeToken) {
  if (pvpInputBlocked()) return;
  const engine = run.engine;
  if (!engine.backspace(now(), { wholeToken }).accepted) return;
  if (isArcade()) {
    keyboard.press('Backspace', true);
    renderInputBar();
    return;
  }
  keyboard.press('Backspace', true);
  ui.renderToken(engine, { full: false });
  updateKeyboardHint();
}

// Enter — 연습: 지금 토큰을 틀린 것으로 하고 다음 토큰으로 / 게임: 친 낱말 지우기.
// 데스크톱은 keydown, 모바일은 줄바꿈 문자로 들어올 수 있어 둘 다 받되, 50ms 안의 중복은 한 번으로 친다
const ENTER_DEDUPE_MS = 50;
function applyEnter() {
  if (pvpInputBlocked()) return;
  const time = now();
  if (time - (run.lastEnterAt ?? -Infinity) < ENTER_DEDUPE_MS) return;
  run.lastEnterAt = time;
  const engine = run.engine;
  if (isArcade()) {
    if (engine.clearInput(time).accepted) {
      keyboard.press('Enter', true);
      renderInputBar();
    }
    return;
  }
  if (!engine.skipToken(time).accepted) return;
  keyboard.press('Enter', false);
  ui.renderToken(engine, { full: true });
  updateKeyboardHint();
}

// 뗀 키로 칠 수 있는 글자 후보: event.key, 소문자, 키 자리(KeyA→a, Digit1→1). O(1)
function releasedCharacters(event) {
  const candidates = [];
  if (typeof event.key === 'string' && event.key.length === 1) candidates.push(event.key, event.key.toLowerCase());
  const letter = /^Key([A-Z])$/.exec(event.code ?? '');
  if (letter) candidates.push(letter[1].toLowerCase());
  const digit = /^Digit([0-9])$/.exec(event.code ?? '');
  if (digit) candidates.push(digit[1]);
  if (event.code === 'Space') candidates.push(' ');
  return candidates;
}

const PENALTY_COLOR = '#ff2846';
// 키보드 구역과 리듬 화면의 레인(넓은 직사각형)을 함께 빛낸다
function flashRhythmZone(character, penalty = false) {
  const laneIndex = laneOfCharacter(character);
  const lane = RHYTHM_LANES[laneIndex];
  if (!lane) return;
  const color = penalty ? PENALTY_COLOR : lane.color;
  keyboard.flashZone(lane.fingers, color);
  renderers.rhythm?.flashLane?.(laneIndex, color);
}

// 리듬: 게임 입력칸에 초점이 없을 때(곡 목록을 보는 중 등)도 누른 키의 구역을 빛낸다(입력칸에 있으면 applyCharacter가 한다)
function handleRhythmZoneKeyDown(event) {
  if (settings.mode !== 'rhythm' || event.repeat || document.activeElement === ui.elements.hiddenInput) return;
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
  const [character] = releasedCharacters(event);
  if (character) flashRhythmZone(character);
}

function handleRhythmKeyUp(event) {
  if (settings.mode !== 'rhythm' || run.engine?.status !== 'running' || typeof run.engine.release !== 'function') return;
  const candidates = releasedCharacters(event);
  if (candidates.length) run.engine.release(candidates, now());
}

// 컴퓨터 디펜스 단축키: 숫자 = 상점 품목(설치 모드에서는 자리 번호), Esc = 설치 취소.
// 지금 칠 글자가 그 숫자이면 타자로 넘긴다. 처리했으면 true
function handleDefenseHotkey(event) {
  const engine = run.engine;
  if (settings.mode !== 'defense' || engine?.status !== 'running' || event.isComposing) return false;
  if (event.key === 'Escape' && !engine.buildMode) return false;
  if (engine.phase === 'draft' && /^[1-9]$/.test(event.key)) {
    const picked = engine.hotkey(event.key);
    event.preventDefault();
    return picked || true;
  }
  if (/^[0-9]$/.test(event.key)) {
    const expected = engine.stream?.[0]?.token.text[engine.typed?.length ?? 0];
    if (expected === event.key) return false;
  } else if (event.key !== 'Escape') return false;
  const handled = engine.hotkey(event.key);
  if (handled) event.preventDefault();
  return handled;
}

function handleKeyDown(event) {
  shiftTracker.record(event);
  if (handleSongSelectKey(event)) return;
  if (handleDefenseHotkey(event)) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    if (!isPvp()) resetGame();
    return;
  }
  if (event.key === 'Enter' && !event.isComposing) {
    event.preventDefault();
    applyEnter();
    return;
  }
  if (event.isComposing) return;
  if (event.key === 'Backspace') {
    event.preventDefault();
    applyBackspace(event.ctrlKey || event.altKey || event.metaKey);
    return;
  }
  if (event.key === 'Tab') event.preventDefault();
}

function handleInput(event) {
  inputDiffer.sync(ui.elements.hiddenInput.value);
  // 조합 중에는 값을 건드리면 IME가 깨지므로, 조합이 끝났을 때만 센티널로 되돌린다
  if (!event.isComposing) resetInputBuffer();
}

function handleCompositionEnd() {
  inputDiffer.sync(ui.elements.hiddenInput.value);
  resetInputBuffer();
}

// 아케이드 하단 입력창: 원작의 입력칸처럼 지금 치는 낱말과 진행 상황을 보여준다
function renderInputBar() {
  const bar = ui.elements.inputBar;
  if (!bar) return;
  const engine = run.engine;
  if (!isArcade() || !engine) {
    if (!bar.hidden) bar.hidden = true;
    return;
  }
  if (bar.hidden) bar.hidden = false;
  if (settings.mode === 'rhythm') {
    renderRhythmInputBar(engine);
    return;
  }
  const target = engine.target;
  const typed = engine.typed.join('');
  const correctLength = target ? [...typed].findIndex((character, index) => character !== target.token.text[index]) : -1;
  const goodPart = correctLength === -1 ? typed : typed.slice(0, correctLength);
  const badPart = correctLength === -1 ? '' : typed.slice(correctLength);
  // 매 프레임 불리므로 바뀐 글자만 쓴다
  const setText = (node, text) => { if (node && node.textContent !== text) node.textContent = text; };
  setText(ui.elements.inputTyped, goodPart);
  setText(ui.elements.inputWrong, badPart);
  setText(ui.elements.inputRest, target ? target.token.text.slice(typed.length) : '');
  const notice = run.inputNotice && run.inputNotice.until > Date.now() ? run.inputNotice.message : '';
  setText(ui.elements.inputTarget, notice || (target ? '' : engine.status === 'finished' ? 'game over' : '낱말의 첫 글자를 치세요'));
  ui.elements.inputTarget.classList.toggle('notice', Boolean(notice));
  updateArcadeKeyboardHint();
}

// 리듬: 입력창에 지금 만드는 낱말(친 글자 / 남은 글자)
function renderRhythmInputBar(engine) {
  const word = engine.status === 'running' ? engine.currentWord : null;
  const notes = word ? word.noteIds.map(id => engine.findEntity(id)) : [];
  const done = notes.findIndex(note => note.state === 'pending');
  const split = done === -1 ? notes.length : done;
  ui.elements.inputTyped.textContent = notes.slice(0, split).map(note => note.character).join('');
  ui.elements.inputWrong.textContent = '';
  ui.elements.inputRest.textContent = notes.slice(split).map(note => note.character).join('');
  const notice = run.inputNotice && run.inputNotice.until > Date.now() ? run.inputNotice.message : '';
  ui.elements.inputTarget.textContent = notice || (word ? '' : engine.status === 'finished' ? 'game over' : '글자 키를 치면 시작');
  ui.elements.inputTarget.classList.toggle('notice', Boolean(notice));
  updateArcadeKeyboardHint();
}

// 입력창 안내(영문 키보드 전환 등)를 잠깐 띄운다. 게임 로그는 모바일에서 화면 밖이라 입력창에 직접 보여준다.
const INPUT_NOTICE_MS = 2500;
function showInputNotice(message) {
  run.inputNotice = { message, until: Date.now() + INPUT_NOTICE_MS };
  renderInputBar();
  clearTimeout(run.inputNoticeTimer);
  run.inputNoticeTimer = setTimeout(renderInputBar, INPUT_NOTICE_MS + 50);
}

// 터치 화면(휴대폰·태블릿)인가. 화면 키보드가 게임을 가리는 기기
const isTouchDevice = () => window.matchMedia?.('(pointer: coarse)').matches ?? false;
// 휴대폰으로 아케이드·리듬을 치는 중: 위쪽 메뉴·화면 키보드 그림 등을 숨기고 게임 화면만 남긴다(body.mobile-play)
const isMobilePlay = () => document.body.classList.contains('mobile-play');

function updateMobilePlay() {
  const playing = isTouchDevice() && isArcade() && document.activeElement === ui.elements.hiddenInput
    && run.engine?.status !== 'finished';
  if (playing === isMobilePlay()) return;
  document.body.classList.toggle('mobile-play', playing);
  fitArcadeCanvas();
  if (playing) requestAnimationFrame(pinArcadeStage);
}

// 게임 화면 윗변을 보이는 영역 맨 위에 맞춘다
function pinArcadeStage() {
  const stage = ui.elements.arcadeStage;
  const viewportTop = window.visualViewport?.offsetTop ?? 0;
  const target = window.scrollY + stage.getBoundingClientRect().top - viewportTop - 4;
  window.scrollTo({ top: Math.max(0, target), behavior: 'auto' });
  fitArcadeCanvas();
}

// 게임 화면 높이: 모바일 키보드가 올라오면(visualViewport 축소) 그만큼 줄여서 입력창이 키보드 바로 위에 오게 한다.
// 보이는 영역 = [offsetTop, offsetTop + height] (레이아웃 뷰포트 기준)
function fitArcadeCanvas() {
  if (!isArcade()) return;
  const canvas = ui.elements.arcadeCanvas;
  const viewport = window.visualViewport;
  const visibleBottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
  const top = isMobilePlay() ? Math.max(viewport?.offsetTop ?? 0, canvas.getBoundingClientRect().top) : canvas.getBoundingClientRect().top;
  const reserved = (ui.elements.inputBar?.offsetHeight || 40) + (isMobilePlay() ? 6 : 12);
  const available = Math.round(visibleBottom - Math.max(0, top) - reserved);
  const narrow = window.innerWidth < NARROW_WIDTH;
  const minimum = isMobilePlay() ? 200 : narrow ? 300 : 360;
  const height = Math.max(minimum, Math.min(narrow ? 640 : 560, available));
  if (Math.abs(canvas.clientHeight - height) > 2) canvas.style.height = `${height}px`;
}

function focusTypingArea() {
  startMusic();
  if (run.engine.status === 'finished') {
    // 끝난 판의 결과창을 실수로 닫았으면(바깥 클릭·Esc 등) 화면을 누를 때 다시 보여 준다
    if (ui.elements.resultModal.hidden && !isPvp()) showLastResult();
    return;
  }
  if (isPvp() && !['countdown', 'playing'].includes(pvp.phase)) return;
  // 이미 입력 중이면 건드리지 않는다: 값을 되돌리면 모바일 키보드의 조합이 깨지고, 스크롤이 튀어 화면이 흔들린다
  if (document.activeElement === ui.elements.hiddenInput) return;
  resetInputBuffer();
  ui.elements.hiddenInput.focus({ preventScroll: true });
  // 모바일: 키보드가 올라온 뒤 게임 화면이 보이도록 맞추고 높이를 다시 잰다(키보드 애니메이션이 끝날 즈음 한 번 더)
  if (isArcade()) {
    for (const delay of [350, 700]) {
      setTimeout(() => {
        if (isMobilePlay()) pinArcadeStage();
        else {
          ui.elements.arcadeStage.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
          fitArcadeCanvas();
        }
      }, delay);
    }
  }
}

// 게임 중에 입력창 포커스가 빠지면(화면 다른 곳을 눌렀을 때) 곧바로 되돌린다.
// 닫기 버튼을 눌렀거나, 다른 입력칸(설정·채팅 등)으로 옮겼거나, 판이 끝났으면 그대로 둔다
function keepGameFocus() {
  const playing = isArcade() && run.engine?.status === 'running' && !run.closingGame;
  if (playing) {
    setTimeout(() => {
      const active = document.activeElement;
      const typingElsewhere = active && active !== ui.elements.hiddenInput && active !== document.body && /^(INPUT|SELECT|TEXTAREA)$/.test(active.tagName);
      if (!typingElsewhere && run.engine?.status === 'running' && !run.closingGame) ui.elements.hiddenInput.focus({ preventScroll: true });
      updateFocusState();
    }, 0);
    return;
  }
  updateFocusState();
}

// 게임 방법·튜토리얼: ❓ 버튼이나 시작 화면의 버튼을 눌렀을 때만 연다.
// 판이 진행 중이면 멈출 수 없으므로 한 번 묻고 판을 처음으로 돌린 뒤 연다(PvP 대결 중엔 열지 않음)
function bindGuide() {
  const guide = createGuide(document.getElementById('guideModal'), {
    sound,
    onClose: () => { if (run.engine?.status !== 'finished') focusTypingArea(); }
  });
  const openGuide = event => {
    event.preventDefault();
    event.stopPropagation();
    const running = run.engine?.status === 'running';
    if (running && isPvp()) return;
    if (running && !window.confirm('게임 방법을 볼까요? 지금 판은 처음부터 다시 시작돼요.')) {
      ui.elements.hiddenInput.focus({ preventScroll: true });
      return;
    }
    if (running) resetGame();
    ui.elements.hiddenInput.blur();
    sound.play('uiClick');
    guide.open(settings.mode);
  };
  document.getElementById('guideButton')?.addEventListener('click', openGuide);
  document.querySelectorAll('[data-guide-open]').forEach(button => {
    // 시작 화면(오버레이) 클릭 = 입력 준비이므로, 이 버튼 누름은 오버레이까지 올라가지 않게 막는다
    button.addEventListener('pointerdown', event => event.stopPropagation());
    button.addEventListener('click', openGuide);
  });
}

// 닫기 버튼: 진행 중이면 한 번 묻고, 판을 끝내 처음 화면(설정·게임 고르기)으로 돌아간다
function bindCloseGame() {
  const button = document.getElementById('closeGame');
  if (!button) return;
  // 입력줄을 누르면 입력창에 포커스가 가므로(키보드가 다시 뜸), 버튼 누름은 입력줄까지 올라가지 않게 막는다
  button.addEventListener('pointerdown', event => {
    event.preventDefault();
    event.stopPropagation();
  });
  button.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    const running = run.engine?.status === 'running';
    if (running && !isPvp() && !window.confirm('게임을 닫을까요? 지금 판은 끝나요.')) {
      ui.elements.hiddenInput.focus({ preventScroll: true });
      return;
    }
    run.closingGame = true;
    ui.elements.hiddenInput.blur();
    if (isPvp()) {
      if (confirmLeavePvp()) showPvpMenu();
    } else {
      resetGame();
    }
    document.body.classList.remove('mobile-play');
    fitArcadeCanvas();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => { run.closingGame = false; }, 300);
  });
}

function updateFocusState() {
  ui.setFocusState({
    focused: document.activeElement === ui.elements.hiddenInput,
    finished: run.engine.status === 'finished',
    arcade: isArcade()
  });
  updateMobilePlay();
  // 리듬은 시작 전 안내를 곡 선택 화면이 대신한다
  if (settings.mode === 'rhythm' && run.engine.status === 'ready') ui.elements.arcadeOverlay.hidden = true;
  updateSongSelect();
}

// ---------- 배터리 구조 PvP ----------
const lobby = createPvpLobby(document.getElementById('pvpLobby'), {
  onCreate: name => createPvpRoom(name),
  onJoin: (code, name) => joinPvpRoom(code, name),
  onCancel: () => cancelPvpSetup(),
  onBack: () => showPvpMenu(),
  onRematch: () => requestPvpRematch(),
  onLeave: () => leavePvp()
});

function showPvpMenu() {
  pvp.phase = 'menu';
  lobby.setName(preferences.get('name', ''));
  lobby.show('menu');
}

function renderBatteryVariant() {
  ui.elements.batteryVariantButtons.forEach(button => {
    const active = button.dataset.batteryVariant === settings.batteryVariant;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

// 대결 중 설정이 바뀌면 경기가 깨지므로 연결된 동안 잠근다
function setPvpControlsLocked(locked) {
  ui.elements.languageSelect.disabled = locked;
  ui.elements.levelSelect.disabled = locked;
  ui.elements.batteryVariantButtons.forEach(button => { button.disabled = locked; });
}

// 연결 중에 다른 화면으로 가려 하면 확인. 나가면 상대에게도 알린다
function confirmLeavePvp() {
  if (!pvpConnected()) return true;
  if (!window.confirm(`${pvp.opponentName}와(과)의 대결에서 나갈까요?`)) return false;
  leavePvp();
  return true;
}

function leavePvp() {
  const connection = pvp.connection;
  pvp.connection = null;
  connection?.close();
  clearInterval(pvp.countdownTimer);
  setPvpControlsLocked(false);
  ui.hideResult();
  resetGame();
  if (isPvp()) showPvpMenu();
}

async function createPvpRoom(name) {
  preferences.set('name', name);
  sound.play('uiClick');
  startMusic();
  pvp.abort?.abort();
  const abort = new AbortController();
  pvp.abort = abort;
  pvp.phase = 'hosting';
  lobby.setStatus('연결 정보 만드는 중');
  lobby.show('joining');
  try {
    const connection = await hostRoom({
      name, settings: { language: settings.languageKey, level: settings.level }, signal: abort.signal,
      onCode: ({ code, expiresAt }) => {
        lobby.setCode(code, expiresAt);
        lobby.setStatus('상대를 기다리는 중');
        lobby.show('hosting');
        ui.log('sys', `PvP 방 ${code} — 친구에게 코드나 링크를 보내 주세요`);
      },
      onStatus: text => lobby.setStatus(text.replace(/…$/, ''))
    });
    if (abort.signal.aborted) return connection.close();
    onPvpConnected(connection);
  } catch (error) {
    handlePvpSetupError(error, abort);
  }
}

async function joinPvpRoom(code, name) {
  preferences.set('name', name);
  sound.play('uiClick');
  startMusic();
  pvp.abort?.abort();
  const abort = new AbortController();
  pvp.abort = abort;
  pvp.phase = 'joining';
  lobby.setStatus('방 찾는 중');
  lobby.show('joining');
  try {
    const connection = await joinRoom({ code, name, signal: abort.signal, onStatus: text => lobby.setStatus(text.replace(/…$/, '')) });
    if (abort.signal.aborted) return connection.close();
    onPvpConnected(connection);
  } catch (error) {
    handlePvpSetupError(error, abort);
  }
}

function handlePvpSetupError(error, abort) {
  if (error?.name === 'AbortError' || abort.signal.aborted) return;
  pvp.phase = 'error';
  ui.log('err', `PvP: ${error?.message ?? error}`);
  lobby.showError(error?.message ?? '연결에 실패했습니다');
}

function cancelPvpSetup() {
  pvp.abort?.abort();
  pvp.abort = null;
  if (pvpConnected()) leavePvp();
  else showPvpMenu();
}

function onPvpConnected(connection) {
  pvp.connection = connection;
  pvp.role = connection.role;
  pvp.opponentName = connection.opponentName ?? '상대';
  pvp.hostSettings = connection.role === 'host' ? { language: settings.languageKey, level: settings.level } : connection.settings;
  pvp.abort = null;
  connection.onMessage(handlePvpMessage);
  connection.onClose(handlePvpClose);
  connection.send({ t: 'hello', v: PVP_PROTOCOL_VERSION, name: lobby.getName() });
  setPvpControlsLocked(true);
  sound.play('rescued');
  ui.log('ok', `PvP 연결 — vs ${pvp.opponentName} (${connection.role === 'host' ? '내가 방장' : '손님으로 참가'})`);
  if (connection.role === 'host') startPvpCountdown();
  else {
    lobby.setStatus('방장이 시작하길 기다리는 중');
    lobby.show('joining');
  }
}

function createPvpEngine() {
  const common = { onEvent: handleArcadeEvent, maxTokenLength: 14, opponentName: pvp.opponentName };
  if (pvp.role === 'host') {
    return new BatteryPvpHostEngine({ ...common, tokenPool: getTokenPool(pvp.hostSettings.language), level: pvp.hostSettings.level });
  }
  return new BatteryPvpGuestEngine({
    ...common, tokenPool: getTokenPool(pvp.hostSettings.language), level: pvp.hostSettings.level,
    send: message => pvp.connection?.send(message)
  });
}

// 방장: 카운트다운을 보내고 같이 센다. 손님은 countdown 메시지를 받아 센다
function startPvpCountdown() {
  pvp.connection.send({ t: 'countdown', seconds: PVP_RULES.countdownSeconds });
  beginPvpCountdown(PVP_RULES.countdownSeconds);
}

function beginPvpCountdown(seconds) {
  clearInterval(pvp.countdownTimer);
  pvp.phase = 'countdown';
  pvp.finalStateSent = false;
  pvp.rematchRequested = false;
  pvp.lastStateSentAt = 0;
  resetGame();
  ui.elements.arcadeHint.textContent = `vs ${pvp.opponentName} · ${LANGUAGES[pvp.hostSettings.language].label} · ${DIFFICULTY_LEVELS[pvp.hostSettings.level].label}`;
  lobby.setOpponent(pvp.opponentName);
  lobby.show('countdown');
  let remaining = seconds;
  lobby.setCountdown(remaining);
  sound.play('warning', { remainingSeconds: remaining });
  pvp.countdownTimer = setInterval(() => {
    remaining--;
    if (remaining > 0) {
      lobby.setCountdown(remaining);
      sound.play('warning', { remainingSeconds: remaining });
      return;
    }
    clearInterval(pvp.countdownTimer);
    pvp.phase = 'playing';
    lobby.hide();
    if (pvp.role === 'host') run.engine.start(now());
    startMusic();
    updateFocusState();
  }, 1000);
}

// 프레임마다: 방장은 상태를 초당 20번 보내고(끝나면 마지막 상태 한 번), 손님은 상태가 끊기면 연결 끊김 처리
function pumpPvp() {
  const engine = run.engine;
  const time = now();
  if (engine instanceof BatteryPvpHostEngine) {
    if (engine.status === 'ready') return;
    if (engine.status === 'finished') {
      if (!pvp.finalStateSent) {
        pvp.finalStateSent = true;
        pvp.connection.send(engine.stateMessage());
      }
      return;
    }
    if (time - pvp.lastStateSentAt >= PVP_RULES.stateIntervalMs) {
      pvp.lastStateSentAt = time;
      pvp.connection.send(engine.stateMessage());
    }
  } else if (engine instanceof BatteryPvpGuestEngine && engine.isStale(time)) {
    handlePvpClose('timeout');
  }
}

function handlePvpMessage(message) {
  const engine = run.engine;
  switch (message.t) {
    case 'hello':
      if (message.v !== PVP_PROTOCOL_VERSION) {
        lobby.showError('상대와 게임 버전이 달라요. 두 기기 모두 새로고침한 뒤 다시 해 주세요');
        leavePvp();
        return;
      }
      if (message.name) pvp.opponentName = String(message.name).slice(0, 16);
      if (run.engine) run.engine.opponentName = pvp.opponentName;
      break;
    case 'countdown':
      if (pvp.role === 'guest') beginPvpCountdown(Math.max(1, Math.min(5, Number(message.seconds) || PVP_RULES.countdownSeconds)));
      break;
    case 'state':
      if (engine instanceof BatteryPvpGuestEngine) engine.applyState(message, now());
      break;
    case 'claim-result':
      if (engine instanceof BatteryPvpGuestEngine) engine.applyClaimResult(message);
      break;
    case 'progress':
      if (engine instanceof BatteryPvpHostEngine) engine.applyRemoteProgress(message);
      break;
    case 'claim':
      if (engine instanceof BatteryPvpHostEngine) pvp.connection?.send(engine.applyRemoteClaim(message));
      break;
    case 'rematch':
      if (pvp.role === 'host') {
        pvp.rematchRequested = true;
        ui.log('info', `${pvp.opponentName}이(가) 한 판 더 원해요 — '한 판 더'를 누르면 시작`);
        if (pvp.phase === 'ended' && lobby.visible) showPvpAfterMatch();
      }
      break;
    default:
      break;
  }
}

// 연결이 끊김: 경기 중이면 '연결 끊김'으로 끝내고, 대기 중이면 로비 오류 화면
function handlePvpClose(reason) {
  if (!pvpConnected()) return;
  const connection = pvp.connection;
  pvp.connection = null;
  connection.close();
  clearInterval(pvp.countdownTimer);
  setPvpControlsLocked(false);
  ui.log('warn', `PvP 연결 종료 — ${reason === 'remote-left' ? '상대가 나갔습니다' : '연결이 끊겼습니다'}`);
  if (!isPvp()) return;
  const engine = run.engine;
  if ((pvp.phase === 'playing' || pvp.phase === 'countdown') && engine.status !== 'finished') {
    lobby.hide();
    engine.outcome = 'disconnect';
    if (engine.status === 'ready') engine.status = 'running';
    engine.finish();
    return;
  }
  if (pvp.phase === 'ended') {
    if (lobby.visible) showPvpAfterMatch();
    return;
  }
  pvp.phase = 'error';
  lobby.showError(reason === 'remote-left' ? '상대가 방에서 나갔습니다' : '상대와 연결이 끊겼습니다');
}

// 경기 뒤 로비: 연결돼 있으면 한 판 더(방장)/요청(손님), 끊겼으면 메뉴로
function showPvpAfterMatch() {
  if (!pvpConnected()) {
    showPvpMenu();
    return;
  }
  const outcome = PVP_RESULT_TITLES[pvp.lastOutcome] ?? '경기 끝';
  if (pvp.role === 'host') {
    lobby.showRematch({
      text: `${outcome} · vs ${pvp.opponentName}${pvp.rematchRequested ? ' — 상대가 한 판 더 원해요!' : ''}`,
      buttonLabel: '한 판 더'
    });
  } else {
    lobby.showRematch({
      text: `${outcome} · vs ${pvp.opponentName}`,
      buttonLabel: pvp.rematchRequested ? '방장에게 요청함' : '한 판 더 요청', waiting: pvp.rematchRequested
    });
  }
}

function requestPvpRematch() {
  if (!pvpConnected()) {
    ui.hideResult();
    showPvpMenu();
    return;
  }
  sound.play('uiClick');
  ui.hideResult();
  if (pvp.role === 'host') {
    startPvpCountdown();
    return;
  }
  pvp.rematchRequested = true;
  pvp.connection.send({ t: 'rematch' });
  ui.log('info', '방장에게 한 판 더 요청했습니다');
  showPvpAfterMatch();
}

// 초대 링크(?room=CODE)로 들어오면 배터리 구조 PvP로 열고 코드를 채워 둔다(참가는 사용자가 누른다)
function applyInviteLink() {
  const params = new URLSearchParams(location.search);
  const code = params.get('room');
  if (!code) return;
  settings.mode = 'battery';
  settings.batteryVariant = 'pvp';
  lobby.prefillCode(code);
  params.delete('room');
  const query = params.toString();
  history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}${location.hash}`);
}

// ---------- 모드 · 설정 ----------
function applyMode() {
  const arcade = isArcade();
  // 위: 연습 | 게임, 게임을 고르면 아래 줄에 게임 4개(던지기·배터리·리듬·디펜스)
  const section = settings.mode === 'practice' ? 'practice' : 'game';
  ui.elements.sectionButtons.forEach(button => {
    const active = button.dataset.section === section;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  ui.elements.gameTabs.hidden = section !== 'game';
  ui.elements.modeButtons.forEach(button => {
    const active = button.dataset.mode === settings.mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  ui.elements.stage.hidden = arcade;
  ui.elements.arcadeStage.hidden = !arcade;
  ui.elements.durationGroup.hidden = arcade;
  ui.elements.levelSelect.hidden = !arcade || settings.mode === 'rhythm';
  ui.elements.batteryVariantGroup.hidden = settings.mode !== 'battery';
  renderBatteryVariant();
  if (isPvp()) {
    if (!pvpConnected() && !['hosting', 'joining', 'error'].includes(pvp.phase)) showPvpMenu();
  } else {
    lobby.hide();
  }
  document.getElementById('practiceHint').hidden = arcade;
  document.getElementById('throwHint').hidden = settings.mode !== 'throw';
  document.getElementById('batteryHint').hidden = settings.mode !== 'battery';
  document.getElementById('rhythmHint').hidden = settings.mode !== 'rhythm';
  document.getElementById('defenseHint').hidden = settings.mode !== 'defense';
  document.body.dataset.mode = settings.mode;
  document.getElementById('arcadeOverlayHint').textContent = arcade ? `${modeConfig().hint} · ${settings.mode === 'rhythm' ? '글자 키를 치면 시작' : '첫 글자를 치면 시작'}` : '';
  applyKeyboardVisibility();
  renderInputBar();
  requestAnimationFrame(fitArcadeCanvas);
}

function switchMode(mode) {
  if (!MODE_CONFIG[mode] || mode === settings.mode) return;
  if (!confirmLeavePvp()) return;
  songPreview.stop();
  settings.mode = mode;
  preferences.set('mode', mode);
  if (mode !== 'practice') preferences.set('lastGameMode', mode);
  run.highlightId = null;
  applyMode();
  resetGame();
  refreshBoard();
  sound.play('uiClick');
  startMusic();
}

function bindSettings() {
  ui.populateLanguages(settings.languageKey);
  ui.elements.levelSelect.replaceChildren(...Object.entries(DIFFICULTY_LEVELS).map(([level, config]) => {
    const option = document.createElement('option');
    option.value = level;
    option.textContent = config.label;
    return option;
  }));
  ui.elements.levelSelect.value = String(settings.level);
  ui.elements.levelSelect.addEventListener('change', () => {
    settings.level = Number(ui.elements.levelSelect.value);
    preferences.set('level', settings.level);
    resetGame();
    refreshBoard();
  });
  ui.elements.modeButtons.forEach(button => button.addEventListener('click', () => switchMode(button.dataset.mode)));
  // 「게임」은 마지막으로 한 게임으로(처음이면 휴대폰 던지기)
  ui.elements.sectionButtons.forEach(button => button.addEventListener('click', () => {
    if (button.dataset.section === 'practice') return switchMode('practice');
    const lastGame = preferences.get('lastGameMode', 'throw');
    return switchMode(MODE_CONFIG[lastGame] && lastGame !== 'practice' ? lastGame : 'throw');
  }));
  // 30·60·120초 = 고정 시간, ⏳연장 = 시간 연장. 바꾸면 랭킹 보드도 해당 방식으로 바뀐다
  const isActiveDuration = button => (button.dataset.variant === 'timeattack'
    ? settings.practiceVariant === 'timeattack'
    : settings.practiceVariant === 'timed' && Number(button.dataset.seconds) === settings.durationSeconds);
  const renderDurationButtons = () => ui.elements.durationButtons.forEach(button => {
    const active = isActiveDuration(button);
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  renderDurationButtons();
  ui.elements.durationButtons.forEach(button => {
    button.addEventListener('click', () => {
      const previousBoard = boardMode();
      if (button.dataset.variant === 'timeattack') {
        settings.practiceVariant = 'timeattack';
      } else {
        settings.practiceVariant = 'timed';
        settings.durationSeconds = Number(button.dataset.seconds);
        preferences.set('duration', settings.durationSeconds);
      }
      preferences.set('practiceVariant', settings.practiceVariant);
      renderDurationButtons();
      resetGame();
      if (boardMode() !== previousBoard) refreshBoard();
    });
  });
  ui.elements.batteryVariantButtons.forEach(button => button.addEventListener('click', () => {
    const variant = button.dataset.batteryVariant;
    if (variant === settings.batteryVariant || !confirmLeavePvp()) return;
    settings.batteryVariant = variant;
    preferences.set('batteryVariant', variant);
    sound.play('uiClick');
    applyMode();
    resetGame();
  }));
  ui.elements.languageSelect.addEventListener('change', () => {
    settings.languageKey = ui.elements.languageSelect.value;
    preferences.set('lang', settings.languageKey);
    resetGame();
    refreshBoard();
  });
  sound.setEnabled(preferences.get('sound', true));
  const renderSoundToggle = () => {
    ui.elements.soundToggle.textContent = sound.enabled ? '🔊' : '🔇';
    ui.elements.soundToggle.classList.toggle('off', !sound.enabled);
    ui.elements.soundToggle.setAttribute('aria-pressed', String(sound.enabled));
  };
  renderSoundToggle();
  ui.elements.soundToggle.addEventListener('click', () => {
    sound.setEnabled(!sound.enabled);
    preferences.set('sound', sound.enabled);
    renderSoundToggle();
  });
  bgm.setEnabled(preferences.get('bgm', true));
  const renderBgmToggle = () => {
    ui.elements.bgmToggle.textContent = '♫';
    ui.elements.bgmToggle.classList.toggle('off', !bgm.enabled);
    ui.elements.bgmToggle.setAttribute('aria-pressed', String(bgm.enabled));
  };
  renderBgmToggle();
  ui.elements.bgmToggle.addEventListener('click', () => {
    bgm.setEnabled(!bgm.enabled);
    preferences.set('bgm', bgm.enabled);
    renderBgmToggle();
    if (bgm.enabled) startMusic();
  });
  ui.elements.keyboardToggle.addEventListener('click', () => {
    if (settings.mode === 'rhythm') {
      settings.keyboardInRhythm = !settings.keyboardInRhythm;
      preferences.set('keyboardRhythm', settings.keyboardInRhythm);
    } else if (isArcade()) {
      settings.keyboardInGame = !settings.keyboardInGame;
      preferences.set('keyboardGame', settings.keyboardInGame);
    } else {
      settings.keyboardVisible = !settings.keyboardVisible;
      preferences.set('keyboard', settings.keyboardVisible);
    }
    applyKeyboardVisibility();
    if (isArcade()) updateArcadeKeyboardHint();
  });
}

function bindEvents() {
  const { elements } = ui;
  const restart = () => {
    if (isPvp()) {
      if (confirmLeavePvp()) showPvpMenu();
      return;
    }
    resetGame();
    focusTypingArea();
  };
  elements.restartButton.addEventListener('click', restart);
  // PvP 결과창의 '다시 하기' = 한 판 더(방장 바로 시작, 손님 요청)
  elements.retryButton.addEventListener('click', () => (isPvp() ? requestPvpRematch() : restart()));
  // 결과창 닫기: ✕ 버튼 · 바깥 어두운 영역 클릭. 기록은 그대로 두고 화면만 보여준다(↻로 재시작)
  const closeResult = () => {
    sound.play('uiClick');
    ui.hideResult();
    if (isPvp()) showPvpAfterMatch();
  };
  elements.resultClose.addEventListener('click', closeResult);
  elements.resultModal.addEventListener('click', event => { if (event.target === elements.resultModal) closeResult(); });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || elements.resultModal.hidden) return;
    event.preventDefault();
    closeResult();
  });
  elements.saveForm.addEventListener('submit', handleSave);
  elements.focusOverlay.addEventListener('click', focusTypingArea);
  elements.arcadeOverlay.addEventListener('click', focusTypingArea);
  // 덱 칩: 누르는 순간 포커스를 뺏기지 않게(입력창 유지)
  const prepDeck = document.getElementById('prepDeck');
  prepDeck?.addEventListener('mousedown', event => event.preventDefault());
  prepDeck?.addEventListener('click', event => {
    const chip = event.target.closest('.prep-chip');
    if (chip) toggleDeckItem(chip.dataset.item);
    elements.hiddenInput?.focus({ preventScroll: true });
  });
  elements.stage.addEventListener('click', focusTypingArea);
  elements.arcadeStage.addEventListener('click', focusTypingArea);
  bindDefensePointer(elements.arcadeCanvas);
  elements.hiddenInput.addEventListener('keydown', handleKeyDown);
  // 리듬 롱노트: 키를 떼는 순간을 알려 준다(한글 자판이어도 키 자리로 글자를 찾는다)
  document.addEventListener('keyup', handleRhythmKeyUp);
  document.addEventListener('keydown', handleRhythmZoneKeyDown);
  elements.hiddenInput.addEventListener('input', handleInput);
  elements.hiddenInput.addEventListener('compositionend', handleCompositionEnd);
  elements.hiddenInput.addEventListener('paste', event => event.preventDefault());
  elements.hiddenInput.addEventListener('focus', updateFocusState);
  elements.hiddenInput.addEventListener('blur', keepGameFocus);
  bindCloseGame();
  bindGuide();
  // 게임 화면(캔버스)을 터치해도 입력창 포커스가 빠지지 않게: 터치 기본 동작(포커스 이동·흉내 마우스)을 막는다.
  // 포인터 이벤트(타워 놓기·강화 카드)는 그대로 온다
  elements.arcadeCanvas.addEventListener('touchstart', event => {
    if (isArcade() && run.engine?.status === 'running') event.preventDefault();
  }, { passive: false });
  elements.arcadeCanvas.addEventListener('mousedown', event => {
    if (isArcade() && run.engine?.status === 'running') event.preventDefault();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.activeElement !== elements.hiddenInput && !isPvp()) restart();
  });
  window.visualViewport?.addEventListener('resize', () => {
    fitArcadeCanvas();
    if (isMobilePlay()) requestAnimationFrame(pinArcadeStage);
  });
  window.addEventListener('resize', fitArcadeCanvas);
  elements.inputBar?.addEventListener('click', focusTypingArea);
}

// 캔버스는 DOM과 달리 글꼴이 늦게 와도 다시 그려 주지 않으므로, 캔버스용 픽셀 글꼴을 미리 불러 둔다(실패해도 대체 글꼴로 그린다)
document.fonts?.load?.("12px 'Galmuri11'").catch(() => {});

// 키보드 뽑기·도감: 장착한 스킨을 화면 키보드에 입힌다. 창이 열려 있는 동안 게임 입력은 쉬게 한다
const collection = createKeyboardCollection({
  sound,
  preferences,
  onSkinChange: (skin, ledOverride) => keyboard.setSkin(skin, ledOverride),
  onOpen: () => ui.elements.hiddenInput.blur(),
  onClose: () => {
    if (run.engine?.status !== 'finished' && !isPvp()) focusTypingArea();
  }
});

// 오른쪽 위 보유 포인트: 적립·뽑기로 바뀔 때마다 갱신, 누르면 뽑기 창
function renderPointsTotal(points = collection.points()) {
  const element = document.getElementById('pointsTotal');
  if (element) element.textContent = `${Number(points || 0).toLocaleString('ko-KR')}P`;
}
document.addEventListener('typecode:points', event => renderPointsTotal(event.detail?.points));
document.getElementById('pointsTotal')?.addEventListener('click', () => document.getElementById('gachaButton')?.click());
renderPointsTotal();

applyInviteLink();
bindSettings();
bindEvents();
bindSongSelect();
applyMode();
ui.log('sys', 'TYPE//CODE ready. 오타는 에러 로그로 남고, Backspace로 지울 수 있습니다.');
resetGame();
refreshBoard();

// 자동화 테스트·디버깅용 읽기 창구(게임 상태 조회). 게임 로직은 이 값에 의존하지 않는다.
globalThis.__TYPECODE__ = { run, settings, renderers, pvp, collection, keyboard, bgm };
