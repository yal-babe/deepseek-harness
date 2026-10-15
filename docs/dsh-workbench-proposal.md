# DSH Studio implementation proposal

English | [中文](dsh-workbench-proposal.zh.md)

## 1. Product and technical foundation

DSH Studio is a desktop agent application customized from DeepSeek Harness source, supporting conversations, project development, tool execution, model integration, Agent Teams, and cloud memory.

- Application name: DSH Studio.
- Repository name: `dsh-studio`.
- Command line: `dsh`.
- Platforms: Intel macOS, Apple Silicon macOS, and Windows.
- Desktop framework: retain DSH's Electron desktop and Web UI.
- Execution runtime: retain DSH's agent loop, file tools, terminal tools, approval, cancellation, and session mechanisms.
- Extension approach: implement custom features through DSH plugins and internal interfaces.
- Source management: pin the upstream commit and retain tracking records for customizations and upstream updates.

## 2. Modules

| Module | Scope |
| --- | --- |
| Desktop application | Projects, conversations, tool execution, approvals, task progress, files, and changes |
| Authentication | Codex and Antigravity browser login, credential storage, renewal, and sign-out |
| Model integration | Model catalogs, selection, streaming requests, tool calls, and error handling |
| Agent Teams | Official Lead, teammates, member messages, task board, and task dependencies |
| Cloud memory | Session records, shared memory, task context, and retrieval |
| Sync and recovery | Local cache, event sync, device directory bindings, team and session recovery |
| Administration | Data retrieval, device management, storage settings, backup and recovery, and runtime logs |

The desktop executes local development tasks; the cloud handles data persistence, sync, and recovery.

## 3. Authentication and model integration

### 3.1 Codex and Antigravity

Add the corresponding authentication and model adapters within DSH.

Authentication flow: select sign-in → open the system browser → authorize → receive the callback → save credentials → fetch the model list → select a model.

Authentication features include:

- Sign-in, cancellation, sign-out, and reauthorization.
- Login status, credential validity, and failure reasons.
- Automatic credential refresh with concurrent refresh requests coalesced.
- Authentication state and model selection restored after restart.
- Independent settings per source, restored when switching sources.
- Sensitive credentials stored in macOS Keychain / Windows Credential Manager.

Model adapter features include:

- Fetch and cache available models.
- Send model requests with the corresponding authorization.
- Convert upstream responses into DSH model events.
- Support text streaming, tool calls, tool results, multiple turns, and cancellation.
- Report explicit authorization, quota, network, and protocol errors.

Use CLIProxyAPI as a reference for browser authorization and protocol adaptation, implementing them through DSH's authentication and model interfaces.

### 3.2 Custom APIs

Retain DSH's Chat Completions, Responses, and Anthropic Messages integrations.

Provide Base URL, API Key, protocol, model-list discovery, manual model entry, and connection testing. Save the model list and current selection, and refresh the catalog in the background.

## 4. Agent Teams

Use the official DSH Agent Teams.

- The Lead creates and manages teammates.
- Members collaborate through the official messaging mechanism.
- Use the official task board for assignment, claiming, dependencies, and completion.
- Derive team and task state from official durable events.
- Associate deliverable documents, change descriptions, and validation results with their tasks and sessions.
- The Lead reviews results and completes tasks or requests additions through member messages.
- Show member state, task progress, messages, and related deliverables on the desktop.

One local runtime executes each team in a shared working directory. The Lead coordinates potentially overlapping file edits, and the desktop displays official file-scope warnings.

## 5. Cloud memory

### 5.1 Data

| Data | Stored content |
| --- | --- |
| Session records | User messages, model output, tool calls and results, and execution state |
| Project memory | Goals, constraints, decisions, verified facts, and related code revisions |
| Work context | Progress, attempts, blockers, pending tasks, and validation evidence |
| Team records | Durable events for official members, tasks, dependencies, and related messages |
| Deliverables | Result descriptions, document references, attachments, and check records |

Memory records include source, time, associated project, task, session, and code revision. Support revisions, deprecation, and history browsing.

### 5.2 Use and retrieval

- Use structured indexes and full-text search.
- Retrieve relevant memory by current project, task, and session.
- Add relevant content to model context.
- Trace memory records back to original sessions and validation evidence.
- Redact sensitive credentials in sessions, tool results, and logs.

## 6. Sync and cross-device recovery

### 6.1 Sync

Implement sync through DSH's persistence interfaces and session lifecycle extensions.

- Store session logs and sync queues locally.
- Use stable event IDs, sequence numbers, and idempotent commits.
- Queue while offline and retry when connectivity returns.
- Display pending, syncing, synced, and failed states.
- Give cloud projects stable IDs, with independent local directory bindings per device.
- Store accessible deliverable references and code revisions, or upload attachments.

### 6.2 Recovery flow

1. Stop team execution on the current device.
2. Sync sessions, team events, and memory to the cloud.
3. Open the project on another device and bind its local directory.
4. Verify the Git revision and development environment.
5. Restore session and team state and load relevant work context.
6. Continue unfinished tasks.

Use sync versions and device takeover to ensure one executing instance per team. Retain completed tool-call results during recovery; the new runtime handles pending operations. Prompt users to check associated memory when the code revision changes. Preserve original data and report the specific reason if recovery fails.

## 7. Server and Web administration

Use TypeScript, Node.js, SQLite WAL, and full-text indexes on a Docker-deployed server. Write session events in batches with stable sequence numbers and transactions. Support server directories and S3-compatible object storage for attachments.

Provide a Web administration console when the server starts. Support first-run generation and environment configuration of the admin key, and revocation of desktop device credentials.

Administration features:

- Query projects, sessions, and team records.
- View official task state and deliverables.
- Search, edit, and trace shared memory history.
- Manage devices, sync state, and takeover state.
- Diagnose sync failures, model-call failures, and runtime logs.
- Manage storage usage, retention policies, and S3 settings.
- Back up and restore data and check integrity.

## 8. Desktop interaction

Retain DSH's project and conversation interface, with consistent model authentication, tool execution, approval, and task-state presentation. Agent Teams provides member, task, and message views, with member-session switching to inspect progress.

### Dialogs

- Esc closes the topmost dialog, menu, or overlay.
- Confirm discarding unsaved edits.
- Closing a progress window leaves the task running.
- Use an explicit cancel action to cancel a task.

### Shortcuts

| Shortcut | Action |
| --- | --- |
| Cmd/Ctrl+K | Search and command palette |
| Cmd/Ctrl+S | Save the current edits |
| Cmd/Ctrl+Enter | Submit or confirm |
| Tab / Shift+Tab | Move focus |
| Arrow keys / Enter | Lists, menus, and selection |
| Esc | Close the topmost interface |

Support inspecting and adjusting shortcuts, respecting terminal, input-method, and editor input priorities.

## 9. Implementation stages

1. Pin the DSH source baseline and validate platform builds, plugin interfaces, tool execution, and persistence.
2. Complete internal Codex and Antigravity authentication and model adapters and improve custom API settings.
3. Integrate official Agent Teams and complete team views and deliverable associations.
4. Implement cloud memory, event sync, device bindings, and recovery.
5. Complete administration, Esc behavior, shortcuts, logs, installation, and updates.

## 10. Acceptance criteria

- macOS and Windows installations run, and the `dsh` command is available.
- Codex and Antigravity support sign-in, sign-out, refresh, and restart recovery.
- Every model source supports streaming, file tools, command execution, multiple tool rounds, and cancellation.
- Official Agent Teams completes assignment, messaging, and task execution with a Lead and two teammates.
- Cloud memory supports retrieval, revision, and tracing original evidence.
- Sessions and teams recovered between macOS and Windows can continue unfinished work.
- Offline retries preserve event and deliverable consistency.
- All application dialogs support Esc, and shortcuts support the corresponding keyboard operations.
- Administration supports browsing records, diagnosing failures, managing storage, and backup and recovery.

## 11. Technical references

- [DSH source](https://github.com/deepseek-ai/deepseek-harness)
- [DSH desktop architecture](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/desktop/README.md)
- [DSH model configuration](https://deepseek-harness.github.io/deepseek-harness/en/guide/providers)
- [DSH Agent Teams](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/experimental/agent-team/README.md)
- [DSH persistence interfaces](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/persistence.md)
- [OpenAI Sign in with ChatGPT](https://developers.openai.com/siwc/token-sharing-open-source)
- [CLIProxyAPI authentication and protocol reference](https://github.com/router-for-me/CLIProxyAPI)
