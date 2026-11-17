/* ELUH App – erzeugt das Arbeitsauftrag-PDF aus der Original-Vorlage (vorlage-arbeitsauftrag.pdf).
   Die Vorlage ist exakt das ausfüllbare PDF-Formular (Kästen, Logo, Fußzeile).
   Ablauf: Vorlage laden → Feldpositionen merken → Formular "flach" machen (Kästen bleiben
   als Grafik) → Text selbst in die Kästen schreiben (mit automatischer Verkleinerung). */
(function () {
  'use strict';

  var tplBytes = null;
  var ROWS_PER_PAGE = 18;

  async function template() {
    if (!tplBytes) {
      var r = await fetch('vorlage-arbeitsauftrag.pdf');
      if (!r.ok) throw new Error('Vorlage nicht gefunden');
      tplBytes = new Uint8Array(await r.arrayBuffer());
    }
    return tplBytes;
  }

  /** Vorlage laden, Feld-Rechtecke ermitteln, Felder flach machen */
  async function loadFlat() {
    var L = window.PDFLib;
    var doc = await L.PDFDocument.load(await template());
    var form = doc.getForm();
    var pages = doc.getPages();
    var rects = {};
    form.getFields().forEach(function (f) {
      var w = f.acroField.getWidgets()[0];
      var r = w.getRectangle();
      var pref = w.P();
      var pageIdx = 0;
      for (var i = 0; i < pages.length; i++) if (pages[i].ref === pref) pageIdx = i;
      if (!pref) pageIdx = /(_2$|^mat_|^datum_fertigstellung$)/.test(f.getName()) ? 1 : 0;
      rects[f.getName()] = { x: r.x, y: r.y, w: r.width, h: r.height, page: pageIdx, multiline: f.getName() === 'arbeitsumfang' };
    });
    form.flatten({ updateFieldAppearances: false });
    var font = await doc.embedFont(L.StandardFonts.Helvetica);
    return { doc: doc, rects: rects, font: font };
  }

  function sanitize(font, text) {
    var set = font.__charset || (font.__charset = new Set(font.getCharacterSet()));
    var s = String(text == null ? '' : text).replace(/\r\n?/g, '\n').replace(/\t/g, ' ');
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      var cp = ch.codePointAt(0);
      if (ch === '\n' || set.has(cp)) out += ch;
      else if (cp > 0xffff) { i++; out += '?'; }
      else out += ({ ' ': ' ', ' ': ' ', '−': '-', '‐': '-', '‑': '-' })[ch] || '?';
    }
    return out;
  }

  var COLOR = null;
  function color() { return COLOR || (COLOR = window.PDFLib.rgb(0.08, 0.08, 0.08)); }

  function drawSingle(page, rect, text, font, base) {
    text = sanitize(font, text).replace(/\n+/g, ' ').trim();
    if (!text) return;
    var size = base || 9;
    var maxW = rect.w - 5;
    while (font.widthOfTextAtSize(text, size) > maxW && size > 6) size -= 0.25;
    if (font.widthOfTextAtSize(text, size) > maxW) {
      while (text.length > 1 && font.widthOfTextAtSize(text + '…', size) > maxW) text = text.slice(0, -1);
      text += '…';
    }
    var y = rect.y + (rect.h - size * 0.7) / 2;
    page.drawText(text, { x: rect.x + 2.5, y: y, size: size, font: font, color: color() });
  }

  function wrap(font, text, size, maxW) {
    var lines = [];
    text.split('\n').forEach(function (para) {
      var words = para.split(/ +/);
      var line = '';
      words.forEach(function (w) {
        var cand = line ? line + ' ' + w : w;
        if (font.widthOfTextAtSize(cand, size) <= maxW) { line = cand; return; }
        if (line) lines.push(line);
        // sehr lange Wörter hart umbrechen
        while (font.widthOfTextAtSize(w, size) > maxW) {
          var cut = w.length;
          while (cut > 1 && font.widthOfTextAtSize(w.slice(0, cut), size) > maxW) cut--;
          lines.push(w.slice(0, cut));
          w = w.slice(cut);
        }
        line = w;
      });
      lines.push(line);
    });
    return lines;
  }

  function drawMulti(page, rect, text, font, base) {
    text = sanitize(font, text).replace(/\s+$/, '');
    if (!text.trim()) return;
    var size = base || 9.5;
    var maxW = rect.w - 8;
    var lines, lh;
    while (true) {
      lh = size * 1.25;
      lines = wrap(font, text, size, maxW);
      if (lines.length * lh <= rect.h - 6 || size <= 6) break;
      size -= 0.25;
    }
    var maxLines = Math.floor((rect.h - 6) / lh);
    if (lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      lines[maxLines - 1] = lines[maxLines - 1].replace(/.{0,2}$/, '') + '…';
    }
    var y = rect.y + rect.h - 4 - size * 0.8;
    lines.forEach(function (ln) {
      if (ln) page.drawText(ln, { x: rect.x + 4, y: y, size: size, font: font, color: color() });
      y -= lh;
    });
  }

  function fmtDate(iso) {
    if (!iso) return '';
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    return m ? m[3] + '.' + m[2] + '.' + m[1] : iso;
  }

  function fill(ctx, name, value) {
    var r = ctx.rects[name];
    if (!r || value == null || value === '') return;
    var page = ctx.doc.getPage(r.page);
    if (r.multiline) drawMulti(page, r, value, ctx.font);
    else drawSingle(page, r, value, ctx.font, /^mat_\d+_/.test(name) ? 8 : 9);
  }

  function materialRows(rec) {
    return (rec.material || []).filter(function (m) {
      return m && ['artnr', 'bez', 'einheit', 'menge', 'preis', 'gesamt'].some(function (k) { return String(m[k] || '').trim(); });
    });
  }

  function fillMaterialPage(ctx, rec, rows, isLast) {
    var f = rec.f || {};
    fill(ctx, 'auftrags_nr_2', f.auftrags_nr);
    fill(ctx, 'kunde_name_2', f.kunde_name);
    fill(ctx, 'datum_fertigstellung', f.datum_fertigstellung);
    if (isLast) fill(ctx, 'mat_gesamt_summe', f.mat_gesamt_summe);
    rows.forEach(function (m, i) {
      var n = i + 1;
      fill(ctx, 'mat_' + n + '_artnr', m.artnr);
      fill(ctx, 'mat_' + n + '_bez', m.bez);
      fill(ctx, 'mat_' + n + '_einheit', m.einheit);
      fill(ctx, 'mat_' + n + '_menge', m.menge);
      fill(ctx, 'mat_' + n + '_preis', m.preis);
      fill(ctx, 'mat_' + n + '_gesamt', m.gesamt);
    });
  }

  // Unterschriftsflächen (PDF-Punkte, Ursprung unten links) – je zwei Varianten:
  // flach über der ganzen Linie oder höher rechts neben der Beschriftung. Gewählt wird die,
  // in der die Unterschrift am größten dargestellt werden kann.
  var SIG_BOXES = {
    kunde: [{ x: 42, y: 105.5, w: 215, h: 27.5 }, { x: 146, y: 105.5, w: 112, h: 44 }],
    monteur: [{ x: 302, y: 105.5, w: 215, h: 27.5 }, { x: 410, y: 105.5, w: 108, h: 44 }],
    monteur2: [{ x: 392, y: 218.5, w: 161, h: 17.5 }, { x: 468, y: 218.5, w: 85, h: 34 }]
  };

  function dataUrlBytes(url) {
    var b64 = String(url).split(',')[1] || '';
    var bin = atob(b64);
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }

  async function drawSignature(doc, page, png, boxes) {
    if (!png) return;
    var img = await doc.embedPng(dataUrlBytes(png));
    var ar = img.width / img.height;
    var best = null;
    boxes.forEach(function (b) {
      var w = Math.min(b.w, b.h * ar), h = w / ar;
      if (!best || w * h > best.w * best.h) best = { x: b.x, y: b.y, w: w, h: h, box: b };
    });
    page.drawImage(img, { x: best.box.x + (best.box.w - best.w) / 2, y: best.y, width: best.w, height: best.h });
  }

  /** Erzeugt die PDF-Seiten eines Auftrags in einem neuen Dokument */
  async function buildDoc(rec) {
    var ctx = await loadFlat();
    var f = rec.f || {};
    fill(ctx, 'auftrags_nr', f.auftrags_nr);
    fill(ctx, 'datum_annahme', fmtDate(f.datum_annahme));
    fill(ctx, 'kunde_name', f.kunde_name);
    fill(ctx, 'kunde_name_zusatz', f.kunde_name_zusatz);
    fill(ctx, 'kunde_adresse', f.kunde_adresse);
    fill(ctx, 'art', f.art);
    fill(ctx, 'arbeitsumfang', f.arbeitsumfang);
    fill(ctx, 'ort_datum', f.ort_datum);

    var rows = materialRows(rec);
    var hasMaterial = rows.length > 0 || String(f.mat_gesamt_summe || '').trim();
    if (!hasMaterial) {
      // kein Material eingetragen → Materialschein-Seite weglassen
      ctx.doc.removePage(1);
    }
    var chunks = [];
    for (var i = 0; i < rows.length; i += ROWS_PER_PAGE) chunks.push(rows.slice(i, i + ROWS_PER_PAGE));
    if (!chunks.length) chunks.push([]);
    if (hasMaterial) fillMaterialPage(ctx, rec, chunks[0], chunks.length === 1);
    // weitere Materialschein-Seiten bei mehr als 18 Positionen
    for (var c = 1; c < chunks.length; c++) {
      var extra = await loadFlat();
      fillMaterialPage(extra, rec, chunks[c], c === chunks.length - 1);
      var copied = await ctx.doc.copyPages(extra.doc, [1]);
      ctx.doc.addPage(copied[0]);
    }
    var sig = rec.sig || {};
    await drawSignature(ctx.doc, ctx.doc.getPage(0), sig.kunde && sig.kunde.png, SIG_BOXES.kunde);
    await drawSignature(ctx.doc, ctx.doc.getPage(0), sig.monteur && sig.monteur.png, SIG_BOXES.monteur);
    var pages = ctx.doc.getPages();
    for (var pi = 1; hasMaterial && pi < pages.length; pi++) {
      await drawSignature(ctx.doc, pages[pi], sig.monteur && sig.monteur.png, SIG_BOXES.monteur2);
    }
    var title = 'Arbeitsauftrag' + (f.auftrags_nr ? ' ' + f.auftrags_nr : '') + (f.kunde_name ? ' – ' + f.kunde_name : '');
    ctx.doc.setTitle(sanitize(ctx.font, title));
    ctx.doc.setAuthor('eluh Anlagen Kyritz GmbH');
    ctx.doc.setCreator('ELUH App');
    ctx.doc.setProducer('ELUH App');
    return ctx.doc;
  }

  async function build(rec) {
    var doc = await buildDoc(rec);
    return doc.save();
  }

  // ------------------------------------------------------------------
  // Stundennachweis (eigenes PDF, nur wenn Arbeitszeiten eingetragen sind)
  // ------------------------------------------------------------------
  function zeitRows(rec) {
    return (rec.zeiten || []).filter(function (z) { return z && String(z.stunden || '').trim(); });
  }
  function hasZeiten(rec) { return zeitRows(rec).length > 0; }
  function hasMaterial(rec) { return materialRows(rec).length > 0 || !!String((rec.f || {}).mat_gesamt_summe || '').trim(); }
  function num(v) { var n = parseFloat(String(v || '').replace(',', '.').replace(/[^0-9.\-]/g, '')); return isNaN(n) ? 0 : n; }
  function fmtNum(n) { return (Math.round(n * 100) / 100).toFixed(2).replace(/\.?0+$/, '').replace('.', ','); }

  var logoBytes = null;
  async function logo() {
    if (!logoBytes) { var r = await fetch('logo.png'); logoBytes = new Uint8Array(await r.arrayBuffer()); }
    return logoBytes;
  }

  async function buildStundenDoc(rec) {
    var L = window.PDFLib;
    var doc = await L.PDFDocument.create();
    var page = doc.addPage([595.2756, 841.8898]);
    var font = await doc.embedFont(L.StandardFonts.Helvetica);
    var bold = await doc.embedFont(L.StandardFonts.HelveticaBold);
    var grey = L.rgb(0.25, 0.25, 0.25), line = L.rgb(0.6, 0.6, 0.6), ink = L.rgb(0.08, 0.08, 0.08);
    var M = 40, W = 595.2756;
    var img = await doc.embedPng(await logo());
    var lw = W - 2 * M, lh = lw * 129 / 654;
    var ly = 841.8898 - 28 - lh;
    page.drawImage(img, { x: M, y: ly, width: lw, height: lh });
    var ry = ly - 12;
    page.drawLine({ start: { x: M, y: ry }, end: { x: W - M, y: ry }, thickness: 1, color: L.rgb(0.5, 0.5, 0.5) });
    var f = rec.f || {};
    var T = function (t) { return sanitize(font, t); };
    var y = ry - 30;
    page.drawText('Stundennachweis', { x: M, y: y, size: 13, font: bold, color: grey });
    y -= 30;
    var info = [
      ['Auftrags-Nr.', f.auftrags_nr || '–'],
      ['Kunde', [f.kunde_name, f.kunde_name_zusatz].filter(Boolean).join(', ') || rec.customerName || '–'],
      ['Adresse', f.kunde_adresse || '–'],
      ['Art des Auftrags', f.art || '–'],
      ['Datum der Annahme', fmtDate(f.datum_annahme) || '–']
    ];
    info.forEach(function (row) {
      page.drawText(row[0], { x: M, y: y, size: 8, font: font, color: grey });
      page.drawText(T(row[1]), { x: M + 110, y: y, size: 10, font: font, color: ink, maxWidth: W - 2 * M - 110 });
      y -= 18;
    });
    y -= 14;
    // Tabelle
    var cols = [{ t: 'Datum', x: M, w: 110 }, { t: 'Monteur', x: M + 115, w: 260 }, { t: 'Stunden', x: M + 380, w: W - M - (M + 380) }];
    cols.forEach(function (c) { page.drawText(c.t, { x: c.x + 3, y: y, size: 9, font: bold, color: ink }); });
    page.drawLine({ start: { x: M, y: y - 5 }, end: { x: W - M, y: y - 5 }, thickness: 0.8, color: L.rgb(0.5, 0.5, 0.5) });
    y -= 10;
    var rows = zeitRows(rec);
    var sum = 0;
    var rowH = 20;
    rows.forEach(function (z) {
      y -= rowH;
      var h = num(z.stunden);
      sum += h;
      cols.forEach(function (c) { page.drawRectangle({ x: c.x, y: y, width: c.w, height: rowH - 4, borderColor: line, borderWidth: 0.6 }); });
      page.drawText(T(fmtDate(z.datum) || ''), { x: cols[0].x + 4, y: y + 5, size: 10, font: font, color: ink });
      page.drawText(T(z.monteur || ''), { x: cols[1].x + 4, y: y + 5, size: 10, font: font, color: ink, maxWidth: cols[1].w - 8 });
      var hs = T(String(z.stunden).trim());
      page.drawText(hs, { x: cols[2].x + cols[2].w - 6 - font.widthOfTextAtSize(hs, 10), y: y + 5, size: 10, font: font, color: ink });
    });
    y -= 26;
    var st = 'Gesamt: ' + fmtNum(sum) + ' Std.';
    page.drawText(st, { x: W - M - 6 - bold.widthOfTextAtSize(st, 11), y: y, size: 11, font: bold, color: ink });
    // Unterschrift Monteur
    y -= 60;
    page.drawText('Ort, Datum', { x: M, y: y + 22, size: 8, font: font, color: grey });
    page.drawText(T(f.datum_fertigstellung || f.ort_datum || ''), { x: M, y: y + 4, size: 10, font: font, color: ink });
    page.drawLine({ start: { x: M, y: y }, end: { x: M + 220, y: y }, thickness: 0.8, color: L.rgb(0.4, 0.4, 0.4) });
    page.drawText('Unterschrift Monteur', { x: M + 300, y: y + 40, size: 8, font: font, color: grey });
    page.drawLine({ start: { x: M + 300, y: y }, end: { x: W - M, y: y }, thickness: 0.8, color: L.rgb(0.4, 0.4, 0.4) });
    var sig = rec.sig && rec.sig.monteur && rec.sig.monteur.png;
    if (sig) await drawSignature(doc, page, sig, [{ x: M + 302, y: y + 1, w: W - M - (M + 302) - 2, h: 36 }]);
    // Fußzeile wie im Formular
    page.drawLine({ start: { x: M, y: 70 }, end: { x: W - M, y: 70 }, thickness: 0.8, color: L.rgb(0.7, 0.7, 0.7) });
    ['Tel.: 033971/ 8739-0     Fax.: 033971/ 8739-17     email: info@eluhkyritz.de     www.eluhkyritz.de',
      'Sparkasse Ostprignitz Ruppin     BIC WELADED1OPR     IBAN DE41 1605 0202 1520 00226 17',
      'Amtsgericht Neuruppin     HRB-NR 729     St-Nr. 052/108/00974     Geschäftsführer: Toral Horn'].forEach(function (t, i) {
      var tt = T(t);
      page.drawText(tt, { x: (W - font.widthOfTextAtSize(tt, 7)) / 2, y: 60 - i * 9, size: 7, font: font, color: L.rgb(0.35, 0.35, 0.35) });
    });
    doc.setTitle(T('Stundennachweis' + (f.auftrags_nr ? ' ' + f.auftrags_nr : '') + (f.kunde_name ? ' – ' + f.kunde_name : '')));
    doc.setCreator('ELUH App');
    return doc;
  }

  async function buildStunden(rec) {
    if (!hasZeiten(rec)) return null;
    return (await buildStundenDoc(rec)).save();
  }

  // ------------------------------------------------------------------
  // Angebotsanfrage (eigenes, schlichtes A4-PDF fürs Büro; längerer Text läuft auf Seite 2, 3 … weiter)
  // ------------------------------------------------------------------
  function isAngebot(rec) { return !!rec && (rec.kind === 'angebot' || (rec.f && rec.f.typ === 'angebot')); }

  var FOOTER = ['Tel.: 033971/ 8739-0     Fax.: 033971/ 8739-17     email: info@eluhkyritz.de     www.eluhkyritz.de',
    'Sparkasse Ostprignitz Ruppin     BIC WELADED1OPR     IBAN DE41 1605 0202 1520 00226 17',
    'Amtsgericht Neuruppin     HRB-NR 729     St-Nr. 052/108/00974     Geschäftsführer: Toral Horn'];

  async function buildAngebotDoc(rec) {
    var L = window.PDFLib;
    var doc = await L.PDFDocument.create();
    var font = await doc.embedFont(L.StandardFonts.Helvetica);
    var bold = await doc.embedFont(L.StandardFonts.HelveticaBold);
    var grey = L.rgb(0.25, 0.25, 0.25), ink = L.rgb(0.08, 0.08, 0.08), rule = L.rgb(0.5, 0.5, 0.5);
    var W = 595.2756, H = 841.8898, M = 40, BOTTOM = 92; // unterhalb von BOTTOM steht nur die Fußzeile
    var T = function (t) { return sanitize(font, t); };
    var f = rec.f || {};
    var kunde = [f.kunde_name, f.kunde_name_zusatz].filter(Boolean).join(', ') || rec.customerName || '';
    var img = await doc.embedPng(await logo());
    var pages = [], page, y;

    function footer(pg) {
      pg.drawLine({ start: { x: M, y: 70 }, end: { x: W - M, y: 70 }, thickness: 0.8, color: L.rgb(0.7, 0.7, 0.7) });
      FOOTER.forEach(function (t, i) {
        var tt = T(t);
        pg.drawText(tt, { x: (W - font.widthOfTextAtSize(tt, 7)) / 2, y: 60 - i * 9, size: 7, font: font, color: L.rgb(0.35, 0.35, 0.35) });
      });
    }
    function firstPage() {
      page = doc.addPage([W, H]); pages.push(page);
      var lw = W - 2 * M, lh = lw * 129 / 654, ly = H - 28 - lh;
      page.drawImage(img, { x: M, y: ly, width: lw, height: lh });
      var ry = ly - 12;
      page.drawLine({ start: { x: M, y: ry }, end: { x: W - M, y: ry }, thickness: 1, color: rule });
      y = ry - 30;
      page.drawText('Angebotsanfrage', { x: M, y: y, size: 13, font: bold, color: grey });
      y -= 28;
      [['Kunde', kunde || '–'], ['Adresse', f.kunde_adresse || '–'], ['Datum', fmtDate(f.datum_annahme) || '–']].forEach(function (row) {
        page.drawText(row[0], { x: M, y: y, size: 8, font: font, color: grey });
        var lines = wrap(font, T(row[1]).replace(/\n+/g, ', '), 10, W - 2 * M - 110);
        lines.slice(0, 2).forEach(function (ln, i) { page.drawText(ln, { x: M + 110, y: y - i * 13, size: 10, font: font, color: ink }); });
        y -= 18 + (Math.min(lines.length, 2) - 1) * 13;
      });
      y -= 10;
      footer(page);
    }
    function nextPage() {
      page = doc.addPage([W, H]); pages.push(page);
      y = H - 50;
      page.drawText(T('Angebotsanfrage' + (kunde ? ' – ' + kunde : '')), { x: M, y: y, size: 10, font: bold, color: grey, maxWidth: W - 2 * M - 80 });
      page.drawLine({ start: { x: M, y: y - 8 }, end: { x: W - M, y: y - 8 }, thickness: 0.8, color: rule });
      y -= 34;
      footer(page);
    }
    var SIZE = 10.5, LH = 14.5;
    function section(title, text, bullets) {
      var lines = [];
      String(text || '').replace(/\r\n?/g, '\n').split('\n').forEach(function (para) {
        if (bullets) {
          if (!para.trim()) return;
          wrap(font, T(para.trim()), SIZE, W - 2 * M - 14).forEach(function (ln, i) { lines.push({ t: ln, x: M + 14, dot: i === 0 }); });
        } else {
          wrap(font, T(para), SIZE, W - 2 * M).forEach(function (ln) { lines.push({ t: ln, x: M }); });
        }
      });
      while (lines.length && !lines[lines.length - 1].t.trim()) lines.pop();
      if (!lines.length) lines.push({ t: '–', x: M });
      // Überschrift nie allein unten auf der Seite
      if (y - 22 - LH < BOTTOM) nextPage();
      page.drawText(title, { x: M, y: y, size: 11, font: bold, color: ink });
      page.drawLine({ start: { x: M, y: y - 5 }, end: { x: W - M, y: y - 5 }, thickness: 0.6, color: L.rgb(0.75, 0.75, 0.75) });
      y -= 22;
      lines.forEach(function (ln) {
        if (y < BOTTOM) {
          nextPage();
          page.drawText(T(title + ' (Fortsetzung)'), { x: M, y: y, size: 9, font: bold, color: grey });
          y -= 18;
        }
        if (ln.dot) page.drawText('•', { x: M + 3, y: y, size: SIZE, font: font, color: ink });
        if (ln.t) page.drawText(ln.t, { x: ln.x, y: y, size: SIZE, font: font, color: ink });
        y -= LH;
      });
      y -= 16;
    }
    /** Material als Tabelle wie im Materialschein: Art.-Nr. | Bezeichnung | Menge | Preis */
    function matTable(rows) {
      var cols = [{ k: 'artnr', t: 'Art.-Nr.', x: M, w: 95 }, { k: 'bez', t: 'Bezeichnung', x: M + 100, w: 285 },
        { k: 'menge', t: 'Menge', x: M + 390, w: 55, r: true }, { k: 'preis', t: 'Preis €', x: M + 450, w: W - 2 * M - 450, r: true }];
      function head(cont) {
        page.drawText(cont ? 'Material (Fortsetzung)' : 'Material', { x: M, y: y, size: cont ? 9 : 11, font: bold, color: cont ? grey : ink });
        y -= 20;
        cols.forEach(function (c) {
          var tw = bold.widthOfTextAtSize(c.t, 8.5);
          page.drawText(c.t, { x: c.r ? c.x + c.w - tw : c.x, y: y, size: 8.5, font: bold, color: grey });
        });
        page.drawLine({ start: { x: M, y: y - 5 }, end: { x: W - M, y: y - 5 }, thickness: 0.6, color: L.rgb(0.6, 0.6, 0.6) });
        y -= 19;
      }
      if (y - 40 - LH < BOTTOM) nextPage();
      head(false);
      rows.forEach(function (m) {
        var cells = cols.map(function (c) {
          var t = T(String(m[c.k] || '').trim()).replace(/\n+/g, ' ');
          return c.r ? [t] : wrap(font, t, 10, c.w - 4);
        });
        var n = Math.max.apply(null, cells.map(function (l) { return l.length; }));
        var h = n * 13 + 6;
        if (y - h + 13 < BOTTOM) { nextPage(); head(true); }
        cols.forEach(function (c, ci) {
          cells[ci].forEach(function (ln, li) {
            var size = 10;
            if (c.r) { while (size > 6.5 && font.widthOfTextAtSize(ln, size) > c.w) size -= 0.5; }
            var tx = c.r ? c.x + c.w - font.widthOfTextAtSize(ln, size) : c.x;
            page.drawText(ln, { x: tx, y: y - li * 13, size: size, font: font, color: ink });
          });
        });
        page.drawLine({ start: { x: M, y: y - h + 9 }, end: { x: W - M, y: y - h + 9 }, thickness: 0.4, color: L.rgb(0.82, 0.82, 0.82) });
        y -= h;
      });
      y -= 12;
    }
    firstPage();
    section('Was soll gemacht werden', f.angebot_text, false);
    var mrows = (rec.material || []).filter(function (m) { return m && ['artnr', 'bez', 'menge', 'preis'].some(function (k) { return String(m[k] || '').trim(); }); });
    if (mrows.length) matTable(mrows);
    else section('Material', f.angebot_material, true); // ältere Angebote mit Freitext
    if (pages.length > 1) {
      pages.forEach(function (pg, i) {
        var t = 'Seite ' + (i + 1) + ' von ' + pages.length;
        pg.drawText(t, { x: W - M - font.widthOfTextAtSize(t, 8), y: 78, size: 8, font: font, color: grey });
      });
    }
    doc.setTitle(T('Angebotsanfrage' + (kunde ? ' – ' + kunde : '')));
    doc.setAuthor('eluh Anlagen Kyritz GmbH');
    doc.setCreator('ELUH App');
    doc.setProducer('ELUH App');
    return doc;
  }

  /** Auftrag + (falls vorhanden) Stundennachweis in einem Dokument – fürs Drucken */
  async function buildFullDoc(rec) {
    if (isAngebot(rec)) return buildAngebotDoc(rec);
    var d = await buildDoc(rec);
    if (hasZeiten(rec)) {
      var sd = await buildStundenDoc(rec);
      var pages = await d.copyPages(sd, sd.getPageIndices());
      pages.forEach(function (p) { d.addPage(p); });
    }
    return d;
  }
  async function buildFull(rec) { return (await buildFullDoc(rec)).save(); }

  function stundenName(rec) { return fileName(rec).replace(/^Arbeitsauftrag/, 'Stundennachweis'); }

  /** Mehrere Aufträge zu einem PDF zusammenfassen (Sammeldruck, inkl. Stundennachweise) */
  async function merge(recs) {
    var L = window.PDFLib;
    var out = await L.PDFDocument.create();
    for (var i = 0; i < recs.length; i++) {
      var d = await buildFullDoc(recs[i]);
      var pages = await out.copyPages(d, d.getPageIndices());
      pages.forEach(function (p) { out.addPage(p); });
    }
    out.setTitle('Arbeitsaufträge (' + recs.length + ')');
    out.setCreator('ELUH App');
    return out.save();
  }

  function dmY(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return null;
    return { d: Number(m[3]), m: Number(m[2]), y: m[1] };
  }

  /** Zielordner beim Kunden: Berichte / Jahr / "T.M.JJJJ - Art" (wie bisher in der Kundendatenbank) */
  function folderSegments(rec) {
    var a = rec.ablage || {};
    var d = dmY(a.datum) || dmY((rec.f || {}).datum_annahme) || dmY(window.Store.isoDate(new Date()));
    var art = String(a.art || (rec.f || {}).art || 'Auftrag').trim() || 'Auftrag';
    art = art.replace(/[\/\\:*?"<>|]/g, '-');
    return ['Berichte', d.y, d.d + '.' + d.m + '.' + d.y + ' - ' + art];
  }

  function fileName(rec) {
    var f = rec.f || {};
    if (isAngebot(rec)) {
      var ad = dmY(f.datum_annahme);
      var kn = String(f.kunde_name || '').trim().replace(/[\/\\:*?"<>|]/g, '-').slice(0, 40);
      return 'Angebotsanfrage' + (kn ? ' ' + kn : '') + (ad ? ' ' + ad.d + '.' + ad.m + '.' + ad.y : '') + '.pdf';
    }
    var nr = String(f.auftrags_nr || '').trim().replace(/[\/\\:*?"<>|]/g, '-');
    var d = dmY((rec.ablage || {}).datum) || dmY(f.datum_annahme);
    var tail = nr ? nr : (d ? d.d + '.' + d.m + '.' + d.y : '');
    return 'Arbeitsauftrag' + (tail ? ' ' + tail : '') + '.pdf';
  }

  window.PdfGen = {
    build: build, buildFull: buildFull, buildStunden: buildStunden, hasZeiten: hasZeiten, hasMaterial: hasMaterial, stundenName: stundenName,
    merge: merge, folderSegments: folderSegments, fileName: fileName, isAngebot: isAngebot, fmtDate: fmtDate, sumZeiten: function (rec) { return fmtNum(zeitRows(rec).reduce(function (a, z) { return a + num(z.stunden); }, 0)); }
  };
})();
