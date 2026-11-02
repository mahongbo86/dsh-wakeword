import { createRequire } from 'node:module'

import { resolveModel } from './model.js'

const require = createRequire(import.meta.url)

/** @type {any} */
let cached

/** Load sherpa-onnx lazily so a missing native package fails at use, not at import. */
function sherpa() {
  cached ??= require('sherpa-onnx-node')
  return cached
}

/** @typedef {{start_time: number, keyword: string, timestamps: number[], tokens: string[]}} KeywordResult */

/**
 * One keyword-spotting session over a single stream.
 *
 * Feed 16 kHz mono float samples with {@link push}; each call returns the
 * keywords detected while consuming that chunk.
 */
export class KeywordSession {
  #spotter
  #stream
  #closed = false

  /**
   * @param {{modelDir: string, keywordsFile: string, threshold?: number, score?: number, numThreads?: number, epoch?: string, int8?: boolean}} options
   */
  constructor(options) {
    const files = resolveModel(options.modelDir, { epoch: options.epoch, int8: options.int8 })
    const s = sherpa()

    this.#spotter = new s.KeywordSpotter({
      featConfig: { sampleRate: 16000, featureDim: 80 },
      modelConfig: {
        transducer: {
          encoder: files.encoder,
          decoder: files.decoder,
          joiner: files.joiner,
        },
        tokens: files.tokens,
        numThreads: options.numThreads ?? 1,
        provider: 'cpu',
      },
      keywordsFile: options.keywordsFile,
      keywordsScore: options.score ?? 1,
      keywordsThreshold: options.threshold ?? 0.25,
      maxActivePaths: 4,
      numTrailingBlanks: 2,
    })
    this.#stream = this.#spotter.createStream()
  }

  /**
   * Feed a chunk of 16 kHz mono samples.
   *
   * @param {Float32Array} samples
   * @returns {KeywordResult[]}
   */
  push(samples) {
    if (this.#closed) throw new Error('keyword session is closed')
    if (samples.length === 0) return []

    this.#stream.acceptWaveform({ sampleRate: 16000, samples })

    /** @type {KeywordResult[]} */
    const hits = []
    while (this.#spotter.isReady(this.#stream)) {
      this.#spotter.decode(this.#stream)
      const result = this.#spotter.getResult(this.#stream)
      if (result?.keyword) hits.push(result)
    }
    return hits
  }

  /**
   * Feed trailing silence so a keyword ending right at the buffer edge is emitted.
   *
   * @param {number} [seconds]
   * @returns {KeywordResult[]}
   */
  flush(seconds = 0.4) {
    return this.push(new Float32Array(Math.round(16000 * seconds)))
  }

  close() {
    this.#closed = true
    this.#stream = undefined
    this.#spotter = undefined
  }
}
