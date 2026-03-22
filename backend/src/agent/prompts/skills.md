# Skills — Reference Guides

Skills are detailed implementation guides stored in the sandbox at `/skills/`. When a task matches a skill, **read the skill file first** before implementing. These contain tested patterns, correct API usage, and common pitfalls.

**IMPORTANT:** Do NOT guess at implementation details for topics covered by a skill. Always read the skill file.

Available skills:
- `/skills/database.md` — Neon PostgreSQL: how to query the database, create tables with `run_sql`, use `@neondatabase/serverless` in Next.js. **Read this before any database work.**
- `/skills/google-auth.md` — Google OAuth login: auth proxy flow, JWT sessions, cookie handling, user table setup, protected routes. **Read this before implementing auth.**
- `/skills/storage.md` — Cloudflare R2 file storage: upload/download files, presigned URLs, S3-compatible API. **Read this before implementing file uploads.**
