// 실제 플레이 통계(/api/balance) 보기: 디펜스 카드·배터리/던지기 아이템별 표본·선택률·성과 차이를 표로.
// 사용: node scripts/balance/telemetry-report.mjs [defense|battery|throw] [주 수=4] [주소=https://typecode-coral.vercel.app]
const mode = process.argv[2] ?? 'defense';
const weeks = Number(process.argv[3] ?? 4);
const base = process.argv[4] ?? 'https://typecode-coral.vercel.app';

const response = await fetch(`${base}/api/balance?mode=${mode}&weeks=${weeks}`);
if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
const data = await response.json();
console.log(`${mode} · 최근 ${data.weeks}주 · ${data.runs}판 · 승률 ${data.winRate ?? '-'}`);

if (mode === 'defense') {
  console.log('등급별 평균 (lift = 같은 순번에서 이 카드를 고른 판이 평균보다 더 버틴 웨이브):');
  console.table(data.byRarity);
  const rows = data.cards
    .filter(card => card.offered > 0)
    .sort((first, second) => (second.lift ?? -99) - (first.lift ?? -99))
    .map(card => ({ 카드: card.id, 등급: card.rarity, 받은수: card.offered, 고른수: card.picked, 선택률: card.pickRate, lift: card.lift ?? '데이터 부족', 판정: card.verdict ?? '' }));
  console.table(rows);
} else {
  const rows = data.items
    .sort((first, second) => first.item.localeCompare(second.item) || ['common', 'rare', 'epic', 'legendary'].indexOf(first.rarity) - ['common', 'rare', 'epic', 'legendary'].indexOf(second.rarity))
    .map(item => ({ 아이템: item.item, 등급: item.rarityLabel, 먹은판: item.runs, 승률차이: item.winLift ?? '데이터 부족' }));
  console.table(rows);
}
