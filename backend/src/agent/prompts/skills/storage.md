---
name: storage
description: Cloudflare R2 file storage — server-side uploads, S3-compatible API, public URLs, and download patterns.
---

# File Storage (Cloudflare R2)

S3-compatible object storage for file uploads. Install `@aws-sdk/client-s3` (no other S3 packages needed).

## Critical: server-side uploads only

The R2 bucket has NO CORS configuration. Browser-direct uploads to R2 will fail.
Always use this flow: `Browser → FormData POST to /api/upload → API route buffers file → PutObject to R2 → return public URL`

## Environment variables (already in `.env.local`)

- `R2_ENDPOINT` — S3-compatible endpoint
- `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` — scoped credentials
- `R2_BUCKET_NAME` — bucket name
- `R2_PUBLIC_URL` — public serving URL, use as `${R2_PUBLIC_URL}/${key}`

## S3 Client (`lib/storage.ts`)

```ts
import { S3Client } from '@aws-sdk/client-s3';

export const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT!,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

export const BUCKET = process.env.R2_BUCKET_NAME!;
```

## Upload API route (`app/api/upload/route.ts`)

```ts
import { NextRequest, NextResponse } from 'next/server';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { s3, BUCKET } from '@/lib/storage';

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get('file') as File;
  if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const key = `uploads/${Date.now()}-${file.name}`;

  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: file.type,
  }));

  return NextResponse.json({ url: `${process.env.R2_PUBLIC_URL}/${key}` });
}
```

## Rules

- **ALL uploads server-side.** Never presigned URLs, never browser-direct to R2.
- Use key prefixes: `uploads/`, `avatars/`, `documents/`, etc.
- Always set `ContentType` when uploading.
- For download/list/delete, use standard `GetObjectCommand`, `ListObjectsV2Command`, `DeleteObjectCommand` from `@aws-sdk/client-s3`.
