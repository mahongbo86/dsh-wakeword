import assert from 'node:assert/strict'
import test from 'node:test'

import { createClassifier } from '../lib/classify.js'

const classify = createClassifier({
  wake: ['嘿小助手'],
  stop: ['说完了'],
  cancel: ['不用了'],
})

test('wake mode only recognises wake words', () => {
  assert.equal(classify('嘿小助手', 'wake'), 'wake')
  assert.equal(classify('说完了', 'wake'), undefined)
})

test('dictate mode separates stop from cancel', () => {
  assert.equal(classify('说完了', 'dictate'), 'stop')
  assert.equal(classify('不用了', 'dictate'), 'cancel')
  assert.equal(classify('嘿小助手', 'dictate'), undefined)
})
