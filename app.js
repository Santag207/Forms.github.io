/* ═══════════════════════════════════════════════════════════
   AveSampler — app.js
   Lógica principal: navegación, formularios, fotos,
   generación de LaTeX y empaquetado ZIP
   ═══════════════════════════════════════════════════════════ */

'use strict';

// ── STATE ───────────────────────────────────────────────────
const State = {
  currentScreen: 'screen-home',
  currentSection: null,
  selectedTemplate: 'aves_estandar',
  photos: [],           // { file: File, dataUrl: string, caption: string, name: string }
  speciesCount: 0,
  pendingPhotoIndex: null,
  deferredInstall: null,
};

const SECTIONS = ['section-template', 'section-sampling', 'section-report-preview', 'section-report'];
const SECTION_TITLES = {
  'section-template': 'Plantilla',
  'section-sampling': 'Datos de muestreo',
  'section-photos':   'Fotografías',
  'section-report':   'Generar reporte',
};
const SECTION_STEPS = {
  'section-template': 1,
  'section-sampling': 2,
  'section-photos':   3,
  'section-report':   4,
};

// ── INIT ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});

const App = {

  init() {
    // Set today's date as default
    const dateInput = document.getElementById('project-date');
    if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];

    // Add first species row
    App.addSpecies();

    // Offline detection
    App.updateOnlineStatus();
    window.addEventListener('online',  App.updateOnlineStatus);
    window.addEventListener('offline', App.updateOnlineStatus);

    // PWA install prompt
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      State.deferredInstall = e;
      const btn = document.getElementById('btn-install');
      if (btn) btn.style.display = 'inline-flex';
    });

    // Load saved draft
    App.loadDraft();

    // Register service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('service-worker.js').catch(() => {});
    }
  },

  // ── NAVIGATION ──────────────────────────────────────────

  goTo(target) {
    // Hide all screens
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));

    if (target === 'screen-home') {
      document.getElementById('screen-home').classList.add('active');
      State.currentSection = null;
    } else {
      // Show app shell
      document.getElementById('screen-app').classList.add('active');
      // Show correct section
      document.querySelectorAll('.form-section').forEach(s => s.classList.remove('active'));
      const sec = document.getElementById(target);
      if (sec) sec.classList.add('active');
      State.currentSection = target;
      App.updateNavUI(target);
      window.scrollTo(0, 0);
    }
  },

  back() {
    const prev = {
      'section-template': 'screen-home',
      'section-sampling': 'section-template',
      'section-photos':   'section-sampling',
      'section-report':   'section-photos',
    };
    const dest = prev[State.currentSection] || 'screen-home';
    App.goTo(dest);
  },

  nextSection(target) {
    if (!App.validateSection(State.currentSection)) return;
    App.saveDraft();
    App.goTo(target);
    if (target === 'section-report') App.buildReportSummary();
  },

  prevSection(target) {
    App.goTo(target);
  },

  updateNavUI(sectionId) {
    document.getElementById('nav-title').textContent = SECTION_TITLES[sectionId] || '';
    const step = SECTION_STEPS[sectionId] || 1;
    document.getElementById('nav-step').textContent = `${step} / 4`;
    document.getElementById('progress-bar').style.width = `${(step / 4) * 100}%`;

    // Step dots
    document.querySelectorAll('.step-dot').forEach(dot => {
      const s = parseInt(dot.dataset.step);
      dot.classList.remove('active', 'done');
      if (s === step) dot.classList.add('active');
      else if (s < step) dot.classList.add('done');
    });
  },

  // ── VALIDATION ──────────────────────────────────────────

  validateSection(sectionId) {
    if (sectionId === 'section-template') {
      const name = document.getElementById('project-name').value.trim();
      const date = document.getElementById('project-date').value;
      if (!name) { App.toast('Ingresa el nombre del proyecto', 'error'); return false; }
      if (!date) { App.toast('Selecciona la fecha del muestreo', 'error'); return false; }
    }
    if (sectionId === 'section-sampling') {
      const loc = document.getElementById('location').value.trim();
      if (!loc) { App.toast('Ingresa la ubicación del muestreo', 'error'); return false; }
    }
    return true;
  },

  // ── TEMPLATE SELECTION ──────────────────────────────────

  selectTemplate(card) {
    document.querySelectorAll('.template-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    State.selectedTemplate = card.dataset.value;
  },

  // ── SPECIES ─────────────────────────────────────────────

  addSpecies() {
    State.speciesCount++;
    const n = State.speciesCount;
    const list = document.getElementById('species-list');
    const entry = document.createElement('div');
    entry.className = 'species-entry';
    entry.id = `species-${n}`;
    entry.innerHTML = `
      <div class="species-entry-header">
        <span class="species-num">Especie #${n}</span>
        <button class="species-remove" onclick="App.removeSpecies(${n})" title="Eliminar">&times; Eliminar</button>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label required" for="sp-name-${n}">Nombre científico / común</label>
          <input type="text" id="sp-name-${n}" class="form-input" placeholder="Ej: Turdus fuscater / Mirla negra" />
        </div>
        <div class="form-group">
          <label class="form-label" for="sp-count-${n}">Cantidad observada</label>
          <input type="number" id="sp-count-${n}" class="form-input" min="1" value="1" />
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="sp-behavior-${n}">Comportamiento</label>
          <select id="sp-behavior-${n}" class="form-input">
            <option value="">Seleccionar...</option>
            <option>Canto / Vocalización</option>
            <option>Forrajeo / Alimentación</option>
            <option>Vuelo</option>
            <option>Percha</option>
            <option>Anidación / Cortejo</option>
            <option>Descanso</option>
            <option>Acicalamiento</option>
            <option>Otro</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="sp-sex-${n}">Sexo / Edad</label>
          <select id="sp-sex-${n}" class="form-input">
            <option value="">No determinado</option>
            <option>Macho adulto</option>
            <option>Hembra adulta</option>
            <option>Juvenil</option>
            <option>Inmaduro</option>
            <option>Grupo mixto</option>
          </select>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label" for="sp-notes-${n}">Notas adicionales</label>
        <input type="text" id="sp-notes-${n}" class="form-input" placeholder="Observaciones específicas sobre este registro..." />
      </div>
    `;
    list.appendChild(entry);
    entry.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  },

  removeSpecies(n) {
    const el = document.getElementById(`species-${n}`);
    if (el) el.remove();
  },

  getSpeciesData() {
    const entries = document.querySelectorAll('.species-entry');
    return Array.from(entries).map(entry => {
      const id = entry.id.replace('species-', '');
      return {
        name:     (document.getElementById(`sp-name-${id}`)?.value || '').trim(),
        count:    document.getElementById(`sp-count-${id}`)?.value || '1',
        behavior: document.getElementById(`sp-behavior-${id}`)?.value || '',
        sex:      document.getElementById(`sp-sex-${id}`)?.value || '',
        notes:    (document.getElementById(`sp-notes-${id}`)?.value || '').trim(),
      };
    }).filter(s => s.name);
  },

  // ── GPS ─────────────────────────────────────────────────

  getGPS() {
    if (!navigator.geolocation) {
      App.toast('GPS no disponible en este dispositivo', 'error');
      return;
    }
    App.toast('Obteniendo ubicación...');
    navigator.geolocation.getCurrentPosition(
      pos => {
        document.getElementById('lat').value = pos.coords.latitude.toFixed(6);
        document.getElementById('lon').value = pos.coords.longitude.toFixed(6);
        if (pos.coords.altitude) {
          document.getElementById('altitude').value = Math.round(pos.coords.altitude);
        }
        App.toast('📍 Coordenadas obtenidas', 'success');
      },
      () => App.toast('No se pudo obtener la ubicación', 'error'),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  },

  // ── PHOTOS ──────────────────────────────────────────────

  openCamera() {
    document.getElementById('camera-input').click();
  },

  handlePhotoUpload(event) {
    const files = Array.from(event.target.files);
    if (!files.length) return;

    const remaining = 10 - State.photos.length;
    if (remaining <= 0) {
      App.toast('Máximo 10 fotografías permitidas', 'error');
      return;
    }

    const toProcess = files.slice(0, remaining);
    let processed = 0;

    toProcess.forEach((file, idx) => {
      if (!file.type.match(/image\/(jpeg|png|jpg)/)) {
        App.toast(`${file.name}: formato no soportado`, 'error');
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        const photoData = {
          file,
          dataUrl: e.target.result,
          caption: '',
          name: `imagen_${State.photos.length + 1}.${file.name.split('.').pop()}`,
        };
        State.photos.push(photoData);
        App.renderPhotoGrid();
        processed++;
        if (processed === 1) {
          // Open caption modal for first photo
          State.pendingPhotoIndex = State.photos.length - 1;
          App.openCaptionModal();
        }
      };
      reader.readAsDataURL(file);
    });

    // Reset input
    event.target.value = '';
  },

  renderPhotoGrid() {
    const grid = document.getElementById('photo-grid');
    const empty = document.getElementById('photo-empty');
    const count = document.getElementById('photo-count');

    // Remove existing thumbs
    grid.querySelectorAll('.photo-thumb').forEach(t => t.remove());

    if (State.photos.length === 0) {
      if (empty) empty.style.display = 'flex';
      if (count) count.style.display = 'none';
      return;
    }

    if (empty) empty.style.display = 'none';

    State.photos.forEach((photo, idx) => {
      const thumb = document.createElement('div');
      thumb.className = 'photo-thumb';
      thumb.innerHTML = `
        <span class="photo-thumb-num">${idx + 1}</span>
        <img src="${photo.dataUrl}" alt="Foto ${idx + 1}" loading="lazy" />
        <button class="photo-thumb-remove" onclick="App.removePhoto(${idx})" title="Eliminar">&times;</button>
        ${photo.caption ? `<div class="photo-thumb-caption">${App.escapeHtml(photo.caption)}</div>` : ''}
      `;
      thumb.querySelector('img').addEventListener('click', () => {
        State.pendingPhotoIndex = idx;
        document.getElementById('caption-input').value = photo.caption || '';
        App.openCaptionModal();
      });
      grid.appendChild(thumb);
    });

    if (count) {
      count.style.display = 'block';
      count.textContent = `${State.photos.length} foto${State.photos.length !== 1 ? 's' : ''} agregada${State.photos.length !== 1 ? 's' : ''}`;
    }

    // Update tex filename preview
    App.updateTexFilename();
  },

  removePhoto(idx) {
    State.photos.splice(idx, 1);
    // Rename remaining
    State.photos.forEach((p, i) => {
      p.name = `imagen_${i + 1}.${p.file.name.split('.').pop()}`;
    });
    App.renderPhotoGrid();
  },

  openCaptionModal() {
    const modal = document.getElementById('caption-modal');
    if (modal) {
      modal.style.display = 'flex';
      document.getElementById('caption-input').focus();
    }
  },

  closeCaptionModal(event) {
    if (event && event.target !== event.currentTarget) return;
    const modal = document.getElementById('caption-modal');
    if (modal) modal.style.display = 'none';
    State.pendingPhotoIndex = null;
  },

  saveCaption() {
    if (State.pendingPhotoIndex !== null && State.photos[State.pendingPhotoIndex]) {
      State.photos[State.pendingPhotoIndex].caption = document.getElementById('caption-input').value.trim();
      App.renderPhotoGrid();
    }
    App.closeCaptionModal();
  },

  // ── REPORT SUMMARY ──────────────────────────────────────

  buildReportSummary() {
    const name = document.getElementById('project-name').value.trim();
    const date = document.getElementById('project-date').value;
    const loc  = document.getElementById('location').value.trim();
    const method = document.getElementById('method').value;
    const species = App.getSpeciesData();

    const templateLabels = {
      'aves_estandar':      'Muestreo estándar',
      'biodiversidad':      'Monitoreo de biodiversidad',
      'registro_extendido': 'Registro de campo extendido',
    };

    const summary = document.getElementById('report-summary');
    summary.innerHTML = `
      <h3>📋 Resumen del registro</h3>
      <div class="summary-grid">
        <div class="summary-item"><span>Proyecto</span><span>${App.escapeHtml(name)}</span></div>
        <div class="summary-item"><span>Fecha</span><span>${date}</span></div>
        <div class="summary-item"><span>Plantilla</span><span>${templateLabels[State.selectedTemplate] || State.selectedTemplate}</span></div>
        <div class="summary-item"><span>Ubicación</span><span>${App.escapeHtml(loc) || '—'}</span></div>
        <div class="summary-item"><span>Método</span><span>${method || '—'}</span></div>
        <div class="summary-item"><span>Especies</span><span>${species.length} registrada${species.length !== 1 ? 's' : ''}</span></div>
        <div class="summary-item"><span>Fotografías</span><span>${State.photos.length} adjunta${State.photos.length !== 1 ? 's' : ''}</span></div>
      </div>
    `;

    App.updateFileNames();
  },

  updateFileNames() {
    const name = (document.getElementById('project-name')?.value || 'Proyecto').trim().replace(/\s+/g, '_');
    const date = document.getElementById('project-date')?.value || new Date().toISOString().split('T')[0];
    const base = `${name}_${date}`;
    const pdfEl = document.getElementById('pdf-filename');
    const texEl = document.getElementById('tex-filename');
    if (pdfEl) pdfEl.textContent = `${base}.pdf`;
    if (texEl) texEl.textContent = `${base}.tex`;

    const photosLine = document.getElementById('photos-line');
    const photosLabel = document.getElementById('photos-count-label');
    if (photosLine && photosLabel) {
      const n = State.photos.length;
      if (n > 0) {
        photosLine.style.display = '';
        photosLabel.textContent = `${n} fotografía${n !== 1 ? 's' : ''} (imagen_1.jpg … imagen_${n}.jpg)`;
      } else {
        photosLine.style.display = 'none';
      }
    }
  },

  // ── COLLECT FORM DATA ───────────────────────────────────

  collectData() {
    return {
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
      fotos:       State.photos,
    };
  },

  // ── TEMPLATE LOADING ────────────────────────────────────

  async loadTemplate(templateId) {
    if (TemplateCache[templateId]) return TemplateCache[templateId];
    const url = `templates/${templateId}.tex`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      TemplateCache[templateId] = text;
      return text;
    } catch (err) {
      throw new Error(
        `No se pudo cargar la plantilla "${templateId}.tex".\n` +
        `Verifica que existe en la carpeta templates/.`
      );
    }
  },

  // ── LATEX GENERATION ────────────────────────────────────

  generateLatex(data, templateContent) {
    let tex = templateContent;

    // Format date nicely
    const dateObj = data.fecha ? new Date(data.fecha + 'T12:00:00') : new Date();
    const dateFormatted = dateObj.toLocaleDateString('es-CO', { year:'numeric', month:'long', day:'numeric' });

    // Species table rows
    const speciesRows = data.especies.length > 0
      ? data.especies.map(sp =>
          `  ${App.latexEscape(sp.name)} & ${sp.count} & ${App.latexEscape(sp.behavior)} & ${App.latexEscape(sp.sex)} & ${App.latexEscape(sp.notes)} \\\\`
        ).join('\n  \\hline\n')
      : '  \\textit{Sin registros} & — & — & — & — \\\\';

    // Photo inclusions
    const photoIncludes = data.fotos.length > 0
      ? data.fotos.map((p, i) =>
          `\\begin{figure}[h!]\n\\centering\n\\includegraphics[width=0.8\\textwidth]{imagenes/${p.name}}\n\\caption{${App.latexEscape(p.caption || `Fotografía ${i+1}`)}}\n\\label{fig:foto${i+1}}\n\\end{figure}`
        ).join('\n\n')
      : '% No se adjuntaron fotografías';

    const coords = (data.latitud && data.longitud)
      ? `${data.latitud}°N, ${data.longitud}°W`
      : 'No registradas';

    // Replace variables
    const vars = {
      '{{nombre_proyecto}}':  App.latexEscape(data.nombre_proyecto),
      '{{fecha}}':            App.latexEscape(dateFormatted),
      '{{fecha_raw}}':        data.fecha,
      '{{autor}}':            App.latexEscape(data.autor || 'No especificado'),
      '{{institucion}}':      App.latexEscape(data.institucion || 'No especificada'),
      '{{ubicacion}}':        App.latexEscape(data.ubicacion),
      '{{coordenadas}}':      coords,
      '{{altitud}}':          data.altitud ? `${data.altitud} m.s.n.m.` : 'No registrada',
      '{{ecosistema}}':       App.latexEscape(data.ecosistema || 'No especificado'),
      '{{clima}}':            App.latexEscape(data.clima || 'No registrado'),
      '{{temperatura}}':      data.temperatura ? `${data.temperatura}°C` : 'No registrada',
      '{{metodo}}':           App.latexEscape(data.metodo || 'No especificado'),
      '{{duracion}}':         data.duracion ? `${data.duracion} minutos` : 'No registrada',
      '{{hora_inicio}}':      data.hora_inicio || 'No registrada',
      '{{hora_fin}}':         data.hora_fin || 'No registrada',
      '{{observador}}':       App.latexEscape(data.observador || 'No especificado'),
      '{{notas_generales}}':  App.latexEscape(data.notas_generales || 'Sin observaciones adicionales.'),
      '{{total_especies}}':   String(data.especies.length),
      '{{total_individuos}}': String(data.especies.reduce((s, e) => s + parseInt(e.count || 0), 0)),
      '{{total_fotos}}':      String(data.fotos.length),
      '{{tabla_especies}}':   speciesRows,
      '{{fotografias}}':      photoIncludes,
    };

    Object.entries(vars).forEach(([k, v]) => {
      tex = tex.split(k).join(v);
    });

    return tex;
  },

  latexEscape(str) {
    if (!str) return '';
    return String(str)
      .replace(/\\/g, '\\textbackslash{}')
      .replace(/&/g, '\\&')
      .replace(/%/g, '\\%')
      .replace(/\$/g, '\\$')
      .replace(/#/g, '\\#')
      .replace(/_/g, '\\_')
      .replace(/\{/g, '\\{')
      .replace(/\}/g, '\\}')
      .replace(/~/g, '\\textasciitilde{}')
      .replace(/\^/g, '\\textasciicircum{}');
  },

  // ── README GENERATION ───────────────────────────────────

  generateReadme(data) {
    const fname = `${data.nombre_proyecto}_${data.fecha}`;
    return `AveSampler — Instrucciones de compilación
==========================================

Proyecto: ${data.nombre_proyecto}
Fecha: ${data.fecha}
Generado por: AveSampler PWA

ARCHIVOS EN ESTE PAQUETE
-------------------------
${fname}.tex     - Código fuente LaTeX del reporte
imagenes/        - Carpeta con ${data.fotos.length} fotografía(s)
README.txt       - Este archivo

CÓMO COMPILAR EL PDF
---------------------

OPCIÓN 1 — Terminal (requiere TeX Live / MiKTeX):
  pdflatex ${fname}.tex
  pdflatex ${fname}.tex   (segunda vez para referencias)

OPCIÓN 2 — Overleaf (online, gratuito):
  1. Ir a https://overleaf.com
  2. Crear nuevo proyecto > Subir archivo ZIP
  3. Seleccionar este ZIP completo
  4. Presionar "Compilar"

OPCIÓN 3 — TeXworks / TeXStudio:
  Abrir ${fname}.tex y compilar con pdfLaTeX

REQUISITOS LaTeX
-----------------
  - pdflatex
  - Paquetes: inputenc, fontenc, geometry, graphicx,
    booktabs, longtable, xcolor, hyperref,
    fancyhdr, babel (spanish)

NOTAS
------
  - Las imágenes deben estar en la subcarpeta "imagenes/"
  - Compilar dos veces para tabla de contenidos correcta
  - Si hay caracteres especiales, usar compilación UTF-8

AveSampler © ${new Date().getFullYear()} — Sistema de Registro de Muestreo de Aves
`;
  },

  // ── MAIN GENERATE ───────────────────────────────────────

  async generateReport() {
    const btn       = document.getElementById('btn-generate');
    const progressEl  = document.getElementById('gen-progress');
    const progressFill= document.getElementById('gen-progress-fill');
    const progressMsg = document.getElementById('gen-progress-msg');
    const successEl   = document.getElementById('gen-success');
    const footerEl    = document.getElementById('report-footer');
    const infoBox     = document.getElementById('generate-box-info');

    if (!window.jspdf) {
      App.toast('jsPDF no está disponible. Verifica la conexión a internet.', 'error');
      return;
    }

    const data = App.collectData();
    if (!data.nombre_proyecto || !data.fecha) {
      App.toast('Completa el nombre del proyecto y la fecha', 'error');
      return;
    }

    const base = `${data.nombre_proyecto.replace(/\s+/g,'_')}_${data.fecha}`;

    btn.disabled = true;
    btn.style.opacity = '0.6';
    progressEl.style.display = 'block';
    successEl.style.display = 'none';

    const setP = (pct, msg) => {
      progressFill.style.width = pct + '%';
      progressMsg.textContent = msg;
    };

    const downloadedFiles = [];

    try {
      // ── 1. Load LaTeX template ──────────────────────────
      setP(5, `Cargando plantilla ${data.template}.tex...`);
      await App.delay(150);
      let templateContent;
      try {
        templateContent = await App.loadTemplate(data.template);
      } catch (e) {
        App.toast(e.message, 'error');
        btn.disabled = false; btn.style.opacity = '1';
        progressEl.style.display = 'none';
        return;
      }

      // ── 2. Generate .tex file ───────────────────────────
      setP(15, 'Generando archivo .tex...');
      await App.delay(150);
      const texContent = App.generateLatex(data, templateContent);
      const texBlob = new Blob([texContent], { type: 'text/plain;charset=utf-8' });
      const texName = `${base}.tex`;

      // ── 3. Build PDF with jsPDF ─────────────────────────
      setP(25, 'Construyendo PDF...');
      await App.delay(200);
      const pdfDoc = await App.buildPDF(data, setP);
      const pdfBlob = pdfDoc.output('blob');
      const pdfName = `${base}.pdf`;

      // ── 4. Download PDF  ────────────────────────────────
      setP(82, 'Descargando PDF...');
      await App.delay(200);
      App.downloadBlob(pdfBlob, pdfName);
      downloadedFiles.push({ name: pdfName, type: 'pdf', blob: pdfBlob });
      await App.delay(400);

      // ── 5. Download .tex ────────────────────────────────
      setP(88, 'Descargando archivo .tex...');
      await App.delay(200);
      App.downloadBlob(texBlob, texName);
      downloadedFiles.push({ name: texName, type: 'tex', blob: texBlob });
      await App.delay(400);

      // ── 6. Download photos individually ─────────────────
      if (data.fotos.length > 0) {
        for (let i = 0; i < data.fotos.length; i++) {
          const photo = data.fotos[i];
          const pct = 88 + Math.round(((i + 1) / data.fotos.length) * 10);
          setP(pct, `Descargando imagen ${i + 1} de ${data.fotos.length}...`);
          await App.delay(180);
          // Convert dataUrl back to blob
          const res = await fetch(photo.dataUrl);
          const imgBlob = await res.blob();
          App.downloadBlob(imgBlob, photo.name);
          downloadedFiles.push({ name: photo.name, type: 'img', blob: imgBlob });
          await App.delay(250);
        }
      }

      setP(100, '¡Listo!');
      await App.delay(400);

      App.clearDraft();

      // ── 7. Show success ─────────────────────────────────
      progressEl.style.display = 'none';
      btn.style.display = 'none';
      if (infoBox) infoBox.style.display = 'none';
      footerEl.style.display = 'none';

      // Build file list in success block
      const listEl = document.getElementById('downloaded-files-list');
      listEl.innerHTML = downloadedFiles.map(f => `
        <div class="dl-file-row">
          <span class="file-badge ${f.type}">${f.type.toUpperCase()}</span>
          <span class="dl-file-name">${f.name}</span>
          <button class="dl-again-btn" onclick="App.reDownload('${f.name}')">
            <svg viewBox="0 0 20 20" fill="none"><path d="M10 3v10M6 9l4 4 4-4M4 15h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
      `).join('');

      // Store blobs for re-download
      State.lastDownloadedFiles = downloadedFiles;

      successEl.style.display = 'block';

    } catch (err) {
      console.error('Error generando reporte:', err);
      App.toast('Error: ' + err.message, 'error');
      btn.disabled = false; btn.style.opacity = '1';
      progressEl.style.display = 'none';
    }
  },

  reDownload(name) {
    const f = (State.lastDownloadedFiles || []).find(x => x.name === name);
    if (f) App.downloadBlob(f.blob, f.name);
  },

  // ── PDF BUILDER ─────────────────────────────────────────

  async buildPDF(data, setP) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const W = 210, H = 297;
    const ML = 25, MR = 20, MT = 25, MB = 20;
    const CW = W - ML - MR; // content width = 165mm

    // ── Colors ──────────────────────────────────────────
    const C = {
      darkGreen:  [28,  61,  44],
      midGreen:   [45,  92,  64],
      lightGreen: [200, 221, 210],
      amber:      [200, 120, 10],
      parchment:  [246, 241, 232],
      white:      [255, 255, 255],
      gray:       [120, 148, 134],
      textDark:   [26,  42,  32],
    };

    const dateObj = data.fecha ? new Date(data.fecha + 'T12:00:00') : new Date();
    const dateStr = dateObj.toLocaleDateString('es-CO', { year:'numeric', month:'long', day:'numeric' });
    const templateLabels = {
      'aves_estandar':      'Muestreo estándar',
      'biodiversidad':      'Monitoreo de biodiversidad',
      'registro_extendido': 'Registro de campo extendido',
    };

    // ╔══════════════════════════════════╗
    // ║  PAGE 1 — COVER                  ║
    // ╚══════════════════════════════════╝
    setP(30, 'Generando portada...');
    await App.delay(80);

    // Full dark green background
    doc.setFillColor(...C.darkGreen);
    doc.rect(0, 0, W, H, 'F');

    // Top accent bar
    doc.setFillColor(...C.midGreen);
    doc.rect(0, 0, W, 8, 'F');

    // Amber rule
    doc.setFillColor(...C.amber);
    doc.rect(ML, 55, CW, 0.8, 'F');

    // Template label
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...C.lightGreen);
    doc.text((templateLabels[data.template] || data.template).toUpperCase(), ML, 50, { charSpace: 1.5 });

    // Project title
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(28);
    doc.setTextColor(...C.white);
    const titleLines = doc.splitTextToSize(data.nombre_proyecto || 'Sin título', CW);
    doc.text(titleLines, ML, 70);
    const titleH = titleLines.length * 10;

    // Subtitle
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(13);
    doc.setTextColor(...C.lightGreen);
    doc.text('Registro de Avifauna en Campo', ML, 72 + titleH);

    // Info block
    const infoY = 100 + titleH;
    doc.setFillColor(...C.midGreen);
    doc.roundedRect(ML, infoY, CW, 64, 3, 3, 'F');

    const infoItems = [
      ['Fecha',        dateStr],
      ['Autor',        data.autor        || 'No especificado'],
      ['Institución',  data.institucion  || 'No especificada'],
      ['Ubicación',    data.ubicacion    || 'No registrada'],
      ['Coordenadas',  (data.latitud && data.longitud) ? `${data.latitud}, ${data.longitud}` : 'No registradas'],
    ];

    infoItems.forEach(([label, val], i) => {
      const y = infoY + 10 + i * 11;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(...C.lightGreen);
      doc.text(label.toUpperCase() + ':', ML + 6, y);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(...C.white);
      const valStr = doc.splitTextToSize(String(val), CW - 50);
      doc.text(valStr[0], ML + 40, y);
    });

    // AveSampler watermark bottom
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...C.gray);
    doc.text('Generado con AveSampler — Sistema de Registro de Muestreo de Aves', W/2, H - 12, { align: 'center' });

    // ── Helper: add page with header/footer ──────────────
    const addPage = (title) => {
      doc.addPage();
      // Header bar
      doc.setFillColor(...C.darkGreen);
      doc.rect(0, 0, W, 14, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(...C.white);
      doc.text('AveSampler', ML, 9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...C.lightGreen);
      doc.text(`${data.nombre_proyecto}  ·  ${data.fecha}`, W - MR, 9, { align: 'right' });
      // Footer
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(...C.gray);
      doc.text(`Página ${doc.internal.getCurrentPageInfo().pageNumber}`, W/2, H - 8, { align: 'center' });
      doc.text('AveSampler © ' + new Date().getFullYear(), MR, H - 8);
      return 22; // return starting Y
    };

    // ── Helper: section title ────────────────────────────
    const sectionTitle = (text, y) => {
      doc.setFillColor(...C.darkGreen);
      doc.rect(ML, y, CW, 8, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(...C.white);
      doc.text(text.toUpperCase(), ML + 4, y + 5.5);
      return y + 14;
    };

    // ── Helper: info row ─────────────────────────────────
    const infoRow = (label, value, y, even) => {
      if (even) { doc.setFillColor(...C.parchment); doc.rect(ML, y - 4, CW, 7, 'F'); }
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(...C.midGreen);
      doc.text(label, ML + 2, y);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...C.textDark);
      const lines = doc.splitTextToSize(String(value || '—'), CW - 55);
      doc.text(lines[0], ML + 50, y);
      return y + 7;
    };

    // ╔══════════════════════════════════╗
    // ║  PAGE 2 — GENERAL INFO           ║
    // ╚══════════════════════════════════╝
    setP(38, 'Generando datos generales...');
    await App.delay(80);
    let y = addPage();

    y = sectionTitle('1. Información General', y);
    y = infoRow('Proyecto',     data.nombre_proyecto, y, false);
    y = infoRow('Fecha',        dateStr,              y, true);
    y = infoRow('Autor',        data.autor,           y, false);
    y = infoRow('Institución',  data.institucion,     y, true);
    y += 6;

    y = sectionTitle('2. Sitio de Muestreo', y);
    y = infoRow('Ubicación',    data.ubicacion,  y, false);
    y = infoRow('Latitud',      data.latitud,    y, true);
    y = infoRow('Longitud',     data.longitud,   y, false);
    y = infoRow('Altitud',      data.altitud ? data.altitud + ' m.s.n.m.' : '—', y, true);
    y = infoRow('Ecosistema',   data.ecosistema, y, false);
    y += 6;

    y = sectionTitle('3. Condiciones Climáticas', y);
    y = infoRow('Clima',        data.clima,       y, false);
    y = infoRow('Temperatura',  data.temperatura ? data.temperatura + ' °C' : '—', y, true);
    y += 6;

    y = sectionTitle('4. Metodología', y);
    y = infoRow('Método',       data.metodo,    y, false);
    y = infoRow('Duración',     data.duracion   ? data.duracion + ' min' : '—', y, true);
    y = infoRow('Hora inicio',  data.hora_inicio, y, false);
    y = infoRow('Hora fin',     data.hora_fin,    y, true);
    y = infoRow('Observador',   data.observador,  y, false);
    y += 6;

    if (data.notas_generales) {
      y = sectionTitle('Observaciones Generales', y);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(...C.textDark);
      const notaLines = doc.splitTextToSize(data.notas_generales, CW - 4);
      notaLines.forEach(line => {
        if (y > H - MB - 10) { y = addPage(); }
        doc.text(line, ML + 2, y);
        y += 5.5;
      });
    }

    // ╔══════════════════════════════════╗
    // ║  PAGE 3 — SPECIES TABLE          ║
    // ╚══════════════════════════════════╝
    setP(50, 'Generando tabla de especies...');
    await App.delay(80);
    y = addPage();
    y = sectionTitle('5. Registro de Especies', y);

    // Summary row
    const totalInd = data.especies.reduce((s,e) => s + parseInt(e.count || 0), 0);
    doc.setFillColor(...C.lightGreen);
    doc.roundedRect(ML, y, CW, 18, 2, 2, 'F');
    const cols3 = [
      ['Especies registradas', String(data.especies.length)],
      ['Total individuos',     String(totalInd)],
      ['Fotografías',          String(data.fotos.length)],
    ];
    cols3.forEach(([lbl, val], i) => {
      const x = ML + 8 + i * (CW / 3);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(...C.midGreen);
      doc.text(lbl.toUpperCase(), x, y + 6);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14);
      doc.setTextColor(...C.darkGreen);
      doc.text(val, x, y + 15);
    });
    y += 24;

    // Species autotable
    if (data.especies.length > 0) {
      doc.autoTable({
        startY: y,
        margin: { left: ML, right: MR },
        head: [['Especie / Taxón', 'N', 'Comportamiento', 'Sexo/Edad', 'Notas']],
        body: data.especies.map(sp => [sp.name, sp.count, sp.behavior || '—', sp.sex || '—', sp.notes || '—']),
        headStyles: {
          fillColor: C.darkGreen,
          textColor: C.white,
          fontStyle: 'bold',
          fontSize: 8,
          cellPadding: 3,
        },
        bodyStyles: { fontSize: 8, cellPadding: 2.5, textColor: C.textDark },
        alternateRowStyles: { fillColor: C.parchment },
        columnStyles: {
          0: { cellWidth: 48, fontStyle: 'bold' },
          1: { cellWidth: 10, halign: 'center' },
          2: { cellWidth: 30 },
          3: { cellWidth: 28 },
          4: { cellWidth: 'auto' },
        },
        didDrawPage: () => {
          // Redraw header/footer on each table page
          doc.setFillColor(...C.darkGreen);
          doc.rect(0, 0, W, 14, 'F');
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(8);
          doc.setTextColor(...C.white);
          doc.text('AveSampler', ML, 9);
          doc.setFont('helvetica','normal');
          doc.setTextColor(...C.lightGreen);
          doc.text(`${data.nombre_proyecto}  ·  ${data.fecha}`, W - MR, 9, { align: 'right' });
          doc.setFont('helvetica','normal');
          doc.setFontSize(7.5);
          doc.setTextColor(...C.gray);
          doc.text(`Página ${doc.internal.getCurrentPageInfo().pageNumber}`, W/2, H-8, { align:'center' });
        },
      });
    } else {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(9);
      doc.setTextColor(...C.gray);
      doc.text('No se registraron especies en este muestreo.', ML + 2, y + 8);
    }

    // ╔══════════════════════════════════╗
    // ║  PAGES N+ — PHOTOS               ║
    // ╚══════════════════════════════════╝
    if (data.fotos.length > 0) {
      setP(65, 'Insertando fotografías en el PDF...');
      await App.delay(80);

      y = addPage();
      y = sectionTitle('6. Registro Fotográfico', y);
      y += 4;

      for (let i = 0; i < data.fotos.length; i++) {
        const photo = data.fotos[i];
        setP(65 + Math.round((i / data.fotos.length) * 12), `Foto ${i+1} de ${data.fotos.length}...`);

        // Check if we need new page (photo takes ~90mm height)
        if (y + 92 > H - MB) {
          y = addPage();
          y += 4;
        }

        try {
          // Detect image format
          const fmt = photo.dataUrl.startsWith('data:image/png') ? 'PNG' : 'JPEG';
          // Get natural dimensions to maintain aspect ratio
          const imgEl = new Image();
          await new Promise(res => { imgEl.onload = res; imgEl.src = photo.dataUrl; });
          const ratio = imgEl.naturalWidth / imgEl.naturalHeight;
          const imgW = Math.min(CW - 10, 130);
          const imgH = imgW / ratio;
          const clampH = Math.min(imgH, 80);
          const finalW = clampH * ratio;
          const imgX = ML + (CW - finalW) / 2;

          doc.addImage(photo.dataUrl, fmt, imgX, y, finalW, clampH);
          y += clampH + 3;
        } catch(e) {
          // If image fails, show placeholder
          doc.setFillColor(...C.parchment);
          doc.rect(ML + 10, y, CW - 20, 40, 'F');
          doc.setFont('helvetica', 'italic');
          doc.setFontSize(8);
          doc.setTextColor(...C.gray);
          doc.text('Imagen no disponible', W/2, y + 20, { align:'center' });
          y += 44;
        }

        // Photo caption
        const captionText = photo.caption
          ? `Figura ${i+1}: ${photo.caption}`
          : `Figura ${i+1}: ${photo.name}`;
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(8);
        doc.setTextColor(...C.midGreen);
        const captLines = doc.splitTextToSize(captionText, CW - 10);
        captLines.forEach(line => { doc.text(line, W/2, y, { align:'center' }); y += 4.5; });
        y += 6;
      }
    }

    // ╔══════════════════════════════════╗
    // ║  LAST PAGE — SIGNATURES          ║
    // ╚══════════════════════════════════╝
    setP(79, 'Finalizando PDF...');
    await App.delay(80);

    // Check space on current page
    if (y + 60 > H - MB) { y = addPage(); }

    y += 6;
    // Closing note box
    doc.setFillColor(...C.lightGreen);
    doc.roundedRect(ML, y, CW, 22, 3, 3, 'F');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...C.darkGreen);
    const closingText = `Este reporte fue generado automáticamente por AveSampler el ${new Date().toLocaleDateString('es-CO')}. Los datos corresponden al muestreo realizado el ${dateStr} en ${data.ubicacion || 'ubicación no registrada'}.`;
    const closingLines = doc.splitTextToSize(closingText, CW - 8);
    closingLines.forEach((line, i) => { doc.text(line, ML + 4, y + 8 + i * 5); });
    y += 30;

    // Signature lines
    const sigY = y + 20;
    [[data.observador || 'Observador', 'Observador de campo'],
     [data.autor      || 'Investigador', 'Investigador principal']].forEach(([name, role], i) => {
      const x = i === 0 ? ML : ML + CW/2 + 5;
      doc.setDrawColor(...C.midGreen);
      doc.setLineWidth(0.4);
      doc.line(x, sigY, x + CW/2 - 10, sigY);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(...C.textDark);
      doc.text(name, x, sigY + 5);
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(7.5);
      doc.setTextColor(...C.gray);
      doc.text(role, x, sigY + 10);
    });

    return doc;
  },

  downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  },

  delay(ms) { return new Promise(r => setTimeout(r, ms)); },

  // ── MODALS ──────────────────────────────────────────────

  openInstructions() {
    document.getElementById('modal-instructions').style.display = 'flex';
    document.body.style.overflow = 'hidden';
  },

  closeInstructions(event) {
    if (event && event.target !== event.currentTarget) return;
    document.getElementById('modal-instructions').style.display = 'none';
    document.body.style.overflow = '';
  },

  // ── PWA INSTALL ─────────────────────────────────────────

  async installPWA() {
    if (!State.deferredInstall) {
      App.toast('Usa "Agregar a pantalla de inicio" en tu navegador', 'info');
      return;
    }
    State.deferredInstall.prompt();
    const { outcome } = await State.deferredInstall.userChoice;
    if (outcome === 'accepted') {
      State.deferredInstall = null;
      document.getElementById('btn-install').style.display = 'none';
    }
  },

  // ── ONLINE STATUS ───────────────────────────────────────

  updateOnlineStatus() {
    const badge = document.getElementById('offline-badge');
    if (badge) {
      badge.style.display = navigator.onLine ? 'none' : 'inline';
    }
  },

  // ── NEW RECORD ──────────────────────────────────────────

  newRecord() {
    // Reset state
    State.photos = [];
    State.speciesCount = 0;
    State.pendingPhotoIndex = null;

    // Reset form fields
    document.getElementById('project-name').value = '';
    document.getElementById('project-date').value = new Date().toISOString().split('T')[0];
    document.getElementById('project-author').value = '';
    document.getElementById('project-institution').value = '';
    document.getElementById('location').value = '';
    document.getElementById('lat').value = '';
    document.getElementById('lon').value = '';
    document.getElementById('altitude').value = '';
    document.getElementById('ecosystem').value = '';
    document.getElementById('weather').value = '';
    document.getElementById('temperature').value = '';
    document.getElementById('method').value = '';
    document.getElementById('duration').value = '';
    document.getElementById('time-start').value = '';
    document.getElementById('time-end').value = '';
    document.getElementById('observer').value = '';
    document.getElementById('sampling-notes').value = '';

    // Clear species
    document.getElementById('species-list').innerHTML = '';
    App.addSpecies();

    // Clear photos
    App.renderPhotoGrid();

    // Reset report UI
    document.getElementById('btn-generate').disabled = false;
    document.getElementById('btn-generate').style.opacity = '1';
    document.getElementById('btn-generate').style.display = '';
    document.getElementById('gen-progress').style.display = 'none';
    document.getElementById('gen-success').style.display = 'none';
    document.getElementById('report-footer').style.display = '';

    // Reset template
    document.querySelectorAll('.template-card').forEach(c => c.classList.remove('selected'));
    document.querySelector('[data-value="aves_estandar"]').classList.add('selected');
    State.selectedTemplate = 'aves_estandar';

    App.goTo('section-template');
  },

  // ── DRAFT (localStorage) ────────────────────────────────

  saveDraft() {
    try {
      const data = {
        template:    State.selectedTemplate,
        projectName: document.getElementById('project-name')?.value || '',
        projectDate: document.getElementById('project-date')?.value || '',
        author:      document.getElementById('project-author')?.value || '',
        institution: document.getElementById('project-institution')?.value || '',
        location:    document.getElementById('location')?.value || '',
        lat:         document.getElementById('lat')?.value || '',
        lon:         document.getElementById('lon')?.value || '',
        altitude:    document.getElementById('altitude')?.value || '',
        ecosystem:   document.getElementById('ecosystem')?.value || '',
        weather:     document.getElementById('weather')?.value || '',
        temperature: document.getElementById('temperature')?.value || '',
        method:      document.getElementById('method')?.value || '',
        duration:    document.getElementById('duration')?.value || '',
        timeStart:   document.getElementById('time-start')?.value || '',
        timeEnd:     document.getElementById('time-end')?.value || '',
        observer:    document.getElementById('observer')?.value || '',
        notes:       document.getElementById('sampling-notes')?.value || '',
      };
      localStorage.setItem('avesampler_draft', JSON.stringify(data));
    } catch(e) { /* storage not available */ }
  },

  loadDraft() {
    try {
      const raw = localStorage.getItem('avesampler_draft');
      if (!raw) return;
      const d = JSON.parse(raw);
      if (d.projectName) document.getElementById('project-name').value = d.projectName;
      if (d.projectDate) document.getElementById('project-date').value = d.projectDate;
      if (d.author)      document.getElementById('project-author').value = d.author;
      if (d.institution) document.getElementById('project-institution').value = d.institution;
      if (d.location)    document.getElementById('location').value = d.location;
      if (d.lat)         document.getElementById('lat').value = d.lat;
      if (d.lon)         document.getElementById('lon').value = d.lon;
      if (d.altitude)    document.getElementById('altitude').value = d.altitude;
      if (d.ecosystem)   document.getElementById('ecosystem').value = d.ecosystem;
      if (d.weather)     document.getElementById('weather').value = d.weather;
      if (d.temperature) document.getElementById('temperature').value = d.temperature;
      if (d.method)      document.getElementById('method').value = d.method;
      if (d.duration)    document.getElementById('duration').value = d.duration;
      if (d.timeStart)   document.getElementById('time-start').value = d.timeStart;
      if (d.timeEnd)     document.getElementById('time-end').value = d.timeEnd;
      if (d.observer)    document.getElementById('observer').value = d.observer;
      if (d.notes)       document.getElementById('sampling-notes').value = d.notes;
      if (d.template) {
        State.selectedTemplate = d.template;
        document.querySelectorAll('.template-card').forEach(c => c.classList.remove('selected'));
        const card = document.querySelector(`[data-value="${d.template}"]`);
        if (card) card.classList.add('selected');
      }
    } catch(e) { /* ignore */ }
  },

  clearDraft() {
    try { localStorage.removeItem('avesampler_draft'); } catch(e) {}
  },

  // ── UTILS ───────────────────────────────────────────────

  toast(msg, type = '') {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.className = 'toast' + (type ? ` ${type}` : '');
    toast.style.display = 'block';
    clearTimeout(App._toastTimer);
    App._toastTimer = setTimeout(() => { toast.style.display = 'none'; }, 3000);
  },

  escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },
};

// ═══════════════════════════════════════════════════════════
// TEMPLATE CACHE — populated on first fetch from templates/
// Add more .tex files to templates/ folder and reference
// them by filename (without extension) in the template cards.
// ═══════════════════════════════════════════════════════════

const TemplateCache = {};
