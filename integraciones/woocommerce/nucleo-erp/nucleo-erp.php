<?php
/**
 * Plugin Name:       NÚCLEO ERP para WooCommerce
 * Plugin URI:        https://www.nucleoerp.cl/
 * Description:       Conecta tu tienda WooCommerce con NÚCLEO ERP, el programa de gestión gratuito y local para pymes chilenas: los pedidos pagados pasan a NÚCLEO como cliente, venta y envío, y NÚCLEO mantiene el stock y los precios de la tienda.
 * Version:           0.1.0
 * Requires at least: 6.2
 * Requires PHP:      7.4
 * Requires Plugins:  woocommerce
 * WC requires at least: 7.0
 * WC tested up to:   9.4
 * Author:            FAVOR SpA
 * Author URI:        https://www.nucleoerp.cl/
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       nucleo-erp
 *
 * @package NucleoErp
 */

defined( 'ABSPATH' ) || exit;

define( 'NUCLEO_ERP_VERSION', '0.1.0' );
define( 'NUCLEO_ERP_FILE', __FILE__ );

/**
 * Qué hace este plugin (y qué no):
 *
 * - NÚCLEO ERP corre en el computador de la empresa y se conecta a la tienda por la API REST de
 *   WooCommerce. El plugin no envía datos a ningún servidor: solo responde a NÚCLEO.
 * - «Crear conexión» genera una llave de la API de WooCommerce (lectura y escritura) y muestra una
 *   sola vez el código que se pega en NÚCLEO.
 * - Agrega la ruta `nucleo-erp/v1/status` (misma autenticación que WooCommerce) con lo que NÚCLEO
 *   necesita saber: moneda, impuestos y versión.
 * - Muestra en cada pedido la venta de NÚCLEO (dato `_nucleo_venta`, que escribe NÚCLEO).
 * - Opcional: pide boleta o factura en el checkout, con RUT, razón social y giro.
 */
final class Nucleo_Erp_Plugin {

	const OPTION_KEY_ID   = 'nucleo_erp_key_id';
	const OPTION_CHECKOUT = 'nucleo_erp_checkout_fields';
	const OPTION_SEEN     = 'nucleo_erp_last_seen';
	const META_SALE       = '_nucleo_venta';
	const NONCE           = 'nucleo_erp_admin';
	const CODE_PREFIX     = 'nucleo-woo:';

	/**
	 * Código de conexión recién creado (se muestra una sola vez, en la misma respuesta).
	 *
	 * @var string
	 */
	private $new_code = '';

	/**
	 * Aviso para la página de ajustes.
	 *
	 * @var string
	 */
	private $notice = '';

	public static function init() {
		$plugin = new self();
		add_action( 'before_woocommerce_init', array( $plugin, 'declare_compatibility' ) );
		add_action( 'plugins_loaded', array( $plugin, 'boot' ) );
	}

	/** Compatible con el almacenamiento de pedidos de alto rendimiento (HPOS) y el checkout por bloques. */
	public function declare_compatibility() {
		if ( class_exists( '\Automattic\WooCommerce\Utilities\FeaturesUtil' ) ) {
			\Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility( 'custom_order_tables', NUCLEO_ERP_FILE, true );
			\Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility( 'cart_checkout_blocks', NUCLEO_ERP_FILE, true );
		}
	}

	public function boot() {
		if ( ! class_exists( 'WooCommerce' ) ) {
			add_action( 'admin_notices', array( $this, 'missing_woocommerce_notice' ) );
			return;
		}
		add_filter( 'woocommerce_rest_is_request_to_rest_api', array( $this, 'authenticate_route' ) );
		add_action( 'rest_api_init', array( $this, 'register_routes' ) );
		add_action( 'woocommerce_init', array( $this, 'register_block_checkout_fields' ) );

		if ( $this->checkout_fields_enabled() ) {
			add_filter( 'woocommerce_checkout_fields', array( $this, 'classic_checkout_fields' ) );
			add_action( 'woocommerce_after_checkout_validation', array( $this, 'validate_classic_checkout' ), 10, 2 );
			add_action( 'woocommerce_blocks_validate_location_order_fields', array( $this, 'validate_block_checkout' ), 10, 3 );
		}

		if ( is_admin() ) {
			add_action( 'admin_menu', array( $this, 'admin_menu' ), 60 );
			add_action( 'admin_init', array( $this, 'handle_admin_post' ) );
			add_action( 'add_meta_boxes', array( $this, 'add_order_meta_box' ) );
			add_filter( 'manage_edit-shop_order_columns', array( $this, 'order_column' ), 20 );
			add_filter( 'manage_woocommerce_page_wc-orders_columns', array( $this, 'order_column' ), 20 );
			add_action( 'manage_shop_order_posts_custom_column', array( $this, 'order_column_legacy' ), 10, 2 );
			add_action( 'manage_woocommerce_page_wc-orders_custom_column', array( $this, 'order_column_hpos' ), 10, 2 );
			add_filter( 'plugin_action_links_' . plugin_basename( NUCLEO_ERP_FILE ), array( $this, 'action_links' ) );
		}
	}

	public function missing_woocommerce_notice() {
		echo '<div class="notice notice-warning"><p>' . esc_html__( 'NÚCLEO ERP para WooCommerce necesita que WooCommerce esté activo.', 'nucleo-erp' ) . '</p></div>';
	}

	private function checkout_fields_enabled() {
		return 'yes' === get_option( self::OPTION_CHECKOUT, 'no' );
	}

	/* ───────────────────────────── API para NÚCLEO ───────────────────────────── */

	/**
	 * Hace que las llaves de WooCommerce también autentiquen las rutas de este plugin.
	 *
	 * @param bool $is_rest Lo que ya decidió WooCommerce.
	 * @return bool
	 */
	public function authenticate_route( $is_rest ) {
		if ( $is_rest || empty( $_SERVER['REQUEST_URI'] ) ) {
			return $is_rest;
		}
		$uri = esc_url_raw( wp_unslash( $_SERVER['REQUEST_URI'] ) );
		return false !== strpos( $uri, trailingslashit( rest_get_url_prefix() ) . 'nucleo-erp/' );
	}

	public function register_routes() {
		register_rest_route(
			'nucleo-erp/v1',
			'/status',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'rest_status' ),
				'permission_callback' => array( $this, 'rest_permission' ),
			)
		);
	}

	public function rest_permission() {
		return current_user_can( 'manage_woocommerce' );
	}

	public function rest_status() {
		update_option( self::OPTION_SEEN, time(), false );
		$hpos = class_exists( '\Automattic\WooCommerce\Utilities\OrderUtil' )
			&& \Automattic\WooCommerce\Utilities\OrderUtil::custom_orders_table_usage_is_enabled();
		return rest_ensure_response(
			array(
				'plugin'             => 'nucleo-erp',
				'version'            => NUCLEO_ERP_VERSION,
				'store'              => wp_specialchars_decode( get_bloginfo( 'name' ), ENT_QUOTES ),
				'currency'           => get_woocommerce_currency(),
				'calc_taxes'         => wc_tax_enabled(),
				'prices_include_tax' => wc_prices_include_tax(),
				'woocommerce'        => defined( 'WC_VERSION' ) ? WC_VERSION : '',
				'hpos'               => (bool) $hpos,
				'checkout_fields'    => $this->checkout_fields_enabled(),
			)
		);
	}

	/* ───────────────────────────── Conexión ───────────────────────────── */

	/** Dirección de la tienda como la espera NÚCLEO (sin `/wp-json`). */
	private function store_url() {
		return untrailingslashit( preg_replace( '#/' . preg_quote( rest_get_url_prefix(), '#' ) . '/?$#', '', rest_url() ) );
	}

	/** Llave creada por este plugin, si sigue existiendo. */
	private function current_key() {
		global $wpdb;
		$id = (int) get_option( self::OPTION_KEY_ID, 0 );
		if ( ! $id ) {
			return null;
		}
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery
		$row = $wpdb->get_row( $wpdb->prepare( "SELECT key_id, truncated_key, last_access FROM {$wpdb->prefix}woocommerce_api_keys WHERE key_id = %d", $id ) );
		return $row ? $row : null;
	}

	private function revoke_key() {
		global $wpdb;
		$id = (int) get_option( self::OPTION_KEY_ID, 0 );
		if ( $id ) {
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery
			$wpdb->delete( $wpdb->prefix . 'woocommerce_api_keys', array( 'key_id' => $id ), array( '%d' ) );
		}
		delete_option( self::OPTION_KEY_ID );
	}

	/** Crea la llave de la API (como lo hace WooCommerce → Ajustes → Avanzado → API REST) y arma el código. */
	private function create_connection() {
		global $wpdb;
		$this->revoke_key();
		$consumer_key    = 'ck_' . wc_rand_hash();
		$consumer_secret = 'cs_' . wc_rand_hash();
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery
		$ok = $wpdb->insert(
			$wpdb->prefix . 'woocommerce_api_keys',
			array(
				'user_id'         => get_current_user_id(),
				'description'     => 'NÚCLEO ERP',
				'permissions'     => 'read_write',
				'consumer_key'    => wc_api_hash( $consumer_key ),
				'consumer_secret' => $consumer_secret,
				'truncated_key'   => substr( $consumer_key, -7 ),
			),
			array( '%d', '%s', '%s', '%s', '%s', '%s' )
		);
		if ( ! $ok ) {
			return '';
		}
		update_option( self::OPTION_KEY_ID, (int) $wpdb->insert_id, false );
		$json = wp_json_encode(
			array(
				'u' => $this->store_url(),
				'k' => $consumer_key,
				's' => $consumer_secret,
			)
		);
		// phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode -- formato del código de conexión.
		return self::CODE_PREFIX . rtrim( strtr( base64_encode( $json ), '+/', '-_' ), '=' );
	}

	/* ───────────────────────────── Administración ───────────────────────────── */

	public function admin_menu() {
		add_submenu_page(
			'woocommerce',
			__( 'NÚCLEO ERP', 'nucleo-erp' ),
			__( 'NÚCLEO ERP', 'nucleo-erp' ),
			'manage_woocommerce',
			'nucleo-erp',
			array( $this, 'render_admin_page' )
		);
	}

	public function action_links( $links ) {
		array_unshift( $links, '<a href="' . esc_url( admin_url( 'admin.php?page=nucleo-erp' ) ) . '">' . esc_html__( 'Conexión', 'nucleo-erp' ) . '</a>' );
		return $links;
	}

	public function handle_admin_post() {
		if ( empty( $_POST['nucleo_erp_action'] ) || ! isset( $_GET['page'] ) || 'nucleo-erp' !== $_GET['page'] ) {
			return;
		}
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			wp_die( esc_html__( 'No tienes permiso para cambiar esta configuración.', 'nucleo-erp' ) );
		}
		check_admin_referer( self::NONCE );
		$action = sanitize_key( wp_unslash( $_POST['nucleo_erp_action'] ) );
		if ( 'connect' === $action ) {
			$this->new_code = $this->create_connection();
			$this->notice   = $this->new_code
				? __( 'Conexión creada. Copia el código y pégalo en NÚCLEO ahora: no se vuelve a mostrar.', 'nucleo-erp' )
				: __( 'No se pudo crear la llave de la API. Revisa que WooCommerce esté instalado correctamente.', 'nucleo-erp' );
		} elseif ( 'revoke' === $action ) {
			$this->revoke_key();
			$this->notice = __( 'Conexión revocada: NÚCLEO ya no puede entrar con la llave anterior.', 'nucleo-erp' );
		} elseif ( 'settings' === $action ) {
			update_option( self::OPTION_CHECKOUT, empty( $_POST['nucleo_erp_checkout_fields'] ) ? 'no' : 'yes' );
			$this->notice = __( 'Ajustes guardados.', 'nucleo-erp' );
		}
	}

	public function render_admin_page() {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			return;
		}
		$key        = $this->current_key();
		$seen       = (int) get_option( self::OPTION_SEEN, 0 );
		$permalinks = '' !== (string) get_option( 'permalink_structure', '' );
		$https      = 0 === strpos( $this->store_url(), 'https://' );
		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'NÚCLEO ERP', 'nucleo-erp' ); ?></h1>
			<p style="max-width:60em">
				<?php esc_html_e( 'NÚCLEO ERP es un programa de gestión gratuito que funciona en tu computador. Con esta conexión, los pedidos pagados de tu tienda pasan a NÚCLEO como cliente, venta (descuenta stock) y envío por despachar, y NÚCLEO puede mantener el stock y los precios de la tienda. Este plugin no envía tus datos a ningún servidor: solo le responde a tu NÚCLEO.', 'nucleo-erp' ); ?>
			</p>

			<?php if ( $this->notice ) : ?>
				<div class="notice notice-info"><p><?php echo esc_html( $this->notice ); ?></p></div>
			<?php endif; ?>
			<?php if ( ! $permalinks ) : ?>
				<div class="notice notice-error"><p><?php esc_html_e( 'Los enlaces permanentes están en «Simple». Cámbialos en Ajustes → Enlaces permanentes (por ejemplo «Nombre de la entrada») para que NÚCLEO pueda conectarse.', 'nucleo-erp' ); ?></p></div>
			<?php endif; ?>
			<?php if ( ! $https ) : ?>
				<div class="notice notice-warning"><p><?php esc_html_e( 'La tienda no usa https. NÚCLEO solo se conecta a tiendas con https, para que las llaves viajen cifradas.', 'nucleo-erp' ); ?></p></div>
			<?php endif; ?>

			<h2><?php esc_html_e( 'Conexión', 'nucleo-erp' ); ?></h2>
			<?php if ( $this->new_code ) : ?>
				<p><strong><?php esc_html_e( 'Código de conexión', 'nucleo-erp' ); ?></strong></p>
				<textarea id="nucleo-erp-code" readonly rows="4" style="width:100%;max-width:60em;font-family:monospace" onfocus="this.select()"><?php echo esc_textarea( $this->new_code ); ?></textarea>
				<p>
					<button type="button" class="button" onclick="var t=document.getElementById('nucleo-erp-code');t.select();if(navigator.clipboard){navigator.clipboard.writeText(t.value);}this.textContent='<?php echo esc_js( __( 'Copiado', 'nucleo-erp' ) ); ?>';"><?php esc_html_e( 'Copiar código', 'nucleo-erp' ); ?></button>
				</p>
				<ol style="max-width:60em">
					<li><?php esc_html_e( 'Abre NÚCLEO ERP en tu computador: Configuración → Integraciones → WooCommerce.', 'nucleo-erp' ); ?></li>
					<li><?php esc_html_e( 'Pega el código en «Código de conexión» y presiona Conectar.', 'nucleo-erp' ); ?></li>
				</ol>
				<p class="description"><?php esc_html_e( 'El código contiene las llaves de tu tienda: no lo envíes por correo ni por chat. Si lo pierdes, crea una conexión nueva.', 'nucleo-erp' ); ?></p>
			<?php endif; ?>

			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><?php esc_html_e( 'Estado', 'nucleo-erp' ); ?></th>
					<td>
						<?php if ( $key ) : ?>
							<?php
							/* translators: %s: últimos caracteres de la llave */
							echo esc_html( sprintf( __( 'Llave creada (termina en …%s).', 'nucleo-erp' ), $key->truncated_key ) );
							echo ' ';
							if ( $seen ) {
								/* translators: %s: fecha y hora */
								echo esc_html( sprintf( __( 'NÚCLEO consultó la tienda por última vez el %s.', 'nucleo-erp' ), wp_date( get_option( 'date_format' ) . ' ' . get_option( 'time_format' ), $seen ) ) );
							} else {
								esc_html_e( 'NÚCLEO todavía no se ha conectado.', 'nucleo-erp' );
							}
							?>
						<?php else : ?>
							<?php esc_html_e( 'Sin conexión.', 'nucleo-erp' ); ?>
						<?php endif; ?>
					</td>
				</tr>
			</table>
			<form method="post" style="display:inline-block;margin-right:8px">
				<?php wp_nonce_field( self::NONCE ); ?>
				<input type="hidden" name="nucleo_erp_action" value="connect" />
				<?php submit_button( $key ? __( 'Crear una conexión nueva', 'nucleo-erp' ) : __( 'Crear conexión', 'nucleo-erp' ), 'primary', 'submit', false ); ?>
			</form>
			<?php if ( $key ) : ?>
				<form method="post" style="display:inline-block">
					<?php wp_nonce_field( self::NONCE ); ?>
					<input type="hidden" name="nucleo_erp_action" value="revoke" />
					<?php submit_button( __( 'Revocar conexión', 'nucleo-erp' ), 'delete', 'submit', false ); ?>
				</form>
				<p class="description"><?php esc_html_e( 'Crear una conexión nueva anula la anterior.', 'nucleo-erp' ); ?></p>
			<?php endif; ?>

			<h2><?php esc_html_e( 'Boleta o factura en el checkout', 'nucleo-erp' ); ?></h2>
			<form method="post">
				<?php wp_nonce_field( self::NONCE ); ?>
				<input type="hidden" name="nucleo_erp_action" value="settings" />
				<label>
					<input type="checkbox" name="nucleo_erp_checkout_fields" value="1" <?php checked( $this->checkout_fields_enabled() ); ?> />
					<?php esc_html_e( 'Preguntar si el cliente quiere boleta o factura y, para la factura, pedir RUT, razón social y giro.', 'nucleo-erp' ); ?>
				</label>
				<p class="description" style="max-width:60em"><?php esc_html_e( 'Los datos quedan en el pedido y llegan a NÚCLEO listos para facturar. Déjalo apagado si tu tienda ya pide el RUT con otro plugin: NÚCLEO también reconoce esos datos.', 'nucleo-erp' ); ?></p>
				<?php submit_button( __( 'Guardar ajustes', 'nucleo-erp' ) ); ?>
			</form>
		</div>
		<?php
	}

	/* ───────────────────────────── Pedido: venta de NÚCLEO ───────────────────────────── */

	/**
	 * Lo que NÚCLEO y el checkout dejaron anotado en el pedido.
	 *
	 * @param WC_Order $order Pedido.
	 * @return array<string,string>
	 */
	private function order_info( $order ) {
		$get = function ( $keys ) use ( $order ) {
			foreach ( $keys as $k ) {
				$v = $order->get_meta( $k );
				if ( is_string( $v ) && '' !== trim( $v ) ) {
					return trim( $v );
				}
			}
			return '';
		};
		return array(
			'venta'        => $get( array( self::META_SALE ) ),
			'documento'    => $get( array( '_billing_nucleo_documento', '_wc_other/nucleo-erp/documento' ) ),
			'rut'          => $get( array( '_billing_nucleo_rut', '_wc_other/nucleo-erp/rut' ) ),
			'razon_social' => $get( array( '_billing_nucleo_razon_social', '_wc_other/nucleo-erp/razon_social' ) ),
			'giro'         => $get( array( '_billing_nucleo_giro', '_wc_other/nucleo-erp/giro' ) ),
		);
	}

	public function add_order_meta_box() {
		$screens = array( 'shop_order' );
		if ( function_exists( 'wc_get_page_screen_id' ) ) {
			$screens[] = wc_get_page_screen_id( 'shop-order' );
		}
		foreach ( array_unique( $screens ) as $screen ) {
			add_meta_box( 'nucleo-erp-order', __( 'NÚCLEO ERP', 'nucleo-erp' ), array( $this, 'render_order_meta_box' ), $screen, 'side', 'default' );
		}
	}

	/**
	 * @param WP_Post|WC_Order $post_or_order Pedido (según el almacenamiento de pedidos).
	 */
	public function render_order_meta_box( $post_or_order ) {
		$order = $post_or_order instanceof WC_Order ? $post_or_order : wc_get_order( $post_or_order->ID );
		if ( ! $order ) {
			return;
		}
		$info = $this->order_info( $order );
		echo '<p><strong>' . esc_html__( 'Venta en NÚCLEO:', 'nucleo-erp' ) . '</strong> ';
		echo $info['venta'] ? esc_html( $info['venta'] ) : esc_html__( 'aún no importado', 'nucleo-erp' );
		echo '</p>';
		$labels = array(
			'documento'    => __( 'Documento', 'nucleo-erp' ),
			'rut'          => __( 'RUT', 'nucleo-erp' ),
			'razon_social' => __( 'Razón social', 'nucleo-erp' ),
			'giro'         => __( 'Giro', 'nucleo-erp' ),
		);
		foreach ( $labels as $k => $label ) {
			if ( $info[ $k ] ) {
				echo '<p><strong>' . esc_html( $label ) . ':</strong> ' . esc_html( 'documento' === $k ? ucfirst( $info[ $k ] ) : $info[ $k ] ) . '</p>';
			}
		}
	}

	public function order_column( $columns ) {
		$out = array();
		foreach ( $columns as $key => $label ) {
			$out[ $key ] = $label;
			if ( 'order_status' === $key ) {
				$out['nucleo_erp'] = __( 'NÚCLEO', 'nucleo-erp' );
			}
		}
		if ( ! isset( $out['nucleo_erp'] ) ) {
			$out['nucleo_erp'] = __( 'NÚCLEO', 'nucleo-erp' );
		}
		return $out;
	}

	public function order_column_legacy( $column, $post_id ) {
		if ( 'nucleo_erp' === $column ) {
			$this->print_order_column( wc_get_order( $post_id ) );
		}
	}

	public function order_column_hpos( $column, $order ) {
		if ( 'nucleo_erp' === $column ) {
			$this->print_order_column( $order );
		}
	}

	private function print_order_column( $order ) {
		if ( ! $order instanceof WC_Order ) {
			return;
		}
		$sale = $order->get_meta( self::META_SALE );
		echo $sale ? esc_html( $sale ) : '<span aria-hidden="true">—</span>';
	}

	/* ───────────────────────────── Checkout: boleta o factura ───────────────────────────── */

	/** RUT chileno válido (módulo 11), con o sin puntos. */
	public static function valid_rut( $rut ) {
		$clean = strtoupper( preg_replace( '/[^0-9kK]/', '', (string) $rut ) );
		if ( strlen( $clean ) < 2 || strlen( $clean ) > 9 ) {
			return false;
		}
		$body = substr( $clean, 0, -1 );
		$dv   = substr( $clean, -1 );
		if ( ! ctype_digit( $body ) ) {
			return false;
		}
		$sum = 0;
		$mul = 2;
		for ( $i = strlen( $body ) - 1; $i >= 0; $i-- ) {
			$sum += (int) $body[ $i ] * $mul;
			$mul  = 7 === $mul ? 2 : $mul + 1;
		}
		$rest     = 11 - ( $sum % 11 );
		$expected = 11 === $rest ? '0' : ( 10 === $rest ? 'K' : (string) $rest );
		return $dv === $expected;
	}

	/**
	 * Revisa lo que escribió el cliente. Devuelve los mensajes de error (vacío si está bien).
	 *
	 * @param string $documento    «boleta» o «factura».
	 * @param string $rut          RUT.
	 * @param string $razon_social Razón social.
	 * @param string $giro         Giro.
	 * @return string[]
	 */
	private function document_errors( $documento, $rut, $razon_social, $giro ) {
		$errors = array();
		if ( '' !== $rut && ! self::valid_rut( $rut ) ) {
			$errors[] = __( 'El RUT no es válido. Escríbelo con dígito verificador, por ejemplo 76.123.456-7.', 'nucleo-erp' );
		}
		if ( 'factura' === $documento ) {
			if ( '' === $rut ) {
				$errors[] = __( 'Para la factura necesitamos el RUT de la empresa.', 'nucleo-erp' );
			}
			if ( '' === $razon_social ) {
				$errors[] = __( 'Para la factura necesitamos la razón social.', 'nucleo-erp' );
			}
			if ( '' === $giro ) {
				$errors[] = __( 'Para la factura necesitamos el giro.', 'nucleo-erp' );
			}
		}
		return $errors;
	}

	private function document_options() {
		return array(
			'boleta'  => __( 'Boleta', 'nucleo-erp' ),
			'factura' => __( 'Factura', 'nucleo-erp' ),
		);
	}

	/** Checkout clásico: los campos `billing_*` quedan en el pedido como `_billing_*`. */
	public function classic_checkout_fields( $fields ) {
		$fields['billing']['billing_nucleo_documento']    = array(
			'type'     => 'select',
			'label'    => __( '¿Boleta o factura?', 'nucleo-erp' ),
			'options'  => $this->document_options(),
			'default'  => 'boleta',
			'required' => true,
			'class'    => array( 'form-row-wide' ),
			'priority' => 121,
		);
		$fields['billing']['billing_nucleo_rut']          = array(
			'type'        => 'text',
			'label'       => __( 'RUT', 'nucleo-erp' ),
			'placeholder' => '76.123.456-7',
			'required'    => false,
			'class'       => array( 'form-row-first' ),
			'priority'    => 122,
		);
		$fields['billing']['billing_nucleo_razon_social'] = array(
			'type'     => 'text',
			'label'    => __( 'Razón social (solo factura)', 'nucleo-erp' ),
			'required' => false,
			'class'    => array( 'form-row-last' ),
			'priority' => 123,
		);
		$fields['billing']['billing_nucleo_giro']         = array(
			'type'     => 'text',
			'label'    => __( 'Giro (solo factura)', 'nucleo-erp' ),
			'required' => false,
			'class'    => array( 'form-row-wide' ),
			'priority' => 124,
		);
		return $fields;
	}

	/**
	 * @param array    $data   Datos del checkout.
	 * @param WP_Error $errors Errores.
	 */
	public function validate_classic_checkout( $data, $errors ) {
		$val = function ( $k ) use ( $data ) {
			return isset( $data[ $k ] ) ? trim( (string) $data[ $k ] ) : '';
		};
		foreach ( $this->document_errors( $val( 'billing_nucleo_documento' ), $val( 'billing_nucleo_rut' ), $val( 'billing_nucleo_razon_social' ), $val( 'billing_nucleo_giro' ) ) as $message ) {
			$errors->add( 'nucleo_erp_documento', $message );
		}
	}

	/** Checkout por bloques (WooCommerce 8.9 o superior): campos adicionales del pedido. */
	public function register_block_checkout_fields() {
		if ( ! $this->checkout_fields_enabled() || ! function_exists( 'woocommerce_register_additional_checkout_field' ) ) {
			return;
		}
		$options = array();
		foreach ( $this->document_options() as $value => $label ) {
			$options[] = array(
				'value' => $value,
				'label' => $label,
			);
		}
		try {
			woocommerce_register_additional_checkout_field(
				array(
					'id'       => 'nucleo-erp/documento',
					'label'    => __( '¿Boleta o factura?', 'nucleo-erp' ),
					'location' => 'order',
					'type'     => 'select',
					'required' => true,
					'options'  => $options,
				)
			);
			$texts = array(
				'nucleo-erp/rut'          => __( 'RUT', 'nucleo-erp' ),
				'nucleo-erp/razon_social' => __( 'Razón social (solo factura)', 'nucleo-erp' ),
				'nucleo-erp/giro'         => __( 'Giro (solo factura)', 'nucleo-erp' ),
			);
			foreach ( $texts as $id => $label ) {
				woocommerce_register_additional_checkout_field(
					array(
						'id'                => $id,
						'label'             => $label,
						'location'          => 'order',
						'type'              => 'text',
						'required'          => false,
						'sanitize_callback' => 'sanitize_text_field',
					)
				);
			}
		} catch ( \Throwable $e ) {
			// Una versión de WooCommerce que no admite estos campos: el checkout clásico sigue funcionando.
			unset( $e );
		}
	}

	/**
	 * @param WP_Error $errors Errores.
	 * @param array    $fields Valores de los campos de la ubicación «order».
	 * @param string   $group  Grupo (no se usa).
	 */
	public function validate_block_checkout( $errors, $fields, $group = '' ) {
		unset( $group );
		$val = function ( $k ) use ( $fields ) {
			return isset( $fields[ $k ] ) ? trim( (string) $fields[ $k ] ) : '';
		};
		foreach ( $this->document_errors( $val( 'nucleo-erp/documento' ), $val( 'nucleo-erp/rut' ), $val( 'nucleo-erp/razon_social' ), $val( 'nucleo-erp/giro' ) ) as $message ) {
			$errors->add( 'nucleo_erp_documento', $message );
		}
	}
}

Nucleo_Erp_Plugin::init();
