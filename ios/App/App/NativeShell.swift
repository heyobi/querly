import UIKit
import SwiftUI
import Capacitor
import QuickLookThumbnailing
import UniformTypeIdentifiers

// Querly's native shell: a system tab bar and a SwiftUI Files screen on top of the Capacitor web view.
//
// The web app stays in charge of routing. It reports a mode through the NativeShell plugin:
//   "files" – the Files tab: the SwiftUI list covers the web view, the tab bar shows
//   "tab"   – Analyze or Settings: the web view shows through, with the system tab bar over it
//   "full"  – a web screen that needs the whole display (table viewer, notebook, paywall, dialogs)
//   "web"   – no shell (before the web app has started): the web view alone
// The native side reports tab taps and file actions back as plugin events.

// MARK: - Model

struct FileItem: Identifiable, Equatable {
    var id: String { name }
    let name: String
    let size: Int64
    let mtime: Date
    let badge: String
    let rows: Int?
    let cols: Int?
    let columns: [String]
    let pro: Bool
    let analyze: Bool
}

struct ShellToast: Identifiable, Equatable {
    let id = UUID()
    let text: String
    let error: Bool
}

final class FilesModel: ObservableObject {
    static let shared = FilesModel()
    @Published var files: [FileItem] = []
    @Published var labels: [String: String] = [:]
    @Published var toast: ShellToast?
    weak var shell: ShellViewController?

    func t(_ s: String) -> String { labels[s] ?? s }

    func send(_ action: String, _ name: String, _ arg: String = "") {
        NativeShellPlugin.shared?.emit("action", ["action": action, "name": name, "arg": arg])
    }

    static var dataFolder: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("Data", isDirectory: true)
    }

    static func url(of name: String) -> URL { dataFolder.appendingPathComponent(name) }
}

// MARK: - Shell view controller

/// Lets touches through to the web view underneath, except on the tab bar and the native Files screen.
final class PassthroughView: UIView {
    var allowed: (UIView) -> Bool = { _ in true }
    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        guard let v = super.hitTest(point, with: event) else { return nil }
        return allowed(v) ? v : nil
    }
}

/// The Analyze and Settings tabs have no native content: the web view shows through them.
final class ClearViewController: UIViewController {
    override func loadView() {
        view = UIView()
        view.backgroundColor = .clear
    }
}

final class ShellViewController: UIViewController, UITabBarControllerDelegate, UIDocumentPickerDelegate {
    let bridgeVC = QuerlyViewController()
    let tabs = UITabBarController()
    private let wrap = PassthroughView()
    private lazy var filesNav: UIViewController = UIHostingController(rootView: NavigationStack { FilesView(model: FilesModel.shared) })
    private let analyzeVC = ClearViewController()
    private let settingsVC = ClearViewController()
    private(set) var mode = "web"

    override var childForStatusBarStyle: UIViewController? { mode == "files" ? nil : bridgeVC }
    override var childForStatusBarHidden: UIViewController? { bridgeVC }
    override var preferredStatusBarStyle: UIStatusBarStyle { .default }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        FilesModel.shared.shell = self

        addChild(bridgeVC)
        bridgeVC.view.frame = view.bounds
        bridgeVC.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(bridgeVC.view)
        bridgeVC.didMove(toParent: self)

        filesNav.tabBarItem = UITabBarItem(title: "Files", image: UIImage(systemName: "folder"), selectedImage: UIImage(systemName: "folder.fill"))
        analyzeVC.tabBarItem = UITabBarItem(title: "Analyze", image: UIImage(systemName: "chart.xyaxis.line"), tag: 1)
        settingsVC.tabBarItem = UITabBarItem(title: "Settings", image: UIImage(systemName: "gearshape"), selectedImage: UIImage(systemName: "gearshape.fill"))
        tabs.viewControllers = [filesNav, analyzeVC, settingsVC]
        tabs.delegate = self
        tabs.view.backgroundColor = .clear
        // iPad and the open iPhone Duo would put the tab bar at the top or in a sidebar, over the web view.
        // A compact width keeps the system tab bar at the bottom, where the web pages leave room for it.
        if #available(iOS 17.0, *) { tabs.traitOverrides.horizontalSizeClass = .compact }
        if #unavailable(iOS 26.0) {
            // Over a web view there is no scroll view to track: keep the bar's blur at all times.
            let a = UITabBarAppearance()
            a.configureWithDefaultBackground()
            tabs.tabBar.standardAppearance = a
            tabs.tabBar.scrollEdgeAppearance = a
        }

        wrap.frame = view.bounds
        wrap.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        wrap.backgroundColor = .clear
        wrap.allowed = { [weak self] v in
            guard let self else { return false }
            return v.isDescendant(of: self.tabs.tabBar) || (self.mode == "files" && v.isDescendant(of: self.filesNav.view))
        }
        view.addSubview(wrap)
        addChild(tabs)
        tabs.view.frame = wrap.bounds
        tabs.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        wrap.addSubview(tabs.view)
        tabs.didMove(toParent: self)
        wrap.isHidden = true

        // iPhone Duo: an invisible SwiftUI view, behind everything, reports the hinge and the fold's position to the web app.
        if #available(iOS 27.1, *) {
            let probe = UIHostingController(rootView: FoldProbe())
            probe.view.isUserInteractionEnabled = false
            probe.view.backgroundColor = .clear
            probe.view.frame = view.bounds
            probe.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            addChild(probe)
            view.insertSubview(probe.view, at: 0)
            probe.didMove(toParent: self)
        }
    }

    /// Called by the web app whenever its screen changes.
    func apply(mode: String, tab: String, theme: String) {
        self.mode = mode
        wrap.isHidden = mode == "full" || mode == "web"
        if mode == "files" {
            select(filesNav)
        } else if mode == "tab" {
            select(tab == "settings" ? settingsVC : tab == "notebooks" ? analyzeVC : filesNav)
        }
        let style: UIUserInterfaceStyle = theme == "dark" ? .dark : theme == "light" ? .light : .unspecified
        if view.window?.overrideUserInterfaceStyle != style { view.window?.overrideUserInterfaceStyle = style }
        setNeedsStatusBarAppearanceUpdate()
    }

    func updateTitles() {
        let m = FilesModel.shared
        filesNav.tabBarItem.title = m.t("Files")
        analyzeVC.tabBarItem.title = m.t("Analyze")
        settingsVC.tabBarItem.title = m.t("Settings")
    }

    private func select(_ vc: UIViewController) {
        if tabs.selectedViewController !== vc { tabs.selectedViewController = vc }
    }

    func tabBarController(_ tabBarController: UITabBarController, didSelect viewController: UIViewController) {
        let tab = viewController === filesNav ? "files" : viewController === analyzeVC ? "notebooks" : "settings"
        if tab == "files" { mode = "files" }
        NativeShellPlugin.shared?.emit("tab", ["tab": tab])
    }

    // MARK: actions that stay native

    func pickFiles() {
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.item], asCopy: true)
        picker.allowsMultipleSelection = true
        picker.delegate = self
        present(picker, animated: true)
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        // Same path as Open With › Querly: copied in, then imported and opened by the web app.
        IncomingFiles.accept(urls)
    }

    func share(_ name: String) {
        let url = FilesModel.url(of: name)
        guard FileManager.default.fileExists(atPath: url.path) else { return }
        let vc = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        vc.popoverPresentationController?.sourceView = view
        present(vc, animated: true)
    }
}

// MARK: - Plugin

@objc(NativeShellPlugin)
public class NativeShellPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeShellPlugin"
    public let jsName = "NativeShell"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setMode", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setFiles", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "toast", returnType: CAPPluginReturnPromise)
    ]
    static weak var shared: NativeShellPlugin?

    override public func load() {
        NativeShellPlugin.shared = self
    }

    func emit(_ event: String, _ data: [String: Any]) {
        notifyListeners(event, data: data)
    }

    @objc func setMode(_ call: CAPPluginCall) {
        let mode = call.getString("mode") ?? "web"
        let tab = call.getString("tab") ?? "files"
        let theme = call.getString("theme") ?? "system"
        DispatchQueue.main.async {
            guard let shell = FilesModel.shared.shell else { call.reject("No shell"); return }
            shell.apply(mode: mode, tab: tab, theme: theme)
            call.resolve(["native": true])
        }
    }

    @objc func setFiles(_ call: CAPPluginCall) {
        let raw = call.options?["files"] as? [[String: Any]] ?? []
        let labels = call.options?["labels"] as? [String: String] ?? [:]
        func num(_ v: Any?) -> Double? { (v as? NSNumber)?.doubleValue }
        let items: [FileItem] = raw.compactMap { d in
            guard let name = d["name"] as? String else { return nil }
            let rows = num(d["rows"]).map { Int($0) }
            let cols = num(d["cols"]).map { Int($0) }
            return FileItem(
                name: name,
                size: Int64(num(d["size"]) ?? 0),
                mtime: Date(timeIntervalSince1970: (num(d["mtime"]) ?? 0) / 1000),
                badge: d["badge"] as? String ?? "",
                rows: (rows ?? -1) >= 0 ? rows : nil,
                cols: (cols ?? -1) > 0 ? cols : nil,
                columns: d["columns"] as? [String] ?? [],
                pro: d["pro"] as? Bool ?? false,
                analyze: d["analyze"] as? Bool ?? false)
        }
        DispatchQueue.main.async {
            let m = FilesModel.shared
            if !labels.isEmpty { m.labels = labels; m.shell?.updateTitles() }
            if m.files != items { m.files = items }
            call.resolve()
        }
    }

    @objc func toast(_ call: CAPPluginCall) {
        let text = call.getString("message") ?? ""
        let error = call.getBool("error") ?? false
        DispatchQueue.main.async {
            FilesModel.shared.toast = ShellToast(text: text, error: error)
            call.resolve()
        }
    }
}

// MARK: - Files screen

struct FilesView: View {
    @ObservedObject var model: FilesModel
    @State private var query = ""
    @State private var showTip = false
    @State private var renaming: FileItem?
    @State private var newName = ""
    @State private var deleting: FileItem?

    private var shown: [FileItem] {
        query.isEmpty ? model.files : model.files.filter { $0.name.localizedCaseInsensitiveContains(query) }
    }

    var body: some View {
        GeometryReader { geo in
            if geo.size.width >= 700 { wideGrid } else { narrowList }
        }
        .background(Color(uiColor: .systemGroupedBackground))
        .navigationTitle("Querly")
        .searchable(text: $query, prompt: model.t("Search"))
        .refreshable {
            model.send("refresh", "")
            try? await Task.sleep(nanoseconds: 500_000_000)
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { model.shell?.pickFiles() } label: { Image(systemName: "plus") }
                    .accessibilityLabel(model.t("Open a file"))
            }
        }
        .modifier(FileDialogs(model: model, renaming: $renaming, newName: $newName, deleting: $deleting))
        .overlay(alignment: .bottom) { ToastView(model: model) }
    }

    /// iPad and the open iPhone Duo: the open card and tips side by side, files as a grid of cards.
    private var wideGrid: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                HStack(alignment: .top, spacing: 18) {
                    Button { model.shell?.pickFiles() } label: { OpenCard(model: model) }
                        .buttonStyle(.plain)
                        .frame(maxWidth: .infinity)
                    VStack(alignment: .leading, spacing: 8) {
                        Label(model.t("Open files from other apps"), systemImage: "square.and.arrow.down.on.square").font(.headline)
                        Text("1. " + model.t("In the Files app, touch and hold a file."))
                        Text("2. " + model.t("Choose Open With, then Querly."))
                        Text("3. " + model.t("In Mail, Messages or Safari, use Share › Querly."))
                    }
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .padding(16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                }
                Text(model.t("Recent")).font(.title2.weight(.bold))
                if shown.isEmpty {
                    Text(model.t("Files you open appear here.")).foregroundStyle(.secondary)
                }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 250), spacing: 16)], spacing: 16) {
                    ForEach(shown) { f in
                        Button { model.send("open", f.name) } label: { FileCard(file: f, model: model) }
                            .buttonStyle(.plain)
                            .contextMenu { menu(for: f) } preview: { FilePreview(file: f, model: model) }
                    }
                }
            }
            .padding(.horizontal, 28)
            .padding(.vertical, 12)
        }
    }

    private var narrowList: some View {
        List {
            Section {
                Button { model.shell?.pickFiles() } label: { OpenCard(model: model) }
                    .buttonStyle(.plain)
                    .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
                    .listRowBackground(Color.clear)
                DisclosureGroup(isExpanded: $showTip) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("1. " + model.t("In the Files app, touch and hold a file."))
                        Text("2. " + model.t("Choose Open With, then Querly."))
                        Text("3. " + model.t("In Mail, Messages or Safari, use Share › Querly."))
                    }
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .padding(.vertical, 4)
                } label: {
                    Label(model.t("Open files from other apps"), systemImage: "square.and.arrow.down.on.square")
                }
            }

            Section(model.t("Recent")) {
                if shown.isEmpty {
                    Text(model.t("Files you open appear here.")).foregroundStyle(.secondary)
                }
                ForEach(shown) { f in
                    Button { model.send("open", f.name) } label: { FileRow(file: f, model: model) }
                        .tint(.primary)
                        .contextMenu { menu(for: f) } preview: { FilePreview(file: f, model: model) }
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            Button(role: .destructive) { deleting = f } label: { Label(model.t("Delete"), systemImage: "trash") }
                            Button { model.shell?.share(f.name) } label: { Label(model.t("Share"), systemImage: "square.and.arrow.up") }
                                .tint(.blue)
                        }
                        .swipeActions(edge: .leading) {
                            if f.analyze {
                                Button { model.send("analyze", f.name) } label: { Label(model.t("Analyze"), systemImage: "chart.bar.xaxis") }
                                    .tint(.indigo)
                            }
                        }
                }
            }

            if model.files.count <= 2, model.files.contains(where: { $0.name == "sales.csv" }) {
                Section {
                    Button { model.send("open", "sales.csv") } label: {
                        Label(model.t("Try a sample file") + " (sales.csv)", systemImage: "play.circle.fill")
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
    }

    @ViewBuilder
    private func menu(for f: FileItem) -> some View {
        Button { model.send("open", f.name) } label: { Label(model.t("Open"), systemImage: "doc.text.magnifyingglass") }
        if f.analyze {
            Button { model.send("analyze", f.name) } label: { Label(model.t("Analyze with SQL & charts"), systemImage: "chart.bar.xaxis") }
        }
        Button { model.shell?.share(f.name) } label: { Label(model.t("Share"), systemImage: "square.and.arrow.up") }
        Button { newName = f.name; renaming = f } label: { Label(model.t("Rename"), systemImage: "pencil") }
        Divider()
        Button(role: .destructive) { deleting = f } label: { Label(model.t("Delete"), systemImage: "trash") }
    }
}

/// Delete confirmation and rename prompt, shared by the list and the grid.
struct FileDialogs: ViewModifier {
    @ObservedObject var model: FilesModel
    @Binding var renaming: FileItem?
    @Binding var newName: String
    @Binding var deleting: FileItem?

    func body(content: Content) -> some View {
            content
.confirmationDialog(
            deleting.map { "\(model.t("Delete")) “\($0.name)”?" } ?? "",
            isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
            titleVisibility: .visible,
            presenting: deleting
        ) { f in
            Button(model.t("Delete"), role: .destructive) { model.send("delete", f.name) }
            Button(model.t("Cancel"), role: .cancel) {}
        } message: { _ in
            Text(model.t("The file is removed from this iPhone. Tables you created from it are kept."))
        }
            .alert(model.t("Rename file"), isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField(model.t("Name"), text: $newName)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            Button(model.t("Rename")) {
                if let f = renaming, !newName.trimmingCharacters(in: .whitespaces).isEmpty, newName != f.name {
                    model.send("rename", f.name, newName.trimmingCharacters(in: .whitespaces))
                }
                renaming = nil
            }
            Button(model.t("Cancel"), role: .cancel) { renaming = nil }
        }
    }
}

/// A file as a card on wide screens: thumbnail or type badge, name, size and table shape, first columns.
struct FileCard: View {
    let file: FileItem
    @ObservedObject var model: FilesModel
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                Thumb(file: file, size: 54)
                Spacer()
                if file.pro {
                    Text("PRO").font(.caption2.weight(.bold)).padding(.horizontal, 6).padding(.vertical, 2)
                        .background(Color.orange.opacity(0.18), in: Capsule()).foregroundStyle(.orange)
                }
            }
            Text(file.name).font(.headline).lineLimit(2).truncationMode(.middle)
            Text(subtitle(file, model)).font(.footnote).foregroundStyle(.secondary).lineLimit(2)
            if !file.columns.isEmpty {
                Text(file.columns.prefix(5).joined(separator: " · "))
                    .font(.caption.monospaced()).foregroundStyle(.secondary).lineLimit(1)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, minHeight: 168, alignment: .topLeading)
        .background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .contentShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
    }
}

private func subtitle(_ f: FileItem, _ model: FilesModel) -> String {
    let size = ByteCountFormatter.string(fromByteCount: f.size, countStyle: .file)
    if let rows = f.rows, let cols = f.cols {
        let r = rows.formatted()
        return "\(size) · \(r) \(model.t(rows == 1 ? "row" : "rows")) · \(cols) \(model.t(cols == 1 ? "column" : "columns"))"
    }
    return "\(size) · \(f.mtime.formatted(date: .abbreviated, time: .shortened))"
}

private func badgeColor(_ badge: String) -> Color {
    switch badge {
    case "csv", "tsv", "txt", "dat", "psv": return .green
    case "xlsx", "xls": return Color(red: 0.13, green: 0.55, blue: 0.3)
    case "json", "jsonl", "ndjson", "geojson": return .orange
    case "parquet", "pq": return .purple
    case "sqlite", "sqlite3", "db": return .blue
    case "pdf": return .red
    case "md", "markdown": return .indigo
    default: return .gray
    }
}

struct OpenCard: View {
    @ObservedObject var model: FilesModel
    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: "plus")
                .font(.system(size: 22, weight: .semibold))
                .frame(width: 48, height: 48)
                .background(.white.opacity(0.2), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            VStack(alignment: .leading, spacing: 3) {
                Text(model.t("Open a file")).font(.title3.weight(.bold))
                Text("CSV · Excel · JSON · TXT · Parquet · SQLite").font(.footnote).opacity(0.85)
            }
            Spacer(minLength: 0)
        }
        .foregroundStyle(.white)
        .padding(16)
        .background(
            LinearGradient(colors: [Color(red: 0.36, green: 0.55, blue: 1), Color(red: 0.42, green: 0.42, blue: 0.98)], startPoint: .topLeading, endPoint: .bottomTrailing),
            in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .shadow(color: Color(red: 0.36, green: 0.5, blue: 1).opacity(0.35), radius: 14, y: 6)
        .contentShape(Rectangle())
    }
}

struct FileRow: View {
    let file: FileItem
    @ObservedObject var model: FilesModel
    var body: some View {
        HStack(spacing: 12) {
            Thumb(file: file, size: 40)
            VStack(alignment: .leading, spacing: 2) {
                Text(file.name).font(.body.weight(.medium)).lineLimit(1).truncationMode(.middle)
                Text(subtitle(file, model)).font(.footnote).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength: 0)
            if file.pro {
                Text("PRO").font(.caption2.weight(.bold)).padding(.horizontal, 6).padding(.vertical, 2)
                    .background(Color.orange.opacity(0.18), in: Capsule()).foregroundStyle(.orange)
            }
        }
        .foregroundStyle(.primary)
        .contentShape(Rectangle())
    }
}

/// Quick Look thumbnail for pictures and documents; a coloured type badge for data files.
struct Thumb: View {
    let file: FileItem
    let size: CGFloat
    @State private var image: UIImage?

    private static let thumbTypes: Set<String> = ["jpg", "jpeg", "png", "heic", "heif", "gif", "webp", "tif", "tiff", "bmp", "pdf",
                                                  "doc", "docx", "ppt", "pptx", "pages", "numbers", "key", "mov", "mp4", "m4v", "rtf", "usdz"]

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image).resizable().scaledToFill()
                    .frame(width: size, height: size)
                    .clipShape(RoundedRectangle(cornerRadius: size * 0.22, style: .continuous))
            } else {
                Text(file.badge.uppercased().prefix(4))
                    .font(.system(size: size * 0.27, weight: .bold, design: .monospaced))
                    .foregroundStyle(badgeColor(file.badge))
                    .frame(width: size, height: size)
                    .background(badgeColor(file.badge).opacity(0.14), in: RoundedRectangle(cornerRadius: size * 0.22, style: .continuous))
            }
        }
        .task(id: file.name + "\(file.mtime.timeIntervalSince1970)") { await load() }
    }

    private func load() async {
        guard Thumb.thumbTypes.contains(file.badge) else { return }
        let req = QLThumbnailGenerator.Request(fileAt: FilesModel.url(of: file.name), size: CGSize(width: size, height: size), scale: 3, representationTypes: .thumbnail)
        if let rep = try? await QLThumbnailGenerator.shared.generateBestRepresentation(for: req) {
            let img = rep.uiImage
            await MainActor.run { image = img }
        }
    }
}

struct FilePreview: View {
    let file: FileItem
    @ObservedObject var model: FilesModel
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                Thumb(file: file, size: 56)
                VStack(alignment: .leading, spacing: 3) {
                    Text(file.name).font(.headline).lineLimit(2)
                    Text(subtitle(file, model)).font(.subheadline).foregroundStyle(.secondary)
                }
            }
            if !file.columns.isEmpty {
                Text(model.t("Columns")).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                Text(file.columns.prefix(12).joined(separator: " · ") + (file.columns.count > 12 ? " …" : ""))
                    .font(.footnote.monospaced())
                    .lineLimit(4)
            }
        }
        .padding(16)
        .frame(width: 320, alignment: .leading)
    }
}

struct ToastView: View {
    @ObservedObject var model: FilesModel
    var body: some View {
        if let toast = model.toast {
            Text(toast.text)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.white)
                .padding(.horizontal, 16).padding(.vertical, 10)
                .background(toast.error ? Color.red.opacity(0.92) : Color.black.opacity(0.82), in: Capsule())
                .padding(.horizontal, 24).padding(.bottom, 12)
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .task(id: toast.id) {
                    try? await Task.sleep(nanoseconds: 2_600_000_000)
                    withAnimation { if model.toast == toast { model.toast = nil } }
                }
        }
    }
}

// MARK: - iPhone Duo fold

/// Reads the hinge (closed, partially open, fully open) and the fold's division region in window coordinates,
/// and sends both to the web app as a "fold" event. Half-open, notebooks put the code on one side of the fold and
/// the result on the other.
@available(iOS 27.1, *)
struct FoldProbe: View {
    @State private var hinge: DeviceHinge?
    @State private var fold: CGRect = .zero
    @State private var foldActive = false
    @State private var size: CGSize = .zero

    var body: some View {
        GeometryReader { proxy in
            let division = proxy.reservedRegions(kind: .division, options: [.includeInactive]).first
            let frame = division?.frame ?? .zero
            let active = division?.isActive ?? false
            Color.clear
                .task(id: "\(frame)|\(active)|\(proxy.size)") {
                    fold = frame
                    foldActive = active
                    size = proxy.size
                    send()
                }
        }
        .ignoresSafeArea()
        .onHingeChange { _, newContext in
            hinge = newContext.hinge
            send()
        }
    }

    private func send() {
        var status = "none"
        if let st = hinge?.status {
            switch st {
            case .closed: status = "closed"
            case .partiallyOpen: status = "partiallyOpen"
            case .fullyOpen: status = "fullyOpen"
            default: status = "unknown"
            }
        }
        NativeShellPlugin.shared?.emit("fold", [
            "status": status,
            "angle": hinge?.angle.degrees ?? 0,
            "x": Double(fold.minX), "y": Double(fold.minY), "w": Double(fold.width), "h": Double(fold.height),
            "active": foldActive,
            "width": Double(size.width), "height": Double(size.height)
        ])
    }
}
