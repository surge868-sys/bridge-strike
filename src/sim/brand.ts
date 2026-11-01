// The BRIDGE STRIKE! wordmark, drawn on a canvas in Anton (procedural stand-in
// until a generated logo lands): warning-yellow letters, black outline and
// drop shadow, a concrete beam resting on BRIDGE, and the leg of the R in
// STRIKE replaced by a highway arrow. Used by the title screen and share card.

const YELLOW = '#f2c200';
const INK = '#16130f';

/** Draws the logo centred on (cx, top); returns its height. `w` is the target width. */
export function drawLogo(g: CanvasRenderingContext2D, cx: number, top: number, w: number) {
  const size = w * 0.255; // font size that makes STRIKE! about w wide
  // Anton's caps are about 0.85 em tall.
  const line1 = top + size * 0.22 + size * 0.86 * 0.85;
  const line2 = line1 + size * 0.85 + size * 0.14;
  const stroke = size * 0.07;
  const shadow = size * 0.055;
  g.save();
  g.textBaseline = 'alphabetic';
  g.lineJoin = 'round';
  g.font = `${size}px Anton, Impact, sans-serif`;

  // --- the beam: a concrete overpass slab resting on BRIDGE, with a crack
  g.font = `${size * 0.86}px Anton, Impact, sans-serif`;
  const bw = g.measureText('BRIDGE').width;
  const beamH = size * 0.17, beamY = top + size * 0.02;
  g.fillStyle = INK;
  g.fillRect(cx - bw * 0.62 + shadow, beamY + shadow, bw * 1.24, beamH);
  g.fillStyle = '#b9b3a7';
  g.fillRect(cx - bw * 0.62, beamY, bw * 1.24, beamH);
  g.strokeStyle = INK;
  g.lineWidth = stroke * 0.6;
  g.strokeRect(cx - bw * 0.62, beamY, bw * 1.24, beamH);
  g.beginPath();
  g.moveTo(cx + bw * 0.18, beamY + beamH);
  g.lineTo(cx + bw * 0.22, beamY + beamH * 0.5);
  g.lineTo(cx + bw * 0.19, beamY + beamH * 0.25);
  g.lineTo(cx + bw * 0.24, beamY);
  g.stroke();

  // --- line 1: BRIDGE (slightly smaller, sitting under the beam)
  const word = (text: string, x: number, y: number, align: CanvasTextAlign) => {
    g.textAlign = align;
    g.fillStyle = INK;
    g.fillText(text, x + shadow, y + shadow);
    g.lineWidth = stroke * 2;
    g.strokeStyle = INK;
    g.strokeText(text, x, y);
    g.fillStyle = YELLOW;
    g.fillText(text, x, y);
  };
  word('BRIDGE', cx, line1, 'center');

  // --- line 2: ST + R-with-arrow + IKE!
  g.font = `${size}px Anton, Impact, sans-serif`;
  const wST = g.measureText('ST').width, wP = g.measureText('P').width, wIKE = g.measureText('IKE!').width;
  const wR = wP * 1.22; // the arrow leg sticks out a little past the bowl
  const total = wST + wR + wIKE;
  let x = cx - total / 2;
  word('ST', x, line2, 'left');
  x += wST;
  // R: the bowl and stem are a P; the leg is a highway arrow pointing down-right.
  const capH = size * 0.85;
  const legTop = line2 - capH * 0.44, legX0 = x + wP * 0.4;
  const ax = x + wR * 1.0, ay = line2 + size * 0.02;
  const arrow = () => {
    const dx = ax - legX0, dy = ay - legTop, len = Math.hypot(dx, dy);
    const ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
    const shaft = size * 0.09, head = size * 0.22, headLen = size * 0.28;
    const bx = ax - ux * headLen, by = ay - uy * headLen;
    g.beginPath();
    g.moveTo(legX0 + nx * shaft, legTop + ny * shaft);
    g.lineTo(bx + nx * shaft, by + ny * shaft);
    g.lineTo(bx + nx * head, by + ny * head);
    g.lineTo(ax, ay);
    g.lineTo(bx - nx * head, by - ny * head);
    g.lineTo(bx - nx * shaft, by - ny * shaft);
    g.lineTo(legX0 - nx * shaft, legTop - ny * shaft);
    g.closePath();
  };
  g.save();
  g.translate(shadow, shadow);
  arrow();
  g.fillStyle = INK;
  g.fill();
  g.restore();
  word('P', x, line2, 'left');
  arrow();
  g.lineWidth = stroke * 2;
  g.strokeStyle = INK;
  g.stroke();
  g.fillStyle = YELLOW;
  g.fill();
  x += wR;
  word('IKE!', x, line2, 'left');
  g.restore();
  return line2 - top + size * 0.1;
}

/** A transparent canvas holding just the logo, `w` CSS pixels wide. */
export function logoCanvas(w: number, dpr = Math.min(window.devicePixelRatio || 1, 2)) {
  const h = Math.round(w * 0.56);
  const c = document.createElement('canvas');
  c.width = Math.round(w * dpr);
  c.height = Math.round(h * dpr);
  c.style.width = `${w}px`;
  c.style.height = `${h}px`;
  const g = c.getContext('2d')!;
  g.scale(dpr, dpr);
  drawLogo(g, w / 2, w * 0.04, w * 0.86);
  return c;
}

export interface ShareInfo {
  kind: 'strike' | 'delivered';
  headline: string;
  sub: string;
  rows: [string, string][];
}

/** A 1080x1350 (4:5) share image: a frame from the run, the logo, the result. */
export function shareCard(frame: HTMLCanvasElement | null, o: ShareInfo) {
  const W = 1080, H = 1350;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = INK;
  g.fillRect(0, 0, W, H);
  const imgH = 780;
  if (frame && frame.width > 0) {
    // cover-fit the frame into the top band
    const s = Math.max(W / frame.width, imgH / frame.height);
    const fw = frame.width * s, fh = frame.height * s;
    g.drawImage(frame, (W - fw) / 2, (imgH - fh) / 2, fw, fh);
  }
  const fade = g.createLinearGradient(0, imgH - 260, 0, imgH);
  fade.addColorStop(0, 'rgba(22,19,15,0)');
  fade.addColorStop(1, 'rgba(22,19,15,1)');
  g.fillStyle = fade;
  g.fillRect(0, imgH - 260, W, 260);
  const topFade = g.createLinearGradient(0, 0, 0, 300);
  topFade.addColorStop(0, 'rgba(22,19,15,0.55)');
  topFade.addColorStop(1, 'rgba(22,19,15,0)');
  g.fillStyle = topFade;
  g.fillRect(0, 0, W, 300);
  drawLogo(g, W / 2, 34, 560);

  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.fillStyle = o.kind === 'strike' ? '#e23b2e' : '#3fbf5a';
  g.font = '118px Anton, Impact, sans-serif';
  g.fillText(o.headline, W / 2, imgH + 70);
  g.fillStyle = '#f7f3e8';
  g.font = '500 40px Oswald, sans-serif';
  g.fillText(o.sub, W / 2, imgH + 136, W - 80);
  let y = imgH + 216;
  for (const [k, v] of o.rows) {
    g.textAlign = 'left';
    g.fillStyle = '#b9b0a2';
    g.font = '500 36px Oswald, sans-serif';
    g.fillText(k, 90, y, 640);
    g.textAlign = 'right';
    g.fillStyle = '#ffffff';
    g.font = '700 40px Oswald, sans-serif';
    g.fillText(v, W - 90, y);
    g.fillStyle = 'rgba(255,255,255,0.12)';
    g.fillRect(90, y + 18, W - 180, 2);
    y += 66;
  }
  g.fillStyle = YELLOW;
  g.fillRect(0, H - 110, W, 110);
  g.fillStyle = INK;
  g.textAlign = 'center';
  g.font = '56px Anton, Impact, sans-serif';
  g.fillText('CAN YOU HAUL IT INTO SASKATOON?', W / 2, H - 36);
  return c;
}

/** 1200x630 link-preview image: a game frame with the logo and the pitch. */
export function ogCard(frame: HTMLCanvasElement) {
  const W = 1200, H = 630;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const s = Math.max(W / frame.width, H / frame.height);
  g.drawImage(frame, (W - frame.width * s) / 2, (H - frame.height * s) / 2, frame.width * s, frame.height * s);
  const shade = g.createLinearGradient(0, 0, W * 0.7, 0);
  shade.addColorStop(0, 'rgba(22,19,15,0.72)');
  shade.addColorStop(1, 'rgba(22,19,15,0)');
  g.fillStyle = shade;
  g.fillRect(0, 0, W, H);
  drawLogo(g, 330, 70, 520);
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.font = '500 30px Oswald, sans-serif';
  g.shadowColor = 'rgba(0,0,0,0.7)';
  g.shadowBlur = 8;
  g.fillText('Haul it into Saskatoon.', 330, 470);
  g.fillText("Don't hit the overpasses.", 330, 512);
  return c;
}
