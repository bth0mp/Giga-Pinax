# Publishing a release

1. Set the same `version` in `manifests/brave.json` and `manifests/firefox.json`. The build refuses to run while they disagree.
2. Move the entries under `## [Unreleased]` in [CHANGELOG.md](../CHANGELOG.md) into a new `## [x.y.z] - YYYY-MM-DD` section, add its link at the foot of the file, and leave `## [Unreleased]` empty.
3. Run `python scripts/build.py`. One command writes all five release assets into `dist/`: the versioned Brave, Chrome and Firefox ZIPs and the stable `giga-pinax-brave.zip` and `giga-pinax-firefox.zip` aliases. Every one of them is built in a staging directory first and moved into `dist/` only once they all exist, so a failure part-way through leaves the previous `dist/` untouched rather than a mixed-version one. The same step clears any `giga-pinax-*.zip` of another version out of `dist/`, so `dist/giga-pinax-*.zip` is exactly this release's five assets and nothing older. Then work through [MANUAL-TEST.md](MANUAL-TEST.md) on the built package, with a step added for every change of this release that only a browser can show.
4. Push the commit, then push the tag `vx.y.z`. The `release` workflow runs four jobs. `build` refuses a tag whose version disagrees with `manifests/brave.json`, runs both test suites and the build, and hands the five ZIPs on as an artifact with a `SHA256SUMS` file, recording the same checksums as its own job output. `lint` unpacks the versioned Firefox ZIP from that artifact and runs the Firefox lint, which fetches `web-ext` from npm; it can only read the repository. `sign` signs that Firefox ZIP with Mozilla when the repository holds the AMO secrets, and does nothing without them (see [Signing the Firefox package](#signing-the-firefox-package)); it can only read the repository too. `release`, the one job that can write, runs no repository code and no npm: it downloads the artifact, checks it against the build job's checksums with `sha256sum --check`, creates the release as a **draft** if it does not exist, and uploads the five ZIPs with `gh release upload --clobber` — and, when `sign` produced them, the signed `giga-pinax-firefox-x.y.z.xpi` and its `firefox-updates.json`, checked against the sign job's own checksums the same way. A signing that fails does not hold back the ZIPs: the draft is filled without the XPI and the run carries a warning. It never publishes, and it refuses to upload into a release that has already been published. The workflows pin each action to a full commit SHA, with its release in a comment (`actions/checkout@fbc6f39… # v5.1.0`); `.github/dependabot.yml` proposes every newer release as a pull request, so an action changes only when someone merges that change.
5. The workflow produces a draft and nothing else. Open it, check that all five assets are present and downloadable, paste the install section below beside the changelog entries, and publish it as the latest release. If the release changes the stored data's schema version, repeat that section's upgrade notes in the release body: a collector who may roll back has to export a backup before installing.

Nothing is published automatically. The public downloads require no GitHub account, and end users do not need Python.

Every release body must include brief browser installation and update instructions beside the download information. Copy and update this section as needed:

## Install or update

Under **Assets**, download the ZIP for your browser, not a **Source code** archive.

- **Brave or Chrome:** Unzip the package into a permanent folder. Open `brave://extensions` or `chrome://extensions`, enable **Developer mode**, select **Load unpacked**, and choose the folder containing `manifest.json`.
- **Firefox 142+, signed:** Open the `giga-pinax-firefox-x.y.z.xpi` asset in Firefox and confirm the installation. It stays installed across restarts, and Firefox keeps it up to date by itself. *(Keep this line only when the release carries the XPI.)*
- **Firefox 142+, temporary:** Open `about:debugging`, select **This Firefox**, select **Load Temporary Add-on**, and choose the Firefox ZIP. This unsigned temporary add-on is removed when Firefox restarts.
- **Updating Brave or Chrome:** Overwrite the files in the same folder, then select **Reload** on the extensions page.
- **Updating Firefox:** A signed install updates itself. A temporary one is updated by loading the new Firefox ZIP again.

Release assets must include three versioned browser packages (for example, `giga-pinax-brave-x.y.z.zip`, `giga-pinax-chrome-x.y.z.zip`, and `giga-pinax-firefox-x.y.z.zip`) plus `giga-pinax-brave.zip` and `giga-pinax-firefox.zip`. The build writes the versioned Chrome ZIP as a byte-identical copy of the versioned Brave ZIP. The stable aliases keep the in-extension update links working; see [INSTALL.md](INSTALL.md) for the build details.

For store releases, also verify the listing, privacy answers, reviewer notes and assets under [store](store/README.md) against the exact package. Keep the stable Firefox ID `giga-pinax@local.invalid`; Mozilla recommends a stable unique ID and does not require that the ID be a deliverable mailbox. Do not describe an unsigned GitHub ZIP as permanently installable in Firefox, and do not claim signing or publication until the relevant dashboard confirms it.

## Signing the Firefox package

A signed build installs permanently in Firefox and updates itself. Mozilla signs it on the **unlisted** channel of addons.mozilla.org (AMO): the add-on is not listed on AMO, which only signs it, and it is distributed from the GitHub release. Nothing is signed until the owner does the following once:

1. Sign in to the [AMO developer hub](https://addons.mozilla.org/developers/), open **Tools → Manage API Keys**, and generate credentials. Add the **JWT issuer** as the repository secret `AMO_JWT_ISSUER` and the **JWT secret** as `AMO_JWT_SECRET` (**Settings → Secrets and variables → Actions**). Until both exist, the release workflow's `sign` job says so in a notice and the release carries the five ZIPs alone.
2. Publish the site (see [Publishing the site](#publishing-the-site)): the Firefox manifest names `https://bth0mp.github.io/Giga-Pinax/firefox/updates.json` as its update URL, and a signed install reads its updates from there.

The first signing registers the id `giga-pinax@local.invalid` with the owner's AMO account. **That id must never change afterwards**: Firefox would treat a build under another id as a different add-on, and installed copies would never update to it.

For each tag, `sign` unpacks the linted Firefox ZIP, runs `web-ext sign --channel unlisted` with the two secrets (they reach that one step only), names the result `giga-pinax-firefox-x.y.z.xpi`, and writes `firefox-updates.json` with `python scripts/build_site.py update-manifest`: Mozilla's update manifest, offering that version from the release asset's download URL with its SHA-256. The release job checks both files against the sign job's checksums and attaches them to the draft. Once the release is published, the Pages workflow publishes the latest release's `firefox-updates.json` as `firefox/updates.json`, and installed signed copies update from it. Before any release carries one, the site publishes an update manifest that offers nothing.

Mozilla signs a version once, and refuses to sign it again:

- If signing failed before Mozilla accepted the version (missing secrets, an AMO outage, a rejected upload), run **Sign Firefox package** (`sign-firefox.yml`) from the **Actions** tab with the tag. It builds the Firefox ZIP from the tag again, checks that it is byte for byte the ZIP the release carries, signs it, and attaches the XPI and its update manifest. It works on a draft or a published release, and only ever adds: an XPI or update manifest already on the release is never replaced.
- If Mozilla accepted the version but the job did not finish (for example the approval wait ran out), download the signed file from the developer hub, and in a checkout of the tag run `python scripts/build_site.py update-manifest --xpi giga-pinax-firefox-x.y.z.xpi --output firefox-updates.json` (the file must carry that name); then attach both with `gh release upload vx.y.z giga-pinax-firefox-x.y.z.xpi firefox-updates.json`.

A signed XPI added to a release that is already published reaches installed copies only when the site is published again: run the **Pages** workflow from the **Actions** tab.

The Firefox lint runs with `--self-hosted` because the manifest names its own update URL, which the linter refuses only for an add-on AMO would host. A *listed* AMO submission would have to drop `browser_specific_settings.gecko.update_url` from the package it sends — a separate decision, since AMO would then deliver updates itself. The unsigned ZIP carries the same update URL; loaded temporarily through `about:debugging` it is never updated from it, and Settings keeps its **Updates** card for it.

The code is MIT licensed (`LICENSE`); the bundled catalogue data keeps its own terms (ODbL 1.0 and CC BY 3.0, see `docs/LOCAL-CATALOGUE.md`). Use MIT for a store's licence field. Do not accept a legal attestation on behalf of the publisher.

The store screenshots must show the released UI at 1280×800 with private auction data and photo URLs removed. Chrome also requires the packaged 128×128 icon and 440×280 small promotional tile. The reproducible source and rendering instructions for the tile are in [store/assets](store/assets/README.md).
