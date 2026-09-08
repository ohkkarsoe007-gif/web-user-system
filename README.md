# HAZAKBAN

HAZAKBAN is a mobile-first web user system with a cyber-terminal user
experience and a responsive administrator console. It is a general-purpose
file access application; it is not a hospital, OPD, or patient system.

## Architecture

- React + Vite client
- Express + TypeScript API
- MySQL/MariaDB database
- Server-managed, hashed session cookies
- Database-backed allowlisted terminal commands
- Private local file storage behind a storage-key abstraction

The nine tables in `database/schema.sql` are the legacy baseline and are not
deleted. New functionality is added through numbered migrations in
`database/migrations`.

## Development

1. Copy `.env.example` to `.env` and set the database values.
2. Create an empty `web_user_system` database.
3. Run `npm install`.
4. Run `npm run dev`.

The API runs on `PORT` (3000 by default) and Vite proxies `/api` to it.

## Production

Run `npm run build` followed by `npm start`. Use HTTPS, a strong
`SESSION_SECRET`, a private `STORAGE_ROOT`, and a database user with only the
permissions required by the application. Never commit `.env`, uploads,
passwords, SMTP credentials, or API keys.

## Security model

The terminal is not an operating-system shell. A submitted command is matched
to an active row in `command_definitions`, checked against the user's
permissions, and dispatched to an explicitly supported application action.
User input never reaches `exec`, `system`, `shell_exec`, `spawn`, or a shell.