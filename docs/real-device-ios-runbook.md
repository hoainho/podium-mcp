# Real iOS device — manual QA runbook (roadmap story B3)

Driving a **real iPhone** can't run on a stock CI runner (it needs your signing
identity + a physically paired device), so v0.3.0 ships the iOS-real driver
(`src/lib/iosreal.ts`, `devicectl`-based) and the opt-in WDA backend
(`src/lib/wda.ts`) with this manual verification runbook.

## Hard prerequisites
- **macOS + Xcode 15+** (`xcrun devicectl` ships with Xcode 15).
- An **iPhone paired and trusted** with the Mac (`xcrun devicectl list devices`
  shows it as `connected`).
- A valid **Apple signing identity / provisioning profile** to install
  WebDriverAgent (a free Apple ID works for personal devices; bundle id must be
  unique).
- **iOS 17+**: a **RemoteServiceDiscovery (RSD) tunnel** must be running
  (`go-ios tunnel start` or `pymobiledevice3 remote tunneld`, typically under
  `sudo`). Without it, lifecycle calls fail closed with a tunnel-required error.

## Steps
1. **Enumerate** — `device_list` should show the iPhone tagged
   `platform: "ios-real"`, `state: "connected"`.
   - Direct check: `xcrun devicectl list devices` lists it.
2. **Install + launch** — `app_install <udid> <signed.ipa/.app>` then
   `app_launch <udid> <bundleId>` (both route through `devicectl`).
3. **Start WebDriverAgent** on the device (build/run the WDA `WebDriverAgentRunner`
   target from Appium's WDA, or `go-ios runwda`), note its base URL
   (e.g. `http://localhost:8100/session/<id>`), and export
   `PODIUM_WDA_URL=<that URL>`.
4. **Inspect** — `inspect_screen <udid>` returns the WDA `/source` accessibility
   tree as elements with tap coordinates.
5. **Interact** — `tap_on` / `swipe` / `input_text` drive the device via WDA.
6. **Capture** — screenshot via WDA / `idevicescreenshot`.

## Pass criteria
- ≥1 full flow (enumerate → install → launch → inspect → tap) succeeds on a
  physical iPhone, **or** every step fails closed with an actionable message when
  a prerequisite (signing / pairing / tunnel) is absent — never an opaque
  `xcrun` error.

## Notes
- The `devicectl`/WDA wire shapes in `iosreal.ts` / `wda.ts` are unit-tested
  against mocks; this runbook is where their **live** behavior is confirmed.
- Until B3 passes on hardware, real-iOS support is "code-complete, live-unverified".
