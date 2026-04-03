-- Add layout column to projects for persisting IDE panel layout
ALTER TABLE projects ADD COLUMN IF NOT EXISTS layout jsonb DEFAULT NULL;
