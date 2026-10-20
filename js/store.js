// Learning state: spaced-repetition cards, daily stats and settings.
// Saved in two places so progress is never lost:
//   1. localStorage (instant, in this browser)
//   2. data/progress.json on disk via serve.ps1 (survives clearing the browser, works across browsers)
// On load the newer of the two copies wins.
window.Store = (function () {
  "use strict";

  const LS_KEY = "hsk1.state.v2";
  const OLD_KNOWN_KEY = "hsk1.known"; // v1 progress format
  const API = "/api/progress";
  const DAY = 86400000;

  const DEFAULT_SETTINGS = {
    lang: "de",
    theme: "auto",
    rate: 0.8,
    voice: "",
    autoplay: true,
    pinyinFront: true, // show pinyin together with the character on the front of a card
    direction: "h2m",
    newPerDay: 10,
    dailyGoal: 30,
    strictTones: true,
  };

  const pad = (n) => String(n).padStart(2, "0");
  const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const startOfDay = (t = Date.now()) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

  const fresh = () => ({ version: 2, updatedAt: 0, cards: {}, days: {}, settings: { ...DEFAULT_SETTINGS } });
  const newCard = () => ({ iv: 0, ef: 2.5, due: 0, reps: 0, lapses: 0, ok: 0, bad: 0, last: 0 });
  const emptyDay = () => ({ reviews: 0, correct: 0, newWords: 0, practice: 0, practiceCorrect: 0 });

  function normalize(s) {
    if (!s || typeof s !== "object" || s.version !== 2) return null;
    s.cards = s.cards || {};
    s.days = s.days || {};
    s.settings = { ...DEFAULT_SETTINGS, ...(s.settings || {}) };
    s.updatedAt = Number(s.updatedAt) || 0;
    return s;
  }

  let state = fresh();
  let status = "loading"; // loading | saving | saved-disk | saved-local | error
  let dirty = false;
  let pushTimer = null;
  const statusListeners = new Set();
  const externalListeners = new Set();

  function setStatus(s) {
    status = s;
    statusListeners.forEach((fn) => fn(s));
  }

  // ---------- persistence ----------
  function writeLocal() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); return true; } catch { return false; }
  }

  function migrateV1() {
    const s = fresh();
    try {
      const old = JSON.parse(localStorage.getItem(OLD_KNOWN_KEY)) || [];
      old.forEach((h) => { s.cards[h] = knownCard(); });
      if (old.length) s.updatedAt = Date.now();
    } catch { /* nothing to migrate */ }
    return s;
  }

  async function load() {
    let local = null;
    try { local = normalize(JSON.parse(localStorage.getItem(LS_KEY))); } catch { /* corrupt or unavailable */ }

    let remote = null;
    let serverOk = false;
    try {
      const r = await fetch(API, { cache: "no-store" });
      if (r.ok) { serverOk = true; remote = normalize(await r.json()); }
    } catch { /* server not running (e.g. opened as file://) */ }

    state = [local, remote].filter(Boolean).sort((a, b) => b.updatedAt - a.updatedAt)[0] || migrateV1();
    writeLocal();

    if (serverOk && (!remote || remote.updatedAt !== state.updatedAt)) {
      dirty = true;
      await push();
    } else {
      setStatus(serverOk ? "saved-disk" : "saved-local");
    }
  }

  async function push() {
    clearTimeout(pushTimer);
    setStatus("saving");
    try {
      const r = await fetch(API, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state),
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
      dirty = false;
      setStatus("saved-disk");
    } catch {
      setStatus(writeLocal() ? "saved-local" : "error");
    }
  }

  function save() {
    state.updatedAt = Date.now();
    const okLocal = writeLocal();
    dirty = true;
    setStatus(okLocal ? "saving" : "error");
    clearTimeout(pushTimer);
    pushTimer = setTimeout(push, 400);
  }

  // Retry unsaved changes, and flush them when the tab closes.
  setInterval(() => { if (dirty && status !== "saving") push(); }, 30000);
  window.addEventListener("pagehide", () => {
    if (!dirty) return;
    try { navigator.sendBeacon(API, new Blob([JSON.stringify(state)], { type: "application/json" })); } catch { /* best effort */ }
  });
  // Keep several open tabs in sync instead of overwriting each other.
  window.addEventListener("storage", (e) => {
    if (e.key !== LS_KEY || !e.newValue) return;
    try {
      const s = normalize(JSON.parse(e.newValue));
      if (s && s.updatedAt > state.updatedAt) { state = s; externalListeners.forEach((fn) => fn()); }
    } catch { /* ignore */ }
  });

  // ---------- spaced repetition (simplified SM-2) ----------
  // grade: 0 = again, 1 = hard, 2 = good, 3 = easy
  function knownCard() {
    return { ...newCard(), iv: 21, reps: 1, due: startOfDay() + 21 * DAY };
  }

  function next(c, grade) {
    if (grade === 0) return { iv: 0, ef: Math.max(1.3, c.ef - 0.2), due: Date.now() + 60 * 1000 };
    const ef = Math.max(1.3, c.ef + (grade === 1 ? -0.15 : grade === 3 ? 0.15 : 0));
    let iv;
    if (c.iv === 0) iv = grade === 3 ? 4 : 1;
    else iv = Math.max(c.iv + 1, Math.round(c.iv * (grade === 1 ? 1.2 : grade === 2 ? c.ef : c.ef * 1.3)));
    return { iv, ef, due: startOfDay() + iv * DAY };
  }

  const card = (h) => state.cards[h];
  const ensure = (h) => (state.cards[h] = state.cards[h] || newCard());
  const today = () => (state.days[dayKey()] = state.days[dayKey()] || emptyDay());

  function review(h, grade) {
    const c = ensure(h);
    const wasNew = c.reps === 0;
    if (grade === 0 && c.iv > 0) c.lapses++;
    Object.assign(c, next(c, grade));
    c.reps++;
    c.last = Date.now();
    grade > 0 ? c.ok++ : c.bad++;
    const d = today();
    d.reviews++;
    if (grade > 0) d.correct++;
    if (wasNew) d.newWords++;
    save();
  }

  // Answers from quiz, free practice and writing: count toward stats, don't reschedule.
  function practice(h, correct) {
    const c = ensure(h);
    correct ? c.ok++ : c.bad++;
    const d = today();
    d.practice++;
    if (correct) d.practiceCorrect++;
    save();
  }

  function setKnown(h, isKnown) {
    if (isKnown) {
      const old = card(h) || newCard();
      state.cards[h] = { ...knownCard(), ok: old.ok, bad: old.bad, lapses: old.lapses };
    } else {
      delete state.cards[h];
    }
    save();
  }

  const isNew = (h) => !card(h) || card(h).reps === 0;
  const isLearned = (h) => !isNew(h) && card(h).iv >= 1;
  const isMastered = (h) => !isNew(h) && card(h).iv >= 21;
  const isDue = (h) => !isNew(h) && card(h).due <= Date.now();
  function isDifficult(h) {
    const c = card(h);
    return !!c && (c.lapses > 0 || (c.bad > 0 && c.bad >= c.ok / 2));
  }
  function statusOf(h) {
    if (isNew(h)) return "new";
    if (isMastered(h)) return "mastered";
    if (isLearned(h)) return "learned";
    return "learning";
  }

  const dueWords = (words) => words.filter((w) => isDue(w.h)).sort((a, b) => card(a.h).due - card(b.h).due);
  const newRemainingToday = () => Math.max(0, state.settings.newPerDay - (state.days[dayKey()]?.newWords || 0));
  const preview = (h, grade) => next(card(h) || newCard(), grade);

  function streak() {
    const active = (k) => { const d = state.days[k]; return d && d.reviews + d.practice > 0; };
    const d = new Date();
    if (!active(dayKey(d))) d.setDate(d.getDate() - 1); // today doesn't break the streak yet
    let n = 0;
    while (active(dayKey(d))) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }

  function lastDays(n) {
    const out = [];
    const d = new Date();
    d.setDate(d.getDate() - (n - 1));
    for (let i = 0; i < n; i++) {
      const k = dayKey(d);
      out.push({ key: k, date: new Date(d), ...emptyDay(), ...(state.days[k] || {}) });
      d.setDate(d.getDate() + 1);
    }
    return out;
  }

  function forecast(words, n) {
    const base = startOfDay();
    const out = Array.from({ length: n }, () => 0);
    words.forEach((w) => {
      if (isNew(w.h)) return;
      const i = Math.max(0, Math.floor((card(w.h).due - base) / DAY));
      if (i < n) out[i]++;
    });
    return out;
  }

  function totals() {
    let answers = 0, correct = 0;
    Object.values(state.days).forEach((d) => {
      answers += (d.reviews || 0) + (d.practice || 0);
      correct += (d.correct || 0) + (d.practiceCorrect || 0);
    });
    return { answers, correct, days: Object.keys(state.days).length };
  }

  // ---------- settings & backup ----------
  const settings = () => state.settings;
  function set(key, value) { state.settings[key] = value; save(); }

  const exportJSON = () => JSON.stringify(state, null, 2);
  function importJSON(text) {
    const s = normalize(JSON.parse(text));
    if (!s) throw new Error("invalid");
    state = s;
    save();
  }
  function reset() {
    const keep = state.settings;
    state = fresh();
    state.settings = keep;
    save();
  }

  return {
    load, save, dayKey,
    onStatus: (fn) => statusListeners.add(fn),
    onExternalChange: (fn) => externalListeners.add(fn),
    get status() { return status; },
    card, review, practice, setKnown, preview,
    isNew, isLearned, isMastered, isDue, isDifficult, statusOf,
    dueWords, newRemainingToday, today, streak, lastDays, forecast, totals,
    settings, set, exportJSON, importJSON, reset,
  };
})();
