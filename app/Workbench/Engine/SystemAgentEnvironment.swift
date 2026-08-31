import Foundation

/// The real environment: the only place in this feature that writes to the user's
/// LaunchAgents folder, runs launchctl, or opens a socket. Everything above it is
/// pure so the rules can be tested without any of that happening.
struct SystemAgentEnvironment: AgentEnvironment {
    func isEngineDirectory(_ path: String) -> Bool {
        EngineAgent.isEngineDirectory(path)
    }

    /// A connect attempt rather than shelling out to lsof: it answers the question the
    /// engine itself will ask, which is whether the port can be bound.
    func isPortInUse() -> Bool {
        let socketDescriptor = socket(AF_INET, SOCK_STREAM, 0)
        guard socketDescriptor >= 0 else { return false }
        defer { close(socketDescriptor) }

        var address = sockaddr_in()
        address.sin_family = sa_family_t(AF_INET)
        address.sin_port = UInt16(4173).bigEndian
        address.sin_addr.s_addr = inet_addr("127.0.0.1")

        let connected = withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                connect(socketDescriptor, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        return connected == 0
    }

    func plistFileExists() -> Bool {
        FileManager.default.fileExists(atPath: EngineAgent.plistPath)
    }

    /// `launchctl print` exits non-zero when the job is not in the domain, which is the
    /// state after a bootout even though the plist is still on disk.
    func isAgentLoaded() -> Bool {
        (try? run(["launchctl", "print", "gui/\(getuid())/\(EngineAgent.label)"])) != nil
    }

    /// Asks the user's own shell where its toolchain really lives, once, at install
    /// time.
    ///
    /// `-lic` is both flags on purpose: `.zprofile` (login) is what puts Homebrew's
    /// pnpm on PATH, and `.zshrc` (interactive) is what puts the version manager's
    /// node there. Measured with a deliberately minimal PATH, neither one alone
    /// yields both, which is exactly how the two earlier single-flag attempts failed.
    ///
    /// `process.execPath` is the load-bearing trick: asking node to print its own
    /// binary makes a version-manager shim resolve to the real executable behind it,
    /// and only the real executable survives launchd.
    func resolveToolchain() throws -> EngineToolchain {
        let node = try capture("node -e 'process.stdout.write(process.execPath)'")
        let pnpm = try capture("command -v pnpm")

        let manager = FileManager.default
        guard !node.isEmpty, manager.isExecutableFile(atPath: node) else {
            throw EngineAgentError.toolchainNotFound("node")
        }
        guard !pnpm.isEmpty, manager.isExecutableFile(atPath: pnpm) else {
            throw EngineAgentError.toolchainNotFound("pnpm")
        }
        return EngineToolchain(nodePath: node, pnpmPath: pnpm)
    }

    /// stdout only, unlike `run`. A login-interactive shell prints its own noise on
    /// stderr here (a failed `pyenv`, an unreadable Java home), and merging that into
    /// the output would corrupt the path being captured.
    private func capture(_ shellCommand: String) throws -> String {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/zsh")
        process.arguments = ["-lic", shellCommand]

        let output = Pipe()
        process.standardOutput = output
        process.standardError = FileHandle.nullDevice

        try process.run()
        let data = output.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()

        let text = String(data: data, encoding: .utf8) ?? ""
        // The last non-empty line, in case a dotfile prints a banner on stdout.
        return text
            .split(separator: "\n")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .last { !$0.isEmpty } ?? ""
    }

    func writePlist(_ plist: [String: Any], to path: String) throws {
        let directory = URL(fileURLWithPath: path).deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let data = try PropertyListSerialization.data(fromPropertyList: plist, format: .xml, options: 0)
        try data.write(to: URL(fileURLWithPath: path))
    }

    func deletePlist(at path: String) throws {
        guard FileManager.default.fileExists(atPath: path) else { return }
        try FileManager.default.removeItem(atPath: path)
    }

    func run(_ arguments: [String]) throws -> String {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/zsh")
        // -l so the command sees the user's own PATH. launchctl is at a fixed path, but
        // keeping one invocation style here means the engine and launchctl resolve the
        // same way and there is only one thing to reason about.
        process.arguments = ["-lc", arguments.map { "'\($0)'" }.joined(separator: " ")]

        let output = Pipe()
        process.standardOutput = output
        process.standardError = output

        try process.run()
        let data = output.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()

        let text = String(data: data, encoding: .utf8) ?? ""
        guard process.terminationStatus == 0 else {
            throw EngineAgentError.commandFailed(
                text.isEmpty ? "\(arguments.first ?? "command") exited \(process.terminationStatus)" : text
            )
        }
        return text
    }
}
