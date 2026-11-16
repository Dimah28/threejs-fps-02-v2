// Ironworks Protocol — look: dusk industrial yard. Rust orange, steel teal, hazard
// amber on dark concrete, under a low amber sun. All textures are drawn on canvas
// at load time: no image files, no network, and every run paints the same pixels.

export const PALETTE = {
  canvas: '#141210',
  surface: '#211c17',
  hairline: '#3d342a',
  ink: '#f2ead9',
  muted: '#a39a8b',
  accent: '#f5a623',
  sentinel: '#3f8cff',
  viper: '#e07830',
  danger: '#e5484d',
  ok: '#46a758',
  teal: '#2e8f86',
  rust: '#8a4b2a',
  steel: '#5c6670',
  concrete: '#6e675e',
};

function speckle(ctx, size, rng, base, spots, alpha) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < spots; i++) {
    const g = 120 + Math.floor(rng() * 80);
    ctx.fillStyle = `rgba(${g},${Math.floor(g * 0.92)},${Math.floor(g * 0.8)},${alpha})`;
    const r = 1 + rng() * 4;
    ctx.beginPath();
    ctx.arc(rng() * size, rng() * size, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function concreteTexture(THREE, rng) {
  const tex = new THREE.CanvasTexture(((c) => {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 256;
    const ctx = canvas.getContext('2d');
    speckle(ctx, 256, rng, '#6e675e', 900, 0.16);
    // expansion joints
    ctx.strokeStyle = 'rgba(30,26,22,0.55)'; ctx.lineWidth = 3;
    ctx.strokeRect(1, 1, 254, 254);
    ctx.beginPath(); ctx.moveTo(128, 0); ctx.lineTo(128, 256); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, 128); ctx.lineTo(256, 128); ctx.stroke();
    // oil stains
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = 'rgba(25,20,16,0.18)';
      ctx.beginPath();
      ctx.ellipse(rng() * 256, rng() * 256, 18 + rng() * 30, 10 + rng() * 18, rng() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    return canvas;
  })());
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function metalTexture(THREE, rng, base = '#5c6670') {
  const tex = new THREE.CanvasTexture(((c) => {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = base; ctx.fillRect(0, 0, 256, 256);
    // corrugation
    for (let x = 0; x < 256; x += 16) {
      ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(x, 0, 5, 256);
      ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(x + 8, 0, 6, 256);
    }
    // rust streaks
    for (let i = 0; i < 26; i++) {
      ctx.fillStyle = `rgba(138,75,42,${0.08 + rng() * 0.16})`;
      const x = rng() * 256, w = 2 + rng() * 6, h = 20 + rng() * 90;
      ctx.fillRect(x, rng() * 120, w, h);
    }
    return canvas;
  })());
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function hazardTexture(THREE) {
  const tex = new THREE.CanvasTexture(((c) => {
    const canvas = document.createElement('canvas');
    canvas.width = 128; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#f5a623'; ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = '#1a1713';
    for (let i = -128; i < 256; i += 32) {
      ctx.beginPath();
      ctx.moveTo(i, 128); ctx.lineTo(i + 16, 128); ctx.lineTo(i + 128 + 16, 0); ctx.lineTo(i + 128, 0);
      ctx.closePath(); ctx.fill();
    }
    return canvas;
  })());
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
