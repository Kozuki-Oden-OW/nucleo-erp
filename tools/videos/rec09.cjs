// 09 · Formulario 29
const { Recorder, sleep } = require('./engine.cjs');

(async () => {
  const r = new Recorder('09');
  const p = () => r.page;
  await r.start();
  await r.go('/inicio', 1500);
  await r.rec();

  await r.say('Todos los meses la misma pregunta: ¿cuánto IVA tengo que pagar? Aquí ya está calculado.', async () => {
    await r.moveTo('main >> text="IVA estimado"', { dy: 30, ms: 1000 }); await sleep(900);
    await r.click('aside >> text=Impuestos', { wait: 1200 });
  });
  await r.say('Primero, una sola vez, completas tu Configuración tributaria: tu régimen y tu tasa de PPM.', async () => {
    await r.click('main >> text="Configuración tributaria"', { wait: 1000 });
    await r.moveTo(p().getByLabel('Régimen tributario'), { ms: 800 }); await sleep(1000);
    await r.moveTo(p().getByLabel(/Tasa de PPM/), { ms: 800 });
  });
  await r.say('En Formulario 29 eliges el mes. En octubre declaras el IVA de septiembre, y eso es lo que te muestra.', async () => {
    await r.click('main >> text="Formulario 29"', { wait: 1000 });
    await r.moveTo('main input[type="month"]', { ms: 800 });
  });
  await r.say('Antes de declarar, te avisa lo que tienes que revisar, como ventas que todavía no documentaste.', async () => {
    await r.highlightCard('Revisa antes de declarar');
    await r.moveTo('main >> text="Revisa antes de declarar"', { dy: 20, ms: 900 }); await sleep(2200);
    await r.unhighlight();
  });
  await r.say('A la derecha, el resumen: el IVA de tus ventas, que es el débito, menos el IVA de tus compras, que es el crédito.', async () => {
    await r.moveTo('main >> text="IVA débito"', { ms: 900 }); await sleep(1300);
    await r.moveTo('main >> text="− IVA crédito"', { ms: 700 }); await sleep(1000);
    await r.moveTo('main >> text="= IVA a pagar"', { ms: 700 });
  });
  await r.say('Le suma las retenciones de tus trabajadores y el PPM, y te da el total a pagar.', async () => {
    await r.moveTo('main >> text=/Retenciones e impuesto único/', { ms: 800 }); await sleep(900);
    await r.moveTo('main >> text="+ PPM"', { ms: 600 }); await sleep(900);
    await r.highlightCard('Total a pagar');
    await r.moveTo('main >> text="Total a pagar"', { dy: 30, ms: 800 }); await sleep(1500); await r.unhighlight();
  });
  await r.say('Más abajo está el formulario completo, con cada código, igual que en el SII.', async () => {
    await r.scroll(700, 1200);
    await r.moveTo('main >> text="Total débitos"', { ms: 800 }); await sleep(700);
    await r.moveTo('main >> text="Total créditos"', { ms: 800 }); await sleep(700);
    await r.moveTo('main >> text="IVA determinado"', { ms: 700 }); await sleep(700);
    await r.moveTo('main >> text="Total a pagar dentro del plazo"', { ms: 700 });
  });
  await r.say('Con Copiar códigos te llevas todo listo, para escribirlo en el SII o mandárselo a tu contador.', async () => {
    await r.scroll(-500, 900);
    await r.click('main button:has-text("Copiar códigos")', { wait: 1200 });
  });
  await r.say('Después entras a sii.cl con tu clave y declaras. NÚCLEO nunca te pide tu clave del SII.', async () => {
    await r.scroll(-600, 600);
    await r.moveTo('main button:has-text("Ya lo declaré en sii.cl")', { ms: 900 });
  });
  await r.say('Cuando lo declares, lo marcas aquí con el total pagado y el folio, y el mes queda registrado como declarado.', async () => {
    await r.click('main button:has-text("Ya lo declaré en sii.cl")', { wait: 900 });
    await r.click(p().getByLabel(/Folio del formulario/), { wait: 200 });
    await r.type('8456123', 120); await sleep(400);
    await r.click('[role="dialog"] button:has-text("Marcar como declarado")', { wait: 1300 });
  });
  await r.say('Recuerda: el programa prepara y te explica; la declaración la haces tú o tu contador. Descárgalo gratis en nucleoerp.cl.', async () => {
    await r.moveTo({ x: 760, y: 300 }, { ms: 1200 });
  });

  await r.stop();
})().catch((e) => { console.error(e); process.exit(1); });
