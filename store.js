/* ELUH App – lokale Datenbank (IndexedDB) + Synchronisierung mit Google Drive */
(function () {
  'use strict';

  // ------------------------------------------------------------------
  // IndexedDB
  // ------------------------------------------------------------------
  var dbPromise = null;
  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      var req = indexedDB.open('eluh-app', 1);
      req.onupgradeneeded = function () {
        var d = req.result;
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
        if (!d.objectStoreNames.contains('auftraege')) d.createObjectStore('auftraege', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('files')) d.createObjectStore('files', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('outbox')) d.createObjectStore('outbox', { keyPath: 'id' });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbPromise;
  }

  function reqP(req) {
    return new Promise(function (resolve, reject) {
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  async function store(name, mode) {
    var d = await openDb();
    return d.transaction(name, mode || 'readonly').objectStore(name);
  }

  var DB = {
    get: async function (s, key) { return reqP((await store(s)).get(key)); },
    put: async function (s, val, key) {
      var st = await store(s, 'readwrite');
      return reqP(key === undefined ? st.put(val) : st.put(val, key));
    },
    del: async function (s, key) { return reqP((await store(s, 'readwrite')).delete(key)); },
    all: async function (s) { return reqP((await store(s)).getAll()); },
    clear: async function (s) { return reqP((await store(s, 'readwrite')).clear()); },
    keys: async function (s) { return reqP((await store(s)).getAllKeys()); }
  };

  // ------------------------------------------------------------------
  // Hilfen
  // ------------------------------------------------------------------
  function uid(prefix) {
    var r = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() :
      'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var v = Math.random() * 16 | 0; return (c === 'x' ? v : (v & 0x3 | 0x8)).toString(16);
      });
    return (prefix || '') + r;
  }

  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(String(fr.result).split(',')[1] || ''); };
      fr.onerror = function () { reject(fr.error); };
      fr.readAsDataURL(blob);
    });
  }
  function base64ToBlob(b64, mime) {
    var bin = atob(b64);
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime || 'application/octet-stream' });
  }

  var emitter = new EventTarget();
  function emit(type, detail) { emitter.dispatchEvent(new CustomEvent(type, { detail: detail })); }

  // ------------------------------------------------------------------
  // Einstellungen
  // ------------------------------------------------------------------
  var Settings = {
    get: async function () { return (await DB.get('kv', 'settings')) || {}; },
    set: async function (patch) {
      var s = Object.assign(await Settings.get(), patch);
      await DB.put('kv', s, 'settings');
      return s;
    }
  };

  // ------------------------------------------------------------------
  // Backend-Aufruf
  // ------------------------------------------------------------------
  function backendUrl() { return (window.ELUH_CONFIG || {}).BACKEND_URL || ''; }
  function backendConfigured() { var u = backendUrl(); return /^https:\/\/|^http:\/\/localhost[:/]/.test(u); }

  async function api(action, payload, opts) {
    var s = await Settings.get();
    if (!backendConfigured()) { var e0 = new Error('Backend noch nicht eingerichtet'); e0.offline = true; throw e0; }
    var key = (opts && opts.key) || s.key;
    if (!key) { var e1 = new Error('Kein App-Schlüssel hinterlegt'); e1.nokey = true; throw e1; }
    var body = JSON.stringify(Object.assign({ action: action, key: key }, payload || {}));
    var ctrl = new AbortController();
    var t = setTimeout(function () { ctrl.abort(); }, (opts && opts.timeout) || 90000);
    var res;
    try {
      // text/plain = "simple request" → kein CORS-Preflight (Apps Script beantwortet kein OPTIONS)
      res = await fetch(backendUrl(), {
        method: 'POST', body: body, signal: ctrl.signal, redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' }
      });
    } catch (err) {
      var e2 = new Error(navigator.onLine ? 'Server nicht erreichbar' : 'Offline');
      e2.offline = true;
      throw e2;
    } finally { clearTimeout(t); }
    if (!res.ok) { var e3 = new Error('Serverfehler ' + res.status); e3.offline = res.status >= 500; throw e3; }
    var j;
    try { j = await res.json(); } catch (err) { var e4 = new Error('Ungültige Serverantwort'); e4.offline = true; throw e4; }
    if (!j.ok) {
      var e5 = new Error(j.error === 'auth' ? 'App-Schlüssel ungültig' : (j.error || 'Fehler'));
      e5.auth = j.error === 'auth';
      throw e5;
    }
    return j;
  }

  // ------------------------------------------------------------------
  // Kundendatenbank-Index
  // items[id] = [parentId, name, isFolder, mime, size, modifiedMs]
  // Lokale, noch nicht hochgeladene Einträge stehen in "localItems".
  // ------------------------------------------------------------------
  var indexCache = null;
  var Index = {
    load: async function () {
      if (indexCache) return indexCache;
      var idx = (await DB.get('kv', 'index')) || { v: 0, root: null, items: {} };
      var local = (await DB.get('kv', 'localItems')) || {};
      indexCache = { v: idx.v, root: idx.root, items: idx.items, local: local, checkedAt: idx.checkedAt || 0 };
      buildChildren(indexCache);
      return indexCache;
    },
    invalidate: function () { indexCache = null; },
    saveServer: async function (data) {
      var cur = await Index.load();
      await DB.put('kv', { v: data.v, root: data.root, items: data.items, checkedAt: Date.now() }, 'index');
      // lokale Einträge, die der Server inzwischen kennt, nicht doppelt anzeigen
      indexCache = { v: data.v, root: data.root, items: data.items, local: cur.local, checkedAt: Date.now() };
      buildChildren(indexCache);
    },
    touchChecked: async function () {
      var raw = await DB.get('kv', 'index');
      if (raw) { raw.checkedAt = Date.now(); await DB.put('kv', raw, 'index'); }
      if (indexCache) indexCache.checkedAt = Date.now();
    },
    addLocal: async function (id, row) {
      var idx = await Index.load();
      idx.local[id] = row;
      await DB.put('kv', idx.local, 'localItems');
      buildChildren(idx);
    },
    removeLocal: async function (id) {
      var idx = await Index.load();
      delete idx.local[id];
      await DB.put('kv', idx.local, 'localItems');
      buildChildren(idx);
    },
    /** Echten Server-Eintrag sofort lokal einfügen (bis der nächste Index-Abgleich kommt). */
    addServerRow: async function (id, row) {
      var raw = (await DB.get('kv', 'index')) || { v: 0, root: null, items: {} };
      raw.items[id] = row;
      await DB.put('kv', raw, 'index');
      var idx = await Index.load();
      idx.items[id] = row;
      buildChildren(idx);
    },
    item: function (idx, id) {
      var r = idx.items[id] || idx.local[id];
      if (!r) return null;
      return { id: id, parent: r[0], name: r[1], folder: r[2] === 1, mime: r[3], size: r[4], modified: r[5], local: !idx.items[id] };
    },
    children: function (idx, id) {
      return (idx.children[id] || []).map(function (cid) { return Index.item(idx, cid); });
    },
    customers: function (idx) {
      if (!idx.root) return [];
      return Index.children(idx, idx.root).filter(function (c) { return c.folder; });
    },
    /** Kundenordner (direktes Kind der Kundendatenbank) eines beliebigen Eintrags */
    customerOf: function (idx, id) {
      var cur = Index.item(idx, id);
      var guard = 0;
      while (cur && cur.parent !== idx.root && guard++ < 30) cur = Index.item(idx, cur.parent);
      return cur && cur.parent === idx.root ? cur : null;
    },
    /** Alle Dateien unterhalb eines Ordners */
    filesBelow: function (idx, id) {
      var out = [];
      var stack = [id];
      while (stack.length) {
        var cur = stack.pop();
        Index.children(idx, cur).forEach(function (c) {
          if (c.folder) stack.push(c.id); else out.push(c);
        });
      }
      return out;
    },
    stats: function (idx) {
      var files = 0, folders = 0;
      Object.keys(idx.items).forEach(function (k) { if (idx.items[k][2] === 1) folders++; else files++; });
      return { files: files, folders: folders, customers: Index.customers(idx).length };
    }
  };

  function buildChildren(idx) {
    var ch = {};
    function add(map) {
      Object.keys(map).forEach(function (id) {
        var p = map[id][0];
        (ch[p] = ch[p] || []).push(id);
      });
    }
    add(idx.items);
    add(idx.local);
    Object.keys(ch).forEach(function (p) {
      ch[p].sort(function (a, b) {
        var ra = idx.items[a] || idx.local[a], rb = idx.items[b] || idx.local[b];
        if (ra[2] !== rb[2]) return rb[2] - ra[2];
        return String(ra[1]).localeCompare(String(rb[1]), 'de', { numeric: true, sensitivity: 'base' });
      });
    });
    idx.children = ch;
  }

  // ------------------------------------------------------------------
  // ID-Zuordnung: lokale Platzhalter-IDs (tmp-…) → echte Drive-IDs
  // ------------------------------------------------------------------
  var IdMap = {
    all: async function () { return (await DB.get('kv', 'idmap')) || {}; },
    set: async function (tmp, real) { var m = await IdMap.all(); m[tmp] = real; await DB.put('kv', m, 'idmap'); },
    resolve: async function (id) { if (!id || id.indexOf('tmp-') !== 0) return id; var m = await IdMap.all(); return m[id] || id; }
  };

  // ------------------------------------------------------------------
  // Arbeitsaufträge
  // ------------------------------------------------------------------
  var Auftraege = {
    all: async function () {
      var list = await DB.all('auftraege');
      return list.filter(function (a) { return !a.deleted; });
    },
    get: function (id) { return DB.get('auftraege', id); },
    save: async function (rec) {
      rec.updatedAt = Math.max(Date.now(), (rec.updatedAt || 0) + 1);
      rec._dirty = true;
      await DB.put('auftraege', rec);
      emit('auftraege');
      Sync.schedule(4000);
      return rec;
    },
    remove: async function (rec) {
      rec.deleted = true;
      await Auftraege.save(rec);
    },
    create: function (preset) {
      var today = new Date();
      var rec = {
        id: uid('a-'),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: 'entwurf',
        customerId: null,
        customerName: '',
        f: {
          auftrags_nr: '', datum_annahme: isoDate(today), kunde_name: '', kunde_name_zusatz: '',
          kunde_adresse: '', art: '', arbeitsumfang: '', ort_datum: '', datum_fertigstellung: '',
          mat_gesamt_summe: ''
        },
        material: [],
        ablage: { datum: isoDate(today), art: '' },
        drive: null
      };
      return Object.assign(rec, preset || {});
    }
  };

  function isoDate(d) {
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  // ------------------------------------------------------------------
  // Datei-Cache (offline verfügbare Dateien)
  // ------------------------------------------------------------------
  var Files = {
    get: function (id) { return DB.get('files', id); },
    put: function (rec) { return DB.put('files', rec); },
    cachedIds: async function () { return new Set(await DB.keys('files')); },
    /** Datei holen: erst lokal, sonst vom Server (und dann lokal speichern) */
    load: async function (id, meta) {
      var rid = await IdMap.resolve(id);
      var rec = await Files.get(rid) || await Files.get(id);
      if (rec && (!meta || !meta.modified || !rec.modified || rec.modified >= meta.modified || !navigator.onLine)) return rec;
      try {
        var j = await api('getFile', { id: rid }, { timeout: 120000 });
        var blob = base64ToBlob(j.data, j.mime);
        rec = { id: rid, name: j.name, mime: j.mime, blob: blob, size: blob.size, modified: meta && meta.modified || Date.now(), cachedAt: Date.now() };
        await Files.put(rec);
        emit('files');
        return rec;
      } catch (err) {
        if (rec) return rec;
        throw err;
      }
    },
    clear: async function () { await DB.clear('files'); emit('files'); }
  };

  // ------------------------------------------------------------------
  // Warteschlange (Outbox) – alles, was zum Server muss
  // ------------------------------------------------------------------
  var Outbox = {
    all: async function () {
      var l = await DB.all('outbox');
      return l.sort(function (a, b) { return a.createdAt - b.createdAt; });
    },
    add: async function (op) {
      op.id = op.id || uid('op-');
      op.createdAt = Date.now();
      op.tries = 0;
      await DB.put('outbox', op);
      emit('outbox');
      Sync.schedule(300);
      return op;
    },
    remove: async function (id) { await DB.del('outbox', id); emit('outbox'); }
  };

  /** Neuen Kundenordner anlegen (geht auch offline) */
  async function createCustomer(name) {
    var idx = await Index.load();
    var tmp = uid('tmp-');
    await Index.addLocal(tmp, [idx.root || 'root', name, 1, '', 0, Date.now()]);
    await Outbox.add({ type: 'createCustomer', tmpId: tmp, name: name });
    emit('index');
    return tmp;
  }

  async function createFolder(parentId, name) {
    var tmp = uid('tmp-');
    await Index.addLocal(tmp, [parentId, name, 1, '', 0, Date.now()]);
    await Outbox.add({ type: 'createFolder', tmpId: tmp, parentId: parentId, name: name });
    emit('index');
    return tmp;
  }

  /** Datei in einen Ordner der Kundendatenbank hochladen (geht auch offline) */
  async function uploadFile(parentId, file) {
    var tmp = uid('tmp-');
    await Files.put({ id: tmp, name: file.name, mime: file.type || 'application/octet-stream', blob: file, size: file.size, modified: Date.now(), cachedAt: Date.now() });
    await Index.addLocal(tmp, [parentId, file.name, 0, file.type || 'application/octet-stream', file.size, Date.now()]);
    await Outbox.add({ type: 'upload', tmpId: tmp, parentId: parentId, name: file.name, mime: file.type || 'application/octet-stream' });
    emit('index');
    return tmp;
  }

  /** Auftrag als PDF beim Kunden ablegen (wird beim nächsten Sync ausgeführt) */
  async function queueFiling(rec) {
    var ops = await Outbox.all();
    if (ops.some(function (o) { return o.type === 'fileAuftrag' && o.auftragId === rec.id; })) { Sync.schedule(300); return; }
    await Outbox.add({ type: 'fileAuftrag', auftragId: rec.id });
  }

  async function runOp(op) {
    var idx = await Index.load();
    if (op.type === 'createCustomer') {
      var r1 = await api('createCustomer', { name: op.name });
      await IdMap.set(op.tmpId, r1.item.id);
      await Index.addServerRow(r1.item.id, r1.item.row);
      await Index.removeLocal(op.tmpId);
      await remapAuftraege(op.tmpId, r1.item.id);
      await remapLocalParents(op.tmpId, r1.item.id);
      return;
    }
    if (op.type === 'createFolder') {
      var parent = await IdMap.resolve(op.parentId);
      if (parent.indexOf('tmp-') === 0) throw waitErr();
      var r2 = await api('createFolder', { parentId: parent, name: op.name });
      await IdMap.set(op.tmpId, r2.item.id);
      await Index.addServerRow(r2.item.id, r2.item.row);
      await Index.removeLocal(op.tmpId);
      await remapLocalParents(op.tmpId, r2.item.id);
      return;
    }
    if (op.type === 'upload') {
      var p2 = await IdMap.resolve(op.parentId);
      if (p2.indexOf('tmp-') === 0) throw waitErr();
      var f = await Files.get(op.tmpId);
      if (!f) return; // Datei existiert nicht mehr → nichts zu tun
      var data = await blobToBase64(f.blob);
      var r3 = await api('upload', { parentId: p2, name: op.name, mime: op.mime, data: data }, { timeout: 180000 });
      await IdMap.set(op.tmpId, r3.item.id);
      f.id = r3.item.id;
      f.modified = r3.item.row[5];
      await Files.put(f);
      await DB.del('files', op.tmpId);
      await Index.addServerRow(r3.item.id, r3.item.row);
      await Index.removeLocal(op.tmpId);
      return;
    }
    if (op.type === 'fileAuftrag') {
      var rec = await Auftraege.get(op.auftragId);
      if (!rec || rec.deleted || rec.status !== 'fertig') return;
      var cust = await IdMap.resolve(rec.customerId);
      if (cust && cust.indexOf('tmp-') === 0) throw waitErr();
      var bytes = await window.PdfGen.build(rec);
      var b64 = await blobToBase64(new Blob([bytes], { type: 'application/pdf' }));
      var a = rec.ablage || {};
      var segs = cust ? window.PdfGen.folderSegments(rec) : [];
      var r4 = await api('fileAuftrag', {
        customerId: cust || null,
        segments: segs,
        name: window.PdfGen.fileName(rec),
        data: b64,
        replaceId: rec.drive && rec.drive.fileId || null
      }, { timeout: 180000 });
      var fresh = await Auftraege.get(rec.id);
      fresh.customerId = cust || null;
      fresh.drive = { fileId: r4.fileId, folderId: r4.folderId, path: r4.path, url: r4.url, filedAt: Date.now(), filedVersion: rec.updatedAt };
      if (fresh.updatedAt === rec.updatedAt) fresh.needsRefile = false;
      await Auftraege.save(fresh);
      for (var i = 0; i < (r4.items || []).length; i++) {
        if (cust) await Index.addServerRow(r4.items[i].id, r4.items[i].row);
      }
      return;
    }
  }

  function waitErr() { var e = new Error('Wartet auf vorherigen Schritt'); e.wait = true; return e; }

  async function remapAuftraege(tmp, real) {
    var list = await DB.all('auftraege');
    for (var i = 0; i < list.length; i++) {
      if (list[i].customerId === tmp) { list[i].customerId = real; await Auftraege.save(list[i]); }
    }
  }
  async function remapLocalParents(tmp, real) {
    var idx = await Index.load();
    var changed = false;
    Object.keys(idx.local).forEach(function (k) { if (idx.local[k][0] === tmp) { idx.local[k][0] = real; changed = true; } });
    var ops = await Outbox.all();
    for (var i = 0; i < ops.length; i++) {
      if (ops[i].parentId === tmp) { ops[i].parentId = real; await DB.put('outbox', ops[i]); }
    }
    if (changed) { await DB.put('kv', idx.local, 'localItems'); Index.invalidate(); }
  }

  // ------------------------------------------------------------------
  // Synchronisierung
  // ------------------------------------------------------------------
  var Sync = {
    state: { running: false, lastOk: 0, error: null, offline: !navigator.onLine, pending: 0, phase: '' },
    _timer: null,
    _again: false,
    on: function (type, fn) {
      var h = function (e) { fn(e.detail); };
      emitter.addEventListener(type, h);
      return function () { emitter.removeEventListener(type, h); };
    },
    schedule: function (ms) {
      clearTimeout(Sync._timer);
      Sync._timer = setTimeout(function () { Sync.run(); }, ms == null ? 1500 : ms);
    },
    run: async function (opts) {
      opts = opts || {};
      if (Sync.state.running) { Sync._again = true; Sync._againOpts = Object.assign(Sync._againOpts || {}, opts); return; }
      var s = await Settings.get();
      Sync.state.pending = (await Outbox.all()).length + (await dirtyCount());
      if (!s.key || !backendConfigured()) { Sync.state.error = null; emit('sync', Sync.state); return; }
      Sync.state.running = true;
      Sync.state.error = null;
      emit('sync', Sync.state);
      try {
        Sync.state.phase = 'Warteschlange';
        await processOutbox();
        Sync.state.phase = 'Aufträge';
        var iv = await syncAuftraege();
        Sync.state.phase = 'Kundendatenbank';
        await syncIndex(opts.forceIndex, opts.fullIndex, iv);
        Sync.state.phase = 'Offline-Dateien';
        await syncOfflineFiles();
        Sync.state.lastOk = Date.now();
        Sync.state.offline = false;
        await Settings.set({ lastSync: Sync.state.lastOk });
      } catch (err) {
        Sync.state.error = err.message;
        Sync.state.offline = !!err.offline;
        if (err.auth) Sync.state.authError = true;
      } finally {
        Sync.state.running = false;
        Sync.state.phase = '';
        Sync.state.pending = (await Outbox.all()).length + (await dirtyCount());
        emit('sync', Sync.state);
        if (Sync._again) {
          var againOpts = Sync._againOpts || {};
          Sync._again = false; Sync._againOpts = null;
          setTimeout(function () { Sync.run(againOpts); }, 300);
        }
      }
    }
  };

  async function dirtyCount() {
    var list = await DB.all('auftraege');
    return list.filter(function (a) { return a._dirty; }).length;
  }

  async function processOutbox() {
    var ops = await Outbox.all();
    for (var i = 0; i < ops.length; i++) {
      var op = ops[i];
      try {
        await runOp(op);
        await Outbox.remove(op.id);
      } catch (err) {
        if (err.offline || err.auth) throw err;
        if (err.wait) continue;
        op.tries = (op.tries || 0) + 1;
        op.lastError = err.message;
        await DB.put('outbox', op);
        emit('outbox');
      }
    }
  }

  async function syncAuftraege() {
    var list = await DB.all('auftraege');
    var dirty = list.filter(function (a) { return a._dirty; });
    var sent = {};
    var changes = dirty.map(function (a) {
      sent[a.id] = a.updatedAt;
      var c = {};
      Object.keys(a).forEach(function (k) { if (k.charAt(0) !== '_') c[k] = a[k]; });
      return c;
    });
    var seq = (await DB.get('kv', 'seq')) || 0;
    var j = await api('sync', { changes: changes, since: seq });
    var changed = false;
    for (var i = 0; i < j.records.length; i++) {
      var r = j.records[i];
      var local = await DB.get('auftraege', r.id);
      if (!local || !local._dirty || Number(r.updatedAt) >= Number(local.updatedAt)) {
        await DB.put('auftraege', r);
        changed = true;
      }
    }
    // gesendete Datensätze als sauber markieren (falls inzwischen nicht erneut geändert)
    for (var id in sent) {
      var cur = await DB.get('auftraege', id);
      if (cur && cur._dirty && cur.updatedAt === sent[id]) { delete cur._dirty; await DB.put('auftraege', cur); changed = true; }
    }
    await DB.put('kv', j.seq, 'seq');
    if (changed) emit('auftraege');
    return j.iv || null;
  }

  async function syncIndex(force, full, serverVersion) {
    var idx = await Index.load();
    if (!force && !full && idx.v) {
      // Server meldet dieselbe Version → nichts zu laden
      if (serverVersion && serverVersion === idx.v) { await Index.touchChecked(); return; }
      if (!serverVersion && Date.now() - (idx.checkedAt || 0) < 30 * 1000) return;
    }
    var j = await api('index', { since: full ? 0 : idx.v, force: !!(force || full) }, { timeout: 120000 });
    if (j.unchanged) { await Index.touchChecked(); return; }
    await Index.saveServer(j);
    emit('index');
  }

  /** Dateien der als "offline verfügbar" markierten Kunden nachladen */
  async function syncOfflineFiles() {
    var s = await Settings.get();
    var list = s.offlineCustomers || [];
    if (!list.length) return;
    var idx = await Index.load();
    var cached = await Files.cachedIds();
    for (var i = 0; i < list.length; i++) {
      var files = Index.filesBelow(idx, list[i]);
      for (var k = 0; k < files.length; k++) {
        var f = files[k];
        if (f.local) continue;
        if (cached.has(f.id)) {
          var rec = await Files.get(f.id);
          if (!rec || !f.modified || rec.modified >= f.modified) continue;
        }
        if (f.size > 30 * 1024 * 1024) continue;
        await Files.load(f.id, f);
      }
    }
  }

  window.addEventListener('online', function () { Sync.state.offline = false; Sync.schedule(200); });
  window.addEventListener('offline', function () { Sync.state.offline = true; emit('sync', Sync.state); });

  window.Store = {
    DB: DB, Settings: Settings, Index: Index, IdMap: IdMap, Auftraege: Auftraege, Files: Files,
    Outbox: Outbox, Sync: Sync, api: api, backendConfigured: backendConfigured,
    createCustomer: createCustomer, createFolder: createFolder, uploadFile: uploadFile, queueFiling: queueFiling,
    on: Sync.on, emit: emit, uid: uid, isoDate: isoDate, base64ToBlob: base64ToBlob, blobToBase64: blobToBase64
  };
})();
