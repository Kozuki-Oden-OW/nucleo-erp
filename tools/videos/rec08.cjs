// 08 · Dinero: cuentas, cobros y flujo de caja
const { Recorder, sleep } = require('./engine.cjs');

(async () => {
  const r = new Recorder('08');
  const p = () => r.page;
  await r.start();
  await r.go('/dinero', 1500);
  await r.rec();

  await r.say('Vender mucho no sirve de nada si la plata no llega a tiempo. Veamos tu caja.', async () => {
    await sleep(700); await r.moveTo({ x: 700, y: 180 }, { ms: 1200 });
  });
  await r.say('Arriba, en cuatro números: lo que tienes disponible, lo que te deben, lo que debes, y cuánto tendrías en treinta días.', async () => {
    for (const t of ['Dinero disponible', 'Dinero que te deben', 'Dinero que debes', 'En 30 días tendrías']) { await r.moveTo(`main >> text="${t}"`, { dy: 28, ms: 700 }); await sleep(1100); }
  });
  await r.say('Este gráfico es tu flujo de caja. Con lo que te van a pagar, lo que tienes que pagar y tus gastos fijos, te proyecta cuánta plata vas a tener, semana a semana.', async () => {
    const svg = p().locator('main svg[aria-label^="Proyección del saldo"]');
    const b = await svg.boundingBox();
    if (b) for (let i = 0; i <= 6; i++) { await r.moveTo({ x: b.x + b.width * (0.06 + i * 0.145), y: b.y + b.height * 0.55 }, { ms: 600 }); await sleep(700); }
  });
  await r.say('Si alguna semana la caja va a quedar en negativo, te avisa antes de que pase.', async () => {
    const svg = p().locator('main svg[aria-label^="Proyección del saldo"]');
    const b = await svg.boundingBox();
    if (b) await r.moveTo({ x: b.x + b.width * 0.9, y: b.y + b.height * 0.75 }, { ms: 900 });
  });
  await r.say('A la derecha están tus cuentas, y lo que te deben ordenado por antigüedad: al día, de uno a treinta días atrasado, y así.', async () => {
    await r.moveTo('main >> text="Tus cuentas"', { dy: 40, ms: 900 }); await sleep(1300);
    await r.moveTo('main >> text="Te deben, por antigüedad"', { dy: 40, ms: 800 }); await sleep(900);
    await r.moveTo('main >> text="1–30 días atrasado"', { ms: 700 });
  });
  await r.say('En Cuentas tienes la caja, el banco y la billetera digital, cada una con su saldo.', async () => {
    await r.click('main >> text="Cuentas"', { wait: 1000 });
    await r.moveTo('main >> text="Cuenta corriente"', { dy: 25, ms: 800 }); await sleep(800);
    await r.moveTo('main >> text="Caja del local"', { dy: 25, ms: 800 });
  });
  await r.say('Si sacas plata del banco para la caja, haces un traspaso, y los dos saldos quedan bien.', async () => {
    await r.click('main button:has-text("Traspasar") >> nth=0', { wait: 900 });
    const from = p().getByLabel('Desde');
    const fopts = await from.locator('option').allTextContents();
    const cc = fopts.find((o) => /corriente/i.test(o)); if (cc) { await r.moveTo(from, { ms: 600 }); await from.selectOption({ label: cc }); await sleep(500); }
    const to = p().getByLabel('Hacia');
    const opts = await to.locator('option').allTextContents();
    const caja = opts.find((o) => /caja/i.test(o)); if (caja) { await r.moveTo(to, { ms: 600 }); await to.selectOption({ label: caja }); }
    await r.click(p().getByLabel('Monto'), { wait: 200 });
    await r.type('100000', 140); await sleep(400);
    await r.click('[role="dialog"] button:has-text("Traspasar")', { wait: 1300 });
  });
  await r.say('En Dinero que te deben ves quién te debe, cuánto, y hace cuántos días venció.', async () => {
    await r.click('main >> text=Dinero que te deben', { wait: 1000 });
    await r.moveTo('main >> text=/Atrasado \\d+ días/ >> nth=0', { ms: 800 }); await sleep(800);
    await r.moveTo('main >> text=/Atrasado \\d+ días/ >> nth=2', { ms: 700 });
  });
  await r.say('Cuando un cliente te paga, abres la venta y aprietas Registrar pago. La venta queda saldada y la plata entra a tu cuenta.', async () => {
    await r.click('main [role=row]:has-text("Tomás Herrera") >> nth=0', { wait: 1300 });
    await r.click('main button:has-text("Registrar pago")', { wait: 900 });
    await r.click('[role="dialog"] button:has-text("Registrar")', { wait: 1300 });
  });
  await r.say('Lo mismo con lo que tú debes, en Dinero que debes, ordenado por fecha de vencimiento.', async () => {
    await r.click('aside >> text=Dinero', { wait: 1000 });
    await r.click('main >> text=Dinero que debes', { wait: 1000 });
    await r.moveTo('main [role=row] >> nth=1', { ms: 800 });
  });
  await r.say('Y en el Calendario ves, día a día, qué te van a pagar y qué tienes que pagar tú.', async () => {
    await r.click('main >> text="Calendario"', { wait: 1100 });
    await r.moveTo('main >> text="Atrasado"', { ms: 800 }); await sleep(800);
    await r.scroll(300);
    await r.moveTo({ x: 900, y: 560 }, { ms: 800 });
  });
  await r.say('Ya no te enteras tarde: lo ves venir. Descárgalo gratis en nucleoerp.cl.', async () => {
    await r.moveTo({ x: 760, y: 300 }, { ms: 1200 });
  });

  await r.stop();
})().catch((e) => { console.error(e); process.exit(1); });
