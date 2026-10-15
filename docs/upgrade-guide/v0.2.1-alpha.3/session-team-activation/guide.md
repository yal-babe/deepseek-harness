---
kind: upgrade-guide
description: "New sessions in the Team profile start in normal mode and record session-local activation."
---

# Session-local Team activation

English | [中文](guide.zh.md)

## Change

The Agent Teams profile starts new root conversations in normal mode. The human executes `/team` to permanently enable the existing official Team capability for that conversation. Existing conversations without an activation record retain their Team behavior. Team roles, tools, and collaboration are unchanged after activation.

New conversations record required `team/mode` events. Older builds that do not understand this event refuse these logs instead of silently enabling Teams. Existing logs remain readable by the updated build.

## Migration

1. Upgrade the application before opening conversations created with session-local Team modes; retain their logs when an older application refuses them.
2. In an interactive conversation, execute `/team` while idle when Team collaboration is needed. Reopening the conversation retains activation; a new conversation starts normally.
3. For a headless composition that requires Teams immediately, set `defaultMode: team` on the `agent-team` entry in the profile patch. This affects new sessions only.
4. Confirm a normal conversation has no Team header action, and `/team` makes the official action and tools available.
