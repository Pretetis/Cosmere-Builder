// ============================================================
// Cosmere RPG Skill Tree - Save / Load System
// Módulo autônomo: CRUD localStorage + modal de saves
// Depende de: CosData (global)
// Callbacks obrigatórios via SavesManager.init()
// ============================================================

const SavesManager = (() => {

  const SAVES_KEY = 'cosmere_rpg_saves_v2';
  const MAX_SAVES = 20;

  let _getSerializedState, _applyState, _notify;

  // Recebe callbacks do app.js para não depender de state diretamente
  function init({ getSerializedState, applyState, notify }) {
    _getSerializedState = getSerializedState;
    _applyState        = applyState;
    _notify            = notify;
  }

  // ---- CRUD ----

  function getSaves() {
    try {
      const raw   = localStorage.getItem(SAVES_KEY);
      const saves = raw ? JSON.parse(raw) : [];

      // Migra save antigo (chave legada) se existir e não houver saves novos ainda
      if (saves.length === 0) {
        const legacy = localStorage.getItem('cosmere_rpg_profile');
        if (legacy) {
          const data     = JSON.parse(legacy);
          const migrated = {
            id:      Date.now(),
            savedAt: new Date().toISOString(),
            summary: buildSaveSummary(data),
            ...data,
          };
          saves.push(migrated);
          localStorage.setItem(SAVES_KEY, JSON.stringify(saves));
          localStorage.removeItem('cosmere_rpg_profile');
        }
      }

      return saves;
    } catch (e) {
      return [];
    }
  }

  function writeSaves(saves) {
    try {
      localStorage.setItem(SAVES_KEY, JSON.stringify(saves));
      return true;
    } catch (e) {
      // Se falhou por quota (imagem muito grande), tenta salvar sem o retrato
      if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
        const trimmed = saves.map(sv => {
          if (!sv.profile?.portrait) return sv;
          return { ...sv, profile: { ...sv.profile, portrait: null } };
        });
        try {
          localStorage.setItem(SAVES_KEY, JSON.stringify(trimmed));
          if (_notify) _notify('Save criado (imagem de aparência omitida — muito grande para o cache)');
          return true;
        } catch (e2) {
          if (_notify) _notify('Erro ao salvar: cache cheio. Exclua saves antigos.');
          return false;
        }
      }
      if (_notify) _notify('Erro ao salvar: ' + e.message);
      return false;
    }
  }

  function buildSaveSummary(data) {
    const p          = data.profile || {};
    const unlockedIds = data.unlockedSkills || [];
    const allSkills  = [...(CosData.ALL_SKILLS || CosData.SKILLS), ...CosData.RADIANT_SKILLS];
    const classes    = [...new Set(
      unlockedIds
        .map(id => { const s = allSkills.find(sk => sk.id === id); return s ? s.cls : null; })
        .filter(c => c && CosData.CLASSES.includes(c))
    )];
    return {
      name:         p.name        || 'Sem Nome',
      level:        p.level       || 1,
      race:         p.race        || 'human',
      radiantClass: p.radiantClass || null,
      metalborn:    p.metalborn ? p.metalborn.path : null,
      setting:      p.setting     || 'stormlight',
      classes,
    };
  }

  function formatSaveDate(isoStr) {
    try {
      const d = new Date(isoStr);
      return d.toLocaleDateString('pt-BR') + ' ' +
             d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    } catch (e) { return ''; }
  }

  // ---- MODAL ----

  function showSavesModal() {
    const modal = document.getElementById('saves-modal');
    if (!modal) return;
    renderSavesModal();
    modal.classList.add('visible');
  }

  function hideSavesModal() {
    const modal = document.getElementById('saves-modal');
    if (modal) modal.classList.remove('visible');
  }

  function renderSavesModal() {
    const modal = document.getElementById('saves-modal');
    if (!modal) return;
    const saves = getSaves();

    const slotsHTML = saves.length === 0
      ? `<div class="sm-empty">Nenhum save encontrado.</div>`
      : saves.slice().reverse().map(sv => {
          const s       = sv.summary || {};
          const nameTxt = s.name || 'Sem Nome';
          const lvlTxt  = `Nível ${s.level || 1}`;
          const raceTxt = { singer: 'Cantor', kandra: 'Kandra', koloss: 'Sangue-Koloss' }[s.race] || 'Humano';
          const classTxt = [
            ...(s.classes     || []),
            ...(s.radiantClass ? [s.radiantClass] : []),
            ...(s.metalborn ? [s.metalborn] : []),
          ].join(' · ') || '—';
          const settingTxt = { stormlight: 'Cosmere', mistborn: 'Mistborn', misto: 'Misto' }[s.setting || 'stormlight'];
          const dateTxt = formatSaveDate(sv.savedAt);
          return `
            <div class="sm-slot" data-id="${sv.id}">
              <div class="sm-slot-info">
                <div class="sm-slot-name">${nameTxt}</div>
                <div class="sm-slot-meta">${settingTxt} · ${lvlTxt} · ${raceTxt} · ${classTxt}</div>
                <div class="sm-slot-date">${dateTxt}</div>
              </div>
              <div class="sm-slot-actions">
                <button class="btn primary sm-load-btn" data-id="${sv.id}">Carregar</button>
                <button class="btn sm-replace-btn" data-id="${sv.id}" title="Substituir com o personagem atual">Substituir</button>
                <button class="btn danger sm-del-btn" data-id="${sv.id}" title="Excluir">✕</button>
              </div>
            </div>`;
        }).join('');

    modal.innerHTML = `
      <div class="sm-backdrop"></div>
      <div class="sm-content">
        <div class="sm-header">
          <span class="sm-title">Saves</span>
          <button class="sm-close" id="sm-close-btn">&times;</button>
        </div>
        <div class="sm-body">
          <div class="sm-save-btn-row">
            <button class="btn primary" id="sm-save-current">Salvar Personagem Atual</button>
          </div>
          ${slotsHTML}
          <div class="sm-notice">
            <strong>⚠ Atenção:</strong> Os saves ficam apenas no cache do navegador (localStorage).
            Limpar o histórico ou os dados do site <strong>apagará todos os saves permanentemente</strong>.
            Use "Exportar Ficha PDF" para guardar uma cópia segura.
          </div>
        </div>
      </div>
    `;

    modal.querySelector('#sm-close-btn')?.addEventListener('click', hideSavesModal);
    modal.querySelector('.sm-backdrop')?.addEventListener('click', hideSavesModal);

    modal.querySelector('#sm-save-current')?.addEventListener('click', () => {
      const saves = getSaves();
      if (saves.length >= MAX_SAVES) {
        _notify(`Limite de ${MAX_SAVES} saves atingido. Exclua um para continuar.`);
        return;
      }
      const data  = _getSerializedState();
      const entry = {
        id:      Date.now(),
        savedAt: new Date().toISOString(),
        summary: buildSaveSummary(data),
        ...data,
      };
      saves.push(entry);
      writeSaves(saves);
      _notify('Personagem salvo!');
      renderSavesModal();
    });

    modal.querySelectorAll('.sm-load-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id   = Number(btn.dataset.id);
        const saves = getSaves();
        const sv   = saves.find(s => s.id === id);
        if (!sv) { _notify('Save não encontrado'); return; }
        _applyState(sv);
        hideSavesModal();
        _notify(`${sv.summary?.name || 'Personagem'} carregado!`);
      });
    });

    modal.querySelectorAll('.sm-replace-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id     = Number(btn.dataset.id);
        const saves  = getSaves();
        const idx    = saves.findIndex(s => s.id === id);
        if (idx < 0) { _notify('Save não encontrado'); return; }
        const sv     = saves[idx];
        const label  = sv.summary?.name || 'este save';
        if (!confirm(`Substituir "${label}" pelo personagem atual?\nEsta ação não pode ser desfeita.`)) return;
        const data   = _getSerializedState();
        saves[idx]   = {
          id:      sv.id,          // mantém o mesmo id para preservar a posição
          savedAt: new Date().toISOString(),
          summary: buildSaveSummary(data),
          ...data,
        };
        if (writeSaves(saves)) _notify('Save substituído!');
        renderSavesModal();
      });
    });

    modal.querySelectorAll('.sm-del-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id   = Number(btn.dataset.id);
        const saves = getSaves().filter(s => s.id !== id);
        writeSaves(saves);
        renderSavesModal();
      });
    });
  }

  return { init, showSavesModal, hideSavesModal };

})();
