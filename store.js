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
      var req = indexedDB.open('eluh-app', 3);
      req.onupgradeneeded = function () {
        var d = req.result;
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
        if (!d.objectStoreNames.contains('auftraege')) d.createObjectStore('auftraege', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('files')) d.createObjectStore('files', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('outbox')) d.createObjectStore('outbox', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('thumbs')) d.createObjectStore('thumbs', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('termine')) d.createObjectStore('termine', { keyPath: 'id' });
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
    get: async function () {
      var s = (await DB.get('kv', 'settings')) || {};
      if (!s.deviceId) { s.deviceId = uid('dev-'); await DB.put('kv', s, 'settings'); }
      return s;
    },
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

  /** "9.10.2026 - Wartung" → 20261009, "2026" → 20260000 (für Sortierung) */
  function dateKey(name) {
    var n = String(name || '').trim();
    var m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(n);
    if (m) return Number(m[3]) * 10000 + Number(m[2]) * 100 + Number(m[1]);
    if (/^(19|20)\d{2}$/.test(n)) return Number(n) * 10000;
    return 0;
  }

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
        var da = dateKey(ra[1]), db = dateKey(rb[1]);
        if (da && db && da !== db) return db - da; // Termine/Jahre: neueste zuerst
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
      return list.filter(function (a) { return !a.deleted && a.kind !== 'profile'; });
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
        drive: null,
        photos: [],
        sig: {}
      };
      return Object.assign(rec, preset || {});
    }
  };

  // Profil (wird wie ein Auftrag synchronisiert, z.B. gespeicherte Monteur-Unterschrift)
  var Profile = {
    get: async function () { return (await DB.get('auftraege', 'profile')) || { id: 'profile', kind: 'profile', updatedAt: 0 }; },
    set: async function (patch) {
      var p = Object.assign(await Profile.get(), patch);
      return Auftraege.save(p);
    }
  };

  function isoDate(d) {
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  // ------------------------------------------------------------------
  // Bilder verkleinern (Fotos vor dem Hochladen, spart Datenvolumen + Drive-Speicher)
  // ------------------------------------------------------------------
  function loadImage(blob) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Bild nicht lesbar')); };
      img.src = url;
    });
  }
  async function shrinkImage(blob, maxPx, quality) {
    if (!/^image\/(jpeg|jpg|png|heic|heif|webp)$/i.test(blob.type || '')) return blob;
    try {
      var img = await loadImage(blob);
      var w = img.naturalWidth, h = img.naturalHeight;
      var f = Math.min(1, maxPx / Math.max(w, h));
      if (f >= 1 && /jpe?g/i.test(blob.type) && blob.size < 1.5e6) return blob;
      var c = document.createElement('canvas');
      c.width = Math.round(w * f); c.height = Math.round(h * f);
      var ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      var out = await new Promise(function (r) { c.toBlob(r, 'image/jpeg', quality || 0.85); });
      c.width = c.height = 0;
      return out && out.size < blob.size ? out : blob;
    } catch (e) { return blob; }
  }
  function photoName(prefix) {
    var d = new Date(), p = function (n) { return String(n).padStart(2, '0'); };
    return (prefix || 'Foto') + ' ' + d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + '-' + p(d.getMinutes()) + '-' + p(d.getSeconds()) + '.jpg';
  }
  /** Datei für den Upload vorbereiten: Fotos verkleinern, Kamera-Bilder sinnvoll benennen */
  async function prepareUpload(file, opts) {
    opts = opts || {};
    var s = await Settings.get();
    var isImg = /^image\//.test(file.type || '');
    var name = file.name || 'Datei';
    if (isImg && (opts.camera || /^image(\.\w+)?$/i.test(name) || /^IMG_\d+\.(heic|heif)$/i.test(name))) name = photoName('Foto');
    if (!isImg || s.photoOriginal) return { blob: file, name: name, mime: file.type || 'application/octet-stream' };
    var small = await shrinkImage(file, 2560, 0.85);
    if (small !== file) name = name.replace(/\.(heic|heif|png|webp|jpeg|jpg)$/i, '') + '.jpg';
    return { blob: small, name: name, mime: small.type || file.type };
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
    /** Original immer frisch vom Server (z.B. wenn offline nur eine verkleinerte Kopie liegt) */
    loadOriginal: async function (id) {
      var rid = await IdMap.resolve(id);
      var j = await api('getFile', { id: rid }, { timeout: 120000 });
      return { id: rid, name: j.name, mime: j.mime, blob: base64ToBlob(j.data, j.mime) };
    },
    stats: async function () {
      var st = await store('files');
      return new Promise(function (resolve, reject) {
        var out = { count: 0, bytes: 0, small: 0, saved: 0 };
        var req = st.openCursor();
        req.onsuccess = function () {
          var c = req.result;
          if (!c) return resolve(out);
          var v = c.value;
          out.count++; out.bytes += v.size || 0;
          if (v.small) { out.small++; out.saved += Math.max(0, (v.origSize || 0) - (v.size || 0)); }
          c.continue();
        };
        req.onerror = function () { reject(req.error); };
      });
    },
    clear: async function () { await DB.clear('files'); emit('files'); }
  };

  // ------------------------------------------------------------------
  // Vorschaubilder (klein, für Ordneransichten)
  // ------------------------------------------------------------------
  var Thumbs = {
    get: async function (id, modified) {
      var t = await DB.get('thumbs', id);
      if (t && (!modified || !t.modified || t.modified >= modified)) return t;
      return null;
    },
    fetchFolder: async function (folderId) {
      var j = await api('thumbs', { folderId: folderId, px: 240 }, { timeout: 60000 });
      for (var i = 0; i < j.thumbs.length; i++) {
        var t = j.thumbs[i];
        await DB.put('thumbs', { id: t.id, modified: t.modified, blob: base64ToBlob(t.data, t.mime) });
      }
      return j.thumbs.length;
    }
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
  async function uploadFile(parentId, file, opts) {
    var tmp = uid('tmp-');
    var prep = await prepareUpload(file, opts);
    await Files.put({ id: tmp, name: prep.name, mime: prep.mime, blob: prep.blob, size: prep.blob.size, modified: Date.now(), cachedAt: Date.now() });
    await Index.addLocal(tmp, [parentId, prep.name, 0, prep.mime, prep.blob.size, Date.now()]);
    await Outbox.add({ type: 'upload', tmpId: tmp, parentId: parentId, name: prep.name, mime: prep.mime });
    emit('index');
    return tmp;
  }

  /** Foto zum Auftrag: landet im selben Terminordner wie das Auftrags-PDF */
  async function addAuftragPhoto(rec, file, opts) {
    var prep = await prepareUpload(file, opts);
    var tmp = uid('tmp-');
    await Files.put({ id: tmp, name: prep.name, mime: prep.mime, blob: prep.blob, size: prep.blob.size, modified: Date.now(), cachedAt: Date.now() });
    rec.photos = rec.photos || [];
    rec.photos.push({ id: tmp, name: prep.name, mime: prep.mime, size: prep.blob.size, addedAt: Date.now() });
    await Auftraege.save(rec);
    await Outbox.add({ type: 'uploadPhoto', auftragId: rec.id, photoId: tmp });
    return tmp;
  }

  async function removeAuftragPhoto(rec, photoId) {
    rec.photos = (rec.photos || []).filter(function (p) { return p.id !== photoId; });
    await Auftraege.save(rec);
    var ops = await Outbox.all();
    for (var i = 0; i < ops.length; i++) {
      if (ops[i].type === 'uploadPhoto' && ops[i].photoId === photoId) { await Outbox.remove(ops[i].id); await DB.del('files', photoId); }
    }
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
    if (op.type === 'uploadPhoto') {
      var prec = await Auftraege.get(op.auftragId);
      if (!prec || prec.deleted) { await DB.del('files', op.photoId); return; }
      var ph = (prec.photos || []).filter(function (x) { return x.id === op.photoId; })[0];
      if (!ph) return;
      if (!prec.customerId && prec.status !== 'fertig') throw waitErr('Wartet auf Kundenauswahl im Auftrag');
      var pc = await IdMap.resolve(prec.customerId);
      if (pc && pc.indexOf('tmp-') === 0) throw waitErr();
      var pf = await Files.get(op.photoId);
      if (!pf) return;
      var r5 = await api('uploadToPath', {
        customerId: pc || null,
        segments: pc ? window.PdfGen.folderSegments(prec) : [],
        name: ph.name, mime: pf.mime, data: await blobToBase64(pf.blob)
      }, { timeout: 180000 });
      await IdMap.set(op.photoId, r5.fileId);
      pf.id = r5.fileId;
      await Files.put(pf);
      await DB.del('files', op.photoId);
      var fr = await Auftraege.get(prec.id);
      (fr.photos || []).forEach(function (x) { if (x.id === op.photoId) { x.id = r5.fileId; x.fileId = r5.fileId; x.name = r5.name; x.path = r5.path; x.uploadedAt = Date.now(); } });
      await Auftraege.save(fr);
      if (pc) for (var k = 0; k < (r5.items || []).length; k++) await Index.addServerRow(r5.items[k].id, r5.items[k].row);
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
        replaceId: rec.drive && rec.drive.fileId || null,
        extra: window.PdfGen.hasZeiten(rec) ? { name: window.PdfGen.stundenName(rec), data: await blobToBase64(new Blob([await window.PdfGen.buildStunden(rec)], { type: 'application/pdf' })) } : null,
        extraReplaceId: rec.drive && rec.drive.extraFileId || null,
        photoIds: (rec.photos || []).filter(function (x) { return x.fileId; }).map(function (x) { return x.fileId; })
      }, { timeout: 180000 });
      var fresh = await Auftraege.get(rec.id);
      fresh.customerId = cust || null;
      fresh.drive = { fileId: r4.fileId, folderId: r4.folderId, path: r4.path, url: r4.url, filedAt: Date.now(), filedVersion: rec.updatedAt, extraFileId: r4.extraFileId || null };
      if (fresh.updatedAt === rec.updatedAt) fresh.needsRefile = false;
      (fresh.photos || []).forEach(function (x) { if (x.fileId && (r4.moved || []).indexOf(x.fileId) >= 0) x.path = r4.path; });
      await Auftraege.save(fresh);
      if ((r4.moved || []).length) Sync.state.needIndex = true;
      for (var i = 0; i < (r4.items || []).length; i++) {
        if (cust) await Index.addServerRow(r4.items[i].id, r4.items[i].row);
      }
      return;
    }
  }

  function waitErr(msg) { var e = new Error(msg || 'Wartet auf vorherigen Schritt'); e.wait = true; return e; }

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
        var iv = null;
        if (s.role === 'buero') {
          Sync.state.phase = 'Aufträge';
          await syncOffice();
        } else {
          Sync.state.phase = 'Warteschlange';
          await processOutbox();
          Sync.state.phase = 'Aufträge';
          iv = await syncAuftraege();
        }
        Sync.state.phase = 'Termine';
        await syncTermine();
        Sync.state.phase = 'Kundendatenbank';
        await syncIndex(opts.forceIndex, opts.fullIndex, iv);
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
        emit('synced', { ok: !Sync.state.error });
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
        if (err.wait) {
          if (op.waitReason !== err.message) { op.waitReason = err.message; await DB.put('outbox', op); emit('outbox'); }
          continue;
        }
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

  var pdfjsReady = null;
  function loadPdfJs() {
    if (pdfjsReady) return pdfjsReady;
    pdfjsReady = new Promise(function (resolve, reject) {
      if (window.pdfjsLib) { window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdf.worker.min.js'; return resolve(window.pdfjsLib); }
      var sc = document.createElement('script');
      sc.src = 'pdf.min.js';
      sc.onload = function () { window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdf.worker.min.js'; resolve(window.pdfjsLib); };
      sc.onerror = function () { pdfjsReady = null; reject(new Error('PDF-Anzeige konnte nicht geladen werden')); };
      document.head.appendChild(sc);
    });
    return pdfjsReady;
  }

  // ------------------------------------------------------------------
  // Termine (Dominic + Büro, synchronisiert über termine.json)
  // ------------------------------------------------------------------
  var Termine = {
    all: async function () { return (await DB.all('termine')).filter(function (t) { return !t.deleted; }); },
    get: function (id) { return DB.get('termine', id); },
    save: async function (t) {
      t.updatedAt = Math.max(Date.now(), (t.updatedAt || 0) + 1);
      t._dirty = true;
      await DB.put('termine', t);
      emit('termine');
      Sync.schedule(800);
      return t;
    },
    remove: async function (t) { t.deleted = true; return Termine.save(t); },
    create: async function (preset) {
      var s = await Settings.get();
      return Object.assign({ id: uid('t-'), title: '', date: isoDate(new Date()), time: '', end: '', allDay: false, person: '', note: '', remind: [60], createdBy: s.deviceName || (s.role === 'buero' ? 'Büro' : 'Dominic'), createdAt: Date.now() }, preset || {});
    }
  };

  async function syncTermine() {
    var s = await Settings.get();
    var list = await DB.all('termine');
    var sent = {};
    var changes = list.filter(function (t) { return t._dirty; }).map(function (t) {
      sent[t.id] = t.updatedAt;
      var c = {};
      Object.keys(t).forEach(function (k) { if (k.charAt(0) !== '_') c[k] = t[k]; });
      return c;
    });
    var seq = (await DB.get('kv', 'termineSeq')) || 0;
    var j = await api('termine', { changes: changes, since: seq, deviceId: s.deviceId });
    var changed = false;
    for (var i = 0; i < j.records.length; i++) {
      var r = j.records[i];
      var local = await DB.get('termine', r.id);
      if (!local || !local._dirty || Number(r.updatedAt) >= Number(local.updatedAt)) { await DB.put('termine', r); changed = true; }
    }
    for (var id in sent) {
      var cur = await DB.get('termine', id);
      if (cur && cur._dirty && cur.updatedAt === sent[id]) { delete cur._dirty; await DB.put('termine', cur); changed = true; }
    }
    await DB.put('kv', j.seq, 'termineSeq');
    if (changed) emit('termine');
  }

  // ------------------------------------------------------------------
  // Büro: freigegebene Aufträge
  // ------------------------------------------------------------------
  var Office = {
    list: async function () { return (await DB.get('kv', 'officeList')) || []; },
    mark: async function (id, field, value) {
      var s = await Settings.get();
      var j = await api('officeMark', { id: id, field: field, value: value, by: s.deviceName || 'Büro' });
      var list = await Office.list();
      list.forEach(function (r) { if (r.id === id) r.office = j.office; });
      await DB.put('kv', list, 'officeList');
      emit('office');
      return j.office;
    }
  };
  async function syncOffice() {
    var j = await api('officeList', {});
    var old = JSON.stringify(await Office.list());
    await DB.put('kv', j.records, 'officeList');
    if (old !== JSON.stringify(j.records)) emit('office');
  }

  // ------------------------------------------------------------------
  // Push-Benachrichtigungen
  // ------------------------------------------------------------------
  function b64ToBytes(b64url) {
    var b = (b64url + '==='.slice((b64url.length + 3) % 4)).replace(/-/g, '+').replace(/_/g, '/');
    var raw = atob(b);
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  var Push = {
    supported: function () { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; },
    standalone: function () { return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; },
    status: async function () {
      if (!Push.supported()) return 'unsupported';
      if (Notification.permission === 'denied') return 'denied';
      try {
        var reg = await navigator.serviceWorker.getRegistration();
        var sub = reg && await reg.pushManager.getSubscription();
        return sub && Notification.permission === 'granted' ? 'on' : 'off';
      } catch (e) { return 'off'; }
    },
    enable: async function () {
      var s = await Settings.get();
      if (!s.vapidKey) await refreshPing();
      s = await Settings.get();
      var perm = await Notification.requestPermission();
      if (perm !== 'granted') throw new Error('Mitteilungen wurden nicht erlaubt');
      var reg = await navigator.serviceWorker.ready;
      var sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(s.vapidKey) });
      await api('pushSubscribe', { deviceId: s.deviceId, name: s.deviceName || '', subscription: sub.toJSON() });
      return true;
    },
    disable: async function () {
      var s = await Settings.get();
      try { var reg = await navigator.serviceWorker.getRegistration(); var sub = reg && await reg.pushManager.getSubscription(); if (sub) await sub.unsubscribe(); } catch (e) { /* */ }
      await api('pushSubscribe', { deviceId: s.deviceId, name: s.deviceName || '', subscription: null });
    },
    test: async function () { var s = await Settings.get(); return api('pushTest', { deviceId: s.deviceId }); },
    register: async function () {
      // Gerät (Name/Rolle) auch ohne Push bekannt machen, damit Erinnerungen zugeordnet werden können
      var s = await Settings.get();
      return api('pushSubscribe', { deviceId: s.deviceId, name: s.deviceName || '' });
    }
  };

  /** Rolle, Push-Schlüssel und Kalender-Link vom Server holen */
  async function refreshPing() {
    var j = await api('ping', {});
    await Settings.set({ role: j.role, vapidKey: j.vapidKey, icsToken: j.ics });
    return j;
  }

  window.addEventListener('online', function () { Sync.state.offline = false; Sync.schedule(200); });
  window.addEventListener('offline', function () { Sync.state.offline = true; emit('sync', Sync.state); });

  window.Store = {
    DB: DB, Settings: Settings, Index: Index, IdMap: IdMap, Auftraege: Auftraege, Files: Files,
    Outbox: Outbox, Sync: Sync, api: api, backendConfigured: backendConfigured,
    createCustomer: createCustomer, createFolder: createFolder, uploadFile: uploadFile, queueFiling: queueFiling,
    addAuftragPhoto: addAuftragPhoto, removeAuftragPhoto: removeAuftragPhoto, Profile: Profile, Thumbs: Thumbs,
    loadPdfJs: loadPdfJs, shrinkImage: shrinkImage,
    Termine: Termine, Office: Office, Push: Push, refreshPing: refreshPing,
    on: Sync.on, emit: emit, uid: uid, isoDate: isoDate, base64ToBlob: base64ToBlob, blobToBase64: blobToBase64
  };
})();
