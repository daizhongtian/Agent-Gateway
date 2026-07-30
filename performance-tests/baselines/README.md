# Performance baselines

`local.json`、`local.md` 和 `local.html` 由 `npm run performance:baseline:update` 一起生成。基线带环境指纹，只与相同操作系统、架构、Node 主版本和逻辑 CPU 数的结果比较。

不要把真实凭据、Provider 响应正文或用户数据放进此目录。标准报告生成器只保存汇总指标。
