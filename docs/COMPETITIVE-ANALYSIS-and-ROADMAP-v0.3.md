# Podium-MCP — Phân tích cạnh tranh & Roadmap tới "release-ready"

> Bối cảnh: podium v0.2.0 đã hardening (R1–R5 + Q1–Q7) nhưng vẫn **iOS-simulator-only**, chưa đủ mạnh để release đua với mặt bằng 2026.
> Tài liệu này: (1) bản đồ đối thủ, (2) benchmark podium, (3) điểm yếu chặn release, (4) roadmap P0/P1/P2 + phạm vi mốc release.
> Nghiên cứu thị trường có dẫn nguồn (mid-2026). Phần chấm điểm/đề xuất là suy luận của tác giả; đã ghi rõ.

---

## Phần 1 — Bản đồ đối thủ (tóm tắt, nguồn dẫn)

| Server | Nền tảng | Backend | #Tools | Mạnh nhất | Yếu | Độ chín |
|---|---|---|---|---|---|---|
| **mobile-mcp** (mobile-next) | iOS sim+**real**, Android emu+**real** | WDA + a11y + simctl / adb + UiAutomator | ~25 | Cross-platform + real device, a11y-first, momentum | Không có WebView DOM, không network, không RN/Metro | **~5.2k★**, rất tích cực — *leader phổ biến* |
| **Maestro MCP** (mobile.dev) | iOS/Android/Chromium, real qua Cloud | Maestro CLI + Cloud | 9 | YAML flow tái sử dụng, **cloud device farm**, org hậu thuẫn, embedded Viewer | Flow-centric, không lộ network/log/crash | Backing thương mại mạnh nhất |
| **Appium MCP** (official) | Android, iOS, **WebView context**, remote grid | Appium WebDriver (XCUITest/Espresso) | **40+** | **Native↔WebView context switching thật**, AI-vision, NO_UI tiết kiệm token, gen test code | Setup nặng, latency cao, cộng đồng còn nhỏ | 391★, official org |
| **ios-simulator-mcp** (joshuayoes) | **iOS sim only** | idb + simctl | 14 | Wrapper idb sạch, default cho iOS-sim | Sim-only, không Android/real/webview/network | **~2.0k★** — *peer trực tiếp của podium* |
| **metro-mcp** (steve228uk) | RN (iOS/Android) | CDP/Hermes qua Metro, **multiplex** | **70+** | **Network req/resp, CPU/heap profiling, Redux/state, test-recording → Appium/Maestro/Detox** | Chỉ tầng JS/RN, không gesture native sâu | v0.12, 31 releases — *leader RN-debug* |
| **react-native-devtools-mcp** | iOS sim + Android emu | simctl/idb + adb + **Metro CDP** | 16 | RN-purpose-built (native UI + JS eval) | Rất non (3★) | Sơ khai |

Nguồn: github.com/mobile-next/mobile-mcp · docs.maestro.dev/get-started/maestro-mcp · github.com/appium/appium-mcp · github.com/joshuayoes/ios-simulator-mcp · github.com/steve228uk/metro-mcp · github.com/pnarayanaswamy/react-native-devtools-mcp.
Cloud (official MCP): BrowserStack (`browserstack/mcp-server`, 30k+ real devices), Sauce Labs (`saucelabs/sauce-api-mcp`), Maestro Cloud.

**Mặt bằng 2026 (table-stakes):** cross-platform iOS+Android (tối thiểu sim/emu, lý tưởng real device) · inspect hierarchy ra JSON · full gesture · app lifecycle · screenshot + recording · device logs + crash. **Differentiators:** WebView/DOM context (chỉ Appium làm tốt; WKWebView là khoảng trống lớn) · **network inspection** (gần như cả thị trường thiếu) · RN/Metro JS introspection · cloud submit/poll · test-recording → export.

---

## Phần 2 — Benchmark podium (tương đối: 🟢 dẫn · 🟡 ngang · 🔴 thua)

| Tiêu chí | podium (34 tools, iOS-sim) | vs mặt bằng | Ghi chú |
|---|---|---|---|
| Độ phủ nền tảng | iOS-simulator only | 🔴 **thua** | mobile-mcp/Appium có Android + real device; podium chỉ sim iOS |
| Gesture / input | tap/swipe/type/key/run_steps, native idb→mobilecli→Maestro | 🟢 dẫn | run_steps batch là điểm cộng cho agent |
| Screen inspect | inspect_screen native-first (a11y tree) | 🟡 ngang | đúng chuẩn JSON hierarchy |
| **WebView DOM** | webview_inspect/eval/navigate (WKWebView qua CDP) → tap toạ độ thật | 🟢 **dẫn** | Hiếm tool có WKWebView DOM; đây là vũ khí khác biệt nhất |
| Network introspection | ❌ không | 🔴 **thua** | metro-mcp/Rozenite có network panel; khoảng trống lớn của podium |
| Logs / RN runtime | metro_logs (CDP console), JS eval gián tiếp | 🟡 ngang | có console nhưng thiếu network/state/profiling so với metro-mcp |
| Crash | crash_list/get (host + sim, path-safe) | 🟢 dẫn | đầy đủ |
| Recording | record_start/stop + watchdog (v0.2.0) | 🟢 dẫn | đã hardening |
| E2E flows | run_flow (Maestro YAML) + run_steps | 🟡 ngang | có flow nhưng không cloud, không export/record |
| Cloud / real-device | ❌ không | 🔴 **thua** | Maestro/BrowserStack/Sauce có MCP cloud chính chủ |
| Tốc độ | native idb sub-giây, Maestro fallback chậm | 🟢 dẫn | tap_on ~14.7s→0.6s |
| Độ tin cậy | đã sửa timeout/recording/cache (v0.2.0); oracle tap còn yếu | 🟡 ngang | R1 mới sửa tối thiểu |
| Độ phủ test | 126 unit/integration; **0 e2e trên sim/real** | 🟡 ngang | tốt ở unit, thiếu e2e thật |
| AI-agent UX | mô tả tool rõ, output token-efficient, run_steps | 🟢 dẫn | điểm mạnh thực sự |
| Phân phối | npm published + Claude plugin + glama.json | 🟡 ngang | thiếu Official MCP Registry server.json |

**Kết luận benchmark:** podium **vượt peer trực tiếp (ios-simulator-mcp)** nhờ WebView DOM + run_steps + RN console + hardening, và **dẫn về AI-agent UX**. Nhưng **thua mặt bằng leader** ở 3 trục quyết định release: (a) chỉ iOS-sim — không Android, không real device; (b) không network introspection; (c) không cloud. Vị thế hiện tại: "**công cụ iOS-sim + WebView mạnh cho agent**", chưa phải "nền tảng mobile-automation toàn diện".

---

## Phần 3 — Điểm yếu chặn release (xếp theo mức ảnh hưởng)

| # | Gap | Ảnh hưởng release | Đối thủ đã giải | Mức |
|---|---|---|---|---|
| G1 | **iOS-simulator-only** — không Android, không real device | Loại podium khỏi phần lớn use-case QA thật; là câu hỏi đầu tiên người dùng hỏi | mobile-mcp, Appium (cả hai), Maestro | 🔴 Chặn |
| G2 | **Không network introspection** (chỉ console) | RN QA 2026 kỳ vọng xem request/response; thiếu là điểm trừ lớn | metro-mcp, Rozenite | 🔴 Chặn |
| G3 | **Không E2E thật trên sim/real trong CI** | Không chứng minh được tool thực sự chạy; regression phía simctl/idb không bị bắt | Maestro, Appium | 🟠 Cao |
| G4 | **Oracle xác nhận tap yếu** (byte-size PNG; R1 mới sửa tối thiểu) | tap_with_fallback/notification_bar_clear không đáng tin đúng use-case WebView động | (pixel-diff/a11y verify) | 🟠 Cao |
| G5 | **WKWebView DOM mong manh** — prod builds isInspectable=false, chưa có test | Vũ khí khác biệt nhưng dễ "không chạy" ngoài dev/staging | Appium (context switch ổn định hơn) | 🟠 Cao |
| G6 | **Chưa lên Official MCP Registry** (server.json) | "Discoverability" chuẩn 2026; mới có npm+plugin+glama | mọi server chín đều có | 🟡 Trung |
| G7 | **Không cloud submit/poll** | Không chạy được trên device farm qua agent | Maestro/BrowserStack/Sauce | 🟡 Trung (diff) |
| G8 | **Không test-recording → export** (Appium/Maestro/Detox) | Mất khả năng biến phiên agent thành test tái sử dụng | metro-mcp | 🟡 Trung (diff) |
| G9 | **Android claim trong mô tả nhưng iOS-only** (device_list/press_key) | Agent gọi Android sẽ lỗi xcrun khó hiểu — hoặc làm, hoặc gỡ claim | — | 🟡 Trung |

---

## Phần 4 — Roadmap tới release-ready

Kế thừa `docs/ROADMAP-v0.2.0.md` (R1–R5 đã xong; F1 adb, F2 e2e còn treo). Effort: S/M/L. "Done" phải kiểm chứng được.

### P0 — Bắt buộc cho release đầu (giải gap chặn)

| ID | Vấn đề | Giải pháp | Khu vực | Effort | Rủi ro | Done |
|---|---|---|---|---|---|---|
| P0-1 | G1 Android | Thêm backend **adb** thật vào `NativeBackend` (mobilecli đã hỗ trợ Android; abstraction sẵn). Bắt đầu: device_list/gesture/inspect/screenshot/logs cho Android emu | `lib/native.ts`, `lib/idb.ts`→adb sibling, tools | **L** | Cao (bề mặt mới, cần emu test) | device_list + tap + inspect_screen + screenshot chạy trên 1 Android emulator; e2e smoke pass |
| P0-2 | G1 scope rõ ràng (tạm thời) | Nếu chưa kịp adb đầy đủ: gỡ/đánh dấu rõ Android trong mọi description + gate phím Android | `tools/device.ts`, `screen.ts` | **S** | Thấp | Mọi mô tả nêu đúng nền tảng; không còn lỗi xcrun mơ hồ |
| P0-3 | G2 network | Mở rộng Metro CDP: thêm tool **`metro_network`** (Network.enable → requestWillBeSent/responseReceived), tái dùng WebSocket như metro_logs | `lib/metro.ts`, `tools/debug.ts` | **M** | Trung (đa kết nối Hermes — cần multiplex giống metro-mcp) | metro_network trả danh sách req/resp có status/timing trên 1 app RN thật; test mock CDP |
| P0-4 | G3 E2E thật | F2: 1 smoke E2E boot sim → install app mẫu → tap/inspect/screenshot → assert; chạy nightly/tag (không chặn PR) | `sweeps-automated-test` style / CI workflow | **M** | Trung (CI macOS chậm) | 1 e2e xanh trên CI macOS runner; artifact (screenshot) lưu |
| P0-5 | G6 registry | Tạo `server.json` chuẩn Official MCP Registry, publish qua `mcp-publisher`; immutable semver | repo root + CI | **S** | Thấp | Podium xuất hiện trên registry.modelcontextprotocol.io + Glama; `npx -y podium-mcp` chạy |

### P1 — Nên có (nâng độ tin cậy & sức cạnh tranh)

| ID | Vấn đề | Giải pháp | Effort | Done |
|---|---|---|---|---|
| P1-1 | G4 oracle | Oracle tap dựa **pixel-diff** (decode PNG downsample) hoặc verify bằng a11y/DOM thay vì byte-size; hoặc ưu tiên webview_inspect khi có WebView | M | tap_with_fallback phân biệt đúng change/no-change trên fixture động; test |
| P1-2 | G5 WebView ổn định | Phát hiện & báo rõ isInspectable=false; doc cách bật ở debug/staging; fallback coordinate có hướng dẫn | S | webview_* trả lỗi actionable khi prod; doc rõ |
| P1-3 | G2+ RN sâu | Thêm Redux/state read + perf marks (theo mẫu metro-mcp/Rozenite) | M | metro_state trả Redux snapshot; test mock |
| P1-4 | Test e2e mở rộng | Maestro flow e2e cho login/WebView tap trên sim thật | M | ≥2 e2e flow xanh |

### P2 — Để sau / differentiator (v1.x)

| ID | Vấn đề | Giải pháp | Effort |
|---|---|---|---|
| P2-1 | G7 cloud | Tool submit flow → Maestro Cloud/BrowserStack + poll-to-terminal | L |
| P2-2 | G8 export | Ghi phiên run_steps → xuất Maestro YAML / Appium / Detox | M |
| P2-3 | Real device iOS | WebDriverAgent backend cho iPhone thật | L |
| P2-4 | HTTPS proxy capture | mitmproxy/Proxyman-style (khoảng trống cả thị trường) | L |

---

## Phạm vi mốc release đề xuất

**v0.3.0 (release-ready tối thiểu, ~"đủ mạnh để công bố nghiêm túc"):**
- **Phải có:** P0-2 (scope rõ), P0-3 (network), P0-4 (1 e2e thật), P0-5 (MCP Registry) + P1-1 (oracle) + P1-2 (WebView ổn định).
- **Nên có:** P0-1 Android cơ bản (nếu kịp; nếu không → v0.4).
- **Để sau:** cloud, export, real device, proxy.

**v1.0 (toàn diện, cạnh tranh leader):** + P0-1 Android đầy đủ + P1-3 RN sâu + P2-1 cloud + P2-2 export.

### Chỉ số "đủ mạnh để release"
1. ≥2 nền tảng có đường chạy thật (iOS-sim chắc chắn + Android emu cơ bản **hoặc** scope iOS-only nêu minh bạch).
2. Có network introspection (metro_network) — không chỉ console.
3. ≥1 e2e thật xanh trong CI (boot→install→tap→assert), không chỉ unit mock.
4. Oracle tap không false-positive trên nội dung động (pixel/DOM-verified).
5. Lên Official MCP Registry + Glama, `npx -y` zero-install, semver immutable, CI gate test trước publish (đã có).
6. WebView DOM có test + báo lỗi actionable khi isInspectable=false.
7. Test ≥ hiện tại (126) + e2e; typecheck/build/test gate xanh.

> **Một câu định vị mục tiêu v0.3:** "MCP tự động hoá mobile cho AI agent, mạnh nhất về **iOS + WebView DOM**, có **network introspection RN**, chạy được **e2e thật**, và phân phối chuẩn registry" — đủ khác biệt (WebView) + đủ chuẩn (network/e2e/registry) để release mà không bị coi là 'chỉ tap/swipe trên sim'.
