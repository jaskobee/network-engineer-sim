// Which token of a `ping …` line is the destination — so a flag's value (`-c 4`, `-n 2`) is never
// mistaken for a name to resolve. Pure; the shells own the flags' meaning, this only finds the target.

// Flags that take a value, per OS (Linux `-t` is a TTL; Windows `-t` means "until stopped").
const VALUE_FLAGS = {
  linux:   new Set(['-c', '-w', '-W', '-i', '-s', '-t', '-M', '-I', '-S', '-Q', '-l', '-p']),
  windows: new Set(['-n', '-w', '-l', '-i', '-r', '-s', '-j', '-k', '-S', '-R', '-v']),
  ios:     new Set(),
}

/**
 * @param {string[]} tokens the tokenised line, tokens[0] === 'ping'
 * @param {'linux'|'windows'|'ios'} os
 * @returns {string|null} the destination as typed, or null when there is none
 */
export function pingTargetOf(tokens, os = 'linux') {
  const valueFlags = VALUE_FLAGS[os] ?? VALUE_FLAGS.linux
  let target = null
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.startsWith('-')) {
      if (valueFlags.has(t)) i++   // skip its value
      continue
    }
    target = t
  }
  return target
}
