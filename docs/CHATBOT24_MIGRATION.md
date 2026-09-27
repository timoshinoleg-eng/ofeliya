# Chatbot24 → OFELIYA migration matrix

The old Chatbot24/Hub runtime is a donor, not an upstream dependency. Useful generic patterns are
ported into OFELIYA; Hub-specific multi-game behavior is intentionally not copied.

| Chatbot24/Hub capability | OFELIYA status | Decision |
|---|---|---|
| Fail-closed production webhook config | Ported | Keep dedicated `/ofeliya/bot/webhook` contract |
| MAX `openApp` launch button | Ported | Keep one focused OFELIYA action |
| BackButton lifecycle hygiene | Ported | Keep platform adapter ownership |
| Haptics with partial-bridge guards | Ported | Keep |
| Late MAX bridge tolerance | Ported | Keep lazy platform resolution |
| Native MAX share | Ported | Keep |
| Browser share fallback from Hub bridge | Ported in isolation pass | Keep for desktop/partial bridges |
| MAX `ready()` handling | Ported in isolation pass | Keep |
| Native vertical-swipe suppression | Ported in isolation pass | Keep for drag/twin-stick controls |
| Legal/operator surface | OFELIYA has its own LegalOverlay | Do not duplicate Hub UI |
| Product analytics | OFELIYA has signed analytics endpoint/client | Keep OFELIYA implementation |
| Referrals / share / duel / daily | OFELIYA has stronger app-specific implementations | Do not import Hub implementations |
| Multi-game catalog and `/games` | Not applicable | Hub-specific; do not copy |
| Sister-project cross-promo | Not applicable to core release | Avoid coupling products |
| Admin `/cast` broadcast | Not migrated | Expands bot privilege/abuse surface without launch need |
| Admin `/stats` command | Not migrated | Server telemetry already exists; add only with an explicit admin requirement |
| Hub subscriber store / launch notifications | Not migrated | OFELIYA should use its own retention/notification design, not legacy subscriber state |
| `/forget` automatic account deletion | Not blindly copied | Requires OFELIYA-specific competitive/profile deletion semantics and a dedicated reviewed endpoint |

## Retirement gate for the legacy bot/VM

Before powering off the legacy Chatbot24 VM:

1. canonical OFELIYA bot opens `https://ofeliya.freeveol.dpdns.org/ofeliya/`;
2. dedicated OFELIYA webhook is healthy;
3. MAX initData validates with the OFELIYA token;
4. share/deep links contain `@id402806822924_5_bot`, never the legacy bot;
5. no production OFELIYA file references `quiz.chatbot24.su`, `/opt/hub` or `HUB_BOT_*`;
6. current OFELIYA release passes CI and the Cloud.ru production smoke;
7. useful donor patterns listed above are either ported or explicitly marked not applicable.

Only then retire `@id402806822924_1_bot` and the legacy VM.
