// ============================================================
// Cosmere RPG Skill Tree - Application Logic
// Profile system, state management, UI binding
// ============================================================

const App = (() => {

  // ---- STATE ----
  const state = {
    profile: {
      name: '',
      race: 'human',
      level: 1,
      radiantClass: null,
    },
    attributes: {
      forca: 0, velocidade: 0, intelecto: 0,
      vontade: 0, consciencia: 0, presenca: 0
    },
    pericias: {},
    radiantPericias: {},
    unlockedSkills: new Set(),
    freeUnlockedSkills: new Set(), // IDs auto-desbloqueados por habilidades compartilhadas
    spentTalents: 0,
    activeClass: '_all',
  };

  // Initialize pericias to 0
  function initPericias() {
    for (const key of Object.keys(CosData.PERICIAS)) {
      state.pericias[key] = 0;
    }
    for (const key of Object.keys(CosData.PERICIAS_RADIANTES)) {
      state.radiantPericias[key] = 0;
    }
  }

  // ---- DERIVED VALUES ----
  function getPointsAvailable() {
    return CosData.computePointsAtLevel(state.profile.level);
  }

  function getAttrPointsSpent() {
    let sum = 0;
    for (const v of Object.values(state.attributes)) sum += v;
    return sum;
  }

  function getAttrPointsRemaining() {
    return getPointsAvailable().totalAttr - getAttrPointsSpent();
  }

  function getPericiaPointsSpent() {
    let sum = 0;
    for (const v of Object.values(state.pericias)) sum += v;
    // Include the 2 active radiant surges if an order is chosen
    if (state.profile.radiantClass) {
      const keys = CosData.RADIANT_CLASS_PERICIAS[state.profile.radiantClass] || [];
      for (const k of keys) sum += state.radiantPericias[k] || 0;
    }
    return sum;
  }

  function getPericiaPointsRemaining() {
    return getPointsAvailable().totalPericia - getPericiaPointsSpent();
  }

  function getTalentPointsRemaining() {
    let bonus = 0;
    // Humanos ganham +1 ponto de talento no nível 1
    if (state.profile.race === 'human' && state.profile.level >= 1) {
      bonus = 1;
    }
    return getPointsAvailable().totalTalents + bonus - state.spentTalents;
  }

  function getDefenses() {
    const a = state.attributes;
    return {
      physical:  10 + a.forca + a.velocidade,
      cognitive: 10 + a.intelecto + a.vontade,
      spiritual: 10 + a.consciencia + a.presenca
    };
  }

  function getMaxPericiaRank() {
    return getPointsAvailable().maxPericiaRank;
  }

  // ---- SHARED SKILLS HELPER ----
  // Returns all IDs for regular skills that share the same name (across all classes)
  function getSharedSkillIds(skillName) {
    return CosData.SKILLS.filter(s => s.name === skillName).map(s => s.id);
  }

  // ---- SKILL PREREQUISITES CHECK ----
  function canUnlockSkill(skill) {
    if (state.unlockedSkills.has(skill.id)) return { can: false, reason: 'Ja desbloqueado' };

    if (getTalentPointsRemaining() <= 0) return { can: false, reason: 'Sem pontos de talento' };

    // Rank 0 (class root): only requires talent points, no other prereqs
    if (skill.rank === 0) return { can: true, reason: '' };

    if (skill.deps.length > 0) {
      const anyDepMet = skill.deps.some(depName => {
        const dep = CosData.findSkillByName(depName, skill.cls);
        if (!dep || !state.unlockedSkills.has(dep.id)) return false;
        // Se o dep foi auto-desbloqueado por compartilhamento, exige que a cadeia
        // anterior a ele nesta classe também esteja completa
        if (state.freeUnlockedSkills.has(dep.id)) {
          return dep.deps.every(ddName => {
            const dd = CosData.findSkillByName(ddName, skill.cls);
            return dd && state.unlockedSkills.has(dd.id);
          });
        }
        return true;
      });
      if (!anyDepMet) return { can: false, reason: 'Pre-requisito de talento nao atendido' };
    }

    // Rank 1+ needs the class root unlocked
    const root = CosData.getRootSkill(skill.cls);
    if (root && !state.unlockedSkills.has(root.id)) {
      return { can: false, reason: `Requer: ${root.name}` };
    }

    if (skill.reqStat && skill.reqVal > 0) {
      const periciaKey = CosData.statToPericia(skill.reqStat);
      if (periciaKey) {
        const currentVal = state.pericias[periciaKey] || 0;
        if (currentVal < skill.reqVal) {
          return { can: false, reason: `Requer ${CosData.PERICIAS[periciaKey].name} +${skill.reqVal} (atual: ${currentVal})` };
        }
      }
    }

    return { can: true, reason: '' };
  }

  function canRemoveSkill(skill) {
    if (!state.unlockedSkills.has(skill.id)) return { can: false, reason: 'Nao esta desbloqueado' };

    const pool = isRadiantSkill(skill) ? CosData.RADIANT_SKILLS : CosData.SKILLS;

    if (skill.rank === 0) {
      const hasChildren = pool.some(s =>
        s.cls === skill.cls && s.rank > 0 && state.unlockedSkills.has(s.id)
      );
      if (hasChildren) return { can: false, reason: 'Outros talentos desta classe estao desbloqueados' };
      return { can: true, reason: '' };
    }

    // Para habilidades regulares com nome compartilhado, verifica filhos em TODAS as classes
    // pois remover uma cópia remove todas as cópias compartilhadas
    if (!isRadiantSkill(skill)) {
      const hasAnyChild = CosData.SKILLS.some(s =>
        s.deps.includes(skill.name) && state.unlockedSkills.has(s.id)
      );
      if (hasAnyChild) return { can: false, reason: 'Outros talentos dependem deste' };
      return { can: true, reason: '' };
    }

    const children = pool.filter(s =>
      s.cls === skill.cls && s.deps.includes(skill.name) && state.unlockedSkills.has(s.id)
    );
    if (children.length > 0) {
      return { can: false, reason: 'Outros talentos dependem deste' };
    }
    return { can: true, reason: '' };
  }

  function toggleSkill(skill) {
    const radiant = isRadiantSkill(skill);
    if (state.unlockedSkills.has(skill.id)) {
      const check = canRemoveSkill(skill);
      if (!check.can) { notify(check.reason); return false; }
      state.unlockedSkills.delete(skill.id);
      state.freeUnlockedSkills.delete(skill.id);
      // Remove todas as cópias compartilhadas (habilidades com mesmo nome em outras classes)
      if (!radiant) {
        for (const sid of getSharedSkillIds(skill.name)) {
          if (sid !== skill.id) {
            state.unlockedSkills.delete(sid);
            state.freeUnlockedSkills.delete(sid);
          }
        }
      }
      state.spentTalents--;
      return true;
    } else {
      const check = radiant ? canUnlockRadiantSkill(skill) : canUnlockSkill(skill);
      if (!check.can) { notify(check.reason); return false; }
      state.unlockedSkills.add(skill.id);
      state.spentTalents++;
      // Auto-desbloqueia habilidades com mesmo nome em outras classes (sem custo extra)
      if (!radiant) {
        for (const sid of getSharedSkillIds(skill.name)) {
          if (sid !== skill.id && !state.unlockedSkills.has(sid)) {
            state.unlockedSkills.add(sid);
            state.freeUnlockedSkills.add(sid);
          }
        }
      }
      return true;
    }
  }

  // ---- SKILL MODAL ----
  function showSkillModal(skill) {
    const modal = document.getElementById('skill-modal');
    if (!modal) return;

    const isUnlocked = state.unlockedSkills.has(skill.id);
    const radiant = isRadiantSkill(skill);
    const checkUnlock = radiant ? canUnlockRadiantSkill(skill) : canUnlockSkill(skill);
    const checkRemove = canRemoveSkill(skill);

    // Requirements HTML
    let reqHtml = '';
    if (skill.reqStat === 'level' && skill.reqVal > 0) {
      const met = state.profile.level >= skill.reqVal;
      reqHtml += `<div class="modal-req-item ${met ? 'met' : 'unmet'}">Requer Nível ${skill.reqVal} (atual: ${state.profile.level})</div>`;
    } else if (Array.isArray(skill.reqStat)) {
      for (let i = 0; i < skill.reqStat.length; i++) {
        const sName = skill.reqStat[i];
        const sVal  = Array.isArray(skill.reqVal) ? skill.reqVal[i] : skill.reqVal;
        const key   = sName.toLowerCase();
        const curVal = state.radiantPericias[key] || 0;
        const met   = curVal >= sVal;
        const pInfo = CosData.PERICIAS_RADIANTES[key];
        const pName = pInfo ? pInfo.name : sName;
        reqHtml += `<div class="modal-req-item ${met ? 'met' : 'unmet'}">Requer ${pName} +${sVal} (atual: ${curVal})</div>`;
      }
    } else if (skill.reqStat && skill.reqVal > 0) {
      const pKey = CosData.statToPericia(skill.reqStat);
      const curVal = pKey ? (state.pericias[pKey] || 0) : 0;
      const met = curVal >= skill.reqVal;
      const pName = pKey ? CosData.PERICIAS[pKey].name : skill.reqStat;
      reqHtml += `<div class="modal-req-item ${met ? 'met' : 'unmet'}">Requer ${pName} +${skill.reqVal} (atual: ${curVal})</div>`;
    }
    if (skill.deps.length > 0) {
      const findFn = radiant ? CosData.findRadiantSkillByName : CosData.findSkillByName;
      for (const dep of skill.deps) {
        const depSkill = findFn(dep, skill.cls);
        const met = depSkill && state.unlockedSkills.has(depSkill.id);
        reqHtml += `<div class="modal-req-item ${met ? 'met' : 'unmet'}">Requer: ${dep}</div>`;
      }
    }
    if (skill.prereqText) {
      reqHtml += `<div class="modal-req-item special">Especial: ${skill.prereqText}</div>`;
    }

    // Status
    let statusClass, statusText;
    if (isUnlocked) {
      statusClass = 'unlocked';
      statusText = 'Desbloqueado';
    } else if (checkUnlock.can) {
      statusClass = 'available';
      statusText = 'Disponivel';
    } else {
      statusClass = 'locked';
      statusText = 'Bloqueado';
    }

    // Action button
    let actionHtml = '';
    if (isUnlocked) {
      actionHtml = `<button class="modal-action-btn remove ${checkRemove.can ? '' : 'disabled'}" id="modal-action">
        Remover Talento
      </button>`;
      if (!checkRemove.can) {
        actionHtml += `<div class="modal-action-reason">${checkRemove.reason}</div>`;
      }
    } else {
      actionHtml = `<button class="modal-action-btn buy ${checkUnlock.can ? '' : 'disabled'}" id="modal-action">
        Comprar Talento (1 ponto)
      </button>`;
      if (!checkUnlock.can) {
        actionHtml += `<div class="modal-action-reason">${checkUnlock.reason}</div>`;
      }
    }

    // Talent points remaining info
    const talentsLeft = getTalentPointsRemaining();

    modal.innerHTML = `
      <div class="modal-backdrop" id="modal-backdrop"></div>
      <div class="modal-content">
        <button class="modal-close" id="modal-close">&times;</button>
        <div class="modal-header">
          <div class="modal-skill-name" style="color: ${clsColor(skill.cls)}">${skill.name}</div>
          <div class="modal-skill-meta">
            <span class="modal-class">${skill.cls}</span>
            ${skill.sub !== '-' ? `<span class="modal-sub">${skill.sub}</span>` : ''}
            <span class="modal-rank">Rank ${skill.rank}</span>
            <span class="modal-status ${statusClass}">${statusText}</span>
          </div>
        </div>

        <div class="modal-body">
          <div class="modal-desc-section">
            <div class="modal-desc-label">Descricao</div>
            <div class="modal-desc-text">${skill.description || '<em>Descricao sera adicionada em breve.</em>'}</div>
          </div>

          ${reqHtml ? `<div class="modal-req-section"><div class="modal-desc-label">Requisitos</div>${reqHtml}</div>` : ''}

          <div class="modal-points-info">
            Pontos de talento restantes: <strong>${talentsLeft}</strong>
          </div>
        </div>

        <div class="modal-footer">
          ${actionHtml}
        </div>
      </div>
    `;

    modal.classList.add('visible');

    // Bind events
    document.getElementById('modal-backdrop').addEventListener('click', hideSkillModal);
    document.getElementById('modal-close').addEventListener('click', hideSkillModal);

    const actionBtn = document.getElementById('modal-action');
    if (actionBtn && !actionBtn.classList.contains('disabled')) {
      actionBtn.addEventListener('click', () => {
        const success = toggleSkill(skill);
        if (success) {
          // Rebuild tree keeping view position
          rebuildTree(true);
          renderSidebar();
          // Re-show modal with updated state
          showSkillModal(skill);
        }
      });
    }

    // Close on Escape
    modal._escHandler = (e) => {
      if (e.key === 'Escape') hideSkillModal();
    };
    document.addEventListener('keydown', modal._escHandler);
  }

  function hideSkillModal() {
    const modal = document.getElementById('skill-modal');
    if (!modal) return;
    modal.classList.remove('visible');
    if (modal._escHandler) {
      document.removeEventListener('keydown', modal._escHandler);
      modal._escHandler = null;
    }
  }

  // ---- UI RENDERING ----
  function renderSidebar() {
    renderPoints();
    renderAttributes();
    renderDefenses();
    renderPericias();
    renderLevelDisplay();
    renderRadiantSection();
    renderRadiantPericias();
    // Lock race buttons when not level 1
    const locked = state.profile.level !== 1;
    document.querySelectorAll('.race-btn').forEach(btn => {
      btn.classList.toggle('locked', locked);
    });
  }

  function renderRadiantSection() {
    const container = document.getElementById('radiant-select');
    if (!container) return;
    const unlocked = state.profile.level >= 2;
    container.innerHTML = '';

    if (!unlocked) {
      container.innerHTML = '<div class="radiant-placeholder">Disponivel a partir do Nível 2</div>';
      renderRadiantPericias();
      return;
    }

    for (const cls of CosData.RADIANT_CLASSES) {
      const btn = document.createElement('button');
      const isActive = state.profile.radiantClass === cls;
      const color = clsColor(cls);
      btn.className = 'radiant-btn' + (isActive ? ' active' : '');
      btn.textContent = cls;
      if (isActive) {
        btn.style.borderColor = color;
        btn.style.color = color;
        btn.style.background = color + '1a';
        btn.style.boxShadow = `0 0 10px ${color}26`;
      }
      btn.addEventListener('click', () => {
        state.profile.radiantClass = isActive ? null : cls;
        if (!state.profile.radiantClass && CosData.RADIANT_CLASSES.includes(state.activeClass)) {
          state.activeClass = '_all';
        }
        renderRadiantSection();
        renderClassTabs();
        rebuildTree(); // always full rebuild so radiant tree appears/disappears
      });
      container.appendChild(btn);
    }

    renderRadiantPericias();
  }

  function renderRadiantPericias() {
    const container = document.getElementById('radiant-pericias');
    if (!container) return;
    const cls = state.profile.radiantClass;
    if (!cls) { container.innerHTML = ''; return; }

    const perKeys = CosData.RADIANT_CLASS_PERICIAS[cls] || [];
    if (perKeys.length === 0) { container.innerHTML = ''; return; }

    container.innerHTML = '<div class="surtos-label">Surtos</div>';
    const grid = document.createElement('div');
    grid.className = 'pericias-grid surtos-grid';

    for (const key of perKeys) {
      const info = CosData.PERICIAS_RADIANTES[key];
      if (!info) continue;
      const val = state.radiantPericias[key] || 0;
      const div = document.createElement('div');
      div.className = 'pericia-item';
      div.innerHTML = `
        <span class="pericia-name surto-name">${info.name}</span>
        <div class="pericia-controls">
          <button class="pericia-btn" data-radper="${key}" data-dir="-1">&minus;</button>
          <span class="pericia-val">${val}</span>
          <button class="pericia-btn" data-radper="${key}" data-dir="1">+</button>
        </div>
      `;
      grid.appendChild(div);
    }
    container.appendChild(grid);

    container.querySelectorAll('[data-radper]').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.radper;
        const dir = parseInt(btn.dataset.dir);
        const newVal = (state.radiantPericias[key] || 0) + dir;
        const maxRank = getMaxPericiaRank();
        if (newVal < 0 || newVal > maxRank) return;
        if (dir > 0 && getPericiaPointsRemaining() <= 0) {
          notify('Sem pontos de pericia');
          return;
        }
        state.radiantPericias[key] = newVal;
        renderSidebar();
        rebuildTree(true);
      });
    });
  }

  function renderPoints() {
    const el = document.getElementById('points-bar');
    if (!el) return;
    const attrRem = getAttrPointsRemaining();
    const perRem = getPericiaPointsRemaining();
    const talRem = getTalentPointsRemaining();

    el.innerHTML = `
      <span class="point-badge ${attrRem < 0 ? 'danger' : ''}">Atrib: <span class="val">${attrRem}</span></span>
      <span class="point-badge ${perRem < 0 ? 'danger' : ''}">Pericia: <span class="val">${perRem}</span></span>
      <span class="point-badge ${talRem < 0 ? 'danger' : ''}">Talento: <span class="val">${talRem}</span></span>
    `;
  }

  function renderLevelDisplay() {
    const el = document.getElementById('level-val');
    if (el) el.textContent = state.profile.level;
    const tierEl = document.getElementById('tier-val');
    if (tierEl) {
      const tier = CosData.LEVEL_TABLE.find(r => r.level === state.profile.level)?.tier || 1;
      tierEl.textContent = tier;
    }
  }

  function renderAttributes() {
    const container = document.getElementById('attr-grid');
    if (!container) return;
    container.innerHTML = '';

    for (const [key, info] of Object.entries(CosData.ATTRIBUTES)) {
      const val = state.attributes[key];
      const div = document.createElement('div');
      div.className = 'attr-item';
      div.innerHTML = `
        <span class="attr-name">${info.abbr}</span>
        <div class="attr-controls">
          <button class="attr-btn" data-attr="${key}" data-dir="-1">&minus;</button>
          <span class="attr-val">${val}</span>
          <button class="attr-btn" data-attr="${key}" data-dir="1">+</button>
        </div>
      `;
      container.appendChild(div);
    }

    container.querySelectorAll('.attr-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const attr = btn.dataset.attr;
        const dir = parseInt(btn.dataset.dir);
        const newVal = state.attributes[attr] + dir;
        if (newVal < 0) return;
        if (dir > 0 && getAttrPointsRemaining() <= 0) {
          notify('Sem pontos de atributo');
          return;
        }
        state.attributes[attr] = newVal;
        renderSidebar();
      });
    });
  }

  function renderDefenses() {
    const d = getDefenses();
    const el = document.getElementById('defenses');
    if (!el) return;
    el.innerHTML = `
      <div class="defense-item">
        <div class="defense-label">Fisica</div>
        <div class="defense-val physical">${d.physical}</div>
      </div>
      <div class="defense-item">
        <div class="defense-label">Cognitiva</div>
        <div class="defense-val cognitive">${d.cognitive}</div>
      </div>
      <div class="defense-item">
        <div class="defense-label">Espiritual</div>
        <div class="defense-val spiritual">${d.spiritual}</div>
      </div>
    `;
  }

  function renderPericias() {
    const container = document.getElementById('pericias-grid');
    if (!container) return;
    container.innerHTML = '';

    for (const [key, info] of Object.entries(CosData.PERICIAS)) {
      const val = state.pericias[key];
      const div = document.createElement('div');
      div.className = 'pericia-item';
      div.innerHTML = `
        <span class="pericia-name" title="${info.en}">${info.name}</span>
        <div class="pericia-controls">
          <button class="pericia-btn" data-per="${key}" data-dir="-1">&minus;</button>
          <span class="pericia-val">${val}</span>
          <button class="pericia-btn" data-per="${key}" data-dir="1">+</button>
        </div>
      `;
      container.appendChild(div);
    }

    container.querySelectorAll('.pericia-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const per = btn.dataset.per;
        const dir = parseInt(btn.dataset.dir);
        const newVal = state.pericias[per] + dir;
        const maxRank = getMaxPericiaRank();
        if (newVal < 0 || newVal > maxRank) return;
        if (dir > 0 && getPericiaPointsRemaining() <= 0) {
          notify('Sem pontos de pericia');
          return;
        }
        state.pericias[per] = newVal;
        renderSidebar();
        // Rebuild tree keeping view
        rebuildTree(true);
      });
    });
  }

  function renderClassTabs() {
    const container = document.getElementById('class-tabs');
    if (!container) return;
    container.innerHTML = '';

    // "Todas" tab
    const allBtn = document.createElement('button');
    allBtn.className = 'class-tab tab-all' + (state.activeClass === '_all' ? ' active' : '');
    allBtn.textContent = 'Todas';
    allBtn.style.borderBottomColor = state.activeClass === '_all' ? 'var(--accent-gold)' : 'transparent';
    allBtn.addEventListener('click', () => {
      state.activeClass = '_all';
      renderClassTabs();
      rebuildTree();
    });
    container.appendChild(allBtn);

    // Separator
    const sep = document.createElement('span');
    sep.className = 'tab-separator';
    container.appendChild(sep);

    for (const cls of CosData.CLASSES) {
      const btn = document.createElement('button');
      btn.className = 'class-tab' + (cls === state.activeClass ? ' active' : '');
      btn.textContent = cls;
      btn.style.borderBottomColor = cls === state.activeClass ? `var(--color-${cls})` : 'transparent';
      btn.addEventListener('click', () => {
        state.activeClass = cls;
        renderClassTabs();
        rebuildTree();
      });
      container.appendChild(btn);
    }

    // Radiant tabs (only if a class is chosen and level >= 2)
    if (state.profile.radiantClass && state.profile.level >= 2) {
      const rsep = document.createElement('span');
      rsep.className = 'tab-separator tab-separator-radiant';
      container.appendChild(rsep);

      const rcls = state.profile.radiantClass;
      const rbtn = document.createElement('button');
      rbtn.className = 'class-tab tab-radiant' + (rcls === state.activeClass ? ' active' : '');
      rbtn.textContent = rcls;
      const rColor = clsColor(rcls);
      rbtn.style.borderBottomColor = rcls === state.activeClass ? rColor : 'transparent';
      rbtn.style.color = rcls === state.activeClass ? rColor : '';
      rbtn.addEventListener('click', () => {
        state.activeClass = rcls;
        renderClassTabs();
        rebuildTree();
      });
      container.appendChild(rbtn);
    }
  }

  // ---- TOOLTIP (hover only) ----
  function showTooltip(skill, event) {
    const tt = document.getElementById('tooltip');
    if (!tt) return;

    const rad = isRadiantSkill(skill);
    const check = rad ? canUnlockRadiantSkill(skill) : canUnlockSkill(skill);
    const isUnlocked = state.unlockedSkills.has(skill.id);

    const statusText = isUnlocked ? '<span style="color:var(--accent-green)">Desbloqueado</span>' :
                        check.can ? '<span style="color:var(--accent-gold)">Disponivel</span>' :
                                    '<span style="color:var(--text-muted)">Bloqueado</span>';

    // Build prerequisites lines
    let reqLines = '';
    if (skill.reqStat === 'level' && skill.reqVal > 0) {
      const met = state.profile.level >= skill.reqVal;
      reqLines += `<div class="tt-req ${met ? 'met' : 'unmet'}">Nível ${skill.reqVal} (${state.profile.level})</div>`;
    } else if (Array.isArray(skill.reqStat)) {
      for (let i = 0; i < skill.reqStat.length; i++) {
        const sName = skill.reqStat[i];
        const sVal  = Array.isArray(skill.reqVal) ? skill.reqVal[i] : skill.reqVal;
        const key   = sName.toLowerCase();
        const curVal = state.radiantPericias[key] || 0;
        const met   = curVal >= sVal;
        const pInfo = CosData.PERICIAS_RADIANTES[key];
        const pName = pInfo ? pInfo.name : sName;
        reqLines += `<div class="tt-req ${met ? 'met' : 'unmet'}">${pName} +${sVal} (${curVal})</div>`;
      }
    } else if (skill.reqStat && skill.reqVal > 0) {
      const pKey = CosData.statToPericia(skill.reqStat);
      const curVal = pKey ? (state.pericias[pKey] || 0) : 0;
      const met = curVal >= skill.reqVal;
      const pName = pKey ? CosData.PERICIAS[pKey].name : skill.reqStat;
      reqLines += `<div class="tt-req ${met ? 'met' : 'unmet'}">${pName} +${skill.reqVal} (${curVal})</div>`;
    }
    if (skill.deps.length > 0) {
      const findFn = rad ? CosData.findRadiantSkillByName : CosData.findSkillByName;
      for (const dep of skill.deps) {
        const depSkill = findFn(dep, skill.cls);
        const met = depSkill && state.unlockedSkills.has(depSkill.id);
        reqLines += `<div class="tt-req ${met ? 'met' : 'unmet'}">Requer: ${dep}</div>`;
      }
    }
    if (skill.prereqText) {
      reqLines += `<div class="tt-req special">${skill.prereqText}</div>`;
    }

    tt.innerHTML = `
      <div class="tt-name" style="color: ${clsColor(skill.cls)}">${skill.name}</div>
      <div class="tt-sub">${skill.cls}${skill.sub !== '-' ? ' -- ' + skill.sub : ''} ${statusText}</div>
      <div class="tt-rank">Rank ${skill.rank}</div>
      ${reqLines ? '<div class="tt-reqs">' + reqLines + '</div>' : ''}
      <div class="tt-hint">Clique para detalhes</div>
    `;

    const x = event ? event.clientX + 16 : 400;
    const y = event ? event.clientY + 16 : 300;
    tt.style.left = x + 'px';
    tt.style.top = y + 'px';
    tt.classList.add('visible');

    requestAnimationFrame(() => {
      const ttRect = tt.getBoundingClientRect();
      if (ttRect.right > window.innerWidth) {
        tt.style.left = (x - ttRect.width - 32) + 'px';
      }
      if (ttRect.bottom > window.innerHeight) {
        tt.style.top = (y - ttRect.height - 32) + 'px';
      }
    });
  }

  function hideTooltip() {
    const tt = document.getElementById('tooltip');
    if (tt) tt.classList.remove('visible');
  }

  // ---- NOTIFICATIONS ----
  function notify(msg) {
    let el = document.querySelector('.notification');
    if (!el) {
      el = document.createElement('div');
      el.className = 'notification';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('show'), 2500);
  }

  // ---- TREE REBUILD ----
  // keepView=false by default (recenters), keepView=true preserves pan/zoom
  const CLASS_COLORS = {
    // Classes base
    'Agente': '#4ade80', 'Emissário': '#facc15', 'Caçador': '#f87171',
    'Líder': '#60a5fa', 'Erudito': '#a78bfa', 'Guerreiro': '#fb923c',
    // Ordens Radiantes
    'Corredor dos Ventos':       '#38bdf8',
    'Rompe-Céu':                 '#fbbf24',
    'Pulverizador':              '#ef4444',
    'Dançarino dos Precipícios': '#34d399',
    'Sentinela da Verdade':      '#2dd4bf',
    'Teceluz':                   '#f0abfc',
    'Alternauta':                '#e2e8f0',
    'Plasmador':                 '#c084fc',
    'Guardião das Pedras':       '#a87d4e',
  };

  function clsColor(cls) {
    return CLASS_COLORS[cls] || 'var(--text-primary)';
  }

  function isRadiantSkill(skill) {
    return CosData.RADIANT_CLASSES.includes(skill.cls);
  }

  function canUnlockRadiantSkill(skill) {
    if (state.unlockedSkills.has(skill.id)) return { can: false, reason: 'Ja desbloqueado' };
    if (getTalentPointsRemaining() <= 0) return { can: false, reason: 'Sem pontos de talento' };

    // Level requirement
    if (skill.reqStat === 'level' && skill.reqVal > 0) {
      if (state.profile.level < skill.reqVal) {
        return { can: false, reason: `Requer Nível ${skill.reqVal} (atual: ${state.profile.level})` };
      }
    }

    // Array reqStat: radiant surge requirements e.g. ["Transformacao", "Transporte"]
    if (Array.isArray(skill.reqStat)) {
      for (let i = 0; i < skill.reqStat.length; i++) {
        const sName = skill.reqStat[i];
        const sVal  = Array.isArray(skill.reqVal) ? skill.reqVal[i] : skill.reqVal;
        const key   = sName.toLowerCase();
        const curVal = state.radiantPericias[key] || 0;
        if (curVal < sVal) {
          const pInfo = CosData.PERICIAS_RADIANTES[key];
          const pName = pInfo ? pInfo.name : sName;
          return { can: false, reason: `Requer ${pName} +${sVal} (atual: ${curVal})` };
        }
      }
    } else if (skill.reqStat && skill.reqStat !== 'level' && skill.reqVal > 0) {
      // Single pericia reqStat (not level)
      const key = skill.reqStat.toLowerCase();
      const curVal = state.radiantPericias[key] || state.pericias[CosData.statToPericia(skill.reqStat)] || 0;
      if (curVal < skill.reqVal) {
        const pInfo = CosData.PERICIAS_RADIANTES[key];
        const pName = pInfo ? pInfo.name : skill.reqStat;
        return { can: false, reason: `Requer ${pName} +${skill.reqVal} (atual: ${curVal})` };
      }
    }

    if (skill.rank === 0) return { can: true, reason: '' };

    if (skill.deps.length > 0) {
      const anyDepMet = skill.deps.some(depName => {
        const dep = CosData.findRadiantSkillByName(depName, skill.cls);
        return dep && state.unlockedSkills.has(dep.id);
      });
      if (!anyDepMet) return { can: false, reason: 'Pre-requisito nao atendido' };
    }

    const root = CosData.getRootRadiantSkill(skill.cls);
    if (root && !state.unlockedSkills.has(root.id)) {
      return { can: false, reason: `Requer: ${root.name}` };
    }

    return { can: true, reason: '' };
  }

  function canUnlockCheck(skill) {
    if (isRadiantSkill(skill)) return canUnlockRadiantSkill(skill).can;
    return canUnlockSkill(skill).can;
  }

  function rebuildTree(keepView) {
    if (state.activeClass === '_all') {
      if (keepView && SkillRenderer.getViewMode() === 'all') {
        SkillRenderer.updateStates(state.unlockedSkills, state.pericias, canUnlockCheck);
        return;
      }
      SkillRenderer.buildAllTrees(state.unlockedSkills, state.pericias, canUnlockCheck, state.profile.radiantClass);
    } else {
      SkillRenderer.buildTree(state.activeClass, state.unlockedSkills, state.pericias, !!keepView, canUnlockCheck);
    }
  }

  // ---- SAVE / LOAD ----
  function saveProfile() {
    const data = {
      profile: state.profile,
      attributes: state.attributes,
      pericias: state.pericias,
      radiantPericias: state.radiantPericias,
      unlockedSkills: [...state.unlockedSkills],
      freeUnlockedSkills: [...state.freeUnlockedSkills],
      spentTalents: state.spentTalents,
      activeClass: state.activeClass,
    };
    localStorage.setItem('cosmere_rpg_profile', JSON.stringify(data));
    notify('Perfil salvo!');
  }

  function loadProfile() {
    const raw = localStorage.getItem('cosmere_rpg_profile');
    if (!raw) { notify('Nenhum perfil salvo encontrado'); return; }
    try {
      const data = JSON.parse(raw);
      state.profile = { ...state.profile, ...data.profile };
      state.attributes = { ...state.attributes, ...data.attributes };
      state.pericias = { ...state.pericias, ...data.pericias };
      state.radiantPericias = { ...state.radiantPericias, ...data.radiantPericias };
      state.unlockedSkills = new Set(data.unlockedSkills || []);
      state.freeUnlockedSkills = new Set(data.freeUnlockedSkills || []);
      state.spentTalents = data.spentTalents || 0;
      state.activeClass = data.activeClass || 'Agente';

      document.getElementById('char-name').value = state.profile.name;
      document.querySelectorAll('.race-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.race === state.profile.race);
      });
      renderSidebar();
      renderClassTabs();
      rebuildTree();
      notify('Perfil carregado!');
    } catch (e) {
      notify('Erro ao carregar perfil');
    }
  }

  function resetProfile() {
    state.profile = { name: '', race: 'human', level: 1, radiantClass: null };
    state.attributes = { forca:0, velocidade:0, intelecto:0, vontade:0, consciencia:0, presenca:0 };
    initPericias();
    state.unlockedSkills = new Set();
    state.freeUnlockedSkills = new Set();
    state.spentTalents = 0;

    document.getElementById('char-name').value = '';
    document.querySelectorAll('.race-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.race === 'human');
    });

    renderSidebar();
    rebuildTree();
    notify('Perfil resetado');
  }

  // ---- EXPORT / IMPORT (JSON FILE) ----
  function exportProfile() {
    const data = {
      profile: state.profile,
      attributes: state.attributes,
      pericias: state.pericias,
      radiantPericias: state.radiantPericias,
      unlockedSkills: [...state.unlockedSkills],
      freeUnlockedSkills: [...state.freeUnlockedSkills],
      spentTalents: state.spentTalents,
      activeClass: state.activeClass,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `cosmere_${state.profile.name || 'personagem'}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    notify('Perfil exportado!');
  }

  function importProfile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        try {
          const data = JSON.parse(ev.target.result);
          state.profile = { ...state.profile, ...data.profile };
          state.attributes = { ...state.attributes, ...data.attributes };
          state.pericias = { ...state.pericias, ...data.pericias };
          state.radiantPericias = { ...state.radiantPericias, ...data.radiantPericias };
          state.unlockedSkills = new Set(data.unlockedSkills || []);
          state.freeUnlockedSkills = new Set(data.freeUnlockedSkills || []);
          state.spentTalents = data.spentTalents || 0;
          state.activeClass = data.activeClass || '_all';

          document.getElementById('char-name').value = state.profile.name;
          document.querySelectorAll('.race-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.race === state.profile.race);
          });
          renderSidebar();
          renderClassTabs();
          rebuildTree();
          notify('Perfil importado!');
        } catch (err) {
          notify('Arquivo invalido');
        }
      };
      reader.readAsText(file);
    });
    input.click();
  }

  // ---- INIT (async - waits for skills JSON) ----
  async function init() {
    await CosData.loadSkills();
    await CosData.loadRadiantSkills();

    initPericias();

    // Initialize 3D renderer
    const viewport = document.getElementById('viewport');
    SkillRenderer.init(viewport);

    // Callbacks: hover shows tooltip, click opens modal
    SkillRenderer.setCallbacks(
      (skill, intersect) => {
        showTooltip(skill, window._lastMouseEvent);
      },
      (skill, event) => {
        hideTooltip();
        showSkillModal(skill);
      },
      () => hideTooltip()
    );

    // Track mouse for tooltip positioning
    document.addEventListener('mousemove', e => { window._lastMouseEvent = e; });

    // Bind UI
    bindUI();

    // Initial render
    renderSidebar();
    renderClassTabs();

    rebuildTree();

    // Hide loading
    setTimeout(() => {
      const loading = document.getElementById('loading');
      if (loading) {
        loading.classList.add('fade-out');
        setTimeout(() => loading.remove(), 600);
      }
    }, 800);
  }

  function bindUI() {
    const nameInput = document.getElementById('char-name');
    if (nameInput) {
      nameInput.addEventListener('input', e => { state.profile.name = e.target.value; });
    }

    document.querySelectorAll('.race-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (state.profile.level !== 1) {
          notify('Ancestralidade so pode ser alterada no nivel 1');
          return;
        }
        state.profile.race = btn.dataset.race;
        document.querySelectorAll('.race-btn').forEach(b => b.classList.toggle('active', b === btn));
        renderSidebar();
        rebuildTree(true);
      });
    });

    document.getElementById('lvl-up')?.addEventListener('click', () => {
      if (state.profile.level < 30) {
        state.profile.level++;
        renderSidebar();
        rebuildTree(true);
      }
    });
    document.getElementById('lvl-down')?.addEventListener('click', () => {
      if (state.profile.level > 1) {
        state.profile.level--;
        renderSidebar();
        rebuildTree(true);
      }
    });

    document.getElementById('btn-save')?.addEventListener('click', saveProfile);
    document.getElementById('btn-load')?.addEventListener('click', loadProfile);
    document.getElementById('btn-reset')?.addEventListener('click', resetProfile);
    document.getElementById('btn-export')?.addEventListener('click', exportProfile);
    document.getElementById('btn-import')?.addEventListener('click', importProfile);
  }

  return { init, state };

})();

// Boot
window.addEventListener('DOMContentLoaded', () => {
  App.init();
});
