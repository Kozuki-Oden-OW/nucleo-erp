-- 0044 · Sincronización fase S1 (docs/SINCRONIZACION.md): llave y dirección de cada dispositivo
-- emparejado.
--
-- * secret: llave de 32 bytes que solo conocen este equipo y ese dispositivo. Se crea al emparejar y
--   autentica y cifra cada sincronización. Se borra al quitar el dispositivo.
-- * address: en el celular, dónde encontrar el computador en la red local («192.168.1.20:47615»).

ALTER TABLE sync_peers ADD COLUMN secret BLOB;
ALTER TABLE sync_peers ADD COLUMN address TEXT;
