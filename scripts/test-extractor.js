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
function loadSkillNames() {
  const files = [
    'br_skills.json',
    'br_radiant_paths.json',
    'br_adittionais_trees.json',
  ];
  const names = new Set();
  for (const file of files) {
    const p = path.join(DATA_DIR, file);
    if (!fs.existsSync(p)) continue;
    const arr = JSON.parse(fs.readFileSync(p, 'utf8'));
    arr.forEach(s => s.name && names.add(s.name));
  }
  return [...names];
}

// ── Extração de texto via pdfjs-dist (legacy = funciona no Node) ──────────────
async function extractText(pdfPath) {
  const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
  pdfjsLib.GlobalWorkerOptions.workerSrc = false;

  const data   = new Uint8Array(fs.readFileSync(pdfPath));
  const pdf    = await pdfjsLib.getDocument({ data, useSystemFonts: true }).promise;
  const total  = pdf.numPages;
  let   text   = '';

  for (let p = 1; p <= total; p++) {
    process.stdout.write(`\r  Lendo página ${p}/${total}…`);
    const page    = await pdf.getPage(p);
    const content = await page.getTextContent();
    let   pageStr = '';
    for (const item of content.items) {
      pageStr += item.str;
      pageStr += item.hasEOL ? '\n' : ' ';
    }
    text += pageStr + '\n';
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
  const m = flat.match(/ativa[cç][aã]o\s*:\s*([★∞▶▷\d]+)/i);
  if (!m) return null;
  const sym = m[1].trim();
  if (sym === '∞') return 'passive';
  if (sym === '★') return 'special';
  if (sym === '▶') return 'action1';
  if (sym === '▷') return 'free';
  if (sym === '2') return 'action2';
  if (sym === '3') return 'action3';
  return null;
}

const ACT_LINE_RE = /ativa[cç][aã]o\s*:\s*[★∞▶▷\d \t]*/gi;

const DESC_STARTERS = 'Você|Gaste|Quando|Uma vez|Após|Ao\\b|Pode\\b|Redistribua|Escolha|Sempre|Cada\\b|Durante|Esta\\b|Este\\b|Enquanto|Ganha\\b|Seu\\b|Sua\\b|Como\\b|Ao\\s|Se você';

function cleanBody(text) {
  return text
    .replace(/^\([^)]{1,60}\)\s*/i, '')
    .replace(
      new RegExp(`Pré-?requisitos\\s*:(?:(?!${DESC_STARTERS}).){0,250}`, 'gi'),
      ''
    )
    .replace(/^[★∞▶▷\d\s]+/, '')
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
      .replace(/^ativa[cç][aã]o\s*:\s*[★∞▶▷◆●\d \t]*/i, '').trim();
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

// ── Mesma lógica de buildDescriptions do pdf-extractor.js ────────────────────
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

  // Para cada skill, testa todas as ocorrências e escolhe a melhor janela
  const byName = {};
  for (const hit of allHits) {
    if (!byName[hit.name]) byName[hit.name] = [];
    byName[hit.name].push(hit);
  }

  for (const [name, hits] of Object.entries(byName)) {
    let bestFull  = '';
    let bestScore = -Infinity;

    for (const { start, nameEnd } of hits) {
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
      if (score < 0) continue;
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
      results[name] = { description, desc: makeSummary(cleanFull), activation };
    }
  }

  return results;
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  const pdfPath    = findPdf();
  const skillNames = loadSkillNames();

  console.log(`PDF  : ${path.relative(ROOT, pdfPath)}`);
  console.log(`Skills carregadas: ${skillNames.length}`);

  const rawText    = await extractText(pdfPath);
  const desc       = buildDescriptions(rawText, skillNames);
  const found      = Object.keys(desc).length;
  const missing    = skillNames.filter(n => !desc[n]);

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
