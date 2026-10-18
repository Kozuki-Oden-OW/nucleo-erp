// 05 · Compras y proveedores
const { Recorder, sleep } = require('./engine.cjs');

(async () => {
  const r = new Recorder('05');
  const p = () => r.page;
  await r.start();
  await r.go('/inventario', 1500);
  await r.rec();

  await r.say('Comprar bien es la mitad de ganar. Mira: el programa te avisa que las carretillas se van a acabar, y te sugiere comprar ocho.', async () => {
    await sleep(800);
    await r.moveTo('main [role=row]:has-text("Carretilla") >> text=Riesgo de quiebre', { ms: 1200 }); await sleep(1400);
    await r.moveTo('main [role=row]:has-text("Carretilla") >> text=/Comprar \\d+/', { ms: 800 });
  });
  await r.say('Vamos a Comprar. Aquí tienes tus órdenes de compra, las facturas de tus proveedores y lo que les debes.', async () => {
    await r.click('aside >> text=Comprar', { wait: 1000 });
    await r.moveTo('main >> text="Órdenes de compra"', { ms: 700 }); await sleep(700);
    await r.moveTo('main >> text="Documentos de compra"', { ms: 600 }); await sleep(700);
    await r.moveTo('main >> text="Dinero que debes"', { ms: 600 });
  });
  await r.say('Nueva orden de compra. Eliges el proveedor…', async () => {
    await r.click('main button:has-text("Nueva orden de compra")', { wait: 1000 });
    await r.click('input[aria-label="Proveedor"]', { wait: 300 });
    await r.type('distri', 110); await sleep(700); await r.key('Enter');
  });
  await r.say('…y los productos que le pides, con la cantidad. El costo sale solo, de tu última compra.', async () => {
    await r.click('input[aria-label="Agregar producto o servicio"]', { wait: 200 });
    await r.type('carretilla', 90); await sleep(700); await r.key('Enter'); await sleep(400);
    await r.type('10', 170); await sleep(500);
    await r.moveTo('main input[aria-label="Costo unitario"]', { ms: 800 });
  });
  await r.say('Guardas y emites. La orden queda pendiente hasta que llegue la mercadería, y la puedes imprimir o mandar en PDF.', async () => {
    await r.click('main button:has-text("Guardar y emitir") >> nth=0', { wait: 1300 });
    await r.moveTo('main button:has-text("Imprimir")', { ms: 900 });
  });
  await r.say('Cuando llega, aprietas Recibir mercadería y anotas lo que llegó. Si llegó solo una parte, el resto queda pendiente.', async () => {
    await r.click('main button:has-text("Recibir mercadería")', { wait: 1000 });
    await r.moveTo('[role="dialog"] input >> nth=0', { ms: 800 });
  });
  await r.say('Confirmas, y el stock sube solo, con el costo actualizado.', async () => {
    await r.click('[role="dialog"] button:has-text("Confirmar recepción")', { wait: 1400 });
  });
  await r.say('Después registras la factura del proveedor. Los datos de la orden se copian solos.', async () => {
    await r.click('main button:has-text("Registrar factura")', { wait: 1300 });
  });
  await r.say('Anotas el número de la factura. El vencimiento se calcula solo, con el plazo de pago del proveedor.', async () => {
    await r.click('main input[placeholder="Ej. 8841"]', { wait: 200 });
    await r.type('8841', 150); await sleep(500);
    await r.moveTo(p().getByLabel('Vence'), { ms: 800 });
  });
  await r.say('La registras. Como todavía no la pagas, queda en lo que le debes al proveedor, y el IVA se suma solo como crédito en tu Formulario 29.', async () => {
    await r.click('main button:has-text("Registrar documento") >> nth=0', { wait: 1500 });
    await r.moveTo('main >> text=/IVA/ >> nth=0', { ms: 900 });
  }, { after: 1500 });
  await r.say('Cuando le pagues, aprietas Registrar pago, eliges de qué cuenta sale la plata, y listo.', async () => {
    await r.click('main button:has-text("Registrar pago")', { wait: 1000 });
    const sel = p().locator('[role="dialog"] select').last();
    await r.moveTo(sel, { ms: 700 }); await sleep(600);
    await r.click('[role="dialog"] button:has-text("Registrar pago")', { wait: 1300 });
  });
  await r.say('Compras ordenadas, cero facturas perdidas. Descárgalo gratis en nucleoerp.cl.', async () => {
    await r.moveTo({ x: 760, y: 300 }, { ms: 1200 });
  });

  await r.stop();
})().catch((e) => { console.error(e); process.exit(1); });
