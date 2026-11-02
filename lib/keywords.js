import fs from 'node:fs'

import { pinyin } from 'pinyin-pro'

// Longest match first: two-letter initials before one-letter ones.
const INITIALS = [
  'zh', 'ch', 'sh',
  'b', 'p', 'm', 'f', 'd', 't', 'n', 'l', 'g', 'k', 'h',
  'j', 'q', 'x', 'r', 'z', 'c', 's', 'y', 'w',
]

const TONE_GROUPS = [
  'āáǎà', 'ēéěè', 'īíǐì', 'ōóǒò', 'ūúǔù', 'ǖǘǚǜ',
]

/** @param {string} tokensFile */
export function loadTokens(tokensFile) {
  const lines = fs.readFileSync(tokensFile, 'utf8').split(/\r?\n/)
  /** @type {Set<string>} */
  const set = new Set()
  for (const line of lines) {
    const token = line.split(' ')[0]
    if (token) set.add(token)
  }
  return set
}

/** Split a toned pinyin syllable into its initial and final. */
function splitSyllable(syllable) {
  for (const initial of INITIALS) {
    if (syllable.startsWith(initial)) {
      return [initial, syllable.slice(initial.length)]
    }
  }
  return ['', syllable]
}

/** Tone variants of a final, used for sandhi (不 bú -> bù) and neutral tones. */
function toneVariants(final) {
  const variants = new Set([final])
  for (const group of TONE_GROUPS) {
    for (const char of group) {
      if (final.includes(char)) {
        for (const other of group) variants.add(final.replace(char, other))
      }
    }
  }
  return [...variants]
}

/**
 * Convert one word into KWS tokens, checking each token against the model.
 *
 * @param {string} word
 * @param {Set<string>} tokens
 * @returns {string[]}
 */
export function toTokens(word, tokens) {
  const syllables = pinyin(word, { toneType: 'symbol', type: 'array' })
  /** @type {string[]} */
  const out = []
  /** @type {string[]} */
  const unsupported = []

  for (const syllable of syllables) {
    if (!/^[a-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü]+$/i.test(syllable)) {
      unsupported.push(syllable)
      continue
    }
    const [initial, final] = splitSyllable(syllable.toLowerCase())
    const finalToken = toneVariants(final).find((variant) => tokens.has(variant))
    if (initial && !tokens.has(initial)) unsupported.push(`${syllable} (${initial})`)
    else if (finalToken === undefined) unsupported.push(`${syllable} (${final})`)
    else {
      if (initial) out.push(initial)
      out.push(finalToken)
    }
  }

  if (unsupported.length > 0) {
    throw new Error(`unsupported syllables in "${word}": ${unsupported.join(', ')}`)
  }
  return out
}

/**
 * Build one `keywords.txt` line.
 *
 * @param {string} word
 * @param {Set<string>} tokens
 */
export function keywordsLine(word, tokens) {
  return `${toTokens(word, tokens).join(' ')} @${word}`
}

/**
 * Write a keywords file for the given words.
 *
 * @param {string} file
 * @param {string[]} words
 * @param {Set<string>} tokens
 */
export function writeKeywordsFile(file, words, tokens) {
  const lines = words.map((word) => keywordsLine(word, tokens))
  fs.writeFileSync(file, `${lines.join('\n')}\n`)
  return lines
}
