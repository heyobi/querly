import UIKit
import Capacitor
import QuickLook

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = QuerlyViewController()
        window?.makeKeyAndVisible()

        // A file tapped in Files (Open With › Querly) or shared to Querly while the app was closed.
        IncomingFiles.accept(connectionOptions.urlContexts.map { $0.url }.filter { $0.isFileURL })
        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        IncomingFiles.accept(URLContexts.map { $0.url }.filter { $0.isFileURL })
        let others = URLContexts.filter { !$0.url.isFileURL }
        if !others.isEmpty { SceneDelegateProxy.shared.scene(scene, openURLContexts: others) }
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}

/// The Capacitor web view plus Querly's own native plugins.
class QuerlyViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(SaveToFilesPlugin())
        bridge?.registerPluginInstance(IncomingFilesPlugin())
        bridge?.registerPluginInstance(QuickLookPlugin())
    }
}

/// Files opened from other apps. Querly declares LSSupportsOpeningDocumentsInPlace, so iOS lists it under
/// Files › Open With and hands over the original file (often outside our sandbox, maybe still in iCloud).
/// We copy it into Caches/Incoming right away; the web app imports the copy and deletes it.
enum IncomingFiles {
    private static var pending: [String] = []
    static weak var plugin: IncomingFilesPlugin?

    static func accept(_ urls: [URL]) {
        guard !urls.isEmpty else { return }
        DispatchQueue.global(qos: .userInitiated).async {
            let copies = urls.compactMap(copyIn)
            DispatchQueue.main.async {
                pending.append(contentsOf: copies.map { $0.absoluteString })
                plugin?.announce()
            }
        }
    }

    static func take() -> [String] {
        let out = pending
        pending = []
        return out
    }

    private static func copyIn(_ url: URL) -> URL? {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let fm = FileManager.default
        guard let caches = fm.urls(for: .cachesDirectory, in: .userDomainMask).first else { return nil }
        let folder = caches.appendingPathComponent("Incoming/\(UUID().uuidString)", isDirectory: true)
        let dest = folder.appendingPathComponent(url.lastPathComponent)
        var copied = false
        var coordError: NSError?
        // The coordinator downloads iCloud files first and waits for other apps that are writing to it.
        NSFileCoordinator().coordinate(readingItemAt: url, options: .withoutChanges, error: &coordError) { src in
            do {
                try fm.createDirectory(at: folder, withIntermediateDirectories: true)
                try fm.copyItem(at: src, to: dest)
                copied = true
            } catch {
                NSLog("Querly: could not copy incoming file: \(error)")
            }
        }
        // Files iOS already copied into our Inbox are ours to clean up.
        if copied, url.path.contains("/Inbox/") { try? fm.removeItem(at: url) }
        return copied ? dest : nil
    }
}

@objc(IncomingFilesPlugin)
public class IncomingFilesPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "IncomingFilesPlugin"
    public let jsName = "IncomingFiles"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "take", returnType: CAPPluginReturnPromise)
    ]

    override public func load() {
        IncomingFiles.plugin = self
    }

    func announce() {
        notifyListeners("available", data: [:], retainUntilConsumed: true)
    }

    @objc func take(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            call.resolve(["urls": IncomingFiles.take()])
        }
    }
}

/// "Save to Files": shows the system folder picker in export mode for a file the web app wrote to the cache folder.
/// Choosing the folder the original came from replaces it after iOS asks.
@objc(SaveToFilesPlugin)
public class SaveToFilesPlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
    public let identifier = "SaveToFilesPlugin"
    public let jsName = "SaveToFiles"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "save", returnType: CAPPluginReturnPromise)
    ]
    private var pending: CAPPluginCall?

    @objc func save(_ call: CAPPluginCall) {
        guard let path = call.getString("path"), let url = URL(string: path), url.isFileURL else {
            call.reject("A file URL is required")
            return
        }
        DispatchQueue.main.async {
            guard let vc = self.bridge?.viewController else { call.reject("No view controller"); return }
            self.pending?.resolve(["saved": false])
            self.pending = call
            let picker = UIDocumentPickerViewController(forExporting: [url], asCopy: true)
            picker.delegate = self
            vc.present(picker, animated: true)
        }
    }

    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        pending?.resolve(["saved": true])
        pending = nil
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        pending?.resolve(["saved": false])
        pending = nil
    }
}

/// Quick Look preview for files that are not tables: pictures, PDF, Office and iWork documents, audio, video…
/// The same preview the Files app shows, with its own share button.
@objc(QuickLookPlugin)
public class QuickLookPlugin: CAPPlugin, CAPBridgedPlugin, QLPreviewControllerDataSource, QLPreviewControllerDelegate {
    public let identifier = "QuickLookPlugin"
    public let jsName = "QuickLook"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "preview", returnType: CAPPluginReturnPromise)
    ]
    private var url: URL?
    private var pending: CAPPluginCall?

    @objc func preview(_ call: CAPPluginCall) {
        guard let path = call.getString("path"), let url = URL(string: path), url.isFileURL else {
            call.reject("A file URL is required")
            return
        }
        DispatchQueue.main.async {
            guard let vc = self.bridge?.viewController else { call.reject("No view controller"); return }
            self.pending?.resolve()
            self.pending = call
            self.url = url
            let ql = QLPreviewController()
            ql.dataSource = self
            ql.delegate = self
            vc.present(ql, animated: true)
        }
    }

    public func numberOfPreviewItems(in controller: QLPreviewController) -> Int { url == nil ? 0 : 1 }

    public func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem {
        (url ?? URL(fileURLWithPath: "/")) as NSURL
    }

    public func previewControllerDidDismiss(_ controller: QLPreviewController) {
        pending?.resolve()
        pending = nil
    }
}
