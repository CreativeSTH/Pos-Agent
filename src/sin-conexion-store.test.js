const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { crearStore } = require('./sin-conexion-store');

function storeTemporal() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-agent-'));
  const ruta = path.join(dir, 'sin-conexion.json');
  return { store: crearStore(ruta), ruta };
}
const RES = { numero: '18764000009999', prefijo: 'CONT', fechaInicio: '2026-01-01', fechaFin: '2028-01-01', rangoDesde: 1, rangoHasta: 5000 };

test('genera un terminalId estable y un código de caja de 4 caracteres', () => {
  const { store, ruta } = storeTemporal();
  const e1 = store.estado();
  const e2 = crearStore(ruta).estado();
  assert.match(e1.terminalId, /^[0-9a-f-]{36}$/);
  assert.strictEqual(e1.terminalId, e2.terminalId);
  assert.strictEqual(e1.codigoCaja.length, 4);
});

test('asigna números del bloque en orden, persiste y es idempotente por idLocal', () => {
  const { store, ruta } = storeTemporal();
  store.guardarBloque({ desde: 7, hasta: 8, resolucion: RES });
  store.abrirEpisodio('2026-09-29T15:00:00.000Z');
  const a = store.registrarVenta({ idLocal: 'a', requiereNumero: true, datos: { creadaEn: 'x' } });
  const a2 = store.registrarVenta({ idLocal: 'a', requiereNumero: true, datos: { creadaEn: 'x' } });
  const b = store.registrarVenta({ idLocal: 'b', requiereNumero: true, datos: { creadaEn: 'y' } });
  assert.strictEqual(a.numero, 7);
  assert.deepStrictEqual(a2, a);
  assert.strictEqual(b.numero, 8);
  assert.strictEqual(b.prefijo, 'CONT');
  assert.strictEqual(crearStore(ruta).estado().disponibles, 0);
  assert.throws(() => store.registrarVenta({ idLocal: 'c', requiereNumero: true, datos: {} }), /SIN_NUMERACION/);
});

test('recibo provisional: numeración propia de la caja, sin bloque', () => {
  const { store } = storeTemporal();
  store.abrirEpisodio('2026-09-29T15:00:00.000Z');
  const r = store.registrarVenta({ idLocal: 'r1', requiereNumero: false, datos: {} });
  assert.strictEqual(r.numero, null);
  assert.match(r.numeroProvisional, /^SC[0-9a-f]{4}-1$/);
});

test('un bloque nuevo reemplaza al agotado', () => {
  const { store } = storeTemporal();
  store.guardarBloque({ desde: 1, hasta: 1, resolucion: RES });
  store.abrirEpisodio('2026-09-29T15:00:00.000Z');
  store.registrarVenta({ idLocal: 'a', requiereNumero: true, datos: {} });
  store.guardarBloque({ desde: 51, hasta: 100, resolucion: RES });
  assert.strictEqual(store.registrarVenta({ idLocal: 'b', requiereNumero: true, datos: {} }).numero, 51);
});

test('pendientes: solo episodios cerrados; confirmar saca las OK/DUPLICADA y guarda los errores', () => {
  const { store } = storeTemporal();
  store.abrirEpisodio('2026-09-29T15:00:00.000Z');
  store.registrarVenta({ idLocal: 'a', requiereNumero: false, datos: { total: 1 } });
  store.registrarVenta({ idLocal: 'b', requiereNumero: false, datos: { total: 2 } });
  assert.strictEqual(store.pendientes().ventas.length, 0, 'con el episodio abierto no se sincroniza');
  const ep = store.cerrarEpisodio('2026-09-29T17:00:00.000Z');
  assert.strictEqual(ep.fin, '2026-09-29T17:00:00.000Z');
  const p = store.pendientes();
  assert.strictEqual(p.ventas.length, 2);
  assert.deepStrictEqual(p.episodios, [{ id: ep.id, inicio: '2026-09-29T15:00:00.000Z', fin: '2026-09-29T17:00:00.000Z' }]);
  store.confirmar([{ idLocal: 'a', estado: 'OK' }, { idLocal: 'b', estado: 'ERROR', mensaje: 'Producto no encontrado' }]);
  const e = store.estado();
  assert.strictEqual(e.pendientes, 1);
  assert.strictEqual(e.errores, 1);
  assert.strictEqual(store.pendientes().ventas[0].error, 'Producto no encontrado');
});

test('abrir un episodio es idempotente', () => {
  const { store } = storeTemporal();
  const a = store.abrirEpisodio('2026-09-29T15:00:00.000Z');
  const b = store.abrirEpisodio('2026-09-29T15:05:00.000Z');
  assert.strictEqual(a.id, b.id);
  assert.strictEqual(b.inicio, '2026-09-29T15:00:00.000Z');
});

test('la foto se guarda y se lee', () => {
  const { store, ruta } = storeTemporal();
  assert.strictEqual(store.leerSnapshot(), null);
  store.guardarSnapshot({ productos: [{ id: 'p1' }] });
  const s = crearStore(ruta).leerSnapshot();
  assert.deepStrictEqual(s.productos, [{ id: 'p1' }]);
  assert.ok(s.guardadoEn);
});
