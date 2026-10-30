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
let toneTest = CommandLine.arguments.contains("--tone-selftest")
var tonePhase = 0.0
let repoRoot = Bundle.main.object(forInfoDictionaryKey: "TabGenRoot") as? String ?? ""
let agentInstalled = FileManager.default.fileExists(
    atPath: NSHomeDirectory() + "/Library/LaunchAgents/\(agentLabel).plist")
let background = NSColor(red: 0x0a / 255.0, green: 0x0c / 255.0, blue: 0x11 / 255.0, alpha: 1)

/// data/logs/app.log: what the page and the microphone did, so a "the mic doesn't work" report
/// can be answered from facts (page errors, getUserMedia results, macOS permission state).
func appLog(_ line: String) {
    guard !repoRoot.isEmpty else { return }
    let url = URL(fileURLWithPath: repoRoot).appendingPathComponent("data/logs/app.log")
    let stamp = ISO8601DateFormatter().string(from: Date())
    let data = Data("\(stamp) \(line)\n".utf8)
    if let h = try? FileHandle(forWritingTo: url) {
        h.seekToEndOfFile(); h.write(data); try? h.close()
    } else {
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? data.write(to: url)
    }
}

/// Forwards page errors and every microphone request's outcome to appLog.
let pageProbe = """
(() => {
  const send = (kind, msg) => { try { window.webkit.messageHandlers.tabgen.postMessage(kind + ' ' + String(msg).slice(0, 500)) } catch (e) {} }
  window.addEventListener('error', (e) => send('error', e.message + ' @' + (e.filename || '') + ':' + (e.lineno || '')))
  window.addEventListener('unhandledrejection', (e) => send('rejection', (e.reason && (e.reason.name + ': ' + e.reason.message)) || e.reason))
  const ce = console.error.bind(console)
  console.error = (...a) => { send('console', a.join(' ')); ce(...a) }
  const md = navigator.mediaDevices
  send('page', location.hash + ' secure=' + window.isSecureContext + ' mediaDevices=' + !!md)
  if (window.MediaDevices && MediaDevices.prototype.getUserMedia) {
    const gum = MediaDevices.prototype.getUserMedia
    MediaDevices.prototype.getUserMedia = async function (c) {
      try {
        const s = await gum.call(this, c)
        const t = s.getAudioTracks()[0]
        send('mic', 'ok ' + (t ? t.label + ' ' + t.readyState + ' muted=' + t.muted : 'no audio track'))
        return s
      } catch (e) { send('mic', 'FAILED ' + e.name + ': ' + e.message); throw e }
    }
  }
  const MR = window.MediaRecorder
  if (MR) window.MediaRecorder = class extends MR {
    constructor(...a) {
      super(...a); let bytes = 0, parts = 0
      send('rec', 'new ' + (this.mimeType || '(no type)'))
      this.addEventListener('dataavailable', (e) => { bytes += e.data.size; parts++ })
      this.addEventListener('error', (e) => send('rec', 'ERROR ' + (e.error && e.error.name)))
      this.addEventListener('stop', () => send('rec', 'stop ' + parts + ' parts ' + bytes + ' bytes ' + (this.mimeType || '')))
    }
  }
  // Microphone through the app (AVAudioEngine), not WebKit's capture: in this app WebKit opened
  // the device but delivered no samples (silent tuner, 0-byte recordings). The page gets an
  // ordinary MediaStream, fed from native PCM through an AudioWorklet.
  if (window.MediaDevices && MediaDevices.prototype.getUserMedia) {
    const pending = []
    let live = null // { ctx, node, dest, users }
    const worklet = `class P extends AudioWorkletProcessor {
      constructor() { super(); this.q = []; this.off = 0
        this.port.onmessage = (e) => { this.q.push(e.data); if (this.q.length > 40) this.q.splice(0, this.q.length - 8) } }
      process(_i, outs) { const o = outs[0][0]; let i = 0
        while (i < o.length && this.q.length) { const b = this.q[0]; const n = Math.min(o.length - i, b.length - this.off)
          o.set(b.subarray(this.off, this.off + n), i); i += n; this.off += n; if (this.off >= b.length) { this.q.shift(); this.off = 0 } }
        for (let c = 1; c < outs[0].length; c++) outs[0][c].set(o); return true } }
      registerProcessor('tabgen-mic', P)`
    const streamFor = (L) => {
      L.users++
      const s = new MediaStream(L.dest.stream.getAudioTracks().map((t) => t.clone()))
      s.getAudioTracks().forEach((t) => { const stop = t.stop.bind(t); t.stop = () => { stop(); if (--L.users <= 0) { send('mic', 'native stop'); window.webkit.messageHandlers.tabgenMic.postMessage('stop'); L.ctx.close(); live = null } } })
      return s
    }
    window.__tabgenMic = {
      async started(sr) {
        try {
          const ctx = new AudioContext({ sampleRate: sr })
          ctx.resume()
          await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([worklet], { type: 'text/javascript' })))
          const node = new AudioWorkletNode(ctx, 'tabgen-mic', { numberOfInputs: 0, outputChannelCount: [1] })
          const dest = ctx.createMediaStreamDestination(); node.connect(dest)
          live = { ctx, node, dest, users: 0 }
          send('mic', 'native ok ' + sr + 'Hz ctx=' + ctx.state)
          pending.splice(0).forEach((p) => p.resolve(streamFor(live)))
        } catch (e) { this.failed('worklet: ' + e) }
      },
      push(b64) {
        if (!live) return
        const bin = atob(b64); const u = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i)
        const f = new Float32Array(u.buffer); live.node.port.postMessage(f, [f.buffer])
      },
      failed(reason) {
        send('mic', 'native FAILED ' + reason)
        const name = /denied|refused/.test(reason) ? 'NotAllowedError' : /no input|device/.test(reason) ? 'NotFoundError' : 'NotReadableError'
        pending.splice(0).forEach((p) => p.reject(new DOMException(reason, name)))
      },
    }
    const viaWebKit = MediaDevices.prototype.getUserMedia
    MediaDevices.prototype.getUserMedia = function (c) {
      if (!c || !c.audio || c.video) return viaWebKit.call(this, c)
      if (live) return Promise.resolve(streamFor(live))
      return new Promise((resolve, reject) => {
        pending.push({ resolve, reject })
        if (pending.length === 1) window.webkit.messageHandlers.tabgenMic.postMessage('start')
      })
    }
  }
  // a context made before the first click stays suspended (no sound in, none out): wake every one
  const contexts = []
  const wake = () => contexts.forEach((c) => { if (c.state === 'suspended') c.resume() })
  window.addEventListener('pointerdown', wake, true)
  window.addEventListener('keydown', wake, true)
  const AC = window.AudioContext
  if (AC) window.AudioContext = class extends AC {
    constructor(...a) { super(...a); contexts.push(this); send('audio', 'context ' + this.state + ' ' + this.sampleRate + 'Hz')
      this.addEventListener('statechange', () => send('audio', 'context -> ' + this.state)) }
  }
})()
"""

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate,
    WKScriptMessageHandler {
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
        conf.applicationNameForUserAgent = "Version/17.0 Safari/605.1.15 TabGenMac/1" // lib/mic.ts reads this
        conf.userContentController.addUserScript(
            WKUserScript(source: pageProbe, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        conf.userContentController.add(self, name: "tabgen")
        conf.userContentController.add(self, name: "tabgenMic")
        appLog("launch mic-permission=\(micStatus())")
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

    func applicationWillTerminate(_ note: Notification) { stopMic(); stopServer() }

    // MARK: server

    /// Poll the API until it answers; nudge the LaunchAgent if it is not up after a few seconds.
    func waitForServer() {
        var req = URLRequest(url: serverURL.appendingPathComponent("v1/config"))
        req.timeoutInterval = 2
        URLSession.shared.dataTask(with: req) { _, resp, _ in
            DispatchQueue.main.async {
                if (resp as? HTTPURLResponse)?.statusCode == 200 {
                    // never a cached index.html: after an update it would load the old app
                    self.web.load(URLRequest(url: serverURL, cachePolicy: .reloadIgnoringLocalCacheData))
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
        env["PYTHONUNBUFFERED"] = "1" // data/logs/server.log shows requests as they happen
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
        if CommandLine.arguments.contains("--mic-selftest") || toneTest { micSelfTest() }
    }

    /// `open TabGen.app --args --mic-selftest`: record 3 s from the microphone inside the page the
    /// way the tuner and the recorder do, write what arrived to data/logs/app.log, then quit.
    func micSelfTest() {
        let js = """
        const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
        const ctx = new AudioContext(); const before = ctx.state; await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 1000))])
        const an = ctx.createAnalyser(); ctx.createMediaStreamSource(s).connect(an)
        const mr = new MediaRecorder(s); let bytes = 0; mr.ondataavailable = (e) => { bytes += e.data.size }; mr.start(500)
        an.fftSize = 4096
        const buf = new Float32Array(4096); let peak = 0; const t0 = performance.now(); const hz = []; let silent = 0, gaps = 0, n = 0
        while (performance.now() - t0 < 3000) {
          an.getFloatTimeDomainData(buf); n++
          let e = 0; for (const v of buf) { peak = Math.max(peak, Math.abs(v)); e += v * v }
          if (Math.sqrt(e / buf.length) < 0.005) silent++
          let run = 0; for (const v of buf) { run = Math.abs(v) < 1e-6 ? run + 1 : 0; if (run === 64) gaps++ }
          let best = 0, lag = 0; for (let L = 40; L < 800; L++) { let c = 0; for (let i = 0; i + L < 2048; i++) c += buf[i] * buf[i + L]; if (c > best) { best = c; lag = L } }
          if (lag) hz.push(ctx.sampleRate / lag)
          await new Promise((r) => setTimeout(r, 100))
        }
        hz.sort((a, b) => a - b)
        const stopped = new Promise((r) => { mr.onstop = r }); mr.stop(); await stopped
        s.getTracks().forEach((t) => t.stop())
        return JSON.stringify({ ctxBefore: before, ctxAfter: ctx.state, peak, recordedBytes: bytes, type: mr.mimeType,
          snapshots: n, silent, dropouts: gaps, medianHz: hz[hz.length >> 1], minHz: hz[0], maxHz: hz[hz.length - 1] })
        """
        web.callAsyncJavaScript(js, arguments: [:], in: nil, in: .page) { r in
            switch r {
            case .success(let v): appLog("selftest: \(v ?? "nil")")
            case .failure(let e): appLog("selftest FAILED: \(e)")
            }
            NSApp.terminate(nil)
        }
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
        appLog("mic request from \(origin.host) type=\(type.rawValue) permission=\(micStatus())")
        guard origin.host == serverURL.host, type == .microphone else { return decisionHandler(.deny) }
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized:
            decisionHandler(.grant)
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .audio) { ok in
                appLog("macOS asked for the mic: \(ok ? "allowed" : "refused")")
                DispatchQueue.main.async {
                    decisionHandler(ok ? .grant : .deny)
                    if !ok { self.micDeniedAlert() }
                }
            }
        default: // refused earlier (or by a profile): macOS will not ask again, so say where to fix it
            decisionHandler(.deny)
            micDeniedAlert()
        }
    }

    func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "tabgenMic" {
            if message.body as? String == "start" { startMic() } else { stopMic() }
            return
        }
        appLog("page: \(message.body)")
    }

    // MARK: microphone (native capture, fed to the page by the script above)

    let engine = AVAudioEngine()
    var micRunning = false

    func startMic() {
        appLog("native mic start, permission=\(micStatus())")
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized:
            runEngine()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .audio) { ok in
                appLog("macOS asked for the mic: \(ok ? "allowed" : "refused")")
                DispatchQueue.main.async {
                    if ok { self.runEngine() } else { self.micFailed("denied"); self.micDeniedAlert() }
                }
            }
        default:
            micFailed("denied")
            micDeniedAlert()
        }
    }

    func runEngine() {
        if micRunning { return web.evaluateJavaScript("__tabgenMic.started(\(engine.inputNode.outputFormat(forBus: 0).sampleRate))") }
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.channelCount > 0, format.sampleRate > 0 else { return micFailed("no input device") }
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buf, _ in
            guard let ch = buf.floatChannelData, buf.frameLength > 0 else { return }
            let n = Int(buf.frameLength)
            var mono = [Float](repeating: 0, count: n)
            let chans = Int(buf.format.channelCount)
            for c in 0..<chans { for i in 0..<n { mono[i] += ch[c][i] / Float(chans) } }
            if toneTest { // --tone-selftest: a steady 110 Hz (open A) instead of the room
                let sr = buf.format.sampleRate
                for i in 0..<n { mono[i] = 0.3 * Float(sin(tonePhase)); tonePhase += 2 * .pi * 110 / sr }
                tonePhase = tonePhase.truncatingRemainder(dividingBy: 2 * .pi)
            }
            let b64 = mono.withUnsafeBufferPointer { Data(buffer: $0) }.base64EncodedString()
            DispatchQueue.main.async { self?.web.evaluateJavaScript("__tabgenMic.push('\(b64)')") }
        }
        do {
            engine.prepare()
            try engine.start()
            micRunning = true
            appLog("native mic running \(format.sampleRate)Hz \(format.channelCount)ch")
            web.evaluateJavaScript("__tabgenMic.started(\(format.sampleRate))")
        } catch {
            input.removeTap(onBus: 0)
            micFailed("start: \(error.localizedDescription)")
        }
    }

    func stopMic() {
        guard micRunning else { return }
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        micRunning = false
        appLog("native mic stopped")
    }

    func micFailed(_ reason: String) {
        appLog("native mic failed: \(reason)")
        web.evaluateJavaScript("__tabgenMic.failed(\(String(reflecting: reason)))")
    }

    func micStatus() -> String {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: return "allowed"
        case .denied: return "denied"
        case .restricted: return "restricted"
        case .notDetermined: return "not-asked-yet"
        @unknown default: return "unknown"
        }
    }

    func micDeniedAlert() {
        let a = NSAlert()
        a.messageText = "Mikrofon izni kapalı"
        a.informativeText = "Akort, birlikte çal ve kayıt için TabGen'in mikrofonu duyması gerekiyor. "
            + "Sistem Ayarları → Gizlilik ve Güvenlik → Mikrofon'da TabGen'i aç, sonra TabGen'i yeniden başlat."
        a.addButton(withTitle: "Ayarları aç")
        a.addButton(withTitle: "Vazgeç")
        a.beginSheetModal(for: window) { r in
            if r == .alertFirstButtonReturn,
               let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone") {
                NSWorkspace.shared.open(url)
            }
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
