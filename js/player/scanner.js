// Player QR Scanner Controller
import { supabase } from '../config.js';
import { showToast } from '../utils.js';
import { gameState, switchScreen } from './game.js';
import { renderQuestions } from './questions.js';

let html5QrScanner = null;

// Initialize Scanner object
export function initScanner() {
  // Config reader instance
  html5QrScanner = new Html5Qrcode("qr-reader");
}

// Start camera scan
export async function startScanner() {
  try {
    // Try starting directly with back camera (environment)
    await html5QrScanner.start(
      { facingMode: "environment" },
      {
        fps: 10,
        qrbox: { width: 250, height: 250 }
      },
      onScanSuccess,
      onScanFailure
    );
  } catch (err) {
    console.warn('Could not start with facingMode "environment", attempting fallback...', err);
    try {
      // Fallback: Query cameras list and start the first one
      const cameras = await Html5Qrcode.getCameras();
      if (cameras && cameras.length > 0) {
        await html5QrScanner.start(
          cameras[0].id,
          {
            fps: 10,
            qrbox: { width: 250, height: 250 }
          },
          onScanSuccess,
          onScanFailure
        );
      } else {
        showToast('No cameras detected on this device.', 'error');
        switchScreen('screen-hint');
      }
    } catch (fallbackErr) {
      console.error('Camera access error:', fallbackErr);
      showToast('Failed to start camera. Please verify device permissions.', 'error');
      switchScreen('screen-hint');
    }
  }
}

// Stop camera scan
export async function stopScanner() {
  if (html5QrScanner && html5QrScanner.isScanning) {
    try {
      await html5QrScanner.stop();
    } catch (err) {
      console.error('Failed to stop camera stream:', err);
    }
  }
}

// Scan cooldown state to prevent error flooding
let lastScannedValue = null;
let lastScanTime = 0;
const SCAN_COOLDOWN_MS = 3000; // 3 second cooldown for repeated wrong scans

// QR Scan success callback
async function onScanSuccess(decodedText, decodedResult) {
  // Validate scan format
  const scannedVal = decodedText.trim();
  console.log('Decoded code:', scannedVal);

  // Match scanned QR code identifier
  if (scannedVal === gameState.currentCheckpoint.qr_identifier) {
    // Reset cooldown state on correct scan
    lastScannedValue = null;
    lastScanTime = 0;

    // 1. Correct checkpoint scanned! Stop camera.
    await stopScanner();
    // Mark this checkpoint as scanned so it survives browser refresh
    localStorage.setItem('quest_scanned_cp', gameState.currentCheckpoint.id);
    showToast('Node handshake authorized! Opening challenges...', 'success');

    // 2. Fetch questions pre-assigned for this player at this checkpoint
    await fetchCheckpointQuestions();
  } else {
    // Cooldown check: skip if any wrong code was scanned recently (within 3 seconds)
    const now = Date.now();
    if ((now - lastScanTime) < SCAN_COOLDOWN_MS) {
      return; // Silently ignore repeated wrong scans during the cooldown
    }
    lastScanTime = now;

    // Pause the scanner feed to freeze screen and stop scan processing
    if (html5QrScanner && html5QrScanner.isScanning) {
      try {
        html5QrScanner.pause(true);
      } catch (err) {
        console.error('Failed to pause scanner:', err);
      }
    }

    // Resume scanning callback passed to toast dismiss handler
    const resumeScan = () => {
      if (html5QrScanner && html5QrScanner.isScanning) {
        try {
          html5QrScanner.resume();
        } catch (err) {
          console.error('Failed to resume scanner:', err);
        }
      }
    };

    // 2. Incorrect checkpoint scanned
    // Try to find if this belongs to a different checkpoint in the session
    const matchAny = gameState.allCheckpoints.find(c => c.qr_identifier === scannedVal);
    if (matchAny) {
      if (matchAny.is_completed) {
        showToast('This checkpoint node has already been decrypted.', 'warning', 3000, resumeScan);
      } else {
        showToast('Wrong order , Thiss is not your checkpoint', 'error', 3000, resumeScan);
      }
    } else {
      showToast('Invalid node code format detected.', 'error', 3000, resumeScan);
    }
  }
}

// Scanner frame check failure (logged but suppressed from UI)
function onScanFailure(error) {
  // console.warn(`QR scan error: ${error}`);
}

// Fetch assigned questions from database
export async function fetchCheckpointQuestions() {
  const pId = gameState.player.id;
  const cpId = gameState.currentCheckpoint.id;

  try {
    // 1. Fetch question IDs assigned to this player
    const { data: assigned, error: assignErr } = await supabase
      .from('player_checkpoint_questions')
      .select('question_id')
      .eq('player_id', pId)
      .eq('checkpoint_id', cpId);

    if (assignErr) throw assignErr;

    if (!assigned || assigned.length === 0) {
      throw new Error('No questions assigned by system. Contact admin.');
    }

    const qIds = assigned.map(a => a.question_id);

    // 2. Query questions content from secure public view
    const { data: questions, error: qErr } = await supabase
      .from('questions_public')
      .select('*')
      .in('id', qIds);

    if (qErr) throw qErr;

    gameState.assignedQuestions = questions || [];

    // Render questions to form
    renderQuestions(gameState.assignedQuestions);
    
    // Transition screen
    switchScreen('screen-questions');
  } catch (err) {
    console.error('Error fetching questions:', err);
    showToast(err.message || 'Failed to load challenges', 'error');
    switchScreen('screen-hint');
  }
}
