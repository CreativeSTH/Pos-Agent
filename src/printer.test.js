const test = require('node:test');
const assert = require('node:assert');
const { construirTicket } = require('./printer');

/** Impresora falsa: registra el texto y las imágenes; el resto de los métodos no hace nada. */
function impresoraFalsa() {
  const lineas = [];
  const imagenes = [];
  const printer = new Proxy(
    {},
    {
      get: (_, metodo) => {
        if (metodo === 'println') return (texto) => lineas.push(String(texto));
        if (metodo === 'printImageBuffer') return async (buffer) => imagenes.push(buffer);
        return () => {};
      },
    },
  );
  return { printer, lineas, imagenes };
}

const ventaBase = {
  numero: '000123', fecha: '2026-09-29T02:01:13Z', items: [{ nombre: 'Arenita', cantidad: 1, subtotal: 32130 }],
  subtotal: 27000, impuesto: 5130, total: 32130, pagos: [{ metodo: 'Efectivo', monto: 32130 }],
};

test('recibo: igual que antes más la leyenda de "no es factura"', async () => {
  const { printer, lineas } = impresoraFalsa();
  await construirTicket(printer, {
    tipo: 'RECIBO', negocio: { nombre: 'Ferretería' },
    venta: { ...ventaBase, leyenda: 'Este documento no es una factura de venta.' },
  });
  assert.ok(lineas.includes('Venta: 000123'));
  assert.ok(lineas.includes('Este documento no es una factura de venta.'));
  assert.ok(!lineas.includes('FACTURA ELECTRÓNICA DE VENTA'));
});

test('factura electrónica: encabezado, emisor, adquirente, CUFE, QR y proveedor', async () => {
  const { printer, lineas, imagenes } = impresoraFalsa();
  await construirTicket(printer, {
    tipo: 'FACTURA_ELECTRONICA', negocio: { nombre: 'Ferretería', nit: '1' },
    venta: {
      ...ventaBase, numero: 'FE17',
      electronica: {
        encabezado: 'DOCUMENTO DE PRUEBA — SIN VALIDEZ FISCAL', numeroCompleto: 'FE17', fechaEmision: '2026-09-29T02:01:20Z',
        cufe: 'cufe-17', qrBase64: Buffer.from('png').toString('base64'), resolucion: 'Numeración autorizada por la DIAN — Resolución No. 1',
        emisor: { razonSocial: 'Mascotas SAS', nitConDv: '899999034-1', direccion: 'Calle 1, Cali' },
        adquirente: { nombre: 'Consumidor final', identificacion: 'CC 222222222222' }, formaPago: 'Contado',
        proveedorTecnologico: 'Proveedor tecnológico: Alegra (NIT 900559088)',
      },
    },
  });
  for (const esperado of [
    'DOCUMENTO DE PRUEBA — SIN VALIDEZ FISCAL', 'FACTURA ELECTRÓNICA DE VENTA', 'Mascotas SAS', 'NIT: 899999034-1',
    'Factura: FE17', 'Cliente: Consumidor final', 'CC 222222222222', 'Forma de pago: Contado',
    'Numeración autorizada por la DIAN — Resolución No. 1', 'CUFE:', 'cufe-17', 'Proveedor tecnológico: Alegra (NIT 900559088)',
  ]) {
    assert.ok(lineas.includes(esperado), `falta la línea "${esperado}"`);
  }
  assert.ok(!lineas.includes('Ferretería'), 'con snapshot, el emisor es la razón social, no el nombre comercial');
  assert.strictEqual(imagenes.length, 1, 'el QR se imprime como imagen');
});

test('factura electrónica sin CUFE ni QR: no imprime el bloque CUFE ni imagen', async () => {
  const { printer, lineas, imagenes } = impresoraFalsa();
  await construirTicket(printer, {
    tipo: 'FACTURA_ELECTRONICA', negocio: { nombre: 'Ferretería' },
    venta: {
      ...ventaBase, numero: 'En validación DIAN',
      electronica: {
        encabezado: 'EN VALIDACIÓN DIAN — REIMPRIMIBLE', numeroCompleto: null, fechaEmision: null, cufe: null, resolucion: null,
        emisor: null, adquirente: { nombre: 'Consumidor final', identificacion: 'CC 222222222222' }, formaPago: 'Contado',
        proveedorTecnologico: 'Proveedor tecnológico: Alegra (NIT 900559088)',
      },
    },
  });
  assert.ok(lineas.includes('EN VALIDACIÓN DIAN — REIMPRIMIBLE'));
  assert.ok(lineas.includes('Ferretería'), 'sin snapshot, cae al nombre del negocio');
  assert.ok(!lineas.includes('CUFE:'));
  assert.strictEqual(imagenes.length, 0);
});
