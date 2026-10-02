const test = require('node:test');
const assert = require('node:assert');
const { construirTicket } = require('./printer');

/** Impresora falsa: registra el texto y las imágenes; el resto de los métodos no hace nada. */
function impresoraFalsa() {
  const lineas = [];
  const imagenes = [];
  const qrs = [];
  const printer = new Proxy(
    {},
    {
      get: (_, metodo) => {
        if (metodo === 'println') return (texto) => lineas.push(String(texto));
        if (metodo === 'printImageBuffer') return async (buffer) => imagenes.push(buffer);
        if (metodo === 'printQR') return (texto) => qrs.push(String(texto));
        return () => {};
      },
    },
  );
  return { printer, lineas, imagenes, qrs };
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

test('recibo de caja: título, número, venta abonada, cuota, mora, saldos y leyenda', async () => {
  const { printer, lineas } = impresoraFalsa();
  await construirTicket(printer, {
    tipo: 'RECIBO_CAJA', negocio: { nombre: 'Ferretería' },
    venta: {
      numero: 'RC-7', fecha: '2026-09-29T15:00:00Z', cliente: 'Ana Gómez',
      items: [{ nombre: 'Abono cuota 1 de 3', cantidad: 1, subtotal: 45000 }],
      subtotal: 45000, total: 45000, pagos: [{ metodo: 'Nequi', monto: 45000 }],
      mensajeCierre: '¡Gracias por su pago!',
      leyenda: 'Recibo de caja: soporte de pago. No es una factura de venta.',
      abono: {
        numeroCuota: 1, totalCuotas: 3, comprobanteVenta: 'FE17', tipoComprobanteVenta: 'Factura electrónica',
        moraPagada: 5000, saldoAnterior: 200000, saldoNuevo: 160000, referenciaPago: 'NQ-99',
      },
    },
  });
  for (const esperado of [
    'RECIBO DE CAJA', 'Recibo de caja: RC-7', 'Cliente: Ana Gómez', 'Abono a: Factura electrónica FE17',
    'Cuota 1 de 3', 'Ref. pago: NQ-99', '¡Gracias por su pago!', 'Recibo de caja: soporte de pago. No es una factura de venta.',
  ]) {
    assert.ok(lineas.includes(esperado), `falta la línea "${esperado}"`);
  }
  assert.ok(lineas.some((l) => l.startsWith('Intereses de mora:')), 'falta la mora pagada');
  assert.ok(lineas.some((l) => l.startsWith('Saldo anterior:')), 'falta el saldo anterior');
  assert.ok(lineas.some((l) => l.startsWith('Saldo pendiente:')), 'falta el saldo pendiente');
  assert.ok(!lineas.some((l) => l.startsWith('Venta:')), 'un recibo de caja no dice "Venta:"');
});

test('recibo de caja histórico sin saldos: no imprime líneas de saldo ni de mora en cero', async () => {
  const { printer, lineas } = impresoraFalsa();
  await construirTicket(printer, {
    tipo: 'RECIBO_CAJA', negocio: { nombre: 'Ferretería' },
    venta: {
      numero: 'Sin numerar', fecha: '2026-09-29T15:00:00Z', cliente: 'Ana Gómez', items: [], subtotal: 1000, total: 1000, pagos: [],
      abono: { numeroCuota: 1, totalCuotas: 1, comprobanteVenta: 'R-15', tipoComprobanteVenta: 'Recibo', moraPagada: 0, saldoAnterior: null, saldoNuevo: null, referenciaPago: null },
    },
  });
  assert.ok(!lineas.some((l) => l.startsWith('Saldo')));
  assert.ok(!lineas.some((l) => l.startsWith('Intereses de mora')));
});

test('factura de contingencia: título de papel, CUDE y fabricante del software', async () => {
  const { printer, lineas } = impresoraFalsa();
  await construirTicket(printer, {
    tipo: 'FACTURA_ELECTRONICA', negocio: { nombre: 'Ferretería' },
    venta: {
      ...ventaBase, numero: 'CONT501',
      electronica: {
        contingencia: true, titulo: 'FACTURA DE VENTA DE TALONARIO O DE PAPEL', etiquetaCodigo: 'CUDE',
        encabezado: null, cufe: 'abc123', resolucion: 'Numeración autorizada por la DIAN — Resolución No. 18764000009999',
        emisor: { razonSocial: 'Tienda S.A.S.', nitConDv: '900123456-8', direccion: 'Cra 1' },
        adquirente: { nombre: 'Consumidor final', identificacion: 'CC 222222222222' }, formaPago: 'Contado',
        proveedorTecnologico: 'Proveedor tecnológico: Alegra (NIT 900559088)',
        fabricanteSoftware: 'Software: AURA — fabricante Sebastian Torres (NIT 1047444002-2)',
      },
    },
  });
  assert.ok(lineas.includes('FACTURA DE VENTA DE TALONARIO O DE PAPEL'));
  assert.ok(!lineas.includes('FACTURA ELECTRÓNICA DE VENTA'));
  assert.ok(lineas.includes('NIT: 900123456-8'));
  assert.ok(lineas.includes('CUDE:'));
  assert.ok(!lineas.includes('CUFE:'));
  assert.ok(lineas.includes('Software: AURA — fabricante Sebastian Torres (NIT 1047444002-2)'));
});

test('payload viejo sin `titulo` sigue imprimiendo el título de factura electrónica y CUFE', async () => {
  const { printer, lineas } = impresoraFalsa();
  await construirTicket(printer, {
    tipo: 'FACTURA_ELECTRONICA', negocio: { nombre: 'Ferretería' },
    venta: {
      ...ventaBase,
      electronica: { encabezado: null, cufe: 'x', adquirente: { nombre: 'A', identificacion: 'CC 1' }, formaPago: 'Contado', proveedorTecnologico: 'P' },
    },
  });
  assert.ok(lineas.includes('FACTURA ELECTRÓNICA DE VENTA'));
  assert.ok(lineas.includes('CUFE:'));
});

test('sin conexión: imprime el QR desde texto si no viene imagen', async () => {
  const { printer, qrs, imagenes } = impresoraFalsa();
  await construirTicket(printer, {
    tipo: 'FACTURA_ELECTRONICA', negocio: { nombre: 'Ferretería' },
    venta: {
      ...ventaBase,
      electronica: {
        contingencia: true, titulo: 'FACTURA DE VENTA DE TALONARIO O DE PAPEL', etiquetaCodigo: 'CUDE', encabezado: null,
        adquirente: { nombre: 'Consumidor final', identificacion: 'CC 222222222222' }, formaPago: 'Contado',
        proveedorTecnologico: 'P', qrTexto: 'NumFac: CONT7',
      },
    },
  });
  assert.deepStrictEqual(qrs, ['NumFac: CONT7']);
  assert.strictEqual(imagenes.length, 0);
});

test('devolución: título, número, venta afectada, motivo, reembolsos y nota crédito con CUDE', async () => {
  const { printer, lineas } = impresoraFalsa();
  await construirTicket(printer, {
    tipo: 'DEVOLUCION', negocio: { nombre: 'Ferretería' },
    venta: {
      numero: 'DEV-3', fecha: '2026-10-02T15:00:00Z', cliente: 'Ana Gómez',
      items: [{ nombre: 'Taladro', cantidad: 1, subtotal: 23800 }],
      subtotal: 20000, impuesto: 3800, total: 23800, pagos: [{ metodo: 'Efectivo', monto: 23800 }],
      leyenda: 'Comprobante de devolución. No es una factura de venta.',
      devolucion: {
        ventaAfectada: 'FE17', tipoComprobanteVenta: 'Factura electrónica', motivo: 'Defectuoso',
        notaCredito: { numero: 'NC4', cude: 'cude-1', estado: 'ACEPTADO', encabezado: null },
      },
    },
  });
  for (const esperado of [
    'DEVOLUCIÓN', 'Devolución: DEV-3', 'Cliente: Ana Gómez', 'Venta: Factura electrónica FE17', 'Motivo: Defectuoso',
    'Nota crédito: NC4', 'CUDE:', 'cude-1', 'Comprobante de devolución. No es una factura de venta.',
  ]) {
    assert.ok(lineas.includes(esperado), `falta la línea "${esperado}"`);
  }
  assert.ok(lineas.some((l) => l.startsWith('TOTAL DEVUELTO:')), 'falta el total devuelto');
  assert.ok(!lineas.includes('¡Gracias por su compra!'), 'una devolución no agradece la compra');
  assert.ok(!lineas.some((l) => l.startsWith('Venta: DEV')), 'el número no se rotula como venta');
});

test('devolución con nota crédito en validación: encabezado de estado y "en proceso"', async () => {
  const { printer, lineas } = impresoraFalsa();
  await construirTicket(printer, {
    tipo: 'DEVOLUCION', negocio: { nombre: 'Ferretería' },
    venta: {
      numero: 'DEV-4', fecha: '2026-10-02T15:00:00Z', cliente: 'Ana Gómez', items: [], subtotal: 0, total: 0, pagos: [],
      devolucion: {
        ventaAfectada: 'FE18', tipoComprobanteVenta: 'Factura electrónica', motivo: 'Talla',
        notaCredito: { numero: null, cude: null, estado: 'PENDIENTE', encabezado: 'EN VALIDACIÓN DIAN — REIMPRIMIBLE' },
      },
    },
  });
  assert.ok(lineas.includes('EN VALIDACIÓN DIAN — REIMPRIMIBLE'));
  assert.ok(lineas.includes('Nota crédito: en proceso'));
  assert.ok(!lineas.includes('CUDE:'));
});

test('devolución sin nota crédito (venta con recibo): sin bloque fiscal', async () => {
  const { printer, lineas } = impresoraFalsa();
  await construirTicket(printer, {
    tipo: 'DEVOLUCION', negocio: { nombre: 'Ferretería' },
    venta: {
      numero: 'DEV-1', fecha: '2026-10-02T15:00:00Z', cliente: 'Consumidor final', items: [], subtotal: 0, total: 0, pagos: [],
      devolucion: { ventaAfectada: 'R-15', tipoComprobanteVenta: 'Recibo', motivo: 'Cambio de opinión', notaCredito: null },
    },
  });
  assert.ok(lineas.includes('Venta: Recibo R-15'));
  assert.ok(!lineas.some((l) => l.startsWith('Nota crédito')));
});
