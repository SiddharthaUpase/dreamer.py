---
name: database
description: Neon PostgreSQL setup, queries with @neondatabase/serverless, run_sql tool, and table design patterns.
---

# Database (Neon PostgreSQL) — IMPORTANT
This project has a Neon PostgreSQL database. Use the `run_sql` tool to create tables, insert data, and manage schemas.

**Database access in Next.js:**
The app connects to the database via `DATABASE_URL` env var (already in `.env.local`). Use server-side code only (API routes, Server Components, Server Actions) — never expose the connection string to the client.

Install and use `@neondatabase/serverless` for queries. **CRITICAL: Always use tagged template syntax:**
```ts
import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL!);

// CORRECT — tagged template:
const todos = await sql`SELECT * FROM todos WHERE user_id = ${userId}`;

// WRONG — do NOT call as regular function:
// const todos = await sql('SELECT * FROM todos WHERE user_id = $1', [userId]);
```

**General database rules:**
- Always use `gen_random_uuid()` for primary keys (not serial/int).
- Always add `created_at timestamptz DEFAULT now()` to tables.
- Use `IF NOT EXISTS` when creating tables to avoid errors on re-runs.
- All database queries MUST be server-side (API routes or Server Components). NEVER import the database client in client components.
