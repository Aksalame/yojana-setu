// Yojana Setu — daily scheme-discovery agent
// Reads schemes.json from GitHub, asks Claude (with web search) for genuinely
// new central government schemes, and commits any new ones back to GitHub.
//
// Requires Node 18+ (built-in fetch). Run with: node agent.js
//
// Required environment variables (set these in Render, never commit them):
//   ANTHROPIC_API_KEY   - from https://console.anthropic.com
//   GITHUB_TOKEN        - a GitHub personal access token with "repo" contents read/write
//   GITHUB_OWNER        - your GitHub username or org
//   GITHUB_REPO         - the repo name (e.g. yojana-setu)
// Optional:
//   GITHUB_BRANCH       - defaults to "main"
//   SCHEMES_PATH        - defaults to "schemes.json"

const {
  ANTHROPIC_API_KEY,
  GITHUB_TOKEN,
  GITHUB_OWNER,
  GITHUB_REPO,
  GITHUB_BRANCH = 'main',
  SCHEMES_PATH = 'schemes.json',
} = process.env;

function requireEnv() {
  const missing = ['ANTHROPIC_API_KEY', 'GITHUB_TOKEN', 'GITHUB_OWNER', 'GITHUB_REPO']
    .filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(`Missing required environment variable(s): ${missing.join(', ')}`);
  }
}

async function getCurrentSchemes() {
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${SCHEMES_PATH}?ref=${GITHUB_BRANCH}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      'User-Agent': 'yojana-setu-agent',
      Accept: 'application/vnd.github+json',
    },
  });
  if (!res.ok) throw new Error(`GitHub read failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const content = Buffer.from(data.content, 'base64').toString('utf-8');
  const parsed = JSON.parse(content || '{"lastRun":null,"schemes":[]}');
  return { doc: parsed, sha: data.sha };
}

async function findNewSchemes(existingNames) {
  const systemPrompt = `You are a research agent for an Indian government-scheme discovery website.
Search the web for Indian CENTRAL GOVERNMENT welfare/benefit schemes that were newly launched, or had a
significant eligibility update, in roughly the last 14 days.
Ignore state-only schemes. Ignore anything without a verifiable official (.gov.in or ministry) link.
Do not include any of these already-known schemes: ${existingNames.join(', ') || '(none yet)'}.

Respond with ONLY a raw JSON array (no markdown fences, no commentary). Each item must have exactly these fields:
name (string), cat (one of: Agriculture, Health, Education, Housing, Women & Child, Employment, Social Security, Business, Other),
desc (1-2 plain sentences), minAge (number or null), maxAge (number or null), maxIncome (number or null, annual rupees),
gender (string or null), occupation (string or null), link (string, must be an official government URL).
If you find nothing genuinely new, respond with an empty array: []`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: 'user', content: 'Find newly announced Indian central government welfare schemes from the last two weeks.' }],
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const text = (data.content || [])
    .map((block) => (block.type === 'text' ? block.text : ''))
    .filter(Boolean)
    .join('\n')
    .replace(/```json|```/g, '')
    .trim();

  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    console.warn('Could not parse model output as JSON, treating as no new schemes. Raw output:', text);
    return [];
  }
}

async function commitSchemes(doc, sha, addedCount) {
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${SCHEMES_PATH}`;
  const content = Buffer.from(JSON.stringify(doc, null, 2)).toString('base64');
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      'User-Agent': 'yojana-setu-agent',
      Accept: 'application/vnd.github+json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      message: `agent: add ${addedCount} scheme(s) — ${doc.lastRun}`,
      content,
      sha,
      branch: GITHUB_BRANCH,
    }),
  });
  if (!res.ok) throw new Error(`GitHub write failed: ${res.status} ${await res.text()}`);
}

async function main() {
  requireEnv();
  console.log('Agent run start:', new Date().toISOString());

  const { doc, sha } = await getCurrentSchemes();
  const existingNames = (doc.schemes || []).map((s) => s.name.toLowerCase());

  const found = await findNewSchemes(existingNames);
  let addedCount = 0;

  for (const s of found) {
    if (!s.name || existingNames.includes(s.name.toLowerCase())) continue;
    doc.schemes.push({
      name: s.name,
      cat: s.cat || 'Other',
      desc: s.desc || '',
      minAge: s.minAge ?? null,
      maxAge: s.maxAge ?? null,
      maxIncome: s.maxIncome ?? null,
      gender: s.gender ?? null,
      occupation: s.occupation ?? null,
      link: s.link || '#',
      addedOn: new Date().toISOString(),
    });
    existingNames.push(s.name.toLowerCase());
    addedCount++;
  }

  doc.lastRun = new Date().toISOString().slice(0, 10);

  // Always commit, even with 0 new schemes, so lastRun (shown on the site) stays current.
  await commitSchemes(doc, sha, addedCount);
  console.log(`Done. ${addedCount} new scheme(s) added. lastRun=${doc.lastRun}`);
}

main().catch((err) => {
  console.error('Agent failed:', err);
  process.exit(1);
});
