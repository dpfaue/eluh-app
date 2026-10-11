/* ELUH App – Oberfläche */
(function () {
  'use strict';
  var S = window.Store;
  var view = document.getElementById('view');
  var modal = document.getElementById('modal');

  // ------------------------------------------------------------------
  // Hilfen
  // ------------------------------------------------------------------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function pad(n) { return String(n).padStart(2, '0'); }
  function fmtDate(ms) { if (!ms) return ''; var d = new Date(ms); return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear(); }
  function fmtTime(ms) { var d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function fmtDT(ms) { if (!ms) return '–'; var d = new Date(ms); var today = new Date(); var same = d.toDateString() === today.toDateString(); return (same ? 'heute ' : fmtDate(ms) + ' ') + fmtTime(ms); }
  function isoToDe(iso) { return window.PdfGen.fmtDate(iso); }
  function fmtSize(b) { if (!b) return ''; if (b < 1024) return b + ' B'; if (b < 1048576) return Math.round(b / 1024) + ' KB'; return (b / 1048576).toFixed(1).replace('.', ',') + ' MB'; }
  function debounce(fn, ms) { var t; return function () { var a = arguments, self = this; clearTimeout(t); t = setTimeout(function () { fn.apply(self, a); }, ms); }; }
  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss'); }
  function matchQuery(text, q) {
    if (!q) return true;
    var t = norm(text);
    return norm(q).split(/\s+/).filter(Boolean).every(function (w) { return t.indexOf(w) >= 0; });
  }
  function parseCustomer(folderName) {
    var parts = String(folderName || '').split(',').map(function (p) { return p.trim(); }).filter(Boolean);
    return { name: parts[0] || '', address: parts.slice(1).join(', '), ort: parts.length > 1 ? parts[parts.length - 1] : '' };
  }
  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }
  function isSafariDesktop() { return /^((?!chrome|chromium|android|crios|fxios|edg).)*safari/i.test(navigator.userAgent) && !isIOS(); }

  var ICONS = {
    folder: '<svg viewBox="0 0 24 24"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" fill="currentColor" opacity=".9"/></svg>',
    file: '<svg viewBox="0 0 24 24"><path d="M7 3h7l5 5v13H7z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M14 3v5h5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
    pdf: '<svg viewBox="0 0 24 24"><path d="M7 3h7l5 5v13H7z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9.5 15.5h5M9.5 12h5M9.5 18.5h3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    img: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="9" cy="10" r="1.6" fill="currentColor"/><path d="M5 17l5-5 4 4 2-2 3 3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
    doc: '<svg viewBox="0 0 24 24"><path d="M7 3h7l5 5v13H7z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M10 13h6M10 17h6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 16l4.5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    chev: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
    print: '<svg viewBox="0 0 24 24"><path d="M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
    close: '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
    upload: '<svg viewBox="0 0 24 24"><path d="M12 16V4m0 0l-5 5m5-5l5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };
  function fileIcon(item) {
    if (item.folder) return '<span class="ico folder">' + ICONS.folder + '</span>';
    var m = item.mime || '';
    if (m === 'application/pdf') return '<span class="ico pdf">' + ICONS.pdf + '</span>';
    if (m.indexOf('image/') === 0) return '<span class="ico img">' + ICONS.img + '</span>';
    if (m.indexOf('application/vnd.google-apps') === 0) return '<span class="ico">' + ICONS.doc + '</span>';
    return '<span class="ico">' + ICONS.file + '</span>';
  }

  function toast(msg, isErr) {
    var t = document.createElement('div');
    t.className = 'toast' + (isErr ? ' err' : '');
    t.textContent = msg;
    document.getElementById('toasts').appendChild(t);
    setTimeout(function () { t.remove(); }, isErr ? 6000 : 3200);
  }

  // ------------------------------------------------------------------
  // Modal
  // ------------------------------------------------------------------
  var modalCleanup = null;
  function openModal(html, opts) {
    opts = opts || {};
    closeModal();
    modal.innerHTML = '<div class="sheet' + (opts.full ? ' full' : '') + '" role="dialog" aria-modal="true">' + html + '</div>';
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    modal.onclick = function (e) { if (e.target === modal && !opts.sticky) closeModal(); };
    $$('[data-close]', modal).forEach(function (b) { b.onclick = closeModal; });
    modalCleanup = opts.onClose || null;
    return modal.firstChild;
  }
  function closeModal() {
    if (modal.hidden) return;
    modal.hidden = true;
    modal.innerHTML = '';
    document.body.style.overflow = '';
    if (modalCleanup) { var f = modalCleanup; modalCleanup = null; f(); }
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });

  function confirmBox(title, text, okLabel, danger) {
    return new Promise(function (resolve) {
      var done = false;
      var sheet = openModal(
        '<div class="sheet-head"><h3>' + esc(title) + '</h3></div>' +
        '<div class="sheet-body"><p style="margin-top:0">' + esc(text) + '</p>' +
        '<div class="btn-row" style="justify-content:flex-end"><button class="btn ghost" data-no>Abbrechen</button>' +
        '<button class="btn ' + (danger ? 'danger' : 'primary') + '" data-yes>' + esc(okLabel || 'OK') + '</button></div></div>',
        { onClose: function () { if (!done) resolve(false); } });
      $('[data-no]', sheet).onclick = function () { done = true; closeModal(); resolve(false); };
      $('[data-yes]', sheet).onclick = function () { done = true; closeModal(); resolve(true); };
    });
  }

  // ------------------------------------------------------------------
  // PDF-Anzeige & Drucken
  // ------------------------------------------------------------------
  var pdfjsReady = null;
  function loadPdfJs() {
    if (pdfjsReady) return pdfjsReady;
    pdfjsReady = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'pdf.min.js';
      s.onload = function () {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdf.worker.min.js';
        resolve(window.pdfjsLib);
      };
      s.onerror = function () { pdfjsReady = null; reject(new Error('PDF-Anzeige konnte nicht geladen werden')); };
      document.head.appendChild(s);
    });
    return pdfjsReady;
  }

  async function renderPdfInto(container, bytes) {
    var lib = await loadPdfJs();
    var pdf = await lib.getDocument({ data: bytes.slice ? bytes.slice(0) : bytes }).promise;
    container.innerHTML = '';
    var width = Math.min(container.clientWidth - 24, 900);
    var dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    for (var i = 1; i <= pdf.numPages; i++) {
      var page = await pdf.getPage(i);
      var vp1 = page.getViewport({ scale: 1 });
      var scale = width / vp1.width;
      var vp = page.getViewport({ scale: scale * dpr });
      var canvas = document.createElement('canvas');
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      canvas.style.width = Math.floor(vp.width / dpr) + 'px';
      container.appendChild(canvas);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
      if (!document.body.contains(container)) return;
    }
  }

  /** Drucken/Teilen: iPhone/iPad → Teilen-Menü (enthält "Drucken"), Mac/PC → Druckdialog bzw. neuer Tab */
  async function printBlob(blob, name) {
    var file = new File([blob], name, { type: blob.type || 'application/pdf' });
    if (isIOS() && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); } catch (e) { /* abgebrochen */ }
      return;
    }
    var url = URL.createObjectURL(blob);
    if (isSafariDesktop() || blob.type !== 'application/pdf') {
      var w = window.open(url, '_blank');
      if (!w) downloadBlob(blob, name);
      return;
    }
    var frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0';
    frame.src = url;
    frame.onload = function () {
      try { frame.contentWindow.focus(); frame.contentWindow.print(); }
      catch (e) { window.open(url, '_blank'); }
      setTimeout(function () { frame.remove(); }, 60000);
    };
    document.body.appendChild(frame);
  }

  function downloadBlob(blob, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { a.remove(); }, 1000);
  }

  /** Großer Viewer für PDFs/Bilder */
  function openViewer(title, opts) {
    var sheet = openModal(
      '<div class="sheet-head"><h3>' + esc(title) + '</h3>' +
      '<button class="btn small" data-print hidden>' + ICONS.print + '<span>' + (isIOS() ? 'Teilen / Drucken' : 'Drucken') + '</span></button>' +
      '<button class="btn small ghost" data-dl hidden>Sichern</button>' +
      (opts && opts.driveUrl ? '<a class="btn small ghost" target="_blank" rel="noopener" href="' + esc(opts.driveUrl) + '">Drive</a>' : '') +
      '<button class="btn small ghost" data-close aria-label="Schließen">' + ICONS.close + '</button></div>' +
      '<div class="sheet-body viewer-body"><div class="msg"><span class="spinner"></span> Wird geladen…</div></div>', { full: true });
    var body = $('.viewer-body', sheet);
    return {
      sheet: sheet,
      body: body,
      show: async function (blob, name) {
        var pb = $('[data-print]', sheet), db = $('[data-dl]', sheet);
        pb.hidden = false; db.hidden = isIOS();
        pb.onclick = function () { printBlob(blob, name); };
        db.onclick = function () { downloadBlob(blob, name); };
        var type = blob.type || '';
        if (type === 'application/pdf') {
          var bytes = new Uint8Array(await blob.arrayBuffer());
          try { await renderPdfInto(body, bytes); }
          catch (e) { body.innerHTML = '<div class="msg">PDF kann hier nicht angezeigt werden – über „Drucken/Sichern“ öffnen.</div>'; }
        } else if (type.indexOf('image/') === 0) {
          var img = new Image();
          img.src = URL.createObjectURL(blob);
          img.alt = name;
          body.innerHTML = '';
          body.appendChild(img);
        } else {
          body.innerHTML = '<div class="msg">Vorschau für diesen Dateityp nicht möglich.<br>Über „' + (isIOS() ? 'Teilen' : 'Sichern') + '“ öffnen.</div>';
          if (isIOS()) pb.querySelector('span').textContent = 'Öffnen / Teilen';
        }
      },
      fail: function (msg) { body.innerHTML = '<div class="msg">' + esc(msg) + '</div>'; }
    };
  }

  async function showAuftragPdf(recs) {
    var title = recs.length === 1 ? auftragTitle(recs[0]) : recs.length + ' Arbeitsaufträge';
    var v = openViewer(title, { driveUrl: recs.length === 1 && recs[0].drive && recs[0].drive.url });
    try {
      var bytes = recs.length === 1 ? await window.PdfGen.build(recs[0]) : await window.PdfGen.merge(recs);
      var name = recs.length === 1 ? window.PdfGen.fileName(recs[0]) : 'Arbeitsauftraege-' + S.isoDate(new Date()) + '.pdf';
      await v.show(new Blob([bytes], { type: 'application/pdf' }), name);
    } catch (e) {
      v.fail('PDF konnte nicht erzeugt werden: ' + e.message);
    }
  }

  async function openDriveFile(item) {
    var v = openViewer(item.name, { driveUrl: item.local ? null : 'https://drive.google.com/file/d/' + item.id + '/view' });
    try {
      var rec = await S.Files.load(item.id, item);
      var blob = rec.blob instanceof Blob ? rec.blob : new Blob([rec.blob], { type: rec.mime });
      if (!blob.type && rec.mime) blob = new Blob([blob], { type: rec.mime });
      await v.show(blob, rec.name || item.name);
    } catch (e) {
      v.fail(e.offline ? 'Diese Datei ist nicht offline gespeichert. Sie wird geladen, sobald wieder Internet da ist (oder Kunde auf „Offline verfügbar“ stellen).' : 'Datei konnte nicht geladen werden: ' + e.message);
    }
  }

  // ------------------------------------------------------------------
  // Sync-Anzeige
  // ------------------------------------------------------------------
  async function renderSyncPill() {
    var pill = document.getElementById('syncPill');
    var st = S.Sync.state;
    var s = await S.Settings.get();
    var cls = 'ok', text;
    if (!S.backendConfigured()) { cls = 'warn'; text = 'Nur lokal'; }
    else if (!s.key) { cls = 'warn'; text = 'Nicht verbunden'; }
    else if (st.running) { cls = 'run'; text = 'Synchronisiere…'; }
    else if (!navigator.onLine || st.offline) { cls = st.pending ? 'warn' : ''; text = 'Offline' + (st.pending ? ' · ' + st.pending + ' wartend' : ''); }
    else if (st.error) { cls = 'err'; text = 'Sync-Fehler'; }
    else if (st.pending) { cls = 'warn'; text = st.pending + ' wartend'; }
    else { text = 'Synchron' + (st.lastOk ? ' · ' + fmtTime(st.lastOk) : ''); }
    pill.className = 'sync-pill ' + cls;
    pill.innerHTML = '<span class="dot"></span><span>' + esc(text) + '</span>';
  }
  document.getElementById('syncPill').onclick = function () {
    if (location.hash.indexOf('#/sync') === 0) S.Sync.run(); else location.hash = '#/sync';
  };

  // ------------------------------------------------------------------
  // Router
  // ------------------------------------------------------------------
  var current = { name: null, cleanup: null };
  var routes = [];
  function route(re, fn, tab) { routes.push({ re: re, fn: fn, tab: tab }); }

  async function router() {
    var hash = location.hash || '#/auftraege';
    var s = await S.Settings.get();
    if (S.backendConfigured() && !s.key && !s.skipSetup && hash.indexOf('#/setup') !== 0) {
      location.replace('#/setup');
      return;
    }
    for (var i = 0; i < routes.length; i++) {
      var m = routes[i].re.exec(hash);
      if (m) {
        if (current.cleanup) { try { current.cleanup(); } catch (e) { /* */ } }
        current = { name: routes[i].tab, cleanup: null, params: m };
        $$('[data-tab]').forEach(function (a) { a.classList.toggle('active', a.getAttribute('data-tab') === routes[i].tab); });
        closeModal();
        window.scrollTo(0, 0);
        try { await routes[i].fn.apply(null, m.slice(1).map(decodeURIComponent)); }
        catch (e) { console.error(e); view.innerHTML = '<div class="notice err">Fehler: ' + esc(e.message) + '</div>'; }
        return;
      }
    }
    location.replace('#/auftraege');
  }
  window.addEventListener('hashchange', router);

  function onCleanup(fn) { var prev = current.cleanup; current.cleanup = function () { if (prev) prev(); fn(); }; }
  /** Bei Datenänderungen die aktuelle Ansicht neu zeichnen (nur solange sie offen ist) */
  function rerenderOn(events, fn) {
    var token = current;
    var handler = debounce(function () { if (current === token) fn(); }, 250);
    var offs = events.map(function (ev) { return S.on(ev, handler); });
    onCleanup(function () { offs.forEach(function (off) { off(); }); });
  }

  // ------------------------------------------------------------------
  // Einrichtung (App-Schlüssel)
  // ------------------------------------------------------------------
  route(/^#\/setup(?:\?.*)?$/, async function () {
    view.innerHTML =
      '<div class="setup card pad stack">' +
      '<img class="logo" src="logo.png" alt="eluh Anlagen Kyritz">' +
      '<h1 style="margin:0;font-size:22px">Mit Google Drive verbinden</h1>' +
      '<p class="muted" style="margin:0">Einmal pro Gerät den App-Schlüssel eingeben. Danach synchronisiert sich alles automatisch – auch nach Offline-Phasen.</p>' +
      '<label class="field"><span>App-Schlüssel</span><input class="key-input" id="keyIn" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX-XXXX"></label>' +
      '<div id="setupMsg"></div>' +
      '<div class="btn-row"><button class="btn primary" id="keyGo">Verbinden</button>' +
      '<button class="btn ghost" id="keySkip">Erstmal ohne Verbindung</button></div></div>';
    var m = /[#&?]k=([A-Za-z0-9-]+)/.exec(location.href);
    if (m) $('#keyIn').value = m[1];
    $('#keyGo').onclick = async function () {
      var key = $('#keyIn').value.trim();
      if (!key) return;
      var btn = this;
      btn.disabled = true;
      $('#setupMsg').innerHTML = '<div class="notice info"><span class="spinner"></span> Verbindung wird geprüft…</div>';
      try {
        await S.api('ping', {}, { key: key, timeout: 30000 });
        await S.Settings.set({ key: key, skipSetup: false });
        S.Sync.state.authError = false;
        toast('Verbunden – Kundendatenbank wird geladen');
        location.hash = '#/auftraege';
        S.Sync.run({ fullIndex: true });
      } catch (e) {
        $('#setupMsg').innerHTML = '<div class="notice err">' + esc(e.auth ? 'Schlüssel stimmt nicht.' : e.message) + '</div>';
      } finally { btn.disabled = false; }
    };
    $('#keySkip').onclick = async function () {
      await S.Settings.set({ skipSetup: true });
      location.hash = '#/auftraege';
    };
  }, 'sync');

  // ------------------------------------------------------------------
  // Aufträge – Übersicht
  // ------------------------------------------------------------------
  var listState = { q: '', filter: 'alle', range: 'alle', sel: new Set() };

  async function auftragStatus(rec, ops) {
    var pending = ops.some(function (o) { return o.type === 'fileAuftrag' && o.auftragId === rec.id; });
    if (rec.status !== 'fertig') return { cls: 'grey', text: 'Entwurf', key: 'entwurf' };
    if (pending || !rec.drive) return { cls: 'warn', text: 'Wird abgelegt', key: 'offen' };
    if (rec.needsRefile) return { cls: 'warn', text: 'Geändert', key: 'offen' };
    if (!rec.customerId) return { cls: 'info', text: 'Ohne Kunde', key: 'fertig' };
    return { cls: 'ok', text: 'Abgelegt', key: 'fertig' };
  }
  function auftragTitle(r) { return (r.f && r.f.kunde_name) || r.customerName || 'Ohne Kunde'; }
  function auftragDate(r) { return (r.ablage && r.ablage.datum) || (r.f && r.f.datum_annahme) || S.isoDate(new Date(r.createdAt)); }

  route(/^#\/auftraege$/, async function () {
    view.innerHTML =
      '<div class="page-head"><h1>Arbeitsaufträge</h1>' +
      '<a class="btn primary" href="#/auftrag/neu">' + ICONS.plus + '<span>Neuer Auftrag</span></a></div>' +
      '<div class="stack">' +
      '<label class="search"><span class="sr" hidden>Suchen</span>' + ICONS.search + '<input class="input" id="q" type="search" placeholder="Kunde, Nr., Art, Text…" value="' + esc(listState.q) + '"></label>' +
      '<div class="chips" id="filters"></div>' +
      '<div id="list"></div></div>' +
      '<div class="actionbar selbar" id="selbar" hidden></div>';
    var filters = [['alle', 'Alle'], ['entwurf', 'Entwürfe'], ['offen', 'Noch nicht abgelegt'], ['fertig', 'Abgelegt']];
    var ranges = [['alle', 'Gesamter Zeitraum'], ['heute', 'Heute'], ['7', '7 Tage'], ['30', '30 Tage']];
    function drawChips() {
      $('#filters').innerHTML = filters.map(function (f) {
        return '<button class="chip' + (listState.filter === f[0] ? ' on' : '') + '" data-f="' + f[0] + '">' + f[1] + '</button>';
      }).join('') + '<span style="width:8px"></span>' + ranges.map(function (f) {
        return '<button class="chip' + (listState.range === f[0] ? ' on' : '') + '" data-r="' + f[0] + '">' + f[1] + '</button>';
      }).join('');
      $$('#filters [data-f]').forEach(function (b) { b.onclick = function () { listState.filter = b.getAttribute('data-f'); drawChips(); draw(); }; });
      $$('#filters [data-r]').forEach(function (b) { b.onclick = function () { listState.range = b.getAttribute('data-r'); drawChips(); draw(); }; });
    }
    var visible = [];
    var me = current;
    async function draw() {
      var list = await S.Auftraege.all();
      var ops = await S.Outbox.all();
      if (current !== me || !$('#list')) return;
      var today = S.isoDate(new Date());
      var minDate = listState.range === 'alle' ? '' : listState.range === 'heute' ? today : S.isoDate(new Date(Date.now() - Number(listState.range) * 864e5));
      var rows = [];
      for (var i = 0; i < list.length; i++) {
        var r = list[i];
        var st = await auftragStatus(r, ops);
        if (listState.filter !== 'alle' && st.key !== listState.filter) continue;
        if (minDate && auftragDate(r) < minDate) continue;
        var f = r.f || {};
        if (!matchQuery([f.kunde_name, f.kunde_name_zusatz, f.kunde_adresse, f.auftrags_nr, f.art, f.arbeitsumfang, r.customerName].join(' '), listState.q)) continue;
        rows.push({ r: r, st: st });
      }
      rows.sort(function (a, b) { var d = auftragDate(b.r).localeCompare(auftragDate(a.r)); return d || b.r.updatedAt - a.r.updatedAt; });
      visible = rows.map(function (x) { return x.r; });
      Array.from(listState.sel).forEach(function (id) { if (!list.some(function (r) { return r.id === id; })) listState.sel.delete(id); });
      if (!rows.length) {
        $('#list').innerHTML = '<div class="list"><div class="empty">' + (list.length ? 'Keine Aufträge für diese Auswahl.' : 'Noch keine Aufträge. Mit „Neuer Auftrag“ geht’s los.') + '</div></div>';
      } else {
        $('#list').innerHTML = '<div class="list">' + rows.map(function (x) {
          var r = x.r, f = r.f || {};
          var meta = [isoToDe(auftragDate(r)), f.art, f.auftrags_nr ? 'Nr. ' + f.auftrags_nr : ''].filter(Boolean).join(' · ');
          return '<div class="row" data-id="' + r.id + '">' +
            '<input type="checkbox" aria-label="Zum Drucken auswählen" ' + (listState.sel.has(r.id) ? 'checked' : '') + '>' +
            '<a class="main" href="#/auftrag/' + r.id + '" style="text-decoration:none;color:inherit"><div class="title">' + esc(auftragTitle(r)) + '</div>' +
            '<div class="meta">' + esc(meta || '–') + '</div></a>' +
            '<span class="badge ' + x.st.cls + '">' + x.st.text + '</span></div>';
        }).join('') + '</div>';
        $$('#list .row').forEach(function (row) {
          var cb = $('input', row);
          cb.onchange = function () {
            var id = row.getAttribute('data-id');
            if (cb.checked) listState.sel.add(id); else listState.sel.delete(id);
            drawSel();
          };
        });
      }
      drawSel();
    }
    function drawSel() {
      var bar = $('#selbar');
      if (!bar) return;
      var n = listState.sel.size;
      bar.hidden = false;
      bar.innerHTML = n ?
        '<span class="small"><b>' + n + '</b> ausgewählt</span><div class="btn-row">' +
        '<button class="btn ghost small" id="selNone">Aufheben</button>' +
        '<button class="btn primary" id="selPrint">' + ICONS.print + '<span>Drucken (' + n + ')</span></button></div>' :
        '<span class="small muted">Zum Drucken Aufträge anhaken</span>' +
        '<button class="btn small" id="selAll"' + (visible.length ? '' : ' disabled') + '>Alle angezeigten wählen</button>';
      if (n) {
        $('#selNone').onclick = function () { listState.sel.clear(); draw(); };
        $('#selPrint').onclick = async function () {
          var all = await S.Auftraege.all();
          var chosen = visible.filter(function (r) { return listState.sel.has(r.id); });
          all.forEach(function (r) { if (listState.sel.has(r.id) && chosen.indexOf(r) < 0 && !chosen.some(function (c) { return c.id === r.id; })) chosen.push(r); });
          showAuftragPdf(chosen);
        };
      } else {
        $('#selAll').onclick = function () { visible.forEach(function (r) { listState.sel.add(r.id); }); draw(); };
      }
    }
    $('#q').oninput = debounce(function () { listState.q = this.value; draw(); }, 200);
    drawChips();
    await draw();
    rerenderOn(['auftraege', 'outbox'], draw);
  }, 'auftraege');

  // ------------------------------------------------------------------
  // Auftrag bearbeiten
  // ------------------------------------------------------------------
  route(/^#\/auftrag\/neu(?:\?kunde=([^&]+))?$/, async function (custId) {
    var rec = S.Auftraege.create();
    if (custId) {
      var idx = await S.Index.load();
      var c = S.Index.item(idx, custId);
      if (c) applyCustomer(rec, c);
    }
    await S.Auftraege.save(rec);
    location.replace('#/auftrag/' + rec.id);
  }, 'auftraege');

  function applyCustomer(rec, c) {
    var p = parseCustomer(c.name);
    rec.customerId = c.id;
    rec.customerName = c.name;
    var f = rec.f;
    if (!f.kunde_name) f.kunde_name = p.name;
    if (!f.kunde_adresse) f.kunde_adresse = p.address;
    var d = isoToDe(S.isoDate(new Date()));
    if (!f.ort_datum && p.ort) f.ort_datum = p.ort + ', ' + d;
    if (!f.datum_fertigstellung && p.ort) f.datum_fertigstellung = p.ort + ', ' + d;
  }

  var ART_PRESETS = ['Wartung', 'Störung', 'Reparatur', 'Montage', 'Inbetriebnahme', 'Abgasmessung'];
  var EINHEITEN = ['Stck.', 'm', 'kg', 'Std.', 'l', 'Psch.'];

  route(/^#\/auftrag\/([\w-]+)$/, async function (id) {
    var rec = await S.Auftraege.get(id);
    if (!rec || rec.deleted) { view.innerHTML = '<div class="notice warn">Auftrag nicht gefunden.</div><p><a href="#/auftraege">Zur Übersicht</a></p>'; return; }
    var idx = await S.Index.load();
    var f = rec.f;
    if (!rec.material || !rec.material.length) rec.material = [{}, {}, {}];
    rec.ablage = rec.ablage || { datum: f.datum_annahme || S.isoDate(new Date()), art: '' };

    function input(key, label, opts) {
      opts = opts || {};
      return '<label class="field"><span>' + label + '</span><input data-f="' + key + '" ' + (opts.type ? 'type="' + opts.type + '"' : '') +
        ' value="' + esc(f[key]) + '"' + (opts.ph ? ' placeholder="' + esc(opts.ph) + '"' : '') + (opts.list ? ' list="' + opts.list + '"' : '') + ' autocomplete="off"></label>';
    }

    view.innerHTML =
      '<div class="page-head"><a class="btn ghost small" href="#/auftraege">‹ Übersicht</a>' +
      '<h1 id="edTitle">' + esc(auftragTitle(rec)) + '</h1><span id="saveState" class="small muted"></span></div>' +
      '<div id="statusBox"></div>' +
      '<div class="card" style="margin-top:12px">' +
      '<section class="form-section"><h3>Arbeitsauftrag</h3><div class="grid2">' +
      input('auftrags_nr', 'Auftrags-Nr.') + input('datum_annahme', 'Datum der Annahme', { type: 'date' }) + '</div></section>' +
      '<section class="form-section"><h3>Auftraggeber</h3><div class="stack">' +
      '<div id="custBox"></div>' +
      input('kunde_name', 'Name / Firma') + input('kunde_name_zusatz', 'Zusatz (z. B. Mieter)', { ph: 'optional' }) + input('kunde_adresse', 'Adresse') +
      '</div></section>' +
      '<section class="form-section"><h3>Auftrag</h3><div class="stack">' +
      input('art', 'Art des Auftrags') +
      '<div class="chips" id="artChips">' + ART_PRESETS.map(function (a) { return '<button type="button" class="chip" data-art="' + a + '">' + a + '</button>'; }).join('') + '</div>' +
      '<label class="field"><span>Arbeitsumfang / Ausgeführte Arbeiten</span><textarea data-f="arbeitsumfang" rows="8">' + esc(f.arbeitsumfang) + '</textarea></label>' +
      input('ort_datum', 'Ort, Datum') +
      '</div></section>' +
      '<section class="form-section"><h3>Materialschein</h3>' +
      '<div class="mat-row mat-head"><span>Artikel-Nr.</span><span>Bezeichnung</span><span>Stck./m/kg</span><span>Menge</span><span>Einzelpreis €</span><span>Gesamtpreis €</span><span></span></div>' +
      '<div id="matRows"></div>' +
      '<div class="btn-row" style="margin-top:8px"><button type="button" class="btn small" id="addRow">' + ICONS.plus + '<span>Position</span></button></div>' +
      '<div class="grid2" style="margin-top:14px">' + input('mat_gesamt_summe', 'Gesamt Material') + input('datum_fertigstellung', 'Ort, Datum (Materialschein)') + '</div>' +
      '<datalist id="einheiten">' + EINHEITEN.map(function (e) { return '<option value="' + e + '">'; }).join('') + '</datalist>' +
      '</section>' +
      '<section class="form-section"><h3>Ablage in der Kundendatenbank</h3><div class="stack">' +
      '<div class="grid2"><label class="field"><span>Termin-Datum (Ordner)</span><input type="date" data-ablage="datum" value="' + esc(rec.ablage.datum) + '"></label>' +
      '<label class="field"><span>Art (Ordnername)</span><input data-ablage="art" value="' + esc(rec.ablage.art) + '" placeholder="wie „Art des Auftrags“"></label></div>' +
      '<div class="path" id="pathPreview"></div></div></section>' +
      '</div>' +
      '<div class="btn-row" id="edExtra" style="justify-content:center;margin-top:14px"></div>' +
      '<div class="actionbar" id="edActions"></div>';

    // ---- Kunde ----
    function drawCustomer() {
      var box = $('#custBox');
      if (rec.customerId) {
        var c = S.Index.item(idx, rec.customerId);
        box.innerHTML = '<div class="customer-chip">' + ICONS.folder.replace('<svg', '<svg width="20" height="20"') +
          '<span class="name">' + esc(c ? c.name : rec.customerName || 'Kunde') + '</span>' +
          '<button type="button" class="btn small ghost" id="custChange">Ändern</button>' +
          '<button type="button" class="btn small ghost" id="custRemove" aria-label="Kunde entfernen">' + ICONS.close + '</button></div>';
        $('#custChange').onclick = pickCustomer;
        $('#custRemove').onclick = function () { rec.customerId = null; rec.customerName = ''; markChanged(); drawCustomer(); drawPath(); };
      } else {
        box.innerHTML = '<button type="button" class="btn" id="custPick" style="width:100%">' + ICONS.folder.replace('<svg', '<svg width="18" height="18"') + '<span>Kunde aus Kundendatenbank wählen</span></button>';
        $('#custPick').onclick = pickCustomer;
      }
    }
    function pickCustomer() {
      openCustomerPicker(async function (c) {
        idx = await S.Index.load();
        applyCustomer(rec, c);
        $$('[data-f]').forEach(function (el) { el.value = rec.f[el.getAttribute('data-f')] || ''; });
        markChanged();
        drawCustomer();
        drawPath();
      });
    }

    // ---- Material ----
    function drawRows() {
      $('#matRows').innerHTML = rec.material.map(function (m, i) {
        function cell(k, ph, extra) { return '<input data-m="' + i + '" data-k="' + k + '" value="' + esc(m[k]) + '" placeholder="' + ph + '" ' + (extra || '') + ' autocomplete="off">'; }
        return '<div class="mat-row">' + cell('artnr', 'Artikel-Nr.') + cell('bez', 'Bezeichnung') + cell('einheit', 'Einheit', 'list="einheiten"') +
          cell('menge', 'Menge', 'inputmode="decimal"') + cell('preis', 'Einzelpreis', 'inputmode="decimal"') + cell('gesamt', 'Gesamt', 'inputmode="decimal"') +
          '<button type="button" class="del" data-del="' + i + '" aria-label="Position löschen">' + ICONS.close + '</button></div>';
      }).join('');
      $$('#matRows [data-m]').forEach(function (el) {
        el.oninput = function () {
          rec.material[Number(el.getAttribute('data-m'))][el.getAttribute('data-k')] = el.value;
          markChanged();
        };
      });
      $$('#matRows [data-del]').forEach(function (b) {
        b.onclick = function () {
          rec.material.splice(Number(b.getAttribute('data-del')), 1);
          if (!rec.material.length) rec.material.push({});
          drawRows(); markChanged();
        };
      });
    }
    $('#addRow').onclick = function () {
      rec.material.push({});
      drawRows();
      var last = $$('#matRows .mat-row').pop();
      if (last) $('input', last).focus();
    };

    // ---- Felder ----
    $$('[data-f]').forEach(function (el) {
      el.addEventListener('input', function () {
        rec.f[el.getAttribute('data-f')] = el.value;
        if (el.getAttribute('data-f') === 'kunde_name') $('#edTitle').textContent = auftragTitle(rec);
        if (el.getAttribute('data-f') === 'art' || el.getAttribute('data-f') === 'datum_annahme') drawPath();
        markChanged();
      });
    });
    $$('[data-ablage]').forEach(function (el) {
      el.addEventListener('input', function () { rec.ablage[el.getAttribute('data-ablage')] = el.value; drawPath(); markChanged(); });
    });
    $$('#artChips [data-art]').forEach(function (b) {
      b.onclick = function () {
        var el = $('[data-f=art]');
        el.value = b.getAttribute('data-art');
        rec.f.art = el.value;
        drawPath(); markChanged();
      };
    });
    var ta = $('textarea[data-f=arbeitsumfang]');
    function grow() { ta.style.height = 'auto'; ta.style.height = Math.max(180, ta.scrollHeight + 2) + 'px'; }
    ta.addEventListener('input', grow);
    setTimeout(grow, 0);

    function drawPath() {
      if (!$('#pathPreview')) return;
      var segs = window.PdfGen.folderSegments(rec);
      var c = rec.customerId ? S.Index.item(idx, rec.customerId) : null;
      var p = rec.customerId ?
        ['Kundendatenbank', c ? c.name : rec.customerName].concat(segs).concat([window.PdfGen.fileName(rec)]) :
        ['ELUH-App Daten', 'Nicht zugeordnet', window.PdfGen.fileName(rec)];
      $('#pathPreview').textContent = p.join('  ›  ');
    }

    // ---- Speichern ----
    function setSaveState(t) { var el = $('#saveState'); if (el) el.textContent = t; }
    var saving = debounce(async function () {
      await S.Auftraege.save(rec);
      setSaveState('Gespeichert ' + fmtTime(Date.now()));
      drawStatus();
    }, 500);
    function markChanged() {
      if (rec.status === 'fertig') rec.needsRefile = true;
      setSaveState('Speichert…');
      saving();
    }
    // beim Verlassen der Seite ungespeicherte Eingaben sofort sichern
    onCleanup(function () { S.Auftraege.get(rec.id).then(function (cur) { if (cur && cur.updatedAt <= rec.updatedAt && JSON.stringify(cur.f) !== JSON.stringify(rec.f)) S.Auftraege.save(rec); }); });

    async function drawStatus() {
      var ops = await S.Outbox.all();
      var st = await auftragStatus(rec, ops);
      var box = $('#statusBox');
      if (!box) return;
      var html = '';
      if (rec.status === 'fertig') {
        var op = ops.filter(function (o) { return o.type === 'fileAuftrag' && o.auftragId === rec.id; })[0];
        if (op && op.lastError) html = '<div class="notice err">Ablage fehlgeschlagen: ' + esc(op.lastError) + ' – wird beim nächsten Sync erneut versucht.</div>';
        else if (st.key === 'offen' && rec.needsRefile && !op) html = '<div class="notice warn">Geändert – das PDF in der Kundendatenbank ist noch der alte Stand. „Änderungen ablegen“ tippen.</div>';
        else if (st.key === 'offen') html = '<div class="notice warn">Wird abgelegt, sobald eine Verbindung besteht' + (navigator.onLine ? '…' : ' (gerade offline).') + '</div>';
        else if (rec.drive) html = '<div class="notice ok">Abgelegt: ' + esc((rec.drive.path || []).join(' › ')) + ' · ' + fmtDT(rec.drive.filedAt) + '</div>';
      }
      box.innerHTML = html;
      drawActions();
    }

    function drawActions() {
      var bar = $('#edActions');
      if (!bar) return;
      var primary;
      if (rec.status !== 'fertig') primary = '<button class="btn primary" id="finish">Fertig &amp; ablegen</button>';
      else if (rec.needsRefile) primary = '<button class="btn primary" id="finish">Änderungen ablegen</button>';
      else primary = '';
      bar.innerHTML =
        '<button class="btn" id="preview">' + ICONS.print + '<span>PDF / Drucken</span></button>' + primary;
      var extra = $('#edExtra');
      if (!extra) return;
      extra.innerHTML = '<button class="btn ghost small" id="dup">Als neuen Auftrag kopieren</button>' +
        '<button class="btn ghost danger small" id="del">Auftrag löschen</button>';
      $('#preview').onclick = async function () { await S.Auftraege.save(rec); showAuftragPdf([rec]); };
      $('#del').onclick = async function () {
        var ok = await confirmBox('Auftrag löschen?', 'Der Auftrag wird auf allen Geräten entfernt.' + (rec.drive ? ' Das bereits abgelegte PDF in der Kundendatenbank bleibt erhalten.' : ''), 'Löschen', true);
        if (!ok) return;
        await S.Auftraege.remove(rec);
        toast('Auftrag gelöscht');
        location.hash = '#/auftraege';
      };
      $('#dup').onclick = async function () {
        var copy = S.Auftraege.create({
          customerId: rec.customerId, customerName: rec.customerName,
          f: Object.assign({}, rec.f, { auftrags_nr: '', datum_annahme: S.isoDate(new Date()), arbeitsumfang: '' }),
          material: [{}, {}, {}]
        });
        await S.Auftraege.save(copy);
        toast('Kopie angelegt (Kunde übernommen)');
        location.hash = '#/auftrag/' + copy.id;
      };
      var fin = $('#finish');
      if (fin) fin.onclick = async function () {
        if (!rec.customerId) {
          var ok = await confirmBox('Ohne Kunde ablegen?', 'Es ist kein Kunde aus der Kundendatenbank gewählt. Das PDF landet dann in „ELUH-App Daten › Nicht zugeordnet“. Du kannst später noch einen Kunden wählen und neu ablegen.', 'Trotzdem ablegen');
          if (!ok) return;
        }
        rec.status = 'fertig';
        rec.needsRefile = false;
        rec.finishedAt = rec.finishedAt || Date.now();
        await S.Auftraege.save(rec);
        await S.queueFiling(rec);
        toast(navigator.onLine ? 'Wird in der Kundendatenbank abgelegt…' : 'Gespeichert – wird abgelegt, sobald Internet da ist');
        drawStatus();
      };
    }

    drawCustomer();
    drawRows();
    drawPath();
    drawStatus();
    rerenderOn(['outbox', 'sync'], drawStatus);
    // Änderungen von anderen Geräten übernehmen, solange hier nichts getippt wird
    var lastLocal = rec.updatedAt;
    rerenderOn(['auftraege'], async function () {
      var fresh = await S.Auftraege.get(rec.id);
      if (!fresh) return;
      if (fresh.deleted) { toast('Auftrag wurde auf einem anderen Gerät gelöscht'); location.hash = '#/auftraege'; return; }
      if (!fresh._dirty && fresh.updatedAt > lastLocal && fresh.updatedAt !== rec.updatedAt && document.activeElement && !document.activeElement.matches('input,textarea')) {
        lastLocal = fresh.updatedAt;
        router();
        return;
      }
      rec.drive = fresh.drive;
      if (rec.customerId && rec.customerId.indexOf('tmp-') === 0 && fresh.customerId && fresh.customerId.indexOf('tmp-') !== 0) rec.customerId = fresh.customerId;
      if (rec.needsRefile && !fresh.needsRefile && fresh.updatedAt >= rec.updatedAt) rec.needsRefile = false;
      lastLocal = Math.max(lastLocal, fresh.updatedAt);
      drawStatus();
    });
  }, 'auftraege');

  // ------------------------------------------------------------------
  // Kundenauswahl (Dialog)
  // ------------------------------------------------------------------
  async function openCustomerPicker(onPick) {
    var idx = await S.Index.load();
    var sheet = openModal(
      '<div class="sheet-head"><h3>Kunde wählen</h3><button class="btn small ghost" data-close aria-label="Schließen">' + ICONS.close + '</button></div>' +
      '<div class="sheet-body stack">' +
      '<label class="search">' + ICONS.search + '<input class="input" id="pq" type="search" placeholder="Name, Straße, Ort…" autocomplete="off"></label>' +
      '<div id="pres"></div>' +
      '<details id="newCust"><summary class="btn small" style="display:inline-flex">' + ICONS.plus + '<span>Neuen Kunden anlegen</span></summary>' +
      '<div class="stack" style="margin-top:10px">' +
      '<label class="field"><span>Name / Firma</span><input id="ncName" autocomplete="off"></label>' +
      '<div class="grid2"><label class="field"><span>Straße + Nr.</span><input id="ncStr" autocomplete="off"></label>' +
      '<label class="field"><span>Ort</span><input id="ncOrt" autocomplete="off"></label></div>' +
      '<div class="path" id="ncPrev">Ordnername: –</div>' +
      '<button class="btn primary" id="ncGo">Anlegen &amp; übernehmen</button></div></details>' +
      '</div>');
    var customers = S.Index.customers(idx);
    function draw() {
      var q = $('#pq', sheet).value;
      var res = customers.filter(function (c) { return matchQuery(c.name, q); });
      if (!q) res = res.slice().sort(function (a, b) { return (b.modified || 0) - (a.modified || 0); });
      var shown = res.slice(0, 80);
      $('#pres', sheet).innerHTML = !customers.length ?
        '<div class="notice info">Die Kundendatenbank ist auf diesem Gerät noch nicht geladen' + (navigator.onLine ? ' – bitte kurz warten bzw. unter „Sync“ synchronisieren.' : ' (offline). Neuen Kunden kannst du trotzdem anlegen.') + '</div>' :
        '<div class="small muted" style="margin:0 2px 6px">' + (q ? res.length + ' Treffer' : 'Zuletzt geändert') + '</div><div class="list">' +
        (shown.map(function (c) {
          return '<button class="row" data-id="' + c.id + '">' + fileIcon(c) + '<span class="main"><span class="title" style="display:block">' + esc(c.name) + '</span></span>' + ICONS.chev + '</button>';
        }).join('') || '<div class="empty">Kein Kunde gefunden</div>') + '</div>';
      $$('#pres [data-id]', sheet).forEach(function (b) {
        b.onclick = function () {
          var c = S.Index.item(idx, b.getAttribute('data-id'));
          closeModal();
          onPick(c);
        };
      });
    }
    $('#pq', sheet).oninput = debounce(draw, 120);
    function prev() {
      var n = [$('#ncName', sheet).value, $('#ncStr', sheet).value, $('#ncOrt', sheet).value].map(function (s) { return s.trim(); }).filter(Boolean).join(', ');
      $('#ncPrev', sheet).textContent = 'Ordnername: ' + (n || '–');
      return n;
    }
    ['#ncName', '#ncStr', '#ncOrt'].forEach(function (s) { $(s, sheet).oninput = prev; });
    $('#ncGo', sheet).onclick = async function () {
      var n = prev();
      if (!$('#ncName', sheet).value.trim()) { toast('Bitte Namen eingeben', true); return; }
      var existing = customers.filter(function (c) { return norm(c.name.trim()) === norm(n); })[0];
      var id = existing ? existing.id : await S.createCustomer(n);
      idx = await S.Index.load();
      closeModal();
      if (!existing) toast(navigator.onLine ? 'Kundenordner wird angelegt' : 'Kunde angelegt – Ordner entsteht beim nächsten Sync');
      onPick(S.Index.item(idx, id) || { id: id, name: n });
    };
    draw();
    setTimeout(function () { if (!isIOS()) $('#pq', sheet).focus(); }, 50);
  }

  // ------------------------------------------------------------------
  // Kunden – Liste
  // ------------------------------------------------------------------
  var custState = { q: '', sort: 'name' };
  route(/^#\/kunden$/, async function () {
    view.innerHTML =
      '<div class="page-head"><h1>Kundendatenbank</h1>' +
      '<button class="btn" id="newCustomer">' + ICONS.plus + '<span>Neuer Kunde</span></button>' +
      '<div class="sub" id="idxInfo"></div></div>' +
      '<div class="stack"><label class="search">' + ICONS.search + '<input class="input" id="cq" type="search" placeholder="Kunde, Straße, Ort…" value="' + esc(custState.q) + '"></label>' +
      '<div class="chips"><button class="chip" data-s="name">A–Z</button><button class="chip" data-s="recent">Zuletzt geändert</button><button class="chip" data-s="offline">Offline verfügbar</button></div>' +
      '<div id="clist"></div></div>';
    var me = current;
    async function draw() {
      var idx = await S.Index.load();
      var s = await S.Settings.get();
      if (current !== me || !$('#idxInfo')) return;
      var off = new Set(s.offlineCustomers || []);
      var st = S.Index.stats(idx);
      $('#idxInfo').textContent = idx.v ? st.customers + ' Kunden · ' + st.files + ' Dateien · Stand ' + fmtDT(idx.v) : '';
      $$('.chips [data-s]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-s') === custState.sort); });
      var list = S.Index.customers(idx).filter(function (c) { return matchQuery(c.name, custState.q); });
      if (custState.sort === 'offline') list = list.filter(function (c) { return off.has(c.id); });
      list.sort(custState.sort === 'recent' ? function (a, b) { return (b.modified || 0) - (a.modified || 0); } :
        function (a, b) { return a.name.localeCompare(b.name, 'de', { sensitivity: 'base', numeric: true }); });
      var box = $('#clist');
      if (!idx.v && !list.length) {
        box.innerHTML = '<div class="list"><div class="empty">' + (S.Sync.state.running ? '<span class="spinner"></span> Kundendatenbank wird geladen…' :
          'Kundendatenbank noch nicht geladen. ' + (navigator.onLine ? '<a href="#/sync">Jetzt synchronisieren</a>' : 'Wird geladen, sobald Internet da ist.')) + '</div></div>';
        return;
      }
      var max = 400;
      box.innerHTML = '<div class="list">' + (list.slice(0, max).map(function (c) {
        return '<a class="row" href="#/ordner/' + encodeURIComponent(c.id) + '">' + fileIcon(c) +
          '<span class="main"><span class="title" style="display:block">' + esc(c.name) + '</span>' +
          '<span class="meta" style="display:block">' + (off.has(c.id) ? '<span class="offline-dot"></span>offline · ' : '') + (c.local ? 'wird angelegt…' : 'geändert ' + fmtDate(c.modified)) + '</span></span>' + ICONS.chev + '</a>';
      }).join('') || '<div class="empty">Kein Kunde gefunden</div>') + '</div>' +
        (list.length > max ? '<p class="small muted">' + (list.length - max) + ' weitere – Suche verfeinern.</p>' : '');
    }
    $('#cq').oninput = debounce(function () { custState.q = this.value; draw(); }, 150);
    $$('.chips [data-s]').forEach(function (b) { b.onclick = function () { custState.sort = b.getAttribute('data-s'); draw(); }; });
    $('#newCustomer').onclick = function () {
      openCustomerPicker(function (c) { location.hash = '#/ordner/' + encodeURIComponent(c.id); });
      setTimeout(function () { var d = $('#newCust'); if (d) d.open = true; }, 30);
    };
    await draw();
    rerenderOn(['index', 'sync'], draw);
    S.Sync.schedule(200);
  }, 'kunden');

  // ------------------------------------------------------------------
  // Ordner / Kunde
  // ------------------------------------------------------------------
  route(/^#\/ordner\/([^/]+)$/, async function (folderId) {
    var me = current;
    async function draw() {
      var idx = await S.Index.load();
      var realId = await S.IdMap.resolve(folderId);
      if (realId !== folderId) { location.replace('#/ordner/' + encodeURIComponent(realId)); return; }
      var folder = S.Index.item(idx, folderId);
      if (!folder) {
        view.innerHTML = '<div class="notice warn">Ordner nicht (mehr) vorhanden.</div><p><a href="#/kunden">Zur Kundendatenbank</a></p>';
        return;
      }
      var customer = S.Index.customerOf(idx, folderId);
      var isCustomer = customer && customer.id === folderId;
      var s = await S.Settings.get();
      var off = new Set(s.offlineCustomers || []);
      var cached = await S.Files.cachedIds();
      // Brotkrumen
      var crumbs = [];
      var cur = folder, guard = 0;
      while (cur && guard++ < 30) { crumbs.unshift(cur); if (cur.parent === idx.root) break; cur = S.Index.item(idx, cur.parent); }
      var items = S.Index.children(idx, folderId);
      var auftraege = [];
      if (isCustomer) {
        auftraege = (await S.Auftraege.all()).filter(function (a) { return a.customerId === folderId; })
          .sort(function (a, b) { return auftragDate(b).localeCompare(auftragDate(a)); });
      }
      var custOffline = customer && off.has(customer.id);
      if (current !== me) return;
      view.innerHTML =
        '<nav class="breadcrumb"><a href="#/kunden">Kundendatenbank</a>' + crumbs.map(function (c) {
          return '<span class="sep">›</span><a href="#/ordner/' + encodeURIComponent(c.id) + '">' + esc(c.name.trim()) + '</a>';
        }).join('') + '</nav>' +
        '<div class="page-head"><h1>' + esc(folder.name.trim()) + '</h1></div>' +
        '<div class="btn-row" style="margin-bottom:14px">' +
        (customer ? '<a class="btn primary" href="#/auftrag/neu?kunde=' + encodeURIComponent(customer.id) + '">' + ICONS.plus + '<span>Arbeitsauftrag</span></a>' : '') +
        '<label class="btn">' + ICONS.upload + '<span>Foto / Datei</span><input type="file" id="upl" multiple hidden></label>' +
        '<button class="btn" id="mkdir">Neuer Ordner</button>' +
        (customer ? '<button class="btn' + (custOffline ? ' primary' : '') + '" id="offTog">' + (custOffline ? '✓ Offline verfügbar' : 'Offline verfügbar machen') + '</button>' : '') +
        (folder.local ? '' : '<a class="btn ghost" target="_blank" rel="noopener" href="https://drive.google.com/drive/folders/' + esc(folder.id) + '">In Drive öffnen</a>') +
        '</div>' +
        (auftraege.length ? '<h2>Arbeitsaufträge aus der App</h2><div class="list">' + auftraege.map(function (a) {
          return '<a class="row" href="#/auftrag/' + a.id + '"><span class="ico pdf">' + ICONS.pdf + '</span><span class="main"><span class="title" style="display:block">' +
            esc((a.f.art || 'Arbeitsauftrag') + (a.f.auftrags_nr ? ' · Nr. ' + a.f.auftrags_nr : '')) + '</span><span class="meta" style="display:block">' + isoToDe(auftragDate(a)) +
            (a.status === 'fertig' ? '' : ' · Entwurf') + '</span></span>' + ICONS.chev + '</a>';
        }).join('') + '</div><h2>Ordner &amp; Dateien</h2>' : '') +
        '<div class="list">' + (items.map(function (it) {
          if (it.folder) {
            return '<a class="row" href="#/ordner/' + encodeURIComponent(it.id) + '">' + fileIcon(it) + '<span class="main"><span class="title" style="display:block">' + esc(it.name.trim()) +
              '</span><span class="meta" style="display:block">' + (it.local ? 'wird angelegt…' : fmtDate(it.modified)) + '</span></span>' + ICONS.chev + '</a>';
          }
          var isCached = cached.has(it.id);
          return '<button class="row" data-file="' + esc(it.id) + '">' + fileIcon(it) + '<span class="main"><span class="title" style="display:block">' + esc(it.name) +
            '</span><span class="meta" style="display:block">' + (isCached ? '<span class="offline-dot" title="offline gespeichert"></span>' : '') +
            (it.local ? 'wird hochgeladen…' : [fmtDate(it.modified), fmtSize(it.size)].filter(Boolean).join(' · ')) + '</span></span></button>';
        }).join('') || '<div class="empty">Ordner ist leer</div>') + '</div>';

      $$('[data-file]').forEach(function (b) {
        b.onclick = function () { openDriveFile(S.Index.item(idx, b.getAttribute('data-file'))); };
      });
      $('#upl').onchange = async function () {
        var files = Array.prototype.slice.call(this.files || []);
        for (var i = 0; i < files.length; i++) await S.uploadFile(folderId, files[i]);
        toast(files.length + (files.length === 1 ? ' Datei' : ' Dateien') + (navigator.onLine ? ' werden hochgeladen' : ' gespeichert – Upload, sobald Internet da ist'));
        draw();
      };
      $('#mkdir').onclick = function () {
        var sheet = openModal('<div class="sheet-head"><h3>Neuer Ordner</h3><button class="btn small ghost" data-close>' + ICONS.close + '</button></div>' +
          '<div class="sheet-body stack"><label class="field"><span>Name</span><input id="fdName" autocomplete="off"></label>' +
          '<button class="btn primary" id="fdGo">Anlegen</button></div>');
        $('#fdGo', sheet).onclick = async function () {
          var n = $('#fdName', sheet).value.trim();
          if (!n) return;
          await S.createFolder(folderId, n);
          closeModal();
          draw();
        };
        setTimeout(function () { $('#fdName', sheet).focus(); }, 50);
      };
      var tog = $('#offTog');
      if (tog) tog.onclick = async function () {
        var st = await S.Settings.get();
        var l = st.offlineCustomers || [];
        if (l.indexOf(customer.id) >= 0) {
          l = l.filter(function (x) { return x !== customer.id; });
          toast('Nicht mehr automatisch offline gehalten');
        } else {
          l.push(customer.id);
          toast(navigator.onLine ? 'Dateien werden für offline geladen…' : 'Dateien werden geladen, sobald Internet da ist');
        }
        await S.Settings.set({ offlineCustomers: l });
        S.Sync.run();
        draw();
      };
    }
    await draw();
    rerenderOn(['index', 'files', 'auftraege'], draw);
    S.Sync.schedule(200);
  }, 'kunden');

  // ------------------------------------------------------------------
  // Sync & Einstellungen
  // ------------------------------------------------------------------
  route(/^#\/sync$/, async function () {
    var me = current;
    async function draw() {
      var s = await S.Settings.get();
      var st = S.Sync.state;
      var ops = await S.Outbox.all();
      var idx = await S.Index.load();
      var stats = S.Index.stats(idx);
      var est = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null;
      var persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : null;
      var offNames = (s.offlineCustomers || []).map(function (id) { var c = S.Index.item(idx, id); return c ? c.name : id; });
      var opLabel = { createCustomer: 'Kundenordner anlegen', createFolder: 'Ordner anlegen', upload: 'Datei hochladen', fileAuftrag: 'Auftrag ablegen' };
      var auftragNames = {};
      (await S.Auftraege.all()).forEach(function (a) { auftragNames[a.id] = auftragTitle(a); });
      if (current !== me) return;
      view.innerHTML =
        '<div class="page-head"><h1>Synchronisierung</h1>' +
        '<button class="btn primary" id="syncNow"' + (st.running ? ' disabled' : '') + '>' + (st.running ? '<span class="spinner"></span> ' + esc(st.phase || 'Läuft') + '…' : 'Jetzt synchronisieren') + '</button></div>' +
        (!S.backendConfigured() ? '<div class="notice warn">Das Google-Drive-Backend ist in dieser App-Version noch nicht eingetragen – alles wird vorerst nur auf diesem Gerät gespeichert.</div>' : '') +
        (S.backendConfigured() && !s.key ? '<div class="notice warn">Dieses Gerät ist noch nicht verbunden. <a href="#/setup">App-Schlüssel eingeben</a></div>' : '') +
        (st.authError ? '<div class="notice err">Der App-Schlüssel wird nicht mehr akzeptiert. <a href="#/setup">Neu eingeben</a></div>' : '') +
        (st.error && !st.authError ? '<div class="notice ' + (st.offline ? 'warn' : 'err') + '">' + esc(st.offline ? 'Keine Verbindung – Änderungen bleiben gespeichert und werden automatisch nachgeholt.' : 'Letzter Fehler: ' + st.error) + '</div>' : '') +
        '<div class="card pad" style="margin-top:12px"><dl class="kv">' +
        '<dt>Status</dt><dd>' + (navigator.onLine ? 'Online' : 'Offline') + (st.running ? ' · synchronisiert gerade' : '') + '</dd>' +
        '<dt>Letzter Abgleich</dt><dd>' + fmtDT(s.lastSync) + '</dd>' +
        '<dt>Kundendatenbank</dt><dd>' + (idx.v ? stats.customers + ' Kunden · ' + stats.files + ' Dateien · Stand ' + fmtDT(idx.v) : 'noch nicht geladen') + '</dd>' +
        '<dt>Wartend</dt><dd>' + (st.pending || 0) + '</dd>' +
        '<dt>Speicher</dt><dd>' + (est ? fmtSize(est.usage) + ' belegt' : '–') + (persisted === true ? ' · dauerhaft' : '') + '</dd>' +
        '<dt>App-Version</dt><dd>' + esc((window.ELUH_CONFIG || {}).APP_VERSION) + '</dd></dl></div>' +
        '<h2>Warteschlange</h2>' +
        '<div class="list">' + (ops.map(function (o) {
          var label = opLabel[o.type] || o.type;
          var what = o.type === 'fileAuftrag' ? auftragNames[o.auftragId] || '' : o.name || '';
          return '<div class="row"><span class="main"><span class="title" style="display:block">' + esc(label) + (what ? ': ' + esc(what) : '') + '</span>' +
            '<span class="meta" style="display:block">' + (o.lastError ? 'Fehler: ' + esc(o.lastError) : 'wartet seit ' + fmtDT(o.createdAt)) + '</span></span>' +
            (o.lastError ? '<button class="btn small ghost danger" data-drop="' + o.id + '">Verwerfen</button>' : '') + '</div>';
        }).join('') || '<div class="empty">Nichts offen – alles ist synchron.</div>') + '</div>' +
        '<h2>Offline verfügbare Kunden</h2>' +
        '<div class="card pad small">' + (offNames.length ? offNames.map(esc).join('<br>') : 'Keine. In einem Kundenordner „Offline verfügbar machen“ tippen, dann bleiben alle Dateien dieses Kunden auf dem Gerät. Einmal geöffnete Dateien werden ohnehin gespeichert.') + '</div>' +
        '<h2>Gerät</h2>' +
        '<div class="btn-row">' +
        '<button class="btn" id="fullIndex">Kundendatenbank komplett neu laden</button>' +
        '<button class="btn" id="clearCache">Offline-Dateien löschen</button>' +
        '<a class="btn" href="#/setup">App-Schlüssel ändern</a></div>' +
        '<h2>App installieren</h2>' +
        '<div class="card pad small stack">' +
        '<div><b>iPhone / iPad:</b> Seite in Safari öffnen → Teilen-Symbol → „Zum Home-Bildschirm“. Danach nur noch über das Symbol starten.</div>' +
        '<div><b>MacBook:</b> Safari → Ablage → „Zum Dock hinzufügen“ (oder Chrome → Installieren-Symbol in der Adressleiste).</div>' +
        '<div>Jedes Gerät einmal mit dem App-Schlüssel verbinden. Danach gleicht sich alles automatisch ab – beim Start, alle paar Minuten und sobald wieder Internet da ist.</div></div>';
      $('#syncNow').onclick = function () { S.Sync.run(); };
      $('#fullIndex').onclick = function () { S.Sync.run({ fullIndex: true }); toast('Kundendatenbank wird neu geladen…'); };
      $('#clearCache').onclick = async function () {
        var ok = await confirmBox('Offline-Dateien löschen?', 'Gespeicherte Kopien von Drive-Dateien werden von diesem Gerät entfernt (in Google Drive bleibt alles). Noch nicht hochgeladene Dateien bleiben erhalten.', 'Löschen', true);
        if (!ok) return;
        var ops2 = await S.Outbox.all();
        var keep = {};
        ops2.forEach(function (o) { if (o.type === 'upload') keep[o.tmpId] = true; });
        var all = await S.DB.all('files');
        for (var i = 0; i < all.length; i++) if (!keep[all[i].id]) await S.DB.del('files', all[i].id);
        toast('Offline-Dateien gelöscht');
        draw();
      };
      $$('[data-drop]').forEach(function (b) {
        b.onclick = async function () {
          var ok = await confirmBox('Eintrag verwerfen?', 'Dieser Schritt wird nicht mehr zum Server übertragen.', 'Verwerfen', true);
          if (ok) { await S.Outbox.remove(b.getAttribute('data-drop')); draw(); }
        };
      });
    }
    await draw();
    rerenderOn(['sync', 'outbox', 'index'], draw);
  }, 'sync');

  // ------------------------------------------------------------------
  // Start
  // ------------------------------------------------------------------
  S.on('sync', renderSyncPill);
  S.on('outbox', async function () { S.Sync.state.pending = (await S.Outbox.all()).length; renderSyncPill(); });
  window.addEventListener('online', renderSyncPill);
  window.addEventListener('offline', renderSyncPill);

  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});

  // Service Worker (Offline + Updates)
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('sw.js').then(function (reg) {
      function offer(w) {
        var bar = document.getElementById('updateBar');
        bar.hidden = false;
        document.getElementById('updateBtn').onclick = function () { w.postMessage('skipWaiting'); };
      }
      if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
      reg.addEventListener('updatefound', function () {
        var w = reg.installing;
        w.addEventListener('statechange', function () {
          if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w);
        });
      });
      setInterval(function () { reg.update().catch(function () {}); }, 30 * 60 * 1000);
      document.addEventListener('visibilitychange', function () { if (!document.hidden) reg.update().catch(function () {}); });
    }).catch(function () {});
    var reloading = false;
    var hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      // nur nach einem echten Update neu laden, nicht bei der ersten Installation
      if (hadController && !reloading) { reloading = true; location.reload(); }
      hadController = true;
    });
  }

  // Automatischer Abgleich: beim Start, alle 2 Minuten, beim Zurückkehren in die App
  setInterval(function () { if (!document.hidden) S.Sync.run(); }, 2 * 60 * 1000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) S.Sync.schedule(300); });

  renderSyncPill();
  router().then(function () { S.Sync.run(); });

  window.ELUH_APP = { router: router, toast: toast };
})();
