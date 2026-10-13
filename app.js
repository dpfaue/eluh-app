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
  /** Ordnername → Nachname, Adresse ohne Vorname, Ort (siehe names.js) */
  function parseCustomer(folderName) { return window.Names.parseCustomer(folderName); }
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
    camera: '<svg viewBox="0 0 24 24"><path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.2l1.4-2h5.8l1.4 2h2.2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.4" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
    pen: '<svg viewBox="0 0 24 24"><path d="M4 20c3-1 4.5-4 7-4s2 3 4 3 3-2 5-2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M14.5 4.5l3 3L9 16H6v-3z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
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

  /** Eingabe-Dialog → liefert den Text (oder null) */
  function inputBox(title, label, value, okLabel) {
    return new Promise(function (resolve) {
      var done = false;
      var sheet = openModal(
        '<div class="sheet-head"><h3>' + esc(title) + '</h3></div><div class="sheet-body stack">' +
        '<label class="field"><span>' + esc(label) + '</span><input id="ibIn" autocomplete="off" value="' + esc(value || '') + '"></label>' +
        '<div class="btn-row" style="justify-content:flex-end"><button class="btn ghost" data-no>Abbrechen</button><button class="btn primary" data-yes>' + esc(okLabel || 'OK') + '</button></div></div>',
        { onClose: function () { if (!done) resolve(null); } });
      var inp = $('#ibIn', sheet);
      setTimeout(function () { inp.focus(); inp.select(); }, 50);
      $('[data-no]', sheet).onclick = function () { done = true; closeModal(); resolve(null); };
      $('[data-yes]', sheet).onclick = function () { var v = inp.value.trim(); if (!v) return; done = true; closeModal(); resolve(v); };
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') $('[data-yes]', sheet).click(); });
    });
  }

  /** Dialog mit mehreren Antworten → liefert den Schlüssel der gewählten Antwort (oder null) */
  function choiceBox(title, html, buttons) {
    return new Promise(function (resolve) {
      var done = false;
      var sheet = openModal(
        '<div class="sheet-head"><h3>' + esc(title) + '</h3><button class="btn small ghost" data-close aria-label="Abbrechen">' + ICONS.close + '</button></div>' +
        '<div class="sheet-body stack"><div>' + html + '</div><div class="stack">' + buttons.map(function (b) {
          return '<button type="button" class="btn ' + (b.cls || '') + '" data-choice="' + b.key + '" style="width:100%">' + esc(b.label) + '</button>';
        }).join('') + '</div></div>',
        { onClose: function () { if (!done) resolve(null); } });
      $$('[data-choice]', sheet).forEach(function (b) {
        b.onclick = function () { done = true; closeModal(); resolve(b.getAttribute('data-choice')); };
      });
    });
  }

  // ------------------------------------------------------------------
  // PDF-Anzeige & Drucken
  // ------------------------------------------------------------------
  function loadPdfJs() { return S.loadPdfJs(); }

  async function renderPdfInto(container, bytes) {
    var lib = await loadPdfJs();
    var pdf = await lib.getDocument({ data: bytes.slice ? bytes.slice(0) : bytes }).promise;
    container.innerHTML = '';
    var width = Math.min((container.clientWidth || container.parentNode.clientWidth) - 24, 900);
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
      show: async function (blob, name, extra) {
        var pb = $('[data-print]', sheet), db = $('[data-dl]', sheet);
        var note = '';
        if (extra && extra.small) {
          note = '<div class="viewer-note">Offline-Kopie (platzsparend verkleinert)' +
            (navigator.onLine ? ' <button class="btn small" data-orig>Original laden</button>' : ' – Original in Google Drive') + '</div>';
        }
        pb.hidden = false; db.hidden = isIOS();
        pb.onclick = function () { printBlob(blob, name); if (opts && opts.onPrint) opts.onPrint(); };
        db.onclick = function () { downloadBlob(blob, name); };
        var type = blob.type || '';
        if (type === 'application/pdf') {
          var bytes = new Uint8Array(await blob.arrayBuffer());
          body.innerHTML = note + '<div class="pdf-pages"><div class="msg"><span class="spinner"></span></div></div>';
          try { await renderPdfInto($('.pdf-pages', body), bytes); }
          catch (e) { body.innerHTML = note + '<div class="msg">PDF kann hier nicht angezeigt werden – über „Drucken/Sichern“ öffnen.</div>'; }
        } else if (type.indexOf('image/') === 0) {
          var img = new Image();
          img.src = URL.createObjectURL(blob);
          img.alt = name;
          body.innerHTML = note;
          body.appendChild(img);
        } else {
          body.innerHTML = '<div class="msg">Vorschau für diesen Dateityp nicht möglich.<br>Über „' + (isIOS() ? 'Teilen' : 'Sichern') + '“ öffnen.</div>';
          if (isIOS()) pb.querySelector('span').textContent = 'Öffnen / Teilen';
        }
      },
      fail: function (msg) { body.innerHTML = '<div class="msg">' + esc(msg) + '</div>'; }
    };
  }
  function bindOriginal(v, item) {
    var b = $('[data-orig]', v.body);
    if (!b) return;
    b.onclick = async function () {
      b.disabled = true;
      b.innerHTML = '<span class="spinner"></span> lädt…';
      try {
        var o = await S.Files.loadOriginal(item.id);
        v.body.innerHTML = '<div class="msg"><span class="spinner"></span></div>';
        await v.show(o.blob, o.name || item.name);
      } catch (e) { toast('Original konnte nicht geladen werden: ' + e.message, true); b.disabled = false; b.textContent = 'Original laden'; }
    };
  }

  async function showAuftragPdf(recs, vopts) {
    var title = recs.length === 1 ? auftragTitle(recs[0]) : recs.length + ' Arbeitsaufträge';
    var v = openViewer(title, Object.assign({ driveUrl: recs.length === 1 && recs[0].drive && recs[0].drive.url }, vopts || {}));
    try {
      var bytes = recs.length === 1 ? await window.PdfGen.buildFull(recs[0]) : await window.PdfGen.merge(recs);
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
      await v.show(blob, rec.name || item.name, { small: rec.small });
      bindOriginal(v, item);
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
    else if (st.authError) { cls = 'err'; text = 'Neu verbinden'; }
    else if (st.running) { cls = 'run'; text = 'Synchronisiere…'; }
    else if (!navigator.onLine || st.offline) { cls = st.pending ? 'warn' : ''; text = 'Offline' + (st.pending ? ' · ' + st.pending + ' wartend' : ''); }
    else if (st.error) { cls = 'err'; text = 'Sync-Fehler'; }
    else if (st.pending) { cls = 'warn'; text = st.pending + ' wartend'; }
    else { text = 'Synchron' + (st.lastOk ? ' · ' + fmtTime(st.lastOk) : ''); }
    pill.className = 'sync-pill ' + cls;
    pill.innerHTML = '<span class="dot"></span><span>' + esc(text) + '</span>';
  }
  document.getElementById('syncPill').onclick = function () {
    if (S.Sync.state.authError) { location.hash = '#/setup'; return; }
    if (location.hash.indexOf('#/sync') === 0) S.Sync.run(); else location.hash = '#/sync';
  };

  // ------------------------------------------------------------------
  // Benachrichtigungen (Push) – Einstellungen
  // ------------------------------------------------------------------
  async function renderPushBox(box) {
    if (!box) return;
    var s = await S.Settings.get();
    var st = await S.Push.status();
    var isBuero = s.role === 'buero';
    var why = isBuero ? 'neue Aufträge von Dominic, neue Termine und Erinnerungen' : 'neue Termine vom Büro und Termin-Erinnerungen';
    var html = '<div class="small">Mitteilungen aufs Gerät bei: ' + why + '.</div>' +
      '<label class="field"><span>Name dieses Geräts / Person</span><input id="devName" value="' + esc(s.deviceName || '') + '" placeholder="z. B. Dominic"></label>';
    if (st === 'unsupported') {
      html += '<div class="notice warn">' + (isIOS() && !S.Push.standalone() ? 'Auf iPhone/iPad funktionieren Mitteilungen nur, wenn die App über „Zum Home-Bildschirm“ installiert ist und von dort gestartet wird.' : 'Dieser Browser unterstützt keine Mitteilungen.') + '</div>';
    } else if (st === 'denied') {
      html += '<div class="notice warn">Mitteilungen sind für diese App blockiert. In den Geräte-Einstellungen (Mitteilungen → ELUH) wieder erlauben.</div>';
    } else if (st === 'on') {
      html += '<div class="notice ok" id="pushState">Mitteilungen sind auf diesem Gerät eingeschaltet.</div><div class="btn-row"><button type="button" class="btn small" id="pushTest">Test-Mitteilung senden</button><button type="button" class="btn small ghost" id="pushOff">Ausschalten</button></div>';
    } else {
      html += '<button type="button" class="btn primary" id="pushOn">Mitteilungen einschalten</button>';
    }
    box.innerHTML = html;
    $('#devName', box).onchange = async function () {
      await S.Settings.set({ deviceName: this.value.trim() });
      S.Push.register().catch(function () {});
      toast('Gespeichert');
    };
    var b;
    if ((b = $('#pushOn', box))) b.onclick = function () {
      var b = this; // eigene Variable: das äußere „b“ zeigt später auf andere Knöpfe (alter Fehler: Klick tat nichts)
      // Erlaubnis SOFORT im Klick anfragen – das iPhone ignoriert die Abfrage sonst stillschweigend
      var perm;
      try { perm = Notification.requestPermission(); } catch (e) { perm = Promise.reject(e); }
      b.disabled = true;
      var info = $('#pushStep', box);
      if (!info) { info = document.createElement('div'); info.id = 'pushStep'; info.className = 'small muted'; b.insertAdjacentElement('afterend', info); }
      S.Push.enable(perm, function (t) { info.textContent = t; }).then(function () {
        toast('Mitteilungen eingeschaltet');
        renderPushBox(box);
      }).catch(function (e) {
        b.disabled = false;
        info.className = 'notice warn small';
        info.textContent = 'Hat nicht geklappt: ' + (e && e.message || e);
        toast(e && e.message || 'Fehler', true);
      });
    };
    if ((b = $('#pushOff', box))) b.onclick = async function () { await S.Push.disable(); renderPushBox(box); };
    if ((b = $('#pushTest', box))) b.onclick = async function () {
      var btn = this; btn.disabled = true;
      try {
        var j = await S.Push.test();
        if (j.sent) toast('Test gesendet – kommt in wenigen Sekunden');
        else if (!j.hasSub) toast('Server kennt dieses Gerät nicht – bitte „Ausschalten“ und wieder einschalten', true);
        else toast('Versand fehlgeschlagen' + (j.last && j.last.code ? ' (Code ' + j.last.code + ')' : ''), true);
        renderPushBox(box);
      } catch (e) { toast(e.message, true); }
      finally { btn.disabled = false; }
    };
    // Abgleich mit dem Server: ist das Abo dort wirklich hinterlegt?
    if (st === 'on' && navigator.onLine) {
      try {
        var r = await S.Push.register();
        var ps = $('#pushState', box);
        if (ps && r.keyOk === false) { ps.className = 'notice warn'; ps.textContent = 'Das Mitteilungs-Abo stammt noch von einer älteren Server-Version. Bitte einmal „Ausschalten“ und wieder „Mitteilungen einschalten“.'; }
        else if (ps && !r.hasSub) { ps.className = 'notice warn'; ps.textContent = 'Auf dem Gerät eingeschaltet, aber der Server kennt das Abo nicht. Bitte „Ausschalten“ und neu einschalten.'; }
        else if (ps && r.last && r.last.code >= 300) { ps.className = 'notice warn'; ps.textContent = 'Eingeschaltet – aber die letzte Mitteilung wurde vom Push-Dienst abgelehnt (Code ' + r.last.code + '). Bitte „Ausschalten“ und neu einschalten.'; }
        else if (ps && r.last && r.last.code) ps.textContent = 'Mitteilungen sind eingeschaltet ✓ · zuletzt zugestellt ' + fmtDT(r.last.at);
      } catch (e) { /* offline */ }
    }
  }

  // ------------------------------------------------------------------
  // Router
  // ------------------------------------------------------------------
  var current = { name: null, cleanup: null };
  var routes = [];
  function route(re, fn, tab) { routes.push({ re: re, fn: fn, tab: tab }); }

  var CHEF_ONLY = /^#\/(auftraege|auftrag\/|sync|stunden|nachfolge)/;
  async function router() {
    var s = await S.Settings.get();
    var isBuero = s.role === 'buero';
    document.body.classList.toggle('role-buero', isBuero);
    var hash = location.hash || '#/heute';
    if (S.backendConfigured() && !s.key && !s.skipSetup && !/^#\/(setup|pair)/.test(hash)) {
      location.replace('#/setup');
      return;
    }
    if (isBuero && CHEF_ONLY.test(hash)) { location.replace('#/buero'); return; }
    if (!isBuero && /^#\/(buero|konto)/.test(hash)) { location.replace('#/auftraege'); return; }
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
    location.replace('#/heute');
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

  // Einrichtung / Gerät verbinden: siehe geraete.js

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
  /** Freigabe stellt Dominic ein, Druck-/Abrechnungsstatus kommt vom Büro (Server) */
  function mergeOffice(local, server) {
    var so = (server && server.office) || {}, lo = local.office;
    if (!lo) return server && server.office;
    return Object.assign({}, so, { shared: lo.shared, sharedAt: lo.sharedAt || so.sharedAt });
  }
  function officeStatus(r) {
    var o = r.office;
    if (!o || !o.shared) return null;
    if (o.billedAt) return { cls: 'ok', text: 'Büro: abgerechnet', key: 'billed' };
    if (o.printedAt) return { cls: 'info', text: 'Büro: gedruckt', key: 'printed' };
    return { cls: 'warn', text: 'Im Büro', key: 'shared' };
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
    var filters = [['alle', 'Alle'], ['entwurf', 'Entwürfe'], ['offen', 'Noch nicht abgelegt'], ['fertig', 'Abgelegt'], ['buero', 'Ans Büro geschickt']];
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
        if (listState.filter === 'buero') { if (!officeStatus(r)) continue; }
        else if (listState.filter !== 'alle' && st.key !== listState.filter) continue;
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
            '<span class="badges">' + (officeStatus(r) ? '<span class="badge ' + officeStatus(r).cls + '">' + officeStatus(r).text + '</span>' : '') +
            '<span class="badge ' + x.st.cls + '">' + x.st.text + '</span></span></div>';
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
    var prof = await S.Profile.get();
    if (prof.monteurSig && prof.autoMonteur !== false) rec.sig = { monteur: { png: prof.monteurSig, at: Date.now(), auto: true } };
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
  // Textbausteine (Standardtexte aus Dominics Wartungs-Aufträgen) – nur in Dominics Auftrags-Editor
  var TB_STD = '- Wartung nach Vertrag durchgeführt\n- Brennraum i.O\n- Brenner i.O\n- Funktion i.O\n- Abgasmessung i.O';
  var TB_TEMPLATES = [
    { name: 'Wartung Gastherme', art: 'Wartung Gastherme', text: TB_STD },
    { name: 'Wartung Ölkessel', art: 'Wartung Ölkessel', text: TB_STD },
    { name: 'Wartung Wärmepumpe', art: 'Wartung Wärmepumpe', text: '- Wartung durchgeführt\n- Magnetitabscheider gespült\n- Anlage auf Dichtheit geprüft i.O\n- Sichtprüfung der gesamten Anlage i.O\n- Sichtprüfung Außengerät i.O' }
  ];
  var TB_PARTS = ['Öldüse', 'Ölfilter', 'Brennerdichtung', 'Brennkammerdichtung'];
  /** Zeile „- A + B getauscht“ im Text finden */
  function tbSwapLine(lines) {
    for (var i = 0; i < lines.length; i++) if (/^\s*-?\s*.+\bgetauscht\s*$/i.test(lines[i]) && TB_PARTS.some(function (p) { return lines[i].indexOf(p) >= 0; })) return i;
    return -1;
  }
  function tbParts(text) {
    var lines = String(text || '').split('\n'), i = tbSwapLine(lines);
    if (i < 0) return [];
    return TB_PARTS.filter(function (p) { return new RegExp('(^|[\\s+,-])' + p + '([\\s+,]|$)').test(lines[i].replace(/getauscht/i, '')); });
  }
  /** Teil in der „getauscht“-Zeile an- oder abwählen (Zeile steht nach „Brenner i.O“, sonst vor „Funktion i.O“, sonst am Ende) */
  function tbToggle(text, part) {
    var lines = String(text || '').replace(/\s+$/, '').split('\n');
    if (lines.length === 1 && !lines[0]) lines = [];
    var parts = tbParts(lines.join('\n'));
    var at = tbSwapLine(lines);
    if (parts.indexOf(part) >= 0) parts = parts.filter(function (p) { return p !== part; }); else parts.push(part);
    parts = TB_PARTS.filter(function (p) { return parts.indexOf(p) >= 0; });
    var line = parts.length ? '- ' + parts.join(' + ') + ' getauscht' : null;
    if (at >= 0) { if (line) lines[at] = line; else lines.splice(at, 1); }
    else if (line) {
      var pos = -1;
      lines.forEach(function (l, i) { if (/Brenner i\.?\s?O/i.test(l)) pos = i + 1; });
      if (pos < 0) lines.forEach(function (l, i) { if (pos < 0 && /Funktion i\.?\s?O/i.test(l)) pos = i; });
      if (pos < 0) pos = lines.length;
      lines.splice(pos, 0, line);
    }
    return lines.join('\n');
  }
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
      '<div id="statusBox"></div><div id="nfBox"></div>' +
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
      '<div class="tb-box" id="tbBox"></div>' +
      '<label class="field"><span>Arbeitsumfang / Ausgeführte Arbeiten</span><textarea data-f="arbeitsumfang" rows="8">' + esc(f.arbeitsumfang) + '</textarea></label>' +
      input('ort_datum', 'Ort, Datum') +
      '</div></section>' +
      '<section class="form-section"><h3>Materialschein</h3>' +
      '<div class="mat-row mat-head"><span>Artikel-Nr.</span><span>Bezeichnung</span><span>Stck./m/kg</span><span>Menge</span><span>Einzelpreis €</span><span>Gesamtpreis €</span><span></span></div>' +
      '<div id="matRows"></div>' +
      '<div class="btn-row" style="margin-top:8px"><button type="button" class="btn small" id="addRow">' + ICONS.plus + '<span>Position</span></button></div>' +
      '<p class="small muted" style="margin:8px 2px 0">Der Materialschein kommt nur ins PDF, wenn Material eingetragen ist.</p>' +
      '<div class="grid2" style="margin-top:14px">' + input('mat_gesamt_summe', 'Gesamt Material') + input('datum_fertigstellung', 'Ort, Datum (Materialschein)') + '</div>' +
      '<datalist id="einheiten">' + EINHEITEN.map(function (e) { return '<option value="' + e + '">'; }).join('') + '</datalist>' +
      '</section>' +
      '<section class="form-section"><h3>Arbeitszeit</h3>' +
      '<div class="zeit-row zeit-head"><span>Datum</span><span>Monteur</span><span>Stunden</span><span></span></div>' +
      '<div id="zeitRows"></div>' +
      '<div class="btn-row" style="margin-top:8px;align-items:center"><button type="button" class="btn small" id="addZeit">' + ICONS.plus + '<span>Zeile</span></button>' +
      '<span class="small" id="zeitSum"></span></div>' +
      '<datalist id="monteure"></datalist>' +
      '<p class="small muted" style="margin:8px 2px 0">Wird als eigenes PDF „Stundennachweis“ im Terminordner abgelegt – nur wenn Stunden eingetragen sind.</p></section>' +
      '<section class="form-section"><h3>Fotos</h3>' +
      '<div class="photo-grid" id="photoGrid"></div>' +
      '<div class="btn-row" style="margin-top:10px">' +
      '<label class="btn">' + ICONS.camera + '<span>Foto aufnehmen</span><input type="file" accept="image/*" capture="environment" id="phCam" hidden></label>' +
      '<label class="btn">' + ICONS.upload + '<span>Aus Mediathek</span><input type="file" accept="image/*" multiple id="phLib" hidden></label></div>' +
      '<p class="small muted" style="margin:8px 2px 0">Fotos landen automatisch im Terminordner beim Kunden (gleicher Ordner wie das Auftrags-PDF).</p></section>' +
      '<section class="form-section"><h3>Unterschriften</h3><div class="sig-grid"><div class="sig-card" id="sigKunde"></div><div class="sig-card" id="sigMonteur"></div></div></section>' +
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
        drawPhotos();
        if ((rec.photos || []).some(function (x) { return !x.fileId; })) setTimeout(function () { S.Sync.run(); }, 700);
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

    // ---- Textbausteine ----
    async function drawTb() {
      var box = $('#tbBox');
      if (!box) return;
      var prof = await S.Profile.get();
      var own = prof.textbausteine || [];
      var parts = tbParts(rec.f.arbeitsumfang);
      box.innerHTML = '<div class="tb-label">Textbausteine</div>' +
        '<div class="chips">' + TB_TEMPLATES.concat(own).map(function (t, i) {
          return '<button type="button" class="chip" data-tb="' + i + '">' + esc(t.name) + '</button>';
        }).join('') + '</div>' +
        '<div class="tb-label">Getauscht</div><div class="chips">' + TB_PARTS.map(function (p) {
          return '<button type="button" class="chip' + (parts.indexOf(p) >= 0 ? ' on' : '') + '" data-tbp="' + esc(p) + '">' + esc(p) + '</button>';
        }).join('') + '</div>' +
        '<div class="btn-row"><button type="button" class="btn small ghost" id="tbSave">Text als eigenen Baustein speichern</button>' +
        (own.length ? '<button type="button" class="btn small ghost" id="tbManage">Eigene verwalten</button>' : '') + '</div>';
      var all = TB_TEMPLATES.concat(own);
      $$('[data-tb]', box).forEach(function (b) {
        b.onclick = async function () {
          var t = all[Number(b.getAttribute('data-tb'))];
          var cur = String(rec.f.arbeitsumfang || '').trim();
          var text = t.text;
          if (cur && cur !== t.text) {
            var how = await choiceBox('„' + t.name + '“ einsetzen', '<p class="muted" style="margin:0">Im Feld steht schon Text.</p>', [
              { key: 'replace', label: 'Text ersetzen', cls: 'primary' }, { key: 'append', label: 'Unten anhängen' }]);
            if (!how) return;
            if (how === 'append') text = cur + '\n' + t.text;
          }
          ta.value = text; rec.f.arbeitsumfang = text; grow();
          var art = $('[data-f=art]');
          if (t.art && (!String(rec.f.art || '').trim() || /^wartung$/i.test(String(rec.f.art).trim()) || TB_TEMPLATES.some(function (x) { return x.art === rec.f.art; }))) {
            art.value = t.art; rec.f.art = t.art; drawPath();
          }
          markChanged(); drawTb();
        };
      });
      $$('[data-tbp]', box).forEach(function (b) {
        b.onclick = function () {
          var text = tbToggle(rec.f.arbeitsumfang, b.getAttribute('data-tbp'));
          ta.value = text; rec.f.arbeitsumfang = text; grow();
          markChanged(); drawTb();
        };
      });
      $('#tbSave', box).onclick = async function () {
        var text = String(rec.f.arbeitsumfang || '').trim();
        if (!text) { toast('Erst Text ins Feld „Arbeitsumfang“ schreiben', true); return; }
        var name = await inputBox('Eigener Textbaustein', 'Name (z. B. „Wartung Brennwert“)', String(rec.f.art || '').trim(), 'Speichern');
        if (!name || !name.trim()) return;
        var p = await S.Profile.get();
        var list = (p.textbausteine || []).filter(function (x) { return x.name !== name.trim(); });
        list.push({ name: name.trim().slice(0, 40), art: String(rec.f.art || '').trim(), text: text });
        await S.Profile.set({ textbausteine: list });
        toast('Baustein gespeichert – auf allen deinen Geräten');
        drawTb();
      };
      var mg = $('#tbManage', box);
      if (mg) mg.onclick = async function () {
        var p = await S.Profile.get();
        var list = p.textbausteine || [];
        var key = await choiceBox('Eigenen Baustein löschen', '<p class="muted" style="margin:0">Welchen Baustein entfernen?</p>',
          list.map(function (x, i) { return { key: String(i), label: x.name + ' löschen', cls: 'ghost danger' }; }));
        if (key === null) return;
        list.splice(Number(key), 1);
        await S.Profile.set({ textbausteine: list });
        drawTb();
      };
    }
    ta.addEventListener('input', U_debounceTb);
    function U_debounceTb() { clearTimeout(U_debounceTb.t); U_debounceTb.t = setTimeout(function () { var p = tbParts(ta.value); $$('[data-tbp]').forEach(function (b) { b.classList.toggle('on', p.indexOf(b.getAttribute('data-tbp')) >= 0); }); }, 300); }
    drawTb();

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
    var pendingSave = false; // ungespeicherte Eingaben -> Sync darf die Seite nicht neu aufbauen
    var rerenderLater = false, left = false;
    // Stand, von dem diese Seite ausgeht (für 3-Wege-Abgleich mit Änderungen anderer Geräte)
    function snapEd(r) {
      return { f: Object.assign({}, r.f || {}), material: JSON.stringify(r.material || []), zeiten: JSON.stringify(r.zeiten || []),
        ablage: JSON.stringify(r.ablage || {}), cust: JSON.stringify([r.customerId || null, r.customerName || '']), status: r.status };
    }
    var base = snapEd(rec);
    function busyNow() { return pendingSave || !modal.hidden || !!(document.activeElement && document.activeElement.matches('input,textarea')); }
    /** Neueren Stand eines anderen Geräts übernehmen, ohne eigene (noch nicht übernommene) Eingaben zu verlieren */
    function mergeRemote(fresh) {
      var needRe = false;
      rec.f = rec.f || {};
      var ff = fresh.f || {};
      Object.keys(Object.assign({}, rec.f, ff)).forEach(function (k) {
        var lv = rec.f[k] == null ? '' : rec.f[k], bv = base.f[k] == null ? '' : base.f[k], fv = ff[k] == null ? '' : ff[k];
        if (lv === bv && fv !== lv) {
          rec.f[k] = fv;
          var el = left ? null : $('[data-f="' + k + '"]');
          if (el) el.value = fv;
        }
      });
      [['material', []], ['zeiten', []], ['ablage', {}]].forEach(function (x) {
        var lv = JSON.stringify(rec[x[0]] || x[1]), fv = JSON.stringify(fresh[x[0]] || x[1]);
        if (lv === base[x[0]] && fv !== lv) { rec[x[0]] = JSON.parse(fv); needRe = true; }
      });
      var lc = JSON.stringify([rec.customerId || null, rec.customerName || '']);
      if (lc === base.cust && JSON.stringify([fresh.customerId || null, fresh.customerName || '']) !== lc) { rec.customerId = fresh.customerId; rec.customerName = fresh.customerName; needRe = true; }
      if (rec.status === base.status && fresh.status !== rec.status) { rec.status = fresh.status; rec.finishedAt = fresh.finishedAt; needRe = true; }
      var ms = S.mergeSig(rec.sig, fresh.sig);
      if (JSON.stringify(ms) !== JSON.stringify(rec.sig || {})) { rec.sig = ms; if (!left) drawSigs(); }
      if (fresh.updatedAt > rec.updatedAt) rec.updatedAt = fresh.updatedAt;
      base = snapEd(fresh);
      return needRe;
    }
    async function persist() {
      var cur = await S.Auftraege.get(rec.id);
      if (cur) {
        rec.photos = cur.photos || []; rec.drive = cur.drive; rec.office = mergeOffice(rec, cur);
        if (cur.updatedAt > rec.updatedAt && mergeRemote(cur)) rerenderLater = true;
        rec.sig = S.mergeSig(cur.sig, rec.sig);
      }
      await S.Auftraege.save(rec);
      base = snapEd(rec);
      pendingSave = false;
      if (left) return;
      setSaveState('Gespeichert ' + fmtTime(Date.now()));
      drawStatus();
      if (rerenderLater && !busyNow()) { rerenderLater = false; router(); }
    }
    var saving = debounce(persist, 500);
    function markChanged() {
      if (rec.status === 'fertig') rec.needsRefile = true;
      pendingSave = true;
      setSaveState('Speichert…');
      saving();
    }
    // beim Verlassen der Seite / App im Hintergrund: ungespeicherte Eingaben sofort sichern
    function onHide() { if (document.visibilityState === 'hidden' && pendingSave) persist(); }
    document.addEventListener('visibilitychange', onHide);
    onCleanup(function () {
      left = true;
      document.removeEventListener('visibilitychange', onHide);
      if (pendingSave) persist();
    });

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
      var o = rec.office;
      if (o && o.shared) {
        html += '<div class="notice info" style="margin-top:8px">Ans Büro geschickt ' + fmtDT(o.sharedAt) +
          (o.printedAt ? ' · gedruckt ' + fmtDT(o.printedAt) + (o.printedBy ? ' (' + esc(o.printedBy) + ')' : '') : ' · noch nicht gedruckt') +
          (o.billedAt ? ' · abgerechnet ' + fmtDT(o.billedAt) : '') + '</div>';
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
      var shared = rec.office && rec.office.shared;
      extra.innerHTML = (rec.status === 'fertig' ? '<button class="btn ghost small" id="shareTog">' + (shared ? 'Freigabe fürs Büro zurückziehen' : 'Ans Büro schicken') + '</button>' : '') +
        '<button class="btn ghost small" id="nfMakeFrom">Nachfolgeauftrag anlegen</button>' +
        '<button class="btn ghost small" id="dup">Als neuen Auftrag kopieren</button>' +
        '<button class="btn ghost danger small" id="del">Auftrag löschen</button>';
      $('#nfMakeFrom').onclick = async function () { if (pendingSave) await persist(); window.Nachfolge.fromAuftrag(rec); };
      var stg = $('#shareTog');
      if (stg) stg.onclick = async function () {
        rec.office = Object.assign({}, rec.office || {});
        if (shared) { rec.office.shared = false; toast('Fürs Büro nicht mehr sichtbar'); }
        else { rec.office.shared = true; rec.office.sharedAt = Date.now(); toast('Ans Büro geschickt'); }
        await S.Auftraege.save(rec);
        drawStatus();
      };
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
        var alreadyShared = rec.office && rec.office.shared;
        var choice = alreadyShared ? 'nur' : await choiceBox('Auftrag ablegen',
          '<p style="margin:0">Der Auftrag wird als PDF beim Kunden abgelegt' + (window.PdfGen.hasZeiten(rec) ? ' (dazu der Stundennachweis)' : '') + '.</p>' +
          '<p style="margin:8px 0 0"><b>Soll das Büro ihn zum Drucken und Abrechnen bekommen?</b></p>',
          [{ key: 'buero', label: 'Ablegen und ans Büro schicken', cls: 'primary' }, { key: 'nur', label: 'Nur ablegen' }]);
        if (!choice) return;
        if (choice === 'buero') { rec.office = Object.assign({}, rec.office || {}, { shared: true, sharedAt: Date.now() }); }
        rec.status = 'fertig';
        rec.needsRefile = false;
        rec.finishedAt = rec.finishedAt || Date.now();
        await persist(); // inkl. Unterschriften, die evtl. gerade auf einem anderen Gerät geleistet wurden
        await S.queueFiling(rec);
        toast((navigator.onLine ? 'Wird abgelegt' : 'Gespeichert – wird abgelegt, sobald Internet da ist') + (choice === 'buero' ? ' · Büro wird benachrichtigt' : ''));
        drawStatus();
      };
    }

    // ---- Arbeitszeit ----
    async function drawZeiten() {
      var box = $('#zeitRows');
      if (!box) return;
      rec.zeiten = rec.zeiten || [];
      if (!rec.zeiten.length) {
        var s = await S.Settings.get();
        var prof = await S.Profile.get();
        rec.zeiten.push({ datum: (rec.ablage && rec.ablage.datum) || S.isoDate(new Date()), monteur: prof.monteurName || s.deviceName || '', stunden: '' });
      }
      box.innerHTML = rec.zeiten.map(function (z, i) {
        return '<div class="zeit-row"><input type="date" data-z="' + i + '" data-k="datum" value="' + esc(z.datum) + '">' +
          '<input data-z="' + i + '" data-k="monteur" list="monteure" value="' + esc(z.monteur) + '" placeholder="Monteur" autocomplete="off">' +
          '<input data-z="' + i + '" data-k="stunden" inputmode="decimal" value="' + esc(z.stunden) + '" placeholder="z. B. 2,5">' +
          '<button type="button" class="del" data-zdel="' + i + '" aria-label="Zeile löschen">' + ICONS.close + '</button></div>';
      }).join('');
      $$('[data-z]', box).forEach(function (el) {
        el.oninput = function () { rec.zeiten[Number(el.getAttribute('data-z'))][el.getAttribute('data-k')] = el.value; zeitSum(); markChanged(); };
      });
      $$('[data-zdel]', box).forEach(function (b) {
        b.onclick = function () { rec.zeiten.splice(Number(b.getAttribute('data-zdel')), 1); drawZeiten(); markChanged(); };
      });
      var names = {};
      (await S.Auftraege.all()).forEach(function (a) { (a.zeiten || []).forEach(function (z) { if (z.monteur) names[z.monteur] = 1; }); });
      var dl = $('#monteure');
      if (!dl) return; // Seite inzwischen verlassen
      dl.innerHTML = Object.keys(names).map(function (n) { return '<option value="' + esc(n) + '">'; }).join('');
      zeitSum();
    }
    function zeitSum() {
      var el = $('#zeitSum');
      if (el) el.textContent = window.PdfGen.hasZeiten(rec) ? 'Gesamt: ' + window.PdfGen.sumZeiten(rec) + ' Std.' : '';
    }
    $('#addZeit').onclick = function () {
      var last = rec.zeiten[rec.zeiten.length - 1] || {};
      rec.zeiten.push({ datum: last.datum || S.isoDate(new Date()), monteur: '', stunden: '' });
      drawZeiten();
    };

    // ---- Fotos ----
    var photoUrls = [];
    onCleanup(function () { photoUrls.forEach(function (u) { URL.revokeObjectURL(u); }); });
    async function drawPhotos() {
      var grid = $('#photoGrid');
      if (!grid) return;
      var ops = await S.Outbox.all();
      var photos = rec.photos || [];
      if (!photos.length) { grid.innerHTML = '<div class="small muted">Noch keine Fotos.</div>'; return; }
      grid.innerHTML = photos.map(function (ph) {
        var op = ops.filter(function (o) { return o.type === 'uploadPhoto' && o.photoId === ph.id; })[0];
        var st = ph.fileId ? '<span class="ph-st ok">✓</span>' : (!rec.customerId && rec.status !== 'fertig') ? '<span class="ph-st warn">wartet auf Kunde</span>' : '<span class="ph-st warn">wird hochgeladen</span>';
        return '<div class="ph" data-ph="' + esc(ph.id) + '"><div class="ph-img"></div>' + st +
          '<button type="button" class="ph-del" data-phdel="' + esc(ph.id) + '" aria-label="Foto entfernen">' + ICONS.close + '</button></div>';
      }).join('');
      for (var i = 0; i < photos.length; i++) {
        var ph = photos[i];
        var tile = grid.querySelector('[data-ph="' + CSS.escape(ph.id) + '"] .ph-img');
        var fr = await S.Files.get(ph.id) || (ph.fileId && await S.Files.get(ph.fileId));
        var blob = fr && fr.blob;
        if (!blob && ph.fileId) { var t = await S.Thumbs.get(ph.fileId); blob = t && t.blob; }
        if (blob && tile) {
          var u = URL.createObjectURL(blob);
          photoUrls.push(u);
          tile.style.backgroundImage = 'url("' + u + '")';
        }
      }
      $$('[data-ph]', grid).forEach(function (el) {
        el.onclick = function (e) {
          if (e.target.closest('[data-phdel]')) return;
          var ph = (rec.photos || []).filter(function (x) { return x.id === el.getAttribute('data-ph'); })[0];
          if (ph) openDriveFile({ id: ph.fileId || ph.id, name: ph.name, mime: ph.mime, local: !ph.fileId });
        };
      });
      $$('[data-phdel]', grid).forEach(function (b) {
        b.onclick = async function () {
          var id = b.getAttribute('data-phdel');
          var ph = (rec.photos || []).filter(function (x) { return x.id === id; })[0];
          var ok = await confirmBox('Foto entfernen?', ph && ph.fileId ? 'Das Foto wird aus dem Auftrag entfernt. Im Kundenordner in Google Drive bleibt es erhalten.' : 'Das Foto wurde noch nicht hochgeladen und wird verworfen.', 'Entfernen', true);
          if (!ok) return;
          await S.removeAuftragPhoto(rec, id);
          drawPhotos();
        };
      });
    }
    async function addPhotos(files, camera) {
      files = Array.prototype.slice.call(files || []);
      if (!files.length) return;
      for (var i = 0; i < files.length; i++) await S.addAuftragPhoto(rec, files[i], { camera: camera });
      toast(files.length === 1 ? 'Foto gespeichert' : files.length + ' Fotos gespeichert');
      if (!rec.customerId) toast('Fotos werden hochgeladen, sobald ein Kunde gewählt ist');
      drawPhotos();
    }
    $('#phCam').onchange = function () { addPhotos(this.files, true); this.value = ''; };
    $('#phLib').onchange = function () { addPhotos(this.files, false); this.value = ''; };

    // ---- Unterschriften ----
    async function drawSigs() {
      var prof = await S.Profile.get();
      [['kunde', '#sigKunde', 'Kunde / Auftraggeber'], ['monteur', '#sigMonteur', 'Monteur / Auftragnehmer']].forEach(function (k) {
        var box = $(k[1]);
        if (!box) return;
        var sg = (rec.sig || {})[k[0]];
        if (!S.hasSig(sg)) sg = null;
        box.innerHTML = '<div class="sig-title">' + k[2] + '</div>' +
          (sg ? '<img class="sig-img" alt="Unterschrift" src="' + sg.png + '"><div class="small muted">' + (sg.auto ? 'gespeicherte Unterschrift' : fmtDT(sg.at)) + '</div>' +
            '<div class="btn-row"><button type="button" class="btn small" data-sign>Neu unterschreiben</button><button type="button" class="btn small ghost danger" data-unsign>Entfernen</button></div>' :
            '<div class="btn-row"><button type="button" class="btn" data-sign>' + ICONS.pen + '<span>Unterschreiben</span></button>' +
            (k[0] === 'monteur' && prof.monteurSig ? '<button type="button" class="btn ghost small" data-mine>Meine einsetzen</button>' : '') + '</div>' +
            (k[0] === 'kunde' ? '<button type="button" class="linkbtn small" data-find>Verlorene Unterschrift suchen</button>' : ''));
        var b1 = $('[data-sign]', box), b2 = $('[data-unsign]', box), b3 = $('[data-mine]', box);
        b1.onclick = async function () {
          var r = await openSignaturePad(k[0] === 'kunde' ? 'Unterschrift Kunde' : 'Unterschrift Monteur', k[0] === 'monteur');
          if (!r) return;
          rec.sig = rec.sig || {};
          rec.sig[k[0]] = { png: r.png, at: Date.now() };
          markChanged(); drawSigs();
          persist(); // Unterschrift sofort sichern, nicht erst nach 0,5 s
          if (r.saveAsMine) { await S.Profile.set({ monteurSig: r.png, autoMonteur: true }); toast('Als deine Unterschrift gespeichert'); }
        };
        if (b2) b2.onclick = function () { rec.sig[k[0]] = { removed: true, at: Date.now() }; markChanged(); drawSigs(); persist(); };
        var b4 = $('[data-find]', box);
        if (b4) b4.onclick = function () { findLostSig(k[0]); };
        if (b3) b3.onclick = function () { rec.sig = rec.sig || {}; rec.sig.monteur = { png: prof.monteurSig, at: Date.now(), auto: true }; markChanged(); drawSigs(); persist(); };
      });
    }

    /** Ältere gespeicherte Stände durchsuchen und eine verlorene Unterschrift zurückholen */
    async function findLostSig(which) {
      if (!navigator.onLine) { toast('Suchen geht nur mit Internet', true); return; }
      var sheet = openModal('<div class="sheet-head"><h3>Verlorene Unterschrift suchen</h3><button class="btn small ghost" data-close aria-label="Schließen">' + ICONS.close + '</button></div>' +
        '<div class="sheet-body stack" id="lsBody"><div class="msg"><span class="spinner"></span> Ältere Stände werden durchsucht (bis ca. 1 Minute)…</div></div>');
      var j;
      try { await S.Sync.run(); j = await S.api('sigFind', { id: rec.id, which: which }, { timeout: 150000 }); }
      catch (e) { var b0 = $('#lsBody', sheet); if (b0) b0.innerHTML = '<div class="notice err">' + esc(e.message) + '</div>'; return; }
      var body = $('#lsBody', sheet);
      if (!body) return;
      if (!j.found.length) { body.innerHTML = '<div class="notice warn">In den letzten ' + j.scanned + ' gespeicherten Ständen keine Unterschrift für diesen Auftrag gefunden.</div>'; return; }
      body.innerHTML = '<div class="small muted">Gefunden in älteren Ständen – die richtige antippen:</div>' + j.found.map(function (x, i) {
        return '<button type="button" class="card pad" data-pick="' + i + '" style="text-align:left;width:100%"><img class="sig-img" alt="Unterschrift" src="' + x.png + '">' +
          '<div class="small muted">unterschrieben ' + (x.at ? fmtDT(x.at) : '–') + '</div></button>';
      }).join('');
      $$('[data-pick]', body).forEach(function (b) {
        b.onclick = function () {
          var x = j.found[Number(b.getAttribute('data-pick'))];
          rec.sig = rec.sig || {};
          rec.sig[which] = { png: x.png, at: Date.now(), restored: x.at || true };
          closeModal(); markChanged(); drawSigs(); persist();
          toast('Unterschrift wiederhergestellt');
        };
      });
    }

    // offene Nachfolgeaufträge bei diesem Kunden (Erinnerung vor Ort)
    async function drawNf() {
      var box = $('#nfBox');
      if (!box || !window.Nachfolge) return;
      var list = rec.customerId ? await window.Nachfolge.openFor(function (n) { return n.customerId === rec.customerId; }) : [];
      if (!$('#nfBox')) return;
      box.innerHTML = window.Nachfolge.noticeHtml(list, 'Noch offen bei diesem Kunden:') +
        (rec.nachfolgeId ? '<div class="small muted" style="margin-top:6px">Angelegt aus <a href="#/nachfolge/' + esc(rec.nachfolgeId) + '">Nachfolgeauftrag</a></div>' : '');
    }
    drawNf();

    drawCustomer();
    drawRows();
    drawPath();
    drawStatus();
    drawPhotos();
    drawSigs();
    drawZeiten();
    rerenderOn(['outbox', 'sync'], drawStatus);
    rerenderOn(['outbox'], drawPhotos);
    function onBlur() { setTimeout(function () { if (rerenderLater && !left && !busyNow()) { rerenderLater = false; router(); } }, 300); }
    view.addEventListener('focusout', onBlur);
    onCleanup(function () { view.removeEventListener('focusout', onBlur); });
    // Änderungen von anderen Geräten übernehmen (nur wenn gerade nicht getippt/unterschrieben wird)
    function editable(r) { return JSON.stringify([r.f, r.material, r.sig || {}, r.customerId, r.ablage, r.status, r.zeiten || []]); }
    rerenderOn(['auftraege'], async function () {
      var fresh = await S.Auftraege.get(rec.id);
      if (!fresh) return;
      if (fresh.deleted) { toast('Auftrag wurde auf einem anderen Gerät gelöscht'); location.hash = '#/auftraege'; return; }
      var busy = busyNow();
      if (fresh.updatedAt > rec.updatedAt && editable(fresh) !== editable(rec) && !fresh._dirty && !busy) {
        router();
        return;
      }
      // während getippt/unterschrieben wird: Änderungen des anderen Geräts einarbeiten statt sie zu überschreiben
      if (fresh.updatedAt > rec.updatedAt) { if (mergeRemote(fresh)) rerenderLater = true; }
      else {
        var ms = S.mergeSig(rec.sig, fresh.sig);
        if (JSON.stringify(ms) !== JSON.stringify(rec.sig || {})) { rec.sig = ms; drawSigs(); }
      }
      rec.drive = fresh.drive;
      rec.office = mergeOffice(rec, fresh);
      var photosChanged = JSON.stringify(rec.photos || []) !== JSON.stringify(fresh.photos || []);
      rec.photos = fresh.photos || [];
      if (photosChanged) drawPhotos();
      if (rec.customerId && rec.customerId.indexOf('tmp-') === 0 && fresh.customerId && fresh.customerId.indexOf('tmp-') !== 0) rec.customerId = fresh.customerId;
      if (rec.needsRefile && !fresh.needsRefile && fresh.updatedAt >= rec.updatedAt) rec.needsRefile = false;
      drawStatus();
    });
  }, 'auftraege');

  // ------------------------------------------------------------------
  // Unterschriftsfeld (Finger / Apple Pencil / Maus)
  // ------------------------------------------------------------------
  function openSignaturePad(title, withSave) {
    return new Promise(function (resolve) {
      var done = false;
      var sheet = openModal(
        '<div class="sheet-head"><h3>' + esc(title) + '</h3><button class="btn small ghost" data-close aria-label="Abbrechen">' + ICONS.close + '</button></div>' +
        '<div class="sheet-body stack"><div class="sig-pad"><canvas></canvas><div class="sig-line"></div><span class="sig-x">✕</span>' +
        '<span class="sig-hint">Hier unterschreiben</span></div>' +
        (withSave ? '<label class="check"><input type="checkbox" id="sigSave"> Als meine Unterschrift speichern und in neue Aufträge automatisch einsetzen</label>' : '') +
        '<div class="btn-row" style="justify-content:space-between"><button type="button" class="btn ghost" data-clear>Löschen</button>' +
        '<button type="button" class="btn primary" data-ok>Übernehmen</button></div></div>',
        { sticky: true, onClose: function () { if (!done) resolve(null); } });
      var pad = $('.sig-pad', sheet), canvas = $('canvas', pad), hint = $('.sig-hint', pad);
      var dpr = Math.min(window.devicePixelRatio || 1, 3);
      var ctx, ink = false, drawing = false, last = null, mid = null;
      function size() {
        var w = pad.clientWidth, h = Math.round(Math.min(280, Math.max(170, w * 0.4)));
        canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
        canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
        ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
        ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111'; ctx.lineWidth = 2.6;
        ink = false; hint.hidden = false;
      }
      setTimeout(size, 0);
      function pos(e) { var r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
      canvas.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        canvas.setPointerCapture(e.pointerId);
        drawing = true; last = pos(e); mid = last;
        ctx.beginPath(); ctx.arc(last.x, last.y, 1.2, 0, Math.PI * 2); ctx.fillStyle = '#111'; ctx.fill();
        ink = true; hint.hidden = true;
      });
      canvas.addEventListener('pointermove', function (e) {
        if (!drawing) return;
        e.preventDefault();
        var evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
        evs.forEach(function (ev) {
          var p = pos(ev);
          var m = { x: (last.x + p.x) / 2, y: (last.y + p.y) / 2 };
          ctx.beginPath(); ctx.moveTo(mid.x, mid.y); ctx.quadraticCurveTo(last.x, last.y, m.x, m.y); ctx.stroke();
          last = p; mid = m;
        });
      });
      function end() { drawing = false; }
      canvas.addEventListener('pointerup', end);
      canvas.addEventListener('pointercancel', end);
      $('[data-clear]', sheet).onclick = size;
      $('[data-ok]', sheet).onclick = function () {
        if (!ink) { toast('Bitte zuerst unterschreiben', true); return; }
        // auf den beschriebenen Bereich zuschneiden
        var w = canvas.width, h = canvas.height;
        var data = ctx.getImageData(0, 0, w, h).data;
        var x0 = w, y0 = h, x1 = 0, y1 = 0;
        for (var y = 0; y < h; y += 2) for (var x = 0; x < w; x += 2) {
          if (data[(y * w + x) * 4 + 3] > 20) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        }
        var padPx = Math.round(6 * dpr);
        x0 = Math.max(0, x0 - padPx); y0 = Math.max(0, y0 - padPx); x1 = Math.min(w, x1 + padPx); y1 = Math.min(h, y1 + padPx);
        var cw = x1 - x0, ch = y1 - y0;
        var f = Math.min(1, 900 / cw);
        var out = document.createElement('canvas');
        out.width = Math.max(1, Math.round(cw * f)); out.height = Math.max(1, Math.round(ch * f));
        out.getContext('2d').drawImage(canvas, x0, y0, cw, ch, 0, 0, out.width, out.height);
        var saveBox = $('#sigSave', sheet);
        done = true;
        var res = { png: out.toDataURL('image/png'), saveAsMine: !!(saveBox && saveBox.checked) };
        closeModal();
        resolve(res);
      };
    });
  }

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
      '<button class="btn chef-only" id="newCustomer">' + ICONS.plus + '<span>Neuer Kunde</span></button>' +
      '<div class="sub" id="idxInfo"></div><div class="sub" id="offInfo"></div></div>' +
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
    function offInfo() {
      var el = $('#offInfo'), o = window.Offline.state;
      if (!el) return;
      el.innerHTML = o.running ? '<a href="#/sync">Offline-Download läuft: ' + o.done + ' / ' + o.total + ' Dateien</a>' : '';
    }
    await draw();
    offInfo();
    rerenderOn(['index', 'sync'], draw);
    onCleanup(S.on('offline', offInfo));
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
      var nfHtml = '';
      if (isCustomer && s.role !== 'buero' && window.Nachfolge) {
        nfHtml = window.Nachfolge.noticeHtml(await window.Nachfolge.openFor(function (n) { return n.customerId === folderId; }), 'Noch offen (Nachfolgeaufträge):');
      }
      var custOffline = customer && off.has(customer.id);
      var allOffline = s.offlineMode === 'alles';
      var ro = s.role === 'buero';
      if (current !== me) return;
      view.innerHTML =
        '<nav class="breadcrumb"><a href="#/kunden">Kundendatenbank</a>' + crumbs.map(function (c) {
          return '<span class="sep">›</span><a href="#/ordner/' + encodeURIComponent(c.id) + '">' + esc(c.name.trim()) + '</a>';
        }).join('') + '</nav>' +
        '<div class="page-head"><h1>' + esc(folder.name.trim()) + '</h1></div>' +
        '<div class="btn-row" style="margin-bottom:14px">' +
        (customer && !ro ? '<a class="btn primary" href="#/auftrag/neu?kunde=' + encodeURIComponent(customer.id) + '">' + ICONS.plus + '<span>Arbeitsauftrag</span></a>' : '') +
        (customer ? '<a class="btn" href="#/termine/neu?kunde=' + encodeURIComponent(customer.id) + '">' + ICONS.plus + '<span>Termin</span></a>' : '') +
        (customer && !ro ? '<button type="button" class="btn" id="nfNewCust">' + ICONS.plus + '<span>Nachfolgeauftrag</span></button>' : '') +
        (ro ? '' : '<label class="btn">' + ICONS.camera + '<span>Foto aufnehmen</span><input type="file" accept="image/*" capture="environment" id="cam" hidden></label>' +
        '<label class="btn">' + ICONS.upload + '<span>Hochladen</span><input type="file" id="upl" multiple hidden></label>' +
        '<button class="btn" id="mkdir">Neuer Ordner</button>') +
        (customer && !allOffline && !ro ? '<button class="btn' + (custOffline ? ' primary' : '') + '" id="offTog">' + (custOffline ? '✓ Offline verfügbar' : 'Offline verfügbar machen') + '</button>' : '') +
        (folder.local ? '' : '<a class="btn ghost" target="_blank" rel="noopener" href="https://drive.google.com/drive/folders/' + esc(folder.id) + '">In Drive öffnen</a>') +
        '</div>' +
        nfHtml +
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
          var canThumb = /^image\//.test(it.mime || '') || it.mime === 'application/pdf';
          return '<button class="row" data-file="' + esc(it.id) + '"' + (canThumb ? ' data-thumb="' + esc(it.id) + '" data-mod="' + (it.modified || 0) + '"' : '') + '>' + fileIcon(it) + '<span class="main"><span class="title" style="display:block">' + esc(it.name) +
            '</span><span class="meta" style="display:block">' + (isCached ? '<span class="offline-dot" title="offline gespeichert"></span>' : '') +
            (it.local ? 'wird hochgeladen…' : [fmtDate(it.modified), fmtSize(it.size)].filter(Boolean).join(' · ')) + '</span></span></button>';
        }).join('') || '<div class="empty">Ordner ist leer</div>') + '</div>';

      $$('[data-file]').forEach(function (b) {
        b.onclick = function () { openDriveFile(S.Index.item(idx, b.getAttribute('data-file'))); };
      });
      async function up(files, camera) {
        files = Array.prototype.slice.call(files || []);
        if (!files.length) return;
        for (var i = 0; i < files.length; i++) await S.uploadFile(folderId, files[i], { camera: camera });
        toast((files.length === 1 ? (camera ? 'Foto' : '1 Datei') : files.length + ' Dateien') + (navigator.onLine ? ' wird hochgeladen' : ' gespeichert – Upload, sobald Internet da ist'));
        draw();
      }
      showThumbs(folderId);
      if (ro) return;
      var nfb = $('#nfNewCust');
      if (nfb) nfb.onclick = function () { window.Nachfolge.create({ customerId: customer.id, customerName: customer.name }); };
      $('#cam').onchange = function () { up(this.files, true); this.value = ''; };
      $('#upl').onchange = function () { up(this.files, false); this.value = ''; };
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
        window.Offline.run({ manual: true });
        draw();
      };
    }
    // Vorschaubilder: aus dem Speicher, sonst einmal pro Ordner vom Server
    var thumbUrls = [];
    var fetchedThumbs = false;
    onCleanup(function () { thumbUrls.forEach(function (u) { URL.revokeObjectURL(u); }); });
    async function showThumbs(fid) {
      var els = $$('[data-thumb]');
      var missing = 0;
      for (var i = 0; i < els.length; i++) {
        var el = els[i], id = el.getAttribute('data-thumb'), mod = Number(el.getAttribute('data-mod'));
        var t = await S.Thumbs.get(id, mod);
        var blob = t && t.blob;
        if (!blob) {
          var fr = await S.Files.get(id);
          if (fr && /^image\//.test(fr.mime || '')) blob = fr.blob;
        }
        if (!blob) { missing++; continue; }
        var ico = $('.ico', el);
        if (!ico || ico.classList.contains('thumb')) continue;
        var u = URL.createObjectURL(blob);
        thumbUrls.push(u);
        ico.classList.add('thumb');
        ico.innerHTML = '<img alt="" src="' + u + '">';
      }
      if (missing && !fetchedThumbs && navigator.onLine && current === me && fid.indexOf('tmp-') !== 0) {
        fetchedThumbs = true;
        try { var n = await S.Thumbs.fetchFolder(fid); if (n && current === me) showThumbs(fid); } catch (e) { /* ohne Vorschau weiter */ }
      }
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
      var opLabel = { createCustomer: 'Kundenordner anlegen', createFolder: 'Ordner anlegen', upload: 'Datei hochladen', fileAuftrag: 'Auftrag ablegen', uploadPhoto: 'Foto zum Auftrag' };
      var auftragNames = {};
      (await S.Auftraege.all()).forEach(function (a) { auftragNames[a.id] = auftragTitle(a); });
      if (current !== me) return;
      view.innerHTML =
        '<div class="page-head"><h1>Synchronisierung</h1>' +
        '<button class="btn primary" id="syncNow"' + (st.running ? ' disabled' : '') + '>' + (st.running ? '<span class="spinner"></span> ' + esc(st.phase || 'Läuft') + '…' : 'Jetzt synchronisieren') + '</button></div>' +
        (!S.backendConfigured() ? '<div class="notice warn">Das Google-Drive-Backend ist in dieser App-Version noch nicht eingetragen – alles wird vorerst nur auf diesem Gerät gespeichert.</div>' : '') +
        (S.backendConfigured() && !s.key ? '<div class="notice warn">Dieses Gerät ist noch nicht verbunden. <a href="#/setup">App-Schlüssel eingeben</a></div>' : '') +
        (st.authError ? '<div class="notice err">Der Zugang dieses Geräts wird nicht mehr akzeptiert. <a href="#/setup">Neu verbinden</a></div>' : '') +
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
          var what = o.type === 'fileAuftrag' || o.type === 'uploadPhoto' ? auftragNames[o.auftragId] || '' : o.name || '';
          return '<div class="row"><span class="main"><span class="title" style="display:block">' + esc(label) + (what ? ': ' + esc(what) : '') + '</span>' +
            '<span class="meta" style="display:block">' + (o.lastError ? 'Fehler: ' + esc(o.lastError) : (o.waitReason ? esc(o.waitReason) + ' · ' : '') + 'seit ' + fmtDT(o.createdAt)) + '</span></span>' +
            (o.lastError ? '<button class="btn small ghost danger" data-drop="' + o.id + '">Verwerfen</button>' : '') + '</div>';
        }).join('') || '<div class="empty">Nichts offen – alles ist synchron.</div>') + '</div>' +
        '<h2>Offline-Daten</h2><div class="card pad stack" id="offBox"></div>' +
        '<h2>Fotos &amp; Unterschrift</h2><div class="card pad stack" id="prefBox"></div>' +
        '<h2>Benachrichtigungen</h2><div class="card pad stack" id="pushBox"></div>' +
        '<h2>Geräte &amp; Zugänge</h2><div class="card pad stack" id="bueroBox"></div>' +
        '<h2>Gerät</h2>' +
        '<div class="btn-row">' +
        '<button class="btn" id="fullIndex">Kundendatenbank komplett neu laden</button>' +
        '<a class="btn" href="#/setup">Neu verbinden</a></div>' +
        '<h2>App installieren</h2>' +
        '<div class="card pad small stack">' +
        '<div><b>iPhone / iPad:</b> Seite in Safari öffnen → Teilen-Symbol → „Zum Home-Bildschirm“. Danach nur noch über das Symbol starten.</div>' +
        '<div><b>MacBook:</b> Safari → Ablage → „Zum Dock hinzufügen“ (oder Chrome → Installieren-Symbol in der Adressleiste).</div>' +
        '<div>Jedes Gerät einmal verbinden: dort den QR-Code anzeigen, am Master-Gerät scannen und freigeben. Danach gleicht sich alles automatisch ab – beim Start, alle paar Minuten und sobald wieder Internet da ist.</div></div>';
      $('#syncNow').onclick = function () { S.Sync.run(); };
      $('#fullIndex').onclick = function () { S.Sync.run({ fullIndex: true }); toast('Kundendatenbank wird neu geladen…'); };
      drawOffline(offNames);
      drawPrefs();
      renderPushBox($('#pushBox'));
      window.Geraete.renderBox($('#bueroBox'), drawBueroBox);
      $$('[data-drop]').forEach(function (b) {
        b.onclick = async function () {
          var ok = await confirmBox('Eintrag verwerfen?', 'Dieser Schritt wird nicht mehr zum Server übertragen.', 'Verwerfen', true);
          if (ok) { await S.Outbox.remove(b.getAttribute('data-drop')); draw(); }
        };
      });
    }
    // ---- Offline-Daten ----
    var estCache = null;
    async function drawOffline(offNames) {
      var box = $('#offBox');
      if (!box) return;
      var cfg = await window.Offline.settings();
      var fst = await S.Files.stats();
      if (!estCache || estCache.q !== cfg.quality || Date.now() - estCache.at > 60000) {
        var e = await window.Offline.estimate('alles', cfg.quality);
        estCache = { q: cfg.quality, at: Date.now(), e: e };
      }
      var e2 = estCache.e;
      if (current !== me || !$('#offBox')) return;
      box.innerHTML =
        '<div class="seg" role="radiogroup" aria-label="Was offline halten">' +
        '<button type="button" data-mode="aus" class="' + (cfg.mode !== 'alles' ? 'on' : '') + '">Nur ausgewählte Kunden</button>' +
        '<button type="button" data-mode="alles" class="' + (cfg.mode === 'alles' ? 'on' : '') + '">Komplette Kundendatenbank</button></div>' +
        '<div class="seg" role="radiogroup" aria-label="Qualität">' +
        '<button type="button" data-q="standard" class="' + (cfg.quality === 'standard' ? 'on' : '') + '">Standard (gut lesbar)</button>' +
        '<button type="button" data-q="klein" class="' + (cfg.quality === 'klein' ? 'on' : '') + '">Klein (spart mehr)</button></div>' +
        '<div class="small">Kundendatenbank im Original: <b>' + fmtSize(e2.original) + '</b> (' + e2.files + ' Dateien) · komprimiert auf dem Gerät ca. <b>' + fmtSize(e2.estimate) + '</b>. ' +
        'Fotos werden verkleinert, gescannte PDFs neu komprimiert – lesbar, aber deutlich kleiner. Originale bleiben in Google Drive und lassen sich bei Internet jederzeit öffnen.</div>' +
        '<div id="offProg"></div>' +
        '<div class="small muted">Auf diesem Gerät gespeichert: <b>' + fst.count + ' Dateien · ' + fmtSize(fst.bytes) + '</b>' + (fst.saved ? ' (gespart: ' + fmtSize(fst.saved) + ')' : '') + '</div>' +
        (cfg.mode !== 'alles' ? '<div class="small">Ausgewählte Kunden: ' + (offNames.length ? offNames.map(esc).join(' · ') : 'keine – im Kundenordner „Offline verfügbar machen“ tippen') + '</div>' : '') +
        '<label class="check"><input type="checkbox" id="offShare"' + (cfg.share ? ' checked' : '') + '> Komprimierte PDFs auch für die anderen Geräte in Drive ablegen (die müssen dann nicht neu rechnen)</label>' +
        '<div class="btn-row" id="offBtns"></div>';
      $$('[data-mode]', box).forEach(function (b) {
        b.onclick = async function () {
          var m = b.getAttribute('data-mode');
          if (m === 'alles') {
            var ok = await confirmBox('Komplette Kundendatenbank offline?', 'Es werden ca. ' + fmtSize(estCache.e.estimate) + ' auf diesem Gerät gespeichert. Der erste Download dauert je nach Verbindung 30–90 Minuten – am besten im WLAN, App dabei geöffnet lassen. Danach werden nur noch neue/geänderte Dateien nachgeladen.', 'Starten');
            if (!ok) return;
          }
          await S.Settings.set({ offlineMode: m });
          if (m === 'alles') window.Offline.run({ manual: true });
          drawOffline(offNames);
        };
      });
      $$('[data-q]', box).forEach(function (b) {
        b.onclick = async function () { await S.Settings.set({ offlineQuality: b.getAttribute('data-q') }); drawOffline(offNames); };
      });
      $('#offShare', box).onchange = function () { S.Settings.set({ offlineShare: this.checked }); };
      drawOfflineProgress();
    }
    function drawOfflineProgress() {
      var prog = $('#offProg'), btns = $('#offBtns');
      if (!prog || !btns) return;
      var o = window.Offline.state;
      var pct = o.total ? Math.round(o.done / o.total * 100) : 0;
      if (o.running || o.paused || (o.total && o.phase)) {
        var eta = '';
        if (o.running && o.done > 0 && o.startedAt) {
          var doneNow = o.done - (o._startDone || 0);
          var rate = doneNow / ((Date.now() - o.startedAt) / 1000);
          if (rate > 0) eta = ' · noch ca. ' + Math.max(1, Math.round((o.total - o.done) / rate / 60)) + ' Min.';
        }
        prog.innerHTML = '<div class="progress"><span style="width:' + pct + '%"></span></div>' +
          '<div class="small">' + o.done + ' / ' + o.total + ' Dateien (' + pct + ' %)' + (o.bytes ? ' · ' + fmtSize(o.bytes) + ' neu' : '') + eta +
          (o.failed ? ' · <span style="color:var(--red)">' + o.failed + ' fehlgeschlagen</span>' : '') +
          (o.running && o.current ? '<br><span class="muted">' + esc(o.current) + '</span>' : '') +
          (!o.running && o.phase === 'fertig' ? '<br><b>Fertig.</b>' : '') + (o.phase === 'pausiert' ? '<br>Pausiert.' : '') + '</div>';
      } else prog.innerHTML = '';
      btns.innerHTML = (o.running ? '<button type="button" class="btn" id="offPause">Pause</button>' :
        '<button type="button" class="btn primary" id="offStart">' + (o.paused ? 'Fortsetzen' : 'Jetzt offline laden / aktualisieren') + '</button>') +
        '<button type="button" class="btn ghost danger" id="offClear">Offline-Daten löschen</button>';
      var b;
      if ((b = $('#offPause'))) b.onclick = function () { window.Offline.pause(); };
      if ((b = $('#offStart'))) b.onclick = function () { if (!navigator.onLine) { toast('Gerade offline', true); return; } window.Offline.resume(); };
      $('#offClear').onclick = async function () {
        var ok = await confirmBox('Offline-Daten löschen?', 'Alle Offline-Kopien werden von diesem Gerät entfernt (in Google Drive bleibt alles). Noch nicht hochgeladene Fotos/Dateien bleiben erhalten.', 'Löschen', true);
        if (!ok) return;
        window.Offline.pause();
        await S.Settings.set({ offlineMode: 'aus' });
        await window.Offline.clearAll();
        toast('Offline-Daten gelöscht');
        draw();
      };
    }
    // ---- Büro-Zugang (Schlüssel für die Mitarbeiter) ----
    async function drawBueroBox(box) {
      if (!box) return;
      box.innerHTML = '<div class="small"><b>Bisheriger Büro-Schlüssel</b> (bis zur Umstellung auf QR-Code): Die Mitarbeiter im Büro nutzen dieselbe App-Adresse, aber mit eigenem <b>Büro-Schlüssel</b>. Sie sehen nur die Aufträge, die du ans Büro schickst (zum Drucken/Abrechnen), die Termine und die Kundendatenbank (nur lesen). Entwürfe und Einstellungen sehen sie nicht.</div>' +
        '<div id="okBox" class="small muted">' + (navigator.onLine ? '<span class="spinner"></span>' : 'Schlüssel nur online abrufbar.') + '</div>';
      if (!navigator.onLine) return;
      try {
        var j = await S.api('officeKey', {});
        var url = location.origin + location.pathname;
        if (!$('#okBox')) return;
        $('#okBox').outerHTML = '<dl class="kv"><dt>App-Adresse</dt><dd>' + esc(url) + '</dd><dt>Büro-Schlüssel</dt><dd><b class="key-input">' + esc(j.officeKey) + '</b></dd></dl>' +
          '<div class="btn-row"><button type="button" class="btn small" id="okCopy">Zugangsdaten kopieren</button><button type="button" class="btn small ghost danger" id="okNew">Neuen Büro-Schlüssel erzeugen</button></div>';
        $('#okCopy').onclick = async function () {
          var txt = 'ELUH App (Büro)\nAdresse: ' + url + '\nBüro-Schlüssel: ' + j.officeKey + '\n\nEinrichten: Adresse öffnen, Schlüssel und deinen Namen eingeben. Am iPhone/iPad danach über Teilen → „Zum Home-Bildschirm“ installieren.';
          try { await navigator.clipboard.writeText(txt); toast('Zugangsdaten kopiert'); } catch (e) { toast('Kopieren nicht möglich – bitte abschreiben', true); }
        };
        $('#okNew').onclick = async function () {
          var ok = await confirmBox('Neuen Büro-Schlüssel erzeugen?', 'Der alte Büro-Schlüssel funktioniert danach nicht mehr – alle Büro-Geräte müssen den neuen eingeben.', 'Neu erzeugen', true);
          if (!ok) return;
          await S.api('officeKey', { renew: true });
          drawBueroBox(box);
        };
      } catch (e) { if ($('#okBox')) $('#okBox').textContent = 'Konnte nicht geladen werden: ' + e.message; }
    }

    // ---- Fotos & Monteur-Unterschrift ----
    async function drawPrefs() {
      var box = $('#prefBox');
      if (!box) return;
      var s = await S.Settings.get();
      var prof = await S.Profile.get();
      box.innerHTML =
        '<label class="field"><span>Mein Name als Monteur (Stundennachweis)</span><input id="monName" value="' + esc(prof.monteurName || s.deviceName || '') + '" placeholder="z. B. Dominic Pfaue"></label>' +
        '<label class="check"><input type="checkbox" id="phSmall"' + (s.photoOriginal ? '' : ' checked') + '> Fotos vor dem Hochladen verkleinern (empfohlen: ca. 0,5–1 MB statt 3–5 MB, für Doku völlig ausreichend)</label>' +
        '<div><b class="small">Meine Unterschrift (Monteur)</b></div>' +
        (prof.monteurSig ? '<img class="sig-img" alt="Gespeicherte Unterschrift" src="' + prof.monteurSig + '">' : '<div class="small muted">Noch keine gespeichert.</div>') +
        '<label class="check"><input type="checkbox" id="autoSig"' + (prof.autoMonteur !== false ? ' checked' : '') + (prof.monteurSig ? '' : ' disabled') + '> Automatisch in neue Aufträge einsetzen</label>' +
        '<div class="btn-row"><button type="button" class="btn" id="mySig">' + ICONS.pen + '<span>' + (prof.monteurSig ? 'Neu unterschreiben' : 'Unterschrift hinterlegen') + '</span></button>' +
        (prof.monteurSig ? '<button type="button" class="btn ghost danger" id="mySigDel">Entfernen</button>' : '') + '</div>';
      $('#phSmall', box).onchange = function () { S.Settings.set({ photoOriginal: !this.checked }); };
      $('#monName', box).onchange = function () { S.Profile.set({ monteurName: this.value.trim() }); toast('Gespeichert'); };
      $('#autoSig', box).onchange = function () { S.Profile.set({ autoMonteur: this.checked }); };
      $('#mySig', box).onclick = async function () {
        var r = await openSignaturePad('Meine Unterschrift (Monteur)', false);
        if (!r) return;
        await S.Profile.set({ monteurSig: r.png, autoMonteur: true });
        toast('Unterschrift gespeichert – gilt auf allen Geräten');
        drawPrefs();
      };
      var d = $('#mySigDel', box);
      if (d) d.onclick = async function () { await S.Profile.set({ monteurSig: null }); drawPrefs(); };
    }
    await draw();
    rerenderOn(['sync', 'outbox', 'index'], draw);
    var wasRunning = window.Offline.state.running;
    var offOff = S.on('offline', function () {
      if (current !== me) return;
      drawOfflineProgress();
      if (wasRunning && !window.Offline.state.running) { estCache = null; draw(); }
      wasRunning = window.Offline.state.running;
    });
    onCleanup(offOff);
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
    var waitingWorker = null;
    // Update automatisch einspielen, sobald gerade nichts eingegeben/unterschrieben wird (Eingaben sind dann längst gespeichert)
    function safeToUpdate() {
      if (!modal.hidden) return false;
      var a = document.activeElement;
      if (a && a.matches && a.matches('input,textarea,select')) return false;
      return true;
    }
    function tryAutoUpdate() {
      if (waitingWorker && safeToUpdate()) { var w = waitingWorker; waitingWorker = null; w.postMessage('skipWaiting'); }
    }
    navigator.serviceWorker.register('sw.js').then(function (reg) {
      function offer(w) {
        waitingWorker = w;
        var bar = document.getElementById('updateBar');
        bar.hidden = false;
        document.getElementById('updateBtn').onclick = function () { waitingWorker = null; w.postMessage('skipWaiting'); };
        setTimeout(tryAutoUpdate, 1500);
      }
      window.addEventListener('hashchange', function () { setTimeout(tryAutoUpdate, 800); });
      document.addEventListener('focusout', function () { setTimeout(tryAutoUpdate, 2000); });
      if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
      reg.addEventListener('updatefound', function () {
        var w = reg.installing;
        w.addEventListener('statechange', function () {
          if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w);
        });
      });
      setInterval(function () { reg.update().catch(function () {}); }, 30 * 60 * 1000);
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden) { tryAutoUpdate(); reg.update().catch(function () {}); }
      });
      reg.update().catch(function () {}); // beim Start gleich nach neuer Version sehen
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
  document.addEventListener('DOMContentLoaded', async function () {
    await router();
    var s = await S.Settings.get();
    if (s.key && navigator.onLine && (!s.role || !s.vapidKey)) {
      try { await S.refreshPing(); router(); } catch (e) { /* später */ }
    }
    // bei jedem Start beim Server melden (inkl. Push-Abo) – höchstens alle 30 Minuten
    if (s.key && navigator.onLine && (!s.pushServer || Date.now() - (s.pushServer.at || 0) > 30 * 60 * 1000)) S.Push.register().catch(function () {});
    S.Sync.run();
    migrateNames().catch(function () {});
  });

  /** Einmalig (ab 2.6.0): Vornamen aus offenen Aufträgen und Terminen entfernen.
   *  Nur Felder, die noch genau den alten automatisch eingesetzten Wert haben; nichts Abgeschlossenes/Unterschriebenes. */
  async function migrateNames() {
    var s = await S.Settings.get();
    if (!s.key || s.namesMig1) return;
    var N = window.Names, n = 0;
    if (s.role !== 'buero') {
      var list = await S.Auftraege.all();
      for (var i = 0; i < list.length; i++) {
        var r = list[i];
        if (!r.customerName || r.status === 'fertig' || (r.sig && S.hasSig(r.sig.kunde)) || !r.f) continue;
        var o = N.parseCustomerOld(r.customerName), p = N.parseCustomer(r.customerName), ch = false;
        if (r.f.kunde_adresse === o.address && o.address !== p.address) { r.f.kunde_adresse = p.address; ch = true; }
        if (r.f.kunde_name === o.name && o.name !== p.name && p.name) { r.f.kunde_name = p.name; ch = true; }
        if (ch) { await S.Auftraege.save(r); n++; }
      }
    }
    var ts = await S.Termine.all();
    for (var j = 0; j < ts.length; j++) {
      var t = ts[j];
      if (!t.customerName) continue;
      var to = N.parseCustomerOld(t.customerName), tp = N.parseCustomer(t.customerName);
      if (t.address === to.address && to.address !== tp.address) { t.address = tp.address; await S.Termine.save(t); n++; }
    }
    await S.Settings.set({ namesMig1: Date.now() });
    if (n) console.log('Vornamen bereinigt:', n);
  }

  window.ELUH_APP = { router: router, toast: toast };
  // Hilfsfunktionen für die Zusatzmodule (Büro, Termine)
  window.UI = {
    route: route, view: view, esc: esc, $: $, $$: $$, toast: toast, openModal: openModal, closeModal: closeModal,
    confirmBox: confirmBox, choiceBox: choiceBox, ICONS: ICONS, fmtDate: fmtDate, fmtDT: fmtDT, fmtTime: fmtTime, isoToDe: isoToDe,
    debounce: debounce, matchQuery: matchQuery, auftragTitle: auftragTitle, auftragDate: auftragDate, officeStatus: officeStatus,
    auftragStatus: auftragStatus, showAuftragPdf: showAuftragPdf, openCustomerPicker: openCustomerPicker, parseCustomer: parseCustomer, rerenderOn: rerenderOn,
    onCleanup: onCleanup, current: function () { return current; }, renderPushBox: renderPushBox, isIOS: isIOS, fileIcon: fileIcon,
    openViewer: openViewer, printBlob: printBlob, downloadBlob: downloadBlob, inputBox: inputBox, applyCustomer: applyCustomer
  };
})();
