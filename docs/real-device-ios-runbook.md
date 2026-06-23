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
- **The device must be UNLOCKED** for any DeveloperDiskImage (DDI) service —
  app listing, install/launch, capture. A locked device fails with
  `kAMDMobileImageMounterDeviceLocked: The device is locked` (verified on an
  iPhone 12 Pro Max). Set **Settings → Display & Brightness → Auto-Lock → Never**
  for the session so it doesn't re-lock mid-flow.
- **iOS 17+ tunnel:** `xcrun devicectl` (Xcode 15+/16) **mounts the RSD tunnel
  automatically** — verified live (`launch` printed "Acquired tunnel connection
  to device"). So **no manual `go-ios tunnel` / `pymobiledevice3 tunneld` is
  needed** for the devicectl lifecycle path; a manual tunnel only matters for
  some non-devicectl idb/WDA setups.

## Steps
1. **Enumerate** — `device_list` should show the iPhone tagged
   `platform: "ios-real"`, `state: "paired"` (verified).
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
6. **Capture** — screenshot / video, see the Capture section below.

## Capture (screenshot & video) on a real device

> podium's `screenshot` and `record_start`/`record_stop` are **platform-aware** in
> v0.3.0: iOS-sim via `simctl`, Android via `adb`, real iOS via **`idb`**
> (`idb screenshot` / `idb record-video`). Real-iOS capture still needs
> **`idb_companion`** installed and connected — without it the tools **fail closed**
> with install guidance (verified: `idb` alone errors). Install it below. Verified
> gotchas: `xcrun devicectl` has **no** screenshot/record subcommand, and `ffmpeg`'s
> AVFoundation list exposes the iPhone only as a **Continuity Camera** (its camera,
> not its screen) — so neither captures the device screen.

### Screenshot — install ONE of:
- **idb_companion** (recommended): `brew install facebook/fb/idb-companion`, then
  `idb screenshot out.png`.
- **libimobiledevice**: `brew install libimobiledevice`, then `idevicescreenshot out.png`.

### Video recording — choose ONE:
- **QuickTime Player** (most reliable, GUI): File → **New Movie Recording** → click the
  arrow next to the Record button → select the **iPhone** → it shows the device *screen*
  → Record → save `.mov`.
- **On-device Screen Recording**: Control Center on the iPhone → Record → share the file
  off the device (AirDrop / Files).
- **idb** (CLI, after `idb_companion` is installed): `idb record-video out.mp4`
  (Ctrl-C to stop). Note idb's real-device support is flaky/semi-deprecated.

> ⚠️ Do **not** `ffmpeg -f avfoundation -i "<iPhone> Camera"` to capture gameplay — that
> records the phone's **camera feed**, not the app screen.

## Pass criteria
- ≥1 full flow (enumerate → install → launch → inspect → tap) succeeds on a
  physical iPhone, **or** every step fails closed with an actionable message when
  a prerequisite (signing / pairing / tunnel) is absent — never an opaque
  `xcrun` error.

## Notes
- The `devicectl`/WDA wire shapes in `iosreal.ts` / `wda.ts` are unit-tested
  against mocks; this runbook is where their **live** behavior is confirmed.
- **Live-verified** (iPhone 12 Pro Max, Xcode 16.4): `device_list`/enumerate
  (`parseDevicectlDevices` matches real `devicectl` JSON) and **`app_launch`**
  (devicectl, RSD tunnel auto-mounted). Inspect / tap / capture remain to be
  confirmed once a backend (idb_companion or WDA) is installed.
