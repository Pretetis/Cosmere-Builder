// ============================================================
// Cosmere RPG — Ícones de Ativação
// Mapeia chaves de ativação para SVG inline + label em pt-BR
// Símbolos do livro: ▶ ▷ 2 3 ∞ ★
// ============================================================

var ActivationIcons = (function () {
  'use strict';

  // SVG de seta preenchida (n = 1, 2 ou 3)
  function arrowsFilled(n) {
    const W = 10, GAP = 5, H = 14;
    const totalW = n * W + (n - 1) * GAP;
    let polys = '';
    for (let i = 0; i < n; i++) {
      const x = i * (W + GAP);
      polys += `<polygon points="${x},0 ${x + W},${H / 2} ${x},${H}" fill="currentColor"/>`;
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${H}" viewBox="0 0 ${totalW} ${H}">${polys}</svg>`;
  }

  // SVG de seta vazia (ação livre)
  function arrowHollow() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="14" viewBox="0 0 10 14">
      <polygon points="0,0 10,7 0,14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
    </svg>`;
  }

  // SVG de infinito (passivo)
  function infinity() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="14" viewBox="0 0 24 14">
      <path d="M12,7 C12,4.5 9.8,2.5 7,2.5 C4.2,2.5 2,4.5 2,7 C2,9.5 4.2,11.5 7,11.5
               C9.8,11.5 12,9.5 12,7
               C12,4.5 14.2,2.5 17,2.5 C19.8,2.5 22,4.5 22,7
               C22,9.5 19.8,11.5 17,11.5 C14.2,11.5 12,9.5 12,7 Z"
            fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
    </svg>`;
  }

  // SVG de estrela (especial / reação)
  function star() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14">
      <polygon points="7,0.5 8.6,5 13.3,5 9.6,8 11,12.5 7,9.8 3,12.5 4.4,8 0.7,5 5.4,5"
               fill="currentColor"/>
    </svg>`;
  }

  // ── Mapa público ───────────────────────────────────────────
  // chave → { svg, label, color }
  const MAP = {
    action1:  { svg: arrowsFilled(1), label: '1 Ação',      color: '#4a9eff' },
    action2:  { svg: arrowsFilled(2), label: '2 Ações',     color: '#4a9eff' },
    action3:  { svg: arrowsFilled(3), label: '3 Ações',     color: '#4a9eff' },
    free:     { svg: arrowHollow(),   label: 'Ação Livre',  color: '#7ec8a0' },
    passive:  { svg: infinity(),      label: 'Passivo',     color: '#c0a060' },
    special:  { svg: star(),          label: 'Especial',    color: '#d4a8ff' },
    reaction: { svg: star(),          label: 'Reação',      color: '#ff9a6c' },
  };

  /**
   * Retorna o HTML do badge completo para o modal.
   * @param {string} key  — chave de ativação ('action1', 'passive', etc.)
   */
  function badge(key) {
    const info = MAP[key];
    if (!info) return '';
    return `<span class="act-badge" style="color:${info.color}" title="${info.label}">
      <span class="act-icon">${info.svg}</span>
      <span class="act-label">${info.label}</span>
    </span>`;
  }

  /**
   * Retorna apenas o ícone SVG pequeno (para tooltip).
   */
  function icon(key) {
    const info = MAP[key];
    if (!info) return '';
    return `<span class="act-icon-sm" style="color:${info.color}" title="${info.label}">${info.svg}</span>`;
  }

  return { badge, icon, MAP };
})();
