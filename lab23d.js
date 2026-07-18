/* ─────────────────────────────────────────────────────────────────────────
   Lab 2 · 3D Anatomy Explorer  (MVP)
   A real interactive Three.js viewer for heart / brain / torso. Complements the
   real-photo stations (which stay the closest-to-exam tool) — this is for spatial
   understanding & structure relationships.

   Design guarantees:
   • LAZY: three.js and the GLB assets download ONLY when the Explorer route opens.
   • LOCAL assets only (assets/models/*.glb) — never hotlinked. Manifest = models.json.
   • DROP-IN: real GLBs replace the render-test with zero viewer changes.
   • Until a real GLB is installed, a clearly-labelled RENDER-TEST cube is shown so
     controls can be verified. It is never presented as anatomy study content.
   • DISPOSE: geometry/material/texture/renderer are freed when leaving the route.
   • 3D performance is stored SEPARATELY (progressState.lab3d), not blended into MCQ.
   ───────────────────────────────────────────────────────────────────────── */

var l3 = {
  ready: false, loading: false, THREE: null,
  manifest: null, modelId: null, model: null,
  renderer: null, scene: null, camera: null, controls: null, raf: null,
  meshByStruct: {}, structById: {}, highlightMesh: null, _origMat: null,
  mode: "explore", status: "", installed: false,
  // practical
  pr: null,
};
var LAB3D_CDN = {
  three: "https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js",
  orbit: "https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js",
  gltf:  "https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js",
};
function _l3LoadScript(src) {
  return new Promise((res, rej) => {
    if ([...document.scripts].some(s => s.src === src)) return res();
    const s = document.createElement("script"); s.src = src;
    s.onload = () => res(); s.onerror = () => rej(new Error("load " + src));
    document.head.appendChild(s);
  });
}
async function ensureThree() {
  if (window.THREE && window.THREE.GLTFLoader && window.THREE.OrbitControls) { l3.THREE = window.THREE; return true; }
  await _l3LoadScript(LAB3D_CDN.three);
  await _l3LoadScript(LAB3D_CDN.orbit);
  await _l3LoadScript(LAB3D_CDN.gltf);
  l3.THREE = window.THREE;
  return !!(l3.THREE && l3.THREE.GLTFLoader);
}
function _l3WebGLOK() {
  try { const c = document.createElement("canvas"); return !!(window.WebGLRenderingContext && (c.getContext("webgl") || c.getContext("experimental-webgl"))); }
  catch (e) { return false; }
}
async function open3DExplorer() {
  state.route = "lab3d";
  if (!l3.manifest) {
    try { const r = await fetch("assets/models/models.json?v=1"); l3.manifest = await r.json(); }
    catch (e) { l3.manifest = { models: [] }; }
  }
  if (!l3.modelId && l3.manifest.models[0]) l3.modelId = l3.manifest.models[0].id;
  render();
}
function _l3Model() { return (l3.manifest && l3.manifest.models || []).find(m => m.id === l3.modelId) || null; }

/* ---- three.js scene lifecycle ---- */
function _l3Dispose() {
  if (l3.raf) { cancelAnimationFrame(l3.raf); l3.raf = null; }
  try { if (l3.model && l3.scene) l3.scene.remove(l3.model); } catch (e) {}
  try {
    if (l3.scene) l3.scene.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { const mats = Array.isArray(o.material) ? o.material : [o.material]; mats.forEach(mm => { if (mm.map) mm.map.dispose(); mm.dispose(); }); }
    });
  } catch (e) {}
  try { if (l3.renderer) { l3.renderer.forceContextLoss && l3.renderer.forceContextLoss(); l3.renderer.dispose(); if (l3.renderer.domElement && l3.renderer.domElement.parentNode) l3.renderer.domElement.parentNode.removeChild(l3.renderer.domElement); } } catch (e) {}
  l3.renderer = l3.scene = l3.camera = l3.controls = l3.model = null;
  l3.meshByStruct = {}; l3.highlightMesh = null; l3._origMat = null;
}
function _l3InitScene(container) {
  const T = l3.THREE;
  const w = container.clientWidth || 320, h = Math.max(260, Math.min(window.innerHeight * 0.5, 460));
  const renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));  // iPhone-friendly cap
  renderer.setSize(w, h);
  container.appendChild(renderer.domElement);
  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(45, w / h, 0.05, 100);
  camera.position.set(0, 0, 3.2);
  const controls = new T.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.08; controls.enablePan = true;
  scene.add(new T.AmbientLight(0xffffff, 0.75));
  const d1 = new T.DirectionalLight(0xffffff, 0.8); d1.position.set(2, 3, 4); scene.add(d1);
  const d2 = new T.DirectionalLight(0xffffff, 0.35); d2.position.set(-3, -1, -2); scene.add(d2);
  l3.renderer = renderer; l3.scene = scene; l3.camera = camera; l3.controls = controls;
  const onResize = () => { const ww = container.clientWidth || w; renderer.setSize(ww, h); camera.aspect = ww / h; camera.updateProjectionMatrix(); };
  window.addEventListener("resize", onResize);
  const loop = () => { if (!l3.renderer) return; l3.raf = requestAnimationFrame(loop); controls.update(); renderer.render(scene, camera); };
  loop();
  // tap-to-identify (raycast)
  const ray = new T.Raycaster(), ptr = new T.Vector2();
  renderer.domElement.addEventListener("pointerdown", (ev) => {
    if (!l3.model) return;
    const rect = renderer.domElement.getBoundingClientRect();
    ptr.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    ptr.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    ray.setFromCamera(ptr, camera);
    const hits = ray.intersectObjects(l3.model.children, true);
    if (hits.length) { const nm = hits[0].object.name; const sid = Object.keys(l3.meshByStruct).find(k => l3.meshByStruct[k] === nm); if (sid) _l3Select(sid, true); }
  });
}
function _l3FrameModel(obj) {
  const T = l3.THREE, box = new T.Box3().setFromObject(obj), size = box.getSize(new T.Vector3()), center = box.getCenter(new T.Vector3());
  obj.position.sub(center);                         // center at origin
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const dist = maxDim * 2.2;
  l3.camera.position.set(0, 0, dist); l3.camera.near = dist / 100; l3.camera.far = dist * 100; l3.camera.updateProjectionMatrix();
  if (l3.controls) { l3.controls.target.set(0, 0, 0); l3.controls.update(); }
  l3._frameDist = dist;
}
function _l3RenderTestCube() {
  const T = l3.THREE;
  const g = new T.BoxGeometry(1, 1, 1);
  const m = new T.MeshStandardMaterial({ color: 0x2e6f63, wireframe: true });
  const cube = new T.Mesh(g, m); cube.name = "__render_test__";
  const grp = new T.Group(); grp.add(cube); l3.scene.add(grp); l3.model = grp; l3.installed = false;
  _l3FrameModel(grp);
}
function _l3LoadModel() {
  const md = _l3Model(); if (!md || !l3.scene) return;
  // clear old model
  if (l3.model) { l3.scene.remove(l3.model); try { l3.model.traverse(o => { if (o.geometry) o.geometry.dispose(); }); } catch (e) {} l3.model = null; }
  l3.meshByStruct = {}; l3.structById = {}; (md.structures || []).forEach(s => { l3.structById[s.id] = s; if (s.mesh) l3.meshByStruct[s.id] = s.mesh; });
  l3.status = "Loading " + md.title + "…"; render3DStatus();
  const loader = new l3.THREE.GLTFLoader();
  loader.load(md.glb + "?v=1",
    (gltf) => {
      const root = gltf.scene || gltf.scenes[0];
      l3.scene.add(root); l3.model = root; l3.installed = true; md.installed = true;
      _l3FrameModel(root);
      l3.status = ""; render3DStatus();
    },
    undefined,
    (err) => {
      // GLB not installed yet (expected until Codex supplies it) → clear render-test + note.
      l3.installed = false;
      _l3RenderTestCube();
      l3.status = "notInstalled"; render3DStatus();
    }
  );
}
function _l3Preset(name) {
  const md = _l3Model(); if (!md || !md.cameraPresets || !md.cameraPresets[name] || !l3.camera) return;
  const p = md.cameraPresets[name], d = l3._frameDist || 3.2;
  const v = p.pos, len = Math.hypot(v[0], v[1], v[2]) || 1;
  l3.camera.position.set(v[0] / len * d, v[1] / len * d, v[2] / len * d);
  if (l3.controls) { l3.controls.target.set(p.target[0], p.target[1], p.target[2]); l3.controls.update(); }
}
function _l3ClearHighlight() {
  if (l3.highlightMesh && l3._origMat) { l3.highlightMesh.material = l3._origMat; }
  l3.highlightMesh = null; l3._origMat = null;
}
function _l3HighlightMesh(meshName) {
  _l3ClearHighlight();
  if (!l3.model || !meshName) return;
  l3.model.traverse(o => { if (o.isMesh && o.name === meshName && !l3.highlightMesh) {
    l3.highlightMesh = o; l3._origMat = o.material;
    const hm = o.material.clone(); hm.emissive = new l3.THREE.Color(0xffcc33); hm.emissiveIntensity = 0.9; o.material = hm;
  }});
}
var _l3Selected = null;
function _l3Select(structId, fromTap) {
  _l3Selected = structId;
  const s = l3.structById[structId];
  if (s && s.mesh) _l3HighlightMesh(s.mesh);
  render();   // refresh the info panel
}
function render3DStatus() {
  const el = document.getElementById("l3status"); if (!el) return;
  if (l3.status === "notInstalled") {
    el.innerHTML = `<span style="color:#B7791F;">⚠️ The <b>${escapeHtml((_l3Model()||{}).title||"")}</b> 3D model isn't installed yet — showing a render‑test object (controls work; this is NOT anatomy). It becomes real the moment the licensed GLB is dropped at <code>assets/models/</code>.</span>`;
  } else { el.textContent = l3.status || ""; }
}
/* ---- 3D practical scoring (separate synced dimension: progressState.lab3d) ---- */
function record3D(modelId, structId, ok, first) {
  const k = modelId + ":" + structId;
  if (!progressState.lab3d) progressState.lab3d = {};
  const e = progressState.lab3d[k] || { seen: 0, missed: 0, firstDone: 0, firstOk: 0 };
  e.seen++; if (!ok) e.missed++; if (first) { e.firstDone++; if (ok) e.firstOk++; }
  e.last = Date.now(); progressState.lab3d[k] = e; saveLocalProgress();
}
function lab3dReadiness() {
  const s = (progressState && progressState.lab3d) || {}; let done = 0, ok = 0;
  Object.keys(s).forEach(k => { done += s[k].firstDone || 0; ok += s[k].firstOk || 0; });
  return done ? { pct: Math.round(ok / done * 100), ok, done } : null;
}
function _l3PracticalStructs() {
  const md = _l3Model(); if (!md) return [];
  // Only structures actually bound to a mesh can be pinned/highlighted for Practical.
  return (md.structures || []).filter(s => s.mesh);
}
function startL3Practical() {
  const pool = _l3PracticalStructs();
  if (!l3.installed || !pool.length) { alert("Practical needs an installed 3D model with tagged structures. Explore works now; Practical unlocks when the real GLB + mesh names are in."); return; }
  l3.mode = "practical";
  l3.pr = { deck: shuffle(pool.slice()), i: 0, firstScored: new Set(), firstOk: 0, total: pool.length, recovered: 0, secLeft: 60, answered: false, chosen: null, timedOut: false, timer: null };
  _l3PracticalNext(true);
}
function _l3PracticalNext(first) {
  const p = l3.pr; if (!p) return;
  if (p.timer) { clearInterval(p.timer); p.timer = null; }
  if (p.i >= p.deck.length) { l3.mode = "practicalEnd"; render(); return; }
  const s = p.deck[p.i];
  // build 4 choices (correct + 3 distractors)
  const others = (_l3Model().structures || []).filter(x => x.id !== s.id).map(x => x.name);
  p.choices = shuffle([s.name].concat(shuffle(others).slice(0, 3)));
  p.answered = false; p.chosen = null; p.timedOut = false; p.secLeft = 60;
  _l3HighlightMesh(s.mesh);            // pin the target (no name shown)
  render();
  p.timer = setInterval(() => {
    p.secLeft--; const el = document.getElementById("l3prtimer");
    if (el) { el.textContent = p.secLeft + "s"; el.style.color = p.secLeft <= 10 ? "#C0392B" : "var(--muted)"; }
    if (p.secLeft <= 0) { clearInterval(p.timer); p.timer = null; if (!p.answered) { p.answered = true; p.timedOut = true; _l3Grade(false); } }
  }, 1000);
}
function _l3Grade(ok) {
  const p = l3.pr; if (!p) return; const s = p.deck[p.i];
  const firstAttempt = !p.firstScored.has(s.id);
  if (firstAttempt) { p.firstScored.add(s.id); if (ok) p.firstOk++; }
  else if (ok) { p.recovered++; }
  record3D(l3.modelId, s.id, ok, firstAttempt);
  if (!ok) p.deck.push(s);   // requeue (doesn't change first-pass)
  p.i++; render();           // show reveal briefly then Next handled in UI
}

function render3DExplorer(main) {
  if (!_l3WebGLOK()) {
    const m = document.createElement("div"); m.style.cssText = "padding:40px 20px;text-align:center;color:#888;";
    m.innerHTML = "This device/browser doesn't support WebGL, so the 3D viewer can't run here.<br>Use the <b>Real Class Models</b> photo stations instead.";
    main.appendChild(m); return;
  }
  if (!l3.THREE) {
    const m = document.createElement("div"); m.style.cssText = "padding:40px 20px;text-align:center;color:#888;";
    m.textContent = "Loading 3D engine…"; main.appendChild(m);
    ensureThree().then(() => render()).catch(() => { const s = document.getElementById("l3status"); if (s) s.textContent = "Couldn't load the 3D engine."; });
    return;
  }
  const md = _l3Model();
  const wrap = document.createElement("div"); wrap.style.cssText = "max-width:680px;margin:0 auto;";

  // model selector
  const sel = document.createElement("div"); sel.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;";
  (l3.manifest.models || []).forEach(mm => {
    const b = document.createElement("button"); const on = mm.id === l3.modelId;
    b.textContent = mm.title;
    b.style.cssText = `border:1.5px solid ${on ? "var(--ink)" : "#cfd8e3"};background:${on ? "var(--ink)" : "#fff"};color:${on ? "#fff" : "#41506a"};border-radius:999px;padding:6px 14px;font-size:.85rem;font-weight:700;cursor:pointer;`;
    b.onclick = () => { if (l3.modelId !== mm.id) { l3.modelId = mm.id; l3._loadedId = null; l3.mode = "explore"; _l3Selected = null; render(); } };
    sel.appendChild(b);
  });
  wrap.appendChild(sel);

  // canvas host (persist the renderer across re-renders)
  const host = document.createElement("div"); host.id = "l3wrap"; host.style.cssText = "width:100%;border-radius:12px;overflow:hidden;background:linear-gradient(#0d1117,#1b2430);position:relative;min-height:260px;";
  const status = document.createElement("div"); status.id = "l3status"; status.style.cssText = "font-size:.78rem;color:var(--muted);margin:8px 2px;line-height:1.4;";
  wrap.appendChild(host); wrap.appendChild(status);
  main.appendChild(wrap);

  if (!l3.renderer) { _l3InitScene(host); l3._loadedId = null; }
  else if (l3.renderer.domElement.parentNode !== host) { host.appendChild(l3.renderer.domElement); }
  if (l3._loadedId !== l3.modelId) { l3._loadedId = l3.modelId; _l3LoadModel(); }
  setTimeout(render3DStatus, 0);

  // camera presets
  if (md && md.cameraPresets) {
    const pr = document.createElement("div"); pr.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;margin:10px 0;";
    Object.keys(md.cameraPresets).forEach(name => {
      const b = document.createElement("button"); b.textContent = name;
      b.style.cssText = "border:1px solid #cfd8e3;background:#fff;color:#41506a;border-radius:8px;padding:5px 11px;font-size:.78rem;font-weight:600;cursor:pointer;text-transform:capitalize;";
      b.onclick = () => _l3Preset(name); pr.appendChild(b);
    });
    const rst = document.createElement("button"); rst.textContent = "⟲ reset"; rst.style.cssText = "border:1px solid #cfd8e3;background:#f3f6fa;color:#41506a;border-radius:8px;padding:5px 11px;font-size:.78rem;font-weight:600;cursor:pointer;";
    rst.onclick = () => { if (l3.model) _l3FrameModel(l3.model); }; pr.appendChild(rst);
    wrap.appendChild(pr);
  }

  // mode toggle
  const modes = document.createElement("div"); modes.style.cssText = "display:flex;gap:8px;margin:6px 0 12px;";
  [["explore", "🔎 Explore"], ["practical", "⏱️ Practical"]].forEach(([mk, lbl]) => {
    const on = (mk === "explore" && (l3.mode === "explore")) || (mk === "practical" && (l3.mode === "practical" || l3.mode === "practicalEnd"));
    const b = document.createElement("button"); b.textContent = lbl;
    b.style.cssText = `flex:1;border:1.5px solid ${on ? "var(--teal)" : "#cfd8e3"};background:${on ? "var(--teal)" : "#fff"};color:${on ? "#fff" : "#41506a"};border-radius:10px;padding:9px;font-size:.85rem;font-weight:700;cursor:pointer;`;
    b.onclick = () => { if (mk === "explore") { l3.mode = "explore"; _l3ClearHighlight(); render(); } else { startL3Practical(); } };
    modes.appendChild(b);
  });
  wrap.appendChild(modes);

  if (l3.mode === "practical" || l3.mode === "practicalEnd") { _l3RenderPractical(wrap); }
  else { _l3RenderExplore(wrap); }

  // attribution
  const att = document.createElement("div"); att.style.cssText = "font-size:.72rem;color:#9aa2b1;margin-top:14px;border-top:1px solid #eee;padding-top:8px;line-height:1.4;";
  att.innerHTML = md && md.attribution ? ("Model: " + escapeHtml(md.attribution) + (md.license ? " · " + escapeHtml(md.license) : "")) : "Model attribution appears here once a licensed GLB is installed. Assets are stored locally; no hotlinking.";
  wrap.appendChild(att);
}
function _l3RenderExplore(wrap) {
  const md = _l3Model(); if (!md) return;
  const hint = document.createElement("div"); hint.style.cssText = "font-size:.8rem;color:var(--muted);margin-bottom:8px;";
  hint.textContent = "Rotate / pinch to zoom. Tap a structure below (or tap it on the model once installed) to highlight + learn it.";
  wrap.appendChild(hint);
  // selected info
  if (_l3Selected && l3.structById[_l3Selected]) {
    const s = l3.structById[_l3Selected];
    const info = document.createElement("div"); info.style.cssText = "background:#e7f1ea;border:1px solid #bcd8cc;border-radius:12px;padding:12px 14px;margin-bottom:12px;";
    info.innerHTML = `<div style="font-weight:800;color:var(--accent-ink);font-size:1.02rem;">${escapeHtml(s.name)}</div>
      <div style="font-size:.78rem;color:var(--teal-2);font-weight:700;margin:2px 0 4px;">${escapeHtml(s.system)}</div>
      <div style="font-size:.86rem;color:#4a5a52;line-height:1.5;">${escapeHtml(s.function)}</div>
      ${(s.aliases && s.aliases.length) ? `<div style="font-size:.75rem;color:#7c8a83;margin-top:4px;">a.k.a. ${s.aliases.map(escapeHtml).join(", ")}</div>` : ""}`;
    wrap.appendChild(info);
  }
  const list = document.createElement("div"); list.style.cssText = "display:flex;flex-direction:column;gap:6px;";
  (md.structures || []).forEach(s => {
    const b = document.createElement("button"); const on = _l3Selected === s.id;
    b.style.cssText = `text-align:left;border:1px solid ${on ? "var(--teal)" : "#e4e8ee"};background:${on ? "#f0f8f5" : "#fff"};border-radius:10px;padding:10px 12px;cursor:pointer;font-size:.9rem;font-weight:600;color:var(--text);`;
    b.innerHTML = `${escapeHtml(s.name)} <span style="font-size:.72rem;color:#9aa2b1;font-weight:500;">· ${escapeHtml(s.system)}</span>`;
    b.onclick = () => _l3Select(s.id, false);
    list.appendChild(b);
  });
  wrap.appendChild(list);
}
function _l3RenderPractical(wrap) {
  const p = l3.pr;
  if (l3.mode === "practicalEnd" && p) {
    const pct = p.total ? Math.round(p.firstOk / p.total * 100) : 0;
    const end = document.createElement("div"); end.style.cssText = "text-align:center;padding:24px 10px;";
    end.innerHTML = `<div style="font-size:3rem;">${pct >= 80 ? "🏆" : pct >= 60 ? "🎯" : "🧊"}</div>
      <div style="font-size:1.3rem;font-weight:800;margin:6px 0;">3D Practical complete</div>
      <div style="font-size:.72rem;font-weight:800;letter-spacing:.08em;color:var(--muted);">FIRST-PASS SCORE</div>
      <div style="font-size:1.9rem;font-weight:900;color:var(--accent);">${p.firstOk}/${p.total} · ${pct}%</div>
      <div style="color:#888;margin:6px 0 18px;">${p.recovered ? `+${p.recovered} recovered on retry (not counted). ` : ""}Timeouts counted as misses. Separate from photo & MCQ readiness.</div>`;
    const again = document.createElement("button"); again.className = "primaryBtn"; again.style.maxWidth = "300px"; again.textContent = "🔁 Again"; again.onclick = () => startL3Practical();
    const done = document.createElement("button"); done.className = "secondaryBtn"; done.style.maxWidth = "300px"; done.textContent = "Back to Explore"; done.onclick = () => { l3.mode = "explore"; _l3ClearHighlight(); render(); };
    end.append(again, done); wrap.appendChild(end); return;
  }
  if (!p) return;
  const s = p.deck[p.i];
  const bar = document.createElement("div"); bar.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-size:.85rem;color:var(--muted);";
  bar.innerHTML = `<span>🧊 ${p.i + 1} / ${p.total}</span><span id="l3prtimer" style="font-weight:800;font-variant-numeric:tabular-nums;">${p.secLeft}s</span>`;
  wrap.appendChild(bar);
  const q = document.createElement("div"); q.style.cssText = "font-size:1.02rem;font-weight:700;text-align:center;margin:6px 0 12px;color:var(--text);";
  q.textContent = "What is the highlighted structure?";
  wrap.appendChild(q);
  if (!p.answered) {
    p.choices.forEach(name => {
      const b = document.createElement("button"); b.className = "examOption"; b.textContent = name;
      b.onclick = () => { if (p.answered) return; p.answered = true; p.chosen = name; if (p.timer) { clearInterval(p.timer); p.timer = null; } _l3Grade(name === s.name); };
      wrap.appendChild(b);
    });
  } else {
    const ok = !p.timedOut && p.chosen === s.name;
    const fb = document.createElement("div"); fb.style.cssText = `background:${ok ? "#e7f1ea" : "#f7e7e2"};border:1px solid ${ok ? "#bcd8cc" : "#e6b8ac"};border-radius:12px;padding:12px 14px;margin-bottom:10px;text-align:center;`;
    fb.innerHTML = `<div style="font-weight:800;color:${ok ? "#27ae60" : "#c0392b"};">${p.timedOut ? "⏱ Time's up — miss." : ok ? "✅ Correct" : "❌ " + escapeHtml(p.chosen || "")}</div>
      <div style="font-size:.95rem;font-weight:700;color:var(--accent-ink);margin-top:4px;">${escapeHtml(s.name)}</div>
      <div style="font-size:.82rem;color:#4a5a52;margin-top:2px;">${escapeHtml(s.function)}</div>`;
    wrap.appendChild(fb);
    const nxt = document.createElement("button"); nxt.className = "primaryBtn"; nxt.style.cssText += "width:100%;max-width:none;";
    nxt.textContent = "Next →"; nxt.onclick = () => _l3PracticalNext(false);
    wrap.appendChild(nxt);
  }
}
if (typeof module !== "undefined" && module.exports) module.exports = { open3DExplorer };

