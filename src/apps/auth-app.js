/**
 * Unified authentication page controller.
 * Allowed: DOM and shared Supabase client. Forbidden: trading and Wave algorithms.
 * Covered by: desktop/iPhone Playwright auth tests.
 */
import { ROUTES } from '../core/config.js';
import { getSupabaseClient } from '../core/supabase-client.js';

const supabaseClient = getSupabaseClient('auth');
const authForm = document.getElementById('auth-form');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const loginBtn = document.querySelector('.btn-primary');
const signupBtn = document.querySelector('.btn-secondary');
const authMessage = document.getElementById('auth-message');
const togglePassword = document.getElementById('togglePassword');

function setMessage(message = '', type = '') {
  authMessage.textContent = message;
  authMessage.className = `auth-message${type ? ` ${type}` : ''}`;
}

function setLoginBusy(busy) {
  loginBtn.disabled = busy;
  signupBtn.disabled = busy;
  loginBtn.querySelector('span:first-child').textContent = busy ? 'Logging In…' : 'Log In';
}

function credentials() {
  return { email:emailInput.value.trim(), password:passwordInput.value };
}

function validateCredentials() {
  const values = credentials();
  if (!values.email || !values.password) {
    setMessage('Please enter both your email and password.', 'error');
    return null;
  }
  if (!emailInput.validity.valid) {
    setMessage('Please enter a valid email address.', 'error');
    return null;
  }
  return values;
}

togglePassword.addEventListener('click', () => {
  const willShow = passwordInput.type === 'password';
  passwordInput.type = willShow ? 'text' : 'password';
  togglePassword.setAttribute('aria-pressed', String(willShow));
  togglePassword.setAttribute('aria-label', willShow ? 'Hide password' : 'Show password');
  togglePassword.querySelector('.material-icons').textContent = willShow ? 'visibility_off' : 'visibility';
  passwordInput.focus();
});

signupBtn.addEventListener('click', async event => {
  event.preventDefault();
  const values = validateCredentials();
  if (!values) return;

  setMessage('Creating your account…', 'pending');
  signupBtn.disabled = true;
  loginBtn.disabled = true;
  const { error } = await supabaseClient.auth.signUp(values);
  signupBtn.disabled = false;
  loginBtn.disabled = false;
  setMessage(error ? `Sign up failed: ${error.message}` : 'Account created. You can now log in.', error ? 'error' : 'success');
});

authForm.addEventListener('submit', async event => {
  event.preventDefault();
  const values = validateCredentials();
  if (!values) return;

  setMessage('Verifying your account…', 'pending');
  setLoginBusy(true);
  const { error } = await supabaseClient.auth.signInWithPassword(values);
  if (error) {
    setMessage(`Login failed: ${error.message}`, 'error');
    setLoginBusy(false);
    return;
  }

  setMessage('Login successful. Opening your workspace…', 'success');
  window.location.href = ROUTES.terminal;
});
