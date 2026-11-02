import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import test from 'node:test'

import { KeywordSession } from '../lib/kws.js'
import { describeModel, resolveModel } from '../lib/model.js'

const require = createRequire(import.meta.url)
const sherpa = require('sherpa-onnx-node')

const MODEL = process.env.KWS_MODEL_DIR ?? 'D:/src/_models/sherpa-onnx-kws-zipformer-wenetspeech-3.3M-2024-01-01'
const hasModel = fs.existsSync(path.join(MODEL, 'tokens.txt'))

test('describeModel reports a directory that is not a model', () => {
  const result = describeModel('D:/definitely/not/a/model')
  assert.equal(result.ready, false)
  assert.match(String(result.missing), /incomplete KWS model/)
})

test('resolveModel finds encoder/decoder/joiner and tokens', { skip: !hasModel }, () => {
  const files = resolveModel(MODEL)
  for (const key of ['encoder', 'decoder', 'joiner', 'tokens']) {
    assert.ok(fs.existsSync(files[key]), `${key} should exist`)
  }
})

test('chunked stream detects known keywords with timestamps', { skip: !hasModel }, () => {
  const wave = sherpa.readWave(path.join(MODEL, 'test_wavs', '3.wav'))
  const session = new KeywordSession({
    modelDir: MODEL,
    keywordsFile: path.join(MODEL, 'test_wavs', 'test_keywords.txt'),
  })

  /** @type {any[]} */
  const hits = []
  for (let i = 0; i < wave.samples.length; i += 1600) {
    hits.push(...session.push(wave.samples.subarray(i, i + 1600)))
  }
  hits.push(...session.flush())
  session.close()

  const words = hits.map((hit) => hit.keyword)
  assert.ok(words.includes('文森特卡索'), `expected 文森特卡索, got: ${words.join(', ') || '(none)'}`)
  const first = hits[0]
  assert.ok(first.timestamps.length > 0, 'keyword result should carry token timestamps')
  assert.equal(typeof first.start_time, 'number')
})
