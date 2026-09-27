# OFELIYA production identity

This file is the canonical identity map for humans, agents, audits and deployment tooling.

## Canonical production

- Product: **OFELIYA: STRAIN ZERO**
- Repository: `timoshinoleg-eng/ofeliya`
- MAX bot: `@id402806822924_5_bot`
- Mini App URL: `https://ofeliya.freeveol.dpdns.org/ofeliya/`
- Cloud.ru VM: `chatgpt-ofeliya-1`
- Public IP: `176.108.241.28`
- Bot ownership: **dedicated**
- Webhook namespace: `/ofeliya/bot/webhook`
- Runtime env root: `/opt/ofeliya`

## Retired legacy target — never use for OFELIYA

- Legacy/Chatbot24 MAX bot: `@id402806822924_1_bot`
- Legacy host: `https://quiz.chatbot24.su/`
- Stale copied OFELIYA path: `https://quiz.chatbot24.su/ofeliya/`
- Legacy Cloud.ru VM: `quiz-battle-web-2`
- Legacy public IP: `176.108.243.20`

The legacy host may still answer HTTP while retirement is in progress. It is **not** an OFELIYA
production target, API authority, bot identity, fallback, QA origin or deployment destination.

## Hard isolation rules

OFELIYA runtime/deployment must not:

- inherit `HUB_BOT_USERNAME`, `HUB_BOT_TOKEN` or `/opt/hub/.env`;
- use the Chatbot24/Hub bot token to validate MAX initData;
- redirect QA traffic to `quiz.chatbot24.su/ofeliya/`;
- proxy score/social APIs through `quiz.chatbot24.su`;
- publish under `/hub/*`;
- use `@id402806822924_1_bot` in launch, share or referral links.

The legal operator/developer brand may still be ChatBot24 Studio when required by release metadata.
That legal/operator field does not make the legacy Chatbot24 bot, host or VM part of OFELIYA.

## Agent/audit rule

When a model or audit says “OFELIYA production”, it must resolve to the canonical URL and bot above.
If live evidence comes from `quiz.chatbot24.su`, classify it as **legacy Chatbot24 evidence**, not
OFELIYA production evidence.
