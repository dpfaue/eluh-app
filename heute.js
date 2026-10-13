/* ELUH App – Startseite „Heute“: heutige Termine + was noch offen ist (für Dominic und Büro) */
(function () {
  'use strict';
  var S = window.Store, U = window.UI;
  var $ = U.$, esc = U.esc;
  var WD = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  var MO = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

  function startMs(t) { return t.date ? new Date(t.date + 'T' + (t.allDay || !t.time ? '00:00' : t.time) + ':00').getTime() : 0; }
  function terminRow(t, today) {
    var past = today && !t.allDay && t.time && startMs(t) < Date.now() - 30 * 60e3;
    return '<a class="row" href="#/termine/' + esc(t.id) + '"' + (past ? ' style="opacity:.55"' : '') + '>' +
      '<span class="t-time">' + (t.allDay || !t.time ? 'ganzt.' : esc(t.time) + (t.end ? '<small>–' + esc(t.end) + '</small>' : '')) + '</span>' +
      '<span class="main"><span class="title" style="display:block">' + esc(t.title || 'Termin') + '</span>' +
      '<span class="meta" style="display:block">' + esc([t.customerName || t.address, t.person ? 'für ' + t.person : ''].filter(Boolean).join(' · ') || ' ') + '</span></span>' +
      U.ICONS.chev + '</a>';
  }

  U.route(/^#\/heute$/, async function () {
    var s = await S.Settings.get();
    var isBuero = s.role === 'buero';
    var now = new Date();
    U.view.innerHTML =
      '<div class="page-head"><h1>Heute</h1><div class="sub">' + WD[now.getDay()] + ', ' + now.getDate() + '. ' + MO[now.getMonth()] + '</div></div>' +
      '<div class="today-actions">' +
      (isBuero ? '<a class="btn" href="#/buero">' + U.ICONS.print + '<span>Aufträge</span></a>' :
        '<a class="btn primary" href="#/auftrag/neu">' + U.ICONS.plus + '<span>Neuer Auftrag</span></a>') +
      '<a class="btn" href="#/termine/neu">' + U.ICONS.plus + '<span>Neuer Termin</span></a></div>' +
      (isBuero ? '' : '<div id="hS"></div>') + '<div id="hT"></div><div id="hA"></div>';
    var me = U.current();

    async function draw() {
      if (U.current() !== me || !$('#hT')) return;
      var todayIso = S.isoDate(new Date()), tomorrowIso = S.isoDate(new Date(Date.now() + 864e5));
      var all = (await S.Termine.all()).sort(function (a, b) { return startMs(a) - startMs(b); });
      var heute = all.filter(function (t) { return t.date === todayIso; });
      var morgen = all.filter(function (t) { return t.date === tomorrowIso; });
      if (U.current() !== me || !$('#hT')) return; // Seite inzwischen gewechselt
      $('#hT').innerHTML =
        '<h2>Termine heute' + (heute.length ? ' <span class="badge red">' + heute.length + '</span>' : '') + '</h2>' +
        '<div class="list">' + (heute.map(function (t) { return terminRow(t, true); }).join('') || '<div class="empty">Heute keine Termine.</div>') + '</div>' +
        (morgen.length ? '<h3 class="day-head">Morgen · ' + morgen.length + ' Termin' + (morgen.length > 1 ? 'e' : '') + '</h3><div class="list">' + morgen.map(function (t) { return terminRow(t, false); }).join('') + '</div>' : '');
      if (isBuero) await drawBuero(); else await drawChef();
    }

    async function drawChef() {
      var list = await S.Auftraege.all();
      var ops = await S.Outbox.all();
      if (U.current() !== me || !$('#hA')) return;
      var offen = [], imBuero = 0, gedruckt = 0;
      for (var i = 0; i < list.length; i++) {
        var r = list[i];
        var st = await U.auftragStatus(r, ops);
        if (st.key === 'entwurf' || st.key === 'offen') offen.push({ r: r, st: st });
        var os = U.officeStatus(r);
        if (os && os.key === 'shared') imBuero++;
        if (os && os.key === 'printed') gedruckt++;
      }
      offen.sort(function (a, b) { return U.auftragDate(b.r).localeCompare(U.auftragDate(a.r)) || b.r.updatedAt - a.r.updatedAt; });
      if (U.current() !== me || !$('#hA')) return; // Seite inzwischen gewechselt
      $('#hA').innerHTML =
        '<h2>Offene Aufträge' + (offen.length ? ' <span class="badge warn">' + offen.length + '</span>' : '') + '</h2>' +
        '<div class="list">' + (offen.slice(0, 12).map(function (x) {
          var f = x.r.f || {};
          return '<a class="row" href="#/auftrag/' + esc(x.r.id) + '"><span class="main"><span class="title" style="display:block">' + esc(U.auftragTitle(x.r)) + '</span>' +
            '<span class="meta" style="display:block">' + esc([U.isoToDe(U.auftragDate(x.r)), f.art].filter(Boolean).join(' · ')) + '</span></span>' +
            '<span class="badge ' + x.st.cls + '">' + x.st.text + '</span>' + U.ICONS.chev + '</a>';
        }).join('') || '<div class="empty">Alles erledigt ✓</div>') + '</div>' +
        (offen.length > 12 ? '<div class="small muted" style="margin-top:6px"><a href="#/auftraege">Alle ' + offen.length + ' anzeigen</a></div>' : '') +
        (imBuero || gedruckt ? '<div class="card pad small" style="margin-top:14px"><b>Büro:</b> ' +
          [imBuero ? imBuero + ' noch nicht gedruckt' : '', gedruckt ? gedruckt + ' gedruckt, noch nicht abgerechnet' : ''].filter(Boolean).join(' · ') + '</div>' : '');
    }

    async function drawBuero() {
      var list = await S.Office.list();
      if (U.current() !== me || !$('#hA')) return;
      var neu = list.filter(function (r) { var o = r.office || {}; return !o.printedAt && !o.billedAt; });
      var offen = list.filter(function (r) { var o = r.office || {}; return o.printedAt && !o.billedAt; });
      neu.sort(function (a, b) { return ((b.office || {}).sharedAt || 0) - ((a.office || {}).sharedAt || 0); });
      $('#hA').innerHTML =
        '<h2>Neu zum Drucken' + (neu.length ? ' <span class="badge warn">' + neu.length + '</span>' : '') + '</h2>' +
        '<div class="list">' + (neu.slice(0, 10).map(function (r) {
          var f = r.f || {};
          return '<a class="row" href="#/buero/' + esc(r.id) + '"><span class="main"><span class="title" style="display:block">' + esc(U.auftragTitle(r)) + '</span>' +
            '<span class="meta" style="display:block">' + esc([U.isoToDe(U.auftragDate(r)), f.art, f.auftrags_nr ? 'Nr. ' + f.auftrags_nr : ''].filter(Boolean).join(' · ')) + '</span></span>' +
            U.ICONS.chev + '</a>';
        }).join('') || '<div class="empty">Nichts Neues ✓</div>') + '</div>' +
        (offen.length ? '<div class="card pad small" style="margin-top:14px">' + offen.length + ' gedruckt, noch nicht abgerechnet · <a href="#/buero">ansehen</a></div>' : '');
    }

    if (!isBuero && window.Stunden) window.Stunden.heuteCard($('#hS'));
    await draw();
    U.rerenderOn(['termine', 'auftraege', 'outbox', 'office'], draw);
    // um Mitternacht / beim Zurückkommen aktualisieren
    var tick = setInterval(function () { if (!document.hidden) draw(); }, 5 * 60 * 1000);
    U.onCleanup(function () { clearInterval(tick); });
  }, 'heute');
})();
