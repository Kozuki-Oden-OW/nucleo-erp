//! Sincronización celular ⇄ computador, fase S1 (docs/SINCRONIZACION.md): **emparejamiento por
//! código** y **canal cifrado** en la red local (WiFi de la casa u oficina, o el cable con «anclaje
//! de USB»). Sin internet y sin servidor de NÚCLEO.
//!
//! Cómo funciona (D-SYNC-06):
//!
//! * El computador escucha en la red local mientras la sincronización está activada
//!   ([`SyncServer`]). El celular es quien llama.
//! * **Emparejar:** el computador muestra un código de un solo uso, válido 10 minutos, que lleva su
//!   dirección en la red y un secreto de 96 bits ([`encode_code`]). Se escanea como QR o se escribe
//!   en 8 grupos de 4 letras. Con ese secreto ambos equipos abren un canal cifrado y el computador
//!   entrega al celular una **llave propia de 32 bytes**, distinta para cada dispositivo.
//! * **Sincronizar:** el celular se presenta con su identificador; el canal se cifra con la llave de
//!   ese dispositivo y por él viajan los paquetes de la fase S0 (`sync_export` / `sync_import`).
//! * **Canal:** cada conexión acuerda llaves nuevas con X25519 efímero mezclado con el secreto
//!   compartido (HKDF-SHA256); los mensajes van sellados con ChaCha20-Poly1305 y un contador por
//!   sentido. Quien no conoce el secreto no puede leer ni inyectar nada, aunque esté en la misma
//!   WiFi, y grabar el tráfico de hoy no sirve si mañana se filtra una llave.
//! * Quitar un dispositivo borra su llave: deja de poder conectarse.

use crate::sync_ops::{SyncPackage, SyncReport};
use crate::{AppError, AppResult, CompanySession};
use data_encoding::{BASE32_NOPAD, BASE64};
use nucleo_db::core as dbcore;
use nucleo_db::{audit, sync};
use ring::aead::{Aad, CHACHA20_POLY1305, LessSafeKey, Nonce, UnboundKey};
use ring::agreement::{self, EphemeralPrivateKey, UnparsedPublicKey, X25519};
use ring::hkdf::{HKDF_SHA256, Salt};
use ring::rand::SystemRandom;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::{self, Read, Write};
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4, TcpListener, TcpStream, UdpSocket};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

pub const PROTOCOL: u32 = 1;
/// Puerto preferido: fijo para que el cortafuegos de Windows pregunte una sola vez. Si está ocupado
/// se usa uno libre (el código de emparejamiento lleva el puerto real).
pub const DEFAULT_PORT: u16 = 47615;
pub const PAIRING_MINUTES: u64 = 10;
pub const QR_PREFIX: &str = "nucleo-sync:";
const SECRET_LEN: usize = 12;
const KEY_LEN: usize = 32;
const MAX_ATTEMPTS: u8 = 5;
const MAX_FRAME: usize = 64 * 1024 * 1024;
const IO_TIMEOUT: Duration = Duration::from_secs(30);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(8);

/* ───────────── Código de emparejamiento ───────────── */

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PairingTarget {
    pub addr: SocketAddrV4,
    pub secret: [u8; SECRET_LEN],
}

/// Dirección (4) + puerto (2) + secreto (12) + verificador (2) = 20 bytes = 32 letras en 8 grupos.
pub fn encode_code(addr: SocketAddrV4, secret: &[u8; SECRET_LEN]) -> String {
    let mut b = Vec::with_capacity(20);
    b.extend_from_slice(&addr.ip().octets());
    b.extend_from_slice(&addr.port().to_be_bytes());
    b.extend_from_slice(secret);
    let sum = Sha256::digest(&b);
    b.extend_from_slice(&sum[..2]);
    let text = BASE32_NOPAD.encode(&b);
    let groups: Vec<&str> = (0..text.len())
        .step_by(4)
        .map(|i| &text[i..(i + 4).min(text.len())])
        .collect();
    groups.join("-")
}

/// Acepta el texto del QR o el código escrito a mano (con o sin guiones, minúsculas, y los dígitos
/// que se confunden: 0 por O, 1 por I, 8 por B).
pub fn parse_code(text: &str) -> AppResult<PairingTarget> {
    let bad = || {
        AppError::Validation(
            "el código de emparejamiento no es válido: revisa que esté completo y bien escrito"
                .into(),
        )
    };
    let t = text.trim();
    let t = t.strip_prefix(QR_PREFIX).unwrap_or(t);
    let clean: String = t
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| match c.to_ascii_uppercase() {
            '0' => 'O',
            '1' => 'I',
            '8' => 'B',
            c => c,
        })
        .collect();
    if clean.len() != 32 {
        return Err(bad());
    }
    let b = BASE32_NOPAD.decode(clean.as_bytes()).map_err(|_| bad())?;
    if b.len() != 20 || Sha256::digest(&b[..18])[..2] != b[18..] {
        return Err(bad());
    }
    let mut secret = [0u8; SECRET_LEN];
    secret.copy_from_slice(&b[6..18]);
    Ok(PairingTarget {
        addr: SocketAddrV4::new(
            Ipv4Addr::new(b[0], b[1], b[2], b[3]),
            u16::from_be_bytes([b[4], b[5]]),
        ),
        secret,
    })
}

/// Dirección de este equipo en la red local. No envía nada: solo pregunta al sistema por dónde
/// saldría una conexión.
pub fn local_ipv4() -> Option<Ipv4Addr> {
    let s = UdpSocket::bind("0.0.0.0:0").ok()?;
    s.connect("192.0.2.1:9").ok()?;
    match s.local_addr().ok()? {
        SocketAddr::V4(a) if !a.ip().is_unspecified() => Some(*a.ip()),
        _ => None,
    }
}

fn random<const N: usize>() -> AppResult<[u8; N]> {
    let mut b = [0u8; N];
    getrandom::fill(&mut b).map_err(|e| AppError::Validation(format!("azar del sistema: {e}")))?;
    Ok(b)
}

/* ───────────── Mensajes ───────────── */

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PairRequest {
    pub device_uid: String,
    pub name: String,
    pub role: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PairReply {
    pub device_uid: String,
    pub name: String,
    pub role: String,
    /// Nombre del negocio, para que el celular lo muestre.
    pub business: String,
    /// Llave del dispositivo (base64). Solo viaja dentro del canal cifrado.
    #[serde(default)]
    pub key: String,
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "t", content = "d", rename_all = "snake_case")]
enum Msg {
    Pair(PairRequest),
    Paired(PairReply),
    Sync(Box<SyncPackage>),
    Synced {
        package: Box<SyncPackage>,
        report: SyncReport,
    },
    Error {
        message: String,
    },
}

#[derive(Serialize, Deserialize)]
struct Hello {
    nucleo: u32,
    mode: String,
    #[serde(default)]
    device: String,
    eph: String,
}

#[derive(Serialize, Deserialize, Default)]
struct HelloReply {
    nucleo: u32,
    #[serde(default)]
    eph: String,
    #[serde(default)]
    error: Option<String>,
}

/* ───────────── Canal cifrado ───────────── */

#[derive(Debug)]
enum NetError {
    /// No se pudo llegar al otro equipo.
    Unreachable,
    /// El otro equipo cerró la conexión.
    Closed,
    /// Llave o código incorrectos, o mensaje alterado.
    Auth,
    Protocol(String),
    /// El otro equipo explicó por qué no.
    Remote(String),
}

impl From<io::Error> for NetError {
    fn from(e: io::Error) -> Self {
        match e.kind() {
            io::ErrorKind::UnexpectedEof
            | io::ErrorKind::ConnectionReset
            | io::ErrorKind::ConnectionAborted
            | io::ErrorKind::BrokenPipe => NetError::Closed,
            _ => NetError::Unreachable,
        }
    }
}

impl From<NetError> for AppError {
    fn from(e: NetError) -> Self {
        AppError::Validation(match e {
            NetError::Unreachable => "no se pudo conectar con el computador: revisa que NÚCLEO esté abierto, que la sincronización esté activada y que ambos equipos estén en la misma red WiFi (o unidos por el cable)".into(),
            NetError::Closed => "el computador cerró la conexión: si el código venció o este dispositivo fue quitado, vuelve a emparejarlo".into(),
            NetError::Auth => "el código o la llave no coinciden: vuelve a emparejar el dispositivo".into(),
            NetError::Protocol(m) => format!("los equipos no se entendieron ({m}): actualiza NÚCLEO en ambos"),
            NetError::Remote(m) => m,
        })
    }
}

fn write_frame(s: &mut TcpStream, data: &[u8]) -> io::Result<()> {
    s.write_all(&(data.len() as u32).to_be_bytes())?;
    s.write_all(data)?;
    s.flush()
}

fn read_frame(s: &mut TcpStream) -> Result<Vec<u8>, NetError> {
    let mut len = [0u8; 4];
    s.read_exact(&mut len)?;
    let len = u32::from_be_bytes(len) as usize;
    if len > MAX_FRAME {
        return Err(NetError::Protocol("mensaje demasiado grande".into()));
    }
    let mut buf = vec![0u8; len];
    s.read_exact(&mut buf)?;
    Ok(buf)
}

struct Channel {
    stream: TcpStream,
    tx: LessSafeKey,
    rx: LessSafeKey,
    sent: u64,
    received: u64,
}

fn nonce(counter: u64) -> Nonce {
    let mut n = [0u8; 12];
    n[4..].copy_from_slice(&counter.to_be_bytes());
    Nonce::assume_unique_for_key(n)
}

impl Channel {
    fn send(&mut self, msg: &Msg) -> Result<(), NetError> {
        let mut buf = serde_json::to_vec(msg).map_err(|e| NetError::Protocol(e.to_string()))?;
        self.tx
            .seal_in_place_append_tag(nonce(self.sent), Aad::empty(), &mut buf)
            .map_err(|_| NetError::Auth)?;
        self.sent += 1;
        Ok(write_frame(&mut self.stream, &buf)?)
    }

    fn recv(&mut self) -> Result<Msg, NetError> {
        let mut buf = read_frame(&mut self.stream)?;
        let plain = self
            .rx
            .open_in_place(nonce(self.received), Aad::empty(), &mut buf)
            .map_err(|_| NetError::Auth)?;
        self.received += 1;
        serde_json::from_slice(plain).map_err(|e| NetError::Protocol(e.to_string()))
    }
}

/// Llaves de la conexión: una por sentido, a partir del secreto compartido y del acuerdo efímero.
fn session_keys(
    psk: &[u8],
    shared: &[u8],
    mode: &str,
    eph_client: &[u8],
    eph_server: &[u8],
) -> Result<([u8; KEY_LEN], [u8; KEY_LEN]), NetError> {
    let prk = Salt::new(HKDF_SHA256, psk).extract(shared);
    let mut out = ([0u8; KEY_LEN], [0u8; KEY_LEN]);
    for (label, key) in [
        (&b"nucleo-sync-1 c2s"[..], &mut out.0),
        (&b"nucleo-sync-1 s2c"[..], &mut out.1),
    ] {
        prk.expand(
            &[label, mode.as_bytes(), eph_client, eph_server],
            HKDF_SHA256,
        )
        .and_then(|okm| okm.fill(key))
        .map_err(|_| NetError::Auth)?;
    }
    Ok(out)
}

fn aead(key: &[u8; KEY_LEN]) -> Result<LessSafeKey, NetError> {
    Ok(LessSafeKey::new(
        UnboundKey::new(&CHACHA20_POLY1305, key).map_err(|_| NetError::Auth)?,
    ))
}

fn json<T: DeserializeOwned>(bytes: &[u8]) -> Result<T, NetError> {
    serde_json::from_slice(bytes).map_err(|e| NetError::Protocol(e.to_string()))
}

/// El que llama (celular): saluda, acuerda llaves y deja el canal listo.
fn connect(addr: SocketAddr, mode: &str, device: &str, psk: &[u8]) -> Result<Channel, NetError> {
    let mut stream =
        TcpStream::connect_timeout(&addr, CONNECT_TIMEOUT).map_err(|_| NetError::Unreachable)?;
    stream.set_read_timeout(Some(IO_TIMEOUT))?;
    stream.set_write_timeout(Some(IO_TIMEOUT))?;
    let _ = stream.set_nodelay(true);

    let rng = SystemRandom::new();
    let mine = EphemeralPrivateKey::generate(&X25519, &rng).map_err(|_| NetError::Auth)?;
    let my_pub = mine.compute_public_key().map_err(|_| NetError::Auth)?;
    let hello = Hello {
        nucleo: PROTOCOL,
        mode: mode.into(),
        device: device.into(),
        eph: BASE64.encode(my_pub.as_ref()),
    };
    write_frame(
        &mut stream,
        &serde_json::to_vec(&hello).map_err(|e| NetError::Protocol(e.to_string()))?,
    )?;
    let reply: HelloReply = json(&read_frame(&mut stream)?)?;
    if let Some(e) = reply.error {
        return Err(NetError::Remote(e));
    }
    let theirs = BASE64
        .decode(reply.eph.as_bytes())
        .map_err(|_| NetError::Protocol("saludo inválido".into()))?;
    let (c2s, s2c) =
        agreement::agree_ephemeral(mine, &UnparsedPublicKey::new(&X25519, &theirs), |shared| {
            session_keys(psk, shared, mode, my_pub.as_ref(), &theirs)
        })
        .map_err(|_| NetError::Auth)??;
    Ok(Channel {
        stream,
        tx: aead(&c2s)?,
        rx: aead(&s2c)?,
        sent: 0,
        received: 0,
    })
}

/* ───────────── Servidor (computador) ───────────── */

/// Lo que el servidor necesita del negocio abierto. La app de escritorio lo cumple con la sesión
/// (`Mutex<Option<CompanySession>>`).
pub trait SyncHost: Send + Sync {
    /// Llave del dispositivo, si está emparejado y vigente.
    fn peer_key(&self, device_uid: &str) -> Option<Vec<u8>>;
    fn pair(&self, req: &PairRequest, key: &[u8; KEY_LEN]) -> Result<PairReply, String>;
    fn exchange(&self, pkg: &SyncPackage) -> Result<(SyncPackage, SyncReport), String>;
}

const NO_SESSION: &str =
    "NÚCLEO no tiene un negocio abierto en el computador: ábrelo e inténtalo de nuevo";

impl SyncHost for Mutex<Option<CompanySession>> {
    fn peer_key(&self, device_uid: &str) -> Option<Vec<u8>> {
        let guard = self.lock().ok()?;
        guard.as_ref()?.sync_peer_key(device_uid).ok().flatten()
    }

    fn pair(&self, req: &PairRequest, key: &[u8; KEY_LEN]) -> Result<PairReply, String> {
        let mut guard = self.lock().map_err(|_| NO_SESSION.to_string())?;
        let s = guard.as_mut().ok_or(NO_SESSION)?;
        s.sync_accept_pairing(req, key).map_err(|e| e.to_string())
    }

    fn exchange(&self, pkg: &SyncPackage) -> Result<(SyncPackage, SyncReport), String> {
        let mut guard = self.lock().map_err(|_| NO_SESSION.to_string())?;
        let s = guard.as_mut().ok_or(NO_SESSION)?;
        s.sync_exchange(pkg).map_err(|e| e.to_string())
    }
}

struct Pairing {
    secret: [u8; SECRET_LEN],
    expires: Instant,
    attempts: u8,
}

/// Lo que se muestra en el computador para emparejar.
#[derive(Debug, Clone, Serialize)]
pub struct PairingCode {
    /// Ocho grupos de cuatro letras, para escribirlo a mano.
    pub code: String,
    /// Texto del código QR.
    pub qr: String,
    /// Dirección del computador en la red local.
    pub address: String,
    pub minutes: u64,
}

pub struct SyncServer {
    advertised: SocketAddrV4,
    stop: Arc<AtomicBool>,
    pairing: Arc<Mutex<Option<Pairing>>>,
    thread: Option<JoinHandle<()>>,
}

impl SyncServer {
    /// Empieza a escuchar. `bind` con puerto 0 elige uno libre.
    pub fn start(host: Arc<dyn SyncHost>, bind: SocketAddr) -> io::Result<Self> {
        let listener = TcpListener::bind(bind)?;
        listener.set_nonblocking(true)?;
        let local = listener.local_addr()?;
        let ip = match local {
            SocketAddr::V4(a) if !a.ip().is_unspecified() => *a.ip(),
            _ => local_ipv4().unwrap_or(Ipv4Addr::LOCALHOST),
        };
        let stop = Arc::new(AtomicBool::new(false));
        let pairing: Arc<Mutex<Option<Pairing>>> = Arc::new(Mutex::new(None));
        let (stop_t, pairing_t) = (stop.clone(), pairing.clone());
        let thread = thread::Builder::new()
            .name("nucleo-sync".into())
            .spawn(move || {
                while !stop_t.load(Ordering::Relaxed) {
                    match listener.accept() {
                        Ok((stream, _)) => {
                            // Una conexión a la vez: el negocio se toca en orden.
                            let _ = serve(stream, host.as_ref(), &pairing_t);
                        }
                        Err(_) => thread::sleep(Duration::from_millis(150)),
                    }
                }
            })?;
        Ok(Self {
            advertised: SocketAddrV4::new(ip, local.port()),
            stop,
            pairing,
            thread: Some(thread),
        })
    }

    /// En toda la red local, en el puerto habitual o, si está ocupado, en uno libre.
    pub fn start_default(host: Arc<dyn SyncHost>) -> io::Result<Self> {
        let any = |port| SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, port));
        Self::start(host.clone(), any(DEFAULT_PORT)).or_else(|_| Self::start(host, any(0)))
    }

    /// Dirección que deben usar los celulares.
    pub fn address(&self) -> SocketAddrV4 {
        self.advertised
    }

    /// Abre un emparejamiento nuevo (reemplaza al anterior) y entrega su código.
    pub fn begin_pairing(&self) -> AppResult<PairingCode> {
        let secret = random::<SECRET_LEN>()?;
        let code = encode_code(self.advertised, &secret);
        *self.pairing.lock().unwrap_or_else(|p| p.into_inner()) = Some(Pairing {
            secret,
            expires: Instant::now() + Duration::from_secs(PAIRING_MINUTES * 60),
            attempts: 0,
        });
        Ok(PairingCode {
            qr: format!("{QR_PREFIX}{code}"),
            code,
            address: self.advertised.to_string(),
            minutes: PAIRING_MINUTES,
        })
    }

    pub fn cancel_pairing(&self) {
        *self.pairing.lock().unwrap_or_else(|p| p.into_inner()) = None;
    }

    /// Hay un código vigente esperando al celular.
    pub fn pairing_open(&self) -> bool {
        matches!(&*self.pairing.lock().unwrap_or_else(|p| p.into_inner()), Some(p) if p.expires > Instant::now())
    }

    pub fn stop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

impl Drop for SyncServer {
    fn drop(&mut self) {
        self.stop();
    }
}

fn refuse(stream: &mut TcpStream, why: &str) -> Result<(), NetError> {
    let reply = HelloReply {
        nucleo: PROTOCOL,
        error: Some(why.into()),
        ..Default::default()
    };
    write_frame(stream, &serde_json::to_vec(&reply).unwrap_or_default())?;
    Err(NetError::Remote(why.into()))
}

fn serve(
    mut stream: TcpStream,
    host: &dyn SyncHost,
    pairing: &Mutex<Option<Pairing>>,
) -> Result<(), NetError> {
    stream.set_nonblocking(false)?;
    stream.set_read_timeout(Some(IO_TIMEOUT))?;
    stream.set_write_timeout(Some(IO_TIMEOUT))?;
    let _ = stream.set_nodelay(true);

    let hello: Hello = json(&read_frame(&mut stream)?)?;
    if hello.nucleo != PROTOCOL {
        return refuse(
            &mut stream,
            "el computador y el celular tienen versiones distintas de NÚCLEO: actualiza ambos",
        );
    }
    let psk: Vec<u8> = match hello.mode.as_str() {
        "pair" => {
            let open = pairing.lock().unwrap_or_else(|p| p.into_inner());
            match &*open {
                Some(p) if p.expires > Instant::now() => p.secret.to_vec(),
                _ => {
                    drop(open);
                    return refuse(
                        &mut stream,
                        "no hay un emparejamiento abierto o el código venció: pide un código nuevo en el computador (Configuración → Celular)",
                    );
                }
            }
        }
        "sync" => match host.peer_key(&hello.device) {
            Some(k) => k,
            None => {
                return refuse(
                    &mut stream,
                    "este dispositivo no está emparejado con el negocio abierto en el computador",
                );
            }
        },
        _ => return refuse(&mut stream, "pedido desconocido"),
    };

    let theirs = BASE64
        .decode(hello.eph.as_bytes())
        .map_err(|_| NetError::Protocol("saludo inválido".into()))?;
    let rng = SystemRandom::new();
    let mine = EphemeralPrivateKey::generate(&X25519, &rng).map_err(|_| NetError::Auth)?;
    let my_pub = mine.compute_public_key().map_err(|_| NetError::Auth)?;
    let reply = HelloReply {
        nucleo: PROTOCOL,
        eph: BASE64.encode(my_pub.as_ref()),
        error: None,
    };
    write_frame(&mut stream, &serde_json::to_vec(&reply).unwrap_or_default())?;
    let (c2s, s2c) =
        agreement::agree_ephemeral(mine, &UnparsedPublicKey::new(&X25519, &theirs), |shared| {
            session_keys(&psk, shared, &hello.mode, &theirs, my_pub.as_ref())
        })
        .map_err(|_| NetError::Auth)??;
    let mut ch = Channel {
        stream,
        tx: aead(&s2c)?,
        rx: aead(&c2s)?,
        sent: 0,
        received: 0,
    };

    let first = match ch.recv() {
        Err(NetError::Auth) if hello.mode == "pair" => {
            // Código equivocado: tras unos pocos intentos el emparejamiento se cierra.
            let mut open = pairing.lock().unwrap_or_else(|p| p.into_inner());
            if let Some(p) = open.as_mut() {
                p.attempts += 1;
                if p.attempts >= MAX_ATTEMPTS {
                    *open = None;
                }
            }
            return Err(NetError::Auth);
        }
        other => other?,
    };
    let answer = match (hello.mode.as_str(), first) {
        ("pair", Msg::Pair(req)) => {
            // De un solo uso: el código deja de servir apenas alguien lo usó bien.
            *pairing.lock().unwrap_or_else(|p| p.into_inner()) = None;
            let key = random::<KEY_LEN>().map_err(|_| NetError::Auth)?;
            match host.pair(&req, &key) {
                Ok(mut r) => {
                    r.key = BASE64.encode(&key);
                    Msg::Paired(r)
                }
                Err(message) => Msg::Error { message },
            }
        }
        ("sync", Msg::Sync(pkg)) if pkg.from_device == hello.device => match host.exchange(&pkg) {
            Ok((package, report)) => Msg::Synced {
                package: Box::new(package),
                report,
            },
            Err(message) => Msg::Error { message },
        },
        _ => Msg::Error {
            message: "pedido inesperado".into(),
        },
    };
    ch.send(&answer)
}

/* ───────────── Casos de uso ───────────── */

/// Resultado de emparejar, visto desde el celular.
#[derive(Debug, Clone, Serialize)]
pub struct PairedDevice {
    pub device_uid: String,
    pub name: String,
    pub business: String,
    pub address: String,
}

/// Resultado de una sincronización, visto desde el celular.
#[derive(Debug, Clone, Serialize)]
pub struct SyncOutcome {
    pub peer: String,
    pub sent_changes: usize,
    pub sent_ops: usize,
    pub received_changes: usize,
    /// Lo que cambió en este equipo.
    pub local: SyncReport,
    /// Lo que cambió en el computador.
    pub remote: SyncReport,
}

fn parse_address(text: &str) -> AppResult<SocketAddr> {
    let t = text.trim();
    t.parse::<SocketAddr>()
        .or_else(|_| format!("{t}:{DEFAULT_PORT}").parse::<SocketAddr>())
        .map_err(|_| {
            AppError::Validation(
                "la dirección del computador no es válida: debe ser como 192.168.1.20:47615".into(),
            )
        })
}

fn computer_name() -> String {
    ["COMPUTERNAME", "HOSTNAME"]
        .iter()
        .find_map(|k| std::env::var(k).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "Computador".into())
}

pub use nucleo_db::sync::Peer;

const SETTING: &str = "sincronizacion";

impl CompanySession {
    /// El dueño activó la sincronización con celulares en este negocio (el computador escucha en
    /// la red local mientras NÚCLEO está abierto).
    pub fn sync_listening(&self) -> AppResult<bool> {
        Ok(dbcore::get_setting(self.db.conn(), SETTING)?
            .and_then(|v| v.get("escuchar").and_then(|b| b.as_bool()))
            .unwrap_or(false))
    }

    pub fn sync_set_listening(&mut self, on: bool) -> AppResult<()> {
        let user = {
            self.require("config.editar")?;
            self.actor_name()?
        };
        let conn = self.db.conn();
        dbcore::set_setting(conn, SETTING, &serde_json::json!({ "escuchar": on }))?;
        audit::append(
            conn,
            &audit::AuditEntry {
                user_name: &user,
                action: if on {
                    "sync.activar"
                } else {
                    "sync.desactivar"
                },
                entity: "sincronizacion",
                ..Default::default()
            },
        )?;
        Ok(())
    }

    /// Computador: revisa que se pueda abrir un emparejamiento y deja la sincronización activada.
    pub fn sync_prepare_pairing(&mut self) -> AppResult<()> {
        self.require("config.editar")?;
        if self.sync_device()?.1 != "escritorio" {
            return Err(AppError::Validation(
                "los celulares se emparejan desde el computador principal del negocio".into(),
            ));
        }
        if !self.sync_listening()? {
            self.sync_set_listening(true)?;
        }
        Ok(())
    }

    pub fn sync_peer_key(&self, device_uid: &str) -> AppResult<Option<Vec<u8>>> {
        Ok(sync::peer_key(self.db.conn(), device_uid)?)
    }

    /// Computador: acepta al celular que usó bien el código y le guarda su llave.
    pub fn sync_accept_pairing(
        &mut self,
        req: &PairRequest,
        key: &[u8; KEY_LEN],
    ) -> AppResult<PairReply> {
        let (me, role) = self.sync_device()?;
        if role != "escritorio" {
            return Err(AppError::Validation(
                "este equipo no es el computador principal del negocio".into(),
            ));
        }
        if req.role != "celular" || req.device_uid == me {
            return Err(AppError::Validation(
                "solo se pueden emparejar celulares con el computador principal".into(),
            ));
        }
        self.sync_pair(&req.device_uid, &req.name, &req.role)?;
        sync::set_peer_key(self.db.conn(), &req.device_uid, key, None)?;
        Ok(PairReply {
            device_uid: me,
            name: computer_name(),
            role,
            business: self.business()?.name,
            key: String::new(),
        })
    }

    /// Computador: recibe el paquete del celular y arma el de vuelta.
    pub fn sync_exchange(&mut self, pkg: &SyncPackage) -> AppResult<(SyncPackage, SyncReport)> {
        let report = self.sync_import(pkg)?;
        let back = self.sync_export(&pkg.from_device)?;
        Ok((back, report))
    }

    /// Celular: se une al computador con el código (escaneado o escrito).
    pub fn sync_join(&mut self, code: &str, my_name: &str) -> AppResult<PairedDevice> {
        self.require("config.editar")?;
        let target = parse_code(code)?;
        let my_name = my_name.trim();
        if my_name.is_empty() {
            return Err(AppError::Validation(
                "ponle un nombre a este celular (por ejemplo «Celular de Ana»)".into(),
            ));
        }
        let (me, role) = self.sync_device()?;
        if role != "celular" {
            return Err(AppError::Validation(
                "este equipo es el computador principal: el código se usa en el celular".into(),
            ));
        }
        let mut ch = connect(SocketAddr::V4(target.addr), "pair", "", &target.secret)?;
        ch.send(&Msg::Pair(PairRequest {
            device_uid: me,
            name: my_name.into(),
            role,
        }))?;
        let reply = match ch.recv()? {
            Msg::Paired(r) => r,
            Msg::Error { message } => return Err(AppError::Validation(message)),
            _ => return Err(NetError::Protocol("respuesta inesperada".into()).into()),
        };
        let key = BASE64
            .decode(reply.key.as_bytes())
            .ok()
            .filter(|k| k.len() == KEY_LEN)
            .ok_or_else(|| AppError::from(NetError::Protocol("llave inválida".into())))?;
        let address = target.addr.to_string();
        self.sync_pair(&reply.device_uid, &reply.name, &reply.role)?;
        sync::set_peer_key(self.db.conn(), &reply.device_uid, &key, Some(&address))?;
        Ok(PairedDevice {
            device_uid: reply.device_uid,
            name: reply.name,
            business: reply.business,
            address,
        })
    }

    /// Celular: cambia la dirección del computador (si la red le dio otra).
    pub fn sync_set_address(&mut self, device_uid: &str, address: &str) -> AppResult<()> {
        self.require("config.editar")?;
        let addr = parse_address(address)?;
        if sync::set_peer_address(self.db.conn(), device_uid, &addr.to_string())? == 0 {
            return Err(AppError::NotFound("el dispositivo".into()));
        }
        Ok(())
    }

    /// Celular: sincroniza ahora con el computador emparejado (o con el indicado).
    pub fn sync_now(&mut self, device_uid: Option<&str>) -> AppResult<SyncOutcome> {
        self.require("config.ver")?;
        let peers = self.sync_peers()?;
        let peer = peers
            .into_iter()
            .find(|p| {
                !p.revoked
                    && p.has_key
                    && device_uid.map_or(p.role == "escritorio", |d| d == p.device_uid)
            })
            .ok_or_else(|| {
                AppError::Validation(
                    "este celular aún no está emparejado con un computador: usa el código de Configuración → Celular".into(),
                )
            })?;
        let key = self.sync_peer_key(&peer.device_uid)?.unwrap_or_default();
        let addr = parse_address(peer.address.as_deref().unwrap_or_default())?;
        let (me, _) = self.sync_device()?;
        let pkg = self.sync_export(&peer.device_uid)?;
        let (sent_changes, sent_ops) = (pkg.changes.len(), pkg.ops.len());

        let mut ch = connect(addr, "sync", &me, &key)?;
        ch.send(&Msg::Sync(Box::new(pkg)))?;
        let (package, remote) = match ch.recv()? {
            Msg::Synced { package, report } => (package, report),
            Msg::Error { message } => return Err(AppError::Validation(message)),
            _ => return Err(NetError::Protocol("respuesta inesperada".into()).into()),
        };
        let local = self.sync_import(&package)?;
        Ok(SyncOutcome {
            peer: peer.name,
            sent_changes,
            sent_ops,
            received_changes: package.changes.len(),
            local,
            remote,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn el_codigo_va_y_vuelve() {
        let addr = SocketAddrV4::new(Ipv4Addr::new(192, 168, 1, 20), DEFAULT_PORT);
        let secret = [7u8; SECRET_LEN];
        let code = encode_code(addr, &secret);
        assert_eq!(code.len(), 39, "8 grupos de 4 letras con 7 guiones: {code}");
        let want = PairingTarget { addr, secret };
        assert_eq!(parse_code(&code).unwrap(), want);
        // Como QR, en minúsculas y sin guiones.
        assert_eq!(parse_code(&format!("{QR_PREFIX}{code}")).unwrap(), want);
        assert_eq!(
            parse_code(&code.to_lowercase().replace('-', " ")).unwrap(),
            want
        );
    }

    #[test]
    fn un_codigo_mal_escrito_se_rechaza() {
        let addr = SocketAddrV4::new(Ipv4Addr::new(10, 0, 0, 5), 40000);
        let code = encode_code(addr, &[1u8; SECRET_LEN]);
        let mut chars: Vec<char> = code.chars().collect();
        chars[0] = if chars[0] == 'A' { 'B' } else { 'A' };
        let wrong: String = chars.into_iter().collect();
        assert!(parse_code(&wrong).is_err());
        assert!(parse_code("ABCD-EFGH").is_err());
        assert!(parse_code("").is_err());
    }

    #[test]
    fn las_llaves_dependen_del_secreto() {
        let a = session_keys(b"uno", b"compartido", "sync", b"c", b"s").unwrap();
        let b = session_keys(b"dos", b"compartido", "sync", b"c", b"s").unwrap();
        let c = session_keys(b"uno", b"compartido", "pair", b"c", b"s").unwrap();
        assert_ne!(a.0, a.1, "una llave por sentido");
        assert_ne!(a.0, b.0);
        assert_ne!(a.0, c.0);
    }
}
