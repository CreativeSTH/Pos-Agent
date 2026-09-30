const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Almacén durable de la caja para vender sin conexión (fase 6b): foto del POS, bloque de numeración
 * de contingencia, episodios sin conexión y cola de ventas. Un solo archivo JSON, escrito de forma
 * atómica (.tmp + rename) para que un corte de luz no lo deje a medias.
 */
function crearStore(ruta) {
  function leer() {
    try {
      return JSON.parse(fs.readFileSync(ruta, 'utf-8'));
    } catch {
      return {};
    }
  }
  function escribir(datos) {
    fs.mkdirSync(path.dirname(ruta), { recursive: true });
    const tmp = `${ruta}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(datos, null, 2));
    fs.renameSync(tmp, ruta);
  }
  function cargar() {
    const d = leer();
    let cambio = false;
    if (!d.terminalId) {
      d.terminalId = crypto.randomUUID();
      cambio = true;
    }
    d.episodios = d.episodios || [];
    d.ventas = d.ventas || [];
    d.contadorProvisional = d.contadorProvisional || 0;
    if (cambio) escribir(d);
    return d;
  }
  const codigoCaja = (d) => d.terminalId.replace(/-/g, '').slice(0, 4);
  const disponibles = (d) => (d.bloque ? Math.max(0, d.bloque.hasta - d.bloque.siguiente + 1) : 0);

  return {
    estado() {
      const d = cargar();
      const abierto = d.episodios.find((e) => !e.fin) || null;
      return {
        terminalId: d.terminalId,
        codigoCaja: codigoCaja(d),
        bloque: d.bloque || null,
        disponibles: disponibles(d),
        episodioAbierto: abierto ? { id: abierto.id, inicio: abierto.inicio } : null,
        pendientes: d.ventas.filter((v) => v.estado === 'PENDIENTE').length,
        errores: d.ventas.filter((v) => v.estado === 'PENDIENTE' && v.error).length,
      };
    },
    guardarSnapshot(snapshot) {
      const d = cargar();
      d.snapshot = { ...snapshot, guardadoEn: new Date().toISOString() };
      escribir(d);
    },
    leerSnapshot() {
      return cargar().snapshot || null;
    },
    guardarBloque({ desde, hasta, resolucion }) {
      const d = cargar();
      d.bloque = { desde, hasta, siguiente: desde, resolucion };
      escribir(d);
      return this.estado();
    },
    abrirEpisodio(ahora) {
      const d = cargar();
      const abierto = d.episodios.find((e) => !e.fin);
      if (abierto) return { id: abierto.id, inicio: abierto.inicio };
      const nuevo = { id: crypto.randomUUID(), inicio: ahora, fin: null };
      d.episodios.push(nuevo);
      escribir(d);
      return { id: nuevo.id, inicio: nuevo.inicio };
    },
    cerrarEpisodio(ahora) {
      const d = cargar();
      const abierto = d.episodios.find((e) => !e.fin);
      if (!abierto) return null;
      abierto.fin = ahora;
      escribir(d);
      return { ...abierto };
    },
    registrarVenta({ idLocal, requiereNumero, datos }) {
      const d = cargar();
      const existente = d.ventas.find((v) => v.idLocal === idLocal);
      if (existente) return existente.asignacion;
      let episodio = d.episodios.find((e) => !e.fin);
      if (!episodio) {
        episodio = { id: crypto.randomUUID(), inicio: datos.creadaEn || new Date().toISOString(), fin: null };
        d.episodios.push(episodio);
      }
      let asignacion;
      if (requiereNumero) {
        if (!d.bloque || d.bloque.siguiente > d.bloque.hasta) {
          const error = new Error('SIN_NUMERACION');
          error.code = 'SIN_NUMERACION';
          throw error;
        }
        const numero = d.bloque.siguiente;
        d.bloque.siguiente += 1;
        asignacion = { idLocal, numero, prefijo: d.bloque.resolucion.prefijo, resolucion: d.bloque.resolucion, numeroProvisional: null, episodioId: episodio.id };
      } else {
        d.contadorProvisional += 1;
        asignacion = { idLocal, numero: null, prefijo: null, resolucion: null, numeroProvisional: `SC${codigoCaja(d)}-${d.contadorProvisional}`, episodioId: episodio.id };
      }
      d.ventas.push({ idLocal, estado: 'PENDIENTE', error: null, asignacion, datos: { ...datos, episodioId: episodio.id } });
      escribir(d);
      return asignacion;
    },
    pendientes() {
      const d = cargar();
      const cerrados = new Map(d.episodios.filter((e) => e.fin).map((e) => [e.id, e]));
      const ventas = d.ventas
        .filter((v) => v.estado === 'PENDIENTE' && cerrados.has(v.asignacion.episodioId))
        .map((v) => ({ ...v.datos, idLocal: v.idLocal, asignacion: v.asignacion, error: v.error }));
      const usados = new Set(ventas.map((v) => v.asignacion.episodioId));
      return {
        episodios: [...cerrados.values()].filter((e) => usados.has(e.id)).map((e) => ({ id: e.id, inicio: e.inicio, fin: e.fin })),
        ventas,
      };
    },
    confirmar(resultados) {
      const d = cargar();
      for (const r of resultados || []) {
        const v = d.ventas.find((x) => x.idLocal === r.idLocal);
        if (!v) continue;
        if (r.estado === 'OK' || r.estado === 'DUPLICADA') {
          v.estado = 'SINCRONIZADA';
          v.error = null;
          v.sincronizadaEn = new Date().toISOString();
        } else {
          v.error = r.mensaje || 'Error al sincronizar';
        }
      }
      // Se conservan las últimas 200 sincronizadas como historial; las pendientes nunca se borran.
      const sincronizadas = d.ventas.filter((v) => v.estado === 'SINCRONIZADA');
      const sobran = new Set(sincronizadas.slice(0, Math.max(0, sincronizadas.length - 200)).map((v) => v.idLocal));
      d.ventas = d.ventas.filter((v) => !sobran.has(v.idLocal));
      escribir(d);
      return this.estado();
    },
  };
}

module.exports = { crearStore };
