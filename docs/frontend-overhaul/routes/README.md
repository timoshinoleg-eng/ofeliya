# Route availability audit — 2026-10-15 (Europe/Moscow)

No external model route completed the minimal probe. Continue implementation with currently available Codex agents. Do not describe Kimi/OpenCode as participating in design or review.

| Route | Actual result |
| --- | --- |
| OmniRoute localhost:20128 | HTTP connection unavailable; no listener observed |
| Agent Gateway localhost:20129 | HTTP connection unavailable; no listener observed |
| OpenCode CLI | Installed executable reports 1.18.34 |
| opencode/space-bunny-free | Initial parallel probe hit shared database lock; isolated retry returned provider rejection: free tier restricted to OpenCode |
| opencode/big-pickle | No text output within 55 seconds; only the probe child was stopped |
| opencode/mimo-v2.5-free | Unexpected server error |
| Configured Kimi kimi-k3:free, direct fallback | HTTP 429; request capped at 20 output tokens |

Each model received only a request to return `ROUTE_OK`. Tool access was denied for CLI probes. No product code, account settings, running user services, route definitions, or credentials were changed. Gateway source and model configuration were inspected read-only. Configuration labels were not accepted as operational evidence.

Machine-readable sanitized results are stored beside this report. `isolated-data` and `isolated-cache` are local probe runtime artifacts, excluded from publication. The diagnostic script contains no credentials. No paid model or unknown paid fallback was invoked.
