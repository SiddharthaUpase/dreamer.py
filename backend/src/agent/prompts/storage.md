# File Storage (Cloudflare R2)

This project has an S3-compatible object storage bucket for file uploads (images, documents, etc.).

## Required packages

```bash
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

## Environment variables

All of these are already available in `.env.local`:
- `R2_ACCESS_KEY_ID` — Scoped access key for this project's bucket
- `R2_SECRET_ACCESS_KEY` — Secret key for this project's bucket
- `R2_PUBLIC_URL` — Public URL for serving uploaded files (e.g. `https://pub-xxx.r2.dev`)
- `R2_ENDPOINT` — R2 S3-compatible endpoint
- `R2_BUCKET_NAME` — This project's bucket name

## S3 Client setup

Create a shared S3 client at `lib/storage.ts`:

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

## Upload a file (server-side only)

```ts
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { s3, BUCKET } from '@/lib/storage';

export async function uploadFile(key: string, body: Buffer, contentType: string) {
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType,
  }));
  // Return the public URL for serving the file
  return `${process.env.R2_PUBLIC_URL}/${key}`;
}
```

## Generate a presigned upload URL (for client-side uploads)

```ts
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { s3, BUCKET } from '@/lib/storage';

export async function getUploadUrl(key: string, contentType: string) {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(s3, command, { expiresIn: 3600 });
}
```

## Download / read a file

```ts
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { s3, BUCKET } from '@/lib/storage';

export async function getFile(key: string) {
  const res = await s3.send(new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
  }));
  return res.Body;
}
```

## List files

```ts
import { ListObjectsV2Command } from '@aws-sdk/client-s3';
import { s3, BUCKET } from '@/lib/storage';

export async function listFiles(prefix?: string) {
  const res = await s3.send(new ListObjectsV2Command({
    Bucket: BUCKET,
    Prefix: prefix,
  }));
  return res.Contents || [];
}
```

## API route example: file upload

```ts
// app/api/upload/route.ts
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

  return NextResponse.json({ key, url: `${process.env.R2_PUBLIC_URL}/${key}` });
}
```

## Critical rules

- **ALL storage operations MUST be server-side** (API routes, Server Actions). NEVER expose R2 credentials to the client.
- Use presigned URLs if the client needs to upload directly.
- Use meaningful key prefixes: `uploads/`, `avatars/`, `documents/`, etc.
- Always set `ContentType` when uploading.
