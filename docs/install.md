# 安装与验证（Desktop）

这套步骤会改 Desktop profile 并需要重启应用，所以由你手动执行一次。执行前建议先把
`%USERPROFILE%\.dsh\profiles\desktop\package.json` 备份一份。

## 前置

- DSH Desktop 已启用「语音输入」Bundle（`speechToText` 可用、模型已准备）
- 已安装的 KWS 模型位于
  `%USERPROFILE%\.dsh\models\kws\sherpa-onnx-kws-zipformer-wenetspeech-3.3M-2024-01-01`

## 1. 把包装进 profile

```powershell
$dsh = "D:\Apps\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd"
& $dsh plugin --profile desktop add "file:D:/src/dsh-wakeword"
```

这一步走 pnpm，会顺带装 `sherpa-onnx-node`（约 22 MB 平台二进制），首次需要联网。

## 2. 选中这个 bundle

编辑 `%USERPROFILE%\.dsh\profiles\desktop\package.json`，把 `dsh-wakeword` 追加到
`dsh.profile.bundles` 数组末尾：

```json
"bundles": [
  "@deepseek-ai/dsh-base",
  "@deepseek-ai/dsh-web-app",
  "@deepseek-ai/dsh-experimental-voice-input-bundle",
  "@deepseek-ai/dsh-experimental-agent-team-profile",
  "dsh-wakeword"
]
```

## 3. 重启应用

从托盘退出 DSH，再重新打开。新 bundle 需要重启才会装进组合。

## 4. 验证

1. 输入框旁出现「唤醒词」按钮，圆点是灰色。
2. 点击按钮 → 圆点变绿，系统麦克风指示亮起。
3. 说「嘿小助手」→ 听到「叮」→ 圆点变黄，进入听写。
4. 随便说一句话 → 说「说完了」→ 听到「嘟」→ 文字出现在输入框草稿。
5. 再说一次，改说「不用了」→ 本次录音被丢弃，回到监听。

## 排错

- **按钮不出现**：插件管理页看 `wakeword` 行的状态与失败原因（模型路径、端口占用）。
- **提示「语音输入插件未启用」**：先在插件管理页启用语音输入 Bundle。
- **连接失败**：`/wakeword` 是组合级路由，重名会直接抛错；换 `config.path` 即可。
- **一直不命中唤醒词**：先确认模型目录正确，再把 `threshold` 从 0.25 调到 0.1 试试。
