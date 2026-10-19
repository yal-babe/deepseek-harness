# Agent Note: Studio recorded usage source identities

Status: implemented

English | [中文](2026-10-19-studio-recorded-usage-sources.zh.md)

## Problem

Chat, Personal Center, and synchronized histories can observe the same provider request through different windows or fork copies. Content equality cannot distinguish a copied request from an independent identical request. A declared immediate parent also cannot identify an unavailable ancestor when a fork ends before that parent's seed marker.

## Decision

Token-meter owns normalized recorded settlements, extending the [projected usage decision](2026-07-29-projected-token-usage-and-request-context.md). An attempt's first settlement position is its stable identity within the original Session; later settlements replace its sample, while a retry starts another attempt. Recorded failure usage contributes consumption without estimating missing calls or changing Agent execution and context measurement.

Global accounting deduplicates original Session IDs and event positions. Known parent logs or persisted source ranges establish those identities. Missing ancestors and contradictory copies produce explicit partial totals; message content, timestamps, and seed markers do not establish identity. Provider-reported totals remain independent of optional cache details and provider balances.

Per-Session display includes its complete inherited history, matching chat. Global totals, models, and calendar buckets count original requests once; copied tool activity does not contribute again. Summing displayed Session rows is therefore not a valid reconstruction of the global total.

Studio conversation manifests use `dsh-session-2` to retain source ranges without altering official Session files. Updated clients accept legacy manifests, but older Studio clients reject new manifests. The [upgrade guide](../../../../docs/upgrade-guide/v0.2.1-rc.2/studio-usage-sources/guide.md) owns device migration instructions. Event positions from a different Session format generation are unavailable unless a compatible export supplies them.

## Alternatives considered

**Hash completed turns or compare messages and timestamps.** Independent identical requests would collapse, while sanitization or partial observations could prevent copied requests from matching. Content comparison can detect contradictory observations of an established identity, but cannot establish that identity.

**Attribute every inherited event to the declared immediate parent.** A missing parent's log may itself contain inherited requests. Even the absence of a seed marker is inconclusive when the copied prefix ends before that marker.

**Deduplicate every displayed Session total.** A child row would then disagree with its chat consumption. Global aggregation and per-Session disclosure answer different questions and retain separate totals.

## Consequences

Unavailable ancestry can reduce known global consumption rather than inventing an identity or a zero. Recorded usage is not a provider invoice. Visible summaries refresh from the Host; hidden summaries do not initiate history scans, and explicit reopening refreshes them. This adds no background provider polling or model context.

The existing projected-usage note remains active: it owns request accounting and context-occupancy semantics, not cross-Session identity. No prior decision is superseded. Loader composition and JSONL cold-read tests pin retry, calendar, fork, chat-display, and disposal behavior with an owner-local expected output.
