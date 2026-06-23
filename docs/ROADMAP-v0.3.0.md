# Podium-MCP — Kế hoạch v0.3.0 (consensus, pending approval)

> **Trạng thái:** Đã qua vòng consensus (Planner → Architect → Critic, chạy inline).
> Scope đã chốt với người dùng: **cả 3 epic trong v0.3.0** (Android + Game-engine + iOS-real).
> Thực thi: qua `/oh-my-claudecode:team` (song song theo task graph). Tài liệu này là **spec dùng chung** cho team.
> Nền tảng: kế thừa v0.2.0 (43 tools, oracle ladder, NativeBackend, mobilecli, Maestro).

> **Định vị:** *"podium v0.3.0 — chạy trên thiết bị thật (Android + iOS) và tự động hoá UI game-engine (Unity/WebGL/GL) như element địa chỉ được, không dùng vision."*

---

## ⚠️ Sự thật nền tảng (định hình toàn bộ plan)

Chỉ có 3 cách điều khiển app Unity/GL, và chỉ chọn được **tối đa 2** trong {không-vision, không-cần-instrument, chạy-trên-app-bất-kỳ}:

| Cách | Không vision? | Cần build hợp tác? | App closed bất kỳ? |
|---|:--:|:--:|:--:|
| **AltTester bridge** (nhúng SDK) | ✅ | ✅ cần build instrumented | ❌ |
| **Unity Accessibility** (dev tự implement) | ✅ | ✅ cần dev thêm a11y node | ❌ |
| **Vision/OCR/pixel tap** | ❌ (đã bị loại) | ❌ | ✅ |

→ **Tự động hoá Unity không-vision CHỈ khả thi trên build mình kiểm soát (instrumented hoặc a11y-enabled).** App game production đóng kín thì pixel là giao diện duy nhất — không có đường không-vision. Plan này nhắm **build của chính bạn / staging / instrumented** (giống WKWebView `isInspectable` ở v0.2.0) và **fail-closed bằng lỗi actionable**, tuyệt đối không âm thầm rơi về vision.

---

## Nguyên tắc (Principles)
- **P1 — Địa chỉ element không-vision.** Cây cấu trúc + toạ độ là đường tương tác duy nhất; screenshot không bao giờ là oracle. Fallback toạ độ/pixel **opt-in, mặc định TẮT**.
- **P2 — Một abstraction, nhiều backend.** Mở rộng `NativeBackend` (`src/lib/native.ts:82`) + oracle ladder (`src/lib/oracle.ts:85`) + gom device lifecycle vào `PlatformDriver`. Không fork.
- **P3 — Degrade minh bạch / fail closed.** Thiếu engine bridge hoặc prereq thiết bị thật → lỗi structured actionable (cách bật), không đoán vision, không lỗi `xcrun` mơ hồ.
- **P4 — Instrument là opt-in & trung thực.** Engine automation cần build AltTester-instrumented (dev/staging); document rõ ranh giới.
- **P5 — Ship theo lát cắt kiểm chứng được.** Mỗi đường platform/engine kèm 1 e2e smoke thật; không "done" chỉ bằng unit mock.

## Decision drivers
- **D1** Hai yêu cầu cứng của user: (a) Unity/WebGL/GL click/hover/swipe trên element có tên, không vision; (b) iOS thật + Android (emu+real).
- **D2** Token economy lúc runtime — cây cấu trúc (AltTester JSON / a11y XML / DOM) rẻ hơn vision 10–100×; vừa là yêu cầu vừa là differentiator của podium.
- **D3** Tái dùng > xây lại — backend ladder, oracle ladder, mobilecli (hỗ trợ Android), Maestro (Android+real) đã có; coupling iOS-sim gom ở `simctl.ts` (16 refs).

## Phương án đã chọn
- **Engine:** **G-A** AltTester-primary (JSON/TCP :13000, forward qua `adb forward`/`iproxy`; `findObjects` theo name/path/component → toạ độ màn hình; tap/click/swipe/drag/keys/`callComponentMethod`/`waitForObject`) + **Unity-Accessibility detection** (miễn phí qua rung native a11y khi có) + **WebGL-in-WebView qua CDP** (gộp vào ladder). Loại G-B vision (chỉ giữ làm last-resort opt-in).
- **Real device:** **R-A** backend-per-platform, **staged**: Android (adb/mobilecli/Maestro) → iOS-real (go-ios + WDA/XCUITest + `devicectl` + iOS-17 RSD tunnel + DDI). Loại R-B cloud farm (để sau).

---

## Thay đổi kiến trúc (đã verify seam)
1. **Device model:** `DeviceTarget { udid, platform: "ios-sim"|"ios-real"|"android", transport }`; interface `PlatformDriver` cho lifecycle (boot/install/launch/screenshot/record/screen_size/orientation). `simctl.ts` hiện tại → driver `ios-sim`; thêm driver `android` (adb) + `ios-real` (go-ios/devicectl/WDA). `device_list` liệt kê cả 3.
   - ⚠️ **Cảnh báo Architect:** đây là **refactor device-model**, không phải mở rộng cosmetic — `udid: string` xuyên ~13 file; 182 test hiện tại CHỈ bảo vệ đường iOS-sim. **M0 phải thêm parity test per-platform trước khi thêm platform.**
2. **Gesture/inspect backend:** `NativeBackend.name += "adb" | "wda"`; selection **per-target** (thay cho `cachedBackend` global hiện tại).
3. **Oracle ladder:** `Surface += "engine"`, `VisibleVia += "engine"`. `detectSurface` precedence **engine → webview → native**; rung engine authoritative chỉ khi bridge connected; **fail-closed** khi engine surface kỳ vọng nhưng không reachable.
4. **Engine bridge** (`src/lib/engine.ts`): AltTester client + helper port-forward; tools `engine_inspect / engine_tap / engine_swipe / engine_drag / engine_call / engine_set_text` (+ `engine_hover` chỉ nơi engine expose pointer-enter — KHÔNG hứa hover giống-hệt-DOM trên cảm ứng). Gate trên instrumented + reachable, else lỗi "enable AltTester".

---

## Task graph (waves + dependency)

| Wave | Tasks | Phụ thuộc |
|---|---|---|
| **M0** | Refactor device-abstraction (`DeviceTarget`/`PlatformDriver`); iOS-sim không đổi hành vi; **+ parity test per-platform** | — |
| **W1** (∥) | **A1** Android driver (adb: list/install/launch/screenshot/screen_size) · **A2** Android backend (`adb` tap/swipe/text/key + `uiautomator dump`→JSON) · **C1** engine bridge client (`lib/engine.ts`) | M0 (A); none (C1) |
| **W2** (∥) | **A3** Android e2e smoke (emulator CI) · **C2** engine oracle rung + tools `engine_*` (fail-closed) · **C3** WebGL-in-WebView CDP path | A2; C1 |
| **W3** (∥) | **C4** Unity-Accessibility detection + **commit Unity sample instrumented** (WebGL dev build cho CI nhẹ) + engine e2e · **A4** runbook manual-QA Android real · **B1** iOS-real lifecycle (go-ios/devicectl/tunnel/DDI) | C2/C4; M0 |
| **W4** (∥) | **B2** iOS-real gesture/inspect (WDA/XCUITest) + Maestro real fallback · **B3** iOS-real smoke (manual QA hoặc device-CI) | B1 |
| **W5** (release) | docs (engine setup + real-device prereqs: signing/tunnel) · tool-count sync (plugin.json/server.json/README/health.ts) · CHANGELOG · version 0.3.0 · registry republish | tất cả |

**Dependency matrix:** M0 chặn A*, B*. A1→A2→A3→A4. B1→B2→B3. C1→C2→C3,C4. Sau M0: nhánh A ∥ nhánh B ∥ nhánh C độc lập.

---

## Acceptance criteria (kiểm chứng được)
- **AC-A (Android):** `device_list` thấy emulator booted; `tap_on/swipe/input_text/inspect_screen/screenshot` chạy; hierarchy `uiautomator` trả JSON (resource-id/text/bounds); **1 e2e Android xanh trên CI**.
- **AC-B (iOS-real):** iPhone đã pair → install/launch/tap/inspect qua WDA khi có signing+tunnel; fail-closed + doc prereq khi thiếu; **≥1 smoke real-device** (manual QA hoặc device-CI).
- **AC-C (Engine):** với Unity sample instrumented (AltTester), `engine_inspect` trả object có tên + toạ độ màn hình (**0 screenshot**); `engine_tap/swipe` điều khiển; `engine_call` gọi component method; build không instrumented → lỗi actionable; **1 e2e engine xanh trên CI**.
- **AC-global:** `typecheck && build && test` exit 0; test **≥182 + mới** (adb/uiautomator/wda/engine/oracle-engine/parity); tool-count synced mọi nơi; CHANGELOG + version `0.3.0`; **không regression iOS-sim (182 test)**.

## Pre-mortem
1. **Scope tràn 3 epic** → mỗi epic ship độc lập; ưu tiên Android+Engine, iOS-real cô lập để không chặn phần khác.
2. **Prereq iOS-real giòn** (signing/DDI/tunnel iOS-17, drift theo iOS version) → detect+fail-closed+doc+Maestro fallback; cô lập nhánh B.
3. **Ma sát AltTester** (user không thêm SDK / build production không hỗ trợ) → gate trung thực + commit sample sẵn + Unity-a11y/WebGL-CDP phủ một phần + coordinate là last-resort opt-in.

## ADR
- **Decision:** Mở rộng abstraction backend+oracle sẵn có để (a) thiết bị thật qua platform driver staged (Android trước) và (b) game-engine automation qua rung "engine" AltTester-primary không-vision.
- **Drivers:** 2 yêu cầu cứng của user; token economy (không vision); tái dùng tối đa (coupling gom ở simctl.ts).
- **Alternatives:** vision engine automation (loại — tốn token, không có element identity, trái yêu cầu); cloud farm làm "real device" (để sau — không local); fork per-platform (loại — drift/bảo trì).
- **Consequences:** +3 backend, +dependency protocol engine, CI surface lớn hơn (emulator + sample instrumented + device-CI tùy chọn), doc prereq nặng hơn; engine + iOS-real là tính năng dev/instrumented/signed-build, không phải app production bất kỳ.
- **Follow-ups (post-0.3):** cloud submit/poll; test-recording → export; HTTPS proxy capture; engine ngoài Unity.

---

## ⚙️ Điều kiện thực thi (môi trường) — QUAN TRỌNG
Phần lớn AC **không kiểm chứng được trong môi trường hiện tại** vì thiếu phần cứng/SDK:
- **AC-A** cần **Android emulator/thiết bị** (chưa có) → code viết được, e2e cần emulator trong CI.
- **AC-B** cần **iPhone thật đã pair + Apple signing/provisioning + Mac** → chỉ chủ máy cung cấp được.
- **AC-C** cần **Unity + build AltTester-instrumented** (sample phải dựng bằng Unity) → cần Unity license/toolchain.

→ Team có thể viết + unit/integration-test (mock adb/uiautomator/WDA-XML/AltTester-JSON) cho M0, A1, A2, C1, C2, C3. Các e2e phụ thuộc phần cứng (A3, B*, C4-e2e) phải chạy trên hạ tầng có thiết bị thật hoặc đánh dấu manual/nightly.
