#!/usr/bin/env bash
# Recreates the LOCAL test database (Postgres inside WSL) empty. Synthetic test data only.
# Run from Windows:  wsl -d Ubuntu -u root -- bash /mnt/<drive>/<path>/scripts/recreate-test-db.sh
# Afterwards `npm test` applies every migration to it again.
set -euo pipefail
DB=bitsclock_test
OWNER=bitsclock_test
case "$DB" in *_test) ;; *) echo "refusing: database name must end in _test"; exit 1 ;; esac
service postgresql start >/dev/null
su postgres -c "dropdb --if-exists --force $DB"
su postgres -c "createdb -O $OWNER $DB"
echo "Recreated empty local database $DB."
