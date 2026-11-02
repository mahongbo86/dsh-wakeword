window.__ModuleLoader__.load({
  id: 'dsh-wakeword',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const SAMPLE_RATE = 16000;
    const FRAME_SAMPLES = 1600; // 100 ms

    // ------------------------------------------------------------- endpoints

    // Desktop serves the page from dsh-app://app, so a same-origin URL never
    // reaches the Host web server. __DSH_TRANSPORT__.streamBaseUrl names the
    // real HTTP origin; a plain browser falls back to its own base URI.
    function hostBase() {
      const transport = globalThis.__DSH_TRANSPORT__;
      if (transport && typeof transport.streamBaseUrl === 'string') return transport.streamBaseUrl;
      return document.baseURI;
    }

    function endpointUrl(path) {
      return new URL(path, hostBase());
    }

    // ---------------------------------------------------------------- audio

    function encodeWav(samples) {
      const buffer = new ArrayBuffer(44 + samples.length * 2);
      const view = new DataView(buffer);
      const write = (offset, text) => {
        for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
      };
      write(0, 'RIFF');
      view.setUint32(4, 36 + samples.length * 2, true);
      write(8, 'WAVE');
      write(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, SAMPLE_RATE, true);
      view.setUint32(28, SAMPLE_RATE * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      write(36, 'data');
      view.setUint32(40, samples.length * 2, true);
      let offset = 44;
      for (let i = 0; i < samples.length; i += 1) {
        const value = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(offset, value < 0 ? value * 0x8000 : value * 0x7fff, true);
        offset += 2;
      }
      return buffer;
    }

    function toBase64(buffer) {
      const bytes = new Uint8Array(buffer);
      let binary = '';
      const CHUNK = 0x8000;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
      }
      return btoa(binary);
    }

    const WORKLET = `
      class WakewordChunker extends AudioWorkletProcessor {
        constructor() {
          super();
          this.buffer = new Float32Array(${FRAME_SAMPLES});
          this.filled = 0;
        }
        process(inputs) {
          const channel = inputs[0] && inputs[0][0];
          if (!channel) return true;
          for (let i = 0; i < channel.length; i += 1) {
            this.buffer[this.filled] = channel[i];
            this.filled += 1;
            if (this.filled === this.buffer.length) {
              this.port.postMessage(this.buffer, [this.buffer.buffer]);
              this.buffer = new Float32Array(${FRAME_SAMPLES});
              this.filled = 0;
            }
          }
          return true;
        }
      }
      registerProcessor('wakeword-chunker', WakewordChunker);
    `;

    class MicCapture {
      constructor(onFrame) {
        this.onFrame = onFrame;
        this.context = null;
        this.node = null;
        this.stream = null;
      }

      async start() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error('当前环境不支持录音');
        }
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
        });
        this.context = new AudioContext({ sampleRate: SAMPLE_RATE });
        await this.context.resume();

        const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
        try {
          await this.context.audioWorklet.addModule(url);
        } finally {
          URL.revokeObjectURL(url);
        }

        this.node = new AudioWorkletNode(this.context, 'wakeword-chunker');
        this.node.port.onmessage = (event) => this.onFrame(event.data);
        const source = this.context.createMediaStreamSource(this.stream);
        // A worklet only runs while it is pulled towards the destination; keep it silent.
        const mute = this.context.createGain();
        mute.gain.value = 0;
        source.connect(this.node);
        this.node.connect(mute);
        mute.connect(this.context.destination);
        this.mute = mute;
        this.source = source;
      }

      async stop() {
        try {
          this.node && this.node.disconnect();
          this.mute && this.mute.disconnect();
          this.source && this.source.disconnect();
        } catch {
          // already torn down
        }
        if (this.stream) for (const track of this.stream.getTracks()) track.stop();
        if (this.context) await this.context.close().catch(() => {});
        this.node = null;
        this.stream = null;
        this.context = null;
      }
    }

    // ------------------------------------------------------------ component

    // Resolved in apply(); kept in factory scope so the component does not
    // depend on a slot-injected prop.
    let getSpeech = () => undefined;

    function WakewordButton(props) {
      const { inputActions } = props;
      const [phase, setPhase] = React.useState('idle');
      const [message, setMessage] = React.useState('');
      const [wakeWord, setWakeWord] = React.useState('唤醒词');

      const mic = React.useRef(null);
      const socket = React.useRef(null);
      const mode = React.useRef('wake');
      const recording = React.useRef(false);
      const chunks = React.useRef([]);
      const levels = React.useRef([]);
      const total = React.useRef(0);
      const alive = React.useRef(true);
      // One context created inside the click that arms the control: a context
      // made later, when a keyword fires, is outside the user gesture and may
      // stay suspended (so the cue stays silent).
      const cue = React.useRef(null);

      React.useEffect(() => () => {
        alive.current = false;
        teardown();
      }, []);

      // Read the configured wake word before the first connection so the label
      // is right at rest, not only after arming.
      React.useEffect(() => {
        let cancelled = false;
        fetch(endpointUrl('wakeword/config'), { cache: 'no-store' })
          .then((response) => (response.ok ? response.json() : undefined))
          .then((data) => {
            if (cancelled || !data || !Array.isArray(data.wakeWords) || data.wakeWords.length === 0) return;
            setWakeWord(String(data.wakeWords[0]));
          })
          .catch(() => {});
        return () => {
          cancelled = true;
        };
      }, []);

      function teardown() {
        recording.current = false;
        chunks.current = [];
        total.current = 0;
        if (mic.current) mic.current.stop().catch(() => {});
        mic.current = null;
        if (socket.current) {
          socket.current.onclose = null;
          socket.current.close();
          socket.current = null;
        }
        if (cue.current) {
          cue.current.close().catch(() => {});
          cue.current = null;
        }
      }

      function send(ws, message) {
        if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
      }

      function ding(frequency, duration) {
        const context = cue.current;
        if (!context) return;
        if (context.state === 'suspended') context.resume().catch(() => {});
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.frequency.value = frequency;
        gain.gain.value = 0.12;
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start();
        oscillator.stop(context.currentTime + duration);
        oscillator.onended = () => {
          oscillator.disconnect();
          gain.disconnect();
        };
      }

      function resetTake() {
        recording.current = false;
        chunks.current = [];
        levels.current = [];
        total.current = 0;
      }

      function onFrame(frame) {
        const ws = socket.current;
        if (ws && ws.readyState === WebSocket.OPEN) ws.send(frame.buffer);
        if (recording.current) {
          chunks.current.push(frame);
          total.current += frame.length;
          let sum = 0;
          for (let i = 0; i < frame.length; i += 1) sum += frame[i] * frame[i];
          levels.current.push(Math.sqrt(sum / frame.length));
        }
      }

      function samples() {
        const merged = new Float32Array(total.current);
        let offset = 0;
        for (const chunk of chunks.current) {
          merged.set(chunk, offset);
          offset += chunk.length;
        }
        return merged;
      }

      async function finishTake(hit) {
        recording.current = false;
        setPhase('transcribing');

        const all = samples();
        // Keyword timestamps are relative to the detected phrase, not to the
        // stream (verified: 3 s of leading silence still reports 0.08), so
        // locate the final speech run by level instead: the stop word is the
        // last voiced stretch, and the text ends where that stretch begins.
        const lv = levels.current;
        const peak = lv.length > 0 ? Math.max(...lv) : 0;
        const threshold = Math.max(0.002, peak * 0.12);
        let end = lv.length - 1;
        while (end >= 0 && lv[end] < threshold) end -= 1;
        let startFrame = end;
        while (startFrame >= 0 && lv[startFrame] >= threshold) startFrame -= 1;
        const runStart = Math.max(0, (startFrame + 1) * FRAME_SAMPLES - FRAME_SAMPLES * 2);
        const fallback = Math.max(0, all.length - SAMPLE_RATE * 1.2);
        const cut = runStart > all.length * 0.3 ? runStart : fallback;
        const pcm = all.subarray(0, Math.min(cut, all.length));
        send(socket.current, {
          type: 'debug',
          data: { event: 'stop', total: all.length, peak, threshold, runStart, cut, pcm: pcm.length },
        });

        send(socket.current, { type: 'mode', value: 'wake' });
        mode.current = 'wake';
        resetTake();

        if (pcm.length < SAMPLE_RATE * 0.2) {
          setMessage('没听清，再说一次');
          setPhase('listening');
          return;
        }

        try {
          const speech = getSpeech();
          if (!speech) throw new Error('无法访问 Remote 服务');
          if (typeof speech.transcribe !== 'function') throw new Error('语音输入插件未启用');
          const result = await speech.transcribe({ audioBase64: toBase64(encodeWav(pcm)) });
          if (!result || result.ok !== true) throw new Error(result && result.error ? String(result.error.message ?? result.error) : '转写失败');
          const text = result.value.text.trim();
          if (text === '') {
            setMessage('没识别到语音');
          } else if (inputActions && inputActions.insertText) {
            inputActions.insertText(text, inputActions.captureInsertion());
            setMessage('');
          } else {
            setMessage('无法写入输入框');
          }
        } catch (error) {
          setMessage(error instanceof Error ? error.message : String(error));
        } finally {
          if (alive.current) setPhase('listening');
        }
      }

      function handleMessage(event) {
        let message;
        try {
          message = JSON.parse(event.data);
        } catch {
          return;
        }
        if (message.type === 'ready') {
          if (Array.isArray(message.wakeWords) && message.wakeWords.length > 0) {
            setWakeWord(String(message.wakeWords[0]));
          }
          setPhase('listening');
          return;
        }
        if (message.type === 'error') {
          setMessage(String(message.message));
          return;
        }
        if (message.type !== 'hit') return;
        send(socket.current, { type: 'debug', data: { event: 'hit', kind: message.kind, keyword: message.keyword } });

        if (message.kind === 'wake') {
          ding(880, 0.12);
          mode.current = 'dictate';
          resetTake();
          recording.current = true;
          send(socket.current, { type: 'mode', value: 'dictate' });
          setMessage('在听，说「说完了」结束');
          setPhase('recording');
          return;
        }
        if (message.kind === 'cancel') {
          ding(440, 0.12);
          resetTake();
          send(socket.current, { type: 'mode', value: 'wake' });
          mode.current = 'wake';
          setMessage('已取消');
          setPhase('listening');
          return;
        }
        if (message.kind === 'stop') {
          ding(660, 0.1);
          setMessage('转写中…');
          finishTake(message);
        }
      }

      async function start() {
        setMessage('');
        setPhase('starting');
        try {
          const AudioCtx = window.AudioContext || window.webkitAudioContext;
          if (AudioCtx) {
            cue.current = new AudioCtx();
            if (cue.current.state === 'suspended') await cue.current.resume().catch(() => {});
          }

          mic.current = new MicCapture(onFrame);
          await mic.current.start();

          const url = endpointUrl('wakeword');
          url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
          const ws = new WebSocket(url.href);
          socket.current = ws;
          ws.onopen = () => send(ws, { type: 'hello' });
          ws.onmessage = handleMessage;
          ws.onerror = () => setMessage(`连接语音服务失败（${url.href}）`);
          ws.onclose = () => {
            if (!alive.current) return;
            setPhase('idle');
            teardown();
          };
        } catch (error) {
          teardown();
          setPhase('idle');
          setMessage(error instanceof Error ? error.message : String(error));
        }
      }

      function toggle() {
        if (phase === 'idle') start();
        else {
          teardown();
          setPhase('idle');
        }
      }

      const active = phase !== 'idle';
      const label = phase === 'recording' ? '正在听写' : phase === 'transcribing' ? '转写中' : wakeWord;

      return h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 6 } },
        h(
          'button',
          {
            type: 'button',
            onClick: toggle,
            title: active ? '关闭语音唤醒' : '开启语音唤醒',
            'aria-label': label,
            'aria-pressed': active,
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 8px',
              border: `1px solid ${active ? '#2da44e' : 'rgba(140,149,159,0.45)'}`,
              borderRadius: 8,
              background: 'transparent',
              color: 'inherit',
              cursor: 'pointer',
              fontSize: 12,
            },
          },
          h('span', {
            'aria-hidden': true,
            style: {
              width: 8,
              height: 8,
              borderRadius: 999,
              background: phase === 'recording' ? '#d29922' : active ? '#2da44e' : '#8c959f',
            },
          }),
          label,
        ),
        message ? h('span', { style: { fontSize: 12, opacity: 0.7 } }, message) : null,
      );
    }

    return {
      inject: ['slots', 'remote'],
      apply(ctx) {
        // `remote.speech` is a child Service, not a plain property of the
        // remote facade: resolve it by name like the shell does with
        // ctx.get('conversation'). Fall back to the property for other builds.
        getSpeech = () => {
          try {
            const byName = ctx.get?.('remote.speech');
            if (byName) return byName;
          } catch {
            // fall through
          }
          try {
            return ctx.remote?.speech;
          } catch {
            return undefined;
          }
        };
        // conversation.input.left is a list slot, so this never displaces the
        // shipped single-occupant controls (input.activity hosts exactly one,
        // and the voice-input plugin owns it). Failure here must never fail the
        // whole web boot: report and keep the rest of the app alive.
        try {
          const pending = ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
            name: 'conversation.input.left',
            id: 'dsh-wakeword',
            order: 100,
          }, WakewordButton));
          if (pending && typeof pending.catch === 'function') {
            pending.catch((error) => console.error('dsh-wakeword: slot injection failed', error));
          }
        } catch (error) {
          console.error('dsh-wakeword: could not register the composer control', error);
        }
      },
    };
  },
});
