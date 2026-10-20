(function () {
  "use strict";

  const { WORDS, CATEGORIES } = window.HSK1;
  const S = window.Store;
  const app = document.getElementById("app");
  const catById = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));
  let cleanup = null; // per-view teardown (e.g. keyboard handlers)
  let mistakes = []; // words missed in the last quiz, for "practice mistakes"

  // ---------- helpers ----------
  const $ = (sel, el = document) => el.querySelector(sel);
  const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  let toastTimer;
  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 3000);
  }

  // ---------- i18n ----------
  const lang = () => S.settings().lang;
  function t(key, vars) {
    let s = window.I18N[lang()]?.[key] ?? window.I18N.en[key];
    if (s == null) { console.warn("[i18n] missing key:", key); return key; }
    if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
    return s;
  }
  const meaning = (w) => (lang() === "de" ? w.d : w.e);
  const catTitle = (c) => c.title[lang()] || c.title.en;

  function applyLang() {
    document.documentElement.lang = lang();
    document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
    renderStatus(S.status);
  }

  function applyTheme() {
    const th = S.settings().theme;
    if (th === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.dataset.theme = th;
  }

  // ---------- word sets ----------
  const STATUS_SETS = ["all", "new", "learned", "difficult"];
  function wordSet(id) {
    if (id === "new") return WORDS.filter((w) => !S.isLearned(w.h));
    if (id === "learned") return WORDS.filter((w) => S.isLearned(w.h));
    if (id === "difficult") return WORDS.filter((w) => S.isDifficult(w.h));
    if (id === "mistakes") return mistakes;
    if (catById[id]) return WORDS.filter((w) => w.c === id);
    return WORDS;
  }
  function setOptions(selected = "all") {
    const opt = (id, label) =>
      `<option value="${id}" ${id === selected ? "selected" : ""}>${esc(label)} (${wordSet(id).length})</option>`;
    return `<optgroup label="${esc(t("set.groupStatus"))}">
        ${STATUS_SETS.map((id) => opt(id, t("set." + id))).join("")}
        ${mistakes.length ? opt("mistakes", t("set.mistakes")) : ""}
      </optgroup>
      <optgroup label="${esc(t("set.groupLessons"))}">
        ${CATEGORIES.map((c, i) => opt(c.id, `${i + 1}. ${catTitle(c)}`)).join("")}
      </optgroup>`;
  }

  // ---------- speech ----------
  const hasSpeech = "speechSynthesis" in window;
  let voices = [];
  let warnedNoVoice = false;
  function loadVoices() {
    voices = hasSpeech ? speechSynthesis.getVoices().filter((v) => /^(zh|cmn)/i.test(v.lang)) : [];
  }
  function currentVoice() {
    const pref = S.settings().voice;
    return voices.find((v) => v.voiceURI === pref) || voices.find((v) => /zh[-_]CN/i.test(v.lang)) || voices[0] || null;
  }
  if (hasSpeech) {
    loadVoices();
    speechSynthesis.onvoiceschanged = loadVoices;
  }
  function speak(text) {
    if (!hasSpeech) return toast(t("speech.unsupported"));
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "zh-CN";
    u.rate = Number(S.settings().rate) || 0.8;
    const v = currentVoice();
    if (v) u.voice = v;
    speechSynthesis.speak(u);
    if (!v && !warnedNoVoice) {
      warnedNoVoice = true;
      toast(t("speech.noVoice"));
    }
  }

  // ---------- pinyin tools ----------
  const TONE_MARKS = ["̄", "́", "̌", "̀"]; // tones 1-4 as combining marks

  // -> { letters, tones } so "nǐ hǎo", "ni3 hao3" and "ni3hao3" compare equal
  function parsePinyin(s) {
    const nfd = s.toLowerCase().normalize("NFD").replace(/ü/g, "v");
    let letters = "";
    const tones = [];
    for (const ch of nfd) {
      const mark = TONE_MARKS.indexOf(ch);
      if (mark >= 0) tones.push(mark + 1);
      else if (ch >= "1" && ch <= "4") tones.push(Number(ch));
      else if (ch >= "a" && ch <= "z") letters += ch;
    }
    return { letters: letters.replace(/v/g, "u"), tones };
  }

  function checkPinyin(input, target, strictTones) {
    const a = parsePinyin(input), b = parsePinyin(target);
    if (a.letters !== b.letters) return { ok: false };
    if (!strictTones) return { ok: true };
    return { ok: a.tones.join() === b.tones.join(), tonesWrong: a.tones.join() !== b.tones.join() };
  }

  // Same syllables, different tone marks: "nǐ" -> ["nī", "ní", "nì"]
  function toneVariants(p, n) {
    const chars = [...p.normalize("NFD")];
    const pos = chars.map((ch, i) => (TONE_MARKS.includes(ch) ? i : -1)).filter((i) => i >= 0);
    const target = pos.map((i) => TONE_MARKS.indexOf(chars[i]));
    const out = new Set();
    for (let guard = 0; out.size < n && guard < 300; guard++) {
      const tones = pos.map(() => Math.floor(Math.random() * 4));
      if (tones.every((x, j) => x === target[j])) continue;
      const c = chars.slice();
      pos.forEach((i, j) => { c[i] = TONE_MARKS[tones[j]]; });
      out.add(c.join("").normalize("NFC"));
    }
    return [...out];
  }
  const hasToneMarks = (p) => [...p.normalize("NFD")].some((ch) => TONE_MARKS.includes(ch));

  // ---------- save status ----------
  function renderStatus(st) {
    const el = $("#saveStatus");
    if (!el) return;
    const icons = { loading: "…", saving: "⟳", "saved-disk": "✓", "saved-local": "⚠", error: "✕" };
    el.className = "save-status " + st;
    el.textContent = `${icons[st] || ""} ${t("status." + st)}`;
    el.title = t("status." + st + ".tip");
  }

  // ---------- shared components ----------
  function progressBar(done, total, extraClass = "") {
    const pct = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
    return `<div class="progress ${extraClass}" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><div class="progress-fill" style="width:${pct}%"></div></div>`;
  }
  const tile = (value, label) => `<div class="tile"><div class="tile-value">${value}</div><div class="tile-label">${esc(label)}</div></div>`;
  const badge = (h) => { const st = S.statusOf(h); return `<span class="badge ${st}">${t("wstatus." + st)}</span>`; };

  function fmtInterval(p) {
    if (p.iv === 0) return t("iv.min");
    if (p.iv < 31) return t("iv.days", { n: p.iv });
    return t("iv.months", { n: Math.round(p.iv / 30) });
  }

  function wordCard(w) {
    const learned = S.isLearned(w.h);
    return `<div class="word ${S.statusOf(w.h)}">
      ${badge(w.h)}
      <button class="hanzi" data-speak="${esc(w.h)}" title="${esc(t("common.listen"))}">${esc(w.h)}</button>
      <div class="pinyin">${esc(w.p)}</div>
      <div class="meaning">${esc(meaning(w))}</div>
      <label class="chk"><input type="checkbox" data-known="${esc(w.h)}" ${learned ? "checked" : ""}> ${t("word.known")}</label>
    </div>`;
  }

  function sentenceRow(s) {
    return `<li class="sentence">
      <button class="icon-btn" data-speak="${esc(s.h)}" aria-label="${esc(t("common.listen"))}">🔊</button>
      <div><div class="s-hanzi">${esc(s.h)}</div><div class="pinyin">${esc(s.p)}</div><div class="muted">${esc(lang() === "de" ? s.d : s.e)}</div></div>
    </li>`;
  }

  function onKeys(handler) {
    const fn = (e) => {
      if (e.target.matches("input, select, textarea") || e.ctrlKey || e.metaKey || e.altKey) return;
      handler(e);
    };
    document.addEventListener("keydown", fn);
    cleanup = () => document.removeEventListener("keydown", fn);
  }

  // ---------- views ----------
  const views = {};

  views.home = function () {
    const due = S.dueWords(WORDS).length;
    const newAvail = Math.min(S.newRemainingToday(), WORDS.filter((w) => S.isNew(w.h)).length);
    const d = S.today();
    const activity = d.reviews + d.practice;
    const goal = Number(S.settings().dailyGoal) || 1;
    const learned = WORDS.filter((w) => S.isLearned(w.h)).length;
    const mastered = WORDS.filter((w) => S.isMastered(w.h)).length;
    const card = (href, glyph, key) =>
      `<a class="card link-card" href="${href}"><span class="card-glyph">${glyph}</span><h3>${t(key + ".title")}</h3><p class="muted small">${t(key + ".text")}</p></a>`;

    app.innerHTML = `
      <section class="hero">
        <h1>${t("home.title")}</h1>
        <p class="lead">${t("home.lead")}</p>
      </section>

      <section class="card today">
        <h2>${t("home.today")}</h2>
        <div class="tiles">
          ${tile(due, t("home.due"))}
          ${tile(newAvail, t("home.new"))}
          ${tile("🔥 " + S.streak(), t("home.streak"))}
          ${tile(`${activity} / ${goal}`, t("home.goal"))}
        </div>
        ${progressBar(activity, goal)}
        <div class="row">
          ${due + newAvail > 0
            ? `<a class="btn primary big" href="#/study">${t("home.start", { n: due + newAvail })}</a>`
            : `<span class="ok">${t("home.allDone")}</span><a class="btn" href="#/study/free">${t("home.free")}</a>`}
        </div>
      </section>

      <section>
        <h2>${t("home.overall")}</h2>
        ${progressBar(learned, WORDS.length)}
        <p class="muted small">${t("home.learnedOf", { n: learned, total: WORDS.length, m: mastered })}</p>
      </section>

      <div class="grid cards">
        ${card("#/pinyin", "ā", "home.c.pinyin")}
        ${card("#/lessons", "课", "home.c.lessons")}
        ${card("#/study/free", "卡", "home.c.free")}
        ${card("#/quiz", "考", "home.c.quiz")}
        ${card("#/write", "写", "home.c.write")}
        ${card("#/vocab", "词", "home.c.vocab")}
        ${card("#/stats", "📈", "home.c.stats")}
        ${card("#/settings", "⚙", "home.c.settings")}
      </div>`;
  };

  views.pinyin = function () {
    const tones = [["mā", "妈", 1], ["má", "麻", 2], ["mǎ", "马", 3], ["mà", "骂", 4], ["ma", "吗", 5]];
    app.innerHTML = `
      <h1>${t("pinyin.title")}</h1>
      <p class="lead">${t("pinyin.lead")}</p>

      <h2>${t("pinyin.tonesTitle")}</h2>
      <div class="grid tones">
        ${tones.map(([p, h, n]) => `
          <button class="card tone" data-speak="${h}">
            <span class="tone-py">${p}</span><span class="tone-hz">${h}</span>
            <span>${t("pinyin.tone" + n)}</span><span class="muted small">${t("pinyin.tone" + n + "m")}</span>
          </button>`).join("")}
      </div>
      <p class="muted small">${t("pinyin.clickHint")}</p>

      <h2>${t("pinyin.syllableTitle")}</h2>
      <div class="card">
        <p><b>${t("pinyin.initials")}</b></p>
        <p class="mono">b p m f · d t n l · g k h · j q x · zh ch sh r · z c s · y w</p>
        <p><b>${t("pinyin.finals")}</b></p>
        <p class="mono">a o e i u ü · ai ei ao ou · an en ang eng ong · ia ie iao iu ian in iang ing · ua uo uai ui uan un uang · üe üan ün</p>
        <p class="muted small">${t("pinyin.tricky")}</p>
      </div>

      <h2>${t("pinyin.sandhiTitle")}</h2>
      <ul class="sentences">
        ${sentenceRow({ h: "你好", p: "nǐ + hǎo → ní hǎo", e: t("pinyin.sandhi1"), d: t("pinyin.sandhi1") })}
        ${sentenceRow({ h: "不是", p: "bù + shì → bú shì", e: t("pinyin.sandhi2"), d: t("pinyin.sandhi2") })}
        ${sentenceRow({ h: "一个", p: "yī + gè → yí ge", e: t("pinyin.sandhi3"), d: t("pinyin.sandhi3") })}
      </ul>

      <h2>${t("pinyin.typeTitle")}</h2>
      <p>${t("pinyin.typeText")}</p>

      <div class="row"><a class="btn primary" href="#/lessons">${t("pinyin.next")}</a><a class="btn" href="#/quiz">${t("pinyin.toneQuiz")}</a></div>`;
  };

  views.lessons = function () {
    app.innerHTML = `
      <h1>${t("lessons.title")}</h1>
      <p class="lead">${t("lessons.lead")}</p>
      <div class="grid cards">
        ${CATEGORIES.map((c, i) => {
          const list = wordSet(c.id);
          const done = list.filter((w) => S.isLearned(w.h)).length;
          return `<a class="card link-card ${done === list.length ? "complete" : ""}" href="#/lesson/${c.id}">
            <span class="card-glyph">${c.icon}</span>
            <h3>${i + 1}. ${esc(catTitle(c))}</h3>
            ${progressBar(done, list.length, "thin")}
            <p class="muted small">${t("lessons.learned", { n: done, total: list.length })}</p>
          </a>`;
        }).join("")}
      </div>`;
  };

  views.lesson = function (id) {
    const cat = catById[id];
    if (!cat) return views.lessons();
    const idx = CATEGORIES.indexOf(cat);
    const next = CATEGORIES[idx + 1];
    app.innerHTML = `
      <a class="muted small" href="#/lessons">← ${t("lessons.back")}</a>
      <h1>${idx + 1}. ${esc(catTitle(cat))}</h1>
      <div class="row">
        <a class="btn primary" href="#/study/free/${id}">${t("lesson.practice")}</a>
        <a class="btn" href="#/quiz/${id}">${t("lesson.quiz")}</a>
        <a class="btn" href="#/write/${id}">${t("lesson.write")}</a>
      </div>
      <h2>${t("lesson.sentences")}</h2>
      <ul class="sentences">${cat.sentences.map(sentenceRow).join("")}</ul>
      <h2>${t("lesson.words")}</h2>
      <div class="grid words">${wordSet(id).map(wordCard).join("")}</div>
      ${next ? `<div class="row"><a class="btn primary" href="#/lesson/${next.id}">${t("lesson.next", { name: esc(catTitle(next)) })} →</a></div>` : ""}`;
  };

  views.vocab = function () {
    app.innerHTML = `
      <h1>${t("vocab.title")}</h1>
      <div class="toolbar">
        <input id="q" type="search" placeholder="${esc(t("vocab.search"))}" autocomplete="off">
        <select id="set">${setOptions("all")}</select>
        <select id="sort">
          <option value="lesson">${t("vocab.sortLesson")}</option>
          <option value="pinyin">${t("vocab.sortPinyin")}</option>
          <option value="hard">${t("vocab.sortHard")}</option>
          <option value="due">${t("vocab.sortDue")}</option>
        </select>
        <button class="btn" id="playAll">🔊 ${t("vocab.playAll")}</button>
      </div>
      <p id="count" class="muted small"></p>
      <div id="list" class="grid words"></div>`;

    const q = $("#q"), set = $("#set"), sort = $("#sort");
    const plain = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const errRate = (w) => { const c = S.card(w.h); return c ? c.bad / Math.max(1, c.ok + c.bad) + c.lapses : 0; };
    let shown = [];

    function render() {
      const term = plain(q.value.trim()).replace(/[\s']/g, "");
      shown = wordSet(set.value).filter((w) =>
        !term || w.h.includes(q.value.trim()) || plain(w.p).replace(/[\s']/g, "").includes(term) ||
        plain(w.e).includes(term) || plain(w.d).includes(term)
      );
      if (sort.value === "pinyin") shown = shown.slice().sort((a, b) => plain(a.p).localeCompare(plain(b.p)));
      if (sort.value === "hard") shown = shown.slice().sort((a, b) => errRate(b) - errRate(a));
      if (sort.value === "due") shown = shown.slice().sort((a, b) => (S.card(a.h)?.due ?? Infinity) - (S.card(b.h)?.due ?? Infinity));
      $("#count").textContent = t("vocab.count", { n: shown.length });
      $("#list").innerHTML = shown.map(wordCard).join("") || `<p class="muted">${t("vocab.none")}</p>`;
    }

    // Read the visible words aloud one after another
    let playing = false;
    $("#playAll").onclick = () => {
      if (playing) { playing = false; speechSynthesis.cancel(); return; }
      playing = true;
      let i = 0;
      const step = () => {
        if (!playing || i >= shown.length) { playing = false; return; }
        speak(shown[i++].h);
        setTimeout(step, 1600 / (Number(S.settings().rate) || 0.8));
      };
      step();
    };
    cleanup = () => { playing = false; if (hasSpeech) speechSynthesis.cancel(); };

    q.addEventListener("input", render);
    set.addEventListener("change", render);
    sort.addEventListener("change", render);
    render();
  };

  // Flashcards: daily spaced-repetition review, or free practice of any word set.
  views.study = function (mode, setId) {
    const free = mode === "free";
    const st = S.settings();
    let queue = [], idx = 0, revealed = false, done = 0, right = 0, extraNew = 0;

    app.innerHTML = `
      <h1>${t("study.title")}</h1>
      <div class="tabs">
        <a href="#/study" class="${free ? "" : "active"}">${t("study.srs")}</a>
        <a href="#/study/free" class="${free ? "active" : ""}">${t("study.free")}</a>
      </div>
      <p class="muted">${t(free ? "study.freeHelp" : "study.srsHelp")}</p>
      <div class="toolbar">
        ${free ? `<select id="set">${setOptions(setId || "all")}</select>` : ""}
        <select id="dir">${["h2m", "m2h", "listen"].map((d) => `<option value="${d}" ${st.direction === d ? "selected" : ""}>${t("dir." + d)}</option>`).join("")}</select>
        <label class="chk"><input type="checkbox" id="pyFront" ${st.pinyinFront ? "checked" : ""}> ${t("study.pinyinFront")}</label>
      </div>
      <div id="counts" class="muted small center-text"></div>
      <div id="stage"></div>
      <p class="muted small center-text">${t(free ? "study.keysFree" : "study.keys")}</p>`;
    const stage = $("#stage");

    function build() {
      idx = 0; done = 0; right = 0;
      if (free) {
        queue = shuffle(wordSet($("#set").value));
      } else {
        const fresh = WORDS.filter((w) => S.isNew(w.h)).slice(0, S.newRemainingToday() + extraNew);
        queue = [...S.dueWords(WORDS), ...fresh];
      }
      render();
    }

    function render() {
      const left = queue.length - idx;
      $("#counts").textContent = left > 0 ? t("study.left", { n: left }) : "";
      if (idx >= queue.length) return renderEnd();
      const w = queue[idx];
      const dir = $("#dir").value;
      const pyFront = $("#pyFront").checked;
      revealed = false;

      let front;
      if (dir === "m2h") front = `<span class="fc-meaning big">${esc(meaning(w))}</span>`;
      else if (dir === "listen") front = `<button class="fc-listen" data-speak="${esc(w.h)}" aria-label="${esc(t("common.listen"))}">🔊</button>`;
      else front = `<span class="fc-hanzi">${esc(w.h)}</span>${pyFront ? `<span class="pinyin big">${esc(w.p)}</span>` : ""}`;

      const back = [
        dir !== "h2m" ? `<span class="fc-hanzi">${esc(w.h)}</span>` : "",
        dir !== "h2m" || !pyFront ? `<span class="pinyin big">${esc(w.p)}</span>` : "",
        dir !== "m2h" ? `<span class="fc-meaning">${esc(meaning(w))}</span>` : "",
        `<button class="btn small" data-speak="${esc(w.h)}">🔊 ${t("common.listen")}</button>`,
      ].join("");

      stage.innerHTML = `
        <div class="flashcard" id="card">
          ${!free && S.isNew(w.h) ? `<span class="badge new corner">${t("wstatus.new")}</span>` : ""}
          <div class="fc-front">${front}</div>
          <div class="fc-back" hidden>${back}</div>
        </div>
        <div class="row center" id="actions">
          <button class="btn primary big" id="reveal">${t("study.show")}</button>
        </div>`;
      $("#reveal").onclick = reveal;
      $("#card").onclick = (e) => { if (!e.target.closest("[data-speak]")) reveal(); };
      if (dir === "listen") speak(w.h);
    }

    function reveal() {
      if (revealed || idx >= queue.length) return;
      revealed = true;
      const w = queue[idx];
      $(".fc-back", stage).hidden = false;
      if (S.settings().autoplay && $("#dir").value !== "listen") speak(w.h);
      const buttons = free
        ? [[0, "free.again"], [2, "free.got"]].map(([g, k]) => `<button class="btn grade g${g}" data-g="${g}">${t(k)}</button>`)
        : [0, 1, 2, 3].map((g) => `<button class="btn grade g${g}" data-g="${g}">${t("grade." + g)}<small>${fmtInterval(S.preview(w.h, g))}</small></button>`);
      $("#actions").innerHTML = buttons.join("");
      $("#actions").querySelectorAll("[data-g]").forEach((b) => (b.onclick = () => grade(+b.dataset.g)));
    }

    function grade(g) {
      const w = queue[idx];
      if (!w || !revealed) return;
      if (free) S.practice(w.h, g > 0);
      else S.review(w.h, g);
      done++;
      if (g > 0) right++;
      if (g === 0) queue.push(w); // comes back later in this session
      idx++;
      render();
    }

    function renderEnd() {
      const moreNew = !free && WORDS.some((w) => S.isNew(w.h));
      const pct = done ? Math.round((right / done) * 100) : 0;
      stage.innerHTML = `<div class="card center">
        <h2>${done ? t("study.sessionDone") : free ? t("study.emptySet") : t("study.nothingDue")}</h2>
        ${done ? `<p class="lead">${t("study.summary", { n: done, pct })}</p>` : ""}
        <div class="row center">
          ${moreNew ? `<button class="btn primary" id="more">${t("study.moreNew", { n: S.settings().newPerDay })}</button>` : ""}
          ${free ? `<button class="btn primary" id="again">${t("study.shuffle")}</button>` : `<a class="btn" href="#/study/free">${t("home.free")}</a>`}
          <a class="btn" href="#/">${t("common.home")}</a>
        </div>
      </div>`;
      if (moreNew) $("#more").onclick = () => { extraNew += Number(S.settings().newPerDay) || 10; build(); };
      if (free) $("#again").onclick = build;
    }

    onKeys((e) => {
      if (e.code === "Space" || e.key === "Enter") { e.preventDefault(); revealed ? null : reveal(); }
      else if (/^[1-4]$/.test(e.key) && revealed) {
        const n = Number(e.key) - 1;
        grade(free ? (n === 0 ? 0 : 2) : n);
      } else if (e.key.toLowerCase() === "s" && queue[idx]) speak(queue[idx].h);
    });

    $("#dir").addEventListener("change", (e) => { S.set("direction", e.target.value); if (idx < queue.length) render(); });
    $("#pyFront").addEventListener("change", (e) => { S.set("pinyinFront", e.target.checked); if (idx < queue.length) render(); });
    if (free) $("#set").addEventListener("change", build);
    build();
  };

  views.quiz = function (setId = "all") {
    const MODES = ["h2m", "m2h", "h2p", "listen", "tones", "type"];
    const st = S.settings();
    app.innerHTML = `
      <h1>${t("quiz.title")}</h1>
      <div class="toolbar">
        <select id="set">${setOptions(setId)}</select>
        <select id="mode">${MODES.map((m) => `<option value="${m}">${t("quiz.mode." + m)}</option>`).join("")}</select>
        <select id="len">${[10, 20, 30, 0].map((n) => `<option value="${n}">${n ? t("quiz.len", { n }) : t("quiz.lenAll")}</option>`).join("")}</select>
        <label class="chk" id="strictWrap"><input type="checkbox" id="strict" ${st.strictTones ? "checked" : ""}> ${t("quiz.strict")}</label>
        <button class="btn primary" id="start">${t("quiz.start")}</button>
      </div>
      <div id="quiz"><p class="muted">${t("quiz.help")}</p></div>`;

    const box = $("#quiz");
    let questions = [], n = 0, score = 0, mode, answered = false, wrong = [];

    const answerOf = (w) => (mode === "h2m" ? meaning(w) : mode === "h2p" ? w.p : w.h);
    const toggleStrict = () => { $("#strictWrap").hidden = $("#mode").value !== "type"; };
    $("#mode").addEventListener("change", toggleStrict);
    toggleStrict();
    $("#strict").addEventListener("change", (e) => S.set("strictTones", e.target.checked));

    function makeOptions(w) {
      if (mode === "tones") {
        return shuffle([{ label: w.p, ok: true }, ...toneVariants(w.p, 3).map((p) => ({ label: p, ok: false }))]);
      }
      const seen = new Set([answerOf(w)]);
      const distractors = [];
      for (const d of [...shuffle(WORDS.filter((x) => x.c === w.c)), ...shuffle(WORDS)]) {
        if (distractors.length === 3) break;
        if (!seen.has(answerOf(d))) { seen.add(answerOf(d)); distractors.push(d); }
      }
      return shuffle([{ label: answerOf(w), ok: true }, ...distractors.map((d) => ({ label: answerOf(d), ok: false }))]);
    }

    function start() {
      mode = $("#mode").value;
      let pool = wordSet($("#set").value);
      if (mode === "tones") pool = pool.filter((w) => hasToneMarks(w.p));
      if (!pool.length) return toast(t("quiz.emptySet"));
      const len = Number($("#len").value) || pool.length;
      questions = shuffle(pool).slice(0, len).map((w) => ({ w, options: mode === "type" ? null : makeOptions(w) }));
      n = 0; score = 0; wrong = [];
      render();
    }

    function render() {
      if (n >= questions.length) return renderEnd();
      answered = false;
      const { w, options } = questions[n];
      let prompt;
      if (mode === "m2h") prompt = `<div class="q">${esc(meaning(w))}</div>`;
      else if (mode === "listen") prompt = `<div class="q"><button class="fc-listen" data-speak="${esc(w.h)}" aria-label="${esc(t("common.listen"))}">🔊</button></div>`;
      else prompt = `<div class="q q-big">${esc(w.h)}</div>${mode === "tones" || mode === "type" ? `<p class="muted center-text">${esc(meaning(w))}</p>` : ""}`;

      const answers = mode === "type"
        ? `<form id="typeForm" class="type-form">
             <input id="typed" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${esc(t("quiz.typePlaceholder"))}">
             <button class="btn primary" type="submit">${t("quiz.check")}</button>
           </form>`
        : `<div class="grid options">${options.map((o, k) => `<button class="btn option ${mode === "m2h" || mode === "listen" ? "zh" : ""}" data-k="${k}"><kbd>${k + 1}</kbd> ${esc(o.label)}</button>`).join("")}</div>`;

      box.innerHTML = `<div class="card">
        <p class="muted small">${t("quiz.progress", { n: n + 1, total: questions.length, score })}</p>
        ${progressBar(n, questions.length, "thin")}
        ${prompt}
        ${answers}
        <div id="feedback" class="feedback"></div>
      </div>`;

      if (mode === "type") {
        $("#typed").focus();
        $("#typeForm").onsubmit = (e) => {
          e.preventDefault();
          if (answered) return next();
          const res = checkPinyin($("#typed").value, w.p, $("#strict").checked);
          finish(res.ok, res.tonesWrong ? t("quiz.tonesWrong") : "");
        };
      } else {
        box.querySelectorAll(".option").forEach((btn) => (btn.onclick = () => choose(+btn.dataset.k)));
      }
      if (mode === "listen") speak(w.h);
    }

    function choose(k) {
      if (answered) return;
      const { options } = questions[n];
      box.querySelectorAll(".option").forEach((btn, j) => {
        btn.disabled = true;
        if (options[j].ok) btn.classList.add("right");
        else if (j === k) btn.classList.add("wrong");
      });
      finish(options[k].ok);
    }

    function finish(correct, hint = "") {
      answered = true;
      const { w } = questions[n];
      if (correct) score++;
      else wrong.push(w);
      S.practice(w.h, correct);
      if (mode === "type") $("#typed").disabled = true;
      $("#feedback").innerHTML = `
        <span class="${correct ? "ok" : "bad"}">${correct ? t("quiz.correct") : t("quiz.wrong")}</span>
        ${hint ? `<span class="muted">${esc(hint)}</span>` : ""}
        <span><b class="zh">${esc(w.h)}</b> <span class="pinyin">${esc(w.p)}</span> — ${esc(meaning(w))}</span>
        <button class="btn" id="next">${n + 1 < questions.length ? t("quiz.next") : t("quiz.result")}</button>`;
      $("#next").onclick = next;
      $("#next").focus();
      if (S.settings().autoplay && mode !== "listen") speak(w.h);
    }

    function next() { n++; render(); }

    function renderEnd() {
      const pct = Math.round((score / questions.length) * 100);
      mistakes = wrong.slice();
      box.innerHTML = `<div class="card center">
        <h2>${t("quiz.score", { score, total: questions.length })}</h2>
        <p class="lead">${pct === 100 ? t("quiz.perfect") : pct >= 70 ? t("quiz.good") : t("quiz.keepGoing")}</p>
        ${wrong.length ? `<h3>${t("quiz.mistakes")}</h3><div class="grid words">${wrong.map(wordCard).join("")}</div>` : ""}
        <div class="row center">
          ${wrong.length ? `<a class="btn primary" href="#/study/free/mistakes">${t("quiz.practiceMistakes")}</a>` : ""}
          <button class="btn" id="retry">${t("quiz.retry")}</button>
        </div>
      </div>`;
      $("#retry").onclick = start;
    }

    onKeys((e) => {
      if (!questions.length) return;
      if (/^[1-4]$/.test(e.key) && mode !== "type" && !answered) choose(Number(e.key) - 1);
      else if (e.key === "Enter" && answered) { e.preventDefault(); next(); }
      else if (e.key.toLowerCase() === "s" && questions[n]) speak(questions[n].w.h);
    });

    $("#start").onclick = start;
  };

  // Stroke-order practice using Hanzi Writer (loaded from a CDN on first use)
  let hanziWriterPromise = null;
  function loadHanziWriter() {
    if (window.HanziWriter) return Promise.resolve();
    hanziWriterPromise = hanziWriterPromise || new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/hanzi-writer@3.5.0/dist/hanzi-writer.min.js";
      s.onload = resolve;
      s.onerror = () => { hanziWriterPromise = null; reject(new Error("load failed")); };
      document.head.appendChild(s);
    });
    return hanziWriterPromise;
  }

  views.write = function (setId = "all") {
    let list = [], i = 0, writers = [], outline = true;
    app.innerHTML = `
      <h1>${t("write.title")}</h1>
      <p class="muted">${t("write.help")}</p>
      <div class="toolbar">
        <select id="set">${setOptions(setId)}</select>
        <label class="chk"><input type="checkbox" id="hideHint"> ${t("write.hideHint")}</label>
      </div>
      <div id="wstage" class="card"></div>`;
    const stage = $("#wstage");

    function build() { list = wordSet($("#set").value); i = 0; render(); }

    function render() {
      if (!list.length) { stage.innerHTML = `<p class="muted">${t("quiz.emptySet")}</p>`; return; }
      const w = list[i];
      const hide = $("#hideHint").checked;
      stage.innerHTML = `
        <p class="muted small center-text">${i + 1} / ${list.length}</p>
        <div class="write-info">
          <div class="fc-meaning big">${esc(meaning(w))}</div>
          <div class="pinyin big">${esc(w.p)} <button class="icon-btn" data-speak="${esc(w.h)}" aria-label="${esc(t("common.listen"))}">🔊</button></div>
        </div>
        <div id="chars" class="write-chars"><p class="muted">${t("write.loading")}</p></div>
        <div id="wfeedback" class="center-text"></div>
        <div class="row center">
          <button class="btn" id="prev">← ${t("write.prev")}</button>
          <button class="btn" id="animate">▶ ${t("write.animate")}</button>
          <button class="btn primary" id="quizBtn">✍ ${t("write.quiz")}</button>
          <button class="btn" id="outline">${t("write.outline")}</button>
          <button class="btn" id="random">🔀 ${t("write.random")}</button>
          <button class="btn" id="next">${t("write.next")} →</button>
        </div>`;
      $("#prev").onclick = () => { i = (i - 1 + list.length) % list.length; render(); };
      $("#next").onclick = () => { i = (i + 1) % list.length; render(); };
      $("#random").onclick = () => { i = Math.floor(Math.random() * list.length); render(); };

      loadHanziWriter().then(() => {
        if (list[i] !== w) return; // user moved on while loading
        const box = $("#chars");
        box.innerHTML = "";
        const chars = [...w.h];
        const size = Math.max(110, Math.min(220, Math.floor((box.clientWidth - 16 * (chars.length - 1)) / chars.length)));
        const css = getComputedStyle(document.documentElement);
        const color = (v) => css.getPropertyValue(v).trim();
        writers = chars.map((ch) => {
          const el = document.createElement("div");
          el.className = "write-box";
          el.style.width = el.style.height = size + "px";
          box.appendChild(el);
          return HanziWriter.create(el, ch, {
            width: size, height: size, padding: 8,
            showOutline: outline, showCharacter: !hide,
            strokeColor: color("--text"), outlineColor: color("--border"),
            drawingColor: color("--accent"), highlightColor: color("--accent"),
            strokeAnimationSpeed: 1.2, delayBetweenStrokes: 250,
          });
        });
        $("#animate").onclick = () => animate(0);
        $("#quizBtn").onclick = () => quiz(0, 0);
        $("#outline").onclick = () => { outline = !outline; writers.forEach((wr) => (outline ? wr.showOutline() : wr.hideOutline())); };
      }).catch(() => {
        $("#chars").innerHTML = `<p class="bad">${t("write.offline")}</p><div class="fc-hanzi">${esc(w.h)}</div>`;
      });
    }

    function animate(k) {
      if (k >= writers.length) return;
      writers[k].animateCharacter({ onComplete: () => animate(k + 1) });
    }

    function quiz(k, mistakesSoFar) {
      if (k === 0) $("#wfeedback").textContent = t("write.go");
      if (k >= writers.length) {
        const ok = mistakesSoFar <= writers.length * 2;
        S.practice(list[i].h, ok);
        $("#wfeedback").innerHTML = `<span class="${ok ? "ok" : "bad"}">${t(ok ? "write.done" : "write.doneMany", { n: mistakesSoFar })}</span>`;
        return;
      }
      writers[k].quiz({ onComplete: (s) => quiz(k + 1, mistakesSoFar + s.totalMistakes) });
    }

    $("#set").addEventListener("change", build);
    $("#hideHint").addEventListener("change", render);
    build();
  };

  views.stats = function () {
    const days = S.lastDays(14);
    const max = Math.max(5, ...days.map((d) => d.reviews + d.practice));
    const tot = S.totals();
    const learned = WORDS.filter((w) => S.isLearned(w.h)).length;
    const mastered = WORDS.filter((w) => S.isMastered(w.h)).length;
    const fc = S.forecast(WORDS, 7);
    const locale = lang() === "de" ? "de-DE" : "en-US";
    const hard = WORDS.filter((w) => S.card(w.h)?.bad > 0)
      .map((w) => { const c = S.card(w.h); return { w, c, rate: c.bad / (c.ok + c.bad) }; })
      .sort((a, b) => b.rate - a.rate || b.c.bad - a.c.bad)
      .slice(0, 10);

    app.innerHTML = `
      <h1>${t("stats.title")}</h1>
      <div class="tiles">
        ${tile("🔥 " + S.streak(), t("home.streak"))}
        ${tile(`${learned} / ${WORDS.length}`, t("stats.learned"))}
        ${tile(mastered, t("stats.mastered"))}
        ${tile(tot.answers, t("stats.answers"))}
        ${tile(tot.answers ? Math.round((tot.correct / tot.answers) * 100) + "%" : "–", t("stats.accuracy"))}
      </div>

      <h2>${t("stats.activity")}</h2>
      <div class="card">
        <div class="chart" role="img" aria-label="${esc(t("stats.activity"))}">
          <span class="chart-max muted small">${max}</span>
          ${days.map((d) => {
            const v = d.reviews + d.practice;
            const label = d.date.toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "numeric" });
            return `<div class="bar-col" tabindex="0" data-tip="${esc(label)}: ${t("stats.tip", { n: v, r: d.reviews, p: d.practice })}">
              <div class="bar" style="height:${(v / max) * 100}%"></div>
              <span class="bar-label">${d.date.toLocaleDateString(locale, { weekday: "narrow" })}</span>
            </div>`;
          }).join("")}
        </div>
      </div>

      <h2>${t("stats.forecast")}</h2>
      <div class="tiles">
        ${fc.map((n, k) => tile(n, k === 0 ? t("stats.today") : k === 1 ? t("stats.tomorrow") : t("stats.inDays", { n: k }))).join("")}
      </div>

      <h2>${t("stats.byLesson")}</h2>
      <div class="card lesson-progress">
        ${CATEGORIES.map((c, i) => {
          const list = wordSet(c.id);
          const done = list.filter((w) => S.isLearned(w.h)).length;
          return `<a href="#/lesson/${c.id}" class="lp-row"><span>${i + 1}. ${esc(catTitle(c))}</span>${progressBar(done, list.length, "thin")}<span class="muted small">${done}/${list.length}</span></a>`;
        }).join("")}
      </div>

      <h2>${t("stats.hardest")}</h2>
      ${hard.length ? `
        <div class="card table-wrap"><table>
          <thead><tr><th>${t("stats.word")}</th><th>Pinyin</th><th>${t("stats.meaning")}</th><th>${t("stats.errors")}</th></tr></thead>
          <tbody>${hard.map(({ w, c }) => `<tr>
            <td><button class="hanzi small-hanzi" data-speak="${esc(w.h)}">${esc(w.h)}</button></td>
            <td class="pinyin">${esc(w.p)}</td><td>${esc(meaning(w))}</td><td>${c.bad} / ${c.ok + c.bad}</td></tr>`).join("")}
          </tbody></table></div>
        <div class="row"><a class="btn primary" href="#/study/free/difficult">${t("stats.practiceHard")}</a></div>`
        : `<p class="muted">${t("stats.noHard")}</p>`}`;
  };

  views.settings = function () {
    const st = S.settings();
    const voiceOpts = voices.length
      ? voices.map((v) => `<option value="${esc(v.voiceURI)}" ${currentVoice() === v ? "selected" : ""}>${esc(v.name)} (${esc(v.lang)})</option>`).join("")
      : `<option value="">${t("settings.noVoices")}</option>`;
    const diskOk = S.status === "saved-disk" || S.status === "saving";

    app.innerHTML = `
      <h1>${t("settings.title")}</h1>

      <section class="card form">
        <h2>${t("settings.general")}</h2>
        <label>${t("settings.lang")}
          <select data-setting="lang">
            <option value="de" ${st.lang === "de" ? "selected" : ""}>Deutsch</option>
            <option value="en" ${st.lang === "en" ? "selected" : ""}>English</option>
          </select>
        </label>
        <label>${t("settings.theme")}
          <select data-setting="theme">
            ${["auto", "light", "dark"].map((v) => `<option value="${v}" ${st.theme === v ? "selected" : ""}>${t("settings.theme." + v)}</option>`).join("")}
          </select>
        </label>
      </section>

      <section class="card form">
        <h2>${t("settings.learning")}</h2>
        <label>${t("settings.newPerDay")}
          <input type="number" min="1" max="100" data-setting="newPerDay" value="${st.newPerDay}">
        </label>
        <label>${t("settings.dailyGoal")}
          <input type="number" min="1" max="1000" data-setting="dailyGoal" value="${st.dailyGoal}">
        </label>
        <label class="chk"><input type="checkbox" data-setting="pinyinFront" ${st.pinyinFront ? "checked" : ""}> ${t("study.pinyinFront")}</label>
        <label class="chk"><input type="checkbox" data-setting="strictTones" ${st.strictTones ? "checked" : ""}> ${t("quiz.strict")}</label>
      </section>

      <section class="card form">
        <h2>${t("settings.audio")}</h2>
        <label>${t("settings.voice")}
          <select data-setting="voice">${voiceOpts}</select>
        </label>
        <label>${t("settings.rate")} <span id="rateVal">${Number(st.rate).toFixed(1)}×</span>
          <input type="range" min="0.4" max="1.4" step="0.1" data-setting="rate" value="${st.rate}">
        </label>
        <label class="chk"><input type="checkbox" data-setting="autoplay" ${st.autoplay ? "checked" : ""}> ${t("settings.autoplay")}</label>
        <div class="row"><button class="btn" data-speak="你好，我叫王小明。很高兴认识你！">🔊 ${t("settings.testVoice")}</button></div>
        ${voices.length ? "" : `<p class="muted small">${t("speech.noVoice")}</p>`}
      </section>

      <section class="card form">
        <h2>${t("settings.data")}</h2>
        <p class="${diskOk ? "ok" : "bad"}">${diskOk ? t("settings.savedDisk") : t("settings.savedLocal")}</p>
        <p class="muted small">${t("settings.backupInfo")}</p>
        <div class="row">
          <button class="btn" id="export">⬇ ${t("settings.export")}</button>
          <label class="btn">⬆ ${t("settings.import")}<input type="file" id="import" accept=".json,application/json" hidden></label>
          <button class="btn danger" id="reset">${t("settings.reset")}</button>
        </div>
      </section>`;

    app.querySelectorAll("[data-setting]").forEach((el) => {
      el.addEventListener(el.type === "range" ? "input" : "change", () => {
        const key = el.dataset.setting;
        let v = el.type === "checkbox" ? el.checked : el.value;
        if (el.type === "number") v = Math.max(Number(el.min), Math.min(Number(el.max), Number(el.value) || Number(el.min)));
        if (el.type === "range") { v = Number(v); $("#rateVal").textContent = v.toFixed(1) + "×"; }
        S.set(key, v);
        if (key === "lang") { applyLang(); views.settings(); }
        if (key === "theme") applyTheme();
      });
    });

    $("#export").onclick = () => {
      const blob = new Blob([S.exportJSON()], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `hsk1-progress-${S.dayKey()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };

    $("#import").onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        S.importJSON(await file.text());
        applyTheme();
        applyLang();
        toast(t("settings.imported"));
        views.settings();
      } catch {
        toast(t("settings.importFailed"));
      }
    };

    // two-step reset instead of a blocking confirm() dialog
    let armed = false;
    $("#reset").onclick = (e) => {
      if (!armed) {
        armed = true;
        e.target.textContent = t("settings.resetConfirm");
        setTimeout(() => { armed = false; if (e.target.isConnected) e.target.textContent = t("settings.reset"); }, 4000);
        return;
      }
      S.reset();
      toast(t("settings.resetDone"));
      views.settings();
    };
  };

  // ---------- global events ----------
  document.addEventListener("click", (e) => {
    const s = e.target.closest("[data-speak]");
    if (s) speak(s.dataset.speak);
  });
  document.addEventListener("change", (e) => {
    const box = e.target.closest("[data-known]");
    if (!box) return;
    const h = box.dataset.known;
    S.setKnown(h, box.checked);
    const card = box.closest(".word");
    if (card) card.outerHTML = wordCard(WORDS.find((w) => w.h === h));
  });

  // ---------- router ----------
  const ALIASES = { flashcards: "study" };
  function route() {
    if (cleanup) { cleanup(); cleanup = null; }
    let [page = "", a, b] = location.hash.replace(/^#\/?/, "").split("/");
    page = ALIASES[page] || page;
    const view = views[page] || views.home;
    view(a, b);
    const navKey = page === "lesson" ? "lessons" : views[page] ? page : "";
    document.querySelectorAll(".nav a").forEach((el) =>
      el.classList.toggle("active", el.getAttribute("href") === "#/" + navKey)
    );
    window.scrollTo(0, 0);
  }

  S.onStatus(renderStatus);
  S.onExternalChange(() => { applyTheme(); applyLang(); route(); });
  window.addEventListener("hashchange", route);

  (async function init() {
    renderStatus("loading");
    await S.load();
    applyTheme();
    applyLang();
    route();
  })();
})();
