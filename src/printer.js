const { ThermalPrinter, PrinterTypes } = require('node-thermal-printer');
const { leerConfig } = require('./config-store');
const { asegurarCompartida, obtenerImpresoraPorDefecto } = require('./printers');

/**
 * Ancho de papel (mm) → caracteres por línea. `node-thermal-printer` usa esto para
 * `drawLine()`, el padding de `alignRight`/tablas, y el word-wrap de `println` — TODO
 * pasa por `this.config.width` internamente. Sin pasarle este valor, la librería
 * defaultea a 48 (el estándar de 80mm) sin importar qué impresora esté conectada; en
 * una de 58mm (32 caracteres reales) eso obliga a la impresora a achicar la fuente
 * para que las líneas de 48 caracteres entren en el ancho físico — bug real
 * diagnosticado: "todo se ve muy pequeño" en una impresora de 58mm.
 */
const CARACTERES_POR_ANCHO = { 58: 32, 80: 48 };

/** Ancho máximo de imagen en puntos (dots) que el cabezal de esa impresora puede imprimir en una línea — usado por pos-frontend para redimensionar el logo antes de mandarlo. */
const PUNTOS_POR_ANCHO = { 58: 384, 80: 576 };

function anchoPapelConfigurado(config) {
  const valor = Number(config.paperWidth) || 58;
  return CARACTERES_POR_ANCHO[valor] ? valor : 58;
}

async function crearImpresora() {
  const config = leerConfig();
  const tipo = (config.printerType || process.env.PRINTER_TYPE || 'epson').toLowerCase();
  const anchoPapel = anchoPapelConfigurado(config);

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
    width: CARACTERES_POR_ANCHO[anchoPapel],
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
 * La factura electrónica (`tipo: 'FACTURA_ELECTRONICA'` + `venta.electronica`) sí suma su
 * bloque fiscal (encabezado de estado, adquirente, resolución, CUFE, QR); un payload viejo sin
 * esos campos imprime exactamente igual que antes.
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

  // Factura electrónica (spec de unificación de comprobantes, sección 5): todo lo fiscal viene
  // resuelto por el backend desde el snapshot del documento — acá solo se imprime.
  const e = tipo === 'FACTURA_ELECTRONICA' ? venta.electronica : null;

  printer.alignCenter();
  if (e?.encabezado) {
    printer.bold(true);
    printer.println(e.encabezado);
    printer.bold(false);
    printer.drawLine();
  }
  printer.bold(true);
  if (tipo === 'FACTURA') printer.println('FACTURA DE VENTA');
  if (e) printer.println('FACTURA ELECTRÓNICA DE VENTA');
  printer.println(e?.emisor?.razonSocial || negocio?.nombre || 'Mi Tienda');
  printer.bold(false);
  const nit = e?.emisor?.nitConDv || negocio?.nit;
  if (nit) printer.println(`NIT: ${nit}`);
  if (venta.emisor?.nombrePersonaNatural) printer.println(venta.emisor.nombrePersonaNatural);
  const direccion = e?.emisor?.direccion || venta.emisor?.direccion;
  if (direccion) printer.println(direccion);
  if (venta.emisor?.telefono) printer.println(`Tel: ${venta.emisor.telefono}`);
  printer.drawLine();

  printer.alignLeft();
  printer.println(`${e ? 'Factura' : 'Venta'}: ${venta.numero || venta.id || ''}`);
  printer.println(`Fecha: ${new Date(e?.fechaEmision || venta.fecha || Date.now()).toLocaleString('es-CO')}`);
  if (e) {
    printer.println(`Cliente: ${e.adquirente.nombre}`);
    printer.println(e.adquirente.identificacion);
    printer.println(`Forma de pago: ${e.formaPago}`);
  }
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

  if (e) {
    printer.drawLine();
    if (e.resolucion) printer.println(e.resolucion);
    if (e.cufe) {
      printer.println('CUFE:');
      printer.println(e.cufe);
    }
    if (e.qrBase64) {
      try {
        await printer.printImageBuffer(Buffer.from(e.qrBase64, 'base64'));
      } catch (err) {
        // Mismo criterio que el logo: sin QR se imprime el resto (el CUFE permite consultarla igual).
        console.error('No se pudo imprimir el QR de la factura:', err.message);
      }
    }
    printer.println(e.proveedorTecnologico);
  }
  if (venta.leyenda) {
    printer.drawLine();
    printer.println(venta.leyenda);
  }

  printer.cut();
}

/**
 * `printer.openCashDrawer()` de node-thermal-printer manda, para impresoras
 * tipo Epson, el comando ESC/POS `ESC p m` (3 bytes) SIN los bytes de tiempo
 * de pulso `t1 t2` que exige la especificación real (`ESC p m t1 t2`, 5
 * bytes — ver referencia ESC/POS de Epson, comando "Generate Pulse"). Sin
 * esos 2 bytes, muchas impresoras/cajones nunca disparan el solenoide, y
 * además el comando queda "corto": la impresora sigue leyendo los bytes del
 * SIGUIENTE intento (pin 5) como si fueran los tiempos del primero,
 * corrompiendo los dos. `printer.append()` es un método público de la misma
 * clase (permite encolar bytes crudos en el buffer que arma `execute()`), así
 * que se arma el comando completo a mano acá en vez de confiar en el método
 * de la librería. t1=25/t2=250 (50ms encendido / 500ms apagado) son los
 * valores de referencia estándar que usan la mayoría de implementaciones
 * ESC/POS (ver escpos u otras libs). Se manda a ambos pines (2 y 5) porque
 * el cajón puede estar cableado a cualquiera de los dos según el modelo —
 * mismo criterio que ya tenía `openCashDrawer()`.
 */
function abrirCajonMonedero(printer) {
  printer.append(Buffer.from([0x1b, 0x70, 0x00, 25, 250])); // pin 2
  printer.append(Buffer.from([0x1b, 0x70, 0x01, 25, 250])); // pin 5
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
      abrirCajonMonedero(printer);
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

module.exports = { imprimirTicket, imprimirPrueba, construirTicket };
