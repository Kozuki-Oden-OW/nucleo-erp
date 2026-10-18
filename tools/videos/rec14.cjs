// 14 · NÚCLEO COMEX
const { Recorder, sleep } = require('./engine.cjs');

(async () => {
  const r = new Recorder('14');
  const p = () => r.page;
  await r.start();
  await r.go('/comex', 1500);
  await r.rec();

  await r.say('Tu proveedor en China te cobra veintiún dólares y medio por un taladro. ¿Cuánto te cuesta de verdad, puesto en tu bodega?', async () => {
    await sleep(700); await r.moveTo({ x: 700, y: 200 }, { ms: 1200 });
  });
  await r.say('En COMEX, Calculadora de importación, pones el producto, la cantidad, y el precio FOB en dólares.', async () => {
    await r.click('main >> text="Calculadora de importación"', { wait: 1200 });
    await r.moveTo('main input[aria-label="Producto"]', { ms: 700 }); await sleep(700);
    await r.moveTo('main >> text="Cantidad"', { dy: 32, ms: 600 }); await sleep(700);
    await r.moveTo('main >> text="FOB unitario"', { dy: 32, ms: 600 });
  });
  await r.say('Eliges cómo llega: con agente de aduana, por courier, o comprando en una plataforma.', async () => {
    await r.moveTo('main >> text="Con agente de aduana"', { ms: 800 }); await sleep(700);
    await r.moveTo('main button:has-text("Courier") >> nth=-1', { ms: 600 }); await sleep(600);
    await r.moveTo('main >> text="Plataforma"', { ms: 600 });
  });
  await r.say('Pones el tipo de cambio, el flete y el seguro, y con eso se arma el valor aduanero, el CIF.', async () => {
    await r.scroll(420, 900);
    for (const t of [/Tipo de cambio/, /Flete internacional/, /^Seguro \(/]) { await r.moveTo(p().getByLabel(t), { ms: 650 }); await sleep(700); }
    await r.moveTo('main >> text="= Valor aduanero (CIF)"', { ms: 800 });
  });
  await r.say('Después, el arancel y el IVA de importación. Si recuperas el IVA como crédito, no suma a tu costo.', async () => {
    await r.moveTo(p().getByLabel(/Arancel/), { ms: 700 }); await sleep(800);
    await r.moveTo(p().getByLabel(/IVA de importación/), { ms: 600 }); await sleep(800);
    await r.moveTo('main >> text="Recupero el IVA como crédito"', { ms: 700 });
  });
  await r.say('Y lo que casi todos olvidan: el agente de aduana, los gastos del puerto, el transporte hasta tu bodega, y la comisión del banco.', async () => {
    for (const t of ['Agente de aduana', 'Gastos portuarios y almacenaje', 'Transporte a tu bodega', 'Gastos bancarios']) { await r.moveTo(p().getByLabel(t), { ms: 600 }); await sleep(750); }
  });
  await r.say('Ahí tienes el costo total, y lo que te cuesta de verdad cada taladro, en pesos.', async () => {
    await r.highlightCard('Costo puesto en bodega');
    await r.moveTo('main >> text="Costo total"', { dx: 120, ms: 800 }); await sleep(1500); await r.unhighlight();
    await r.moveTo('main >> text="Costo unitario real"', { dx: 120, ms: 700 });
  });
  await r.say('Pones el margen que quieres ganar, y te sugiere el precio de venta.', async () => {
    const m = p().getByLabel(/Margen que quieres ganar/);
    await r.click(m, { wait: 200 }); await p().keyboard.press('Control+A'); await r.type('40', 180); await sleep(700);
    await r.moveTo('main >> text="Precio neto sugerido"', { dx: 120, ms: 700 });
  });
  await r.say('Y puedes comparar escenarios: marítimo, aéreo o courier. El programa te marca cuál sale más barato, y cuánto más cuesta cada otro.', async () => {
    await r.scroll(500, 900);
    await r.moveTo('main >> text="Comparación de escenarios"', { dy: 60, ms: 800 }); await sleep(900);
    await r.moveTo('main >> text="El más barato"', { ms: 700 }); await sleep(900);
    await r.moveTo('main tr:has-text("B · Aéreo") >> text=/^\\+ \\$/', { ms: 700 });
  });
  await r.say('¿Dudas con los Incoterms? En esta pestaña te explica cada uno: quién paga qué, y dónde pasa el riesgo.', async () => {
    await r.scroll(-1500, 600);
    await r.click('main >> text="Incoterms" >> nth=0', { wait: 1000 });
    await r.click('main >> text="Costo, seguro y flete"', { wait: 1200 });
    await r.click('main >> text="En fábrica"', { wait: 1000 });
  });
  await r.say('Si decides importar, creas la carpeta, y la sigues en Importaciones hasta que llega. Al recibirla, el stock entra con su costo real.', async () => {
    await r.click('main >> text="Importaciones" >> nth=0', { wait: 1000 });
    await r.moveTo('main [role=row] >> nth=1', { ms: 800 }); await sleep(800);
    await r.moveTo('main >> text="En tránsito"', { ms: 600 });
  });
  await r.say('Importa con números, no con fe. Descárgalo gratis en nucleoerp.cl.', async () => {
    await r.moveTo({ x: 760, y: 300 }, { ms: 1200 });
  });

  await r.stop();
})().catch((e) => { console.error(e); process.exit(1); });
