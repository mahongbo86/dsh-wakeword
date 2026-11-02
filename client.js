window.__ModuleLoader__.load({
  id: 'dsh-wakeword',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const SAMPLE_RATE = 16000;
    const FRAME_SAMPLES = 1600; // 100 ms

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
    let getRemote = () => undefined;

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
      const total = React.useRef(0);
      const alive = React.useRef(true);

      React.useEffect(() => () => {
        alive.current = false;
        teardown();
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
      }

      function send(ws, message) {
        if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
      }

      function ding(frequency, duration) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const context = new AudioCtx();
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.frequency.value = frequency;
        gain.gain.value = 0.08;
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start();
        oscillator.stop(context.currentTime + duration);
        oscillator.onended = () => context.close().catch(() => {});
      }

      function resetTake() {
        recording.current = false;
        chunks.current = [];
        total.current = 0;
      }

      function onFrame(frame) {
        const ws = socket.current;
        if (ws && ws.readyState === WebSocket.OPEN) ws.send(frame.buffer);
        if (recording.current) {
          chunks.current.push(frame);
          total.current += frame.length;
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

        const start = Array.isArray(hit.timestamps) && hit.timestamps.length > 0 ? hit.timestamps[0] : undefined;
        const all = samples();
        // timestamps are seconds from the start of the dictation stream; keep a
        // 100 ms margin so the stop word itself never reaches the transcript.
        const cut = start === undefined ? all.length : Math.max(0, Math.round(start * SAMPLE_RATE) - FRAME_SAMPLES);
        const pcm = all.subarray(0, Math.min(cut, all.length));

        send(socket.current, { type: 'mode', value: 'wake' });
        mode.current = 'wake';
        resetTake();

        if (pcm.length < SAMPLE_RATE * 0.2) {
          setMessage('没听清，再说一次');
          setPhase('listening');
          return;
        }

        try {
          const remote = getRemote();
          if (!remote || !remote.speech) throw new Error('语音输入插件未启用');
          const result = await remote.speech.transcribe({ audioBase64: toBase64(encodeWav(pcm)) });
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

        if (message.kind === 'wake') {
          ding(880, 0.12);
          mode.current = 'dictate';
          resetTake();
          recording.current = true;
          send(socket.current, { type: 'mode', value: 'dictate' });
          setPhase('recording');
          return;
        }
        if (message.kind === 'cancel') {
          ding(440, 0.12);
          resetTake();
          send(socket.current, { type: 'mode', value: 'wake' });
          mode.current = 'wake';
          setPhase('listening');
          return;
        }
        if (message.kind === 'stop') {
          ding(660, 0.1);
          finishTake(message);
        }
      }

      async function start() {
        setMessage('');
        setPhase('starting');
        try {
          mic.current = new MicCapture(onFrame);
          await mic.current.start();

          const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
          const ws = new WebSocket(`${scheme}://${location.host}/wakeword`);
          socket.current = ws;
          ws.onopen = () => send(ws, { type: 'hello' });
          ws.onmessage = handleMessage;
          ws.onerror = () => setMessage('连接语音服务失败');
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
              border: '1px solid var(--dsw-alias-border-l2, #d0d7de)',
              borderRadius: 8,
              background: active ? 'var(--dsw-alias-bg-accent, #eef5ff)' : 'transparent',
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
      inject: ['slots'],
      apply(ctx) {
        getRemote = () => {
          try {
            return ctx.remote;
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
