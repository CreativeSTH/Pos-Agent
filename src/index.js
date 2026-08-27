require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { imprimirTicket, imprimirPrueba } = require('./printer');
const { listarImpresoras } = require('./printers');
const { leerConfig, guardarConfig } = require('./config-store');

const app = express();
app.use(cors({ origin: (process.env.CORS_ORIGINS || 'http://localhost:4200').split(',') }));
app.use(express.json());

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
  const { printerType, printerName } = req.body || {};
  if (printerType && !['epson', 'star'].includes(String(printerType).toLowerCase())) {
    return res.status(400).json({ error: 'printerType debe ser "epson" o "star"' });
  }
  res.json(guardarConfig({ printerType, printerName }));
});

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
