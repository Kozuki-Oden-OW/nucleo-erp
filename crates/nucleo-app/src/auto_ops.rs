//! Tareas programadas de NÚCLEO: lo que el dueño dejó andando para que ocurra solo mientras el
//! programa está abierto — la ronda de cobranza, el informe por correo y los cobros recurrentes.
//!
//! No hay servidor: la aplicación pregunta cada pocos minutos «¿toca algo?». Igual que el resto del
//! correo, el trabajo va en tres pasos para no tener tomada la sesión mientras se envía:
//! [`CompanySession::auto_plan`] (qué toca y qué correos salen) → enviar → [`CompanySession::auto_finish`]
//! (registrar cada correo y dejar anotado que hoy ya se hizo). Cada tarea se hace una vez por día.
//!
//! Lo programado lo decide la persona en la configuración; mientras Claude está usando NÚCLEO no se
//! planifica nada (se reintenta en la siguiente vuelta).

use crate::AppResult;
use crate::company::CompanySession;
use crate::mail_ops::{MailTransport, OutgoingMail};
use serde::Serialize;

/// Una tarea que toca ahora, con los correos que hay que enviar (puede no tener ninguno).
#[derive(Debug, Clone)]
pub struct AutoJob {
    /// "cobranza" (envía), "cobranza_aviso" (solo avisa), "cobranza_sin_correo", "informe" o "recurrente".
    pub kind: String,
    pub mails: Vec<OutgoingMail>,
    /// Cuántos clientes están listos (para el aviso) o cuántos cobros se generaron.
    pub count: i64,
    /// Lo que no se pudo preparar (un cliente con el correo mal escrito, por ejemplo).
    pub skipped: Vec<String>,
}

/// Lo que se le cuenta a la persona cuando una tarea programada terminó.
#[derive(Debug, Clone, Serialize)]
pub struct AutoDone {
    pub kind: String,
    /// "success", "info" o "warning".
    pub tone: String,
    pub title: String,
    pub detail: String,
    pub href: String,
    pub sent: i64,
    pub failed: i64,
}

impl CompanySession {
    /// Qué tareas programadas tocan ahora. No envía nada.
    pub fn auto_plan(&mut self) -> AppResult<Vec<AutoJob>> {
        let mut jobs = Vec::new();
        if self.actor.is_none() || self.via_agent {
            return Ok(jobs);
        }
        let money = self.can("dinero.ver") && self.can("ventas.ver");

        // Cobros recurrentes primero: lo que generan entra a los números del informe.
        if self.can("ventas.crear") && self.can("ventas.ver") {
            let run = self.recurring_run_due()?;
            if run.created > 0 || !run.skipped.is_empty() {
                jobs.push(AutoJob {
                    kind: "recurrente".into(),
                    mails: run.mails,
                    count: run.created,
                    skipped: run.skipped,
                });
            }
        }

        if money {
            let round = self.collect_round()?;
            if round.due_now {
                if round.settings.mode == "enviar" && round.ready > 0 {
                    if round.mail_ready {
                        let mut mails = Vec::new();
                        let mut skipped = Vec::new();
                        for it in round
                            .items
                            .iter()
                            .filter(|i| i.state == "listo")
                            .take(round.settings.max_per_run as usize)
                        {
                            match self
                                .mail_draft_collection(&it.customer_uid)
                                .and_then(|d| self.mail_plan(&d))
                            {
                                Ok(m) => mails.push(m),
                                Err(e) => skipped.push(format!("{}: {e}", it.customer_name)),
                            }
                        }
                        jobs.push(AutoJob {
                            kind: "cobranza".into(),
                            mails,
                            count: round.ready,
                            skipped,
                        });
                    } else {
                        jobs.push(AutoJob {
                            kind: "cobranza_sin_correo".into(),
                            mails: Vec::new(),
                            count: round.ready,
                            skipped: Vec::new(),
                        });
                    }
                } else {
                    jobs.push(AutoJob {
                        kind: "cobranza_aviso".into(),
                        mails: Vec::new(),
                        count: round.ready,
                        skipped: Vec::new(),
                    });
                }
            }
            if self.digest_due()? {
                match self.digest_plan() {
                    Ok(m) => jobs.push(AutoJob {
                        kind: "informe".into(),
                        mails: vec![m],
                        count: 1,
                        skipped: Vec::new(),
                    }),
                    Err(e) => jobs.push(AutoJob {
                        kind: "informe".into(),
                        mails: Vec::new(),
                        count: 0,
                        skipped: vec![e.to_string()],
                    }),
                }
            }
        }
        Ok(jobs)
    }

    /// Registra los correos de una tarea y deja anotado que hoy ya se hizo.
    pub fn auto_finish(
        &mut self,
        job: &AutoJob,
        results: &[Result<(), String>],
    ) -> AppResult<Option<AutoDone>> {
        let user = format!("{} (programado)", self.actor()?.username);
        let mut sent = 0;
        let mut failed = 0;
        let mut first_error: Option<String> = job.skipped.first().cloned();
        for (m, r) in job.mails.iter().zip(results) {
            self.mail_record_as(m, r, &user)?;
            match r {
                Ok(()) => sent += 1,
                Err(e) => {
                    failed += 1;
                    first_error.get_or_insert_with(|| e.clone());
                }
            }
        }
        failed += job.skipped.len() as i64;
        let problem = first_error
            .map(|e| format!(" Primer problema: {e}."))
            .unwrap_or_default();
        let plural =
            |n: i64, uno: &str, varios: &str| format!("{n} {}", if n == 1 { uno } else { varios });
        let done = match job.kind.as_str() {
            "cobranza" => {
                self.collect_finish("programada", sent, failed)?;
                AutoDone {
                    kind: job.kind.clone(),
                    tone: if failed > 0 { "warning" } else { "success" }.into(),
                    title: format!(
                        "Ronda de cobranza: {}",
                        plural(sent, "recordatorio enviado", "recordatorios enviados")
                    ),
                    detail: if failed > 0 {
                        format!("{failed} no salieron.{problem}")
                    } else {
                        "Quedaron en el registro de correos y en la ficha de cada cliente.".into()
                    },
                    href: "/dinero?tab=cobranza".into(),
                    sent,
                    failed,
                }
            }
            "cobranza_aviso" => {
                self.collect_finish("aviso", 0, 0)?;
                if job.count == 0 {
                    return Ok(None);
                }
                AutoDone {
                    kind: job.kind.clone(),
                    tone: "info".into(),
                    title: format!(
                        "Ronda de cobranza lista: {}",
                        plural(job.count, "cliente por avisar", "clientes por avisar")
                    ),
                    detail: "Revísala y envíala en Dinero → Cobranza.".into(),
                    href: "/dinero?tab=cobranza".into(),
                    sent: 0,
                    failed: 0,
                }
            }
            "cobranza_sin_correo" => {
                self.collect_finish("aviso", 0, 0)?;
                AutoDone {
                    kind: job.kind.clone(),
                    tone: "warning".into(),
                    title: "La ronda de cobranza no salió".into(),
                    detail: "Falta conectar el correo de la empresa (Configuración → Integraciones → Correo).".into(),
                    href: "/config/integraciones".into(),
                    sent: 0,
                    failed: job.count,
                }
            }
            "informe" => {
                let r: Result<(), String> = match results.first() {
                    Some(r) => r.clone(),
                    None => Err(job
                        .skipped
                        .first()
                        .cloned()
                        .unwrap_or_else(|| "no se pudo preparar".into())),
                };
                self.digest_finish(&r)?;
                match r {
                    Ok(()) => AutoDone {
                        kind: job.kind.clone(),
                        tone: "success".into(),
                        title: "Informe del negocio enviado".into(),
                        detail: format!(
                            "Llegó a {}.",
                            job.mails.first().map(|m| m.draft.to.as_str()).unwrap_or("")
                        ),
                        href: "/config/informe".into(),
                        sent: 1,
                        failed: 0,
                    },
                    Err(e) => AutoDone {
                        kind: job.kind.clone(),
                        tone: "warning".into(),
                        title: "El informe del negocio no salió".into(),
                        detail: e,
                        href: "/config/informe".into(),
                        sent: 0,
                        failed: 1,
                    },
                }
            }
            "recurrente" => AutoDone {
                kind: job.kind.clone(),
                tone: if failed > 0 { "warning" } else { "success" }.into(),
                title: format!(
                    "Cobros recurrentes: {}",
                    plural(job.count, "venta generada", "ventas generadas")
                ),
                detail: format!(
                    "{}{}",
                    if sent > 0 {
                        format!(
                            "{} al cliente.",
                            plural(sent, "aviso enviado", "avisos enviados")
                        )
                    } else {
                        "Quedaron por cobrar en Ventas.".into()
                    },
                    if failed > 0 { problem } else { String::new() }
                ),
                href: "/ventas?tab=recurrentes".into(),
                sent,
                failed,
            },
            _ => return Ok(None),
        };
        Ok(Some(done))
    }
}

/// Planifica, envía y registra de una vez (pruebas y llamadores que no necesitan soltar la sesión).
pub fn run_due(s: &mut CompanySession, transport: &dyn MailTransport) -> AppResult<Vec<AutoDone>> {
    let mut out = Vec::new();
    for job in s.auto_plan()? {
        let results: Vec<Result<(), String>> =
            job.mails.iter().map(|m| transport.send(m)).collect();
        if let Some(d) = s.auto_finish(&job, &results)? {
            out.push(d);
        }
    }
    Ok(out)
}
