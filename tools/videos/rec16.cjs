// 16 · Usuarios, respaldos y seguridad
const { Recorder, sleep } = require('./engine.cjs');

(async () => {
  const r = new Recorder('16');
  const p = () => r.page;
  // Oculta los avisos propios de la demo en la pantalla de respaldos (en el programa instalado no aparecen).
  const hideDemoBits = () => p().evaluate(() => { const run = () => {
    for (const el of document.querySelectorAll('main *')) {
      if (el.childElementCount <= 3 && /En la demostración no se crean/.test(el.textContent || '') && el.closest('[class*="rounded"]')) { el.closest('[class*="rounded"]').style.display = 'none'; break; }
    }
    for (const s of document.querySelectorAll('main span.font-mono')) if (/demostración/.test(s.textContent)) { s.style.display = 'none'; const t = s.previousSibling; if (t && t.nodeType === 3) t.textContent = t.textContent.replace(/Carpeta:\s*$/, ''); }
  }; run(); setInterval(run, 40); });
  await r.start();
  await r.go('/config/usuarios', 1500);
  await r.rec();

  await r.say('Tus datos están en tu computador. Eso es privacidad, pero también es responsabilidad. Hoy los protegemos.', async () => {
    await sleep(700); await r.moveTo({ x: 800, y: 220 }, { ms: 1200 });
  });
  await r.say('En Configuración, Usuarios y roles, creas un usuario para cada persona que use el programa, cada uno con su contraseña.', async () => {
    await r.moveTo('main >> text="María López"', { ms: 800 }); await sleep(700);
    await r.click('main button:has-text("Nuevo usuario")', { wait: 900 });
    await r.click(p().getByLabel('Nombre', { exact: true }), { wait: 200 });
    await r.type('Pedro Rojas', 80); await sleep(300);
    await r.moveTo(p().getByLabel(/^Contraseña/), { ms: 700 }); await sleep(900);
    await r.key('Escape');
  });
  await r.say('Con los roles decides qué puede hacer cada uno. Por ejemplo, el rol Ventas puede vender y cobrar…', async () => {
    await r.click('main >> text="Roles y permisos"', { wait: 1000 });
    await r.click('main nav[aria-label="Roles"] >> text="Ventas"', { wait: 900 });
    await r.moveTo('main >> text="Crear cotizaciones y ventas"', { ms: 700 }); await sleep(800);
    await r.moveTo('main >> text="Registrar cobros y abonos"', { ms: 700 });
  });
  await r.say('…pero no ve tus costos, ni tus márgenes, ni tu utilidad.', async () => {
    await r.moveTo('main >> text="Ver costos, márgenes y utilidad"', { ms: 800 });
  });
  await r.say('En Seguridad y auditoría queda registrado quién hizo qué, y cuándo. Ese registro no se puede editar ni borrar.', async () => {
    await r.click('main >> text="Seguridad y auditoría"', { wait: 1100 });
    await r.moveTo('main >> text="Registro de actividad"', { dy: 80, ms: 900 }); await sleep(900);
    await r.scroll(250, 700);
  });
  await r.say('Y con Verificar ahora compruebas que nadie alteró ese registro.', async () => {
    await r.scroll(-400, 400);
    await r.click('main button:has-text("Verificar ahora")', { wait: 1300 });
    await r.moveTo('main >> text=/Íntegra/', { ms: 700 });
  });
  await r.say('También puedes hacer que el programa se bloquee solo, si nadie lo usa por un rato.', async () => {
    await r.moveTo(p().getByLabel('Minutos sin actividad'), { ms: 800 });
  });
  await r.say('Y lo más importante: los respaldos. En Respaldos haces una copia cifrada de toda tu empresa, protegida con una contraseña.', async () => {
    await hideDemoBits();
    await r.click('main >> text="Respaldos"', { wait: 900 });
    await r.click(p().getByLabel('Contraseña del respaldo').first(), { wait: 200 });
    await r.type('MiRespaldo2026', 80);
    await r.click(p().getByLabel('Repetir contraseña'), { wait: 200 });
    await r.type('MiRespaldo2026', 80); await sleep(300);
    await r.moveTo('main button:has-text("Crear respaldo")', { ms: 700 });
  });
  await r.say('Guarda esa copia fuera del computador: en un pendrive, o en tu nube personal. Va cifrada: nadie puede abrirla sin tu contraseña.', async () => {
    await r.highlightCard('Crear respaldo');
    await sleep(3500); await r.unhighlight();
  });
  await r.say('Si se te echa a perder el computador, instalas NÚCLEO en otro, restauras el respaldo, y sigues como si nada.', async () => {
    await r.highlightCard('Restaurar respaldo');
    await r.moveTo('main >> text="Restaurar respaldo"', { dy: 40, ms: 900 }); await sleep(2500); await r.unhighlight();
  });
  await r.say('Mi consejo: un respaldo cada semana. Y guarda tu clave de recuperación en un lugar seguro.', async () => {
    await r.moveTo({ x: 900, y: 300 }, { ms: 1000 });
  });
  await r.say('Tu empresa. Tus datos. Tu computador. Descárgalo gratis en nucleoerp.cl.', async () => {
    await r.moveTo({ x: 760, y: 300 }, { ms: 1200 });
  });

  await r.stop();
})().catch((e) => { console.error(e); process.exit(1); });
