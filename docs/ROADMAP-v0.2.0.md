# Podium-MCP — Kế hoạch nâng cấp v0.2.0

> Trạng thái nền (đã xác minh trên `main`, 2026-06-13): v0.1.0 · 34 tools · typecheck/build sạch · **113 test pass / 9 file**.
> CI `ci.yml` + `publish-npm.yml` đã gate typecheck→build→test trước khi publish. Tool-count đã đồng bộ = 34 ở mọi nơi.
>
> Tài liệu này chỉ **lập kế hoạch** — chưa viết code. Mỗi hạng mục: Vấn đề · `file:line` · Giải pháp · Rủi ro · Effort (S/M/L) · Ưu tiên (P0/P1/P2).

---

## Trục 1 — Độ tin cậy (Reliability) — *trọng tâm v0.2.0*

### R1 · Oracle xác nhận tap bằng delta dung lượng PNG **[P0 · M]**
- **Vấn đề:** `tap_with_fallback` và `notification_bar_clear` coi tap thành công khi `|after-before| > max(before*0.02, 1)` byte PNG. Dung lượng PNG phụ thuộc *entropy hình ảnh* (animation, con trỏ nháy, video, ad) → false positive; toggle nhỏ → false negative rồi mù quáng "walk" `y` lên trên. Đúng use-case WebView game/overlay động (mục tiêu chính của podium) thì heuristic này gần như vô dụng.
- **`file:line`:** `src/tools/screen.ts:562-576` (tap_with_fallback), `src/tools/screen.ts:642-645` (notification_bar_clear); mô tả tại `:509`, tham số `offsetStep` `:522`, walk-up `:530`.
- **Giải pháp:** So sánh nội dung pixel thay vì dung lượng file — decode 2 PNG, diff vùng quan tâm sau khi downsample (ngưỡng theo % pixel khác biệt). Nếu thêm dependency giải mã ảnh là quá nặng, tối thiểu: (a) bỏ kiểu walk-up `y` vô định hướng, (b) document rõ oracle không đáng tin trong tool description để agent giảm trọng số `ok`. Cân nhắc dùng chính `inspect_screen`/DOM webview làm oracle thật khi có.
- **Rủi ro:** Trung bình — đổi hành vi tool công khai; cần test trước/sau.

### R2 · Timeout mặc định 5s áp lên `launch`/`openUrl`/`terminate`/`setLocation` **[P0 · S]**
- **Vấn đề:** `exec.ts` default 5000ms. `boot`(30s)/`install`(60s)/`screenshot`(15s)/`uninstall`(30s) có timeout riêng, nhưng `launch`/`terminate`/`openUrl`/`setLocation` **kế thừa 5s**. App RN cold-launch trên CI thường >5s → agent nhận "launch failed (code n)" mà thực ra là timeout; `RunResult` không phân biệt được timeout vs lỗi thật.
- **`file:line`:** `src/lib/exec.ts:27` (default); `src/lib/simctl.ts:110` (launch), `:114` (terminate), `:122` (openUrl), `:130` (setLocation) — không truyền `{timeout}`.
- **Giải pháp:** Cho `launch` timeout ≥30s, `openUrl`/`terminate`/`setLocation` ≥15s. Bổ sung phân biệt timeout: map `ETIMEDOUT`/`SIGTERM` từ `execFile` thành cờ `timedOut: true` trong `RunResult` (`exec.ts:33-40`) để thông điệp lỗi gợi ý "retry với timeout lớn hơn".
- **Rủi ro:** Thấp.

### R3 · `record_start` ghi đè video cũ + recording không giới hạn **[P1 · M]**
- **Vấn đề:** Registry keyed theo `udid`; default path `podium-recording-${udid}.mp4` không timestamp → cycle start→stop→start ghi đè file cũ, path cũ agent giữ trỏ sang video mới. `spawn(...recordVideo, {detached:true})` **không có max duration/size**; server restart → process detached mồ côi, mất pid, `record_stop` không kill được → đầy đĩa.
- **`file:line`:** `src/lib/recording.ts:25-40` (spawn detached, registry by udid, no cap); default path tại `src/tools/device.ts` (record_start handler); poll-wait có `setTimeout` tại `recording.ts:78` nhưng **không phải** watchdog giới hạn.
- **Giải pháp:** (a) thêm `Date.now()` vào default path như mọi temp artifact khác; (b) watchdog `setTimeout` SIGINT sau `PODIUM_MAX_RECORDING_MS` (mặc định 600_000), lưu trong registry, `clearTimeout` ở stop; (c) tùy chọn reap `podium-recording-*.mp4` cũ trong tmpdir lúc khởi động.
- **Rủi ro:** Thấp-trung bình.

### R4 · Negative-cache backend không bao giờ re-probe **[P1 · S]**
- **Vấn đề:** `getBackend()` cache `cachedBackend = null` vĩnh viễn nếu lúc khởi động idb chưa sẵn sàng → tụt xuống đường Maestro chậm cả vòng đời process dù idb đã lên. Warm-up fire-and-forget (`index.ts:29-30`) làm tăng khả năng probe quá sớm.
- **`file:line`:** `src/lib/native.ts:333-351` (getBackend, cache null ở `:350`). Đã có mẫu TTL tại `screenPointsCache` `native.ts:243`.
- **Giải pháp:** Cache *positive* vĩnh viễn, *negative* TTL ngắn (vd 30s) — tái dùng mẫu TTL sẵn có. Phơi trạng thái backend trong `podium_health` (đã có) + document "restart sau khi cài idb".
- **Rủi ro:** Thấp.

### R5 · Logic gesture/fallback nhân đôi giữa `screen.ts` và `steps.ts` **[P1 · M]**
- **Vấn đề:** swipe/key/tapText/type cài 2 lần, hợp đồng lệch nhau: `screen.ts` swipe nhận percent-string, `steps.ts` swipe chỉ số; `input_text` submit-fail → `screen.ts` trả error, `steps.ts` âm thầm fallback. Đã drift, sẽ tiếp tục drift (shotgun surgery).
- **`file:line`:** `src/tools/screen.ts` (gesture handlers) vs `src/tools/steps.ts:166-360` (execStep).
- **Giải pháp:** Rút executor native+Maestro per-action vào `src/lib/gesture.ts` (`nativeSwipe`/`nativeKey`/`nativeTapText`/`nativeType`); cả hai tool gọi chung. ~150 LOC trùng lặp gộp lại, hợp đồng thống nhất.
- **Rủi ro:** Trung bình — refactor đụng 2 tool nóng; cần parity test trước/sau (xem T-tests).

---

## Trục 2 — Thiết kế tool cho AI agent

### A1 · Bề mặt chồng chéo `run_steps` / `run_flow` / tool lẻ **[P1 · S]**
- **Vấn đề:** 3 cách điều khiển flow đa-bước, không có quy tắc chọn → agent routing kém.
- **`file:line`:** `src/tools/steps.ts:365`, `src/tools/flow.ts:24` & `:109`.
- **Giải pháp:** Thêm 1 dòng "When to use vs X" vào mỗi description (vd run_steps: ">2 hành động tuần tự đã biết; dùng run_flow cho assertion/điều kiện/loop; tool lẻ cho cử chỉ thăm dò đơn lẻ").
- **Rủi ro:** Rất thấp (chỉ sửa text).

### A2 · `findElements` ngữ nghĩa match khó đoán, không document **[P2 · S]**
- **Vấn đề:** regex hợp lệ → khớp *full-string* `^(?:...)$`; regex không hợp lệ → âm thầm chuyển sang *substring*. Hai input gần giống cho độ rộng khớp ngược nhau.
- **`file:line`:** `src/lib/native.ts:57` (anchored) vs `:72-73` (substring fallback).
- **Giải pháp:** Document ngữ nghĩa anchored trong mô tả tham số `text` của `tap_on`/`run_steps`; cân nhắc cho nhánh invalid-regex cũng anchored để nhất quán.
- **Rủi ro:** Thấp (đổi behavior fallback cần test).

### A3 · Mô tả `tap_on` nói "percent" nhưng schema là `z.number()` **[P2 · S]**
- **Vấn đề:** Mô tả gây hiểu nhầm; agent thử `x:"35%"` sẽ lỗi validation.
- **`file:line`:** `src/tools/screen.ts:146`.
- **Giải pháp:** Bỏ chữ "percent" khỏi mô tả `tap_on` (chỉ numeric).
- **Rủi ro:** Rất thấp.

---

## Trục 3 — Chất lượng, an toàn & correctness

### Q1 · `app_state`/`app_install` dùng `.includes(bundleId)` → false positive **[P1 · S]**
- **Vấn đề:** `com.foo` khớp nhầm `com.foobar`; `com.example.App` khớp `…App.Extension`. `installed` báo true cho app không thực sự cài.
- **`file:line`:** `src/tools/debug.ts:151-159`.
- **Giải pháp:** Tái dùng path parse plist→JSON đã có trong `simctl.ts:listApps`, so khớp key bundle-id chính xác thay vì substring.
- **Rủi ro:** Thấp.

### Q2 · `metro.ts` phân loại lỗi gộp về một thông điệp **[P2 · S]**
- **Vấn đề:** 3 nhánh catch (`ECONNREFUSED`, timeout, else) đều `return "metro not running on port"` → lỗi DNS/parse bị báo sai, đánh lạc hướng agent. (Nhánh HTTP-status `:29` và not-array `:33` thì đã phân biệt đúng.)
- **`file:line`:** `src/lib/metro.ts:50,53,55`.
- **Giải pháp:** Phân biệt: timeout → "metro slow/not responding"; lỗi khác → message thật. Hoặc gộp về 1 return nếu không cần phân biệt.
- **Rủi ro:** Rất thấp.

### Q3 · Trust-boundary `webview_eval` & `run_flow` (Maestro `runScript`/`evalScript`) **[P1 · S]**
- **Vấn đề:** Cả hai = thực thi JS/code cục bộ tùy ý **theo thiết kế** (không phải injection — truyền verbatim qua execFile). Ai điều khiển MCP chạy được JS bất kỳ trong WebView inspectable / code Maestro trên máy host.
- **`file:line`:** `src/tools/webview.ts:51-70` (webview_eval), `src/tools/flow.ts:24` (run_flow); cheat-sheet ship kèm tại `assets/`.
- **Giải pháp:** Document rõ trust-boundary trong README/SECURITY; tùy chọn env-gate (`PODIUM_ALLOW_WEBVIEW_EVAL`, giới hạn `dir`/`files` của run_flow về thư mục flows được cấu hình). Không "fix" vì đây là tính năng.
- **Rủi ro:** Thấp (chủ yếu docs + cờ tùy chọn).

### Q4 · Rò PII vào transcript (webview eval/inspect, metro_logs) **[P2 · S]**
- **Vấn đề:** Trả thẳng state trang/console (token, giá trị input, balance) vào kết quả MCP → lưu vào session archive vĩnh viễn, không redaction.
- **`file:line`:** `src/lib/webview.ts:86-99`, `src/tools/debug.ts` (metro_logs handler).
- **Giải pháp:** Document "coi output webview/log là nhạy cảm, đừng persist nguyên văn". (Không có code fix nào không phá tính năng.)
- **Rủi ro:** Rất thấp.

### Q5 · Ràng buộc path ghi & temp file **[P2 · S]**
- **Vấn đề:** Path ghi tuyệt đối cho screenshot/recording không bị ràng buộc; vài temp dùng `Date.now()` đoán được. (Guard path-traversal của `crash_get` đã đúng — không cần đụng.)
- **`file:line`:** `src/tools/device.ts` (screenshot/record saveTo), `src/lib/simctl.ts:148,192`.
- **Giải pháp:** Tùy chọn ràng `PODIUM_OUTPUT_DIR` + dùng `mkdtemp` (như `flow.ts` đã làm đúng) cho listapps/measure temp.
- **Rủi ro:** Thấp.

### Q6 · Enforce `engines: node>=22` **[P2 · S]**
- **Vấn đề:** Khai báo `engines` nhưng không có `.npmrc engine-strict`/preinstall → user Node 18/20 cài được rồi crash ở top-level `await` (`index.ts`).
- **`file:line`:** `package.json:28` (engines), không có `.npmrc`.
- **Giải pháp:** Thêm `.npmrc` với `engine-strict=true` hoặc preinstall check script.
- **Rủi ro:** Rất thấp.

### Q7 · `docs/tool-catalog.md` sai engine của `inspect_screen` **[P2 · S]**
- **Vấn đề:** Liệt kê `inspect_screen` là `maestro hierarchy` nhưng code chạy native fast-path (idb/mobilecli) trước → sai kỳ vọng latency.
- **`file:line`:** `docs/tool-catalog.md:55`.
- **Giải pháp:** Sửa mô tả phản ánh native-first, fallback Maestro.
- **Rủi ro:** Rất thấp.

---

## Trục 4 — Tính năng mới (mở rộng giá trị)

### F1 · Hỗ trợ Android thực qua adb **[P2 · L]**
- **Vấn đề/cơ hội:** `device_list`/`press_key`/`inspect_screen` quảng cáo Android nhưng mọi action path đều `xcrun simctl` (iOS-only) → agent gọi Android sẽ lỗi `xcrun` khó hiểu.
- **Giải pháp:** Hoặc (a) thêm backend adb thật (`NativeBackend` đã trừu tượng hóa sẵn — mobilecli hỗ trợ Android), hoặc (b) làm rõ scope iOS-only trong mọi description và gate phím Android. Khuyến nghị: bắt đầu bằng (b) trong v0.2.0, để (a) cho v0.3.
- **Rủi ro:** Cao nếu làm (a) — nhiều bề mặt mới, cần thiết bị/emulator test.

### F2 · E2E thật trên simulator trong CI **[P2 · L]**
- **Vấn đề/cơ hội:** Toàn bộ test hiện là unit/mock; không test nào boot sim thật → regression phía simctl/idb không bị bắt.
- **Giải pháp:** 1 smoke E2E trên macOS runner: boot sim → install app mẫu → tap/inspect/screenshot → assert. Gắn label `e2e`, chạy nightly hoặc trên tag release (không chặn PR thường).
- **Rủi ro:** Trung bình — CI macOS chậm/đắt; cần app mẫu ổn định.

---

## Test mới cần bổ sung (đi kèm các thay đổi trên)

| ID | Phục vụ | Nội dung |
|----|---------|----------|
| T1 | R1 | `screen.test.ts` (chưa tồn tại): oracle diff pixel — fixture 2 ảnh giống/khác, ngưỡng, không-thay-đổi → `ok:false` |
| T2 | R2 | `exec.test.ts`: case timeout → trả non-zero + cờ `timedOut:true`; assert launch dùng timeout ≥30s |
| T3 | R3 | `device.test.ts`: default path có timestamp; watchdog SIGINT sau MAX_MS; clearTimeout khi stop |
| T4 | R4 | `native.test.ts`: negative cache re-probe sau TTL; positive cache giữ |
| T5 | R5 | parity test `nativeSwipe/Key/TapText/Type` dùng chung — đầu ra `screen.ts` ≡ `steps.ts` cho cùng input |
| T6 | Q1 | `debug.test.ts`: `installed:false` cho bundleId là prefix của app khác |
| T7 | A2 | `native.test.ts`: ngữ nghĩa anchored vs invalid-regex (sau khi thống nhất) |
| — | screen handlers | bổ sung handler test cho `input_text`/`swipe`/`press_key`/`notification_bar_clear` (hiện chưa có file test) |

---

## Milestones (thứ tự thực thi + phụ thuộc)

### M0 — Quick wins, không rủi ro hành vi *(song song, không phụ thuộc)*
A1, A3, Q2, Q6, Q7 (+ phần docs của Q3, Q4).
- **Done khi:** typecheck+build+test xanh; docs cập nhật; `.npmrc engine-strict` thêm.

### M1 — Reliability lõi *(phụ thuộc: nền M0 không bắt buộc)*
R2 → R4 → R3. (R2 trước vì rẻ & chặn lỗi launch sai; R4, R3 độc lập nhau.)
- **Done khi:** T2, T3, T4 pass; `podium_health` phơi backend state; không regression 113 test cũ.

### M2 — Refactor gesture + oracle *(R5 trước R1 vì R1 nên dùng executor đã hợp nhất)*
R5 (rút `lib/gesture.ts`) → R1 (oracle pixel) → Q1.
- **Done khi:** T5 parity pass; T1 oracle pass; T6 pass; full suite xanh; manual QA: 1 flow login + tap WebView trên sim thật.

### M3 — Tài liệu trust-boundary + scope *(phụ thuộc M0–M2 hoàn tất API)*
Hoàn thiện Q3/Q4 docs, A2 docs, làm rõ scope iOS-only (F1-b), `docs/tool-catalog.md`.
- **Done khi:** README/SECURITY/tool-catalog phản ánh hành vi v0.2.0; CHANGELOG cập nhật; bump version 0.2.0.

### M4 (để sau / tách version) — Mở rộng nền tảng
F2 (E2E sim CI), F1-a (adb backend) → cân nhắc cho v0.3.0.

---

## Đề xuất scope v0.2.0

**Phải có (P0/P1):** R1, R2, R3, R4, R5, Q1, Q3(docs+gate), A1 — + test T1–T6.

**Nên có (P2 rẻ):** A2, A3, Q2, Q4, Q5, Q6, Q7, F1-b (làm rõ scope iOS-only).

**Để sau (v0.3.0):** F1-a (adb backend đầy đủ), F2 (E2E sim trong CI).

**Tiêu chí phát hành v0.2.0:** `npm run typecheck && npm run build && npm test` đều exit 0; suite ≥ 113 test (cộng T1–T6) xanh; 1 lượt manual QA trên simulator thật cho tap WebView + cold launch; CHANGELOG + version bump; trust-boundary đã document.
