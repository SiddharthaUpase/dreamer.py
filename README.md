# Dreamer

An open-source AI-powered development environment. Describe what you want to build and Dreamer creates it — writing code, setting up databases, configuring storage, and deploying to production.

Think Cursor meets Replit — a cloud sandbox with an AI agent that builds full-stack apps from natural language.

## Quick Start

```bash
npm i -g dreamer-py
dreamer
```

That's it. Sign in with Google, select a project, and start building.

## What Dreamer Does

- Writes and edits code in a cloud sandbox (Next.js, React, Node.js)
- Provisions a PostgreSQL database (Neon) — creates tables, seeds data, runs migrations
- Sets up Cloudflare R2 storage with upload routes
- Configures Google OAuth for your app
- Deploys to Vercel with one command
- Searches the web and fetches docs when needed
- Generates images via AI

All from a single terminal prompt.

## Example

```
(my-app) > build a task management app with auth, a dashboard,
           and the ability to assign tasks to team members

Agent: I'll build this step by step...
  ✓ Created database tables: users, tasks, teams
  ✓ Set up Google OAuth login
  ✓ Built dashboard with task list, filters, and team view
  ✓ Added API routes for CRUD operations
  ✓ Styled with Tailwind CSS

Preview: https://xxx.preview.bl.run
```

## Architecture

```
cli/          → CLI tool (published as dreamer-py on npm)
backend/      → Express API server (agent orchestration, sandbox management)
src/          → Next.js frontend (auth, dashboard)
supabase/     → Database migrations
```

**How it works:**

1. CLI authenticates via browser-based OAuth
2. You select or create a project
3. Each project gets a cloud sandbox (Blaxel) with its own filesystem, terminal, and preview URL
4. Your messages go to an AI agent (Claude) that has tools to read, write, edit files, run bash commands, execute SQL, search the web, and deploy
5. The agent builds iteratively — writing code, checking the dev server, fixing errors, until things work

## CLI Commands

| Command | Description |
|---------|-------------|
| `/new` | Create a new project |
| `/projects` | List all projects |
| `/switch` | Switch to another project |
| `/deploy` | Deploy to Vercel |
| `/url` | Open preview in browser |
| `/model` | Switch AI model |
| `/history` | View conversation history |
| `/compact` | Compress context when it gets long |
| `/delete` | Delete current project |
| `/logout` | Sign out and clear credentials |
| `/exit` | Exit the CLI |

## Self-Hosting

### Prerequisites

- Node.js 18+
- Supabase project (auth + database)
- Blaxel account (cloud sandboxes)
- Neon account (PostgreSQL provisioning)
- Cloudflare R2 bucket (storage)
- OpenRouter API key (LLM access)

### Setup

1. Clone the repo:

```bash
git clone https://github.com/sid-code/agent-vas.git
cd agent-vas
```

2. Install dependencies:

```bash
npm install
cd backend && npm install
```

3. Set up environment variables:

```bash
# backend/.env
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
OPENROUTER_API_KEY=
BL_API_KEY=
BL_WORKSPACE=
NEON_API_KEY=
CF_ACCOUNT_ID=
CF_API_TOKEN=
VERCEL_TOKEN=
VERCEL_TEAM_ID=
```

```bash
# .env.local (frontend)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_BACKEND_URL=http://localhost:3001
```

4. Run database migrations:

```bash
npx supabase db push
```

5. Start the development servers:

```bash
# Terminal 1 — backend
cd backend && npm run dev

# Terminal 2 — frontend
npm run dev
```

6. Run the CLI against local:

```bash
cd cli
echo 'DREAMER_BACKEND_URL=http://localhost:3001' > .env
echo 'DREAMER_APP_URL=http://localhost:3000' >> .env
npm run dev
```

## Tech Stack

| Component | Technology |
|-----------|-----------|
| CLI | Node.js, TypeScript |
| Backend | Express, LangChain, Claude (via OpenRouter) |
| Frontend | Next.js, Material UI, Supabase Auth |
| Sandboxes | Blaxel |
| Database | Neon (PostgreSQL) |
| Storage | Cloudflare R2 |
| Deployment | Vercel |

## License

MIT
