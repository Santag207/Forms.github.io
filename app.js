'use strict';
// ══════════════════════════════════════════════════════════════
//  AveSampler — app.js   Complete implementation
// ══════════════════════════════════════════════════════════════

const S = {                       // global state
  tpl:      'aves_estandar',
  spCount:  0,
  spData:   {},                   // id → {fotos:[]}
  genPhotos:[],
  pendCap:  null,                 // {ctx:'gen'|'sp', spId?, idx}
  birdDB:   null,
  records:  [],
  curFiles: null,                 // {pdfBlob, zipBlob, base}
  deferredInstall: null,
  tplCache: {},
};

const SEC = {
  'sec-template':{ title:'Plantilla', step:1 },
  'sec-sampling':{ title:'Sitio',     step:2 },
  'sec-species': { title:'Especies',  step:3 },
  'sec-photos':  { title:'Fotos',     step:4 },
  'sec-report':  { title:'Reporte',   step:5 },
};
const PREV = {
  'sec-template':'home',
  'sec-sampling':'sec-template',
  'sec-species': 'sec-sampling',
  'sec-photos':  'sec-species',
  'sec-report':  'sec-photos',
};

// ──────────────────────────────────────────────────────────────
//  INIT
// ──────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const d = document.getElementById('f-date');
  if (d) d.value = new Date().toISOString().split('T')[0];

  S.records = JSON.parse(localStorage.getItem('avesampler_records') || '[]');
  App.addSpecies();
  App.renderRecords();
  App.updateOnline();
  window.addEventListener('online',  App.updateOnline);
  window.addEventListener('offline', App.updateOnline);

  // Load bird DB
  fetch('data/aves.json')
    .then(r => r.json())
    .then(db => {
      S.birdDB = db;
      document.querySelectorAll('.sp-fam-sel').forEach(el => App.fillFamilies(el));
    })
    .catch(() => {});

  // PWA
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault(); S.deferredInstall = e;
    const btn = document.getElementById('btn-install');
    if (btn) btn.style.display = 'inline-flex';
  });

  // iOS detection
  const iOS    = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
                 (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = navigator.standalone || window.matchMedia('(display-mode:standalone)').matches;
  if (iOS && !standalone) {
    const b = document.getElementById('btn-ios');
    if (b) b.style.display = 'inline-flex';
    if (!localStorage.getItem('ios_dismissed')) setTimeout(() => UI.showIOSBanner(), 3000);
  }

  // Service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register(
      new URL('service-worker.js', location.href).href,
      { scope: new URL('./', location.href).href }
    ).catch(() => {});
  }
});

// ──────────────────────────────────────────────────────────────
//  UI helpers (modals, panels, ios, toast)
// ──────────────────────────────────────────────────────────────
const UI = {
  openInstructions() {
    document.getElementById('modal-instructions').style.display = 'flex';
    document.body.style.overflow = 'hidden';
  },
  closeInstructions(e) {
    if (e && e.target !== e.currentTarget) return;
    document.getElementById('modal-instructions').style.display = 'none';
    document.body.style.overflow = '';
  },
  openPanel() {
    App.renderRecords();
    document.getElementById('panel-overlay').style.display = 'block';
    document.getElementById('records-panel').classList.add('open');
    document.body.style.overflow = 'hidden';
  },
  closePanel() {
    document.getElementById('panel-overlay').style.display = 'none';
    document.getElementById('records-panel').classList.remove('open');
    document.body.style.overflow = '';
  },
  showIOSBanner() { document.getElementById('ios-banner').style.display = 'block'; },
  closeIOSBanner() {
    document.getElementById('ios-banner').style.display = 'none';
    localStorage.setItem('ios_dismissed','1');
  },
  openDLModal() {
    document.getElementById('dl-progress-phase').style.display = 'block';
    document.getElementById('dl-done-phase').style.display = 'none';
    document.getElementById('dl-prog-fill').style.width = '0%';
    document.getElementById('dl-modal').style.display = 'flex';
    document.body.style.overflow = 'hidden';
  },
  closeDLModal() {
    document.getElementById('dl-modal').style.display = 'none';
    document.body.style.overflow = '';
  },
  setProgress(pct, msg) {
    document.getElementById('dl-prog-fill').style.width = pct + '%';
    document.getElementById('dl-prog-msg').textContent  = msg;
  },
  showDLDone(base) {
    document.getElementById('dl-progress-phase').style.display = 'none';
    document.getElementById('dl-done-phase').style.display      = 'block';
    document.getElementById('dl-pdf-name').textContent = base + '.pdf';
    document.getElementById('dl-zip-name').textContent = base + '.zip';
    setTimeout(() => App.dlFile('pdf'), 400);
  },
  toast(msg, type) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className   = 'toast' + (type ? ' ' + type : '');
    t.style.display = 'block';
    clearTimeout(UI._tt);
    UI._tt = setTimeout(() => { t.style.display = 'none'; }, 3000);
  },
};

// ──────────────────────────────────────────────────────────────
//  APP
// ──────────────────────────────────────────────────────────────
const App = {

  // ── Navigation ───────────────────────────────────────────────
  goHome() {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById('screen-home').classList.add('active');
  },
  goSec(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById('screen-app').classList.add('active');
    document.querySelectorAll('.fsec').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    const m = SEC[id] || { title:'', step:1 };
    document.getElementById('nav-title').textContent = m.title;
    document.getElementById('nav-step').textContent  = m.step + '/5';
    document.getElementById('prog-line').style.width  = (m.step / 5 * 100) + '%';
    document.querySelectorAll('.sdot').forEach(d => {
      const s = +d.dataset.s;
      d.classList.remove('active','done');
      if (s === m.step) d.classList.add('active');
      else if (s < m.step) d.classList.add('done');
    });
    window.scrollTo({ top:0, behavior:'smooth' });
  },
  back() {
    const cur  = document.querySelector('.fsec.active')?.id;
    const dest = PREV[cur] || 'home';
    dest === 'home' ? App.goHome() : App.goSec(dest);
  },
  next(target) {
    if (!App.validate()) return;
    if (target === 'sec-report') App.buildSummary();
    App.saveDraft();
    App.goSec(target);
  },
  prev(target) { App.goSec(target); },

  // ── Validation ───────────────────────────────────────────────
  validate() {
    const cur = document.querySelector('.fsec.active')?.id;
    if (cur === 'sec-template') {
      if (!document.getElementById('f-name').value.trim())
        { UI.toast('Ingresa el nombre del proyecto','error'); return false; }
      if (!document.getElementById('f-date').value)
        { UI.toast('Selecciona la fecha del muestreo','error'); return false; }
    }
    if (cur === 'sec-sampling') {
      if (!document.getElementById('f-loc').value.trim())
        { UI.toast('Ingresa la ubicación del muestreo','error'); return false; }
    }
    return true;
  },

  // ── Template selection ───────────────────────────────────────
  pickTpl(card) {
    document.querySelectorAll('.tpl-card').forEach(c => c.classList.remove('sel'));
    card.classList.add('sel');
    S.tpl = card.dataset.v;
  },

  // ── GPS ──────────────────────────────────────────────────────
  getGPS() {
    if (!navigator.geolocation) { UI.toast('GPS no disponible','error'); return; }
    UI.toast('Obteniendo ubicación…');
    navigator.geolocation.getCurrentPosition(p => {
      document.getElementById('f-lat').value = p.coords.latitude.toFixed(6);
      document.getElementById('f-lon').value = p.coords.longitude.toFixed(6);
      if (p.coords.altitude) document.getElementById('f-alt').value = Math.round(p.coords.altitude);
      UI.toast('📍 Coordenadas obtenidas','success');
    }, () => UI.toast('No se pudo obtener la ubicación','error'), { enableHighAccuracy:true, timeout:10000 });
  },

  // ── Bird DB helpers ──────────────────────────────────────────
  fillFamilies(sel) {
    if (!S.birdDB) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="">— Seleccionar familia —</option>';
    S.birdDB.familias.forEach(f => {
      const o = document.createElement('option');
      o.value = f.id; o.textContent = f.familia + ' — ' + f.nombre_comun;
      sel.appendChild(o);
    });
    if (cur) sel.value = cur;
  },
  fillSpecies(famId, spSel) {
    spSel.innerHTML = '<option value="">— Seleccionar especie —</option>';
    if (!famId || !S.birdDB) return;
    const fam = S.birdDB.familias.find(f => f.id === famId);
    if (!fam) return;
    fam.especies.forEach(sp => {
      const o = document.createElement('option');
      o.value = sp.nombre_cientifico;
      o.textContent = sp.nombre_cientifico + ' — ' + sp.nombre_comun;
      o.dataset.comun = sp.nombre_comun;
      spSel.appendChild(o);
    });
    const m = document.createElement('option');
    m.value = '__manual__'; m.textContent = '✏ Ingresar manualmente';
    spSel.appendChild(m);
  },
  onFamChange(id) {
    const fam = document.getElementById('sp-fam-' + id);
    const sp  = document.getElementById('sp-sp-'  + id);
    const man = document.getElementById('sp-man-' + id);
    App.fillSpecies(fam.value, sp);
    if (man) man.style.display = 'none';
  },
  onSpChange(id) {
    const sp  = document.getElementById('sp-sp-'  + id);
    const man = document.getElementById('sp-man-' + id);
    if (man) man.style.display = (sp.value === '__manual__') ? 'block' : 'none';
  },

  // ── Species ──────────────────────────────────────────────────
  addSpecies() {
    S.spCount++;
    const n = S.spCount;
    S.spData[n] = { fotos: [] };
    const div = document.createElement('div');
    div.className = 'sp-entry'; div.id = 'sp-entry-' + n;
    div.innerHTML = `
      <div class="sp-entry-head">
        <span class="sp-num">Especie #${n}</span>
        <button class="sp-remove" onclick="App.removeSp(${n})">✕ Eliminar</button>
      </div>
      <div class="frow">
        <div class="fgroup">
          <label class="flabel req" for="sp-fam-${n}">Familia</label>
          <select id="sp-fam-${n}" class="finput sp-fam-sel" onchange="App.onFamChange(${n})">
            <option value="">— Seleccionar familia —</option>
          </select>
        </div>
        <div class="fgroup">
          <label class="flabel req" for="sp-sp-${n}">Especie</label>
          <select id="sp-sp-${n}" class="finput" onchange="App.onSpChange(${n})">
            <option value="">— Primero selecciona familia —</option>
          </select>
        </div>
      </div>
      <div id="sp-man-${n}" style="display:none" class="fgroup">
        <label class="flabel" for="sp-name-${n}">Nombre (manual)</label>
        <input id="sp-name-${n}" class="finput" type="text" placeholder="Nombre científico / común"/>
      </div>
      <div class="frow">
        <div class="fgroup">
          <label class="flabel" for="sp-cnt-${n}">Individuos</label>
          <input id="sp-cnt-${n}" class="finput" type="number" min="1" value="1"/>
        </div>
        <div class="fgroup">
          <label class="flabel" for="sp-beh-${n}">Comportamiento</label>
          <select id="sp-beh-${n}" class="finput">
            <option value="">Seleccionar...</option>
            <option>Canto / Vocalización</option><option>Forrajeo / Alimentación</option>
            <option>Vuelo</option><option>Percha</option><option>Anidación / Cortejo</option>
            <option>Descanso</option><option>Acicalamiento</option><option>Otro</option>
          </select>
        </div>
      </div>
      <div class="frow">
        <div class="fgroup">
          <label class="flabel" for="sp-sex-${n}">Sexo / Edad</label>
          <select id="sp-sex-${n}" class="finput">
            <option value="">No determinado</option>
            <option>Macho adulto</option><option>Hembra adulta</option>
            <option>Juvenil</option><option>Inmaduro</option><option>Grupo mixto</option>
          </select>
        </div>
        <div class="fgroup">
          <label class="flabel" for="sp-notes-${n}">Notas</label>
          <input id="sp-notes-${n}" class="finput" type="text" placeholder="Observaciones..."/>
        </div>
      </div>
      <div class="sp-photos">
        <div class="sp-photo-head">
          <span class="sp-photo-lbl">📷 Fotos de esta especie</span>
          <div class="sp-photo-actions">
            <label class="sp-photo-btn" for="sp-photo-${n}">
              <svg viewBox="0 0 20 20" fill="none"><path d="M10 4v12M4 10h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
              Galería
              <input id="sp-photo-${n}" type="file" accept="image/jpeg,image/png,image/jpg" multiple hidden
                onchange="App.addPhotos(event,'sp',${n})"/>
            </label>
            <button class="sp-photo-btn" onclick="App.spCam(${n})">
              <svg viewBox="0 0 20 20" fill="none"><circle cx="10" cy="11" r="3" stroke="currentColor" stroke-width="1.8"/><path d="M3 8a1 1 0 0 1 1-1h1l2-2h6l2 2h1a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8z" stroke="currentColor" stroke-width="1.8"/></svg>
              Cámara
            </button>
          </div>
        </div>
        <div id="sp-pgrid-${n}" class="sp-photo-grid">
          <span class="sp-photo-none">Sin fotos aún</span>
        </div>
      </div>
    `;
    document.getElementById('species-list').appendChild(div);
    if (S.birdDB) App.fillFamilies(document.getElementById('sp-fam-' + n));
    div.scrollIntoView({ behavior:'smooth', block:'nearest' });
  },
  removeSp(n) {
    const el = document.getElementById('sp-entry-' + n);
    if (el) el.remove();
    delete S.spData[n];
  },
  spCam(n) {
    let inp = document.getElementById('_spcam');
    if (!inp) {
      inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'image/*';
      inp.setAttribute('capture','environment');
      inp.id = '_spcam'; inp.hidden = true;
      document.body.appendChild(inp);
    }
    inp.onchange = e => App.addPhotos(e, 'sp', n);
    inp.value = ''; inp.click();
  },

  // ── Photos ───────────────────────────────────────────────────
  addPhotos(event, ctx, spId) {
    Array.from(event.target.files).forEach(file => {
      if (!file.type.match(/image\/(jpeg|png|jpg)/)) return;
      const reader = new FileReader();
      reader.onload = e => {
        const ext   = file.name.split('.').pop() || 'jpg';
        const photo = { dataUrl: e.target.result, caption: '', name: '' };
        if (ctx === 'gen') {
          const idx = S.genPhotos.length;
          photo.name = 'foto_general_' + (idx+1) + '.' + ext;
          S.genPhotos.push(photo);
          App.renderGenGrid();
          S.pendCap = { ctx:'gen', idx };
        } else {
          const sp  = S.spData[spId];
          const idx = sp.fotos.length;
          photo.name = 'foto_sp' + spId + '_' + (idx+1) + '.' + ext;
          sp.fotos.push(photo);
          App.renderSpGrid(spId);
          S.pendCap = { ctx:'sp', spId, idx };
        }
        App.openCaptionModal();
      };
      reader.readAsDataURL(file);
    });
    event.target.value = '';
  },
  renderGenGrid() {
    const grid  = document.getElementById('gen-photo-grid');
    const empty = document.getElementById('gen-photo-empty');
    const count = document.getElementById('gen-photo-count');
    grid.querySelectorAll('.photo-thumb').forEach(t => t.remove());
    if (!S.genPhotos.length) {
      empty.style.display = 'flex'; count.style.display = 'none'; return;
    }
    empty.style.display = 'none';
    S.genPhotos.forEach((p, i) => {
      const t = App.makeThumb(p, i, () => { S.genPhotos.splice(i,1); App.renderGenGrid(); });
      grid.appendChild(t);
    });
    count.style.display  = 'block';
    count.textContent = S.genPhotos.length + ' foto' + (S.genPhotos.length!==1?'s':'') + ' general' + (S.genPhotos.length!==1?'es':'');
  },
  renderSpGrid(spId) {
    const grid = document.getElementById('sp-pgrid-' + spId);
    if (!grid) return;
    grid.innerHTML = '';
    const fotos = S.spData[spId]?.fotos || [];
    if (!fotos.length) { grid.innerHTML = '<span class="sp-photo-none">Sin fotos aún</span>'; return; }
    fotos.forEach((p, i) => {
      const t = App.makeThumb(p, i, () => { S.spData[spId].fotos.splice(i,1); App.renderSpGrid(spId); });
      grid.appendChild(t);
    });
  },
  makeThumb(photo, idx, onRemove) {
    const d = document.createElement('div');
    d.className = 'photo-thumb';
    d.innerHTML = `
      <span class="photo-thumb-n">${idx+1}</span>
      <img src="${photo.dataUrl}" loading="lazy"/>
      <button class="photo-thumb-x">✕</button>
      ${photo.caption?`<div class="photo-thumb-cap">${App.esc(photo.caption)}</div>`:''}
    `;
    d.querySelector('.photo-thumb-x').onclick = onRemove;
    return d;
  },
  openCaptionModal() {
    const m = document.getElementById('caption-modal');
    document.getElementById('caption-input').value = '';
    m.style.display = 'flex';
    document.getElementById('caption-input').focus();
  },
  closeCaptionModal(e) {
    if (e && e.target !== e.currentTarget) return;
    document.getElementById('caption-modal').style.display = 'none';
    S.pendCap = null;
  },
  saveCaption() {
    const cap = document.getElementById('caption-input').value.trim();
    const pc  = S.pendCap;
    if (pc) {
      if (pc.ctx === 'gen' && S.genPhotos[pc.idx]) {
        S.genPhotos[pc.idx].caption = cap; App.renderGenGrid();
      } else if (pc.ctx === 'sp' && S.spData[pc.spId]?.fotos[pc.idx]) {
        S.spData[pc.spId].fotos[pc.idx].caption = cap; App.renderSpGrid(pc.spId);
      }
    }
    document.getElementById('caption-modal').style.display = 'none';
    S.pendCap = null;
  },

  // ── Collect data ─────────────────────────────────────────────
  collectData() {
    const g = id => (document.getElementById(id)?.value || '').trim();
    const especies = Array.from(document.querySelectorAll('.sp-entry')).map(el => {
      const n  = el.id.replace('sp-entry-','');
      const fam = document.getElementById('sp-fam-'+n);
      const sp  = document.getElementById('sp-sp-' +n);
      const man = document.getElementById('sp-name-'+n)?.value?.trim() || '';
      let nombre = (sp?.value === '__manual__' || !sp?.value) ? man : (sp?.value || '');
      let famLabel = '';
      if (fam?.value && S.birdDB) {
        const f = S.birdDB.familias.find(x => x.id === fam.value);
        if (f) famLabel = f.familia + ' — ' + f.nombre_comun;
      }
      let nombreComun = '';
      if (sp?.value && sp.value !== '__manual__') {
        const opt = sp.querySelector('option[value="'+sp.value+'"]');
        if (opt) nombreComun = opt.dataset.comun || '';
      }
      return {
        id: n, nombre, nombreComun, familia: famLabel,
        count:    document.getElementById('sp-cnt-'+n)?.value    || '1',
        behavior: document.getElementById('sp-beh-'+n)?.value    || '',
        sex:      document.getElementById('sp-sex-'+n)?.value    || '',
        notes:    (document.getElementById('sp-notes-'+n)?.value || '').trim(),
        fotos:    S.spData[n]?.fotos || [],
      };
    }).filter(sp => sp.nombre);
    return {
      id: Date.now().toString(),
      template:    S.tpl,
      nombre_proyecto: g('f-name'),
      fecha:       document.getElementById('f-date')?.value || '',
      autor:       g('f-author'), institucion: g('f-inst'),
      ubicacion:   g('f-loc'),   latitud: g('f-lat'), longitud: g('f-lon'), altitud: g('f-alt'),
      ecosistema:  g('f-eco'),   clima: g('f-wx'), temperatura: g('f-temp'),
      metodo:      g('f-method'),duracion: g('f-dur'), hora_inicio: g('f-ts'), hora_fin: g('f-te'),
      observador:  g('f-obs'),   notas_generales: document.getElementById('f-notes')?.value?.trim() || '',
      especies, fotos: S.genPhotos,
      created_at: new Date().toISOString(),
    };
  },

  // ── Build summary ────────────────────────────────────────────
  buildSummary() {
    const d = App.collectData();
    const tplL = { 'aves_estandar':'Muestreo estándar','biodiversidad':'Monitoreo de biodiversidad','registro_extendido':'Registro extendido' }[S.tpl] || S.tpl;
    const spPhotos = d.especies.reduce((s,sp) => s + (sp.fotos?.length||0), 0);
    document.getElementById('report-summary').innerHTML = `
      <h3>📋 Resumen del registro</h3>
      <div class="sum-grid">
        <div class="sum-item"><span>Proyecto</span><span>${App.esc(d.nombre_proyecto)}</span></div>
        <div class="sum-item"><span>Fecha</span><span>${d.fecha}</span></div>
        <div class="sum-item"><span>Plantilla</span><span>${tplL}</span></div>
        <div class="sum-item"><span>Ubicación</span><span>${App.esc(d.ubicacion)||'—'}</span></div>
        <div class="sum-item"><span>Especies</span><span>${d.especies.length} registradas</span></div>
        <div class="sum-item"><span>Fotos por especie</span><span>${spPhotos}</span></div>
        <div class="sum-item"><span>Fotos generales</span><span>${d.fotos.length}</span></div>
        <div class="sum-item"><span>Método</span><span>${d.metodo||'—'}</span></div>
      </div>`;
    const base = (d.nombre_proyecto||'Proyecto').replace(/\s+/g,'_') + '_' + d.fecha;
    const p = document.getElementById('lbl-pdf'); if (p) p.textContent = base+'.pdf';
    const z = document.getElementById('lbl-zip'); if (z) z.textContent = base+'.zip';
  },

  // ── MAIN GENERATE ────────────────────────────────────────────
  async generate() {
    const data = App.collectData();
    if (!data.nombre_proyecto || !data.fecha) { UI.toast('Completa nombre del proyecto y fecha','error'); return; }
    const base = data.nombre_proyecto.replace(/\s+/g,'_') + '_' + data.fecha;

    UI.openDLModal();
    const P = UI.setProgress.bind(UI);

    try {
      // 1. Load LaTeX template
      P(5, 'Cargando plantilla LaTeX...');
      await App.delay(100);
      let texContent = '';
      try {
        if (!S.tplCache[S.tpl]) {
          const r = await fetch('templates/' + S.tpl + '.tex');
          if (r.ok) S.tplCache[S.tpl] = await r.text();
        }
        if (S.tplCache[S.tpl]) texContent = App.fillLatex(data, S.tplCache[S.tpl]);
      } catch(e) {}

      // 2. Build PDF
      P(15, 'Construyendo PDF...');
      await App.delay(100);
      const pdfDoc  = await App.buildPDF(data, P);
      const pdfBlob = pdfDoc.output('blob');

      // 3. Build ZIP
      P(80, 'Empaquetando ZIP...');
      await App.delay(100);
      const zip    = new JSZip();
      const folder = zip.folder(base);
      folder.file(base + '.pdf', pdfBlob);
      if (texContent) folder.file(base + '.tex', texContent);

      // Photos in ZIP
      const imgF = folder.folder('imagenes');
      const allPhotos = [
        ...data.fotos,
        ...data.especies.flatMap(sp => sp.fotos || [])
      ];
      let pi = 0;
      for (const foto of allPhotos) {
        if (foto.dataUrl) imgF.file(foto.name, foto.dataUrl.split(',')[1], { base64:true });
        pi++;
        P(80 + Math.round(pi/Math.max(allPhotos.length,1)*8), 'Fotos: '+pi+'/'+allPhotos.length+'...');
        await App.delay(30);
      }

      // JSON data
      const dataLight = {
        ...data,
        fotos:   data.fotos.map(f => ({ name:f.name, caption:f.caption })),
        especies: data.especies.map(sp => ({ ...sp, fotos: sp.fotos.map(f => ({ name:f.name, caption:f.caption })) }))
      };
      folder.file(base + '_datos.json', JSON.stringify(dataLight, null, 2));
      folder.file('README.txt', App.readme(data, base));

      P(92, 'Comprimiendo...');
      const zipBlob = await zip.generateAsync({ type:'blob', compression:'DEFLATE', compressionOptions:{level:6} });

      P(100, '¡Listo!');
      await App.delay(300);

      S.curFiles = { pdfBlob, zipBlob, base };
      App.saveRecord(data, base);
      UI.showDLDone(base);

    } catch(err) {
      UI.closeDLModal();
      UI.toast('Error: ' + err.message, 'error');
      console.error(err);
    }
  },

  dlFile(type) {
    if (!S.curFiles) return;
    const { pdfBlob, zipBlob, base } = S.curFiles;
    if (type === 'pdf') { App.trigger(pdfBlob, base+'.pdf'); UI.toast('✓ PDF descargado','success'); }
    else                { App.trigger(zipBlob, base+'.zip'); UI.toast('✓ ZIP descargado','success'); }
  },
  trigger(blob, name) {
    const url = URL.createObjectURL(blob);
    const a   = Object.assign(document.createElement('a'), { href:url, download:name });
    a.style.display = 'none';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  },

  // ── PDF BUILDER ──────────────────────────────────────────────
  async buildPDF(data, P) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' });
    const W=210, H=297, ML=22, MR=18, CW=W-ML-MR;
    const C = {
      dg:[28,61,44],   mg:[45,92,64],  lg:[74,124,94], lgt:[200,221,210],
      am:[200,120,10], pa:[246,241,232],wh:[255,255,255],gr:[120,148,134],tx:[26,42,32]
    };
    const dateStr = new Date((data.fecha||new Date().toISOString().split('T')[0])+'T12:00:00')
      .toLocaleDateString('es-CO',{year:'numeric',month:'long',day:'numeric'});
    const tplL = { 'aves_estandar':'Muestreo estándar','biodiversidad':'Monitoreo de biodiversidad','registro_extendido':'Registro extendido' }[data.template] || data.template;
    const totalInd = data.especies.reduce((s,e) => s+parseInt(e.count||0),0);
    const allPhotos = [...(data.fotos||[]), ...data.especies.flatMap(sp=>sp.fotos||[])];

    // helpers
    const hdr = () => {
      doc.setFillColor(...C.dg); doc.rect(0,0,W,13,'F');
      doc.setFont('helvetica','bold'); doc.setFontSize(7.5); doc.setTextColor(...C.wh);
      doc.text('AveSampler',ML,8.5);
      doc.setFont('helvetica','normal'); doc.setTextColor(...C.lgt);
      doc.text(data.nombre_proyecto+'  ·  '+data.fecha, W-MR, 8.5, {align:'right'});
      doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(...C.gr);
      doc.text('Página '+doc.internal.getCurrentPageInfo().pageNumber, W/2, H-8, {align:'center'});
    };
    const addPage = () => { doc.addPage(); hdr(); return 22; };
    const secTitle = (txt, y) => {
      doc.setFillColor(...C.dg); doc.rect(ML,y,CW,7.5,'F');
      doc.setFont('helvetica','bold'); doc.setFontSize(9.5); doc.setTextColor(...C.wh);
      doc.text(txt.toUpperCase(),ML+3,y+5.2);
      return y+13;
    };
    const infoRow = (lbl, val, y, shaded) => {
      if (shaded) { doc.setFillColor(...C.pa); doc.rect(ML,y-3.5,CW,6.5,'F'); }
      doc.setFont('helvetica','bold'); doc.setFontSize(7.8); doc.setTextColor(...C.mg);
      doc.text(lbl, ML+2, y);
      doc.setFont('helvetica','normal'); doc.setTextColor(...C.tx);
      doc.text(doc.splitTextToSize(String(val||'—'),CW-50)[0]||'—', ML+50, y);
      return y+6.5;
    };

    // ── COVER ──
    P(25,'Portada...');
    doc.setFillColor(...C.dg); doc.rect(0,0,W,H,'F');
    doc.setFillColor(...C.mg); doc.rect(0,0,W,8,'F');
    doc.setFillColor(...C.am); doc.rect(ML,52,CW,.7,'F');
    doc.setFont('helvetica','bold'); doc.setFontSize(7.5); doc.setTextColor(...C.am);
    doc.text(tplL.toUpperCase(),ML,48,{charSpace:1.2});
    doc.setFont('helvetica','bold'); doc.setFontSize(26); doc.setTextColor(...C.wh);
    const tLines = doc.splitTextToSize(data.nombre_proyecto||'Sin título',CW);
    doc.text(tLines,ML,66);
    const tH = tLines.length*10;
    doc.setFont('helvetica','italic'); doc.setFontSize(12); doc.setTextColor(...C.lgt);
    doc.text('Registro de Avifauna en Campo',ML,68+tH);
    const cY = 96+tH;
    doc.setFillColor(...C.mg); doc.roundedRect(ML,cY,CW,68,3,3,'F');
    [['Fecha:',dateStr],['Autor:',data.autor||'No especificado'],['Institución:',data.institucion||'No especificada'],
     ['Ubicación:',data.ubicacion||'No registrada'],['Coordenadas:',(data.latitud&&data.longitud)?data.latitud+', '+data.longitud:'No registradas'],
     ['Ecosistema:',data.ecosistema||'No especificado']
    ].forEach(([lbl,val],i)=>{
      const y=cY+9+i*10;
      doc.setFont('helvetica','bold'); doc.setFontSize(7); doc.setTextColor(...C.lgt); doc.text(lbl,ML+5,y);
      doc.setFont('helvetica','normal'); doc.setFontSize(8.5); doc.setTextColor(...C.wh);
      doc.text(doc.splitTextToSize(val,CW-42)[0]||'—',ML+38,y);
    });
    const sY = H-58;
    doc.setFillColor(28,61,44); doc.setDrawColor(74,124,94); doc.setLineWidth(.4);
    doc.roundedRect(ML,sY,CW,26,3,3,'FD');
    [[data.especies.length,'Especies'],[totalInd,'Individuos'],[allPhotos.length,'Fotografías']].forEach(([val,lbl],i)=>{
      const x=ML+8+i*(CW/3);
      doc.setFont('helvetica','normal'); doc.setFontSize(6.5); doc.setTextColor(...C.lgt); doc.text(lbl.toUpperCase(),x,sY+8);
      doc.setFont('helvetica','bold'); doc.setFontSize(17); doc.setTextColor(...C.am); doc.text(String(val),x,sY+21);
    });
    doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(...C.gr);
    doc.text('Generado con AveSampler — Sistema de Registro de Muestreo de Aves',W/2,H-10,{align:'center'});

    // ── GENERAL INFO ──
    P(35,'Datos generales...');
    let y = addPage();
    y = secTitle('1. Información General',y);
    y = infoRow('Proyecto',   data.nombre_proyecto,y,false);
    y = infoRow('Fecha',      dateStr,y,true);
    y = infoRow('Autor',      data.autor,y,false);
    y = infoRow('Institución',data.institucion,y,true);
    y+=4;
    y = secTitle('2. Sitio de Muestreo',y);
    y = infoRow('Ubicación',  data.ubicacion,y,false);
    y = infoRow('Latitud',    data.latitud,y,true);
    y = infoRow('Longitud',   data.longitud,y,false);
    y = infoRow('Altitud',    data.altitud?data.altitud+' m.s.n.m.':'—',y,true);
    y = infoRow('Ecosistema', data.ecosistema,y,false);
    y+=4;
    y = secTitle('3. Condiciones y Metodología',y);
    y = infoRow('Clima',      data.clima,y,false);
    y = infoRow('Temperatura',data.temperatura?data.temperatura+'°C':'—',y,true);
    y = infoRow('Método',     data.metodo,y,false);
    y = infoRow('Duración',   data.duracion?data.duracion+' min':'—',y,true);
    y = infoRow('Hora inicio',data.hora_inicio,y,false);
    y = infoRow('Hora fin',   data.hora_fin,y,true);
    y = infoRow('Observador', data.observador,y,false);
    y+=4;
    if (data.notas_generales) {
      y = secTitle('Observaciones Generales',y);
      doc.setFont('helvetica','normal'); doc.setFontSize(8.5); doc.setTextColor(...C.tx);
      for (const line of doc.splitTextToSize(data.notas_generales, CW-4)) {
        if (y > H-30) { y=addPage(); }
        doc.text(line,ML+2,y); y+=5.5;
      }
    }

    // ── SPECIES TABLE ──
    P(48,'Tabla de especies...');
    y = addPage();
    y = secTitle('4. Registro de Especies',y);
    doc.setFillColor(...C.lgt); doc.roundedRect(ML,y,CW,16,2,2,'F');
    [[data.especies.length,'Especies'],[totalInd,'Individuos'],[allPhotos.length,'Fotos']].forEach(([v,l],i)=>{
      const x=ML+6+i*(CW/3);
      doc.setFont('helvetica','normal'); doc.setFontSize(6.5); doc.setTextColor(...C.mg); doc.text(l.toUpperCase(),x,y+5.5);
      doc.setFont('helvetica','bold');   doc.setFontSize(13); doc.setTextColor(...C.dg); doc.text(String(v),x,y+13.5);
    });
    y+=22;
    if (data.especies.length) {
      doc.autoTable({
        startY:y, margin:{left:ML,right:MR},
        head:[['Especie','Familia','N','Comportamiento','Sexo/Edad','Notas']],
        body: data.especies.map(sp=>[sp.nombre||'—',sp.familia||'—',sp.count||'1',sp.behavior||'—',sp.sex||'—',sp.notes||'—']),
        headStyles:{fillColor:C.dg,textColor:C.wh,fontStyle:'bold',fontSize:7.5,cellPadding:2.5},
        bodyStyles:{fontSize:7.5,cellPadding:2,textColor:C.tx},
        alternateRowStyles:{fillColor:C.pa},
        columnStyles:{0:{cellWidth:34,fontStyle:'bold'},1:{cellWidth:28},2:{cellWidth:8,halign:'center'},3:{cellWidth:26},4:{cellWidth:22},5:{cellWidth:'auto'}},
        didDrawPage:()=>{
          doc.setFillColor(...C.dg); doc.rect(0,0,W,13,'F');
          doc.setFont('helvetica','bold'); doc.setFontSize(7.5); doc.setTextColor(...C.wh); doc.text('AveSampler',ML,8.5);
          doc.setFont('helvetica','normal'); doc.setTextColor(...C.lgt); doc.text(data.nombre_proyecto+'  ·  '+data.fecha,W-MR,8.5,{align:'right'});
          doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(...C.gr); doc.text('Página '+doc.internal.getCurrentPageInfo().pageNumber,W/2,H-8,{align:'center'});
        },
      });
    }

    // ── SPECIES WITH THEIR PHOTOS ──
    P(58,'Fichas por especie...');
    if (data.especies.length) {
      y = addPage();
      y = secTitle('5. Fichas por Especie', y);
      y += 2;
      for (const sp of data.especies) {
        if (y + 38 > H-20) { y = addPage(); y+=2; }
        // species card
        doc.setFillColor(...C.mg); doc.roundedRect(ML,y,CW,20,2,2,'F');
        doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(...C.wh);
        doc.text(sp.nombre||'Especie no identificada',ML+4,y+7);
        doc.setFont('helvetica','normal'); doc.setFontSize(7.5); doc.setTextColor(...C.lgt);
        if (sp.familia) doc.text(sp.familia,ML+4,y+13);
        const st = ['N: '+sp.count, sp.behavior, sp.sex].filter(Boolean).join('  ·  ');
        doc.setFontSize(7); doc.setTextColor(200,220,210); doc.text(st,W-MR-2,y+7,{align:'right'});
        if (sp.notes) { doc.setFont('helvetica','italic'); doc.setFontSize(7); doc.text(doc.splitTextToSize(sp.notes,CW-8)[0],ML+4,y+18); }
        y+=25;
        // species photos
        if (sp.fotos?.length) {
          for (let i=0; i<sp.fotos.length; i++) {
            const foto = sp.fotos[i];
            if (y+68>H-20) { y=addPage(); y+=2; }
            try {
              const img = new Image();
              await new Promise(res=>{img.onload=res;img.onerror=res;img.src=foto.dataUrl;});
              const ratio = img.naturalWidth/(img.naturalHeight||1);
              const mW=Math.min(CW-16,100), mH=58;
              let iW=mW, iH=mW/ratio;
              if(iH>mH){iH=mH;iW=mH*ratio;}
              doc.addImage(foto.dataUrl, foto.dataUrl.startsWith('data:image/png')?'PNG':'JPEG', ML+(CW-iW)/2, y, iW, iH);
              y+=iH+2;
            } catch(e) {}
            doc.setFont('helvetica','italic'); doc.setFontSize(7.5); doc.setTextColor(...C.mg);
            const cap = 'Fig. '+(i+1)+(foto.caption?': '+foto.caption:'');
            for(const l of doc.splitTextToSize(cap,CW)){ doc.text(l,W/2,y,{align:'center'}); y+=4; }
            y+=4;
          }
        }
        y+=4;
      }
    }

    // ── GENERAL PHOTOS ──
    if (data.fotos?.length) {
      P(70,'Fotos generales...');
      y = addPage();
      y = secTitle('6. Registro Fotográfico General', y);
      y+=4;
      for (let i=0; i<data.fotos.length; i++) {
        const foto = data.fotos[i];
        if(y+68>H-20){ y=addPage(); y+=4; }
        try {
          const img = new Image();
          await new Promise(res=>{img.onload=res;img.onerror=res;img.src=foto.dataUrl;});
          const ratio=img.naturalWidth/(img.naturalHeight||1);
          const mH=62, mW=CW-8;
          let iW=mW, iH=mW/ratio;
          if(iH>mH){iH=mH;iW=mH*ratio;}
          doc.addImage(foto.dataUrl, foto.dataUrl.startsWith('data:image/png')?'PNG':'JPEG', ML+(CW-iW)/2, y, iW, iH);
          y+=iH+2;
        } catch(e) {}
        doc.setFont('helvetica','italic'); doc.setFontSize(7.5); doc.setTextColor(...C.mg);
        const cap='Figura '+(i+1)+(foto.caption?': '+foto.caption:'');
        for(const l of doc.splitTextToSize(cap,CW)){ doc.text(l,W/2,y,{align:'center'}); y+=4; }
        y+=5;
      }
    }

    // ── SIGNATURES ──
    P(77,'Firmas...');
    if(y+60>H-20) y=addPage();
    else y+=8;
    doc.setFillColor(...C.lgt); doc.roundedRect(ML,y,CW,20,2,2,'F');
    doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(...C.dg);
    const closing = 'Reporte generado automáticamente por AveSampler el '+new Date().toLocaleDateString('es-CO')+'. Muestreo realizado el '+dateStr+' en '+(data.ubicacion||'ubicación no registrada')+'.';
    doc.splitTextToSize(closing,CW-6).forEach((l,i)=>doc.text(l,ML+3,y+7+i*5));
    y+=28;
    const sigY=y+18;
    [[data.observador||'Observador','Observador de campo'],[data.autor||'Investigador','Investigador principal']].forEach(([nm,rol],i)=>{
      const x=i===0?ML:ML+CW/2+5;
      doc.setDrawColor(...C.mg); doc.setLineWidth(.35); doc.line(x,sigY,x+CW/2-10,sigY);
      doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor(...C.tx); doc.text(nm,x,sigY+5);
      doc.setFont('helvetica','italic'); doc.setFontSize(7); doc.setTextColor(...C.gr); doc.text(rol,x,sigY+10);
    });
    return doc;
  },

  // ── LaTeX fill ───────────────────────────────────────────────
  fillLatex(data, tpl) {
    const dateStr = new Date((data.fecha||new Date().toISOString().split('T')[0])+'T12:00:00')
      .toLocaleDateString('es-CO',{year:'numeric',month:'long',day:'numeric'});
    const coords  = (data.latitud&&data.longitud)?data.latitud+', '+data.longitud:'No registradas';
    const allPhotos = [...(data.fotos||[]),...data.especies.flatMap(sp=>sp.fotos||[])];
    const rows = data.especies.length
      ? data.especies.map(sp=>`  ${App.ltx(sp.nombre)} & ${sp.count} & ${App.ltx(sp.behavior)} & ${App.ltx(sp.sex)} & ${App.ltx(sp.notes)} \\\\`).join('\n  \\hline\n')
      : '  \\textit{Sin registros} & — & — & — & — \\\\';
    const photos = allPhotos.length
      ? allPhotos.map((p,i)=>`\\begin{figure}[h!]\n\\centering\n\\includegraphics[width=0.75\\textwidth]{imagenes/${p.name}}\n\\caption{${App.ltx(p.caption||'Fotografía '+(i+1))}}\n\\end{figure}`).join('\n\n')
      : '% Sin fotografías';
    const vars = {
      '{{nombre_proyecto}}':App.ltx(data.nombre_proyecto),'{{fecha}}':App.ltx(dateStr),'{{fecha_raw}}':data.fecha,
      '{{autor}}':App.ltx(data.autor||'No especificado'),'{{institucion}}':App.ltx(data.institucion||'No especificada'),
      '{{ubicacion}}':App.ltx(data.ubicacion),'{{coordenadas}}':coords,
      '{{altitud}}':data.altitud?data.altitud+' m.s.n.m.':'No registrada',
      '{{ecosistema}}':App.ltx(data.ecosistema||'No especificado'),'{{clima}}':App.ltx(data.clima||'No registrado'),
      '{{temperatura}}':data.temperatura?data.temperatura+'°C':'No registrada',
      '{{metodo}}':App.ltx(data.metodo||'No especificado'),'{{duracion}}':data.duracion?data.duracion+' minutos':'No registrada',
      '{{hora_inicio}}':data.hora_inicio||'No registrada','{{hora_fin}}':data.hora_fin||'No registrada',
      '{{observador}}':App.ltx(data.observador||'No especificado'),
      '{{notas_generales}}':App.ltx(data.notas_generales||'Sin observaciones.'),
      '{{total_especies}}':String(data.especies.length),
      '{{total_individuos}}':String(data.especies.reduce((s,e)=>s+parseInt(e.count||0),0)),
      '{{total_fotos}}':String(allPhotos.length),
      '{{tabla_especies}}':rows,'{{fotografias}}':photos,
    };
    let tex = tpl;
    Object.entries(vars).forEach(([k,v])=>{ tex=tex.split(k).join(v); });
    return tex;
  },
  ltx(s){
    if(!s) return '';
    return String(s).replace(/\\/g,'\\textbackslash{}').replace(/&/g,'\\&').replace(/%/g,'\\%')
      .replace(/\$/g,'\\$').replace(/#/g,'\\#').replace(/_/g,'\\_')
      .replace(/\{/g,'\\{').replace(/\}/g,'\\}').replace(/~/g,'\\textasciitilde{}').replace(/\^/g,'\\textasciicircum{}');
  },

  // ── README ───────────────────────────────────────────────────
  readme(data, base) {
    return `AveSampler — Instrucciones\n==========================\nProyecto : ${data.nombre_proyecto}\nFecha    : ${data.fecha}\n\nARCHIVOS\n--------\n${base}.pdf        — Reporte completo (listo)\n${base}.tex        — Fuente LaTeX editable\n${base}_datos.json — Datos del registro\nimagenes/          — Fotografías del muestreo\n\nCOMPILAR EL .TEX\n----------------\npdflatex ${base}.tex\n\nO en Overleaf: https://overleaf.com → Subir ZIP\n\nAveSampler © ${new Date().getFullYear()}\n`;
  },

  // ── Records / History ────────────────────────────────────────
  saveRecord(data, base) {
    const rec = {
      id: data.id, base,
      nombre_proyecto: data.nombre_proyecto, fecha: data.fecha,
      template: data.template, autor: data.autor, ubicacion: data.ubicacion,
      total_especies: data.especies.length,
      total_fotos: data.fotos.length + data.especies.reduce((s,sp)=>s+(sp.fotos?.length||0),0),
      created_at: data.created_at,
      data: {
        ...data,
        fotos: data.fotos.map(f=>({name:f.name,caption:f.caption,dataUrl:f.dataUrl})),
        especies: data.especies.map(sp=>({...sp,fotos:(sp.fotos||[]).map(f=>({name:f.name,caption:f.caption,dataUrl:f.dataUrl}))}))
      }
    };
    S.records.unshift(rec);
    if (S.records.length > 20) S.records = S.records.slice(0,20);
    try {
      const json = JSON.stringify(S.records);
      if (json.length < 4*1024*1024) { localStorage.setItem('avesampler_records',json); }
      else {
        const light = S.records.map((r,i)=> i===0?r:{...r, data:{...r.data, fotos:[], especies:r.data.especies?.map(sp=>({...sp,fotos:[]}))||[]}});
        localStorage.setItem('avesampler_records',JSON.stringify(light));
      }
    } catch(e) {}
    App.renderRecords();
  },
  renderRecords() {
    const list  = document.getElementById('records-list');
    const empty = document.getElementById('records-empty');
    list.querySelectorAll('.rec-item').forEach(el=>el.remove());
    if (!S.records.length) { if(empty) empty.style.display='flex'; return; }
    if (empty) empty.style.display='none';
    S.records.forEach((rec,idx)=>{
      const item = document.createElement('div');
      item.className = 'rec-item'; item.id = 'rec-'+idx;
      item.innerHTML = `
        <div class="rec-item-head" onclick="App.toggleRec(${idx})">
          <div class="rec-info">
            <strong>${App.esc(rec.nombre_proyecto)}</strong>
            <span>${rec.fecha} · ${rec.total_especies} esp. · ${rec.total_fotos} fotos</span>
          </div>
          <svg class="rec-chevron" viewBox="0 0 20 20" fill="none"><path d="M5 8l5 5 5-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
        <div class="rec-actions">
          <button class="rec-dl-btn" onclick="App.reDownload(${idx},'pdf')"><span class="fbadge pdf">PDF</span> Descargar PDF</button>
          <button class="rec-dl-btn" onclick="App.reDownload(${idx},'zip')"><span class="fbadge zip">ZIP</span> Descargar ZIP completo</button>
          <button class="rec-dl-btn" onclick="App.reDownload(${idx},'json')"><span class="fbadge json">JSON</span> Datos JSON</button>
          <button class="rec-del-btn" onclick="App.deleteRec(${idx})">🗑 Eliminar este registro</button>
        </div>`;
      list.insertBefore(item, empty);
    });
  },
  toggleRec(idx) {
    const el = document.getElementById('rec-'+idx);
    if (el) el.classList.toggle('open');
  },
  async reDownload(idx, type) {
    const rec = S.records[idx];
    if (!rec) return;
    UI.toast('Generando descarga...','');
    try {
      if (type === 'json') {
        const d = { ...rec.data, fotos:(rec.data.fotos||[]).map(f=>({name:f.name,caption:f.caption})), especies:(rec.data.especies||[]).map(sp=>({...sp,fotos:(sp.fotos||[]).map(f=>({name:f.name,caption:f.caption}))})) };
        App.trigger(new Blob([JSON.stringify(d,null,2)],{type:'application/json'}), rec.base+'_datos.json');
        return;
      }
      const pdfDoc  = await App.buildPDF(rec.data, ()=>{});
      const pdfBlob = pdfDoc.output('blob');
      if (type === 'pdf') { App.trigger(pdfBlob, rec.base+'.pdf'); UI.toast('✓ PDF descargado','success'); return; }
      const zip = new JSZip(), folder = zip.folder(rec.base);
      folder.file(rec.base+'.pdf', pdfBlob);
      const imgF = folder.folder('imagenes');
      const allPh = [...(rec.data.fotos||[]),...(rec.data.especies||[]).flatMap(sp=>sp.fotos||[])];
      for (const f of allPh) { if(f.dataUrl) imgF.file(f.name, f.dataUrl.split(',')[1], {base64:true}); }
      folder.file(rec.base+'_datos.json', JSON.stringify(rec.data,null,2));
      const zipBlob = await zip.generateAsync({type:'blob',compression:'DEFLATE'});
      App.trigger(zipBlob, rec.base+'.zip');
      UI.toast('✓ ZIP descargado','success');
    } catch(e) { UI.toast('Error: '+e.message,'error'); }
  },
  deleteRec(idx) {
    if (!confirm('¿Eliminar este registro del historial?')) return;
    S.records.splice(idx,1);
    try { localStorage.setItem('avesampler_records',JSON.stringify(S.records)); } catch(e) {}
    App.renderRecords();
  },
  exportAllJSON() {
    if (!S.records.length) { UI.toast('No hay registros guardados','error'); return; }
    const d = S.records.map(r=>({ id:r.id, base:r.base, nombre_proyecto:r.nombre_proyecto, fecha:r.fecha, template:r.template, autor:r.autor, ubicacion:r.ubicacion, total_especies:r.total_especies, total_fotos:r.total_fotos, created_at:r.created_at }));
    App.trigger(new Blob([JSON.stringify(d,null,2)],{type:'application/json'}), 'avesampler_historial_'+new Date().toISOString().split('T')[0]+'.json');
  },

  // ── New record (full reset) ───────────────────────────────────
  newRecord() {
    UI.closeDLModal();
    S.tpl='aves_estandar'; S.spCount=0; S.spData={}; S.genPhotos=[]; S.curFiles=null;
    const clr=(id,v='')=>{const e=document.getElementById(id);if(e)e.value=v;};
    clr('f-name');clr('f-date',new Date().toISOString().split('T')[0]);
    clr('f-author');clr('f-inst');clr('f-loc');clr('f-lat');clr('f-lon');clr('f-alt');
    clr('f-eco');clr('f-wx');clr('f-temp');clr('f-method');clr('f-dur');
    clr('f-ts');clr('f-te');clr('f-obs');clr('f-notes');
    document.querySelectorAll('.tpl-card').forEach(c=>c.classList.remove('sel'));
    const dc = document.querySelector('[data-v="aves_estandar"]');
    if(dc) dc.classList.add('sel');
    document.getElementById('species-list').innerHTML='';
    App.renderGenGrid();
    const btn=document.getElementById('btn-gen');
    if(btn){btn.disabled=false;btn.style.opacity='1';}
    App.addSpecies();
    App.goSec('sec-template');
  },

  // ── PWA install ──────────────────────────────────────────────
  async installPWA() {
    if (!S.deferredInstall) { UI.toast('Usa "Agregar a inicio" en tu navegador',''); return; }
    S.deferredInstall.prompt();
    const { outcome } = await S.deferredInstall.userChoice;
    if (outcome==='accepted') { S.deferredInstall=null; document.getElementById('btn-install').style.display='none'; }
  },
  updateOnline() {
    const b=document.getElementById('offline-badge');
    if(b) b.style.display=navigator.onLine?'none':'inline';
  },

  // ── Draft ────────────────────────────────────────────────────
  saveDraft() {
    try {
      const g=id=>(document.getElementById(id)?.value||'');
      localStorage.setItem('avesampler_draft', JSON.stringify({
        template:S.tpl, f_name:g('f-name'),f_date:g('f-date'),f_author:g('f-author'),f_inst:g('f-inst'),
        f_loc:g('f-loc'),f_lat:g('f-lat'),f_lon:g('f-lon'),f_alt:g('f-alt'),f_eco:g('f-eco'),
        f_wx:g('f-wx'),f_temp:g('f-temp'),f_method:g('f-method'),f_dur:g('f-dur'),
        f_ts:g('f-ts'),f_te:g('f-te'),f_obs:g('f-obs'),f_notes:g('f-notes'),
      }));
    } catch(e) {}
  },

  // ── Utilities ────────────────────────────────────────────────
  delay: ms => new Promise(r=>setTimeout(r,ms)),
  esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); },
};
