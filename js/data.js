// ============================================================
// Cosmere RPG Skill Tree - Game Data
// Skills are loaded from data/br-_skills.json for easy translation
// ============================================================

const CosData = (() => {

  // --- ATTRIBUTES ---
  const ATTRIBUTES = {
    forca:       { name: 'Forca',       abbr: 'FOR', defense: 'physical' },
    velocidade:  { name: 'Velocidade',  abbr: 'VEL', defense: 'physical' },
    intelecto:   { name: 'Intelecto',   abbr: 'INT', defense: 'cognitive' },
    vontade:     { name: 'Vontade',     abbr: 'VON', defense: 'cognitive' },
    consciencia: { name: 'Consciencia', abbr: 'CON', defense: 'spiritual' },
    presenca:    { name: 'Presenca',    abbr: 'PRE', defense: 'spiritual' }
  };

  // --- PERICIAS (Skills) ---
  const PERICIAS = {
    atletismo:       { name: 'Atletismo',         attr: 'forca',       en: 'Athletics' },
    armamentoPesado: { name: 'Armamento Pesado',  attr: 'forca',       en: 'Heavy Weapons' },
    armamentoLeve:   { name: 'Armamento Leve',    attr: 'velocidade',  en: 'Light Weapons' },
    agilidade:       { name: 'Agilidade',         attr: 'velocidade',  en: 'Agility' },
    furtividade:     { name: 'Furtividade',       attr: 'velocidade',  en: 'Stealth' },
    ladroagem:       { name: 'Ladroagem',         attr: 'velocidade',  en: 'Thievery' },
    deducao:         { name: 'Deducao',           attr: 'intelecto',   en: 'Deduction' },
    manufatura:      { name: 'Manufatura',        attr: 'intelecto',   en: 'Crafting' },
    medicina:        { name: 'Medicina',          attr: 'intelecto',   en: 'Medicine' },
    saber:           { name: 'Saber',             attr: 'intelecto',   en: 'Lore' },
    disciplina:      { name: 'Disciplina',        attr: 'vontade',     en: 'Discipline' },
    intimidacao:     { name: 'Intimidacao',       attr: 'vontade',     en: 'Intimidation' },
    intuicao:        { name: 'Intuicao',          attr: 'consciencia', en: 'Insight' },
    percepcao:       { name: 'Percepcao',         attr: 'consciencia', en: 'Perception' },
    sobrevivencia:   { name: 'Sobrevivencia',     attr: 'consciencia', en: 'Survival' },
    dissimulacao:    { name: 'Dissimulacao',      attr: 'presenca',    en: 'Deception' },
    lideranca:       { name: 'Lideranca',         attr: 'presenca',    en: 'Leadership' },
    persuasao:       { name: 'Persuasao',         attr: 'presenca',    en: 'Persuasion' }
  };

  const PERICIAS_RADIANTES = {
    abrasao:       { name: 'Abrasão',       attr: 'velocidade' },
    adesao:        { name: 'Adesão',        attr: 'presenca' },
    coesao:        { name: 'Coesão',        attr: 'vontade' },
    divisao:       { name: 'Divisão',       attr: 'intelecto' },
    gravitacao:    { name: 'Gravitação',    attr: 'consciencia' },
    iluminacao:    { name: 'Iluminação',    attr: 'presenca' },
    progressao:    { name: 'Progressão',    attr: 'consciencia' },
    tensao:        { name: 'Tensão',        attr: 'forca' },
    transformacao: { name: 'Transformação', attr: 'vontade' },
    transporte:    { name: 'Transporte',    attr: 'intelecto' }
  };

  // Surges granted per Radiant Order (2 per order)
  const RADIANT_CLASS_PERICIAS = {
    'Corredor dos Ventos':       ['adesao',        'gravitacao'],
    'Rompe-Céu':                 ['divisao',       'gravitacao'],
    'Pulverizador':              ['divisao',       'abrasao'],
    'Dançarino dos Precipícios': ['abrasao',       'progressao'],
    'Sentinela da Verdade':      ['progressao',    'iluminacao'],
    'Teceluz':                   ['iluminacao',    'transformacao'],
    'Alternauta':                ['transformacao', 'transporte'],
    'Plasmador':                 ['transporte',    'coesao'],
    'Guardião das Pedras':       ['coesao',        'tensao'],
  };

  // English-to-key mapping
  const EN_TO_PERICIA = {};
  for (const [key, val] of Object.entries(PERICIAS)) {
    EN_TO_PERICIA[val.en.trim()] = key;
  }

  // --- DEFENSES ---
  const DEFENSES = {
    physical:  { name: 'Defesa Fisica',     attrs: ['forca', 'velocidade'] },
    cognitive: { name: 'Defesa Cognitiva',   attrs: ['intelecto', 'vontade'] },
    spiritual: { name: 'Defesa Espiritual',  attrs: ['consciencia', 'presenca'] }
  };

  // --- LEVEL PROGRESSION TABLE ---
  const LEVEL_TABLE = [];
  for (let lvl = 1; lvl <= 30; lvl++) {
    let tier, attrPoints, hpGain, maxRank, periciaRanks, talents, ancestryBonus;
    if (lvl === 1) {
      tier = 1; attrPoints = 12; hpGain = '10+FOR'; maxRank = 2;
      periciaRanks = 5; talents = 1; ancestryBonus = true;
    } else if (lvl <= 5) {
      tier = 1;
      attrPoints = (lvl === 3 || lvl === 5) ? 1 : 0;
      hpGain = 5; maxRank = 2; periciaRanks = 2; talents = 1;
      ancestryBonus = false;
    } else if (lvl <= 10) {
      tier = 2;
      attrPoints = (lvl === 6 || lvl === 9) ? 1 : 0;
      hpGain = (lvl === 6) ? '4+FOR' : 4;
      maxRank = 3; periciaRanks = 2; talents = 1;
      ancestryBonus = (lvl === 6);
    } else if (lvl <= 15) {
      tier = 3;
      attrPoints = (lvl === 12 || lvl === 15) ? 1 : 0;
      hpGain = (lvl === 11) ? '3+FOR' : 3;
      maxRank = 4; periciaRanks = 2; talents = 1;
      ancestryBonus = (lvl === 11);
    } else if (lvl <= 20) {
      tier = 4;
      attrPoints = (lvl === 18) ? 1 : 0;
      hpGain = (lvl === 16) ? '2+FOR' : 2;
      maxRank = 5; periciaRanks = 2; talents = 1;
      ancestryBonus = (lvl === 16);
    } else {
      tier = 5;
      attrPoints = 0; hpGain = 1; maxRank = 5;
      periciaRanks = 0; talents = 0;
      ancestryBonus = (lvl === 21);
    }
    LEVEL_TABLE.push({ level: lvl, tier, attrPoints, hpGain, maxRank, periciaRanks, talents, ancestryBonus });
  }

  // --- CLASSES & SUBCLASSES ---
  const CLASSES = ['Agente', 'Emissário', 'Caçador', 'Líder', 'Erudito', 'Guerreiro'];

  const SUBCLASSES = {
    Agente:    ['Investigador', 'Espião',       'Ladrão'],
    Emissário: ['Diplomata',    'Fiel',         'Mentor'],
    Caçador:   ['Arqueiro',     'Assassino',    'Rastreador'],
    Líder:     ['Campeão',      'Oficial',      'Político'],
    Erudito:   ['Artifabriano', 'Estrategista', 'Cirurgião'],
    Guerreiro: ['Duelista',     'Fractário',    'Soldado']
  };

  // --- SKILL DATA (loaded from JSON) ---
  let SKILLS = [];

  async function loadSkills() {
    const resp = await fetch('data/br_skills.json');
    SKILLS = await resp.json();
    return SKILLS;
  }

  // --- RADIANT DATA (loaded from JSON, IDs offset by +10000 to avoid collision) ---
  const RADIANT_ID_OFFSET = 10000;
  let RADIANT_SKILLS = [];
  let RADIANT_CLASSES = [];
  let RADIANT_SUBCLASSES = {};

  // --- ADDITIONAL TREES (Cantor race + extra order paths, IDs offset by +20000) ---
  const ADDITIONAL_ID_OFFSET = 20000;
  let ADDITIONAL_SKILLS = [];
  let ADDITIONAL_CLASSES = [];
  let ADDITIONAL_SUBCLASSES = {};

  async function loadRadiantSkills() {
    const resp = await fetch('data/br_radiant_paths.json');
    const raw = await resp.json();
    // Offset IDs so they never collide with regular skill IDs
    RADIANT_SKILLS = raw.map(s => ({ ...s, id: s.id + RADIANT_ID_OFFSET }));

    // Derive classes and subclasses from data
    const clsSet = [];
    const subMap = {};
    for (const s of RADIANT_SKILLS) {
      if (!clsSet.includes(s.cls)) {
        clsSet.push(s.cls);
        subMap[s.cls] = [];
      }
      if (s.sub !== '-' && !subMap[s.cls].includes(s.sub)) {
        subMap[s.cls].push(s.sub);
      }
    }
    RADIANT_CLASSES = clsSet;
    RADIANT_SUBCLASSES = subMap;
    return RADIANT_SKILLS;
  }

  async function loadAdditionalSkills() {
    const resp = await fetch('data/br_adittionais_trees.json');
    const raw = await resp.json();
    ADDITIONAL_SKILLS = raw.map(s => ({ ...s, id: s.id + ADDITIONAL_ID_OFFSET }));

    const clsSet = [];
    const subMap = {};
    for (const s of ADDITIONAL_SKILLS) {
      if (!clsSet.includes(s.cls)) {
        clsSet.push(s.cls);
        subMap[s.cls] = [];
      }
      if (s.sub !== '-' && !subMap[s.cls].includes(s.sub)) {
        subMap[s.cls].push(s.sub);
      }
    }
    ADDITIONAL_CLASSES = clsSet;
    ADDITIONAL_SUBCLASSES = subMap;
    return ADDITIONAL_SKILLS;
  }

  function getAdditionalSkillsByClass(cls) {
    return ADDITIONAL_SKILLS.filter(s => s.cls === cls);
  }

  function getRootAdditionalSkill(cls) {
    return ADDITIONAL_SKILLS.find(s => s.cls === cls && s.rank === 0);
  }

  function findAdditionalSkillByName(name, cls) {
    return ADDITIONAL_SKILLS.find(s => s.cls === cls && s.name === name);
  }

  function buildAdditionalGraph(cls) {
    const skills = getAdditionalSkillsByClass(cls);
    const children = {};
    for (const s of skills) children[s.name] = children[s.name] || [];
    for (const s of skills) {
      for (const depName of s.deps) {
        const parent = findAdditionalSkillByName(depName, cls);
        if (parent) {
          if (!children[parent.name].includes(s)) children[parent.name].push(s);
        }
      }
    }
    return { skills, children };
  }

  function getRadiantSkillsByClass(cls) {
    return RADIANT_SKILLS.filter(s => s.cls === cls);
  }

  function getRootRadiantSkill(cls) {
    return RADIANT_SKILLS.find(s => s.cls === cls && s.rank === 0);
  }

  function findRadiantSkillByName(name, cls) {
    return RADIANT_SKILLS.find(s => s.cls === cls && s.name === name);
  }

  function buildRadiantGraph(cls) {
    const skills = getRadiantSkillsByClass(cls);
    const children = {};
    for (const s of skills) children[s.name] = children[s.name] || [];
    for (const s of skills) {
      for (const depName of s.deps) {
        const parent = findRadiantSkillByName(depName, cls);
        if (parent) {
          if (!children[parent.name].includes(s)) children[parent.name].push(s);
        }
      }
    }
    return { skills, children };
  }

  // --- HELPER FUNCTIONS ---

  function getSkillsByClass(cls) {
    return SKILLS.filter(s => s.cls === cls);
  }

  function getSkillById(id) {
    return SKILLS.find(s => s.id === id);
  }

  function findSkillByName(name, cls) {
    return SKILLS.find(s => s.cls === cls && s.name === name);
  }

  function getSubclassSkills(cls, sub) {
    return SKILLS.filter(s => s.cls === cls && s.sub === sub);
  }

  function getRootSkill(cls) {
    return SKILLS.find(s => s.cls === cls && s.rank === 0);
  }

  // Build adjacency: parent -> children (within same class)
  function buildGraph(cls) {
    const skills = getSkillsByClass(cls);
    const children = {};
    const parents = {};

    for (const s of skills) {
      children[s.name] = children[s.name] || [];
      parents[s.name] = parents[s.name] || [];
    }

    for (const s of skills) {
      for (const depName of s.deps) {
        const parent = findSkillByName(depName, cls);
        if (parent) {
          if (!children[parent.name].includes(s)) children[parent.name].push(s);
          if (!parents[s.name].includes(parent)) parents[s.name].push(parent);
        }
      }
    }

    return { skills, children, parents };
  }

  // Compute total points available at a given level
  function computePointsAtLevel(level) {
    let totalAttr = 0, totalPericia = 0, totalTalents = 0, totalAncestry = 0;
    let maxPericiaRank = 2;
    for (let i = 0; i < LEVEL_TABLE.length && LEVEL_TABLE[i].level <= level; i++) {
      const row = LEVEL_TABLE[i];
      totalAttr += row.attrPoints;
      totalPericia += row.periciaRanks;
      totalTalents += row.talents;
      if (row.ancestryBonus) totalAncestry++;
      maxPericiaRank = row.maxRank;
    }
    return { totalAttr, totalPericia, totalTalents, totalAncestry, maxPericiaRank };
  }

  // Map English stat name to pericia key
  function statToPericia(enName) {
    if (!enName) return null;
    return EN_TO_PERICIA[enName.trim()] || null;
  }

  return {
    ATTRIBUTES, PERICIAS, PERICIAS_RADIANTES, RADIANT_CLASS_PERICIAS, EN_TO_PERICIA, DEFENSES,
    LEVEL_TABLE, CLASSES, SUBCLASSES,
    get RADIANT_CLASSES()       { return RADIANT_CLASSES; },
    get RADIANT_SUBCLASSES()    { return RADIANT_SUBCLASSES; },
    get SKILLS()                { return SKILLS; },
    get RADIANT_SKILLS()        { return RADIANT_SKILLS; },
    get ADDITIONAL_SKILLS()     { return ADDITIONAL_SKILLS; },
    get ADDITIONAL_CLASSES()    { return ADDITIONAL_CLASSES; },
    get ADDITIONAL_SUBCLASSES() { return ADDITIONAL_SUBCLASSES; },
    ADDITIONAL_ID_OFFSET,
    loadSkills, loadRadiantSkills, loadAdditionalSkills,
    getSkillsByClass, getSkillById, findSkillByName,
    getRadiantSkillsByClass, getRootRadiantSkill,
    findRadiantSkillByName, buildRadiantGraph,
    getAdditionalSkillsByClass, getRootAdditionalSkill,
    findAdditionalSkillByName, buildAdditionalGraph,
    getSubclassSkills, getRootSkill, buildGraph,
    computePointsAtLevel, statToPericia
  };

})();
