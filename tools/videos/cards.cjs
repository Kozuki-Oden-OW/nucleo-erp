// Genera las placas de inicio y cierre (1920×1080) de un video.
// Uso: node cards.cjs <dir> <num> "<título línea 1|línea 2>" "<subtítulo>" "<siguiente video>"
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const path = require('path');
const [dir, num, title, sub, next] = process.argv.slice(2);
const fs = require('fs');
const uri = (f, t) => `data:${t};base64,` + fs.readFileSync(path.join(__dirname, f)).toString('base64');
const FONT = uri('manrope.woff2', 'font/woff2'), SYM = uri('simbolo.png', 'image/png');

const css = `
@font-face{font-family:M;src:url(${FONT}) format("woff2");font-weight:200 800}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:1920px;height:1080px;overflow:hidden;font-family:M,sans-serif}
.bg{position:absolute;inset:0;background:radial-gradient(ellipse 70% 80% at 15% 30%,#06345e 0%,transparent 60%),radial-gradient(ellipse 60% 70% at 90% 90%,#003a52 0%,transparent 60%),linear-gradient(135deg,#001a3c,#00122b)}
.grid{position:absolute;inset:0;background-image:linear-gradient(rgba(169,210,236,.07) 1px,transparent 1px),linear-gradient(90deg,rgba(169,210,236,.07) 1px,transparent 1px);background-size:96px 96px}
.word{font-weight:800;color:#fff;white-space:nowrap}.word b{color:#3cc8df}
.badge{display:inline-block;background:#9fd21f;color:#001a3c;font-weight:800;border-radius:14px}
.lema{font-weight:800;color:#fff;line-height:1.02;letter-spacing:-.02em}
.sub{color:#a9bdd0;font-weight:500}
.chip{display:inline-block;border:1px solid rgba(169,210,236,.3);background:rgba(255,255,255,.06);color:#e9f2f8;border-radius:999px;font-weight:600}`;

const brand = (size) => `<div style="display:flex;align-items:center;gap:${size * 0.45}px"><img src="${SYM}" style="width:${size * 1.9}px;height:${size * 1.9}px"><span class="word" style="font-size:${size}px">NÚCLEO <b>ERP</b></span></div>`;
const [t1, t2] = title.split('|');

const intro = `<div class="bg"></div><div class="grid"></div>
<div style="position:absolute;left:120px;top:96px">${brand(46)}</div>
<div style="position:absolute;left:120px;top:330px;width:1600px">
 <div class="badge" style="font-size:44px;padding:8px 26px">${num}</div>
 <div class="lema" style="font-size:150px;margin-top:34px">${t1}${t2 ? `<br><span style="color:#3cc8df">${t2}</span>` : ''}</div>
 <div class="sub" style="font-size:42px;margin-top:40px">${sub}</div>
</div>
<div style="position:absolute;right:120px;bottom:90px" class="chip"><span style="display:inline-block;font-size:30px;padding:14px 32px">Tutorial paso a paso</span></div>`;

const outro = `<div class="bg"></div><div class="grid"></div>
<div style="position:absolute;left:120px;top:96px">${brand(46)}</div>
<div style="position:absolute;left:120px;top:300px;width:900px">
 <div class="lema" style="font-size:96px">Descárgalo<br><span style="color:#3cc8df">gratis</span></div>
 <div style="font-size:64px;font-weight:800;color:#fff;margin-top:36px">nucleoerp.cl</div>
 <div class="sub" style="font-size:36px;margin-top:28px">Tu empresa. Tus datos. Tu computador.</div>
</div>
${next ? `<div style="position:absolute;right:120px;top:340px;width:640px;height:360px;border:3px dashed rgba(169,210,236,.35);border-radius:22px;display:flex;flex-direction:column;justify-content:flex-end;padding:30px"><div class="sub" style="font-size:26px">Siguiente video</div><div style="color:#fff;font-weight:800;font-size:40px;margin-top:8px;line-height:1.1">${next}</div></div>` : ''}
<div style="position:absolute;left:120px;bottom:90px" class="sub"><span style="font-size:28px">Todo tu negocio. Un solo núcleo.</span></div>`;

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  for (const [name, body] of [['intro', intro], ['outro', outro]]) {
    await p.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${body}</body></html>`);
    await p.waitForTimeout(400);
    await p.screenshot({ path: path.join(dir, name + '.png') });
  }
  await b.close();
})();
