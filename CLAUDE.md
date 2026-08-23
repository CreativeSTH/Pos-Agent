# CLAUDE.md

Agente local (**Node.js + Express**) que corre en la PC de la caja — puente entre `pos-frontend` y la impresora térmica/cajón monedero conectados a esa PC. No es multi-tenant ni tiene base de datos: su config vive en `config.json` (generado, gitignored) y opcionalmente en `.env`.

## Comandos

```bash
npm install
npm start                  # http://localhost:9100 (modo desarrollo, en una terminal abierta)
npm run service:install    # instala pos-agent como servicio de Windows con arranque automático — correr como Administrador
npm run service:uninstall  # lo desinstala — también como Administrador
```

## Git

⚠️ **Punto crítico, no se puede vulnerar sin que el usuario lo pida explícitamente en el momento:** solo se commitea y pushea a la rama `develop`. `main` se mantiene vacía (solo el commit inicial) hasta que el usuario pida explícitamente el merge/release — nunca abrir, aceptar ni sugerir de iniciativa propia un PR `develop → main`, ni pushear directo a `main`. Convención de commits: `feat:`, `fix:`, `test:`, `chore:`, `docs:`, `refactor:`, `style:`.

## Impresión

`src/printer.js` arma el ticket ESC/POS con `node-thermal-printer` y le escribe bytes crudos por ruta UNC local (`\\localhost\NombreDeImpresora`) — evita depender del paquete nativo `printer` (requiere compilación). La impresora se elige desde `pos-frontend` > Configuración > Dispositivos (`GET/POST /config`, `GET /printers`); si no hay ninguna elegida, se resuelve la predeterminada de Windows. `POST /print-test` imprime un ticket corto para validar la conexión sin necesidad de una venta real.

## Servicio de Windows

`install-service.js`/`uninstall-service.js` usan `node-windows` (pura orquestación vía `sc.exe`/WMI internamente — sin módulos nativos, mismo criterio que la impresión) para registrar pos-agent como servicio con arranque automático, así no depende de dejar una terminal abierta ni de que alguien lo vuelva a iniciar después de reiniciar la PC de caja. Se instala **una vez por PC de caja**, con la terminal corriendo como Administrador. Los logs del servicio (WinSW) quedan por defecto junto a `src/index.js` como `pos-agent.out.log`/`pos-agent.err.log` — confirmar el nombre exacto la primera vez que se instale, WinSW los genera a partir del `name` configurado.
