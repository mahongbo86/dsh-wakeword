# spikes

验证性脚本，不属于插件运行时。

## kws-smoke.js

用 `sherpa-onnx` 的 `KeywordSpotter` 跑一段 wav，打印命中的关键词和每个 token 的时间戳。

```powershell
$env:SHERPA_PATH = "D:/src/_dsh-ref/sherpa-onnx-node"   # sherpa-onnx-node 包目录
node spikes/kws-smoke.js <model-dir> <wav> [keywords.txt]
```

模型：`sherpa-onnx-kws-zipformer-wenetspeech-3.3M-2024-01-01`（epoch-12-avg-2，可用 `KWS_EPOCH` 切换）。

实测结果（2026-11-02）：

| 输入 | 结果 |
| --- | --- |
| 模型自带 `test_wavs/3.wav` | 命中「文森特卡索」「法国」 |
| TTS 合成的「嘿小助手」 | 命中，token 时间戳 0.16–0.92 s |

结论：自定义中文唤醒词可用；`KeywordResult` 带 `start_time` 和 `timestamps`，收笔词可以按时间戳精确裁掉。
