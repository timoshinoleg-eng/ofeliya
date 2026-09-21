# Verified Fixed-Seed Duel MVP

This experiment reuses the existing Standard Bloodstream -> Heart campaign. It does not add a new campaign, power progression, rewards, matchmaking, or a duel leaderboard.

## Core hypothesis

A player who clears Standard can challenge a friend to replay the exact same campaign randomness with one goal: finish faster.

## Immutable challenge snapshot

The server issues an opaque challenge id. The public snapshot contains only:

- rulesetVersion
- campaignVersion
- runSeed
- difficultyId = standard
- controlMode
- targetTimeMs
- createdAt / expiresAt

The snapshot expires after approximately seven days.

## Creation

A duel can be created only from a fresh, non-resumed, verified messenger Standard full-campaign clear. Server-side initData verification, score-contract validation, and the existing campaign anti-cheat thresholds are applied before creation.

## Attempt

The recipient is locked to the snapshot's Standard difficulty, controlMode and runSeed. A valid attempt never enters the canonical global score path.

Comparison rule:

- full campaign clear faster than targetTimeMs -> beaten
- tie -> not beaten
- slower clear -> not beaten
- death / incomplete campaign -> not beaten

Unlimited rematches reuse the same immutable snapshot.

## Telemetry

The server records:

- create
- open
- start
- attempt
- beaten
- rematch

These events are experiment telemetry, not rankings or rewards.

## Explicit non-goals

Not part of this MVP:

- weekly/daily duel systems
- challenge leaderboard
- matchmaking
- rewards
- mastery grind
- meta power
- additional organ/stage
- expanded Legendary catalogue
- server-authoritative simulation/anti-cheat beyond the existing verified score contract
