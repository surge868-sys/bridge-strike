// DOM overlay: road-sign HUD, touch controls, outcome cards. Plain DOM + injected
// CSS so the single-file build needs no framework.
import type { LoadDef } from './loads';

export interface TouchState {
  steer: number;
  gas: number;
  brake: number;
  lower: boolean;
  jake: boolean;
}

export interface HudState {
  speedKmh: number;
  load: LoadDef;
  loadTop: number; // current top-of-load height (lowered or not)
  lowered: number; // 0..1
  next?: { name: string; distance: number; lanes: { name: string; clearance: number }[]; currentLane: string | null };
}

const CSS = `
.bs-root{position:absolute;inset:0;pointer-events:none;font-family:Oswald,sans-serif;color:#111;user-select:none;-webkit-user-select:none;touch-action:none;overflow:hidden}
.bs-root *{box-sizing:border-box}
.bs-sign{position:absolute;border-radius:10px;padding:6px 10px;box-shadow:0 2px 8px rgba(0,0,0,.35)}
.bs-guide{top:max(10px,env(safe-area-inset-top));left:50%;transform:translateX(-50%);background:#0b6b3a;color:#fff;border:3px solid #fff;outline:2px solid #0b6b3a;text-align:center;min-width:230px}
.bs-guide .t{font:500 13px Oswald,sans-serif;letter-spacing:.08em;opacity:.9}
.bs-guide .n{font:28px/1.05 Anton,Impact,sans-serif;letter-spacing:.02em}
.bs-guide .d{font:700 18px Oswald,sans-serif}
.bs-chips{display:flex;gap:6px;justify-content:center;margin-top:6px}
.bs-chip{border-radius:6px;padding:2px 8px;font:700 14px Oswald,sans-serif;border:2px solid #fff;color:#111;min-width:94px}
.bs-chip.fits{background:#3fbf5a}.bs-chip.lower{background:#f2c200}.bs-chip.no{background:#e23b2e;color:#fff}
.bs-chip.cur{outline:3px solid #fff;outline-offset:1px}
.bs-speed{top:max(10px,env(safe-area-inset-top));left:10px;background:#fff;border:3px solid #111;outline:2px solid #fff;text-align:center;width:86px;padding:4px}
.bs-speed .t{font:500 12px Oswald,sans-serif;letter-spacing:.1em}
.bs-speed .v{font:38px/1 Anton,Impact,sans-serif}
.bs-speed .u{font:500 11px Oswald,sans-serif}
.bs-load{top:max(10px,env(safe-area-inset-top));right:10px;width:96px;height:96px;padding:0;background:transparent;box-shadow:none}
.bs-load .dia{position:absolute;inset:14px;transform:rotate(45deg);background:#f2c200;border:3px solid #111;outline:2px solid #f2c200;border-radius:6px}
.bs-load .txt{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
.bs-load .t{font:700 10px Oswald,sans-serif;letter-spacing:.08em}
.bs-load .v{font:24px/1 Anton,Impact,sans-serif}
.bs-load .s{font:700 10px Oswald,sans-serif}
.bs-load.down .dia{background:#ffd84d}
.bs-ctrl{pointer-events:auto;position:absolute;touch-action:none}
.bs-wheel{left:max(14px,env(safe-area-inset-left));bottom:max(14px,env(safe-area-inset-bottom));width:150px;height:150px;border-radius:50%;border:12px solid rgba(20,20,20,.75);background:radial-gradient(circle,rgba(255,255,255,.08) 0 30%,transparent 31%)}
.bs-wheel .spoke{position:absolute;left:50%;top:50%;width:100%;height:12px;margin:-6px 0 0 -50%;background:rgba(20,20,20,.75);border-radius:6px}
.bs-wheel .spoke.v{width:12px;height:50%;margin:0 0 0 -6px;top:50%}
.bs-pedal{bottom:max(14px,env(safe-area-inset-bottom));width:70px;height:120px;border-radius:12px;background:rgba(20,20,20,.72);color:#fff;display:flex;align-items:flex-end;justify-content:center;padding-bottom:10px;font:700 13px Oswald,sans-serif;letter-spacing:.08em;border:2px solid rgba(255,255,255,.35)}
.bs-gas{right:max(14px,env(safe-area-inset-right));height:140px}
.bs-brk{right:calc(max(14px,env(safe-area-inset-right)) + 82px)}
.bs-pedal.on{background:rgba(242,194,0,.9);color:#111}
.bs-btn{border-radius:10px;background:rgba(20,20,20,.72);color:#fff;font:700 13px Oswald,sans-serif;letter-spacing:.08em;display:flex;align-items:center;justify-content:center;border:2px solid rgba(255,255,255,.35)}
.bs-btn.on{background:#f2c200;color:#111}
.bs-lowerbtn{right:max(14px,env(safe-area-inset-right));bottom:calc(max(14px,env(safe-area-inset-bottom)) + 152px);width:152px;height:64px;font:22px Anton,Impact,sans-serif;background:rgba(242,194,0,.92);color:#111;border:3px solid #111}
.bs-lowerbtn.on{background:#fff}
.bs-cam{left:max(14px,env(safe-area-inset-left));bottom:calc(max(14px,env(safe-area-inset-bottom)) + 166px);width:64px;height:40px}
.bs-jake{left:calc(max(14px,env(safe-area-inset-left)) + 72px);bottom:calc(max(14px,env(safe-area-inset-bottom)) + 166px);width:64px;height:40px}
.bs-card{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(92vw,420px);background:#fff;border:4px solid #111;border-radius:14px;padding:18px 18px 14px;text-align:center;pointer-events:auto;box-shadow:0 10px 40px rgba(0,0,0,.5)}
.bs-card h1{margin:0;font:56px/1 Anton,Impact,sans-serif;letter-spacing:.01em}
.bs-card.strike h1{color:#d22}
.bs-card .sub{font:700 15px Oswald,sans-serif;margin:6px 0 10px}
.bs-card table{width:100%;border-collapse:collapse;font:500 14px Oswald,sans-serif;text-align:left}
.bs-card td{padding:3px 0;border-bottom:1px dashed #bbb}.bs-card td:last-child{text-align:right;white-space:nowrap}
.bs-card tr.total td{border-bottom:none;font:700 18px Oswald,sans-serif;padding-top:8px}
.bs-card .go{margin-top:12px;display:inline-block;background:#111;color:#fff;font:22px Anton,Impact,sans-serif;padding:8px 22px;border-radius:10px;cursor:pointer;border:none}
.bs-toast{position:absolute;left:50%;top:32%;transform:translateX(-50%);background:#0b6b3a;color:#fff;border:3px solid #fff;border-radius:10px;padding:8px 18px;font:34px Anton,Impact,sans-serif;opacity:0;transition:opacity .3s}
.bs-toast.show{opacity:1}
.bs-strip{position:absolute;left:0;right:0;bottom:0;background:#111;color:#fff;font:600 13px Oswald,sans-serif;padding:8px 12px;text-align:center;pointer-events:auto;z-index:5}
.bs-strip b{color:#f2c200}
.bs-start{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(20,14,8,.35);pointer-events:auto;cursor:pointer;z-index:4}
.bs-start .box{background:#0b6b3a;color:#fff;border:4px solid #fff;outline:3px solid #0b6b3a;border-radius:14px;padding:14px 26px;text-align:center;max-width:88vw}
.bs-start .big{font:44px/1 Anton,Impact,sans-serif;letter-spacing:.02em}
.bs-start .small{font:500 14px/1.5 Oswald,sans-serif;margin-top:8px;opacity:.95}
.bs-keys{position:absolute;left:10px;bottom:10px;background:rgba(0,0,0,.55);color:#fff;font:500 12px Oswald,sans-serif;padding:6px 10px;border-radius:8px;line-height:1.5}
@media (pointer:coarse){.bs-keys{display:none}}
@media (max-width:560px){
.bs-speed{width:62px;padding:3px}.bs-speed .v{font-size:28px}.bs-speed .t,.bs-speed .u{font-size:10px}
.bs-load{width:74px;height:74px}.bs-load .dia{inset:11px}.bs-load .v{font-size:19px}.bs-load .t,.bs-load .s{font-size:9px}
.bs-guide{left:82px;right:82px;transform:none;min-width:0;padding:4px 6px}
.bs-guide .t{font-size:10px}.bs-guide .n{font-size:19px}.bs-guide .d{font-size:14px}
.bs-chips{flex-direction:column;gap:3px}.bs-chip{font-size:11px;min-width:0;padding:1px 4px}
.bs-wheel{width:124px;height:124px;border-width:10px}
.bs-pedal{width:58px;height:100px}.bs-gas{height:116px}.bs-brk{right:calc(max(14px,env(safe-area-inset-right)) + 68px)}
.bs-lowerbtn{width:126px;height:56px;font-size:19px;bottom:calc(max(14px,env(safe-area-inset-bottom)) + 128px)}
.bs-cam,.bs-jake{bottom:calc(max(14px,env(safe-area-inset-bottom)) + 138px);width:56px}.bs-jake{left:calc(max(14px,env(safe-area-inset-left)) + 62px)}
.bs-card h1{font-size:44px}
}
@media (pointer:fine){.bs-ctrl{display:none}}
`;

// Capture can throw (no active pointer, some in-app webviews); controls must keep working.
const capture = (el: HTMLElement, e: PointerEvent) => { try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ } };

const fmt$ = (n: number) => '$' + Math.round(n).toLocaleString('en-CA');

export class UI {
  root: HTMLDivElement;
  touch: TouchState = { steer: 0, gas: 0, brake: 0, lower: false, jake: false };
  onCam: () => void = () => {};
  onRestart: () => void = () => {};
  onStart: () => void = () => {};
  started = false;
  private els: Record<string, HTMLElement> = {};
  private card: HTMLDivElement | null = null;
  private toastTimer = 0;

  constructor(container: HTMLElement, forceTouch = false) {
    if (!document.getElementById('bs-css')) {
      const style = document.createElement('style');
      style.id = 'bs-css';
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    this.root = document.createElement('div');
    this.root.className = 'bs-root';
    container.appendChild(this.root);
    this.root.innerHTML = `
      <div class="bs-sign bs-speed"><div class="t">SPEED</div><div class="v" data-k="speed">0</div><div class="u">km/h</div></div>
      <div class="bs-sign bs-guide" data-k="guide"><div class="t" data-k="gt">NEXT OVERPASS</div><div class="n" data-k="gn"></div><div class="d" data-k="gd"></div><div class="bs-chips" data-k="chips"></div></div>
      <div class="bs-sign bs-load" data-k="load"><div class="dia"></div><div class="txt"><div class="t">LOAD</div><div class="v" data-k="lh">0.00</div><div class="s" data-k="ls">m</div></div></div>
      <div class="bs-toast" data-k="toast"></div>
      <div class="bs-start" data-k="start"><div class="box"><div class="big" data-k="startbig">CLICK TO DRIVE</div><div class="small" data-k="startsmall">W / S gas and brake · A / D steer · hold SPACE to lower the load</div></div></div>
      <div class="bs-keys">W/S gas &amp; brake · A/D steer · hold SPACE lower · J jake · C camera · R restart</div>
      <div class="bs-ctrl bs-wheel" data-k="wheel"><div class="spoke"></div><div class="spoke v"></div></div>
      <div class="bs-ctrl bs-btn bs-cam" data-k="cam">CAM</div>
      <div class="bs-ctrl bs-btn bs-jake" data-k="jake">JAKE</div>
      <div class="bs-ctrl bs-btn bs-lowerbtn" data-k="lower">LOWER LOAD</div>
      <div class="bs-ctrl bs-pedal bs-brk" data-k="brk">BRAKE</div>
      <div class="bs-ctrl bs-pedal bs-gas" data-k="gas">GAS</div>`;
    this.root.querySelectorAll<HTMLElement>('[data-k]').forEach((e) => (this.els[e.dataset.k!] = e));
    if (forceTouch) this.root.querySelectorAll<HTMLElement>('.bs-ctrl').forEach((e) => (e.style.display = 'flex'));
    this.bindTouch();
    this.inAppBrowserGuard();
    // The game runs inside a frame: keys only arrive once it has focus, so the
    // first click or tap starts the session and focuses it.
    if (forceTouch || matchMedia('(pointer: coarse)').matches) {
      this.els.startbig.textContent = 'TAP TO DRIVE';
      this.els.startsmall.textContent = 'Wheel bottom-left · pedals bottom-right · hold LOWER LOAD to drop the deck 30 cm';
    }
    this.els.start.addEventListener('pointerdown', (e) => { e.preventDefault(); this.start(); });
  }

  private bindTouch() {
    const hold = (key: 'gas' | 'brk' | 'lower' | 'jake', on: (v: boolean) => void) => {
      const el = this.els[key];
      const set = (v: boolean) => { on(v); el.classList.toggle('on', v); };
      el.addEventListener('pointerdown', (e) => { capture(el, e); set(true); e.preventDefault(); });
      el.addEventListener('pointerup', () => set(false));
      el.addEventListener('pointercancel', () => set(false));
    };
    hold('gas', (v) => (this.touch.gas = v ? 1 : 0));
    hold('brk', (v) => (this.touch.brake = v ? 1 : 0));
    hold('lower', (v) => (this.touch.lower = v));
    this.els.jake.addEventListener('pointerdown', (e) => {
      this.touch.jake = !this.touch.jake;
      this.els.jake.classList.toggle('on', this.touch.jake);
      e.preventDefault();
    });
    this.els.cam.addEventListener('pointerdown', (e) => { this.onCam(); e.preventDefault(); });

    // Steering wheel: drag around the centre; 135 degrees each way is full lock.
    const wheel = this.els.wheel;
    let startAngle = 0, base = 0, active = -1;
    const angleOf = (e: PointerEvent) => {
      const r = wheel.getBoundingClientRect();
      return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2));
    };
    wheel.addEventListener('pointerdown', (e) => {
      active = e.pointerId;
      capture(wheel, e);
      startAngle = angleOf(e);
      base = this.touch.steer * 2.36;
      e.preventDefault();
    });
    wheel.addEventListener('pointermove', (e) => {
      if (e.pointerId !== active) return;
      let d = angleOf(e) - startAngle;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      const a = Math.max(-2.36, Math.min(2.36, base + d));
      this.touch.steer = a / 2.36;
      wheel.style.transform = `rotate(${a}rad)`;
    });
    const release = () => {
      active = -1;
      this.touch.steer = 0;
      wheel.style.transition = 'transform .25s';
      wheel.style.transform = 'rotate(0rad)';
      setTimeout(() => (wheel.style.transition = ''), 260);
    };
    wheel.addEventListener('pointerup', release);
    wheel.addEventListener('pointercancel', release);
  }

  /** Facebook / Instagram in-app browsers close the page on horizontal edge swipes. */
  private inAppBrowserGuard() {
    const ua = navigator.userAgent || '';
    if (!/FBAN|FBAV|FB_IAB|Instagram/i.test(ua)) return;
    const block = (e: TouchEvent) => {
      const t = e.touches[0];
      if (t && (t.clientX < 30 || t.clientX > window.innerWidth - 30)) e.preventDefault();
    };
    document.addEventListener('touchstart', block, { passive: false });
    document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
    const strip = document.createElement('div');
    strip.className = 'bs-strip';
    strip.innerHTML = 'For the full game, tap <b>⋯</b> and choose <b>Open in browser</b>.';
    strip.addEventListener('pointerdown', () => strip.remove());
    this.root.appendChild(strip);
  }

  update(s: HudState) {
    this.els.speed.textContent = String(Math.round(Math.abs(s.speedKmh)));
    this.els.lh.textContent = s.loadTop.toFixed(2);
    this.els.ls.textContent = s.lowered > 0.99 ? 'LOWERED' : s.lowered > 0.01 ? 'LOWERING…' : 'm';
    this.els.load.classList.toggle('down', s.lowered > 0.99);
    const g = this.els.guide;
    if (!s.next) { g.style.display = 'none'; return; }
    g.style.display = '';
    this.els.gn.textContent = s.next.name;
    this.els.gd.textContent = s.next.distance > 1000 ? `${(s.next.distance / 1000).toFixed(1)} km` : `${Math.max(0, Math.round(s.next.distance / 10) * 10)} m`;
    const full = s.load.top, low = s.load.top - 0.3;
    this.els.chips.innerHTML = s.next.lanes
      .map((l) => {
        const cls = full < l.clearance ? 'fits' : low < l.clearance ? 'lower' : 'no';
        const word = cls === 'fits' ? 'FITS' : cls === 'lower' ? 'LOWER IT' : 'NO';
        return `<div class="bs-chip ${cls}${s.next!.currentLane === l.name ? ' cur' : ''}">${l.name} ${l.clearance.toFixed(2)} · ${word}</div>`;
      })
      .join('');
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.els.start.remove();
    this.onStart();
  }

  toast(text: string, ms = 1800) {
    const t = this.els.toast;
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => t.classList.remove('show'), ms);
  }

  showStrike(info: { where: string; speedKmh: number; load: LoadDef }) {
    const k = Math.max(0.4, info.speedKmh / 60);
    const rows: [string, number][] = [
      [`Girder repair, ${info.where}`, 185000 * k],
      ['Lane closures and traffic control', 41000 + 9000 * k],
      ['Structural engineer, weekend rate', 14750],
      ['Concrete crumbs swept from Circle Drive', 2380],
      ['Clearance sign that was right all along', 0],
    ];
    const total = rows.reduce((a, [, v]) => a + v, 0);
    this.showCard('strike', 'BRIDGE STRIKE!', `${info.load.name} vs. ${info.where} at ${Math.round(info.speedKmh)} km/h. City of Saskatoon repair bill:`,
      `<table>${rows.map(([n, v]) => `<tr><td>${n}</td><td>${fmt$(v)}</td></tr>`).join('')}<tr class="total"><td>TOTAL</td><td>${fmt$(total)}</td></tr></table>`);
  }

  showRolled(load: LoadDef) {
    this.showCard('rolled', 'ROLLED IT!', `The ${load.name.toLowerCase()} is now on its side, and so are you.`, '<p style="font:500 14px Oswald,sans-serif;margin:0">Steering lock is speed-limited for a reason. The ditch has your load now.</p>');
  }

  showCleared(text: string) {
    this.toast(text, 2200);
  }

  private showCard(kind: string, title: string, sub: string, body: string) {
    this.hideCard();
    const c = document.createElement('div');
    c.className = `bs-card ${kind}`;
    c.innerHTML = `<h1>${title}</h1><div class="sub">${sub}</div>${body}<button class="go">TRY AGAIN</button>`;
    c.querySelector('.go')!.addEventListener('click', () => this.onRestart());
    this.root.appendChild(c);
    this.card = c;
  }

  hideCard() {
    this.card?.remove();
    this.card = null;
  }
}
