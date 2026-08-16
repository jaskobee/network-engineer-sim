#!/usr/bin/env node
/**
 * Accuracy Agent — reviews PRs for networking accuracy against the spec.
 *
 * How it works:
 *   1. Gets the diff between this PR and main (only src/ and docs/)
 *   2. Reads docs/NETWORKING_ACCURACY.md as the hard spec
 *   3. Sends both to Claude claude-opus-5 for review
 *   4. Posts the review as a comment on the PR
 *
 * Required env vars (set in the workflow):
 *   ANTHROPIC_API_KEY, GITHUB_TOKEN, PR_NUMBER, GITHUB_REPOSITORY, GITHUB_BASE_REF
 */
import Anthropic from '@anthropic-ai/sdk'
import { execSync } from 'child_process'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve, join } from 'path'

if (!process.env.ANTHROPIC_API_KEY) {
  console.log('ANTHROPIC_API_KEY not set — skipping AI accuracy review.')
  process.exit(0)
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const client = new Anthropic()

const PR_NUMBER = process.env.PR_NUMBER
const GITHUB_TOKEN = process.env.GITHUB_TOKEN
const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY
const BASE_REF = process.env.GITHUB_BASE_REF || 'main'

// Get the diff for this PR (only files that affect networking behavior)
let diff
try {
  diff = execSync(`git diff origin/${BASE_REF}...HEAD -- src/ docs/`, {
    encoding: 'utf8',
    maxBuffer: 5 * 1024 * 1024,
    cwd: ROOT,
  })
} catch (err) {
  console.error('Could not get git diff:', err.message)
  process.exit(1)
}

if (!diff.trim()) {
  console.log('No changes in src/ or docs/ — nothing to review.')
  process.exit(0)
}

const spec = readFileSync(join(ROOT, 'docs/NETWORKING_ACCURACY.md'), 'utf8')

// Truncate if the diff is huge (Claude has a context limit)
const MAX_DIFF = 40_000
const diffSnippet = diff.length > MAX_DIFF
  ? diff.slice(0, MAX_DIFF) + '\n\n[diff truncated at 40KB]'
  : diff

console.log(`Sending ${diff.length} chars of diff to Claude for accuracy review...\n`)

// Stream the review so we can see progress in the Actions log
const stream = client.messages.stream({
  model: 'claude-opus-5',
  max_tokens: 2048,
  thinking: { type: 'adaptive' },
  messages: [{
    role: 'user',
    content: `You are the Networking Accuracy Agent for NetSim, a browser-based networking education game.
Review the code diff below for networking accuracy issues. The project must comply with the spec.

<spec>
${spec}
</spec>

<diff>
${diffSnippet}
</diff>

Check for:
1. Wrong CLI syntax/output (IOS router/switch vs Linux PC/server idioms must not be mixed)
2. Incorrect routing logic, L2/L3 boundary violations, subnet math errors
3. Mission validation that tests the wrong conditions
4. Engine bugs in checkPing/BFS, routing tables, VLAN handling
5. Anything that teaches beginners something they would have to unlearn for CCNA/Network+

Cite the specific file and line number for each issue found. If everything looks accurate, say so clearly.

Format exactly as:

## 🔍 AI Networking Accuracy Review

### Issues Found
(list each issue with file:line and explanation — or write "None found.")

### What Looks Correct
(brief list of things you verified are accurate)

### Verdict
**PASS** ✅  or  **NEEDS ATTENTION** ⚠️`,
  }],
})

let reviewText = ''
for await (const event of stream) {
  if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
    reviewText += event.delta.text
    process.stdout.write(event.delta.text)
  }
}
console.log('\n')

// Post the review as a PR comment via GitHub API
if (PR_NUMBER && GITHUB_TOKEN && GITHUB_REPOSITORY) {
  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_REPOSITORY}/issues/${PR_NUMBER}/comments`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        'Content-Type': 'application/json',
        Accept: 'application/vnd.github.v3+json',
      },
      body: JSON.stringify({ body: reviewText }),
    }
  )

  if (res.ok) {
    console.log(`✅ Posted review to PR #${PR_NUMBER}`)
  } else {
    console.error(`❌ Failed to post comment: ${res.status} ${await res.text()}`)
    process.exit(1)
  }
} else {
  console.log('(No PR context — review printed above only)')
}
