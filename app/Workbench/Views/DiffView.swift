import SwiftUI

struct DiffView: View {
    let diffText: String

    private var lines: [String] {
        diffText.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
    }

    var body: some View {
        ScrollView([.horizontal, .vertical]) {
            VStack(alignment: .leading, spacing: 0) {
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
        .background(Theme.cardBackground)
        .cornerRadius(8)
    }

    private func isAddition(_ line: String) -> Bool { line.hasPrefix("+") && !line.hasPrefix("+++") }
    private func isDeletion(_ line: String) -> Bool { line.hasPrefix("-") && !line.hasPrefix("---") }

    private func backgroundColor(for line: String) -> Color {
        if isAddition(line) { return Theme.success.opacity(0.12) }
        if isDeletion(line) { return Theme.danger.opacity(0.12) }
        return .clear
    }

    private func foregroundColor(for line: String) -> Color {
        if isAddition(line) { return Theme.success }
        if isDeletion(line) { return Theme.danger }
        return Theme.textSecondary
    }
}
