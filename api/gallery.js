// Read-only gallery: photos of other people's attempts at the same dish.
// Writes happen server-side in /api/roast.js only, so this endpoint can't
// be used to inject arbitrary images.

import { list } from '@vercel/blob';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method' });
  if (!process.env.BLOB_READ_WRITE_TOKEN) return res.status(200).json({ photos: [] });

  const dish = String(req.query.dish || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 60);
  if (!dish) return res.status(400).json({ error: 'no_dish' });

  try {
    const { blobs } = await list({ prefix: `crimes/${dish}/`, limit: 60 });
    const photos = blobs
      .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))
      .slice(0, 24)
      .map((b) => b.url);
    res.setHeader('cache-control', 's-maxage=30, stale-while-revalidate=120');
    return res.status(200).json({ photos });
  } catch (e) {
    return res.status(200).json({ photos: [] });
  }
}
