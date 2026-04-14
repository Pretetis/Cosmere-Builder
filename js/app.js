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
    // Also handle fill/stroke declared inside inline style="fill:#000000"
    root.querySelectorAll('[style]').forEach(el => {
      let s = el.getAttribute('style');
      s = s.replace(/fill\s*:\s*(#000000|#000|black)\b/gi, `fill:${color}`);
      s = s.replace(/stroke\s*:\s*(#000000|#000|black)\b/gi, `stroke:${color}`);
      el.setAttribute('style', s);
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

  const CLASS_INITIAL_PERICIA = {
    'Agente':    'intuicao',
    'Caçador':   'percepcao',
    'Emissário': 'disciplina',
    'Erudito':   'saber',
    'Guerreiro': 'atletismo',
    'Líder':     'lideranca'
  };

  const state = {
    profile: {
      name: '',
      race: 'human',
      level: 1,
      radiantClass: null,
      radiantClassLocked: false,
      ancestryClass: null,  // classe onde o humano gastou o 1º bônus ancestral
    },
    attributes: {
      forca: 0, velocidade: 0, intelecto: 0,
      vontade: 0, consciencia: 0, presenca: 0
    },
    pericias: {},
    radiantPericias: {},
    unlockedSkills: new Set(),
    freeUnlockedSkills: new Set(), // IDs auto-desbloqueados por habilidades compartilhadas
    singerFreeIds: new Set(),       // IDs concedidos gratuitamente pela ancestralidade Cantor
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

    if (state.profile.ancestryClass && CLASS_INITIAL_PERICIA[state.profile.ancestryClass]) {
      sum -= 1;
    }

    return sum;
  }

  function getPericiaPointsRemaining() {
    return getPointsAvailable().totalPericia - getPericiaPointsSpent();
  }

  function getTalentPointsRemaining() {
    let bonus = 0;
    // Humanos: +1 bônus ancestral; o talento regular (nível 1) e o bônus são ambos restritos
    // (1º = Rank 0 de classe mundana, 2º = mesma classe)
    if (state.profile.race === 'human' && state.profile.level >= 1) {
      bonus = 1;
    }
    // Cantores: sem bônus (Mudar Forma é grátis via singerFreeIds, não conta em spentTalents)
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
      if (row.level > p.level) break;
      
      if (typeof row.hpGain === 'string' && row.hpGain.includes('+FOR')) {
        maxHealth += parseInt(row.hpGain.split('+')[0]) + a.forca;
      } else {
        maxHealth += Number(row.hpGain) || 0;
      }
    }

    const maxFocus = 2 + a.vontade;
    
    const maxInvestiture = p.radiantClass
      ? 2 + (a.consciencia >= a.presenca ? a.consciencia : a.presenca)
      : 0;

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

  // ---- ADDITIONAL SKILL UNLOCK CHECK ----
  function canUnlockAdditionalSkill(skill) {
    if (state.unlockedSkills.has(skill.id)) return { can: false, reason: 'Já desbloqueado' };

    if (skill.cls === 'Cantor' && state.singerFreeIds.has(skill.id)) {
      return { can: false, reason: 'Concedido automaticamente pela ancestralidade Cantor' };
    }
    if (skill.cls === 'Cantor' && state.profile.race !== 'singer') {
      return { can: false, reason: 'Requer ancestralidade Cantor' };
    }

    if (getTalentPointsRemaining() <= 0) return { can: false, reason: 'Sem pontos de talento' };

    if (skill.rank === 0) return { can: true, reason: '' };

    if (skill.deps.length > 0) {
      const anyDepMet = skill.deps.some(depName => {
        const dep = CosData.findAdditionalSkillByName(depName, skill.cls);
        return dep && state.unlockedSkills.has(dep.id);
      });
      if (!anyDepMet) return { can: false, reason: 'Pré-requisito não atendido' };
    }

    const root = CosData.getRootAdditionalSkill(skill.cls);
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

  // ---- SINGER / ADDITIONAL HELPERS ----
  function isAdditionalSkill(skill) {
    return CosData.ADDITIONAL_CLASSES.includes(skill.cls);
  }

  function applySingerFreeSkills() {
    const mudaForma = CosData.ADDITIONAL_SKILLS.find(s => s.cls === 'Cantor' && s.name === 'Mudar Forma');
    if (mudaForma && !state.unlockedSkills.has(mudaForma.id)) {
      state.unlockedSkills.add(mudaForma.id);
      state.singerFreeIds.add(mudaForma.id);
    }
  }

  function removeSingerFreeSkills() {
    for (const id of state.singerFreeIds) {
      state.unlockedSkills.delete(id);
    }
    state.singerFreeIds.clear();
  }

  // ---- SKILL PREREQUISITES CHECK ----
  function canUnlockSkill(skill) {
    if (state.unlockedSkills.has(skill.id)) return { can: false, reason: 'Ja desbloqueado' };

    if (getTalentPointsRemaining() <= 0) return { can: false, reason: 'Sem pontos de talento' };

    // Human ancestry restriction — ambos os talentos do nível 1 são restritos
    if (state.profile.race === 'human') {
      if (state.spentTalents === 0) {
        // 1º talento: deve ser Rank 0 de uma classe mundana
        if (skill.rank !== 0 || !CosData.CLASSES.includes(skill.cls)) {
          return { can: false, reason: 'Ancestral Humano: escolha um Rank 0 de classe mundana' };
        }
      } else if (state.spentTalents === 1) {
        // 2º talento: deve ser na mesma classe do 1º
        if (state.profile.ancestryClass && skill.cls !== state.profile.ancestryClass) {
          return { can: false, reason: `Ancestral Humano: deve ser da classe ${state.profile.ancestryClass}` };
        }
      }
    }

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

    // Habilidades concedidas gratuitamente pela ancestralidade Cantor não podem ser removidas
    if (state.singerFreeIds.has(skill.id)) {
      return { can: false, reason: 'Concedido pela ancestralidade Cantor — não pode ser removido' };
    }

    // Árvore adicional (Cantor etc.)
    if (isAdditionalSkill(skill)) {
      const pool = CosData.ADDITIONAL_SKILLS;
      if (skill.rank === 0) {
        const hasChildren = pool.some(s => s.cls === skill.cls && s.rank > 0 && state.unlockedSkills.has(s.id));
        if (hasChildren) return { can: false, reason: 'Outros talentos desta classe estão desbloqueados' };
        return { can: true, reason: '' };
      }
      const children = pool.filter(s => s.cls === skill.cls && s.deps.includes(skill.name) && state.unlockedSkills.has(s.id));
      if (children.length > 0) return { can: false, reason: 'Outros talentos dependem deste' };
      return { can: true, reason: '' };
    }

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

  // function toggleSkill(skill) {
  //   const radiant = isRadiantSkill(skill);
  //   const additional = isAdditionalSkill(skill);

  //   if (state.unlockedSkills.has(skill.id)) {
  //     // --- REMOVE ---
  //     const check = canRemoveSkill(skill);
  //     if (!check.can) { notify(check.reason); return false; }
  //     state.unlockedSkills.delete(skill.id);
  //     state.freeUnlockedSkills.delete(skill.id);
  //     if (!radiant && !additional) {
  //       for (const sid of getSharedSkillIds(skill.name)) {
  //         if (sid !== skill.id) {
  //           state.unlockedSkills.delete(sid);
  //           state.freeUnlockedSkills.delete(sid);
  //         }
  //       }
  //     }
  //     state.spentTalents--;

  //     // Se humano e o 1º talento foi removido, limpa ancestryClass
  //     if (state.profile.race === 'human' && !radiant && !additional) {
  //       if (state.spentTalents === 0) {
  //         state.profile.ancestryClass = null;
  //       }
  //     }
  //     return true;

  //   } else {
  //     // --- UNLOCK ---
  //     const check = radiant ? canUnlockRadiantSkill(skill)
  //                 : additional ? canUnlockAdditionalSkill(skill)
  //                 : canUnlockSkill(skill);
  //     if (!check.can) { notify(check.reason); return false; }
  //     state.unlockedSkills.add(skill.id);
  //     state.spentTalents++;

  function toggleSkill(skill) {
    const radiant = isRadiantSkill(skill);
    const additional = isAdditionalSkill(skill);

    if (state.unlockedSkills.has(skill.id)) {
      // --- REMOVE ---
      const check = canRemoveSkill(skill);
      if (!check.can) { notify(check.reason); return false; }
      state.unlockedSkills.delete(skill.id);
      state.freeUnlockedSkills.delete(skill.id);
      if (!radiant && !additional) {
        for (const sid of getSharedSkillIds(skill.name)) {
          if (sid !== skill.id) {
            state.unlockedSkills.delete(sid);
            state.freeUnlockedSkills.delete(sid);
          }
        }
      }
      state.spentTalents--;

      // Lógica de remoção da classe inicial e da perícia fixa
      if (!radiant && !additional && skill.rank === 0 && skill.cls === state.profile.ancestryClass) {
        const pKey = CLASS_INITIAL_PERICIA[skill.cls];
        if (pKey && state.pericias[pKey] > 0) {
          state.pericias[pKey] -= 1; // Remove o rank ganho
        }
        state.profile.ancestryClass = null; // Libera o slot
      }

      // Se humano e o 1º talento foi removido... (resto igual)
      if (state.profile.race === 'human' && !radiant && !additional) {
        if (state.spentTalents === 0) {
          state.profile.ancestryClass = null;
        }
      }
      return true;

    } else {
      // --- UNLOCK ---
      const check = radiant ? canUnlockRadiantSkill(skill)
                  : additional ? canUnlockAdditionalSkill(skill)
                  : canUnlockSkill(skill);
      if (!check.can) { notify(check.reason); return false; }
      state.unlockedSkills.add(skill.id);
      state.spentTalents++;

      // === LÓGICA DA PERÍCIA FIXA INICIAL ===
      // Se for o primeiro Rank 0 mundano que ele compra, vira a Trilha Inicial
      if (!radiant && !additional && skill.rank === 0 && !state.profile.ancestryClass) {
        state.profile.ancestryClass = skill.cls;
        const pKey = CLASS_INITIAL_PERICIA[skill.cls];
        if (pKey) {
          state.pericias[pKey] = (state.pericias[pKey] || 0) + 1;
          const maxRank = getMaxPericiaRank();
          // Se já estava no limite, trava no limite. O custo vai cair em 1, devolvendo um ponto livre!
          if (state.pericias[pKey] > maxRank) {
            state.pericias[pKey] = maxRank;
          }
        }
      }

      // Sela a ordem radiante automaticamente no primeiro talento radiante comprado
      if (radiant && !state.profile.radiantClassLocked) {
        state.profile.radiantClassLocked = true;
      }

      // Registra ancestryClass para humano no 1º talento gasto
      if (state.profile.race === 'human' && !radiant && !additional) {
        if (state.spentTalents === 1) {
          state.profile.ancestryClass = skill.cls;
        }
      }

      if (!radiant && !additional) {
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
          // showSkillModal(skill);
          hideSkillModal();
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
    // Update race display label in sidebar
    const raceLabel = document.getElementById('char-race-display');
    if (raceLabel) {
      raceLabel.textContent = state.profile.race === 'singer' ? 'Cantor' : 'Humano';
    }
    // Update name display
    const nameInput = document.getElementById('char-name');
    if (nameInput && nameInput.value !== state.profile.name) {
      nameInput.value = state.profile.name;
    }
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
      sNode.dataset.surgeIdx = i;
      sNode.innerHTML = `
        <img src="${surgeSrc}" alt="${surge.name}">
        <div class="rw-surge-label" style="${surgeActive ? `color:${activeColor};opacity:1` : ''}">${surge.name}</div>
      `;
      // Highlight the two adjacent orders on hover
      sNode.addEventListener('mouseenter', () => {
        const cls0 = WHEEL_ORDERS[i];
        const cls1 = WHEEL_ORDERS[(i + 1) % N];
        ringEl.querySelectorAll('.rw-order').forEach(el => {
          if (el.dataset.cls === cls0 || el.dataset.cls === cls1) {
            el.classList.add('surge-highlight');
          }
        });
      });
      sNode.addEventListener('mouseleave', () => {
        ringEl.querySelectorAll('.rw-order.surge-highlight').forEach(el => {
          el.classList.remove('surge-highlight');
        });
      });
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
    if (state.profile.level < 2) {
      notify('Disponível a partir do Nível 2');
      return;
    }
    document.getElementById('radiant-wheel').classList.add('visible');
    // Scale container to fill ~85% of the smaller viewport dimension
    const container = document.getElementById('radiant-wheel-container');
    if (container) {
      const titleReserve = 90; // space reserved for title + subtitle at top
      const available = Math.min(window.innerWidth, window.innerHeight - titleReserve) * 0.88;
      const scale = Math.min(available / 560, 1.3); // max 1.3× to avoid overflow
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
    // A ordem fica bloqueada assim que o primeiro talento radiante é comprado
    const locked = state.profile.radiantClassLocked;

    if (!cls) {
      // Nenhuma ordem escolhida — mostra botão para abrir a roda
      const btn = document.createElement('button');
      btn.className = 'radiant-choose-btn';
      btn.textContent = '✦  Escolher Ordem Radiante';
      btn.addEventListener('click', showRadiantWheel);
      container.appendChild(btn);
    } else {
      // Ordem escolhida — mostra display; botão "Alterar" só aparece antes de comprar talentos
      const color = clsColor(cls);
      const div = document.createElement('div');
      div.className = 'radiant-locked-display';
      div.style.borderColor = color + '60';
      div.innerHTML = `
        <img class="radiant-locked-glyph" src="${WHEEL_SVG_MAP[cls]}" alt="${cls}">
        <div class="radiant-locked-info">
          <div class="radiant-locked-name" style="color:${color}">${cls}</div>
          ${!locked ? `<div style="margin-top:5px;">
            <button class="btn" style="font-size:10px;padding:3px 8px;" id="radiant-alter-btn">Alterar</button>
          </div>` : ''}
        </div>
      `;
      container.appendChild(div);
      if (!locked) {
        div.querySelector('#radiant-alter-btn').addEventListener('click', showRadiantWheel);
      }
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
  const ATTR_COLORS = {
    forca:       'var(--accent-red)',
    velocidade:  'var(--accent-green)',
    intelecto:   'var(--accent-storm)',
    vontade:     'var(--accent-purple)',
    consciencia: 'var(--accent-gold)',
    presenca:    'var(--accent-teal)',
  };

  function applyPericiaFilter(query) {
    const q = (query || '').toLowerCase().trim();
    document.querySelectorAll('#pericias-grid .pericia-item').forEach(item => {
      const name = item.querySelector('.pericia-name')?.textContent.toLowerCase() || '';
      item.style.display = (!q || name.includes(q)) ? '' : 'none';
    });
  }

  function renderPericias() {
    const container = document.getElementById('pericias-grid');
    if (!container) return;

    // Preserva o valor do filtro antes de limpar
    const prevFilter = container.querySelector('.pericia-filter-input');
    const filterVal = prevFilter ? prevFilter.value : '';

    container.innerHTML = '';

    const maxRank = getMaxPericiaRank();
    const initialClassKey = state.profile.ancestryClass ? CLASS_INITIAL_PERICIA[state.profile.ancestryClass] : null;

    // Filtro de nome
    const filterWrapper = document.createElement('div');
    filterWrapper.className = 'pericia-filter-wrapper';
    filterWrapper.innerHTML = `<input type="text" class="pericia-filter-input" placeholder="Filtrar perícias..." value="${filterVal}" autocomplete="off">`;
    container.appendChild(filterWrapper);

    // Helper para criar as 5 esferas com cor do atributo
    const createSpheres = (currentRank, key, isRadiant = false, color = '#fff') => {
      let spheresHtml = `<div class="sphere-track" style="--sphere-color:${color}">`;
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
      const color = ATTR_COLORS[info.attr] || '#fff';

      const div = document.createElement('div');
      div.className = 'pericia-item';
      div.innerHTML = `
        <span class="pericia-name">
          ${info.name} <small style="opacity:0.5;color:${color}">(${CosData.ATTRIBUTES[info.attr].abbr})</small>
        </span>
        <div class="pericia-controls-new">
          ${createSpheres(rank, key, false, color)}
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
        const color = ATTR_COLORS[info.attr] || clsColor(cls);

        const div = document.createElement('div');
        div.className = 'pericia-item';
        div.innerHTML = `
          <span class="pericia-name" style="color:${clsColor(cls)}">${info.name}</span>
          <div class="pericia-controls-new">
            ${createSpheres(rank, key, true, color)}
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
        const newVal = (currentVal === idx) ? idx - 1 : idx;

        if (!isRadiant && key === initialClassKey && newVal < 1) {
          notify(`O 1º Rank de ${CosData.PERICIAS[key].name} é fixo pela sua Trilha Inicial (${state.profile.initialClass}).`);
          return;
        }

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

    // Aplica filtro preservado e conecta listener
    applyPericiaFilter(filterVal);
    container.querySelector('.pericia-filter-input')?.addEventListener('input', e => {
      applyPericiaFilter(e.target.value);
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

    // Cantor tab (apenas para jogadores com ancestralidade Cantor)
    if (state.profile.race === 'singer') {
      const csep = document.createElement('span');
      csep.className = 'tab-separator';
      container.appendChild(csep);

      const cColor = clsColor('Cantor');
      const cbtn = document.createElement('button');
      cbtn.className = 'class-tab tab-additional' + ('Cantor' === state.activeClass ? ' active' : '');
      cbtn.textContent = 'Cantor';
      cbtn.style.borderBottomColor = 'Cantor' === state.activeClass ? cColor : 'transparent';
      cbtn.style.color = 'Cantor' === state.activeClass ? cColor : '';
      cbtn.addEventListener('click', () => {
        if (state.activeClass === 'Cantor') return;
        state.activeClass = 'Cantor';
        renderClassTabs();
        triggerTabSlide(() => rebuildTree());
      });
      container.appendChild(cbtn);
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
    if (isAdditionalSkill(skill)) return canUnlockAdditionalSkill(skill).can;
    return canUnlockSkill(skill).can;
  }

  function rebuildTree(keepView) {
    if (state.activeClass === '_all') {
      if (keepView && SkillRenderer.getViewMode() === 'all') {
        SkillRenderer.updateStates(state.unlockedSkills, state.pericias, canUnlockCheck);
        return;
      }
      const addlCls = state.profile.race === 'singer' ? ['Cantor'] : [];
      SkillRenderer.buildAllTrees(state.unlockedSkills, state.pericias, canUnlockCheck, state.profile.radiantClass, addlCls);
    } else {
      SkillRenderer.buildTree(state.activeClass, state.unlockedSkills, state.pericias, !!keepView, canUnlockCheck);
    }
  }

  // ---- SAVE / LOAD ----
  // ---- MULTI-SLOT SAVE SYSTEM ----
  const SAVES_KEY = 'cosmere_rpg_saves_v2';
  const MAX_SAVES = 20;

  function getSaves() {
    try {
      const raw = localStorage.getItem(SAVES_KEY);
      const saves = raw ? JSON.parse(raw) : [];

      // Migra save antigo (chave legada) se existir e não houver saves novos ainda
      if (saves.length === 0) {
        const legacy = localStorage.getItem('cosmere_rpg_profile');
        if (legacy) {
          const data = JSON.parse(legacy);
          const migrated = {
            id: Date.now(),
            savedAt: new Date().toISOString(),
            summary: buildSaveSummary(data),
            ...data,
          };
          saves.push(migrated);
          localStorage.setItem(SAVES_KEY, JSON.stringify(saves));
          localStorage.removeItem('cosmere_rpg_profile');
        }
      }

      return saves;
    } catch (e) {
      return [];
    }
  }

  function writeSaves(saves) {
    localStorage.setItem(SAVES_KEY, JSON.stringify(saves));
  }

  function buildSaveSummary(data) {
    const p = data.profile || {};
    const unlockedIds = data.unlockedSkills || [];
    const allSkills = [...CosData.SKILLS, ...CosData.RADIANT_SKILLS];
    const classes = [...new Set(
      unlockedIds.map(id => { const s = allSkills.find(sk => sk.id === id); return s ? s.cls : null; })
        .filter(c => c && CosData.CLASSES.includes(c))
    )];
    return {
      name: p.name || 'Sem Nome',
      level: p.level || 1,
      race: p.race || 'human',
      radiantClass: p.radiantClass || null,
      classes,
    };
  }

  function buildCurrentSaveData() {
    return {
      profile: state.profile,
      attributes: state.attributes,
      pericias: state.pericias,
      radiantPericias: state.radiantPericias,
      unlockedSkills: [...state.unlockedSkills],
      freeUnlockedSkills: [...state.freeUnlockedSkills],
      singerFreeIds: [...state.singerFreeIds],
      spentTalents: state.spentTalents,
      activeClass: state.activeClass,
    };
  }

  function applySaveData(data) {
    state.profile = { ...state.profile, radiantClassLocked: false, ancestryClass: null, ...data.profile };
    state.attributes = { ...state.attributes, ...data.attributes };
    state.pericias = { ...state.pericias, ...data.pericias };
    state.radiantPericias = { ...state.radiantPericias, ...data.radiantPericias };
    state.unlockedSkills = new Set(data.unlockedSkills || []);
    state.freeUnlockedSkills = new Set(data.freeUnlockedSkills || []);
    state.singerFreeIds = new Set(data.singerFreeIds || []);
    state.spentTalents = data.spentTalents || 0;
    state.activeClass = data.activeClass || '_all';
    renderSidebar();
    renderClassTabs();
    rebuildTree();
  }

  function formatSaveDate(isoStr) {
    try {
      const d = new Date(isoStr);
      return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    } catch (e) { return ''; }
  }

  // ---- SAVES MODAL ----
  function showSavesModal() {
    const modal = document.getElementById('saves-modal');
    if (!modal) return;
    renderSavesModal();
    modal.classList.add('visible');
  }

  function hideSavesModal() {
    const modal = document.getElementById('saves-modal');
    if (modal) modal.classList.remove('visible');
  }

  function renderSavesModal() {
    const modal = document.getElementById('saves-modal');
    if (!modal) return;
    const saves = getSaves();

    const slotsHTML = saves.length === 0
      ? `<div class="sm-empty">Nenhum save encontrado.</div>`
      : saves.slice().reverse().map(sv => {
          const s = sv.summary || {};
          const nameTxt = s.name || 'Sem Nome';
          const lvlTxt = `Nível ${s.level || 1}`;
          const raceTxt = s.race === 'singer' ? 'Cantor' : 'Humano';
          const classTxt = [
            ...(s.classes || []),
            ...(s.radiantClass ? [s.radiantClass] : []),
          ].join(' · ') || '—';
          const dateTxt = formatSaveDate(sv.savedAt);
          return `
            <div class="sm-slot" data-id="${sv.id}">
              <div class="sm-slot-info">
                <div class="sm-slot-name">${nameTxt}</div>
                <div class="sm-slot-meta">${lvlTxt} · ${raceTxt} · ${classTxt}</div>
                <div class="sm-slot-date">${dateTxt}</div>
              </div>
              <div class="sm-slot-actions">
                <button class="btn primary sm-load-btn" data-id="${sv.id}">Carregar</button>
                <button class="btn danger sm-del-btn" data-id="${sv.id}" title="Excluir">✕</button>
              </div>
            </div>`;
        }).join('');

    modal.innerHTML = `
      <div class="sm-backdrop"></div>
      <div class="sm-content">
        <div class="sm-header">
          <span class="sm-title">Saves</span>
          <button class="sm-close" id="sm-close-btn">&times;</button>
        </div>
        <div class="sm-body">
          <div class="sm-save-btn-row">
            <button class="btn primary" id="sm-save-current">Salvar Personagem Atual</button>
          </div>
          ${slotsHTML}
          <div class="sm-notice">
            <strong>⚠ Atenção:</strong> Os saves ficam apenas no cache do navegador (localStorage).
            Limpar o histórico ou os dados do site <strong>apagará todos os saves permanentemente</strong>.
            Use "Exportar Ficha PDF" para guardar uma cópia segura.
          </div>
        </div>
      </div>
    `;

    // Fechar
    modal.querySelector('#sm-close-btn')?.addEventListener('click', hideSavesModal);
    modal.querySelector('.sm-backdrop')?.addEventListener('click', hideSavesModal);

    // Salvar atual
    modal.querySelector('#sm-save-current')?.addEventListener('click', () => {
      const saves = getSaves();
      if (saves.length >= MAX_SAVES) {
        notify(`Limite de ${MAX_SAVES} saves atingido. Exclua um para continuar.`);
        return;
      }
      const data = buildCurrentSaveData();
      const entry = {
        id: Date.now(),
        savedAt: new Date().toISOString(),
        summary: buildSaveSummary(data),
        ...data,
      };
      saves.push(entry);
      writeSaves(saves);
      notify('Personagem salvo!');
      renderSavesModal();
    });

    // Carregar
    modal.querySelectorAll('.sm-load-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = Number(btn.dataset.id);
        const saves = getSaves();
        const sv = saves.find(s => s.id === id);
        if (!sv) { notify('Save não encontrado'); return; }
        applySaveData(sv);
        hideSavesModal();
        notify(`${sv.summary?.name || 'Personagem'} carregado!`);
      });
    });

    // Excluir
    modal.querySelectorAll('.sm-del-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = Number(btn.dataset.id);
        const saves = getSaves().filter(s => s.id !== id);
        writeSaves(saves);
        renderSavesModal();
      });
    });
  }

  function resetProfile() {
    state.profile = { name: '', race: 'human', level: 1, radiantClass: null, radiantClassLocked: false, ancestryClass: null };
    state.attributes = { forca:0, velocidade:0, intelecto:0, vontade:0, consciencia:0, presenca:0 };
    initPericias();
    state.unlockedSkills = new Set();
    state.freeUnlockedSkills = new Set();
    state.singerFreeIds = new Set();
    state.spentTalents = 0;
    state.activeClass = '_all';

    renderSidebar();
    renderClassTabs();
    rebuildTree();
    showProfileModal(false);
  }

  // ---- IMPORT FROM PDF ----
  async function importFromPDF() {
    if (typeof PDFLib === 'undefined') {
      notify('pdf-lib não carregado. Abra via start.bat');
      return;
    }

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf';

    input.addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;

      notify('Lendo ficha...');

      try {
        const { PDFDocument } = PDFLib;
        const arrayBuffer = await file.arrayBuffer();
        const pdfDoc = await PDFDocument.load(arrayBuffer);
        const form = pdfDoc.getForm();

        function getField(name) {
          try { return form.getTextField(name).getText() || ''; }
          catch(e) { return ''; }
        }

        function isChecked(name) {
          try { return form.getCheckBox(name).isChecked(); }
          catch(e) { return false; }
        }

        // --- Nome, Nível, Ancestralidade ---
        const name = getField('Character Name.Page 1') || getField('Character Name.Page 2');
        const levelRaw = parseInt(getField('Level.Page 1') || getField('Level.Page 2'));
        const level = isNaN(levelRaw) ? 1 : Math.min(Math.max(levelRaw, 1), 30);
        const ancestryStr = getField('Ancestry.Page 1') || getField('Ancestry.Page 2');
        const race = ancestryStr.toLowerCase().includes('cantor') ? 'singer' : 'human';

        // --- Atributos ---
        const attributes = {
          forca:       parseInt((getField('Strength.Page 1')  || getField('Strength.Page 2')).trim())  || 0,
          velocidade:  parseInt((getField('Speed.Page 1')     || getField('Speed.Page 2')).trim())     || 0,
          intelecto:   parseInt((getField('Intellect.Page 1') || getField('Intellect.Page 2')).trim()) || 0,
          vontade:     parseInt((getField('Willpower.Page 1') || getField('Willpower.Page 2')).trim()) || 0,
          consciencia: parseInt((getField('Awareness.Page 1') || getField('Awareness.Page 2')).trim()) || 0,
          presenca:    parseInt((getField('Presence.Page 1')  || getField('Presence.Page 2')).trim())  || 0,
        };

        // --- Ranks de Perícia (contar checkboxes marcados por perícia) ---
        const SKILL_RANK_BOXES = {
          agilidade:       [7, 10, 6, 9, 8],
          atletismo:       [12, 15, 11, 14, 13],
          armamentoPesado: [17, 20, 16, 19, 18],
          armamentoLeve:   [22, 25, 21, 24, 23],
          furtividade:     [27, 30, 26, 29, 28],
          ladroagem:       [32, 35, 31, 34, 33],
          manufatura:      [42, 45, 41, 44, 43],
          deducao:         [47, 50, 46, 49, 48],
          disciplina:      [52, 55, 51, 54, 53],
          intimidacao:     [57, 60, 56, 59, 58],
          saber:           [62, 65, 61, 64, 63],
          medicina:        [67, 70, 66, 69, 68],
          dissimulacao:    [77, 80, 76, 79, 78],
          intuicao:        [82, 85, 81, 84, 83],
          lideranca:       [87, 90, 86, 89, 88],
          percepcao:       [92, 95, 91, 94, 93],
          persuasao:       [97, 100, 96, 99, 98],
          sobrevivencia:   [102, 105, 101, 104, 103],
        };

        const pericias = {};
        for (const key of Object.keys(CosData.PERICIAS)) pericias[key] = 0;
        for (const [key, boxes] of Object.entries(SKILL_RANK_BOXES)) {
          pericias[key] = boxes.filter(boxId => isChecked(`Rank Box ${boxId}`)).length;
        }

        // --- Classe Radiante e Trilha Inicial a partir do campo Paths ---
        const pathsStr = getField('Paths.Page 1') || getField('Paths.Page 2');
        const pathTokens = pathsStr.split(';').map(s => s.trim()).filter(Boolean);
        let radiantClass = null;
        let ancestryClass = null;
        for (const token of pathTokens) {
          if (CosData.RADIANT_CLASSES.includes(token) && !radiantClass) {
            radiantClass = token;
          } else if (CosData.CLASSES.includes(token) && !ancestryClass) {
            ancestryClass = token;
          }
        }

        // --- Ranks dos Surtos Radiantes (caixas das perícias customizadas) ---
        const radiantPericias = {};
        for (const key of Object.keys(CosData.PERICIAS_RADIANTES)) radiantPericias[key] = 0;
        if (radiantClass) {
          const activeSurges = CosData.RADIANT_CLASS_PERICIAS[radiantClass] || [];
          const surgeBoxSlots = [
            [37, 40, 36, 39, 38],
            [72, 75, 71, 74, 73],
            [107, 110, 106, 109, 108],
          ];
          activeSurges.forEach((surgeKey, i) => {
            if (i >= surgeBoxSlots.length) return;
            radiantPericias[surgeKey] = surgeBoxSlots[i].filter(b => isChecked(`Rank Box ${b}`)).length;
          });
        }

        // --- Talentos a partir dos campos de texto ---
        const talentsText = [
          getField('Talents 1'),
          getField('Talents 2'),
          getField('Talents 3'),
        ].join('\n');
        const talentNames = talentsText.split('\n').map(s => s.trim()).filter(Boolean);

        const allSkillsPool = [
          ...CosData.SKILLS,
          ...CosData.RADIANT_SKILLS,
          ...CosData.ADDITIONAL_SKILLS,
        ];

        const unlockedSkills = new Set();
        const freeUnlockedSkills = new Set();
        const singerFreeIds = new Set();

        // Habilidade gratuita do Cantor (Mudar Forma)
        let singerFreeName = null;
        if (race === 'singer') {
          const mudaForma = CosData.ADDITIONAL_SKILLS.find(s => s.cls === 'Cantor' && s.name === 'Mudar Forma');
          if (mudaForma) {
            singerFreeName = mudaForma.name;
            unlockedSkills.add(mudaForma.id);
            singerFreeIds.add(mudaForma.id);
          }
        }

        let spentTalents = 0;

        for (const tName of talentNames) {
          if (tName === singerFreeName) continue;

          // Encontra todos os IDs com este nome (habilidades compartilhadas entre classes)
          const matches = allSkillsPool.filter(s => s.name === tName);
          if (matches.length === 0) continue;

          for (const sk of matches) unlockedSkills.add(sk.id);

          // Apenas 1 "gasto" por nome único; as cópias extras são auto-desbloqueadas (free)
          spentTalents++;
          for (let i = 1; i < matches.length; i++) {
            freeUnlockedSkills.add(matches[i].id);
          }
        }

        // --- Aplicar ao estado ---
        state.profile = {
          ...state.profile,
          name,
          level,
          race,
          radiantClass: radiantClass || null,
          radiantClassLocked: !!radiantClass,
          ancestryClass: ancestryClass || null,
        };
        state.attributes = attributes;
        state.pericias = pericias;
        state.radiantPericias = radiantPericias;
        state.unlockedSkills = unlockedSkills;
        state.freeUnlockedSkills = freeUnlockedSkills;
        state.singerFreeIds = singerFreeIds;
        state.spentTalents = spentTalents;
        state.activeClass = '_all';

        document.getElementById('char-name').value = state.profile.name;
        document.querySelectorAll('.race-btn').forEach(b => {
          b.classList.toggle('active', b.dataset.race === state.profile.race);
        });
        renderSidebar();
        renderClassTabs();
        rebuildTree();
        hideProfileModal();
        notify('Ficha importada!');

      } catch (err) {
        console.error('[Import PDF]', err);
        notify('Erro ao ler PDF: ' + err.message);
      }
    });

    input.click();
  }

  // ---- PROFILE MODAL ----
  let _profileDraft = null;

  function showProfileModal(canCancel) {
    const modal = document.getElementById('profile-modal');
    if (!modal) return;

    // Snapshot current state into draft
    _profileDraft = {
      name: state.profile.name || '',
      race: state.profile.race || 'human',
    };

    const isNew = !canCancel;

    modal.innerHTML = `
      <div class="pm-backdrop"></div>
      <div class="pm-content">
        <div class="pm-header">
          <span class="pm-title">${isNew ? 'Criar Personagem' : 'Editar Perfil'}</span>
          ${canCancel ? '<button class="pm-close" id="pm-close-btn">&times;</button>' : ''}
        </div>
        <div class="pm-body">

          <div class="pm-section">
            <div class="pm-section-title">Nome do Personagem</div>
            <input class="pm-name-input" id="pm-name-input" type="text"
              placeholder="Digite o nome..." value="${_profileDraft.name}" maxlength="40" autocomplete="off">
          </div>

          ${isNew ? `
          <div class="pm-section">
            <div class="pm-section-title">Ancestralidade</div>
            <div class="pm-race-cards">

              <div class="pm-race-card ${_profileDraft.race === 'human' ? 'active' : ''}" data-race="human">
                <div class="pm-race-img">
                  <span class="pm-race-img-placeholder">&#9654;</span>
                </div>
                <div class="pm-race-name">Humano</div>
                <div class="pm-race-desc">
                  O 1º talento deve ser o Rank&nbsp;0 de uma classe mundana; o 2º fica restrito à mesma classe.
                </div>
              </div>

              <div class="pm-race-card ${_profileDraft.race === 'singer' ? 'active' : ''}" data-race="singer">
                <div class="pm-race-img">
                  <span class="pm-race-img-placeholder">&#9670;</span>
                </div>
                <div class="pm-race-name">Cantor</div>
                <div class="pm-race-desc">
                  <em>Mudar Forma</em> desbloqueado gratuitamente + 1 talento livre para gastar em qualquer árvore.
                </div>
              </div>

            </div>
          </div>` : ''}

        </div>
        ${isNew ? `
        <div class="pm-footer pm-footer--stacked">
          <div class="pm-footer-alts">
            <button class="btn pm-import-btn" id="pm-import-btn">Importar PDF</button>
            <button class="btn pm-cache-btn" id="pm-cache-btn">Carregar do Cache</button>
          </div>
          <button class="btn primary pm-confirm-btn" id="pm-confirm-btn">Criar Personagem</button>
        </div>
        ` : `
        <div class="pm-footer">
          <button class="btn pm-cancel-btn" id="pm-cancel-btn">Cancelar</button>
          <button class="btn pm-import-btn" id="pm-import-btn">Importar PDF</button>
          <button class="btn primary pm-confirm-btn" id="pm-confirm-btn">Confirmar</button>
        </div>
        `}
      </div>
    `;

    modal.classList.add('visible');

    // Focus name input
    const nameEl = document.getElementById('pm-name-input');
    if (nameEl) {
      nameEl.focus();
      nameEl.select();
      nameEl.addEventListener('input', e => { _profileDraft.name = e.target.value; });
    }

    // Race card clicks (apenas na criação — na edição não há cards)
    if (isNew) {
      modal.querySelectorAll('.pm-race-card').forEach(card => {
        card.addEventListener('click', () => {
          _profileDraft.race = card.dataset.race;
          modal.querySelectorAll('.pm-race-card').forEach(c => c.classList.toggle('active', c === card));
        });
      });
    }

    // Confirm
    document.getElementById('pm-confirm-btn')?.addEventListener('click', () => {
      if (!_profileDraft.name.trim()) {
        const inp = document.getElementById('pm-name-input');
        if (inp) { inp.focus(); inp.style.borderColor = 'var(--accent-red)'; }
        notify('Digite um nome para o personagem');
        return;
      }
      applyProfile(_profileDraft);
      hideProfileModal();
    });

    // Import PDF
    document.getElementById('pm-import-btn')?.addEventListener('click', () => {
      importFromPDF();
    });

    // Carregar do Cache
    document.getElementById('pm-cache-btn')?.addEventListener('click', () => {
      hideProfileModal();
      showSavesModal();
    });

    // Cancel / close
    document.getElementById('pm-close-btn')?.addEventListener('click', hideProfileModal);
    document.getElementById('pm-cancel-btn')?.addEventListener('click', hideProfileModal);
    modal.querySelector('.pm-backdrop')?.addEventListener('click', () => {
      if (canCancel) hideProfileModal();
    });
  }

  function hideProfileModal() {
    const modal = document.getElementById('profile-modal');
    if (modal) modal.classList.remove('visible');
    _profileDraft = null;
  }

  function applyProfile(draft) {
    const prevRace = state.profile.race;
    state.profile.name = draft.name.trim();
    state.profile.race = draft.race;

    // Handle race change effects
    if (draft.race !== prevRace) {
      if (draft.race === 'singer') {
        applySingerFreeSkills();
      } else {
        removeSingerFreeSkills();
      }
    }

    renderSidebar();
    renderClassTabs();
    rebuildTree();
  }

  // ---- INIT (async - waits for skills JSON) ----
  async function init() {
    await CosData.loadSkills();
    await CosData.loadRadiantSkills();
    await CosData.loadAdditionalSkills();
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

    // Hide loading, then show profile modal if no name yet
    setTimeout(() => {
      const loading = document.getElementById('loading');
      if (loading) {
        loading.classList.add('fade-out');
        setTimeout(() => {
          loading.remove();
          if (!state.profile.name) showProfileModal(false);
        }, 600);
      }
    }, 800);
  }

  function bindUI() {
    const nameInput = document.getElementById('char-name');
    if (nameInput) {
      nameInput.addEventListener('input', e => { state.profile.name = e.target.value; });
    }

    document.getElementById('btn-edit-profile')?.addEventListener('click', () => {
      showProfileModal(true);
    });

    function toggleSidebar() {
      document.getElementById('sidebar').classList.toggle('closed');
      document.getElementById('viewport').classList.toggle('expanded');
      document.body.classList.toggle('sidebar-closed');
      setTimeout(() => window.dispatchEvent(new Event('resize')), 310);
    }

    document.getElementById('sidebar-toggle')?.addEventListener('click', toggleSidebar);
    document.getElementById('sidebar-reopen')?.addEventListener('click', toggleSidebar);

    document.getElementById('lvl-up')?.addEventListener('click', () => {
      // Bloqueia o up se houver pontos pendentes (Mantivemos a sua regra de segurança!)
      if (getAttrPointsRemaining() > 0) {
        notify('Gaste todos os seus pontos de atributo disponíveis antes de subir de nível!');
        return;
      }
      if (getPericiaPointsRemaining() > 0) {
        notify('Gaste todos os seus pontos de perícia disponíveis antes de subir de nível!');
        return;
      }

      if (state.profile.level < 30) {
        state.profile.level++;
        renderSidebar();
        rebuildTree(true);
      }
    });

    document.getElementById('lvl-down')?.addEventListener('click', () => {
      if (state.profile.level > 1) {
        state.profile.level--;
        
        // Se voltou para o Nível 1, reduz atributos que passaram do limite de 3
        if (state.profile.level === 1) {
          for (const key in state.attributes) {
            if (state.attributes[key] > 3) {
              state.attributes[key] = 3;
            }
          }
        }
        
        renderSidebar();
        rebuildTree(true);
      }
    });

    document.getElementById('btn-save')?.addEventListener('click', showSavesModal);
    document.getElementById('btn-load')?.addEventListener('click', showSavesModal);
    document.getElementById('btn-import-pdf')?.addEventListener('click', importFromPDF);
    document.getElementById('btn-reset')?.addEventListener('click', resetProfile);
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

  // ---- PÁGINA VISUAL DO PDF (gráficos + mapa de habilidades) ----

  const _PDF_CLASS_COLORS = {
    'Agente':    [0.1, 0.6, 0.3], 'Emissário': [0.8, 0.6, 0.0],
    'Caçador':   [0.8, 0.2, 0.2], 'Líder':     [0.1, 0.4, 0.8],
    'Erudito':   [0.4, 0.3, 0.8], 'Guerreiro': [0.8, 0.4, 0.1],
    'Corredor dos Ventos':       [0.1, 0.5, 0.8],
    'Rompe-Céu':                 [0.8, 0.6, 0.1],
    'Pulverizador':              [0.8, 0.2, 0.2],
    'Dançarino dos Precipícios': [0.1, 0.6, 0.4],
    'Sentinela da Verdade':      [0.1, 0.6, 0.5],
    'Teceluz':                   [0.7, 0.4, 0.8],
    'Alternauta':                [0.4, 0.4, 0.5], 
    'Plasmador':                 [0.5, 0.3, 0.8],
    'Guardião das Pedras':       [0.5, 0.3, 0.2],
    'Cantor':                    [0.7, 0.3, 0.2],
  };

  const _PDF_CLASS_ABBREV = {
    'Agente':'Agente','Emissário':'Emissário','Caçador':'Caçador','Líder':'Líder',
    'Erudito':'Erudito','Guerreiro':'Guerreiro','Corredor dos Ventos':'Corre Ventos',
    'Rompe-Céu':'Rompe céu','Pulverizador':'Pulverizador','Dançarino dos Precipícios':'Dançarino',
    'Sentinela da Verdade':'Sentinela','Teceluz':'Teceluz','Alternauta':'Alternauta',
    'Plasmador':'Plasmador','Guardião das Pedras':'Guardião','Cantor':'Cantor',
  };
  

  // Gráfico estrela (radar)
  function _drawRadarPdf(page, cx, cy, R, labels, values, maxVal, cr, font, fontBold, title) {
    const { rgb } = PDFLib;
    const N = labels.length;
    // O ângulo 0 começa no topo (Math.PI/2) e gira no sentido horário
    const ang = i => Math.PI / 2 - (2 * Math.PI * i / N);

    // Título do gráfico
    const tw = fontBold.widthOfTextAtSize(title, 7);
    page.drawText(title, { x: cx - tw/2, y: cy + R + 15, size: 7,
      font: fontBold, color: rgb(0.15, 0.15, 0.15) }); // Corrigido para fundo branco

    // O "centro" do radar agora será um círculo inicial vazado (15% do raio total)
    // para que as habilidades comecem no anel "1", sem ficarem coladas num único ponto.
    const innerR = R * 0.15;
    const usableR = R - innerR;
    
    // Função que mapeia os valores de 0 até maxVal, começando a partir do anel interno
    const getRad = (val) => innerR + (Math.min(val / maxVal, 1) * usableR);

    // Anéis de escala (5 marcações: centro, 2, 3, 4 e Borda)
    const fractions = [0, 0.25, 0.5, 0.75, 1.0]; 
    fractions.forEach(f => {
      const r = innerR + (f * usableR);
      const path = Array.from({length: N}, (_, i) =>
        `${i===0?'M':'L'} ${(Math.cos(ang(i))*r).toFixed(1)} ${(-Math.sin(ang(i))*r).toFixed(1)}`
      ).join(' ') + ' Z';
      
      // Bordas clareadas para se integrarem melhor ao fundo branco
      page.drawSvgPath(path, { x: cx, y: cy, borderColor: rgb(0.85, 0.85, 0.85), borderWidth: 0.5 });
    });

    // Eixos radiais (começam no innerR e vão até a borda R)
    for (let i = 0; i < N; i++) {
      page.drawLine({ 
        start: { x: cx + Math.cos(ang(i))*innerR, y: cy + Math.sin(ang(i))*innerR },
        end:   { x: cx + Math.cos(ang(i))*R,      y: cy + Math.sin(ang(i))*R },
        color: rgb(0.85, 0.85, 0.85), thickness: 0.5 
      });
    }

    // Polígono de dados (a "capa")
    const dpath = Array.from({length: N}, (_, i) => {
      const r = getRad(values[i]);
      return `${i===0?'M':'L'} ${(Math.cos(ang(i))*r).toFixed(1)} ${(-Math.sin(ang(i))*r).toFixed(1)}`;
    }).join(' ') + ' Z';
    
    page.drawSvgPath(dpath, { x: cx, y: cy,
      color: rgb(cr[0],cr[1],cr[2]), opacity: 0.20,
      borderColor: rgb(cr[0],cr[1],cr[2]), borderWidth: 1.4, borderOpacity: 0.90 });

    // Pontos nos vértices + rótulos
    for (let i = 0; i < N; i++) {
      const r = getRad(values[i]);
      const px = cx + Math.cos(ang(i))*r;
      const py = cy + Math.sin(ang(i))*r; 
      
      // Desenha a bolinha (nó do atributo/trilha)
      page.drawEllipse({ x: px, y: py, xScale: 2.3, yScale: 2.3, color: rgb(cr[0],cr[1],cr[2]) });
      
      // Posição do texto (um pouco além da borda externa)
      const lx = cx + Math.cos(ang(i))*(R + 12);
      const ly = cy + Math.sin(ang(i))*(R + 12); 
      
      const lw = font.widthOfTextAtSize(labels[i], 6.5);
      page.drawText(labels[i], { x: lx - lw/2, y: ly - 3, size: 6.5,
        font, color: rgb(0.2, 0.2, 0.2) });
    }
  }

  function _drawSkillMapPdf(page, cx, cy, mapR, _font, fontBold) {
    const { rgb } = PDFLib;

    // Montar entradas
    const entries = [];
    CosData.CLASSES.forEach(cls => {
      const g = CosData.buildGraph(cls);
      entries.push({ cls, skills: g.skills, children: g.children, isRadiant: false });
    });
    if (state.profile.radiantClass && CosData.buildRadiantGraph) {
      const g = CosData.buildRadiantGraph(state.profile.radiantClass);
      entries.push({ cls: state.profile.radiantClass, skills: g.skills, children: g.children, isRadiant: true });
    }

    const numE    = entries.length;
    const rootR   = mapR * 0.18;
    const outerR  = mapR * 0.88;
    const sectH   = (Math.PI / numE) * 0.80; // Margem de segurança de ângulo entre classes

    // Anéis decorativos de fundo
    [0.22, 0.54, 0.88].forEach(f => {
      page.drawEllipse({ x: cx, y: cy, xScale: mapR*f, yScale: mapR*f,
        borderColor: rgb(0.9, 0.9, 0.9), borderWidth: 0.6 });
    });

    // Raios (spokes) divisórios sutis
    entries.forEach((_, idx) => {
      const a = Math.PI/2 - (2*Math.PI*idx/numE) + (Math.PI/numE); 
      page.drawLine({
        start: { x: cx + Math.cos(a)*rootR, y: cy + Math.sin(a)*rootR },
        end:   { x: cx + Math.cos(a)*outerR, y: cy + Math.sin(a)*outerR },
        color: rgb(0.94, 0.94, 0.94), thickness: 0.5 });
    });

    // Calcular posições agrupando por Rank para garantir espaçamento
    const positions = {};
    entries.forEach(({ cls, skills, isRadiant }, idx) => {
      const angleCenter = Math.PI/2 - (2*Math.PI*idx/numE);
      const root = skills.find(s => s.rank === 0);
      if (!root) return;
      
      positions[root.id] = { x: cx + Math.cos(angleCenter)*rootR, y: cy + Math.sin(angleCenter)*rootR };
      const nodeAngles = { [root.id]: angleCenter };

      // Agrupar habilidades por rank
      const byRank = {};
      skills.forEach(s => {
        if (s.rank > 0) {
          if (!byRank[s.rank]) byRank[s.rank] = [];
          byRank[s.rank].push(s);
        }
      });
      
      const findFn = isRadiant ? CosData.findRadiantSkillByName : CosData.findSkillByName;
      
      for (let rank = 1; rank <= 5; rank++) {
        if (!byRank[rank]) continue;
        const nodes = byRank[rank];
        
        // Ordena baseando-se nos pais para minimizar linhas cruzadas
        nodes.forEach(node => {
          let sum = 0, count = 0;
          node.deps.forEach(d => {
            const p = findFn(d, cls);
            if (p && nodeAngles[p.id] !== undefined) {
              sum += nodeAngles[p.id];
              count++;
            }
          });
          node._tAng = count > 0 ? (sum / count) : angleCenter;
        });
        nodes.sort((a, b) => a._tAng - b._tAng);
        
        // Distribui uniformemente no arco da classe
        nodes.forEach((node, i) => {
          let t = 0;
          if (nodes.length > 1) {
            t = (i / (nodes.length - 1)) - 0.5; // De -0.5 a 0.5
          }
          const finalAng = angleCenter + t * (sectH * 2);
          nodeAngles[node.id] = finalAng;
          
          let r = rootR + (rank / 5) * (outerR - rootR);
          
          // ZIGZAG: Se houver muitos nós no mesmo rank, alternamos o raio 
          // para afastar os nós fisicamente e não deixá-los se tocando
          if (nodes.length > 2) {
             r += (i % 2 === 0) ? 3.5 : -3.5;
          }
          
          positions[node.id] = {
             x: cx + Math.cos(finalAng) * r,
             y: cy + Math.sin(finalAng) * r
          };
        });
      }
    });

    // Conexões (linhas) - desenhadas primeiro para ficarem embaixo
    entries.forEach(({ cls, skills, isRadiant }) => {
      const findFn = isRadiant ? CosData.findRadiantSkillByName : CosData.findSkillByName;
      const clr = _PDF_CLASS_COLORS[cls] || [0.4, 0.4, 0.4];
      skills.forEach(skill => {
        const to = positions[skill.id]; if (!to) return;
        skill.deps.forEach(depName => {
          const parent = findFn(depName, cls); if (!parent) return;
          const from = positions[parent.id]; if (!from) return;
          const active = state.unlockedSkills.has(skill.id) && state.unlockedSkills.has(parent.id);
          page.drawLine({ start: {x: from.x, y: from.y}, end: {x: to.x, y: to.y},
            color: active ? rgb(clr[0],clr[1],clr[2]) : rgb(0.88, 0.88, 0.88),
            thickness: active ? 1.0 : 0.5 });
        });
      });
    });

    // Nós (bolinhas) - Tamanho reduzido para melhor leitura
    entries.forEach(({ cls, skills }) => {
      const clr = _PDF_CLASS_COLORS[cls] || [0.4, 0.4, 0.4];
      skills.forEach(skill => {
        const pos = positions[skill.id]; if (!pos) return;
        const unlocked = state.unlockedSkills.has(skill.id);
        const nr = skill.rank === 0 ? 3.2 : 1.6; // Raios menores
        if (unlocked) {
          page.drawEllipse({ x: pos.x, y: pos.y, xScale: nr, yScale: nr,
            color: rgb(clr[0],clr[1],clr[2]) });
        } else {
          page.drawEllipse({ x: pos.x, y: pos.y, xScale: nr, yScale: nr,
            color: rgb(1, 1, 1),
            borderColor: rgb(0.65, 0.65, 0.65), borderWidth: 0.7 });
        }
      });
    });

    // Rótulos das classes
    entries.forEach(({ cls }, idx) => {
      const a   = Math.PI/2 - (2*Math.PI*idx/numE);
      const lx  = cx + Math.cos(a)*(outerR + 12);
      const ly  = cy + Math.sin(a)*(outerR + 12);
      const clr = _PDF_CLASS_COLORS[cls] || [0.4, 0.4, 0.4];
      const lbl = _PDF_CLASS_ABBREV[cls] || cls.slice(0,3).toUpperCase();
      const lw  = fontBold.widthOfTextAtSize(lbl, 6.5);
      page.drawText(lbl, { x: lx - lw/2, y: ly - 3, size: 6.5,
        font: fontBold, color: rgb(clr[0]*0.8, clr[1]*0.8, clr[2]*0.8) });
    });
  }

  async function addVisualPage(pdfDoc) {
    const { rgb, StandardFonts } = PDFLib;
    const font     = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const W = 595, H = 842;
    const page = pdfDoc.addPage([W, H]);

    // Fundo branco para impressão limpa
    page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: rgb(1, 1, 1) });

    // Título
    const titleTxt = `MAPA — ${state.profile.name || 'Personagem'}  ·  Nível ${state.profile.level}`;
    const tw = fontBold.widthOfTextAtSize(titleTxt, 10);
    page.drawText(titleTxt, { x: W/2 - tw/2, y: H - 21, size: 10,
      font: fontBold, color: rgb(0.83, 0.66, 0.33) });

    // ---- GRÁFICOS RADAR (Aumentados e sem linhas de separação) ----
    const chartCy = H - 115; // Posicionado um pouco mais abaixo para acomodar o novo tamanho
    const chartR  = 80;      // Aumentado de 60 para 80

    // Atributos (esquerda)
    const attrLabels = ['FOR','VEL','INT','VON','CON','PRE'];
    const attrVals   = [
      state.attributes.forca,      state.attributes.velocidade,
      state.attributes.intelecto,  state.attributes.vontade,
      state.attributes.consciencia,state.attributes.presenca,
    ];
    _drawRadarPdf(page, 148, chartCy, chartR, attrLabels, attrVals, 10,
      [0.24, 0.61, 0.89], font, fontBold, 'ATRIBUTOS');

    // [LINHA REMOVIDA] Divisor vertical entre os dois gráficos

    // Trilhas heróicas (direita)
    const allSkillsForPdf = [...CosData.SKILLS, ...(CosData.RADIANT_SKILLS || [])];
    const clsTotal = {}, clsUnlocked = {};
    allSkillsForPdf.forEach(sk => {
      clsTotal[sk.cls]    = (clsTotal[sk.cls]    || 0) + 1;
      if (state.unlockedSkills.has(sk.id))
        clsUnlocked[sk.cls] = (clsUnlocked[sk.cls] || 0) + 1;
    });
    const trackClasses = [...CosData.CLASSES];
    if (state.profile.radiantClass) trackClasses.push(state.profile.radiantClass);
    const trackLabels = trackClasses.map(c => _PDF_CLASS_ABBREV[c] || c.slice(0,3).toUpperCase());
    const trackVals   = trackClasses.map(c => ((clsUnlocked[c]||0) / (clsTotal[c]||1)) * 10);
    _drawRadarPdf(page, 447, chartCy, chartR, trackLabels, trackVals, 10,
      [0.83, 0.66, 0.33], font, fontBold, 'TRILHAS HERÓICAS');
      
    // ---- MAPA DE HABILIDADES (restante da página) ----
    // Ajustado o topo da área do mapa para dar margem aos radares maiores
    const mapAreaH = H - 210 - 22; 
    const mapCy    = 22 + mapAreaH * 0.48;
    const mapR     = Math.min(W/2 - 35, mapAreaH/2 - 25);
    _drawSkillMapPdf(page, W/2, mapCy, mapR, font, fontBold);
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

      // Página visual (gráficos estrela + mapa de habilidades)
      await addVisualPage(pdfDoc);

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
