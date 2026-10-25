# LinkBreeze Unraid Templates

Unraid Community Applications templates for
[LinkBreeze](https://github.com/OmniRise/LinkBreeze), the self-hosted Linktree
alternative.

## Contents

- `linkbreeze.xml`: Docker template (dockerMan `Container version="2"` format),
  pulls the official `docker.io/omnirise/linkbreeze` image with a pinned semver
  tag, exposes port 3000, and stores data under `/mnt/user/appdata/linkbreeze`
- `ca_profile.xml`: repository profile shown in Community Applications

## Install

Apps → search for **LinkBreeze** → Install. The setup wizard runs on first
open at the assigned port; create your admin account and start adding links.
Updates install from the Apps tab like any other container.

## Support

- Issues: https://github.com/OmniRise/LinkBreeze/issues
- Discord: https://discord.gg/bAJMW3bAJa
- Docs: https://linkbreeze.omnirise.dev/docs
