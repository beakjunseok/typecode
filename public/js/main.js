// 진입점: 모드(연습 · 휴대폰 던지기 · 에러 구조 SOS)를 고르고, 엔진 이벤트를 화면·효과음·키보드·서버 호출에 연결한다.
import { TypingEngine, DURATIONS, getTierIndex } from './engine.js';
import { TimeAttackEngine, TIME_ATTACK_RULES } from './time-attack-engine.js';
import { LANGUAGES, getTokenPool } from './tokens.js';
import { ThrowEngine, ROBOT_TYPES } from './throw-engine.js';
import { BatteryEngine } from './battery-engine.js';
import { BatteryPvpHostEngine, BatteryPvpGuestEngine, PVP_RULES, PVP_PROTOCOL_VERSION } from './battery-pvp.js';
import { hostRoom, joinRoom } from './pvp-connection.js';
import { createPvpLobby } from './pvp-lobby.js';
import { DIFFICULTY_LEVELS } from './target-game.js';
import { ThrowRenderer } from './throw-view.js';
import { BatteryRenderer } from './battery-view.js';
import { createInputDiffer, INPUT_SENTINEL } from './input.js';
import { SoundEngine } from './audio.js';
import { BgmEngine } from './bgm.js';
import { emitSparks, pulseClass } from './effects.js';
import { createKeyboard } from './keyboard.js';
import { createKeyboardCollection } from './gacha-view.js';
import { requestSession, submitScore, fetchBoard, localBoard, preferences } from './api.js';
import { createUi, TIER_COLORS } from './ui.js';
import { getWeekLabel } from './week.js';

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
      ...options, lanes: options.narrow ? 3 : 4, maxTokenLength: options.narrow ? 14 : 22
    })
  },
  battery: {
    label: '배터리 구조 SOS', arcade: true, title: 'battery-rescue.sh', resultTitle: 'BATTERY REPORT',
    hint: '지나가는 셀 낱말로 충전 · 방전봇 탑 낱말로 공격', Renderer: BatteryRenderer,
    createEngine: options => new BatteryEngine({ ...options, maxTokenLength: options.narrow ? 14 : 18 })
  }
});

// 연습 모드의 세부 방식: 고정 제한 시간(30·60·120초) 또는 시간 연장(⏳). 랭킹은 따로 집계한다
const PRACTICE_VARIANTS = Object.freeze(['timed', 'timeattack']);
const BOARD_LABELS = Object.freeze({ practice: '연습', timeattack: '연습 · 시간 연장', throw: '휴대폰 던지기', battery: '배터리 구조 SOS' });

const ui = createUi(document);
const sound = new SoundEngine();
const bgm = new BgmEngine(sound);
const keyboard = createKeyboard(ui.elements.keyboardSection);
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
  keyboardInGame: preferences.get('keyboardGame', false) === true
};
const run = { engine: null, generation: 0, sessionPromise: null, submitted: false, tickId: null, frameId: null, highlightId: null, lastTier: 0, powerActive: false, lastImeWarning: 0 };
const now = () => performance.now();
const modeConfig = () => MODE_CONFIG[settings.mode];
const isArcade = () => modeConfig().arcade;
const isTimeAttack = () => settings.mode === 'practice' && settings.practiceVariant === 'timeattack';
// 서버·로컬 랭킹에서 쓰는 모드 이름(연습의 시간 연장은 'timeattack')
const boardMode = () => (isTimeAttack() ? 'timeattack' : settings.mode);
const boardLabel = (mode = boardMode()) => BOARD_LABELS[mode] ?? mode;
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

function handlePracticeToken({ clean, combo, tier, tierUp, milestone, timeBonus }) {
  sound.play('key', { character: run.lastCharacter });
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
  const battery = settings.mode === 'battery';
  switch (type) {
    case 'start':
      sound.play('gameStart');
      if (isPvp()) {
        ui.log('sys', `PvP 시작 · vs ${pvp.opponentName} · ${LANGUAGES[pvp.hostSettings.language].label} · ${DIFFICULTY_LEVELS[pvp.hostSettings.level].label}`);
        break;
      }
      run.sessionPromise = startSession(run.generation);
      ui.log('sys', `${modeConfig().label} started · ${LANGUAGES[settings.languageKey].label} · ${DIFFICULTY_LEVELS[settings.level].label}`);
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
      }
      ui.log('ok', `${ROBOT_TYPES[payload.robot.type].label} 처치 (+${payload.bounty})`);
      break;
    case 'item-spawn':
      sound.play('itemSpawn');
      if (!battery) ui.log('info', payload.item.item === 'battery' ? '🔋 건전지 등장 — 치면 생명 1칸 회복' : '💻 노트북 상자 등장');
      break;
    case 'item':
      sound.play(battery && payload.item.item === 'heat' ? 'explode' : 'powerUp');
      ui.log('ok', battery ? BATTERY_ITEM_LOG[payload.item.item](rivalName())
        : payload.item.item === 'battery' ? `건전지 충전 — 생명 ${payload.lives}칸` : '노트북 장착 — 8초간 위력 ×3');
      break;
    case 'drain':
      sound.play('hit');
      ui.log('ok', `${rivalName()} 탑 −0.5칸`);
      break;
    case 'rival-take':
      sound.play('error');
      ui.log('warn', `${rivalName()}이(가) ${BATTERY_ITEM_NAMES[payload.item.item]}을(를) 가져갔습니다`);
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
      pulseClass(ui.elements.arcadeStage, 'tier-flash', 800);
      ui.log('ok', `STAGE ${payload.stage} CLEAR — ${payload.how === 'charged' ? '100% 충전 구조' : '방전봇 침몰'} (+${payload.bonus})`);
      break;
    case 'damage':
      sound.play(battery ? 'sink' : 'lifeLost');
      if (!battery) sound.play('glassCrack');
      pulseClass(ui.elements.arcadeStage, 'shake', 300);
      ui.log('err', battery ? (payload.cause.how === 'sunk' ? '배터리 0% — 방전의 바다에 빠졌습니다' : '방전봇이 먼저 100% 충전했습니다')
        : `로봇이 빨간 선 돌파 — 건전지 ${payload.lives}칸 · 휴대폰에 금이 갔습니다`);
      run.lastTier = 0;
      break;
    case 'finish':
      handleFinish(payload.summary);
      break;
    default:
      break;
  }
}

const BATTERY_ITEM_NAMES = { cell: '배터리 셀', powerbank: '보조배터리', eco: '저전력 모드', heat: '발열 폭탄', blackout: '화면 꺼짐' };
// 아이템 획득 로그(상대 이름은 AI면 '방전봇', PvP면 상대 이름)
const BATTERY_ITEM_LOG = {
  cell: () => '배터리 셀 획득 — +0.5칸', powerbank: () => '보조배터리 드론 — +1칸', eco: () => '저전력 모드 — 4초간 방전 감속',
  heat: rival => `발열 폭탄 — ${rival} 4초간 급방전`,
  blackout: rival => (isPvp() ? `화면 꺼짐 — ${rival} 3초 입력 막힘` : `화면 꺼짐 — ${rival} 3초 정지`)
};

// ---------- 세션 · 제출 ----------
function startSession(generation) {
  const mode = boardMode();
  return requestSession({ mode, language: settings.languageKey, ...(mode === 'practice' ? { durationSeconds: settings.durationSeconds } : {}) }).catch(error => {
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
  const name = ui.elements.playerName.value.trim().slice(0, 16) || 'anonymous';
  preferences.set('name', name);
  ui.setSaveButton({ label: '등록 중…', disabled: true });
  ui.setSaveStatus('');

  const token = await run.sessionPromise;
  if (generation !== run.generation) return;
  const summary = engine.summary();
  if (!token) {
    saveLocally(summary, name, mode);
    return;
  }
  try {
    const result = await submitScore(buildSubmission(summary, token, name));
    if (generation !== run.generation) return;
    run.submitted = true;
    run.highlightId = result.myEntry.id;
    ui.renderBoard(result.entries, { week: result.week, isLive: true, highlightId: run.highlightId, modeLabel: boardLabel(mode) });
    ui.setSaveButton({ label: '등록 완료', disabled: true });
    ui.setSaveStatus(`이번 주 ${boardLabel(mode)} ${result.myRank}위로 등록됐습니다.`, 'ok');
    if (result.myRank === 1) sound.play('newRecord');
    ui.log('ok', `ranking updated: ${name} · #${result.myRank} (${result.week})`);
  } catch (error) {
    if (generation !== run.generation) return;
    ui.setSaveStatus(`[${error.status || 'NET'}] ${error.message}`, 'err');
    ui.setSaveButton({ label: error.isFinal ? '등록 불가' : '다시 시도', disabled: error.isFinal });
    ui.log('err', `SubmitError ${error.status || ''} ${error.code || ''}: ${error.message}`);
  }
}

function saveLocally(summary, name, mode) {
  const entry = {
    id: `local-${Date.now()}`, name, language: settings.languageKey, score: summary.score,
    wpm: summary.wordsPerMinute, cpm: summary.charactersPerMinute, accuracy: summary.accuracy, achievedAt: Date.now(),
    ...(summary.survivedSeconds !== undefined ? { survivedSeconds: summary.survivedSeconds } : {})
  };
  run.submitted = true;
  run.highlightId = entry.id;
  ui.renderBoard(localBoard.save(entry, mode), { week: getWeekLabel(), isLive: false, highlightId: entry.id, modeLabel: boardLabel(mode) });
  ui.setSaveButton({ label: '로컬 저장됨', disabled: true });
  ui.setSaveStatus('서버에 연결하지 못해 이 브라우저에만 저장했습니다.', 'warn');
}

async function refreshBoard() {
  const mode = boardMode();
  const modeLabel = boardLabel(mode);
  try {
    const result = await fetchBoard(mode);
    if (mode !== boardMode()) return;
    ui.renderBoard(result.entries, { week: result.week, isLive: true, highlightId: run.highlightId, modeLabel });
  } catch (error) {
    if (mode !== boardMode()) return;
    ui.renderBoard(localBoard.load(mode), { week: getWeekLabel(), isLive: false, highlightId: run.highlightId, modeLabel });
  }
}

// ---------- 결과 ----------
function arcadeSubtitle(summary) {
  const base = `${LANGUAGES[settings.languageKey].label} · ${DIFFICULTY_LEVELS[summary.level].label} · 생존 ${summary.survivedSeconds}s`;
  if (summary.mode === 'battery') {
    const cause = summary.outcome === 'rival-charged' ? '방전봇 선충전' : '방전';
    return `${base} · 클리어 ${summary.stagesCleared}스테이지 · 공격 ${summary.drains} · 아이템 ${summary.itemsCollected} · 뺏김 ${summary.stolen} · 패배: ${cause}`;
  }
  const { basic, fast, tank } = summary.kills;
  return `${base} · 처치 ${summary.totalKills} (기본 ${basic} · 빠른 ${fast} · 헤비 ${tank}) · 아이템 ${summary.itemsCollected}`;
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

// 결과창 제목·부제(모드별). PvP는 랭킹 등록 폼을 숨긴다
function resultHeading(summary) {
  if (summary.mode === 'battery-pvp') return { title: PVP_RESULT_TITLES[summary.outcome] ?? 'PvP', subtitle: pvpSubtitle(summary), saveable: false };
  if (summary.mode === 'timeattack') return { title: 'TIME UP', subtitle: timeAttackSubtitle(summary) };
  if (isArcade()) return { title: modeConfig().resultTitle, subtitle: arcadeSubtitle(summary) };
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
  return isArcade() ? 'defeat' : 'finish';
}

function handleFinish(summary) {
  if (isPvp()) {
    pvp.phase = 'ended';
    pvp.lastOutcome = summary.outcome;
  }
  stopTicking();
  const newBest = !isPvp() && recordPersonalBest(summary);
  sound.play(endSound(summary, newBest));
  bgm.duck(true);
  ui.elements.hiddenInput.blur();
  renderStats();
  ui.setFocusState({ focused: false, finished: true, arcade: isArcade() });
  keyboard.setNext(null);
  ui.log('sys', `run finished · score ${summary.score} · ${summary.charactersPerMinute}타 (${summary.wordsPerMinute} WPM) · ${summary.accuracy}%`);
  const heading = resultHeading(summary);
  ui.showResult(summary, {
    languageKey: settings.languageKey,
    playerName: preferences.get('name', ''),
    ...heading,
    ...(newBest ? { subtitle: `🏆 개인 최고 기록${heading.subtitle ? ` · ${heading.subtitle}` : ''}` } : {})
  });
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
    renderers[settings.mode]?.render(engine, { accent: TIER_COLORS[snapshot.tierProgress.index] });
    if (engine.status === 'running') {
      renderStats();
      updateArcadeMusic(snapshot);
      renderInputBar();
    }
    run.frameId = requestAnimationFrame(loop);
  };
  run.frameId = requestAnimationFrame(loop);
}

// 게임 상황 → BGM: 던지기는 콤보 단계, 구조는 SLA 위기도. 아이템 효과가 끝나면 종료음.
function updateArcadeMusic(snapshot) {
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

function startMusic() {
  bgm.play(settings.mode);
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
  return config.createEngine({
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
  bgm.setIntensity(0);
  bgm.duck(false);
  ui.hideResult();
  if (isArcade()) {
    const config = modeConfig();
    fitArcadeCanvas();
    renderers[settings.mode] ??= new config.Renderer(ui.elements.arcadeCanvas);
    ui.elements.arcadeTitle.textContent = config.title;
    ui.elements.arcadeHint.textContent = `${LANGUAGES[settings.languageKey].label} · ${DIFFICULTY_LEVELS[settings.level].label}`;
    startFrameLoop();
  } else {
    ui.elements.fileName.textContent = LANGUAGES[settings.languageKey].file;
    ui.renderToken(run.engine);
    updateKeyboardHint();
  }
  renderStats();
  renderInputBar();
  updateFocusState();
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

// 연습 화면과 게임 화면의 키보드 표시는 따로 기억한다(게임은 기본 숨김)
const keyboardShown = () => (isArcade() ? settings.keyboardInGame : settings.keyboardVisible);

function applyKeyboardVisibility() {
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
function updateArcadeKeyboardHint() {
  if (!isArcade() || !settings.keyboardInGame) return;
  const engine = run.engine;
  const target = engine?.target;
  if (!target || engine.status === 'finished') {
    keyboard.setNext(null);
    return;
  }
  keyboard.setNext(engine.wrongInBuffer > 0 ? 'Backspace' : target.token.text[engine.typed.length] ?? null);
}

// ---------- 입력 ----------
// 숨은 textarea의 값 변화를 글자·지우기로 바꾼다(input.js). 모바일 조합 입력·스와이프·자동수정도 같은 규칙.
const inputDiffer = createInputDiffer({
  onCharacter: character => applyCharacter(character),
  onBackspace: () => applyBackspace(false),
  onIgnored: () => warnIme(),
  onHangul: () => showInputNotice('한→영 자동 변환 · 대문자는 영문 키보드'),
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

function handleKeyDown(event) {
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
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  const target = engine.target;
  const typed = engine.typed.join('');
  const correctLength = target ? [...typed].findIndex((character, index) => character !== target.token.text[index]) : -1;
  const goodPart = correctLength === -1 ? typed : typed.slice(0, correctLength);
  const badPart = correctLength === -1 ? '' : typed.slice(correctLength);
  ui.elements.inputTyped.textContent = goodPart;
  ui.elements.inputWrong.textContent = badPart;
  ui.elements.inputRest.textContent = target ? target.token.text.slice(typed.length) : '';
  const notice = run.inputNotice && run.inputNotice.until > Date.now() ? run.inputNotice.message : '';
  ui.elements.inputTarget.textContent = notice || (target ? '' : engine.status === 'finished' ? 'game over' : '낱말의 첫 글자를 치세요');
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

// 게임 화면 높이: 모바일 키보드가 올라오면(visualViewport 축소) 그만큼 줄여서 입력창이 키보드 바로 위에 오게 한다.
function fitArcadeCanvas() {
  if (!isArcade()) return;
  const canvas = ui.elements.arcadeCanvas;
  const viewport = window.visualViewport;
  const viewportHeight = viewport ? viewport.height : window.innerHeight;
  const top = canvas.getBoundingClientRect().top + (viewport ? 0 : 0);
  const reserved = (ui.elements.inputBar?.offsetHeight || 40) + 12;
  const available = Math.round(viewportHeight - Math.max(0, top) - reserved);
  const narrow = window.innerWidth < NARROW_WIDTH;
  const height = Math.max(narrow ? 300 : 360, Math.min(narrow ? 640 : 560, available));
  if (Math.abs(canvas.clientHeight - height) > 2) canvas.style.height = `${height}px`;
}

function focusTypingArea() {
  startMusic();
  if (run.engine.status === 'finished') return;
  if (isPvp() && !['countdown', 'playing'].includes(pvp.phase)) return;
  // 이미 입력 중이면 건드리지 않는다: 값을 되돌리면 모바일 키보드의 조합이 깨지고, 스크롤이 튀어 화면이 흔들린다
  if (document.activeElement === ui.elements.hiddenInput) return;
  resetInputBuffer();
  ui.elements.hiddenInput.focus({ preventScroll: true });
  // 모바일: 키보드가 올라온 뒤 게임 화면이 보이도록 스크롤하고 높이를 다시 맞춘다
  if (isArcade()) {
    setTimeout(() => {
      ui.elements.arcadeStage.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
      fitArcadeCanvas();
    }, 350);
  }
}

function updateFocusState() {
  ui.setFocusState({
    focused: document.activeElement === ui.elements.hiddenInput,
    finished: run.engine.status === 'finished',
    arcade: isArcade()
  });
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
  ui.elements.modeButtons.forEach(button => {
    const active = button.dataset.mode === settings.mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  ui.elements.stage.hidden = arcade;
  ui.elements.arcadeStage.hidden = !arcade;
  ui.elements.durationGroup.hidden = arcade;
  ui.elements.levelSelect.hidden = !arcade;
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
  document.body.dataset.mode = settings.mode;
  document.getElementById('arcadeOverlayHint').textContent = arcade ? `${modeConfig().hint} · 첫 글자를 치면 시작` : '';
  applyKeyboardVisibility();
  renderInputBar();
  requestAnimationFrame(fitArcadeCanvas);
}

function switchMode(mode) {
  if (!MODE_CONFIG[mode] || mode === settings.mode) return;
  if (!confirmLeavePvp()) return;
  settings.mode = mode;
  preferences.set('mode', mode);
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
  });
  ui.elements.modeButtons.forEach(button => button.addEventListener('click', () => switchMode(button.dataset.mode)));
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
    if (isArcade()) {
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
  elements.stage.addEventListener('click', focusTypingArea);
  elements.arcadeStage.addEventListener('click', focusTypingArea);
  elements.hiddenInput.addEventListener('keydown', handleKeyDown);
  elements.hiddenInput.addEventListener('input', handleInput);
  elements.hiddenInput.addEventListener('compositionend', handleCompositionEnd);
  elements.hiddenInput.addEventListener('paste', event => event.preventDefault());
  elements.hiddenInput.addEventListener('focus', updateFocusState);
  elements.hiddenInput.addEventListener('blur', updateFocusState);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.activeElement !== elements.hiddenInput && !isPvp()) restart();
  });
  window.visualViewport?.addEventListener('resize', fitArcadeCanvas);
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

applyInviteLink();
bindSettings();
bindEvents();
applyMode();
ui.log('sys', 'TYPE//CODE ready. 오타는 에러 로그로 남고, Backspace로 지울 수 있습니다.');
resetGame();
refreshBoard();

// 자동화 테스트·디버깅용 읽기 창구(게임 상태 조회). 게임 로직은 이 값에 의존하지 않는다.
globalThis.__TYPECODE__ = { run, settings, renderers, pvp, collection, keyboard };
