const fs = require('fs');
const path = require('path');

const RUTA_CONFIG = path.join(__dirname, '..', 'config.json');

/** Config elegida desde /configuracion > Dispositivos (nombre de impresora, tipo) — vive en esta PC, no en el backend. */
function leerConfig() {
  try {
    return JSON.parse(fs.readFileSync(RUTA_CONFIG, 'utf-8'));
  } catch {
    return {};
  }
}

function guardarConfig(cambios) {
  const actual = leerConfig();
  const nueva = { ...actual, ...cambios };
  fs.writeFileSync(RUTA_CONFIG, JSON.stringify(nueva, null, 2));
  return nueva;
}

module.exports = { leerConfig, guardarConfig };
