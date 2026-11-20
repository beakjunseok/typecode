// '평균적인 사람'처럼 컴퓨터 디펜스를 하는 봇. 수치 근거:
//  · 타자 속도: Dhakal 외(CHI 2018, 16.9만 명) 평균 51.6 WPM(표준편차 20.2), 하위 10% ≈ 26 WPM. 글자 간격(IKI)은 로그정규·최소 60ms
//  · 코드 글자 ×1.25(Edwards 외, ICER 2020: 코드가 21~27% 느림), 기호·대문자 ×1.75(추정)
//  · 오타 ≈ 3%(느린 사람 ≈ 6%), 알아채기까지 0~4글자, 첫 Backspace ≈ 0.47초(Crump & Logan 2013), 다음 Backspace ≈ 0.13초
//  · 새 낱말 첫 키까지 ≈ 0.6~0.9초(Crump & Logan 2010, Ostry 1983 등), 가끔(4%) 0.3~1초 멈칫(Roeser 외 로그정규 혼합)
//  · 마우스(KLM): 손 옮기기 0.5초 + 생각 1.35초(익숙한 반복은 0.4초) + 가리키기 ≈ 0.8초 + 클릭 0.1초, 끝나면 손 돌아오기 0.5초
//  · 운영(근거 약함 → 가정): 타워 3~5개까지 짓고 그 뒤 강화 55%·짓기 45%, 코인 10% 남김, 배치 25%는 최적이 아닌 자리,
//    판매는 드묾, 카드는 등급·화려함에 끌리는 소프트맥스
import { TOWER_TYPES } from '../../public/js/defense-engine.js';
import { cardById } from '../../public/js/defense-cards.js';
import { ITEM_RARITIES } from '../../public/js/item-rarity.js';

export const PROFILES = Object.freeze({
  average: Object.freeze({ wpm: 50, casual: false }),
  casual: Object.freeze({ wpm: 30, casual: true })
});

// 정규분포 하나(Box–Muller)
function gaussian(random) {
  const u = Math.max(1e-9, random()), v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// 로그정규(평균 mean, 로그 표준편차 sigma)
function lognormal(random, mean, sigma) {
  const median = mean / Math.exp((sigma * sigma) / 2);
  return median * Math.exp(sigma * gaussian(random));
}

// 사람 한 명 뽑기: Dhakal 분포(평균 51.6, 표준편차 20.2, 15~120으로 자름). 30 WPM 미만이면 느긋한 운영
export function samplePerson(random) {
  const wpm = Math.max(15, Math.min(120, 51.6 + 20.2 * gaussian(random)));
  return { wpm, casual: wpm < 30 };
}

// 실력에 따른 세부 수치(50 WPM을 기준으로 늘이거나 줄인다)
function traitsFor(person) {
  const slowness = 50 / person.wpm;
  return {
    letterSeconds: 12 / person.wpm,                       // 1 WPM = 분당 5글자 → 글자당 12/WPM 초
    sigma: person.casual ? 0.6 : 0.45,
    slip: Math.min(0.09, 0.03 * slowness ** 0.9),
    hesitation: person.casual ? 0.08 : 0.04,
    startLatency: 0.75 * Math.sqrt(slowness),
    firstBackspace: 0.47 * Math.sqrt(slowness),
    nextBackspace: 0.13 * Math.sqrt(slowness),
    homing: person.casual ? 0.7 : 0.5,
    think: person.casual ? 2.2 : 1.35,
    thinkRepeat: person.casual ? 0.7 : 0.4,
    point: person.casual ? 1.0 : 0.8,
    click: person.casual ? 0.2 : 0.1,
    tokensBetweenChecks: person.casual ? [12, 20] : [5, 10],
    buffer: person.casual ? 0.3 : 0.1,
    upgradeShare: person.casual ? 0.35 : 0.55,
    offOptimal: person.casual ? 0.42 : 0.25,
    sellChance: person.casual ? 0.01 : 0.04,
    cardTemperature: person.casual ? 1.2 : 0.8,
    repairBelow: person.casual ? 0.3 : 0.4
  };
}

const SYMBOL = /[^a-z0-9]/;

export function createHumanPlayer(engine, person, random) {
  const traits = traitsFor(person);
  const buildTarget = 3 + Math.floor(random() * 3);
  const state = {
    word: null, index: 0, nextAt: 0.5, typedSinceCheck: 0,
    checkEvery: traits.tokensBetweenChecks[0] + Math.floor(random() * (traits.tokensBetweenChecks[1] - traits.tokensBetweenChecks[0] + 1)),
    detectIn: -1, busyUntil: 0, plan: [], lastBreakChecked: -1, sawDrone: false
  };

  // 글자 하나 치는 데 걸리는 시간(로그정규, 최소 60ms). 기호·대문자는 더 느리고 가끔 멈칫한다
  const keyDelay = character => {
    const factor = SYMBOL.test(character) ? 1.75 : 1.25;
    let delay = Math.max(0.06, lognormal(random, traits.letterSeconds * factor, traits.sigma));
    if (random() < traits.hesitation) delay += 0.3 + random() * 0.7;
    return delay;
  };

  // 가게에서 할 일 고르기(한 번에 하나). 할 게 없으면 null
  const nextAction = () => {
    const usable = engine.coins * (1 - traits.buffer);
    if (engine.health < engine.maxHealth * traits.repairBelow && engine.coins >= engine.priceOf('patch')) return { kind: 'repair' };
    if (engine.towers.length && random() < traits.sellChance && engine.wave >= 8) {
      const weak = engine.towers.find(tower => tower.level === 1);
      if (weak) return { kind: 'sell', tower: weak };
    }
    const wantUpgrade = engine.towers.length >= buildTarget && (random() < traits.upgradeShare || !engine.canBuildNew());
    if (wantUpgrade) {
      const computer = engine.computerUpgradeInfo();
      if (engine.wave >= 4 && !computer.maxed && random() < 0.2 && usable >= computer.price) return { kind: 'computer' };
      const options = engine.towers.map(tower => ({ tower, info: engine.upgradeInfo(tower) })).filter(entry => entry.info?.price != null && !entry.info.maxed && usable >= entry.info.price);
      if (options.length) return { kind: 'upgrade', tower: options[Math.floor(random() * Math.min(3, options.length))].tower };
      return null;
    }
    if (!engine.canBuildNew()) return null;
    // 짓기: 드론을 봤는데 공중 타워가 없으면 공중 타워 쪽으로 기운다. 나머지는 손에 익은 순서 + 무작위
    const hasAir = engine.towers.some(tower => tower.type === 'emp' || tower.type === 'interceptor');
    const weights = { firewall: 1, antivirus: 1.4, emp: 1, interceptor: engine.wave >= 4 ? 1.2 : 0.3, honeypot: 0.8 };
    if (state.sawDrone && !hasAir) { weights.emp *= 3; weights.interceptor *= 3; }
    const affordable = Object.keys(TOWER_TYPES).filter(type => usable >= engine.priceOf(type));
    if (!affordable.length) return null;
    let roll = random() * affordable.reduce((sum, type) => sum + (weights[type] ?? 1), 0);
    const type = affordable.find(candidate => (roll -= weights[candidate] ?? 1) < 0) ?? affordable[0];
    return { kind: 'build', type };
  };

  // 할 일 실행(엔진에 반영). 배치는 75%(느긋하면 58%) 추천 자리, 나머지는 덜 좋은 자리
  const perform = action => {
    if (action.kind === 'repair') engine.buy('patch');
    else if (action.kind === 'sell') engine.sellTower(action.tower);
    else if (action.kind === 'computer') engine.upgradeComputer();
    else if (action.kind === 'upgrade') engine.upgradeTower(action.tower);
    else if (action.kind === 'build') {
      const spots = engine.suggestedSpots();
      if (!spots.length || !engine.selectShopItem(action.type).buildMode) return;
      const spot = random() < traits.offOptimal && spots.length > 1 ? spots[1 + Math.floor(random() * Math.min(4, spots.length - 1))] : spots[0];
      const result = engine.placeAtPoint(spot);
      if (result?.bought === false) engine.cancelBuild('bot', { silent: true });
    }
  };

  // 가게 들르기: 할 일을 하나씩 정해 시간(손 옮기기·생각·가리키기·클릭)을 쓰고, 끝나면 손을 키보드로
  const shop = now => {
    let time = now + traits.homing;
    let first = true;
    for (let count = 0; count < 4; count++) {
      const action = nextAction();
      if (!action) break;
      time += (first ? traits.think : traits.thinkRepeat) + traits.point + traits.click + (action.kind === 'build' ? traits.point * 0.7 + traits.click : 0);
      first = false;
      state.plan.push({ at: time, action });
    }
    state.busyUntil = state.plan.length ? time + traits.homing : now;
  };

  // 카드 고르기: 등급 힘 + 화려함(영웅·전설 +0.5) + 상황(안 지은 타워 카드는 덜 끌림)을 소프트맥스로
  const chooseCard = hand => {
    const built = new Set(engine.towers.map(tower => tower.type));
    const appeal = hand.map(id => {
      const card = cardById(id);
      let value = (ITEM_RARITIES[card.rarity]?.power ?? 1) + (card.rarity === 'epic' || card.rarity === 'legendary' ? 0.5 : 0);
      for (const type of Object.keys(TOWER_TYPES)) if (card.text.includes(TOWER_TYPES[type].label) && !built.has(type)) value *= 0.4;
      if (/회복|체력/.test(card.text) && engine.health > engine.maxHealth * 0.8) value *= 0.6;
      return Math.exp(Math.log(Math.max(0.05, value)) / traits.cardTemperature);
    });
    let roll = random() * appeal.reduce((sum, value) => sum + value, 0);
    for (let index = 0; index < hand.length; index++) if ((roll -= appeal[index]) < 0) return index;
    return hand.length - 1;
  };

  // 매 틱: 가게 일 처리 → (쉬는 시간·낱말 몇 개마다) 가게 들르기 → 타자
  const tick = now => {
    if (engine.bugs?.some(bug => bug.air)) state.sawDrone = true;
    while (state.plan.length && state.plan[0].at <= now) perform(state.plan.shift().action);
    if (now < state.busyUntil) return;
    const breakTime = engine.phase === 'break' && state.lastBreakChecked !== engine.wave;
    if (breakTime || state.typedSinceCheck >= state.checkEvery) {
      if (breakTime) state.lastBreakChecked = engine.wave;
      state.typedSinceCheck = 0;
      shop(now);
      if (now < state.busyUntil) {
        state.nextAt = Math.max(state.nextAt, state.busyUntil);
        return;
      }
    }
    while (now >= state.nextAt) {
      const at = state.nextAt;
      const target = engine.stream?.[0];
      if (!target) { state.nextAt = at + 0.2; break; }
      if (state.word !== target.token.text) {
        // 새 낱말: 보고 첫 키까지
        state.word = target.token.text;
        state.index = 0;
        state.detectIn = -1;
        state.nextAt = at + Math.max(0.25, lognormal(random, traits.startLatency, 0.35));
        continue;
      }
      if (engine.wrongInBuffer > 0 && state.detectIn === 0) {
        // 틀린 걸 알아챔: Backspace(첫 번째는 느림)
        engine.backspace(at * 1000);
        const first = state.backspacing !== true;
        state.backspacing = engine.wrongInBuffer > 0;
        if (!state.backspacing) { state.detectIn = -1; state.index = engine.typed.length; }
        state.nextAt = at + (first ? traits.firstBackspace : traits.nextBackspace);
        continue;
      }
      const intended = state.word[state.index] ?? state.word[state.word.length - 1];
      const slip = random() < traits.slip;
      const character = slip ? (intended === 'a' ? 's' : 'a') : intended;
      engine.input(character, at * 1000);
      if (engine.wrongInBuffer > 0) {
        if (state.detectIn < 0) state.detectIn = Math.min(4, Math.floor(-Math.log(Math.max(1e-6, random())) * 1));
        else state.detectIn = Math.max(0, state.detectIn - 1);
        if (engine.typed.length >= state.word.length) state.detectIn = 0;
      }
      state.index++;
      state.nextAt = at + keyDelay(character);
      if (engine.stream?.[0]?.token.text !== state.word || (engine.typed.length === 0 && engine.wrongInBuffer === 0 && state.index >= state.word.length)) {
        state.word = null;
        state.typedSinceCheck++;
      }
    }
  };

  return { tick, chooseCard, person, traits };
}
