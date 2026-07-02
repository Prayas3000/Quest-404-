-- Quest 404 PostgreSQL Schema & Security Policy
-- Run this in your Supabase SQL Editor.

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Drop existing views/tables if they exist (for clean schema setup)
drop view if exists leaderboard_view;
drop view if exists questions_public;
drop table if exists player_checkpoint_questions cascade;
drop table if exists player_answers cascade;
drop table if exists player_routes cascade;
drop table if exists checkpoints cascade;
drop table if exists players cascade;
drop table if exists teams cascade;
drop table if exists questions cascade;
drop table if exists sessions cascade;

-- --- TABLES ---

-- 1. Sessions Table
create table sessions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  duration integer not null default 60, -- in minutes
  status text not null default 'draft' check (status in ('draft', 'active', 'completed')),
  route_mode text not null default 'random' check (route_mode in ('random', 'manual')),
  questions_per_checkpoint integer not null default 2,
  started_at timestamp with time zone,
  created_at timestamp with time zone default now()
);

-- 2. Teams Table
create table teams (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references sessions(id) on delete cascade not null,
  team_name text not null,
  unique (session_id, team_name)
);

-- 3. Checkpoints Table
create table checkpoints (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references sessions(id) on delete cascade not null,
  checkpoint_name text not null,
  hint text not null,
  qr_identifier text not null unique,
  created_at timestamp with time zone default now()
);

-- 4. Players Table
create table players (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references sessions(id) on delete cascade not null,
  team_id uuid references teams(id) on delete cascade, -- Nullable initially
  player_name text not null,
  access_token text not null unique,
  current_checkpoint uuid references checkpoints(id) on delete set null,
  created_at timestamp with time zone default now()
);

-- 5. Questions Table (Stored securely, admin only)
create table questions (
  id uuid primary key default gen_random_uuid(),
  topic text not null check (topic in ('cybersecurity', 'mathematics')),
  difficulty text not null check (difficulty in ('easy', 'medium', 'hard')),
  question_type text not null check (question_type in ('mcq', 'text')),
  question text not null,
  options jsonb, -- array of strings e.g. ["A", "B", "C", "D"]
  answer text not null, -- correct option index or exact string
  is_active boolean not null default true,
  created_at timestamp with time zone default now()
);

-- 6. Player Routes Table (Defines order of checkpoints for each player)
create table player_routes (
  id uuid primary key default gen_random_uuid(),
  player_id uuid references players(id) on delete cascade not null,
  checkpoint_id uuid references checkpoints(id) on delete cascade not null,
  route_order integer not null,
  is_completed boolean not null default false,
  completed_at timestamp with time zone,
  unique (player_id, checkpoint_id)
);

-- 7. Player Answers Table (Answers submitted by players)
create table player_answers (
  id uuid primary key default gen_random_uuid(),
  player_id uuid references players(id) on delete cascade not null,
  checkpoint_id uuid references checkpoints(id) on delete cascade not null,
  question_id uuid references questions(id) on delete cascade not null,
  submitted_answer text not null,
  is_correct boolean not null,
  created_at timestamp with time zone default now(),
  unique (player_id, checkpoint_id, question_id)
);

-- 8. Player Checkpoint Questions Table (Assigned questions for players at checkpoints)
create table player_checkpoint_questions (
  id uuid primary key default gen_random_uuid(),
  player_id uuid references players(id) on delete cascade not null,
  checkpoint_id uuid references checkpoints(id) on delete cascade not null,
  question_id uuid references questions(id) on delete cascade not null,
  created_at timestamp with time zone default now(),
  unique (player_id, checkpoint_id, question_id)
);

-- 9. Checkpoint Questions Table (Shared questions per checkpoint, seeded by first player)
create table checkpoint_questions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references sessions(id) on delete cascade not null,
  checkpoint_id uuid references checkpoints(id) on delete cascade not null,
  question_id uuid references questions(id) on delete cascade not null,
  created_at timestamp with time zone default now(),
  unique (session_id, checkpoint_id, question_id)
);

-- Unique indexes: prevent duplicate player names per team and per session
create unique index idx_unique_player_name_per_team
  on players (team_id, lower(player_name))
  where team_id is not null;

create unique index idx_unique_player_name_per_session
  on players (session_id, lower(player_name));

-- --- VIEWS ---

-- Public Questions View (Excludes correct answer column)
create or replace view questions_public as
select id, topic, difficulty, question_type, question, options, is_active
from questions;

-- Leaderboard View (Aggregated team score calculations)
create or replace view leaderboard_view as
with player_scores as (
  select 
    p.id as player_id,
    p.player_name,
    p.team_id,
    coalesce(sum(case when pa.is_correct = true then 1 else 0 end), 0) as player_score,
    coalesce(count(distinct pr.checkpoint_id), 0) as checkpoints_completed,
    max(pr.completed_at) as last_completion_time
  from players p
  left join player_answers pa on p.id = pa.player_id
  left join player_routes pr on p.id = pr.player_id and pr.is_completed = true
  group by p.id, p.player_name, p.team_id
),
team_aggregates as (
  select
    t.id as team_id,
    t.team_name,
    t.session_id,
    sum(ps.player_score) as total_score,
    sum(ps.checkpoints_completed) as checkpoints_completed,
    max(ps.last_completion_time) as last_completion_time,
    min(ps.last_completion_time) as first_completion_time
  from teams t
  left join player_scores ps on t.id = ps.team_id
  group by t.id, t.team_name, t.session_id
)
select 
  ta.session_id,
  ta.team_id,
  ta.team_name,
  ta.total_score,
  ta.checkpoints_completed,
  ta.last_completion_time,
  -- Calculate elapsed time from session start if active
  case 
    when s.started_at is null then 0
    when ta.last_completion_time is null then extract(epoch from (now() - s.started_at))::integer
    else extract(epoch from (ta.last_completion_time - s.started_at))::integer
  end as elapsed_seconds
from team_aggregates ta
join sessions s on ta.session_id = s.id;


-- --- FUNCTIONS & PROCEDURES (SECURITY DEFINER) ---

-- 1. Initialize Player Questions & Route status (Checkpoint-Linked Shared Questions)
create or replace function get_or_create_player_state(p_token text)
returns json
language plpgsql
security definer
as $$
declare
  v_player record;
  v_session record;
  v_questions_count integer;
  v_shared_questions_count integer;
  v_checkpoint_id uuid;
  v_first_checkpoint uuid;
begin
  -- Get player info
  select p.*, coalesce(t.team_name, 'Unassigned') as team_name into v_player
  from players p
  left join teams t on p.team_id = t.id
  where p.access_token = p_token;

  if not found then
    return json_build_object('success', false, 'error', 'Invalid access token');
  end if;

  -- Get session info
  select * into v_session from sessions where id = v_player.session_id;

  -- If player has no team yet, return a pending status state
  if v_player.team_id is null then
    return json_build_object(
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
  end if;

  -- If current_checkpoint is null, find the first checkpoint on player's route
  if v_player.current_checkpoint is null then
    select checkpoint_id into v_first_checkpoint
    from player_routes
    where player_id = v_player.id
    order by route_order asc
    limit 1;
    
    if v_first_checkpoint is not null then
      update players set current_checkpoint = v_first_checkpoint where id = v_player.id;
      v_player.current_checkpoint := v_first_checkpoint;
    end if;
  end if;

  v_checkpoint_id := v_player.current_checkpoint;

  -- If there is a current checkpoint, handle shared question assignment
  if v_checkpoint_id is not null then

    -- Step 1: Check if shared checkpoint_questions exist for this session+checkpoint
    select count(*) into v_shared_questions_count
    from checkpoint_questions
    where session_id = v_player.session_id and checkpoint_id = v_checkpoint_id;

    -- Step 2: If no shared questions exist yet, this player seeds them (first arrival)
    if v_shared_questions_count = 0 then
      insert into checkpoint_questions (session_id, checkpoint_id, question_id)
      select v_player.session_id, v_checkpoint_id, q.id
      from questions q
      where q.is_active = true
      order by random()
      limit v_session.questions_per_checkpoint;
    end if;

    -- Step 3: Check if THIS player already has questions assigned for this checkpoint
    select count(*) into v_questions_count
    from player_checkpoint_questions
    where player_id = v_player.id and checkpoint_id = v_checkpoint_id;

    -- Step 4: If not, copy shared questions into player_checkpoint_questions
    if v_questions_count = 0 then
      insert into player_checkpoint_questions (player_id, checkpoint_id, question_id)
      select v_player.id, v_checkpoint_id, cq.question_id
      from checkpoint_questions cq
      where cq.session_id = v_player.session_id and cq.checkpoint_id = v_checkpoint_id;
    end if;

  end if;

  -- Build response state
  return json_build_object(
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
end;
$$;


-- 2. Answer Submission function (Verifies and writes answers securely)
create or replace function submit_checkpoint_answers(
  p_token text,
  p_checkpoint_id uuid,
  p_answers jsonb -- Array of {question_id: uuid, answer: text}
)
returns json
language plpgsql
security definer
as $$
declare
  v_player record;
  v_session record;
  v_answer_item jsonb;
  v_q_id uuid;
  v_q_ans text;
  v_correct_ans text;
  v_is_correct boolean;
  v_correct_count integer := 0;
  v_total_count integer := 0;
  v_next_checkpoint uuid;
  v_route_order integer;
begin
  -- Authenticate player via token
  select p.*, t.session_id into v_player
  from players p
  join teams t on p.team_id = t.id
  where p.access_token = p_token;

  if not found then
    return json_build_object('success', false, 'error', 'Invalid access token');
  end if;

  -- Check session state and time limits
  select * into v_session from sessions where id = v_player.session_id;
  if v_session.status != 'active' then
    return json_build_object('success', false, 'error', 'Game is not active');
  end if;

  if v_session.started_at is not null and 
     extract(epoch from (now() - v_session.started_at)) > (v_session.duration * 60) then
    return json_build_object('success', false, 'error', 'Game time has expired');
  end if;

  -- Validate checkpoint matches player's current checkpoint
  if v_player.current_checkpoint != p_checkpoint_id then
    return json_build_object('success', false, 'error', 'Checkpoint mismatch');
  end if;

  -- Process and verify answers
  for v_answer_item in select * from jsonb_array_elements(p_answers) loop
    v_q_id := (v_answer_item->>'question_id')::uuid;
    v_q_ans := trim(v_answer_item->>'submitted_answer');
    
    -- Verify question belongs to assigned ones
    if not exists (
      select 1 from player_checkpoint_questions 
      where player_id = v_player.id and checkpoint_id = p_checkpoint_id and question_id = v_q_id
    ) then
      continue;
    end if;

    -- Fetch correct answer
    select answer into v_correct_ans from questions where id = v_q_id;
    
    -- Grade answer (case-insensitive for text inputs)
    if lower(trim(v_correct_ans)) = lower(v_q_ans) then
      v_is_correct := true;
      v_correct_count := v_correct_count + 1;
    else
      v_is_correct := false;
    end if;

    v_total_count := v_total_count + 1;

    -- Insert answer record (ignore duplicates)
    insert into player_answers (player_id, checkpoint_id, question_id, submitted_answer, is_correct)
    values (v_player.id, p_checkpoint_id, v_q_id, v_q_ans, v_is_correct)
    on conflict (player_id, checkpoint_id, question_id) do nothing;
  end loop;

  -- Mark checkpoint as completed in the player route
  update player_routes 
  set is_completed = true, completed_at = now() 
  where player_id = v_player.id and checkpoint_id = p_checkpoint_id;

  -- Determine next checkpoint in player route
  select route_order into v_route_order
  from player_routes
  where player_id = v_player.id and checkpoint_id = p_checkpoint_id;

  select checkpoint_id into v_next_checkpoint
  from player_routes
  where player_id = v_player.id and route_order = v_route_order + 1;

  -- Update current checkpoint in player record
  update players 
  set current_checkpoint = v_next_checkpoint 
  where id = v_player.id;

  return json_build_object(
    'success', true, 
    'correct', v_correct_count, 
    'total', v_total_count, 
    'next_checkpoint_id', v_next_checkpoint
  );
end;
$$;


-- --- ROW LEVEL SECURITY (RLS) POLICIES ---

-- Enable RLS on all tables
alter table sessions enable row level security;
alter table teams enable row level security;
alter table checkpoints enable row level security;
alter table players enable row level security;
alter table questions enable row level security;
alter table player_routes enable row level security;
alter table player_answers enable row level security;
alter table player_checkpoint_questions enable row level security;
alter table checkpoint_questions enable row level security;

-- Admin Policies (All tables CRUD if authenticated)
create policy admin_all_sessions on sessions for all to authenticated using (true) with check (true);
create policy admin_all_teams on teams for all to authenticated using (true) with check (true);
create policy admin_all_checkpoints on checkpoints for all to authenticated using (true) with check (true);
create policy admin_all_players on players for all to authenticated using (true) with check (true);
create policy admin_all_questions on questions for all to authenticated using (true) with check (true);
create policy admin_all_player_routes on player_routes for all to authenticated using (true) with check (true);
create policy admin_all_player_answers on player_answers for all to authenticated using (true) with check (true);
create policy admin_all_checkpoint_questions on player_checkpoint_questions for all to authenticated using (true) with check (true);
create policy admin_all_checkpoint_questions_shared on checkpoint_questions for all to authenticated using (true) with check (true);

-- Public / Anonymous Policies
-- 1. Sessions: Anonymous can read draft / active / completed sessions
create policy anon_read_sessions on sessions for select to anon 
  using (status in ('draft', 'active', 'completed'));

-- 2. Teams: Anonymous can read teams
create policy anon_read_teams on teams for select to anon using (true);

-- 3. Checkpoints: Anonymous can read checkpoints of draft/active/completed sessions
create policy anon_read_checkpoints on checkpoints for select to anon 
  using (session_id in (select id from sessions where status in ('draft', 'active', 'completed')));

-- 4. Players: Anonymous can read player entries of draft/active/completed sessions
create policy anon_read_players on players for select to anon 
  using (session_id in (select id from sessions where status in ('draft', 'active', 'completed')));

-- 4b. Players: Anonymous can insert player entries for self-registration
create policy anon_insert_players on players for insert to anon with check (true);

-- 5. Player Routes: Anonymous can read route entries
create policy anon_read_player_routes on player_routes for select to anon using (true);

-- 6. Player Answers: Anonymous can read answers (used for calculating live scoreboard)
create policy anon_read_player_answers on player_answers for select to anon using (true);

-- 7. Assigned Questions: Anonymous can read assigned questions metadata
create policy anon_read_checkpoint_questions on player_checkpoint_questions for select to anon using (true);

-- 8. Shared Checkpoint Questions: Anonymous can read
create policy anon_read_checkpoint_questions_shared on checkpoint_questions for select to anon using (true);

-- --- INDEXES FOR PERFORMANCE ---
create index idx_teams_session_id on teams(session_id);
create index idx_checkpoints_session_id on checkpoints(session_id);
create index idx_players_team_id on players(team_id);
create index idx_player_routes_player_id on player_routes(player_id);
create index idx_player_answers_player_id on player_answers(player_id);
create index idx_checkpoint_questions_player_id on player_checkpoint_questions(player_id);
create index idx_checkpoint_questions_session_checkpoint on checkpoint_questions(session_id, checkpoint_id);
