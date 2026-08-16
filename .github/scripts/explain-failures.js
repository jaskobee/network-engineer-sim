#!/usr/bin/env node
/**
 * Test Failure Explainer — when CI goes red, Claude explains what broke
 * in plain English and suggests a specific fix.
 *
 * Called automatically by ci.yml when npm test fails.
 * Usage: node .github/scripts/explain-failures.js <path-to-test-output-file>
 *
 * Required env vars (set in the workflow):
 *   ANTHROPIC_API_KEY, GITHUB_TOKEN, PR_NUMBER, GITHUB_REPOSITORY
 */
import Anthropic from '@anthropic-ai/sdk'
import { readFileSync } from 'fs'

// Exit cleanly if no API key configured — CI still fails, just no explanation
if (!process.env.ANTHROPIC_API_KEY) {
  console.log('ANTHROPIC_API_KEY not set — skipping AI explanation.')
  process.exit(0)
}

const testOutputFile = process.argv[2]
if (!testOutputFile) {
  console.error('Usage: node explain-failures.js <test-output-file>')
  process.exit(1)
}

const client = new Anthropic()
const testOutput = readFileSync(testOutputFile, 'utf8')

const PR_NUMBER = process.env.PR_NUMBER
const GITHUB_TOKEN = process.env.GITHUB_TOKEN
const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY

console.log('Asking Claude to explain the test failures...\n')

const stream = client.messages.stream({
  model: 'claude-opus-5',
  max_tokens: 1500,
  thinking: { type: 'adaptive' },
  messages: [{
    role: 'user',
    content: `You are helping a developer understand why CI tests failed for NetSim, a browser-based networking education game.
The developer knows the codebase — no need to explain what the project is.

<test-output>
${testOutput.slice(0, 30_000)}
</test-output>

Explain concisely:
1. What failed (which tests, in plain English — not just the test name)
2. Why it likely failed (what code change probably caused it)
3. How to fix it (specific, actionable steps)

Format as:

## ❌ CI Failure Summary

### What Failed
(plain English description of the broken behavior)

### Likely Cause
(specific hypothesis about what code change triggered this)

### Suggested Fix
(actionable steps — file names, function names, what to change)`,
  }],
})

let explanation = ''
for await (const event of stream) {
  if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
    explanation += event.delta.text
    process.stdout.write(event.delta.text)
  }
}
console.log('\n')

// Post as a PR comment if we are in a PR context
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
      body: JSON.stringify({ body: explanation }),
    }
  )

  if (res.ok) {
    console.log(`✅ Posted explanation to PR #${PR_NUMBER}`)
  } else {
    console.error(`Failed to post comment: ${res.status} ${await res.text()}`)
  }
} else {
  console.log('(Push to main — explanation printed above, not posted as comment)')
}
