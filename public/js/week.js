// KST 기준 ISO 주차 라벨(예: 2026-W46). 클라이언트 로컬 랭킹과 서버 랭킹이 같은 함수를 쓴다.
// 주가 바뀌면 새 라벨(=새 저장 경로)을 쓰므로 '랭킹 초기화' 작업 자체가 없다. O(1)
export function getWeekLabel(timestamp = Date.now()) {
  const kstDate = new Date(timestamp + 9 * 3600 * 1000);
  const isoDay = kstDate.getUTCDay() || 7;
  const thursday = new Date(Date.UTC(kstDate.getUTCFullYear(), kstDate.getUTCMonth(), kstDate.getUTCDate() + 4 - isoDay));
  const yearStart = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  const weekNumber = Math.ceil(((thursday - yearStart) / 86400000 + 1) / 7);
  return `${thursday.getUTCFullYear()}-W${String(weekNumber).padStart(2, '0')}`;
}
