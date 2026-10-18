// 01 · Qué es NÚCLEO ERP e instalación
const { Recorder, sleep } = require('./engine.cjs');
const SITE = 'http://localhost:8770/';

(async () => {
  const r = new Recorder('01');
  const p = () => r.page;
  await r.start();
  await p().goto(SITE); await sleep(1500); await p().mouse.move(760, 430);
  await r.rec();

  await r.say('Hoy vas a instalar NÚCLEO ERP y a crear tu empresa en menos de cinco minutos.', async () => {
    await sleep(800); await r.moveTo('text=Todo tu negocio.', { ms: 1200 });
  });
  await r.say('NÚCLEO es un programa de gestión para emprendedores y pymes de Chile: ventas, inventario, compras, impuestos, sueldos y comercio exterior, en un solo lugar.', async () => {
    await r.scroll(500, 2500); await sleep(800); await r.scroll(-500, 1200);
  });
  await r.say('Y lo más importante: se instala en tu computador, y tus datos quedan ahí, cifrados. Sin mensualidades, y sin entregarle tus datos a nadie.', async () => {
    await r.moveTo('text=Datos cifrados en tu PC', { ms: 900 }); await sleep(1100);
    await r.moveTo('text=Sin cuentas ni mensualidades', { ms: 700 });
  });
  await r.say('Entras a nucleoerp.cl y aprietas Descargar. Es gratis.', async () => {
    await r.click('header >> text=Descargar gratis', { wait: 1400 });
  });
  await r.say('Bajas el instalador para Windows, lo abres, y sigues los pasos como cualquier programa.', async () => {
    await r.moveTo('a:has-text("Descargar NucleoERPSetup.exe")', { ms: 900 });
  });
  await r.say('Si prefieres, antes de instalar puedes probar la demostración en el navegador, con una ferretería de ejemplo.', async () => {
    await r.moveTo('header >> text="Demo"', { ms: 900 });
  });
  await r.say('Al abrir el programa, creas tu empresa: le pones el nombre…', async () => {
    await p().goto('http://localhost:8767/#/inicio'); await sleep(1200); await p().mouse.move(r.mouse.x, r.mouse.y);
    await r.click('aside button:has-text("Ferretería")', { wait: 700 });
    await r.click('text=Agregar empresa', { wait: 900 });
    await r.click(p().getByLabel('Nombre de la empresa'), { wait: 200 });
    await r.type('Panadería La Espiga', 80);
  });
  await r.say('…y eliges en qué etapa estás. Emprendedor si todavía no inicias actividades; Negocio o Empresa si ya estás formalizado. El menú se adapta a lo que necesitas.', async () => {
    await r.moveTo('[role="dialog"] >> text="Emprendedor"', { ms: 700 }); await sleep(1300);
    await r.moveTo('[role="dialog"] >> text="Negocio"', { ms: 600 }); await sleep(1000);
    await r.moveTo('[role="dialog"] >> text="Empresa"', { ms: 600 }); await sleep(800);
    await r.click('[role="dialog"] >> text="Negocio"', { wait: 500 });
  });
  await r.say('Al crearla, te entrega una clave de recuperación. Guárdala en papel, o en un lugar seguro: si olvidas tu contraseña, es la única forma de volver a entrar.', async () => {
    await r.click('[role="dialog"] button:has-text("Crear empresa")', { wait: 1400 });
    await r.moveTo('button:has-text("Copiar")', { ms: 900 }); await sleep(800);
    await r.moveTo('button:has-text("Imprimir")', { ms: 600 });
  }, { after: 1500 });
  await r.say('Listo, ya estás en Inicio. A la izquierda tienes todos los módulos.', async () => {
    await r.click('text=Ya guardé mi clave de recuperación en un lugar seguro.', { wait: 500 });
    await r.click('button:has-text("Continuar")', { wait: 1500 });
    await r.moveTo('aside >> text=Vender', { ms: 800 }); await sleep(500);
    await r.moveTo('aside >> text=Configuración', { ms: 1400 });
  });
  await r.say('Arriba cambias entre la vista Simple y la vista Contador. La simple te habla en palabras normales; la de contador muestra todo el detalle.', async () => {
    await r.click('text="Contador" >> nth=0', { wait: 1500 });
    await r.click('text="Simple" >> nth=0', { wait: 900 });
  });
  await r.say('En Mi negocio completas tus datos y subes tu logo, que después aparece en tus cotizaciones.', async () => {
    await r.click('aside >> text=Mi negocio', { wait: 1100 });
    await r.moveTo('main >> text=/logo/i', { ms: 900 });
  });
  await r.say('Y si tienes más de una empresa, cambias entre ellas desde aquí arriba.', async () => {
    await r.click('aside button:has-text("Panadería")', { wait: 1300 });
    await r.key('Escape');
  });
  await r.say('En el próximo video hacemos tu primera venta. Descárgalo gratis en nucleoerp.cl.', async () => {
    await r.moveTo({ x: 760, y: 300 }, { ms: 1200 });
  });

  await r.stop();
})().catch((e) => { console.error(e); process.exit(1); });
