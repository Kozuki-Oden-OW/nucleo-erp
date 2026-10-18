// 10 · Contabilidad automática y cierre de mes
const { Recorder, sleep } = require('./engine.cjs');

(async () => {
  const r = new Recorder('10');
  const p = () => r.page;
  await r.start();
  await r.go('/contabilidad', 1500);
  await r.rec();

  await r.say('¿No sabes de contabilidad? No necesitas saber. NÚCLEO la lleva por ti.', async () => {
    await sleep(700); await r.moveTo({ x: 700, y: 180 }, { ms: 1200 });
  });
  await r.say('Arriba cambias a la vista Contador, y entras a Contabilidad.', async () => {
    await r.click('text="Contador" >> nth=0', { wait: 900 });
    await r.click('main >> text="Contabilidad"', { wait: 1200 });
  });
  await r.say('Aquí ves cuánto vendiste, tu margen, el resultado del mes, y si el balance cuadra.', async () => {
    for (const t of ['Ventas de', 'Margen bruto del mes', 'Resultado del mes', 'Lo que tienes (activo)']) { await r.moveTo(`main >> text=${t}`, { dy: 28, ms: 700 }); await sleep(900); }
  });
  await r.say('Y los libros contables, listos para abrir y exportar a Excel: el libro diario, el mayor, el balance y el estado de resultados.', async () => {
    for (const t of ['Libro diario', 'Libro mayor', 'Balance de comprobación (8 columnas)', 'Estado de resultados', 'Balance general']) { await r.moveTo(`main >> text="${t}"`, { ms: 650 }); await sleep(700); }
  });
  await r.say('En Asientos está cada movimiento. Cada venta, compra, gasto y pago que registraste ya generó su asiento. Tú no escribiste ninguno.', async () => {
    await r.click('main >> text="Asientos"', { wait: 1100 });
    await r.click('main >> text="Automáticos"', { wait: 900 });
    await r.moveTo('main >> text=/^VEN-\\d+/ >> nth=0', { ms: 800 }); await sleep(900);
    await r.scroll(350, 1000);
  });
  await r.say('Si hace falta un ajuste, tu contador puede hacer un asiento manual. Por ejemplo, un aporte de capital del dueño.', async () => {
    await r.scroll(-400, 500);
    await r.click('main button:has-text("Nuevo asiento manual")', { wait: 900 });
    await r.click(p().getByLabel('Glosa'), { wait: 200 });
    await r.type('Aporte de capital del dueño', 70); await sleep(400);
  });
  await r.say('Elige las cuentas, el debe y el haber, y el programa revisa que cuadren antes de guardarlo.', async () => {
    const pick = async (i, re) => { const s = p().getByLabel(`Cuenta de la línea ${i}`); const o = (await s.locator('option').allTextContents()).find((t) => re.test(t)); await r.moveTo(s, { ms: 600 }); await s.selectOption({ label: o }); await sleep(400); };
    await pick(1, /^1\.1\.02/);
    await r.click(p().getByLabel('Debe de la línea 1'), { wait: 150 }); await r.type('500000', 110);
    await pick(2, /^3\.1\.02/);
    await r.click(p().getByLabel('Haber de la línea 2'), { wait: 150 }); await r.type('500000', 110); await sleep(500);
    await r.click('[role="dialog"] button:has-text("Registrar asiento")', { wait: 1200 });
  });
  await r.say('Y si un asiento quedó mal, se reversa con otro asiento. Nunca se borra nada.', async () => {
    await r.click('main >> text="Manuales"', { wait: 1000 });
    await r.moveTo('main button:has-text("Reversar")', { ms: 900 });
  });
  await r.say('El plan de cuentas viene listo para una pyme chilena. Cada cuenta tiene su nombre contable, y debajo, cómo se ve en la vista simple.', async () => {
    await r.click('main >> text="Plan de cuentas"', { wait: 1100 });
    await r.moveTo('main >> text="Caja" >> nth=0', { ms: 800 }); await sleep(900);
    await r.moveTo('main >> text="Dinero en caja"', { ms: 600 }); await sleep(900);
    await r.moveTo('main >> text="Clientes" >> nth=0', { ms: 600 });
  });
  await r.say('Si tu contador necesita otra cuenta, por ejemplo una por cada banco, la agrega aquí mismo.', async () => {
    const row = p().locator('main :text-is("Bancos")').first().locator('xpath=ancestor::*[.//button][1]');
    await r.moveTo(row.locator('button').last(), { ms: 900 });
  });
  await r.say('Y a la derecha decide qué cuenta recibe cada movimiento. Por ejemplo, adónde va el IVA de tus compras.', async () => {
    await r.moveTo('main >> text="Qué cuenta recibe cada movimiento"', { ms: 800 }); await sleep(900);
    await r.moveTo('main >> text=IVA de compras, gastos e importaciones', { dx: 260, ms: 800 });
  });
  await r.say('Cuando el mes está revisado, lo cierras. Así nadie cambia por error algo que ya declaraste.', async () => {
        await r.click('main >> text="Cierre de meses"', { wait: 1000 });
    await r.click('main tr:has-text("Septiembre") button:has-text("Cerrar mes"), main [role=row]:has-text("eptiembre") button:has-text("Cerrar mes")', { wait: 900 });
    await r.click('[role="dialog"] button:has-text("Cerrar mes")', { wait: 1300 });
  });
  await r.say('Y si de verdad hay que corregir algo, se puede reabrir, dejando anotado el motivo y quién lo hizo.', async () => {
    await r.moveTo('main button:has-text("Reabrir")', { ms: 900 });
  });
  await r.say('Tu contador te lo va a agradecer. Descárgalo gratis en nucleoerp.cl.', async () => {
    await r.moveTo({ x: 760, y: 300 }, { ms: 1200 });
  });

  await r.stop();
})().catch((e) => { console.error(e); process.exit(1); });
