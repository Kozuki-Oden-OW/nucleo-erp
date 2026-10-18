// 04 · Productos e inventario
const { Recorder, sleep } = require('./engine.cjs');

(async () => {
  const r = new Recorder('04');
  const p = () => r.page;
  await r.start();
  await r.go('/productos', 1500);
  await r.rec();

  await r.say('¿Cuántas unidades te quedan de verdad? Hoy lo vas a saber al tiro.', async () => {
    await sleep(600); await r.moveTo({ x: 700, y: 200 }, { ms: 1200 });
  });
  await r.say('En Productos y servicios tienes todo lo que vendes, con su precio, su costo, cuánto ganas y cuánto stock te queda.', async () => {
    await r.moveTo('main >> text="Precio neto"', { ms: 900 }); await sleep(900);
    await r.moveTo('main >> text="Costo"', { ms: 700 }); await sleep(900);
    await r.moveTo('main >> text="Margen"', { ms: 700 }); await sleep(900);
    await r.moveTo('main >> text="Stock"', { ms: 900 });
  });
  await r.say('Para agregar uno, Nuevo producto. Si es un producto, lleva stock; si es un servicio, no.', async () => {
    await r.click('main button:has-text("Nuevo producto")', { wait: 1000 });
    await r.moveTo('text="Producto (lleva stock)"', { ms: 700 }); await sleep(700);
    await r.moveTo('[role="dialog"] >> text="Servicio"', { ms: 600 });
  });
  await r.say('Le pones el nombre y el precio de venta.', async () => {
    await r.click(p().getByLabel('Nombre', { exact: true }), { wait: 200 });
    await r.type('Escalera de aluminio 6 peldaños', 60); await sleep(300);
    await r.click(p().getByLabel('Precio de venta (Con IVA)'), { wait: 200 });
    await r.type('59990', 140);
  });
  await r.say('Pones lo que te cuesta, y el programa te muestra al tiro cuánto ganas con cada una.', async () => {
    await r.click(p().getByLabel('Costo', { exact: true }), { wait: 200 });
    await r.type('32000', 140); await sleep(800);
    const notice = p().locator('[role="dialog"] :text("Ganas"), [role="dialog"] :text("margen")').first();
    if (await notice.count()) await r.moveTo(notice, { ms: 800 });
  }, { after: 1200 });
  await r.say('Y el stock que tienes hoy. Después se mueve solo, con cada venta y cada compra.', async () => {
    await r.click(p().getByLabel('Stock inicial'), { wait: 200 });
    await r.type('10', 160);
  });
  await r.say('También decides qué pasa si se acaba: no vender, vender igual, o tomar reservas.', async () => {
    const sel = p().getByLabel('Si no hay stock');
    await sel.scrollIntoViewIfNeeded(); await sleep(400);
    await r.moveTo(sel, { ms: 800 });
  });
  await r.say('Guardas, y listo: ya está en tu lista.', async () => {
    await r.click('[role="dialog"] button:has-text("Guardar")', { wait: 1300 });
  });
  await r.say('Ahora, llegó mercadería. Vas a Inventario, y aprietas Agregar stock.', async () => {
    await r.click('aside >> text=Inventario', { wait: 1100 });
    await r.click('main button:has-text("Agregar stock")', { wait: 1100 });
  });
  await r.say('Eliges el producto, la cantidad que llegó y lo que te costó cada uno.', async () => {
    await r.click('main input[placeholder^="Agregar producto"]', { wait: 200 });
    await r.type('cemento', 100); await sleep(700); await r.key('Enter'); await sleep(500);
    await r.type('50', 160); await r.key('Enter'); await sleep(300);
    await r.type('3500', 150); await sleep(300);
  });
  await r.say('Si quieres, anotas el proveedor y el documento de respaldo, como la guía de despacho.', async () => {
    await r.click(p().getByLabel('Documento de respaldo'), { wait: 200 });
    await r.type('Guía 88', 110);
  });
  await r.say('Al guardar, el stock sube y el costo promedio se recalcula solo. Todo queda en los movimientos.', async () => {
    await r.click('main button:has-text("Agregar stock") >> nth=0', { wait: 1500 });
    await r.moveTo('main [role=row] >> nth=1', { ms: 900 });
  }, { after: 1200 });
  await r.say('Cada cierto tiempo conviene contar lo que hay de verdad. Para eso está Realizar inventario.', async () => {
    await r.click('main >> text="Existencias"', { wait: 800 });
    await r.click('main button:has-text("Realizar inventario")', { wait: 1100 });
  });
  await r.say('Anotas lo que contaste, y el programa te muestra la diferencia con lo que debería haber.', async () => {
    const inp = p().getByLabel('Inventario de Ampolleta LED 9 W');
    await r.click(inp, { wait: 200 });
    await r.type('78', 180); await sleep(900);
    await r.moveTo('main >> text="Stock actual"', { dy: 34, ms: 800 });
  }, { after: 1200 });
  await r.say('Confirmas, y el stock queda ajustado, con registro de quién lo hizo y cuándo. Nada se borra.', async () => {
    await r.click('main button:has-text("Actualizar stock") >> nth=0', { wait: 1500 });
  });
  await r.say('Y en Existencias ves cuánto vendes al día, para cuántos días te alcanza, y qué te conviene reponer.', async () => {
    await r.click('main >> text="Inventario" >> nth=0', { wait: 1100 });
    await r.moveTo('main >> text="Vende/día"', { ms: 900 }); await sleep(900);
    await r.moveTo('main >> text="Alcanza"', { ms: 700 }); await sleep(900);
    await r.moveTo('main >> text=/^Comprar \\d+/', { ms: 900 });
  });
  await r.say('Así nunca más vendes algo que no tienes. Descárgalo gratis en nucleoerp.cl.', async () => {
    await r.moveTo({ x: 760, y: 300 }, { ms: 1200 });
  });

  await r.stop();
})().catch((e) => { console.error(e); process.exit(1); });
