# Crime Against Recipes

Photo in, furious chef critique out, plus a proper recipe and an anonymous
"crimes against this recipe" photo wall per dish.

## What it is
- index.html      The page. No build step, plain HTML/JS.
- api/roast.js    Serverless function. Holds your Anthropic API key, calls
                  Claude for the roast and the recipe, rate limits per IP
                  (10 roasts/hour), and files each successful roast's photo
                  into the gallery.
- api/gallery.js  Read-only. Lists photos for a dish. Photos are only ever
                  written server-side after a real roast, so nobody can
                  post images directly.

## Deploy (Vercel, ~10 minutes)
1. Get an API key at console.anthropic.com. Set a monthly spend limit
   (Settings > Limits). $25 is more than enough headroom.
2. Push this folder to a GitHub repo.
3. vercel.com > Add New > Project > import the repo > Deploy.
4. In the Vercel project: Storage > Create > Blob. This auto-adds the
   BLOB_READ_WRITE_TOKEN env var (the gallery storage).
5. Settings > Environment Variables > add ANTHROPIC_API_KEY = your key.
6. Redeploy. Done. Custom domain under Settings > Domains if you want one.

## Config
- MODEL env var (optional): defaults to claude-sonnet-5. Set to
  claude-haiku-4-5-20251001 to roughly halve cost. Check current model
  names and pricing at docs.claude.com.
- Rate limit and image size caps are constants at the top of api/roast.js.

## Costs (order of magnitude)
Roughly 1,500 input + 300 output tokens per roast. At Sonnet 5 rates
($2/$10 per million tokens as of Sept 2026), about half a cent per roast,
~1.5 cents for roast + recipe. 100 users at a few dishes each lands in
single-digit dollars. Vercel free tier covers hosting and Blob storage at
this scale.

## Known limits, be honest with yourself about these
- Rate limiting is in-memory per serverless instance: good enough to stop
  casual abuse, not a determined attacker. The API spend cap is your real
  backstop.
- The gallery is public and unmoderated. Photos only get stored when the
  model identifies food, which filters most junk, but if this grows you'll
  want a report button and a delete routine (Vercel Blob dashboard lets
  you delete manually meanwhile).
- No accounts, no analytics, no cookies. Add at your own risk.
