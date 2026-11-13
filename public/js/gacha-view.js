// 키보드 뽑기 화면(연출·효과음)과 키보드 도감. 규칙은 gacha.js, 스킨은 keyboard-skins.js, 그리기는 keyboard.js.
import { skinArt } from './skin-art.js';
import { createKeyboard } from './keyboard.js';
import { SKINS, COLLECTIBLE_SKINS, RARITIES, RARITY_ORDER, getSkin, unlockedLedModes, skinsWithLedMode, MATERIALS } from './keyboard-skins.js';
import { AMBIENT_NAMES, REACTIVE_NAMES, LED_LABELS } from './keyboard-led.js';
import { normalizeGachaState, canDraw, draw, drawWithPoints, addPoints, buy, equip, dayKey, PITY, COSTS, legendaryChance } from './gacha.js';

const CHARGE_SECONDS = [1.2, 1.35, 1.6, 1.9, 2.4];
const STARS = count => '★'.repeat(count) + '☆'.repeat(5 - count);
const reducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const byId = id => document.getElementById(id);

// 다음 자정까지 남은 시간 'h시간 m분'
function untilMidnight(now = new Date()) {
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const minutes = Math.max(1, Math.ceil((midnight - now) / 60000));
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}시간 ${minutes % 60}분` : `${minutes}분`;
}

// 뽑기 무대의 입자: 모일 때는 바깥에서 가운데로 빨려 들고, 터질 때는 작은 키캡들이 사방으로 튀어 떨어진다. O(입자 수)/프레임
function createParticles(canvas) {
  const context = canvas.getContext('2d');
  let particles = [];
  let frameId = 0;
  let size = { width: 1, height: 1 };
  let lastTime = 0;

  function resize() {
    const ratio = Math.min(2, globalThis.devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();
    size = { width: Math.max(1, rect.width), height: Math.max(1, rect.height) };
    canvas.width = Math.round(size.width * ratio);
    canvas.height = Math.round(size.height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function step(timestamp) {
    const dt = Math.min(0.05, lastTime ? (timestamp - lastTime) / 1000 : 0.016);
    lastTime = timestamp;
    context.clearRect(0, 0, size.width, size.height);
    const centerX = size.width / 2;
    const centerY = size.height / 2;
    particles = particles.filter(particle => (particle.age += dt) < particle.life);
    context.globalCompositeOperation = 'lighter';
    for (const particle of particles) {
      const progress = particle.age / particle.life;
      if (particle.kind === 'in') {
        const distance = particle.radius * (1 - progress) ** 1.4;
        particle.x = centerX + Math.cos(particle.angle) * distance;
        particle.y = centerY + Math.sin(particle.angle) * distance;
      } else {
        particle.vy += particle.gravity * dt;
        particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;
        particle.spin += particle.spinSpeed * dt;
      }
      const alpha = particle.kind === 'in' ? Math.min(1, progress * 3) * (1 - progress * 0.3) : (1 - progress) ** 1.2;
      context.globalAlpha = alpha;
      context.fillStyle = particle.color;
      if (particle.kind === 'cap') {
        context.save();
        context.translate(particle.x, particle.y);
        context.rotate(particle.spin);
        context.fillRect(-particle.size / 2, -particle.size / 2, particle.size, particle.size);
        context.restore();
      } else {
        context.beginPath();
        context.arc(particle.x, particle.y, particle.size * (particle.kind === 'star' ? 1 - progress * 0.5 : 1), 0, Math.PI * 2);
        context.fill();
      }
    }
    context.globalAlpha = 1;
    context.globalCompositeOperation = 'source-over';
    frameId = particles.length ? requestAnimationFrame(step) : 0;
    if (!frameId) context.clearRect(0, 0, size.width, size.height);
  }

  function run() {
    if (!frameId) {
      lastTime = 0;
      frameId = requestAnimationFrame(step);
    }
  }

  return {
    resize,
    // 가운데로 모이는 빛 count개
    gather(count, color, life = 0.9) {
      const radius = Math.max(size.width, size.height) * 0.55;
      for (let index = 0; index < count; index++) {
        particles.push({ kind: 'in', angle: Math.random() * Math.PI * 2, radius: radius * (0.6 + Math.random() * 0.5), age: -Math.random() * 0.4, life, size: 1.5 + Math.random() * 2, color, x: -99, y: -99 });
      }
      run();
    },
    // 가운데에서 터지는 키캡 조각·불꽃
    burst(count, colors, power = 1) {
      const centerX = size.width / 2;
      const centerY = size.height / 2;
      for (let index = 0; index < count; index++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = (120 + Math.random() * 360) * power;
        const isCap = Math.random() < 0.55;
        particles.push({
          kind: isCap ? 'cap' : 'star', x: centerX, y: centerY, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 80 * power,
          gravity: isCap ? 520 : 140, spin: Math.random() * 6, spinSpeed: (Math.random() - 0.5) * 14,
          age: 0, life: 0.9 + Math.random() * 0.9 * power, size: isCap ? 5 + Math.random() * 6 : 1.5 + Math.random() * 2.5,
          color: colors[index % colors.length]
        });
      }
      run();
    },
    clear() {
      particles = [];
      cancelAnimationFrame(frameId);
      frameId = 0;
      context.clearRect(0, 0, size.width, size.height);
    }
  };
}

// 앱의 키보드 수집 기능 전체. onSkinChange(skin, ledOverride)로 메인 화면 키보드를 갈아입힌다
export function createKeyboardCollection({ sound, preferences, onSkinChange, onOpen, onClose }) {
  let state = normalizeGachaState(preferences.get('gacha', null));
  let ledOverride = sanitizeOverride(preferences.get('ledOverride', null));
  let selectedId = state.equipped;
  let filter = 'all';
  let drawing = null;
  let tickTimer = 0;

  const elements = {
    gachaButton: byId('gachaButton'), collectionButton: byId('collectionButton'),
    gachaModal: byId('gachaModal'), gachaClose: byId('gachaClose'), gachaSub: byId('gachaSub'), gachaStage: byId('gachaStage'),
    gachaCanvas: byId('gachaCanvas'), gachaCapsule: byId('gachaCapsule'), gachaResult: byId('gachaResult'), gachaRarity: byId('gachaRarity'),
    gachaPreview: byId('gachaPreview'), gachaName: byId('gachaName'), gachaNote: byId('gachaNote'), gachaPity: byId('gachaPity'),
    gachaDraw: byId('gachaDraw'), gachaSkip: byId('gachaSkip'), gachaEquip: byId('gachaEquip'), gachaToCollection: byId('gachaToCollection'),
    gachaOdds: byId('gachaOdds'), gachaSingle: byId('gachaSingle'), gachaMulti: byId('gachaMulti'),
    gachaMultiGrid: byId('gachaMultiGrid'), gachaBack: byId('gachaBack'), gachaPoints: byId('gachaPoints'),
    collectionModal: byId('collectionModal'), collectionClose: byId('collectionClose'), collectionSub: byId('collectionSub'),
    collectionPreview: byId('collectionPreview'), collectionRarity: byId('collectionRarity'), collectionName: byId('collectionName'),
    collectionDesc: byId('collectionDesc'), collectionLed: byId('collectionLed'), collectionEquip: byId('collectionEquip'),
    collectionBuy: byId('collectionBuy'), collectionFilters: byId('collectionFilters'), collectionGrid: byId('collectionGrid'),
    ledPattern: byId('ledPattern'), ledReactive: byId('ledReactive'), collectionToGacha: byId('collectionToGacha')
  };
  if (!elements.gachaModal || !elements.collectionModal) return { isOpen: () => false, refresh() {}, ledOverride: () => null, equippedSkin: () => getSkin(null) };

  const particles = createParticles(elements.gachaCanvas);
  const revealKeyboard = createKeyboard(elements.gachaPreview, { compact: true, interactive: true });
  const previewKeyboard = createKeyboard(elements.collectionPreview, { compact: true, interactive: true });

  function sanitizeOverride(value) {
    if (!value || typeof value !== 'object') return null;
    const pattern = AMBIENT_NAMES.includes(value.pattern) ? value.pattern : null;
    const reactive = REACTIVE_NAMES.includes(value.reactive) ? value.reactive : null;
    return pattern || reactive ? { pattern, reactive } : null;
  }

  function save() {
    preferences.set('gacha', state);
    preferences.set('ledOverride', ledOverride);
  }

  const equippedSkin = () => getSkin(state.equipped);
  // 가진 스킨이 쓰지 않는 LED 모드를 덮어쓰고 있으면(저장값 조작 등) 무시한다
  function effectiveOverride() {
    if (!ledOverride) return null;
    const unlocked = unlockedLedModes(state.owned);
    const pattern = ledOverride.pattern && unlocked.patterns.has(ledOverride.pattern) ? ledOverride.pattern : null;
    const reactive = ledOverride.reactive && unlocked.reactives.has(ledOverride.reactive) ? ledOverride.reactive : null;
    return pattern || reactive ? { pattern, reactive } : null;
  }
  const applyEquipped = () => onSkinChange?.(equippedSkin(), effectiveOverride());

  // ---------- 헤더 버튼 ----------
  function refreshButtons() {
    const available = canDraw(state);
    elements.gachaButton.classList.toggle('has-draw', available);
    const affordable = state.points >= COSTS.single;
    elements.gachaButton.classList.toggle('has-draw', available || affordable);
    elements.gachaButton.title = `${available ? '오늘의 무료 뽑기를 할 수 있어요!' : `키보드 뽑기 — 무료 뽑기까지 ${untilMidnight()}`} · 포인트 ${state.points}P`;
    elements.collectionButton.title = `키보드 도감 (${state.owned.length - 1}/${COLLECTIBLE_SKINS.length})`;
  }

  // ---------- 뽑기 ----------
  function renderOdds() {
    const rows = RARITY_ORDER.map(rarity => {
      const info = RARITIES[rarity];
      const count = COLLECTIBLE_SKINS.filter(skin => skin.rarity === rarity).length;
      return `<tr style="--rarity:${info.color}"><td class="odds-name">${STARS(info.stars)} ${info.label}</td><td>${(info.rate * 100).toFixed(1)}%</td><td>${count}종</td><td>중복 시 조각 ${info.refund}</td></tr>`;
    });
    elements.gachaOdds.innerHTML = `<tbody>${rows.join('')}</tbody>`;
  }

  function renderGachaInfo() {
    const available = canDraw(state);
    elements.gachaDraw.disabled = !available || Boolean(drawing);
    elements.gachaDraw.textContent = available ? (state.draws === 0 ? '무료 뽑기 (희귀 이상 확정)' : '오늘의 무료 뽑기') : `무료 뽑기까지 ${untilMidnight()}`;
    elements.gachaSingle.disabled = state.points < COSTS.single || Boolean(drawing);
    elements.gachaSingle.innerHTML = `1회 <small>${COSTS.single}P</small>`;
    elements.gachaMulti.disabled = state.points < COSTS.multi || Boolean(drawing);
    elements.gachaMulti.innerHTML = `10회 <small>${COSTS.multi}P · 희귀 이상 1개 보장</small>`;
    elements.gachaPoints.innerHTML = `보유 포인트 <b>${state.points}P</b> · 게임을 하면 쌓여요`;
    elements.gachaSub.textContent = available ? '하루 한 번 무료, 그 밖에는 게임 포인트로 뽑을 수 있어요' : '오늘의 무료 뽑기는 끝났어요. 게임 포인트로 더 뽑을 수 있어요';
    const left = (limit, count) => Math.max(1, limit - count);
    elements.gachaPity.innerHTML = [
      `<span style="--rarity:${RARITIES.rare.color}">희귀 이상 확정까지 <b>${left(PITY.rare, state.pity.rare)}</b>회</span>`,
      `<span style="--rarity:${RARITIES.epic.color}">영웅 이상 <b>${left(PITY.epic, state.pity.epic)}</b>회</span>`,
      `<span style="--rarity:${RARITIES.legendary.color}">전설 <b>${left(PITY.legendary, state.pity.legendary)}</b>회 · 지금 확률 ${(legendaryChance(state) * 100).toFixed(1)}%</span>`,
      `<span>키캡 조각 <b>${state.fragments}</b></span>`
    ].join('');
  }

  // 건너뛰기를 누르면 바로 끝나는 기다림
  function pause(ms) {
    return new Promise(resolve => {
      if (!drawing || drawing.skipped) return resolve();
      const timer = setTimeout(resolve, ms);
      drawing.wake = () => { clearTimeout(timer); resolve(); };
    });
  }

  function setPhase(phase) {
    elements.gachaStage.dataset.phase = phase;
  }

  function showResult(result) {
    const info = RARITIES[result.rarity];
    elements.gachaStage.style.setProperty('--rarity', info.color);
    elements.gachaRarity.textContent = `${STARS(info.stars)}  ${info.label}`;
    elements.gachaName.textContent = result.skin.name;
    elements.gachaNote.innerHTML = result.duplicate
      ? `이미 있는 키보드 · 키캡 조각 <b>+${result.refund}</b>`
      : `<span class="new-badge">NEW</span> ${MATERIALS[result.skin.material].label} · LED ${LED_LABELS[result.skin.led.pattern]} + ${LED_LABELS[result.skin.led.reactive]}`;
    revealKeyboard.setSkin(result.skin);
    showArt(document.getElementById('gachaArt'), result.skin, true);
    elements.gachaResult.hidden = false;
    elements.gachaEquip.hidden = result.duplicate && state.equipped === result.skin.id;
    elements.gachaEquip.disabled = state.equipped === result.skin.id;
    elements.gachaEquip.textContent = state.equipped === result.skin.id ? '장착 중' : '바로 장착';
    elements.gachaEquip.dataset.skin = result.skin.id;
  }

  // kind: 'free'(하루 한 번) · 'single'(100P) · 'multi'(10회 900P)
  async function startDraw(kind = 'free') {
    if (drawing) return;
    let results;
    if (kind === 'free') {
      const result = draw(state);
      if (!result.ok) return;
      state = result.state;
      results = [result];
    } else {
      const result = drawWithPoints(state, kind === 'multi' ? COSTS.multiCount : 1);
      if (!result.ok) return;
      state = result.state;
      results = result.results;
    }
    save();
    refreshButtons();
    const best = results.reduce((top, entry) => RARITY_ORDER.indexOf(entry.rarity) > RARITY_ORDER.indexOf(top.rarity) ? entry : top, results[0]);
    const rank = RARITY_ORDER.indexOf(best.rarity);
    const color = RARITIES[best.rarity].color;
    const calm = reducedMotion();
    const multi = results.length > 1;
    drawing = { skipped: false, wake: null };
    for (const button of [elements.gachaDraw, elements.gachaSingle, elements.gachaMulti]) button.hidden = true;
    elements.gachaSkip.hidden = false;
    elements.gachaEquip.hidden = true;
    elements.gachaResult.hidden = true;
    elements.gachaMultiGrid.hidden = true;
    elements.gachaBack.hidden = true;
    elements.gachaStage.dataset.rank = String(rank);
    elements.gachaStage.dataset.multi = String(multi);
    elements.gachaStage.style.setProperty('--rarity', '#e9edf8');
    particles.resize();

    // ① 키캡 캡슐이 떨어져 내려앉는다(10회는 캡슐이 금속 상자처럼 묵직하게)
    setPhase('drop');
    sound.play('gachaTick');
    await pause(calm ? 150 : 480);
    // ② 흔들리며 빛을 빨아들인다. 희귀 이상(10회면 가장 좋은 것)은 중간에 빛 색이 등급 색으로 바뀐다
    const charge = CHARGE_SECONDS[rank] + (multi ? 0.4 : 0);
    setPhase('charge');
    if (!drawing.skipped) sound.play('gachaCharge', { rarity: rank, length: charge });
    if (!calm) particles.gather((26 + rank * 10) * (multi ? 2 : 1), 'rgba(233, 237, 248, 0.9)', charge * 0.7);
    await pause(charge * 520);
    if (rank >= 2) {
      elements.gachaStage.style.setProperty('--rarity', color);
      elements.gachaStage.classList.add('tell');
      if (!calm && !drawing.skipped) particles.gather(20 + rank * 14, color, charge * 0.45);
    }
    await pause(charge * 480);
    // ③ 터진다
    setPhase('burst');
    elements.gachaStage.style.setProperty('--rarity', color);
    sound.play('gachaReveal', { rarity: rank });
    if (!calm) {
      const skinColors = [color, ...results.flatMap(entry => [entry.skin.colors.alphaBg, entry.skin.colors.accentBg]), '#ffffff'];
      particles.burst((40 + rank * 35) * (multi ? 1.5 : 1), skinColors, 0.8 + rank * 0.15);
    }
    if (multi) showMulti(results, drawing.skipped || calm);
    else showResult(results[0]);
    await pause(calm ? 100 : 700);
    // ④ 결과
    setPhase('result');
    elements.gachaStage.classList.remove('tell');
    elements.gachaSkip.hidden = true;
    for (const button of [elements.gachaDraw, elements.gachaSingle, elements.gachaMulti]) button.hidden = false;
    drawing = null;
    renderGachaInfo();
    renderCollection();
  }

  // 10회 결과: 카드 10장이 한 장씩 뒤집힌다(희귀 이상은 등급 소리). 카드를 누르면 그 키보드를 크게 본다
  let lastMulti = [];
  function showMulti(results, instant) {
    lastMulti = results;
    elements.gachaMultiGrid.innerHTML = results.map((entry, index) => {
      const info = RARITIES[entry.rarity];
      const { colors } = entry.skin;
      return `<button type="button" class="multi-card rank-${RARITY_ORDER.indexOf(entry.rarity)}" data-index="${index}" style="--rarity:${info.color};--case:${colors.case};--alpha:${colors.alphaBg};--mod:${colors.modBg};--accent:${colors.accentBg};--delay:${instant ? 0 : index * 110}ms" aria-label="${entry.skin.name} (${info.label})">
        ${swatch(entry.skin)}${skinArt(entry.skin.id) ? '' : '</span>'}
        <span class="tile-stars">${'★'.repeat(info.stars)}</span>
        <span class="tile-name">${entry.skin.name}</span>
        ${entry.duplicate ? `<span class="multi-dup">+${entry.refund} 조각</span>` : '<span class="new-badge">NEW</span>'}
      </button>`;
    }).join('');
    elements.gachaMultiGrid.hidden = false;
    elements.gachaStage.style.setProperty('--rarity', RARITIES[results.reduce((top, entry) => RARITY_ORDER.indexOf(entry.rarity) > RARITY_ORDER.indexOf(top) ? entry.rarity : top, 'common')].color);
    const fresh = results.filter(entry => !entry.duplicate).length;
    const refund = results.reduce((sum, entry) => sum + entry.refund, 0);
    elements.gachaMultiGrid.insertAdjacentHTML('beforeend', `<p class="multi-summary">새 키보드 <b>${fresh}</b>개 · 키캡 조각 <b>+${refund}</b> · 카드를 누르면 크게 보여요</p>`);
    if (!instant) {
      results.forEach((entry, index) => {
        const rank = RARITY_ORDER.indexOf(entry.rarity);
        setTimeout(() => sound.play(rank >= 2 ? 'gachaCard' : 'gachaTick', { rarity: rank }), 250 + index * 110);
      });
    }
  }

  function backToMulti() {
    elements.gachaResult.hidden = true;
    elements.gachaEquip.hidden = true;
    elements.gachaBack.hidden = true;
    elements.gachaMultiGrid.hidden = false;
    elements.gachaStage.dataset.multi = 'true';
    sound.play('gachaTick');
  }

  function skipDraw() {
    if (!drawing) return;
    drawing.skipped = true;
    drawing.wake?.();
    particles.clear();
  }

  // ---------- 도감 ----------
  const FILTERS = [['all', '전체'], ...RARITY_ORDER.map(rarity => [rarity, RARITIES[rarity].label]), ['owned', '보유'], ['missing', '미보유']];

  function renderFilters() {
    elements.collectionFilters.innerHTML = FILTERS.map(([key, label]) => {
      const color = RARITIES[key]?.color ?? '#e9edf8';
      return `<button type="button" class="chip${filter === key ? ' active' : ''}" data-filter="${key}" style="--rarity:${color}">${label}</button>`;
    }).join('');
  }

  // 스킨 카드 그림: 있으면 보이고, 아직 없는 키보드(미보유)는 어둡게 실루엣만
  function showArt(figure, skin, owned) {
    if (!figure) return;
    const source = skinArt(skin.id);
    figure.hidden = !source;
    if (!source) return;
    const image = figure.querySelector('img');
    if (image.getAttribute('src') !== source) image.src = source;
    image.alt = `${skin.name} 카드 그림`;
    figure.classList.toggle('locked', !owned);
    figure.style.setProperty('--rarity', RARITIES[skin.rarity].color);
  }

  // 견본 칸: 그림이 있으면 그림 썸네일, 없으면 키캡 색 견본(여는 태그만, 닫는 쪽은 부르는 곳에서)
  function swatch(skin) {
    const source = skinArt(skin.id);
    return source
      ? `<span class="swatch art" aria-hidden="true" style="background-image:url('${source}')"></span>`
      : '<span class="swatch" aria-hidden="true"><i class="a"></i><i class="a"></i><i class="m"></i><i class="x"></i>';
  }

  function tile(skin) {
    const owned = state.owned.includes(skin.id);
    const info = RARITIES[skin.rarity];
    const { colors } = skin;
    const classes = ['skin-tile', owned ? 'owned' : 'locked', skin.id === selectedId ? 'selected' : '', skin.id === state.equipped ? 'equipped' : ''].filter(Boolean).join(' ');
    return `<button type="button" class="${classes}" data-skin="${skin.id}" style="--rarity:${info.color};--case:${colors.case};--alpha:${colors.alphaBg};--mod:${colors.modBg};--accent:${colors.accentBg};--fg:${colors.alphaFg}" aria-label="${skin.name} (${info.label}${owned ? '' : ', 미보유'})">
      ${swatch(skin)}${skinArt(skin.id) ? '' : `<i class="led" style="--led:${ledDot(skin)}"></i></span>`}
      <span class="tile-stars">${'★'.repeat(info.stars)}</span>
      <span class="tile-name">${skin.name}</span>
      ${skin.id === state.equipped ? '<span class="tile-tag">장착 중</span>' : owned ? '' : '<span class="tile-lock" aria-hidden="true">🔒</span>'}
    </button>`;
  }

  function ledDot(skin) {
    const palette = skin.led.palette;
    if (skin.led.pattern === 'off') return 'transparent';
    if (palette === 'rainbow') return 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)';
    const stops = palette.map(([hue, saturation, lightness]) => `hsl(${hue} ${saturation}% ${lightness}%)`);
    return stops.length > 1 ? `linear-gradient(135deg, ${stops.join(', ')})` : stops[0];
  }

  function renderGrid() {
    const list = SKINS.filter(skin => {
      if (filter === 'owned') return state.owned.includes(skin.id);
      if (filter === 'missing') return !state.owned.includes(skin.id);
      return filter === 'all' || skin.rarity === filter;
    });
    elements.collectionGrid.innerHTML = list.length ? list.map(tile).join('') : '<p class="empty">해당하는 키보드가 없어요</p>';
  }

  function renderDetail() {
    const skin = getSkin(selectedId);
    const info = RARITIES[skin.rarity];
    const owned = state.owned.includes(skin.id);
    const equipped = state.equipped === skin.id;
    elements.collectionModal.querySelector('.collection-detail').style.setProperty('--rarity', info.color);
    elements.collectionRarity.textContent = `${STARS(info.stars)}  ${info.label}${skin.id === 'base' ? ' · 기본' : ''}`;
    elements.collectionName.textContent = skin.name;
    elements.collectionDesc.textContent = skin.description;
    elements.collectionLed.textContent = `${MATERIALS[skin.material].label} · LED ${LED_LABELS[skin.led.pattern]} · 터치 ${LED_LABELS[skin.led.reactive]}`;
    previewKeyboard.setSkin(skin, equipped ? effectiveOverride() : null);
    showArt(document.getElementById('collectionArt'), skin, owned);
    elements.collectionEquip.hidden = !owned;
    elements.collectionEquip.disabled = equipped;
    elements.collectionEquip.textContent = equipped ? '장착 중' : '장착하기';
    const price = info.price;
    elements.collectionBuy.hidden = owned;
    elements.collectionBuy.disabled = state.fragments < price;
    elements.collectionBuy.textContent = `키캡 조각 ${price}개로 얻기${state.fragments < price ? ` (${state.fragments}/${price})` : ''}`;
  }

  function renderLedSettings() {
    const unlocked = unlockedLedModes(state.owned);
    const option = (kind, name, set) => {
      const open = set.has(name);
      const source = open ? '' : ` — 🔒 ${skinsWithLedMode(kind, name)[0]?.name ?? ''}`;
      return `<option value="${name}"${open ? '' : ' disabled'}>${LED_LABELS[name]}${source}</option>`;
    };
    const current = effectiveOverride();
    elements.ledPattern.innerHTML = `<option value="">스킨 기본 (${LED_LABELS[equippedSkin().led.pattern]})</option>${AMBIENT_NAMES.map(name => option('pattern', name, unlocked.patterns)).join('')}`;
    elements.ledReactive.innerHTML = `<option value="">스킨 기본 (${LED_LABELS[equippedSkin().led.reactive]})</option>${REACTIVE_NAMES.map(name => option('reactive', name, unlocked.reactives)).join('')}`;
    elements.ledPattern.value = current?.pattern ?? '';
    elements.ledReactive.value = current?.reactive ?? '';
  }

  function renderCollection() {
    const owned = state.owned.length - 1;
    elements.collectionSub.textContent = `수집 ${owned}/${COLLECTIBLE_SKINS.length} · 키캡 조각 ${state.fragments}개 · 가진 스킨의 LED 모드를 내 키보드에 섞어 쓸 수 있어요`;
    renderFilters();
    renderGrid();
    renderDetail();
    renderLedSettings();
  }

  // ---------- 열고 닫기 ----------
  const isOpen = () => !elements.gachaModal.hidden || !elements.collectionModal.hidden;

  function open(modal) {
    for (const other of [elements.gachaModal, elements.collectionModal]) if (other !== modal) other.hidden = true;
    const wasOpen = isOpen();
    modal.hidden = false;
    if (!wasOpen) onOpen?.();
    clearInterval(tickTimer);
    tickTimer = setInterval(() => {
      renderGachaInfo();
      refreshButtons();
    }, 30000);
    modal.querySelector('.modal-close')?.focus({ preventScroll: true });
  }

  function close() {
    if (drawing) skipDraw();
    elements.gachaModal.hidden = true;
    elements.collectionModal.hidden = true;
    clearInterval(tickTimer);
    particles.clear();
    onClose?.();
  }

  function openGacha() {
    if (!drawing) {
      setPhase(canDraw(state) || state.points >= COSTS.single ? 'idle' : 'done');
      elements.gachaResult.hidden = true;
      elements.gachaMultiGrid.hidden = true;
      elements.gachaBack.hidden = true;
      elements.gachaEquip.hidden = true;
      elements.gachaSkip.hidden = true;
      elements.gachaStage.dataset.multi = 'false';
      for (const button of [elements.gachaDraw, elements.gachaSingle, elements.gachaMulti]) button.hidden = false;
      elements.gachaStage.style.setProperty('--rarity', '#e9edf8');
    }
    renderOdds();
    renderGachaInfo();
    open(elements.gachaModal);
    sound.play('uiClick');
  }

  function openCollection(skinId = state.equipped) {
    selectedId = skinId;
    renderCollection();
    open(elements.collectionModal);
    sound.play('uiClick');
  }

  // ---------- 이벤트 ----------
  elements.gachaButton.addEventListener('click', openGacha);
  elements.collectionButton.addEventListener('click', () => openCollection());
  elements.gachaClose.addEventListener('click', close);
  elements.collectionClose.addEventListener('click', close);
  for (const modal of [elements.gachaModal, elements.collectionModal]) {
    modal.addEventListener('click', event => { if (event.target === modal && !drawing) close(); });
  }
  elements.gachaDraw.addEventListener('click', () => startDraw('free'));
  elements.gachaSingle.addEventListener('click', () => startDraw('single'));
  elements.gachaMulti.addEventListener('click', () => startDraw('multi'));
  elements.gachaBack.addEventListener('click', event => { event.stopPropagation(); backToMulti(); });
  elements.gachaMultiGrid.addEventListener('click', event => {
    const card = event.target.closest('[data-index]');
    if (!card || drawing) return;
    event.stopPropagation();
    const entry = lastMulti[Number(card.dataset.index)];
    if (!entry) return;
    elements.gachaMultiGrid.hidden = true;
    elements.gachaStage.dataset.multi = 'false';
    showResult(entry);
    elements.gachaBack.hidden = false;
    sound.play('gachaTick');
  });
  elements.gachaSkip.addEventListener('click', skipDraw);
  elements.gachaStage.addEventListener('click', () => {
    if (drawing) skipDraw();
    else if (canDraw(state) && elements.gachaStage.dataset.phase === 'idle') startDraw('free');
  });
  elements.gachaEquip.addEventListener('click', () => {
    const next = equip(state, elements.gachaEquip.dataset.skin);
    if (!next.ok) return;
    state = next.state;
    save();
    applyEquipped();
    sound.play('gachaTick');
    elements.gachaEquip.disabled = true;
    elements.gachaEquip.textContent = '장착 중';
  });
  elements.gachaToCollection.addEventListener('click', () => openCollection(elements.gachaEquip.dataset.skin || state.equipped));
  elements.collectionToGacha?.addEventListener('click', openGacha);
  elements.collectionFilters.addEventListener('click', event => {
    const chip = event.target.closest('[data-filter]');
    if (!chip) return;
    filter = chip.dataset.filter;
    sound.play('gachaTick');
    renderFilters();
    renderGrid();
  });
  elements.collectionGrid.addEventListener('click', event => {
    const button = event.target.closest('[data-skin]');
    if (!button) return;
    selectedId = button.dataset.skin;
    sound.play('gachaTick');
    renderGrid();
    renderDetail();
    elements.collectionPreview.scrollIntoView?.({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
  });
  elements.collectionEquip.addEventListener('click', () => {
    const next = equip(state, selectedId);
    if (!next.ok) return;
    state = next.state;
    save();
    applyEquipped();
    sound.play('gachaTick');
    renderCollection();
  });
  elements.collectionBuy.addEventListener('click', () => {
    const next = buy(state, selectedId);
    if (!next.ok) return;
    state = next.state;
    save();
    sound.play('gachaReveal', { rarity: RARITY_ORDER.indexOf(getSkin(selectedId).rarity) });
    renderCollection();
    refreshButtons();
  });
  const onLedChange = () => {
    ledOverride = sanitizeOverride({ pattern: elements.ledPattern.value || null, reactive: elements.ledReactive.value || null });
    save();
    applyEquipped();
    if (selectedId === state.equipped) previewKeyboard.setSkin(equippedSkin(), effectiveOverride());
  };
  elements.ledPattern.addEventListener('change', onLedChange);
  elements.ledReactive.addEventListener('change', onLedChange);

  // 열려 있는 동안: Esc로 닫기, 도감에서는 실제 키를 치면 미리보기 키보드가 반응한다(게임 입력으로는 가지 않는다)
  document.addEventListener('keydown', event => {
    if (!isOpen()) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      close();
      return;
    }
    if (event.target instanceof HTMLSelectElement || event.target instanceof HTMLInputElement) return;
    const keyboard = !elements.collectionModal.hidden ? previewKeyboard : !elements.gachaResult.hidden ? revealKeyboard : null;
    if (!keyboard) return;
    if (event.key.length === 1) keyboard.press(event.key, true);
    else if (event.key === 'Backspace' || event.key === 'Enter') keyboard.press(event.key, true);
  }, true);

  refreshButtons();
  applyEquipped();
  // 자정을 넘기면 뽑기 알림 점을 다시 켠다
  setInterval(refreshButtons, 60000);

  // 판이 끝났을 때 포인트 적립
  function earnPoints(amount) {
    const next = addPoints(state, amount);
    if (next === state) return 0;
    state = next;
    save();
    refreshButtons();
    return amount;
  }

  return {
    isOpen,
    earnPoints,
    points: () => state.points,
    openGacha,
    openCollection,
    refresh: refreshButtons,
    equippedSkin,
    ledOverride: effectiveOverride,
    today: dayKey
  };
}
