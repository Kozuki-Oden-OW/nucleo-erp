//! Comandos de la sincronización con el celular (docs/SINCRONIZACION.md, fase S1): activar la
//! escucha en la red local, emparejar con un código de un solo uso y quitar dispositivos. Las
//! llaves de los dispositivos nunca llegan a la interfaz.

use crate::commands::{AppState, CommandError};
use nucleo_app::sync_net::{PairedDevice, PairingCode, Peer, SyncHost, SyncOutcome, SyncServer};
use nucleo_app::{AppError, CompanySession};
use serde::Serialize;
use std::sync::Arc;
use tauri::State;

type CmdResult<T> = Result<T, CommandError>;

fn err(msg: impl Into<String>) -> CommandError {
    AppError::Validation(msg.into()).into()
}

fn with<T>(
    state: &AppState,
    f: impl FnOnce(&mut CompanySession) -> Result<T, AppError>,
) -> CmdResult<T> {
    let mut g = state.session.lock().map_err(|_| err("sesión bloqueada"))?;
    let s = g.as_mut().ok_or_else(|| err("no hay un negocio abierto"))?;
    Ok(f(s)?)
}

#[derive(Debug, Serialize)]
pub struct SyncView {
    /// El negocio tiene activada la sincronización con celulares.
    pub enabled: bool,
    /// El computador está escuchando en la red local.
    pub listening: bool,
    /// Dirección del computador en la red local, para escribirla en el celular si cambia.
    pub address: Option<String>,
    /// Hay un código de emparejamiento vigente.
    pub pairing_open: bool,
    pub device_uid: String,
    pub role: String,
    pub peers: Vec<Peer>,
    /// Fichas que se unieron o chocaron y conviene revisar.
    pub conflicts: usize,
}

/// Deja el servidor como dice la configuración del negocio abierto: escuchando si la sincronización
/// está activada, apagado si no (o si no hay negocio abierto). Nunca se toman las dos llaves a la vez.
pub fn reconcile(state: &AppState) {
    let enabled = state
        .session
        .lock()
        .ok()
        .and_then(|g| g.as_ref().map(|s| s.sync_listening().unwrap_or(false)))
        .unwrap_or(false);
    let Ok(mut server) = state.sync.lock() else {
        return;
    };
    if enabled && server.is_none() {
        let host: Arc<dyn SyncHost> = state.session.clone();
        *server = SyncServer::start_default(host).ok();
    } else if !enabled {
        *server = None;
    }
}

fn view(state: &AppState) -> CmdResult<SyncView> {
    let (enabled, (device_uid, role), peers, conflicts) = with(state, |s| {
        Ok((
            s.sync_listening()?,
            s.sync_device()?,
            s.sync_peers()?,
            s.sync_conflicts()?.len(),
        ))
    })?;
    let server = state
        .sync
        .lock()
        .map_err(|_| err("sincronización bloqueada"))?;
    Ok(SyncView {
        enabled,
        listening: server.is_some(),
        address: server.as_ref().map(|s| s.address().to_string()),
        pairing_open: server.as_ref().is_some_and(|s| s.pairing_open()),
        device_uid,
        role,
        peers,
        conflicts,
    })
}

#[tauri::command]
pub fn sync_status(state: State<'_, AppState>) -> CmdResult<SyncView> {
    reconcile(&state);
    view(&state)
}

#[tauri::command]
pub fn sync_enable(state: State<'_, AppState>, on: bool) -> CmdResult<SyncView> {
    with(&state, |s| s.sync_set_listening(on))?;
    reconcile(&state);
    let v = view(&state)?;
    if on && !v.listening {
        return Err(err(
            "no se pudo abrir la conexión en la red local: revisa que el cortafuegos permita a NÚCLEO en redes privadas",
        ));
    }
    Ok(v)
}

/// Abre un emparejamiento y entrega el código que se muestra en pantalla (QR y letras). Activa la
/// sincronización si estaba apagada.
#[tauri::command]
pub fn sync_pair_start(state: State<'_, AppState>) -> CmdResult<PairingCode> {
    with(&state, |s| s.sync_prepare_pairing())?;
    reconcile(&state);
    let server = state
        .sync
        .lock()
        .map_err(|_| err("sincronización bloqueada"))?;
    let server = server.as_ref().ok_or_else(|| {
        err("no se pudo abrir la conexión en la red local: revisa que el cortafuegos permita a NÚCLEO en redes privadas")
    })?;
    Ok(server.begin_pairing()?)
}

#[tauri::command]
pub fn sync_pair_cancel(state: State<'_, AppState>) -> CmdResult<SyncView> {
    if let Ok(server) = state.sync.lock()
        && let Some(s) = server.as_ref()
    {
        s.cancel_pairing();
    }
    view(&state)
}

#[tauri::command]
pub fn sync_revoke(state: State<'_, AppState>, device_uid: String) -> CmdResult<SyncView> {
    with(&state, |s| s.sync_revoke(&device_uid))?;
    view(&state)
}

/// En el celular (o en un segundo equipo): unirse al computador con el código.
#[tauri::command]
pub fn sync_join(
    state: State<'_, AppState>,
    code: String,
    name: String,
) -> CmdResult<PairedDevice> {
    with(&state, |s| s.sync_join(&code, &name))
}

/// En el celular: sincronizar ahora con el computador emparejado.
#[tauri::command]
pub fn sync_now(state: State<'_, AppState>) -> CmdResult<SyncOutcome> {
    with(&state, |s| s.sync_now(None))
}
