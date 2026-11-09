// 시각 효과. 사용자가 '동작 줄이기'를 켜 두었으면 모두 생략한다.

export function prefersReducedMotion() {
  try {
    return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  } catch (error) {
    return false;
  }
}

// 요소 중심에서 원형으로 퍼지는 네온 파티클(blur 4px → 0 → 2px). 끝나면 DOM에서 제거.
export function emitSparks(anchorElement, { color = '#ffb547', count = 14, distance = 70 } = {}) {
  if (!anchorElement || prefersReducedMotion()) return;
  const rect = anchorElement.getBoundingClientRect();
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < count; index++) {
    const spark = document.createElement('div');
    const angle = (Math.PI * 2 * index) / count + Math.random() * 0.4;
    const travel = distance * (0.55 + Math.random() * 0.6);
    spark.className = 'spark';
    spark.style.left = `${rect.left + rect.width / 2}px`;
    spark.style.top = `${rect.top + rect.height / 2}px`;
    spark.style.setProperty('--spark-color', color);
    spark.style.setProperty('--dx', `${Math.cos(angle) * travel}px`);
    spark.style.setProperty('--dy', `${Math.sin(angle) * travel}px`);
    spark.addEventListener('animationend', () => spark.remove(), { once: true });
    setTimeout(() => spark.remove(), 900);
    fragment.appendChild(spark);
  }
  document.body.appendChild(fragment);
}

// CSS 애니메이션 클래스를 다시 걸어 연속 호출에도 매번 재생되게 한다.
export function pulseClass(element, className, durationMs) {
  if (!element || prefersReducedMotion()) return;
  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);
  clearTimeout(element[`__${className}Timer`]);
  element[`__${className}Timer`] = setTimeout(() => element.classList.remove(className), durationMs);
}
