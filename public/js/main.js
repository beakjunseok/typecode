// 진입점: 모드(연습 · 휴대폰 던지기 · 에러 구조 SOS)를 고르고, 엔진 이벤트를 화면·효과음·키보드·서버 호출에 연결한다.
import { TypingEngine, DURATIONS } from './engine.js';
import { LANGUAGES, getTokenPool } from './tokens.js';
import { getRescueTokenPool } from './error-tokens.js';
import { ThrowEngine, ROBOT_TYPES } from './throw-engine.js';
import { RescueEngine } from './rescue-engine.js';
import { DIFFICULTY_LEVELS } from './target-game.js';
import { ThrowRenderer } from './throw-view.js';
import { RescueRenderer } from './rescue-view.js';
import { SoundEngine } from './audio.js';
import { BgmEngine } from './bgm.js';
import { emitSparks, pulseClass } from './effects.js';
import { createKeyboard } from './keyboard.js';
import { requestSession, submitScore, fetchBoard, localBoard, preferences } from './api.js';
import { createUi, TIER_COLORS } from './ui.js';
import { getWeekLabel } from './week.js';

const TICK_INTERVAL_MS = 100;
const INPUT_SENTINEL = ' ';

const MODE_CONFIG = Object.freeze({
  practice: { label: '연습', arcade: false },
  throw: {
    label: '휴대폰 던지기', arcade: true, title: 'phone-throw.exe', resultTitle: 'GAME OVER',
    hint: '로봇 머리 위 토큰을 다 치면 휴대폰 발사', createEngine: options => new ThrowEngine(options),
    tokenPool: getTokenPool, Renderer: ThrowRenderer
  },
  rescue: {
    label: '에러 구조 SOS', arcade: true, title: 'error-rescue.sh', resultTitle: 'INCIDENT REPORT',
    hint: '가라앉는 프로세스의 에러를 쳐서 패치 튜브 투하', createEngine: options => new RescueEngine(options),
    tokenPool: getRescueTokenPool, Renderer: RescueRenderer
  }
});

const ui = createUi(document);
const sound = new SoundEngine();
const bgm = new BgmEngine(sound);
const keyboard = createKeyboard(ui.elements.keyboardSection);
const renderers = {};
const settings = {
  mode: MODE_CONFIG[preferences.get('mode', 'practice')] ? preferences.get('mode', 'practice') : 'practice',
  languageKey: LANGUAGES[preferences.get('lang', 'javascript')] ? preferences.get('lang', 'javascript') : 'javascript',
  durationSeconds: DURATIONS.includes(preferences.get('duration', 60)) ? preferences.get('duration', 60) : 60,
  level: DIFFICULTY_LEVELS[preferences.get('level', 2)] ? Number(preferences.get('level', 2)) : 2,
  keyboardVisible: preferences.get('keyboard', true) !== false
};
const run = { engine: null, generation: 0, sessionPromise: null, submitted: false, tickId: null, frameId: null, highlightId: null, lastTier: 0, powerActive: false };
const now = () => performance.now();
const modeConfig = () => MODE_CONFIG[settings.mode];
const isArcade = () => modeConfig().arcade;

function visible(character) {
  return { ' ': '␣', '\n': '↵', '\t': '⇥' }[character] ?? character;
}

// ---------- 연습 모드 이벤트 ----------
function handlePracticeEvent(type, payload) {
  switch (type) {
    case 'start':
      run.sessionPromise = startSession(run.generation);
      sound.play('gameStart');
      ui.log('sys', `run started · ${LANGUAGES[settings.languageKey].label} · ${settings.durationSeconds}s`);
      break;
    case 'keystroke':
      sound.play('key');
      break;
    case 'backspace':
      sound.play('erase');
      break;
    case 'mistake':
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

function handlePracticeToken({ clean, combo, tier, tierUp, milestone }) {
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
  const rescue = settings.mode === 'rescue';
  switch (type) {
    case 'start':
      run.sessionPromise = startSession(run.generation);
      sound.play('gameStart');
      ui.log('sys', `${modeConfig().label} started · ${LANGUAGES[settings.languageKey].label} · ${DIFFICULTY_LEVELS[settings.level].label}`);
      break;
    case 'spawn':
      if (rescue) sound.play('spawnVictim');
      else sound.play('spawnRobot', { type: payload.robot.type });
      break;
    case 'lock':
      sound.play('lock');
      break;
    case 'keystroke':
      sound.play('key');
      break;
    case 'backspace':
      sound.play('erase');
      break;
    case 'mistake':
      sound.play('error');
      pulseClass(ui.elements.arcadeStage, 'shake', 200);
      ui.log('err', payload.target
        ? `SyntaxError: unexpected '${visible(payload.typed)}' in '${payload.target.token.text}' — expected '${visible(payload.expected)}'`
        : `TargetNotFound: '${visible(payload.typed)}'로 시작하는 목표가 없습니다`);
      break;
    case 'throw':
      sound.play(rescue ? 'splash' : payload.weapon === 'laptop' ? 'throwLaptop' : 'throwPhone');
      if (payload.tier > run.lastTier) {
        sound.play('tierUp', { tier: payload.tier });
        pulseClass(ui.elements.arcadeStage, 'tier-flash', 600);
        ui.log('info', `combo ${payload.combo} → multiplier ×${payload.tier === 2 ? '2.0' : '1.5'}`);
      }
      run.lastTier = payload.tier;
      break;
    case 'hit':
      sound.play(rescue ? 'splash' : 'hit');
      break;
    case 'kill':
      sound.play(rescue ? 'rescued' : 'explode');
      ui.log('ok', rescue
        ? `recovered PID ${payload.victim.pid} (+${payload.bounty})`
        : `${ROBOT_TYPES[payload.robot.type].label} 처치 (+${payload.bounty})`);
      break;
    case 'item-spawn':
      sound.play('itemSpawn');
      ui.log('info', rescue ? '⏪ 롤백 상자가 떠내려옵니다' : payload.item.item === 'battery' ? '🔋 배터리 상자 등장' : '💻 노트북 상자 등장');
      break;
    case 'item':
      sound.play(rescue ? 'rollback' : 'powerUp');
      pulseClass(ui.elements.arcadeStage, 'tier-flash', 600);
      ui.log('ok', rescue ? 'git revert 성공 — 모든 프로세스 부상, 5초 정지'
        : payload.item.item === 'battery' ? `에너지 충전 — HP ${payload.lives}` : '노트북 장착 — 8초간 위력 ×3');
      break;
    case 'damage':
      sound.play(rescue ? 'sink' : 'lifeLost');
      pulseClass(ui.elements.arcadeStage, 'shake', 300);
      ui.log('err', rescue ? `PID ${payload.cause.victim.pid} 유실 — SLA ${payload.lives}` : `로봇이 책상 도달 — HP ${payload.lives}`);
      run.lastTier = 0;
      break;
    case 'finish':
      handleFinish(payload.summary);
      break;
    default:
      break;
  }
}

// ---------- 세션 · 제출 ----------
function startSession(generation) {
  return requestSession({ mode: settings.mode, language: settings.languageKey, durationSeconds: settings.durationSeconds }).catch(error => {
    if (generation === run.generation) ui.log('warn', `session 발급 실패 (${error.message}) — 이번 판은 로컬 랭킹에만 저장`);
    return null;
  });
}

function buildSubmission(summary, token, name) {
  return {
    token, name, score: summary.score, maxCombo: summary.maxCombo,
    correctKeystrokes: summary.correctKeystrokes, wrongKeystrokes: summary.wrongKeystrokes,
    ...(isArcade() ? { survivedSeconds: summary.survivedSeconds } : {})
  };
}

async function handleSave(event) {
  event.preventDefault();
  const engine = run.engine;
  if (!engine || engine.status !== 'finished' || run.submitted || engine.score <= 0) return;
  const generation = run.generation;
  const mode = settings.mode;
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
    ui.renderBoard(result.entries, { week: result.week, isLive: true, highlightId: run.highlightId, modeLabel: MODE_CONFIG[mode].label });
    ui.setSaveButton({ label: '등록 완료', disabled: true });
    ui.setSaveStatus(`이번 주 ${MODE_CONFIG[mode].label} ${result.myRank}위로 등록됐습니다.`, 'ok');
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
    wpm: summary.wordsPerMinute, accuracy: summary.accuracy, achievedAt: Date.now()
  };
  run.submitted = true;
  run.highlightId = entry.id;
  ui.renderBoard(localBoard.save(entry, mode), { week: getWeekLabel(), isLive: false, highlightId: entry.id, modeLabel: MODE_CONFIG[mode].label });
  ui.setSaveButton({ label: '로컬 저장됨', disabled: true });
  ui.setSaveStatus('서버에 연결하지 못해 이 브라우저에만 저장했습니다.', 'warn');
}

async function refreshBoard() {
  const mode = settings.mode;
  const modeLabel = MODE_CONFIG[mode].label;
  try {
    const result = await fetchBoard(mode);
    if (mode !== settings.mode) return;
    ui.renderBoard(result.entries, { week: result.week, isLive: true, highlightId: run.highlightId, modeLabel });
  } catch (error) {
    if (mode !== settings.mode) return;
    ui.renderBoard(localBoard.load(mode), { week: getWeekLabel(), isLive: false, highlightId: run.highlightId, modeLabel });
  }
}

// ---------- 결과 ----------
function arcadeSubtitle(summary) {
  const base = `${LANGUAGES[settings.languageKey].label} · ${DIFFICULTY_LEVELS[summary.level].label} · 생존 ${summary.survivedSeconds}s`;
  if (summary.mode === 'rescue') {
    const { process, coredump, cluster } = summary.rescued;
    return `${base} · 구조 ${summary.totalRescued} (프로세스 ${process} · 코어덤프 ${coredump} · 클러스터 ${cluster}) · 유실 ${summary.lost}`;
  }
  const { basic, fast, tank } = summary.kills;
  return `${base} · 처치 ${summary.totalKills} (기본 ${basic} · 빠른 ${fast} · 헤비 ${tank}) · 아이템 ${summary.itemsCollected}`;
}

function handleFinish(summary) {
  stopTicking();
  sound.play(isArcade() ? 'gameOver' : 'finish');
  bgm.duck(true);
  ui.elements.hiddenInput.blur();
  renderStats();
  ui.setFocusState({ focused: false, finished: true, arcade: isArcade() });
  keyboard.setNext(null);
  ui.log('sys', `run finished · score ${summary.score} · ${summary.wordsPerMinute} WPM · ${summary.accuracy}%`);
  ui.showResult(summary, {
    languageKey: settings.languageKey,
    playerName: preferences.get('name', ''),
    ...(isArcade() ? { title: modeConfig().resultTitle, subtitle: arcadeSubtitle(summary) } : {})
  });
}

// ---------- 진행 ----------
function renderStats() {
  const engine = run.engine;
  if (!engine) return;
  ui.renderStats(isArcade() ? engine.snapshot() : engine.snapshot(now()));
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
    const snapshot = engine.snapshot();
    renderers[settings.mode]?.render(engine, { accent: TIER_COLORS[snapshot.tierProgress.index] });
    if (engine.status === 'running') {
      renderStats();
      updateArcadeMusic(snapshot);
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
  if (settings.mode === 'rescue') {
    const danger = snapshot.lives <= 1 ? 2 : snapshot.lives === 2 ? 1 : 0;
    bgm.setIntensity(danger, { tempoBoost: snapshot.lives <= 1 ? 1.12 : 1, power: powerActive });
  } else {
    bgm.setIntensity(snapshot.lives <= 1 ? Math.max(snapshot.tierProgress.index, 1) : snapshot.tierProgress.index, { power: powerActive });
  }
}

function startMusic() {
  bgm.play(settings.mode);
}

function createEngine() {
  if (!isArcade()) {
    return new TypingEngine({
      tokenPool: getTokenPool(settings.languageKey),
      durationSeconds: settings.durationSeconds,
      onEvent: handlePracticeEvent
    });
  }
  const config = modeConfig();
  return config.createEngine({ tokenPool: config.tokenPool(settings.languageKey), level: settings.level, onEvent: handleArcadeEvent });
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

function applyKeyboardVisibility() {
  keyboard.setVisible(settings.keyboardVisible && !isArcade());
  ui.elements.keyboardToggle.hidden = isArcade();
  ui.elements.keyboardToggle.textContent = settings.keyboardVisible ? 'KBD ON' : 'KBD OFF';
  ui.elements.keyboardToggle.setAttribute('aria-pressed', String(settings.keyboardVisible));
}

// ---------- 입력 ----------
// 숨은 textarea에 센티널 한 글자를 남겨 두어, 모바일 키보드에서도 Backspace가 input 이벤트로 들어오게 한다.
function resetInputBuffer() {
  ui.elements.hiddenInput.value = INPUT_SENTINEL;
}

function applyCharacter(character) {
  startMusic();
  const engine = run.engine;
  if (isArcade()) {
    engine.input(character, now());
    renderStats();
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
  const engine = run.engine;
  if (!engine.backspace(now(), { wholeToken }).accepted) return;
  if (isArcade()) return;
  keyboard.press('Backspace', true);
  ui.renderToken(engine, { full: false });
  updateKeyboardHint();
}

function handleKeyDown(event) {
  if (event.key === 'Escape') {
    event.preventDefault();
    resetGame();
    return;
  }
  if (event.isComposing) return;
  if (event.key === 'Backspace') {
    event.preventDefault();
    applyBackspace(event.ctrlKey || event.altKey || event.metaKey);
    return;
  }
  if (event.key === 'Enter' || event.key === 'Tab') event.preventDefault();
}

function handleInput(event) {
  if (event.isComposing) return;
  if (event.inputType?.startsWith('delete')) {
    applyBackspace(event.inputType === 'deleteWordBackward');
  } else if (event.data) {
    [...event.data].forEach(applyCharacter);
  }
  resetInputBuffer();
}

function handleCompositionEnd() {
  resetInputBuffer();
  ui.log('warn', 'IME 입력 감지 — 한/영 전환을 확인하세요');
}

function focusTypingArea() {
  startMusic();
  if (run.engine.status === 'finished') return;
  resetInputBuffer();
  ui.elements.hiddenInput.focus({ preventScroll: true });
}

function updateFocusState() {
  ui.setFocusState({
    focused: document.activeElement === ui.elements.hiddenInput,
    finished: run.engine.status === 'finished',
    arcade: isArcade()
  });
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
  document.getElementById('practiceHint').hidden = arcade;
  document.getElementById('throwHint').hidden = settings.mode !== 'throw';
  document.getElementById('rescueHint').hidden = settings.mode !== 'rescue';
  document.getElementById('arcadeOverlayHint').textContent = arcade ? `${modeConfig().hint} · 첫 글자를 치면 시작` : '';
  applyKeyboardVisibility();
}

function switchMode(mode) {
  if (!MODE_CONFIG[mode] || mode === settings.mode) return;
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
  ui.elements.durationButtons.forEach(button => {
    button.classList.toggle('active', Number(button.dataset.seconds) === settings.durationSeconds);
    button.addEventListener('click', () => {
      settings.durationSeconds = Number(button.dataset.seconds);
      preferences.set('duration', settings.durationSeconds);
      ui.elements.durationButtons.forEach(other => other.classList.toggle('active', other === button));
      resetGame();
    });
  });
  ui.elements.languageSelect.addEventListener('change', () => {
    settings.languageKey = ui.elements.languageSelect.value;
    preferences.set('lang', settings.languageKey);
    resetGame();
  });
  sound.setEnabled(preferences.get('sound', true));
  const renderSoundToggle = () => {
    ui.elements.soundToggle.textContent = sound.enabled ? 'SND ON' : 'SND OFF';
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
    ui.elements.bgmToggle.textContent = bgm.enabled ? 'BGM ON' : 'BGM OFF';
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
    settings.keyboardVisible = !settings.keyboardVisible;
    preferences.set('keyboard', settings.keyboardVisible);
    applyKeyboardVisibility();
  });
}

function bindEvents() {
  const { elements } = ui;
  const restart = () => { resetGame(); focusTypingArea(); };
  elements.restartButton.addEventListener('click', restart);
  elements.retryButton.addEventListener('click', restart);
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
    if (event.key === 'Escape' && document.activeElement !== elements.hiddenInput) restart();
  });
}

bindSettings();
bindEvents();
applyMode();
ui.log('sys', 'TYPE//CODE ready. 오타는 에러 로그로 남고, Backspace로 지울 수 있습니다.');
resetGame();
refreshBoard();

// 자동화 테스트·디버깅용 읽기 창구(게임 상태 조회). 게임 로직은 이 값에 의존하지 않는다.
globalThis.__TYPECODE__ = { run, settings };
