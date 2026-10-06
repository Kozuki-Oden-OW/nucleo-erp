// Datos ficticios para la demostración: una ferretería pyme de ejemplo.
// Nombres, RUT y montos inventados (los RUT tienen dígito verificador válido, pero son ficticios).

/** PRNG determinista (mulberry32) para que la demo sea igual en cada apertura. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rutDv(body: number): string {
  let sum = 0, mul = 2, n = body;
  while (n > 0) { sum += (n % 10) * mul; n = Math.floor(n / 10); mul = mul === 7 ? 2 : mul + 1; }
  const r = 11 - (sum % 11);
  return r === 11 ? "0" : r === 10 ? "K" : String(r);
}

export const DEMO_COMPANY = "Ferretería Los Andes (demostración)";

export const CUSTOMER_NAMES = [
  "Constructora Sur Ltda.", "María José Pérez", "Inmobiliaria Cordillera SpA", "Juan Carlos Soto", "Taller Mecánico El Roble",
  "Colegio San Rafael", "Camila Fuentes", "Agrícola Valle Verde Ltda.", "Pedro Muñoz", "Restaurante La Picá de Don Lucho",
  "Hostal Brisas del Lago", "Ignacio Rojas", "Condominio Los Aromos", "Valentina Araya", "Electricidad Martínez e Hijos",
  "Municipalidad de Puerto Ejemplo", "Francisca Contreras", "Remodelaciones Austral SpA", "Diego Sepúlveda", "Panadería Doña Rosa",
  "Gasfitería Rápida", "Sofía Morales", "Club Deportivo Unión", "Tomás Herrera", "Cabañas Bosque Nativo",
  "Javiera Castillo", "Ferretería Amiga (reventa)", "Benjamín Vargas", "Lavandería Clean Express", "Antonia Reyes",
  "Clínica Veterinaria Patitas", "Matías Jara", "Empresa de Aseo Brillante", "Catalina Navarro", "Carpintería Nogal",
];

export const SUPPLIER_NAMES = [
  "Distribuidora Ferretera Central S.A.", "Importadora Herramientas del Pacífico", "Pinturas Arcoíris Ltda.",
  "Maderas del Sur SpA", "Eléctrica Nacional Mayorista",
];

/** [sku, nombre, unidad, precio neto, costo neto, stock, mínimo, servicio?] */
export const PRODUCT_ROWS: [string, string, string, number, number, number, number, boolean?][] = [
  ["TAL-18V", "Taladro percutor inalámbrico 18 V", "un", 64_990, 41_200, 14, 5],
  ["TAL-650", "Taladro eléctrico 650 W", "un", 32_990, 19_800, 9, 4],
  ["ESM-115", "Esmeril angular 115 mm 850 W", "un", 29_990, 18_100, 3, 4],
  ["SIE-CIR", "Sierra circular 7¼\" 1.400 W", "un", 74_990, 48_500, 6, 2],
  ["ATO-SET", "Set de atornilladores 32 piezas", "un", 12_490, 6_300, 22, 8],
  ["MAR-16", "Martillo carpintero 16 oz", "un", 6_990, 3_100, 31, 10],
  ["HUI-25", "Huincha de medir 5 m", "un", 3_990, 1_650, 48, 15],
  ["NIV-60", "Nivel de aluminio 60 cm", "un", 8_490, 4_200, 12, 5],
  ["ALI-SET", "Juego de alicates 3 piezas", "un", 11_990, 6_400, 7, 6],
  ["LLA-SET", "Juego de llaves combinadas 12 piezas", "un", 24_990, 14_900, 5, 3],
  ["CEM-25", "Cemento 25 kg", "saco", 4_790, 3_650, 120, 40],
  ["YES-25", "Yeso 25 kg", "saco", 5_290, 3_900, 34, 20],
  ["ARE-M3", "Arena gruesa", "m³", 28_000, 19_500, 8, 3],
  ["PIN-LAT", "Pintura látex blanca 1 galón", "un", 14_990, 8_700, 26, 12],
  ["PIN-ESM", "Esmalte sintético 1/4 galón", "un", 7_490, 4_100, 18, 10],
  ["BRO-2", "Brocha 2\"", "un", 1_990, 790, 64, 20],
  ["ROD-9", "Rodillo antigota 9\"", "un", 4_490, 2_050, 15, 8],
  ["DIL-1", "Diluyente sintético 1 litro", "un", 3_290, 1_700, 2, 6],
  ["TOR-6", "Tornillo volcanita 6 x 1\" (caja 100)", "caja", 2_490, 1_050, 70, 25],
  ["CLA-3", "Clavo corriente 3\" (kg)", "kg", 2_190, 1_200, 95, 30],
  ["TAR-8", "Tarugo plástico 8 mm (bolsa 50)", "bolsa", 1_490, 520, 40, 15],
  ["SIL-TR", "Silicona transparente 280 ml", "un", 3_490, 1_650, 3, 12],
  ["CIN-AIS", "Cinta aisladora 20 m", "un", 990, 380, 88, 30],
  ["CAB-25", "Cable eléctrico 2,5 mm (metro)", "m", 690, 360, 640, 200],
  ["ENC-DOB", "Enchufe doble embutido", "un", 2_990, 1_350, 37, 15],
  ["AMP-LED", "Ampolleta LED 9 W", "un", 1_890, 820, 120, 40],
  ["FOC-LED", "Foco LED exterior 50 W", "un", 12_990, 6_900, 4, 5],
  ["GUA-NIT", "Guantes de nitrilo (par)", "par", 2_490, 1_100, 55, 20],
  ["LEN-SEG", "Lentes de seguridad", "un", 2_990, 1_200, 29, 10],
  ["CAS-SEG", "Casco de seguridad", "un", 6_990, 3_600, 11, 6],
  ["MAN-JAR", "Manguera de jardín 15 m", "un", 13_990, 7_800, 9, 4],
  ["LLA-JAR", "Llave de jardín bronce ½\"", "un", 4_990, 2_300, 16, 6],
  ["CAN-PVC", "Tubo PVC sanitario 110 mm x 3 m", "un", 9_490, 5_700, 21, 8],
  ["COD-PVC", "Codo PVC 110 mm 90°", "un", 1_590, 690, 46, 15],
  ["ESC-5", "Escalera tijera aluminio 5 peldaños", "un", 49_990, 31_500, 3, 2],
  ["CAR-MAN", "Carretilla 80 litros", "un", 54_990, 36_800, 2, 2],
  ["SRV-INS", "Servicio de instalación (hora)", "hora", 15_000, 0, 0, 0, true],
  ["SRV-COR", "Servicio de corte de madera", "un", 2_500, 0, 0, 0, true],
];

export { PAYMENT_METHODS } from "../catalogs";
