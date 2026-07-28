# Privacy Notice

Last updated: 2026-07-17

Agent Gateway is a community-maintained third-party project, not an OpenAI product. This notice describes the behavior of the software in this repository. An organization that redistributes or hosts a modified build may process data differently and must provide its own accurate notice.

## Summary

- The Windows desktop application is local-first and uses a loopback HTTP service.
- Prompts, selected project content, attachments, images, task events, and results are processed by Codex and may be sent to OpenAI/Codex services under the account or API credentials configured on the machine.
- A `ccc_live_...` Gateway key authenticates requests to this application only. It is not an OpenAI API key and cannot be used directly with the OpenAI API.
- The project does not include product analytics, advertising trackers, or third-party crash-reporting telemetry.
- A remote server operator can access data that passes through that server. This project does not provide end-to-end encryption from an API caller to OpenAI that hides content from the operator.

## Data processed

Depending on the feature used, the application processes:

- task prompts and model/runtime choices;
- project names, local paths, and files that Codex is allowed to read or modify;
- uploaded images, PDFs, Office/OpenDocument files, source files, archives, and extracted text;
- task status, structured SDK events, human-readable logs, final results, errors, thread identifiers, and token-usage metadata;
- Gateway key metadata, a SHA-256 verification hash, an encrypted recoverable copy when secure storage is available, and the key's bound model/effort/speed/permission preset;
- aggregate usage counts by task, model, and Gateway credential;
- application preferences stored by the renderer;
- environment-readiness information such as bundled runtime status, optional CLI/App presence, version information, and whether Codex authentication appears available.

The application does not need to display or expose the user's underlying Codex credential or OpenAI API key. Environment checks must not return credential contents or authentication-file contents to the renderer or HTTP clients.

## Where data goes

### Local desktop mode

The Electron application starts a loopback-only server. Prompts and file data move between the local UI, the local server, the bundled Codex runtime, and the configured Codex/OpenAI service. Other local programs can call the external API only with a valid Gateway key while the Host is enabled.

### Standalone or remote mode

Requests first reach the operator's server and any reverse proxy, load balancer, security appliance, or logging platform in front of it. The operator can technically read prompts, attachments, project paths, task events, and results, and can control retention and access. Users should not send sensitive data to an operator they do not trust.

### Third-party services

- Task execution and an optional real SDK connection test can communicate with OpenAI/Codex. OpenAI's terms and privacy policies apply independently to that processing and to the account used.
- Update checks can contact GitHub Releases and disclose ordinary network metadata such as IP address, user agent, requested repository/release URL, and request time to GitHub and the network operator.
- The local environment scan itself should not make a model request. Installing dependencies or downloading releases uses npm/GitHub and is outside the running application's task flow.

## Local storage and retention

Typical Windows desktop locations are:

| Data | Typical location | Retention |
| --- | --- | --- |
| Gateway key store | `%APPDATA%\codex-control-center\gateway-api-keys.json` (legacy compatibility path retained after the Agent Gateway rename) | Until the key is deleted or local data is removed |
| Usage aggregates | `%APPDATA%\codex-control-center\usage-stats.json` | Across restarts until **Reset** or local data removal |
| Electron preferences/storage | Electron `userData` under `%APPDATA%\codex-control-center\` | Until application data is removed |
| Pending/claimed attachments | `%TEMP%\codex-control-center-attachments\session-*` | Unused uploads expire (30 minutes by default); claimed files are removed when the task ends, is cancelled/fails, or the process closes |
| Projectless workspaces | `%TEMP%\codex-control-center\projectless\task-*` | Removed when the task ends or the process closes; locked leftovers may remain until OS cleanup |
| Task snapshots, prompts, events, results | Process memory | Until pruned by the task history limit or the process exits |

Exact locations can differ if Electron, Windows, container mounts, or environment variables are configured differently. Standalone defaults use `~/.codex-control-center/` for key and usage files; the Docker example uses `/data`. Project files remain wherever the user or operator placed them and are not deleted when application data is cleared.

The application writes operational output to the process console. It does not implement a separate persistent log-upload or crash-reporting service. Shell redirection, service managers, reverse proxies, containers, endpoint security tools, or modified builds may retain console and HTTP logs independently.

## Gateway keys and encryption

Gateway keys are application credentials, not OpenAI credentials. The desktop build stores a verification hash and uses Electron/Windows secure storage to encrypt the recoverable secret. A standalone service can use `API_KEY_ENCRYPTION_KEY`. Encryption reduces exposure from a copied data file but does not protect against a compromised Windows account, malicious administrator, running-process inspection, or an operator who can invoke the authorized reveal endpoint.

Encrypted Gateway secrets can be bound to the Windows user/device context. Copying the application data directory to another computer may make them undecryptable. Backups containing the key store are sensitive.

## Deleting local data

To remove data through the application:

1. Delete each Gateway key; this permanently removes its key-store record and encrypted secret, cancels its active tasks, and removes its per-key usage aggregate.
2. Use **Reset** on the usage dashboard to start a new aggregate period.
3. Cancel active tasks and close the application to clear in-memory task history and managed temporary files.

To remove all application-owned local data on Windows:

1. Exit Agent Gateway completely.
2. Uninstall it if the installed edition is present.
3. Delete `%APPDATA%\codex-control-center\`.
4. Remove any leftover `%TEMP%\codex-control-center-attachments\` and `%TEMP%\codex-control-center\projectless\` directories after verifying those resolved paths are the intended application temp directories.

This does not delete project files, Codex CLI/App credentials, OpenAI account data, server-side provider data, GitHub/npm records, backups, reverse-proxy logs, or data retained by a remote operator. Use the corresponding service/account controls for those systems.

## Telemetry and update checks

The repository's application code does not integrate product analytics, ad tracking, fingerprinting, or third-party crash telemetry. This statement does not cover network/security software installed by the user, operating-system diagnostics, npm/GitHub, OpenAI/Codex, reverse proxies, container platforms, or modified builds.

An update check retrieves public release metadata from GitHub. It should not include prompts, files, project paths, Gateway keys, Codex/OpenAI credentials, task output, or usage totals. Users who do not want that request can avoid the update action or block the request at their network boundary; manual downloads remain possible.

## Remote deployment responsibilities

Anyone hosting the service for others must publish their own privacy notice, identify the operator, state retention periods and legal basis, provide access/deletion channels, secure backups, minimize logs, separate tenants, and comply with applicable law and contracts. The built-in Bearer-token mode is not a complete public multi-user identity or privacy system.

## Changes

Material changes to this notice should be recorded in [CHANGELOG.md](CHANGELOG.md). The notice included with the exact release being used governs the documented behavior of that build.
