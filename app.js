'use strict';

// ═══════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════
const State = {
  currentSection: null,
  selectedTemplate: 'aves_estandar',
  generalPhotos: [],          // [{dataUrl, caption, name}]
  speciesCount: 0,
  speciesData: {},            // id → {fotos:[{dataUrl,caption,name}], ...}
  pendingCapture: null,       // {context:'general'|'species', speciesId, index}
  deferredInstall: null,
  birdDB: null,               // loaded from data/aves.json
  records: [],                // history (localStorage)
  currentFiles: null,         // {pdfBlob, zipBlob, base, data}
};

const SECTION_META = {
  'section-template': { title: 'Plantilla',   step: 1 },
  'section-sampling': { title: 'Sitio',       step: 2 },
  'section-species':  { title: 'Especies',    step: 3 },
  'section-photos':   { title: 'Fotos',       step: 4 },
  'section-report':   { title: 'Reporte',     step: 5 },
};
const TOTAL_STEPS = 5;

const SECTION_PREV = {
  'section-template': 'screen-home',
  'section-sampling': 'section-template',
  'section-species':  'section-sampling',
  'section-photos':   'section-species',
  'section-report':   'section-photos',
};

// ═══════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => { App.init(); });

const App = {

  async init() {
    document.getElementById('project-date').value = new Date().toISOString().split('T')[0];
    App.addSpecies();
    App.loadRecords();
    App.updateOnlineStatus();
    window.addEventListener('online',  App.updateOnlineStatus);
    window.addEventListener('offline', App.updateOnlineStatus);

    // Load bird database
    App.loadBirdDatabase();

    // PWA install
    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault();
      State.deferredInstall = e;
      document.getElementById('btn-install').style.display = 'inline-flex';
    });

    // iOS detection
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
                  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isStandalone = navigator.standalone === true ||
                         window.matchMedia('(display-mode: standalone)').matches;
    if (isIOS && !isStandalone) {
      document.getElementById('btn-install-ios').style.display = 'inline-flex';
      if (!localStorage.getItem('ios_banner_dismissed')) {
        setTimeout(() => App.showIOSBanner(), 2800);
      }
    }

    // SW registration
    if ('serviceWorker' in navigator) {
      const swUrl  = new URL('service-worker.js', window.location.href).href;
      const scope  = new URL('./', window.location.href).href;
      navigator.serviceWorker.register(swUrl, { scope }).catch(() => {});
    }
  },

  // ── BIRD DATABASE ──────────────────────────────────

  async loadBirdDatabase() {
    try {
      const res = await fetch('data/aves.json');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      State.birdDB = await res.json();
      // Refresh any open species entries
      document.querySelectorAll('.sp-family-select').forEach(sel => {
        App.populateFamilySelect(sel);
      });
    } catch(e) {
      console.warn('[App] Bird DB not loaded:', e.message);
    }
  },

  populateFamilySelect(selectEl) {
    if (!State.birdDB) return;
    const current = selectEl.value;
    selectEl.innerHTML = '<option value="">— Seleccionar familia —</option>';
    State.birdDB.familias.forEach(f => {
      const opt = document.createElement('option');
      opt.value = f.id;
      opt.textContent = `${f.familia} — ${f.nombre_comun}`;
      selectEl.appendChild(opt);
    });
    if (current) selectEl.value = current;
  },

  populateSpeciesSelect(familyId, speciesSelectEl, currentVal = '') {
    speciesSelectEl.innerHTML = '<option value="">— Seleccionar especie —</option>';
    if (!familyId || !State.birdDB) return;
    const familia = State.birdDB.familias.find(f => f.id === familyId);
    if (!familia) return;
    familia.especies.forEach(sp => {
      const opt = document.createElement('option');
      opt.value = sp.nombre_cientifico;
      opt.textContent = `${sp.nombre_cientifico} — ${sp.nombre_comun}`;
      opt.dataset.comun = sp.nombre_comun;
      speciesSelectEl.appendChild(opt);
    });
    const manualOpt = document.createElement('option');
    manualOpt.value = '__manual__';
    manualOpt.textContent = '✏ Ingresar especie manualmente';
    speciesSelectEl.appendChild(manualOpt);
    if (currentVal) speciesSelectEl.value = currentVal;
  },

  onFamilyChange(familySelId, speciesSelId, manualDivId) {
    const familySel  = document.getElementById(familySelId);
    const speciesSel = document.getElementById(speciesSelId);
    const manualDiv  = document.getElementById(manualDivId);
    App.populateSpeciesSelect(familySel.value, speciesSel);
    if (manualDiv) manualDiv.style.display = 'none';
  },

  onSpeciesChange(speciesSelId, manualDivId) {
    const sel = document.getElementById(speciesSelId);
    const div = document.getElementById(manualDivId);
    if (!div) return;
    div.style.display = (sel.value === '__manual__') ? 'block' : 'none';
  },

  // ── NAVIGATION ─────────────────────────────────────

  goTo(target) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    if (target === 'screen-home') {
      document.getElementById('screen-home').classList.add('active');
      State.currentSection = null;
    } else {
      document.getElementById('screen-app').classList.add('active');
      document.querySelectorAll('.form-section').forEach(s => s.classList.remove('active'));
      const sec = document.getElementById(target);
      if (sec) sec.classList.add('active');
      State.currentSection = target;
      App.updateNavUI(target);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  },

  back() {
    const dest = SECTION_PREV[State.currentSection] || 'screen-home';
    App.goTo(dest);
  },

  nextSection(target) {
    if (!App.validateSection(State.currentSection)) return;
    if (target === 'section-report') App.buildReportSummary();
    App.saveDraft();
    App.goTo(target);
  },

  prevSection(target) { App.goTo(target); },

  updateNavUI(sectionId) {
    const meta = SECTION_META[sectionId] || { title: '', step: 1 };
    document.getElementById('nav-title').textContent = meta.title;
    document.getElementById('nav-step').textContent  = `${meta.step} / ${TOTAL_STEPS}`;
    document.getElementById('progress-bar').style.width = `${(meta.step / TOTAL_STEPS) * 100}%`;
    document.querySelectorAll('.step-dot').forEach(dot => {
      const s = parseInt(dot.dataset.step);
      dot.classList.remove('active', 'done');
      if (s === meta.step) dot.classList.add('active');
      else if (s < meta.step) dot.classList.add('done');
    });
  },

  // ── VALIDATION ─────────────────────────────────────

  validateSection(id) {
    if (id === 'section-template') {
      if (!document.getElementById('project-name').value.trim())
        { App.toast('Ingresa el nombre del proyecto', 'error'); return false; }
      if (!document.getElementById('project-date').value)
        { App.toast('Selecciona la fecha del muestreo', 'error'); return false; }
    }
    if (id === 'section-sampling') {
      if (!document.getElementById('location').value.trim())
        { App.toast('Ingresa la ubicación del muestreo', 'error'); return false; }
    }
    return true;
  },

  // ── TEMPLATE SELECTION ─────────────────────────────

  selectTemplate(card) {
    document.querySelectorAll('.template-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    State.selectedTemplate = card.dataset.value;
  },

  // ── SPECIES ────────────────────────────────────────

  addSpecies() {
    State.speciesCount++;
    const n = State.speciesCount;
    State.speciesData[n] = { fotos: [] };

    const list = document.createElement('div');
    list.className = 'species-entry';
    list.id = `species-${n}`;
    list.innerHTML = `
      <div class="species-entry-header">
        <span class="species-num">Especie #${n}</span>
        <button class="species-remove" onclick="App.removeSpecies(${n})">✕ Eliminar</button>
      </div>

      <!-- Family + Species cascade -->
      <div class="form-row">
        <div class="form-group">
          <label class="form-label required" for="sp-family-${n}">Familia</label>
          <select id="sp-family-${n}" class="form-input sp-family-select"
            onchange="App.onFamilyChange('sp-family-${n}','sp-species-${n}','sp-manual-${n}')">
            <option value="">— Seleccionar familia —</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label required" for="sp-species-${n}">Especie</label>
          <select id="sp-species-${n}" class="form-input"
            onchange="App.onSpeciesChange('sp-species-${n}','sp-manual-${n}')">
            <option value="">— Primero selecciona familia —</option>
          </select>
        </div>
      </div>

      <!-- Manual entry fallback -->
      <div id="sp-manual-${n}" style="display:none">
        <div class="form-group">
          <label class="form-label" for="sp-name-${n}">Nombre científico / común (manual)</label>
          <input type="text" id="sp-name-${n}" class="form-input" placeholder="Ej: Turdus fuscater / Mirla patiamarilla" />
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="sp-count-${n}">Individuos</label>
          <input type="number" id="sp-count-${n}" class="form-input" min="1" value="1" />
        </div>
        <div class="form-group">
          <label class="form-label" for="sp-behavior-${n}">Comportamiento</label>
          <select id="sp-behavior-${n}" class="form-input">
            <option value="">Seleccionar...</option>
            <option>Canto / Vocalización</option><option>Forrajeo / Alimentación</option>
            <option>Vuelo</option><option>Percha</option><option>Anidación / Cortejo</option>
            <option>Descanso</option><option>Acicalamiento</option><option>Otro</option>
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="sp-sex-${n}">Sexo / Edad</label>
          <select id="sp-sex-${n}" class="form-input">
            <option value="">No determinado</option>
            <option>Macho adulto</option><option>Hembra adulta</option>
            <option>Juvenil</option><option>Inmaduro</option><option>Grupo mixto</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="sp-notes-${n}">Notas</label>
          <input type="text" id="sp-notes-${n}" class="form-input" placeholder="Observaciones..." />
        </div>
      </div>

      <!-- Per-species photos -->
      <div class="sp-photos-section">
        <div class="sp-photos-header">
          <span class="sp-photos-label">📷 Fotos de esta especie</span>
          <div class="sp-photo-btns">
            <label class="sp-photo-add-btn" for="sp-photo-file-${n}">
              <svg viewBox="0 0 20 20" fill="none"><path d="M10 4v12M4 10h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
              Galería
              <input type="file" id="sp-photo-file-${n}" accept="image/jpeg,image/png,image/jpg" multiple hidden
                onchange="App.handlePhotoUpload(event,'species',${n})" />
            </label>
            <button class="sp-photo-add-btn" onclick="App.openSpeciesCamera(${n})">
              <svg viewBox="0 0 20 20" fill="none"><circle cx="10" cy="11" r="3" stroke="currentColor" stroke-width="1.8"/><path d="M3 8a1 1 0 0 1 1-1h1l2-2h6l2 2h1a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8z" stroke="currentColor" stroke-width="1.8"/></svg>
              Cámara
            </button>
          </div>
        </div>
        <div id="sp-photo-grid-${n}" class="sp-photo-grid">
          <span class="sp-photo-empty">Sin fotos para esta especie</span>
        </div>
      </div>
    `;
    document.getElementById('species-list').appendChild(list);

    // Populate family dropdown if DB is loaded
    const familySel = document.getElementById(`sp-family-${n}`);
    if (State.birdDB) App.populateFamilySelect(familySel);

    list.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  },

  removeSpecies(n) {
    const el = document.getElementById(`species-${n}`);
    if (el) el.remove();
    delete State.speciesData[n];
  },

  openSpeciesCamera(n) {
    const input = document.getElementById('camera-species') ||
                  (() => {
                    const i = document.createElement('input');
                    i.type = 'file'; i.accept = 'image/*';
                    i.setAttribute('capture', 'environment');
                    i.id = 'camera-species';
                    i.hidden = true;
                    document.body.appendChild(i);
                    return i;
                  })();
    input.onchange = e => App.handlePhotoUpload(e, 'species', n);
    input.value = '';
    input.click();
  },

  getSpeciesData() {
    return Array.from(document.querySelectorAll('.species-entry')).map(entry => {
      const id = entry.id.replace('species-', '');
      const familySel  = document.getElementById(`sp-family-${id}`);
      const speciesSel = document.getElementById(`sp-species-${id}`);
      const manualName = document.getElementById(`sp-name-${id}`)?.value?.trim() || '';

      let nombre = '';
      let familiaId = familySel?.value || '';
      let familiaLabel = '';

      if (speciesSel?.value === '__manual__' || !speciesSel?.value) {
        nombre = manualName;
      } else {
        nombre = speciesSel.value;
      }

      if (familiaId && State.birdDB) {
        const f = State.birdDB.familias.find(f => f.id === familiaId);
        if (f) familiaLabel = `${f.familia} — ${f.nombre_comun}`;
      }

      // Get nombre comun from selected option
      let nombreComun = '';
      if (speciesSel?.value && speciesSel.value !== '__manual__') {
        const opt = speciesSel.querySelector(`option[value="${speciesSel.value}"]`);
        if (opt) nombreComun = opt.dataset.comun || '';
      }

      return {
        id,
        nombre,
        nombreComun,
        familia: familiaLabel,
        count:    document.getElementById(`sp-count-${id}`)?.value    || '1',
        behavior: document.getElementById(`sp-behavior-${id}`)?.value || '',
        sex:      document.getElementById(`sp-sex-${id}`)?.value      || '',
        notes:    (document.getElementById(`sp-notes-${id}`)?.value || '').trim(),
        fotos:    State.speciesData[id]?.fotos || [],
      };
    }).filter(s => s.nombre.trim());
  },

  // ── PHOTOS ─────────────────────────────────────────

  handlePhotoUpload(event, context, speciesId) {
    const files = Array.from(event.target.files);
    if (!files.length) return;

    files.forEach(file => {
      if (!file.type.match(/image\/(jpeg|png|jpg)/)) return;
      const reader = new FileReader();
      reader.onload = e => {
        const ext = file.name.split('.').pop() || 'jpg';
        const photo = { dataUrl: e.target.result, caption: '', name: '' };

        if (context === 'general') {
          const idx = State.generalPhotos.length;
          photo.name = `foto_general_${idx + 1}.${ext}`;
          State.generalPhotos.push(photo);
          App.renderPhotoGrid('general');
          State.pendingCapture = { context: 'general', index: idx };
          App.openCaptionModal();
        } else {
          const sp = State.speciesData[speciesId];
          if (!sp) return;
          const idx = sp.fotos.length;
          photo.name = `foto_sp${speciesId}_${idx + 1}.${ext}`;
          sp.fotos.push(photo);
          App.renderSpeciesPhotoGrid(speciesId);
          State.pendingCapture = { context: 'species', speciesId, index: idx };
          App.openCaptionModal();
        }
      };
      reader.readAsDataURL(file);
    });
    event.target.value = '';
  },

  renderPhotoGrid(context) {
    const grid  = document.getElementById('photo-grid-general');
    const empty = document.getElementById('photo-empty-general');
    const count = document.getElementById('photo-count-general');
    if (!grid) return;
    grid.querySelectorAll('.photo-thumb').forEach(t => t.remove());
    const photos = State.generalPhotos;
    if (!photos.length) {
      if (empty) empty.style.display = 'flex';
      if (count) count.style.display = 'none';
      return;
    }
    if (empty) empty.style.display = 'none';
    photos.forEach((p, i) => {
      const thumb = App.makeThumb(p, i, () => {
        State.generalPhotos.splice(i, 1);
        App.renderPhotoGrid('general');
      });
      grid.appendChild(thumb);
    });
    if (count) { count.style.display = 'block'; count.textContent = `${photos.length} foto${photos.length !== 1 ? 's' : ''} general${photos.length !== 1 ? 'es' : ''}`; }
  },

  renderSpeciesPhotoGrid(speciesId) {
    const grid = document.getElementById(`sp-photo-grid-${speciesId}`);
    if (!grid) return;
    grid.innerHTML = '';
    const fotos = State.speciesData[speciesId]?.fotos || [];
    if (!fotos.length) {
      grid.innerHTML = '<span class="sp-photo-empty">Sin fotos para esta especie</span>';
      return;
    }
    fotos.forEach((p, i) => {
      const thumb = App.makeThumb(p, i, () => {
        State.speciesData[speciesId].fotos.splice(i, 1);
        App.renderSpeciesPhotoGrid(speciesId);
      });
      grid.appendChild(thumb);
    });
  },

  makeThumb(photo, idx, onRemove) {
    const thumb = document.createElement('div');
    thumb.className = 'photo-thumb';
    thumb.innerHTML = `
      <span class="photo-thumb-num">${idx + 1}</span>
      <img src="${photo.dataUrl}" loading="lazy" />
      <button class="photo-thumb-remove">✕</button>
      ${photo.caption ? `<div class="photo-thumb-caption">${App.escapeHtml(photo.caption)}</div>` : ''}
    `;
    thumb.querySelector('.photo-thumb-remove').onclick = onRemove;
    return thumb;
  },

  openCaptionModal() {
    const modal = document.getElementById('caption-modal');
    if (modal) { modal.style.display = 'flex'; document.getElementById('caption-input').value = ''; document.getElementById('caption-input').focus(); }
  },

  closeCaptionModal(event) {
    if (event && event.target !== event.currentTarget) return;
    document.getElementById('caption-modal').style.display = 'none';
    State.pendingCapture = null;
  },

  saveCaption() {
    const caption = document.getElementById('caption-input').value.trim();
    const pc = State.pendingCapture;
    if (pc) {
      if (pc.context === 'general' && State.generalPhotos[pc.index]) {
        State.generalPhotos[pc.index].caption = caption;
        App.renderPhotoGrid('general');
      } else if (pc.context === 'species' && State.speciesData[pc.speciesId]?.fotos[pc.index]) {
        State.speciesData[pc.speciesId].fotos[pc.index].caption = caption;
        App.renderSpeciesPhotoGrid(pc.speciesId);
      }
    }
    document.getElementById('caption-modal').style.display = 'none';
    State.pendingCapture = null;
  },

  // ── GPS ────────────────────────────────────────────

  getGPS() {
    if (!navigator.geolocation) { App.toast('GPS no disponible', 'error'); return; }
    App.toast('Obteniendo ubicación...');
    navigator.geolocation.getCurrentPosition(
      pos => {
        document.getElementById('lat').value = pos.coords.latitude.toFixed(6);
        document.getElementById('lon').value = pos.coords.longitude.toFixed(6);
        if (pos.coords.altitude) document.getElementById('altitude').value = Math.round(pos.coords.altitude);
        App.toast('📍 Coordenadas obtenidas', 'success');
      },
      () => App.toast('No se pudo obtener la ubicación', 'error'),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  },

  // ── COLLECT DATA ───────────────────────────────────

  collectData() {
    return {
      id:          Date.now().toString(),
      template:    State.selectedTemplate,
      nombre_proyecto: (document.getElementById('project-name')?.value || '').trim(),
      fecha:       document.getElementById('project-date')?.value || '',
      autor:       (document.getElementById('project-author')?.value || '').trim(),
      institucion: (document.getElementById('project-institution')?.value || '').trim(),
      ubicacion:   (document.getElementById('location')?.value || '').trim(),
      latitud:     document.getElementById('lat')?.value || '',
      longitud:    document.getElementById('lon')?.value || '',
      altitud:     document.getElementById('altitude')?.value || '',
      ecosistema:  document.getElementById('ecosystem')?.value || '',
      clima:       document.getElementById('weather')?.value || '',
      temperatura: document.getElementById('temperature')?.value || '',
      metodo:      document.getElementById('method')?.value || '',
      duracion:    document.getElementById('duration')?.value || '',
      hora_inicio: document.getElementById('time-start')?.value || '',
      hora_fin:    document.getElementById('time-end')?.value || '',
      observador:  (document.getElementById('observer')?.value || '').trim(),
      notas_generales: (document.getElementById('sampling-notes')?.value || '').trim(),
      especies:    App.getSpeciesData(),
      fotos:       State.generalPhotos,
      created_at:  new Date().toISOString(),
    };
  },

  // ── REPORT SUMMARY ─────────────────────────────────

  buildReportSummary() {
    const data = App.collectData();
    const templateLabels = {
      'aves_estandar':      'Muestreo estándar',
      'biodiversidad':      'Monitoreo de biodiversidad',
      'registro_extendido': 'Registro extendido',
    };
    const totalSpPhotos = data.especies.reduce((s, sp) => s + (sp.fotos?.length || 0), 0);
    document.getElementById('report-summary').innerHTML = `
      <h3>📋 Resumen del registro</h3>
      <div class="summary-grid">
        <div class="summary-item"><span>Proyecto</span><span>${App.escapeHtml(data.nombre_proyecto)}</span></div>
        <div class="summary-item"><span>Fecha</span><span>${data.fecha}</span></div>
        <div class="summary-item"><span>Plantilla</span><span>${templateLabels[State.selectedTemplate] || State.selectedTemplate}</span></div>
        <div class="summary-item"><span>Ubicación</span><span>${App.escapeHtml(data.ubicacion) || '—'}</span></div>
        <div class="summary-item"><span>Método</span><span>${data.metodo || '—'}</span></div>
        <div class="summary-item"><span>Especies</span><span>${data.especies.length} registradas</span></div>
        <div class="summary-item"><span>Fotos por especie</span><span>${totalSpPhotos} fotos</span></div>
        <div class="summary-item"><span>Fotos generales</span><span>${data.fotos.length} fotos</span></div>
      </div>
    `;
    const base = `${(data.nombre_proyecto || 'Proyecto').replace(/\s+/g,'_')}_${data.fecha}`;
    const pdfEl = document.getElementById('pdf-filename');
    const zipEl = document.getElementById('zip-filename');
    if (pdfEl) pdfEl.textContent = `${base}.pdf`;
    if (zipEl) zipEl.textContent = `${base}.zip`;
  },

  // ── MAIN GENERATE ──────────────────────────────────

  async generateReport() {
    const data = App.collectData();
    if (!data.nombre_proyecto || !data.fecha) {
      App.toast('Completa nombre del proyecto y fecha', 'error');
      return;
    }

    const base = `${data.nombre_proyecto.replace(/\s+/g,'_')}_${data.fecha}`;

    // Open download modal in progress state
    App.openDownloadModal();
    const setP = (pct, msg) => {
      document.getElementById('dl-progress-fill').style.width = pct + '%';
      document.getElementById('dl-progress-msg').textContent  = msg;
    };

    try {
      // 1. Load LaTeX template
      setP(5, `Cargando plantilla ${data.template}.tex...`);
      await App.delay(100);
      let templateContent = '';
      try { templateContent = await App.loadTemplate(data.template); } catch(e) {}

      // 2. Generate .tex
      setP(15, 'Generando código LaTeX...');
      await App.delay(100);
      const texContent = templateContent ? App.generateLatex(data, templateContent) : '';

      // 3. Build PDF
      setP(25, 'Construyendo PDF...');
      await App.delay(100);
      const pdfDoc = await App.buildPDF(data, setP);
      const pdfBlob = pdfDoc.output('blob');

      setP(78, 'Empaquetando ZIP...');
      await App.delay(100);

      // 4. Build ZIP
      const zip = new JSZip();
      const folder = zip.folder(base);

      // PDF in ZIP
      folder.file(`${base}.pdf`, pdfBlob);
      setP(82, 'Agregando LaTeX...');
      await App.delay(80);

      // TEX in ZIP
      if (texContent) folder.file(`${base}.tex`, texContent);

      // Photos: per species
      const imgFolder = folder.folder('imagenes');
      let photoCount = 0;
      for (const sp of data.especies) {
        for (const foto of (sp.fotos || [])) {
          const b64 = foto.dataUrl.split(',')[1];
          imgFolder.file(foto.name, b64, { base64: true });
          photoCount++;
        }
      }
      // Photos: general
      for (const foto of data.fotos) {
        const b64 = foto.dataUrl.split(',')[1];
        imgFolder.file(foto.name, b64, { base64: true });
        photoCount++;
      }

      setP(88, `${photoCount} imágenes empaquetadas...`);
      await App.delay(80);

      // JSON data (without large base64 photos)
      const dataForJSON = { ...data, fotos: data.fotos.map(f => ({ name: f.name, caption: f.caption })), especies: data.especies.map(sp => ({ ...sp, fotos: sp.fotos.map(f => ({ name: f.name, caption: f.caption })) })) };
      folder.file(`${base}_datos.json`, JSON.stringify(dataForJSON, null, 2));

      // README
      folder.file('README.txt', App.generateReadme(data));

      setP(94, 'Comprimiendo ZIP...');
      const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });

      setP(100, '¡Listo!');
      await App.delay(300);

      // Save blobs for download buttons
      State.currentFiles = { pdfBlob, zipBlob, base, data };

      // Save record to history
      App.saveRecord(data, base);

      // Show download modal done phase
      App.showDownloadDone(base);

    } catch(err) {
      console.error(err);
      App.closeDownloadModal();
      App.toast('Error generando el reporte: ' + err.message, 'error');
      document.getElementById('btn-generate').disabled = false;
    }
  },

  downloadFile(type) {
    if (!State.currentFiles) return;
    const { pdfBlob, zipBlob, base } = State.currentFiles;
    if (type === 'pdf') {
      App.triggerDownload(pdfBlob, `${base}.pdf`);
      App.toast('✓ PDF descargado', 'success');
    } else {
      App.triggerDownload(zipBlob, `${base}.zip`);
      App.toast('✓ ZIP descargado', 'success');
    }
  },

  triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href     = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  },

  openDownloadModal() {
    document.getElementById('dl-phase-progress').style.display = 'block';
    document.getElementById('dl-phase-done').style.display     = 'none';
    document.getElementById('dl-progress-fill').style.width    = '0%';
    document.getElementById('download-modal').style.display    = 'flex';
    document.body.style.overflow = 'hidden';
  },

  showDownloadDone(base) {
    document.getElementById('dl-phase-progress').style.display = 'none';
    document.getElementById('dl-phase-done').style.display     = 'block';
    document.getElementById('dl-pdf-name').textContent = `${base}.pdf`;
    document.getElementById('dl-zip-name').textContent = `${base}.zip`;
    // Auto-trigger PDF download immediately
    setTimeout(() => App.downloadFile('pdf'), 300);
  },

  closeDownloadModal() {
    document.getElementById('download-modal').style.display = 'none';
    document.body.style.overflow = '';
  },

  // ── RECORDS HISTORY ────────────────────────────────

  saveRecord(data, base) {
    const record = {
      id:       data.id,
      base,
      nombre_proyecto: data.nombre_proyecto,
      fecha:    data.fecha,
      template: data.template,
      autor:    data.autor,
      ubicacion: data.ubicacion,
      total_especies: data.especies.length,
      total_fotos: data.fotos.length + data.especies.reduce((s,sp) => s + (sp.fotos?.length||0), 0),
      created_at: data.created_at,
      // Store full data for re-generation (without photo blobs to save space)
      data: {
        ...data,
        fotos: data.fotos.map(f => ({ name: f.name, caption: f.caption, dataUrl: f.dataUrl })),
        especies: data.especies.map(sp => ({
          ...sp,
          fotos: sp.fotos.map(f => ({ name: f.name, caption: f.caption, dataUrl: f.dataUrl }))
        }))
      }
    };

    State.records.unshift(record);
    // Keep max 20 records in localStorage
    if (State.records.length > 20) State.records = State.records.slice(0, 20);

    try {
      // Try to save with photos; if too large, save without
      const json = JSON.stringify(State.records);
      if (json.length < 4 * 1024 * 1024) { // < 4MB
        localStorage.setItem('avesampler_records', json);
      } else {
        // Strip photo data from old records
        const light = State.records.map((r, i) => i === 0 ? r : {
          ...r,
          data: { ...r.data, fotos: r.data.fotos?.map(f => ({ name: f.name, caption: f.caption })) || [],
            especies: r.data.especies?.map(sp => ({ ...sp, fotos: [] })) || [] }
        });
        localStorage.setItem('avesampler_records', JSON.stringify(light));
      }
    } catch(e) { /* quota exceeded */ }

    App.renderRecordsList();
  },

  loadRecords() {
    try {
      const raw = localStorage.getItem('avesampler_records');
      if (raw) State.records = JSON.parse(raw);
    } catch(e) {}
    App.renderRecordsList();
  },

  renderRecordsList() {
    const list  = document.getElementById('records-list');
    const empty = document.getElementById('records-empty');
    list.querySelectorAll('.record-item').forEach(el => el.remove());

    if (!State.records.length) {
      if (empty) empty.style.display = 'flex';
      return;
    }
    if (empty) empty.style.display = 'none';

    State.records.forEach((rec, idx) => {
      const item = document.createElement('div');
      item.className = 'record-item';
      item.innerHTML = `
        <div class="record-item-header" onclick="App.toggleRecord(${idx})">
          <div class="record-item-info">
            <strong>${App.escapeHtml(rec.nombre_proyecto)}</strong>
            <span>${rec.fecha} · ${rec.total_especies} esp. · ${rec.total_fotos} fotos</span>
          </div>
          <svg class="record-chevron" viewBox="0 0 20 20" fill="none"><path d="M5 8l5 5 5-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
        <div class="record-item-actions" id="rec-actions-${idx}" style="display:none">
          <button class="record-dl-btn pdf" onclick="App.reDownloadRecord(${idx},'pdf')">
            <span class="file-badge pdf">PDF</span> Descargar PDF
          </button>
          <button class="record-dl-btn zip" onclick="App.reDownloadRecord(${idx},'zip')">
            <span class="file-badge zip">ZIP</span> Descargar ZIP
          </button>
          <button class="record-dl-btn json" onclick="App.reDownloadRecord(${idx},'json')">
            <span class="file-badge tex">JSON</span> Datos JSON
          </button>
          <button class="record-delete-btn" onclick="App.deleteRecord(${idx})">🗑 Eliminar</button>
        </div>
      `;
      list.insertBefore(item, empty);
    });
  },

  toggleRecord(idx) {
    const el = document.getElementById(`rec-actions-${idx}`);
    if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
  },

  async reDownloadRecord(idx, type) {
    const rec = State.records[idx];
    if (!rec) return;
    App.toast('Generando descarga...', '');
    try {
      if (type === 'json') {
        const blob = new Blob([JSON.stringify(rec.data, null, 2)], { type: 'application/json' });
        App.triggerDownload(blob, `${rec.base}_datos.json`);
        return;
      }
      // Regenerate PDF
      const pdfDoc  = await App.buildPDF(rec.data, () => {});
      const pdfBlob = pdfDoc.output('blob');
      if (type === 'pdf') {
        App.triggerDownload(pdfBlob, `${rec.base}.pdf`);
        return;
      }
      // Build ZIP
      const zip    = new JSZip();
      const folder = zip.folder(rec.base);
      folder.file(`${rec.base}.pdf`, pdfBlob);

      // Photos
      const imgFolder = folder.folder('imagenes');
      const allPhotos = [
        ...(rec.data.fotos || []),
        ...(rec.data.especies || []).flatMap(sp => sp.fotos || [])
      ];
      for (const foto of allPhotos) {
        if (foto.dataUrl) {
          imgFolder.file(foto.name, foto.dataUrl.split(',')[1], { base64: true });
        }
      }
      folder.file(`${rec.base}_datos.json`, JSON.stringify(rec.data, null, 2));

      const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
      App.triggerDownload(zipBlob, `${rec.base}.zip`);
    } catch(e) {
      App.toast('Error al re-generar: ' + e.message, 'error');
    }
  },

  deleteRecord(idx) {
    if (!confirm('¿Eliminar este registro del historial?')) return;
    State.records.splice(idx, 1);
    try { localStorage.setItem('avesampler_records', JSON.stringify(State.records)); } catch(e) {}
    App.renderRecordsList();
  },

  exportAllRecordsJSON() {
    if (!State.records.length) { App.toast('No hay registros guardados', 'error'); return; }
    const lightRecords = State.records.map(r => ({ ...r, data: undefined }));
    const blob = new Blob([JSON.stringify(lightRecords, null, 2)], { type: 'application/json' });
    App.triggerDownload(blob, `avesampler_historial_${new Date().toISOString().split('T')[0]}.json`);
  },

  openRecordsPanel() {
    App.renderRecordsList();
    document.getElementById('records-overlay').style.display = 'block';
    document.getElementById('records-panel').classList.add('open');
    document.body.style.overflow = 'hidden';
  },

  closeRecordsPanel() {
    document.getElementById('records-overlay').style.display = 'none';
    document.getElementById('records-panel').classList.remove('open');
    document.body.style.overflow = '';
  },

  // ── TEMPLATE LOADING ───────────────────────────────

  async loadTemplate(id) {
    if (App._tplCache) {
      if (App._tplCache[id]) return App._tplCache[id];
    } else { App._tplCache = {}; }
    const res = await fetch(`templates/${id}.tex`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    App._tplCache[id] = text;
    return text;
  },

  // ── LATEX GENERATION ───────────────────────────────

  generateLatex(data, tpl) {
    let tex = tpl;
    const dateObj = data.fecha ? new Date(data.fecha + 'T12:00:00') : new Date();
    const dateStr = dateObj.toLocaleDateString('es-CO', { year:'numeric', month:'long', day:'numeric' });
    const coords  = (data.latitud && data.longitud) ? `${data.latitud}, ${data.longitud}` : 'No registradas';

    const speciesRows = data.especies.length
      ? data.especies.map(sp =>
          `  ${App.ltx(sp.nombre)} & ${sp.count} & ${App.ltx(sp.behavior)} & ${App.ltx(sp.sex)} & ${App.ltx(sp.notes)} \\\\`
        ).join('\n  \\hline\n')
      : '  \\textit{Sin registros} & — & — & — & — \\\\';

    const allPhotos = [...(data.fotos||[]), ...data.especies.flatMap(sp => sp.fotos||[])];
    const photoIncludes = allPhotos.length
      ? allPhotos.map((p,i) =>
          `\\begin{figure}[h!]\n\\centering\n\\includegraphics[width=0.75\\textwidth]{imagenes/${p.name}}\n\\caption{${App.ltx(p.caption || `Fotografía ${i+1}`)}}\n\\end{figure}`
        ).join('\n\n')
      : '% No se adjuntaron fotografías';

    const vars = {
      '{{nombre_proyecto}}':  App.ltx(data.nombre_proyecto),
      '{{fecha}}':            App.ltx(dateStr),
      '{{fecha_raw}}':        data.fecha,
      '{{autor}}':            App.ltx(data.autor || 'No especificado'),
      '{{institucion}}':      App.ltx(data.institucion || 'No especificada'),
      '{{ubicacion}}':        App.ltx(data.ubicacion),
      '{{coordenadas}}':      coords,
      '{{altitud}}':          data.altitud ? `${data.altitud} m.s.n.m.` : 'No registrada',
      '{{ecosistema}}':       App.ltx(data.ecosistema || 'No especificado'),
      '{{clima}}':            App.ltx(data.clima || 'No registrado'),
      '{{temperatura}}':      data.temperatura ? `${data.temperatura}°C` : 'No registrada',
      '{{metodo}}':           App.ltx(data.metodo || 'No especificado'),
      '{{duracion}}':         data.duracion ? `${data.duracion} minutos` : 'No registrada',
      '{{hora_inicio}}':      data.hora_inicio || 'No registrada',
      '{{hora_fin}}':         data.hora_fin || 'No registrada',
      '{{observador}}':       App.ltx(data.observador || 'No especificado'),
      '{{notas_generales}}':  App.ltx(data.notas_generales || 'Sin observaciones.'),
      '{{total_especies}}':   String(data.especies.length),
      '{{total_individuos}}': String(data.especies.reduce((s,e) => s+parseInt(e.count||0), 0)),
      '{{total_fotos}}':      String(allPhotos.length),
      '{{tabla_especies}}':   speciesRows,
      '{{fotografias}}':      photoIncludes,
    };
    Object.entries(vars).forEach(([k,v]) => { tex = tex.split(k).join(v); });
    return tex;
  },

  ltx(str) {
    if (!str) return '';
    return String(str)
      .replace(/\\/g, '\\textbackslash{}').replace(/&/g, '\\&').replace(/%/g, '\\%')
      .replace(/\$/g, '\\$').replace(/#/g, '\\#').replace(/_/g, '\\_')
      .replace(/\{/g, '\\{').replace(/\}/g, '\\}')
      .replace(/~/g, '\\textasciitilde{}').replace(/\^/g, '\\textasciicircum{}');
  },

  // ── PDF BUILDER ────────────────────────────────────

  async buildPDF(data, setP) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const W = 210, H = 297, ML = 22, MR = 18, MT = 18, MB = 18, CW = W - ML - MR;

    const C = {
      dg: [28,61,44], mg: [45,92,64], lg: [200,221,210],
      am: [200,120,10], pa: [246,241,232], wh: [255,255,255],
      gr: [120,148,134], tx: [26,42,32], red: [180,40,30],
    };

    const dateObj = data.fecha ? new Date(data.fecha+'T12:00:00') : new Date();
    const dateStr = dateObj.toLocaleDateString('es-CO',{year:'numeric',month:'long',day:'numeric'});
    const tplLabel = { 'aves_estandar':'Muestreo estándar','biodiversidad':'Monitoreo de biodiversidad','registro_extendido':'Registro extendido' }[data.template] || data.template;
    const totalInd = data.especies.reduce((s,e)=>s+parseInt(e.count||0),0);
    const allPhotos = [...(data.fotos||[]), ...data.especies.flatMap(sp=>sp.fotos||[])];

    // ── Header/Footer helper ──
    const addPage = () => {
      doc.addPage();
      doc.setFillColor(...C.dg); doc.rect(0,0,W,13,'F');
      doc.setFont('helvetica','bold'); doc.setFontSize(7.5); doc.setTextColor(...C.wh);
      doc.text('AveSampler', ML, 8.5);
      doc.setFont('helvetica','normal'); doc.setTextColor(...C.lg);
      doc.text(`${data.nombre_proyecto}  ·  ${data.fecha}`, W-MR, 8.5, {align:'right'});
      doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(...C.gr);
      doc.text(`Página ${doc.internal.getCurrentPageInfo().pageNumber}`, W/2, H-7, {align:'center'});
      return 20;
    };

    // ── Section title helper ──
    const secTitle = (txt, y) => {
      doc.setFillColor(...C.dg); doc.rect(ML, y, CW, 7.5, 'F');
      doc.setFont('helvetica','bold'); doc.setFontSize(9.5); doc.setTextColor(...C.wh);
      doc.text(txt.toUpperCase(), ML+3, y+5.2);
      return y + 13;
    };

    // ── Info row helper ──
    const infoRow = (label, val, y, shaded) => {
      if (shaded) { doc.setFillColor(...C.pa); doc.rect(ML,y-3.5,CW,6.5,'F'); }
      doc.setFont('helvetica','bold'); doc.setFontSize(7.8); doc.setTextColor(...C.mg);
      doc.text(label, ML+2, y);
      doc.setFont('helvetica','normal'); doc.setTextColor(...C.tx);
      const lines = doc.splitTextToSize(String(val||'—'), CW-48);
      doc.text(lines[0]||'—', ML+48, y);
      return y + 6.5;
    };

    // ══════════════════════════════════
    // COVER PAGE
    // ══════════════════════════════════
    setP(28, 'Creando portada...');
    doc.setFillColor(...C.dg); doc.rect(0,0,W,H,'F');
    // Top accent
    doc.setFillColor(...C.mg); doc.rect(0,0,W,8,'F');
    doc.setFillColor(...C.am); doc.rect(ML,52,CW,0.7,'F');

    // Tag
    doc.setFont('helvetica','bold'); doc.setFontSize(7.5);
    doc.setTextColor(...C.am);
    doc.text(tplLabel.toUpperCase(), ML, 48, {charSpace:1.2});

    // Title
    doc.setFont('helvetica','bold'); doc.setFontSize(26);
    doc.setTextColor(...C.wh);
    const titleLines = doc.splitTextToSize(data.nombre_proyecto||'Sin título', CW);
    doc.text(titleLines, ML, 66);
    const titleH = titleLines.length * 10;

    // Subtitle
    doc.setFont('helvetica','italic'); doc.setFontSize(12);
    doc.setTextColor(...C.lg);
    doc.text('Registro de Avifauna en Campo', ML, 68 + titleH);

    // Info card
    const cardY = 96 + titleH;
    doc.setFillColor(...C.mg); doc.roundedRect(ML, cardY, CW, 64, 3, 3, 'F');
    const infoItems = [
      ['Fecha:',        dateStr],
      ['Autor:',        data.autor       || 'No especificado'],
      ['Institución:',  data.institucion || 'No especificada'],
      ['Ubicación:',    data.ubicacion   || 'No registrada'],
      ['Coordenadas:',  (data.latitud && data.longitud) ? `${data.latitud}, ${data.longitud}` : 'No registradas'],
      ['Ecosistema:',   data.ecosistema  || 'No especificado'],
    ];
    infoItems.forEach(([lbl,val],i) => {
      const y = cardY + 9 + i*10;
      doc.setFont('helvetica','bold'); doc.setFontSize(7); doc.setTextColor(...C.lg);
      doc.text(lbl, ML+5, y);
      doc.setFont('helvetica','normal'); doc.setFontSize(8.5); doc.setTextColor(...C.wh);
      doc.text(doc.splitTextToSize(val,CW-42)[0]||'—', ML+38, y);
    });

    // Stats row
    const statsY = H - 55;
    doc.setFillColor(28,61,44); doc.setDrawColor(74,124,94); doc.setLineWidth(0.4);
    doc.roundedRect(ML, statsY, CW, 24, 3, 3, 'FD');
    [[data.especies.length,'Especies'],[totalInd,'Individuos'],[allPhotos.length,'Fotografías']].forEach(([val,lbl],i)=>{
      const x = ML + 8 + i*(CW/3);
      doc.setFont('helvetica','normal'); doc.setFontSize(6.5); doc.setTextColor(...C.lg);
      doc.text(lbl.toUpperCase(), x, statsY+7);
      doc.setFont('helvetica','bold'); doc.setFontSize(16); doc.setTextColor(...C.am);
      doc.text(String(val), x, statsY+19);
    });

    // Footer
    doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(...C.gr);
    doc.text('Generado con AveSampler — Sistema de Registro de Muestreo de Aves', W/2, H-10, {align:'center'});

    // ══════════════════════════════════
    // PAGE 2 — GENERAL INFO
    // ══════════════════════════════════
    setP(35, 'Datos generales...');
    let y = addPage();

    y = secTitle('1. Información General', y);
    y = infoRow('Proyecto',    data.nombre_proyecto, y, false);
    y = infoRow('Fecha',       dateStr,              y, true);
    y = infoRow('Autor',       data.autor,           y, false);
    y = infoRow('Institución', data.institucion,     y, true);
    y += 4;

    y = secTitle('2. Sitio de Muestreo', y);
    y = infoRow('Ubicación',   data.ubicacion,  y, false);
    y = infoRow('Latitud',     data.latitud,    y, true);
    y = infoRow('Longitud',    data.longitud,   y, false);
    y = infoRow('Altitud',     data.altitud ? data.altitud+' m.s.n.m.' : '—', y, true);
    y = infoRow('Ecosistema',  data.ecosistema, y, false);
    y += 4;

    y = secTitle('3. Condiciones y Metodología', y);
    y = infoRow('Clima',       data.clima,       y, false);
    y = infoRow('Temperatura', data.temperatura ? data.temperatura+'°C' : '—', y, true);
    y = infoRow('Método',      data.metodo,      y, false);
    y = infoRow('Duración',    data.duracion ? data.duracion+' min' : '—', y, true);
    y = infoRow('Hora inicio', data.hora_inicio, y, false);
    y = infoRow('Hora fin',    data.hora_fin,    y, true);
    y = infoRow('Observador',  data.observador,  y, false);
    y += 4;

    if (data.notas_generales) {
      y = secTitle('Observaciones Generales', y);
      doc.setFont('helvetica','normal'); doc.setFontSize(8.5); doc.setTextColor(...C.tx);
      const notas = doc.splitTextToSize(data.notas_generales, CW-4);
      notas.forEach(line => { if(y>H-MB-8){y=addPage();} doc.text(line, ML+2, y); y+=5.5; });
    }

    // ══════════════════════════════════
    // PAGE 3 — SPECIES TABLE
    // ══════════════════════════════════
    setP(48, 'Tabla de especies...');
    y = addPage();
    y = secTitle('4. Registro de Especies', y);

    // Summary pills
    doc.setFillColor(...C.lg);
    doc.roundedRect(ML, y, CW, 16, 2, 2, 'F');
    [[data.especies.length,'Especies'],[totalInd,'Individuos'],[allPhotos.length,'Fotos']].forEach(([val,lbl],i)=>{
      const x = ML+6+i*(CW/3);
      doc.setFont('helvetica','normal'); doc.setFontSize(6.5); doc.setTextColor(...C.mg);
      doc.text(lbl.toUpperCase(), x, y+5.5);
      doc.setFont('helvetica','bold'); doc.setFontSize(13); doc.setTextColor(...C.dg);
      doc.text(String(val), x, y+13.5);
    });
    y += 22;

    if (data.especies.length) {
      doc.autoTable({
        startY: y, margin: {left:ML, right:MR},
        head: [['Especie','Familia','N','Comportamiento','Sexo/Edad','Notas']],
        body: data.especies.map(sp => [sp.nombre||'—', sp.familia||'—', sp.count||'1', sp.behavior||'—', sp.sex||'—', sp.notes||'—']),
        headStyles: { fillColor: C.dg, textColor: C.wh, fontStyle:'bold', fontSize:7.5, cellPadding:2.5 },
        bodyStyles: { fontSize:7.5, cellPadding:2, textColor:C.tx },
        alternateRowStyles: { fillColor: C.pa },
        columnStyles: {
          0:{cellWidth:34,fontStyle:'bold'}, 1:{cellWidth:28},
          2:{cellWidth:8,halign:'center'}, 3:{cellWidth:26}, 4:{cellWidth:22}, 5:{cellWidth:'auto'},
        },
        didDrawPage: () => {
          doc.setFillColor(...C.dg); doc.rect(0,0,W,13,'F');
          doc.setFont('helvetica','bold'); doc.setFontSize(7.5); doc.setTextColor(...C.wh);
          doc.text('AveSampler', ML, 8.5);
          doc.setFont('helvetica','normal'); doc.setTextColor(...C.lg);
          doc.text(`${data.nombre_proyecto}  ·  ${data.fecha}`, W-MR, 8.5, {align:'right'});
          doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(...C.gr);
          doc.text(`Página ${doc.internal.getCurrentPageInfo().pageNumber}`, W/2, H-7, {align:'center'});
        },
      });
    } else {
      doc.setFont('helvetica','italic'); doc.setFontSize(9); doc.setTextColor(...C.gr);
      doc.text('No se registraron especies.', ML+2, y+8);
    }

    // ══════════════════════════════════
    // PAGES — SPECIES WITH THEIR PHOTOS
    // ══════════════════════════════════
    const speciesWithPhotos = data.especies.filter(sp => sp.fotos?.length);
    if (speciesWithPhotos.length) {
      setP(58, 'Registros por especie...');
      y = addPage();
      y = secTitle('5. Fichas por Especie', y);
      y += 2;

      for (const sp of data.especies) {
        // Check space
        if (y + 40 > H - MB) { y = addPage(); y += 2; }

        // Species card header
        doc.setFillColor(...C.mg); doc.roundedRect(ML, y, CW, 22, 2, 2, 'F');
        doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(...C.wh);
        doc.text(sp.nombre||'Especie no identificada', ML+4, y+7);
        doc.setFont('helvetica','normal'); doc.setFontSize(7.5); doc.setTextColor(...C.lg);
        doc.text(sp.familia||'', ML+4, y+13);

        // Inline stats
        const stats = [`N: ${sp.count||1}`, sp.behavior||'', sp.sex||''].filter(Boolean).join('  ·  ');
        doc.setFontSize(7); doc.text(stats, W-MR-2, y+7, {align:'right'});
        if (sp.notes) {
          doc.setFont('helvetica','italic'); doc.setFontSize(7);
          const noteLine = doc.splitTextToSize(sp.notes, CW-8)[0];
          doc.text(noteLine, ML+4, y+19);
        }
        y += 27;

        // Species photos
        if (sp.fotos?.length) {
          for (let i=0; i<sp.fotos.length; i++) {
            const foto = sp.fotos[i];
            if (y + 72 > H - MB) { y = addPage(); y += 2; }
            try {
              const imgEl = new Image();
              await new Promise(res => { imgEl.onload = res; imgEl.onerror = res; imgEl.src = foto.dataUrl; });
              const ratio = imgEl.naturalWidth / (imgEl.naturalHeight||1);
              const maxW = Math.min(CW - 16, 100);
              const maxH = 58;
              let iW = maxW, iH = maxW/ratio;
              if (iH > maxH) { iH = maxH; iW = maxH * ratio; }
              const ix = ML + (CW - iW)/2;
              const fmt = foto.dataUrl.startsWith('data:image/png') ? 'PNG' : 'JPEG';
              doc.addImage(foto.dataUrl, fmt, ix, y, iW, iH);
              y += iH + 2;
            } catch(e) { /* skip bad image */ }

            doc.setFont('helvetica','italic'); doc.setFontSize(7.5); doc.setTextColor(...C.mg);
            const cap = `Fig. ${i+1}${foto.caption ? ': '+foto.caption : ''}`;
            const capLines = doc.splitTextToSize(cap, CW);
            capLines.forEach(l => { doc.text(l, W/2, y, {align:'center'}); y+=4; });
            y += 4;
          }
        }
        y += 4;
      }
    }

    // ══════════════════════════════════
    // GENERAL PHOTOS
    // ══════════════════════════════════
    if (data.fotos?.length) {
      setP(70, 'Fotos generales...');
      y = addPage();
      y = secTitle('6. Registro Fotográfico General', y);
      y += 4;

      for (let i=0; i<data.fotos.length; i++) {
        const foto = data.fotos[i];
        if (y + 72 > H - MB) { y = addPage(); y += 4; }
        try {
          const imgEl = new Image();
          await new Promise(res => { imgEl.onload = res; imgEl.onerror = res; imgEl.src = foto.dataUrl; });
          const ratio = imgEl.naturalWidth/(imgEl.naturalHeight||1);
          const maxW = CW - 8; const maxH = 65;
          let iW = maxW, iH = maxW/ratio;
          if (iH > maxH) { iH = maxH; iW = maxH*ratio; }
          const ix = ML + (CW - iW)/2;
          doc.addImage(foto.dataUrl, foto.dataUrl.startsWith('data:image/png')?'PNG':'JPEG', ix, y, iW, iH);
          y += iH + 2;
        } catch(e) {}
        doc.setFont('helvetica','italic'); doc.setFontSize(7.5); doc.setTextColor(...C.mg);
        const cap = `Figura ${i+1}${foto.caption ? ': '+foto.caption : ''}`;
        doc.splitTextToSize(cap, CW).forEach(l => { doc.text(l, W/2, y, {align:'center'}); y+=4; });
        y += 5;
      }
    }

    // ══════════════════════════════════
    // SIGNATURES PAGE
    // ══════════════════════════════════
    setP(77, 'Página de firmas...');
    if (y + 60 > H - MB) y = addPage();
    else y += 8;

    doc.setFillColor(...C.lg);
    doc.roundedRect(ML, y, CW, 20, 2, 2, 'F');
    doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(...C.dg);
    const closingTxt = `Reporte generado automáticamente por AveSampler el ${new Date().toLocaleDateString('es-CO')}. Registro de campo: ${dateStr} en ${data.ubicacion||'ubicación no registrada'}.`;
    doc.splitTextToSize(closingTxt, CW-6).forEach((l,i) => doc.text(l, ML+3, y+7+i*5));
    y += 28;

    const sigY = y + 18;
    [[data.observador||'Observador','Observador de campo'],[data.autor||'Investigador','Investigador principal']].forEach(([nm,rol],i)=>{
      const x = i===0 ? ML : ML+CW/2+5;
      doc.setDrawColor(...C.mg); doc.setLineWidth(0.35);
      doc.line(x, sigY, x+CW/2-10, sigY);
      doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor(...C.tx);
      doc.text(nm, x, sigY+5);
      doc.setFont('helvetica','italic'); doc.setFontSize(7); doc.setTextColor(...C.gr);
      doc.text(rol, x, sigY+10);
    });

    return doc;
  },

  generateReadme(data) {
    const base = `${data.nombre_proyecto.replace(/\s+/g,'_')}_${data.fecha}`;
    return `AveSampler — Instrucciones de compilación
==========================================
Proyecto : ${data.nombre_proyecto}
Fecha    : ${data.fecha}
Generado : ${new Date().toLocaleDateString('es-CO')}

ARCHIVOS EN ESTE PAQUETE
-------------------------
${base}.pdf           — Reporte completo (listo para usar)
${base}.tex           — Código fuente LaTeX (editable)
${base}_datos.json    — Datos del registro en JSON
imagenes/             — Fotografías del muestreo
README.txt            — Este archivo

COMPILAR EL .TEX A PDF
-----------------------
Opción 1 — Terminal (TeX Live / MiKTeX):
  pdflatex ${base}.tex
  pdflatex ${base}.tex  (segunda pasada para referencias)

Opción 2 — Overleaf (online, gratis):
  https://overleaf.com → Nuevo proyecto → Subir ZIP

NOTA: El PDF ya está incluido y listo para usar.
El .tex sirve para personalizar y volver a compilar.

AveSampler © ${new Date().getFullYear()}
`;
  },

  // ── NEW RECORD ─────────────────────────────────────

  newRecord() {
    App.closeDownloadModal();

    // Reset all state
    State.selectedTemplate = 'aves_estandar';
    State.generalPhotos    = [];
    State.speciesData      = {};
    State.speciesCount     = 0;
    State.currentFiles     = null;

    // Reset all form fields
    const clear = (id, val='') => { const el=document.getElementById(id); if(el) el.value=val; };
    clear('project-name'); clear('project-date', new Date().toISOString().split('T')[0]);
    clear('project-author'); clear('project-institution');
    clear('location'); clear('lat'); clear('lon'); clear('altitude');
    clear('ecosystem'); clear('weather'); clear('temperature');
    clear('method'); clear('duration'); clear('time-start'); clear('time-end');
    clear('observer'); clear('sampling-notes');

    // Reset template selection
    document.querySelectorAll('.template-card').forEach(c => c.classList.remove('selected'));
    const defaultCard = document.querySelector('[data-value="aves_estandar"]');
    if (defaultCard) defaultCard.classList.add('selected');

    // Clear species list
    document.getElementById('species-list').innerHTML = '';

    // Clear general photo grid
    App.renderPhotoGrid('general');

    // Add fresh first species
    App.addSpecies();

    // Reset generate button
    const btn = document.getElementById('btn-generate');
    if (btn) { btn.disabled = false; btn.style.opacity = '1'; }

    App.goTo('section-template');
  },

  // ── RECORDS PANEL METHODS ──────────────────────────

  // ── PWA ────────────────────────────────────────────

  async installPWA() {
    if (!State.deferredInstall) { App.toast('Usa "Agregar a inicio" en tu navegador', ''); return; }
    State.deferredInstall.prompt();
    const { outcome } = await State.deferredInstall.userChoice;
    if (outcome === 'accepted') { State.deferredInstall = null; document.getElementById('btn-install').style.display = 'none'; }
  },

  showIOSBanner() {
    document.getElementById('ios-install-banner').style.display = 'block';
  },

  closeIOSBanner() {
    document.getElementById('ios-install-banner').style.display = 'none';
    try { localStorage.setItem('ios_banner_dismissed','1'); } catch(e) {}
  },

  updateOnlineStatus() {
    const badge = document.getElementById('offline-badge');
    if (badge) badge.style.display = navigator.onLine ? 'none' : 'inline';
  },

  // ── MODALS ─────────────────────────────────────────

  openInstructions() {
    document.getElementById('modal-instructions').style.display = 'flex';
    document.body.style.overflow = 'hidden';
  },

  closeInstructions(event) {
    if (event && event.target !== event.currentTarget) return;
    document.getElementById('modal-instructions').style.display = 'none';
    document.body.style.overflow = '';
  },

  // ── DRAFT ──────────────────────────────────────────

  saveDraft() {
    try {
      const d = {
        template: State.selectedTemplate,
        projectName: document.getElementById('project-name')?.value||'',
        projectDate: document.getElementById('project-date')?.value||'',
        author: document.getElementById('project-author')?.value||'',
        institution: document.getElementById('project-institution')?.value||'',
        location: document.getElementById('location')?.value||'',
        lat: document.getElementById('lat')?.value||'',
        lon: document.getElementById('lon')?.value||'',
        altitude: document.getElementById('altitude')?.value||'',
        ecosystem: document.getElementById('ecosystem')?.value||'',
        weather: document.getElementById('weather')?.value||'',
        temperature: document.getElementById('temperature')?.value||'',
        method: document.getElementById('method')?.value||'',
        duration: document.getElementById('duration')?.value||'',
        timeStart: document.getElementById('time-start')?.value||'',
        timeEnd: document.getElementById('time-end')?.value||'',
        observer: document.getElementById('observer')?.value||'',
        notes: document.getElementById('sampling-notes')?.value||'',
      };
      localStorage.setItem('avesampler_draft', JSON.stringify(d));
    } catch(e) {}
  },

  loadDraft() {
    try {
      const raw = localStorage.getItem('avesampler_draft');
      if (!raw) return;
      const d = JSON.parse(raw);
      const set = (id,val) => { if(val){const el=document.getElementById(id);if(el)el.value=val;} };
      set('project-name',d.projectName); set('project-date',d.projectDate);
      set('project-author',d.author); set('project-institution',d.institution);
      set('location',d.location); set('lat',d.lat); set('lon',d.lon); set('altitude',d.altitude);
      set('ecosystem',d.ecosystem); set('weather',d.weather); set('temperature',d.temperature);
      set('method',d.method); set('duration',d.duration);
      set('time-start',d.timeStart); set('time-end',d.timeEnd);
      set('observer',d.observer); set('sampling-notes',d.notes);
      if (d.template) {
        State.selectedTemplate = d.template;
        document.querySelectorAll('.template-card').forEach(c=>c.classList.remove('selected'));
        const card = document.querySelector(`[data-value="${d.template}"]`);
        if (card) card.classList.add('selected');
      }
    } catch(e) {}
  },

  // ── UTILS ──────────────────────────────────────────

  delay(ms) { return new Promise(r => setTimeout(r, ms)); },

  toast(msg, type = '') {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'toast' + (type ? ' ' + type : '');
    t.style.display = 'block';
    clearTimeout(App._toastTimer);
    App._toastTimer = setTimeout(() => { t.style.display = 'none'; }, 3000);
  },

  escapeHtml(str) {
    return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  },
};
