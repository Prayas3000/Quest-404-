-- Migration V2: Duplicate Name Prevention & Checkpoint-Linked Questions
-- Run this in your Supabase SQL Editor AFTER the initial schema and migration_self_registration.

-- ============================================================
-- 1. UNIQUE CONSTRAINT: Prevent duplicate player names per team
-- ============================================================
-- Partial unique index: only enforced when team_id is NOT NULL
-- (so unassigned players with the same name are allowed)
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_player_name_per_team
  ON players (team_id, lower(player_name))
  WHERE team_id IS NOT NULL;

-- Also add a unique index at the session level to prevent duplicate
-- names during self-registration (before team assignment)
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_player_name_per_session
  ON players (session_id, lower(player_name));


-- ============================================================
-- 2. NEW TABLE: checkpoint_questions (shared questions per checkpoint)
-- ============================================================
-- Instead of each player getting random questions, questions are
-- seeded once per checkpoint (by the first player to arrive) and
-- shared across all players at that checkpoint.

CREATE TABLE IF NOT EXISTS checkpoint_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES sessions(id) ON DELETE CASCADE NOT NULL,
  checkpoint_id uuid REFERENCES checkpoints(id) ON DELETE CASCADE NOT NULL,
  question_id uuid REFERENCES questions(id) ON DELETE CASCADE NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  UNIQUE(session_id, checkpoint_id, question_id)
);

-- Enable RLS
ALTER TABLE checkpoint_questions ENABLE ROW LEVEL SECURITY;

-- Admin full access
CREATE POLICY admin_all_checkpoint_questions_shared
  ON checkpoint_questions FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- Anonymous read access (players need to see their assigned questions)
CREATE POLICY anon_read_checkpoint_questions_shared
  ON checkpoint_questions FOR SELECT TO anon
  USING (true);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_checkpoint_questions_session_checkpoint
  ON checkpoint_questions(session_id, checkpoint_id);


-- ============================================================
-- 3. UPDATED RPC: get_or_create_player_state
-- ============================================================
-- Now uses checkpoint_questions for shared question assignment.
-- First player to reach a checkpoint seeds the questions.
-- All subsequent players get the same questions.

CREATE OR REPLACE FUNCTION get_or_create_player_state(p_token text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_player record;
  v_session record;
  v_current_route record;
  v_questions_count integer;
  v_shared_questions_count integer;
  v_checkpoint_id uuid;
  v_first_checkpoint uuid;
BEGIN
  -- Get player info
  SELECT p.*, COALESCE(t.team_name, 'Unassigned') as team_name INTO v_player
  FROM players p
  LEFT JOIN teams t ON p.team_id = t.id
  WHERE p.access_token = p_token;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Invalid access token');
  END IF;

  -- Get session info
  SELECT * INTO v_session FROM sessions WHERE id = v_player.session_id;

  -- If player has no team yet, return a pending status state
  IF v_player.team_id IS NULL THEN
    RETURN json_build_object(
      'success', true,
      'player', json_build_object(
        'id', v_player.id,
        'player_name', v_player.player_name,
        'team_name', 'Unassigned',
        'current_checkpoint_id', null
      ),
      'session', json_build_object(
        'id', v_session.id,
        'title', v_session.title,
        'status', v_session.status,
        'duration', v_session.duration,
        'started_at', v_session.started_at
      )
    );
  END IF;

  -- If current_checkpoint is null, find the first checkpoint on player's route
  IF v_player.current_checkpoint IS NULL THEN
    SELECT checkpoint_id INTO v_first_checkpoint
    FROM player_routes
    WHERE player_id = v_player.id AND is_completed = false
    ORDER BY route_order ASC
    LIMIT 1;
    
    IF v_first_checkpoint IS NOT NULL THEN
      UPDATE players SET current_checkpoint = v_first_checkpoint WHERE id = v_player.id;
      v_player.current_checkpoint := v_first_checkpoint;
    END IF;
  END IF;

  v_checkpoint_id := v_player.current_checkpoint;

  -- If there is a current checkpoint, handle shared question assignment
  IF v_checkpoint_id IS NOT NULL THEN

    -- Step 1: Check if shared checkpoint_questions exist for this session+checkpoint
    SELECT count(*) INTO v_shared_questions_count
    FROM checkpoint_questions
    WHERE session_id = v_player.session_id AND checkpoint_id = v_checkpoint_id;

    -- Step 2: If no shared questions exist yet, this player seeds them (first arrival)
    IF v_shared_questions_count = 0 THEN
      INSERT INTO checkpoint_questions (session_id, checkpoint_id, question_id)
      SELECT v_player.session_id, v_checkpoint_id, q.id
      FROM questions q
      WHERE q.is_active = true
      ORDER BY random()
      LIMIT v_session.questions_per_checkpoint;
    END IF;

    -- Step 3: Check if THIS player already has questions assigned for this checkpoint
    SELECT count(*) INTO v_questions_count
    FROM player_checkpoint_questions
    WHERE player_id = v_player.id AND checkpoint_id = v_checkpoint_id;

    -- Step 4: If not, copy shared questions into player_checkpoint_questions
    IF v_questions_count = 0 THEN
      INSERT INTO player_checkpoint_questions (player_id, checkpoint_id, question_id)
      SELECT v_player.id, v_checkpoint_id, cq.question_id
      FROM checkpoint_questions cq
      WHERE cq.session_id = v_player.session_id AND cq.checkpoint_id = v_checkpoint_id;
    END IF;

  END IF;

  -- Build response state
  RETURN json_build_object(
    'success', true,
    'player', json_build_object(
      'id', v_player.id,
      'player_name', v_player.player_name,
      'team_name', v_player.team_name,
      'current_checkpoint_id', v_checkpoint_id
    ),
    'session', json_build_object(
      'id', v_session.id,
      'title', v_session.title,
      'status', v_session.status,
      'duration', v_session.duration,
      'started_at', v_session.started_at
    )
  );
END;
$$;
