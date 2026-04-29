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
  // Reordena os items de uma página assumindo layout em até 2 colunas.
  // O livro do Cosmere RPG usa diagramação em 2 colunas, e o pdfjs
  // entrega items na ordem do content stream (frequentemente col-dir
  // antes de col-esq), o que faz blocos vizinhos se sobreporem ao
  // concatenar — uma habilidade absorve a descrição da seguinte.
  // ------------------------------------------------------------------
  function pageItemsToText(items, pageWidth) {
    const mid = pageWidth / 2;
    const cols = [[], []];
    for (const it of items) {
      if (!it.str) continue;
      const x = it.transform[4];
      cols[x < mid ? 0 : 1].push(it);
    }

    // Página de uma coluna só (ex: capas, índice): processa linear.
    const min = Math.min(cols[0].length, cols[1].length);
    const tot = cols[0].length + cols[1].length;
    if (tot < 20 || min / tot < 0.1) {
      return joinByYThenX(items);
    }
    return joinByYThenX(cols[0]) + '\n' + joinByYThenX(cols[1]);
  }

  function joinByYThenX(items) {
    const sorted = items.slice().sort((a, b) => {
      const dy = b.transform[5] - a.transform[5]; // top → bottom
      if (Math.abs(dy) > 2) return dy;
      return a.transform[4] - b.transform[4];     // left → right
    });
    let out = '', lastY = null;
    for (const it of sorted) {
      if (!it.str) continue;
      const y = it.transform[5];
      if (lastY !== null && Math.abs(lastY - y) > 2) out += '\n';
      else if (out.length && !/\s$/.test(out))      out += ' ';
      out += it.str;
      lastY = y;
    }
    return out;
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
      const page     = await pdf.getPage(p);
      const viewport = page.getViewport({ scale: 1 });
      const content  = await page.getTextContent();
      text += pageItemsToText(content.items, viewport.width) + '\n';
    }
    return text;
  }

  // ------------------------------------------------------------------
  // Extrai o tipo de ativação a partir do texto completo.
  // Símbolos do PDF: ▶ (1 ação), ▷ (ação livre), 2, 3, ∞, ★
  // ------------------------------------------------------------------
  function extractActivation(flat) {
    const m = flat.match(/ativa[cç][aã]o\s*:\s*([★∞▶▷↻\d]+)/i);
    if (!m) return null;
    const sym = m[1].trim();
    if (sym === '∞')                return 'passive';
    if (sym === '★')                return 'special';
    if (sym === '▶')                return 'action1';
    if (sym === '▷')                return 'free';
    if (sym === '↻')                return 'reaction';
    if (sym === '2')                return 'action2';
    if (sym === '3')                return 'action3';
    return null;
  }

  // Regex que casa a linha de ativação inteira (para remover do corpo)
  const ACT_LINE_RE = /ativa[cç][aã]o\s*:\s*[★∞▶▷↻\d \t]*/gi;

  // Padrões que marcam fim de uma entrada de habilidade no livro do Cosmere RPG.
  // Usa [\s\S] em vez de [^\n] para tolerar quebras de página/coluna entre o
  // cabeçalho "Especialização X" e o subtítulo "Os talentos a seguir".
  // O pattern "* Nome (talento-chave de X)" identifica páginas de overview
  // de árvore com cards em grade — layout diferente das descrições, não pode
  // ser absorvido pelo bloco anterior.
  const STOP_PATTERNS = [
    /Licenciado para\b/i,
    /Cap[ií]tulo\s+\d+\s*[:–]/i,
    /Especializa[cç][aã]o\s+\w[\s\S]{0,80}Os talentos a seguir/i,
    /Os talentos a seguir[\s\S]{0,80}aparecem na (especializa[cç][aã]o|[aá]rvore)/i,
    /\*\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇa-záéíóúâêôãõç][^\n]{0,60}\(talento-chave\b/i,
  ];

  // Trunca `text` na primeira ocorrência de qualquer padrão de parada
  function truncateAtStop(text) {
    let cut = text.length;
    for (const re of STOP_PATTERNS) {
      const m = re.exec(text);
      if (m && m.index < cut) cut = m.index;
    }
    return text.substring(0, cut).trimEnd();
  }

  // Remove rodapés/cabeçalhos de página que aparecem no MEIO do bloco de
  // descrição, entre "Ativação:" e o texto real. Sem isso, truncateAtStop
  // cortaria no primeiro "Capítulo X:" (rodapé) e devolveria descrição vazia.
  function stripPageArtifacts(text) {
    return text
      .replace(/\d{1,3}\s+Cap[ií]tulo\s+\d+\s*[:–][^\n]*\n?/g, ' ')
      .replace(/Cap[ií]tulo\s+\d+\s*[:–][^\n]{0,80}\s+\d{1,3}\s*\n?/g, ' ')
      .replace(/Licenciado para[^\n]*\n?/g, ' ')
      .replace(/\s{2,}/g, ' ');
  }

  // Retorna a posição raw (dentro de [windowStart, windowEnd)) onde o próximo
  // nome de habilidade diferente de foundName aparece como cabeçalho de bloco
  // (precedido por quebra de linha ou fim de frase). Retorna windowEnd se não encontrar.
  function clipAtNextSkillName(rawText, windowStart, windowEnd, foundName, sortedNames) {
    const window = rawText.substring(windowStart, windowEnd);
    const { normText, rawPos } = buildTextIndex(window);
    let cut = window.length;

    for (const name of sortedNames) {
      if (name === foundName) continue;
      const nn = norm(name);
      if (nn.length < 4) continue;

      let pos = normText.indexOf(nn);
      while (pos !== -1) {
        if (!isInPrereqContext(normText, pos, 80)) {
          // Verifica fronteira de palavra no texto normalizado
          const nb = pos > 0 ? normText[pos - 1] : ' ';
          const na = (pos + nn.length) < normText.length ? normText[pos + nn.length] : ' ';
          if (!/[a-z0-9]/.test(nb) && !/[a-z0-9]/.test(na)) {
            const rIdx = pos < rawPos.length ? rawPos[pos] : window.length;
            if (rIdx < cut) {
              // Só corta se o nome aparece como cabeçalho: após \n (com rank ou
              // símbolo de ativação opcional) ou fim de frase. Páginas overview
              // têm formato "★ Nome", "↻ Nome", "∞ Nome", "*  Nome", etc.
              const rawCtx = window.substring(Math.max(0, rIdx - 20), rIdx);
              if (/[\n\r]\s*(?:R\d+\s+|[★∞▶▷↻*\d]\s+)?$/.test(rawCtx) || /[.!?]\s+$/.test(rawCtx)) {
                cut = rIdx;
              }
            }
          }
        }
        pos = normText.indexOf(nn, pos + 1);
      }
    }

    return windowStart + cut;
  }

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
        .replace(/^ativa[cç][aã]o\s*:\s*[★∞▶▷↻◆●\d \t]*/i, '').trim();
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
      .replace(/^[★∞▶▷↻\d\s]+/, '')
      .trim();
  }

  // ------------------------------------------------------------------
  // Abordagem primária: âncora em "Ativação: [símbolo]"
  // Toda habilidade do Cosmere RPG tem exatamente um "Ativação:" em seu bloco.
  // Usamos isso como delimitador confiável: a descrição vai de após o símbolo
  // até o próximo "Ativação:" — eliminando o problema de boundary por nomes.
  // ------------------------------------------------------------------
  function buildDescriptions(rawText, skillNames) {
    const results   = {};
    const sortedNames = [...new Set(skillNames)].sort((a, b) => b.length - a.length);

    // ── Pass 1: Activation-anchored ────────────────────────────────────────
    const ACT_RE = /ativa[cç][aã]o\s*:\s*[★∞▶▷↻\d]+/gi;
    const acts   = [];
    let m;
    while ((m = ACT_RE.exec(rawText)) !== null) {
      acts.push({ blockStart: m.index, descStart: m.index + m[0].length });
    }

    for (let i = 0; i < acts.length; i++) {
      const { blockStart, descStart } = acts[i];
      const nextBlockStart = i + 1 < acts.length ? acts[i + 1].blockStart : rawText.length;

      // Olha para trás até 600 chars para encontrar o cabeçalho da habilidade.
      // Estrutura esperada: ... [fim da desc anterior] NOME \n Pré-requisitos: ... \n Ativação:
      const LOOKBACK = 600;
      const lookbackRaw = rawText.substring(Math.max(0, blockStart - LOOKBACK), blockStart);

      // Isola a área do cabeçalho: texto ANTES do último "Pré-requisitos:"
      const PREREQ_RE = /pré.?requisitos\s*:/gi;
      let lastPrereqIdx = -1, pm;
      while ((pm = PREREQ_RE.exec(lookbackRaw)) !== null) lastPrereqIdx = pm.index;
      const headingArea   = lastPrereqIdx > 0 ? lookbackRaw.substring(0, lastPrereqIdx) : lookbackRaw;
      const normHeading   = norm(headingArea);

      // Encontra o último nome de habilidade na área de cabeçalho
      // (mais próximo do "Pré-requisitos:", ou seja, o nome do bloco atual).
      // Exige fronteira de palavra para evitar que "Às Sombras" (substring)
      // sobrescreva "Passo nas Sombras" como nome encontrado.
      let foundName = null;
      let foundPos  = -1;
      for (const name of sortedNames) {
        const nn = norm(name);
        if (nn.length < 3) continue;
        let pos = normHeading.indexOf(nn);
        while (pos !== -1) {
          const nb = pos > 0 ? normHeading[pos - 1] : ' ';
          const na = (pos + nn.length) < normHeading.length ? normHeading[pos + nn.length] : ' ';
          const wordBoundary = !/[a-z0-9]/.test(nb) && !/[a-z0-9]/.test(na);
          if (wordBoundary && !isInPrereqContext(normHeading, pos) && pos > foundPos) {
            foundPos  = pos;
            foundName = name;
          }
          pos = normHeading.indexOf(nn, pos + 1);
        }
      }
      if (!foundName) continue;

      // Extrai e limpa a descrição (cortando no próximo nome de habilidade encontrado como cabeçalho)
      const rawWindowEnd = Math.min(nextBlockStart, descStart + MAX_DESC_LEN);
      const descRaw = rawText.substring(descStart, clipAtNextSkillName(rawText, descStart, rawWindowEnd, foundName, sortedNames));
      const full    = truncateAtStop(stripPageArtifacts(descRaw).trim());
      if (full.length < 15 || looksLikeTableEntry(full)) continue;

      const score = descScore(full);
      if (score < 0) continue;

      const cleanFull   = fixHyphens(full);
      const flatFull    = cleanFull.replace(/\n/g, ' ').replace(/\s+/g, ' ');
      const activation  = extractActivation(rawText.substring(blockStart, descStart));
      const description = cleanBody(flatFull.replace(ACT_LINE_RE, '').trim());
      const desc        = makeSummary(cleanFull);

      const existing = results[foundName];
      if (!existing || score > (existing._score || 0) ||
          (score === (existing._score || 0) && description.length > (existing.description || '').length)) {
        results[foundName] = { description, desc, activation, _score: score };
      }
    }

    // ── Pass 2: Fallback por nome para habilidades sem "Ativação:" ─────────
    const missing = sortedNames.filter(n => !results[n]);
    if (missing.length > 0) {
      const fb = _buildDescriptionsByName(rawText, missing);
      for (const [name, val] of Object.entries(fb)) results[name] = val;
    }

    // Remove campo interno de scoring
    for (const v of Object.values(results)) delete v._score;
    return results;
  }

  // Abordagem legada por nome — usada como fallback para skills sem "Ativação:"
  function _buildDescriptionsByName(rawText, skillNames) {
    const { normText, rawPos } = buildTextIndex(rawText);
    const results = {};
    const sorted    = [...new Set(skillNames)].sort((a, b) => b.length - a.length);
    const normNames = sorted.map(n => norm(n));

    const allHits = [];
    for (let i = 0; i < sorted.length; i++) {
      const nn = normNames[i];
      let pos  = normText.indexOf(nn);
      while (pos !== -1) {
        allHits.push({ name: sorted[i], start: pos, nameEnd: pos + nn.length });
        pos = normText.indexOf(nn, pos + 1);
      }
    }
    allHits.sort((a, b) => a.start - b.start);

    const byName = {};
    for (const hit of allHits) (byName[hit.name] = byName[hit.name] || []).push(hit);

    for (const [name, hits] of Object.entries(byName)) {
      let bestFull = '', bestScore = -Infinity;
      for (const { start, nameEnd } of hits) {
        if (isInPrereqContext(normText, start)) continue;
        const nextIdx    = allHits.findIndex(h => h.start > nameEnd && !isInPrereqContext(normText, h.start, 80));
        const nextNorm   = nextIdx !== -1 ? allHits[nextIdx].start : Infinity;
        const rawStart   = nameEnd < rawPos.length ? rawPos[nameEnd] : rawText.length;
        const rawNextHit = nextNorm < rawPos.length ? rawPos[nextNorm] : rawText.length;
        const rawEnd     = Math.min(rawNextHit, rawStart + MAX_DESC_LEN);
        const full       = truncateAtStop(rawText.substring(rawStart, rawEnd).trim());
        if (full.length < 20 || looksLikeTableEntry(full)) continue;
        const score = descScore(full);
        if (score < 0) continue;
        if (score > bestScore || (score === bestScore && full.length > bestFull.length)) {
          bestFull = full; bestScore = score;
        }
      }
      if (bestFull) {
        const cleanFull   = fixHyphens(bestFull);
        const flatFull    = cleanFull.replace(/\n/g, ' ').replace(/\s+/g, ' ');
        results[name] = {
          description: cleanBody(flatFull.replace(ACT_LINE_RE, '').trim()),
          desc:        makeSummary(cleanFull),
          activation:  extractActivation(flatFull),
        };
      }
    }
    return results;
  }

  // ------------------------------------------------------------------
  // Remove sufixo entre parênteses no fim do nome — usado para alias.
  // Ex.: "Primeiro Ideal (Talento Chave de Alternaulta)" → "Primeiro Ideal"
  //      "Mudar Forma" → "Mudar Forma" (sem mudança)
  // ------------------------------------------------------------------
  function canonicalName(name) {
    return name.replace(/\s*\([^)]*\)\s*$/, '').trim();
  }

  // Aliases manuais para divergências singular/plural ou typos entre o JSON
  // do projeto e o nome no livro de regras. Mantém a chave como nome no JSON
  // e o valor como nome no livro (que casa na extração).
  const MANUAL_ALIASES = {
    'Teceluminações Duradouras': 'Teceluminação Duradoura',
    'Transmutar Chama':          'Transmutar Chamas',
  };

  // ------------------------------------------------------------------
  // Coleta todos os nomes de habilidades carregados no CosData.
  // Inclui o nome canônico (sem sufixo entre parênteses) para que o livro,
  // que costuma listar os Ideais sem qualificador de ordem, ainda case.
  // ------------------------------------------------------------------
  function getAllSkillNames() {
    const names = new Set();
    const add = name => {
      if (!name) return;
      names.add(name);
      const c = canonicalName(name);
      if (c && c !== name) names.add(c);
      if (MANUAL_ALIASES[name]) names.add(MANUAL_ALIASES[name]);
    };
    (CosData.SKILLS           || []).forEach(s => add(s.name));
    (CosData.RADIANT_SKILLS   || []).forEach(s => add(s.name));
    (CosData.ADDITIONAL_SKILLS|| []).forEach(s => add(s.name));
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
      // Fallback de alias em ordem: (1) nome literal, (2) sem sufixo entre
      // parênteses ("Primeiro Ideal (Talento Chave...)" → "Primeiro Ideal"),
      // (3) alias manual para divergências singular/plural com o livro.
      const entry = descriptions[skill.name]
                 || descriptions[canonicalName(skill.name)]
                 || (MANUAL_ALIASES[skill.name] && descriptions[MANUAL_ALIASES[skill.name]]);
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
