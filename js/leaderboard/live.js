// Spectator Leaderboard Realtime Module
import { supabase } from '../config.js';
import { showToast, formatTime } from '../utils.js';

let selectedSessionId = null;
let realtimeChannel = null;
let sessionCheckerChannel = null;

let latestWinner = null;
let introLogInterval = null;
let introCountdownInterval = null;
let introAutoDismissTimeout = null;
let introConfettiInterval = null;

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', async () => {
  // Prevent player access to leaderboard
  const existingToken = localStorage.getItem('quest_player_token');
  if (existingToken) {
    window.location.replace(`play.html?token=${existingToken}`);
    return;
  }

  setupUIHandlers();
  await loadSessionsList();
});

// Setup dropdown selectors & overlay buttons
function setupUIHandlers() {
  const select = document.getElementById('leaderboard-session-select');
  select.addEventListener('change', () => {
    selectedSessionId = select.value;
    if (selectedSessionId) {
      // Update URL query parameters
      const url = new URL(window.location);
      url.searchParams.set('session', selectedSessionId);
      window.history.pushState({}, '', url);

      initializeLeaderboard();
    }
  });

  // Winner overlay close button
  const closeBtn = document.getElementById('winner-close-btn');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      const overlay = document.getElementById('winner-overlay');
      if (overlay) overlay.style.display = 'none';
    });
  }

  // Winner overlay celebrate again button
  const replayBtn = document.getElementById('winner-replay-btn');
  if (replayBtn) {
    replayBtn.addEventListener('click', () => {
      // Re-run the visual flash effect
      const flash = document.createElement('div');
      flash.className = 'screen-flash';
      document.body.appendChild(flash);
      setTimeout(() => flash.remove(), 400);

      // Re-trigger the animations on the card by resetting class/animation
      const card = document.querySelector('.winner-card');
      if (card) {
        card.style.animation = 'none';
        void card.offsetWidth; // Reflow
        card.style.animation = 'popIn 0.8s cubic-bezier(0.34, 1.56, 0.64, 1) forwards';
      }
      runDramaticConfettiPoppers();
    });
  }

  // Header "Show Winner" button
  const showWinnerBtn = document.getElementById('show-winner-btn');
  if (showWinnerBtn) {
    showWinnerBtn.addEventListener('click', async () => {
      if (!selectedSessionId) return;
      try {
        const { data: standings } = await supabase
          .from('leaderboard_view')
          .select('*')
          .eq('session_id', selectedSessionId);

        const sorted = (standings || []).sort((a, b) => {
          if (b.total_score !== a.total_score) return b.total_score - a.total_score;
          return a.elapsed_seconds - b.elapsed_seconds;
        });

        if (sorted.length > 0) {
          triggerWinnerAnnouncement(sorted[0]);
        }
      } catch (err) {
        console.error('Error opening manual winner announcement:', err);
      }
    });
  }

  // Header "Intro Show" button
  const replayIntroBtn = document.getElementById('replay-intro-btn');
  if (replayIntroBtn) {
    replayIntroBtn.addEventListener('click', async () => {
      if (!selectedSessionId) return;
      try {
        const { data: standings } = await supabase
          .from('leaderboard_view')
          .select('*')
          .eq('session_id', selectedSessionId);

        const sorted = (standings || []).sort((a, b) => {
          if (b.total_score !== a.total_score) return b.total_score - a.total_score;
          return a.elapsed_seconds - b.elapsed_seconds;
        });

        if (sorted.length > 0) {
          startSuspenseIntro(sorted[0]);
        }
      } catch (err) {
        console.error('Error starting manual intro show:', err);
      }
    });
  }

  // Intro Skip button
  const skipIntroBtn = document.getElementById('skip-intro-btn');
  if (skipIntroBtn) {
    skipIntroBtn.addEventListener('click', dismissSuspenseIntro);
  }

  // Intro Enter Console button
  const enterBtn = document.getElementById('intro-enter-btn');
  if (enterBtn) {
    enterBtn.addEventListener('click', dismissSuspenseIntro);
  }

  // Persistent Celebrate button
  const celebrateBtn = document.getElementById('celebrate-btn');
  if (celebrateBtn) {
    celebrateBtn.addEventListener('click', () => {
      runDramaticConfettiPoppers();
    });
  }
}

// Load sessions into the select dropdown
async function loadSessionsList() {
  const select = document.getElementById('leaderboard-session-select');
  select.innerHTML = '<option value="">Loading sessions...</option>';

  try {
    const { data, error } = await supabase
      .from('sessions')
      .select('id, title, status')
      .in('status', ['active', 'completed'])
      .order('created_at', { ascending: false });

    if (error) throw error;

    select.innerHTML = '';
    
    if (!data || data.length === 0) {
      select.innerHTML = '<option value="">No active sessions found</option>';
      return;
    }

    data.forEach(sess => {
      const opt = document.createElement('option');
      opt.value = sess.id;
      opt.text = `${sess.title} (${sess.status.toUpperCase()})`;
      select.appendChild(opt);
    });

    // Check URL parameters for starting session
    const params = new URLSearchParams(window.location.search);
    const urlSessId = params.get('session');

    if (urlSessId && data.find(s => s.id === urlSessId)) {
      selectedSessionId = urlSessId;
      select.value = urlSessId;
    } else {
      // Default to the first session (usually the most recent active one)
      selectedSessionId = data[0].id;
      select.value = data[0].id;
    }

    initializeLeaderboard();
  } catch (err) {
    console.error('Error loading sessions roster:', err);
    select.innerHTML = '<option value="">Error loading sessions</option>';
  }
}

// Start leaderboard loops
async function initializeLeaderboard() {
  // Clear previous subscriptions
  if (realtimeChannel) {
    supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
  if (sessionCheckerChannel) {
    supabase.removeChannel(sessionCheckerChannel);
    sessionCheckerChannel = null;
  }

  await fetchAndRenderStandings();
  setupRealtimeListeners();
}

// Fetch telemetry ranks
async function fetchAndRenderStandings() {
  if (!selectedSessionId) return;

  try {
    // 1. Fetch standings view
    const { data: standings, error: standErr } = await supabase
      .from('leaderboard_view')
      .select('*')
      .eq('session_id', selectedSessionId);

    if (standErr) throw standErr;

    // 2. Fetch session details (to check status)
    const { data: session, error: sessErr } = await supabase
      .from('sessions')
      .select('*')
      .eq('id', selectedSessionId)
      .single();

    if (sessErr) throw sessErr;

    // Sort: 1. Highest Score, 2. Shortest elapsed time
    const sorted = (standings || []).sort((a, b) => {
      if (b.total_score !== a.total_score) {
        return b.total_score - a.total_score;
      }
      return a.elapsed_seconds - b.elapsed_seconds;
    });

    // Save latest winner data
    latestWinner = sorted.length > 0 ? sorted[0] : null;

    // Update Status Badge UI
    const badge = document.getElementById('leaderboard-status-badge');
    const showWinnerBtn = document.getElementById('show-winner-btn');
    const replayIntroBtn = document.getElementById('replay-intro-btn');
    if (session.status === 'completed') {
      badge.className = 'badge badge--danger';
      badge.innerText = 'SESSION COMPLETED';
      if (showWinnerBtn) showWinnerBtn.style.display = 'inline-flex';
      if (replayIntroBtn) replayIntroBtn.style.display = 'inline-flex';

      // Automatically trigger intro show once per spectator page session load
      if (sorted.length > 0) {
        const introKey = `intro_played_${selectedSessionId}`;
        const announcementKey = `announced_${selectedSessionId}`;
        
        if (!sessionStorage.getItem(introKey)) {
          startSuspenseIntro(sorted[0]);
          sessionStorage.setItem(introKey, 'true');
          sessionStorage.setItem(announcementKey, 'true'); // mark both
        } else if (!sessionStorage.getItem(announcementKey)) {
          triggerWinnerAnnouncement(sorted[0]);
          sessionStorage.setItem(announcementKey, 'true');
        }
      }
    } else {
      badge.className = 'badge badge--success';
      badge.innerText = 'LIVE TRACKING';
      if (showWinnerBtn) showWinnerBtn.style.display = 'none';
      if (replayIntroBtn) replayIntroBtn.style.display = 'none';

      // Hide overlays if session is reset or active
      const overlay = document.getElementById('winner-overlay');
      if (overlay) overlay.style.display = 'none';
      const intro = document.getElementById('spectator-intro');
      if (intro) intro.style.display = 'none';
    }

    // Render podium elements
    renderPodium(sorted);

    // Render complete roster table
    renderRosterTable(sorted);
  } catch (err) {
    console.error('Error rendering standings:', err);
  }
}

// Render podium columns
function renderPodium(sorted) {
  const gold = document.getElementById('podium-gold');
  const silver = document.getElementById('podium-silver');
  const bronze = document.getElementById('podium-bronze');

  // Clear previous displays
  gold.style.display = 'none';
  silver.style.display = 'none';
  bronze.style.display = 'none';

  if (sorted.length > 0) {
    // 1st Place
    gold.style.display = 'flex';
    gold.querySelector('.podium-team-name').innerText = sorted[0].team_name;
    gold.querySelector('.podium-stats').innerText = `${sorted[0].total_score} pts // ${sorted[0].checkpoints_completed} CPs`;
  }

  if (sorted.length > 1) {
    // 2nd Place
    silver.style.display = 'flex';
    silver.querySelector('.podium-team-name').innerText = sorted[1].team_name;
    silver.querySelector('.podium-stats').innerText = `${sorted[1].total_score} pts // ${sorted[1].checkpoints_completed} CPs`;
  }

  if (sorted.length > 2) {
    // 3rd Place
    bronze.style.display = 'flex';
    bronze.querySelector('.podium-team-name').innerText = sorted[2].team_name;
    bronze.querySelector('.podium-stats').innerText = `${sorted[2].total_score} pts // ${sorted[2].checkpoints_completed} CPs`;
  }
}

// Render full roster table
function renderRosterTable(sorted) {
  const tbody = document.getElementById('leaderboard-table-body');
  tbody.innerHTML = '';

  if (sorted.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted">No telemetry received</td></tr>`;
    return;
  }

  // Slice off the podium or show everyone (let's display everyone so it's a complete record)
  sorted.forEach((row, idx) => {
    const tr = document.createElement('tr');
    
    let rankText = `#${idx + 1}`;
    if (idx === 0) rankText = '🥇 #1';
    if (idx === 1) rankText = '🥈 #2';
    if (idx === 2) rankText = '🥉 #3';

    tr.innerHTML = `
      <td class="font-mono" style="font-weight:700; color:var(--color-warning);">${rankText}</td>
      <td style="font-weight:600; font-family:var(--font-title);">${row.team_name}</td>
      <td class="font-mono text-accent" style="font-weight:700;">${row.total_score} points</td>
      <td class="font-mono text-secondary">${row.checkpoints_completed} completed</td>
      <td class="font-mono text-muted">${formatTime(row.elapsed_seconds)}</td>
    `;
    
    tbody.appendChild(tr);
  });
}

// Listen to Realtime Postgres modifications
function setupRealtimeListeners() {
  if (!selectedSessionId) return;

  // 1. Subscribe to answers submission event
  realtimeChannel = supabase
    .channel('leaderboard-standings')
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'player_answers'
    }, async (payload) => {
      console.log('Roster update payload:', payload);
      await fetchAndRenderStandings();
    })
    .subscribe();

  // 2. Subscribe to session changes (to watch completion event)
  sessionCheckerChannel = supabase
    .channel('leaderboard-session-state')
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'sessions',
      filter: `id=eq.${selectedSessionId}`
    }, async (payload) => {
      console.log('Session state update:', payload.new);
      if (payload.new.status === 'completed') {
        showToast('GAME COMPLETED // FINAL RANKS ANNOUNCED', 'accent');
      }
      await fetchAndRenderStandings();
    })
    .subscribe();
}

// Trigger the dramatic winner announcement overlay
function triggerWinnerAnnouncement(winner) {
  if (!winner) return;

  const overlay = document.getElementById('winner-overlay');
  if (!overlay) return;

  // Set winner details
  document.getElementById('winner-name-text').innerText = winner.team_name;
  document.getElementById('winner-score-text').innerText = `${winner.total_score} PTS`;
  document.getElementById('winner-cps-text').innerText = `${winner.checkpoints_completed}`;
  document.getElementById('winner-time-text').innerText = formatTime(winner.elapsed_seconds);

  // Show overlay
  overlay.style.display = 'flex';

  // 1. Create a dramatic screen flash
  const flash = document.createElement('div');
  flash.className = 'screen-flash';
  document.body.appendChild(flash);
  setTimeout(() => flash.remove(), 400);

  // 2. Play intense "popper" confetti bursts
  runDramaticConfettiPoppers();
}

// Play intense confetti poppers and a background celebration shower
function runDramaticConfettiPoppers() {
  const confettiFunc = window.confetti;
  if (typeof confettiFunc !== 'function') {
    console.warn('confetti is not loaded or not a function');
    return;
  }

  // Left party popper explosion
  confettiFunc({
    particleCount: 120,
    spread: 70,
    angle: 60,
    origin: { x: 0.15, y: 0.85 },
    startVelocity: 60,
    colors: ['#22a7c4', '#1a7a9e', '#d9930b', '#dc4a4a', '#ffffff'],
    scalar: 1.2
  });

  // Right party popper explosion
  confettiFunc({
    particleCount: 120,
    spread: 70,
    angle: 120,
    origin: { x: 0.85, y: 0.85 },
    startVelocity: 60,
    colors: ['#22a7c4', '#1a7a9e', '#d9930b', '#dc4a4a', '#ffffff'],
    scalar: 1.2
  });

  // Delayed secondary center burst
  setTimeout(() => {
    confettiFunc({
      particleCount: 80,
      spread: 100,
      origin: { x: 0.5, y: 0.65 },
      startVelocity: 40,
      colors: ['#22a7c4', '#1a7a9e', '#ffffff']
    });
  }, 400);

  // Continuous background shower for 5 seconds
  const end = Date.now() + 5000;
  const colors = ['#22a7c4', '#1a7a9e', '#d9930b', '#dc4a4a'];

  (function frame() {
    confettiFunc({
      particleCount: 3,
      angle: 60,
      spread: 55,
      origin: { x: 0 },
      colors: colors
    });
    confettiFunc({
      particleCount: 3,
      angle: 120,
      spread: 55,
      origin: { x: 1 },
      colors: colors
    });

    if (Date.now() < end) {
      requestAnimationFrame(frame);
    }
  }());
}

// Start the dramatic, suspenseful loading & reveal intro
function startSuspenseIntro(winner) {
  if (!winner) return;

  const intro = document.getElementById('spectator-intro');
  if (!intro) return;

  // Clear any existing intervals first
  if (introLogInterval) clearInterval(introLogInterval);
  if (introCountdownInterval) clearInterval(introCountdownInterval);
  if (introAutoDismissTimeout) clearTimeout(introAutoDismissTimeout);
  if (introConfettiInterval) clearInterval(introConfettiInterval);

  // Populate details
  document.getElementById('intro-winner-team').innerText = winner.team_name;
  document.getElementById('intro-winner-stats').innerText = `${winner.total_score} PTS // ${winner.checkpoints_completed} CPs`;

  // Show intro overlay
  intro.style.display = 'flex';

  // Reset stages
  document.getElementById('intro-stage-loading').style.display = 'block';
  document.getElementById('intro-stage-countdown').style.display = 'none';
  document.getElementById('intro-stage-reveal').style.display = 'none';

  const progress = document.getElementById('intro-progress');
  const logs = document.getElementById('intro-logs');
  progress.style.width = '0%';
  logs.innerHTML = '';

  // Log queues
  const logMessages = [
    '> [INFO] ESTABLISHING TELMETRY SYNC LOOP...',
    '> [OK] CONNECTED TO CORE CLOUD STORAGE',
    '> [WARN] SECURE CONNECTION KEY REQUIRED // AUTHORIZED',
    '> [OK] DOWNLOADING CRYPTOGRAPHIC ROSTER CHECKSUMS...',
    '> [OK] FINAL RANKS DECRYPTED // LAUNCHING SIGNAL...'
  ];

  let currentLogIdx = 0;
  introLogInterval = setInterval(() => {
    if (currentLogIdx < logMessages.length) {
      const logDiv = document.createElement('div');
      logDiv.innerText = logMessages[currentLogIdx];
      logs.appendChild(logDiv);
      logs.scrollTop = logs.scrollHeight;
      currentLogIdx++;
      progress.style.width = `${(currentLogIdx / logMessages.length) * 100}%`;
    } else {
      clearInterval(introLogInterval);
      setTimeout(() => {
        runCountdownStage(winner);
      }, 500);
    }
  }, 400); // 2 seconds total loading stage
}

// Run the physical shake countdown stage
function runCountdownStage(winner) {
  document.getElementById('intro-stage-loading').style.display = 'none';
  const countdownStage = document.getElementById('intro-stage-countdown');
  countdownStage.style.display = 'block';

  const countdownText = document.getElementById('intro-countdown');
  const intro = document.getElementById('spectator-intro');
  
  let countdownVal = 3;
  countdownText.innerText = countdownVal;
  triggerScreenShake(intro);

  introCountdownInterval = setInterval(() => {
    countdownVal--;
    if (countdownVal > 0) {
      countdownText.innerText = countdownVal;
      triggerScreenShake(intro);
    } else {
      clearInterval(introCountdownInterval);
      runRevealStage(winner);
    }
  }, 1000); // 3 seconds total countdown stage
}

// Add CSS shaking class and clean it up
function triggerScreenShake(elem) {
  elem.classList.add('screen-shake');
  setTimeout(() => {
    elem.classList.remove('screen-shake');
  }, 400);
}

// Execute reveal
function runRevealStage(winner) {
  document.getElementById('intro-stage-countdown').style.display = 'none';
  document.getElementById('intro-stage-reveal').style.display = 'block';

  // Popper explosions
  runIntroRevealConfetti();

  // Highlight close button / enter button action
  const enterBtn = document.getElementById('intro-enter-btn');
  
  // Auto-dismiss after 6 seconds of celebration
  introAutoDismissTimeout = setTimeout(dismissSuspenseIntro, 6000);
}

// Intense graffiti page climax confetti
function runIntroRevealConfetti() {
  const confettiFunc = window.confetti;
  if (typeof confettiFunc !== 'function') {
    console.warn('confetti is not loaded or not a function');
    return;
  }

  // Initial giant explosions
  confettiFunc({
    particleCount: 160,
    angle: 60,
    spread: 80,
    origin: { x: 0.1, y: 0.8 },
    startVelocity: 65,
    colors: ['#22a7c4', '#1a7a9e', '#d9930b', '#dc4a4a', '#ffffff'],
    scalar: 1.3
  });

  confettiFunc({
    particleCount: 160,
    angle: 120,
    spread: 80,
    origin: { x: 0.9, y: 0.8 },
    startVelocity: 65,
    colors: ['#22a7c4', '#1a7a9e', '#d9930b', '#dc4a4a', '#ffffff'],
    scalar: 1.3
  });

  // Series of rapid smaller pops
  introConfettiInterval = setInterval(() => {
    confettiFunc({
      particleCount: 40,
      angle: Math.random() > 0.5 ? 45 : 135,
      spread: 60,
      origin: { x: Math.random() > 0.5 ? 0.25 : 0.75, y: 0.75 }
    });
  }, 350);

  setTimeout(() => clearInterval(introConfettiInterval), 4000);
}

// Gracefully dismiss intro overlay and trigger static winner overlay card
function dismissSuspenseIntro() {
  if (introLogInterval) clearInterval(introLogInterval);
  if (introCountdownInterval) clearInterval(introCountdownInterval);
  if (introAutoDismissTimeout) clearTimeout(introAutoDismissTimeout);
  if (introConfettiInterval) clearInterval(introConfettiInterval);
  
  const intro = document.getElementById('spectator-intro');
  if (intro) {
    intro.style.transition = 'opacity 0.6s cubic-bezier(0.16, 1, 0.3, 1)';
    intro.style.opacity = '0';
    setTimeout(() => {
      intro.style.display = 'none';
      intro.style.opacity = '1'; // reset for future replays
      
      // Auto-trigger the static winner modal on the standings card now!
      if (latestWinner) {
        triggerWinnerAnnouncement(latestWinner);
      }
    }, 600);
  }
}
