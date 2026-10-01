#!/usr/bin/env bash
# Applies the migration to a throwaway database and checks row-level security.
# Requires PostgreSQL on this machine. Not part of the Netlify site.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -n "${PGUSER:-}" ]]; then
  PSQL=(psql -v ON_ERROR_STOP=1)
else
  PSQL=(sudo -u postgres psql -v ON_ERROR_STOP=1)
fi

"${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS food_portal_rls;"
"${PSQL[@]}" -d postgres -c "CREATE DATABASE food_portal_rls;"
"${PSQL[@]}" -d food_portal_rls -f tests/harness.sql
"${PSQL[@]}" -d food_portal_rls -f migrations/20261001120000_init.sql
"${PSQL[@]}" -d food_portal_rls -f tests/rls_test.sql
