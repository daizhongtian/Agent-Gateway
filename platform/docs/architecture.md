# Platform architecture

## Current boundary

```mermaid
flowchart LR
    Browser[React control console] -->|Cookie + CSRF| API[Spring Boot control API]
    API --> DB[(PostgreSQL)]
    Desktop[Coding Agent Gateway V3] -->|Account session + auto enrollment| API
    API -->|Local preview only| Gateway[Loopback Gateway on port 4310]
    URL[Stable OPENAI HOST URL] -->|localhost /h route| API
    URL -. deployed phase .-> Relay[Public outbound Relay]
    Desktop -. future outbound WSS .-> Relay
```

The localhost V3 preview marks a Host online only while its local proxy is enabled. In production, allocation alone must never be interpreted as proof that a device is online; Relay presence owns that state.

## Credential separation

| Credential | Consumer | Stored by platform | Purpose |
| --- | --- | --- | --- |
| Browser access token | React console | SHA-256 hash only | Short control-plane session |
| Browser refresh token | React console | SHA-256 hash only | Rotating session renewal |
| Pairing code | Account owner + desktop | SHA-256 hash only | One-time device enrollment |
| Device secret | Desktop app | SHA-256 hash only | Long-lived device identity |
| Tunnel token | Desktop tunnel agent | SHA-256 hash only | Short-lived Relay admission |
| `ccc_live_...` | Third-party OpenAI client | Never persisted in cloud | Local Gateway authorization |
| Codex/OpenAI credential | Local Codex runtime | Never received by platform | Model execution |

## Deployment domains

Recommended production split:

```text
console.example.com         React UI
account.example.com         Spring Boot control API
relay.example.com           Desktop WSS connections
*.api.example.com           Public OpenAI-compatible Host addresses
```

Keeping the control-plane cookie host separate from public Host subdomains prevents public API traffic from receiving account cookies.
