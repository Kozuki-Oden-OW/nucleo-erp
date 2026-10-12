//! Análisis y reportes (Fase 12): reportes base de ventas, rentabilidad, compras, gastos,
//! inventario, cuentas por cobrar y por pagar, flujo de caja, IVA estimado e importaciones.
//!
//! Son de solo lectura y se arman como una tabla genérica (`Report`) que la interfaz muestra y
//! exporta (Excel o CSV) sin conocer cada reporte. Los montos van en pesos (unidad mínima), las
//! cantidades en milésimas, los porcentajes en ppm y las razones en centésimas.

use crate::company::CompanySession;
use crate::inventory_ops::date_ord;
use crate::sales_ops::local_today;
use crate::{AppError, AppResult};
use nucleo_db::finance;
use nucleo_db::reports::{self as db, Cell};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Columnas: "text", "money", "qty", "pct" (ppm), "int", "date", "month", "ratio" (centésimas),
/// "days", "rut", "fx" (moneda extranjera en centavos).
#[derive(Debug, Clone, Serialize)]
pub struct ReportColumn {
    pub key: &'static str,
    pub label: String,
    pub kind: &'static str,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReportKpi {
    pub label: String,
    pub value: i64,
    pub kind: &'static str,
    /// "success", "warning", "danger" o vacío.
    pub tone: Option<&'static str>,
}

/// Gráfico simple: columna de etiquetas y columnas de valores (barras).
#[derive(Debug, Clone, Serialize)]
pub struct ReportChart {
    pub label: usize,
    pub series: Vec<usize>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Report {
    pub id: String,
    pub title: String,
    pub description: String,
    pub from: String,
    pub to: String,
    pub uses_period: bool,
    pub columns: Vec<ReportColumn>,
    pub rows: Vec<Vec<Cell>>,
    pub totals: Option<Vec<Cell>>,
    /// Enlace de cada fila al documento o ficha (ruta de la interfaz), si tiene.
    pub links: Vec<Option<String>>,
    pub kpis: Vec<ReportKpi>,
    pub notes: Vec<String>,
    pub chart: Option<ReportChart>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReportDef {
    pub id: &'static str,
    pub group: &'static str,
    pub title: &'static str,
    pub description: &'static str,
    pub uses_period: bool,
    /// Agrupaciones posibles (valor, etiqueta); vacío si no aplica.
    pub groupings: Vec<(&'static str, &'static str)>,
    /// `false` si a quien opera le falta un permiso para verlo.
    pub available: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ReportParams {
    pub id: String,
    pub from: Option<String>,
    pub to: Option<String>,
    pub group: Option<String>,
}

struct Def {
    id: &'static str,
    group: &'static str,
    title: &'static str,
    description: &'static str,
    uses_period: bool,
    perms: &'static [&'static str],
}

const DEFS: &[Def] = &[
    Def {
        id: "ventas_periodo",
        group: "Ventas",
        title: "Ventas por período",
        description: "Neto, IVA, total y margen por mes, semana o día.",
        uses_period: true,
        perms: &["ventas.ver"],
    },
    Def {
        id: "ventas_cliente",
        group: "Ventas",
        title: "Ventas por cliente",
        description: "Quiénes te compran más y cuánto margen te dejan.",
        uses_period: true,
        perms: &["ventas.ver"],
    },
    Def {
        id: "ventas_producto",
        group: "Ventas",
        title: "Ventas por producto",
        description: "Cantidades, neto, costo y margen de cada producto o servicio.",
        uses_period: true,
        perms: &["ventas.ver"],
    },
    Def {
        id: "ventas_categoria",
        group: "Ventas",
        title: "Ventas por categoría",
        description: "Qué categorías venden más y cuáles dejan más margen.",
        uses_period: true,
        perms: &["ventas.ver"],
    },
    Def {
        id: "utilidad",
        group: "Rentabilidad",
        title: "¿Gano o pierdo? (utilidad)",
        description: "Ventas menos costo de lo vendido, gastos y remuneraciones, mes a mes.",
        uses_period: true,
        perms: &["ventas.ver", "costos.ver", "dinero.ver"],
    },
    Def {
        id: "compras_proveedor",
        group: "Compras y gastos",
        title: "Compras por proveedor",
        description: "Cuánto le compras a cada proveedor y cuánto le debes.",
        uses_period: true,
        perms: &["compras.ver"],
    },
    Def {
        id: "gastos_categoria",
        group: "Compras y gastos",
        title: "Gastos por categoría",
        description: "En qué se va el dinero: fijos y variables.",
        uses_period: true,
        perms: &["dinero.ver"],
    },
    Def {
        id: "inventario",
        group: "Inventario",
        title: "Inventario valorizado y rotación",
        description: "Cuánto vale tu stock, qué se mueve y qué no.",
        uses_period: true,
        perms: &["inventario.ver", "costos.ver"],
    },
    Def {
        id: "por_cobrar",
        group: "Dinero",
        title: "Por cobrar (antigüedad)",
        description: "Quién te debe, desde cuándo y cuánto está vencido.",
        uses_period: false,
        perms: &["ventas.ver"],
    },
    Def {
        id: "por_pagar",
        group: "Dinero",
        title: "Por pagar (antigüedad)",
        description: "A quién le debes y qué vence primero.",
        uses_period: false,
        perms: &["dinero.ver"],
    },
    Def {
        id: "flujo_caja",
        group: "Dinero",
        title: "Flujo de caja",
        description: "Lo que entró y salió de cajas y bancos cada mes, con el saldo.",
        uses_period: true,
        perms: &["dinero.ver"],
    },
    Def {
        id: "iva",
        group: "Impuestos",
        title: "IVA estimado por mes",
        description: "IVA de tus ventas menos el de compras y gastos registrados.",
        uses_period: true,
        perms: &["contabilidad.ver"],
    },
    Def {
        id: "importaciones",
        group: "COMEX",
        title: "Importaciones",
        description: "Carpetas del período con FOB, costo final y costo por unidad.",
        uses_period: true,
        perms: &["comex.ver"],
    },
];

const GROUPINGS: &[(&str, &str)] = &[
    ("mes", "Por mes"),
    ("semana", "Por semana"),
    ("dia", "Por día"),
];

fn col(key: &'static str, label: &str, kind: &'static str) -> ReportColumn {
    ReportColumn {
        key,
        label: label.to_string(),
        kind,
    }
}

fn kpi(label: &str, value: i64, kind: &'static str) -> ReportKpi {
    ReportKpi {
        label: label.to_string(),
        value,
        kind,
        tone: None,
    }
}

/// Proporción en ppm (redondeada), o vacío si el divisor es cero.
fn ppm(part: i64, whole: i64) -> Cell {
    if whole == 0 {
        Cell::Null
    } else {
        Cell::Int(nucleo_domain::comex::div_round(part as i128 * 1_000_000, whole as i128) as i64)
    }
}

/// Meses AAAA-MM entre dos fechas (incluidos).
fn months(from: &str, to: &str) -> Vec<String> {
    let (mut y, mut m) = (
        from[..4].parse::<i32>().unwrap_or(2000),
        from[5..7].parse::<i32>().unwrap_or(1),
    );
    let (ty, tm) = (
        to[..4].parse::<i32>().unwrap_or(y),
        to[5..7].parse::<i32>().unwrap_or(m),
    );
    let mut out = Vec::new();
    while (y, m) <= (ty, tm) && out.len() < 600 {
        out.push(format!("{y:04}-{m:02}"));
        m += 1;
        if m > 12 {
            m = 1;
            y += 1;
        }
    }
    out
}

fn sum_col(rows: &[Vec<Cell>], i: usize) -> i64 {
    rows.iter().map(|r| r[i].int()).sum()
}

/// Tramo de antigüedad según días vencidos.
fn bucket(days: i64) -> &'static str {
    match days {
        d if d <= 0 => "Al día",
        1..=30 => "1 a 30 días",
        31..=60 => "31 a 60 días",
        61..=90 => "61 a 90 días",
        _ => "Más de 90 días",
    }
}

impl CompanySession {
    /// Reportes disponibles, con su grupo y si quien opera puede verlos.
    pub fn report_catalog(&self) -> AppResult<Vec<ReportDef>> {
        self.require("reportes.ver")?;
        Ok(DEFS
            .iter()
            .map(|d| ReportDef {
                id: d.id,
                group: d.group,
                title: d.title,
                description: d.description,
                uses_period: d.uses_period,
                groupings: if d.id == "ventas_periodo" {
                    GROUPINGS.to_vec()
                } else {
                    vec![]
                },
                available: d.perms.iter().all(|p| self.can(p)),
            })
            .collect())
    }

    /// Guarda un reporte exportado (Excel o CSV armado por la interfaz) donde la persona eligió.
    /// Solo acepta archivos .xlsx o .csv y deja constancia en la auditoría.
    pub fn save_report_file(
        &mut self,
        report_id: &str,
        dest: &std::path::Path,
        bytes: &[u8],
    ) -> AppResult<()> {
        self.require("reportes.exportar")?;
        let ext = dest
            .extension()
            .and_then(|e| e.to_str())
            .map(str::to_ascii_lowercase)
            .unwrap_or_default();
        if ext != "xlsx" && ext != "csv" {
            return Err(AppError::Validation(
                "el archivo debe terminar en .xlsx o .csv".into(),
            ));
        }
        if bytes.len() > 200 * 1024 * 1024 {
            return Err(AppError::Validation(
                "el archivo es demasiado grande".into(),
            ));
        }
        std::fs::write(dest, bytes)
            .map_err(|err| AppError::Validation(format!("no se pudo guardar el archivo: {err}")))?;
        let user = self.actor_name()?;
        let file = dest
            .file_name()
            .and_then(|f| f.to_str())
            .unwrap_or("")
            .to_string();
        nucleo_db::audit::append(
            self.db.conn(),
            &nucleo_db::audit::AuditEntry {
                user_name: &user,
                action: "reporte.exportar",
                entity: "reporte",
                entity_id: Some(report_id),
                after_json: serde_json::to_string(&serde_json::json!({ "archivo": file })).ok(),
                ..Default::default()
            },
        )?;
        Ok(())
    }

    pub fn report(&self, p: &ReportParams) -> AppResult<Report> {
        self.require("reportes.ver")?;
        let def = DEFS
            .iter()
            .find(|d| d.id == p.id)
            .ok_or_else(|| AppError::NotFound("el reporte".into()))?;
        for perm in def.perms {
            self.require(perm)?;
        }
        let conn = self.db.conn();
        let today = local_today(conn)?;
        let from = p
            .from
            .clone()
            .unwrap_or_else(|| format!("{}-01", &today[..7]));
        let to = p.to.clone().unwrap_or_else(|| today.clone());
        let (Some(f), Some(t)) = (date_ord(&from), date_ord(&to)) else {
            return Err(AppError::Validation(
                "revisa las fechas del período (AAAA-MM-DD)".into(),
            ));
        };
        if f > t {
            return Err(AppError::Validation(
                "la fecha «desde» es posterior a «hasta»".into(),
            ));
        }
        if t - f > 366 * 10 {
            return Err(AppError::Validation(
                "elige un período de hasta 10 años".into(),
            ));
        }
        let mut r = Report {
            id: def.id.into(),
            title: def.title.into(),
            description: def.description.into(),
            from: from.clone(),
            to: to.clone(),
            uses_period: def.uses_period,
            columns: vec![],
            rows: vec![],
            totals: None,
            links: vec![],
            kpis: vec![],
            notes: vec![],
            chart: None,
        };
        let costs = self.can("costos.ver");
        match def.id {
            "ventas_periodo" => {
                let group = match p.group.as_deref() {
                    Some("dia") => "dia",
                    Some("semana") => "semana",
                    _ => "mes",
                };
                let mut data = db::sales_by_period(conn, &from, &to, group)?;
                if group == "mes" {
                    let mut by: BTreeMap<String, Vec<Cell>> = data
                        .into_iter()
                        .map(|row| (row[0].text().to_string(), row))
                        .collect();
                    data = months(&from, &to)
                        .into_iter()
                        .map(|m| {
                            by.remove(&m).unwrap_or_else(|| {
                                vec![m.into(), 0.into(), 0.into(), 0.into(), 0.into(), 0.into()]
                            })
                        })
                        .collect();
                }
                r.columns = vec![
                    col(
                        "periodo",
                        match group {
                            "dia" => "Día",
                            "semana" => "Semana del",
                            _ => "Mes",
                        },
                        if group == "mes" { "month" } else { "date" },
                    ),
                    col("docs", "Ventas", "int"),
                    col("neto", "Neto", "money"),
                    col("iva", "IVA", "money"),
                    col("total", "Total", "money"),
                ];
                if costs {
                    r.columns.extend([
                        col("costo", "Costo", "money"),
                        col("margen", "Margen", "money"),
                        col("margen_pct", "Margen s/venta %", "pct"),
                        col("ganancia_costo_pct", "Ganancia s/costo %", "pct"),
                    ]);
                }
                for row in &data {
                    let (net, cost) = (row[2].int(), row[5].int());
                    let mut out = row[..5].to_vec();
                    if costs {
                        out.extend([
                            cost.into(),
                            (net - cost).into(),
                            ppm(net - cost, net),
                            ppm(net - cost, cost),
                        ]);
                    }
                    r.rows.push(out);
                }
                let (n, c) = (sum_col(&data, 2), sum_col(&data, 5));
                let mut tot = vec![
                    "Total".into(),
                    sum_col(&data, 1).into(),
                    n.into(),
                    sum_col(&data, 3).into(),
                    sum_col(&data, 4).into(),
                ];
                if costs {
                    tot.extend([c.into(), (n - c).into(), ppm(n - c, n), ppm(n - c, c)]);
                }
                r.kpis.push(kpi("Ventas netas", n, "money"));
                r.kpis.push(kpi("Documentos", sum_col(&data, 1), "int"));
                if costs {
                    r.kpis.push(kpi("Margen", n - c, "money"));
                    r.kpis
                        .push(kpi("Margen sobre la venta", ppm(n - c, n).int(), "pct"));
                    r.kpis
                        .push(kpi("Ganancia sobre el costo", ppm(n - c, c).int(), "pct"));
                }
                r.totals = Some(tot);
                r.chart = Some(ReportChart {
                    label: 0,
                    series: vec![2],
                });
            }
            "ventas_cliente" => {
                let data = db::sales_by_customer(conn, &from, &to)?;
                let total = sum_col(&data, 3);
                r.columns = vec![
                    col("cliente", "Cliente", "text"),
                    col("rut", "RUT", "rut"),
                    col("docs", "Ventas", "int"),
                    col("neto", "Neto", "money"),
                ];
                if costs {
                    r.columns.extend([
                        col("margen", "Margen", "money"),
                        col("margen_pct", "Margen s/venta %", "pct"),
                        col("ganancia_costo_pct", "Ganancia s/costo %", "pct"),
                    ]);
                }
                r.columns.push(col("part", "Participación", "pct"));
                for row in &data {
                    let (net, cost) = (row[3].int(), row[4].int());
                    let mut out = row[..4].to_vec();
                    if costs {
                        out.extend([
                            (net - cost).into(),
                            ppm(net - cost, net),
                            ppm(net - cost, cost),
                        ]);
                    }
                    out.push(ppm(net, total));
                    r.rows.push(out);
                }
                let c = sum_col(&data, 4);
                let mut tot = vec![
                    format!("{} clientes", data.len()).into(),
                    Cell::Null,
                    sum_col(&data, 2).into(),
                    total.into(),
                ];
                if costs {
                    tot.extend([(total - c).into(), ppm(total - c, total), ppm(total - c, c)]);
                }
                tot.push(ppm(total, total));
                r.totals = Some(tot);
                if let Some(first) = data.first() {
                    r.kpis
                        .push(kpi("Clientes con compras", data.len() as i64, "int"));
                    r.kpis.push(kpi(
                        &format!("Principal: {}", first[0].text()),
                        ppm(first[3].int(), total).int(),
                        "pct",
                    ));
                    let top5: i64 = data.iter().take(5).map(|x| x[3].int()).sum();
                    r.kpis
                        .push(kpi("Los 5 principales", ppm(top5, total).int(), "pct"));
                }
            }
            "ventas_producto" | "ventas_categoria" => {
                let by_product = def.id == "ventas_producto";
                let data = if by_product {
                    db::sales_by_product(conn, &from, &to)?
                } else {
                    db::sales_by_category(conn, &from, &to)?
                };
                let (net_i, cost_i) = if by_product { (5, 6) } else { (3, 4) };
                let total = sum_col(&data, net_i);
                r.columns = if by_product {
                    vec![
                        col("codigo", "Código", "text"),
                        col("producto", "Producto", "text"),
                        col("categoria", "Categoría", "text"),
                        col("cantidad", "Cantidad", "qty"),
                        col("unidad", "Unidad", "text"),
                        col("neto", "Neto", "money"),
                    ]
                } else {
                    vec![
                        col("categoria", "Categoría", "text"),
                        col("productos", "Productos distintos", "int"),
                        col("ventas", "Ventas", "int"),
                        col("neto", "Neto", "money"),
                    ]
                };
                if costs {
                    r.columns.extend([
                        col("costo", "Costo", "money"),
                        col("margen", "Margen", "money"),
                        col("margen_pct", "Margen s/venta %", "pct"),
                        col("ganancia_costo_pct", "Ganancia s/costo %", "pct"),
                    ]);
                }
                r.columns.push(col("part", "Participación", "pct"));
                for row in &data {
                    let (net, cost) = (row[net_i].int(), row[cost_i].int());
                    let mut out = row[..=net_i].to_vec();
                    if costs {
                        out.extend([
                            cost.into(),
                            (net - cost).into(),
                            ppm(net - cost, net),
                            ppm(net - cost, cost),
                        ]);
                    }
                    out.push(ppm(net, total));
                    r.rows.push(out);
                }
                let c = sum_col(&data, cost_i);
                let mut tot: Vec<Cell> = vec![Cell::Text("Total".into())];
                tot.resize(net_i, Cell::Null);
                tot.push(total.into());
                if costs {
                    tot.extend([
                        c.into(),
                        (total - c).into(),
                        ppm(total - c, total),
                        ppm(total - c, c),
                    ]);
                }
                tot.push(ppm(total, total));
                r.totals = Some(tot);
                r.kpis.push(kpi("Ventas netas", total, "money"));
                if costs {
                    r.kpis.push(kpi("Margen", total - c, "money"));
                    r.kpis.push(kpi(
                        "Margen sobre la venta",
                        ppm(total - c, total).int(),
                        "pct",
                    ));
                    r.kpis.push(kpi(
                        "Ganancia sobre el costo",
                        ppm(total - c, c).int(),
                        "pct",
                    ));
                }
                if by_product {
                    r.kpis
                        .push(kpi("Productos vendidos", data.len() as i64, "int"));
                    if data.iter().any(|x| x[2] == Cell::Null) {
                        r.notes.push("Hay productos sin categoría: asígnalas en Productos → Categorías para verlos agrupados.".into());
                    }
                } else {
                    r.chart = Some(ReportChart {
                        label: 0,
                        series: vec![3],
                    });
                }
            }
            "utilidad" => {
                let mut by: BTreeMap<String, [i64; 4]> = months(&from, &to)
                    .into_iter()
                    .map(|m| (m, [0; 4]))
                    .collect();
                for row in db::sales_by_period(conn, &from, &to, "mes")? {
                    let e = by.entry(row[0].text().to_string()).or_default();
                    e[0] += row[2].int();
                    e[1] += row[5].int();
                }
                for row in db::expenses_by_month(conn, &from, &to)? {
                    by.entry(row[0].text().to_string()).or_default()[2] += row[1].int();
                }
                let payroll = self.can("remuneraciones.ver");
                if payroll {
                    for row in db::payroll_by_month(conn, &from, &to)? {
                        by.entry(row[0].text().to_string()).or_default()[3] += row[1].int();
                    }
                }
                r.columns = vec![
                    col("mes", "Mes", "month"),
                    col("ventas", "Ventas netas", "money"),
                    col("costo", "Costo de lo vendido", "money"),
                    col("bruto", "Margen bruto", "money"),
                    col("gastos", "Gastos", "money"),
                    col("rem", "Remuneraciones", "money"),
                    col("utilidad", "Utilidad", "money"),
                    col("pct", "Utilidad %", "pct"),
                ];
                let mut tt = [0i64; 4];
                for (m, v) in &by {
                    let gross = v[0] - v[1];
                    let profit = gross - v[2] - v[3];
                    for i in 0..4 {
                        tt[i] += v[i];
                    }
                    r.rows.push(vec![
                        m.clone().into(),
                        v[0].into(),
                        v[1].into(),
                        gross.into(),
                        v[2].into(),
                        v[3].into(),
                        profit.into(),
                        ppm(profit, v[0]),
                    ]);
                }
                let gross = tt[0] - tt[1];
                let profit = gross - tt[2] - tt[3];
                r.totals = Some(vec![
                    "Total".into(),
                    tt[0].into(),
                    tt[1].into(),
                    gross.into(),
                    tt[2].into(),
                    tt[3].into(),
                    profit.into(),
                    ppm(profit, tt[0]),
                ]);
                r.kpis = vec![
                    kpi("Ventas netas", tt[0], "money"),
                    kpi("Margen bruto", gross, "money"),
                    kpi("Gastos y remuneraciones", tt[2] + tt[3], "money"),
                    ReportKpi {
                        tone: Some(if profit >= 0 { "success" } else { "danger" }),
                        ..kpi(
                            if profit >= 0 { "Utilidad" } else { "Pérdida" },
                            profit.abs(),
                            "money",
                        )
                    },
                ];
                r.chart = Some(ReportChart {
                    label: 0,
                    series: vec![1, 6],
                });
                r.notes.push("Es una utilidad de gestión: ventas netas menos el costo de lo vendido, los gastos registrados y el costo empresa de las liquidaciones emitidas. No reemplaza el estado de resultados contable.".into());
                if payroll && tt[3] > 0 && db::payroll_like_expenses(conn, &from, &to)? > 0 {
                    r.notes.push("Tienes gastos en la categoría «Remuneraciones» y también liquidaciones emitidas: revisa que los sueldos no se cuenten dos veces.".into());
                }
                if !payroll {
                    r.notes
                        .push("Sin permiso para ver remuneraciones: no se incluyen.".into());
                }
            }
            "compras_proveedor" => {
                let data = db::purchases_by_supplier(conn, &from, &to)?;
                r.columns = vec![
                    col("proveedor", "Proveedor", "text"),
                    col("rut", "RUT", "rut"),
                    col("docs", "Documentos", "int"),
                    col("neto", "Neto", "money"),
                    col("exento", "Exento", "money"),
                    col("iva", "IVA", "money"),
                    col("total", "Total", "money"),
                    col("deuda", "Por pagar", "money"),
                    col("part", "Participación", "pct"),
                ];
                let total = sum_col(&data, 6);
                for row in &data {
                    let mut out = row.clone();
                    out.push(ppm(row[6].int(), total));
                    r.rows.push(out);
                }
                r.totals = Some(vec![
                    format!("{} proveedores", data.len()).into(),
                    Cell::Null,
                    sum_col(&data, 2).into(),
                    sum_col(&data, 3).into(),
                    sum_col(&data, 4).into(),
                    sum_col(&data, 5).into(),
                    total.into(),
                    sum_col(&data, 7).into(),
                    ppm(total, total),
                ]);
                r.kpis = vec![
                    kpi("Compras (total)", total, "money"),
                    kpi("IVA crédito", sum_col(&data, 5), "money"),
                    kpi("Por pagar de estas compras", sum_col(&data, 7), "money"),
                ];
            }
            "gastos_categoria" => {
                let data = db::expenses_by_category(conn, &from, &to)?;
                r.columns = vec![
                    col("categoria", "Categoría", "text"),
                    col("tipo", "Tipo", "text"),
                    col("cantidad", "Gastos", "int"),
                    col("neto", "Neto", "money"),
                    col("iva", "IVA", "money"),
                    col("total", "Total", "money"),
                    col("part", "Participación", "pct"),
                ];
                let total = sum_col(&data, 3);
                let mut fixed = 0;
                for row in &data {
                    if row[1].text() == "fijo" {
                        fixed += row[3].int();
                    }
                    let mut out = row.clone();
                    out[1] = (if row[1].text() == "fijo" {
                        "Fijo"
                    } else {
                        "Variable"
                    })
                    .into();
                    out.push(ppm(row[3].int(), total));
                    r.rows.push(out);
                }
                r.totals = Some(vec![
                    "Total".into(),
                    Cell::Null,
                    sum_col(&data, 2).into(),
                    total.into(),
                    sum_col(&data, 4).into(),
                    sum_col(&data, 5).into(),
                    ppm(total, total),
                ]);
                r.kpis = vec![
                    kpi("Gastos netos", total, "money"),
                    kpi("Fijos", fixed, "money"),
                    kpi("Variables", total - fixed, "money"),
                ];
                r.chart = Some(ReportChart {
                    label: 0,
                    series: vec![3],
                });
            }
            "inventario" => {
                let data = db::inventory_valuation(conn, &from, &to)?;
                let days = (t - f + 1).max(1);
                r.columns = vec![
                    col("codigo", "Código", "text"),
                    col("producto", "Producto", "text"),
                    col("categoria", "Categoría", "text"),
                    col("stock", "Stock", "qty"),
                    col("unidad", "Unidad", "text"),
                    col("costo", "Costo unitario", "money"),
                    col("valor", "Valor", "money"),
                    col("vendido", "Vendido en el período", "qty"),
                    col("rotacion", "Rotación (veces)", "ratio"),
                    col("dias", "Días de inventario", "days"),
                ];
                let (mut value_total, mut idle, mut idle_value) = (0i64, 0i64, 0i64);
                for row in &data {
                    let (stock, cost_e4, sold, cogs) =
                        (row[3].int(), row[5].int(), row[6].int(), row[7].int());
                    let value = nucleo_domain::comex::div_round(
                        stock.max(0) as i128 * cost_e4 as i128,
                        10_000_000,
                    ) as i64;
                    value_total += value;
                    let rotation = if value > 0 {
                        Cell::Int(
                            nucleo_domain::comex::div_round(cogs as i128 * 100, value as i128)
                                as i64,
                        )
                    } else {
                        Cell::Null
                    };
                    let cover = if sold > 0 {
                        Cell::Int(nucleo_domain::comex::div_round(
                            stock.max(0) as i128 * days as i128,
                            sold as i128,
                        ) as i64)
                    } else {
                        Cell::Null
                    };
                    if sold == 0 && stock > 0 {
                        idle += 1;
                        idle_value += value;
                    }
                    r.rows.push(vec![
                        row[0].clone(),
                        row[1].clone(),
                        row[2].clone(),
                        stock.into(),
                        row[4].clone(),
                        Cell::Int(nucleo_domain::comex::div_round(cost_e4 as i128, 10_000) as i64),
                        value.into(),
                        sold.into(),
                        rotation,
                        cover,
                    ]);
                    r.links
                        .push(Some(format!("/inventario/producto/{}", row[8].text())));
                }
                r.totals = Some(vec![
                    "Total".into(),
                    format!("{} productos", data.len()).into(),
                    Cell::Null,
                    Cell::Null,
                    Cell::Null,
                    Cell::Null,
                    value_total.into(),
                    Cell::Null,
                    Cell::Null,
                    Cell::Null,
                ]);
                r.kpis = vec![
                    kpi("Valor del inventario (hoy)", value_total, "money"),
                    kpi(
                        "Productos con stock",
                        data.iter().filter(|x| x[3].int() > 0).count() as i64,
                        "int",
                    ),
                    ReportKpi {
                        tone: (idle > 0).then_some("warning"),
                        ..kpi("Sin ventas en el período", idle, "int")
                    },
                    ReportKpi {
                        tone: (idle_value > 0).then_some("warning"),
                        ..kpi("Capital inmovilizado", idle_value, "money")
                    },
                ];
                r.notes.push("Stock y costo son los de hoy; lo vendido, la rotación y los días de inventario usan el período elegido.".into());
            }
            "por_cobrar" | "por_pagar" => {
                let receivable = def.id == "por_cobrar";
                let t0 = date_ord(&today).unwrap_or(0);
                let mut buckets: BTreeMap<&str, i64> = BTreeMap::new();
                let (mut total, mut overdue) = (0, 0);
                if receivable {
                    r.columns = vec![
                        col("cliente", "Cliente", "text"),
                        col("doc", "Documento", "text"),
                        col("emision", "Emisión", "date"),
                        col("vence", "Vence", "date"),
                        col("monto", "Monto", "money"),
                        col("pagado", "Pagado", "money"),
                        col("saldo", "Saldo", "money"),
                        col("dias", "Días vencido", "days"),
                        col("tramo", "Tramo", "text"),
                    ];
                    for row in db::open_receivables(conn)? {
                        let d = t0 - date_ord(row[3].text()).unwrap_or(t0);
                        let saldo = row[6].int();
                        total += saldo;
                        if d > 0 {
                            overdue += saldo;
                        }
                        *buckets.entry(bucket(d)).or_default() += saldo;
                        r.links.push(Some(format!("/ventas/{}", row[7].text())));
                        r.rows.push(vec![
                            row[0].clone(),
                            row[1].clone(),
                            row[2].clone(),
                            row[3].clone(),
                            row[4].clone(),
                            row[5].clone(),
                            saldo.into(),
                            d.max(0).into(),
                            bucket(d).into(),
                        ]);
                    }
                } else {
                    r.columns = vec![
                        col("proveedor", "Proveedor o concepto", "text"),
                        col("origen", "Origen", "text"),
                        col("doc", "Documento", "text"),
                        col("vence", "Vence", "date"),
                        col("monto", "Monto", "money"),
                        col("pagado", "Pagado", "money"),
                        col("saldo", "Saldo", "money"),
                        col("dias", "Días vencido", "days"),
                        col("tramo", "Tramo", "text"),
                    ];
                    for d in finance::open_payables(conn)? {
                        let days = t0 - date_ord(&d.due_date).unwrap_or(t0);
                        total += d.pending_minor;
                        if days > 0 {
                            overdue += d.pending_minor;
                        }
                        *buckets.entry(bucket(days)).or_default() += d.pending_minor;
                        let origin = if d.link.starts_with("/compras") {
                            "Compra"
                        } else if d.link.starts_with("/dinero/gasto") {
                            "Gasto"
                        } else if d.link.starts_with("/comex") {
                            "Importación"
                        } else {
                            "Otro"
                        };
                        r.rows.push(vec![
                            d.party.into(),
                            origin.into(),
                            d.document.into(),
                            d.due_date.into(),
                            d.amount_minor.into(),
                            (d.amount_minor - d.pending_minor).into(),
                            d.pending_minor.into(),
                            days.max(0).into(),
                            bucket(days).into(),
                        ]);
                        r.links.push(Some(d.link));
                    }
                }
                // Lo más vencido primero, con su enlace.
                let mut pairs: Vec<(Vec<Cell>, Option<String>)> = std::mem::take(&mut r.rows)
                    .into_iter()
                    .zip(std::mem::take(&mut r.links))
                    .collect();
                pairs.sort_by(|a, b| b.0[7].int().cmp(&a.0[7].int()));
                (r.rows, r.links) = pairs.into_iter().unzip();
                r.totals = Some(vec![
                    "Total".into(),
                    Cell::Null,
                    Cell::Null,
                    Cell::Null,
                    sum_col(&r.rows, 4).into(),
                    sum_col(&r.rows, 5).into(),
                    total.into(),
                    Cell::Null,
                    Cell::Null,
                ]);
                r.kpis.push(kpi(
                    if receivable {
                        "Total por cobrar"
                    } else {
                        "Total por pagar"
                    },
                    total,
                    "money",
                ));
                r.kpis.push(ReportKpi {
                    tone: (overdue > 0).then_some("danger"),
                    ..kpi("Vencido", overdue, "money")
                });
                for b in [
                    "1 a 30 días",
                    "31 a 60 días",
                    "61 a 90 días",
                    "Más de 90 días",
                ] {
                    if let Some(v) = buckets.get(b) {
                        r.kpis.push(ReportKpi {
                            tone: Some("warning"),
                            ..kpi(&format!("Vencido {b}"), *v, "money")
                        });
                    }
                }
                r.notes.push(format!("Saldos abiertos al {today}."));
            }
            "flujo_caja" => {
                let start = db::cash_before(conn, &from)?;
                let mut by: BTreeMap<String, (i64, i64)> = months(&from, &to)
                    .into_iter()
                    .map(|m| (m, (0, 0)))
                    .collect();
                for row in db::cash_by_month(conn, &from, &to)? {
                    let e = by.entry(row[0].text().to_string()).or_default();
                    e.0 += row[1].int();
                    e.1 += row[2].int();
                }
                r.columns = vec![
                    col("mes", "Mes", "month"),
                    col("entradas", "Entradas (cobros)", "money"),
                    col("salidas", "Salidas (pagos)", "money"),
                    col("neto", "Flujo del mes", "money"),
                    col("saldo", "Saldo al cierre", "money"),
                ];
                let mut bal = start;
                let (mut ins, mut outs) = (0, 0);
                for (m, (i, o)) in &by {
                    bal += i - o;
                    ins += i;
                    outs += o;
                    r.rows.push(vec![
                        m.clone().into(),
                        (*i).into(),
                        (*o).into(),
                        (i - o).into(),
                        bal.into(),
                    ]);
                }
                r.totals = Some(vec![
                    "Total".into(),
                    ins.into(),
                    outs.into(),
                    (ins - outs).into(),
                    bal.into(),
                ]);
                r.kpis = vec![
                    kpi("Saldo al inicio", start, "money"),
                    kpi("Entradas", ins, "money"),
                    kpi("Salidas", outs, "money"),
                    ReportKpi {
                        tone: Some(if bal >= 0 { "success" } else { "danger" }),
                        ..kpi("Saldo al final", bal, "money")
                    },
                ];
                r.chart = Some(ReportChart {
                    label: 0,
                    series: vec![1, 2],
                });
                r.notes.push("Cobros y pagos registrados en cajas y bancos en pesos; los traspasos entre cuentas no cambian el total.".into());
            }
            "iva" => {
                let mut by: BTreeMap<String, [i64; 3]> = months(&from, &to)
                    .into_iter()
                    .map(|m| (m, [0; 3]))
                    .collect();
                for row in db::vat_by_month(conn, &from, &to)? {
                    let e = by.entry(row[0].text().to_string()).or_default();
                    e[0] += row[1].int();
                    e[1] += row[2].int();
                    e[2] += row[3].int();
                }
                r.columns = vec![
                    col("mes", "Mes", "month"),
                    col("debito", "IVA ventas (débito)", "money"),
                    col("credito_c", "IVA compras (crédito)", "money"),
                    col("credito_g", "IVA gastos (crédito)", "money"),
                    col("resultado", "Resultado", "money"),
                ];
                let mut tt = [0i64; 3];
                for (m, v) in &by {
                    for i in 0..3 {
                        tt[i] += v[i];
                    }
                    r.rows.push(vec![
                        m.clone().into(),
                        v[0].into(),
                        v[1].into(),
                        v[2].into(),
                        (v[0] - v[1] - v[2]).into(),
                    ]);
                }
                let res = tt[0] - tt[1] - tt[2];
                r.totals = Some(vec![
                    "Total".into(),
                    tt[0].into(),
                    tt[1].into(),
                    tt[2].into(),
                    res.into(),
                ]);
                r.kpis = vec![
                    kpi("IVA débito", tt[0], "money"),
                    kpi("IVA crédito", tt[1] + tt[2], "money"),
                    ReportKpi {
                        tone: Some(if res > 0 { "warning" } else { "success" }),
                        ..kpi(
                            if res >= 0 {
                                "IVA a pagar (estimado)"
                            } else {
                                "Remanente (estimado)"
                            },
                            res.abs(),
                            "money",
                        )
                    },
                ];
                r.chart = Some(ReportChart {
                    label: 0,
                    series: vec![1, 4],
                });
                r.notes.push("Resultado positivo = IVA a pagar; negativo = remanente. Es una estimación desde tus documentos: no arrastra remanentes ni incluye el IVA de importaciones. El borrador del F29 está en Impuestos.".into());
            }
            "importaciones" => {
                let data = db::imports(conn, &from, &to)?;
                r.columns = vec![
                    col("carpeta", "Carpeta", "text"),
                    col("proveedor", "Proveedor", "text"),
                    col("etapa", "Etapa", "text"),
                    col("fecha", "Fecha", "date"),
                    col("eta", "ETA", "date"),
                    col("moneda", "Moneda", "text"),
                    col("fob", "FOB", "fx"),
                    col("costo", "Costo final (CLP)", "money"),
                    col("unidades", "Unidades", "qty"),
                    col("unitario", "Costo por unidad", "money"),
                ];
                let mut landed = 0;
                for row in &data {
                    let total = row[7].int();
                    landed += total;
                    let units = row[8].int();
                    let unit = if units > 0 && total > 0 {
                        Cell::Int(nucleo_domain::comex::div_round(
                            total as i128 * 1000,
                            units as i128,
                        ) as i64)
                    } else {
                        Cell::Null
                    };
                    let stage = row[2].text().replace('_', " ");
                    r.rows.push(vec![
                        row[0].clone(),
                        row[1].clone(),
                        stage.into(),
                        row[3].clone(),
                        row[4].clone(),
                        row[5].clone(),
                        row[6].clone(),
                        row[7].clone(),
                        row[8].clone(),
                        unit,
                    ]);
                    r.links
                        .push(Some(format!("/comex/importacion/{}", row[9].text())));
                }
                r.totals = Some(vec![
                    format!("{} carpetas", data.len()).into(),
                    Cell::Null,
                    Cell::Null,
                    Cell::Null,
                    Cell::Null,
                    Cell::Null,
                    Cell::Null,
                    landed.into(),
                    Cell::Null,
                    Cell::Null,
                ]);
                r.kpis = vec![
                    kpi("Carpetas", data.len() as i64, "int"),
                    kpi("Costo final total", landed, "money"),
                ];
                r.notes.push("El costo final es el último calculado en cada carpeta (estimado hasta que se cierra).".into());
            }
            _ => return Err(AppError::NotFound("el reporte".into())),
        }
        if r.links.len() != r.rows.len() {
            r.links = vec![None; r.rows.len()];
        }
        Ok(r)
    }
}
