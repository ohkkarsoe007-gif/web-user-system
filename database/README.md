# Database

`schema.sql` is the non-destructive baseline for the nine existing tables.
Use it only when creating a fresh database. Existing installations should
run the numbered migrations through the application migration runner.

## Migration order

1. `001_schema_migrations.sql`
2. `002_file_system_and_commands.sql`

The runner records a checksum for each applied migration. Do not edit an
already-applied migration; add a new migration instead. Back up the database
before applying migrations in production.

The database uses MySQL/MariaDB syntax (`BIGINT UNSIGNED`, `ENUM`, InnoDB, and
utf8mb4). All application queries are parameterized.