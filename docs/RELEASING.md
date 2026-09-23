# Publishing a release

1. Set the same `version` in `manifests/brave.json` and `manifests/firefox.json`. The build refuses to run while they disagree.
2. Move the entries under `## [Unreleased]` in [CHANGELOG.md](../CHANGELOG.md) into a new `## [x.y.z] - YYYY-MM-DD` section, add its link at the foot of the file, and leave `## [Unreleased]` empty.
3. Run `python scripts/build.py`. One command writes all five release assets into `dist/`: the versioned Brave, Chrome and Firefox ZIPs and the stable `giga-pinax-brave.zip` and `giga-pinax-firefox.zip` aliases. Every one of them is built in a staging directory first and moved into `dist/` only once they all exist, so a failure part-way through leaves the previous `dist/` untouched rather than a mixed-version one. The same step clears any `giga-pinax-*.zip` of another version out of `dist/`, so `dist/giga-pinax-*.zip` is exactly this release's five assets and nothing older.
4. Push the commit, then push the tag `vx.y.z`. The `release` workflow runs three jobs. `build` refuses a tag whose version disagrees with `manifests/brave.json`, runs both test suites and the build, and hands the five ZIPs on as an artifact with a `SHA256SUMS` file, recording the same checksums as its own job output. `lint` unpacks the versioned Firefox ZIP from that artifact and runs the Firefox lint, which fetches `web-ext` from npm; it can only read the repository. `release`, the one job that can write, runs no repository code and no npm: it downloads the artifact, checks it against the build job's checksums with `sha256sum --check`, creates the release as a **draft** if it does not exist, and uploads the five ZIPs with `gh release upload --clobber`. It never publishes, and it refuses to upload into a release that has already been published. The workflows name each action by its major tag (`actions/checkout@v5`); `.github/dependabot.yml` proposes every newer release as a pull request, so an action changes only when someone merges that change.
5. The workflow produces a draft and nothing else. Open it, check that all five assets are present and downloadable, paste the install section below beside the changelog entries, and publish it as the latest release. If the release changes the stored data's schema version, repeat that section's upgrade notes in the release body: a collector who may roll back has to export a backup before installing.

Nothing is published automatically. The public downloads require no GitHub account, and end users do not need Python.

Every release body must include brief browser installation and update instructions beside the download information. Copy and update this section as needed:

## Install or update

Under **Assets**, download the ZIP for your browser, not a **Source code** archive.

- **Brave or Chrome:** Unzip the package into a permanent folder. Open `brave://extensions` or `chrome://extensions`, enable **Developer mode**, select **Load unpacked**, and choose the folder containing `manifest.json`.
- **Firefox 142+:** Open `about:debugging`, select **This Firefox**, select **Load Temporary Add-on**, and choose the Firefox ZIP. This unsigned temporary add-on is removed when Firefox restarts.
- **Updating Brave or Chrome:** Overwrite the files in the same folder, then select **Reload** on the extensions page.
- **Updating Firefox:** Load the new Firefox ZIP again.

Release assets must include three versioned browser packages (for example, `giga-pinax-brave-x.y.z.zip`, `giga-pinax-chrome-x.y.z.zip`, and `giga-pinax-firefox-x.y.z.zip`) plus `giga-pinax-brave.zip` and `giga-pinax-firefox.zip`. The build writes the versioned Chrome ZIP as a byte-identical copy of the versioned Brave ZIP. The stable aliases keep the in-extension update links working; see [INSTALL.md](INSTALL.md) for the build details.

For store releases, also verify the listing, privacy answers, reviewer notes and assets under [store](store/README.md) against the exact package. Keep the stable Firefox ID `giga-pinax@local.invalid`; Mozilla recommends a stable unique ID and does not require that the ID be a deliverable mailbox. Do not describe an unsigned GitHub ZIP as permanently installable in Firefox, and do not claim signing or publication until the relevant dashboard confirms it.

The code is MIT licensed (`LICENSE`); the bundled catalogue data keeps its own terms (ODbL 1.0 and CC BY 3.0, see `docs/LOCAL-CATALOGUE.md`). Use MIT for a store's licence field. Do not accept a legal attestation on behalf of the publisher.

The store screenshots must show the released UI at 1280×800 with private auction data and photo URLs removed. Chrome also requires the packaged 128×128 icon and 440×280 small promotional tile. The reproducible source and rendering instructions for the tile are in [store/assets](store/assets/README.md).
