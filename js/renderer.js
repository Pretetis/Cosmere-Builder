// ============================================================
// Cosmere RPG Skill Tree - Three.js 3D Renderer
// Stormlight sphere nodes with smoke-trail connections
// ============================================================

const SkillRenderer = (() => {

  // --- Three.js globals ---
  let scene, camera, renderer, clock;
  let _container;
  let mainGroup;          // holds all nodes + lines
  let raycaster, mouse;
  let hoveredNode = null;
  let nodeObjects = [];   // { mesh, skill, glowMesh, pos }
  let lineObjects = [];   // { line, from, to }
  let smokeParticles = [];
  let currentClass = null;
  let animFrame = null;

  // View configuration (multipliers applied to glow/line opacity; sub labels toggle)
  const _config = { nodeGlow: 1.0, lineOpacity: 1.0, showSubLabels: false, glassOpacity: 0.3, gemColorOverride: null };

  // callbacks
  let onNodeHover     = null;
  let onNodeClick     = null;
  let onHoverEnd      = null;
  let onNodeLongPress = null;

  // --- CONSTANTS ---
  const NODE_RADIUS        = 0.28;
  const RANK_Y_SPACING     = 2.8;
  const CAMERA_DISTANCE    = 18;
  const CAMERA_TILT        = 0.3;   // radians (~17 degrees)

  const COLOR_MAP = {
    // Classes base
    'Agente':                    0x4ade80,
    'Emissário':                 0xfacc15,
    'Caçador':                   0xf87171,
    'Líder':                     0x60a5fa,
    'Erudito':                   0xa78bfa,
    'Guerreiro':                 0xfb923c,
    // Ordens Radiantes
    'Corredor dos Ventos':       0x38bdf8,  // azul-céu
    'Rompe-Céu':                 0xfbbf24,  // âmbar
    'Pulverizador':              0xef4444,  // vermelho-chama
    'Dançarino de Precipícios': 0x34d399,  // esmeralda
    'Sentinela da Verdade':      0x2dd4bf,  // água-marinha
    'Teceluz':                   0xf0abfc,  // lilás
    'Alternauta':                0xe2e8f0,  // prata
    'Plasmador':                 0xc084fc,  // roxo
    'Guardião das Pedras':       0xa87d4e,  // terracota
    // Ancestralidade
    'Cantor':                    0xe07b54,  // terracota-laranja
    // Scadrial
    'Kandra':                    0x6fbfa4,
    'Sangue-Koloss':             0x5b7fc7,
    'Brumoso':                   0x8fb4d8,
    'Nascido da Bruma':          0xc9d3e0,
    'Feruquemista':              0xd1a064,
    'Ferroso':                   0xc98b56,
    'Duplonato':                 0xa9a3d6,
  };

  // Cor de uma árvore: mapa fixo ou, para Artes Metálicas, a cor do próprio metal
  function treeColor(cls) {
    if (COLOR_MAP[cls] !== undefined) return COLOR_MAP[cls];
    const metal = CosData.getMetalOfTree && CosData.getMetalOfTree(cls);
    if (metal) return parseInt(metal.color.slice(1), 16);
    return 0xc084fc;
  }

  // ---- ESTILO MISTBORN ----
  // Tema do cenário: 'stormlight' (gemas + tempestade), 'mistborn' (moedas + cinzas e bruma), 'misto'
  let _theme = 'stormlight';
  let _bgStorm = null, _bgAsh = null;
  const _bgMist = [];
  let _ambientLight = null, _keyLight = null;
  let _envMap = null;
  let _lineGlowTexture = null;
  const _coinFaceCache = {};

  const COIN_LOCKED   = 0x6b6d76;
  const ALLO_LINE     = 0x7cc4ff; // linhas azuis que um Alomântico vê ao queimar ferro/aço
  const FERU_LINE     = 0xe0955a; // cobre das mentemetais
  const ASH_LINE      = 0x9fb3c8;

  // Árvores desenhadas como moedas: Artes Metálicas, caminhos Metalnascidos,
  // Kandra/Sangue-Koloss e — no cenário Mistborn — as trilhas heroicas.
  function nodeStyleFor(cls) {
    if (CosData.METAL_CLASSES && CosData.METAL_CLASSES.includes(cls)) return 'metal';
    if (CosData.MISTBORN_ANCESTRY_CLASSES && CosData.MISTBORN_ANCESTRY_CLASSES.includes(cls)) return 'metal';
    if (_theme === 'mistborn' && CosData.CLASSES.includes(cls)) return 'metal';
    return 'gem';
  }

  function lerpHex(a, b, t) {
    const ca = new THREE.Color(a), cb = new THREE.Color(b);
    return ca.lerp(cb, t).getHex();
  }

  // Mapa de ambiente procedural — dá brilho metálico às moedas sem assets externos
  function getEnvMap() {
    if (_envMap || !renderer) return _envMap;
    const c = document.createElement('canvas');
    c.width = 256; c.height = 128;
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0,    '#cfd6e0');
    g.addColorStop(0.35, '#6b6f78');
    g.addColorStop(0.55, '#2a2a30');
    g.addColorStop(1,    '#151418');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 128);
    // "sol vermelho" e janelas de luz para reflexos
    const sun = ctx.createRadialGradient(70, 30, 2, 70, 30, 40);
    sun.addColorStop(0, 'rgba(255,190,140,1)');
    sun.addColorStop(1, 'rgba(255,120,80,0)');
    ctx.fillStyle = sun;
    ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(170, 18, 40, 10);
    const tex = new THREE.CanvasTexture(c);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    const pmrem = new THREE.PMREMGenerator(renderer);
    _envMap = pmrem.fromEquirectangular(tex).texture;
    tex.dispose();
    pmrem.dispose();
    return _envMap;
  }

  // Textura do brilho das linhas alomânticas (claro no centro, some nas bordas)
  function getLineGlowTexture() {
    if (_lineGlowTexture) return _lineGlowTexture;
    const c = document.createElement('canvas');
    c.width = 4; c.height = 64;
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, 64);
    g.addColorStop(0,   'rgba(255,255,255,0)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.35)');
    g.addColorStop(0.5, 'rgba(255,255,255,1)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.35)');
    g.addColorStop(1,   'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 4, 64);
    _lineGlowTexture = new THREE.CanvasTexture(c);
    return _lineGlowTexture;
  }

  // Arte da moeda padrão de Scadrial (recortada de Metals/Moeda_Frente_Verso.svg)
  const COIN_ART = { front: 'svg/Mistborn/Moeda_Frente.svg', back: 'svg/Mistborn/Moeda_Verso.svg' };
  const _imgCache = {};
  function loadImage(src) {
    if (!_imgCache[src]) {
      _imgCache[src] = new Promise(res => {
        const img = new Image();
        img.onload = () => res(img);
        img.onerror = () => res(null);
        img.src = src;
      });
    }
    return _imgCache[src];
  }

  // A arte da moeda tem traços finos demais para uma moeda pequena na tela:
  // engrossa todos os stroke-width antes de rasterizar
  function loadThickSvg(src, factor) {
    const key = src + '@' + factor;
    if (!_imgCache[key]) {
      _imgCache[key] = fetch(src).then(r => r.text()).then(text => {
        const thick = text.replace(/stroke-width\s*:\s*([\d.]+)/g, (_, w) => `stroke-width:${(parseFloat(w) * factor).toFixed(3)}`)
                          .replace(/stroke-width="([\d.]+)"/g, (_, w) => `stroke-width="${(parseFloat(w) * factor).toFixed(3)}"`);
        const url = URL.createObjectURL(new Blob([thick], { type: 'image/svg+xml' }));
        return new Promise(res => {
          const img = new Image();
          img.onload = () => res(img);
          img.onerror = () => res(null);
          img.src = url;
        });
      }).catch(() => null);
    }
    return _imgCache[key];
  }

  // Glifo do metal como marca d'água atrás da árvore dele (textura branca; a cor vem do sprite)
  const _glyphBgCache = {};
  function getGlyphBgTexture(svg) {
    if (_glyphBgCache[svg]) return _glyphBgCache[svg];
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const tex = smoothTexture(new THREE.CanvasTexture(canvas));
    _glyphBgCache[svg] = tex;
    loadImage(svg).then(img => {
      if (!img) return;
      drawEngraving(canvas.getContext('2d'), img, 0, 0, size, size);
      tex.needsUpdate = true;
    });
    return tex;
  }

  function addTreeGlyph(cls, pts) {
    const metal = CosData.getMetalOfTree && CosData.getMetalOfTree(cls);
    pts = pts.filter(Boolean);
    if (!metal || !pts.length) return;
    const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
    const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
    const ext = Math.max(...pts.map(p => Math.hypot(p.x - cx, p.y - cy)));
    const size = Math.min(7, Math.max(2.6, ext * 2.0)); // do tamanho do leque, sem invadir muito os vizinhos
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: getGlyphBgTexture(metal.svg),
      color: parseInt(metal.color.slice(1), 16),
      transparent: true,
      opacity: 0.24,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));
    sprite.position.set(cx, cy, -0.4);
    sprite.scale.set(size, size, 1);
    mainGroup.add(sprite);
  }

  // Mipmaps + anisotropia: a gravação encolhe sem serrilhar nem "piscar"
  function smoothTexture(tex) {
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    if (renderer) tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return tex;
  }

  // Desenha uma imagem de traço preto como gravação branca (a cor vem do material)
  function drawEngraving(ctx, img, x, y, w, h) {
    const off = document.createElement('canvas');
    off.width = ctx.canvas.width; off.height = ctx.canvas.height;
    const octx = off.getContext('2d');
    octx.drawImage(img, x, y, w, h);
    octx.globalCompositeOperation = 'source-in';
    octx.fillStyle = '#ffffff';
    octx.fillRect(0, 0, off.width, off.height);
    ctx.drawImage(off, 0, 0);
  }

  // Face gravada da moeda:
  //  - talentos-chave/raízes (rank 0, fora das Artes): frente da moeda de Scadrial;
  //  - demais: verso da moeda com o glifo do metal (Artes Metálicas) ou marcas de rank no centro.
  function getCoinFaceTexture(skill, cls) {
    const metal = CosData.getMetalOfTree && CosData.getMetalOfTree(cls);
    const front = skill.rank === 0 && !metal;
    const key = front ? 'front' : 'back:' + (metal ? metal.svg + (skill.isPower ? ':power' : '') : 'rank' + skill.rank);
    if (_coinFaceCache[key]) return _coinFaceCache[key];

    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    const tex = smoothTexture(new THREE.CanvasTexture(canvas));
    _coinFaceCache[key] = tex;

    (async () => {
      const coin = await loadThickSvg(front ? COIN_ART.front : COIN_ART.back, 2.2);
      if (coin) drawEngraving(ctx, coin, 0, 0, size, size);
      if (!front) {
        if (metal) {
          const glyph = await loadImage(metal.svg);
          const g = skill.isPower ? 0.56 : 0.44; // o poder ganha o glifo maior
          if (glyph) drawEngraving(ctx, glyph, size * (1 - g) / 2, size * (1 - g) / 2, size * g, size * g);
        } else {
          // Marcas de rank no centro livre do verso
          ctx.fillStyle = '#ffffff';
          const n = Math.max(1, skill.rank);
          const gap = 74;
          for (let i = 0; i < n; i++) {
            ctx.beginPath();
            ctx.arc(size / 2 + (i - (n - 1) / 2) * gap, size / 2, 27, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      tex.needsUpdate = true;
    })();
    return tex;
  }

  const COLOR_LOCKED    = 0x3a3845;
  const COLOR_UNLOCKED  = 0xd4a853;

  // Cached glow texture (generated once)
  let _glowTexture = null;
  let _smokeTexture = null;
  // Cached SVG textures (keyed by file path, loaded once each)
  const _svgTextureCache = {};

  // Radiant class → SVG glyph path
  const RADIANT_SVG_MAP = {
    'Corredor dos Ventos':       'svg/Windrunners_glyph.svg',
    'Rompe-Céu':                 'svg/Skybreakers_glyph.svg',
    'Pulverizador':              'svg/Dustbringers_glyph.svg',
    'Dançarino de Precipícios': 'svg/Edgedancers_glyph.svg',
    'Sentinela da Verdade':      'svg/Truthwatchers_glyph.svg',
    'Teceluz':                   'svg/Lightweavers_glyph.svg',
    'Alternauta':                'svg/elsecallers_glyph.svg',
    'Plasmador':                 'svg/Willshapers_glyph.svg',
    'Guardião das Pedras':       'svg/Stonewards_glyph.svg',
  };
  function getGlowTexture() {
    if (_glowTexture) return _glowTexture;
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const half = size / 2;
    const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
    gradient.addColorStop(0,   'rgba(255,255,255,1)');
    gradient.addColorStop(0.15,'rgba(255,255,255,0.6)');
    gradient.addColorStop(0.4, 'rgba(255,255,255,0.15)');
    gradient.addColorStop(0.7, 'rgba(255,255,255,0.03)');
    gradient.addColorStop(1,   'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    _glowTexture = new THREE.CanvasTexture(canvas);
    return _glowTexture;
  }

  // Textura de fumaça — falloff mais suave e difuso que o glow
  function getSmokeTexture() {
    if (_smokeTexture) return _smokeTexture;
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    const half = size / 2;
    const g = ctx.createRadialGradient(half, half, 0, half, half, half);
    g.addColorStop(0,    'rgba(255,255,255,0.9)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.18)');
    g.addColorStop(0.8,  'rgba(255,255,255,0.04)');
    g.addColorStop(1,    'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    _smokeTexture = new THREE.CanvasTexture(canvas);
    return _smokeTexture;
  }

  // ---- INIT ----
  function init(container) {
    _container = container;
    clock = new THREE.Clock();

    // Scene
    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0a0b10, 0.02);

    // Renderer first (so it's in DOM for size calc)
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setClearColor(0x0a0b10, 1);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    // Now measure actual canvas area
    const rect = renderer.domElement.getBoundingClientRect();
    const w = rect.width || container.clientWidth;
    const h = rect.height || (container.clientHeight - 42);
    renderer.setSize(w, h);

    // Camera - perspective with slight tilt for 2.5D feel
    camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 200);
    camera.position.set(0, -2, CAMERA_DISTANCE);
    camera.rotation.x = CAMERA_TILT;

    // Main group
    mainGroup = new THREE.Group();
    mainGroup.rotation.x = -CAMERA_TILT * 0.3;
    scene.add(mainGroup);

    // Lights
    const ambient = new THREE.AmbientLight(0x223355, 0.6);
    scene.add(ambient);
    const point = new THREE.PointLight(0x4a9eff, 1.5, 50);
    point.position.set(0, 5, 10);
    scene.add(point);
    _ambientLight = ambient;
    _keyLight = point;

    // Background particles (storm dust) + cinzas e bruma de Scadrial
    createBackgroundParticles();
    createAshParticles();
    createMistLayer();
    setTheme(_theme);

    // Raycaster
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2(-999, -999);

    // Events
    container.addEventListener('mousemove', onMouseMove);
    container.addEventListener('click', onMouseClick);
    window.addEventListener('resize', onResize);

    // Pan / zoom
    let isDragging = false, dragStart = { x:0, y:0 }, groupStart = { x:0, y:0 };
    container.addEventListener('mousedown', e => {
      if (e.target.tagName !== 'CANVAS') return;
      isDragging = true;
      dragStart = { x: e.clientX, y: e.clientY };
      groupStart = { x: mainGroup.position.x, y: mainGroup.position.y };
    });
    container.addEventListener('mousemove', e => {
      if (!isDragging) return;
      const dx = (e.clientX - dragStart.x) * 0.02;
      const dy = -(e.clientY - dragStart.y) * 0.02;
      mainGroup.position.x = groupStart.x + dx;
      mainGroup.position.y = groupStart.y + dy;
    });
    container.addEventListener('mouseup', () => isDragging = false);
    container.addEventListener('mouseleave', () => isDragging = false);
    container.addEventListener('wheel', e => {
      if (e.target.tagName !== 'CANVAS') return;
      e.preventDefault();
      const zoomMax = _viewMode !== 'single' ? 95 : 55;
      const zoomMin = _viewMode !== 'single' ? 10 : 5;
      camera.position.z = Math.max(zoomMin, Math.min(zoomMax, camera.position.z + e.deltaY * 0.03));
    }, { passive: false });

    // Touch support: single-finger pan + pinch-to-zoom + tap to click + long-press para tooltip
    const _touch = { dragging: false, pinching: false, lastDist: 0, startX: 0, startY: 0, lastX: 0, lastY: 0, movedPx: 0, longPressFired: false };
    let _longPressTimer = null;
    const LONG_PRESS_MS = 450;

    function _touchDist(e) {
      return Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    }
    container.addEventListener('touchstart', e => {
      if (e.target.tagName !== 'CANVAS') return;
      e.preventDefault();
      if (e.touches.length === 1) {
        _touch.dragging = true; _touch.pinching = false;
        _touch.startX = _touch.lastX = e.touches[0].clientX;
        _touch.startY = _touch.lastY = e.touches[0].clientY;
        _touch.movedPx = 0;
        _touch.longPressFired = false;

        // Inicia timer de long-press
        clearTimeout(_longPressTimer);
        _longPressTimer = setTimeout(() => {
          _longPressTimer = null;
          if (_touch.movedPx > 8) return;
          const rect = renderer.domElement.getBoundingClientRect();
          mouse.x = ((_touch.startX - rect.left) / rect.width) * 2 - 1;
          mouse.y = -((_touch.startY - rect.top) / rect.height) * 2 + 1;
          raycaster.setFromCamera(mouse, camera);
          const meshes = nodeObjects.flatMap(n => [n.mesh, n.crystalMesh]);
          const intersects = raycaster.intersectObjects(meshes);
          if (intersects.length > 0) {
            const hit = intersects[0].object;
            const nodeObj = nodeObjects.find(n => n.mesh === hit || n.crystalMesh === hit);
            if (nodeObj && onNodeLongPress) {
              _touch.longPressFired = true;
              _touch.dragging = false;
              onNodeLongPress(nodeObj.skill, _touch.startX, _touch.startY);
            }
          }
        }, LONG_PRESS_MS);

      } else if (e.touches.length === 2) {
        clearTimeout(_longPressTimer); _longPressTimer = null;
        _touch.pinching = true; _touch.dragging = false;
        _touch.lastDist = _touchDist(e);
      }
    }, { passive: false });
    container.addEventListener('touchmove', e => {
      if (e.target.tagName !== 'CANVAS') return;
      e.preventDefault();
      if (e.touches.length === 1 && _touch.dragging) {
        // Pan incremental: fator proporcional ao zoom para manter 1:1 com o dedo
        const tanHalf = Math.tan(camera.fov * Math.PI / 360);
        const rect = container.getBoundingClientRect();
        const unitsPerPixel = 2 * camera.position.z * tanHalf / rect.height;
        const cx = e.touches[0].clientX, cy = e.touches[0].clientY;
        mainGroup.position.x += (cx - _touch.lastX) * unitsPerPixel;
        mainGroup.position.y -= (cy - _touch.lastY) * unitsPerPixel;
        _touch.movedPx += Math.hypot(cx - _touch.lastX, cy - _touch.lastY);
        _touch.lastX = cx; _touch.lastY = cy;
        // Cancela long-press se o dedo moveu
        if (_touch.movedPx > 8 && _longPressTimer) {
          clearTimeout(_longPressTimer); _longPressTimer = null;
        }
      } else if (e.touches.length === 2 && _touch.pinching) {
        const dist = _touchDist(e);
        const delta = _touch.lastDist - dist;
        _touch.lastDist = dist;
        const z1 = camera.position.z;
        const zoomMax = _viewMode !== 'single' ? 95 : 55;
        const zoomMin = _viewMode !== 'single' ? 10 : 5;
        const z2 = Math.max(zoomMin, Math.min(zoomMax, z1 + delta * 0.12));
        // Zoom em direção ao ponto médio da pinça
        const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        const rect = container.getBoundingClientRect();
        const ndcX = (mx - rect.left) / rect.width - 0.5;   // -0.5 a +0.5
        const ndcY = 0.5 - (my - rect.top) / rect.height;
        const tanHalf = Math.tan(camera.fov * Math.PI / 360);
        mainGroup.position.x += ndcX * 2 * tanHalf * camera.aspect * (z1 - z2);
        mainGroup.position.y += ndcY * 2 * tanHalf * (z1 - z2);
        camera.position.z = z2;
      }
    }, { passive: false });
    container.addEventListener('touchend', e => {
      if (e.target.tagName !== 'CANVAS') return;
      // Sempre cancela o timer de long-press ao levantar o dedo
      clearTimeout(_longPressTimer); _longPressTimer = null;

      if (e.touches.length === 0) {
        if (_touch.dragging && _touch.movedPx < 10 && !_touch.longPressFired) {
          // Tap curto: abre modal de compra/detalhes
          const rect = renderer.domElement.getBoundingClientRect();
          const t = e.changedTouches[0];
          mouse.x = ((t.clientX - rect.left) / rect.width) * 2 - 1;
          mouse.y = -((t.clientY - rect.top) / rect.height) * 2 + 1;
          raycaster.setFromCamera(mouse, camera);
          const meshes = nodeObjects.flatMap(n => [n.mesh, n.crystalMesh]);
          const intersects = raycaster.intersectObjects(meshes);
          if (intersects.length > 0) {
            const hit = intersects[0].object;
            const nodeObj = nodeObjects.find(n => n.mesh === hit || n.crystalMesh === hit);
            if (nodeObj && onNodeClick) onNodeClick(nodeObj.skill, e);
          } else {
            // Toque em área vazia: esconde tooltip se visível
            if (onHoverEnd) onHoverEnd();
          }
        }
        _touch.dragging = false; _touch.pinching = false; _touch.longPressFired = false;
      } else if (e.touches.length === 1) {
        // Saiu de 2 dedos para 1: retoma pan
        _touch.pinching = false; _touch.dragging = true;
        _touch.startX = _touch.lastX = e.touches[0].clientX;
        _touch.startY = _touch.lastY = e.touches[0].clientY;
        _touch.movedPx = 0;
      }
    }, { passive: false });

    // Start loop
    animate();
  }

  function onResize() {
    const rect = renderer.domElement.parentElement.getBoundingClientRect();
    const tabs = _container.querySelector('.class-tabs');
    const tabH = tabs ? tabs.offsetHeight : 42;
    const w = rect.width;
    const h = rect.height - tabH;
    if (w <= 0 || h <= 0) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }

  function onMouseMove(e) {
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  function onMouseClick(e) {
    if (hoveredNode && onNodeClick) {
      onNodeClick(hoveredNode.skill, e);
    }
  }

  // ---- BACKGROUND PARTICLES ----
  function createBackgroundParticles() {
    const count = 300;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      positions[i*3]   = (Math.random() - 0.5) * 60;
      positions[i*3+1] = (Math.random() - 0.5) * 40;
      positions[i*3+2] = (Math.random() - 0.5) * 20 - 5;
      sizes[i] = Math.random() * 2 + 0.5;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    const mat = new THREE.PointsMaterial({
      color: 0x4a9eff,
      size: 0.08,
      transparent: true,
      opacity: 0.3,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const points = new THREE.Points(geo, mat);
    scene.add(points);

    points.userData.speeds = Array.from({length: count}, () => Math.random() * 0.2 + 0.05);
    points.userData.type = 'bgParticles';
    _bgStorm = points;
  }

  // Cinzas caindo dos montes de cinza de Scadrial (descem devagar, balançando)
  function createAshParticles() {
    const count = 420;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i*3]   = (Math.random() - 0.5) * 70;
      positions[i*3+1] = (Math.random() - 0.5) * 44;
      positions[i*3+2] = (Math.random() - 0.5) * 22 - 4;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0x8d8a86,
      size: 0.11,
      map: getSmokeTexture(),
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    const points = new THREE.Points(geo, mat);
    points.userData.type = 'ash';
    points.userData.speeds = Array.from({ length: count }, () => Math.random() * 0.35 + 0.12);
    points.userData.phase  = Array.from({ length: count }, () => Math.random() * Math.PI * 2);
    points.visible = false;
    scene.add(points);
    _bgAsh = points;
  }

  // Bruma: grandes véus translúcidos que deslizam lentamente pela cena
  function createMistLayer() {
    for (let i = 0; i < 16; i++) {
      const mat = new THREE.SpriteMaterial({
        map: getSmokeTexture(),
        color: 0xaeb8c4,
        transparent: true,
        opacity: 0.035 + Math.random() * 0.035,
        depthWrite: false,
      });
      const s = new THREE.Sprite(mat);
      const sc = 14 + Math.random() * 16;
      s.scale.set(sc * 1.8, sc, 1);
      s.position.set((Math.random() - 0.5) * 70, (Math.random() - 0.5) * 36, -6 - Math.random() * 10);
      s.userData = { drift: (Math.random() * 0.6 + 0.25) * (Math.random() < 0.5 ? -1 : 1), bob: Math.random() * Math.PI * 2, baseOpacity: mat.opacity };
      s.visible = false;
      scene.add(s);
      _bgMist.push(s);
    }
  }

  function setTheme(theme) {
    _theme = theme || 'stormlight';
    if (!scene) return;
    const mist = _theme === 'mistborn';
    renderer.setClearColor(mist ? 0x0e0c0e : 0x0a0b10, 1);
    scene.fog = new THREE.FogExp2(mist ? 0x14100f : 0x0a0b10, 0.02);
    if (_bgStorm) _bgStorm.visible = _theme !== 'mistborn';
    if (_bgAsh)   _bgAsh.visible   = _theme !== 'stormlight';
    for (const m of _bgMist) m.visible = _theme !== 'stormlight';
    if (_ambientLight) _ambientLight.color.set(mist ? 0x4a3a3a : 0x223355);
    if (_keyLight)     _keyLight.color.set(mist ? 0xffa27a : 0x4a9eff);
  }
  function getTheme() { return _theme; }

  // ---- BUILD TREE FOR A CLASS ----
  // keepView: if true, preserves current pan/zoom position
  let _canUnlockFn = null; // stored for updateStates + animation

  function buildTree(cls, unlockedSkills, periciaValues, keepView, canUnlockFn) {
    currentClass = cls;
    _canUnlockFn = canUnlockFn || null;

    // Save view state before clearing
    const savedPos = keepView && mainGroup ? { x: mainGroup.position.x, y: mainGroup.position.y } : null;
    const savedZoom = keepView && camera ? camera.position.z : null;

    clearTree();

    const { skills, children } = CosData.buildGraph(cls);
    const root = CosData.getRootSkill(cls);
    if (!root) return;

    // Compute layout positions
    const positions = computeLayout(cls, skills, children, root);

    // Create nodes
    for (const skill of skills) {
      const pos = positions[skill.id];
      if (!pos) continue;
      const isUnlocked = unlockedSkills.has(skill.id);
      const canUnlock = !isUnlocked && _canUnlockFn ? _canUnlockFn(skill) : false;
      createNode(skill, pos, isUnlocked, canUnlock, cls, periciaValues);
    }

    // Create connections
    for (const skill of skills) {
      const posTo = positions[skill.id];
      if (!posTo) continue;
      for (const depName of skill.deps) {
        const parent = CosData.findSkillByName(depName, cls, skill.sub);
        if (parent && positions[parent.id]) {
          createConnection(positions[parent.id], posTo, skill, parent, unlockedSkills, cls);
        }
      }
    }

    addSubLabels(cls, skills, positions, CosData.SUBCLASSES[cls]);

    // Restore or center camera
    if (savedPos) {
      mainGroup.position.x = savedPos.x;
      mainGroup.position.y = savedPos.y;
      camera.position.z = savedZoom;
    } else {
      centerCamera(positions);
    }
  }

  // ---- ORGANIC / CONSTELLATION LAYOUT ----
  // Seeded PRNG for deterministic "random" positions per class
  function seededRng(seed) {
    let s = seed;
    return function() {
      s = (s * 16807 + 0) % 2147483647;
      return (s - 1) / 2147483646;
    };
  }

  function classToSeed(cls) {
    let h = 0;
    for (let i = 0; i < cls.length; i++) h = (h * 31 + cls.charCodeAt(i)) | 0;
    return Math.abs(h) + 1;
  }

  // baseAngle: outward direction (radians). undefined = default single-view (fan upward)
  // maxLocalRadius: if set, clamps nodes to this distance from origin (used in all-view)
  function computeLayout(cls, skills, childrenMap, root, baseAngle, maxLocalRadius) {
    const positions = {};
    const isMetalTree = CosData.METAL_CLASSES && CosData.METAL_CLASSES.includes(cls);
    const isHeroicTree = CosData.CLASSES.includes(cls);
    const subs = isMetalTree ? [cls]
      : (CosData.SUBCLASSES[cls] || CosData.RADIANT_SUBCLASSES[cls] || CosData.ADDITIONAL_SUBCLASSES[cls] || []);
    // Moedas são opacas: sobreposição aparece mais que nas gemas de vidro, então a
    // constelação delas relaxa com mais força e encolhe por inteiro na visão "Todas"
    const coinTree = nodeStyleFor(cls) === 'metal';
    const rng = seededRng(classToSeed(cls));
    const subCount = subs.length;

    // Root at center
    positions[root.id] = { x: 0, y: 0, z: 0 };

    // When baseAngle is given (all-view), radiate away from circle center.
    // Otherwise fan upward for single-view.
    const arcCenter = baseAngle !== undefined ? baseAngle : Math.PI / 2;
    // Moedas na visão "Todas": leque mais fechado (especializações mais juntas),
    // a árvore cresce para fora em vez de para os lados
    const arcSpan   = Math.PI * (coinTree && baseAngle !== undefined ? 0.46 : 0.68);
    const arcStart  = arcCenter - arcSpan / 2;
    const arcTotal  = arcSpan;
    const subAngles = [];
    for (let i = 0; i < subCount; i++) {
      const t = subCount === 1 ? 0.5 : i / (subCount - 1);
      subAngles.push(arcStart + t * arcTotal);
    }

    // edges collected during BFS for node-to-edge repulsion
    const layoutEdges = [];

    subs.forEach((sub, subIdx) => {
      const subSkills = skills.filter(s => s.sub === sub);
      const branchAngle = subAngles[subIdx];

      const rank1Skills = subSkills.filter(s => s.rank === 1);

      rank1Skills.forEach((r1, branchIdx) => {
        // Offset each rank1 branch slightly from the main direction
        const branchSpread = coinTree ? 0.3 : 0.35;
        const offsetAngle = branchAngle +
          (branchIdx - (rank1Skills.length - 1) / 2) * branchSpread;

        // BFS along this branch — parentAngle accumulates per step for organic curves
        const queue = [{ skill: r1, parentX: 0, parentY: 0, depth: 1, parentAngle: offsetAngle, parentId: root.id }];
        const visited = new Set();

        while (queue.length > 0) {
          const { skill, parentX, parentY, depth, parentAngle, parentId } = queue.shift();
          if (visited.has(skill.id)) continue;
          visited.add(skill.id);

          // Distance from parent with slight variation
          // Moedas: distância e curva mais regulares, para os galhos terem o mesmo espaçamento
          const dist = RANK_Y_SPACING * (coinTree ? 0.95 + rng() * 0.1 : 0.85 + rng() * 0.3);

          // Organic wobble: deviate from PARENT'S actual direction (accumulated),
          // with a gentle pull back toward the branch origin to avoid full U-turns
          const wobble = (rng() - 0.5) * (coinTree ? 0.45 : 0.9);
          const pullBack = (offsetAngle - parentAngle) * 0.1;
          const angle = parentAngle + wobble + pullBack;

          let x = parentX + Math.cos(angle) * dist;
          let y = parentY + Math.sin(angle) * dist;
          const z = (rng() - 0.5) * 0.4;

          // Clamp to max radius (all-view: keeps tree within its sector)
          if (maxLocalRadius !== undefined && !coinTree) {
            const r = Math.sqrt(x * x + y * y);
            if (r > maxLocalRadius) { x *= maxLocalRadius / r; y *= maxLocalRadius / r; }
          }

          positions[skill.id] = { x, y, z };
          layoutEdges.push({ aId: parentId, bId: skill.id });

          // Trilhas heroicas indexam filhos por id (nomes repetidos entre especializações)
          const kids = childrenMap[skill.id] || childrenMap[skill.name] || [];
          const validKids = kids.filter(k => !visited.has(k.id) && (!isHeroicTree || k.sub === sub));

          if (validKids.length === 1) {
            queue.push({ skill: validKids[0], parentX: x, parentY: y, depth: depth + 1, parentAngle: angle, parentId: skill.id });
          } else if (validKids.length > 1) {
            // Fork: spread children from the current accumulated angle
            const forkSpread = 0.55;
            validKids.forEach((kid, kidIdx) => {
              const forkAngle = angle + (kidIdx - (validKids.length - 1) / 2) * forkSpread;
              queue.push({
                skill: kid,
                parentX: x, parentY: y,
                depth: depth + 1,
                parentAngle: forkAngle,
                parentId: skill.id,
              });
            });
          }
        }
      });
    });

    // Relaxation: push apart nodes that are too close (node-node) and
    // push nodes away from edges they don't belong to (node-edge)
    const allIds = Object.keys(positions);
    const minNodeDist = coinTree ? 2.1 : 1.8;
    const minEdgeDist = coinTree ? 1.75 : 1.6;
    const iterations  = coinTree ? 45 : 20;
    for (let iter = 0; iter < iterations; iter++) {
      // Node-to-node repulsion
      for (let i = 0; i < allIds.length; i++) {
        for (let j = i + 1; j < allIds.length; j++) {
          const a = positions[allIds[i]];
          const b = positions[allIds[j]];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < minNodeDist && d > 0.01) {
            const push = (minNodeDist - d) * 0.35;
            const nx = dx / d, ny = dy / d;
            if (allIds[i] != root.id) { a.x -= nx * push; a.y -= ny * push; }
            if (allIds[j] != root.id) { b.x += nx * push; b.y += ny * push; }
          }
        }
      }

      // Node-to-edge repulsion: push nodes away from lines they don't touch
      for (let i = 0; i < allIds.length; i++) {
        const nodeId = allIds[i];
        if (nodeId == root.id) continue;
        const node = positions[nodeId];

        for (const edge of layoutEdges) {
          // Skip edges that this node is an endpoint of
          if (edge.aId == nodeId || edge.bId == nodeId) continue;
          const a = positions[edge.aId];
          const b = positions[edge.bId];
          if (!a || !b) continue;

          // Closest point on segment a→b to node
          const abx = b.x - a.x, aby = b.y - a.y;
          const len2 = abx * abx + aby * aby;
          if (len2 < 0.001) continue;
          const t = Math.max(0, Math.min(1, ((node.x - a.x) * abx + (node.y - a.y) * aby) / len2));
          const cx = a.x + t * abx;
          const cy = a.y + t * aby;

          const dx = node.x - cx, dy = node.y - cy;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < minEdgeDist && d > 0.01) {
            const push = (minEdgeDist - d) * 0.4;
            const nx = dx / d, ny = dy / d;
            node.x += nx * push;
            node.y += ny * push;
          }
        }
      }
    }

    // Visão "Todas" com moedas: escala a constelação inteira em vez de achatar
    // cada nó contra a borda do setor (que empilhava moedas)
    if (coinTree && maxLocalRadius !== undefined) {
      const maxR = Math.max(0.01, ...Object.values(positions).map(p => Math.hypot(p.x, p.y)));
      if (maxR > maxLocalRadius) {
        const k = maxLocalRadius / maxR;
        for (const p of Object.values(positions)) { p.x *= k; p.y *= k; }
      }
    }

    return positions;
  }

  function centerCamera(positions) {
    const ids = Object.keys(positions);
    if (ids.length === 0) return;
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    for (const id of ids) {
      const p = positions[id];
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const cx = (minX + maxX) / 2;
    // Place root (minY) slightly below screen center so tree grows upward
    const cy = minY + (maxY - minY) * 0.25;
    mainGroup.position.x = -cx;
    mainGroup.position.y = -cy;

    // Restore single-view camera state (tilt + y offset)
    mainGroup.rotation.x = -CAMERA_TILT * 0.3;
    camera.position.set(0, -2, CAMERA_DISTANCE);
    camera.rotation.x = CAMERA_TILT;
  }

  // ---- GEM GEOMETRY POR RANK ----
  // Mapeia rank → forma lapidada de gema do Cosmere
  // Rank 0: icosaedro (d20) — raiz da árvore
  // Rank 1: octaedro    — Diamante (bipirâmide)
  // Rank 2: dodecaedro  — Granada / Heliodro / Topázio
  // Rank 3: prisma hex  — Rubi / Quartzo Fumê / Zircão
  // Rank 4: tetraedro   — Ametista / Safira (cristal angular)
  // Rank 5: prisma oct  — Esmeralda (alongado, 8 faces)
  function getGemGeometry(rank, r) {
    switch (rank) {
      case 0:  return new THREE.IcosahedronGeometry(r, 0);
      case 1:  return new THREE.OctahedronGeometry(r, 0);
      case 2:  return new THREE.DodecahedronGeometry(r, 0);
      case 3:  return new THREE.CylinderGeometry(r * 0.65, r, r * 1.0, 6, 1);
      case 4:  return new THREE.TetrahedronGeometry(r * 1.15, 0);
      case 5:  return new THREE.CylinderGeometry(r * 0.72, r * 0.72, r * 2.2, 8, 1);
      default: return new THREE.IcosahedronGeometry(r, 0);
    }
  }

  // ---- CREATE NODE (Stormlight Sphere with inner Gemstone) ----
  // ---- CREATE NODE (Moeda metálica — estilo Mistborn) ----
  // Mantém a mesma interface dos nós-gema (mesh, crystalMesh, crystalMat, mat,
  // glowMesh, glowMat) para que hover, transições e updateStates funcionem igual.
  //   mesh        → a moeda (raycast)
  //   crystalMesh → a face gravada (filha da moeda)
  //   crystalMat  → material metálico da moeda (tem emissive)
  //   mat         → material da gravação
  // Bloqueadas continuam legíveis: metal claro puxado para a cor da árvore,
  // gravação visível e um leve brilho próprio (antes ficavam quase pretas).
  function coinColors(tint, isUnlocked, canUnlock) {
    return {
      coin:  isUnlocked ? tint : canUnlock ? lerpHex(tint, COIN_LOCKED, 0.3) : lerpHex(tint, COIN_LOCKED, 0.62),
      face:  isUnlocked ? lerpHex(tint, 0xffffff, 0.55) : canUnlock ? lerpHex(tint, 0xffffff, 0.35) : lerpHex(tint, 0xc8ccd4, 0.6),
      emissive: isUnlocked ? 0.30 : canUnlock ? 0.14 : 0.07,
      faceOpacity: isUnlocked ? 0.95 : canUnlock ? 0.9 : 0.75,
      coinOpacity: isUnlocked ? 1 : canUnlock ? 1 : 0.95,
    };
  }

  // Na visão "Todas" as árvores são reduzidas; as moedas encolhem junto
  let _coinScale = 1;

  function createMetalNode(skill, pos, isUnlocked, canUnlock, cls) {
    const base = treeColor(cls);
    // Trilhas heroicas no tema Mistborn ganham tom mais metálico
    const tint = (CosData.CLASSES.includes(cls)) ? lerpHex(base, 0xa7adb5, 0.35) : base;
    const isRoot = skill.rank === 0;
    const r = NODE_RADIUS * (isRoot ? 1.3 : 0.98) * _coinScale;
    const c = coinColors(tint, isUnlocked, canUnlock);

    const coinMat = new THREE.MeshStandardMaterial({
      color: c.coin,
      metalness: 0.9,
      roughness: isUnlocked ? 0.3 : canUnlock ? 0.4 : 0.48,
      envMap: getEnvMap(),
      envMapIntensity: isUnlocked ? 1.3 : canUnlock ? 1.0 : 0.85,
      emissive: new THREE.Color(tint).multiplyScalar(c.emissive),
      transparent: true,
      opacity: c.coinOpacity,
    });
    const coin = new THREE.Mesh(new THREE.CylinderGeometry(r, r, r * 0.26, 48, 1), coinMat);
    coin.rotation.x = Math.PI / 2;                 // face voltada para a câmera
    coin.rotation.z = (Math.random() - 0.5) * 0.3; // cada moeda levemente inclinada
    coin.position.set(pos.x, pos.y, pos.z);
    coin.renderOrder = 1;
    mainGroup.add(coin);

    // Aro saliente
    const rimMat = new THREE.MeshStandardMaterial({
      color: lerpHex(c.coin, 0xffffff, 0.15), metalness: 1, roughness: 0.25,
      envMap: getEnvMap(), envMapIntensity: 1.1, transparent: true, opacity: c.coinOpacity,
    });
    const rim = new THREE.Mesh(new THREE.TorusGeometry(r, r * 0.08, 8, 48), rimMat);
    rim.rotation.x = Math.PI / 2;
    coin.add(rim);

    // Face gravada (glifo do metal ou marcas de rank)
    const faceMat = new THREE.MeshBasicMaterial({
      map: getCoinFaceTexture(skill, cls),
      color: c.face,
      transparent: true,
      opacity: c.faceOpacity,
      depthWrite: false,
    });
    const face = new THREE.Mesh(new THREE.PlaneGeometry(r * 1.9, r * 1.9), faceMat);
    face.position.set(0, r * 0.14, 0);
    face.rotation.x = -Math.PI / 2;
    face.renderOrder = 2;
    coin.add(face);

    // Brilho de "queima" (mais baixo e quente que o das gemas)
    const glowMat = new THREE.SpriteMaterial({
      map: getGlowTexture(),
      color: tint,
      transparent: true,
      opacity: (isUnlocked ? 0.45 : canUnlock ? 0.2 : 0.09) * _config.nodeGlow,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const glowMesh = new THREE.Sprite(glowMat);
    const gs = (isUnlocked ? 1.9 : canUnlock ? 1.3 : 1.0) * (isRoot ? 1.35 : 1) * _coinScale;
    glowMesh.scale.set(gs, gs, 1);
    glowMesh.position.set(pos.x, pos.y, pos.z - 0.05);
    mainGroup.add(glowMesh);

    coin.userData = { skill, isUnlocked, canUnlock };
    const obj = {
      mesh: coin, skill, glowMesh, crystalMesh: face, crystalMat: coinMat, pos, mat: faceMat, glowMat,
      baseColor: tint, rootColor: tint, baseGlassOpacity: 0.3,
      style: 'metal', tint, rimMat, spin: Math.random() * Math.PI * 2, coinScale: _coinScale,
    };
    nodeObjects.push(obj);
  }

  // Atualiza cores de uma moeda conforme o estado
  function paintMetalNode(obj, isUnlocked, canUnlock) {
    const c = coinColors(obj.tint, isUnlocked, canUnlock);
    obj.crystalMat.color.setHex(c.coin);
    obj.crystalMat.emissive = new THREE.Color(obj.tint).multiplyScalar(c.emissive);
    obj.crystalMat.opacity = c.coinOpacity;
    obj.crystalMat.roughness = isUnlocked ? 0.3 : canUnlock ? 0.4 : 0.48;
    obj.crystalMat.envMapIntensity = isUnlocked ? 1.3 : canUnlock ? 1.0 : 0.85;
    obj.rimMat.color.setHex(lerpHex(c.coin, 0xffffff, 0.15));
    obj.rimMat.opacity = c.coinOpacity;
    obj.mat.color.setHex(c.face);
    obj.mat.opacity = c.faceOpacity;
    obj.glowMat.color.setHex(obj.tint);
    obj.glowMat.opacity = (isUnlocked ? 0.45 : canUnlock ? 0.2 : 0.09) * _config.nodeGlow;
    obj.baseColor = obj.tint;
  }

  function createNode(skill, pos, isUnlocked, canUnlock, cls, periciaValues) {
    if (nodeStyleFor(cls) === 'metal') return createMetalNode(skill, pos, isUnlocked, canUnlock, cls);
    const classColor = COLOR_MAP[cls] || COLOR_UNLOCKED;
    const _gemTint = _config.gemColorOverride;
    const baseColor = (isUnlocked || canUnlock) ? (_gemTint || classColor) : COLOR_LOCKED;
    const glowColor = baseColor;

    // -- Inner crystal gemstone (rendered first) --
    const crystalGeo = getGemGeometry(skill.rank, NODE_RADIUS * 0.48);
    const crystalMat = new THREE.MeshPhysicalMaterial({
      color: baseColor,
      emissive: new THREE.Color(baseColor).multiplyScalar(isUnlocked ? 1.6 : canUnlock ? 0.55 : 0.08),
      roughness: 0.15,
      metalness: 0.3,
      transparent: true,
      opacity: isUnlocked ? 0.95 : canUnlock ? 0.6 : 0.25,
      clearcoat: 0.6,
      clearcoatRoughness: 0.2,
    });
    const crystalMesh = new THREE.Mesh(crystalGeo, crystalMat);
    crystalMesh.position.set(pos.x, pos.y, pos.z);
    crystalMesh.rotation.set(
      Math.random() * Math.PI,
      Math.random() * Math.PI,
      Math.random() * Math.PI
    );
    crystalMesh.renderOrder = 1;
    mainGroup.add(crystalMesh);

    // -- Outer glass shell (rendered after crystal, no depth write) --
    const geo = new THREE.SphereGeometry(NODE_RADIUS, 32, 32);
    const _baseGlassOpacity = _config.glassOpacity;
    const mat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      emissive: new THREE.Color(baseColor).multiplyScalar(isUnlocked ? 0.18 : canUnlock ? 0.07 : 0.02),
      roughness: 0.05,
      metalness: 0.0,
      transparent: true,
      opacity: _baseGlassOpacity,
      clearcoat: 1.0,
      clearcoatRoughness: 0.05,
      depthWrite: false,
      side: THREE.FrontSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(pos.x, pos.y, pos.z);
    mesh.renderOrder = 2;
    mainGroup.add(mesh);

    // -- Outer glow aura (sprite with radial falloff) --
    const glowMat = new THREE.SpriteMaterial({
      map: getGlowTexture(),
      color: glowColor,
      transparent: true,
      opacity: (isUnlocked ? 0.70 : canUnlock ? 0.25 : 0.06) * _config.nodeGlow,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
    });
    const glowMesh = new THREE.Sprite(glowMat);
    const glowScale = isUnlocked ? 2.2 : canUnlock ? 1.5 : 1.2;
    glowMesh.scale.set(glowScale, glowScale, 1);
    glowMesh.position.copy(mesh.position);
    mainGroup.add(glowMesh);

    if (isUnlocked) {
      const light = new THREE.PointLight(baseColor, 1.0, 4.5);
      light.position.copy(mesh.position);
      mainGroup.add(light);
    }

    // Rank 0 (class root) gets special treatment — usa cor da própria árvore
    const rootColor = (_config.gemColorOverride && (isUnlocked || canUnlock)) ? _config.gemColorOverride : (COLOR_MAP[cls] || COLOR_UNLOCKED);
    // normalizedGlassOpacity = design default at glassOpacity=0.3, used as multiplier base
    let normalizedGlassOpacity = 0.3;
    if (skill.rank === 0) {
      mesh.scale.setScalar(1.5);
      crystalMesh.scale.setScalar(1.5);
      crystalMat.color = new THREE.Color(rootColor);
      glowMat.color = new THREE.Color(rootColor);
      if (isUnlocked) {
        glowMesh.scale.set(3.2, 3.2, 1);
        crystalMat.emissive = new THREE.Color(rootColor).multiplyScalar(1.5);
        crystalMat.opacity = 1;
        mat.emissive = new THREE.Color(rootColor).multiplyScalar(0.15);
        normalizedGlassOpacity = 0.25;
        mat.opacity = normalizedGlassOpacity * (_baseGlassOpacity / 0.3);
        glowMat.opacity = 0.70 * _config.nodeGlow;
      } else {
        glowMesh.scale.set(2.0, 2.0, 1);
        crystalMat.emissive = new THREE.Color(rootColor).multiplyScalar(0.25);
        crystalMat.opacity = 0.45;
        mat.emissive = new THREE.Color(rootColor).multiplyScalar(0.03);
        normalizedGlassOpacity = 0.18;
        mat.opacity = normalizedGlassOpacity * (_baseGlassOpacity / 0.3);
        glowMat.opacity = 0.15 * _config.nodeGlow;
      }
    }

    mesh.userData = { skill, isUnlocked, canUnlock };
    const obj = { mesh, skill, glowMesh, crystalMesh, crystalMat, pos, mat, glowMat, baseColor, rootColor, baseGlassOpacity: normalizedGlassOpacity };
    nodeObjects.push(obj);
    if (isUnlocked) createGemEmitter(obj);
  }

  // ---- CREATE CONNECTION (Linha Alomântica — estilo Mistborn) ----
  // Uma linha fina e nítida + um véu de brilho; ativa, pisca como as linhas azuis
  // que o Alomântico vê e leva faíscas do pai para o filho. Feruquemia usa cobre.
  function metalLineColor(cls) {
    const art = CosData.getArtOfTree && CosData.getArtOfTree(cls);
    if (art === 'feru') return FERU_LINE;
    if (art === 'allo') return ALLO_LINE;
    if (cls === 'Feruquemista' || cls === 'Ferroso') return FERU_LINE;
    if (CosData.METAL_CLASSES && CosData.METAL_CLASSES.includes(cls)) return ALLO_LINE;
    return ASH_LINE;
  }

  function createMetalConnection(from, to, childSkill, parentSkill, unlockedSkills, cls) {
    const isActive = unlockedSkills.has(childSkill.id) && unlockedSkills.has(parentSkill.id);
    const lineColor = metalLineColor(cls);
    // Bloqueada: tom da própria árvore, para cada ramo "pertencer" ao seu metal/trilha
    const lockedColor = lerpHex(treeColor(cls), 0x5f6f86, 0.4);
    const dx = to.x - from.x, dy = to.y - from.y;
    const len = Math.hypot(dx, dy);

    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(from.x, from.y, from.z), new THREE.Vector3(to.x, to.y, to.z),
    ]);
    const mat = new THREE.LineBasicMaterial({
      color: isActive ? lineColor : lockedColor,
      transparent: true,
      opacity: (isActive ? 0.9 : 0.55) * _config.lineOpacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const line = new THREE.Line(geo, mat);
    mainGroup.add(line);

    const glowMat = new THREE.MeshBasicMaterial({
      map: getLineGlowTexture(),
      color: lineColor,
      transparent: true,
      opacity: isActive ? 0.4 * _config.lineOpacity : 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(len, 0.01), 0.26), glowMat);
    quad.position.set((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2 - 0.02);
    quad.rotation.z = Math.atan2(dy, dx);
    mainGroup.add(quad);

    lineObjects.push({ line, from, to, mat, isActive, skill: childSkill, parentSkill, cls,
      style: 'metal', glowMat, lineColor, lockedColor, phase: Math.random() * 10 });
    if (isActive) createSparksAlongLine(from, to, lineColor);
  }

  // Faíscas que correm pela linha alomântica (direção pai → filho)
  function createSparksAlongLine(from, to, color) {
    for (let i = 0; i < 2; i++) {
      const mat = new THREE.SpriteMaterial({
        map: getGlowTexture(), color, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.scale.set(0.34, 0.34, 1);
      mainGroup.add(sprite);
      smokeParticles.push({ type: 'spark', mesh: sprite, from, to,
        travelOffset: i / 2 + Math.random() * 0.2, travelSpeed: 0.28 + Math.random() * 0.12 });
    }
  }

  // ---- CREATE CONNECTION (Smoke Trail Line) ----
  function createConnection(from, to, childSkill, parentSkill, unlockedSkills, cls) {
    if (nodeStyleFor(cls) === 'metal') return createMetalConnection(from, to, childSkill, parentSkill, unlockedSkills, cls);
    const isActive = unlockedSkills.has(childSkill.id) && unlockedSkills.has(parentSkill.id);
    const color = isActive ? COLOR_MAP[cls] : COLOR_LOCKED;

    const points = [];
    const segments = 20;
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const x = from.x + (to.x - from.x) * t;
      const y = from.y + (to.y - from.y) * t;
      const z = from.z + (to.z - from.z) * t;
      points.push(new THREE.Vector3(x, y, z));
    }

    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({
      color: color,
      transparent: true,
      opacity: (isActive ? 0.5 : 0.12) * _config.lineOpacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const line = new THREE.Line(geo, mat);
    mainGroup.add(line);
    lineObjects.push({ line, from, to, mat, isActive, skill: childSkill, parentSkill, cls });

    if (isActive) {
      createSmokeAlongLine(from, to, color);
    }
  }

  // ---- SMOKE PARTICLES ----

  // Hélix de fumaça luminosa ao longo de uma conexão ativa
  function createSmokeAlongLine(from, to, color) {
    const count = 20;

    // Eixos perpendiculares à direção da linha — base do hélix
    const dir = new THREE.Vector3(to.x - from.x, to.y - from.y, to.z - from.z).normalize();
    const arb = Math.abs(dir.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const right = new THREE.Vector3().crossVectors(dir, arb).normalize();
    const perp  = new THREE.Vector3().crossVectors(dir, right).normalize();

    const travelSpeed = 0.10 + Math.random() * 0.05;

    for (let i = 0; i < count; i++) {
      const mat = new THREE.SpriteMaterial({
        map: getSmokeTexture(),
        color: color,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.scale.set(0.55, 0.55, 1);
      mainGroup.add(sprite);

      smokeParticles.push({
        type: 'helix',
        mesh: sprite,
        from, to,
        right: right.clone(),
        perp:  perp.clone(),
        helixRadius: 0.17,
        phaseOffset:   (i / count) * Math.PI * 2,
        travelOffset:  i / count,
        travelSpeed,
        turns: 2.5,
      });
    }
  }

  // Partículas que emanam de dentro das gemas desbloqueadas
  function createGemEmitter(nodeObj) {
    const count = 7;
    const color = nodeObj.rootColor || nodeObj.baseColor || 0xffffff;

    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi   = Math.acos(2 * Math.random() - 1);
      const speed = 0.07 + Math.random() * 0.10;

      const mat = new THREE.SpriteMaterial({
        map: getSmokeTexture(),
        color: color,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.scale.set(0.3, 0.3, 1);
      mainGroup.add(sprite);

      smokeParticles.push({
        type: 'gem',
        mesh: sprite,
        basePos: { x: nodeObj.pos.x, y: nodeObj.pos.y, z: nodeObj.pos.z },
        dx: Math.sin(phi) * Math.cos(theta) * speed,
        dy: Math.sin(phi) * Math.sin(theta) * speed,
        dz: Math.cos(phi) * speed * 0.5,
        life: Math.random(),
        lifetime: 1.8 + Math.random() * 1.4,
        maxOpacity: 0.35 + Math.random() * 0.25,
      });
    }
  }

  // ---- CLEAR TREE ----
  function clearTree() {
    while (mainGroup.children.length > 0) {
      const child = mainGroup.children[0];
      mainGroup.remove(child);
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (child.material.dispose) child.material.dispose();
      }
    }
    nodeObjects = [];
    lineObjects = [];
    _spokes = [];
    _coinScale = 1;
    
    // MANTÉM as partículas de trail para que terminem de desaparecer na scene.
    // As fumaças normais ('helix' e 'gem') são apagadas pois pertenciam ao mainGroup.
    smokeParticles = smokeParticles.filter(p => p.type === 'trail');
    
    hoveredNode = null;
  }

  // ---- ANIMATION LOOP ----
  function animate() {
    animFrame = requestAnimationFrame(animate);
    const time = clock.getElapsedTime();

    // Animate node glow pulsing + crystal rotation
    for (const obj of nodeObjects) {
      const pulse = Math.sin(time * 2 + obj.skill.id * 0.5) * 0.5 + 0.5;

      if (obj.style === 'metal') {
        // Moeda balança devagar para pegar a luz; queimando, a borda tremula
        obj.mesh.rotation.y = Math.sin(time * 0.6 + obj.spin) * 0.35;
        const ud = obj.mesh.userData;
        if (ud.isUnlocked) {
          const flicker = 0.75 + Math.sin(time * 7.3 + obj.spin) * 0.12 + Math.sin(time * 13.1 + obj.skill.id) * 0.08;
          obj.glowMat.opacity = 0.42 * flicker * _config.nodeGlow;
          const gs = ((obj.skill.rank === 0 ? 2.5 : 1.9) + pulse * 0.25) * (obj.coinScale || 1);
          obj.glowMesh.scale.set(gs, gs, 1);
          obj.crystalMat.emissive = new THREE.Color(obj.tint).multiplyScalar(0.22 + flicker * 0.12);
        } else if (ud.canUnlock) {
          obj.glowMat.opacity = (0.08 + pulse * 0.12) * _config.nodeGlow;
          obj.crystalMat.emissive = new THREE.Color(obj.tint).multiplyScalar(0.05 + pulse * 0.08);
        }
        continue;
      }

      // Slow crystal tumble
      obj.crystalMesh.rotation.x += 0.003;
      obj.crystalMesh.rotation.y += 0.005;

      if (obj.skill.rank === 0) {
        obj.crystalMesh.rotation.y = time * 0.3;
        if (obj.mesh.userData.isUnlocked) {
          const gs = 3.0 + pulse * 0.4;
          obj.glowMesh.scale.set(gs, gs, 1);
          obj.glowMat.opacity = (0.35 + pulse * 0.2) * _config.nodeGlow;
          obj.crystalMat.emissive = new THREE.Color(obj.rootColor).multiplyScalar(0.8 + pulse * 0.5);
        } else {
          obj.glowMat.opacity = (0.08 + pulse * 0.07) * _config.nodeGlow;
          obj.crystalMat.emissive = new THREE.Color(obj.rootColor).multiplyScalar(0.12 + pulse * 0.13);
        }
      } else if (obj.mesh.userData.isUnlocked) {
        const gs = 2.0 + pulse * 0.4;
        obj.glowMesh.scale.set(gs, gs, 1);
        obj.glowMat.opacity = (0.25 + pulse * 0.2) * _config.nodeGlow;
        obj.crystalMat.emissive = new THREE.Color(obj.baseColor).multiplyScalar(0.5 + pulse * 0.5);
        obj.mat.emissive = new THREE.Color(obj.baseColor).multiplyScalar(0.04 + pulse * 0.06);
      } else if (obj.mesh.userData.canUnlock) {
        const gs = 1.4 + pulse * 0.2;
        obj.glowMesh.scale.set(gs, gs, 1);
        obj.glowMat.opacity = (0.08 + pulse * 0.1) * _config.nodeGlow;
        obj.crystalMat.emissive = new THREE.Color(obj.baseColor).multiplyScalar(0.15 + pulse * 0.15);
      } else {
        obj.glowMat.opacity = (0.03 + pulse * 0.03) * _config.nodeGlow;
        obj.crystalMat.emissive = new THREE.Color(obj.baseColor).multiplyScalar(0.05 + pulse * 0.05);
      }
    }

    // Animate smoke particles
    for (let i = smokeParticles.length - 1; i >= 0; i--) {
      const p = smokeParticles[i];
      if (p.type === 'helix') {
        // Partícula avança ao longo da linha e orbita em hélix
        const t = (p.travelOffset + time * p.travelSpeed) % 1.0;
        const angle = p.phaseOffset + t * Math.PI * 2 * p.turns;

        const lx = p.from.x + (p.to.x - p.from.x) * t;
        const ly = p.from.y + (p.to.y - p.from.y) * t;
        const lz = p.from.z + (p.to.z - p.from.z) * t;
        const r  = p.helixRadius;
        const ca = Math.cos(angle), sa = Math.sin(angle);

        p.mesh.position.set(
          lx + r * (ca * p.right.x + sa * p.perp.x),
          ly + r * (ca * p.right.y + sa * p.perp.y),
          lz + r * (ca * p.right.z + sa * p.perp.z),
        );

        // Fade nas bordas para esconder o loop; pulso suave de tamanho
        const fade  = Math.sin(t * Math.PI);
        const scale = 0.42 + Math.sin(time * 2.5 + p.phaseOffset) * 0.10;
        p.mesh.scale.set(scale, scale, 1);
        p.mesh.material.opacity = 0.50 * fade;

      } else if (p.type === 'gem') {
        // Partícula deriva para fora da gema e desvanece
        p.life = (p.life + 0.007) % 1.0;
        const age = p.life * p.lifetime;
        p.mesh.position.set(
          p.basePos.x + p.dx * age,
          p.basePos.y + p.dy * age,
          p.basePos.z + p.dz * age,
        );
        p.mesh.material.opacity = Math.sin(p.life * Math.PI) * p.maxOpacity;
        const scale = 0.12 + p.life * 0.32;
        p.mesh.scale.set(scale, scale, 1);
      } else if (p.type === 'spark') {
        // Faísca alomântica percorrendo a linha, some nas pontas
        const t = (p.travelOffset + time * p.travelSpeed) % 1.0;
        p.mesh.position.set(
          p.from.x + (p.to.x - p.from.x) * t,
          p.from.y + (p.to.y - p.from.y) * t,
          p.from.z + (p.to.z - p.from.z) * t + 0.02,
        );
        p.mesh.material.opacity = Math.sin(t * Math.PI) * 0.85;
        const s = 0.22 + Math.sin(t * Math.PI) * 0.16;
        p.mesh.scale.set(s, s, 1);
      } else if (p.type === 'trail') {
        // Novo Star Trail da troca de classe
        p.life -= p.decay;
        if (p.life <= 0) {
          scene.remove(p.mesh);
          p.mesh.material.dispose();
          smokeParticles.splice(i, 1);
        } else {
          p.mesh.material.opacity = p.life * 0.7;
          const scale = p.baseScale * p.life;
          p.mesh.scale.set(scale, scale, 1);
        }
      }
    }

    // Linhas alomânticas ativas: tremulam como as linhas azuis vistas ao queimar aço
    for (const l of lineObjects) {
      if (l.style !== 'metal' || !l.isActive) continue;
      const f = 0.78 + Math.sin(time * 9 + l.phase) * 0.12 + Math.sin(time * 23 + l.phase * 3) * 0.1;
      l.glowMat.opacity = 0.4 * f * _config.lineOpacity;
    }

    // Animate background particles
    if (_bgStorm && _bgStorm.visible) {
      const pos = _bgStorm.geometry.attributes.position.array;
      const speeds = _bgStorm.userData.speeds;
      for (let i = 0; i < speeds.length; i++) {
        pos[i*3+1] += speeds[i] * 0.005;
        pos[i*3]   += Math.sin(time + i) * 0.001;
        if (pos[i*3+1] > 20) pos[i*3+1] = -20;
      }
      _bgStorm.geometry.attributes.position.needsUpdate = true;
    }
    if (_bgAsh && _bgAsh.visible) {
      // Cinzas descem e balançam de leve
      const pos = _bgAsh.geometry.attributes.position.array;
      const { speeds, phase } = _bgAsh.userData;
      for (let i = 0; i < speeds.length; i++) {
        pos[i*3+1] -= speeds[i] * 0.012;
        pos[i*3]   += Math.sin(time * 0.7 + phase[i]) * 0.004 + 0.002;
        if (pos[i*3+1] < -22) { pos[i*3+1] = 22; pos[i*3] = (Math.random() - 0.5) * 70; }
        if (pos[i*3] > 36) pos[i*3] = -36;
      }
      _bgAsh.geometry.attributes.position.needsUpdate = true;
    }
    for (const m of _bgMist) {
      if (!m.visible) continue;
      m.position.x += m.userData.drift * 0.006;
      m.position.y += Math.sin(time * 0.15 + m.userData.bob) * 0.002;
      if (m.position.x > 45) m.position.x = -45;
      if (m.position.x < -45) m.position.x = 45;
      m.material.opacity = m.userData.baseOpacity * (0.75 + Math.sin(time * 0.2 + m.userData.bob) * 0.25);
    }

    // Raycasting for hover
    raycaster.setFromCamera(mouse, camera);
    const meshes = nodeObjects.flatMap(n => [n.mesh, n.crystalMesh]);
    const intersects = raycaster.intersectObjects(meshes);

    // Reset previous hover (moedas: a face é filha da moeda, então só a moeda escala)
    if (hoveredNode) {
      if (hoveredNode.style === 'metal') {
        hoveredNode.mesh.scale.setScalar(1);
      } else {
        const scale = hoveredNode.skill.rank === 0 ? 1.5 : 1;
        hoveredNode.mesh.scale.setScalar(scale);
        hoveredNode.crystalMesh.scale.setScalar(scale);
      }
      hoveredNode = null;
    }

    if (intersects.length > 0) {
      const hit = intersects[0].object;
      const nodeObj = nodeObjects.find(n => n.mesh === hit || n.crystalMesh === hit);
      if (nodeObj) {
        hoveredNode = nodeObj;
        if (nodeObj.style === 'metal') {
          nodeObj.mesh.scale.setScalar(1.2);
          document.body.style.cursor = 'pointer';
          if (onNodeHover) onNodeHover(nodeObj.skill, intersects[0]);
          renderer.render(scene, camera);
          return;
        }
        const baseScale = nodeObj.skill.rank === 0 ? 1.5 : 1;
        nodeObj.mesh.scale.setScalar(baseScale * 1.2);
        nodeObj.crystalMesh.scale.setScalar(baseScale * 1.2);
        document.body.style.cursor = 'pointer';
        if (onNodeHover) onNodeHover(nodeObj.skill, intersects[0]);
      }
    } else {
      document.body.style.cursor = 'default';
      if (onHoverEnd) onHoverEnd();
    }

    renderer.render(scene, camera);
  }

  // ---- UPDATE (re-color nodes based on new unlock state) ----
  function updateStates(unlockedSkills, periciaValues, canUnlockFn) {
    if (canUnlockFn) _canUnlockFn = canUnlockFn;

    for (const sp of _spokes) paintSpoke(sp, unlockedSkills);

    // Update connection lines
    for (const obj of lineObjects) {
      if (!obj.skill) continue;
      const wasActive = obj.isActive;
      const isActive  = unlockedSkills.has(obj.skill.id) && (!obj.parentSkill || unlockedSkills.has(obj.parentSkill.id));
      if (obj.style === 'metal') {
        obj.mat.color.setHex(isActive ? obj.lineColor : obj.lockedColor);
        obj.mat.opacity = (isActive ? 0.9 : 0.55) * _config.lineOpacity;
        obj.glowMat.opacity = isActive ? 0.4 * _config.lineOpacity : 0;
        if (!wasActive && isActive) createSparksAlongLine(obj.from, obj.to, obj.lineColor);
        obj.isActive = isActive;
        continue;
      }
      const cls       = obj.cls || currentClass || obj.skill.cls;
      const color     = isActive ? (COLOR_MAP[cls] || COLOR_LOCKED) : COLOR_LOCKED;
      obj.mat.color.setHex(color);
      obj.mat.opacity = (isActive ? 0.5 : 0.12) * _config.lineOpacity;
      if (!wasActive && isActive) {
        createSmokeAlongLine(obj.from, obj.to, COLOR_MAP[cls] || COLOR_LOCKED);
      }
      obj.isActive = isActive;
    }

    for (const obj of nodeObjects) {
      const wasUnlocked = obj.mesh.userData.isUnlocked;
      const isUnlocked = unlockedSkills.has(obj.skill.id);
      const canUnlock = !isUnlocked && _canUnlockFn ? _canUnlockFn(obj.skill) : false;
      if (obj.style === 'metal') {
        obj.mesh.userData.isUnlocked = isUnlocked;
        obj.mesh.userData.canUnlock = canUnlock;
        paintMetalNode(obj, isUnlocked, canUnlock);
        continue;
      }
      obj.mesh.userData.isUnlocked = isUnlocked;
      if (!wasUnlocked && isUnlocked) createGemEmitter(obj);
      obj.mesh.userData.canUnlock = canUnlock;
      const cls = currentClass || obj.skill.cls;
      const color = isUnlocked ? COLOR_MAP[cls] : canUnlock ? COLOR_MAP[cls] : COLOR_LOCKED;

      // Glass shell
      obj.mat.emissive = new THREE.Color(color).multiplyScalar(isUnlocked ? 0.08 : canUnlock ? 0.04 : 0.02);
      obj.mat.opacity = isUnlocked ? 0.25 : 0.3;

      // Crystal
      obj.crystalMat.color.setHex(color);
      obj.crystalMat.emissive = new THREE.Color(color).multiplyScalar(isUnlocked ? 0.9 : canUnlock ? 0.25 : 0.08);
      obj.crystalMat.opacity = isUnlocked ? 0.92 : canUnlock ? 0.5 : 0.25;

      obj.glowMat.color.setHex(color);
      const gs = isUnlocked ? 2.2 : canUnlock ? 1.5 : 1.2;
      obj.glowMesh.scale.set(gs, gs, 1);
      obj.glowMat.opacity = (isUnlocked ? 0.45 : canUnlock ? 0.15 : 0.06) * _config.nodeGlow;
      obj.baseColor = color;

      // Class root usa cor da própria árvore, com brilho diferenciado por estado
      if (obj.skill.rank === 0) {
        const rootColor = obj.rootColor || COLOR_MAP[currentClass] || COLOR_UNLOCKED;
        obj.crystalMat.color.setHex(rootColor);
        obj.glowMat.color.setHex(rootColor);
        if (isUnlocked) {
          obj.crystalMat.emissive = new THREE.Color(rootColor).multiplyScalar(1.5);
          obj.crystalMat.opacity = 1;
          obj.mat.emissive = new THREE.Color(rootColor).multiplyScalar(0.15);
          obj.mat.opacity = 0.25;
          obj.glowMat.opacity = 0.70 * _config.nodeGlow;
          obj.glowMesh.scale.set(3.2, 3.2, 1);
        } else {
          obj.crystalMat.emissive = new THREE.Color(rootColor).multiplyScalar(0.25);
          obj.crystalMat.opacity = 0.45;
          obj.mat.emissive = new THREE.Color(rootColor).multiplyScalar(0.03);
          obj.mat.opacity = 0.18;
          obj.glowMat.opacity = 0.15 * _config.nodeGlow;
          obj.glowMesh.scale.set(2.0, 2.0, 1);
        }
      }
    }
  }

  // ---- PUBLIC API ----
  function setCallbacks(hover, click, hoverEnd, longPress) {
    onNodeHover     = hover;
    onNodeClick     = click;
    onHoverEnd      = hoverEnd;
    onNodeLongPress = longPress;
  }

  function setConfig(newConfig) {
    Object.assign(_config, newConfig);
    if (newConfig.lineOpacity !== undefined) {
      for (const obj of lineObjects) {
        const base = obj.style === 'metal' ? (obj.isActive ? 0.9 : 0.55) : (obj.isActive ? 0.5 : 0.12);
        obj.mat.opacity = base * _config.lineOpacity;
      }
    }
    // Vidro e cor das gemas não se aplicam às moedas
    if (newConfig.glassOpacity !== undefined) {
      for (const obj of nodeObjects) {
        if (obj.style === 'metal') continue;
        const ratio = newConfig.glassOpacity / 0.3;
        obj.mat.opacity = obj.baseGlassOpacity * ratio;
      }
    }
    if (newConfig.gemColorOverride !== undefined) {
      for (const obj of nodeObjects) {
        if (obj.style === 'metal') continue;
        const isUnlocked = obj.mesh.userData.isUnlocked;
        const canUnlock = obj.mesh.userData.canUnlock;
        const cls = currentClass || obj.skill.cls;
        const classColor = COLOR_MAP[cls] || COLOR_UNLOCKED;
        const newColor = (isUnlocked || canUnlock) ? (_config.gemColorOverride || classColor) : COLOR_LOCKED;
        obj.crystalMat.color.setHex(newColor);
        obj.glowMat.color.setHex(newColor);
        obj.baseColor = newColor;
      }
    }
  }

  function getConfig() { return { ..._config }; }

  function destroy() {
    if (animFrame) cancelAnimationFrame(animFrame);
    clearTree();
    if (renderer) {
      renderer.dispose();
      renderer.domElement.remove();
    }
  }

  // ---- COSMERE CENTER SYMBOL ----
  // radiantClass: if set, shows the order glyph tinted with its class color;
  //               otherwise shows the Cosmere symbol in gold.
  // Símbolo do mundo de cada cenário (svg/mundos): Roshar, Scadrial ou o Cosmere inteiro
  const WORLD_SYMBOL = {
    stormlight: { svg: 'svg/mundos/roshar.svg',   tint: 'rgba(212,168,83,1.0)' },
    mistborn:   { svg: 'svg/mundos/scadrial.svg', tint: 'rgba(124,196,255,1.0)' },
    misto:      { svg: 'svg/mundos/Cosmere.svg',  tint: 'rgba(214,204,245,1.0)' },
  };

  function addCosmereCenterSymbol(radiantClass) {
    // A ordem radiante só assume o centro no cenário Cosmere; no Misto vale o Cosmere
    const useOrder = radiantClass && RADIANT_SVG_MAP[radiantClass] && _theme === 'stormlight';
    const world = WORLD_SYMBOL[_theme] || WORLD_SYMBOL.stormlight;
    const svgPath = useOrder ? RADIANT_SVG_MAP[radiantClass] : world.svg;

    let tintColor = world.tint;
    if (useOrder) {
      const hex = COLOR_MAP[radiantClass];
      if (hex !== undefined) {
        const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
        tintColor = `rgba(${r},${g},${b},1.0)`;
      }
    }

    function makeSprite(texture) {
      const mat = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        opacity: useOrder ? 0.5 : 0.42,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.position.set(0, 0, -0.05);
      sprite.scale.set(7, 7, 1);
      mainGroup.add(sprite);
    }

    if (_svgTextureCache[svgPath]) { makeSprite(_svgTextureCache[svgPath]); return; }

    const img = new Image();
    img.onload = () => {
      const size = 512;
      const canvas = document.createElement('canvas');
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext('2d');
      // Mantém a proporção (os símbolos de mundo não são quadrados)
      const ar = (img.naturalWidth || 1) / (img.naturalHeight || 1);
      const w = ar >= 1 ? size : size * ar, h = ar >= 1 ? size / ar : size;
      ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
      // Tint to target color using source-in composite
      ctx.globalCompositeOperation = 'source-in';
      ctx.fillStyle = tintColor;
      ctx.fillRect(0, 0, size, size);
      const texture = new THREE.CanvasTexture(canvas);
      texture.minFilter = THREE.LinearFilter;
      _svgTextureCache[svgPath] = texture;
      makeSprite(texture);
    };
    img.src = svgPath;
  }

  // ---- BUILD ALL CLASSES (panoramic view) ----
  let _viewMode = 'single'; // 'single' or 'all'

  // Raios do centro até cada talento-chave na visão "Todas"
  let _spokes = [];
  function paintSpoke(spoke, unlockedSkills) {
    const active = spoke.rootId !== null && unlockedSkills.has(spoke.rootId);
    const color = treeColor(spoke.cls);
    spoke.mat.color.setHex(active ? color : spoke.idleColor);
    spoke.mat.opacity = active ? 0.85 : spoke.idleOpacity;
    if (active && !spoke.active) {
      if (nodeStyleFor(spoke.cls) === 'metal') createSparksAlongLine(spoke.from, spoke.to, color);
      else createSmokeAlongLine(spoke.from, spoke.to, color);
    }
    spoke.active = active;
  }

  function buildAllTrees(unlockedSkills, periciaValues, canUnlockFn, radiantClass, additionalClasses, metalClasses) {
    _viewMode = 'all';
    _canUnlockFn = canUnlockFn || null;
    currentClass = null;

    clearTree();
    _coinScale = 0.85;

    // --- Reset camera to flat (no tilt) for panoramic view ---
    mainGroup.rotation.set(0, 0, 0);
    mainGroup.position.set(0, 0, 0);
    camera.position.set(0, 0, 70);
    camera.rotation.set(0, 0, 0);

    const allPositions = {};
    const scale = 0.58;

    // Helper: place one tree at world offset (cx, cy), radiating at outwardAngle.
    // Árvores de moeda chegam com o layout pronto (tamanho natural); as de gema
    // continuam limitadas ao setor como antes.
    function placeTree(cls, skills, children, root, cx, cy, outwardAngle, isRadiant, preLayout, outerExtent, halfWidth) {
      // Max local radius (árvores de gema): a meia-largura reservada para ela no anel
      const chordHalf = (halfWidth || 3.95) / scale;
      const localPos = preLayout || computeLayout(cls, skills, children, root, outwardAngle, chordHalf);
      for (const skill of skills) {
        if (!localPos[skill.id]) continue;
        const lp = localPos[skill.id];
        const pos = { x: cx + lp.x * scale, y: cy + lp.y * scale, z: lp.z };
        allPositions[skill.id] = pos;
        const isUnlocked = unlockedSkills.has(skill.id);
        const canUnlock  = !isUnlocked && _canUnlockFn ? _canUnlockFn(skill) : false;
        createNode(skill, pos, isUnlocked, canUnlock, cls, periciaValues);
      }
      if (isRadiant === 'metal') addTreeGlyph(cls, skills.filter(s => s.rank > 0).map(s => allPositions[s.id]));
      const findFn = isRadiant === 'metal' ? CosData.findMetalSkillByName
                   : isRadiant === 'additional' ? CosData.findAdditionalSkillByName
                   : isRadiant ? CosData.findRadiantSkillByName : CosData.findSkillByName;
      for (const skill of skills) {
        if (!allPositions[skill.id]) continue;
        for (const depName of skill.deps) {
          const parent = findFn(depName, cls, skill.sub);
          if (parent && allPositions[parent.id]) {
            createConnection(allPositions[parent.id], allPositions[skill.id], skill, parent, unlockedSkills, cls);
          }
        }
      }
      // Place label beyond the outermost nodes, in the outward direction from centre
      const labelDist = outerExtent !== undefined ? radius + outerExtent + 1.6 : radius + 6.5;
      createClassLabel(cls, Math.cos(outwardAngle) * labelDist, Math.sin(outwardAngle) * labelDist);
    }

    // Build full entry list: radiant first (top), then 6 base classes, then additional (Cantor etc.)
    const allEntries = [];
    if (radiantClass) allEntries.push({ cls: radiantClass, isRadiant: true });
    CosData.CLASSES.forEach(cls => allEntries.push({ cls, isRadiant: false }));
    if (additionalClasses && additionalClasses.length) {
      additionalClasses.forEach(cls => allEntries.push({ cls, isRadiant: false, isAdditional: true }));
    }
    if (metalClasses && metalClasses.length) {
      metalClasses.forEach(cls => allEntries.push({ cls, isRadiant: false, isMetal: true }));
    }

    const total  = allEntries.length; // 6 without radiant, 7 with

    // Grafo, raiz e (para moedas) o layout em tamanho natural de cada árvore.
    // O layout é medido apontando para cima (π/2) e girado depois para o ângulo final.
    for (const entry of allEntries) {
      const g = entry.isRadiant ? CosData.buildRadiantGraph(entry.cls)
        : entry.isAdditional ? CosData.buildAdditionalGraph(entry.cls)
        : entry.isMetal ? CosData.buildMetalGraph(entry.cls)
        : CosData.buildGraph(entry.cls);
      entry.skills = g.skills;
      entry.children = g.children;
      entry.root = entry.isRadiant ? CosData.getRootRadiantSkill(entry.cls)
        : entry.isAdditional ? CosData.getRootAdditionalSkill(entry.cls)
        : entry.isMetal ? CosData.getRootMetalSkill(entry.cls)
        : CosData.getRootSkill(entry.cls);
      entry.kind = entry.isRadiant ? true : entry.isAdditional ? 'additional' : entry.isMetal ? 'metal' : false;
      // Árvores de gema continuam limitadas ao setor, com a mesma meia-largura de sempre
      entry.halfWidth = 3.95;
      if (entry.root && nodeStyleFor(entry.cls) === 'metal') {
        entry.layout = computeLayout(entry.cls, entry.skills, entry.children, entry.root, Math.PI / 2);
        // Alcance para fora (o = y) e meia-largura (q = |x|) de cada nó, já na escala do anel
        let out = 0;
        entry.pts = [];
        for (const p of Object.values(entry.layout)) {
          const o = p.y * scale, q = Math.abs(p.x) * scale;
          entry.pts.push([o, q + 0.4]); // + meia moeda
          out = Math.max(out, o);
        }
        entry.outer = out;
      }
    }

    // Quanto do círculo (em radianos, de cada lado) a árvore ocupa com o anel no raio R.
    // Os galhos se abrem para fora, onde há mais espaço, então medir no próprio nó
    // (e não na raiz) evita um anel desnecessariamente grande.
    const angularHalf = (entry, R) => entry.pts
      ? Math.max(...entry.pts.map(([o, q]) => Math.atan2(q, R + o)))
      : Math.atan2(entry.halfWidth, R);
    const GAP = 1.1; // folga mínima entre árvores vizinhas (unidades de mundo)
    const needed = R => allEntries.reduce((a, e) => a + 2 * angularHalf(e, R) + GAP / R, 0);
    // Menor anel em que todas cabem com a folga mínima
    let radius = 11;
    while (needed(radius) > 2 * Math.PI && radius < 80) radius += 0.25;

    // Cada árvore recebe a fatia do tamanho dela; a sobra do círculo é dividida
    // igualmente, então o vão entre vizinhas é o mesmo em todo o anel
    const slack = Math.max(0, 2 * Math.PI - needed(radius)) / total;
    const widths = allEntries.map(e => 2 * angularHalf(e, radius) + GAP / radius + slack);
    let cursor = Math.PI / 2;
    allEntries.forEach((e, i) => {
      if (i > 0) cursor -= widths[i - 1] / 2 + widths[i] / 2;
      e.angle = cursor;
      e.sectorHalf = widths[i] / 2;
      // Gira o layout medido (para cima) até o ângulo da árvore
      if (e.layout) {
        const rot = e.angle - Math.PI / 2, c = Math.cos(rot), s = Math.sin(rot);
        for (const p of Object.values(e.layout)) {
          const x = p.x * c - p.y * s, y = p.x * s + p.y * c;
          p.x = x; p.y = y;
        }
      }
    });

    // Compute root positions — each tree centered in its own sector, starting from top
    const rootPositions = allEntries.map(entry => ({
      ...entry, x: Math.cos(entry.angle) * radius, y: Math.sin(entry.angle) * radius,
    }));

    // --- Constellation skeleton (behind nodes) ---
    // Spokes: start at inner gap (avoid covering center symbol) → each root
    // O raio acende (cor da árvore + faíscas) quando o talento-chave é comprado
    const spokeInnerR = 3.8;
    _spokes = [];
    for (const rp of rootPositions) {
      const rootSkill = rp.isRadiant ? CosData.getRootRadiantSkill(rp.cls)
        : rp.isAdditional ? CosData.getRootAdditionalSkill(rp.cls)
        : rp.isMetal ? CosData.getRootMetalSkill(rp.cls)
        : CosData.getRootSkill(rp.cls);
      const idleColor = rp.isRadiant ? 0xc084fc : 0x2a3a55;
      const idleOpacity = rp.isRadiant ? 0.4 : 0.5;
      const mat = new THREE.LineBasicMaterial({
        color: idleColor, transparent: true, opacity: idleOpacity,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const from = { x: Math.cos(rp.angle) * spokeInnerR, y: Math.sin(rp.angle) * spokeInnerR, z: -0.1 };
      const to   = { x: rp.x, y: rp.y, z: -0.1 };
      mainGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(from.x, from.y, from.z), new THREE.Vector3(to.x, to.y, to.z),
      ]), mat));
      const spoke = { mat, rootId: rootSkill ? rootSkill.id : null, cls: rp.cls, idleColor, idleOpacity, from, to, active: false };
      _spokes.push(spoke);
      paintSpoke(spoke, unlockedSkills);
    }

    // Ring: adjacent root connections
    for (let i = 0; i < total; i++) {
      const a = rootPositions[i];
      const b = rootPositions[(i + 1) % total];
      const isRadiantEdge = a.isRadiant || b.isRadiant;
      mainGroup.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(a.x, a.y, -0.1),
          new THREE.Vector3(b.x, b.y, -0.1),
        ]),
        new THREE.LineBasicMaterial({
          color: isRadiantEdge ? 0x5d3070 : 0x1e2d45,
          transparent: true,
          opacity: isRadiantEdge ? 0.35 : 0.4,
          blending: THREE.AdditiveBlending, depthWrite: false,
        })
      ));
    }

    // Central glow + Cosmere symbol
    const centerGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: getGlowTexture(), color: 0xd4a853,
      transparent: true, opacity: 0.18,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    centerGlow.scale.set(8, 8, 1);
    centerGlow.position.set(0, 0, -0.2);
    mainGroup.add(centerGlow);

    addCosmereCenterSymbol(radiantClass);

    // Place each tree at its ring position, radiating outward
    for (const rp of rootPositions) {
      if (rp.root) placeTree(rp.cls, rp.skills, rp.children, rp.root, rp.x, rp.y, rp.angle, rp.kind, rp.layout, rp.outer, rp.halfWidth);
    }

    // Fit camera so all nodes are visible, accounting for actual content extent
    const allPosIds = Object.keys(allPositions);
    if (allPosIds.length > 0) {
      let maxExtentX = 0, maxExtentY = 0;
      for (const id of allPosIds) {
        const p = allPositions[id];
        if (Math.abs(p.x) > maxExtentX) maxExtentX = Math.abs(p.x);
        if (Math.abs(p.y) > maxExtentY) maxExtentY = Math.abs(p.y);
      }
      const halfFovRad = (camera.fov / 2) * Math.PI / 180;
      const zForHeight = (maxExtentY + 2.5) / Math.tan(halfFovRad);
      const zForWidth  = (maxExtentX + 2.5) / (Math.tan(halfFovRad) * camera.aspect);
      camera.position.z = Math.min(90, Math.max(20, Math.max(zForHeight, zForWidth)));
    }
  }

  // ---- SUBCLASS LABELS ----
  function createSubLabel(sub, x, y, cls) {
    const fontSize = 16;
    const tmp = document.createElement('canvas').getContext('2d');
    tmp.font = `${fontSize}px Cinzel, serif`;
    const textW = Math.ceil(tmp.measureText(sub).width) + 16;
    const canvasW = Math.max(128, textW);
    const canvasH = 28;

    const canvas = document.createElement('canvas');
    canvas.width = canvasW; canvas.height = canvasH;
    const ctx = canvas.getContext('2d');
    ctx.font = `${fontSize}px Cinzel, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const hex = treeColor(cls);
    const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
    
    // Aumentei a opacidade para 0.85 para ficar mais nítido fora dos nodes
    ctx.fillStyle = `rgba(${r},${g},${b},0.85)`;
    ctx.fillText(sub, canvasW / 2, canvasH / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
    const sprite = new THREE.Sprite(mat);
    
    // Usar diretamente as coordenadas exatas fornecidas pela nova lógica e baixar ligeiramente o Z
    sprite.position.set(x, y, 0.1); 
    sprite.scale.set(canvasW / canvasH * 0.85, 0.85, 1);
    mainGroup.add(sprite);
  }

  function addSubLabels(cls, skills, positions, subs) {
    if (!_config.showSubLabels || !subs || subs.length === 0) return;
    for (const sub of subs) {
      if (!sub || sub === '-') continue;
      const subSkills = skills.filter(s => s.sub === sub);
      if (subSkills.length === 0) continue;

      // 1. Encontrar o centróide desta subclasse
      let cx = 0, cy = 0, count = 0;
      for (const s of subSkills) {
        const p = positions[s.id];
        if (p) { cx += p.x; cy += p.y; count++; }
      }
      if (count === 0) continue;
      cx /= count;
      cy /= count;

      // 2. Descobrir a direção do centro da árvore para o centróide
      const len = Math.sqrt(cx * cx + cy * cy);
      let dx = 0, dy = 1; 
      if (len > 0.1) {
        dx = cx / len;
        dy = cy / len;
      }

      // 3. Encontrar o node desta subclasse que está mais na ponta (mais distante do centro)
      let maxProjectedDist = 0;
      for (const s of subSkills) {
        const p = positions[s.id];
        if (p) {
          const dist = p.x * dx + p.y * dy;
          if (dist > maxProjectedDist) maxProjectedDist = dist;
        }
      }

      // 4. Posicionar o texto além desse node mais distante
      // O offset de 2.0 afasta o texto da área de colisão e do brilho (glow) do node
      const offsetBuffer = 2.0; 
      const labelX = dx * (maxProjectedDist + offsetBuffer);
      const labelY = dy * (maxProjectedDist + offsetBuffer);

      createSubLabel(sub, labelX, labelY, cls);
    }
  }

  function createClassLabel(cls, x, y) {
    const fontSize = 28;
    // Measure text first to avoid clipping long names
    const tmp = document.createElement('canvas').getContext('2d');
    tmp.font = `bold ${fontSize}px Cinzel, serif`;
    const textW = Math.ceil(tmp.measureText(cls).width) + 24;
    const canvasW = Math.max(256, textW);
    const canvasH = 56;

    const canvas = document.createElement('canvas');
    canvas.width  = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext('2d');
    ctx.font = `bold ${fontSize}px Cinzel, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Class color — fallback to radiant purple for unmapped classes
    const hex = treeColor(cls);
    const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
    ctx.fillStyle = `rgba(${r},${g},${b},0.92)`;
    ctx.fillText(cls, canvasW / 2, canvasH / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    const mat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.position.set(x, y, 0.5);
    // Width scales with canvas so long names stay legible
    sprite.scale.set(canvasW / canvasH, 1, 1);
    mainGroup.add(sprite);
  }

  // ---- TABELA METÁLICA (aba Metalnascida) ----
  // O caminho fica no centro como um cubo; cada Arte Metálica escolhida ocupa uma
  // posição num anel gravado, agrupada por categoria como na tabela alomântica,
  // e sua árvore se abre em leque para fora.

  // Layout radial "arrumado": cada nó recebe uma fatia angular proporcional às
  // folhas da sua subárvore; raio = R0 + profundidade × passo.
  // rootPos (opcional) fixa a raiz fora do leque — usado pelos metais do anel interno,
  // cuja árvore começa só depois do anel externo.
  function layoutRadialTree(skills, root, findDep, angle, span, R0, step, positions, rootPos) {
    const kids = {};
    const parentOf = {};
    for (const s of skills) kids[s.id] = [];
    // Árvore geradora: primeiro pai resolvido (na ordem dos deps) vira o "pai" do layout
    const byDepth = [...skills].sort((a, b) => a.rank - b.rank);
    for (const s of byDepth) {
      if (s === root) continue;
      let parent = null;
      for (const d of s.deps) {
        const p = findDep(d);
        if (p && kids[p.id] && p !== s && p.rank < s.rank) { parent = p; break; }
      }
      if (!parent) parent = root;
      parentOf[s.id] = parent.id;
      kids[parent.id].push(s);
    }
    const leaves = {};
    const countLeaves = (s, seen = new Set()) => {
      if (seen.has(s.id)) return 1;
      seen.add(s.id);
      const k = kids[s.id];
      leaves[s.id] = k.length ? k.reduce((acc, c) => acc + countLeaves(c, seen), 0) : 1;
      return leaves[s.id];
    };
    countLeaves(root);
    const place = (s, a0, a1, depth) => {
      const a = (a0 + a1) / 2;
      const r = R0 + depth * step;
      positions[s.id] = { x: Math.cos(a) * r, y: Math.sin(a) * r, z: 0 };
      const k = kids[s.id];
      const total = k.reduce((acc, c) => acc + (leaves[c.id] || 1), 0) || 1;
      let cur = a0;
      for (const c of k) {
        const w = (a1 - a0) * (leaves[c.id] || 1) / total;
        place(c, cur, cur + w, depth + 1);
        cur += w;
      }
    };
    place(root, angle - span / 2, angle + span / 2, 0);
    if (rootPos) positions[root.id] = { ...rootPos };
    return positions;
  }

  function createTextSprite(text, x, y, opts = {}) {
    const fontSize = opts.size || 22;
    const weight = opts.bold ? 'bold ' : '';
    const tmp = document.createElement('canvas').getContext('2d');
    tmp.font = `${weight}${fontSize}px Cinzel, serif`;
    const w = Math.max(64, Math.ceil(tmp.measureText(text).width) + 20);
    const h = Math.ceil(fontSize * 1.8);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.font = `${weight}${fontSize}px Cinzel, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = opts.color || 'rgba(220,225,235,0.9)';
    ctx.fillText(text, w / 2, h / 2);
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
    const worldH = opts.height || 0.7;
    sprite.scale.set(worldH * w / h, worldH, 1);
    sprite.position.set(x, y, 0.2);
    mainGroup.add(sprite);
    return sprite;
  }

  function hexToRgba(hex, a) {
    return `rgba(${(hex >> 16) & 255},${(hex >> 8) & 255},${hex & 255},${a})`;
  }

  function addRing(radius, color, opacity, segments = 128, a0 = 0, a1 = Math.PI * 2) {
    const pts = [];
    for (let i = 0; i <= segments; i++) {
      const a = a0 + (a1 - a0) * i / segments;
      pts.push(new THREE.Vector3(Math.cos(a) * radius, Math.sin(a) * radius, -0.15));
    }
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
    mainGroup.add(line);
    return line;
  }

  // Posições da Tabela dos Metais Alomânticos (graus; 0° = direita, 90° = topo).
  // Metais externos no anel de fora, internos no de dentro; os de "puxar" ficam do
  // lado do eixo vertical e os de "empurrar" do lado horizontal, como no livro.
  // `root` = onde fica a moeda do poder; `sector` = centro da fatia do ramo dele.
  // Quadrantes: Físico (sup. esq.), Mental (sup. dir.), Aprimoramento (inf. esq.),
  // Temporal (inf. dir.). A Feruquemia usa as mesmas posições por metal.
  const TABLE_SLOTS = {
    ferro:       { root: 117, sector: 106.5, ring: 'out' },
    estanho:     { root: 117, sector: 125.5, ring: 'in'  },
    peltre:      { root: 160, sector: 144.5, ring: 'in'  },
    aco:         { root: 160, sector: 163.5, ring: 'out' },
    zinco:       { root: 66,  sector: 73.5,  ring: 'out' },
    cobre:       { root: 66,  sector: 54.5,  ring: 'in'  },
    bronze:      { root: 20,  sector: 35.5,  ring: 'in'  },
    latao:       { root: 20,  sector: 16.5,  ring: 'out' },
    nicrosil:    { root: 200, sector: 196.5, ring: 'out' },
    duraluminio: { root: 200, sector: 215.5, ring: 'in'  },
    aluminio:    { root: 246, sector: 234.5, ring: 'in'  },
    cromo:       { root: 246, sector: 253.5, ring: 'out' },
    cadmio:      { root: 294, sector: 286.5, ring: 'out' },
    ouro:        { root: 294, sector: 305.5, ring: 'in'  },
    electro:     { root: 340, sector: 324.5, ring: 'in'  },
    bendaliga:   { root: 340, sector: 343.5, ring: 'out' },
    atium:       { root: 90,  sector: 90,    ring: 'out', span: 13 }, // metal divino, fora dos quadrantes
  };
  const SLOT_SPAN = 19; // graus de cada fatia de ramo
  const QUADRANTS = [ // centro do quadrante e metais internos (para o arco interno)
    { center: 135, inner: ['estanho', 'peltre'],        name: { allo: 'Físico',        feru: 'Físico' } },
    { center: 45,  inner: ['cobre', 'bronze'],          name: { allo: 'Mental',        feru: 'Cognitivo' } },
    { center: 225, inner: ['duraluminio', 'aluminio'],  name: { allo: 'Aprimoramento', feru: 'Espiritual' } },
    { center: 315, inner: ['ouro', 'electro'],          name: { allo: 'Temporal',      feru: 'Híbrido' } },
  ];
  const deg = d => d * Math.PI / 180;

  function buildMetalbornTree(pathCls, artTrees, unlockedSkills, keepView, canUnlockFn) {
    _viewMode = 'metal'; // zoom mais aberto, como na visão "Todas"
    currentClass = pathCls;
    _canUnlockFn = canUnlockFn || null;
    const savedPos  = keepView && mainGroup ? { x: mainGroup.position.x, y: mainGroup.position.y } : null;
    const savedZoom = keepView && camera ? camera.position.z : null;
    clearTree();

    // Vista frontal, sem inclinação: é uma tabela gravada
    mainGroup.rotation.set(0, 0, 0);

    const positions = {};
    const nodeState = s => {
      const u = unlockedSkills.has(s.id);
      return { u, c: !u && _canUnlockFn ? _canUnlockFn(s) : false };
    };

    const { skills: pSkills } = CosData.buildMetalGraph(pathCls);
    const key = CosData.getRootMetalSkill(pathCls);
    if (!key) return;
    const pathInfo = CosData.METALBORN_PATHS[pathCls] || {};
    // Nascido da Bruma / Feruquemista veem a tabela inteira; Brumoso, Ferroso e
    // Duplonato veem só os ramos a que têm acesso, num layout compacto.
    const tableMode = pathInfo.allo === 'all' || pathInfo.feru === 'all';
    const tableArt  = pathInfo.feru === 'all' ? 'feru' : 'allo';

    const trees = artTrees.map(cls => ({ cls, metal: CosData.getMetalOfTree(cls), art: CosData.getArtOfTree(cls) }))
      .filter(t => t.metal && t.art)
      .sort((a, b) => (a.art === b.art ? 0 : a.art === 'allo' ? -1 : 1));

    const hubStep = 1.55;
    const step = 1.75;
    const hubDepth = Math.max(1, ...pSkills.map(s => s.rank));
    const hubR = hubDepth * hubStep + 0.9;
    const pathColor = treeColor(pathCls);
    const artPositions = [];
    const labelPoints = [];

    if (tableMode) {
      // 1. Cubo central: árvore do caminho em leque de 360°
      layoutRadialTree(pSkills, key, d => CosData.findMetalSkillByName(d, pathCls), Math.PI / 2, Math.PI * 2, 0, hubStep, positions);
      const Rin  = hubR + 1.5;
      const Rout = Rin + 2.3;

      // 2. Gravação da tabela: anel externo, arcos internos por quadrante, eixos
      addRing(hubR, pathColor, 0.35);
      addRing(Rout, 0x8e9aaa, 0.55);
      addRing(Rout + 0.35, 0x8e9aaa, 0.18);
      for (const [a0, a1] of [[0, 0], [90, 90], [180, 180], [270, 270]]) {
        const len = a0 === 90 ? Rout - 0.4 : Rout + 0.6; // no topo o eixo para no Atium
        mainGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(Math.cos(deg(a0)) * hubR, Math.sin(deg(a0)) * hubR, -0.15),
          new THREE.Vector3(Math.cos(deg(a1)) * len, Math.sin(deg(a1)) * len, -0.15),
        ]), new THREE.LineBasicMaterial({ color: 0x8e9aaa, transparent: true, opacity: 0.35, depthWrite: false })));
      }
      const lineCol = tableArt === 'feru' ? FERU_LINE : ALLO_LINE;
      for (const q of QUADRANTS) {
        const [i0, i1] = q.inner.map(k => TABLE_SLOTS[k].sector);
        addRing(Rin, lineCol, 0.45, 32, deg(Math.min(i0, i1)), deg(Math.max(i0, i1)));
        const lr = Rin + 1.15;
        createTextSprite(q.name[tableArt].toUpperCase(), Math.cos(deg(q.center)) * lr, Math.sin(deg(q.center)) * lr,
          { size: 22, bold: true, height: 0.55, color: hexToRgba(lineCol, 0.85) });
      }

      // 3. Árvores das Artes nas posições da tabela
      for (const t of trees) {
        const slot = TABLE_SLOTS[t.metal.key];
        if (!slot) continue;
        const { skills } = CosData.buildMetalGraph(t.cls);
        const root = CosData.getRootMetalSkill(t.cls);
        if (!root) continue;
        const rootR = slot.ring === 'in' ? Rin : Rout;
        // Moeda alinhada com o próprio ramo: linhas de metais vizinhos não se cruzam
        const rootPos = { x: Math.cos(deg(slot.sector)) * rootR, y: Math.sin(deg(slot.sector)) * rootR, z: 0 };
        const depth = Math.max(0, ...skills.map(s => s.rank));
        layoutRadialTree(skills, root, d => CosData.findMetalSkillByName(d, t.cls),
          deg(slot.sector), deg((slot.span || SLOT_SPAN) * 0.82), Rout, step, positions, rootPos);
        artPositions.push({ t, skills, root, spokeAngle: deg(slot.sector), labelAngle: deg(slot.sector), outer: Rout + depth * step });
      }
    } else {
      // Compacto: caminho em leque para baixo, ramos dos poderes para cima
      layoutRadialTree(pSkills, key, d => CosData.findMetalSkillByName(d, pathCls), -Math.PI / 2, deg(220), 0, hubStep * 1.3, positions);
      const N = trees.length;
      const angles = N === 1 ? [90] : [135, 45];
      const span = N === 1 ? 130 : 80;
      const R = 2.4;
      trees.forEach((t, i) => {
        const { skills } = CosData.buildMetalGraph(t.cls);
        const root = CosData.getRootMetalSkill(t.cls);
        if (!root) return;
        const depth = Math.max(0, ...skills.map(s => s.rank));
        layoutRadialTree(skills, root, d => CosData.findMetalSkillByName(d, t.cls), deg(angles[i]), deg(span), R, step, positions);
        artPositions.push({ t, skills, root, spokeAngle: deg(angles[i]), labelAngle: deg(angles[i]), outer: R + depth * step, fromKey: true });
      });
    }

    // 5. Nós
    for (const s of pSkills) {
      const st = nodeState(s);
      createNode(s, positions[s.id], st.u, st.c, pathCls);
    }
    for (const { t, skills } of artPositions) {
      addTreeGlyph(t.cls, skills.filter(s => s.rank > 0).map(s => positions[s.id]));
      for (const s of skills) {
        if (!positions[s.id]) continue;
        const st = nodeState(s);
        createNode(s, positions[s.id], st.u, st.c, t.cls);
      }
    }

    // 6. Conexões: árvore do caminho, cubo → poderes e dentro de cada Arte
    for (const s of pSkills) {
      for (const d of s.deps) {
        const p = CosData.findMetalSkillByName(d, pathCls);
        if (p && positions[p.id]) createConnection(positions[p.id], positions[s.id], s, p, unlockedSkills, pathCls);
      }
    }
    for (const { t, skills, root, spokeAngle, labelAngle, outer, fromKey } of artPositions) {
      // Raio do cubo até o poder: o Alomântico "puxando" o metal
      const from = fromKey ? positions[key.id] : { x: Math.cos(spokeAngle) * hubR, y: Math.sin(spokeAngle) * hubR, z: 0 };
      createConnection(from, positions[root.id], root, key, unlockedSkills, t.cls);
      for (const s of skills) {
        for (const d of s.deps) {
          const p = CosData.findMetalSkillByName(d, t.cls);
          if (p && positions[p.id] && positions[s.id]) createConnection(positions[p.id], positions[s.id], s, p, unlockedSkills, t.cls);
        }
      }
      // Rótulos: nome do metal + nome do Brumoso/Ferroso
      const info = t.metal[t.art];
      const who = t.art === 'allo' ? info.misting : info.ferring;
      const ld = outer + 1.5;
      const lx = Math.cos(labelAngle) * ld, ly = Math.sin(labelAngle) * ld;
      const mcol = treeColor(t.cls);
      createTextSprite(t.metal.name, lx, ly + 0.3, { size: 30, bold: true, height: 0.95, color: hexToRgba(mcol, 1) });
      // Na tabela inteira a Arte é a mesma para todos, então só o nome do Brumoso/Ferroso
      createTextSprite(tableMode ? who : `${t.art === 'allo' ? 'Alomancia' : 'Feruquemia'} · ${who}`,
        lx, ly - 0.45, { size: 20, height: tableMode ? 0.42 : 0.5, color: 'rgba(200,208,220,0.8)' });
      labelPoints.push({ x: lx, y: ly });
    }

    // Rótulo do caminho: abaixo do cubo (tabela) ou abaixo do leque do caminho (compacto)
    let pathLabelY = -hubR - 0.7;
    if (!tableMode) pathLabelY = Math.min(...pSkills.map(s => positions[s.id].y)) - 1.1;
    createTextSprite(pathCls, 0, pathLabelY, { size: 30, bold: true, height: 0.85, color: hexToRgba(pathColor, 1) });
    labelPoints.push({ x: 0, y: pathLabelY });

    if (savedPos) {
      mainGroup.position.x = savedPos.x;
      mainGroup.position.y = savedPos.y;
      camera.position.z = savedZoom;
      camera.position.x = 0; camera.position.y = 0;
      camera.rotation.set(0, 0, 0);
    } else {
      // Enquadra nós + rótulos (o layout compacto não é centrado na origem)
      const pts = [...Object.values(positions), ...labelPoints];
      const minX = Math.min(...pts.map(p => p.x)) - 2.2, maxX = Math.max(...pts.map(p => p.x)) + 2.2;
      const minY = Math.min(...pts.map(p => p.y)) - 1.2, maxY = Math.max(...pts.map(p => p.y)) + 1.2;
      mainGroup.position.set(-(minX + maxX) / 2, -(minY + maxY) / 2, 0);
      camera.rotation.set(0, 0, 0);
      const halfFov = (camera.fov / 2) * Math.PI / 180;
      const zFit = Math.max(((maxY - minY) / 2) / Math.tan(halfFov), ((maxX - minX) / 2) / (Math.tan(halfFov) * camera.aspect));
      camera.position.set(0, 0, Math.min(95, Math.max(10, zFit)));
    }
  }

  function getViewMode() { return _viewMode; }

  function buildSingleTree(cls, unlockedSkills, periciaValues, keepView, canUnlockFn) {
    _viewMode = 'single';
    // Additional classes (Cantor race tree, etc.)
    if (CosData.ADDITIONAL_CLASSES.includes(cls)) {
      _canUnlockFn = canUnlockFn || null;
      currentClass = cls;
      const savedPos  = keepView && mainGroup ? { x: mainGroup.position.x, y: mainGroup.position.y } : null;
      const savedZoom = keepView && camera ? camera.position.z : null;
      clearTree();
      const { skills, children } = CosData.buildAdditionalGraph(cls);
      const root = CosData.getRootAdditionalSkill(cls);
      if (!root) return;
      const positions = computeLayout(cls, skills, children, root);
      for (const skill of skills) {
        const pos = positions[skill.id];
        if (!pos) continue;
        const isUnlocked = unlockedSkills.has(skill.id);
        const canUnlock  = !isUnlocked && _canUnlockFn ? _canUnlockFn(skill) : false;
        createNode(skill, pos, isUnlocked, canUnlock, cls, periciaValues);
      }
      for (const skill of skills) {
        const posTo = positions[skill.id];
        if (!posTo) continue;
        for (const depName of skill.deps) {
          const parent = CosData.findAdditionalSkillByName(depName, cls);
          if (parent && positions[parent.id]) {
            createConnection(positions[parent.id], posTo, skill, parent, unlockedSkills, cls);
          }
        }
      }
      addSubLabels(cls, skills, positions, CosData.ADDITIONAL_SUBCLASSES[cls]);
      if (savedPos) {
        mainGroup.position.x = savedPos.x;
        mainGroup.position.y = savedPos.y;
        camera.position.z = savedZoom;
      } else {
        centerCamera(positions);
      }
      return;
    }
    // Radiant classes use a different data source
    if (CosData.RADIANT_CLASSES.includes(cls)) {
      _canUnlockFn = canUnlockFn || null;
      currentClass = cls;
      const savedPos  = keepView && mainGroup ? { x: mainGroup.position.x, y: mainGroup.position.y } : null;
      const savedZoom = keepView && camera ? camera.position.z : null;
      clearTree();
      const { skills, children } = CosData.buildRadiantGraph(cls);
      const root = CosData.getRootRadiantSkill(cls);
      if (!root) return;
      const positions = computeLayout(cls, skills, children, root);
      for (const skill of skills) {
        const pos = positions[skill.id];
        if (!pos) continue;
        const isUnlocked = unlockedSkills.has(skill.id);
        const canUnlock  = !isUnlocked && _canUnlockFn ? _canUnlockFn(skill) : false;
        createNode(skill, pos, isUnlocked, canUnlock, cls, periciaValues);
      }
      for (const skill of skills) {
        const posTo = positions[skill.id];
        if (!posTo) continue;
        for (const depName of skill.deps) {
          const parent = CosData.findRadiantSkillByName(depName, cls);
          if (parent && positions[parent.id]) {
            createConnection(positions[parent.id], posTo, skill, parent, unlockedSkills, cls);
          }
        }
      }
      addSubLabels(cls, skills, positions, CosData.RADIANT_SUBCLASSES[cls]);

      // Render disconnected additional sub-trees for this radiant class (e.g. Iluminado for Sentinela da Verdade)
      let allPositions = { ...positions };
      const addlSkills = CosData.getAdditionalSkillsByClass(cls);
      if (addlSkills.length > 0) {
        const addlRoot = CosData.getRootAdditionalSkill(cls);
        if (addlRoot) {
          const { skills: aSkills, children: aChildren } = CosData.buildAdditionalGraph(cls);
          const rawAddlPos = computeLayout(cls + '_addl', aSkills, aChildren, addlRoot);

          // Place additional tree below the main tree with a gap
          const mainYMin = Math.min(...Object.values(positions).map(p => p.y));
          const addlYMax = Math.max(...Object.values(rawAddlPos).map(p => p.y));
          const offsetY = mainYMin - addlYMax - 3;

          const addlPositions = {};
          for (const [id, pos] of Object.entries(rawAddlPos)) {
            addlPositions[id] = { x: pos.x, y: pos.y + offsetY, z: pos.z };
          }

          for (const skill of aSkills) {
            const pos = addlPositions[skill.id];
            if (!pos) continue;
            const isUnlocked = unlockedSkills.has(skill.id);
            const canUnlock  = !isUnlocked && _canUnlockFn ? _canUnlockFn(skill) : false;
            createNode(skill, pos, isUnlocked, canUnlock, cls, periciaValues);
          }
          for (const skill of aSkills) {
            const posTo = addlPositions[skill.id];
            if (!posTo) continue;
            for (const depName of skill.deps) {
              const parent = CosData.findAdditionalSkillByName(depName, cls);
              if (parent && addlPositions[parent.id]) {
                createConnection(addlPositions[parent.id], posTo, skill, parent, unlockedSkills, cls);
              }
            }
          }
          addSubLabels(cls, aSkills, addlPositions, CosData.ADDITIONAL_SUBCLASSES[cls]);
          allPositions = { ...allPositions, ...addlPositions };
        }
      }

      if (savedPos) {
        mainGroup.position.x = savedPos.x;
        mainGroup.position.y = savedPos.y;
        camera.position.z = savedZoom;
      } else {
        centerCamera(allPositions);
      }
    } else {
      buildTree(cls, unlockedSkills, periciaValues, keepView, canUnlockFn);
    }
  }

  // Calcula o Z ideal para que todos os nós fornecidos caibam na tela
  function calculateFitZoom(nodes, padding = 2.5) {
    if (!nodes || nodes.length === 0) return CAMERA_DISTANCE;

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    nodes.forEach(obj => {
      const p = obj.pos;
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    });

    const width = (maxX - minX) + padding * 2;
    const height = (maxY - minY) + padding * 2;

    const halfFovRad = (camera.fov / 2) * Math.PI / 180;
    
    // Distância necessária para caber a altura
    const zForHeight = (height / 2) / Math.tan(halfFovRad);
    // Distância necessária para caber a largura (considerando o aspect ratio)
    const zForWidth = (width / 2) / (Math.tan(halfFovRad) * camera.aspect);

    // Retorna o maior dos dois, com um limite mínimo e máximo de segurança
    return Math.min(50, Math.max(12, Math.max(zForHeight, zForWidth)));
  }

  // ---- ANIMATION: ROLETA EM TAMANHO REAL ----
  function transitionToClass(oldClass, newClass, stateData, onComplete) {
    clearTree();

    const allEntries = [];
    if (stateData.radiantClass) allEntries.push({ cls: stateData.radiantClass, isRadiant: true });
    CosData.CLASSES.forEach(cls => allEntries.push({ cls, isRadiant: false }));
    if (stateData.additionalClasses && stateData.additionalClasses.length) {
      stateData.additionalClasses.forEach(cls => allEntries.push({ cls, isRadiant: false, isAdditional: true }));
    }

    const total = allEntries.length;
    const R = 45; 

    let oldCx = 0, oldCy = 0;
    let newCx = 0, newCy = 0;

    allEntries.forEach((entry, idx) => {
      const angle = Math.PI / 2 - (2 * Math.PI * idx / total);
      const cx = Math.cos(angle) * R;
      const cy = Math.sin(angle) * R;

      let graph;
      if (entry.isRadiant) graph = CosData.buildRadiantGraph(entry.cls);
      else if (entry.isAdditional) graph = CosData.buildAdditionalGraph(entry.cls);
      else graph = CosData.buildGraph(entry.cls);

      const root = entry.isRadiant ? CosData.getRootRadiantSkill(entry.cls) :
                   entry.isAdditional ? CosData.getRootAdditionalSkill(entry.cls) :
                   CosData.getRootSkill(entry.cls);

      if (!root) return;

      const localPos = computeLayout(entry.cls, graph.skills, graph.children, root);
      const treePositions = {};

      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

      graph.skills.forEach(skill => {
        if (!localPos[skill.id]) return;
        const lp = localPos[skill.id];

        if (lp.x < minX) minX = lp.x;
        if (lp.x > maxX) maxX = lp.x;
        if (lp.y < minY) minY = lp.y;
        if (lp.y > maxY) maxY = lp.y;
        
        const rot = angle - Math.PI / 2;
        const rx = lp.x * Math.cos(rot) - lp.y * Math.sin(rot);
        const ry = lp.x * Math.sin(rot) + lp.y * Math.cos(rot);

        const pos = { x: cx + rx, y: cy + ry, z: lp.z };
        treePositions[skill.id] = pos;

        const isUnlocked = stateData.unlockedSkills.has(skill.id);
        const canUnlock = !isUnlocked && stateData.canUnlockFn ? stateData.canUnlockFn(skill) : false;
        
        createNode(skill, pos, isUnlocked, canUnlock, entry.cls, stateData.pericias);
        
        const lastNode = nodeObjects[nodeObjects.length - 1];
        lastNode.treeCls = entry.cls;
      });

      if (minX !== Infinity) {
        const center_x = (minX + maxX) / 2;
        const center_y = minY + (maxY - minY) * 0.25;
        if (entry.cls === oldClass) { oldCx = center_x; oldCy = center_y; }
        if (entry.cls === newClass) { newCx = center_x; newCy = center_y; }
      }

      graph.skills.forEach(skill => {
        if (!treePositions[skill.id]) return;
        skill.deps.forEach(depName => {
          const findFn = entry.isRadiant ? CosData.findRadiantSkillByName :
                         entry.isAdditional ? CosData.findAdditionalSkillByName :
                         CosData.findSkillByName;
          const parent = findFn(depName, entry.cls);
          if (parent && treePositions[parent.id]) {
            createConnection(treePositions[parent.id], treePositions[skill.id], skill, parent, stateData.unlockedSkills, entry.cls);
          }
        });
      });
    });

    if (oldClass === '_all') {
      oldCx = newCx;
      oldCy = newCy;
    }

    const oldIdx = oldClass === '_all' ? 0 : Math.max(0, allEntries.findIndex(e => e.cls === oldClass));
    const newIdx = newClass === '_all' ? 0 : Math.max(0, allEntries.findIndex(e => e.cls === newClass));

    const oldAngle = Math.PI / 2 - (2 * Math.PI * oldIdx / total);
    const newAngle = Math.PI / 2 - (2 * Math.PI * newIdx / total);

    let startRot = (Math.PI / 2) - oldAngle;
    let endRot = (Math.PI / 2) - newAngle;

    while (endRot - startRot > Math.PI) endRot -= Math.PI * 2;
    while (endRot - startRot < -Math.PI) endRot += Math.PI * 2;

    // --- CORREÇÃO DA ROTAÇÃO E EIXOS ---
    const tiltX = -0.09;
    const rCos = R * Math.cos(tiltX);
    const rSin = R * Math.sin(tiltX);

    mainGroup.rotation.order = 'ZXY';
    mainGroup.rotation.set(tiltX, 0, startRot);
    mainGroup.position.set(-oldCx, -oldCy - rCos, -rSin);

    const baseZ = 18; 
    const peakZ = 38; 
    camera.position.set(0, -2, baseZ);
    camera.rotation.x = 0.3;

    // --- CORREÇÃO DO FLARE/RASTRO ---
    const wheelNodes = [...nodeObjects];
    nodeObjects = []; 

    const unlockedNodes = wheelNodes.filter(n => n.mesh.userData.isUnlocked);
    const newTreeNodes = wheelNodes.filter(n => n.treeCls === newClass);
    const targetZoom = calculateFitZoom(newTreeNodes); // Calcula o zoom ideal

    const duration = 1100;
    const startTime = performance.now();

    const vPos = new THREE.Vector3();

    function animateStep(time) {
      let t = (time - startTime) / duration;
      if (t > 1) t = 1;

      const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

      // Interpola a rotação e a posição central
      mainGroup.rotation.set(tiltX, 0, startRot + (endRot - startRot) * ease);
      const currentCx = oldCx + (newCx - oldCx) * ease;
      const currentCy = oldCy + (newCy - oldCy) * ease;
      mainGroup.position.set(-currentCx, -currentCy - rCos, -rSin);

      // Zoom Out Corrigido
      const zoomOutCurve = Math.sin(t * Math.PI);
      const currentBaseZ = baseZ + (targetZoom - baseZ) * ease;
      camera.position.z = currentBaseZ + zoomOutCurve * (peakZ - baseZ);

      // Flare massivo
      const flare = Math.sin(t * Math.PI);
      
      unlockedNodes.forEach(obj => {
        const baseGlowScale = obj.skill.rank === 0 ? 3.2 : 2.2;
        obj.glowMesh.scale.setScalar(baseGlowScale + flare * 4.0); 
        obj.glowMat.opacity = 0.45 + flare * 0.65;
        
        const baseColor = obj.skill.rank === 0 ? obj.rootColor : obj.baseColor;
        obj.crystalMat.emissive = new THREE.Color(baseColor).multiplyScalar((obj.skill.rank === 0 ? 1.5 : 0.9) + flare * 4.0);

        // --- STAR TRAIL EFFECT ---
        if (t > 0.05 && t < 0.95 && Math.random() > 0.3) {
          obj.mesh.getWorldPosition(vPos);
          const mat = new THREE.SpriteMaterial({
            map: getGlowTexture(),
            color: baseColor,
            transparent: true,
            opacity: 0.8,
            blending: THREE.AdditiveBlending,
            depthWrite: false
          });
          const sprite = new THREE.Sprite(mat);
          sprite.position.copy(vPos);
          
          sprite.position.x += (Math.random() - 0.5) * 0.8;
          sprite.position.y += (Math.random() - 0.5) * 0.8;
          sprite.position.z += (Math.random() - 0.5) * 0.8;

          const baseScale = obj.skill.rank === 0 ? 3.5 : 2.0;
          sprite.scale.set(baseScale, baseScale, 1);
          scene.add(sprite);

          smokeParticles.push({
            type: 'trail',
            mesh: sprite,
            life: 1.0,
            decay: 0.02 + Math.random() * 0.03,
            baseScale: baseScale
          });
        }
      });

      // Pulso de infusão na classe alvo
      if (t > 0.6) {
        const highlight = (t - 0.6) / 0.4;
        newTreeNodes.forEach(obj => {
          if (!obj.mesh.userData.isUnlocked) {
            obj.crystalMat.emissive.addScalar(highlight * 0.15);
          }
        });
      }

      // Fade out
      if (t > 0.8) {
        const fadeOut = 1 - (t - 0.8) / 0.2;
        wheelNodes.forEach(n => {
          n.glowMat.opacity  *= fadeOut;
          n.crystalMat.opacity *= fadeOut;
          n.mat.opacity      *= fadeOut;
        });
        for (const obj of lineObjects) {
          obj.mat.opacity *= fadeOut;
        }
      }

      if (t < 1) {
        requestAnimationFrame(animateStep);
      } else {
        mainGroup.rotation.order = 'XYZ';
        mainGroup.rotation.set(-CAMERA_TILT * 0.3, 0, 0);
        mainGroup.position.set(-newCx, -newCy, 0);
        
        // Posição final com o zoom calculado
        camera.position.set(0, -2, targetZoom); 
        camera.rotation.x = 0.3;

        onComplete();
      }
    }

    requestAnimationFrame(animateStep);
  }
  return { init, buildTree: buildSingleTree, buildAllTrees, buildMetalbornTree, updateStates, setCallbacks, clearTree, destroy, getViewMode, transitionToClass, setConfig, getConfig, setTheme, getTheme };

})();
