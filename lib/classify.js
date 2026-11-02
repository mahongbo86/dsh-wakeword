/**
 * Classify a detected keyword by the mode it was spotted in. The browser only
 * needs to know whether to start dictation, finish it, confirm the send, or
 * throw the take away.
 *
 * @param {{wake: string[], stop: string[], cancel: string[], send?: string[]}} keywords
 * @returns {(keyword: string, mode: 'wake' | 'dictate' | 'confirm') => 'wake' | 'stop' | 'cancel' | 'send' | undefined}
 */
export function createClassifier(keywords) {
  const send = keywords.send ?? []
  return (keyword, mode) => {
    if (mode === 'wake') return keywords.wake.includes(keyword) ? 'wake' : undefined
    if (keywords.cancel.includes(keyword)) return 'cancel'
    if (mode === 'confirm') return send.includes(keyword) ? 'send' : undefined
    if (keywords.stop.includes(keyword)) return 'stop'
    return undefined
  }
}
