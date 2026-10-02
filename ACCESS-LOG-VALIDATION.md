# Validación del registro persistente de accesos

Base: 742a0a473e24f57c5e9d97b546345c9230975760 (main desplegado).
Entorno de validación final: Windows, Node 22.23.3. Sin push, despliegue, cambios
sobre el DB real, recursos nuevos ni uso del navegador cloudbrowser.
El repositorio no contiene AGENTS.md ni .agents/skills.

## Implementación

- Tabla aditiva accesos_log: ID, usuario_id nullable, resultado, fecha UTC.
- Inicio correcto, contraseña incorrecta, cuenta desconocida/desactivada y cuerpo
  inválido dejan eventos persistentes. El token se entrega tras escribir el evento.
- No se almacenan ni imprimen contraseña/token/hash/IP o identificador enviado.
  Los correos del historial se obtienen del registro actual de cuentas existentes.
- Último inicio exitoso derivado de eventos, sin alterar cuentas ni reconstruir
  actividad anterior. No es seguimiento de actividad general de una sesión.
- Personal muestra historial paginado y último inicio, sólo administradores.
  API requiere rol admin vigente; keys read/write y recepción/limpieza rechazadas.
- SQLite en DATA_DIR mantiene WAL/synchronous FULL ya configurados. Snapshot
  VACUUM INTO privado y sincronizado antes de migrar una base existente. El
  arranque aborta si no puede crear el respaldo. No cambia registros anteriores.
- No atribuye una cuenta compartida a personas. No crea cuentas de producción.

## Resultados

- Suite completa: 18 archivos, 164 pruebas aprobadas en Node 22.
- access-log.test.js: 6 pruebas aprobadas tras el último ajuste de manejo de error.
- tsc --noEmit aprobado. node --check en JS modificado aprobado.
- git diff --check aprobado. El proyecto no ofrece script/config de lint;
  no se añadió una nueva herramienta o dependencia para inventar ese check.
- Build final Vite aprobado en Node 22; requirió permiso de lectura de directorios
  superiores para esbuild. Advertencias existentes de CJS/chunk grande/Browserslist.
- Smoke de instalación limpia aprobado.
- Smoke previo test:persistence bloqueado en Windows por EPERM fsync en
  server/scripts/storage-tools.js:67 (descriptor abierto con 'r'). Ese archivo no
  se modificó. Se reprodujo tanto con Node 24 del host como con Node 22.
- La prueba nueva sí verifica persistencia de eventos y último éxito tras abrir
  la base en otro proceso, preservación exacta de cuentas/reservas, snapshot previo,
  migración idempotente y rechazo de migración sin respaldo.
- También verifica no filtración de datos enviados/secretos, fallo del log sin
  entrega de token, roles/API keys, downgrade de administrador inmediato, cursor
  inválido, páginas consecutivas sin duplicados y ausencia de datos históricos.

## Coordinación antes de publicar

Completar el smoke de recuperación en Linux/Render con el procedimiento existente
antes de publicar. No se inspeccionó ni se respaldó la base real en esta tarea:
la revisión READONLY del servicio está en el otro hilo. El snapshot automático
es local y de SQLite solamente; coordinar un respaldo completo con uploads y
una copia externa siguiendo README antes de desplegar. Revisar espacio libre
para el snapshot y conservarlo como dato privado. No aplicar downgrade/restaurar
un snapshot antiguo sin evaluar los eventos y cambios nuevos que perdería.
