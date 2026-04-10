// ============================================================
// Cosmere RPG Skill Tree - Application Logic
// Profile system, state management, UI binding
// ============================================================

const App = (() => {

  // ---- STATE ----
  // ---- RADIANT WHEEL DATA ----
  // Vinculadores at index 0 = top (12h / norte). 10 ordens em círculo completo.
  const WHEEL_ORDERS = [
    'Vinculadores',
    'Corredor dos Ventos', 'Rompe-Céu', 'Pulverizador',
    'Dançarino dos Precipícios', 'Sentinela da Verdade',
    'Teceluz', 'Alternauta', 'Plasmador', 'Guardião das Pedras',
  ];

  // Not-playable orders — shown greyed out, non-selectable
  const WHEEL_UNPLAYABLE = new Set(['Vinculadores']);

  // Shared surge between WHEEL_ORDERS[i] and WHEEL_ORDERS[(i+1) % 10] — complete circle
  const WHEEL_SURGES = [
    { name: 'Adesão',        svg: 'svg/Adhesion_Surge-glyph.svg'       }, // Vinculadores↔Corredor
    { name: 'Gravitação',    svg: 'svg/Gravitation_Surge-glyph.svg'    }, // Corredor↔Rompe
    { name: 'Divisão',       svg: 'svg/Division_Surge-glyph.svg'       }, // Rompe↔Pulverizador
    { name: 'Abrasão',       svg: 'svg/Abrasion_Surge-glyph.svg'       }, // Pulverizador↔Dançarino
    { name: 'Progressão',    svg: 'svg/Progression_Surge-glyph.svg'    }, // Dançarino↔Sentinela
    { name: 'Iluminação',    svg: 'svg/Illumination_Surge-glyph.svg'   }, // Sentinela↔Teceluz
    { name: 'Transformação', svg: 'svg/Transformation_Surge-glyph.svg' }, // Teceluz↔Alternauta
    { name: 'Transporte',    svg: 'svg/Transportation_Surge-glyph.svg' }, // Alternauta↔Plasmador
    { name: 'Coesão',        svg: 'svg/Cohesion_Surge-glyph.svg'       }, // Plasmador↔Guardião
    { name: 'Tensão',        svg: 'svg/Tension_Surge-glyph.svg'        }, // Guardião↔Vinculadores
  ];

  // SVG glyphs — mirrors renderer.js RADIANT_SVG_MAP
  const WHEEL_SVG_MAP = {
    'Corredor dos Ventos':       'svg/Windrunners_glyph.svg',
    'Rompe-Céu':                 'svg/Skybreakers_glyph.svg',
    'Pulverizador':              'svg/Dustbringers_glyph.svg',
    'Dançarino dos Precipícios': 'svg/Edgedancers_glyph.svg',
    'Sentinela da Verdade':      'svg/Truthwatchers_glyph.svg',
    'Teceluz':                   'svg/Lightweavers_glyph.svg',
    'Alternauta':                'svg/elsecallers_glyph.svg',
    'Plasmador':                 'svg/Willshapers_glyph.svg',
    'Guardião das Pedras':       'svg/Stonewards_glyph.svg',
    'Vinculadores':              'svg/Bondsmiths_glyph.svg',
  };

  // Cache for fetched SVG text (used for inline colored SVGs in the wheel)
  const _wheelSvgCache = {};

  // Fetch SVG source and cache it
  async function fetchSvgText(url) {
    if (_wheelSvgCache[url]) return _wheelSvgCache[url];
    try {
      const r = await fetch(url);
      const text = await r.text();
      _wheelSvgCache[url] = text;
      return text;
    } catch (e) {
      return null;
    }
  }

  // Return a data URI for a black SVG recolored to `color`
  function coloredSvgSrc(svgText, color) {
    if (!svgText) return '';
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgText, 'image/svg+xml');
    const root = doc.querySelector('svg');
    if (!root) return '';
    // Set fill on root; also replace explicit black fills on children
    root.setAttribute('fill', color);
    root.querySelectorAll('[fill]').forEach(el => {
      const f = el.getAttribute('fill').toLowerCase();
      if (f === '#000' || f === 'black' || f === '#000000') el.setAttribute('fill', color);
    });
    root.querySelectorAll('[stroke]').forEach(el => {
      const s = el.getAttribute('stroke').toLowerCase();
      if (s === '#000' || s === 'black' || s === '#000000') el.setAttribute('stroke', color);
    });
    const serial = new XMLSerializer().serializeToString(root);
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(serial);
  }

  // Pre-fetch all wheel SVGs (called on init so wheel opens instantly)
  async function preloadWheelSvgs() {
    const allSvgs = [
      ...Object.values(WHEEL_SVG_MAP),
      ...WHEEL_SURGES.map(s => s.svg),
    ];
    await Promise.all([...new Set(allSvgs)].map(fetchSvgText));
  }

  const state = {
    profile: {
      name: '',
      race: 'human',
      level: 1,
      radiantClass: null,
      radiantClassLocked: false,
    },
    attributes: {
      forca: 0, velocidade: 0, intelecto: 0,
      vontade: 0, consciencia: 0, presenca: 0
    },
    attrHistory: {},
    pericias: {},
    radiantPericias: {},
    unlockedSkills: new Set(),
    freeUnlockedSkills: new Set(), // IDs auto-desbloqueados por habilidades compartilhadas
    spentTalents: 0,
    activeClass: '_all',
  };

  // Initialize pericias to 0
  function initPericias() {
    for (const key of Object.keys(CosData.PERICIAS)) {
      state.pericias[key] = 0;
    }
    for (const key of Object.keys(CosData.PERICIAS_RADIANTES)) {
      state.radiantPericias[key] = 0;
    }
  }

  // ---- DERIVED VALUES ----
  function getPointsAvailable() {
    return CosData.computePointsAtLevel(state.profile.level);
  }

  function getAttrPointsSpent() {
    let sum = 0;
    for (const v of Object.values(state.attributes)) sum += v;
    return sum;
  }

  function getAttrPointsRemaining() {
    return getPointsAvailable().totalAttr - getAttrPointsSpent();
  }

  function getPericiaPointsSpent() {
    let sum = 0;
    for (const v of Object.values(state.pericias)) sum += v;
    // Include the 2 active radiant surges if an order is chosen
    if (state.profile.radiantClass) {
      const keys = CosData.RADIANT_CLASS_PERICIAS[state.profile.radiantClass] || [];
      for (const k of keys) sum += state.radiantPericias[k] || 0;
    }
    return sum;
  }

  function getPericiaPointsRemaining() {
    return getPointsAvailable().totalPericia - getPericiaPointsSpent();
  }

  function getTalentPointsRemaining() {
    let bonus = 0;
    // Humanos ganham +1 ponto de talento no nível 1
    if (state.profile.race === 'human' && state.profile.level >= 1) {
      bonus = 1;
    }
    return getPointsAvailable().totalTalents + bonus - state.spentTalents;
  }

  function getDefenses() {
    const a = state.attributes;
    return {
      physical:  10 + a.forca + a.velocidade,
      cognitive: 10 + a.intelecto + a.vontade,
      spiritual: 10 + a.consciencia + a.presenca
    };
  }

  // ---- ESTATÍSTICAS DERIVADAS ----
  function getDerivedStats() {
    const a = state.attributes;
    const p = state.profile;

    const ATTR_TABLE = {
      0: { recDie: '1d4',  senses: '1,5m (1q)', mov: '6m (4q)',   lift: '50kg' },
      1: { recDie: '1d6',  senses: '3m (2q)',   mov: '7,5m (7q)', lift: '100kg' },
      2: { recDie: '1d6',  senses: '3m (2q)',   mov: '7,5m (7q)', lift: '100kg' },
      3: { recDie: '1d8',  senses: '6m (4q)',   mov: '9m (6q)',   lift: '250kg' },
      4: { recDie: '1d8',  senses: '6m (4q)',   mov: '9m (6q)',   lift: '250kg' },
      5: { recDie: '1d10', senses: '15m (10q)', mov: '12m (8q)',  lift: '500kg' },
      6: { recDie: '1d10', senses: '15m (10q)', mov: '12m (8q)',  lift: '500kg' },
      7: { recDie: '1d12', senses: '30m (20q)', mov: '18m (12q)', lift: '2500kg' },
      8: { recDie: '1d12', senses: '30m (20q)', mov: '18m (16q)', lift: '2500kg' },
      9: { recDie: '1d20', senses: '30m (20q)', mov: '24m (16q)', lift: '5000kg' }
    };

    const safeAttr = (val) => Math.min(Math.max(val || 0, 0), 9);

    let maxHealth = 0;
    for (let i = 0; i < CosData.LEVEL_TABLE.length; i++) {
      const row = CosData.LEVEL_TABLE[i];
      const lvl = row.level;
      if (lvl > p.level) break;
      
      // Usa a força antiga para níveis passados, e a força atual para o nível ativo
      let forcaAtThisLevel = a.forca;
      if (lvl < p.level && state.attrHistory[lvl]) {
         forcaAtThisLevel = state.attrHistory[lvl].forca;
      }

      if (typeof row.hpGain === 'string' && row.hpGain.includes('+FOR')) {
        maxHealth += parseInt(row.hpGain.split('+')[0]) + forcaAtThisLevel;
      } else {
        maxHealth += Number(row.hpGain) || 0;
      }
    }

    const maxFocus = 2 + a.vontade;
    const maxInvestiture = p.radiantClass ? 2 + a.consciencia : 0;

    return {
      maxHealth, maxFocus, maxInvestiture,
      recDie: ATTR_TABLE[safeAttr(a.vontade)].recDie,
      senses: ATTR_TABLE[safeAttr(a.consciencia)].senses,
      movement: ATTR_TABLE[safeAttr(a.velocidade)].mov,
      lifting: ATTR_TABLE[safeAttr(a.forca)].lift
    };
  }

  function renderStats() {
    const container = document.getElementById('stats-grid');
    if (!container) return;
    const stats = getDerivedStats();

    container.innerHTML = `
      <div class="stat-row"><span class="stat-label"><span class="stat-dot" style="background:#e05252;"></span>Vida</span> <strong class="stat-val">${stats.maxHealth}</strong></div>
      <div class="stat-row"><span class="stat-label"><span class="stat-dot" style="background:#5b9bd5;"></span>Foco</span> <strong class="stat-val">${stats.maxFocus}</strong></div>
      ${stats.maxInvestiture > 0 ? `<div class="stat-row"><span class="stat-label"><span class="stat-dot" style="background:var(--color-Plasmador);"></span>Investidura</span> <strong class="stat-val" style="color:var(--color-Plasmador);">${stats.maxInvestiture}</strong></div>` : ''}
      <div class="stat-row"><span class="stat-label"><span class="stat-dot" style="background:#6dbf67;"></span>Movimento</span> <strong class="stat-val">${stats.movement}</strong></div>
      <div class="stat-row"><span class="stat-label"><span class="stat-dot" style="background:#b08ae0;"></span>Sentidos</span> <strong class="stat-val">${stats.senses}</strong></div>
      <div class="stat-row"><span class="stat-label"><span class="stat-dot" style="background:#e0a84b;"></span>Carga</span> <strong class="stat-val">${stats.lifting}</strong></div>
      <div class="stat-row"><span class="stat-label"><span class="stat-dot" style="background:#5bc8c0;"></span>Recuperação</span> <strong class="stat-val">${stats.recDie}</strong></div>
    `;
  }

  function getMaxPericiaRank() {
    return getPointsAvailable().maxPericiaRank;
  }

  // ---- SHARED SKILLS HELPER ----
  // Returns all IDs for regular skills that share the same name (across all classes)
  function getSharedSkillIds(skillName) {
    return CosData.SKILLS.filter(s => s.name === skillName).map(s => s.id);
  }

  // ---- SKILL PREREQUISITES CHECK ----
  function canUnlockSkill(skill) {
    if (state.unlockedSkills.has(skill.id)) return { can: false, reason: 'Ja desbloqueado' };

    if (getTalentPointsRemaining() <= 0) return { can: false, reason: 'Sem pontos de talento' };

    // Rank 0 (class root): only requires talent points, no other prereqs
    if (skill.rank === 0) return { can: true, reason: '' };

    if (skill.deps.length > 0) {
      const anyDepMet = skill.deps.some(depName => {
        const dep = CosData.findSkillByName(depName, skill.cls);
        if (!dep || !state.unlockedSkills.has(dep.id)) return false;
        // Se o dep foi auto-desbloqueado por compartilhamento, exige que a cadeia
        // anterior a ele nesta classe também esteja completa
        if (state.freeUnlockedSkills.has(dep.id)) {
          return dep.deps.every(ddName => {
            const dd = CosData.findSkillByName(ddName, skill.cls);
            return dd && state.unlockedSkills.has(dd.id);
          });
        }
        return true;
      });
      if (!anyDepMet) return { can: false, reason: 'Pre-requisito de talento nao atendido' };
    }

    // Rank 1+ needs the class root unlocked
    const root = CosData.getRootSkill(skill.cls);
    if (root && !state.unlockedSkills.has(root.id)) {
      return { can: false, reason: `Requer: ${root.name}` };
    }

    if (skill.reqStat && skill.reqVal > 0) {
      const periciaKey = CosData.statToPericia(skill.reqStat);
      if (periciaKey) {
        const currentVal = state.pericias[periciaKey] || 0;
        if (currentVal < skill.reqVal) {
          return { can: false, reason: `Requer ${CosData.PERICIAS[periciaKey].name} +${skill.reqVal} (atual: ${currentVal})` };
        }
      }
    }

    return { can: true, reason: '' };
  }

  function canRemoveSkill(skill) {
    if (!state.unlockedSkills.has(skill.id)) return { can: false, reason: 'Nao esta desbloqueado' };

    const pool = isRadiantSkill(skill) ? CosData.RADIANT_SKILLS : CosData.SKILLS;

    if (skill.rank === 0) {
      const hasChildren = pool.some(s =>
        s.cls === skill.cls && s.rank > 0 && state.unlockedSkills.has(s.id)
      );
      if (hasChildren) return { can: false, reason: 'Outros talentos desta classe estao desbloqueados' };
      return { can: true, reason: '' };
    }

    // Para habilidades regulares com nome compartilhado, verifica filhos em TODAS as classes
    // pois remover uma cópia remove todas as cópias compartilhadas
    if (!isRadiantSkill(skill)) {
      const hasAnyChild = CosData.SKILLS.some(s =>
        s.deps.includes(skill.name) && state.unlockedSkills.has(s.id)
      );
      if (hasAnyChild) return { can: false, reason: 'Outros talentos dependem deste' };
      return { can: true, reason: '' };
    }

    const children = pool.filter(s =>
      s.cls === skill.cls && s.deps.includes(skill.name) && state.unlockedSkills.has(s.id)
    );
    if (children.length > 0) {
      return { can: false, reason: 'Outros talentos dependem deste' };
    }
    return { can: true, reason: '' };
  }

  function toggleSkill(skill) {
    const radiant = isRadiantSkill(skill);
    if (state.unlockedSkills.has(skill.id)) {
      const check = canRemoveSkill(skill);
      if (!check.can) { notify(check.reason); return false; }
      state.unlockedSkills.delete(skill.id);
      state.freeUnlockedSkills.delete(skill.id);
      // Remove todas as cópias compartilhadas (habilidades com mesmo nome em outras classes)
      if (!radiant) {
        for (const sid of getSharedSkillIds(skill.name)) {
          if (sid !== skill.id) {
            state.unlockedSkills.delete(sid);
            state.freeUnlockedSkills.delete(sid);
          }
        }
      }
      state.spentTalents--;
      return true;
    } else {
      const check = radiant ? canUnlockRadiantSkill(skill) : canUnlockSkill(skill);
      if (!check.can) { notify(check.reason); return false; }
      state.unlockedSkills.add(skill.id);
      state.spentTalents++;
      // Auto-desbloqueia habilidades com mesmo nome em outras classes (sem custo extra)
      if (!radiant) {
        for (const sid of getSharedSkillIds(skill.name)) {
          if (sid !== skill.id && !state.unlockedSkills.has(sid)) {
            state.unlockedSkills.add(sid);
            state.freeUnlockedSkills.add(sid);
          }
        }
      }
      return true;
    }
  }

  // ---- SKILL MODAL ----
  function showSkillModal(skill) {
    const modal = document.getElementById('skill-modal');
    if (!modal) return;

    const isUnlocked = state.unlockedSkills.has(skill.id);
    const radiant = isRadiantSkill(skill);
    const checkUnlock = radiant ? canUnlockRadiantSkill(skill) : canUnlockSkill(skill);
    const checkRemove = canRemoveSkill(skill);

    // Requirements HTML
    let reqHtml = '';
    if (skill.reqStat === 'level' && skill.reqVal > 0) {
      const met = state.profile.level >= skill.reqVal;
      reqHtml += `<div class="modal-req-item ${met ? 'met' : 'unmet'}">Requer Nível ${skill.reqVal} (atual: ${state.profile.level})</div>`;
    } else if (Array.isArray(skill.reqStat)) {
      for (let i = 0; i < skill.reqStat.length; i++) {
        const sName = skill.reqStat[i];
        const sVal  = Array.isArray(skill.reqVal) ? skill.reqVal[i] : skill.reqVal;
        const key   = sName.toLowerCase();
        const curVal = state.radiantPericias[key] || 0;
        const met   = curVal >= sVal;
        const pInfo = CosData.PERICIAS_RADIANTES[key];
        const pName = pInfo ? pInfo.name : sName;
        reqHtml += `<div class="modal-req-item ${met ? 'met' : 'unmet'}">Requer ${pName} +${sVal} (atual: ${curVal})</div>`;
      }
    } else if (skill.reqStat && skill.reqVal > 0) {
      const pKey = CosData.statToPericia(skill.reqStat);
      const curVal = pKey ? (state.pericias[pKey] || 0) : 0;
      const met = curVal >= skill.reqVal;
      const pName = pKey ? CosData.PERICIAS[pKey].name : skill.reqStat;
      reqHtml += `<div class="modal-req-item ${met ? 'met' : 'unmet'}">Requer ${pName} +${skill.reqVal} (atual: ${curVal})</div>`;
    }
    if (skill.deps.length > 0) {
      const findFn = radiant ? CosData.findRadiantSkillByName : CosData.findSkillByName;
      for (const dep of skill.deps) {
        const depSkill = findFn(dep, skill.cls);
        const met = depSkill && state.unlockedSkills.has(depSkill.id);
        reqHtml += `<div class="modal-req-item ${met ? 'met' : 'unmet'}">Requer: ${dep}</div>`;
      }
    }
    if (skill.prereqText) {
      reqHtml += `<div class="modal-req-item special">Especial: ${skill.prereqText}</div>`;
    }

    // Status
    let statusClass, statusText;
    if (isUnlocked) {
      statusClass = 'unlocked';
      statusText = 'Desbloqueado';
    } else if (checkUnlock.can) {
      statusClass = 'available';
      statusText = 'Disponivel';
    } else {
      statusClass = 'locked';
      statusText = 'Bloqueado';
    }

    // Action button
    let actionHtml = '';
    if (isUnlocked) {
      actionHtml = `<button class="modal-action-btn remove ${checkRemove.can ? '' : 'disabled'}" id="modal-action">
        Remover Talento
      </button>`;
      if (!checkRemove.can) {
        actionHtml += `<div class="modal-action-reason">${checkRemove.reason}</div>`;
      }
    } else {
      actionHtml = `<button class="modal-action-btn buy ${checkUnlock.can ? '' : 'disabled'}" id="modal-action">
        Comprar Talento (1 ponto)
      </button>`;
      if (!checkUnlock.can) {
        actionHtml += `<div class="modal-action-reason">${checkUnlock.reason}</div>`;
      }
    }

    // Talent points remaining info
    const talentsLeft = getTalentPointsRemaining();

    modal.innerHTML = `
      <div class="modal-backdrop" id="modal-backdrop"></div>
      <div class="modal-content">
        <button class="modal-close" id="modal-close">&times;</button>
        <div class="modal-header">
          <div class="modal-skill-name" style="color: ${clsColor(skill.cls)}">${skill.name}</div>
          <div class="modal-skill-meta">
            <span class="modal-class">${skill.cls}</span>
            ${skill.sub !== '-' ? `<span class="modal-sub">${skill.sub}</span>` : ''}
            <span class="modal-rank">Rank ${skill.rank}</span>
            <span class="modal-status ${statusClass}">${statusText}</span>
          </div>
        </div>

        <div class="modal-body">
          <div class="modal-desc-section">
            <div class="modal-desc-label">Descricao</div>
            <div class="modal-desc-text">${skill.description || '<em>Descricao sera adicionada em breve.</em>'}</div>
          </div>

          ${reqHtml ? `<div class="modal-req-section"><div class="modal-desc-label">Requisitos</div>${reqHtml}</div>` : ''}

          <div class="modal-points-info">
            Pontos de talento restantes: <strong>${talentsLeft}</strong>
          </div>
        </div>

        <div class="modal-footer">
          ${actionHtml}
        </div>
      </div>
    `;

    modal.classList.add('visible');

    // Bind events
    document.getElementById('modal-backdrop').addEventListener('click', hideSkillModal);
    document.getElementById('modal-close').addEventListener('click', hideSkillModal);

    const actionBtn = document.getElementById('modal-action');
    if (actionBtn && !actionBtn.classList.contains('disabled')) {
      actionBtn.addEventListener('click', () => {
        const success = toggleSkill(skill);
        if (success) {
          // Rebuild tree keeping view position
          rebuildTree(true);
          renderSidebar();
          // Re-show modal with updated state
          showSkillModal(skill);
        }
      });
    }

    // Close on Escape
    modal._escHandler = (e) => {
      if (e.key === 'Escape') hideSkillModal();
    };
    document.addEventListener('keydown', modal._escHandler);
  }

  function hideSkillModal() {
    const modal = document.getElementById('skill-modal');
    if (!modal) return;
    modal.classList.remove('visible');
    if (modal._escHandler) {
      document.removeEventListener('keydown', modal._escHandler);
      modal._escHandler = null;
    }
  }

  // ---- UI RENDERING ----
  function renderSidebar() {
    renderPoints();
    renderAttributes();
    renderDefenses();
    renderStats();
    renderPericias();
    renderLevelDisplay();
    renderRadiantSection();
    // Lock race buttons when not level 1
    const locked = state.profile.level !== 1;
    document.querySelectorAll('.race-btn').forEach(btn => {
      btn.classList.toggle('locked', locked);
    });
  }

  // ---- VIEWPORT GLYPH WATERMARK ----
  function updateViewportGlyph() {
    const el = document.getElementById('viewport-center-glyph');
    if (!el) return;
    const cls = state.profile.radiantClass;
    if (!cls) {
      el.innerHTML = '';
      el.classList.remove('visible');
      return;
    }
    const svg = WHEEL_SVG_MAP[cls];
    // Only update img if class changed
    const existing = el.querySelector('img');
    if (!existing || existing.dataset.cls !== cls) {
      el.innerHTML = `<img src="${svg}" alt="${cls}" data-cls="${cls}" draggable="false">`;
    }
    el.classList.add('visible');
  }

  // ---- RADIANT WHEEL ----
  async function buildRadiantWheel() {
    const svgEl = document.getElementById('radiant-wheel-svg');
    const ringEl = document.getElementById('radiant-wheel-ring');
    const centerEl = document.getElementById('rw-center');
    if (!svgEl || !ringEl) return;

    svgEl.innerHTML = '';
    ringEl.innerHTML = '';

    // Pre-fetch all SVGs so coloredSvgSrc works synchronously below
    const allUrls = [...new Set([
      ...Object.values(WHEEL_SVG_MAP),
      ...WHEEL_SURGES.map(s => s.svg),
      'svg/Cosmere_symbol.svg',
    ])];
    await Promise.all(allUrls.map(fetchSvgText));

    const CX = 280, CY = 280;
    const R_ORDER = 210;
    const R_SURGE = 135;
    const N = WHEEL_ORDERS.length; // 10

    const selected = state.profile.radiantClass;
    const ns = 'http://www.w3.org/2000/svg';

    // ---- SVG connector lines + surge nodes ----
    for (let i = 0; i < N; i++) {
      const a0 = -Math.PI / 2 + (2 * Math.PI * i / N);
      const a1 = -Math.PI / 2 + (2 * Math.PI * ((i + 1) % N) / N);
      const x0 = CX + R_ORDER * Math.cos(a0);
      const y0 = CY + R_ORDER * Math.sin(a0);
      const x1 = CX + R_ORDER * Math.cos(a1);
      const y1 = CY + R_ORDER * Math.sin(a1);
      const surgeAngle = a0 + Math.PI / N;
      const sx = CX + R_SURGE * Math.cos(surgeAngle);
      const sy = CY + R_SURGE * Math.sin(surgeAngle);

      // A surge is "active" if the selected order is one of its two adjacent orders
      const surgeActive = selected &&
        (WHEEL_ORDERS[i] === selected || WHEEL_ORDERS[(i + 1) % N] === selected);

      // Color for active state: use the selected order's color
      const activeColor = selected ? (CLASS_COLORS[selected] || '#d4a853') : '#d4a853';

      // Order ring arc segment
      const seg = document.createElementNS(ns, 'line');
      seg.setAttribute('x1', x0); seg.setAttribute('y1', y0);
      seg.setAttribute('x2', x1); seg.setAttribute('y2', y1);
      seg.setAttribute('stroke', surgeActive ? activeColor : 'rgba(255,255,255,0.12)');
      seg.setAttribute('stroke-width', surgeActive ? '2' : '1');
      seg.setAttribute('opacity', surgeActive ? '0.7' : '1');
      svgEl.appendChild(seg);

      // Spoke lines: each order → its surge
      for (const { ox, oy } of [{ ox: x0, oy: y0 }, { ox: x1, oy: y1 }]) {
        const spoke = document.createElementNS(ns, 'line');
        spoke.setAttribute('x1', ox); spoke.setAttribute('y1', oy);
        spoke.setAttribute('x2', sx); spoke.setAttribute('y2', sy);
        spoke.setAttribute('stroke', surgeActive ? activeColor : 'rgba(255,255,255,0.06)');
        spoke.setAttribute('stroke-width', '1');
        spoke.setAttribute('opacity', surgeActive ? '0.5' : '1');
        svgEl.appendChild(spoke);
      }

      // Surge node (HTML)
      const surge = WHEEL_SURGES[i];
      const sNode = document.createElement('div');
      // Always render dimly; if active, use the selected order color for the icon
      const surgeIconColor = surgeActive ? activeColor : '#b0aac0';
      const surgeSrc = coloredSvgSrc(_wheelSvgCache[surge.svg] || null, surgeIconColor) || surge.svg;
      sNode.className = 'rw-surge' + (surgeActive ? ' active' : '');
      sNode.style.left = sx + 'px';
      sNode.style.top = sy + 'px';
      sNode.innerHTML = `
        <img src="${surgeSrc}" alt="${surge.name}">
        <div class="rw-surge-label" style="${surgeActive ? `color:${activeColor};opacity:1` : ''}">${surge.name}</div>
      `;
      ringEl.appendChild(sNode);
    }

    // ---- Order nodes (HTML) ----
    for (let i = 0; i < N; i++) {
      const angle = -Math.PI / 2 + (2 * Math.PI * i / N);
      const ox = CX + R_ORDER * Math.cos(angle);
      const oy = CY + R_ORDER * Math.sin(angle);
      const cls = WHEEL_ORDERS[i];
      const color = CLASS_COLORS[cls] || '#ccc';
      const unplayable = WHEEL_UNPLAYABLE.has(cls);

      const node = document.createElement('div');
      node.className = 'rw-order';
      if (unplayable) node.classList.add('unplayable');
      else if (selected === cls) node.classList.add('selected');
      else if (selected) node.classList.add('dimmed');
      node.style.left = ox + 'px';
      node.style.top = oy + 'px';
      node.style.color = color;
      node.dataset.cls = cls;

      const glyphSvgText = _wheelSvgCache[WHEEL_SVG_MAP[cls]] || null;
      const glyphSrc = coloredSvgSrc(glyphSvgText, color) || WHEEL_SVG_MAP[cls];

      node.innerHTML = `
        <div class="rw-order-glyph-wrap" style="background:${color}18;">
          <img src="${glyphSrc}" alt="${cls}">
        </div>
        <div class="rw-order-label">${cls}${unplayable ? '<br><span class="rw-not-playable">Não Jogável</span>' : ''}</div>
      `;

      if (!unplayable) {
        node.addEventListener('click', () => selectRadiantOrder(cls));
      }
      ringEl.appendChild(node);
    }

    // ---- Center symbol ----
    if (selected) {
      const color = CLASS_COLORS[selected] || '#fff';
      const glyphText = _wheelSvgCache[WHEEL_SVG_MAP[selected]] || null;
      const glyphSrc = coloredSvgSrc(glyphText, color) || WHEEL_SVG_MAP[selected];
      centerEl.classList.add('chosen');
      centerEl.innerHTML = `<img src="${glyphSrc}" alt="${selected}" style="filter:drop-shadow(0 0 14px ${color})">`;
    } else {
      const cosmereText = _wheelSvgCache['svg/Cosmere_symbol.svg'] || null;
      const cosmereSrc = coloredSvgSrc(cosmereText, '#d4a853') || 'svg/Cosmere_symbol.svg';
      centerEl.classList.remove('chosen');
      centerEl.innerHTML = `<img src="${cosmereSrc}" alt="Cosmere">`;
    }
  }

  async function showRadiantWheel() {
    if (state.profile.radiantClassLocked) {
      notify('Ordem Selada. Use Reset para alterar.');
      return;
    }
    if (state.profile.level < 2) {
      notify('Disponível a partir do Nível 2');
      return;
    }
    document.getElementById('radiant-wheel').classList.add('visible');
    // Scale container to fill ~85% of the smaller viewport dimension
    const container = document.getElementById('radiant-wheel-container');
    if (container) {
      const available = Math.min(window.innerWidth, window.innerHeight) * 0.85;
      const scale = Math.min(available / 560, 1.6); // max 1.6×
      container.style.transform = `scale(${scale})`;
    }
    await buildRadiantWheel();
  }

  function hideRadiantWheel() {
    document.getElementById('radiant-wheel').classList.remove('visible');
  }

  // async function selectRadiantOrder(cls) {
  //   state.profile.radiantClass = cls;
  //   await buildRadiantWheel(); // re-render with highlight

  //   setTimeout(() => {
  //     hideRadiantWheel();
  //     renderRadiantSection();
  //     renderClassTabs();
  //     rebuildTree();
  //   }, 420);
  // }
  async function selectRadiantOrder(cls) {
    state.profile.radiantClass = cls;
    // Ao escolher, já limpamos surtos anteriores se houver troca antes de selar
    state.radiantPericias = {}; 
    
    await buildRadiantWheel(); 

    setTimeout(() => {
      hideRadiantWheel();
      renderSidebar(); // Força a atualização de toda a barra lateral, incluindo perícias
      renderClassTabs();
      rebuildTree();
    }, 420);
  }

  function renderRadiantSection() {
    const container = document.getElementById('radiant-select');
    if (!container) return;
    const unlocked = state.profile.level >= 2;
    container.innerHTML = '';

    if (!unlocked) {
      container.innerHTML = '<div class="radiant-placeholder">Disponivel a partir do Nível 2</div>';
      renderRadiantPericias();
      updateViewportGlyph();
      return;
    }

    const cls = state.profile.radiantClass;
    const locked = state.profile.radiantClassLocked;

    if (!cls) {
      // No order chosen yet — show wheel open button
      const btn = document.createElement('button');
      btn.className = 'radiant-choose-btn';
      btn.textContent = '✦  Escolher Ordem Radiante';
      btn.addEventListener('click', showRadiantWheel);
      container.appendChild(btn);
    } else if (!locked) {
      // Chosen but not sealed — show display + alter + seal buttons
      const color = clsColor(cls);
      const div = document.createElement('div');
      div.className = 'radiant-locked-display';
      div.style.borderColor = color + '60';
      div.innerHTML = `
        <img class="radiant-locked-glyph" src="${WHEEL_SVG_MAP[cls]}" alt="${cls}">
        <div class="radiant-locked-info">
          <div class="radiant-locked-name" style="color:${color}">${cls}</div>
          <div style="display:flex;gap:6px;margin-top:5px;">
            <button class="btn" style="font-size:10px;padding:3px 8px;flex:none;" id="radiant-alter-btn">Alterar</button>
            <button class="btn primary" style="font-size:10px;padding:3px 8px;flex:none;" id="radiant-seal-btn">Selar Ordem</button>
          </div>
        </div>
      `;
      container.appendChild(div);
      div.querySelector('#radiant-alter-btn').addEventListener('click', showRadiantWheel);
      // div.querySelector('#radiant-seal-btn').addEventListener('click', () => {
      //   state.profile.radiantClassLocked = true;
      //   renderRadiantSection();
      //   notify('Ordem selada! Apenas um Reset pode desfazer.');
      // });
      div.querySelector('#radiant-seal-btn').addEventListener('click', () => {
        state.profile.radiantClassLocked = true;
        // Opcional: Aqui você pode deduzir o ponto de talento se quiser automatizar
        // state.spentTalents++; 
        renderSidebar(); // Garante que os surtos apareçam na lista agora que está selado
        notify('Ordem selada! Perícias de Fluxo desbloqueadas.');
      });
      
    } else {
      // Sealed — show lock badge, no change allowed
      const color = clsColor(cls);
      const div = document.createElement('div');
      div.className = 'radiant-locked-display';
      div.style.borderColor = color + '60';
      div.innerHTML = `
        <img class="radiant-locked-glyph" src="${WHEEL_SVG_MAP[cls]}" alt="${cls}">
        <div class="radiant-locked-info">
          <div class="radiant-locked-name" style="color:${color}">${cls}</div>
          <div class="radiant-sealed-badge">🔒 Ordem Selada</div>
        </div>
      `;
      container.appendChild(div);
    }

    renderRadiantPericias();
    updateViewportGlyph();
  }

  function renderRadiantPericias() {
    const container = document.getElementById('radiant-pericias');
    if (!container) return;
    const cls = state.profile.radiantClass;
    if (!cls) { container.innerHTML = ''; return; }

    const perKeys = CosData.RADIANT_CLASS_PERICIAS[cls] || [];
    if (perKeys.length === 0) { container.innerHTML = ''; return; }

    container.innerHTML = '<div class="surtos-label">Surtos</div>';
    const grid = document.createElement('div');
    grid.className = 'pericias-grid surtos-grid';

    // for (const key of perKeys) {
    //   const info = CosData.PERICIAS_RADIANTES[key];
    //   if (!info) continue;
    //   const val = state.radiantPericias[key] || 0;
    //   const div = document.createElement('div');
    //   div.className = 'pericia-item';
    //   div.innerHTML = `
    //     <span class="pericia-name surto-name">${info.name}</span>
    //     <div class="pericia-controls">
    //       <button class="pericia-btn" data-radper="${key}" data-dir="-1">&minus;</button>
    //       <span class="pericia-val">${val}</span>
    //       <button class="pericia-btn" data-radper="${key}" data-dir="1">+</button>
    //     </div>
    //   `;
    //   grid.appendChild(div);
    // }

    for (const key of perKeys) {
      const info = CosData.PERICIAS_RADIANTES[key];
      if (!info) continue;
      
      const rank = state.radiantPericias[key] || 0;
      const attrVal = state.attributes[info.attr] || 0;
      const total = rank + attrVal;

      const div = document.createElement('div');
      div.className = 'pericia-item';
      div.innerHTML = `
        <span class="pericia-name surto-name">
          ${info.name} <span style="font-size: 0.7em; color: var(--text-muted)">(${CosData.ATTRIBUTES[info.attr].abbr})</span>
        </span>
        <div class="pericia-controls">
          <button class="pericia-btn" data-radper="${key}" data-dir="-1" title="Diminuir Rank">&minus;</button>
          <span class="pericia-val" title="Rank: ${rank} | Atributo: ${attrVal}">${total}</span>
          <button class="pericia-btn" data-radper="${key}" data-dir="1" title="Aumentar Rank">+</button>
        </div>
      `;
      grid.appendChild(div);
    }
    container.appendChild(grid);

    container.querySelectorAll('[data-radper]').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.radper;
        const dir = parseInt(btn.dataset.dir);
        const newVal = (state.radiantPericias[key] || 0) + dir;
        const maxRank = getMaxPericiaRank();
        if (newVal < 0 || newVal > maxRank) return;
        if (dir > 0 && getPericiaPointsRemaining() <= 0) {
          notify('Sem pontos de pericia');
          return;
        }
        state.radiantPericias[key] = newVal;
        renderSidebar();
        rebuildTree(true);
      });
    });
  }

  function renderPoints() {
    const el = document.getElementById('points-bar');
    if (!el) return;
    const attrRem = getAttrPointsRemaining();
    const perRem = getPericiaPointsRemaining();
    const talRem = getTalentPointsRemaining();

    el.innerHTML = `
      <span class="point-badge ${attrRem < 0 ? 'danger' : ''}">Atrib: <span class="val">${attrRem}</span></span>
      <span class="point-badge ${perRem < 0 ? 'danger' : ''}">Pericia: <span class="val">${perRem}</span></span>
      <span class="point-badge ${talRem < 0 ? 'danger' : ''}">Talento: <span class="val">${talRem}</span></span>
    `;
  }

  function renderLevelDisplay() {
    const el = document.getElementById('level-val');
    if (el) el.textContent = state.profile.level;
    const tierEl = document.getElementById('tier-val');
    if (tierEl) {
      const tier = CosData.LEVEL_TABLE.find(r => r.level === state.profile.level)?.tier || 1;
      tierEl.textContent = tier;
    }
  }

  function renderAttributes() {
    const container = document.getElementById('attr-grid');
    if (!container) return;
    container.innerHTML = '';

    for (const [key, info] of Object.entries(CosData.ATTRIBUTES)) {
      const val = state.attributes[key];
      const div = document.createElement('div');
      div.className = 'attr-item';
      div.innerHTML = `
        <span class="attr-name">${info.abbr}</span>
        <div class="attr-controls">
          <button class="attr-btn" data-attr="${key}" data-dir="-1">&minus;</button>
          <span class="attr-val">${val}</span>
          <button class="attr-btn" data-attr="${key}" data-dir="1">+</button>
        </div>
      `;
      container.appendChild(div);
    }

    // container.querySelectorAll('.attr-btn').forEach(btn => {
    //   btn.addEventListener('click', () => {
    //     const attr = btn.dataset.attr;
    //     const dir = parseInt(btn.dataset.dir);
    //     const newVal = state.attributes[attr] + dir;
    //     if (newVal < 0) return;
    //     if (dir > 0 && getAttrPointsRemaining() <= 0) {
    //       notify('Sem pontos de atributo');
    //       return;
    //     }
    //     state.attributes[attr] = newVal;
    //     renderSidebar();
    //   });
    // });
    container.querySelectorAll('.attr-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const attr = btn.dataset.attr;
        const dir = parseInt(btn.dataset.dir);
        const newVal = state.attributes[attr] + dir;
        
        // Define o máximo permitido baseado no nível atual
        const maxVal = state.profile.level === 1 ? 3 : 5;

        if (newVal < 0) return;
        
        if (newVal > maxVal) {
          notify(`O limite máximo para atributos no Nível ${state.profile.level} é ${maxVal}.`);
          return;
        }
        
        if (dir > 0 && getAttrPointsRemaining() <= 0) {
          notify('Sem pontos de atributo disponíveis');
          return;
        }
        
        state.attributes[attr] = newVal;
        renderSidebar();
      });
    });
  }

  function renderDefenses() {
    const d = getDefenses();
    const el = document.getElementById('defenses');
    if (!el) return;
    el.innerHTML = `
      <div class="defense-item">
        <div class="defense-label">Fisica</div>
        <div class="defense-val physical">${d.physical}</div>
      </div>
      <div class="defense-item">
        <div class="defense-label">Cognitiva</div>
        <div class="defense-val cognitive">${d.cognitive}</div>
      </div>
      <div class="defense-item">
        <div class="defense-label">Espiritual</div>
        <div class="defense-val spiritual">${d.spiritual}</div>
      </div>
    `;
  }

  // function renderPericias() {
  //   const container = document.getElementById('pericias-grid');
  //   if (!container) return;
  //   container.innerHTML = '';

  //   // for (const [key, info] of Object.entries(CosData.PERICIAS)) {
  //   //   const val = state.pericias[key];
  //   //   const div = document.createElement('div');
  //   //   div.className = 'pericia-item';
  //   //   div.innerHTML = `
  //   //     <span class="pericia-name" title="${info.en}">${info.name}</span>
  //   //     <div class="pericia-controls">
  //   //       <button class="pericia-btn" data-per="${key}" data-dir="-1">&minus;</button>
  //   //       <span class="pericia-val">${val}</span>
  //   //       <button class="pericia-btn" data-per="${key}" data-dir="1">+</button>
  //   //     </div>
  //   //   `;
  //   //   container.appendChild(div);
  //   // }
  //   for (const [key, info] of Object.entries(CosData.PERICIAS)) {
  //     const rank = state.pericias[key] || 0;
  //     const attrVal = state.attributes[info.attr] || 0;
  //     const total = rank + attrVal; // Soma o Rank com o Atributo Base

  //     const div = document.createElement('div');
  //     div.className = 'pericia-item';
  //     div.innerHTML = `
  //       <span class="pericia-name" title="${info.en}">
  //         ${info.name} <span style="font-size: 0.7em; color: var(--text-muted)">(${CosData.ATTRIBUTES[info.attr].abbr})</span>
  //       </span>
  //       <div class="pericia-controls">
  //         <button class="pericia-btn" data-per="${key}" data-dir="-1" title="Diminuir Rank">&minus;</button>
  //         <span class="pericia-val" title="Rank: ${rank} | Atributo: ${attrVal}">${total}</span>
  //         <button class="pericia-btn" data-per="${key}" data-dir="1" title="Aumentar Rank">+</button>
  //       </div>
  //     `;
  //     container.appendChild(div);
  //   }

  //   container.querySelectorAll('.pericia-btn').forEach(btn => {
  //     btn.addEventListener('click', () => {
  //       const per = btn.dataset.per;
  //       const dir = parseInt(btn.dataset.dir);
  //       const newVal = state.pericias[per] + dir;
  //       const maxRank = getMaxPericiaRank();
  //       if (newVal < 0 || newVal > maxRank) return;
  //       if (dir > 0 && getPericiaPointsRemaining() <= 0) {
  //         notify('Sem pontos de pericia');
  //         return;
  //       }
  //       state.pericias[per] = newVal;
  //       renderSidebar();
  //       // Rebuild tree keeping view
  //       rebuildTree(true);
  //     });
  //   });
  // }

  // function renderPericias() {
  //   const container = document.getElementById('pericias-grid');
  //   if (!container) return;
  //   container.innerHTML = '';

  //   // 1. Perícias Base
  //   for (const [key, info] of Object.entries(CosData.PERICIAS)) {
  //     const rank = state.pericias[key] || 0;
  //     const attrVal = state.attributes[info.attr] || 0;
  //     const total = rank + attrVal;

  //     const div = document.createElement('div');
  //     div.className = 'pericia-item';
  //     div.innerHTML = `
  //       <span class="pericia-name" title="${info.en}">
  //         ${info.name} <span style="font-size: 0.7em; color: var(--text-muted)">(${CosData.ATTRIBUTES[info.attr].abbr})</span>
  //       </span>
  //       <div class="pericia-controls">
  //         <button class="pericia-btn" data-per="${key}" data-dir="-1" title="Diminuir Rank">&minus;</button>
  //         <span class="pericia-val" title="Rank: ${rank} | Atributo: ${attrVal}">${total}</span>
  //         <button class="pericia-btn" data-per="${key}" data-dir="1" title="Aumentar Rank">+</button>
  //       </div>
  //     `;
  //     container.appendChild(div);
  //   }

  //   // 2. Perícias Radiantes (Junto na lista)
  //   const cls = state.profile.radiantClass;
  //   if (cls) {
  //     const perKeys = CosData.RADIANT_CLASS_PERICIAS[cls] || [];
  //     if (perKeys.length > 0) {
  //       const sep = document.createElement('div');
  //       sep.style.gridColumn = '1 / -1';
  //       sep.style.marginTop = '8px';
  //       sep.style.paddingTop = '8px';
  //       sep.style.borderTop = '1px solid rgba(255,255,255,0.1)';
  //       sep.style.color = clsColor(cls);
  //       sep.style.fontSize = '0.75em';
  //       sep.style.textTransform = 'uppercase';
  //       sep.style.letterSpacing = '1px';
  //       sep.textContent = 'Surtos Radiantes';
  //       container.appendChild(sep);

  //       for (const key of perKeys) {
  //         const info = CosData.PERICIAS_RADIANTES[key];
  //         if (!info) continue;
          
  //         const rank = state.radiantPericias[key] || 0;
  //         const attrVal = state.attributes[info.attr] || 0;
  //         const total = rank + attrVal;

  //         const div = document.createElement('div');
  //         div.className = 'pericia-item';
  //         div.innerHTML = `
  //           <span class="pericia-name surto-name" style="color: ${clsColor(cls)};">
  //             ${info.name} <span style="font-size: 0.7em; color: var(--text-muted)">(${CosData.ATTRIBUTES[info.attr].abbr})</span>
  //           </span>
  //           <div class="pericia-controls">
  //             <button class="pericia-btn rad" data-radper="${key}" data-dir="-1" title="Diminuir Rank">&minus;</button>
  //             <span class="pericia-val" title="Rank: ${rank} | Atributo: ${attrVal}">${total}</span>
  //             <button class="pericia-btn rad" data-radper="${key}" data-dir="1" title="Aumentar Rank">+</button>
  //           </div>
  //         `;
  //         container.appendChild(div);
  //       }
  //     }
  //   }

  //   // Eventos Perícias Normais
  //   container.querySelectorAll('.pericia-btn:not(.rad)').forEach(btn => {
  //     btn.addEventListener('click', () => {
  //       const per = btn.dataset.per;
  //       const dir = parseInt(btn.dataset.dir);
  //       const newVal = state.pericias[per] + dir;
  //       const maxRank = getMaxPericiaRank();
  //       if (newVal < 0 || newVal > maxRank) return;
  //       if (dir > 0 && getPericiaPointsRemaining() <= 0) {
  //         notify('Sem pontos de pericia');
  //         return;
  //       }
  //       state.pericias[per] = newVal;
  //       renderSidebar();
  //       rebuildTree(true);
  //     });
  //   });

  //   // Eventos Perícias Radiantes
  //   container.querySelectorAll('.pericia-btn.rad').forEach(btn => {
  //     btn.addEventListener('click', () => {
  //       const key = btn.dataset.radper;
  //       const dir = parseInt(btn.dataset.dir);
  //       const newVal = (state.radiantPericias[key] || 0) + dir;
  //       const maxRank = getMaxPericiaRank();
  //       if (newVal < 0 || newVal > maxRank) return;
  //       if (dir > 0 && getPericiaPointsRemaining() <= 0) {
  //         notify('Sem pontos de pericia');
  //         return;
  //       }
  //       state.radiantPericias[key] = newVal;
  //       renderSidebar();
  //       rebuildTree(true);
  //     });
  //   });
  // }
  function renderPericias() {
    const container = document.getElementById('pericias-grid');
    if (!container) return;
    container.innerHTML = '';

    const maxRank = getMaxPericiaRank();

    // Helper para criar as 5 esferas
    const createSpheres = (currentRank, key, isRadiant = false) => {
      let spheresHtml = '<div class="sphere-track">';
      for (let i = 1; i <= 5; i++) {
        const isActive = i <= currentRank;
        const isLocked = i > maxRank;
        spheresHtml += `
          <div class="sphere-btn ${isActive ? 'active' : ''} ${isLocked ? 'locked' : ''}" 
               data-idx="${i}" 
               data-key="${key}" 
               data-rad="${isRadiant}"
               title="${isLocked ? 'Bloqueado por Nível' : 'Rank ' + i}">
          </div>`;
      }
      spheresHtml += '</div>';
      return spheresHtml;
    };

    // 1. Perícias Base
    for (const [key, info] of Object.entries(CosData.PERICIAS)) {
      const rank = state.pericias[key] || 0;
      const attrVal = state.attributes[info.attr] || 0;
      const total = rank + attrVal;

      const div = document.createElement('div');
      div.className = 'pericia-item';
      div.innerHTML = `
        <span class="pericia-name">
          ${info.name} <small style="opacity:0.5">(${CosData.ATTRIBUTES[info.attr].abbr})</small>
        </span>
        <div class="pericia-controls-new">
          ${createSpheres(rank, key)}
          <span class="pericia-total-val">${total}</span>
        </div>
      `;
      container.appendChild(div);
    }

    // 2. Surtos (Só aparecem se uma ordem estiver selecionada ou selada)
    const cls = state.profile.radiantClass;
    if (cls) {
      const perKeys = CosData.RADIANT_CLASS_PERICIAS[cls] || [];
      const sep = document.createElement('div');
      sep.className = 'pericia-separator';
      sep.style = `grid-column: 1/-1; margin: 10px 0 5px; font-size: 10px; color: ${clsColor(cls)}; border-bottom: 1px solid ${clsColor(cls)}44; text-transform: uppercase;`;
      sep.textContent = `Surtos de ${cls}`;
      container.appendChild(sep);

      for (const key of perKeys) {
        const info = CosData.PERICIAS_RADIANTES[key];
        const rank = state.radiantPericias[key] || 0;
        const attrVal = state.attributes[info.attr] || 0;
        const total = rank + attrVal;

        const div = document.createElement('div');
        div.className = 'pericia-item';
        div.innerHTML = `
          <span class="pericia-name" style="color:${clsColor(cls)}">${info.name}</span>
          <div class="pericia-controls-new">
            ${createSpheres(rank, key, true)}
            <span class="pericia-total-val">${total}</span>
          </div>
        `;
        container.appendChild(div);
      }
    }

    // Eventos de clique nas esferas
    container.querySelectorAll('.sphere-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx);
        const key = btn.dataset.key;
        const isRadiant = btn.dataset.rad === 'true';
        
        if (idx > maxRank) {
          notify(`Nível insuficiente para Rank ${idx}`);
          return;
        }

        const currentVal = isRadiant ? (state.radiantPericias[key] || 0) : (state.pericias[key] || 0);
        // Se clicar na esfera que já é o rank atual, ele "desupa" para o rank anterior
        const newVal = (currentVal === idx) ? idx - 1 : idx;

        // Cálculo de custo (diferença de pontos)
        const cost = newVal - currentVal;
        if (cost > 0 && getPericiaPointsRemaining() < cost) {
          notify('Sem pontos de perícia disponíveis');
          return;
        }

        if (isRadiant) state.radiantPericias[key] = newVal;
        else state.pericias[key] = newVal;

        renderSidebar();
        rebuildTree(true);
      });
    });
  }

  // Substitua o renderRadiantPericias por uma função vazia para não quebrar outras chamadas
  function renderRadiantPericias() { 
      // Obsoleto: os surtos agora são renderizados junto com as perícias em renderPericias()
  }

  function renderClassTabs() {
    const container = document.getElementById('class-tabs');
    if (!container) return;
    container.innerHTML = '';

    // "Todas" tab
    const allBtn = document.createElement('button');
    allBtn.className = 'class-tab tab-all' + (state.activeClass === '_all' ? ' active' : '');
    allBtn.textContent = 'Todas';
    allBtn.style.borderBottomColor = state.activeClass === '_all' ? 'var(--accent-gold)' : 'transparent';
    allBtn.addEventListener('click', () => {
      if (state.activeClass === '_all') return;
      state.activeClass = '_all';
      renderClassTabs();
      triggerTabSlide(() => rebuildTree());
    });
    container.appendChild(allBtn);

    // Separator
    const sep = document.createElement('span');
    sep.className = 'tab-separator';
    container.appendChild(sep);

    for (const cls of CosData.CLASSES) {
      const btn = document.createElement('button');
      btn.className = 'class-tab' + (cls === state.activeClass ? ' active' : '');
      btn.textContent = cls;
      btn.style.borderBottomColor = cls === state.activeClass ? `var(--color-${cls})` : 'transparent';
      btn.addEventListener('click', () => {
        if (state.activeClass === cls) return;
        state.activeClass = cls;
        renderClassTabs();
        triggerTabSlide(() => rebuildTree());
      });
      container.appendChild(btn);
    }

    // Radiant tabs (only if a class is chosen and level >= 2)
    if (state.profile.radiantClass && state.profile.level >= 2) {
      const rsep = document.createElement('span');
      rsep.className = 'tab-separator tab-separator-radiant';
      container.appendChild(rsep);

      const rcls = state.profile.radiantClass;
      const rbtn = document.createElement('button');
      rbtn.className = 'class-tab tab-radiant' + (rcls === state.activeClass ? ' active' : '');
      rbtn.textContent = rcls;
      const rColor = clsColor(rcls);
      rbtn.style.borderBottomColor = rcls === state.activeClass ? rColor : 'transparent';
      rbtn.style.color = rcls === state.activeClass ? rColor : '';
      rbtn.addEventListener('click', () => {
        if (state.activeClass === rcls) return;
        state.activeClass = rcls;
        renderClassTabs();
        triggerTabSlide(() => rebuildTree());
      });
      container.appendChild(rbtn);
    }
  }

  // ---- TOOLTIP (hover only) ----
  function showTooltip(skill, event) {
    const tt = document.getElementById('tooltip');
    if (!tt) return;

    const rad = isRadiantSkill(skill);
    const check = rad ? canUnlockRadiantSkill(skill) : canUnlockSkill(skill);
    const isUnlocked = state.unlockedSkills.has(skill.id);

    const statusText = isUnlocked ? '<span style="color:var(--accent-green)">Desbloqueado</span>' :
                        check.can ? '<span style="color:var(--accent-gold)">Disponivel</span>' :
                                    '<span style="color:var(--text-muted)">Bloqueado</span>';

    // Build prerequisites lines
    let reqLines = '';
    if (skill.reqStat === 'level' && skill.reqVal > 0) {
      const met = state.profile.level >= skill.reqVal;
      reqLines += `<div class="tt-req ${met ? 'met' : 'unmet'}">Nível ${skill.reqVal} (${state.profile.level})</div>`;
    } else if (Array.isArray(skill.reqStat)) {
      for (let i = 0; i < skill.reqStat.length; i++) {
        const sName = skill.reqStat[i];
        const sVal  = Array.isArray(skill.reqVal) ? skill.reqVal[i] : skill.reqVal;
        const key   = sName.toLowerCase();
        const curVal = state.radiantPericias[key] || 0;
        const met   = curVal >= sVal;
        const pInfo = CosData.PERICIAS_RADIANTES[key];
        const pName = pInfo ? pInfo.name : sName;
        reqLines += `<div class="tt-req ${met ? 'met' : 'unmet'}">${pName} +${sVal} (${curVal})</div>`;
      }
    } else if (skill.reqStat && skill.reqVal > 0) {
      const pKey = CosData.statToPericia(skill.reqStat);
      const curVal = pKey ? (state.pericias[pKey] || 0) : 0;
      const met = curVal >= skill.reqVal;
      const pName = pKey ? CosData.PERICIAS[pKey].name : skill.reqStat;
      reqLines += `<div class="tt-req ${met ? 'met' : 'unmet'}">${pName} +${skill.reqVal} (${curVal})</div>`;
    }
    if (skill.deps.length > 0) {
      const findFn = rad ? CosData.findRadiantSkillByName : CosData.findSkillByName;
      for (const dep of skill.deps) {
        const depSkill = findFn(dep, skill.cls);
        const met = depSkill && state.unlockedSkills.has(depSkill.id);
        reqLines += `<div class="tt-req ${met ? 'met' : 'unmet'}">Requer: ${dep}</div>`;
      }
    }
    if (skill.prereqText) {
      reqLines += `<div class="tt-req special">${skill.prereqText}</div>`;
    }

    tt.innerHTML = `
      <div class="tt-name" style="color: ${clsColor(skill.cls)}">${skill.name}</div>
      <div class="tt-sub">${skill.cls}${skill.sub !== '-' ? ' -- ' + skill.sub : ''} ${statusText}</div>
      <div class="tt-rank">Rank ${skill.rank}</div>
      ${reqLines ? '<div class="tt-reqs">' + reqLines + '</div>' : ''}
      <div class="tt-hint">Clique para detalhes</div>
    `;

    const x = event ? event.clientX + 16 : 400;
    const y = event ? event.clientY + 16 : 300;
    tt.style.left = x + 'px';
    tt.style.top = y + 'px';
    tt.classList.add('visible');

    requestAnimationFrame(() => {
      const ttRect = tt.getBoundingClientRect();
      if (ttRect.right > window.innerWidth) {
        tt.style.left = (x - ttRect.width - 32) + 'px';
      }
      if (ttRect.bottom > window.innerHeight) {
        tt.style.top = (y - ttRect.height - 32) + 'px';
      }
    });
  }

  function hideTooltip() {
    const tt = document.getElementById('tooltip');
    if (tt) tt.classList.remove('visible');
  }

  // ---- TAB SLIDE TRANSITION ----
  const SLIDE_MS = 160;

  function triggerTabSlide(callback) {
    const flash = document.getElementById('viewport-flash');
    if (!flash) { callback(); return; }

    // 1. Position off-screen right instantly
    flash.style.transition = 'none';
    flash.style.transform = 'translateX(100%)';
    void flash.offsetWidth; // force reflow

    // 2. Slide in (cover viewport)
    flash.style.transition = `transform ${SLIDE_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`;
    flash.style.transform = 'translateX(0)';

    setTimeout(() => {
      // 3. Swap content while covered
      callback();

      // 4. Slide out to left (reveal new tree)
      flash.style.transition = `transform ${SLIDE_MS}ms cubic-bezier(0.4, 0, 1, 1)`;
      flash.style.transform = 'translateX(-100%)';

      setTimeout(() => {
        // 5. Reset silently to off-screen right for next use
        flash.style.transition = 'none';
        flash.style.transform = 'translateX(100%)';
      }, SLIDE_MS + 20);

    }, SLIDE_MS);
  }

  // ---- NOTIFICATIONS ----
  function notify(msg) {
    let el = document.querySelector('.notification');
    if (!el) {
      el = document.createElement('div');
      el.className = 'notification';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('show'), 2500);
  }

  // ---- TREE REBUILD ----
  // keepView=false by default (recenters), keepView=true preserves pan/zoom
  const CLASS_COLORS = {
    // Classes base
    'Agente': '#4ade80', 'Emissário': '#facc15', 'Caçador': '#f87171',
    'Líder': '#60a5fa', 'Erudito': '#a78bfa', 'Guerreiro': '#fb923c',
    // Ordens Radiantes
    'Corredor dos Ventos':       '#38bdf8',
    'Rompe-Céu':                 '#fbbf24',
    'Pulverizador':              '#ef4444',
    'Dançarino dos Precipícios': '#34d399',
    'Sentinela da Verdade':      '#2dd4bf',
    'Teceluz':                   '#f0abfc',
    'Alternauta':                '#e2e8f0',
    'Plasmador':                 '#c084fc',
    'Guardião das Pedras':       '#a87d4e',
    'Vinculadores':              '#d4a853',
  };

  function clsColor(cls) {
    return CLASS_COLORS[cls] || 'var(--text-primary)';
  }

  function isRadiantSkill(skill) {
    return CosData.RADIANT_CLASSES.includes(skill.cls);
  }

  function canUnlockRadiantSkill(skill) {
    if (state.unlockedSkills.has(skill.id)) return { can: false, reason: 'Ja desbloqueado' };
    if (getTalentPointsRemaining() <= 0) return { can: false, reason: 'Sem pontos de talento' };

    // Level requirement
    if (skill.reqStat === 'level' && skill.reqVal > 0) {
      if (state.profile.level < skill.reqVal) {
        return { can: false, reason: `Requer Nível ${skill.reqVal} (atual: ${state.profile.level})` };
      }
    }

    // Array reqStat: radiant surge requirements e.g. ["Transformacao", "Transporte"]
    if (Array.isArray(skill.reqStat)) {
      for (let i = 0; i < skill.reqStat.length; i++) {
        const sName = skill.reqStat[i];
        const sVal  = Array.isArray(skill.reqVal) ? skill.reqVal[i] : skill.reqVal;
        const key   = sName.toLowerCase();
        const curVal = state.radiantPericias[key] || 0;
        if (curVal < sVal) {
          const pInfo = CosData.PERICIAS_RADIANTES[key];
          const pName = pInfo ? pInfo.name : sName;
          return { can: false, reason: `Requer ${pName} +${sVal} (atual: ${curVal})` };
        }
      }
    } else if (skill.reqStat && skill.reqStat !== 'level' && skill.reqVal > 0) {
      // Single pericia reqStat (not level)
      const key = skill.reqStat.toLowerCase();
      const curVal = state.radiantPericias[key] || state.pericias[CosData.statToPericia(skill.reqStat)] || 0;
      if (curVal < skill.reqVal) {
        const pInfo = CosData.PERICIAS_RADIANTES[key];
        const pName = pInfo ? pInfo.name : skill.reqStat;
        return { can: false, reason: `Requer ${pName} +${skill.reqVal} (atual: ${curVal})` };
      }
    }

    if (skill.rank === 0) return { can: true, reason: '' };

    if (skill.deps.length > 0) {
      const anyDepMet = skill.deps.some(depName => {
        const dep = CosData.findRadiantSkillByName(depName, skill.cls);
        return dep && state.unlockedSkills.has(dep.id);
      });
      if (!anyDepMet) return { can: false, reason: 'Pre-requisito nao atendido' };
    }

    const root = CosData.getRootRadiantSkill(skill.cls);
    if (root && !state.unlockedSkills.has(root.id)) {
      return { can: false, reason: `Requer: ${root.name}` };
    }

    return { can: true, reason: '' };
  }

  function canUnlockCheck(skill) {
    if (isRadiantSkill(skill)) return canUnlockRadiantSkill(skill).can;
    return canUnlockSkill(skill).can;
  }

  function rebuildTree(keepView) {
    if (state.activeClass === '_all') {
      if (keepView && SkillRenderer.getViewMode() === 'all') {
        SkillRenderer.updateStates(state.unlockedSkills, state.pericias, canUnlockCheck);
        return;
      }
      SkillRenderer.buildAllTrees(state.unlockedSkills, state.pericias, canUnlockCheck, state.profile.radiantClass);
    } else {
      SkillRenderer.buildTree(state.activeClass, state.unlockedSkills, state.pericias, !!keepView, canUnlockCheck);
    }
  }

  // ---- SAVE / LOAD ----
  function saveProfile() {
    const data = {
      profile: state.profile,
      attributes: state.attributes,
      attrHistory: state.attrHistory,
      pericias: state.pericias,
      radiantPericias: state.radiantPericias,
      unlockedSkills: [...state.unlockedSkills],
      freeUnlockedSkills: [...state.freeUnlockedSkills],
      spentTalents: state.spentTalents,
      activeClass: state.activeClass,
    };
    localStorage.setItem('cosmere_rpg_profile', JSON.stringify(data));
    notify('Perfil salvo!');
  }

  function loadProfile() {
    const raw = localStorage.getItem('cosmere_rpg_profile');
    if (!raw) { notify('Nenhum perfil salvo encontrado'); return; }
    try {
      const data = JSON.parse(raw);
      state.profile = { ...state.profile, radiantClassLocked: false, ...data.profile };
      state.attributes = { ...state.attributes, ...data.attributes };
      state.attrHistory = data.attrHistory || {};
      state.pericias = { ...state.pericias, ...data.pericias };
      state.radiantPericias = { ...state.radiantPericias, ...data.radiantPericias };
      state.unlockedSkills = new Set(data.unlockedSkills || []);
      state.freeUnlockedSkills = new Set(data.freeUnlockedSkills || []);
      state.spentTalents = data.spentTalents || 0;
      state.activeClass = data.activeClass || 'Agente';

      document.getElementById('char-name').value = state.profile.name;
      document.querySelectorAll('.race-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.race === state.profile.race);
      });
      renderSidebar();
      renderClassTabs();
      rebuildTree();
      notify('Perfil carregado!');
    } catch (e) {
      notify('Erro ao carregar perfil');
    }
  }

  function resetProfile() {
    state.profile = { name: '', race: 'human', level: 1, radiantClass: null, radiantClassLocked: false };
    state.attributes = { forca:0, velocidade:0, intelecto:0, vontade:0, consciencia:0, presenca:0 };
    state.attrHistory = {};
    initPericias();
    state.unlockedSkills = new Set();
    state.freeUnlockedSkills = new Set();
    state.spentTalents = 0;

    document.getElementById('char-name').value = '';
    document.querySelectorAll('.race-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.race === 'human');
    });

    renderSidebar();
    rebuildTree();
    notify('Perfil resetado');
  }

  // ---- EXPORT / IMPORT (JSON FILE) ----
  function exportProfile() {
    const data = {
      profile: state.profile,
      attributes: state.attributes,
      pericias: state.pericias,
      radiantPericias: state.radiantPericias,
      unlockedSkills: [...state.unlockedSkills],
      freeUnlockedSkills: [...state.freeUnlockedSkills],
      spentTalents: state.spentTalents,
      activeClass: state.activeClass,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `cosmere_${state.profile.name || 'personagem'}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    notify('Perfil exportado!');
  }

  function importProfile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        try {
          const data = JSON.parse(ev.target.result);
          state.profile = { ...state.profile, radiantClassLocked: false, ...data.profile };
          state.attributes = { ...state.attributes, ...data.attributes };
          state.pericias = { ...state.pericias, ...data.pericias };
          state.radiantPericias = { ...state.radiantPericias, ...data.radiantPericias };
          state.unlockedSkills = new Set(data.unlockedSkills || []);
          state.freeUnlockedSkills = new Set(data.freeUnlockedSkills || []);
          state.spentTalents = data.spentTalents || 0;
          state.activeClass = data.activeClass || '_all';

          document.getElementById('char-name').value = state.profile.name;
          document.querySelectorAll('.race-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.race === state.profile.race);
          });
          renderSidebar();
          renderClassTabs();
          rebuildTree();
          notify('Perfil importado!');
        } catch (err) {
          notify('Arquivo invalido');
        }
      };
      reader.readAsText(file);
    });
    input.click();
  }

  // ---- INIT (async - waits for skills JSON) ----
  async function init() {
    await CosData.loadSkills();
    await CosData.loadRadiantSkills();
    preloadWheelSvgs(); // fire-and-forget — wheel opens instantly later

    initPericias();

    // Initialize 3D renderer
    const viewport = document.getElementById('viewport');
    SkillRenderer.init(viewport);

    // Callbacks: hover shows tooltip, click opens modal
    SkillRenderer.setCallbacks(
      (skill, intersect) => {
        showTooltip(skill, window._lastMouseEvent);
      },
      (skill, event) => {
        hideTooltip();
        showSkillModal(skill);
      },
      () => hideTooltip()
    );

    // Track mouse for tooltip positioning
    document.addEventListener('mousemove', e => { window._lastMouseEvent = e; });

    // Bind UI
    bindUI();

    // Initial render
    renderSidebar();
    renderClassTabs();

    rebuildTree();

    // Hide loading
    setTimeout(() => {
      const loading = document.getElementById('loading');
      if (loading) {
        loading.classList.add('fade-out');
        setTimeout(() => loading.remove(), 600);
      }
    }, 800);
  }

  function bindUI() {
    const nameInput = document.getElementById('char-name');
    if (nameInput) {
      nameInput.addEventListener('input', e => { state.profile.name = e.target.value; });
    }

    document.querySelectorAll('.race-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (state.profile.level !== 1) {
          notify('Ancestralidade so pode ser alterada no nivel 1');
          return;
        }
        state.profile.race = btn.dataset.race;
        document.querySelectorAll('.race-btn').forEach(b => b.classList.toggle('active', b === btn));
        renderSidebar();
        rebuildTree(true);
      });
    });

    function toggleSidebar() {
      document.getElementById('sidebar').classList.toggle('closed');
      document.getElementById('viewport').classList.toggle('expanded');
      document.body.classList.toggle('sidebar-closed');
      setTimeout(() => window.dispatchEvent(new Event('resize')), 310);
    }

    document.getElementById('sidebar-toggle')?.addEventListener('click', toggleSidebar);
    document.getElementById('sidebar-reopen')?.addEventListener('click', toggleSidebar);

    // document.getElementById('lvl-up')?.addEventListener('click', () => {
    //   if (state.profile.level < 30) {
    //     state.profile.level++;
    //     renderSidebar();
    //     rebuildTree(true);
    //   }
    // });
    // document.getElementById('lvl-down')?.addEventListener('click', () => {
    //   if (state.profile.level > 1) {
    //     state.profile.level--;
    //     renderSidebar();
    //     rebuildTree(true);
    //   }
    // });
    document.getElementById('lvl-up')?.addEventListener('click', () => {
      // Bloqueia qualquer up se houver pontos pendentes
      if (getAttrPointsRemaining() > 0) {
        notify('Gaste todos os seus pontos de atributo disponíveis antes de subir de nível!');
        return;
      }
      
      // Opcional, mas trava o jogador de esquecer as perícias também
      if (getPericiaPointsRemaining() > 0) {
        notify('Gaste todos os seus pontos de perícia disponíveis antes de subir de nível!');
        return;
      }

      // 📸 Salva a fotografia dos atributos exatos neste nível
      state.attrHistory[state.profile.level] = { ...state.attributes };

      if (state.profile.level < 30) {
        state.profile.level++;
        renderSidebar();
        rebuildTree(true);
      }
    });

    document.getElementById('lvl-down')?.addEventListener('click', () => {
      if (state.profile.level > 1) {
        const prevLevel = state.profile.level - 1;
        state.profile.level = prevLevel;
        
        // ⏪ Restaura os atributos exatos do nível anterior (devolve os pontos)
        if (state.attrHistory[prevLevel]) {
          state.attributes = { ...state.attrHistory[prevLevel] };
        }
        
        renderSidebar();
        rebuildTree(true);
      }
    });

    document.getElementById('btn-save')?.addEventListener('click', saveProfile);
    document.getElementById('btn-load')?.addEventListener('click', loadProfile);
    document.getElementById('btn-reset')?.addEventListener('click', resetProfile);
    document.getElementById('btn-export')?.addEventListener('click', exportProfile);
    document.getElementById('btn-import')?.addEventListener('click', importProfile);

    // Radiant wheel close button + backdrop (Escape key)
    document.getElementById('radiant-wheel-close')?.addEventListener('click', hideRadiantWheel);
    document.getElementById('radiant-wheel')?.addEventListener('click', e => {
      if (e.target === document.getElementById('radiant-wheel')) hideRadiantWheel();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && document.getElementById('radiant-wheel')?.classList.contains('visible')) {
        hideRadiantWheel();
      }
    });
  }

  // ---- PDF SHEET EXPORT ----
  async function exportToSheet() {
    console.log('[Sheet] Iniciando exportação...');

    if (typeof PDFLib === 'undefined') {
      console.error('[Sheet] PDFLib não carregado!');
      alert('pdf-lib não carregado. Abra o site via servidor local (start.bat), não direto pelo arquivo.');
      return;
    }
    console.log('[Sheet] PDFLib OK');

    notify('Gerando ficha...');

    try {
      const { PDFDocument } = PDFLib;

      console.log('[Sheet] Fazendo fetch do PDF...');
      const response = await fetch('sheets/br_sheet.pdf');
      console.log('[Sheet] Fetch status:', response.status, response.ok);
      if (!response.ok) throw new Error(`Falha ao carregar PDF base (status ${response.status}). Abra via start.bat`);
      const pdfBytes = await response.arrayBuffer();
      console.log('[Sheet] PDF carregado:', pdfBytes.byteLength, 'bytes');
      const pdfDoc = await PDFDocument.load(pdfBytes);
      console.log('[Sheet] PDFDocument criado');
      const form = pdfDoc.getForm();

      function setField(name, value, fontSize = null) {
        try { 
          const field = form.getTextField(name);
          field.setText(value != null ? String(value) : ''); 
          if (fontSize !== null) {
            field.setFontSize(fontSize); // Trava o tamanho da fonte se o parâmetro for passado
          }
        } catch(e) {}
      }

      function setCheck(name, checked) {
        try {
          const cb = form.getCheckBox(name);
          checked ? cb.check() : cb.uncheck();
        } catch(e) {}
      }

      const a = state.attributes;
      const p = state.profile;
      const defenses = {
        physical:  10 + a.forca + a.velocidade,
        cognitive: 10 + a.intelecto + a.vontade,
        spiritual: 10 + a.consciencia + a.presenca,
      };

      // Identificação (campos duplicados em página 1 e 2)
      const forBothPages = (baseName, value) => {
        setField(`${baseName}.Page 1`, value);
        setField(`${baseName}.Page 2`, value);
      };
      forBothPages('Character Name', p.name || '');
      forBothPages('Level', String(p.level));
      forBothPages('Ancestry', p.race === 'human' ? 'Humano' : 'Cantor');

      const allExportSkills = [...CosData.SKILLS, ...CosData.RADIANT_SKILLS];
      
      // 1. Descobre todos os talentos que o jogador comprou
      const unlockedData = [...state.unlockedSkills]
        .map(id => allExportSkills.find(sk => sk.id === id))
        .filter(Boolean);
      
      // 2. Extrai apenas o nome das classes base (Agente, Caçador, etc.) ignorando repetições e radiantes
      const baseClasses = [...new Set(unlockedData.map(s => s.cls))]
        .filter(c => CosData.CLASSES.includes(c));
      
      // 3. Junta as classes base com ";"
      let pathsStr = baseClasses.join('; ');
      
      // 4. Adiciona a Ordem Radiante no final (se ele tiver uma)
      if (p.radiantClass) {
        pathsStr += (pathsStr ? '; ' : '') + p.radiantClass;
      }
      
      forBothPages('Paths', pathsStr);

      // Atributos (duplicados em ambas as páginas)
      forBothPages('Strength',  '   '+String(a.forca)      );
      forBothPages('Speed',     '   '+String(a.velocidade) );
      forBothPages('Intellect', '   '+String(a.intelecto)  );
      forBothPages('Willpower', '   '+String(a.vontade)    );
      forBothPages('Awareness', '   '+String(a.consciencia));
      forBothPages('Presence',  '   '+String(a.presenca)   );

      // Defesas (duplicadas em ambas as páginas)
      forBothPages('Physical Defense',  String(defenses.physical));
      forBothPages('Cognitive Defense', String(defenses.cognitive));
      forBothPages('Spiritual Defense', String(defenses.spiritual));

      // Perícias – campos de pontuação (rank numérico)
      const SKILL_SCORE_FIELDS = {
        agilidade:       'Agility',
        atletismo:       'Athletics',
        armamentoPesado: 'Heavy Weapons',
        armamentoLeve:   'Light Weapons',
        furtividade:     'Stealth',
        ladroagem:       'Thievery',
        manufatura:      'Crafting',
        deducao:         'Deduction',
        disciplina:      'Discipline',
        intimidacao:     'Intimidation',
        saber:           'Lore',
        medicina:        'Medicine',
        dissimulacao:    'Deception',
        intuicao:        'Insight',
        lideranca:       'Leadership',
        percepcao:       'Perception',
        persuasao:       'Persuasion',
        sobrevivencia:   'Survival',
      };

      for (const [key, fieldName] of Object.entries(SKILL_SCORE_FIELDS)) {
        // Pega o valor alocado (rank) na perícia
        const rank = state.pericias[key] || 0;
        
        // Pega o nome do atributo correspondente a esta perícia no CosData
        const attrKey = CosData.PERICIAS[key] ? CosData.PERICIAS[key].attr : null;
        
        // Pega o valor que o jogador tem no atributo (ex: Força, Velocidade...)
        const attrBonus = attrKey ? (state.attributes[attrKey] || 0) : 0;
        
        // O valor final na ficha é a soma
        const totalBonus = rank + attrBonus;

        // Preenche o campo da ficha (apenas se for maior que zero para manter limpo)
        setField(fieldName, String(totalBonus));
      }


      // Perícias – círculos de rank (checkboxes), ordenados esq→dir (rank 1 = 1º)
      const SKILL_RANK_BOXES = {
        // Coluna esquerda (Físico)
        agilidade:       [7, 10, 6, 9, 8],
        atletismo:       [12, 15, 11, 14, 13],
        armamentoPesado: [17, 20, 16, 19, 18],
        armamentoLeve:   [22, 25, 21, 24, 23],
        furtividade:     [27, 30, 26, 29, 28],
        ladroagem:       [32, 35, 31, 34, 33],
        // Coluna central (Cognitivo)
        manufatura:      [42, 45, 41, 44, 43],
        deducao:         [47, 50, 46, 49, 48],
        disciplina:      [52, 55, 51, 54, 53],
        intimidacao:     [57, 60, 56, 59, 58],
        saber:           [62, 65, 61, 64, 63],
        medicina:        [67, 70, 66, 69, 68],
        // Coluna direita (Espiritual)
        dissimulacao:    [77, 80, 76, 79, 78],
        intuicao:        [82, 85, 81, 84, 83],
        lideranca:       [87, 90, 86, 89, 88],
        percepcao:       [92, 95, 91, 94, 93],
        persuasao:       [97, 100, 96, 99, 98],
        sobrevivencia:   [102, 105, 101, 104, 103],
      };
      for (const [key, boxes] of Object.entries(SKILL_RANK_BOXES)) {
        const rank = state.pericias[key] || 0;
        for (let i = 0; i < boxes.length; i++) {
          setCheck(`Rank Box ${boxes[i]}`, i < rank);
        }
      }

      if (p.radiantClass) {
        const activeSurges = CosData.RADIANT_CLASS_PERICIAS[p.radiantClass] || [];
        
        // Slots em ordem (Esquerda, Centro, Direita) mapeando os campos exatos
        const slots = [
          { scoreField: 'Physical Custom',  nameField: 'Custom Skill 1', abbrField: 'Custom Score 1', boxes: [37, 40, 36, 39, 38] },
          { scoreField: 'Cognitive Custom', nameField: 'Custom Skill 2', abbrField: 'Custom Score 2', boxes: [72, 75, 71, 74, 73] },
          { scoreField: 'Spiritual Custom', nameField: 'Custom Skill 3', abbrField: 'Custom Score 3', boxes: [107, 110, 106, 109, 108] }
        ];

        let currentSlotIndex = 0; // Vai preenchendo da esquerda pra direita

        activeSurges.forEach(surgeKey => {
          const info = CosData.PERICIAS_RADIANTES[surgeKey];
          // Se não achar o surto ou acabarem os slots (máx 3), pula
          if (!info || currentSlotIndex >= slots.length) return;

          const rank = state.radiantPericias[surgeKey] || 0;
          const attrVal = a[info.attr] || 0; 
          const totalBonus = rank + attrVal;

          // Pega a abreviação do atributo correspondente (ex: 'FOR', 'VEL', 'PRE')
          const attrInfo = CosData.ATTRIBUTES[info.attr];
          const attrAbbr = attrInfo ? attrInfo.abbr : '';

          const targetSlot = slots[currentSlotIndex];

          // 1. Preenche a caixinha menor com a abreviação do Atributo
          setField(targetSlot.abbrField, attrAbbr, 5);
          
          // 2. Preenche o Nome da Perícia (Surto)
          setField(targetSlot.nameField, info.name);
          
          // 3. Preenche o Bônus Total (Atributo + Rank)
          setField(targetSlot.scoreField, String(totalBonus));
          
          // 4. Preenche os checkboxes (bolinhas)
          for (let i = 0; i < targetSlot.boxes.length; i++) {
            setCheck(`Rank Box ${targetSlot.boxes[i]}`, i < rank);
          }

          // Avança para a próxima coluna da ficha
          currentSlotIndex++;
        });
      }

      // Talentos desbloqueados
      const allSkills = [...CosData.SKILLS, ...CosData.RADIANT_SKILLS];
      const talentNames = [...state.unlockedSkills]
        .map(id => { const s = allSkills.find(sk => sk.id === id); return s ? s.name : null; })
        .filter(Boolean);
      const uniqueTalents = [...new Set(talentNames)].sort();

      const chunk = 40;
      setField('Talents 1', uniqueTalents.slice(0, chunk).join('\n'));
      setField('Talents 2', uniqueTalents.slice(chunk, chunk * 2).join('\n'));
      setField('Talents 3', uniqueTalents.slice(chunk * 2).join('\n'));
      
      const stats = getDerivedStats();

      // --- PREENCHER OS CAMPOS DA FICHA ---
      setField('Health Maximum', '    '+String(stats.maxHealth));      
      setField('Focus Maximum', '    '+String(stats.maxFocus));
      if (stats.maxInvestiture > 0) { 
        setField('Investiture Maximum 4', '    '+String(stats.maxInvestiture));
      } else {
        setField('Investiture Maximum 4', '    0');
      }
      
      setField('Recovery Die', '        '+stats.recDie);
      setField('Senses Range', '        '+stats.senses, 14);
      setField('Movement', '   '+stats.movement, 14);
      setField('Lifting Capacity', '   '+stats.lifting, 14);

      // Download
      console.log('[Sheet] Salvando PDF...');
      const filledBytes = await pdfDoc.save();
      console.log('[Sheet] PDF gerado:', filledBytes.byteLength, 'bytes');
      const blob = new Blob([filledBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `ficha_${p.name || 'personagem'}.pdf`;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      console.log('[Sheet] Download iniciado!');
      notify('Ficha exportada!');

    } catch(err) {
      console.error('[Sheet] ERRO:', err);
      alert('Erro ao gerar ficha: ' + err.message);
      notify('Erro ao gerar ficha: ' + err.message);
    }
  }

  return { init, state, exportToSheet };

})();

// Boot
window.addEventListener('DOMContentLoaded', () => {
  App.init();
});
