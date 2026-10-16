# DSH Studio Plugin Marketplace Requirements

English | [中文](plugin-marketplace-requirements.zh.md)

Add a unified plugin marketplace within Settings to help users discover, install, and manage plugins.

## Plugin Sources

- DSH official plugins.
- [DSH Community Plugin Hub](https://dsh-plugin.org/zh/plugins/dshplugin/dsh-plugin-hub), labeled as community source.
- [Codex Official Plugin Marketplace](https://github.com/openai/plugins), labeled with compatibility status in DSH Studio.

## Basic Capabilities

- Browse and search plugins, with filtering by source.
- View plugin title, icon, summary, author, version, and instructions.
- Install, update, and uninstall plugins, and view installation status.
- Present notices for incompatibility, installation failures, and restart requirements.

## Integration Requirements

- Reuse the existing plugin page and management facilities without building a separate plugin management system.
- Aggregate DSH official and community plugins first, followed by Codex plugins.
- Adapt Codex plugins progressively across Skills, MCP, Hooks, and other capabilities, explicitly labeling full, partial, or unsupported compatibility.
- Preserve user credentials and unrelated configuration during updates and uninstallation.

## Acceptance Criteria

Users can discover plugins from different sources in a single entry point, complete installation, updates, and uninstallation of supported plugins, and clearly understand plugin origin and compatibility status.

The implementation entry point is under **Settings → Plugin Marketplace** ([`ui-settings-plugin-marketplace`](../packages/client/ui-settings-plugin-marketplace/README.md)), with Host catalog backed by [`plugin-catalog`](../packages/boot/plugin-catalog/README.md). The sidebar "Plugins" page remains dedicated to toggle, configuration, and manual installation, without being replaced by the marketplace.
