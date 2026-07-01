// Dashboard Admin Module
import { supabase } from '../config.js';
import { showToast, formatTime } from '../utils.js';
import { state, checkActiveSession } from './admin.js';

let timerInterval = null;
let realtimeChannels = [];

export async function initDashboard() {
  // Listen for tab reload
  document.addEventListener('tab-reload-dashboard', refreshDashboard);

  // Initial load
  await refreshDashboard();
}

// Shut down dashboard listeners and timers
export function shutdownDashboard() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  
  realtimeChannels.forEach(channel => {
    supabase.removeChannel(channel);
  });
  realtimeChannels = [];
}

// Full Dashboard Refresh
async function refreshDashboard() {
  shutdownDashboard();

  await checkActiveSession();

  if (!state.activeSession) {
    renderEmptyState();
    return;
  }

  // Fetch initial stats and setup trackers
  await loadInitialTelemetry();
  setupRealtimeSubscriptions();
  startTimer();
}

// Render fallback UI when no session is active
function renderEmptyState() {
  document.getElementById('dash-timer').innerText = '00:00:00';
  document.getElementById('dash-players-count').innerText = '0 / 0';
  document.getElementById('dash-answers-count').innerText = '0 / 0';
  document.getElementById('dash-rankings-table').innerHTML = 
    `<tr><td colspan="4" class="text-center text-muted">No sessions active</td></tr>`;
  document.getElementById('dash-players-table').innerHTML = 
    `<tr><td colspan="4" class="text-center text-muted">No telemetry received</td></tr>`;
}

// Fetch starting state of active session
async function loadInitialTelemetry() {
  const sessId = state.activeSession.id;

  try {
    // 1. Load all players in the session directly
    const { data: players, error: playerErr } = await supabase
      .from('players')
      .select(`
        id,
        player_name,
        team_id,
        current_checkpoint,
        player_answers (is_correct)
      `)
      .eq('session_id', sessId);

    if (playerErr) throw playerErr;

    // 2. Load all teams in the session
    const { data: teams, error: teamErr } = await supabase
      .from('teams')
      .select('id, team_name')
      .eq('session_id', sessId);

    if (teamErr) throw teamErr;

    // Load checkpoint data to map current checkpoint IDs to names
    const { data: cps } = await supabase
      .from('checkpoints')
      .select('id, checkpoint_name')
      .eq('session_id', sessId);
    
    const checkpointMap = {};
    if (cps) {
      cps.forEach(c => { checkpointMap[c.id] = c.checkpoint_name; });
    }

    // 3. Query all submitted answers for this session's players
    const playerIds = players ? players.map(p => p.id) : [];
    let answers = [];
    if (playerIds.length > 0) {
      const { data: answersData, error: ansErr } = await supabase
        .from('player_answers')
        .select('id, is_correct, player_id, checkpoint_id')
        .in('player_id', playerIds);
      if (ansErr) throw ansErr;
      answers = answersData || [];
    }

    // Process statistics
    const totalAnswers = answers.length;
    const correctAnswers = answers.filter(a => a.is_correct).length;

    const totalTeams = teams ? teams.length : 0;
    const totalPlayers = players ? players.length : 0;

    // Update Telemetry Header Metrics
    document.getElementById('dash-players-count').innerText = `${totalPlayers} / ${totalTeams}`;
    document.getElementById('dash-answers-count').innerText = `${correctAnswers} / ${totalAnswers}`;

    // Render tables
    renderPlayerTracker(players || [], teams || [], checkpointMap);
    await fetchAndRenderRankings();
  } catch (err) {
    console.error('Error fetching initial telemetry:', err);
  }
}

// Render Player tracker list
function renderPlayerTracker(players, teams, checkpointMap) {
  const tbody = document.getElementById('dash-players-table');
  tbody.innerHTML = '';

  if (players.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">No players enrolled in this session</td></tr>`;
    return;
  }

  players.forEach(p => {
    const team = p.team_id ? teams.find(t => t.id === p.team_id) : null;
    const teamName = team ? team.team_name : 'Unassigned';

    // Calculate score
    const score = p.player_answers ? p.player_answers.filter(a => a.is_correct).length : 0;

    // Find current checkpoint name
    const cpName = checkpointMap[p.current_checkpoint] || 'Waiting/Not Scanned';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-weight:600;">${p.player_name}</td>
      <td class="text-muted">${teamName}</td>
      <td class="font-mono text-secondary" style="font-size:0.8rem;">${cpName}</td>
      <td class="font-mono text-primary" style="font-weight:700;">${score} pts</td>
    `;
    tbody.appendChild(tr);
  });
}

// Fetch ranked teams list
async function fetchAndRenderRankings() {
  if (!state.activeSession) return;
  const sessId = state.activeSession.id;

  try {
    const { data, error } = await supabase
      .from('leaderboard_view')
      .select('*')
      .eq('session_id', sessId);

    if (error) throw error;

    // Sort: 1. Highest Score, 2. Shortest elapsed time
    const sorted = (data || []).sort((a, b) => {
      if (b.total_score !== a.total_score) {
        return b.total_score - a.total_score;
      }
      return a.elapsed_seconds - b.elapsed_seconds;
    });

    const tbody = document.getElementById('dash-rankings-table');
    tbody.innerHTML = '';

    if (sorted.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">No scores recorded yet</td></tr>`;
      return;
    }

    sorted.forEach((row, idx) => {
      const tr = document.createElement('tr');
      
      let rankText = `#${idx + 1}`;
      if (idx === 0) rankText = '🥇 #1';
      if (idx === 1) rankText = '🥈 #2';
      if (idx === 2) rankText = '🥉 #3';

      tr.innerHTML = `
        <td class="font-mono" style="font-weight:700; color:var(--color-warning);">${rankText}</td>
        <td style="font-weight:600;">${row.team_name}</td>
        <td class="font-mono text-accent">${row.total_score} correct</td>
        <td class="font-mono text-secondary">${row.checkpoints_completed} CPs</td>
      `;

      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Error rendering standings:', err);
  }
}

// Subscribe to Live Realtime updates on tables
function setupRealtimeSubscriptions() {
  const sessId = state.activeSession.id;

  // Listen to answers and route updates
  const answersChannel = supabase
    .channel('dashboard-answers')
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'player_answers'
    }, async (payload) => {
      console.log('Realtime answer update:', payload);
      // Reload stats and standings
      await loadInitialTelemetry();
    })
    .subscribe();

  const playersChannel = supabase
    .channel('dashboard-players')
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'players'
    }, async (payload) => {
      console.log('Realtime player update:', payload);
      await loadInitialTelemetry();
    })
    .subscribe();

  realtimeChannels.push(answersChannel, playersChannel);
}

// Timer Countdown Loop
function startTimer() {
  if (timerInterval) clearInterval(timerInterval);

  const startedAt = new Date(state.activeSession.started_at);
  const durationSec = state.activeSession.duration * 60;
  const timerLabel = document.getElementById('dash-timer');

  timerInterval = setInterval(async () => {
    const elapsed = Math.floor((new Date() - startedAt) / 1000);
    const remaining = durationSec - elapsed;

    if (remaining <= 0) {
      clearInterval(timerInterval);
      timerLabel.innerText = '00:00:00';
      timerLabel.className = 'font-mono text-accent';
      showToast('Game session timer has expired!', 'warning');
      
      // Auto-end the session in state
      await checkActiveSession();
      await loadInitialTelemetry();
    } else {
      timerLabel.innerText = formatTime(remaining);
    }
  }, 1000);
}
