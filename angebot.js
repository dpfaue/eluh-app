/* ELUH App – Angebotsanfragen (nur Dominic): Kunde + was gemacht werden soll + Material → Büro druckt und schreibt das Angebot fertig */
(function () {
  'use strict';
  var S = window.Store, U = window.UI;
  var $ = U.$, $$ = U.$$, esc = U.esc;

  function custShort(a) { var f = a.f || {}; return f.kunde_name || U.parseCustomer(a.customerName || '').name || a.customerName || 'Ohne Kunde'; }
  function firstLine(t) { t = String(t || '').trim().split('\n')[0]; return t.length > 70 ? t.slice(0, 68) + '…' : t; }

  /** Status aus Sicht von Dominic */
  function stateOf(a) {
    var o = a.office || {};
    if (!o.shared) return { cls: 'grey', text: 'Entwurf', key: 'entwurf' };
    if (o.billedAt) return { cls: 'ok', text: 'Büro: erledigt', key: 'erledigt' };
    if (o.printedAt) return { cls: 'info', text: 'Büro: gedruckt', key: 'buero' };
    return { cls: 'warn', text: 'Im Büro', key: 'buero' };
  }

  function row(a) {
    var st = stateOf(a), f = a.f || {};
    return '<a class="row" href="#/angebot/' + esc(a.id) + '"><span class="main">' +
      '<span class="title" style="display:block">' + esc(custShort(a)) + '</span>' +
      '<span class="meta" style="display:block">' + esc([U.isoToDe(f.datum_annahme), firstLine(f.angebot_text) || 'noch kein Text'].filter(Boolean).join(' · ')) + '</span></span>' +
      '<span class="badge ' + st.cls + '">' + st.text + '</span>' + U.ICONS.chev + '</a>';
  }

  function setCustomer(a, c) {
    var p = U.parseCustomer(c.name);
    a.customerId = c.id;
    a.customerName = c.name;
    a.f = a.f || {};
    a.f.kunde_name = p.name || c.name;
    a.f.kunde_adresse = p.address || '';
  }

  /** Neues Angebot anlegen und öffnen */
  async function create(customer) {
    var a = S.Angebote.create();
    if (customer) setCustomer(a, customer);
    await S.Angebote.save(a);
    location.hash = '#/angebot/' + a.id;
  }
  function createWithPicker() { U.openCustomerPicker(function (c) { create(c); }); }

  // ------------------------------------------------------------------
  // Übersicht
  // ------------------------------------------------------------------
  U.route(/^#\/angebote$/, async function () {
    var tab = 'offen';
    U.view.innerHTML = '<div class="page-head"><a class="btn ghost small" href="#/auftraege">‹ Aufträge</a><h1>Angebote</h1><div class="sub">Fürs Büro zum Drucken und Fertigschreiben</div></div>' +
      '<div class="btn-row" style="margin-bottom:12px"><button type="button" class="btn primary" id="agNew">' + U.ICONS.plus + '<span>Neues Angebot</span></button></div>' +
      '<div class="chips" id="agTabs" style="margin-bottom:10px"></div><div id="agList"><div class="empty"><span class="spinner"></span></div></div>';
    $('#agNew').onclick = createWithPicker;
    var me = U.current();
    async function draw() {
      var all = await S.Angebote.all();
      if (U.current() !== me || !$('#agList')) return;
      all.sort(function (a, b) { return b.createdAt - a.createdAt; });
      var open = all.filter(function (a) { return stateOf(a).key !== 'erledigt'; });
      var done = all.filter(function (a) { return stateOf(a).key === 'erledigt'; });
      $('#agTabs').innerHTML = '<button type="button" class="chip' + (tab === 'offen' ? ' on' : '') + '" data-t="offen">Offen (' + open.length + ')</button>' +
        '<button type="button" class="chip' + (tab === 'erledigt' ? ' on' : '') + '" data-t="erledigt">Vom Büro erledigt (' + done.length + ')</button>';
      $$('[data-t]', $('#agTabs')).forEach(function (b) { b.onclick = function () { tab = b.getAttribute('data-t'); draw(); }; });
      var list = tab === 'offen' ? open : done.slice(0, 100);
      $('#agList').innerHTML = '<div class="list">' + (list.map(row).join('') ||
        '<div class="empty">' + (tab === 'offen' ? 'Keine offenen Angebote.' : 'Noch nichts erledigt.') + '</div>') + '</div>';
    }
    await draw();
    U.rerenderOn(['auftraege', 'sync'], draw);
  }, 'auftraege');

  // ------------------------------------------------------------------
  // Einzelnes Angebot
  // ------------------------------------------------------------------
  U.route(/^#\/angebot\/([\w-]+)$/, async function (id) {
    var a = await S.Auftraege.get(id);
    if (!a || a.deleted || a.kind !== 'angebot') { U.view.innerHTML = '<div class="notice warn">Angebot nicht gefunden.</div><p><a href="#/angebote">Zur Übersicht</a></p>'; return; }
    a.f = a.f || {};
    U.view.innerHTML =
      '<div class="page-head"><a class="btn ghost small" href="#/angebote">‹ Angebote</a><h1>Angebot</h1><div class="sub" id="agState"></div></div>' +
      '<div id="agConf"></div>' +
      '<section class="form-section card pad stack">' +
      '<div><div class="small muted">Kunde</div><div id="agCust"></div></div>' +
      '<label class="field"><span>Was soll gemacht werden?</span><textarea id="agText" rows="8" placeholder="z. B. Gastherme tauschen, Abgasanlage prüfen, Heizkörper im Bad versetzen…"></textarea></label>' +
      '<label class="field"><span>Material</span><textarea id="agMat" rows="6" placeholder="Eine Position pro Zeile, z. B.&#10;Gas-Brennwerttherme 24 kW&#10;2x Heizkörperventil DN15"></textarea></label>' +
      '<div class="small muted" id="agSave"></div></section>' +
      '<div class="btn-row" id="agAct" style="margin-top:14px"></div>' +
      '<div class="btn-row" style="margin-top:18px"><button type="button" class="btn ghost danger small" id="agDel">Löschen</button></div>';
    var me = U.current();
    var idx = await S.Index.load();
    if (U.current() !== me || !$('#agText')) return;
    var FIELDS = { angebot_text: '#agText', angebot_material: '#agMat' };
    var timer = null;
    var sess = new S.EditSession(a);

    function drawCust() {
      if (!$('#agCust')) return;
      var c = a.customerId ? S.Index.item(idx, a.customerId) : null;
      $('#agCust').innerHTML = (a.customerId ? '<a href="#/ordner/' + encodeURIComponent(a.customerId) + '"><b>' + esc((c && c.name || a.customerName || '').trim()) + '</b></a>' : '<b>Kein Kunde</b>') +
        ' <button type="button" class="btn small ghost" id="agCustChg">' + (a.customerId ? 'Ändern' : 'Kunde wählen') + '</button>';
      $('#agCustChg').onclick = function () {
        U.openCustomerPicker(function (c) { setCustomer(a, c); changed(); drawCust(); });
      };
    }
    async function persist() {
      clearTimeout(timer); timer = null;
      // Druckstatus kommt vom Büro (Server) – nur die Freigabe stellt Dominic ein
      var cur = await S.Auftraege.get(a.id);
      if (cur && cur.office) a.office = Object.assign({}, cur.office, a.office ? { shared: a.office.shared, sharedAt: a.office.sharedAt || cur.office.sharedAt } : {});
      await sess.stamp(a);
      var shown = {};
      Object.keys(FIELDS).forEach(function (k) { var el = $(FIELDS[k]); if (el) shown[k] = el.value; });
      await S.Angebote.save(a); // führt mit Änderungen anderer Geräte zusammen
      sess.reset(a);
      showFields(shown);
      var el = $('#agSave'); if (el) el.textContent = 'Gespeichert ' + U.fmtTime(Date.now());
    }
    /** Felder an den gespeicherten Stand anpassen – was inzwischen getippt wurde, bleibt */
    function showFields(shown) {
      a.f = a.f || {};
      Object.keys(FIELDS).forEach(function (k) {
        var el = $(FIELDS[k]);
        if (!el) return;
        if (shown && el.value !== shown[k]) { a.f[k] = el.value; return; }
        if (el.value !== (a.f[k] || '')) el.value = a.f[k] || '';
      });
      drawConf();
    }
    function drawConf() {
      U.conflictBox($('#agConf'), a, { angebot_text: 'Was soll gemacht werden?', angebot_material: 'Material', kunde_name: 'Kunde', kunde_adresse: 'Adresse' }, {
        apply: function (c) {
          var x = window.RecMerge.kind(c.k);
          if (x.t !== 'sub' || x.o !== 'f') { a[c.k] = c.v; return true; }
          a.f[x.s] = c.v;
          if (FIELDS[x.s] && $(FIELDS[x.s])) $(FIELDS[x.s]).value = c.v;
          return true;
        },
        save: function () { changed(); }
      });
    }
    U.rerenderOn(['auftraege'], async function () {
      if (timer) return; // eigene Eingabe wird gleich gespeichert und dabei zusammengeführt
      var fresh = await S.Auftraege.get(a.id);
      if (!fresh || timer) return;
      if (!window.RecMerge.changedKeys(fresh, sess.base).length && JSON.stringify(fresh.cf || {}) === JSON.stringify(a.cf || {}) &&
        JSON.stringify(fresh.office || {}) === JSON.stringify(a.office || {})) return;
      var ae = document.activeElement;
      Object.keys(fresh).forEach(function (k) { if (k.charAt(0) !== '_') a[k] = fresh[k]; });
      Object.keys(a).forEach(function (k) { if (!(k in fresh)) delete a[k]; });
      a.f = a.f || {};
      sess.reset(a);
      Object.keys(FIELDS).forEach(function (k) { var el = $(FIELDS[k]); if (el && el !== ae && el.value !== (a.f[k] || '')) el.value = a.f[k] || ''; });
      drawConf(); drawCust(); drawAct();
    });
    function changed() { var el = $('#agSave'); if (el) el.textContent = 'Speichert…'; clearTimeout(timer); timer = setTimeout(persist, 500); }
    $('#agText').value = a.f.angebot_text || '';
    $('#agMat').value = a.f.angebot_material || '';
    $('#agText').oninput = function () { a.f.angebot_text = this.value; changed(); };
    $('#agMat').oninput = function () { a.f.angebot_material = this.value; changed(); };
    U.onCleanup(function () { if (timer) persist(); });

    function drawAct() {
      if (!$('#agAct') || !$('#agState')) return;
      var st = stateOf(a), o = a.office || {};
      $('#agState').innerHTML = '<span class="badge ' + st.cls + '">' + st.text + '</span>' +
        (o.shared ? ' <span class="small muted">geschickt ' + esc(U.fmtDT(o.sharedAt)) + (o.printedAt ? ' · gedruckt ' + esc(U.fmtDT(o.printedAt)) : '') + '</span>' : '');
      $('#agAct').innerHTML =
        (o.shared ? '<button type="button" class="btn" id="agUnshare">Vom Büro zurückholen</button>' :
          '<button type="button" class="btn primary" id="agShare">' + U.ICONS.print + '<span>Ans Büro schicken</span></button>') +
        '<button type="button" class="btn" id="agPdf">' + U.ICONS.pdf + '<span>Vorschau</span></button>';
      $('#agPdf').onclick = async function () { if (timer) await persist(); U.showAuftragPdf([a]); };
      var sh = $('#agShare');
      if (sh) sh.onclick = async function () {
        if (!String(a.f.angebot_text || '').trim()) { U.toast('Bitte erst eintragen, was gemacht werden soll', true); $('#agText').focus(); return; }
        if (!a.customerId) {
          var ok = await U.confirmBox('Ohne Kunde schicken?', 'Es ist noch kein Kunde angehängt.', 'Trotzdem schicken');
          if (!ok) return;
        }
        a.office = Object.assign({}, a.office || {}, { shared: true, sharedAt: Date.now() });
        await persist();
        U.toast('Ans Büro geschickt');
        drawAct();
      };
      var us = $('#agUnshare');
      if (us) us.onclick = async function () {
        var ok = await U.confirmBox('Vom Büro zurückholen?', 'Das Angebot ist dann im Büro nicht mehr sichtbar.', 'Zurückholen');
        if (!ok) return;
        a.office = Object.assign({}, a.office || {}, { shared: false });
        await persist();
        U.toast('Fürs Büro nicht mehr sichtbar');
        drawAct();
      };
    }
    $('#agDel').onclick = async function () {
      var ok = await U.confirmBox('Angebot löschen?', 'Angebot für ' + custShort(a) + ' wird gelöscht' + ((a.office || {}).shared ? ' (auch im Büro).' : '.'), 'Löschen', true);
      if (!ok) return;
      clearTimeout(timer); timer = null;
      a.deleted = true;
      await S.Angebote.save(a);
      location.hash = '#/angebote';
    };
    drawCust();
    drawConf();
    drawAct();
    if (!a.f.angebot_text && $('#agText')) $('#agText').focus();
  }, 'auftraege');

  /** Angebote eines Kunden (für den Kundenordner) */
  async function forCustomer(customerId) {
    return (await S.Angebote.all()).filter(function (a) { return a.customerId === customerId; })
      .sort(function (a, b) { return b.createdAt - a.createdAt; });
  }
  function listHtml(list) {
    if (!list.length) return '';
    return '<h2>Angebote</h2><div class="list">' + list.map(row).join('') + '</div>';
  }

  window.Angebot = { create: create, createWithPicker: createWithPicker, forCustomer: forCustomer, listHtml: listHtml, stateOf: stateOf };
})();
