import assert from 'node:assert/strict'
import test from 'node:test'

import { keywordCacheDir, resolveConfig } from '../lib/config.js'

test('resolveConfig fills defaults around an explicit model directory', () => {
  const config = resolveConfig({ modelDir: 'D:/models/kws' })
  assert.equal(config.path, '/wakeword')
  assert.equal(config.modelDir, 'D:/models/kws')
  assert.equal(config.threshold, 0.25)
  assert.deepEqual(config.keywords, {
    wake: ['嘿小助手'],
    stop: ['说完了'],
    cancel: ['不用了'],
  })
})

test('resolveConfig rejects malformed keyword lists', () => {
  assert.throws(() => resolveConfig({ modelDir: 'D:/m', keywords: { wake: '嘿' } }), /must be a non-empty array/)
  assert.throws(() => resolveConfig({ modelDir: 'D:/m', keywords: { stop: [''] } }), /must be a non-empty array/)
})

test('resolveConfig falls back to the default route for a bad path', () => {
  assert.equal(resolveConfig({ modelDir: 'D:/m', path: 'wakeword' }).path, '/wakeword')
  assert.equal(resolveConfig({ modelDir: 'D:/m', path: '/custom' }).path, '/custom')
})

test('resolveConfig falls back to the user home when DSH_HOME is absent', () => {
  const previous = process.env.DSH_HOME
  delete process.env.DSH_HOME
  try {
    const config = resolveConfig({})
    assert.match(config.modelDir, /\.dsh\/models\/kws\/sherpa-onnx-kws-zipformer-wenetspeech-3\.3M-2024-01-01$/)
  } finally {
    if (previous !== undefined) process.env.DSH_HOME = previous
  }
})

test('keywordCacheDir prefers the DSH home', () => {
  assert.match(keywordCacheDir('C:/dsh'), /C:\/dsh\/cache\/dsh-wakeword/)
})
