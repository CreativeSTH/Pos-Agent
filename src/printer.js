const { ThermalPrinter, PrinterTypes } = require('node-thermal-printer');
const { leerConfig } = require('./config-store');
const { asegurarCompartida, obtenerImpresoraPorDefecto } = require('./printers');

async function crearImpresora() {
  const config = leerConfig();
  const tipo = (config.printerType || process.env.PRINTER_TYPE || 'epson').toLowerCase();

  // PRINTER_INTERFACE (tcp://ip, COM3, etc.) es la vía "manual" para setups que no son un nombre de
  // impresora Windows — si está seteada, gana. Si no (o si quedó en el viejo "printer:..." de
  // ejemplo), resolvemos un nombre concreto (elegido en /configuracion o la predeterminada de
  // Windows) y le escribimos bytes crudos por ruta UNC local: el prefijo "printer:" de
  // node-thermal-printer no sirve acá porque exige un driver nativo que no instalamos.
  let interfaz = process.env.PRINTER_INTERFACE;
  if (interfaz && interfaz.toLowerCase().startsWith('printer:')) {
    interfaz = undefined;
  }
  if (!interfaz) {
    const nombreImpresora = config.printerName || (await obtenerImpresoraPorDefecto());
    await asegurarCompartida(nombreImpresora);
    interfaz = `\\\\localhost\\${nombreImpresora}`;
  }

  return new ThermalPrinter({
    type: tipo === 'star' ? PrinterTypes.STAR : PrinterTypes.EPSON,
    interface: interfaz,
    options: { timeout: 5000 },
  });
}

function formatoMoneda(valor) {
  return '$' + Number(valor).toLocaleString('es-CO', { minimumFractionDigits: 0 });
}

/**
 * Arma el ticket ESC/POS a partir del payload que envía pos-frontend (el
 * mismo `ReciboContenido` que devuelve `GET /ventas/:id/comprobante`, más
 * `cambio`/`logoBase64` que solo existen en el momento de imprimir).
 *
 * Deliberadamente NO hay un branch separado por `tipo` que reconstruya el
 * ticket dos veces — todos los campos nuevos (logo, emisor, mensajeCierre,
 * terminos, dian) son opcionales y solo agregan líneas si vienen presentes.
 * Así, una sucursal sin ninguna plantilla configurada (`ComprobantesService`
 * devuelve el contenido sintético de siempre) imprime EXACTAMENTE igual que
 * antes de esta feature — la compatibilidad no depende de un `if` acá, sino
 * de que el backend nunca mande esos campos cuando no hay nada configurado.
 */
async function construirTicket(printer, payload) {
  const { negocio, venta, tipo } = payload;

  if (negocio?.logoBase64) {
    try {
      const buffer = Buffer.from(negocio.logoBase64, 'base64');
      await printer.printImageBuffer(buffer);
    } catch (err) {
      // El logo es un extra — si el archivo no es un PNG válido o falla la decodificación,
      // se imprime el resto del ticket igual en vez de perder toda la venta.
      console.error('No se pudo imprimir el logo del comprobante:', err.message);
    }
  }

  printer.alignCenter();
  printer.bold(true);
  if (tipo === 'FACTURA') {
    printer.println('FACTURA DE VENTA');
  }
  printer.println(negocio?.nombre || 'Mi Tienda');
  printer.bold(false);
  if (negocio?.nit) printer.println(`NIT: ${negocio.nit}`);
  if (venta.emisor?.nombrePersonaNatural) printer.println(venta.emisor.nombrePersonaNatural);
  if (venta.emisor?.direccion) printer.println(venta.emisor.direccion);
  if (venta.emisor?.telefono) printer.println(`Tel: ${venta.emisor.telefono}`);
  printer.drawLine();

  printer.alignLeft();
  printer.println(`Venta: ${venta.numero || venta.id || ''}`);
  printer.println(`Fecha: ${new Date(venta.fecha || Date.now()).toLocaleString('es-CO')}`);
  printer.drawLine();

  for (const item of venta.items || []) {
    printer.println(`${item.cantidad} x ${item.nombre}`);
    printer.alignRight();
    printer.println(formatoMoneda(item.subtotal));
    printer.alignLeft();
  }
  printer.drawLine();

  printer.alignRight();
  printer.println(`Subtotal: ${formatoMoneda(venta.subtotal)}`);
  if (venta.descuento) printer.println(`Descuento: -${formatoMoneda(venta.descuento)}`);
  if (venta.impuesto) printer.println(`Impuesto: ${formatoMoneda(venta.impuesto)}`);
  printer.bold(true);
  printer.println(`TOTAL: ${formatoMoneda(venta.total)}`);
  printer.bold(false);

  for (const pago of venta.pagos || []) {
    printer.println(`${pago.metodo}: ${formatoMoneda(pago.monto)}`);
  }
  if (venta.cambio) {
    printer.println(`Cambio: ${formatoMoneda(venta.cambio)}`);
  }

  printer.alignCenter();
  printer.drawLine();
  printer.println(venta.mensajeCierre || '¡Gracias por su compra!');
  if (venta.terminos) {
    printer.println(venta.terminos);
  }

  if (tipo === 'FACTURA' && venta.dian) {
    printer.drawLine();
    const d = venta.dian;
    if (d.resolucionNumero) printer.println(`Resolución DIAN No. ${d.resolucionNumero}`);
    if (d.prefijo || d.rangoDesde || d.rangoHasta) {
      printer.println(`Numeración: ${d.prefijo || ''}${d.rangoDesde ?? ''} - ${d.prefijo || ''}${d.rangoHasta ?? ''}`);
    }
    if (d.fechaVigencia) printer.println(`Vigente hasta: ${d.fechaVigencia}`);
    if (d.regimenFiscal) printer.println(`Régimen: ${d.regimenFiscal}`);
    for (const campo of d.camposExtra || []) {
      printer.println(`${campo.etiqueta}: ${campo.valor}`);
    }
  }

  printer.cut();
}

/**
 * Imprime el ticket y, si se pide, abre el cajón monedero (cableado a la
 * propia impresora térmica — no es hardware aparte).
 */
async function imprimirTicket(payload) {
  // Se registra siempre en consola para poder probar el flujo sin hardware real conectado.
  console.log('--- Ticket a imprimir ---');
  console.log(JSON.stringify(payload.venta, null, 2));

  try {
    const printer = await crearImpresora();
    await construirTicket(printer, payload);
    if (payload.abrirCajon) {
      printer.openCashDrawer();
    }

    await printer.execute();
    return { impreso: true };
  } catch (err) {
    return { impreso: false, error: err.message };
  }
}

/** Ticket corto usado por el botón "Probar impresión" en /configuracion. */
async function imprimirPrueba() {
  try {
    const printer = await crearImpresora();
    printer.alignCenter();
    printer.bold(true);
    printer.println('Prueba de impresión');
    printer.bold(false);
    printer.println(new Date().toLocaleString('es-CO'));
    printer.drawLine();
    printer.println('Si ves esto, pos-agent y la');
    printer.println('impresora están bien conectados.');
    printer.cut();
    await printer.execute();
    return { impreso: true };
  } catch (err) {
    return { impreso: false, error: err.message };
  }
}

module.exports = { imprimirTicket, imprimirPrueba };
