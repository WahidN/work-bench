import SwiftUI

struct DiffView: View {
    let diffText: String
    private let lines: [String]

    init(diffText: String) {
        self.diffText = diffText
        self.lines = diffText.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
    }

    var body: some View {
        ScrollView([.horizontal, .vertical]) {
            LazyVStack(alignment: .leading, spacing: 0) {
                ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                    Text(line.isEmpty ? " " : line)
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(foregroundColor(for: line))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 8)
                        .background(backgroundColor(for: line))
                }
            }
        }
        .background(Theme.nocturneBg)
        .cornerRadius(8)
    }

    private func isAddition(_ line: String) -> Bool { line.hasPrefix("+") && !line.hasPrefix("+++") }
    private func isDeletion(_ line: String) -> Bool { line.hasPrefix("-") && !line.hasPrefix("---") }

    private func backgroundColor(for line: String) -> Color {
        if isAddition(line) { return Theme.positive.opacity(0.12) }
        if isDeletion(line) { return Theme.negative.opacity(0.12) }
        return .clear
    }

    private func foregroundColor(for line: String) -> Color {
        if isAddition(line) { return Theme.positive }
        if isDeletion(line) { return Theme.negative }
        return Theme.Neutral.n500
    }
}
