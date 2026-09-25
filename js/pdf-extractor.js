// ============================================================
// Cosmere RPG — Extrator de Descrições do Livro (PDF)
// Carrega PDF.js dinamicamente, extrai texto e mapeia nomes
// de habilidades para seus trechos de descrição.
// As descrições ficam em localStorage — o PDF nunca sai do
// navegador do usuário e nunca é enviado ao servidor.
// ============================================================

var PdfExtractor = (function () {
  'use strict';

  const STORAGE_KEY  = 'cosmere_book_descriptions';     // livro em pt-BR (Stormlight)
  const STORAGE_KEY_EN = 'cosmere_book_descriptions_en'; // Mistborn Handbook (inglês)
  const PDFJS_VER    = '3.11.174';

  // Padrões por idioma do livro. No Mistborn Handbook (inglês) os ícones de ativação
  // são desenhos vetoriais, então "Activation:" não traz símbolo depois.
  const LANGS = {
    pt: {
      actRe:    /ativa[cç][aã]o\s*:\s*[★∞▶▷↻\d]+/gi,
      actLine:  /ativa[cç][aã]o\s*:\s*[★∞▶▷↻\d \t]*/gi,
      actHead:  /ativa[cç][aã]o\s*:/i,
      prereqRe: /pré.?requisitos\s*:/gi,
    },
    en: {
      actRe:    /activation\s*:[ \t]*/gi,
      actLine:  /activation\s*:[ \t]*/gi,
      actHead:  /activation\s*:/i,
      prereqRe: /prerequisites?\s*:/gi,
    },
  };

  // Decide o idioma pela contagem de rótulos de ativação
  function detectLang(text) {
    const en = (text.match(/\bActivation\s*:/g) || []).length;
    const pt = (text.match(/Ativa[cç][aã]o\s*:/gi) || []).length;
    return en > pt ? 'en' : 'pt';
  }
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
    // Mistborn Handbook (inglês) — rodapés "Chapter N: …" já saem em stripPageArtifacts
    /Licensed to\b/,
    /The following (?:\w+ )?talents,? presented/i,
    /\n\s*(?:Using|Creative Uses|Complications)\b[^\n]{0,40}\n/,
    /\n[^\n]{0,40}(?:Allomancy|Feruchemy) Talents\s*\n/,
  ];

  // Paradas extras do livro em inglês: título de seção "X Talents" e crédito de
  // ilustração em caixa alta ("DEANDRA SCICLUNA & LOGAN FELICIANO") numa linha própria
  const EN_STOP_PATTERNS = [
    /\n[^\n]{0,40}\bTalents\s*(?:\n|$)/,
    /\n\s*[A-Z]{2,}(?:[ &.'’-]+[A-Z]{2,})+\s*(?:\n|$)/,
    // Início da próxima seção: "Bronze Allomancy" + "Mental – Internal – Pushing"
    /\n[^\n]{0,24}\n?[^\n]{0,24}\n\s*(?:Physical|Mental|Enhancement|Temporal|Cognitive|Spiritual|Hybrid|God Metal)\s*[–—-]/,
    /\n\s*(?:Human|Kandra|Koloss-Blooded) Ancestry\b/,
    /\n\s*(?:Building an? |Iconic |Choosing )[A-Z]/,
    /\n\s*(?:Agents|Envoys|Hunters|Leaders|Scholars|Warriors) of Scadrial/,
    /\n\s*Culture\s*\n/,
  ];

  // Trunca `text` na primeira ocorrência de qualquer padrão de parada
  function truncateAtStop(text, lang = 'pt') {
    let cut = text.length;
    for (const re of lang === 'en' ? [...STOP_PATTERNS, ...EN_STOP_PATTERNS] : STOP_PATTERNS) {
      const m = re.exec(text);
      if (m && m.index < cut) cut = m.index;
    }
    return text.substring(0, cut).trimEnd();
  }

  const EN_CHAPTERS = 'Introduction|Character Creation|Origins|Character Statistics|Heroic Paths|Metalborn Paths|' +
    'Metallic Arts|Items|Goals and Rewards|Adventuring|Combat|Conversations|Endeavors|Gamemastering';
  const EN_FOOTER_RE = new RegExp(`(?:\\b\\d{1,3}\\s+)?Chapter\\s+\\d+\\s*:\\s*(?:${EN_CHAPTERS})(?:\\s+\\d{1,3}\\b)?`, 'g');

  // Remove rodapés/cabeçalhos de página que aparecem no MEIO do bloco de
  // descrição, entre "Ativação:" e o texto real. Sem isso, truncateAtStop
  // cortaria no primeiro "Capítulo X:" (rodapé) e devolveria descrição vazia.
  function stripPageArtifacts(text) {
    return text
      .replace(/\d{1,3}\s+Cap[ií]tulo\s+\d+\s*[:–][^\n]*\n?/g, ' ')
      .replace(/Cap[ií]tulo\s+\d+\s*[:–][^\n]{0,80}\s+\d{1,3}\s*\n?/g, ' ')
      .replace(/Licenciado para[^\n]*\n?/g, ' ')
      // Rodapés do Mistborn Handbook: "Chapter 4: Heroic Paths 82" / "82 Chapter 4: …",
      // que o PDF.js pode quebrar em linhas ou intercalar no meio de um parágrafo
      .replace(EN_FOOTER_RE, ' ')
      .replace(/\s{2,}/g, ' ');
  }

  // Retorna a posição raw (dentro de [windowStart, windowEnd)) onde o próximo
  // nome de habilidade diferente de foundName aparece como cabeçalho de bloco
  // (precedido por quebra de linha ou fim de frase). Retorna windowEnd se não encontrar.
  function clipAtNextSkillName(rawText, windowStart, windowEnd, foundName, sortedNames, lang = 'pt') {
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
              const isHeader = /[\n\r]\s*(?:R\d+\s+|[★∞▶▷↻*\d]\s+)?$/.test(rawCtx) || /[.!?]\s+$/.test(rawCtx);
              // No livro em inglês, nomes de ações ("Burn Cadmium") aparecem no meio
              // das regras; só é cabeçalho se vier seguido do bloco do talento/poder.
              const followsBlock = lang !== 'en' ||
                /^[^\n]{0,60}\n?\s*(?:Prerequisites?|Activation|Duration)\s*:/i.test(window.substring(rIdx + name.length, rIdx + name.length + 160));
              if (isHeader && followsBlock) {
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
    'the following talents', 'talent in the ', 'talents from the ',
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
    if (/\bGM\s*:/.test(head) || /\bPlayer\s*:/.test(head)) return -1;
    if (/ativa[cç][aã]o\s*:/i.test(head) || /activation\s*:/i.test(head)) return 2;
    return 1;
  }

  // Retorna true se a ocorrência do nome está dentro de uma lista de pré-requisitos
  // de outra habilidade (ex: "Pré-requisitos: Oportunista; Agilidade 2+")
  // win=45  → filtra ocorrências do próprio nome (janela curta = não captura bloco anterior)
  // win=80  → filtra fronteiras de janela (janela larga = captura prereqs com listas longas)
  function isInPrereqContext(normText, matchStart, win = 45) {
    const trail = Math.floor(win * 0.75);
    const before = normText.substring(Math.max(0, matchStart - win), matchStart);
    return new RegExp(`pre\\s*requisit[eo][^.]{0,${trail}}$`).test(before) ||
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
    const actIdx = flat.search(/ativa[cç][aã]o\s*:|activation\s*:/i);
    if (actIdx !== -1) {
      // Avança após "Ativação: ★" — símbolo pode ser ★ ∞ ▶ ou dígito (ex: "3")
      const afterAct = flat.substring(actIdx)
        .replace(/^(?:ativa[cç][aã]o|activation)\s*:\s*[★∞▶▷↻◆●\d \t]*/i, '').trim();
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
  const DESC_STARTERS_EN = 'You\\b|Your\\b|When\\b|Spend\\b|Once\\b|After\\b|Before\\b|While\\b|Each\\b|Choose\\b|Gain\\b|If you|As\\b|With\\b|By\\b|Through\\b';

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
      .replace(
        new RegExp(`Prerequisites?\\s*:(?:(?!${DESC_STARTERS_EN}).){0,250}`, 'g'),
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
  function buildDescriptions(rawText, skillNames, lang = 'pt') {
    const L = LANGS[lang] || LANGS.pt;
    const results   = {};
    const sortedNames = [...new Set(skillNames)].sort((a, b) => b.length - a.length);

    // ── Pass 1: Activation-anchored ────────────────────────────────────────
    const ACT_RE = new RegExp(L.actRe.source, 'gi');
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
      const PREREQ_RE = new RegExp(L.prereqRe.source, 'gi');
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
      const descRaw = rawText.substring(descStart, clipAtNextSkillName(rawText, descStart, rawWindowEnd, foundName, sortedNames, lang));
      // No inglês as paradas por linha precisam das quebras originais, então
      // cortam antes de stripPageArtifacts (que junta espaços e quebras)
      const pre     = lang === 'en' ? truncateAtStop(descRaw.replace(EN_FOOTER_RE, ' '), 'en') : descRaw;
      const full    = truncateAtStop(stripPageArtifacts(pre).trim(), lang);
      if (full.length < 15 || looksLikeTableEntry(full)) continue;

      const score = descScore(full);
      if (score < 0) continue;

      const cleanFull   = fixHyphens(full);
      const flatFull    = cleanFull.replace(/\n/g, ' ').replace(/\s+/g, ' ');
      const activation  = lang === 'pt' ? extractActivation(rawText.substring(blockStart, descStart)) : null;
      const description = cleanBody(flatFull.replace(ACT_LINE_RE, '').replace(L.actLine, '').trim());
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
  // Habilidades básicas: as regras do fluxo (Stormlight) e do poder de cada
  // metal (Mistborn) ficam fora das árvores. Ids: 'fluxo:divisao',
  // 'allo:aco', 'feru:ferro'; 'nascente:allo:ferro' guarda o exemplo de
  // poder nascente da tabela do Mistborn Handbook.
  // ------------------------------------------------------------------
  const escRe = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const BASIC_MAX = 6000;
  const CAPS_CREDIT_RE = /\n\s*[A-ZÀ-Ý]{2,}(?:[ &.'’-]+[A-ZÀ-Ý]{2,})+\s*(?=\n)/g;

  // Legendas de ilustração: créditos "TOP: …; BOTTOM: …" e o texto em versalete
  // que o PDF quebra em pedaços ("d ura L umin aLLO manc Y")
  function isCaptionLine(line) {
    return /^\s*(?:TOP|BOTTOM|LEFT|RIGHT)\s*:/.test(line) || /[a-z]\s+[A-Z]{1,3}\s+[a-z]/.test(line);
  }

  function flatBasic(text, en = false) {
    if (en) text = text.split('\n').filter(l => !isCaptionLine(l)).join('\n');
    return fixHyphens(stripPageArtifacts(text.replace(EN_FOOTER_RE, ' ').replace(CAPS_CREDIT_RE, '\n')))
      // Crédito de ilustração que o PDF intercala no meio da frase ("esferas PETAR PENEV infundidas")
      .replace(/\b[A-ZÀ-Ý]{2,}(?:[ '’.-]+[A-ZÀ-Ý]{2,})+\b/g, m => (/\d/.test(m) ? m : ' '))
      .replace(en ? /\b(?:TOP|BOTTOM|LEFT|RIGHT)\s*:\s*;?/g : /$^/, '')
      // Hifenização do livro em inglês: "super - natural", "charac - ter"
      .replace(en ? /([a-z])\s+-\s+([a-z])/g : /$^/, '$1$2')
      .replace(/\s+/g, ' ').replace(/\s+([.,;:])/g, '$1').trim();
  }

  // O texto básico de um fluxo nunca tem "Pré-requisitos:" — se aparecer, é a
  // página-resumo da árvore; corta no card ("∞ Nome") que o precede
  function clipAtTreeCards(body, name) {
    const pm = /Pr[ée]-?requisitos\s*:/i.exec(body);
    if (!pm) return body;
    let cut = pm.index;
    const CARD = /\n\s*[★∞↻▶▷*\d]\s+[^\n]*/g;
    let c;
    while ((c = CARD.exec(body)) !== null && c.index < pm.index) {
      if (pm.index - c.index < 120) { cut = c.index; break; }
    }
    return body.substring(0, cut).replace(new RegExp(`\\n\\s*${escRe(name)}\\s*$`, 'i'), '');
  }

  function extractBasics(rawText, lang) {
    const out = {};
    if (lang === 'pt') {
      for (const [key, p] of Object.entries(CosData.PERICIAS_RADIANTES || {})) {
        const n = escRe(p.name);
        const head = new RegExp(`Fluxo\\s+d[aoe]s?\\s+${n}\\s*\\n\\s*Ordens Radiantes\\s*:`, 'i').exec(rawText);
        if (!head) continue;
        const win = rawText.substring(head.index, head.index + BASIC_MAX);
        const act = LANGS.pt.actLine.source;
        const actM = new RegExp(act, 'i').exec(win);
        if (!actM || actM.index > 300) continue;
        const bodyStart = actM.index + actM[0].length;
        const endM = new RegExp(`\\n\\s*(?:Usando\\s+${n}|Talentos\\s+de\\s+${n})\\b`, 'i').exec(win.substring(bodyStart));
        const body = clipAtTreeCards(win.substring(bodyStart, endM ? bodyStart + endM.index : win.length), p.name);
        // Título solto da página-resumo no fim ("t ransporte")
        const description = flatBasic(body).replace(/([.!?)])\s+[^.!?]{1,25}$/, '$1');
        if (description.length < 40) continue;
        out[`fluxo:${key}`] = { description, activation: extractActivation(actM[0]) };
      }
      return out;
    }

    // Mistborn Handbook (inglês): da seção "Steel Allomancy" até "Using Steel Allomancy"
    // (ou até o cabeçalho da próxima arte, quando a seção não tem "Using…")
    const CATEGORY = `[^\\n]{0,60}(?:\\s[–—]\\s|God\\s+Metal)[^\\n]*\\n`;
    const NEXT_HEAD = new RegExp(`\\n\\s*[A-Z][a-z]+\\s*\\n?\\s*(?:Allomancy|Feruchemy)\\s*\\n${CATEGORY}`);
    for (const m of CosData.METALS || []) {
      for (const [art, word] of [['allo', 'Allomancy'], ['feru', 'Feruchemy']]) {
        const tree = `${escRe(m.en)}\\s+${word}`;
        // Cabeçalho da seção: nome da arte seguido da linha de categoria ("Physical – External – Pushing")
        const head = new RegExp(`(?:^|\\n)\\s*${tree}\\s*\\n${CATEGORY}`).exec(rawText);
        if (!head) continue;
        const win = rawText.substring(head.index + head[0].length, head.index + head[0].length + BASIC_MAX);
        const ends = [new RegExp(`\\n\\s*(?:Using\\s+${tree}|${tree}\\s+Talents)\\b`).exec(win), NEXT_HEAD.exec(win)]
          .filter(Boolean).map(e => e.index);
        const section = win.substring(0, ends.length ? Math.min(...ends) : win.length);
        // Cada sub-poder: "Burn Steel \n Activation: \n Duration: 1 round \n texto…"
        const SUB_RE = /(?:^|\n)([^\n]{2,40})\n\s*Activation\s*:[^\n]*\n(?:\s*Duration\s*:\s*([^\n]*)\n)?/g;
        const subs = [];
        let s;
        while ((s = SUB_RE.exec(section)) !== null) subs.push({ at: s.index, end: s.index + s[0].length, name: s[1].trim(), dur: s[2] });
        if (!subs.length) continue;
        const parts = subs.map((sub, i) => {
          const body = flatBasic(section.substring(sub.end, i + 1 < subs.length ? subs[i + 1].at : section.length), true);
          const dur = sub.dur ? ` (Duration: ${flatBasic(sub.dur, true)})` : '';
          return `${sub.name}${dur}. ${body}`;
        });
        out[`${art}:${m.key}`] = { description: parts.join('\n\n') };
      }
    }

    // Tabela "Nascent Power Examples": só alguns metais têm exemplo
    const tableAt = rawText.search(/Nascent Power Examples\s*\n\s*Metallic Art/);
    if (tableAt !== -1) {
      const table = rawText.substring(tableAt, tableAt + 4000);
      const rows = [];
      for (const m of CosData.METALS || []) {
        for (const [art, word] of [['allo', 'Allomancy'], ['feru', 'Feruchemy']]) {
          const r = new RegExp(`\\n\\s*${escRe(m.en)}\\s+${word}\\b\\s*`).exec(table);
          if (r) rows.push({ id: `nascente:${art}:${m.key}`, at: r.index, start: r.index + r[0].length });
        }
      }
      rows.sort((a, b) => a.at - b.at);
      const tableEnd = table.search(/\n\s*Nascent Feruchemical Powers|\n\s*Power Scaling/);
      rows.forEach((row, i) => {
        const end = i + 1 < rows.length ? rows[i + 1].at : (tableEnd > row.start ? tableEnd : row.start + 200);
        const description = flatBasic(table.substring(row.start, end), true);
        if (description.length > 10) out[row.id] = { description };
      });
    }
    return out;
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
  // Todas as skills carregadas, de todos os cenários
  function allPools() {
    return [
      ...(CosData.ALL_SKILLS       || CosData.SKILLS || []),
      ...(CosData.RADIANT_SKILLS   || []),
      ...(CosData.ADDITIONAL_SKILLS|| []),
      ...(CosData.METAL_SKILLS     || []),
    ];
  }

  // pt: nomes traduzidos; en: nomes originais do Mistborn Handbook (s.en / s.aliasEn)
  function getAllSkillNames(lang = 'pt') {
    const names = new Set();
    const add = name => {
      if (!name) return;
      names.add(name);
      const c = canonicalName(name);
      if (c && c !== name) names.add(c);
      if (MANUAL_ALIASES[name]) names.add(MANUAL_ALIASES[name]);
    };
    for (const s of allPools()) {
      if (lang === 'en') { add(s.en); add(s.aliasEn); }
      else add(s.name);
    }
    return [...names];
  }

  // ------------------------------------------------------------------
  // Aplica descrições diretamente nos objetos skill do CosData
  // ------------------------------------------------------------------
  // Créditos de ilustração que o PDF intercala no texto do livro em inglês
  // ("… doesn't stack.) DARKO STOJANOVIC", "TOP: …; BOTTOM: …"). Limpa na hora
  // de exibir, então vale também para livros carregados antes da correção.
  function cleanEnText(text) {
    return (text || '')
      .replace(/\b(?:TOP|BOTTOM|LEFT|RIGHT)\s*:\s*;?/g, ' ')
      .replace(/\b[A-ZÀ-Ý]{2,}(?:[ '’.-]+[A-ZÀ-Ý]{2,})+\b/g, m => (/\d/.test(m) ? m : ' '))
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\s+([.,;:])/g, '$1')
      .trim();
  }

  function applyToSkills(descriptions, lang = 'pt', keepOriginal = false) {
    let applied = 0;
    for (const skill of allPools()) {
      // Fallback de alias em ordem: (1) nome literal, (2) sem sufixo entre
      // parênteses ("Primeiro Ideal (Talento Chave...)" → "Primeiro Ideal"),
      // (3) alias manual para divergências singular/plural com o livro.
      // Nós de Poder: a regra fica sob a ação ("Burn Iron"), não sob o título "Iron Allomancy"
      const entry = lang === 'en'
        ? (skill.aliasEn && descriptions[skill.aliasEn])
          || (skill.en && (descriptions[skill.en] || descriptions[canonicalName(skill.en)]))
        : descriptions[skill.name]
          || descriptions[canonicalName(skill.name)]
          || (MANUAL_ALIASES[skill.name] && descriptions[MANUAL_ALIASES[skill.name]]);
      if (!entry) continue;
      // Tradução automática por cima do original: guarda o inglês para consulta
      if (keepOriginal && skill.description) skill.descriptionOriginal = skill.description;
      const clean = t => (lang === 'en' ? cleanEnText(t) : t);
      // Suporta formato novo { desc, description } e formato legado (string)
      if (typeof entry === 'string') {
        skill.description = clean(entry);
        skill.desc        = makeSummary(skill.description);
      } else {
        skill.description = clean(entry.description);
        skill.desc        = clean(entry.desc);
        if (entry.activation) skill.activation = entry.activation;
      }
      // Idioma do texto exibido: o modal oferece traduzir quando é inglês
      skill.descLang = keepOriginal ? 'pt-auto' : lang;
      applied++;
    }
    return applied;
  }

  // ------------------------------------------------------------------
  // API pública
  // ------------------------------------------------------------------

  // ------------------------------------------------------------------
  // Armazenamento por livro: cada PDF carregado vira um registro próprio
  // (ex.: "stormlight-pt", "mistborn-en"), então vários livros convivem.
  // ------------------------------------------------------------------
  const BOOKS_KEY = 'cosmere_books_v2';
  const BOOK_LABEL = { stormlight: 'Stormlight', mistborn: 'Mistborn' };
  const LANG_LABEL = { pt: 'PT', en: 'EN' };
  const EXPORT_FORMAT = 'cosmere-builder-descricoes';

  // Qual livro é: termos de Scadrial × termos de Roshar
  function detectBook(text) {
    const count = re => (text.match(re) || []).length;
    const scadrial = count(/\b(Scadrial|Allomanc\w*|Alomanc\w*|Feruchem\w*|Feruquem\w*|Mistborn|Metalborn)\b/gi);
    const roshar   = count(/\b(Roshar|Stormlight|Radiant\w*|Radiante\w*|Surgebind\w*|spren|Luz das Tempestades)\b/gi);
    return scadrial > roshar ? 'mistborn' : 'stormlight';
  }

  function readStore() {
    try {
      const store = JSON.parse(localStorage.getItem(BOOKS_KEY) || '{}');
      // Migra o formato antigo (uma chave por idioma)
      const oldPt = localStorage.getItem(STORAGE_KEY);
      const oldEn = localStorage.getItem(STORAGE_KEY_EN);
      if (oldPt || oldEn) {
        if (oldPt && !store['stormlight-pt']) store['stormlight-pt'] = makeEntry('stormlight', 'pt', JSON.parse(oldPt));
        if (oldEn && !store['mistborn-en'])   store['mistborn-en']   = makeEntry('mistborn', 'en', JSON.parse(oldEn));
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(STORAGE_KEY_EN);
        writeStore(store);
      }
      return store;
    } catch (_) {
      return {};
    }
  }

  function writeStore(store) {
    try {
      localStorage.setItem(BOOKS_KEY, JSON.stringify(store));
    } catch (err) {
      throw new Error('Sem espaço no navegador para guardar as descrições deste livro.');
    }
  }

  function makeEntry(book, lang, descriptions, extra = {}) {
    return { book, lang, ...extra, count: Object.keys(descriptions).length, loadedAt: new Date().toISOString(), descriptions };
  }

  function entryLabel(e) {
    const book = BOOK_LABEL[e.book] || e.book;
    return e.auto ? `${book} (PT · tradução automática)` : `${book} (${LANG_LABEL[e.lang] || e.lang})`;
  }

  // Limpa e reaplica tudo: inglês primeiro, tradução automática por cima e
  // o livro em pt-BR por último (onde existe texto oficial, ele vence)
  function applyAll() {
    for (const skill of allPools()) {
      delete skill.description; delete skill.desc; delete skill.activation; delete skill.descriptionOriginal; delete skill.descLang;
    }
    const order = e => (e.lang === 'en' ? 0 : e.auto ? 1 : 2);
    const entries = Object.values(readStore()).sort((a, b) => order(a) - order(b));
    let applied = 0;
    BASICS = {};
    for (const e of entries) {
      applied += applyToSkills(e.descriptions, e.lang, !!e.auto);
      for (const [id, b] of Object.entries(e.basics || {})) {
        BASICS[id] = { ...b, original: e.auto && BASICS[id] ? BASICS[id].description : undefined };
      }
    }
    return applied;
  }

  // Habilidades básicas (fluxos / poderes metálicos) de todos os livros carregados
  let BASICS = {};
  /** @returns {{ description: string, activation?: string, original?: string } | null} */
  function getBasicAbility(id) {
    return BASICS[id] || null;
  }

  /**
   * Lê descrições salvas no localStorage e aplica às skills.
   * Chamar logo após CosData.load*() no init do app.
   * @returns {number} quantidade de habilidades com descrição aplicada
   */
  function loadAndApply() {
    return applyAll();
  }

  /**
   * Processa um arquivo PDF, extrai descrições e persiste no localStorage.
   * Detecta sozinho o livro (Stormlight/Mistborn) e o idioma (pt/en).
   * @param {File} file - arquivo PDF selecionado pelo usuário
   * @param {function} onProgress - callback(mensagem: string)
   * @returns {{ found: number, total: number, lang: string, book: string, label: string }}
   */
  async function processFile(file, onProgress) {
    if (onProgress) onProgress('Carregando PDF.js…');
    await loadPdfJs();

    const text  = await extractFullText(file, onProgress);
    const lang  = detectLang(text);
    const book  = detectBook(text);
    const label = `${BOOK_LABEL[book]} (${LANG_LABEL[lang]})`;

    if (onProgress) onProgress(`${label} detectado — buscando descrições…`);
    const names        = getAllSkillNames(lang);
    const descriptions = buildDescriptions(text, names, lang);
    const basics       = extractBasics(text, lang);

    const store = readStore();
    store[`${book}-${lang}`] = makeEntry(book, lang, descriptions, { basics });
    writeStore(store);
    applyAll();

    return { found: Object.keys(descriptions).length, total: names.length, lang, book, label };
  }

  /** Livros carregados: [{ id, label, count, loadedAt }] */
  function listBooks() {
    const store = readStore();
    return Object.entries(store).map(([id, e]) => {
      const auto = store[`${e.book}${AUTO_SUFFIX}`];
      return {
        id, label: entryLabel(e), count: e.count, loadedAt: e.loadedAt, lang: e.lang, auto: !!e.auto,
        // Livro em inglês ainda sem tradução completa: pode ser traduzido no navegador
        translatable: e.lang === 'en' && (!auto || !auto.complete
          || Object.keys(auto.basics || {}).length < Object.keys(e.basics || {}).length),
        // Carregado antes das habilidades básicas existirem: precisa reprocessar o PDF
        noBasics: !e.auto && !e.basics,
      };
    });
  }

  function removeBook(id) {
    const store = readStore();
    delete store[id];
    // A tradução automática sai junto com o livro em inglês de onde veio
    for (const [k, e] of Object.entries(store)) if (e.auto && e.source === id) delete store[k];
    writeStore(store);
    applyAll();
  }

  /**
   * Remove descrições do localStorage e dos objetos skill.
   */
  function clearDescriptions() {
    localStorage.removeItem(BOOKS_KEY);
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_KEY_EN);
    applyAll();
  }

  /** @returns {boolean} */
  function hasStoredDescriptions() {
    return listBooks().length > 0;
  }

  // ------------------------------------------------------------------
  // Backup pessoal: leva as descrições extraídas dos SEUS livros para outro
  // aparelho sem reprocessar o PDF. Contém texto dos livros — uso pessoal.
  // ------------------------------------------------------------------
  function exportBackup() {
    const payload = {
      formato: EXPORT_FORMAT,
      versao: 1,
      aviso: 'Descrições extraídas dos livros do próprio usuário. Uso pessoal: não publique nem compartilhe este arquivo — o texto pertence à Dragonsteel Entertainment / Brotherwise Games.',
      exportadoEm: new Date().toISOString(),
      livros: readStore(),
    };
    return new Blob([JSON.stringify(payload)], { type: 'application/json' });
  }

  async function importBackup(file) {
    let payload;
    try { payload = JSON.parse(await file.text()); } catch (_) { throw new Error('Arquivo inválido.'); }
    if (!payload || payload.formato !== EXPORT_FORMAT || typeof payload.livros !== 'object') {
      throw new Error('Este arquivo não é um backup de descrições do Cosmere Builder.');
    }
    const store = readStore();
    let books = 0;
    for (const [id, e] of Object.entries(payload.livros)) {
      if (!e || typeof e.descriptions !== 'object' || !LANG_LABEL[e.lang]) continue;
      store[id] = makeEntry(e.book, e.lang, e.descriptions, {
        basics: e.basics || {},
        ...(e.auto ? { auto: true, source: e.source, complete: !!e.complete } : {}),
      });
      books++;
    }
    writeStore(store);
    return { books, applied: applyAll() };
  }

  // ------------------------------------------------------------------
  // Tradução automática no próprio aparelho (Translator API do Chrome/Edge):
  // o texto que o usuário extraiu do SEU livro em inglês é traduzido para
  // pt-BR localmente — nada vai para servidor nem para o repositório.
  // ------------------------------------------------------------------
  const AUTO_SUFFIX = '-pt-auto';
  const TR_OPTS = { sourceLanguage: 'en', targetLanguage: 'pt' };

  function translatorSupported() {
    return typeof self !== 'undefined' && 'Translator' in self;
  }

  /** 'unsupported' | 'unavailable' | 'downloadable' | 'downloading' | 'available' */
  async function translatorStatus() {
    if (!translatorSupported()) return 'unsupported';
    // Alguns navegadores embutidos expõem a API mas nunca respondem
    const timeout = new Promise(r => setTimeout(() => r('unavailable'), 10000));
    try { return await Promise.race([self.Translator.availability(TR_OPTS), timeout]); } catch (_) { return 'unavailable'; }
  }

  // Glossário: troca os termos do jogo pelos nomes usados no site antes de
  // traduzir, para o tradutor não inventar outras versões
  function buildGlossary() {
    const pairs = new Map();
    const add = (en, pt, caseless = false) => {
      if (!en || !pt || en === pt || pairs.has(en)) return;
      pairs.set(en, { pt, caseless });
    };
    const GENERAL = {
      Allomancy: 'Alomancia', Allomancer: 'Alomante', Allomancers: 'Alomantes', Allomantic: 'Alomântico',
      Feruchemy: 'Feruquemia', Feruchemist: 'Feruquemista', Feruchemists: 'Feruquemistas', Feruchemical: 'Feruquêmico',
      metalmind: 'mentemetal', metalminds: 'mentesmetal', Metalborn: 'Metalnascido', Investiture: 'Investidura',
      Mistborn: 'Nascido da Bruma', Misting: 'Brumoso', Mistings: 'Brumosos', Twinborn: 'Duplonato',
      Ferring: 'Ferroso', Ferrings: 'Ferrosos', 'Koloss-blooded': 'Sangue-Koloss',
    };
    for (const [en, pt] of Object.entries(GENERAL)) add(en, pt, true);
    for (const m of CosData.METALS || []) {
      add(m.en, m.name.toLowerCase(), true);
      add(m.allo && m.allo.mistingEn, m.allo && m.allo.misting);
      add(m.feru && m.feru.ferringEn, m.feru && m.feru.ferring);
    }
    for (const p of Object.values(CosData.METALBORN_PATHS || {})) add(p.keyEn, p.key);
    // Nomes de talentos: só os de 2+ palavras (os de uma palavra são comuns demais)
    for (const s of allPools()) if (s.en && /\s/.test(s.en.trim())) add(s.en.trim(), s.name);
    const esc = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return [...pairs.entries()]
      .sort((a, b) => b[0].length - a[0].length)
      .map(([en, { pt, caseless }]) => [new RegExp(`\\b${esc(en)}\\b`, caseless ? 'gi' : 'g'), pt]);
  }

  function applyGlossary(text, glossary) {
    for (const [re, pt] of glossary) text = text.replace(re, pt);
    return text.replace(/\bActivation\s*:/g, 'Ativação:').replace(/\bPrerequisites?\s*:/g, 'Pré-requisitos:')
      .replace(/\bDuration\s*:/g, 'Duração:');
  }

  /**
   * Traduz um livro em inglês já carregado (ex.: 'mistborn-en') para pt-BR,
   * no próprio navegador. Retoma de onde parou se for interrompido.
   * @returns {{ translated: number, total: number }}
   */
  async function translateBook(bookId, onProgress) {
    const store = readStore();
    const src = store[bookId];
    if (!src || src.lang !== 'en') throw new Error('Só dá para traduzir livros em inglês.');
    const status = await translatorStatus();
    if (status === 'unsupported') throw new Error('Este navegador não tem tradutor embutido. Use o Chrome ou o Edge atualizado no computador.');
    if (status === 'unavailable') throw new Error('O tradutor do navegador não oferece inglês → português neste aparelho.');

    const translator = await self.Translator.create({
      ...TR_OPTS,
      monitor(m) {
        m.addEventListener('downloadprogress', e => {
          if (onProgress) onProgress(`Baixando o tradutor do navegador… ${Math.round(e.loaded * 100)}%`);
        });
      },
    });

    const autoId = `${src.book}${AUTO_SUFFIX}`;
    const out = { ...((store[autoId] && store[autoId].descriptions) || {}) };
    const glossary = buildGlossary();
    const cache = new Map();
    // Mesma busca de applyToSkills(…, 'en'), mas guardando pelo nome em pt-BR
    const jobs = [];
    for (const skill of allPools()) {
      const d = src.descriptions;
      const entry = (skill.aliasEn && d[skill.aliasEn])
        || (skill.en && (d[skill.en] || d[canonicalName(skill.en)]));
      if (entry && !out[skill.name] && !jobs.some(j => j.skill.name === skill.name)) jobs.push({ skill, entry });
    }
    // Habilidades básicas (poder de cada metal) entram na mesma fila
    const outBasics = { ...((store[autoId] && store[autoId].basics) || {}) };
    for (const [id, b] of Object.entries(src.basics || {})) {
      if (!outBasics[id]) jobs.push({ basicId: id, entry: b });
    }
    const total = Object.keys(out).length + Object.keys(outBasics).length + jobs.length;
    let done = 0;
    const save = () => {
      const st = readStore();
      st[autoId] = makeEntry(src.book, 'pt', out,
        { basics: outBasics, auto: true, source: bookId, complete: done === jobs.length });
      writeStore(st);
    };
    // Parágrafos traduzidos um a um para manter a divisão dos sub-poderes
    const tr = async text => {
      if (!cache.has(text)) {
        const paras = text.split('\n\n');
        const done = [];
        for (const p of paras) done.push(await translator.translate(applyGlossary(p, glossary)));
        cache.set(text, done.join('\n\n'));
      }
      return cache.get(text);
    };

    try {
      for (const { skill, basicId, entry } of jobs) {
        const en = cleanEnText(typeof entry === 'string' ? entry : entry.description);
        const pt = await tr(en);
        if (basicId) {
          outBasics[basicId] = { ...entry, description: pt };
        } else {
          out[skill.name] = { description: pt, desc: makeSummary(pt) };
          if (entry.activation) out[skill.name].activation = entry.activation;
        }
        done++;
        if (onProgress) onProgress(`Traduzindo no navegador… ${Object.keys(out).length + Object.keys(outBasics).length}/${total}`);
        if (done % 20 === 0) save();
      }
    } finally {
      save();
      if (translator.destroy) translator.destroy();
      applyAll();
    }
    return { translated: Object.keys(out).length, total };
  }

  return { loadAndApply, processFile, clearDescriptions, hasStoredDescriptions,
           listBooks, removeBook, exportBackup, importBackup,
           translatorStatus, translateBook, getBasicAbility };
})();
