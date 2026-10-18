// 03 · Inicio y alertas
const { Recorder, sleep } = require('./engine.cjs');

(async () => {
  const r = new Recorder('03');
  await r.start();
  await r.go('/inicio', 1500);
  await r.rec();

  await r.say('Si tuvieras un minuto al día para mirar tu negocio, esta es la pantalla.', async () => {
    await sleep(800); await r.moveTo({ x: 640, y: 150 }, { ms: 1200 });
  });
  await r.say('Arriba ves lo de hoy: cuánto vendiste, cuánto ganaste y cuánta plata tienes en caja y en el banco.', async () => {
    await r.moveTo('main >> text="Ventas" >> nth=0', { dy: 30, ms: 900 }); await sleep(900);
    await r.moveTo('main >> text="Utilidad" >> nth=0', { dy: 30, ms: 700 }); await sleep(900);
    await r.moveTo('main >> text="Disponible"', { dy: 30, ms: 900 });
  });
  await r.say('Más abajo, el mes completo: ventas, compras, gastos y utilidad, comparado con el mes anterior.', async () => {
    await r.moveTo('main >> text="Ventas" >> nth=1', { dy: 30, ms: 900 }); await sleep(1000);
    await r.moveTo('main >> text="Gastos" >> nth=0', { dy: 30, ms: 900 }); await sleep(800);
    await r.moveTo('main >> text="Utilidad" >> nth=1', { dy: 30, ms: 700 });
  });
  await r.say('Y lo que más importa: el dinero que te deben, el que tú debes, y el IVA estimado del mes.', async () => {
    await r.moveTo('main >> text="Te deben"', { dy: 30, ms: 900 }); await sleep(1100);
    await r.moveTo('main >> text="Debes"', { dy: 30, ms: 700 }); await sleep(1100);
    await r.moveTo('main >> text="IVA estimado"', { dy: 30, ms: 700 });
  });
  await r.say('A la derecha están las alertas. El programa revisa tu negocio por ti y te dice qué requiere tu atención.', async () => {
    await r.highlightCard('Requiere tu atención');
    await r.moveTo('text=Requiere tu atención', { ms: 900 });
    await sleep(2500); await r.unhighlight();
  });
  await r.say('Clientes que te deben dinero atrasado, pagos tuyos que ya vencieron, productos que se están por agotar…', async () => {
    await r.moveTo('main >> text=clientes te deben dinero atrasado', { ms: 800 }); await sleep(1300);
    await r.moveTo('main >> text=pago atrasado', { ms: 700 }); await sleep(1300);
    await r.moveTo('main >> text=productos están por agotarse', { ms: 700 });
  });
  await r.say('…y cosas que a simple vista no ves, como clientes frecuentes que dejaron de comprar.', async () => {
    await r.moveTo('main >> text=clientes frecuentes dejaron de comprar', { ms: 900 });
  });
  await r.say('La campana de arriba te muestra lo mismo desde cualquier pantalla del programa.', async () => {
    await r.click('button[aria-label^="Alertas"]', { wait: 2200 });
    await r.key('Escape');
  });
  await r.say('Y cada alerta te lleva directo a resolverla. Por ejemplo: ¿quién te debe?', async () => {
    await r.click('main >> text=Ver quién te debe', { wait: 1300 });
  });
  await r.say('Aquí está la lista, con cuánto te debe cada cliente y hace cuántos días venció.', async () => {
    await r.moveTo('main [role=row] >> nth=1', { ms: 900 }); await sleep(900);
    await r.moveTo('main [role=row] >> nth=3', { ms: 900 });
  });
  await r.say('¿Quieres más avisos, o menos? En Configuración, Alertas, eliges cuáles ver.', async () => {
    await r.click('aside >> text=Configuración', { wait: 900 });
    await r.click('main >> text="Alertas"', { wait: 1000 });
  });
  await r.say('Por ejemplo, que te avise si la caja proyectada va a quedar en negativo, si un producto deja poco margen, o si un proveedor te subió el precio.', async () => {
    await r.moveTo('main >> text=La caja proyectada queda en negativo', { ms: 900 }); await sleep(1600);
    await r.moveTo('main >> text=Productos con margen bajo o pérdida', { ms: 800 }); await sleep(1600);
    await r.moveTo('main >> text=Proveedores que subieron precios', { ms: 800 });
  });
  await r.say('Y ajustas desde cuándo avisarte. Por ejemplo, los pagos, con diez días de anticipación.', async () => {
    await r.scroll(420);
    const field = r.page.getByLabel('Avisar pagos con');
    await r.click(field, { wait: 200 });
    await r.page.keyboard.press('Control+A'); await r.type('10', 180); await sleep(500);
    await r.click('main button:has-text("Guardar reglas")', { wait: 1200 });
  });
  await r.say('Abre NÚCLEO cada mañana, mira esta pantalla y sabrás qué hacer hoy. Descárgalo gratis en nucleoerp.cl.', async () => {
    await r.click('aside >> text=Inicio', { wait: 1200 });
    await r.moveTo({ x: 760, y: 330 }, { ms: 1200 });
  });

  await r.stop();
})().catch((e) => { console.error(e); process.exit(1); });
