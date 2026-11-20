// 밸런스 통계: 한 판이 끝나면 '어떤 아이템·카드를 얼마나 썼고 결과가 어땠는지'를 짧게 묶어 서버에 남긴다.
// 이름·입력 내용 같은 개인 정보는 담지 않는다. 클라이언트(만들기)와 서버(검증·집계)가 같은 함수를 쓴다.
import { DEFENSE_CARDS } from './defense-cards.js';
import { BATTERY_ITEMS } from './battery-engine.js';
import { ITEM_TYPES as THROW_ITEMS } from './throw-engine.js';
import { RARITY_ORDER, ITEM_RARITIES } from './item-rarity.js';

export const REPORT_VERSION = 1;
export const REPORT_MODES = Object.freeze(['defense', 'battery', 'throw']);
// 너무 짧은 판(바로 나감)은 통계를 흐리므로 남기지 않는다
export const MIN_REPORT_SECONDS = 15;
// 저장 경로에 담을 수 있는 길이(base64 전). Vercel Blob 경로 상한 950자 안에 들도록(base64 후 ≈800자). 넘치면 뒤쪽 기록부터 줄인다
export const MAX_REPORT_LENGTH = 600;
// 표본이 이보다 적으면 '데이터 부족'
export const MIN_SAMPLES = 20;

const CARD_IDS = new Set(DEFENSE_CARDS.map(card => card.id));
const CARD_RARITY = Object.fromEntries(DEFENSE_CARDS.map(card => [card.id, card.rarity]));
const RARITIES = new Set(RARITY_ORDER);
const clampInteger = (value, min, max) => Math.max(min, Math.min(max, Math.round(Number(value) || 0)));

// 아이템 기록 { '키:등급': 값 } 중 알려진 키·등급만, 개수는 0~99로
function cleanItemLog(raw, knownKeys, pair) {
  const result = {};
  for (const [key, value] of Object.entries(raw ?? {}).slice(0, 48)) {
    const [item, rarity] = key.split(':');
    if (!knownKeys.has(item) || !RARITIES.has(rarity)) continue;
    result[`${item}:${rarity}`] = pair
      ? [clampInteger(value?.[0], 0, 99), clampInteger(value?.[1], 0, 99)]
      : clampInteger(value, 0, 99);
  }
  return result;
}

// 판 결과(summary) → 보낼 기록. 짧은 판·지원하지 않는 모드는 null
export function buildReport(summary) {
  if (!summary || !REPORT_MODES.includes(summary.mode) || summary.autoPlay) return null;
  if ((summary.survivedSeconds ?? 0) < MIN_REPORT_SECONDS) return null;
  const base = { v: REPORT_VERSION, l: clampInteger(summary.level, 1, 4), s: clampInteger(summary.survivedSeconds, 0, 3600), cpm: clampInteger(summary.charactersPerMinute, 0, 2000) };
  if (summary.mode === 'defense') {
    return {
      ...base,
      w: clampInteger(summary.wavesCleared, 0, 99),
      win: summary.outcome === 'cleared' ? 1 : 0,
      d: (summary.draftLog ?? []).map(entry => [clampInteger(entry.wave, 0, 99), entry.hand.join('|'), Math.max(0, entry.hand.indexOf(entry.pick))])
    };
  }
  if (summary.mode === 'battery') {
    return {
      ...base,
      win: ['rescued', 'rival-sunk'].includes(summary.outcome) ? 1 : 0,
      p: summary.persona ?? null,
      wx: summary.weather ?? null,
      it: summary.itemLog ?? {}
    };
  }
  return { ...base, win: summary.bossDefeated ? 1 : 0, k: clampInteger(summary.totalKills, 0, 9999), it: summary.itemLog ?? {} };
}

// 서버·클라이언트 공통 검증: 모르는 값은 버리고 범위를 자른다. 형식이 틀리면 null
export function normalizeReport(mode, raw) {
  if (!REPORT_MODES.includes(mode) || !raw || typeof raw !== 'object' || raw.v !== REPORT_VERSION) return null;
  const report = { v: REPORT_VERSION, l: clampInteger(raw.l, 1, 4), s: clampInteger(raw.s, 0, 3600), cpm: clampInteger(raw.cpm, 0, 2000), win: raw.win ? 1 : 0 };
  if (mode === 'defense') {
    report.w = clampInteger(raw.w, 0, 99);
    report.d = (Array.isArray(raw.d) ? raw.d : []).slice(0, 12).flatMap(entry => {
      if (!Array.isArray(entry)) return [];
      const hand = String(entry[1] ?? '').split('|').filter(id => CARD_IDS.has(id)).slice(0, 5);
      const pick = clampInteger(entry[2], 0, 4);
      return hand.length && pick < hand.length ? [[clampInteger(entry[0], 0, 99), hand.join('|'), pick]] : [];
    });
  } else if (mode === 'battery') {
    report.p = typeof raw.p === 'string' ? raw.p.slice(0, 12) : null;
    report.wx = typeof raw.wx === 'string' ? raw.wx.slice(0, 12) : null;
    report.it = cleanItemLog(raw.it, new Set(Object.keys(BATTERY_ITEMS)), true);
  } else {
    report.k = clampInteger(raw.k, 0, 9999);
    report.it = cleanItemLog(raw.it, new Set(Object.keys(THROW_ITEMS)), false);
  }
  return fitReport(report);
}

// 저장 길이 제한에 맞추기: 카드 기록·아이템 기록을 뒤에서부터 줄인다
export function fitReport(report) {
  const copy = { ...report, ...(report.d ? { d: [...report.d] } : {}), ...(report.it ? { it: { ...report.it } } : {}) };
  while (JSON.stringify(copy).length > MAX_REPORT_LENGTH) {
    if (copy.d?.length) copy.d.pop();
    else if (copy.it && Object.keys(copy.it).length) delete copy.it[Object.keys(copy.it).pop()];
    else break;
  }
  return copy;
}

const mean = values => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
const round = (value, digits = 2) => (value == null ? null : Math.round(value * 10 ** digits) / 10 ** digits);

// 디펜스 카드 집계. 같은 난이도·같은 순번의 카드 고르기끼리 비교해 '이 카드를 고른 판이 평균보다 몇 웨이브 더 버텼나'(lift)를 낸다.
// 오래 버틴 판일수록 카드를 많이 받는 착시를 줄이려고, 순번(몇 번째 고르기)이 같은 판끼리만 비교한다. O(판 수 × 고르기 수)
export function aggregateDefense(reports) {
  const groups = new Map();
  for (const report of reports) {
    report.d.forEach((entry, order) => {
      const key = `${report.l}:${order}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ report, hand: entry[1].split('|'), pick: entry[2] });
    });
  }
  const cards = Object.fromEntries(DEFENSE_CARDS.map(card => [card.id, { id: card.id, rarity: card.rarity, offered: 0, picked: 0, liftSamples: [] }]));
  for (const group of groups.values()) {
    const groupMean = mean(group.map(sample => sample.report.w));
    for (const { report, hand, pick } of group) {
      hand.forEach(id => { if (cards[id]) cards[id].offered++; });
      const picked = cards[hand[pick]];
      if (!picked) continue;
      picked.picked++;
      picked.liftSamples.push(report.w - groupMean);
    }
  }
  const rows = Object.values(cards).map(card => ({
    id: card.id, rarity: card.rarity, offered: card.offered, picked: card.picked,
    pickRate: card.offered ? round(card.picked / card.offered) : null,
    lift: card.liftSamples.length >= MIN_SAMPLES ? round(mean(card.liftSamples)) : null,
    samples: card.liftSamples.length
  }));
  return { runs: reports.length, winRate: round(mean(reports.map(report => report.win))), cards: rows, byRarity: summarizeByRarity(rows) };
}

// 등급별 평균(표본이 충분한 것만)과, 그 등급 평균보다 눈에 띄게 세거나 약한 카드 표시
function summarizeByRarity(rows) {
  const result = {};
  for (const rarity of RARITY_ORDER) {
    const measured = rows.filter(row => row.rarity === rarity && row.lift != null);
    result[rarity] = { measured: measured.length, lift: round(mean(measured.map(row => row.lift))), pickRate: round(mean(rows.filter(row => row.rarity === rarity && row.pickRate != null).map(row => row.pickRate))) };
  }
  for (const row of rows) {
    const reference = result[row.rarity];
    if (row.lift == null || reference.lift == null) continue;
    const spread = Math.max(0.5, Math.abs(reference.lift));
    row.verdict = row.lift > reference.lift + spread ? '셈' : row.lift < reference.lift - spread ? '약함' : '적정';
  }
  return result;
}

// 아이템 집계(배터리·던지기): '이 아이템(등급)을 한 번이라도 먹은 판'과 '안 먹은 판'의 승률 차이(lift), 같은 난이도끼리
export function aggregateItems(mode, reports) {
  const keys = mode === 'battery' ? Object.keys(BATTERY_ITEMS) : Object.keys(THROW_ITEMS);
  const rows = [];
  const byLevel = new Map();
  for (const report of reports) {
    if (!byLevel.has(report.l)) byLevel.set(report.l, []);
    byLevel.get(report.l).push(report);
  }
  const taken = (report, key) => {
    const value = report.it?.[key];
    return Array.isArray(value) ? value[0] : value ?? 0;
  };
  for (const item of keys) {
    for (const rarity of RARITY_ORDER) {
      const key = `${item}:${rarity}`;
      const liftSamples = [];
      let runsWith = 0;
      for (const group of byLevel.values()) {
        const withItem = group.filter(report => taken(report, key) > 0);
        const without = group.filter(report => taken(report, key) === 0);
        if (!withItem.length || !without.length) continue;
        runsWith += withItem.length;
        const baseline = mean(without.map(report => report.win));
        withItem.forEach(report => liftSamples.push(report.win - baseline));
      }
      if (!runsWith) continue;
      rows.push({ item, rarity, rarityLabel: ITEM_RARITIES[rarity].label, runs: runsWith, winLift: liftSamples.length >= MIN_SAMPLES ? round(mean(liftSamples)) : null });
    }
  }
  return { runs: reports.length, winRate: round(mean(reports.map(report => report.win))), items: rows };
}

export function aggregate(mode, reports) {
  return mode === 'defense' ? aggregateDefense(reports) : aggregateItems(mode, reports);
}

export { CARD_RARITY };
