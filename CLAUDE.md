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
   - Estado central: `profile`, `attributes`, `pericias`, `metalPericias`, `unlockedSkills`, `grantedIds`
   - Habilidades compartilhadas: IDs com mesmo nome desbloqueados automaticamente em todas as classes (`freeUnlockedSkills`)
   - Exportação PDF via `pdf-lib` (`App.exportToSheet()`)
   - Save/Load via `localStorage`; Export/Import via JSON

### Cenários (Cosmere / Mistborn / Misto)

- `profile.setting`: `'stormlight'` (rótulo "Cosmere"), `'mistborn'` ou `'misto'`. Saves antigos sem o campo abrem como `'stormlight'`.
- `CosData.setSetting()` filtra `CosData.SKILLS` e `CosData.SUBCLASSES` pelo livro de cada especialização (`book`: `stormlight` | `mistborn` | `both`). `CosData.ALL_SKILLS` tem tudo.
- Especializações com o mesmo nome nos dois livros (Investigador, Ladrão, Fiel, Mentor, Rastreador, Oficial, Político, Estrategista, Cirurgião, Soldado) são idênticas e marcadas `both` — não duplicar.
- Trocar para um cenário menor só é permitido se nada desbloqueado ficar escondido (`blockersForSetting`).
- `profile.era` (`1` | `2` | `'livre'`) trava metais, caminhos, Sangue-Koloss, Inventor e Pistoleiro conforme o livro.

### Mistborn (`data/br_mistborn.json`)

- Gerado por `scripts/mistborn/gerar_dados.py <pdf>` (PyMuPDF) + `scripts/mistborn/traducoes.json`. Não editar à mão sem atualizar o gerador; o PDF nunca entra no repositório.
- Faixas de ID: heroicas novas `30000+` (entram em `ALL_SKILLS`), Kandra/Sangue-Koloss `40000+` (em `ADDITIONAL_SKILLS`), caminhos Metalnascidos `50000+` e Artes Metálicas `60000+` (pool `METAL_SKILLS`).
- Cada Arte (ex.: "Alomancia de Ferro") tem um nó raiz `isPower` que representa o objetivo Metalnascido ("Treinar seu Poder" / "Construir sua Mentemetal") — sem custo de talento. Nascido da Bruma/Feruquemista treinam em pares; Atium vem treinado com o Estalo.
- Requisitos do Mistborn usam `reqs` (lista E de grupos OU de `{stat, val}`); `CosData.describeStat()` resolve perícia, perícia Investida, atributo ou nível.
- `profile.metalborn = { path, allo: [metal], feru: [metal], locked }` — escolhido na Tabela Metálica; trava ao comprar o talento-chave.
- Renderer: `nodeStyleFor(cls)` decide gema (Stormlight) × moeda (Mistborn); `setTheme()` troca fundo (tempestade × cinzas e bruma). Todas as trilhas usam a constelação (`computeLayout`); nas moedas a curva e a distância são mais regulares e a relaxação mais forte. Na visão "Todas", árvores de moeda ficam em tamanho natural com leque mais fechado e cada árvore recebe uma fatia do anel proporcional à sua largura angular real; o raio é o menor em que todas cabem e a sobra é dividida igualmente entre os vãos. Face das moedas: `svg/Mistborn/Moeda_Frente.svg` (talentos-chave) e `Moeda_Verso.svg` (demais). Os traços da moeda são engrossados ao carregar (`loadThickSvg`) e as texturas usam mipmaps/anisotropia (`smoothTexture`). Cada árvore de Arte Metálica tem o glifo do metal como marca d'água atrás do leque (`addTreeGlyph`). Os raios do centro acendem quando o talento-chave é comprado; o centro usa o símbolo do mundo (`svg/mundos`). Linhas bloqueadas das moedas levam a cor da própria árvore.
- `linkHeroicRoots()` (data.js) liga ao talento-chave os talentos de 1º nível com `deps` vazio.
- `buildMetalbornTree`: Nascido da Bruma/Feruquemista veem a Tabela dos Metais completa, com posições fixas em `TABLE_SLOTS` (externos no anel de fora, internos no de dentro, "puxar" do lado do eixo vertical — igual à tabela do livro); Brumoso, Ferroso e Duplonato usam o layout compacto (caminho embaixo, só os ramos acessíveis em cima).
- `PdfExtractor` detecta livro (Stormlight/Mistborn) e idioma (pt/en) e guarda um registro por livro em `localStorage['cosmere_books_v2']` — vários livros convivem, cada um removível. O Mistborn Handbook em inglês casa pelos nomes `en`/`aliasEn`; descrições pt-BR têm prioridade quando existem nos dois.
- Habilidades básicas (fora das árvores): `extractBasics` tira do PDF as regras de cada fluxo (`fluxo:<chave>`, "Fluxo da X" até "Usando X") e de cada poder metálico (`allo:<metal>`/`feru:<metal>`, cabeçalho da arte até "Using X"), além dos exemplos da tabela de poderes nascentes (`nascente:<arte>:<metal>`). Ficam em `basics` de cada livro no localStorage; `PdfExtractor.getBasicAbility(id)` lê. `getBasicAbilities()` (app.js) decide quem tem o quê: surtos com graduação ≥ 1; metais das árvores acessíveis após o talento-chave Metalnascido, nascentes até o objetivo (Atium já completo). A ficha em PDF lista tudo em "Habilidades Básicas".
- Backup pessoal (`exportBackup`/`importBackup`, JSON `cosmere-builder-descricoes`) leva as descrições a outro aparelho sem o PDF. **Nunca** versionar/publicar descrições dos livros nem gerar traduções delas: o texto é da Dragonsteel/Brotherwise; o repositório guarda só estrutura (nomes, pré-requisitos).
- Tradução automática (`translateBook`): o botão "Traduzir" num livro em inglês usa a Translator API do navegador (no aparelho, en→pt) e grava `<livro>-pt-auto` no localStorage; o glossário troca termos do jogo pelos nomes do site antes de traduzir. Ordem de aplicação: en → pt-auto → pt oficial; o original fica em `skill.descriptionOriginal` (modal mostra "ver original").

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
- [x] Cenários Cosmere / Mistborn / Misto na criação do personagem (ampliável depois)
- [x] Mistborn Handbook: especializações novas, Kandra, Sangue-Koloss, caminhos Metalnascidos e 34 árvores de Artes Metálicas
- [x] Tabela Metálica (escolha de caminho e metais) e estilo 3D próprio do Mistborn
- [x] Tela inicial (escolha de cenário + carregar/importar) acessível pelo botão de casa; arte das ancestralidades nos cards e no retrato padrão (`assets/thumbs/*.jpg`, geradas dos PNGs de `assets/`)


---

## Obrigatório

-- Como prova de que você leu este arquivo, sempre inicie a sua primeira resposta de qualquer conversa me chamando de Radiante.