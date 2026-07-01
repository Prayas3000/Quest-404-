// Teams Admin Module
import { supabase } from '../config.js';
import { showToast } from '../utils.js';
import { state } from './admin.js';

export function initTeams() {
  const select = document.getElementById('team-session-select');
  const btnCreate = document.getElementById('btn-create-team');

  // Session selection change handler
  select.addEventListener('change', () => {
    const sessionId = select.value;
    if (sessionId) {
      btnCreate.removeAttribute('disabled');
      loadTeams(sessionId);
    } else {
      btnCreate.setAttribute('disabled', 'true');
      document.getElementById('teams-table-body').innerHTML = 
        `<tr><td colspan="4" class="text-center text-muted">Select a session to load teams</td></tr>`;
    }
  });

  // Modal create button
  btnCreate.addEventListener('click', () => {
    document.getElementById('form-team').reset();
    document.getElementById('team-id-input').value = '';
    openModal('modal-team');
  });

  // Form submit handler
  document.getElementById('form-team').addEventListener('submit', handleSaveTeam);

  // Reload team table on reload event
  document.addEventListener('tab-reload-teams', () => {
    if (select.value) {
      loadTeams(select.value);
    }
  });
}

// Load teams for selected session
export async function loadTeams(sessionId) {
  try {
    // Query teams and also load player counts for each team
    const { data: teamsData, error: teamsError } = await supabase
      .from('teams')
      .select(`
        *,
        players (id)
      `)
      .eq('session_id', sessionId)
      .order('team_name', { ascending: true });

    if (teamsError) throw teamsError;

    state.teams = teamsData || [];
    renderTeams();
    updateTeamDropdowns();
  } catch (err) {
    console.error('Error loading teams:', err);
    showToast('Failed to load teams', 'error');
  }
}

// Render Teams table
function renderTeams() {
  const tbody = document.getElementById('teams-table-body');
  tbody.innerHTML = '';

  if (state.teams.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">No teams configured in this session</td></tr>`;
    return;
  }

  state.teams.forEach(team => {
    const tr = document.createElement('tr');
    const memberCount = team.players ? team.players.length : 0;
    
    tr.innerHTML = `
      <td class="font-mono" style="font-size:0.8rem; max-width:150px; overflow:hidden; text-overflow:ellipsis;">${team.id}</td>
      <td style="font-weight:600;">${team.team_name}</td>
      <td class="font-mono">${memberCount}</td>
      <td>
        <div class="flex" style="gap: 5px;">
          <button class="btn btn--outline btn--sm action-edit" data-id="${team.id}">RENAME</button>
          <button class="btn btn--outline btn--sm action-delete text-accent" data-id="${team.id}">DEL</button>
        </div>
      </td>
    `;

    tbody.appendChild(tr);
  });

  // Attach event listeners
  tbody.querySelectorAll('.action-edit').forEach(btn => {
    btn.addEventListener('click', () => editTeam(btn.getAttribute('data-id')));
  });
  tbody.querySelectorAll('.action-delete').forEach(btn => {
    btn.addEventListener('click', () => deleteTeam(btn.getAttribute('data-id')));
  });
}

// Update Team Dropdowns (used in players tab)
export function updateTeamDropdowns() {
  const el = document.getElementById('player-team-select');
  if (!el) return;

  const currentValue = el.value;
  el.innerHTML = '<option value="">Select Team...</option>';

  state.teams.forEach(team => {
    const opt = document.createElement('option');
    opt.value = team.id;
    opt.text = team.team_name;
    el.appendChild(opt);
  });

  el.value = currentValue;
}

// Save Team (Create / Update)
async function handleSaveTeam(e) {
  e.preventDefault();
  const sessionId = document.getElementById('team-session-select').value;
  const teamId = document.getElementById('team-id-input').value;
  const team_name = document.getElementById('team-name').value.trim();

  if (!sessionId) {
    showToast('Select a session first', 'error');
    return;
  }

  const payload = { session_id: sessionId, team_name };

  try {
    let result;
    if (teamId) {
      result = await supabase.from('teams').update({ team_name }).eq('id', teamId);
    } else {
      result = await supabase.from('teams').insert([payload]);
    }

    if (result.error) throw result.error;

    showToast('Team roster updated', 'success');
    closeModal('modal-team');
    loadTeams(sessionId);
  } catch (err) {
    console.error('Error saving team:', err);
    showToast(err.message || 'Error saving team', 'error');
  }
}

// Edit Team Trigger
function editTeam(id) {
  const team = state.teams.find(t => t.id === id);
  if (!team) return;

  document.getElementById('team-id-input').value = team.id;
  document.getElementById('team-name').value = team.team_name;
  openModal('modal-team');
}

// Delete Team
async function deleteTeam(id) {
  if (!confirm('Delete this team? All member players, assigned routes, and answers will be permanently deleted.')) {
    return;
  }

  const sessionId = document.getElementById('team-session-select').value;

  try {
    const { error } = await supabase.from('teams').delete().eq('id', id);
    if (error) throw error;

    showToast('Team deleted', 'success');
    loadTeams(sessionId);
  } catch (err) {
    console.error('Error deleting team:', err);
    showToast('Failed to delete team', 'error');
  }
}
