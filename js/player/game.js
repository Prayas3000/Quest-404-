// Player Game Central Coordinator
import { supabase } from '../config.js';
import { showToast, formatTime } from '../utils.js';
import { initScanner, startScanner, stopScanner } from './scanner.js';
import { renderQuestions } from './questions.js';

export const gameState = {
  token: null,
  player: null, // {id, name, team_name, current_checkpoint_id}
  session: null, // {id, title, status, duration, started_at}
  currentCheckpoint: null, // Checkpoint data
  allCheckpoints: [], // List of checkpoints in session
  assignedQuestions: [], // Questions for current checkpoint
  timerInterval: null
};

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', async () => {
  setupUIHandlers();
  
  // 1. Extract Token from URL parameters or localStorage fallback
  const params = new URLSearchParams(window.location.search);
  let token = params.get('token');
  if (!token) {
    token = localStorage.getItem('quest_player_token');
  }

  if (!token) {
    showToast('Missing player access token. Redirecting to landing...', 'error');
    setTimeout(() => { window.location.href = 'index.html'; }, 3000);
    return;
  }

  gameState.token = token;
  
  // 2. Initialize scanner
  initScanner();

  // 3. Load or restore player state from backend
  await refreshPlayerState();
});

// Setup click handlers for buttons
function setupUIHandlers() {
  // Hint Screen -> Open Scanner
  document.getElementById('btn-open-scanner').addEventListener('click', () => {
    switchScreen('screen-scanner');
    startScanner();
  });

  // Scanner Screen -> Close/Cancel
  document.getElementById('btn-close-scanner').addEventListener('click', () => {
    stopScanner();
    switchScreen('screen-hint');
  });

  // Quiz Form submission
  document.getElementById('quiz-form').addEventListener('submit', handleAnswersSubmission);

  // Play Again / Reset token
  document.getElementById('btn-play-again').addEventListener('click', () => {
    localStorage.removeItem('quest_player_token');
    window.location.href = 'index.html';
  });
}

// Switch between full screen views
export function switchScreen(screenId) {
  document.querySelectorAll('.screen').forEach(scr => scr.classList.remove('active'));
  const activeScr = document.getElementById(screenId);
  if (activeScr) {
    activeScr.classList.add('active');
  }
}

let playerSubscription = null;
let sessionSubscription = null;
let routeSubscription = null;

// Initialize real-time updates for players waiting on assignment or game start
function initRealtimeSubscription() {
  if (!playerSubscription && gameState.player && gameState.player.id) {
    playerSubscription = supabase
      .channel(`player-status-${gameState.player.id}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'players',
        filter: `id=eq.${gameState.player.id}`
      }, async (payload) => {
        console.log('Realtime player update:', payload.new);
        if (payload.new.team_id) {
          showToast('Team assigned! Waiting for game to start...', 'success');
          await refreshPlayerState(true);
        }
      })
      .subscribe();
  }

  if (!sessionSubscription && gameState.session && gameState.session.id) {
    sessionSubscription = supabase
      .channel(`session-status-${gameState.session.id}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'sessions',
        filter: `id=eq.${gameState.session.id}`
      }, async (payload) => {
        console.log('Realtime session update:', payload.new);
        if (payload.new.status === 'active') {
          showToast('Game started! Initializing hunt...', 'success');
          await refreshPlayerState(true);
        }
      })
      .subscribe();
  }

  if (!routeSubscription && gameState.player && gameState.player.id) {
    routeSubscription = supabase
      .channel(`player-routes-${gameState.player.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'player_routes',
        filter: `player_id=eq.${gameState.player.id}`
      }, async (payload) => {
        console.log('Realtime route inserted:', payload.new);
        showToast('Route generated! Starting game...', 'success');
        await refreshPlayerState(true);
      })
      .subscribe();
  }
}

// Load current state from Supabase definer RPC function
export async function refreshPlayerState(showLoader = false) {
  if (showLoader) {
    switchScreen('screen-loader');
  }

  try {
    const { data, error } = await supabase.rpc('get_or_create_player_state', {
      p_token: gameState.token
    });

    if (error) throw error;
    if (!data.success) throw new Error(data.error);

    gameState.player = data.player;
    gameState.session = data.session;

    // Set user profile display
    document.getElementById('player-profile-name').innerText = gameState.player.player_name;
    document.getElementById('player-profile-team').innerText = gameState.player.team_name;

    // PRIORITY 1: Unassigned players always go to waiting screen
    // This must be checked BEFORE session status to avoid showing "Quest Resolved" to new registrants
    if (gameState.player.team_name === 'Unassigned') {
      if (playerSubscription) { supabase.removeChannel(playerSubscription); playerSubscription = null; }
      if (sessionSubscription) { supabase.removeChannel(sessionSubscription); sessionSubscription = null; }
      if (routeSubscription) { supabase.removeChannel(routeSubscription); routeSubscription = null; }
      switchScreen('screen-waiting');
      initRealtimeSubscription();
      return;
    }

    // PRIORITY 2: Session is completed — game is over for real players
    if (gameState.session.status === 'completed') {
      if (playerSubscription) { supabase.removeChannel(playerSubscription); playerSubscription = null; }
      if (sessionSubscription) { supabase.removeChannel(sessionSubscription); sessionSubscription = null; }
      if (routeSubscription) { supabase.removeChannel(routeSubscription); routeSubscription = null; }
      showToast('This event has already concluded.', 'info');
      switchScreen('screen-completed');
      return;
    }

    // PRIORITY 3: Session is draft — game hasn't started yet
    if (gameState.session.status === 'draft') {
      switchScreen('screen-waiting');
      initRealtimeSubscription();
      return;
    }

    // --- Session is ACTIVE from here ---

    // Start timer synchronization
    syncTimer();

    // Load Checkpoints list to find ordering / total count
    await loadSessionCheckpoints();

    // Branch screen rendering
    if (!gameState.player.current_checkpoint_id) {
      // Check if player actually has any routes assigned
      const hasRoutes = gameState.allCheckpoints.some(c => c.route_order !== null);
      if (!hasRoutes) {
        // No routes generated for this player yet — keep waiting
        switchScreen('screen-waiting');
        initRealtimeSubscription();
        return;
      }
      
      // Clean up subscriptions since active gameplay setup is complete
      if (playerSubscription) { supabase.removeChannel(playerSubscription); playerSubscription = null; }
      if (sessionSubscription) { supabase.removeChannel(sessionSubscription); sessionSubscription = null; }
      if (routeSubscription) { supabase.removeChannel(routeSubscription); routeSubscription = null; }

      // Has routes but no current checkpoint = completed all checkpoints!
      await showGameCompletion();
    } else {
      // Fetch details of current checkpoint
      await loadCurrentCheckpointDetails();

      // Clean up subscriptions since active gameplay setup is complete
      if (playerSubscription) { supabase.removeChannel(playerSubscription); playerSubscription = null; }
      if (sessionSubscription) { supabase.removeChannel(sessionSubscription); sessionSubscription = null; }
      if (routeSubscription) { supabase.removeChannel(routeSubscription); routeSubscription = null; }

      switchScreen('screen-hint');
    }
  } catch (err) {
    console.error('Error initializing state:', err);
    showToast(err.message || 'Verification failed. Contact Admin.', 'error');
  }
}

// Load checkpoint info (to show count like 2 of 5, and match scanned QR code)
async function loadSessionCheckpoints() {
  try {
    // 1. Fetch checkpoints
    const { data: cps, error: cpErr } = await supabase
      .from('checkpoints')
      .select('id, checkpoint_name, hint, qr_identifier')
      .eq('session_id', gameState.session.id)
      .order('created_at', { ascending: true });

    if (cpErr) throw cpErr;
    gameState.allCheckpoints = cps || [];

    // 2. Fetch player route progress order
    const { data: routes, error: routeErr } = await supabase
      .from('player_routes')
      .select('checkpoint_id, route_order, is_completed')
      .eq('player_id', gameState.player.id)
      .order('route_order', { ascending: true });

    if (routeErr) throw routeErr;

    // Enrich checkpoints with player ordering
    gameState.allCheckpoints.forEach(cp => {
      const match = (routes || []).find(r => r.checkpoint_id === cp.id);
      cp.route_order = match ? match.route_order : null;
      cp.is_completed = match ? match.is_completed : false;
    });

    // Sort checkpoints by player's route order
    gameState.allCheckpoints.sort((a, b) => a.route_order - b.route_order);
  } catch (err) {
    console.error('Error loading session checkpoints:', err);
  }
}

// Fetch current active checkpoint detailed hints
async function loadCurrentCheckpointDetails() {
  const cpId = gameState.player.current_checkpoint_id;
  const match = gameState.allCheckpoints.find(c => c.id === cpId);

  if (match) {
    gameState.currentCheckpoint = match;

    // Update Hint UI Labels
    const completedCount = gameState.allCheckpoints.filter(c => c.is_completed).length;
    document.getElementById('hint-cp-number').innerText = `Checkpoint ${match.route_order || 'Node'}`;
    document.getElementById('hint-cp-total').innerText = `${completedCount + 1} / ${gameState.allCheckpoints.length}`;
    document.getElementById('checkpoint-hint-box').innerText = match.hint;
  }
}

// Timer loops
function syncTimer() {
  if (gameState.timerInterval) clearInterval(gameState.timerInterval);

  const startedAt = new Date(gameState.session.started_at);
  const durationSec = gameState.session.duration * 60;
  const timerLabel = document.getElementById('player-timer');

  gameState.timerInterval = setInterval(() => {
    const elapsed = Math.floor((new Date() - startedAt) / 1000);
    const remaining = durationSec - elapsed;

    if (remaining <= 0) {
      clearInterval(gameState.timerInterval);
      timerLabel.innerText = '00:00';
      showToast('Game session has expired. Interface locked.', 'warning');
      switchScreen('screen-completed');
    } else {
      timerLabel.innerText = formatTime(remaining);
    }
  }, 1000);
}

// Show final completed screen
async function showGameCompletion() {
  if (gameState.timerInterval) clearInterval(gameState.timerInterval);
  
  // Confetti celebration!
  if (typeof confetti !== 'undefined') {
    confetti({ particleCount: 150, spread: 80, origin: { y: 0.6 } });
  }

  // Load player answers to display score
  try {
    const { data } = await supabase
      .from('player_answers')
      .select('id, is_correct')
      .eq('player_id', gameState.player.id);
    
    const score = data ? data.filter(a => a.is_correct).length : 0;
    document.getElementById('summary-score').innerText = `${score} points`;
  } catch (err) {
    console.error(err);
  }

  switchScreen('screen-completed');
}

// Handle Form Submission of answers
async function handleAnswersSubmission(e) {
  e.preventDefault();
  
  // Compile answers
  const answers = [];
  const container = document.getElementById('quiz-questions-list');
  const blocks = container.querySelectorAll('.challenge-item');

  let allAnswered = true;

  blocks.forEach(block => {
    const questionId = block.getAttribute('data-id');
    const type = block.getAttribute('data-type');
    let submitted_answer = '';

    if (type === 'mcq') {
      const selected = block.querySelector('input[type="radio"]:checked');
      if (selected) {
        submitted_answer = selected.value;
      } else {
        allAnswered = false;
      }
    } else {
      submitted_answer = block.querySelector('.input').value.trim();
      if (!submitted_answer) {
        allAnswered = false;
      }
    }

    answers.push({ question_id: questionId, submitted_answer });
  });

  if (!allAnswered) {
    showToast('Verify all challenge checkpoints before transmitting.', 'warning');
    return;
  }

  // Submit answers to Database RPC definer function
  switchScreen('screen-loader');

  try {
    const { data, error } = await supabase.rpc('submit_checkpoint_answers', {
      p_token: gameState.token,
      p_checkpoint_id: gameState.currentCheckpoint.id,
      p_answers: answers
    });

    if (error) throw error;
    if (!data.success) throw new Error(data.error);

    // Show correct / total results toast
    const msg = `TRANSMISSION COMMITTED // Correct: ${data.correct}/${data.total}`;
    if (data.correct === data.total) {
      showToast(msg, 'success');
    } else {
      showToast(msg, 'info');
    }

    // Refresh state and load next checkpoint
    setTimeout(async () => {
      await refreshPlayerState(true);
    }, 1500);

  } catch (err) {
    console.error('Submission error:', err);
    showToast(err.message || 'Transmission failed.', 'error');
    switchScreen('screen-questions');
  }
}
