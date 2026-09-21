// Crime Against Recipes: roast + recipe endpoint.
// Holds the API key server-side, rate limits per IP, and files each
// successful roast's photo into the anonymous gallery (Vercel Blob).

import { put } from '@vercel/blob';

const MODEL = process.env.MODEL || 'claude-sonnet-5';
const MAX_IMAGE_BYTES = 1_200_000; // ~1.2MB of base64 in
const RATE_LIMIT = 10; // roasts per IP per hour (best effort, resets on cold start)

const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const windowStart = now - 3600_000;
  const arr = (hits.get(ip) || []).filter((t) => t > windowStart);
  if (arr.length >= RATE_LIMIT) { hits.set(ip, arr); return true; }
  arr.push(now);
  hits.set(ip, arr);
  return false;
}

function slugKey(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

function roastPrompt(desc) {
  const opening = desc
    ? `You are a furious British celebrity-chef PARODY doing a brutal kitchen-inspection critique. A home cook has described what they cooked. Their confession: "${desc.slice(0, 2000)}"`
    : 'You are a furious British celebrity-chef PARODY doing a brutal kitchen-inspection critique. You are looking at a photo a home cook just sent of their dish.';
  return [
    opening,
    '',
    'Write your critique. Rules:',
    '- Open by guessing what the dish is supposed to be, dripping with disbelief.',
    '- Invent a plausible story of exactly where the cooking went wrong (overworked, underseasoned, pan not hot enough, hiding it under sauce, etc.) based on what you can actually see or what they admitted. Be specific.',
    "- Short, punchy lines. Shouting in CAPS occasionally. British insults: donkey, muppet, 'it's RAW' if remotely plausible, 'my gran could do better', 'bland as dishwater'. Swearing is bleeped as [BLEEP].",
    '- If, and only if, the dish genuinely deserves it, do the idiot sandwich bit: order them to put their head between two slices of bread and ask what they are. Roughly one in three critiques, not every time.',
    "- If the food actually looks good, grudgingly admit it. Don't fake outrage at a genuinely good plate.",
    '- End with exactly ONE line of real, useful cooking advice, delivered begrudgingly.',
    '- Then finish with exactly two lines, each on its own line:',
    "  DISH: <your best identification of the dish, short, e.g. 'Spaghetti carbonara'>",
    '  SCORE: n/10 (whole number, 1 to 10)',
    '- 120 to 200 words before those lines. No markdown, plain text only. If it is not food, tear into them for wasting your time, write DISH: NOT FOOD, and score it 1.',
  ].join('\n');
}

function recipePrompt(dish, desc) {
  const context = desc
    ? `Their own description of what they did: "${desc.slice(0, 1500)}"`
    : 'The photo of their attempt is attached so you can see what they did to it.';
  return [
    `You are a furious British celebrity-chef PARODY. A home cook just showed you their attempt at: ${dish}. ${context}`,
    '',
    "Now show them how it's actually done. Give the best proper recipe for this dish:",
    '- One line of grudging intro in character.',
    '- INGREDIENTS: a plain list, one per line with quantities, for 2 servings.',
    '- METHOD: numbered steps, short and precise, with the key technique tips a pro would give (pan heat, resting, seasoning as you go). Where you can tell what they got wrong, call it out in the relevant step.',
    '- One closing line in character.',
    '- Plain text only, no markdown symbols. Under 300 words. Attitude in the intro and outro, clarity in the recipe itself.',
  ].join('\n');
}

async function callClaude(prompt, imageDataUri) {
  const content = [];
  if (imageDataUri) {
    const m = imageDataUri.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
    if (!m) throw new Error('bad_image');
    content.push({ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } });
  }
  content.push({ type: 'text', text: prompt });

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 700,
      messages: [{ role: 'user', content }],
    }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    const err = new Error('upstream');
    err.status = r.status;
    err.body = body.slice(0, 300);
    throw err;
  }
  const data = await r.json();
  return (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'no_key' });

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (limited(ip)) return res.status(429).json({ error: 'rate_limited' });

  const { kind, image, desc, dish } = req.body || {};
  if (image && image.length > MAX_IMAGE_BYTES) return res.status(413).json({ error: 'image_too_big' });
  if (!image && !(desc && desc.trim().length > 10)) return res.status(400).json({ error: 'nothing_to_judge' });

  try {
    if (kind === 'recipe') {
      if (!dish || typeof dish !== 'string') return res.status(400).json({ error: 'no_dish' });
      const text = await callClaude(recipePrompt(dish.slice(0, 80), desc), image);
      return res.status(200).json({ text });
    }

    const text = await callClaude(roastPrompt(desc), image);

    // File the crime in the gallery: anonymous, photo only, keyed by dish.
    let filed = false;
    const d = text.match(/DISH:\s*(.+)/i);
    const dishName = d ? d[1].trim() : null;
    if (!process.env.BLOB_READ_WRITE_TOKEN) console.error('gallery skipped: no BLOB_READ_WRITE_TOKEN in this deployment');
    if (dishName && !/not food/i.test(dishName) && image && process.env.BLOB_READ_WRITE_TOKEN) {
      try {
        const m = image.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
        const buf = Buffer.from(m[2], 'base64');
        if (buf.length <= 900_000) {
          const key = slugKey(dishName);
          const ext = m[1] === 'image/png' ? 'png' : m[1] === 'image/webp' ? 'webp' : 'jpg';
          await put(`crimes/${key}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`, buf, {
            access: 'public',
            contentType: m[1],
          });
          filed = true;
        }
      } catch (e) { console.error('gallery save failed:', e.message); }
    }

    return res.status(200).json({ text, filed });
  } catch (e) {
    if (e.message === 'bad_image') return res.status(400).json({ error: 'bad_image' });
    console.error('roast error', e.status || '', e.body || e.message);
    return res.status(502).json({ error: 'upstream' });
  }
}
