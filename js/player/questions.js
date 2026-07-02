// Player Questions Renderer
import { gameState } from './game.js';
import { sanitizeHTML } from '../utils.js';

// Render questions inside form list
export function renderQuestions(questions) {
  const container = document.getElementById('quiz-questions-list');
  container.innerHTML = '';

  // Update status labels
  document.getElementById('quiz-cp-name').innerText = gameState.currentCheckpoint.checkpoint_name;
  updateProgressLabel();

  questions.forEach((q, index) => {
    const block = document.createElement('div');
    block.className = 'challenge-item';
    block.setAttribute('data-id', q.id);
    block.setAttribute('data-type', q.question_type);

    let attachmentsHtml = '';
    if (q.attachments && q.attachments.length > 0) {
      attachmentsHtml = `<div class="question-attachments-list" style="margin-top: 10px; display: flex; flex-direction: column; gap: 8px;">`;
      q.attachments.forEach(att => {
        const isImage = att.type.startsWith('image/');
        if (isImage) {
          attachmentsHtml += `
            <div class="question-attachment-item" style="margin-top: 5px;">
              <img src="${att.data}" class="question-attachment-img" alt="${sanitizeHTML(att.name)}" onclick="expandPlayerImage(this)" style="max-width: 100%; border-radius: var(--radius-sm); border: 1px solid var(--border-color); cursor: zoom-in; transition: transform var(--transition-fast);">
            </div>
          `;
        } else {
          attachmentsHtml += `
            <a href="${att.data}" download="${sanitizeHTML(att.name)}" class="question-attachment-pdf-btn flex align-center justify-between" style="background: rgba(34, 167, 196, 0.03); border: 1px solid var(--border-color); border-radius: var(--radius-sm); padding: 0.6rem 0.8rem; text-decoration: none; color: var(--text-dark); transition: all var(--transition-fast); margin-top: 5px;">
              <span style="display:flex; align-items:center; gap:8px;">
                <span style="font-size: 1.1rem;">📄</span>
                <span style="font-weight: 600; text-decoration: underline;">${sanitizeHTML(att.name)}</span>
              </span>
              <span style="font-size: 0.7rem; color: var(--text-muted); font-family: var(--font-mono);">${formatBytes(att.size)}</span>
            </a>
          `;
        }
      });
      attachmentsHtml += `</div>`;
    }

    let contentHtml = `
      <div class="challenge-prompt">
        <span class="text-secondary font-mono" style="margin-right: 5px;">Q${index + 1}.</span> 
        ${sanitizeHTML(q.question)}
        ${attachmentsHtml}
      </div>
    `;

    if (q.question_type === 'mcq' && q.options) {
      contentHtml += `<div class="mcq-options-list">`;
      q.options.forEach((opt, optIndex) => {
        const optionId = `q-${index}-opt-${optIndex}`;
        contentHtml += `
          <label class="mcq-option" for="${optionId}">
            <input type="radio" name="q-${index}" id="${optionId}" value="${optIndex}" onchange="selectMCQOption(this)">
            <span class="font-mono" style="font-size:0.85rem; color:var(--text-dark);">${sanitizeHTML(opt)}</span>
          </label>
        `;
      });
      contentHtml += `</div>`;
    } else {
      contentHtml += `
        <div class="form-group" style="margin-bottom:0;">
          <input type="text" class="input font-mono" placeholder="Type decryptions here..." oninput="checkAnswersProgress()">
        </div>
      `;
    }

    block.innerHTML = contentHtml;
    container.appendChild(block);
  });
}

// Global handler bound to option label selection
window.selectMCQOption = function (radioInput) {
  // Clear selection classes in this group
  const parent = radioInput.closest('.mcq-options-list');
  parent.querySelectorAll('.mcq-option').forEach(el => el.classList.remove('selected'));

  // Highlight selected option
  const label = radioInput.closest('.mcq-option');
  label.classList.add('selected');

  checkAnswersProgress();
};

// Check answering progress count
window.checkAnswersProgress = function () {
  updateProgressLabel();
};

// Calculate and update progress indicator labels
function updateProgressLabel() {
  const container = document.getElementById('quiz-questions-list');
  const blocks = container.querySelectorAll('.challenge-item');
  let answered = 0;

  blocks.forEach(block => {
    const type = block.getAttribute('data-type');
    if (type === 'mcq') {
      const selected = block.querySelector('input[type="radio"]:checked');
      if (selected) answered++;
    } else {
      const val = block.querySelector('.input').value.trim();
      if (val) answered++;
    }
  });

  const label = document.getElementById('quiz-questions-count');
  label.innerText = `${answered} / ${blocks.length} solved`;
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

window.expandPlayerImage = function(img) {
  // Create simple lightbox
  let overlay = document.getElementById('player-image-lightbox');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'player-image-lightbox';
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100vw';
    overlay.style.height = '100vh';
    overlay.style.background = 'rgba(15, 23, 42, 0.9)';
    overlay.style.zIndex = '99999';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.cursor = 'zoom-out';
    overlay.style.opacity = '0';
    overlay.style.transition = 'opacity 0.25s ease';
    
    const largeImg = document.createElement('img');
    largeImg.id = 'player-lightbox-img';
    largeImg.style.maxWidth = '90%';
    largeImg.style.maxHeight = '90%';
    largeImg.style.borderRadius = 'var(--radius-sm)';
    largeImg.style.border = '1px solid var(--border-neon-primary)';
    largeImg.style.boxShadow = 'var(--glow-primary)';
    
    overlay.appendChild(largeImg);
    document.body.appendChild(overlay);
    
    overlay.addEventListener('click', () => {
      overlay.style.opacity = '0';
      setTimeout(() => {
        overlay.style.display = 'none';
      }, 250);
    });
  }
  
  const largeImg = document.getElementById('player-lightbox-img');
  largeImg.src = img.src;
  overlay.style.display = 'flex';
  // Trigger reflow
  overlay.offsetHeight;
  overlay.style.opacity = '1';
};
