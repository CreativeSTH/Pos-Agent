const path = require('path');
const { Service } = require('node-windows');

/** Desinstala el servicio de Windows de pos-agent (requiere correr como Administrador). */
const svc = new Service({
  name: 'pos-agent',
  script: path.join(__dirname, 'src', 'index.js'),
});

svc.on('uninstall', () => {
  console.log('Servicio "pos-agent" desinstalado.');
});

svc.on('error', (err) => {
  console.error('No se pudo desinstalar el servicio:', err);
});

svc.uninstall();
