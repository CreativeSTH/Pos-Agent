# pos-agent

Agente local (**Node.js + Express**) que corre en la PC de caja — puente entre `pos-frontend` (en el navegador) y la impresora térmica/cajón monedero conectados físicamente a esa PC. No es multi-tenant, no tiene base de datos ni lógica de negocio: solo traduce una orden de impresión HTTP a comandos ESC/POS.

Documento de arquitectura general del proyecto: [`../docs/ARQUITECTURA.md`](../docs/ARQUITECTURA.md) (sección 11, Integración de hardware).

## Requisitos

- Node.js 20+
- Windows con al menos una impresora térmica instalada (o la predeterminada del sistema) — no hace falta hardware real para desarrollar: sin impresora configurada, `POST /print` responde `{ "impreso": false, "error": "..." }` en vez de fallar.

## Puesta en marcha

```bash
npm install
npm start          # http://localhost:9100
```

Queda corriendo en una terminal abierta. Para producción (arranque automático con Windows, sin depender de una terminal abierta):

```bash
npm run service:install     # correr como Administrador
npm run service:uninstall   # también como Administrador
```

## Endpoints

| Método | Ruta | Uso |
|---|---|---|
| `POST` | `/print` | Imprime un ticket de venta (y abre el cajón si `abrirCajon: true`) |
| `POST` | `/print-test` | Imprime un ticket corto para validar la conexión, sin necesidad de una venta real |
| `GET` | `/printers` | Lista las impresoras instaladas en Windows |
| `GET`/`POST` | `/config` | Impresora elegida (si ninguna, se usa la predeterminada del sistema) |

Se configura desde `pos-frontend` → Configuración → Dispositivos, que también incluye un probador de escaneo para el lector de código de barras (el lector en sí no pasa por este agente — actúa como teclado USB-HID directo al navegador).

## Cómo funciona la impresión

`src/printer.js` arma el ticket ESC/POS con `node-thermal-printer` y escribe los bytes crudos por ruta UNC local (`\\localhost\NombreDeImpresora`) — evita depender del paquete nativo `printer`, que exige compilación.

**Nota HTTPS/mixed-content:** si `pos-frontend` se sirve por HTTPS, el navegador bloquea el `fetch` a `http://localhost:9100` por contenido mixto. Como el POS opera en red local, la solución simple es servir el frontend también por HTTP dentro de la red de la tienda.

## Repos relacionados

| Repo | Rol |
|---|---|
| [`pos-backend`](https://github.com/CreativeSTH/api-astralis-pos) | API REST (NestJS + PostgreSQL) |
| [`pos-frontend`](https://github.com/CreativeSTH/Frontend-Pos) | Angular — POS (cajero) + back-office (admin) |

## Git

Se commitea y pushea solo a `develop`. `main` recibe merges únicamente cuando se pide explícitamente un release — ver sección 17 de `ARQUITECTURA.md`.
