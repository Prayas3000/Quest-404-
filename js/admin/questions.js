// Questions Admin Module
import { supabase } from '../config.js';
import { showToast } from '../utils.js';
import { state } from './admin.js';

let currentAttachments = [];
let checkpointsList = []; // Cached list of all checkpoints

export function initQuestions() {
  const filterTopic = document.getElementById('question-topic-filter');
  const filterDiff = document.getElementById('question-difficulty-filter');
  const filterCheckpoint = document.getElementById('question-checkpoint-filter');
  const btnCreate = document.getElementById('btn-create-question');

  // Filter change handlers
  filterTopic.addEventListener('change', loadQuestions);
  filterDiff.addEventListener('change', loadQuestions);
  filterCheckpoint.addEventListener('change', loadQuestions);

  // Modal open button
  btnCreate.addEventListener('click', async () => {
    document.getElementById('form-question').reset();
    document.getElementById('question-id-input').value = '';
    currentAttachments = [];
    renderAttachmentsPreview();
    toggleQuestionOptions(); // Updates input layout based on default selection (MCQ)
    await populateCheckpointDropdowns();
    document.getElementById('question-checkpoint').value = '';
    openModal('modal-question');
  });

  // Form submit handler
  document.getElementById('form-question').addEventListener('submit', handleSaveQuestion);

  // Tab reload event
  document.addEventListener('tab-reload-questions', loadQuestions);

  // Setup attachment drag/drop and paste handlers
  setupAttachmentHandlers();

  // Initial load
  populateCheckpointDropdowns();
  loadQuestions();
}

// Load Questions from DB with filters
export async function loadQuestions() {
  const topic = document.getElementById('question-topic-filter').value;
  const difficulty = document.getElementById('question-difficulty-filter').value;
  const checkpointFilter = document.getElementById('question-checkpoint-filter').value;

  try {
    let query = supabase.from('questions').select('*');

    if (topic) query = query.eq('topic', topic);
    if (difficulty) query = query.eq('difficulty', difficulty);
    if (checkpointFilter === 'unlinked') {
      query = query.is('checkpoint_id', null);
    } else if (checkpointFilter) {
      query = query.eq('checkpoint_id', checkpointFilter);
    }

    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) throw error;

    state.questions = data || [];
    
    // Auto-seed if database is empty
    if (state.questions.length === 0 && !topic && !difficulty && !checkpointFilter) {
      await seedDefaultQuestions();
    } else {
      renderQuestions();
    }
  } catch (err) {
    console.error('Error loading questions:', err);
    showToast('Failed to load questions', 'error');
  }
}

// Render Questions table
function renderQuestions() {
  const tbody = document.getElementById('questions-table-body');
  tbody.innerHTML = '';

  if (state.questions.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted">No questions found matching criteria</td></tr>`;
    return;
  }

  state.questions.forEach(q => {
    const tr = document.createElement('tr');
    
    // Format options display
    let ansText = q.answer;
    if (q.question_type === 'mcq' && q.options) {
      const idx = parseInt(q.answer, 10);
      ansText = q.options[idx] ? `[${idx}] ${q.options[idx]}` : q.answer;
    }

    // Find linked checkpoint name
    let cpBadge = '<span class="badge badge--outline" style="border-color:var(--text-muted); color:var(--text-muted); font-size:0.75rem;">Random Pool</span>';
    if (q.checkpoint_id) {
      const cp = checkpointsList.find(c => c.id === q.checkpoint_id);
      const cpName = cp ? cp.checkpoint_name : 'Unknown';
      cpBadge = `<span class="badge badge--info" style="font-size:0.75rem;" title="${cpName}">${cpName}</span>`;
    }

    tr.innerHTML = `
      <td><span class="badge ${q.topic === 'cybersecurity' ? 'badge--info' : 'badge--warning'}">${q.topic}</span></td>
      <td><span class="badge badge--outline" style="border-color:var(--text-muted); color:var(--text-muted);">${q.difficulty}</span></td>
      <td>${cpBadge}</td>
      <td style="text-transform:uppercase; font-size:0.8rem;" class="font-mono">${q.question_type}</td>
      <td style="max-width:260px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${q.question}">${q.question}</td>
      <td style="max-width:150px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${ansText}">${ansText}</td>
      <td>
        <div class="flex" style="gap: 5px;">
          <button class="btn btn--outline btn--sm action-edit" data-id="${q.id}">EDIT</button>
          <button class="btn btn--outline btn--sm action-delete text-accent" data-id="${q.id}">DEL</button>
        </div>
      </td>
    `;

    tbody.appendChild(tr);
  });

  // Attach button listeners
  tbody.querySelectorAll('.action-edit').forEach(btn => {
    btn.addEventListener('click', () => editQuestion(btn.getAttribute('data-id')));
  });
  tbody.querySelectorAll('.action-delete').forEach(btn => {
    btn.addEventListener('click', () => deleteQuestion(btn.getAttribute('data-id')));
  });
}

// Save Question (Create / Update)
async function handleSaveQuestion(e) {
  e.preventDefault();
  const qId = document.getElementById('question-id-input').value;
  const topic = document.getElementById('question-topic').value;
  const difficulty = document.getElementById('question-difficulty').value;
  const question_type = document.getElementById('question-type').value;
  const question = document.getElementById('question-text').value.trim();
  const answer = document.getElementById('question-answer').value.trim();

  let options = null;
  if (question_type === 'mcq') {
    options = [
      document.getElementById('option-0').value.trim(),
      document.getElementById('option-1').value.trim(),
      document.getElementById('option-2').value.trim(),
      document.getElementById('option-3').value.trim()
    ];
  }

  const newCheckpointId = document.getElementById('question-checkpoint').value || null;
  const payload = { topic, difficulty, question_type, question, options, answer, attachments: currentAttachments, is_active: true, checkpoint_id: newCheckpointId };

  try {
    let result;
    if (qId) {
      result = await supabase.from('questions').update(payload).eq('id', qId);
    } else {
      result = await supabase.from('questions').insert([payload]);
    }

    if (result.error) throw result.error;

    // Clean up stale checkpoint assignments when checkpoint link changes.
    // If the question was previously randomly assigned to Checkpoint A, and the admin
    // now links it to SHOWCASE, we must remove the old Checkpoint A entry so the
    // question stops appearing there.
    if (qId) {
      let cleanupQuery = supabase
        .from('checkpoint_questions')
        .delete()
        .eq('question_id', qId);

      // If linking to a specific checkpoint, keep that entry but remove all others.
      // If unlinking (null), remove all entries so it returns to the random pool cleanly.
      if (newCheckpointId) {
        cleanupQuery = cleanupQuery.neq('checkpoint_id', newCheckpointId);
      }

      const { error: cleanupErr } = await cleanupQuery;
      if (cleanupErr) console.warn('Checkpoint cleanup warning:', cleanupErr);

      // Also clean stale player_checkpoint_questions so players don't see wrong questions
      let playerCleanupQuery = supabase
        .from('player_checkpoint_questions')
        .delete()
        .eq('question_id', qId);

      if (newCheckpointId) {
        playerCleanupQuery = playerCleanupQuery.neq('checkpoint_id', newCheckpointId);
      }

      const { error: playerCleanupErr } = await playerCleanupQuery;
      if (playerCleanupErr) console.warn('Player questions cleanup warning:', playerCleanupErr);
    }

    showToast('Question details updated in bank', 'success');
    closeModal('modal-question');
    loadQuestions();
  } catch (err) {
    console.error('Error saving question:', err);
    showToast(err.message || 'Error saving question', 'error');
  }
}

// Edit Question
async function editQuestion(id) {
  const q = state.questions.find(item => item.id === id);
  if (!q) return;

  document.getElementById('question-id-input').value = q.id;
  document.getElementById('question-topic').value = q.topic;
  document.getElementById('question-difficulty').value = q.difficulty;
  document.getElementById('question-type').value = q.question_type;
  document.getElementById('question-text').value = q.question;
  document.getElementById('question-answer').value = q.answer;

  toggleQuestionOptions(); // Update layout

  // Populate checkpoint dropdown and pre-select
  await populateCheckpointDropdowns();
  document.getElementById('question-checkpoint').value = q.checkpoint_id || '';

  currentAttachments = q.attachments || [];
  renderAttachmentsPreview();

  if (q.question_type === 'mcq' && q.options) {
    document.getElementById('option-0').value = q.options[0] || '';
    document.getElementById('option-1').value = q.options[1] || '';
    document.getElementById('option-2').value = q.options[2] || '';
    document.getElementById('option-3').value = q.options[3] || '';
  }

  openModal('modal-question');
}

// Delete Question
async function deleteQuestion(id) {
  if (!confirm('Remove this question from the active bank?')) {
    return;
  }

  try {
    const { error } = await supabase.from('questions').delete().eq('id', id);
    if (error) throw error;

    showToast('Question deleted', 'success');
    loadQuestions();
  } catch (err) {
    console.error('Error deleting question:', err);
    showToast('Failed to delete question', 'error');
  }
}

// Seed Initial Cybersecurity and Mathematics Questions
async function seedDefaultQuestions() {
  showToast('Seeding initial question bank...', 'info');

  const defaultQuestions = [
    // Cybersecurity Questions
    {
      topic: 'cybersecurity',
      difficulty: 'easy',
      question_type: 'mcq',
      question: 'Which of the following is commonly used to encrypt web traffic secure connections?',
      options: ['HTTP', 'FTP', 'HTTPS/TLS', 'SMTP'],
      answer: '2'
    },
    {
      topic: 'cybersecurity',
      difficulty: 'easy',
      question_type: 'text',
      question: 'What is the full form of VPN? (Case insensitive)',
      answer: 'Virtual Private Network'
    },
    {
      topic: 'cybersecurity',
      difficulty: 'medium',
      question_type: 'mcq',
      question: 'What is the primary objective of a SQL Injection (SQLi) attack?',
      options: ['Crash the router hardware', 'Bypass login authentication or steal database data', 'Send massive spam emails', 'Generate Bitcoin blocks'],
      answer: '1'
    },
    {
      topic: 'cybersecurity',
      difficulty: 'medium',
      question_type: 'text',
      question: 'Which port is standard for HTTPS secure web communication?',
      answer: '443'
    },
    {
      topic: 'cybersecurity',
      difficulty: 'hard',
      question_type: 'mcq',
      question: 'Which symmetric encryption standard uses block size of 128-bits and key length options of 128, 192, or 256 bits?',
      options: ['DES', 'Blowfish', 'AES', 'RSA'],
      answer: '2'
    },
    // Mathematics Questions
    {
      topic: 'mathematics',
      difficulty: 'easy',
      question_type: 'mcq',
      question: 'What is the binary representation of the decimal number 13?',
      options: ['1011', '1101', '1110', '1001'],
      answer: '1'
    },
    {
      topic: 'mathematics',
      difficulty: 'easy',
      question_type: 'text',
      question: 'Solve for x: 3x - 7 = 14',
      answer: '7'
    },
    {
      topic: 'mathematics',
      difficulty: 'medium',
      question_type: 'mcq',
      question: 'If a coin is tossed 3 times, what is the probability of getting exactly 2 heads?',
      options: ['3/8', '1/2', '1/4', '5/8'],
      answer: '0'
    },
    {
      topic: 'mathematics',
      difficulty: 'medium',
      question_type: 'text',
      question: 'What is the hexadecimal representation of the decimal number 255?',
      answer: 'FF'
    },
    {
      topic: 'mathematics',
      difficulty: 'hard',
      question_type: 'mcq',
      question: 'In graph theory, what is the maximum number of edges in a simple undirected graph with n vertices?',
      options: ['n * (n + 1) / 2', 'n * (n - 1) / 2', 'n^2', '2^n'],
      answer: '1'
    }
  ];

  try {
    const { error } = await supabase.from('questions').insert(defaultQuestions);
    if (error) throw error;
    
    showToast('Question bank seeded with 10 sample problems!', 'success');
    loadQuestions();
  } catch (err) {
    console.error('Error seeding questions:', err);
    showToast('Failed to seed question bank', 'error');
  }
}

// Attachments Drag & Drop / Copy-Paste Handlers
function setupAttachmentHandlers() {
  const dropzone = document.getElementById('question-dropzone');
  const filePicker = document.getElementById('question-file-picker');
  const textarea = document.getElementById('question-text');

  if (!dropzone || !filePicker || !textarea) return;

  // Trigger file selection click
  dropzone.addEventListener('click', (e) => {
    if (e.target.tagName !== 'INPUT') {
      filePicker.click();
    }
  });

  // Handle manual file selection
  filePicker.addEventListener('change', () => {
    processFiles(filePicker.files);
    filePicker.value = ''; // Reset to allow re-selecting same file
  });

  // Drag & Drop handlers
  ['dragenter', 'dragover'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropzone.style.borderColor = 'var(--color-primary)';
      dropzone.style.background = 'rgba(34, 167, 196, 0.08)';
    }, false);
    
    textarea.addEventListener(eventName, (e) => {
      e.preventDefault();
    }, false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropzone.style.borderColor = 'var(--border-neon-primary)';
      dropzone.style.background = 'rgba(34, 167, 196, 0.02)';
    }, false);
  });

  dropzone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    if (dt && dt.files) {
      processFiles(dt.files);
    }
  });

  textarea.addEventListener('drop', (e) => {
    e.preventDefault();
    const dt = e.dataTransfer;
    if (dt && dt.files) {
      processFiles(dt.files);
    }
  });

  // Paste handlers (Ctrl+V)
  const pasteHandler = (e) => {
    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    const files = [];
    for (let index in items) {
      const item = items[index];
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length > 0) {
      processFiles(files);
    }
  };

  textarea.addEventListener('paste', pasteHandler);
  dropzone.addEventListener('paste', pasteHandler);
}

function processFiles(files) {
  const maxSize = 3 * 1024 * 1024; // 3MB

  Array.from(files).forEach(file => {
    // Basic validation for accepted types
    const isImage = file.type.startsWith('image/');
    const isPDF = file.type === 'application/pdf';

    if (!isImage && !isPDF) {
      showToast(`Unsupported file type: ${file.name}. Only PNG, JPG, and PDF are allowed.`, 'error');
      return;
    }

    if (file.size > maxSize) {
      showToast(`File "${file.name}" is too large. Max size allowed is 3MB.`, 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = function (e) {
      const base64Data = e.target.result;
      
      // Prevent duplicate attachment name additions in the current session
      if (currentAttachments.some(att => att.name === file.name && att.size === file.size)) {
        showToast(`File "${file.name}" is already attached.`, 'warning');
        return;
      }

      currentAttachments.push({
        name: file.name,
        type: file.type,
        size: file.size,
        data: base64Data
      });
      renderAttachmentsPreview();
    };
    reader.readAsDataURL(file);
  });
}

function renderAttachmentsPreview() {
  const container = document.getElementById('question-attachments-preview');
  if (!container) return;
  container.innerHTML = '';

  currentAttachments.forEach((att, idx) => {
    const card = document.createElement('div');
    card.className = 'card font-mono flex align-center justify-between';
    card.style.padding = '0.5rem 0.75rem';
    card.style.fontSize = '0.75rem';
    card.style.width = '100%';
    card.style.maxWidth = '380px';
    card.style.background = '#ffffff';
    card.style.border = '1px solid var(--border-color)';
    card.style.borderRadius = 'var(--radius-sm)';
    card.style.gap = '10px';

    const isImage = att.type.startsWith('image/');
    let previewHtml = '';

    if (isImage) {
      previewHtml = `<img src="${att.data}" style="width:36px; height:36px; object-fit:cover; border-radius:4px; border:1px solid var(--border-color);">`;
    } else {
      previewHtml = `<div style="width:36px; height:36px; display:flex; align-items:center; justify-content:center; background:rgba(220,74,74,0.05); color:var(--color-accent); border:1px solid rgba(220,74,74,0.15); border-radius:4px; font-weight:bold; font-size:0.65rem;">PDF</div>`;
    }

    card.innerHTML = `
      <div class="flex align-center" style="gap:10px; overflow:hidden; flex-grow:1;">
        ${previewHtml}
        <div style="overflow:hidden; text-align:left;">
          <div style="font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:var(--text-dark);" title="${att.name}">${att.name}</div>
          <div style="font-size:0.65rem; color:var(--text-muted);">${formatBytes(att.size)}</div>
        </div>
      </div>
      <button type="button" class="btn btn--outline btn--sm btn-delete-att" data-index="${idx}" style="padding:0.2rem 0.4rem; min-width:30px; min-height:30px; border-color:rgba(220,74,74,0.2); color:var(--color-accent);">✕</button>
    `;

    card.querySelector('.btn-delete-att').addEventListener('click', (e) => {
      const index = parseInt(e.currentTarget.getAttribute('data-index'), 10);
      currentAttachments.splice(index, 1);
      renderAttachmentsPreview();
    });

    container.appendChild(card);
  });
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

async function populateCheckpointDropdowns() {
  try {
    const { data, error } = await supabase
      .from('checkpoints')
      .select('id, checkpoint_name, session_id, sessions ( title )')
      .order('checkpoint_name', { ascending: true });
    
    if (error) throw error;
    
    checkpointsList = data || [];
    
    // Populate form dropdown
    const formSelect = document.getElementById('question-checkpoint');
    if (formSelect) {
      const currentValue = formSelect.value;
      formSelect.innerHTML = '<option value="">None — Random Pool</option>';
      checkpointsList.forEach(cp => {
        const sessionTitle = cp.sessions ? ` (${cp.sessions.title})` : '';
        const opt = document.createElement('option');
        opt.value = cp.id;
        opt.textContent = `${cp.checkpoint_name}${sessionTitle}`;
        formSelect.appendChild(opt);
      });
      formSelect.value = currentValue;
    }

    // Populate filter dropdown
    const filterSelect = document.getElementById('question-checkpoint-filter');
    if (filterSelect) {
      const currentValue = filterSelect.value;
      filterSelect.innerHTML = `
        <option value="">All Checkpoints</option>
        <option value="unlinked">Unlinked (Random Pool)</option>
      `;
      checkpointsList.forEach(cp => {
        const sessionTitle = cp.sessions ? ` (${cp.sessions.title})` : '';
        const opt = document.createElement('option');
        opt.value = cp.id;
        opt.textContent = `${cp.checkpoint_name}${sessionTitle}`;
        filterSelect.appendChild(opt);
      });
      filterSelect.value = currentValue;
    }
  } catch (err) {
    console.error('Error populating checkpoints dropdown:', err);
  }
}


