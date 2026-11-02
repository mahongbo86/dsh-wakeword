#!/usr/bin/env node
/**
 * Smoke test: run a sherpa-onnx KWS model over a wav file and print hits.
 *
 * Usage:
 *   node spikes/kws-smoke.js <model-dir> <wav> [keywords.txt]
 *
 * Env:
 *   SHERPA_PATH  path to the sherpa-onnx-node package directory
 *                (defaults to the dev-only copy at D:/src/_dsh-ref)
 */
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const sherpa = require(process.env.SHERPA_PATH ?? 'D:/src/_dsh-ref/sherpa-onnx-node')

const [modelDir, wavPath, keywordsArg] = process.argv.slice(2)
if (!modelDir || !wavPath) {
  console.error('usage: node spikes/kws-smoke.js <model-dir> <wav> [keywords.txt]')
  process.exit(1)
}

const at = (file) => path.join(modelDir, file)
const keywordsFile = keywordsArg ?? path.join(modelDir, 'keywords.txt')
const epoch = process.env.KWS_EPOCH ?? '12-avg-2'
const threshold = Number(process.env.KWS_THRESHOLD ?? 0.25)
const model = (kind) => at(`${kind}-epoch-${epoch}-chunk-16-left-64.int8.onnx`)

console.log(`model=epoch-${epoch} threshold=${threshold} keywords=${path.basename(keywordsFile)}`)

const spotter = new sherpa.KeywordSpotter({
  featConfig: { sampleRate: 16000, featureDim: 80 },
  modelConfig: {
    transducer: {
      encoder: model('encoder'),
      decoder: model('decoder'),
      joiner: model('joiner'),
    },
    tokens: at('tokens.txt'),
    numThreads: 2,
    provider: 'cpu',
    debug: 0,
  },
  keywordsFile,
  keywordsScore: 1.0,
  keywordsThreshold: threshold,
  maxActivePaths: 4,
  numTrailingBlanks: 2,
})

const wave = sherpa.readWave(wavPath)
console.log(`wav=${path.basename(wavPath)} samples=${wave.samples.length} rate=${wave.sampleRate}`)

const stream = spotter.createStream()
stream.acceptWaveform({ sampleRate: wave.sampleRate, samples: wave.samples })
// Trailing silence lets the decoder flush the last chunk before we read results.
stream.acceptWaveform({ sampleRate: wave.sampleRate, samples: new Float32Array(wave.sampleRate * 0.4) })

const hits = []
while (spotter.isReady(stream)) {
  spotter.decode(stream)
  const result = spotter.getResult(stream)
  if (result?.keyword) {
    hits.push(result)
    console.log('HIT', JSON.stringify(result))
  }
}

console.log(`hits=${hits.length}`)
if (hits.length === 0) process.exitCode = 2
