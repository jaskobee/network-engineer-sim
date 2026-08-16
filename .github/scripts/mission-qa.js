#!/usr/bin/env node
/**
 * Mission QA Agent — drives the test suite and asks Claude to report
 * which missions are working and which are broken, in plain English.
 *
 * This is your automated QA engineer. It runs on every push to main and
 * on a weekly schedule, so you always know if a code change broke a mission.
 *
 * Required env vars:
 *   ANTHROPIC_API_KEY
 */
import Anthropic from '@anthropic-ai/sdk'
import { spawnSync } from 'child_process'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve, join } from 'path'

if (!process.env.ANTHROPIC_API_KEY) {
  console.log('ANTHROPIC_API_KEY not set — skipping Mission QA.')
  process.exit(0)
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const client = new Anthropic()

// Run the full test suite and capture all output
console.log('Running test suite for Mission QA analysis...\n')
const result = spawnSync('npm', ['test'], {
  cwd: ROOT,
  encoding: 'utf8',
  maxBuffer: 10 * 1024 * 1024,
  env: { ...process.env, FORCE_COLOR: '0' },  // disable colors so output is clean
})

const testOutput = (result.stdout || '') + (result.stderr || '')
const testPassed = result.status === 0
console.log(`Tests ${testPassed ? 'PASSED ✅' : 'FAILED ❌'}\n`)

// Read the missions definition for context
let missionsSource = ''
try {
  missionsSource = readFileSync(join(ROOT, 'src/data/missions.js'), 'utf8')
} catch {
  missionsSource = '(could not read src/data/missions.js)'
}

console.log('Asking Claude for a mission-focused QA report...\n')

const stream = client.messages.stream({
  model: 'claude-opus-5',
  max_tokens: 2000,
  thinking: { type: 'adaptive' },
  messages: [{
    role: 'user',
    content: `You are the Mission QA Agent for NetSim, a browser-based networking education game.
Analyze the test results with a focus on which missions are working and which are broken.

Here are the mission definitions for context:
<missions>
${missionsSource.slice(0, 12_000)}
</missions>

Here is the complete test output:
<test-output>
${testOutput.slice(0, 30_000)}
</test-output>

Overall test status: ${testPassed ? 'PASSED' : 'FAILED'}

Report:
1. Which missions are fully working (their tests pass)
2. Which missions have failing tests — name each mission, describe what broke in plain English
3. Any engine-level failures (CLIEngine, Topology, checkPing/BFS) that would affect gameplay even if mission tests pass
4. A prioritized fix list

Format as:

## 🎮 Mission QA Report

### Mission Status
| Mission | Status | Issue |
|---------|--------|-------|
| 001 — Name | ✅ Pass | |
| 002 — Name | ❌ Fail | what broke |

### Engine Issues
(CLIEngine / Topology / checkPing failures that affect gameplay)

### Fix Priority
1. Most urgent fix
2. Next fix
...`,
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

// Exit with the actual test status so CI can gate on it
process.exit(testPassed ? 0 : 1)
