import * as THREE from 'three';
import { N, K, build, STATE_PARAMS, TAGS, CAPTIONS, NAMES, rng } from './data.js';
import { loadContent, loadLinks } from './content.js';
import { createHand, CONNECTIONS } from './hand.js';

const $ = id => document.getElementById(id);
const D = build();
const lab = $('labels'), ctx = lab.getContext('2d');
const statusEl = $('status'), capEl = $('cap'), tagEl = $('tag'), hintEl = $('hint'), camOff = $('camoff');
const renderer = new THREE.WebGLRenderer({ canvas: $('gl'), antialias: true });
renderer.setClearColor(0x000000, 1);
const scene = new THREE.Scene(), group = new THREE.Group(); scene.add(group);
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
const FOV_T = Math.tan(THREE.MathUtils.degToRad(22.5));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const sm = (dt, r) => 1 - Math.exp(-dt * r);

// ---------- node state ----------
const pos = new Float32Array(N * 3), vel = new Float32Array(N * 3);
const bright = new Float32Array(N), hiA = new Float32Array(N), visA = new Float32Array(N), visT = new Float32Array(N).fill(0.5);
const r0 = rng(7), phase = new Float32Array(N), kk = new Float32Array(N), delay = new Float32Array(N), tIdx = new Uint8Array(N);
const LC = new Float32Array(N * 3);   // compact sphere layout (fist)
for (let n = 0; n < N; n++) {
  phase[n] = r0() * 6.28; kk[n] = 2.0 + r0() * 1.8; delay[n] = D.cluster[n] * 0.1 + r0() * 0.4;
  for (let a = 0; a < 3; a++) { pos[n * 3 + a] = D.layouts[1][n * 3 + a] * 1.6; LC[n * 3 + a] = D.layouts[1][n * 3 + a] * 0.4; }
}
const items = new Array(N).fill(null), imgState = new Array(N).fill('pending'), deg = new Uint16Array(N);

// ---------- texture atlas: ONLY real Wikipedia thumbnails (loading tiles are plain dark frames) ----------
const GX = 14, GY = Math.ceil(N / GX), TW = 128, TH = 96;
const atlasC = document.createElement('canvas'); atlasC.width = GX * TW; atlasC.height = GY * TH;
const actx = atlasC.getContext('2d'); actx.fillStyle = '#000'; actx.fillRect(0, 0, atlasC.width, atlasC.height);
function tileXY(n) { return [(n % GX) * TW, Math.floor(n / GX) * TH]; }
function drawLoading(n) { const [x, y] = tileXY(n); actx.fillStyle = '#05090b'; actx.fillRect(x, y, TW, TH); actx.strokeStyle = 'rgba(0,229,255,.35)'; actx.lineWidth = 2; actx.strokeRect(x + 1, y + 1, TW - 2, TH - 2); }
for (let n = 0; n < N; n++) drawLoading(n);
const atlas = new THREE.CanvasTexture(atlasC); atlas.flipY = false; atlas.generateMipmaps = false; atlas.minFilter = atlas.magFilter = THREE.LinearFilter;
let atlasDirty = true, atlasT = 0;
function paintTile(n, im) {
  const [x, y] = tileXY(n), s = Math.max(TW / im.width, TH / im.height), dw = im.width * s, dh = im.height * s;
  actx.save(); actx.beginPath(); actx.rect(x, y, TW, TH); actx.clip(); actx.drawImage(im, x + (TW - dw) / 2, y + (TH - dh) / 2, dw, dh); actx.restore();
  atlasDirty = true;
}

// ---------- image loader: concurrency limit, timeout, retry with backoff ----------
const imgQ = []; let imgActive = 0;
function loadImage(n, att = 0) { imgQ.push([n, att]); pump(); }
function pump() {
  while (imgActive < 6 && imgQ.length) {
    const [n, att] = imgQ.shift(); if (!items[n]) continue; imgActive++;
    const im = new Image(); im.crossOrigin = 'anonymous'; im.decoding = 'async'; let fin = false;
    const done = ok => {
      if (fin) return; fin = true; clearTimeout(to); imgActive--;
      if (ok) { imgState[n] = 'ok'; paintTile(n, im); visT[n] = 1; if (hudShown === n) refreshHud(); }
      else if (att < 3) setTimeout(() => loadImage(n, att + 1), 1000 * 2 ** att);
      else { imgState[n] = 'fail'; visT[n] = 0; items[n] = null; if (hudShown === n) refreshHud(); }
      pump();
    };
    const to = setTimeout(() => done(false), 15000);
    im.onload = () => done(true); im.onerror = () => done(false); im.src = items[n].image;
  }
}
const short = t => (t.length > 30 ? t.slice(0, 28) + '…' : t);
function onItem(n, it) {
  items[n] = it; imgState[n] = 'pending'; visT[n] = 0.5;
  if (n < K || D.imp[n] > 0.45) D.labels[n] = short(it.title);
  loadImage(n);
}
function onMiss(n) { visT[n] = 0; imgState[n] = 'fail'; }

// ---------- 3D cards: instanced billboard quads textured from the atlas ----------
const base = new THREE.PlaneGeometry(1, 1);
const ig = new THREE.InstancedBufferGeometry(); ig.index = base.index; ig.setAttribute('position', base.attributes.position); ig.instanceCount = N;
const tileA = new Float32Array(N); for (let n = 0; n < N; n++) tileA[n] = n;
ig.setAttribute('iPos', new THREE.InstancedBufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
ig.setAttribute('iSize', new THREE.InstancedBufferAttribute(D.size, 1));
ig.setAttribute('iTile', new THREE.InstancedBufferAttribute(tileA, 1));
for (const [k, a] of [['iBright', bright], ['iHi', hiA], ['iVis', visA]]) ig.setAttribute(k, new THREE.InstancedBufferAttribute(a, 1).setUsage(THREE.DynamicDrawUsage));
const cardMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: true, depthTest: true,
  uniforms: { uAtlas: { value: atlas }, uGrid: { value: new THREE.Vector2(GX, GY) }, uC: { value: 22 } },
  vertexShader: `attribute vec3 iPos;attribute float iSize,iBright,iHi,iVis,iTile;uniform float uC;
  varying vec2 vExt;varying float vB,vHi,vT;
  void main(){vExt=vec2(position.x+.5,.5-position.y);vHi=iHi;vT=iTile;
  vec4 mv=modelViewMatrix*vec4(iPos,1.);float d=-mv.z;vB=iBright*clamp(1.-(d-uC-6.)/26.,.22,1.);
  if(iVis<.02){gl_Position=vec4(2.,2.,2.,1.);return;}
  float s=iSize*(.55+.45*min(iVis,1.))*1.6;
  mv.xy+=vec2(position.x*1.3333,position.y)*s;gl_Position=projectionMatrix*mv;}`,
  fragmentShader: `uniform sampler2D uAtlas;uniform vec2 uGrid;varying vec2 vExt;varying float vB,vHi,vT;
  void main(){vec2 q=(vExt-.5)*1.6+.5;vec2 o=max(abs(q-.5)-.5,0.);float od=length(o);
  if(od>0.){float g=exp(-od*14.)*.8*vHi*vB;if(g<.015)discard;gl_FragColor=vec4(.2,.9,1.,g);return;}
  float e=min(min(q.x,q.y),min(1.-q.x,1.-q.y));vec2 cell=vec2(mod(vT,uGrid.x),floor(vT/uGrid.x));
  vec2 uv=(cell+q*.97+.015)/uGrid;vec3 col=texture2D(uAtlas,uv).rgb*vB;
  float bd=smoothstep(.04,.0,e);col=mix(col,vec3(.25,.92,1.)*(.35+.65*vHi)*vB,bd*(.25+.75*vHi));
  gl_FragColor=vec4(col,1.);}`
});
const cards = new THREE.Mesh(ig, cardMat); cards.frustumCulled = false; cards.renderOrder = 1; group.add(cards);

// ---------- edges: white = layout-only, cyan = real Wikipedia article link ----------
const E = D.edges, SEG = 10, VPE = SEG * 2; let EN = E.length; const MAXE = EN + 700;
const lp = new Float32Array(MAXE * VPE * 3), la = new Float32Array(MAXE * VPE), lc = new Float32Array(MAXE * VPE * 3);
const lg = new THREE.BufferGeometry();
lg.setAttribute('position', new THREE.BufferAttribute(lp, 3).setUsage(THREE.DynamicDrawUsage));
lg.setAttribute('aAlpha', new THREE.BufferAttribute(la, 1).setUsage(THREE.DynamicDrawUsage));
lg.setAttribute('aCol', new THREE.BufferAttribute(lc, 3).setUsage(THREE.DynamicDrawUsage));
function setEdgeColor(e, r, g, b) { for (let v = 0; v < VPE; v++) { const i = (e * VPE + v) * 3; lc[i] = r; lc[i + 1] = g; lc[i + 2] = b; } }
for (let e = 0; e < EN; e++) setEdgeColor(e, .9, .9, .9);
lg.setDrawRange(0, EN * VPE);
const lineMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, depthTest: true, uniforms: { uC: cardMat.uniforms.uC },
  vertexShader: `attribute float aAlpha;attribute vec3 aCol;uniform float uC;varying float vA;varying vec3 vC;
  void main(){vec4 mv=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mv;float d=-mv.z;vA=aAlpha*clamp(1.-(d-uC-6.)/26.,.15,1.);vC=aCol;}`,
  fragmentShader: `varying float vA;varying vec3 vC;void main(){gl_FragColor=vec4(vC,vA);}`
});
const lines = new THREE.LineSegments(lg, lineMat); lines.frustumCulled = false; lines.renderOrder = 2; group.add(lines);
const realSet = new Set();
function addReal(a, b) {
  if (EN >= MAXE) return; const key = a < b ? a * N + b : b * N + a; if (realSet.has(key)) return; realSet.add(key);
  E.push([a, b, 3, 1, (Math.random() < .5 ? -1 : 1) * (.25 + Math.random() * .35)]); setEdgeColor(EN, .2, .9, 1); EN++;
  lg.setDrawRange(0, EN * VPE); deg[a]++; deg[b]++;
}

// ---------- state ----------
const S = { idx: 0 }, params = STATE_PARAMS[0].slice(); let switchTime = -100, lastAdv = 0;
const clHi = new Float32Array(K), nodeHi = new Float32Array(N);
const pan = new THREE.Vector2(), fp = new THREE.Vector3(), rotFp = new THREE.Vector3(); let panVx = 0, panVy = 0;
let hovered = -1, selected = -1, hudNode = -1, hudShown = -1, hudT = 0, hudHover = false, focusN = -1, focus = 0;
let linkDwell = 0, linkCool = 0, compact = 0, zoomOut = 0, wheelT = 0, wheelZ = 0, camZ = 22, hAmt = 0, kbCompact = false, kbOut = false, wasPinch = false;
const pinchPrev = { x: 0, y: 0 }, cam = { yaw: 0, pitch: 0 };
const mouse = { x: 0, y: 0, down: false, drag: false, sx: 0, sy: 0, t: -1e9 };
const sx = new Float32Array(N), sy = new Float32Array(N), sd = new Float32Array(N);
const tmp = new THREE.Vector3(), mvM = new THREE.Matrix4();
function setState(i, now) {
  if (i === S.idx) return; S.idx = i; switchTime = now; lastAdv = now; tagEl.style.opacity = 0; capEl.style.opacity = 0;
  setTimeout(() => { tagEl.textContent = TAGS[i]; capEl.textContent = CAPTIONS[i]; tagEl.style.opacity = 1; capEl.style.opacity = 1; }, 750);
}
tagEl.textContent = TAGS[0]; capEl.textContent = CAPTIONS[0];

// ---------- article HUD (real image, title, summary, link) ----------
const hud = $('hud'), himg = $('himg');
hud.addEventListener('mouseenter', () => (hudHover = true)); hud.addEventListener('mouseleave', () => (hudHover = false));
function refreshHud() {
  const n = hudShown; if (n < 0) return; const it = items[n];
  if (!it) { himg.style.display = 'none'; $('hstate').textContent = 'image unavailable'; return; }
  if (imgState[n] === 'ok') { if (himg.dataset.n !== String(n)) { himg.src = it.image; himg.dataset.n = n; } himg.alt = it.title; himg.style.display = 'block'; $('hstate').textContent = ''; }
  else { himg.style.display = 'none'; himg.removeAttribute('src'); delete himg.dataset.n; $('hstate').textContent = 'loading image…'; }
}
function showHud(n) {
  if (n < 0 || !items[n]) { hud.classList.remove('on'); return; }
  const it = items[n]; hud.classList.add('on');
  $('htitle').textContent = it.title; $('hsum').textContent = it.text.length > 420 ? it.text.slice(0, 418) + '…' : it.text;
  $('hmeta').textContent = `${NAMES[D.cluster[n]]} · ${deg[n]} linked article${deg[n] === 1 ? '' : 's'} in graph`;
  const a = $('hlink'); a.href = it.url; refreshHud();
}

// ---------- hand + mouse input ----------
const video = $('cam'), camcv = $('camcv'), cctx = camcv.getContext('2d');
let handMsg = '';
const hand = createHand(video, s => { handMsg = s; statusEl.textContent = s; if (!hand.S.ready) camOff.textContent = s; }); hand.init();
addEventListener('mousemove', e => {
  if (mouse.down) { const dx = e.clientX - mouse.x, dy = e.clientY - mouse.y;
    if (!mouse.drag && Math.hypot(e.clientX - mouse.sx, e.clientY - mouse.sy) > 5) { mouse.drag = true; selected = -1; }
    if (mouse.drag) { const ppu = H / (2 * FOV_T * camZ); pan.x += dx / ppu; pan.y -= dy / ppu; } }
  mouse.x = e.clientX; mouse.y = e.clientY; mouse.t = performance.now();
});
addEventListener('mousedown', e => { if (hudHover) return; mouse.down = true; mouse.drag = false; mouse.sx = e.clientX; mouse.sy = e.clientY; mouse.t = performance.now(); });
addEventListener('mouseup', () => {
  if (mouse.down && !mouse.drag) selected = hovered >= 0 ? (selected === hovered ? -1 : hovered) : -1;
  mouse.down = false; mouse.drag = false;
});
addEventListener('wheel', e => { wheelT = clamp(wheelT + e.deltaY * 0.012, -8, 14); }, { passive: true });
addEventListener('keydown', e => {
  const t = performance.now() / 1000;
  if (e.key === 'ArrowRight' || e.key === ' ') setState((S.idx + 1) % 5, t);
  else if (e.key === 'ArrowLeft') setState((S.idx + 4) % 5, t);
  else if (e.key === 'c') kbCompact = !kbCompact; else if (e.key === 'z') kbOut = !kbOut; else if (e.key === 'Escape') selected = -1;
});

let W = 1, H = 1, PR = 1;
function resize() {
  W = innerWidth; H = innerHeight; PR = Math.min(devicePixelRatio || 1, 2);
  renderer.setPixelRatio(PR); renderer.setSize(W, H, false); camera.aspect = W / H; camera.updateProjectionMatrix();
  lab.width = W * PR; lab.height = H * PR;
}
addEventListener('resize', resize); resize();

const GNAME = { point: 'INDEX UP · focus', fist: 'FIST · compact', open: 'OPEN PALM · zoom out', pinch: 'PINCH · drag', none: 'HAND · —' };
let prev = performance.now(), T = 0, hudTick = 0;

function frame(nowMs) {
  requestAnimationFrame(frame);
  const dt = Math.min((nowMs - prev) / 1000, 0.033); prev = nowMs; T += dt; const now = nowMs / 1000;
  hand.update(nowMs); const h = hand.S, g = h.present ? h.gesture : 'none';

  // gesture -> targets
  compact += (((g === 'fist' || kbCompact) ? 1 : 0) - compact) * sm(dt, 2.2);
  zoomOut += (((g === 'open' || kbOut) ? 1 : 0) - zoomOut) * sm(dt, 2.0);
  wheelZ += (wheelT - wheelZ) * sm(dt, 6);
  camZ = 22 + 11 * zoomOut + 3 * compact - 13 * focus + wheelZ;

  // pointer: index fingertip, or mouse when no hand pointing
  const handPoint = h.present && g === 'point', pinching = h.present && g === 'pinch';
  const mouseOn = !h.present && nowMs - mouse.t < 3000 && !hudHover && !mouse.drag;
  let pointing = false, cx = 0, cy = 0;
  if (handPoint) { pointing = true; cx = h.px * W; cy = h.py * H; } else if (mouseOn) { pointing = true; cx = mouse.x; cy = mouse.y; }

  // pinch held = grab and drag/pan the graph (relative hand motion)
  if (pinching) {
    if (!wasPinch) { pinchPrev.x = h.pinchX; pinchPrev.y = h.pinchY; selected = -1; panVx = panVy = 0; }
    const vH = 2 * FOV_T * camZ, vW = vH * camera.aspect;
    const dx = (h.pinchX - pinchPrev.x) * vW * 1.6, dy = (h.pinchY - pinchPrev.y) * vH * 1.6;
    pinchPrev.x = h.pinchX; pinchPrev.y = h.pinchY; pan.x += dx; pan.y -= dy;
    if (dt > 0) { panVx += (dx / dt - panVx) * .3; panVy += (-dy / dt - panVy) * .3; }
  } else if (wasPinch || Math.abs(panVx) + Math.abs(panVy) > 0.01) { pan.x += panVx * dt; pan.y += panVy * dt; const k = Math.exp(-dt * 3); panVx *= k; panVy *= k; }
  wasPinch = pinching;
  if (zoomOut > 0.5) pan.multiplyScalar(1 - Math.min(1, dt * 2.5));
  pan.x = clamp(pan.x, -16, 16); pan.y = clamp(pan.y, -10, 10);

  // camera rig
  const yT = (Math.sin(T * 0.07) * 0.35 + T * 0.01) * (1 - 0.85 * focus), pT = Math.sin(T * 0.05) * 0.12 * (1 - 0.85 * focus);
  cam.yaw += (yT - cam.yaw) * sm(dt, 1.5); cam.pitch += (pT - cam.pitch) * sm(dt, 1.5);
  group.rotation.set(cam.pitch, cam.yaw, 0);
  if (focusN >= 0) { const k = sm(dt, 5); fp.x += (pos[focusN * 3] - fp.x) * k; fp.y += (pos[focusN * 3 + 1] - fp.y) * k; fp.z += (pos[focusN * 3 + 2] - fp.z) * k; }
  rotFp.copy(fp).applyQuaternion(group.quaternion);
  const bx = lerp(-3.2, -1.2, zoomOut) + pan.x, by = lerp(-1.4, -0.2, zoomOut) + pan.y;
  group.position.set(bx * (1 - focus) - rotFp.x * focus, by * (1 - focus) - rotFp.y * focus, -rotFp.z * focus);
  camera.position.set(Math.sin(T * 0.11) * 0.4 * (1 - focus), Math.cos(T * 0.09) * 0.3 * (1 - focus), camZ); camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(); group.updateMatrixWorld();
  cardMat.uniforms.uC.value = camera.position.distanceTo(group.position);

  // auto topology cycle (paused while interacting)
  if (!pointing && selected < 0 && focus < 0.05 && compact < 0.1 && zoomOut < 0.1 && now - lastAdv > 16) setState((S.idx + 1) % 5, now);
  const tp = STATE_PARAMS[S.idx]; for (let i = 0; i < 4; i++) params[i] += (tp[i] - params[i]) * sm(dt, 0.9);

  // springs (layout <-> compact sphere)
  const scale = 1 + 0.18 + 0.025 * Math.sin(T * 0.35);
  for (let n = 0; n < N; n++) {
    if (now - switchTime >= delay[n]) tIdx[n] = S.idx;
    const L = D.layouts[tIdx[n]], hub = n < K ? 1.8 : 1, k = kk[n], damp = 1.85 * Math.sqrt(k);
    for (let a = 0; a < 3; a++) {
      const i = n * 3 + a, t = lerp(L[i] * scale, LC[i], compact) + Math.sin(T * 0.21 + phase[n] * (a + 1)) * 0.2 * hub * (1 - 0.7 * compact);
      vel[i] += ((t - pos[i]) * k - vel[i] * damp) * dt; pos[i] += vel[i] * dt;
    }
    visA[n] += (visT[n] - visA[n]) * sm(dt, 4);
  }

  // project nodes to screen
  mvM.multiplyMatrices(camera.matrixWorldInverse, group.matrixWorld);
  for (let n = 0; n < N; n++) {
    tmp.set(pos[n * 3], pos[n * 3 + 1], pos[n * 3 + 2]).applyMatrix4(mvM); sd[n] = -tmp.z;
    tmp.applyMatrix4(camera.projectionMatrix); sx[n] = (tmp.x * 0.5 + 0.5) * W; sy[n] = (-tmp.y * 0.5 + 0.5) * H;
  }
  const uS = H / (2 * FOV_T), halfPx = n => D.size[n] * 0.5 * uS / Math.max(sd[n], 0.5);
  const pickable = n => imgState[n] === 'ok' && items[n] && visA[n] > 0.7 && sd[n] > 1;
  const dist = n => Math.max(0, Math.hypot(sx[n] - cx, sy[n] - cy) - halfPx(n)) * (n < K ? 0.7 : 1);

  // fingertip over the HUD: keeps it open; holding on the link ~1s opens the Wikipedia article (no click needed)
  const hr = hud.getBoundingClientRect(), lr = $('hlink').getBoundingClientRect();
  const overHud = handPoint && hud.classList.contains('on') && cx > hr.left - 10 && cx < hr.right + 10 && cy > hr.top - 10 && cy < hr.bottom + 10;
  const onLink = overHud && cx > lr.left - 20 && cx < lr.right + 20 && cy > lr.top - 14 && cy < lr.bottom + 14;
  if (onLink && now > linkCool) { linkDwell += dt; if (linkDwell > 1.0 && items[hudShown]) { window.open(items[hudShown].url, '_blank', 'noopener'); linkCool = now + 4; linkDwell = 0; } } else linkDwell = Math.max(0, linkDwell - dt * 2);
  // hover with hysteresis
  if (pointing && !overHud) {
    let best = -1, bd = 1e9;
    for (let n = 0; n < N; n++) { if (!pickable(n)) continue; const d = dist(n); if (d < bd) { bd = d; best = n; } }
    if (hovered >= 0 && pickable(hovered)) { const dh = dist(hovered); if (dh < bd * 1.35 + 14 && dh < 140) best = hovered; else if (bd > 100) best = -1; }
    else if (bd > 80) best = -1;
    hovered = best;
  } else hovered = -1;
  if (selected >= 0 && !pickable(selected)) selected = -1;

  // HUD node: selection > hover, with a short linger so the link can be reached
  const want = selected >= 0 ? selected : hovered;
  if (want >= 0) { hudNode = want; hudT = now; } else if (hudNode >= 0 && !hudHover && !overHud && now - hudT > (h.present ? 6 : 2.5)) hudNode = -1;
  if (hudNode >= 0 && !items[hudNode]) hudNode = -1;
  if (hudNode !== hudShown) { hudShown = hudNode; showHud(hudNode); }
  if (hudShown >= 0) $('hmeta').textContent = `${NAMES[D.cluster[hudShown]]} · ${deg[hudShown]} linked article${deg[hudShown] === 1 ? '' : 's'} in graph`;

  // smooth zoom/focus toward the indicated (fingertip) or selected node
  const ft = selected >= 0 ? selected : (handPoint && hovered >= 0 ? hovered : -1);
  if (ft >= 0) { if (focusN !== ft) { if (focusN < 0) fp.set(pos[ft * 3], pos[ft * 3 + 1], pos[ft * 3 + 2]); focusN = ft; } }
  const fT = ft >= 0 && zoomOut < 0.3 && compact < 0.3 && !pinching ? 1 : 0;
  focus += (fT - focus) * sm(dt, 2.2); if (focus < 0.01 && ft < 0) focusN = -1;
  hAmt += ((hudNode >= 0 ? 1 : 0) - hAmt) * sm(dt, 2);

  const hc = hudNode >= 0 ? D.cluster[hudNode] : -1;
  for (let k = 0; k < K; k++) clHi[k] += ((k === hc ? 1 : 0) - clHi[k]) * sm(dt, 4);
  for (let n = 0; n < N; n++) {
    nodeHi[n] += ((n === hudNode ? 1 : 0) - nodeHi[n]) * sm(dt, 6);
    const c = D.cluster[n]; let b = 0.85 + 0.15 * D.imp[n] + 0.25 * clHi[c];
    if (c !== hc) b *= 1 - 0.4 * hAmt;
    bright[n] = Math.min(1, b); hiA[n] = nodeHi[n] + clHi[c] * 0.08;
  }
  for (const a of ['iPos', 'iBright', 'iHi', 'iVis']) ig.attributes[a].needsUpdate = true;

  // edges
  const curv = params[3];
  for (let e = 0; e < EN; e++) {
    const [a, b, cls, w, cs] = E[e], real = cls === 3, vv = Math.min(visA[a], visA[b]);
    const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2], bx2 = pos[b * 3], by2 = pos[b * 3 + 1], bz = pos[b * 3 + 2];
    const dx = bx2 - ax, dy = by2 - ay, len = Math.hypot(dx, dy, bz - az) + 1e-6;
    let px = -dy, py = dx; const pl = Math.hypot(px, py) + 1e-6; px /= pl; py /= pl;
    const o = len * curv * cs, mx = (ax + bx2) / 2 + px * o, my = (ay + by2) / 2 + py * o, mz = (az + bz) / 2;
    const ca = D.cluster[a], cb = D.cluster[b], hl = hudNode >= 0 && (a === hudNode || b === hudNode);
    let al = real ? 0.5 * vv : 0.85 * w * params[cls] * vv;
    al *= 1 + 1.2 * Math.max(clHi[ca], clHi[cb]);
    if (hl) al = real ? 0.95 : Math.max(al, 0.5); else if (hudNode >= 0 && !real) al *= 1 - 0.5 * hAmt;
    al = Math.min(al, 0.95);
    let qx = ax, qy = ay, qz = az;
    for (let s = 0; s < SEG; s++) {
      const t = (s + 1) / SEG, u = 1 - t, i = e * VPE + s * 2;
      const nx = u * u * ax + 2 * u * t * mx + t * t * bx2, ny = u * u * ay + 2 * u * t * my + t * t * by2, nz = u * u * az + 2 * u * t * mz + t * t * bz;
      lp[i * 3] = qx; lp[i * 3 + 1] = qy; lp[i * 3 + 2] = qz; lp[i * 3 + 3] = nx; lp[i * 3 + 4] = ny; lp[i * 3 + 5] = nz;
      la[i] = la[i + 1] = al; qx = nx; qy = ny; qz = nz;
    }
  }
  lg.attributes.position.needsUpdate = lg.attributes.aAlpha.needsUpdate = lg.attributes.aCol.needsUpdate = true;
  if (atlasDirty && nowMs - atlasT > 300) { atlas.needsUpdate = true; atlasDirty = false; atlasT = nowMs; }
  renderer.render(scene, camera);

  // labels (real article titles only)
  ctx.setTransform(PR, 0, 0, PR, 0, 0); ctx.clearRect(0, 0, W, H); ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (let n = 0; n < N; n++) {
    const text = n === hudNode && items[n] ? items[n].title : (items[n] && imgState[n] === 'ok' ? D.labels[n] : null); if (!text || sd[n] < 1) continue;
    const hub = n < K, c = D.cluster[n];
    let a = (hub ? 0.9 : 0.35 + 0.4 * D.imp[n]) * clamp(1 - (sd[n] - camZ + 6) / 26, 0.2, 1) + clHi[c] * 0.3 + nodeHi[n] * 0.5; if (c !== hc) a *= 1 - 0.4 * hAmt;
    if (a < 0.04) continue;
    const fs = clamp((hub ? 9 : 8) * (24 / sd[n]), 6.5, 11), off = halfPx(n) + 4;
    ctx.font = `${hub ? 600 : 400} ${fs.toFixed(1)}px ui-monospace,Menlo,Consolas,monospace`;
    const tw = ctx.measureText(text).width; ctx.fillStyle = `rgba(0,0,0,${Math.min(0.8, a)})`; ctx.fillRect(sx[n] - tw / 2 - 2, sy[n] + off - 1, tw + 4, fs + 2);
    ctx.fillStyle = n === hudNode ? `rgba(90,235,255,${Math.min(1, a)})` : `rgba(236,236,230,${Math.min(1, a)})`; ctx.fillText(text, sx[n], sy[n] + off);
  }
  if (linkDwell > 0) { ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(cx, cy, 18, -1.57, -1.57 + 6.283 * Math.min(1, linkDwell)); ctx.stroke(); }
  if (pointing) { ctx.strokeStyle = 'rgba(90,235,255,0.85)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(cx, cy, 12, 0, 6.283); ctx.stroke(); }

  // webcam overlay: skeleton lines + landmark dots, mirrored to match the preview
  cctx.clearRect(0, 0, 320, 240);
  if (h.present && h.lm) {
    const L = h.lm, X = p => (1 - p.x) * 320, Y = p => p.y * 240;
    cctx.strokeStyle = 'rgba(255,255,255,.75)'; cctx.lineWidth = 1.2; cctx.beginPath();
    for (const [a, b] of CONNECTIONS) { cctx.moveTo(X(L[a]), Y(L[a])); cctx.lineTo(X(L[b]), Y(L[b])); } cctx.stroke();
    cctx.fillStyle = 'rgba(40,225,255,.95)'; cctx.shadowColor = 'rgba(40,225,255,.9)'; cctx.shadowBlur = 5;
    for (let i = 0; i < 21; i++) { cctx.beginPath(); cctx.arc(X(L[i]), Y(L[i]), i === 8 ? 4.2 : 2.8, 0, 6.283); cctx.fill(); } cctx.shadowBlur = 0;
  }
  if (hand.S.ready) camOff.classList.add('hide');
  if (nowMs - hudTick > 100) { hudTick = nowMs;
    $('gname').textContent = h.present ? GNAME[g] || 'HAND' : (hand.S.ready ? 'NO HAND' : 'NO CAMERA · mouse');
    $('gxy').textContent = h.present ? `x ${h.tip.x.toFixed(3)} y ${h.tip.y.toFixed(3)}` : ''; }
}
requestAnimationFrame(frame);

// ---------- content ----------
let dataMsg = 'loading Wikipedia articles…';
const HINT = 'index up: focus card · fist: compact sphere · open palm: zoom out · pinch + move: drag graph\nfingertip on the HUD link ~1s: open article\nmouse (only when no hand): hover / click card · drag to pan · wheel to zoom · space: next view · c: compact · z: zoom out\ncyan edges = real Wikipedia links · white edges = layout only';
const upd = () => (hintEl.textContent = HINT + '\n' + dataMsg); upd();
(async () => {
  await loadContent(D, onItem, onMiss, m => { dataMsg = m; upd(); });
  const entries = []; for (let n = 0; n < N; n++) if (items[n]) entries.push({ n, title: items[n].title });
  if (entries.length) { await loadLinks(entries, addReal, m => { dataMsg = m; upd(); }); dataMsg = `${entries.length} articles · ${realSet.size} real links`; upd(); }
})();
