# Yojana Setu — GitHub + Render deployment

Two moving parts:
1. **The website** (`index.html` + `schemes.json`) — hosted free on GitHub Pages.
2. **The agent** (`agent.js`) — runs on a schedule on Render, finds new schemes, commits them to `schemes.json` in your GitHub repo. GitHub Pages then auto-redeploys the site with the update.

No server-side app is needed for the website itself — it's a static file that just reads `schemes.json`.

---

## 1. Create the GitHub repo

1. Create a new **public** GitHub repo, e.g. `yojana-setu`.
2. Upload these files to the repo root: `index.html`, `schemes.json`, `agent.js`, `package.json`, `render.yaml`.
3. Commit to the `main` branch.

## 2. Turn on GitHub Pages

1. In the repo: **Settings → Pages**.
2. Under "Build and deployment", set **Source: Deploy from a branch**, **Branch: main / (root)**.
3. Save. Your site will be live at `https://<your-username>.github.io/yojana-setu/` within a minute or two.

## 3. Get an Anthropic API key

1. Go to console.anthropic.com and create an API key.
2. Keep it handy — you'll paste it into Render as a secret, never into the repo.

## 4. Create a GitHub token for the agent

1. GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. Scope it to **only** the `yojana-setu` repo.
3. Under Repository permissions, grant **Contents: Read and write**.
4. Generate and copy the token — you won't see it again.

## 5. Deploy the agent on Render

1. Sign up at render.com and connect your GitHub account.
2. **New → Blueprint**, pick the `yojana-setu` repo. Render will read `render.yaml` and propose a **Cron Job** service called `yojana-setu-agent`.
3. When prompted for the env vars marked `sync: false`, fill in:
   - `ANTHROPIC_API_KEY` — from step 3
   - `GITHUB_TOKEN` — from step 4
   - `GITHUB_OWNER` — your GitHub username
   - `GITHUB_REPO` — `yojana-setu`
4. Deploy. Render will install dependencies and the cron job will be scheduled per `render.yaml` (default: daily at 03:00 UTC — edit the `schedule` cron expression to change this).

## 6. Test it

- In the Render dashboard, open the `yojana-setu-agent` job and click **Trigger Run** to fire it manually instead of waiting for the schedule.
- Check the logs — you should see `Agent run start`, then either `N new scheme(s) added` or `0 new scheme(s) added`.
- Check your GitHub repo: `schemes.json` should now have a fresh `lastRun` date and possibly new entries, committed by a bot-looking commit.
- Refresh your GitHub Pages site — the status strip at the top should show the new `lastRun` date, and any new schemes will appear in the list tagged "Added by agent".

## Notes

- The agent commits **even when it finds 0 new schemes**, purely to update `lastRun`, so the site always shows a fresh "last checked" date.
- Because the model is prompted with your existing scheme names, it should avoid duplicating anything already on file — but always spot-check new entries occasionally, since eligibility details it finds are only as accurate as its sources.
- Render's free Cron Job tier is enough for one run a day. If you want multiple runs, just add more cron expressions or shorten the schedule.
- To manually add or correct a scheme yourself, just edit `schemes.json` directly in GitHub — the site will pick it up on next load.
