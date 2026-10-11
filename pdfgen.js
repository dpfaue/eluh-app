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
    var chunks = [];
    for (var i = 0; i < rows.length; i += ROWS_PER_PAGE) chunks.push(rows.slice(i, i + ROWS_PER_PAGE));
    if (!chunks.length) chunks.push([]);
    fillMaterialPage(ctx, rec, chunks[0], chunks.length === 1);
    // weitere Materialschein-Seiten bei mehr als 18 Positionen
    for (var c = 1; c < chunks.length; c++) {
      var extra = await loadFlat();
      fillMaterialPage(extra, rec, chunks[c], c === chunks.length - 1);
      var copied = await ctx.doc.copyPages(extra.doc, [1]);
      ctx.doc.addPage(copied[0]);
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

  /** Mehrere Aufträge zu einem PDF zusammenfassen (Sammeldruck) */
  async function merge(recs) {
    var L = window.PDFLib;
    var out = await L.PDFDocument.create();
    for (var i = 0; i < recs.length; i++) {
      var d = await buildDoc(recs[i]);
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
    var nr = String(f.auftrags_nr || '').trim().replace(/[\/\\:*?"<>|]/g, '-');
    var d = dmY((rec.ablage || {}).datum) || dmY(f.datum_annahme);
    var tail = nr ? nr : (d ? d.d + '.' + d.m + '.' + d.y : '');
    return 'Arbeitsauftrag' + (tail ? ' ' + tail : '') + '.pdf';
  }

  window.PdfGen = { build: build, merge: merge, folderSegments: folderSegments, fileName: fileName, fmtDate: fmtDate };
})();
