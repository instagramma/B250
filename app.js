// BIOL 250 Study App — vanilla JS, no build step, works fully offline.

/* Classify a question as a diagram/labeling item (tied to a worksheet image)
   vs. a plain content question. Used to keep Diagrams and Q&A cleanly separate. */
const DIAGRAM_RE = /label\s+[A-Z]\b|indicated by|identify the structure|structure\(s\)\s+(indicated|labeled)|labeled\s+[A-Z]\b/i;
function isDiagramQ(q) {
  return !!(q && q.images && q.images.length) || (q && DIAGRAM_RE.test(q.q || ""));
}
/* Fill-in-the-blank items (single answer / no distractors) — fine for flashcard review,
   but excluded from timed Simulations & Practice Exams (they render as a lone option). */
function isFITBQ(q) { return !!(q && (q.fitb || (q.options || []).length <= 1)); }
/* Out-of-scope items — never served in Torso exams/mocks. Reversible (just remove the id).
   PE-2159/2161 = imaging physics. ST-0499/ST-0948 = "femoral artery becomes popliteal" — a
   lower-limb (Appendicular) vessel that Stuvia mis-filed under Pelvis; not Torso material. */
const OUT_OF_SCOPE_IDS = new Set([
  "PE-2159", "PE-2161",          // imaging physics
  "ST-0499", "ST-0948",          // femoral→popliteal (Appendicular / lower-limb)
  "ST-0001", "ST-0242", "ST-0498" // general ANS "unpaired ganglia" MCQ (Axial nervous-system) — Thorax/Abdomen/Pelvis copies
]);
function isExamEligible(q) { return !!q && !isFITBQ(q) && !OUT_OF_SCOPE_IDS.has(q.id); }
/* Normalize a question stem so near-identical duplicates (same stem across GR/Stuvia/CB, or the
   Systemic master set that duplicates section questions) collapse to one key. */
function _stemKey(q) {
  const base = String((q && (q.q || q.question)) || "")
    .toLowerCase().replace(/\[gr\]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  // Diagram/labeling questions share generic stems ("Identify Label A") across different images —
  // fold the image reference into the key so distinct diagrams are NOT merged.
  const img = (q && (q.images ? [].concat(q.images).join(",") : q.image)) || "";
  return img ? base + "|" + img : base;
}
/* Remove duplicate questions by normalized stem. Optional shared `seen` Set lets callers dedupe
   across several pools (e.g. keep a Thorax question from re-appearing inside the Systemic slice). */
function dedupeQs(list, seen) {
  seen = seen || new Set();
  const out = [];
  for (const q of (list || [])) {
    const k = _stemKey(q);
    if (!k || seen.has(k)) continue;
    seen.add(k); out.push(q);
  }
  return out;
}
function filterQuiz(list, filter) {
  if (!list) return [];
  if (filter === "diagram") return list.filter(isDiagramQ);
  if (filter === "content") return list.filter(q => !isDiagramQ(q));
  return list;
}
function countSplit(list) {
  let d = 0, c = 0;
  (list || []).forEach(q => isDiagramQ(q) ? d++ : c++);
  return { diagram: d, content: c };
}

/* Torso GR section definitions — subtopic indices per lab section */
const TORSO_GR_SECTIONS = [
  { label: "Thorax",            icon: "🫁", indices: [0,1,2,3,4,5] },
  { label: "Abdomen",           icon: "🧫", indices: [6,7,8,9,10,11,12] },
  { label: "Pelvis & Perineum", icon: "🦴", indices: [13,14] },
  { label: "Systemic",          icon: "🧬", indices: [15,16,17,18,19,20,21,22,23] },
];

/* ---------------- MARTINI TEXTBOOK LOOKUP ----------------
   Searches the extracted Martini 9e passages for the best-matching text,
   highlights the answer, and shows the page number. Powered by textbook.js. */
const TB_STOP = new Set("a an the of to in on is are was were be as by for with at from that this these those which who whom what when where how and or not it its their his her they them then than into over under between within during each other all any some most more less than can may will would should could does do did has have had such via near onto off out up down left right anterior posterior".split(" "));
function tbTokens(s) {
  return (String(s).toLowerCase().match(/[a-z][a-z\-]{2,}/g) || []).filter(w => !TB_STOP.has(w));
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
/* Inverse-document-frequency, computed once, so distinctive anatomy terms
   (e.g. "seminalplasmin") outweigh common words (e.g. "gland", "blood"). */
let _tbIdf = null, _tbLow = null, _tbProse = null, _tbQual = null;
// function words that flow in real prose but are sparse in figure-caption "label salad"
const TB_FUNC = new Set("the of and a to in is that it for as with are this by be on or an which from at not but they these can when into than has have its also such may each within between through during because while where how other some more most less their his her them we you".split(" "));
const TB_REVIEW_RE = /concept check|chapter review|reviewing facts|reviewing concepts|study outline|answers tab|see the blue answers|clinical case|clinical note|level 1|level 2|level 3|checkpoint|related clinical terms|key terms/;
function tbBuildIndex() {
  if (_tbIdf) return;
  _tbIdf = Object.create(null);
  _tbLow = new Array(TEXTBOOK.length);
  _tbProse = new Array(TEXTBOOK.length);
  _tbQual = new Array(TEXTBOOK.length);
  const N = TEXTBOOK.length;
  for (let i = 0; i < N; i++) {
    const low = TEXTBOOK[i][1].toLowerCase();
    _tbLow[i] = low;
    const words = low.match(/[a-z][a-z\-]+/g) || [];
    let fc = 0; for (const w of words) if (TB_FUNC.has(w)) fc++;
    _tbProse[i] = words.length ? fc / words.length : 0; // high = coherent prose; low = figure-label salad
    // quality = prose (caption penalty) × review-block penalty (end-of-section questions / answer keys)
    const qMarks = (low.match(/\?/g) || []).length;
    const isReview = TB_REVIEW_RE.test(low) || qMarks >= 4;
    _tbQual[i] = Math.min(1, _tbProse[i] / 0.22) * (isReview ? 0.3 : 1);
    const seen = new Set(low.match(/[a-z][a-z\-]{2,}/g) || []);
    seen.forEach(w => { _tbIdf[w] = (_tbIdf[w] || 0) + 1; });
  }
  for (const w in _tbIdf) _tbIdf[w] = Math.log(N / _tbIdf[w]); // rarer -> higher
}
function searchTextbook(question, answerText) {
  if (typeof TEXTBOOK === "undefined" || !TEXTBOOK.length) return null;
  tbBuildIndex();
  const qTok = tbTokens(question);
  const aTok = tbTokens(answerText);
  const ansPhrase = String(answerText || "").toLowerCase().replace(/^(the|a|an)\s+/, "").replace(/[.;,]$/, "").trim();
  const weights = Object.create(null);
  const add = (w, base) => { weights[w] = (weights[w] || 0) + base * (_tbIdf[w] || 6); };
  qTok.forEach(w => add(w, 1));
  aTok.forEach(w => add(w, 3)); // answer terms matter most
  // the question's most distinctive concept word (e.g. "hemostasis") — used to reward passages
  // that address the actual concept, not just any passage containing the answer word
  const TB_TOPIC_SKIP = new Set("least most following type common kind example correct except best structure function part called known located found number result involved associated".split(" "));
  let topic = null, topicIdf = 0;
  qTok.forEach(w => { if (w.length > 4 && !aTok.includes(w) && !TB_TOPIC_SKIP.has(w)) { const v = _tbIdf[w] || 0; if (v > topicIdf) { topicIdf = v; topic = w; } } });
  let best = null, bestScore = 0;
  for (let i = 0; i < TEXTBOOK.length; i++) {
    const low = _tbLow[i];
    let score = 0;
    for (const w in weights) if (low.includes(w)) score += weights[w];
    if (ansPhrase && ansPhrase.length > 3 && low.includes(ansPhrase)) score += 25; // exact answer phrase
    if (topic && ansPhrase && low.includes(topic) && low.includes(ansPhrase)) score += 20; // answer + question concept together
    // down-weight figure-caption label-salad, tables, and end-of-section review/answer blocks
    score *= (0.2 + 0.8 * _tbQual[i]);
    if (score > bestScore) { bestScore = score; best = { page: TEXTBOOK[i][0], text: TEXTBOOK[i][1] }; }
  }
  if (!best || bestScore < 12) return null;
  best.score = Math.round(bestScore); best.ansPhrase = ansPhrase; best.qTok = qTok.concat(aTok);
  return best;
}
function highlightPassage(res) {
  let html = escapeHtml(res.text);
  // highlight the exact answer phrase first (strongest)
  if (res.ansPhrase && res.ansPhrase.length > 3) {
    const re = new RegExp("(" + res.ansPhrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "ig");
    html = html.replace(re, '<mark class="tbAns">$1</mark>');
  }
  // then key terms
  const terms = [...new Set(res.qTok)].filter(w => w.length > 4).slice(0, 10);
  terms.forEach(w => {
    const re = new RegExp("(?<![\\w>])(" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "s?)(?![\\w])", "ig");
    html = html.replace(re, m => /^<mark/.test(m) ? m : '<mark class="tbTerm">' + m + '</mark>');
  });
  return html;
}
function showTextbookPanel(question, answerText) {
  const res = searchTextbook(question, answerText);
  const overlay = document.createElement("div");
  overlay.className = "tbOverlay";
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  const panel = document.createElement("div");
  panel.className = "tbPanel";
  if (res) {
    panel.innerHTML =
      `<div class="tbHead"><span class="tbBadge">📖 Martini 9e · p. ${res.page}</span>
        <button class="tbClose" aria-label="Close">✕</button></div>
       <div class="tbAnswerLine"><span class="tbAnswerLabel">Answer</span> ${escapeHtml(answerText)}</div>
       <div class="tbBody">${highlightPassage(res)}</div>
       <div class="tbFoot">Highlighted from the course textbook · verify against the printed page for figures.
         <button class="pdfLookBtn">📄 View in Annotated PDF</button>
       </div>`;
    panel.querySelector(".pdfLookBtn").onclick = () => openPdfAtPage(res.page + 31);
  } else {
    panel.innerHTML =
      `<div class="tbHead"><span class="tbBadge">📖 Martini 9e</span>
        <button class="tbClose" aria-label="Close">✕</button></div>
       <div class="tbBody">No close textbook passage found for this one. The answer is <strong>${escapeHtml(answerText)}</strong> — try the index for related terms.</div>`;
  }
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
  panel.querySelector(".tbClose").onclick = () => overlay.remove();
}

/* ---------------- ANNOTATED PDF VIEWER ----------------
   Pick the local Torso Annotated.pdf once per session (file picker → blob URL),
   then render any page via PDF.js loaded from CDN into a full-screen modal. */
let _annotatedPdfUrl = null;   // blob URL of the locally selected PDF
let _pdfDoc          = null;   // cached PDF.js document object

function pickAnnotatedPdf(onDone) {
  const inp = document.createElement("input");
  inp.type = "file"; inp.accept = "application/pdf";
  inp.onchange = () => {
    const file = inp.files[0];
    if (!file) return;
    if (_annotatedPdfUrl) URL.revokeObjectURL(_annotatedPdfUrl);
    _annotatedPdfUrl = URL.createObjectURL(file);
    _pdfDoc = null;
    onDone();
  };
  inp.click();
}

function openPdfAtPage(pdfPage) {
  if (!_annotatedPdfUrl) { pickAnnotatedPdf(() => openPdfAtPage(pdfPage)); return; }
  _showPdfModal(pdfPage);
}

function _showPdfModal(startPage) {
  const existing = document.getElementById("pdfModal");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "pdfModal";
  overlay.className = "pdfOverlay";
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };

  const panel = document.createElement("div");
  panel.className = "pdfPanel";

  const head = document.createElement("div");
  head.className = "tbHead";
  const badge = document.createElement("span");
  badge.className = "tbBadge"; badge.textContent = "📄 Annotated PDF";
  const changeBtn = document.createElement("button");
  changeBtn.className = "secondaryBtn"; changeBtn.textContent = "Change file";
  changeBtn.style.cssText = "font-size:12px;padding:4px 10px;margin-left:auto;margin-right:8px;";
  changeBtn.onclick = () => pickAnnotatedPdf(() => { _showPdfModal(curPage); overlay.remove(); });
  const closeBtn = document.createElement("button");
  closeBtn.className = "tbClose"; closeBtn.textContent = "✕";
  closeBtn.onclick = () => overlay.remove();
  head.appendChild(badge); head.appendChild(changeBtn); head.appendChild(closeBtn);
  panel.appendChild(head);

  const nav = document.createElement("div");
  nav.className = "pdfNav";
  const prevBtn = document.createElement("button");
  prevBtn.className = "secondaryBtn"; prevBtn.textContent = "← Prev";
  const pageLabel = document.createElement("span");
  pageLabel.className = "pdfPageLabel";
  const nextBtn = document.createElement("button");
  nextBtn.className = "secondaryBtn"; nextBtn.textContent = "Next →";
  nav.appendChild(prevBtn); nav.appendChild(pageLabel); nav.appendChild(nextBtn);
  panel.appendChild(nav);

  const canvasWrap = document.createElement("div");
  canvasWrap.className = "pdfCanvasWrap";
  const canvas = document.createElement("canvas");
  canvasWrap.appendChild(canvas);
  panel.appendChild(canvasWrap);

  const foot = document.createElement("div");
  foot.className = "tbFoot";
  foot.textContent = "Yellow highlights = annotated sections linked to guided readings.";
  panel.appendChild(foot);

  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  let curPage = startPage;
  let renderTask = null;

  function renderToCanvas(doc) {
    _pdfDoc = doc;
    if (renderTask) { try { renderTask.cancel(); } catch(e) {} renderTask = null; }
    doc.getPage(curPage).then(page => {
      const dpr = window.devicePixelRatio || 1;
      const panelW = Math.max(panel.clientWidth - 36, 300);
      const baseVP = page.getViewport({ scale: 1 });
      const scale = (panelW / baseVP.width) * dpr;
      const vp = page.getViewport({ scale });
      canvas.width = vp.width;
      canvas.height = vp.height;
      canvas.style.width  = (vp.width  / dpr) + "px";
      canvas.style.height = (vp.height / dpr) + "px";
      renderTask = page.render({ canvasContext: canvas.getContext("2d"), viewport: vp });
    });
  }

  function doRender(num) {
    curPage = num;
    pageLabel.textContent = `Page ${num}`;
    prevBtn.disabled = (num <= 1);

    if (!window.pdfjsLib) {
      // Load PDF.js from CDN on first use
      pageLabel.textContent = `Loading PDF.js… (page ${num})`;
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
      s.onload = () => {
        pdfjsLib.GlobalWorkerOptions.workerSrc =
          "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
        if (_pdfDoc) { renderToCanvas(_pdfDoc); }
        else { pdfjsLib.getDocument(_annotatedPdfUrl).promise.then(renderToCanvas); }
      };
      document.head.appendChild(s);
    } else if (_pdfDoc) {
      renderToCanvas(_pdfDoc);
    } else {
      pdfjsLib.getDocument(_annotatedPdfUrl).promise.then(renderToCanvas);
    }
  }

  prevBtn.onclick = () => { if (curPage > 1) doRender(curPage - 1); };
  nextBtn.onclick = () => doRender(curPage + 1);
  doRender(startPage);
}

const ICONS = {
  lab1: "🔬", lab2: "🩺", appendicular: "🦴", axial: "🦷", torso: "🫁", cumulative: "🎓"
};
const META = {
  lab1: "Labs 1-11 · Cells, tissues, skin, skeleton, joints, muscles, nervous tissue",
  lab2: "Labs 12-23 · Senses, endocrine, blood, heart, vessels, organ systems",
  appendicular: "Upper & lower limb bones, joints, and muscles",
  axial: "Skull, vertebral column, axial muscles, nervous system basics",
  torso: "Thorax, abdomen, pelvis & perineum",
  cumulative: "Everything combined — final exam mode"
};

/* ---------------- AUTH / CLOUD PROGRESS ---------------- */
// Fill these in after creating your free Supabase project — see supabase_setup.sql
// and SETUP_GUIDE.md. If left as-is, the app skips login and runs local-only
// (progress isn't saved anywhere, but everything still works offline).
const SUPABASE_URL = "https://tzdreklmkntpopqncada.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_PWdbyaBoBg8hM2kptSrwBA_I4lFrnQr";

const CLOUD_ENABLED = !SUPABASE_URL.startsWith("YOUR_") && !SUPABASE_ANON_KEY.startsWith("YOUR_");
const sb = CLOUD_ENABLED ? supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

let authUser = null;
let progressState = { flashcards: {}, quizzes: {}, examAttempts: {} };
let authError = "";
let authBusy = false;
let authMode = "signin"; // "signin" | "signup"

/* ---------------- LOCAL PERSISTENCE (works with or without cloud) ----------------
   Best scores + "where you left off" are always saved to this device's localStorage,
   so closing the tab/app and coming back resumes exactly where you were — no account
   needed. If Supabase is also configured, cloud progress is layered on top of this. */
const RESUME_KEY = "biol250_resume_v1";
const PROGRESS_KEY = "biol250_progress_v1";
const MISSED_KEY = "biol250_missedQs_v1";

/* ---------- MULTI-USER PROFILES (Gabe / Sam / Darren) ----------
   Each profile's data is namespaced in localStorage (key "base::Name"), so
   results are locked to that person and never cross over — even on a shared
   device. The chosen profile is remembered on this device, so you auto sign-in
   and don't have to pick every time. "Switch profile" changes it. */
const PROFILES = ["Gabe", "Sam", "Darren"];
const PROFILE_KEY = "biol250_profile";
let currentProfile = null;
try { currentProfile = localStorage.getItem(PROFILE_KEY); } catch (e) {}
function ns(base) { return base + "::" + (currentProfile || "guest"); }

function loadMissedQs() {
  try { return JSON.parse(localStorage.getItem(ns(MISSED_KEY))) || []; } catch(e) { return []; }
}
function saveMissedQs(arr) {
  try { localStorage.setItem(ns(MISSED_KEY), JSON.stringify(arr)); } catch(e) {}
}
function recordMissedQs(answerLog) {
  const pool = loadMissedQs();
  const idOf = (o) => (o && o.id) ? o.id : (o && o.q ? o.q.slice(0, 80) : "");
  const existingKeys = new Set(pool.map(m => m.id || (m.q ? m.q.slice(0, 80) : "")));
  let changed = false;
  answerLog.forEach(entry => {
    if (entry.timedOut || entry.selected !== entry.correct) {
      const key = idOf(entry.q);
      if (key && !existingKeys.has(key)) {
        pool.push({ id: entry.q.id, q: entry.q.q, options: entry.q.options, correct: entry.q.correct, tf: entry.q.tf || false });
        existingKeys.add(key);
        changed = true;
      }
    }
  });
  if (changed) saveMissedQs(pool);
}

/* Missed Review state */
let missedDeck = [], missedIndex = 0, missedAnswered = false, missedSelected = -1;

function loadLocalProgress() {
  try {
    const raw = localStorage.getItem(ns(PROGRESS_KEY));
    return raw ? JSON.parse(raw) : { flashcards: {}, quizzes: {} };
  } catch (e) { return { flashcards: {}, quizzes: {} }; }
}
function saveLocalProgress() {
  try { localStorage.setItem(ns(PROGRESS_KEY), JSON.stringify(progressState)); } catch (e) {}
  if (typeof saveProgress === "function") saveProgress(false);   // debounced cloud push
}
function saveResumeState() {
  try {
    if (["home", "login", "loading", "profile"].includes(state.route)) {
      localStorage.removeItem(ns(RESUME_KEY));
      return;
    }
    const snapshot = {
      state: { ...state },
      quiz: { quizDeck, quizIndex, quizScore, quizSkipped, quizAnswered, quizSelected },
      ws: { wsDeck, wsIndex, wsScore, wsTotalPoints, wsSkippedPoints, wsAnswered, wsSelected, lblItemIndex, lblAssignments, lblSelectedChip, lblChecked },
      fc: { fcDeck, fcIndex, fcFlipped, fcKnown, fcUnknown },
      lab: { labDeck, labIndex, labScore, labTotalBlanks, labSkippedBlanks, lblItemIndex, lblAssignments, lblSelectedChip, lblChecked },
    };
    localStorage.setItem(ns(RESUME_KEY), JSON.stringify(snapshot));
  } catch (e) {}
}
function restoreResumeState() {
  try {
    const raw = localStorage.getItem(ns(RESUME_KEY));
    if (!raw) return false;
    const snap = JSON.parse(raw);
    Object.assign(state, snap.state);
    if (snap.quiz) {
      quizDeck = snap.quiz.quizDeck || []; quizIndex = snap.quiz.quizIndex || 0;
      quizScore = snap.quiz.quizScore || 0; quizSkipped = snap.quiz.quizSkipped || 0;
      quizAnswered = snap.quiz.quizAnswered || false; quizSelected = snap.quiz.quizSelected ?? -1;
    }
    if (snap.ws) {
      wsDeck = snap.ws.wsDeck || []; wsIndex = snap.ws.wsIndex || 0;
      wsScore = snap.ws.wsScore || 0; wsTotalPoints = snap.ws.wsTotalPoints || 0;
      wsSkippedPoints = snap.ws.wsSkippedPoints || 0;
      wsAnswered = snap.ws.wsAnswered || false; wsSelected = snap.ws.wsSelected ?? -1;
      lblItemIndex = snap.ws.lblItemIndex ?? -1; lblAssignments = snap.ws.lblAssignments || {};
      lblSelectedChip = snap.ws.lblSelectedChip || null; lblChecked = snap.ws.lblChecked || false;
    }
    if (snap.fc) {
      fcDeck = snap.fc.fcDeck || []; fcIndex = snap.fc.fcIndex || 0;
      fcFlipped = snap.fc.fcFlipped || false; fcKnown = snap.fc.fcKnown || 0; fcUnknown = snap.fc.fcUnknown || 0;
    }
    if (snap.lab) {
      labDeck = snap.lab.labDeck || []; labIndex = snap.lab.labIndex || 0;
      labScore = snap.lab.labScore || 0; labTotalBlanks = snap.lab.labTotalBlanks || 0;
      labSkippedBlanks = snap.lab.labSkippedBlanks || 0;
      if (state.route === "labeling") {
        lblItemIndex = snap.lab.lblItemIndex ?? -1; lblAssignments = snap.lab.lblAssignments || {};
        lblSelectedChip = snap.lab.lblSelectedChip || null; lblChecked = snap.lab.lblChecked || false;
      }
    }
    return true;
  } catch (e) { return false; }
}

function selectProfile(name) {
  currentProfile = name;
  try { localStorage.setItem(PROFILE_KEY, name); } catch (e) {}
  progressState = loadLocalProgress();      // load THIS profile's data
  if (!restoreResumeState()) state.route = "home";
  render();
  loadProgress();   // pull + merge + push this profile's cloud data
}
function switchProfile() {
  // don't wipe anything — just return to the picker; data stays under each name
  state.route = "profile"; state.sectionKey = null;
  render();
}
function renderProfilePicker(main) {
  const wrap = document.createElement("div");
  wrap.style.cssText = "max-width:440px;margin:52px auto 0;text-align:center;padding:0 18px;";
  wrap.innerHTML = `
    <div style="font-size:2.4rem;margin-bottom:6px;">👥</div>
    <div style="font-weight:800;font-size:1.3rem;color:var(--navy,#1F3864);">Who's studying?</div>
    <div style="color:#666;font-size:.9rem;margin:6px 0 24px;">Your scores, progress, and preparedness are kept separate for each person. We'll remember your pick on this device.</div>`;
  PROFILES.forEach((name, i) => {
    const b = document.createElement("button");
    const colors = ["#1F3864", "#2E74B5", "#2E7D32"];
    b.style.cssText = `display:block;width:100%;margin:11px 0;background:${colors[i % 3]};color:#fff;border:none;border-radius:14px;padding:16px;font-size:1.15rem;font-weight:700;cursor:pointer;`;
    b.textContent = name;
    b.onclick = () => selectProfile(name);
    wrap.appendChild(b);
  });
  main.appendChild(wrap);
}

function initApp() {
  if (!currentProfile) { state.route = "profile"; render(); return; }  // first run on this device → pick a profile
  progressState = loadLocalProgress();
  if (!restoreResumeState()) state.route = "home";
  render();
  loadProgress();   // background: pull this profile's cloud data, merge, re-render
}

/* ---------- CLOUD SYNC (per profile, no login) ----------
   Each profile is one row in the `progress` table keyed by name. On sign-in we
   PULL the cloud copy and merge it into local (idempotent, best-of-both), then
   PUSH the merged result so every device converges. Saves debounce a push. */
let _cloudPushT = null, _cloudBusy = false;
// idempotent "best across devices" merge — safe to run repeatedly without inflating counts
function cloudMerge(into, from) {
  into.quizzes = into.quizzes || {}; into.qstats = into.qstats || {}; into.examAttempts = into.examAttempts || {};
  Object.keys(from.quizzes || {}).forEach(k => {
    const b = from.quizzes[k], a = into.quizzes[k];
    if (!a) { into.quizzes[k] = JSON.parse(JSON.stringify(b)); return; }
    a.bestScore = Math.max(a.bestScore || 0, b.bestScore || 0);
    a.attempts = Math.max(a.attempts || 0, b.attempts || 0);
    if (b.lastDate && (!a.lastDate || b.lastDate > a.lastDate)) { a.lastScore = b.lastScore; a.lastDate = b.lastDate; }
    a.modes = a.modes || {};
    Object.keys(b.modes || {}).forEach(md => {
      const bm = b.modes[md], am = a.modes[md];
      if (!am) { a.modes[md] = JSON.parse(JSON.stringify(bm)); return; }
      am.bestScore = Math.max(am.bestScore || 0, bm.bestScore || 0);
      am.attempts = Math.max(am.attempts || 0, bm.attempts || 0);
      if (bm.bestSec) am.bestSec = am.bestSec ? Math.min(am.bestSec, bm.bestSec) : bm.bestSec;
    });
  });
  Object.keys(from.qstats || {}).forEach(id => {
    const b = from.qstats[id], a = into.qstats[id];
    if (!a) { into.qstats[id] = JSON.parse(JSON.stringify(b)); return; }
    a.seen = Math.max(a.seen || 0, b.seen || 0); a.missed = Math.max(a.missed || 0, b.missed || 0);
    if (b.lastMissed && (!a.lastMissed || b.lastMissed > a.lastMissed)) a.lastMissed = b.lastMissed;
    if (b.m) { a.m = a.m || {};
      Object.keys(b.m).forEach(md => {
        const bm = b.m[md], am = a.m[md];
        if (!am) { a.m[md] = JSON.parse(JSON.stringify(bm)); return; }
        am.s = Math.max(am.s || 0, bm.s || 0); am.c = Math.max(am.c || 0, bm.c || 0);
        am.reps = Math.max(am.reps || 0, bm.reps || 0);
        am.tt = Math.max(am.tt || 0, bm.tt || 0); am.tn = Math.max(am.tn || 0, bm.tn || 0); am.fc = Math.max(am.fc || 0, bm.fc || 0);
        // Retention state: the most recent review (larger t) is authoritative for S/last/t.
        if ((bm.t || 0) > (am.t || 0)) { am.t = bm.t; am.S = bm.S; am.last = bm.last; }
        else if (am.t == null && bm.t != null) { am.t = bm.t; am.S = bm.S; am.last = bm.last; }
      });
    }
  });
  // Question reports — union by id|date|reason so nothing is lost across devices.
  into.reports = into.reports || [];
  { const rs = new Set(into.reports.map(r => (r.id||"")+"|"+(r.date||"")+"|"+(r.reason||"")));
    (from.reports || []).forEach(r => { const k=(r.id||"")+"|"+(r.date||"")+"|"+(r.reason||""); if(!rs.has(k)){rs.add(k); into.reports.push(r);} }); }
  Object.keys(from.examAttempts || {}).forEach(k => {
    const bar = from.examAttempts[k] || [], aar = into.examAttempts[k];
    if (!aar) { into.examAttempts[k] = JSON.parse(JSON.stringify(bar)); return; }
    const seen = new Set(), out = [];
    [...aar, ...bar].forEach(x => { const key = (x.date || "") + ":" + (x.pct ?? "") + ":" + (x.score ?? ""); if (!seen.has(key)) { seen.add(key); out.push(x); } });
    out.sort((x, y) => (y.date || "").localeCompare(x.date || ""));
    into.examAttempts[k] = out.slice(0, 10);
  });
  return into;
}
async function loadProgress() {
  if (!CLOUD_ENABLED || !currentProfile || _cloudBusy) return;
  _cloudBusy = true;
  try {
    const { data, error } = await sb.from("progress").select("data").eq("profile", currentProfile).maybeSingle();
    if (!error && data && data.data && typeof data.data === "object") {
      cloudMerge(progressState, data.data);
      saveLocalProgress();   // persist merged copy on this device
      render();
    }
  } catch (e) {}
  _cloudBusy = false;
  saveProgress(true);   // push the merged result so all devices converge
}
async function saveProgress(immediate) {
  if (!CLOUD_ENABLED || !currentProfile) return;
  if (!immediate) { clearTimeout(_cloudPushT); _cloudPushT = setTimeout(() => saveProgress(true), 2500); return; }
  try { await sb.from("progress").upsert({ profile: currentProfile, data: progressState, updated_at: new Date().toISOString() }); } catch (e) {}
}

/* Study mode: "closed" = closed-book (true recall) vs "open" = with notes.
   Stored per device; each quiz result is tagged with the active mode. */
function getStudyMode() { try { return localStorage.getItem(ns("biol250_studyMode")) === "open" ? "open" : "closed"; } catch (e) { return "closed"; } }
/* Per-question answer-speed clock (all self-paced modes). Stamped once when a fresh question is shown. */
var _qShownAt = 0, _qShownKey = "";
function markQuestionShown(key) { if (_qShownKey !== key) { _qShownKey = key; _qShownAt = Date.now(); } }
function qElapsed() { return _qShownAt ? Date.now() - _qShownAt : 0; }
function setStudyMode(m) { try { localStorage.setItem(ns("biol250_studyMode"), m); } catch (e) {} }

/* Per-question stats by unique ID: how often each question is seen vs missed.
   Powers the "Questions You Keep Missing" view. */
function recordQuestionStat(q, wasCorrect, elapsedMs) {
  if (!q || !q.id) return;
  if (!progressState.qstats) progressState.qstats = {};
  const s = progressState.qstats[q.id] || { seen: 0, missed: 0 };
  s.seen += 1;
  if (!wasCorrect) { s.missed += 1; s.lastMissed = new Date().toISOString(); }
  // per-mode mastery (closed-book vs with-notes) — powers Performance / Readiness / Book-Knowledge.
  // Retention model: each question carries a memory half-life S (days) + last-review time t.
  // Spacing-aware: a correct answer near the forgetting point grows S a lot; an immediate repeat
  // barely moves it. A miss decays S (doesn't erase it). Recall today = 2^(-Δt/S) (see qRecall).
  const md = (typeof getStudyMode === "function" ? getStudyMode() : "closed");
  s.m = s.m || {};
  const mm = s.m[md] || { s: 0, c: 0, last: 0 };
  const now = Date.now();
  const dtDays = mm.t ? Math.max(0, (now - mm.t) / 86400000) : null;
  mm.s += 1;
  if (wasCorrect) {
    mm.c += 1;
    if (!mm.S) mm.S = RET_S0;                                   // first correct: initial half-life
    else { const ratio = Math.min((dtDays == null ? 0 : dtDays) / mm.S, 2); mm.S = mm.S * (1 + RET_GROW * ratio); }
  } else {
    mm.S = Math.max(RET_SMIN, RET_LAPSE * (mm.S || RET_S0));    // lapse: decay, keep some credit
  }
  mm.last = wasCorrect ? 1 : 0;
  mm.t = now;
  mm.reps = (mm.reps || 0) + 1;
  // response-time tracking (for recognition-vs-mastery analysis): rolling total + fast-correct count
  if (elapsedMs && elapsedMs > 0 && elapsedMs < 120000) {
    mm.tt = (mm.tt || 0) + elapsedMs; mm.tn = (mm.tn || 0) + 1;
    if (wasCorrect && elapsedMs < 4000) mm.fc = (mm.fc || 0) + 1;
  }
  s.m[md] = mm;
  progressState.qstats[q.id] = s;
  if (typeof _predVer !== "undefined") _predVer++;   // invalidate predicted-score memo
  saveLocalProgress();
}
/* ---- Retention / forgetting-curve engine (metrics only; no effect on quiz/exam timing) ---- */
var RET_S0 = 3, RET_GROW = 0.9, RET_LAPSE = 0.4, RET_SMIN = 1; // half-life days / growth / lapse mult / floor
/* Probability you'd recall this question TODAY, in the given mode (0..1).
   0 if your most recent answer was wrong (you're not currently reliable on it).
   Legacy entries answered correctly before this update (no timestamp) get a modest fixed credit. */
var _recallCache = {}, _recallVer = -1;   // per-render memo (metrics call qRecall tens of thousands of times)
function qRecall(id, mode) {
  if (_recallVer !== _predVer) { _recallCache = {}; _recallVer = _predVer; }
  const k = mode + "" + id + "" + (state && state.allTime ? 1 : 0);
  const cached = _recallCache[k]; if (cached !== undefined) return cached;
  const st = (activeProgress().qstats || {})[id];
  const mm = st && st.m && st.m[mode];
  let r;
  if (!mm || mm.last !== 1) r = 0;
  else if (!mm.S || !mm.t) r = 1;                              // legacy correct (pre-timestamp) = full credit; converts to the forgetting curve on next practice
  else r = Math.min(1, Math.pow(2, -((Date.now() - mm.t) / 86400000) / mm.S));
  _recallCache[k] = r; return r;
}
/* Chance of answering right on the exam even if not fully recalled: recall + guess/elimination credit. */
function qExamProb(id, mode, guess) {
  const p = qRecall(id, mode); const g = (guess == null ? 0.2 : guess);
  return p + (1 - p) * g;
}

/* ---------- FRESH-START RESET + ALL-TIME ARCHIVE ----------
   "Start fresh" folds your current data into an all-time archive and clears the
   live view, so you can study again from zero without losing anything. The
   all-time view merges the archive with your current data. */
const ARCHIVE_KEY = "biol250_alltime_v1";
function loadArchive() { try { return JSON.parse(localStorage.getItem(ns(ARCHIVE_KEY))) || { quizzes:{}, qstats:{}, examAttempts:{} }; } catch (e) { return { quizzes:{}, qstats:{}, examAttempts:{} }; } }
function saveArchive(a) { try { localStorage.setItem(ns(ARCHIVE_KEY), JSON.stringify(a)); } catch (e) {} }
function mergeProgress(into, from) {
  into.quizzes = into.quizzes || {}; into.qstats = into.qstats || {}; into.examAttempts = into.examAttempts || {};
  Object.keys(from.quizzes || {}).forEach(k => {
    const b = from.quizzes[k], a = into.quizzes[k];
    if (!a) { into.quizzes[k] = JSON.parse(JSON.stringify(b)); return; }
    a.bestScore = Math.max(a.bestScore || 0, b.bestScore || 0);
    a.attempts = (a.attempts || 0) + (b.attempts || 0);
    a.lastScore = b.lastScore; a.lastDate = b.lastDate; a.modes = a.modes || {};
    Object.keys(b.modes || {}).forEach(md => {
      const bm = b.modes[md], am = a.modes[md];
      if (!am) { a.modes[md] = JSON.parse(JSON.stringify(bm)); return; }
      am.bestScore = Math.max(am.bestScore || 0, bm.bestScore || 0);
      am.attempts = (am.attempts || 0) + (bm.attempts || 0);
      if (bm.bestSec) am.bestSec = am.bestSec ? Math.min(am.bestSec, bm.bestSec) : bm.bestSec;
    });
  });
  Object.keys(from.qstats || {}).forEach(id => {
    const b = from.qstats[id], a = into.qstats[id];
    if (!a) { into.qstats[id] = JSON.parse(JSON.stringify(b)); return; }
    a.seen = (a.seen || 0) + (b.seen || 0); a.missed = (a.missed || 0) + (b.missed || 0);
    if (b.lastMissed && (!a.lastMissed || b.lastMissed > a.lastMissed)) a.lastMissed = b.lastMissed;
    if (b.m) { a.m = a.m || {};
      Object.keys(b.m).forEach(md => {
        const bm = b.m[md], am = a.m[md];
        if (!am) { a.m[md] = JSON.parse(JSON.stringify(bm)); return; }
        am.s = (am.s || 0) + (bm.s || 0); am.c = (am.c || 0) + (bm.c || 0);
        am.reps = Math.max(am.reps || 0, bm.reps || 0);
        am.tt = (am.tt || 0) + (bm.tt || 0); am.tn = (am.tn || 0) + (bm.tn || 0); am.fc = (am.fc || 0) + (bm.fc || 0);
        if ((bm.t || 0) > (am.t || 0)) { am.t = bm.t; am.S = bm.S; am.last = bm.last; }
        else if (am.t == null && bm.t != null) { am.t = bm.t; am.S = bm.S; am.last = bm.last; }
      });
    }
  });
  into.reports = into.reports || [];
  { const rs = new Set(into.reports.map(r => (r.id||"")+"|"+(r.date||"")+"|"+(r.reason||"")));
    (from.reports || []).forEach(r => { const k=(r.id||"")+"|"+(r.date||"")+"|"+(r.reason||""); if(!rs.has(k)){rs.add(k); into.reports.push(r);} }); }
  return into;
}
/* All-time view = archive merged with current. This is expensive (parse + deep-clone + merge),
   and the metrics engine calls activeProgress() thousands of times per render, so memoize it:
   cached per data-version (_predVer) within a short time window. */
var _atMemo = null, _atKey = "";
function getAllTimeProgress() {
  const key = (typeof _predVer === "number" ? _predVer : 0) + "|" + Math.floor(Date.now() / 1500);
  if (_atMemo && _atKey === key) return _atMemo;
  const m = JSON.parse(JSON.stringify(loadArchive())); mergeProgress(m, progressState);
  _atMemo = m; _atKey = key; return m;
}
function activeProgress() { return state.allTime ? getAllTimeProgress() : progressState; }
function resetCurrentData() {
  const arch = loadArchive();
  mergeProgress(arch, progressState);   // preserve everything in all-time
  saveArchive(arch);
  progressState = { flashcards: {}, quizzes: {}, examAttempts: {}, qstats: {} };
  saveLocalProgress();
  saveMissedQs([]);                     // fresh missed list too
}

/* ---------- QUESTION REPORTS (wrong answer / formatting) ----------
   Device-wide (bank QA, not per-person stats) with reporter attribution. */
const REPORTS_KEY = "biol250_reports_v1"; // legacy device-local key (migrated into progressState.reports so reports SYNC)
function loadReports() {
  if (!progressState.reports) {
    let legacy = []; try { legacy = JSON.parse(localStorage.getItem(REPORTS_KEY)) || []; } catch (e) {}
    progressState.reports = legacy;   // one-time migration; from here reports live in synced progress
  }
  return progressState.reports;
}
function saveReports(a) { progressState.reports = a; saveLocalProgress(); }
function addReport(q, reason, note) {
  if (!q) return;
  const reports = loadReports();
  reports.unshift({
    id: q.id || null, q: q.q,
    correct: (q.options && typeof q.correct === "number") ? q.options[q.correct] : null,
    options: q.options || null, reason, note: note || "",
    by: currentProfile || "guest", date: new Date().toISOString(), resolved: false,
  });
  saveReports(reports);
}
function toast(msg) {
  const t = document.createElement("div");
  t.textContent = msg;
  t.style.cssText = "position:fixed;left:50%;bottom:28px;transform:translateX(-50%);background:#1F3864;color:#fff;padding:10px 18px;border-radius:22px;font-size:.9rem;font-weight:700;z-index:2000;box-shadow:0 4px 16px rgba(0,0,0,.3);";
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 1800);
}
function openReportDialog(q) {
  const ov = document.createElement("div");
  ov.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1500;display:flex;align-items:flex-start;justify-content:center;";
  ov.onclick = (e) => { if (e.target === ov) ov.remove(); };
  const box = document.createElement("div");
  box.style.cssText = "background:#fff;max-width:430px;width:92%;margin-top:56px;border-radius:14px;padding:18px;max-height:82vh;overflow:auto;";
  box.innerHTML = `<div style="font-weight:800;font-size:1.05rem;color:#1F3864;margin-bottom:4px;">🚩 Report this question</div>
    <div style="font-size:.8rem;color:#888;margin-bottom:12px;">${escapeHtml((q.q || "").slice(0, 110))}${(q.q||"").length>110?"…":""}${q.id?` <span style="color:#bbb;">(${q.id})</span>`:""}</div>`;
  let reason = null;
  const rWrap = document.createElement("div"); rWrap.style.cssText = "display:flex;flex-direction:column;gap:8px;";
  [["❌ Wrong answer", "wrong_answer"], ["✏️ Formatting / typo", "formatting"], ["❓ Confusing / other", "other"]].forEach(([lbl, val]) => {
    const b = document.createElement("button"); b.textContent = lbl;
    b.style.cssText = "text-align:left;border:1.5px solid #ddd;background:#fff;border-radius:10px;padding:11px;font-size:.92rem;cursor:pointer;";
    b.onclick = () => { reason = val; rWrap.querySelectorAll("button").forEach(x => { x.style.background = "#fff"; x.style.borderColor = "#ddd"; }); b.style.background = "#EAF3FB"; b.style.borderColor = "#2E74B5"; };
    rWrap.appendChild(b);
  });
  box.appendChild(rWrap);
  const ta = document.createElement("textarea"); ta.placeholder = "Optional: what's wrong, or what the answer should be";
  ta.style.cssText = "width:100%;margin-top:10px;border:1px solid #ddd;border-radius:8px;padding:8px;font-size:.85rem;min-height:54px;box-sizing:border-box;";
  box.appendChild(ta);
  const row = document.createElement("div"); row.style.cssText = "display:flex;gap:8px;margin-top:12px;";
  const submit = document.createElement("button"); submit.textContent = "Submit report";
  submit.style.cssText = "flex:1;background:#C62828;color:#fff;border:none;border-radius:10px;padding:11px;font-weight:700;cursor:pointer;";
  submit.onclick = () => { if (!reason) { alert("Pick a reason first."); return; } addReport(q, reason, ta.value.trim()); ov.remove(); toast("Reported — thanks! 🚩"); };
  const cancel = document.createElement("button"); cancel.textContent = "Cancel";
  cancel.style.cssText = "border:1px solid #ccc;background:#fff;border-radius:10px;padding:11px 14px;cursor:pointer;";
  cancel.onclick = () => ov.remove();
  row.appendChild(submit); row.appendChild(cancel); box.appendChild(row);
  ov.appendChild(box); document.body.appendChild(ov);
}
function reportBtn(q) {
  const b = document.createElement("button");
  b.textContent = "🚩 Report";
  b.style.cssText = "background:none;border:none;color:#b06a6a;font-size:.78rem;cursor:pointer;padding:4px 6px;";
  b.onclick = (e) => { e.stopPropagation(); openReportDialog(q); };
  return b;
}

function recordQuizResult(key, score, total, avgSec) {
  const pct = Math.round((score / total) * 100);
  const prev = progressState.quizzes[key] || {};
  const mode = getStudyMode();
  const modes = prev.modes || {};
  const pm = modes[mode] || { bestScore: 0, attempts: 0 };
  pm.attempts = (pm.attempts || 0) + 1;
  pm.bestScore = Math.max(pm.bestScore || 0, pct);
  pm.lastScore = pct;
  if (typeof avgSec === "number" && isFinite(avgSec) && avgSec > 0) {
    pm.lastSec = Math.round(avgSec * 10) / 10;
    pm.bestSec = pm.bestSec ? Math.min(pm.bestSec, pm.lastSec) : pm.lastSec;
  }
  modes[mode] = pm;
  progressState.quizzes[key] = {
    lastScore: pct,
    attempts: (prev.attempts || 0) + 1,
    bestScore: Math.max(prev.bestScore || 0, pct),
    lastDate: new Date().toISOString(),
    modes: modes,
  };
  saveLocalProgress();
  saveProgress();
}

/* Unified attempt log — every exam / mock / timed / quiz writes one dated record here so the
   History screen can show them all on one timeline. Records keep the fields the per-exam pickers
   already read (date/score/total/pct/missed) plus ts/title/kind/mode for the timeline. */
function recordAttempt(key, meta) {
  if (!progressState.examAttempts) progressState.examAttempts = {};
  if (!progressState.examAttempts[key]) progressState.examAttempts[key] = [];
  const now = new Date();
  const rec = Object.assign({
    ts: now.getTime(),
    date: now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    time: now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  }, meta);
  progressState.examAttempts[key].unshift(rec);
  if (progressState.examAttempts[key].length > 12) progressState.examAttempts[key].length = 12;
  saveLocalProgress();
}

function recordFlashcardResult(key, known, total) {
  const pct = Math.round((known / total) * 100);
  const prev = progressState.flashcards[key];
  progressState.flashcards[key] = {
    lastScore: pct,
    attempts: (prev ? prev.attempts : 0) + 1,
    bestScore: prev ? Math.max(prev.bestScore, pct) : pct,
    lastDate: new Date().toISOString(),
  };
  saveLocalProgress();
  saveProgress();
}

function getSection(key) {
  if (key === "cumulative") {
    const merged = { title: "Cumulative (Final Review)", flashcards: [], quiz: [], images: [] };
    for (const k of ["lab1", "lab2", "appendicular", "axial", "torso"]) {
      const s = DATA.sections[k];
      merged.flashcards.push(...s.flashcards);
      merged.quiz.push(...s.quiz.map(q => ({ ...q })));
      merged.images.push(...s.images);
    }
    return merged;
  }
  return DATA.sections[key];
}

const state = { route: "home", sectionKey: null, mode: null, subtopicIndex: null, cameFromSubtopics: false, quizFilter: null, quizSource: null, cbIndex: -1, examSource: null, prevRoute: null, grSection: -1 };

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function render() {
  const app = document.getElementById("app");
  app.innerHTML = "";
  app.appendChild(buildTopbar());
  const main = document.createElement("main");
  main.id = "main";
  app.appendChild(main);

  if (state.route === "loading") renderLoading(main);
  else if (state.route === "login") renderLogin(main);
  else if (state.route === "profile") renderProfilePicker(main);
  else if (state.route === "home") renderHome(main);
  else if (state.route === "modes") renderModes(main);
  else if (state.route === "sectionMenu") renderSectionMenu(main);
  else if (state.route === "flashcards") renderFlashcards(main);
  else if (state.route === "quiz") renderQuiz(main);
  else if (state.route === "gallery") renderGallery(main);
  else if (state.route === "diagramGallery") renderDiagramGallery(main);
  else if (state.route === "preparedness") renderPreparedness(main);
  else if (state.route === "coach") renderCoach(main);
  else if (state.route === "history") renderHistory(main);
  else if (state.route === "missedStats") renderMissedStats(main);
  else if (state.route === "reports") renderReports(main);
  else if (state.route === "subtopics") renderSubtopics(main);
  else if (state.route === "worksheet") renderWorksheet(main);
  else if (state.route === "labeling") renderLabeling(main);
  else if (state.route === "examPicker") renderExamPicker(main);
  else if (state.route === "exam") renderExam(main);
  else if (state.route === "examResults") renderExamResults(main);
  else if (state.route === "simPicker") renderSimPicker(main);
  else if (state.route === "simExam") renderSimExam(main);
  else if (state.route === "simReview") renderSimReview(main);
  else if (state.route === "missedReview") renderMissedReview(main);
  else if (state.route === "cbPicker") renderCbPicker(main);
  else if (state.route === "grMenu")       renderGrMenu(main);
  else if (state.route === "examMenu")     renderExamMenu(main);
  else if (state.route === "diagramMenu")  renderDiagramMenu(main);
  else if (state.route === "suddenDeath")  renderSuddenDeath(main);
  else if (state.route === "sdEnd")        renderSdEnd(main);
  else if (state.route === "customBuilder") renderCustomBuilder(main);
  else if (state.route === "stuviaMenu")    renderStuviaMenu(main);
  else if (state.route === "claudeMenu")    renderClaudeMenu(main);
  else if (state.route === "fullExam")       renderFullExam(main);
  else if (state.route === "fullExamEnd")    renderFullExamEnd(main);

  saveResumeState();
}

function buildTopbar() {
  const bar = document.createElement("div");
  bar.className = "topbar";
  const left = document.createElement("div");
  left.style.display = "flex";
  left.style.alignItems = "center";

  const noBackRoutes = ["home", "login", "loading", "profile"];
  if (!noBackRoutes.includes(state.route)) {
    const back = document.createElement("button");
    back.className = "backBtn";
    back.textContent = "‹ Back";
    back.onclick = () => {
      if (state.route === "sectionMenu" || state.route === "modes") { state.route = "home"; state.sectionKey = null; }

      else if (state.route === "grMenu")        { state.route = "sectionMenu"; state.grSection = -1; }
      else if (state.route === "examMenu")      state.route = "sectionMenu";
      else if (state.route === "stuviaMenu")    state.route = "sectionMenu";
      else if (state.route === "claudeMenu")    state.route = "sectionMenu";
      else if (state.route === "diagramMenu")   state.route = "sectionMenu";
      else if (state.route === "diagramGallery") state.route = "sectionMenu";
      else if (state.route === "preparedness") state.route = "sectionMenu";
      else if (state.route === "coach") state.route = "preparedness";
      else if (state.route === "history") state.route = "examMenu";
      else if (state.route === "missedStats") state.route = "preparedness";
      else if (state.route === "reports") state.route = "home";
      else if (state.route === "cbPicker")      state.route = "sectionMenu";
      else if (state.route === "customBuilder") state.route = "home";
      else if (state.route === "subtopics")     { state.route = state.prevRoute || "grMenu"; state.mode = null; }
      else if (state.route === "quiz" && state.quizSource === "claudebank") {
        state.route = "cbPicker"; quizDeck = []; state.quizSource = null; state.cbIndex = -1;
      } else if (state.route === "quiz" && state.quizSource === "custom") {
        quizDeck = []; state.quizSource = null; state.route = "customBuilder";
      } else if (state.route === "quiz" && state.cameFromSubtopics) {
        state.route = "subtopics"; quizDeck = []; state.subtopicIndex = null; state.cameFromSubtopics = false;
      } else if (state.route === "quiz") {
        const _qBack = state.sectionKey === "lab2" ? "modes" : "grMenu";
        quizDeck = []; state.route = state.prevRoute || _qBack;
      } else if (state.route === "worksheet")   { wsDeck = []; state.mode = null; state.route = state.sectionKey === "lab2" ? "modes" : "grMenu"; }
      else if (state.route === "flashcards")    { state.mode = null; state.route = state.sectionKey === "lab2" ? "modes" : "grMenu"; }
      else if (state.route === "examPicker")    { state.mode = null; state.route = "examMenu"; }
      else if (state.route === "simPicker")     { state.mode = null; state.route = "examMenu"; }
      else if (state.route === "simExam")       { simStopTimer(); state.route = "simPicker"; }
      else if (state.route === "simReview")     state.route = "simExam";
      else if (state.route === "missedReview")  { missedDeck = []; state.route = "examMenu"; }
      else if (state.route === "suddenDeath" || state.route === "sdEnd") { sdDeck = []; state.route = "examMenu"; }
      else if (state.route === "fullExam") { if (confirm("Leave exam? Progress will be lost.")) { clearInterval(fullExamTimerInterval); fullExamTimerInterval = null; fullExamDeck = []; state.route = "examMenu"; } return; }
      else if (state.route === "fullExamEnd") { fullExamDeck = []; state.route = "examMenu"; }
      else if (state.route === "labeling")      state.route = "diagramMenu";
      else if (state.route === "gallery")       state.route = "diagramMenu";
      else if (state.route === "exam" || state.route === "examResults") {
        examStopTimer();
        if (state.examSource === "gr")     { state.examSource = null; state.route = "grMenu"; }
        else if (state.examSource === "custom") { state.examSource = null; state.route = "customBuilder"; }
        else { state.route = "examPicker"; }
      } else { state.route = "sectionMenu"; state.mode = null; state.subtopicIndex = null; state.cameFromSubtopics = false; }
      render();
    };
    left.appendChild(back);
  }
  const h1 = document.createElement("h1");
  let titleText;
  const _sec4t = getSection(state.sectionKey);
  const _secName = _sec4t ? _sec4t.title : "BIOL 250";
  if (noBackRoutes.includes(state.route)) titleText = "BIOL 250 Study";
  else if (state.route === "sectionMenu" || state.route === "modes") titleText = _secName.split(" (")[0];
  else if (state.route === "grMenu")        titleText = "Guided Readings";
  else if (state.route === "examMenu")      titleText = "Practice Tests";
  else if (state.route === "diagramMenu")   titleText = "Diagrams";
  else if (state.route === "diagramGallery") titleText = "Diagram Gallery";
  else if (state.route === "preparedness") titleText = "Preparedness Score";
  else if (state.route === "coach") titleText = "How am I doing?";
  else if (state.route === "history") titleText = "History";
  else if (state.route === "missedStats") titleText = "Questions You Keep Missing";
  else if (state.route === "reports") titleText = "Flagged Questions";
  else if (state.route === "stuviaMenu")     titleText = "Stuvia Bank";
  else if (state.route === "claudeMenu")     titleText = "Claude Bank";
  else if (state.route === "fullExam")        titleText = state.examTitle || "Simulation";
  else if (state.route === "fullExamEnd")     titleText = (state.examTitle || "Simulation") + " Results";
  else if (state.route === "customBuilder") titleText = "Custom Practice";
  else if (state.route === "cbPicker")      titleText = "Claude Bank";
  else if (state.route === "suddenDeath" || state.route === "sdEnd") titleText = "Sudden Death 🔥";
  else if (state.route === "quiz" && state.quizSource === "custom") titleText = "Custom Practice";
  else if (state.route === "quiz" && state.quizSource === "claudebank")
    titleText = (state.cbIndex >= 0 && typeof CLAUDEBANK !== "undefined" && CLAUDEBANK[state.cbIndex])
      ? CLAUDEBANK[state.cbIndex].title : "ClaudeBank — All Topics";
  else if (state.route === "quiz" && state.cameFromSubtopics && state.subtopicIndex != null)
    titleText = getSection(state.sectionKey).subtopics[state.subtopicIndex].title;
  else if (state.route === "simPicker")     titleText = "Exam Simulation";
  else if ((state.route === "simExam" || state.route === "simReview") && state.examTitle) titleText = state.examTitle;
  else if (state.route === "missedReview")  titleText = "Missed Questions";
  else if (state.route === "examPicker")    titleText = "Timed Exams";
  else if (state.route === "exam" && state.examSource === "gr")     titleText = "Timed GR Questions";
  else if (state.route === "examResults" && state.examSource === "gr") titleText = "GR Results";
  else if (state.route === "exam" && state.examSource === "custom") titleText = "Custom Practice";
  else if ((state.route === "exam" || state.route === "examResults") && state.examTitle) titleText = state.examTitle;
  else titleText = _secName;
  h1.textContent = titleText;
  left.appendChild(h1);
  bar.appendChild(left);

  // Right side: persistent "signed in as" chip on every screen (tap to switch)
  const right = document.createElement("div");
  right.style.cssText = "display:flex;align-items:center;gap:8px;";
  if (currentProfile && !["profile", "loading"].includes(state.route)) {
    const idchip = document.createElement("button");
    idchip.innerHTML = `<span style="opacity:.8;">👤</span>&nbsp;<b>${escapeHtml(currentProfile)}</b>`;
    idchip.title = "Switch profile";
    idchip.style.cssText = "display:flex;align-items:center;background:#1F3864;color:#fff;border:none;border-radius:16px;padding:5px 13px;font-size:.82rem;cursor:pointer;white-space:nowrap;";
    idchip.onclick = () => switchProfile();
    right.appendChild(idchip);
  }
  if (CLOUD_ENABLED && authUser && !noBackRoutes.includes(state.route)) {
    const signOut = document.createElement("button");
    signOut.className = "signOutBtn";
    signOut.textContent = "Sign out";
    signOut.onclick = () => { sb.auth.signOut(); };
    right.appendChild(signOut);
  }
  bar.appendChild(right);
  return bar;
}

/* ---------------- LOADING / LOGIN ---------------- */
function renderLoading(main) {
  const wrap = document.createElement("div");
  wrap.className = "resultWrap";
  wrap.innerHTML = `<div class="resultLabel">Loading your progress…</div>`;
  main.appendChild(wrap);
}

function renderLogin(main) {
  const wrap = document.createElement("div");
  wrap.className = "authWrap";

  const title = document.createElement("div");
  title.className = "authTitle";
  title.textContent = authMode === "signin" ? "Sign in" : "Create your account";
  wrap.appendChild(title);

  const sub = document.createElement("div");
  sub.className = "subtitle";
  sub.textContent = "Private study group access — your progress saves to your account only.";
  wrap.appendChild(sub);

  const form = document.createElement("form");
  form.className = "authForm";

  const emailInput = document.createElement("input");
  emailInput.type = "email"; emailInput.placeholder = "Email"; emailInput.required = true;
  emailInput.className = "authInput"; emailInput.autocomplete = "email";
  form.appendChild(emailInput);

  const pwInput = document.createElement("input");
  pwInput.type = "password"; pwInput.placeholder = "Password"; pwInput.required = true;
  pwInput.minLength = 6; pwInput.className = "authInput";
  pwInput.autocomplete = authMode === "signin" ? "current-password" : "new-password";
  form.appendChild(pwInput);

  if (authError) {
    const err = document.createElement("div");
    err.className = "authError";
    err.textContent = authError;
    form.appendChild(err);
  }

  const submitBtn = document.createElement("button");
  submitBtn.type = "submit";
  submitBtn.className = "primaryBtn authSubmit";
  submitBtn.textContent = authBusy ? "Please wait…" : (authMode === "signin" ? "Sign in" : "Sign up");
  submitBtn.disabled = authBusy;
  form.appendChild(submitBtn);

  form.onsubmit = async (e) => {
    e.preventDefault();
    authError = ""; authBusy = true; render();
    const email = emailInput.value.trim();
    const password = pwInput.value;
    const result = authMode === "signin"
      ? await sb.auth.signInWithPassword({ email, password })
      : await sb.auth.signUp({ email, password });
    authBusy = false;
    if (result.error) { authError = result.error.message; render(); return; }
    if (authMode === "signup" && !result.data.session) {
      authMode = "signin";
      authError = "Check your email to confirm your account, then sign in.";
      render();
      return;
    }
    authUser = result.data.session.user;
    await loadProgress();
    state.route = "home";
    render();
  };

  wrap.appendChild(form);

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "authToggle";
  toggle.textContent = authMode === "signin" ? "Need an account? Sign up" : "Already have an account? Sign in";
  toggle.onclick = () => { authMode = authMode === "signin" ? "signup" : "signin"; authError = ""; render(); };
  wrap.appendChild(toggle);

  main.appendChild(wrap);
}

const HOME_ACCENT = {
  torso:        { c1: "#E9605A", c2: "#C0392B" },   // coral/red
  axial:        { c1: "#3E86C9", c2: "#2E74B5" },   // blue
  appendicular: { c1: "#D9A441", c2: "#B7791F" },   // amber / bone
  lab1:         { c1: "#7C4DD6", c2: "#5B21B6" },   // violet
  lab2:         { c1: "#14A090", c2: "#0F766E" },   // teal
};
function renderHome(main) {
  ensureHoverStyle();
  const wrap = document.createElement("div");
  wrap.style.cssText = "max-width:860px;margin:0 auto;padding:0 6px;";

  // Reports pill (clearly a quality-flag tool, not part of studying)
  const nRep = loadReports().filter(r => !r.resolved).length;
  const repRow = document.createElement("div");
  repRow.style.cssText = "display:flex;justify-content:flex-end;margin:2px 0 4px;";
  const rep = document.createElement("button");
  rep.className = "pillBtn";
  rep.innerHTML = `🚩 Flagged questions${nRep ? ` <b>${nRep}</b>` : ""}`;
  rep.title = "Report a question with a wrong or confusing answer — for quality review, not for studying.";
  rep.style.cssText = "border:1px solid #e3c9c9;background:#fff;color:#C62828;border-radius:14px;padding:4px 13px;font-size:.76rem;font-weight:700;cursor:pointer;";
  rep.onclick = () => { state.route = "reports"; render(); };
  repRow.appendChild(rep);
  wrap.appendChild(repRow);

  // Hero
  const hero = document.createElement("div");
  hero.style.cssText = "text-align:center;margin:6px 0 22px;";
  hero.innerHTML = `
    <div style="font-family:Georgia,'Times New Roman',serif;font-size:2rem;font-weight:800;color:#1F3864;letter-spacing:-.01em;">BIOL 250 <span style="color:#0F766E;">Study</span></div>
    <div style="color:#7c8598;font-size:.95rem;margin-top:4px;">Human Anatomy — timed practice, real-exam sims &amp; a coach that tells you what to study next.</div>`;
  wrap.appendChild(hero);

  const makeCard = (key, s) => {
    const ac = HOME_ACCENT[key] || { c1: "#64748b", c2: "#475569" };
    const card = document.createElement("button");
    card.className = "homeCard";
    card.style.cssText = "position:relative;overflow:hidden;text-align:left;background:#fff;border:1px solid #ece7dd;border-radius:18px;padding:0;cursor:pointer;box-shadow:0 2px 10px rgba(31,56,100,.06);display:block;width:100%;";
    card.innerHTML = `
      <div style="height:6px;background:linear-gradient(90deg,${ac.c1},${ac.c2});"></div>
      <div style="padding:16px 18px 18px;">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">
          <span style="flex:0 0 auto;width:46px;height:46px;border-radius:13px;background:linear-gradient(135deg,${ac.c1}22,${ac.c2}22);display:flex;align-items:center;justify-content:center;font-size:1.5rem;">${ICONS[key] || "📘"}</span>
          <span style="font-family:Georgia,serif;font-size:1.28rem;font-weight:800;color:#1F2937;">${s.title.split(" (")[0]}</span>
        </div>
        <div style="color:#6b7280;font-size:.86rem;line-height:1.4;min-height:2.4em;">${META[key] || ""}</div>
        <div style="margin-top:12px;display:inline-flex;align-items:center;gap:6px;font-size:.8rem;font-weight:700;color:${ac.c2};background:${ac.c1}14;border-radius:999px;padding:4px 11px;">
          ${s.flashcards.length} cards&nbsp;·&nbsp;${s.quiz.length} questions</div>
      </div>`;
    card.onclick = () => { state.sectionKey = key; state.route = key === "lab2" ? "modes" : "sectionMenu"; render(); };
    return card;
  };

  const section = (label, hint, keys) => {
    const hdr = document.createElement("div");
    hdr.style.cssText = "display:flex;align-items:baseline;gap:10px;margin:22px 4px 12px;border-bottom:1px solid #e7e2d6;padding-bottom:6px;";
    hdr.innerHTML = `<span style="font-family:Georgia,serif;font-size:1.15rem;font-weight:800;color:#0F766E;">${label}</span><span style="color:#9aa2b1;font-size:.82rem;">${hint}</span>`;
    wrap.appendChild(hdr);
    const grid = document.createElement("div");
    grid.style.cssText = "display:grid;grid-template-columns:repeat(auto-fit,minmax(232px,1fr));gap:14px;";
    keys.forEach(k => { const s = DATA.sections[k]; if (s) grid.appendChild(makeCard(k, s)); });
    wrap.appendChild(grid);
  };

  section("Lecture", "Regional & systemic anatomy", ["torso", "axial", "appendicular"]);
  section("Lab", "Lab manual, worksheets & practicals", ["lab1", "lab2"]);

  // Cumulative — full-width standout
  const cum = document.createElement("button");
  cum.className = "homeCard";
  cum.style.cssText = "display:block;width:100%;text-align:left;margin-top:22px;border:none;border-radius:18px;overflow:hidden;cursor:pointer;background:linear-gradient(135deg,#0F766E,#134E4A);box-shadow:0 6px 20px rgba(15,118,110,.28);";
  cum.innerHTML = `<div style="padding:18px 20px;display:flex;align-items:center;gap:14px;">
      <span style="font-size:1.9rem;">${ICONS.cumulative || "🎓"}</span>
      <span><span style="display:block;font-family:Georgia,serif;font-size:1.25rem;font-weight:800;color:#fff;">Cumulative — Final Review</span>
      <span style="display:block;color:rgba(255,255,255,.85);font-size:.85rem;margin-top:2px;">${META.cumulative || "Everything, mixed — full-course review"}</span></span>
    </div>`;
  cum.onclick = () => { state.sectionKey = "cumulative"; state.route = "sectionMenu"; render(); };
  wrap.appendChild(cum);

  // Custom Practice — dashed, understated
  const customCard = document.createElement("button");
  customCard.className = "homeCard";
  customCard.style.cssText = "display:block;width:100%;text-align:left;margin-top:14px;background:#faf8f2;border:1.5px dashed #cbb98f;border-radius:18px;cursor:pointer;padding:15px 18px;";
  customCard.innerHTML = `<div style="display:flex;align-items:center;gap:12px;">
      <span style="font-size:1.5rem;">🎯</span>
      <span><span style="display:block;font-family:Georgia,serif;font-size:1.1rem;font-weight:800;color:#374151;">Custom Practice</span>
      <span style="display:block;color:#8a8574;font-size:.83rem;">Mix any topics, set your count &amp; timer, launch your own session</span></span>
    </div>`;
  customCard.onclick = () => { state.sectionKey = null; state.route = "customBuilder"; render(); };
  wrap.appendChild(customCard);

  main.appendChild(wrap);
}

function renderModes(main) {
  const sec = getSection(state.sectionKey);
  const sub = document.createElement("div");
  sub.className = "subtitle";
  sub.textContent = META[state.sectionKey] || "";
  main.appendChild(sub);

  // Build grouped sections
  const labelingCount = sec.subtopics
    ? sec.subtopics.reduce((s, st) => s + (st.labeling ? st.labeling.length : 0), 0) : 0;
  const split = countSplit(sec.quiz);

  const groups = [];

  // ── Guided Readings ────────────────────────────────────────────────────────
  const grModes = [
    { id: "flashcards", icon: "🗂️", label: "Flashcards",
      desc: `${sec.flashcards.length} term/def cards — flip & self-rate` },
    { id: "grTimed", icon: "⏱️", label: "Timed Questions",
      desc: `${split.content} GR questions · 30 s each · scored` },
  ];
  if (sec.subtopics && sec.subtopics.length) {
    grModes.push({ id: "subtopics", filter: "content", icon: "📚", label: "Quiz by Topic",
      desc: `${sec.subtopics.length} topics — drill one at a time` });
    grModes.push({ id: "worksheet", icon: "📋", label: "Worksheet Walkthrough",
      desc: `All topics in order, front to back` });
  }
  grModes.push({ id: "quiz", filter: "content", icon: "📝", label: "Full Quiz",
    desc: `${split.content} questions, shuffled & scored` });
  groups.push({ label: "Guided Readings", icon: "📖", modes: grModes });

  // ── Practice Exams ─────────────────────────────────────────────────────────
  if (sec.exams && sec.exams.length) {
    const missedCount = loadMissedQs().length;
    groups.push({ label: "Practice Exams", icon: "📋", modes: [
      { id: "examPicker", icon: "⏱️", label: "Timed Exam",
        desc: `${sec.exams.length} exams · 30 s/question · no skipping` },
      { id: "simPicker",  icon: "🎓", label: "Exam Simulation",
        desc: `${sec.exams.length} exams · 70-min block · skip & review` },
      { id: "missedReview", icon: "🔁", label: "Missed Questions",
        desc: missedCount > 0
          ? `${missedCount} question${missedCount !== 1 ? 's' : ''} to master`
          : "Complete an exam first to populate",
        disabled: missedCount === 0 },
    ]});
  } else if (["appendicular", "torso"].includes(state.sectionKey)) {
    groups.push({ label: "Practice Exams", icon: "📋", modes: [],
      comingSoon: "Practice exams for this section are in preparation." });
  }

  // ── Diagrams ───────────────────────────────────────────────────────────────
  const diagModes = [];
  if (split.diagram > 0 && sec.subtopics && sec.subtopics.length) {
    diagModes.push({ id: "subtopics", filter: "diagram", icon: "🧩", label: "Diagram ID by Topic",
      desc: `${split.diagram} structure-ID questions with images` });
  }
  if (sec.images && sec.images.length) {
    diagModes.push({ id: "gallery", icon: "🖼️", label: "Diagram Gallery",
      desc: `${sec.images.length} labeled diagrams from worksheets` });
  }
  if (labelingCount > 0) {
    diagModes.push({ id: "labeling", icon: "🏷️", label: "Diagram Labeling",
      desc: `${labelingCount} fill-in-the-blank exercises` });
  }
  if (diagModes.length) groups.push({ label: "Diagrams", icon: "🔬", modes: diagModes });

  // ── ClaudeBank (AI-generated practice, Torso only) ─────────────────────────
  if (state.sectionKey === "torso" && typeof CLAUDEBANK !== "undefined" && CLAUDEBANK.length) {
    const cbTotal = CLAUDEBANK.reduce((s, cb) => s + cb.questions.length, 0);
    const cbProgAll = progressState.quizzes["cb:-1"];
    const cbBadge = cbProgAll ? ` · Best: ${cbProgAll.bestScore}%` : "";
    groups.push({ label: "ClaudeBank — AI Practice", icon: "🤖", modes: [
      { id: "cbPicker", icon: "📂", label: "Practice by Topic",
        desc: `${CLAUDEBANK.length} topic sets · pick one to drill` },
      { id: "cbAll",    icon: "🎲", label: "All Topics Mixed",
        desc: `${cbTotal} questions, all 8 topics shuffled${cbBadge}` },
    ]});
  }

  // ── Render groups ──────────────────────────────────────────────────────────
  groups.forEach(group => {
    const hdr = document.createElement("div");
    hdr.className = "modeGroupHdr";
    hdr.textContent = group.icon + "  " + group.label;
    main.appendChild(hdr);

    if (group.comingSoon) {
      const msg = document.createElement("div");
      msg.className = "comingSoonMsg";
      msg.textContent = group.comingSoon;
      main.appendChild(msg);
      return;
    }

    const list = document.createElement("div");
    list.className = "modeList";

    for (const m of group.modes) {
      const btn = document.createElement("button");
      btn.className = "modeBtn";
      let progKey = null;
      if (m.id === "quiz") progKey = state.sectionKey + ":" + (m.filter || "all");
      else if (m.id === "grTimed") progKey = "grTimed:" + state.sectionKey;
      else if (m.id === "worksheet") progKey = "worksheet:" + state.sectionKey;
      else if (m.id === "labeling") progKey = "labeling:" + state.sectionKey;
      const entry = m.id === "flashcards" ? progressState.flashcards[state.sectionKey]
        : (progKey ? progressState.quizzes[progKey] : null);
      const badge = entry ? `<div class="bestBadge">Best: ${entry.bestScore}%</div>` : "";
      btn.innerHTML = `<div class="icon">${m.icon}</div><div><div class="label">${m.label}</div><div class="desc">${m.desc}</div>${badge}</div>`;
      if (m.disabled) {
        btn.disabled = true; btn.style.opacity = "0.5";
      } else if (m.id === "grTimed") {
        btn.onclick = () => {
          const pool = shuffle([...filterQuiz(getSection(state.sectionKey).quiz, "content")]);
          examDeck = pool;
          examIndex = 0; examScore = 0;
          examAnswered = false; examSelected = -1; examTimedOut = false;
          examAnswerLog = [];
          sessionModeSet = false; sessionDiagGateSet = false;
          state.examSource = "gr"; state.examTitle = null;
          state.route = "exam"; render();
        };
      } else if (m.id === "missedReview") {
        btn.onclick = () => {
          missedDeck = loadMissedQs();
          window._missedStartCount = missedDeck.length;
          missedIndex = 0; missedAnswered = false; missedSelected = -1;
          state.route = "missedReview"; render();
        };
      } else if (m.id === "cbPicker") {
        btn.onclick = () => { state.route = "cbPicker"; render(); };
      } else if (m.id === "cbAll") {
        btn.onclick = () => {
          state.quizSource = "claudebank"; state.cbIndex = -1;
          quizDeck = []; state.route = "quiz"; render();
        };
      } else {
        btn.onclick = () => {
          state.mode = m.id; state.route = m.id;
          state.quizFilter = m.filter || null;
          state.subtopicIndex = null; state.cameFromSubtopics = false;
          state.quizSource = null; state.examSource = null;
          quizDeck = []; render();
        };
      }
      list.appendChild(btn);
    }
    main.appendChild(list);
  });
}

/* ---------------- SUBTOPICS ---------------- */
function renderSubtopics(main) {
  const sec = getSection(state.sectionKey);
  const filter = state.quizFilter;
  const isDiag = filter === "diagram";
  const sub = document.createElement("div");
  sub.className = "subtitle";
  sub.textContent = isDiag
    ? "Identify labeled structures on each worksheet diagram, one topic at a time."
    : "Work through the guided-reading questions one topic at a time.";
  main.appendChild(sub);

  const list = document.createElement("div");
  list.className = "modeList";
  let shown = 0;
  sec.subtopics.forEach((st, i) => {
    const count = filterQuiz(st.quiz, filter).length;
    if (count === 0) return;
    shown++;
    const btn = document.createElement("button");
    btn.className = "modeBtn";
    const entry = progressState.quizzes[state.sectionKey + ":" + (filter || "all") + ":" + i];
    const badge = entry ? `<div class="bestBadge">Best: ${entry.bestScore}%</div>` : "";
    btn.innerHTML = `<div class="icon">${isDiag ? "🧩" : "📖"}</div><div><div class="label">${st.title}</div><div class="desc">${count} ${isDiag ? "diagram items" : "questions"}</div>${badge}</div>`;
    btn.onclick = () => {
      state.subtopicIndex = i;
      state.cameFromSubtopics = true;
      state.route = "quiz";
      quizDeck = [];
      render();
    };
    list.appendChild(btn);
  });
  if (shown === 0) {
    const empty = document.createElement("div");
    empty.className = "subtitle";
    empty.textContent = "No items in this category for this unit.";
    main.appendChild(empty);
  }
  main.appendChild(list);
}

/* ---------------- FLASHCARDS ---------------- */
let fcDeck = [], fcIndex = 0, fcFlipped = false, fcKnown = 0, fcUnknown = 0;

function renderFlashcards(main) {
  const sec = getSection(state.sectionKey);
  if (fcDeck.length === 0 || fcDeck._sectionKey !== state.sectionKey) {
    fcDeck = shuffle(sec.flashcards);
    fcDeck._sectionKey = state.sectionKey;
    fcIndex = 0; fcFlipped = false; fcKnown = 0; fcUnknown = 0;
  }

  if (fcIndex >= fcDeck.length) {
    if (!fcDeck._saved) {
      fcDeck._saved = true;
      recordFlashcardResult(state.sectionKey, fcKnown, fcDeck.length);
    }
    renderFlashcardResults(main);
    return;
  }

  const progWrap = document.createElement("div");
  progWrap.className = "progressWrap";
  const prog = document.createElement("div");
  prog.className = "progressBar";
  prog.style.width = `${(fcIndex / fcDeck.length) * 100}%`;
  progWrap.appendChild(prog);
  main.appendChild(progWrap);

  const stage = document.createElement("div");
  stage.className = "cardStage";

  const [term, def] = fcDeck[fcIndex];
  const card = document.createElement("div");
  card.className = "flashcard" + (fcFlipped ? " flipped" : "");
  card.innerHTML = fcFlipped
    ? `<span class="tag">Definition</span><div class="defText">${def}</div><span class="hint">Tap to flip back</span>`
    : `<span class="tag">Term ${fcIndex + 1} / ${fcDeck.length}</span><div>${term}</div><span class="hint">Tap to reveal</span>`;
  card.onclick = () => { fcFlipped = !fcFlipped; render(); };
  stage.appendChild(card);

  if (fcFlipped) {
    const look = document.createElement("button");
    look.className = "tbLookBtn tbLookWide";
    look.innerHTML = "📖 Look it up in Martini";
    look.onclick = (e) => { e.stopPropagation(); showTextbookPanel(term + " " + def, term); };
    stage.appendChild(look);
  }

  const nav = document.createElement("div");
  nav.className = "cardNav";
  if (fcFlipped) {
    const dont = document.createElement("button");
    dont.className = "navBtn dontknow";
    dont.textContent = "Still learning";
    dont.onclick = () => { fcUnknown++; fcIndex++; fcFlipped = false; render(); };
    const know = document.createElement("button");
    know.className = "navBtn know";
    know.textContent = "Knew it";
    know.onclick = () => { fcKnown++; fcIndex++; fcFlipped = false; render(); };
    nav.appendChild(dont); nav.appendChild(know);
  } else {
    const skip = document.createElement("button");
    skip.className = "navBtn plain";
    skip.textContent = "Skip";
    skip.onclick = () => { fcIndex++; fcFlipped = false; render(); };
    nav.appendChild(skip);
  }
  stage.appendChild(nav);
  main.appendChild(stage);
}

function renderFlashcardResults(main) {
  const wrap = document.createElement("div");
  wrap.className = "resultWrap";
  wrap.innerHTML = `
    <div class="resultLabel">Deck complete</div>
    <div class="resultScore">${fcKnown} / ${fcDeck.length}</div>
    <div class="resultLabel">marked "Knew it" (${fcUnknown} still learning)</div>
  `;
  const again = document.createElement("button");
  again.className = "primaryBtn";
  again.textContent = "Study again";
  again.onclick = () => { fcDeck = []; render(); };
  const back = document.createElement("button");
  back.className = "secondaryBtn";
  back.textContent = "Back to modes";
  back.onclick = () => { fcDeck = []; state.route = "modes"; render(); };
  wrap.appendChild(again); wrap.appendChild(back);
  main.appendChild(wrap);
}

/* ---------------- QUIZ ---------------- */
let quizDeck = [], quizIndex = 0, quizScore = 0, quizSkipped = 0, quizAnswered = false, quizSelected = -1;
let quizModeSet = false; // closed/open-book prompt answered for the current Claude Bank / Stuvia quiz
const QUIZ_MODE_SOURCES = ["claude", "stuvia", "claudebank"]; // banks that feed stats → ask study mode first
// Shuffle caches — stable per question so options don't jump mid-answer
let _qShCache  = { key: -1, opts: [] }; // quiz
let _eShCache  = { key: -1, opts: [] }; // timed exam
let _sdShCache = { key: "",  opts: [] }; // sudden death
let _examSCorrect = -1; // shuffled display index of correct answer (for DOM highlight)
let fullExamShuffledOrders = []; // pre-computed per fullExam launch

function renderQuizModeGate(main) {
  const wrap = document.createElement("div");
  wrap.style.cssText = "max-width:460px;margin:40px auto 0;text-align:center;padding:0 16px;";
  wrap.innerHTML = `
    <div style="font-size:2rem;margin-bottom:6px;">🎯</div>
    <div style="font-weight:800;font-size:1.15rem;color:var(--navy,#1F3864);margin-bottom:4px;">Before you start…</div>
    <div style="color:#666;font-size:.92rem;margin-bottom:22px;">Are you using your notes for this set? This keeps your <b>true (closed-book)</b> score separate from your <b>with-notes</b> score — and both count toward your stats.</div>`;
  const mk = (label, sub, mode, bg) => {
    const b = document.createElement("button");
    b.style.cssText = `display:block;width:100%;margin:10px 0;background:${bg};color:#fff;border:none;border-radius:12px;padding:14px;font-size:1rem;font-weight:700;cursor:pointer;`;
    b.innerHTML = `${label}<div style="font-weight:400;font-size:.78rem;opacity:.9;margin-top:2px;">${sub}</div>`;
    b.onclick = () => { setStudyMode(mode); quizModeSet = true; render(); };
    return b;
  };
  wrap.appendChild(mk("🧠 Closed-book", "No notes — my true recall", "closed", "#1F3864"));
  wrap.appendChild(mk("📖 Open-book", "Using my notes", "open", "#2E74B5"));
  main.appendChild(wrap);
}

function renderQuiz(main) {
  // ClaudeBank mode — pull from the CLAUDEBANK global instead of section data
  let sourceQuiz, deckKey;
  if (state.quizSource === "custom" || state.quizSource === "stuvia" || state.quizSource === "claude") {
    sourceQuiz = quizDeck.length ? quizDeck : [];
    deckKey = state.quizDeckKey || state.quizSource;
  } else if (state.quizSource === "claudebank" && typeof CLAUDEBANK !== "undefined") {
    const pool = state.cbIndex >= 0 ? CLAUDEBANK[state.cbIndex].questions
                                    : CLAUDEBANK.flatMap(cb => cb.questions);
    sourceQuiz = pool;
    deckKey = "cb:" + state.cbIndex;
  } else {
    const sec = getSection(state.sectionKey);
    const rawQuiz = (state.cameFromSubtopics && state.subtopicIndex != null)
      ? sec.subtopics[state.subtopicIndex].quiz
      : sec.quiz;
    sourceQuiz = filterQuiz(rawQuiz, state.quizFilter);
    const fkey = state.quizFilter || "all";
    deckKey = state.sectionKey + ":" + fkey + (state.cameFromSubtopics ? ":" + state.subtopicIndex : "");
  }
  if (quizDeck.length === 0 || quizDeck._deckKey !== deckKey) {
    quizDeck = shuffle(sourceQuiz);
    quizDeck._deckKey = deckKey;
    quizIndex = 0; quizScore = 0; quizSkipped = 0; quizAnswered = false; quizSelected = -1;
    quizModeSet = false; // new deck → re-ask closed/open-book for stats-tracked banks
  }

  // Closed-book vs with-notes gate for Claude Bank / Stuvia (their results feed your stats)
  if (QUIZ_MODE_SOURCES.includes(state.quizSource) && quizIndex === 0 && !quizAnswered && !quizModeSet) {
    renderQuizModeGate(main); return;
  }

  if (quizIndex >= quizDeck.length) {
    if (!quizDeck._saved) {
      quizDeck._saved = true;
      const denom = Math.max(quizDeck.length - quizSkipped, 1);
      recordQuizResult(deckKey, quizScore, denom);
      const qpct = Math.round(quizScore / denom * 100);
      const qtitle = (state.quizSource === "claude" || state.quizSource === "claudebank") ? "Claude Bank quiz"
        : state.quizSource === "stuvia" ? "Stuvia quiz"
        : (state.mode === "flashcards" ? "Flashcards" : "Guided-Reading quiz");
      recordAttempt(deckKey, {
        title: qtitle, kind: "quiz",
        mode: getStudyMode(), score: quizScore, total: denom, pct: qpct, missed: []
      });
    }
    renderQuizResults(main);
    return;
  }

  const progWrap = document.createElement("div");
  progWrap.className = "progressWrap";
  const prog = document.createElement("div");
  prog.className = "progressBar";
  prog.style.width = `${(quizIndex / quizDeck.length) * 100}%`;
  progWrap.appendChild(prog);
  main.appendChild(progWrap);

  const q = quizDeck[quizIndex];
  markQuestionShown("quiz" + quizIndex + (q.id || ""));   // start the answer-speed clock for this question
  const stem = document.createElement("div");
  stem.className = "qStem";
  stem.textContent = `${quizIndex + 1}. ${q.q}`;
  main.appendChild(stem);

  if (q.images && q.images.length) {
    const imgWrap = document.createElement("div");
    imgWrap.className = "qImageWrap";
    q.images.forEach((img) => {
      const imageEl = document.createElement("img");
      imageEl.className = "qImage";
      imageEl.src = "images/" + img;
      imageEl.loading = "lazy";
      imageEl.onclick = () => imageEl.classList.toggle("qImageZoomed");
      imgWrap.appendChild(imageEl);
    });
    main.appendChild(imgWrap);
  }

  // ── FITB (fill-in-the-blank) reveal mode ──────────────────────────────
  if (q.fitb) {
    if (quizSelected === -1) {
      // Not yet revealed — show "Reveal Answer" button
      const revWrap = document.createElement("div");
      revWrap.className = "options";
      const revBtn = document.createElement("button");
      revBtn.className = "option";
      revBtn.style.cssText = "background:var(--accent,#2980b9);color:#fff;font-weight:600;";
      revBtn.textContent = "Tap to reveal answer";
      revBtn.onclick = () => { quizSelected = -2; render(); };
      revWrap.appendChild(revBtn);
      main.appendChild(revWrap);

      const skipBar = document.createElement("div");
      skipBar.className = "feedbackBar";
      const skipBtn = document.createElement("button");
      skipBtn.className = "secondaryBtn";
      skipBtn.textContent = "Skip question";
      skipBtn.onclick = () => { quizSkipped++; quizIndex++; quizAnswered = false; quizSelected = -1; render(); };
      skipBar.appendChild(skipBtn);
      main.appendChild(skipBar);

    } else if (quizSelected === -2) {
      // Revealed — show answer, wait for self-assessment
      const ansBox = document.createElement("div");
      ansBox.style.cssText = "background:#e8f5e9;border:1.5px solid #27ae60;border-radius:10px;padding:14px 16px;margin:10px 0;font-size:1.05rem;text-align:center;";
      ansBox.innerHTML = `<span style="color:#555;font-size:.85rem;display:block;margin-bottom:4px;">Answer</span><strong style="color:#1a7a3f;font-size:1.1rem;">${q.options[0]}</strong>`;
      main.appendChild(ansBox);

      const selfBar = document.createElement("div");
      selfBar.className = "feedbackBar";
      selfBar.style.cssText = "display:flex;gap:10px;";

      const gotIt = document.createElement("button");
      gotIt.className = "nextBtn";
      gotIt.style.cssText = "flex:1;background:#27ae60;";
      gotIt.textContent = "✓ Got it";
      gotIt.onclick = () => { quizScore++; quizAnswered = true; quizSelected = -3; recordQuestionStat(q, true, qElapsed()); render(); };
      selfBar.appendChild(gotIt);

      const missedIt = document.createElement("button");
      missedIt.className = "secondaryBtn";
      missedIt.style.cssText = "flex:1;";
      missedIt.textContent = "✗ Missed it";
      missedIt.onclick = () => { quizAnswered = true; quizSelected = -3; recordQuestionStat(q, false, qElapsed()); render(); };
      selfBar.appendChild(missedIt);

      main.appendChild(selfBar);

    } else if (quizAnswered) {
      // Scored — show next button
      const fb = document.createElement("div");
      fb.className = "feedbackBar";
      const next = document.createElement("button");
      next.className = "nextBtn";
      next.textContent = quizIndex === quizDeck.length - 1 ? "See results" : "Next question";
      next.onclick = () => { quizIndex++; quizAnswered = false; quizSelected = -1; render(); };
      fb.appendChild(next);
      main.appendChild(fb);
    }
    return; // skip MCQ rendering
  }

  // ── MCQ / T-F ─────────────────────────────────────────────────────────
  // Shuffle options — cached per question index so they're stable mid-answer
  if (_qShCache.key !== quizIndex) { _qShCache.key = quizIndex; _qShCache.opts = shuffle([...q.options]); }
  const _qSOpts = _qShCache.opts;
  const _qSCorr = _qSOpts.indexOf(q.options[q.correct]);

  const optsWrap = document.createElement("div");
  optsWrap.className = "options";
  _qSOpts.forEach((opt, i) => {
    const b = document.createElement("button");
    b.className = "option";
    b.textContent = opt;
    if (quizAnswered) {
      b.disabled = true;
      if (i === _qSCorr) b.className += " correct";
      else if (i === quizSelected) b.className += " incorrect";
    }
    b.onclick = () => {
      if (quizAnswered) return;
      quizAnswered = true;
      quizSelected = i; // shuffled display index (for highlight)
      if (i === _qSCorr) quizScore++; // compare shuffled positions
      recordQuestionStat(q, i === _qSCorr, qElapsed());
      render();
    };
    optsWrap.appendChild(b);
  });
  main.appendChild(optsWrap);

  if (quizAnswered) {
    // Martini textbook reference — Claude Bank carries a curated chapter/page (q.ch/q.page);
    // GR & Stuvia fall back to a live best-match lookup.
    try {
      let ch = null, page = null;
      if (q.ch) { ch = q.ch; page = q.page || null; }
      else { const res = searchTextbook(q.q, q.options[q.correct]); if (res && res.page) { page = res.page; ch = pageToChapter(page); } }
      if (ch || page) {
        const cm = ch ? CHAP_META[ch] : null;
        const cite = document.createElement("div");
        cite.style.cssText = "text-align:center;font-size:.8rem;color:#777;margin:10px 0 2px;line-height:1.4;";
        cite.innerHTML = cm
          ? `📖 <b>Martini Ch ${ch}</b> — ${escapeHtml(cm.name)}${page ? ` &nbsp;·&nbsp; <b>p. ${page}</b>` : ""}`
          : `📖 <b>Martini</b>${page ? ` &nbsp;·&nbsp; p. ${page}` : ""}`;
        main.appendChild(cite);
      }
    } catch (e) {}
    const fb = document.createElement("div");
    fb.className = "feedbackBar";
    const look = document.createElement("button");
    look.className = "tbLookBtn";
    look.innerHTML = "📖 Look it up in Martini";
    look.onclick = () => showTextbookPanel(q.q, q.options[q.correct]);
    fb.appendChild(look);
    fb.appendChild(reportBtn(q));
    const next = document.createElement("button");
    next.className = "nextBtn";
    next.textContent = quizIndex === quizDeck.length - 1 ? "See results" : "Next question";
    next.onclick = () => { quizIndex++; quizAnswered = false; quizSelected = -1; render(); };
    fb.appendChild(next);
    main.appendChild(fb);
  } else {
    const skipBar = document.createElement("div");
    skipBar.className = "feedbackBar";
    const skipBtn = document.createElement("button");
    skipBtn.className = "secondaryBtn";
    skipBtn.textContent = "Skip question";
    skipBtn.onclick = () => { quizSkipped++; quizIndex++; quizAnswered = false; quizSelected = -1; render(); };
    skipBar.appendChild(skipBtn);
    main.appendChild(skipBar);
  }
}

function renderQuizResults(main) {
  const denom = Math.max(quizDeck.length - quizSkipped, 0);
  const pct = denom > 0 ? Math.round((quizScore / denom) * 100) : 0;
  const wrap = document.createElement("div");
  wrap.className = "resultWrap";
  wrap.innerHTML = `
    <div class="resultLabel">Quiz complete</div>
    <div class="resultScore">${quizScore} / ${denom}</div>
    <div class="resultLabel">${pct}% correct${quizSkipped ? ` · ${quizSkipped} skipped` : ""}</div>
  `;
  const again = document.createElement("button");
  again.className = "primaryBtn";
  again.textContent = "Retake quiz";
  again.onclick = () => { quizDeck = []; render(); };
  const back = document.createElement("button");
  back.className = "secondaryBtn";
  back.textContent = state.quizSource === "custom" ? "Back to Custom Practice"
    : state.quizSource === "claudebank" ? "Back to ClaudeBank"
    : state.cameFromSubtopics ? "Back to topics" : "Back to modes";
  back.onclick = () => {
    quizDeck = [];
    if (state.quizSource === "stuvia") {
      quizDeck = []; state.quizSource = null; state.route = "stuviaMenu";
    } else if (state.quizSource === "custom") {
      quizDeck = []; state.quizSource = null; state.route = "customBuilder";
    } else if (state.quizSource === "claudebank") {
      state.route = "cbPicker"; state.quizSource = null; state.cbIndex = -1;
    } else if (state.cameFromSubtopics) {
      state.route = "subtopics"; state.subtopicIndex = null; state.cameFromSubtopics = false;
    } else { state.route = "modes"; }
    render();
  };
  wrap.appendChild(again); wrap.appendChild(back);
  main.appendChild(wrap);
}

/* ---------------- CLAUDEBANK TOPIC PICKER ---------------- */
function renderCbPicker(main) {
  if (typeof CLAUDEBANK === "undefined" || !CLAUDEBANK.length) {
    const msg = document.createElement("div");
    msg.className = "subtitle";
    msg.textContent = "ClaudeBank not loaded — make sure claudebank.js is present.";
    main.appendChild(msg);
    return;
  }
  const sub = document.createElement("div");
  sub.className = "subtitle";
  sub.textContent = "Pick a topic to drill, or go back and choose All Topics Mixed.";
  main.appendChild(sub);

  const list = document.createElement("div");
  list.className = "modeList";

  CLAUDEBANK.forEach((cb, i) => {
    const btn = document.createElement("button");
    btn.className = "modeBtn";
    const progKey = "cb:" + i;
    const entry = progressState.quizzes[progKey];
    const badge = entry ? `<div class="bestBadge">Best: ${entry.bestScore}%</div>` : "";
    btn.innerHTML = `<div class="icon">🤖</div><div><div class="label">${cb.title}</div><div class="desc">${cb.questions.length} questions</div>${badge}</div>`;
    btn.onclick = () => {
      state.quizSource = "claudebank"; state.cbIndex = i;
      quizDeck = []; state.route = "quiz";
      render();
    };
    list.appendChild(btn);
  });
  main.appendChild(list);
}

/* ---------------- WORKSHEET WALKTHROUGH ---------------- */
// Walks every subtopic in order, in the original (unshuffled) worksheet sequence —
// mimics flipping through the actual lab worksheet front to back, with a divider
// shown each time you cross into a new topic.
let wsDeck = [], wsIndex = 0, wsScore = 0, wsTotalPoints = 0, wsSkippedPoints = 0, wsAnswered = false, wsSelected = -1;

// Labeling-exercise interaction state (resets whenever wsIndex moves to a new labeling item)
let lblItemIndex = -1, lblAssignments = {}, lblSelectedChip = null, lblChecked = false;

function renderWorksheet(main) {
  const sec = getSection(state.sectionKey);
  if (wsDeck.length === 0 || wsDeck._sectionKey !== state.sectionKey) {
    wsDeck = [];
    wsTotalPoints = 0;
    sec.subtopics.forEach((st) => {
      (st.labeling || []).forEach((ex) => {
        wsDeck.push({ type: "labeling", ...ex, _topic: st.title });
        wsTotalPoints += ex.blanks.length;
      });
      st.quiz.forEach((q) => {
        wsDeck.push({ type: "quiz", ...q, _topic: st.title });
        wsTotalPoints += 1;
      });
    });
    wsDeck._sectionKey = state.sectionKey;
    wsIndex = 0; wsScore = 0; wsSkippedPoints = 0; wsAnswered = false; wsSelected = -1;
    lblItemIndex = -1; lblAssignments = {}; lblSelectedChip = null; lblChecked = false;
  }

  if (wsIndex >= wsDeck.length) {
    if (!wsDeck._saved) {
      wsDeck._saved = true;
      const denom = Math.max(wsTotalPoints - wsSkippedPoints, 1);
      recordQuizResult("worksheet:" + state.sectionKey, wsScore, denom);
    }
    renderWorksheetResults(main);
    return;
  }

  const progWrap = document.createElement("div");
  progWrap.className = "progressWrap";
  const prog = document.createElement("div");
  prog.className = "progressBar";
  prog.style.width = `${(wsIndex / wsDeck.length) * 100}%`;
  progWrap.appendChild(prog);
  main.appendChild(progWrap);

  const q = wsDeck[wsIndex];
  if (wsIndex === 0 || wsDeck[wsIndex - 1]._topic !== q._topic) {
    const divider = document.createElement("div");
    divider.className = "topicDivider";
    divider.textContent = q._topic;
    main.appendChild(divider);
  }

  if (q.type === "labeling") {
    renderLabelingItem(main, q, {
      index: wsIndex,
      isLast: wsIndex === wsDeck.length - 1,
      label: wsIndex + 1,
      onCheck: (correctCount) => { wsScore += correctCount; },
      onSkip: (blankCount) => {
        wsSkippedPoints += blankCount;
        wsIndex++;
        lblItemIndex = -1; lblAssignments = {}; lblSelectedChip = null; lblChecked = false;
      },
      onNext: () => { wsIndex++; },
    });
    return;
  }

  const stem = document.createElement("div");
  stem.className = "qStem";
  stem.textContent = `${wsIndex + 1}. ${q.q}`;
  main.appendChild(stem);

  if (q.images && q.images.length) {
    const imgWrap = document.createElement("div");
    imgWrap.className = "qImageWrap";
    q.images.forEach((img) => {
      const imageEl = document.createElement("img");
      imageEl.className = "qImage";
      imageEl.src = "images/" + img;
      imageEl.loading = "lazy";
      imageEl.onclick = () => imageEl.classList.toggle("qImageZoomed");
      imgWrap.appendChild(imageEl);
    });
    main.appendChild(imgWrap);
  }

  const optsWrap = document.createElement("div");
  optsWrap.className = "options";
  q.options.forEach((opt, i) => {
    const b = document.createElement("button");
    b.className = "option";
    b.textContent = opt;
    if (wsAnswered) {
      b.disabled = true;
      if (i === q.correct) b.className += " correct";
      else if (i === wsSelected) b.className += " incorrect";
    }
    b.onclick = () => {
      if (wsAnswered) return;
      wsAnswered = true;
      wsSelected = i;
      if (i === q.correct) wsScore++;
      render();
    };
    optsWrap.appendChild(b);
  });
  main.appendChild(optsWrap);

  if (wsAnswered) {
    const fb = document.createElement("div");
    fb.className = "feedbackBar";
    const next = document.createElement("button");
    next.className = "nextBtn";
    next.textContent = wsIndex === wsDeck.length - 1 ? "See results" : "Next question";
    next.onclick = () => { wsIndex++; wsAnswered = false; wsSelected = -1; render(); };
    fb.appendChild(next);
    main.appendChild(fb);
  } else {
    const skipBar = document.createElement("div");
    skipBar.className = "feedbackBar";
    const skipBtn = document.createElement("button");
    skipBtn.className = "secondaryBtn";
    skipBtn.textContent = "Skip question";
    skipBtn.onclick = () => { wsSkippedPoints += 1; wsIndex++; wsAnswered = false; wsSelected = -1; render(); };
    skipBar.appendChild(skipBtn);
    main.appendChild(skipBar);
  }
}

/* ---------------- LABELING EXERCISES (word-bank fill-in-the-blank) ----------------
   ctx = { index, isLast, label, onCheck(correctCount), onSkip(blankCount), onNext() }
   Reused by both the mixed Worksheet Walkthrough deck and the standalone Diagram
   Labeling mode — the caller owns its own deck/index/score variables and just tells
   us what to do when the user checks, skips, or advances past this item. */
function renderLabelingItem(main, ex, ctx) {
  if (lblItemIndex !== ctx.index) {
    lblItemIndex = ctx.index;
    lblAssignments = {};
    lblSelectedChip = null;
    lblChecked = false;
  }

  const stem = document.createElement("div");
  stem.className = "qStem";
  stem.textContent = `${ctx.label}. ${ex.title}`;
  main.appendChild(stem);

  const hint = document.createElement("div");
  hint.className = "galleryNote";
  hint.textContent = "Tap a word below, then tap the blank it labels.";
  main.appendChild(hint);

  if (ex.image) {
    const imgWrap = document.createElement("div");
    imgWrap.className = "qImageWrap";
    const imageEl = document.createElement("img");
    imageEl.className = "qImage";
    imageEl.src = "images/" + ex.image;
    imageEl.loading = "lazy";
    imageEl.onclick = () => imageEl.classList.toggle("qImageZoomed");
    imgWrap.appendChild(imageEl);
    main.appendChild(imgWrap);
  }

  const usedWords = new Set(Object.values(lblAssignments));

  const bankWrap = document.createElement("div");
  bankWrap.className = "wordBank";
  ex.wordBank.forEach((word) => {
    const chip = document.createElement("button");
    chip.className = "chip";
    chip.textContent = word;
    const isUsed = usedWords.has(word);
    if (isUsed) chip.className += " used";
    if (lblSelectedChip === word) chip.className += " selected";
    chip.disabled = lblChecked || isUsed;
    chip.onclick = () => {
      if (lblChecked) return;
      lblSelectedChip = lblSelectedChip === word ? null : word;
      render();
    };
    bankWrap.appendChild(chip);
  });
  main.appendChild(bankWrap);

  const blankList = document.createElement("div");
  blankList.className = "blankList";
  ex.blanks.forEach((b) => {
    const row = document.createElement("div");
    row.className = "blankRow";
    const num = document.createElement("div");
    num.className = "blankNum";
    num.textContent = b.num + ".";
    const ans = document.createElement("div");
    const filled = lblAssignments[b.num];
    ans.className = "blankAnswer" + (filled ? "" : " placeholder");
    ans.textContent = filled || "tap to fill";
    row.appendChild(num);
    row.appendChild(ans);
    if (lblChecked) {
      row.className += filled === b.correct ? " correct" : " incorrect";
      if (filled !== b.correct) {
        const correction = document.createElement("div");
        correction.className = "blankAnswer";
        correction.style.fontWeight = "700";
        correction.textContent = "(" + b.correct + ")";
        row.appendChild(correction);
      }
    } else {
      row.onclick = () => {
        if (filled) {
          delete lblAssignments[b.num];
        } else if (lblSelectedChip) {
          lblAssignments[b.num] = lblSelectedChip;
          lblSelectedChip = null;
        }
        render();
      };
    }
    blankList.appendChild(row);
  });
  main.appendChild(blankList);

  const fb = document.createElement("div");
  fb.className = "feedbackBar";
  if (!lblChecked) {
    const allFilled = ex.blanks.every((b) => lblAssignments[b.num]);
    const check = document.createElement("button");
    check.className = "nextBtn";
    check.textContent = "Check answers";
    check.disabled = !allFilled;
    check.onclick = () => {
      lblChecked = true;
      const correctCount = ex.blanks.filter((b) => lblAssignments[b.num] === b.correct).length;
      ctx.onCheck(correctCount);
      render();
    };
    fb.appendChild(check);
    const skip = document.createElement("button");
    skip.className = "secondaryBtn";
    skip.textContent = "Skip diagram";
    skip.onclick = () => {
      ctx.onSkip(ex.blanks.length);
      render();
    };
    fb.appendChild(skip);
  } else {
    const next = document.createElement("button");
    next.className = "nextBtn";
    next.textContent = ctx.isLast ? "See results" : "Next";
    next.onclick = () => { ctx.onNext(); render(); };
    fb.appendChild(next);
  }
  main.appendChild(fb);
}

/* ---------------- DIAGRAM LABELING (standalone, labeling-only mode) ---------------- */
let labDeck = [], labIndex = 0, labScore = 0, labTotalBlanks = 0, labSkippedBlanks = 0;

function renderLabeling(main) {
  const sec = getSection(state.sectionKey);
  if (labDeck.length === 0 || labDeck._sectionKey !== state.sectionKey) {
    labDeck = [];
    labTotalBlanks = 0;
    sec.subtopics.forEach((st) => {
      (st.labeling || []).forEach((ex) => {
        labDeck.push({ ...ex, _topic: st.title });
        labTotalBlanks += ex.blanks.length;
      });
    });
    labDeck._sectionKey = state.sectionKey;
    labIndex = 0; labScore = 0; labSkippedBlanks = 0;
    lblItemIndex = -1; lblAssignments = {}; lblSelectedChip = null; lblChecked = false;
  }

  if (labIndex >= labDeck.length) {
    if (!labDeck._saved) {
      labDeck._saved = true;
      const denom = Math.max(labTotalBlanks - labSkippedBlanks, 1);
      recordQuizResult("labeling:" + state.sectionKey, labScore, denom);
    }
    renderLabelingResults(main);
    return;
  }

  const progWrap = document.createElement("div");
  progWrap.className = "progressWrap";
  const prog = document.createElement("div");
  prog.className = "progressBar";
  prog.style.width = `${(labIndex / labDeck.length) * 100}%`;
  progWrap.appendChild(prog);
  main.appendChild(progWrap);

  const ex = labDeck[labIndex];
  if (labIndex === 0 || labDeck[labIndex - 1]._topic !== ex._topic) {
    const divider = document.createElement("div");
    divider.className = "topicDivider";
    divider.textContent = ex._topic;
    main.appendChild(divider);
  }

  renderLabelingItem(main, ex, {
    index: labIndex,
    isLast: labIndex === labDeck.length - 1,
    label: labIndex + 1,
    onCheck: (correctCount) => { labScore += correctCount; },
    onSkip: (blankCount) => {
      labSkippedBlanks += blankCount;
      labIndex++;
      lblItemIndex = -1; lblAssignments = {}; lblSelectedChip = null; lblChecked = false;
    },
    onNext: () => { labIndex++; },
  });
}

function renderLabelingResults(main) {
  const denom = Math.max(labTotalBlanks - labSkippedBlanks, 0);
  const pct = denom > 0 ? Math.round((labScore / denom) * 100) : 0;
  const wrap = document.createElement("div");
  wrap.className = "resultWrap";
  wrap.innerHTML = `
    <div class="resultLabel">Diagram labeling complete</div>
    <div class="resultScore">${labScore} / ${denom}</div>
    <div class="resultLabel">${pct}% correct${labSkippedBlanks ? ` · ${labSkippedBlanks} pts skipped` : ""}</div>
  `;
  const again = document.createElement("button");
  again.className = "primaryBtn";
  again.textContent = "Start over";
  again.onclick = () => { labDeck = []; render(); };
  const back = document.createElement("button");
  back.className = "secondaryBtn";
  back.textContent = "Back to modes";
  back.onclick = () => { labDeck = []; state.route = "modes"; render(); };
  wrap.appendChild(again); wrap.appendChild(back);
  main.appendChild(wrap);
}

function renderWorksheetResults(main) {
  const denom = Math.max(wsTotalPoints - wsSkippedPoints, 0);
  const pct = denom > 0 ? Math.round((wsScore / denom) * 100) : 0;
  const wrap = document.createElement("div");
  wrap.className = "resultWrap";
  wrap.innerHTML = `
    <div class="resultLabel">Worksheet complete</div>
    <div class="resultScore">${wsScore} / ${denom}</div>
    <div class="resultLabel">${pct}% correct${wsSkippedPoints ? ` · ${wsSkippedPoints} pts skipped` : ""}</div>
  `;
  const again = document.createElement("button");
  again.className = "primaryBtn";
  again.textContent = "Start over";
  again.onclick = () => { wsDeck = []; render(); };
  const back = document.createElement("button");
  back.className = "secondaryBtn";
  back.textContent = "Back to modes";
  back.onclick = () => { wsDeck = []; state.route = "modes"; render(); };
  wrap.appendChild(again); wrap.appendChild(back);
  main.appendChild(wrap);
}

/* ---------------- GALLERY ---------------- */
function renderGallery(main) {
  const sec = getSection(state.sectionKey);
  const disc = document.createElement("div");
  disc.className = "disclaimer";
  disc.textContent = "These are the actual labeled diagrams from your course worksheets — use them to self-test before checking your notes or lecture slides for the exact structure names.";
  main.appendChild(disc);

  const grid = document.createElement("div");
  grid.className = "galleryGrid";
  sec.images.forEach((img, i) => {
    const item = document.createElement("div");
    item.className = "galleryItem";
    const imageEl = document.createElement("img");
    imageEl.src = "images/" + img;
    imageEl.loading = "lazy";
    item.appendChild(imageEl);
    grid.appendChild(item);
  });
  main.appendChild(grid);
}

/* ---------- LABELED DIAGRAM GALLERY (Torso) ----------
   Uses DIAGRAM_KEY (diagramkey.js): labels re-derived from the Stuvia PDF figures,
   figure numbers user-verified. GR (guided-reading) letters are shown bold+highlighted. */
const SECTION_ICONS = { "Thorax": "🫁", "Abdomen": "🧫", "Pelvis & Perineum": "🦴", "Systemic": "🧬",
  "Head & Neck": "💀", "Spinal Cord & Column": "🦴", "Cross-Sectional, Autonomic & Senses": "🔀", "Neural Tissue": "🧠" };

function renderDiagramGallery(main) {
  const isAxial = state.sectionKey === "axial";
  const groups = isAxial
    ? ((typeof AXIAL_DIAGRAM_KEY !== "undefined") ? AXIAL_DIAGRAM_KEY : [])
    : ((typeof DIAGRAM_KEY !== "undefined") ? DIAGRAM_KEY : []);
  const disc = document.createElement("div");
  disc.className = "disclaimer";
  disc.textContent = isAxial
    ? "Every labeled diagram from your Axial Guided Readings, grouped by section. Labels were corrected against the Stuvia PDF (source of truth). Tap an image to zoom."
    : "Every labeled diagram from your Torso Guided Readings, grouped by section, with its Stuvia figure number. Yellow-highlighted letters are the ones your GR tested. Tap an image to zoom.";
  main.appendChild(disc);

  if (!groups.length) {
    const none = document.createElement("div");
    none.style.cssText = "text-align:center;color:#888;padding:20px;";
    none.textContent = "No labeled diagrams found.";
    main.appendChild(none);
    return;
  }

  let totalD = 0;
  groups.forEach(g => {
    totalD += g.diagrams.length;
    const h = document.createElement("div");
    h.className = "modeGroupHdr";
    h.style.cssText = "margin-top:20px;font-size:1.02rem;";
    h.textContent = `${SECTION_ICONS[g.section] || "🖼️"} ${g.section} — ${g.diagrams.length} diagram${g.diagrams.length === 1 ? "" : "s"}`;
    main.appendChild(h);

    g.diagrams.forEach(d => {
      const grSet = new Set(d.gr || []);
      const card = document.createElement("div");
      card.style.cssText = "background:var(--card,#fffdf8);border-radius:14px;padding:12px;margin:10px 0;box-shadow:0 1px 5px rgba(0,0,0,.09);";

      const cap = document.createElement("div");
      cap.style.cssText = "font-size:.8rem;color:#999;margin-bottom:6px;font-weight:600;";
      const figTxt = d.fig
        ? `&nbsp;·&nbsp; <span style="color:var(--accent);">${/^[\d.]+$/.test(d.fig) ? "Figure " : ""}${escapeHtml(d.fig)}</span>`
        : "";
      cap.innerHTML = `${escapeHtml(d.sub)}${figTxt}`;
      card.appendChild(cap);

      const img = document.createElement("img");
      img.className = "qImage";
      img.src = "images/" + d.img;
      img.loading = "lazy";
      img.style.cssText = "width:100%;border-radius:10px;cursor:zoom-in;background:#fff;";
      img.onclick = () => img.classList.toggle("qImageZoomed");
      card.appendChild(img);

      const leg = document.createElement("div");
      leg.style.cssText = "margin-top:10px;display:grid;grid-template-columns:1fr 1fr;gap:5px 18px;";
      Object.keys(d.labels)
        .sort((a, b) => a.length - b.length || a.localeCompare(b))
        .forEach(L => {
          const isGr = grSet.has(L);
          const row = document.createElement("div");
          row.style.cssText = "font-size:.9rem;line-height:1.5;display:flex;gap:8px;align-items:baseline;";
          const letter = isGr
            ? `<span style="font-weight:800;color:var(--accent);background:#FFE9A8;border-radius:4px;padding:0 5px;min-width:22px;text-align:center;flex-shrink:0;">${L}</span>`
            : `<span style="font-weight:700;color:var(--accent);min-width:24px;flex-shrink:0;">${L}</span>`;
          const val = isGr ? `<span style="font-weight:700;">${escapeHtml(d.labels[L])}</span>` : `<span>${escapeHtml(d.labels[L])}</span>`;
          row.innerHTML = letter + val;
          leg.appendChild(row);
        });
      card.appendChild(leg);
      main.appendChild(card);
    });
  });

  const foot = document.createElement("div");
  foot.style.cssText = "text-align:center;color:#aaa;font-size:.8rem;padding:16px 0;";
  foot.textContent = `${totalD} labeled diagrams · corrected from the Stuvia PDF`;
  main.appendChild(foot);
}

/* ---------- PREPAREDNESS SCORE (Torso) ----------
   Turns your real quiz results into a per-system exam-readiness score.
   - Closed-book ("true") vs open-book ("with notes") tracked separately.
   - Blends accuracy (80%) with answer-speed fluency (20%) where timed.
   - Diagram/labeling quizzes are excluded. 90% = exam-ready. */
const PREP_SYSTEMS = ["Respiratory","Heart","Vessels & Circulation","Blood","Lymphatic","Endocrine","Digestive","Urinary","Reproductive","Embryology"];
function prepKeyToSystems(key) {
  if (/^(labeling|worksheet|flashcard|gallery)/.test(key)) return null; // exclude diagrams/labeling
  if (key.indexOf("cb:") === 0) {
    const CB = {0:["Respiratory","Heart"],1:["Digestive"],2:["Urinary","Reproductive"],3:["Endocrine"],4:["Blood"],5:["Vessels & Circulation"],6:["Lymphatic"],7:["Embryology"]};
    return CB[parseInt(key.slice(3))] || null;
  }
  if (key.indexOf("grTimed:torso:") === 0) {
    const t = key.slice("grTimed:torso:".length);
    const map = [["Endocrine","Endocrine"],["Blood","Blood"],["Heart","Heart"],["Vessels","Vessels & Circulation"],["Lymphatic","Lymphatic"],["Digestive","Digestive"],["Urinary","Urinary"],["Reproductive","Reproductive"],["Embryology","Embryology"]];
    for (const kv of map) if (t.indexOf(kv[0]) >= 0) return [kv[1]];
    if (t.indexOf("Thorax") >= 0) return ["Respiratory","Heart"];
    if (t.indexOf("Abdomen") >= 0) return ["Digestive","Urinary"];
    if (t.indexOf("Pelvis") >= 0) return ["Reproductive","Urinary"];
    return null;
  }
  const m = key.match(/^torso:[^:]*:(\d+)$/);
  if (m) {
    const S = {0:["Respiratory","Heart"],1:["Respiratory","Heart"],2:["Respiratory","Heart"],3:["Respiratory","Heart"],4:["Respiratory","Heart"],5:["Respiratory","Heart"],6:["Digestive","Urinary"],7:["Digestive","Urinary"],8:["Digestive","Urinary"],9:["Digestive","Urinary"],10:["Digestive","Urinary"],11:["Digestive","Urinary"],12:["Digestive","Urinary"],13:["Reproductive","Urinary"],14:["Reproductive","Urinary"],15:["Endocrine"],16:["Blood"],17:["Heart"],18:["Vessels & Circulation"],19:["Lymphatic"],20:["Digestive"],21:["Urinary"],22:["Reproductive"],23:["Embryology"]};
    return S[parseInt(m[1])] || null;
  }
  if (key.indexOf("stuvia:torso:") === 0) { // per-section Stuvia (topic index 0=Thorax,1=Abdomen,2=Pelvis; ':all'/':3'=too broad)
    const t = key.split(":")[2];
    const M = { "0": ["Respiratory","Heart"], "1": ["Digestive","Urinary"], "2": ["Reproductive","Urinary"] };
    return M[t] || null;
  }
  return null; // section-wide/mixed exams — surfaced in the Practice-Test block instead
}
// Best full-length practice-test result (a direct mock of the 200-question exam), for the selected mode.
function prepMockBest(mode) {
  const Q = activeProgress().quizzes || {};
  let best = null, sec = null;
  Object.keys(Q).forEach(k => {
    if (!/^(fullExam:torso|exam:torso:|sim:torso)/.test(k) && !(k === "stuvia:torso:all") && !(k === "stuvia:torso:3")) return;
    const pm = (Q[k].modes || {})[mode];
    const bs = pm ? pm.bestScore : (Q[k].modes ? null : Q[k].bestScore);
    if (typeof bs === "number" && (best === null || bs > best)) { best = bs; if (pm && pm.bestSec) sec = pm.bestSec; }
  });
  return best === null ? null : { score: best, sec };
}
function prepGather() {
  const data = {}; PREP_SYSTEMS.forEach(s => data[s] = { closed: null, open: null, secC: null, secO: null, attempts: 0 });
  const Q = activeProgress().quizzes || {};
  Object.keys(Q).forEach(key => {
    const syss = prepKeyToSystems(key); if (!syss) return;
    const entry = Q[key]; const modes = entry.modes || {};
    syss.forEach(s => {
      ["closed","open"].forEach(md => {
        const pm = modes[md];
        if (pm && typeof pm.bestScore === "number") {
          const cur = data[s][md]; if (cur === null || pm.bestScore > cur) data[s][md] = pm.bestScore;
          if (pm.bestSec) { const kk = md === "closed" ? "secC" : "secO"; if (data[s][kk] === null || pm.bestSec < data[s][kk]) data[s][kk] = pm.bestSec; }
          data[s].attempts += pm.attempts || 0;
        }
      });
      if (!modes.closed && !modes.open && typeof entry.bestScore === "number") { // legacy results -> count as closed
        if (data[s].closed === null || entry.bestScore > data[s].closed) data[s].closed = entry.bestScore;
        data[s].attempts += entry.attempts || 0;
      }
    });
  });
  return data;
}
function prepFluency(sec) { if (!sec) return null; return Math.max(0, Math.min(100, Math.round((30 - sec) / 20 * 100))); }
function prepReadiness(d, md) {
  const acc = d[md]; if (acc === null) return null;
  const fl = prepFluency(md === "closed" ? d.secC : d.secO);
  return fl === null ? acc : Math.round(acc * 0.8 + fl * 0.2);
}
function prepBand(pct) {
  if (pct >= 90) return { label: "Exam-ready", color: "#2E7D32" };
  if (pct >= 75) return { label: "Almost there", color: "#2E74B5" };
  if (pct >= 50) return { label: "Building", color: "#E67E22" };
  return { label: "Keep going", color: "#C62828" };
}

/* ===== COVERAGE ENGINE (Performance / Readiness / Book Knowledge) =====
   Built from per-question mastery in qstats (per closed/with-notes mode):
     Performance = known / attempted   (accuracy on what you tried)
     Readiness   = known / total       (coverage-weighted mastery of a system)
     Book know.  = known / total across the whole bank (GR + Stuvia + ClaudeBank)
   "known" = your most recent answer to that question, in that mode, was correct. */
let _covSrc = null, _bookSrc = null;
function _grSubIds(title) {
  const t = (typeof DATA !== "undefined" && DATA.sections.torso) ? DATA.sections.torso : null;
  const st = t && (t.subtopics || []).find(s => s.title === title);
  return st ? (st.quiz || []).map(q => q.id).filter(Boolean) : [];
}
function _cbIds(i) {
  const c = (typeof CLAUDEBANK !== "undefined") ? CLAUDEBANK[i] : null;
  return c ? (c.questions || []).map(q => q.id).filter(Boolean) : [];
}
// Per-system question pools spanning ALL THREE banks (GR + Stuvia + ClaudeBank), assigned by the
// official book map: each question's Martini section → chapter → body system. This pulls in Stuvia
// (which is organized by region, not system) so Performance/Readiness reflect every bank, not just GR+CB.
const CH2SYS = {19:"Endocrine",20:"Blood",21:"Heart",22:"Vessels & Circulation",23:"Lymphatic",24:"Respiratory",25:"Digestive",26:"Urinary",27:"Reproductive",28:"Embryology"};
function coverageSources() {
  if (_covSrc) return _covSrc;
  const S = {}; PREP_SYSTEMS.forEach(s => S[s] = []);
  if (typeof Q_BOOKLOC !== "undefined") {
    Object.keys(Q_BOOKLOC).forEach(id => {
      const sec = Q_BOOKLOC[id].s; if (!sec) return;
      const ch = parseInt(String(sec).split(".")[0], 10);
      const sys = CH2SYS[ch];
      if (sys && S[sys]) S[sys].push(id);
    });
  } else { // fallback: GR subtopics + ClaudeBank only (pre-coverage-map)
    S["Respiratory"] = [..._cbIds(0)];
    S["Heart"] = [..._grSubIds("Heart"), ..._cbIds(0)];
    S["Vessels & Circulation"] = [..._grSubIds("Vessels and Circulation"), ..._cbIds(5)];
    S["Blood"] = [..._grSubIds("Blood"), ..._cbIds(4)];
    S["Lymphatic"] = [..._grSubIds("Lymphatic"), ..._cbIds(6)];
    S["Endocrine"] = [..._grSubIds("Endocrine"), ..._cbIds(3)];
    S["Digestive"] = [..._grSubIds("Digestive"), ..._cbIds(1)];
    S["Urinary"] = [..._grSubIds("Urinary"), ..._cbIds(2)];
    S["Reproductive"] = [..._grSubIds("Reproductive"), ..._cbIds(2)];
    S["Embryology"] = [..._grSubIds("Embryology and Development"), ..._cbIds(7)];
  }
  Object.keys(S).forEach(k => S[k] = [...new Set(S[k])]);
  _covSrc = S; return S;
}
function bookSources() {
  if (_bookSrc) return _bookSrc;
  const gr = [], st = [], cb = [];
  if (typeof DATA !== "undefined" && DATA.sections.torso)
    (DATA.sections.torso.subtopics || []).forEach(s => (s.quiz || []).forEach(q => { if (q.id) gr.push(q.id); }));
  if (typeof STUVIA_BANK !== "undefined") STUVIA_BANK.forEach(s => (s.questions || []).forEach(q => { if (q.id) st.push(q.id); }));
  if (typeof CLAUDEBANK !== "undefined") CLAUDEBANK.forEach(s => (s.questions || []).forEach(q => { if (q.id) cb.push(q.id); }));
  _bookSrc = { "Guided Readings": [...new Set(gr)], "Stuvia": [...new Set(st)], "ClaudeBank": [...new Set(cb)] };
  return _bookSrc;
}
function _qm(id, mode) { const s = (activeProgress().qstats || {})[id]; return s && s.m && s.m[mode] ? s.m[mode] : null; }
/* Recall-weighted: "known" is the sum of current recall probabilities (durable mastery that
   decays if you stop reviewing), not a raw once-correct count. */
function covStats(ids, mode) {
  let attempted = 0, known = 0;
  ids.forEach(id => { const m = _qm(id, mode); if (m && m.s > 0) attempted++; known += qRecall(id, mode); });
  return { total: ids.length, attempted, known: Math.round(known * 10) / 10 };
}

/* ===== BLUEPRINT (exam-composition) pools: Thorax / Abdomen / Pelvis / Systemic =====
   The real Torso exam is ~50 questions per region, so readiness is weighted to that. */
let _bpSrc = null;
function _optGuess(q) { const n = (q.options || []).length; if (q.tf || n === 2) return 0.5; return n > 0 ? 1 / n : 0.2; }
function blueprintSources() {
  if (_bpSrc) return _bpSrc;
  const P = { Thorax: [], Abdomen: [], Pelvis: [], Systemic: [] };
  const put = (region, q) => { if (q && q.id) P[region].push({ id: q.id, g: _optGuess(q) }); };
  const regionOf = t => /thora/i.test(t) ? "Thorax" : /abdom/i.test(t) ? "Abdomen" : /pelvis|perineum/i.test(t) ? "Pelvis" : "Systemic";
  if (typeof DATA !== "undefined" && DATA.sections.torso)
    (DATA.sections.torso.subtopics || []).forEach(s => { const r = regionOf(s.title || ""); (s.quiz || []).forEach(q => put(r, q)); });
  if (typeof STUVIA_BANK !== "undefined") STUVIA_BANK.forEach(s => { const r = regionOf(s.title || ""); (s.questions || []).forEach(q => put(r, q)); });
  if (typeof CLAUDEBANK !== "undefined") CLAUDEBANK.forEach(s => { const r = regionOf(s.title || ""); (s.questions || []).forEach(q => put(r, q)); });
  _bpSrc = P; return P;
}
const BLUEPRINT = [["Thorax", 50], ["Abdomen", 50], ["Pelvis", 50], ["Systemic", 50]];
// Recall-weighted readiness (0..100) for one blueprint region, no guess credit (demonstrated).
function blueprintReadiness(region, mode) {
  const pool = blueprintSources()[region] || []; if (!pool.length) return null;
  let sum = 0; pool.forEach(o => sum += qRecall(o.id, mode));
  return Math.round(sum / pool.length * 100);
}
// Overall exam readiness = blueprint-weighted average; also the weakest region.
function examReadiness(mode) {
  let wSum = 0, w = 0, weakest = null;
  BLUEPRINT.forEach(([r, wt]) => { const v = blueprintReadiness(r, mode); if (v == null) return; wSum += v * wt; w += wt; if (weakest == null || v < weakest.v) weakest = { r, v }; });
  return { overall: w ? Math.round(wSum / w) : null, weakest };
}
function _regionIds(region) { return (blueprintSources()[region] || []).map(o => o.id); }
// Bars broken out by exam region (Thorax / Abdomen / Pelvis / Systemic — 50 questions each).
function appendRegionBars(main, md, metric) {
  const wrap = document.createElement("div"); wrap.style.cssText = "margin:12px 0 4px;";
  const hdr = document.createElement("div");
  hdr.style.cssText = "font-size:.82rem;color:#1F3864;font-weight:800;margin-bottom:6px;";
  hdr.innerHTML = "🧭 By exam region <span style='font-weight:600;color:#999;'>(50 questions each)</span>";
  wrap.appendChild(hdr);
  ["Thorax", "Abdomen", "Pelvis", "Systemic"].forEach(r => {
    const c = covStats(_regionIds(r), md);
    let pct, detail;
    if (metric === "performance") { pct = c.attempted ? Math.round(c.known / c.attempted * 100) : null; detail = `${Math.round(c.known)}/${c.attempted}`; }
    else { pct = c.total ? Math.round(c.known / c.total * 100) : 0; detail = `${Math.round(c.known)}/${c.total}`; }
    const col = pct == null ? "#bbb" : prepBand(pct).color;
    const row = document.createElement("div"); row.style.cssText = "margin:8px 0;";
    row.innerHTML = `<div style="display:flex;justify-content:space-between;font-size:.9rem;margin-bottom:3px;">
        <span style="font-weight:700;">${r}</span>
        <span style="color:${col};font-weight:700;">${pct == null ? "Not tried" : pct + "% · " + detail}</span></div>
      <div style="height:9px;background:#ececec;border-radius:5px;overflow:hidden;"><div style="height:100%;width:${pct || 0}%;background:${col};border-radius:5px;"></div></div>`;
    wrap.appendChild(row);
  });
  if (metric === "readiness") {
    const er = examReadiness(md);
    if (er.overall != null) {
      const ready = er.overall >= 85 && er.weakest && er.weakest.v >= 70;
      const g = document.createElement("div"); g.style.cssText = `margin-top:6px;font-size:.8rem;font-weight:600;color:${ready?"#2E7D32":"#C62828"};`;
      g.innerHTML = ready ? "✅ Balanced — every region ≥70% and overall ≥85%." : `⚠️ Weakest region: <b>${er.weakest?er.weakest.r:"—"} (${er.weakest?er.weakest.v:0}%)</b>. Ready = overall ≥85% AND every region ≥70%.`;
      wrap.appendChild(g);
    }
  }
  main.appendChild(wrap);
}

/* ===== PREDICTED EXAM SCORE (Monte-Carlo over the blueprint) =====
   Samples a 200-question exam per the region composition; each question is answered correctly
   with probability qExamProb (recall + guess/elimination credit). Returns expected raw score,
   a likely range, and the chance of clearing target cutoffs. */
var _predVer = 0;        // bumped whenever a question stat changes → invalidates the memo
var _predMemo = {};
// DIAG_PRINTED = number of exam points (out of 200) that are printed labeling diagrams, taken
// verbatim from the GR/Stuvia figures — i.e. ~guaranteed if you have the printed key on exam day.
const DIAG_PRINTED = 40; // ~20% of the 200-question exam
function predictExam(mode, runs, diagFloor) {
  const key = mode + "|" + (state.allTime ? 1 : 0) + "|" + _predVer + "|" + (runs || 600) + "|" + (diagFloor ? 1 : 0);
  if (_predMemo[key]) return _predMemo[key];
  const pools = blueprintSources();
  const ready = BLUEPRINT.every(([r]) => (pools[r] || []).length);
  if (!ready) return null;
  runs = runs || 600;
  // Precompute each question's exam-probability ONCE (was recomputed 300k× → froze the browser).
  const P = {}; BLUEPRINT.forEach(([r]) => { P[r] = pools[r].map(o => qExamProb(o.id, mode, o.g)); });
  const total = BLUEPRINT.reduce((a, [, n]) => a + n, 0);   // 200
  const guaranteed = diagFloor ? DIAG_PRINTED : 0;           // printed diagram points assumed correct
  const scale = (total - guaranteed) / total;                // shrink each section's simulated count
  const plan = BLUEPRINT.map(([r, n]) => [r, Math.round(n * scale)]);
  const scores = new Array(runs);
  for (let k = 0; k < runs; k++) {
    let correct = guaranteed;
    for (const [r, n] of plan) {
      const arr = P[r], L = arr.length;
      for (let j = 0; j < n; j++) { if (Math.random() < arr[(Math.random() * L) | 0]) correct++; }
    }
    scores[k] = correct;
  }
  scores.sort((a, b) => a - b);
  // Realistic full-length mocks ("The Real Deal" / mini mocks) are the best single readiness signal,
  // so give them modest extra weight: nudge the whole predicted distribution toward your mock average.
  const modelMean = scores.reduce((a, b) => a + b, 0) / runs;
  const mockPct = (typeof recentMockAvg === "function") ? recentMockAvg(mode) : null;
  let mockWeighted = false;
  if (mockPct != null) {
    mockWeighted = true;
    const MOCK_W = 0.25; // 25% pull toward the mock average (kept slight so one run can't dominate)
    const shift = ((1 - MOCK_W) * modelMean + MOCK_W * (mockPct / 100 * total)) - modelMean;
    for (let k = 0; k < runs; k++) scores[k] = Math.max(0, Math.min(total, scores[k] + shift));
    scores.sort((a, b) => a - b);
  }
  const mean = scores.reduce((a, b) => a + b, 0) / runs;
  const q = p => scores[Math.min(runs - 1, Math.max(0, Math.round(p * (runs - 1))))];
  const pAtLeast = frac => scores.filter(s => s >= frac * total).length / runs;
  const res = { total, mean: Math.round(mean), meanPct: Math.round(mean / total * 100),
    lo: q(0.05), hi: q(0.95), p75: Math.round(pAtLeast(0.75) * 100), p90: Math.round(pAtLeast(0.90) * 100), diagFloor: !!diagFloor, mockWeighted };
  _predMemo = {}; _predMemo[key] = res;   // keep only the latest
  return res;
}

/* ===== BOOK KNOWLEDGE via official Martini section coverage =====
   Each of the 76 core Martini sections is one unit (equal weight, so Stuvia's larger count can't
   dominate). Section mastery = recall-weighted over the questions mapped to it. */
let _secQ = null;
function sectionQIDs() {
  if (_secQ) return _secQ;
  const map = {};
  if (typeof Q_BOOKLOC !== "undefined") Object.keys(Q_BOOKLOC).forEach(id => { const s = Q_BOOKLOC[id].s; if (s) (map[s] = map[s] || []).push(id); });
  _secQ = map; return map;
}
function coreSections() { return (typeof TORSO_SECTIONS !== "undefined") ? TORSO_SECTIONS.filter(s => s.core) : []; }
function bookKnowledge(mode) {
  const secs = coreSections(), byS = sectionQIDs();
  let masterySum = 0, practiced = 0, n = 0;
  const perCh = {};
  secs.forEach(s => {
    const ids = byS[s.id] || []; if (!ids.length) return; n++;
    let recall = 0, tried = 0;
    ids.forEach(id => { recall += qRecall(id, mode); const m = _qm(id, mode); if (m && m.s > 0) tried++; });
    const m = recall / ids.length; masterySum += m; if (tried > 0) practiced++;
    const c = perCh[s.ch] || { name: s.chName, sum: 0, n: 0 }; c.sum += m; c.n++; perCh[s.ch] = c;
  });
  return { pct: n ? Math.round(masterySum / n * 100) : 0, sections: n, practiced, perCh };
}
// per-system value for the chosen metric (0..100 or null if nothing applicable)
function prepMetricVal(system, mode, metric) {
  const c = covStats(coverageSources()[system] || [], mode);
  if (metric === "performance") return c.attempted === 0 ? null : Math.round(c.known / c.attempted * 100);
  return c.total === 0 ? null : Math.round(c.known / c.total * 100); // readiness
}
function prepMetricToggle(main, metric) {
  const mt = document.createElement("div");
  mt.style.cssText = "display:flex;gap:6px;justify-content:center;margin:2px 0 8px;flex-wrap:wrap;";
  [["performance","📊 Performance"],["readiness","🎯 Readiness"],["book","📚 Book knowledge"]].forEach(([m, lbl]) => {
    const b = document.createElement("button"); const on = metric === m;
    b.style.cssText = `border:1.5px solid ${on?"#1F3864":"#ccc"};background:${on?"#1F3864":"#fff"};color:${on?"#fff":"#555"};border-radius:20px;padding:6px 12px;font-size:.82rem;font-weight:700;cursor:pointer;`;
    b.className = "pillBtn"; b.textContent = lbl; b.onclick = () => { state.prepMetric = m; render(); }; mt.appendChild(b);
  });
  main.appendChild(mt);
  const exp = document.createElement("div");
  exp.style.cssText = "text-align:center;color:#888;font-size:.76rem;margin:0 0 10px;padding:0 14px;line-height:1.45;";
  exp.innerHTML = metric === "performance"
    ? "<b>Performance</b> — of the questions you've <i>attempted</i>, how much you'd recall today (decays over time)."
    : metric === "book"
    ? "<b>Book knowledge</b> — your current recall across all 76 official Martini sections, weighted equally. Fades if you stop reviewing."
    : "<b>Readiness</b> — of <i>all</i> questions in each system, how much you'd recall today. Untried or forgotten counts as 0.";
  main.appendChild(exp);
}
function prepModeToggle(main, md) {
  const toggle = document.createElement("div");
  toggle.style.cssText = "display:flex;gap:8px;justify-content:center;margin:6px 0 10px;";
  [["closed","🧠 Closed-book (true)"],["open","📖 With notes"]].forEach(([m, lbl]) => {
    const b = document.createElement("button"); const on = md === m;
    b.style.cssText = `border:1.5px solid ${on?"#1F3864":"#ccc"};background:${on?"#1F3864":"#fff"};color:${on?"#fff":"#555"};border-radius:20px;padding:7px 14px;font-size:.85rem;font-weight:700;cursor:pointer;`;
    b.className = "pillBtn"; b.textContent = lbl; b.onclick = () => { setStudyMode(m); render(); }; toggle.appendChild(b);
  });
  main.appendChild(toggle);
}
function prepPeriodToggle(main) {
  const per = document.createElement("div");
  per.style.cssText = "display:flex;gap:8px;justify-content:center;margin:0 0 12px;";
  [[false,"This period"],[true,"All-time"]].forEach(([v, lbl]) => {
    const b = document.createElement("button"); const on = !!state.allTime === v;
    b.style.cssText = `border:1px solid ${on?"#2E7D32":"#ddd"};background:${on?"#E8F5E9":"#fff"};color:${on?"#2E7D32":"#888"};border-radius:16px;padding:4px 12px;font-size:.78rem;font-weight:700;cursor:pointer;`;
    b.className = "pillBtn"; b.textContent = lbl; b.onclick = () => { state.allTime = v; render(); }; per.appendChild(b);
  });
  main.appendChild(per);
}
/* Recent FULL-LENGTH realistic-mock average (for weighting/calibrating the prediction against reality).
   ONLY the ~200-question realistic mocks (Simulation "The Real Deal", Stuvia/ClaudeBank sims) count —
   NOT the 100-question mini mocks, timed GRs, or quizzes. Averages your last few in the given mode. */
function recentMockAvg(mode) {
  const recs = (typeof allAttempts === "function" ? allAttempts() : []).filter(a =>
    a.kind === "mock" &&
    (a.rec.total || 0) >= 150 &&                         // full-length only (mini mocks are 100)
    !/mini/i.test(a.rec.title || a.title || "") &&       // extra guard against mini mocks
    a.rec.mode === mode &&
    typeof a.rec.pct === "number");
  if (!recs.length) return null;
  const vals = recs.slice(0, 3).map(a => a.rec.pct);     // most recent up to 3
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}
/* Predicted Exam Score card — the headline "am I ready?" forecast. */
function _bpAttempted(md) {
  const pools = blueprintSources(); let n = 0;
  Object.keys(pools).forEach(r => pools[r].forEach(o => { const m = _qm(o.id, md); if (m && m.s > 0) n++; }));
  return n;
}
function renderExamOutlook(main, md) {
  const diagOn = !!state.predDiagrams;
  const pred = predictExam(md, undefined, diagOn);
  const card = document.createElement("div");
  card.style.cssText = "margin:6px 0 14px;padding:14px 16px;border-radius:14px;background:linear-gradient(135deg,#1F3864,#2E74B5);color:#fff;";
  if (!pred || _bpAttempted(md) < 5) {
    card.innerHTML = `<div style="font-weight:800;font-size:1rem;margin-bottom:4px;">🔮 Predicted exam score</div>
      <div style="font-size:.85rem;opacity:.9;">Practice some questions in <b>${md==="closed"?"closed-book":"with-notes"}</b> mode and this forecasts your 200-question exam result (score, likely range, and odds of clearing 75% / 90%).</div>`;
    main.appendChild(card); return;
  }
  const cal = recentMockAvg(md);
  const calLine = cal != null ? `<div style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,.25);font-size:.8rem;opacity:.95;">📏 Weighted <b>25%</b> toward your realistic-mock average (<b>${cal}%</b>) — mocks are the strongest readiness signal.</div>` : "";
  card.innerHTML = `
    <div style="font-weight:800;font-size:1rem;margin-bottom:6px;">🔮 Predicted exam score <span style="font-weight:600;opacity:.85;font-size:.8rem;">· if it were today · ${md==="closed"?"closed-book":"with-notes"}</span></div>
    <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;">
      <div style="font-size:2.6rem;font-weight:800;line-height:1;">${pred.mean}<span style="font-size:1.1rem;font-weight:600;opacity:.8;">/${pred.total}</span></div>
      <div style="font-size:1.3rem;font-weight:700;opacity:.95;">${pred.meanPct}%</div>
      <div style="font-size:.85rem;opacity:.9;">likely ${pred.lo}–${pred.hi}</div>
    </div>
    <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;">
      <div style="flex:1;min-width:120px;background:rgba(255,255,255,.15);border-radius:10px;padding:8px 10px;">
        <div style="font-size:.72rem;opacity:.85;">chance ≥ 75%</div><div style="font-size:1.25rem;font-weight:800;">${pred.p75}%</div></div>
      <div style="flex:1;min-width:120px;background:rgba(255,255,255,.15);border-radius:10px;padding:8px 10px;">
        <div style="font-size:.72rem;opacity:.85;">chance ≥ 90%</div><div style="font-size:1.25rem;font-weight:800;">${pred.p90}%</div></div>
    </div>${calLine}`;
  // ── Diagram-printed toggle (switch) ──
  const tog = document.createElement("div");
  tog.style.cssText = "margin-top:12px;padding-top:10px;border-top:1px solid rgba(255,255,255,.25);display:flex;align-items:center;gap:10px;cursor:pointer;";
  tog.onclick = () => { state.predDiagrams = !state.predDiagrams; render(); };
  const knob = diagOn
    ? `<span style="width:40px;height:22px;border-radius:22px;background:#34D399;position:relative;display:inline-block;flex:0 0 auto;"><span style="position:absolute;top:2px;left:20px;width:18px;height:18px;border-radius:50%;background:#fff;"></span></span>`
    : `<span style="width:40px;height:22px;border-radius:22px;background:rgba(255,255,255,.3);position:relative;display:inline-block;flex:0 0 auto;"><span style="position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#fff;"></span></span>`;
  tog.innerHTML = `${knob}<span style="font-size:.82rem;line-height:1.35;">🖼️ <b>Count printed diagram labels as correct</b> ${diagOn ? "<span style=\"opacity:.85;\">(on — +40 pts guaranteed)</span>" : "<span style=\"opacity:.7;\">(off)</span>"}<br><span style="opacity:.8;font-size:.74rem;">~20% of the exam is labeling taken verbatim from GR/Stuvia figures you'll have printed.</span></span>`;
  card.appendChild(tog);
  const note = document.createElement("div");
  note.style.cssText = "margin-top:8px;font-size:.72rem;opacity:.8;";
  note.textContent = diagOn
    ? "Monte-Carlo: 40 printed-diagram points assumed correct + 160 questions simulated over the 50/50/50/50 blueprint."
    : "Monte-Carlo over the 50/50/50/50 Thorax·Abdomen·Pelvis·Systemic blueprint. Includes guess/elimination credit for unseen questions.";
  card.appendChild(note);
  main.appendChild(card);
}

/* ===== ACTION PLAN — rule-based coaching: what to do next, ranked by point-gain ===== */
var EXAM_MON = new Date(2026, 6, 20, 9, 0, 0); // target: Mon Jul 20
var EXAM_TUE = new Date(2026, 6, 21, 9, 0, 0); // fallback if not ready: Tue Jul 21
var READY_BAR = 75;                            // predicted % considered "ready for Monday"
// Effective exam day: Monday if you're on track, else Tuesday (your stated fallback).
function examInfo(mode) {
  const pred = predictExam(mode);
  const readyMon = !!pred && pred.meanPct >= READY_BAR;
  const date = readyMon ? EXAM_MON : EXAM_TUE;
  const days = Math.max(0, Math.ceil((date - Date.now()) / 86400000));
  return { readyMon, date, days, predPct: pred ? pred.meanPct : 0 };
}
function daysToExam() { return examInfo("closed").days; }
function _shortOutcome(o) {
  return String(o || "").replace(/^(Describe|List|Compare and contrast|Outline|Discuss|Explain|Identify|Define|Summarize|Trace)( the| and)?\s*/i, "")
    .replace(/\.$/, "").replace(/^(anatomy (and physiology )?of the )/i, "").trim().slice(0, 42);
}
// Weakest official sections within a system's chapter, with pages to read.
function weakSectionsForSystem(sys, mode, n) {
  const ch = Object.keys(CH2SYS).find(c => CH2SYS[c] === sys);
  const byS = sectionQIDs();
  return coreSections().filter(s => String(s.ch) === String(ch))
    .map(s => { const ids = byS[s.id] || []; let r = 0; ids.forEach(id => r += qRecall(id, mode)); return { s, recall: ids.length ? r / ids.length : 0, cnt: ids.length }; })
    .filter(x => x.cnt >= 2).sort((a, b) => a.recall - b.recall).slice(0, n).map(x => x.s);
}
function studyPlanData(mode) {
  const src = coverageSources();
  const sys = PREP_SYSTEMS.map(s => { const c = covStats(src[s] || [], mode); return { s, r: c.total ? Math.round(c.known / c.total * 100) : 0, untried: c.total - c.attempted, total: c.total, attempted: c.attempted }; });
  const allIds = new Set(); Object.values(src).forEach(a => a.forEach(id => allIds.add(id)));
  let untried = 0, decaying = 0;
  allIds.forEach(id => { const m = _qm(id, mode); if (!m || !m.s) untried++; else if (qRecall(id, mode) < 0.5) decaying++; });
  const weak = sys.slice().sort((a, b) => a.r - b.r).slice(0, 3);
  // regions ordered weakest-first for the day plan
  const regions = ["Thorax", "Abdomen", "Pelvis", "Systemic"].map(r => ({ r, v: blueprintReadiness(r, mode) })).sort((a, b) => (a.v == null ? -1 : a.v) - (b.v == null ? -1 : b.v));
  return { pred: predictExam(mode), exam: examInfo(mode), sys, weak, untried, decaying, regions };
}
// Build a date-aware day plan from tomorrow through the effective exam day.
function buildDaySchedule(d, md) {
  const order = d.regions.map(x => x.r);
  const now = new Date();
  const examMid = new Date(d.exam.date.getFullYear(), d.exam.date.getMonth(), d.exam.date.getDate()); // exam day at midnight
  const days = []; // study days (excl. exam day)
  let cur = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  while (cur < examMid) { days.push(new Date(cur)); cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1); }
  const wd = dt => dt.toLocaleDateString("en-US", { weekday: "short" });
  const rows = [["Tonight", `Quick diagnostic: one timed Guided-Reading on ${order[0]} to set a baseline.`]];
  const n = days.length;
  days.forEach((dt, i) => {
    let task;
    if (i === n - 1) task = `Light review of fading cards + Diagram Gallery. No new material — rest up.`;
    else if (i === n - 2) task = `Full 200-question closed-book mock, then re-read only what you miss.`;
    else {
      const regs = [order[i * 2 % order.length], order[(i * 2 + 1) % order.length]];
      task = `${regs[0]} + ${regs[1]} — read the flagged Martini pages, then timed questions closed-book. Review every miss.`;
    }
    rows.push([wd(dt), task]);
  });
  rows.push([wd(d.exam.date), `💪 Exam${d.exam.readyMon ? "" : " (fallback day — push to be ready Monday)"}.`]);
  return rows;
}
/* Recognition-vs-mastery: are you learning concepts, or memorizing specific items?
   Signals: burst-drilled items that never stabilize, very fast repeat-corrects, and sections
   where you ace the few questions you tried but have barely covered them. */
// Look up a question's actual text by its id (across GR/exams/flashcards, Stuvia, ClaudeBank) — so the
// coach can show the real question instead of a meaningless internal id like "GR-5830".
var _qTextIndex = null;
function qTextById(id) {
  if (!_qTextIndex) {
    _qTextIndex = {};
    const add = q => { if (q && q.id && _qTextIndex[q.id] == null) _qTextIndex[q.id] = String(q.q || q.question || ""); };
    try { if (typeof DATA !== "undefined") Object.values(DATA.sections).forEach(s => { (s.subtopics || []).forEach(t => (t.quiz || []).forEach(add)); (s.exams || []).forEach(e => (e.questions || []).forEach(add)); (s.flashcards || []).forEach(add); }); } catch (e) {}
    try { if (typeof STUVIA_BANK !== "undefined") STUVIA_BANK.forEach(s => (s.questions || []).forEach(add)); } catch (e) {}
    try { if (typeof CLAUDEBANK !== "undefined") CLAUDEBANK.forEach(s => (s.questions || []).forEach(add)); } catch (e) {}
  }
  return _qTextIndex[id] || "";
}
// "Fuzzy" = you flip between right and wrong on the SAME item and it's not solid now (not just one old slip).
function isFuzzy(id, mode) {
  const m = (activeProgress().qstats || {})[id]; const mm = m && m.m && m.m[mode];
  if (!mm || mm.s < 2 || !(mm.c > 0 && mm.c < mm.s)) return false;
  return ((mm.s - mm.c) / mm.s) >= 0.25 && qRecall(id, mode) < 0.85;
}
function avgTimeMs(mm) { return mm && mm.tn ? mm.tt / mm.tn : null; }
function masteryQuality(mode) {
  const qs = (activeProgress().qstats) || {};
  let attempted = 0, durable = 0, fragile = 0, fast = 0, fuzzy = 0, fuzzyFast = 0;
  const fuzzyIds = [];
  Object.keys(qs).forEach(id => {
    const m = qs[id].m && qs[id].m[mode]; if (!m || !m.s) return; attempted++;
    const S = m.S || 0, reps = m.reps || 0, r = qRecall(id, mode), at = avgTimeMs(m);
    if (r >= 0.6 && S > 6) durable++;                                  // spaced + retained = real
    if (m.last === 1 && reps >= 3 && S <= 3.5) fragile++;             // drilled in bursts, never spaced
    if (m.last === 1 && at != null && at < 3500 && reps >= 2) fast++; // fast repeat-correct
    if (isFuzzy(id, mode)) { fuzzy++; fuzzyIds.push(id); if (at != null && at < 4000) fuzzyFast++; } // flip-flop = shaky
  });
  // Concept-level consistency: within a section you've touched, are you inconsistent across its items?
  const byS = sectionQIDs(); let shallow = 0, inconsistent = 0; const shallowNames = [], inconsistentNames = [];
  coreSections().forEach(s => {
    const ids = byS[s.id] || []; if (ids.length < 4) return;
    let tried = 0, ok = 0; ids.forEach(id => { const m = qs[id] && qs[id].m && qs[id].m[mode]; if (m && m.s) { tried++; if (qRecall(id, mode) >= 0.6) ok++; } });
    if (tried < 2) return;
    const acc = ok / tried;
    if (acc >= 0.8 && tried / ids.length < 0.4) { shallow++; if (shallowNames.length < 4 && !shallowNames.includes(s.chName)) shallowNames.push(s.chName); }
    if (tried >= 3 && acc >= 0.35 && acc <= 0.75) { inconsistent++; if (inconsistentNames.length < 4 && !inconsistentNames.includes(s.chName)) inconsistentNames.push(s.chName); } // right on some items, wrong on others of the same concept
  });
  return { attempted, durable, fragile, fast, fuzzy, fuzzyFast, fuzzyIds, shallow, shallowNames, inconsistent, inconsistentNames };
}
/* Per-section diagnosis → prescription: what to DO (read vs practice vs re-test vs light review). */
function sectionPrescriptions(mode, limit) {
  const qs = (activeProgress().qstats) || {}, byS = sectionQIDs();
  const out = [];
  coreSections().forEach(s => {
    const ids = byS[s.id] || []; if (!ids.length) return;
    let tried = 0, recall = 0, fuzzy = 0, fastN = 0, tSum = 0, tN = 0;
    ids.forEach(id => {
      const m = qs[id] && qs[id].m && qs[id].m[mode]; recall += qRecall(id, mode);
      if (m && m.s) { tried++; if (isFuzzy(id, mode)) fuzzy++; const at = avgTimeMs(m); if (at != null) { tSum += at; tN++; if (at < 3500) fastN++; } }
    });
    const cov = tried / ids.length, mastery = recall / ids.length, avgT = tN ? tSum / tN : null;
    const fuzzyRate = fuzzy / Math.max(1, tried), fastRate = fastN / Math.max(1, tried);
    let action, why, priority;
    if (tried === 0) { action = "practice"; why = "untried — pure blind spot"; priority = 3 + (1 - mastery); }
    else if (cov < 0.4) { action = "practice"; why = `only ${Math.round(cov*100)}% covered — see more of it first`; priority = 3 + (1 - cov); }
    // covered enough to diagnose: if you flip-flop / reflex-answer, reading beats drilling
    else if (fuzzyRate >= 0.3 || (fastRate >= 0.5 && mastery < 0.75)) { action = "read"; why = "you flip-flop / answer by reflex — you know the wording, not the fact"; priority = 5 + (1 - mastery); }
    else if (mastery < 0.6) { action = "read"; why = "covered it but recall is low — the material isn't sticking"; priority = 4 + (1 - mastery); }
    else if (mastery >= 0.85) { action = "light"; why = "solid — keep it warm"; priority = 0.2; }
    else { action = "practice"; why = "close it out with more reps"; priority = 2 + (1 - mastery); }
    out.push({ id: s.id, ch: s.ch, chName: s.chName, page: s.page, endPage: s.endPage, outcome: s.outcome,
      tried, total: ids.length, cov, mastery, fuzzy, action, why, priority });
  });
  out.sort((a, b) => b.priority - a.priority);
  return limit ? out.slice(0, limit) : out;
}

function renderStudyPlan(main, md) {
  const d = studyPlanData(md);
  const card = document.createElement("div");
  card.style.cssText = "margin:0 0 14px;padding:14px 16px;border-radius:14px;background:#fff;border:2px solid #E67E22;";
  const predPct = d.pred ? d.pred.meanPct : 0;
  const gap = Math.max(0, READY_BAR - predPct);
  const targetTxt = d.exam.readyMon
    ? `On track for <b>Monday</b> (predicted ${predPct}%).`
    : `At <b>${predPct}%</b> you're not ready for Monday yet — this plan runs through <b>Tuesday</b> (your fallback). Beat it and take it Monday.`;
  let html = `<div style="font-weight:800;font-size:1rem;color:#B5560F;margin-bottom:2px;">📋 Your plan — ${d.exam.days} day${d.exam.days===1?"":"s"} to go</div>
    <div style="font-size:.82rem;color:#666;margin-bottom:10px;">${targetTxt}${gap>0?` Need <b>+${gap} pts</b> to clear 75%.`:` 🎉`} Fastest path up, biggest lever first:</div>`;
  // Strengths — what's already working (keep it warm, don't over-drill it).
  const _ps = prepScore(md);
  if (_ps.strengths.length) {
    html += `<div style="margin:0 0 10px;padding:8px 10px;border-radius:10px;background:#EAF6EC;font-size:.82rem;color:#1E5E32;line-height:1.45;">
      💪 <b>Your strengths</b> — ${_ps.strengths.map(x=>`${x.s} (${x.pct}%)`).join(", ")}. These are locked in; just keep them warm with light mixed review — spend your hours on the focus list below.</div>`;
  }
  const steps = [];
  // 1. Biggest lever: close untried blind spots
  if (d.untried > 0) {
    const wnames = d.weak.filter(w => w.untried > 0).map(w => `${w.s} (${w.untried} left)`).slice(0, 3).join(", ");
    steps.push(`<b>Close blind spots — the biggest win.</b> You've left <b>${d.untried.toLocaleString()}</b> questions untried; untried counts as zero, so these are free points. Start with ${wnames || "your weakest systems"}.`);
  }
  // 2. Read + drill the weakest systems (specific Martini pages)
  d.weak.slice(0, 3).forEach(w => {
    const secs = weakSectionsForSystem(w.s, md, 2);
    if (!secs.length) return;
    const reads = secs.map(s => `§${s.ch}.${s.sec} ${_shortOutcome(s.outcome)} (p.${s.page}${s.endPage>s.page?"–"+s.endPage:""})`).join(" · ");
    steps.push(`<b>${w.s} — ${w.r}%.</b> Read Martini ${reads}, then do ~20 closed-book ${w.s} questions.`);
  });
  // 3. Re-lock fading items
  if (d.decaying > 0) steps.push(`<b>Re-lock what's fading.</b> ${d.decaying} questions you once got right are decaying — open <i>"Questions you keep missing"</i> and clear them.`);
  // 3.5 Recognition vs. mastery — are you memorizing items or knowing concepts?
  const mq = masteryQuality(md);
  if (mq.fragile + mq.fast + mq.shallow > 0) {
    const bits = [];
    if (mq.fragile + mq.fast > 0) bits.push(`<b>${mq.fragile + mq.fast}</b> you answer fast or by rote that haven't stabilized`);
    if (mq.shallow > 0) bits.push(`<b>${mq.shallow}</b> topics you ace but have barely covered${mq.shallowNames.length ? ` (${mq.shallowNames.join(", ")})` : ""}`);
    steps.push(`<b>Recognition ≠ mastery.</b> ${bits.join("; ")}. Space these over days and re-test <i>cold</i> — and try the <i>other</i> wordings of the same concept (Stuvia vs ClaudeBank). That's how you tell "I know the material" from "I remember this question."`);
  }
  // 4. Prove it
  steps.push(`<b>Prove it.</b> Take a full 200-question closed-book mock this weekend and watch this predicted score move.`);
  html += `<ol style="margin:0 0 4px;padding-left:20px;font-size:.86rem;line-height:1.5;color:#333;">${steps.map(s=>`<li style="margin-bottom:7px;">${s}</li>`).join("")}</ol>`;
  // day-by-day (date-aware; runs to Monday, or Tuesday if not yet ready)
  const plan = buildDaySchedule(d, md);
  html += `<div style="margin-top:10px;padding-top:8px;border-top:1px solid #f0e0cc;">
    <div style="font-weight:700;font-size:.82rem;color:#B5560F;margin-bottom:5px;">Day-by-day${d.exam.readyMon?"":" (through your Tuesday fallback)"}</div>
    ${plan.map(p=>`<div style="font-size:.82rem;color:#444;margin:3px 0;"><b style="color:#1F3864;">${p[0]}:</b> ${p[1]}</div>`).join("")}</div>`;
  card.innerHTML = html;
  main.appendChild(card);
  const more = document.createElement("button");
  more.style.cssText = "display:block;width:100%;margin:10px 0 0;background:#fff;color:#B5560F;border:1.5px solid #E67E22;border-radius:12px;padding:12px;font-size:.95rem;font-weight:800;cursor:pointer;";
  more.textContent = "🔎 Tell me more — how am I really doing?";
  more.onclick = () => { state.route = "coach"; render(); };
  main.appendChild(more);
}

/* ===== "Tell me more" coach — a rich, specific readout: read vs. practice, per topic ===== */
function renderCoach(main) {
  ensureHoverStyle();
  const md = getStudyMode();
  prepModeToggle(main, md);
  const pred = predictExam(md), info = examInfo(md), mq = masteryQuality(md);
  const rx = sectionPrescriptions(md);
  const read = rx.filter(x => x.action === "read");
  const practice = rx.filter(x => x.action === "practice");
  const light = rx.filter(x => x.action === "light");
  const shortO = o => _shortOutcome(o);

  // Headline
  const head = document.createElement("div");
  head.style.cssText = "margin:2px 0 12px;padding:14px 16px;border-radius:14px;background:linear-gradient(135deg,#1F3864,#2E74B5);color:#fff;";
  head.innerHTML = `<div style="font-weight:800;font-size:1.05rem;">${md==="closed"?"Closed-book":"With-notes"} · predicted ${pred?pred.meanPct:0}%</div>
    <div style="font-size:.86rem;opacity:.95;margin-top:4px;">${info.readyMon?`On track for <b>Monday</b>.`:`Not ready for Monday yet — aiming for your <b>Tuesday</b> fallback. ${pred?`P(≥75%) is ${pred.p75}%.`:""}`}</div>
    <div style="font-size:.8rem;opacity:.85;margin-top:6px;">The honest read: you're strong on <b>${mq.durable}</b> questions, but <b>${mq.fuzzy}</b> are shaky (you flip between right and wrong) and <b>${mq.fast}</b> you answer by reflex. Those aren't learned yet — see below.</div>`;
  main.appendChild(head);

  // Strengths — name what's working so the plan isn't all deficits.
  const _cps = prepScore(md);
  if (_cps.strengths.length) {
    const sw = document.createElement("div");
    sw.style.cssText = "margin:10px 0;padding:12px 14px;border-radius:12px;background:#EAF6EC;border-left:4px solid #2E7D32;";
    sw.innerHTML = `<div style="font-weight:800;color:#1E5E32;font-size:.95rem;">💪 Strengths — keep these warm</div>
      <div style="color:#2E7D32;font-size:.85rem;margin-top:6px;line-height:1.5;">${_cps.strengths.map(x=>`<b>${x.s}</b> — ${x.pct}% on ${x.n} attempted`).join("<br>")}</div>
      <div style="color:#5a7a63;font-size:.78rem;margin-top:6px;">Don't spend scarce hours re-drilling these. A light mixed pass keeps them locked; put the real time into the lists below.</div>`;
    main.appendChild(sw);
  }

  // Test-taking habits — answer-changes (second-guessing) + flag accuracy, aggregated across mocks.
  const beh = behaviorStats();
  if (beh.totalChanges > 0 || beh.flagTotal > 0) {
    const bw = document.createElement("div");
    bw.style.cssText = "margin:10px 0;padding:12px 14px;border-radius:12px;background:#fff;border-left:4px solid #6D28D9;box-shadow:0 1px 3px rgba(0,0,0,.06);";
    let bh = `<div style="font-weight:800;color:#5B21B6;font-size:.95rem;">🧠 Test-taking habits</div>`;
    if (beh.totalChanges > 0) {
      const net = beh.r2w - beh.w2r;
      const verdict = net > 0
        ? `You flip <b>right→wrong ${beh.r2w}×</b> vs wrong→right ${beh.w2r}× — <b style="color:#C0392B;">second-guessing is costing you</b>. On the real exam, trust your first instinct unless you have a concrete reason.`
        : beh.w2r > beh.r2w
        ? `You flip <b>wrong→right ${beh.w2r}×</b> vs right→wrong ${beh.r2w}× — your rechecks help. Keep reviewing flagged ones.`
        : `Right→wrong (${beh.r2w}) and wrong→right (${beh.w2r}) are even — changing is roughly neutral for you.`;
      bh += `<div style="font-size:.84rem;color:#333;margin-top:6px;line-height:1.5;">Across your mocks you changed an answer <b>${beh.totalChanges}×</b> — ${beh.r2w} right→wrong, ${beh.w2r} wrong→right, ${beh.w2w} wrong→wrong.<br>${verdict}</div>`;
    }
    if (beh.flagTotal > 0) {
      const facc = Math.round(beh.flagRight / beh.flagTotal * 100);
      bh += `<div style="font-size:.84rem;color:#333;margin-top:8px;line-height:1.5;">🚩 Of <b>${beh.flagTotal}</b> flagged question${beh.flagTotal===1?"":"s"}, you got <b>${facc}%</b> right. ${facc < 60 ? "Flagging is catching your genuinely-shaky ones — always leave time to revisit them." : "You flag conservatively and usually nail them."}</div>`;
    }
    bw.innerHTML = bh;
    main.appendChild(bw);
  }

  function sectionBlock(title, subtitle, items, color, icon, verb) {
    if (!items.length) return;
    const wrap = document.createElement("div");
    wrap.style.cssText = `margin:10px 0;padding:12px 14px;border-radius:12px;background:#fff;border-left:4px solid ${color};box-shadow:0 1px 3px rgba(0,0,0,.06);`;
    let h = `<div style="font-weight:800;color:${color};font-size:.95rem;">${icon} ${title}</div><div style="color:#777;font-size:.78rem;margin:2px 0 8px;">${subtitle}</div>`;
    items.slice(0, 8).forEach(x => {
      const detail = x.action === "read"
        ? `Read Martini §${x.id} ${shortO(x.outcome)} (p.${x.page}${x.endPage>x.page?"–"+x.endPage:""})`
        : x.action === "practice"
        ? `Do the ${x.total - x.tried} untried ${x.chName} questions`
        : `Quick review only`;
      h += `<div style="margin:6px 0;font-size:.85rem;color:#333;line-height:1.4;">
        <b>${x.chName}</b> <span style="color:#999;">· ${Math.round(x.mastery*100)}% mastered, ${Math.round(x.cov*100)}% seen</span><br>
        <span style="color:${color};">→ ${detail}.</span> <span style="color:#888;">${x.why}.</span></div>`;
    });
    wrap.innerHTML = h;
    main.appendChild(wrap);
  }
  sectionBlock("Read, don't drill", "You've practiced these but you're guessing/flip-flopping — more questions won't fix it. Read the page, then re-test cold.", read, "#C0392B", "📖", "read");
  sectionBlock("Practice — blind spots", "You've barely seen these. Doing the untried questions is the fastest point-gain.", practice, "#E67E22", "🧩", "practice");
  sectionBlock("Keep warm", "Solid. Light review only — don't over-invest here.", light, "#2E7D32", "✅", "light");

  // Fuzzy questions list
  if (mq.fuzzyIds.length) {
    const fz = document.createElement("div");
    fz.style.cssText = "margin:10px 0;padding:12px 14px;border-radius:12px;background:#FFF7E6;border:1px solid #f0d9b5;";
    const rows = mq.fuzzyIds.slice(0, 10).map(id => {
      const loc = (typeof Q_BOOKLOC !== "undefined" && Q_BOOKLOC[id]) ? Q_BOOKLOC[id] : null;
      const m = (activeProgress().qstats || {})[id]; const mm = m && m.m && m.m[md]; const at = avgTimeMs(mm);
      let stem = qTextById(id).replace(/\[GR\]/g, "").trim();
      if (stem.length > 90) stem = stem.slice(0, 90) + "…";
      const meta = `${loc ? `§${loc.s} p.${loc.p} · ` : ""}${mm ? mm.c : 0}✓/${mm ? mm.s : 0} tries${at ? `, ~${(at / 1000).toFixed(1)}s` : ""}`;
      return `<div style="font-size:.82rem;color:#444;margin:6px 0;line-height:1.4;">• ${stem ? escapeHtml(stem) : "<i>(question " + id + ")</i>"}<br><span style="color:#999;font-size:.72rem;">${meta}</span></div>`;
    }).join("");
    fz.innerHTML = `<div style="font-weight:800;color:#B5560F;font-size:.9rem;">⚠️ Fuzzy — you flip between right &amp; wrong (${mq.fuzzyIds.length})</div>
      <div style="color:#777;font-size:.78rem;margin:2px 0 6px;">These are the clearest "memorizing, not knowing" signal${mq.fuzzyFast?` — ${mq.fuzzyFast} of them you answer fast, i.e. guessing on reflex`:""}. Read the underlying section, then re-test cold.</div>
      <div style="max-height:240px;overflow-y:auto;-webkit-overflow-scrolling:touch;padding-right:6px;border-top:1px solid #f0d9b5;margin-top:4px;">${rows}</div>`;
    main.appendChild(fz);
  }

  // Bottom-line coaching
  const bl = document.createElement("div");
  bl.style.cssText = "margin:12px 0;padding:12px 14px;border-radius:12px;background:#EEF4FB;border:1px solid #cfe0f2;font-size:.85rem;color:#333;line-height:1.5;";
  const topRead = read.slice(0, 2).map(x => x.chName).join(" & ");
  const topPrac = practice.slice(0, 2).map(x => x.chName).join(" & ");
  bl.innerHTML = `<b>Bottom line:</b> Stop doing practice questions on ${topRead || "your shaky topics"} — you're pattern-matching, not learning. <b>Read those Martini pages first</b>, then re-test them cold. Spend fresh reps on ${topPrac || "your blind spots"} where you simply haven't seen the material. ${mq.inconsistent?`You're inconsistent within ${mq.inconsistentNames.join(", ")} — same concept, different questions, mixed results; that's a comprehension gap, not a coverage gap.`:""}`;
  main.appendChild(bl);

  const note = document.createElement("div");
  note.style.cssText = "margin-top:8px;color:#aaa;font-size:.72rem;text-align:center;line-height:1.5;";
  note.textContent = "Built from every stat tracked — response time, right/wrong history, spacing, and same-concept consistency. Updates after each test.";
  main.appendChild(note);
}

function renderBookKnowledge(main, md) {
  prepModeToggle(main, md);
  prepPeriodToggle(main);
  const bk = bookKnowledge(md);
  const band = prepBand(bk.pct);
  const head = document.createElement("div");
  head.style.cssText = "text-align:center;margin:4px 0 8px;";
  head.innerHTML = `<div style="font-size:3.4rem;font-weight:800;line-height:1;color:${band.color};">${bk.pct}%</div>
    <div style="font-weight:700;color:${band.color};margin-top:2px;">of the book known${bk.pct>=90?" ✅":""}</div>
    <div style="color:#888;font-size:.85rem;margin-top:4px;">Recall-weighted across all <b>${bk.sections}</b> official Martini sections · ${md==="closed"?"closed-book":"with-notes"}</div>
    <div style="color:#aaa;font-size:.75rem;margin-top:2px;">You've practiced ${bk.practiced}/${bk.sections} sections. Each section is weighted equally, so no bank dominates.</div>`;
  main.appendChild(head);
  // coverage fact
  const cov = document.createElement("div");
  cov.style.cssText = "margin:10px 0 4px;padding:9px 12px;border-radius:10px;background:#E8F5E9;border:1px solid #cde9d0;color:#2E7D32;font-size:.82rem;text-align:center;";
  cov.innerHTML = `📚 <b>Bank coverage: 76/76 sections (100%).</b> Every official Martini section in the exam chapters (19–28) is tested by ≥1 question — verified paragraph-by-paragraph.`;
  main.appendChild(cov);
  // By exam region (Thorax / Abdomen / Pelvis / Systemic)
  appendRegionBars(main, md, "book");
  // per-chapter bars
  const list = document.createElement("div"); list.style.cssText = "margin-top:14px;";
  const chHdr = document.createElement("div");
  chHdr.style.cssText = "font-size:.82rem;color:#1F3864;font-weight:800;margin-bottom:2px;";
  chHdr.textContent = "📖 By Martini chapter";
  list.appendChild(chHdr);
  const chOrder = [19,20,21,22,23,24,25,26,27,28];
  chOrder.forEach(ch => {
    const c = bk.perCh[ch]; if (!c) return;
    const p = Math.round(c.sum / c.n * 100); const col = prepBand(p).color;
    const row = document.createElement("div"); row.style.cssText = "margin:9px 0;";
    row.innerHTML = `<div style="display:flex;justify-content:space-between;font-size:.9rem;margin-bottom:3px;">
        <span style="font-weight:600;">Ch ${ch} · ${c.name}</span>
        <span style="color:${col};font-weight:700;">${p}%</span></div>
      <div style="height:9px;background:#ececec;border-radius:5px;overflow:hidden;">
        <div style="height:100%;width:${p}%;background:${col};border-radius:5px;"></div></div>`;
    list.appendChild(row);
  });
  main.appendChild(list);
  const missBtn = document.createElement("button");
  missBtn.style.cssText = "display:block;width:100%;margin:18px 0 0;background:#1F3864;color:#fff;border:none;border-radius:12px;padding:13px;font-size:.95rem;font-weight:700;cursor:pointer;";
  missBtn.textContent = "🔁 Questions you keep missing";
  missBtn.onclick = () => { state.route = "missedStats"; render(); };
  main.appendChild(missBtn);
  const note = document.createElement("div");
  note.style.cssText = "margin-top:12px;color:#aaa;font-size:.75rem;text-align:center;line-height:1.5;";
  note.textContent = "Book knowledge = your current recall across Martini's official numbered sections. It decays if you stop reviewing and climbs as you get questions right over spaced sessions.";
  main.appendChild(note);
}

/* ===== TRUE PREPAREDNESS composite =====
   Coverage of the whole bank is unrealistic, so raw known/total under-reads real readiness.
   This blends three signals per exam region:
     • acc        — of what you've ATTEMPTED, how much you'd recall right now (decayed 0..1)
     • covConf    — how broadly you've sampled the region (SATURATING: a solid ~40-question sample
                    is treated as representative, so you don't have to grind the entire bank)
     • masteryFac — a memorizing-vs-mastering discount (flip-flop / reflex-fast items pull it down)
   Region score = 100 · acc · covConf · masteryFac. Overall = the 50/50/50/50 average. */
const PREP_TARGET_PER_REGION = 40; // a representative sample; beyond this, extra coverage barely moves confidence
function prepScore(mode) {
  const mq = masteryQuality(mode);
  const fuzzyFrac = mq.attempted ? mq.fuzzy / mq.attempted : 0;
  const masteryFac = Math.max(0.7, 1 - 0.5 * fuzzyFrac);
  let attemptedTot = 0;
  const regions = BLUEPRINT.map(([r]) => {
    const ids = _regionIds(r);
    const c = covStats(ids, mode);
    attemptedTot += c.attempted;
    const acc = c.attempted ? c.known / c.attempted : 0;
    const target = Math.min(ids.length || PREP_TARGET_PER_REGION, PREP_TARGET_PER_REGION);
    const covConf = ids.length ? (0.5 + 0.5 * Math.min(1, c.attempted / target)) : 0;
    const score = Math.round(acc * covConf * masteryFac * 100);
    return { r, score, acc: Math.round(acc * 100), attempted: c.attempted, total: ids.length, covConf: Math.round(covConf * 100) };
  });
  const overall = Math.round(regions.reduce((a, x) => a + x.score, 0) / regions.length);
  const weakest = regions.slice().sort((a, b) => a.score - b.score)[0];
  const coverageOverall = Math.min(1, attemptedTot / (regions.length * PREP_TARGET_PER_REGION));
  const confidence = coverageOverall >= 0.75 ? "high" : coverageOverall >= 0.4 ? "medium" : "low";
  // System-level strengths & focus (finer than region)
  const src = coverageSources();
  const sysStats = PREP_SYSTEMS.map(s => {
    const c = covStats(src[s] || [], mode);
    return { s, acc: c.attempted ? c.known / c.attempted : 0, attempted: c.attempted, total: (src[s] || []).length };
  });
  const strengths = sysStats.filter(x => x.attempted >= 6 && x.acc >= 0.8)
    .sort((a, b) => b.acc - a.acc).slice(0, 4).map(x => ({ s: x.s, pct: Math.round(x.acc * 100), n: x.attempted }));
  const focus = sysStats.filter(x => x.total > 0)
    .map(x => ({ s: x.s, pct: x.attempted ? Math.round(x.acc * 100) : null, untried: x.total - x.attempted, attempted: x.attempted }))
    .sort((a, b) => {
      const av = a.attempted < 4 ? -1 : a.pct, bv = b.attempted < 4 ? -1 : b.pct;
      return av - bv;
    }).slice(0, 3);
  const ready = overall >= READY_BAR && weakest && weakest.score >= 65 && confidence !== "low";
  return { overall, regions, weakest, confidence, coverageOverall: Math.round(coverageOverall * 100), strengths, focus, ready, masteryFac, mq };
}
function _prepBandColor(v) { return v >= 80 ? "#2E7D32" : v >= 65 ? "#1F3864" : v >= 50 ? "#E67E22" : "#C62828"; }
function renderPrepVerdict(main, md) {
  const p = prepScore(md);
  if (p.regions.every(r => r.attempted === 0)) return; // nothing yet — the outlook card already explains
  const col = _prepBandColor(p.overall);
  const verdict = p.ready ? "On track — you're basically ready."
    : p.confidence === "low" ? "Too early to call — sample more to trust this."
    : p.overall >= 60 ? "Close — a focused push gets you there."
    : "Not ready yet — but the path is clear below.";
  const card = document.createElement("div");
  card.style.cssText = `margin:6px 0 14px;padding:15px 16px;border-radius:14px;background:#fff;border:2px solid ${col};`;
  const confNote = p.confidence === "high" ? "based on a broad sample" : p.confidence === "medium" ? "based on a moderate sample" : "based on a thin sample so far";
  let html = `<div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;">
      <div style="font-weight:800;font-size:1rem;color:${col};">🧭 True preparedness</div>
      <div style="font-size:2rem;font-weight:800;line-height:1;color:${col};">${p.overall}%</div>
      <div style="font-size:.82rem;color:#666;">${md==="closed"?"closed-book":"with-notes"} · ${confNote}</div>
    </div>
    <div style="font-size:.9rem;font-weight:700;color:${col};margin:6px 0 2px;">${verdict}</div>
    <div style="font-size:.76rem;color:#888;line-height:1.4;margin-bottom:8px;">Skill on what you've practiced × how broadly you've sampled (a solid ~40-question sample per region counts as representative — you don't have to finish the whole bank) × a memorizing-vs-mastering check.</div>`;
  // The 4 main regions at a glance (Thorax / Abdomen / Pelvis / Systemic)
  html += `<div style="display:flex;gap:6px;margin:6px 0 2px;">` + p.regions.map(rg => {
    const rc = rg.attempted === 0 ? "#bbb" : _prepBandColor(rg.score);
    const lbl = rg.r === "Systemic" ? "Systemic" : rg.r;
    return `<div style="flex:1;text-align:center;background:#f6f8fb;border-radius:9px;padding:7px 4px;">
      <div style="font-size:.68rem;color:#5a6b85;font-weight:700;">${lbl}</div>
      <div style="font-size:1.15rem;font-weight:800;color:${rc};">${rg.attempted===0?"—":rg.score+"%"}</div>
      <div style="font-size:.6rem;color:#aab;">${rg.attempted} seen</div></div>`;
  }).join("") + `</div>
    <div style="font-size:.68rem;color:#aaa;text-align:center;margin-bottom:2px;">↓ scroll for per-system (heart, blood, digestive…) &amp; per-chapter breakdowns</div>`;
  // Strengths
  if (p.strengths.length) {
    html += `<div style="margin-top:8px;padding-top:8px;border-top:1px solid #eee;">
      <div style="font-size:.8rem;font-weight:800;color:#2E7D32;margin-bottom:4px;">💪 Strengths</div>
      <div style="font-size:.84rem;color:#333;line-height:1.5;">${p.strengths.map(x=>`<b>${x.s}</b> ${x.pct}%`).join(" &nbsp;·&nbsp; ")}</div></div>`;
  }
  // Focus / weak spots
  if (p.focus.length) {
    html += `<div style="margin-top:8px;padding-top:8px;border-top:1px solid #eee;">
      <div style="font-size:.8rem;font-weight:800;color:#C62828;margin-bottom:4px;">🎯 Focus next</div>
      <div style="font-size:.84rem;color:#333;line-height:1.5;">${p.focus.map(x=>`<b>${x.s}</b> ${x.pct==null?`untried (${x.untried} left)`:`${x.pct}%${x.untried?` · ${x.untried} untried`:""}`}`).join(" &nbsp;·&nbsp; ")}</div></div>`;
  }
  // Memorizing-vs-mastering flag
  if (p.mq.fuzzy > 0 || p.mq.fast > 0) {
    html += `<div style="margin-top:8px;font-size:.78rem;color:#B5560F;">🧠 ${p.mq.fuzzy} flip-flop + ${p.mq.fast} reflex-fast item${(p.mq.fuzzy+p.mq.fast)===1?"":"s"} suggest some memorizing — re-test those cold. Tap “Tell me more” for the list.</div>`;
  }
  card.innerHTML = html;
  main.appendChild(card);
}

function renderPreparedness(main) {
  ensureHoverStyle();
  const md = getStudyMode();
  const metric = state.prepMetric || "readiness";
  // Predicted exam score — the headline forecast — shows on every tab.
  renderExamOutlook(main, md);
  // True preparedness composite (coverage-saturating) + strengths — the "am I ready?" verdict.
  renderPrepVerdict(main, md);
  // Action plan — what to do next, ranked by point-gain — only when there's enough signal.
  if (_bpAttempted(md) >= 5) renderStudyPlan(main, md);
  prepMetricToggle(main, metric);
  // Book-Knowledge view has its own layout
  if (metric === "book") { renderBookKnowledge(main, md); return; }
  const readies = PREP_SYSTEMS.map(s => prepMetricVal(s, md, metric));
  const tested = readies.filter(r => r !== null).length;
  const overall = metric === "performance"
    ? (tested ? Math.round(readies.reduce((a, r) => a + (r || 0), 0) / tested) : 0)
    : Math.round(readies.reduce((a, r) => a + (r || 0), 0) / PREP_SYSTEMS.length);
  const band = prepBand(overall);

  // mode toggle
  const toggle = document.createElement("div");
  toggle.style.cssText = "display:flex;gap:8px;justify-content:center;margin:6px 0 14px;";
  [["closed","🧠 Closed-book (true)"],["open","📖 With notes"]].forEach(([m,lbl]) => {
    const b = document.createElement("button");
    const on = md === m;
    b.style.cssText = `border:1.5px solid ${on?"#1F3864":"#ccc"};background:${on?"#1F3864":"#fff"};color:${on?"#fff":"#555"};border-radius:20px;padding:7px 14px;font-size:.85rem;font-weight:700;cursor:pointer;`;
    b.className = "pillBtn";
    b.textContent = lbl;
    b.onclick = () => { setStudyMode(m); render(); };
    toggle.appendChild(b);
  });
  main.appendChild(toggle);

  // period toggle: this fresh-start period vs all-time
  const per = document.createElement("div");
  per.style.cssText = "display:flex;gap:8px;justify-content:center;margin:0 0 12px;";
  [[false,"This period"],[true,"All-time"]].forEach(([v,lbl]) => {
    const b = document.createElement("button");
    const on = !!state.allTime === v;
    b.style.cssText = `border:1px solid ${on?"#2E7D32":"#ddd"};background:${on?"#E8F5E9":"#fff"};color:${on?"#2E7D32":"#888"};border-radius:16px;padding:4px 12px;font-size:.78rem;font-weight:700;cursor:pointer;`;
    b.className = "pillBtn";
    b.textContent = lbl;
    b.onclick = () => { state.allTime = v; render(); };
    per.appendChild(b);
  });
  main.appendChild(per);

  if (tested === 0) {
    const none = document.createElement("div");
    none.style.cssText = "text-align:center;color:#888;padding:26px 16px;";
    none.innerHTML = `No <b>${md === "closed" ? "closed-book" : "with-notes"}</b> practice recorded yet.<br>Take a timed Guided-Reading or ClaudeBank quiz in this mode and your score will appear here.`;
    main.appendChild(none);
    return;
  }

  // headline score ring
  const head = document.createElement("div");
  head.style.cssText = "text-align:center;margin:4px 0 8px;";
  head.innerHTML = `
    <div style="font-size:3.4rem;font-weight:800;line-height:1;color:${band.color};">${overall}%</div>
    <div style="font-weight:700;color:${band.color};margin-top:2px;">${band.label}${overall>=90?" ✅":""}</div>
    <div style="color:#888;font-size:.85rem;margin-top:4px;">${md==="closed"?"closed-book":"with-notes"} ${metric==="performance"?"performance":"readiness"} · ${tested}/${PREP_SYSTEMS.length} systems ${metric==="performance"?"attempted":"covered"}</div>
    <div style="color:#aaa;font-size:.75rem;margin-top:2px;">${metric==="performance"?"Accuracy on questions you've tried. Switch to Readiness to factor coverage." : "Goal: 90% on every system. Questions you haven't tried count as 0."}</div>`;
  main.appendChild(head);

  // By exam region (Thorax / Abdomen / Pelvis / Systemic) — shown for Performance & Readiness
  appendRegionBars(main, md, metric);

  // Mock-exam (Practice Tests) card — a direct 200Q proxy for the real exam
  const mock = prepMockBest(md);
  const mc = document.createElement("div");
  mc.style.cssText = "margin:12px 0;padding:11px 14px;border-radius:12px;background:#EEF4FB;border:1px solid #cfe0f2;display:flex;justify-content:space-between;align-items:center;";
  if (mock) {
    const mb = prepBand(mock.score);
    mc.innerHTML = `<span style="font-size:.88rem;color:#333;">🎓 <b>Mock exam</b> (Practice Tests best)</span>
      <span style="font-weight:800;color:${mb.color};font-size:1.05rem;">${mock.score}%${mock.sec?` · ${mock.sec}s/q`:""}</span>`;
  } else {
    mc.innerHTML = `<span style="font-size:.85rem;color:#777;">🎓 <b>Mock exam</b> — take a full Simulation / Practice Exam in ${md==="closed"?"closed-book":"with-notes"} mode for a true 200-question readiness check.</span>`;
  }
  main.appendChild(mc);

  // per-system bars
  const list = document.createElement("div");
  list.style.cssText = "margin-top:14px;";
  const sysHdr = document.createElement("div");
  sysHdr.style.cssText = "font-size:.82rem;color:#1F3864;font-weight:800;margin-bottom:2px;";
  sysHdr.textContent = "🫀 By body system";
  list.appendChild(sysHdr);
  PREP_SYSTEMS.map((s, i) => ({ s, r: readies[i], c: covStats(coverageSources()[s] || [], md) }))
    .sort((a, b) => (a.r === null ? -1 : a.r) - (b.r === null ? -1 : b.r)) // weakest first
    .forEach(({ s, r, c }) => {
      const row = document.createElement("div");
      row.style.cssText = "margin:9px 0;";
      const col = r === null ? "#bbb" : prepBand(r).color;
      const detail = metric === "performance" ? `${c.known}/${c.attempted}` : `${c.known}/${c.total}`;
      const rightTxt = r === null ? "Not tried" : `${r}% · ${detail}`;
      row.innerHTML = `
        <div style="display:flex;justify-content:space-between;font-size:.9rem;margin-bottom:3px;">
          <span style="font-weight:600;">${s}</span>
          <span style="color:${col};font-weight:700;">${rightTxt}</span>
        </div>
        <div style="height:9px;background:#ececec;border-radius:5px;overflow:hidden;">
          <div style="height:100%;width:${r === null ? 0 : r}%;background:${col};border-radius:5px;"></div>
        </div>`;
      list.appendChild(row);
    });
  main.appendChild(list);

  // focus recommendation
  const weak = PREP_SYSTEMS.map((s, i) => ({ s, r: readies[i] })).filter(x => x.r === null || x.r < 90)
    .sort((a, b) => (a.r === null ? -1 : a.r) - (b.r === null ? -1 : b.r)).map(x => x.s);
  const foc = document.createElement("div");
  foc.style.cssText = "margin-top:16px;background:#FFF7E6;border-left:4px solid #E67E22;border-radius:8px;padding:10px 12px;font-size:.88rem;";
  if (weak.length === 0) foc.innerHTML = `🎉 Every system is at 90%+ in ${md==="closed"?"closed-book":"with-notes"} mode. You're exam-ready — keep it warm with mixed review.`;
  else foc.innerHTML = `<b>Focus next (below 90%):</b> ${weak.slice(0,5).join(", ")}${weak.length>5?` +${weak.length-5} more`:""}.`;
  main.appendChild(foc);

  // actions
  const missBtn = document.createElement("button");
  missBtn.style.cssText = "display:block;width:100%;margin:16px 0 0;background:#1F3864;color:#fff;border:none;border-radius:12px;padding:13px;font-size:.95rem;font-weight:700;cursor:pointer;";
  missBtn.textContent = "🔁 Questions you keep missing";
  missBtn.onclick = () => { state.route = "missedStats"; render(); };
  main.appendChild(missBtn);

  const resetBtn = document.createElement("button");
  resetBtn.style.cssText = "display:block;width:100%;margin:10px 0 0;background:#fff;color:#C62828;border:1.5px solid #eebcbc;border-radius:12px;padding:11px;font-size:.9rem;font-weight:700;cursor:pointer;";
  resetBtn.textContent = "🔄 Start fresh (keeps an all-time record)";
  resetBtn.onclick = () => {
    if (confirm("Start fresh?\n\nYour current scores, missed questions, and progress will be archived to your All-time record (viewable via the All-time toggle) and the live view will reset to zero. Nothing is deleted.")) {
      resetCurrentData();
      state.allTime = false;
      render();
    }
  };
  main.appendChild(resetBtn);

  const note = document.createElement("div");
  note.style.cssText = "margin-top:12px;color:#aaa;font-size:.75rem;text-align:center;line-height:1.5;";
  note.innerHTML = metric === "performance"
    ? "Performance = current recall ÷ questions you've attempted, per system. Spans GR + Stuvia + ClaudeBank. Diagrams excluded."
    : "Readiness = current recall ÷ <b>all</b> questions in the system (GR + Stuvia + ClaudeBank), per system. A lucky short run no longer reads 100%. Diagrams excluded.";
  main.appendChild(note);
}

/* ---------- QUESTIONS YOU KEEP MISSING (per-ID stats + citations) ---------- */
const CHAP_RANGES = [[1,1,26],[6,131,171],[10,259,281],[12,325,337],[17,449,470],[19,506,527],[20,528,544],[21,545,566],[22,567,602],[23,603,623],[24,624,649],[25,650,686],[26,687,706],[27,707,738],[28,739,790]];
function pageToChapter(pg) { if (!pg) return null; for (const r of CHAP_RANGES) if (pg >= r[1] && pg <= r[2]) return r[0]; return null; }
const CHAP_META = {
  1:{name:"Intro to Anatomy",gr:"regions/cavities",region:"mixed"},
  6:{name:"Thoracic Cage",gr:"thoracic skeleton",region:"Thorax"},
  10:{name:"Axial Musculature",gr:"body-wall muscles",region:"mixed"},
  12:{name:"Cross-Sectional Anatomy",gr:"cross sections",region:"mixed"},
  17:{name:"Autonomic Nervous System",gr:"ANS plexuses",region:"mixed"},
  19:{name:"Endocrine System",gr:"Endocrine",region:"Systemic"},
  20:{name:"Blood",gr:"Blood",region:"Systemic"},
  21:{name:"The Heart",gr:"Heart",region:"Thorax"},
  22:{name:"Vessels & Circulation",gr:"Vessels and Circulation",region:"Thorax / Abdomen / Pelvis"},
  23:{name:"Lymphatic System",gr:"Lymphatic",region:"Thorax"},
  24:{name:"Respiratory System",gr:"Respiratory",region:"Thorax"},
  25:{name:"Digestive System",gr:"Digestive",region:"Abdomen"},
  26:{name:"Urinary System",gr:"Urinary",region:"Abdomen / Pelvis"},
  27:{name:"Reproductive System",gr:"Reproductive",region:"Pelvis"},
  28:{name:"Embryology & Development",gr:"Embryology and Development",region:"Pelvis"},
};
let _qIndex = null;
function buildQuestionIndex() {
  if (_qIndex) return _qIndex;
  const idx = {};
  const add = (q, hintCh) => { if (q && q.id && !idx[q.id]) idx[q.id] = { q: q.q, options: q.options, correct: q.correct, tf: q.tf, hintCh }; };
  const subHint = { "Endocrine":19,"Blood":20,"Heart":21,"Vessels and Circulation":22,"Lymphatic":23,"Digestive":25,"Urinary":26,"Reproductive":27,"Embryology and Development":28 };
  if (typeof DATA !== "undefined" && DATA.sections) {
    Object.values(DATA.sections).forEach(sec => {
      (sec.subtopics || []).forEach(st => { const h = subHint[st.title] || null; (st.quiz || []).forEach(q => add(q, h)); });
      (sec.quiz || []).forEach(q => add(q, null));
      (sec.exams || []).forEach(ex => (ex.questions || []).forEach(q => add(q, null)));
    });
  }
  if (typeof CLAUDEBANK !== "undefined") { const cbHint = {0:24,1:25,2:27,3:19,4:20,5:22,6:23,7:28}; CLAUDEBANK.forEach((sec, i) => (sec.questions || []).forEach(q => add(q, cbHint[i]))); }
  if (typeof STUVIA_BANK !== "undefined") { STUVIA_BANK.forEach(sec => (sec.questions || []).forEach(q => add(q, null))); }
  _qIndex = idx; return idx;
}
function bankOfId(id) { return id && id.indexOf("ST-") === 0 ? "Stuvia" : id.indexOf("CB-") === 0 ? "ClaudeBank" : id.indexOf("GR-") === 0 ? "Guided Reading" : id.indexOf("PE-") === 0 ? "Practice Exam" : "Question"; }

function renderMissedStats(main) {
  const idx = buildQuestionIndex();
  const stats = activeProgress().qstats || {};
  const rows = Object.keys(stats).map(id => ({ id, seen: stats[id].seen, missed: stats[id].missed }))
    .filter(r => r.missed >= 1)
    .sort((a, b) => (b.missed - a.missed) || (b.missed / b.seen - a.missed / a.seen));

  const disc = document.createElement("div");
  disc.className = "disclaimer";
  disc.textContent = "The questions you miss most — worst first. Each is cited to Martini (chapter + the exact page), its Torso region, and the Guided Reading it belongs to.";
  main.appendChild(disc);

  if (!rows.length) {
    const none = document.createElement("div");
    none.style.cssText = "text-align:center;color:#888;padding:26px 16px;";
    none.innerHTML = "Nothing here yet — once you miss questions in a quiz or exam, they'll show up ranked by how often you miss them.";
    main.appendChild(none);
    return;
  }

  rows.slice(0, 60).forEach(r => {
    const meta = idx[r.id];
    if (!meta) return;
    const ans = meta.options[meta.correct];
    let pg = null, ch = meta.hintCh;
    try { const res = searchTextbook(meta.q, ans); if (res && res.page) { pg = res.page; const c = pageToChapter(pg); if (c) ch = c; } } catch (e) {}
    const cm = ch ? CHAP_META[ch] : null;
    const rate = Math.round(r.missed / r.seen * 100);

    const card = document.createElement("div");
    card.style.cssText = "background:var(--card,#fffdf8);border-radius:12px;padding:11px 13px;margin:9px 0;box-shadow:0 1px 4px rgba(0,0,0,.08);border-left:4px solid #C62828;";
    const cite = cm
      ? `📖 <b>Martini Ch ${ch}</b> — ${escapeHtml(cm.name)}${pg ? ` · <b>p. ${pg}</b>` : ""} &nbsp;·&nbsp; ${escapeHtml(cm.region)} &nbsp;·&nbsp; GR: <b>${escapeHtml(cm.gr)}</b>`
      : `📖 Martini${pg ? ` · p. ${pg}` : ""}`;
    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:baseline;">
        <span style="font-size:.72rem;color:#999;font-weight:700;">${escapeHtml(bankOfId(r.id))} · ${escapeHtml(r.id)}</span>
        <span style="font-size:.78rem;color:#C62828;font-weight:800;white-space:nowrap;">missed ${r.missed}/${r.seen} (${rate}%)</span>
      </div>
      <div style="font-size:.92rem;margin:5px 0 3px;line-height:1.35;">${escapeHtml(meta.q)}</div>
      <div style="font-size:.86rem;color:#2E7D32;margin-bottom:6px;">✓ ${escapeHtml(ans)}</div>
      <div style="font-size:.76rem;color:#555;">${cite}</div>`;
    main.appendChild(card);
  });

  const foot = document.createElement("div");
  foot.style.cssText = "text-align:center;color:#aaa;font-size:.75rem;padding:14px 0;";
  foot.textContent = `${rows.length} question${rows.length === 1 ? "" : "s"} missed at least once · page = best-matching Martini passage`;
  main.appendChild(foot);
}

function renderReports(main) {
  let reports = loadReports();
  const banner = document.createElement("div");
  banner.style.cssText = "background:#FDECEA;border:1px solid #f3c6c1;border-radius:12px;padding:12px 14px;margin:4px 0 12px;";
  banner.innerHTML = `<div style="font-weight:800;color:#C0392B;font-size:.95rem;">🚩 This is a quality-flag list — not a study tool.</div>
    <div style="color:#8a5652;font-size:.83rem;margin-top:4px;line-height:1.45;">Only questions you flag with the <b>Report</b> button land here — a wrong answer, a confusing/typo'd question, or a bad option. Use it to check right/wrong-answer accuracy; these get reviewed and fixed in the bank. It does <b>not</b> affect your scores or preparedness.</div>`;
  main.appendChild(banner);

  if (!reports.length) {
    const none = document.createElement("div");
    none.style.cssText = "text-align:center;color:#888;padding:26px 16px;";
    none.textContent = "No flagged questions yet. Tap 🚩 Report on any question to flag a wrong answer or formatting issue.";
    main.appendChild(none);
    return;
  }

  const bar = document.createElement("div");
  bar.style.cssText = "display:flex;gap:8px;margin:4px 0 10px;";
  const copy = document.createElement("button");
  copy.textContent = "📋 Copy all";
  copy.style.cssText = "flex:1;background:#1F3864;color:#fff;border:none;border-radius:10px;padding:9px;font-weight:700;font-size:.85rem;cursor:pointer;";
  copy.onclick = () => {
    const txt = loadReports().map(r => `[${r.reason}] ${r.id || ""} — ${r.q}\n  correct: ${r.correct || ""}\n  note: ${r.note || ""}  (by ${r.by})`).join("\n\n");
    try { navigator.clipboard.writeText(txt); toast("Copied all reports 📋"); } catch (e) { alert(txt); }
  };
  bar.appendChild(copy);
  const clearR = document.createElement("button");
  clearR.textContent = "Clear resolved";
  clearR.style.cssText = "background:#fff;color:#555;border:1px solid #ccc;border-radius:10px;padding:9px 12px;font-size:.85rem;cursor:pointer;";
  clearR.onclick = () => { saveReports(loadReports().filter(r => !r.resolved)); render(); };
  bar.appendChild(clearR);
  main.appendChild(bar);

  const RLBL = { wrong_answer: "❌ Wrong answer", formatting: "✏️ Formatting", other: "❓ Other" };
  reports.forEach((r, i) => {
    const card = document.createElement("div");
    card.style.cssText = `background:${r.resolved ? "#f0f0f0" : "#fffdf8"};border-radius:12px;padding:11px 13px;margin:9px 0;box-shadow:0 1px 4px rgba(0,0,0,.08);border-left:4px solid ${r.resolved ? "#9e9e9e" : "#E67E22"};${r.resolved ? "opacity:.7;" : ""}`;
    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;font-size:.75rem;color:#888;">
        <span style="font-weight:700;color:#C62828;">${RLBL[r.reason] || r.reason}</span>
        <span>${r.by} · ${new Date(r.date).toLocaleDateString()}${r.id ? " · " + escapeHtml(r.id) : ""}</span>
      </div>
      <div style="font-size:.9rem;margin:5px 0 3px;line-height:1.35;">${escapeHtml(r.q || "")}</div>
      ${r.correct ? `<div style="font-size:.83rem;color:#2E7D32;">app answer: ${escapeHtml(r.correct)}</div>` : ""}
      ${r.note ? `<div style="font-size:.82rem;color:#555;margin-top:3px;">📝 ${escapeHtml(r.note)}</div>` : ""}`;
    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;gap:8px;margin-top:8px;";
    const res = document.createElement("button");
    res.textContent = r.resolved ? "↩ Unresolve" : "✓ Resolve";
    res.style.cssText = "border:1px solid #ccc;background:#fff;border-radius:8px;padding:5px 10px;font-size:.78rem;cursor:pointer;";
    res.onclick = () => { const a = loadReports(); a[i].resolved = !a[i].resolved; saveReports(a); render(); };
    const del = document.createElement("button");
    del.textContent = "Delete";
    del.style.cssText = "border:1px solid #eebcbc;color:#C62828;background:#fff;border-radius:8px;padding:5px 10px;font-size:.78rem;cursor:pointer;";
    del.onclick = () => { const a = loadReports(); a.splice(i, 1); saveReports(a); render(); };
    actions.appendChild(res); actions.appendChild(del);
    card.appendChild(actions);
    main.appendChild(card);
  });
}

/* ================== TIMED EXAM MODE ================== */
let examDeck = [], examIndex = 0, examScore = 0;
let sdDeck = [], sdIndex = 0, sdStreak = 0, sdAnswered = false, sdSelected = -1;
let fullExamDeck = [], fullExamIndex = 0, fullExamAnswers = [], fullExamFlags = new Set(), fullExamSecondsLeft = 6000, fullExamTimerInterval = null, fullExamShowOverview = false;
let fullExamModeSet = false;      // closed/open-book prompt answered for this exam launch
let fullExamOvFilter = "all";     // Overview grid filter: "all" | "unanswered" | "flagged"
let fullExamReachedEnd = false;   // once true, the Overview shows the "review & submit" framing
let fullExamChanges = { r2w: 0, w2r: 0, w2w: 0 }; // answer-change transitions this exam (second-guessing signal)
let examAnswered = false, examSelected = -1, examTimedOut = false;
let examTimerHandle = null, examTimeLeft = 30;
let examAnswerLog = [];  // [{q, options, selected, correct, timedOut}, ...]
let examExamIndex = 0;   // 0 = Exam 1, 1 = Exam 2
let EXAM_SECONDS = 30; // overridable per launch
let examTimes = [], examQStart = 0; // per-question answer times (seconds), for the speed/fluency metric
let sessionModeSet = false; // whether the closed/open-book prompt has been answered for the current timed session
let sessionDiagGateSet = false; // whether the "include diagram questions?" prompt has been answered (GR timed only)

function examStopTimer() {
  if (examTimerHandle) { clearInterval(examTimerHandle); examTimerHandle = null; }
  EXAM_SECONDS = 30; // reset to default
}

function examStartTimer() {
  examStopTimer();
  examTimeLeft = EXAM_SECONDS;
  examTimerHandle = setInterval(() => {
    examTimeLeft--;
    // Update the timer bar live without full re-render
    const bar = document.getElementById("examTimerBar");
    const lbl = document.getElementById("examTimerLabel");
    if (bar) bar.style.width = (examTimeLeft / EXAM_SECONDS * 100) + "%";
    if (lbl) lbl.textContent = examTimeLeft + "s";
    if (bar) {
      if (examTimeLeft <= 10) bar.style.background = "#c0392b";
      else if (examTimeLeft <= 20) bar.style.background = "#e67e22";
      else bar.style.background = "var(--accent)";
    }
    if (examTimeLeft <= 0) {
      examStopTimer();
      examTimedOut = true;
      examAnswered = true;
      examSelected = -1;
      examTimes.push(EXAM_SECONDS); // timed out = used the full clock
      recordQuestionStat(examDeck[examIndex], false);
      examAnswerLog.push({ q: examDeck[examIndex], selected: -1, correct: examDeck[examIndex].correct, timedOut: true });
      // Show timed-out state briefly then advance
      const optBtns = document.querySelectorAll(".examOption");
      optBtns.forEach((b, i) => {
        b.disabled = true;
        if (i === examDeck[examIndex].correct) b.classList.add("correct");
      });
      const fb = document.getElementById("examFeedback");
      if (fb) { fb.textContent = "⏰ Time's up! · " + examDeck[examIndex].options[examDeck[examIndex].correct]; fb.style.color = "#c0392b"; }
      showExamNextBtn();
    }
  }, 1000);
}

let examAwaitingNext = false, examAutoAdvHandle = null;
function clearExamAutoAdv() { if (examAutoAdvHandle) { clearTimeout(examAutoAdvHandle); examAutoAdvHandle = null; } }

// After an answer (or timeout): show a Next button + hint, and auto-advance in ~3s.
// The user can advance early with the button or the Spacebar so they can verify / report first.
function showExamNextBtn() {
  examAwaitingNext = true;
  clearExamAutoAdv();
  const fb = document.getElementById("examFeedback");
  const host = fb ? fb.parentNode : document.getElementById("main");
  if (!host || document.getElementById("examNextBtn")) return;
  const wrap = document.createElement("div");
  wrap.id = "examNextWrap";
  wrap.style.cssText = "text-align:center;margin:8px auto 0;max-width:420px;";
  const btn = document.createElement("button");
  btn.id = "examNextBtn";
  btn.textContent = (examIndex >= examDeck.length - 1) ? "See results →" : "Next question →";
  btn.style.cssText = "display:block;width:100%;background:#1F3864;color:#fff;border:none;border-radius:12px;padding:13px;font-size:1rem;font-weight:700;cursor:pointer;";
  btn.onclick = () => { clearExamAutoAdv(); examAdvance(); };
  const hint = document.createElement("div");
  hint.style.cssText = "font-size:0.75rem;color:#aaa;margin-top:6px;";
  hint.textContent = "Press Space or tap Next → to continue · auto-advances in 3s · 🚩 report above if it's wrong";
  // Martini reference + lookup for this GR question
  const q = examDeck[examIndex];
  if (q) {
    try {
      const res = searchTextbook(q.q, q.options[q.correct]);
      if (res && res.page) {
        const ch = pageToChapter(res.page); const cm = ch ? CHAP_META[ch] : null;
        const cite = document.createElement("div");
        cite.style.cssText = "font-size:.8rem;color:#777;margin:2px 0 8px;line-height:1.4;";
        cite.innerHTML = cm
          ? `📖 <b>Martini Ch ${ch}</b> — ${escapeHtml(cm.name)} &nbsp;·&nbsp; <b>p. ${res.page}</b>`
          : `📖 <b>Martini</b> &nbsp;·&nbsp; p. ${res.page}`;
        wrap.appendChild(cite);
      }
    } catch (e) {}
    const look = document.createElement("button");
    look.textContent = "📖 Look it up in Martini";
    look.style.cssText = "display:block;width:100%;margin:0 0 8px;background:#fff;color:#1F3864;border:1.5px solid #cfe0f2;border-radius:12px;padding:11px;font-size:.9rem;font-weight:700;cursor:pointer;";
    look.onclick = () => { clearExamAutoAdv(); showTextbookPanel(q.q, q.options[q.correct]); };
    wrap.appendChild(look);
  }
  wrap.appendChild(btn); wrap.appendChild(hint);
  host.appendChild(wrap);
  examAutoAdvHandle = setTimeout(() => { examAutoAdvHandle = null; examAdvance(); }, 3000);
}

function examAdvance() {
  clearExamAutoAdv();
  examAwaitingNext = false;
  examStopTimer();
  examIndex++;
  examAnswered = false;
  examSelected = -1;
  examTimedOut = false;
  if (examIndex >= examDeck.length) {
    state.route = "examResults";
  } else {
    state.route = "exam";
  }
  render();
}

function examSelectAnswer(origIdx, displayIdx) {
  if (examAnswered) return;
  const elapsedMs = Date.now() - examQStart;
  examTimes.push(Math.min(elapsedMs / 1000, EXAM_SECONDS));
  examStopTimer();
  examAnswered = true;
  examSelected = origIdx; // always store original index
  const q = examDeck[examIndex];
  if (origIdx === q.correct) examScore++;
  recordQuestionStat(q, origIdx === q.correct, elapsedMs);
  examAnswerLog.push({ q, selected: origIdx, correct: q.correct, timedOut: false });
  // Highlight using shuffled display positions
  const sDisplaySelected = (displayIdx !== undefined) ? displayIdx : _eShCache.opts.indexOf(q.options[origIdx]);
  const optBtns = document.querySelectorAll(".examOption");
  optBtns.forEach((b, idx) => {
    b.disabled = true;
    if (idx === _examSCorrect) b.classList.add("correct");
    else if (idx === sDisplaySelected) b.classList.add("incorrect");
  });
  const fb = document.getElementById("examFeedback");
  if (fb) {
    fb.textContent = origIdx === q.correct ? "✓ Correct!" : "✗ " + q.options[q.correct];
    fb.style.color = origIdx === q.correct ? "#27ae60" : "#c0392b";
  }
  showExamNextBtn();  // wait for the user (review / report) instead of auto-advancing
}

function renderExamPicker(main) {
  const sec = DATA.sections[state.sectionKey];
  const sub = document.createElement("div");
  sub.className = "subtitle";
  sub.textContent = "30 s/question · keys 1–5 = A–E (or 1–2 for True/False) · no skipping";
  main.appendChild(sub);

  // Group exams by their `group` field
  const groupMap = {};
  sec.exams.forEach((ex, i) => {
    const g = ex.group || "Other";
    if (!groupMap[g]) groupMap[g] = [];
    groupMap[g].push({ ex, i });
  });

  // Canonical group order — Torso follows syllabus order
  const TORSO_GROUP_ORDER = ["Thorax", "Abdomen", "Pelvis & Perineum", "Systemic", "Practice Exams", "Other"];
  const isTorsoEx = state.sectionKey === "torso";
  const rawGroups = Object.keys(groupMap);
  const groups = isTorsoEx
    ? [...TORSO_GROUP_ORDER.filter(g => rawGroups.includes(g)), ...rawGroups.filter(g => !TORSO_GROUP_ORDER.includes(g))]
    : rawGroups;

  const GROUP_ICONS = {
    "Practice Exams": "📋",
    "Head & Neck": "💀",
    "Spinal": "🦴",
    "Systemic": "🧬",
    "Thorax":          "🫁",
    "Abdomen":         "🧫",
    "Pelvis & Perineum": "🦴",
  };

  groups.forEach(groupName => {
    // Group header
    const hdr = document.createElement("div");
    hdr.style.cssText = "font-weight:700; font-size:0.95rem; color:var(--accent); margin:18px 0 6px 4px; text-transform:uppercase; letter-spacing:.05em;";
    hdr.textContent = (GROUP_ICONS[groupName] || "📚") + "  " + groupName;
    main.appendChild(hdr);

    const list = document.createElement("div");
    list.className = "modeList";
    list.style.gap = "8px";

    groupMap[groupName].forEach(({ ex, i }) => {
      const btn = document.createElement("button");
      btn.className = "modeBtn";
      const entry = progressState.quizzes["exam:" + state.sectionKey + ":" + i];
      const attempts = progressState.examAttempts && progressState.examAttempts["exam:" + state.sectionKey + ":" + i];
      const lastPct = attempts && attempts.length ? attempts[0].pct : null;
      const badge = entry ? `<div class="bestBadge">Best: ${entry.bestScore}% · Last: ${lastPct !== null ? lastPct + "%" : "—"}</div>` : "";
      btn.innerHTML = `<div class="icon">${GROUP_ICONS[groupName] || "⏱️"}</div><div><div class="label">${ex.title}</div><div class="desc">${ex.questions.length} questions</div>${badge}</div>`;
      btn.onclick = () => {
        state.examSource = "tb";
        examExamIndex = i;
        examDeck = dedupeQs(ex.questions.filter(isExamEligible));
        examIndex = 0; examScore = 0;
        examAnswered = false; examSelected = -1; examTimedOut = false;
        examAnswerLog = [];
        state.examTitle = ex.title;
        state.route = "exam";
        render();
      };
      list.appendChild(btn);
    });
    main.appendChild(list);
  });

  // Strip "A. " / "B. " letter prefixes from ClaudeBank options
  const normalizeCBQuestions = (qs) => qs.map(q => ({
    ...q,
    options: q.options.map(o => o.replace(/^[A-E]\.\s*/, ""))
  }));

  // ── Claude Bank topics (merged into exam picker) ──
  if (typeof CLAUDEBANK !== "undefined" && CLAUDEBANK.length) {
    const cbHdr = document.createElement("div");
    cbHdr.style.cssText = "font-weight:700;font-size:0.95rem;color:var(--accent);margin:18px 0 6px 4px;text-transform:uppercase;letter-spacing:.05em;";
    cbHdr.textContent = "🤖  Claude Bank";
    main.appendChild(cbHdr);

    const cbList = document.createElement("div");
    cbList.className = "modeList";
    cbList.style.gap = "8px";

    CLAUDEBANK.forEach((cb, idx) => {
      const btn = document.createElement("button");
      btn.className = "modeBtn";
      btn.innerHTML = `<div class="icon">🤖</div><div><div class="label">${cb.title.replace("ClaudeBank: ","")}</div><div class="desc">${cb.questions.length} questions</div></div>`;
      btn.onclick = () => {
        state.examSource = "tb";
        examDeck = normalizeCBQuestions(cb.questions);
        examIndex = 0; examScore = 0;
        examAnswered = false; examSelected = -1; examTimedOut = false;
        examAnswerLog = [];
        state.examTitle = cb.title.replace("ClaudeBank: ","");
        state.route = "exam";
        render();
      };
      cbList.appendChild(btn);
    });
    main.appendChild(cbList);
  }
}

function renderModeGate(main) {
  const wrap = document.createElement("div");
  wrap.style.cssText = "max-width:460px;margin:40px auto 0;text-align:center;padding:0 16px;";
  wrap.innerHTML = `
    <div style="font-size:2rem;margin-bottom:6px;">🎯</div>
    <div style="font-weight:800;font-size:1.15rem;color:var(--navy,#1F3864);margin-bottom:4px;">Before you start…</div>
    <div style="color:#666;font-size:.92rem;margin-bottom:22px;">Are you using your notes for this session? This keeps your <b>true (closed-book)</b> score separate from your <b>with-notes</b> score.</div>`;
  const mk = (label, sub, mode, bg) => {
    const b = document.createElement("button");
    b.className = "primaryBtn";
    b.style.cssText = `display:block;width:100%;margin:10px 0;background:${bg};color:#fff;border:none;border-radius:12px;padding:14px;font-size:1rem;font-weight:700;cursor:pointer;`;
    b.innerHTML = `${label}<div style="font-weight:400;font-size:.78rem;opacity:.9;margin-top:2px;">${sub}</div>`;
    b.onclick = () => { setStudyMode(mode); sessionModeSet = true; render(); };
    return b;
  };
  wrap.appendChild(mk("🧠 Closed-book", "No notes — my true recall", "closed", "#1F3864"));
  wrap.appendChild(mk("📖 Open-book", "Using my notes", "open", "#2E74B5"));
  main.appendChild(wrap);
}

function renderDiagramGate(main) {
  const nDiag = examDeck.filter(isDiagramQ).length;
  const wrap = document.createElement("div");
  wrap.style.cssText = "max-width:460px;margin:40px auto 0;text-align:center;padding:0 16px;";
  wrap.innerHTML = `
    <div style="font-size:2rem;margin-bottom:6px;">🖼️</div>
    <div style="font-weight:800;font-size:1.15rem;color:var(--navy,#1F3864);margin-bottom:4px;">Include diagram questions?</div>
    <div style="color:#666;font-size:.92rem;margin-bottom:22px;">This deck has <b>${nDiag}</b> image/labeling question${nDiag === 1 ? "" : "s"}. You'll have the diagrams <b>printed</b> during the real exam, so you may not need to flash-test them here.</div>`;
  const mk = (label, sub, keep, bg) => {
    const b = document.createElement("button");
    b.className = "primaryBtn";
    b.style.cssText = `display:block;width:100%;margin:10px 0;background:${bg};color:#fff;border:none;border-radius:12px;padding:14px;font-size:1rem;font-weight:700;cursor:pointer;`;
    b.innerHTML = `${label}<div style="font-weight:400;font-size:.78rem;opacity:.9;margin-top:2px;">${sub}</div>`;
    b.onclick = () => {
      if (!keep) {
        const filtered = examDeck.filter(q => !isDiagramQ(q));
        if (filtered.length) examDeck = filtered; // guard: never leave an empty deck
      }
      sessionDiagGateSet = true;
      examIndex = 0; examScore = 0; examAnswerLog = []; examTimes = [];
      render();
    };
    return b;
  };
  wrap.appendChild(mk("🚫 Skip diagrams", "Text/recall questions only", false, "#1F3864"));
  wrap.appendChild(mk("🖼️ Include diagrams", "Flash-test the images too", true, "#2E74B5"));
  main.appendChild(wrap);
}

function renderExam(main) {
  if (!examDeck.length) { state.route = "examPicker"; render(); return; }
  if (examIndex === 0 && !sessionModeSet) { renderModeGate(main); return; }
  if (examIndex === 0 && state.examSource === "gr" && !sessionDiagGateSet && examDeck.some(isDiagramQ)) { renderDiagramGate(main); return; }

  // Timer bar row
  const timerWrap = document.createElement("div");
  timerWrap.style.cssText = "padding: 8px 16px 0; display:flex; align-items:center; gap:10px;";
  const timerLbl = document.createElement("span");
  timerLbl.id = "examTimerLabel";
  timerLbl.style.cssText = "font-size:0.9rem; font-weight:700; color:var(--accent); min-width:28px; text-align:right;";
  timerLbl.textContent = EXAM_SECONDS + "s";
  const timerTrack = document.createElement("div");
  timerTrack.style.cssText = "flex:1; height:6px; background:#e0e0e0; border-radius:3px; overflow:hidden;";
  const timerBar = document.createElement("div");
  timerBar.id = "examTimerBar";
  timerBar.style.cssText = `height:100%; width:100%; background:var(--accent); border-radius:3px; transition:background 0.4s;`;
  timerTrack.appendChild(timerBar);
  const qCounter = document.createElement("span");
  qCounter.style.cssText = "font-size:0.85rem; color:#888; min-width:60px;";
  qCounter.textContent = `${examIndex + 1} / ${examDeck.length}`;
  timerWrap.appendChild(timerLbl);
  timerWrap.appendChild(timerTrack);
  timerWrap.appendChild(qCounter);
  main.appendChild(timerWrap);

  // Progress bar (thin, no label)
  const progWrap = document.createElement("div");
  progWrap.className = "progressWrap";
  const prog = document.createElement("div");
  prog.className = "progressBar";
  prog.style.width = `${(examIndex / examDeck.length) * 100}%`;
  progWrap.appendChild(prog);
  main.appendChild(progWrap);

  const q = examDeck[examIndex];
  if (examIndex === 0) examTimes = [];   // fresh run
  examQStart = Date.now();               // start the answer-speed clock for this question
  const stem = document.createElement("div");
  stem.className = "qStem";
  stem.textContent = `${examIndex + 1}. ${q.q}`;
  main.appendChild(stem);

  // Diagram/labeling questions carry an image — show it so they're answerable
  if (q.images && q.images.length) {
    const imgWrap = document.createElement("div");
    imgWrap.className = "qImageWrap";
    q.images.forEach((img) => {
      const imageEl = document.createElement("img");
      imageEl.className = "qImage";
      imageEl.src = "images/" + img;
      imageEl.loading = "lazy";
      imageEl.onclick = () => imageEl.classList.toggle("qImageZoomed");
      imgWrap.appendChild(imageEl);
    });
    main.appendChild(imgWrap);
  }

  // Keyboard hint
  const hint = document.createElement("div");
  hint.style.cssText = "font-size:0.75rem; color:#aaa; text-align:center; margin:-4px 0 6px;";
  hint.textContent = q.tf ? "Press 1 = True · 2 = False" : `Press 1–${Math.min(q.options.length, 5)} to select (A–E)`;
  main.appendChild(hint);

  // Shuffle options — cached per question index
  if (_eShCache.key !== examIndex) { _eShCache.key = examIndex; _eShCache.opts = shuffle([...q.options]); }
  const _eSOpts = _eShCache.opts;
  _examSCorrect = _eSOpts.indexOf(q.options[q.correct]); // store for DOM highlight

  const optsWrap = document.createElement("div");
  optsWrap.className = "options";
  const labels = ["A", "B", "C", "D", "E"];
  _eSOpts.forEach((opt, i) => {
    const b = document.createElement("button");
    b.className = "option examOption";
    b.style.cssText = "text-align:left; display:flex; gap:10px; align-items:flex-start;";
    b.innerHTML = `<span style="font-weight:700;min-width:18px;color:var(--accent)">${labels[i]}</span><span>${opt}</span>`;
    // Pass original option index to examSelectAnswer
    b.onclick = () => examSelectAnswer(q.options.indexOf(_eSOpts[i]), i);
    optsWrap.appendChild(b);
  });
  main.appendChild(optsWrap);

  // Feedback line (filled in by examSelectAnswer / timer)
  const fb = document.createElement("div");
  fb.id = "examFeedback";
  fb.style.cssText = "min-height:28px; text-align:center; font-weight:600; font-size:1rem; padding:8px 0;";
  main.appendChild(fb);

  const rprow = document.createElement("div");
  rprow.style.cssText = "text-align:center;margin-top:2px;";
  rprow.appendChild(reportBtn(q));
  main.appendChild(rprow);

  // Start the countdown (only if not already answered — guard against re-renders)
  if (!examAnswered) examStartTimer();
}

function renderExamResults(main) {
  examStopTimer();
  sessionModeSet = false; // next timed session will ask closed/open-book again
  sessionDiagGateSet = false; // next GR timed session will re-ask about diagram questions
  const total = examDeck.length;
  const pct = Math.round((examScore / total) * 100);
  const timedOuts = examAnswerLog.filter(e => e.timedOut).length;
  const wrong = examAnswerLog.filter(e => !e.timedOut && e.selected !== e.correct);

  // Record best score (use distinct key per GR subtopic / exam)
  const key = state.examSource === "gr"
    ? "grTimed:" + state.sectionKey + (state.examTitle ? ":" + state.examTitle : "")
    : "exam:" + state.sectionKey + ":" + examExamIndex;
  const avgSec = examTimes.length ? examTimes.reduce((a, b) => a + b, 0) / examTimes.length : undefined;
  recordQuizResult(key, examScore, total, avgSec);

  // Save full attempt to history (unified log)
  const missedForLog = examAnswerLog
    .filter(e => e.timedOut || e.selected !== e.correct)
    .map(e => ({
      q: e.q.q,
      correct: e.q.options[e.q.correct],
      yours: e.timedOut ? "⏰ Timed out" : (e.selected >= 0 ? e.q.options[e.selected] : "—")
    }));
  recordAttempt(key, {
    title: state.examTitle || (state.examSource === "gr" ? "Timed Guided-Reading" : "Timed Practice Exam"),
    kind: state.examSource === "gr" ? "gr" : "timed",
    mode: getStudyMode(), score: examScore, total, pct, missed: missedForLog
  });
  recordMissedQs(examAnswerLog);

  const wrap = document.createElement("div");
  wrap.className = "resultWrap";
  const grade = pct >= 90 ? "🏆" : pct >= 70 ? "✅" : pct >= 50 ? "📚" : "💪";
  wrap.innerHTML = `
    <div class="resultLabel">${grade} Exam complete</div>
    <div class="resultScore">${examScore} / ${total}</div>
    <div class="resultPct">${pct}%</div>
    ${timedOuts ? `<div style="color:#e67e22;font-size:.9rem;margin-bottom:8px;">⏰ ${timedOuts} question${timedOuts>1?'s':''} timed out</div>` : ""}
  `;

  // Missed questions review
  const missed = examAnswerLog.filter(e => e.timedOut || e.selected !== e.correct);
  if (missed.length) {
    const revTitle = document.createElement("div");
    revTitle.style.cssText = "font-weight:700; font-size:1rem; margin:16px 0 8px; color:var(--text);";
    revTitle.textContent = `Review — ${missed.length} missed:`;
    wrap.appendChild(revTitle);
    missed.forEach((entry, idx) => {
      const item = document.createElement("div");
      item.style.cssText = "background:#fff8f0; border:1px solid #f0c070; border-radius:8px; padding:12px 14px; margin-bottom:10px; text-align:left;";
      const yourAns = entry.timedOut ? "⏰ Timed out" : entry.q.options[entry.selected];
      item.innerHTML = `
        <div style="font-weight:600;margin-bottom:6px;color:var(--text);">${entry.q.q}</div>
        <div style="color:#c0392b;font-size:.9rem;">Your answer: ${yourAns}</div>
        <div style="color:#27ae60;font-size:.9rem;font-weight:600;">Correct: ${entry.q.options[entry.correct]}</div>
      `;
      wrap.appendChild(item);
    });
  } else {
    const perfect = document.createElement("div");
    perfect.style.cssText = "color:#27ae60; font-weight:600; margin-top:8px;";
    perfect.textContent = "Perfect score — no missed questions!";
    wrap.appendChild(perfect);
  }

  const retakeBtn = document.createElement("button");
  retakeBtn.className = "nextBtn";
  retakeBtn.style.marginTop = "20px";
  retakeBtn.textContent = "Retake this exam";
  retakeBtn.onclick = () => {
    if (state.examSource === "gr") {
      examDeck = shuffle([...filterQuiz(getSection(state.sectionKey).quiz, "content")]);
    } else if (state.examSource === "custom") {
      /* custom pool already stored in examDeck at launch */
    } else {
      examDeck = DATA.sections[state.sectionKey].exams[examExamIndex].questions;
    }
    examIndex = 0; examScore = 0;
    examAnswered = false; examSelected = -1; examTimedOut = false;
    examAnswerLog = [];
    state.route = "exam";
    render();
  };
  wrap.appendChild(retakeBtn);

  const backBtn = document.createElement("button");
  backBtn.className = "secondaryBtn";
  backBtn.style.marginTop = "10px";
  backBtn.textContent = (state.examSource === "gr" || state.examSource === "custom") ? "Back" : "Choose a different exam";
  backBtn.onclick = () => {
    if (state.examSource === "gr") { state.examSource = null; state.route = "grMenu"; }
    else if (state.examSource === "custom") { state.examSource = null; state.route = "customBuilder"; }
    else { state.route = "examPicker"; }
    render();
  };
  wrap.appendChild(backBtn);

  // Past attempts (skip index 0 = current attempt just saved)
  const history = (progressState.examAttempts && progressState.examAttempts[key]) || [];
  const pastAttempts = history.slice(1);
  if (pastAttempts.length) {
    const histHdr = document.createElement("div");
    histHdr.style.cssText = "font-weight:700;font-size:1rem;margin:24px 0 10px;color:var(--text);border-top:1px solid #ddd;padding-top:16px;";
    histHdr.textContent = `📋 Past Attempts (${pastAttempts.length})`;
    wrap.appendChild(histHdr);

    pastAttempts.forEach((attempt, i) => {
      const card = document.createElement("div");
      card.style.cssText = "border:1px solid #ddd;border-radius:10px;margin-bottom:10px;overflow:hidden;";

      const grade = attempt.pct >= 90 ? "🏆" : attempt.pct >= 70 ? "✅" : attempt.pct >= 50 ? "📚" : "💪";
      const hdr = document.createElement("div");
      hdr.style.cssText = "display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:#f7f7f5;cursor:pointer;";
      hdr.innerHTML = `<span style="font-weight:600;">${grade} ${attempt.date}</span><span style="color:var(--accent);font-weight:700;">${attempt.score}/${attempt.total} — ${attempt.pct}%</span>`;

      const body = document.createElement("div");
      body.style.cssText = "display:none;padding:12px 14px;";

      if (attempt.missed.length === 0) {
        body.innerHTML = `<div style="color:#27ae60;font-weight:600;">Perfect score!</div>`;
      } else {
        attempt.missed.forEach(m => {
          const row = document.createElement("div");
          row.style.cssText = "background:#fff8f0;border:1px solid #f0c070;border-radius:6px;padding:10px 12px;margin-bottom:8px;font-size:.88rem;";
          row.innerHTML = `
            <div style="font-weight:600;margin-bottom:4px;">${m.q}</div>
            <div style="color:#c0392b;">Your answer: ${m.yours}</div>
            <div style="color:#27ae60;font-weight:600;">Correct: ${m.correct}</div>
          `;
          body.appendChild(row);
        });
      }

      hdr.onclick = () => { body.style.display = body.style.display === 'none' ? 'block' : 'none'; };
      card.appendChild(hdr);
      card.appendChild(body);
      wrap.appendChild(card);
    });
  }

  main.appendChild(wrap);
}

/* ---- Global keyboard handler for Timed Exam ---- */
document.addEventListener("keydown", (e) => {
  if (state.route !== "exam") return;
  if (examAnswered) {
    // Space / Enter advances to the next question once an answer is showing
    if (examAwaitingNext && (e.key === " " || e.code === "Space" || e.key === "Enter")) {
      e.preventDefault();
      clearExamAutoAdv();
      examAdvance();
    }
    return;
  }
  const num = parseInt(e.key);
  if (isNaN(num) || num < 1) return;
  const displayIdx = num - 1;
  const q = examDeck[examIndex];
  if (!q || displayIdx >= q.options.length) return;
  // Convert shuffled display index to original option index
  const origIdx = (_eShCache.opts.length && _eShCache.key === examIndex)
    ? q.options.indexOf(_eShCache.opts[displayIdx])
    : displayIdx;
  examSelectAnswer(origIdx, displayIdx);
});

// ═══════════════════════════════════════════════════════
//  SIMULATION MODE  (70-min total, free navigation)
// ═══════════════════════════════════════════════════════
let simDeck = [], simIndex = 0, simAnswers = [];
let simTimerHandle = null, simTimeLeft = 70 * 60;
const SIM_TOTAL_SECONDS = 70 * 60;

function simStopTimer() {
  if (simTimerHandle) { clearInterval(simTimerHandle); simTimerHandle = null; }
}

function simFormatTime(s) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m + ":" + String(sec).padStart(2, "0");
}

function simUpdateTimerDisplay() {
  const lbl = document.getElementById("simTimerLabel");
  const bar = document.getElementById("simTimerBar");
  if (lbl) {
    lbl.textContent = simFormatTime(simTimeLeft);
    lbl.style.color = simTimeLeft <= 300 ? "#c0392b" : simTimeLeft <= 600 ? "#e67e22" : "var(--accent)";
  }
  if (bar) {
    bar.style.width = (simTimeLeft / SIM_TOTAL_SECONDS * 100) + "%";
    bar.style.background = simTimeLeft <= 300 ? "#c0392b" : simTimeLeft <= 600 ? "#e67e22" : "var(--accent)";
  }
}

function simStartTimer() {
  simStopTimer();
  simTimerHandle = setInterval(() => {
    simTimeLeft--;
    simUpdateTimerDisplay();
    if (simTimeLeft <= 0) {
      simStopTimer();
      simSubmit(true); // auto-submit when time's up
    }
  }, 1000);
}

function simSubmit(forced) {
  simStopTimer();
  const unanswered = simAnswers.filter(a => a === -1).length;
  if (!forced && unanswered > 0) {
    state.route = "simReview";
    render();
    return;
  }
  // Build examAnswerLog so renderExamResults can display results
  examDeck = simDeck;
  examAnswerLog = [];
  examScore = 0;
  simDeck.forEach((q, i) => {
    const selected = simAnswers[i] ?? -1;
    if (selected === q.correct) examScore++;
    if (selected !== -1) recordQuestionStat(q, selected === q.correct); // per-question stats for answered items
    examAnswerLog.push({ q, selected, correct: q.correct, timedOut: forced && selected === -1 });
  });
  // Save under "sim:" key so it doesn't mix with timed exam history
  const key = "sim:" + state.sectionKey + ":" + examExamIndex;
  recordQuizResult(key, examScore, simDeck.length);
  const total = simDeck.length;
  const pct = Math.round(examScore / total * 100);
  const missedForLog = examAnswerLog
    .filter(e => e.timedOut || e.selected !== e.correct)
    .map(e => ({
      q: e.q.q,
      correct: e.q.options[e.q.correct],
      yours: e.timedOut ? "⏰ Time's up" : (e.selected >= 0 ? e.q.options[e.selected] : "—")
    }));
  recordAttempt(key, {
    title: state.examTitle || "Simulation", kind: "sim",
    mode: getStudyMode(), score: examScore, total, pct, missed: missedForLog
  });
  recordMissedQs(examAnswerLog);
  state.route = "examResults";
  render();
}

function renderSimPicker(main) {
  const sec = DATA.sections[state.sectionKey];
  const sub = document.createElement("div");
  sub.className = "subtitle";
  sub.textContent = "70-min total · skip & return · review unanswered before submit";
  main.appendChild(sub);

  const groups = [];
  const groupMap = {};
  sec.exams.forEach((ex, i) => {
    const g = ex.group || "Other";
    if (!groupMap[g]) { groupMap[g] = []; groups.push(g); }
    groupMap[g].push({ ex, i });
  });

  const GROUP_ICONS = { "Practice Exams": "📋", "Head & Neck": "💀", "Spinal": "🦴", "Systemic": "🧠" };

  groups.forEach(groupName => {
    const hdr = document.createElement("div");
    hdr.style.cssText = "font-weight:700;font-size:.95rem;color:var(--accent);margin:18px 0 6px 4px;text-transform:uppercase;letter-spacing:.05em;";
    hdr.textContent = (GROUP_ICONS[groupName] || "📚") + "  " + groupName;
    main.appendChild(hdr);

    const list = document.createElement("div");
    list.className = "modeList";
    list.style.gap = "8px";

    groupMap[groupName].forEach(({ ex, i }) => {
      const btn = document.createElement("button");
      btn.className = "modeBtn";
      const key = "sim:" + state.sectionKey + ":" + i;
      const entry = progressState.quizzes && progressState.quizzes[key];
      const attempts = progressState.examAttempts && progressState.examAttempts[key];
      const lastPct = attempts && attempts.length ? attempts[0].pct : null;
      const badge = entry ? `<div class="bestBadge">Best: ${entry.bestScore}% · Last: ${lastPct !== null ? lastPct + "%" : "—"}</div>` : "";
      btn.innerHTML = `<div class="icon">${GROUP_ICONS[groupName] || "🎓"}</div><div><div class="label">${ex.title}</div><div class="desc">${ex.questions.length} questions · 70 min</div>${badge}</div>`;
      btn.onclick = () => {
        examExamIndex = i;
        simDeck = dedupeQs(ex.questions.filter(isExamEligible));
        simIndex = 0;
        simAnswers = new Array(simDeck.length).fill(-1);
        simTimeLeft = SIM_TOTAL_SECONDS;
        simStopTimer();
        state.examTitle = ex.title + " (Sim)";
        state.route = "simExam";
        render();
      };
      list.appendChild(btn);
    });
    main.appendChild(list);
  });
}

function renderSimExam(main) {
  if (!simDeck.length) { state.route = "simPicker"; render(); return; }
  const q = simDeck[simIndex];
  const answeredCount = simAnswers.filter(a => a !== -1).length;
  const unanswered = simDeck.length - answeredCount;
  const labels = ["A", "B", "C", "D", "E"];

  // ── Timer bar ──────────────────────────────────────────────
  const topBar = document.createElement("div");
  topBar.style.cssText = "display:flex;align-items:center;gap:10px;padding:8px 16px 2px;";

  const timerLbl = document.createElement("span");
  timerLbl.id = "simTimerLabel";
  timerLbl.style.cssText = "font-size:1rem;font-weight:700;min-width:52px;color:var(--accent);";
  timerLbl.textContent = simFormatTime(simTimeLeft);

  const timerTrack = document.createElement("div");
  timerTrack.style.cssText = "flex:1;height:5px;background:#e0e0e0;border-radius:3px;overflow:hidden;";
  const timerBar = document.createElement("div");
  timerBar.id = "simTimerBar";
  const pctLeft = simTimeLeft / SIM_TOTAL_SECONDS * 100;
  const barColor = simTimeLeft <= 300 ? "#c0392b" : simTimeLeft <= 600 ? "#e67e22" : "var(--accent)";
  timerBar.style.cssText = `height:100%;width:${pctLeft}%;background:${barColor};border-radius:3px;transition:none;`;
  timerTrack.appendChild(timerBar);

  const statusLbl = document.createElement("span");
  statusLbl.style.cssText = "font-size:.82rem;color:#888;min-width:72px;text-align:right;";
  statusLbl.textContent = `${answeredCount}/${simDeck.length} done`;

  topBar.append(timerLbl, timerTrack, statusLbl);
  main.appendChild(topBar);

  // ── Question palette ───────────────────────────────────────
  const palette = document.createElement("div");
  palette.style.cssText = "display:flex;flex-wrap:wrap;gap:4px;padding:6px 16px 4px;max-height:88px;overflow-y:auto;";
  simDeck.forEach((_, i) => {
    const b = document.createElement("button");
    const done = simAnswers[i] !== -1;
    const cur = i === simIndex;
    b.style.cssText = `width:28px;height:28px;border-radius:5px;font-size:.72rem;font-weight:700;cursor:pointer;border:2px solid;line-height:1;
      ${cur  ? "background:var(--accent);color:#fff;border-color:var(--accent);"
             : done ? "background:#d4edda;color:#1a5e30;border-color:#82c99a;"
                    : "background:#f0f0f0;color:#888;border-color:#ccc;"}`;
    b.textContent = i + 1;
    b.onclick = () => { simIndex = i; render(); };
    palette.appendChild(b);
  });
  main.appendChild(palette);

  // Progress fill (answered)
  const progWrap = document.createElement("div");
  progWrap.className = "progressWrap";
  const prog = document.createElement("div");
  prog.className = "progressBar";
  prog.style.width = `${(answeredCount / simDeck.length) * 100}%`;
  progWrap.appendChild(prog);
  main.appendChild(progWrap);

  // ── Stem ──────────────────────────────────────────────────
  const stem = document.createElement("div");
  stem.className = "qStem";
  stem.textContent = `${simIndex + 1}. ${q.q.replace(/\[GR\]/g, '').trim()}`;
  main.appendChild(stem);

  // ── Options ───────────────────────────────────────────────
  const optsWrap = document.createElement("div");
  optsWrap.className = "options";
  q.options.forEach((opt, i) => {
    const b = document.createElement("button");
    b.className = "option";
    const sel = simAnswers[simIndex] === i;
    if (sel) { b.classList.add("correct"); } // reuse green style
    b.style.cssText = `text-align:left;display:flex;gap:10px;align-items:flex-start;
      ${sel ? "background:#e8f5e9;border-color:#27ae60;" : ""}`;
    b.innerHTML = `<span style="font-weight:700;min-width:18px;color:${sel ? "#27ae60" : "var(--accent)"}">${labels[i]}</span><span>${opt}</span>`;
    b.onclick = () => { simAnswers[simIndex] = i; render(); };
    optsWrap.appendChild(b);
  });
  main.appendChild(optsWrap);

  const simRepRow = document.createElement("div");
  simRepRow.style.cssText = "text-align:right;padding:2px 16px 0;";
  simRepRow.appendChild(reportBtn(q));
  main.appendChild(simRepRow);

  // ── Nav row ───────────────────────────────────────────────
  const navRow = document.createElement("div");
  navRow.style.cssText = "display:flex;gap:8px;padding:12px 16px 8px;align-items:center;";

  const prevBtn = document.createElement("button");
  prevBtn.className = "secondaryBtn";
  prevBtn.style.cssText = "flex:0 0 auto;min-width:70px;";
  prevBtn.textContent = "← Prev";
  prevBtn.disabled = simIndex === 0;
  prevBtn.onclick = () => { simIndex = Math.max(0, simIndex - 1); render(); };

  const nextSkipBtn = document.createElement("button");
  nextSkipBtn.className = "secondaryBtn";
  nextSkipBtn.style.cssText = "flex:0 0 auto;min-width:70px;";
  const isLast = simIndex === simDeck.length - 1;
  nextSkipBtn.textContent = simAnswers[simIndex] !== -1 ? (isLast ? "—" : "Next →") : "Skip →";
  nextSkipBtn.disabled = isLast && simAnswers[simIndex] !== -1;
  nextSkipBtn.onclick = () => {
    // Advance to next, or wrap to first unanswered
    if (simIndex < simDeck.length - 1) {
      simIndex++;
    } else {
      const firstUnanswered = simAnswers.indexOf(-1);
      if (firstUnanswered !== -1) simIndex = firstUnanswered;
    }
    render();
  };

  const submitBtn = document.createElement("button");
  submitBtn.className = "nextBtn";
  submitBtn.style.cssText = "flex:1;font-size:.9rem;";
  submitBtn.textContent = unanswered > 0 ? `Submit (${unanswered} left)` : "✓ Submit Exam";
  submitBtn.onclick = () => simSubmit(false);

  navRow.append(prevBtn, nextSkipBtn, submitBtn);
  main.appendChild(navRow);

  // Start timer (only if not already running)
  if (!simTimerHandle) simStartTimer();
}

function renderSimReview(main) {
  // Resume timer (it keeps running during review)
  if (simTimeLeft > 0 && !simTimerHandle) simStartTimer();

  const unansweredIdxs = simAnswers.reduce((acc, a, i) => { if (a === -1) acc.push(i); return acc; }, []);

  const timerRow = document.createElement("div");
  timerRow.style.cssText = "text-align:center;font-size:1rem;font-weight:700;color:var(--accent);margin:12px 0 4px;";
  timerRow.textContent = "⏱ " + simFormatTime(simTimeLeft) + " remaining";
  main.appendChild(timerRow);

  const title = document.createElement("div");
  title.style.cssText = "font-size:1.05rem;font-weight:700;margin:12px 0 6px;color:var(--text);";
  title.textContent = `⚠️ ${unansweredIdxs.length} unanswered question${unansweredIdxs.length !== 1 ? "s" : ""}`;
  main.appendChild(title);

  const sub = document.createElement("div");
  sub.style.cssText = "color:#888;font-size:.88rem;margin-bottom:14px;";
  sub.textContent = "Tap a question to go answer it, or submit with blanks left.";
  main.appendChild(sub);

  const list = document.createElement("div");
  list.style.cssText = "display:flex;flex-direction:column;gap:7px;margin-bottom:18px;";
  unansweredIdxs.forEach(idx => {
    const btn = document.createElement("button");
    btn.className = "modeBtn";
    btn.style.cssText = "text-align:left;padding:10px 14px;display:flex;gap:10px;align-items:center;";
    const qText = simDeck[idx].q.replace(/\[GR\]/g,'').trim();
    btn.innerHTML = `<span style="font-weight:700;color:var(--accent);min-width:36px;flex-shrink:0;">Q${idx + 1}</span><span style="color:var(--text);font-size:.9rem;">${qText.length > 90 ? qText.slice(0,90)+"…" : qText}</span>`;
    btn.onclick = () => { simIndex = idx; state.route = "simExam"; render(); };
    list.appendChild(btn);
  });
  main.appendChild(list);

  const submitBtn = document.createElement("button");
  submitBtn.className = "nextBtn";
  submitBtn.textContent = `Submit anyway — ${unansweredIdxs.length} blank`;
  submitBtn.onclick = () => simSubmit(true);
  main.appendChild(submitBtn);

  const backBtn = document.createElement("button");
  backBtn.className = "secondaryBtn";
  backBtn.style.marginTop = "10px";
  backBtn.textContent = "← Back to exam";
  backBtn.onclick = () => { state.route = "simExam"; render(); };
  main.appendChild(backBtn);
}

// ── Keyboard nav for Simulation mode ─────────────────────────
document.addEventListener("keydown", (e) => {
  if (state.route !== "simExam") return;
  const num = parseInt(e.key);
  if (isNaN(num) || num < 1) return;
  const q = simDeck[simIndex];
  if (!q || num - 1 >= q.options.length) return;
  simAnswers[simIndex] = num - 1;
  // Auto-advance to next unanswered on key press
  if (simIndex < simDeck.length - 1) simIndex++;
  render();
});

/* ================== MISSED QUESTIONS REVIEW ================== */
function renderMissedReview(main) {
  // All-done state
  if (missedDeck.length === 0) {
    const wrap = document.createElement("div");
    wrap.style.cssText = "text-align:center;padding:48px 20px;";
    wrap.innerHTML = `
      <div style="font-size:3.5rem;margin-bottom:12px;">🎉</div>
      <div style="font-size:1.4rem;font-weight:700;margin-bottom:8px;color:var(--text);">All cleared!</div>
      <div style="color:#888;margin-bottom:28px;">No missed questions remaining. You nailed them all.</div>
    `;
    const backBtn = document.createElement("button");
    backBtn.className = "secondaryBtn";
    backBtn.textContent = "Back to modes";
    backBtn.onclick = () => { state.route = "modes"; render(); };
    wrap.appendChild(backBtn);
    main.appendChild(wrap);
    return;
  }

  const qi = missedIndex % missedDeck.length;
  const q = missedDeck[qi];
  const remaining = missedDeck.length;

  // Counter bar
  const counter = document.createElement("div");
  counter.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;font-size:.88rem;color:#888;";
  counter.innerHTML = `<span>🔁 Missed pool</span><span style="font-weight:700;color:var(--accent);">${remaining} remaining</span>`;
  main.appendChild(counter);

  // Progress bar (visual)
  const totalEver = (loadMissedQs().length + (missedDeck.length < (window._missedStartCount||missedDeck.length) ? (window._missedStartCount||missedDeck.length) - missedDeck.length : 0));
  const cleared = (window._missedStartCount || missedDeck.length) - remaining;
  const pct = window._missedStartCount ? Math.round(cleared / window._missedStartCount * 100) : 0;
  const pgBar = document.createElement("div");
  pgBar.style.cssText = "height:6px;background:#eee;border-radius:3px;margin-bottom:18px;overflow:hidden;";
  pgBar.innerHTML = `<div style="height:100%;width:${pct}%;background:var(--accent);border-radius:3px;transition:width .3s;"></div>`;
  main.appendChild(pgBar);

  // Question stem
  const stem = document.createElement("div");
  stem.style.cssText = "font-size:1.05rem;font-weight:600;color:var(--text);margin-bottom:20px;line-height:1.55;";
  stem.textContent = q.q;
  main.appendChild(stem);

  // Feedback placeholder
  const fb = document.createElement("div");
  fb.id = "missedFb";
  fb.style.cssText = "min-height:24px;font-size:.95rem;font-weight:600;margin-bottom:10px;text-align:center;";
  main.appendChild(fb);

  // Options
  const opts = q.tf ? ["True", "False"] : (q.options || []);
  opts.forEach((opt, i) => {
    const btn = document.createElement("button");
    btn.className = "examOption";
    btn.textContent = opt;
    btn.onclick = () => {
      if (missedAnswered) return;
      missedAnswered = true;
      const isCorrect = (i === q.correct);
      btn.classList.add(isCorrect ? "correct" : "wrong");
      document.querySelectorAll(".examOption").forEach((b, j) => {
        b.disabled = true;
        if (j === q.correct) b.classList.add("correct");
      });
      fb.textContent = isCorrect ? "✅ Correct! Removed from missed list." : "❌ Wrong — keeping it in the pool.";
      fb.style.color = isCorrect ? "#27ae60" : "#c0392b";
      setTimeout(() => {
        if (isCorrect) {
          // Remove from deck and from storage
          const key = q.q.slice(0, 80);
          missedDeck.splice(qi, 1);
          const pool = loadMissedQs().filter(m => m.q.slice(0, 80) !== key);
          saveMissedQs(pool);
          if (missedIndex >= missedDeck.length && missedIndex > 0) missedIndex = 0;
        } else {
          // Shuffle to end
          missedDeck.splice(qi, 1);
          missedDeck.push(q);
          if (missedIndex >= missedDeck.length) missedIndex = 0;
        }
        missedAnswered = false; missedSelected = -1;
        render();
      }, 900);
    };
    main.appendChild(btn);
  });
}

initApp();

/* ═══════════════════════════════════════════════════════════
   NEW HIERARCHICAL NAVIGATION — added 2026-07
   ═══════════════════════════════════════════════════════════ */

/* ─── SECTION MENU (replaces old renderModes) ─── */
function renderSectionMenu(main) {
  const sec = getSection(state.sectionKey);
  if (!sec) { state.route = "home"; render(); return; }

  const isTorso = state.sectionKey === "torso";
  const isAxial = state.sectionKey === "axial";

  // Items per section — adjust for whatever the section actually has
  const items = [
    // Preparedness pinned to the TOP of the menu
    {
      id: "preparedness",
      icon: "🎯",
      title: "Preparedness Score",
      sub: "How exam-ready you are, by system",
      condition: isTorso,
      bg: "linear-gradient(135deg,#5B21B6 0%,#4338CA 100%)",  // violet (swapped in from Practice Tests)
      shadow: "rgba(67,56,202,.35)",
    },
    // Practice Tests — pulled ABOVE Guided Readings, with space above (its own teal)
    {
      id: "examMenu",
      icon: "📝",
      title: "Practice Tests",
      sub: "Timed exams, simulations, and missed-Q review",
      condition: true,
      bg: "linear-gradient(135deg,#0F766E 0%,#115E59 100%)",  // teal
      shadow: "rgba(15,118,110,.35)",
      gapBefore: true,
    },
    {
      id: "grMenu",
      icon: "📖",
      title: "Guided Readings",
      sub: isTorso ? "Timed GR questions by section" : "Timed GR question sets",
      condition: true,
      gapBefore: true,
    },
    {
      id: "claudeMenu",
      icon: "🤖",
      title: "Claude Bank",
      sub: "Extra Claude-written questions, by system",
      condition: isTorso && typeof CLAUDEBANK !== "undefined" && CLAUDEBANK.length > 0,
    },
    {
      id: "missedRoot",
      icon: "🔁",
      title: "Missed Questions",
      sub: "Re-do everything you've gotten wrong — all sections",
      condition: isTorso,
      bg: "linear-gradient(135deg,#C0392B 0%,#922B21 100%)",  // coral/red — the "wrong ones"
      shadow: "rgba(192,57,43,.32)",
      onclick: () => {
        const missed = JSON.parse(localStorage.getItem(ns("missed:" + state.sectionKey)) || "[]");
        if (!missed.length) { alert("No missed questions recorded yet. Take a quiz or exam first!"); return; }
        missedDeck = shuffle([...missed]);
        state.route = "missedReview"; render();
      },
    },
    {
      id: "stuviaMenu",
      icon: "📚",
      title: "Stuvia Bank (Extra Practice)",
      sub: "Community question bank — extra practice",
      condition: true,
    },
    {
      id: "diagramMenu",
      icon: "🖼️",
      title: "Diagrams & Labeling",
      sub: "Image galleries and labeling exercises",
      condition: sec.gallery || sec.labeling,
    },
    // Diagram Gallery pinned to the BOTTOM of the menu
    {
      id: "diagramGallery",
      icon: "🖼️",
      title: "Diagram Gallery",
      sub: "All labeled GR diagrams, by section",
      condition: isTorso || isAxial,
    },
  ].filter(i => i.condition);
  // Space between the Stuvia bank and the diagram section (whichever diagram item shows first)
  const firstDiag = items.findIndex(i => i.id === "diagramMenu" || i.id === "diagramGallery");
  if (firstDiag > 0) items[firstDiag].gapBefore = true;

  const list = document.createElement("div");
  list.className = "sectionMenuList";

  ensureHoverStyle();

  items.forEach(item => {
    const card = document.createElement("button");
    card.className = "sectionMenuCard";
    const filled = !!item.bg;
    if (filled) {
      card.style.cssText = `background:${item.bg};border:none;color:#fff;box-shadow:0 4px 14px ${item.shadow || "rgba(0,0,0,.25)"};`;
    }
    if (item.gapBefore) card.style.marginTop = "22px"; // set AFTER cssText so it isn't overwritten
    const subColor = filled ? "rgba(255,255,255,.85)" : "";
    const chevColor = filled ? "#fff" : "";
    card.innerHTML = `
      <span class="smc-icon">${item.icon}</span>
      <span class="smc-text">
        <span class="smc-title"${filled ? ' style="color:#fff;"' : ''}>${item.title}</span>
        <span class="smc-sub"${subColor ? ` style="color:${subColor};"` : ''}>${item.sub}</span>
      </span>
      <span class="smc-chevron"${chevColor ? ` style="color:${chevColor};"` : ''}>›</span>`;
    card.onclick = item.onclick || (() => { state.route = item.id; render(); });
    list.appendChild(card);
  });

  main.appendChild(list);
}

/* ─── GR MENU ─── */
function renderGrMenu(main) {
  const sec = getSection(state.sectionKey);
  if (!sec) { state.route = "home"; render(); return; }

  const isTorso = state.sectionKey === "torso";

  // Section filter chips (Torso only)
  if (isTorso) {
    const bar = document.createElement("div");
    bar.className = "grSectionBar";

    const allChip = document.createElement("button");
    allChip.className = "grSectionChip" + (state.grSection === -1 ? " active" : "");
    allChip.textContent = "All";
    allChip.onclick = () => { state.grSection = -1; render(); };
    bar.appendChild(allChip);

    TORSO_GR_SECTIONS.forEach((gs, gi) => {
      const chip = document.createElement("button");
      chip.className = "grSectionChip" + (state.grSection === gi ? " active" : "");
      chip.innerHTML = `${gs.icon} ${gs.label}`;
      chip.onclick = () => { state.grSection = gi; render(); };
      bar.appendChild(chip);
    });
    main.appendChild(bar);
  }

  const list = document.createElement("div");
  list.className = "modeList";

  // Which subtopics to show
  let subtopics = sec.subtopics || [];
  if (isTorso && state.grSection >= 0 && TORSO_GR_SECTIONS[state.grSection]) {
    const idxSet = new Set(TORSO_GR_SECTIONS[state.grSection].indices);
    subtopics = subtopics.filter((_, i) => idxSet.has(i));
  }

  // ── Flashcards ──
  if (sec.flashcards && sec.flashcards.length) {
    const hdr = document.createElement("div");
    hdr.className = "modeGroupHdr";
    hdr.textContent = "Flashcards";
    list.appendChild(hdr);

    const btn = document.createElement("button");
    btn.className = "modeBtn";
    btn.innerHTML = `<span class="modeIcon">🃏</span><span class="modeLabel">Flashcard Deck</span><span class="modeMeta">${sec.flashcards.length} cards</span>`;
    btn.onclick = () => { state.mode = "flashcards"; state.prevRoute = "grMenu"; render(); };
    list.appendChild(btn);
  }

  // ── Timed GR by subtopic ──
  if (subtopics.length) {
    const hdr = document.createElement("div");
    hdr.className = "modeGroupHdr";
    hdr.textContent = "Timed GR Questions";
    list.appendChild(hdr);

    subtopics.forEach(sub => {
      const btn = document.createElement("button");
      btn.className = "modeBtn";
      const qCount = (sub.quiz || []).length;
      const best = (progressState.quizzes && progressState.quizzes["grTimed:" + state.sectionKey + ":" + sub.title]);
      const bestTxt = best ? ` · Best ${best.score}/${best.total}` : "";
      btn.innerHTML = `<span class="modeIcon">⏱️</span><span class="modeLabel">${sub.title}</span><span class="modeMeta">${qCount} Qs${bestTxt}</span>`;
      btn.onclick = () => {
        // launch timed GR exam directly (sets examSource = "gr", uses subtopic quiz)
        // Include ALL questions (content + diagram/labeling) so the deck matches the "N Qs" count.
        const quiz = (sub.quiz || []);
        if (!quiz.length) return;
        state.prevRoute = "grMenu";
        state.examSource = "gr";
        state.examTitle = sub.title;
        examDeck = shuffle([...quiz]);
        examIndex = 0; examScore = 0;
        examAnswered = false; examSelected = -1; examTimedOut = false; examAnswerLog = [];
        sessionModeSet = false; sessionDiagGateSet = false;
        state.route = "exam";
        render();
      };
      list.appendChild(btn);
    });
  }

  // ── ClaudeBank ──
  if (typeof CLAUDEBANK !== "undefined" && CLAUDEBANK.length && state.sectionKey === "torso") {
    const hdr = document.createElement("div");
    hdr.className = "modeGroupHdr";
    hdr.textContent = "AI Question Bank";
    list.appendChild(hdr);

    const btn = document.createElement("button");
    btn.className = "modeBtn";
    btn.innerHTML = `<span class="modeIcon">🤖</span><span class="modeLabel">ClaudeBank</span><span class="modeMeta">${CLAUDEBANK.reduce((a,t)=>a+(t.questions||[]).length,0)} AI questions</span>`;
    btn.onclick = () => { state.prevRoute = "grMenu"; state.route = "cbPicker"; render(); };
    list.appendChild(btn);
  }

  // ── Worksheet / written practice ──
  if (sec.worksheet || (sec.quiz && sec.quiz.length)) {
    const hdr = document.createElement("div");
    hdr.className = "modeGroupHdr";
    hdr.textContent = "Written Practice";
    list.appendChild(hdr);

    const btn = document.createElement("button");
    btn.className = "modeBtn";
    btn.innerHTML = `<span class="modeIcon">✏️</span><span class="modeLabel">Worksheet</span><span class="modeMeta">Open-response prompts</span>`;
    btn.onclick = () => { state.mode = "worksheet"; state.prevRoute = "grMenu"; render(); };
    list.appendChild(btn);
  }

  main.appendChild(list);
}

/* Hover/press micro-interactions for the main section cards + toggle pills (injected once). */
function ensureHoverStyle() {
  if (document.getElementById("smcHoverStyle")) return;
  const st = document.createElement("style");
  st.id = "smcHoverStyle";
  st.textContent = ".sectionMenuCard,.homeCard{transition:transform .14s ease, box-shadow .14s ease, filter .14s ease;}"
    + "@media (hover:hover){.sectionMenuCard:hover,.homeCard:hover{transform:translateY(-3px) scale(1.012);box-shadow:0 12px 28px rgba(0,0,0,.16);filter:brightness(1.03);}}"
    + ".sectionMenuCard:active,.homeCard:active{transform:translateY(0) scale(.996);filter:brightness(.98);}"
    + ".pillBtn{transition:transform .12s ease, box-shadow .12s ease, filter .12s ease;}"
    + "@media (hover:hover){.pillBtn:hover{transform:translateY(-1px) scale(1.03);box-shadow:0 3px 10px rgba(0,0,0,.14);filter:brightness(1.03);}}"
    + ".pillBtn:active{transform:scale(.97);}";
  document.head.appendChild(st);
}

/* ─── ATTEMPT HISTORY (unified timeline of every exam / mock / timed / quiz) ─── */
function _attemptKind(key, rec) {
  if (rec && rec.kind) return rec.kind;
  if (/^exam:/.test(key)) return "timed";
  if (/^grTimed:/.test(key)) return "gr";
  if (/^sim:/.test(key)) return "sim";
  if (/^fullExam:/.test(key)) return "mock";
  if (/^suddenDeath:/.test(key)) return "sudden";
  return "quiz";
}
function _attemptTitle(key, rec) {
  if (rec && rec.title) return rec.title;
  if (/^exam:/.test(key)) return "Timed Practice Exam";
  if (/^grTimed:/.test(key)) return "Timed Guided-Reading";
  if (/^sim:/.test(key)) return "Simulation";
  if (/^fullExam:/.test(key)) return "Simulation / Mini Mock";
  if (/^suddenDeath:/.test(key)) return "Sudden Death";
  return (key.split(":")[0] || "Quiz");
}
/* The section a record belongs to is the token right after the prefix: "fullExam:torso",
   "grTimed:torso:Heart", "exam:axial:0" → "torso"/"axial"/… */
function _attemptSection(key) { return String(key || "").split(":")[1] || ""; }
function allAttempts(sec) {
  sec = sec || state.sectionKey;   // History is scoped to the CURRENT section only
  const out = [];
  const push = src => { if (!src) return; Object.keys(src).forEach(key => {
    if (sec && _attemptSection(key) !== sec) return;   // keep only this section's attempts
    (src[key] || []).forEach(rec => {
      out.push({ key, rec, kind: _attemptKind(key, rec), title: _attemptTitle(key, rec), ts: rec.ts || Date.parse(rec.date) || 0 });
    });
  }); };
  push(progressState.examAttempts);
  try { push(loadArchive().examAttempts); } catch (e) {}
  const seen = new Set(), uniq = [];
  out.sort((a, b) => b.ts - a.ts).forEach(o => {
    const id = o.key + "|" + o.ts + "|" + (o.rec.score) + "|" + (o.rec.total);
    if (seen.has(id)) return; seen.add(id); uniq.push(o);
  });
  return uniq;
}
const HIST_FILTERS = { all: () => true, mocks: k => k === "mock" || k === "sim", timed: k => k === "timed" || k === "gr", quizzes: k => k === "quiz" || k === "sudden" };
/* Aggregate answer-change (second-guessing) + flag stats across all logged attempts. */
function behaviorStats() {
  const b = { r2w: 0, w2r: 0, w2w: 0, flagTotal: 0, flagRight: 0 };
  allAttempts().forEach(a => {
    const c = a.rec.changes, f = a.rec.flags;
    if (c) { b.r2w += c.r2w || 0; b.w2r += c.w2r || 0; b.w2w += c.w2w || 0; }
    if (f) { b.flagTotal += f.total || 0; b.flagRight += f.right || 0; }
  });
  b.totalChanges = b.r2w + b.w2r + b.w2w;
  return b;
}
function renderHistory(main) {
  const all = allAttempts();
  const filter = state.histFilter || "all";
  state.histOpen = state.histOpen || {};

  const sub = document.createElement("div");
  sub.className = "subtitle";
  sub.textContent = "Every attempt you've taken — newest first. Tap one to see the questions you missed.";
  main.appendChild(sub);

  if (!all.length) {
    const none = document.createElement("div");
    none.style.cssText = "text-align:center;color:#888;padding:36px 16px;";
    none.innerHTML = "No attempts logged yet.<br>Take a mock, timed exam, or quiz and it'll show up here.";
    main.appendChild(none);
    return;
  }

  // Summary strip
  const scored = all.filter(a => typeof a.rec.pct === "number");
  const avg = scored.length ? Math.round(scored.reduce((s, a) => s + a.rec.pct, 0) / scored.length) : null;
  const best = scored.length ? Math.max(...scored.map(a => a.rec.pct)) : null;
  const strip = document.createElement("div");
  strip.style.cssText = "display:flex;gap:8px;margin:2px 0 12px;";
  strip.innerHTML = `
    <div style="flex:1;background:#EEF4FB;border-radius:10px;padding:9px 12px;text-align:center;"><div style="font-size:.72rem;color:#5a6b85;">Attempts</div><div style="font-size:1.3rem;font-weight:800;color:#1F3864;">${all.length}</div></div>
    <div style="flex:1;background:#EEF4FB;border-radius:10px;padding:9px 12px;text-align:center;"><div style="font-size:.72rem;color:#5a6b85;">Avg score</div><div style="font-size:1.3rem;font-weight:800;color:#1F3864;">${avg != null ? avg + "%" : "—"}</div></div>
    <div style="flex:1;background:#EEF4FB;border-radius:10px;padding:9px 12px;text-align:center;"><div style="font-size:.72rem;color:#5a6b85;">Best</div><div style="font-size:1.3rem;font-weight:800;color:#2E7D32;">${best != null ? best + "%" : "—"}</div></div>`;
  main.appendChild(strip);

  // Filter chips
  const chips = document.createElement("div");
  chips.style.cssText = "display:flex;gap:8px;margin:0 0 12px;flex-wrap:wrap;";
  [["all", "All"], ["mocks", "Mocks"], ["timed", "Timed"], ["quizzes", "Quizzes"]].forEach(([k, lbl]) => {
    const n = all.filter(a => HIST_FILTERS[k](a.kind)).length;
    const on = filter === k;
    const c = document.createElement("button");
    c.textContent = `${lbl} ${n}`;
    c.style.cssText = `border:1.5px solid ${on ? "#1F3864" : "#cfd8e3"};background:${on ? "#1F3864" : "#fff"};color:${on ? "#fff" : "#41506a"};border-radius:999px;padding:6px 14px;font-size:.82rem;font-weight:700;cursor:pointer;`;
    c.onclick = () => { state.histFilter = k; render(); };
    chips.appendChild(c);
  });
  main.appendChild(chips);

  const rows = all.filter(a => HIST_FILTERS[filter](a.kind));
  const KIND_ICON = { mock: "🎓", sim: "🎓", timed: "⏱️", gr: "📖", quiz: "🧩", sudden: "🔥" };
  const list = document.createElement("div");
  list.style.cssText = "display:flex;flex-direction:column;gap:8px;";
  rows.forEach(a => {
    const rec = a.rec;
    const id = a.key + "|" + a.ts + "|" + rec.score;
    const openNow = !!state.histOpen[id];
    const pctColor = typeof rec.pct === "number" ? _prepBandColor(rec.pct) : "#8a63d2";
    const scoreTxt = rec.pct == null
      ? `🔥 ${rec.score} streak`
      : `${rec.score}/${rec.total} · <span style="color:${pctColor};">${rec.pct}%</span>`;
    const modeTag = rec.mode === "open" ? "📖 Notes" : rec.mode === "closed" ? "🧠 Closed" : "";
    const card = document.createElement("div");
    card.style.cssText = `background:#fff;border:1px solid #e4e8ee;border-left:4px solid ${pctColor};border-radius:10px;overflow:hidden;`;
    const head = document.createElement("button");
    head.style.cssText = "width:100%;text-align:left;background:none;border:none;padding:11px 13px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:10px;";
    const nMissed = (rec.missed && rec.missed.length) || 0;
    head.innerHTML = `
      <span style="min-width:0;">
        <span style="font-weight:700;color:#1F3864;font-size:.93rem;">${KIND_ICON[a.kind] || "📝"} ${escapeHtml(a.title)}</span>
        <span style="display:block;color:#8a94a6;font-size:.76rem;margin-top:2px;">${rec.date}${rec.time ? " · " + rec.time : ""}${modeTag ? " · " + modeTag : ""}${nMissed ? " · " + nMissed + " missed" : ""}</span>
      </span>
      <span style="flex:0 0 auto;font-weight:800;font-size:.95rem;color:#1F3864;">${scoreTxt} <span style="color:#b8c0cc;font-weight:600;">${openNow ? "▲" : "▼"}</span></span>`;
    head.onclick = () => { state.histOpen[id] = !openNow; render(); };
    card.appendChild(head);
    if (openNow) {
      const body = document.createElement("div");
      body.style.cssText = "padding:2px 13px 12px;border-top:1px solid #f0f2f6;";
      if (nMissed) {
        body.innerHTML = `<div style="font-size:.78rem;font-weight:700;color:#C0392B;margin:8px 0 6px;">Missed (${nMissed})</div>` +
          rec.missed.map(m => `<div style="margin:7px 0;font-size:.83rem;line-height:1.4;">
            <div style="color:#333;">${escapeHtml(m.q)}</div>
            <div style="color:#C0392B;">Your answer: ${escapeHtml(String(m.yours))}</div>
            <div style="color:#2E7D32;">Correct: ${escapeHtml(String(m.correct))}</div></div>`).join("");
      } else {
        body.innerHTML = `<div style="font-size:.82rem;color:#888;padding:8px 0;">${a.kind === "sudden" ? "Sudden Death logs your streak only." : rec.pct === 100 ? "🎉 Perfect — nothing missed." : "No per-question breakdown was captured for this attempt."}</div>`;
      }
      card.appendChild(body);
    }
    list.appendChild(card);
  });
  main.appendChild(list);
}

/* ─── EXAM MENU ─── */
function renderExamMenu(main) {
  const sec = getSection(state.sectionKey);

  const list = document.createElement("div");
  list.className = "modeList";

  // ── History — every past attempt on one timeline ──
  const nAttempts = allAttempts().length;
  const histBtn = document.createElement("button");
  histBtn.className = "modeBtn";
  histBtn.style.cssText = "border:2px solid #1F3864;background:#EEF4FB;";
  histBtn.innerHTML = `<span class="modeIcon">🗓️</span><span class="modeLabel">History — past attempts</span><span class="modeMeta">${nAttempts ? nAttempts + " logged · " : ""}every mock, timed exam &amp; quiz on one timeline · tap any to see missed questions</span>`;
  histBtn.onclick = () => { state.route = "history"; state.histFilter = "all"; render(); };
  list.appendChild(histBtn);

  // ── Full Exam — realistic mocks (all use the 100-min skip & flag format) ──
  const hdrFull = document.createElement("div");
  hdrFull.className = "modeGroupHdr";
  hdrFull.textContent = "Full Exam — Realistic Mocks";
  list.appendChild(hdrFull);

  // Build a 200Q deck: 50 random Qs per section. opts selects which banks to draw from.
  const buildSimDeck = (perSection = 50, opts) => {
    opts = opts || { gr: true, stuvia: true, pe: true, cb: true };
    const ORDER = ["Thorax","Abdomen","Pelvis & Perineum","Systemic"];
    let deck = [];
    const seen = new Set();   // shared across sections so a Systemic question can't repeat a Thorax/Abdomen/Pelvis one
    ORDER.forEach((sectionLabel, si) => {
      let pool = [];
      if (opts.gr) {
        const grSec = TORSO_GR_SECTIONS[si];
        if (grSec && sec && sec.subtopics) grSec.indices.forEach(idx => { const sub = sec.subtopics[idx]; if (sub && sub.quiz) sub.quiz.filter(q => !isDiagramQ(q)).forEach(q => pool.push(q)); });
      }
      if (opts.stuvia && typeof STUVIA_BANK !== "undefined") {
        const sb = STUVIA_BANK.find(b => b.title === sectionLabel);
        if (sb) pool.push(...(sb.questions || []));
      }
      if (opts.pe && sec && sec.exams) {
        sec.exams.filter(e => e.group === sectionLabel).forEach(e => pool.push(...(e.questions || [])));
      }
      if (opts.cb && typeof CLAUDEBANK !== "undefined") {
        const CB_MAP = { "Thorax":[0], "Abdomen":[1], "Pelvis & Perineum":[2], "Systemic":[3,4,5,6,7] };
        (CB_MAP[sectionLabel] || []).forEach(idx => { if (CLAUDEBANK[idx]) CLAUDEBANK[idx].questions.forEach(q => pool.push({ ...q, options: q.options.map(o => o.replace(/^[A-E]\.\s*/, "")) })); });
      }
      // dedupe within this section AND against everything already added, then take the slice
      deck.push(...dedupeQs(shuffle(pool.filter(isExamEligible)), seen).slice(0, perSection));
    });
    return deck;
  };
  const buildFullDeck = () => buildSimDeck(50);   // all banks (Sprint reuses this)

  // Launch the skip-&-flag full-exam experience with a given deck + title + total seconds.
  const launchFullExam = (pool, title, seconds) => {
    if (!pool.length) { alert("No questions available yet."); return; }
    fullExamDeck = pool; fullExamIndex = 0;
    fullExamAnswers = new Array(pool.length).fill(-1);
    fullExamFlags = new Set();
    fullExamSecondsLeft = seconds || 6000;
    fullExamShowOverview = false;
    fullExamModeSet = false; fullExamOvFilter = "all"; fullExamReachedEnd = false;
    fullExamChanges = { r2w: 0, w2r: 0, w2w: 0 };
    fullExamShuffledOrders = pool.map(q => shuffle([...q.options]));
    clearInterval(fullExamTimerInterval); fullExamTimerInterval = null; // null it so the fresh exam's timer actually starts
    state.examTitle = title || "Simulation";
    state.route = "fullExam"; render();
  };

  // Pool for a SINGLE section drawn from the selected banks (used by mini mocks).
  const sectionPool = (sectionLabel, si, opts) => {
    opts = opts || { gr: true, stuvia: true, cb: true };
    let pool = [];
    if (opts.gr) {
      const grSec = TORSO_GR_SECTIONS[si];
      if (grSec && sec && sec.subtopics) grSec.indices.forEach(idx => { const sub = sec.subtopics[idx]; if (sub && sub.quiz) sub.quiz.filter(q => !isDiagramQ(q)).forEach(q => pool.push(q)); });
    }
    if (opts.stuvia && typeof STUVIA_BANK !== "undefined") { const sb = STUVIA_BANK.find(b => b.title === sectionLabel); if (sb) pool.push(...(sb.questions || [])); }
    if (opts.pe && sec && sec.exams) { sec.exams.filter(e => e.group === sectionLabel).forEach(e => pool.push(...(e.questions || []))); }
    if (opts.cb && typeof CLAUDEBANK !== "undefined") {
      const CB_MAP = { "Thorax":[0], "Abdomen":[1], "Pelvis & Perineum":[2], "Systemic":[3,4,5,6,7] };
      (CB_MAP[sectionLabel] || []).forEach(idx => { if (CLAUDEBANK[idx]) CLAUDEBANK[idx].questions.forEach(q => pool.push({ ...q, options: q.options.map(o => o.replace(/^[A-E]\.\s*/, "")) })); });
    }
    return dedupeQs(pool.filter(isExamEligible));
  };

  // ⭐ THE REAL DEAL — all banks, 100 min, skip & flag (emphasized)
  const fullBtn = document.createElement("button");
  fullBtn.className = "modeBtn";
  fullBtn.style.cssText = "border:2px solid #1F3864;background:#EEF4FB;";
  fullBtn.innerHTML = `<span class="modeIcon">🎓</span><span class="modeLabel">Simulation — THE REAL DEAL ⭐</span><span class="modeMeta">Closest to your actual exam · 100 min · 200 Qs · 50/section · ALL banks (GR + Stuvia + ClaudeBank + Practice Exams) · skip &amp; flag freely</span>`;
  fullBtn.onclick = () => launchFullExam(buildSimDeck(50, { gr: true, stuvia: true, pe: true, cb: true }), "Simulation");
  list.appendChild(fullBtn);

  // Stuvia-only simulation
  const stuSimBtn = document.createElement("button");
  stuSimBtn.className = "modeBtn";
  stuSimBtn.innerHTML = `<span class="modeIcon">📚</span><span class="modeLabel">Stuvia Simulation</span><span class="modeMeta">100 min · 50/section · Stuvia questions only · skip &amp; flag</span>`;
  stuSimBtn.onclick = () => launchFullExam(buildSimDeck(50, { stuvia: true }), "Stuvia Simulation");
  list.appendChild(stuSimBtn);

  // ClaudeBank-only simulation
  const cbSimBtn = document.createElement("button");
  cbSimBtn.className = "modeBtn";
  cbSimBtn.innerHTML = `<span class="modeIcon">🤖</span><span class="modeLabel">ClaudeBank Simulation</span><span class="modeMeta">100 min · 50/section (as available) · ClaudeBank questions only · skip &amp; flag</span>`;
  cbSimBtn.onclick = () => launchFullExam(buildSimDeck(50, { cb: true }), "ClaudeBank Simulation");
  list.appendChild(cbSimBtn);

  // ── Full Exam by Section — Mini Mocks (100 Qs, one section, all 3 banks, full skip/flag timer) ──
  const hdrMini = document.createElement("div");
  hdrMini.className = "modeGroupHdr";
  hdrMini.textContent = "Full Exam by Section — Mini Mocks";
  list.appendChild(hdrMini);

  const MINI_ORDER = [["Thorax","🫁"],["Abdomen","🍽️"],["Pelvis & Perineum","🔻"],["Systemic","🩸"]];
  const MINI_N = 100, MINI_SECS = 3000; // 100 Qs · 50 min total · skip & flag
  MINI_ORDER.forEach(([label, icon], mi) => {
    const b = document.createElement("button");
    b.className = "modeBtn";
    b.innerHTML = `<span class="modeIcon">${icon}</span><span class="modeLabel">${label} — Mini Mock</span><span class="modeMeta">${MINI_N} Qs · ~${Math.round(MINI_SECS/60)} min · GR + Stuvia + ClaudeBank · skip &amp; flag</span>`;
    b.onclick = () => launchFullExam(shuffle(sectionPool(label, mi, { gr: true, stuvia: true, cb: true })).slice(0, MINI_N), label + " Mini Mock", MINI_SECS);
    list.appendChild(b);
  });

  // ── Timed Challenge ──
  const hdrSim = document.createElement("div");
  hdrSim.className = "modeGroupHdr";
  hdrSim.textContent = "Timed Challenge";
  list.appendChild(hdrSim);

  // Sprint (moved here) — 30s per question, no skipping, all banks
  const sprintBtn = document.createElement("button");
  sprintBtn.className = "modeBtn";
  sprintBtn.innerHTML = `<span class="modeIcon">⚡</span><span class="modeLabel">Full Exam — Sprint</span><span class="modeMeta">200 Qs · 50/section · 30 s/question · no skipping · all banks</span>`;
  sprintBtn.onclick = () => {
    const pool = buildFullDeck();
    if (!pool.length) { alert("No practice exams available yet."); return; }
    EXAM_SECONDS = 30;
    examDeck = pool; examIndex = 0; examScore = 0;
    examAnswered = false; examSelected = -1; examTimedOut = false; examAnswerLog = [];
    state.examSource = "custom"; state.examTitle = "Simulation";
    state.route = "exam"; render();
  };
  list.appendChild(sprintBtn);

  const SIM_SECS = 25;
  const SIM_PER_SECTION = 50;
  const SIM_ORDER = ["Thorax","Abdomen","Pelvis & Perineum","Systemic"];
  const simTotalQ = SIM_ORDER.length * SIM_PER_SECTION; // 200
  const simTotalMins = Math.floor(simTotalQ * SIM_SECS / 60); // 83 min

  const simBtn = document.createElement("button");
  simBtn.className = "modeBtn";
  simBtn.innerHTML = `<span class="modeIcon">⏱️</span><span class="modeLabel">Timed Practice Exam</span><span class="modeMeta">${simTotalQ} Qs · ${SIM_PER_SECTION}/section in order · ${SIM_SECS}s/question (~${simTotalMins} min)</span>`;
  simBtn.onclick = () => {
    if (!sec || !sec.exams || !sec.exams.length) { alert("No practice exams loaded yet."); return; }
    // Build pool: 50 randomly drawn from each section's exam questions, in syllabus order
    let simDeckBuilt = [];
    SIM_ORDER.forEach(grp => {
      let pool = [];
      sec.exams.filter(e => e.group === grp).forEach(e => pool.push(...(e.questions || [])));
      if (!pool.length) return;
      // Shuffle and take exactly SIM_PER_SECTION (or all if fewer)
      pool = shuffle([...pool]).slice(0, SIM_PER_SECTION);
      simDeckBuilt.push(...pool);
    });
    if (simDeckBuilt.length < 4) { alert("Not enough questions yet. Add more practice exams first."); return; }
    // Launch using timed exam with 25s override
    EXAM_SECONDS = SIM_SECS;
    examDeck = simDeckBuilt;
    examIndex = 0; examScore = 0;
    examAnswered = false; examSelected = -1; examTimedOut = false; examAnswerLog = [];
    state.examSource = "custom";
    state.examTitle = "Torso Simulation";
    state.route = "exam";
    render();
  };
  list.appendChild(simBtn);

  // ── Competitive ──
  const hdrC = document.createElement("div");
  hdrC.className = "modeGroupHdr";
  hdrC.textContent = "Competitive";
  list.appendChild(hdrC);

  const sdBtn = document.createElement("button");
  sdBtn.className = "modeBtn";
  const sdBest = (progressState.quizzes && progressState.quizzes["suddenDeath:" + state.sectionKey]) || {};
  const sdBestTxt = sdBest.score ? ` · Best streak: ${sdBest.score}` : "";
  sdBtn.innerHTML = `<span class="modeIcon">💀</span><span class="modeLabel">Sudden Death</span><span class="modeMeta">Keep going until you miss${sdBestTxt}</span>`;
  sdBtn.onclick = () => {
    // build pool from all available content Qs in section
    let pool = [];
    if (sec) {
      (sec.subtopics || []).forEach(sub => pool.push(...filterQuiz(sub.quiz || [], "content")));
      if (sec.quiz) pool.push(...filterQuiz(sec.quiz, "content"));
    }
    if (!pool.length) { alert("No questions available yet."); return; }
    sdDeck = shuffle([...pool]);
    sdIndex = 0; sdStreak = 0; sdAnswered = false; sdSelected = -1;
    state.route = "suddenDeath";
    render();
  };
  list.appendChild(sdBtn);

  // ── Timed Practice Exams ──
  if (sec && sec.exams && sec.exams.length) {
    const hdrE = document.createElement("div");
    hdrE.className = "modeGroupHdr";
    hdrE.textContent = "Timed Exams";
    list.appendChild(hdrE);

    const epBtn = document.createElement("button");
    epBtn.className = "modeBtn";
    epBtn.innerHTML = `<span class="modeIcon">📋</span><span class="modeLabel">Practice Exams</span><span class="modeMeta">${sec.exams.length} exam${sec.exams.length !== 1 ? "s" : ""} available</span>`;
    epBtn.onclick = () => { state.examSource = "tb"; state.route = "examPicker"; render(); };
    list.appendChild(epBtn);
  }

  // ── Simulation ──
  if (typeof SIMULATION_DATA !== "undefined" || (sec && sec.simulation)) {
    const hdrS = document.createElement("div");
    hdrS.className = "modeGroupHdr";
    hdrS.textContent = "Full Simulation";
    list.appendChild(hdrS);

    const simBtn = document.createElement("button");
    simBtn.className = "modeBtn";
    simBtn.innerHTML = `<span class="modeIcon">🎓</span><span class="modeLabel">Exam Simulation</span><span class="modeMeta">Timed, realistic full-length exam</span>`;
    simBtn.onclick = () => { state.route = "simPicker"; render(); };
    list.appendChild(simBtn);
  }

  // ── Missed Questions ──
  const hdrM = document.createElement("div");
  hdrM.className = "modeGroupHdr";
  hdrM.textContent = "Review";
  list.appendChild(hdrM);

  const mrBtn = document.createElement("button");
  mrBtn.className = "modeBtn";
  mrBtn.innerHTML = `<span class="modeIcon">🔁</span><span class="modeLabel">Missed Questions</span><span class="modeMeta">Re-do questions you got wrong</span>`;
  mrBtn.onclick = () => {
    const key = "missed:" + state.sectionKey;
    const missed = JSON.parse(localStorage.getItem(ns(key)) || "[]");
    if (!missed.length) { alert("No missed questions recorded yet. Try a practice exam first!"); return; }
    missedDeck = shuffle([...missed]);
    state.route = "missedReview";
    render();
  };
  list.appendChild(mrBtn);

  main.appendChild(list);
}

/* ─── DIAGRAM MENU ─── */
function renderDiagramMenu(main) {
  const sec = getSection(state.sectionKey);

  const list = document.createElement("div");
  list.className = "modeList";

  // ── Gallery ──
  const hdrG = document.createElement("div");
  hdrG.className = "modeGroupHdr";
  hdrG.textContent = "Image Gallery";
  list.appendChild(hdrG);

  const galBtn = document.createElement("button");
  galBtn.className = "modeBtn";
  const galCount = sec && sec.gallery ? sec.gallery.length : "—";
  galBtn.innerHTML = `<span class="modeIcon">🖼️</span><span class="modeLabel">Gallery</span><span class="modeMeta">${galCount} images</span>`;
  galBtn.onclick = () => { state.prevRoute = "diagramMenu"; state.route = "gallery"; render(); };
  list.appendChild(galBtn);

  // ── Labeling ──
  if (sec && sec.labeling) {
    const hdrL = document.createElement("div");
    hdrL.className = "modeGroupHdr";
    hdrL.textContent = "Labeling Practice";
    list.appendChild(hdrL);

    const labBtn = document.createElement("button");
    labBtn.className = "modeBtn";
    labBtn.innerHTML = `<span class="modeIcon">🏷️</span><span class="modeLabel">Label Diagrams</span><span class="modeMeta">Identify structures on images</span>`;
    labBtn.onclick = () => { state.prevRoute = "diagramMenu"; state.route = "labeling"; render(); };
    list.appendChild(labBtn);
  }

  // ── Diagram Quizzes ──
  if (sec && sec.quiz && filterQuiz(sec.quiz, "diagram").length) {
    const hdrD = document.createElement("div");
    hdrD.className = "modeGroupHdr";
    hdrD.textContent = "Diagram Quiz";
    list.appendChild(hdrD);

    const dqBtn = document.createElement("button");
    dqBtn.className = "modeBtn";
    const dqCount = filterQuiz(sec.quiz, "diagram").length;
    dqBtn.innerHTML = `<span class="modeIcon">❓</span><span class="modeLabel">Diagram Questions</span><span class="modeMeta">${dqCount} questions</span>`;
    dqBtn.onclick = () => {
      quizDeck = shuffle([...filterQuiz(sec.quiz, "diagram")]);
      state.quizFilter = "diagram"; state.quizSource = "section";
      state.prevRoute = "diagramMenu";
      state.route = "quiz";
      render();
    };
    list.appendChild(dqBtn);
  }

  // placeholder if nothing
  if (!sec || (!sec.gallery && !sec.labeling)) {
    const msg = document.createElement("p");
    msg.className = "comingSoonMsg";
    msg.textContent = "Diagram content coming soon for this section.";
    main.appendChild(msg);
    return;
  }

  main.appendChild(list);
}

/* ─── SUDDEN DEATH ─── */
function renderSuddenDeath(main) {
  if (!sdDeck.length) { state.route = "examMenu"; render(); return; }

  const q = sdDeck[sdIndex];
  if (!sdAnswered) markQuestionShown("sd" + sdIndex + (q.id || ""));

  // Streak header
  const streakWrap = document.createElement("div");
  streakWrap.className = "sdStreakWrap";
  streakWrap.innerHTML = `
    <div class="sdStreakLabel">🔥 STREAK</div>
    <div class="sdStreakNum">${sdStreak}</div>
    <div class="sdQCounter">${sdIndex + 1} of ${sdDeck.length}</div>`;
  main.appendChild(streakWrap);

  // Question card
  const qCard = document.createElement("div");
  qCard.className = "quizCard";
  const qText = document.createElement("p");
  qText.className = "quizQuestion";
  qText.textContent = q.question || q.q;
  qCard.appendChild(qText);

  // Shuffle options — cached so they don't jump after click
  const sdQKey = q.q || q.question || String(sdIndex);
  if (_sdShCache.key !== sdQKey) { _sdShCache.key = sdQKey; _sdShCache.opts = shuffle([...q.options]); }
  const sdSOpts = _sdShCache.opts;
  const sdSCorrect = sdSOpts.indexOf(q.options[q.correct]);

  sdSOpts.forEach((ans, i) => {
    const btn = document.createElement("button");
    btn.className = "answerBtn";
    if (sdAnswered) {
      if (i === sdSCorrect) btn.classList.add("correct");
      else if (i === sdSelected) btn.classList.add("incorrect");
    }
    btn.textContent = ans;
    if (!sdAnswered) {
      btn.onclick = () => {
        sdAnswered = true;
        sdSelected = i; // shuffled display index
        const correct = i === sdSCorrect;
        recordQuestionStat(sdDeck[sdIndex], correct, qElapsed());
        if (correct) {
          sdStreak++;
          // advance after short delay
          setTimeout(() => {
            sdIndex++;
            sdAnswered = false; sdSelected = -1;
            if (sdIndex >= sdDeck.length) { state.route = "sdEnd"; render(); return; }
            render();
          }, 600);
        } else {
          // wrong — show result then end
          render();
          setTimeout(() => { state.route = "sdEnd"; render(); }, 1400);
          return;
        }
        render();
      };
    }
    qCard.appendChild(btn);
  });
  main.appendChild(qCard);
  const sdRepRow = document.createElement("div");
  sdRepRow.style.cssText = "text-align:right;padding:2px 16px 0;";
  sdRepRow.appendChild(reportBtn(q));
  main.appendChild(sdRepRow);
}

/* ─── SUDDEN DEATH END SCREEN ─── */
function renderSdEnd(main) {
  // Save best streak
  const key = "suddenDeath:" + state.sectionKey;
  const prev = (progressState.quizzes && progressState.quizzes[key]);
  if (!prev || sdStreak > prev.score) {
    recordQuizResult(key, sdStreak, sdDeck.length);
  }
  // Log this run once (renderSdEnd can re-render) to the unified History timeline
  if (sdDeck && !sdDeck._logged) {
    sdDeck._logged = true;
    recordAttempt(key, {
      title: "Sudden Death", kind: "sudden",
      mode: (typeof getStudyMode === "function" ? getStudyMode() : "closed"),
      score: sdStreak, total: sdStreak, pct: null, streak: sdStreak, missed: []
    });
  }
  const best = (progressState.quizzes && progressState.quizzes[key]);

  const wrap = document.createElement("div");
  wrap.className = "sdEndWrap";
  wrap.innerHTML = `
    <div class="sdEndIcon">${sdStreak > 0 ? "💀" : "😅"}</div>
    <div class="sdEndTitle">Game Over</div>
    <div class="sdEndStreak">You survived <strong>${sdStreak}</strong> question${sdStreak !== 1 ? "s" : ""}</div>
    ${best ? `<div class="sdEndBest">Best ever: <strong>${best.score}</strong></div>` : ""}
  `;

  const btnRow = document.createElement("div");
  btnRow.className = "sdBtnRow";

  const again = document.createElement("button");
  again.className = "primaryBtn";
  again.textContent = "🔁 Play Again";
  again.onclick = () => {
    sdDeck = shuffle([...sdDeck]);
    sdIndex = 0; sdStreak = 0; sdAnswered = false; sdSelected = -1;
    state.route = "suddenDeath";
    render();
  };
  btnRow.appendChild(again);

  const back = document.createElement("button");
  back.className = "secondaryBtn";
  back.textContent = "Back to Practice Tests";
  back.onclick = () => { sdDeck = []; state.route = "examMenu"; render(); };
  btnRow.appendChild(back);

  main.appendChild(wrap);
  main.appendChild(btnRow);
}

/* ─── CUSTOM BUILDER ─── */
function renderCustomBuilder(main) {
  // cbState.selectedKeys entries are prefixed by source type:
  //   "gr:secKey:si"   — GR subtopic question pool
  //   "stuvia:ti"      — Stuvia topic (index into STUVIA_BANK)
  //   "exam:secKey:ei" — Practice exam question pool
  let cbState = JSON.parse(localStorage.getItem(ns("customBuilderV2")) || '{"selectedKeys":[],"count":20,"mode":"quiz"}');
  const save = () => localStorage.setItem(ns("customBuilderV2"), JSON.stringify(cbState));

  // ── helpers ──
  const toggle = (key) => {
    if (cbState.selectedKeys.includes(key))
      cbState.selectedKeys = cbState.selectedKeys.filter(k => k !== key);
    else cbState.selectedKeys.push(key);
    save(); renderCb();
  };
  const selectAll = (keys) => {
    const allIn = keys.every(k => cbState.selectedKeys.includes(k));
    if (allIn) cbState.selectedKeys = cbState.selectedKeys.filter(k => !keys.includes(k));
    else keys.forEach(k => { if (!cbState.selectedKeys.includes(k)) cbState.selectedKeys.push(k); });
    save(); renderCb();
  };

  // ── resolve question pool from a key ──
  const resolvePool = (key) => {
    const parts = key.split(":");
    if (parts[0] === "gr") {
      const [, sk, si] = parts;
      const sub = DATA.sections[sk]?.subtopics?.[+si];
      return sub ? filterQuiz(sub.quiz || [], "content") : [];
    }
    if (parts[0] === "stuvia") {
      const [, ti] = parts;
      const topic = (typeof STUVIA_BANK !== "undefined") ? STUVIA_BANK[+ti] : null;
      return topic ? (topic.questions || []) : [];
    }
    if (parts[0] === "exam") {
      const [, sk, ei] = parts;
      return DATA.sections[sk]?.exams?.[+ei]?.questions || [];
    }
    return [];
  };

  // ── Quick random launch (uses current count setting) ──
  const randomMix = () => {
    const allKeys = [];
    Object.entries(DATA.sections || {}).forEach(([sk, sd]) => {
      (sd.subtopics || []).forEach((sub, si) => {
        if (filterQuiz(sub.quiz || [], "content").length) allKeys.push("gr:" + sk + ":" + si);
      });
      (sd.exams || []).forEach((ex, ei) => {
        if ((ex.questions || []).length) allKeys.push("exam:" + sk + ":" + ei);
      });
    });
    if (typeof STUVIA_BANK !== "undefined") {
      STUVIA_BANK.forEach((t, ti) => { if ((t.questions||[]).length) allKeys.push("stuvia:" + ti); });
    }
    let pool = [];
    allKeys.forEach(k => pool.push(...resolvePool(k)));
    pool = shuffle(pool).slice(0, cbState.count);
    if (!pool.length) { alert("No questions available yet."); return; }
    if (cbState.mode === "exam") {
      examDeck = pool; examIndex = 0; examScore = 0;
      state.examSource = "custom"; state.examTitle = "Random Mix";
      state.route = "exam";
    } else {
      quizDeck = pool;
      state.quizSource = "custom"; state.quizFilter = null;
      state.route = "quiz";
    }
    render();
  };

  const renderCb = () => {
    main.innerHTML = "";

    // ── Random Mix quick-launch ──
    const randBtn = document.createElement("button");
    randBtn.className = "cbRandomBtn";
    randBtn.innerHTML = `🎲 <strong>Random Mix</strong> — pull from everything`;
    randBtn.onclick = randomMix;
    main.appendChild(randBtn);

    const orDiv = document.createElement("div");
    orDiv.className = "cbOrDivider";
    orDiv.innerHTML = `<span>or build your own</span>`;
    main.appendChild(orDiv);

    // ── Mode toggle ──
    const modeBar = document.createElement("div");
    modeBar.className = "grSectionBar";
    modeBar.style.paddingTop = "8px";
    ["quiz","exam"].forEach(m => {
      const chip = document.createElement("button");
      chip.className = "grSectionChip" + (cbState.mode === m ? " active" : "");
      chip.textContent = m === "quiz" ? "📝 Quiz Mode" : "⏱️ Timed Exam";
      chip.onclick = () => { cbState.mode = m; save(); renderCb(); };
      modeBar.appendChild(chip);
    });
    main.appendChild(modeBar);

    // ── Count stepper ──
    const countRow = document.createElement("div");
    countRow.className = "cbCountRow";
    countRow.innerHTML = `<span>Questions:</span>`;
    [10,20,30,50,75,100].forEach(n => {
      const chip = document.createElement("button");
      chip.className = "grSectionChip" + (cbState.count === n ? " active" : "");
      chip.textContent = n;
      chip.onclick = () => { cbState.count = n; save(); renderCb(); };
      countRow.appendChild(chip);
    });
    main.appendChild(countRow);

    // ── helper: render a source group ──
    const addGroup = (icon, label, items) => {
      // items: [{key, title, qc}]
      if (!items.length) return;
      const allKeys = items.map(i => i.key);
      const allSelected = allKeys.every(k => cbState.selectedKeys.includes(k));

      const hdrRow = document.createElement("div");
      hdrRow.className = "cbGroupHdr";
      hdrRow.innerHTML = `<span class="modeGroupHdr" style="margin:0">${icon} ${label}</span>`;
      const selAll = document.createElement("button");
      selAll.className = "grSectionChip" + (allSelected ? " active" : "");
      selAll.style.cssText = "font-size:.72rem;padding:4px 10px;";
      selAll.textContent = allSelected ? "Deselect all" : "Select all";
      selAll.onclick = () => selectAll(allKeys);
      hdrRow.appendChild(selAll);
      main.appendChild(hdrRow);

      const list = document.createElement("div");
      list.className = "cbToggleList";
      items.forEach(({key, title, qc}) => {
        const active = cbState.selectedKeys.includes(key);
        const card = document.createElement("button");
        card.className = "cbToggleCard" + (active ? " active" : "");
        card.innerHTML = `<span class="cbToggleIcon">${active ? "✅" : "⬜"}</span><span class="cbToggleText">${title}<span class="cbToggleMeta">${qc} Qs</span></span>`;
        card.onclick = () => toggle(key);
        list.appendChild(card);
      });
      main.appendChild(list);
    };

    // ── GR subtopics ──
    const grItems = [];
    Object.entries(DATA.sections || {}).forEach(([sk, sd]) => {
      (sd.subtopics || []).forEach((sub, si) => {
        const qc = filterQuiz(sub.quiz || [], "content").length;
        if (qc) grItems.push({ key: "gr:" + sk + ":" + si, title: sub.title, qc });
      });
    });
    addGroup("📖", "GR Questions", grItems);

    // ── Stuvia ──
    if (typeof STUVIA_BANK !== "undefined" && STUVIA_BANK.length) {
      const stuviaItems = STUVIA_BANK.map((t, ti) => ({
        key: "stuvia:" + ti,
        title: t.title,
        qc: (t.questions || []).length,
      }));
      addGroup("📚", "Stuvia Bank", stuviaItems);
    }

    // ── Practice Exam pools ──
    const examItems = [];
    Object.entries(DATA.sections || {}).forEach(([sk, sd]) => {
      (sd.exams || []).forEach((ex, ei) => {
        const qc = (ex.questions || []).length;
        if (qc) examItems.push({ key: "exam:" + sk + ":" + ei, title: (ex.title || "Exam " + (ei+1)) + " (" + sd.title + ")", qc });
      });
    });
    addGroup("📋", "Practice Exams", examItems);

    // ── Launch ──
    const total = cbState.selectedKeys.reduce((acc, k) => acc + resolvePool(k).length, 0);
    const nSel = cbState.selectedKeys.length;

    const launchBtn = document.createElement("button");
    launchBtn.className = "primaryBtn";
    launchBtn.style.cssText = "margin:20px auto 32px;display:block;";
    launchBtn.disabled = nSel === 0;
    launchBtn.textContent = nSel
      ? `Launch — ${Math.min(cbState.count, total)} of ${total} Qs (${nSel} source${nSel !== 1 ? "s" : ""})`
      : "Select at least one source";
    launchBtn.onclick = () => {
      let pool = [];
      cbState.selectedKeys.forEach(k => pool.push(...resolvePool(k)));
      pool = shuffle(pool).slice(0, cbState.count);
      if (!pool.length) return;
      if (cbState.mode === "exam") {
        examDeck = pool; examIndex = 0; examScore = 0;
        state.examSource = "custom"; state.examTitle = "Custom Practice";
        state.route = "exam";
      } else {
        quizDeck = pool;
        state.quizSource = "custom"; state.quizFilter = null;
        state.route = "quiz";
      }
      render();
    };
    main.appendChild(launchBtn);
  };

  renderCb();
}
/* ══ End new nav functions ══ */

/* ─── STUVIA BANK MENU ─── */
function renderStuviaMenu(main) {
  // STUVIA_BANK is expected to be a global array defined in stuvia.js (to be added)
  // Shape: [ { title: "Topic Name", questions: [ {question, options:[], correct, explanation?} ] } ]
  const bank = (typeof STUVIA_BANK !== "undefined" && Array.isArray(STUVIA_BANK)) ? STUVIA_BANK : null;

  if (!bank || bank.length === 0) {
    const msg = document.createElement("p");
    msg.className = "comingSoonMsg";
    msg.style.cssText = "margin-top:32px;text-align:center;font-size:1rem;";
    msg.textContent = "Stuvia question bank coming soon — check back after upload.";
    main.appendChild(msg);
    return;
  }

  const list = document.createElement("div");
  list.className = "modeList";

  // ── All topics at once ──
  const hdrAll = document.createElement("div");
  hdrAll.className = "modeGroupHdr";
  hdrAll.textContent = "Full Bank";
  list.appendChild(hdrAll);

  const allBtn = document.createElement("button");
  allBtn.className = "modeBtn";
  const totalQ = bank.reduce((a, t) => a + (t.questions || []).length, 0);
  const allBest = progressState.quizzes && progressState.quizzes["stuvia:" + state.sectionKey + ":all"];
  const allBestTxt = allBest ? ` · Best ${allBest.score}/${allBest.total}` : "";
  allBtn.innerHTML = `<span class="modeIcon">📚</span><span class="modeLabel">All Questions</span><span class="modeMeta">${totalQ} questions${allBestTxt}</span>`;
  allBtn.onclick = () => {
    let pool = [];
    bank.forEach(t => pool.push(...(t.questions || [])));
    quizDeck = shuffle([...pool]);
    state.quizSource = "stuvia";
    state.quizDeckKey = "stuvia:" + state.sectionKey + ":all";
    state.prevRoute = "stuviaMenu";
    state.route = "quiz";
    render();
  };
  list.appendChild(allBtn);

  // ── By topic ──
  if (bank.length > 1) {
    const hdrT = document.createElement("div");
    hdrT.className = "modeGroupHdr";
    hdrT.textContent = "By Topic";
    list.appendChild(hdrT);

    bank.forEach((topic, ti) => {
      const btn = document.createElement("button");
      btn.className = "modeBtn";
      const qc = (topic.questions || []).length;
      const key = "stuvia:" + state.sectionKey + ":" + ti;
      const best = progressState.quizzes && progressState.quizzes[key];
      const bestTxt = best ? ` · Best ${best.score}/${best.total}` : "";
      btn.innerHTML = `<span class="modeIcon">📄</span><span class="modeLabel">${topic.title}</span><span class="modeMeta">${qc} Qs${bestTxt}</span>`;
      btn.onclick = () => {
        quizDeck = shuffle([...(topic.questions || [])]);
        state.quizSource = "stuvia";
        state.quizDeckKey = "stuvia:" + state.sectionKey + ":" + ti;
        state.prevRoute = "stuviaMenu";
        state.route = "quiz";
        render();
      };
      list.appendChild(btn);
    });
  }

  main.appendChild(list);
}
/* ══ End Stuvia ══ */

/* ══ Claude Bank menu — extra Claude-written questions, by system ══ */
function renderClaudeMenu(main) {
  const bank = (typeof CLAUDEBANK !== "undefined" && Array.isArray(CLAUDEBANK)) ? CLAUDEBANK : null;
  if (!bank || bank.length === 0) {
    const msg = document.createElement("p");
    msg.className = "comingSoonMsg";
    msg.style.cssText = "margin-top:32px;text-align:center;font-size:1rem;";
    msg.textContent = "Claude Bank not available for this section.";
    main.appendChild(msg);
    return;
  }
  // strip "A. " letter prefixes so options display cleanly
  const clean = (qs) => qs.map(q => ({ ...q, options: (q.options || []).map(o => o.replace(/^[A-E]\.\s*/, "")) }));
  const nameOf = (t) => (t || "").replace(/^ClaudeBank:\s*/, "");

  const list = document.createElement("div");
  list.className = "modeList";

  // Full bank
  const hdrAll = document.createElement("div");
  hdrAll.className = "modeGroupHdr";
  hdrAll.textContent = "Full Bank";
  list.appendChild(hdrAll);

  const totalQ = bank.reduce((a, t) => a + (t.questions || []).length, 0);
  const allBest = progressState.quizzes && progressState.quizzes["cb:" + state.sectionKey + ":all"];
  const allBtn = document.createElement("button");
  allBtn.className = "modeBtn";
  allBtn.innerHTML = `<span class="modeIcon">🤖</span><span class="modeLabel">All Questions</span><span class="modeMeta">${totalQ} questions${allBest ? ` · Best ${allBest.score}/${allBest.total}` : ""}</span>`;
  allBtn.onclick = () => {
    let pool = [];
    bank.forEach(t => pool.push(...clean(t.questions || [])));
    quizDeck = shuffle([...pool]);
    state.quizSource = "claude";
    state.quizDeckKey = "cb:" + state.sectionKey + ":all";
    state.prevRoute = "claudeMenu";
    state.route = "quiz";
    render();
  };
  list.appendChild(allBtn);

  // By system
  const hdrT = document.createElement("div");
  hdrT.className = "modeGroupHdr";
  hdrT.textContent = "By System";
  list.appendChild(hdrT);

  bank.forEach((topic, ti) => {
    const qc = (topic.questions || []).length;
    const key = "cb:" + state.sectionKey + ":" + ti;
    const best = progressState.quizzes && progressState.quizzes[key];
    const btn = document.createElement("button");
    btn.className = "modeBtn";
    btn.innerHTML = `<span class="modeIcon">🧠</span><span class="modeLabel">${nameOf(topic.title)}</span><span class="modeMeta">${qc} Qs${best ? ` · Best ${best.score}/${best.total}` : ""}</span>`;
    btn.onclick = () => {
      quizDeck = shuffle([...clean(topic.questions || [])]);
      state.quizSource = "claude";
      state.quizDeckKey = key;
      state.prevRoute = "claudeMenu";
      state.route = "quiz";
      render();
    };
    list.appendChild(btn);
  });

  main.appendChild(list);
}
/* ══ End Claude Bank ══ */

/* ═══════════════════════════════════════════════════════════
   FULL 100-MINUTE EXAM — added 2026-07
   ═══════════════════════════════════════════════════════════ */

function fmtTime(secs) {
  const m = Math.floor(secs / 60), s = secs % 60;
  return `${m}:${String(s).padStart(2,'0')}`;
}

function renderFullExam(main) {
  if (!fullExamDeck.length) { state.route = "examMenu"; render(); return; }
  const total = fullExamDeck.length;
  const q = fullExamDeck[fullExamIndex];

  // ── Notes mode gate (once per launch, before the clock starts) ──
  if (!fullExamModeSet) {
    const wrap = document.createElement("div");
    wrap.style.cssText = "max-width:460px;margin:40px auto 0;text-align:center;padding:0 16px;";
    wrap.innerHTML = `
      <div style="font-size:2rem;margin-bottom:6px;">🎯</div>
      <div style="font-weight:800;font-size:1.15rem;color:var(--navy,#1F3864);margin-bottom:4px;">Before you start…</div>
      <div style="color:#666;font-size:.92rem;margin-bottom:22px;">Are you using your notes for this exam? This keeps your <b>true (closed-book)</b> score separate from your <b>with-notes</b> score — both feed your Preparedness stats.</div>`;
    const mk = (label, sub, mode, bg) => {
      const b = document.createElement("button");
      b.style.cssText = `display:block;width:100%;margin:10px 0;background:${bg};color:#fff;border:none;border-radius:12px;padding:14px;font-size:1rem;font-weight:700;cursor:pointer;`;
      b.innerHTML = `${label}<div style="font-weight:400;font-size:.78rem;opacity:.9;margin-top:2px;">${sub}</div>`;
      b.onclick = () => { setStudyMode(mode); fullExamModeSet = true; render(); };
      return b;
    };
    wrap.appendChild(mk("🧠 Closed-book", "No notes — my true recall", "closed", "#1F3864"));
    wrap.appendChild(mk("📖 Open-book", "Using my notes", "open", "#2E74B5"));
    main.appendChild(wrap);
    return;
  }

  // ── Start timer if not already running ──
  if (!fullExamTimerInterval) {
    fullExamTimerInterval = setInterval(() => {
      fullExamSecondsLeft--;
      const el = document.getElementById("feTimer");
      if (el) {
        el.textContent = fmtTime(fullExamSecondsLeft);
        el.className = "feTimer" + (fullExamSecondsLeft < 300 ? " urgent" : "");
      }
      if (fullExamSecondsLeft <= 0) {
        clearInterval(fullExamTimerInterval); fullExamTimerInterval = null;
        state.route = "fullExamEnd"; render();
      }
    }, 1000);
  }

  // ── Overview panel (modal-style) ──
  if (fullExamShowOverview) {
    const ov = document.createElement("div");
    ov.className = "feOverlayWrap";

    const answeredN = fullExamAnswers.filter(a => a !== -1).length;
    const unansweredN = total - answeredN;
    const flaggedN = fullExamFlags.size;

    const ovHdr = document.createElement("div");
    ovHdr.className = "feOverlayHdr";
    ovHdr.innerHTML = `<span>${fullExamReachedEnd ? "Review &amp; submit" : "Question Overview"}</span><button class="feOverlayClose" onclick="fullExamShowOverview=false;render()">✕</button>`;
    ov.appendChild(ovHdr);

    if (fullExamReachedEnd) {
      const note = document.createElement("div");
      note.style.cssText = "font-size:.85rem;color:#666;margin:0 0 8px;line-height:1.4;";
      note.innerHTML = `You've reached the end. Jump back to anything <b>unanswered</b> or <b>flagged</b> below, then submit.`;
      ov.appendChild(note);
    }

    // Filter chips
    const chips = document.createElement("div");
    chips.style.cssText = "display:flex;gap:8px;margin:2px 0 10px;flex-wrap:wrap;";
    [["all", `All ${total}`], ["unanswered", `Unanswered ${unansweredN}`], ["flagged", `Flagged ${flaggedN}`]].forEach(([key, lbl]) => {
      const c = document.createElement("button");
      const on = fullExamOvFilter === key;
      c.textContent = lbl;
      c.style.cssText = `border:1.5px solid ${on ? "#1F3864" : "#cfd8e3"};background:${on ? "#1F3864" : "#fff"};color:${on ? "#fff" : "#41506a"};border-radius:999px;padding:6px 14px;font-size:.82rem;font-weight:700;cursor:pointer;`;
      c.onclick = () => { fullExamOvFilter = key; render(); };
      chips.appendChild(c);
    });
    ov.appendChild(chips);

    const legend = document.createElement("div");
    legend.className = "feLegend";
    legend.innerHTML = `<span class="feDot answered"></span>Answered <span class="feDot flagged"></span>Flagged <span class="feDot unanswered"></span>Unanswered`;
    ov.appendChild(legend);

    const grid = document.createElement("div");
    grid.className = "feGrid";
    let shown = 0;
    for (let i = 0; i < total; i++) {
      const isFlagged = fullExamFlags.has(i);
      const isAnswered = fullExamAnswers[i] !== -1;
      if (fullExamOvFilter === "unanswered" && isAnswered) continue;
      if (fullExamOvFilter === "flagged" && !isFlagged) continue;
      shown++;
      const cell = document.createElement("button");
      cell.className = "feGridCell" + (i === fullExamIndex ? " current" : "") + (isFlagged ? " flagged" : isAnswered ? " answered" : " unanswered");
      cell.textContent = i + 1;
      cell.onclick = () => { fullExamIndex = i; fullExamShowOverview = false; render(); };
      grid.appendChild(cell);
    }
    if (shown === 0) {
      const empty = document.createElement("div");
      empty.style.cssText = "color:#888;font-size:.9rem;padding:14px;text-align:center;";
      empty.textContent = fullExamOvFilter === "unanswered" ? "🎉 Nothing unanswered." : "No flagged questions.";
      ov.appendChild(empty);
    }
    ov.appendChild(grid);

    const answered = fullExamAnswers.filter(a => a !== -1).length;
    const flagged = fullExamFlags.size;
    const ovStat = document.createElement("p");
    ovStat.className = "feOverlayStat";
    ovStat.textContent = `${answered}/${total} answered · ${flagged} flagged · ${total - answered} remaining`;
    ov.appendChild(ovStat);

    const submitBtn = document.createElement("button");
    submitBtn.className = "primaryBtn";
    submitBtn.style.margin = "12px 0 0";
    submitBtn.textContent = "Submit Exam";
    submitBtn.onclick = () => {
      if (confirm(`Submit exam? ${total - answered} question${total - answered !== 1 ? 's' : ''} unanswered.`)) {
        clearInterval(fullExamTimerInterval); fullExamTimerInterval = null;
        state.route = "fullExamEnd"; render();
      }
    };
    ov.appendChild(submitBtn);
    main.appendChild(ov);
    return;
  }

  // ── Top status bar ──
  const statusBar = document.createElement("div");
  statusBar.className = "feStatusBar";
  statusBar.innerHTML = `
    <span class="feQNum">Q${fullExamIndex + 1} <span class="feQTotal">/ ${total}</span></span>
    <span id="feTimer" class="feTimer">${fmtTime(fullExamSecondsLeft)}</span>
    <button class="feFlagBtn${fullExamFlags.has(fullExamIndex) ? " flagged" : ""}" onclick="fullExamFlags.has(${fullExamIndex})?fullExamFlags.delete(${fullExamIndex}):fullExamFlags.add(${fullExamIndex});render()">
      ${fullExamFlags.has(fullExamIndex) ? "⚑ Flagged" : "⚐ Flag"}
    </button>`;
  main.appendChild(statusBar);

  // ── Progress strip ──
  const prog = document.createElement("div");
  prog.className = "feProgBar";
  const answered = fullExamAnswers.filter(a => a !== -1).length;
  prog.innerHTML = `<div class="feProgFill" style="width:${(answered/total*100).toFixed(1)}%"></div>`;
  main.appendChild(prog);

  // ── Question ──
  const qCard = document.createElement("div");
  qCard.className = "feQCard";
  const qText = document.createElement("p");
  qText.className = "feQText";
  qText.textContent = q.q || q.question;
  qCard.appendChild(qText);

  const LETTERS = ["A","B","C","D","E"];
  const feSOpts = (fullExamShuffledOrders[fullExamIndex]) || (q.options || []);
  feSOpts.forEach((opt, i) => {
    const origIdx = (q.options || []).indexOf(opt);
    const isSelected = fullExamAnswers[fullExamIndex] === origIdx;
    const btn = document.createElement("button");
    btn.className = "feOptBtn" + (isSelected ? " selected" : "");
    btn.innerHTML = `<span class="feOptLetter">${LETTERS[i]}</span><span class="feOptText">${opt}</span>`;
    btn.onclick = () => {
      const old = fullExamAnswers[fullExamIndex];
      const newVal = isSelected ? -1 : origIdx;
      // Track a genuine answer CHANGE (had an answer, switched to a different one) — the
      // second-guessing signal: right→wrong vs wrong→right vs wrong→wrong.
      if (old !== -1 && newVal !== -1 && old !== newVal) {
        const oc = old === q.correct, nc = newVal === q.correct;
        if (oc && !nc) fullExamChanges.r2w++;
        else if (!oc && nc) fullExamChanges.w2r++;
        else if (!oc && !nc) fullExamChanges.w2w++;
      }
      fullExamAnswers[fullExamIndex] = newVal; // store original index
      render();
    };
    qCard.appendChild(btn);
  });
  main.appendChild(qCard);

  // Report-a-question link (saved + synced for review)
  const repRow = document.createElement("div");
  repRow.style.cssText = "text-align:right;padding:2px 16px 0;";
  repRow.appendChild(reportBtn(q));
  main.appendChild(repRow);

  // ── Navigation ──
  const isLast = fullExamIndex === total - 1;
  const answeredCur = fullExamAnswers[fullExamIndex] !== -1;

  // Reaching the end (after answering / skipping the last question) opens the Overview so you can
  // sweep unanswered + flagged before submitting.
  const goToEnd = () => {
    fullExamReachedEnd = true;
    fullExamShowOverview = true;
    fullExamOvFilter = fullExamAnswers.some(a => a === -1) ? "unanswered" : "all";
    render();
  };

  const nav = document.createElement("div");
  nav.className = "feNav";

  const prevBtn = document.createElement("button");
  prevBtn.className = "feNavBtn";
  prevBtn.disabled = fullExamIndex === 0;
  prevBtn.innerHTML = "← Prev";
  prevBtn.onclick = () => { fullExamIndex--; render(); };

  const ovBtn = document.createElement("button");
  ovBtn.className = "feNavBtn overview";
  ovBtn.textContent = "☰ Overview";
  ovBtn.onclick = () => { fullExamShowOverview = true; render(); };

  // Next is only available once the current question is answered (otherwise use Skip).
  const nextBtn = document.createElement("button");
  nextBtn.className = "feNavBtn next";
  nextBtn.textContent = isLast ? "Review →" : "Next →";
  nextBtn.disabled = !answeredCur;
  nextBtn.style.opacity = answeredCur ? "1" : "0.45";
  nextBtn.style.cursor = answeredCur ? "pointer" : "not-allowed";
  nextBtn.onclick = () => { if (!answeredCur) return; if (isLast) goToEnd(); else { fullExamIndex++; render(); } };

  nav.append(prevBtn, ovBtn, nextBtn);
  main.appendChild(nav);

  // Big Skip button underneath — the way to move on WITHOUT answering.
  const skipBtn = document.createElement("button");
  skipBtn.textContent = isLast ? "Skip → review" : "Skip →";
  skipBtn.style.cssText = "display:block;width:calc(100% - 32px);margin:10px 16px 4px;background:#0f5132;color:#fff;border:none;border-radius:12px;padding:16px;font-size:1.05rem;font-weight:800;cursor:pointer;letter-spacing:.02em;";
  skipBtn.onclick = () => { if (isLast) goToEnd(); else { fullExamIndex++; render(); } };
  main.appendChild(skipBtn);
}

/* ─── FULL EXAM END SCREEN ─── */
function renderFullExamEnd(main) {
  clearInterval(fullExamTimerInterval); fullExamTimerInterval = null;
  if (!fullExamDeck.length) { state.route = "examMenu"; render(); return; }

  const total = fullExamDeck.length;
  let correct = 0;
  fullExamDeck.forEach((q, i) => {
    const ans = fullExamAnswers[i];
    if (ans === q.correct) correct++;
    if (ans !== -1) recordQuestionStat(q, ans === q.correct); // per-question stats for answered items
  });
  const pct = Math.round(correct / total * 100);

  // Save result + full attempt to the unified History log
  recordQuizResult("fullExam:" + state.sectionKey, correct, total);
  {
    const LET = ["A","B","C","D","E"];
    const missedForLog = fullExamDeck
      .map((q, i) => ({ q, i, sel: fullExamAnswers[i] }))
      .filter(e => e.sel !== e.q.correct)
      .map(e => ({
        q: e.q.q || e.q.question,
        correct: e.q.options[e.q.correct],
        yours: e.sel === -1 ? "— Skipped" : e.q.options[e.sel]
      }));
    // Flag outcomes: did flagging correlate with getting it wrong?
    let fRight = 0, fWrong = 0;
    fullExamFlags.forEach(idx => { const a = fullExamAnswers[idx]; if (a === fullExamDeck[idx].correct) fRight++; else fWrong++; });
    recordAttempt("fullExam:" + state.sectionKey, {
      title: state.examTitle || "Simulation", kind: "mock",
      mode: (typeof getStudyMode === "function" ? getStudyMode() : "closed"),
      score: correct, total, pct, missed: missedForLog,
      changes: { r2w: fullExamChanges.r2w, w2r: fullExamChanges.w2r, w2w: fullExamChanges.w2w },
      flags: { total: fullExamFlags.size, right: fRight, wrong: fWrong }
    });
  }

  // ── Score card ──
  const scoreCard = document.createElement("div");
  scoreCard.className = "feEndCard";
  const grade = pct >= 90 ? "🏆" : pct >= 80 ? "🎯" : pct >= 70 ? "📈" : pct >= 60 ? "📚" : "💪";
  scoreCard.innerHTML = `
    <div class="feEndGrade">${grade}</div>
    <div class="feEndScore">${correct} / ${total}</div>
    <div class="feEndPct">${pct}%</div>
    <div class="feEndLabel">${pct >= 70 ? "Passing" : "Keep studying"}</div>`;
  main.appendChild(scoreCard);

  // ── Strong/weak breakdown of THIS mock (by exam region + by system) ──
  const _regById = {}, _sysById = {};
  try { const bs = blueprintSources(); Object.keys(bs).forEach(r => bs[r].forEach(o => { _regById[o.id] = r; })); } catch (e) {}
  try { const cs = coverageSources(); Object.keys(cs).forEach(s => cs[s].forEach(id => { _sysById[id] = s; })); } catch (e) {}
  const tallyBy = (mapObj) => {
    const t = {};
    fullExamDeck.forEach((q, i) => { const k = mapObj[q.id]; if (!k) return; (t[k] = t[k] || { c: 0, n: 0 }); t[k].n++; if (fullExamAnswers[i] === q.correct) t[k].c++; });
    return t;
  };
  const renderBreak = (title, tallyObj, minN) => {
    const keys = Object.keys(tallyObj).filter(k => tallyObj[k].n >= minN);
    if (keys.length < 1) return;
    keys.sort((a, b) => (tallyObj[a].c / tallyObj[a].n) - (tallyObj[b].c / tallyObj[b].n)); // weakest first
    const hdr = document.createElement("div"); hdr.className = "modeGroupHdr"; hdr.style.marginTop = "18px"; hdr.textContent = title;
    main.appendChild(hdr);
    const wrap = document.createElement("div"); wrap.style.cssText = "padding:0 4px;";
    keys.forEach(k => {
      const o = tallyObj[k], p = Math.round(o.c / o.n * 100), col = _prepBandColor(p);
      const row = document.createElement("div"); row.style.cssText = "margin:8px 0;";
      row.innerHTML = `<div style="display:flex;justify-content:space-between;font-size:.9rem;margin-bottom:3px;">
          <span style="font-weight:700;">${k}</span><span style="color:${col};font-weight:700;">${p}% · ${o.c}/${o.n}</span></div>
        <div style="height:9px;background:#ececec;border-radius:5px;overflow:hidden;"><div style="height:100%;width:${p}%;background:${col};border-radius:5px;"></div></div>`;
      wrap.appendChild(row);
    });
    main.appendChild(wrap);
  };
  const regT = tallyBy(_regById), sysT = tallyBy(_sysById);
  if (Object.keys(regT).length > 1) renderBreak("By exam region", regT, 1);
  renderBreak("By system — your strong & weak spots", sysT, 3);

  // ── Missed questions review ──
  const wrong = fullExamDeck
    .map((q, i) => ({ q, i, selected: fullExamAnswers[i] }))
    .filter(e => e.selected !== e.q.correct);

  if (wrong.length) {
    const missHdr = document.createElement("div");
    missHdr.className = "modeGroupHdr";
    missHdr.style.marginTop = "20px";
    missHdr.textContent = `Missed Questions (${wrong.length})`;
    main.appendChild(missHdr);

    wrong.forEach(({ q, i, selected }) => {
      const row = document.createElement("div");
      row.className = "feReviewRow";
      const LETTERS = ["A","B","C","D","E"];
      row.innerHTML = `
        <p class="feReviewQ"><strong>Q${i+1}.</strong> ${q.q || q.question}</p>
        <p class="feReviewYours">Your answer: <span class="incorrect">${selected === -1 ? "Skipped" : q.options[selected]}</span></p>
        <p class="feReviewCorrect">Correct: <span class="correct">${q.options[q.correct]}</span></p>
        ${q.explanation ? `<p class="feReviewExpl">${q.explanation}</p>` : ""}`;
      main.appendChild(row);
    });
  }

  // ── Buttons ──
  const btnRow = document.createElement("div");
  btnRow.className = "sdBtnRow";
  btnRow.style.marginTop = "24px";

  const retakeBtn = document.createElement("button");
  retakeBtn.className = "primaryBtn";
  retakeBtn.textContent = "Retake Simulation";
  retakeBtn.onclick = () => {
    fullExamIndex = 0;
    fullExamAnswers = new Array(fullExamDeck.length).fill(-1);
    fullExamFlags = new Set();
    fullExamSecondsLeft = 6000;
    fullExamShowOverview = false;
    clearInterval(fullExamTimerInterval); fullExamTimerInterval = null;
    state.route = "fullExam"; render();
  };

  const backBtn = document.createElement("button");
  backBtn.className = "secondaryBtn";
  backBtn.textContent = "Back";
  backBtn.onclick = () => { fullExamDeck = []; state.route = "examMenu"; render(); };

  btnRow.append(retakeBtn, backBtn);
  main.appendChild(btnRow);
}
/* ══ End Full Exam ══ */
