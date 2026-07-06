// Spectator Leaderboard Realtime Module
import { supabase } from '../config.js';
import { showToast, formatTime } from '../utils.js';

let selectedSessionId = null;
let realtimeChannel = null;
let sessionCheckerChannel = null;

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', async () => {
  // Prevent player access to leaderboard
  const existingToken = localStorage.getItem('quest_player_token');
  if (existingToken) {
    window.location.replace(`play.html?token=${existingToken}`);
    return;
  }

  setupUIHandlers();
  await loadSessionsList();
});

// Setup dropdown selectors
function setupUIHandlers() {
  const select = document.getElementById('leaderboard-session-select');
  select.addEventListener('change', () => {
    selectedSessionId = select.value;
    if (selectedSessionId) {
      // Update URL query parameters
      const url = new URL(window.location);
      url.searchParams.set('session', selectedSessionId);
      window.history.pushState({}, '', url);

      initializeLeaderboard();
    }
  });
}

// Load sessions into the select dropdown
async function loadSessionsList() {
  const select = document.getElementById('leaderboard-session-select');
  select.innerHTML = '<option value="">Loading sessions...</option>';

  try {
    const { data, error } = await supabase
      .from('sessions')
      .select('id, title, status')
      .in('status', ['active', 'completed'])
      .order('created_at', { ascending: false });

    if (error) throw error;

    select.innerHTML = '';
    
    if (!data || data.length === 0) {
      select.innerHTML = '<option value="">No active sessions found</option>';
      return;
    }

    data.forEach(sess => {
      const opt = document.createElement('option');
      opt.value = sess.id;
      opt.text = `${sess.title} (${sess.status.toUpperCase()})`;
      select.appendChild(opt);
    });

    // Check URL parameters for starting session
    const params = new URLSearchParams(window.location.search);
    const urlSessId = params.get('session');

    if (urlSessId && data.find(s => s.id === urlSessId)) {
      selectedSessionId = urlSessId;
      select.value = urlSessId;
    } else {
      // Default to the first session (usually the most recent active one)
      selectedSessionId = data[0].id;
      select.value = data[0].id;
    }

    initializeLeaderboard();
  } catch (err) {
    console.error('Error loading sessions roster:', err);
    select.innerHTML = '<option value="">Error loading sessions</option>';
  }
}

// Start leaderboard loops
async function initializeLeaderboard() {
  // Clear previous subscriptions
  if (realtimeChannel) {
    supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
  if (sessionCheckerChannel) {
    supabase.removeChannel(sessionCheckerChannel);
    sessionCheckerChannel = null;
  }

  await fetchAndRenderStandings();
  setupRealtimeListeners();
}

// Fetch telemetry ranks
async function fetchAndRenderStandings() {
  if (!selectedSessionId) return;

  try {
    // 1. Fetch standings view
    const { data: standings, error: standErr } = await supabase
      .from('leaderboard_view')
      .select('*')
      .eq('session_id', selectedSessionId);

    if (standErr) throw standErr;

    // 2. Fetch session details (to check status)
    const { data: session, error: sessErr } = await supabase
      .from('sessions')
      .select('*')
      .eq('id', selectedSessionId)
      .single();

    if (sessErr) throw sessErr;

    // Sort: 1. Highest Score, 2. Shortest elapsed time
    const sorted = (standings || []).sort((a, b) => {
      if (b.total_score !== a.total_score) {
        return b.total_score - a.total_score;
      }
      return a.elapsed_seconds - b.elapsed_seconds;
    });

    // Update Status Badge UI
    const badge = document.getElementById('leaderboard-status-badge');
    if (session.status === 'completed') {
      badge.className = 'badge badge--danger';
      badge.innerText = 'SESSION COMPLETED';
    } else {
      badge.className = 'badge badge--success';
      badge.innerText = 'LIVE TRACKING';
    }

    // Render podium elements
    renderPodium(sorted);

    // Render complete roster table
    renderRosterTable(sorted);
  } catch (err) {
    console.error('Error rendering standings:', err);
  }
}

// Render podium columns
function renderPodium(sorted) {
  const gold = document.getElementById('podium-gold');
  const silver = document.getElementById('podium-silver');
  const bronze = document.getElementById('podium-bronze');

  // Clear previous displays
  gold.style.display = 'none';
  silver.style.display = 'none';
  bronze.style.display = 'none';

  if (sorted.length > 0) {
    // 1st Place
    gold.style.display = 'flex';
    gold.querySelector('.podium-team-name').innerText = sorted[0].team_name;
    gold.querySelector('.podium-stats').innerText = `${sorted[0].total_score} pts // ${sorted[0].checkpoints_completed} CPs`;
  }

  if (sorted.length > 1) {
    // 2nd Place
    silver.style.display = 'flex';
    silver.querySelector('.podium-team-name').innerText = sorted[1].team_name;
    silver.querySelector('.podium-stats').innerText = `${sorted[1].total_score} pts // ${sorted[1].checkpoints_completed} CPs`;
  }

  if (sorted.length > 2) {
    // 3rd Place
    bronze.style.display = 'flex';
    bronze.querySelector('.podium-team-name').innerText = sorted[2].team_name;
    bronze.querySelector('.podium-stats').innerText = `${sorted[2].total_score} pts // ${sorted[2].checkpoints_completed} CPs`;
  }
}

// Render full roster table
function renderRosterTable(sorted) {
  const tbody = document.getElementById('leaderboard-table-body');
  tbody.innerHTML = '';

  if (sorted.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted">No telemetry received</td></tr>`;
    return;
  }

  // Slice off the podium or show everyone (let's display everyone so it's a complete record)
  sorted.forEach((row, idx) => {
    const tr = document.createElement('tr');
    
    let rankText = `#${idx + 1}`;
    if (idx === 0) rankText = '🥇 #1';
    if (idx === 1) rankText = '🥈 #2';
    if (idx === 2) rankText = '🥉 #3';

    tr.innerHTML = `
      <td class="font-mono" style="font-weight:700; color:var(--color-warning);">${rankText}</td>
      <td style="font-weight:600; font-family:var(--font-title);">${row.team_name}</td>
      <td class="font-mono text-accent" style="font-weight:700;">${row.total_score} points</td>
      <td class="font-mono text-secondary">${row.checkpoints_completed} completed</td>
      <td class="font-mono text-muted">${formatTime(row.elapsed_seconds)}</td>
    `;
    
    tbody.appendChild(tr);
  });
}

// Listen to Realtime Postgres modifications
function setupRealtimeListeners() {
  if (!selectedSessionId) return;

  // 1. Subscribe to answers submission event
  realtimeChannel = supabase
    .channel('leaderboard-standings')
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'player_answers'
    }, async (payload) => {
      console.log('Roster update payload:', payload);
      await fetchAndRenderStandings();
    })
    .subscribe();

  // 2. Subscribe to session changes (to watch completion event)
  sessionCheckerChannel = supabase
    .channel('leaderboard-session-state')
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'sessions',
      filter: `id=eq.${selectedSessionId}`
    }, async (payload) => {
      console.log('Session state update:', payload.new);
      if (payload.new.status === 'completed') {
        showToast('GAME COMPLETED // FINAL RANKS ANNOUNCED', 'accent');
        
        // Confetti celebration!
        if (typeof confetti !== 'undefined') {
          let duration = 5 * 1000;
          let end = Date.now() + duration;

          (function frame() {
            confetti({ particleCount: 4, angle: 60, spread: 55, origin: { x: 0 } });
            confetti({ particleCount: 4, angle: 120, spread: 55, origin: { x: 1 } });

            if (Date.now() < end) {
              requestAnimationFrame(frame);
            }
          }());
        }
      }
      await fetchAndRenderStandings();
    })
    .subscribe();
}
