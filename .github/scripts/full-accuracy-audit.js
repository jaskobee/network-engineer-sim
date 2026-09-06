#!/usr/bin/env node
/**
 * Full Accuracy Audit Agent — reviews the ENTIRE networking engine (not a
 * diff) as a seasoned network engineer would, against docs/NETWORKING_ACCURACY.md.
 *
 * Why this exists alongside ai-review.js:
 *   ai-review.js only ever sees what changed in one PR. A bug introduced two
 *   releases ago, or a pre-built mission topology that was always subtly wrong,
 *   never shows up in a diff review. This agent re-reads the whole current
 *   engine + every mission/dev-mode topology on a schedule, so drift and
 *   long-standing mistakes get caught even when nobody is touching that file.
 *
 * How it works:
 *   1. Reads docs/NETWORKING_ACCURACY.md as the hard spec
 *   2. Reads every engine + topology-defining source file in full (current
 *      state, not a diff)
 *   3. Sends it all to Claude claude-opus-5, prompted to audit like a
 *      CCNP-level engineer against the spec's own Prompt 1-7 categories
 *   4. Posts the report as a comment on a persistent tracking issue (created
 *      on first run) — there's no PR to comment on for a whole-project audit
 *
 * This is advisory, like ai-review.js — it never fails the job. The real
 * pass/fail gate stays `npm test` in ci.yml.
 *
 * Required env vars (set in the workflow):
 *   ANTHROPIC_API_KEY, GITHUB_TOKEN, GITHUB_REPOSITORY
 */
import Anthropic from '@anthropic-ai/sdk'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve, join } from 'path'

if (!process.env.ANTHROPIC_API_KEY) {
  console.log('ANTHROPIC_API_KEY not set — skipping Full Accuracy Audit.')
  process.exit(0)
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const client = new Anthropic()

const GITHUB_TOKEN = process.env.GITHUB_TOKEN
const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY

const TRACKING_ISSUE_TITLE = '🧭 Full Networking Accuracy Audit'
const TRACKING_LABEL = 'accuracy-audit'

// Every file that defines CLI behavior, show output, routing/switching logic,
// or a pre-built topology (missions + dev-mode presets). All of these together
// are currently ~350KB (~90K tokens) — comfortably inside Opus's context, so
// this cap is a defensive ceiling against a future runaway file, not an active
// truncation. Raise it if the source set genuinely outgrows this budget.
const MAX_FILE_CHARS = 150_000
const SOURCES = [
  'src/models/CLIEngine.js',
  'src/models/PCCLIEngine.js',
  'src/models/WindowsCLIEngine.js',
  'src/models/Topology.js',
  'src/models/Device.js',
  'src/models/DHCPEngine.js',
  'src/models/ipUtils.js',
  'src/data/deviceCatalog.js',
  'src/data/missions.js',
  'src/data/mission005scaffold.js',
  'src/data/missionTasks.js',
  'src/devMode/presets.js',
]

function readCapped(relPath) {
  let text
  try {
    text = readFileSync(join(ROOT, relPath), 'utf8')
  } catch {
    return `\n\n### FILE: ${relPath}\n(could not read this file)\n`
  }
  const capped = text.length > MAX_FILE_CHARS
    ? text.slice(0, MAX_FILE_CHARS) + `\n\n[truncated at ${MAX_FILE_CHARS} chars — file is ${text.length} chars total]`
    : text
  return `\n\n### FILE: ${relPath}\n\`\`\`js\n${capped}\n\`\`\`\n`
}

const spec = readFileSync(join(ROOT, 'docs/NETWORKING_ACCURACY.md'), 'utf8')
const engineSource = SOURCES.map(readCapped).join('')

console.log(`Sending spec (${spec.length} chars) + ${SOURCES.length} source files (${engineSource.length} chars) to Claude for a full accuracy audit...\n`)

const stream = client.messages.stream({
  model: 'claude-opus-5',
  max_tokens: 4096,
  thinking: { type: 'adaptive' },
  messages: [{
    role: 'user',
    content: `You are a seasoned CCNP-level network engineer auditing NetSim, a browser-based networking
education game, for accuracy. This is a FULL PROJECT AUDIT of the engine's current state — not a
diff. Read every file below as if you were seeing this codebase for the first time and had to
certify it teaches real Cisco IOS (router/switch) and real Linux iproute2 (PC/server) behavior
correctly, with no shortcuts a CCNA/Network+ candidate would have to unlearn later.

<spec>
${spec}
</spec>

<engine-source>
${engineSource}
</engine-source>

Audit against the spec's own categories (cite file:line for every finding):

1. L2/L3 boundary — does the switch route anything, or accept an IP on a physical switchport?
   Is management IP correctly SVI-only?
2. Inter-VLAN routing — is router-on-a-stick / L3 switch modeled correctly (subinterfaces,
   encapsulation dot1Q, trunk enforcement)?
3. IP/subnet math — network/broadcast rejection, /31 and /32 handling, contiguous masks,
   gateway-in-subnet checks — any place this is wrong or inconsistent?
4. Routing table realism — longest-prefix match, connected routes needing up/up, return-path
   enforcement, static route next-hop reachability.
5. Interface/physical states — admin-down vs link-down vs up/up kept distinct; IOS vs Linux
   idioms not leaking into each other.
6. L2 forwarding / MAC-VLAN logic — anything that uses an IP where only MAC/VLAN should matter.
7. DHCP / NAT / firewall — DORA + relay + broadcast-domain rules, RFC1918 + PAT overload rules,
   zone-based stateful firewall rules (default-deny, first-match, statefulness asymmetry).
8. Pre-built topologies — every mission scaffold (missions.js, mission005scaffold.js) and every
   dev-mode preset (devMode/presets.js): would this topology and its claimed IPs/routes/rules
   actually forward traffic the way real hardware would? Flag any topology whose "solved" state
   wouldn't actually work, or whose "broken" state wouldn't actually fail the way it claims to.
9. CLI command surface and show-output format — any command accepted that real IOS/iproute2
   would reject, or any command real hardware accepts that this engine wrongly rejects; any show
   output that doesn't match real formatting.

Do not just say "looks fine" — you have the whole codebase, so look specifically for things a
one-PR diff reviewer would miss: logic two files rely on inconsistently, a mission scaffold that
drifted after an engine change, a documented simplification that quietly stopped being flagged
as one. If you find nothing wrong in a category, say so explicitly rather than skipping it.

Format exactly as:

## 🧭 Full Networking Accuracy Audit — ${new Date().toISOString().slice(0, 10)}

### Findings by category
(one subsection per numbered category above; "None found." if genuinely clean)

### Severity summary
| Severity | Count | Examples (file:line) |
|---|---|---|

### Verdict
**PASS** ✅  or  **NEEDS ATTENTION** ⚠️ (with a one-line reason either way)`,
  }],
})

let report = ''
for await (const event of stream) {
  if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
    report += event.delta.text
    process.stdout.write(event.delta.text)
  }
}
console.log('\n')

if (!GITHUB_TOKEN || !GITHUB_REPOSITORY) {
  console.log('(No GitHub context — report printed above only)')
  process.exit(0)
}

const ghHeaders = {
  Authorization: `Bearer ${GITHUB_TOKEN}`,
  'Content-Type': 'application/json',
  Accept: 'application/vnd.github.v3+json',
}

// Find the persistent tracking issue (by label), or create it on first run.
let issueNumber = null
const searchRes = await fetch(
  `https://api.github.com/repos/${GITHUB_REPOSITORY}/issues?labels=${TRACKING_LABEL}&state=open&per_page=1`,
  { headers: ghHeaders }
)
if (searchRes.ok) {
  const issues = await searchRes.json()
  if (issues.length > 0) issueNumber = issues[0].number
} else {
  console.error(`Could not search for tracking issue: ${searchRes.status} ${await searchRes.text()}`)
}

if (issueNumber === null) {
  const createRes = await fetch(
    `https://api.github.com/repos/${GITHUB_REPOSITORY}/issues`,
    {
      method: 'POST',
      headers: ghHeaders,
      body: JSON.stringify({
        title: TRACKING_ISSUE_TITLE,
        labels: [TRACKING_LABEL],
        body: 'Running log of full-codebase networking accuracy audits. Each run posts a new comment below — this issue itself is never closed automatically.\n\n' + report,
      }),
    }
  )
  if (createRes.ok) {
    const created = await createRes.json()
    console.log(`✅ Created tracking issue #${created.number}`)
  } else {
    console.error(`❌ Failed to create tracking issue: ${createRes.status} ${await createRes.text()}`)
    process.exit(1)
  }
} else {
  const commentRes = await fetch(
    `https://api.github.com/repos/${GITHUB_REPOSITORY}/issues/${issueNumber}/comments`,
    { method: 'POST', headers: ghHeaders, body: JSON.stringify({ body: report }) }
  )
  if (commentRes.ok) {
    console.log(`✅ Posted audit to tracking issue #${issueNumber}`)
  } else {
    console.error(`❌ Failed to post comment: ${commentRes.status} ${await commentRes.text()}`)
    process.exit(1)
  }
}

// Advisory only — never fail the job. npm test in ci.yml is the real gate.
process.exit(0)
