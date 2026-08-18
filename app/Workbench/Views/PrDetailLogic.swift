import Foundation

enum DiffLineKind: Equatable {
    case hunkHeader
    case context
    case addition
    case deletion
}

struct DiffLine: Identifiable, Equatable {
    let id: Int
    let kind: DiffLineKind
    let oldNumber: Int?
    let newNumber: Int?
    let text: String
}

struct DiffRow: Identifiable, Equatable {
    let line: DiffLine
    /// Threads anchored to this line, rendered directly under it.
    let threads: [PrReviewThread]

    var id: Int { line.id }
}

struct PrFileSection: Identifiable, Equatable {
    let file: PrDetailFile
    let rows: [DiffRow]
    /// Threads whose line no longer exists in the diff. Shown at the end of the
    /// file rather than dropped, so an outdated comment is never lost.
    let trailingThreads: [PrReviewThread]

    var id: String { file.path }
    var isTooLarge: Bool { file.patch == nil }
    var churn: String { "+\(file.additions) -\(file.deletions)" }
}

struct PrFactsParts: Equatable {
    let branches: String
    let commits: String
    let files: String
    let churn: String
}

struct PrTabCounts: Equatable {
    let files: Int
    let conversation: Int
}

enum PrDetailLogic {
    private static let openedFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "d MMM"
        return formatter
    }()

    private static let timestampFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

    // MARK: - Patch parsing

    /// Walks a unified patch, carrying the old and new line counters forward from
    /// each hunk header, so a comment anchored to a new-file line can be found.
    static func diffLines(from patch: String) -> [DiffLine] {
        guard !patch.isEmpty else { return [] }
        var result: [DiffLine] = []
        var oldNumber = 0
        var newNumber = 0

        for raw in patch.split(separator: "\n", omittingEmptySubsequences: false).map(String.init) {
            let id = result.count
            if raw.hasPrefix("@@") {
                let starts = hunkStarts(raw)
                oldNumber = starts.old
                newNumber = starts.new
                result.append(DiffLine(id: id, kind: .hunkHeader, oldNumber: nil, newNumber: nil, text: raw))
            } else if raw.hasPrefix("+") {
                result.append(DiffLine(id: id, kind: .addition, oldNumber: nil, newNumber: newNumber, text: String(raw.dropFirst())))
                newNumber += 1
            } else if raw.hasPrefix("-") {
                result.append(DiffLine(id: id, kind: .deletion, oldNumber: oldNumber, newNumber: nil, text: String(raw.dropFirst())))
                oldNumber += 1
            } else if raw.hasPrefix("\\") {
                // Git's "no newline at end of file" marker. Not a real diff line:
                // emit nothing and leave both counters untouched.
                continue
            } else {
                let text = raw.hasPrefix(" ") ? String(raw.dropFirst()) : raw
                result.append(DiffLine(id: id, kind: .context, oldNumber: oldNumber, newNumber: newNumber, text: text))
                oldNumber += 1
                newNumber += 1
            }
        }
        return result
    }

    /// Reads "@@ -14,3 +14,4 @@ trailing context" into its two starting numbers.
    private static func hunkStarts(_ header: String) -> (old: Int, new: Int) {
        let numbers = header
            .split(separator: "@")
            .first
            .map(String.init)?
            .split(separator: " ")
            .compactMap { part -> Int? in
                guard part.hasPrefix("-") || part.hasPrefix("+") else { return nil }
                return Int(part.dropFirst().split(separator: ",").first ?? "")
            } ?? []
        return (old: numbers.first ?? 1, new: numbers.count > 1 ? numbers[1] : 1)
    }

    // MARK: - Sections

    static func sections(detail: PrDetail) -> [PrFileSection] {
        detail.files.map { file in
            let lines = diffLines(from: file.patch ?? "")
            let fileThreads = detail.threads.filter { $0.path == file.path }

            var byLineId: [Int: [PrReviewThread]] = [:]
            var trailing: [PrReviewThread] = []
            for thread in fileThreads {
                if let line = thread.line,
                   let match = lines.first(where: { $0.newNumber == line }) {
                    byLineId[match.id, default: []].append(thread)
                } else {
                    trailing.append(thread)
                }
            }

            return PrFileSection(
                file: file,
                rows: lines.map { DiffRow(line: $0, threads: byLineId[$0.id] ?? []) },
                trailingThreads: trailing
            )
        }
    }

    // MARK: - Header

    static func factsParts(detail: PrDetail) -> PrFactsParts {
        PrFactsParts(
            branches: "\(detail.headRefName) → \(detail.baseRefName)",
            commits: "\(detail.commitCount) commit\(detail.commitCount == 1 ? "" : "s")",
            files: "\(detail.changedFiles) file\(detail.changedFiles == 1 ? "" : "s") changed",
            churn: "+\(detail.additions) -\(detail.deletions)"
        )
    }

    static func openedLine(detail: PrDetail, authoredByMe: Bool) -> String {
        let who = authoredByMe ? "you" : detail.author
        guard let date = timestampFormatter.date(from: detail.createdAt) else {
            return "opened by \(who)"
        }
        return "opened \(openedFormatter.string(from: date)) by \(who)"
    }

    static func tabCounts(detail: PrDetail) -> PrTabCounts {
        PrTabCounts(files: detail.files.count, conversation: detail.conversation.count)
    }
}
