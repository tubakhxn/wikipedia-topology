import fs from 'fs';
const src = 'node_modules/@mediapipe/tasks-vision/wasm';
fs.mkdirSync('public/wasm', { recursive: true });
for (const f of fs.readdirSync(src)) fs.copyFileSync(`${src}/${f}`, `public/wasm/${f}`);
console.log('mediapipe wasm copied');
