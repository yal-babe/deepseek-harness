# Agent Note: Dafeiyu media and device-local play

Status: implemented

English | [中文](2026-10-17-dafeiyu-motion.zh.md)

## Problem

Six embedded frames per state cannot express the source character's full interactions. Importing all 3,444 frames into the client entry would increase download and decoded-image costs. Expanding panels also need to preserve the user's chosen character position.

## Decision

The Host offers allowlisted built-in media through `pet.pack()` and owns the disposable `/pet-motion` route. Sixteen transparent VP9 clips preserve the imported source frames; four generated sprite sheets supply eight poses per interaction. Video and sprite media load when selected. The frame renderer remains the fallback and development-pack renderer.

The client owns idle timing, click cooldowns, effects, and device-local movement preferences. Host task state interrupts decorative play; drag and landing preserve the latest task state. Character coordinates are independent of panels. Desktop owns native window movement and validates the renderer's boolean wandering request; hovering, hiding, dragging and disposal cancel movement.

The [Phase 0 findings](../../proposed/feature/2026-10-17-studio-pet-phase0-findings.md) remain relevant to approval competition and authenticated connections. This decision extends media and interaction without replacing those ownership choices.

## Alternatives considered

Embedding every frame increases the initial entry and decoded-image footprint. A new native helper duplicates the existing Electron window lifecycle. External media URLs introduce network dependencies for built-in interactions. Shipped, on-demand media reuses Chromium decoding and the application's authenticated HTTP transport.

## Consequences

Built-in media adds shipped assets and requires byte-range HTTP responses. Four generated actions have eight key poses each and do not interpolate motion to the source clips' frame rate. Development packs retain their existing frame format. Device-local play does not alter prompts, agent roles, model configuration, cloud sync, or approval decisions.

## Verification

The real Loader composition test exercises media, ranges, invalid paths and route disposal. Client tests cover idle rest timing, task interruption, drag/landing, reduced motion, sprite completion and timer cleanup; Desktop tests cover bounded wandering and cancellation. Chromium smoke execution verifies transparent decoding, Web dragging, the new action menu and theme rendering. Native Electron behavior on Windows and macOS still requires platform verification.
