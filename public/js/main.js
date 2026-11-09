// 진입점: 엔진 이벤트를 화면·효과음·서버 호출에 연결한다.
import { TypingEngine, DURATIONS } from './engine.js';
import { LANGUAGES, getTokenPool } from './tokens.js';
import { SoundEngine } from './audio.js';
import { emitSparks, pulseClass } from './effects.js';
import { requestSession, submitScore, fetchBoard, localBoard, preferences } from './api.js';
import { createUi, TIER_COLORS } from './ui.js';
import { getWeekLabel } from './week.js';

const TICK_INTERVAL_MS = 100;
const INPUT_SENTINEL = ' ';

const ui = createUi(document);
const sound = new SoundEngine();
const settings = {
  languageKey: LANGUAGES[preferences.get('lang', 'javascript')] ? preferences.get('lang', 'javascript') : 'javascript',
  durationSeconds: DURATIONS.includes(preferences.get('duration', 60)) ? preferences.get('duration', 60) : 60
};
const run = { engine: null, generation: 0, sessionPromise: null, submitted: false, tickId: null, highlightId: null };
const now = () => performance.now();

// ---------- 엔진 이벤트 → 효과 ----------
function handleEngineEvent(type, payload) {
  switch (type) {
    case 'start':
      run.sessionPromise = startSession(run.generation);
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
      handleTokenComplete(payload);
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

function handleTokenComplete({ clean, combo, tier, tierUp, milestone }) {
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

function visible(character) {
  return { ' ': '␣', '\n': '↵', '\t': '⇥' }[character] ?? character;
}

// ---------- 세션 · 제출 ----------
function startSession(generation) {
  return requestSession(settings.languageKey, settings.durationSeconds).catch(error => {
    if (generation === run.generation) ui.log('warn', `session 발급 실패 (${error.message}) — 이번 판은 로컬 랭킹에만 저장`);
    return null;
  });
}

async function handleSave(event) {
  event.preventDefault();
  const engine = run.engine;
  if (!engine || engine.status !== 'finished' || run.submitted || engine.score <= 0) return;
  const generation = run.generation;
  const name = ui.elements.playerName.value.trim().slice(0, 16) || 'anonymous';
  preferences.set('name', name);
  ui.setSaveButton({ label: '등록 중…', disabled: true });
  ui.setSaveStatus('');

  const token = await run.sessionPromise;
  if (generation !== run.generation) return;

  if (!token) {
    saveLocally(engine.summary(), name);
    return;
  }
  try {
    const summary = engine.summary();
    const result = await submitScore({
      token, name, score: summary.score, maxCombo: summary.maxCombo,
      correctKeystrokes: summary.correctKeystrokes, wrongKeystrokes: summary.wrongKeystrokes
    });
    if (generation !== run.generation) return;
    run.submitted = true;
    run.highlightId = result.myEntry.id;
    ui.renderBoard(result.entries, { week: result.week, isLive: true, highlightId: run.highlightId });
    ui.setSaveButton({ label: '등록 완료', disabled: true });
    ui.setSaveStatus(`이번 주 ${result.myRank}위로 등록됐습니다.`, 'ok');
    ui.log('ok', `ranking updated: ${name} · #${result.myRank} (${result.week})`);
  } catch (error) {
    if (generation !== run.generation) return;
    ui.setSaveStatus(`[${error.status || 'NET'}] ${error.message}`, 'err');
    ui.setSaveButton({ label: error.isFinal ? '등록 불가' : '다시 시도', disabled: error.isFinal });
    ui.log('err', `SubmitError ${error.status || ''} ${error.code || ''}: ${error.message}`);
  }
}

function saveLocally(summary, name) {
  const entry = {
    id: `local-${Date.now()}`, name, language: settings.languageKey, score: summary.score,
    wpm: summary.wordsPerMinute, accuracy: summary.accuracy, achievedAt: Date.now()
  };
  run.submitted = true;
  run.highlightId = entry.id;
  ui.renderBoard(localBoard.save(entry), { week: getWeekLabel(), isLive: false, highlightId: entry.id });
  ui.setSaveButton({ label: '로컬 저장됨', disabled: true });
  ui.setSaveStatus('서버에 연결하지 못해 이 브라우저에만 저장했습니다.', 'warn');
}

async function refreshBoard() {
  try {
    const result = await fetchBoard();
    ui.renderBoard(result.entries, { week: result.week, isLive: true, highlightId: run.highlightId });
  } catch (error) {
    ui.renderBoard(localBoard.load(), { week: getWeekLabel(), isLive: false, highlightId: run.highlightId });
  }
}

// ---------- 진행 ----------
function handleFinish(summary) {
  stopTicking();
  sound.play('finish');
  ui.elements.hiddenInput.blur();
  ui.renderStats(run.engine.snapshot(now()));
  ui.setFocusState({ focused: false, finished: true });
  ui.log('sys', `run finished · score ${summary.score} · ${summary.wordsPerMinute} WPM · ${summary.accuracy}%`);
  ui.showResult(summary, { languageKey: settings.languageKey, playerName: preferences.get('name', '') });
}

function startTicking() {
  if (run.tickId) return;
  run.tickId = setInterval(() => {
    const engine = run.engine;
    engine.update(now());
    if (engine.status === 'running') ui.renderStats(engine.snapshot(now()));
  }, TICK_INTERVAL_MS);
}

function stopTicking() {
  clearInterval(run.tickId);
  run.tickId = null;
}

function resetGame() {
  stopTicking();
  run.generation++;
  run.sessionPromise = null;
  run.submitted = false;
  run.engine = new TypingEngine({
    tokenPool: getTokenPool(settings.languageKey),
    durationSeconds: settings.durationSeconds,
    onEvent: handleEngineEvent
  });
  ui.hideResult();
  ui.elements.fileName.textContent = LANGUAGES[settings.languageKey].file;
  ui.renderToken(run.engine);
  ui.renderStats(run.engine.snapshot(now()));
  ui.setFocusState({ focused: document.activeElement === ui.elements.hiddenInput, finished: false });
}

// ---------- 입력 ----------
// 숨은 textarea에 항상 센티널 한 글자를 남겨 두어, 모바일 키보드에서도 Backspace가 input 이벤트로 들어오게 한다.
function resetInputBuffer() {
  ui.elements.hiddenInput.value = INPUT_SENTINEL;
}

function applyCharacter(character) {
  const engine = run.engine;
  const tokenNumberBefore = engine.tokenNumber;
  const result = engine.input(character, now());
  if (!result.accepted) return;
  if (engine.status === 'running') startTicking();
  ui.renderToken(engine, { full: engine.tokenNumber !== tokenNumberBefore });
  ui.renderStats(engine.snapshot(now()));
}

function applyBackspace(wholeToken) {
  const engine = run.engine;
  if (!engine.backspace(now(), { wholeToken }).accepted) return;
  ui.renderToken(engine, { full: false });
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
  if (run.engine.status === 'finished') return;
  resetInputBuffer();
  ui.elements.hiddenInput.focus({ preventScroll: true });
}

function updateFocusState() {
  ui.setFocusState({ focused: document.activeElement === ui.elements.hiddenInput, finished: run.engine.status === 'finished' });
}

// ---------- 설정 ----------
function bindSettings() {
  ui.populateLanguages(settings.languageKey);
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
}

function bindEvents() {
  const { elements } = ui;
  elements.restartButton.addEventListener('click', () => { resetGame(); focusTypingArea(); });
  elements.retryButton.addEventListener('click', () => { resetGame(); focusTypingArea(); });
  elements.saveForm.addEventListener('submit', handleSave);
  elements.focusOverlay.addEventListener('click', focusTypingArea);
  elements.stage.addEventListener('click', focusTypingArea);
  elements.hiddenInput.addEventListener('keydown', handleKeyDown);
  elements.hiddenInput.addEventListener('input', handleInput);
  elements.hiddenInput.addEventListener('compositionend', handleCompositionEnd);
  elements.hiddenInput.addEventListener('paste', event => event.preventDefault());
  elements.hiddenInput.addEventListener('focus', updateFocusState);
  elements.hiddenInput.addEventListener('blur', updateFocusState);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.activeElement !== elements.hiddenInput) {
      resetGame();
      focusTypingArea();
    }
  });
}

bindSettings();
bindEvents();
ui.log('sys', 'TYPE//CODE ready. 오타는 에러 로그로 남고, Backspace로 지울 수 있습니다.');
resetGame();
refreshBoard();
