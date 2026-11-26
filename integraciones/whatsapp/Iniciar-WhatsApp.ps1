# Arranca el puente de WhatsApp de NÚCLEO ERP (Docker) y muestra los dos datos que se escriben en
# NÚCLEO → Configuración → Integraciones → WhatsApp. La llave se crea una sola vez y queda en .env.
# Uso (PowerShell, en esta carpeta):  powershell -ExecutionPolicy Bypass -File .\Iniciar-WhatsApp.ps1
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$envPath = Join-Path $PSScriptRoot ".env"
$key = ""
if (Test-Path $envPath) { if ((Get-Content $envPath -Raw) -match "(?m)^NUCLEO_WSP_KEY=(.+)$") { $key = $Matches[1].Trim() } }
if ($key.Length -lt 24) {
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $key = "nwsp_" + ([Convert]::ToBase64String($bytes) -replace "[+/=]", "")
  [System.IO.File]::WriteAllText($envPath, "NUCLEO_WSP_KEY=$key`n", (New-Object System.Text.UTF8Encoding $false))
  Write-Host "Llave creada y guardada en .env" -ForegroundColor Green
}
New-Item -ItemType Directory -Force -Path (Join-Path $PSScriptRoot "sesion") | Out-Null

docker compose --env-file "$envPath" -f compose.yml up -d --build
if ($LASTEXITCODE -ne 0) { throw "no se pudo arrancar el puente (¿está abierto Docker Desktop?)" }

Write-Host "Esperando al puente..."
$estado = $null
for ($i = 0; $i -lt 40; $i++) {
  try { $estado = Invoke-RestMethod -Uri "http://127.0.0.1:47620/estado" -Headers @{ Authorization = "Bearer $key" } -TimeoutSec 5; if ($estado.estado -ne "iniciando") { break } } catch { }
  Start-Sleep -Seconds 3
}
Write-Host ""
Write-Host "En NUCLEO -> Configuracion -> Integraciones -> WhatsApp escribe:" -ForegroundColor Cyan
Write-Host "  Direccion del puente: http://127.0.0.1:47620"
Write-Host "  Llave:                $key"
Write-Host ""
if ($estado -and $estado.estado -eq "listo") { Write-Host "WhatsApp ya esta vinculado (+$($estado.numero))." -ForegroundColor Green }
elseif ($estado -and $estado.estado -eq "qr") { Write-Host "Falta vincular el numero: NUCLEO muestra el codigo QR en esa misma pantalla. En el telefono: WhatsApp -> Dispositivos vinculados -> Vincular un dispositivo." -ForegroundColor Yellow }
else { Write-Host "El puente aun esta cargando WhatsApp. Si en un par de minutos NUCLEO no muestra el QR, revisa:  docker logs --tail 40 nucleo-whatsapp" -ForegroundColor Yellow }
