# CasaOS App Store Submission

Source of truth for the LinkBreeze listing in the official CasaOS/ZimaOS App
Store (`IceWhaleTech/CasaOS-AppStore`).

## What ships

- `Apps/LinkBreeze/docker-compose.yml` — app definition with `x-casaos`
  metadata, pinned to `docker.io/omnirise/linkbreeze:<semver>`, data at
  `/DATA/AppData/$AppID/data`, Web UI on port 3000
- `Apps/LinkBreeze/icon.png` — 256×256 app icon
- `Apps/LinkBreeze/screenshot-1.png` — 1280×720 screenshot (Aurora public page)

## Submission process

1. Fork `IceWhaleTech/CasaOS-AppStore` to `OmniRise` and rename the fork
   `LinkBreeze-CasaOS-AppStore` (rename keeps the fork relationship)
2. Copy this `Apps/LinkBreeze/` directory into the fork, one branch per
   submission
3. Test before opening the PR: install the app from the fork's store URL
   (`https://github.com/OmniRise/LinkBreeze-CasaOS-AppStore/archive/refs/heads/<branch>.zip`)
   in a CasaOS instance, confirm install success and Web UI reachable — their
   PR process requires this evidence
4. Run their local validation (`scripts/build_appstore.py`) and pass CI
5. Open the PR with test evidence included

## Notes

- The `icon` and `screenshot_link` URLs reference the store's jsDelivr CDN at
  `@main`; they resolve once the PR merges, which is the convention every
  listing in the store uses
- CasaOS policy bans `:latest`, so every release bumps `image` tag, `version`,
  and `update_at` in the compose file (see `packaging/README.md`)
