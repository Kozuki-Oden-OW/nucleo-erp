// 11 · Análisis y reportes
const { Recorder, sleep } = require('./engine.cjs');

(async () => {
  const r = new Recorder('11');
  const p = () => r.page;
  await r.start();
  await r.go('/analisis', 1500);
  await r.rec();

  await r.say('Probablemente unos pocos productos te dejan casi toda la ganancia. ¿Sabes cuáles son?', async () => {
    await sleep(700); await r.moveTo({ x: 700, y: 200 }, { ms: 1200 });
  });
  await r.say('En Análisis y reportes, en Productos, ves qué se vende, cuánto margen deja, y qué está detenido.', async () => {
    await r.click('main >> text="Productos"', { wait: 1100 });
    for (const t of ['Venta neta del período', 'Margen del período', 'Capital detenido']) { await r.moveTo(`main >> text="${t}"`, { dy: 28, ms: 700 }); await sleep(900); }
  });
  await r.say('Cada producto se clasifica solo: A, B o C, según cuánto te deja. Y además te dice si es estrella, si mueve volumen, o si hay que revisarlo.', async () => {
    await r.moveTo('main >> text="ABC"', { dy: 36, ms: 800 }); await sleep(1200);
    await r.moveTo('main button:has-text("Estrella")', { ms: 700 }); await sleep(900);
    await r.moveTo('main button:has-text("Mueve volumen")', { ms: 600 }); await sleep(900);
    await r.moveTo('main button:has-text("Revisar")', { ms: 600 });
  });
  await r.say('Haces clic en uno, y te explica por qué está ahí. Este vende mucho, pero deja poco margen: hay que revisar su costo o su precio.', async () => {
    await r.click('main [role=row] >> nth=1', { wait: 1100 });
    await r.moveTo('[role="dialog"] >> text=¿Por qué?', { dy: 25, ms: 800 });
  }, { after: 1500 });
  await r.say('También ves cómo le ha ido en los últimos doce meses, y si va creciendo, cayendo, o se quedó detenido.', async () => {
    await r.moveTo('[role="dialog"] >> text="Últimos 12 meses"', { dy: 90, ms: 800 }); await sleep(1500);
    await r.key('Escape');
    await r.moveTo('main button:has-text("Creciendo")', { ms: 700 }); await sleep(600);
    await r.moveTo('main button:has-text("Cayendo")', { ms: 600 }); await sleep(600);
    await r.moveTo('main button:has-text("Detenidos")', { ms: 600 });
  });
  await r.say('En Clientes pasa lo mismo: quién te compra más, quién te debe, y quién está en riesgo de irse.', async () => {
    await r.click('main >> text="Clientes"', { wait: 1100 });
    await r.moveTo('main >> text="Clientes activos"', { dy: 28, ms: 700 }); await sleep(800);
    await r.moveTo('main >> text="En riesgo" >> nth=0', { dy: 28, ms: 700 });
  });
  await r.say('El programa conoce la costumbre de cada cliente. Si alguien que te compraba cada seis días lleva un mes sin aparecer, te lo marca.', async () => {
    const row = p().locator('main [role=row]:has-text("En riesgo")').first();
    await r.moveTo(row.locator('text="En riesgo"'), { ms: 900 }); await sleep(1200);
    await r.moveTo(row.locator('text=/hace \\d+ d/'), { ms: 700 });
  });
  await r.say('A ese cliente lo llamas hoy, antes de perderlo.', async () => {
    await r.click(p().locator('main [role=row]:has-text("En riesgo")').first(), { wait: 1200 });
  });
  await r.say('Y en Reportes tienes los informes de siempre: ventas, rentabilidad, compras, gastos, inventario…', async () => {
    await r.key('Escape');
    await r.click('main >> text="Reportes"', { wait: 1000 });
    for (const t of ['Ventas por período', '¿Gano o pierdo? (utilidad)', 'Compras por proveedor', 'Gastos por categoría']) { await r.moveTo(`main >> text="${t}"`, { ms: 600 }); await sleep(600); }
  });
  await r.say('Eliges uno, por ejemplo Ventas por producto, y el período que quieras.', async () => {
    await r.scroll(-300, 300);
    await r.click('main >> text="Ventas por producto"', { wait: 1200 });
    await r.moveTo(p().getByLabel('Período'), { ms: 700 });
  });
  await r.say('Y lo exportas a Excel con un clic, para tu contador, tu socio o el banco.', async () => {
    await r.click('main button:has-text("Exportar a Excel")', { wait: 1300 });
  });
  await r.say('Decide con datos, no con intuición. Descárgalo gratis en nucleoerp.cl.', async () => {
    await r.moveTo({ x: 760, y: 300 }, { ms: 1200 });
  });

  await r.stop();
})().catch((e) => { console.error(e); process.exit(1); });
