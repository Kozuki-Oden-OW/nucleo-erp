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
