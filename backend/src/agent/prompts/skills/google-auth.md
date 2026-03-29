---
name: google-auth
description: Google OAuth login via auth proxy, JWT sessions, cookie handling, user table, and protected routes.
---

# Google Authentication

When the user asks for Google login/auth, use the auth proxy + JWT session flow.

## Required packages

```bash
npm install google-auth-library jsonwebtoken @neondatabase/serverless
npm install -D @types/jsonwebtoken
```

## Environment variables

All of these are already available in `.env.local`:
- `DATABASE_URL` — Neon PostgreSQL connection string
- `JWT_SECRET` — Secret for signing session JWTs
- `NEXT_PUBLIC_GOOGLE_CLIENT_ID` — Google OAuth client ID
- `NEXT_PUBLIC_AUTH_PROXY_URL` — Auth proxy URL for Google OAuth flow

## Users table

Create via `run_sql`:

```sql
CREATE TABLE IF NOT EXISTS users (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  google_id text UNIQUE NOT NULL,
  email text NOT NULL,
  name text,
  avatar_url text,
  created_at timestamptz DEFAULT now()
);
```

## Login page

Create `app/login/page.tsx`:

```tsx
'use client';

export default function LoginPage() {
  function handleGoogleLogin() {
    const redirect = `${window.location.origin}/auth/callback`;
    window.location.href = `${process.env.NEXT_PUBLIC_AUTH_PROXY_URL}?redirect=${encodeURIComponent(redirect)}`;
  }

  return (
    <button onClick={handleGoogleLogin}>
      Continue with Google
    </button>
  );
}
```

## Auth callback page

Create `app/auth/callback/page.tsx`:

```tsx
'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function CallbackHandler() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const idToken = searchParams.get('id_token');
    if (!idToken) {
      window.location.href = '/login';
      return;
    }

    fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    }).then((res) => {
      if (res.ok) window.location.href = '/';
      else window.location.href = '/login';
    });
  }, [searchParams]);

  return <div>Signing in...</div>;
}

export default function AuthCallback() {
  return (
    <Suspense>
      <CallbackHandler />
    </Suspense>
  );
}
```

**IMPORTANT:** Do NOT use `useRouter` — use `window.location.href` for redirects to ensure a full page reload that picks up the new session cookie.

## API route: `/api/auth/login`

Create `app/api/auth/login/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import { neon } from '@neondatabase/serverless';
import { cookies } from 'next/headers';

const client = new OAuth2Client(process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID);
const sql = neon(process.env.DATABASE_URL!);

export async function POST(req: NextRequest) {
  try {
    const { idToken } = await req.json();

    // Verify the Google ID token
    const ticket = await client.verifyIdToken({
      idToken,
      audience: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

    const { sub: googleId, email, name, picture } = payload;

    // Find or create user — use tagged template syntax for neon
    const existing = await sql`SELECT * FROM users WHERE google_id = ${googleId}`;
    let user = existing[0];

    if (!user) {
      const inserted = await sql`INSERT INTO users (google_id, email, name, avatar_url) VALUES (${googleId}, ${email}, ${name}, ${picture}) RETURNING *`;
      user = inserted[0];
    }

    // Create JWT session
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET!, { expiresIn: '7d' });

    const cookieStore = await cookies();
    cookieStore.set('session', token, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: '/',
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Login error:', err);
    return NextResponse.json({ error: 'Authentication failed' }, { status: 500 });
  }
}
```

## API route: `/api/auth/me`

Create `app/api/auth/me/route.ts`:

```ts
import { NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import { neon } from '@neondatabase/serverless';
import { cookies } from 'next/headers';

const sql = neon(process.env.DATABASE_URL!);

export async function GET() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('session')?.value;
    if (!token) return NextResponse.json({ user: null });

    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { userId: string };
    const rows = await sql`SELECT id, email, name, avatar_url, created_at FROM users WHERE id = ${decoded.userId}`;
    const user = rows[0] ?? null;

    return NextResponse.json({ user });
  } catch {
    return NextResponse.json({ user: null });
  }
}
```

## API route: `/api/auth/logout`

Create `app/api/auth/logout/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function POST() {
  const cookieStore = await cookies();
  cookieStore.set('session', '', {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  });
  return NextResponse.json({ ok: true });
}
```

## Next.js config

Add Google's image domain to `next.config.ts` for user avatars:

```ts
const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
    ],
  },
};
```

## Protecting pages

On any page that requires auth, fetch `/api/auth/me` and redirect if no user:

```ts
useEffect(() => {
  fetch('/api/auth/me')
    .then((r) => r.json())
    .then(({ user }) => {
      if (!user) window.location.href = '/login';
      else setUser(user);
    });
}, []);
```

For tables with user data, add a `user_id uuid REFERENCES users(id)` column and filter by `user_id` in API routes.

## Critical rules

- **ALWAYS** use tagged template syntax for neon queries: `` sql`SELECT * FROM users WHERE id = ${id}` `` — NEVER use `sql('SELECT...', [params])`.
- **ALWAYS** use `window.location.href` for auth redirects, NOT `useRouter().push()`. Full page reloads are needed to pick up cookie changes.
- **NEVER** use `supabase.auth`, Google Identity Services script, or `signInWithOAuth`.
- **ALWAYS** verify the ID token server-side with `google-auth-library` — NEVER just decode it with `jwt.decode()`.
- **ALWAYS** set cookies with `httpOnly: true`, `secure: true`, `sameSite: 'lax'`.
