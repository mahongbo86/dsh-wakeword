import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { keywordsLine, loadTokens, toTokens, writeKeywordsFile } from '../lib/keywords.js'

const MODEL = process.env.KWS_MODEL_DIR ?? 'D:/src/_models/sherpa-onnx-kws-zipformer-wenetspeech-3.3M-2024-01-01'
const TOKENS = path.join(MODEL, 'tokens.txt')
const hasModel = fs.existsSync(TOKENS)

test('toTokens splits initials, finals and handles tone sandhi', { skip: !hasModel }, () => {
  const tokens = loadTokens(TOKENS)
  assert.deepEqual(toTokens('嘿小助手', tokens), ['h', 'ēi', 'x', 'iǎo', 'zh', 'ù', 'sh', 'ǒu'])
  assert.deepEqual(toTokens('说完了', tokens), ['sh', 'uō', 'w', 'án', 'l', 'e'])
  // pinyin-pro applies tone sandhi: 不 before a fourth tone reads bú, and the model has both bú and bù.
  assert.deepEqual(toTokens('不用了', tokens), ['b', 'ú', 'y', 'òng', 'l', 'e'])
})

test('toTokens rejects words the model cannot spell', { skip: !hasModel }, () => {
  const tokens = loadTokens(TOKENS)
  assert.throws(() => toTokens('DSH', tokens), /unsupported syllables/)
})

test('keywordsLine writes the sherpa keyword format', { skip: !hasModel }, () => {
  const tokens = loadTokens(TOKENS)
  assert.equal(keywordsLine('嘿小助手', tokens), 'h ēi x iǎo zh ù sh ǒu @嘿小助手')
})

test('writeKeywordsFile produces one line per word', { skip: !hasModel }, () => {
  const tokens = loadTokens(TOKENS)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kws-keywords-'))
  const file = path.join(dir, 'keywords.txt')
  writeKeywordsFile(file, ['嘿小助手', '说完了'], tokens)
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n')
  assert.equal(lines.length, 2)
  assert.ok(lines[0].endsWith('@嘿小助手'))
})
