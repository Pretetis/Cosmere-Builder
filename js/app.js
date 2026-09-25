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

  // Perícia inicial da trilha de partida (heroica ou Metalnascida).
  // Chaves de PERICIAS_METALICAS vivem em state.metalPericias.
  const CLASS_INITIAL_PERICIA = {
    'Agente':    'intuicao',
    'Caçador':   'percepcao',
    'Emissário': 'disciplina',
    'Erudito':   'saber',
    'Guerreiro': 'atletismo',
    'Líder':     'lideranca',
    'Brumoso':   'alomancia',
    'Ferroso':   'feruquimia',
    'Duplonato': 'disciplina',
  };

  // Ancestralidades — o cenário define quais aparecem na criação
  const RACES = {
    human:  { name: 'Humano',       setting: 'both' },
    singer: { name: 'Cantor',       setting: 'stormlight', tree: 'Cantor' },
    kandra: { name: 'Kandra',       setting: 'mistborn',   tree: 'Kandra' },
    koloss: { name: 'Sangue-Koloss', setting: 'mistborn',  tree: 'Sangue-Koloss', era: 'e2' },
  };

  // Arte de cada ancestralidade (miniaturas leves em assets/thumbs; originais em assets/).
  // O humano muda de cenário: Roshar no Cosmere/Misto, Scadrial no Mistborn.
  function raceArt(race) {
    const file = race === 'human'
      ? (CosData.getSetting() === 'mistborn' ? 'human_mistborn' : 'human')
      : { singer: 'singer', kandra: 'kandra', koloss: 'kollos_blood' }[race];
    return file ? `assets/thumbs/${file}.jpg` : null;
  }

  // Bênçãos Kandra (par de cravos Hemalúrgicos escolhido na criação)
  const KANDRA_BLESSINGS = {
    consciencia: { name: 'Bênção da Consciência',  desc: '+2 Consciência (e +2 no máximo)', bonus: { consciencia: 2 } },
    potencia:    { name: 'Bênção da Potência',     desc: '+1 Força e +1 Velocidade',        bonus: { forca: 1, velocidade: 1 } },
    presenca:    { name: 'Bênção da Presença',     desc: '+1 Intelecto e +1 Presença',      bonus: { intelecto: 1, presenca: 1 } },
    estabilidade:{ name: 'Bênção da Estabilidade', desc: '+2 Vontade (e +2 no máximo)',     bonus: { vontade: 2 } },
    fortitude:   { name: 'Bênção da Fortitude',    desc: '+1 de Deflexão',                  bonus: {} },
  };

  const state = {
    profile: {
      name: '',
      race: 'human',
      level: 1,
      setting: 'stormlight',  // 'stormlight' (Cosmere) | 'mistborn' | 'misto'
      era: 'livre',           // Mistborn: 1 | 2 | 'livre'
      kandraBlessing: null,
      metalborn: null,        // { path, allo: [metalKey], feru: [metalKey] }
      radiantClass: null,
      radiantClassLocked: false,
      ancestryClass: null,  // trilha de partida (1º talento-chave comprado)
      pulverizadorCanone: null, // true = segue o Cânone, false = não segue, null = não perguntado
      rompeCeuCanone: null,     // true = segue o Cânone, false = não segue, null = não perguntado
    },
    attributes: {
      forca: 0, velocidade: 0, intelecto: 0,
      vontade: 0, consciencia: 0, presenca: 0
    },
    pericias: {},
    radiantPericias: {},
    metalPericias: {},
    unlockedSkills: new Set(),
    freeUnlockedSkills: new Set(), // IDs auto-desbloqueados por habilidades compartilhadas
    singerFreeIds: new Set(),       // IDs concedidos gratuitamente pela ancestralidade Cantor
    grantedIds: new Set(),          // Mistborn: talentos de ancestralidade e poderes treinados (sem custo)
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
    for (const key of Object.keys(CosData.PERICIAS_METALICAS)) {
      state.metalPericias[key] = 0;
    }
  }

  // ---- ATRIBUTOS EFETIVOS (base + bênçãos/talentos) ----
  function getAttrBonus() {
    const bonus = {};
    const b = state.profile.race === 'kandra' && KANDRA_BLESSINGS[state.profile.kandraBlessing];
    if (b) for (const [k, v] of Object.entries(b.bonus)) bonus[k] = (bonus[k] || 0) + v;
    if (hasUnlockedByEn('Unchecked Size')) bonus.forca = (bonus.forca || 0) + 1;
    return bonus;
  }

  function effectiveAttributes() {
    const bonus = getAttrBonus();
    const out = {};
    for (const [k, v] of Object.entries(state.attributes)) out[k] = v + (bonus[k] || 0);
    return out;
  }

  // Máximo do valor BASE do atributo (bônus de bênção/talento somam por fora)
  function getAttrBaseMax(attr) {
    const lvl1 = state.profile.level === 1;
    let max = lvl1 ? 3 : 5;
    if (attr === 'forca' && state.profile.race === 'koloss') max += 1; // Atributos Koloss
    return max;
  }

  function hasUnlockedByEn(enName) {
    for (const pool of [CosData.ADDITIONAL_SKILLS, CosData.METAL_SKILLS]) {
      for (const s of pool || []) {
        if (s.en === enName && state.unlockedSkills.has(s.id)) return true;
      }
    }
    return false;
  }

  function isMistbornActive() { return CosData.hasMistborn(); }

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
    // Kandra distribui só 6 pontos na criação (a Bênção compensa)
    const kandraPenalty = state.profile.race === 'kandra' ? 6 : 0;
    return getPointsAvailable().totalAttr - kandraPenalty - getAttrPointsSpent();
  }

  // Ranks gratuitos de Alomancia/Feruquemia concedidos pelos talentos-chave Metalnascidos
  function getMetalFreeRanks() {
    const free = {};
    const mb = state.profile.metalborn;
    const path = mb && CosData.METALBORN_PATHS[mb.path];
    if (path) {
      const key = CosData.getRootMetalSkill(mb.path);
      if (key && state.unlockedSkills.has(key.id)) {
        for (const [k, v] of Object.entries(path.grantsRanks || {})) free[k] = (free[k] || 0) + v;
      }
    }
    return free;
  }

  function getPericiaPointsSpent() {
    let sum = 0;
    for (const v of Object.values(state.pericias)) sum += v;
    const metalFree = getMetalFreeRanks();
    for (const [k, v] of Object.entries(state.metalPericias)) sum += Math.max(0, v - (metalFree[k] || 0));
    // Include the 2 active radiant surges if an order is chosen
    if (state.profile.radiantClass) {
      const keys = CosData.RADIANT_CLASS_PERICIAS[state.profile.radiantClass] || [];
      for (const k of keys) {
        sum += state.radiantPericias[k] || 0;
        // 1 rank gratuito por surto ao escolher a ordem — mas surtos travados
        // pelo Cânone ainda não foram concedidos, então não abatem nada.
        if (!isCanoneLockedSurge(k)) sum -= 1;
      }
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
    const a = effectiveAttributes();
    return {
      physical:  10 + a.forca + a.velocidade,
      cognitive: 10 + a.intelecto + a.vontade,
      spiritual: 10 + a.consciencia + a.presenca
    };
  }

  // Investidura: Radiantes ou Alomânticos (Brumoso, Nascido da Bruma, Duplonato) com o talento-chave
  function hasInvestiture() {
    if (state.profile.radiantClass) return true;
    const mb = state.profile.metalborn;
    const path = mb && CosData.METALBORN_PATHS[mb.path];
    if (!path || !path.investiture) return false;
    const key = CosData.getRootMetalSkill(mb.path);
    return !!(key && state.unlockedSkills.has(key.id));
  }

  // ---- ESTATÍSTICAS DERIVADAS ----
  function getDerivedStats() {
    const a = effectiveAttributes();
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
    // Vigor Koloss: +1 de vida por nível
    if (hasUnlockedByEn('Koloss Stamina')) maxHealth += p.level;

    const maxFocus = 2 + a.vontade;

    const tier = CosData.LEVEL_TABLE.find(r => r.level === p.level)?.tier || 1;

    let maxInvestiture = hasInvestiture()
      ? 2 + (a.consciencia >= a.presenca ? a.consciencia : a.presenca)
      : 0;
    // Talento "Investido" (Brumoso/Nascido da Bruma/Duplonato): +Patamar
    if (maxInvestiture > 0 && hasUnlockedByEn('Invested')) maxInvestiture += tier;
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

  // ---- REQUISITOS DE PERÍCIA / ATRIBUTO / NÍVEL ----
  // Valor atual de um requisito descrito por CosData.describeStat
  function statCurrentValue(desc) {
    if (!desc) return 0;
    if (desc.kind === 'level')   return state.profile.level;
    if (desc.kind === 'pericia') return state.pericias[desc.key] || 0;
    if (desc.kind === 'metal')   return state.metalPericias[desc.key] || 0;
    if (desc.kind === 'attr')    return state.attributes[desc.key] || 0; // requisitos ignoram bônus temporários
    return 0;
  }

  // Grupos de requisitos: todos os grupos (E) com ao menos uma alternativa (OU).
  // Skills antigas usam reqStat/reqVal; as do Mistborn usam `reqs`.
  function getReqGroups(skill) {
    if (Array.isArray(skill.reqs) && skill.reqs.length) return skill.reqs;
    if (skill.reqStat && !Array.isArray(skill.reqStat) && skill.reqVal > 0) {
      return [[{ stat: skill.reqStat, val: skill.reqVal }]];
    }
    return [];
  }

  function statReqLines(skill) {
    const lines = [];
    for (const group of getReqGroups(skill)) {
      const parts = group.map(r => {
        const d = CosData.describeStat(r.stat);
        const cur = statCurrentValue(d);
        return { met: cur >= r.val, text: d && d.kind === 'level' ? `Nível ${r.val}` : `${d ? d.name : r.stat} +${r.val}`, cur };
      });
      const met = parts.some(p => p.met);
      const text = parts.map(p => p.text).join(' ou ') + (parts.length === 1 ? ` (atual: ${parts[0].cur})` : '');
      lines.push({ met, text });
    }
    return lines;
  }

  function checkStatReqs(skill) {
    const failed = statReqLines(skill).find(l => !l.met);
    return failed ? { can: false, reason: `Requer ${failed.text}` } : { can: true, reason: '' };
  }

  // ---- TRILHA DE PARTIDA E BÔNUS DE ANCESTRALIDADE (nível 1) ----
  function isHeroicKey(skill) {
    return skill.rank === 0 && CosData.CLASSES.includes(skill.cls) && !CosData.isMetalSkill(skill);
  }
  function isMetalbornKey(skill) {
    return CosData.isMetalSkill(skill) && skill.rank === 0 && CosData.isMetalbornPathClass(skill.cls);
  }
  function isHeroicSkill(skill) {
    return CosData.CLASSES.includes(skill.cls) && !CosData.isMetalSkill(skill);
  }

  // Regras dos primeiros talentos. No Mistborn a trilha de partida pode ser heroica
  // ou Metalnascida, e o bônus humano precisa ser de uma trilha heroica.
  function startingTalentGate(skill) {
    const race = state.profile.race;
    const mistRules = isMistbornActive() && race !== 'singer';
    if (state.spentTalents === 0 && race !== 'singer') {
      const ok = isHeroicKey(skill) || (mistRules && isMetalbornKey(skill));
      if (!ok) {
        return { can: false, reason: mistRules
          ? 'Trilha de partida: escolha o talento-chave de uma trilha heroica ou Metalnascida'
          : 'Ancestral Humano: escolha um Rank 0 de classe mundana' };
      }
    } else if (race === 'human' && state.spentTalents === 1) {
      if (mistRules) {
        if (!isHeroicSkill(skill)) return { can: false, reason: 'Bônus Humano: escolha um talento de trilha heroica' };
      } else if (state.profile.ancestryClass && skill.cls !== state.profile.ancestryClass) {
        return { can: false, reason: `Ancestral Humano: deve ser da classe ${state.profile.ancestryClass}` };
      }
    }
    return { can: true, reason: '' };
  }

  function eraBlockReason(eraTag) {
    if (!isMistbornActive() || CosData.eraAllows(eraTag, state.profile.era)) return null;
    return `Indisponível na Era ${state.profile.era} (${CosData.ERA_LABEL[eraTag] || eraTag})`;
  }

  function canUnlockAdditionalSkill(skill) {
    if (state.unlockedSkills.has(skill.id)) return { can: false, reason: 'Já desbloqueado' };

    if (skill.cls === 'Cantor' && state.singerFreeIds.has(skill.id)) {
      return { can: false, reason: 'Concedido automaticamente pela ancestralidade Cantor' };
    }
    if (skill.cls === 'Cantor' && state.profile.race !== 'singer') {
      return { can: false, reason: 'Requer ancestralidade Cantor' };
    }
    if (skill.cls === 'Kandra' && state.profile.race !== 'kandra') {
      return { can: false, reason: 'Requer ancestralidade Kandra' };
    }
    if (skill.cls === 'Sangue-Koloss' && state.profile.race !== 'koloss') {
      return { can: false, reason: 'Requer ancestralidade Sangue-Koloss' };
    }
    if (skill.grantedByAncestry) {
      return { can: false, reason: 'Concedido automaticamente pela ancestralidade' };
    }
    // Singer: após comprar nova forma, deve comprar talento de classe antes de mais formas
    if (skill.cls === 'Cantor' && state.profile.race === 'singer' && _singerHasNovaForma() && !state.profile.ancestryClass) {
      return { can: false, reason: 'Cantor: compre um talento de classe mundana primeiro' };
    }

    if (getTalentPointsRemaining() <= 0) return { can: false, reason: 'Sem pontos de talento' };

    // Kandra / Sangue-Koloss: o 1º talento comprado ainda é o da trilha de partida
    if (skill.cls !== 'Cantor') {
      const gate = startingTalentGate(skill);
      if (!gate.can) return gate;
    }

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

    return checkStatReqs(skill);
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

  // Kandra (Forma Natural + Disfarce Kandra) e Sangue-Koloss (Vigor Koloss) vêm de graça no nível 1
  function applyAncestryGrants() {
    const tree = RACES[state.profile.race] && RACES[state.profile.race].tree;
    for (const s of CosData.ADDITIONAL_SKILLS) {
      if (s.grantedByAncestry && s.cls === tree && !state.unlockedSkills.has(s.id)) {
        state.unlockedSkills.add(s.id);
        state.grantedIds.add(s.id);
      }
    }
  }

  function removeAncestryGrants() {
    // Remove a árvore inteira da ancestralidade anterior (comprados devolvem o ponto)
    for (const tree of CosData.MISTBORN_ANCESTRY_CLASSES) {
      if (RACES[state.profile.race] && RACES[state.profile.race].tree === tree) continue;
      for (const s of CosData.ADDITIONAL_SKILLS.filter(x => x.cls === tree)) {
        if (!state.unlockedSkills.has(s.id)) continue;
        state.unlockedSkills.delete(s.id);
        if (state.grantedIds.has(s.id)) state.grantedIds.delete(s.id);
        else state.spentTalents = Math.max(0, state.spentTalents - 1);
      }
    }
  }

  // ---- SKILL PREREQUISITES CHECK ----
  function canUnlockSkill(skill) {
    if (state.unlockedSkills.has(skill.id)) return { can: false, reason: 'Ja desbloqueado' };

    if (getTalentPointsRemaining() <= 0) return { can: false, reason: 'Sem pontos de talento' };

    // Especializações exclusivas de uma era (Inventor, Pistoleiro)
    const eraTag = CosData.SPECIALTY_ERA[skill.sub];
    const eraBlock = eraTag && eraBlockReason(eraTag);
    if (eraBlock) return { can: false, reason: eraBlock };

    // Trilha de partida e bônus de ancestralidade (humano / Kandra / Sangue-Koloss)
    const gate = startingTalentGate(skill);
    if (!gate.can) return gate;

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
        const dep = CosData.findSkillByName(depName, skill.cls, skill.sub);
        if (!dep || !state.unlockedSkills.has(dep.id)) return false;
        // Se o dep foi auto-desbloqueado por compartilhamento, exige que a cadeia
        // anterior a ele nesta classe também esteja completa
        if (state.freeUnlockedSkills.has(dep.id)) {
          return dep.deps.every(ddName => {
            const dd = CosData.findSkillByName(ddName, skill.cls, dep.sub);
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

    const reqCheck = checkStatReqs(skill);
    if (!reqCheck.can) return reqCheck;

    return { can: true, reason: '' };
  }

  function canRemoveSkill(skill) {
    if (!state.unlockedSkills.has(skill.id)) return { can: false, reason: 'Nao esta desbloqueado' };

    // Habilidades concedidas gratuitamente pela ancestralidade Cantor não podem ser removidas
    if (state.singerFreeIds.has(skill.id)) {
      return { can: false, reason: 'Concedido pela ancestralidade Cantor — não pode ser removido' };
    }
    if (skill.grantedByAncestry && state.grantedIds.has(skill.id)) {
      return { can: false, reason: 'Concedido pela ancestralidade — não pode ser removido' };
    }

    if (CosData.isMetalSkill(skill)) return canRemoveMetalSkill(skill);

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
          const dep = CosData.findSkillByName(depName, s.cls, s.sub);
          if (!dep || !state.unlockedSkills.has(dep.id)) return false;
          if (state.freeUnlockedSkills.has(dep.id)) {
            return dep.deps.every(ddName => {
              const dd = CosData.findSkillByName(ddName, s.cls, dep.sub);
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

  // ---- MISTBORN: CAMINHOS METALNASCIDOS E ARTES METÁLICAS ----
  function metalbornPath() {
    const mb = state.profile.metalborn;
    return mb ? CosData.METALBORN_PATHS[mb.path] || null : null;
  }
  function metalbornKeySkill() {
    const mb = state.profile.metalborn;
    return mb ? CosData.getRootMetalSkill(mb.path) : null;
  }
  function hasMetalbornKey() {
    const k = metalbornKeySkill();
    return !!(k && state.unlockedSkills.has(k.id));
  }

  // Árvores de Arte Metálica acessíveis pelos metais do caminho escolhido
  function getAccessibleArtTrees() {
    const mb = state.profile.metalborn;
    if (!mb) return [];
    const out = [];
    for (const key of mb.allo || []) { const t = CosData.artTreeName('allo', key); if (t) out.push(t); }
    for (const key of mb.feru || []) { const t = CosData.artTreeName('feru', key); if (t) out.push(t); }
    return out;
  }
  function isPowerTrained(treeCls) {
    const r = CosData.getRootMetalSkill(treeCls);
    return !!(r && state.unlockedSkills.has(r.id));
  }
  // Habilidades básicas que ficam fora das árvores: o fluxo de cada surto com
  // graduação e o poder de cada metal liberado pelo talento-chave Metalnascido
  // (nascente até concluir o objetivo; Atium já vem completo)
  function getBasicAbilities() {
    const out = [];
    const order = state.profile.radiantClass;
    for (const key of CosData.RADIANT_CLASS_PERICIAS[order] || []) {
      if ((state.radiantPericias[key] || 0) < 1) continue;
      out.push({ id: `fluxo:${key}`, name: `Fluxo ${key === 'transporte' ? 'do' : 'da'} ${CosData.PERICIAS_RADIANTES[key].name}`, cls: order });
    }
    if (hasMetalbornKey()) {
      for (const tree of getAccessibleArtTrees()) {
        const metal = CosData.getMetalOfTree(tree);
        const art = CosData.getArtOfTree(tree);
        if (!metal || !art) continue;
        const nascent = !isPowerTrained(tree) && !(art === 'allo' && metal.key === 'atium');
        out.push({ id: `${art}:${metal.key}`, name: tree, cls: tree, nascent });
      }
    }
    return out;
  }

  function goalNameForTree(treeCls) {
    return CosData.getArtOfTree(treeCls) === 'feru' ? 'Construir sua Mentemetal' : 'Treinar seu Poder';
  }
  // Nascido da Bruma e Feruquemista treinam os metais em pares (ferro/aço, estanho/peltre…)
  function pairedTree(treeCls) {
    const path = metalbornPath();
    if (!path || (path.allo !== 'all' && path.feru !== 'all')) return null;
    const metal = CosData.getMetalOfTree(treeCls);
    const art = CosData.getArtOfTree(treeCls);
    if (!metal || !metal.pair) return null;
    const t = CosData.artTreeName(art, metal.pair);
    return getAccessibleArtTrees().includes(t) ? t : null;
  }

  function getSharedMetalIds(name) {
    const trees = new Set(getAccessibleArtTrees());
    const mb = state.profile.metalborn;
    if (mb) trees.add(mb.path);
    return CosData.METAL_SKILLS.filter(s => s.name === name && !s.isPower && trees.has(s.cls)).map(s => s.id);
  }

  function metalDepsMet(skill) {
    if (!skill.deps.length) return true;
    return skill.deps.some(depName => {
      const dep = CosData.findMetalSkillByName(depName, skill.cls);
      return dep && state.unlockedSkills.has(dep.id);
    });
  }

  function canUnlockMetalSkill(skill) {
    if (state.unlockedSkills.has(skill.id)) return { can: false, reason: 'Já desbloqueado' };
    if (!isMistbornActive()) return { can: false, reason: 'Disponível nos cenários Mistborn ou Misto' };
    if (state.profile.race === 'kandra') return { can: false, reason: 'Kandra não podem seguir caminhos Metalnascidos' };
    const mb = state.profile.metalborn;
    if (!mb) return { can: false, reason: 'Escolha um caminho na Tabela Metálica' };

    if (skill.pool === 'path') {
      if (skill.cls !== mb.path) return { can: false, reason: `Talento do caminho ${skill.cls}` };
      if (getTalentPointsRemaining() <= 0) return { can: false, reason: 'Sem pontos de talento' };
      const gate = startingTalentGate(skill);
      if (!gate.can) return gate;
      if (skill.rank === 0) {
        const path = metalbornPath();
        if (!path.ancestries.includes(state.profile.race)) {
          return { can: false, reason: `Requer ancestralidade ${path.ancestries.map(r => RACES[r].name).join(' ou ')}` };
        }
        const eb = eraBlockReason(path.era);
        return eb ? { can: false, reason: eb } : { can: true, reason: '' };
      }
      if (!hasMetalbornKey()) return { can: false, reason: `Requer: ${metalbornKeySkill().name}` };
      // Duplonato: Ressonância Ligada (metais diferentes) × Compositor (mesmo metal)
      const sameMetal = (mb.allo || [])[0] && (mb.allo || [])[0] === (mb.feru || [])[0];
      if (skill.en === 'Alloyed Resonance' && sameMetal) return { can: false, reason: 'Requer poderes de metais diferentes' };
      if (skill.en === 'Compounder' && !sameMetal) return { can: false, reason: 'Requer Alomancia e Feruquemia do mesmo metal' };
      if (!metalDepsMet(skill)) return { can: false, reason: 'Pré-requisito de talento não atendido' };
      return checkStatReqs(skill);
    }

    // Árvore de Arte Metálica
    if (!getAccessibleArtTrees().includes(skill.cls)) return { can: false, reason: 'Poder fora do seu caminho Metalnascido' };
    if (!hasMetalbornKey()) return { can: false, reason: `Requer: ${metalbornKeySkill().name}` };
    if (skill.isPower) return { can: true, reason: '' }; // objetivo Metalnascido: sem custo de talento
    if (!isPowerTrained(skill.cls)) return { can: false, reason: `Conclua o objetivo "${goalNameForTree(skill.cls)}" primeiro` };
    if (getTalentPointsRemaining() <= 0) return { can: false, reason: 'Sem pontos de talento' };
    const gate = startingTalentGate(skill);
    if (!gate.can) return gate;
    if (!metalDepsMet(skill)) return { can: false, reason: 'Pré-requisito de talento não atendido' };
    return checkStatReqs(skill);
  }

  function canRemoveMetalSkill(skill) {
    const unlockedIn = cls => CosData.METAL_SKILLS.filter(s => s.cls === cls && s.id !== skill.id && state.unlockedSkills.has(s.id));
    if (skill.pool === 'path' && skill.rank === 0) {
      const others = CosData.METAL_SKILLS.some(s => s.id !== skill.id && state.unlockedSkills.has(s.id));
      return others ? { can: false, reason: 'Remova primeiro os talentos e poderes Metalnascidos' } : { can: true, reason: '' };
    }
    if (skill.isPower) {
      if (unlockedIn(skill.cls).length) return { can: false, reason: 'Remova primeiro os talentos deste poder' };
      return { can: true, reason: '' };
    }
    // Um filho só bloqueia se ficar sem nenhum outro dep satisfeito
    const orphan = CosData.METAL_SKILLS.some(s => {
      if (s.cls !== skill.cls || !s.deps.includes(skill.name) || !state.unlockedSkills.has(s.id)) return false;
      return !s.deps.some(d => {
        if (d === skill.name) return false;
        const dep = CosData.findMetalSkillByName(d, s.cls);
        return dep && state.unlockedSkills.has(dep.id);
      });
    });
    return orphan ? { can: false, reason: 'Outro talento depende exclusivamente deste' } : { can: true, reason: '' };
  }

  function addPericiaRank(key, delta) {
    const bucket = CosData.PERICIAS_METALICAS[key] ? state.metalPericias : state.pericias;
    bucket[key] = Math.max(0, Math.min(getMaxPericiaRank(), (bucket[key] || 0) + delta));
  }

  function toggleMetalSkill(skill) {
    const path = metalbornPath();
    const isKey = skill.pool === 'path' && skill.rank === 0;

    if (state.unlockedSkills.has(skill.id)) {
      const check = canRemoveMetalSkill(skill);
      if (!check.can) { notify(check.reason); return false; }
      state.unlockedSkills.delete(skill.id);
      state.freeUnlockedSkills.delete(skill.id);
      if (skill.isPower) {
        state.grantedIds.delete(skill.id);
        return true;
      }
      for (const sid of getSharedMetalIds(skill.name)) {
        if (sid !== skill.id && state.freeUnlockedSkills.has(sid)) {
          state.unlockedSkills.delete(sid);
          state.freeUnlockedSkills.delete(sid);
        }
      }
      state.spentTalents--;
      if (isKey && path) {
        for (const [k, v] of Object.entries(path.grantsRanks || {})) addPericiaRank(k, -v);
        if (state.profile.ancestryClass === skill.cls) {
          const pKey = CLASS_INITIAL_PERICIA[skill.cls];
          if (pKey) addPericiaRank(pKey, -1);
          state.profile.ancestryClass = null;
        }
        state.profile.metalborn.locked = false;
      }
      return true;
    }

    const check = canUnlockMetalSkill(skill);
    if (!check.can) { notify(check.reason); return false; }
    state.unlockedSkills.add(skill.id);

    if (skill.isPower) {
      state.grantedIds.add(skill.id);
      const pair = pairedTree(skill.cls);
      const pairRoot = pair && CosData.getRootMetalSkill(pair);
      if (pairRoot && !state.unlockedSkills.has(pairRoot.id)) {
        state.unlockedSkills.add(pairRoot.id);
        state.grantedIds.add(pairRoot.id);
      }
      return true;
    }

    state.spentTalents++;
    for (const sid of getSharedMetalIds(skill.name)) {
      if (sid !== skill.id && !state.unlockedSkills.has(sid)) {
        state.unlockedSkills.add(sid);
        state.freeUnlockedSkills.add(sid);
      }
    }

    if (isKey && path) {
      state.profile.metalborn.locked = true;
      for (const [k, v] of Object.entries(path.grantsRanks || {})) addPericiaRank(k, v);
      if (!state.profile.ancestryClass) {
        state.profile.ancestryClass = skill.cls;
        const pKey = CLASS_INITIAL_PERICIA[skill.cls];
        if (pKey) addPericiaRank(pKey, 1);
      }
      // Atium não exige objetivo de treino: o poder completo vem com o Estalo
      const atium = CosData.artTreeName('allo', 'atium');
      const atiumRoot = getAccessibleArtTrees().includes(atium) && CosData.getRootMetalSkill(atium);
      if (atiumRoot && !state.unlockedSkills.has(atiumRoot.id)) {
        state.unlockedSkills.add(atiumRoot.id);
        state.grantedIds.add(atiumRoot.id);
      }
    }
    return true;
  }

  async function toggleSkill(skill) {
    if (CosData.isMetalSkill(skill)) return toggleMetalSkill(skill);

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

      // Inverso do auto-grant: ao remover o ideal que libera o surto travado
      // pelo Cânone, o surto volta a 0 (senão sobram ranks pagos num surto travado)
      if (radiant) {
        const rCls = state.profile.radiantClass;
        const isSegundo  = skill.name.includes('Segundo Ideal');
        const isTerceiro = skill.name.includes('Terceiro Ideal');
        if (rCls === 'Pulverizador' && state.profile.pulverizadorCanone === true && isSegundo) {
          state.radiantPericias['divisao'] = 0;
        }
        if (rCls === 'Rompe-Céu' && state.profile.rompeCeuCanone === true) {
          if (isSegundo)  state.radiantPericias['gravitacao'] = 0;
          if (isTerceiro) state.radiantPericias['divisao'] = 0;
        }
      }

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
    const checkUnlock = canUnlockAny(skill);
    const checkRemove = canRemoveSkill(skill);
    const isPower = !!skill.isPower;

    // Requirements HTML
    const reqHtml = buildReqLines(skill).map(l =>
      `<div class="modal-req-item ${l.special ? 'special' : (l.met ? 'met' : 'unmet')}">${l.special ? 'Especial: ' : 'Requer '}${l.text}</div>`
    ).join('');

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
    const goal = isPower ? goalNameForTree(skill.cls) : '';
    if (isUnlocked) {
      actionHtml = `<button class="modal-action-btn remove ${checkRemove.can ? '' : 'disabled'}" id="modal-action">
        ${isPower ? 'Desfazer Objetivo' : 'Remover Talento'}
      </button>`;
      if (!checkRemove.can) {
        actionHtml += `<div class="modal-action-reason">${checkRemove.reason}</div>`;
      }
    } else {
      actionHtml = `<button class="modal-action-btn buy ${checkUnlock.can ? '' : 'disabled'}" id="modal-action">
        ${isPower ? `Concluir Objetivo: ${goal} (sem custo)` : 'Comprar Talento (1 ponto)'}
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
            ${skill.sub !== '-' && skill.sub !== skill.cls ? `<span class="modal-sub">${skill.sub}</span>` : ''}
            <span class="modal-rank">${isPower ? 'Poder' : `Rank ${skill.rank}`}</span>
            <span class="modal-status ${statusClass}">${statusText}</span>
          </div>
          ${skill.en ? `<div class="modal-skill-en">${skill.en}</div>` : ''}
        </div>

        <div class="modal-body">
          ${skill.activation ? `<div class="modal-activation">${ActivationIcons.badge(skill.activation)}</div>` : ''}
          ${isPower ? powerInfoHtml(skill) : ''}
          <div class="modal-desc-section">
            <div class="modal-desc-label">Descrição</div>
            <div class="modal-desc-text">${skill.description || '<em style="color:var(--text-muted);font-size:12px;">Carregue o livro em PDF na barra lateral para ver a descrição completa.</em>'}</div>
            ${skill.descriptionOriginal ? `
            <details class="modal-desc-original">
              <summary>Tradução automática — ver original em inglês</summary>
              <div class="modal-desc-text">${skill.descriptionOriginal}</div>
            </details>` : ''}
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
    renderMetalbornSection();
    renderSettingBadge();
    renderTalents();
    renderPortrait();
    // Update race display label in sidebar
    const raceLabel = document.getElementById('char-race-display');
    if (raceLabel) {
      const race = RACES[state.profile.race] || RACES.human;
      const bless = state.profile.race === 'kandra' && KANDRA_BLESSINGS[state.profile.kandraBlessing];
      raceLabel.textContent = race.name + (bless ? ` · ${bless.name.replace('Bênção d', 'B. d')}` : '');
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
      { pool: CosData.METAL_SKILLS,      type: 'metal'     },
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
        // Prioridade 2: Pertence à classe da trilha inicial (só se compra direta, não free)
        else if (skill.cls === ancestryCls && prev.cls !== ancestryCls && prev.cls !== radiantCls
                 && !state.freeUnlockedSkills.has(skill.id)) {
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
                <span class="talent-rank">${s.isPower ? 'P' : 'R' + s.rank}</span>
                <span class="talent-name">${s.isPower ? 'Poder completo' : s.name}</span>
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
      // Sem imagem própria: arte da ancestralidade, esmaecida, com a dica para trocar
      const art = raceArt(state.profile.race);
      const current = wrap.querySelector('img.char-portrait-default');
      if (!current || current.getAttribute('src') !== art) {
        wrap.innerHTML = art
          ? `<img class="char-portrait-default" src="${art}" alt="">
             <div class="char-portrait-hint">Aparência</div>`
          : `<svg class="char-portrait-placeholder" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
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
      'svg/mundos/roshar.svg',
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
      const cosmereText = _wheelSvgCache['svg/mundos/roshar.svg'] || null;
      const cosmereSrc = coloredSvgSrc(cosmereText, '#d4a853') || 'svg/mundos/roshar.svg';
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

  // ---- SELO DO CENÁRIO (cabeçalho da barra lateral) ----
  function renderSettingBadge() {
    const el = document.getElementById('setting-badge');
    if (!el) return;
    const s = CosData.SETTINGS[state.profile.setting] || CosData.SETTINGS.stormlight;
    const era = isMistbornActive() && state.profile.era !== 'livre' ? ` · Era ${state.profile.era}` : '';
    el.innerHTML = `<span class="setting-badge-name">${s.name}</span><span class="setting-badge-sub">${s.sub}${era}</span>`;
    const title = document.querySelector('.sidebar-header h1');
    if (title) title.textContent = state.profile.setting === 'mistborn' ? 'Mistborn RPG' : 'Cosmere RPG';
    const radSection = document.getElementById('radiant-section');
    if (radSection) radSection.style.display = CosData.hasStormlight() ? '' : 'none';
    const metSection = document.getElementById('metalborn-section');
    if (metSection) metSection.style.display = isMistbornActive() ? '' : 'none';
  }

  // ---- CAMINHO METALNASCIDO (barra lateral) ----
  function renderMetalbornSection() {
    const container = document.getElementById('metalborn-select');
    if (!container) return;
    container.innerHTML = '';
    if (!isMistbornActive()) return;

    if (state.profile.race === 'kandra') {
      container.innerHTML = '<div class="radiant-placeholder">Kandra não podem ser Metalnascidos</div>';
      return;
    }
    const mb = state.profile.metalborn;
    if (!mb) {
      const btn = document.createElement('button');
      btn.className = 'radiant-choose-btn metalborn-choose-btn';
      btn.textContent = '◈  Abrir a Tabela Metálica';
      btn.addEventListener('click', () => MetalTable.show());
      container.appendChild(btn);
      return;
    }
    const color = clsColor(mb.path);
    const chips = [...(mb.allo || []).map(k => ({ k, art: 'allo' })), ...(mb.feru || []).map(k => ({ k, art: 'feru' }))];
    const many = chips.length > 4;
    const div = document.createElement('div');
    div.className = 'radiant-locked-display metalborn-display';
    div.style.borderColor = color + '60';
    div.innerHTML = `
      <div class="radiant-locked-info" style="width:100%">
        <div class="radiant-locked-name" style="color:${color}">${mb.path}</div>
        <div class="metalborn-chips">
          ${many ? `<span class="metal-chip">${chips.length} poderes ${mb.allo?.length ? 'alomânticos' : 'feruquímicos'}</span>` :
            chips.map(({ k, art }) => {
              const m = CosData.getMetal(k);
              const trained = isPowerTrained(m[art].tree);
              return `<span class="metal-chip ${trained ? 'trained' : ''}" style="--metal-color:${m.color}" title="${m[art].tree}${trained ? ' — treinado' : ' — nascente'}">
                <img src="${m.svg}" alt="">${art === 'allo' ? 'A' : 'F'} · ${m.name}</span>`;
            }).join('')}
        </div>
        ${!mb.locked ? `<div style="margin-top:6px;"><button class="btn" style="font-size:10px;padding:3px 8px;" id="metalborn-alter-btn">Alterar</button></div>` : ''}
      </div>`;
    container.appendChild(div);
    div.querySelector('#metalborn-alter-btn')?.addEventListener('click', () => MetalTable.show());
  }

  // ---- TABELA METÁLICA (escolha do caminho Metalnascido e dos metais) ----
  const PATH_BLURB = {
    'Brumoso':          'Um único poder alomântico, dominado como ninguém.',
    'Nascido da Bruma': 'Todos os poderes alomânticos, treinados em pares.',
    'Feruquemista':     'Todas as mentemetais — o legado dos Guardadores de Terris.',
    'Ferroso':          'Mestre de uma única mentemetal.',
    'Duplonato':        'Um poder alomântico e um feruquímico, que podem se combinar.',
  };

  const MetalTable = (() => {
    let draft = null;

    function pathBlock(pathName) {
      const path = CosData.METALBORN_PATHS[pathName];
      if (!path) return 'Caminho desconhecido';
      if (!path.ancestries.includes(state.profile.race)) {
        return `Requer ${path.ancestries.map(r => RACES[r].name).join(' ou ')}`;
      }
      return eraBlockReason(path.era);
    }

    function metalsForArt(art) {
      return CosData.METALS.filter(m => CosData.eraAllows(m[art].era, state.profile.era));
    }

    function needs(pathName) {
      const p = CosData.METALBORN_PATHS[pathName];
      return { allo: p.allo, feru: p.feru };
    }

    function show() {
      if (state.profile.metalborn && state.profile.metalborn.locked) {
        notify('O caminho Metalnascido já foi despertado — só um Reset o redefine.');
        return;
      }
      const cur = state.profile.metalborn;
      draft = cur ? { path: cur.path, allo: [...(cur.allo || [])], feru: [...(cur.feru || [])] } : { path: null, allo: [], feru: [] };
      let overlay = document.getElementById('metal-table');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'metal-table';
        document.body.appendChild(overlay);
      }
      render();
      // Reflow em vez de requestAnimationFrame: com a aba em segundo plano o rAF
      // atrasa e reabria a tabela depois de confirmada
      void overlay.offsetWidth;
      overlay.classList.add('visible');
    }

    function hide() {
      document.getElementById('metal-table')?.classList.remove('visible');
    }

    function ringHtml(art) {
      const n = needs(draft.path)[art];
      const available = metalsForArt(art);
      const all = n === 'all';
      const selected = draft[art];
      const order = CATEGORY_ORDER_APP[art];
      const metals = [...CosData.METALS].sort((a, b) => {
        const ca = order.indexOf(a[art].category), cb = order.indexOf(b[art].category);
        return ca !== cb ? ca - cb : CosData.METALS.indexOf(a) - CosData.METALS.indexOf(b);
      });
      const N = metals.length;
      const size = 440, cx = size / 2, R = 172;
      const nodes = metals.map((m, i) => {
        const a = -Math.PI / 2 + (2 * Math.PI * i / N);
        const x = cx + Math.cos(a) * R, y = cx + Math.sin(a) * R;
        const ok = available.includes(m);
        const sel = all ? ok : selected.includes(m.key);
        const info = m[art];
        const title = `${m.name} — ${info.effect}\n${art === 'allo' ? info.misting : info.ferring} · ${info.category} · ${CosData.ERA_LABEL[info.era]}${ok ? '' : ' (indisponível nesta era)'}`;
        return `<button class="mt-metal ${sel ? 'selected' : ''} ${ok ? '' : 'unavailable'} ${all ? 'fixed' : ''}"
            style="left:${x}px;top:${y}px;--metal-color:${m.color}" data-art="${art}" data-key="${m.key}" title="${title}">
            <img src="${m.svg}" alt=""><span>${m.name}</span></button>`;
      }).join('');
      const pick = selected.map(k => CosData.getMetal(k)).filter(Boolean)[0];
      const center = all
        ? `<div class="mt-center-title">${art === 'allo' ? 'Alomancia' : 'Feruquemia'}</div><div class="mt-center-sub">todos os poderes da era</div>`
        : pick
          ? `<img src="${pick.svg}" alt="" style="--metal-color:${pick.color}"><div class="mt-center-title">${pick.name}</div>
             <div class="mt-center-sub">${art === 'allo' ? pick.allo.misting : pick.feru.ferring}</div>
             <div class="mt-center-effect">${pick[art].effect}</div>`
          : `<div class="mt-center-title">${art === 'allo' ? 'Alomancia' : 'Feruquemia'}</div><div class="mt-center-sub">escolha um metal</div>`;
      return `<div class="mt-ring-wrap">
        <div class="mt-ring-label">${art === 'allo' ? 'Tabela Alomântica' : 'Tabela Feruquímica'}</div>
        <div class="mt-ring" style="width:${size}px;height:${size}px">
          <svg class="mt-ring-svg" viewBox="0 0 ${size} ${size}"><circle cx="${cx}" cy="${cx}" r="${R}" />
            <circle cx="${cx}" cy="${cx}" r="${R - 46}" class="inner"/></svg>
          ${nodes}
          <div class="mt-center">${center}</div>
        </div></div>`;
    }

    function render() {
      const overlay = document.getElementById('metal-table');
      const paths = Object.keys(CosData.METALBORN_PATHS);
      const step2 = !!draft.path;
      const n = step2 ? needs(draft.path) : null;
      const ready = step2 && (n.allo === 'all' || n.allo === draft.allo.length) && (n.feru === 'all' || n.feru === draft.feru.length);
      overlay.innerHTML = `
        <div class="mt-mist"></div>
        <button class="mt-close" aria-label="Fechar">&times;</button>
        <div class="mt-content">
          <div class="mt-kicker">${step2 ? 'Passo 2 de 2' : 'Passo 1 de 2'}</div>
          <h2 class="mt-title">${step2 ? 'Escolha seus metais' : 'Escolha seu caminho Metalnascido'}</h2>
          <p class="mt-subtitle">${step2
            ? 'Os poderes começam nascentes. Complete o objetivo de cada um na árvore para liberar seus talentos.'
            : 'Caminhos Metalnascidos são exclusivos: depois de comprar o talento-chave, não há volta.'}</p>
          ${!step2 ? `<div class="mt-paths">
            ${paths.map(p => {
              const block = pathBlock(p);
              const info = CosData.METALBORN_PATHS[p];
              return `<button class="mt-path ${block ? 'blocked' : ''}" data-path="${p}" style="--path-color:${clsColor(p)}">
                <div class="mt-path-name">${p}</div>
                <div class="mt-path-en">${info.en} · ${CosData.ERA_LABEL[info.era]}</div>
                <div class="mt-path-desc">${PATH_BLURB[p] || ''}</div>
                <div class="mt-path-key">Talento-chave: ${info.key}</div>
                ${block ? `<div class="mt-path-block">${block}</div>` : ''}
              </button>`;
            }).join('')}
          </div>` : `<div class="mt-rings">
            ${n.allo ? ringHtml('allo') : ''}
            ${n.feru ? ringHtml('feru') : ''}
          </div>
          <div class="mt-actions">
            <button class="btn mt-back">Voltar</button>
            <button class="btn primary mt-confirm" ${ready ? '' : 'disabled'}>Confirmar ${draft.path}</button>
          </div>`}
        </div>`;

      overlay.querySelector('.mt-close').addEventListener('click', hide);
      overlay.querySelectorAll('.mt-path').forEach(btn => btn.addEventListener('click', () => {
        const block = pathBlock(btn.dataset.path);
        if (block) { notify(block); return; }
        draft.path = btn.dataset.path;
        const nn = needs(draft.path);
        draft.allo = nn.allo === 'all' ? metalsForArt('allo').map(m => m.key) : draft.allo.slice(0, nn.allo || 0);
        draft.feru = nn.feru === 'all' ? metalsForArt('feru').map(m => m.key) : draft.feru.slice(0, nn.feru || 0);
        render();
      }));
      overlay.querySelectorAll('.mt-metal').forEach(btn => btn.addEventListener('click', () => {
        const art = btn.dataset.art;
        if (needs(draft.path)[art] === 'all') return;
        if (btn.classList.contains('unavailable')) { notify('Metal indisponível na era escolhida'); return; }
        draft[art] = [btn.dataset.key];
        render();
      }));
      overlay.querySelector('.mt-back')?.addEventListener('click', () => { draft.path = null; render(); });
      overlay.querySelector('.mt-confirm')?.addEventListener('click', () => {
        state.profile.metalborn = { path: draft.path, allo: draft.allo, feru: draft.feru, locked: false };
        hide();
        state.activeClass = draft.path;
        renderSidebar();
        renderClassTabs();
        triggerTabSlide(() => rebuildTree());
      });
    }

    return { show, hide };
  })();

  const CATEGORY_ORDER_APP = {
    allo: ['Físico', 'Mental', 'Temporal', 'Aprimoramento', 'Divino'],
    feru: ['Físico', 'Cognitivo', 'Híbrido', 'Espiritual', 'Divino'],
  };

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

    const bonus = getAttrBonus();
    for (const [key, info] of Object.entries(CosData.ATTRIBUTES)) {
      const val = state.attributes[key];
      const b = bonus[key] || 0;
      const div = document.createElement('div');
      div.className = 'attr-item';
      div.innerHTML = `
        <span class="attr-name">${info.abbr}</span>
        <div class="attr-controls">
          <button class="attr-btn" data-attr="${key}" data-dir="-1">&minus;</button>
          <span class="attr-val" ${b ? `title="${val} base + ${b} de bônus"` : ''}>${val + b}${b ? '<sup class="attr-bonus">+' + b + '</sup>' : ''}</span>
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

        // Define o máximo permitido baseado no nível atual (Sangue-Koloss: +1 em Força)
        const maxVal = getAttrBaseMax(attr);

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

    const effAttr = effectiveAttributes();

    // 1. Perícias Base
    for (const [key, info] of Object.entries(CosData.PERICIAS)) {
      const rank = state.pericias[key] || 0;
      const attrVal = effAttr[info.attr] || 0;
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
        const attrVal = effAttr[info.attr] || 0;
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

    // 3. Perícias Investidas (Alomancia / Feruquemia) — só com o talento-chave Metalnascido
    const metalFree = getMetalFreeRanks();
    const metalKeys = Object.keys(CosData.PERICIAS_METALICAS)
      .filter(k => (metalFree[k] || 0) > 0 || (state.metalPericias[k] || 0) > 0);
    if (isMistbornActive() && metalKeys.length) {
      const mcol = clsColor(state.profile.metalborn ? state.profile.metalborn.path : '') || '#8fb4d8';
      const sep = document.createElement('div');
      sep.className = 'pericia-separator';
      sep.style = `grid-column: 1/-1; margin: 10px 0 5px; font-size: 10px; color: ${mcol}; border-bottom: 1px solid ${mcol}44; text-transform: uppercase;`;
      sep.textContent = 'Artes Metálicas';
      container.appendChild(sep);
      for (const key of metalKeys) {
        const info = CosData.PERICIAS_METALICAS[key];
        const rank = state.metalPericias[key] || 0;
        const total = rank + (effAttr[info.attr] || 0);
        const color = ATTR_COLORS[info.attr] || mcol;
        const div = document.createElement('div');
        div.className = 'pericia-item';
        div.innerHTML = `
          <span class="pericia-name" style="color:${mcol}">
            ${info.name} <small style="opacity:0.5;color:${color}">(${CosData.ATTRIBUTES[info.attr].abbr})</small>
          </span>
          <div class="pericia-controls-new">
            ${createSpheres(rank, key, 'metal', color)}
            <span class="pericia-total-val">${total}</span>
          </div>`;
        container.appendChild(div);
      }
    }

    // Eventos de clique nas esferas
    container.querySelectorAll('.sphere-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx);
        const key = btn.dataset.key;
        const isRadiant = btn.dataset.rad === 'true';
        const isMetal = btn.dataset.rad === 'metal';
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

        const bucket = isRadiant ? state.radiantPericias : isMetal ? state.metalPericias : state.pericias;
        const currentVal = bucket[key] || 0;
        const newVal = (currentVal === idx) ? idx - 1 : idx;

        if (isMetal) {
          const floor = (getMetalFreeRanks()[key] || 0) + (key === initialClassKey ? 1 : 0);
          if (newVal < floor) {
            notify(`Os ${floor} primeiros ranks de ${CosData.PERICIAS_METALICAS[key].name} vêm do seu caminho Metalnascido.`);
            return;
          }
        } else if (!isRadiant && key === initialClassKey && newVal < 1) {
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

        bucket[key] = newVal;

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

        // A roleta 3D só conhece as trilhas heroicas/radiante/ancestralidade;
        // vindo da aba Metalnascida, usa o slide simples.
        if (oldClass !== '_all' && oldClass === getMetalbornTab()) {
          triggerTabSlide(() => rebuildTree());
          return;
        }

        // Agrupa o estado necessário para o renderer
        const stateData = {
          unlockedSkills: state.unlockedSkills,
          pericias: state.pericias,
          canUnlockFn: canUnlockCheck,
          radiantClass: CosData.hasStormlight() ? state.profile.radiantClass : null,
          additionalClasses: getAdditionalTreeClasses()
        };

        // Chama a nossa nova transição 3D em vez do triggerTabSlide
        SkillRenderer.transitionToClass(oldClass, cls, stateData, () => {
          rebuildTree(true);
        });
      });
      container.appendChild(btn);
    }

    // Aba Metalnascida (caminho + Tabela Alomântica/Feruquímica)
    const mbTab = getMetalbornTab();
    if (mbTab) {
      const msep = document.createElement('span');
      msep.className = 'tab-separator tab-separator-metal';
      container.appendChild(msep);
      const mColor = clsColor(mbTab);
      const mbtn = document.createElement('button');
      mbtn.className = 'class-tab tab-metalborn' + (mbTab === state.activeClass ? ' active' : '');
      mbtn.textContent = mbTab;
      mbtn.style.borderBottomColor = mbTab === state.activeClass ? mColor : 'transparent';
      mbtn.style.color = mbTab === state.activeClass ? mColor : '';
      mbtn.addEventListener('click', () => {
        if (state.activeClass === mbTab) return;
        state.activeClass = mbTab;
        renderClassTabs();
        triggerTabSlide(() => rebuildTree());
      });
      container.appendChild(mbtn);
    }

    // Radiant tabs (only if a class is chosen and level >= 2)
    if (CosData.hasStormlight() && state.profile.radiantClass && state.profile.level >= 2) {
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

    // Aba da ancestralidade (Cantor, Kandra ou Sangue-Koloss)
    for (const tree of getAdditionalTreeClasses()) {
      const csep = document.createElement('span');
      csep.className = 'tab-separator';
      container.appendChild(csep);

      const cColor = clsColor(tree);
      const cbtn = document.createElement('button');
      cbtn.className = 'class-tab tab-additional' + (tree === state.activeClass ? ' active' : '');
      cbtn.textContent = tree;
      cbtn.style.borderBottomColor = tree === state.activeClass ? cColor : 'transparent';
      cbtn.style.color = tree === state.activeClass ? cColor : '';
      cbtn.addEventListener('click', () => {
        if (state.activeClass === tree) return;
        state.activeClass = tree;
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

    const check = canUnlockAny(skill);
    const isUnlocked = state.unlockedSkills.has(skill.id);

    const statusText = isUnlocked ? '<span style="color:var(--accent-green)">Desbloqueado</span>' :
                        check.can ? '<span style="color:var(--accent-gold)">Disponivel</span>' :
                                    '<span style="color:var(--text-muted)">Bloqueado</span>';

    // Build prerequisites lines
    const reqLines = buildReqLines(skill).map(l =>
      `<div class="tt-req ${l.special ? 'special' : (l.met ? 'met' : 'unmet')}">${l.text}</div>`
    ).join('');

    const subLabel = skill.sub !== '-' && skill.sub !== skill.cls ? ' -- ' + skill.sub : '';
    tt.innerHTML = `
      <div class="tt-name" style="color: ${clsColor(skill.cls)}">${skill.name}</div>
      <div class="tt-sub">${skill.cls}${subLabel} ${statusText}</div>
      <div class="tt-meta-row">
        <span class="tt-rank">${skill.isPower ? 'Poder' : `Rank ${skill.rank}`}</span>
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
    // Scadrial — ancestralidades e caminhos Metalnascidos
    'Kandra':           '#6fbfa4',
    'Sangue-Koloss':    '#5b7fc7',
    'Brumoso':          '#8fb4d8',
    'Nascido da Bruma': '#c9d3e0',
    'Feruquemista':     '#d1a064',
    'Ferroso':          '#c98b56',
    'Duplonato':        '#a9a3d6',
  };

  function clsColor(cls) {
    if (CLASS_COLORS[cls]) return CLASS_COLORS[cls];
    const metal = CosData.getMetalOfTree(cls);
    return metal ? metal.color : 'var(--text-primary)';
  }

  function isRadiantSkill(skill) {
    return CosData.RADIANT_CLASSES.includes(skill.cls);
  }

  function canUnlockAny(skill) {
    if (CosData.isMetalSkill(skill)) return canUnlockMetalSkill(skill);
    if (isRadiantSkill(skill))       return canUnlockRadiantSkill(skill);
    if (isAdditionalSkill(skill))    return canUnlockAdditionalSkill(skill);
    return canUnlockSkill(skill);
  }

  function findDepSkill(skill, depName) {
    if (CosData.isMetalSkill(skill)) return CosData.findMetalSkillByName(depName, skill.cls);
    if (isRadiantSkill(skill))       return CosData.findRadiantSkillByName(depName, skill.cls);
    if (isAdditionalSkill(skill))    return CosData.findAdditionalSkillByName(depName, skill.cls);
    return CosData.findSkillByName(depName, skill.cls, skill.sub);
  }

  // Linhas de requisito (tooltip e modal): { met, text, special }
  function buildReqLines(skill) {
    const lines = [];
    if (skill.reqStat === 'level' && skill.reqVal > 0 && !skill.reqs) {
      lines.push({ met: state.profile.level >= skill.reqVal, text: `Nível ${skill.reqVal} (atual: ${state.profile.level})` });
    } else if (Array.isArray(skill.reqStat)) {
      for (let i = 0; i < skill.reqStat.length; i++) {
        const sName = skill.reqStat[i];
        const sVal  = Array.isArray(skill.reqVal) ? skill.reqVal[i] : skill.reqVal;
        const key   = sName.toLowerCase();
        const curVal = state.radiantPericias[key] || 0;
        const pInfo = CosData.PERICIAS_RADIANTES[key];
        lines.push({ met: curVal >= sVal, text: `${pInfo ? pInfo.name : sName} +${sVal} (atual: ${curVal})` });
      }
    } else if (isRadiantSkill(skill) && skill.reqStat && skill.reqVal > 0) {
      const key = skill.reqStat.toLowerCase();
      const curVal = state.radiantPericias[key] || state.pericias[CosData.statToPericia(skill.reqStat)] || 0;
      const pInfo = CosData.PERICIAS_RADIANTES[key];
      lines.push({ met: curVal >= skill.reqVal, text: `${pInfo ? pInfo.name : skill.reqStat} +${skill.reqVal} (atual: ${curVal})` });
    } else {
      lines.push(...statReqLines(skill));
    }
    if (skill.isPower) {
      lines.push({ met: state.unlockedSkills.has(skill.id), text: `Objetivo Metalnascido: ${goalNameForTree(skill.cls)}` });
    }
    for (const dep of skill.deps) {
      const depSkill = findDepSkill(skill, dep);
      lines.push({ met: !!(depSkill && state.unlockedSkills.has(depSkill.id)), text: dep });
    }
    if (skill.prereqText) lines.push({ special: true, text: skill.prereqText });
    return lines;
  }

  // Resumo do metal no modal de um nó de Poder (Alomancia/Feruquemia)
  function powerInfoHtml(skill) {
    const metal = CosData.getMetalOfTree(skill.cls);
    const art = CosData.getArtOfTree(skill.cls);
    if (!metal || !art) return '';
    const info = metal[art];
    const who = art === 'allo' ? info.misting : info.ferring;
    const extra = art === 'allo'
      ? [info.category, info.intExt, info.pushPull].filter(Boolean).join(' · ')
      : [info.category, info.alloy].filter(Boolean).join(' · ');
    return `<div class="modal-power-info" style="--metal-color:${metal.color}">
      <img src="${metal.svg}" alt="${metal.name}" class="modal-power-glyph">
      <div>
        <div class="modal-power-effect">${info.effect}</div>
        <div class="modal-power-meta">${who} · ${extra} · ${CosData.ERA_LABEL[info.era] || ''}</div>
      </div>
    </div>`;
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
    return canUnlockAny(skill).can;
  }

  // Árvore de ancestralidade visível (Cantor, Kandra ou Sangue-Koloss)
  function getAdditionalTreeClasses() {
    const race = RACES[state.profile.race];
    if (!race || !race.tree) return [];
    if (race.setting !== 'both' && !CosData.bookInSetting(race.setting)) return [];
    return [race.tree];
  }

  // Aba Metalnascida: nome do caminho escolhido (null se nenhum/cenário sem Mistborn)
  function getMetalbornTab() {
    const mb = state.profile.metalborn;
    return (isMistbornActive() && mb) ? mb.path : null;
  }

  // Na visão "Todas": o caminho e as Artes cujos poderes já foram treinados
  function getAllViewMetalEntries() {
    const path = getMetalbornTab();
    if (!path) return [];
    return [path, ...getAccessibleArtTrees().filter(isPowerTrained)];
  }

  let _allViewSignature = '';

  function rebuildTree(keepView) {
    if (state.activeClass === '_all') {
      const radiant = CosData.hasStormlight() ? state.profile.radiantClass : null;
      const additional = getAdditionalTreeClasses();
      const metal = getAllViewMetalEntries();
      // Só dá para atualizar em cena se o conjunto de árvores não mudou
      // (ex.: treinar um poder acrescenta a árvore dele ao anel)
      const signature = JSON.stringify([CosData.getSetting(), radiant, additional, metal]);
      if (keepView && SkillRenderer.getViewMode() === 'all' && signature === _allViewSignature) {
        SkillRenderer.updateStates(state.unlockedSkills, state.pericias, canUnlockCheck);
        return;
      }
      _allViewSignature = signature;
      SkillRenderer.buildAllTrees(state.unlockedSkills, state.pericias, canUnlockCheck, radiant, additional, metal);
    } else if (state.activeClass === getMetalbornTab()) {
      SkillRenderer.buildMetalbornTree(state.activeClass, getAccessibleArtTrees(),
        state.unlockedSkills, !!keepView, canUnlockCheck);
    } else {
      SkillRenderer.buildTree(state.activeClass, state.unlockedSkills, state.pericias, !!keepView, canUnlockCheck);
    }
  }

  // Troca de cenário (Cosmere / Mistborn / Misto). Reduzir o cenário só é permitido
  // se nada desbloqueado ficar escondido.
  function blockersForSetting(setting) {
    if (setting === 'misto') return [];
    const prev = CosData.getSetting();
    CosData.setSetting(setting);
    const visible = new Set(CosData.SKILLS.map(s => s.id));
    CosData.setSetting(prev);
    const out = [];
    for (const s of CosData.ALL_SKILLS) {
      if (state.unlockedSkills.has(s.id) && !state.freeUnlockedSkills.has(s.id) && !visible.has(s.id)) out.push(s.name);
    }
    if (setting === 'mistborn' && state.profile.radiantClass) out.push(`Ordem Radiante (${state.profile.radiantClass})`);
    if (setting === 'stormlight' && state.profile.metalborn) out.push(`Caminho ${state.profile.metalborn.path}`);
    const race = RACES[state.profile.race];
    if (race && race.setting !== 'both' && race.setting !== setting) out.push(`Ancestralidade ${race.name}`);
    return out;
  }

  function applySetting(setting) {
    CosData.setSetting(setting);
    state.profile.setting = setting;
    document.body.classList.toggle('setting-mistborn', setting === 'mistborn');
    document.body.classList.toggle('setting-misto', setting === 'misto');
    document.body.classList.toggle('setting-stormlight', setting === 'stormlight');
    SkillRenderer.setTheme(setting);
    // Cópias de talentos compartilhados que apareceram com o novo cenário
    for (const s of CosData.SKILLS) {
      if (state.unlockedSkills.has(s.id)) continue;
      const twin = CosData.SKILLS.find(o => o.name === s.name && o.id !== s.id && state.unlockedSkills.has(o.id));
      if (twin) { state.unlockedSkills.add(s.id); state.freeUnlockedSkills.add(s.id); }
    }
    const validTabs = ['_all', ...CosData.CLASSES, ...getAdditionalTreeClasses(), getMetalbornTab(),
      CosData.hasStormlight() ? state.profile.radiantClass : null].filter(Boolean);
    if (!validTabs.includes(state.activeClass)) state.activeClass = '_all';
  }

  // ---- SAVE / LOAD (lógica de estado — CRUD e modal estão em saves.js) ----

  function buildCurrentSaveData() {
    return {
      profile: state.profile,
      attributes: state.attributes,
      pericias: state.pericias,
      radiantPericias: state.radiantPericias,
      metalPericias: state.metalPericias,
      unlockedSkills: [...state.unlockedSkills],
      freeUnlockedSkills: [...state.freeUnlockedSkills],
      singerFreeIds: [...state.singerFreeIds],
      grantedIds: [...state.grantedIds],
      spentTalents: state.spentTalents,
      activeClass: state.activeClass,
    };
  }

  function applySaveData(data) {
    // Saves antigos não têm cenário: são do Cosmere (Stormlight)
    state.profile = { ...state.profile, radiantClassLocked: false, ancestryClass: null,
      setting: 'stormlight', era: 'livre', kandraBlessing: null, metalborn: null, ...data.profile };
    state.attributes = { ...state.attributes, ...data.attributes };
    state.pericias = { ...state.pericias, ...data.pericias };
    state.radiantPericias = { ...state.radiantPericias, ...data.radiantPericias };
    state.metalPericias = { alomancia: 0, feruquimia: 0, ...(data.metalPericias || {}) };
    state.unlockedSkills = new Set(data.unlockedSkills || []);
    state.freeUnlockedSkills = new Set(data.freeUnlockedSkills || []);
    state.singerFreeIds = new Set(data.singerFreeIds || []);
    state.grantedIds = new Set(data.grantedIds || []);
    state.spentTalents = data.spentTalents || 0;
    state.activeClass = data.activeClass || '_all';
    // O caminho "Ferring" foi renomeado para "Ferroso"
    const RENAMED = { 'Ferring': 'Ferroso' };
    const mb = state.profile.metalborn;
    if (mb && RENAMED[mb.path]) mb.path = RENAMED[mb.path];
    if (RENAMED[state.profile.ancestryClass]) state.profile.ancestryClass = RENAMED[state.profile.ancestryClass];
    if (RENAMED[state.activeClass]) state.activeClass = RENAMED[state.activeClass];
    applySetting(state.profile.setting);
    if (_chooserClose) _chooserClose('loaded');
    hideProfileModal();
    renderSidebar();
    renderClassTabs();
    rebuildTree();
  }

  // Volta para a tela inicial (escolha de cenário). O personagem atual é fechado.
  function goHome() {
    const hasWork = state.profile.name || state.unlockedSkills.size > 0;
    if (hasWork && !confirm('Voltar à tela inicial? O personagem atual será fechado — salve antes se quiser mantê-lo.')) return;
    resetProfile();
  }

  function resetProfile() {
    state.profile = { name: '', race: 'human', level: 1, setting: state.profile.setting || 'stormlight', era: 'livre',
      kandraBlessing: null, metalborn: null, radiantClass: null, radiantClassLocked: false, ancestryClass: null,
      pulverizadorCanone: null, rompeCeuCanone: null };
    state.attributes = { forca:0, velocidade:0, intelecto:0, vontade:0, consciencia:0, presenca:0 };
    initPericias();
    state.unlockedSkills = new Set();
    state.freeUnlockedSkills = new Set();
    state.singerFreeIds = new Set();
    state.grantedIds = new Set();
    state.spentTalents = 0;
    state.activeClass = '_all';

    renderSidebar();
    renderClassTabs();
    rebuildTree();
    startNewCharacterFlow();
  }

  // ---- ESCOLHA DE CENÁRIO (tela inicial) ----
  // mode 'new': início de um personagem novo (segue para o perfil)
  // mode 'change': troca posterior, pelo selo do cenário na barra lateral
  // Fecha a tela inicial por fora (ex.: um save foi carregado a partir dela)
  let _chooserClose = null;

  function showSettingChooser(mode) {
    return new Promise(resolve => {
      const current = state.profile.setting;
      const overlay = document.createElement('div');
      overlay.id = 'setting-chooser';
      overlay.className = 'setting-chooser';
      const cards = [
        { key: 'stormlight', title: 'Cosmere', sub: 'Roshar · Stormlight', img: 'svg/mundos/roshar.svg',
          desc: 'Ordens Radiantes, Surtos, Cantores e as especializações do Stormlight Handbook.' },
        { key: 'mistborn', title: 'Mistborn', sub: 'Scadrial · Eras 1 e 2', img: 'svg/mundos/scadrial.svg',
          desc: 'Alomancia, Feruquemia, Kandra, Sangue-Koloss e as especializações do Mistborn Handbook.' },
        { key: 'misto', title: 'Misto', sub: 'Roshar + Scadrial', img: 'svg/mundos/Cosmere.svg',
          desc: 'Tudo junto: trilhas unificadas, Ordens Radiantes e caminhos Metalnascidos no mesmo personagem.' },
      ];
      overlay.innerHTML = `
        <div class="sc-mist"></div>
        <div class="sc-content">
          <div class="sc-kicker">${mode === 'change' ? 'Trocar cenário' : 'Cosmere RPG · Novo personagem'}</div>
          <h1 class="sc-title">Onde sua história acontece?</h1>
          <p class="sc-subtitle">${mode === 'change'
            ? 'Você pode ampliar para o Misto a qualquer momento. Voltar para um só livro exige que nada fique escondido.'
            : 'Dá para misturar depois — o cenário Misto pode ser ativado a qualquer momento.'}</p>
          <div class="sc-cards">
            ${cards.map(c => `
              <button class="sc-card sc-card--${c.key} ${c.key === current && mode === 'change' ? 'current' : ''}" data-setting="${c.key}">
                <div class="sc-card-art">
                  <img src="${c.img}" alt="">
                </div>
                <div class="sc-card-title">${c.title}</div>
                <div class="sc-card-sub">${c.sub}</div>
                <div class="sc-card-desc">${c.desc}</div>
                ${c.key === current && mode === 'change' ? '<div class="sc-card-badge">Atual</div>' : ''}
              </button>`).join('')}
          </div>
          ${mode === 'change'
            ? '<button class="btn sc-cancel">Cancelar</button>'
            : `<div class="sc-alt">
                 <span>ou</span>
                 <button class="btn sc-load" type="button">Carregar personagem salvo</button>
                 <button class="btn sc-import" type="button">Importar ficha PDF</button>
               </div>`}
        </div>`;
      document.body.appendChild(overlay);
      requestAnimationFrame(() => overlay.classList.add('visible'));

      const close = value => {
        _chooserClose = null;
        overlay.classList.remove('visible');
        setTimeout(() => overlay.remove(), 350);
        resolve(value);
      };
      _chooserClose = close;
      overlay.querySelector('.sc-cancel')?.addEventListener('click', () => close(null));
      // Os saves e a importação abrem por cima; se carregarem um personagem, a tela fecha
      overlay.querySelector('.sc-load')?.addEventListener('click', () => SavesManager.showSavesModal());
      overlay.querySelector('.sc-import')?.addEventListener('click', () => importFromPDF());
      overlay.querySelectorAll('.sc-card').forEach(card => {
        card.addEventListener('click', () => {
          const key = card.dataset.setting;
          if (mode === 'change') {
            if (key === current) return close(null);
            const blockers = blockersForSetting(key);
            if (blockers.length) {
              notify(`Não dá para trocar: ${blockers.slice(0, 3).join(', ')}${blockers.length > 3 ? '…' : ''} ficaria de fora.`);
              return;
            }
          }
          close(key);
        });
      });
    });
  }

  async function startNewCharacterFlow() {
    const setting = await showSettingChooser('new');
    if (setting === 'loaded') return; // um save foi carregado a partir da tela inicial
    applySetting(setting || 'stormlight');
    renderSidebar();
    renderClassTabs();
    rebuildTree();
    showProfileModal(false);
  }

  async function changeSetting() {
    const setting = await showSettingChooser('change');
    if (!setting) return;
    applySetting(setting);
    renderSidebar();
    renderClassTabs();
    rebuildTree();
    notify(`Cenário: ${CosData.SETTINGS[setting].name}`);
  }

  // ---- IMPORT FROM PDF ----
  async function importFromPDF() {
    if (typeof PDFLib === 'undefined') {
      notify('pdf-lib não carregado. Recarregue a página e tente novamente.');
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
        // Mesmo mapeamento usado na exportação: as caixas seguem o rótulo
        // impresso na ficha pt-BR, que está em ordem alfabética diferente da
        // ficha original em inglês de onde vieram os nomes dos campos.
        const SKILL_RANK_BOXES = {
          agilidade:       [7, 10, 6, 9, 8],
          armamentoLeve:   [12, 15, 11, 14, 13],
          armamentoPesado: [17, 20, 16, 19, 18],
          atletismo:       [22, 25, 21, 24, 23],
          furtividade:     [27, 30, 26, 29, 28],
          ladroagem:       [32, 35, 31, 34, 33],
          deducao:         [42, 45, 41, 44, 43],
          disciplina:      [47, 50, 46, 49, 48],
          intimidacao:     [52, 55, 51, 54, 53],
          manufatura:      [57, 60, 56, 59, 58],
          medicina:        [62, 65, 61, 64, 63],
          saber:           [67, 70, 66, 69, 68],
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
          const surgeSlots = [
            { nameField: 'Custom Skill 1', boxes: [37, 40, 36, 39, 38] },
            { nameField: 'Custom Skill 2', boxes: [72, 75, 71, 74, 73] },
            { nameField: 'Custom Skill 3', boxes: [107, 110, 106, 109, 108] },
          ];
          // A linha custom usada por cada surto depende do atributo dele, então
          // localizamos pelo nome escrito na ficha (com fallback pela ordem).
          const freeSlots = [...surgeSlots];
          activeSurges.forEach(surgeKey => {
            const info = CosData.PERICIAS_RADIANTES[surgeKey];
            let slot = info
              ? freeSlots.find(s => getField(s.nameField).trim().toLowerCase() === info.name.toLowerCase())
              : null;
            if (!slot) slot = freeSlots[0]; // fichas antigas: ordem de listagem
            if (!slot) return;
            freeSlots.splice(freeSlots.indexOf(slot), 1);
            radiantPericias[surgeKey] = slot.boxes.filter(b => isChecked(`Rank Box ${b}`)).length;
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
        // A ficha PDF não guarda os campos do Mistborn: mantém o cenário atual
        Object.assign(state.profile, { setting: CosData.getSetting(), era: 'livre', kandraBlessing: null, metalborn: null });
        state.metalPericias = { alomancia: 0, feruquimia: 0 };
        state.grantedIds = new Set();
        applySetting(state.profile.setting);
        if (_chooserClose) _chooserClose('loaded');

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
      era: state.profile.era || 'livre',
      kandraBlessing: state.profile.kandraBlessing || 'consciencia',
    };

    const isNew = !canCancel;
    const mist = isMistbornActive();
    const humanDesc = mist
      ? 'Ganha 1 talento bônus de trilha heroica no nível 1 e a cada novo patamar.'
      : 'O 1º talento deve ser o Rank&nbsp;0 de uma classe mundana; o 2º fica restrito à mesma classe.';
    const raceCards = [
      { key: 'human',  desc: humanDesc },
      { key: 'singer', desc: '<em>Mudar Forma</em> desbloqueado gratuitamente + 1 talento livre para gastar em qualquer árvore.' },
      { key: 'kandra', desc: 'Só 6 pontos de atributo + uma Bênção. <em>Forma Natural</em> e <em>Disfarce Kandra</em> grátis; não pode ser Metalnascido.' },
      { key: 'koloss', desc: 'Força máxima +1 (até 4 na criação) e <em>Vigor Koloss</em> grátis (+1 de vida por nível). Era 2.' },
    ].filter(c => RACES[c.key].setting === 'both' || CosData.bookInSetting(RACES[c.key].setting))
     .map(c => ({ ...c, img: `<img src="${raceArt(c.key)}" alt="${RACES[c.key].name}" loading="lazy">` }));

    const eraOptions = [
      { v: 'livre', label: 'Livre', sub: 'sem restrição de era' },
      { v: 1, label: 'Era 1', sub: 'Império Final' },
      { v: 2, label: 'Era 2', sub: 'Pós-Catacendre' },
    ];

    modal.innerHTML = `
      <div class="pm-backdrop"></div>
      <div class="pm-content">
        <div class="pm-header">
          <span class="pm-title">${isNew ? 'Criar Personagem' : 'Editar Perfil'}</span>
          <span class="pm-setting-chip">${CosData.SETTINGS[state.profile.setting].name}</span>
          ${canCancel ? '<button class="pm-close" id="pm-close-btn">&times;</button>' : ''}
        </div>
        <div class="pm-body">

          <div class="pm-section">
            <div class="pm-section-title">Nome do Personagem</div>
            <input class="pm-name-input" id="pm-name-input" type="text"
              placeholder="Digite o nome..." value="${_profileDraft.name}" maxlength="40" autocomplete="off">
          </div>

          ${mist ? `
          <div class="pm-section">
            <div class="pm-section-title">Era de Scadrial</div>
            <div class="pm-era-row">
              ${eraOptions.map(o => `<button class="pm-era-btn ${String(_profileDraft.era) === String(o.v) ? 'active' : ''}" data-era="${o.v}">
                <span>${o.label}</span><small>${o.sub}</small></button>`).join('')}
            </div>
          </div>` : ''}

          ${isNew ? `
          <div class="pm-section">
            <div class="pm-section-title">Ancestralidade</div>
            <div class="pm-race-cards pm-race-cards--${raceCards.length}">
              ${raceCards.map(c => `
              <div class="pm-race-card ${_profileDraft.race === c.key ? 'active' : ''}" data-race="${c.key}">
                <div class="pm-race-img">${c.img}</div>
                <div class="pm-race-name">${RACES[c.key].name}</div>
                <div class="pm-race-desc">${c.desc}</div>
              </div>`).join('')}
            </div>
          </div>` : ''}

          <div class="pm-section pm-blessing-section" style="${_profileDraft.race === 'kandra' ? '' : 'display:none'}">
            <div class="pm-section-title">Bênção Kandra</div>
            <div class="pm-blessings">
              ${Object.entries(KANDRA_BLESSINGS).map(([k, b]) => `
                <button class="pm-blessing ${_profileDraft.kandraBlessing === k ? 'active' : ''}" data-blessing="${k}">
                  <span class="pm-blessing-name">${b.name}</span><span class="pm-blessing-desc">${b.desc}</span>
                </button>`).join('')}
            </div>
          </div>

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
          const bless = modal.querySelector('.pm-blessing-section');
          if (bless) bless.style.display = _profileDraft.race === 'kandra' ? '' : 'none';
        });
      });
    }

    modal.querySelectorAll('.pm-era-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const v = btn.dataset.era;
        _profileDraft.era = v === 'livre' ? 'livre' : Number(v);
        modal.querySelectorAll('.pm-era-btn').forEach(b => b.classList.toggle('active', b === btn));
      });
    });

    modal.querySelectorAll('.pm-blessing').forEach(btn => {
      btn.addEventListener('click', () => {
        _profileDraft.kandraBlessing = btn.dataset.blessing;
        modal.querySelectorAll('.pm-blessing').forEach(b => b.classList.toggle('active', b === btn));
      });
    });

    // Confirm
    document.getElementById('pm-confirm-btn')?.addEventListener('click', () => {
      if (!_profileDraft.name.trim()) {
        const inp = document.getElementById('pm-name-input');
        if (inp) { inp.focus(); inp.style.borderColor = 'var(--accent-red)'; }
        notify('Digite um nome para o personagem');
        return;
      }
      if (_profileDraft.race === 'koloss' && _profileDraft.era === 1) {
        notify('Sangue-Koloss só existe na Era 2 — escolha outra era ou ancestralidade');
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
    if (draft.era !== undefined) state.profile.era = draft.era;
    state.profile.kandraBlessing = draft.race === 'kandra' ? draft.kandraBlessing : null;

    // Handle race change effects
    if (draft.race !== prevRace) {
      if (draft.race === 'singer') {
        applySingerFreeSkills();
      } else {
        removeSingerFreeSkills();
      }
      removeAncestryGrants();
      if (draft.race === 'kandra' && state.profile.metalborn && !state.profile.metalborn.locked) {
        state.profile.metalborn = null; // Kandra não podem ser Metalnascidos
      }
    }
    applyAncestryGrants();

    renderSidebar();
    renderClassTabs();
    rebuildTree();
  }

  // ---- BOOK PDF UI STATE ----
  function updateBookPdfUI() {
    const btnBook    = document.getElementById('btn-load-book');
    const bookStatus = document.getElementById('book-pdf-status');
    const list       = document.getElementById('book-list');
    const btnExport  = document.getElementById('btn-export-desc');
    if (!btnBook) return;

    const books = PdfExtractor.listBooks();
    btnBook.textContent = books.length ? 'Carregar outro Livro (PDF)' : 'Carregar Livro (PDF)';
    if (btnExport) btnExport.disabled = !books.length;
    if (!books.length && bookStatus) {
      bookStatus.style.display = 'none';
      bookStatus.textContent   = '';
    }
    if (!list) return;
    list.innerHTML = books.map(b => `
      <div class="book-chip">
        <span class="book-chip-name">${b.label}</span>
        <span class="book-chip-count">${b.count} descrições</span>
        ${b.noBasics ? `<span class="book-chip-warn" title="Carregue este PDF de novo para extrair as habilidades básicas dos fluxos e metais">recarregar PDF</span>` : ''}
        ${b.translatable ? `<button class="book-chip-translate" data-book="${b.id}" title="Traduzir para português no próprio navegador">Traduzir</button>` : ''}
        <button class="book-chip-remove" data-book="${b.id}" title="Remover este livro">&times;</button>
      </div>`).join('');
    list.querySelectorAll('.book-chip-remove').forEach(btn => btn.addEventListener('click', () => {
      const b = books.find(x => x.id === btn.dataset.book);
      if (!confirm(`Remover as descrições de ${b ? b.label : 'este livro'}?`)) return;
      PdfExtractor.removeBook(btn.dataset.book);
      updateBookPdfUI();
    }));
    list.querySelectorAll('.book-chip-translate').forEach(btn => btn.addEventListener('click', async () => {
      list.querySelectorAll('button').forEach(b => { b.disabled = true; });
      bookStatus.style.display = 'block';
      bookStatus.textContent = 'Preparando o tradutor do navegador…';
      try {
        const { translated, total } = await PdfExtractor.translateBook(btn.dataset.book, msg => {
          bookStatus.textContent = msg;
        });
        bookStatus.textContent = `Tradução automática pronta: ${translated}/${total} descrições em português.`;
      } catch (err) {
        bookStatus.textContent = `Erro: ${err.message}`;
      }
      updateBookPdfUI();
    }));
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
    await CosData.loadMistbornSkills();
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
      // A ficha usa os atributos efetivos (com Bênção Kandra / Tamanho Desmedido)
      getState:        () => ({ ...state, attributes: effectiveAttributes() }),
      getDerivedStats: getDerivedStats,
      getBasicAbilities,
      notify,
    });

    // Bind UI
    bindUI();
    applySetting(state.profile.setting);

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
          if (!state.profile.name) startNewCharacterFlow();
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
            const cap = getAttrBaseMax(key);
            if (state.attributes[key] > cap) {
              state.attributes[key] = cap;
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
    const bookStatus = document.getElementById('book-pdf-status');

    btnBook?.addEventListener('click', () => bookInput?.click());

    bookInput?.addEventListener('change', async () => {
      const file = bookInput.files?.[0];
      if (!file) return;
      bookInput.value = '';

      btnBook.disabled = true;
      bookStatus.style.display = 'block';

      try {
        const { found, label } = await PdfExtractor.processFile(file, msg => {
          bookStatus.textContent = msg;
        });
        bookStatus.textContent = `${label}: ${found} descrições encontradas.`;
      } catch (err) {
        bookStatus.textContent = `Erro: ${err.message}`;
      } finally {
        btnBook.disabled = false;
        updateBookPdfUI();
      }
    });

    // ---- BACKUP PESSOAL DAS DESCRIÇÕES (outro aparelho sem o PDF) ----
    const backupInput = document.getElementById('book-backup-input');
    document.getElementById('btn-export-desc')?.addEventListener('click', () => {
      const url = URL.createObjectURL(PdfExtractor.exportBackup());
      const a = document.createElement('a');
      a.href = url;
      a.download = 'cosmere-descricoes-pessoal.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify('Backup exportado — é só para uso pessoal, não compartilhe.');
    });
    document.getElementById('btn-import-desc')?.addEventListener('click', () => backupInput?.click());
    backupInput?.addEventListener('change', async () => {
      const file = backupInput.files?.[0];
      backupInput.value = '';
      if (!file) return;
      try {
        const { books, applied } = await PdfExtractor.importBackup(file);
        bookStatus.style.display = 'block';
        bookStatus.textContent = `${books} livro(s) importado(s): ${applied} habilidades com descrição.`;
      } catch (err) {
        notify(err.message);
      }
      updateBookPdfUI();
    });
    // Radiant wheel close button + backdrop (Escape key)
    // Selo do cenário: troca Cosmere / Mistborn / Misto
    document.getElementById('setting-badge')?.addEventListener('click', changeSetting);
    document.getElementById('btn-home')?.addEventListener('click', goHome);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && document.getElementById('metal-table')?.classList.contains('visible')) MetalTable.hide();
    });

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

  // toggleSkill/canUnlock ficam expostos para testes e scripts de console
  async function toggleAndRefresh(skill) {
    const ok = await toggleSkill(skill);
    if (ok) { rebuildTree(true); renderSidebar(); renderClassTabs(); }
    return ok;
  }

  return { init, state, exportToSheet: PdfExport.exportToSheet, toggleSkill: toggleAndRefresh, canUnlock: canUnlockAny };

})();

// Boot
window.addEventListener('DOMContentLoaded', () => {
  App.init();
});