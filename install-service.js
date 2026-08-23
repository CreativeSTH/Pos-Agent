const path = require('path');
const { Service } = require('node-windows');

/**
 * Instala pos-agent como servicio de Windows con arranque automático — así la impresión no
 * depende de dejar una terminal abierta ni de que alguien vuelva a correr `npm start` después
 * de reiniciar la PC de caja. Requiere correr esta terminal como Administrador.
 */
const svc = new Service({
  name: 'pos-agent',
  description: 'Puente entre pos-frontend y la impresora térmica/cajón monedero de esta caja.',
  script: path.join(__dirname, 'src', 'index.js'),
});

svc.on('install', () => {
  console.log('Servicio "pos-agent" instalado — arrancando...');
  svc.start();
});

svc.on('start', () => {
  console.log('Servicio "pos-agent" corriendo. Verificá con: curl http://localhost:9100/status');
});

svc.on('alreadyinstalled', () => {
  console.log('El servicio "pos-agent" ya está instalado.');
});

svc.on('error', (err) => {
  console.error('No se pudo instalar el servicio:', err);
});

svc.install();
