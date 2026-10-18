// 13 · Renta anual (F22)
const { Recorder, sleep } = require('./engine.cjs');

(async () => {
  const r = new Recorder('13');
  const p = () => r.page;
  await r.start();
  await r.go('/contabilidad', 1500);
  await r.rec();

  await r.say('Llega abril y todos corren con la renta. Tú vas a llegar con todo listo.', async () => {
    await sleep(700); await r.moveTo({ x: 700, y: 180 }, { ms: 1200 });
  });
  await r.say('En Renta anual eliges el año comercial. Mientras el año no termina, te muestra una proyección con lo registrado hasta hoy.', async () => {
    await r.click('main >> text="Renta anual (F22)"', { wait: 1200 });
    await r.moveTo(p().getByLabel('Año comercial'), { ms: 800 }); await sleep(1100);
    await r.moveTo('main >> text=/Proyección/ >> nth=0', { ms: 700 });
  });
  await r.say('Arriba te avisa lo que falta para que el cálculo quede completo, como meses con el PPM sin declarar.', async () => {
    await r.highlightCard('Revisa');
    await r.moveTo('main >> text="Revisa"', { dx: 200, dy: 20, ms: 900 }); await sleep(2200);
    await r.unhighlight();
  });
  await r.say('El programa suma lo que entró y salió en el año: tus ingresos, las remuneraciones, los arriendos y otros gastos, cada uno con su código.', async () => {
    for (const t of ['Ingresos del giro percibidos', 'Remuneraciones pagadas', 'Arriendos pagados', 'Otros gastos deducibles']) { await r.moveTo(`main >> text="${t}"`, { ms: 600 }); await sleep(800); }
  });
  await r.say('Si tu contador sabe que un monto es distinto, lo cambia aquí, en la columna Usado.', async () => {
    await r.moveTo('main tr:has-text("Arriendos pagados") input', { ms: 800 });
  });
  await r.say('A la derecha completas los datos del año, con los valores que publica el SII, en un clic.', async () => {
    await r.scroll(400, 700);
    await r.click('main button:has-text("Usar valores del paquete normativo")', { wait: 1200 });
  });
  await r.say('Y te muestra el resultado estimado: la base imponible, el impuesto, y le descuenta los PPM que pagaste durante el año.', async () => {
    await r.scroll(-600, 600);
    for (const t of ['Base imponible (18)', 'Impuesto de primera categoría', '− PPM reajustados (36)']) { await r.moveTo(`main >> text="${t}"`, { ms: 700 }); await sleep(900); }
  });
  await r.say('Los PPM se toman solos de tus Formularios 29 declarados, mes a mes, ya reajustados.', async () => {
    await r.scroll(900, 1200);
    await r.moveTo('main >> text="Pagos provisionales mensuales (PPM)"', { dy: 60, ms: 900 });
  });
  await r.say('Con Copiar códigos le mandas todo ordenado a tu contador.', async () => {
    await r.scroll(-1500, 600);
    await r.click('main button:has-text("Copiar códigos")', { wait: 1300 });
  });
  await r.say('Es una preparación para que llegues ordenado; la declaración final la revisas con tu contador o con la propuesta del SII. Descárgalo gratis en nucleoerp.cl.', async () => {
    await r.moveTo({ x: 760, y: 300 }, { ms: 1200 });
  });

  await r.stop();
})().catch((e) => { console.error(e); process.exit(1); });
