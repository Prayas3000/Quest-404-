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
    const cameras = await Html5Qrcode.getCameras();
    
    if (cameras && cameras.length > 0) {
      // Prefer back camera if available
      let backCam = cameras.find(c => c.label.toLowerCase().includes('back') || c.label.toLowerCase().includes('environment'));
      const cameraId = backCam ? backCam.id : cameras[0].id;

      await html5QrScanner.start(
        cameraId,
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
  } catch (err) {
    console.error('Camera access error:', err);
    showToast('Failed to start camera. Please verify device permissions.', 'error');
    switchScreen('screen-hint');
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

// QR Scan success callback
async function onScanSuccess(decodedText, decodedResult) {
  // Validate scan format
  const scannedVal = decodedText.trim();
  console.log('Decoded code:', scannedVal);

  // Match scanned QR code identifier
  if (scannedVal === gameState.currentCheckpoint.qr_identifier) {
    // 1. Correct checkpoint scanned! Stop camera.
    await stopScanner();
    showToast('Node handshake authorized! Opening challenges...', 'success');

    // 2. Fetch questions pre-assigned for this player at this checkpoint
    await fetchCheckpointQuestions();
  } else {
    // 2. Incorrect checkpoint scanned
    // Try to find if this belongs to a different checkpoint in the session
    const matchAny = gameState.allCheckpoints.find(c => c.qr_identifier === scannedVal);
    if (matchAny) {
      if (matchAny.is_completed) {
        showToast('This checkpoint node has already been decrypted.', 'warning');
      } else {
        showToast('Out-of-order checkpoint. Verify coordinates and try again.', 'error');
      }
    } else {
      showToast('Invalid node code format detected.', 'error');
    }
  }
}

// Scanner frame check failure (logged but suppressed from UI)
function onScanFailure(error) {
  // console.warn(`QR scan error: ${error}`);
}

// Fetch assigned questions from database
async function fetchCheckpointQuestions() {
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
