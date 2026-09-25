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
    'Dançarino de Precipícios':  ['abrasao',       'progressao'],
    'Sentinela da Verdade':      ['progressao',    'iluminacao'],
    'Teceluz':                   ['iluminacao',    'transformacao'],
    'Alternauta':                ['transformacao', 'transporte'],
    'Plasmador':                 ['transporte',    'coesao'],
    'Guardião das Pedras':       ['coesao',        'tensao'],
  };

  // Perícias Investidas do Mistborn — só existem na ficha após um talento-chave Metalnascido
  const PERICIAS_METALICAS = {
    alomancia:  { name: 'Alomancia',  attr: 'vontade',   en: 'Allomancy' },
    feruquimia: { name: 'Feruquemia', attr: 'intelecto', en: 'Feruchemy' },
  };

  // English-to-key mapping
  const EN_TO_PERICIA = {};
  for (const [key, val] of Object.entries(PERICIAS)) {
    EN_TO_PERICIA[val.en.trim()] = key;
  }
  // O Mistborn Handbook usa "Weaponry" onde o Stormlight usa "Weapons"
  EN_TO_PERICIA['Heavy Weaponry'] = 'armamentoPesado';
  EN_TO_PERICIA['Light Weaponry'] = 'armamentoLeve';

  const EN_TO_METAL_PERICIA = { Allomancy: 'alomancia', Feruchemy: 'feruquimia' };
  const EN_TO_ATTRIBUTE = {
    Strength: 'forca', Speed: 'velocidade', Intellect: 'intelecto',
    Willpower: 'vontade', Awareness: 'consciencia', Presence: 'presenca',
  };

  // --- CENÁRIO DE JOGO ---
  // 'stormlight' (Cosmere/Roshar), 'mistborn' (Scadrial) ou 'misto' (ambos)
  const SETTINGS = {
    stormlight: { name: 'Cosmere',  sub: 'Roshar · Stormlight' },
    mistborn:   { name: 'Mistborn', sub: 'Scadrial · Nascidos da Bruma' },
    misto:      { name: 'Misto',    sub: 'Roshar + Scadrial' },
  };
  let SETTING = 'stormlight';
  const _settingCache = {};

  function setSetting(s) {
    if (!SETTINGS[s] || s === SETTING) return;
    SETTING = s;
    for (const k of Object.keys(_settingCache)) delete _settingCache[k];
  }
  function getSetting() { return SETTING; }

  // book: 'stormlight' | 'mistborn' | 'both'
  function bookInSetting(book) {
    if (!book || book === 'both' || SETTING === 'misto') return true;
    return book === SETTING;
  }
  function hasMistborn()   { return SETTING !== 'stormlight'; }
  function hasStormlight() { return SETTING !== 'mistborn'; }

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
      periciaRanks = 4; talents = 1; ancestryBonus = true;
    } else if (lvl <= 5) {
      tier = 1;
      attrPoints = (lvl === 3 || lvl === 5) ? 1 : 0;
      hpGain = 5; maxRank = 2; periciaRanks = 2; talents = 1;
      ancestryBonus = false;
    } else if (lvl <= 10) {
      tier = 2;
      attrPoints = (lvl === 6 || lvl === 9) ? 1 : 0;
      hpGain = (lvl === 6) ? '4+FOR' : 4;
      maxRank = 3; periciaRanks = 2; talents = (lvl === 6) ? 2 : 1;
      ancestryBonus = (lvl === 6);
    } else if (lvl <= 15) {
      tier = 3;
      attrPoints = (lvl === 12 || lvl === 15) ? 1 : 0;
      hpGain = (lvl === 11) ? '3+FOR' : 3;
      maxRank = 4; periciaRanks = 2; talents = (lvl === 11) ? 2 : 1;
      ancestryBonus = (lvl === 11);
    } else if (lvl <= 20) {
      tier = 4;
      attrPoints = (lvl === 18) ? 1 : 0;
      hpGain = (lvl === 16) ? '2+FOR' : 2;
      maxRank = 5; periciaRanks = 2; talents = (lvl === 16) ? 2 : 1;
      ancestryBonus = (lvl === 16);
    } else {
      tier = 5;
      attrPoints = 0; hpGain = 1; maxRank = 5;
      periciaRanks = 0; talents = (lvl === 21) ? 1 : 0;
      ancestryBonus = (lvl === 21);
    }
    LEVEL_TABLE.push({ level: lvl, tier, attrPoints, hpGain, maxRank, periciaRanks, talents, ancestryBonus });
  }

  // --- CLASSES & SUBCLASSES ---
  const CLASSES = ['Agente', 'Emissário', 'Caçador', 'Líder', 'Erudito', 'Guerreiro'];

  // Especializações por trilha heroica, com o livro de origem de cada uma.
  // Sobrescrito por br_mistborn.json (que acrescenta as especializações de Scadrial).
  let SPECIALTIES = {
    Agente:    [{ sub: 'Investigador' }, { sub: 'Espião' },       { sub: 'Ladrão' }],
    Emissário: [{ sub: 'Diplomata' },    { sub: 'Fiel' },         { sub: 'Mentor' }],
    Caçador:   [{ sub: 'Arqueiro' },     { sub: 'Assassino' },    { sub: 'Rastreador' }],
    Líder:     [{ sub: 'Campeão' },      { sub: 'Oficial' },      { sub: 'Político' }],
    Erudito:   [{ sub: 'Artifabriano' }, { sub: 'Estrategista' }, { sub: 'Cirurgião' }],
    Guerreiro: [{ sub: 'Duelista' },     { sub: 'Fractário' },    { sub: 'Soldado' }],
  };
  let SPECIALTY_ERA = {};

  function specialtyBook(cls, sub) {
    if (!sub || sub === '-') return 'both';
    const spec = (SPECIALTIES[cls] || []).find(s => s.sub === sub);
    return (spec && spec.book) || 'stormlight';
  }

  function getSubclasses() {
    if (_settingCache.subclasses) return _settingCache.subclasses;
    const out = {};
    for (const [cls, specs] of Object.entries(SPECIALTIES)) {
      out[cls] = specs.filter(s => bookInSetting(s.book || 'stormlight')).map(s => s.sub);
    }
    return (_settingCache.subclasses = out);
  }

  // --- SKILL DATA (loaded from JSON) ---
  // ALL_SKILLS guarda as trilhas heroicas dos dois livros; SKILLS expõe só o cenário ativo.
  let ALL_SKILLS = [];

  function getSkills() {
    if (_settingCache.skills) return _settingCache.skills;
    return (_settingCache.skills = ALL_SKILLS.filter(s => bookInSetting(s.book)));
  }

  async function loadSkills() {
    const resp = await fetch('data/br_skills.json');
    ALL_SKILLS = await resp.json();
    for (const s of ALL_SKILLS) s.book = specialtyBook(s.cls, s.sub);
    // Nomes originais (mesmos IDs) — o livro do Mistborn em inglês usa estes nomes
    try {
      const en = await (await fetch('data/skills.json')).json();
      const byId = new Map(en.map(s => [s.id, s.name]));
      for (const s of ALL_SKILLS) if (byId.has(s.id)) s.en = byId.get(s.id);
    } catch (_) { /* sem nomes em inglês: só o livro pt-BR casa descrições */ }
    linkHeroicRoots();
    return ALL_SKILLS;
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
    const data = await resp.json();

    const flat = [];
    let counter = 0;

    for (const [cls, order] of Object.entries(data.orders)) {
      // Bond skills first
      for (const skill of order.bond) {
        flat.push({ ...skill, id: (++counter) + RADIANT_ID_OFFSET, cls, prereqText: null, description: '' });
      }

      // Surge skills — apply per-order overrides where defined
      for (const surgeName of order.surges) {
        const surgeSkills = data.surges[surgeName];
        const overrides = (order.overrides || []).filter(o => o.surge === surgeName);

        for (const skill of surgeSkills) {
          const override = overrides.find(o => o.name === skill.name);
          const expanded = { ...skill };
          if (override) {
            const { surge: _drop, ...fields } = override;
            Object.assign(expanded, fields);
          }
          flat.push({ ...expanded, id: (++counter) + RADIANT_ID_OFFSET, cls, prereqText: null, description: '' });
        }
      }
    }

    RADIANT_SKILLS = flat;

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
      const isRadiant = RADIANT_SKILLS.some(r => r.cls === s.cls);
      // Only treat as a standalone additional class if it isn't already a radiant class
      if (!isRadiant && !clsSet.includes(s.cls)) {
        clsSet.push(s.cls);
      }
      // Always track subclasses so the renderer can label disconnected sub-trees
      if (!subMap[s.cls]) subMap[s.cls] = [];
      if (s.sub !== '-' && !subMap[s.cls].includes(s.sub)) {
        subMap[s.cls].push(s.sub);
      }
    }
    ADDITIONAL_CLASSES = clsSet;
    ADDITIONAL_SUBCLASSES = subMap;
    return ADDITIONAL_SKILLS;
  }

  // --- MISTBORN (Scadrial) ---
  // Trilhas heroicas novas entram em ALL_SKILLS (IDs 30000+); Kandra e Sangue-Koloss
  // entram nas árvores adicionais (40000+); caminhos Metalnascidos (50000+) e
  // Artes Metálicas (60000+) formam um pool próprio, METAL_SKILLS.
  let METAL_SKILLS = [];
  let METALBORN_PATHS = {};
  let METALS = [];
  let METAL_CLASSES = [];       // nomes das árvores do pool metálico (caminhos + artes)
  let MISTBORN_ANCESTRY_CLASSES = [];

  async function loadMistbornSkills() {
    const resp = await fetch('data/br_mistborn.json');
    const data = await resp.json();

    SPECIALTIES = data.specialties;
    SPECIALTY_ERA = data.specialtyEra || {};
    for (const s of ALL_SKILLS) s.book = specialtyBook(s.cls, s.sub);
    for (const s of data.heroic) ALL_SKILLS.push({ ...s, book: 'mistborn' });

    for (const s of data.ancestry) {
      ADDITIONAL_SKILLS.push({ ...s, book: 'mistborn' });
      if (!ADDITIONAL_CLASSES.includes(s.cls)) ADDITIONAL_CLASSES.push(s.cls);
      if (!ADDITIONAL_SUBCLASSES[s.cls]) ADDITIONAL_SUBCLASSES[s.cls] = [];
      if (s.sub !== '-' && !ADDITIONAL_SUBCLASSES[s.cls].includes(s.sub)) ADDITIONAL_SUBCLASSES[s.cls].push(s.sub);
      if (!MISTBORN_ANCESTRY_CLASSES.includes(s.cls)) MISTBORN_ANCESTRY_CLASSES.push(s.cls);
    }

    METALBORN_PATHS = data.paths;
    METALS = data.metals;
    METAL_SKILLS = [
      ...data.metalbornTalents.map(s => ({ ...s, book: 'mistborn', pool: 'path' })),
      ...data.arts.map(s => ({ ...s, book: 'mistborn', pool: 'art' })),
    ];
    METAL_CLASSES = [...new Set(METAL_SKILLS.map(s => s.cls))];
    linkHeroicRoots();
    for (const k of Object.keys(_settingCache)) delete _settingCache[k];
    return METAL_SKILLS;
  }

  // Talentos do 1º nível de uma especialização dependem do talento-chave da trilha.
  // Parte dos dados omitia isso (deps vazio) e a árvore ficava sem a linha até a raiz.
  function linkHeroicRoots() {
    for (const s of ALL_SKILLS) {
      if (s.rank !== 1 || s.sub === '-' || s.deps.length) continue;
      const root = ALL_SKILLS.find(r => r.cls === s.cls && r.rank === 0);
      if (root) s.deps = [root.name];
    }
  }

  function getMetal(key)           { return METALS.find(m => m.key === key) || null; }
  function artTreeName(art, key)   { const m = getMetal(key); return m ? m[art].tree : null; }
  function getMetalOfTree(cls)     { return METALS.find(m => m.allo.tree === cls || m.feru.tree === cls) || null; }
  function getArtOfTree(cls)       {
    const m = getMetalOfTree(cls);
    return !m ? null : (m.allo.tree === cls ? 'allo' : 'feru');
  }
  function isMetalbornPathClass(cls) { return !!METALBORN_PATHS[cls]; }
  function isMetalSkill(skill)     { return !!skill && skill.id > 50000 && skill.id < 70000; }
  function getMetalSkillsByClass(cls) { return METAL_SKILLS.filter(s => s.cls === cls); }
  function getRootMetalSkill(cls)  { return METAL_SKILLS.find(s => s.cls === cls && s.rank === 0); }
  function findMetalSkillByName(name, cls) { return METAL_SKILLS.find(s => s.cls === cls && s.name === name); }

  function buildMetalGraph(cls) {
    const skills = getMetalSkillsByClass(cls);
    const children = {};
    for (const s of skills) children[s.name] = children[s.name] || [];
    for (const s of skills) {
      for (const depName of s.deps) {
        const parent = findMetalSkillByName(depName, cls);
        if (parent && !children[parent.name].includes(s)) children[parent.name].push(s);
      }
    }
    return { skills, children };
  }

  // Disponibilidade por era: 'ambas' | 'e1' | 'e2' | 'e2late' (fim da Era 1 ou Era 2)
  function eraAllows(eraTag, era) {
    if (!eraTag || eraTag === 'ambas' || !era || era === 'livre') return true;
    if (eraTag === 'e1') return era === 1;
    if (eraTag === 'e2') return era === 2;
    if (eraTag === 'e2late') return true; // conhecido no fim da Era 1 e durante a Era 2
    return true;
  }
  const ERA_LABEL = { ambas: 'Ambas as eras', e1: 'Era 1', e2: 'Era 2', e2late: 'Fim da Era 1 / Era 2' };

  let OATHS = [];
  async function loadOaths() {
    const resp = await fetch('data/br_oaths.json');
    OATHS = await resp.json();
    return OATHS;
  }
  function getOathData(cls) {
    return OATHS.find(o => o.cls === cls) || null;
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
    const exact = RADIANT_SKILLS.find(s => s.cls === cls && s.name === name);
    if (exact) return exact;
    // Deps que referenciam "Primeiro Ideal" resolvem para o nó raiz (rank 0) da classe,
    // independente de como o nó raiz foi nomeado
    if (name === 'Primeiro Ideal') return RADIANT_SKILLS.find(s => s.cls === cls && s.rank === 0);
    return undefined;
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
    return getSkills().filter(s => s.cls === cls);
  }

  function getSkillById(id) {
    return getSkills().find(s => s.id === id);
  }

  // Um mesmo nome pode aparecer em várias especializações da mesma trilha
  // (ex.: Compostura em Idealizador e Oficial). Quando `sub` é informado,
  // prefere a cópia da mesma especialização para não cruzar ramos.
  function findSkillByName(name, cls, sub) {
    const skills = getSkills();
    if (sub) {
      const same = skills.find(s => s.cls === cls && s.sub === sub && s.name === name);
      if (same) return same;
    }
    return skills.find(s => s.cls === cls && s.name === name);
  }

  function getSubclassSkills(cls, sub) {
    return getSkills().filter(s => s.cls === cls && s.sub === sub);
  }

  function getRootSkill(cls) {
    return getSkills().find(s => s.cls === cls && s.rank === 0);
  }

  // Build adjacency: parent -> children (within same class)
  // Keyed by id: a class may hold several nodes with the same name in different
  // specialties (ex.: Compostura em Idealizador e em Oficial no modo Misto).
  function buildGraph(cls) {
    const skills = getSkillsByClass(cls);
    const children = {};
    const parents = {};

    for (const s of skills) {
      children[s.id] = children[s.id] || [];
      parents[s.id] = parents[s.id] || [];
    }

    for (const s of skills) {
      for (const depName of s.deps) {
        const parent = findSkillByName(depName, cls, s.sub);
        if (parent) {
          if (!children[parent.id].includes(s)) children[parent.id].push(s);
          if (!parents[s.id].includes(parent)) parents[s.id].push(parent);
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

  // Classifica um requisito do livro: perícia comum, perícia Investida, atributo ou nível.
  // Retorna { kind, key, name } ou null.
  function describeStat(enName) {
    if (!enName) return null;
    const n = enName.trim();
    if (n === 'level') return { kind: 'level', key: 'level', name: 'Nível' };
    if (EN_TO_PERICIA[n])       return { kind: 'pericia', key: EN_TO_PERICIA[n], name: PERICIAS[EN_TO_PERICIA[n]].name };
    if (EN_TO_METAL_PERICIA[n]) return { kind: 'metal', key: EN_TO_METAL_PERICIA[n], name: PERICIAS_METALICAS[EN_TO_METAL_PERICIA[n]].name };
    if (EN_TO_ATTRIBUTE[n])     return { kind: 'attr', key: EN_TO_ATTRIBUTE[n], name: ATTRIBUTES[EN_TO_ATTRIBUTE[n]].name };
    return null;
  }

  return {
    ATTRIBUTES, PERICIAS, PERICIAS_RADIANTES, PERICIAS_METALICAS, RADIANT_CLASS_PERICIAS, EN_TO_PERICIA, DEFENSES,
    LEVEL_TABLE, CLASSES,
    SETTINGS, setSetting, getSetting, bookInSetting, hasMistborn, hasStormlight,
    get SUBCLASSES()            { return getSubclasses(); },
    get SPECIALTIES()           { return SPECIALTIES; },
    get SPECIALTY_ERA()         { return SPECIALTY_ERA; },
    get RADIANT_CLASSES()       { return RADIANT_CLASSES; },
    get RADIANT_SUBCLASSES()    { return RADIANT_SUBCLASSES; },
    get SKILLS()                { return getSkills(); },
    get ALL_SKILLS()            { return ALL_SKILLS; },
    get METAL_SKILLS()          { return METAL_SKILLS; },
    get METAL_CLASSES()         { return METAL_CLASSES; },
    get METALBORN_PATHS()       { return METALBORN_PATHS; },
    get METALS()                { return METALS; },
    get MISTBORN_ANCESTRY_CLASSES() { return MISTBORN_ANCESTRY_CLASSES; },
    ERA_LABEL, eraAllows, specialtyBook,
    loadMistbornSkills, getMetal, artTreeName, getMetalOfTree, getArtOfTree, isMetalbornPathClass,
    isMetalSkill, getMetalSkillsByClass, getRootMetalSkill, findMetalSkillByName, buildMetalGraph,
    describeStat,
    get RADIANT_SKILLS()        { return RADIANT_SKILLS; },
    get ADDITIONAL_SKILLS()     { return ADDITIONAL_SKILLS; },
    get ADDITIONAL_CLASSES()    { return ADDITIONAL_CLASSES; },
    get ADDITIONAL_SUBCLASSES() { return ADDITIONAL_SUBCLASSES; },
    ADDITIONAL_ID_OFFSET,
    get OATHS() { return OATHS; },
    loadSkills, loadRadiantSkills, loadAdditionalSkills, loadOaths, getOathData,
    getSkillsByClass, getSkillById, findSkillByName,
    getRadiantSkillsByClass, getRootRadiantSkill,
    findRadiantSkillByName, buildRadiantGraph,
    getAdditionalSkillsByClass, getRootAdditionalSkill,
    findAdditionalSkillByName, buildAdditionalGraph,
    getSubclassSkills, getRootSkill, buildGraph,
    computePointsAtLevel, statToPericia
  };

})();
