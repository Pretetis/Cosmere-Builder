// ============================================================
// Cosmere RPG — Extrator de Descrições do Livro (PDF)
// Carrega PDF.js dinamicamente, extrai texto e mapeia nomes
// de habilidades para seus trechos de descrição.
// As descrições ficam em localStorage — o PDF nunca sai do
// navegador do usuário e nunca é enviado ao servidor.
// ============================================================

var PdfExtractor = (function () {
  'use strict';

  const STORAGE_KEY  = 'cosmere_book_descriptions';
  const PDFJS_VER    = '3.11.174';
  const PDFJS_BASE   = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VER}/build/`;
  const MAX_DESC_LEN = 1800; // caracteres capturados após cada nome de habilidade

  // ------------------------------------------------------------------
  // Normalização de uma string curta (nomes de habilidades) para busca
  // ------------------------------------------------------------------
  function norm(s) {
    return s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // ------------------------------------------------------------------
  // Constrói índice de texto: retorna normText e rawPos[i] → índice no
  // rawText original correspondente à posição i em normText.
  // Permite buscar no texto normalizado e extrair do texto original.
  // ------------------------------------------------------------------
  function buildTextIndex(rawText) {
    const normChars = [];
    const rawPos    = []; // rawPos[i] = índice em rawText para normChars[i]

    for (let ri = 0; ri < rawText.length; ri++) {
      const ch    = rawText[ri];
      const chars = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');

      for (const c of chars) {
        if (/\w/.test(c)) {
          normChars.push(c.toLowerCase());
          rawPos.push(ri);
        } else if (normChars[normChars.length - 1] !== ' ') {
          normChars.push(' ');
          rawPos.push(ri);
        }
      }
    }

    return { normText: normChars.join(''), rawPos };
  }

  // ------------------------------------------------------------------
  // Carregamento lazy de PDF.js via CDN
  // ------------------------------------------------------------------
  function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = PDFJS_BASE + 'pdf.min.js';
      script.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_BASE + 'pdf.worker.min.js';
        resolve();
      };
      script.onerror = () => reject(new Error('Falha ao carregar PDF.js da CDN'));
      document.head.appendChild(script);
    });
  }

  // ------------------------------------------------------------------
  // Extrai todo o texto do PDF, página por página
  // ------------------------------------------------------------------
  async function extractFullText(file, onProgress) {
    const buffer = await file.arrayBuffer();
    const pdf    = await pdfjsLib.getDocument({ data: buffer }).promise;
    const total  = pdf.numPages;
    let   text   = '';

    for (let p = 1; p <= total; p++) {
      if (onProgress) onProgress(`Lendo página ${p} de ${total}…`);
      const page    = await pdf.getPage(p);
      const content = await page.getTextContent();
      let   pageStr = '';
      for (const item of content.items) {
        pageStr += item.str;
        pageStr += item.hasEOL ? '\n' : ' ';
      }
      text += pageStr + '\n';
    }
    return text;
  }

  // ------------------------------------------------------------------
  // Extrai o tipo de ativação a partir do texto completo.
  // Símbolos do PDF: ▶ (1 ação), ▷ (ação livre), 2, 3, ∞, ★
  // ------------------------------------------------------------------
  function extractActivation(flat) {
    const m = flat.match(/ativa[cç][aã]o\s*:\s*([★∞▶▷\d]+)/i);
    if (!m) return null;
    const sym = m[1].trim();
    if (sym === '∞')                return 'passive';
    if (sym === '★')                return 'special';
    if (sym === '▶')                return 'action1';
    if (sym === '▷')                return 'free';
    if (sym === '2')                return 'action2';
    if (sym === '3')                return 'action3';
    return null;
  }

  // Regex que casa a linha de ativação inteira (para remover do corpo)
  const ACT_LINE_RE = /ativa[cç][aã]o\s*:\s*[★∞▶▷\d \t]*/gi;

  // ------------------------------------------------------------------
  // Para cada nome de habilidade, encontra a primeira ocorrência no
  // texto normalizado e captura o trecho seguinte como "descrição"
  // ------------------------------------------------------------------
  // Padrões que indicam entrada de tabela de classe, não descrição real
  const TABLE_PREFIXES = [
    'da especializa', 'na especializa', 'do conjunto', 'de especializacao',
    'na especializacao', 'conjunto inicial', 'por fim ', 'escolha o conjunto', 'por fim,',
  ];

  function looksLikeTableEntry(text) {
    // Remove pontuação/espaços iniciais antes de checar (ex: ". Por fim,")
    const t = text.replace(/^[\s.,;:]+/, '')
      .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    return TABLE_PREFIXES.some(p => t.startsWith(p));
  }

  // Janelas mecânicas têm "Ativação:" próximo ao início.
  // Janelas narrativas (exemplos de roleplay) têm "MJ:" ou "Jogador:".
  function descScore(text) {
    const head = text.substring(0, 120);
    if (/mj\s*:/i.test(head) || /jogador\s*:/i.test(head)) return -1;
    if (/ativa[cç][aã]o\s*:/i.test(head)) return 2;
    return 1;
  }

  // Retorna true se a ocorrência do nome está dentro de uma lista de pré-requisitos
  // de outra habilidade (ex: "Pré-requisitos: Oportunista; Agilidade 2+")
  // win=45  → filtra ocorrências do próprio nome (janela curta = não captura bloco anterior)
  // win=80  → filtra fronteiras de janela (janela larga = captura prereqs com listas longas)
  function isInPrereqContext(normText, matchStart, win = 45) {
    const trail = Math.floor(win * 0.75);
    const before = normText.substring(Math.max(0, matchStart - win), matchStart);
    return new RegExp(`pre\\s*requisito[^.]{0,${trail}}$`).test(before) ||
           new RegExp(`\\brequer\\s*:[^.]{0,${trail}}$`).test(before);
  }

  // ------------------------------------------------------------------
  // Gera resumo curto a partir do texto completo:
  // ignora linhas de metadado (Ativação, Pré-requisitos, símbolos),
  // pega a primeira frase completa com ao menos 30 chars.
  // ------------------------------------------------------------------
  // Remove artefatos de hifenização do PDF: "Sobrevi- vência" → "Sobrevivência"
  function fixHyphens(s) {
    // À-ɏ cobre todos os caracteres latinos acentuados (inclui ç, ã, é…)
    return s.replace(/([\wÀ-ɏ])-\s+([\wÀ-ɏ])/g, '$1$2');
  }

  function makeSummary(fullText) {
    // Estratégia 1: o texto descritivo real sempre vem após "Ativação: [símbolo]"
    // no formato do Cosmere RPG. Usa isso como âncora quando disponível.
    const flat = fixHyphens(fullText.replace(/\n/g, ' ').replace(/\s+/g, ' '));
    const actIdx = flat.search(/ativa[cç][aã]o\s*:/i);
    if (actIdx !== -1) {
      // Avança após "Ativação: ★" — símbolo pode ser ★ ∞ ▶ ou dígito (ex: "3")
      const afterAct = flat.substring(actIdx)
        .replace(/^ativa[cç][aã]o\s*:\s*[★∞▶▷◆●\d \t]*/i, '').trim();
      const first = afterAct.match(/^(.{20,160}[.!?])/);
      if (first) return first[1].trim();
      const cut = afterAct.substring(0, 140).trim();
      return afterAct.length > 140 ? cut + '…' : cut;
    }

    // Estratégia 2: fallback para habilidades passivas (sem "Ativação:")
    // Junta todas as linhas não-metadado e procura a primeira frase completa
    // com início em maiúscula — preserva continuações de hifenização.
    const cleaned = fullText
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 2)
      .filter(l => !/^(pré.?req|pre.?req|★|∞|▶|tipo:|custo:|ícone|legenda|\()/i.test(l))
      .join(' ')
      .replace(/\s+/g, ' ');

    const first = cleaned.match(/([A-ZÁÉÍÓÚ][^.!?]{20,160}[.!?])/);
    if (first) return first[1].trim();
    const cut = cleaned.substring(0, 140).trim();
    return cleaned.length > 140 ? cut + '…' : cut;
  }

  // Remove ruídos do início do body que o modal já mostra em seções próprias:
  // — "(talento-chave de X)" — tag de metadado do livro
  // — "Pré-requisitos: ..."  — mostrado na seção Requisitos do modal
  // — Pontinhos "★" ou numeração soltos
  // Palavras que tipicamente iniciam a frase de descrição de habilidades no Cosmere RPG
  const DESC_STARTERS = 'Você|Gaste|Quando|Uma vez|Após|Ao\\b|Pode\\b|Redistribua|Escolha|Sempre|Cada\\b|Durante|Esta\\b|Este\\b|Enquanto|Ganha\\b|Seu\\b|Sua\\b|Como\\b|Ao\\s|Se você';

  function cleanBody(text) {
    return text
      // Remove qualquer tag (ClassName) no início — ex: "(Plasmador)", "(talento-chave de X)"
      .replace(/^\([^)]{1,60}\)\s*/i, '')
      // Remove "Pré-requisitos: [conteúdo]" consumindo até o início da frase real.
      // Requer "Pré-requisitos:" com dois-pontos para não afetar o uso natural da palavra.
      .replace(
        new RegExp(`Pré-?requisitos\\s*:(?:(?!${DESC_STARTERS}).){0,250}`, 'gi'),
        ''
      )
      // Remove símbolos de ativação soltos no início
      .replace(/^[★∞▶▷\d\s]+/, '')
      .trim();
  }

  function buildDescriptions(rawText, skillNames) {
    const { normText, rawPos } = buildTextIndex(rawText);
    const results = {};

    const sorted    = [...new Set(skillNames)].sort((a, b) => b.length - a.length);
    const normNames = sorted.map(n => norm(n));

    // Coleta todos os hits de todos os nomes (pode haver múltiplas ocorrências)
    const allHits = [];
    for (let i = 0; i < sorted.length; i++) {
      const nn  = normNames[i];
      let   pos = normText.indexOf(nn);
      while (pos !== -1) {
        allHits.push({ name: sorted[i], start: pos, nameEnd: pos + nn.length });
        pos = normText.indexOf(nn, pos + 1);
      }
    }
    allHits.sort((a, b) => a.start - b.start);

    // Agrupa hits por nome
    const byName = {};
    for (const hit of allHits) {
      (byName[hit.name] = byName[hit.name] || []).push(hit);
    }

    // Para cada skill, escolhe a ocorrência com melhor score (depois maior janela)
    for (const [name, hits] of Object.entries(byName)) {
      let bestFull  = '';
      let bestScore = -Infinity;
      for (const { start, nameEnd } of hits) {
        // Descarta ocorrências dentro de listas de pré-requisitos de outra skill
        if (isInPrereqContext(normText, start)) continue;

        // Ignora hits em contexto de pré-requisito como fronteira de janela (win=80)
        const nextIdx    = allHits.findIndex(h => h.start > nameEnd && !isInPrereqContext(normText, h.start, 80));
        const nextNorm   = nextIdx !== -1 ? allHits[nextIdx].start : Infinity;
        const rawStart   = nameEnd < rawPos.length ? rawPos[nameEnd] : rawText.length;
        const rawNextHit = nextNorm < rawPos.length ? rawPos[nextNorm] : rawText.length;
        const rawEnd     = Math.min(rawNextHit, rawStart + MAX_DESC_LEN);
        const full       = rawText.substring(rawStart, rawEnd).trim();

        if (full.length < 20 || looksLikeTableEntry(full)) continue;
        const score = descScore(full);
        if (score < 0) continue; // descarta narrativa
        if (score > bestScore || (score === bestScore && full.length > bestFull.length)) {
          bestFull  = full;
          bestScore = score;
        }
      }
      if (bestFull) {
        const cleanFull   = fixHyphens(bestFull);
        const flatFull    = cleanFull.replace(/\n/g, ' ').replace(/\s+/g, ' ');
        const activation  = extractActivation(flatFull);
        const description = cleanBody(flatFull.replace(ACT_LINE_RE, '').trim());
        results[name] = {
          description,
          desc: makeSummary(cleanFull),
          activation,
        };
      }
    }

    return results;
  }

  // ------------------------------------------------------------------
  // Coleta todos os nomes de habilidades carregados no CosData
  // ------------------------------------------------------------------
  function getAllSkillNames() {
    const names = new Set();
    (CosData.SKILLS           || []).forEach(s => names.add(s.name));
    (CosData.RADIANT_SKILLS   || []).forEach(s => names.add(s.name));
    (CosData.ADDITIONAL_SKILLS|| []).forEach(s => names.add(s.name));
    return [...names];
  }

  // ------------------------------------------------------------------
  // Aplica descrições diretamente nos objetos skill do CosData
  // ------------------------------------------------------------------
  function applyToSkills(descriptions) {
    const pools = [
      ...(CosData.SKILLS           || []),
      ...(CosData.RADIANT_SKILLS   || []),
      ...(CosData.ADDITIONAL_SKILLS|| []),
    ];
    let applied = 0;
    for (const skill of pools) {
      const entry = descriptions[skill.name];
      if (!entry) continue;
      // Suporta formato novo { desc, description } e formato legado (string)
      if (typeof entry === 'string') {
        skill.description = entry;
        skill.desc        = makeSummary(entry);
      } else {
        skill.description = entry.description;
        skill.desc        = entry.desc;
        if (entry.activation) skill.activation = entry.activation;
      }
      applied++;
    }
    return applied;
  }

  // ------------------------------------------------------------------
  // API pública
  // ------------------------------------------------------------------

  /**
   * Lê descrições salvas no localStorage e aplica às skills.
   * Chamar logo após CosData.load*() no init do app.
   * @returns {number} quantidade de habilidades com descrição aplicada
   */
  function loadAndApply() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return 0;
      return applyToSkills(JSON.parse(raw));
    } catch (_) {
      return 0;
    }
  }

  /**
   * Processa um arquivo PDF, extrai descrições e persiste no localStorage.
   * @param {File} file - arquivo PDF selecionado pelo usuário
   * @param {function} onProgress - callback(mensagem: string)
   * @returns {{ found: number, total: number }}
   */
  async function processFile(file, onProgress) {
    if (onProgress) onProgress('Carregando PDF.js…');
    await loadPdfJs();

    const text  = await extractFullText(file, onProgress);

    if (onProgress) onProgress('Buscando descrições das habilidades…');
    const names        = getAllSkillNames();
    const descriptions = buildDescriptions(text, names);

    localStorage.setItem(STORAGE_KEY, JSON.stringify(descriptions));
    const found = applyToSkills(descriptions);

    return { found, total: names.length };
  }

  /**
   * Remove descrições do localStorage e dos objetos skill.
   */
  function clearDescriptions() {
    localStorage.removeItem(STORAGE_KEY);
    const pools = [
      ...(CosData.SKILLS           || []),
      ...(CosData.RADIANT_SKILLS   || []),
      ...(CosData.ADDITIONAL_SKILLS|| []),
    ];
    for (const skill of pools) delete skill.description;
  }

  /** @returns {boolean} */
  function hasStoredDescriptions() {
    return !!localStorage.getItem(STORAGE_KEY);
  }

  return { loadAndApply, processFile, clearDescriptions, hasStoredDescriptions };
})();
