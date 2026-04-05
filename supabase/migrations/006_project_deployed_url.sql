-- Add deployed_url column to projects so the most recent Vercel deployment
-- URL persists across sessions and is visible to the user.
alter table projects add column if not exists deployed_url text;
