# GitHub OAuth Integration — Repo Access

## Overview

Users connect their GitHub account to Dreamer to list repos, clone them into sandboxes, and push changes. This is separate from login (handled by Supabase/Google OAuth).

**Approach**: GitHub OAuth App with `repo` scope.

---

## Setup

### 1. Create GitHub OAuth App

Go to [github.com/settings/developers](https://github.com/settings/developers) → New OAuth App.

| Field | Production | Local Dev |
|-------|-----------|-----------|
| App name | Dreamer | Dreamer (dev) |
| Homepage URL | `https://dreamer-py.vercel.app` | `http://localhost:3000` |
| Callback URL | `https://dreamer-py.onrender.com/api/github/callback` | `http://localhost:3001/api/github/callback` |

> Create two separate OAuth Apps — one for prod, one for local dev (GitHub allows only one callback URL per app).

### 2. Environment Variables

Add to `backend/.env`:

```
GITHUB_CLIENT_ID=<from GitHub OAuth App>
GITHUB_CLIENT_SECRET=<from GitHub OAuth App>
GITHUB_TOKEN_ENCRYPTION_KEY=<generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
```

### 3. Database Migration

New table `github_connections`:

```sql
create table github_connections (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references auth.users(id) on delete cascade not null unique,
  github_user   text not null,
  access_token  text not null,  -- AES-256-GCM encrypted
  token_iv      text not null,
  token_tag     text not null,
  scopes        text default 'repo',
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);
```

One row per user. Tokens encrypted at app layer before storage.

---

## Auth Flow

```
User clicks "Connect GitHub" (dashboard sidebar)
  → Frontend calls GET /api/github/connect
  → Backend returns GitHub OAuth URL
  → Frontend opens URL in popup

GitHub OAuth screen (user authorizes, selects scope: repo)
  → GitHub redirects to GET /api/github/callback?code=XXX&state=YYY

Backend callback handler:
  → Exchanges code for access_token (POST github.com/login/oauth/access_token)
  → Fetches GitHub username (GET api.github.com/user)
  → Encrypts token (AES-256-GCM)
  → Stores in github_connections table
  → Returns HTML that sends postMessage to opener and closes popup

Frontend receives postMessage → updates UI to show connected GitHub user
```

---

## API Routes

| Route | Auth | Purpose |
|-------|------|---------|
| `GET /api/github/callback` | No | GitHub redirects here, exchanges code for token |
| `GET /api/github/connect` | Yes | Returns GitHub OAuth URL for frontend to open |
| `GET /api/github/status` | Yes | Returns `{ connected, github_user }` |
| `GET /api/github/repos` | Yes | Lists user's repos from GitHub API |
| `POST /api/github/disconnect` | Yes | Deletes stored token |

---

## Cloning into Sandbox

When creating a project from a GitHub repo:

```bash
git clone https://<token>@github.com/owner/repo.git /app
```

When connecting to a project, inject credentials so the agent can push:

```bash
git config --global credential.helper store
echo "https://<token>@github.com" > ~/.git-credentials
```

---

## Files to Create/Modify

| File | Action |
|------|--------|
| `backend/src/services/github.ts` | **New** — encrypt/decrypt, token storage, GitHub API |
| `supabase/migrations/003_github_connections.sql` | **New** — DB table |
| `backend/src/index.ts` | **Modify** — add 5 routes, modify project create/connect |
| `src/components/dashboard/Dashboard.tsx` | **Modify** — add connect/disconnect UI in sidebar |
| `src/components/dashboard/NewProjectDialog.tsx` | **Modify** — add "Import from GitHub" template |

---

## Security

- Tokens encrypted with AES-256-GCM (per-token random IV + auth tag)
- Encryption key stored as env var, never in DB
- Tokens injected into sandbox via `~/.git-credentials` (sandboxes are isolated per-project)
- State parameter in OAuth prevents CSRF
- `repo` scope only — no broader access requested
