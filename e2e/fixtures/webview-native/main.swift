// Minimal iOS-simulator app hosting an INSPECTABLE WKWebView, used as the e2e
// fixture for podium's webview_* tools (webview_inspect/eval/navigate). It loads
// inline HTML with known, stable elements so the WebView happy-path can be
// asserted deterministically. No external deps; built with swiftc (see build.sh).
import UIKit
import WebKit

final class ViewController: UIViewController {
  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .white
    let cfg = WKWebViewConfiguration()
    let webView = WKWebView(frame: view.bounds, configuration: cfg)
    webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    if #available(iOS 16.4, *) {
      webView.isInspectable = true // the whole point: make the WebView debuggable
    }
    view.addSubview(webView)

    let html = """
    <!doctype html><html><head>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Podium Fixture</title></head>
    <body style="font-family:-apple-system;padding:24px">
      <h1 id="title">Podium Fixture</h1>
      <button id="login" data-testid="login-btn">Log In</button>
      <input id="email" placeholder="email">
      <p id="status">ready</p>
      <script>
        window.__fixtureReady = true;
        // Periodic same-origin requests so webview_network has real traffic to
        // capture. fixture.local has no server, so they fail-closed (status 0) —
        // but the request (url/method/headers/body) is still recorded. This keeps
        // the e2e self-contained (no external network dependency) while exercising
        // the full capture → HAR → redaction path. The Authorization header + POST
        // body below are what redaction-by-default must mask.
        window.__fire = function () {
          fetch('https://fixture.local/api/balance?cur=SC', { headers: { 'Authorization': 'Bearer FIXTURE-TOKEN' } }).catch(function () {});
          fetch('https://fixture.local/api/redeem', { method: 'POST', headers: { 'Authorization': 'Bearer FIXTURE-TOKEN', 'Content-Type': 'application/json' }, body: '{"amount":5}' }).catch(function () {});
        };
        setInterval(window.__fire, 1000);
      </script>
    </body></html>
    """
    webView.loadHTMLString(html, baseURL: URL(string: "https://fixture.local/"))
  }
}

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?
  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    window = UIWindow(frame: UIScreen.main.bounds)
    window?.rootViewController = ViewController()
    window?.makeKeyAndVisible()
    return true
  }
}
