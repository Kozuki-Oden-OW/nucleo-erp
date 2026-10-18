// 06 · Gastos y punto de equilibrio
const { Recorder, sleep } = require('./engine.cjs');

(async () => {
  const r = new Recorder('06');
  const p = () => r.page;
  await r.start();
  await r.go('/gastos', 1500);
  await r.rec();

  await r.say('¿Cuánto tienes que vender al mes solo para no perder plata? Hoy lo calculamos.', async () => {
    await sleep(700); await r.moveTo({ x: 700, y: 180 }, { ms: 1200 });
  });
  await r.say('En Gastos ves cuánto llevas gastado este mes, cuánto gastas en un mes normal, y en qué se te va el dinero.', async () => {
    await r.moveTo('main >> text="Gastado este mes"', { dy: 25, ms: 900 }); await sleep(1000);
    await r.moveTo('main >> text="Gastos al mes"', { dy: 25, ms: 700 }); await sleep(1000);
    await r.moveTo('main >> text=¿En qué se va el dinero?', { dy: 60, ms: 900 });
  });
  await r.say('Para anotar uno, aprietas Registrar gasto. O más rápido, con estos botones: bencina, comida, arriendo, publicidad…', async () => {
    await r.moveTo('main button:has-text("Registrar gasto")', { ms: 800 }); await sleep(900);
    await r.moveTo('main button:has-text("Bencina")', { ms: 800 }); await sleep(500);
    await r.moveTo('main button:has-text("Arriendo")', { ms: 800 }); await sleep(400);
    await r.click('main button:has-text("Publicidad")', { wait: 1000 });
  });
  await r.say('Escribes en qué gastaste, el valor, y si ese valor incluye IVA.', async () => {
    const d = p().getByLabel('¿En qué gastaste?');
    await r.click(d, { wait: 200 });
    await p().keyboard.press('Control+A');
    await r.type('Avisos en Instagram', 70); await sleep(300);
    await r.click(p().getByLabel('Valor', { exact: true }), { wait: 200 });
    await r.type('25000', 150); await sleep(400);
    await r.moveTo('[role="dialog"] >> text=El valor incluye IVA', { ms: 700 });
  });
  await r.say('Marcas si ya lo pagaste, o si queda por pagar. Si queda pendiente, aparece en lo que debes, con su fecha de vencimiento.', async () => {
    const dlg = p().locator('[role="dialog"]').last();
    await dlg.locator('text="No, queda por pagar"').scrollIntoViewIfNeeded();
    await r.click('[role="dialog"] >> text="No, queda por pagar"', { wait: 1500 });
    await r.click('[role="dialog"] >> text="Sí, ya lo pagué"', { wait: 700 });
  });
  await r.say('Lo registras, y queda guardado, con el IVA separado si tienes la factura.', async () => {
    await r.click('[role="dialog"] button:has-text("Registrar gasto")', { wait: 1300 });
    await r.moveTo('main >> text="IVA crédito (estimado)"', { ms: 900 });
  });
  await r.say('Los gastos que se repiten todos los meses, como el arriendo o los sueldos, los dejas en Gastos fijos. El programa te los recuerda y los usa para proyectar tu caja.', async () => {
    await r.click('aside >> text=Gastos', { wait: 1300 });
    await r.click('main >> text="Gastos fijos"', { wait: 1000 });
    await r.moveTo('main >> text=Arriendo del local', { ms: 900 }); await sleep(1300);
    await r.moveTo('main >> text=/^Sueldos/', { ms: 800 });
  });
  await r.say('En Categorías y presupuesto le pones un tope mensual a cada tipo de gasto, y el programa te avisa si te pasas.', async () => {
    await r.click('main >> text="Categorías y presupuesto"', { wait: 1000 });
    await r.click('main tr:has-text("Combustible") button', { wait: 900 });
    await r.click(p().getByLabel('Presupuesto mensual'), { wait: 200 });
    await r.type('80000', 150); await sleep(400);
    await r.click('[role="dialog"] button:has-text("Guardar")', { wait: 1100 });
  });
  await r.say('Y ahora lo mejor: ¿cuánto necesito vender?', async () => {
    await r.click('main >> text=¿Cuánto necesito vender?', { wait: 1200 });
  });
  await r.say('Con tus gastos de un mes y el margen que te dejan tus ventas, te dice cuánto tienes que vender para quedar en cero. Ese es tu punto de equilibrio.', async () => {
    await r.moveTo('main >> text="Gastos al mes"', { dy: 30, ms: 900 }); await sleep(1100);
    await r.moveTo('main >> text="Margen sobre la venta"', { dy: 30, ms: 700 }); await sleep(1100);
    await r.highlightCard('Para no perder');
    await r.moveTo('main >> text="Para no perder"', { dy: 30, ms: 800 }); await sleep(2200);
    await r.unhighlight();
  });
  await r.say('También te lo divide por semana y por día de venta, para que tengas una meta concreta.', async () => {
    await r.moveTo('main >> text="Por semana"', { dy: 30, ms: 900 }); await sleep(1000);
    await r.moveTo('main >> text="Por día de venta"', { dy: 30, ms: 800 });
  });
  await r.say('Y si además quieres ganar algo, pones la utilidad que quieres al mes, y recalcula al tiro.', async () => {
    const u = p().getByLabel('Utilidad que quieres al mes');
    await r.click(u, { wait: 200 });
    await p().keyboard.press('Control+A');
    await r.type('1000000', 130); await sleep(700);
    await r.moveTo('main >> text="Para tu meta"', { dy: 30, ms: 900 });
  }, { after: 1500 });
  await r.say('Más abajo ves cómo vas: cuánto vendes hoy en promedio, y cuánto te falta para llegar.', async () => {
    await r.scroll(380);
    await r.moveTo('main >> text=¿Cómo vas?', { dy: 50, ms: 900 });
  });
  await r.say('Ya sabes tu meta del mes. Descárgalo gratis en nucleoerp.cl.', async () => {
    await r.moveTo({ x: 760, y: 300 }, { ms: 1200 });
  });

  await r.stop();
})().catch((e) => { console.error(e); process.exit(1); });
