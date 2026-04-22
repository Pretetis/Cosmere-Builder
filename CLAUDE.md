# CLAUDE.md — Cosmere RPG: Árvore de Habilidades

## graphify

This project has a graphify knowledge graph at graphify-out/.

Rules:
- Before answering architecture or codebase questions, read graphify-out/GRAPH_REPORT.md for god nodes and community structure
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files
- After modifying code files in this session, run `python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"` to keep the graph current

## Notas para o Claude

- Sempre rodar com servidor HTTP local — nunca abrir `index.html` diretamente
- Os três módulos JS são carregados em ordem no HTML: `data.js` → `renderer.js` → `app.js`
- Ao modificar dados de jogo, atualizar os arquivos JSON em `data/` e, se necessário, a estrutura em `CosData`
- Não introduzir bundler (webpack/vite) sem alinhamento — o projeto é intencionalmente sem build step
- `CosmereClass.xlsx` é a fonte primária de referência das classes; consultar ao adicionar conteúdo

## Visão Geral do Projeto

Aplicação web client-side que simula o sistema de **Árvore de Habilidades do Cosmere RPG** (TTRPG baseado nos livros de Brandon Sanderson). Permite criar e gerenciar personagens, distribuir pontos de atributo, perícias e talentos, visualizar árvores de habilidades em 3D e exportar fichas em PDF.

> **Idioma:** Interface e dados em português do Brasil (pt-BR).
> **Nota fan-made:** Projeto não oficial; adapta as mecânicas do Cosmere RPG para uso pessoal.

---

## Como Executar

```bash
# Opção 1 — Windows (recomendado)
start.bat        # Inicia python -m http.server 8081

# Opção 2 — qualquer terminal
python -m http.server 8081
# Acesse: http://localhost:8081
```

> **Importante:** Precisa de servidor HTTP local por causa dos `fetch()` para carregar os arquivos JSON. Não abre direto como `file://`.

---

## Arquitetura

### Módulos JavaScript (IIFEs em ordem de carregamento)

1. **`CosData`** (`js/data.js`) — Fonte única da verdade dos dados de jogo:
   - Atributos, Perícias, Defesas, tabela de progressão de nível (1–30)
   - Classes mundanas (`CLASSES`) e subclasses (`SUBCLASSES`)
   - Ordens Radiantes e suas Surges (`RADIANT_CLASS_PERICIAS`)
   - Funções de carregamento assíncrono: `loadSkills()`, `loadRadiantSkills()`
   - IDs Radiantes usam offset `+10000` para evitar colisão com IDs mundanos

2. **`SkillRenderer`** (`js/renderer.js`) — Visualização 3D:
   - Three.js r152 (via CDN)
   - Nós esféricos com efeito "Stormlight sphere" (glow + clearcoat)
   - Linhas de conexão com partículas de fumaça
   - Raycasting para hover e clique nos nós
   - Mapa de cores por classe/ordem (`COLOR_MAP`)
   - Cache de texturas SVG para glifos das ordens

3. **`App`** (`js/app.js`) — Estado e lógica da aplicação:
   - Estado central: `profile`, `attributes`, `pericias`, `unlockedSkills`
   - Habilidades compartilhadas: IDs com mesmo nome desbloqueados automaticamente em todas as classes (`freeUnlockedSkills`)
   - Exportação PDF via `pdf-lib` (`App.exportToSheet()`)
   - Save/Load via `localStorage`; Export/Import via JSON

### Fluxo de Dados

```
JSON files (data/) → CosData.loadSkills() → CosData.SKILLS
                                           ↓
App (state) ← interação do usuário → SkillRenderer (3D view)
     ↓
localStorage (save/load)  |  PDF export (pdf-lib)  |  JSON export
```

---

## Sistema de Jogo (Mecânicas Implementadas)

### Progressão de Nível
- Níveis 1–30, divididos em 5 Patamares (Tiers)
- **Nível 1:** 12 pontos de atributo, 5 ranks de perícia, 1 talento + bônus de ancestralidade
- **Níveis 2–20:** pontos de atributo em níveis específicos, 2 ranks/nível, 1 talento/nível
- **Níveis 21–30:** apenas +1 HP por nível (sem novos pontos)

### Atributos (6)
`FOR`, `VEL`, `INT`, `VON`, `CON`, `PRE`
Cada par define uma Defesa: Física, Cognitiva, Espiritual (base 10 + atributos)

### Perícias (18 mundanas + 10 Surges Radiantes)
Limitadas por rank máximo conforme patamar (rank 2→3→4→5)

### Classes e Subclasses
- 6 classes mundanas, cada uma com 3 subclasses
- 9 Ordens Radiantes (Corredor dos Ventos, Rompe-Céu, Pulverizador, etc.)
- Ancestralidades: Humano (+1 talento nível 1) e Cantor

---

## Dados JSON — Estrutura Esperada

### `br_skills.json` (talentos mundanos)
```json
[
  {
    "id": 1,
    "name": "Nome do Talento",
    "cls": "Guerreiro",
    "sub": "Duelista",
    "rank": 1,
    "deps": ["Nome do Talento Pai"],
    "desc": "Descrição curta"
  }
]
```

### `br_radiant_paths.json` (talentos radiantes)
```json
[
  {
    "id": 1,
    "name": "Nome do Talento",
    "cls": "Corredor dos Ventos",
    "sub": "-",
    "rank": 0,
    "deps": [],
    "desc": "Descrição"
  }
]
```
> `rank: 0` = nó raiz da árvore. `deps` = lista de nomes dos pré-requisitos.

---

## Convenções de Código

- **Módulos como IIFEs** retornando objetos públicos — não usar ES Modules (`import`/`export`) para manter compatibilidade com servidor simples sem bundler
- **Sem framework** — vanilla JS, HTML, CSS puro
- **Sem build step** — editar os arquivos diretamente
- **Dados em pt-BR** — nomes de classes, habilidades e UI sempre em português
- **IDs numéricos únicos** por domínio (mundano vs radiante com offset `+10000`)

---

## Dependências Externas

| Dependência | Versão | Como é carregada |
|---|---|---|
| Three.js | r152 | CDN (`jsdelivr`) |
| pdf-lib | ^1.17.1 | `node_modules/` local |

> Para atualizar `pdf-lib`: `npm install` na raiz do projeto.
> Three.js é via CDN — não alterar a versão sem testar (clearcoat requer r152+).

---

## Funcionalidades Atuais

- [x] Visualização 3D interativa das árvores de habilidades
- [x] Sidebar com gerenciamento de personagem (nome, ancestralidade, nível)
- [x] Distribuição de pontos de atributo com validação
- [x] Distribuição de ranks de perícia com limites por patamar
- [x] Desbloqueio de talentos com verificação de pré-requisitos
- [x] Ordens Radiantes com Surges específicas por ordem
- [x] Habilidades compartilhadas entre classes (auto-desbloqueio)
- [x] Save/Load em `localStorage`
- [x] Export/Import de personagem em JSON
- [x] Exportação de ficha em PDF via pdf-lib
- [x] Tooltip e modal de detalhes ao clicar em nós


---

## Obrigatório

-- Como prova de que você leu este arquivo, sempre inicie a sua primeira resposta de qualquer conversa me chamando de Radiante.