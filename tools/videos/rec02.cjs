// 02 · Tu primera venta y tu primera cotización
const { Recorder, sleep } = require('./engine.cjs');

(async () => {
  const r = new Recorder('02');
  const p = () => r.page;
  await r.start();
  await r.go('/inicio', 1500);
  await r.rec();

  await r.say('¿Te piden precio por WhatsApp y después no sabes a quién le cotizaste qué? Hoy lo ordenamos.', async () => {
    await sleep(1200); await r.moveTo({ x: 700, y: 330 }, { ms: 1400 });
  });

  await r.say('Entras a Vender y luego a Cotizaciones.', async () => {
    await r.click('aside >> text=Vender', { wait: 900 });
    await r.click('main >> text="Cotizaciones"', { wait: 700 });
  });

  await r.say('Aquí ves todas tus cotizaciones y en qué estado está cada una.', async () => {
    await r.moveTo('main [role=row] >> nth=1', { dx: 120, ms: 900 });
    await r.moveTo('main [role=row] >> nth=2', { dx: 120, ms: 900 });
  });

  await r.say('Nueva cotización. Eliges el cliente; si no existe, lo creas aquí mismo.', async () => {
    await r.click('main button:has-text("Nueva cotización")', { wait: 900 });
    await r.click('input[aria-label="Cliente"]', { wait: 300 });
    await r.type('constru', 110); await sleep(900);
    await r.key('Enter');
  });

  await r.say('Agregas los productos y la cantidad. El precio y el IVA se calculan solos.', async () => {
    await r.click('input[aria-label="Agregar producto o servicio"]', { wait: 300 });
    await r.type('taladro', 100); await sleep(700); await r.key('Enter'); await sleep(400);
    await r.type('3', 150); await r.key('Enter'); await sleep(300);
    await r.type('cemento', 100); await sleep(700); await r.key('Enter'); await sleep(400);
    await r.type('40', 150); await sleep(300);
    await r.moveTo('text=Subtotal sin impuesto', { dx: 60, ms: 900 });
  }, { after: 1200 });

  await r.say('Si el cliente tiene una promoción, el programa te la sugiere y la aplicas con un clic.', async () => {
    await r.click('button:has-text("Aplicar promociones")', { wait: 900 });
  });

  await r.say('La fecha de validez ya viene puesta, quince días. Si quieres, la cambias.', async () => {
    await r.moveTo('text=Válida hasta', { dy: 32, ms: 900 });
  });

  await r.say('Guardas, y la cotización queda lista para imprimir o enviar en PDF con tu logo.', async () => {
    await r.click('main button:has-text("Guardar cotización") >> nth=0', { wait: 1200 });
    await r.click('button:has-text("Imprimir")', { wait: 1500 });
  }, { after: 1800 });

  await r.say('Tu cliente te dijo que sí. No vuelves a escribir nada: la conviertes en venta con un clic.', async () => {
    await r.key('Escape'); await sleep(500);
    await r.click('button:has-text("Cliente aceptó")', { wait: 900 });
    await r.click('button:has-text("Convertir en venta")', { wait: 1400 });
  });

  await r.say('Se copiaron el cliente, los productos y los precios. Ahora confirmas que la venta se hizo.', async () => {
    await r.moveTo('main td:has-text("Taladro")', { ms: 900 });
    await r.click('button:has-text("Venta efectuada")', { wait: 900 });
  });

  await r.say('Eliges cómo te pagó: al contado, o a crédito si te va a pagar después.', async () => {
    await r.click('[role="dialog"] >> text="A crédito"', { wait: 900 });
    await r.click('[role="dialog"] >> text="Al contado"', { wait: 700 });
  });

  await r.say('Si fue al contado, eliges el medio de pago: efectivo, tarjeta o transferencia, y la cuenta donde entra la plata.', async () => {
    const sel = p().locator('[role="dialog"] select').first();
    await r.moveTo(sel, { ms: 800 });
    await sleep(300);
    const opts = await sel.locator('option').allTextContents();
    const t = opts.find((o) => /transfer/i.test(o)) || opts[0];
    await sel.selectOption({ label: t }); await sleep(800);
    await r.moveTo(p().locator('[role="dialog"] select').nth(1), { ms: 700 });
  });

  await r.say('Confirmas. El stock se descuenta solo y la plata entra a tu cuenta.', async () => {
    await r.click('[role="dialog"] button:has-text("Confirmar venta")', { wait: 1400 });
  });

  await r.say('La boleta o la factura la emites en el SII. Mientras no anotes el número, la venta queda pendiente de documentación, para que no se te olvide.', async () => {
    await r.highlight('text=Esta venta está pendiente de documentación tributaria');
    await r.moveTo('text=Esta venta está pendiente de documentación tributaria', { ms: 900 });
    await sleep(2500);
    await r.unhighlight();
  });

  await r.say('Cuando la emitas, anotas el tipo de documento y el número. Listo.', async () => {
    await r.click('button:has-text("Marcar como documentada") >> nth=0', { wait: 900 });
    const sel = p().locator('[role="dialog"] select').first();
    await r.moveTo(sel, { ms: 600 }); await sel.selectOption('Factura'); await sleep(500);
    await r.click('[role="dialog"] input[placeholder="Ej. 563"]', { wait: 200 });
    await r.type('563', 140); await sleep(400);
    await r.click('[role="dialog"] button:has-text("Guardar")', { wait: 1200 });
  });

  await r.say('Y si vendes a crédito, la venta queda en lo que te deben, y el programa te avisa cuando se atrase.', async () => {
    await r.click('aside >> text=Inicio', { wait: 1200 });
    await r.highlightCard('Te deben');
    await r.moveTo('text=Te deben', { dy: 40, ms: 800 });
    await sleep(2200); await r.unhighlight();
  });

  await r.say('Así de simple. En el próximo video vemos Inicio y las alertas. Descárgalo gratis en nucleoerp.cl.', async () => {
    await r.moveTo({ x: 760, y: 300 }, { ms: 1200 });
  });

  await r.stop();
})().catch(async (e) => { console.error(e); process.exit(1); });
