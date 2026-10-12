/* ELUH App – Stundenzettel (nur Dominic): aktuelle Zettel, Vergangenheit, Ansicht, Drucken/Teilen, Fertig/Ablegen */
(function () {
  'use strict';
  var S = window.Store, U = window.UI;
  var $ = U.$, $$ = U.$$, esc = U.esc;
  var MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  var pdfCache = {};

  function monthLabel(iso) { if (!iso) return 'Ohne Datum'; return MONATE[Number(iso.slice(5, 7)) - 1] + ' ' + iso.slice(0, 4); }
  function num(v) { var n = parseFloat(String(v || '').replace(',', '.')); return isNaN(n) ? 0 : n; }
  function fmtH(n) { return (Math.round(n * 100) / 100).toString().replace('.', ','); }
  function b64Blob(b64, type) {
    var bin = atob(b64), arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: type });
  }

  async function loadList(force) {
    var cached = await S.DB.get('kv', 'szList');
    if (!navigator.onLine) { if (cached) { cached.offline = true; return cached; } throw new Error('Nur mit Internet abrufbar'); }
    if (!force && cached && Date.now() - (cached.at || 0) < 2 * 60 * 1000) { cached.offline = false; return cached; }
    try {
      var j = await S.api('szList', {}, { timeout: 60000 });
      j.at = Date.now();
      await S.DB.put('kv', j, 'szList');
      return j;
    } catch (e) {
      if (cached) { cached.offline = true; return cached; }
      throw e;
    }
  }

  async function getPdf(item) {
    var k = item.id + '_' + (item.modified || 0);
    if (pdfCache[k]) return pdfCache[k];
    var j = await S.api('szPdf', { id: item.id }, { timeout: 60000 });
    pdfCache[k] = { blob: b64Blob(j.data, 'application/pdf'), name: j.name };
    return pdfCache[k];
  }

  async function doPrint(item, btn) {
    if (btn) btn.disabled = true;
    try { var p = await getPdf(item); U.printBlob(p.blob, p.name); }
    catch (e) { U.toast(e.offline ? 'Drucken nur mit Internet' : e.message, true); }
    finally { if (btn) btn.disabled = false; }
  }
  async function doShare(item, btn) {
    if (btn) btn.disabled = true;
    try {
      var p = await getPdf(item);
      var file = new File([p.blob], p.name, { type: 'application/pdf' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: p.name }); } catch (e) { /* abgebrochen */ }
      } else {
        U.downloadBlob(p.blob, p.name);
        U.toast('PDF gespeichert – Teilen kann dieser Browser nicht direkt');
      }
    } catch (e) { U.toast(e.offline ? 'Teilen nur mit Internet' : e.message, true); }
    finally { if (btn) btn.disabled = false; }
  }
  async function doDone(item, after) {
    var ok = await U.confirmBox('Stundenzettel fertig?', '„' + item.name + '“ wird in Drive unter Sheets → ' + (item.start ? item.start.slice(0, 4) + ' → ' + Number(item.start.slice(5, 7)) + '. ' + MONATE[Number(item.start.slice(5, 7)) - 1] : 'Monat') + ' abgelegt. Ansehen, Drucken und Teilen geht danach weiterhin.', 'Fertig – ablegen');
    if (!ok) return;
    try {
      var j = await S.api('szDone', { id: item.id }, { timeout: 60000 });
      U.toast('Abgelegt in ' + j.folder);
      await loadList(true);
      if (after) after();
    } catch (e) { U.toast(e.offline ? 'Ablegen nur mit Internet' : e.message, true); }
  }
  async function doCreate(btn, after) {
    if (btn) btn.disabled = true;
    try {
      var j = await S.api('szCreate', {}, { timeout: 60000 });
      U.toast(j.created ? 'Neuer Stundenzettel: ' + j.item.name : 'Zettel für diese Woche gibt es schon');
      if (j.warning) U.toast('Bitte oben rechts den Monat prüfen – ' + j.warning, true);
      await loadList(true);
      if (after) after(j.item);
    } catch (e) { U.toast(e.offline ? 'Nur mit Internet möglich' : e.message, true); }
    finally { if (btn) btn.disabled = false; }
  }

  function row(it, open) {
    return '<div class="row sz-row">' +
      '<a class="main" href="#/stunden/' + esc(it.id) + '"><span class="title" style="display:block">' + esc(it.name) + '</span>' +
      '<span class="meta" style="display:block">' + esc(open ? monthLabel(it.start) + (it.where === 'sheets' ? ' · noch nicht im Monatsordner' : '') : (it.folder || monthLabel(it.start))) + '</span></a>' +
      (open ? '<button type="button" class="btn small" data-done="' + esc(it.id) + '">Fertig ✓</button>' : '') +
      '<a class="chev" href="#/stunden/' + esc(it.id) + '" aria-label="Öffnen">' + U.ICONS.chev + '</a></div>';
  }

  // ------------------------------------------------------------------
  // Übersicht
  // ------------------------------------------------------------------
  U.route(/^#\/stunden$/, async function () {
    var s = await S.Settings.get();
    if (s.role === 'buero') { U.view.innerHTML = '<div class="empty">Nur für Dominic.</div>'; return; }
    U.view.innerHTML = '<div class="page-head"><h1>Stundenzettel</h1><div class="sub">Arbeitszeitnachweis · Pfaue, Dominic</div></div>' +
      '<div id="szCur"></div><div id="szOpen"><div class="empty"><span class="spinner"></span> Wird geladen…</div></div><div id="szHist"></div>';
    var me = U.current(), year = null;

    async function draw(force) {
      var j;
      try { j = await loadList(force); }
      catch (e) { if (U.current() === me) $('#szOpen').innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; return; }
      if (U.current() !== me || !$('#szOpen')) return;
      var c = j.current || {};
      $('#szCur').innerHTML = (j.offline ? '<div class="notice warn small">Offline – zuletzt geladener Stand.</div>' : '') +
        (c.id ? '<div class="card pad sz-current"><div class="small muted">Diese Woche</div><div class="sz-cur-name">' + esc(c.name) + '</div>' +
          '<div class="btn-row"><a class="btn primary" href="#/stunden/' + esc(c.id) + '">Öffnen</a></div></div>' :
          '<div class="card pad sz-current"><div class="small muted">Diese Woche</div><div class="sz-cur-name">' + esc(c.name || '') + '</div>' +
          '<div class="small">Noch kein Zettel – wird jeden Montag (und am Monatsersten) automatisch aus dem Blanko angelegt.</div>' +
          '<div class="btn-row"><button type="button" class="btn primary" id="szMake">' + U.ICONS.plus + '<span>Jetzt anlegen</span></button></div></div>');
      var mk = $('#szMake');
      if (mk) mk.onclick = function () { doCreate(mk, function (it) { if (it) location.hash = '#/stunden/' + it.id; else draw(); }); };

      $('#szOpen').innerHTML = '<h2>Offen' + (j.open.length ? ' <span class="badge warn">' + j.open.length + '</span>' : '') + '</h2>' +
        '<div class="list">' + (j.open.map(function (it) { return row(it, true); }).join('') || '<div class="empty">Alles abgelegt ✓</div>') + '</div>';
      $$('[data-done]', $('#szOpen')).forEach(function (b) {
        b.onclick = function () { var it = j.open.filter(function (x) { return x.id === b.getAttribute('data-done'); })[0]; doDone(it, function () { draw(); }); };
      });

      // Vergangenheit: Jahr wählen, darunter Monate
      var years = {};
      j.filed.forEach(function (it) { var y = (it.start || (it.folder || '').slice(0, 4) || '?').slice(0, 4); (years[y] = years[y] || []).push(it); });
      var ys = Object.keys(years).sort().reverse();
      if (!year || !years[year]) year = ys[0];
      var months = {};
      (years[year] || []).forEach(function (it) { var m = it.start ? it.start.slice(0, 7) : 'x'; (months[m] = months[m] || []).push(it); });
      var ms = Object.keys(months).sort().reverse();
      $('#szHist').innerHTML = '<h2>Vergangenheit</h2>' +
        (ys.length ? '<div class="chips" id="szYears">' + ys.map(function (y) { return '<button type="button" class="chip' + (y === year ? ' on' : '') + '" data-y="' + esc(y) + '">' + esc(y) + ' <small>(' + years[y].length + ')</small></button>'; }).join('') + '</div>' +
          ms.map(function (m, i) {
            return '<details class="sz-month"' + (i === 0 ? ' open' : '') + '><summary>' + esc(m === 'x' ? 'Ohne Datum' : monthLabel(m + '-01')) + ' <span class="muted small">· ' + months[m].length + ' Zettel</span></summary>' +
              '<div class="list">' + months[m].map(function (it) { return row(it, false); }).join('') + '</div></details>';
          }).join('') : '<div class="empty">Noch nichts abgelegt.</div>') +
        '<div class="btn-row" style="margin-top:12px"><button type="button" class="btn small ghost" id="szReload">Aktualisieren</button></div>';
      $$('[data-y]', $('#szHist')).forEach(function (b) { b.onclick = function () { year = b.getAttribute('data-y'); draw(); }; });
      $('#szReload').onclick = function () { draw(true); };
    }
    await draw();
    if (navigator.onLine) draw(true);
  }, 'stunden');

  // ------------------------------------------------------------------
  // Einzelner Zettel
  // ------------------------------------------------------------------
  function tableHtml(v) {
    var rows = v.rows || [];
    var get = function (r, c) { return ((rows[r] || [])[c] || '').trim(); };
    var endIdx = rows.length;
    for (var i = 5; i < rows.length; i++) if (/^Unterschrift/.test(get(i, 0))) { endIdx = i; break; }
    var data = [];
    for (var k = 5; k < endIdx; k++) if ((rows[k] || []).some(function (x) { return String(x || '').trim(); })) data.push(rows[k]);
    var total = 0, ue = 0, day = '', dayTotal = 0, out = '', mob = '';
    var flush = function () {
      if (!day) return;
      out += '<tr class="sz-daysum"><td colspan="6">Summe ' + esc(day) + '</td><td>' + fmtH(dayTotal) + '</td><td></td></tr>';
      mob += '<div class="sz-l-sum"><span>Summe ' + esc(day) + '</span><b>' + fmtH(dayTotal) + ' Std.</b></div>';
    };
    data.forEach(function (r) {
      var c = function (i) { return String(r[i] || '').trim(); };
      var d = c(0);
      if (d && d !== day) { flush(); day = d; dayTotal = 0; }
      var h = num(r[6]);
      total += h; dayTotal += h; ue += num(r[7]);
      out += '<tr>' + [0, 1, 2, 3, 4, 5, 6, 7].map(function (i) { return '<td' + (i === 2 ? ' class="sz-obj"' : '') + '>' + esc(c(i)) + '</td>'; }).join('') + '</tr>';
      var meta = [c(1) && c(1) !== '-' ? 'Nr. ' + c(1) : '', c(3) || c(4) ? c(3) + '–' + c(4) : '', c(5) && c(5) !== '-' ? 'Pause ' + c(5).replace('.', ',') : '', c(7) ? 'Ü ' + c(7).replace('.', ',') : ''].filter(Boolean).join(' · ');
      mob += '<div class="sz-l-row"><span class="d">' + esc(d) + '</span><span class="m"><b>' + esc(c(2) || '–') + '</b><span class="small muted">' + esc(meta) + '</span></span><span class="h">' + esc(c(6).replace('.', ',')) + '</span></div>';
    });
    flush();
    var want = v.start ? Number(v.start.slice(5, 7)) + '/' + v.start.slice(0, 4) : '';
    var have = get(1, 7).replace(/^0/, '');
    var warn = want && have && have !== want ? '<div class="notice warn small" id="szMonthWarn">Oben rechts steht <b>Monat ' + esc(get(1, 7)) + '</b> – richtig wäre <b>' + esc(want) + '</b>. Bitte über „Bearbeiten“ anpassen.</div>' : '';
    return warn + '<div class="sz-sheet">' +
      '<div class="sz-head"><div class="sz-firm">' + esc(get(0, 0)) + '<br>' + esc(get(1, 0)) + '<br>' + esc(get(2, 0)) + '</div>' +
      '<div class="sz-title"><b>' + esc(get(0, 2) || 'Arbeitszeitnachweis') + '</b><br>' + esc(get(2, 2)) + '</div>' +
      '<div class="sz-meta">' + esc(get(1, 6)) + ' <b>' + esc(get(1, 7)) + '</b><br>' + esc(get(2, 6)) + ' ' + esc(get(2, 7)) + '</div></div>' +
      '<div class="sz-scroll"><table class="sz-table"><thead><tr><th>Datum</th><th>Auftrags-Nr.</th><th>Baustelle/Objekt und Ort</th><th>Beginn</th><th>Ende</th><th>Pause</th><th>Std.</th><th>Ü-Std.</th></tr></thead>' +
      '<tbody>' + (out || '<tr><td colspan="8" class="muted" style="text-align:center;padding:18px">Noch keine Einträge</td></tr>') + '</tbody>' +
      '<tfoot><tr><td colspan="6">Gesamt</td><td>' + fmtH(total) + '</td><td>' + (ue ? fmtH(ue) : '') + '</td></tr></tfoot></table></div>' +
      '<div class="sz-list">' + (mob || '<div class="muted" style="text-align:center;padding:18px">Noch keine Einträge</div>') +
      '<div class="sz-l-total"><span>Gesamt</span><b>' + fmtH(total) + ' Std.' + (ue ? ' · Ü ' + fmtH(ue) : '') + '</b></div></div></div>';
  }

  U.route(/^#\/stunden\/([\w-]+)$/, async function (id) {
    var s = await S.Settings.get();
    if (s.role === 'buero') { U.view.innerHTML = '<div class="empty">Nur für Dominic.</div>'; return; }
    U.view.innerHTML = '<div class="page-head"><a class="btn ghost small" href="#/stunden">‹ Stundenzettel</a><h1 id="szName">Stundenzettel</h1><div class="sub" id="szSub"></div></div>' +
      '<div class="btn-row sz-actions" id="szAct"></div><div id="szBody"><div class="empty"><span class="spinner"></span> Wird geladen…</div></div>';
    var me = U.current();
    var list = (await S.DB.get('kv', 'szList')) || { open: [], filed: [] };
    var item = list.open.concat(list.filed).filter(function (x) { return x.id === id; })[0] || { id: id, name: 'Stundenzettel' };
    var isOpen = list.open.some(function (x) { return x.id === id; });

    function actions(v) {
      $('#szAct').innerHTML =
        '<a class="btn" target="_blank" rel="noopener" href="' + esc((v && v.editUrl) || 'https://docs.google.com/spreadsheets/d/' + id + '/edit') + '">' + U.ICONS.pen + '<span>Bearbeiten</span></a>' +
        '<button type="button" class="btn" id="szPrint">' + U.ICONS.print + '<span>Drucken</span></button>' +
        '<button type="button" class="btn" id="szShare">' + U.ICONS.upload + '<span>Teilen</span></button>' +
        (isOpen ? '<button type="button" class="btn primary" id="szDone">Fertig – ablegen</button>' : '<button type="button" class="btn ghost small" id="szReopen">Wieder öffnen</button>');
      var it = Object.assign({}, item, v ? { name: v.name, modified: v.modified } : {});
      $('#szPrint').onclick = function () { doPrint(it, this); };
      $('#szShare').onclick = function () { doShare(it, this); };
      if ($('#szDone')) $('#szDone').onclick = function () { doDone(it, function () { location.hash = '#/stunden'; }); };
      if ($('#szReopen')) $('#szReopen').onclick = async function () {
        try { await S.api('szReopen', { id: id }); U.toast('Wieder bei den offenen Zetteln'); await loadList(true); isOpen = true; actions(v); }
        catch (e) { U.toast(e.message, true); }
      };
    }
    function show(v, note) {
      if (U.current() !== me) return;
      $('#szName').textContent = v.name;
      $('#szSub').textContent = (isOpen ? 'Offen' : 'Abgelegt' + (item.folder ? ' · ' + item.folder : '')) + (note ? ' · ' + note : '');
      $('#szBody').innerHTML = tableHtml(v);
      actions(v);
    }
    var cached = await S.DB.get('kv', 'szv_' + id);
    if (cached) show(cached, navigator.onLine ? 'aktualisiere…' : 'offline gespeichert');
    else { $('#szName').textContent = item.name; actions(null); }
    if (!navigator.onLine) { if (!cached) $('#szBody').innerHTML = '<div class="empty">Offline – dieser Zettel wurde noch nicht geladen.</div>'; return; }
    try {
      var v = await S.api('szView', { id: id }, { timeout: 60000 });
      await S.DB.put('kv', v, 'szv_' + id);
      show(v, 'Stand ' + U.fmtDT(v.modified));
    } catch (e) {
      if (!cached && U.current() === me) $('#szBody').innerHTML = '<div class="empty">' + esc(e.message) + '</div>';
    }
  }, 'stunden');

  // ------------------------------------------------------------------
  // Karte auf der Heute-Seite
  // ------------------------------------------------------------------
  async function heuteCard(el) {
    if (!el) return;
    var cached = await S.DB.get('kv', 'szList');
    function paint(j) {
      if (!j || !document.body.contains(el)) return;
      var c = j.current || {};
      var open = (j.open || []).filter(function (x) { return x.id !== c.id; }).length;
      el.innerHTML = '<a class="card pad sz-heute" href="' + (c.id ? '#/stunden/' + esc(c.id) : '#/stunden') + '">' +
        '<span><span class="small muted" style="display:block">Stundenzettel</span><b>' + esc(c.name || '') + '</b>' +
        (c.id ? '' : ' <span class="badge warn">noch nicht angelegt</span>') +
        (open ? '<span class="small muted" style="display:block">' + open + ' weitere' + (open > 1 ? '' : 'r') + ' noch nicht abgelegt</span>' : '') + '</span>' + U.ICONS.chev + '</a>';
    }
    paint(cached);
    if (navigator.onLine && (!cached || Date.now() - (cached.at || 0) > 10 * 60 * 1000)) {
      try { paint(await loadList(true)); } catch (e) { /* egal */ }
    }
  }

  window.Stunden = { heuteCard: heuteCard, tableHtml: tableHtml };
})();
