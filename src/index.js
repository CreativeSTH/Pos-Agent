require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { imprimirTicket, imprimirPrueba } = require('./printer');
const { listarImpresoras } = require('./printers');
const { leerConfig, guardarConfig } = require('./config-store');
const path = require('path');
const { crearStore } = require('./sin-conexion-store');

// Fase 6b: almacén de la caja para vender sin internet (foto del POS, numeración reservada y cola de ventas).
const sinConexion = crearStore(path.join(__dirname, '..', 'data', 'sin-conexion.json'));

const app = express();
app.use(cors({ origin: (process.env.CORS_ORIGINS || 'http://localhost:4200').split(',') }));
// La foto del catálogo que guarda el POS para vender sin conexión puede pesar varios MB.
app.use(express.json({ limit: '10mb' }));

app.get('/status', (_req, res) => {
  res.json({ ok: true, agente: 'pos-agent', version: require('../package.json').version });
});

app.post('/print', async (req, res) => {
  const payload = req.body;
  if (!payload || !payload.venta) {
    return res.status(400).json({ impreso: false, error: 'Falta el objeto "venta" en el body' });
  }

  const resultado = await imprimirTicket(payload);
  const statusCode = resultado.impreso ? 200 : 502;
  res.status(statusCode).json(resultado);
});

app.post('/print-test', async (_req, res) => {
  const resultado = await imprimirPrueba();
  res.status(resultado.impreso ? 200 : 502).json(resultado);
});

/** Impresoras instaladas en esta PC, para el selector en pos-frontend > Configuración > Dispositivos. */
app.get('/printers', async (_req, res) => {
  try {
    const impresoras = await listarImpresoras();
    res.json({ impresoras });
  } catch (err) {
    res.status(500).json({ impresoras: [], error: err.message });
  }
});

app.get('/config', (_req, res) => {
  res.json(leerConfig());
});

app.post('/config', (req, res) => {
  const { printerType, printerName, paperWidth } = req.body || {};
  if (printerType && !['epson', 'star'].includes(String(printerType).toLowerCase())) {
    return res.status(400).json({ error: 'printerType debe ser "epson" o "star"' });
  }
  if (paperWidth !== undefined && ![58, 80].includes(Number(paperWidth))) {
    return res.status(400).json({ error: 'paperWidth debe ser 58 u 80' });
  }
  res.json(guardarConfig({ printerType, printerName, paperWidth: paperWidth !== undefined ? Number(paperWidth) : undefined }));
});

// ---------- Vender sin conexión (fase 6b) ----------

app.get('/sin-conexion/estado', (_req, res) => res.json(sinConexion.estado()));

app.post('/sin-conexion/snapshot', (req, res) => {
  sinConexion.guardarSnapshot(req.body || {});
  res.json({ ok: true });
});

app.get('/sin-conexion/snapshot', (_req, res) => {
  const s = sinConexion.leerSnapshot();
  return s ? res.json(s) : res.status(404).json({ error: 'Esta caja no tiene datos guardados todavía' });
});

app.post('/sin-conexion/bloque', (req, res) => {
  const { desde, hasta, resolucion } = req.body || {};
  if (!Number.isInteger(desde) || !Number.isInteger(hasta) || hasta < desde || !resolucion?.prefijo) {
    return res.status(400).json({ error: 'Bloque inválido' });
  }
  res.json(sinConexion.guardarBloque({ desde, hasta, resolucion }));
});

app.post('/sin-conexion/episodios/abrir', (req, res) => res.json(sinConexion.abrirEpisodio(req.body?.ahora || new Date().toISOString())));

app.post('/sin-conexion/episodios/cerrar', (req, res) => res.json(sinConexion.cerrarEpisodio(req.body?.ahora || new Date().toISOString())));

app.post('/sin-conexion/ventas', (req, res) => {
  const { idLocal, requiereNumero, datos } = req.body || {};
  if (!idLocal || !datos) return res.status(400).json({ error: 'Falta idLocal o datos' });
  try {
    res.json(sinConexion.registrarVenta({ idLocal, requiereNumero: !!requiereNumero, datos }));
  } catch (err) {
    if (err.code === 'SIN_NUMERACION') {
      return res.status(409).json({ error: 'SIN_NUMERACION', mensaje: 'Esta caja no tiene números de contingencia disponibles' });
    }
    throw err;
  }
});

app.get('/sin-conexion/pendientes', (_req, res) => res.json(sinConexion.pendientes()));

app.post('/sin-conexion/confirmar', (req, res) => res.json(sinConexion.confirmar(req.body?.resultados)));

// Red de seguridad: nunca devolver la página HTML de error por defecto de Express.
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ impreso: false, error: err.message || 'Error interno del agente' });
});

const PORT = process.env.PORT || 9100;
// Solo localhost: nada en la red del negocio debe poder pegarle a este puerto, solo el navegador de esta misma PC.
app.listen(PORT, '127.0.0.1', () => {
  console.log(`pos-agent escuchando en http://localhost:${PORT}`);
  console.log('Este servicio debe correr en la PC de la caja, junto a la impresora.');
});
