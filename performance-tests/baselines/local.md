# Agent Gateway performance report

- Result: **PASSED**
- Suite: `baseline`
- Started: 2026-07-30T15:28:57.096Z
- Environment: win32/x64, 24 logical CPUs, v24.15.0

## Load results

| Profile | Target | Stage | Requests | RPS | Error rate | p50 | p95 | p99 | TTFT p95 | Added p95 | Added TTFT p95 | Token gap p50 | SSE order errors |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline | gateway-cancellation | cancel-and-release | 1 | 281.318 | 0 | 3.555 | 3.555 | 3.555 | n/a | n/a | n/a | n/a | 0 |
| baseline | fake-provider | warmup | 44 | 21.312 | 0 | 93.488 | 97.298 | 97.816 | 43.165 | n/a | n/a | 10.685 | 0 |
| baseline | fake-provider | measure | 216 | 43.119 | 0 | 92.672 | 95.39 | 96.834 | 41.502 | n/a | n/a | 10.735 | 0 |
| baseline | gateway-health | warmup | 10834 | 5418.779 | 0 | 0.306 | 0.624 | 1.206 | n/a | n/a | n/a | n/a | 0 |
| baseline | gateway-health | measure | 43544 | 8708.506 | 0 | 0.392 | 0.627 | 1.115 | n/a | n/a | n/a | n/a | 0 |
| baseline | gateway-models | warmup | 12273 | 6087.856 | 0 | 0.277 | 0.426 | 0.723 | n/a | n/a | n/a | n/a | 0 |
| baseline | gateway-models | measure | 32355 | 6470.535 | 0 | 0.533 | 0.924 | 1.504 | n/a | n/a | n/a | n/a | 0 |
| baseline | full-chain-stream | warmup | 43 | 20.561 | 0 | 95.623 | 99.671 | 102.131 | 45.081 | 6.957 | 4.344 | 10.766 | 0 |
| baseline | full-chain-stream | measure | 210 | 41.271 | 0.005 | 95.716 | 102.119 | 106.902 | 45.474 | 6.661 | 4.277 | 10.747 | 0 |
| baseline | platform-control | warmup | 2370 | 1184.824 | 0 | 1.068 | 4.46 | 13.774 | n/a | n/a | n/a | n/a | 0 |
| baseline | platform-control | measure | 13175 | 2625.033 | 0 | 1.05 | 4.119 | 7.901 | n/a | n/a | n/a | n/a | 0 |
| baseline | frontend-http | warmup | 651 | 324.351 | 0 | 5.033 | 11.295 | 20.377 | n/a | n/a | n/a | n/a | 0 |
| baseline | frontend-http | measure | 2636 | 527.021 | 0 | 6.941 | 12.374 | 14.817 | n/a | n/a | n/a | n/a | 0 |

## Thresholds

| Status | Rule | Run | Actual | Requirement |
|---|---|---|---:|---:|
| passed | cancel-release | baseline/gateway-cancellation/cancel-and-release | 3.555 | < 2000 |
| passed | normal-error-rate | baseline/fake-provider/measure | 0 | < 0.01 |
| passed | stream-token-cadence | baseline/fake-provider/measure | 10.735 | > 1 |
| passed | stream-order | baseline/fake-provider/measure | 0 | = 0 |
| passed | normal-error-rate | baseline/gateway-health/measure | 0 | < 0.01 |
| passed | control-api-p95 | baseline/gateway-health/measure | 0.627 | < 300 |
| passed | control-api-p99 | baseline/gateway-health/measure | 1.115 | < 800 |
| passed | normal-error-rate | baseline/gateway-models/measure | 0 | < 0.01 |
| passed | control-api-p95 | baseline/gateway-models/measure | 0.924 | < 300 |
| passed | control-api-p99 | baseline/gateway-models/measure | 1.504 | < 800 |
| passed | normal-error-rate | baseline/full-chain-stream/measure | 0.005 | < 0.01 |
| passed | gateway-relay-added-p95 | baseline/full-chain-stream/measure | 6.661 | < 250 |
| passed | gateway-relay-added-ttft-p95 | baseline/full-chain-stream/measure | 4.277 | < 100 |
| passed | stream-token-cadence | baseline/full-chain-stream/measure | 10.747 | > 1 |
| passed | stream-order | baseline/full-chain-stream/measure | 0 | = 0 |
| passed | normal-error-rate | baseline/platform-control/measure | 0 | < 0.01 |
| passed | control-api-p95 | baseline/platform-control/measure | 4.119 | < 300 |
| passed | control-api-p99 | baseline/platform-control/measure | 7.901 | < 800 |
| passed | normal-error-rate | baseline/frontend-http/measure | 0 | < 0.01 |
| not-evaluated | database-pool-usage | environment/optional-observability/availability | n/a | < 0.8 |
| not-evaluated | production-relay-sockets | environment/optional-observability/availability | n/a | = 0 |

## Baseline regression

| Status | Run | Metric | Baseline | Current | Relative change | Absolute change |
|---|---|---|---:|---:|---:|---:|
| not-evaluated | — | — | — | — | No baseline file was supplied. | — |

## Latency attribution

| Run | Primary component | Provider p95 | Gateway/Relay added p95 | Provider share |
|---|---|---:|---:|---:|
| baseline/full-chain-stream/measure | fake-provider | 96.592 | 6.661 | 0.936 |

## Browser probe

- Wall load: 141.527 ms
- DOM content loaded: 137.4 ms
- Registration dialog interaction: 223.543 ms
- Page errors: 0

## Scope notes

- Fake Provider latency and end-to-end latency are measured independently; added latency excludes provider time.
- Platform control-plane and frontend targets run only when the platform URL is reachable.
- Production Relay WebSocket/multiplexing metrics are not claimed because the repository currently contains only the localhost Relay preview and a protocol draft.
- Real-provider smoke is an explicit release-only command and is not part of repeatable load profiles.
- CPU and memory values in this report cover the Node harness plus its in-process Local Gateway; container metrics require deployment observability endpoints.
