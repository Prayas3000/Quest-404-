// Admin Authentication Controller
import { supabase } from './config.js';
import { showToast } from './utils.js';

// Admin Login
export async function adminLogin(email, password) {
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      showToast(error.message, 'error');
      return { success: false, error };
    }

    showToast('Admin authorized. Welcome to Control Center.', 'success');
    return { success: true, session: data.session };
  } catch (err) {
    console.error('Login error:', err);
    showToast('Authentication error', 'error');
    return { success: false, error: err };
  }
}

// Admin Logout
export async function adminLogout() {
  try {
    const { error } = await supabase.auth.signOut();
    if (error) {
      showToast(error.message, 'error');
      return false;
    }
    showToast('Session ended. Redirecting...', 'info');
    setTimeout(() => {
      window.location.href = 'index.html';
    }, 1000);
    return true;
  } catch (err) {
    console.error('Logout error:', err);
    return false;
  }
}

// Get current authenticated admin
export async function getCurrentAdmin() {
  if (!supabase) return null;
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

// Auth Guard - Redirect to login panel if not authenticated
export async function requireAdminAuth() {
  const user = await getCurrentAdmin();
  if (!user) {
    // Show login screen in Admin Panel (handled by admin.js page logic)
    return null;
  }
  return user;
}

// Watch auth changes
export function onAuthChange(callback) {
  if (!supabase) return;
  supabase.auth.onAuthStateChange((event, session) => {
    callback(event, session);
  });
}
