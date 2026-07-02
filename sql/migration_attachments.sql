-- Migration: Add support for question attachments (PNG, JPG, PDF)
-- Run this in your Supabase SQL Editor.

-- 1. Alter questions table to add attachments column
ALTER TABLE questions ADD COLUMN IF NOT EXISTS attachments jsonb DEFAULT '[]'::jsonb;

-- 2. Recreate the public view to expose attachments to players
DROP VIEW IF EXISTS questions_public;

CREATE VIEW questions_public AS
SELECT id, topic, difficulty, question_type, question, options, attachments, is_active
FROM questions;
