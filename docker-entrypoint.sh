#!/bin/sh
set -eu

MIGRATE_ON_START="${RW_RUN_DB_MIGRATIONS_ON_START:-true}"

case "${MIGRATE_ON_START}" in
  1|true|TRUE|yes|YES|on|ON)
    echo "[entrypoint] Running database migrations"
    node --import tsx server/scripts/migrate.ts
    ;;
  0|false|FALSE|no|NO|off|OFF)
    echo "[entrypoint] Database migrations are disabled"
    ;;
  *)
    echo "[entrypoint] Unknown RW_RUN_DB_MIGRATIONS_ON_START='${MIGRATE_ON_START}', running migrations by default"
    node --import tsx server/scripts/migrate.ts
    ;;
esac

echo "[entrypoint] Starting application"
exec node --import tsx server/server.ts
