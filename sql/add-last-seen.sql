-- Add last_seen column to profiles table
-- Run this in the Supabase SQL Editor

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_seen timestamptz;

-- Allow users to update their own last_seen
CREATE POLICY "Users can update own last_seen"
  ON profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);
