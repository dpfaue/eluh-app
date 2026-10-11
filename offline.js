/* ELUH App – Offline-Manager: lädt die Kundendatenbank (ganz oder je Kunde) platzsparend aufs Gerät.
   - Fotos kommen als verkleinerte Kopie (Drive-Vorschau, 1600 bzw. 1024 px) → ca. 90 % kleiner
   - Gescannte PDFs werden auf dem Gerät neu komprimiert (Seiten als JPEG, 130 bzw. 100 dpi)
     und als gemeinsame Kopie in Drive abgelegt, damit andere Geräte nicht erneut rechnen müssen
   - Originale bleiben unverändert in Google Drive und können jederzeit nachgeladen werden */
(function () {
  'use strict';
  var S = window.Store;
  var MAX_FILE = 30 * 1024 * 1024;

  var Q = {
    standard: { px: 1600, dpi: 130, maxSide: 1754, jpeg: 0.62, imgEst: 260 * 1024, pdfFactor: 0.13 },
    klein: { px: 1024, dpi: 100, maxSide: 1300, jpeg: 0.5, imgEst: 120 * 1024, pdfFactor: 0.07 }
  };

  var state = {
    running: false, paused: false, phase: '', done: 0, total: 0, failed: 0, bytes: 0,
    startedAt: 0, lastError: null, current: ''
  };
  var stopFlag = false;
  var wakeLock = null;

  function emit() { S.emit('offline', state); }

  async function settings() {
    var s = await S.Settings.get();
    return {
      mode: s.offlineMode || 'aus',               // 'aus' | 'alles'
      quality: s.offlineQuality || 'standard',    // 'standard' | 'klein'
      share: s.offlineShare !== false,            // komprimierte PDFs für andere Geräte in Drive ablegen
      customers: s.offlineCustomers || []
    };
  }

  /** Welche Dateien sollen offline liegen? */
  async function scopeFiles(cfg) {
    var idx = await S.Index.load();
    var list = [];
    var seen = {};
    var customers = S.Index.customers(idx);
    var wanted = cfg.mode === 'alles' ? customers : customers.filter(function (c) { return cfg.customers.indexOf(c.id) >= 0; });
    // zuletzt geänderte Kunden zuerst
    wanted.sort(function (a, b) { return (b.modified || 0) - (a.modified || 0); });
    wanted.forEach(function (c) {
      S.Index.filesBelow(idx, c.id).forEach(function (f) {
        if (f.local || seen[f.id] || f.size > MAX_FILE) return;
        seen[f.id] = true;
        list.push(f);
      });
    });
    return list;
  }

  async function failedMap() { return (await S.DB.get('kv', 'offlineFailed')) || {}; }

  async function pending(cfg, manual) {
    var files = await scopeFiles(cfg);
    var failed = await failedMap();
    var out = [];
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      // fehlgeschlagene Dateien nur einmal am Tag erneut versuchen (außer beim manuellen Start)
      if (!manual && failed[f.id] && Date.now() - failed[f.id].at < 24 * 3600 * 1000) continue;
      var rec = await S.Files.get(f.id);
      if (rec && (!f.modified || !rec.modified || rec.modified >= f.modified)) continue;
      out.push(f);
    }
    return { all: files, todo: out };
  }

  /** Grobe Schätzung: Speicherbedarf auf dem Gerät */
  async function estimate(mode, quality) {
    var cfg = await settings();
    cfg.mode = mode || cfg.mode;
    if (cfg.mode === 'aus') cfg.mode = 'alles';
    var q = Q[quality || cfg.quality] || Q.standard;
    var p = await pending(cfg);
    var est = 0, orig = 0, imgs = 0, pdfs = 0;
    p.all.forEach(function (f) {
      orig += f.size || 0;
      if (/^image\//.test(f.mime)) { imgs++; est += Math.min(f.size || q.imgEst, q.imgEst); }
      else if (f.mime === 'application/pdf') { pdfs++; est += Math.max(60 * 1024, (f.size || 0) * q.pdfFactor); }
      else est += f.size || 50 * 1024;
    });
    return { files: p.all.length, todo: p.todo.length, images: imgs, pdfs: pdfs, original: orig, estimate: est };
  }

  // ------------------------------------------------------------------
  // PDF auf dem Gerät komprimieren
  // ------------------------------------------------------------------
  async function compressPdf(bytes, quality) {
    var q = Q[quality] || Q.standard;
    var lib = await S.loadPdfJs();
    var src = await lib.getDocument({ data: bytes }).promise;
    if (src.numPages > 40) { await src.destroy(); return null; }
    var out = await window.PDFLib.PDFDocument.create();
    for (var i = 1; i <= src.numPages; i++) {
      var page = await src.getPage(i);
      var vp1 = page.getViewport({ scale: 1 });
      var scale = q.dpi / 72;
      var maxSide = q.maxSide;
      if (Math.max(vp1.width, vp1.height) * scale > maxSide) scale = maxSide / Math.max(vp1.width, vp1.height);
      var vp = page.getViewport({ scale: scale });
      var c = document.createElement('canvas');
      c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
      var ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      var blob = await new Promise(function (r) { c.toBlob(r, 'image/jpeg', q.jpeg); });
      c.width = c.height = 0;
      var jpg = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()));
      var p = out.addPage([vp1.width, vp1.height]);
      p.drawImage(jpg, { x: 0, y: 0, width: vp1.width, height: vp1.height });
      page.cleanup();
    }
    await src.destroy();
    return out.save();
  }

  // ------------------------------------------------------------------
  // Ablauf
  // ------------------------------------------------------------------
  async function lockScreen() {
    try { if (navigator.wakeLock && !wakeLock && !document.hidden) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { wakeLock = null; }
  }
  function unlockScreen() { try { if (wakeLock) wakeLock.release(); } catch (e) { /* */ } wakeLock = null; }
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && state.running) { wakeLock = null; lockScreen(); }
  });

  async function storeResult(f, res, cfg) {
    var bytes = S.base64ToBlob(res.data, res.mime);
    var rec = { id: f.id, name: f.name, mime: res.mime || f.mime, blob: bytes, size: bytes.size, modified: f.modified, cachedAt: Date.now(), small: !!res.small, q: cfg.quality, origSize: f.size };
    if (/^image\//.test(rec.mime) && !res.small) {
      // Server konnte keine Vorschau liefern → auf dem Gerät verkleinern
      var q0 = Q[cfg.quality] || Q.standard;
      var shrunk = await S.shrinkImage(bytes, q0.px, 0.72);
      if (shrunk && shrunk.size < bytes.size * 0.8) { rec.blob = shrunk; rec.size = shrunk.size; rec.mime = shrunk.type || 'image/jpeg'; rec.small = true; }
    }
    if (res.needsCompress) {
      state.current = 'Komprimiere ' + f.name;
      emit();
      var small = null;
      try { small = await compressPdf(new Uint8Array(await bytes.arrayBuffer()), cfg.quality); } catch (e) { small = null; }
      if (small && small.length < bytes.size * 0.8) {
        rec.blob = new Blob([small], { type: 'application/pdf' });
        rec.size = small.length;
        rec.small = true;
        if (cfg.share) {
          // für die anderen Geräte in Drive ablegen (Fehler sind unkritisch)
          S.api('putOfflineCopy', { id: f.id, modified: f.modified, q: cfg.quality, data: await S.blobToBase64(rec.blob) }, { timeout: 120000 }).catch(function () {});
        }
      }
    }
    await S.Files.put(rec);
    state.bytes += rec.size;
  }

  function batches(todo) {
    var out = [], cur = [], curSize = 0;
    todo.forEach(function (f) {
      var isImg = /^image\//.test(f.mime);
      var w = isImg ? 300 * 1024 : (f.size || 100 * 1024);
      if (cur.length && (cur.length >= (isImg ? 20 : 12) || curSize + w > 12 * 1024 * 1024)) { out.push(cur); cur = []; curSize = 0; }
      cur.push(f); curSize += w;
    });
    if (cur.length) out.push(cur);
    return out;
  }

  async function run(opts) {
    opts = opts || {};
    if (state.running) return;
    var s = await S.Settings.get();
    if (!s.key || !S.backendConfigured() || !navigator.onLine) return;
    var cfg = await settings();
    if (cfg.mode === 'aus' && !cfg.customers.length) return;
    if (state.paused && !opts.manual) return;
    var p = await pending(cfg, opts.manual);
    if (!p.todo.length) { state.total = p.all.length; state.done = p.all.length; state.phase = 'fertig'; emit(); return; }
    stopFlag = false;
    Object.assign(state, { running: true, paused: false, phase: 'lädt', done: p.all.length - p.todo.length, _startDone: p.all.length - p.todo.length, total: p.all.length, failed: 0, bytes: 0, startedAt: Date.now(), lastError: null, current: '' });
    emit();
    lockScreen();
    var queue = batches(p.todo);
    var failedIds = {};
    async function worker() {
      while (queue.length && !stopFlag && navigator.onLine) {
        var batch = queue.shift();
        try {
          var j = await S.api('getFiles', {
            q: cfg.quality,
            items: batch.map(function (f) { return { id: f.id, mime: f.mime, modified: f.modified, mode: 'small', q: cfg.quality }; })
          }, { timeout: 300000 });
          var byId = {};
          batch.forEach(function (f) { byId[f.id] = f; });
          for (var i = 0; i < j.files.length; i++) {
            var res = j.files[i];
            if (stopFlag) break;
            if (res.error) { state.failed++; failedIds[res.id] = res.error; state.done++; continue; }
            try { await storeResult(byId[res.id], res, cfg); }
            catch (e) { state.failed++; state.lastError = e.message; failedIds[res.id] = e.message; }
            state.done++;
            state.current = byId[res.id].name;
            emit();
          }
          if (j.rest && j.rest.length) queue.unshift(j.rest.map(function (id) { return byId[id]; }));
        } catch (e) {
          state.lastError = e.message;
          if (e.offline || e.auth) { stopFlag = true; break; }
          state.failed += batch.length;
          state.done += batch.length;
        }
        emit();
      }
    }
    try {
      await Promise.all([worker(), worker(), worker()]);
      var fm = await failedMap();
      Object.keys(failedIds).forEach(function (id) { fm[id] = { err: failedIds[id], at: Date.now() }; });
      await S.DB.put('kv', fm, 'offlineFailed');
    } finally {
      state.running = false;
      state.phase = stopFlag ? (state.paused ? 'pausiert' : 'unterbrochen') : 'fertig';
      state.current = '';
      unlockScreen();
      S.emit('files');
      emit();
    }
  }

  function pause() { state.paused = true; stopFlag = true; state.phase = 'pausiert'; emit(); }
  function resume() { state.paused = false; run({ manual: true }); }

  async function clearAll() {
    var ops = await S.Outbox.all();
    var keep = {};
    ops.forEach(function (o) { if (o.type === 'upload' || o.type === 'uploadPhoto') keep[o.tmpId || o.photoId] = true; });
    var keys = await S.DB.keys('files');
    for (var i = 0; i < keys.length; i++) if (!keep[keys[i]]) await S.DB.del('files', keys[i]);
    await S.DB.clear('thumbs');
    S.emit('files');
  }

  // nach jedem erfolgreichen Abgleich neue/geänderte Dateien automatisch nachladen
  S.on('synced', function (d) { if (d && d.ok) setTimeout(function () { run(); }, 1500); });

  window.Offline = { state: state, run: run, pause: pause, resume: resume, estimate: estimate, clearAll: clearAll, settings: settings, compressPdf: compressPdf, QUALITY: Q };
})();
