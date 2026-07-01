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

    let contentHtml = `
      <div class="challenge-prompt">
        <span class="text-secondary font-mono" style="margin-right: 5px;">Q${index + 1}.</span> 
        ${sanitizeHTML(q.question)}
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
