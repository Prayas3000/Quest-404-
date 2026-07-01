// Routes Admin Module
import { supabase } from '../config.js';
import { showToast } from '../utils.js';
import { state } from './admin.js';

export function initRoutes() {
  const sessionSelect = document.getElementById('route-session-select');
  const btnGenerate = document.getElementById('btn-generate-routes');
  const playerSelect = document.getElementById('route-player-select');
  const btnSaveRoute = document.getElementById('btn-save-route');

  // Session selection change handler
  sessionSelect.addEventListener('change', async () => {
    const sessionId = sessionSelect.value;
    if (sessionId) {
      btnGenerate.removeAttribute('disabled');
      await loadRouteData(sessionId);
    } else {
      btnGenerate.setAttribute('disabled', 'true');
      document.getElementById('route-matrix-container').innerHTML = 
        `<p class="text-muted text-center" style="padding: 2rem 0;">Select a session to configure routes</p>`;
      document.getElementById('manual-route-card').style.display = 'none';
    }
  });

  // Auto-generate routes button handler
  btnGenerate.addEventListener('click', generateAllRoutes);

  // Player selection change handler (for manual config)
  playerSelect.addEventListener('change', renderManualRouteSorter);

  // Commit route buttons
  btnSaveRoute.addEventListener('click', saveManualRoute);

  // Tab reload event
  document.addEventListener('tab-reload-routes', () => {
    if (sessionSelect.value) {
      loadRouteData(sessionSelect.value);
    }
  });
}

let sessionPlayers = [];
let sessionCheckpoints = [];
let routeMatrix = {};

// Load session players, checkpoints, and existing routes
async function loadRouteData(sessionId) {
  try {
    // 1. Fetch checkpoints
    const { data: cps, error: cpErr } = await supabase
      .from('checkpoints')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });

    if (cpErr) throw cpErr;
    sessionCheckpoints = cps || [];

    // 2. Fetch players in session (via session_id, ensuring they have a team)
    const { data: players, error: playerErr } = await supabase
      .from('players')
      .select(`
        id,
        player_name,
        team_id,
        teams (
          id,
          team_name
        )
      `)
      .eq('session_id', sessionId)
      .not('team_id', 'is', null)
      .order('player_name', { ascending: true });

    if (playerErr) throw playerErr;
    sessionPlayers = players || [];

    // 3. Fetch existing route mappings
    const playerIds = sessionPlayers.map(p => p.id);
    let routes = [];
    
    if (playerIds.length > 0) {
      const { data: routeData, error: routeErr } = await supabase
        .from('player_routes')
        .select('*')
        .in('player_id', playerIds)
        .order('route_order', { ascending: true });

      if (routeErr) throw routeErr;
      routes = routeData || [];
    }

    // Build route matrix index
    routeMatrix = {};
    sessionPlayers.forEach(p => {
      routeMatrix[p.id] = routes.filter(r => r.player_id === p.id);
    });

    renderRouteMatrix();
    populatePlayerSelect();
  } catch (err) {
    console.error('Error loading route data:', err);
    showToast('Failed to load route configuration', 'error');
  }
}

// Render Route Matrix Table
function renderRouteMatrix() {
  const container = document.getElementById('route-matrix-container');
  
  if (sessionPlayers.length === 0) {
    container.innerHTML = `<p class="text-muted text-center" style="padding: 2rem 0;">No enrolled players found in this session roster.</p>`;
    return;
  }

  let html = `
    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>Player (Team)</th>
            <th>Checkpoint Route Path</th>
          </tr>
        </thead>
        <tbody>
  `;

  sessionPlayers.forEach(player => {
    const playerRoutes = routeMatrix[player.id] || [];
    let pathText = '<span class="text-accent">NO ROUTE ASSIGNED</span>';
    
    if (playerRoutes.length > 0) {
      pathText = playerRoutes.map(pr => {
        const cp = sessionCheckpoints.find(c => c.id === pr.checkpoint_id);
        const name = cp ? cp.checkpoint_name : 'Unknown';
        return `<span class="badge ${pr.is_completed ? 'badge--success' : 'badge--info'}" style="font-size:0.7rem; margin-right: 5px;">${pr.route_order}. ${name}</span>`;
      }).join(' → ');
    }

    html += `
      <tr>
        <td style="font-weight:600;">${player.player_name} <span class="text-muted font-mono" style="font-size:0.75rem;">(${player.teams.team_name})</span></td>
        <td><div style="display:flex; flex-wrap:wrap; align-items:center; gap:5px;">${pathText}</div></td>
      </tr>
    `;
  });

  html += `
        </tbody>
      </table>
    </div>
  `;

  container.innerHTML = html;
}

// Populate the Player select drop-down for manual configs
function populatePlayerSelect() {
  const select = document.getElementById('route-player-select');
  select.innerHTML = '<option value="">Choose Player...</option>';

  sessionPlayers.forEach(player => {
    const opt = document.createElement('option');
    opt.value = player.id;
    opt.text = `${player.player_name} (${player.teams.team_name})`;
    select.appendChild(opt);
  });

  // Reset Sorter display
  document.getElementById('manual-route-sorter').innerHTML = '';
  document.getElementById('manual-route-card').style.display = 'block';
}

// Shuffle helper
function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Generate random route orders for all players
async function generateAllRoutes() {
  if (sessionCheckpoints.length === 0) {
    showToast('Cannot generate routes: Create checkpoints first.', 'error');
    return;
  }
  if (sessionPlayers.length === 0) {
    showToast('Cannot generate routes: Enroll players first.', 'error');
    return;
  }

  if (!confirm('Re-generate routes for all players? This will overwrite existing assignments.')) {
    return;
  }

  showToast('Generating randomized checkpoint routes...', 'info');

  try {
    const payload = [];

    // For each player, generate a random order of checkpoints
    sessionPlayers.forEach(player => {
      const shuffled = shuffleArray(sessionCheckpoints);
      shuffled.forEach((cp, index) => {
        payload.push({
          player_id: player.id,
          checkpoint_id: cp.id,
          route_order: index + 1,
          is_completed: false
        });
      });
    });

    // 1. Purge existing routes for session players
    const playerIds = sessionPlayers.map(p => p.id);
    const { error: deleteErr } = await supabase
      .from('player_routes')
      .delete()
      .in('player_id', playerIds);

    if (deleteErr) throw deleteErr;

    // 2. Insert new route records
    const { error: insertErr } = await supabase
      .from('player_routes')
      .insert(payload);

    if (insertErr) throw insertErr;

    showToast('Random routes calculated and saved!', 'success');
    loadRouteData(document.getElementById('route-session-select').value);
  } catch (err) {
    console.error('Error generating routes:', err);
    showToast('Failed to generate routes', 'error');
  }
}

// Render manual reordering editor
let localRouteItems = [];
function renderManualRouteSorter() {
  const playerId = document.getElementById('route-player-select').value;
  const container = document.getElementById('manual-route-sorter');
  container.innerHTML = '';

  if (!playerId) return;

  const currentRoutes = routeMatrix[playerId] || [];
  
  // If no routes assigned, initialize with checkpoints ordered by creation
  if (currentRoutes.length === 0) {
    localRouteItems = sessionCheckpoints.map((cp, idx) => ({
      checkpoint_id: cp.id,
      checkpoint_name: cp.checkpoint_name,
      route_order: idx + 1
    }));
  } else {
    localRouteItems = currentRoutes.map(cr => {
      const cp = sessionCheckpoints.find(c => c.id === cr.checkpoint_id);
      return {
        checkpoint_id: cr.checkpoint_id,
        checkpoint_name: cp ? cp.checkpoint_name : 'Unknown',
        route_order: cr.route_order
      };
    }).sort((a, b) => a.route_order - b.route_order);
  }

  renderSorterUI();
}

// Render manual sorter rows with move buttons
function renderSorterUI() {
  const container = document.getElementById('manual-route-sorter');
  container.innerHTML = '';

  localRouteItems.forEach((item, index) => {
    const div = document.createElement('div');
    div.className = 'route-item';
    div.innerHTML = `
      <span class="route-num">${index + 1}</span>
      <span style="font-weight:600; flex-grow:1; margin-left: 1rem;">${item.checkpoint_name}</span>
      <div class="flex" style="gap: 5px;">
        <button type="button" class="btn btn--outline btn--sm btn-up" data-index="${index}" ${index === 0 ? 'disabled' : ''}>▲</button>
        <button type="button" class="btn btn--outline btn--sm btn-down" data-index="${index}" ${index === localRouteItems.length - 1 ? 'disabled' : ''}>▼</button>
      </div>
    `;

    container.appendChild(div);
  });

  // Attach button triggers
  container.querySelectorAll('.btn-up').forEach(btn => {
    btn.addEventListener('click', () => swapItems(parseInt(btn.getAttribute('data-index'), 10), -1));
  });
  container.querySelectorAll('.btn-down').forEach(btn => {
    btn.addEventListener('click', () => swapItems(parseInt(btn.getAttribute('data-index'), 10), 1));
  });
}

// Swap items for manual sorting
function swapItems(index, direction) {
  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= localRouteItems.length) return;

  const temp = localRouteItems[index];
  localRouteItems[index] = localRouteItems[targetIndex];
  localRouteItems[targetIndex] = temp;

  renderSorterUI();
}

// Commit manual route sorting to DB
async function saveManualRoute() {
  const playerId = document.getElementById('route-player-select').value;
  if (!playerId) {
    showToast('Select a player first', 'error');
    return;
  }

  const payload = localRouteItems.map((item, index) => ({
    player_id: playerId,
    checkpoint_id: item.checkpoint_id,
    route_order: index + 1,
    is_completed: false
  }));

  try {
    // Delete existing
    const { error: delErr } = await supabase
      .from('player_routes')
      .delete()
      .eq('player_id', playerId);

    if (delErr) throw delErr;

    // Insert new
    const { error: insErr } = await supabase
      .from('player_routes')
      .insert(payload);

    if (insErr) throw insErr;

    showToast('Manual route sequence committed!', 'success');
    loadRouteData(document.getElementById('route-session-select').value);
  } catch (err) {
    console.error('Error saving manual route:', err);
    showToast('Failed to save manual route sequence', 'error');
  }
}
