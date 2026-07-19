/* ─────────────────────────────────────────────────────────────────────────
   Lab 2 · 3D Anatomy Explorer
   A real interactive Three.js viewer for heart / brain / torso, driven by the
   HRA-derived asset pack (models.json + labels.json). Complements the real-photo
   stations, which stay the authority for Monday's practical (exact classroom
   models, colors, removable pieces, printed numbers). This is for spatial
   understanding & structure relationships.

   Data contract (Codex pack, schemaVersion 1):
   • models.json  → { defaultModel, labels:{file,key,value,provenance}, models:[
                       {id,title,file,poster,purpose,meshCount,selectionKey:"mesh.name",
                        extensionsRequired:["KHR_mesh_quantization"|...],
                        initialView:{frontAxis,upAxis,fit},source{...},knownGaps[]} ] }
   • labels.json  → { models:{ heart:[{nodeName,label,ontologyId,labelSource}], brain:[…], torso:[…] } }
     Selection: raycast → hit.object.name === nodeName → label.

   Guarantees:
   • LAZY: three.js + the GLB download ONLY when the Explorer route opens.
   • LOCAL assets (assets/models/*.glb) — never hotlinked.
   • POSTER-FIRST: the model's poster shows immediately, replaced when the GLB is ready.
   • DISPOSE: geometry/material/texture/renderer freed when leaving the route.
   • 3D performance stored SEPARATELY (progressState.lab3d, source "3d") — never blended into MCQ/photo.
   ───────────────────────────────────────────────────────────────────────── */

var LAB3D_BASE = "assets/models/";           // GLBs + json live here; posters resolved via model.poster
var LAB3D_VER = "20260718n";                 // cache-bust for the manifest + assets

var l3 = {
  ready: false, THREE: null,
  manifest: null, labels: null, modelId: null,
  renderer: null, scene: null, camera: null, controls: null, raf: null, root: null,
  structById: {}, structs: [], highlightMesh: null, _origMat: null, _loadedId: null,
  mode: "explore", status: "", installed: false, filter: "",
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
// Resolve a manifest-relative path (e.g. "../posters/heart.webp") against assets/models/.
function _l3Path(rel) {
  if (!rel) return "";
  if (/^https?:\/\//.test(rel)) return rel;
  // normalize leading ../ against the models/ base
  let base = LAB3D_BASE.replace(/\/$/, "").split("/");   // ["assets","models"]
  let parts = rel.split("/");
  parts.forEach(p => { if (p === "..") base.pop(); else if (p !== ".") base.push(p); });
  return base.join("/");
}
async function open3DExplorer() {
  state.route = "lab3d";
  if (!l3.manifest || !l3.labels) {
    try {
      const [mR, lR] = await Promise.all([
        fetch(LAB3D_BASE + "models.json?v=" + LAB3D_VER),
        fetch(LAB3D_BASE + "labels.json?v=" + LAB3D_VER),
      ]);
      l3.manifest = await mR.json();
      l3.labels = await lR.json();
    } catch (e) { l3.manifest = l3.manifest || { models: [] }; l3.labels = l3.labels || { models: {} }; }
  }
  if (!l3.modelId) l3.modelId = (l3.manifest && l3.manifest.defaultModel) || ((l3.manifest.models[0] || {}).id);
  render();
}
function _l3Model() { return (l3.manifest && l3.manifest.models || []).find(m => m.id === l3.modelId) || null; }

// Build the structure list for the active model from labels.json (nodeName → label).
function _l3BuildStructs() {
  l3.structs = []; l3.structById = {};
  const rows = (l3.labels && l3.labels.models && l3.labels.models[l3.modelId]) || [];
  rows.forEach(r => {
    const s = {
      id: r.nodeName, name: r.label || r.nodeName, mesh: r.nodeName,
      ontologyId: r.ontologyId || null,
      official: r.labelSource === "hra-crosswalk",
    };
    l3.structs.push(s); l3.structById[s.id] = s;
  });
}

/* ---- three.js scene lifecycle ---- */
function _l3Dispose() {
  if (l3.raf) { cancelAnimationFrame(l3.raf); l3.raf = null; }
  try { if (l3.root && l3.scene) l3.scene.remove(l3.root); } catch (e) {}
  try {
    if (l3.scene) l3.scene.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { const mats = Array.isArray(o.material) ? o.material : [o.material]; mats.forEach(mm => { if (mm && mm.map) mm.map.dispose(); if (mm) mm.dispose(); }); }
    });
  } catch (e) {}
  try { if (l3.renderer) { l3.renderer.forceContextLoss && l3.renderer.forceContextLoss(); l3.renderer.dispose(); if (l3.renderer.domElement && l3.renderer.domElement.parentNode) l3.renderer.domElement.parentNode.removeChild(l3.renderer.domElement); } } catch (e) {}
  if (l3._onResize) { try { window.removeEventListener("resize", l3._onResize); } catch (e) {} l3._onResize = null; }
  l3.renderer = l3.scene = l3.camera = l3.controls = l3.root = null;
  l3.highlightMesh = null; l3._origMat = null; l3._loadedId = null; l3.installed = false;
}
function _l3PixelCap() {
  const small = (window.innerWidth || 1024) <= 480;
  return Math.min(window.devicePixelRatio || 1, small ? 1.5 : 2);
}
function _l3InitScene(container) {
  const T = l3.THREE;
  const w = container.clientWidth || 320, h = Math.max(280, Math.min(window.innerHeight * 0.52, 480));
  const renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(_l3PixelCap());
  renderer.setSize(w, h);
  container.appendChild(renderer.domElement);
  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(45, w / h, 0.01, 100);
  camera.position.set(0, 0, 3.2);
  const controls = new T.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.08; controls.enablePan = true;
  scene.add(new T.AmbientLight(0xffffff, 0.8));
  const d1 = new T.DirectionalLight(0xffffff, 0.75); d1.position.set(2, 3, 4); scene.add(d1);
  const d2 = new T.DirectionalLight(0xffffff, 0.35); d2.position.set(-3, -1, -2); scene.add(d2);
  l3.renderer = renderer; l3.scene = scene; l3.camera = camera; l3.controls = controls;
  l3._onResize = () => { if (!l3.renderer) return; const ww = container.clientWidth || w; renderer.setSize(ww, h); camera.aspect = ww / h; camera.updateProjectionMatrix(); };
  window.addEventListener("resize", l3._onResize);
  const loop = () => { if (!l3.renderer) return; l3.raf = requestAnimationFrame(loop); controls.update(); renderer.render(scene, camera); };
  loop();
  // tap-to-identify (raycast → mesh.name → structure)
  const ray = new T.Raycaster(), ptr = new T.Vector2();
  renderer.domElement.addEventListener("pointerdown", (ev) => {
    if (!l3.root) return;
    const rect = renderer.domElement.getBoundingClientRect();
    ptr.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    ptr.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    ray.setFromCamera(ptr, camera);
    const hits = ray.intersectObjects(l3.root.children, true).filter(hh => hh.object.visible);
    if (hits.length) {
      // climb to the named node (crosswalk names live on the node, geometry may be a child)
      let o = hits[0].object, nm = o.name;
      while ((!nm || !l3.structById[nm]) && o.parent) { o = o.parent; nm = o.name; }
      if (nm && l3.structById[nm]) {
        if (l3.mode === "practical") _l3PracticalTap(nm);
        else _l3Select(nm, true);
      }
    }
  });
}
function _l3FrameModel(obj) {
  const T = l3.THREE, box = new T.Box3().setFromObject(obj), size = box.getSize(new T.Vector3()), center = box.getCenter(new T.Vector3());
  obj.position.sub(center);                         // center at origin
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const dist = maxDim * 2.1;
  l3._frameDist = dist; l3._frameMax = maxDim;
  l3.camera.position.set(0, 0, dist); l3.camera.near = dist / 200; l3.camera.far = dist * 200; l3.camera.updateProjectionMatrix();
  if (l3.controls) { l3.controls.target.set(0, 0, 0); l3.controls.update(); }
}
// Generic orthographic-style presets computed from the framed distance (up = +Y, front = +Z).
function _l3View(dir) {
  if (!l3.camera) return; const d = l3._frameDist || 3.2;
  const map = { front: [0, 0, 1], back: [0, 0, -1], left: [-1, 0, 0], right: [1, 0, 0], top: [0, 1, 0], bottom: [0, -1, 0] };
  const v = map[dir] || map.front;
  l3.camera.position.set(v[0] * d, v[1] * d, v[2] * d);
  if (l3.controls) { l3.controls.target.set(0, 0, 0); l3.controls.update(); }
}
function _l3Poster(container) {
  const md = _l3Model(); if (!md || !md.poster) return null;
  const img = document.createElement("img");
  img.src = _l3Path(md.poster) + "?v=" + LAB3D_VER;
  img.alt = md.title + " (loading)";
  img.style.cssText = "position:absolute;inset:0;width:100%;height:100%;object-fit:contain;opacity:.55;pointer-events:none;transition:opacity .3s;";
  img.id = "l3poster";
  container.appendChild(img);
  return img;
}
function _l3LoadModel(host) {
  const md = _l3Model(); if (!md || !l3.scene) return;
  // clear old root
  if (l3.root) { l3.scene.remove(l3.root); try { l3.root.traverse(o => { if (o.geometry) o.geometry.dispose(); }); } catch (e) {} l3.root = null; }
  l3.highlightMesh = null; l3._origMat = null;
  _l3BuildStructs();
  const poster = host ? _l3Poster(host) : null;
  l3.installed = false; l3.status = "Loading " + md.title + "…"; render3DStatus();
  const loader = new l3.THREE.GLTFLoader();
  loader.load(_l3Path(md.file) + "?v=" + LAB3D_VER,
    (gltf) => {
      const root = gltf.scene || gltf.scenes[0];
      l3.scene.add(root); l3.root = root; l3.installed = true;
      _l3FrameModel(root);
      if (poster && poster.parentNode) poster.parentNode.removeChild(poster);
      l3.status = ""; render3DStatus();
    },
    undefined,
    (err) => {
      // Only expected on the DEPLOYED site until brain.glb (12 MB) is uploaded to GitHub.
      l3.installed = false; l3.status = "loadFail"; render3DStatus();
      if (poster) poster.style.opacity = "0.9";
    }
  );
}
function _l3ClearHighlight() {
  if (l3.highlightMesh && l3._origMat) { l3.highlightMesh.material = l3._origMat; }
  l3.highlightMesh = null; l3._origMat = null;
}
function _l3HighlightMesh(meshName) {
  _l3ClearHighlight();
  if (!l3.root || !meshName) return;
  let node = null;
  l3.root.traverse(o => { if (!node && o.name === meshName) node = o; });
  if (!node) return;
  // find a mesh under (or at) the node to recolor; clone material (shared materials)
  let target = node.isMesh ? node : null;
  if (!target) node.traverse(o => { if (!target && o.isMesh) target = o; });
  if (!target) return;
  l3.highlightMesh = target; l3._origMat = target.material;
  const src = Array.isArray(target.material) ? target.material[0] : target.material;
  const hm = src.clone(); hm.emissive = new l3.THREE.Color(0xffcc33); hm.emissiveIntensity = 0.95;
  target.material = hm;
}
function _l3SetVisible(meshName, vis) {
  if (!l3.root) return;
  l3.root.traverse(o => { if (o.name === meshName) o.visible = vis; });
}
function _l3Isolate(meshName) {
  if (!l3.root) return;
  l3.root.traverse(o => { if (o.isMesh) o.visible = false; });
  // show the isolated node subtree
  let node = null; l3.root.traverse(o => { if (!node && o.name === meshName) node = o; });
  if (node) node.traverse(o => { o.visible = true; });
}
function _l3ShowAll() { if (l3.root) l3.root.traverse(o => { o.visible = true; }); }

var _l3Selected = null;
function _l3Select(structId, fromTap) {
  _l3Selected = structId;
  _l3HighlightMesh(structId);
  render();
}
function render3DStatus() {
  const el = document.getElementById("l3status"); if (!el) return;
  if (l3.status === "loadFail") {
    el.innerHTML = `<span style="color:#B7791F;">⚠️ Couldn't load the <b>${escapeHtml((_l3Model() || {}).title || "")}</b> model. On the live site the largest model may still be uploading — try Reload in a minute. Showing its poster meanwhile.</span>`;
  } else { el.textContent = l3.status || ""; }
}
/* ---- 3D practical scoring (separate synced dimension: progressState.lab3d, source "3d") ---- */
function record3D(modelId, structId, ok, first) {
  const k = modelId + ":" + structId;
  if (!progressState.lab3d) progressState.lab3d = {};
  const e = progressState.lab3d[k] || { seen: 0, missed: 0, firstDone: 0, firstOk: 0 };
  e.seen++; if (!ok) e.missed++; if (first) { e.firstDone++; if (ok) e.firstOk++; }
  e.last = Date.now(); e.src = "3d"; progressState.lab3d[k] = e; saveLocalProgress();
}
function lab3dReadiness() {
  const s = (progressState && progressState.lab3d) || {}; let done = 0, ok = 0;
  Object.keys(s).forEach(k => { done += s[k].firstDone || 0; ok += s[k].firstOk || 0; });
  return done ? { pct: Math.round(ok / done * 100), ok, done } : null;
}
function startL3Practical() {
  if (!l3.installed || !l3.structs.length) { alert("Practical needs the model loaded. Explore/rotate works; if the model is still loading, give it a moment."); return; }
  _l3ShowAll(); _l3ClearHighlight();
  l3.mode = "practical";
  const pool = l3.structs.slice();
  l3.pr = { deck: shuffle(pool.slice()), i: 0, firstScored: new Set(), firstOk: 0, total: pool.length, recovered: 0, secLeft: 60, answered: false, chosen: null, timedOut: false, timer: null, useTap: false };
  _l3PracticalNext(true);
}
function _l3PracticalNext(first) {
  const p = l3.pr; if (!p) return;
  if (p.timer) { clearInterval(p.timer); p.timer = null; }
  if (p.i >= p.deck.length) { l3.mode = "practicalEnd"; render(); return; }
  const s = p.deck[p.i];
  const others = l3.structs.filter(x => x.id !== s.id).map(x => x.name);
  p.choices = shuffle([s.name].concat(shuffle(others).slice(0, 3)));
  p.answered = false; p.chosen = null; p.timedOut = false; p.secLeft = 60;
  _l3ShowAll(); _l3HighlightMesh(s.mesh);       // pin the target (name hidden)
  render();
  p.timer = setInterval(() => {
    p.secLeft--; const el = document.getElementById("l3prtimer");
    if (el) { el.textContent = p.secLeft + "s"; el.style.color = p.secLeft <= 10 ? "#C0392B" : "var(--muted)"; }
    if (p.secLeft <= 0) { clearInterval(p.timer); p.timer = null; if (!p.answered) { p.answered = true; p.timedOut = true; _l3Grade(false); } }
  }, 1000);
}
function _l3PracticalTap(nodeName) {
  const p = l3.pr; if (!p || p.answered) return;
  const s = p.deck[p.i];
  p.answered = true; p.chosen = (l3.structById[nodeName] || {}).name || nodeName;
  if (p.timer) { clearInterval(p.timer); p.timer = null; }
  _l3Grade(nodeName === s.id);
}
function _l3Grade(ok) {
  const p = l3.pr; if (!p) return; const s = p.deck[p.i];
  const firstAttempt = !p.firstScored.has(s.id);
  if (firstAttempt) { p.firstScored.add(s.id); if (ok) p.firstOk++; }
  else if (ok) { p.recovered++; }
  record3D(l3.modelId, s.id, ok, firstAttempt);
  if (!ok) p.deck.push(s);   // requeue (doesn't change first-pass)
  p.i++; render();
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
    b.onclick = () => { if (l3.modelId !== mm.id) { l3.modelId = mm.id; l3._loadedId = null; l3.mode = "explore"; _l3Selected = null; l3.filter = ""; render(); } };
    sel.appendChild(b);
  });
  wrap.appendChild(sel);

  // canvas host (persist the renderer across re-renders)
  const host = document.createElement("div"); host.id = "l3wrap"; host.style.cssText = "width:100%;border-radius:12px;overflow:hidden;background:linear-gradient(#0d1117,#1b2430);position:relative;min-height:280px;";
  const status = document.createElement("div"); status.id = "l3status"; status.style.cssText = "font-size:.78rem;color:var(--muted);margin:8px 2px;line-height:1.4;";
  wrap.appendChild(host); wrap.appendChild(status);
  main.appendChild(wrap);

  if (!l3.renderer) { _l3InitScene(host); l3._loadedId = null; }
  else if (l3.renderer.domElement.parentNode !== host) { host.appendChild(l3.renderer.domElement); }
  if (l3._loadedId !== l3.modelId) { l3._loadedId = l3.modelId; _l3LoadModel(host); }
  setTimeout(render3DStatus, 0);

  // orientation presets + reset
  const pr = document.createElement("div"); pr.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;margin:10px 0;";
  ["front", "back", "left", "right", "top"].forEach(name => {
    const b = document.createElement("button"); b.textContent = name;
    b.style.cssText = "border:1px solid #cfd8e3;background:#fff;color:#41506a;border-radius:8px;padding:5px 11px;font-size:.78rem;font-weight:600;cursor:pointer;text-transform:capitalize;";
    b.onclick = () => _l3View(name); pr.appendChild(b);
  });
  const rst = document.createElement("button"); rst.textContent = "⟲ reset"; rst.style.cssText = "border:1px solid #cfd8e3;background:#f3f6fa;color:#41506a;border-radius:8px;padding:5px 11px;font-size:.78rem;font-weight:600;cursor:pointer;";
  rst.onclick = () => { if (l3.root) { _l3ShowAll(); _l3FrameModel(l3.root); } }; pr.appendChild(rst);
  wrap.appendChild(pr);

  // mode toggle
  const modes = document.createElement("div"); modes.style.cssText = "display:flex;gap:8px;margin:6px 0 12px;";
  [["explore", "🔎 Explore"], ["practical", "⏱️ Practical"]].forEach(([mk, lbl]) => {
    const on = (mk === "explore" && l3.mode === "explore") || (mk === "practical" && (l3.mode === "practical" || l3.mode === "practicalEnd"));
    const b = document.createElement("button"); b.textContent = lbl;
    b.style.cssText = `flex:1;border:1.5px solid ${on ? "var(--teal)" : "#cfd8e3"};background:${on ? "var(--teal)" : "#fff"};color:${on ? "#fff" : "#41506a"};border-radius:10px;padding:9px;font-size:.85rem;font-weight:700;cursor:pointer;`;
    b.onclick = () => { if (mk === "explore") { l3.mode = "explore"; _l3ShowAll(); _l3ClearHighlight(); render(); } else { startL3Practical(); } };
    modes.appendChild(b);
  });
  wrap.appendChild(modes);

  if (l3.mode === "practical" || l3.mode === "practicalEnd") { _l3RenderPractical(wrap); }
  else { _l3RenderExplore(wrap); }

  // attribution + license (from models.json source) + Credits link
  const src = (md && md.source) || {};
  const att = document.createElement("div"); att.style.cssText = "font-size:.72rem;color:#9aa2b1;margin-top:14px;border-top:1px solid #eee;padding-top:8px;line-height:1.45;";
  const lic = src.license ? `<a href="${escapeHtml(src.licenseUrl || "#")}" target="_blank" rel="noopener" style="color:#9aa2b1;">${escapeHtml(src.license)}</a>` : "";
  att.innerHTML = (src.title
    ? `Model: <b>${escapeHtml(src.title)}</b>${src.creator ? " — " + escapeHtml(src.creator) : ""}${lic ? " · " + lic : ""}`
    : "Model attribution from models.json.")
    + ` · <a href="${LAB3D_BASE}ATTRIBUTION.md" target="_blank" rel="noopener" style="color:#9aa2b1;text-decoration:underline;">Credits</a>`
    + `<div style="margin-top:3px;color:#b3b9c4;">Assets stored locally (no hotlinking). Real classroom photos remain the authority for the practical.</div>`;
  wrap.appendChild(att);
}
function _l3RenderExplore(wrap) {
  const md = _l3Model(); if (!md) return;

  const hint = document.createElement("div"); hint.style.cssText = "font-size:.8rem;color:var(--muted);margin-bottom:8px;";
  hint.innerHTML = "Rotate / pinch-zoom. <b>Tap a structure on the model</b> to identify it, or pick from the list. " + (md.purpose ? escapeHtml(md.purpose) : "");
  wrap.appendChild(hint);

  // known-gaps note (esp. torso: omitted stomach/esophagus/diaphragm/ribs/sternum)
  if (md.knownGaps && md.knownGaps.length) {
    const g = document.createElement("div"); g.style.cssText = "font-size:.74rem;color:#8a6d3b;background:#fbf4e6;border:1px solid #f0e2c4;border-radius:8px;padding:8px 10px;margin-bottom:10px;line-height:1.4;";
    g.innerHTML = "⚠️ " + escapeHtml(md.knownGaps[0]);
    wrap.appendChild(g);
  }

  // selected info + hide/isolate/show-all controls
  if (_l3Selected && l3.structById[_l3Selected]) {
    const s = l3.structById[_l3Selected];
    const info = document.createElement("div"); info.style.cssText = "background:#e7f1ea;border:1px solid #bcd8cc;border-radius:12px;padding:12px 14px;margin-bottom:12px;";
    info.innerHTML = `<div style="font-weight:800;color:var(--accent-ink);font-size:1.04rem;">${escapeHtml(s.name)}</div>
      <div style="font-size:.74rem;margin:3px 0 2px;">
        ${s.official ? `<span style="color:#1a7a3f;font-weight:700;">✔ official HRA label</span>` : `<span style="color:#B7791F;font-weight:700;">≈ label from mesh name</span>`}
        ${s.ontologyId ? ` · <span style="color:#7c8a83;">${escapeHtml(s.ontologyId)}</span>` : ""}
      </div>`;
    const ctl = document.createElement("div"); ctl.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;";
    const mk = (label, fn) => { const b = document.createElement("button"); b.textContent = label; b.style.cssText = "border:1px solid #bcd8cc;background:#fff;color:#2c6b52;border-radius:8px;padding:4px 10px;font-size:.76rem;font-weight:700;cursor:pointer;"; b.onclick = fn; return b; };
    ctl.appendChild(mk("Isolate", () => { _l3Isolate(s.mesh); _l3HighlightMesh(s.mesh); }));
    ctl.appendChild(mk("Hide", () => { _l3SetVisible(s.mesh, false); }));
    ctl.appendChild(mk("Show all", () => { _l3ShowAll(); _l3HighlightMesh(s.mesh); }));
    info.appendChild(ctl);
    wrap.appendChild(info);
  }

  // search filter (lists can be 280+ structures)
  const searchWrap = document.createElement("div"); searchWrap.style.cssText = "margin-bottom:8px;";
  const search = document.createElement("input"); search.type = "search"; search.placeholder = "Filter structures… (" + l3.structs.length + ")";
  search.value = l3.filter || "";
  search.style.cssText = "width:100%;box-sizing:border-box;border:1px solid #cfd8e3;border-radius:9px;padding:9px 11px;font-size:.9rem;";
  search.oninput = (e) => { l3.filter = e.target.value; _l3RefreshList(); };
  searchWrap.appendChild(search); wrap.appendChild(searchWrap);

  const listHost = document.createElement("div"); listHost.id = "l3list"; listHost.style.cssText = "display:flex;flex-direction:column;gap:6px;max-height:340px;overflow:auto;";
  wrap.appendChild(listHost);
  _l3RefreshList();
}
function _l3RefreshList() {
  const host = document.getElementById("l3list"); if (!host) return;
  host.innerHTML = "";
  const f = (l3.filter || "").trim().toLowerCase();
  let rows = l3.structs;
  if (f) rows = rows.filter(s => s.name.toLowerCase().includes(f) || s.id.toLowerCase().includes(f));
  const CAP = 80;
  const shown = rows.slice(0, CAP);
  shown.forEach(s => {
    const b = document.createElement("button"); const on = _l3Selected === s.id;
    b.style.cssText = `text-align:left;border:1px solid ${on ? "var(--teal)" : "#e4e8ee"};background:${on ? "#f0f8f5" : "#fff"};border-radius:10px;padding:9px 12px;cursor:pointer;font-size:.88rem;font-weight:600;color:var(--text);`;
    b.innerHTML = `${escapeHtml(s.name)} ${s.official ? "" : `<span style="font-size:.68rem;color:#b58b48;font-weight:600;">≈</span>`}`;
    b.onclick = () => _l3Select(s.id, false);
    host.appendChild(b);
  });
  if (rows.length > CAP) {
    const more = document.createElement("div"); more.style.cssText = "font-size:.74rem;color:#9aa2b1;padding:6px 2px;";
    more.textContent = `Showing ${CAP} of ${rows.length} — type to narrow.`;
    host.appendChild(more);
  }
  if (!rows.length) {
    const none = document.createElement("div"); none.style.cssText = "font-size:.8rem;color:#9aa2b1;padding:8px 2px;"; none.textContent = "No structures match.";
    host.appendChild(none);
  }
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
    const done = document.createElement("button"); done.className = "secondaryBtn"; done.style.maxWidth = "300px"; done.textContent = "Back to Explore"; done.onclick = () => { l3.mode = "explore"; _l3ShowAll(); _l3ClearHighlight(); render(); };
    end.append(again, done); wrap.appendChild(end); return;
  }
  if (!p) return;
  const s = p.deck[p.i];
  const bar = document.createElement("div"); bar.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-size:.85rem;color:var(--muted);";
  bar.innerHTML = `<span>🧊 ${p.i + 1} / ${p.total}</span><span id="l3prtimer" style="font-weight:800;font-variant-numeric:tabular-nums;">${p.secLeft}s</span>`;
  wrap.appendChild(bar);
  const q = document.createElement("div"); q.style.cssText = "font-size:1.02rem;font-weight:700;text-align:center;margin:6px 0 4px;color:var(--text);";
  q.textContent = "What is the highlighted structure?";
  wrap.appendChild(q);
  const tapHint = document.createElement("div"); tapHint.style.cssText = "text-align:center;font-size:.74rem;color:var(--muted);margin-bottom:10px;";
  tapHint.textContent = "Tap it on the model, or choose below.";
  wrap.appendChild(tapHint);
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
      ${s.ontologyId ? `<div style="font-size:.74rem;color:#7c8a83;margin-top:2px;">${escapeHtml(s.ontologyId)}</div>` : ""}`;
    wrap.appendChild(fb);
    const nxt = document.createElement("button"); nxt.className = "primaryBtn"; nxt.style.cssText += "width:100%;max-width:none;";
    nxt.textContent = "Next →"; nxt.onclick = () => _l3PracticalNext(false);
    wrap.appendChild(nxt);
  }
}
if (typeof module !== "undefined" && module.exports) module.exports = { open3DExplorer };
