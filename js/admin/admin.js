// Admin Console Main Coordinator
import { supabase } from '../config.js';
import { adminLogin, adminLogout, getCurrentAdmin, onAuthChange } from '../auth.js';
import { showToast } from '../utils.js';

// Import feature sub-modules
import { initSessions } from './sessions.js';
import { initTeams } from './teams.js';
import { initPlayers } from './players.js';
import { initCheckpoints } from './checkpoints.js';
import { initQuestions } from './questions.js';
import { initRoutes } from './routes.js';
import { initDashboard, shutdownDashboard } from './dashboard.js';

// Global application state
export const state = {
  currentTab: 'dashboard',
  activeSession: null,
  activeUser: null,
  sessions: [],
  teams: [],
  players: [],
  checkpoints: [],
  questions: []
};

// Initialize Application on load
document.addEventListener('DOMContentLoaded', async () => {
  setupAuthListeners();
  setupTabListeners();
  
  // Check current session
  const admin = await getCurrentAdmin();
  if (admin) {
    state.activeUser = admin;
    showDashboard(admin);
  } else {
    showLogin();
  }
});

// Setup Auth Listeners
function setupAuthListeners() {
  const loginForm = document.getElementById('login-form');
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    
    const result = await adminLogin(email, password);
    if (result.success) {
      state.activeUser = result.session.user;
      showDashboard(result.session.user);
    }
  });

  const logoutBtn = document.getElementById('logout-btn');
  logoutBtn.addEventListener('logout-trigger', async () => {
    await adminLogout();
  });
  logoutBtn.addEventListener('click', () => {
    logoutBtn.dispatchEvent(new Event('logout-trigger'));
  });

  // Watch Auth State
  onAuthChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      showLogin();
      shutdownDashboard();
    }
  });
}

// Show/Hide Portals
function showLogin() {
  document.getElementById('auth-portal').style.display = 'flex';
  document.getElementById('dashboard-app').style.display = 'none';
}

async function showDashboard(user) {
  document.getElementById('auth-portal').style.display = 'none';
  document.getElementById('dashboard-app').style.display = 'grid';
  document.getElementById('admin-user-display').innerText = user.email;
  
  // Fetch active session if any exists
  await checkActiveSession();
  
  // Initialize tab sub-modules
  initDashboard();
  initSessions();
  initTeams();
  initPlayers();
  initCheckpoints();
  initQuestions();
  initRoutes();
}

// Check if there is an active session
export async function checkActiveSession() {
  try {
    const { data, error } = await supabase
      .from('sessions')
      .select('*')
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    const indicator = document.getElementById('active-session-indicator');
    const nameLabel = document.getElementById('active-session-name');

    if (data) {
      state.activeSession = data;
      indicator.className = 'badge badge--success';
      indicator.innerText = 'SESSION ACTIVE';
      nameLabel.innerText = `// ${data.title}`;
    } else {
      state.activeSession = null;
      indicator.className = 'badge badge--warning';
      indicator.innerText = 'NO ACTIVE SESSION';
      nameLabel.innerText = '';
    }
  } catch (err) {
    console.error('Error fetching active session:', err);
  }
}

// Tab switcher logic
function setupTabListeners() {
  const navItems = document.querySelectorAll('.nav-item');
  const title = document.getElementById('current-tab-title');

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const tabId = item.getAttribute('data-tab');
      
      // Update UI menu
      navItems.forEach(nav => nav.classList.remove('active'));
      item.classList.add('active');
      
      // Update Title
      title.innerText = item.innerText.replace(/[^\w\s]/gi, '').trim();

      // Toggle tab views
      document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));
      const activePane = document.getElementById(`tab-${tabId}`);
      if (activePane) {
        activePane.classList.add('active');
      }

      state.currentTab = tabId;
      triggerTabReload(tabId);
    });
  });
}

// Trigger reloading data when a tab is selected
function triggerTabReload(tabId) {
  // Fire event to let sub-modules refresh their views
  const event = new CustomEvent(`tab-reload-${tabId}`);
  document.dispatchEvent(event);
}
