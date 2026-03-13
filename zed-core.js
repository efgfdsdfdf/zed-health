// ═══════════════════════════════════════════════════════════════
//  ZED CORE  v3  —  Supabase + Anthropic via proxy + shared utils
//  Load AFTER the Supabase CDN <script> on every page.
// ═══════════════════════════════════════════════════════════════

// ── 1. CONFIG ──────────────────────────────────────────────────
const SUPABASE_URL  = 'https://cenplbwpjycxotctvjmz.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNlbnBsYndwanljeG90Y3R2am16Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5MDE0NDgsImV4cCI6MjA4ODQ3NzQ0OH0.6lDMcolkeHre8VE7R823pMcx3uA6Rvw2C9XTiWtUvD8';

// ── 2. Supabase client (singleton) ─────────────────────────────
const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    autoRefreshToken:   true,
    persistSession:     true,
    detectSessionInUrl: true,
    storageKey:         'zed-auth'
  }
});

// ── 3. Auth ─────────────────────────────────────────────────────
const ZedAuth = {
  async getUser() {
    const { data: { user } } = await _supabase.auth.getUser();
    return user;
  },

  async requireAuth() {
    const user = await this.getUser();
    if (!user) { window.location.href = 'login.html'; return null; }
    return user;
  },

  async signIn(email, password) {
    return _supabase.auth.signInWithPassword({ email, password });
  },

  async signUp(email, password, meta = {}) {
    return _supabase.auth.signUp({ email, password, options: { data: meta } });
  },

  async signOut() {
    await _supabase.auth.signOut();
    window.location.href = 'login.html';
  },

  async oAuth(provider) {
    return _supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: window.location.origin + '/dashboard.html',
        queryParams: { access_type: 'offline', prompt: 'consent' }
      }
    });
  },

  async resetPassword(email) {
    return _supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/login.html'
    });
  },

  async updatePassword(newPassword) {
    return _supabase.auth.updateUser({ password: newPassword });
  },

  onAuthChange(callback) {
    return _supabase.auth.onAuthStateChange(callback);
  }
};

// ── 4. Profile ──────────────────────────────────────────────────
const ZedProfile = {
  async get(userId) {
    const { data, error } = await _supabase
      .from('profiles').select('*').eq('id', userId).maybeSingle();
    return { data, error };
  },

  async upsert(userId, fields) {
    return _supabase
      .from('profiles')
      .upsert({ id: userId, ...fields, updated_at: new Date().toISOString() })
      .select().single();
  },

  displayName(profile, user) {
    if (profile) {
      const full = [profile.first_name, profile.last_name].filter(Boolean).join(' ');
      if (full.trim()) return full;
    }
    return user?.user_metadata?.first_name
        || user?.user_metadata?.full_name
        || user?.email?.split('@')[0]
        || 'there';
  }
};

// ── 5. Chat sessions & messages ─────────────────────────────────
const ZedChats = {
  async list(userId, limit = 20) {
    return _supabase
      .from('chat_sessions').select('id, title, created_at, updated_at')
      .eq('user_id', userId).order('updated_at', { ascending: false }).limit(limit);
  },

  async create(userId, title = 'New Consultation') {
    return _supabase.from('chat_sessions')
      .insert({ user_id: userId, title }).select().single();
  },

  async rename(sessionId, title) {
    return _supabase.from('chat_sessions').update({ title }).eq('id', sessionId);
  },

  async delete(sessionId) {
    return _supabase.from('chat_sessions').delete().eq('id', sessionId);
  },

  async getMessages(sessionId) {
    return _supabase.from('chat_messages')
      .select('id, role, content, created_at').eq('session_id', sessionId)
      .order('created_at', { ascending: true });
  },

  async addMessage(sessionId, role, content) {
    return _supabase.from('chat_messages').insert({ session_id: sessionId, role, content });
  }
};

// ── 6. Vitals log ───────────────────────────────────────────────
const ZedVitals = {
  /** Most recent reading for a user */
  async latest(userId) {
    return _supabase
      .from('vitals_log').select('*').eq('user_id', userId)
      .order('recorded_at', { ascending: false }).limit(1).maybeSingle();
  },

  /** Last N readings for sparkline / trends */
  async history(userId, limit = 14) {
    return _supabase
      .from('vitals_log').select('heart_rate, bp_systolic, bp_diastolic, temperature, spo2, recorded_at')
      .eq('user_id', userId).order('recorded_at', { ascending: false }).limit(limit);
  },

  /** Save a new vitals reading */
  async save(userId, readings) {
    // readings: { heart_rate, bp_systolic, bp_diastolic, temperature, spo2, weight, blood_glucose, notes }
    return _supabase.from('vitals_log')
      .insert({ user_id: userId, source: 'manual', ...readings })
      .select().single();
  }
};

// ── 7. Appointments ─────────────────────────────────────────────
const ZedAppointments = {
  /** Upcoming confirmed/pending appointments */
  async upcoming(userId, limit = 5) {
    return _supabase
      .from('appointments').select('*').eq('user_id', userId)
      .in('status', ['confirmed', 'pending'])
      .gte('appointment_at', new Date().toISOString())
      .order('appointment_at', { ascending: true }).limit(limit);
  },

  async save(userId, payload) {
    return _supabase.from('appointments').insert({ user_id: userId, ...payload }).select().single();
  },

  async update(id, fields) {
    return _supabase.from('appointments').update(fields).eq('id', id);
  }
};

// ── 8. Symptom checks ───────────────────────────────────────────
const ZedSymptoms = {
  async list(userId, limit = 10) {
    return _supabase.from('symptom_checks')
      .select('id, area, symptoms, severity, duration, result, created_at')
      .eq('user_id', userId).order('created_at', { ascending: false }).limit(limit);
  },

  async save(userId, payload) {
    return _supabase.from('symptom_checks').insert({ user_id: userId, ...payload });
  }
};

// ── 9. Medical reports ──────────────────────────────────────────
const ZedReports = {
  async list(userId, limit = 10) {
    return _supabase.from('medical_reports')
      .select('id, file_name, analysis_type, result, analyzed_at')
      .eq('user_id', userId).order('analyzed_at', { ascending: false }).limit(limit);
  },

  async save(userId, payload) {
    return _supabase.from('medical_reports')
      .insert({ user_id: userId, analyzed_at: new Date().toISOString(), ...payload });
  }
};

// ── 10. Health tips cache ───────────────────────────────────────
const ZedTips = {
  async get(userId, category = 'all') {
    return _supabase.from('health_tips')
      .select('tips, generated_at').eq('user_id', userId)
      .eq('category', category).maybeSingle();
  },

  async save(userId, category, tips) {
    return _supabase.from('health_tips').upsert(
      { user_id: userId, category, tips, generated_at: new Date().toISOString() },
      { onConflict: 'user_id,category' }
    );
  }
};

// ── 11. Notifications ───────────────────────────────────────────
const ZedNotifications = {
  async unreadCount(userId) {
    const { count } = await _supabase.from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId).eq('read', false);
    return count || 0;
  },

  async list(userId, limit = 20) {
    return _supabase.from('notifications')
      .select('*').eq('user_id', userId)
      .order('created_at', { ascending: false }).limit(limit);
  },

  async markAllRead(userId) {
    return _supabase.from('notifications')
      .update({ read: true }).eq('user_id', userId).eq('read', false);
  }
};

// ── 12. ZedAI — via backend proxy ───────────────────────────────
//     The actual Anthropic API key is stored on the server.
// ─────────────────────────────────────────────────────────────────
const ZedAI = {

  // Internal helper to get the proxy URL – adjust to match your backend
  _proxyUrl() {
    // In development, your proxy runs on localhost:3000 (or the port you set)
    // In production, replace with your actual backend URL or use relative path.
    const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (isDev) {
      return 'http://localhost:3000/api/anthropic';
    }
    // For production, use relative path if backend is on same domain, or absolute URL
    return '/api/anthropic'; // assumes same origin
  },

  // ── Chat completion ─────────────────────────────────────────────
  // messages : [{role:'user'|'assistant', content:'...'}]
  // opts     : { model, max_tokens, system }
  // returns  : string (assistant reply)
  async chat(messages, opts = {}) {
    const body = {
      messages,
      model:      opts.model      || 'claude-3-sonnet-20240229',
      max_tokens: opts.max_tokens || 600,
    };
    if (opts.system) body.system = opts.system;

    const res = await fetch(this._proxyUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const errorMsg = err.error?.message || err.error || `Proxy error ${res.status}`;

      // Handle specific status codes with user-friendly messages
      if (res.status === 401) {
        throw new Error('🔐 Authentication required. Please log in again.');
      }
      if (res.status === 403) {
        throw new Error('🚫 Access forbidden. You may not have permission.');
      }
      if (res.status === 429) {
        throw new Error('⏳ Rate limit reached — wait a moment and try again.');
      }
      if (res.status === 500) {
        // Distinguish between server misconfiguration and Anthropic errors
        if (errorMsg.includes('missing ANTHROPIC_KEY')) {
          throw new Error('🔧 Server misconfigured. Please contact support.');
        }
        throw new Error('🔧 Server error. Please try again later.');
      }
      if (res.status === 400 && errorMsg.includes('credit balance')) {
        throw new Error('💰 Insufficient credits. Please contact support.');
      }
      throw new Error(`❌ ${errorMsg}`);
    }

    const data = await res.json();
    return data.content?.filter(b => b.type === 'text').map(b => b.text).join('') || '';
  },

  // ── Vision / image analysis ─────────────────────────────────────
  // base64   : raw base64 string (no data-uri prefix)
  // mimeType : 'image/jpeg' | 'image/png' | 'image/webp'
  async analyzeImage(base64, mimeType, prompt) {
    const body = {
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
          { type: 'text',  text: prompt }
        ]
      }],
      max_tokens: 1400
    };

    const res = await fetch(this._proxyUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const errorMsg = err.error?.message || err.error || `Vision proxy error ${res.status}`;

      if (res.status === 401) {
        throw new Error('🔐 Authentication required. Please log in again.');
      }
      if (res.status === 400 && errorMsg.includes('image')) {
        throw new Error('🖼️ Image format error. Please try a different image.');
      }
      if (res.status === 429) {
        throw new Error('⏳ Rate limit reached — wait a moment and try again.');
      }
      throw new Error(`❌ ${errorMsg}`);
    }

    const data = await res.json();
    return data.content?.filter(b => b.type === 'text').map(b => b.text).join('') || '';
  },

  // ── Helper method to test connection to the proxy ──────────────
  async testConnection() {
    try {
      const result = await this.chat([
        { role: 'user', content: 'Say "Proxy connection successful" if you receive this.' }
      ], { max_tokens: 20 });
      return { success: true, message: result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
};

// ── 13. Toast (queued — toasts never overlap) ────────────────────
const _toastQ  = [];
let _toastBusy = false;

function zedToast(msg, type = 'success', duration = 3400) {
  _toastQ.push({ msg, type, duration });
  if (!_toastBusy) _runToast();
}

function _runToast() {
  if (!_toastQ.length) { _toastBusy = false; return; }
  _toastBusy = true;
  const { msg, type, duration } = _toastQ.shift();

  let el = document.getElementById('zed-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'zed-toast';
    el.style.cssText =
      'position:fixed;bottom:1.75rem;left:50%;transform:translateX(-50%) translateY(28px);' +
      'z-index:9999;padding:.85rem 1.4rem;border-radius:14px;font-size:.9rem;' +
      "font-family:'DM Sans',sans-serif;font-weight:500;" +
      'display:flex;align-items:center;gap:.6rem;' +
      'backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);' +
      'opacity:0;transition:opacity .3s ease,transform .3s ease;' +
      'pointer-events:none;max-width:calc(100vw - 2.5rem);' +
      'white-space:nowrap;box-shadow:0 10px 40px rgba(0,0,0,.4);';
    document.body.appendChild(el);
  }

  const MAP = {
    success: { bg:'rgba(0,212,160,.16)',  bc:'rgba(0,212,160,.38)',  c:'#00d4a0', i:'✓' },
    error:   { bg:'rgba(255,92,122,.16)', bc:'rgba(255,92,122,.38)', c:'#ff5c7a', i:'✕' },
    warn:    { bg:'rgba(255,170,68,.16)', bc:'rgba(255,170,68,.35)', c:'#ffaa44', i:'⚠' },
    info:    { bg:'rgba(0,180,166,.16)',  bc:'rgba(0,180,166,.32)',  c:'#00d4c4', i:'ℹ' }
  };
  const s = MAP[type] || MAP.success;
  el.style.background = s.bg;
  el.style.border     = `1.5px solid ${s.bc}`;
  el.style.color      = s.c;
  el.innerHTML = `<span style="font-size:1.05rem;flex-shrink:0">${s.i}</span>`
               + `<span style="overflow:hidden;text-overflow:ellipsis">${msg}</span>`;

  requestAnimationFrame(() => {
    el.style.opacity   = '1';
    el.style.transform = 'translateX(-50%) translateY(0)';
  });

  setTimeout(() => {
    el.style.opacity   = '0';
    el.style.transform = 'translateX(-50%) translateY(14px)';
    setTimeout(_runToast, 340);
  }, duration);
}

// ── 14. Loader ──────────────────────────────────────────────────
function zedHideLoader(delay = 1200) {
  const hide = () => setTimeout(() => {
    const l = document.getElementById('loader');
    if (l) l.classList.add('hide');
  }, delay);
  document.readyState === 'complete' ? hide() : window.addEventListener('load', hide);
}

// ── 15. Mobile sidebar toggle ───────────────────────────────────
function zedMobileNav() {
  const sb = document.querySelector('.sidebar');
  const ov = document.getElementById('nav-overlay');
  if (!sb) return;
  const open = sb.classList.toggle('open');
  if (ov) { ov.style.display = open ? 'block' : 'none'; if (open) ov.onclick = zedMobileNav; }
  document.body.style.overflow = open ? 'hidden' : '';
}

// ── 16. Auto-highlight active nav link ──────────────────────────
(function () {
  const page = window.location.pathname.split('/').pop() || 'dashboard.html';
  document.querySelectorAll('.nav-item').forEach(el => {
    const href = el.getAttribute('href') || '';
    if (href && href.split('/').pop() === page) el.classList.add('active');
  });
})();

// ── 17. Relative time helper ────────────────────────────────────
function zedRelTime(iso) {
  if (!iso) return '';
  const s = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (s < 60)     return 'just now';
  if (s < 3600)   return Math.floor(s / 60) + 'm ago';
  if (s < 86400)  return Math.floor(s / 3600) + 'h ago';
  if (s < 604800) return Math.floor(s / 86400) + 'd ago';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ── 18. Health score ────────────────────────────────────────────
function zedHealthScore(p) {
  if (!p) return null;
  let s = 52;
  if (p.age) { s += p.age < 35 ? 10 : p.age < 50 ? 6 : 2; }
  if (p.smoking === 'Non-smoker')     s += 10;
  else if (p.smoking === 'Ex-smoker') s += 5;
  if (/daily|4x|5x/i.test(p.exercise  || '')) s += 10;
  else if (/3x|3-4/i.test(p.exercise  || '')) s += 7;
  else if (/1-2|1x|2x/i.test(p.exercise|| '')) s += 3;
  if (!p.conditions || /^none$/i.test(p.conditions.trim())) s += 8;
  if (p.alcohol === 'None')            s += 5;
  else if (p.alcohol === 'Occasionally') s += 3;
  if (p.weight && p.height) {
    const bmi = p.weight / Math.pow(p.height / 100, 2);
    if (bmi >= 18.5 && bmi < 25) s += 5;
  }
  if (p.ec_name) s += 2;
  return Math.min(Math.max(s, 20), 99);
}

// ── 19. Vitals assessment helpers ───────────────────────────────
const ZedVitalRanges = {
  heartRate(bpm) {
    if (bpm < 40)        return { status:'high',   label:'Dangerously low', color:'var(--error)' };
    if (bpm < 60)        return { status:'warn',   label:'Below normal',   color:'var(--warn)'  };
    if (bpm <= 100)      return { status:'ok',     label:'Normal',         color:'var(--success)'};
    if (bpm <= 120)      return { status:'warn',   label:'Elevated',       color:'var(--warn)'  };
    return               { status:'high',   label:'High — seek care', color:'var(--error)' };
  },
  bloodPressure(sys, dia) {
    if (sys < 90 || dia < 60) return { status:'warn',  label:'Low BP',       color:'var(--warn)'  };
    if (sys < 120 && dia < 80) return { status:'ok',   label:'Optimal',      color:'var(--success)'};
    if (sys < 130)             return { status:'ok',   label:'Normal',       color:'var(--success)'};
    if (sys < 140 || dia < 90) return { status:'warn', label:'Elevated',     color:'var(--warn)'  };
    return                     { status:'high', label:'High — monitor', color:'var(--error)' };
  },
  temperature(f) {
    if (f < 96)   return { status:'high', label:'Hypothermia risk', color:'var(--error)' };
    if (f < 97.6) return { status:'warn', label:'Below normal',     color:'var(--warn)'  };
    if (f <= 99)  return { status:'ok',   label:'Normal',           color:'var(--success)'};
    if (f <= 100.4) return { status:'warn', label:'Low-grade fever', color:'var(--warn)'  };
    return          { status:'high', label:'Fever',            color:'var(--error)' };
  },
  spo2(pct) {
    if (pct >= 96) return { status:'ok',   label:'Excellent',   color:'var(--success)'};
    if (pct >= 94) return { status:'warn', label:'Low normal',  color:'var(--warn)'  };
    if (pct >= 90) return { status:'warn', label:'Low — rest',  color:'var(--warn)'  };
    return          { status:'high', label:'Critical',     color:'var(--error)' };
  }
};
