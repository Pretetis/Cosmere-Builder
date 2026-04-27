// ============================================================
// Cosmere RPG Skill Tree - PDF Export
// Módulo autônomo: geração da ficha e página visual em PDF
// Depende de: CosData (global), PDFLib (global)
// Callbacks obrigatórios via PdfExport.init()
// ============================================================

const PdfExport = (() => {

  let _getState, _getDerivedStats, _notify;

  // Recebe callbacks do app.js para não depender de state diretamente
  function init({ getState, getDerivedStats, notify }) {
    _getState       = getState;
    _getDerivedStats = getDerivedStats;
    _notify         = notify;
  }

  // ---- DADOS DE COR E ABREVIAÇÃO POR CLASSE ----

  const _PDF_CLASS_COLORS = {
    'Agente':    [0.1, 0.6, 0.3], 'Emissário': [0.8, 0.6, 0.0],
    'Caçador':   [0.8, 0.2, 0.2], 'Líder':     [0.1, 0.4, 0.8],
    'Erudito':   [0.4, 0.3, 0.8], 'Guerreiro': [0.8, 0.4, 0.1],
    'Corredor dos Ventos':       [0.1, 0.5, 0.8],
    'Rompe-Céu':                 [0.8, 0.6, 0.1],
    'Pulverizador':              [0.8, 0.2, 0.2],
    'Dançarino de Precipícios': [0.1, 0.6, 0.4],
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
    'Rompe-Céu':'Rompe céu','Pulverizador':'Pulverizador','Dançarino de Precipícios':'Dançarino',
    'Sentinela da Verdade':'Sentinela','Teceluz':'Teceluz','Alternauta':'Alternauta',
    'Plasmador':'Plasmador','Guardião das Pedras':'Guardião','Cantor':'Cantor',
  };

  const _RADIANT_SVG_MAP = {
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

  // Helper: redimensiona um dataURL de imagem para maxSize × maxSize (JPEG comprimido)
  // Retorna uma Promise<string> com o data URL reduzido
  function _resizePortrait(dataUrl, maxSize = 220, quality = 0.7) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        const ratio  = Math.min(maxSize / img.width, maxSize / img.height, 1);
        const w      = Math.max(1, Math.round(img.width  * ratio));
        const h      = Math.max(1, Math.round(img.height * ratio));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  }

  // Helper: Carrega um SVG, pinta com source-in no Canvas e retorna um PNG (DataURL)
  function _getTintedSvgPng(svgUrl, colorArr) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const size = 512;
        const canvas = document.createElement('canvas');
        canvas.width = size; 
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        
        ctx.drawImage(img, 0, 0, size, size);
        
        if (colorArr) {
          ctx.globalCompositeOperation = 'source-in';
          const r = Math.round(colorArr[0] * 255);
          const g = Math.round(colorArr[1] * 255);
          const b = Math.round(colorArr[2] * 255);
          ctx.fillStyle = `rgb(${r},${g},${b})`;
          ctx.fillRect(0, 0, size, size);
        }
        
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => {
        console.warn("[PDF Export] Falha ao carregar SVG:", svgUrl);
        resolve(null);
      };
      img.src = svgUrl;
    });
  }

  // ---- GRÁFICO RADAR ----

  function _drawRadarPdf(page, cx, cy, R, labels, values, maxVal, cr, font, fontBold, title) {
    const { rgb } = PDFLib;
    const N = labels.length;
    const ang = i => Math.PI / 2 - (2 * Math.PI * i / N);

    const tw = fontBold.widthOfTextAtSize(title, 7);
    page.drawText(title, { x: cx - tw/2, y: cy + R + 15, size: 7,
      font: fontBold, color: rgb(0.15, 0.15, 0.15) });

    const innerR   = R * 0.15;
    const usableR  = R - innerR;
    const getRad   = (val) => innerR + (Math.min(val / maxVal, 1) * usableR);

    const fractions = [0, 0.25, 0.5, 0.75, 1.0];
    fractions.forEach(f => {
      const r    = innerR + (f * usableR);
      const path = Array.from({length: N}, (_, i) =>
        `${i===0?'M':'L'} ${(Math.cos(ang(i))*r).toFixed(1)} ${(-Math.sin(ang(i))*r).toFixed(1)}`
      ).join(' ') + ' Z';
      page.drawSvgPath(path, { x: cx, y: cy, borderColor: rgb(0.85, 0.85, 0.85), borderWidth: 0.5 });
    });

    for (let i = 0; i < N; i++) {
      page.drawLine({
        start: { x: cx + Math.cos(ang(i))*innerR, y: cy + Math.sin(ang(i))*innerR },
        end:   { x: cx + Math.cos(ang(i))*R,      y: cy + Math.sin(ang(i))*R },
        color: rgb(0.85, 0.85, 0.85), thickness: 0.5
      });
    }

    const dpath = Array.from({length: N}, (_, i) => {
      const r = getRad(values[i]);
      return `${i===0?'M':'L'} ${(Math.cos(ang(i))*r).toFixed(1)} ${(-Math.sin(ang(i))*r).toFixed(1)}`;
    }).join(' ') + ' Z';
    page.drawSvgPath(dpath, { x: cx, y: cy,
      color: rgb(cr[0],cr[1],cr[2]), opacity: 0.20,
      borderColor: rgb(cr[0],cr[1],cr[2]), borderWidth: 1.4, borderOpacity: 0.90 });

    for (let i = 0; i < N; i++) {
      const r  = getRad(values[i]);
      const px = cx + Math.cos(ang(i))*r;
      const py = cy + Math.sin(ang(i))*r;
      page.drawEllipse({ x: px, y: py, xScale: 2.3, yScale: 2.3, color: rgb(cr[0],cr[1],cr[2]) });
      const lx = cx + Math.cos(ang(i))*(R + 12);
      const ly = cy + Math.sin(ang(i))*(R + 12);
      const lw = font.widthOfTextAtSize(labels[i], 6.5);
      page.drawText(labels[i], { x: lx - lw/2, y: ly - 3, size: 6.5,
        font, color: rgb(0.2, 0.2, 0.2) });
    }
  }

  // ---- MAPA DE HABILIDADES ----

  function _drawSkillMapPdf(page, cx, cy, mapR, _font, fontBold, state, centerImage) {
    const { rgb } = PDFLib;

    const entries = [];
    CosData.CLASSES.forEach(cls => {
      const g = CosData.buildGraph(cls);
      entries.push({ cls, skills: g.skills, children: g.children, isRadiant: false });
    });
    if (state.profile.radiantClass && CosData.buildRadiantGraph) {
      const g = CosData.buildRadiantGraph(state.profile.radiantClass);
      entries.push({ cls: state.profile.radiantClass, skills: g.skills, children: g.children, isRadiant: true });
    }

    const numE   = entries.length;
    const rootR  = mapR * 0.18;
    const outerR = mapR * 0.88;
    const sectH  = (Math.PI / numE) * 0.80;

    [0.22, 0.54, 0.88].forEach(f => {
      page.drawEllipse({ x: cx, y: cy, xScale: mapR*f, yScale: mapR*f,
        borderColor: rgb(0.9, 0.9, 0.9), borderWidth: 0.6 });
    });

    if (centerImage) {
      const imgSize = mapR * 0.26; 
      page.drawImage(centerImage, {
        x: cx - imgSize / 2,
        y: cy - imgSize / 2,
        width: imgSize,
        height: imgSize,
        opacity: 0.7
      });
    }

    entries.forEach((_, idx) => {
      const a = Math.PI/2 - (2*Math.PI*idx/numE) + (Math.PI/numE);
      page.drawLine({
        start: { x: cx + Math.cos(a)*rootR, y: cy + Math.sin(a)*rootR },
        end:   { x: cx + Math.cos(a)*outerR, y: cy + Math.sin(a)*outerR },
        color: rgb(0.94, 0.94, 0.94), thickness: 0.5 });
    });

    const positions = {};
    entries.forEach(({ cls, skills, isRadiant }, idx) => {
      const angleCenter = Math.PI/2 - (2*Math.PI*idx/numE);
      const root        = skills.find(s => s.rank === 0);
      if (!root) return;

      positions[root.id] = { x: cx + Math.cos(angleCenter)*rootR, y: cy + Math.sin(angleCenter)*rootR };
      const nodeAngles   = { [root.id]: angleCenter };

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

        nodes.forEach((node, i) => {
          let t = 0;
          if (nodes.length > 1) t = (i / (nodes.length - 1)) - 0.5;
          const finalAng    = angleCenter + t * (sectH * 2);
          nodeAngles[node.id] = finalAng;
          let r = rootR + (rank / 5) * (outerR - rootR);
          if (nodes.length > 2) r += (i % 2 === 0) ? 3.5 : -3.5;
          positions[node.id] = {
            x: cx + Math.cos(finalAng) * r,
            y: cy + Math.sin(finalAng) * r
          };
        });
      }
    });

    // Conexões
    entries.forEach(({ cls, skills, isRadiant }) => {
      const findFn = isRadiant ? CosData.findRadiantSkillByName : CosData.findSkillByName;
      const clr    = _PDF_CLASS_COLORS[cls] || [0.4, 0.4, 0.4];
      skills.forEach(skill => {
        const to = positions[skill.id]; if (!to) return;
        skill.deps.forEach(depName => {
          const parent = findFn(depName, cls); if (!parent) return;
          const from   = positions[parent.id]; if (!from) return;
          const active = state.unlockedSkills.has(skill.id) && state.unlockedSkills.has(parent.id);
          page.drawLine({ start: {x: from.x, y: from.y}, end: {x: to.x, y: to.y},
            color: active ? rgb(clr[0],clr[1],clr[2]) : rgb(0.88, 0.88, 0.88),
            thickness: active ? 1.0 : 0.5 });
        });
      });
    });

    // Nós
    entries.forEach(({ cls, skills }) => {
      const clr = _PDF_CLASS_COLORS[cls] || [0.4, 0.4, 0.4];
      skills.forEach(skill => {
        const pos      = positions[skill.id]; if (!pos) return;
        const unlocked = state.unlockedSkills.has(skill.id);
        const nr       = skill.rank === 0 ? 3.2 : 1.6;
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

  // ---- PÁGINA VISUAL (gráficos + mapa) ----

  async function addVisualPage(pdfDoc, state) {
    const { rgb, StandardFonts } = PDFLib;
    const font     = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const W = 595, H = 842;
    const page = pdfDoc.addPage([W, H]);

    page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: rgb(1, 1, 1) });

    const titleTxt = `MAPA — ${state.profile.name || 'Personagem'}  ·  Nível ${state.profile.level}`;
    const tw = fontBold.widthOfTextAtSize(titleTxt, 10);
    page.drawText(titleTxt, { x: W/2 - tw/2, y: H - 21, size: 10,
      font: fontBold, color: rgb(0.83, 0.66, 0.33) });

    const chartCy = H - 115;
    const chartR  = 80;

    const attrLabels = ['FOR','VEL','INT','VON','CON','PRE'];
    const attrVals   = [
      state.attributes.forca,       state.attributes.velocidade,
      state.attributes.intelecto,   state.attributes.vontade,
      state.attributes.consciencia, state.attributes.presenca,
    ];
    _drawRadarPdf(page, 148, chartCy, chartR, attrLabels, attrVals, 10,
      [0.24, 0.61, 0.89], font, fontBold, 'ATRIBUTOS');

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

    // const mapAreaH = H - 210 - 22;
    // const mapCy    = 22 + mapAreaH * 0.48;
    // const mapR     = Math.min(W/2 - 35, mapAreaH/2 - 25);
    // _drawSkillMapPdf(page, W/2, mapCy, mapR, font, fontBold, state);
    const mapAreaH = H - 210 - 22;
    const mapCy    = 22 + mapAreaH * 0.48;
    const mapR     = Math.min(W/2 - 35, mapAreaH/2 - 25);
    
    const radiantClass = state.profile.radiantClass;
    let svgUrl = 'svg/Cosmere_symbol.svg';
    let centerColor = [0.83, 0.66, 0.33]; 

    if (radiantClass && _RADIANT_SVG_MAP[radiantClass]) {
      svgUrl = _RADIANT_SVG_MAP[radiantClass];
      centerColor = _PDF_CLASS_COLORS[radiantClass] || centerColor;
    }

    // Processa a imagem para inserção no PDF-Lib
    let centerImage = null;
    try {
      const pngDataUrl = await _getTintedSvgPng(svgUrl, centerColor);
      if (pngDataUrl) {
        centerImage = await pdfDoc.embedPng(pngDataUrl);
      }
    } catch (e) {
      console.warn("Não foi possível processar o Símbolo Central pro PDF", e);
    }

    // Chama o construtor do mapa passando a centerImage processada
    _drawSkillMapPdf(page, W/2, mapCy, mapR, font, fontBold, state, centerImage);
  }

  // ---- EXPORTAÇÃO PRINCIPAL ----

  async function exportToSheet() {
    console.log('[Sheet] Iniciando exportação...');

    if (typeof PDFLib === 'undefined') {
      console.error('[Sheet] PDFLib não carregado!');
      alert('pdf-lib não carregado. Abra o site via servidor local (start.bat), não direto pelo arquivo.');
      return;
    }
    console.log('[Sheet] PDFLib OK');

    _notify('Gerando ficha...');

    try {
      const state = _getState();
      const stats = _getDerivedStats();
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
          if (fontSize !== null) field.setFontSize(fontSize);
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

      const forBothPages = (baseName, value) => {
        setField(`${baseName}.Page 1`, value);
        setField(`${baseName}.Page 2`, value);
      };
      forBothPages('Character Name', p.name || '');
      forBothPages('Level', String(p.level));
      forBothPages('Ancestry', p.race === 'human' ? 'Humano' : 'Cantor');

      const allExportSkills = [...CosData.SKILLS, ...CosData.RADIANT_SKILLS];

      const unlockedData = [...state.unlockedSkills]
        .map(id => allExportSkills.find(sk => sk.id === id))
        .filter(Boolean);

      const baseClasses = [...new Set(unlockedData.map(s => s.cls))]
        .filter(c => CosData.CLASSES.includes(c));

      let pathsStr = baseClasses.join('; ');
      if (p.radiantClass) pathsStr += (pathsStr ? '; ' : '') + p.radiantClass;
      forBothPages('Paths', pathsStr);

      forBothPages('Strength',  '   '+String(a.forca)      );
      forBothPages('Speed',     '   '+String(a.velocidade) );
      forBothPages('Intellect', '   '+String(a.intelecto)  );
      forBothPages('Willpower', '   '+String(a.vontade)    );
      forBothPages('Awareness', '   '+String(a.consciencia));
      forBothPages('Presence',  '   '+String(a.presenca)   );

      forBothPages('Physical Defense',  String(defenses.physical));
      forBothPages('Cognitive Defense', String(defenses.cognitive));
      forBothPages('Spiritual Defense', String(defenses.spiritual));

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
        const rank      = state.pericias[key] || 0;
        const attrKey   = CosData.PERICIAS[key] ? CosData.PERICIAS[key].attr : null;
        const attrBonus = attrKey ? (state.attributes[attrKey] || 0) : 0;
        setField(fieldName, String(rank + attrBonus));
      }

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
      for (const [key, boxes] of Object.entries(SKILL_RANK_BOXES)) {
        const rank = state.pericias[key] || 0;
        for (let i = 0; i < boxes.length; i++) {
          setCheck(`Rank Box ${boxes[i]}`, i < rank);
        }
      }

      if (p.radiantClass) {
        const activeSurges = CosData.RADIANT_CLASS_PERICIAS[p.radiantClass] || [];
        const slots = [
          { scoreField: 'Physical Custom',  nameField: 'Custom Skill 1', abbrField: 'Custom Score 1', boxes: [37, 40, 36, 39, 38] },
          { scoreField: 'Cognitive Custom', nameField: 'Custom Skill 2', abbrField: 'Custom Score 2', boxes: [72, 75, 71, 74, 73] },
          { scoreField: 'Spiritual Custom', nameField: 'Custom Skill 3', abbrField: 'Custom Score 3', boxes: [107, 110, 106, 109, 108] }
        ];
        let currentSlotIndex = 0;
        activeSurges.forEach(surgeKey => {
          const info = CosData.PERICIAS_RADIANTES[surgeKey];
          if (!info || currentSlotIndex >= slots.length) return;
          const rank       = state.radiantPericias[surgeKey] || 0;
          const attrVal    = a[info.attr] || 0;
          const attrInfo   = CosData.ATTRIBUTES[info.attr];
          const attrAbbr   = attrInfo ? attrInfo.abbr : '';
          const targetSlot = slots[currentSlotIndex];
          setField(targetSlot.abbrField, attrAbbr, 5);
          setField(targetSlot.nameField, info.name);
          setField(targetSlot.scoreField, String(rank + attrVal));
          for (let i = 0; i < targetSlot.boxes.length; i++) {
            setCheck(`Rank Box ${targetSlot.boxes[i]}`, i < rank);
          }
          currentSlotIndex++;
        });
      }

      // ---- TALENTOS — agrupados por classe, sem duplicatas ----
      const allTalentPools = [
        ...CosData.SKILLS,
        ...(CosData.RADIANT_SKILLS || []),
        ...(CosData.ADDITIONAL_SKILLS || []),
      ];
      const talentById = new Map(allTalentPools.map(s => [s.id, s]));

      // Separa compras diretas (exclui auto-desbloqueadas compartilhadas e Cantor grátis)
      // const directTalents = [];
      // const seenTalentNames = new Map(); // name → winning skill (classe com mais compras diretas)
      // const talentClassCount = {};
      // for (const id of state.unlockedSkills) {
      //   if (state.freeUnlockedSkills.has(id) || state.singerFreeIds.has(id)) continue;
      //   const s = talentById.get(id);
      //   if (s) {
      //     talentClassCount[s.cls] = (talentClassCount[s.cls] || 0) + 1;
      //     directTalents.push(s);
      //   }
      // }
      // // Dedup por nome — mantém a classe com mais compras diretas
      // const talentGrouped = {};
      // for (const skill of directTalents) {
      //   const prev = seenTalentNames.get(skill.name);
      //   if (prev) {
      //     if ((talentClassCount[skill.cls] || 0) > (talentClassCount[prev.cls] || 0)) {
      //       const old = talentGrouped[prev.cls];
      //       if (old) { const i = old.findIndex(s => s.name === skill.name); if (i >= 0) old.splice(i, 1); if (!old.length) delete talentGrouped[prev.cls]; }
      //       seenTalentNames.set(skill.name, skill);
      //       (talentGrouped[skill.cls] = talentGrouped[skill.cls] || []).push(skill);
      //     }
      //   } else {
      //     seenTalentNames.set(skill.name, skill);
      //     (talentGrouped[skill.cls] = talentGrouped[skill.cls] || []).push(skill);
      //   }
      // }
      const candidateTalents = [];
      const talentClassCount = {};
      for (const id of state.unlockedSkills) {
        if (state.singerFreeIds.has(id)) continue;
        const s = talentById.get(id);
        if (s) {
          candidateTalents.push(s);
          if (!state.freeUnlockedSkills.has(id)) {
             talentClassCount[s.cls] = (talentClassCount[s.cls] || 0) + 1;
          }
        }
      }

      const seenTalentNames = new Map();
      const talentGrouped = {};
      const radiantCls = state.profile.radiantClass;
      const ancestryCls = state.profile.ancestryClass;

      for (const skill of candidateTalents) {
        const prev = seenTalentNames.get(skill.name);
        if (prev) {
            let replace = false;
            
            // Força a prioridade para o Radiante selecionado
            if (skill.cls === radiantCls && prev.cls !== radiantCls) replace = true;
            else if (skill.cls === ancestryCls && prev.cls !== ancestryCls && prev.cls !== radiantCls) replace = true;
            else if (prev.cls !== radiantCls && prev.cls !== ancestryCls) {
              const prevIsFree = state.freeUnlockedSkills.has(prev.id);
              const skillIsFree = state.freeUnlockedSkills.has(skill.id);
              if (prevIsFree && !skillIsFree) replace = true;
              else if (prevIsFree === skillIsFree) {
                 if ((talentClassCount[skill.cls] || 0) > (talentClassCount[prev.cls] || 0)) replace = true;
              }
            }

            if (replace) {
                const old = talentGrouped[prev.cls];
                if (old) { const i = old.findIndex(s => s.name === skill.name); if (i >= 0) old.splice(i, 1); if (!old.length) delete talentGrouped[prev.cls]; }
                seenTalentNames.set(skill.name, skill);
                (talentGrouped[skill.cls] = talentGrouped[skill.cls] || []).push(skill);
            }
        } else {
          seenTalentNames.set(skill.name, skill);
          (talentGrouped[skill.cls] = talentGrouped[skill.cls] || []).push(skill);
        }
      }
      
      // Ordem das classes: mundanas → radiantes → adicionais
      const allClassOrder = [...(CosData.CLASSES || []), ...(CosData.RADIANT_CLASSES || [])];
      const talentClasses = Object.keys(talentGrouped).sort((a, b) => {
        const ia = allClassOrder.indexOf(a), ib = allClassOrder.indexOf(b);
        if (ia >= 0 && ib >= 0) return ia - ib;
        if (ia >= 0) return -1; if (ib >= 0) return 1;
        return a.localeCompare(b);
      });
      // Monta blocos de texto por classe
      const talentLines = [];
      for (const cls of talentClasses) {
        const skills = talentGrouped[cls];
        if (!skills || !skills.length) continue;
        talentLines.push(`${cls}:`);
        for (const s of skills.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name))) {
          talentLines.push(`  R${s.rank} ${s.name}`);
        }
      }
      // Distribui até 22 linhas por coluna entre Talents 1, 2 e 3
      const LINES_PER_COL = 22;
      setField('Talents 1', talentLines.slice(0, LINES_PER_COL).join('\n'));
      setField('Talents 2', talentLines.slice(LINES_PER_COL, LINES_PER_COL * 2).join('\n'));
      setField('Talents 3', talentLines.slice(LINES_PER_COL * 2, LINES_PER_COL * 3).join('\n'));

      setField('Health Maximum',    '    '+String(stats.maxHealth));
      setField('Focus Maximum',     '    '+String(stats.maxFocus));
      setField('Investiture Maximum 4', '    '+String(stats.maxInvestiture > 0 ? stats.maxInvestiture : 0));
      setField('Recovery Die',      '        '+stats.recDie);
      setField('Senses Range',      '        '+stats.senses, 14);
      setField('Movement',          '   '+stats.movement, 14);
      setField('Lifting Capacity',  '   '+stats.lifting, 14);

      // ---- RETRATO DO PERSONAGEM ----
      if (p.portrait) {
        try {
          // 1) Armazena versão comprimida nos metadados do PDF para roundtrip no import
          //    (NÃO escreve no campo de texto para não poluir a ficha visualmente)
          const smallPortrait = await _resizePortrait(p.portrait, 220, 0.7);
          if (smallPortrait) {
            // Usa o campo Creator como transporte — prefixo distingue do valor original
            pdfDoc.setCreator('cosmere-rpg|portrait:' + smallPortrait);
          }

          // 2) Desenha a imagem em tamanho original sobre a área do campo Character Appearance
          const appearanceField = form.getTextField('Character Appearance');
          const widgets = appearanceField.acroField.getWidgets();
          if (widgets.length > 0) {
            const rect     = widgets[0].getRectangle();
            const isJpeg   = p.portrait.startsWith('data:image/jpeg') ||
                             p.portrait.startsWith('data:image/jpg');
            const b64      = p.portrait.split(',')[1];
            const binStr   = atob(b64);
            const imgBytes = new Uint8Array(binStr.length);
            for (let i = 0; i < binStr.length; i++) imgBytes[i] = binStr.charCodeAt(i);
            const embeddedImg = isJpeg
              ? await pdfDoc.embedJpg(imgBytes)
              : await pdfDoc.embedPng(imgBytes);

            const imgDims = embeddedImg.scaleToFit(rect.width, rect.height);
            const offsetX = (rect.width  - imgDims.width)  / 2;
            const offsetY = (rect.height - imgDims.height) / 2;

            const pageIndex = (() => {
              try {
                const pRef = widgets[0].P();
                if (pRef) return pdfDoc.getPages().findIndex(pg => pg.ref === pRef);
              } catch (_) {}
              return 0;
            })();
            pdfDoc.getPage(Math.max(0, pageIndex)).drawImage(embeddedImg, {
              x:      rect.x + offsetX,
              y:      rect.y + offsetY,
              width:  imgDims.width,
              height: imgDims.height,
            });
          }
        } catch (portraitErr) {
          console.warn('[Sheet] Não foi possível inserir o retrato:', portraitErr);
        }
      }

      await addVisualPage(pdfDoc, state);

      console.log('[Sheet] Salvando PDF...');
      const filledBytes = await pdfDoc.save();
      console.log('[Sheet] PDF gerado:', filledBytes.byteLength, 'bytes');
      const blob = new Blob([filledBytes], { type: 'application/pdf' });
      const url  = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href     = url;
      link.download = `ficha_${p.name || 'personagem'}.pdf`;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      console.log('[Sheet] Download iniciado!');
      _notify('Ficha exportada!');

    } catch(err) {
      console.error('[Sheet] ERRO:', err);
      alert('Erro ao gerar ficha: ' + err.message);
      _notify('Erro ao gerar ficha: ' + err.message);
    }
  }

  return { init, exportToSheet };

})();
