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
var BACKEND_VERSION = '1.3.0';
var TZ = 'Europe/Berlin';
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
  installTriggers_();
  var idx = rebuildIndex_();
  Logger.log('Index aufgebaut: ' + Object.keys(idx.items).length + ' Einträge');
  Logger.log('APP-SCHLÜSSEL: ' + p.getProperty('APP_KEY'));
}

function installTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var h = t.getHandlerFunction();
    if (h === 'cronRefresh' || h === 'cronRebuild' || h === 'cronReminders') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('cronRefresh').timeBased().everyMinutes(15).create();
  ScriptApp.newTrigger('cronRebuild').timeBased().atHour(3).everyDays(1).create();
  ScriptApp.newTrigger('cronReminders').timeBased().everyMinutes(5).create();
}

/** Einmal nach dem Update auf 1.2 ausführen: Büro-Schlüssel, Push-Schlüssel, Kalender-Link, Erinnerungs-Trigger */
function setupV12() {
  var p = props_();
  if (!p.getProperty('OFFICE_KEY')) p.setProperty('OFFICE_KEY', makeKey_());
  if (!p.getProperty('ICS_TOKEN')) p.setProperty('ICS_TOKEN', makeKey_().replace(/-/g, '').toLowerCase());
  vapidKeys_();
  installTriggers_();
  var t0 = Date.now();
  var jwt = vapidJwt_('https://web.push.apple.com');
  Logger.log('Push-Signatur ok (' + (Date.now() - t0) + ' ms), Länge ' + jwt.length);
  Logger.log('BÜRO-SCHLÜSSEL: ' + p.getProperty('OFFICE_KEY'));
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

function doGet(e) {
  var prm = (e && e.parameter) || {};
  if (prm.ics) {
    var tok = props_().getProperty('ICS_TOKEN');
    if (!tok || prm.ics !== tok) return ContentService.createTextOutput('Kein Zugriff').setMimeType(ContentService.MimeType.TEXT);
    return ContentService.createTextOutput(buildIcs_()).setMimeType(ContentService.MimeType.ICAL);
  }
  return json_({ ok: true, app: 'eluh-backend', version: BACKEND_VERSION });
}

function doPost(e) {
  var req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'Ungültige Anfrage' });
  }
  // Gerät koppeln: geht ohne Schlüssel, nur mit einmaligem Kopplungscode vom Master-Gerät
  if (req.action === 'pairCheck' || req.action === 'pairFinish') {
    try {
      var po = req.action === 'pairCheck' ? apiPairCheck_(req) : apiPairFinish_(req);
      po.ok = true;
      return json_(po);
    } catch (err) {
      Utilities.sleep(800);
      return json_({ ok: false, error: String(err && err.message || err) });
    }
  }
  var auth = authForKey_(req.key);
  if (!auth || auth.revoked) {
    Utilities.sleep(800);
    return json_({ ok: false, error: auth && auth.revoked ? 'revoked' : 'auth' });
  }
  var role = auth.role;
  if (role === 'buero' && !OFFICE_ACTIONS[req.action]) return json_({ ok: false, error: 'Keine Berechtigung' });
  if (MASTER_ACTIONS[req.action] && !auth.master && !(req.action === 'officeKey' && !hasMaster_() && role === 'chef')) {
    return json_({ ok: false, error: 'Nur am Master-Gerät möglich' });
  }
  req.role = role;
  req.auth = auth;
  if (auth.client) req.deviceId = auth.client; // gekoppelte Geräte: Geräte-ID ist an den Schlüssel gebunden
  if (auth.id) touchDevice_(auth.id);
  try {
    var out = route_(req);
    out.ok = true;
    return json_(out);
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

var WRITE_ACTIONS = { upload: 1, createCustomer: 1, createFolder: 1, fileAuftrag: 1, uploadToPath: 1 };
// Was der Büro-Zugang darf (nur lesen, freigegebene Aufträge, Termine, Benachrichtigungen)
// Nur das Master-Gerät (Dominics Handy): Geräte koppeln/entfernen, Master übertragen
var MASTER_ACTIONS = { pairStart: 1, devices: 1, deviceRemove: 1, legacyOff: 1, officeKey: 1 };
var OFFICE_ACTIONS = { ping: 1, index: 1, getFile: 1, getFiles: 1, thumbs: 1, officeList: 1, officeMark: 1, termine: 1, pushSubscribe: 1, notifications: 1, pushTest: 1 };

function route_(req) {
  if (WRITE_ACTIONS[req.action]) props_().setProperty('LAST_REFRESH', '0');
  switch (req.action) {
    case 'ping':
      return { now: Date.now(), version: BACKEND_VERSION, root: rootId_(), role: req.role, vapidKey: vapidKeys_().pub, ics: props_().getProperty('ICS_TOKEN') || null,
        master: !!req.auth.master, device: req.auth.id || null, legacy: !req.auth.id, hasMaster: hasMaster_() };
    case 'becomeMaster':
      return apiBecomeMaster_(req);
    case 'pairStart':
      return apiPairStart_(req);
    case 'devices':
      return apiDevices_(req);
    case 'deviceRemove':
      return apiDeviceRemove_(req);
    case 'legacyOff':
      return apiLegacyOff_(req);
    case 'officeKey':
      return apiOfficeKey_(req);
    case 'officeList':
      return apiOfficeList_(req);
    case 'officeMark':
      return apiOfficeMark_(req);
    case 'termine':
      return apiTermine_(req);
    case 'pushSubscribe':
      return apiPushSubscribe_(req);
    case 'notifications':
      return apiNotifications_(req);
    case 'pushTest':
      notify_([req.deviceId], 'ELUH App', 'Benachrichtigungen funktionieren ✓', '#/');
      return { sent: true };
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
  var shareNotes = [];
  var res = apiSyncLocked_(req, shareNotes);
  if (shareNotes.length) {
    var office = devicesFor_(function (d) { return d.role === 'buero'; });
    shareNotes.forEach(function (r) {
      var f = r.f || {};
      notify_(office, 'Neuer Auftrag fürs Büro', [f.kunde_name || r.customerName || 'Ohne Kunde', f.art, f.auftrags_nr ? 'Nr. ' + f.auftrags_nr : ''].filter(Boolean).join(' · '), '#/buero');
    });
  }
  return res;
}

function apiSyncLocked_(req, shareNotes) {
  return withLock_(function () {
    var db = readJson_('auftraege.json') || { seq: 0, records: {} };
    var changed = false;
    var newlyShared = [];
    (req.changes || []).forEach(function (r) {
      if (!r || !r.id) return;
      var ex = db.records[r.id];
      if (!ex || Number(r.updatedAt || 0) > Number(ex.updatedAt || 0)) {
        // Druck-/Abrechnungsstatus setzt nur das Büro → vom Server übernehmen
        if (ex && ex.office) {
          r.office = r.office || {};
          ['printedAt', 'printedBy', 'billedAt', 'billedBy'].forEach(function (k) { if (ex.office[k] && !r.office[k]) r.office[k] = ex.office[k]; });
        }
        var wasShared = !!(ex && ex.office && ex.office.shared);
        if (r.office && r.office.shared && !wasShared && !r.deleted) newlyShared.push(r);
        db.seq += 1;
        r.seq = db.seq;
        db.records[r.id] = r;
        changed = true;
      }
    });
    if (changed) writeJson_('auftraege.json', db);
    newlyShared.forEach(function (r) { shareNotes.push(r); });
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
  // Stundennachweis als eigenes PDF (nur wenn Zeiten eingetragen sind)
  var extraFileId = null;
  if (req.extra && req.extra.data) {
    var en = uniqueName_(folder, req.extra.name, req.extraReplaceId);
    var ef = folder.createFile(Utilities.newBlob(Utilities.base64Decode(req.extra.data), 'application/pdf', en));
    extraFileId = ef.getId();
    if (req.extraReplaceId && req.extraReplaceId !== extraFileId) trashQuietly_(req.extraReplaceId);
  } else if (req.extraReplaceId) {
    trashQuietly_(req.extraReplaceId);
  }
  return {
    fileId: file.getId(),
    folderId: folder.getId(),
    path: path,
    url: file.getUrl(),
    moved: moved,
    extraFileId: extraFileId,
    items: created.concat([rowFromDriveApp_(file, folder.getId())])
  };
}



// ============================================================
// Rollen: Dominic (voller Zugriff) und Büro (eingeschränkt)  – ab 1.2
// ============================================================

function roleForKey_(k) {
  var a = authForKey_(k);
  return a && !a.revoked ? a.role : null;
}

// ============================================================
// Geräte & Master-Gerät (ab 1.3)
// Jedes gekoppelte Gerät hat einen eigenen langen Schlüssel (nur als Hash gespeichert).
// Das Master-Gerät (Dominics Handy, 48 Zeichen) koppelt neue Geräte per QR-Code/Kopplungscode,
// sieht alle Geräte und kann sie entfernen. Entfernte Geräte löschen beim nächsten Kontakt ihre Daten.
// Alte Schlüssel (APP_KEY / OFFICE_KEY) funktionieren bis zur Umstellung weiter.
// ============================================================

var MASTER_KEY_LEN = 48, DEVICE_KEY_LEN = 32, PAIR_CODE_LEN = 12, PAIR_TTL_MS = 15 * 60 * 1000;

/** Prüft einen Schlüssel → { role, master, id, client } oder { revoked: true } oder null */
function authForKey_(k) {
  var n = normKey_(k);
  if (!n) return null;
  var h = hashKey_(n);
  var devs = devices_();
  for (var id in devs) {
    if (devs[id].hash === h) return { role: devs[id].role, master: !!devs[id].master, id: id, client: devs[id].client || null, name: devs[id].name };
  }
  var chef = props_().getProperty('APP_KEY');
  if (chef && n === normKey_(chef)) return { role: 'chef', master: false, id: null };
  var office = props_().getProperty('OFFICE_KEY');
  if (office && n === normKey_(office)) return { role: 'buero', master: false, id: null };
  var rev = readPropJson_('REVOKED', {});
  if (rev[h]) return { revoked: true };
  return null;
}

function hashKey_(n) {
  var b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'eluh|' + n);
  return b.map(function (x) { return ('0' + ((x + 256) % 256).toString(16)).slice(-2); }).join('');
}

/** Zufallsschlüssel mit n Zeichen (32er-Alphabet → 5 Bit je Zeichen), in Vierergruppen */
function makeLongKey_(len) {
  var alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var s = '';
  while (s.length < len) {
    var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Utilities.getUuid() + Math.random() + Date.now());
    for (var i = 0; i < bytes.length && s.length < len; i++) s += alphabet.charAt((bytes[i] + 256) % 32);
  }
  return s.match(/.{4}/g).join('-');
}

function readPropJson_(name, dflt) {
  var t = props_().getProperty(name);
  if (!t) return dflt;
  try { return JSON.parse(t); } catch (e) { return dflt; }
}
function devices_() { return readPropJson_('DEVICES', {}); }
function saveDevices_(d) { props_().setProperty('DEVICES', JSON.stringify(d)); }
function hasMaster_() {
  var d = devices_();
  return Object.keys(d).some(function (id) { return d[id].master; });
}
function masterClients_() {
  var d = devices_();
  return Object.keys(d).filter(function (id) { return d[id].master && d[id].client; }).map(function (id) { return d[id].client; });
}

/** "zuletzt gesehen" höchstens stündlich schreiben (eigene Eigenschaft, damit nichts überschrieben wird) */
function touchDevice_(id) {
  var p = props_(), k = 'SEEN_' + id;
  var last = Number(p.getProperty(k) || 0);
  if (Date.now() - last > 60 * 60 * 1000) p.setProperty(k, String(Date.now()));
}

function newDevice_(devs, role, master, name, label, client) {
  var key = makeLongKey_(master ? MASTER_KEY_LEN : DEVICE_KEY_LEN);
  var id = 'g' + Utilities.getUuid().replace(/-/g, '').slice(0, 10);
  devs[id] = { role: role, master: !!master, name: String(name || '').slice(0, 40), label: String(label || '').slice(0, 40),
    client: client ? String(client).slice(0, 60) : null, hash: hashKey_(normKey_(key)), created: Date.now() };
  props_().setProperty('SEEN_' + id, String(Date.now()));
  return { id: id, key: key };
}

/** Erstes Master-Gerät festlegen (nur mit Dominics bisherigem Schlüssel, nur solange es keinen Master gibt).
 *  Danach gilt der alte App-Schlüssel nicht mehr – Dominics andere Geräte werden per QR-Code neu gekoppelt. */
function apiBecomeMaster_(req) {
  if (req.role !== 'chef' || req.auth.id) throw new Error('Nur mit dem bisherigen App-Schlüssel möglich');
  return withLock_(function () {
    var devs = devices_();
    if (Object.keys(devs).some(function (id) { return devs[id].master; })) throw new Error('Es gibt schon ein Master-Gerät');
    var nd = newDevice_(devs, 'chef', true, req.name || 'Dominic', req.label, req.deviceId);
    saveDevices_(devs);
    props_().deleteProperty('APP_KEY');
    return { key: nd.key, device: nd.id, master: true };
  });
}

/** Kopplungscode erzeugen (15 Min. gültig, einmalig). master=true → überträgt den Master auf das neue Gerät */
function apiPairStart_(req) {
  return withLock_(function () {
    var pairs = cleanPairs_(readPropJson_('PAIRS', {}));
    var code = makeLongKey_(PAIR_CODE_LEN);
    pairs[normKey_(code)] = { exp: Date.now() + PAIR_TTL_MS, master: !!req.master, by: req.auth.id };
    props_().setProperty('PAIRS', JSON.stringify(pairs));
    return { code: code, exp: pairs[normKey_(code)].exp, master: !!req.master };
  });
}

function cleanPairs_(pairs) {
  var now = Date.now();
  Object.keys(pairs).forEach(function (c) { if (pairs[c].exp < now || pairs[c].used) delete pairs[c]; });
  return pairs;
}

/** Fehlversuche begrenzen: max. 20 falsche Codes je 15 Minuten */
function pairGuard_(failed) {
  var p = props_(), g = readPropJson_('PAIR_FAILS', { n: 0, since: Date.now() });
  if (Date.now() - g.since > PAIR_TTL_MS) g = { n: 0, since: Date.now() };
  if (failed) { g.n += 1; p.setProperty('PAIR_FAILS', JSON.stringify(g)); }
  if (g.n >= 20) throw new Error('Zu viele falsche Codes – bitte 15 Minuten warten');
}

function findPair_(code) {
  pairGuard_(false);
  var pairs = cleanPairs_(readPropJson_('PAIRS', {}));
  var pr = pairs[normKey_(code)];
  if (!pr) { pairGuard_(true); throw new Error('Code ungültig oder abgelaufen'); }
  return { pairs: pairs, pr: pr };
}

function apiPairCheck_(req) {
  var f = findPair_(req.code);
  return { valid: true, master: !!f.pr.master, exp: f.pr.exp };
}

/** Neues Gerät mit Kopplungscode verbinden → eigener Schlüssel für dieses Gerät */
function apiPairFinish_(req) {
  var out = withLock_(function () {
    var f = findPair_(req.code);
    var role = f.pr.master ? 'chef' : (req.role === 'buero' ? 'buero' : req.role === 'chef' ? 'chef' : null);
    if (!role) throw new Error('Bitte auswählen: Dominic oder Büro');
    var devs = devices_();
    // Gerät war schon gekoppelt (z. B. neu verbinden) → alten Eintrag ersetzen
    if (req.oldKey) {
      var oh = hashKey_(normKey_(req.oldKey));
      Object.keys(devs).forEach(function (id) { if (devs[id].hash === oh && !devs[id].master) delete devs[id]; });
    }
    var oldMaster = null;
    if (f.pr.master) {
      Object.keys(devs).forEach(function (id) { if (devs[id].master) { devs[id].master = false; oldMaster = id; } });
    }
    var name = String(req.name || '').trim() || (role === 'chef' ? 'Dominic' : 'Büro');
    var nd = newDevice_(devs, role, f.pr.master, name, req.label, req.deviceId);
    saveDevices_(devs);
    f.pr.used = Date.now();
    delete f.pairs[normKey_(req.code)];
    props_().setProperty('PAIRS', JSON.stringify(f.pairs));
    return { key: nd.key, device: nd.id, role: role, master: !!f.pr.master, name: name, oldMaster: oldMaster };
  });
  // Dominic bekommt Bescheid, wenn ein Gerät dazukommt (Sicherheit)
  try {
    var who = out.name + (req.label ? ' · ' + String(req.label).slice(0, 40) : '');
    var txt = out.master ? 'Master übertragen auf: ' + who : 'Neues Gerät verbunden: ' + who + ' (' + (out.role === 'buero' ? 'Büro' : 'Dominic') + ')';
    var targets = devicesFor_(function (d, id) { return d.role === 'chef' && id !== req.deviceId; });
    notify_(targets, 'ELUH App – Geräte', txt, '#/sync');
  } catch (e) { /* Mitteilung ist nur ein Hinweis */ }
  delete out.oldMaster;
  return out;
}

/** Geräteliste für das Master-Gerät (ohne Schlüssel) */
function apiDevices_(req) {
  var devs = devices_(), p = props_();
  var list = Object.keys(devs).map(function (id) {
    var d = devs[id];
    return { id: id, name: d.name, label: d.label, role: d.role, master: !!d.master, created: d.created,
      seen: Number(p.getProperty('SEEN_' + id) || 0) || d.created, self: id === req.auth.id };
  }).sort(function (a, b) { return (b.master - a.master) || (a.role < b.role ? -1 : a.role > b.role ? 1 : 0) || (b.seen - a.seen); });
  var pairs = cleanPairs_(readPropJson_('PAIRS', {}));
  return { devices: list, legacyOffice: !!p.getProperty('OFFICE_KEY'), legacyChef: !!p.getProperty('APP_KEY'), openPairs: Object.keys(pairs).length };
}

/** Gerät entfernen → Schlüssel ungültig, Gerät löscht beim nächsten Kontakt seine Daten */
function apiDeviceRemove_(req) {
  var client = null;
  withLock_(function () {
    var devs = devices_();
    var d = devs[req.id];
    if (!d) throw new Error('Gerät nicht gefunden');
    if (d.master) throw new Error('Das Master-Gerät kann nicht entfernt werden');
    client = d.client;
    var rev = readPropJson_('REVOKED', {});
    rev[d.hash] = Date.now();
    var ks = Object.keys(rev).sort(function (a, b) { return rev[b] - rev[a]; }).slice(0, 60);
    var keep = {}; ks.forEach(function (k) { keep[k] = rev[k]; });
    props_().setProperty('REVOKED', JSON.stringify(keep));
    delete devs[req.id];
    saveDevices_(devs);
    props_().deleteProperty('SEEN_' + req.id);
  });
  if (client) {
    withLock_(function () {
      var db = readJson_('push.json') || { devices: {} };
      if (db.devices[client]) { delete db.devices[client]; writeJson_('push.json', db); }
    });
  }
  return { removed: true };
}

/** Alten gemeinsamen Büro-Schlüssel abschalten (wenn alle Büro-Geräte neu gekoppelt sind) */
function apiLegacyOff_(req) {
  props_().deleteProperty('OFFICE_KEY');
  props_().deleteProperty('APP_KEY');
  return { off: true };
}

/** NOTFALL (im Apps-Script-Editor ausführen), z. B. Handy verloren:
 *  Master wird entzogen und ein Kopplungscode für ein neues Master-Gerät erzeugt (24 Std. gültig).
 *  Code in der App unter „Gerät verbinden → Code eingeben“ eintippen. */
function masterNotfall() {
  withLock_(function () {
    var devs = devices_();
    Object.keys(devs).forEach(function (id) { if (devs[id].master) devs[id].master = false; });
    saveDevices_(devs);
    var pairs = cleanPairs_(readPropJson_('PAIRS', {}));
    var code = makeLongKey_(PAIR_CODE_LEN);
    pairs[normKey_(code)] = { exp: Date.now() + 24 * 60 * 60 * 1000, master: true, by: 'notfall' };
    props_().setProperty('PAIRS', JSON.stringify(pairs));
    props_().deleteProperty('PAIR_FAILS');
    Logger.log('NOTFALL-KOPPLUNGSCODE (24 Std. gültig, einmalig): ' + code);
  });
}

/** Übersicht der Geräte im Ausführungsprotokoll */
function zeigeGeraete() {
  var d = devices_();
  Object.keys(d).forEach(function (id) { Logger.log((d[id].master ? '[MASTER] ' : '') + d[id].name + ' · ' + (d[id].label || '') + ' · ' + d[id].role); });
}

/** Büro-Schlüssel anzeigen oder neu erzeugen (nur Dominic) */
function apiOfficeKey_(req) {
  var p = props_();
  if (req.renew || !p.getProperty('OFFICE_KEY')) p.setProperty('OFFICE_KEY', makeKey_());
  return { officeKey: p.getProperty('OFFICE_KEY') };
}

/** Freigegebene Aufträge fürs Büro (keine Entwürfe, nichts Privates) */
function apiOfficeList_(req) {
  var db = readJson_('auftraege.json') || { seq: 0, records: {} };
  var out = [];
  Object.keys(db.records).forEach(function (id) {
    var r = db.records[id];
    if (r.kind === 'profile' || r.deleted || !r.office || !r.office.shared) return;
    out.push({
      id: r.id, f: r.f, material: r.material, sig: r.sig, zeiten: r.zeiten, ablage: r.ablage,
      customerId: r.customerId, customerName: r.customerName, drive: r.drive, status: r.status,
      office: r.office, updatedAt: r.updatedAt, finishedAt: r.finishedAt
    });
  });
  out.sort(function (a, b) { return Number(b.office.sharedAt || 0) - Number(a.office.sharedAt || 0); });
  return { records: out.slice(0, 400), seq: db.seq };
}

/** Büro markiert "gedruckt" / "abgerechnet" */
function apiOfficeMark_(req) {
  return withLock_(function () {
    var db = readJson_('auftraege.json') || { seq: 0, records: {} };
    var r = db.records[req.id];
    if (!r || !r.office || !r.office.shared) throw new Error('Auftrag nicht freigegeben');
    var field = req.field === 'billed' ? 'billed' : 'printed';
    if (req.value === false) { delete r.office[field + 'At']; delete r.office[field + 'By']; }
    else { r.office[field + 'At'] = Date.now(); r.office[field + 'By'] = String(req.by || 'Büro').slice(0, 40); }
    db.seq += 1;
    r.seq = db.seq;
    writeJson_('auftraege.json', db);
    return { office: r.office };
  });
}

// ============================================================
// Termine (für Dominic und Büro) + Erinnerungen
// Termin: {id, title, date:'JJJJ-MM-TT', time:'HH:MM', end:'HH:MM', allDay, customerId, customerName,
//          address, person, note, remind:[Minuten], createdBy, updatedAt, deleted}
// ============================================================

function terminStart_(t) {
  if (!t || !t.date) return 0;
  var time = t.allDay || !t.time ? '07:00' : t.time;
  return Utilities.parseDate(t.date + ' ' + time, TZ, 'yyyy-MM-dd HH:mm').getTime();
}

function fmtTermin_(t) {
  var d = String(t.date || '').split('-');
  var s = d.length === 3 ? Number(d[2]) + '.' + Number(d[1]) + '.' : '';
  if (!t.allDay && t.time) s += ' ' + t.time + ' Uhr';
  return s;
}

function apiTermine_(req) {
  var res = withLock_(function () {
    var db = readJson_('termine.json') || { seq: 0, records: {} };
    var changed = false, events = [];
    (req.changes || []).forEach(function (t) {
      if (!t || !t.id) return;
      var ex = db.records[t.id];
      if (!ex || Number(t.updatedAt || 0) > Number(ex.updatedAt || 0)) {
        if (!t.deleted) {
          if (!ex) events.push({ kind: 'neu', t: t });
          else if (ex.date !== t.date || ex.time !== t.time) events.push({ kind: 'geändert', t: t });
        }
        db.seq += 1;
        t.seq = db.seq;
        db.records[t.id] = t;
        changed = true;
      }
    });
    if (changed) writeJson_('termine.json', db);
    var since = Number(req.since || 0);
    var out = [];
    Object.keys(db.records).forEach(function (id) { if (Number(db.records[id].seq || 0) > since) out.push(db.records[id]); });
    return { seq: db.seq, records: out, events: events };
  });
  // alle anderen Geräte informieren
  res.events.forEach(function (ev) {
    var t = ev.t;
    var targets = devicesFor_(function (d, id) { return id !== req.deviceId; });
    notify_(targets, (ev.kind === 'neu' ? 'Neuer Termin' : 'Termin geändert') + (t.createdBy ? ' (' + t.createdBy + ')' : ''),
      [fmtTermin_(t), t.title, t.customerName].filter(Boolean).join(' · '), '#/termine/' + t.id);
  });
  delete res.events;
  return res;
}

/** Läuft alle 5 Minuten: fällige Erinnerungen als Push verschicken */
function cronReminders() {
  var p = props_();
  var now = Date.now();
  var last = Number(p.getProperty('REMIND_LAST') || 0) || now - 5 * 60 * 1000;
  p.setProperty('REMIND_LAST', String(now));
  var db = readJson_('termine.json');
  if (!db) return;
  Object.keys(db.records).forEach(function (id) {
    var t = db.records[id];
    if (t.deleted || !t.date) return;
    var start = terminStart_(t);
    (t.remind || []).forEach(function (min) {
      var at = start - Number(min) * 60000;
      if (at > last && at <= now) {
        var targets = devicesFor_(function (d) {
          return d.role === 'chef' || (t.person && d.name && d.name.toLowerCase().indexOf(String(t.person).toLowerCase()) >= 0);
        });
        var when = min >= 1440 ? 'Morgen' : min >= 60 ? 'In ' + Math.round(min / 60) + ' Std.' : min > 0 ? 'In ' + min + ' Min.' : 'Jetzt';
        notify_(targets, when + ': ' + (t.title || 'Termin'), [fmtTermin_(t), t.customerName || t.address, t.person].filter(Boolean).join(' · '), '#/termine/' + t.id);
      }
    });
  });
}

// ============================================================
// Kalender-Abo (Apple/Google Kalender) – webcal://…/exec?ics=TOKEN
// ============================================================

function icsEsc_(s) { return String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1'); }
function icsUtc_(ms) { return Utilities.formatDate(new Date(ms), 'UTC', "yyyyMMdd'T'HHmmss'Z'"); }
function icsFold_(line) {
  var out = [];
  while (line.length > 74) { out.push(line.slice(0, 74)); line = ' ' + line.slice(74); }
  out.push(line);
  return out.join('\r\n');
}

function buildIcs_() {
  var db = readJson_('termine.json') || { records: {} };
  var lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//eluh Anlagen Kyritz//ELUH App//DE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:ELUH Termine', 'X-WR-TIMEZONE:Europe/Berlin', 'REFRESH-INTERVAL;VALUE=DURATION:PT15M', 'X-PUBLISHED-TTL:PT15M'];
  var minDate = Date.now() - 60 * 864e5;
  Object.keys(db.records).forEach(function (id) {
    var t = db.records[id];
    if (t.deleted || !t.date) return;
    var start = terminStart_(t);
    if (start < minDate) return;
    lines.push('BEGIN:VEVENT');
    lines.push('UID:' + t.id + '@eluh-app');
    lines.push('DTSTAMP:' + icsUtc_(Number(t.updatedAt || Date.now())));
    if (t.allDay || !t.time) {
      var d = t.date.replace(/-/g, '');
      var next = Utilities.formatDate(new Date(Utilities.parseDate(t.date + ' 12:00', TZ, 'yyyy-MM-dd HH:mm').getTime() + 864e5), TZ, 'yyyyMMdd');
      lines.push('DTSTART;VALUE=DATE:' + d);
      lines.push('DTEND;VALUE=DATE:' + next);
    } else {
      var end = t.end ? Utilities.parseDate(t.date + ' ' + t.end, TZ, 'yyyy-MM-dd HH:mm').getTime() : start + 3600000;
      if (end <= start) end = start + 3600000;
      lines.push('DTSTART:' + icsUtc_(start));
      lines.push('DTEND:' + icsUtc_(end));
    }
    lines.push(icsFold_('SUMMARY:' + icsEsc_((t.title || 'Termin') + (t.person ? ' (' + t.person + ')' : ''))));
    if (t.address || t.customerName) lines.push(icsFold_('LOCATION:' + icsEsc_(t.address || t.customerName)));
    var desc = [t.customerName, t.note, t.createdBy ? 'Eingetragen von ' + t.createdBy : ''].filter(Boolean).join('\n');
    if (desc) lines.push(icsFold_('DESCRIPTION:' + icsEsc_(desc)));
    (t.remind || []).forEach(function (min) {
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + icsEsc_(t.title || 'Termin'), 'TRIGGER:-PT' + Number(min) + 'M', 'END:VALARM');
    });
    lines.push('END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

// ============================================================
// Push-Benachrichtigungen (Web Push, VAPID mit ECDSA P-256)
// Gesendet wird ein leerer Push; die App holt sich den Text dann selbst ab.
// ============================================================

function apiPushSubscribe_(req) {
  return withLock_(function () {
    var db = readJson_('push.json') || { devices: {} };
    if (!req.deviceId) throw new Error('Geräte-ID fehlt');
    var d = db.devices[req.deviceId] || {};
    d.role = req.role;
    d.name = String(req.name || d.name || '').slice(0, 40);
    if (req.subscription !== undefined) d.sub = req.subscription;
    d.updatedAt = Date.now();
    db.devices[req.deviceId] = d;
    writeJson_('push.json', db);
    return { saved: true };
  });
}

function devicesFor_(filterFn) {
  var db = readJson_('push.json') || { devices: {} };
  return Object.keys(db.devices).filter(function (id) { return filterFn(db.devices[id], id); });
}

function apiNotifications_(req) {
  var db = readJson_('notifications.json') || { seq: 0, items: [] };
  var since = Number(req.since || 0);
  var items = db.items.filter(function (n) { return n.seq > since && (n.targets || []).indexOf(req.deviceId) >= 0; });
  return { seq: db.seq, items: items.slice(-10).map(function (n) { return { id: n.id, seq: n.seq, at: n.at, title: n.title, body: n.body, url: n.url }; }) };
}

/** Mitteilung speichern und an die Geräte pushen */
function notify_(targets, title, body, url) {
  targets = (targets || []).filter(Boolean);
  if (!targets.length) return 0;
  var item;
  withLock_(function () {
    var db = readJson_('notifications.json') || { seq: 0, items: [] };
    db.seq += 1;
    item = { id: 'n' + db.seq, seq: db.seq, at: Date.now(), title: title, body: body, url: url || '#/', targets: targets };
    db.items.push(item);
    if (db.items.length > 300) db.items = db.items.slice(-300);
    writeJson_('notifications.json', db);
  });
  var push = readJson_('push.json') || { devices: {} };
  var reqs = [], ids = [];
  targets.forEach(function (id) {
    var d = push.devices[id];
    if (!d || !d.sub || !d.sub.endpoint) return;
    try {
      var aud = d.sub.endpoint.match(/^https:\/\/[^/]+/)[0];
      reqs.push({
        url: d.sub.endpoint, method: 'post', payload: '', muteHttpExceptions: true,
        headers: { Authorization: 'vapid t=' + vapidJwt_(aud) + ', k=' + vapidKeys_().pub, TTL: '86400', Urgency: 'high' }
      });
      ids.push(id);
    } catch (e) { /* Gerät überspringen */ }
  });
  if (!reqs.length) return 0;
  var res = UrlFetchApp.fetchAll(reqs);
  var gone = [];
  res.forEach(function (r, i) { var c = r.getResponseCode(); if (c === 404 || c === 410) gone.push(ids[i]); });
  if (gone.length) {
    withLock_(function () {
      var db = readJson_('push.json') || { devices: {} };
      gone.forEach(function (id) { if (db.devices[id]) delete db.devices[id].sub; });
      writeJson_('push.json', db);
    });
  }
  return reqs.length - gone.length;
}

// ---------- ECDSA P-256 (BigInt) ----------
var EC_ = null;
function ec_() {
  if (EC_) return EC_;
  var B = BigInt;
  EC_ = {
    p: B('0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff'),
    a: B('0xffffffff00000001000000000000000000000000fffffffffffffffffffffffc'),
    n: B('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551'),
    G: [B('0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296'), B('0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5')]
  };
  return EC_;
}
function mod_(a, m) { var r = a % m; return r < BigInt(0) ? r + m : r; }
function inv_(a, m) {
  var t = BigInt(0), nt = BigInt(1), r = m, nr = mod_(a, m);
  while (nr !== BigInt(0)) { var q = r / nr; var tmp = t - q * nt; t = nt; nt = tmp; tmp = r - q * nr; r = nr; nr = tmp; }
  return mod_(t, m);
}
function ptAdd_(P, Q) {
  var c = ec_(), p = c.p;
  if (!P) return Q;
  if (!Q) return P;
  var l;
  if (P[0] === Q[0]) {
    if (mod_(P[1] + Q[1], p) === BigInt(0)) return null;
    l = mod_((BigInt(3) * P[0] * P[0] + c.a) * inv_(BigInt(2) * P[1], p), p);
  } else {
    l = mod_((Q[1] - P[1]) * inv_(Q[0] - P[0], p), p);
  }
  var x = mod_(l * l - P[0] - Q[0], p);
  return [x, mod_(l * (P[0] - x) - P[1], p)];
}
function ptMul_(P, k) {
  var R = null, A = P;
  while (k > BigInt(0)) { if (k & BigInt(1)) R = ptAdd_(R, A); A = ptAdd_(A, A); k = k >> BigInt(1); }
  return R;
}
function bytesToBig_(bytes) { var h = '0x'; for (var i = 0; i < bytes.length; i++) h += ((bytes[i] + 256) % 256).toString(16).padStart(2, '0'); return BigInt(h === '0x' ? '0' : h); }
function bigToBytes_(b, len) {
  var h = b.toString(16).padStart(len * 2, '0');
  var out = [];
  for (var i = 0; i < len; i++) { var v = parseInt(h.substr(i * 2, 2), 16); out.push(v > 127 ? v - 256 : v); }
  return out;
}
function b64url_(bytes) { return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, ''); }

function vapidKeys_() {
  var p = props_();
  var d = p.getProperty('VAPID_D'), pub = p.getProperty('VAPID_PUB');
  if (d && pub) return { d: BigInt('0x' + d), pub: pub };
  var c = ec_();
  var seed = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Utilities.getUuid() + Date.now() + Math.random());
  var k = mod_(bytesToBig_(seed), c.n - BigInt(1)) + BigInt(1);
  var Q = ptMul_(c.G, k);
  pub = b64url_([4].concat(bigToBytes_(Q[0], 32), bigToBytes_(Q[1], 32)));
  p.setProperty('VAPID_D', k.toString(16));
  p.setProperty('VAPID_PUB', pub);
  return { d: k, pub: pub };
}

function ecdsaSign_(msgBytes, d) {
  var c = ec_();
  var hash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, msgBytes);
  var z = bytesToBig_(hash);
  var dBytes = bigToBytes_(d, 32);
  for (var ctr = 0; ctr < 50; ctr++) {
    var kb = Utilities.computeHmacSha256Signature(hash.concat([ctr]), dBytes);
    var k = mod_(bytesToBig_(kb), c.n);
    if (k === BigInt(0)) continue;
    var R = ptMul_(c.G, k);
    var r = mod_(R[0], c.n);
    if (r === BigInt(0)) continue;
    var s = mod_(inv_(k, c.n) * (z + r * d), c.n);
    if (s === BigInt(0)) continue;
    return bigToBytes_(r, 32).concat(bigToBytes_(s, 32));
  }
  throw new Error('Signatur fehlgeschlagen');
}

/** VAPID-JWT je Push-Dienst (12 h gültig, wird zwischengespeichert) */
function vapidJwt_(aud) {
  var p = props_();
  var key = 'VAPID_JWT_' + aud.replace(/[^a-z0-9]/gi, '_');
  var cached = p.getProperty(key);
  if (cached) {
    var parts = cached.split('|');
    if (Number(parts[0]) > Date.now() + 3600000) return parts[1];
  }
  var exp = Math.floor(Date.now() / 1000) + 12 * 3600;
  var enc = function (o) { return b64url_(Utilities.newBlob(JSON.stringify(o)).getBytes()); };
  var input = enc({ typ: 'JWT', alg: 'ES256' }) + '.' + enc({ aud: aud, exp: exp, sub: 'mailto:dpfaue12@gmx.de' });
  var sig = ecdsaSign_(Utilities.newBlob(input).getBytes(), vapidKeys_().d);
  var jwt = input + '.' + b64url_(sig);
  p.setProperty(key, (exp * 1000) + '|' + jwt);
  return jwt;
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
