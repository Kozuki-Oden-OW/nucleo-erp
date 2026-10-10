//! Remuneraciones (Fase 10, hito B): sueldo empresarial del dueño, indicadores del mes,
//! emisión con foto congelada, anulación y paso del impuesto único al código 48 del F29.

use nucleo_app::f29_ops::{F29Inputs, TaxProfile};
use nucleo_app::payroll_ops::{AfpRate, Indicators, PayslipMonth, Terms, WorkerInput};
use nucleo_app::{AppService, BusinessProfile, CompanySession, MemoryKeyStore};
use nucleo_domain::payroll::{
    AfcRates, DeductionItem, EarningItem, EmployerRate, HealthDeduction, PayrollParams, TaxBracket,
};

fn session() -> (tempfile::TempDir, AppService, CompanySession) {
    let data = tempfile::tempdir().unwrap();
    let mut app = AppService::open(data.path(), Box::new(MemoryKeyStore::default())).unwrap();
    let c = app
        .create_company("Comercial Ejemplo", BusinessProfile::Negocio)
        .unwrap();
    let s = app.open_company(&c.company.uid).unwrap();
    (data, app, s)
}

/// Indicadores de ejemplo (valores ilustrativos de septiembre 2026, solo para la prueba).
fn indicators() -> Indicators {
    let b = |up: Option<i64>, f: i64, r: i64| TaxBracket {
        up_to_utm_e4: up,
        factor_ppm: f,
        rebate_utm_e4: r,
    };
    Indicators {
        params: PayrollParams {
            uf_e2: 4_105_720,
            utm: 71_721,
            imm: 553_553,
            cap_pension_uf_e4: 900_000,
            cap_afc_uf_e4: 1_352_000,
            health_ppm: 70_000,
            afc: AfcRates {
                worker_indefinite_ppm: 6_000,
                employer_indefinite_ppm: 24_000,
                employer_fixed_ppm: 30_000,
            },
            employer: vec![EmployerRate {
                code: "sis".into(),
                label: "SIS".into(),
                rate_ppm: 17_800,
                base: Default::default(),
            }],
            accident_ppm: 9_300,
            tax_brackets: vec![
                b(Some(135_000), 0, 0),
                b(Some(300_000), 40_000, 5_400),
                b(Some(500_000), 80_000, 17_400),
                b(None, 135_000, 44_900),
            ],
            gratification: None,
            overtime_surcharge_ppm: 500_000,
            health_deduction: HealthDeduction::UpToCap,
        },
        afp: vec![AfpRate {
            name: "Uno".into(),
            rate_ppm: 104_600,
        }],
    }
}

fn owner() -> WorkerInput {
    WorkerInput {
        rut: "12.345.678-5".into(),
        name: "Kozuki Oden".into(),
        is_owner: true,
        position: Some("Gerente general".into()),
        start_date: "2024-01-01".into(),
        end_date: None,
        active: true,
        terms: Terms {
            contract: "sin_contrato".into(),
            base_salary: 2_500_000,
            afp: Some("uno".into()),
            ..Default::default()
        },
    }
}

#[test]
fn sueldo_empresarial_y_codigo_48() {
    let (_d, _app, mut s) = session();
    let w = s.save_worker(None, &owner()).unwrap();
    assert_eq!(w.rut, "12345678-5");
    assert!(s.save_worker(None, &owner()).is_err(), "RUT repetido");

    // Sin indicadores: se ve el borrador pero no se puede emitir.
    let v = s.payslip(w.id, "2026-09").unwrap();
    assert_eq!(v.status, "nueva");
    assert!(!v.result.complete);
    assert!(s.emit_payslip(w.id, "2026-09", "2026-09-30").is_err());

    s.save_payroll_indicators("2026-09", &indicators(), Some("Previred sept-2026".into()))
        .unwrap();
    // El mes siguiente propone los de septiembre, pero sin confirmar.
    let oct = s.payroll_indicators("2026-10").unwrap();
    assert!(!oct.saved);
    assert_eq!(oct.from_period.as_deref(), Some("2026-09"));
    assert!(!s.payslip(w.id, "2026-10").unwrap().result.complete);

    let v = s.payslip(w.id, "2026-09").unwrap();
    assert!(v.result.complete, "{:?}", v.result.notes);
    assert_eq!(v.result.tax, 43_811);
    assert_eq!(v.result.to_pay, 2_019_689);
    assert_eq!(v.result.taxable_earnings[0].lre, Some(2161));

    // Mes con anticipo y un bono; se guarda el borrador.
    let v = s
        .save_payslip(
            w.id,
            "2026-09",
            &PayslipMonth {
                items: vec![EarningItem {
                    label: "Colación".into(),
                    amount: 50_000,
                    taxable: false,
                    lre: Some(2301),
                }],
                deductions: vec![DeductionItem {
                    label: "Préstamo".into(),
                    amount: 19_689,
                    lre: Some(3188),
                }],
                advance: 500_000,
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(v.status, "borrador");
    assert_eq!(v.result.to_pay, 2_019_689 + 50_000 - 19_689 - 500_000);

    // Se emite con pago en octubre: el impuesto va al F29 de octubre.
    let v = s.emit_payslip(w.id, "2026-09", "2026-10-05").unwrap();
    assert_eq!(v.status, "emitida");
    assert!(
        s.save_payslip(w.id, "2026-09", &PayslipMonth::default())
            .is_err()
    );
    let f = s.f29("2026-10").unwrap();
    let pt = f.payroll_tax.clone().unwrap();
    assert_eq!((pt.payslips, pt.amount, pt.applied), (1, 43_811, true));
    assert_eq!(f.result.codes.get(&48), Some(&43_811));
    assert!(s.f29("2026-09").unwrap().payroll_tax.is_none());

    // La foto no cambia si después cambia el sueldo.
    let mut o = owner();
    o.terms.base_salary = 3_000_000;
    s.save_worker(Some(w.id), &o).unwrap();
    assert_eq!(s.payslip(w.id, "2026-09").unwrap().result.tax, 43_811);

    // Con el F29 de octubre declarado no se puede anular.
    s.save_tax_profile(&TaxProfile::default()).unwrap();
    s.save_f29_inputs("2026-10", &F29Inputs::default()).unwrap();
    s.mark_f29_declared("2026-10", 0, 43_811, None).unwrap();
    assert!(s.void_payslip(v.id.unwrap(), "error en el monto").is_err());
    s.reopen_f29("2026-10", "corregir liquidación").unwrap();
    let anulada = s.void_payslip(v.id.unwrap(), "error en el monto").unwrap();
    assert_eq!(anulada.status, "anulada");
    assert!(s.f29("2026-10").unwrap().payroll_tax.is_none());
    // Se puede preparar otra (ya con el sueldo nuevo).
    let nueva = s.payslip(w.id, "2026-09").unwrap();
    assert_eq!(nueva.status, "nueva");
    assert_eq!(nueva.result.total_taxable, 3_000_000);
    let p = s.payroll("2026-09").unwrap();
    assert_eq!((p.rows.len(), p.voided), (1, 1));
}

#[test]
fn dias_por_ingreso_y_validaciones() {
    let (_d, _app, mut s) = session();
    let mut t = owner();
    t.is_owner = false;
    t.rut = "11.111.111-1".into();
    t.start_date = "2026-09-21".into();
    t.terms.contract = "indefinido".into();
    t.terms.base_salary = 900_000;
    t.terms.afc = true;
    let w = s.save_worker(None, &t).unwrap();
    s.save_payroll_indicators("2026-09", &indicators(), None)
        .unwrap();
    let v = s.payslip(w.id, "2026-09").unwrap();
    assert_eq!(v.days_suggested, 10);
    assert_eq!(v.result.taxable_earnings[0].amount, 300_000);
    // No aparece en meses anteriores a su ingreso.
    assert!(s.payroll("2026-08").unwrap().rows.is_empty());

    // AFP que no está en los indicadores.
    t.terms.afp = Some("Desconocida".into());
    s.save_worker(Some(w.id), &t).unwrap();
    let v = s.payslip(w.id, "2026-09").unwrap();
    assert!(!v.result.complete);
    assert!(v.result.notes[0].text.contains("Desconocida"));

    // Validaciones.
    t.terms.base_salary = 0;
    assert!(s.save_worker(Some(w.id), &t).is_err());
    let mut bad = indicators();
    bad.params.tax_brackets.swap(0, 1);
    assert!(s.save_payroll_indicators("2026-09", &bad, None).is_err());
    assert!(
        s.save_payslip(
            w.id,
            "2026-09",
            &PayslipMonth {
                days: Some(31),
                ..Default::default()
            }
        )
        .is_err()
    );
}
