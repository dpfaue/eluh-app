/* ELUH App – Kundennamen aus den Ordnernamen lesen, Vornamen erkennen und weglassen.
   Ordner-Schema (Kundendatenbank): „Nachname, Vorname / Straße Nr, Ort“
   ältere Schreibweisen: „Nachname / Straße, Ort“, „Nachname, Straße, Ort“, „Nachname Vorname, Straße, Ort“
   Das erste Wort (bzw. alles vor dem ersten Komma) ist der Nachname – der zählt. */
(function (root) {
  'use strict';

  // Häufige deutsche Vornamen (klein geschrieben). Wird nur gebraucht, wenn der Vorname NICHT per Komma abgetrennt ist.
  var FIRST = ('adam adolf agnes albert alexander alexandra alfred alfons alina alois andrea andreas angela angelika anita anja anke ' +
    'ann anna anne annegret annemarie annette antje anton armin arne arno arnold astrid axel barbara bärbel beate benjamin bernd ' +
    'bernhard berta bettina birgit björn bodo brigitte bruno burkhard candy carina carl carla carmen carola caroline carsten ' +
    'charlotte christa christel christian christiane christina christine christoph christopher claudia claus cornelia daniel ' +
    'daniela david denis dennis detlef dieter dietmar dirk doris dorothea dörte edeltraud edith egon elfriede elisabeth elke ' +
    'ella ellen elli elmar else emil emma enrico erich erika erna ernst erwin eva evelyn ewald fabian falk felix florian frank ' +
    'franz franziska frauke frieda friedrich fritz gabi gabriele georg gerald gerd gerda gerhard gerlinde gernot gert gertrud ' +
    'gisela gitta gottfried grete gudrun guido günter günther gustav hanna hannelore hannes hans harald harry hartmut hedwig ' +
    'heidi heike heiko heinrich heinz helene helga helge helmut helmuth henning henry herbert hermann hilde hildegard holger horst ' +
    'hubert hugo ida ilona ilse ina ines inge ingeborg ingo ingrid irene iris irma isabell jacqueline jan jana janine jannik jens ' +
    'jeannette jessica joachim jochen johann johanna johannes jonas jörg josef jürgen julia julian jutta kai karin karina karl ' +
    'karl-heinz karsten katharina kathrin katja katrin kerstin kevin klaus konrad kristin kurt lars laura lena leon liane lieselotte ' +
    'lisa lothar lotte louis lucas luise lukas lutz maik manfred manuel manuela marcel marco marcus margarete margit margot maria ' +
    'marianne marie marion mario marion markus marlies marta martha martin martina mathias matthias max maximilian melanie michael ' +
    'michaela mike monika nadine nadja nancy natalie nicole niklas nils nina norbert olaf oliver otto pascal patrick paul paula ' +
    'peggy peter petra philipp rainer ralf ralph regina reinhard reinhold renate rene rené richard rita robert roland rolf roman ' +
    'ronny rosemarie rosi rudolf rüdiger ruth sabine sabrina sandra sandro sara sarah sascha sebastian siegfried sieglinde silke ' +
    'silvia simon simone sonja stefan stefanie steffen steffi stephan stephanie susanne sven swen tanja thomas thorsten tilo ' +
    'tim tina tobias toni torsten udo ulf ulla ulrich ulrike ursula ute uwe vanessa vera veronika viktor volker waldemar walter ' +
    'waltraud werner wilfried wilhelm willi willy wolf wolfgang wolfram yvonne').split(' ');
  var FIRST_SET = {};
  FIRST.forEach(function (n) { if (n) FIRST_SET[n] = 1; });

  function isFirstNameWord(w) {
    w = String(w || '').trim().toLowerCase().replace(/[.]$/, '');
    if (!w) return false;
    if (FIRST_SET[w]) return true;
    // Doppelnamen „Hans-Joachim“, „Anne-Marie“
    if (w.indexOf('-') > 0) return w.split('-').every(function (p) { return !!FIRST_SET[p]; });
    return false;
  }
  /** „Walter“, „Hans-Joachim“, „Frank u. Petra“, „Herr Walter“ → Vorname(n)? */
  function isFirstNames(s) {
    var words = String(s || '').replace(/\b(u\.|und|&|herr|frau|fam\.?|familie)\b/gi, ' ').split(/\s+/).filter(Boolean);
    return words.length > 0 && words.length <= 3 && words.every(isFirstNameWord);
  }

  function clean(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }

  /** Ordnername → {name (Nachname), vorname, address (ohne Vorname), ort, label „Nachname, Straße, Ort“} */
  function parseCustomer(folderName) {
    var s = clean(folderName);
    var namePart, addr, vorname = '';
    var m = s.match(/^(.*?)\s+\/\s+(.*)$/); // „ / “ mit Leerzeichen trennt Name und Adresse
    if (m) {
      namePart = m[1]; addr = m[2];
    } else {
      var parts = s.split(',').map(clean).filter(Boolean);
      namePart = parts[0] || '';
      var rest = parts.slice(1);
      // „Kreye, Walter, Dorfstr 17, Groß Welle“: zweites Stück ohne Hausnummer und als Vorname erkennbar
      if (rest.length >= 2 && !/\d/.test(rest[0]) && (isFirstNames(rest[0]) || (rest.length >= 3 && rest[0].split(' ').length <= 2))) vorname = rest.shift();
      addr = rest.join(', ');
    }
    var np = namePart.split(',').map(clean).filter(Boolean);
    var name = np[0] || '';
    if (np.length > 1) vorname = [np.slice(1).join(' '), vorname].filter(Boolean).join(' ');
    // „Müller Hans“ ohne Komma: Vornamen am Ende abschneiden (das erste Wort bleibt immer)
    var w = name.split(' ');
    var cut = [];
    while (w.length > 1 && isFirstNameWord(w[w.length - 1])) cut.unshift(w.pop());
    if (cut.length) { name = w.join(' '); vorname = [cut.join(' '), vorname].filter(Boolean).join(' '); }
    addr = clean(addr);
    var ap = addr.split(',').map(clean).filter(Boolean);
    return {
      name: name,
      vorname: vorname,
      address: addr,
      ort: ap.length > 1 ? ap[ap.length - 1] : '',
      label: [name, addr].filter(Boolean).join(', ')
    };
  }

  /** Alte Auswertung (bis 2.5.x) – nur für die Bereinigung bestehender Aufträge */
  function parseCustomerOld(folderName) {
    var parts = String(folderName || '').split(',').map(function (p) { return p.trim(); }).filter(Boolean);
    return { name: parts[0] || '', address: parts.slice(1).join(', '), ort: parts.length > 1 ? parts[parts.length - 1] : '' };
  }

  var api = { parseCustomer: parseCustomer, parseCustomerOld: parseCustomerOld, isFirstNames: isFirstNames, isFirstNameWord: isFirstNameWord };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Names = api;
})(typeof self !== 'undefined' ? self : this);
