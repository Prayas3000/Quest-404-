// Checkpoints Admin Module
import { supabase } from '../config.js';
import { showToast, generateToken } from '../utils.js';
import { state } from './admin.js';

export function initCheckpoints() {
  const select = document.getElementById('checkpoint-session-select');
  const btnCreate = document.getElementById('btn-create-checkpoint');

  // Session selection change handler
  select.addEventListener('change', () => {
    const sessionId = select.value;
    if (sessionId) {
      btnCreate.removeAttribute('disabled');
      loadCheckpoints(sessionId);
    } else {
      btnCreate.setAttribute('disabled', 'true');
      document.getElementById('checkpoints-table-body').innerHTML = 
        `<tr><td colspan="4" class="text-center text-muted">Select a session to load checkpoints</td></tr>`;
    }
  });

  // Modal open button
  btnCreate.addEventListener('click', () => {
    document.getElementById('form-checkpoint').reset();
    document.getElementById('checkpoint-id-input').value = '';
    // Prefill unique QR code identifier automatically
    document.getElementById('checkpoint-qr').value = `CP-${generateToken(6).toUpperCase()}`;
    openModal('modal-checkpoint');
  });

  // Form submit handler
  document.getElementById('form-checkpoint').addEventListener('submit', handleSaveCheckpoint);

  // Tab reload event
  document.addEventListener('tab-reload-checkpoints', () => {
    if (select.value) {
      loadCheckpoints(select.value);
    }
  });
}

// Load checkpoints from DB
export async function loadCheckpoints(sessionId) {
  try {
    const { data, error } = await supabase
      .from('checkpoints')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });

    if (error) throw error;

    state.checkpoints = data || [];
    renderCheckpoints();
  } catch (err) {
    console.error('Error loading checkpoints:', err);
    showToast('Failed to load checkpoints', 'error');
  }
}

// Render Checkpoints table
function renderCheckpoints() {
  const tbody = document.getElementById('checkpoints-table-body');
  tbody.innerHTML = '';

  if (state.checkpoints.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">No checkpoints configured in this session</td></tr>`;
    return;
  }

  state.checkpoints.forEach(cp => {
    const tr = document.createElement('tr');

    tr.innerHTML = `
      <td style="font-weight:600;">${cp.checkpoint_name}</td>
      <td style="max-width:250px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${cp.hint}">${cp.hint}</td>
      <td class="font-mono" style="font-size:0.85rem; color:var(--color-secondary);">${cp.qr_identifier}</td>
      <td>
        <div class="flex" style="gap: 5px;">
          <button class="btn btn--primary btn--sm action-qr" data-qr="${cp.qr_identifier}" data-name="${cp.checkpoint_name}">QR</button>
          <button class="btn btn--outline btn--sm action-edit" data-id="${cp.id}">EDIT</button>
          <button class="btn btn--outline btn--sm action-delete text-accent" data-id="${cp.id}">DEL</button>
        </div>
      </td>
    `;

    tbody.appendChild(tr);
  });

  // Attach button listeners
  tbody.querySelectorAll('.action-qr').forEach(btn => {
    btn.addEventListener('click', () => {
      showCheckpointQR(btn.getAttribute('data-qr'), btn.getAttribute('data-name'));
    });
  });
  tbody.querySelectorAll('.action-edit').forEach(btn => {
    btn.addEventListener('click', () => editCheckpoint(btn.getAttribute('data-id')));
  });
  tbody.querySelectorAll('.action-delete').forEach(btn => {
    btn.addEventListener('click', () => deleteCheckpoint(btn.getAttribute('data-id')));
  });
}

// Save Checkpoint (Create / Update)
async function handleSaveCheckpoint(e) {
  e.preventDefault();
  const sessionId = document.getElementById('checkpoint-session-select').value;
  const cpId = document.getElementById('checkpoint-id-input').value;
  const checkpoint_name = document.getElementById('checkpoint-name').value.trim();
  const hint = document.getElementById('checkpoint-hint').value.trim();
  const qr_identifier = document.getElementById('checkpoint-qr').value.trim();

  if (!sessionId) {
    showToast('Select a session first', 'error');
    return;
  }

  const payload = { session_id: sessionId, checkpoint_name, hint, qr_identifier };

  try {
    let result;
    if (cpId) {
      result = await supabase.from('checkpoints').update({ checkpoint_name, hint, qr_identifier }).eq('id', cpId);
    } else {
      result = await supabase.from('checkpoints').insert([payload]);
    }

    if (result.error) throw result.error;

    showToast('Checkpoint saved successfully', 'success');
    closeModal('modal-checkpoint');
    loadCheckpoints(sessionId);
  } catch (err) {
    console.error('Error saving checkpoint:', err);
    showToast(err.message || 'Error saving checkpoint', 'error');
  }
}

// Edit Checkpoint
function editCheckpoint(id) {
  const cp = state.checkpoints.find(c => c.id === id);
  if (!cp) return;

  document.getElementById('checkpoint-id-input').value = cp.id;
  document.getElementById('checkpoint-name').value = cp.checkpoint_name;
  document.getElementById('checkpoint-hint').value = cp.hint;
  document.getElementById('checkpoint-qr').value = cp.qr_identifier;

  openModal('modal-checkpoint');
}

// Delete Checkpoint
async function deleteCheckpoint(id) {
  if (!confirm('Are you sure you want to delete this checkpoint? This will purge it from all player routes.')) {
    return;
  }

  const sessionId = document.getElementById('checkpoint-session-select').value;

  try {
    const { error } = await supabase.from('checkpoints').delete().eq('id', id);
    if (error) throw error;

    showToast('Checkpoint deleted', 'success');
    loadCheckpoints(sessionId);
  } catch (err) {
    console.error('Error deleting checkpoint:', err);
    showToast('Failed to delete checkpoint', 'error');
  }
}

// Render checkpoint QR code modal
function showCheckpointQR(qrVal, name) {
  // Set Modal text
  document.getElementById('qr-print-title').innerText = 'Checkpoint QR Code';
  document.getElementById('qr-label-title').innerText = name.toUpperCase();
  document.getElementById('qr-label-subtitle').innerText = `IDENTIFIER: ${qrVal}`;

  // Clear previous graphic
  const container = document.getElementById('qr-code-graphic');
  container.innerHTML = '';

  // Generate new QR Code
  new QRCode(container, {
    text: qrVal,
    width: 240,
    height: 240,
    colorDark: "#000000",
    colorLight: "#ffffff",
    correctLevel: QRCode.CorrectLevel.H
  });

  openModal('modal-qr-print');
}
