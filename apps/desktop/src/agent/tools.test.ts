import { describe, expect, it } from "vitest";
import { DemoBackend } from "../data/demo/store";
import { historicalTerms, runTool, TOOL_DEFS } from "./tools";

const txt = (r: { content: { text: string }[] }) => r.content.map((c) => c.text).join("\n");

describe("herramientas de Claude", () => {
  it("cada herramienta tiene nombre único, nivel y esquema de objeto", () => {
    const names = TOOL_DEFS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const t of TOOL_DEFS) {
      expect(["ver", "borradores", "completo"]).toContain(t.nivel);
      expect((t.inputSchema as { type: string }).type).toBe("object");
      expect(t.description.length).toBeGreaterThan(20);
    }
  });

  it("el nivel limita lo que se puede hacer", async () => {
    const b = new DemoBackend();
    const r = await runTool(b, "ver", "crear_cliente", { nombre: "X" });
    expect(r.isError).toBe(true);
    expect(txt(r)).toMatch(/Configuración → Claude/);
    const g = await runTool(b, "borradores", "registrar_gasto", { descripcion: "Bencina", total: 20000, categoria: "combustible", pagado_con: "efectivo" });
    expect(g.isError).toBe(true);
    expect(txt(g)).toMatch(/Acceso completo/);
  });

  it("crea cliente sin duplicar RUT, arma una venta y la cobra", async () => {
    const b = new DemoBackend();
    const c1 = await runTool(b, "borradores", "crear_cliente", { nombre: "Panadería La Espiga", rut: "76.123.456-0" });
    expect(txt(c1)).toMatch(/Cliente creado/);
    const c2 = await runTool(b, "borradores", "crear_cliente", { nombre: "Otra", rut: "76123456-0" });
    expect(txt(c2)).toMatch(/Ya existía/);
    const v = await runTool(b, "borradores", "crear_venta_borrador", {
      cliente: "76.123.456-0", lineas: [{ descripcion: "Instalación", precio_neto: 10000, cantidad: 2 }],
    });
    expect(v.isError).toBeUndefined();
    expect(txt(v)).toMatch(/total \$23\.800/);
    const uid = txt(v).match(/Identificador: (\S+)/)![1]!;
    expect((await runTool(b, "completo", "confirmar_venta", { venta: uid, modo: "credito" })).isError).toBeUndefined();
    const cobro = await runTool(b, "completo", "registrar_cobro", { venta: uid, monto: 3800 });
    expect(txt(cobro)).toMatch(/Queda por cobrar \$20\.000/);
    const demasiado = await runTool(b, "completo", "registrar_cobro", { venta: uid, monto: 999999 });
    expect(demasiado.isError).toBe(true);
  });

  it("explica qué falta cuando un dato no calza", async () => {
    const b = new DemoBackend();
    const g = await runTool(b, "borradores", "registrar_gasto", { descripcion: "x", total: 1000, categoria: "categoría inexistente" });
    expect(g.isError).toBe(true);
    expect(txt(g)).toMatch(/Categorías:/);
    const v = await runTool(b, "borradores", "crear_venta_borrador", { lineas: [{ descripcion: "Sin precio" }] });
    expect(txt(v)).toMatch(/precio_neto/);
    expect(txt(await runTool(b, "ver", "no_existe", {}))).toMatch(/No existe/);
  });

  it("importa ventas históricas sin duplicar", async () => {
    const b = new DemoBackend();
    const doc = {
      tipo_documento: "Factura electrónica", folio: "437", fecha: "2026-09-29",
      cliente: { nombre: "Tratamientos Médicos de Avanzada SpA", rut: "76.911.593-5", comuna: "Providencia" },
      lineas: [{ descripcion: "RCW-360 PLUS 4G", cantidad: 1, precio_unitario: 194580, valor_neto: 194580 }, { descripcion: "Verificación refrigerado", cantidad: 1, precio_unitario: 15000, valor_neto: 15000 }],
      neto: 209580, iva: 39820, total: 249400, forma_pago: "Contado",
    };
    const r = await runTool(b, "completo", "importar_ventas_historicas", { documentos: [doc] });
    expect(txt(r)).toMatch(/Importadas 1 .* clientes nuevos 1/);
    const again = await runTool(b, "completo", "importar_ventas_historicas", { documentos: [doc] });
    expect(txt(again)).toMatch(/Importadas 0 · actualizadas 0 · ya estaban 1/);
    const sales = await b.listSales({ view: "todas", query: "FE-437" });
    expect(sales[0]?.historical).toBe(true);
    expect(sales[0]?.payment_state).toBe("pagada");
    expect((await runTool(b, "borradores", "importar_ventas_historicas", { documentos: [doc] })).isError).toBe(true);
  });

  it("importa clientes sin duplicar y completa los que ya existen", async () => {
    const b = new DemoBackend();
    const r = await runTool(b, "borradores", "importar_clientes", { clientes: [
      { nombre: "Hospital de Coquimbo", rut: "61.606.403-7", correo: "ingrid.seida@redsalud.gob.cl", contacto: "Ingrid Seida", notas: "Origen: OC Insumos Pardo" },
      { nombre: "Hospital de Coquimbo", rut: "61606403-7", correo: "otra@redsalud.gob.cl", notas: "Otro contacto: otra@redsalud.gob.cl" },
    ] });
    expect(txt(r)).toMatch(/nuevos 1 · completados 1/);
    const [c] = await b.searchCustomers("61606403");
    const d = await b.customer(c!.uid);
    expect(d.email).toBe("ingrid.seida@redsalud.gob.cl");
    expect(d.contact_name).toBe("Ingrid Seida");
    expect(d.notes).toMatch(/Otro contacto/);
    expect(txt(await runTool(b, "borradores", "importar_clientes", { clientes: [{ nombre: "Hospital de Coquimbo", rut: "61.606.403-7", notas: "Origen: OC Insumos Pardo" }] }))).toMatch(/sin cambios 1/);
    // Guardado sin puntos, importado con puntos: completa, no choca con «ya existe».
    await b.addCustomer({ name: "Hospital de Curicó", rut: "61606903-9", kind: "empresa" });
    const r2 = await runTool(b, "borradores", "importar_clientes", { clientes: [{ nombre: "Hospital de Curicó", rut: "61.606.903-9", correo: "compras@hospitalcurico.cl" }] });
    expect(txt(r2)).toMatch(/nuevos 0 · completados 1/);
  });
});

describe("historial a crédito", () => {
  it("lee la orden de compra y la fecha de pago de la factura", () => {
    const t = historicalTerms("Crédito", "- Guia Despacho Electrónica N° 22 del 2026-09-01 - Orden Compra N° 22.112 del 2026-11-18 - TipoDoc.HES N° 6005 del 2026-11-18 Pagos: 2026-12-18      $ 1.140.020 OC N° 22.112 Forma de Pago:Crédito");
    expect(t?.payment).toBe("credito");
    expect(t?.due_date).toBe("2026-12-18");
    expect(t?.references.map((r) => `${r.kind}:${r.folio}:${r.date}`)).toEqual(["52:22:2026-09-01", "801:22.112:2026-11-18", "HES:6005:2026-11-18"]);
    expect(historicalTerms("Contado", "")).toBeNull();
    expect(historicalTerms("Contado", "", "4464-504-AG26")?.references[0]?.folio).toBe("4464-504-AG26");
  });

  it("una factura ya importada queda por cobrar al enviarla con vencimiento", async () => {
    const b = new DemoBackend();
    const doc = { tipo_documento: "Factura electrónica", folio: "521", fecha: "2026-11-18", cliente: { nombre: "Lácteos del Sur", rut: "76716680-K" },
      lineas: [{ descripcion: "RC-17N", cantidad: 200, precio_unitario: 4790, valor_neto: 958000 }], neto: 958000, iva: 182020, total: 1140020,
      forma_pago: "Crédito", referencias: "- Orden Compra N° 22.112 del 2026-11-18 Pagos: 2026-12-18 $ 1.140.020" };
    await runTool(b, "completo", "importar_ventas_historicas", { documentos: [doc] });
    const r = await runTool(b, "completo", "importar_ventas_historicas", { documentos: [{ ...doc, vencimiento: "2026-12-18" }] });
    expect(txt(r)).toMatch(/actualizadas 1/);
    const [s] = await b.listSales({ view: "por_cobrar", query: "FE-521" });
    expect(s?.total_minor).toBe(1140020);
    const d = await b.sale(s!.uid);
    expect(d.terms?.references[0]?.folio).toBe("22.112");
    expect(d.terms?.due_date).toBe("2026-12-18");
    expect(txt(await runTool(b, "completo", "registrar_cobro", { venta: "FE-521", monto: 1140020, fecha: "2026-12-18" }))).toMatch(/Queda por cobrar \$0/);
  });
});

describe("Mercado Libre leído en el portal", () => {
  it("registra ventas sin duplicar: con stock, con factura y por revisar", async () => {
    const b = new DemoBackend();
    const [p] = (await b.searchProducts("")).filter((x) => x.kind === "producto" && x.on_hand_milli >= 3000);
    const before = p!.on_hand_milli;
    const venta = (n: string, extra: Record<string, unknown>) => ({ venta: n, fecha: "2026-11-22", comprador: "Jorge Parra", rut: "16531719-K", lineas: [{ producto: p!.sku, titulo: "Publicación", cantidad: 1, precio: 29900 }], comision: 3588, envio: 3050, ...extra });
    const r = await runTool(b, "completo", "registrar_ventas_mercadolibre", { ventas: [
      venta("2000016197919421", { descontar_stock: true }),
      venta("2000015857847519", {}),
      venta("2000015203388493", { factura: "999999" }),
    ] });
    expect(txt(r)).toMatch(/registradas 1 · por revisar 2/);
    expect(txt(r)).toMatch(/factura N° 999999 no está en NÚCLEO/);
    expect((await b.searchProducts(p!.sku)).find((x) => x.uid === p!.uid)!.on_hand_milli).toBe(before - 1000);
    const again = await runTool(b, "completo", "registrar_ventas_mercadolibre", { ventas: [venta("2000016197919421", { descontar_stock: true })] });
    expect(txt(again)).toMatch(/sin cambios 1/);
    expect((await b.searchProducts(p!.sku)).find((x) => x.uid === p!.uid)!.on_hand_milli).toBe(before - 1000);
    const o = (await b.mlOrders()).find((x) => x.order_id === "2000016197919421")!;
    expect([o.total_minor, o.sale_fee_minor, o.shipping_cost_minor, o.net_minor]).toEqual([29900, 3588, 3050, 23262]);
    expect((await runTool(b, "borradores", "registrar_ventas_mercadolibre", { ventas: [venta("1", {})] })).isError).toBe(true);
  });
});

describe("Accesos (gestor de contraseñas)", () => {
  it("guarda accesos de solo lectura y nunca entrega la clave", async () => {
    const b = new DemoBackend();
    expect(txt(await runTool(b, "ver", "listar_accesos", {}))).toMatch(/No hay accesos guardados/);
    const base = { name: "Mercado Libre", login_url: "https://www.mercadolibre.cl/", username: "colaborador@ejemplo.cl", password: "clave-de-ejemplo", kind: "lectura" as const, no_payments: true };
    await expect(b.saveAccess(null, { ...base, no_payments: false })).rejects.toThrow(/no puede pagar ni transferir/);
    await expect(b.saveAccess(null, { ...base, login_url: "https://zeusr.sii.cl/" })).rejects.toThrow(/Clave Tributaria/);
    await expect(b.saveAccess(null, { ...base, password: "" })).rejects.toThrow(/clave/);
    const a = await b.saveAccess(null, base);
    expect(JSON.stringify(await b.accesses())).not.toMatch(/clave-de-ejemplo/);
    const listed = txt(await runTool(b, "ver", "listar_accesos", {}));
    expect(listed).toMatch(/Mercado Libre .* usuario colaborador@ejemplo\.cl · solo lectura · clave guardada/);
    expect(listed).not.toMatch(/clave-de-ejemplo/);
    await expect(b.saveAccess(null, base)).rejects.toThrow(/Ya hay un acceso/);
    expect((await b.saveAccess(a.uid, { ...base, password: "", username: "otro@ejemplo.cl" })).username).toBe("otro@ejemplo.cl");
    expect(await b.deleteAccess(a.uid)).toHaveLength(0);
  });
});

describe("WooCommerce (demostración)", () => {
  it("conecta, trae pedidos con su envío sin duplicar y compara stock y precios sin enviar", async () => {
    const b = new DemoBackend();
    expect((await runTool(b, "completo", "sincronizar_woocommerce", {})).isError).toBe(true);
    await expect(b.wooConnect({ url: "http://tienda.cl", consumer_key: "ck_a", consumer_secret: "cs_b", code: "" })).rejects.toThrow(/https/);
    const st = await b.wooConnect({ url: "https://tienda.cl/", consumer_key: "ck_llave1234", consumer_secret: "cs_secreta", code: "" });
    expect(st.connected).toBe(true);
    expect(JSON.stringify(st)).not.toMatch(/cs_secreta|ck_llave1234/);
    const r = await runTool(b, "completo", "sincronizar_woocommerce", {});
    expect(txt(r)).toMatch(/ventas nuevas 1 · completadas 0 · por revisar 1 · envíos anotados 1/);
    expect(txt(r)).toMatch(/SKU WEB-SIN-NUCLEO/);
    const again = await runTool(b, "completo", "sincronizar_woocommerce", {});
    expect(txt(again)).toMatch(/ventas nuevas 0 .* sin cambios 1/);
    const orders = await b.wooOrders();
    const ok = orders.find((o) => o.status === "importada")!;
    expect(ok.shipment_number).toMatch(/^ENV/);
    expect((await b.shipments(ok.sale_uid)).length).toBe(1);
    expect(txt(await runTool(b, "ver", "pedidos_woocommerce", {}))).toMatch(/2 pedidos de la tienda/);
    expect((await runTool(b, "borradores", "sincronizar_woocommerce", {})).isError).toBe(true);
    // Comparar no envía nada: la segunda comparación muestra los mismos cambios.
    const c1 = txt(await runTool(b, "ver", "comparar_woocommerce", { que: "ambos" }));
    expect(c1).toMatch(/Cambiarían \d+ \(nada se envió\)/);
    expect(txt(await runTool(b, "ver", "comparar_woocommerce", { que: "ambos" }))).toBe(c1);
    // Enviar (lo hace la persona en la pantalla) deja la tienda igual que NÚCLEO.
    expect((await b.wooPush(true, true, true)).applied).toBe(true);
    expect(txt(await runTool(b, "ver", "comparar_woocommerce", { que: "ambos" }))).toMatch(/No hay diferencias/);
  });
});

describe("Mercado Libre (demostración)", () => {
  it("conecta, trae pedidos sin duplicar y deja por revisar lo que no tiene producto", async () => {
    const b = new DemoBackend();
    await expect(b.mlConnect()).rejects.toThrow(/App ID/);
    await b.mlSaveApp("1234567890", "secreto");
    await b.mlConnect();
    expect((await b.mlWait()).connected).toBe(true);
    const r = await runTool(b, "completo", "sincronizar_mercadolibre", {});
    expect(txt(r)).toMatch(/ventas nuevas 1 · completadas 0 · por revisar 1 · por facturar 1/);
    const again = await runTool(b, "completo", "sincronizar_mercadolibre", {});
    expect(txt(again)).toMatch(/ventas nuevas 0 .* sin cambios 1/);
    const orders = await b.mlOrders();
    const review = orders.find((o) => o.status === "por_revisar")!;
    expect(review.needs_invoice).toBe(true);
    const [p] = await b.searchProducts("");
    await b.mlLinkItem("MLC-DEMO-2", null, p!.uid);
    const done = await b.mlSync();
    expect(done.completed).toBe(1);
    expect(txt(await runTool(b, "ver", "pedidos_mercadolibre", {}))).toMatch(/2 pedidos de Mercado Libre/);
    expect((await runTool(b, "borradores", "sincronizar_mercadolibre", {})).isError).toBe(true);
  });
});

describe("Envíos con datos del courier (demostración)", () => {
  it("registra un envío unido a la venta y lo actualiza por seguimiento", async () => {
    const b = new DemoBackend();
    const [sale] = (await b.listSales({ view: "todas" })).filter((s) => s.commercial_state === "efectuada" || s.commercial_state === "cerrada");
    const r = await runTool(b, "borradores", "registrar_envio", {
      venta: sale!.number, agencia: "Bluexpress", seguimiento: "2480522914", nombre: "Clinica Rauquen", apellido: "SpA",
      correo: "recepcion@clinicarauquen.cl", region: "Región del Maule", comuna: "Curicó", calle: "Avenida Lyon", numero: "1801",
      tipo_entrega: "domicilio", punto_origen: "Punto Blue Express Market Plaza Ñuñoa", contenido: "Registrador RC-5+", valor_declarado: 27900,
      talla: "S", sin_mercancias_peligrosas: true, costo: 3920, transaccion: "MWS6REU73M5A0M4X5F3",
    });
    expect(txt(r)).toMatch(new RegExp(`creado y unido a la venta ${sale!.number}.*Avenida Lyon 1801, Curicó.*talla S.*3\\.920`));
    const upd = await runTool(b, "borradores", "registrar_envio", { seguimiento: "2480522914", estado: "en_camino" });
    expect(txt(upd)).toMatch(/actualizado.*en_camino/);
    const list = await runTool(b, "ver", "listar_envios", { texto: "2480522914" });
    expect(txt(list)).toMatch(/1 envíos:.*Bluexpress 2480522914 · en_camino/s);
    expect((await runTool(b, "ver", "registrar_envio", { agencia: "X" })).isError).toBe(true);
  });

  it("factura del SII: firma sin enviar, envía y consulta", async () => {
    const b = new DemoBackend();
    await b.siiSaveSetup({ ambiente: "certificacion", emisor: { giro: "Software", actecos: [620100], direccion: "Guardia Vieja 202", comuna: "Providencia", ciudad: "Santiago", sucursal: null, rut_envia: "", unidad_sii: "" }, resolucion_fecha: "2026-11-22", resolucion_numero: 0 });
    await b.siiLoadCertificate("demo.pfx", "1234");
    await b.siiLoadCaf("demo.xml");
    const e = await runTool(b, "completo", "emitir_documento_sii", {
      tipo: 33, receptor: { rut: "76.123.456-0", razon_social: "Cliente de Prueba", giro: "Comercio", direccion: "Calle 1", comuna: "Santiago" },
      lineas: [{ nombre: "Servicio", cantidad: 2, precio: 10000, descuento_pct: 10 }], referencias: [{ tipo: "SET", razon: "CASO 1-1" }],
    });
    expect(e.isError).toBeUndefined();
    expect(txt(e)).toMatch(/33-1 .*\$21\.420 · firmado/);
    expect((await runTool(b, "ver", "enviar_documentos_sii", { documentos: ["33-1"] })).isError).toBe(true);
    const s = await runTool(b, "completo", "enviar_documentos_sii", { documentos: ["33-1"] });
    expect(txt(s)).toMatch(/enviado/);
    expect(txt(await runTool(b, "completo", "enviar_documentos_sii", { documentos: ["33-1"] }))).toMatch(/Ya fueron enviados/);
    expect(txt(await runTool(b, "ver", "consultar_estado_sii", { documento: "33-1" }))).toMatch(/aceptado/);
    const g = await runTool(b, "completo", "emitir_documento_sii", {
      tipo: 33, receptor: { rut: "76.123.456-0", razon_social: "Cliente de Prueba", giro: "Comercio", direccion: "Calle 1", comuna: "Santiago" },
      lineas: [{ nombre: "ITEM 1 AFECTO", cantidad: 100, precio: 1910 }, { nombre: "ITEM 2 AFECTO", cantidad: 43, precio: 1730 }, { nombre: "ITEM 3 SERVICIO EXENTO", cantidad: 2, precio: 6771, exento: true }],
      descuento_global_pct: 7,
    });
    expect(txt(g)).toMatch(/33-2 .*\$307\.249/);
    expect(txt(await runTool(b, "ver", "listar_documentos_sii", {}))).toMatch(/quedan 48/);
    const lv = await runTool(b, "completo", "crear_libro_sii", { operacion: "venta", periodo: new Date().toISOString().slice(0, 7), tipo_libro: "ESPECIAL", folio_notificacion: 5198397, documentos: ["33-1"] });
    expect(txt(lv)).toMatch(/libro 1: ventas .* 1 docs · firmado/);
    const lc = await runTool(b, "completo", "crear_libro_sii", { operacion: "compra", periodo: "2026-11", tipo_libro: "ESPECIAL", folio_notificacion: 5198398, factor_proporcionalidad: 0.6,
      compras: [{ tipo: 30, folio: 781, rut: "33333333-3", razon_social: "Proveedor", neto: 30229, iva_uso_comun: true }, { tipo: 46, folio: 9, rut: "66666666-6", razon_social: "Otro", neto: 10793, retencion_total: true }] });
    expect(txt(lc)).toMatch(/uso común \$5\.744/);
    expect(txt(lc)).toMatch(/retenido \$2\.051, total \$10\.793/);
    expect(txt(await runTool(b, "completo", "enviar_libro_sii", { libro: 1 }))).toMatch(/enviado/);
    expect(txt(await runTool(b, "ver", "consultar_libro_sii", { libro: 1 }))).toMatch(/aceptado/);
    const il = await runTool(b, "completo", "responder_intercambio_sii", { ruta: "C:/x/ENVIO_DTE.xml" });
    expect(txt(il)).toMatch(/Error en RUT Receptor/);
    expect(txt(il)).toMatch(/indica «carpeta» y «recinto»/);
    expect((await runTool(b, "completo", "responder_intercambio_sii", { ruta: "C:/x/ENVIO_DTE.xml", carpeta: "C:/x" })).isError).toBe(true);
    expect(txt(await runTool(b, "completo", "responder_intercambio_sii", { ruta: "C:/x/ENVIO_DTE.xml", carpeta: "C:/x", recinto: "Oficina" }))).toMatch(/3_EnvioRecibos_demo\.xml/);
  });

  it("factura del SII desde una venta: primero el borrador, después timbra", async () => {
    const b = new DemoBackend();
    await b.siiSaleDraft("no-existe").catch(() => undefined);
    await b.siiSaveSetup({ ambiente: "certificacion", emisor: { giro: "Software", actecos: [620100], direccion: "Guardia Vieja 202", comuna: "Providencia", ciudad: "Santiago", sucursal: null, rut_envia: "", unidad_sii: "" }, resolucion_fecha: "2026-11-22", resolucion_numero: 0 });
    await b.siiLoadCertificate("demo.pfx", "1234");
    await b.siiLoadCaf("demo.xml");
    await runTool(b, "borradores", "crear_cliente", { nombre: "Panadería La Espiga", rut: "76.123.456-0" });
    const v = await runTool(b, "borradores", "crear_venta_borrador", { cliente: "76.123.456-0", lineas: [{ descripcion: "Instalación", precio_neto: 10000, cantidad: 2 }] });
    const uid = txt(v).match(/Identificador: (\S+)/)![1]!;
    expect((await runTool(b, "completo", "emitir_venta_sii", { venta: uid })).isError).toBe(true);
    await runTool(b, "completo", "confirmar_venta", { venta: uid, modo: "credito" });
    const borrador = await runTool(b, "completo", "emitir_venta_sii", { venta: uid });
    expect(txt(borrador)).toMatch(/Borrador: aún no se timbra/);
    expect(txt(borrador)).toMatch(/Instalación: 2 × \$10\.000 = \$20\.000/);
    expect(txt(await runTool(b, "ver", "listar_documentos_sii", {}))).toMatch(/Aún no hay documentos/);
    const ok = await runTool(b, "completo", "emitir_venta_sii", { venta: uid, confirmar: true });
    expect(txt(ok)).toMatch(/33-1 .*\$23\.800 · firmado/);
    expect((await runTool(b, "completo", "emitir_venta_sii", { venta: uid, confirmar: true })).isError).toBe(true);
  });
});
