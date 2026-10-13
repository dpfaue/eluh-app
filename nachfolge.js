/* ELUH App – Nachfolgeaufträge (nur Dominic): was bei einem Kunden noch zu erledigen ist */
(function () {
  'use strict';
  var S = window.Store, U = window.UI;
  var $ = U.$, $$ = U.$$, esc = U.esc;

  function custShort(n) { return U.parseCustomer(n.customerName || '').name || n.customerName || 'Ohne Kunde'; }
  function fmtDay(ms) { return ms ? U.fmtDate(ms) : ''; }

  async function withDone(list) {
    for (var i = 0; i < list.length; i++) list[i]._done = await S.Nachfolge.isDone(list[i]);
    return list;
  }

  function row(n) {
    return '<a class="row" href="#/nachfolge/' + esc(n.id) + '"><span class="main">' +
      '<span class="title" style="display:block">' + esc(custShort(n)) + ' – ' + esc(n.title || 'ohne Beschreibung') + '</span>' +
      '<span class="meta" style="display:block">' + esc(['seit ' + fmtDay(n.createdAt), n.fromLabel ? 'aus ' + n.fromLabel : '',
        n._done && n.status !== 'erledigt' ? 'per Auftrag erledigt' : n._done ? 'erledigt ' + fmtDay(n.doneAt) : ''].filter(Boolean).join(' · ')) + '</span></span>' +
      (n.auftragId && !n._done ? '<span class="badge grey">Auftrag angelegt</span>' : '') + U.ICONS.chev + '</a>';
  }

  /** Neuen Nachfolgeauftrag anlegen und öffnen */
  async function create(preset) {
    var n = S.Nachfolge.create(preset);
    await S.Nachfolge.save(n);
    location.hash = '#/nachfolge/' + n.id;
  }
  function createWithPicker() {
    U.openCustomerPicker(function (c) { create({ customerId: c.id, customerName: c.name }); });
  }

  // ------------------------------------------------------------------
  // Übersicht
  // ------------------------------------------------------------------
  U.route(/^#\/nachfolge$/, async function () {
    var tab = 'offen';
    U.view.innerHTML = '<div class="page-head"><h1>Nachfolgeaufträge</h1><div class="sub">Was bei Kunden noch zu erledigen ist</div></div>' +
      '<div class="btn-row" style="margin-bottom:12px"><button type="button" class="btn primary" id="nfNew">' + U.ICONS.plus + '<span>Neuer Nachfolgeauftrag</span></button></div>' +
      '<div class="chips" id="nfTabs" style="margin-bottom:10px"></div><div id="nfList"><div class="empty"><span class="spinner"></span></div></div>';
    $('#nfNew').onclick = createWithPicker;
    var me = U.current();
    async function draw() {
      var all = await withDone(await S.Nachfolge.all());
      if (U.current() !== me || !$('#nfList')) return;
      var open = all.filter(function (n) { return !n._done; }).sort(function (a, b) { return b.createdAt - a.createdAt; });
      var done = all.filter(function (n) { return n._done; }).sort(function (a, b) { return (b.doneAt || b.updatedAt) - (a.doneAt || a.updatedAt); });
      $('#nfTabs').innerHTML = '<button type="button" class="chip' + (tab === 'offen' ? ' on' : '') + '" data-t="offen">Offen (' + open.length + ')</button>' +
        '<button type="button" class="chip' + (tab === 'erledigt' ? ' on' : '') + '" data-t="erledigt">Erledigt (' + done.length + ')</button>';
      $$('[data-t]', $('#nfTabs')).forEach(function (b) { b.onclick = function () { tab = b.getAttribute('data-t'); draw(); }; });
      var list = tab === 'offen' ? open : done.slice(0, 100);
      $('#nfList').innerHTML = '<div class="list">' + (list.map(row).join('') ||
        '<div class="empty">' + (tab === 'offen' ? 'Nichts offen ✓' : 'Noch nichts erledigt.') + '</div>') + '</div>';
    }
    await draw();
    U.rerenderOn(['auftraege'], draw);
  }, 'nachfolge');

  // ------------------------------------------------------------------
  // Einzelner Nachfolgeauftrag
  // ------------------------------------------------------------------
  U.route(/^#\/nachfolge\/([\w-]+)$/, async function (id) {
    var n = await S.Auftraege.get(id);
    if (!n || n.deleted || n.kind !== 'nachfolge') { U.view.innerHTML = '<div class="notice warn">Nachfolgeauftrag nicht gefunden.</div><p><a href="#/nachfolge">Zur Übersicht</a></p>'; return; }
    var from = n.fromAuftragId ? await S.Auftraege.get(n.fromAuftragId) : null;
    U.view.innerHTML =
      '<div class="page-head"><a class="btn ghost small" href="#/nachfolge">‹ Nachfolgeaufträge</a><h1>Nachfolgeauftrag</h1><div class="sub" id="nfState"></div></div>' +
      '<section class="form-section card pad stack">' +
      '<div><div class="small muted">Kunde</div><div id="nfCust"></div></div>' +
      (n.fromAuftragId ? '<div class="small muted">Aus Auftrag: ' + (from && !from.deleted ? '<a href="#/auftrag/' + esc(from.id) + '">' + esc(n.fromLabel || 'Auftrag öffnen') + '</a>' : esc(n.fromLabel || '–')) + '</div>' : '') +
      '<label class="field"><span>Was ist noch zu tun?</span><input id="nfTitle" autocomplete="off" placeholder="z. B. Abgasklappe defekt – tauschen"></label>' +
      '<label class="field"><span>Details, Material, Notizen</span><textarea id="nfText" rows="6" placeholder="z. B. Teilenummer, Maße, was mitbringen…"></textarea></label>' +
      '<div class="small muted" id="nfSave"></div></section>' +
      '<div class="btn-row" id="nfAct" style="margin-top:14px"></div>' +
      '<div class="btn-row" style="margin-top:18px"><button type="button" class="btn ghost danger small" id="nfDel">Löschen</button></div>';
    var idx = await S.Index.load();
    function drawCust() {
      var c = n.customerId ? S.Index.item(idx, n.customerId) : null;
      $('#nfCust').innerHTML = (n.customerId ? '<a href="#/ordner/' + encodeURIComponent(n.customerId) + '"><b>' + esc((c && c.name || n.customerName || '').trim()) + '</b></a>' : '<b>Kein Kunde</b>') +
        ' <button type="button" class="btn small ghost" id="nfCustChg">' + (n.customerId ? 'Ändern' : 'Kunde wählen') + '</button>';
      $('#nfCustChg').onclick = function () {
        U.openCustomerPicker(function (c) { n.customerId = c.id; n.customerName = c.name; changed(); drawCust(); });
      };
    }
    $('#nfTitle').value = n.title || '';
    $('#nfText').value = n.text || '';
    var timer = null;
    async function persist() {
      clearTimeout(timer); timer = null;
      var cur = await S.Auftraege.get(n.id);
      if (cur && cur.auftragId && !n.auftragId) n.auftragId = cur.auftragId;
      await S.Nachfolge.save(n);
      var el = $('#nfSave'); if (el) el.textContent = 'Gespeichert ' + U.fmtTime(Date.now());
    }
    function changed() { var el = $('#nfSave'); if (el) el.textContent = 'Speichert…'; clearTimeout(timer); timer = setTimeout(persist, 500); }
    $('#nfTitle').oninput = function () { n.title = this.value; changed(); };
    $('#nfText').oninput = function () { n.text = this.value; changed(); };
    U.onCleanup(function () { if (timer) persist(); });

    async function drawAct() {
      var done = await S.Nachfolge.isDone(n);
      var linked = n.auftragId ? await S.Auftraege.get(n.auftragId) : null;
      if (linked && linked.deleted) linked = null;
      if (!$('#nfAct') || !$('#nfState')) return; // Seite inzwischen verlassen
      $('#nfState').textContent = done ? (n.status === 'erledigt' ? 'Erledigt ' + fmtDay(n.doneAt) : 'Erledigt – Auftrag abgelegt') : 'Offen seit ' + fmtDay(n.createdAt);
      $('#nfAct').innerHTML =
        (linked ? '<a class="btn" href="#/auftrag/' + esc(linked.id) + '">' + U.ICONS.pdf + '<span>Arbeitsauftrag öffnen</span></a>' :
          '<button type="button" class="btn primary" id="nfMake">' + U.ICONS.plus + '<span>Arbeitsauftrag daraus anlegen</span></button>') +
        (n.status === 'erledigt' ? '<button type="button" class="btn" id="nfOpen">Wieder offen</button>' : '<button type="button" class="btn' + (linked ? ' primary' : '') + '" id="nfDone">Erledigt ✓</button>');
      var mk = $('#nfMake');
      if (mk) mk.onclick = async function () {
        if (timer) await persist();
        var rec = S.Auftraege.create();
        if (n.customerId) {
          var c = S.Index.item(idx, n.customerId);
          if (c) U.applyCustomer(rec, c); else { rec.customerId = n.customerId; rec.customerName = n.customerName; rec.f.kunde_name = custShort(n); }
        }
        rec.f.arbeitsumfang = [n.title, n.text].filter(function (x) { return String(x || '').trim(); }).join('\n');
        rec.nachfolgeId = n.id;
        var prof = await S.Profile.get();
        if (prof.monteurSig && prof.autoMonteur !== false) rec.sig = { monteur: { png: prof.monteurSig, at: Date.now(), auto: true } };
        await S.Auftraege.save(rec);
        n.auftragId = rec.id;
        await S.Nachfolge.save(n);
        U.toast('Arbeitsauftrag angelegt – Kunde und Text übernommen');
        location.hash = '#/auftrag/' + rec.id;
      };
      var dn = $('#nfDone');
      if (dn) dn.onclick = async function () { n.status = 'erledigt'; n.doneAt = Date.now(); await persist(); U.toast('Als erledigt markiert'); location.hash = '#/nachfolge'; };
      var op = $('#nfOpen');
      if (op) op.onclick = async function () { n.status = 'offen'; n.doneAt = null; await persist(); drawAct(); };
    }
    $('#nfDel').onclick = async function () {
      var ok = await U.confirmBox('Nachfolgeauftrag löschen?', '„' + (n.title || 'ohne Beschreibung') + '“ bei ' + custShort(n) + ' wird gelöscht.', 'Löschen', true);
      if (!ok) return;
      clearTimeout(timer); timer = null;
      n.deleted = true;
      await S.Nachfolge.save(n);
      location.hash = '#/nachfolge';
    };
    drawCust();
    await drawAct();
    if (!n.title) $('#nfTitle').focus();
  }, 'nachfolge');

  /** Offene Nachfolgeaufträge eines Kunden / eines Auftrags (für Hinweise an anderen Stellen) */
  async function openFor(filter) {
    var all = await withDone(await S.Nachfolge.all());
    return all.filter(function (n) { return !n._done && filter(n); }).sort(function (a, b) { return b.createdAt - a.createdAt; });
  }
  function noticeHtml(list, title) {
    if (!list.length) return '';
    return '<div class="notice warn nf-notice"><b>' + esc(title) + '</b><ul>' + list.map(function (n) {
      return '<li><a href="#/nachfolge/' + esc(n.id) + '">' + esc(n.title || 'ohne Beschreibung') + '</a> <span class="muted small">seit ' + fmtDay(n.createdAt) + '</span></li>';
    }).join('') + '</ul></div>';
  }

  window.Nachfolge = {
    create: create, createWithPicker: createWithPicker, openFor: openFor, noticeHtml: noticeHtml,
    fromAuftrag: function (rec) {
      var label = [(rec.f && rec.f.art) || 'Auftrag', U.isoToDe(U.auftragDate(rec))].filter(Boolean).join(' ');
      return create({ customerId: rec.customerId || null, customerName: rec.customerName || (rec.f && rec.f.kunde_name) || '', fromAuftragId: rec.id, fromLabel: label });
    }
  };
})();
