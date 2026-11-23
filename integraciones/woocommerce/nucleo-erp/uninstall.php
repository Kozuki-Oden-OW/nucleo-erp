<?php
/**
 * Al desinstalar: revoca la llave que creó el plugin y borra sus ajustes. Los datos anotados en los
 * pedidos (venta de NÚCLEO, RUT, giro) se conservan porque son parte del pedido.
 *
 * @package NucleoErp
 */

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

global $wpdb;

$nucleo_erp_key_id = (int) get_option( 'nucleo_erp_key_id', 0 );
if ( $nucleo_erp_key_id ) {
	// phpcs:ignore WordPress.DB.DirectDatabaseQuery
	$wpdb->delete( $wpdb->prefix . 'woocommerce_api_keys', array( 'key_id' => $nucleo_erp_key_id ), array( '%d' ) );
}
delete_option( 'nucleo_erp_key_id' );
delete_option( 'nucleo_erp_checkout_fields' );
delete_option( 'nucleo_erp_last_seen' );
