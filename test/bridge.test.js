import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { createRequire } from 'node:module'
import test from 'node:test'

import { WebSocket } from 'ws'

import { createBridge } from '../lib/bridge.js'
import { KeywordSession } from '../lib/kws.js'

const require = createRequire(import.meta.url)
const sherpa = require('sherpa-onnx-node')

const MODEL = process.env.KWS_MODEL_DIR ?? 'D:/src/_models/sherpa-onnx-kws-zipformer-wenetspeech-3.3M-2024-01-01'
const hasModel = fs.existsSync(path.join(MODEL, 'tokens.txt'))

test('bridge streams PCM frames and reports keyword hits', { skip: !hasModel, timeout: 20000 }, async () => {
  const keywordsFile = path.join(MODEL, 'test_wavs', 'test_keywords.txt')
  const bridge = createBridge({
    createSession: () => new KeywordSession({ modelDir: MODEL, keywordsFile }),
  })

  const server = http.createServer()
  server.on('upgrade', (request, socket, head) => bridge.handleUpgrade(request, socket, head))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = /** @type {import('node:net').AddressInfo} */ (server.address())

  const wave = sherpa.readWave(path.join(MODEL, 'test_wavs', '3.wav'))
  const hits = []

  const socket = new WebSocket(`ws://127.0.0.1:${port}/wakeword`)
  await new Promise((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })

  socket.send(JSON.stringify({ type: 'hello' }))
  const done = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no keyword hit within 10s')), 10000)
    socket.on('message', (data) => {
      const message = JSON.parse(String(data))
      if (message.type === 'hit') {
        hits.push(message)
        clearTimeout(timer)
        resolve()
      }
    })
  })

  const CHUNK = 1600
  for (let i = 0; i < wave.samples.length; i += CHUNK) {
    const chunk = wave.samples.subarray(i, i + CHUNK)
    socket.send(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength))
  }
  socket.send(JSON.stringify({ type: 'flush' }))

  await done
  assert.equal(hits[0].keyword, '文森特卡索')
  assert.equal(hits[0].mode, 'wake')
  assert.ok(Array.isArray(hits[0].timestamps))

  socket.close()
  bridge.close()
  await new Promise((resolve) => server.close(resolve))
})
