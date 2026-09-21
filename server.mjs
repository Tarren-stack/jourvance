/**
 * Jourvance Spoke Server (server.mjs)
 * Visual Customer Journey & Conversion Flow Builder
 */
import express from 'express';
import compression from 'compression';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createHubClient } from './hub-sdk.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(compression());
app.use(express.json({ limit: '10mb' }));

// Hub SDK client (fails open if credentials not yet configured)
const hub = createHubClient({
  hubUrl: process.env.HUB_URL || 'https://zeluslabs.dev',
  appId: process.env.APP_ID || 'jourvance',
  apiKey: process.env.HUB_API_KEY || ''
});

// In-memory store for journeys with fallback persistence
const journeysFile = path.join(__dirname, 'journeys.json');
let journeyCache = {};
try {
  if (fs.existsSync(journeysFile)) {
    journeyCache = JSON.parse(fs.readFileSync(journeysFile, 'utf8'));
  }
} catch (e) {
  console.warn('[Jourvance] Failed to read journeys.json, starting empty:', e.message);
}

const persistJourneys = () => {
  try {
    fs.writeFileSync(journeysFile, JSON.stringify(journeyCache, null, 2), 'utf8');
  } catch (e) {
    console.error('[Jourvance] Failed to persist journeys.json:', e.message);
  }
};

// ── API Routes ──

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', app: 'jourvance', version: '0.1.0' });
});

// Get current journey
app.get('/api/journey/:id', (req, res) => {
  const { id } = req.params;
  const journey = journeyCache[id] || null;
  res.json({ success: true, journey });
});

// Save or update journey
app.post('/api/journey/:id', (req, res) => {
  const { id } = req.params;
  const { nodes, edges, metadata } = req.body;
  
  journeyCache[id] = {
    id,
    nodes: nodes || [],
    edges: edges || [],
    metadata: metadata || {},
    updatedAt: new Date().toISOString()
  };
  persistJourneys();

  res.json({ success: true, journey: journeyCache[id] });
});

// List all saved journeys
app.get('/api/journeys', (req, res) => {
  const list = Object.values(journeyCache).map(j => ({
    id: j.id,
    name: j.metadata?.name || 'Untitled Journey',
    updatedAt: j.updatedAt,
    nodeCount: j.nodes?.length || 0,
    userId: j.userId || 'anonymous'
  }));
  res.json({ success: true, journeys: list });
});

// User-scoped journey endpoints (Multi-tenant)
app.get('/api/user/:userId/journeys', (req, res) => {
  const { userId } = req.params;
  const list = Object.values(journeyCache)
    .filter(j => j.userId === userId || (!j.userId && userId === 'default'))
    .map(j => ({
      id: j.id,
      name: j.metadata?.name || 'Untitled Journey',
      updatedAt: j.updatedAt,
      nodeCount: j.nodes?.length || 0
    }));
  res.json({ success: true, journeys: list });
});

app.post('/api/user/:userId/journey/:id', (req, res) => {
  const { userId, id } = req.params;
  const { nodes, edges, metadata } = req.body;
  
  journeyCache[id] = {
    id,
    userId,
    nodes: nodes || [],
    edges: edges || [],
    metadata: metadata || {},
    updatedAt: new Date().toISOString()
  };
  persistJourneys();

  res.json({ success: true, journey: journeyCache[id] });
});

// AI Copy Generator (bridges to Hub Brain RAG if available, with intelligent local fallback)
app.post('/api/ai/copy', async (req, res) => {
  const { nodeType, businessType, offerHeadline, goal } = req.body;
  
  try {
    // Attempt query through Hub Brain
    if (process.env.HUB_API_KEY) {
      const prompt = `Write high-converting ${nodeType} copy for a ${businessType || 'business'} with offer: "${offerHeadline}". Goal: ${goal || 'capture leads'}. Concise, punchy, conversion-focused.`;
      const brainRes = await hub.brain?.query?.(prompt);
      if (brainRes?.chunks?.length) {
        return res.json({ success: true, copy: brainRes.chunks[0].text });
      }
    }
  } catch (err) {
    console.warn('[Jourvance] Hub brain call fallback:', err.message);
  }

  // High-converting rule-based presets
  const fallbacks = {
    ad: {
      headline: `Exclusive Offer: Claim Your ${offerHeadline || 'Complimentary Consultation'}`,
      body: `Looking for reliable, top-tier results without the hassle? See why locals rate us 5 stars. Click below to claim your spot today.`,
      cta: 'Claim Offer Now'
    },
    page: {
      headline: `Get ${offerHeadline || 'Proven Results For Your Business'} — Without The Stress`,
      subhead: `Join over 500+ satisfied clients who transformed their workflow. Guaranteed satisfaction from day one.`,
      cta: 'Get Started Today'
    },
    email: {
      subject: `Your ${offerHeadline || 'Exclusive Pass'} is inside`,
      preview: `Here is everything you need to get started right away...`,
      body: `Hi there,\n\nThank you for reaching out! We received your request for ${offerHeadline || 'our exclusive offer'}.\n\nHere are the next steps to get the most out of this:\n1. Review your confirmation details below\n2. Pick a convenient time on our calendar\n3. Reach out if you have any questions\n\nWe are looking forward to working with you!\n\nBest regards,\nThe Team`
    }
  };

  const copy = fallbacks[nodeType] || fallbacks.ad;
  res.json({ success: true, copy });
});

// Serve frontend in production
const distPath = path.join(__dirname, 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`[Jourvance] Customer Journey Spoke running at http://localhost:${PORT}`);
});
