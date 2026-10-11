/* GATE CSE Rank Tracker - UI + storage. Scoring lives in model.js (GM). */
(function () {
  'use strict';
  var G = window.GM;
  var KEY = 'gateRank_v1', BAK = 'gateRank_v1_bak', SNAP = 'gateRank_snap_';
  var D = null, storageOK = true, persisted = null, lastSavedAt = 0, loadedFrom = 'new';
  var openSub = {}, fieldMode = 'today', current = 'rank';
  var $ = function (id) { return document.getElementById(id); };

  /* ---------------- helpers ---------------- */
  function todayISO() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function fmt(n) { return Math.round(n).toLocaleString('en-IN'); }
  function f1(n) { return (Math.round(n * 10) / 10).toFixed(1); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function subName(id) { var s = G.SUBJECTS.filter(function (x) { return x.id === id; })[0]; return s ? s.name : id; }
  function subOpts(sel, blank) {
    return (blank ? '<option value="">' + esc(blank) + '</option>' : '') + G.SUBJECTS.map(function (s) {
      return '<option value="' + s.id + '"' + (s.id === sel ? ' selected' : '') + '>' + esc(s.name) + '</option>';
    }).join('');
  }
  function prettyDate(iso) { if (!iso) return '-'; var p = iso.split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }

  /* ---------------- storage (local first, never overwrite with empty) ---------------- */
  function normalize(x) {
    var base = G.newData(), out = Object.assign(base, x || {});
    out.subjects = base.subjects.map(function (b) {
      var found = ((x && x.subjects) || []).filter(function (s) { return s.id === b.id; })[0];
      return Object.assign({}, b, found || {});
    });
    ['logs', 'mocks'].forEach(function (k) { if (!Array.isArray(out[k])) out[k] = []; });
    ['rankHist', 'snap'].forEach(function (k) { if (!out[k] || typeof out[k] !== 'object') out[k] = {}; });
    return out;
  }
  function tryParse(raw) {
    try { var x = JSON.parse(raw); if (x && x.v && Array.isArray(x.subjects)) return x; } catch (e) { /* ignore */ }
    return null;
  }
  function loadLocal() {
    var keys = [KEY, BAK], i, raw, x;
    try {
      var snaps = [];
      for (i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k && k.indexOf(SNAP) === 0) snaps.push(k); }
      snaps.sort().reverse(); keys = keys.concat(snaps);
      for (i = 0; i < keys.length; i++) {
        raw = localStorage.getItem(keys[i]);
        if (raw && (x = tryParse(raw))) { loadedFrom = keys[i]; return normalize(x); }
      }
    } catch (e) { storageOK = false; }
    return null;
  }
  function saveLocal(stamp) {
    if (stamp !== false) D.updatedAt = Date.now();
    var raw = JSON.stringify(D);
    try {
      var prev = localStorage.getItem(KEY);
      if (prev && prev !== raw) localStorage.setItem(BAK, prev);
      localStorage.setItem(KEY, raw);
      var sk = SNAP + todayISO();
      if (!localStorage.getItem(sk)) {
        localStorage.setItem(sk, raw);
        var all = []; for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k && k.indexOf(SNAP) === 0) all.push(k); }
        all.sort(); while (all.length > 7) localStorage.removeItem(all.shift());
      }
      storageOK = true; lastSavedAt = Date.now();
    } catch (e) { storageOK = false; }
  }
  function requestPersist() {
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().then(function (p) { persisted = p; updateChip(); }).catch(function () { persisted = false; });
    }
  }

  /* ---------------- optional cloud sync (Firebase), same idea as the old tracker ---------------- */
  var cloud = { db: null, user: null, timer: null, msg: '' };
  function cloudConfigured() {
    var c = window.FIREBASE_CONFIG;
    return !!(c && c.apiKey && c.projectId && String(c.apiKey).indexOf('PASTE_') < 0 && typeof firebase !== 'undefined');
  }
  function cloudInit() {
    if (!cloudConfigured()) return;
    try {
      firebase.initializeApp(window.FIREBASE_CONFIG);
      cloud.db = firebase.firestore();
      firebase.auth().onAuthStateChanged(function (u) {
        cloud.user = u;
        if (u) cloudPull(); else { cloud.msg = 'Signed out'; renderIf('settings'); updateChip(); }
      });
    } catch (e) { cloud.msg = 'Cloud unavailable'; }
  }
  function cloudRef() { return cloud.db.collection('gateRankTracker').doc(cloud.user.uid); }
  function cloudPull() {
    cloudRef().get().then(function (snap) {
      if (snap.exists) {
        var x = snap.data(), remote = tryParse(x.data || '');
        if (remote && (x.updatedAtMs || 0) > (D.updatedAt || 0)) {
          D = normalize(remote); saveLocal(false); cloud.msg = 'Loaded newer data from cloud'; renderAll();
        } else { cloudPushNow(); }
      } else { cloudPushNow(); }
      updateChip(); renderIf('settings');
    }).catch(function () { cloud.msg = 'Cloud read failed (local data is safe)'; updateChip(); });
  }
  function cloudPushNow() {
    if (!cloud.user) return;
    cloudRef().set({ data: JSON.stringify(D), updatedAtMs: D.updatedAt }).then(function () { cloud.msg = 'Synced ' + new Date().toLocaleTimeString(); updateChip(); renderIf('settings'); })
      .catch(function () { cloud.msg = 'Cloud save failed (local data is safe)'; updateChip(); });
  }
  function cloudPush() { if (!cloud.user) return; clearTimeout(cloud.timer); cloud.timer = setTimeout(cloudPushNow, 1500); }

  /* ---------------- evaluation ---------------- */
  function evalNow() {
    var t = todayISO(), ev = G.evaluate(D, t);
    D.rankHist[t] = ev.rank; D.snap[t] = { cov: ev.M.cov, rev: ev.M.rev };
    return ev;
  }
  function commit(rerender) {
    evalNow(); saveLocal(); cloudPush(); updateChip(); updateHeader();
    if (rerender !== false) renderCurrent();
  }
  function hasData() {
    return D.logs.length > 0 || D.mocks.length > 0 || num(D.hoursBase) > 0 || D.subjects.some(function (s) { return num(s.cov) > 0 || num(s.pyqBase) > 0 || num(s.dppBase) > 0 || num(s.revBase) > 0; });
  }

  /* ---------------- header / chip / banners ---------------- */
  function updateChip() {
    var c = $('saveChip');
    if (!storageOK) { c.className = 'chip bad'; c.textContent = 'NOT SAVING: browser blocks storage'; return; }
    var t = lastSavedAt ? new Date(lastSavedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    c.className = 'chip ok';
    c.textContent = 'saved on this phone' + (t ? ' · ' + t : '') + (cloud.user ? ' · cloud on' : '');
  }
  function updateHeader() {
    var left = G.dayIndex(D.examDate, D.startDate) - G.dayIndex(todayISO(), D.startDate);
    $('daysLeft').textContent = Math.max(0, left);
    $('setupBanner').hidden = hasData();
    var b = $('backupBanner');
    if (hasData() && Date.now() - (D.lastExport || 0) > 7 * 86400000) {
      var d = D.lastExport ? Math.floor((Date.now() - D.lastExport) / 86400000) + ' days' : 'ever';
      b.hidden = false;
      b.innerHTML = 'No backup file in ' + d + '. Open the <a href="#" data-go="settings">Data tab</a> and export one, so a cleared browser cannot wipe your progress.';
    } else b.hidden = true;
  }

  /* ---------------- RANK view ---------------- */
  function metricRows(ev, ghost, exam) {
    var M = ev.M, E = ghost.elite, X = exam;
    return [
      { k: 'cov', label: 'Syllabus covered', me: M.cov * 100, el: E.cov * 100, ex: X.cov * 100, unit: '%', per: null },
      { k: 'rev', label: 'Revision passes', me: M.rev, el: E.rev, ex: X.rev, unit: '', dec: 1, per: null },
      { k: 'pyq', label: 'PYQs solved', me: M.pyq, el: E.pyq, ex: X.pyq, unit: '', per: 'per day' },
      { k: 'dpp', label: 'DPP questions', me: M.dpp, el: E.dpp, ex: X.dpp, unit: '', per: 'per day' },
      { k: 'mockN', label: 'Full mocks', me: M.mockN, el: E.mockN, ex: X.mockN, unit: '', per: 'per week' },
      { k: 'mockS', label: 'Mock score (last 5 avg)', me: M.mockS, el: E.mockS, ex: X.mockS, unit: '/100', dec: 1, per: null },
      { k: 'hrs', label: 'Study hours', me: M.hrs, el: E.hrs, ex: X.hrs, unit: 'h', per: 'h/day' }
    ];
  }

  function trendChart(hist) {
    var keys = Object.keys(hist).sort().slice(-60);
    if (keys.length < 2) return '<p class="faint">The trend line appears after your rank is recorded on two different days. Open the app daily.</p>';
    var W = 320, H = 140, pl = 8, pr = 8, pt = 12, pb = 22, vals = keys.map(function (k) { return hist[k]; });
    var lo = Math.log10(Math.max(1, Math.min.apply(null, vals.concat([G.QUALIFY])) / 1.4)), hi = Math.log10(Math.max.apply(null, vals.concat([G.QUALIFY])) * 1.3);
    function y(v) { return pt + (Math.log10(v) - lo) / (hi - lo) * (H - pt - pb); }
    function x(i) { return pl + i / (keys.length - 1) * (W - pl - pr); }
    var pts = vals.map(function (v, i) { return x(i).toFixed(1) + ',' + y(v).toFixed(1); }).join(' ');
    var qy = y(G.QUALIFY).toFixed(1);
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Rank over time">' +
      '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + qy + '" y2="' + qy + '" stroke="#5BC98A" stroke-dasharray="4 4" stroke-width="1"/>' +
      '<text x="' + (W - pr) + '" y="' + (+qy - 4) + '" text-anchor="end" font-size="9" fill="#5BC98A">40,000 qualifier line</text>' +
      '<polyline points="' + pts + '" fill="none" stroke="#E5566D" stroke-width="2" stroke-linejoin="round"/>' +
      '<text x="' + pl + '" y="' + (H - 6) + '" font-size="9" fill="#5C6772">' + prettyDate(keys[0]) + '</text>' +
      '<text x="' + (W - pr) + '" y="' + (H - 6) + '" font-size="9" fill="#5C6772" text-anchor="end">' + prettyDate(keys[keys.length - 1]) + '</text>' +
      '<text x="' + pl + '" y="9" font-size="9" fill="#5C6772">better rank is higher up</text></svg>';
  }

  function renderRank() {
    var t = todayISO(), ev = evalNow(), P = G.project(D, t), S = G.streaks(D, t), day = ev.day;
    var rank = ev.rank, empty = !hasData();
    var cls = rank <= G.QUALIFY ? 'green' : rank <= 100000 ? 'amber' : 'red';
    var examDay = G.dayIndex(D.examDate, D.startDate);
    var gb = G.ghostBoard(day, Date.now(), 3), exam = G.tierAt(G.TIERS[0], examDay);
    var tomorrow = G.rankFor(ev.index, day + 1), drift = Math.max(0, tomorrow - rank);
    var prevKey = Object.keys(D.rankHist).sort().filter(function (k) { return k < t; }).pop();
    var since = prevKey ? rank - D.rankHist[prevKey] : null;
    var rows = metricRows(ev, gb, exam);

    var verdict;
    if (empty) verdict = 'No data entered. You are ranked last until you add your progress.';
    else if (rank <= G.QUALIFY) verdict = 'Inside the qualifying line by ' + fmt(G.QUALIFY - rank) + ' ranks. The field is still moving; this is not safe yet.';
    else verdict = fmt(rank - G.QUALIFY) + ' ranks outside the qualifying line.';

    var weakest = rows.map(function (r) { return { r: r, ratio: r.el > 0 ? r.me / r.el : 1 }; }).sort(function (a, b) { return a.ratio - b.ratio; })[0];

    var html = '<div class="panel hero">' +
      '<div class="lab">Estimated rank today · day ' + day + ' of ' + examDay + '</div>' +
      '<div class="big ' + cls + '">' + fmt(rank) + '</div>' +
      '<div class="verdict">' + esc(verdict) + '</div>' +
      '<div class="kv">' +
      '<div><b>' + f1(ev.marks) + '/100</b><span>est. marks if exam were today (last year cutoff: 30)</span></div>' +
      '<div><b>' + f1(ev.index) + '</b><span>readiness index (top 10 today: ' + f1(gb.eliteIndex) + ')</span></div>' +
      '</div>';
    if (!empty) {
      html += '<div class="cost"><b>' + (S.doneToday ? 'Logged today.' : 'Nothing logged today.') + '</b> ' +
        'Standing still costs you about <b>' + fmt(drift) + ' ranks</b> per day right now, because the whole field moves forward every day.' +
        (since !== null ? ' Since ' + prettyDate(prevKey) + ': ' + (since > 0 ? '<b>▼ lost ' + fmt(since) + '</b>' : since < 0 ? '<span style="color:var(--green)">▲ gained ' + fmt(-since) + '</span>' : 'no change') + ' ranks.' : '') +
        '</div>';
    }
    html += '</div>';

    /* leaderboard */
    html += '<div class="panel"><h2>Leaderboard <small>top 10 reshuffle every 3 hours</small></h2><div class="scroll"><table class="lb"><thead><tr><th>#</th><th>Name</th><th>Index</th><th>Hours</th><th>Mocks</th></tr></thead><tbody>';
    gb.list.forEach(function (g, i) {
      html += '<tr><td>' + (i + 1) + '</td><td>' + esc(g.name) + '</td><td>' + f1(g.index) + '</td><td>' + fmt(g.hrs) + '</td><td>' + g.mocks + '</td></tr>';
    });
    html += '<tr class="me ' + (rank <= G.QUALIFY ? 'in' : '') + '"><td>' + fmt(rank) + '</td><td>You</td><td>' + f1(ev.index) + '</td><td>' + fmt(ev.M.hrs) + '</td><td>' + ev.M.mockN + '</td></tr>';
    html += '</tbody></table></div>' +
      '<p class="faint" style="margin-top:8px">The ghosts study ' + f1(gb.list[0].today) + ' to ' + f1(gb.list[gb.list.length - 1].today + 0) + ' hours a day, have 0 missed days, and are simulated from topper timetables.</p></div>';

    /* you vs topper */
    html += '<div class="panel"><h2>You vs the topper <small>topper level today, day ' + day + '</small></h2>';
    rows.forEach(function (r) {
      var pct = r.el > 0 ? Math.min(100, r.me / r.el * 100) : 100, behind = r.el - r.me, dec = r.dec || 0;
      var show = function (v) { return (dec ? f1(v) : fmt(v)) + (r.unit && r.unit !== 'h' ? r.unit : ''); };
      var catchup = '';
      if (behind > 0 && r.per) {
        var need = r.ex - r.me, n = Math.max(1, P.daysLeft);
        if (need > 0) {
          var perDay = r.per === 'per week' ? need / n * 7 : need / n;
          catchup = ' To reach the topper\'s exam-day total (' + (dec ? f1(r.ex) : fmt(r.ex)) + (r.unit === 'h' ? 'h' : '') + ') you need ' + (r.k === 'hrs' ? f1(perDay) : r.k === 'mockN' ? f1(perDay) : fmt(perDay)) + ' ' + (r.per === 'h/day' ? 'hours per day' : r.per === 'per week' ? 'mocks per week' : (r.k === 'pyq' ? 'PYQs' : 'DPP questions') + ' per day') + ', every day.';
        }
      }
      html += '<div class="cmp"><div class="top"><span>' + r.label + '</span><span>you ' + show(r.me) + ' · topper ' + show(r.el) + '</span></div>' +
        '<div class="track"><i class="me" style="width:' + pct.toFixed(1) + '%"></i></div>' +
        (behind > 0.0001 ? '<div class="gap">Behind by ' + (dec ? f1(behind) : fmt(behind)) + (r.unit === 'h' ? 'h' : r.unit === '%' ? ' pts' : '') + ' (' + Math.round(pct) + '% of topper).' + esc(catchup) + '</div>' : '<div class="gap ok">At or above topper level.</div>') + '</div>';
    });
    if (!empty && weakest) html += '<p class="muted"><b>Weakest area:</b> ' + weakest.r.label + ' at ' + Math.round(weakest.ratio * 100) + '% of the topper.</p>';
    html += '</div>';

    /* projection */
    html += '<div class="panel"><h2>Where you land on exam day <small>' + P.daysLeft + ' days left</small></h2>' +
      '<div class="kv"><div><b style="color:var(--red)">' + fmt(P.frozen) + '</b><span>if you stop today (≈ ' + f1(P.frozenMarks) + ' marks)</span></div>' +
      '<div><b>' + (P.pace ? fmt(P.pace) : 'n/a') + '</b><span>' + (P.pace ? 'at your current pace (≈ ' + f1(P.paceMarks) + ' marks)' : 'log a day to see your pace') + '</span></div></div>' +
      '<p class="faint" style="margin-top:8px">Pace uses your last 14 days of logs (hours, PYQs, DPPs, mocks) and your recent coverage and revision growth.</p></div>';

    /* consistency */
    html += '<div class="panel"><h2>Consistency</h2><div class="row3 kv" style="grid-template-columns:repeat(3,1fr)">' +
      '<div><b>' + S.current + '</b><span>day streak</span></div><div><b>' + S.best + '</b><span>best streak</span></div>' +
      '<div><b style="color:' + (S.missed ? 'var(--red)' : 'var(--green)') + '">' + S.missed + '</b><span>missed in last ' + (S.window || 0) + ' days</span></div></div></div>';

    html += '<div class="panel"><h2>Rank over time</h2>' + trendChart(D.rankHist) + '</div>';
    $('view-rank').innerHTML = html;
  }

  /* ---------------- LOG view ---------------- */
  function renderLog() {
    var t = todayISO(), today = D.logs.filter(function (l) { return l.date === t; });
    var th = 0, tp = 0, td = 0; today.forEach(function (l) { th += num(l.hours); tp += num(l.pyq); td += num(l.dpp); });
    var recent = D.logs.slice().sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : (a.id < b.id ? 1 : -1); }).slice(0, 25);
    var html = '<div class="panel"><h2>Add a study entry <small>today: ' + f1(th) + 'h · ' + tp + ' PYQ · ' + td + ' DPP</small></h2>' +
      '<label>Date<input type="date" id="lgDate" value="' + t + '" max="' + t + '"></label>' +
      '<label>Hours studied<input type="number" id="lgHours" inputmode="decimal" step="0.25" min="0" max="24" placeholder="0"></label>' +
      '<div class="row2"><label>PYQs solved<input type="number" id="lgPyq" inputmode="numeric" min="0" placeholder="0"></label>' +
      '<label>Subject<select id="lgPyqSub">' + subOpts('', 'choose') + '</select></label></div>' +
      '<div class="row2"><label>DPP questions<input type="number" id="lgDpp" inputmode="numeric" min="0" placeholder="0"></label>' +
      '<label>Subject<select id="lgDppSub">' + subOpts('', 'choose') + '</select></label></div>' +
      '<label>Revised a subject today?<select id="lgRevSub">' + subOpts('', 'no') + '</select></label>' +
      '<label class="check"><input type="checkbox" id="lgRevFull"> That finished one full revision pass of the subject</label>' +
      '<div class="btns"><button class="btn" data-action="addLog">Save entry</button></div>' +
      '<p class="faint" style="margin-top:8px">PYQs and DPPs only count when you pick their subject. Entries add to your totals; deleting one removes it again.</p></div>';
    html += '<div class="panel"><h2>Recent entries</h2><div class="list">';
    if (!recent.length) html += '<p class="muted">Nothing logged yet. A day with no entry is a missed day.</p>';
    recent.forEach(function (l) {
      var bits = [];
      if (num(l.hours)) bits.push(f1(num(l.hours)) + 'h');
      if (num(l.pyq)) bits.push(l.pyq + ' PYQ ' + subName(l.pyqSub));
      if (num(l.dpp)) bits.push(l.dpp + ' DPP ' + subName(l.dppSub));
      if (l.revSub) bits.push('revised ' + subName(l.revSub) + (l.revFull ? ' (full pass)' : ''));
      html += '<div class="item"><div>' + prettyDate(l.date) + '<small>' + esc(bits.join(' · ') || 'empty') + '</small></div><button class="x" data-action="delLog" data-id="' + l.id + '">delete</button></div>';
    });
    html += '</div></div>';
    $('view-log').innerHTML = html;
  }
  function addLog() {
    var l = {
      id: uid(), date: $('lgDate').value || todayISO(), hours: num($('lgHours').value), pyq: Math.round(num($('lgPyq').value)), pyqSub: $('lgPyqSub').value,
      dpp: Math.round(num($('lgDpp').value)), dppSub: $('lgDppSub').value, revSub: $('lgRevSub').value, revFull: $('lgRevFull').checked
    };
    if (l.pyq && !l.pyqSub) return toast('Pick a subject for the PYQs, or set PYQs to 0.');
    if (l.dpp && !l.dppSub) return toast('Pick a subject for the DPPs, or set DPPs to 0.');
    if (!G.logActive(l)) return toast('Enter hours, PYQs, DPPs or a revision first.');
    if (l.hours > 24) return toast('Hours cannot be more than 24.');
    D.logs.push(l); commit(); toast('Saved. Rank updated.');
  }

  /* ---------------- MOCKS view ---------------- */
  function renderMocks() {
    var t = todayISO(), dv = G.derive(D), full = dv.fullMocks;
    var avg = full.length ? full.reduce(function (a, m) { return a + num(m.score); }, 0) / full.length : 0;
    var list = D.mocks.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    var html = '<div class="panel"><h2>Add a mock or test <small>' + full.length + ' full mocks · avg ' + f1(avg) + '</small></h2>' +
      '<div class="row2"><label>Date<input type="date" id="mkDate" value="' + t + '" max="' + t + '"></label>' +
      '<label>Score out of 100<input type="number" id="mkScore" inputmode="decimal" step="0.01" min="-20" max="100" placeholder="e.g. 34.5"></label></div>' +
      '<div class="row2"><label>Type<select id="mkType"><option value="full">Full-length mock</option><option value="subject">Subject test</option></select></label>' +
      '<label>Subject (subject tests)<select id="mkSub">' + subOpts('', 'n/a') + '</select></label></div>' +
      '<label>Note (optional)<input type="text" id="mkNote" placeholder="test series, mistakes..."></label>' +
      '<div class="btns"><button class="btn" data-action="addMock">Save mock</button></div>' +
      '<p class="faint" style="margin-top:8px">Only full-length mocks count toward your rank. The average of your last 5 is used, so one lucky score will not rescue you.</p></div>';
    html += '<div class="panel"><h2>History</h2><div class="list">';
    if (!list.length) html += '<p class="muted">No mocks yet. Toppers have about 12 by now and reach 25+ by exam day.</p>';
    list.forEach(function (m) {
      html += '<div class="item"><div>' + prettyDate(m.date) + ' · <b>' + m.score + '</b>/100<small>' + (m.type === 'subject' ? 'Subject test · ' + esc(subName(m.sub)) : 'Full mock') + (m.note ? ' · ' + esc(m.note) : '') + '</small></div>' +
        '<button class="x" data-action="delMock" data-id="' + m.id + '">delete</button></div>';
    });
    html += '</div></div>';
    $('view-mocks').innerHTML = html;
  }
  function addMock() {
    var sc = $('mkScore').value;
    if (sc === '' || !isFinite(parseFloat(sc))) return toast('Enter the score.');
    var m = { id: uid(), date: $('mkDate').value || todayISO(), score: Math.min(100, parseFloat(sc)), type: $('mkType').value, sub: $('mkSub').value, note: $('mkNote').value.trim() };
    if (m.type === 'subject' && !m.sub) return toast('Pick the subject for a subject test.');
    D.mocks.push(m); commit(); toast('Saved. Rank updated.');
  }

  /* ---------------- SUBJECTS view ---------------- */
  function renderSubjects() {
    var dv = G.derive(D), html = '<div class="panel"><h2>Subject setup <small>enter what you have done up to today</small></h2>' +
      '<p class="muted">Fill each subject once. After that, your daily log adds on top automatically. Coverage is the one number you set yourself, so be honest: 100% means you could solve its PYQs.</p></div>';
    G.SUBJECTS.forEach(function (S) {
      var s = D.subjects.filter(function (x) { return x.id === S.id; })[0], p = dv.per[S.id], open = openSub[S.id];
      var rdays = p.lastRev ? G.dayIndex(todayISO()) - G.dayIndex(p.lastRev) : null;
      html += '<div class="sub-card ' + (open ? 'open' : '') + '"><div class="hd" data-action="toggleSub" data-id="' + S.id + '"><div><div class="nm">' + esc(S.name) + '</div>' +
        '<div class="meta">' + S.marks + ' marks · ' + Math.round(num(s.cov)) + '% covered · ' + Math.round(p.pyq) + '/' + s.pyqTotal + ' PYQ · ' + p.rev + ' revisions' + (rdays !== null && rdays > 30 ? ' · stale' : '') + '</div></div><span class="pill">' + (open ? 'close' : 'edit') + '</span></div>' +
        '<div class="bd">' +
        '<div class="row2"><label>Coverage %<input type="number" inputmode="numeric" min="0" max="100" data-sub="' + S.id + '" data-f="cov" value="' + num(s.cov) + '"></label>' +
        '<label>Revision passes done<input type="number" inputmode="decimal" step="0.25" min="0" data-sub="' + S.id + '" data-f="revBase" value="' + num(s.revBase) + '"></label></div>' +
        '<div class="row2"><label>Started on<input type="date" data-sub="' + S.id + '" data-f="start" value="' + esc(s.start) + '"></label>' +
        '<label>Finished on<input type="date" data-sub="' + S.id + '" data-f="end" value="' + esc(s.end) + '"></label></div>' +
        '<label>Last revised on<input type="date" data-sub="' + S.id + '" data-f="lastRev" value="' + esc(s.lastRev) + '"></label>' +
        '<div class="row2"><label>PYQs done (before logging)<input type="number" inputmode="numeric" min="0" data-sub="' + S.id + '" data-f="pyqBase" value="' + num(s.pyqBase) + '"></label>' +
        '<label>PYQs total<input type="number" inputmode="numeric" min="0" data-sub="' + S.id + '" data-f="pyqTotal" value="' + num(s.pyqTotal) + '"></label></div>' +
        '<div class="row2"><label>DPP done (before logging)<input type="number" inputmode="numeric" min="0" data-sub="' + S.id + '" data-f="dppBase" value="' + num(s.dppBase) + '"></label>' +
        '<label>DPP total<input type="number" inputmode="numeric" min="0" data-sub="' + S.id + '" data-f="dppTotal" value="' + num(s.dppTotal) + '"></label></div>' +
        '<p class="faint">Including daily log: ' + Math.round(p.pyq) + ' PYQs, ' + Math.round(p.dpp) + ' DPPs, ' + p.tests + ' subject tests. Revision credit fades if you do not revisit the subject (last revised ' + (rdays === null ? 'never' : rdays + ' days ago') + ').</p>' +
        '</div></div>';
    });
    $('view-subjects').innerHTML = html;
  }

  /* ---------------- FIELD view ---------------- */
  function renderField() {
    var t = todayISO(), ev = G.evaluate(D, t), examDay = G.dayIndex(D.examDate, D.startDate);
    var day = fieldMode === 'exam' ? examDay : ev.day;
    var M = ev.M, rowsT = G.TIERS.map(function (tr) { var m = G.tierAt(tr, day); return { label: tr.label, rank: tr.rank, m: m, idx: G.composite(m).index }; });
    var html = '<div class="panel"><h2>The field <small>who is where</small></h2>' +
      '<div class="btns two"><button class="btn ' + (fieldMode === 'today' ? '' : 'ghost') + '" data-action="fieldMode" data-id="today">Today (day ' + ev.day + ')</button>' +
      '<button class="btn ' + (fieldMode === 'exam' ? '' : 'ghost') + '" data-action="fieldMode" data-id="exam">Exam day (' + examDay + ')</button></div>' +
      '<div class="scroll" style="margin-top:12px"><table class="tbl"><thead><tr><th>Tier</th><th>Syll.</th><th>Rev</th><th>PYQ</th><th>DPP</th><th>Mocks</th><th>Avg</th><th>Hrs</th><th>Index</th></tr></thead><tbody>';
    function row(label, m, idx, hl) {
      return '<tr class="' + (hl ? 'hl' : '') + '"><td>' + label + '</td><td>' + Math.round(m.cov * 100) + '%</td><td>' + f1(m.rev) + '</td><td>' + fmt(m.pyq) + '</td><td>' + fmt(m.dpp) + '</td><td>' + Math.round(m.mockN) + '</td><td>' + (m.mockN > 0 ? Math.round(m.mockS) : '-') + '</td><td>' + fmt(m.hrs) + '</td><td>' + f1(idx) + '</td></tr>';
    }
    rowsT.forEach(function (r) { html += row(r.label + ' (~' + fmt(r.rank) + ')', r.m, r.idx, false); });
    html += row('You now', M, ev.index, true) + '</tbody></table></div>' +
      '<p class="faint" style="margin-top:10px">Tier numbers are assumptions built from topper interviews and coaching study plans, calibrated to GATE 2026 CS (2.6 lakh registered, qualifying cutoff 30/100). They are not official data. After you enter real numbers we will recalibrate them in <b>model.js</b>.</p></div>';
    html += '<div class="panel"><h2>How the index is scored</h2><div class="list">' +
      Object.keys(G.WEIGHTS).map(function (k) {
        var nm = { cov: 'Syllabus coverage (weighted by marks)', rev: 'Revision passes (fade with neglect)', pyq: 'PYQs solved', dpp: 'DPP questions', mockN: 'Number of full mocks', mockS: 'Mock score, last 5 average', hrs: 'Total study hours' }[k];
        return '<div class="item"><div>' + nm + '</div><b>' + Math.round(G.WEIGHTS[k] * 100) + '%</b></div>';
      }).join('') + '</div><p class="faint" style="margin-top:8px">Your index is compared with the field\'s index on the same day of the year, which is why your rank falls every day you do not move.</p></div>';

    /* per-subject gaps */
    var dv = G.derive(D);
    html += '<div class="panel"><h2>Subject gaps</h2><div class="scroll"><table class="tbl"><thead><tr><th>Subject</th><th>Cov</th><th>PYQ</th><th>DPP</th><th>Rev</th><th>Last rev</th></tr></thead><tbody>';
    G.SUBJECTS.forEach(function (S) {
      var s = D.subjects.filter(function (x) { return x.id === S.id; })[0], p = dv.per[S.id], rd = p.lastRev ? G.dayIndex(t) - G.dayIndex(p.lastRev) : null;
      html += '<tr class="' + (num(s.cov) < 100 ? 'hl' : '') + '"><td>' + esc(S.name) + '</td><td>' + Math.round(num(s.cov)) + '%</td><td>' + Math.round(p.pyq / Math.max(1, num(s.pyqTotal)) * 100) + '%</td><td>' + Math.round(p.dpp / Math.max(1, num(s.dppTotal)) * 100) + '%</td><td>' + p.rev + '</td><td>' + (rd === null ? 'never' : rd + 'd ago') + '</td></tr>';
    });
    html += '</tbody></table></div><p class="faint" style="margin-top:8px">Amber rows are not fully covered. Toppers are at 100% coverage in every subject by October.</p></div>';
    $('view-field').innerHTML = html;
  }

  /* ---------------- SETTINGS / DATA view ---------------- */
  function renderSettings() {
    var html = '<div class="panel"><h2>Dates and base hours</h2>' +
      '<div class="row2"><label>Exam date<input type="date" id="stExam" value="' + esc(D.examDate) + '"></label>' +
      '<label>Race day 0 (start)<input type="date" id="stStart" value="' + esc(D.startDate) + '"></label></div>' +
      '<label>Total study hours before you started logging (rough estimate is fine)<input type="number" id="stHours" inputmode="numeric" min="0" value="' + num(D.hoursBase) + '"></label>' +
      '<p class="faint">Hours from daily entries are added on top of this number.</p></div>';

    html += '<div class="panel"><h2>Keep your data safe <small>this phone only</small></h2>' +
      '<div class="list"><div class="item"><div>Saved in this browser<small>' + (storageOK ? 'working' + (lastSavedAt ? ', last write ' + new Date(lastSavedAt).toLocaleTimeString() : '') : 'BLOCKED: turn off private mode or allow site data') + '</small></div><b style="color:' + (storageOK ? 'var(--green)' : 'var(--red)') + '">' + (storageOK ? 'OK' : 'FAIL') + '</b></div>' +
      '<div class="item"><div>Protected from auto-clean<small>' + (persisted === true ? 'browser granted persistent storage' : persisted === false ? 'not granted. Add to Home Screen and export a backup weekly' : 'checking...') + '</small></div><b>' + (persisted === true ? 'yes' : persisted === false ? 'no' : '?') + '</b></div>' +
      '<div class="item"><div>Last backup file<small>' + (D.lastExport ? new Date(D.lastExport).toLocaleString() : 'never') + '</small></div></div>' +
      '<div class="item"><div>Loaded from<small>' + esc(loadedFrom) + '</small></div></div></div>' +
      '<div class="btns two"><button class="btn" data-action="exportFile">Download backup</button><button class="btn ghost" data-action="copyBackup">Copy backup text</button></div>' +
      '<label style="margin-top:12px">Restore: paste backup text here<textarea id="impText" rows="3" placeholder="paste the copied backup, then tap Restore"></textarea></label>' +
      '<div class="btns two"><button class="btn ghost" data-action="importText">Restore from text</button><button class="btn ghost" data-action="importPick">Restore from file</button></div>' +
      '<input type="file" id="impFile" accept="application/json,.json" hidden>' +
      '<p class="faint" style="margin-top:8px"><b>Tip:</b> open the site in your phone browser and use Add to Home Screen. Your data is tied to the exact web address, so always open the same link. Browser "clear site data" erases it, which is why the backup exists.</p></div>';

    var cfg = cloudConfigured();
    html += '<div class="panel"><h2>Cloud sync <small>optional</small></h2>';
    if (!cfg) html += '<p class="muted">Off. Everything stays on this phone. To add a cloud copy later, paste your Firebase details into <b>firebase-config.js</b> (steps in README).</p>';
    else if (cloud.user) html += '<p class="muted">Signed in as ' + esc(cloud.user.email) + '. ' + esc(cloud.msg) + '</p><div class="btns"><button class="btn ghost" data-action="cloudOut">Sign out</button></div>';
    else html += '<label>Email<input type="email" id="clEmail" autocomplete="email"></label><label>Password<input type="password" id="clPass" autocomplete="current-password"></label>' +
      '<div class="btns two"><button class="btn" data-action="cloudIn">Sign in</button><button class="btn ghost" data-action="cloudUp">Create account</button></div><p class="faint">' + esc(cloud.msg) + '</p>';
    html += '</div>';

    html += '<div class="panel"><h2>Danger zone</h2><div class="btns"><button class="btn danger" data-action="resetAll">Erase everything on this phone</button></div></div>';
    $('view-settings').innerHTML = html;
  }

  /* ---------------- rendering control ---------------- */
  var RENDER = { rank: renderRank, log: renderLog, mocks: renderMocks, subjects: renderSubjects, field: renderField, settings: renderSettings };
  function renderCurrent() { RENDER[current](); }
  function renderIf(v) { if (current === v && RENDER[v]) RENDER[v](); }
  function renderAll() { updateHeader(); renderCurrent(); updateChip(); }
  function show(v) {
    current = v;
    Array.prototype.forEach.call(document.querySelectorAll('.view'), function (el) { el.classList.toggle('active', el.id === 'view-' + v); });
    Array.prototype.forEach.call(document.querySelectorAll('#tabbar button'), function (b) { b.classList.toggle('active', b.getAttribute('data-view') === v); });
    renderCurrent(); window.scrollTo(0, 0);
  }

  var toastTimer;
  function toast(msg) {
    var el = document.getElementById('toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; el.setAttribute('role', 'status'); el.style.cssText = 'position:fixed;left:12px;right:12px;bottom:calc(76px + env(safe-area-inset-bottom));background:#262e36;border:1px solid #3a4550;color:#e8ebee;padding:11px 14px;border-radius:10px;z-index:99;font-size:13px;text-align:center'; document.body.appendChild(el); }
    el.textContent = msg; el.style.display = 'block'; clearTimeout(toastTimer); toastTimer = setTimeout(function () { el.style.display = 'none'; }, 2800);
  }

  /* ---------------- backup actions ---------------- */
  function exportFile() {
    var blob = new Blob([JSON.stringify(D, null, 1)], { type: 'application/json' }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'gate-rank-backup-' + todayISO() + '.json'; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    D.lastExport = Date.now(); saveLocal(); updateHeader(); renderIf('settings'); toast('Backup downloaded.');
  }
  function copyBackup() {
    var text = JSON.stringify(D);
    var done = function () { D.lastExport = Date.now(); saveLocal(); updateHeader(); renderIf('settings'); toast('Backup copied. Paste it into Notes or WhatsApp-to-self.'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done).catch(function () { toast('Copy blocked. Use Download backup instead.'); });
    else toast('Copy not supported here. Use Download backup instead.');
  }
  function doImport(text) {
    var x = tryParse(text);
    if (!x) return toast('That is not a valid backup. Nothing was changed.');
    if (!window.confirm('Replace the data on this phone with this backup? The current data is kept as an automatic safety copy.')) return;
    D = normalize(x); D.updatedAt = Date.now(); saveLocal(false); commit(); toast('Backup restored.');
  }

  /* ---------------- events ---------------- */
  document.addEventListener('click', function (e) {
    var go = e.target.closest('[data-go]');
    if (go) { e.preventDefault(); show(go.getAttribute('data-go')); return; }
    var tb = e.target.closest('#tabbar button');
    if (tb) { show(tb.getAttribute('data-view')); return; }
    var a = e.target.closest('[data-action]'); if (!a) return;
    var act = a.getAttribute('data-action'), id = a.getAttribute('data-id');
    switch (act) {
      case 'addLog': addLog(); break;
      case 'delLog': if (window.confirm('Delete this entry?')) { D.logs = D.logs.filter(function (l) { return l.id !== id; }); commit(); } break;
      case 'addMock': addMock(); break;
      case 'delMock': if (window.confirm('Delete this mock?')) { D.mocks = D.mocks.filter(function (m) { return m.id !== id; }); commit(); } break;
      case 'toggleSub': openSub[id] = !openSub[id]; renderSubjects(); break;
      case 'fieldMode': fieldMode = id; renderField(); break;
      case 'exportFile': exportFile(); break;
      case 'copyBackup': copyBackup(); break;
      case 'importText': doImport($('impText').value); break;
      case 'importPick': $('impFile').click(); break;
      case 'cloudIn': firebase.auth().signInWithEmailAndPassword($('clEmail').value.trim(), $('clPass').value).catch(function (er) { cloud.msg = er.message; renderIf('settings'); }); break;
      case 'cloudUp': firebase.auth().createUserWithEmailAndPassword($('clEmail').value.trim(), $('clPass').value).catch(function (er) { cloud.msg = er.message; renderIf('settings'); }); break;
      case 'cloudOut': firebase.auth().signOut(); break;
      case 'resetAll':
        if (window.prompt('This erases ALL data on this phone. Type ERASE to confirm.') === 'ERASE') {
          D = G.newData(); saveLocal(); commit(); toast('Erased.');
        }
        break;
    }
  });

  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t.id === 'impFile' && t.files && t.files[0]) {
      var r = new FileReader(); r.onload = function () { doImport(String(r.result)); t.value = ''; }; r.readAsText(t.files[0]); return;
    }
    if (t.hasAttribute('data-sub')) {
      var s = D.subjects.filter(function (x) { return x.id === t.getAttribute('data-sub'); })[0], f = t.getAttribute('data-f');
      if (!s) return;
      if (t.type === 'date' || f === 'lastRev') s[f] = t.value; else s[f] = Math.max(0, num(t.value));
      if (f === 'cov') s.cov = Math.min(100, s.cov);
      commit(false); return;
    }
    if (t.id === 'stExam' && t.value) { D.examDate = t.value; commit(false); }
    if (t.id === 'stStart' && t.value) { D.startDate = t.value; commit(false); }
    if (t.id === 'stHours') { D.hoursBase = Math.max(0, num(t.value)); commit(false); }
  });

  /* keep the screen fresh when the phone comes back to the app (rank drifts with time) */
  document.addEventListener('visibilitychange', function () { if (!document.hidden && D) { commit(false); if (current === 'rank' || current === 'field') renderCurrent(); } });
  window.addEventListener('pagehide', function () { if (D) saveLocal(false); });

  /* ---------------- boot ---------------- */
  D = loadLocal() || normalize(null);
  if (loadedFrom === KEY || loadedFrom === 'new') { /* normal */ } else { setTimeout(function () { toast('Recovered your data from a safety copy (' + loadedFrom.replace('gateRank_', '') + ').'); }, 600); }
  requestPersist();
  evalNow();
  if (loadedFrom !== 'new' || hasData()) saveLocal(false); else saveLocal();
  renderAll();
  cloudInit();
})();
