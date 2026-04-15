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
    'Dançarino dos Precipícios': 0x34d399,  // esmeralda
    'Sentinela da Verdade':      0x2dd4bf,  // água-marinha
    'Teceluz':                   0xf0abfc,  // lilás
    'Alternauta':                0xe2e8f0,  // prata
    'Plasmador':                 0xc084fc,  // roxo
    'Guardião das Pedras':       0xa87d4e,  // terracota
    // Ancestralidade
    'Cantor':                    0xe07b54,  // terracota-laranja
  };

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
    'Dançarino dos Precipícios': 'svg/Edgedancers_glyph.svg',
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

    // Background particles (storm dust)
    createBackgroundParticles();

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
      const zoomMax = _viewMode === 'all' ? 90 : 55;
      const zoomMin = _viewMode === 'all' ? 10 : 5;
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
        const zoomMax = _viewMode === 'all' ? 90 : 55;
        const zoomMin = _viewMode === 'all' ? 10 : 5;
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
  }

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
        const parent = CosData.findSkillByName(depName, cls);
        if (parent && positions[parent.id]) {
          createConnection(positions[parent.id], posTo, skill, parent, unlockedSkills, cls);
        }
      }
    }

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
    const subs = CosData.SUBCLASSES[cls] || CosData.RADIANT_SUBCLASSES[cls] || CosData.ADDITIONAL_SUBCLASSES[cls] || [];
    const rng = seededRng(classToSeed(cls));
    const subCount = subs.length;

    // Root at center
    positions[root.id] = { x: 0, y: 0, z: 0 };

    // When baseAngle is given (all-view), radiate away from circle center.
    // Otherwise fan upward for single-view.
    const arcCenter = baseAngle !== undefined ? baseAngle : Math.PI / 2;
    const arcSpan   = Math.PI * 0.68;
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
        const branchSpread = 0.35;
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
          const dist = RANK_Y_SPACING * (0.85 + rng() * 0.3);

          // Organic wobble: deviate from PARENT'S actual direction (accumulated),
          // with a gentle pull back toward the branch origin to avoid full U-turns
          const wobble = (rng() - 0.5) * 0.9;
          const pullBack = (offsetAngle - parentAngle) * 0.1;
          const angle = parentAngle + wobble + pullBack;

          let x = parentX + Math.cos(angle) * dist;
          let y = parentY + Math.sin(angle) * dist;
          const z = (rng() - 0.5) * 0.4;

          // Clamp to max radius (all-view: keeps tree within its sector)
          if (maxLocalRadius !== undefined) {
            const r = Math.sqrt(x * x + y * y);
            if (r > maxLocalRadius) { x *= maxLocalRadius / r; y *= maxLocalRadius / r; }
          }

          positions[skill.id] = { x, y, z };
          layoutEdges.push({ aId: parentId, bId: skill.id });

          const kids = childrenMap[skill.name] || [];
          const validKids = kids.filter(k => !visited.has(k.id));

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
    const minNodeDist = 1.8;
    const minEdgeDist = 1.6;
    for (let iter = 0; iter < 20; iter++) {
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
  function createNode(skill, pos, isUnlocked, canUnlock, cls, periciaValues) {
    const baseColor = isUnlocked ? COLOR_MAP[cls] : canUnlock ? COLOR_MAP[cls] : COLOR_LOCKED;
    const glowColor = isUnlocked ? COLOR_MAP[cls] : canUnlock ? COLOR_MAP[cls] : COLOR_LOCKED;

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
    const mat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      emissive: new THREE.Color(baseColor).multiplyScalar(isUnlocked ? 0.18 : canUnlock ? 0.07 : 0.02),
      roughness: 0.05,
      metalness: 0.0,
      transparent: true,
      opacity: 0.3,
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
      opacity: isUnlocked ? 0.70 : canUnlock ? 0.25 : 0.06,
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
    const rootColor = COLOR_MAP[cls] || COLOR_UNLOCKED;
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
        mat.opacity = 0.25;
        glowMat.opacity = 0.70;
      } else {
        glowMesh.scale.set(2.0, 2.0, 1);
        crystalMat.emissive = new THREE.Color(rootColor).multiplyScalar(0.25);
        crystalMat.opacity = 0.45;
        mat.emissive = new THREE.Color(rootColor).multiplyScalar(0.03);
        mat.opacity = 0.18;
        glowMat.opacity = 0.15;
      }
    }

    mesh.userData = { skill, isUnlocked, canUnlock };
    const obj = { mesh, skill, glowMesh, crystalMesh, crystalMat, pos, mat, glowMat, baseColor, rootColor };
    nodeObjects.push(obj);
    if (isUnlocked) createGemEmitter(obj);
  }

  // ---- CREATE CONNECTION (Smoke Trail Line) ----
  function createConnection(from, to, childSkill, parentSkill, unlockedSkills, cls) {
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
      opacity: isActive ? 0.5 : 0.12,
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

      // Slow crystal tumble
      obj.crystalMesh.rotation.x += 0.003;
      obj.crystalMesh.rotation.y += 0.005;

      if (obj.skill.rank === 0) {
        obj.crystalMesh.rotation.y = time * 0.3;
        if (obj.mesh.userData.isUnlocked) {
          const gs = 3.0 + pulse * 0.4;
          obj.glowMesh.scale.set(gs, gs, 1);
          obj.glowMat.opacity = 0.35 + pulse * 0.2;
          obj.crystalMat.emissive = new THREE.Color(obj.rootColor).multiplyScalar(0.8 + pulse * 0.5);
        } else {
          obj.glowMat.opacity = 0.08 + pulse * 0.07;
          obj.crystalMat.emissive = new THREE.Color(obj.rootColor).multiplyScalar(0.12 + pulse * 0.13);
        }
      } else if (obj.mesh.userData.isUnlocked) {
        const gs = 2.0 + pulse * 0.4;
        obj.glowMesh.scale.set(gs, gs, 1);
        obj.glowMat.opacity = 0.25 + pulse * 0.2;
        obj.crystalMat.emissive = new THREE.Color(obj.baseColor).multiplyScalar(0.5 + pulse * 0.5);
        obj.mat.emissive = new THREE.Color(obj.baseColor).multiplyScalar(0.04 + pulse * 0.06);
      } else if (obj.mesh.userData.canUnlock) {
        const gs = 1.4 + pulse * 0.2;
        obj.glowMesh.scale.set(gs, gs, 1);
        obj.glowMat.opacity = 0.08 + pulse * 0.1;
        obj.crystalMat.emissive = new THREE.Color(obj.baseColor).multiplyScalar(0.15 + pulse * 0.15);
      } else {
        obj.glowMat.opacity = 0.03 + pulse * 0.03;
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

    // Animate background particles
    scene.traverse(obj => {
      if (obj.isPoints && obj.userData.type === 'bgParticles') {
        const pos = obj.geometry.attributes.position.array;
        const speeds = obj.userData.speeds;
        for (let i = 0; i < speeds.length; i++) {
          pos[i*3+1] += speeds[i] * 0.005;
          pos[i*3]   += Math.sin(time + i) * 0.001;
          if (pos[i*3+1] > 20) pos[i*3+1] = -20;
        }
        obj.geometry.attributes.position.needsUpdate = true;
      }
    });

    // Raycasting for hover
    raycaster.setFromCamera(mouse, camera);
    const meshes = nodeObjects.flatMap(n => [n.mesh, n.crystalMesh]);
    const intersects = raycaster.intersectObjects(meshes);

    // Reset previous hover
    if (hoveredNode) {
      const scale = hoveredNode.skill.rank === 0 ? 1.5 : 1;
      hoveredNode.mesh.scale.setScalar(scale);
      hoveredNode.crystalMesh.scale.setScalar(scale);
      hoveredNode = null;
    }

    if (intersects.length > 0) {
      const hit = intersects[0].object;
      const nodeObj = nodeObjects.find(n => n.mesh === hit || n.crystalMesh === hit);
      if (nodeObj) {
        hoveredNode = nodeObj;
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

    // Update connection lines
    for (const obj of lineObjects) {
      if (!obj.skill) continue;
      const wasActive = obj.isActive;
      const isActive  = unlockedSkills.has(obj.skill.id) && (!obj.parentSkill || unlockedSkills.has(obj.parentSkill.id));
      const cls       = obj.cls || currentClass || obj.skill.cls;
      const color     = isActive ? (COLOR_MAP[cls] || COLOR_LOCKED) : COLOR_LOCKED;
      obj.mat.color.setHex(color);
      obj.mat.opacity = isActive ? 0.5 : 0.12;
      if (!wasActive && isActive) {
        createSmokeAlongLine(obj.from, obj.to, COLOR_MAP[cls] || COLOR_LOCKED);
      }
      obj.isActive = isActive;
    }

    for (const obj of nodeObjects) {
      const wasUnlocked = obj.mesh.userData.isUnlocked;
      const isUnlocked = unlockedSkills.has(obj.skill.id);
      const canUnlock = !isUnlocked && _canUnlockFn ? _canUnlockFn(obj.skill) : false;
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
      obj.glowMat.opacity = isUnlocked ? 0.45 : canUnlock ? 0.15 : 0.06;
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
          obj.glowMat.opacity = 0.70;
          obj.glowMesh.scale.set(3.2, 3.2, 1);
        } else {
          obj.crystalMat.emissive = new THREE.Color(rootColor).multiplyScalar(0.25);
          obj.crystalMat.opacity = 0.45;
          obj.mat.emissive = new THREE.Color(rootColor).multiplyScalar(0.03);
          obj.mat.opacity = 0.18;
          obj.glowMat.opacity = 0.15;
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
  function addCosmereCenterSymbol(radiantClass) {
    const svgPath = (radiantClass && RADIANT_SVG_MAP[radiantClass])
      ? RADIANT_SVG_MAP[radiantClass]
      : 'svg/Cosmere_symbol.svg';

    // Tint color: class color for orders, gold for the base Cosmere symbol
    let tintColor = 'rgba(212,168,83,1.0)';
    if (radiantClass) {
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
        opacity: radiantClass ? 0.5 : 0.3,
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
      ctx.drawImage(img, 0, 0, size, size);
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

  function buildAllTrees(unlockedSkills, periciaValues, canUnlockFn, radiantClass, additionalClasses) {
    _viewMode = 'all';
    _canUnlockFn = canUnlockFn || null;
    currentClass = null;

    clearTree();

    // --- Reset camera to flat (no tilt) for panoramic view ---
    mainGroup.rotation.set(0, 0, 0);
    mainGroup.position.set(0, 0, 0);
    camera.position.set(0, 0, 70);
    camera.rotation.set(0, 0, 0);

    const allPositions = {};
    const scale = 0.58;

    // Helper: place one tree at world offset (cx, cy), radiating at outwardAngle
    function placeTree(cls, skills, children, root, cx, cy, outwardAngle, isRadiant) {
      // Max local radius: half the chord between adjacent roots (in local units before scale),
      // with a safety margin so trees stay within their sector
      const chordHalf = (Math.PI * radius / total) / scale * 0.8;
      const localPos = computeLayout(cls, skills, children, root, outwardAngle, chordHalf);
      for (const skill of skills) {
        if (!localPos[skill.id]) continue;
        const lp = localPos[skill.id];
        const pos = { x: cx + lp.x * scale, y: cy + lp.y * scale, z: lp.z };
        allPositions[skill.id] = pos;
        const isUnlocked = unlockedSkills.has(skill.id);
        const canUnlock  = !isUnlocked && _canUnlockFn ? _canUnlockFn(skill) : false;
        createNode(skill, pos, isUnlocked, canUnlock, cls, periciaValues);
      }
      const findFn = isRadiant ? CosData.findRadiantSkillByName : CosData.findSkillByName;
      for (const skill of skills) {
        if (!allPositions[skill.id]) continue;
        for (const depName of skill.deps) {
          const parent = findFn(depName, cls);
          if (parent && allPositions[parent.id]) {
            createConnection(allPositions[parent.id], allPositions[skill.id], skill, parent, unlockedSkills, cls);
          }
        }
      }
      // Place label beyond the outermost nodes, in the outward direction from centre
      const labelDist = 17.5;
      createClassLabel(cls, Math.cos(outwardAngle) * labelDist, Math.sin(outwardAngle) * labelDist);
    }

    // Build full entry list: radiant first (top), then 6 base classes, then additional (Cantor etc.)
    const allEntries = [];
    if (radiantClass) allEntries.push({ cls: radiantClass, isRadiant: true });
    CosData.CLASSES.forEach(cls => allEntries.push({ cls, isRadiant: false }));
    if (additionalClasses && additionalClasses.length) {
      additionalClasses.forEach(cls => allEntries.push({ cls, isRadiant: false, isAdditional: true }));
    }

    const total  = allEntries.length; // 6 without radiant, 7 with
    const radius = 11;

    // Compute root positions — evenly spaced full circle, starting from top
    const rootPositions = allEntries.map((entry, idx) => {
      const angle = Math.PI / 2 - (2 * Math.PI * idx / total);
      return { ...entry, x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, angle };
    });

    // --- Constellation skeleton (behind nodes) ---
    // Spokes: start at inner gap (avoid covering center symbol) → each root
    const spokeInnerR = 3.8;
    for (const rp of rootPositions) {
      mainGroup.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(Math.cos(rp.angle) * spokeInnerR, Math.sin(rp.angle) * spokeInnerR, -0.1),
          new THREE.Vector3(rp.x, rp.y, -0.1),
        ]),
        new THREE.LineBasicMaterial({
          color: rp.isRadiant ? 0xc084fc : 0x2a3a55,
          transparent: true,
          opacity: rp.isRadiant ? 0.4 : 0.5,
          blending: THREE.AdditiveBlending, depthWrite: false,
        })
      ));
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
      if (rp.isRadiant) {
        const { skills, children } = CosData.buildRadiantGraph(rp.cls);
        const root = CosData.getRootRadiantSkill(rp.cls);
        if (root) placeTree(rp.cls, skills, children, root, rp.x, rp.y, rp.angle, true);
      } else if (rp.isAdditional) {
        const { skills, children } = CosData.buildAdditionalGraph(rp.cls);
        const root = CosData.getRootAdditionalSkill(rp.cls);
        if (root) placeTree(rp.cls, skills, children, root, rp.x, rp.y, rp.angle, false);
      } else {
        const { skills, children } = CosData.buildGraph(rp.cls);
        const root = CosData.getRootSkill(rp.cls);
        if (root) placeTree(rp.cls, skills, children, root, rp.x, rp.y, rp.angle, false);
      }
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
      camera.position.z = Math.min(60, Math.max(20, Math.max(zForHeight, zForWidth)));
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
    const hex = COLOR_MAP[cls] !== undefined ? COLOR_MAP[cls] : 0xc084fc;
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
      if (savedPos) {
        mainGroup.position.x = savedPos.x;
        mainGroup.position.y = savedPos.y;
        camera.position.z = savedZoom;
      } else {
        centerCamera(positions);
      }
    } else {
      buildTree(cls, unlockedSkills, periciaValues, keepView, canUnlockFn);
    }
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
    // Projetar a diferença trigonométrica do Tilt da câmera para evitar o pulo 3D no final do zoom
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

    const duration = 1100;
    const startTime = performance.now();
    const vPos = new THREE.Vector3(); // Reutilizado para performance

    function animateStep(time) {
      let t = (time - startTime) / duration;
      if (t > 1) t = 1;

      const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

      // Interpola a rotação e a posição central (com a projeção perfeita do cosseno/seno)
      mainGroup.rotation.set(tiltX, 0, startRot + (endRot - startRot) * ease);
      const currentCx = oldCx + (newCx - oldCx) * ease;
      const currentCy = oldCy + (newCy - oldCy) * ease;
      mainGroup.position.set(-currentCx, -currentCy - rCos, -rSin);

      // Zoom Out
      const zoomCurve = Math.sin(t * Math.PI);
      camera.position.z = baseZ + zoomCurve * (peakZ - baseZ);

      // Flare massivo
      const flare = Math.sin(t * Math.PI);
      
      unlockedNodes.forEach(obj => {
        const baseGlowScale = obj.skill.rank === 0 ? 3.2 : 2.2;
        obj.glowMesh.scale.setScalar(baseGlowScale + flare * 4.0); 
        obj.glowMat.opacity = 0.45 + flare * 0.65;
        
        const baseColor = obj.skill.rank === 0 ? obj.rootColor : obj.baseColor;
        obj.crystalMat.emissive = new THREE.Color(baseColor).multiplyScalar((obj.skill.rank === 0 ? 1.5 : 0.9) + flare * 4.0);

        // --- STAR TRAIL EFFECT ---
        // Emitir rastro na posição mundial se a animação estiver rodando a todo vapor
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
          
          // Uma espalhada leve nas partículas para deixá-las mais ricas
          sprite.position.x += (Math.random() - 0.5) * 0.8;
          sprite.position.y += (Math.random() - 0.5) * 0.8;
          sprite.position.z += (Math.random() - 0.5) * 0.8;

          const baseScale = obj.skill.rank === 0 ? 3.5 : 2.0;
          sprite.scale.set(baseScale, baseScale, 1);
          scene.add(sprite); // Coloca direto na scene (mundo) para não girar junto com o mainGroup

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

      // Fade out all wheel nodes in the last 20% so the rebuild is invisible.
      // This eliminates the position jump caused by non-zero wheel rotation on
      // all classes except Agente (index 0, rot=0).
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
        // Set camera/mainGroup to exactly match what centerCamera would
        // produce for the new class's single-tree view, so rebuildTree(keepView)
        // produces no visible jump.
        mainGroup.rotation.order = 'XYZ';
        mainGroup.rotation.set(-CAMERA_TILT * 0.3, 0, 0);
        mainGroup.position.set(-newCx, -newCy, 0);
        camera.position.set(0, -2, CAMERA_DISTANCE);
        camera.rotation.x = CAMERA_TILT;

        onComplete();
      }
    }

    requestAnimationFrame(animateStep);
  }

  return { init, buildTree: buildSingleTree, buildAllTrees, updateStates, setCallbacks, clearTree, destroy, getViewMode, transitionToClass };

})();
