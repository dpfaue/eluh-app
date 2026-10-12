/* ELUH App – Termine (für Dominic und Büro) mit Erinnerungen und Kalender-Abo */
(function () {
  'use strict';
  var S = window.Store, U = window.UI;
  var $ = U.$, $$ = U.$$, esc = U.esc;
  var REMIND = [[0, 'Zur Startzeit'], [15, '15 Min. vorher'], [60, '1 Std. vorher'], [1440, '1 Tag vorher']];
  var WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  var state = { scope: 'kommend', q: '' };

  function startMs(t) {
    if (!t.date) return 0;
    var d = new Date(t.date + 'T' + (t.allDay || !t.time ? '00:00' : t.time) + ':00');
    return d.getTime();
  }
  function dayLabel(iso) {
    var today = S.isoDate(new Date());
    var tomorrow = S.isoDate(new Date(Date.now() + 864e5));
    var d = new Date(iso + 'T12:00:00');
    var base = WD[d.getDay()] + ', ' + U.isoToDe(iso);
    if (iso === today) return 'Heute · ' + base;
    if (iso === tomorrow) return 'Morgen · ' + base;
    return base;
  }
  function remindText(t) {
    var r = t.remind || [];
    if (!r.length) return 'keine Erinnerung';
    return r.map(function (m) { var x = REMIND.filter(function (e) { return e[0] === m; })[0]; return x ? x[1] : m + ' Min.'; }).join(', ');
  }

  // ------------------------------------------------------------------
  // Liste
  // ------------------------------------------------------------------
  U.route(/^#\/termine$/, async function () {
    var s = await S.Settings.get();
    U.view.innerHTML =
      '<div class="page-head"><h1>Termine</h1><a class="btn primary" href="#/termine/neu">' + U.ICONS.plus + '<span>Neuer Termin</span></a></div>' +
      '<div class="stack">' +
      '<label class="search">' + U.ICONS.search + '<input class="input" id="tq" type="search" placeholder="Titel, Kunde, Person…" value="' + esc(state.q) + '"></label>' +
      '<div class="chips"><button class="chip" data-sc="kommend">Kommend</button><button class="chip" data-sc="vergangen">Vergangen</button></div>' +
      '<div id="tlist"></div>' +
      '<details class="card pad" id="calBox"><summary><b>In Apple-Kalender / Google-Kalender anzeigen</b> <span class="small muted">(mit Erinnerungen)</span></summary><div class="stack" style="margin-top:10px" id="calInner"></div></details>' +
      '</div>';
    var me = U.current();
    async function draw() {
      var list = await S.Termine.all();
      if (U.current() !== me || !$('#tlist')) return;
      $$('[data-sc]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-sc') === state.scope); });
      var now = Date.now();
      var todayIso = S.isoDate(new Date());
      list = list.filter(function (t) {
        if (!U.matchQuery([t.title, t.customerName, t.address, t.person, t.note].join(' '), state.q)) return false;
        return state.scope === 'kommend' ? t.date >= todayIso : t.date < todayIso;
      });
      list.sort(function (a, b) { return state.scope === 'kommend' ? startMs(a) - startMs(b) : startMs(b) - startMs(a); });
      if (!list.length) {
        $('#tlist').innerHTML = '<div class="list"><div class="empty">' + (state.scope === 'kommend' ? 'Keine anstehenden Termine.' : 'Keine vergangenen Termine.') + '</div></div>';
        return;
      }
      var html = '', lastDay = null;
      list.forEach(function (t) {
        if (t.date !== lastDay) {
          if (lastDay !== null) html += '</div>';
          html += '<h3 class="day-head' + (t.date === todayIso ? ' today' : '') + '">' + esc(dayLabel(t.date)) + '</h3><div class="list">';
          lastDay = t.date;
        }
        var past = !t.allDay && startMs(t) < now && t.date === todayIso;
        html += '<a class="row" href="#/termine/' + esc(t.id) + '"' + (past ? ' style="opacity:.6"' : '') + '>' +
          '<span class="t-time">' + (t.allDay || !t.time ? 'ganzt.' : esc(t.time) + (t.end ? '<small>–' + esc(t.end) + '</small>' : '')) + '</span>' +
          '<span class="main"><span class="title" style="display:block">' + esc(t.title || 'Termin') + '</span>' +
          '<span class="meta" style="display:block">' + esc([t.customerName || t.address, t.person ? 'für ' + t.person : ''].filter(Boolean).join(' · ') || remindText(t)) + '</span></span>' +
          (t._dirty ? '<span class="badge warn">wartet</span>' : '') + U.ICONS.chev + '</a>';
      });
      html += '</div>';
      $('#tlist').innerHTML = html;
    }
    $('#tq').oninput = U.debounce(function () { state.q = this.value; draw(); }, 150);
    $$('[data-sc]').forEach(function (b) { b.onclick = function () { state.scope = b.getAttribute('data-sc'); draw(); }; });
    $('#calBox').addEventListener('toggle', function () { if (this.open) drawCal(); });
    async function drawCal() {
      var box = $('#calInner');
      var st = await S.Settings.get();
      if (!st.icsToken) {
        try { await S.refreshPing(); st = await S.Settings.get(); } catch (e) { /* offline */ }
      }
      if (!st.icsToken) { box.innerHTML = '<div class="small muted">Nur online verfügbar.</div>'; return; }
      var https = window.ELUH_CONFIG.BACKEND_URL + '?ics=' + st.icsToken;
      var webcal = https.replace(/^https:/, 'webcal:');
      box.innerHTML =
        '<div class="small">Alle Termine erscheinen dann zusätzlich im normalen Kalender von iPhone, iPad und Mac – inklusive Erinnerungen. Änderungen kommen automatisch (je nach Gerät alle 15–60 Min.).</div>' +
        '<div class="btn-row"><a class="btn primary" href="' + esc(webcal) + '">Kalender abonnieren</a><button type="button" class="btn" id="calCopy">Link kopieren</button></div>' +
        '<div class="small"><b>iPhone/iPad:</b> „Kalender abonnieren“ tippen → „Abonnieren“. Damit die Erinnerungen klingeln: Einstellungen → Kalender → Accounts → Abonnierte Kalender → ELUH Termine → „Hinweise entfernen“ ausschalten.<br>' +
        '<b>Mac:</b> Kalender-App → Ablage → „Neues Kalenderabonnement…“ → Link einfügen.<br>' +
        '<b>Apple Erinnerungen:</b> Eine direkte Verbindung gibt es von Apple nicht – das Kalender-Abo plus die Mitteilungen der App ersetzen das.</div>';
      $('#calCopy').onclick = async function () {
        try { await navigator.clipboard.writeText(webcal); U.toast('Link kopiert'); } catch (e) { U.toast(webcal); }
      };
    }
    await draw();
    U.rerenderOn(['termine', 'sync'], draw);
    S.Sync.schedule(300);
  }, 'termine');

  // ------------------------------------------------------------------
  // Termin anlegen / bearbeiten
  // ------------------------------------------------------------------
  U.route(/^#\/termine\/neu(?:\?kunde=([^&]+))?$/, async function (custId) {
    var t = await S.Termine.create();
    if (custId) {
      var idx = await S.Index.load();
      var c = S.Index.item(idx, custId);
      if (c) applyCustomer(t, c);
    }
    editor(t, true);
  }, 'termine');

  U.route(/^#\/termine\/([\w-]+)$/, async function (id) {
    var t = await S.Termine.get(id);
    if (!t || t.deleted) { U.view.innerHTML = '<div class="notice warn">Termin nicht gefunden.</div><p><a href="#/termine">Zu den Terminen</a></p>'; return; }
    editor(t, false);
  }, 'termine');

  function applyCustomer(t, c) {
    var p = U.parseCustomer(c.name);
    t.customerId = c.id;
    t.customerName = c.name;
    t.address = p.address;
    if (!t.title) t.title = p.name;
    else if (QUICK.indexOf(String(t.title).trim()) >= 0 && p.name) t.title = String(t.title).trim() + ' – ' + p.name;
  }

  // Schnellwahl für die Art des Termins
  var QUICK = ['Wartung', 'Störung', 'Reparatur'];
  function quickOf(title) {
    var s = String(title || '').trim();
    for (var i = 0; i < QUICK.length; i++) if (s === QUICK[i] || s.indexOf(QUICK[i] + ' ') === 0) return QUICK[i];
    return '';
  }
  function setQuick(title, q) {
    var s = String(title || '').trim(), cur = quickOf(s);
    var rest = cur ? s.slice(cur.length).replace(/^\s*[–-]?\s*/, '') : s;
    if (cur === q) return rest;              // gleiche Taste nochmal = abwählen
    return q + (rest ? ' – ' + rest : '');
  }

  async function editor(t, isNew) {
    var s = await S.Settings.get();
    var isBuero = s.role === 'buero';
    var people = {};
    (await S.Termine.all()).forEach(function (x) { if (x.person) people[x.person] = 1; if (x.createdBy) people[x.createdBy] = 1; });
    if (s.deviceName) people[s.deviceName] = 1;
    function field(key, label, type, ph) {
      return '<label class="field"><span>' + label + '</span><input data-t="' + key + '" type="' + (type || 'text') + '" value="' + esc(t[key] || '') + '"' + (ph ? ' placeholder="' + esc(ph) + '"' : '') + ' autocomplete="off"' + (key === 'person' ? ' list="people"' : '') + '></label>';
    }
    U.view.innerHTML =
      '<div class="page-head"><a class="btn ghost small" href="#/termine">‹ Termine</a><h1>' + (isNew ? 'Neuer Termin' : esc(t.title || 'Termin')) + '</h1></div>' +
      '<div class="card"><section class="form-section stack">' +
      field('title', 'Was? (z. B. Wartung Gastherme)') +
      '<div class="chips" id="quickChips" style="margin-top:-4px">' + QUICK.map(function (q) {
        return '<button type="button" class="chip' + (quickOf(t.title) === q ? ' on' : '') + '" data-quick="' + q + '">' + q + '</button>';
      }).join('') + '</div>' +
      '<div id="tcust"></div>' +
      field('address', 'Adresse / Ort') +
      '<div class="grid2">' + field('date', 'Datum', 'date') +
      '<label class="check" style="align-self:end;padding-bottom:10px"><input type="checkbox" id="allDay"' + (t.allDay ? ' checked' : '') + '> Ganztägig</label></div>' +
      '<div class="grid2" id="timeRow">' + field('time', 'Von', 'time') + field('end', 'Bis', 'time') + '</div>' +
      field('person', 'Für wen? (Monteur)', 'text', 'z. B. Dominic') +
      '<datalist id="people">' + Object.keys(people).map(function (n) { return '<option value="' + esc(n) + '">'; }).join('') + '</datalist>' +
      '<label class="field"><span>Notiz</span><textarea data-t="note" rows="3" style="min-height:90px">' + esc(t.note || '') + '</textarea></label>' +
      '<div class="field"><span>Erinnerung</span><div class="chips" id="remChips">' + REMIND.map(function (r) {
        return '<button type="button" class="chip' + ((t.remind || []).indexOf(r[0]) >= 0 ? ' on' : '') + '" data-rem="' + r[0] + '">' + r[1] + '</button>';
      }).join('') + '</div></div>' +
      (!isNew ? '<div class="small muted">Eingetragen von ' + esc(t.createdBy || '–') + (t.updatedAt ? ' · zuletzt geändert ' + U.fmtDT(t.updatedAt) : '') + '</div>' : '') +
      '</section></div>' +
      '<div class="btn-row" style="justify-content:center;margin-top:14px">' +
      (!isNew && !isBuero && t.customerId ? '<button class="btn ghost small" id="toAuftrag">Arbeitsauftrag dazu anlegen</button>' : '') +
      (!isNew ? '<button class="btn ghost danger small" id="tdel">Termin löschen</button>' : '') + '</div>' +
      '<div class="actionbar"><a class="btn" href="#/termine">Abbrechen</a><button class="btn primary" id="tsave">Speichern</button></div>';

    function drawCust() {
      var box = $('#tcust');
      if (t.customerId) {
        box.innerHTML = '<div class="customer-chip">' + U.ICONS.folder.replace('<svg', '<svg width="20" height="20"') + '<span class="name">' + esc(t.customerName) + '</span>' +
          '<a class="btn small ghost" href="#/ordner/' + encodeURIComponent(t.customerId) + '">Ordner</a>' +
          '<button type="button" class="btn small ghost" id="tcRm" aria-label="Kunde entfernen">' + U.ICONS.close + '</button></div>';
        $('#tcRm').onclick = function () { t.customerId = null; t.customerName = ''; drawCust(); };
      } else {
        box.innerHTML = '<button type="button" class="btn" id="tcPick" style="width:100%">' + U.ICONS.folder.replace('<svg', '<svg width="18" height="18"') + '<span>Kunde aus Kundendatenbank (optional)</span></button>';
        $('#tcPick').onclick = function () {
          U.openCustomerPicker(function (c) {
            applyCustomer(t, c);
            $$('[data-t]').forEach(function (el) { el.value = t[el.getAttribute('data-t')] || ''; });
            drawQuick();
            drawCust();
          });
          if (isBuero) setTimeout(function () { var d = $('#newCust'); if (d) d.remove(); }, 20);
        };
      }
    }
    function syncTime() { $('#timeRow').style.display = $('#allDay').checked ? 'none' : ''; }
    function drawQuick() { var q = quickOf(t.title); $$('[data-quick]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-quick') === q); }); }
    $$('[data-t]').forEach(function (el) { el.oninput = function () { t[el.getAttribute('data-t')] = el.value; if (el.getAttribute('data-t') === 'title') drawQuick(); }; });
    $$('[data-quick]').forEach(function (b) {
      b.onclick = function () {
        t.title = setQuick(t.title, b.getAttribute('data-quick'));
        var inp = $('[data-t="title"]'); if (inp) inp.value = t.title;
        drawQuick();
      };
    });
    $('#allDay').onchange = function () { t.allDay = this.checked; syncTime(); };
    $$('[data-rem]').forEach(function (b) {
      b.onclick = function () {
        var m = Number(b.getAttribute('data-rem'));
        t.remind = t.remind || [];
        var i = t.remind.indexOf(m);
        if (i >= 0) t.remind.splice(i, 1); else t.remind.push(m);
        b.classList.toggle('on', i < 0);
      };
    });
    $('#tsave').onclick = async function () {
      if (!String(t.title || '').trim()) { U.toast('Bitte eintragen, was gemacht wird', true); return; }
      if (!t.date) { U.toast('Bitte ein Datum wählen', true); return; }
      t.remind = (t.remind || []).sort(function (a, b) { return b - a; });
      await S.Termine.save(t);
      U.toast(navigator.onLine ? 'Termin gespeichert – die anderen werden benachrichtigt' : 'Gespeichert – wird übertragen, sobald Internet da ist');
      location.hash = '#/termine';
    };
    var del = $('#tdel');
    if (del) del.onclick = async function () {
      var ok = await U.confirmBox('Termin löschen?', 'Der Termin wird für alle entfernt.', 'Löschen', true);
      if (!ok) return;
      await S.Termine.remove(t);
      location.hash = '#/termine';
    };
    var ta = $('#toAuftrag');
    if (ta) ta.onclick = async function () {
      var idx = await S.Index.load();
      var c = S.Index.item(idx, t.customerId);
      var rec = S.Auftraege.create({ ablage: { datum: t.date, art: '' } });
      if (c) {
        var p = U.parseCustomer(c.name);
        rec.customerId = c.id; rec.customerName = c.name; rec.f.kunde_name = p.name; rec.f.kunde_adresse = p.address;
        if (p.ort) { rec.f.ort_datum = p.ort + ', ' + U.isoToDe(t.date); rec.f.datum_fertigstellung = rec.f.ort_datum; }
      }
      rec.f.art = t.title || '';
      rec.f.arbeitsumfang = t.note || '';
      var prof = await S.Profile.get();
      if (prof.monteurSig && prof.autoMonteur !== false) rec.sig = { monteur: { png: prof.monteurSig, at: Date.now(), auto: true } };
      await S.Auftraege.save(rec);
      location.hash = '#/auftrag/' + rec.id;
    };
    drawCust();
    syncTime();
  }

  window.TermineUI = { startMs: startMs };
})();
