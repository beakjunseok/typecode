// 판이 끝났을 때 주는 뽑기 포인트. 모든 모드가 같은 틀을 쓴다:
//   (타자 기본 + 진행 보너스 + 클리어 보너스 + 램프 보너스) × 난이도 배율 × 어시스트 배율, 상한 maxPerGame
//   + 처음 클리어한 (모드·난이도)마다 한 번 첫 클리어 보너스
// 플레이 시간 대비 공정하게: '평균적인 사람' 봇(scripts/balance/pace-sim.mjs)으로 잰 모드별 판 길이·게임 속 타수에 맞춰
//   · 타자 기본: 게임 속 타수가 연습보다 낮은 모드는 typingFactor로 보정(연습 ≈ 155타 기준)
//   · 진행·클리어 보너스: 보통 난이도에서 끝까지 깨는 데 드는 시간(minutes) × 분당 보너스(진행 12P, 클리어 8P)
//   → 어떤 모드든 보통 난이도에서 분당 ≈ 50~75P, 난이도 배율은 분당 기준으로 0.6/1/1.6/2.4배
// 참고: 난이도 배율 0.6/1.0/1.6/2.4 = Bloons TD 6 메타 화폐 비율(75:125:200:300).
//       진행 보너스 = 볼록 곡선 max × 진행도^1.5 (Tower Defense Simulator식: 지면 도달한 만큼, 뒤로 갈수록 더 크게).
//       첫 클리어 보너스 = 반복 보상은 깎지 않고 처음 깼을 때만 크게(Plants vs. Zombies·Arknights식).
// DOM·저장소를 모르는 순수 함수라 테스트로 검증한다.

export const EARNING = Object.freeze({ charactersPerPoint: 3, comboStep: 10, comboPoints: 5, maxPerGame: 5000, minimumCharacters: 15 });
// 분당 보너스(보통 난이도): 진행 최대, 클리어
export const BONUS_PER_MINUTE = Object.freeze({ progress: 12, clear: 8 });

// 난이도 배율: 레벨(1~4)과 리듬 난이도 이름을 같은 4단으로 본다. 쉬운 난이도로 파밍하는 것보다 한 단계 위에 도전하는 편이 낫게
export const DIFFICULTY_MULTIPLIERS = Object.freeze([0.6, 1, 1.6, 2.4]);
const RHYTHM_DIFFICULTY_INDEX = Object.freeze({ easy: 0, normal: 1, hard: 2, expert: 3 });
export const DIFFICULTY_NAMES = Object.freeze(['쉬움', '보통', '어려움', '최상']);

// 진행 곡선 지수(1이면 직선). 1.5: 절반까지 가면 최대의 35%, 4/5까지 가면 72%
export const PROGRESS_EXPONENT = 1.5;
// 모드별 진행·클리어 보너스(보통 난이도 기준 P). 연습은 순수 연습이라 기본만
// minutes: 보통 난이도에서 평균적인 사람이 끝까지 가는 시간(분). 진행·클리어 보너스와 첫 클리어 보너스가 이 길이에 비례한다
const byMinutes = (minutes, extra = {}) => Object.freeze({
  minutes, progress: Math.round(BONUS_PER_MINUTE.progress * minutes), clear: Math.round(BONUS_PER_MINUTE.clear * minutes), ...extra
});
export const MODE_REWARDS = Object.freeze({
  practice: Object.freeze({ minutes: 1, progress: 0, clear: 0, leveled: false }),
  timeattack: byMinutes(3, { clear: 0, leveled: false }),
  throw: byMinutes(4, { leveled: true, typingFactor: 1.5 }),
  battery: byMinutes(1.2, { leveled: true, typingFactor: 1.5 }),
  'battery-pvp': byMinutes(3, { leveled: false, typingFactor: 1.5 }),
  rhythm: byMinutes(2, { leveled: true, typingFactor: 2 }),
  defense: byMinutes(19, { leveled: true, typingFactor: 1.7 })
});
// 리듬 클리어 램프 보너스(클리어 보너스에 더함). 곡 하나 ≈ 2분이라 작게
export const RHYTHM_LAMP_BONUS = Object.freeze({ HARD: 10, FC: 20, AP: 40 });
// 첫 클리어 보너스도 판 길이에 비례(4분짜리 = 1배, 0.5~4배)
export const firstClearScale = mode => Math.max(0.5, Math.min(4, (MODE_REWARDS[mode]?.minutes ?? 4) / 4));
// 시간 연장 모드: 이 시간을 버티면 진행도 100%
export const TIME_ATTACK_FULL_SECONDS = 180;
// 노페일(어시스트) 클리어는 절반
export const ASSIST_FACTOR = 0.5;
// 첫 클리어 보너스(난이도 4단). 리듬은 곡마다 따로라 절반
export const FIRST_CLEAR_BONUS = Object.freeze([50, 100, 200, 300]);
export const RHYTHM_FIRST_CLEAR_BONUS = Object.freeze([25, 50, 100, 150]);

const clamp01 = value => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

// 판의 난이도 단계(0~3). 난이도가 없는 모드는 보통(1)
export function difficultyIndex(summary) {
  if (summary?.mode === 'rhythm') return RHYTHM_DIFFICULTY_INDEX[summary.difficulty] ?? 1;
  if (!MODE_REWARDS[summary?.mode]?.leveled) return 1;
  const level = Math.floor(Number(summary.level) || 2);
  return Math.min(3, Math.max(0, level - 1));
}

// 모드별 진행도(0~1)와 클리어 여부. 지면 도달한 만큼만, 이기면 1
export function progressOf(summary) {
  const mode = summary?.mode;
  if (mode === 'throw') {
    if (summary.bossDefeated || summary.outcome === 'cleared') return { progress: 1, cleared: true };
    const kills = clamp01((Number(summary.totalKills) || 0) / (Number(summary.goalKills) || 50));
    return { progress: kills * 0.8 + clamp01(summary.bossDamage) * 0.2, cleared: false };
  }
  if (mode === 'battery') {
    if (summary.outcome === 'rescued' || summary.outcome === 'rival-sunk') return { progress: 1, cleared: true };
    return { progress: clamp01((Number(summary.peakCells) || 0) / (Number(summary.goalCells) || 8)) * 0.9, cleared: false };
  }
  if (mode === 'battery-pvp') {
    if (summary.outcome === 'win') return { progress: 1, cleared: true };
    const wins = summary.pvp?.wins ?? {};
    return { progress: clamp01((Number(wins.mine) || 0) / 2) * 0.9, cleared: false };
  }
  if (mode === 'rhythm') {
    if (summary.outcome === 'cleared') return { progress: 1, cleared: true };
    // 실패: 곡을 얼마나 갔는지 × (그루브 게이지면 기준선에 얼마나 가까웠는지), 최대 70%
    const played = clamp01(summary.songProgress ?? 1);
    const gaugeRatio = summary.gauge === 'hard' ? 1 : clamp01((Number(summary.gaugeEnd) || 0) / (Number(summary.gaugeClearAt) || 75));
    return { progress: 0.7 * played * gaugeRatio, cleared: false };
  }
  if (mode === 'defense') {
    if (summary.outcome === 'cleared') return { progress: 1, cleared: true };
    // 버틴 웨이브 수 + 진 웨이브에서 절반 넘게 잡았으면 반 웨이브(Toilet Tower Defense의 50% 규칙)
    const waves = Number(summary.waves) || 5;
    const partial = (Number(summary.waveProgress) || 0) >= 0.5 ? 0.5 : 0;
    return { progress: clamp01(((Number(summary.wavesCleared) || 0) + partial) / waves), cleared: false };
  }
  if (mode === 'timeattack') return { progress: clamp01((Number(summary.survivedSeconds) || 0) / TIME_ATTACK_FULL_SECONDS), cleared: false };
  return { progress: 0, cleared: false };
}

// 첫 클리어 키: 모드·난이도(리듬은 곡까지). 클리어하지 못했거나 어시스트면 null
export function firstClearKey(summary) {
  const { cleared } = progressOf(summary);
  if (!cleared || summary.autoPlay || summary.assist) return null;
  const mode = summary.mode;
  if (!MODE_REWARDS[mode]?.leveled) return null;
  if (mode === 'rhythm') return typeof summary.songId === 'string' ? `rhythm:${summary.songId}:${summary.difficulty ?? 'normal'}` : null;
  return `${mode}:${difficultyIndex(summary) + 1}`;
}

// 포인트 내역. firstClears = 이미 받은 첫 클리어 키 목록. 반환값의 total이 실제로 더할 포인트. O(1)
export function rewardBreakdown(summary, { firstClears = [] } = {}) {
  const empty = { total: 0, base: 0, progressBonus: 0, clearBonus: 0, multiplier: 1, firstClearBonus: 0, firstClearKey: null, reason: 'short' };
  const correct = Number(summary?.correctKeystrokes) || 0;
  if (!summary || summary.autoPlay) return { ...empty, reason: summary?.autoPlay ? 'auto' : 'short' };
  if (correct < EARNING.minimumCharacters) return empty;
  const rules = MODE_REWARDS[summary.mode] ?? MODE_REWARDS.practice;
  const accuracy = clamp01((Number(summary.accuracy) || 0) / 100);
  const typing = Math.floor(correct / EARNING.charactersPerPoint * accuracy * accuracy * (rules.typingFactor ?? 1));
  const combo = Math.floor((Number(summary.maxCombo) || 0) / EARNING.comboStep) * EARNING.comboPoints;
  const base = typing + combo;
  const { progress, cleared } = progressOf(summary);
  const progressBonus = Math.round(rules.progress * progress ** PROGRESS_EXPONENT);
  const lampBonus = summary.mode === 'rhythm' && cleared ? RHYTHM_LAMP_BONUS[summary.clearLamp] ?? RHYTHM_LAMP_BONUS[summary.clearMark] ?? 0 : 0;
  const clearBonus = cleared ? rules.clear + lampBonus : 0;
  const index = difficultyIndex(summary);
  const multiplier = DIFFICULTY_MULTIPLIERS[index] * (summary.assist ? ASSIST_FACTOR : 1);
  const scaled = Math.min(EARNING.maxPerGame, Math.round((base + progressBonus + clearBonus) * multiplier));
  const key = firstClearKey(summary);
  const firstClearBonus = key && !firstClears.includes(key)
    ? (summary.mode === 'rhythm' ? RHYTHM_FIRST_CLEAR_BONUS[index] : Math.round(FIRST_CLEAR_BONUS[index] * firstClearScale(summary.mode)))
    : 0;
  return {
    total: scaled + firstClearBonus,
    base, progressBonus, clearBonus, progress, cleared, multiplier, difficultyIndex: index,
    firstClearBonus, firstClearKey: firstClearBonus ? key : null, reason: null
  };
}

// 결과창 한 줄: "기본 120 + 진행 45 + 클리어 60 × 어려움 1.6 = 360P · 첫 클리어 +200P"
export function describeReward(breakdown) {
  if (!breakdown.total) return '';
  const parts = [`기본 ${breakdown.base}`];
  if (breakdown.progressBonus) parts.push(`진행 ${breakdown.progressBonus}`);
  if (breakdown.clearBonus) parts.push(`클리어 ${breakdown.clearBonus}`);
  const name = DIFFICULTY_NAMES[breakdown.difficultyIndex] ?? '';
  const factor = breakdown.multiplier === 1 ? '' : ` × ${name} ${Number(breakdown.multiplier.toFixed(2))}`;
  const first = breakdown.firstClearBonus ? ` · 첫 클리어 +${breakdown.firstClearBonus}P` : '';
  return `${parts.join(' + ')}${factor}${first}`;
}
