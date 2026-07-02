// Questions Admin Module
import { supabase } from '../config.js';
import { showToast } from '../utils.js';
import { state } from './admin.js';

let currentAttachments = [];

export function initQuestions() {
  const filterTopic = document.getElementById('question-topic-filter');
  const filterDiff = document.getElementById('question-difficulty-filter');
  const btnCreate = document.getElementById('btn-create-question');

  // Filter change handlers
  filterTopic.addEventListener('change', loadQuestions);
  filterDiff.addEventListener('change', loadQuestions);

  // Modal open button
  btnCreate.addEventListener('click', () => {
    document.getElementById('form-question').reset();
    document.getElementById('question-id-input').value = '';
    currentAttachments = [];
    renderAttachmentsPreview();
    toggleQuestionOptions(); // Updates input layout based on default selection (MCQ)
    openModal('modal-question');
  });

  // Form submit handler
  document.getElementById('form-question').addEventListener('submit', handleSaveQuestion);

  // Tab reload event
  document.addEventListener('tab-reload-questions', loadQuestions);

  // Setup attachment drag/drop and paste handlers
  setupAttachmentHandlers();

  // Initial load
  loadQuestions();
}

// Load Questions from DB with filters
export async function loadQuestions() {
  const topic = document.getElementById('question-topic-filter').value;
  const difficulty = document.getElementById('question-difficulty-filter').value;

  try {
    let query = supabase.from('questions').select('*');

    if (topic) query = query.eq('topic', topic);
    if (difficulty) query = query.eq('difficulty', difficulty);

    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) throw error;

    state.questions = data || [];
    
    // Auto-seed if database is empty
    if (state.questions.length === 0 && !topic && !difficulty) {
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
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">No questions found matching criteria</td></tr>`;
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

    tr.innerHTML = `
      <td><span class="badge ${q.topic === 'cybersecurity' ? 'badge--info' : 'badge--warning'}">${q.topic}</span></td>
      <td><span class="badge badge--outline" style="border-color:var(--text-muted); color:var(--text-muted);">${q.difficulty}</span></td>
      <td style="text-transform:uppercase; font-size:0.8rem;" class="font-mono">${q.question_type}</td>
      <td style="max-width:300px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${q.question}">${q.question}</td>
      <td style="max-width:180px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${ansText}">${ansText}</td>
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

  const payload = { topic, difficulty, question_type, question, options, answer, attachments: currentAttachments, is_active: true };

  try {
    let result;
    if (qId) {
      result = await supabase.from('questions').update(payload).eq('id', qId);
    } else {
      result = await supabase.from('questions').insert([payload]);
    }

    if (result.error) throw result.error;

    showToast('Question details updated in bank', 'success');
    closeModal('modal-question');
    loadQuestions();
  } catch (err) {
    console.error('Error saving question:', err);
    showToast(err.message || 'Error saving question', 'error');
  }
}

// Edit Question
function editQuestion(id) {
  const q = state.questions.find(item => item.id === id);
  if (!q) return;

  document.getElementById('question-id-input').value = q.id;
  document.getElementById('question-topic').value = q.topic;
  document.getElementById('question-difficulty').value = q.difficulty;
  document.getElementById('question-type').value = q.question_type;
  document.getElementById('question-text').value = q.question;
  document.getElementById('question-answer').value = q.answer;

  toggleQuestionOptions(); // Update layout

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

