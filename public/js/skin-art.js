// 키보드 스킨 카드 그림(AI 생성: Figma AI · Gemini 3.1 Flash Image). public/skins/<id>.webp, 600×803.
// 그림이 있는 스킨만 여기 적는다. 없는 스킨은 키캡 색 견본으로 대신 보여준다.
export const SKIN_ART_IDS = Object.freeze(new Set([
  'base', 'null-pointer',
  'prism-overdrive', 'gilded-artisan', 'event-horizon', 'typecode-overclock'
]));
export const skinArt = skinId => SKIN_ART_IDS.has(skinId) ? `/skins/${skinId}.webp` : null;
