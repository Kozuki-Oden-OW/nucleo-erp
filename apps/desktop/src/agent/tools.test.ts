import { describe, expect, it } from "vitest";
import { DemoBackend } from "../data/demo/store";
import { historicalTerms, runTool, TOOL_DEFS } from "./tools";
import { formatChange } from "./web";

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

describe("venta con los datos del SII", () => {
  it("factura: receptor con ciudad, descripción extendida, orden de compra recordada y forma de pago", async () => {
    const b = new DemoBackend();
    await runTool(b, "borradores", "crear_cliente", { nombre: "Asurity SpA", rut: "78.169.652-8", giro: "Servicios de seguridad", direccion: "Av. Providencia 1234", comuna: "Providencia" });
    // La ciudad se propone desde la comuna: el SII la exige y no la completa.
    expect(txt(await runTool(b, "ver", "buscar_clientes", { texto: "Asurity" }))).toMatch(/Providencia, Santiago · contado$/);
    const sin = await runTool(b, "borradores", "crear_venta_borrador", { documento: "factura", lineas: [{ descripcion: "Servicio", precio_neto: 1000 }] });
    expect(sin.isError).toBe(true);
    expect(txt(sin)).toMatch(/La factura necesita un cliente/);
    const v = txt(await runTool(b, "borradores", "crear_venta_borrador", {
      cliente: "78.169.652-8", documento: "factura",
      lineas: [{ descripcion: "Verificación de puntos", detalle: "Puntos 2 °C y 8 °C · serie EF123", precio_neto: 15000, cantidad: 2 }],
      referencias: [{ tipo: "orden de compra", folio: "4500012345", fecha: "2026-11-20" }],
    }));
    expect(v).toMatch(/Documento: Factura · forma de pago Contado · referencias: Orden de Compra 4500012345/);
    expect(v).toMatch(/total \$35\.700/);
    const uid = v.match(/Identificador: (\S+)/)![1]!;
    const ver = txt(await runTool(b, "ver", "ver_venta", { venta: uid }));
    expect(ver).toMatch(/· Factura · fecha/);
    expect(ver).toMatch(/- Rut: 78169652-8\n- Razón Social: Asurity SpA\n- Tipo de Compra: Del Giro\n- Dirección: Av\. Providencia 1234\n- Comuna: Providencia\n- Ciudad: Santiago\n- Giro: Servicios de seguridad/);
    expect(ver).toMatch(/1\. Verificación de puntos · 2 · \$15\.000 · — · \$30\.000\n {3}Descrip\.: Puntos 2 °C y 8 °C · serie EF123/);
    expect(ver).toMatch(/- Orden de Compra · 4500012345 · 2026-11-20 · —/);
    expect(ver).toMatch(/FORMA DE PAGO: Contado \(Transferencia\)/);
    expect(ver).not.toMatch(/Falta para emitir/);
    // El cliente queda recordado: la próxima venta sin orden de compra lo avisa.
    expect(txt(await runTool(b, "ver", "buscar_clientes", { texto: "Asurity" }))).toMatch(/trabaja con orden de compra/);
    const v2 = txt(await runTool(b, "borradores", "crear_venta_borrador", { cliente: "Asurity", documento: "factura", forma_pago: "credito", dias_credito: 45, lineas: [{ descripcion: "Calibración", precio_neto: 50000 }] }));
    expect(v2).toMatch(/forma de pago Crédito 45 días/);
    expect(v2).toMatch(/trabaja con orden de compra y no se anotó ninguna/);
  });

  it("actualiza la ficha del cliente y dice qué falta para facturarle", async () => {
    const b = new DemoBackend();
    await runTool(b, "borradores", "crear_cliente", { nombre: "Insumos Pardo Ltda", rut: "77.778.342-4" });
    expect((await runTool(b, "borradores", "actualizar_cliente", { cliente: "77.778.342-4", ciudad: "Santiago" })).isError).toBe(true);
    const up = txt(await runTool(b, "completo", "actualizar_cliente", { cliente: "77.778.342-4", giro: "Venta de insumos", comuna: "Ñuñoa", ciudad: "Santiago", trabaja_con_oc: true }));
    expect(up).toMatch(/giro: «vacío» → «Venta de insumos»/);
    expect(up).toMatch(/orden de compra: no la pedía → trabaja con orden de compra/);
    expect(up).toMatch(/todavía falta: dirección/);
    expect(txt(await runTool(b, "completo", "actualizar_cliente", { cliente: "77.778.342-4", ciudad: "Santiago" }))).toMatch(/^Sin cambios/);
    const guia = txt(await runTool(b, "borradores", "crear_venta_borrador", { cliente: "77.778.342-4", documento: "guia", tipo_traslado: 5, lineas: [{ descripcion: "Data logger", precio_neto: 20000 }] }));
    expect(guia).toMatch(/Documento: Guía de despacho/);
    expect(guia).toMatch(/Al receptor le falta dirección/);
    const uid = guia.match(/Identificador: (\S+)/)![1]!;
    expect(txt(await runTool(b, "ver", "ver_venta", { venta: uid }))).toMatch(/Tipo Traslado: Traslados internos/);
  });
});

describe("boleta electrónica y accesos del SII", () => {
  it("arma el detalle de la e-Boleta en 80 caracteres", async () => {
    const { eboletaDetail } = await import("../data/saleTerms");
    expect(eboletaDetail([{ description: "RC-5+", qty_milli: 7000 }, { description: "RC-51H", qty_milli: 8000 }])).toBe("7 X RC-5+, 8 X RC-51H");
    const largo = eboletaDetail(Array.from({ length: 6 }, (_, i) => ({ description: `Registrador de temperatura modelo ${i}`, qty_milli: 1500 })));
    expect(largo.length).toBeLessThanOrEqual(80);
    expect(largo).toMatch(/^1,5 X Registr/);
    expect(eboletaDetail(Array.from({ length: 30 }, (_, i) => ({ description: `Producto ${i}`, qty_milli: 1000 }))).length).toBeLessThanOrEqual(80);
    const b = new DemoBackend();
    const v = txt(await runTool(b, "borradores", "crear_venta_borrador", { documento: "boleta", medio_pago: "efectivo", lineas: [{ descripcion: "RC-5+", precio_neto: 10000, cantidad: 7 }, { descripcion: "RC-51H", precio_neto: 12000, cantidad: 8 }] }));
    const ver = txt(await runTool(b, "ver", "ver_venta", { venta: v.match(/Identificador: (\S+)/)![1]! }));
    expect(ver).toMatch(/PARA LA e-BOLETA DEL SII/);
    expect(ver).toMatch(/- Monto: \$197\.540 \(total con IVA\)\n- Tipo: Boleta afecta\n- Método de pago: Efectivo\n- Detalle \(máx\. 80\): 7 X RC-5\+, 8 X RC-51H/);
  });
  it("del SII solo se guarda el acceso a e-Boleta", async () => {
    const b = new DemoBackend();
    const base = { username: "17256184-5", password: "x", kind: "operador" as const, notes: "", no_payments: true };
    await expect(b.saveAccess(null, { ...base, name: "SII", login_url: "https://zeusr.sii.cl/AUT2000/" })).rejects.toThrow(/solo se guarda el acceso a e-Boleta/);
    await expect(b.saveAccess(null, { ...base, name: "Otro", login_url: "https://eboleta.sii.cl.malo.com/" })).rejects.toThrow(/e-Boleta/);
    expect((await b.saveAccess(null, { ...base, name: "SII e-Boleta", login_url: "https://eboleta.sii.cl/" })).name).toBe("SII e-Boleta");
  });
});

describe("navegador: solo lo que cambió", () => {
  const st = { open: true, url: "https://www1.sii.cl/f", loading: false, blocked: null, downloads: [], folder: "D:\\Facturas" };
  const frame = (text: string, controls: { n: number; k: string; l: string; v?: string }[]) => ({ path: "", href: "https://www1.sii.cl/f?x=1", title: "F", type: "text/html", text, controls });
  it("informa texto y controles nuevos, y el aviso de la página", () => {
    const before = { url: "https://www1.sii.cl/f?x=1", title: "Factura", frames: [frame("DATOS RECEPTOR\nRut", [{ n: 1, k: "campo", l: "Rut", v: "" }, { n: 2, k: "botón", l: "Validar" }])] };
    const after = { url: "https://www1.sii.cl/f?x=1", title: "Factura", alerts: ["Debe ingresar la ciudad"], frames: [frame("DATOS RECEPTOR\nRut\nASURITY SPA", [{ n: 1, k: "campo", l: "Rut", v: "78169652" }, { n: 2, k: "botón", l: "Validar" }, { n: 9, k: "campo", l: "Linea2", v: "" }])] };
    const out = formatChange(before, after, st)!;
    expect(out).toMatch(/Aviso de la página: «Debe ingresar la ciudad»/);
    expect(out).toMatch(/Texto nuevo:\nASURITY SPA/);
    expect(out).toMatch(/\[w1\] campo «Rut» = «78169652»\n\[w9\] campo «Linea2»/);
    expect(out).not.toMatch(/Validar|DATOS RECEPTOR/);
    expect(formatChange(before, before, st)).toMatch(/Sin cambios visibles/);
  });
  it("si la página es otra, no hay resumen", () => {
    const before = { url: "https://www1.sii.cl/f", title: "A", frames: [frame("a", [])] };
    expect(formatChange(before, { url: "https://www1.sii.cl/otra", title: "B", frames: [frame("b", [])] }, st)).toBeNull();
    expect(formatChange(null, before, st)).toBeNull();
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
    await expect(b.saveAccess(null, { ...base, login_url: "https://zeusr.sii.cl/" })).rejects.toThrow(/solo se guarda el acceso a e-Boleta/);
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
    expect(txt(r)).toMatch(/sin SKU ni equivalencia/);
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

describe("códigos de producto", () => {
  it("cambia el SKU de varios productos sin tocar lo demás", async () => {
    const b = new DemoBackend();
    const goods = (await b.searchProducts("")).filter((p) => p.kind === "producto");
    const [a, c] = [goods[0]!, goods[1]!];
    expect((await runTool(b, "borradores", "actualizar_productos", { productos: [{ producto: a.sku, sku: "TLOG-10E" }] })).isError).toBe(true);
    const r = txt(await runTool(b, "completo", "actualizar_productos", { productos: [{ producto: a.sku, sku: "TLOG-10E" }, { producto: c.sku, sku: "RC-5+", precio_neto: c.price_minor }, { producto: "no-existe-xyz", sku: "X" }] }));
    expect(r).toMatch(/Productos actualizados: 2 · con error: 1/);
    expect(r).toMatch(new RegExp(`SKU ${a.sku} → TLOG-10E`));
    const now = (await b.searchProducts("TLOG-10E")).find((p) => p.uid === a.uid)!;
    expect([now.sku, now.name, now.price_minor, now.on_hand_milli, now.category_uid]).toEqual(["TLOG-10E", a.name, a.price_minor, a.on_hand_milli, a.category_uid]);
  });
});

describe("WooCommerce sin SKU: equivalencias (demostración)", () => {
  it("enlaza un producto y un combo de la tienda, y el pedido deja de estar por revisar", async () => {
    const b = new DemoBackend();
    await b.wooConnect({ url: "", consumer_key: "", consumer_secret: "", code: "nucleo-woo:demo" });
    const antes = txt(await runTool(b, "ver", "equivalencias_woocommerce", {}));
    expect(antes).toMatch(/2 sin reconocer/);
    expect(antes).toMatch(/tienda 902 · Producto solo de la tienda · \$12\.990 → sin reconocer/);
    expect((await runTool(b, "borradores", "guardar_equivalencias_woocommerce", { equivalencias: [{ producto_tienda: "902", productos: [] }] })).isError).toBe(true);
    const sync1 = txt(await runTool(b, "completo", "sincronizar_woocommerce", {}));
    expect(sync1).toMatch(/por revisar 1/);
    const goods = (await b.searchProducts("")).filter((p) => p.kind === "producto");
    const g = txt(await runTool(b, "completo", "guardar_equivalencias_woocommerce", { equivalencias: [
      { producto_tienda: "902", nombre: "Producto solo de la tienda", productos: [{ producto: goods[2]!.sku, cantidad: 5 }] },
      { producto_tienda: "903", nombre: "Combo", productos: [{ producto: goods[0]!.sku }, { producto: goods[1]!.sku, cantidad: 2 }] },
      { producto_tienda: "x1", productos: [{ producto: goods[0]!.sku }] },
    ] }));
    expect(g).toMatch(/Equivalencias guardadas: 2 · con error: 1/);
    expect(g).toMatch(new RegExp(`Combo = 1 × ${goods[0]!.sku} \\+ 2 × ${goods[1]!.sku}`));
    const despues = txt(await runTool(b, "ver", "equivalencias_woocommerce", { ver: "todas" }));
    expect(despues).toMatch(/2 por equivalencia · 0 sin reconocer/);
    expect(despues).toMatch(/tienda 902 · .* → equivalencia: 5 × /);
    const stock = goods[2]!.on_hand_milli;
    const sync2 = txt(await runTool(b, "completo", "sincronizar_woocommerce", {}));
    expect(sync2).toMatch(/completadas 1 · por revisar 0/);
    expect((await b.searchProducts(goods[2]!.sku)).find((p) => p.uid === goods[2]!.uid)!.on_hand_milli).toBe(stock - 5000);
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

describe("Banco leído en el portal (demostración)", () => {
  it("guarda los movimientos sin duplicar, sugiere la venta que pagan y la deja cobrada", async () => {
    const b = new DemoBackend();
    const cuentas = await runTool(b, "ver", "cuentas_dinero", {});
    expect(txt(cuentas)).toMatch(/cuentas?:/);
    const banco = (await b.moneyAccounts()).find((c) => c.kind === "banco" && !c.archived)!;
    const porCobrar = (await b.listSales({ view: "por_cobrar" }))[0]!;
    const monto = porCobrar.total_minor - porCobrar.paid_minor;
    const movs = [
      { fecha: "2026-11-23", descripcion: `Transferencia de ${porCobrar.customer_name}`, referencia: "88112233", monto, saldo: 5_000_000 },
      { fecha: "2026-11-23", descripcion: "Comisión mantención cuenta", monto: -4990 },
    ];
    // Sin acceso completo no se puede escribir.
    expect((await runTool(b, "borradores", "registrar_movimientos_banco", { cuenta: banco.uid, movimientos: movs })).isError).toBe(true);
    const r1 = await runTool(b, "completo", "registrar_movimientos_banco", { cuenta: banco.name, origen: "BCI, últimos movimientos", movimientos: movs });
    expect(txt(r1)).toMatch(/2 movimientos nuevos · 0 ya estaban/);
    const r2 = await runTool(b, "completo", "registrar_movimientos_banco", { cuenta: banco.uid, movimientos: movs });
    expect(txt(r2)).toMatch(/0 movimientos nuevos · 2 ya estaban/);

    const view = txt(await runTool(b, "ver", "conciliacion_banco", { cuenta: banco.uid }));
    expect(view).toMatch(/abono .*Transferencia de/);
    expect(view).toMatch(/cargo \$4\.990 · Comisión mantención cuenta/);
    const linea = (await b.bankReconciliation(banco.uid)).lines.find((l) => l.reference === "88112233")!;
    const cobrar = linea.suggestions.find((g) => g.action === "cobrar" && g.target_uid);
    expect(cobrar, "NÚCLEO sugiere la venta por cobrar del mismo monto").toBeTruthy();
    expect(view).toContain(`destino ${cobrar!.target_uid}`);

    expect((await runTool(b, "completo", "conciliar_movimiento_banco", { movimiento: linea.uid, accion: "cobrar" })).isError).toBe(true);
    const done = await runTool(b, "completo", "conciliar_movimiento_banco", { movimiento: linea.uid, accion: "cobrar", destino: cobrar!.target_uid });
    expect(txt(done)).toMatch(/quedó conciliado/);
    expect((await b.listSales({ view: "por_cobrar" })).some((s) => s.uid === porCobrar.uid && s.total_minor - s.paid_minor === monto)).toBe(false);
    expect((await runTool(b, "ver", "conciliacion_banco", { cuenta: "no existe" })).isError).toBe(true);
  });
});

describe("Cotizar y enviar por correo solo con NÚCLEO (demostración)", () => {
  const mail = { host: "smtp.ejemplo.cl", port: 465, security: "tls", username: "", password: "clave-de-prueba", from_name: "Ferretería Los Andes", from_email: "ventas@ejemplo.cl", reply_to: "", bcc_self: false };

  it("crea la cotización con precios netos, la emite en PDF y la envía solo con el permiso del dueño", async () => {
    const b = new DemoBackend();
    const [p1, p2] = await b.searchProducts("");
    const c = (await b.searchCustomers(""))[0]!;

    // Nivel «Solo ver»: no crea nada.
    expect((await runTool(b, "ver", "crear_cotizacion", { cliente: c.name, lineas: [{ producto: p1!.sku }] })).isError).toBe(true);

    const made = await runTool(b, "borradores", "crear_cotizacion", {
      cliente: c.name, validez_dias: 10,
      lineas: [{ producto: p1!.sku, cantidad: 2 }, { producto: p2!.sku, cantidad: 1, precio_neto: p2!.price_minor - 1000 }, { descripcion: "Instalación en terreno", precio_neto: 25000 }],
    });
    expect(made.isError, txt(made)).toBeFalsy();
    const number = /COT-\d+/.exec(txt(made))![0];
    expect(txt(made)).toContain("con IVA");
    // Avisa lo que se sale de la lista de precios, para revisarlo con la persona.
    expect(txt(made)).toMatch(/distinto del de lista/);
    expect(txt(made)).toMatch(/no es un producto de NÚCLEO/);
    const q = (await b.listQuotes(number)).find((x) => x.number === number)!;
    const detail = await b.quote(q.uid);
    expect(detail.lines[0]!.unit_price_minor).toBe(p1!.price_minor);
    expect(detail.status).toBe("borrador");

    const list = await runTool(b, "ver", "listar_cotizaciones", { texto: number });
    expect(txt(list)).toContain("TOTAL");

    // Enviar exige «Acceso completo», correo configurado y el permiso del dueño; y el PDF emitido.
    const args = { para: "compras@cliente.cl", asunto: `Cotización ${number}`, texto: "Estimados:\n\nAdjunto la cotización solicitada.\n\nSaludos", cotizaciones: [number] };
    expect((await runTool(b, "borradores", "enviar_correo", args)).isError).toBe(true);
    expect(txt(await runTool(b, "completo", "enviar_correo", args))).toMatch(/no está configurado/);
    await b.mailSave({ ...mail, agent_send: false });
    expect(txt(await runTool(b, "completo", "enviar_correo", args))).toMatch(/no tiene permiso/);
    expect(txt(await runTool(b, "ver", "correos_enviados", {}))).toMatch(/NO tiene permiso/);
    await b.mailSave({ ...mail, agent_send: true });
    expect(txt(await runTool(b, "completo", "enviar_correo", args))).toMatch(/emítela primero/);
    expect(await b.mailLog()).toHaveLength(0);

    const emitted = await runTool(b, "borradores", "emitir_cotizacion", { cotizacion: number, plantilla: "moderna", plazo_entrega: "5 días hábiles" });
    expect(emitted.isError, txt(emitted)).toBeFalsy();
    expect(txt(emitted)).toContain(`${number} `);
    expect(txt(emitted)).toContain("5 días hábiles");
    expect((await b.quoteTerms(q.uid)).delivery).toBe("5 días hábiles");
    expect((await runTool(b, "borradores", "emitir_cotizacion", { cotizacion: number, plantilla: "inventada" })).isError).toBe(true);
    expect((await runTool(b, "borradores", "emitir_cotizacion", { cotizacion: "COT-999999" })).isError).toBe(true);

    const sent = await runTool(b, "completo", "enviar_correo", args);
    expect(sent.isError, txt(sent)).toBeFalsy();
    expect(txt(sent)).toContain("compras@cliente.cl");
    expect(txt(sent)).toContain(`${number}.pdf`);
    expect((await b.quote(q.uid)).status).toBe("enviada");
    const log = await b.mailLog();
    expect(log).toHaveLength(1);
    expect(log[0]!.reference).toBe(number);
    expect(log[0]!.customer_name).toBe(c.name);
    expect(txt(await runTool(b, "ver", "correos_enviados", { cliente: c.name }))).toContain(`Cotización ${number}`);

    // Un correo sin asunto o sin texto no sale.
    expect((await runTool(b, "completo", "enviar_correo", { para: "a@b.cl", asunto: "", texto: "hola" })).isError).toBe(true);
  });

  it("un prospecto que aún no es cliente también se puede cotizar", async () => {
    const b = new DemoBackend();
    const p = (await b.searchProducts(""))[0]!;
    const r = await runTool(b, "borradores", "crear_cotizacion", { prospecto: "Laboratorio Alfa SpA", lineas: [{ producto: p.name }] });
    expect(r.isError, txt(r)).toBeFalsy();
    expect(txt(r)).toContain("Laboratorio Alfa SpA");
    expect((await runTool(b, "borradores", "crear_cotizacion", { lineas: [{ producto: p.name }] })).isError).toBe(true);
  });
});

describe("WhatsApp solo con NÚCLEO (demostración)", () => {
  const setup = { url: "http://127.0.0.1:47620", key: "nwsp_llave-de-prueba-0123456789", agent_send: false, ignore: ["+56 9 7777 7777"] };

  it("lee los chats sin los números excluidos y envía solo con el permiso del dueño", async () => {
    const b = new DemoBackend();
    expect(txt(await runTool(b, "ver", "whatsapp_chats", {}))).toMatch(/no está conectado/);
    await b.wspSave(setup);

    const chats = txt(await runTool(b, "ver", "whatsapp_chats", {}));
    expect(chats).toContain("Laboratorio Alfa");
    expect(chats).toContain("2 sin leer");
    expect(chats).not.toContain("Mamá");
    expect(chats).toMatch(/solo lee y propone/);
    expect(txt(await runTool(b, "ver", "whatsapp_chats", { solo_no_leidos: true }))).not.toContain("Constructora Sur");

    const conv = await runTool(b, "ver", "whatsapp_leer", { chat: "laboratorio" });
    expect(conv.isError, txt(conv)).toBeFalsy();
    expect(txt(conv)).toContain("taladro percutor");
    // El número excluido no se puede abrir ni por teléfono ni por id.
    expect((await runTool(b, "ver", "whatsapp_leer", { chat: "+56 9 7777 7777" })).isError).toBe(true);
    expect((await runTool(b, "ver", "whatsapp_leer", { chat: "56977777777@c.us" })).isError).toBe(true);

    const args = { chat: "Laboratorio Alfa", texto: "Buenas tardes. Sí, tenemos stock de 4 unidades. ¿Me indica RUT y razón social para la cotización?" };
    expect((await runTool(b, "borradores", "whatsapp_enviar", args)).isError).toBe(true);
    expect(txt(await runTool(b, "completo", "whatsapp_enviar", args))).toMatch(/no tiene permiso/);
    await b.wspSave({ ...setup, key: "", agent_send: true });
    const sent = await runTool(b, "completo", "whatsapp_enviar", args);
    expect(sent.isError, txt(sent)).toBeFalsy();
    expect(txt(await runTool(b, "ver", "whatsapp_leer", { chat: "56911111111" }))).toContain("Nosotros: Buenas tardes. Sí, tenemos stock");

    // Con una cotización: debe estar emitida; queda marcada como enviada.
    const p = (await b.searchProducts(""))[0]!;
    const made = await runTool(b, "borradores", "crear_cotizacion", { prospecto: "Laboratorio Alfa", lineas: [{ producto: p.sku, cantidad: 4 }] });
    const number = /COT-\d+/.exec(txt(made))![0];
    const withPdf = { chat: "Laboratorio Alfa", texto: "Le adjunto la cotización.", cotizaciones: [number] };
    expect(txt(await runTool(b, "completo", "whatsapp_enviar", withPdf))).toMatch(/emítela primero/);
    await runTool(b, "borradores", "emitir_cotizacion", { cotizacion: number });
    const ok = await runTool(b, "completo", "whatsapp_enviar", withPdf);
    expect(ok.isError, txt(ok)).toBeFalsy();
    expect(txt(ok)).toContain(`${number}.pdf`);
    expect((await b.listQuotes(number)).find((q) => q.number === number)!.status).toBe("enviada");
    // A un número excluido no se escribe.
    expect((await runTool(b, "completo", "whatsapp_enviar", { telefono: "+56 9 7777 7777", texto: "hola" })).isError).toBe(true);
    expect((await runTool(b, "completo", "whatsapp_enviar", { texto: "hola" })).isError).toBe(true);
  });
  it("cobranza: muestra la ronda y envía solo con el permiso de correo", async () => {
    const b = new DemoBackend();
    await runTool(b, "borradores", "crear_cliente", { nombre: "Clínica Sur", rut: "76.123.456-0", correo: "pagos@clinicasur.cl" });
    const v = await runTool(b, "borradores", "crear_venta_borrador", { cliente: "76.123.456-0", lineas: [{ descripcion: "Mapeo térmico", precio_neto: 100000, cantidad: 1 }] });
    const uid = txt(v).match(/Identificador: (\S+)/)![1]!;
    const past = new Date(Date.now() - 20 * 86_400_000).toISOString().slice(0, 10);
    await runTool(b, "completo", "confirmar_venta", { venta: uid, modo: "credito", vencimiento: past });

    const ronda = txt(await runTool(b, "ver", "ronda_cobranza", {}));
    expect(ronda).toMatch(/Clínica Sur · \$119\.000/);
    expect(ronda).toMatch(/pagos@clinicasur\.cl · listo para enviar/);
    expect(ronda).toMatch(/no está configurado/);

    expect((await runTool(b, "borradores", "enviar_cobranza", {})).isError).toBe(true);
    expect(txt(await runTool(b, "completo", "enviar_cobranza", {}))).toMatch(/no está configurado/);
    const mail = { host: "smtp.titan.email", port: 465, security: "tls", username: "ventas@datalogger.cl", password: "x", from_name: "Data Logger", from_email: "ventas@datalogger.cl", reply_to: "", bcc_self: false };
    await b.mailSave({ ...mail, agent_send: false });
    expect(txt(await runTool(b, "completo", "enviar_cobranza", {}))).toMatch(/no tiene permiso/);
    expect(await b.mailLog()).toHaveLength(0);
    await b.mailSave({ ...mail, agent_send: true });
    expect(txt(await runTool(b, "completo", "enviar_cobranza", { clientes: ["Nadie SpA"] }))).toMatch(/No encontré/);
    const sent = await runTool(b, "completo", "enviar_cobranza", {});
    expect(sent.isError).toBeUndefined();
    expect(txt(sent)).toMatch(/\d+ recordatorios? enviados?/);
    const log = await b.mailLog();
    expect(log.every((r) => r.kind === "cobro")).toBe(true);
    expect(log.filter((r) => r.to_addr === "pagos@clinicasur.cl")).toHaveLength(1);
    // Ya se le escribió: la ronda no lo repite, salvo que se pida por nombre.
    expect(txt(await runTool(b, "ver", "ronda_cobranza", {}))).toMatch(/ya se le escribió hace poco/);
    expect(txt(await runTool(b, "completo", "enviar_cobranza", {}))).toMatch(/No hay recordatorios listos/);
    expect(txt(await runTool(b, "completo", "enviar_cobranza", { clientes: ["clinica sur"] }))).toMatch(/1 recordatorio enviado/);
  });

  it("informe con meta, cobros recurrentes y reglas del banco", async () => {
    const b = new DemoBackend();
    expect(txt(await runTool(b, "ver", "informe_negocio", {}))).toMatch(/VENTAS[\s\S]*DINERO[\s\S]*No hay meta de ventas/);
    await b.digestSaveSettings({ enabled: true, weekdays: [1, 2, 3, 4, 5], hour: 8, to: "dueno@datalogger.cl", goal_minor: 900_000_000 });
    const informe = txt(await runTool(b, "ver", "informe_negocio", {}));
    expect(informe).toMatch(/Meta del mes: \$900\.000\.000 · llevas \d+ % · faltan/);
    expect(informe).toMatch(/de lunes a viernes desde las 08:00 a dueno@datalogger\.cl/);

    expect(txt(await runTool(b, "ver", "cobros_recurrentes", {}))).toMatch(/No hay cobros recurrentes/);
    const c = (await b.searchCustomers(""))[0]!;
    await b.saveRecurringSale({ name: "Monitoreo mensual", customer_uid: c.uid, lines: [{ product_uid: null, description: "Plataforma, 4 equipos", qty_milli: 1000, unit_price_minor: 40000, discount_ppm: 0, taxable: true }], notes: null, frequency: "mensual", next_date: "2020-01-05", end_date: null, credit_days: 10, confirm: true, send_mail: true, active: true });
    expect(txt(await runTool(b, "ver", "cobros_recurrentes", {}))).toMatch(/Monitoreo mensual · .* · mensual · \$47\.600 · próximo 2020-01-05 · TOCA GENERARLO/);

    expect(txt(await runTool(b, "ver", "reglas_banco", {}))).toMatch(/Aún no hay reglas/);
    expect((await runTool(b, "borradores", "guardar_regla_banco", { accion: "gasto", texto: "LIPIGAS", categoria: "combustible" })).isError).toBe(true);
    expect(txt(await runTool(b, "completo", "guardar_regla_banco", { accion: "gasto", texto: "LIPIGAS", categoria: "no existe" }))).toMatch(/No hay una categoría/);
    const regla = await runTool(b, "completo", "guardar_regla_banco", { accion: "gasto", texto: "Lipigas", categoria: "combustible", con_iva: true });
    expect(regla.isError).toBeUndefined();
    expect(txt(regla)).toMatch(/glosa «lipigas» \(cargo\) → gasto de Combustible \(con IVA incluido\)/);
    expect(txt(await runTool(b, "completo", "guardar_regla_banco", { accion: "ignorar", texto: "comision" }))).toMatch(/por qué se ignoran/);
    expect(txt(await runTool(b, "ver", "reglas_banco", {}))).toMatch(/1 reglas/);
  });

  it("series: registra con certificado, las une a la venta y las encuentra", async () => {
    const b = new DemoBackend();
    const p = (await b.searchProducts("")).find((x) => x.kind === "producto")!;
    const c = (await b.searchCustomers(""))[0]!;
    expect((await runTool(b, "ver", "registrar_series", { producto: p.sku, series: ["EF-1"] })).isError).toBe(true);
    const r = await runTool(b, "borradores", "registrar_series", {
      producto: p.sku, series: ["EF-724A-0011", "EF-724A-0012"],
      certificado: { numero: "CAL-2026-0456", laboratorio: "Lab acreditado", fecha: "2026-01-10", proxima_calibracion: "2027-01-10" },
    });
    expect(r.isError).toBeUndefined();
    expect(txt(r)).toMatch(/2 series/);
    expect(txt(r)).toMatch(/EF-724A-0011 · .* · en stock · certificado CAL-2026-0456 \(Lab acreditado\) del 2026-01-10 · próxima calibración 2027-01-10/);
    // Repetir no duplica.
    expect(txt(await runTool(b, "borradores", "registrar_series", { producto: p.sku, series: ["ef 724a 0011"] }))).toMatch(/ya estaba registrada/);
    expect(await b.serials({ product_uid: p.uid })).toHaveLength(2);

    const sale = await b.saveSale({ doc_type: "VEN", customer_uid: c.uid, issue_date: new Date().toISOString().slice(0, 10), lines: [{ product_uid: p.uid, description: p.name, qty_milli: 1000, unit_price_minor: p.price_minor, discount_ppm: 0, taxable: true }], terms: null });
    const two = await runTool(b, "borradores", "registrar_series", { producto: p.sku, series: ["EF-724A-0011", "EF-724A-0012"], venta: sale.number });
    expect(txt(two)).toMatch(/tiene 1 unidad\(es\)/);
    const one = await runTool(b, "borradores", "registrar_series", { producto: p.sku, series: ["EF-724A-0012"], venta: sale.number });
    expect(txt(one)).toMatch(new RegExp(`La venta ${sale.number} tiene ahora 1 serie anotada`));
    const found = txt(await runTool(b, "ver", "buscar_series", { cliente: c.name }));
    expect(found).toMatch(new RegExp(`EF-724A-0012 · .* · vendido en ${sale.number} a `));
    expect(txt(await runTool(b, "ver", "buscar_series", { buscar: "cal-2026", estado: "en_stock" }))).toMatch(/1 serie:/);
    expect(txt(await runTool(b, "ver", "buscar_series", { vencen_en_dias: 5000 }))).toMatch(/2 series/);
    expect(txt(await runTool(b, "ver", "buscar_series", { buscar: "no-existe" }))).toMatch(/No hay series/);
  });
});

describe("Navegador de NÚCLEO", () => {
  const banco = { name: "BCI Pyme", login_url: "https://www.bci.cl/corporativo/banco-en-linea/pyme", username: "11111111-1", password: "clave-de-ejemplo", kind: "lectura" as const, no_payments: true };

  it("solo abre sitios permitidos y lee la página con sus marcos", async () => {
    const b = new DemoBackend();
    expect(txt(await runTool(b, "ver", "web_abrir", { direccion: "https://www.bci.cl/" }))).toMatch(/no está entre los sitios permitidos/);
    expect(txt(await runTool(b, "ver", "web_abrir", { direccion: "http://www.sii.cl/" }))).toMatch(/solo abre direcciones https/);
    expect(txt(await runTool(b, "ver", "web_leer", {}))).toMatch(/está cerrado/);
    await b.saveAccess(null, banco);
    const page = txt(await runTool(b, "ver", "web_abrir", { acceso: "bci" }));
    expect(page).toMatch(/Navegador de NÚCLEO — Ingreso/);
    expect(page).toMatch(/https:\/\/www\.bci\.cl\/corporativo\/banco-en-linea\/pyme/);
    expect(page).toMatch(/\[w2\] clave «Clave» \(la rellena NÚCLEO: web_ingresar\)/);
    // Con «Solo ver» no se hace clic ni se guarda.
    expect((await runTool(b, "ver", "web_clic", { elemento: "w3" })).isError).toBe(true);
    expect((await runTool(b, "ver", "web_ingresar", { acceso: "bci" })).isError).toBe(true);
  });

  it("la clave la rellena NÚCLEO y solo con el permiso de hoy", async () => {
    const b = new DemoBackend();
    const a = await b.saveAccess(null, banco);
    const sin = await runTool(b, "completo", "web_ingresar", { acceso: "BCI Pyme" });
    expect(sin.isError).toBe(true);
    expect(txt(sin)).toMatch(/Autorizar por hoy/);
    // Claude no escribe claves aunque tenga acceso completo.
    await runTool(b, "completo", "web_abrir", { acceso: "bci" });
    const escribir = await runTool(b, "completo", "web_escribir", { elemento: "w2", texto: "x" });
    expect(escribir.isError).toBe(true);
    expect(txt(escribir)).toMatch(/las rellena NÚCLEO/);

    await b.browserGrant(a.uid, true);
    const dentro = txt(await runTool(b, "completo", "web_ingresar", { acceso: "BCI Pyme" }));
    expect(dentro).toMatch(/BCI Pyme: NÚCLEO rellenó usuario y clave y envió el formulario/);
    expect(dentro).not.toMatch(/clave-de-ejemplo/);
    expect(dentro).toMatch(/── Marco 0 · https:\/\/app\.bci\.cl\/movimientos ──/);
    expect(dentro).toMatch(/Transferencia enviada a Biotecnos Limitada/);

    // Buscar acota el texto y los controles.
    const solo = txt(await runTool(b, "ver", "web_leer", { buscar: "bioup" }));
    expect(solo).toMatch(/Bioup Investigacion Cientifica/);
    expect(solo).not.toMatch(/Biotecnos/);
    const escrito = txt(await runTool(b, "completo", "web_escribir", { elemento: "w2", texto: "Winkler" }));
    expect(escrito).toMatch(/\[w2\] campo «Busca nombre, rut, etc\.» = «Winkler»/);
    expect(txt(await runTool(b, "completo", "web_clic", { elemento: "w3" }))).toMatch(/Hecho: clic en «Siguiente»/);
    expect((await runTool(b, "completo", "web_clic", { elemento: "w99" })).isError).toBe(true);
  });

  it("guarda archivos en la carpeta con nombre sano y sin sobrescribir", async () => {
    const b = new DemoBackend();
    await runTool(b, "ver", "web_abrir", { direccion: "https://www1.sii.cl/cgi-bin/Portal001/mipeAdminDocsEmi.cgi" });
    expect(txt(await runTool(b, "completo", "web_guardar", { nombre: "536-DL.pdf" }))).toMatch(/Guardado: .*536-DL\.pdf · \d+ KB · PDF/);
    expect(txt(await runTool(b, "completo", "web_guardar", { nombre: "536-DL.pdf" }))).toMatch(/no lo sobrescribo/);
    expect((await runTool(b, "completo", "web_guardar", { nombre: "..\\..\\x.pdf" })).isError).toBe(true);
    expect((await runTool(b, "completo", "web_guardar", { nombre: "programa.exe" })).isError).toBe(true);
    expect((await runTool(b, "completo", "web_guardar", { nombre: "a.pdf", direccion: "https://otro-sitio.com/a.pdf" })).isError).toBe(true);
    expect(txt(await runTool(b, "ver", "web_leer", {}))).toMatch(/Descargas recientes .*536-DL\.pdf/);
    // La etiqueta del courier: una descarga de la página pasa a la carpeta de envíos con su nombre final.
    const etiqueta = txt(await runTool(b, "completo", "web_guardar", { descarga: "536-DL.pdf", carpeta: "envios", nombre: "blue.2486244670.pdf" }));
    expect(etiqueta).toMatch(/Guardado: Etiquetas de demostración\/blue\.2486244670\.pdf/);
    expect(etiqueta).not.toMatch(/Texto del documento/);
    expect(txt(await runTool(b, "completo", "web_guardar", { descarga: "no-existe.pdf", carpeta: "envios", nombre: "blue.1.pdf" }))).toMatch(/No hay una descarga reciente/);
    expect(txt(await runTool(b, "completo", "web_guardar", { nombre: "x.pdf", carpeta: "escritorio" }))).toMatch(/No conozco la carpeta/);
  });

  it("la firma en el SII pide la clave guardada por la persona y no se puede con «solo ver»", async () => {
    const b = new DemoBackend();
    expect((await runTool(b, "borradores", "web_firmar", { venta: "FV-000001" })).isError).toBe(true);
    expect(txt(await runTool(b, "completo", "web_firmar", { venta: "FV-000001" }))).toMatch(/Aún no hay clave de firma guardada/);
    expect(txt(await runTool(b, "ver", "listar_accesos", {}))).toMatch(/Clave de firma de documentos \(SII\): sin guardar/);
    await b.saveSigningKey("clave-de-ejemplo", true);
    const lista = txt(await runTool(b, "ver", "listar_accesos", {}));
    expect(lista).toMatch(/Clave de firma de documentos \(SII\): guardada/);
    expect(lista).not.toMatch(/clave-de-ejemplo/);
    await runTool(b, "ver", "web_abrir", { direccion: "https://www1.sii.cl/cgi-bin/Portal001/mipeAdminDocsEmi.cgi" });
    expect(txt(await runTool(b, "completo", "web_firmar", { venta: "FV-000001" }))).toMatch(/no es la de firma del SII/);
  });
});
