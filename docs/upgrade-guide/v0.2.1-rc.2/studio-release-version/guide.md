---
kind: upgrade-guide
description: DSH Studio Desktop now uses an independent product version and configurable update source instead of inheriting the upstream release identity.
---

# Studio release versions

English | [中文](guide.zh.md)

## Change

Studio Desktop starts its own release line at `0.1.0`, declared in `apps/desktop/studio-release.json`. Bundled Harness packages retain their upstream versions. Studio Cloud is independently versioned by `services/studio-cloud/package.json`, currently `0.1.0`.

Studio installers without `DSH_STUDIO_UPDATE_URL` have no packaged update source. An installed client can save a device-local source in General Settings. Mandatory upstream policy is omitted unless explicitly configured.

## Migration

1. Existing installations displaying `0.2.1-rc.2` cannot automatically upgrade to the lower Studio version `0.1.0`. Install the first Studio release manually. If the installer refuses the version transition, uninstall the application while retaining user data, then install Studio. Keep `$DSH_HOME`, projects, and cloud-service volumes.
2. Maintain the Studio version in `apps/desktop/studio-release.json`; maintain server versions independently in `services/studio-cloud/package.json` and its lockfile. Do not rewrite upstream package versions to match Studio.
3. Configure `DSH_STUDIO_UPDATE_URL` during packaging, or save the platform's generic update directory in General Settings and restart Desktop. Use `latest` for stable feeds and `nightly` for prereleases.
4. Follow [Studio online updates](../../../user/studio-online-updates.md) to enable the optional Docker executor. Preserve the existing Compose project name so database and application volumes remain attached.
5. The client settings show the installed Studio version and bundled runtime separately; the server reports its installed version at `/v1/version` and in the admin overview.
