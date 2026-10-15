# Agent Note: Session-local Team activation

Status: implemented

English | [中文](2026-10-15-session-team-activation.zh.md)

## Problem

The desktop Team bundle assigns every new conversation the Lead identity before any teammate exists. Users need ordinary conversations and an explicit way to begin collaboration without changing official Team behavior.

## Decision

The profile selects normal mode for new root conversations. `/team` enables the existing Team capability once while idle. The service records required `team/mode` events and the Team projection owns the activation state. Membership and scoped tool installation use that state. Existing logs without the event retain implicit Teams; reopening an ordinary log does not activate it.

## Alternatives considered

A profile-wide toggle changes unrelated conversations. Removing only the header or identity leaves Team tools and authority available. An ignorable record lets older readers reconstruct an ordinary conversation as a Team, so activation is a required event whose unknown-event refusal preserves the log.

## Consequences

Official identities, prompts, tools, and delegation remain unchanged after activation. New normal sessions require a reader that recognizes the activation record. The single-way transition avoids interrupting active teammates or deleting shared tasks to leave a Team. Headless users can explicitly select the service's Team default in their profile patch.
