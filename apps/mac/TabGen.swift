// TabGen for macOS: a native window around the local TabGen server (scripts/run.sh). The app
// starts the server when it opens and stops it when it quits — unless the optional background
// server (scripts/install-mac.sh --background, a LaunchAgent) is installed. The app itself holds
// no logic: it waits for the server, shows the web app, and wires up what a browser tab would
// give for free — the microphone (tuner, play-along), file pickers, downloads (exports) and the
// usual Edit / View menus.
//
// Built by scripts/install-mac.sh:  swiftc -O -o TabGen apps/mac/TabGen.swift

import AppKit
import AVFoundation
@preconcurrency import WebKit

let serverURL = URL(string: Bundle.main.object(forInfoDictionaryKey: "TabGenURL") as? String ?? "http://127.0.0.1:8000")!
let agentLabel = "com.tabgen.server"
let repoRoot = Bundle.main.object(forInfoDictionaryKey: "TabGenRoot") as? String ?? ""
let agentInstalled = FileManager.default.fileExists(
    atPath: NSHomeDirectory() + "/Library/LaunchAgents/\(agentLabel).plist")
let background = NSColor(red: 0x0a / 255.0, green: 0x0c / 255.0, blue: 0x11 / 255.0, alpha: 1)

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    var window: NSWindow!
    var web: WKWebView!
    var status: NSTextField!
    var waited = 0
    var server: Process? // ours, when there is no background server

    func applicationDidFinishLaunching(_ note: Notification) {
        buildMenu()
        let conf = WKWebViewConfiguration()
        conf.websiteDataStore = .default() // keeps settings / localStorage between launches
        conf.mediaTypesRequiringUserActionForPlayback = []
        conf.preferences.isElementFullscreenEnabled = true
        web = WKWebView(frame: .zero, configuration: conf)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.allowsBackForwardNavigationGestures = true
        web.underPageBackgroundColor = background
        web.setValue(false, forKey: "drawsBackground") // no white flash before the page paints
        web.isHidden = true

        status = NSTextField(labelWithString: "TabGen başlatılıyor…")
        status.textColor = .secondaryLabelColor
        status.font = .systemFont(ofSize: 14)
        status.alignment = .center

        let root = NSView()
        root.wantsLayer = true
        root.layer?.backgroundColor = background.cgColor
        for v in [web!, status!] as [NSView] {
            v.translatesAutoresizingMaskIntoConstraints = false
            root.addSubview(v)
        }
        NSLayoutConstraint.activate([
            web.leadingAnchor.constraint(equalTo: root.leadingAnchor), web.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            web.topAnchor.constraint(equalTo: root.topAnchor), web.bottomAnchor.constraint(equalTo: root.bottomAnchor),
            status.centerXAnchor.constraint(equalTo: root.centerXAnchor), status.centerYAnchor.constraint(equalTo: root.centerYAnchor),
            status.widthAnchor.constraint(lessThanOrEqualTo: root.widthAnchor, constant: -48),
        ])

        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 820),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                          backing: .buffered, defer: false)
        window.title = "TabGen"
        window.titlebarAppearsTransparent = true
        window.backgroundColor = background
        window.appearance = NSAppearance(named: .darkAqua)
        window.minSize = NSSize(width: 380, height: 560)
        window.contentView = root
        window.setFrameAutosaveName("TabGenMain")
        if !window.setFrameUsingName("TabGenMain") { window.center() }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        waitForServer()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { true }

    func applicationWillTerminate(_ note: Notification) { stopServer() }

    // MARK: server

    /// Poll the API until it answers; nudge the LaunchAgent if it is not up after a few seconds.
    func waitForServer() {
        var req = URLRequest(url: serverURL.appendingPathComponent("v1/config"))
        req.timeoutInterval = 2
        URLSession.shared.dataTask(with: req) { _, resp, _ in
            DispatchQueue.main.async {
                if (resp as? HTTPURLResponse)?.statusCode == 200 {
                    self.web.load(URLRequest(url: serverURL))
                    return
                }
                self.waited += 1
                if self.waited == 1 { self.startServer() }
                if self.waited == 90 {
                    self.status.stringValue = "Sunucu açılamadı.\nKayıt: data/logs/server.log"
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + 1) { self.waitForServer() }
            }
        }.resume()
    }

    func startServer(restart: Bool = false) {
        if agentInstalled {
            let p = Process()
            p.executableURL = URL(fileURLWithPath: "/bin/launchctl")
            p.arguments = ["kickstart"] + (restart ? ["-k"] : []) + ["gui/\(getuid())/\(agentLabel)"]
            try? p.run()
            return
        }
        if restart { stopServer() }
        guard server?.isRunning != true else { return }
        let logs = URL(fileURLWithPath: repoRoot).appendingPathComponent("data/logs")
        try? FileManager.default.createDirectory(at: logs, withIntermediateDirectories: true)
        let log = logs.appendingPathComponent("server.log")
        FileManager.default.createFile(atPath: log.path, contents: nil)
        let p = Process()
        p.executableURL = URL(fileURLWithPath: repoRoot + "/scripts/run.sh")
        p.currentDirectoryURL = URL(fileURLWithPath: repoRoot)
        var env = ProcessInfo.processInfo.environment
        env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
        env["NO_BROWSER"] = "1"
        env["PORT"] = String(serverURL.port ?? 8000)
        env["HOST"] = Bundle.main.object(forInfoDictionaryKey: "TabGenHost") as? String ?? "127.0.0.1"
        p.environment = env
        if let h = try? FileHandle(forWritingTo: log) { p.standardOutput = h; p.standardError = h }
        do { try p.run(); server = p } catch {
            status.stringValue = "Sunucu başlatılamadı: \(error.localizedDescription)"
        }
    }

    func stopServer() {
        guard let p = server, p.isRunning else { return }
        p.terminate() // run.sh execs uvicorn, so this is the server itself
        p.waitUntilExit()
        server = nil
    }

    @objc func restartServer(_ sender: Any?) {
        web.isHidden = true
        status.isHidden = false
        status.stringValue = "TabGen yeniden başlatılıyor…"
        waited = 0
        startServer(restart: true)
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { self.waitForServer() }
    }

    @objc func openInBrowser(_ sender: Any?) { NSWorkspace.shared.open(web.url ?? serverURL) }
    @objc func reload(_ sender: Any?) { web.reload() }
    @objc func zoomIn(_ sender: Any?) { web.pageZoom = min(2, web.pageZoom + 0.1) }
    @objc func zoomOut(_ sender: Any?) { web.pageZoom = max(0.5, web.pageZoom - 0.1) }
    @objc func zoomReset(_ sender: Any?) { web.pageZoom = 1 }
    @objc func goBack(_ sender: Any?) { web.goBack() }
    @objc func goForward(_ sender: Any?) { web.goForward() }

    // MARK: navigation

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        status.isHidden = true
        web.isHidden = false
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { retry(error) }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { retry(error) }

    func retry(_ error: Error) {
        if (error as NSError).code == NSURLErrorCancelled { return }
        web.isHidden = true
        status.isHidden = false
        status.stringValue = "Sunucuya bağlanılıyor…"
        waited = 0
        waitForServer()
    }

    /// Our pages stay in the window; anything else (YouTube, docs links) opens in the browser.
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if action.shouldPerformDownload { return decisionHandler(.download) }
        if let url = action.request.url, let host = url.host, host != serverURL.host, url.scheme?.hasPrefix("http") == true,
           action.targetFrame?.isMainFrame != false {
            NSWorkspace.shared.open(url)
            return decisionHandler(.cancel)
        }
        decisionHandler(.allow)
    }

    /// Exports (MusicXML, Guitar Pro, MIDI) come back as attachments: save them to Downloads.
    func webView(_ webView: WKWebView, decidePolicyFor resp: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        let disp = (resp.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition") ?? ""
        if disp.lowercased().hasPrefix("attachment") || !resp.canShowMIMEType { return decisionHandler(.download) }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String,
                  completionHandler: @escaping (URL?) -> Void) {
        let dir = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask)[0]
        var dest = dir.appendingPathComponent(suggestedFilename)
        let base = dest.deletingPathExtension().lastPathComponent
        let ext = dest.pathExtension
        var i = 2
        while FileManager.default.fileExists(atPath: dest.path) {
            dest = dir.appendingPathComponent("\(base) \(i)").appendingPathExtension(ext)
            i += 1
        }
        completionHandler(dest)
    }

    func downloadDidFinish(_ download: WKDownload) {
        // show the exported file, like a browser's download bar would
        if let url = download.progress.fileURL { NSWorkspace.shared.activateFileViewerSelecting([url]) }
    }

    // MARK: UI delegate: new windows, file picker, microphone, alerts

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url {
            if url.host == serverURL.host { webView.load(action.request) } else { NSWorkspace.shared.open(url) }
        }
        return nil
    }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.beginSheetModal(for: window) { r in completionHandler(r == .OK ? panel.urls : nil) }
    }

    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
                 decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        // only our own page, only the microphone; macOS still asks the user once (Info.plist text)
        guard origin.host == serverURL.host, type == .microphone else { return decisionHandler(.deny) }
        AVCaptureDevice.requestAccess(for: .audio) { ok in
            DispatchQueue.main.async { decisionHandler(ok ? .grant : .deny) }
        }
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = NSAlert()
        a.messageText = message
        a.beginSheetModal(for: window) { _ in completionHandler() }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let a = NSAlert()
        a.messageText = message
        a.addButton(withTitle: "Tamam")
        a.addButton(withTitle: "Vazgeç")
        a.beginSheetModal(for: window) { r in completionHandler(r == .alertFirstButtonReturn) }
    }

    // MARK: menus (without an Edit menu, ⌘C / ⌘V do nothing in a WKWebView)

    func buildMenu() {
        let main = NSMenu()
        func menu(_ title: String, _ items: [NSMenuItem]) {
            let m = NSMenu(title: title)
            items.forEach(m.addItem)
            let host = NSMenuItem()
            host.submenu = m
            main.addItem(host)
        }
        func item(_ t: String, _ a: Selector?, _ k: String, _ mods: NSEvent.ModifierFlags = .command) -> NSMenuItem {
            let i = NSMenuItem(title: t, action: a, keyEquivalent: k)
            i.keyEquivalentModifierMask = mods
            return i
        }
        menu("TabGen", [
            item("TabGen Hakkında", #selector(NSApplication.orderFrontStandardAboutPanel(_:)), ""),
            .separator(),
            item("Sunucuyu yeniden başlat", #selector(restartServer(_:)), "r", [.command, .shift]),
            item("Tarayıcıda aç", #selector(openInBrowser(_:)), "o", [.command, .shift]),
            .separator(),
            item("TabGen'i gizle", #selector(NSApplication.hide(_:)), "h"),
            item("TabGen'den çık", #selector(NSApplication.terminate(_:)), "q"),
        ])
        menu("Düzen", [
            item("Geri al", Selector(("undo:")), "z"),
            item("Yinele", Selector(("redo:")), "z", [.command, .shift]),
            .separator(),
            item("Kes", #selector(NSText.cut(_:)), "x"),
            item("Kopyala", #selector(NSText.copy(_:)), "c"),
            item("Yapıştır", #selector(NSText.paste(_:)), "v"),
            item("Tümünü seç", #selector(NSText.selectAll(_:)), "a"),
        ])
        menu("Görünüm", [
            item("Yenile", #selector(reload(_:)), "r"),
            item("Geri", #selector(goBack(_:)), "["),
            item("İleri", #selector(goForward(_:)), "]"),
            .separator(),
            item("Büyüt", #selector(zoomIn(_:)), "+"),
            item("Küçült", #selector(zoomOut(_:)), "-"),
            item("Gerçek boyut", #selector(zoomReset(_:)), "0"),
            .separator(),
            item("Tam ekran", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control]),
        ])
        menu("Pencere", [
            item("Küçült", #selector(NSWindow.performMiniaturize(_:)), "m"),
            item("Kapat", #selector(NSWindow.performClose(_:)), "w"),
        ])
        NSApp.mainMenu = main
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
