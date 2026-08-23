const { exec } = require('child_process');
const os = require('os');

/** Lee las impresoras instaladas en Windows (para poblar el selector en /configuracion). */
function listarImpresoras() {
  return new Promise((resolve, reject) => {
    if (os.platform() !== 'win32') {
      reject(new Error('La detección automática de impresoras solo está soportada en Windows.'));
      return;
    }
    exec(
      'powershell -NoProfile -Command "Get-Printer | Select-Object -ExpandProperty Name"',
      (err, stdout) => {
        if (err) {
          reject(err);
          return;
        }
        const nombres = stdout
          .split(/\r?\n/)
          .map((linea) => linea.trim())
          .filter(Boolean);
        resolve(nombres);
      },
    );
  });
}

/** La impresora marcada como predeterminada en Windows — es lo que usamos cuando no se eligió una a mano. */
function obtenerImpresoraPorDefecto() {
  return new Promise((resolve, reject) => {
    if (os.platform() !== 'win32') {
      reject(new Error('La detección automática de impresoras solo está soportada en Windows.'));
      return;
    }
    exec(
      'powershell -NoProfile -Command "(Get-CimInstance Win32_Printer | Where-Object { $_.Default }).Name"',
      (err, stdout) => {
        if (err) {
          reject(err);
          return;
        }
        const nombre = stdout.trim();
        if (!nombre) {
          reject(new Error('Windows no tiene ninguna impresora predeterminada. Elegí una en Configuración > Dispositivos.'));
          return;
        }
        resolve(nombre);
      },
    );
  });
}

/**
 * node-thermal-printer escribe bytes crudos vía ruta UNC (`\\localhost\Nombre`), sin depender de
 * módulos nativos — para eso la impresora tiene que estar compartida localmente. La comparte sola
 * si hace falta; si Windows lo rechaza (típicamente por falta de permisos de administrador), lo
 * informa para que se comparta a mano desde Windows.
 */
function asegurarCompartida(nombre) {
  return new Promise((resolve, reject) => {
    if (os.platform() !== 'win32') {
      resolve();
      return;
    }
    const nombreEscapado = nombre.replace(/'/g, "''");
    const cmd = `powershell -NoProfile -Command "$p = Get-Printer -Name '${nombreEscapado}' -ErrorAction Stop; if (-not $p.Shared) { Set-Printer -Name $p.Name -Shared $true -ShareName $p.Name }"`;
    exec(cmd, (err) => {
      if (err) {
        reject(
          new Error(
            `No se pudo compartir "${nombre}" automáticamente (¿pos-agent corre como administrador?). Compártela a mano desde Windows (Propiedades de impresora > Uso compartido) y volvé a intentar.`,
          ),
        );
        return;
      }
      resolve();
    });
  });
}

module.exports = { listarImpresoras, obtenerImpresoraPorDefecto, asegurarCompartida };
