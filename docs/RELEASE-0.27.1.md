# Giga Pinax 0.27.1

Version 0.27.1 keeps the research, Calculator, Watchlist, and local auction workspace from 0.27.0 and adds a direct route to future release packages.

## Updates

- **Updates** under the popup header shows the installed version.
- **Download latest update** opens the stable package for the current browser from the latest GitHub release. The Brave package also supports Chrome.
- **View releases** opens the latest release page for release notes or GitHub sign-in.
- The public repository needs no GitHub account. No credential or access token is stored in the extension.

## Installation limits

The extension does not check GitHub in the background, compare versions, or install an update silently. In Brave or Chrome, extract the downloaded ZIP over the folder already loaded and select **Reload** on the browser's extensions page. In Firefox, load the latest unsigned ZIP again; temporary installations are removed when Firefox restarts. GitHub's automatic **Source code** archives are not extension packages.

Release publishers must attach the stable `giga-pinax-brave.zip` and `giga-pinax-firefox.zip` aliases alongside the versioned packages so the update buttons continue to resolve.
