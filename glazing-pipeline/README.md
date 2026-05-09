# Glazing Extractor — Deployment Guide

Upload architectural PDF plans → get a pre-filled NCC 2022 glazing calculator spreadsheet.

## What it extracts from plans
- Glazing description / code
- Facing direction (N, NE, E, SE, S, SW, W, NW)
- Height & width (metres)
- Room type (Bedroom / Utility / Other)
- Frame colour (Dark / Medium / Light)

## What you fill in manually after download
- U-Value (from product spec)
- SHGC (from product spec)
- Operability (Fixed / Awning / Sliding / etc.)
- Floor type & adjacent floor covering

---

## Step-by-step deployment

### Step 1 — Get the code on your computer

1. Download and unzip this project folder.
2. Open Terminal (Mac) or Command Prompt (Windows).
3. Navigate into the folder:
   ```
   cd glazing-pipeline
   ```

### Step 2 — Install dependencies

Run this command:
```
npm install
```

### Step 3 — Get your Anthropic API key

1. Go to https://console.anthropic.com
2. Click **API Keys** in the left sidebar.
3. Click **Create Key**, give it a name like "glazing-extractor", and copy the key.

### Step 4 — Create a Netlify account (free)

1. Go to https://netlify.com and sign up for a free account.
2. Install the Netlify command-line tool:
   ```
   npm install -g netlify-cli
   ```
3. Log in:
   ```
   netlify login
   ```
   This opens a browser — click **Authorize**.

### Step 5 — Deploy to Netlify

Run:
```
netlify deploy --build --prod
```

Follow the prompts:
- "Create & configure a new site" → press Enter
- Team → select your team
- Site name → type something like `glazing-extractor` (or leave blank for random name)

Netlify will build and deploy. At the end you'll see your site URL, e.g. `https://glazing-extractor.netlify.app`.

### Step 6 — Add your API key to Netlify

1. Go to https://app.netlify.com
2. Click your site.
3. Go to **Site configuration → Environment variables**.
4. Click **Add a variable**.
5. Set:
   - Key: `ANTHROPIC_API_KEY`
   - Value: your API key from Step 3
6. Click **Save**.
7. Go to **Deploys** and click **Trigger deploy → Deploy site** to restart with the new key.

### Done!

Your site is live. Share the URL with anyone who needs to extract glazing data.

---

## Running locally (for testing)

1. Create a file called `.env` in the project folder:
   ```
   ANTHROPIC_API_KEY=your-key-here
   ```
2. Run:
   ```
   netlify dev
   ```
3. Open http://localhost:8888

---

## Updating the glazing template

If you need to use a different version of the glazing calculator spreadsheet:
1. Replace `public/glazing-template.xlsx` with the new file (keep the same filename).
2. Redeploy: `netlify deploy --build --prod`
