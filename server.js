// ═══════════════════════════════════════════════════════════════
//  ZED  —  server.js
//  Node.js / Express backend proxy for OpenAI API calls.
//  Keeps your OPENAI_API_KEY secure — never exposed to the browser.
//
//  Setup:
//    npm install express cors dotenv openai
//    cp .env.example .env   (fill in your keys)
//    node server.js         (or: npx nodemon server.js)
//
//  Deploy:
//    Railway / Render / Fly.io — set env vars in dashboard
//    Vercel — move routes into /api/* serverless functions
// ═══════════════════════════════════════════════════════════════

import 'dotenv/config';
import express     from 'express';
import cors        from 'cors';
import OpenAI      from 'openai';
import path        from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Validate required env vars ──────────────────────────────────
const REQUIRED = ['OPENAI_API_KEY'];
REQUIRED.forEach(k => {
  if (!process.env[k]) {
    console.error(`❌  Missing env var: ${k}`);
    process.exit(1);
  }
});

const app    = express();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const PORT   = process.env.PORT || 3000;

// ── Middleware ──────────────────────────────────────────────────
app.use(express.json({ limit: '20mb' }));   // large enough for base64 images

// CORS — restrict to your frontend origin in production
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (curl, Postman, same-origin)
    if (!origin) return cb(null, true);
    // In development allow everything
    if (process.env.NODE_ENV !== 'production') return cb(null, true);
    // In production check allowlist
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// ── Serve static HTML files ─────────────────────────────────────
// Put all your .html, .css, .js files in a /public folder
app.use(express.static(path.join(__dirname, 'public')));

// ── Health check ────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ── AI proxy ────────────────────────────────────────────────────
//  POST /api/ai
//  Body: standard OpenAI chat completion payload
//  { model, max_tokens, temperature, messages }
//
//  Supported models:
//    gpt-4o          — best reasoning + vision
//    gpt-4o-mini     — fast & cheap, great for insights / tips
//    gpt-4-turbo     — large context
// ───────────────────────────────────────────────────────────────
app.post('/api/ai', async (req, res) => {
  try {
    const {
      model       = 'gpt-4o-mini',
      max_tokens  = 600,
      temperature = 0.7,
      messages
    } = req.body;

    // Basic validation
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array is required' });
    }

    // Allowlist models — prevents clients using expensive models unexpectedly
    const ALLOWED_MODELS = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'];
    if (!ALLOWED_MODELS.includes(model)) {
      return res.status(400).json({ error: `Model not allowed: ${model}` });
    }

    const completion = await openai.chat.completions.create({
      model,
      max_tokens: Math.min(max_tokens, 2000),  // hard cap
      temperature,
      messages
    });

    res.json(completion);

  } catch (err) {
    console.error('OpenAI error:', err?.message || err);
    const status = err?.status || 500;
    res.status(status).json({ error: err?.message || 'AI request failed' });
  }
});

// ── Vitals AI analysis ──────────────────────────────────────────
//  POST /api/vitals-analysis
//  Body: { vitals: {...}, profile: {...} }
//  Returns a structured assessment of the vitals reading.
// ───────────────────────────────────────────────────────────────
app.post('/api/vitals-analysis', async (req, res) => {
  try {
    const { vitals, profile } = req.body;
    if (!vitals) return res.status(400).json({ error: 'vitals required' });

    const vStr = [
      vitals.heart_rate    && `Heart Rate: ${vitals.heart_rate} bpm`,
      vitals.bp_systolic   && `Blood Pressure: ${vitals.bp_systolic}/${vitals.bp_diastolic} mmHg`,
      vitals.temperature   && `Temperature: ${vitals.temperature}°F`,
      vitals.spo2          && `SpO₂: ${vitals.spo2}%`,
      vitals.weight        && `Weight: ${vitals.weight} kg`,
      vitals.blood_glucose && `Blood Glucose: ${vitals.blood_glucose} mmol/L`,
    ].filter(Boolean).join('\n');

    const pStr = profile ? [
      `Age: ${profile.age || '?'}`,
      `Conditions: ${profile.conditions || 'None'}`,
      `Medications: ${profile.medications || 'None'}`,
      `Family history: ${profile.family_history || 'None'}`,
    ].join(' | ') : 'No profile available';

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 400,
      temperature: 0.4,
      messages: [{
        role: 'system',
        content: 'You are a clinical health assistant. Analyse patient vitals and return a concise JSON object. Be accurate and evidence-based.'
      }, {
        role: 'user',
        content: `Analyse these vitals and return ONLY a JSON object (no markdown) with:
{
  "overall": "normal|caution|concern",
  "summary": "One sentence overall status",
  "findings": [{"vital":"...","status":"normal|elevated|low|critical","note":"..."}],
  "recommendation": "One specific actionable step"
}

Patient: ${pStr}
Vitals:
${vStr}`
      }]
    });

    const raw = completion.choices[0]?.message?.content || '{}';
    try {
      const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
      res.json(parsed);
    } catch {
      res.json({ overall: 'normal', summary: raw, findings: [], recommendation: '' });
    }

  } catch (err) {
    console.error('Vitals analysis error:', err?.message);
    res.status(500).json({ error: err?.message || 'Analysis failed' });
  }
});

// ── Catch-all: return index.html for SPA-style routing ──────────
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start server ────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅  Zed server running at http://localhost:${PORT}`);
  console.log(`   AI proxy  → POST /api/ai`);
  console.log(`   Vitals    → POST /api/vitals-analysis`);
  console.log(`   Static    → /public`);
});

export default app;
