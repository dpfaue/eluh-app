/*
 * RecMerge – Datensätze von mehreren Geräten zusammenführen (App UND Backend, identischer Code).
 *
 * Jedes Feld hat einen eigenen Zeitstempel in rec.ts:  ts[schlüssel] = [zeit, basis, gerät]
 *   zeit  = wann geändert,  basis = Zeitstempel des Werts, der dabei überschrieben wurde,  gerät = Name
 * Schlüssel:  'f.art' (Feld in einem Objekt), 'status' (einfacher Wert),
 *             'm.<zeilenId>' (Materialzeile vorhanden=1 / gelöscht=0), 'm.<zeilenId>.bez' (Zelle), ebenso 'z.' für Arbeitszeiten.
 * Zusammenführen: je Schlüssel gewinnt der neuere Stand. Hat ein Gerät einen Wert überschrieben, den es nie gesehen hat
 * (zeit des Verlierers > basis des Gewinners), wird die verlorene Fassung als Konflikt in rec.cf aufgehoben.
 * Wird nach jeder Änderung von web/merge.js unverändert in gas/Code.gs kopiert (tools/sync-merge.js).
 */
var RecMerge = (function () {
  // nicht feldweise geführt: Verwaltungsdaten bzw. eigene Regeln
  var META = { id: 1, seq: 1, updatedAt: 1, createdAt: 1, ts: 1, cf: 1, sig: 1, office: 1, photos: 1, photosDel: 1, drive: 1, needsRefile: 1, mv: 1 };
  var ROWS = { material: 'm', zeiten: 'z' };
  var ROWKEY = { m: 'material', z: 'zeiten' };
  var NOCONF = { 'f.mat_gesamt_summe': 1 };
  var CONF_UNITS = { title: 1, text: 1, note: 1, address: 1, person: 1, date: 1, time: 1, end: 1 };
  var KEEP_DONE = 30 * 864e5;

  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function norm(v) { return v == null || v === false ? '' : v; }
  function same(x, y) {
    x = norm(x); y = norm(y);
    if (typeof x === 'object' || typeof y === 'object') return JSON.stringify(x) === JSON.stringify(y);
    return String(x) === String(y);
  }
  function tsOf(map, k) {
    var v = (map || {})[k];
    if (typeof v === 'number') return [v, 0, ''];
    if (Array.isArray(v)) return [Number(v[0]) || 0, Number(v[1]) || 0, v[2] || ''];
    return [0, 0, ''];
  }
  function rowId(row, i) { return (row && row.id) || ('i' + i); }

  /** Zeilen ohne Kennung bekommen eine feste („i0“, „i1“ … – auf allen Geräten gleich) */
  function ensureIds(rec) {
    Object.keys(ROWS).forEach(function (k) {
      if (!Array.isArray(rec[k])) return;
      rec[k] = rec[k].map(function (row, i) {
        row = isObj(row) ? row : {};
        if (!row.id) row.id = 'i' + i;
        return row;
      });
    });
    return rec;
  }

  /** Datensatz → flache Liste {schlüssel: wert} */
  function flatten(rec) {
    var out = {};
    rec = rec || {};
    Object.keys(rec).forEach(function (k) {
      if (META[k] || k.charAt(0) === '_') return;
      var v = rec[k];
      if (ROWS[k] && Array.isArray(v)) {
        v.forEach(function (row, i) {
          if (!isObj(row)) return;
          var p = ROWS[k] + '.' + rowId(row, i);
          out[p] = 1;
          Object.keys(row).forEach(function (c) { if (c !== 'id') out[p + '.' + c] = row[c]; });
        });
      } else if (isObj(v)) {
        Object.keys(v).forEach(function (s) { out[k + '.' + s] = v[s]; });
      } else {
        out[k] = v;
      }
    });
    // gelöschte Zeilen (nur noch im Zeitstempel bekannt)
    Object.keys(rec.ts || {}).forEach(function (k) {
      var p = k.split('.');
      if (p.length === 2 && ROWKEY[p[0]] && !(k in out)) out[k] = 0;
    });
    return out;
  }

  function kind(k) {
    var p = k.split('.');
    if (p.length === 1) return { t: 'unit', k: k };
    if (ROWKEY[p[0]]) return p.length === 2 ? { t: 'row', p: p[0], id: p[1] } : { t: 'cell', p: p[0], id: p[1], c: p.slice(2).join('.') };
    return { t: 'sub', o: p[0], s: p.slice(1).join('.') };
  }

  function cellOfMissingRow(k, f) { var x = kind(k); return x.t === 'cell' && f[x.p + '.' + x.id] !== 1; }
  function conflictable(k, lv, wv) {
    if (NOCONF[k]) return false;
    if (typeof norm(lv) === 'object' || typeof norm(wv) === 'object') return false;
    if (!String(norm(lv)).trim()) return false;
    var x = kind(k);
    if (x.t === 'row') return false;
    if (x.t === 'unit') return !!CONF_UNITS[k];
    return true;
  }

  /** Aus flacher Liste wieder einen Datensatz bauen. primary bestimmt die Reihenfolge der Zeilen. */
  function compose(primary, others, flat, meta) {
    var out = {};
    Object.keys(meta || {}).forEach(function (k) { if (meta[k] !== undefined) out[k] = meta[k]; });
    // Objekte/Zeilenlisten, die es im Ausgangsstand gab, bleiben als (evtl. leere) Hülle erhalten
    [primary].concat(others).forEach(function (r) {
      Object.keys(r || {}).forEach(function (k) {
        if (META[k] || k.charAt(0) === '_') return;
        if (ROWS[k] && Array.isArray(r[k])) { if (!out[k]) out[k] = []; }
        else if (isObj(r[k]) && !out[k]) out[k] = {};
      });
    });
    var rows = { m: {}, z: {} };
    Object.keys(flat).forEach(function (k) {
      var v = flat[k];
      if (v === undefined) return;
      var x = kind(k);
      if (x.t === 'unit') out[k] = v;
      else if (x.t === 'sub') { if (!isObj(out[x.o])) out[x.o] = {}; out[x.o][x.s] = v; }
      else if (x.t === 'row') { if (v === 1) { rows[x.p][x.id] = rows[x.p][x.id] || { id: x.id }; } }
    });
    Object.keys(flat).forEach(function (k) {
      var x = kind(k);
      if (x.t === 'cell' && rows[x.p][x.id] && flat[k] !== undefined) rows[x.p][x.id][x.c] = flat[k];
    });
    Object.keys(ROWKEY).forEach(function (p) {
      var have = rows[p], key = ROWKEY[p], order = [], seen = {};
      [primary].concat(others).forEach(function (r) {
        ((r && r[key]) || []).forEach(function (row, i) {
          var id = rowId(row, i);
          if (have[id] && !seen[id]) { seen[id] = 1; order.push(have[id]); }
        });
      });
      Object.keys(have).sort().forEach(function (id) { if (!seen[id]) order.push(have[id]); });
      if (order.length || out[key]) out[key] = order;
    });
    return out;
  }

  function mergeSig(a, b) {
    a = a || {}; b = b || {};
    var out = {};
    Object.keys(a).concat(Object.keys(b)).forEach(function (k) {
      if (out[k]) return;
      var x = a[k], y = b[k];
      out[k] = !x ? y : !y ? x : (Number(y.at || 0) >= Number(x.at || 0) ? y : x);
      if (!out[k]) delete out[k];
    });
    return out;
  }

  /** Fotos: Liste vereinigen (Kennung bleibt beim Hochladen gleich), entfernte bleiben entfernt */
  function photoKey(p) { return p.pid || (p.addedAt ? 'a' + p.addedAt + '_' + (p.size || '') : p.id); }
  function mergePhotos(a, b, newerB) {
    var del = {};
    [a.photosDel || {}, b.photosDel || {}].forEach(function (m) { Object.keys(m).forEach(function (k) { del[k] = Math.max(del[k] || 0, Number(m[k]) || 0); }); });
    var first = newerB ? b : a, second = newerB ? a : b, out = [], at = {};
    (first.photos || []).concat(second.photos || []).forEach(function (p) {
      if (!p) return;
      var k = photoKey(p);
      if (del[k]) return;
      if (!(k in at)) { at[k] = out.length; out.push(p); return; }
      var cur = out[at[k]];
      if (!cur.fileId && p.fileId) out[at[k]] = p; // hochgeladene Fassung gewinnt
    });
    return { photos: out, del: del };
  }
  function mergeDrive(a, b, newerB) {
    var x = a.drive, y = b.drive;
    if (!x) return y || (newerB ? b.drive : a.drive);
    if (!y) return x;
    return Number(y.filedAt || 0) >= Number(x.filedAt || 0) ? y : x;
  }

  function mergeConf(a, b, add, now) {
    var out = {};
    [a || {}, b || {}].forEach(function (m) {
      Object.keys(m).forEach(function (id) {
        var x = out[id], y = m[id];
        if (!y) return;
        if (!x) out[id] = y;
        else if (y.done && !x.done) out[id] = y;
      });
    });
    (add || []).forEach(function (c) { if (!out[c.id]) out[c.id] = c; });
    var ids = Object.keys(out).filter(function (id) { return !(out[id].done && now - out[id].done > KEEP_DONE); });
    ids.sort(function (x, y) { return Number(out[y].at || 0) - Number(out[x].at || 0); });
    var res = {};
    ids.slice(0, 60).forEach(function (id) { res[id] = out[id]; });
    return res;
  }

  /**
   * a und b zusammenführen.
   * opts.stampB: b ist eine lokale Bearbeitung von a (Speichern auf dem Gerät) – Unterschiede bei gleichem Zeitstempel
   *              sind dann neue Eingaben von b und bekommen den Zeitstempel opts.now / opts.by.
   * opts.metaFrom: 'a' | 'b' – Verwaltungsdaten (Fotos, Ablage-Status, Büro …) von dort; sonst vom neueren Stand.
   */
  function merge(a, b, opts) {
    opts = opts || {};
    a = a || {}; b = b || {};
    var now = opts.now || Date.now();
    var newerB = Number(b.updatedAt || 0) >= Number(a.updatedAt || 0);
    var base = opts.metaFrom === 'a' ? a : opts.metaFrom === 'b' ? b : (newerB ? b : a);
    var fa = flatten(a), fb = flatten(b), tA = a.ts || {}, tB = b.ts || {};
    var keys = {};
    [fa, fb, tA, tB].forEach(function (m) { Object.keys(m).forEach(function (k) { keys[k] = 1; }); });
    var flat = {}, ts = {}, conf = [];
    Object.keys(keys).forEach(function (k) {
      var va = fa[k], vb = fb[k], ta = tsOf(tA, k), tb = tsOf(tB, k), win, wt, lt, wv, lv;
      if (same(va, vb)) {
        flat[k] = va !== undefined ? va : vb;
        wt = ta[0] >= tb[0] ? ta : tb;
      } else {
        var tie = ta[0] === tb[0];
        if (ta[0] > tb[0]) win = 'a';
        else if (tb[0] > ta[0]) win = 'b';
        else if (opts.stampB && cellOfMissingRow(k, fb)) win = 'a'; // Zeile gelöscht: nur die Zeile zählt
        else if (opts.stampB) { tb = [now, ta[0], opts.by || '']; win = 'b'; }
        else win = base === b ? 'b' : 'a';
        wv = win === 'a' ? va : vb; lv = win === 'a' ? vb : va;
        wt = win === 'a' ? ta : tb; lt = win === 'a' ? tb : ta;
        flat[k] = wv;
        if (!tie && lt[0] > wt[1] && lt[0] > 0 && conflictable(k, lv, wv)) {
          conf.push({ id: k + '@' + lt[0], k: k, v: lv, by: lt[2], at: lt[0], w: wv === undefined ? '' : wv, wby: wt[2], wat: wt[0] });
        }
      }
      if (wt[0] > 0) ts[k] = wt;
    });
    // Zeile gelöscht, aber danach auf einem anderen Gerät noch bearbeitet → Zeile bleibt (nichts geht verloren)
    Object.keys(flat).forEach(function (k) {
      var x = kind(k);
      if (x.t !== 'row' || flat[k] !== 0) return;
      var del = tsOf(ts, k), best = null;
      Object.keys(flat).forEach(function (c) {
        if (c.indexOf(k + '.') !== 0 || flat[c] === undefined) return;
        var t = tsOf(ts, c);
        if (t[0] > del[0] && (!best || t[0] > best[0])) best = t;
      });
      if (!best) return;
      flat[k] = 1; ts[k] = [best[0], del[0], best[2]];
      // Zellen der wiederhergestellten Zeile vom Gerät nehmen, das sie noch hat
      var keep = fa[k] === 1 ? fa : fb;
      Object.keys(keep).forEach(function (c) { if (c.indexOf(k + '.') === 0 && flat[c] === undefined) flat[c] = keep[c]; });
    });
    // Konflikte nur für Zellen von Zeilen, die es noch gibt
    conf = conf.filter(function (c) { var x = kind(c.k); return x.t !== 'cell' || flat[x.p + '.' + x.id] === 1; });
    var meta = {};
    Object.keys(META).forEach(function (k) { if (k !== 'ts' && k !== 'cf') meta[k] = base[k]; });
    var prim = opts.stampB || newerB ? b : a;
    var out = compose(prim, [prim === b ? a : b], flat, meta);
    out.sig = mergeSig(a.sig, b.sig);
    if (a.photos || b.photos || a.photosDel || b.photosDel) {
      var ph = mergePhotos(a, b, prim === b);
      out.photos = ph.photos;
      if (Object.keys(ph.del).length) out.photosDel = ph.del;
    }
    if (a.drive || b.drive) out.drive = mergeDrive(a, b, newerB);
    if (!Object.keys(out.sig).length && !a.sig && !b.sig) delete out.sig;
    out.updatedAt = Math.max(Number(a.updatedAt || 0), Number(b.updatedAt || 0));
    if (a.createdAt || b.createdAt) out.createdAt = Math.min(Number(a.createdAt || b.createdAt), Number(b.createdAt || a.createdAt));
    out.ts = ts;
    var cf = mergeConf(a.cf, b.cf, conf, now);
    if (Object.keys(cf).length) out.cf = cf;
    return out;
  }

  /** Eingaben seit „base“ (Momentaufnahme beim Öffnen/letzten Speichern) mit neuem Zeitstempel versehen */
  function snapshot(rec) { return { flat: flatten(rec), ts: JSON.parse(JSON.stringify((rec && rec.ts) || {})) }; }
  function stampEdits(rec, base, by, now) {
    now = now || Date.now();
    var cur = flatten(rec), keys = {}, n = 0;
    Object.keys(cur).concat(Object.keys(base.flat)).forEach(function (k) { keys[k] = 1; });
    rec.ts = rec.ts || {};
    Object.keys(keys).forEach(function (k) {
      if (same(cur[k], base.flat[k])) return;
      var x = kind(k);
      if (x.t === 'cell' && cur[x.p + '.' + x.id] !== 1) return; // Zeile gelöscht: nur die Zeile markieren
      rec.ts[k] = [now, tsOf(base.ts, k)[0], by || ''];
      n++;
    });
    return n;
  }
  /** Schlüssel, die sich seit „base“ geändert haben */
  function changedKeys(rec, base) {
    var cur = flatten(rec), out = [];
    var keys = {};
    Object.keys(cur).concat(Object.keys(base.flat)).forEach(function (k) { keys[k] = 1; });
    Object.keys(keys).forEach(function (k) { if (!same(cur[k], base.flat[k])) out.push(k); });
    return out;
  }
  /** Einen Wert über seinen Schlüssel setzen (für „Fassung übernehmen“) */
  function setValue(rec, k, v) {
    var x = kind(k);
    if (x.t === 'unit') { rec[k] = v; return true; }
    if (x.t === 'sub') { rec[x.o] = isObj(rec[x.o]) ? rec[x.o] : {}; rec[x.o][x.s] = v; return true; }
    if (x.t === 'cell') {
      var list = rec[ROWKEY[x.p]] || [];
      for (var i = 0; i < list.length; i++) if (rowId(list[i], i) === x.id) { list[i][x.c] = v; return true; }
    }
    return false;
  }
  function getValue(rec, k) { return flatten(rec)[k]; }
  function openConflicts(rec) {
    var cf = (rec && rec.cf) || {};
    return Object.keys(cf).map(function (id) { return cf[id]; }).filter(function (c) { return !c.done; })
      .sort(function (x, y) { return Number(x.at || 0) - Number(y.at || 0); });
  }
  function kindOf(k) { return kind(k); }
  function metaOf(rec) { var m = {}; Object.keys(META).forEach(function (k) { if (rec && rec[k] !== undefined) m[k] = rec[k]; }); return m; }

  return {
    flatten: flatten, compose: compose, merge: merge, mergeSig: mergeSig, mergeConf: mergeConf, ensureIds: ensureIds,
    snapshot: snapshot, stampEdits: stampEdits, changedKeys: changedKeys, setValue: setValue, getValue: getValue,
    openConflicts: openConflicts, kind: kindOf, photoKey: photoKey, metaOf: metaOf, same: same, tsOf: tsOf
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = RecMerge;
