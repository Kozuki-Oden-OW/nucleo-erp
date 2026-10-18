// Motor de grabación de tutoriales de NÚCLEO ERP.
// Chromium visible dentro de Xvfb + ffmpeg x11grab. Cada "beat" es una línea de diálogo:
// la acción ocurre mientras se lee, y el beat dura lo que tarda leerlo en voz alta.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const DISPLAY = ':99';
const W = 1920, H = 1080, SCALE = 1.25;
const BASE = 'http://localhost:8767/#';
const WPS = 2.45; // palabras por segundo al leer con calma

const CURSOR_JS = `
(() => {
  if (window.__cur) return; window.__cur = 1;
  const mk = () => {
    const c = document.createElement('div');
    c.id = '__cursor';
    c.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 2 L4 19 L8.6 14.8 L11.6 21.4 L14.4 20.1 L11.5 13.7 L17.6 13.4 Z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, {position:'fixed',left:'0',top:'0',width:'26px',height:'26px',zIndex:2147483647,pointerEvents:'none',transform:'translate(-200px,-200px)',filter:'drop-shadow(0 2px 3px rgba(0,0,0,.35))'});
    document.documentElement.appendChild(c);
    const r = document.createElement('div');
    Object.assign(r.style, {position:'fixed',width:'44px',height:'44px',marginLeft:'-22px',marginTop:'-22px',borderRadius:'50%',background:'rgba(60,200,223,.35)',border:'2px solid rgba(60,200,223,.9)',zIndex:2147483646,pointerEvents:'none',opacity:'0',transform:'scale(.3)',transition:'none'});
    document.documentElement.appendChild(r);
    let x = -200, y = -200;
    addEventListener('mousemove', e => { x = e.clientX; y = e.clientY; c.style.transform = 'translate(' + (x-3) + 'px,' + (y-2) + 'px)'; }, true);
    addEventListener('mousedown', e => {
      r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px';
      r.style.transition = 'none'; r.style.opacity = '1'; r.style.transform = 'scale(.3)';
      requestAnimationFrame(() => requestAnimationFrame(() => { r.style.transition = 'transform .45s ease-out, opacity .55s ease-out'; r.style.transform = 'scale(1.4)'; r.style.opacity = '0'; }));
    }, true);
    // Resaltado opcional de un elemento (window.__hl(selector))
    const hl = document.createElement('div');
    Object.assign(hl.style, {position:'fixed',zIndex:2147483645,pointerEvents:'none',border:'3px solid #3cc8df',borderRadius:'10px',boxShadow:'0 0 0 9999px rgba(0,20,45,.18)',opacity:'0',transition:'all .35s ease'});
    document.documentElement.appendChild(hl);
    window.__hlBox = (b) => { if (!b) { hl.style.opacity = '0'; return; } Object.assign(hl.style, {left:(b.x-6)+'px',top:(b.y-6)+'px',width:(b.width+12)+'px',height:(b.height+12)+'px',opacity:'1'}); };
  };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', mk); else mk();
  // Sin animación del cursor de texto parpadeante molesto: nada más.
})();`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const words = (t) => t.trim().split(/\s+/).length;
const readMs = (t) => Math.round((words(t) / WPS) * 1000 + 700);

class Recorder {
  constructor(name) {
    this.name = name;
    this.dir = path.join(__dirname, 'raw', name);
    fs.mkdirSync(this.dir, { recursive: true });
    this.beats = [];
    this.mouse = { x: 760, y: 430 };
  }

  async start() {
    try { require('child_process').execSync('pkill -f "Xvfb :99"; sleep 0.5; rm -f /tmp/.X99-lock'); } catch {}
    this.xvfb = spawn('Xvfb', [DISPLAY, '-screen', '0', `${W}x${H}x24`, '-nolisten', 'tcp'], { stdio: 'ignore' });
    await sleep(800);
    this.browser = await chromium.launch({
      headless: false,
      executablePath: process.env.CHROMIUM_PATH || undefined,
      env: { ...process.env, DISPLAY, LANG: 'es_CL.UTF-8', LANGUAGE: 'es_CL:es' },
      args: ['--kiosk', `--force-device-scale-factor=${SCALE}`, '--window-position=0,0', `--window-size=${W / SCALE},${H / SCALE}`,
        '--disable-infobars', '--hide-scrollbars', '--no-first-run', '--disable-features=Translate,AutofillServerCommunication,OptimizationHints,DownloadBubble,DownloadBubbleV2', '--lang=es-419'],
      ignoreDefaultArgs: ['--enable-automation'],
    });
    this.ctx = await this.browser.newContext({ viewport: null, locale: 'es-CL', timezoneId: 'America/Santiago', colorScheme: 'light' });
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
    await this.ctx.clock.install({ time: new Date(today + 'T10:30:00-03:00') });
    await this.ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://localhost:8767' });
    // En los videos, las descargas no abren nada del navegador (evita la burbuja de Chrome).
    await this.ctx.addInitScript(() => { const c = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.hasAttribute('download')) return; return c.call(this); }; });
    await this.ctx.addInitScript(CURSOR_JS);
    await this.ctx.addInitScript(() => {
      const st = document.createElement('style');
      st.textContent = 'div.no-print[class*="001a3c"]{display:none!important} *{scrollbar-width:none}';
      const put = () => { if (!st.isConnected) document.head.appendChild(st); }; addEventListener('DOMContentLoaded', put); setInterval(put, 300);
    });
    this.page = await this.ctx.newPage();
    this.page.setDefaultTimeout(8000);
    const cdp = await this.ctx.newCDPSession(this.page);
    const { windowId } = await cdp.send('Browser.getWindowForTarget');
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'fullscreen' } });
    await sleep(500);
    this.page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  }

  async go(hash, wait = 900) {
    await this.page.goto(BASE + hash);
    await this.page.waitForTimeout(wait);
    await this.page.mouse.move(this.mouse.x, this.mouse.y);
  }

  async rec() {
    const out = path.join(this.dir, 'raw.mkv');
    this.ff = spawn('ffmpeg', ['-y', '-hide_banner', '-f', 'x11grab', '-draw_mouse', '0', '-framerate', '30', '-video_size', `${W}x${H}`, '-i', `${DISPLAY}.0`,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '14', '-pix_fmt', 'yuv420p', out], { stdio: ['pipe', 'ignore', 'pipe'] });
    let err = '';
    this.startEpoch = null;
    await new Promise((res) => {
      this.ff.stderr.on('data', (d) => {
        err += d.toString();
        const m = err.match(/start: ([0-9.]+)/);
        if (m && this.startEpoch === null) { this.startEpoch = parseFloat(m[1]); res(); }
      });
    });
    await sleep(600);
    this.t0 = Date.now() / 1000;
    this.offset = this.t0 - this.startEpoch;
  }

  now() { return Date.now() / 1000 - this.t0; }

  // Una línea de diálogo. `act` corre en paralelo; el beat dura max(lectura, acción + respiro).
  async say(text, act, { min = 0, after = 500 } = {}) {
    const start = this.now();
    const t = Date.now();
    if (act) { try { await act(); } catch (e) { await this.page.screenshot({ path: path.join(this.dir, 'error.png') }); this.ff.kill('SIGKILL'); this.xvfb.kill(); throw e; } }
    const actMs = Date.now() - t;
    const need = Math.max(readMs(text), actMs + after, min);
    if (need > actMs) await sleep(need - actMs);
    const end = this.now();
    this.beats.push({ text, start, end });
    console.log(`[${start.toFixed(1)}–${end.toFixed(1)}] ${text.slice(0, 70)}`);
  }

  async pause(ms) { await sleep(ms); }

  // Movimiento suave del mouse hasta un elemento (o coordenadas).
  // Para pasar el mouse: si el elemento no aparece, sigue la grabación (queda anotado en el log).
  async moveTo(target, opts = {}) {
    try { await this._moveTo(target, { ...opts, timeout: 4000 }); }
    catch (e) { console.log('SOFT-MISS', String(target).slice(0, 80), e.message.split('\n')[0]); }
  }

  async _moveTo(target, { dx = 0, dy = 0, ms = 650, timeout } = {}) {
    let x, y;
    if (typeof target === 'string' || target?.boundingBox) {
      const loc = typeof target === 'string' ? this.page.locator(target + ' >> visible=true').first() : target;
      await loc.waitFor({ state: 'visible', timeout });
      await loc.scrollIntoViewIfNeeded().catch(() => {});
      const b = await loc.boundingBox();
      if (!b) throw new Error('Sin caja para ' + target);
      x = b.x + b.width / 2 + dx; y = b.y + b.height / 2 + dy;
    } else { ({ x, y } = target); }
    const sx = this.mouse.x, sy = this.mouse.y;
    const steps = Math.max(12, Math.round(ms / 16));
    for (let i = 1; i <= steps; i++) {
      const k = i / steps; const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      await this.page.mouse.move(sx + (x - sx) * e, sy + (y - sy) * e);
      await sleep(ms / steps * 0.6);
    }
    this.mouse = { x, y };
  }

  async click(target, opts = {}) {
    await this._moveTo(target, opts);
    await sleep(180);
    await this.page.mouse.down(); await sleep(70); await this.page.mouse.up();
    await sleep(opts.wait ?? 450);
  }

  async type(text, delay = 75) { await this.page.keyboard.type(text, { delay }); }
  async key(k) { await this.page.keyboard.press(k); await sleep(250); }

  // Marca un elemento con un recuadro. Con un texto, busca la tarjeta que lo contiene.
  async highlight(target) {
    try {
      let loc = typeof target === 'string' ? this.page.locator(target + ' >> visible=true').first() : target;
      const b = await loc.boundingBox({ timeout: 3000 });
      await this.page.evaluate((bb) => window.__hlBox(bb), b);
    } catch (e) { console.log('SOFT-MISS highlight', e.message.split('\n')[0]); }
  }
  // Recuadro alrededor de la tarjeta que contiene un texto.
  async highlightCard(text) {
    const b = await this.page.evaluate((t) => {
      const els = [...document.querySelectorAll('main *')].filter((e) => e.childElementCount === 0 && e.textContent.trim().toLowerCase() === t.toLowerCase() && e.offsetParent);
      let el = els[0]; if (!el) return null;
      while (el && el !== document.body) { const cs = getComputedStyle(el); if (parseFloat(cs.borderTopLeftRadius) >= 8 && (cs.borderTopWidth !== '0px' || cs.boxShadow !== 'none')) break; el = el.parentElement; }
      if (!el || el === document.body) return null;
      const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height };
    }, text);
    if (b) await this.page.evaluate((bb) => window.__hlBox(bb), b); else console.log('SOFT-MISS card', text);
  }
  async unhighlight() { await this.page.evaluate(() => window.__hlBox(null)); }

  async scroll(dy, ms = 800) {
    const steps = 20;
    for (let i = 0; i < steps; i++) { await this.page.mouse.wheel(0, dy / steps); await sleep(ms / steps); }
  }

  async stop() {
    await sleep(800);
    const total = this.now();
    this.ff.stdin.write('q');
    await new Promise((r) => this.ff.on('close', r));
    await this.browser.close();
    this.xvfb.kill();
    fs.writeFileSync(path.join(this.dir, 'beats.json'), JSON.stringify({ offset: this.offset, total, beats: this.beats }, null, 1));
    console.log('offset', this.offset.toFixed(3), 'total', total.toFixed(1));
  }
}

module.exports = { Recorder, sleep };
