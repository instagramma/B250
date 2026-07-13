// BIOL 250 Study App — vanilla JS, no build step, works fully offline.

/* Classify a question as a diagram/labeling item (tied to a worksheet image)
   vs. a plain content question. Used to keep Diagrams and Q&A cleanly separate. */
const DIAGRAM_RE = /label\s+[A-Z]\b|indicated by|identify the structure|structure\(s\)\s+(indicated|labeled)|labeled\s+[A-Z]\b/i;
function isDiagramQ(q) {
  return !!(q && q.images && q.images.length) || (q && DIAGRAM_RE.test(q.q || ""));
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
let _tbIdf = null, _tbLow = null;
function tbBuildIndex() {
  if (_tbIdf) return;
  _tbIdf = Object.create(null);
  _tbLow = new Array(TEXTBOOK.length);
  const N = TEXTBOOK.length;
  for (let i = 0; i < N; i++) {
    const low = TEXTBOOK[i][1].toLowerCase();
    _tbLow[i] = low;
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
  let best = null, bestScore = 0;
  for (let i = 0; i < TEXTBOOK.length; i++) {
    const low = _tbLow[i];
    let score = 0;
    for (const w in weights) if (low.includes(w)) score += weights[w];
    if (ansPhrase && ansPhrase.length > 3 && low.includes(ansPhrase)) score += 25; // exact answer phrase
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
const SUPABASE_URL = "YOUR_SUPABASE_URL";
const SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY";

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

function loadMissedQs() {
  try { return JSON.parse(localStorage.getItem(MISSED_KEY)) || []; } catch(e) { return []; }
}
function saveMissedQs(arr) {
  try { localStorage.setItem(MISSED_KEY, JSON.stringify(arr)); } catch(e) {}
}
function recordMissedQs(answerLog) {
  const pool = loadMissedQs();
  const existingKeys = new Set(pool.map(m => m.q.slice(0, 80)));
  let changed = false;
  answerLog.forEach(entry => {
    if (entry.timedOut || entry.selected !== entry.correct) {
      const key = entry.q.q.slice(0, 80);
      if (!existingKeys.has(key)) {
        pool.push({ q: entry.q.q, options: entry.q.options, correct: entry.q.correct, tf: entry.q.tf || false });
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
    const raw = localStorage.getItem(PROGRESS_KEY);
    return raw ? JSON.parse(raw) : { flashcards: {}, quizzes: {} };
  } catch (e) { return { flashcards: {}, quizzes: {} }; }
}
function saveLocalProgress() {
  try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(progressState)); } catch (e) {}
}
function saveResumeState() {
  try {
    if (["home", "login", "loading"].includes(state.route)) {
      localStorage.removeItem(RESUME_KEY);
      return;
    }
    const snapshot = {
      state: { ...state },
      quiz: { quizDeck, quizIndex, quizScore, quizSkipped, quizAnswered, quizSelected },
      ws: { wsDeck, wsIndex, wsScore, wsTotalPoints, wsSkippedPoints, wsAnswered, wsSelected, lblItemIndex, lblAssignments, lblSelectedChip, lblChecked },
      fc: { fcDeck, fcIndex, fcFlipped, fcKnown, fcUnknown },
      lab: { labDeck, labIndex, labScore, labTotalBlanks, labSkippedBlanks, lblItemIndex, lblAssignments, lblSelectedChip, lblChecked },
    };
    localStorage.setItem(RESUME_KEY, JSON.stringify(snapshot));
  } catch (e) {}
}
function restoreResumeState() {
  try {
    const raw = localStorage.getItem(RESUME_KEY);
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

async function initApp() {
  progressState = loadLocalProgress();
  if (!CLOUD_ENABLED) {
    if (!restoreResumeState()) state.route = "home";
    render();
    return;
  }
  state.route = "loading";
  render();
  const { data } = await sb.auth.getSession();
  if (data.session) {
    authUser = data.session.user;
    await loadProgress();
    if (!restoreResumeState()) state.route = "home";
  } else {
    state.route = "login";
  }
  render();
  sb.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") {
      authUser = null;
      progressState = loadLocalProgress();
      state.route = "login"; state.sectionKey = null;
      render();
    }
  });
}

async function loadProgress() {
  const { data, error } = await sb.from("progress").select("data").eq("user_id", authUser.id).maybeSingle();
  progressState = (!error && data && data.data) ? data.data : loadLocalProgress();
}

async function saveProgress() {
  if (!CLOUD_ENABLED || !authUser) return;
  await sb.from("progress").upsert({ user_id: authUser.id, data: progressState });
}

function recordQuizResult(key, score, total) {
  const pct = Math.round((score / total) * 100);
  const prev = progressState.quizzes[key];
  progressState.quizzes[key] = {
    lastScore: pct,
    attempts: (prev ? prev.attempts : 0) + 1,
    bestScore: prev ? Math.max(prev.bestScore, pct) : pct,
    lastDate: new Date().toISOString(),
  };
  saveLocalProgress();
  saveProgress();
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

const state = { route: "home", sectionKey: null, mode: null, subtopicIndex: null, cameFromSubtopics: false, quizFilter: null, quizSource: null, cbIndex: -1, examSource: null };

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
  else if (state.route === "home") renderHome(main);
  else if (state.route === "modes") renderModes(main);
  else if (state.route === "flashcards") renderFlashcards(main);
  else if (state.route === "quiz") renderQuiz(main);
  else if (state.route === "gallery") renderGallery(main);
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

  saveResumeState();
}

function buildTopbar() {
  const bar = document.createElement("div");
  bar.className = "topbar";
  const left = document.createElement("div");
  left.style.display = "flex";
  left.style.alignItems = "center";

  const noBackRoutes = ["home", "login", "loading"];
  if (!noBackRoutes.includes(state.route)) {
    const back = document.createElement("button");
    back.className = "backBtn";
    back.textContent = "‹ Back";
    back.onclick = () => {
      if (state.route === "modes") { state.route = "home"; state.sectionKey = null; }
      else if (state.route === "subtopics") { state.route = "modes"; state.mode = null; }
      else if (state.route === "quiz" && state.quizSource === "claudebank") {
        state.route = "cbPicker"; quizDeck = []; state.quizSource = null; state.cbIndex = -1;
      } else if (state.route === "cbPicker") {
        state.route = "modes";
      } else if (state.route === "quiz" && state.cameFromSubtopics) {
        state.route = "subtopics"; quizDeck = []; state.subtopicIndex = null; state.cameFromSubtopics = false;
      } else if (state.route === "worksheet") {
        state.route = "modes"; wsDeck = []; state.mode = null;
      } else if (state.route === "examPicker") {
        state.route = "modes"; state.mode = null;
      } else if (state.route === "simPicker") {
        state.route = "modes"; state.mode = null;
      } else if (state.route === "simExam") {
        simStopTimer(); state.route = "simPicker";
      } else if (state.route === "simReview") {
        state.route = "simExam"; // back to exam, keep timer running
      } else if (state.route === "missedReview") {
        missedDeck = []; state.route = "modes";
      } else if (state.route === "exam" || state.route === "examResults") {
        examStopTimer();
        if (state.examSource === "gr") { state.examSource = null; state.route = "modes"; }
        else { state.route = "examPicker"; }
      } else { state.route = "modes"; state.mode = null; state.subtopicIndex = null; state.cameFromSubtopics = false; }
      render();
    };
    left.appendChild(back);
  }
  const h1 = document.createElement("h1");
  let titleText;
  if (noBackRoutes.includes(state.route)) titleText = "BIOL 250 Study";
  else if (state.route === "cbPicker") {
    titleText = "ClaudeBank — Pick a Topic";
  } else if (state.route === "quiz" && state.quizSource === "claudebank") {
    titleText = (state.cbIndex >= 0 && typeof CLAUDEBANK !== "undefined" && CLAUDEBANK[state.cbIndex])
      ? CLAUDEBANK[state.cbIndex].title : "ClaudeBank — All Topics";
  } else if (state.route === "quiz" && state.cameFromSubtopics && state.subtopicIndex != null) {
    titleText = getSection(state.sectionKey).subtopics[state.subtopicIndex].title;
  } else if (state.route === "simPicker") {
    titleText = "Simulation — Pick Exam";
  } else if ((state.route === "simExam" || state.route === "simReview") && state.examTitle) {
    titleText = state.examTitle;
  } else if (state.route === "missedReview") {
    titleText = "Missed Questions";
  } else if (state.route === "examPicker") {
    const sec = getSection(state.sectionKey);
    titleText = "Practice Exams" + (sec ? " — " + sec.title : "");
  } else if (state.route === "exam" && state.examSource === "gr") {
    titleText = "Timed GR Questions";
  } else if (state.route === "examResults" && state.examSource === "gr") {
    titleText = "GR Quiz Results";
  } else if ((state.route === "exam" || state.route === "examResults") && state.examTitle) {
    titleText = state.examTitle;
  } else {
    titleText = getSection(state.sectionKey) ? getSection(state.sectionKey).title : "BIOL 250";
  }
  h1.textContent = titleText;
  left.appendChild(h1);
  bar.appendChild(left);

  if (CLOUD_ENABLED && authUser && !noBackRoutes.includes(state.route)) {
    const signOut = document.createElement("button");
    signOut.className = "signOutBtn";
    signOut.textContent = "Sign out";
    signOut.onclick = () => { sb.auth.signOut(); };
    bar.appendChild(signOut);
  } else {
    bar.appendChild(document.createElement("div"));
  }
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

function renderHome(main) {
  const sub = document.createElement("div");
  sub.className = "subtitle";
  sub.textContent = "Choose a lecture unit or a lab unit — or jump into Cumulative for full-course review.";
  main.appendChild(sub);

  const groups = [
    { label: "Lecture", hint: "Regional & systemic anatomy", keys: ["torso", "axial", "appendicular"] },
    { label: "Lab",     hint: "Lab manual, worksheets & practicals", keys: ["lab1", "lab2"] },
  ];

  groups.forEach(group => {
    const hdr = document.createElement("div");
    hdr.className = "homeGroupHdr";
    hdr.innerHTML = `<span class="homeGroupName">${group.label}</span><span class="homeGroupHint">${group.hint}</span>`;
    main.appendChild(hdr);

    const grid = document.createElement("div");
    grid.className = "grid";
    for (const key of group.keys) {
      const s = DATA.sections[key];
      if (!s) continue;
      const card = document.createElement("button");
      card.className = "sectionCard";
      card.innerHTML = `<div class="icon">${ICONS[key]}</div>
        <div class="name">${s.title.split(" (")[0]}</div>
        <div class="meta">${META[key] || ""}</div>
        <div class="cardStats">${s.flashcards.length} cards · ${s.quiz.length} questions</div>`;
      card.onclick = () => { state.sectionKey = key; state.route = "modes"; render(); };
      grid.appendChild(card);
    }
    main.appendChild(grid);
  });

  const cum = document.createElement("button");
  cum.className = "sectionCard cumCard";
  cum.innerHTML = `<div class="icon">${ICONS.cumulative}</div><div class="name">Cumulative — Final Review</div><div class="meta">${META.cumulative}</div>`;
  cum.onclick = () => { state.sectionKey = "cumulative"; state.route = "modes"; render(); };
  cum.style.marginTop = "20px";
  main.appendChild(cum);
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

function renderQuiz(main) {
  // ClaudeBank mode — pull from the CLAUDEBANK global instead of section data
  let sourceQuiz, deckKey;
  if (state.quizSource === "claudebank" && typeof CLAUDEBANK !== "undefined") {
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
  }

  if (quizIndex >= quizDeck.length) {
    if (!quizDeck._saved) {
      quizDeck._saved = true;
      const denom = Math.max(quizDeck.length - quizSkipped, 1);
      recordQuizResult(deckKey, quizScore, denom);
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

  const optsWrap = document.createElement("div");
  optsWrap.className = "options";
  q.options.forEach((opt, i) => {
    const b = document.createElement("button");
    b.className = "option";
    b.textContent = opt;
    if (quizAnswered) {
      b.disabled = true;
      if (i === q.correct) b.className += " correct";
      else if (i === quizSelected) b.className += " incorrect";
    }
    b.onclick = () => {
      if (quizAnswered) return;
      quizAnswered = true;
      quizSelected = i;
      if (i === q.correct) quizScore++;
      render();
    };
    optsWrap.appendChild(b);
  });
  main.appendChild(optsWrap);

  if (quizAnswered) {
    const fb = document.createElement("div");
    fb.className = "feedbackBar";
    const look = document.createElement("button");
    look.className = "tbLookBtn";
    look.innerHTML = "📖 Look it up in Martini";
    look.onclick = () => showTextbookPanel(q.q, q.options[q.correct]);
    fb.appendChild(look);
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
  back.textContent = state.quizSource === "claudebank" ? "Back to ClaudeBank"
    : state.cameFromSubtopics ? "Back to topics" : "Back to modes";
  back.onclick = () => {
    quizDeck = [];
    if (state.quizSource === "claudebank") {
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

/* ================== TIMED EXAM MODE ================== */
let examDeck = [], examIndex = 0, examScore = 0;
let examAnswered = false, examSelected = -1, examTimedOut = false;
let examTimerHandle = null, examTimeLeft = 30;
let examAnswerLog = [];  // [{q, options, selected, correct, timedOut}, ...]
let examExamIndex = 0;   // 0 = Exam 1, 1 = Exam 2
const EXAM_SECONDS = 30;

function examStopTimer() {
  if (examTimerHandle) { clearInterval(examTimerHandle); examTimerHandle = null; }
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
      examAnswerLog.push({ q: examDeck[examIndex], selected: -1, correct: examDeck[examIndex].correct, timedOut: true });
      // Show timed-out state briefly then advance
      const optBtns = document.querySelectorAll(".examOption");
      optBtns.forEach((b, i) => {
        b.disabled = true;
        if (i === examDeck[examIndex].correct) b.classList.add("correct");
      });
      const fb = document.getElementById("examFeedback");
      if (fb) { fb.textContent = "⏰ Time's up!"; fb.style.color = "#c0392b"; }
      setTimeout(() => examAdvance(), 900);
    }
  }, 1000);
}

function examAdvance() {
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

function examSelectAnswer(i) {
  if (examAnswered) return;
  examStopTimer();
  examAnswered = true;
  examSelected = i;
  const q = examDeck[examIndex];
  if (i === q.correct) examScore++;
  examAnswerLog.push({ q, selected: i, correct: q.correct, timedOut: false });
  // Highlight and auto-advance
  const optBtns = document.querySelectorAll(".examOption");
  optBtns.forEach((b, idx) => {
    b.disabled = true;
    if (idx === q.correct) b.classList.add("correct");
    else if (idx === i) b.classList.add("incorrect");
  });
  const fb = document.getElementById("examFeedback");
  if (fb) {
    fb.textContent = i === q.correct ? "✓ Correct!" : "✗ " + q.options[q.correct];
    fb.style.color = i === q.correct ? "#27ae60" : "#c0392b";
  }
  setTimeout(() => examAdvance(), 900);
}

function renderExamPicker(main) {
  const sec = DATA.sections[state.sectionKey];
  const sub = document.createElement("div");
  sub.className = "subtitle";
  sub.textContent = "30 s/question · keys 1–5 = A–E (or 1–2 for True/False) · no skipping";
  main.appendChild(sub);

  // Group exams by their `group` field, preserving order
  const groups = [];
  const groupMap = {};
  sec.exams.forEach((ex, i) => {
    const g = ex.group || "Other";
    if (!groupMap[g]) { groupMap[g] = []; groups.push(g); }
    groupMap[g].push({ ex, i });
  });

  const GROUP_ICONS = {
    "Practice Exams": "📋",
    "Head & Neck": "💀",
    "Spinal": "🦴",
    "Systemic": "🧠",
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
        examDeck = ex.questions;
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
}

function renderExam(main) {
  if (!examDeck.length) { state.route = "examPicker"; render(); return; }

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
  const stem = document.createElement("div");
  stem.className = "qStem";
  stem.textContent = `${examIndex + 1}. ${q.q}`;
  main.appendChild(stem);

  // Keyboard hint
  const hint = document.createElement("div");
  hint.style.cssText = "font-size:0.75rem; color:#aaa; text-align:center; margin:-4px 0 6px;";
  hint.textContent = q.tf ? "Press 1 = True · 2 = False" : `Press 1–${Math.min(q.options.length, 5)} to select (A–E)`;
  main.appendChild(hint);

  const optsWrap = document.createElement("div");
  optsWrap.className = "options";
  const labels = ["A", "B", "C", "D", "E"];
  q.options.forEach((opt, i) => {
    const b = document.createElement("button");
    b.className = "option examOption";
    b.style.cssText = "text-align:left; display:flex; gap:10px; align-items:flex-start;";
    b.innerHTML = `<span style="font-weight:700;min-width:18px;color:var(--accent)">${labels[i]}</span><span>${opt}</span>`;
    b.onclick = () => examSelectAnswer(i);
    optsWrap.appendChild(b);
  });
  main.appendChild(optsWrap);

  // Feedback line (filled in by examSelectAnswer / timer)
  const fb = document.createElement("div");
  fb.id = "examFeedback";
  fb.style.cssText = "min-height:28px; text-align:center; font-weight:600; font-size:1rem; padding:8px 0;";
  main.appendChild(fb);

  // Start the countdown (only if not already answered — guard against re-renders)
  if (!examAnswered) examStartTimer();
}

function renderExamResults(main) {
  examStopTimer();
  const total = examDeck.length;
  const pct = Math.round((examScore / total) * 100);
  const timedOuts = examAnswerLog.filter(e => e.timedOut).length;
  const wrong = examAnswerLog.filter(e => !e.timedOut && e.selected !== e.correct);

  // Record best score (use distinct key for GR timed vs real exam)
  const key = state.examSource === "gr"
    ? "grTimed:" + state.sectionKey
    : "exam:" + state.sectionKey + ":" + examExamIndex;
  recordQuizResult(key, examScore, total);

  // Save full attempt to history (keep last 10)
  if (!progressState.examAttempts) progressState.examAttempts = {};
  if (!progressState.examAttempts[key]) progressState.examAttempts[key] = [];
  const missedForLog = examAnswerLog
    .filter(e => e.timedOut || e.selected !== e.correct)
    .map(e => ({
      q: e.q.q,
      correct: e.q.options[e.q.correct],
      yours: e.timedOut ? "⏰ Timed out" : (e.selected >= 0 ? e.q.options[e.selected] : "—")
    }));
  progressState.examAttempts[key].unshift({
    date: new Date().toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'}),
    score: examScore, total, pct, missed: missedForLog
  });
  if (progressState.examAttempts[key].length > 10) progressState.examAttempts[key].length = 10;
  saveLocalProgress();
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
  backBtn.textContent = state.examSource === "gr" ? "Back to modes" : "Choose a different exam";
  backBtn.onclick = () => {
    if (state.examSource === "gr") { state.examSource = null; state.route = "modes"; }
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
  if (examAnswered) return;
  const num = parseInt(e.key);
  if (isNaN(num) || num < 1) return;
  const idx = num - 1;
  const q = examDeck[examIndex];
  if (!q || idx >= q.options.length) return;
  examSelectAnswer(idx);
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
    examAnswerLog.push({ q, selected, correct: q.correct, timedOut: forced && selected === -1 });
  });
  // Save under "sim:" key so it doesn't mix with timed exam history
  const key = "sim:" + state.sectionKey + ":" + examExamIndex;
  recordQuizResult(key, examScore, simDeck.length);
  if (!progressState.examAttempts) progressState.examAttempts = {};
  if (!progressState.examAttempts[key]) progressState.examAttempts[key] = [];
  const total = simDeck.length;
  const pct = Math.round(examScore / total * 100);
  const missedForLog = examAnswerLog
    .filter(e => e.timedOut || e.selected !== e.correct)
    .map(e => ({
      q: e.q.q,
      correct: e.q.options[e.q.correct],
      yours: e.timedOut ? "⏰ Time's up" : (e.selected >= 0 ? e.q.options[e.selected] : "—")
    }));
  progressState.examAttempts[key].unshift({
    date: new Date().toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'}),
    score: examScore, total, pct, missed: missedForLog
  });
  if (progressState.examAttempts[key].length > 10) progressState.examAttempts[key].length = 10;
  saveLocalProgress();
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
        simDeck = [...ex.questions];
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
