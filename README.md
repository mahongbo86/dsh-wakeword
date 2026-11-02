# dsh-wakeword

> 给 DeepSeek Harness 的语音唤醒插件：喊一声就开始口述，说一句收笔词结束，文字落进输入框草稿。

**状态：早期开发中。** 目前只有 bundle 骨架，还不能安装使用。

## 为什么做这个

DSH 已经带语音输入，但要先手动点输入框旁的麦克风按钮。手上有活、离键盘远、或者只是顺口想说一句的时候，这一下点击就是全部的摩擦。

这个插件把「点一下」换成「喊一声」。

## 目标体验

```text
「嘿小助手」 → 叮 → 持续听写（唤醒词静音，只认收笔词）
说 → 「说完了」 → 嘟 → 裁掉收笔词 → 转写进草稿
（可选）再说「发送吧」或按回车，才真正发出
兜底：静默 20 s / 总长 2 min → 自动收笔，不发送
```

## 设计决定

- **收笔词，而不是 VAD 自动断句。** 口述中间的正常停顿（想词、换气）不该被当成「说完了」；喊一句收笔词只多三个字，但行为完全可预测。
- **收笔和发送分开。** 收笔词只负责停；发送另设一步。收笔词若兼发送，说错一次就直接发出去了。
- **全程本地。** 唤醒词识别、VAD、转写都在本机完成，音频不出机器。
- **可配置。** 唤醒词 / 收笔词 / 取消词 / 发送词都走 bundle 配置，开源后用户可以换成自己的词。

## 依赖

- DeepSeek Harness（桌面端为主，Web 端同样可用）
- 语音输入 Bundle：提供 `speechToText` 服务与本地 SenseVoice 转写
- `sherpa-onnx` 的 KWS 模型（中文建议 `sherpa-onnx-kws-zipformer-wenetspeech-3.3M`）

## 架构

```text
浏览器（client.js）                      Host（index.js）
─────────────────────                   ─────────────────────
getUserMedia → AudioContext 16k
  → 每 100 ms 一帧 Float32 ──WebSocket──▶  KeywordSession.push(frame)
                                         （sherpa-onnx KeywordSpotter）
  ◀──────────── wake / stop 事件 ─────────┘
  → 录音缓冲 + 收笔裁剪
  → 调 speechToText 转写 ───────────────▶ SenseVoice
  → 写入草稿（conversation.input）
```

音频走 Host 插件自己注册的 WebSocket 升级路由（`ctx.webServer.registerUpgrade`），只监听环回地址。转写复用现有语音输入 Bundle 的 `speechToText` 服务。

### 协议

控制帧是 JSON 文本，音频是二进制帧（小端 Float32，16 kHz 单声道，每帧约 100 ms）。

| 方向 | 消息 | 说明 |
| --- | --- | --- |
| 浏览器 → Host | `{"type":"hello"}` | 建连后握手，Host 回 `ready` |
| 浏览器 → Host | `{"type":"mode","value":"wake"\|"dictate"}` | 切换关键词集合 |
| 浏览器 → Host | `{"type":"flush"}` | 补尾巴静音，冲出发末尾的关键词 |
| 浏览器 → Host | 二进制 Float32 帧 | 音频 |
| Host → 浏览器 | `{"type":"ready","mode","wakeWords"}` | 就绪；`wakeWords` 供控件显示唤醒词 |
| Host → 浏览器 | `{"type":"hit","mode","kind","keyword","start","timestamps"}` | 命中关键词 |
| Host → 浏览器 | `{"type":"error","message"}` | 协议或推理错误 |

### 配置

```yaml
- id: wakeword
  config:
    modelDir: D:/models/sherpa-onnx-kws-zipformer-wenetspeech-3.3M-2024-01-01
    path: /wakeword
    threshold: 0.25
    numThreads: 1
    keywords:
      wake: [嘿小助手]
      stop: [说完了]
      cancel: [不用了]
```

`modelDir` 省略时用 `$DSH_HOME/models/kws/sherpa-onnx-kws-zipformer-wenetspeech-3.3M-2024-01-01`。关键词会按模型的 `tokens.txt` 转成拼音 token；模型拼不出来的字会直接报错并指出是哪个字。

## 路线

- [x] KWS 验证：模型能识别中文唤醒词，结果带每个 token 的时间戳
- [x] Host 半侧：KWS 会话、关键词生成、WebSocket 路由（15 个单测）
- [x] Client 半侧：麦克风采集、状态机、收笔裁剪、转写落草稿（尚未在应用内验证）
- [x] 接入 `speechToText`：复用语音 Bundle 已挂载的 `remote.speech`
- [ ] 安装进 Desktop profile 并端到端验证：[docs/install.md](docs/install.md)

## 安装

暂未提供。开发阶段会直接以本地目录安装到 Desktop profile。

## License

MIT
