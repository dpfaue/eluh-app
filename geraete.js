/* ELUH App – Geräte: Master-Gerät, Koppeln per QR-Code / Kopplungscode, Geräteliste */
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
        '<div class="small muted" id="scanMsg">Den QR-Code vom Master-Gerät in den Rahmen halten.</div></div>',
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
        if (msg) msg.innerHTML = '<span class="notice err" style="display:block">Kamera nicht verfügbar (' + esc(e.message || e.name) + '). Bitte den Code unter dem QR-Code abtippen.</span>';
      }
    });
  }

  // ------------------------------------------------------------------
  // Einrichtung / Gerät verbinden
  // ------------------------------------------------------------------
  U.route(/^#\/(?:setup|pair)(?:\?.*)?$/, async function () {
    var s0 = await S.Settings.get();
    var urlCode = codeFrom(location.hash);
    var revoked = !!s0.revoked && !s0.key;
    var iosBrowser = U.isIOS() && !standalone();
    U.view.innerHTML =
      '<div class="setup card pad stack">' +
      '<img class="logo" src="logo.png" alt="eluh Anlagen Kyritz">' +
      '<h1 style="margin:0;font-size:22px">Gerät verbinden</h1>' +
      (revoked ? '<div class="notice err">Dieses Gerät wurde am Master-Gerät entfernt. Alle Daten auf diesem Gerät wurden gelöscht.</div>' : '') +
      '<p class="muted" style="margin:0">Am Master-Gerät (Dominics Handy) unter <b>Sync → Geräte → „Gerät hinzufügen“</b> den QR-Code öffnen und hier scannen.</p>' +
      (iosBrowser ? '<div class="notice warn small">iPhone/iPad: Bitte zuerst über <b>Teilen → „Zum Home-Bildschirm“</b> installieren und in der <b>installierten App</b> verbinden – Safari und die App haben getrennte Speicher.</div>' : '') +
      '<button class="btn primary big" id="scanGo" type="button" style="width:100%">' + U.ICONS.camera + '<span>QR-Code scannen</span></button>' +
      '<label class="field"><span>oder Kopplungscode eingeben</span><input class="key-input" id="codeIn" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX" value="' + esc(urlCode) + '"></label>' +
      '<div class="btn-row"><button class="btn" id="codeGo" type="button">Weiter</button></div>' +
      '<div id="setupMsg"></div>' +
      '<details class="small" id="legacyBox"><summary>Mit bisherigem App-Schlüssel verbinden</summary><div class="stack" style="margin-top:10px">' +
      '<label class="field"><span>App-Schlüssel</span><input class="key-input" id="keyIn" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX-XXXX"></label>' +
      '<label class="field"><span>Dein Name (für Termine und Erinnerungen)</span><input id="nameIn" autocomplete="name" placeholder="z. B. Dominic oder Anja"></label>' +
      '<div class="btn-row"><button class="btn" id="keyGo" type="button">Verbinden</button></div></div></details>' +
      '<div class="btn-row"><button class="btn ghost small" id="keySkip" type="button">Erstmal ohne Verbindung</button></div></div>';
    var m = /[#&?]k=([A-Za-z0-9-]+)/.exec(location.href);
    if (m) { $('#keyIn').value = m[1]; $('#legacyBox').open = true; }
    if (s0.deviceName) $('#nameIn').value = s0.deviceName;
    var mn = /[?&]n=([^&]+)/.exec(location.href);
    if (mn) $('#nameIn').value = decodeURIComponent(mn[1]);
    var msg = function (html) { $('#setupMsg').innerHTML = html; };

    $('#scanGo').onclick = async function () {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { U.toast('Kamera nicht verfügbar – bitte Code eingeben', true); $('#codeIn').focus(); return; }
      var code = await scanQr();
      if (code) { $('#codeIn').value = code; startPair(code); }
    };
    $('#codeGo').onclick = function () {
      var code = codeFrom($('#codeIn').value);
      if (!code) { U.toast('Bitte den 12-stelligen Code eingeben', true); return; }
      startPair(code);
    };
    $('#codeIn').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('#codeGo').click(); });

    async function startPair(code) {
      msg('<div class="notice info"><span class="spinner"></span> Code wird geprüft…</div>');
      var chk;
      try { chk = await S.api('pairCheck', { code: code }, { noKey: true, timeout: 30000 }); }
      catch (e) { msg('<div class="notice err">' + esc(e.message) + '</div>'); return; }
      msg('');
      var role, name;
      if (chk.master) {
        var ok = await U.confirmBox('Neues Master-Gerät', 'Dieses Gerät wird das neue Master-Gerät (Dominic). Das bisherige Master-Gerät bleibt als normales Gerät verbunden.', 'Master übernehmen');
        if (!ok) return;
        role = 'chef'; name = 'Dominic';
      } else {
        role = await U.choiceBox('Wessen Gerät ist das?', '<p class="muted" style="margin:0">Das bestimmt, was auf diesem Gerät zu sehen ist.</p>', [
          { key: 'chef', label: 'Mein Gerät (Dominic) – voller Zugriff', cls: 'primary' },
          { key: 'buero', label: 'Büro – Aufträge drucken/abrechnen, Termine, Kunden lesen' }
        ]);
        if (!role) return;
        if (role === 'buero') {
          name = await askName(s0.role === 'buero' ? s0.deviceName : '');
          if (!name) return;
        } else name = 'Dominic';
      }
      await finishPair(code, role, name);
    }

    async function finishPair(code, role, name) {
      msg('<div class="notice info"><span class="spinner"></span> Gerät wird verbunden…</div>');
      try {
        var s = await S.Settings.get();
        var j = await S.api('pairFinish', { code: code, role: role, name: name, label: S.deviceLabel(), deviceId: s.deviceId, oldKey: s.key || undefined }, { noKey: true, timeout: 30000 });
        await connected(j.key, name);
      } catch (e) { msg('<div class="notice err">' + esc(e.message) + '</div>'); }
    }

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
    if (urlCode && !iosBrowser) startPair(urlCode);
  }, 'sync');

  function askName(preset) {
    return new Promise(function (resolve) {
      var done = false;
      var sheet = U.openModal(
        '<div class="sheet-head"><h3>Dein Name</h3></div><div class="sheet-body stack">' +
        '<label class="field"><span>Name (erscheint bei Terminen und in der Geräteliste)</span><input id="nmIn" autocomplete="name" placeholder="z. B. Anja" value="' + esc(preset || '') + '"></label>' +
        '<div class="btn-row" style="justify-content:flex-end"><button class="btn ghost" data-no>Abbrechen</button><button class="btn primary" data-yes>Verbinden</button></div></div>',
        { onClose: function () { if (!done) resolve(null); } });
      var inp = $('#nmIn', sheet);
      setTimeout(function () { inp.focus(); }, 50);
      $('[data-no]', sheet).onclick = function () { done = true; U.closeModal(); resolve(null); };
      $('[data-yes]', sheet).onclick = function () {
        var v = inp.value.trim();
        if (!v) { U.toast('Bitte einen Namen eingeben', true); return; }
        done = true; U.closeModal(); resolve(v);
      };
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
        '<div class="small"><b>Noch kein Master-Gerät.</b> Mach dein Handy zum Master: Es bekommt einen neuen, langen Schlüssel (48 Zeichen). Nur am Master fügst du neue Geräte per QR-Code hinzu (beim Scannen wählt man „Dominic“ oder „Büro“) und kannst Geräte jederzeit entfernen – ein entferntes Gerät löscht dann alle Daten.</div>' +
        '<div class="small muted">Danach gilt dein bisheriger App-Schlüssel nicht mehr: iPad und Mac verbindest du einfach per QR-Code neu. Der alte Büro-Schlüssel funktioniert weiter, bis du ihn abschaltest.</div>' +
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
    box.innerHTML = '<div class="small"><b>Dieses Gerät ist das Master-Gerät.</b> Neue Geräte verbindest du per QR-Code – beim Scannen wird gewählt, ob es dein Gerät oder ein Büro-Gerät ist.</div>' +
      '<div class="btn-row"><button type="button" class="btn primary" id="devAdd">' + U.ICONS.plus + '<span>Gerät hinzufügen</span></button></div>' +
      '<div id="devList" class="list"><div class="empty"><span class="spinner"></span></div></div>' +
      '<div id="devLegacy"></div>' +
      '<details class="small"><summary>Master auf ein anderes Gerät übertragen</summary><div class="stack" style="margin-top:8px">' +
      '<div class="muted">Z. B. bei einem neuen Handy: QR-Code am neuen Gerät scannen – es wird Master, dieses Gerät bleibt normal verbunden.</div>' +
      '<div class="btn-row"><button type="button" class="btn" id="devMasterMove">QR-Code für neues Master-Gerät</button></div></div></details>';
    $('#devAdd', box).onclick = function () { showPairCode(false, function () { drawList(); }); };
    $('#devMasterMove', box).onclick = function () { showPairCode(true, function () { renderBox(box, legacyOfficeBox); }); };
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
          '<div class="notice warn small">Der <b>alte Büro-Schlüssel</b> ist noch aktiv (Büro-Geräte, die noch nicht per QR-Code verbunden sind). Wenn alle Büro-Geräte neu verbunden sind, abschalten.' +
          '<div class="btn-row" style="margin-top:8px"><button type="button" class="btn small danger" id="legacyOff">Alten Büro-Schlüssel abschalten</button></div></div>' : '';
        var lo = $('#legacyOff', lg);
        if (lo) lo.onclick = async function () {
          var ok = await U.confirmBox('Alten Büro-Schlüssel abschalten?', 'Büro-Geräte, die noch mit dem alten Schlüssel arbeiten, haben danach keinen Zugriff mehr und müssen per QR-Code neu verbunden werden.', 'Abschalten', true);
          if (!ok) return;
          try { await S.api('legacyOff', {}); U.toast('Alter Büro-Schlüssel abgeschaltet'); drawList(); } catch (e) { U.toast(e.message, true); }
        };
      }
    }
    drawList();
  }

  /** QR-Code + Kopplungscode anzeigen, bis ein Gerät ihn benutzt hat (oder 15 Min. vorbei sind) */
  async function showPairCode(master, onDone) {
    var j;
    try { j = await S.api('pairStart', { master: !!master }); }
    catch (e) { U.toast(e.offline ? 'Nur mit Internet möglich' : e.message, true); return; }
    var started = Date.now() - 5000, timer = null, poll = null, closed = false;
    var svg = await qrSvg(pairUrl(j.code));
    var sheet = U.openModal(
      '<div class="sheet-head"><h3>' + (master ? 'Neues Master-Gerät' : 'Gerät hinzufügen') + '</h3><button class="btn small ghost" data-close aria-label="Schließen">' + U.ICONS.close + '</button></div>' +
      '<div class="sheet-body stack" style="text-align:center">' +
      '<div class="small muted">' + (master ? 'Am neuen Handy die ELUH-App öffnen → „QR-Code scannen“.' : 'Am neuen Gerät die ELUH-App öffnen → „QR-Code scannen“. Danach wird gefragt: <b>Dominic</b> oder <b>Büro</b>.') + '</div>' +
      '<div class="qr-wrap">' + svg + '</div>' +
      '<div class="small muted">Ohne Kamera (z. B. Büro-PC): App-Adresse öffnen und diesen Code eingeben</div>' +
      '<div class="pair-code">' + esc(fmtCode(j.code)) + '</div>' +
      '<div class="small muted" id="pairLeft"></div>' +
      '<div class="small" style="word-break:break-all"><a href="' + esc(appUrl()) + '">' + esc(appUrl()) + '</a></div>' +
      '<div id="pairState"></div>' +
      '<div class="btn-row" style="justify-content:center"><button type="button" class="btn small" id="pairCopy">Link kopieren</button></div></div>',
      { onClose: function () { closed = true; clearInterval(timer); clearTimeout(poll); } });
    $('#pairCopy', sheet).onclick = async function () {
      try { await navigator.clipboard.writeText(pairUrl(j.code)); U.toast('Link kopiert (15 Min. gültig, nur einmal nutzbar)'); } catch (e) { U.toast('Kopieren nicht möglich', true); }
    };
    function left() {
      var ms = j.exp - Date.now(), el = $('#pairLeft', sheet);
      if (!el) return;
      if (ms <= 0) { el.textContent = 'Abgelaufen – bitte neu öffnen.'; $('.qr-wrap', sheet).style.opacity = .15; clearInterval(timer); clearTimeout(poll); return; }
      el.textContent = 'Gültig noch ' + Math.floor(ms / 60000) + ':' + String(Math.floor(ms / 1000) % 60).padStart(2, '0') + ' Min. · nur einmal nutzbar';
    }
    left();
    timer = setInterval(left, 1000);
    async function check() {
      if (closed) return;
      try {
        var d = await S.api('devices', {}, { timeout: 15000 });
        var fresh = d.devices.filter(function (x) { return x.created >= started && !x.self; })[0];
        if (master) {
          var me = d.devices.filter(function (x) { return x.self; })[0];
          if (me && !me.master) fresh = d.devices.filter(function (x) { return x.master; })[0] || fresh;
        }
        if (fresh) {
          clearInterval(timer);
          $('#pairState', sheet).innerHTML = '<div class="notice ok">✓ Verbunden: ' + esc(fresh.name) + ' · ' + esc(fresh.label || '') + ' (' + (fresh.master ? 'neues Master-Gerät' : fresh.role === 'buero' ? 'Büro' : 'Dominic') + ')</div>';
          $('.qr-wrap', sheet).style.opacity = .15;
          if (master) await S.Settings.set({ isMaster: false });
          if (onDone) onDone();
          return;
        }
      } catch (e) {
        if (master && /Master/.test(e.message)) {
          await S.Settings.set({ isMaster: false });
          $('#pairState', sheet).innerHTML = '<div class="notice ok">✓ Master wurde übertragen.</div>';
          if (onDone) onDone();
          return;
        }
      }
      if (Date.now() < j.exp) poll = setTimeout(check, 3000);
    }
    poll = setTimeout(check, 3000);
  }

  // Entferntes Gerät → zur Einrichtung
  S.on('revoked', function () {
    U.toast('Dieses Gerät wurde entfernt – alle Daten wurden gelöscht', true);
    location.hash = '#/setup';
    window.ELUH_APP.router();
  });

  window.Geraete = { renderBox: renderBox, scanQr: scanQr, codeFrom: codeFrom };
})();
