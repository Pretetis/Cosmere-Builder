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
  let onNodeHover = null;
  let onNodeClick = null;
  let onHoverEnd  = null;

  // --- CONSTANTS ---
  const NODE_RADIUS        = 0.28;
  const RANK_Y_SPACING     = 2.8;
  const CAMERA_DISTANCE    = 14;
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
      e.preventDefault();
      const zoomMax = _viewMode === 'all' ? 70 : 40;
      const zoomMin = _viewMode === 'all' ? 15 : 8;
      camera.position.z = Math.max(zoomMin, Math.min(zoomMax, camera.position.z + e.deltaY * 0.01));
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

  // ---- LAYOUT ALGORITHM ----
  // ---- BACKUP: GRID LAYOUT (original) ----
  // function computeLayout_grid(cls, skills, childrenMap, root) {
  //   const positions = {};
  //   const subs = CosData.SUBCLASSES[cls];
  //   positions[root.id] = { x: 0, y: 0, z: 0 };
  //   const subCount = subs.length;
  //   subs.forEach((sub, subIdx) => {
  //     const subSkills = skills.filter(s => s.sub === sub);
  //     const centerX = (subIdx - (subCount - 1) / 2) * BRANCH_X_SPACING * 3;
  //     const rank1Skills = subSkills.filter(s => s.rank === 1);
  //     const branchCount = rank1Skills.length;
  //     rank1Skills.forEach((r1, branchIdx) => {
  //       const branchX = centerX + (branchIdx - (branchCount - 1) / 2) * BRANCH_X_SPACING;
  //       const queue = [{ skill: r1, x: branchX, y: RANK_Y_SPACING }];
  //       const visited = new Set();
  //       while (queue.length > 0) {
  //         const { skill, x, y } = queue.shift();
  //         if (visited.has(skill.id)) continue;
  //         visited.add(skill.id);
  //         const z = -skill.rank * 0.3 + (Math.random() - 0.5) * 0.2;
  //         positions[skill.id] = { x, y, z };
  //         const kids = childrenMap[skill.name] || [];
  //         const validKids = kids.filter(k => !visited.has(k.id));
  //         if (validKids.length === 1) {
  //           queue.push({ skill: validKids[0], x, y: y + RANK_Y_SPACING });
  //         } else if (validKids.length > 1) {
  //           validKids.forEach((kid, ki) => {
  //             const kx = x + (ki - (validKids.length - 1) / 2) * BRANCH_X_SPACING * 0.5;
  //             queue.push({ skill: kid, x: kx, y: y + RANK_Y_SPACING });
  //           });
  //         }
  //       }
  //     });
  //   });
  //   return positions;
  // }

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

  // ---- CREATE NODE (Stormlight Sphere with inner Gemstone) ----
  function createNode(skill, pos, isUnlocked, canUnlock, cls, periciaValues) {
    const baseColor = isUnlocked ? COLOR_MAP[cls] : canUnlock ? COLOR_MAP[cls] : COLOR_LOCKED;
    const glowColor = isUnlocked ? COLOR_MAP[cls] : canUnlock ? COLOR_MAP[cls] : COLOR_LOCKED;

    // -- Inner crystal gemstone (rendered first) --
    const crystalGeo = new THREE.IcosahedronGeometry(NODE_RADIUS * 0.48, 0); // faceted, detail=0
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
      opacity: isUnlocked ? 0.3 : 0.3,
      // opacity: isUnlocked ? 0.01 : 0.05,
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

    // Rank 0 (class root) gets special treatment
    if (skill.rank === 0) {
      mesh.scale.setScalar(1.5);
      crystalMesh.scale.setScalar(1.5);
      glowMesh.scale.set(3.2, 3.2, 1);
      crystalMat.emissive = new THREE.Color(COLOR_UNLOCKED).multiplyScalar(1.0);
      crystalMat.color = new THREE.Color(COLOR_UNLOCKED);
      crystalMat.opacity = 1;
      mat.emissive = new THREE.Color(COLOR_UNLOCKED).multiplyScalar(0.1);
      mat.opacity = 0.2;
      glowMat.color = new THREE.Color(COLOR_UNLOCKED);
      glowMat.opacity = 0.55;
    }

    mesh.userData = { skill, isUnlocked, canUnlock };
    const obj = { mesh, skill, glowMesh, crystalMesh, crystalMat, pos, mat, glowMat, baseColor };
    nodeObjects.push(obj);
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
  function createSmokeAlongLine(from, to, color) {
    const count = 8;
    for (let i = 0; i < count; i++) {
      const t = Math.random();
      const x = from.x + (to.x - from.x) * t + (Math.random() - 0.5) * 0.15;
      const y = from.y + (to.y - from.y) * t + (Math.random() - 0.5) * 0.15;
      const z = from.z + (to.z - from.z) * t + (Math.random() - 0.5) * 0.1;

      const geo = new THREE.SphereGeometry(0.04, 8, 8);
      const mat = new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.25,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mainGroup.add(mesh);

      smokeParticles.push({
        mesh,
        basePos: { x, y, z },
        from, to,
        speed: Math.random() * 0.5 + 0.3,
        offset: Math.random() * Math.PI * 2,
        life: Math.random(),
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
    smokeParticles = [];
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
        const gs = 3.0 + pulse * 0.4;
        obj.glowMesh.scale.set(gs, gs, 1);
        obj.glowMat.opacity = 0.35 + pulse * 0.2;
        obj.crystalMesh.rotation.y = time * 0.3;
        obj.crystalMat.emissive = new THREE.Color(COLOR_UNLOCKED).multiplyScalar(0.7 + pulse * 0.4);
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
    for (const p of smokeParticles) {
      const t = time * p.speed + p.offset;
      p.mesh.position.x = p.basePos.x + Math.sin(t) * 0.08;
      p.mesh.position.y = p.basePos.y + Math.cos(t * 0.7) * 0.06;
      p.mesh.position.z = p.basePos.z + Math.sin(t * 1.3) * 0.04;
      p.mesh.material.opacity = 0.12 + Math.sin(t * 2) * 0.12;
      const scale = 0.8 + Math.sin(t * 1.5) * 0.4;
      p.mesh.scale.setScalar(scale);
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
      const isUnlocked = unlockedSkills.has(obj.skill.id);
      const canUnlock = !isUnlocked && _canUnlockFn ? _canUnlockFn(obj.skill) : false;
      obj.mesh.userData.isUnlocked = isUnlocked;
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

      // Class root always gold
      if (obj.skill.rank === 0) {
        obj.crystalMat.color.setHex(COLOR_UNLOCKED);
        obj.crystalMat.emissive = new THREE.Color(COLOR_UNLOCKED).multiplyScalar(1.0);
        obj.crystalMat.opacity = 1;
        obj.mat.emissive = new THREE.Color(COLOR_UNLOCKED).multiplyScalar(0.1);
        obj.mat.opacity = 0.2;
        obj.glowMat.color.setHex(COLOR_UNLOCKED);
        obj.glowMat.opacity = 0.55;
        obj.glowMesh.scale.set(3.2, 3.2, 1);
      }
    }
  }

  // ---- PUBLIC API ----
  function setCallbacks(hover, click, hoverEnd) {
    onNodeHover = hover;
    onNodeClick = click;
    onHoverEnd = hoverEnd;
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
    camera.position.set(0, 0, 40);
    camera.rotation.set(0, 0, 0);

    const allPositions = {};
    const scale = 0.41;

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
      const labelDist = 12.5;
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
    const radius = 8;

    // Compute root positions — evenly spaced full circle, starting from top
    const rootPositions = allEntries.map((entry, idx) => {
      const angle = Math.PI / 2 - (2 * Math.PI * idx / total);
      return { ...entry, x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, angle };
    });

    // --- Constellation skeleton (behind nodes) ---
    // Spokes: start at inner gap (avoid covering center symbol) → each root
    const spokeInnerR = 2.8;
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

  return { init, buildTree: buildSingleTree, buildAllTrees, updateStates, setCallbacks, clearTree, destroy, getViewMode };

})();
