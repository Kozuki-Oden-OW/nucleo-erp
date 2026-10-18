// 00 · Tráiler del canal
const { Recorder, sleep } = require('./engine.cjs');

(async () => {
  const r = new Recorder('00');
  const p = () => r.page;
  await r.start();
  await r.go('/inicio', 1500);
  await r.rec();

  await r.say('¿Llevas tu negocio entre un Excel, un cuaderno, la app del banco y la página del SII?', async () => {
    await sleep(600); await r.moveTo({ x: 700, y: 250 }, { ms: 1500 });
  });
  await r.say('Esto es NÚCLEO ERP: todo tu negocio, en un solo programa.', async () => {
    await r.moveTo('aside >> text=Inicio', { ms: 700 });
    await r.moveTo('aside >> text=Análisis y reportes', { ms: 1600 });
  });
  await r.say('Vendes y cotizas…', async () => {
    await r.click('aside >> text=Vender', { wait: 1300 });
  });
  await r.say('…controlas tu stock…', async () => {
    await r.click('aside >> text=Inventario', { wait: 1300 });
  });
  await r.say('…y sabes cuánto te deben, cuánto debes, y cuánta plata vas a tener.', async () => {
    await r.click('aside >> text=Dinero', { wait: 1200 });
    const svg = p().locator('main svg[aria-label^="Proyección del saldo"]'); const b = await svg.boundingBox();
    if (b) await r.moveTo({ x: b.x + b.width * 0.4, y: b.y + b.height * 0.5 }, { ms: 900 });
  });
  await r.say('Subes la cartola del banco, y se cuadra sola.', async () => {
    await r.click('main >> text="Conciliación bancaria"', { wait: 600 });
    const [fc] = await Promise.all([p().waitForEvent('filechooser'), r.click('main button:has-text("Subir cartola") >> nth=0', { wait: 100 })]);
    await fc.setFiles(require('path').join(__dirname, 'cartola_octubre.csv')); await sleep(700);
    await r.click('[role="dialog"] button:has-text("Subir")', { wait: 900 });
  });
  await r.say('Te prepara el IVA del mes, y te lleva la contabilidad, sin que tengas que saber de contabilidad.', async () => {
    await r.click('aside >> text=Impuestos', { wait: 1300 });
    await r.moveTo('main >> text="Total a pagar"', { dy: 30, ms: 900 }); await sleep(600);
    await r.click('main >> text="Contabilidad"', { wait: 1200 });
  });
  await r.say('Liquidaciones de sueldo, y hasta el costo real de importar.', async () => {
    await r.click('aside >> text=Remuneraciones', { wait: 1500 });
    await r.click('aside >> text=COMEX', { wait: 700 });
    await r.click('main >> text="Calculadora de importación"', { wait: 1200 });
  });
  await r.say('Y lo más importante: tus datos quedan en tu computador. Nadie más ve cuánto vendes.', async () => {
    await r.click('aside >> text=Inicio', { wait: 1200 });
    await r.moveTo('main >> text="Ventas" >> nth=0', { dy: 30, ms: 900 }); await sleep(700);
    await r.moveTo('main >> text="Utilidad" >> nth=0', { dy: 30, ms: 800 });
  });
  await r.say('En este canal te muestro cada módulo, paso a paso, en videos cortos.', async () => {
    await r.moveTo({ x: 900, y: 400 }, { ms: 1400 });
  });
  await r.say('Suscríbete, y descárgalo gratis en nucleoerp.cl. Todo tu negocio. Un solo núcleo.', async () => {
    await r.moveTo({ x: 760, y: 300 }, { ms: 1200 });
  });

  await r.stop();
})().catch((e) => { console.error(e); process.exit(1); });
