-- HOTFIX: Fix missing checkpoint questions when admin links questions after first seeding.
-- Run this in your Supabase SQL Editor to apply the fix to your live database.
--
-- BUG: If admin linked 5 questions to a checkpoint but only 4 appeared, it's because
-- the old logic only seeded checkpoint_questions ONCE (when the first player arrived).
-- Any questions linked AFTER that initial seeding were silently ignored.
-- Similarly, if a player was already assigned questions, new ones would never sync.
--
-- FIX: Always upsert linked questions into checkpoint_questions and always sync
-- missing questions into player_checkpoint_questions using ON CONFLICT DO NOTHING.

CREATE OR REPLACE FUNCTION get_or_create_player_state(p_token text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_player record;
  v_session record;
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

  -- If current_checkpoint is null, find the first uncompleted checkpoint on player's route
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

    -- Step 1: Always sync directly-linked questions into checkpoint_questions.
    -- Uses ON CONFLICT to upsert, so newly linked questions are always picked up
    -- even if the checkpoint was previously seeded.
    INSERT INTO checkpoint_questions (session_id, checkpoint_id, question_id)
    SELECT v_player.session_id, v_checkpoint_id, q.id
    FROM questions q
    WHERE q.is_active = true AND q.checkpoint_id = v_checkpoint_id
    ON CONFLICT (session_id, checkpoint_id, question_id) DO NOTHING;

    -- Step 2: Count current shared questions for this checkpoint
    SELECT count(*) INTO v_shared_questions_count
    FROM checkpoint_questions
    WHERE session_id = v_player.session_id AND checkpoint_id = v_checkpoint_id;

    -- Step 3: Fill remaining slots with random unlinked questions (if needed)
    IF v_shared_questions_count < v_session.questions_per_checkpoint THEN
      INSERT INTO checkpoint_questions (session_id, checkpoint_id, question_id)
      SELECT v_player.session_id, v_checkpoint_id, q.id
      FROM questions q
      WHERE q.is_active = true
        AND q.checkpoint_id IS NULL
        AND q.id NOT IN (
          SELECT cq.question_id FROM checkpoint_questions cq
          WHERE cq.session_id = v_player.session_id
        )
      ORDER BY random()
      LIMIT (v_session.questions_per_checkpoint - v_shared_questions_count);
    END IF;

    -- Step 4: Sync any missing shared questions into this player's assignments.
    -- Uses ON CONFLICT to avoid duplicates, so newly added checkpoint questions
    -- are always picked up even if the player was previously assigned.
    INSERT INTO player_checkpoint_questions (player_id, checkpoint_id, question_id)
    SELECT v_player.id, v_checkpoint_id, cq.question_id
    FROM checkpoint_questions cq
    WHERE cq.session_id = v_player.session_id AND cq.checkpoint_id = v_checkpoint_id
    ON CONFLICT (player_id, checkpoint_id, question_id) DO NOTHING;

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
