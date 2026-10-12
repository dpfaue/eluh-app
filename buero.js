/* ELUH App – einfache Oberfläche fürs Büro: freigegebene Aufträge ansehen, drucken, als abgerechnet markieren */
(function () {
  'use strict';
  var S = window.Store, U = window.UI;
  var $ = U.$, $$ = U.$$, esc = U.esc;
  var state = { tab: 'neu', q: '', sel: new Set() };

  function statusOf(r) {
    var o = r.office || {};
    if (o.billedAt) return 'abgerechnet';
    if (o.printedAt) return 'gedruckt';
    return 'neu';
  }
  var BADGE = { neu: '<span class="badge warn">Neu</span>', gedruckt: '<span class="badge info">Gedruckt</span>', abgerechnet: '<span class="badge ok">Abgerechnet</span>' };

  async function markPrinted(recs) {
    for (var i = 0; i < recs.length; i++) {
      if (recs[i].office && recs[i].office.printedAt) continue;
      try { await S.Office.mark(recs[i].id, 'printed', true); } catch (e) { /* offline – egal */ }
    }
  }

  // ------------------------------------------------------------------
  // Liste
  // ------------------------------------------------------------------
  U.route(/^#\/buero$/, async function () {
    var s = await S.Settings.get();
    U.view.innerHTML =
      '<div class="page-head"><h1>Aufträge</h1><div class="sub">Von Dominic freigegeben – zum Drucken und Abrechnen</div></div>' +
      (s.bueroHintSeen ? '' : '<div class="hint-card" id="hint"><b>So geht’s:</b> Auftrag antippen → „Drucken“. Wenn er abgerechnet ist, „Abgerechnet“ antippen. Mehrere auf einmal: Häkchen setzen und unten „Drucken“. <button class="btn small ghost" id="hintOk" style="color:inherit">Verstanden</button></div>') +
      '<div class="stack" style="margin-top:12px">' +
      '<div class="chips" id="otabs"></div>' +
      '<label class="search">' + U.ICONS.search + '<input class="input" id="oq" type="search" placeholder="Kunde, Nr., Art…" value="' + esc(state.q) + '"></label>' +
      '<div id="olist"></div></div>' +
      '<div class="actionbar selbar" id="osel" hidden></div>';
    var h = $('#hintOk');
    if (h) h.onclick = function () { S.Settings.set({ bueroHintSeen: true }); $('#hint').remove(); };
    var me = U.current();
    var visible = [];
    async function draw() {
      var list = await S.Office.list();
      if (U.current() !== me || !$('#olist')) return;
      var counts = { neu: 0, gedruckt: 0, abgerechnet: 0 };
      list.forEach(function (r) { counts[statusOf(r)]++; });
      $('#otabs').innerHTML = [['neu', 'Neu'], ['gedruckt', 'Gedruckt'], ['abgerechnet', 'Abgerechnet'], ['alle', 'Alle']].map(function (t) {
        return '<button class="chip' + (state.tab === t[0] ? ' on' : '') + '" data-ot="' + t[0] + '">' + t[1] + (counts[t[0]] !== undefined ? ' (' + counts[t[0]] + ')' : '') + '</button>';
      }).join('');
      $$('[data-ot]').forEach(function (b) { b.onclick = function () { state.tab = b.getAttribute('data-ot'); state.sel.clear(); draw(); }; });
      var rows = list.filter(function (r) {
        if (state.tab !== 'alle' && statusOf(r) !== state.tab) return false;
        var f = r.f || {};
        return U.matchQuery([f.kunde_name, f.kunde_adresse, f.auftrags_nr, f.art, r.customerName].join(' '), state.q);
      });
      visible = rows;
      if (!rows.length) {
        $('#olist').innerHTML = '<div class="list"><div class="empty">' + (list.length ? 'Hier ist gerade nichts.' : (navigator.onLine ? 'Noch keine Aufträge freigegeben.' : 'Offline – Aufträge werden geladen, sobald Internet da ist.')) + '</div></div>';
      } else {
        $('#olist').innerHTML = '<div class="list">' + rows.map(function (r) {
          var f = r.f || {};
          var std = window.PdfGen.hasZeiten(r) ? window.PdfGen.sumZeiten(r) + ' Std.' : '';
          var meta = [U.isoToDe(U.auftragDate(r)), f.art, f.auftrags_nr ? 'Nr. ' + f.auftrags_nr : '', std].filter(Boolean).join(' · ');
          return '<div class="row office-row" data-id="' + esc(r.id) + '"><input type="checkbox" aria-label="Auswählen"' + (state.sel.has(r.id) ? ' checked' : '') + '>' +
            '<a class="main" href="#/buero/' + esc(r.id) + '" style="text-decoration:none;color:inherit"><span class="title" style="display:block">' + esc(U.auftragTitle(r)) + '</span>' +
            '<span class="meta" style="display:block">' + esc(meta) + '</span></a>' + BADGE[statusOf(r)] + '</div>';
        }).join('') + '</div>';
        $$('#olist .row').forEach(function (row) {
          var cb = $('input', row);
          cb.onchange = function () { var id = row.getAttribute('data-id'); if (cb.checked) state.sel.add(id); else state.sel.delete(id); drawSel(); };
        });
      }
      drawSel();
    }
    function drawSel() {
      var bar = $('#osel');
      if (!bar) return;
      var n = state.sel.size;
      bar.hidden = !visible.length;
      bar.innerHTML = n ?
        '<span class="small"><b>' + n + '</b> ausgewählt</span><div class="btn-row"><button class="btn ghost small" id="sx">Aufheben</button>' +
        '<button class="btn small" id="sBill">Abgerechnet</button><button class="btn primary" id="sPrint">' + U.ICONS.print + '<span>Drucken</span></button></div>' :
        '<span class="small muted">Häkchen setzen, um mehrere zu drucken</span><button class="btn small" id="sAll">Alle wählen</button>';
      var b;
      if ((b = $('#sAll'))) b.onclick = function () { visible.forEach(function (r) { state.sel.add(r.id); }); draw(); };
      if ((b = $('#sx'))) b.onclick = function () { state.sel.clear(); draw(); };
      if ((b = $('#sPrint'))) b.onclick = async function () {
        var recs = visible.filter(function (r) { return state.sel.has(r.id); });
        U.showAuftragPdf(recs, { onPrint: function () { markPrinted(recs); } });
      };
      if ((b = $('#sBill'))) b.onclick = async function () {
        var ids = Array.from(state.sel);
        try {
          for (var i = 0; i < ids.length; i++) await S.Office.mark(ids[i], 'billed', true);
          U.toast(ids.length + ' als abgerechnet markiert');
          state.sel.clear();
        } catch (e) { U.toast('Nur mit Internet möglich: ' + e.message, true); }
      };
    }
    $('#oq').oninput = U.debounce(function () { state.q = this.value; draw(); }, 150);
    await draw();
    U.rerenderOn(['office', 'sync'], draw);
    S.Sync.schedule(200);
  }, 'buero');

  // ------------------------------------------------------------------
  // Einzelner Auftrag
  // ------------------------------------------------------------------
  U.route(/^#\/buero\/([\w-]+)$/, async function (id) {
    var me = U.current();
    async function draw() {
      var list = await S.Office.list();
      var r = list.filter(function (x) { return x.id === id; })[0];
      if (U.current() !== me) return;
      if (!r) { U.view.innerHTML = '<div class="notice warn">Auftrag nicht (mehr) freigegeben.</div><p><a href="#/buero">Zur Liste</a></p>'; return; }
      var f = r.f || {}, o = r.office || {};
      var st = statusOf(r);
      U.view.innerHTML =
        '<div class="page-head"><a class="btn ghost small" href="#/buero">‹ Liste</a><h1>' + esc(U.auftragTitle(r)) + '</h1>' + BADGE[st] + '</div>' +
        '<div class="big-actions"><button class="btn primary" id="bPrint">' + U.ICONS.print + '<span>Ansehen &amp; drucken</span></button>' +
        '<button class="btn" id="bBill">' + (o.billedAt ? '✓ Abgerechnet' : 'Als abgerechnet markieren') + '</button></div>' +
        '<div class="card pad" style="margin-top:14px"><dl class="kv">' +
        '<dt>Kunde</dt><dd>' + esc([f.kunde_name, f.kunde_name_zusatz].filter(Boolean).join(', ') || '–') + '</dd>' +
        '<dt>Adresse</dt><dd>' + esc(f.kunde_adresse || '–') + '</dd>' +
        '<dt>Art</dt><dd>' + esc(f.art || '–') + '</dd>' +
        '<dt>Auftrags-Nr.</dt><dd>' + esc(f.auftrags_nr || '–') + '</dd>' +
        '<dt>Datum</dt><dd>' + esc(U.isoToDe(U.auftragDate(r))) + '</dd>' +
        '<dt>Arbeitszeit</dt><dd>' + (window.PdfGen.hasZeiten(r) ? esc(window.PdfGen.sumZeiten(r)) + ' Std. (Stundennachweis wird mitgedruckt)' : '–') + '</dd>' +
        '<dt>Material</dt><dd>' + (window.PdfGen.hasMaterial(r) ? ((r.material || []).filter(function (m) { return m && (m.bez || m.artnr); }).length) + ' Positionen (Materialschein wird mitgedruckt)' : 'kein Material') + '</dd>' +
        '<dt>Freigegeben</dt><dd>' + U.fmtDT(o.sharedAt) + '</dd>' +
        '<dt>Gedruckt</dt><dd>' + (o.printedAt ? U.fmtDT(o.printedAt) + (o.printedBy ? ' (' + esc(o.printedBy) + ')' : '') : 'noch nicht') + '</dd>' +
        '<dt>Abgerechnet</dt><dd>' + (o.billedAt ? U.fmtDT(o.billedAt) + (o.billedBy ? ' (' + esc(o.billedBy) + ')' : '') : 'noch nicht') + '</dd>' +
        '</dl></div>' +
        (f.arbeitsumfang ? '<h2>Ausgeführte Arbeiten</h2><div class="card pad small" style="white-space:pre-wrap">' + esc(f.arbeitsumfang) + '</div>' : '') +
        (r.customerId ? '<p><a class="btn ghost" href="#/ordner/' + encodeURIComponent(r.customerId) + '">' + U.ICONS.folder.replace('<svg', '<svg width="18" height="18"') + '<span>Kundenordner öffnen</span></a></p>' : '');
      $('#bPrint').onclick = function () { U.showAuftragPdf([r], { onPrint: function () { markPrinted([r]); } }); };
      $('#bBill').onclick = async function () {
        try {
          await S.Office.mark(r.id, 'billed', !o.billedAt);
          U.toast(o.billedAt ? 'Markierung entfernt' : 'Als abgerechnet markiert');
        } catch (e) { U.toast('Nur mit Internet möglich: ' + e.message, true); }
      };
    }
    await draw();
    U.rerenderOn(['office'], draw);
  }, 'buero');

  // ------------------------------------------------------------------
  // Konto (Büro)
  // ------------------------------------------------------------------
  U.route(/^#\/konto$/, async function () {
    var s = await S.Settings.get();
    U.view.innerHTML =
      '<div class="page-head"><h1>Konto</h1></div>' +
      '<div class="card pad"><dl class="kv"><dt>Zugang</dt><dd>Büro</dd><dt>Gerät</dt><dd>' + esc((s.deviceName || '–') + ' · ' + S.deviceLabel()) + '</dd>' +
      '<dt>Letzter Abgleich</dt><dd>' + U.fmtDT(s.lastSync) + '</dd><dt>App-Version</dt><dd>' + esc(window.ELUH_CONFIG.APP_VERSION) + '</dd></dl></div>' +
      '<h2>Mitteilungen</h2><div class="card pad stack" id="pushBox"></div>' +
      '<h2>App installieren</h2><div class="card pad small stack">' +
      '<div><b>iPhone / iPad:</b> In Safari öffnen → Teilen-Symbol → „Zum Home-Bildschirm“. Danach über das Symbol starten.</div>' +
      '<div><b>PC / Mac:</b> In Chrome oder Edge auf das Installieren-Symbol in der Adressleiste klicken (oder einfach als Lesezeichen speichern).</div></div>' +
      '<div class="btn-row" style="margin-top:16px"><button class="btn" id="kSync">Jetzt aktualisieren</button><a class="btn ghost" href="#/setup">Neu verbinden</a></div>';
    U.renderPushBox($('#pushBox'));
    $('#kSync').onclick = function () { S.Sync.run(); U.toast('Wird aktualisiert…'); };
  }, 'konto');
})();
