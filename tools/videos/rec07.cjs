// 07 · Conciliación bancaria
const { Recorder, sleep } = require('./engine.cjs');
const path = require('path');
const CSV = path.join(__dirname, 'cartola_octubre.csv');

(async () => {
  const r = new Recorder('07');
  const p = () => r.page;
  const row = (t) => p().locator(`main :text("${t}")`).first().locator('xpath=ancestor::*[.//button][1]');
  const upload = async () => {
    const [fc] = await Promise.all([p().waitForEvent('filechooser'), r.click('main button:has-text("Subir cartola") >> nth=0', { wait: 200 })]);
    await fc.setFiles(CSV); await sleep(1300);
  };
  await r.start();
  await r.go('/dinero', 1500);
  await r.rec();

  await r.say('Revisar la cartola del banco línea por línea es lo más aburrido del mes. Hoy lo hace el programa.', async () => {
    await sleep(700);
    await r.click('main >> text="Conciliación bancaria"', { wait: 1000 });
  });
  await r.say('Descargas la cartola desde la página de tu banco, en Excel o CSV. Aquí eliges la cuenta, y aprietas Subir cartola.', async () => {
    await r.moveTo('main select >> nth=0', { ms: 900 }); await sleep(1500);
    await upload();
  });
  await r.say('Antes de subirla, te muestra lo que leyó: los abonos, la plata que entró, y los cargos, la que salió.', async () => {
    await r.moveTo('[role="dialog"] >> text=Abonos (entra dinero)', { dy: 10, ms: 900 }); await sleep(1300);
    await r.moveTo('[role="dialog"] >> text=Cargos (sale dinero)', { dy: 10, ms: 800 });
  });
  await r.say('Confirmas, y cada movimiento queda listo para revisar.', async () => {
    await r.click('[role="dialog"] button:has-text("Subir")', { wait: 1400 });
  });
  await r.say('Y aquí está la magia: el programa cruza cada movimiento con lo que ya tienes. Este abono de Constructora Sur es el pago de una venta que te debían.', async () => {
    await r.moveTo(row('TRANSF DE CONSTRUCTORA SUR LTDA').locator('text=/Sugerencia/'), { ms: 1000 });
  }, { after: 1500 });
  await r.say('Si está bien, lo confirmas con un clic. El cobro queda registrado, y la venta, pagada.', async () => {
    await r.click(row('TRANSF DE CONSTRUCTORA SUR LTDA').locator('button:has-text("Registrar cobro")'), { wait: 1300 });
  });
  await r.say('Este giro en el cajero lo reconoce como un traspaso a tu caja.', async () => {
    await r.click(row('GIRO CAJERO AUTOMATICO').locator('button:has-text("Registrar traspaso")'), { wait: 1300 });
  });
  await r.say('Y la comisión del banco, como un gasto bancario.', async () => {
    await r.click(row('COMISION MANTENCION CUENTA').locator('button:has-text("Gasto")'), { wait: 1300 });
  });
  await r.say('Los pagos de tus clientes se cruzan igual: Tomás Herrera y la Municipalidad.', async () => {
    await r.click(row('TRANSF DE TOMAS HERRERA').locator('button:has-text("Registrar cobro")'), { wait: 1200 });
    await r.click(row('TRANSF DE MUNICIPALIDAD PTO EJEMPLO').locator('button:has-text("Registrar cobro")'), { wait: 1200 });
  });
  await r.say('Lo que no reconoce, te lo deja a ti. Por ejemplo, esta compra en la Copec: eliges qué es, y te sugiere la categoría según la descripción.', async () => {
    const rw = row('COMPRA COPEC LOS LAGOS');
    await rw.scrollIntoViewIfNeeded(); await sleep(400);
    await r.click(rw.locator('button:has-text("Otra opción"), button:has-text("Elegir qué es")').first(), { wait: 1100 });
    const sel = p().locator('[role="dialog"] select').first();
    await r.moveTo(sel, { ms: 800 }); await sleep(1200);
    await r.click('[role="dialog"] button:has-text("Registrar gasto")', { wait: 1300 });
  });
  await r.say('Y si por error subes la misma cartola dos veces, no se duplica nada: el programa ya sabe qué movimientos tiene.', async () => {
    await r.scroll(-600, 500);
    await upload();
    await r.click('[role="dialog"] button:has-text("Subir")', { wait: 2200 });
  });
  await r.say('Arriba ves cuántos movimientos te quedan por revisar, y si el saldo del banco cuadra con el del programa.', async () => {
    await r.moveTo('main >> text="Por revisar"', { dy: 25, ms: 900 }); await sleep(1100);
    await r.moveTo('main >> text="Conciliados"', { dy: 25, ms: 700 }); await sleep(1100);
    await r.moveTo('main >> text=Saldo banco vs. NÚCLEO', { dy: 25, ms: 800 });
  });
  await r.say('Lo que antes te tomaba una tarde, ahora te toma cinco minutos. Descárgalo gratis en nucleoerp.cl.', async () => {
    await r.moveTo({ x: 760, y: 300 }, { ms: 1200 });
  });

  await r.stop();
})().catch((e) => { console.error(e); process.exit(1); });
