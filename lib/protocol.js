/** Text control messages exchanged on the wake-word socket. */
export const CONTROL = {
  hello: 'hello',
  ready: 'ready',
  mode: 'mode',
  flush: 'flush',
  hit: 'hit',
  error: 'error',
}

/** @param {unknown} message */
export function encode(message) {
  return JSON.stringify(message)
}

/**
 * Parse a control frame. Returns undefined for anything that is not a
 * well-formed message object.
 *
 * @param {string | Buffer} data
 */
export function decode(data) {
  try {
    const value = JSON.parse(typeof data === 'string' ? data : data.toString('utf8'))
    if (value === null || typeof value !== 'object' || typeof value.type !== 'string') return undefined
    return value
  } catch {
    return undefined
  }
}

/**
 * Convert a binary frame into 16 kHz mono float samples.
 *
 * The incoming Buffer is copied first because its byteOffset is not
 * guaranteed to be 4-byte aligned, which Float32Array requires.
 *
 * @param {Buffer | ArrayBuffer | Uint8Array} data
 * @returns {Float32Array}
 */
export function toFloat32(data) {
  const bytes = new Uint8Array(data)
  if (bytes.byteLength % 4 !== 0) {
    throw new Error(`audio frame is not Float32: ${bytes.byteLength} bytes`)
  }
  return new Float32Array(bytes.buffer.slice(0))
}
