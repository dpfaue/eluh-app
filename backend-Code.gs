/**
 * ELUH App – Backend (Google Apps Script)
 * ------------------------------------------------------------
 * Läuft komplett im eigenen Google-Konto (dpfaue12@gmx.de).
 * Aufgaben:
 *  - Index der Kundendatenbank (alle Ordner + Dateien) aktuell halten
 *    (Drive-Änderungsprotokoll, alle 15 Min. + bei jedem App-Sync)
 *  - Arbeitsaufträge zwischen allen Geräten synchronisieren (auftraege.json)
 *  - Auftrags-PDFs beim Kunden ablegen: Kunde/Berichte/Jahr/"T.M.JJJJ - Art"/
 *  - Dateien aus der Kundendatenbank an die App liefern / hochladen
 *  - Neue Kundenordner anlegen
 *
 * Einrichtung: Funktion setup() einmal ausführen (Berechtigungen bestätigen),
 * danach "Bereitstellen → Neue Bereitstellung → Web-App" (Ausführen als: Ich,
 * Zugriff: Jeder). Der App-Schlüssel steht danach im Ausführungsprotokoll
 * (oder Funktion zeigeSchluessel() ausführen).
 */

var ROOT_ID_DEFAULT = '1lymePWA_YSkx8msRpU25hVrBDAhB4Qsd'; // Ordner "Kundendatenbank"
var DATA_FOLDER_NAME = 'ELUH-App Daten';
var BACKEND_VERSION = '1.1.0';
var CACHE_FOLDER_NAME = 'Offline-Kopien';
var MAX_BATCH_CHARS = 22 * 1024 * 1024;
var DRIVE_API = 'https://www.googleapis.com/drive/v3/';
var FILE_FIELDS = 'id,name,parents,mimeType,modifiedTime,size,trashed';
var FOLDER_MIME = 'application/vnd.google-apps.folder';
var MAX_FILE_BYTES = 30 * 1024 * 1024;

// ============================================================
// Einrichtung
// ============================================================

function setup() {
  var p = props_();
  if (!p.getProperty('APP_KEY')) p.setProperty('APP_KEY', makeKey_());
  if (!p.getProperty('ROOT_ID')) p.setProperty('ROOT_ID', ROOT_ID_DEFAULT);
  dataFolder_();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var h = t.getHandlerFunction();
    if (h === 'cronRefresh' || h === 'cronRebuild') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('cronRefresh').timeBased().everyMinutes(15).create();
  ScriptApp.newTrigger('cronRebuild').timeBased().atHour(3).everyDays(1).create();
  var idx = rebuildIndex_();
  Logger.log('Index aufgebaut: ' + Object.keys(idx.items).length + ' Einträge');
  Logger.log('APP-SCHLÜSSEL: ' + p.getProperty('APP_KEY'));
}

function zeigeSchluessel() {
  Logger.log('APP-SCHLÜSSEL: ' + props_().getProperty('APP_KEY'));
}

/** Neuen Schlüssel erzeugen (alter funktioniert danach nicht mehr). */
function neuerSchluessel() {
  props_().setProperty('APP_KEY', makeKey_());
  zeigeSchluessel();
}

function cronRefresh() { withLock_(function () { refreshIndex_(); }); }
function cronRebuild() { withLock_(function () { rebuildIndex_(); }); }

// ============================================================
// Web-App-Schnittstelle
// ============================================================

function doGet() {
  return json_({ ok: true, app: 'eluh-backend', version: BACKEND_VERSION });
}

function doPost(e) {
  var req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'Ungültige Anfrage' });
  }
  if (!checkKey_(req.key)) {
    Utilities.sleep(800);
    return json_({ ok: false, error: 'auth' });
  }
  try {
    var out = route_(req);
    out.ok = true;
    return json_(out);
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

var WRITE_ACTIONS = { upload: 1, createCustomer: 1, createFolder: 1, fileAuftrag: 1, uploadToPath: 1 };

function route_(req) {
  if (WRITE_ACTIONS[req.action]) props_().setProperty('LAST_REFRESH', '0');
  switch (req.action) {
    case 'ping':
      return { now: Date.now(), version: BACKEND_VERSION, root: rootId_() };
    case 'index':
      return apiIndex_(req);
    case 'sync':
      return apiSync_(req);
    case 'getFile':
      return apiGetFile_(req);
    case 'upload':
      return apiUpload_(req);
    case 'createCustomer':
      return apiCreateCustomer_(req);
    case 'createFolder':
      return apiCreateFolder_(req);
    case 'fileAuftrag':
      return apiFileAuftrag_(req);
    case 'getFiles':
      return apiGetFiles_(req);
    case 'putOfflineCopy':
      return apiPutOfflineCopy_(req);
    case 'thumbs':
      return apiThumbs_(req);
    case 'uploadToPath':
      return apiUploadToPath_(req);
    case 'about':
      return apiAbout_();
    case 'rebuildIndex':
      return withLock_(function () { var i = rebuildIndex_(); return { v: i.v, count: Object.keys(i.items).length }; });
    default:
      throw new Error('Unbekannte Aktion: ' + req.action);
  }
}

// ============================================================
// API-Funktionen
// ============================================================

/** Index der Kundendatenbank. Liefert nur Daten, wenn sich seit "since" etwas geändert hat. */
function refreshIfStale_(force) {
  var last = Number(props_().getProperty('LAST_REFRESH') || 0);
  if (force || Date.now() - last > 45 * 1000) return refreshIndex_();
  return null;
}

function apiIndex_(req) {
  var idx = withLock_(function () {
    return refreshIfStale_(req.force) || readJson_('index.json');
  });
  if (!idx) idx = withLock_(function () { return rebuildIndex_(); });
  if (req.since && Number(req.since) === idx.v) return { unchanged: true, v: idx.v };
  return { v: idx.v, root: idx.root, items: idx.items };
}

/**
 * Arbeitsaufträge synchronisieren.
 * req.changes: geänderte Datensätze vom Gerät (mit updatedAt in ms)
 * req.since:   letzte bekannte Server-Sequenznummer des Geräts
 * Antwort: alle Datensätze mit seq > since + neue Sequenznummer
 * Konfliktregel: neuerer updatedAt gewinnt.
 */
function apiSync_(req) {
  return withLock_(function () {
    var db = readJson_('auftraege.json') || { seq: 0, records: {} };
    var changed = false;
    (req.changes || []).forEach(function (r) {
      if (!r || !r.id) return;
      var ex = db.records[r.id];
      if (!ex || Number(r.updatedAt || 0) > Number(ex.updatedAt || 0)) {
        db.seq += 1;
        r.seq = db.seq;
        db.records[r.id] = r;
        changed = true;
      }
    });
    if (changed) writeJson_('auftraege.json', db);
    var since = Number(req.since || 0);
    var out = [];
    Object.keys(db.records).forEach(function (id) {
      var r = db.records[id];
      if (Number(r.seq || 0) > since) out.push(r);
    });
    // aktuelle Index-Version mitliefern, damit Geräte Änderungen in Drive sofort bemerken
    var iv = null;
    try {
      var fresh = refreshIfStale_(false);
      iv = fresh ? fresh.v : Number(props_().getProperty('IDX_V') || 0) || null;
    } catch (e) { /* Index-Fehler sollen den Auftrags-Sync nicht blockieren */ }
    return { seq: db.seq, records: out, iv: iv };
  });
}

function apiGetFile_(req) {
  var f = DriveApp.getFileById(req.id);
  assertAllowed_(f);
  var mime = f.getMimeType();
  var blob = mime.indexOf('application/vnd.google-apps') === 0 ? f.getAs('application/pdf') : f.getBlob();
  var bytes = blob.getBytes();
  if (bytes.length > MAX_FILE_BYTES) throw new Error('Datei zu groß für die App (' + Math.round(bytes.length / 1048576) + ' MB)');
  return { id: f.getId(), name: f.getName(), mime: blob.getContentType(), data: Utilities.base64Encode(bytes) };
}

function apiUpload_(req) {
  var folder = DriveApp.getFolderById(req.parentId);
  assertAllowed_(folder);
  var blob = Utilities.newBlob(Utilities.base64Decode(req.data), req.mime || 'application/octet-stream', req.name);
  var file = folder.createFile(blob);
  if (req.replaceId) trashQuietly_(req.replaceId);
  return { item: rowFromDriveApp_(file, folder.getId()) };
}

function apiCreateCustomer_(req) {
  var name = String(req.name || '').trim();
  if (!name) throw new Error('Kein Kundenname');
  var root = DriveApp.getFolderById(rootId_());
  var existing = findChildFolder_(root, name);
  var folder = existing || root.createFolder(name);
  return { item: rowFromDriveApp_(folder, root.getId()), existed: !!existing };
}

function apiCreateFolder_(req) {
  var parent = DriveApp.getFolderById(req.parentId);
  assertAllowed_(parent);
  var name = String(req.name || '').trim();
  if (!name) throw new Error('Kein Ordnername');
  var existing = findChildFolder_(parent, name);
  var folder = existing || parent.createFolder(name);
  return { item: rowFromDriveApp_(folder, parent.getId()) };
}

/**
 * Auftrags-PDF ablegen.
 * req.customerId: Kundenordner (oder leer → "ELUH-App Daten/Nicht zugeordnet")
 * req.segments:   z.B. ["Berichte", "2026", "11.10.2026 - Wartung"]
 * req.name, req.data (Base64), req.replaceId (alte Version → Papierkorb)
 */
function apiFileAuftrag_(req) {
  var base, segments;
  if (req.customerId) {
    base = DriveApp.getFolderById(req.customerId);
    assertAllowed_(base);
    segments = req.segments || [];
  } else {
    base = dataFolder_();
    segments = ['Nicht zugeordnet'];
  }
  var ep = ensurePath_(base, segments);
  var folder = ep.folder, path = ep.path, created = ep.created;
  var name = uniqueName_(folder, req.name, req.replaceId);
  var blob = Utilities.newBlob(Utilities.base64Decode(req.data), 'application/pdf', name);
  var file = folder.createFile(blob);
  if (req.replaceId && req.replaceId !== file.getId()) trashQuietly_(req.replaceId);
  var moved = movePhotos_(req.photoIds || [], folder);
  return {
    fileId: file.getId(),
    folderId: folder.getId(),
    path: path,
    url: file.getUrl(),
    moved: moved,
    items: created.concat([rowFromDriveApp_(file, folder.getId())])
  };
}


// ============================================================
// Offline-Kopien, Vorschaubilder, Fotos (ab Version 1.1)
// ============================================================

/** Ordnerkette anlegen bzw. vorhandene Ordner wiederverwenden (Namen ohne Leerzeichen am Ende vergleichen) */
function ensurePath_(base, segments) {
  var created = [];
  var folder = base;
  var path = [base.getName().trim()];
  (segments || []).forEach(function (seg) {
    var s = String(seg).trim();
    if (!s) return;
    var child = findChildFolder_(folder, s);
    if (!child) {
      child = folder.createFolder(s);
      created.push(rowFromDriveApp_(child, folder.getId()));
    }
    folder = child;
    path.push(child.getName().trim());
  });
  return { folder: folder, path: path, created: created };
}

/** Datei (z.B. Foto) in Kunde/Berichte/Jahr/Termin ablegen */
function apiUploadToPath_(req) {
  var base, segments;
  if (req.customerId) {
    base = DriveApp.getFolderById(req.customerId);
    assertAllowed_(base);
    segments = req.segments || [];
  } else {
    base = dataFolder_();
    segments = ['Nicht zugeordnet'];
  }
  var ep = ensurePath_(base, segments);
  var name = uniqueName_(ep.folder, req.name, null);
  var blob = Utilities.newBlob(Utilities.base64Decode(req.data), req.mime || 'application/octet-stream', name);
  var file = ep.folder.createFile(blob);
  return {
    fileId: file.getId(), folderId: ep.folder.getId(), path: ep.path, name: name,
    items: ep.created.concat([rowFromDriveApp_(file, ep.folder.getId())])
  };
}

/** Fotos eines Auftrags in den (endgültigen) Terminordner verschieben; leer gewordene Terminordner entfernen */
function movePhotos_(ids, folder) {
  var moved = [];
  var oldParents = {};
  ids.forEach(function (id) {
    try {
      var f = DriveApp.getFileById(id);
      assertAllowed_(f);
      var inside = false;
      var ps = f.getParents();
      var parentList = [];
      while (ps.hasNext()) { var p = ps.next(); parentList.push(p); if (p.getId() === folder.getId()) inside = true; }
      if (inside) return;
      f.moveTo(folder);
      moved.push(id);
      parentList.forEach(function (p) { oldParents[p.getId()] = p; });
    } catch (e) { /* Foto evtl. gelöscht */ }
  });
  Object.keys(oldParents).forEach(function (pid) {
    var p = oldParents[pid];
    if (/^\d{1,2}\.\d{1,2}\.\d{4} - /.test(p.getName().trim()) && !p.getFiles().hasNext() && !p.getFolders().hasNext()) {
      try { p.setTrashed(true); } catch (e) { /* egal */ }
    }
  });
  return moved;
}

function authHeaders_() { return { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }; }

/** Vorschaubild-Links mehrerer Dateien parallel holen */
function thumbLinks_(ids) {
  if (!ids.length) return {};
  var reqs = ids.map(function (id) {
    return { url: DRIVE_API + 'files/' + id + '?fields=thumbnailLink&supportsAllDrives=true', headers: authHeaders_(), muteHttpExceptions: true };
  });
  var res = UrlFetchApp.fetchAll(reqs);
  var out = {};
  res.forEach(function (r, i) {
    if (r.getResponseCode() === 200) {
      var j = JSON.parse(r.getContentText());
      if (j.thumbnailLink) out[ids[i]] = j.thumbnailLink;
    }
  });
  return out;
}

/** Verkleinerte Bilder (JPEG) über die Drive-Vorschau laden – spart bei Fotos ca. 90 % */
function fetchThumbs_(links, px) {
  var ids = Object.keys(links);
  if (!ids.length) return {};
  var reqs = ids.map(function (id) {
    return { url: String(links[id]).replace(/=s\d+(-[a-z])?$/, '') + '=s' + px, headers: authHeaders_(), muteHttpExceptions: true };
  });
  var res = UrlFetchApp.fetchAll(reqs);
  var out = {};
  res.forEach(function (r, i) {
    if (r.getResponseCode() === 200) {
      var b = r.getBlob();
      var bytes = b.getBytes();
      if (bytes.length > 500) out[ids[i]] = { mime: b.getContentType() || 'image/jpeg', data: Utilities.base64Encode(bytes), size: bytes.length };
    }
  });
  return out;
}

function cacheFolder_() {
  var p = props_();
  var id = p.getProperty('CACHE_FOLDER_ID');
  if (id) {
    try { var f = DriveApp.getFolderById(id); if (!f.isTrashed()) return f; } catch (e) { /* neu */ }
  }
  var data = dataFolder_();
  var it = data.getFoldersByName(CACHE_FOLDER_NAME);
  var folder = it.hasNext() ? it.next() : data.createFolder(CACHE_FOLDER_NAME);
  p.setProperty('CACHE_FOLDER_ID', folder.getId());
  return folder;
}

function cacheName_(id, modified, q) { return id + '_' + Number(modified || 0) + '_' + (q || 'standard') + '.pdf'; }

function findCache_(id, modified, q) {
  var it = cacheFolder_().getFilesByName(cacheName_(id, modified, q));
  while (it.hasNext()) { var f = it.next(); if (!f.isTrashed()) return f; }
  return null;
}

function isAllowedFast_(idx, id) {
  if (idx && idx.items[id]) return true;
  try { assertAllowed_(DriveApp.getFileById(id)); return true; } catch (e) { return false; }
}

/**
 * Mehrere Dateien auf einmal laden (für "Alles offline").
 * items: [{id, mime, modified, mode: 'small'|'orig', q: 'standard'|'klein'}]
 * Bilder kommen bei mode=small verkleinert, PDFs aus dem geteilten Komprimier-Cache
 * (falls vorhanden), sonst im Original mit needsCompress=true.
 */
function apiGetFiles_(req) {
  var idx = readJson_('index.json');
  var items = (req.items || []).slice(0, 60);
  var px = req.q === 'klein' ? 1024 : 1600;
  var smallImgs = items.filter(function (it) { return it.mode === 'small' && /^image\//.test(it.mime || '') && isAllowedFast_(idx, it.id); });
  var thumbs = {};
  try { thumbs = fetchThumbs_(thumbLinks_(smallImgs.map(function (x) { return x.id; })), px); } catch (e) { thumbs = {}; }
  var out = [], rest = [], total = 0;
  items.forEach(function (it) {
    if (total > MAX_BATCH_CHARS) { rest.push(it.id); return; }
    try {
      if (!isAllowedFast_(idx, it.id)) throw new Error('Kein Zugriff');
      var res;
      if (thumbs[it.id]) {
        res = { id: it.id, mime: thumbs[it.id].mime, data: thumbs[it.id].data, small: true };
      } else if (it.mode === 'small' && it.mime === 'application/pdf') {
        var c = findCache_(it.id, it.modified, it.q);
        if (c) {
          res = { id: it.id, mime: 'application/pdf', data: Utilities.base64Encode(c.getBlob().getBytes()), small: true, cached: true };
        } else {
          res = originalFile_(it.id);
          res.needsCompress = true;
        }
      } else {
        res = originalFile_(it.id);
      }
      total += res.data.length;
      out.push(res);
    } catch (e) {
      out.push({ id: it.id, error: String(e && e.message || e) });
    }
  });
  return { files: out, rest: rest };
}

function originalFile_(id) {
  var f = DriveApp.getFileById(id);
  var mime = f.getMimeType();
  var blob = mime.indexOf('application/vnd.google-apps') === 0 ? f.getAs('application/pdf') : f.getBlob();
  var bytes = blob.getBytes();
  if (bytes.length > MAX_FILE_BYTES) throw new Error('Datei zu groß (' + Math.round(bytes.length / 1048576) + ' MB)');
  return { id: id, mime: blob.getContentType(), data: Utilities.base64Encode(bytes), small: false };
}

/** Auf einem Gerät komprimiertes PDF für alle anderen Geräte im Cache ablegen */
function apiPutOfflineCopy_(req) {
  var q = apiAbout_();
  if (q.limit && q.limit - q.usage < 500 * 1024 * 1024) return { stored: false, reason: 'Drive-Speicher fast voll' };
  var folder = cacheFolder_();
  var name = cacheName_(req.id, req.modified, req.q);
  if (findCache_(req.id, req.modified, req.q)) return { stored: true, existed: true };
  // ältere Kopien derselben Datei entfernen
  var old = folder.searchFiles('title contains "' + String(req.id).replace(/"/g, '') + '_"');
  while (old.hasNext()) { var o = old.next(); if (o.getName().indexOf(req.id + '_') === 0) o.setTrashed(true); }
  folder.createFile(Utilities.newBlob(Utilities.base64Decode(req.data), 'application/pdf', name));
  return { stored: true };
}

/** Kleine Vorschaubilder für alle Bilder/PDFs eines Ordners */
function apiThumbs_(req) {
  var folder = DriveApp.getFolderById(req.folderId);
  assertAllowed_(folder);
  var r = driveApi_('files', {
    q: "'" + req.folderId + "' in parents and trashed=false", pageSize: 200,
    fields: 'files(id,mimeType,modifiedTime,thumbnailLink)', supportsAllDrives: true, includeItemsFromAllDrives: true
  });
  var links = {}, mod = {};
  (r.files || []).forEach(function (f) {
    if (f.thumbnailLink && (/^image\//.test(f.mimeType) || f.mimeType === 'application/pdf')) {
      links[f.id] = f.thumbnailLink;
      mod[f.id] = Date.parse(f.modifiedTime);
    }
  });
  var ids = Object.keys(links).slice(0, 80);
  var sub = {};
  ids.forEach(function (id) { sub[id] = links[id]; });
  var th = fetchThumbs_(sub, req.px || 240);
  return { thumbs: Object.keys(th).map(function (id) { return { id: id, modified: mod[id], mime: th[id].mime, data: th[id].data }; }) };
}

function apiAbout_() {
  var a = driveApi_('about', { fields: 'storageQuota' }).storageQuota || {};
  return { limit: a.limit ? Number(a.limit) : 0, usage: Number(a.usage || 0), usageInDrive: Number(a.usageInDrive || 0) };
}

// ============================================================
// Index (Kundendatenbank-Spiegel)
// Format: items[id] = [parentId, name, isFolder(1/0), mimeType, size, modifiedMs]
// ============================================================

function rebuildIndex_() {
  var root = rootId_();
  var token = driveApi_('changes/startPageToken', { supportsAllDrives: true }).startPageToken;
  var items = {};
  crawl_([root], items);
  var built = Date.now();
  var idx = { v: built, root: root, built: built, token: token, items: items };
  writeJson_('index.json', idx);
  props_().setProperty('IDX_V', String(idx.v));
  // alte Fortschritts-Einträge aufräumen
  var all = props_().getProperties();
  Object.keys(all).forEach(function (k) { if (k.indexOf('IDX_TOKEN_') === 0) props_().deleteProperty(k); });
  props_().setProperty('IDX_TOKEN_' + built, token);
  props_().setProperty('LAST_REFRESH', String(Date.now()));
  return idx;
}

/** Breitensuche ab den angegebenen Ordnern, 20 Ordner pro Drive-Abfrage
 *  (UrlFetch erlaubt max. ca. 2000 Zeichen URL-Länge). */
var CRAWL_BATCH = 20;
function crawl_(startIds, items) {
  var frontier = startIds.slice();
  while (frontier.length) {
    var next = [];
    for (var i = 0; i < frontier.length; i += CRAWL_BATCH) {
      var batch = frontier.slice(i, i + CRAWL_BATCH);
      listChildren_(batch).forEach(function (f) {
        var par = (f.parents || []).filter(function (p) { return batch.indexOf(p) >= 0; })[0] || (f.parents || [])[0];
        var isNew = !items[f.id];
        items[f.id] = row_(f, par);
        if (f.mimeType === FOLDER_MIME && isNew) next.push(f.id);
      });
    }
    frontier = next;
  }
}

function listChildren_(parentIds) {
  var q = '(' + parentIds.map(function (id) { return "'" + id + "' in parents"; }).join(' or ') + ') and trashed=false';
  var out = [];
  var pageToken = null;
  do {
    var params = {
      q: q, pageSize: 1000, fields: 'nextPageToken,files(' + FILE_FIELDS + ')',
      supportsAllDrives: true, includeItemsFromAllDrives: true
    };
    if (pageToken) params.pageToken = pageToken;
    var r = driveApi_('files', params);
    out = out.concat(r.files || []);
    pageToken = r.nextPageToken;
  } while (pageToken);
  return out;
}

/** Änderungen seit dem letzten Stand einspielen (schnell, über das Drive-Änderungsprotokoll). */
function refreshIndex_() {
  var idx = readJson_('index.json');
  if (!idx || !idx.token || idx.root !== rootId_()) return rebuildIndex_();
  var token = props_().getProperty('IDX_TOKEN_' + idx.built) || idx.token;
  var changes = [];
  while (true) {
    var r = driveApi_('changes', {
      pageToken: token, pageSize: 1000, includeRemoved: true, spaces: 'drive',
      supportsAllDrives: true, includeItemsFromAllDrives: true,
      fields: 'nextPageToken,newStartPageToken,changes(fileId,removed,file(' + FILE_FIELDS + '))'
    });
    changes = changes.concat(r.changes || []);
    if (r.nextPageToken) { token = r.nextPageToken; } else { token = r.newStartPageToken; break; }
  }
  var changed = applyChanges_(idx, changes);
  // Fortschritt im Änderungsprotokoll merken; Index-Datei nur bei echten Änderungen neu schreiben
  props_().setProperty('IDX_TOKEN_' + idx.built, token);
  if (changed) {
    idx.v = Date.now();
    idx.token = token;
    writeJson_('index.json', idx);
    props_().setProperty('IDX_V', String(idx.v));
  }
  props_().setProperty('LAST_REFRESH', String(Date.now()));
  return idx;
}

/** Wendet Drive-Änderungen auf den Index an. Gibt true zurück, wenn sich etwas geändert hat. */
function applyChanges_(idx, changes) {
  var items = idx.items;
  var changed = false;
  var pending = [];
  var newFolders = [];
  changes.forEach(function (c) {
    var f = c.file;
    if (c.removed || !f || f.trashed) {
      if (items[c.fileId]) { removeTree_(items, c.fileId); changed = true; }
    } else {
      pending.push(f);
    }
  });
  // Mehrere Durchläufe, damit neue Unterordner vor ihren Dateien erkannt werden
  var progress = true;
  while (pending.length && progress) {
    progress = false;
    var rest = [];
    pending.forEach(function (f) {
      var par = (f.parents || []).filter(function (p) {
        return p === idx.root || (items[p] && items[p][2] === 1);
      })[0];
      if (par) {
        var was = items[f.id];
        items[f.id] = row_(f, par);
        changed = true;
        progress = true;
        if (!was && f.mimeType === FOLDER_MIME) newFolders.push(f.id);
      } else {
        rest.push(f);
      }
    });
    pending = rest;
  }
  // Was übrig bleibt, liegt (nicht mehr) in der Kundendatenbank
  pending.forEach(function (f) {
    if (items[f.id]) { removeTree_(items, f.id); changed = true; }
  });
  // Neu hineinverschobene Ordner können bereits Inhalt haben
  if (newFolders.length) crawl_(newFolders, items);
  return changed;
}

function removeTree_(items, id) {
  var stack = [id];
  var all = {};
  all[id] = true;
  // Kinder suchen (Index ist flach)
  var children = {};
  Object.keys(items).forEach(function (k) {
    var p = items[k][0];
    (children[p] = children[p] || []).push(k);
  });
  while (stack.length) {
    var cur = stack.pop();
    (children[cur] || []).forEach(function (k) { if (!all[k]) { all[k] = true; stack.push(k); } });
  }
  Object.keys(all).forEach(function (k) { delete items[k]; });
}

function row_(f, parentId) {
  return [
    parentId,
    f.name,
    f.mimeType === FOLDER_MIME ? 1 : 0,
    f.mimeType === FOLDER_MIME ? '' : f.mimeType,
    f.size ? Number(f.size) : 0,
    f.modifiedTime ? Date.parse(f.modifiedTime) : 0
  ];
}

function rowFromDriveApp_(obj, parentId) {
  var isFolder = typeof obj.getMimeType !== 'function';
  return {
    id: obj.getId(),
    row: [
      parentId,
      obj.getName(),
      isFolder ? 1 : 0,
      isFolder ? '' : obj.getMimeType(),
      isFolder ? 0 : obj.getSize(),
      obj.getLastUpdated().getTime()
    ]
  };
}

// ============================================================
// Hilfsfunktionen
// ============================================================

function props_() { return PropertiesService.getScriptProperties(); }
function rootId_() { return props_().getProperty('ROOT_ID') || ROOT_ID_DEFAULT; }

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(60 * 1000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function normKey_(k) { return String(k || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }

function checkKey_(k) {
  var real = props_().getProperty('APP_KEY');
  return !!real && normKey_(k) === normKey_(real);
}

function makeKey_() {
  var alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
    Utilities.getUuid() + Utilities.getUuid() + Date.now());
  var s = '';
  for (var i = 0; i < 16; i++) s += alphabet.charAt((bytes[i] + 256) % 32);
  return s.match(/.{4}/g).join('-');
}

function driveApi_(path, params) {
  var q = Object.keys(params || {}).map(function (k) {
    return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
  }).join('&');
  var res = UrlFetchApp.fetch(DRIVE_API + path + (q ? '?' + q : ''), {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code >= 300) throw new Error('Drive-API ' + code + ': ' + res.getContentText().slice(0, 300));
  return JSON.parse(res.getContentText());
}

function dataFolder_() {
  var p = props_();
  var id = p.getProperty('DATA_FOLDER_ID');
  if (id) {
    try {
      var f = DriveApp.getFolderById(id);
      if (!f.isTrashed()) return f;
    } catch (e) { /* neu anlegen */ }
  }
  var it = DriveApp.getRootFolder().getFoldersByName(DATA_FOLDER_NAME);
  var folder = it.hasNext() ? it.next() : DriveApp.getRootFolder().createFolder(DATA_FOLDER_NAME);
  p.setProperty('DATA_FOLDER_ID', folder.getId());
  return folder;
}

function dataFile_(name) {
  var p = props_();
  var key = 'FILE_' + name;
  var id = p.getProperty(key);
  if (id) {
    try {
      var f = DriveApp.getFileById(id);
      if (!f.isTrashed()) return f;
    } catch (e) { /* neu suchen */ }
  }
  var it = dataFolder_().getFilesByName(name);
  if (it.hasNext()) {
    var found = it.next();
    p.setProperty(key, found.getId());
    return found;
  }
  return null;
}

function readJson_(name) {
  var f = dataFile_(name);
  if (!f) return null;
  var txt = f.getBlob().getDataAsString('UTF-8');
  return txt ? JSON.parse(txt) : null;
}

function writeJson_(name, obj) {
  var txt = JSON.stringify(obj);
  var f = dataFile_(name);
  if (f) {
    f.setContent(txt);
  } else {
    f = dataFolder_().createFile(name, txt, 'application/json');
    props_().setProperty('FILE_' + name, f.getId());
  }
}

/** Nur Dateien/Ordner innerhalb der Kundendatenbank oder des App-Datenordners zulassen. */
function assertAllowed_(obj) {
  var root = rootId_();
  var data = dataFolder_().getId();
  var id = obj.getId();
  if (id === root || id === data) return;
  var idx = readJson_('index.json');
  if (idx && idx.items[id]) return;
  // Fallback: Elternkette prüfen (z.B. ganz neue Datei, noch nicht im Index)
  var seen = 0;
  var parents = obj.getParents();
  var queue = [];
  while (parents.hasNext()) queue.push(parents.next());
  while (queue.length && seen < 50) {
    var p = queue.shift();
    seen++;
    var pid = p.getId();
    if (pid === root || pid === data) return;
    var pp = p.getParents();
    while (pp.hasNext()) queue.push(pp.next());
  }
  throw new Error('Kein Zugriff außerhalb der Kundendatenbank');
}

function findChildFolder_(parent, name) {
  var want = String(name).trim().toLowerCase();
  var it = parent.getFolders();
  while (it.hasNext()) {
    var f = it.next();
    if (f.getName().trim().toLowerCase() === want) return f;
  }
  return null;
}

function uniqueName_(folder, name, replaceId) {
  var m = /^(.*?)(\.[A-Za-z0-9]{1,5})?$/.exec(String(name || 'Datei'));
  var base = m[1], ext = m[2] || '';
  var candidate = base + ext;
  var n = 2;
  while (true) {
    var it = folder.getFilesByName(candidate);
    var clash = false;
    while (it.hasNext()) {
      var f = it.next();
      if (f.getId() !== replaceId && !f.isTrashed()) clash = true;
    }
    if (!clash) return candidate;
    candidate = base + ' (' + n + ')' + ext;
    n++;
  }
}

function trashQuietly_(id) {
  try { DriveApp.getFileById(id).setTrashed(true); } catch (e) { /* schon weg */ }
}
