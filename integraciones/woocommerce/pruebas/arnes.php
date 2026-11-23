<?php
// Arnés mínimo: funciones de WordPress y WooCommerce simuladas para ejercitar el plugin sin un sitio real.
// Uso: php integraciones/woocommerce/pruebas/arnes.php [ruta/nucleo-erp.php]
// No reemplaza la prueba en un WordPress real (ver README.md).
error_reporting(E_ALL);
set_error_handler(function ($no, $str, $file, $line) { throw new ErrorException($str, 0, $no, $file, $line); });
define('ABSPATH', '/');
define('WC_VERSION', '9.3.3');
$GLOBALS['hooks'] = []; $GLOBALS['options'] = ['permalink_structure' => '/%postname%/', 'date_format' => 'd-m-Y', 'time_format' => 'H:i']; $GLOBALS['routes'] = []; $GLOBALS['can'] = true; $GLOBALS['blockfields'] = [];
function add_action($h, $cb, $p = 10, $n = 1) { $GLOBALS['hooks'][$h][] = $cb; }
function add_filter($h, $cb, $p = 10, $n = 1) { $GLOBALS['hooks'][$h][] = $cb; }
function do_hook($h, ...$a) { $r = $a[0] ?? null; foreach ($GLOBALS['hooks'][$h] ?? [] as $cb) { $r = $cb(...$a); if (array_key_exists(0, $a)) { $a[0] = $r; } } return $r; }
function is_admin() { return true; }
function plugin_basename($f) { return 'nucleo-erp/nucleo-erp.php'; }
function get_option($k, $d = false) { return $GLOBALS['options'][$k] ?? $d; }
function update_option($k, $v, $a = null) { $GLOBALS['options'][$k] = $v; return true; }
function delete_option($k) { unset($GLOBALS['options'][$k]); return true; }
function __($s, $d = null) { return $s; }
function esc_html__($s, $d = null) { return htmlspecialchars($s, ENT_QUOTES); }
function esc_html_e($s, $d = null) { echo htmlspecialchars($s, ENT_QUOTES); }
function esc_html($s) { return htmlspecialchars((string) $s, ENT_QUOTES); }
function esc_attr($s) { return htmlspecialchars((string) $s, ENT_QUOTES); }
function esc_textarea($s) { return htmlspecialchars((string) $s, ENT_QUOTES); }
function esc_js($s) { return addslashes($s); }
function esc_url($s) { return $s; }
function esc_url_raw($s) { return $s; }
function wp_unslash($s) { return $s; }
function sanitize_key($s) { return preg_replace('/[^a-z0-9_\-]/', '', strtolower($s)); }
function sanitize_text_field($s) { return trim(strip_tags((string) $s)); }
function trailingslashit($s) { return rtrim($s, '/') . '/'; }
function untrailingslashit($s) { return rtrim($s, '/'); }
function rest_get_url_prefix() { return 'wp-json'; }
function rest_url($p = '') { return 'https://tienda.cl/wp-json/' . ltrim($p, '/'); }
function admin_url($p = '') { return 'https://tienda.cl/wp-admin/' . $p; }
function register_rest_route($ns, $r, $args) { $GLOBALS['routes'][$ns . $r] = $args; }
function rest_ensure_response($d) { return $d; }
function current_user_can($c) { return $GLOBALS['can']; }
function get_current_user_id() { return 7; }
function get_bloginfo($k) { return 'Data Logger &amp; Co'; }
function wp_specialchars_decode($s, $f = null) { return htmlspecialchars_decode($s, ENT_QUOTES); }
function get_woocommerce_currency() { return 'CLP'; }
function wc_tax_enabled() { return false; }
function wc_prices_include_tax() { return false; }
function wc_rand_hash() { return bin2hex(random_bytes(20)); }
function wc_api_hash($d) { return hash_hmac('sha256', $d, 'wc-api'); }
function wp_json_encode($d) { return json_encode($d); }
function check_admin_referer($a) { return true; }
function wp_nonce_field($a) { echo '<input type="hidden" name="_wpnonce" value="x" />'; }
function submit_button($t, $type = 'primary', $n = 'submit', $wrap = true) { echo '<button class="button ' . $type . '">' . htmlspecialchars($t) . '</button>'; }
function checked($c) { if ($c) { echo 'checked="checked"'; } }
function wp_date($f, $ts) { return date($f, $ts); }
function wp_die($m) { throw new Exception('wp_die: ' . $m); }
function add_submenu_page(...$a) { $GLOBALS['menu'] = $a; }
function add_meta_box(...$a) { $GLOBALS['metabox'][] = $a; }
function wc_get_page_screen_id($s) { return 'woocommerce_page_wc-orders'; }
function woocommerce_register_additional_checkout_field($a) { $GLOBALS['blockfields'][$a['id']] = $a; }
class WooCommerce {}
class WP_REST_Server { const READABLE = 'GET'; }
class WP_Error { public $errors = []; function add($c, $m) { $this->errors[] = $m; } }
class WC_Order { public $meta = []; function get_meta($k) { return $this->meta[$k] ?? ''; } }
function wc_get_order($id) { return $GLOBALS['order'] ?? null; }
class FakeDb { public $prefix = 'wp_'; public $rows = []; public $insert_id = 0;
  function insert($t, $d, $f) { $this->insert_id++; $d['key_id'] = $this->insert_id; $this->rows[$this->insert_id] = $d + ['last_access' => null]; return 1; }
  function delete($t, $w, $f) { unset($this->rows[$w['key_id']]); return 1; }
  function prepare($q, ...$a) { return ['q' => $q, 'a' => $a]; }
  function get_row($p) { $r = $this->rows[$p['a'][0]] ?? null; return $r ? (object) $r : null; } }
$GLOBALS['wpdb'] = new FakeDb();

function check($cond, $msg) { echo ($cond ? 'ok  ' : 'MAL ') . $msg . "\n"; if (!$cond) { $GLOBALS['fail'] = true; } }
$plugin_file = $argv[1] ?? __DIR__ . '/../nucleo-erp/nucleo-erp.php';
require $plugin_file;
do_hook('plugins_loaded');
check(isset($GLOBALS['hooks']['rest_api_init']), 'engancha la API REST');
check(!isset($GLOBALS['hooks']['woocommerce_checkout_fields']), 'los campos del checkout parten apagados');

// Ruta de estado
do_hook('rest_api_init');
$route = $GLOBALS['routes']['nucleo-erp/v1/status'];
check($route['methods'] === 'GET', 'ruta nucleo-erp/v1/status (GET)');
check(($route['permission_callback'])() === true, 'permiso con manage_woocommerce');
$GLOBALS['can'] = false; check(($route['permission_callback'])() === false, 'sin permiso se rechaza'); $GLOBALS['can'] = true;
$st = ($route['callback'])();
check($st['plugin'] === 'nucleo-erp' && $st['version'] === '0.1.0' && $st['currency'] === 'CLP' && $st['calc_taxes'] === false && $st['store'] === 'Data Logger & Co', 'estado: ' . json_encode($st, JSON_UNESCAPED_UNICODE));
check(get_option('nucleo_erp_last_seen') > 0, 'anota la última consulta de NÚCLEO');

// Autenticación de la ruta con las llaves de WooCommerce
$_SERVER['REQUEST_URI'] = '/wp-json/nucleo-erp/v1/status';
check(do_hook('woocommerce_rest_is_request_to_rest_api', false) === true, 'las llaves de WooCommerce valen para la ruta del plugin');
$_SERVER['REQUEST_URI'] = '/wp-json/wp/v2/posts';
check(do_hook('woocommerce_rest_is_request_to_rest_api', false) === false, 'no cambia otras rutas');

// Crear conexión
$_GET['page'] = 'nucleo-erp'; $_POST['nucleo_erp_action'] = 'connect';
do_hook('admin_init');
ob_start(); do_hook('admin_menu'); ($GLOBALS['menu'][5])(); $html = ob_get_clean();
check(preg_match('/<textarea[^>]*>(nucleo-woo:[A-Za-z0-9_\-]+)<\/textarea>/', $html, $m) === 1, 'muestra el código de conexión');
$code = $m[1];
$json = json_decode(base64_decode(strtr(substr($code, strlen('nucleo-woo:')), '-_', '+/')), true);
check($json['u'] === 'https://tienda.cl' && str_starts_with($json['k'], 'ck_') && str_starts_with($json['s'], 'cs_'), 'el código trae dirección y llaves: ' . $json['u']);
$row = end($GLOBALS['wpdb']->rows);
check($row['permissions'] === 'read_write' && $row['consumer_key'] === wc_api_hash($json['k']) && $row['consumer_secret'] === $json['s'] && $row['truncated_key'] === substr($json['k'], -7) && $row['user_id'] === 7, 'la llave queda guardada como las de WooCommerce');
check(strpos($html, 'Llave creada (termina en …' . substr($json['k'], -7)) !== false, 'la página muestra el estado de la llave');
// Recargar la página: el código no se vuelve a mostrar
unset($_POST['nucleo_erp_action']);
$GLOBALS['hooks'] = []; require_once $plugin_file; Nucleo_Erp_Plugin::init(); do_hook('plugins_loaded');
ob_start(); do_hook('admin_menu'); ($GLOBALS['menu'][5])(); $html2 = ob_get_clean();
check(strpos($html2, 'nucleo-woo:') === false && strpos($html2, $json['s']) === false, 'al recargar no se muestra el código ni la clave');
// Conexión nueva anula la anterior; revocar la borra
$_POST['nucleo_erp_action'] = 'connect'; do_hook('admin_init');
check(count($GLOBALS['wpdb']->rows) === 1, 'una conexión nueva anula la anterior');
$_POST['nucleo_erp_action'] = 'revoke'; do_hook('admin_init');
check(count($GLOBALS['wpdb']->rows) === 0 && get_option('nucleo_erp_key_id', 0) === 0, 'revocar borra la llave');
// Sin permiso
$GLOBALS['can'] = false; $_POST['nucleo_erp_action'] = 'connect';
try { do_hook('admin_init'); check(false, 'sin permiso no crea llaves'); } catch (Exception $e) { check(count($GLOBALS['wpdb']->rows) === 0, 'sin permiso no crea llaves'); }
$GLOBALS['can'] = true;

// Activar los campos del checkout
$_POST['nucleo_erp_action'] = 'settings'; $_POST['nucleo_erp_checkout_fields'] = '1'; do_hook('admin_init');
check(get_option('nucleo_erp_checkout_fields') === 'yes', 'guarda el ajuste del checkout');
unset($_POST['nucleo_erp_action']);
$GLOBALS['hooks'] = []; Nucleo_Erp_Plugin::init(); do_hook('plugins_loaded');
$fields = do_hook('woocommerce_checkout_fields', ['billing' => []]);
check(isset($fields['billing']['billing_nucleo_documento'], $fields['billing']['billing_nucleo_rut'], $fields['billing']['billing_nucleo_razon_social'], $fields['billing']['billing_nucleo_giro']), 'checkout clásico: cuatro campos');
$v = function ($data) { $e = new WP_Error(); foreach ($GLOBALS['hooks']['woocommerce_after_checkout_validation'] as $cb) { $cb($data, $e); } return $e->errors; };
check(count($v(['billing_nucleo_documento' => 'boleta'])) === 0, 'boleta sin RUT: válido');
check(count($v(['billing_nucleo_documento' => 'boleta', 'billing_nucleo_rut' => '12.345.678-9'])) === 1, 'boleta con RUT malo: error');
check(count($v(['billing_nucleo_documento' => 'factura'])) === 3, 'factura sin datos: tres errores');
check(count($v(['billing_nucleo_documento' => 'factura', 'billing_nucleo_rut' => '77.334.963-0', 'billing_nucleo_razon_social' => 'Data Logger Chile SpA', 'billing_nucleo_giro' => 'Importación'])) === 0, 'factura completa: válido');
do_hook('woocommerce_init');
check(array_keys($GLOBALS['blockfields']) === ['nucleo-erp/documento', 'nucleo-erp/rut', 'nucleo-erp/razon_social', 'nucleo-erp/giro'], 'checkout por bloques: cuatro campos');
$e = new WP_Error(); foreach ($GLOBALS['hooks']['woocommerce_blocks_validate_location_order_fields'] as $cb) { $cb($e, ['nucleo-erp/documento' => 'factura', 'nucleo-erp/rut' => '77334963-0'], 'other'); }
check(count($e->errors) === 2, 'bloques: factura sin razón social ni giro');

// Pedido: recuadro y columna
$o = new WC_Order(); $o->meta = ['_nucleo_venta' => 'VEN-000123', '_billing_nucleo_documento' => 'factura', '_billing_nucleo_rut' => '77.334.963-0', '_billing_nucleo_giro' => '<b>Importación</b>'];
$GLOBALS['order'] = $o;
do_hook('add_meta_boxes');
check(count($GLOBALS['metabox']) === 2, 'recuadro en la pantalla clásica y en la de alto rendimiento');
ob_start(); ($GLOBALS['metabox'][0][2])($o); $box = ob_get_clean();
check(strpos($box, 'VEN-000123') !== false && strpos($box, 'Factura') !== false && strpos($box, '&lt;b&gt;Importación') !== false && strpos($box, '<b>Importación') === false, 'recuadro del pedido (con el texto escapado)');
$cols = do_hook('manage_woocommerce_page_wc-orders_columns', ['order_number' => 'Pedido', 'order_status' => 'Estado', 'order_total' => 'Total']);
check(array_keys($cols) === ['order_number', 'order_status', 'nucleo_erp', 'order_total'], 'columna NÚCLEO después del estado');
ob_start(); foreach ($GLOBALS['hooks']['manage_woocommerce_page_wc-orders_custom_column'] as $cb) { $cb('nucleo_erp', $o); } $col = ob_get_clean();
check($col === 'VEN-000123', 'la columna muestra la venta');
echo !empty($GLOBALS['fail']) ? "\nHAY FALLAS\n" : "\nTODO OK\n";
exit(empty($GLOBALS['fail']) ? 0 : 1);
