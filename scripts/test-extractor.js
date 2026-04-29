// Executa a mesma lógica de extração do pdf-extractor.js no Node.js
// Saída: temp/descriptions_preview.json
//
// Uso:
//   node scripts/test-extractor.js
//   node scripts/test-extractor.js confidential/outro.pdf

const fs   = require('fs');
const path = require('path');

// ── Caminhos ──────────────────────────────────────────────────────────────────
const ROOT         = path.resolve(__dirname, '..');
const DATA_DIR     = path.join(ROOT, 'data');
const CONF_DIR     = path.join(ROOT, 'confidential');
const OUT_FILE     = path.join(ROOT, 'temp', 'descriptions_preview.json');
const MAX_DESC_LEN = 1800;

// ── PDF para testar ────────────────────────────────────────────────────────────
function findPdf() {
  const arg = process.argv[2];
  if (arg) return path.resolve(ROOT, arg);
  const files = fs.readdirSync(CONF_DIR).filter(f => f.endsWith('.pdf'));
  if (!files.length) {
    console.error('Nenhum PDF encontrado em confidential/');
    process.exit(1);
  }
  return path.join(CONF_DIR, files[0]);
}

// ── Normalização (idêntica ao pdf-extractor.js do browser) ────────────────────
function norm(s) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Carrega nomes de habilidades dos JSONs ────────────────────────────────────
function canonicalName(name) {
  return name.replace(/\s*\([^)]*\)\s*$/, '').trim();
}

const MANUAL_ALIASES = {
  'Teceluminações Duradouras': 'Teceluminação Duradoura',
  'Transmutar Chama':          'Transmutar Chamas',
};

function loadSkillNames() {
  const files = [
    'br_skills.json',
    'br_radiant_paths.json',
    'br_adittionais_trees.json',
  ];
  const names = new Set();
  const add = name => {
    if (!name) return;
    names.add(name);
    const c = canonicalName(name);
    if (c && c !== name) names.add(c);
    if (MANUAL_ALIASES[name]) names.add(MANUAL_ALIASES[name]);
  };
  const collect = v => {
    if (Array.isArray(v)) v.forEach(collect);
    else if (v && typeof v === 'object') {
      if (v.name) add(v.name);
      else for (const k of Object.keys(v)) collect(v[k]);
    }
  };
  for (const file of files) {
    const p = path.join(DATA_DIR, file);
    if (!fs.existsSync(p)) continue;
    collect(JSON.parse(fs.readFileSync(p, 'utf8')));
  }
  return [...names];
}

// Lista os nomes ORIGINAIS (com parênteses) para reportar missing,
// usando alias automático quando aplicável.
function loadOriginalSkillNames() {
  const files = ['br_skills.json', 'br_radiant_paths.json', 'br_adittionais_trees.json'];
  const names = [];
  const collect = v => {
    if (Array.isArray(v)) v.forEach(collect);
    else if (v && typeof v === 'object') {
      if (v.name) names.push(v.name);
      else for (const k of Object.keys(v)) collect(v[k]);
    }
  };
  for (const file of files) {
    const p = path.join(DATA_DIR, file);
    if (!fs.existsSync(p)) continue;
    collect(JSON.parse(fs.readFileSync(p, 'utf8')));
  }
  return [...new Set(names)];
}

// ── Extração de texto via pdfjs-dist (legacy = funciona no Node) ──────────────
function joinByYThenX(items) {
  const sorted = items.slice().sort((a, b) => {
    const dy = b.transform[5] - a.transform[5];
    if (Math.abs(dy) > 2) return dy;
    return a.transform[4] - b.transform[4];
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

function pageItemsToText(items, pageWidth) {
  const mid  = pageWidth / 2;
  const cols = [[], []];
  for (const it of items) {
    if (!it.str) continue;
    cols[it.transform[4] < mid ? 0 : 1].push(it);
  }
  const min = Math.min(cols[0].length, cols[1].length);
  const tot = cols[0].length + cols[1].length;
  if (tot < 20 || min / tot < 0.1) return joinByYThenX(items);
  return joinByYThenX(cols[0]) + '\n' + joinByYThenX(cols[1]);
}

async function extractText(pdfPath) {
  const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
  pdfjsLib.GlobalWorkerOptions.workerSrc = false;

  const data   = new Uint8Array(fs.readFileSync(pdfPath));
  const pdf    = await pdfjsLib.getDocument({ data, useSystemFonts: true }).promise;
  const total  = pdf.numPages;
  let   text   = '';

  for (let p = 1; p <= total; p++) {
    process.stdout.write(`\r  Lendo página ${p}/${total}…`);
    const page     = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    const content  = await page.getTextContent();
    text += pageItemsToText(content.items, viewport.width) + '\n';
  }
  process.stdout.write('\n');
  return text;
}

// ── buildTextIndex: mapeia posições normText → rawText ───────────────────────
function buildTextIndex(rawText) {
  const normChars = [];
  const rawPos    = [];

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

// Padrões que indicam entrada de tabela, não descrição real
const TABLE_PREFIXES = [
  'da especializa', 'na especializa', 'do conjunto', 'de especializacao',
  'na especializacao', 'da especializacao', 'conjunto inicial',
  'por fim ', 'escolha o conjunto', 'por fim,',
];

function looksLikeTableEntry(text) {
  const t = text.replace(/^[\s.,;:]+/, '')
    .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return TABLE_PREFIXES.some(p => t.startsWith(p));
}

function extractActivation(flat) {
  const m = flat.match(/ativa[cç][aã]o\s*:\s*([★∞▶▷↻\d]+)/i);
  if (!m) return null;
  const sym = m[1].trim();
  if (sym === '∞') return 'passive';
  if (sym === '★') return 'special';
  if (sym === '▶') return 'action1';
  if (sym === '▷') return 'free';
  if (sym === '↻') return 'reaction';
  if (sym === '2') return 'action2';
  if (sym === '3') return 'action3';
  return null;
}

const ACT_LINE_RE = /ativa[cç][aã]o\s*:\s*[★∞▶▷↻\d \t]*/gi;

const DESC_STARTERS = 'Você|Gaste|Quando|Uma vez|Após|Ao\\b|Pode\\b|Redistribua|Escolha|Sempre|Cada\\b|Durante|Esta\\b|Este\\b|Enquanto|Ganha\\b|Seu\\b|Sua\\b|Como\\b|Ao\\s|Se você';

function cleanBody(text) {
  return text
    .replace(/^\([^)]{1,60}\)\s*/i, '')
    .replace(
      new RegExp(`Pré-?requisitos\\s*:(?:(?!${DESC_STARTERS}).){0,250}`, 'gi'),
      ''
    )
    .replace(/^[★∞▶▷↻\d\s]+/, '')
    .trim();
}

function descScore(text) {
  const head = text.substring(0, 120);
  if (/mj\s*:/i.test(head) || /jogador\s*:/i.test(head)) return -1;
  if (/ativa[cç][aã]o\s*:/i.test(head)) return 2;
  return 1;
}

function isInPrereqContext(normText, matchStart, win = 45) {
  const trail = Math.floor(win * 0.75);
  const before = normText.substring(Math.max(0, matchStart - win), matchStart);
  return new RegExp(`pre\\s*requisito[^.]{0,${trail}}$`).test(before) ||
         new RegExp(`\\brequer\\s*:[^.]{0,${trail}}$`).test(before);
}

function fixHyphens(s) {
  return s.replace(/([\wÀ-ɏ])-\s+([\wÀ-ɏ])/g, '$1$2');
}

function makeSummary(fullText) {
  const flat = fixHyphens(fullText.replace(/\n/g, ' ').replace(/\s+/g, ' '));
  const actIdx = flat.search(/ativa[cç][aã]o\s*:/i);
  if (actIdx !== -1) {
    const afterAct = flat.substring(actIdx)
      .replace(/^ativa[cç][aã]o\s*:\s*[★∞▶▷↻◆●\d \t]*/i, '').trim();
    const first = afterAct.match(/^(.{20,160}[.!?])/);
    if (first) return first[1].trim();
    const cut = afterAct.substring(0, 140).trim();
    return afterAct.length > 140 ? cut + '…' : cut;
  }

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

// Padrões de fim de bloco — idênticos a pdf-extractor.js
const STOP_PATTERNS = [
  /Licenciado para\b/i,
  /Cap[ií]tulo\s+\d+\s*[:–]/i,
  /Especializa[cç][aã]o\s+\w[\s\S]{0,80}Os talentos a seguir/i,
  /Os talentos a seguir[\s\S]{0,80}aparecem na (especializa[cç][aã]o|[aá]rvore)/i,
  /\*\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇa-záéíóúâêôãõç][^\n]{0,60}\(talento-chave\b/i,
];
function truncateAtStop(text) {
  let cut = text.length;
  for (const re of STOP_PATTERNS) {
    const m = re.exec(text);
    if (m && m.index < cut) cut = m.index;
  }
  return text.substring(0, cut).trimEnd();
}

function stripPageArtifacts(text) {
  return text
    .replace(/\d{1,3}\s+Cap[ií]tulo\s+\d+\s*[:–][^\n]*\n?/g, ' ')
    .replace(/Cap[ií]tulo\s+\d+\s*[:–][^\n]{0,80}\s+\d{1,3}\s*\n?/g, ' ')
    .replace(/Licenciado para[^\n]*\n?/g, ' ')
    .replace(/\s{2,}/g, ' ');
}

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
        const nb = pos > 0 ? normText[pos - 1] : ' ';
        const na = (pos + nn.length) < normText.length ? normText[pos + nn.length] : ' ';
        if (!/[a-z0-9]/.test(nb) && !/[a-z0-9]/.test(na)) {
          const rIdx = pos < rawPos.length ? rawPos[pos] : window.length;
          if (rIdx < cut) {
            const rawCtx = window.substring(Math.max(0, rIdx - 20), rIdx);
            if (/[\n\r]\s*(?:R\d+\s+|[★∞▶▷↻*\d]\s+)?$/.test(rawCtx) || /[.!?]\s+$/.test(rawCtx)) cut = rIdx;
          }
        }
      }
      pos = normText.indexOf(nn, pos + 1);
    }
  }
  return windowStart + cut;
}

function buildTextIndexLocal(rawText) { return buildTextIndex(rawText); }

// Abordagem primária: âncora em "Ativação:" — idêntica a pdf-extractor.js
function buildDescriptions(rawText, skillNames) {
  const results     = {};
  const sortedNames = [...new Set(skillNames)].sort((a, b) => b.length - a.length);

  const ACT_RE = /ativa[cç][aã]o\s*:\s*[★∞▶▷↻\d]+/gi;
  const acts   = [];
  let m;
  while ((m = ACT_RE.exec(rawText)) !== null) {
    acts.push({ blockStart: m.index, descStart: m.index + m[0].length });
  }

  for (let i = 0; i < acts.length; i++) {
    const { blockStart, descStart } = acts[i];
    const nextBlockStart = i + 1 < acts.length ? acts[i + 1].blockStart : rawText.length;

    const LOOKBACK    = 600;
    const lookbackRaw = rawText.substring(Math.max(0, blockStart - LOOKBACK), blockStart);
    const PREREQ_RE   = /pré.?requisitos\s*:/gi;
    let lastPrereqIdx = -1, pm;
    while ((pm = PREREQ_RE.exec(lookbackRaw)) !== null) lastPrereqIdx = pm.index;
    const headingArea = lastPrereqIdx > 0 ? lookbackRaw.substring(0, lastPrereqIdx) : lookbackRaw;
    const normHeading = norm(headingArea);

    let foundName = null, foundPos = -1;
    for (const name of sortedNames) {
      const nn = norm(name);
      if (nn.length < 3) continue;
      let pos = normHeading.indexOf(nn);
      while (pos !== -1) {
        const nb = pos > 0 ? normHeading[pos - 1] : ' ';
        const na = (pos + nn.length) < normHeading.length ? normHeading[pos + nn.length] : ' ';
        const wordBoundary = !/[a-z0-9]/.test(nb) && !/[a-z0-9]/.test(na);
        if (wordBoundary && !isInPrereqContext(normHeading, pos) && pos > foundPos) {
          foundPos = pos; foundName = name;
        }
        pos = normHeading.indexOf(nn, pos + 1);
      }
    }
    if (!foundName) continue;

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
  for (const v of Object.values(results)) delete v._score;
  return results;
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  const pdfPath    = findPdf();
  const skillNames = loadSkillNames();

  console.log(`PDF  : ${path.relative(ROOT, pdfPath)}`);
  console.log(`Skills carregadas: ${skillNames.length}`);

  const rawText      = await extractText(pdfPath);
  const desc         = buildDescriptions(rawText, skillNames);
  const originalSet  = loadOriginalSkillNames();
  // Aplica alias: nome com sufixo "(...)" cai no canônico se faltar
  const resolve = n => desc[n] || desc[canonicalName(n)] || (MANUAL_ALIASES[n] && desc[MANUAL_ALIASES[n]]);
  const found        = originalSet.filter(resolve).length;
  const missing      = originalSet.filter(n => !resolve(n));

  // Grava output
  fs.mkdirSync(path.join(ROOT, 'temp'), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(desc, null, 2), 'utf8');

  console.log(`\nResultado:`);
  console.log(`  ${found}/${skillNames.length} habilidades com descrição`);
  console.log(`  Arquivo salvo em: temp/descriptions_preview.json`);

  if (missing.length) {
    const MISS_FILE = path.join(ROOT, 'temp', 'descriptions_missing.json');
    fs.writeFileSync(MISS_FILE, JSON.stringify(missing, null, 2), 'utf8');
    console.log(`  ${missing.length} sem match → temp/descriptions_missing.json`);
  }

  // Mostra amostras com os dois campos
  console.log('\n── Amostras ──────────────────────────────────────────');
  const keys = Object.keys(desc).slice(0, 4);
  for (const k of keys) {
    const e = desc[k];
    console.log(`\n[${k}]`);
    console.log(`  DESC (tooltip) : ${e.desc}`);
    console.log(`  FULL (modal)   : ${e.description.substring(0, 280).replace(/\n/g, ' ')}`);
  }
})();
