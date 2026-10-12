/* ELUH App – Geräte: Master-Gerät, neue Geräte (zeigen QR, Master scannt + gibt frei), Geräteliste */
(function () {
  'use strict';
  var S = window.Store, U = window.UI;
  var $ = U.$, $$ = U.$$, esc = U.esc;

  function appUrl() { return location.origin + location.pathname; }
  function pairUrl(code) { return appUrl() + '#/pair?c=' + encodeURIComponent(code); }
  function standalone() { return S.Push.standalone(); }
  function codeFrom(text) {
    var t = String(text || '').trim();
    var m = /[#&?]c=([A-Za-z0-9-]+)/.exec(t);
    if (m) return m[1].toUpperCase();
    var n = t.toUpperCase().replace(/[^A-Z0-9]/g, '');
    return n.length === 12 ? n.match(/.{4}/g).join('-') : '';
  }
  function fmtCode(c) { var n = String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); return (n.match(/.{1,4}/g) || []).join('-'); }
  function loadScript(src, globalName) {
    if (window[globalName]) return Promise.resolve(window[globalName]);
    return new Promise(function (resolve, reject) {
      var sc = document.createElement('script');
      sc.src = src;
      sc.onload = function () { resolve(window[globalName]); };
      sc.onerror = function () { reject(new Error('Konnte ' + src + ' nicht laden')); };
      document.head.appendChild(sc);
    });
  }
  function ago(ms) {
    if (!ms) return '–';
    var d = Date.now() - ms;
    if (d < 2 * 3600e3) return 'gerade aktiv';
    if (d < 36 * 3600e3) return 'heute/gestern aktiv';
    return 'zuletzt ' + U.fmtDate(ms);
  }

  // ------------------------------------------------------------------
  // QR-Code anzeigen (SVG)
  // ------------------------------------------------------------------
  async function qrSvg(text) {
    var qrcode = await loadScript('qrcode.min.js', 'qrcode');
    var q = qrcode(0, 'M');
    q.addData(text);
    q.make();
    var n = q.getModuleCount(), m = 3, d = '';
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (q.isDark(r, c)) d += 'M' + (c + m) + ' ' + (r + m) + 'h1v1h-1z';
    var size = n + 2 * m;
    return '<svg class="qr" viewBox="0 0 ' + size + ' ' + size + '" role="img" aria-label="QR-Code zum Verbinden" shape-rendering="crispEdges">' +
      '<rect width="' + size + '" height="' + size + '" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>';
  }

  // ------------------------------------------------------------------
  // QR-Code scannen (Kamera)
  // ------------------------------------------------------------------
  function scanQr() {
    return new Promise(async function (resolve) {
      var stream = null, timer = null, done = false;
      function stop() {
        if (timer) clearTimeout(timer);
        if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
        stream = null;
      }
      function finish(v) { if (done) return; done = true; stop(); U.closeModal(); resolve(v); }
      var sheet = U.openModal(
        '<div class="sheet-head"><h3>QR-Code scannen</h3><button class="btn small ghost" data-close aria-label="Schließen">' + U.ICONS.close + '</button></div>' +
        '<div class="sheet-body stack"><div class="scan-box"><video id="scanVideo" playsinline muted autoplay></video><div class="scan-frame"></div></div>' +
        '<div class="small muted" id="scanMsg">Den QR-Code vom neuen Gerät in den Rahmen halten.</div></div>',
        { onClose: function () { if (!done) { done = true; stop(); resolve(null); } } });
      try {
        var jsQR = await loadScript('jsqr.min.js', 'jsQR');
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (done) { stop(); return; }
        var video = $('#scanVideo', sheet);
        video.srcObject = stream;
        await video.play().catch(function () {});
        var canvas = document.createElement('canvas'), ctx = canvas.getContext('2d', { willReadFrequently: true });
        var tick = function () {
          if (done) return;
          if (video.readyState >= 2 && video.videoWidth) {
            var w = Math.min(800, video.videoWidth), h = Math.round(video.videoHeight * w / video.videoWidth);
            canvas.width = w; canvas.height = h;
            ctx.drawImage(video, 0, 0, w, h);
            var res = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
            if (res && res.data) {
              var code = codeFrom(res.data);
              if (code) { finish(code); return; }
              $('#scanMsg', sheet).textContent = 'Das ist kein ELUH-Kopplungscode.';
            }
          }
          timer = setTimeout(tick, 180);
        };
        tick();
      } catch (e) {
        var msg = $('#scanMsg', sheet);
        if (msg) msg.innerHTML = '<span class="notice err" style="display:block">Kamera nicht verfügbar (' + esc(e.message || e.name) + '). Bitte den Code unter dem QR-Code am neuen Gerät eintippen.</span>';
      }
    });
  }

  // ------------------------------------------------------------------
  // Einrichtung / Gerät verbinden: dieses Gerät zeigt einen QR-Code, der Master scannt ihn und gibt frei
  // ------------------------------------------------------------------
  var ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  function newKey() {
    var b = new Uint8Array(32), out = '';
    crypto.getRandomValues(b);
    for (var i = 0; i < 32; i++) out += ALPHA.charAt(b[i] % 32);
    return out.match(/.{4}/g).join('-');
  }
  async function sha(key) {
    var n = String(key || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    var d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('eluh|' + n));
    return Array.prototype.map.call(new Uint8Array(d), function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
  }

  U.route(/^#\/(?:setup|pair)(?:\?.*)?$/, async function () {
    var s0 = await S.Settings.get();
    var urlCode = codeFrom(location.hash);
    // QR mit der normalen Kamera-App am Master geöffnet → direkt zur Freigabe
    if (s0.key && s0.isMaster && urlCode) { location.replace('#/sync'); setTimeout(function () { approve(urlCode); }, 300); return; }
    var revoked = !!s0.revoked && !s0.key;
    var iosBrowser = U.isIOS() && !standalone();
    U.view.innerHTML =
      '<div class="setup card pad stack">' +
      '<img class="logo" src="logo.png" alt="eluh Anlagen Kyritz">' +
      '<h1 style="margin:0;font-size:22px">Gerät verbinden</h1>' +
      (revoked ? '<div class="notice err">Dieses Gerät wurde am Master-Gerät entfernt. Alle Daten auf diesem Gerät wurden gelöscht.</div>' : '') +
      '<p class="muted" style="margin:0">Dieses Gerät zeigt einen QR-Code. Dominic scannt ihn mit seinem Master-Handy (<b>Sync → Geräte → „Gerät freigeben“</b>) und gibt das Gerät frei.</p>' +
      (iosBrowser ? '<div class="notice warn small">iPhone/iPad: Bitte zuerst über <b>Teilen → „Zum Home-Bildschirm“</b> installieren und in der <b>installierten App</b> verbinden – Safari und die App haben getrennte Speicher.</div>' : '') +
      '<div id="reqBox"><button class="btn primary big" id="reqGo" type="button" style="width:100%">' + U.ICONS.camera + '<span>QR-Code anzeigen</span></button></div>' +
      '<div id="setupMsg"></div>' +
      '<details class="small" id="legacyBox"><summary>Mit bisherigem App-Schlüssel verbinden</summary><div class="stack" style="margin-top:10px">' +
      '<label class="field"><span>App-Schlüssel</span><input class="key-input" id="keyIn" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX-XXXX"></label>' +
      '<label class="field"><span>Dein Name (für Termine und Erinnerungen)</span><input id="nameIn" autocomplete="name" placeholder="z. B. Dominic oder Anja"></label>' +
      '<div class="btn-row"><button class="btn" id="keyGo" type="button">Verbinden</button></div></div></details>' +
      '<details class="small"><summary>Notfall-Code (Handy verloren)</summary><div class="stack" style="margin-top:10px">' +
      '<label class="field"><span>Notfall-Kopplungscode aus dem Apps-Script-Protokoll</span><input class="key-input" id="codeIn" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX"></label>' +
      '<div class="btn-row"><button class="btn" id="codeGo" type="button">Als Master verbinden</button></div></div></details>' +
      '<div class="btn-row"><button class="btn ghost small" id="keySkip" type="button">Erstmal ohne Verbindung</button></div></div>';
    var m = /[#&?]k=([A-Za-z0-9-]+)/.exec(location.href);
    if (m) { $('#keyIn').value = m[1]; $('#legacyBox').open = true; }
    if (s0.deviceName) $('#nameIn').value = s0.deviceName;
    var mn = /[?&]n=([^&]+)/.exec(location.href);
    if (mn) $('#nameIn').value = decodeURIComponent(mn[1]);
    var msg = function (html) { $('#setupMsg').innerHTML = html; };
    var timer = null, poll = null, gone = false;
    function stopAll() { clearInterval(timer); clearTimeout(poll); }
    U.onCleanup(function () { gone = true; stopAll(); });

    $('#reqGo').onclick = async function () {
      if (!window.crypto || !crypto.subtle) { msg('<div class="notice err">Dieser Browser kann keine sicheren Schlüssel erzeugen (HTTPS nötig).</div>'); return; }
      var btn = this; btn.disabled = true;
      msg('<div class="notice info"><span class="spinner"></span> Anfrage wird erstellt…</div>');
      var key = newKey(), j;
      try {
        var s = await S.Settings.get();
        j = await S.api('reqStart', { hash: await sha(key), oldHash: s.key ? await sha(s.key) : undefined, label: S.deviceLabel(), deviceId: s.deviceId }, { noKey: true, timeout: 30000 });
      } catch (e) { btn.disabled = false; msg('<div class="notice err">' + esc(e.offline ? 'Nur mit Internet möglich.' : e.message) + '</div>'); return; }
      msg('');
      var svg = await qrSvg(pairUrl(j.code));
      if (gone) return;
      $('#reqBox').innerHTML =
        '<div class="stack" style="text-align:center">' +
        '<div class="small muted">Dominic: <b>Master-Handy → Sync → Geräte → „Gerät freigeben“</b> und diesen QR-Code scannen.</div>' +
        '<div class="qr-wrap">' + svg + '</div>' +
        '<div class="small muted">Prüfzahl – Dominic tippt sie am Handy ab:</div>' +
        '<div class="pair-code" id="reqCheck" style="font-size:34px;letter-spacing:.25em">' + esc(j.check) + '</div>' +
        '<div class="small muted">Ohne Kamera: Code am Master eintippen</div>' +
        '<div class="pair-code" style="font-size:18px">' + esc(fmtCode(j.code)) + '</div>' +
        '<div class="small muted" id="reqLeft"></div><div id="reqState"><div class="notice info small"><span class="spinner"></span> Warte auf Freigabe…</div></div></div>';
      function left() {
        var ms = j.exp - Date.now(), el = $('#reqLeft');
        if (!el) { stopAll(); return; }
        if (ms <= 0) { stopAll(); el.textContent = ''; $('#reqState').innerHTML = '<div class="notice err small">Abgelaufen.</div><div class="btn-row"><button class="btn" id="reqAgain" type="button">Neuen QR-Code anzeigen</button></div>'; $('#reqAgain').onclick = function () { window.ELUH_APP.router(); }; return; }
        el.textContent = 'Gültig noch ' + Math.floor(ms / 60000) + ':' + String(Math.floor(ms / 1000) % 60).padStart(2, '0') + ' Min.';
      }
      left(); timer = setInterval(left, 1000);
      async function check() {
        if (gone) return;
        try {
          var st = await S.api('reqStatus', { code: j.code }, { noKey: true, timeout: 20000 });
          if (st.status === 'ok') { stopAll(); $('#reqState').innerHTML = '<div class="notice ok small">✓ Freigegeben – verbinde…</div>'; await connected(key, st.name); return; }
          if (st.status === 'no') { stopAll(); $('#reqState').innerHTML = '<div class="notice err small">Abgelehnt.</div><div class="btn-row"><button class="btn" id="reqAgain" type="button">Neu versuchen</button></div>'; $('#reqAgain').onclick = function () { window.ELUH_APP.router(); }; return; }
        } catch (e) { if (/ungültig oder abgelaufen/.test(e.message)) { stopAll(); $('#reqState').innerHTML = '<div class="notice err small">Anfrage abgelaufen.</div>'; return; } }
        if (Date.now() < j.exp) poll = setTimeout(check, 3000);
      }
      poll = setTimeout(check, 3000);
    };

    // Notfall: Kopplungscode aus masterNotfall() → dieses Gerät wird Master
    $('#codeGo').onclick = async function () {
      var code = codeFrom($('#codeIn').value);
      if (!code) { U.toast('Bitte den 12-stelligen Code eingeben', true); return; }
      msg('<div class="notice info"><span class="spinner"></span> Code wird geprüft…</div>');
      try {
        var chk = await S.api('pairCheck', { code: code }, { noKey: true, timeout: 30000 });
        if (!chk.master) { msg('<div class="notice err">Das ist kein Notfall-Code.</div>'); return; }
        msg('');
        var ok = await U.confirmBox('Neues Master-Gerät', 'Dieses Gerät wird das Master-Gerät (Dominic).', 'Master übernehmen');
        if (!ok) return;
        var s = await S.Settings.get();
        var j = await S.api('pairFinish', { code: code, label: S.deviceLabel(), deviceId: s.deviceId, oldKey: s.key || undefined }, { noKey: true, timeout: 30000 });
        await connected(j.key, 'Dominic');
      } catch (e) { msg('<div class="notice err">' + esc(e.message) + '</div>'); }
    };

    async function connected(key, name) {
      var pj = await S.api('ping', {}, { key: key, timeout: 30000 });
      var before = await S.Settings.get();
      if (before.role && before.role !== pj.role) {
        // Gerät wechselt zwischen Dominic- und Büro-Zugang → lokale Auftragsdaten entfernen
        await S.DB.clear('auftraege'); await S.DB.clear('outbox'); await S.DB.put('kv', 0, 'seq'); await S.DB.put('kv', [], 'officeList');
      }
      await S.Settings.set({ key: key, skipSetup: false, revoked: null, role: pj.role, vapidKey: pj.vapidKey, icsToken: pj.ics, deviceName: name,
        isMaster: !!pj.master, hasMaster: !!pj.hasMaster, legacyKey: !!pj.legacy });
      S.Sync.state.authError = false;
      S.Push.register().catch(function () {});
      U.toast(pj.master ? 'Verbunden – dieses Gerät ist jetzt Master' : pj.role === 'buero' ? 'Verbunden (Büro)' : 'Verbunden – Kundendatenbank wird geladen');
      location.hash = '#/heute';
      S.Sync.run({ fullIndex: true });
    }

    $('#keyGo').onclick = async function () {
      var key = $('#keyIn').value.trim();
      var name = $('#nameIn').value.trim();
      if (!key) return;
      if (!name) { U.toast('Bitte deinen Namen eingeben', true); return; }
      var btn = this;
      btn.disabled = true;
      msg('<div class="notice info"><span class="spinner"></span> Verbindung wird geprüft…</div>');
      try { await connected(key, name); }
      catch (e) { msg('<div class="notice err">' + esc(e.auth ? 'Schlüssel stimmt nicht.' : e.message) + '</div>'); }
      finally { btn.disabled = false; }
    };
    $('#keySkip').onclick = async function () {
      await S.Settings.set({ skipSetup: true });
      location.hash = '#/auftraege';
    };
  }, 'sync');

  // ------------------------------------------------------------------
  // Master: Freigabe einer Anfrage (QR gescannt oder Code getippt)
  // ------------------------------------------------------------------
  function approve(code, onDone) {
    return new Promise(async function (resolve) {
      var info;
      try { info = await S.api('reqInfo', { code: code }, { timeout: 20000 }); }
      catch (e) { U.toast(e.offline ? 'Nur mit Internet möglich' : e.message, true); resolve(false); return; }
      if (info.status !== 'wait') { U.toast('Diese Anfrage ist schon bearbeitet', true); resolve(false); return; }
      var done = false;
      var sheet = U.openModal(
        '<div class="sheet-head"><h3>Gerät freigeben</h3><button class="btn small ghost" data-close aria-label="Schließen">' + U.ICONS.close + '</button></div>' +
        '<div class="sheet-body stack">' +
        '<div class="notice warn small">Nur freigeben, wenn du dieses Gerät gerade selbst oder dein Mitarbeiter vor dir einrichtet. Gerät: <b>' + esc(info.label || 'unbekannt') + '</b>' +
        (info.replaces ? ' (war schon verbunden – alter Zugang wird ersetzt)' : '') + '</div>' +
        '<label class="field"><span>Prüfzahl vom Bildschirm des neuen Geräts</span><input id="apCheck" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="4 Ziffern" style="font-size:22px;letter-spacing:.2em"></label>' +
        '<div class="stack" id="apRole">' +
        '<label><input type="radio" name="apRole" value="chef" checked> Mein Gerät (Dominic) – voller Zugriff</label>' +
        '<label><input type="radio" name="apRole" value="buero"> Büro – Aufträge drucken/abrechnen, Termine, Kunden lesen</label>' +
        '<label><input type="radio" name="apRole" value="master"> Neues Master-Gerät (dieses Handy wird normales Gerät)</label></div>' +
        '<label class="field" id="apNameBox" style="display:none"><span>Name (erscheint bei Terminen und in der Geräteliste)</span><input id="apName" autocomplete="off" placeholder="z. B. Anja"></label>' +
        '<div id="apErr"></div>' +
        '<div class="btn-row" style="justify-content:flex-end"><button class="btn ghost" data-no type="button">Ablehnen</button><button class="btn primary" data-yes type="button">Freigeben</button></div></div>',
        { onClose: function () { if (!done) { done = true; resolve(false); } } });
      var err = function (t) { $('#apErr', sheet).innerHTML = t ? '<div class="notice err small">' + esc(t) + '</div>' : ''; };
      function role() { return ($('input[name=apRole]:checked', sheet) || {}).value; }
      $$('input[name=apRole]', sheet).forEach(function (r) { r.onchange = function () { $('#apNameBox', sheet).style.display = role() === 'buero' ? '' : 'none'; }; });
      setTimeout(function () { $('#apCheck', sheet).focus(); }, 50);
      $('[data-no]', sheet).onclick = async function () {
        done = true; U.closeModal();
        try { await S.api('reqDeny', { code: code }); U.toast('Abgelehnt'); } catch (e) { U.toast(e.message, true); }
        resolve(false);
      };
      $('[data-yes]', sheet).onclick = async function () {
        var r = role(), check = $('#apCheck', sheet).value.replace(/\D/g, ''), name = $('#apName', sheet).value.trim();
        if (check.length !== 4) { err('Bitte die 4-stellige Prüfzahl eingeben.'); return; }
        if (r === 'buero' && !name) { err('Bitte einen Namen für das Büro-Gerät eingeben.'); return; }
        var btn = this; btn.disabled = true; err('');
        try {
          var j = await S.api('reqApprove', { code: code, check: check, asRole: r === 'master' ? 'chef' : r, master: r === 'master', name: r === 'chef' ? 'Dominic' : name }, { timeout: 30000 });
          done = true; U.closeModal();
          if (j.master) { await S.Settings.set({ isMaster: false }); U.toast('Freigegeben – das neue Gerät ist jetzt Master'); }
          else U.toast('Freigegeben: ' + (j.name || '') + ' · ' + (j.label || ''));
          if (onDone) onDone();
          resolve(true);
        } catch (e) {
          btn.disabled = false;
          err(e.message);
          if (/gesperrt|schon bearbeitet|abgelaufen/.test(e.message)) { done = true; setTimeout(function () { U.closeModal(); resolve(false); }, 2500); }
        }
      };
    });
  }

  function askText(title, label, placeholder, okLabel) {
    return new Promise(function (resolve) {
      var done = false;
      var sheet = U.openModal(
        '<div class="sheet-head"><h3>' + esc(title) + '</h3></div><div class="sheet-body stack">' +
        '<label class="field"><span>' + esc(label) + '</span><input class="key-input" id="txIn" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="' + esc(placeholder || '') + '"></label>' +
        '<div class="btn-row" style="justify-content:flex-end"><button class="btn ghost" data-no>Abbrechen</button><button class="btn primary" data-yes>' + esc(okLabel || 'OK') + '</button></div></div>',
        { onClose: function () { if (!done) resolve(null); } });
      var inp = $('#txIn', sheet);
      setTimeout(function () { inp.focus(); }, 50);
      $('[data-no]', sheet).onclick = function () { done = true; U.closeModal(); resolve(null); };
      $('[data-yes]', sheet).onclick = function () { var v = inp.value.trim(); if (!v) return; done = true; U.closeModal(); resolve(v); };
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') $('[data-yes]', sheet).click(); });
    });
  }

  // ------------------------------------------------------------------
  // Geräte-Verwaltung (Sync-Seite)
  // ------------------------------------------------------------------
  async function renderBox(box, legacyOfficeBox) {
    if (!box) return;
    var s = await S.Settings.get();
    if (navigator.onLine && s.key) { try { await S.refreshPing(); s = await S.Settings.get(); } catch (e) { /* offline */ } }
    if (!document.body.contains(box)) return;
    if (!s.isMaster && !s.hasMaster && s.role === 'chef') {
      box.innerHTML =
        '<div class="small"><b>Noch kein Master-Gerät.</b> Mach dein Handy zum Master: Es bekommt einen neuen, langen Schlüssel (48 Zeichen). Nur am Master gibst du neue Geräte frei (das neue Gerät zeigt einen QR-Code, du scannst ihn mit dem Master-Handy und wählst „Dominic“ oder „Büro“) und kannst Geräte jederzeit entfernen – ein entferntes Gerät löscht dann alle Daten.</div>' +
        '<div class="small muted">Danach gilt dein bisheriger App-Schlüssel nicht mehr: iPad und Mac verbindest du einfach neu: dort QR-Code anzeigen, am Master scannen. Der alte Büro-Schlüssel funktioniert weiter, bis du ihn abschaltest.</div>' +
        '<div class="btn-row"><button type="button" class="btn primary" id="mkMaster">Dieses Gerät zum Master machen</button></div>' +
        '<div class="hr"></div><div class="stack" id="legacyOffice"></div>';
      $('#mkMaster', box).onclick = async function () {
        var ok = await U.confirmBox('Master-Gerät festlegen?', 'Dieses Gerät (' + S.deviceLabel() + ') wird das Master-Gerät. Dein bisheriger App-Schlüssel funktioniert danach auf keinem Gerät mehr – deine anderen Geräte verbindest du per QR-Code neu.', 'Zum Master machen');
        if (!ok) return;
        try {
          var j = await S.api('becomeMaster', { name: 'Dominic', label: S.deviceLabel(), deviceId: s.deviceId });
          await S.Settings.set({ key: j.key, isMaster: true, hasMaster: true, legacyKey: false });
          S.Push.register().catch(function () {});
          U.toast('Dieses Gerät ist jetzt das Master-Gerät');
          renderBox(box, legacyOfficeBox);
        } catch (e) { U.toast(e.message, true); }
      };
      if (legacyOfficeBox) legacyOfficeBox($('#legacyOffice', box));
      return;
    }
    if (!s.isMaster) {
      box.innerHTML = '<div class="small">Geräte hinzufügen und entfernen geht nur am <b>Master-Gerät</b>.</div>' +
        '<dl class="kv"><dt>Dieses Gerät</dt><dd>' + esc(S.deviceLabel()) + ' · ' + esc(s.deviceName || 'Dominic') + '</dd></dl>';
      return;
    }
    box.innerHTML = '<div class="small"><b>Dieses Gerät ist das Master-Gerät.</b> Neue Geräte zeigen einen QR-Code – du scannst ihn hier und gibst das Gerät frei (Dominic, Büro oder neues Master-Gerät).</div>' +
      '<div class="btn-row"><button type="button" class="btn primary" id="devScan">' + U.ICONS.camera + '<span>Gerät freigeben (QR scannen)</span></button>' +
      '<button type="button" class="btn" id="devCode">Code eintippen</button></div>' +
      '<div id="devList" class="list"><div class="empty"><span class="spinner"></span></div></div>' +
      '<div id="devLegacy"></div>';
    $('#devScan', box).onclick = async function () {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { U.toast('Kamera nicht verfügbar – bitte Code eintippen', true); return; }
      var code = await scanQr();
      if (code) { var r = await approve(code, function () { drawList(); }); if (r) renderBox(box, legacyOfficeBox); }
    };
    $('#devCode', box).onclick = async function () {
      var t = await askText('Code eintippen', 'Code vom Bildschirm des neuen Geräts', 'XXXX-XXXX-XXXX', 'Weiter');
      var code = t && codeFrom(t);
      if (t && !code) { U.toast('Bitte den 12-stelligen Code eingeben', true); return; }
      if (code) { var r = await approve(code, function () { drawList(); }); if (r) renderBox(box, legacyOfficeBox); }
    };
    async function drawList() {
      var list = $('#devList', box);
      if (!list) return;
      if (!navigator.onLine) { list.innerHTML = '<div class="empty">Geräteliste nur online abrufbar.</div>'; return; }
      var j;
      try { j = await S.api('devices', {}); }
      catch (e) {
        if (/Master/.test(e.message)) { await S.Settings.set({ isMaster: false }); renderBox(box, legacyOfficeBox); return; }
        list.innerHTML = '<div class="empty">Konnte nicht geladen werden: ' + esc(e.message) + '</div>'; return;
      }
      list.innerHTML = j.devices.map(function (d) {
        return '<div class="row"><span class="main"><span class="title" style="display:block">' + esc(d.name || '–') + ' · ' + esc(d.label || 'Gerät') +
          (d.master ? ' <span class="badge ok">Master</span>' : '') + (d.self ? ' <span class="badge grey">dieses Gerät</span>' : '') + '</span>' +
          '<span class="meta" style="display:block">' + (d.role === 'buero' ? 'Büro' : 'Dominic') + ' · verbunden seit ' + U.fmtDate(d.created) + ' · ' + ago(d.seen) + '</span></span>' +
          (!d.master ? '<button type="button" class="btn small ghost danger" data-rm="' + esc(d.id) + '" data-nm="' + esc((d.name || '') + ' · ' + (d.label || '')) + '">Entfernen</button>' : '') + '</div>';
      }).join('') || '<div class="empty">Noch keine Geräte.</div>';
      $$('[data-rm]', list).forEach(function (b) {
        b.onclick = async function () {
          var ok = await U.confirmBox('Gerät entfernen?', '„' + b.getAttribute('data-nm') + '“ verliert sofort den Zugriff. Beim nächsten Kontakt mit dem Internet löscht das Gerät alle ELUH-Daten (Aufträge, Kundendaten, Offline-Dateien).', 'Entfernen', true);
          if (!ok) return;
          try { await S.api('deviceRemove', { id: b.getAttribute('data-rm') }); U.toast('Gerät entfernt'); drawList(); }
          catch (e) { U.toast(e.message, true); }
        };
      });
      var lg = $('#devLegacy', box);
      if (lg) {
        lg.innerHTML = j.legacyOffice ?
          '<div class="notice warn small">Der <b>alte Büro-Schlüssel</b> ist noch aktiv (Büro-Geräte, die noch nicht neu verbunden sind). Wenn alle Büro-Geräte neu verbunden sind, abschalten.' +
          '<div class="btn-row" style="margin-top:8px"><button type="button" class="btn small danger" id="legacyOff">Alten Büro-Schlüssel abschalten</button></div></div>' : '';
        var lo = $('#legacyOff', lg);
        if (lo) lo.onclick = async function () {
          var ok = await U.confirmBox('Alten Büro-Schlüssel abschalten?', 'Büro-Geräte, die noch mit dem alten Schlüssel arbeiten, haben danach keinen Zugriff mehr und müssen neu verbunden werden (QR-Code anzeigen, am Master freigeben).', 'Abschalten', true);
          if (!ok) return;
          try { await S.api('legacyOff', {}); U.toast('Alter Büro-Schlüssel abgeschaltet'); drawList(); } catch (e) { U.toast(e.message, true); }
        };
      }
    }
    drawList();
  }

  // Entferntes Gerät → zur Einrichtung
  S.on('revoked', function () {
    U.toast('Dieses Gerät wurde entfernt – alle Daten wurden gelöscht', true);
    location.hash = '#/setup';
    window.ELUH_APP.router();
  });

  window.Geraete = { renderBox: renderBox, scanQr: scanQr, codeFrom: codeFrom, approve: approve };
})();
