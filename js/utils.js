// Shared Helper Utilities

// Toast notifications system
const MAX_TOASTS = 3;
let lastErrorTime = 0;
const ERROR_RATE_LIMIT_MS = 3000; // 3 seconds limit between error popups globally

function dismissToast(toast) {
  if (toast.dataset.dismissing) return;
  toast.dataset.dismissing = 'true';
  toast.style.animation = 'slideOutRight 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards';
  
  let removed = false;
  const remove = () => {
    if (removed) return;
    removed = true;
    toast.remove();
    // Fire callback if it exists
    if (toast.onCloseCallback && typeof toast.onCloseCallback === 'function') {
      try {
        toast.onCloseCallback();
      } catch (err) {
        console.error('Error in toast onClose callback:', err);
      }
    }
  };
  
  toast.addEventListener('animationend', remove);
  
  // Backup timeout in case animation fails to play or animationend doesn't fire
  setTimeout(remove, 350);
}

export function showToast(message, type = 'info', duration = 4000, onClose = null) {
  // Force errors and warnings to automatically disappear in 3 seconds (3000ms)
  if (type === 'error' || type === 'warning') {
    duration = 3000;
  }

  // Global rate limiter for errors/warnings across the entire codebase
  if (type === 'error' || type === 'warning') {
    const now = Date.now();
    if (now - lastErrorTime < ERROR_RATE_LIMIT_MS) {
      console.warn('Blocked duplicate error popup to prevent flooding:', message);
      // Execute the callback immediately since we are blocking the toast
      if (onClose && typeof onClose === 'function') {
        try { onClose(); } catch (e) {}
      }
      return;
    }
    lastErrorTime = now;
  }

  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  // Evict oldest toasts if at the limit
  while (container.children.length >= MAX_TOASTS) {
    dismissToast(container.children[0]);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  if (onClose) {
    toast.onCloseCallback = onClose;
  }
  
  let icon = '⚡';
  if (type === 'success') icon = '✓';
  if (type === 'error') icon = '✕';
  
  toast.innerHTML = `
    <span style="font-size: 1.25rem; display: flex; align-items: center;">${icon}</span>
    <div style="flex-grow: 1;">${sanitizeHTML(message)}</div>
    <button class="toast-close" aria-label="Dismiss" title="Dismiss">&times;</button>
  `;

  // Close button tap/click handlers
  const closeBtn = toast.querySelector('.toast-close');
  const handleClose = (e) => {
    e.stopPropagation();
    e.preventDefault();
    dismissToast(toast);
  };
  closeBtn.addEventListener('click', handleClose);
  closeBtn.addEventListener('touchstart', handleClose, { passive: false });

  // General toast body tap/click handlers to dismiss
  const handleBodyClick = (e) => {
    e.preventDefault();
    dismissToast(toast);
  };
  toast.addEventListener('click', handleBodyClick);
  toast.addEventListener('touchstart', handleBodyClick, { passive: false });

  container.appendChild(toast);

  // Auto-remove toast after duration
  setTimeout(() => {
    dismissToast(toast);
  }, duration);
}

// Simple HTML sanitizer to prevent XSS
export function sanitizeHTML(str) {
  if (!str) return '';
  const temp = document.createElement('div');
  temp.textContent = str;
  return temp.innerHTML;
}

// Format duration in seconds to MM:SS or HH:MM:SS
export function formatTime(seconds) {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const pad = (num) => String(num).padStart(2, '0');

  if (hrs > 0) {
    return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
  }
  return `${pad(mins)}:${pad(secs)}`;
}

// Generate secure random access token
export function generateToken(length = 16) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const array = new Uint8Array(length);
  window.crypto.getRandomValues(array);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[array[i] % chars.length];
  }
  return result;
}

// Copy text to clipboard and show feedback
export async function copyToClipboard(text, successMsg = 'Copied to clipboard!') {
  try {
    await navigator.clipboard.writeText(text);
    showToast(successMsg, 'success');
    return true;
  } catch (err) {
    console.error('Failed to copy: ', err);
    showToast('Failed to copy to clipboard', 'error');
    return false;
  }
}

// Debounce helper for inputs
export function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Check if user is on mobile
export function isMobile() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}
window.showToast = showToast;
