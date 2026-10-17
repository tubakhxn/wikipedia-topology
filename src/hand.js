import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const HOLD_MS = 200, COOL_MS = 250, LOSS_MS = 450;
export const CONNECTIONS = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];

export function createHand(video, onStatus) {
  const S = { present: false, gesture: 'none', confidence: 0, px: .5, py: .5, tip: { x: 0, y: 0, z: 0 }, pinchX: .5, pinchY: .5, lm: null, ready: false };
  let lm = null, lastSeen = -1e9, lastT = -1, landmarker = null, cand = 'none', candStart = 0, lastSwitch = -1e9, pinchRaw = false;
  const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z - b.z) * .5);
  const map = v => Math.min(1, Math.max(0, (v - .5) * 1.3 + .5));

  async function init() {
    try {
      onStatus('camera: requesting');
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { onStatus('camera blocked: open via http://localhost:5173 (npm run dev), not file://'); return; }
      let stream;
      try { stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: false }); }
      catch (e) { try { stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false }); }
        catch (e2) { onStatus('camera error: ' + e2.name + ' — allow camera access; mouse still works'); return; } }
      video.srcObject = stream; await video.play();
      onStatus('hand model: loading');
      const fs = await FilesetResolver.forVisionTasks('./wasm');
      const opts = del => ({ baseOptions: { modelAssetPath: MODEL, delegate: del }, runningMode: 'VIDEO', numHands: 1, minHandDetectionConfidence: .6, minHandPresenceConfidence: .6, minTrackingConfidence: .5 });
      try { landmarker = await HandLandmarker.createFromOptions(fs, opts('GPU')); }
      catch (e) { landmarker = await HandLandmarker.createFromOptions(fs, opts('CPU')); }
      S.ready = true; onStatus('hand tracking on');
    } catch (e) { console.warn(e); onStatus('hand model failed: ' + (e.message || e) + ' — mouse still works'); }
  }

  // finger geometry from the 21 landmarks: a finger is "extended" when its tip is farther from the wrist than its PIP joint
  function classify(l) {
    const palm = Math.max(d(l[0], l[9]), 1e-4);
    const ext = (t, p) => d(l[t], l[0]) > d(l[p], l[0]) * 1.12;
    const idx = ext(8, 6), mid = ext(12, 10), rg = ext(16, 14), pk = ext(20, 18), others = mid + rg + pk, cnt = idx + others;
    const pr = d(l[4], l[8]) / palm;
    pinchRaw = pinchRaw ? pr < .5 : pr < .3;
    const idxNotCurled = d(l[8], l[0]) > d(l[6], l[0]) * .95;
    if (pinchRaw && (others >= 1 || idxNotCurled)) return 'pinch';
    if (cnt >= 4) return 'open';
    if (cnt === 0) return 'fist';
    if (idx && !others && l[8].y < l[0].y) return 'point';
    return 'none';
  }

  function update(now) {
    if (!landmarker || video.readyState < 2 || video.currentTime === lastT) { checkLoss(now); return; }
    lastT = video.currentTime;
    let res; try { res = landmarker.detectForVideo(video, now); } catch (e) { return; }
    const raw = res.landmarks && res.landmarks[0];
    if (raw) {
      if (!lm || now - lastSeen > LOSS_MS) lm = raw.map(p => ({ x: p.x, y: p.y, z: p.z }));
      else raw.forEach((p, i) => { const q = lm[i]; q.x += (p.x - q.x) * .45; q.y += (p.y - q.y) * .45; q.z += (p.z - q.z) * .45; });
      lastSeen = now;
      const g = classify(lm);
      if (g !== cand) { cand = g; candStart = now; }
      S.confidence = Math.min(1, (now - candStart) / HOLD_MS);
      if (cand !== S.gesture && now - candStart >= HOLD_MS && now - lastSwitch >= COOL_MS) { S.gesture = cand; lastSwitch = now; }
      S.tip.x = lm[8].x; S.tip.y = lm[8].y; S.tip.z = lm[8].z;
      const tx = map(1 - lm[8].x), ty = map(lm[8].y);
      S.px += (tx - S.px) * .6; S.py += (ty - S.py) * .6;
      S.pinchX = 1 - (lm[4].x + lm[8].x) / 2; S.pinchY = (lm[4].y + lm[8].y) / 2;
      S.present = true; S.lm = lm;
    }
    checkLoss(now);
  }
  // tracking loss: after LOSS_MS without a hand everything resets so the graph relaxes back
  function checkLoss(now) {
    if (now - lastSeen > LOSS_MS) { S.present = false; S.gesture = 'none'; S.lm = null; cand = 'none'; pinchRaw = false; S.confidence = 0; }
  }
  return { S, init, update };
}
