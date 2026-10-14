/**
 * auth.js — Authentication & JWT token management
 * Android MDM Dashboard
 */
const Auth = (function () {
  'use strict';

  const TOKEN_KEY = 'mdm_jwt_token';
  const USER_KEY = 'mdm_user';
  const DEBUG = false;

  function log(...args) {
    if (DEBUG) console.log('[Auth]', ...args);
  }

  /**
   * Get stored JWT token
   */
  function getToken() {
    return localStorage.getItem(TOKEN_KEY) || '';
  }

  /**
   * Store JWT token
   */
  function setToken(token) {
    localStorage.setItem(TOKEN_KEY, token);
  }

  /**
   * Get stored user info
   */
  function getUser() {
    try {
      return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
    } catch {
      return null;
    }
  }

  /**
   * Store user info
   */
  function setUser(user) {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }

  /**
   * Check if user is authenticated (token exists and not expired)
   */
  function isAuthenticated() {
    const token = getToken();
    if (!token) return false;
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      if (payload.exp && Date.now() >= payload.exp * 1000) {
        logout();
        return false;
      }
      return true;
    } catch {
      return true; // If we can't parse, assume valid (server will reject)
    }
  }

  /**
   * Login — calls /api/auth/login
   */
  async function login(identifier, password) {
    log('Logging in as', identifier);
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, username: identifier, password })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || data.message || `Login failed (${res.status})`);
    }
    if (data.token) setToken(data.token);
    if (data.user) setUser(data.user);
    else setUser({ username: identifier });
    log('Login successful');
    return data;
  }

  /**
   * Register — calls /api/auth/register
   */
  async function register(username, email, password) {
    log('Registering user', username, email);
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || data.message || `Registration failed (${res.status})`);
    }
    log('Registration successful');
    return data;
  }

  /**
   * Logout — clear stored credentials and redirect to login
   */
  function logout() {
    log('Logging out');
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    if (typeof WebSocketManager !== 'undefined') {
      WebSocketManager.disconnect();
    }
    window.location.href = 'login.html';
  }

  /**
   * Auth guard — redirect to login if not authenticated
   */
  function requireAuth() {
    if (!isAuthenticated()) {
      window.location.href = 'login.html';
      return false;
    }
    return true;
  }

  return {
    getToken,
    setToken,
    getUser,
    setUser,
    isAuthenticated,
    login,
    register,
    logout,
    requireAuth
  };
})();
