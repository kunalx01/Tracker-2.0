/* GATE CSE Rank Tracker - scoring model.
   Pure functions only (no DOM) so the same file runs in the browser and in node tests.
   ALL benchmark numbers are assumptions built from topper interviews and coaching plans,
   calibrated to GATE 2026 CS (about 2.6 lakh registered, qualifying cutoff 30/100).
   Edit TIERS / WEIGHTS / CEIL below to recalibrate after real data comes in. */
(function (root) {
  'use strict';

  var START_DEFAULT = '2026-02-07';   // day 0 of the hypothetical Feb-to-Feb dropper year
  var EXAM_DEFAULT = '2027-02-06';
  var FIELD = 250000;                 // aspirants in the simulated race
  var QUALIFY = 40000;                // how many qualify
  var REF_DAY = 246;                  // benchmark tiers below are defined as of 11 Oct 2026 (day 246)

  /* marks = approximate GATE CSE weightage (sums to 100). pyqTotal / dppTotal = default totals, editable in app. */
  var SUBJECTS = [
    { id: 'apt',  name: 'General Aptitude',            marks: 15, pyqTotal: 200, dppTotal: 225 },
    { id: 'math', name: 'Engineering Maths',           marks: 13, pyqTotal: 400, dppTotal: 195 },
    { id: 'dl',   name: 'Digital Logic',               marks: 6,  pyqTotal: 120, dppTotal: 90 },
    { id: 'coa',  name: 'Computer Organization',       marks: 8,  pyqTotal: 170, dppTotal: 120 },
    { id: 'pds',  name: 'Programming & Data Structures', marks: 11, pyqTotal: 240, dppTotal: 165 },
    { id: 'algo', name: 'Algorithms',                  marks: 9,  pyqTotal: 200, dppTotal: 135 },
    { id: 'toc',  name: 'Theory of Computation',       marks: 8,  pyqTotal: 200, dppTotal: 120 },
    { id: 'cd',   name: 'Compiler Design',             marks: 6,  pyqTotal: 110, dppTotal: 90 },
    { id: 'os',   name: 'Operating Systems',           marks: 8,  pyqTotal: 190, dppTotal: 120 },
    { id: 'dbms', name: 'DBMS',                        marks: 8,  pyqTotal: 190, dppTotal: 120 },
    { id: 'cn',   name: 'Computer Networks',           marks: 8,  pyqTotal: 180, dppTotal: 120 }
  ];

  /* How much each part counts toward the readiness index (sums to 1). Mock score is the biggest: it is the hardest to fake. */
  var WEIGHTS = { cov: 0.22, rev: 0.14, pyq: 0.14, dpp: 0.06, mockN: 0.10, mockS: 0.22, hrs: 0.12 };
  /* A "full marks" benchmark for each part (what the best aspirant reaches by exam day). */
  var CEIL = { rev: 3, pyq: 2200, dpp: 1500, mockN: 25, mockS: 80, hrs: 2400 };

  /* Field tiers as of day 246. rank = representative rank of the tier. */
  var TIERS = [
    { id: 'elite', label: 'Top 10',            rank: 5,      m: { cov: 1,    rev: 2.5, pyq: 2200, dpp: 1500, mockN: 12, mockS: 75, hrs: 1900 } },
    { id: 't100',  label: 'Top 100',           rank: 100,    m: { cov: 1,    rev: 2,   pyq: 1800, dpp: 1200, mockN: 10, mockS: 65, hrs: 1700 } },
    { id: 't1k',   label: 'Top 1,000',         rank: 1000,   m: { cov: 1,    rev: 1.5, pyq: 1300, dpp: 800,  mockN: 8,  mockS: 55, hrs: 1400 } },
    { id: 't10k',  label: 'Top 10,000',        rank: 10000,  m: { cov: 0.95, rev: 1,   pyq: 800,  dpp: 400,  mockN: 5,  mockS: 45, hrs: 1000 } },
    { id: 'qual',  label: 'Qualifier line',    rank: 40000,  m: { cov: 0.8,  rev: 0.5, pyq: 400,  dpp: 150,  mockN: 2,  mockS: 33, hrs: 700 } },
    { id: 'med',   label: 'Median aspirant',   rank: 125000, m: { cov: 0.4,  rev: 0,   pyq: 50,   dpp: 0,    mockN: 0,  mockS: 22, hrs: 250 } }
  ];

  /* How each tier's numbers grow over the year, relative to day 246. p = day / 246. */
  var SHAPE = {
    cov:   function (p) { return p; },
    rev:   function (p) { return p * p; },
    pyq:   function (p) { return Math.pow(p, 1.5); },
    dpp:   function (p) { return Math.pow(p, 1.3); },
    mockN: function (p) { return Math.pow(p, 2.2); },
    mockS: function (p) { return 0.85 + 0.15 * p; },
    hrs:   function (p) { return p; }
  };
  var CAP = { cov: 1, rev: 3, pyq: 2200, dpp: 1500, mockN: 40, mockS: 85, hrs: 2600 };

  var MARK_ANCHORS = [[1, 90], [5, 82], [100, 72], [1000, 62], [10000, 47], [40000, 30], [125000, 20], [250000, 6]];

  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

  /* ---------- dates (UTC math so timezones never shift a day) ---------- */
  function parseISO(s) { var p = String(s).split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
  function dayIndex(iso, startISO) { return Math.round((parseISO(iso) - parseISO(startISO || START_DEFAULT)) / 86400000); }
  function addDays(iso, n) { var d = new Date(parseISO(iso) + n * 86400000); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0'); }

  /* ---------- tiers & index ---------- */
  function tierAt(tier, day) {
    var p = Math.max(day, 1) / REF_DAY, out = {};
    Object.keys(tier.m).forEach(function (k) { out[k] = Math.min(CAP[k], tier.m[k] * SHAPE[k](p)); });
    return out;
  }

  function composite(m) {
    var parts = {
      cov: clamp(m.cov, 0, 1),
      rev: clamp(m.rev / CEIL.rev, 0, 1),
      pyq: clamp(m.pyq / CEIL.pyq, 0, 1),
      dpp: clamp(m.dpp / CEIL.dpp, 0, 1),
      mockN: clamp(m.mockN / CEIL.mockN, 0, 1),
      mockS: m.mockN > 0 ? clamp(m.mockS / CEIL.mockS, 0, 1) : 0,
      hrs: clamp(m.hrs / CEIL.hrs, 0, 1)
    };
    var idx = 0;
    Object.keys(WEIGHTS).forEach(function (k) { idx += WEIGHTS[k] * parts[k]; });
    return { index: idx * 100, parts: parts };
  }

  function anchors(day) {
    var a = TIERS.map(function (t) { return { idx: composite(tierAt(t, day)).index, rank: t.rank, id: t.id }; });
    a.push({ idx: 0, rank: FIELD, id: 'floor' });
    a.sort(function (x, y) { return x.idx - y.idx; });
    return a;
  }

  function rankFor(index, day) {
    var a = anchors(day), top = a[a.length - 1];
    if (index <= 0) return FIELD;
    if (index >= top.idx) {
      var over = (index - top.idx) / (top.idx * 0.1);
      return Math.max(1, Math.round(top.rank - over * (top.rank - 1)));
    }
    for (var i = 0; i < a.length - 1; i++) {
      var lo = a[i], hi = a[i + 1];
      if (index >= lo.idx && index <= hi.idx) {
        var span = hi.idx - lo.idx;
        var t = span > 1e-9 ? (index - lo.idx) / span : 1;
        return Math.round(Math.exp(Math.log(lo.rank) + t * (Math.log(hi.rank) - Math.log(lo.rank))));
      }
    }
    return FIELD;
  }

  function marksFor(rank) {
    var r = clamp(rank, 1, FIELD), a = MARK_ANCHORS;
    for (var i = 0; i < a.length - 1; i++) {
      if (r >= a[i][0] && r <= a[i + 1][0]) {
        var t = (Math.log(r) - Math.log(a[i][0])) / (Math.log(a[i + 1][0]) - Math.log(a[i][0]));
        return a[i][1] + t * (a[i + 1][1] - a[i][1]);
      }
    }
    return a[a.length - 1][1];
  }

  /* ---------- user data -> metrics ---------- */
  function newData() {
    return {
      v: 1, startDate: START_DEFAULT, examDate: EXAM_DEFAULT, hoursBase: 0,
      subjects: SUBJECTS.map(function (s) {
        return { id: s.id, cov: 0, start: '', end: '', revBase: 0, lastRev: '', pyqBase: 0, pyqTotal: s.pyqTotal, dppBase: 0, dppTotal: s.dppTotal };
      }),
      logs: [], mocks: [], rankHist: {}, snap: {}, lastExport: 0, updatedAt: 0
    };
  }

  function logActive(l) { return (+l.hours || 0) > 0 || (+l.pyq || 0) > 0 || (+l.dpp || 0) > 0 || !!l.revSub; }

  function derive(D) {
    var per = {};
    D.subjects.forEach(function (s) {
      per[s.id] = { pyq: +s.pyqBase || 0, dpp: +s.dppBase || 0, rev: +s.revBase || 0, lastRev: s.lastRev || '', tests: 0 };
    });
    var hours = +D.hoursBase || 0;
    D.logs.forEach(function (l) {
      hours += +l.hours || 0;
      if (l.pyqSub && per[l.pyqSub]) per[l.pyqSub].pyq += +l.pyq || 0;
      if (l.dppSub && per[l.dppSub]) per[l.dppSub].dpp += +l.dpp || 0;
      if (l.revSub && per[l.revSub]) {
        if (l.revFull) per[l.revSub].rev += 1;
        if (!per[l.revSub].lastRev || l.date > per[l.revSub].lastRev) per[l.revSub].lastRev = l.date;
      }
    });
    var full = D.mocks.filter(function (m) { return m.type !== 'subject'; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    D.mocks.forEach(function (m) { if (m.type === 'subject' && m.sub && per[m.sub]) per[m.sub].tests++; });
    return { per: per, hours: hours, fullMocks: full };
  }

  function userMetrics(D, todayISO) {
    var dv = derive(D), sumMarks = 0, cov = 0, rev = 0, pyq = 0, dpp = 0;
    SUBJECTS.forEach(function (S) {
      var s = D.subjects.filter(function (x) { return x.id === S.id; })[0] || {};
      var p = dv.per[S.id];
      sumMarks += S.marks;
      cov += S.marks * clamp((+s.cov || 0) / 100, 0, 1);
      var days = p.lastRev ? Math.max(0, dayIndex(todayISO) - dayIndex(p.lastRev)) : 60;
      var decay = p.rev > 0 ? 0.5 + 0.5 * Math.exp(-days / 45) : 0;
      rev += S.marks * Math.min(p.rev, CEIL.rev) * decay;
      pyq += Math.min(p.pyq, +s.pyqTotal || p.pyq);
      dpp += Math.min(p.dpp, +s.dppTotal || p.dpp);
    });
    var last5 = dv.fullMocks.slice(-5), avg = last5.length ? last5.reduce(function (a, m) { return a + (+m.score || 0); }, 0) / last5.length : 0;
    return { cov: cov / sumMarks, rev: rev / sumMarks, pyq: pyq, dpp: dpp, mockN: dv.fullMocks.length, mockS: avg, hrs: dv.hours };
  }

  function evaluate(D, todayISO) {
    var day = dayIndex(todayISO, D.startDate);
    var M = userMetrics(D, todayISO), c = composite(M), rank = rankFor(c.index, day);
    return { day: day, M: M, parts: c.parts, index: c.index, rank: rank, marks: marksFor(rank) };
  }

  /* ---------- streaks ---------- */
  function activeDates(D) {
    var set = {};
    D.logs.forEach(function (l) { if (logActive(l)) set[l.date] = true; });
    return Object.keys(set).sort();
  }
  function streaks(D, todayISO) {
    var dates = activeDates(D), set = {}; dates.forEach(function (d) { set[d] = true; });
    var cur = 0, d = set[todayISO] ? todayISO : addDays(todayISO, -1);
    while (set[d]) { cur++; d = addDays(d, -1); }
    var best = 0, run = 0, prev = null;
    dates.forEach(function (x) { run = prev && addDays(prev, 1) === x ? run + 1 : 1; best = Math.max(best, run); prev = x; });
    var missed = 0, window30 = 0;
    if (dates.length) {
      var from = dates[0] > addDays(todayISO, -29) ? dates[0] : addDays(todayISO, -29);
      for (var x = from; x < todayISO; x = addDays(x, 1)) { window30++; if (!set[x]) missed++; }
    }
    return { current: cur, best: best, missed: missed, window: window30, doneToday: !!set[todayISO], first: dates[0] || null };
  }

  /* ---------- projection to exam day ---------- */
  function rates(D, todayISO) {
    var dates = activeDates(D);
    if (!dates.length) return null;
    var span = clamp(dayIndex(todayISO) - dayIndex(dates[0]) + 1, 1, 14), from = addDays(todayISO, -(span - 1));
    var h = 0, p = 0, q = 0;
    D.logs.forEach(function (l) { if (l.date >= from && l.date <= todayISO) { h += +l.hours || 0; p += +l.pyq || 0; q += +l.dpp || 0; } });
    var span2 = clamp(dayIndex(todayISO) - dayIndex(dates[0]) + 1, 1, 28), from2 = addDays(todayISO, -(span2 - 1));
    var mk = D.mocks.filter(function (m) { return m.type !== 'subject' && m.date >= from2; }).length;
    var rc = 0, rr = 0, keys = Object.keys(D.snap || {}).sort();
    var older = keys.filter(function (k) { return k < todayISO && k >= addDays(todayISO, -14); })[0];
    if (older && D.snap[todayISO]) {
      var n = dayIndex(todayISO) - dayIndex(older);
      if (n > 0) { rc = (D.snap[todayISO].cov - D.snap[older].cov) / n; rr = (D.snap[todayISO].rev - D.snap[older].rev) / n; }
    }
    return { hrs: h / span, pyq: p / span, dpp: q / span, mock: mk / span2, cov: Math.max(0, rc), rev: Math.max(0, rr) };
  }
  function project(D, todayISO) {
    var ev = evaluate(D, todayISO), examDay = dayIndex(D.examDate, D.startDate), n = Math.max(0, examDay - ev.day);
    var frozen = rankFor(composite(ev.M).index, examDay);
    var r = rates(D, todayISO), pace = null;
    if (r) {
      var M2 = { cov: Math.min(1, ev.M.cov + r.cov * n), rev: Math.min(3, ev.M.rev + r.rev * n), pyq: Math.min(CEIL.pyq, ev.M.pyq + r.pyq * n),
        dpp: Math.min(CEIL.dpp, ev.M.dpp + r.dpp * n), mockN: ev.M.mockN + r.mock * n, mockS: ev.M.mockS, hrs: ev.M.hrs + r.hrs * n };
      pace = rankFor(composite(M2).index, examDay);
    }
    return { daysLeft: n, frozen: frozen, pace: pace, rates: r, frozenMarks: marksFor(frozen), paceMarks: pace ? marksFor(pace) : null };
  }

  /* ---------- ghost leaderboard ---------- */
  var GHOST_NAMES = ['Aarav_Heap', 'Ishita.OS', 'Kabir_ByteMe', 'Meera_Mutex', 'Rohan_DP', 'Sanya_NP', 'Tanay_Trie', 'Vihaan_RegEx', 'Zoya_Deadlock', 'Dev_BigO'];
  function rng(seedStr) {
    var h = 1779033703 ^ seedStr.length;
    for (var i = 0; i < seedStr.length; i++) { h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
    var a = h >>> 0;
    return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function ghostBoard(day, nowMs, hours) {
    var bucket = Math.floor(nowMs / ((hours || 3) * 3600000));
    var em = tierAt(TIERS[0], day), eIdx = composite(em).index;
    var list = GHOST_NAMES.map(function (name, i) {
      var r = rng(name + ':' + bucket), mult = 1.03 - 0.012 * i + (r() - 0.5) * 0.04;
      return { name: name, index: Math.min(100, eIdx * mult), mult: mult, hrs: em.hrs * mult, mocks: Math.round(em.mockN * mult),
        today: 6.5 + r() * 2, streak: Math.max(1, day - Math.floor(r() * 4)) };
    });
    list.sort(function (a, b) { return b.index - a.index; });
    return { list: list, elite: em, eliteIndex: eIdx };
  }

  var API = {
    START_DEFAULT: START_DEFAULT, EXAM_DEFAULT: EXAM_DEFAULT, FIELD: FIELD, QUALIFY: QUALIFY, REF_DAY: REF_DAY,
    SUBJECTS: SUBJECTS, TIERS: TIERS, WEIGHTS: WEIGHTS, CEIL: CEIL,
    parseISO: parseISO, dayIndex: dayIndex, addDays: addDays, tierAt: tierAt, composite: composite, rankFor: rankFor, marksFor: marksFor,
    newData: newData, derive: derive, userMetrics: userMetrics, evaluate: evaluate, streaks: streaks, project: project, rates: rates,
    ghostBoard: ghostBoard, logActive: logActive, activeDates: activeDates
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.GM = API;
})(typeof window !== 'undefined' ? window : globalThis);
