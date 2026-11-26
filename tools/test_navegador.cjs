// Prueba del guion del Navegador de NÚCLEO (apps/desktop/src-tauri/src/browser.js) en Chromium, con
// páginas de mentira servidas por intercepción: marcos de otro origen, clic, escribir, guardar un
// archivo, leer un PDF y rellenar un ingreso solo en el sitio del acceso.
//
//   node tools/test_navegador.cjs        (necesita Playwright con Chromium)
const { chromium } = require('playwright');
const assert = require('assert');
const JS = require('path').join(__dirname, '..', 'apps', 'desktop', 'src-tauri', 'src', 'browser.js');
// PDF mínimo con texto (flujo Flate), para probar la lectura de documentos.
const REAL_PDF = 'JVBERi0xLjMKJZOMi54gUmVwb3J0TGFiIEdlbmVyYXRlZCBQREYgZG9jdW1lbnQgKG9wZW5zb3VyY2UpCjEgMCBvYmoKPDwKL0YxIDIgMCBSCj4+CmVuZG9iagoyIDAgb2JqCjw8Ci9CYXNlRm9udCAvSGVsdmV0aWNhIC9FbmNvZGluZyAvV2luQW5zaUVuY29kaW5nIC9OYW1lIC9GMSAvU3VidHlwZSAvVHlwZTEgL1R5cGUgL0ZvbnQKPj4KZW5kb2JqCjMgMCBvYmoKPDwKL0NvbnRlbnRzIDcgMCBSIC9NZWRpYUJveCBbIDAgMCA1OTUuMjc1NiA4NDEuODg5OCBdIC9QYXJlbnQgNiAwIFIgL1Jlc291cmNlcyA8PAovRm9udCAxIDAgUiAvUHJvY1NldCBbIC9QREYgL1RleHQgL0ltYWdlQiAvSW1hZ2VDIC9JbWFnZUkgXQo+PiAvUm90YXRlIDAgL1RyYW5zIDw8Cgo+PiAKICAvVHlwZSAvUGFnZQo+PgplbmRvYmoKNCAwIG9iago8PAovUGFnZU1vZGUgL1VzZU5vbmUgL1BhZ2VzIDYgMCBSIC9UeXBlIC9DYXRhbG9nCj4+CmVuZG9iago1IDAgb2JqCjw8Ci9BdXRob3IgKGFub255bW91cykgL0NyZWF0aW9uRGF0ZSAoRDoyMDI2MTEyNjEyMzc1Mi0wMycwMCcpIC9DcmVhdG9yIChhbm9ueW1vdXMpIC9LZXl3b3JkcyAoKSAvTW9kRGF0ZSAoRDoyMDI2MTEyNjEyMzc1Mi0wMycwMCcpIC9Qcm9kdWNlciAoUmVwb3J0TGFiIFBERiBMaWJyYXJ5IC0gXChvcGVuc291cmNlXCkpIAogIC9TdWJqZWN0ICh1bnNwZWNpZmllZCkgL1RpdGxlICh1bnRpdGxlZCkgL1RyYXBwZWQgL0ZhbHNlCj4+CmVuZG9iago2IDAgb2JqCjw8Ci9Db3VudCAxIC9LaWRzIFsgMyAwIFIgXSAvVHlwZSAvUGFnZXMKPj4KZW5kb2JqCjcgMCBvYmoKPDwKL0ZpbHRlciBbIC9GbGF0ZURlY29kZSBdIC9MZW5ndGggMTk4Cj4+CnN0cmVhbQp4nH2QMWvDMBBG9/yKb+hgB6JIFzmSuzm2SkRVK4grXbyFtiRgDCH/n0LskEJxlxse793BKUhIqNs89sCOsX5RUAT+gtJCgwMcL+5c3fhG0IOraUUhYaUE98g+fPsaXELwb56rpsrBZ/Dyb2DsGCTxLlg8w5TCEAm7lSsU89V2rNrIFRqHOrnGc4QLruYUW1//c1FPbUeGSM97NHr70/dl6D+vlwGpXuk9Dimiy0h3+Xw7vYEjVwFPKAsjCmt/+Vj8ADQDUrBlbmRzdHJlYW0KZW5kb2JqCnhyZWYKMCA4CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDA2MSAwMDAwMCBuIAowMDAwMDAwMDkyIDAwMDAwIG4gCjAwMDAwMDAxOTkgMDAwMDAgbiAKMDAwMDAwMDQwMiAwMDAwMCBuIAowMDAwMDAwNDcwIDAwMDAwIG4gCjAwMDAwMDA3MzEgMDAwMDAgbiAKMDAwMDAwMDc5MCAwMDAwMCBuIAp0cmFpbGVyCjw8Ci9JRCAKWzw1YmYxMTNhMjFlZjkxMjBhMjJlODNhOTJkMmNkODJhZT48NWJmMTEzYTIxZWY5MTIwYTIyZTgzYTkyZDJjZDgyYWU+XQolIFJlcG9ydExhYiBnZW5lcmF0ZWQgUERGIGRvY3VtZW50IC0tIGRpZ2VzdCAob3BlbnNvdXJjZSkKCi9JbmZvIDUgMCBSCi9Sb290IDQgMCBSCi9TaXplIDgKPj4Kc3RhcnR4cmVmCjEwNjMKJSVFT0YK';

const pages = {
  'https://www.banco.test/': `<title>Banco</title><h1>Resumen</h1><p>Saldo $ 223.477</p>
    <a href="/doc.pdf">Cartola PDF</a> <button id=b onclick="this.textContent='Listo'">Ver más</button>
    <input name=buscar placeholder="Busca nombre"> <input type=password id=pw2 style="display:none">
    <select id=s><option>20</option><option>50</option><option>100 filas</option></select>
    <iframe src="https://app.banco.test/mov" width=600 height=300></iframe>
    <iframe src="https://anuncios.test/x" width=100 height=50></iframe>`,
  'https://app.banco.test/mov': `<table><tr><td>26/11/26</td><td>Transferencia enviada a Biotecnos</td><td>- $ 296.989</td></tr>
    <tr><td>24/11/26</td><td>Transferencia recibida de Bioup</td><td>+ $ 126.200</td></tr></table>
    <button onclick="document.body.insertAdjacentHTML('beforeend','<p>Página 2 cargada</p>')">Siguiente</button>
    <iframe src="https://app.banco.test/inner"></iframe>`,
  'https://app.banco.test/inner': `<p>marco interior</p><input name=dato>`,
  'https://anuncios.test/x': `<p>publicidad</p><form><input name=usuario><input type=password name=p><button type=submit>Entrar</button></form>`,
  'https://www.banco.test/login': `<title>Ingreso</title><form action="/dentro" method="get"><input name=rut placeholder="RUT"><input type=password name=clave><button type=submit>Ingresar</button></form>`,
  'https://www.banco.test/dentro': `<title>Dentro</title><p id=q></p><script>document.getElementById('q').textContent=location.search</script>`,
  'https://www.banco.test/login2': `<title>Ingreso en marco</title><iframe src="https://login.banco.test/f" width=400 height=200></iframe><iframe src="https://anuncios.test/x"></iframe>`,
  'https://login.banco.test/f': `<form onsubmit="event.preventDefault();document.title='ENVIADO '+this.u.value+' '+this.p.value.length"><input name=u><input type=password name=p><input type=submit value="Entrar"></form>`,
  'https://malo.test/': `<title>Falso</title><form><input name=rut><input type=password name=clave><button>Ingresar</button></form>`,
  'https://www.sii.test/doc': `<title>Documento emitido</title><p>Factura 536</p><iframe src="/pdf?CODIGO=1" type="application/pdf" width=300 height=200></iframe>`,
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  await ctx.addInitScript({ path: JS });
  const page = await ctx.newPage();
  await ctx.route('**/*', async (route) => {
    const req = route.request();
    const url = req.url();
    if (url.includes('/real.pdf')) {
      return route.fulfill({ status: 200, contentType: 'application/pdf', body: Buffer.from(REAL_PDF, 'base64') });
    }
    if (url.includes('/doc.pdf') || url.includes('/pdf?')) {
      return route.fulfill({ status: 200, contentType: 'application/pdf', headers: { 'content-disposition': 'inline; filename="77334963.pdf"' }, body: Buffer.from('%PDF-1.4 contenido de prueba') });
    }
    const key = url.split('?')[0];
    if (pages[key]) return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset=utf-8>' + pages[key] });
    return route.fulfill({ status: 404, body: 'no' });
  });
  let seq = 0;
  const run = async (cmd, ms = 6000) => {
    const id = 'q' + (++seq);
    assert.equal(await page.evaluate((c) => window.__nucleoWeb.run(c), { id, ...cmd }), 'ok');
    const t0 = Date.now();
    for (;;) {
      const n = await page.evaluate((i) => window.__nucleoWeb ? window.__nucleoWeb.size(i) : -2, id).catch(() => -3);
      if (n >= 0) {
        let out = '';
        for (let a = 0; a < n; a += 7) out += await page.evaluate(([i, x, y]) => window.__nucleoWeb.part(i, x, y), [id, a, a + 7]);
        await page.evaluate((i) => window.__nucleoWeb.done(i), id);
        assert.ok(/^[\x00-\x7f]*$/.test(out), 'solo ASCII');
        return JSON.parse(out);
      }
      if (Date.now() - t0 > ms) throw new Error('sin respuesta: ' + JSON.stringify(cmd));
      await new Promise(r => setTimeout(r, 20));
    }
  };
  const find = (snap, label) => { for (const f of snap.frames) for (const c of f.controls) if (c.l.includes(label)) return c; throw new Error('no está ' + label); };

  // 1. Leer con marcos de otro origen y anidados.
  await page.goto('https://www.banco.test/');
  await page.waitForTimeout(300);
  let s = await run({ op: 'leer' });
  assert.equal(s.frames.length, 4, JSON.stringify(s.frames.map(f => f.path)));
  assert.ok(s.frames[0].text.includes('Saldo $ 223.477'));
  const mov = s.frames.find(f => f.href.includes('/mov'));
  assert.ok(mov.text.includes('Transferencia enviada a Biotecnos') && mov.text.includes('- $ 296.989'), mov.text);
  assert.ok(s.frames.some(f => f.text.includes('marco interior')));
  const nums = s.frames.flatMap(f => f.controls.map(c => c.n));
  assert.deepEqual(nums, nums.map((_, i) => i + 1));
  assert.ok(!s.frames[0].controls.some(c => c.k === 'clave'), 'la clave oculta no se lista');
  console.log('1 leer ok ·', s.frames.map(f => `${f.path || 'top'}:${f.controls.length}`).join(' '));

  // 2. Clic en un control de un marco de otro origen.
  let r = await run({ op: 'clic', ref: find(s, 'Siguiente').n });
  assert.ok(r.ok, JSON.stringify(r));
  await page.waitForTimeout(400);
  s = await run({ op: 'leer' });
  assert.ok(s.frames.find(f => f.href.includes('/mov')).text.includes('Página 2 cargada'));
  r = await run({ op: 'clic', ref: find(s, 'Ver más').n });
  await page.waitForTimeout(300);
  s = await run({ op: 'leer' });
  assert.ok(find(s, 'Listo'));
  // 3. Escribir y elegir; una referencia vieja se rechaza.
  r = await run({ op: 'escribir', ref: find(s, 'Busca nombre').n, texto: 'Winkler' });
  assert.ok(r.ok);
  r = await run({ op: 'elegir', ref: s.frames[0].controls.find(c => c.k === 'lista').n, opcion: '100' });
  assert.ok(r.ok.includes('100 filas'), JSON.stringify(r));
  s = await run({ op: 'leer' });
  assert.equal(find(s, 'Busca nombre').v, 'Winkler');
  assert.equal(s.frames[0].controls.find(c => c.k === 'lista').v, '100 filas');
  r = await run({ op: 'clic', ref: 999 });
  assert.ok(r.error);
  console.log('2-3 clic, escribir, elegir ok');

  // 4. Guardar un archivo por enlace y el documento incrustado.
  r = await run({ op: 'guardar', ref: find(s, 'Cartola PDF').n });
  assert.ok(r.file && r.file.pdf && r.file.suggested === '77334963.pdf', JSON.stringify(r).slice(0, 200));
  assert.equal(Buffer.from(r.file.b64, 'base64').toString(), '%PDF-1.4 contenido de prueba');
  await page.goto('https://www.sii.test/doc');
  await page.waitForTimeout(300);
  r = await run({ op: 'guardar' });
  assert.ok(r.file && r.file.pdf && r.file.size === 28, JSON.stringify(r).slice(0, 200));
  r = await run({ op: 'guardar', url: 'http://www.sii.test/x.pdf' });
  assert.ok(r.error);
  r = await run({ op: 'guardar', url: 'https://www.sii.test/real.pdf' });
  assert.ok(r.file.pdf && /WINKLER LIMITADA\nR\.U\.T\.: 79\.722\.860- 5\nNOTA DE CREDITO ELECTRONICA/.test(r.file.text), JSON.stringify(r.file.text));
  assert.ok(r.file.text.includes('TOTAL $ 957.588'));
  console.log('4 guardar ok');

  // 5. Ingreso: formulario en la página.
  await page.goto('https://www.banco.test/login');
  r = await run({ op: 'rellenar', site: 'banco.test', usuario: '11111111-1', clave: 'secreta', enviar: true });
  assert.deepEqual(r, { usuario: true, clave: true, enviado: true });
  await page.waitForURL('**/dentro**');
  assert.ok((await page.textContent('#q')).includes('rut=11111111-1&clave=secreta'));
  // 5b. Formulario en un marco de otro origen del mismo sitio; el marco de otro sitio no recibe nada.
  await page.goto('https://www.banco.test/login2');
  await page.waitForTimeout(400);
  r = await run({ op: 'rellenar', site: 'banco.test', usuario: 'u1', clave: 'secreta', enviar: true });
  assert.deepEqual(r, { usuario: true, clave: true, enviado: true });
  await page.waitForTimeout(400);
  const fr = page.frames().find(f => f.url().includes('login.banco.test'));
  assert.equal(await fr.title(), 'ENVIADO u1 7');
  const ad = page.frames().find(f => f.url().includes('anuncios.test'));
  assert.equal(await ad.evaluate(() => document.querySelector('input[type=password]').value), '');
  // 5c. Una página de otro sitio no recibe la clave.
  await page.goto('https://malo.test/');
  r = await run({ op: 'rellenar', site: 'banco.test', usuario: 'u1', clave: 'secreta', enviar: true });
  assert.ok(r.error, JSON.stringify(r));
  assert.equal(await page.evaluate(() => document.querySelector('input[type=password]').value), '');
  // 5d. Página permitida sin formulario propio y con un marco ajeno que sí tiene: nada se rellena.
  await page.goto('https://www.banco.test/');
  await page.waitForTimeout(300);
  r = await run({ op: 'rellenar', site: 'banco.test', usuario: 'u1', clave: 'secreta', enviar: true });
  assert.deepEqual(r, { usuario: false, clave: false, enviado: false });
  const ad2 = page.frames().find(f => f.url().includes('anuncios.test'));
  assert.equal(await ad2.evaluate(() => document.querySelector('input[type=password]').value), '');
  // 5e. Las claves no se escriben a mano.
  await page.goto('https://www.banco.test/login');
  s = await run({ op: 'leer' });
  r = await run({ op: 'escribir', ref: s.frames[0].controls.find(c => c.k === 'clave').n, texto: 'x' });
  assert.ok(r.error && r.error.includes('NÚCLEO'));
  console.log('5 ingreso ok');

  await browser.close();
  console.log('TODO OK');
})().catch(e => { console.error('FALLÓ:', e.message); process.exit(1); });
