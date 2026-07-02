// Players Admin Module
import { supabase } from '../config.js';
import { showToast, generateToken, copyToClipboard } from '../utils.js';
import { state } from './admin.js';

let sessionTeams = []; // Keep track of current session's teams for dropdowns

export function initPlayers() {
  const sessionSelect = document.getElementById('player-session-select');
  const teamSelect = document.getElementById('player-team-select');
  const btnAdd = document.getElementById('btn-add-player');
  const btnAutoDistribute = document.getElementById('btn-auto-distribute');

  // Session selection change handler
  sessionSelect.addEventListener('change', async () => {
    const sessionId = sessionSelect.value;
    if (sessionId) {
      teamSelect.removeAttribute('disabled');
      btnAutoDistribute.removeAttribute('disabled');
      btnAdd.removeAttribute('disabled');
      // Load teams for session
      await loadTeamsForSelect(sessionId);
      loadPlayers();
    } else {
      teamSelect.setAttribute('disabled', 'true');
      btnAutoDistribute.setAttribute('disabled', 'true');
      btnAdd.setAttribute('disabled', 'true');
      teamSelect.innerHTML = '<option value="">All Teams / Load Session First...</option>';
      document.getElementById('players-table-body').innerHTML = 
        `<tr><td colspan="4" class="text-center text-muted">Select a session to load player list</td></tr>`;
      document.getElementById('unassigned-players-card').style.display = 'none';
    }
  });

  // Team selection filter change handler
  teamSelect.addEventListener('change', () => {
    loadPlayers();
  });

  // Auto-distribute button handler
  btnAutoDistribute.addEventListener('click', handleAutoDistribution);

  // Add Player Modal trigger
  btnAdd.addEventListener('click', () => {
    document.getElementById('form-player').reset();
    document.getElementById('player-id-input').value = '';
    openModal('modal-player');
  });

  // Form submit handler
  document.getElementById('form-player').addEventListener('submit', handleSavePlayer);

  // Tab reload event
  document.addEventListener('tab-reload-players', () => {
    loadPlayers();
  });
}

// Load teams into selector
async function loadTeamsForSelect(sessionId) {
  try {
    const { data, error } = await supabase
      .from('teams')
      .select('*')
      .eq('session_id', sessionId)
      .order('team_name', { ascending: true });

    if (error) throw error;

    sessionTeams = data || [];

    const teamSelect = document.getElementById('player-team-select');
    teamSelect.innerHTML = '<option value="">All Teams (Show All Assigned)</option>';
    sessionTeams.forEach(team => {
      const opt = document.createElement('option');
      opt.value = team.id;
      opt.text = team.team_name;
      teamSelect.appendChild(opt);
    });
  } catch (err) {
    console.error('Error loading session teams:', err);
  }
}

// Load players (both assigned and unassigned)
async function loadPlayers() {
  const sessionId = document.getElementById('player-session-select').value;
  const teamSelectId = document.getElementById('player-team-select').value;

  if (!sessionId) return;

  try {
    // 1. Load Unassigned Players (always load for the session if no team filter or regardless)
    const { data: unassignedData, error: unassignedErr } = await supabase
      .from('players')
      .select('*')
      .eq('session_id', sessionId)
      .is('team_id', null)
      .order('player_name', { ascending: true });

    if (unassignedErr) throw unassignedErr;
    renderUnassignedPlayers(unassignedData || []);

    // 2. Load Assigned Players
    let query = supabase
      .from('players')
      .select(`
        *,
        teams!inner (
          id,
          team_name,
          session_id
        )
      `)
      .eq('session_id', sessionId)
      .not('team_id', 'is', null)
      .order('player_name', { ascending: true });

    if (teamSelectId) {
      query = query.eq('team_id', teamSelectId);
    }

    const { data: assignedData, error: assignedErr } = await query;
    if (assignedErr) throw assignedErr;

    state.players = assignedData || [];
    renderAssignedPlayers();
  } catch (err) {
    console.error('Error loading players:', err);
    showToast('Failed to load players', 'error');
  }
}

// Render Unassigned Players panel
function renderUnassignedPlayers(playersList) {
  const container = document.getElementById('unassigned-players-card');
  const tbody = document.getElementById('unassigned-players-table-body');
  
  if (playersList.length === 0) {
    container.style.display = 'none';
    tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">No pending player registrations</td></tr>`;
    return;
  }

  container.style.display = 'block';
  tbody.innerHTML = '';

  playersList.forEach(player => {
    const tr = document.createElement('tr');
    
    // Build select dropdown option list of teams
    let optionsHtml = '<option value="">Select Team...</option>';
    sessionTeams.forEach(team => {
      optionsHtml += `<option value="${team.id}">${team.team_name}</option>`;
    });

    const dateStr = new Date(player.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    tr.innerHTML = `
      <td style="font-weight:600;">${player.player_name}</td>
      <td class="font-mono" style="font-size:0.8rem;">${dateStr}</td>
      <td>
        <select class="select font-mono team-assign-select" style="padding:0.25rem 0.5rem; font-size:0.8rem; width:180px;">
          ${optionsHtml}
        </select>
      </td>
      <td>
        <div class="flex" style="gap: 5px;">
          <button class="btn btn--primary btn--sm action-assign" data-id="${player.id}">PLACE</button>
          <button class="btn btn--outline btn--sm action-delete text-accent" data-id="${player.id}">DEL</button>
        </div>
      </td>
    `;

    tbody.appendChild(tr);
  });

  // Attach listeners for unassigned table
  tbody.querySelectorAll('.action-assign').forEach(btn => {
    btn.addEventListener('click', async () => {
      const playerId = btn.getAttribute('data-id');
      const selectEl = btn.closest('tr').querySelector('.team-assign-select');
      const teamId = selectEl.value;

      if (!teamId) {
        showToast('Choose a destination team first', 'warning');
        return;
      }

      await assignPlayerToTeam(playerId, teamId);
    });
  });

  tbody.querySelectorAll('.action-delete').forEach(btn => {
    btn.addEventListener('click', () => deletePlayer(btn.getAttribute('data-id')));
  });
}

// Render Assigned Players directory
function renderAssignedPlayers() {
  const tbody = document.getElementById('players-table-body');
  tbody.innerHTML = '';

  if (state.players.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">No assigned players found</td></tr>`;
    return;
  }

  state.players.forEach(player => {
    const tr = document.createElement('tr');
    const link = getPlayerLink(player.access_token);

    tr.innerHTML = `
      <td style="font-weight:600;">${player.player_name}</td>
      <td><span class="badge badge--success">${player.teams.team_name}</span></td>
      <td>
        <div class="flex align-center" style="gap: 5px;">
          <input type="text" class="input font-mono" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; width: 220px;" value="${link}" readonly>
          <button class="btn btn--secondary btn--sm action-copy" data-link="${link}">COPY</button>
        </div>
      </td>
      <td>
        <div class="flex" style="gap: 5px;">
          <button class="btn btn--primary btn--sm action-qr" data-token="${player.access_token}" data-name="${player.player_name}">QR</button>
          <button class="btn btn--outline btn--sm action-delete text-accent" data-id="${player.id}">DEL</button>
        </div>
      </td>
    `;

    tbody.appendChild(tr);
  });

  // Attach event listeners
  tbody.querySelectorAll('.action-copy').forEach(btn => {
    btn.addEventListener('click', () => {
      copyToClipboard(btn.getAttribute('data-link'), 'Player link copied!');
    });
  });
  tbody.querySelectorAll('.action-qr').forEach(btn => {
    btn.addEventListener('click', () => {
      showPlayerQR(btn.getAttribute('data-token'), btn.getAttribute('data-name'));
    });
  });
  tbody.querySelectorAll('.action-delete').forEach(btn => {
    btn.addEventListener('click', () => deletePlayer(btn.getAttribute('data-id')));
  });
}

// Service function to update player's team in Supabase
async function assignPlayerToTeam(playerId, teamId) {
  try {
    // Get the player's name to check for duplicates
    const { data: player, error: playerErr } = await supabase
      .from('players')
      .select('player_name')
      .eq('id', playerId)
      .single();

    if (playerErr || !player) throw playerErr || new Error('Player not found');

    // Check if a player with the same name already exists on the target team
    const { data: existing, error: dupErr } = await supabase
      .from('players')
      .select('id')
      .eq('team_id', teamId)
      .ilike('player_name', player.player_name)
      .limit(1);

    if (!dupErr && existing && existing.length > 0) {
      showToast(`A player named "${player.player_name}" already exists on this team.`, 'error');
      return;
    }

    const { error } = await supabase
      .from('players')
      .update({ team_id: teamId })
      .eq('id', playerId);

    if (error) throw error;

    showToast('Player placed successfully', 'success');
    loadPlayers();
  } catch (err) {
    console.error('Error assigning player:', err);
    showToast('Failed to assign team', 'error');
  }
}

// Auto-distribution logic
async function handleAutoDistribution() {
  const sessionId = document.getElementById('player-session-select').value;
  if (!sessionId) return;

  if (sessionTeams.length === 0) {
    showToast('No teams exist to distribute players into. Create teams first.', 'error');
    return;
  }

  try {
    // 1. Fetch unassigned players
    const { data: unassigned, error: fetchErr } = await supabase
      .from('players')
      .select('id, player_name')
      .eq('session_id', sessionId)
      .is('team_id', null);

    if (fetchErr) throw fetchErr;

    if (!unassigned || unassigned.length === 0) {
      showToast('No pending unassigned players to distribute.', 'info');
      return;
    }

    if (!confirm(`Distribute ${unassigned.length} players evenly across ${sessionTeams.length} teams?`)) {
      return;
    }

    // 2. Pre-check: load all assigned players to detect name conflicts
    const { data: assignedPlayers, error: assignedErr } = await supabase
      .from('players')
      .select('player_name, team_id')
      .eq('session_id', sessionId)
      .not('team_id', 'is', null);

    if (assignedErr) throw assignedErr;

    // Build a set of (team_id, lowercase_name) for quick conflict lookup
    const existingNames = new Set(
      (assignedPlayers || []).map(p => `${p.team_id}::${p.player_name.toLowerCase()}`)
    );

    // 3. Distribute players round-robin, skipping conflicts
    const promises = [];
    const skipped = [];
    unassigned.forEach((player, index) => {
      const assignedTeam = sessionTeams[index % sessionTeams.length];
      const key = `${assignedTeam.id}::${player.player_name.toLowerCase()}`;

      if (existingNames.has(key)) {
        skipped.push(`${player.player_name} → ${assignedTeam.team_name}`);
        return;
      }

      // Track this assignment to prevent intra-batch conflicts
      existingNames.add(key);
      promises.push(
        supabase
          .from('players')
          .update({ team_id: assignedTeam.id })
          .eq('id', player.id)
      );
    });

    await Promise.all(promises);

    const placedCount = unassigned.length - skipped.length;
    showToast(`Distributed ${placedCount} players to teams successfully!`, 'success');

    if (skipped.length > 0) {
      showToast(`Skipped ${skipped.length} player(s) due to name conflicts on target team.`, 'warning');
    }

    loadPlayers();
  } catch (err) {
    console.error('Error in auto-distribution:', err);
    showToast('Auto-distribution error.', 'error');
  }
}

// Helper to construct player game URL
function getPlayerLink(token) {
  const path = window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/'));
  return `${window.location.origin}${path}/play.html?token=${token}`;
}

// Save Player manually (Create)
async function handleSavePlayer(e) {
  e.preventDefault();
  const sessionId = document.getElementById('player-session-select').value;
  const teamId = document.getElementById('player-team-select').value;
  const name = document.getElementById('player-name').value.trim();

  if (!sessionId) {
    showToast('Select a session first', 'error');
    return;
  }

  const access_token = generateToken(16);

  try {
    // Check for duplicate name in the session (case-insensitive)
    const { data: existing, error: dupErr } = await supabase
      .from('players')
      .select('id')
      .eq('session_id', sessionId)
      .ilike('player_name', name)
      .limit(1);

    if (!dupErr && existing && existing.length > 0) {
      showToast(`A player named "${name}" already exists in this session.`, 'error');
      return;
    }

    const { error } = await supabase
      .from('players')
      .insert([{
        session_id: sessionId,
        team_id: teamId || null, // Can add with no team initially
        player_name: name,
        access_token: access_token
      }]);

    if (error) throw error;

    showToast('Player added successfully', 'success');
    closeModal('modal-player');
    loadPlayers();
  } catch (err) {
    console.error('Error saving player:', err);
    showToast(err.message || 'Error saving player', 'error');
  }
}

// Delete Player
async function deletePlayer(id) {
  if (!confirm('Remove this player from the game session?')) {
    return;
  }

  try {
    const { error } = await supabase.from('players').delete().eq('id', id);
    if (error) throw error;

    showToast('Player removed', 'success');
    loadPlayers();
  } catch (err) {
    console.error('Error removing player:', err);
    showToast('Failed to remove player', 'error');
  }
}

// Render player QR code modal
let qrInstance = null;
function showPlayerQR(token, name) {
  const link = getPlayerLink(token);
  
  // Set Modal title
  document.getElementById('qr-print-title').innerText = 'Player Access QR';
  document.getElementById('qr-label-title').innerText = name.toUpperCase();
  document.getElementById('qr-label-subtitle').innerText = link;

  // Clear previous QR code
  const container = document.getElementById('qr-code-graphic');
  container.innerHTML = '';

  // Generate new QR Code using QRCode.js
  qrInstance = new QRCode(container, {
    text: link,
    width: 200,
    height: 200,
    colorDark: "#000000",
    colorLight: "#ffffff",
    correctLevel: QRCode.CorrectLevel.H
  });

  openModal('modal-qr-print');
}
