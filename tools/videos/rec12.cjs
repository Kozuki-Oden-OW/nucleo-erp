// 12 · Remuneraciones
const { Recorder, sleep } = require('./engine.cjs');

(async () => {
  const r = new Recorder('12');
  const p = () => r.page;
  await r.start();
  await r.go('/remuneraciones', 1500);
  await r.rec();

  await r.say('Tener tu primer trabajador da susto. Hagamos su liquidación de sueldo juntos.', async () => {
    await sleep(700); await r.moveTo({ x: 700, y: 200 }, { ms: 1200 });
  });
  await r.say('Primero, cada mes revisas los indicadores: la UF, la UTM y el sueldo mínimo. El programa te los propone, y tú los guardas.', async () => {
    await r.click('main >> text="Indicadores del mes"', { wait: 1000 });
    for (const t of ['UF del último día del mes', 'UTM del mes', 'Ingreso mínimo mensual']) { await r.moveTo(p().getByLabel(t), { ms: 700 }); await sleep(800); }
    await r.scroll(2500, 1200);
    await r.click('main button:has-text("Guardar indicadores")', { wait: 1000 });
  });
  await r.say('En Personas está cada trabajador, con su sueldo, su contrato, su AFP y su salud.', async () => {
    await r.scroll(-3000, 400);
    await r.click('main >> text="Personas"', { wait: 1000 });
    await r.moveTo('main >> text="Diego Fuentes Lagos"', { dy: 12, ms: 900 });
  });
  await r.say('Ahí mismo configuras la gratificación, la colación y la movilización.', async () => {
    const row = p().locator('main :text("Diego Fuentes Lagos")').first().locator('xpath=ancestor::*[.//button][1]');
    await r.click(row.locator('button:has-text("Editar")'), { wait: 1100 });
    await r.moveTo(p().getByLabel('Gratificación'), { ms: 800 }); await sleep(1200);
    await r.key('Escape');
  });
  await r.say('En Liquidaciones del mes, el programa ya calculó a cada uno.', async () => {
    await r.click('main >> text="Liquidaciones del mes"', { wait: 1000 });
    await r.moveTo('main tr:has-text("Camila") >> text=/\\$1\\.4/', { ms: 800 }); await sleep(600);
    await r.moveTo('main tr:has-text("Diego") >> text=/\\$7\\d\\d\\./', { ms: 700 });
  });
  await r.say('Abres la de Diego y ves todo: el sueldo, la gratificación legal, los descuentos de AFP, salud y cesantía, y el impuesto único.', async () => {
    await r.click('main tr:has-text("Diego")', { wait: 1300 });
    for (const t of ['Sueldo base', 'Gratificación legal (art. 50)', 'AFP Uno', 'Salud (Fonasa)', 'Seguro de cesantía', 'Impuesto único']) { await r.moveTo(`main >> text="${t}"`, { ms: 550 }); await sleep(450); }
  });
  await r.say('Si este mes hubo un bono, horas extra o un anticipo, lo agregas aquí, y se recalcula al tiro.', async () => {
    await r.click('main button:has-text("Bono")', { wait: 600 });
    await r.click(p().getByLabel('Monto').last(), { wait: 200 });
    await r.type('50000', 150); await sleep(800);
    await r.moveTo('main >> text="Total haberes" >> nth=0', { dx: 120, ms: 800 });
  });
  await r.say('Abajo está el líquido a pagar, y lo que te cuesta de verdad, con los aportes del empleador.', async () => {
    await r.scroll(450, 900);
    await r.moveTo('main >> text="Líquido a pagar"', { dx: 150, ms: 800 }); await sleep(1100);
    await r.moveTo('main >> text="Costo para la empresa"', { dy: 30, ms: 800 });
  });
  await r.say('Guardas, y la emites, eligiendo la fecha de pago.', async () => {
    await r.scroll(-900, 500);
    const save = p().locator('main button:has-text("Guardar")').first();
    if (await save.count()) await r.click(save, { wait: 900 });
    await r.click('main button:has-text("Emitir")', { wait: 900 });
    await r.moveTo(p().getByLabel('Fecha de pago'), { ms: 600 }); await sleep(500);
    await r.click('[role="dialog"] button:has-text("Emitir")', { wait: 1300 });
  });
  await r.say('Y la imprimes, para que el trabajador la firme.', async () => {
    await r.click('main button:has-text("Imprimir")', { wait: 2000 });
    await r.key('Escape');
  });
  await r.say('En Previred y libro tienes el resumen de cotizaciones para pagar en Previred, y el Libro de Remuneraciones Electrónico para la Dirección del Trabajo.', async () => {
    await r.click('main >> text=Remuneraciones >> nth=0', { wait: 1100 });
    await r.click('main >> text="Previred y libro"', { wait: 1100 });
    await r.moveTo({ x: 900, y: 450 }, { ms: 800 }); await sleep(800);
    await r.moveTo('main >> text="Libro de Remuneraciones Electrónico"', { ms: 800 });
  });
  await r.say('Y el impuesto único se pasa solo a tu Formulario 29. Revisa los montos con tu contador la primera vez. Descárgalo gratis en nucleoerp.cl.', async () => {
    await r.moveTo({ x: 760, y: 300 }, { ms: 1200 });
  });

  await r.stop();
})().catch((e) => { console.error(e); process.exit(1); });
