-- Migration Script: Support self-registration & team assignment
-- Run this in your Supabase SQL Editor.

-- 1. Alter players table to add session_id and make team_id nullable
ALTER TABLE players ADD COLUMN session_id UUID REFERENCES sessions(id) ON DELETE CASCADE;
ALTER TABLE players ALTER COLUMN team_id DROP NOT NULL;

-- 2. Populate session_id for any existing players (if any) based on their team's session
UPDATE players p
SET session_id = t.session_id
FROM teams t
WHERE p.team_id = t.id;

-- 3. Now make session_id NOT NULL (will succeed since we populated it above or table is empty)
ALTER TABLE players ALTER COLUMN session_id SET NOT NULL;

-- 4. Re-create RLS Policies on players
DROP POLICY IF EXISTS anon_read_players ON players;
DROP POLICY IF EXISTS anon_insert_players ON players;

-- Public read policy based on session status
CREATE POLICY anon_read_players ON players FOR SELECT TO anon 
  USING (session_id IN (SELECT id FROM sessions WHERE status IN ('active', 'completed')));

-- Allow players to register themselves (insert)
CREATE POLICY anon_insert_players ON players FOR INSERT TO anon WITH CHECK (true);

-- 5. Update the get_or_create_player_state RPC function
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
  v_assigned_question record;
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
    WHERE player_id = v_player.id
    ORDER BY route_order asc
    LIMIT 1;
    
    IF v_first_checkpoint IS NOT NULL THEN
      UPDATE players SET current_checkpoint = v_first_checkpoint WHERE id = v_player.id;
      v_player.current_checkpoint := v_first_checkpoint;
    END IF;
  END IF;

  v_checkpoint_id := v_player.current_checkpoint;

  -- If there is a current checkpoint, assign questions if they don't exist yet
  IF v_checkpoint_id IS NOT NULL THEN
    SELECT count(*) INTO v_questions_count
    FROM player_checkpoint_questions
    WHERE player_id = v_player.id and checkpoint_id = v_checkpoint_id;

    IF v_questions_count = 0 THEN
      -- Assign unique random questions for this checkpoint
      INSERT INTO player_checkpoint_questions (player_id, checkpoint_id, question_id)
      SELECT v_player.id, v_checkpoint_id, q.id
      FROM questions q
      WHERE q.is_active = true
      -- Ensure player hasn't answered this question at previous checkpoints
      AND q.id NOT IN (
        SELECT question_id FROM player_answers WHERE player_id = v_player.id
      )
      -- Optional: try to avoid overlapping with teammates at this checkpoint
      ORDER BY 
        CASE WHEN q.id NOT IN (
          SELECT question_id 
          from player_checkpoint_questions pcq
          join players teammate on pcq.player_id = teammate.id
          where teammate.team_id = v_player.team_id and pcq.checkpoint_id = v_checkpoint_id
        ) THEN 0 ELSE 1 END,
        random()
      LIMIT v_session.questions_per_checkpoint;
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
