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
/* A few Stuvia items have a duplicated answer option (line-wrap/parse artifact, e.g. ST-0356
   "Urine is formed in the" shows "kidney and bladder." twice). A duplicate makes the item
   ambiguous, so keep them out of scored/adaptive contexts (still fine for flashcard review). */
function hasDupOptions(q) {
  const opts = (q && q.options) || [];
  if (opts.length < 2) return false;
  const seen = new Set();
  for (const o of opts) { const k = String(o).trim().toLowerCase(); if (seen.has(k)) return true; seen.add(k); }
  return false;
}
function isExamEligible(q) { return !!q && !isFITBQ(q) && !hasDupOptions(q) && !OUT_OF_SCOPE_IDS.has(q.id); }
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
let _tbIdf = null, _tbLow = null, _tbProse = null, _tbQual = null, _tbChap = null;
// function words that flow in real prose but are sparse in figure-caption "label salad"
const TB_FUNC = new Set("the of and a to in is that it for as with are this by be on or an which from at not but they these can when into than has have its also such may each within between through during because while where how other some more most less their his her them we you".split(" "));
const TB_REVIEW_RE = /concept check|chapter review|reviewing facts|reviewing concepts|study outline|answers tab|see the blue answers|clinical case|clinical note|level 1|level 2|level 3|checkpoint|related clinical terms|key terms/;
function tbBuildIndex() {
  if (_tbIdf) return;
  _tbIdf = Object.create(null);
  _tbLow = new Array(TEXTBOOK.length);
  _tbProse = new Array(TEXTBOOK.length);
  _tbQual = new Array(TEXTBOOK.length);
  _tbChap = new Array(TEXTBOOK.length);
  const N = TEXTBOOK.length;
  for (let i = 0; i < N; i++) {
    const low = TEXTBOOK[i][1].toLowerCase();
    _tbLow[i] = low;
    _tbChap[i] = (typeof pageToChapter === "function") ? pageToChapter(TEXTBOOK[i][0]) : null;
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
  // Answer-anchoring HURTS when the answer is a generic word (True/False/while/increased/etc.):
  // e.g. an SA-node T/F matched "true acetabulum" (a hip passage). If the answer carries no real
  // anatomical term, ignore it and rank on the question's concept only.
  const GENERIC_ANS = new Set("true false yes no none all both neither each many few increased decreased unchanged while during after before more less higher lower greater smaller normal abnormal same different present absent".split(" "));
  const ansWords = String(answerText || "").toLowerCase().replace(/^(the|a|an)\s+/, "").replace(/[.;,]$/, "").split(/\s+/);
  const ansMeaningful = ansWords.some(w => w.length > 4 && !GENERIC_ANS.has(w));
  if (!ansMeaningful) answerText = "";
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
  let best = null, bestScore = 0, bestIdx = -1;
  for (let i = 0; i < TEXTBOOK.length; i++) {
    const low = _tbLow[i];
    let score = 0;
    for (const w in weights) if (low.includes(w)) score += weights[w];
    if (ansPhrase && ansPhrase.length > 3 && low.includes(ansPhrase)) score += 25; // exact answer phrase
    if (topic && ansPhrase && low.includes(topic) && low.includes(ansPhrase)) score += 20; // answer + question concept together
    // down-weight figure-caption label-salad, tables, and end-of-section review/answer blocks
    score *= (0.2 + 0.8 * _tbQual[i]);
    if (score > bestScore) { bestScore = score; best = { page: TEXTBOOK[i][0], text: TEXTBOOK[i][1] }; bestIdx = i; }
  }
  if (!best || bestScore < 12) return null;
  // Precision guard: if the STEM has a clear concept word but the winning passage doesn't contain
  // it, the match is a spurious answer-word collision (e.g. "SA node" T/F → "true acetabulum").
  // Show NO reference rather than a wrong one.
  if (topic && bestIdx >= 0 && !_tbLow[bestIdx].includes(topic)) return null;
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
/* ═══════════════ CENTRALIZED MARTINI REFERENCE RESOLVER ═══════════════
   One resolver for EVERY Martini citation/popup (quiz, sprint/fuzzy, custom, exams,
   missed analytics, flashcards). Precedence (per audit):
     1. explicit q.ch / q.page
     2. Q_BOOKLOC[q.id] {s: section, p: source page} → hard chapter scope
     3. chapter-scoped explanatory search inside that chapter
     4. unrestricted search ONLY when no metadata exists
     5. else "No verified passage found" (never a weak global match)
   The mapped page is where the question APPEARS; we search its chapter for the best
   explanatory excerpt. The stem's anatomical concept MUST appear; answer words never
   compensate for a missing concept; T/F never searches "True"/"False". */
const TB_GENERIC = new Set("while likely occur occurs occurring true false yes none all both neither each many few any some most more less other following above below increased decreased unchanged higher lower greater smaller normal abnormal same different present absent during after before because usually often always never mostly primarily mainly generally typically approximately about".split(" "));
const TB_ENDMATTER_RE = /\bglossary\b|\bindex\b|\bappendix\b|answers to|answer key|\bcredits\b/;
// consecutive meaningful stem words → 2-word anatomical phrases (e.g. "costal breathing")
function _conceptPhrases(stem) {
  const words = String(stem).toLowerCase().match(/[a-z][a-z\-]{2,}/g) || [];
  const ph = [];
  for (let i = 0; i < words.length - 1; i++) {
    const a = words[i], b = words[i + 1];
    if (!TB_STOP.has(a) && !TB_GENERIC.has(a) && !TB_STOP.has(b) && !TB_GENERIC.has(b)) ph.push(a + " " + b);
  }
  return ph;
}
function _tbIsEndMatter(i) {
  const low = _tbLow[i];
  if (TB_ENDMATTER_RE.test(low)) return true;
  // index-style page: many ", 123" number cross-refs relative to word count
  const numRefs = (low.match(/,\s*\d{2,4}\b/g) || []).length;
  const words = (low.match(/[a-z]+/g) || []).length;
  return words > 25 && numRefs / words > 0.05;
}
// Concept tokens from a stem/assertion — meaningful words only (no stop/generic).
function _tbConcept(stem) {
  return tbTokens(stem).filter(w => w.length > 3 && !TB_GENERIC.has(w));
}
function resolveBookReference(q) {
  const out = { ref: null, page: null, ch: null, locator: null, srcPage: null, srcSec: null, confidence: 0, reason: "no-question", source: "" };
  if (!q || typeof TEXTBOOK === "undefined" || !TEXTBOOK.length) { out.reason = "no-textbook"; return out; }
  tbBuildIndex();
  const stem = String(q.q || q.question || "");
  const isTF = !!q.tf;
  // answer text — NEVER for T/F; ignore generic answers; treat multiword as an exact phrase only
  let ansPhrase = "";
  if (!isTF && typeof q.correct === "number" && q.options && q.options[q.correct] != null) {
    const a = String(q.options[q.correct]).toLowerCase().replace(/^[a-e]\.\s*/, "").replace(/^(the|a|an)\s+/, "").replace(/[.;,]\s*$/, "").trim();
    const GENERIC_FULL = /^(all|none|both|neither) of the (above|answers|following|these)|^none of the answers are correct|^all of these|^n\/a$/;
    const meaningful = a.split(/\s+/).some(w => w.length > 3 && !TB_GENERIC.has(w));
    if (a.length > 3 && meaningful && !GENERIC_FULL.test(a)) ansPhrase = a;
  }
  // 1/2. scope chapter + source page from metadata
  let scopeCh = null, srcPage = null, srcSec = null, source = "";
  if (q.ch) { scopeCh = parseInt(q.ch, 10); srcPage = q.page || null; source = "q.ch"; }
  if ((scopeCh == null || isNaN(scopeCh)) && typeof Q_BOOKLOC !== "undefined" && q.id && Q_BOOKLOC[q.id]) {
    const loc = Q_BOOKLOC[q.id]; srcSec = loc.s || null; srcPage = loc.p || srcPage;
    if (loc.s) scopeCh = parseInt(String(loc.s).split(".")[0], 10);
    if ((scopeCh == null || isNaN(scopeCh)) && loc.p && typeof pageToChapter === "function") scopeCh = pageToChapter(loc.p);
    source = "Q_BOOKLOC";
  }
  if (isNaN(scopeCh)) scopeCh = null;
  out.srcPage = srcPage; out.srcSec = srcSec; out.source = source; out.ch = scopeCh;
  if (scopeCh != null) out.locator = { ch: scopeCh, sec: srcSec, page: srcPage };
  // concept + phrases from the assertion
  const concept = _tbConcept(stem);
  if (!concept.length) { out.reason = "no-concept"; return out; }
  let topic = null, topicIdf = -1;
  concept.forEach(w => { const v = _tbIdf[w] || 0; if (v > topicIdf) { topicIdf = v; topic = w; } });
  const phrases = _conceptPhrases(stem);
  const weights = Object.create(null);
  concept.forEach(w => { weights[w] = (weights[w] || 0) + (_tbIdf[w] || 6); });
  const scan = (restrict) => {
    let best = null, bestScore = 0, bestIdx = -1;
    for (let i = 0; i < TEXTBOOK.length; i++) {
      if (restrict && _tbChap[i] !== scopeCh) continue;
      const low = _tbLow[i];
      if (topic && !low.includes(topic)) continue;   // concept MUST appear
      if (_tbIsEndMatter(i)) continue;                // no glossary/index/answer-key
      let score = 0, hits = 0;
      for (const w in weights) if (low.includes(w)) { score += weights[w]; hits++; }
      if (hits < 1) continue;
      phrases.forEach(p => { if (low.includes(p)) score += 30; });  // exact anatomical phrase (proximity)
      if (ansPhrase && low.includes(ansPhrase)) score += 15;        // exact multiword answer only
      score *= (0.25 + 0.75 * _tbQual[i]);
      if (score > bestScore) { bestScore = score; best = { page: TEXTBOOK[i][0], text: TEXTBOOK[i][1] }; bestIdx = i; }
    }
    return best ? { best, bestScore, bestIdx } : null;
  };
  let r = null, mode = "";
  if (scopeCh != null) { r = scan(true); mode = "chapter-scoped"; }
  else { r = scan(false); mode = "unrestricted"; }
  const MIN = 10;
  if (!r || r.bestScore < MIN) { out.reason = (scopeCh != null) ? "no-verified-passage-in-ch" + scopeCh : "no-verified-passage"; return out; }
  out.ref = { page: r.best.page, text: r.best.text, ansPhrase: ansPhrase, qTok: concept.concat(ansPhrase ? ansPhrase.split(/\s+/) : []) };
  out.page = r.best.page; out.confidence = Math.round(r.bestScore); out.reason = mode;
  return out;
}
/* Regression + Q_BOOKLOC cross-chapter audit (run from console: _auditBookRefs()). */
function _auditBookRefs(sampleN) {
  const idx = (typeof buildQuestionIndex === "function") ? buildQuestionIndex() : {};
  const results = { regressions: [], crossChapter: 0, endMatterRejected: 0, inMappedChapter: 0, totalChecked: 0 };
  const reg = (id, wantCh, wantNotPage) => {
    const q = idx[id]; if (!q) { results.regressions.push({ id, ok: false, note: "missing" }); return; }
    const r = resolveBookReference(Object.assign({}, q, { id: id }));  // id is the index KEY, attach it
    const gotCh = r.page != null ? pageToChapter(r.page) : null;
    results.regressions.push({ id, page: r.page, gotCh, reason: r.reason, confidence: r.confidence, ok: (wantCh == null || gotCh === wantCh) && (!wantNotPage || r.page !== wantNotPage) });
  };
  reg("ST-0133", 24, 555);   // respiratory, not heart p.555
  reg("ST-0933", 22, null);  // arterial valves — Ch 22 not 21
  reg("ST-0318", 25, null);  // esophageal hiatus — Ch 25 not lymphatic 23
  // audit: resolved chapter vs Q_BOOKLOC chapter, on a sample
  const ids = (typeof Q_BOOKLOC !== "undefined") ? Object.keys(Q_BOOKLOC) : [];
  const step = Math.max(1, Math.floor(ids.length / (sampleN || 300)));
  for (let i = 0; i < ids.length; i += step) {
    const id = ids[i], q = idx[id]; if (!q) continue;
    const mapCh = parseInt(String(Q_BOOKLOC[id].s || "").split(".")[0], 10);
    const r = resolveBookReference(Object.assign({}, q, { id: id })); if (!r.page) continue;
    results.totalChecked++;
    const gotCh = pageToChapter(r.page);
    if (gotCh === mapCh) results.inMappedChapter++; else results.crossChapter++;
  }
  results.inMappedPct = results.totalChecked ? Math.round(results.inMappedChapter / results.totalChecked * 100) : 0;
  return results;
}
// Popup: pass a QUESTION object to route through resolveBookReference; the legacy
// (questionText, answerText) form is kept for the glossary/term lookup only.
function showTextbookPanel(question, answerText, qObj) {
  let res = null, locator = null, answerLabel = answerText;
  if (qObj) {
    const R = resolveBookReference(qObj);
    res = R.ref; locator = R.locator;
    if (qObj.tf) answerLabel = (typeof qObj.correct === "number" && qObj.options) ? qObj.options[qObj.correct] : answerText;
  } else {
    res = searchTextbook(question, answerText);
  }
  const overlay = document.createElement("div");
  overlay.className = "tbOverlay";
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  const panel = document.createElement("div");
  panel.className = "tbPanel";
  if (res) {
    panel.innerHTML =
      `<div class="tbHead"><span class="tbBadge">📖 Martini 9e · p. ${res.page}</span>
        <button class="tbClose" aria-label="Close">✕</button></div>
       <div class="tbAnswerLine"><span class="tbAnswerLabel">Answer</span> ${escapeHtml(answerLabel)}</div>
       <div class="tbBody">${highlightPassage(res)}</div>
       <div class="tbFoot">Highlighted from the course textbook · verify against the printed page for figures.
         <button class="pdfLookBtn">📄 View in Annotated PDF</button>
       </div>`;
    panel.querySelector(".pdfLookBtn").onclick = () => openPdfAtPage(res.page + 31);
  } else {
    const loc = locator ? `<div class="tbFoot">Mapped to <b>Ch ${locator.ch}${locator.sec ? " §" + locator.sec : ""}</b>${locator.page ? " · source p. " + locator.page : ""} — but no verified explanatory passage was found for this question.</div>` : "";
    panel.innerHTML =
      `<div class="tbHead"><span class="tbBadge">📖 Martini 9e</span>
        <button class="tbClose" aria-label="Close">✕</button></div>
       <div class="tbAnswerLine"><span class="tbAnswerLabel">Answer</span> ${escapeHtml(answerLabel)}</div>
       <div class="tbBody"><b>No verified passage found.</b> We won't show a weak/global match that could point to the wrong topic.</div>
       ${loc}`;
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
// Add ONE wrong-answered question to the missed pool for a section (and the legacy global
// list). Every practice mode calls this so "Missed Questions" works for everything you take.
function _missKey(q) { return (q && q.id) ? q.id : (q && q.q ? String(q.q).slice(0, 80) : ""); }
function addMissed(q, sectionKey) {
  if (!q || !(q.q || q.question)) return;
  const rec = { id: q.id, q: q.q || q.question, options: q.options, correct: q.correct, tf: q.tf || false };
  const key = _missKey(q); if (!key) return;
  // legacy global list (used by some review entry points)
  const g = loadMissedQs(); if (!g.some(m => _missKey(m) === key)) { g.push(rec); saveMissedQs(g); }
  // section-scoped list (used by the section-menu / exam-menu "Missed Questions" cards)
  const sk = "missed:" + (sectionKey || state.sectionKey);
  try { const s = JSON.parse(localStorage.getItem(ns(sk)) || "[]"); if (!s.some(m => _missKey(m) === key)) { s.push(rec); localStorage.setItem(ns(sk), JSON.stringify(s)); } } catch (e) {}
}
function recordMissedQs(answerLog, sectionKey) {
  (answerLog || []).forEach(entry => {
    if (entry.timedOut || entry.selected !== entry.correct) addMissed(entry.q, sectionKey);
  });
}

/* Missed Review state */
let missedDeck = [], missedIndex = 0, missedAnswered = false, missedSelected = -1;
/* Fuzzy drill state (flip-flop questions — separate from the missed pool, no side effects on it) */
let fuzzyDeck = [], fuzzyIndex = 0, fuzzyAnswered = false, fuzzyStartCount = 0;
let fuzzyRecallRevealed = false;   // for written free-recall items inside a drill/sprint
/* 10-minute Sprint state (rotating weak-area micro-session on the home screen) */
let sprintTimer = null, sprintRot = 0;
/* Lab 2 Model Practical (real class-model photos) — recognition + self-grade stations */
let l2Deck = [], l2Index = 0, l2Revealed = false, l2Timed = false, l2SecLeft = 0, l2Timer = null, l2StartCount = 0;
let l2FirstScored = new Set();   // station ids already scored for FIRST-PASS this round (requeues don't recount)
let l2FirstCorrect = 0;          // first-attempt correct this round (the honest round score)
let l2Recovered = 0;             // got right later on a requeue (recovery — shown separately, doesn't inflate score)
let l2TimedOut = false;          // current station hit the 60s limit → auto-scored as a miss
let l2StationLocked = false;     // true once THIS station's first-pass result is recorded — set the instant
                                  // a timeout fires, so leaving without pressing Next still counts the miss
// Per-station tally now lives in progressState.lab2stations so it SYNCS (own Lab model-readiness metric,
// kept separate from MCQ/diagram readiness). firstDone/firstOk track first-pass accuracy over time.
function loadL2Stats() { return (progressState && progressState.lab2stations) || {}; }
// `first` here means "first attempt THIS ROUND" (requeues within a round don't recount) — kept for the
// per-round first-pass score shown at the end of a practical round. It is NOT the same as "the very first
// time this station has ever been attempted, across every round/device" — that lifetime fact is what real
// readiness needs, so we track it separately as `everSeen`/`trueFirstOk`, set ONCE and never overwritten
// (immutable first-pass — a later correct re-attempt can never retroactively turn a real miss into a hit).
function recordL2(id, ok, first) {
  if (!progressState.lab2stations) progressState.lab2stations = {};
  const e = progressState.lab2stations[id] || { seen: 0, missed: 0, firstDone: 0, firstOk: 0 };
  const lifetimeFirst = !e.everSeen;
  e.seen++; if (!ok) e.missed++;
  if (first) { e.firstDone++; if (ok) e.firstOk++; }
  if (lifetimeFirst) { e.everSeen = true; e.trueFirstOk = !!ok; }
  e.last = Date.now();
  progressState.lab2stations[id] = e;
  saveLocalProgress();   // debounced cloud push → syncs the model-readiness metric across devices
}
// Real Lab-2 photo readiness, as TWO honest numbers instead of one misleading blended percentage:
//   coverage   — how many of the 18 real-model photos you've EVER looked at (unique, not per-round)
//   firstPass  — of the ones you've attempted, what % did you get right on your true first-ever try
// The 2 photos flagged `verify:true` (unconfirmed IDs — lm11/lm12, the transparent cast) are excluded
// from firstPass scoring until their answer is confirmed against the lab key; they still count toward
// coverage's denominator so the number isn't inflated by pretending they don't exist.
function lab2ModelReadiness() {
  const s = (progressState && progressState.lab2stations) || {};
  const all = (typeof LAB2_MODELS !== "undefined" && LAB2_MODELS) || [];
  const scoreable = all.filter(m => !m.verify);
  const totalAll = all.length || Object.keys(s).length;
  const coveredAll = all.length ? all.filter(m => s[m.id] && s[m.id].everSeen).length
                                  : Object.keys(s).filter(id => s[id].everSeen).length;
  const scoreablePool = scoreable.length ? scoreable : all;
  const attempted = scoreablePool.filter(m => s[m.id] && s[m.id].everSeen);
  const firstPassOk = attempted.filter(m => s[m.id].trueFirstOk).length;
  return {
    coverage: { covered: coveredAll, total: totalAll },
    firstPass: attempted.length ? { ok: firstPassOk, done: attempted.length, pct: Math.round(firstPassOk / attempted.length * 100) } : null,
    unconfirmedExcluded: all.length - scoreable.length,
  };
}
// Legacy shape some older call sites may still expect: a single blended pct. Derived from the two real
// numbers above so nothing silently reads a fabricated 100% again — null until BOTH dimensions exist.
function lab2ModelReadinessLegacyPct() {
  const r = lab2ModelReadiness();
  if (!r || !r.firstPass) return null;
  return r.firstPass.pct;
}

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
    <div style="font-weight:800;font-size:1.3rem;color:var(--ink);">Who's studying?</div>
    <div style="color:#666;font-size:.9rem;margin:6px 0 24px;">Your scores, progress, and preparedness are kept separate for each person. We'll remember your pick on this device.</div>`;
  PROFILES.forEach((name, i) => {
    const b = document.createElement("button");
    const colors = ["var(--ink)", "var(--ink-2)", "#2E7D32"];
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
  loadLblCoords();
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
  // Lab 2 model-station stats (own readiness dimension) — best-of merge across devices.
  // everSeen/trueFirstOk are the LIFETIME-first fact and must stay immutable once set on either side:
  // once true first-pass result is written, no later merge (from any device) may flip it.
  into.lab2stations = into.lab2stations || {};
  Object.keys(from.lab2stations || {}).forEach(id => {
    const b = from.lab2stations[id], a = into.lab2stations[id];
    if (!a) { into.lab2stations[id] = JSON.parse(JSON.stringify(b)); return; }
    a.seen = Math.max(a.seen || 0, b.seen || 0); a.missed = Math.max(a.missed || 0, b.missed || 0);
    a.firstDone = Math.max(a.firstDone || 0, b.firstDone || 0); a.firstOk = Math.max(a.firstOk || 0, b.firstOk || 0);
    if (!a.everSeen && b.everSeen) { a.everSeen = true; a.trueFirstOk = !!b.trueFirstOk; }   // immutable — only ever SET, never overwritten
    if (b.last && (!a.last || b.last > a.last)) a.last = b.last;
  });
  // 3D Explorer practical stats — own readiness dimension, best-of merge. Same immutability rule.
  into.lab3d = into.lab3d || {};
  Object.keys(from.lab3d || {}).forEach(k => {
    const b = from.lab3d[k], a = into.lab3d[k];
    if (!a) { into.lab3d[k] = JSON.parse(JSON.stringify(b)); return; }
    a.seen = Math.max(a.seen || 0, b.seen || 0); a.missed = Math.max(a.missed || 0, b.missed || 0);
    a.firstDone = Math.max(a.firstDone || 0, b.firstDone || 0); a.firstOk = Math.max(a.firstOk || 0, b.firstOk || 0);
    if (!a.everSeen && b.everSeen) { a.everSeen = true; a.trueFirstOk = !!b.trueFirstOk; }
    if (b.last && (!a.last || b.last > a.last)) a.last = b.last;
  });
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
        if ((bm.t || 0) > (am.t || 0)) { am.t = bm.t; am.S = bm.S; am.last = bm.last; am.flLast = bm.flLast; }
        else if (am.t == null && bm.t != null) { am.t = bm.t; am.S = bm.S; am.last = bm.last; am.flLast = bm.flLast; }
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
  let pulled = false;
  try {
    const { data, error } = await sb.from("progress").select("data").eq("profile", currentProfile).maybeSingle();
    if (!error && data && data.data && typeof data.data === "object") {
      cloudMerge(progressState, data.data);
      // Invalidate the recall / predicted-score / all-time memos that the FIRST render may have cached
      // from near-empty local data (which produced a false 0% readiness before the cloud pull landed).
      if (typeof _predVer !== "undefined") _predVer++;
      _recallCache = {}; _recallVer = -1; _atMemo = null; _atKey = "";
      saveLocalProgress();   // persist merged copy on this device
      render();
      pulled = true;
    }
  } catch (e) {}
  _cloudBusy = false;
  // Only converge devices AFTER a successful pull. If the pull failed, do NOT push local up — that could
  // overwrite a good cloud record with a stale/near-empty one on a fresh device (ChatGPT audit #3).
  if (pulled) saveProgress(true);
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
function recordQuestionStat(q, wasCorrect, elapsedMs, flagged) {
  if (!q || !q.id) return;
  if (!progressState.qstats) progressState.qstats = {};
  const s = progressState.qstats[q.id] || { seen: 0, missed: 0 };
  s.seen += 1;
  if (!wasCorrect) { s.missed += 1; s.lastMissed = new Date().toISOString(); }
  // Feed the section "Missed Questions" pool from EVERY mode (needs the full question object;
  // CAT passes only an id and records missed itself). Deduped inside addMissed.
  if (!wasCorrect && (q.q || q.question) && q.options && typeof addMissed === "function") { try { addMissed(q, state.sectionKey); } catch (e) {} }
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
  mm.flLast = !!flagged;   // you flagged it to revisit = you weren't 100% sure, even if the final answer was right
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
  if (mm && mm.flLast && r > 0.7) r = 0.7;                     // flagged on last try = "not solid yet" even if correct; clears when re-answered unflagged
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
function loadArchive() { try { return JSON.parse(localStorage.getItem(ns(ARCHIVE_KEY))) || { quizzes:{}, qstats:{}, examAttempts:{}, lab2stations:{}, lab3d:{} }; } catch (e) { return { quizzes:{}, qstats:{}, examAttempts:{}, lab2stations:{}, lab3d:{} }; } }
function saveArchive(a) { try { localStorage.setItem(ns(ARCHIVE_KEY), JSON.stringify(a)); } catch (e) {} }
function mergeProgress(into, from) {
  into.quizzes = into.quizzes || {}; into.qstats = into.qstats || {}; into.examAttempts = into.examAttempts || {};
  into.lab2stations = into.lab2stations || {}; into.lab3d = into.lab3d || {};
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
        if ((bm.t || 0) > (am.t || 0)) { am.t = bm.t; am.S = bm.S; am.last = bm.last; am.flLast = bm.flLast; }
        else if (am.t == null && bm.t != null) { am.t = bm.t; am.S = bm.S; am.last = bm.last; am.flLast = bm.flLast; }
      });
    }
  });
  into.reports = into.reports || [];
  { const rs = new Set(into.reports.map(r => (r.id||"")+"|"+(r.date||"")+"|"+(r.reason||"")));
    (from.reports || []).forEach(r => { const k=(r.id||"")+"|"+(r.date||"")+"|"+(r.reason||""); if(!rs.has(k)){rs.add(k); into.reports.push(r);} }); }
  // Exam/quiz attempt HISTORY — was completely missing from this function, so "Start fresh" silently
  // dropped every past mock/timed-exam/CAT attempt instead of archiving it (they're not in `quizzes` or
  // `qstats`, which is all this function used to touch). Same dedup-by-date+score, cap-10 approach as
  // the cloud merge, so History keeps working after a reset.
  Object.keys(from.examAttempts || {}).forEach(k => {
    const bar = from.examAttempts[k] || [], aar = into.examAttempts[k];
    if (!aar) { into.examAttempts[k] = JSON.parse(JSON.stringify(bar)); return; }
    const seen = new Set(), out = [];
    [...aar, ...bar].forEach(x => { const key = (x.date || "") + ":" + (x.pct ?? "") + ":" + (x.score ?? ""); if (!seen.has(key)) { seen.add(key); out.push(x); } });
    out.sort((x, y) => (y.date || "").localeCompare(x.date || ""));
    into.examAttempts[k] = out.slice(0, 10);
  });
  // Lab 2 photo-station stats — ALSO missing before, so "Start fresh" deleted (not archived) real-photo
  // coverage/first-pass history. Counts are additive (archive + what accrued since the last reset);
  // everSeen/trueFirstOk is the immutable lifetime-first fact, only ever set, never overwritten.
  Object.keys(from.lab2stations || {}).forEach(id => {
    const b = from.lab2stations[id], a = into.lab2stations[id];
    if (!a) { into.lab2stations[id] = JSON.parse(JSON.stringify(b)); return; }
    a.seen = (a.seen || 0) + (b.seen || 0); a.missed = (a.missed || 0) + (b.missed || 0);
    a.firstDone = (a.firstDone || 0) + (b.firstDone || 0); a.firstOk = (a.firstOk || 0) + (b.firstOk || 0);
    if (!a.everSeen && b.everSeen) { a.everSeen = true; a.trueFirstOk = !!b.trueFirstOk; }
    if (b.last && (!a.last || b.last > a.last)) a.last = b.last;
  });
  // 3D Explorer practical stats — same fix, same reasoning as lab2stations above.
  Object.keys(from.lab3d || {}).forEach(k => {
    const b = from.lab3d[k], a = into.lab3d[k];
    if (!a) { into.lab3d[k] = JSON.parse(JSON.stringify(b)); return; }
    a.seen = (a.seen || 0) + (b.seen || 0); a.missed = (a.missed || 0) + (b.missed || 0);
    a.firstDone = (a.firstDone || 0) + (b.firstDone || 0); a.firstOk = (a.firstOk || 0) + (b.firstOk || 0);
    if (!a.everSeen && b.everSeen) { a.everSeen = true; a.trueFirstOk = !!b.trueFirstOk; }
    if (b.last && (!a.last || b.last > a.last)) a.last = b.last;
  });
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
  t.style.cssText = "position:fixed;left:50%;bottom:28px;transform:translateX(-50%);background:var(--ink);color:#fff;padding:10px 18px;border-radius:22px;font-size:.9rem;font-weight:700;z-index:2000;box-shadow:0 4px 16px rgba(0,0,0,.3);";
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 1800);
}
function openReportDialog(q) {
  const ov = document.createElement("div");
  ov.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1500;display:flex;align-items:flex-start;justify-content:center;";
  ov.onclick = (e) => { if (e.target === ov) ov.remove(); };
  const box = document.createElement("div");
  box.style.cssText = "background:#fff;max-width:430px;width:92%;margin-top:56px;border-radius:14px;padding:18px;max-height:82vh;overflow:auto;";
  box.innerHTML = `<div style="font-weight:800;font-size:1.05rem;color:var(--ink);margin-bottom:4px;">🚩 Report this question</div>
    <div style="font-size:.8rem;color:#888;margin-bottom:12px;">${escapeHtml((q.q || "").slice(0, 110))}${(q.q||"").length>110?"…":""}${q.id?` <span style="color:#bbb;">(${q.id})</span>`:""}</div>`;
  let reason = null;
  const rWrap = document.createElement("div"); rWrap.style.cssText = "display:flex;flex-direction:column;gap:8px;";
  [["❌ Wrong answer", "wrong_answer"], ["✏️ Formatting / typo", "formatting"], ["❓ Confusing / other", "other"]].forEach(([lbl, val]) => {
    const b = document.createElement("button"); b.textContent = lbl;
    b.style.cssText = "text-align:left;border:1.5px solid #ddd;background:#fff;border-radius:10px;padding:11px;font-size:.92rem;cursor:pointer;";
    b.onclick = () => { reason = val; rWrap.querySelectorAll("button").forEach(x => { x.style.background = "#fff"; x.style.borderColor = "#ddd"; }); b.style.background = "#EAF3FB"; b.style.borderColor = "var(--ink-2)"; };
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
  // Exam/mock/CAT/quiz completion is infrequent, so push to the cloud IMMEDIATELY (not the 2.5s
  // debounce) — guarantees a finished attempt syncs to other devices even if the app is closed
  // right after submitting. Per-question stats still use the debounced push.
  if (typeof saveProgress === "function") { try { saveProgress(true); } catch (e) {} }
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
    // Cumulative FINAL = lecture units only (Appendicular + Axial + Torso). Labs are a SEPARATE
    // practical and are intentionally excluded from the cumulative final review.
    const merged = { title: "Cumulative (Final Review)", flashcards: [], quiz: [], images: [] };
    for (const k of ["appendicular", "axial", "torso"]) {
      const s = DATA.sections[k];
      merged.flashcards.push(...s.flashcards);
      merged.quiz.push(...s.quiz.map(q => ({ ...q })));
      merged.images.push(...s.images);
    }
    return merged;
  }
  return DATA.sections[key];
}

// Section-aware ClaudeBank selector. Torso → CLAUDEBANK, Appendicular/Axial → their own
// banks, Cumulative → all three combined. Returns null if the section has no bank.
function activeClaudeBank(key) {
  const k = key || state.sectionKey;
  if (k === "appendicular") return (typeof CLAUDEBANK_APPENDICULAR !== "undefined" && CLAUDEBANK_APPENDICULAR.length) ? CLAUDEBANK_APPENDICULAR : null;
  if (k === "axial")        return (typeof CLAUDEBANK_AXIAL !== "undefined" && CLAUDEBANK_AXIAL.length) ? CLAUDEBANK_AXIAL : null;
  if (k === "cumulative") {
    let out = [];
    if (typeof CLAUDEBANK_APPENDICULAR !== "undefined") out = out.concat(CLAUDEBANK_APPENDICULAR);
    if (typeof CLAUDEBANK_AXIAL !== "undefined")        out = out.concat(CLAUDEBANK_AXIAL);
    if (typeof CLAUDEBANK !== "undefined")              out = out.concat(CLAUDEBANK);
    return out.length ? out : null;
  }
  if (k === "torso") return (typeof CLAUDEBANK !== "undefined" && CLAUDEBANK.length) ? CLAUDEBANK : null;
  if (k === "lab2")  return (typeof LAB2_BANK !== "undefined" && LAB2_BANK.length) ? LAB2_BANK : null;
  return null; // lab1 has no ClaudeBank
}
// Section-aware Stuvia bank. Torso → STUVIA_BANK, Axial → STUVIA_AXIAL, Cumulative → both.
// (Appendicular has no Stuvia source — the Stuvia PDF has essentially no appendicular content.)
function activeStuvia(key) {
  const k = key || state.sectionKey;
  if (k === "torso") return (typeof STUVIA_BANK !== "undefined" && STUVIA_BANK.length) ? STUVIA_BANK : null;
  if (k === "axial") return (typeof STUVIA_AXIAL !== "undefined" && STUVIA_AXIAL.length) ? STUVIA_AXIAL : null;
  if (k === "appendicular") return (typeof STUVIA_APPENDICULAR !== "undefined" && STUVIA_APPENDICULAR.length) ? STUVIA_APPENDICULAR : null;
  if (k === "cumulative") {
    let out = [];
    if (typeof STUVIA_APPENDICULAR !== "undefined") out = out.concat(STUVIA_APPENDICULAR);
    if (typeof STUVIA_AXIAL !== "undefined") out = out.concat(STUVIA_AXIAL);
    if (typeof STUVIA_BANK !== "undefined") out = out.concat(STUVIA_BANK);
    return out.length ? out : null;
  }
  return null; // lab1 / lab2 have no Stuvia bank
}

const state = { route: "home", sectionKey: null, mode: null, subtopicIndex: null, cameFromSubtopics: false, quizFilter: null, quizSource: null, cbIndex: -1, examSource: null, prevRoute: null, grSection: -1 };

// CAT (adaptive test) config + state — declared EARLY (before initApp) so a restored
// catSim/examMenu route on page load can't hit a temporal-dead-zone error. Functions live
// in the CAT module lower down (hoisted; they only read these once they actually run).
const CAT_CONFIG = {
  torso:        { enabled: true,  total: 200, label: "Torso" },
  cumulative:   { enabled: true,  total: 200, label: "Cumulative" },
  appendicular: { enabled: false, total: 200, label: "Appendicular" },
  axial:        { enabled: false, total: 200, label: "Axial" },
};
const CAT_MIN_ITEMS = 50, CAT_SE_STOP = 0.32;
let catState = null;

// ── Diagram-label spot coordinates (for auto-graded on-image labeling) ──
// Merged: baked LBL_COORDS (shared) + this device's locally-tagged spots (override).
const LBLCOORDS_KEY = "biol250_lblcoords_v1";
let lblCoords = {};          // effective (baked + local) — used for grading/hotspots
let _localLblCoords = {};    // just this device's tagged spots — what we persist/export
let labTagIndex = 0, labTagDeck = [];
function loadLblCoords() {
  lblCoords = {};
  try { if (typeof LBL_COORDS !== "undefined") lblCoords = JSON.parse(JSON.stringify(LBL_COORDS)); } catch (e) {}
  try { _localLblCoords = JSON.parse(localStorage.getItem(ns(LBLCOORDS_KEY)) || "{}"); } catch (e) { _localLblCoords = {}; }
  Object.keys(_localLblCoords).forEach(img => { lblCoords[img] = Object.assign({}, lblCoords[img] || {}, _localLblCoords[img]); });
}
function saveLblCoordsLocal() {
  try { localStorage.setItem(ns(LBLCOORDS_KEY), JSON.stringify(_localLblCoords)); } catch (e) {}
}
function setLblSpot(img, num, xy) {
  _localLblCoords[img] = _localLblCoords[img] || {}; _localLblCoords[img][String(num)] = xy;
  lblCoords[img] = lblCoords[img] || {}; lblCoords[img][String(num)] = xy;
  saveLblCoordsLocal();
}
function clearLblSpot(img, num) {
  if (_localLblCoords[img]) delete _localLblCoords[img][String(num)];
  // fall back to baked value if present, else remove
  let baked; try { baked = (typeof LBL_COORDS !== "undefined" && LBL_COORDS[img]) ? LBL_COORDS[img][String(num)] : null; } catch (e) { baked = null; }
  if (baked) lblCoords[img][String(num)] = baked; else if (lblCoords[img]) delete lblCoords[img][String(num)];
  saveLblCoordsLocal();
}

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
  else if (state.route === "ownerStats") renderOwnerStats(main);
  else if (state.route === "subtopics") renderSubtopics(main);
  else if (state.route === "worksheet") renderWorksheet(main);
  else if (state.route === "labeling") renderLabeling(main);
  else if (state.route === "labelTag") renderLabelTag(main);
  else if (state.route === "examPicker") renderExamPicker(main);
  else if (state.route === "exam") renderExam(main);
  else if (state.route === "examResults") renderExamResults(main);
  else if (state.route === "simPicker") renderSimPicker(main);
  else if (state.route === "simExam") renderSimExam(main);
  else if (state.route === "simReview") renderSimReview(main);
  else if (state.route === "missedReview") renderMissedReview(main);
  else if (state.route === "fuzzyReview") renderFuzzyReview(main);
  else if (state.route === "lab2Station") renderLab2Station(main);
  else if (state.route === "lab3d") render3DExplorer(main);
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
  else if (state.route === "catSim")         renderCatSim(main);
  else if (state.route === "catEnd")         renderCatEnd(main);
  else if (state.route === "preparednessGeneric") renderPreparednessGeneric(main);

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
      else if (state.route === "examMenu")      state.route = (state.sectionKey === "lab2" ? "modes" : "sectionMenu");
      else if (state.route === "stuviaMenu")    state.route = "sectionMenu";
      else if (state.route === "claudeMenu")    state.route = "sectionMenu";
      else if (state.route === "diagramMenu")   state.route = "sectionMenu";
      else if (state.route === "diagramGallery") state.route = "sectionMenu";
      else if (state.route === "preparedness") state.route = "sectionMenu";
      else if (state.route === "coach") state.route = "preparedness";
      else if (state.route === "history") state.route = "examMenu";
      else if (state.route === "missedStats") state.route = "preparedness";
      else if (state.route === "reports") state.route = "home";
      else if (state.route === "ownerStats") state.route = "home";
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
      else if (state.route === "fuzzyReview")   { fuzzyDeck = []; state.route = state._fuzzyBack || "preparedness"; }
      else if (state.route === "lab2Station")   { _l2ClearTimer(); l2Deck = []; state.route = "modes"; }
      else if (state.route === "lab3d")          { try { if (typeof _l3StopPracticalTimer === "function") _l3StopPracticalTimer(); else if (l3.pr && l3.pr.timer) clearInterval(l3.pr.timer); _l3Dispose(); } catch (e) {} state.route = "modes"; }
      else if (state.route === "suddenDeath" || state.route === "sdEnd") { sdDeck = []; state.route = "examMenu"; }
      else if (state.route === "fullExam") { if (confirm("Leave exam? Progress will be lost.")) { clearInterval(fullExamTimerInterval); fullExamTimerInterval = null; fullExamDeck = []; state.route = "examMenu"; render(); } return; }
      else if (state.route === "fullExamEnd") { fullExamDeck = []; state.route = "examMenu"; }
      else if (state.route === "catSim") { if (confirm("Leave the adaptive test? Progress will be lost.")) { state.route = "examMenu"; render(); } return; }
      else if (state.route === "catEnd") { state.route = "examMenu"; }
      else if (state.route === "preparednessGeneric") state.route = (state.sectionKey === "lab2" ? "modes" : "sectionMenu");
      else if (state.route === "labeling")      state.route = (state.sectionKey === "lab2" ? "modes" : "diagramMenu");
      else if (state.route === "labelTag")      state.route = (state.sectionKey === "lab2" ? "modes" : "sectionMenu");
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
  else if (state.route === "ownerStats") titleText = "Class Stats 👑";
  else if (state.route === "stuviaMenu")     titleText = "Stuvia Bank";
  else if (state.route === "claudeMenu")     titleText = "Claude Bank";
  else if (state.route === "catSim")         titleText = "Adaptive Ability Index 🧪";
  else if (state.route === "catEnd")         titleText = "Adaptive Ability Index Results 🧪";
  else if (state.route === "preparednessGeneric") titleText = "Preparedness";
  else if (state.route === "labelTag") titleText = "Tag Diagram Spots";
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
  else if (state.route === "fuzzyReview")   titleText = state._drillTitle || "Fuzzy Questions";
  else if (state.route === "lab2Station")   titleText = "Model Practical";
  else if (state.route === "lab3d")         titleText = "3D Anatomy Explorer";
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
    idchip.style.cssText = "display:flex;align-items:center;background:var(--ink);color:#fff;border:none;border-radius:16px;padding:5px 13px;font-size:.82rem;cursor:pointer;white-space:nowrap;";
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
  axial:        { c1: "#3E86C9", c2: "var(--ink-2)" },   // blue
  appendicular: { c1: "#D9A441", c2: "#B7791F" },   // amber / bone
  lab1:         { c1: "#7C4DD6", c2: "#5B21B6" },   // violet
  lab2:         { c1: "#14A090", c2: "#0F766E" },   // teal
};
/* ---------------- NOTES POP-UP (paged PDF viewer for with-notes practice) ----------------
   A floating, draggable, closable/reopenable panel that shows YOUR section notes as pages you
   can flip through (‹ ›). Each question opens the doc for its region (Thorax/Abdomen/…); you do
   the looking. Lives on document.body so app re-renders never wipe it. Complements Martini lookup. */
const NOTES_PDF = {
  thorax: "notes_thorax.pdf", abdomen: "notes_abdomen.pdf", pelvis: "notes_pelvis.pdf", systemic: "notes_systemic.pdf",
  ax_hn: "notes_ax_hn.pdf", ax_spinal: "notes_ax_spinal.pdf", ax_systemic: "notes_ax_systemic.pdf",
  ap_ue: "notes_ap_ue.pdf", ap_le: "notes_ap_le.pdf", ap_systemic: "notes_ap_systemic.pdf",
};
const NOTES_LABEL = {
  thorax: "Thorax", abdomen: "Abdomen", pelvis: "Pelvis & Perineum", systemic: "Systemic",
  ax_hn: "Head & Neck", ax_spinal: "Spinal", ax_systemic: "Nervous System",
  ap_ue: "Upper Extremity", ap_le: "Lower Extremity", ap_systemic: "Foundations",
};
// group index → notes doc, per non-torso section (mirrors SECTION_GROUPS)
const _NOTES_GROUP = {
  axial: { 0: "ax_hn", 1: "ax_hn", 2: "ax_hn", 3: "ax_hn", 4: "ax_hn", 5: "ax_hn", 6: "ax_hn", 7: "ax_hn", 8: "ax_hn", 9: "ax_hn", 10: "ax_spinal", 11: "ax_spinal", 12: "ax_systemic" },
  appendicular: { 0: "ap_ue", 1: "ap_ue", 2: "ap_ue", 3: "ap_ue", 4: "ap_ue", 5: "ap_ue", 6: "ap_ue", 7: "ap_ue", 8: "ap_le", 9: "ap_le", 10: "ap_le", 11: "ap_le", 12: "ap_le", 13: "ap_systemic", 14: "ap_systemic", 15: "ap_systemic", 16: "ap_systemic", 17: "ap_systemic", 18: "ap_systemic", 19: "ap_systemic" },
};
let _qRegionMap = null;
function qRegionSection(id) {
  if (!_qRegionMap) {
    _qRegionMap = {};
    // Torso → thorax/abdomen/pelvis/systemic (specific region beats systemic for shared Qs)
    try {
      const bp = blueprintSources();
      Object.keys(bp).forEach(r => { const rl = r.toLowerCase(); bp[r].forEach(o => {
        if (!_qRegionMap[o.id] || (_qRegionMap[o.id] === "systemic" && rl !== "systemic")) _qRegionMap[o.id] = rl;
      }); });
    } catch (e) {}
    // Axial + Appendicular GR → notes doc by subtopic group
    try {
      ["axial", "appendicular"].forEach(sec => {
        const s = DATA.sections[sec], gk = _NOTES_GROUP[sec]; if (!s || !gk) return;
        (s.subtopics || []).forEach((st, i) => { const k = gk[i]; if (!k) return; (st.quiz || []).forEach(q => { if (q.id && !_qRegionMap[q.id]) _qRegionMap[q.id] = k; }); });
      });
    } catch (e) {}
  }
  const r = _qRegionMap[id]; return (r && NOTES_PDF[r]) ? r : null;
}
let notesPanel = { el: null, section: null, page: 1, pages: 0, pdf: null, cache: {}, rendering: false, zoom: 1 };
function closeNotesPanel() { if (notesPanel.el) { notesPanel.el.remove(); notesPanel.el = null; } }
function _notesWorker() { try { if (typeof pdfjsLib !== "undefined" && !pdfjsLib.GlobalWorkerOptions.workerSrc) pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"; } catch (e) {} }
async function openNotesPanel(section) {
  if (!section || !NOTES_PDF[section]) return;
  if (typeof pdfjsLib === "undefined") { alert("Notes viewer is still loading — try again in a moment."); return; }
  _notesWorker();
  ensureNotesPanelDom();
  if (notesPanel.section !== section) {
    notesPanel.section = section; notesPanel.page = 1;
    notesPanel.zoom = 1; if (notesPanel.zoomLabel) notesPanel.zoomLabel.textContent = "100%";
    notesPanel.hdr.textContent = "📓 " + NOTES_LABEL[section] + " Notes";
    if (notesPanel.cache[section]) { notesPanel.pdf = notesPanel.cache[section]; notesPanel.pages = notesPanel.pdf.numPages; renderNotesPage(); }
    else {
      notesPanel.status.textContent = "Loading notes…";
      try { const pdf = await pdfjsLib.getDocument(NOTES_PDF[section]).promise; notesPanel.cache[section] = pdf; notesPanel.pdf = pdf; notesPanel.pages = pdf.numPages; renderNotesPage(); }
      catch (e) { notesPanel.status.textContent = "Couldn't load notes."; }
    }
  } else { renderNotesPage(); }
}
async function renderNotesPage() {
  if (!notesPanel.pdf || notesPanel.rendering) return;
  notesPanel.rendering = true;
  try {
    const page = await notesPanel.pdf.getPage(notesPanel.page);
    const vp0 = page.getViewport({ scale: 1 });
    // Render at 2–3× the panel's CSS width so dense notes text stays crisp when scaled to fit.
    // (Previously used clientWidth × devicePixelRatio, which on a 1× display rendered BELOW native
    // resolution → blurry.) Supersample with a floor of 2.5× and a cap so the canvas stays sane.
    const cssW = (notesPanel.canvas.parentElement && notesPanel.canvas.parentElement.clientWidth) || 560;
    const ss = Math.min(4, Math.max(2.5, (window.devicePixelRatio || 1) * 1.5));
    const z = notesPanel.zoom || 1;
    // Render at zoom×supersample so zoomed-in text stays crisp (not just CSS-stretched).
    const scale = Math.min(8, (cssW * ss * z) / vp0.width);
    const vp = page.getViewport({ scale });
    const c = notesPanel.canvas, ctx = c.getContext("2d");
    c.width = vp.width; c.height = vp.height; c.style.width = (100 * z) + "%";
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    notesPanel.counter.textContent = "p. " + notesPanel.page + " / " + notesPanel.pages;
    notesPanel.status.textContent = "";
  } catch (e) { notesPanel.status.textContent = "Render error."; }
  notesPanel.rendering = false;
}
function notesGoto(delta) { if (!notesPanel.pdf) return; const p = Math.min(Math.max(1, notesPanel.page + delta), notesPanel.pages); if (p !== notesPanel.page) { notesPanel.page = p; renderNotesPage(); } }
function notesZoom(delta) {
  const z = Math.round(Math.min(3, Math.max(1, (notesPanel.zoom || 1) + delta)) * 100) / 100;
  if (z === notesPanel.zoom) return;
  notesPanel.zoom = z;
  if (notesPanel.zoomLabel) notesPanel.zoomLabel.textContent = Math.round(z * 100) + "%";
  renderNotesPage();
}
function notesZoomSet(z) { notesPanel.zoom = z; if (notesPanel.zoomLabel) notesPanel.zoomLabel.textContent = Math.round(z * 100) + "%"; renderNotesPage(); }
function ensureNotesPanelDom() {
  if (notesPanel.el) return;
  const el = document.createElement("div");
  el.style.cssText = "position:fixed;right:16px;bottom:16px;width:min(620px,96vw);max-height:90vh;background:#fff;border:1px solid #bbb;border-radius:12px;box-shadow:0 12px 44px rgba(0,0,0,.4);z-index:100000;display:flex;flex-direction:column;overflow:hidden;";
  const bar = document.createElement("div"); bar.style.cssText = "display:flex;align-items:center;gap:8px;padding:9px 11px;background:var(--ink);color:#fff;cursor:move;user-select:none;touch-action:none;";
  const hdr = document.createElement("div"); hdr.style.cssText = "font-weight:700;font-size:.85rem;flex:1;"; hdr.textContent = "📓 Notes";
  // zoom controls (− %  +) — render sharper when zoomed; double-tap the page also toggles zoom
  const zBtnCss = "background:rgba(255,255,255,.18);border:none;color:#fff;font-size:1rem;font-weight:800;cursor:pointer;line-height:1;border-radius:6px;width:26px;height:24px;";
  const zOut = document.createElement("button"); zOut.textContent = "−"; zOut.title = "Zoom out"; zOut.style.cssText = zBtnCss; zOut.onclick = () => notesZoom(-0.25);
  const zLabel = document.createElement("div"); zLabel.style.cssText = "font-size:.72rem;min-width:34px;text-align:center;font-weight:700;"; zLabel.textContent = "100%";
  const zIn = document.createElement("button"); zIn.textContent = "+"; zIn.title = "Zoom in"; zIn.style.cssText = zBtnCss; zIn.onclick = () => notesZoom(0.25);
  const closeB = document.createElement("button"); closeB.textContent = "✕"; closeB.style.cssText = "background:none;border:none;color:#fff;font-size:1.05rem;cursor:pointer;line-height:1;margin-left:4px;"; closeB.title = "Close"; closeB.onclick = closeNotesPanel;
  bar.append(hdr, zOut, zLabel, zIn, closeB); el.appendChild(bar);
  const body = document.createElement("div"); body.style.cssText = "overflow:auto;flex:1;background:#eef0f2;padding:6px;-webkit-overflow-scrolling:touch;";
  const canvas = document.createElement("canvas"); canvas.style.cssText = "width:100%;display:block;background:#fff;box-shadow:0 1px 5px rgba(0,0,0,.25);border-radius:2px;"; body.appendChild(canvas); el.appendChild(body);
  // double-tap / double-click the page toggles between fit (100%) and 2×
  canvas.addEventListener("dblclick", () => notesZoomSet((notesPanel.zoom || 1) > 1 ? 1 : 2));
  const status = document.createElement("div"); status.style.cssText = "font-size:.72rem;color:#888;text-align:center;padding:3px;"; el.appendChild(status);
  const nav = document.createElement("div"); nav.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 11px;border-top:1px solid #eee;";
  const prev = document.createElement("button"); prev.textContent = "‹ Prev"; prev.style.cssText = "border:1px solid #ccc;background:#fff;border-radius:8px;padding:6px 14px;cursor:pointer;font-weight:600;"; prev.onclick = () => notesGoto(-1);
  const counter = document.createElement("div"); counter.style.cssText = "font-size:.82rem;color:#555;font-weight:700;";
  const next = document.createElement("button"); next.textContent = "Next ›"; next.style.cssText = "border:1px solid #ccc;background:#fff;border-radius:8px;padding:6px 14px;cursor:pointer;font-weight:600;"; next.onclick = () => notesGoto(1);
  nav.append(prev, counter, next); el.appendChild(nav);
  document.body.appendChild(el);
  // drag by header (mouse + touch)
  let dx = 0, dy = 0, drag = false;
  bar.addEventListener("pointerdown", (e) => { if (e.target === closeB) return; drag = true; const r = el.getBoundingClientRect(); dx = e.clientX - r.left; dy = e.clientY - r.top; el.style.right = "auto"; el.style.bottom = "auto"; el.style.left = r.left + "px"; el.style.top = r.top + "px"; });
  document.addEventListener("pointermove", (e) => { if (!drag) return; el.style.left = Math.max(0, e.clientX - dx) + "px"; el.style.top = Math.max(0, e.clientY - dy) + "px"; });
  document.addEventListener("pointerup", () => { drag = false; });
  notesPanel.el = el; notesPanel.hdr = hdr; notesPanel.canvas = canvas; notesPanel.status = status; notesPanel.counter = counter; notesPanel.zoomLabel = zLabel;
}
// Small "📓 Notes" launcher for with-notes practice — only when the question maps to a notes doc.
function notesBtn(q) {
  if (getStudyMode() !== "open") return null;
  const sec = q && qRegionSection(q.id); if (!sec) return null;
  const b = document.createElement("button"); b.className = "tbLookBtn";
  b.innerHTML = "📓 Notes"; b.title = "Open your " + NOTES_LABEL[sec] + " notes";
  b.onclick = () => openNotesPanel(sec);
  return b;
}

/* ---------------- OWNER DASHBOARD (class-wide stats, pulled from cloud sync) ---------------- */
const OWNER_PROFILES = ["gabe"];  // only these profiles see the class-stats view
function isOwner() { return CLOUD_ENABLED && currentProfile && OWNER_PROFILES.includes(String(currentProfile).trim().toLowerCase()); }
let ownerStats = { data: null, err: null, loading: false };
async function fetchOwnerStats() {
  if (!sb) { ownerStats.err = "Cloud sync isn't enabled."; return; }
  ownerStats.loading = true; ownerStats.err = null;
  try {
    const { data, error } = await sb.from("progress").select("profile,data,updated_at");
    if (error) throw error;
    ownerStats.data = data || [];
  } catch (e) { ownerStats.err = (e && e.message) || String(e); }
  ownerStats.loading = false;
  if (state.route === "ownerStats") render();
}
function _relTime(iso) {
  if (!iso) return "—";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now"; if (m < 60) return m + "m ago";
  const h = Math.round(m / 60); if (h < 24) return h + "h ago";
  return Math.round(h / 24) + "d ago";
}
function profileSummary(row) {
  const d = row.data || {}, qs = d.qstats || {};
  let ids = 0, seen = 0, missed = 0;
  Object.keys(qs).forEach(id => { ids++; seen += qs[id].seen || 0; missed += qs[id].missed || 0; });
  const acc = seen ? Math.round((seen - missed) / seen * 100) : null;
  let att = [];
  Object.keys(d.examAttempts || {}).forEach(k => (d.examAttempts[k] || []).forEach(a => att.push(Object.assign({ _key: k }, a))));
  att.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  const mocks = att.filter(a => (a.total || 0) >= 100 && typeof a.pct === "number");
  const bestMock = mocks.length ? Math.max(...mocks.map(a => a.pct)) : null;
  return { profile: row.profile, updated: row.updated_at, practiced: ids, seen, acc, attempts: att.length, mocks: mocks.length, bestMock, recent: att.slice(0, 4) };
}
function renderOwnerStats(main) {
  if (!isOwner()) { const p = document.createElement("p"); p.className = "comingSoonMsg"; p.style.cssText = "text-align:center;margin-top:32px;"; p.textContent = "Owner view only."; main.appendChild(p); return; }
  if (!ownerStats.data && !ownerStats.loading && !ownerStats.err) fetchOwnerStats();
  const wrap = document.createElement("div"); wrap.style.cssText = "max-width:820px;margin:0 auto;";
  const head = document.createElement("div"); head.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;";
  head.innerHTML = `<div style="font-size:.85rem;color:#888;">Everyone's progress · pulled live from cloud sync</div>`;
  const refresh = document.createElement("button"); refresh.textContent = "↻ Refresh"; refresh.style.cssText = "border:1px solid #ccc;background:#fff;border-radius:12px;padding:4px 12px;font-size:.78rem;cursor:pointer;";
  refresh.onclick = () => { ownerStats.data = null; ownerStats.err = null; fetchOwnerStats(); render(); };
  head.appendChild(refresh); wrap.appendChild(head);
  if (ownerStats.loading && !ownerStats.data) { const l = document.createElement("div"); l.style.cssText = "text-align:center;color:#888;padding:30px;"; l.textContent = "Loading everyone's stats…"; wrap.appendChild(l); main.appendChild(wrap); return; }
  if (ownerStats.err) { const e = document.createElement("div"); e.style.cssText = "background:#FDECEA;border:1px solid #f5c6cb;border-radius:10px;padding:14px;color:#922B21;"; e.textContent = "Couldn't load: " + ownerStats.err; wrap.appendChild(e); main.appendChild(wrap); return; }
  const rows = (ownerStats.data || []).filter(r => !/^__/.test(r.profile || "")).map(profileSummary).sort((a, b) => new Date(b.updated || 0) - new Date(a.updated || 0));
  if (!rows.length) { const e = document.createElement("div"); e.style.cssText = "text-align:center;color:#888;padding:30px;"; e.textContent = "No profiles have synced yet."; wrap.appendChild(e); main.appendChild(wrap); return; }
  rows.forEach(s => {
    const card = document.createElement("div"); card.style.cssText = "background:#fff;border:1px solid #eee;border-radius:14px;padding:16px 18px;margin-bottom:14px;box-shadow:0 1px 4px rgba(0,0,0,.05);";
    const acc = s.acc == null ? "—" : s.acc + "%", bm = s.bestMock == null ? "—" : s.bestMock + "%";
    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:baseline;">
        <div style="font-size:1.15rem;font-weight:800;color:var(--ink);">${s.profile}</div>
        <div style="font-size:.75rem;color:#999;">active ${_relTime(s.updated)}</div>
      </div>
      <div style="display:flex;gap:22px;flex-wrap:wrap;margin-top:10px;">
        <div><div style="font-size:1.4rem;font-weight:800;">${s.practiced}</div><div style="font-size:.72rem;color:#888;">questions practiced</div></div>
        <div><div style="font-size:1.4rem;font-weight:800;">${acc}</div><div style="font-size:.72rem;color:#888;">accuracy (${s.seen} answers)</div></div>
        <div><div style="font-size:1.4rem;font-weight:800;">${s.attempts}</div><div style="font-size:.72rem;color:#888;">exams/quizzes</div></div>
        <div><div style="font-size:1.4rem;font-weight:800;">${bm}</div><div style="font-size:.72rem;color:#888;">best full mock (${s.mocks})</div></div>
      </div>`;
    if (s.recent && s.recent.length) {
      const rl = document.createElement("div"); rl.style.cssText = "margin-top:10px;border-top:1px solid #f0f0f0;padding-top:8px;";
      rl.innerHTML = `<div style="font-size:.72rem;color:#aaa;margin-bottom:4px;">Recent</div>`;
      s.recent.forEach(a => { const r = document.createElement("div"); r.style.cssText = "display:flex;justify-content:space-between;font-size:.82rem;color:#555;padding:2px 0;"; const pct = (typeof a.pct === "number") ? a.pct + "%" : (a.kind === "cat" ? ("AAI " + (a.readiness != null ? a.readiness + "/100" : "")) : "—"); r.innerHTML = `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:60%;">${a.title || a._key || "Attempt"}</span><span style="color:#888;">${pct} · ${a.date || ""}</span>`; rl.appendChild(r); });
      card.appendChild(rl);
    }
    wrap.appendChild(card);
  });
  main.appendChild(wrap);
}

/* "Start here — one thing" card. The antidote to decision-paralysis / procrastination: instead of
   forcing a "what should I even study" choice, it names ONE highest-yield next action and gives a
   single button to start it. Priority: weakest 0%-ish Martini page → fuzzy drill → a short set. */
function appendStartHere(wrap) {
  let page = null, fuzzy = 0;
  try { const wp = weakestPages("torso", 1); if (wp && wp.length && wp[0].pct < 50) page = wp[0]; } catch (e) {}
  try { fuzzy = _fuzzyCount(); } catch (e) {}
  let title, detail, btnLabel, run;
  if (page) {
    title = "Read Martini p. " + page.page + " — then test it";
    detail = "Your weakest page (" + page.pct + "% over " + page.seen + " tries). Read it, close the book, then tap to drill.";
  } else if (fuzzy > 0) {
    title = "Drill your " + fuzzy + " fuzzy question" + (fuzzy === 1 ? "" : "s");
    detail = "The ones you flip between right and wrong. Read the concept first, then re-test cold.";
  } else {
    title = "Do one short Torso set";
    detail = "Surface fresh gaps, then convert the misses. Don't plan — just start. Five questions.";
  }
  if (page) { btnLabel = "▶ Test p. " + page.page + " now"; run = () => { state.sectionKey = "torso"; startPageDrill(page.page); }; }
  else if (fuzzy > 0) { btnLabel = "▶ Start: drill " + fuzzy + " fuzzy"; run = () => { state.sectionKey = "torso"; startFuzzyDrill(); }; }
  else { btnLabel = "▶ Start Torso practice"; run = () => { state.sectionKey = "torso"; state.route = "examMenu"; render(); }; }
  const card = document.createElement("div");
  card.style.cssText = "background:linear-gradient(135deg,var(--ink),var(--ink-2));color:#fff;border-radius:16px;padding:18px 20px;margin:0 0 20px;box-shadow:0 6px 20px rgba(31,56,100,.25);";
  card.innerHTML = `<div style="font-size:.72rem;font-weight:800;letter-spacing:.1em;opacity:.85;">START HERE — ONE THING</div>
    <div style="font-size:1.2rem;font-weight:800;margin:6px 0 4px;">${title}</div>
    <div style="font-size:.85rem;opacity:.92;line-height:1.45;margin-bottom:12px;">${detail}</div>`;
  const btn = document.createElement("button");
  btn.textContent = btnLabel;
  btn.style.cssText = "background:#fff;color:var(--ink);border:none;border-radius:10px;padding:12px 18px;font-size:.95rem;font-weight:800;cursor:pointer;";
  btn.onclick = run;
  card.appendChild(btn);
  wrap.appendChild(card);
}
/* 10-minute Sprint card — a rotating weak-area micro-session. Names your weakest Torso region + the
   notes to skim, then launches ~5 weakest questions on it. Auto-rotates every 10 min while on home. */
function appendSprintCard(wrap) {
  if (state.sectionKey && state.sectionKey !== "torso" && state.sectionKey) { /* torso-focused for now */ }
  let ranked;
  try { ranked = sprintRankedRegions(); } catch (e) { return; }
  if (!ranked || !ranked.length) return;
  const wk = ranked[sprintRot % ranked.length];
  const focus = wk.r, pct = (wk.v != null) ? Math.round(wk.v) : null;
  const card = document.createElement("div");
  card.style.cssText = "background:#fff;border:1.5px solid var(--teal);border-radius:16px;padding:16px 18px;margin:0 0 20px;box-shadow:var(--shadow-sm);";
  card.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;">
      <div style="font-size:.72rem;font-weight:800;letter-spacing:.1em;color:var(--teal);">🔁 10-MINUTE SPRINT</div>
      <button id="sprintNew" style="background:none;border:none;color:var(--muted);font-size:.75rem;font-weight:700;cursor:pointer;">↻ new focus</button>
    </div>
    <div style="font-size:1.12rem;font-weight:800;margin:6px 0 4px;color:var(--text);">Skim your <span style="color:var(--teal-2);">${focus}</span> notes${pct != null ? ` — weakest region (${pct}% ready)` : ""}</div>
    <div style="font-size:.85rem;color:var(--muted);line-height:1.45;margin-bottom:12px;">Read it, then answer ~5 of your weakest ${focus} questions (plus one you write out). Rotates to your next weak spot every 10 min.</div>`;
  const btn = document.createElement("button");
  btn.textContent = "▶ Start " + focus + " sprint";
  btn.style.cssText = "background:var(--teal);color:#fff;border:none;border-radius:10px;padding:12px 18px;font-size:.95rem;font-weight:800;cursor:pointer;";
  btn.onclick = () => startSprint(focus);
  card.appendChild(btn);
  wrap.appendChild(card);
  const nb = card.querySelector("#sprintNew");
  if (nb) nb.onclick = () => { sprintRot++; render(); };
  // Auto-rotate every 10 minutes, but only while the home screen is showing.
  if (sprintTimer) clearInterval(sprintTimer);
  sprintTimer = setInterval(() => {
    if (state.route !== "home") { clearInterval(sprintTimer); sprintTimer = null; return; }
    sprintRot++; render();
  }, 600000);
}
function renderHome(main) {
  ensureHoverStyle();
  const wrap = document.createElement("div");
  wrap.style.cssText = "max-width:1000px;margin:0 auto;padding:0 6px;";

  // Reports pill (clearly a quality-flag tool, not part of studying)
  const nRep = loadReports().filter(r => !r.resolved).length;
  const repRow = document.createElement("div");
  repRow.style.cssText = "display:flex;justify-content:flex-end;gap:8px;margin:2px 0 4px;";
  // Owner-only: class stats dashboard
  if (isOwner()) {
    const own = document.createElement("button");
    own.className = "pillBtn";
    own.innerHTML = "👑 Class stats";
    own.title = "Owner view — everyone's progress (pulled from cloud sync).";
    own.style.cssText = "border:1px solid #c9d4e3;background:#fff;color:var(--ink);border-radius:14px;padding:4px 13px;font-size:.76rem;font-weight:700;cursor:pointer;";
    own.onclick = () => { state.route = "ownerStats"; render(); };
    repRow.appendChild(own);
  }
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
    <div style="font-family:Georgia,'Times New Roman',serif;font-size:2rem;font-weight:800;color:var(--ink);letter-spacing:-.01em;">BIOL 250 <span style="color:#0F766E;">Study</span></div>
    <div style="color:#7c8598;font-size:.95rem;margin-top:4px;">Human Anatomy — timed practice, real-exam sims &amp; a coach that tells you what to study next.</div>`;
  wrap.appendChild(hero);

  // Start-here card (one unambiguous next action — kills the "what do I even study" paralysis)
  try { appendStartHere(wrap); } catch (e) {}
  // 10-minute rotating Sprint card (weak-area micro-session, auto-refreshes)
  try { appendSprintCard(wrap); } catch (e) {}

  // Live question count (subtopics are the source of truth; s.quiz can lag after edits like the T/F add).
  const qCount = (s) => {
    const sub = (s.subtopics || []).reduce((a, t) => a + ((t.quiz || []).length), 0);
    return sub || (s.quiz || []).length;
  };
  const makeCard = (key, s) => {
    const ac = HOME_ACCENT[key] || { c1: "#64748b", c2: "#475569" };
    const card = document.createElement("button");
    card.className = "homeCard";
    // flex column + height:100% so every card in a row is the same height; icon stacked ABOVE the
    // title so long names (Appendicular) get the full width and never clip.
    card.style.cssText = "position:relative;overflow:hidden;text-align:left;background:#fff;border:1px solid #ece7dd;border-radius:18px;padding:0;cursor:pointer;box-shadow:0 2px 10px rgba(31,56,100,.06);display:flex;flex-direction:column;width:100%;height:100%;min-width:0;";
    card.innerHTML = `
      <div style="height:6px;flex:0 0 auto;background:linear-gradient(90deg,${ac.c1},${ac.c2});"></div>
      <div style="padding:15px 16px 16px;display:flex;flex-direction:column;flex:1;min-width:0;">
        <span style="flex:0 0 auto;width:44px;height:44px;border-radius:13px;background:linear-gradient(135deg,${ac.c1}22,${ac.c2}22);display:flex;align-items:center;justify-content:center;font-size:1.45rem;">${ICONS[key] || "📘"}</span>
        <div style="font-family:Georgia,serif;font-size:1.2rem;font-weight:800;color:#1F2937;margin:10px 0 4px;overflow-wrap:break-word;">${s.title.split(" (")[0]}</div>
        <div style="color:#6b7280;font-size:.85rem;line-height:1.4;flex:1;">${META[key] || ""}</div>
        <div style="margin-top:12px;align-self:flex-start;font-size:.78rem;font-weight:700;color:${ac.c2};background:${ac.c1}14;border-radius:999px;padding:4px 11px;white-space:nowrap;">
          ${s.flashcards.length} cards&nbsp;·&nbsp;${qCount(s)} questions</div>
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
    // auto-fit so all cards in a group sit in ONE row on desktop (3 lecture / 2 lab), wrapping only on narrow screens
    grid.style.cssText = "display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;";
    keys.forEach(k => { const s = DATA.sections[k]; if (s) grid.appendChild(makeCard(k, s)); });
    wrap.appendChild(grid);
  };

  section("Lecture", "Regional & systemic anatomy", ["appendicular", "axial", "torso"]);   // course order: Appendicular → Axial → Torso
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

  // ── Practice Tests — timed sims + mini-mocks (Lab 2 gets the full treatment) ──
  if (state.sectionKey === "lab2") {
    groups.push({ label: "Mock Practical — like the real exam", icon: "🔬", modes: [
      { id: "lab2Mock", icon: "🔬", label: "Mock Practical — 50 Q · 50 min",
        desc: "Timed like the real practical · randomized · identify structures + tissue/function + labeling diagrams · skip & flag" },
      { id: "lab2Sprint", icon: "⚡", label: "Sprint — 10 Q · 10 min",
        desc: "Quick focused burst · your weak areas first · identify + tissue/function + diagrams" },
    ]});
    groups.push({ label: "Preparedness", icon: "🎯", modes: [
      { id: "preparednessGeneric", icon: "🎯", label: "Preparedness Score",
        desc: "Readiness by lab-practical system (recall-weighted)" },
    ]});
    groups.push({ label: "Practice Tests", icon: "📝", modes: [
      { id: "examMenu", icon: "🎓", label: "Simulations & Mini-Mocks",
        desc: "Timed full mock + mini-mocks by system + missed-Q review + history" },
    ]});
    if (typeof LAB2_MODELS !== "undefined" && LAB2_MODELS.length) {
      groups.push({ label: "Real Class Models — closest to the practical", icon: "📸", modes: [
        { id: "lab2Station", icon: "📸", label: "Model Stations",
          desc: `${LAB2_MODELS.length} real class-model photos · name it, self-grade (just like the practical)` },
      ]});
    }
    groups.push({ label: "3D Anatomy Explorer — spatial learning", icon: "🧊", modes: [
      { id: "lab3d", icon: "🧊", label: "3D Anatomy Explorer",
        desc: "Rotate heart / brain / torso, tap structures to identify · Explore + timed Practical (loads only when opened)" },
    ]});
    if (typeof LAB2_BANK !== "undefined" && LAB2_BANK.length) {
      const n = LAB2_BANK.reduce((s, g) => s + (g.questions ? g.questions.length : 0), 0);
      groups.push({ label: "Structure & Tissue Q's", icon: "🔬", modes: [
        { id: "lab2Bank", icon: "🔬", label: "Structure & Tissue Drill",
          desc: `${n} MCQs from your worksheets — identify the structure, name the tissue, know the function` },
      ]});
    }
  }

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
    diagModes.push({ id: "labeling", icon: "🏷️", label: "Diagram Labeling — Drag & Drop",
      desc: `${labelingCount} diagrams · drag each label onto its number (great practical prep)` });
    diagModes.push({ id: "labelTag", icon: "🎯", label: "Tag Diagram Spots (setup)",
      desc: "One-time: mark where each label sits on the image → labeling then auto-grades ON the diagram" });
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

  // ── Lab 2 is a PRACTICAL — lead with the identify-it tools, push reading/tests down ──
  if (state.sectionKey === "lab2") {
    const order = ["Mock Practical", "Real Class Models", "Structure & Tissue", "3D Anatomy Explorer", "Diagrams", "Preparedness", "Practice Tests", "Guided Readings", "Practice Exams"];
    const rank = (g) => { const i = order.findIndex(o => (g.label || "").startsWith(o)); return i < 0 ? 99 : i; };
    groups.sort((a, b) => rank(a) - rank(b));
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
      } else if (m.id === "lab2Mock") {
        btn.onclick = () => { const pool = lab2MockPool(); if (pool.length < 5) { alert("Not enough Lab 2 questions available."); return; } launchFullExamPool(shuffle(pool).slice(0, 50), "Lab 2 Mock Practical", 3000); };
      } else if (m.id === "lab2Sprint") {
        btn.onclick = () => { const d = lab2SprintDeck(10); if (d.length < 3) { alert("Not enough Lab 2 questions available."); return; } launchFullExamPool(d, "Lab 2 Sprint", 600); };
      } else if (m.id === "lab2Station") {
        btn.onclick = () => startLab2Practical(false);
      } else if (m.id === "lab2Bank") {
        btn.onclick = () => startLab2BankDrill();
      } else if (m.id === "lab3d") {
        btn.onclick = () => { if (typeof open3DExplorer === "function") open3DExplorer(); else alert("3D Explorer module not loaded."); };
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
    <div style="font-weight:800;font-size:1.15rem;color:var(--ink);margin-bottom:4px;">Before you start…</div>
    <div style="color:#666;font-size:.92rem;margin-bottom:22px;">Are you using your notes for this set? This keeps your <b>true (closed-book)</b> score separate from your <b>with-notes</b> score — and both count toward your stats.</div>`;
  const mk = (label, sub, mode, bg) => {
    const b = document.createElement("button");
    b.style.cssText = `display:block;width:100%;margin:10px 0;background:${bg};color:#fff;border:none;border-radius:12px;padding:14px;font-size:1rem;font-weight:700;cursor:pointer;`;
    b.innerHTML = `${label}<div style="font-weight:400;font-size:.78rem;opacity:.9;margin-top:2px;">${sub}</div>`;
    b.onclick = () => { setStudyMode(mode); quizModeSet = true; render(); };
    return b;
  };
  wrap.appendChild(mk("🧠 Closed-book", "No notes — my true recall", "closed", "var(--ink)"));
  wrap.appendChild(mk("📖 Open-book", "Using my notes", "open", "var(--ink-2)"));
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
      // Self-grade auto-advances straight to the next card (no extra Next click).
      gotIt.onclick = () => { quizScore++; recordQuestionStat(q, true, qElapsed()); quizIndex++; quizAnswered = false; quizSelected = -1; render(); };
      selfBar.appendChild(gotIt);

      const missedIt = document.createElement("button");
      missedIt.className = "secondaryBtn";
      missedIt.style.cssText = "flex:1;";
      missedIt.textContent = "✗ Missed it";
      missedIt.onclick = () => { recordQuestionStat(q, false, qElapsed()); quizIndex++; quizAnswered = false; quizSelected = -1; render(); };
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
  // Shuffle options — cached per QUESTION (by id + deck), not per index. Keying on the
  // index alone caused a new quiz at the same position to reuse the PREVIOUS question's
  // shuffled options (stem said one thing, choices came from another question). Tie the
  // cache to the actual question so options always belong to the stem on screen.
  const _qKey = (q && q.id != null ? "id:" + q.id : "stem:" + String((q && (q.q || q.question)) || "").slice(0, 60)) + "|dk:" + (state.quizDeckKey || "") + "|ix:" + quizIndex;
  if (_qShCache.key !== _qKey) { _qShCache.key = _qKey; _qShCache.opts = shuffle([...q.options]); }
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
      const R = resolveBookReference(q);
      const ch = R.ch, page = R.page || (R.locator && R.locator.page) || null;
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
    look.onclick = () => showTextbookPanel(q.q, q.options[q.correct], q);
    fb.appendChild(look);
    { const nb = notesBtn(q); if (nb) fb.appendChild(nb); }   // 📓 your notes (with-notes mode)
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
    { const nb = notesBtn(q); if (nb) skipBar.appendChild(nb); }   // 📓 open notes while deciding (with-notes mode)
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
// Injected once: styling + smooth transitions for the drag-and-drop labeling UI.
function ensureLabelDragStyle() {
  if (document.getElementById("lblDragStyle")) return;
  const s = document.createElement("style");
  s.id = "lblDragStyle";
  s.textContent = `
    .lblChip{display:inline-flex;align-items:center;gap:6px;margin:5px;padding:9px 14px;border:2px solid #cfd8e3;border-radius:22px;
      background:#fff;font-size:.95rem;cursor:grab;user-select:none;touch-action:none;transition:transform .12s,box-shadow .12s,opacity .15s,background .15s,border-color .15s;}
    .lblChip:hover{border-color:#7C3AED;box-shadow:0 3px 10px rgba(124,58,237,.18);transform:translateY(-1px);}
    .lblChip:active{cursor:grabbing;}
    .lblChip.selected{border-color:#7C3AED;background:#F5F3FF;box-shadow:0 0 0 3px rgba(124,58,237,.15);}
    .lblChip.used{opacity:.32;pointer-events:none;text-decoration:line-through;}
    .lblChip.dragging{opacity:.35;}
    .lblGhost{position:fixed;z-index:9999;pointer-events:none;padding:9px 14px;border-radius:22px;background:#7C3AED;color:#fff;
      font-size:.95rem;font-weight:600;box-shadow:0 8px 22px rgba(124,58,237,.4);transform:translate(-50%,-50%) scale(1.06);white-space:nowrap;}
    .lblBlankRow{display:flex;align-items:center;gap:12px;margin:8px 0;padding:10px 12px;border:2px dashed #d5dbe3;border-radius:12px;
      background:#fafbfc;transition:border-color .15s,background .15s,transform .1s;}
    .lblBlankRow .lblNum{font-weight:800;color:#7C3AED;min-width:26px;text-align:center;}
    .lblBlankRow .lblSlot{flex:1;min-height:24px;color:#111;font-weight:600;}
    .lblBlankRow .lblSlot.empty{color:#9aa4b2;font-weight:500;font-style:italic;}
    .lblBlankRow.filled{border-style:solid;border-color:#7C3AED;background:#F7F5FF;cursor:pointer;}
    .lblBlankRow.dragOver{border-color:#7C3AED;background:#EDE9FE;transform:scale(1.015);box-shadow:0 4px 14px rgba(124,58,237,.2);}
    .lblBlankRow.correct{border-style:solid;border-color:#0F766E;background:#E9F6F4;}
    .lblBlankRow.incorrect{border-style:solid;border-color:#C0392B;background:#FDECEA;}
    .lblBlankRow .lblFix{color:#0F766E;font-weight:800;}
    .lblClearHint{font-size:.72rem;color:#aaa;margin-left:auto;}
    /* on-image hotspots + stickers */
    .lblHotspot{position:absolute;transform:translate(-50%,-50%);display:flex;align-items:center;justify-content:center;
      min-width:26px;min-height:26px;border-radius:14px;cursor:pointer;transition:transform .1s,box-shadow .12s,background .12s;z-index:2;}
    .lblHotspot .lblDot{display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;
      background:rgba(124,58,237,.92);color:#fff;font-weight:800;font-size:.8rem;box-shadow:0 2px 6px rgba(0,0,0,.35);border:2px solid #fff;}
    .lblHotspot.dragOver{transform:translate(-50%,-50%) scale(1.25);}
    .lblHotspot.dragOver .lblDot{background:#4338CA;box-shadow:0 0 0 6px rgba(124,58,237,.3);}
    .lblHotspot .lblSticker{background:#fff;border:2px solid #7C3AED;color:#111;font-weight:700;font-size:.82rem;
      padding:3px 9px;border-radius:14px;box-shadow:0 2px 8px rgba(0,0,0,.28);white-space:nowrap;}
    .lblHotspot.filled{z-index:3;}
    .lblHotspot.okp .lblSticker{border-color:#0F766E;background:#E9F6F4;}
    .lblHotspot.badp .lblSticker,.lblHotspot.badp .lblDot{border-color:#C0392B;}
    .lblHotspot.badp .lblDot{background:#C0392B;}
    .lblStickerFix{display:block;margin-top:2px;background:#0F766E;color:#fff;font-size:.72rem;font-weight:700;padding:1px 7px;border-radius:10px;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,.3);}
    /* tagging tool */
    .tagTargetDot{position:absolute;transform:translate(-50%,-50%);width:24px;height:24px;border-radius:50%;background:#0F766E;color:#fff;
      display:flex;align-items:center;justify-content:center;font-weight:800;font-size:.78rem;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35);cursor:pointer;z-index:2;}
    .tagImgWrap{position:relative;max-width:860px;margin:0 auto;cursor:crosshair;}
    .tagPrompt{background:#0F766E;color:#fff;border-radius:10px;padding:10px 14px;font-weight:700;text-align:center;margin:10px auto;max-width:600px;}
  `;
  document.head.appendChild(s);
}
// Pointer-based drag for a word chip → blank row. Works with mouse AND touch.
// A real drag only starts after a small movement, so a plain tap still selects (fallback).
function startLabelDrag(e, word, chip) {
  if (e.button != null && e.button > 0) return;           // primary button / touch only
  const startX = e.clientX, startY = e.clientY;
  let ghost = null, curRow = null, dragging = false;
  const ensureGhost = () => {
    if (ghost) return;
    ghost = document.createElement("div"); ghost.className = "lblGhost"; ghost.textContent = word;
    document.body.appendChild(ghost); chip.classList.add("dragging");
  };
  const move = (ev) => {
    if (!dragging) {
      if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < 6) return;
      dragging = true; ensureGhost();
    }
    ev.preventDefault();
    ghost.style.left = ev.clientX + "px"; ghost.style.top = ev.clientY + "px";
    const el = document.elementFromPoint(ev.clientX, ev.clientY);
    const row = el && el.closest ? el.closest(".lblBlankRow,.lblHotspot") : null;
    if (row !== curRow) { if (curRow) curRow.classList.remove("dragOver"); curRow = row; if (curRow) curRow.classList.add("dragOver"); }
  };
  const up = () => {
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerup", up);
    document.removeEventListener("pointercancel", up);
    if (ghost) ghost.remove();
    chip.classList.remove("dragging");
    if (dragging && curRow && !lblChecked) {
      curRow.classList.remove("dragOver");
      const num = curRow.dataset.blanknum;
      if (num != null) {
        for (const k in lblAssignments) if (lblAssignments[k] === word) delete lblAssignments[k]; // move, don't duplicate
        lblAssignments[num] = word; lblSelectedChip = null; render();
      }
    }
  };
  document.addEventListener("pointermove", move, { passive: false });
  document.addEventListener("pointerup", up);
  document.addEventListener("pointercancel", up);
}
// True when every blank of this exercise has a tagged coordinate → on-image mode is possible.
function fullyTagged(ex) {
  const c = lblCoords[ex.image]; if (!c) return false;
  return (ex.blanks || []).every(b => c[String(b.num)]);
}
// Auto-graded ON-IMAGE labeling: drag each word onto its numbered spot on the diagram.
function renderLabelingOnImage(main, ex, ctx) {
  if (lblItemIndex !== ctx.index) { lblItemIndex = ctx.index; lblAssignments = {}; lblSelectedChip = null; lblChecked = false; }
  ensureLabelDragStyle();
  const coords = lblCoords[ex.image] || {};
  const stem = document.createElement("div"); stem.className = "qStem"; stem.textContent = `${ctx.label}. ${ex.title}`; main.appendChild(stem);
  const hint = document.createElement("div"); hint.className = "galleryNote"; hint.textContent = "Drag each label onto its numbered spot on the diagram."; main.appendChild(hint);
  const wrap = document.createElement("div"); wrap.className = "lblImgWrap"; wrap.style.cssText = "position:relative;max-width:860px;margin:0 auto;";
  const img = document.createElement("img"); img.src = "images/" + ex.image; img.style.cssText = "width:100%;display:block;border-radius:8px;"; img.loading = "lazy";
  wrap.appendChild(img);
  const overlay = document.createElement("div"); overlay.style.cssText = "position:absolute;inset:0;"; wrap.appendChild(overlay);
  const usedWords = new Set(Object.values(lblAssignments));
  ex.blanks.forEach(b => {
    const c = coords[String(b.num)]; if (!c) return;
    const hs = document.createElement("div"); hs.className = "lblHotspot"; hs.dataset.blanknum = b.num;
    hs.style.left = (c[0] * 100) + "%"; hs.style.top = (c[1] * 100) + "%";
    const filled = lblAssignments[b.num];
    if (filled) {
      hs.classList.add("filled");
      const st = document.createElement("span"); st.className = "lblSticker"; st.textContent = filled; hs.appendChild(st);
      if (lblChecked) {
        hs.classList.add(filled === b.correct ? "okp" : "badp");
        if (filled !== b.correct) { const fx = document.createElement("span"); fx.className = "lblStickerFix"; fx.textContent = b.correct; hs.appendChild(fx); }
      } else { hs.onclick = () => { delete lblAssignments[b.num]; render(); }; }
    } else {
      const dot = document.createElement("span"); dot.className = "lblDot"; dot.textContent = b.num; hs.appendChild(dot);
      if (lblChecked) { hs.classList.add("badp"); const fx = document.createElement("span"); fx.className = "lblStickerFix"; fx.textContent = b.correct; hs.appendChild(fx); }
      else { hs.onclick = () => { if (lblSelectedChip) { for (const k in lblAssignments) if (lblAssignments[k] === lblSelectedChip) delete lblAssignments[k]; lblAssignments[b.num] = lblSelectedChip; lblSelectedChip = null; render(); } }; }
    }
    overlay.appendChild(hs);
  });
  main.appendChild(wrap);
  const bank = document.createElement("div"); bank.className = "wordBank"; bank.style.marginTop = "16px";
  ex.wordBank.forEach(word => {
    const chip = document.createElement("div"); chip.className = "lblChip"; chip.textContent = word; chip.dataset.word = word;
    const isUsed = usedWords.has(word); if (isUsed) chip.classList.add("used"); if (lblSelectedChip === word) chip.classList.add("selected");
    if (!lblChecked && !isUsed) { chip.onclick = () => { lblSelectedChip = lblSelectedChip === word ? null : word; render(); }; chip.addEventListener("pointerdown", (e) => startLabelDrag(e, word, chip)); }
    bank.appendChild(chip);
  });
  main.appendChild(bank);
  const fb = document.createElement("div"); fb.className = "feedbackBar";
  if (!lblChecked) {
    const allFilled = ex.blanks.every(b => lblAssignments[b.num] || !coords[String(b.num)]);
    const check = document.createElement("button"); check.className = "nextBtn"; check.textContent = "Check answers"; check.disabled = !allFilled;
    check.onclick = () => { lblChecked = true; const cc = ex.blanks.filter(b => lblAssignments[b.num] === b.correct).length; ctx.onCheck(cc); render(); };
    fb.appendChild(check);
    const skip = document.createElement("button"); skip.className = "secondaryBtn"; skip.textContent = "Skip diagram"; skip.onclick = () => { ctx.onSkip(ex.blanks.length); render(); }; fb.appendChild(skip);
  } else {
    const next = document.createElement("button"); next.className = "nextBtn"; next.textContent = ctx.isLast ? "See results" : "Next"; next.onclick = () => { ctx.onNext(); render(); }; fb.appendChild(next);
  }
  main.appendChild(fb);
}
function renderLabelingItem(main, ex, ctx) {
  // If this diagram's spots have been tagged, use the auto-graded on-image mode.
  if (fullyTagged(ex)) return renderLabelingOnImage(main, ex, ctx);
  if (lblItemIndex !== ctx.index) {
    lblItemIndex = ctx.index;
    lblAssignments = {};
    lblSelectedChip = null;
    lblChecked = false;
  }
  ensureLabelDragStyle();

  const stem = document.createElement("div");
  stem.className = "qStem";
  stem.textContent = `${ctx.label}. ${ex.title}`;
  main.appendChild(stem);

  const hint = document.createElement("div");
  hint.className = "galleryNote";
  hint.textContent = "Drag a word onto its number — or tap a word, then tap its blank.";
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

  // ── Blank rows FIRST as drop targets (referenced by the drag handler) ──
  const blankList = document.createElement("div");
  blankList.className = "blankList";
  ex.blanks.forEach((b) => {
    const row = document.createElement("div");
    row.className = "lblBlankRow";
    row.dataset.blanknum = b.num;
    const num = document.createElement("div"); num.className = "lblNum"; num.textContent = b.num;
    const filled = lblAssignments[b.num];
    const slot = document.createElement("div");
    slot.className = "lblSlot" + (filled ? "" : " empty");
    slot.textContent = filled || "drop a word here";
    row.appendChild(num); row.appendChild(slot);
    if (filled) row.classList.add("filled");
    if (lblChecked) {
      row.classList.add(filled === b.correct ? "correct" : "incorrect");
      if (filled !== b.correct) {
        const fix = document.createElement("div"); fix.className = "lblFix"; fix.textContent = "✓ " + b.correct;
        row.appendChild(fix);
      }
    } else {
      if (filled) { const ch = document.createElement("span"); ch.className = "lblClearHint"; ch.textContent = "tap to clear"; row.appendChild(ch); }
      row.onclick = () => {
        if (lblChecked) return;
        if (lblAssignments[b.num]) { delete lblAssignments[b.num]; }
        else if (lblSelectedChip) { lblAssignments[b.num] = lblSelectedChip; lblSelectedChip = null; }
        render();
      };
    }
    blankList.appendChild(row);
  });

  // ── Word bank (draggable chips) — placed above the blanks ──
  const bankWrap = document.createElement("div");
  bankWrap.className = "wordBank";
  ex.wordBank.forEach((word) => {
    const chip = document.createElement("div");
    chip.className = "lblChip";
    chip.textContent = word;
    chip.dataset.word = word;
    const isUsed = usedWords.has(word);
    if (isUsed) chip.classList.add("used");
    if (lblSelectedChip === word) chip.classList.add("selected");
    if (!lblChecked && !isUsed) {
      // tap-to-select fallback
      chip.onclick = () => { lblSelectedChip = lblSelectedChip === word ? null : word; render(); };
      // pointer drag-and-drop (mouse + touch)
      chip.addEventListener("pointerdown", (e) => startLabelDrag(e, word, chip));
    }
    bankWrap.appendChild(chip);
  });
  main.appendChild(bankWrap);
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

/* ---------------- TAG DIAGRAM SPOTS (one-time setup for auto-graded on-image labeling) ---------------- */
let labTagTarget = null;
function _tagBtn(label, onclick) { const b = document.createElement("button"); b.className = "secondaryBtn"; b.textContent = label; b.onclick = onclick; b.style.margin = "4px"; return b; }
function renderLabelTag(main) {
  const sec = getSection(state.sectionKey);
  if (!labTagDeck.length || labTagDeck._sec !== state.sectionKey) {
    labTagDeck = [];
    (sec.subtopics || []).forEach(st => (st.labeling || []).forEach(ex => labTagDeck.push({ ...ex, _topic: st.title })));
    labTagDeck._sec = state.sectionKey; labTagIndex = 0; labTagTarget = null;
  }
  ensureLabelDragStyle();
  const total = labTagDeck.length;
  const taggedImgs = labTagDeck.filter(e => { const p = _localLblCoords[e.image] || {}; return e.blanks.every(b => p[String(b.num)]); }).length;

  const intro = document.createElement("div"); intro.className = "galleryNote";
  intro.textContent = "One-time setup: tap on each diagram where its numbered labels point. Then Diagram Labeling auto-grades right on the image. Your taps sync to this device; use “Copy coordinates” to share with the class.";
  main.appendChild(intro);

  if (labTagIndex >= total) {
    const done = document.createElement("div"); done.className = "tagPrompt"; done.textContent = `All ${total} images reviewed · ${taggedImgs}/${total} fully tagged.`;
    main.appendChild(done);
    const restart = _tagBtn("Review from start", () => { labTagIndex = 0; render(); });
    const copy = _tagBtn("📋 Copy all coordinates (to share)", () => { const json = JSON.stringify(_localLblCoords); try { navigator.clipboard && navigator.clipboard.writeText(json); } catch (e) {} alert("Coordinates copied. Paste them to Claude to bake in for everyone.\n\n" + taggedImgs + "/" + total + " images fully tagged."); });
    const row = document.createElement("div"); row.className = "feedbackBar"; row.append(restart, copy); main.appendChild(row);
    return;
  }

  const ex = labTagDeck[labTagIndex];
  const placed = _localLblCoords[ex.image] || {};
  const nums = ex.blanks.map(b => b.num);
  const doneCount = nums.filter(n => placed[String(n)]).length;
  const target = (labTagTarget && !placed[String(labTagTarget)]) ? labTagTarget : nums.find(n => !placed[String(n)]);

  const hd = document.createElement("div"); hd.className = "qStem"; hd.textContent = `Image ${labTagIndex + 1}/${total} — ${ex.title}`; main.appendChild(hd);
  const pr = document.createElement("div"); pr.className = "tagPrompt";
  pr.textContent = target ? `Tap where label ${target} points on the diagram.` : `All ${nums.length} spots placed ✓ — go to the next image.`;
  main.appendChild(pr);

  const wrap = document.createElement("div"); wrap.className = "tagImgWrap";
  const img = document.createElement("img"); img.src = "images/" + ex.image; img.style.cssText = "width:100%;display:block;border-radius:8px;"; wrap.appendChild(img);
  const overlay = document.createElement("div"); overlay.style.cssText = "position:absolute;inset:0;"; wrap.appendChild(overlay);
  nums.forEach(n => {
    const c = placed[String(n)]; if (!c) return;
    const d = document.createElement("div"); d.className = "tagTargetDot"; d.textContent = n;
    d.style.left = (c[0] * 100) + "%"; d.style.top = (c[1] * 100) + "%";
    d.onclick = (e) => { e.stopPropagation(); clearLblSpot(ex.image, n); labTagTarget = n; render(); };
    overlay.appendChild(d);
  });
  overlay.onclick = (e) => {
    if (!target) return;
    const r = overlay.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    setLblSpot(ex.image, target, [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000]);
    labTagTarget = null; render();
  };
  main.appendChild(wrap);

  const fb = document.createElement("div"); fb.className = "feedbackBar"; fb.style.flexWrap = "wrap";
  fb.append(
    _tagBtn("‹ Prev", () => { if (labTagIndex > 0) { labTagIndex--; labTagTarget = null; render(); } }),
    _tagBtn("Undo last", () => { const dn = nums.filter(n => placed[String(n)]); if (dn.length) { clearLblSpot(ex.image, dn[dn.length - 1]); labTagTarget = null; render(); } }),
    _tagBtn("Skip", () => { labTagIndex++; labTagTarget = null; render(); }),
    _tagBtn(doneCount === nums.length ? "Next ✓" : "Next ›", () => { labTagIndex++; labTagTarget = null; render(); })
  );
  main.appendChild(fb);

  const stat = document.createElement("div"); stat.style.cssText = "text-align:center;font-size:.8rem;color:#888;margin-top:10px;";
  stat.textContent = `This diagram ${doneCount}/${nums.length} · fully-tagged images ${taggedImgs}/${total}`;
  main.appendChild(stat);
  const copyRow = document.createElement("div"); copyRow.style.cssText = "text-align:center;margin-top:8px;";
  copyRow.appendChild(_tagBtn("📋 Copy all coordinates (to share)", () => { const json = JSON.stringify(_localLblCoords); try { navigator.clipboard && navigator.clipboard.writeText(json); } catch (e) {} alert("Coordinates copied to clipboard. Paste them to Claude to bake in for Sam & Darren.\n\n" + taggedImgs + "/" + total + " images fully tagged."); }));
  main.appendChild(copyRow);
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
  if (pct >= 75) return { label: "Almost there", color: "var(--ink-2)" };
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
  hdr.style.cssText = "font-size:.82rem;color:var(--ink);font-weight:800;margin-bottom:6px;";
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
    lo: Math.round(q(0.05)), hi: Math.round(q(0.95)), p75: Math.round(pAtLeast(0.75) * 100), p90: Math.round(pAtLeast(0.90) * 100), diagFloor: !!diagFloor, mockWeighted };
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
    b.style.cssText = `border:1.5px solid ${on?"var(--ink)":"#ccc"};background:${on?"var(--ink)":"#fff"};color:${on?"#fff":"#555"};border-radius:20px;padding:6px 12px;font-size:.82rem;font-weight:700;cursor:pointer;`;
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
  exp.innerHTML += ` Bank-coverage estimate — directional, not a validated pass probability.`;
  main.appendChild(exp);
}
function prepModeToggle(main, md) {
  const toggle = document.createElement("div");
  toggle.style.cssText = "display:flex;gap:8px;justify-content:center;margin:6px 0 10px;";
  [["closed","🧠 Closed-book (true)"],["open","📖 With notes"]].forEach(([m, lbl]) => {
    const b = document.createElement("button"); const on = md === m;
    b.style.cssText = `border:1.5px solid ${on?"var(--ink)":"#ccc"};background:${on?"var(--ink)":"#fff"};color:${on?"#fff":"#555"};border-radius:20px;padding:7px 14px;font-size:.85rem;font-weight:700;cursor:pointer;`;
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
// The single MOST RECENT full, timed, realistic mock — the primary readiness signal (an actual
// timed 200-Q performance beats any model's estimate). Everything else on this screen (predicted
// score, true-preparedness, bank coverage, Adaptive Ability Index) is a directional ESTIMATE meant
// to guide study, not a validated probability of passing — this is the one number closest to "the
// real thing," so it's surfaced separately and first.
function latestMock(mode) {
  const recs = (typeof allAttempts === "function" ? allAttempts() : []).filter(a =>
    a.kind === "mock" &&
    (a.rec.total || 0) >= 150 &&
    !/mini/i.test(a.rec.title || a.title || "") &&
    a.rec.mode === mode &&
    typeof a.rec.pct === "number");
  if (!recs.length) return null;
  const a = recs[0];
  return { pct: a.rec.pct, score: a.rec.score, total: a.rec.total, date: a.rec.date || "", title: a.rec.title || a.title || "Full mock" };
}
/* Predicted Exam Score card — the headline "am I ready?" forecast. */
function _bpAttempted(md) {
  const pools = blueprintSources(); let n = 0;
  Object.keys(pools).forEach(r => pools[r].forEach(o => { const m = _qm(o.id, md); if (m && m.s > 0) n++; }));
  return n;
}
function renderExamOutlook(main, md) {
  // PRIMARY signal: the latest full, timed, realistic mock — an actual timed performance beats any
  // model's estimate. Shown first and separately from the estimates below (which are all directional).
  const latest = latestMock(md);
  if (latest) {
    const lc = document.createElement("div");
    lc.style.cssText = "margin:6px 0 10px;padding:14px 16px;border-radius:14px;background:#0F3D2E;color:#fff;border:2px solid #34D399;";
    lc.innerHTML = `<div style="font-weight:800;font-size:.82rem;letter-spacing:.03em;opacity:.9;">📍 PRIMARY SIGNAL — YOUR LATEST FULL MOCK</div>
      <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-top:4px;">
        <div style="font-size:2.2rem;font-weight:900;line-height:1;">${latest.pct}%</div>
        <div style="font-size:.85rem;opacity:.9;">${latest.score}/${latest.total} · ${escapeHtml(latest.title)} · ${escapeHtml(latest.date || "")}</div>
      </div>
      <div style="font-size:.74rem;opacity:.85;margin-top:6px;">This is a real timed result, not an estimate. Everything below (predicted score, true preparedness, bank coverage, Adaptive Ability Index) is a directional estimate meant to guide study — none of them are a validated probability of passing.</div>`;
    main.appendChild(lc);
  }
  const diagOn = !!state.predDiagrams;
  const pred = predictExam(md, undefined, diagOn);
  const card = document.createElement("div");
  card.style.cssText = "margin:6px 0 14px;padding:14px 16px;border-radius:14px;background:linear-gradient(135deg,var(--ink),var(--ink-2));color:#fff;";
  if (!pred || _bpAttempted(md) < 5) {
    card.innerHTML = `<div style="font-weight:800;font-size:1rem;margin-bottom:4px;">🔮 Predicted exam score <span style="font-weight:500;opacity:.75;font-size:.72rem;">(directional estimate)</span></div>
      <div style="font-size:.85rem;opacity:.9;">Practice some questions in <b>${md==="closed"?"closed-book":"with-notes"}</b> mode and this forecasts your 200-question exam result (score, likely range, and odds of clearing 75% / 90%). ${latest ? "Your latest mock above is the more reliable number until then." : ""}</div>`;
    main.appendChild(card); return;
  }
  const cal = recentMockAvg(md);
  const calLine = cal != null ? `<div style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,.25);font-size:.8rem;opacity:.95;">📏 Weighted <b>25%</b> toward your realistic-mock average (<b>${cal}%</b>) — mocks are the strongest readiness signal.</div>` : "";
  card.innerHTML = `
    <div style="font-weight:800;font-size:1rem;margin-bottom:6px;">🔮 Predicted exam score <span style="font-weight:500;opacity:.75;font-size:.72rem;">(directional estimate, not a validated pass probability)</span> <span style="font-weight:600;opacity:.85;font-size:.8rem;">· if it were today · ${md==="closed"?"closed-book":"with-notes"}</span></div>
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
var EXAM_MON = new Date(2026, 6, 20, 9, 0, 0); // Torso exam: Mon Jul 20 — HARD deadline, no fallback.
var READY_BAR = 75;                            // predicted % considered "ready"
// The Torso exam is Monday. There is NO late-exam fallback (a miss = zero), so the effective date is
// always Monday; `readyMon` only flags whether you're on track, it does NOT move the date.
function examInfo(mode) {
  const pred = predictExam(mode);
  const readyMon = !!pred && pred.meanPct >= READY_BAR;
  const date = EXAM_MON;
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
  rows.push([wd(d.exam.date), `💪 EXAM DAY — Torso (Monday). No retake, so be ready.`]);
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
  const gapPct = Math.max(0, READY_BAR - predPct);   // gap is in PERCENTAGE POINTS of the predicted score
  // Torso exam = 200 questions / 250 points → convert the abstract percentage gap into concrete, unambiguous
  // units too. "Need +27 pts" used to read as if it meant raw exam points (out of 250) or questions — it was
  // actually percentage points of the Monte-Carlo prediction. Show all three so nothing is misread.
  const gapQs = Math.round(gapPct / 100 * 200);
  const gapExamPts = Math.round(gapPct / 100 * 250);
  const targetTxt = d.exam.readyMon
    ? `On track for <b>Monday</b> (predicted ${predPct}%).`
    : `At <b>${predPct}%</b> you're below the 75% bar — and Monday is a hard deadline (no retake). Every hour counts.`;
  let html = `<div style="font-weight:800;font-size:1rem;color:#B5560F;margin-bottom:2px;">📋 Your plan — ${d.exam.days} day${d.exam.days===1?"":"s"} to go</div>
    <div style="font-size:.82rem;color:#666;margin-bottom:10px;">${targetTxt}${gapPct>0?` Need <b>+${gapPct} percentage points</b> to clear 75% — roughly <b>${gapQs} more questions</b> right (out of 200) / <b>${gapExamPts} exam points</b> (out of 250).`:` 🎉`} Fastest path up, biggest lever first:</div>`;
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
    steps.push(`<b>Sample your blind spots.</b> You don't need all <b>${d.untried.toLocaleString()}</b> untried questions — a representative <b>~40 per weak system</b> is enough to prove you know it (that's how Preparedness scores it). Start with ${wnames || "your weakest systems"}.`);
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
    <div style="font-weight:700;font-size:.82rem;color:#B5560F;margin-bottom:5px;">Day-by-day (Torso exam is Monday)</div>
    ${plan.map(p=>`<div style="font-size:.82rem;color:#444;margin:3px 0;"><b style="color:var(--ink);">${p[0]}:</b> ${p[1]}</div>`).join("")}</div>`;
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
  head.style.cssText = "margin:2px 0 12px;padding:14px 16px;border-radius:14px;background:linear-gradient(135deg,var(--ink),var(--ink-2));color:#fff;";
  head.innerHTML = `<div style="font-weight:800;font-size:1.05rem;">${md==="closed"?"Closed-book":"With-notes"} · predicted ${pred?pred.meanPct:0}%</div>
    <div style="font-size:.86rem;opacity:.95;margin-top:4px;">${info.readyMon?`On track for <b>Monday</b>.`:`Below the 75% bar — and Monday is a hard deadline (no retake). ${pred?`P(≥75%) is ${pred.p75}%.`:""}`}</div>
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
      bh += `<div style="font-size:.84rem;color:#333;margin-top:8px;line-height:1.5;">🚩 Of <b>${beh.flagTotal}</b> flagged question${beh.flagTotal===1?"":"s"}, you got <b>${facc}%</b> right. ${facc < 60 ? "Flagging is catching your genuinely-shaky ones — always leave time to revisit them." : "You flag conservatively and usually nail them."} <span style="color:#777;">Flagged items count as "not solid yet" in your readiness (even if right) until you re-answer them unflagged.</span></div>`;
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
  chHdr.style.cssText = "font-size:.82rem;color:var(--ink);font-weight:800;margin-bottom:2px;";
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
  missBtn.style.cssText = "display:block;width:100%;margin:18px 0 0;background:var(--ink);color:#fff;border:none;border-radius:12px;padding:13px;font-size:.95rem;font-weight:700;cursor:pointer;";
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
function _prepBandColor(v) { return v >= 80 ? "#2E7D32" : v >= 65 ? "var(--ink)" : v >= 50 ? "#E67E22" : "#C62828"; }
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
      <div style="font-weight:800;font-size:1rem;color:${col};">🧭 True preparedness <span style="font-weight:500;color:#999;font-size:.68rem;">(directional estimate)</span></div>
      <div style="font-size:2rem;font-weight:800;line-height:1;color:${col};">${p.overall}%</div>
      <div style="font-size:.82rem;color:#666;">${md==="closed"?"closed-book":"with-notes"} · ${confNote}</div>
    </div>
    <div style="font-size:.9rem;font-weight:700;color:${col};margin:6px 0 2px;">${verdict}</div>
    <div style="font-size:.76rem;color:#888;line-height:1.4;margin-bottom:8px;">Skill on what you've practiced × how broadly you've sampled (a solid ~40-question sample per region counts as representative — you don't have to finish the whole bank) × a memorizing-vs-mastering check. This estimates readiness to guide study — it is not a validated pass probability; your latest full timed mock is the more reliable signal.</div>`;
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
    b.style.cssText = `border:1.5px solid ${on?"var(--ink)":"#ccc"};background:${on?"var(--ink)":"#fff"};color:${on?"#fff":"#555"};border-radius:20px;padding:7px 14px;font-size:.85rem;font-weight:700;cursor:pointer;`;
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

  // Trends & habits (second-guessing over time, weakest Martini pages, fuzzy count)
  try { appendProgressGraph(main, "torso"); } catch (e) {}
  try { appendTrendsCard(main, "torso"); } catch (e) {}

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
  sysHdr.style.cssText = "font-size:.82rem;color:var(--ink);font-weight:800;margin-bottom:2px;";
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
  missBtn.style.cssText = "display:block;width:100%;margin:16px 0 0;background:var(--ink);color:#fff;border:none;border-radius:12px;padding:13px;font-size:.95rem;font-weight:700;cursor:pointer;";
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
  if (typeof CLAUDEBANK_APPENDICULAR !== "undefined") CLAUDEBANK_APPENDICULAR.forEach(sec => (sec.questions || []).forEach(q => add(q, null)));
  if (typeof CLAUDEBANK_AXIAL !== "undefined") CLAUDEBANK_AXIAL.forEach(sec => (sec.questions || []).forEach(q => add(q, null)));
  if (typeof STUVIA_BANK !== "undefined") { STUVIA_BANK.forEach(sec => (sec.questions || []).forEach(q => add(q, null))); }
  if (typeof STUVIA_AXIAL !== "undefined") { STUVIA_AXIAL.forEach(sec => (sec.questions || []).forEach(q => add(q, q.ch || null))); }
  if (typeof STUVIA_APPENDICULAR !== "undefined") { STUVIA_APPENDICULAR.forEach(sec => (sec.questions || []).forEach(q => add(q, q.ch || null))); }
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
    try { const R = resolveBookReference(Object.assign({}, meta, { id: r.id })); pg = R.page || (R.locator && R.locator.page) || null; if (R.ch) ch = R.ch; } catch (e) {}
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
  copy.style.cssText = "flex:1;background:var(--ink);color:#fff;border:none;border-radius:10px;padding:9px;font-weight:700;font-size:.85rem;cursor:pointer;";
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
let fullExamLogged = false;       // guards renderFullExamEnd so an exam records its stats/History only once
// Pacing + review-behavior signals (captured per exam, stored in the attempt record):
let fullExamStartedAt = 0;        // wall-clock start (ms)
let fullExamTotalSeconds = 6000;  // time budget for this exam
let fullExamRevisits = 0;         // times you navigated back to an already-answered question (review behavior)
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
  btn.style.cssText = "display:block;width:100%;background:var(--ink);color:#fff;border:none;border-radius:12px;padding:13px;font-size:1rem;font-weight:700;cursor:pointer;";
  btn.onclick = () => { clearExamAutoAdv(); examAdvance(); };
  const hint = document.createElement("div");
  hint.style.cssText = "font-size:0.75rem;color:#aaa;margin-top:6px;";
  hint.textContent = "Press Space or tap Next → to continue · auto-advances in 3s · 🚩 report above if it's wrong";
  // Martini reference + lookup for this GR question
  const q = examDeck[examIndex];
  if (q) {
    try {
      const R = resolveBookReference(q);
      const page = R.page || (R.locator && R.locator.page) || null; const ch = R.ch;
      if (ch || page) {
        const cm = ch ? CHAP_META[ch] : null;
        const cite = document.createElement("div");
        cite.style.cssText = "font-size:.8rem;color:#777;margin:2px 0 8px;line-height:1.4;";
        cite.innerHTML = cm
          ? `📖 <b>Martini Ch ${ch}</b> — ${escapeHtml(cm.name)}${page ? ` &nbsp;·&nbsp; <b>p. ${page}</b>` : ""}`
          : `📖 <b>Martini</b>${page ? ` &nbsp;·&nbsp; p. ${page}` : ""}`;
        wrap.appendChild(cite);
      }
    } catch (e) {}
    const look = document.createElement("button");
    look.textContent = "📖 Look it up in Martini";
    look.style.cssText = "display:block;width:100%;margin:0 0 8px;background:#fff;color:var(--ink);border:1.5px solid #cfe0f2;border-radius:12px;padding:11px;font-size:.9rem;font-weight:700;cursor:pointer;";
    look.onclick = () => { clearExamAutoAdv(); showTextbookPanel(q.q, q.options[q.correct], q); };
    wrap.appendChild(look);
    { const nb = notesBtn(q); if (nb) { nb.style.cssText = "display:block;width:100%;margin:0 0 8px;background:#fff;color:var(--ink);border:1.5px solid #cfe0f2;border-radius:12px;padding:11px;font-size:.9rem;font-weight:700;cursor:pointer;"; nb.onclick = () => { clearExamAutoAdv(); openNotesPanel(qRegionSection(q.id)); }; wrap.appendChild(nb); } }
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
    <div style="font-weight:800;font-size:1.15rem;color:var(--ink);margin-bottom:4px;">Before you start…</div>
    <div style="color:#666;font-size:.92rem;margin-bottom:22px;">Are you using your notes for this session? This keeps your <b>true (closed-book)</b> score separate from your <b>with-notes</b> score.</div>`;
  const mk = (label, sub, mode, bg) => {
    const b = document.createElement("button");
    b.className = "primaryBtn";
    b.style.cssText = `display:block;width:100%;margin:10px 0;background:${bg};color:#fff;border:none;border-radius:12px;padding:14px;font-size:1rem;font-weight:700;cursor:pointer;`;
    b.innerHTML = `${label}<div style="font-weight:400;font-size:.78rem;opacity:.9;margin-top:2px;">${sub}</div>`;
    b.onclick = () => { setStudyMode(mode); sessionModeSet = true; render(); };
    return b;
  };
  wrap.appendChild(mk("🧠 Closed-book", "No notes — my true recall", "closed", "var(--ink)"));
  wrap.appendChild(mk("📖 Open-book", "Using my notes", "open", "var(--ink-2)"));
  main.appendChild(wrap);
}

function renderDiagramGate(main) {
  const nDiag = examDeck.filter(isDiagramQ).length;
  const wrap = document.createElement("div");
  wrap.style.cssText = "max-width:460px;margin:40px auto 0;text-align:center;padding:0 16px;";
  wrap.innerHTML = `
    <div style="font-size:2rem;margin-bottom:6px;">🖼️</div>
    <div style="font-weight:800;font-size:1.15rem;color:var(--ink);margin-bottom:4px;">Include diagram questions?</div>
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
  wrap.appendChild(mk("🚫 Skip diagrams", "Text/recall questions only", false, "var(--ink)"));
  wrap.appendChild(mk("🖼️ Include diagrams", "Flash-test the images too", true, "var(--ink-2)"));
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

  // Shuffle options — cached per QUESTION (by id), not per index, so a new exam at the
  // same position can't reuse the previous question's options (stem/answer mismatch).
  const _eKey = (q && q.id != null ? "eid:" + q.id : "eix:" + examIndex);
  if (_eShCache.key !== _eKey) { _eShCache.key = _eKey; _eShCache.opts = shuffle([...q.options]); }
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
  // Convert shuffled display index to original option index (key must match renderExam's)
  const _eKey = (q && q.id != null ? "eid:" + q.id : "eix:" + examIndex);
  const origIdx = (_eShCache.opts.length && _eShCache.key === _eKey)
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
      fb.textContent = isCorrect ? "✅ Correct! Removed from missed list on Next." : "❌ Wrong — keeping it in the pool.";
      fb.style.color = isCorrect ? "#27ae60" : "#c0392b";
      const advance = () => {
        if (isCorrect) {
          const key = q.q.slice(0, 80);
          missedDeck.splice(qi, 1);
          const pool = loadMissedQs().filter(m => m.q.slice(0, 80) !== key);
          saveMissedQs(pool);
          if (missedIndex >= missedDeck.length && missedIndex > 0) missedIndex = 0;
        } else {
          missedDeck.splice(qi, 1); missedDeck.push(q);
          if (missedIndex >= missedDeck.length) missedIndex = 0;
        }
        missedAnswered = false; missedSelected = -1; render();
      };
      // Martini reference + lookup (routed through resolveBookReference) + notes + manual Next
      const refWrap = document.createElement("div"); refWrap.style.cssText = "margin-top:14px;";
      const ansText = q.tf ? (["True", "False"][q.correct] || "") : (q.options ? q.options[q.correct] : "");
      try {
        const R = resolveBookReference(q);
        const page = R.page || (R.locator && R.locator.page) || null, ch = R.ch;
        if (ch || page) {
          const cm = ch ? CHAP_META[ch] : null;
          const cite = document.createElement("div");
          cite.style.cssText = "text-align:center;font-size:.8rem;color:#777;margin:6px 0;line-height:1.4;";
          cite.innerHTML = cm ? `📖 <b>Martini Ch ${ch}</b> — ${escapeHtml(cm.name)}${page ? ` &nbsp;·&nbsp; <b>p. ${page}</b>` : ""}` : `📖 <b>Martini</b>${page ? ` &nbsp;·&nbsp; p. ${page}` : ""}`;
          refWrap.appendChild(cite);
        }
      } catch (e) {}
      const look = document.createElement("button"); look.className = "tbLookBtn"; look.style.cssText = "display:block;width:100%;margin:6px 0;"; look.innerHTML = "📖 Look it up in Martini";
      look.onclick = () => showTextbookPanel(q.q, ansText, q);
      refWrap.appendChild(look);
      { const nb = notesBtn(q); if (nb) { nb.style.cssText = "display:block;width:100%;margin:6px 0;background:#fff;color:var(--ink);border:1.5px solid #cfe0f2;border-radius:12px;padding:11px;font-size:.9rem;font-weight:700;cursor:pointer;"; nb.onclick = () => openNotesPanel(qRegionSection(q.id)); refWrap.appendChild(nb); } }
      const nextB = document.createElement("button"); nextB.className = "primaryBtn"; nextB.style.cssText += "width:100%;max-width:none;margin:6px 0;"; nextB.textContent = "Next →"; nextB.onclick = advance;
      refWrap.appendChild(nextB);
      main.appendChild(refWrap);
    };
    main.appendChild(btn);
  });
}

/* ─── Fuzzy drill: practice exactly the flip-flop questions ───
   Snapshots the current fuzzy set into its own deck, records answers through the normal
   recordQuestionStat path (so mastery/retention update), and — unlike Missed Review — does NOT
   mutate the persistent missed pool. Wrong answers requeue to the end; correct ones drop out. */
function startFuzzyDrill() {
  const md = getStudyMode();
  const qs = activeProgress().qstats || {};
  const idx = (typeof buildQuestionIndex === "function") ? buildQuestionIndex() : {};
  let deck = [];
  Object.keys(qs).forEach(id => {
    if (typeof isFuzzy !== "function" || !isFuzzy(id, md)) return;
    const q = idx[id];
    if (q && (q.q || q.question) && q.options && q.options.length >= 2 && typeof q.correct === "number"
        && !isDiagramQ(q) && !isFITBQ(q) && !hasDupOptions(q)) deck.push(q);
  });
  deck = dedupeQs(deck);
  if (!deck.length) { alert("No fuzzy questions right now — you're steady on everything you've practiced."); return; }
  fuzzyDeck = shuffle(deck); fuzzyIndex = 0; fuzzyAnswered = false; fuzzyRecallRevealed = false; fuzzyStartCount = fuzzyDeck.length;
  state._drillTitle = null;   // plain fuzzy drill
  state._sprintNote = null;
  state._fuzzyBack = (state.sectionKey && state.sectionKey !== "torso") ? "preparednessGeneric" : "preparedness";
  state.route = "fuzzyReview"; render();
}
/* Drill the questions that map to ONE Martini page — so "read p.451 → test it" actually tests p.451.
   Reuses the fuzzy-review flow (records via recordQuestionStat, no missed-pool side effects). */
function startPageDrill(page) {
  if (typeof Q_BOOKLOC === "undefined") { startFuzzyDrill(); return; }
  const idx = (typeof buildQuestionIndex === "function") ? buildQuestionIndex() : {};
  let deck = [];
  Object.keys(Q_BOOKLOC).forEach(id => {
    const loc = Q_BOOKLOC[id]; const p = loc && (loc.p || loc.page);
    if (p !== page) return;
    const q = idx[id];
    // Real MCQs only: no fill-in-blanks (lone option), no diagram-answer-in-stem, no dup-option items.
    if (q && (q.q || q.question) && q.options && q.options.length >= 2 && typeof q.correct === "number"
        && !isDiagramQ(q) && !isFITBQ(q) && !hasDupOptions(q)) deck.push(q);
  });
  deck = dedupeQs(deck);   // collapse identical copies (e.g. page 451's 3 "unpaired ganglia" duplicates)
  if (!deck.length) { alert("No testable questions are mapped to p." + page + " yet — drilling your fuzzy set instead."); startFuzzyDrill(); return; }
  fuzzyDeck = shuffle(deck); fuzzyIndex = 0; fuzzyAnswered = false; fuzzyRecallRevealed = false; fuzzyStartCount = fuzzyDeck.length;
  state._drillTitle = "Martini p. " + page;
  state._sprintNote = null;
  state._fuzzyBack = "home";
  state.route = "fuzzyReview"; render();
}
/* ─── 10-minute Sprint: rotating weak-area micro-session ───
   Uses the preparedness engine to rank the Torso regions weakest-first, rotates through them (every
   10 min on the home card, or on demand), and serves 3–5 of your weakest questions from that region
   plus one written free-recall item. Read the region's notes, then test it. */
function sprintRankedRegions() {
  const md = (typeof getStudyMode === "function" ? getStudyMode() : "closed");
  const regions = ["Thorax", "Abdomen", "Pelvis", "Systemic"];
  return regions
    .map(r => ({ r, v: (typeof blueprintReadiness === "function" ? blueprintReadiness(r, md) : null) }))
    .sort((a, b) => ((a.v == null ? 999 : a.v) - (b.v == null ? 999 : b.v)));  // weakest first (null = untested = top)
}
function sprintFocus() { const ranked = sprintRankedRegions(); return ranked.length ? ranked[sprintRot % ranked.length].r : "Thorax"; }
function startSprint(focus) {
  focus = focus || sprintFocus();
  const md = (typeof getStudyMode === "function" ? getStudyMode() : "closed");
  const idx = (typeof buildQuestionIndex === "function") ? buildQuestionIndex() : {};
  const src = (typeof blueprintSources === "function") ? blueprintSources() : {};
  const ids = (src[focus] || []).map(o => o.id);
  let deck = [];
  ids.forEach(id => {
    const q = idx[id];
    if (q && q.q && q.options && q.options.length >= 2 && typeof q.correct === "number"
        && !isDiagramQ(q) && !isFITBQ(q) && !hasDupOptions(q)) deck.push(q);
  });
  deck = dedupeQs(deck);
  if (!deck.length) { alert("Not enough clean questions for a " + focus + " sprint yet — try a mock first."); return; }
  // weakest first (lowest current recall), then take up to 5
  deck.sort((a, b) => (qRecall(a.id, md)) - (qRecall(b.id, md)));
  deck = deck.slice(0, 5).map(q => Object.assign({}, q));
  deck = shuffle(deck);
  if (deck.length >= 3) deck[deck.length - 1].recall = true;   // 1 written free-recall item (MC is the priority)
  fuzzyDeck = deck; fuzzyIndex = 0; fuzzyAnswered = false; fuzzyRecallRevealed = false; fuzzyStartCount = deck.length;
  state._drillTitle = "Sprint · " + focus;
  state._sprintNote = focus;      // region → shows a "skim your notes" banner + Open-notes button
  state._fuzzyBack = "home";
  state.route = "fuzzyReview"; render();
}
/* Lab 2 structure/tissue/function drill (from the worksheet-based LAB2_BANK). Reuses the review flow. */
function startLab2BankDrill() {
  if (typeof LAB2_BANK === "undefined" || !LAB2_BANK.length) { alert("Lab 2 question bank isn't loaded."); return; }
  let deck = [];
  LAB2_BANK.forEach(grp => (grp.questions || []).forEach(q => {
    if (q && q.q && q.options && q.options.length >= 2 && typeof q.correct === "number")
      deck.push(Object.assign({}, q, { options: q.options.map(o => o.replace(/^[A-E]\.\s*/, "")) }));
  }));
  deck = dedupeQs(deck);
  if (!deck.length) { alert("No Lab 2 questions available."); return; }
  fuzzyDeck = shuffle(deck); fuzzyIndex = 0; fuzzyAnswered = false; fuzzyRecallRevealed = false; fuzzyStartCount = fuzzyDeck.length;
  state._drillTitle = "Lab 2 — Structures & Tissues";
  state._sprintNote = null;
  state._fuzzyBack = "modes";
  state.route = "fuzzyReview"; render();
}
function renderFuzzyReview(main) {
  if (fuzzyDeck.length === 0) {
    const wrap = document.createElement("div");
    wrap.style.cssText = "text-align:center;padding:48px 20px;";
    wrap.innerHTML = `<div style="font-size:3.5rem;margin-bottom:12px;">🎯</div>
      <div style="font-size:1.4rem;font-weight:700;margin-bottom:8px;color:var(--text);">Fuzzy set cleared!</div>
      <div style="color:#888;margin-bottom:28px;">You got each of these right this round. Re-test cold later to make it stick.</div>`;
    const backBtn = document.createElement("button");
    backBtn.className = "secondaryBtn";
    backBtn.textContent = "Back to Preparedness";
    backBtn.onclick = () => { fuzzyDeck = []; state.route = state._fuzzyBack || "home"; render(); };
    wrap.appendChild(backBtn);
    main.appendChild(wrap);
    return;
  }
  const qi = fuzzyIndex % fuzzyDeck.length;
  const q = fuzzyDeck[qi];
  const remaining = fuzzyDeck.length;
  const cleared = fuzzyStartCount - remaining;
  const pct = fuzzyStartCount ? Math.round(cleared / fuzzyStartCount * 100) : 0;

  const counter = document.createElement("div");
  counter.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;font-size:.88rem;color:#888;";
  counter.innerHTML = `<span>${state._drillTitle ? "📖 " + escapeHtml(state._drillTitle) : "🎲 Fuzzy drill"}</span><span style="font-weight:700;color:var(--accent);">${remaining} left</span>`;
  main.appendChild(counter);

  const pgBar = document.createElement("div");
  pgBar.style.cssText = "height:6px;background:#eee;border-radius:3px;margin-bottom:18px;overflow:hidden;";
  pgBar.innerHTML = `<div style="height:100%;width:${pct}%;background:var(--accent);border-radius:3px;transition:width .3s;"></div>`;
  main.appendChild(pgBar);

  // Sprint "skim your notes" banner (with a one-tap Open-notes button)
  if (state._sprintNote && typeof NOTES_PDF !== "undefined" && NOTES_PDF[String(state._sprintNote).toLowerCase()]) {
    const nk = String(state._sprintNote).toLowerCase();
    const ban = document.createElement("div");
    ban.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:10px;background:#e7f1ea;border:1px solid #bcd8cc;border-radius:10px;padding:9px 12px;margin-bottom:14px;font-size:.85rem;color:var(--accent-ink);";
    ban.innerHTML = `<span>📖 First, skim your <b>${escapeHtml(state._sprintNote)}</b> notes.</span>`;
    const ob = document.createElement("button");
    ob.textContent = "Open notes";
    ob.style.cssText = "background:var(--accent);color:#fff;border:none;border-radius:8px;padding:6px 12px;font-size:.8rem;font-weight:700;cursor:pointer;white-space:nowrap;";
    ob.onclick = () => { try { openNotesPanel(nk); } catch (e) {} };
    ban.appendChild(ob);
    main.appendChild(ban);
  }

  const stem = document.createElement("div");
  stem.style.cssText = "font-size:1.05rem;font-weight:600;color:var(--text);margin-bottom:20px;line-height:1.55;";
  stem.textContent = q.q || q.question;
  main.appendChild(stem);

  const fb = document.createElement("div");
  fb.style.cssText = "min-height:24px;font-size:.95rem;font-weight:600;margin-bottom:10px;text-align:center;";
  main.appendChild(fb);

  // Written free-recall item (sprint): no options — recall it, reveal, self-grade.
  if (q.recall) {
    if (!fuzzyRecallRevealed) {
      const p = document.createElement("div");
      p.style.cssText = "font-size:.9rem;color:var(--muted);text-align:center;margin-bottom:12px;";
      p.textContent = "✍️ Written recall — answer in your own words (out loud or on paper), then reveal.";
      main.appendChild(p);
      const rb = document.createElement("button");
      rb.className = "primaryBtn"; rb.style.cssText += "width:100%;max-width:none;";
      rb.textContent = "Reveal answer";
      rb.onclick = () => { fuzzyRecallRevealed = true; render(); };
      main.appendChild(rb);
    } else {
      const ans = document.createElement("div");
      ans.style.cssText = "background:#e7f1ea;border:1px solid #bcd8cc;border-radius:12px;padding:13px 15px;margin-bottom:12px;font-size:1rem;font-weight:700;color:var(--accent-ink);";
      ans.textContent = "Answer: " + (q.tf ? ["True", "False"][q.correct] : (q.options[q.correct] || ""));
      main.appendChild(ans);
      const row = document.createElement("div"); row.style.cssText = "display:flex;gap:10px;";
      const grade = (ok) => {
        if (fuzzyAnswered) return; fuzzyAnswered = true;
        try { recordQuestionStat(q, ok, null, false); } catch (e) {}
        setTimeout(() => { fuzzyDeck.splice(qi, 1); if (!ok) fuzzyDeck.push(q); if (fuzzyIndex >= fuzzyDeck.length) fuzzyIndex = 0; fuzzyAnswered = false; fuzzyRecallRevealed = false; render(); }, 500);
      };
      const miss = document.createElement("button"); miss.className = "secondaryBtn"; miss.style.cssText += "flex:1;margin:0;border-color:var(--danger);color:var(--danger);"; miss.textContent = "👎 Missed it"; miss.onclick = () => grade(false);
      const got = document.createElement("button"); got.className = "primaryBtn"; got.style.cssText += "flex:1;margin:0;"; got.textContent = "👍 Got it"; got.onclick = () => grade(true);
      row.append(miss, got); main.appendChild(row);
    }
    return;
  }

  const opts = q.tf ? ["True", "False"] : (q.options || []);
  opts.forEach((opt, i) => {
    const btn = document.createElement("button");
    btn.className = "examOption";
    btn.textContent = opt;
    btn.onclick = () => {
      if (fuzzyAnswered) return;
      fuzzyAnswered = true;
      const isCorrect = (i === q.correct);
      btn.classList.add(isCorrect ? "correct" : "wrong");
      document.querySelectorAll(".examOption").forEach((b, j) => { b.disabled = true; if (j === q.correct) b.classList.add("correct"); });
      fb.textContent = isCorrect ? "✅ Correct — cleared for this round." : "❌ Not quite — it goes back in the pile.";
      fb.style.color = isCorrect ? "#27ae60" : "#c0392b";
      try { recordQuestionStat(q, isCorrect, null, false); } catch (e) {}
      setTimeout(() => {
        fuzzyDeck.splice(qi, 1);
        if (!isCorrect) fuzzyDeck.push(q);   // requeue misses to the end
        if (fuzzyIndex >= fuzzyDeck.length) fuzzyIndex = 0;
        fuzzyAnswered = false;
        render();
      }, 900);
    };
    main.appendChild(btn);
  });
}

/* ─── Lab 2 Model Practical: recognition + self-grade over real class-model photos ───
   Mirrors how the in-person practical actually feels: look at the model, name it, reveal, self-grade.
   `weakOnly` builds the deck from your shakiest stations (by miss-rate). Timed = ~60s/station. */
function _l2ClearTimer() { if (l2Timer) { clearInterval(l2Timer); l2Timer = null; } }
function startLab2Practical(timed, weakOnly) {
  if (typeof LAB2_MODELS === "undefined" || !LAB2_MODELS.length) { alert("No lab model photos loaded yet."); return; }
  let pool = LAB2_MODELS.slice();
  if (weakOnly) {
    const st = loadL2Stats();
    pool = pool.filter(m => { const e = st[m.id]; return e && e.seen && (e.missed / e.seen) >= 0.34; });
    if (!pool.length) { alert("No weak stations yet — do a full round first, then this drills the ones you miss."); return; }
  }
  l2Deck = shuffle(pool); l2Index = 0; l2Revealed = false; l2Timed = !!timed; l2StartCount = l2Deck.length;
  l2FirstScored = new Set(); l2FirstCorrect = 0; l2Recovered = 0; l2TimedOut = false; l2StationLocked = false;
  state.route = "lab2Station"; render();
}
function _l2StartTimer() {
  _l2ClearTimer();
  if (!l2Timed) return;
  l2SecLeft = 60;
  l2Timer = setInterval(() => {
    l2SecLeft--;
    const el = document.getElementById("l2timer");
    if (el) { el.textContent = l2SecLeft + "s"; el.style.color = l2SecLeft <= 10 ? "#C0392B" : "var(--muted)"; }
    if (l2SecLeft <= 0) {
      _l2ClearTimer();
      if (!l2Revealed) {
        l2Revealed = true; l2TimedOut = true;
        _l2ScoreCurrent(false);   // IMMUTABLE first-pass: lock the miss in right now, don't wait for Next —
                                  // if the student leaves the station/route without pressing Next, it still counts.
        render();
      }
    }
  }, 1000);
}
// Records the first-pass result for the CURRENT station exactly once. Safe to call more than once
// (e.g. a timeout locks the miss immediately; the eventual "Next →" click just advances) because the
// l2StationLocked guard makes every call after the first a no-op — the result can't be overwritten.
function _l2ScoreCurrent(ok) {
  if (l2StationLocked) return;
  const m = l2Deck[l2Index]; if (!m) return;
  const first = !l2FirstScored.has(m.id);        // first attempt at this station THIS round?
  if (first) { l2FirstScored.add(m.id); if (ok) l2FirstCorrect++; }
  else if (ok) { l2Recovered++; }                // got it on a requeue = recovery, NOT first-pass score
  recordL2(m.id, ok, first);                     // syncs; first-pass tracked separately
  if (!ok) l2Deck.push(m);                        // requeue for more practice (doesn't change the score)
  l2StationLocked = true;
}
function renderLab2Station(main) {
  if (!l2Deck.length) { _l2ClearTimer(); state.route = "modes"; render(); return; }
  // Finished-all state
  if (l2Index >= l2Deck.length) {
    _l2ClearTimer();
    const pct = l2StartCount ? Math.round(l2FirstCorrect / l2StartCount * 100) : 0;   // FIRST-PASS score (the honest one)
    const wrap = document.createElement("div"); wrap.style.cssText = "text-align:center;padding:40px 20px;";
    wrap.innerHTML = `<div style="font-size:3.2rem;">${pct >= 80 ? "🏆" : pct >= 60 ? "🎯" : "📸"}</div>
      <div style="font-size:1.5rem;font-weight:800;color:var(--text);margin:8px 0;">Round complete</div>
      <div style="font-size:.72rem;font-weight:800;letter-spacing:.08em;color:var(--muted);">FIRST-PASS SCORE</div>
      <div style="font-size:2rem;font-weight:900;color:var(--accent);">${l2FirstCorrect}/${l2StartCount} · ${pct}%</div>
      <div style="color:#888;margin:6px 0 26px;">${l2Recovered ? `+${l2Recovered} recovered on retry (not counted in the score above). ` : ""}First attempt only — that's what the practical measures. Be honest self-grading.</div>`;
    const again = document.createElement("button"); again.className = "primaryBtn"; again.style.maxWidth = "320px"; again.textContent = "🔁 Go again"; again.onclick = () => startLab2Practical(l2Timed);
    const weak = document.createElement("button"); weak.className = "secondaryBtn"; weak.style.maxWidth = "320px"; weak.textContent = "🎯 Drill weak stations"; weak.onclick = () => startLab2Practical(l2Timed, true);
    const back = document.createElement("button"); back.className = "secondaryBtn"; back.style.maxWidth = "320px"; back.textContent = "Back to Lab 2"; back.onclick = () => { l2Deck = []; state.route = "modes"; render(); };
    wrap.append(again, weak, back); main.appendChild(wrap);
    return;
  }
  const m = l2Deck[l2Index];

  // status bar
  const bar = document.createElement("div");
  bar.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;font-size:.85rem;color:var(--muted);";
  // Don't reveal the system before answering — that gives the identification away. Show it only after Reveal.
  bar.innerHTML = `<span>📸 Station ${l2Index + 1} / ${l2StartCount}</span>` +
    (l2Timed ? `<span id="l2timer" style="font-weight:800;font-variant-numeric:tabular-nums;">${l2SecLeft || 60}s</span>` : `<span>${l2Revealed ? m.system : "identify it"}</span>`);
  main.appendChild(bar);

  // the model photo (tap to enlarge)
  const img = document.createElement("img");
  img.src = m.file; img.alt = "lab model";
  img.style.cssText = "width:100%;max-height:52vh;object-fit:contain;background:#111;border-radius:12px;cursor:zoom-in;";
  img.onclick = () => {
    const ov = document.createElement("div");
    ov.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:99999;display:flex;align-items:center;justify-content:center;cursor:zoom-out;";
    const big = document.createElement("img"); big.src = m.file; big.style.cssText = "max-width:98vw;max-height:98vh;object-fit:contain;";
    ov.appendChild(big); ov.onclick = () => ov.remove(); document.body.appendChild(ov);
  };
  main.appendChild(img);

  const prompt = document.createElement("div");
  prompt.style.cssText = "font-size:1.05rem;font-weight:700;color:var(--text);margin:14px 0 10px;text-align:center;";
  prompt.textContent = "What model / structure / view is this? Say it out loud, then reveal.";
  main.appendChild(prompt);

  if (!l2Revealed) {
    const reveal = document.createElement("button");
    reveal.className = "primaryBtn"; reveal.style.cssText += "width:100%;max-width:none;";
    reveal.textContent = "Reveal answer";
    reveal.onclick = () => { _l2ClearTimer(); l2Revealed = true; render(); };
    main.appendChild(reveal);
    _l2StartTimer();
  } else {
    const ans = document.createElement("div");
    ans.style.cssText = "background:#e7f1ea;border:1px solid #bcd8cc;border-radius:12px;padding:14px 16px;margin-bottom:12px;";
    ans.innerHTML = `<div style="font-size:1.05rem;font-weight:800;color:var(--accent-ink);">${escapeHtml(m.answer)}</div>
      <div style="font-size:.86rem;color:#4a5a52;margin-top:6px;line-height:1.5;">${escapeHtml(m.hint)}</div>` +
      (m.verify ? `<div style="font-size:.78rem;color:#B7791F;margin-top:8px;">⚠️ Best-guess ID — confirm this one against your lab key.</div>` : "");
    main.appendChild(ans);

    const grade = (ok) => {
      _l2ScoreCurrent(ok);   // no-op if a timeout already locked this station's result — can't double-record
      l2Index++; l2Revealed = false; l2TimedOut = false; l2StationLocked = false; render();
    };

    if (l2TimedOut) {
      // Timeout = automatic miss. Show the answer (so you learn it), then a single Next.
      const to = document.createElement("div");
      to.style.cssText = "background:#f7e7e2;border:1px solid #e6b8ac;border-radius:12px;padding:11px 14px;margin-bottom:12px;font-size:.9rem;font-weight:700;color:var(--danger);text-align:center;";
      to.textContent = "⏱ Time's up — scored as a miss.";
      main.appendChild(to);
      const nxt = document.createElement("button");
      nxt.className = "primaryBtn"; nxt.style.cssText += "width:100%;max-width:none;";
      nxt.textContent = "Next →";
      nxt.onclick = () => grade(false);
      main.appendChild(nxt);
    } else {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;gap:10px;";
      const miss = document.createElement("button");
      miss.className = "secondaryBtn"; miss.style.cssText += "flex:1;margin:0;border-color:var(--danger);color:var(--danger);";
      miss.textContent = "👎 Missed it";
      miss.onclick = () => grade(false);
      const got = document.createElement("button");
      got.className = "primaryBtn"; got.style.cssText += "flex:1;margin:0;";
      got.textContent = "👍 Got it";
      got.onclick = () => grade(true);
      row.append(miss, got);
      main.appendChild(row);
      const t = document.createElement("div");
      t.style.cssText = "text-align:center;margin-top:14px;";
      t.innerHTML = `<span style="font-size:.78rem;color:var(--muted);">Tip: ⏱ timed mode (60s/station, timeout = miss) mimics exam pressure — toggle it on the end screen.</span>`;
      main.appendChild(t);
    }
  }
}

// initApp() is invoked at the VERY END of this file (see bottom) so that every
// module-level const/let (SECTION_GROUPS, CAT_CONFIG, etc.) is initialized before
// the first render — a restored route on load can safely reference any of them.

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
    {
      id: "preparednessGeneric",
      icon: "🎯",
      title: "Preparedness Score",
      sub: "Section readiness + adaptive CAT (experimental)",
      condition: ["appendicular","axial","cumulative"].includes(state.sectionKey),
      bg: "linear-gradient(135deg,#5B21B6 0%,#4338CA 100%)",  // violet
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
      condition: ["torso","appendicular","axial"].includes(state.sectionKey) && !!(activeClaudeBank() && activeClaudeBank().length),
    },
    {
      id: "missedRoot",
      icon: "🔁",
      title: "Missed Questions",
      sub: "Re-do everything you've gotten wrong in this section",
      condition: ["torso","appendicular","axial"].includes(state.sectionKey),
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
      condition: !!(activeStuvia() && activeStuvia().length),   // Torso + Axial have Stuvia banks
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
  let paceN = 0, usedSec = 0, leftSec = 0, totalSec = 0, revisits = 0;
  allAttempts().forEach(a => {
    const c = a.rec.changes, f = a.rec.flags, p = a.rec.pacing;
    if (c) { b.r2w += c.r2w || 0; b.w2r += c.w2r || 0; b.w2w += c.w2w || 0; }
    if (f) { b.flagTotal += f.total || 0; b.flagRight += f.right || 0; }
    if (p && p.totalSec) { paceN++; usedSec += p.usedSec || 0; leftSec += p.leftSec || 0; totalSec += p.totalSec || 0; revisits += p.revisits || 0; }
  });
  b.totalChanges = b.r2w + b.w2r + b.w2w;
  // Averaged pacing across your full-length exams (null if none logged yet).
  b.pace = paceN ? {
    n: paceN,
    avgUsedSec: Math.round(usedSec / paceN),
    avgLeftSec: Math.round(leftSec / paceN),
    avgTotalSec: Math.round(totalSec / paceN),
    usedPct: totalSec ? Math.round(usedSec / totalSec * 100) : 0,
    avgRevisits: Math.round(revisits / paceN * 10) / 10
  } : null;
  return b;
}
// Second-guessing trend: net right→wrong flips, earlier half vs recent half of your mocks.
function _secondGuessTrend(sec) {
  const atts = allAttempts(sec).filter(a => a.rec && a.rec.changes).map(a => a.rec).sort((x, y) => (x.ts || 0) - (y.ts || 0));
  if (atts.length < 2) return null;
  const mid = Math.floor(atts.length / 2);
  const net = arr => arr.reduce((s, r) => s + ((r.changes.r2w || 0) - (r.changes.w2r || 0)), 0);
  return { early: net(atts.slice(0, mid)), recent: net(atts.slice(mid)), n: atts.length };
}
// Weakest textbook pages (Torso) by your accuracy — the exact pages to reread.
function weakestPages(sec, limit) {
  if (typeof Q_BOOKLOC === "undefined") return [];
  const qs = activeProgress().qstats || {}, byPage = {};
  Object.keys(Q_BOOKLOC).forEach(id => {
    const loc = Q_BOOKLOC[id]; const p = loc && (loc.p || loc.page); if (!p) return;
    const st = qs[id]; if (!st || !st.seen) return;
    byPage[p] = byPage[p] || { seen: 0, known: 0 };
    byPage[p].seen += st.seen; byPage[p].known += (st.seen - (st.missed || 0));
  });
  return Object.keys(byPage).map(p => ({ page: +p, seen: byPage[p].seen, pct: Math.round(byPage[p].known / byPage[p].seen * 100) }))
    .filter(r => r.seen >= 3).sort((a, b) => a.pct - b.pct).slice(0, limit || 6);
}
function _fuzzyCount() { const md = getStudyMode(); const qs = activeProgress().qstats || {}; let n = 0; Object.keys(qs).forEach(id => { if (isFuzzy(id, md)) n++; }); return n; }
/* Current memorization discount: what fraction of what you've practiced (this mode) is "fuzzy"
   (flip-flop = memorized, not mastered). Scales a readiness/score down so shallow knowledge
   doesn't read as being ready. Returns a factor in ~[0.65, 1]. */
function _masteryFactor(mode) {
  try {
    const qs = activeProgress().qstats || {}; let att = 0, fz = 0;
    Object.keys(qs).forEach(id => { const mm = qs[id].m && qs[id].m[mode]; if (mm && mm.s) { att++; if (typeof isFuzzy === "function" && isFuzzy(id, mode)) fz++; } });
    if (!att) return 1;
    return 1 - 0.35 * (fz / att);          // up to a 35% haircut when everything is fuzzy
  } catch (e) { return 1; }
}
/* PREPAREDNESS over time (not raw scores). At each past attempt we compute a retention‑weighted
   running estimate: earlier attempts count less (memory decays with a ~10‑day half‑life), so a good
   mock three weeks ago no longer "counts" as much as one yesterday. The whole curve is then scaled
   by the current memorization discount, so recognition-not-mastery pulls preparedness down. This is
   why it differs from the raw mock line — it answers "how ready are you," not "what did you score." */
function preparednessSeries(sec) {
  const atts = (typeof allAttempts === "function" ? allAttempts(sec) : [])
    .filter(a => a.rec && typeof a.rec.pct === "number" && a.rec.ts)
    .map(a => ({ ts: a.rec.ts, pct: a.rec.pct }))
    .sort((x, y) => x.ts - y.ts);
  if (!atts.length) return [];
  const md = (typeof getStudyMode === "function" ? getStudyMode() : "closed");
  const mf = _masteryFactor(md);
  const TAU = 10 * 864e5;                  // retention time constant ≈ 10 days (ms)
  return atts.map((a, i) => {
    let wsum = 0, vsum = 0;
    for (let j = 0; j <= i; j++) { const w = Math.exp(-Math.max(0, atts[i].ts - atts[j].ts) / TAU); wsum += w; vsum += w * atts[j].pct; }
    const prep = wsum ? (vsum / wsum) * mf : a.pct * mf;
    return { ts: a.ts, prep: Math.max(0, Math.min(100, Math.round(prep))) };
  });
}
// Inline-SVG line graph of your PREPAREDNESS trend over time (retention- + mastery-weighted).
function appendProgressGraph(wrap, sec) {
  const series = preparednessSeries(sec);
  if (series.length < 2) return;   // need at least two points to draw a trend line
  const W = 320, H = 140, padL = 26, padR = 10, padT = 12, padB = 18, n = series.length;
  const X = i => padL + (i / (n - 1)) * (W - padL - padR);
  const Y = p => padT + (1 - p / 100) * (H - padT - padB);
  let grid = "";
  [0, 25, 50, 75, 100].forEach(v => { const yy = Y(v); grid += `<line x1="${padL}" y1="${yy}" x2="${W - padR}" y2="${yy}" stroke="#eee" stroke-width="1"/><text x="1" y="${yy + 3}" font-size="8" fill="#bbb">${v}</text>`; });
  grid += `<line x1="${padL}" y1="${Y(75)}" x2="${W - padR}" y2="${Y(75)}" stroke="#0F766E" stroke-width="1" stroke-dasharray="3 3"/>`;
  const pts = series.map((a, i) => `${X(i).toFixed(1)},${Y(a.prep).toFixed(1)}`).join(" ");
  const line = `<polyline fill="none" stroke="var(--ink)" stroke-width="2" points="${pts}"/>`;
  const dots = series.map((a, i) => `<circle cx="${X(i).toFixed(1)}" cy="${Y(a.prep).toFixed(1)}" r="3" fill="${_prepBandColor(a.prep)}"/>`).join("");
  const last = series[n - 1].prep, delta = last - series[0].prep;
  const trend = delta > 0 ? `▲ up ${delta} pts` : delta < 0 ? `▼ down ${-delta} pts` : "flat";
  const card = document.createElement("div");
  card.style.cssText = "background:#fff;border:1px solid #eee;border-radius:14px;padding:16px 18px;margin-bottom:16px;";
  card.innerHTML = `<div style="font-weight:800;color:var(--ink);margin-bottom:8px;">📈 Preparedness over time</div>
    <svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block;">${grid}${line}${dots}</svg>
    <div style="font-size:.78rem;color:#666;margin-top:6px;">Retention‑weighted & discounted for memorized/fuzzy items — not raw scores. Latest <b style="color:${_prepBandColor(last)};">${last}%</b> · ${trend}. <span style="color:#0F766E;">– – 75% target</span></div>`;
  wrap.appendChild(card);
}
// A "Trends & Habits" card appended to a container — surfaces granular behaviour + weak pages/fuzzy.
function appendTrendsCard(wrap, sec) {
  // Weakest Martini pages + the fuzzy count are Torso-scoped signals (Q_BOOKLOC covers Torso only),
  // so don't show them on Axial / Appendicular / Cumulative / Lab 2 screens — that mixed Torso data
  // into Lab preparedness (ChatGPT audit #7). Behavior stats (answer-changes) are section-agnostic.
  const isTorsoView = (sec === "torso");
  const beh = behaviorStats(), tr = _secondGuessTrend(sec);
  const pages = isTorsoView ? weakestPages(sec, 6) : [];
  const fz = isTorsoView ? _fuzzyCount() : 0;
  if (!beh.totalChanges && !pages.length && !fz) return;
  const card = document.createElement("div");
  card.style.cssText = "background:#fff;border:1px solid #eee;border-radius:14px;padding:16px 18px;margin-bottom:16px;";
  let html = `<div style="font-weight:800;color:var(--ink);margin-bottom:8px;">📊 Trends &amp; Habits</div>`;
  if (beh.totalChanges) {
    const trend = tr ? (tr.recent < tr.early ? ` <span style="color:#0F766E;">↓ improving</span>` : tr.recent > tr.early ? ` <span style="color:#C0392B;">↑ getting worse</span>` : "") : "";
    const verdict = beh.r2w > beh.w2r ? "second-guessing is costing you — trust your first instinct" : beh.w2r > beh.r2w ? "your rechecks tend to help" : "changing answers is roughly neutral";
    html += `<div style="font-size:.85rem;color:#333;line-height:1.5;margin-bottom:8px;">Answer changes: <b>${beh.r2w}</b> right→wrong · <b>${beh.w2r}</b> wrong→right${trend}<br><span style="color:#666;">${verdict}.</span></div>`;
    if (beh.flagTotal) html += `<div style="font-size:.82rem;color:#666;margin-bottom:8px;">Flagged-question accuracy: ${Math.round(beh.flagRight / beh.flagTotal * 100)}% (${beh.flagRight}/${beh.flagTotal}) — your instinct on "not sure" ones.</div>`;
  }
  // ── Pacing + review behavior (from full-length exams) ──
  if (beh.pace) {
    const p = beh.pace;
    const fmtM = s => { const m = Math.floor(s / 60), ss = s % 60; return m + "m" + (ss ? " " + ss + "s" : ""); };
    let verdict;
    if (p.avgLeftSec >= 300 && p.avgRevisits < 1) verdict = "you finish early but don't use the leftover time — go back and re-check flagged / uncertain answers before you submit";
    else if (p.avgRevisits >= 3) verdict = "you use your spare time to review — that's the right habit";
    else if (p.usedPct >= 95 && p.avgLeftSec < 120) verdict = "you use almost all your time — watch the clock so you're not rushed at the end";
    else verdict = "your pacing looks balanced";
    html += `<div style="font-size:.82rem;color:#333;margin-bottom:8px;">⏱️ Pacing: you use <b>${p.usedPct}%</b> of the clock (~${fmtM(p.avgLeftSec)} left over) · revisit <b>${p.avgRevisits}</b> question${p.avgRevisits === 1 ? "" : "s"} on average.<br><span style="color:#666;">${verdict}.</span></div>`;
  }
  if (fz) html += `<div style="font-size:.82rem;color:#B7791F;margin-bottom:8px;">🎲 <b>${fz}</b> fuzzy questions — you flip between right & wrong on these (memorizing, not mastering). CAT now treats them as harder.</div>`;
  card.innerHTML = html;
  // "Drill my fuzzy questions" button — practices exactly the flip-flop items (no missed-pool side effects).
  if (fz) {
    const fbtn = document.createElement("button");
    fbtn.textContent = `🎲 Drill my ${fz} fuzzy question${fz === 1 ? "" : "s"} →`;
    fbtn.style.cssText = "display:block;width:100%;margin:4px 0 8px;background:var(--ink);color:#fff;border:none;border-radius:10px;padding:12px;font-size:.9rem;font-weight:700;cursor:pointer;";
    fbtn.onclick = () => startFuzzyDrill();
    card.appendChild(fbtn);
  }
  if (pages.length) {
    const pt = document.createElement("div"); pt.style.cssText = "margin-top:6px;border-top:1px solid #f0f0f0;padding-top:8px;";
    pt.innerHTML = `<div style="font-size:.75rem;color:#aaa;margin-bottom:4px;">Weakest Martini pages — reread these</div>`;
    pages.forEach(p => { const r = document.createElement("div"); r.style.cssText = "display:flex;justify-content:space-between;font-size:.82rem;color:#555;padding:2px 0;"; r.innerHTML = `<span>p. ${p.page}</span><span style="color:${p.pct < 50 ? "#C0392B" : "#B7791F"};font-weight:600;">${p.pct}% · ${p.seen} tries</span>`; pt.appendChild(r); });
    card.appendChild(pt);
  }
  wrap.appendChild(card);
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
    <div style="flex:1;background:#EEF4FB;border-radius:10px;padding:9px 12px;text-align:center;"><div style="font-size:.72rem;color:#5a6b85;">Attempts</div><div style="font-size:1.3rem;font-weight:800;color:var(--ink);">${all.length}</div></div>
    <div style="flex:1;background:#EEF4FB;border-radius:10px;padding:9px 12px;text-align:center;"><div style="font-size:.72rem;color:#5a6b85;">Avg score</div><div style="font-size:1.3rem;font-weight:800;color:var(--ink);">${avg != null ? avg + "%" : "—"}</div></div>
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
    c.style.cssText = `border:1.5px solid ${on ? "var(--ink)" : "#cfd8e3"};background:${on ? "var(--ink)" : "#fff"};color:${on ? "#fff" : "#41506a"};border-radius:999px;padding:6px 14px;font-size:.82rem;font-weight:700;cursor:pointer;`;
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
        <span style="font-weight:700;color:var(--ink);font-size:.93rem;">${KIND_ICON[a.kind] || "📝"} ${escapeHtml(a.title)}</span>
        <span style="display:block;color:#8a94a6;font-size:.76rem;margin-top:2px;">${rec.date}${rec.time ? " · " + rec.time : ""}${modeTag ? " · " + modeTag : ""}${nMissed ? " · " + nMissed + " missed" : ""}</span>
      </span>
      <span style="flex:0 0 auto;font-weight:800;font-size:.95rem;color:var(--ink);">${scoreTxt} <span style="color:#b8c0cc;font-weight:600;">${openNow ? "▲" : "▼"}</span></span>`;
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

/* ── Generalized practice-tests for non-Torso sections (Axial / Appendicular / Cumulative) ──
   Reuses the section-agnostic full-exam (skip & flag) flow. Torso keeps its own richer builder. */
function launchFullExamPool(pool, title, seconds) {
  if (!pool || !pool.length) { alert("No questions available yet."); return; }
  fullExamDeck = pool; fullExamIndex = 0;
  fullExamAnswers = new Array(pool.length).fill(-1);
  fullExamFlags = new Set();
  fullExamSecondsLeft = seconds || 6000;
  fullExamShowOverview = false;
  fullExamModeSet = false; fullExamOvFilter = "all"; fullExamReachedEnd = false;
  fullExamChanges = { r2w: 0, w2r: 0, w2w: 0 };
  fullExamLogged = false;
  fullExamStartedAt = Date.now(); fullExamTotalSeconds = seconds || 6000; fullExamRevisits = 0;
  fullExamShuffledOrders = pool.map(q => shuffle([...(q.options || [])]));
  clearInterval(fullExamTimerInterval); fullExamTimerInterval = null;
  state.examTitle = title || "Simulation";
  state.route = "fullExam"; render();
}
// Exam-eligible, non-diagram GR pool for a section (optionally limited to subtopic indices). Diagram
// questions are excluded because the full-exam view is text-only (Torso does the same).
function sectionGRPool(key, indices) {
  const s = DATA.sections[key]; if (!s) return [];
  let pool = [];
  (s.subtopics || []).forEach((t, i) => {
    if (indices && indices.indexOf(i) < 0) return;
    (t.quiz || []).forEach(q => { if (isExamEligible(q) && !isDiagramQ(q)) pool.push(q); });
  });
  return dedupeQs(pool);
}
// ClaudeBank questions for a section, formatted like GR quiz items (letter prefixes stripped).
function sectionCBPool(key) {
  const bank = activeClaudeBank(key);
  if (!bank) return [];
  const out = [];
  bank.forEach(t => (t.questions || []).forEach(q => {
    if (isExamEligible(q)) out.push({ ...q, options: (q.options || []).map(o => o.replace(/^[A-E]\.\s*/, "")) });
  }));
  return out;
}
// Stuvia questions for a section (Torso / Axial). Options are already plain text.
function sectionStuviaPool(key) {
  const bank = activeStuvia(key);
  if (!bank) return [];
  const out = [];
  bank.forEach(t => (t.questions || []).forEach(q => { if (isExamEligible(q)) out.push(q); }));
  return out;
}
// Lab 2 Mock Practical pool: structure/tissue/function bank + Lab-2 Guided-Reading questions
// INCLUDING the labeling-diagram (image) items — the real practical is image-based, so unlike
// the lecture sims we do NOT filter out diagrams here.
// Turn each Lab 2 labeling diagram into image "Identify structure #N" MCQs — the worksheet
// images carry printed numbers, so this reproduces the on-diagram identify tasks of the practical.
function lab2DiagramMCQs() {
  const gr = (typeof DATA !== "undefined" && DATA.sections) ? DATA.sections.lab2 : null;
  if (!gr) return [];
  let ex = [];
  (gr.subtopics || []).forEach(t => { if (t.labeling) ex = ex.concat(t.labeling); });
  if (gr.labeling) ex = ex.concat(gr.labeling);
  const global = [];
  ex.forEach(e => (e.wordBank || (e.blanks || []).map(b => b.correct)).forEach(w => { if (w && global.indexOf(w) < 0) global.push(w); }));
  const out = [];
  ex.forEach((e, ei) => {
    if (!e.image) return;
    const bank = (e.wordBank && e.wordBank.length) ? e.wordBank : (e.blanks || []).map(b => b.correct);
    (e.blanks || []).forEach(b => {
      if (!b.correct) return;
      let distPool = bank.filter(w => w && w !== b.correct);
      if (distPool.length < 3) distPool = distPool.concat(global.filter(w => w !== b.correct && distPool.indexOf(w) < 0));
      const distractors = shuffle(distPool).slice(0, 3);
      if (distractors.length < 3) return;   // need a full 4-option MCQ
      const options = shuffle([b.correct].concat(distractors));
      out.push({ id: "L2D-" + ei + "-" + b.num, q: "Identify the structure labeled #" + b.num + " in this diagram.", images: [e.image], options: options, correct: options.indexOf(b.correct) });
    });
  });
  return out;
}
function lab2MockPool() {
  let pool = [];
  if (typeof LAB2_BANK !== "undefined" && LAB2_BANK.length) {
    LAB2_BANK.forEach(t => (t.questions || []).forEach(q => { if (isExamEligible(q)) pool.push(Object.assign({}, q, { options: (q.options || []).map(o => o.replace(/^[A-E]\.\s*/, "")) })); }));
  }
  const gr = (typeof DATA !== "undefined" && DATA.sections) ? DATA.sections.lab2 : null;
  if (gr && gr.subtopics) gr.subtopics.forEach(t => (t.quiz || []).forEach(q => { if (isExamEligible(q) && (q.options || []).length >= 2) pool.push(q); }));
  // NOTE: the on-diagram "identify #N" MCQs are DISABLED in the timed mock/sprint — several
  // worksheet PNGs are cropped at the left/top edge in the SOURCE (e.g. box #1's number is cut
  // off), so "identify #N" is unanswerable. Diagram practice lives in the drag-drop Diagram
  // Labeling mode. Re-enable once clean full-margin images are re-extracted from the lab PDFs.
  // pool = pool.concat(lab2DiagramMCQs());
  return dedupeQs(pool);
}
// Quick Lab 2 "sprint" deck — n weak-first questions (missed / low-recall seen items lead,
// filled with fresh random so it always has diagrams + variety). Short focused burst.
function lab2SprintDeck(n) {
  const pool = lab2MockPool();
  const mode = (typeof getStudyMode === "function") ? getStudyMode() : "closed";
  let deck = [];
  try {
    const seenWeak = pool.filter(q => { const m = _qm(q.id, mode); return m && m.s > 0 && qRecall(q.id, mode) < 0.7; });
    deck = shuffle(seenWeak).slice(0, n);
  } catch (e) {}
  if (deck.length < n) {
    const have = new Set(deck.map(q => q.id));
    deck = deck.concat(shuffle(pool.filter(q => !have.has(q.id))).slice(0, n - deck.length));
  }
  return shuffle(deck).slice(0, n);
}
const SECTION_GROUPS = {
  axial: [["Head & Neck", "💀", [0,1,2,3,4,5,6,7,8,9]], ["Spinal Cord & Column", "🦴", [10,11]], ["Neural Tissue", "🧠", [12]]],
  appendicular: [["Upper Extremity", "💪", [0,1,2,3,4,5,6,7]], ["Lower Extremity", "🦵", [8,9,10,11,12]], ["Foundations", "🔬", [13,14,15,16,17,18,19]]],
  lab2: [["Nervous & Senses", "🧠", [0,1]], ["Endocrine & Blood", "🩸", [2,3]], ["Heart & Vessels", "🫀", [4,5]], ["Lymphatic & Respiratory", "🫁", [6,7]], ["Digestive & Urinary", "🍽️", [8,9]], ["Reproductive", "🔬", [10,11]]],
};
function _mkHdr(list, text) { const h = document.createElement("div"); h.className = "modeGroupHdr"; h.textContent = text; list.appendChild(h); }
function buildGenericExamMenu(list, key) {
  const sec = getSection(key), name = (sec.title || key).split(" (")[0];
  // Lab Practical II is 50 stations in 50 minutes; other generic sections keep a longer block.
  const MINI_N = 60, MINI_SECS = 3000;
  const SIM_N = (key === "lab2") ? 50 : 120;
  const SIM_SECS = (key === "lab2") ? 3000 : 6000;   // lab2: 50 Qs / 50 min (matches the real practical)
  _mkHdr(list, "Realistic Mock");
  const allPool = dedupeQs([].concat(sectionGRPool(key), sectionCBPool(key), sectionStuviaPool(key)));
  const simBtn = document.createElement("button"); simBtn.className = "modeBtn";
  simBtn.style.cssText = "border:2px solid var(--ink);background:#EEF4FB;";
  simBtn.innerHTML = `<span class="modeIcon">🎓</span><span class="modeLabel">Simulation — THE REAL DEAL ⭐</span><span class="modeMeta">Closest to your exam · ${Math.min(SIM_N, allPool.length)} Qs · ~${Math.round(SIM_SECS/60)} min · skip &amp; flag freely</span>`;
  simBtn.onclick = () => launchFullExamPool(shuffle(allPool).slice(0, SIM_N), name + " Simulation", SIM_SECS);
  list.appendChild(simBtn);
  const groups = SECTION_GROUPS[key];
  if (groups) {
    _mkHdr(list, "By Section — Mini Mocks");
    groups.forEach(([label, icon, idxs]) => {
      const pool = sectionGRPool(key, idxs);
      const b = document.createElement("button"); b.className = "modeBtn";
      b.innerHTML = `<span class="modeIcon">${icon}</span><span class="modeLabel">${label} — Mini Mock</span><span class="modeMeta">${Math.min(MINI_N, pool.length)} Qs · ~${Math.round(MINI_SECS/60)} min · skip &amp; flag</span>`;
      b.onclick = () => launchFullExamPool(shuffle(pool).slice(0, MINI_N), label + " Mini Mock", MINI_SECS);
      list.appendChild(b);
    });
  }
  addCatCard(list, key);
  // ── Competitive — Sudden Death (parity with Torso) ──
  _mkHdr(list, "Competitive");
  const sdPool = dedupeQs([].concat(sectionGRPool(key), sectionCBPool(key), sectionStuviaPool(key)));
  const sdBest = (progressState.quizzes && progressState.quizzes["suddenDeath:" + key]) || {};
  const sdB = document.createElement("button"); sdB.className = "modeBtn";
  sdB.innerHTML = `<span class="modeIcon">💀</span><span class="modeLabel">Sudden Death</span><span class="modeMeta">Keep going until you miss${sdBest.score ? " · Best streak: " + sdBest.score : ""}</span>`;
  sdB.onclick = () => {
    if (!sdPool.length) { alert("No questions available yet."); return; }
    sdDeck = shuffle([...sdPool]); sdIndex = 0; sdStreak = 0; sdAnswered = false; sdSelected = -1;
    state.route = "suddenDeath"; render();
  };
  list.appendChild(sdB);
  if (sec.exams && sec.exams.length) {
    _mkHdr(list, "Timed Challenge");
    const epBtn = document.createElement("button"); epBtn.className = "modeBtn";
    epBtn.innerHTML = `<span class="modeIcon">📋</span><span class="modeLabel">Practice Exams</span><span class="modeMeta">${sec.exams.length} timed exam${sec.exams.length!==1?"s":""} available</span>`;
    epBtn.onclick = () => { state.route = "simPicker"; render(); };
    list.appendChild(epBtn);
  }
  _mkHdr(list, "Review");
  const missBtn = document.createElement("button"); missBtn.className = "modeBtn";
  missBtn.style.cssText = "border:2px solid #C0392B;background:#FDECEA;";
  missBtn.innerHTML = `<span class="modeIcon">🔁</span><span class="modeLabel">Missed Questions</span><span class="modeMeta">Re-do everything you've gotten wrong in ${name}</span>`;
  missBtn.onclick = () => {
    const missed = JSON.parse(localStorage.getItem(ns("missed:" + key)) || "[]");
    if (!missed.length) { alert("No missed questions recorded yet. Take a mock or quiz first!"); return; }
    missedDeck = shuffle([...missed]); state.route = "missedReview"; render();
  };
  list.appendChild(missBtn);
}
// The four real cumulative-final blocks (50 each = 200): Appendicular, Axial, Torso-regional
// (Thorax+Abdomen+Pelvis), and Systemic — Systemic pulled out of Torso via blueprintSources()
// (the same split the Torso lecture exam uses).
function _cumulativeBlocks() {
  const idx = buildQuestionIndex();
  // idx maps id→question but the id is the KEY, not a field on the object — re-attach it so
  // dedup + the per-question option-shuffle cache work (they key on q.id).
  const toQ = ids => dedupeQs(ids.map(id => { const q = idx[id]; return q ? Object.assign({}, q, { id: id }) : null; }).filter(q => q && isExamEligible(q) && !isDiagramQ(q)));
  const unitIds = k => dedupeQs([].concat(sectionGRPool(k), sectionCBPool(k), sectionStuviaPool(k))).map(q => q.id);
  let src = {};
  try { src = blueprintSources() || {}; } catch (e) {}
  const rIds = [].concat(src.Thorax || [], src.Abdomen || [], src.Pelvis || []).map(o => o.id);
  const sIds = (src.Systemic || []).map(o => o.id);
  return {
    Appendicular: toQ(unitIds("appendicular")),
    Axial:        toQ(unitIds("axial")),
    Torso:        toQ(rIds),
    Systemic:     toQ(sIds),
  };
}
// Draw exactly `per` from each block (deduped across blocks), then shuffle into one deck.
function _cumulativeDeck(per) {
  const bl = _cumulativeBlocks();
  const seen = new Set(); const deck = [];
  ["Appendicular", "Axial", "Torso", "Systemic"].forEach(name => {
    const picked = shuffle(bl[name] || []).filter(q => { const k = (q.id != null) ? q.id : String(q.q || ""); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, per);
    deck.push(...picked);
  });
  return shuffle(deck);
}
function buildCumulativeExamMenu(list) {
  const SECS = 4800, PER = 50;   // real Final: 50 Appendicular + 50 Axial + 50 Torso + 50 Systemic = 200
  _mkHdr(list, "Cumulative Final — All Lecture Units (no labs)");
  const simBtn = document.createElement("button"); simBtn.className = "modeBtn";
  simBtn.style.cssText = "border:2px solid #0F766E;background:#E9F6F4;";
  simBtn.innerHTML = `<span class="modeIcon">🎓</span><span class="modeLabel">Full Cumulative Simulation ⭐</span><span class="modeMeta">Exam structure: <b>50 Appendicular + 50 Axial + 50 Torso + 50 Systemic</b> · 200 Qs · 80 min · skip &amp; flag</span>`;
  simBtn.onclick = () => { const deck = _cumulativeDeck(PER); if (!deck.length) { alert("No questions available yet."); return; } launchFullExamPool(deck, "Cumulative Simulation", SECS); };
  list.appendChild(simBtn);
  _mkHdr(list, "By Block — 50-Q practice test");
  const PER_N = 67;
  [["Appendicular","🦴"], ["Axial","🦷"], ["Torso","🫁"], ["Systemic","🩺"]].forEach(([name, icon]) => {
    const pool = (_cumulativeBlocks()[name]) || [];
    const b = document.createElement("button"); b.className = "modeBtn";
    b.innerHTML = `<span class="modeIcon">${icon}</span><span class="modeLabel">${name} — Practice Test</span><span class="modeMeta">${Math.min(PER, pool.length)} Qs · skip &amp; flag</span>`;
    b.onclick = () => launchFullExamPool(shuffle(pool).slice(0, PER), name + " (Cumulative)", SECS);
    list.appendChild(b);
  });
  addCatCard(list, "cumulative");
  _mkHdr(list, "Review");
  const missBtn = document.createElement("button"); missBtn.className = "modeBtn";
  missBtn.style.cssText = "border:2px solid #C0392B;background:#FDECEA;";
  missBtn.innerHTML = `<span class="modeIcon">🔁</span><span class="modeLabel">Missed Questions</span><span class="modeMeta">Everything you've gotten wrong across all three units</span>`;
  missBtn.onclick = () => {
    let missed = [];
    ["appendicular","axial","torso"].forEach(k => { try { missed = missed.concat(JSON.parse(localStorage.getItem(ns("missed:" + k)) || "[]")); } catch (e) {} });
    missed = dedupeQs(missed);
    if (!missed.length) { alert("No missed questions recorded yet."); return; }
    missedDeck = shuffle(missed); state.route = "missedReview"; render();
  };
  list.appendChild(missBtn);
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
  histBtn.style.cssText = "border:2px solid var(--ink);background:#EEF4FB;";
  histBtn.innerHTML = `<span class="modeIcon">🗓️</span><span class="modeLabel">History — past attempts</span><span class="modeMeta">${nAttempts ? nAttempts + " logged · " : ""}every mock, timed exam &amp; quiz on one timeline · tap any to see missed questions</span>`;
  histBtn.onclick = () => { state.route = "history"; state.histFilter = "all"; render(); };
  list.appendChild(histBtn);

  // Non-Torso sections use the generalized builder (Torso keeps its Stuvia/ClaudeBank-rich menu below).
  if (state.sectionKey === "cumulative") { buildCumulativeExamMenu(list); main.appendChild(list); return; }
  if (state.sectionKey !== "torso") { buildGenericExamMenu(list, state.sectionKey); main.appendChild(list); return; }

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
    fullExamLogged = false;
    fullExamStartedAt = Date.now(); fullExamTotalSeconds = seconds || 6000; fullExamRevisits = 0;
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
  fullBtn.style.cssText = "border:2px solid var(--ink);background:#EEF4FB;";
  fullBtn.innerHTML = `<span class="modeIcon">🎓</span><span class="modeLabel">Simulation — THE REAL DEAL ⭐</span><span class="modeMeta">Matches the real exam · <b>200 Qs · 80 min</b> · 50/section · ALL banks (GR + Stuvia + ClaudeBank + Practice Exams) · skip &amp; flag freely</span>`;
  fullBtn.onclick = () => launchFullExam(buildSimDeck(50, { gr: true, stuvia: true, pe: true, cb: true }), "Simulation", 4800);
  list.appendChild(fullBtn);

  // Stuvia-only simulation
  const stuSimBtn = document.createElement("button");
  stuSimBtn.className = "modeBtn";
  stuSimBtn.innerHTML = `<span class="modeIcon">📚</span><span class="modeLabel">Stuvia Simulation</span><span class="modeMeta">200 Qs · 80 min · 50/section · Stuvia questions only · skip &amp; flag</span>`;
  stuSimBtn.onclick = () => launchFullExam(buildSimDeck(50, { stuvia: true }), "Stuvia Simulation", 4800);
  list.appendChild(stuSimBtn);

  // ClaudeBank-only simulation
  const cbSimBtn = document.createElement("button");
  cbSimBtn.className = "modeBtn";
  cbSimBtn.innerHTML = `<span class="modeIcon">🤖</span><span class="modeLabel">ClaudeBank Simulation</span><span class="modeMeta">80 min · 50/section (as available) · ClaudeBank questions only · skip &amp; flag</span>`;
  cbSimBtn.onclick = () => launchFullExam(buildSimDeck(50, { cb: true }), "ClaudeBank Simulation", 4800);
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

  // ── Adaptive CAT (experimental) — sits between mini mocks and the timed challenge ──
  addCatCard(list, "torso");

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
  const sdRecord = ((progressState.quizzes && progressState.quizzes["suddenDeath:" + state.sectionKey]) || {}).score || 0;
  const sdBeatingRecord = sdStreak > sdRecord && sdStreak > 0;
  const streakWrap = document.createElement("div");
  streakWrap.className = "sdStreakWrap";
  streakWrap.innerHTML = `
    <div class="sdStreakLabel">🔥 STREAK</div>
    <div class="sdStreakNum">${sdStreak}</div>
    <div class="sdRecordLine">${sdBeatingRecord
      ? `🏆 NEW RECORD! <span style="opacity:.7;">(prev ${sdRecord})</span>`
      : `🏆 Record: <strong>${Math.max(sdRecord, sdStreak)}</strong>`}</div>
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
/* ── Shared bank controls: "how many questions" selector + bank-specific missed pool ── */
function _bankCountRow(list) {
  if (state.bankN === undefined) state.bankN = 25;
  const row = document.createElement("div");
  row.style.cssText = "display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:2px 2px 14px;";
  const lab = document.createElement("span"); lab.textContent = "How many?"; lab.style.cssText = "font-size:.8rem;color:var(--muted);font-weight:700;margin-right:2px;"; row.appendChild(lab);
  [["10", 10], ["25", 25], ["50", 50], ["100", 100], ["Max", "max"]].forEach(([lbl, val]) => {
    const on = state.bankN === val;
    const b = document.createElement("button"); b.textContent = lbl;
    b.style.cssText = `border:1.5px solid ${on ? "var(--ink)" : "#cfd8e3"};background:${on ? "var(--ink)" : "#fff"};color:${on ? "#fff" : "#41506a"};border-radius:999px;padding:5px 13px;font-size:.82rem;font-weight:700;cursor:pointer;`;
    b.onclick = () => { state.bankN = val; render(); };
    row.appendChild(b);
  });
  list.appendChild(row);
}
function _applyBankN(deck) { const n = state.bankN; return (n === "max" || !n) ? deck : deck.slice(0, n); }
// Missed questions that belong to THIS bank (filter the missed pool by the bank's own question ids).
function _bankMissed(bank) {
  const ids = new Set(); bank.forEach(t => (t.questions || []).forEach(q => { if (q.id) ids.add(q.id); }));
  const missed = (typeof loadMissedQs === "function") ? loadMissedQs() : [];
  return missed.filter(m => m.id && ids.has(m.id) && m.options && m.options.length >= 2 && typeof m.correct === "number");
}
function renderStuviaMenu(main) {
  // Section-aware: Torso → STUVIA_BANK, Axial → STUVIA_AXIAL.
  const bank = activeStuvia();

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

  // ── How many? (count selector) ──
  _bankCountRow(list);

  // ── Missed questions from THIS bank ──
  const missedB = _bankMissed(bank);
  if (missedB.length) {
    const hdrM = document.createElement("div"); hdrM.className = "modeGroupHdr"; hdrM.textContent = "Review"; list.appendChild(hdrM);
    const mb = document.createElement("button"); mb.className = "modeBtn"; mb.style.cssText = "border:1.5px solid var(--danger);";
    mb.innerHTML = `<span class="modeIcon">🔁</span><span class="modeLabel">Missed — Stuvia only</span><span class="modeMeta">${missedB.length} missed from this bank${state.bankN !== "max" ? ` · doing ${Math.min(state.bankN, missedB.length)}` : ""}</span>`;
    mb.onclick = () => {
      quizDeck = _applyBankN(shuffle(missedB.map(m => ({ id: m.id, q: m.q, options: m.options, correct: m.correct, tf: m.tf }))));
      state.quizSource = "stuvia"; state.quizDeckKey = "stuvia:" + state.sectionKey + ":missed"; state.prevRoute = "stuviaMenu"; state.route = "quiz"; render();
    };
    list.appendChild(mb);
  }

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
  const nTxt = state.bankN !== "max" ? ` · doing ${Math.min(state.bankN, totalQ)}` : " · all";
  allBtn.innerHTML = `<span class="modeIcon">📚</span><span class="modeLabel">All Questions</span><span class="modeMeta">${totalQ} questions${nTxt}${allBestTxt}</span>`;
  allBtn.onclick = () => {
    let pool = [];
    bank.forEach(t => pool.push(...(t.questions || [])));
    quizDeck = _applyBankN(shuffle([...pool]));
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
        quizDeck = _applyBankN(shuffle([...(topic.questions || [])]));
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
  const bank = activeClaudeBank();
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

  // ── How many? (count selector) ──
  _bankCountRow(list);

  // ── Missed questions from THIS bank ──
  const cbMissed = _bankMissed(bank);
  if (cbMissed.length) {
    const hdrM = document.createElement("div"); hdrM.className = "modeGroupHdr"; hdrM.textContent = "Review"; list.appendChild(hdrM);
    const mb = document.createElement("button"); mb.className = "modeBtn"; mb.style.cssText = "border:1.5px solid var(--danger);";
    mb.innerHTML = `<span class="modeIcon">🔁</span><span class="modeLabel">Missed — Claude Bank only</span><span class="modeMeta">${cbMissed.length} missed from this bank${state.bankN !== "max" ? ` · doing ${Math.min(state.bankN, cbMissed.length)}` : ""}</span>`;
    mb.onclick = () => {
      quizDeck = _applyBankN(shuffle(cbMissed.map(m => ({ id: m.id, q: m.q, options: (m.options || []).map(o => o.replace(/^[A-E]\.\s*/, "")), correct: m.correct, tf: m.tf }))));
      state.quizSource = "claude"; state.quizDeckKey = "cb:" + state.sectionKey + ":missed"; state.prevRoute = "claudeMenu"; state.route = "quiz"; render();
    };
    list.appendChild(mb);
  }

  // Full bank
  const hdrAll = document.createElement("div");
  hdrAll.className = "modeGroupHdr";
  hdrAll.textContent = "Full Bank";
  list.appendChild(hdrAll);

  const totalQ = bank.reduce((a, t) => a + (t.questions || []).length, 0);
  const allBest = progressState.quizzes && progressState.quizzes["cb:" + state.sectionKey + ":all"];
  const allBtn = document.createElement("button");
  allBtn.className = "modeBtn";
  const cbNTxt = state.bankN !== "max" ? ` · doing ${Math.min(state.bankN, totalQ)}` : " · all";
  allBtn.innerHTML = `<span class="modeIcon">🤖</span><span class="modeLabel">All Questions</span><span class="modeMeta">${totalQ} questions${cbNTxt}${allBest ? ` · Best ${allBest.score}/${allBest.total}` : ""}</span>`;
  allBtn.onclick = () => {
    let pool = [];
    bank.forEach(t => pool.push(...clean(t.questions || [])));
    quizDeck = _applyBankN(shuffle([...pool]));
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
      quizDeck = _applyBankN(shuffle([...clean(topic.questions || [])]));
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
   CAT — Computer Adaptive Testing  (EXPERIMENTAL)
   CISSP-style adaptive engine: a 1-parameter-logistic (Rasch) ability
   estimate θ, each next item chosen near your current ability (max
   information), stopping early once the estimate is confident. This is
   NOT a graded practice exam — it's a fast, adaptive read on where you
   stand. Difficulty is a heuristic proxy (item type + source + spread),
   so treat results as directional. Isolated from the normal exam flow.
   NOTE: CAT_CONFIG / CAT_MIN_ITEMS / catState are declared near the top of the file
   (before initApp) so a restored catSim/examMenu route on load can't hit a TDZ error.
   ═══════════════════════════════════════════════════════════ */
function _catHash(str) { let h = 0; for (let i = 0; i < str.length; i++) { h = (h * 31 + str.charCodeAt(i)) | 0; } return h; }
function _logistic(x) { return 1 / (1 + Math.exp(-x)); }
// Deterministic pseudo-difficulty in logits (~ -1.8..+1.8) from item type/source + a hash spread.
// Per-question difficulty (logits). Layers real signals so it's meaningful for EVERY bank
// (GR, ClaudeBank, Stuvia), not a random number:
//   1. Content features (option count, "all/none of the above", negative wording, stem length)
//   2. Bloom's-Taxonomy bump for the harder Stuvia items (baked QDIFF, keyed by stem)
//   3. Your own answer history — a question you keep missing is treated as harder
//   4. A tiny deterministic jitter to break ties
function catDifficulty(id, q) {
  let b = 0;
  const opts = (q && q.options) || [], n = opts.length;
  const stem = String((q && (q.q || q.question)) || "").toLowerCase();
  const optsTxt = opts.join(" ").toLowerCase();
  // 1. content features
  if ((q && q.tf) || n === 2) b -= 0.7; else if (n >= 5) b += 0.35; else if (n === 4) b += 0.05;
  if (/\ball of the (above|answers)|none of the (above|answers)/.test(optsTxt)) b += 0.35;
  if (/\bnot\b|\bexcept\b|\bleast\b|\bincorrect\b/.test(stem)) b += 0.25;   // negatively-worded
  const words = stem ? stem.split(/\s+/).length : 0;
  if (words > 28) b += 0.2; else if (words && words < 8) b -= 0.15;
  const bank = bankOfId(id);
  if (bank === "Guided Reading") b -= 0.05;
  // 2. Bloom bump (Stuvia harder items)
  try { if (typeof QDIFF !== "undefined") { const bl = QDIFF[_stemKey(q)]; if (typeof bl === "number") b += bl; } } catch (e) {}
  // 3. empirical — MOSTLY STATIC, but nudged by real response data as it accumulates.
  //    We blend the content heuristic (the prior, `b`) toward an observed-difficulty signal with a
  //    weight that grows with the number of times the item has been answered (Bayesian shrinkage):
  //      w = seen/(seen+K)  → ~0 with no data, ~0.5 by K answers, capped so the heuristic still anchors.
  //    Untouched questions therefore keep a fully static difficulty; the more it's answered (by you, or
  //    — once aggregate sync is on — everyone), the more its difficulty reflects real miss-rate.
  try {
    const st = (activeProgress().qstats || {})[id];
    if (st && st.seen >= 1) {
      const n = st.seen, miss = (st.missed || 0) / n;
      const emp = (miss - 0.45) * 2.4;                 // observed hardness in logits (miss-rate → difficulty)
      const w = Math.min(0.55, n / (n + 10));          // data weight: rises with responses, capped at 0.55
      // TRUE blend (interpolate), not additive: was `b += emp * w`, which stacked the empirical term ON
      // TOP of the full heuristic instead of letting the heuristic's own weight shrink as w grows — at
      // w=0.55 that meant 100% heuristic + 55% empirical (155% total), not the intended "mostly-static,
      // shifts toward observed difficulty as data accrues." This converges toward `emp` as w → its cap.
      b = b * (1 - w) + emp * w;
    }
    const md = (typeof getStudyMode === "function" ? getStudyMode() : "closed");
    if (typeof isFuzzy === "function" && isFuzzy(id, md)) b += 0.5;
  } catch (e) {}
  // 4. small deterministic jitter
  b += ((Math.abs(_catHash(id)) % 1000) / 1000) * 0.4 - 0.2;
  return Math.max(-2.2, Math.min(2.2, b));
}
// Region pools of {id, q, g, b}. Torso = 4 exam regions (25 each); Cumulative = 3 units.
function catRegions(key) {
  const idx = buildQuestionIndex();
  const mk = (id) => { const q = idx[id]; if (!q || !q.q || !q.options || q.options.length < 2 || typeof q.correct !== "number") return null; if (isDiagramQ(q) || hasDupOptions(q)) return null; return { id, q, g: _optGuess(q), b: catDifficulty(id, q) }; };
  const clean = arr => arr.map(mk).filter(Boolean);
  if (key === "torso") {
    const src = blueprintSources();
    return [
      { name: "Thorax", quota: 50, pool: clean(src.Thorax.map(o => o.id)) },
      { name: "Abdomen", quota: 50, pool: clean(src.Abdomen.map(o => o.id)) },
      { name: "Pelvis", quota: 50, pool: clean(src.Pelvis.map(o => o.id)) },
      { name: "Systemic", quota: 50, pool: clean(src.Systemic.map(o => o.id)) },
    ];
  }
  if (key === "cumulative") {
    const unit = k => dedupeQs([].concat(sectionGRPool(k), sectionCBPool(k), sectionStuviaPool(k))).map(q => q.id);
    let src = {}; try { src = blueprintSources() || {}; } catch (e) {}
    const rIds = [].concat(src.Thorax || [], src.Abdomen || [], src.Pelvis || []).map(o => o.id);
    const sIds = (src.Systemic || []).map(o => o.id);
    return [
      { name: "Appendicular", quota: 50, pool: clean(unit("appendicular")) },
      { name: "Axial", quota: 50, pool: clean(unit("axial")) },
      { name: "Torso", quota: 50, pool: clean(rIds) },
      { name: "Systemic", quota: 50, pool: clean(sIds) },
    ];
  }
  return [];
}
function launchCat(key) {
  const cfg = CAT_CONFIG[key];
  if (!cfg || !cfg.enabled) { alert("The Adaptive Ability Index for this section is coming soon (experimental)."); return; }
  let regions = catRegions(key).filter(r => r.pool.length);
  if (!regions.length) { alert("Not enough questions to run an adaptive test here yet."); return; }
  // De-duplicate by stem ACROSS regions so the same question can't reappear (e.g. Systemic
  // master duplicates a Thorax item). Shared seen-set, image-aware key.
  const seenStem = new Set();
  regions.forEach(r => { r.pool = shuffle(r.pool).filter(it => { const k = _stemKey(it.q); if (seenStem.has(k)) return false; seenStem.add(k); return true; }); r.served = 0; });
  regions = regions.filter(r => r.pool.length);
  catState = {
    key, cfg, regions, theta: 0, se: 99,
    answered: [], used: new Set(), usedStems: new Set(), idx: 0, current: null, selected: -1,
    total: Math.min(cfg.total, regions.reduce((a, r) => a + Math.min(r.quota, r.pool.length), 0)),
    done: false, startedAt: Date.now(),
  };
  catPickNext();
  state.route = "catSim"; render();
}
function _catInfo(th) { let I = 0; catState.answered.forEach(a => { const p = _logistic(th - a.b); I += p * (1 - p); }); return I; }
function catUpdateTheta() {
  let th = catState.theta;
  for (let it = 0; it < 10; it++) {
    let num = (0 - th) / 4, den = 1 / 4;   // N(0,2) prior keeps θ stable at all-right / all-wrong
    catState.answered.forEach(a => { const p = _logistic(th - a.b); num += (a.u - p); den += p * (1 - p); });
    if (den < 1e-6) break;
    th = Math.max(-3.5, Math.min(3.5, th + num / den));
  }
  catState.theta = th;
  const I = _catInfo(th) + 1 / 4;
  catState.se = I > 0 ? 1 / Math.sqrt(I) : 99;
}
function _catRegionOpen(r) { return r.served < Math.min(r.quota, r.pool.length); }
function catPickNext() {
  const cs = catState;
  const open = cs.regions.filter(_catRegionOpen);
  if (!open.length) { cs.current = null; return; }
  open.sort((a, b) => (a.served / a.quota) - (b.served / b.quota));   // keep regional balance
  const region = open[0];
  let best = null, bestD = 1e9;
  for (const it of region.pool) {
    if (cs.used.has(it.id)) continue;
    if (cs.usedStems && cs.usedStems.has(_stemKey(it.q))) continue;   // never repeat a stem
    const d = Math.abs(it.b - cs.theta);
    if (d < bestD) { bestD = d; best = it; }
  }
  if (!best) { region.served = Math.min(region.quota, region.pool.length); return catPickNext(); }
  cs.current = { region, item: best };
  cs.selected = -1;
}
function catAnswer(sel) {
  const cs = catState; if (!cs || !cs.current || cs.selected >= 0) return;
  cs.selected = sel;
  const it = cs.current.item;
  const correct = (sel === it.q.correct);
  cs.used.add(it.id);
  if (cs.usedStems) cs.usedStems.add(_stemKey(it.q));   // block same-stem repeats across regions
  cs.current.region.served++;
  cs.answered.push({ id: it.id, b: it.b, u: correct ? 1 : 0, region: cs.current.region.name });
  try { recordQuestionStat({ id: it.id }, correct, null, false); _predVer++; } catch (e) {}
  // Feed Missed Questions (section-scoped: cumulative → the item's unit, else the CAT's section)
  if (!correct) { const ms = (cs.key === "cumulative") ? String(cs.current.region.name).toLowerCase() : cs.key; try { addMissed(it.q, ms); } catch (e) {} }
  catUpdateTheta();
  cs.idx++;
  const n = cs.answered.length;
  const allDone = cs.regions.every(r => !_catRegionOpen(r));
  if (n >= cs.total || allDone || (n >= CAT_MIN_ITEMS && cs.se < CAT_SE_STOP)) {
    cs.done = true; catFinish(); state.route = "catEnd"; render(); return;
  }
  catPickNext();
  render();
}
function catFinish() {
  const cs = catState;
  const correct = cs.answered.filter(a => a.u === 1).length, n = cs.answered.length;
  cs.pct = n ? Math.round(correct / n * 100) : 0;
  cs.readiness = Math.round(_logistic(cs.theta) * 100);
  const reg = {}; cs.answered.forEach(a => { reg[a.region] = reg[a.region] || { c: 0, n: 0 }; reg[a.region].n++; if (a.u) reg[a.region].c++; });
  cs.regionStats = reg;
  try {
    recordAttempt("cat:" + cs.key, {
      title: "Adaptive Ability Index (Experimental)", kind: "cat",
      mode: (typeof getStudyMode === "function" ? getStudyMode() : "closed"),
      score: correct, total: n, pct: cs.pct,
      theta: Math.round(cs.theta * 100) / 100, se: Math.round(cs.se * 100) / 100, readiness: cs.readiness,
    });
  } catch (e) {}
}
// Deliberately NOT a pass/fail readiness verdict — the Adaptive Ability Index is an uncalibrated
// experimental estimate (see catDifficulty), so it should never claim to predict exam outcome. These
// labels describe where your estimated ability sits relative to the target band, nothing more.
function catVerdict(theta, se) {
  const lo = theta - 1.96 * se, hi = theta + 1.96 * se;
  if (lo > 0.3) return { txt: "Above target band", color: "#0F766E", emoji: "📈" };
  if (hi < -0.3) return { txt: "Below target band — keep drilling", color: "#C0392B", emoji: "📚" };
  return { txt: "Within target band — keep drilling", color: "#B7791F", emoji: "⚖️" };
}
function renderCatSim(main) {
  const cs = catState;
  if (!cs || !cs.current) { state.route = "examMenu"; render(); return; }
  const it = cs.current.item, q = it.q;
  const wrap = document.createElement("div");
  wrap.style.cssText = "max-width:720px;margin:0 auto;";
  const conf = Math.max(0, Math.min(100, Math.round((1 - Math.min(1, cs.se / 1.2)) * 100)));
  wrap.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin:4px 0 10px;">
      <span style="font-size:.8rem;font-weight:700;color:#7C3AED;background:#F3E8FF;padding:4px 10px;border-radius:999px;">🧪 EXPERIMENTAL · ADAPTIVE</span>
      <span style="font-size:.85rem;color:#666;">Item ${cs.answered.length + 1} · up to ${cs.total}</span>
    </div>
    <div style="height:8px;background:#eee;border-radius:99px;overflow:hidden;margin-bottom:4px;">
      <div style="height:100%;width:${conf}%;background:linear-gradient(90deg,#7C3AED,#4338CA);"></div>
    </div>
    <div style="font-size:.72rem;color:#999;margin-bottom:16px;">Confidence in the estimate: ${conf}% · it adapts to your level and stops early when sure</div>`;
  const stem = document.createElement("div");
  stem.style.cssText = "font-size:1.1rem;line-height:1.5;font-weight:600;margin-bottom:18px;";
  stem.textContent = (q.q || "").replace(/\[GR\]/g, "").trim();
  wrap.appendChild(stem);
  (q.options || []).forEach((opt, i) => {
    const b = document.createElement("button");
    b.className = "catOpt";
    b.style.cssText = "display:block;width:100%;text-align:left;margin:8px 0;padding:14px 16px;border:2px solid #e2e2e2;border-radius:12px;background:#fff;font-size:1rem;cursor:pointer;transition:all .12s;";
    b.textContent = opt.replace(/^[A-E]\.\s*/, "");
    b.onmouseenter = () => { b.style.borderColor = "#7C3AED"; b.style.background = "#FAF5FF"; };
    b.onmouseleave = () => { b.style.borderColor = "#e2e2e2"; b.style.background = "#fff"; };
    b.onclick = () => catAnswer(i);
    wrap.appendChild(b);
  });
  const note = document.createElement("div");
  note.style.cssText = "margin-top:14px;font-size:.75rem;color:#aaa;text-align:center;";
  note.textContent = "No answer is revealed — the test only uses right/wrong to find your level (like the CISSP CAT).";
  wrap.appendChild(note);
  main.appendChild(wrap);
}
function renderCatEnd(main) {
  const cs = catState;
  if (!cs) { state.route = "examMenu"; render(); return; }
  const v = catVerdict(cs.theta, cs.se);
  const wrap = document.createElement("div");
  wrap.style.cssText = "max-width:640px;margin:0 auto;";
  wrap.innerHTML = `
    <div style="text-align:center;background:linear-gradient(135deg,#7C3AED 0%,#4338CA 100%);color:#fff;border-radius:18px;padding:26px 20px;margin-bottom:18px;">
      <div style="font-size:.8rem;font-weight:700;letter-spacing:.5px;opacity:.85;">🧪 ADAPTIVE ABILITY INDEX · EXPERIMENTAL</div>
      <div style="font-size:2.6rem;margin:6px 0;">${v.emoji}</div>
      <div style="font-size:1.5rem;font-weight:800;">${v.txt}</div>
      <div style="font-size:1rem;opacity:.9;margin-top:6px;">Adaptive Ability Index: ${cs.readiness}/100 · ${cs.answered.length} items · ${cs.pct}% correct</div>
      <div style="font-size:.78rem;opacity:.8;margin-top:8px;">ability θ = ${cs.theta.toFixed(2)} ± ${(1.96 * cs.se).toFixed(2)} (95% CI)</div>
    </div>`;
  // per-region
  const rc = document.createElement("div");
  rc.style.cssText = "background:#fff;border:1px solid #eee;border-radius:14px;padding:16px 18px;margin-bottom:16px;";
  rc.innerHTML = `<div style="font-weight:700;margin-bottom:10px;">By region</div>`;
  Object.keys(cs.regionStats || {}).forEach(name => {
    const r = cs.regionStats[name], pct = r.n ? Math.round(r.c / r.n * 100) : 0;
    const row = document.createElement("div");
    row.style.cssText = "margin:8px 0;";
    row.innerHTML = `<div style="display:flex;justify-content:space-between;font-size:.9rem;margin-bottom:3px;"><span>${name}</span><span style="color:#666;">${r.c}/${r.n} · ${pct}%</span></div>
      <div style="height:7px;background:#eee;border-radius:99px;overflow:hidden;"><div style="height:100%;width:${pct}%;background:${pct >= 70 ? "#0F766E" : pct >= 50 ? "#B7791F" : "#C0392B"};"></div></div>`;
    rc.appendChild(row);
  });
  wrap.appendChild(rc);
  const info = document.createElement("div");
  info.style.cssText = "background:#F3E8FF;border:1px solid #E9D5FF;border-radius:12px;padding:14px 16px;font-size:.85rem;color:#5B21B6;margin-bottom:16px;line-height:1.5;";
  info.innerHTML = `<b>What is this?</b> An adaptive test (like the CISSP CAT). It picks each question near your current level and stops once it's confident — so a short run can still place you. Difficulty is a heuristic, so this is a directional read, not a graded exam. Recorded to your History and it feeds practice retention.`;
  wrap.appendChild(info);
  const done = document.createElement("button");
  done.className = "modeBtn";
  done.style.cssText = "border:2px solid #7C3AED;background:#faf5ff;font-weight:700;";
  done.innerHTML = `<span class="modeLabel">Done</span>`;
  done.onclick = () => { state.route = "examMenu"; render(); };
  wrap.appendChild(done);
  main.appendChild(wrap);
}
// Colored CAT card for the Practice Tests menus (enabled → launch; else "coming soon").
function addCatCard(list, key) {
  const cfg = CAT_CONFIG[key]; if (!cfg) return;
  _mkHdr(list, "Adaptive (Experimental)");
  const b = document.createElement("button"); b.className = "modeBtn";
  if (cfg.enabled) {
    b.style.cssText = "border:2px solid #7C3AED;background:linear-gradient(135deg,#F5F3FF 0%,#EDE9FE 100%);";
    b.innerHTML = `<span class="modeIcon">🧪</span><span class="modeLabel">Adaptive Ability Index <span style="font-size:.7rem;color:#7C3AED;font-weight:700;">EXPERIMENTAL</span></span><span class="modeMeta">CISSP-style: adapts to your level & stops early · ${cfg.total} Qs max · directional estimate, not a readiness verdict</span>`;
    b.onclick = () => launchCat(key);
  } else {
    b.style.cssText = "border:2px dashed #C4B5FD;background:#FAF5FF;opacity:.75;";
    b.innerHTML = `<span class="modeIcon">🧪</span><span class="modeLabel">Adaptive Ability Index <span style="font-size:.7rem;color:#7C3AED;font-weight:700;">EXPERIMENTAL</span></span><span class="modeMeta">Adaptive engine coming soon for ${cfg.label}</span>`;
    b.onclick = () => alert("The adaptive CAT for " + cfg.label + " is coming soon — it's live for Torso and the Cumulative final. (Experimental)");
  }
  list.appendChild(b);
}

/* ═══════════════════════════════════════════════════════════
   Section-scoped Preparedness (non-Torso) — a lightweight read for
   Appendicular / Axial / Cumulative that reuses the generic retention
   primitives (qRecall / covStats) WITHOUT touching the Torso engine.
   ═══════════════════════════════════════════════════════════ */
function genericRegions(key) {
  if (key === "cumulative") {
    // Include Stuvia in each unit so cumulative readiness reflects the SAME pool the cumulative
    // CAT/exam draws from (Appendicular has no Stuvia → sectionStuviaPool returns []). (Audit #5)
    return [["Appendicular", "appendicular"], ["Axial", "axial"], ["Torso", "torso"]]
      .map(([name, u]) => ({ name, ids: dedupeQs([].concat(sectionGRPool(u), sectionCBPool(u), sectionStuviaPool(u))).map(q => q.id) }));
  }
  const groups = SECTION_GROUPS[key] || [];
  const out = groups.map(([label, icon, idxs]) => ({ name: label, ids: sectionGRPool(key, idxs).map(q => q.id) }));
  const cb = sectionCBPool(key);
  if (cb.length) out.push({ name: "Claude Bank", ids: cb.map(q => q.id) });
  const stu = sectionStuviaPool(key);
  if (stu.length) out.push({ name: "Stuvia Bank", ids: stu.map(q => q.id) });
  return out;
}
function renderPreparednessGeneric(main) {
  const key = state.sectionKey;
  const md = (typeof getStudyMode === "function" ? getStudyMode() : "closed");
  const regions = genericRegions(key);
  const allIds = Array.from(new Set([].concat(...regions.map(r => r.ids))));
  const cov = covStats(allIds, md);
  const perf = cov.attempted ? Math.round(cov.known / cov.attempted * 100) : 0;
  const ready = cov.total ? Math.round(cov.known / cov.total * 100) : 0;
  const idx = buildQuestionIndex();
  let probSum = 0, probN = 0;
  allIds.forEach(id => { const q = idx[id]; const g = q ? _optGuess(q) : 0.2; probSum += qExamProb(id, md, g); probN++; });
  const predicted = probN ? Math.round(probSum / probN * 100) : 0;

  const wrap = document.createElement("div");
  wrap.style.cssText = "max-width:680px;margin:0 auto;";
  wrap.innerHTML = `
    <div style="background:linear-gradient(135deg,#5B21B6 0%,#4338CA 100%);color:#fff;border-radius:16px;padding:20px;margin-bottom:16px;">
      <div style="font-size:.8rem;opacity:.85;font-weight:700;">${md === "closed" ? "CLOSED-BOOK" : "WITH-NOTES"} · SECTION PREPAREDNESS</div>
      <div style="display:flex;gap:20px;margin-top:10px;flex-wrap:wrap;">
        <div><div style="font-size:2rem;font-weight:800;">${ready}%</div><div style="font-size:.75rem;opacity:.85;">Readiness (known / all)</div></div>
        <div><div style="font-size:2rem;font-weight:800;">${perf}%</div><div style="font-size:.75rem;opacity:.85;">Performance (known / tried)</div></div>
        <div><div style="font-size:2rem;font-weight:800;">~${predicted}%</div><div style="font-size:.75rem;opacity:.85;">Predicted score</div></div>
      </div>
      <div style="font-size:.75rem;opacity:.8;margin-top:10px;">${cov.attempted}/${cov.total} questions attempted · recall-weighted, decays over time</div>
    </div>`;
  // Lab 2 only: FOUR separate, honest dimensions — MCQ (above), real-photo stations, labeling, and
  // course-filtered 3D. Never blended into one number until every dimension actually has data, so an
  // empty dimension can't silently read as "0% dragging you down" OR get ignored as if it doesn't exist.
  if (key === "lab2") {
    const dims = { mcq: null, photos: null, labeling: null, threeD: null };
    if (cov.attempted > 0) dims.mcq = { pct: perf, label: `${cov.attempted}/${cov.total} MCQs attempted` };
    if (typeof lab2ModelReadiness === "function") {
      const mr = lab2ModelReadiness();
      if (mr.firstPass) dims.photos = { pct: mr.firstPass.pct, label: `${mr.firstPass.ok}/${mr.firstPass.done} scored right first try`, coverage: mr.coverage };
      else if (mr.coverage.covered > 0) dims.photos = { pct: null, label: `${mr.coverage.covered}/${mr.coverage.total} viewed, none scoreable yet`, coverage: mr.coverage };
    }
    const labQ = progressState.quizzes && progressState.quizzes["labeling:lab2"];
    if (labQ && labQ.attempts) dims.labeling = { pct: labQ.bestScore, label: `best ${labQ.bestScore}% over ${labQ.attempts} attempt${labQ.attempts === 1 ? "" : "s"}` };
    if (typeof lab3dReadiness === "function") {
      const l3r = lab3dReadiness(true);   // true = course-filtered (BIOL 250 Lab 2 whitelist only)
      if (l3r) dims.threeD = { pct: l3r.pct, label: `${l3r.ok}/${l3r.done} structures right first try (3D)` };
    }
    const mc = document.createElement("div");
    mc.style.cssText = "background:#fff;border:1.5px solid var(--teal);border-radius:14px;padding:14px 18px;margin-bottom:16px;";
    let dimHtml = `<div style="font-weight:800;color:var(--teal-2);margin-bottom:8px;">🧭 Lab 2 — four separate dimensions</div>`;
    const dimRow = (label, icon, d, emptyMsg) => {
      if (!d) return `<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-top:1px solid #f0f0f0;"><span style="font-size:.86rem;color:#888;">${icon} ${label}</span><span style="font-size:.78rem;color:#aaa;">${emptyMsg}</span></div>`;
      const pctTxt = d.pct == null ? "—" : d.pct + "%";
      const color = d.pct == null ? "#999" : _prepBandColor(d.pct);
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-top:1px solid #f0f0f0;"><span style="font-size:.86rem;">${icon} ${label}</span><span style="font-size:.9rem;font-weight:800;color:${color};">${pctTxt} <span style="font-weight:500;color:#888;font-size:.74rem;">· ${d.label}</span></span></div>`;
    };
    dimHtml += dimRow("MCQ", "📝", dims.mcq, "not attempted yet");
    dimHtml += dimRow("Photo stations", "📸", dims.photos, "no stations run yet");
    if (dims.photos && dims.photos.coverage) {
      dimHtml += `<div style="font-size:.72rem;color:#aaa;padding-left:22px;margin-top:-2px;">Coverage: ${dims.photos.coverage.covered}/${dims.photos.coverage.total} unique photos ever viewed${(typeof lab2ModelReadiness === "function" && lab2ModelReadiness().unconfirmedExcluded) ? ` (2 unconfirmed IDs excluded from scoring — verify against your lab key)` : ""}</div>`;
    }
    dimHtml += dimRow("Labeling", "🏷️", dims.labeling, "no labeling drill yet");
    dimHtml += dimRow("3D Explorer", "🧊", dims.threeD, "no course-relevant 3D practice yet");
    const have = Object.values(dims).filter(Boolean);
    if (have.length === 4) {
      const combined = Math.round(have.reduce((s, d) => s + (d.pct || 0), 0) / 4);
      dimHtml += `<div style="margin-top:10px;padding-top:10px;border-top:2px solid var(--teal);display:flex;justify-content:space-between;align-items:center;">
        <span style="font-weight:800;">Combined Lab 2 score</span><span style="font-size:1.3rem;font-weight:900;color:${_prepBandColor(combined)};">${combined}%</span></div>
        <div style="font-size:.72rem;color:#aaa;margin-top:2px;">Simple average of all 4 — only shown once every dimension has real data, so it can't hide a blind spot.</div>`;
    } else {
      dimHtml += `<div style="font-size:.74rem;color:#B7791F;margin-top:8px;">Combined score unlocks once all 4 dimensions have data (${have.length}/4 so far) — no single-number readiness until the whole practical is represented.</div>`;
    }
    mc.innerHTML = dimHtml;
    wrap.appendChild(mc);
  }
  // per-region readiness bars
  const rc = document.createElement("div");
  rc.style.cssText = "background:#fff;border:1px solid #eee;border-radius:14px;padding:16px 18px;margin-bottom:16px;";
  rc.innerHTML = `<div style="font-weight:700;margin-bottom:10px;">By region</div>`;
  regions.forEach(r => {
    const c = covStats(r.ids, md), pct = c.total ? Math.round(c.known / c.total * 100) : 0;
    const row = document.createElement("div"); row.style.cssText = "margin:8px 0;";
    row.innerHTML = `<div style="display:flex;justify-content:space-between;font-size:.9rem;margin-bottom:3px;"><span>${r.name}</span><span style="color:#666;">${Math.round(c.known)}/${c.total}</span></div>
      <div style="height:7px;background:#eee;border-radius:99px;overflow:hidden;"><div style="height:100%;width:${pct}%;background:${pct >= 70 ? "#0F766E" : pct >= 40 ? "#B7791F" : "#C0392B"};"></div></div>`;
    rc.appendChild(row);
  });
  wrap.appendChild(rc);
  // latest CAT result, if any
  const catAtt = (progressState.examAttempts && progressState.examAttempts["cat:" + key]) || [];
  if (catAtt.length) {
    const a = catAtt[0];
    const cc = document.createElement("div");
    cc.style.cssText = "background:#F5F3FF;border:1px solid #DDD6FE;border-radius:12px;padding:14px 16px;margin-bottom:16px;font-size:.9rem;color:#5B21B6;";
    cc.innerHTML = `🧪 <b>Last Adaptive Ability Index:</b> ${a.readiness}/100 · ${a.score}/${a.total} · ${a.date}`;
    wrap.appendChild(cc);
  }
  // launch CAT (only for sections where CAT is defined — e.g. not lab practicals)
  if (CAT_CONFIG[key]) {
    const catBtn = document.createElement("button"); catBtn.className = "modeBtn";
    const en = CAT_CONFIG[key].enabled;
    catBtn.style.cssText = en ? "border:2px solid #7C3AED;background:#F5F3FF;font-weight:700;" : "border:2px dashed #C4B5FD;background:#FAF5FF;opacity:.75;";
    catBtn.innerHTML = `<span class="modeIcon">🧪</span><span class="modeLabel">Adaptive Ability Index</span><span class="modeMeta">${en ? "CISSP-style adaptive · Experimental · directional estimate" : "Coming soon for this section"}</span>`;
    catBtn.onclick = () => en ? launchCat(key) : alert("Adaptive CAT is coming soon for this section (experimental).");
    wrap.appendChild(catBtn);
  }
  const note = document.createElement("div");
  note.style.cssText = "margin-top:12px;font-size:.75rem;color:#aaa;text-align:center;line-height:1.5;";
  note.textContent = "Experimental for non-Torso sections: readiness/performance are recall-weighted over this section's Guided Readings + Claude Bank. Practice raises them; they fade over time.";
  wrap.appendChild(note);
  try { appendProgressGraph(wrap, key); } catch (e) {}
  try { appendTrendsCard(wrap, key); } catch (e) {}
  main.appendChild(wrap);
}

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
      <div style="font-weight:800;font-size:1.15rem;color:var(--ink);margin-bottom:4px;">Before you start…</div>
      <div style="color:#666;font-size:.92rem;margin-bottom:22px;">Are you using your notes for this exam? This keeps your <b>true (closed-book)</b> score separate from your <b>with-notes</b> score — both feed your Preparedness stats.</div>`;
    const mk = (label, sub, mode, bg) => {
      const b = document.createElement("button");
      b.style.cssText = `display:block;width:100%;margin:10px 0;background:${bg};color:#fff;border:none;border-radius:12px;padding:14px;font-size:1rem;font-weight:700;cursor:pointer;`;
      b.innerHTML = `${label}<div style="font-weight:400;font-size:.78rem;opacity:.9;margin-top:2px;">${sub}</div>`;
      b.onclick = () => { setStudyMode(mode); fullExamModeSet = true; render(); };
      return b;
    };
    wrap.appendChild(mk("🧠 Closed-book", "No notes — my true recall", "closed", "var(--ink)"));
    wrap.appendChild(mk("📖 Open-book", "Using my notes", "open", "var(--ink-2)"));
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
      c.style.cssText = `border:1.5px solid ${on ? "var(--ink)" : "#cfd8e3"};background:${on ? "var(--ink)" : "#fff"};color:${on ? "#fff" : "#41506a"};border-radius:999px;padding:6px 14px;font-size:.82rem;font-weight:700;cursor:pointer;`;
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
      cell.onclick = () => { if (isAnswered) fullExamRevisits++; fullExamIndex = i; fullExamShowOverview = false; render(); };
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

  // 📓 Notes launcher during a with-notes mock — opens this question's region doc
  { const _q = fullExamDeck[fullExamIndex]; const nb = _q && notesBtn(_q); if (nb) { nb.style.cssText = "display:block;margin:6px auto 0;background:#F5F3FF;color:#5B21B6;border:1px solid #DDD6FE;border-radius:10px;padding:6px 14px;font-size:.82rem;font-weight:700;cursor:pointer;"; main.appendChild(nb); } }

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

  // Diagram/labeling questions carry an image — show it (the lab practical is image-based).
  if (q.images && q.images.length) {
    const imgWrap = document.createElement("div"); imgWrap.className = "qImageWrap";
    q.images.forEach(img => { const el = document.createElement("img"); el.className = "qImage"; el.src = "images/" + img; el.loading = "lazy"; el.onclick = () => el.classList.toggle("qImageZoomed"); imgWrap.appendChild(el); });
    qCard.appendChild(imgWrap);
  }

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
  prevBtn.onclick = () => { if (fullExamAnswers[fullExamIndex - 1] !== -1) fullExamRevisits++; fullExamIndex--; render(); };

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
  fullExamDeck.forEach((q, i) => { if (fullExamAnswers[i] === q.correct) correct++; });
  const pct = Math.round(correct / total * 100);

  // Record stats + History EXACTLY ONCE per completed exam. renderFullExamEnd runs on every
  // render() while this route is active, so without a guard a re-render / revisit re-inflates
  // seen/missed counts and appends duplicate attempts (ChatGPT audit #1; Sudden Death already
  // guards the same way via sdDeck._logged). fullExamLogged resets at each exam launch.
  if (!fullExamLogged) {
    fullExamLogged = true;
    fullExamDeck.forEach((q, i) => {
      const ans = fullExamAnswers[i];
      if (ans !== -1) recordQuestionStat(q, ans === q.correct, undefined, fullExamFlags.has(i)); // flagged = you weren't 100% on it
    });
    recordQuizResult("fullExam:" + state.sectionKey, correct, total);
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
      flags: { total: fullExamFlags.size, right: fRight, wrong: fWrong },
      // Pacing + review behavior: how much of the time budget you used, how much you left on the
      // table, and how many times you went back to re-check an already-answered question.
      pacing: {
        totalSec: fullExamTotalSeconds,
        usedSec: Math.max(0, fullExamTotalSeconds - fullExamSecondsLeft),
        leftSec: Math.max(0, fullExamSecondsLeft),
        revisits: fullExamRevisits
      }
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

/* Kick off the app after ALL module-level declarations are initialized. */
initApp();
