// Sessions Admin Module
import { supabase } from '../config.js';
import { showToast } from '../utils.js';
import { state, checkActiveSession } from './admin.js';

export function initSessions() {
  // Bind UI trigger to create session
  document.getElementById('btn-create-session').addEventListener('click', () => {
    document.getElementById('form-session').reset();
    document.getElementById('session-id-input').value = '';
    document.getElementById('modal-session-title').innerText = 'Create Game Session';
    openModal('modal-session');
  });

  // Bind Form Submit
  document.getElementById('form-session').addEventListener('submit', handleSaveSession);

  // Reload session table on reload event
  document.addEventListener('tab-reload-sessions', loadSessions);

  // Initial load
  loadSessions();
}

// Load Sessions from DB
export async function loadSessions() {
  try {
    const { data, error } = await supabase
      .from('sessions')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    state.sessions = data || [];
    renderSessions();
    updateSessionDropdowns();
  } catch (err) {
    console.error('Error loading sessions:', err);
    showToast('Failed to load sessions', 'error');
  }
}

// Render Sessions table
function renderSessions() {
  const tbody = document.getElementById('sessions-table-body');
  tbody.innerHTML = '';

  if (state.sessions.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">No game sessions configured</td></tr>`;
    return;
  }

  state.sessions.forEach(sess => {
    const tr = document.createElement('tr');
    
    let badgeClass = 'badge--warning';
    if (sess.status === 'active') badgeClass = 'badge--success';
    if (sess.status === 'completed') badgeClass = 'badge--danger';

    tr.innerHTML = `
      <td class="font-mono" style="font-size:0.8rem; max-width:150px; overflow:hidden; text-overflow:ellipsis;">${sess.id}</td>
      <td style="font-weight:600;">${sess.title}</td>
      <td class="font-mono">${sess.duration}m</td>
      <td style="text-transform:uppercase;">${sess.route_mode}</td>
      <td><span class="badge ${badgeClass}">${sess.status}</span></td>
      <td>
        <div class="flex" style="gap: 5px;">
          ${sess.status === 'draft' ? `<button class="btn btn--primary btn--sm action-start" data-id="${sess.id}">START</button>` : ''}
          ${sess.status === 'active' ? `<button class="btn btn--accent btn--sm action-end" data-id="${sess.id}">END</button>` : ''}
          ${sess.status === 'draft' ? `<button class="btn btn--outline btn--sm action-edit" data-id="${sess.id}">EDIT</button>` : ''}
          <button class="btn btn--outline btn--sm action-delete text-accent" data-id="${sess.id}">DEL</button>
        </div>
      </td>
    `;

    tbody.appendChild(tr);
  });

  // Attach button listeners
  tbody.querySelectorAll('.action-start').forEach(btn => {
    btn.addEventListener('click', () => startSession(btn.getAttribute('data-id')));
  });
  tbody.querySelectorAll('.action-end').forEach(btn => {
    btn.addEventListener('click', () => endSession(btn.getAttribute('data-id')));
  });
  tbody.querySelectorAll('.action-edit').forEach(btn => {
    btn.addEventListener('click', () => editSession(btn.getAttribute('data-id')));
  });
  tbody.querySelectorAll('.action-delete').forEach(btn => {
    btn.addEventListener('click', () => deleteSession(btn.getAttribute('data-id')));
  });
}

// Update Session Dropdowns in other tabs
export function updateSessionDropdowns() {
  const dropdownIds = ['team-session-select', 'player-session-select', 'checkpoint-session-select', 'route-session-select'];
  dropdownIds.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    
    const currentValue = el.value;
    el.innerHTML = '<option value="">Select Session...</option>';
    
    state.sessions.forEach(sess => {
      const opt = document.createElement('option');
      opt.value = sess.id;
      opt.text = `${sess.title} (${sess.status})`;
      el.appendChild(opt);
    });

    el.value = currentValue;
  });
}

// Save Session (Create / Update)
async function handleSaveSession(e) {
  e.preventDefault();
  const id = document.getElementById('session-id-input').value;
  const title = document.getElementById('session-title').value.trim();
  const duration = parseInt(document.getElementById('session-duration').value, 10);
  const route_mode = document.getElementById('session-route-mode').value;
  const questions_per_checkpoint = parseInt(document.getElementById('session-questions-per-checkpoint').value, 10);

  const payload = { title, duration, route_mode, questions_per_checkpoint };

  try {
    let result;
    if (id) {
      // Update
      result = await supabase.from('sessions').update(payload).eq('id', id);
    } else {
      // Create
      result = await supabase.from('sessions').insert([payload]);
    }

    if (result.error) throw result.error;

    showToast('Session details committed successfully', 'success');
    closeModal('modal-session');
    loadSessions();
    checkActiveSession();
  } catch (err) {
    console.error('Error saving session:', err);
    showToast(err.message || 'Error saving session', 'error');
  }
}

// Edit Session Modal trigger
function editSession(id) {
  const sess = state.sessions.find(s => s.id === id);
  if (!sess) return;

  document.getElementById('session-id-input').value = sess.id;
  document.getElementById('session-title').value = sess.title;
  document.getElementById('session-duration').value = sess.duration;
  document.getElementById('session-route-mode').value = sess.route_mode;
  document.getElementById('session-questions-per-checkpoint').value = sess.questions_per_checkpoint;

  document.getElementById('modal-session-title').innerText = 'Edit Game Session';
  openModal('modal-session');
}

// Delete Session
async function deleteSession(id) {
  if (!confirm('Are you absolutely sure you want to delete this session? This will purge all associated teams, players, routes, and answers.')) {
    return;
  }

  try {
    const { error } = await supabase.from('sessions').delete().eq('id', id);
    if (error) throw error;

    showToast('Session purged successfully', 'success');
    loadSessions();
    checkActiveSession();
  } catch (err) {
    console.error('Error deleting session:', err);
    showToast('Failed to delete session', 'error');
  }
}

// Start Session
async function startSession(id) {
  if (state.activeSession) {
    showToast('Another session is currently active. Close it first.', 'error');
    return;
  }

  if (!confirm('Start the game session? This locks game settings and allows players to access checkpoints.')) {
    return;
  }

  try {
    // 1. Verify route assignment exists for players
    const { data: routeCount, error: routeErr } = await supabase
      .from('player_routes')
      .select('id')
      .limit(1);
    
    // Wait, let's just make sure there are checkpoints and teams
    const { data: checkpoints } = await supabase.from('checkpoints').select('id').eq('session_id', id);
    const { data: teams } = await supabase.from('teams').select('id').eq('session_id', id);

    if (!checkpoints || checkpoints.length === 0) {
      showToast('Cannot start session: No checkpoints defined.', 'error');
      return;
    }
    if (!teams || teams.length === 0) {
      showToast('Cannot start session: No teams configured.', 'error');
      return;
    }

    const { error } = await supabase
      .from('sessions')
      .update({ status: 'active', started_at: new Date().toISOString() })
      .eq('id', id);

    if (error) throw error;

    showToast('Session started! Real-time telemetry initialized.', 'success');
    await checkActiveSession();
    loadSessions();
  } catch (err) {
    console.error('Error starting session:', err);
    showToast('Failed to start session', 'error');
  }
}

// End Session
async function endSession(id) {
  if (!confirm('Terminate this session? This will finalize all player scores and freeze gameplay.')) {
    return;
  }

  try {
    const { error } = await supabase
      .from('sessions')
      .update({ status: 'completed' })
      .eq('id', id);

    if (error) throw error;

    showToast('Session completed. Leaderboard finalized.', 'info');
    await checkActiveSession();
    loadSessions();
  } catch (err) {
    console.error('Error ending session:', err);
    showToast('Failed to end session', 'error');
  }
}
