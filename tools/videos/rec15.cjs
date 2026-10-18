// 15 · Promociones y envíos
const { Recorder, sleep } = require('./engine.cjs');

const ddmmyyyy = (days) => {
  const d = new Date(Date.now() + days * 86400000);
  const s = d.toLocaleDateString('en-CA', { timeZone: 'America/Santiago' }); // aaaa-mm-dd
  return s.slice(8, 10) + s.slice(5, 7) + s.slice(0, 4);
};

(async () => {
  const r = new Recorder('15');
  const p = () => r.page;
  await r.start();
  await r.go('/promociones', 1500);
  await r.rec();

  await r.say('¿Cyber, Día de la Madre, una liquidación? Arma tu promoción sin tener que cambiar cada precio.', async () => {
    await sleep(700); await r.moveTo({ x: 700, y: 200 }, { ms: 1200 });
  });
  await r.say('En Descuentos y promociones ves las que tienes: activas, programadas, pausadas o vencidas.', async () => {
    for (const t of ['Activas', 'Programadas', 'Pausadas y vencidas']) { await r.moveTo(`main >> text="${t}"`, { ms: 600 }); await sleep(600); }
    await r.moveTo('main >> text=/Guantes/', { ms: 700 });
  });
  await r.say('Hay de varios tipos: packs, descuentos por cantidad, lleva tres y paga dos, o precios especiales para ciertos clientes.', async () => {
    await r.click('main button:has-text("Nueva promoción")', { wait: 900 });
    for (const t of ['Pack', 'Por cantidad', 'Lleva X paga Y', 'Por cliente', 'Cliente preferencial']) { await r.moveTo(`[role="dialog"] >> text="${t}"`, { ms: 500 }); await sleep(550); }
  });
  await r.say('Hagamos un lleva tres, paga dos. Le pones un nombre, y eliges los productos.', async () => {
    await r.click('[role="dialog"] >> text="Lleva X paga Y"', { wait: 900 });
    await r.click(p().getByLabel('Nombre', { exact: true }), { wait: 200 });
    await r.type('Cyber: brochas 3×2', 70); await sleep(300);
    await r.click('[role="dialog"] input[placeholder^="Agregar producto"]', { wait: 200 });
    await r.type('brocha', 110); await sleep(700); await r.key('Enter');
  });
  await r.say('Defines cuántos lleva y cuántos paga.', async () => {
    const lleva = p().getByLabel('Lleva', { exact: true }), paga = p().getByLabel('Paga', { exact: true });
    await r.click(lleva, { wait: 150 }); await p().keyboard.press('Control+A'); await r.type('3', 200);
    await r.click(paga, { wait: 150 }); await p().keyboard.press('Control+A'); await r.type('2', 200); await sleep(400);
  });
  await r.say('Y las fechas, desde y hasta cuándo. La promoción se activa y se apaga sola.', async () => {
    const iso = (d) => new Date(Date.now() + d * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
    const de = p().getByLabel(/^Desde/).first(), ha = p().getByLabel(/^Hasta/).first();
    await r.click(de, { wait: 300 }); await de.fill(iso(14)); await sleep(700);
    await r.click(ha, { wait: 300 }); await ha.fill(iso(17)); await sleep(700);
  });
  await r.say('La creas, y queda programada para esas fechas.', async () => {
    await r.click('[role="dialog"] button:has-text("Crear promoción")', { wait: 1100 });
    await r.click('main >> text="Programadas"', { wait: 1000 });
    await r.moveTo('main >> text="Cyber: brochas 3×2"', { ms: 700 });
  });
  await r.say('Y al vender, el programa detecta las promociones que calzan, y las aplicas con un clic, viendo siempre tu margen.', async () => {
    await r.click('main >> text="Todas"', { wait: 900 });
    await r.moveTo('main >> text="Kit taladro + esmeril"', { dy: 40, ms: 900 });
  });
  await r.say('Si vendes con despacho, en Envíos ves cada pedido: no despachado, en camino, entregado, o con problemas.', async () => {
    await r.click('aside >> text=Envíos', { wait: 1100 });
    for (const t of ['No despachado', 'En camino', 'Entregado', 'No entregado (problemas)']) { await r.moveTo(`main >> text="${t}" >> nth=0`, { dy: 20, ms: 600 }); await sleep(600); }
  });
  await r.say('Abres uno, y anotas la agencia y el número de seguimiento, para responderle rápido al cliente.', async () => {
    await r.click('main [role=row]:has-text("Catalina Navarro")', { wait: 1000 });
    await r.moveTo(p().getByLabel('Agencia'), { ms: 700 }); await sleep(800);
    await r.moveTo(p().getByLabel(/seguimiento/), { ms: 600 });
  });
  await r.say('Cuando llega, lo marcas como entregado. Y si tuvo problemas, también lo marcas, para que no se te pierda.', async () => {
    await r.click('[role="dialog"] [role="radiogroup"] >> text="Entregado"', { wait: 800 });
    await r.click('[role="dialog"] button:has-text("Guardar")', { wait: 1200 });
  });
  await r.say('Vende más, sin perder el control. Descárgalo gratis en nucleoerp.cl.', async () => {
    await r.moveTo({ x: 760, y: 300 }, { ms: 1200 });
  });

  await r.stop();
})().catch((e) => { console.error(e); process.exit(1); });
