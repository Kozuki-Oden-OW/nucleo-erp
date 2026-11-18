import { describe, expect, it } from "vitest";
import { DemoBackend } from "../data/demo/store";
import { runTool, TOOL_DEFS } from "./tools";

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
    expect(txt(again)).toMatch(/Importadas 0 · ya estaban 1/);
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
  });
});
