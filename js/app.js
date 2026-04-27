// ============================================================
// Cosmere RPG Skill Tree - Application Logic
// Profile system, state management, UI binding
// ============================================================

const App = (() => {

  // ---- RADIANT WHEEL DATA ----
  // Vinculadores at index 0 = top (12h / norte). 10 ordens em círculo completo.
  const WHEEL_ORDERS = [
    'Vinculadores',
    'Corredor dos Ventos', 'Rompe-Céu', 'Pulverizador',
    'Dançarino de Precipícios', 'Sentinela da Verdade',
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
    'Dançarino de Precipícios': 'svg/Edgedancers_glyph.svg',
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
      pulverizadorCanone: null, // true = segue o Cânone, false = não segue, null = não perguntado
      rompeCeuCanone: null,     // true = segue o Cânone, false = não segue, null = não perguntado
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
      sum -= keys.length; // 1 rank gratuito por surto ao escolher a ordem
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
    // Humanos: +1 bônus ancestral (1º = Rank 0 de classe mundana, 2º = mesma classe)
    // Cantores: +1 bônus (Mudar Forma grátis, 1º = nova forma Cantor, 2º = Rank 0 classe mundana)
    if (state.profile.level >= 1 && (state.profile.race === 'human' || state.profile.race === 'singer')) {
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
      if (row.level > p.level) break;

      if (typeof row.hpGain === 'string' && row.hpGain.includes('+FOR')) {
        maxHealth += parseInt(row.hpGain.split('+')[0]) + a.forca;
      } else {
        maxHealth += Number(row.hpGain) || 0;
      }
    }
    if (p.radiantClass === 'Rompe-Céu' && p.rompeCeuCanone === true) {
      maxHealth += p.level;
    }

    const maxFocus = 2 + a.vontade;

    const maxInvestiture = p.radiantClass
      ? 2 + (a.consciencia >= a.presenca ? a.consciencia : a.presenca)
      : 0;

    const tier = CosData.LEVEL_TABLE.find(r => r.level === p.level)?.tier || 1;
    let focoMaxCanone = null;
    if (p.radiantClass === 'Pulverizador' && p.pulverizadorCanone === true) {
      focoMaxCanone = Math.ceil(tier / 2);
    } else if (p.radiantClass === 'Rompe-Céu' && p.rompeCeuCanone === true) {
      focoMaxCanone = tier;
    }

    return {
      maxHealth, maxFocus, maxInvestiture, focoMaxCanone,
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
      ${stats.focoMaxCanone !== null ? `<div class="stat-row"><span class="stat-label"><span class="stat-dot" style="background:#ef4444;"></span>Foco Cânone</span> <strong class="stat-val" style="color:#ef4444;">${stats.focoMaxCanone}</strong></div>` : ''}
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
  function _singerHasNovaForma() {
    const addSkills = CosData.ADDITIONAL_SKILLS || [];
    const cantorIds = new Set(addSkills.filter(s => s.cls === 'Cantor').map(s => s.id));
    for (const id of state.unlockedSkills) {
      if (!state.singerFreeIds.has(id) && cantorIds.has(id)) return true;
    }
    return false;
  }

  function canUnlockAdditionalSkill(skill) {
    if (state.unlockedSkills.has(skill.id)) return { can: false, reason: 'Já desbloqueado' };

    if (skill.cls === 'Cantor' && state.singerFreeIds.has(skill.id)) {
      return { can: false, reason: 'Concedido automaticamente pela ancestralidade Cantor' };
    }
    if (skill.cls === 'Cantor' && state.profile.race !== 'singer') {
      return { can: false, reason: 'Requer ancestralidade Cantor' };
    }
    // Singer: após comprar nova forma, deve comprar talento de classe antes de mais formas
    if (skill.cls === 'Cantor' && state.profile.race === 'singer' && _singerHasNovaForma() && !state.profile.ancestryClass) {
      return { can: false, reason: 'Cantor: compre um talento de classe mundana primeiro' };
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

    // Singer ancestry restriction
    if (state.profile.race === 'singer') {
      if (!_singerHasNovaForma()) {
        return { can: false, reason: 'Cantor: escolha uma Nova Forma primeiro' };
      }
      if (!state.profile.ancestryClass) {
        if (skill.rank !== 0 || !CosData.CLASSES.includes(skill.cls)) {
          return { can: false, reason: 'Cantor: 2º talento deve ser Rank 0 de classe mundana' };
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
    // pois remover uma cópia remove todas as cópias compartilhadas.
    // Um filho só bloqueia a remoção se ficar SEM nenhum outro dep satisfeito (lógica OR).
    if (!isRadiantSkill(skill)) {
      const orphanedChild = CosData.SKILLS.some(s => {
        if (!s.deps.includes(skill.name)) return false;
        if (!state.unlockedSkills.has(s.id)) return false;
        // Verifica se o filho ainda teria algum outro dep satisfeito após a remoção
        const stillSatisfied = s.deps.some(depName => {
          if (depName === skill.name) return false;
          const dep = CosData.findSkillByName(depName, s.cls);
          if (!dep || !state.unlockedSkills.has(dep.id)) return false;
          if (state.freeUnlockedSkills.has(dep.id)) {
            return dep.deps.every(ddName => {
              const dd = CosData.findSkillByName(ddName, s.cls);
              return dd && state.unlockedSkills.has(dd.id);
            });
          }
          return true;
        });
        return !stillSatisfied;
      });
      if (orphanedChild) return { can: false, reason: 'Outro talento depende exclusivamente deste' };
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

  async function toggleSkill(skill) {
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

      // Animações de ideal radiante
      if (radiant) {
        const isSegundo = skill.name.includes('Segundo Ideal');
        const isTerceiro = skill.name.includes('Terceiro Ideal');
        const isQuarto = skill.name.includes('Quarto Ideal');

        if (isSegundo || isTerceiro || isQuarto) {
          const cls   = state.profile.radiantClass;

          // Auto-grant de surto bloqueado pelo Cânone ao atingir o ideal que o libera
          if (cls === 'Pulverizador' && state.profile.pulverizadorCanone === true) {
            if (isSegundo) state.radiantPericias['divisao'] = 1;
          }
          if (cls === 'Rompe-Céu' && state.profile.rompeCeuCanone === true) {
            if (isSegundo) state.radiantPericias['gravitacao'] = 1;
            if (isTerceiro) state.radiantPericias['divisao'] = 1;
          }

          const color = clsColor(cls) || '#d4a853';
          const svgText  = _wheelSvgCache[WHEEL_SVG_MAP[cls]] || null;
          const glyphSrc = coloredSvgSrc(svgText, color) || (WHEEL_SVG_MAP[cls] || '');

          const isTeceluz = cls === 'Teceluz';
          // const isQuarto  = skill.name === 'Quarto Ideal';
          const needsPersonalOath = isQuarto || isTeceluz;

          if (needsPersonalOath) {
            if (!state.profile.radiantOaths) state.profile.radiantOaths = {};
            const text = await _showPersonalOathModal(cls, color, glyphSrc, skill.name);
            state.profile.radiantOaths[skill.name] = text;
          } else {
            const oathData = CosData.getOathData(cls);
            //const oathKey  = skill.name === 'Segundo Ideal' ? '2_oath' : '3_oath';
            const oathKey  = isSegundo ? '2_oath' : '3_oath';
            const phrase   = oathData && oathData[oathKey] ? oathData[oathKey] : null;
            await _showOathAnimation(cls, color, glyphSrc, phrase ? [phrase] : null);
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
          ${skill.activation ? `<div class="modal-activation">${ActivationIcons.badge(skill.activation)}</div>` : ''}
          <div class="modal-desc-section">
            <div class="modal-desc-label">Descrição</div>
            <div class="modal-desc-text">${skill.description || '<em style="color:var(--text-muted);font-size:12px;">Carregue o livro em PDF na barra lateral para ver a descrição completa.</em>'}</div>
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
      actionBtn.addEventListener('click', async () => {
        const success = await toggleSkill(skill);
        if (success) {
          hideSkillModal();
          rebuildTree(true);
          renderSidebar();
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
    renderTalents();
    renderPortrait();
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

  // ---- RENDER TALENTS ----
  function renderTalents() {
    const container = document.getElementById('talents-list');
    if (!container) return;

    // Collect all unlocked skills with metadata
    const allPools = [
      { pool: CosData.SKILLS,            type: 'mundane'   },
      { pool: CosData.RADIANT_SKILLS,    type: 'radiant'   },
      { pool: CosData.ADDITIONAL_SKILLS, type: 'additional'},
    ];

    // Map id → skill object for fast lookup
    const byId = new Map();
    for (const { pool } of allPools) {
      for (const s of pool) byId.set(s.id, s);
    }

    // Coleta todos, avaliaremos o empate garantindo que sua classe escolhida vença
    const candidateSkills = [];
    for (const id of state.unlockedSkills) {
      if (state.singerFreeIds.has(id)) continue;
      const skill = byId.get(id);
      if (skill) candidateSkills.push(skill);
    }

    const classDirectCount = {};
    for (const sk of candidateSkills) {
      if (!state.freeUnlockedSkills.has(sk.id)) {
        classDirectCount[sk.cls] = (classDirectCount[sk.cls] || 0) + 1;
      }
    }

    const seenNames = new Map(); 
    const grouped = {};         
    const radiantCls = state.profile.radiantClass;
    const ancestryCls = state.profile.ancestryClass;

    for (const skill of candidateSkills) {
      const prev = seenNames.get(skill.name);
      if (prev) {
        let replace = false;

        // Prioridade 1: Pertence à classe radiante selecionada (ex: Pulverizador)
        if (skill.cls === radiantCls && prev.cls !== radiantCls) {
          replace = true;
        }
        // Prioridade 2: Pertence à classe da trilha inicial
        else if (skill.cls === ancestryCls && prev.cls !== ancestryCls && prev.cls !== radiantCls) {
          replace = true;
        }
        // Prioridade 3: Desempate por compra direta padrão / quantidade
        else if (prev.cls !== radiantCls && prev.cls !== ancestryCls) {
          const prevIsFree = state.freeUnlockedSkills.has(prev.id);
          const skillIsFree = state.freeUnlockedSkills.has(skill.id);
          
          if (prevIsFree && !skillIsFree) {
            replace = true;
          } else if (prevIsFree === skillIsFree) {
            const prevCount = classDirectCount[prev.cls] || 0;
            const newCount  = classDirectCount[skill.cls] || 0;
            if (newCount > prevCount) replace = true;
          }
        }

        if (replace) {
          const oldArr = grouped[prev.cls];
          if (oldArr) {
            const idx = oldArr.findIndex(s => s.name === skill.name);
            if (idx >= 0) oldArr.splice(idx, 1);
            if (oldArr.length === 0) delete grouped[prev.cls];
          }
          seenNames.set(skill.name, skill);
          if (!grouped[skill.cls]) grouped[skill.cls] = [];
          grouped[skill.cls].push(skill);
        }
      } else {
        seenNames.set(skill.name, skill);
        if (!grouped[skill.cls]) grouped[skill.cls] = [];
        grouped[skill.cls].push(skill);
      }
    }

    const classes = Object.keys(grouped);

    if (classes.length === 0) {
      container.innerHTML = `<div class="talents-empty">Nenhum talento desbloqueado</div>`;
      return;
    }

    // Sort classes: mundane first (alphabetical), then radiantes, then additional
    const mundaneClasses   = CosData.CLASSES || [];
    const radiantClasses   = CosData.RADIANT_CLASSES || [];

    classes.sort((a, b) => {
      const ia = mundaneClasses.indexOf(a);
      const ib = mundaneClasses.indexOf(b);
      if (ia >= 0 && ib >= 0) return ia - ib;
      if (ia >= 0) return -1;
      if (ib >= 0) return 1;
      const ra = radiantClasses.indexOf(a);
      const rb = radiantClasses.indexOf(b);
      if (ra >= 0 && rb >= 0) return ra - rb;
      if (ra >= 0) return -1;
      if (rb >= 0) return 1;
      return a.localeCompare(b);
    });

    let html = '';
    for (const cls of classes) {
      const skills = grouped[cls];
      const clr = clsColor(cls);
      html += `
        <div class="talents-group">
          <div class="talents-group-header" style="color:${clr}">
            <span class="talents-group-dot" style="background:${clr}"></span>
            ${cls}
            <span class="talents-group-count">${skills.length}</span>
          </div>
          <ul class="talents-group-list">
            ${skills.map(s => `
              <li class="talent-item">
                <span class="talent-rank">R${s.rank}</span>
                <span class="talent-name">${s.name}</span>
              </li>`).join('')}
          </ul>
        </div>`;
    }
    container.innerHTML = html;
  }

  // ---- RENDER PORTRAIT ----
  function renderPortrait() {
    const wrap = document.getElementById('char-portrait');
    const clearBtn = document.getElementById('char-portrait-clear');
    if (!wrap) return;
    const portrait = state.profile.portrait || null;
    if (portrait) {
      // Show image
      let img = wrap.querySelector('img.char-portrait-img');
      if (!img) {
        wrap.innerHTML = '';
        img = document.createElement('img');
        img.className = 'char-portrait-img';
        wrap.appendChild(img);
      }
      if (img.src !== portrait) img.src = portrait;
      if (clearBtn) clearBtn.style.display = 'block';
    } else {
      // Show placeholder
      const hasPlaceholder = wrap.querySelector('.char-portrait-placeholder');
      if (!hasPlaceholder) {
        wrap.innerHTML = `
          <svg class="char-portrait-placeholder" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="20" cy="15" r="7" stroke="currentColor" stroke-width="1.5" fill="none" opacity="0.4"/>
            <path d="M6 36c0-7.732 6.268-14 14-14s14 6.268 14 14" stroke="currentColor" stroke-width="1.5" fill="none" opacity="0.4"/>
          </svg>
          <div class="char-portrait-hint">Aparência</div>`;
      }
      if (clearBtn) clearBtn.style.display = 'none';
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

  function _showOathAnimation(cls, color, glyphSrc, customPhrases) {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.id = 'radiant-oath-overlay';

      overlay.style.setProperty('--oath-color', color);

      const PHRASES = customPhrases || [
        'Vida antes da Morte',
        'Força antes da Fraqueza',
        'Jornada antes do Destino',
      ];

      const single = PHRASES.length === 1;

      // 1. O SEGREDO: Divide a frase em <span> individuais para cada letra poder acender
      const formatPhrase = text => text.split('').map(char => {
        if (char === ' ') return `<span style="display:inline-block; width:0.4em;">&nbsp;</span>`;
        return `<span class="oath-letter">${char}</span>`;
      }).join('');

      overlay.innerHTML = `
        <div class="oath-glyph-wrap">
          <img src="${glyphSrc}" alt="${cls}">
        </div>
        <div class="oath-phrases">
          ${PHRASES.map(p => `<div class="oath-phrase${single ? ' oath-phrase--single' : ''}">${formatPhrase(p)}</div>`).join('')}
        </div>
        <div class="oath-order-name">${cls}</div>
      `;

      document.body.appendChild(overlay);

      const glyph   = overlay.querySelector('.oath-glyph-wrap');
      const phrases = overlay.querySelectorAll('.oath-phrase');
      const orderName = overlay.querySelector('.oath-order-name');

      // 2. GERADOR DE VÓRTICE DE LUZ (Condensação 360º)
      function animatePhraseFormation(phraseEl) {
        setTimeout(() => {
          const letters = phraseEl.querySelectorAll('.oath-letter');
          
          letters.forEach((letter, index) => {
            const letterDelay = index * 50; // Levemente mais rápido para um fluxo épico
            const rect = letter.getBoundingClientRect();
            if (rect.width === 0) return;

            // 4 partículas por letra para dar mais volume à espiral
            for (let i = 0; i < 4; i++) {
              const p = document.createElement('div');
              p.className = 'wind-particle';
              
              const size = Math.random() * 3 + 1.5;
              p.style.width = size + 'px';
              p.style.height = size + 'px';
              overlay.appendChild(p);

              // DESTINO: O centro da letra
              const endX = rect.left + rect.width / 2;
              const endY = rect.top + rect.height / 2;

              // ORIGEM: Nasce em um ângulo totalmente aleatório (360º) ao redor da tela
              const startAngle = Math.random() * Math.PI * 2;
              const startDist = 250 + Math.random() * 400; // Entre 250px e 650px de distância
              
              const startX = endX + Math.cos(startAngle) * startDist;
              const startY = endY + Math.sin(startAngle) * startDist;

              // A CURVA (Vórtice): Para não ir em linha reta, criamos um ponto intermediário
              // que gira o ângulo original em uns 45º a 90º, fazendo a luz "rodopiar" para dentro
              const direction = Math.random() > 0.5 ? 1 : -1;
              const midAngle = startAngle + direction * (Math.PI / 3 + Math.random() * Math.PI / 4);
              const midDist = startDist * 0.4; // Mais perto do centro
              
              const midX = endX + Math.cos(midAngle) * midDist;
              const midY = endY + Math.sin(midAngle) * midDist;

              const duration = 1000 + Math.random() * 600; 
              const pDelay = letterDelay + Math.random() * 200;

              // Animação em 4 estágios fluidos
              p.animate([
                { transform: `translate(${startX}px, ${startY}px) scale(0)`, opacity: 0 },
                { transform: `translate(${midX}px, ${midY}px) scale(1.2)`, opacity: 0.8, offset: 0.4 }, // Puxado pela espiral
                { transform: `translate(${endX}px, ${endY}px) scale(1.5)`, opacity: 1, offset: 0.85 },  // IMPACTO na letra
                { transform: `translate(${endX}px, ${endY - 40 - Math.random()*30}px) scale(0)`, opacity: 0 } // Evapora pra CIMA (Stormlight genuína)
              ], {
                duration: duration,
                delay: pDelay,
                easing: 'ease-in-out',
                fill: 'forwards'
              });

              setTimeout(() => p.remove(), pDelay + duration + 100);

              // Acende a letra no momento exato em que a espiral se condensa
              if (i === 0) { 
                setTimeout(() => {
                  letter.classList.add('glow-in');
                }, pDelay + (duration * 0.85));
              }
            }
          });
        }, 50);
      }

      // Timing adaptado para a formação das letras (um pouco mais longo)
      const PHRASE_DELAY = single ? [950] : [950, 2400, 3850];
      const orderDelay   = single ? 3500 : 5800; 
      const fadeDelay    = single ? 5500 : 7000;

      requestAnimationFrame(() => {
        overlay.classList.add('visible');
        setTimeout(() => { glyph.classList.add('show'); }, 100);
        setTimeout(() => { glyph.classList.add('pulsing'); }, 800);

        phrases.forEach((el, i) => {
          setTimeout(() => {
            phrases.forEach((p, j) => { if (j < i) p.classList.add('dim'); });
            
            el.classList.add('show');
            // 3. O DISPARO DA MAGIA!
            animatePhraseFormation(el); 
            
          }, PHRASE_DELAY[i]);
        });

        setTimeout(() => {
          phrases.forEach(p => p.classList.add('dim'));
          orderName.classList.add('show');
        }, orderDelay);

        setTimeout(() => {
          overlay.classList.add('fade-out');
          setTimeout(() => {
            overlay.remove();
            resolve();
          }, 600);
        }, fadeDelay);
      });
    });
  }

  function _showPersonalOathModal(cls, color, glyphSrc, idealName) {
    return new Promise(resolve => {
      const oathData = CosData.getOathData(cls);
      const philosophy = oathData ? oathData.philosophy : '';

      const overlay = document.createElement('div');
      overlay.id = 'personal-oath-overlay';
      overlay.innerHTML = `
        <div class="personal-oath-modal" style="--oath-color:${color}">
          <div class="personal-oath-glyph">
            <img src="${glyphSrc}" alt="${cls}" style="filter:drop-shadow(0 0 16px ${color});width:72px;height:72px;">
          </div>
          <div class="personal-oath-header">
            <div class="personal-oath-ideal-name">${idealName}</div>
            <div class="personal-oath-order">${cls}</div>
          </div>
          ${philosophy ? `<div class="personal-oath-philosophy">"${philosophy}"</div>` : ''}
          <div class="personal-oath-divider"></div>
          <p class="personal-oath-instruction">Declare seu juramento pessoal. Estas palavras são suas — fale-as com convicção.</p>
          <div class="personal-oath-input-wrap">
            <textarea
              id="personal-oath-textarea"
              class="personal-oath-textarea"
              placeholder="Escreva seu juramento aqui..."
              rows="4"
              maxlength="400"
            ></textarea>
            <div class="personal-oath-actions">
              <button class="personal-oath-mic" id="personal-oath-mic-btn" title="Falar juramento">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20">
                  <rect x="9" y="2" width="6" height="12" rx="3"/>
                  <path d="M5 10a7 7 0 0 0 14 0"/>
                  <line x1="12" y1="19" x2="12" y2="22"/>
                  <line x1="8" y1="22" x2="16" y2="22"/>
                </svg>
              </button>
              <button class="personal-oath-confirm" id="personal-oath-confirm-btn" disabled>
                Pronunciar Juramento
              </button>
            </div>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);
      requestAnimationFrame(() => overlay.classList.add('visible'));

      const textarea   = overlay.querySelector('#personal-oath-textarea');
      const confirmBtn = overlay.querySelector('#personal-oath-confirm-btn');
      const micBtn     = overlay.querySelector('#personal-oath-mic-btn');

      textarea.addEventListener('input', () => {
        confirmBtn.disabled = textarea.value.trim().length === 0;
      });

      // Speech recognition (Web Speech API)
      const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRec) {
        micBtn.style.display = 'none';
      } else {
        let recognition = null;
        let listening = false;
        micBtn.addEventListener('click', () => {
          if (listening) {
            recognition.stop();
            return;
          }
          recognition = new SpeechRec();
          recognition.lang = 'pt-BR';
          recognition.interimResults = false;
          recognition.maxAlternatives = 1;
          recognition.onstart = () => {
            listening = true;
            micBtn.classList.add('listening');
          };
          recognition.onresult = (e) => {
            const transcript = e.results[0][0].transcript;
            textarea.value = (textarea.value ? textarea.value + ' ' : '') + transcript;
            confirmBtn.disabled = textarea.value.trim().length === 0;
          };
          recognition.onend = () => {
            listening = false;
            micBtn.classList.remove('listening');
          };
          recognition.onerror = () => {
            listening = false;
            micBtn.classList.remove('listening');
          };
          recognition.start();
        });
      }

      confirmBtn.addEventListener('click', async () => {
        const text = textarea.value.trim();
        if (!text) return;
        overlay.classList.remove('visible');
        await new Promise(r => setTimeout(r, 350));
        overlay.remove();
        // Show the oath animation with the user's own words
        await _showOathAnimation(cls, color, glyphSrc, [text]);
        resolve(text);
      });
    });
  }

  async function selectRadiantOrder(cls) {
    state.profile.radiantClass = cls;
    state.profile.pulverizadorCanone = null;
    state.profile.rompeCeuCanone = null;
    // Limpa surtos anteriores e concede 1 rank gratuito em cada surto da nova ordem
    state.radiantPericias = {};
    const surgeKeys = CosData.RADIANT_CLASS_PERICIAS[cls] || [];
    for (const k of surgeKeys) state.radiantPericias[k] = 1;

    hideRadiantWheel();

    const color = clsColor(cls) || '#d4a853';
    const svgText = _wheelSvgCache[WHEEL_SVG_MAP[cls]] || null;
    const glyphSrc = coloredSvgSrc(svgText, color) || (WHEEL_SVG_MAP[cls] || '');

    await _showOathAnimation(cls, color, glyphSrc);

    if (cls === 'Pulverizador') {
      state.profile.pulverizadorCanone = await _showCanoneModal(color);
      if (state.profile.pulverizadorCanone === true) {
        state.radiantPericias['divisao'] = 0;
      }
    }
    if (cls === 'Rompe-Céu') {
      state.profile.rompeCeuCanone = await _showRompeCeuCanoneModal(color);
      if (state.profile.rompeCeuCanone === true) {
        state.radiantPericias['gravitacao'] = 0;
        state.radiantPericias['divisao'] = 0;
      }
    }

    await buildRadiantWheel();
    renderSidebar();
    renderClassTabs();
    rebuildTree();
  }

  function _showCanoneModal(color) {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.id = 'canone-modal-overlay';
      overlay.innerHTML = `
        <div class="canone-modal" style="--canone-color:${color}">
          <div class="canone-modal-glyph">
            <img src="svg/Dustbringers_glyph.svg" alt="Pulverizador" style="filter:drop-shadow(0 0 12px ${color});width:64px;height:64px;">
          </div>
          <h2 class="canone-modal-title" style="color:${color}">O Caminho do Cânone</h2>
          <p class="canone-modal-text">
            Os Pulverizadores foram perseguidos por séculos por causa do poder destrutivo da sua Surge de <strong>Divisão</strong>. Alguns escolhem seguir o <strong>Cânone</strong> — um código de autorregulação — para provar que são mais do que sua reputação.
          </p>
          <div class="canone-modal-choices">
            <button class="canone-btn canone-btn-no">
              <span class="canone-btn-label">Não seguir o Cânone</span>
              <span class="canone-btn-sub">Acesso completo à Divisão desde o início</span>
            </button>
            <button class="canone-btn canone-btn-yes" style="border-color:${color};box-shadow:0 0 12px ${color}40;">
              <span class="canone-btn-label" style="color:${color}">Seguir o Cânone</span>
              <span class="canone-btn-sub">Ganha <strong>Foco Cânone</strong> = metade do Patamar (arredondado para cima), mas a Surge de <strong>Divisão</strong> e seus talentos ficam bloqueados até o <strong>Segundo Ideal</strong></span>
            </button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      requestAnimationFrame(() => overlay.classList.add('visible'));

      overlay.querySelector('.canone-btn-no').addEventListener('click', () => {
        overlay.classList.remove('visible');
        overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
        resolve(false);
      });
      overlay.querySelector('.canone-btn-yes').addEventListener('click', () => {
        overlay.classList.remove('visible');
        overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
        resolve(true);
      });
    });
  }

  function _showRompeCeuCanoneModal(color) {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.id = 'canone-modal-overlay';
      overlay.innerHTML = `
        <div class="canone-modal" style="--canone-color:${color}">
          <div class="canone-modal-glyph">
            <img src="svg/Skybreakers_glyph.svg" alt="Rompe-Céu" style="filter:drop-shadow(0 0 12px ${color});width:64px;height:64px;">
          </div>
          <h2 class="canone-modal-title" style="color:${color}">O Caminho do Cânone</h2>
          <p class="canone-modal-text">
            Os Rompe-Céus seguem a lei acima de tudo — o <strong>Cânone</strong> é seu compromisso com a justiça verdadeira. Aqueles que o seguem ganham resistência e propósito, mas devem demonstrar seu comprometimento antes de dominar seus fluxos.
          </p>
          <div class="canone-modal-choices">
            <button class="canone-btn canone-btn-no">
              <span class="canone-btn-label">Não seguir o Cânone</span>
              <span class="canone-btn-sub">Acesso completo às surges desde o início</span>
            </button>
            <button class="canone-btn canone-btn-yes" style="border-color:${color};box-shadow:0 0 12px ${color}40;">
              <span class="canone-btn-label" style="color:${color}">Seguir o Cânone</span>
              <span class="canone-btn-sub">
                +1 Vida por nível e <strong>Foco Cânone</strong> = Patamar<br>
                • <strong>Primeiro Ideal:</strong> sem acesso às surges<br>
                • <strong>Segundo Ideal:</strong> desbloqueia Gravitação<br>
                • <strong>Terceiro Ideal:</strong> desbloqueia Divisão
              </span>
            </button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      requestAnimationFrame(() => overlay.classList.add('visible'));

      overlay.querySelector('.canone-btn-no').addEventListener('click', () => {
        overlay.classList.remove('visible');
        overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
        resolve(false);
      });
      overlay.querySelector('.canone-btn-yes').addEventListener('click', () => {
        overlay.classList.remove('visible');
        overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
        resolve(true);
      });
    });
  }

  function renderRadiantSection() {
    const container = document.getElementById('radiant-select');
    if (!container) return;
    const unlocked = state.profile.level >= 2;
    container.innerHTML = '';

    if (!unlocked) {
      container.innerHTML = '<div class="radiant-placeholder">Disponivel a partir do Nível 2</div>';
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

    updateViewportGlyph();
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
    const createSpheres = (currentRank, key, isRadiant = false, color = '#fff', canoneBlocked = false) => {
      let spheresHtml = `<div class="sphere-track" style="--sphere-color:${color}">`;
      for (let i = 1; i <= 5; i++) {
        const isActive = i <= currentRank;
        const isLocked = i > maxRank;
        const title = canoneBlocked ? 'Bloqueado pelo Cânone' : isLocked ? 'Bloqueado por Nível' : 'Rank ' + i;
        spheresHtml += `
          <div class="sphere-btn ${isActive ? 'active' : ''} ${isLocked ? 'locked' : ''} ${canoneBlocked ? 'canone-locked' : ''}"
               data-idx="${i}"
               data-key="${key}"
               data-rad="${isRadiant}"
               data-canone-locked="${canoneBlocked}"
               title="${title}">
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
        const canoneBlocked = isCanoneLockedSurge(key);
        const color = canoneBlocked ? '#666' : (ATTR_COLORS[info.attr] || clsColor(cls));

        const div = document.createElement('div');
        div.className = 'pericia-item' + (canoneBlocked ? ' canone-surge-locked' : '');
        div.innerHTML = `
          <span class="pericia-name" style="color:${canoneBlocked ? '#666' : clsColor(cls)}">
            ${info.name}${canoneBlocked ? ' <span class="canone-lock-badge" title="Bloqueado pelo Cânone">🔒</span>' : ''}
          </span>
          <div class="pericia-controls-new">
            ${createSpheres(rank, key, true, color, canoneBlocked)}
            <span class="pericia-total-val" style="${canoneBlocked ? 'color:#666' : ''}">${total}</span>
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
        const canoneBlocked = btn.dataset.canoneLocked === 'true';

        if (canoneBlocked) {
          const cls = state.profile.radiantClass;
          if (cls === 'Pulverizador') notify('Surto bloqueado pelo Cânone — desbloqueie o Segundo Ideal primeiro.');
          else if (cls === 'Rompe-Céu' && key === 'gravitacao') notify('Surto bloqueado pelo Cânone — desbloqueie o Segundo Ideal primeiro.');
          else if (cls === 'Rompe-Céu' && key === 'divisao') notify('Surto bloqueado pelo Cânone — desbloqueie o Terceiro Ideal primeiro.');
          else notify('Surto bloqueado pelo Cânone.');
          return;
        }

        if (idx > maxRank) {
          notify(`Nível insuficiente para Rank ${idx}`);
          return;
        }

        const currentVal = isRadiant ? (state.radiantPericias[key] || 0) : (state.pericias[key] || 0);
        const newVal = (currentVal === idx) ? idx - 1 : idx;

        if (!isRadiant && key === initialClassKey && newVal < 1) {
          notify(`O 1º Rank de ${CosData.PERICIAS[key].name} é fixo pela sua Trilha Inicial.`);
          return;
        }

        if (isRadiant && newVal < 1 && !isCanoneLockedSurge(key)) {
          notify('O 1º Rank de cada Surto é concedido gratuitamente ao escolher a Ordem Radiante.');
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
        const oldClass = state.activeClass; // Guarda quem era a classe antiga
        state.activeClass = cls;
        renderClassTabs();

        // Agrupa o estado necessário para o renderer
        const stateData = {
          unlockedSkills: state.unlockedSkills,
          pericias: state.pericias,
          canUnlockFn: canUnlockCheck,
          radiantClass: state.profile.radiantClass,
          additionalClasses: state.profile.race === 'singer' ? ['Cantor'] : []
        };

        // Chama a nossa nova transição 3D em vez do triggerTabSlide
        SkillRenderer.transitionToClass(oldClass, cls, stateData, () => {
          rebuildTree(true);
        });
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
      <div class="tt-meta-row">
        <span class="tt-rank">Rank ${skill.rank}</span>
        ${skill.activation ? ActivationIcons.icon(skill.activation) : ''}
      </div>
      ${skill.desc ? `<div class="tt-desc">${skill.desc}</div>` : ''}
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
    // Ancestralidade adicional
    'Cantor': '#e07b54',
    // Ordens Radiantes
    'Corredor dos Ventos':       '#38bdf8',
    'Rompe-Céu':                 '#fbbf24',
    'Pulverizador':              '#ef4444',
    'Dançarino de Precipícios': '#34d399',
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

  // Retorna true se o surto (chave) está bloqueado pelo Cânone no momento
  function isCanoneLockedSurge(key) {
    const cls = state.profile.radiantClass;
    if (cls === 'Pulverizador' && state.profile.pulverizadorCanone === true) {
      if (key === 'divisao') {
        const seg = CosData.findRadiantSkillByName('Segundo Ideal (Pulverizador)', 'Pulverizador');
        return !seg || !state.unlockedSkills.has(seg.id);
      }
    }
    if (cls === 'Rompe-Céu' && state.profile.rompeCeuCanone === true) {
      if (key === 'gravitacao') {
        const seg = CosData.findRadiantSkillByName('Segundo Ideal (Rompe-Céu)', 'Rompe-Céu');
        return !seg || !state.unlockedSkills.has(seg.id);
      }
      if (key === 'divisao') {
        const ter = CosData.findRadiantSkillByName('Terceiro Ideal (Rompe-Céu)', 'Rompe-Céu');
        return !ter || !state.unlockedSkills.has(ter.id);
      }
    }
    return false;
  }

  function canUnlockRadiantSkill(skill) {
    if (state.unlockedSkills.has(skill.id)) return { can: false, reason: 'Ja desbloqueado' };
    if (getTalentPointsRemaining() <= 0) return { can: false, reason: 'Sem pontos de talento' };

    // Restrição do Cânone — Pulverizador: Divisão bloqueada até o Segundo Ideal
    if (skill.cls === 'Pulverizador' && skill.sub === 'Divisão' && state.profile.pulverizadorCanone === true) {
      const segundoIdeal = CosData.findRadiantSkillByName('Segundo Ideal (Pulverizador)', 'Pulverizador');
      if (!segundoIdeal || !state.unlockedSkills.has(segundoIdeal.id)) {
        return { can: false, reason: 'Requer Segundo Ideal (restrição do Cânone)' };
      }
    }

    // Restrição do Cânone — Rompe-Céu: surges bloqueadas por ideal
    if (skill.cls === 'Rompe-Céu' && state.profile.rompeCeuCanone === true) {
      if (skill.sub === 'Gravitação' || skill.sub === 'Divisão') {
        const segundoIdeal = CosData.findRadiantSkillByName('Segundo Ideal (Rompe-Céu)', 'Rompe-Céu');
        const terceiroIdeal = CosData.findRadiantSkillByName('Terceiro Ideal (Rompe-Céu)', 'Rompe-Céu');
        const temSegundo = segundoIdeal && state.unlockedSkills.has(segundoIdeal.id);
        const temTerceiro = terceiroIdeal && state.unlockedSkills.has(terceiroIdeal.id);

        if (skill.sub === 'Gravitação' && !temSegundo) {
          return { can: false, reason: 'Requer Segundo Ideal (restrição do Cânone)' };
        }
        if (skill.sub === 'Divisão' && !temTerceiro) {
          return { can: false, reason: 'Requer Terceiro Ideal (restrição do Cânone)' };
        }
      }
    }

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

  // ---- SAVE / LOAD (lógica de estado — CRUD e modal estão em saves.js) ----

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

  function resetProfile() {
    state.profile = { name: '', race: 'human', level: 1, radiantClass: null, radiantClassLocked: false, ancestryClass: null, pulverizadorCanone: null, rompeCeuCanone: null };
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
        const talentNames = talentsText
          .split('\n')
          .map(s => s.trim())
          .filter(Boolean)
          .filter(s => !s.endsWith(':'))          // ignora cabeçalhos de classe ("Guerreiro:")
          .map(s => s.replace(/^R\d+\s+/, ''));   // remove prefixo de rank ("R0 ", "R3 ", …)

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

          matches.sort((a, b) => {
            if (a.cls === radiantClass && b.cls !== radiantClass) return -1;
            if (b.cls === radiantClass && a.cls !== radiantClass) return 1;
            if (a.cls === ancestryClass && b.cls !== ancestryClass) return -1;
            if (b.cls === ancestryClass && a.cls !== ancestryClass) return 1;
            return 0;
          });
          
          for (const sk of matches) unlockedSkills.add(sk.id);

          // Apenas 1 "gasto" por nome único; as cópias extras são auto-desbloqueadas (free)
          spentTalents++;
          for (let i = 1; i < matches.length; i++) {
            freeUnlockedSkills.add(matches[i].id);
          }
        }

        // --- Retrato do personagem (gravado nos metadados Creator do PDF) ---
        let portrait = null;
        try {
          const creatorRaw = pdfDoc.getCreator() || '';
          const portraitMatch = creatorRaw.match(/^cosmere-rpg\|portrait:(data:image\/.+)/s);
          if (portraitMatch) portrait = portraitMatch[1];
        } catch (e) { /* sem retrato */ }

        // --- Aplicar ao estado ---
        state.profile = {
          ...state.profile,
          name,
          level,
          race,
          radiantClass: radiantClass || null,
          radiantClassLocked: !!radiantClass,
          ancestryClass: ancestryClass || null,
          portrait,
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
                  <img src="assets/human.png" alt="Humano">
                </div>
                <div class="pm-race-name">Humano</div>
                <div class="pm-race-desc">
                  O 1º talento deve ser o Rank&nbsp;0 de uma classe mundana; o 2º fica restrito à mesma classe.
                </div>
              </div>

              <div class="pm-race-card ${_profileDraft.race === 'singer' ? 'active' : ''}" data-race="singer">
                <div class="pm-race-img pm-race-img--singer">
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
      SavesManager.showSavesModal();
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

  // ---- BOOK PDF UI STATE ----
  function updateBookPdfUI() {
    const btnBook    = document.getElementById('btn-load-book');
    const btnClear   = document.getElementById('btn-clear-book');
    const bookStatus = document.getElementById('book-pdf-status');
    if (!btnBook) return;

    const hasDesc = PdfExtractor.hasStoredDescriptions();
    btnBook.textContent            = hasDesc ? 'Recarregar Livro (PDF)' : 'Carregar Livro (PDF)';
    btnClear.style.display         = hasDesc ? 'inline-block' : 'none';
    if (!hasDesc) {
      bookStatus.style.display = 'none';
      bookStatus.textContent   = '';
    }
  }

  // ---- INIT (async - waits for skills JSON) ----
  async function init() {
    // Fechar sidebar ANTES dos awaits — garante estado correto no mobile
    // independente de timing de carregamento dos JSON
    if (window.innerWidth <= 768) {
      document.getElementById('sidebar').classList.add('closed');
      document.getElementById('viewport').classList.add('expanded');
      document.body.classList.add('sidebar-closed');
    }

    await CosData.loadSkills();
    await CosData.loadRadiantSkills();
    await CosData.loadAdditionalSkills();
    await CosData.loadOaths();
    PdfExtractor.loadAndApply();
    updateBookPdfUI();
    preloadWheelSvgs(); // fire-and-forget — wheel opens instantly later

    initPericias();

    // Initialize 3D renderer
    const viewport = document.getElementById('viewport');
    SkillRenderer.init(viewport);

    // Callbacks: hover shows tooltip, click opens modal, long-press (mobile) shows tooltip
    SkillRenderer.setCallbacks(
      (skill, intersect) => {
        showTooltip(skill, window._lastMouseEvent);
      },
      (skill, event) => {
        hideTooltip();
        showSkillModal(skill);
      },
      () => hideTooltip(),
      (skill, touchX, touchY) => {
        // Long-press: mostra resumo sem abrir o modal de compra
        showTooltip(skill, { clientX: touchX, clientY: touchY });
      }
    );

    // Track mouse for tooltip positioning
    document.addEventListener('mousemove', e => { window._lastMouseEvent = e; });

    // Inicializar submódulos com callbacks para state e UI
    SavesManager.init({
      getSerializedState: buildCurrentSaveData,
      applyState:         applySaveData,
      notify,
    });
    PdfExport.init({
      getState:        () => state,
      getDerivedStats: getDerivedStats,
      notify,
    });

    // Bind UI
    bindUI();

    // Initial render
    renderSidebar();
    renderClassTabs();
    // Recalcula o canvas agora que a topbar tem altura real (class-tabs populado)
    window.dispatchEvent(new Event('resize'));

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

    // Portrait upload
    const portraitWrap  = document.getElementById('char-portrait');
    const portraitInput = document.getElementById('char-portrait-input');
    const portraitClear = document.getElementById('char-portrait-clear');

    portraitWrap?.addEventListener('click', () => portraitInput?.click());

    portraitInput?.addEventListener('change', e => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        // Redimensiona para max 400px antes de armazenar (economiza espaço no localStorage)
        const img = new Image();
        img.onload = () => {
          const MAX = 400;
          let w = img.naturalWidth, h = img.naturalHeight;
          if (w > MAX || h > MAX) {
            if (w >= h) { h = Math.round(h * MAX / w); w = MAX; }
            else        { w = Math.round(w * MAX / h); h = MAX; }
          }
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          state.profile.portrait = canvas.toDataURL('image/jpeg', 0.8);
          renderPortrait();
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
      // Reset input so same file can be re-selected
      portraitInput.value = '';
    });

    portraitClear?.addEventListener('click', e => {
      e.stopPropagation(); // não abre o file picker
      state.profile.portrait = null;
      renderPortrait();
    });

    function toggleSidebar() {
      document.getElementById('sidebar').classList.toggle('closed');
      document.getElementById('viewport').classList.toggle('expanded');
      document.body.classList.toggle('sidebar-closed');
      setTimeout(() => window.dispatchEvent(new Event('resize')), 310);
    }

    document.getElementById('sidebar-toggle')?.addEventListener('click', toggleSidebar);
    document.getElementById('sidebar-reopen')?.addEventListener('click', toggleSidebar);

    // Collapsible talents section
    document.getElementById('talents-toggle')?.addEventListener('click', () => {
      document.getElementById('talents-section')?.classList.toggle('collapsed');
    });

    // Credits modal
    const creditsOverlay = document.getElementById('credits-modal');
    document.getElementById('btn-credits')?.addEventListener('click', () => {
      creditsOverlay?.classList.add('visible');
    });
    document.getElementById('credits-modal-close')?.addEventListener('click', () => {
      creditsOverlay?.classList.remove('visible');
    });
    creditsOverlay?.addEventListener('click', e => {
      if (e.target === creditsOverlay) creditsOverlay.classList.remove('visible');
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && creditsOverlay?.classList.contains('visible')) {
        creditsOverlay.classList.remove('visible');
      }
    });

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

    document.getElementById('btn-save')?.addEventListener('click', () => SavesManager.showSavesModal());
    document.getElementById('btn-load')?.addEventListener('click', () => SavesManager.showSavesModal());
    document.getElementById('btn-import-pdf')?.addEventListener('click', importFromPDF);
    document.getElementById('btn-reset')?.addEventListener('click', resetProfile);

    // ---- CARREGAR LIVRO PDF ----
    const bookInput  = document.getElementById('book-pdf-input');
    const btnBook    = document.getElementById('btn-load-book');
    const btnClear   = document.getElementById('btn-clear-book');
    const bookStatus = document.getElementById('book-pdf-status');

    btnBook?.addEventListener('click', () => bookInput?.click());

    bookInput?.addEventListener('change', async () => {
      const file = bookInput.files?.[0];
      if (!file) return;
      bookInput.value = '';

      btnBook.disabled = true;
      bookStatus.style.display = 'block';

      try {
        const { found, total } = await PdfExtractor.processFile(file, msg => {
          bookStatus.textContent = msg;
        });
        bookStatus.textContent = `${found} de ${total} habilidades com descrição encontrada.`;
      } catch (err) {
        bookStatus.textContent = `Erro: ${err.message}`;
      } finally {
        btnBook.disabled = false;
        updateBookPdfUI();
      }
    });

    btnClear?.addEventListener('click', () => {
      if (!confirm('Remover as descrições carregadas do livro?')) return;
      PdfExtractor.clearDescriptions();
      updateBookPdfUI();
    });
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

    // ============================================================
    // VIEW SETTINGS PANEL (Configurações da Visualização)
    // ============================================================
    
    const vspPanel = document.getElementById('view-settings-panel');
    const btnVsp = document.getElementById('btn-viewport-settings');
    const vspClose = document.getElementById('vsp-close');
    const vspBackdrop = document.getElementById('vsp-backdrop');

    // Elementos de Input e Display
    const glowInput = document.getElementById('cfg-node-glow');
    const glowVal = document.getElementById('cfg-node-glow-val');
    const lineOpacityInput = document.getElementById('cfg-line-opacity');
    const lineOpacityVal = document.getElementById('cfg-line-opacity-val');
    const glassOpacityInput = document.getElementById('cfg-glass-opacity');
    const glassOpacityVal = document.getElementById('cfg-glass-opacity-val');
    const gemColorInput = document.getElementById('cfg-gem-color');
    const gemColorEnable = document.getElementById('cfg-gem-color-enable');
    const subLabelsInput = document.getElementById('cfg-sub-labels');

    // 1. Inicializar os valores do HTML com base no estado atual do Renderer
    if (typeof SkillRenderer !== 'undefined') {
      const initialConfig = SkillRenderer.getConfig();
      if (glowInput) {
        glowInput.value = initialConfig.nodeGlow;
        glowVal.textContent = initialConfig.nodeGlow.toFixed(1);
      }
      if (lineOpacityInput) {
        lineOpacityInput.value = initialConfig.lineOpacity;
        lineOpacityVal.textContent = initialConfig.lineOpacity.toFixed(1);
      }
      if (glassOpacityInput) {
        glassOpacityInput.value = initialConfig.glassOpacity;
        glassOpacityVal.textContent = initialConfig.glassOpacity.toFixed(2);
      }
      if (subLabelsInput) {
        subLabelsInput.checked = initialConfig.showSubLabels;
      }
    }

    // 2. Abrir e Fechar o Painel
    btnVsp?.addEventListener('click', () => vspPanel?.classList.add('visible'));
    vspClose?.addEventListener('click', () => vspPanel?.classList.remove('visible'));
    vspBackdrop?.addEventListener('click', () => vspPanel?.classList.remove('visible'));

    // Fechar também com a tecla Escape
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && vspPanel?.classList.contains('visible')) {
        vspPanel.classList.remove('visible');
      }
    });

    // 3. Eventos dos Sliders (aplicam-se em tempo real na animação)
    glowInput?.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      glowVal.textContent = val.toFixed(1);
      SkillRenderer.setConfig({ nodeGlow: val });
    });

    lineOpacityInput?.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      lineOpacityVal.textContent = val.toFixed(1);
      SkillRenderer.setConfig({ lineOpacity: val });
    });

    glassOpacityInput?.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      glassOpacityVal.textContent = val.toFixed(2);
      SkillRenderer.setConfig({ glassOpacity: val });
    });

    // 4. Cor das gemas — ativa/desativa override e aplica cor em tempo real
    function applyGemColor() {
      if (!gemColorEnable || !gemColorInput) return;
      if (gemColorEnable.checked) {
        const hex = parseInt(gemColorInput.value.slice(1), 16);
        SkillRenderer.setConfig({ gemColorOverride: hex });
      } else {
        SkillRenderer.setConfig({ gemColorOverride: null });
      }
    }
    gemColorEnable?.addEventListener('change', applyGemColor);
    gemColorInput?.addEventListener('input', () => {
      if (gemColorEnable?.checked) applyGemColor();
    });

    // 5. Evento do Checkbox de Subclasses (exige recriar a árvore)
    subLabelsInput?.addEventListener('change', (e) => {
      SkillRenderer.setConfig({ showSubLabels: e.target.checked });
      // Reconstruímos a árvore passando 'true' para manter o Zoom/Pan (posição da câmara) atual do utilizador
      rebuildTree(true);
    });
  }

  return { init, state, exportToSheet: PdfExport.exportToSheet };

})();

// Boot
window.addEventListener('DOMContentLoaded', () => {
  App.init();
});