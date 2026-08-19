import SwiftUI

/// Renders one file's diff with both line-number gutters, and lets the caller
/// inject whatever should appear under a line that carries review threads.
struct PrFileSectionView<ThreadContent: View>: View {
    let section: PrFileSection
    let isExpanded: Bool
    let onToggle: () -> Void
    @ViewBuilder let threadContent: (PrReviewThread) -> ThreadContent

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            if isExpanded {
                if section.isTooLarge {
                    Text("GitHub did not return a diff for this file, it is too large.")
                        .font(.system(size: Theme.FontSize.tableMeta))
                        .foregroundStyle(Theme.Neutral.n600)
                        .padding(Theme.Space.s4)
                } else {
                    ForEach(section.rows) { row in
                        diffLine(row.line)
                        ForEach(row.threads) { thread in
                            threadContent(thread)
                                .padding(.vertical, Theme.Space.s2)
                                .padding(.leading, Theme.Space.s8)
                        }
                    }
                }
                ForEach(section.trailingThreads) { thread in
                    threadContent(thread)
                        .padding(.vertical, Theme.Space.s2)
                        .padding(.leading, Theme.Space.s8)
                }
            }
        }
        .background(Theme.nocturneSurface.opacity(0.4))
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.md)
                .strokeBorder(Theme.Neutral.n900, lineWidth: 1)
        )
    }

    private var header: some View {
        Button(action: onToggle) {
            HStack(spacing: Theme.Space.s3) {
                Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
                    .font(.system(size: 11))
                    .foregroundStyle(Theme.Neutral.n600)
                Text(section.file.path)
                    .font(.system(size: Theme.FontSize.secondary, design: .monospaced))
                    .foregroundStyle(Theme.nocturneText)
                Spacer()
                Text(section.churn)
                    .font(.system(size: Theme.FontSize.tableMeta))
                    .foregroundStyle(Theme.Neutral.n500)
                    .monospacedDigit()
            }
            .padding(.vertical, Theme.Space.s3)
            .padding(.horizontal, Theme.Space.s4)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func diffLine(_ line: DiffLine) -> some View {
        HStack(spacing: 0) {
            gutter(line.oldNumber)
            gutter(line.newNumber)
            Text(prefix(line) + line.text)
                .font(.system(size: Theme.FontSize.tableMeta, design: .monospaced))
                .foregroundStyle(foreground(line))
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, Theme.Space.s3)
                .textSelection(.enabled)
        }
        .background(background(line))
    }

    private func gutter(_ number: Int?) -> some View {
        Text(number.map(String.init) ?? "")
            .font(.system(size: Theme.FontSize.label, design: .monospaced))
            .foregroundStyle(Theme.Neutral.n700)
            .monospacedDigit()
            .frame(width: 44, alignment: .trailing)
            .padding(.trailing, Theme.Space.s2)
    }

    private func prefix(_ line: DiffLine) -> String {
        switch line.kind {
        case .addition: "+ "
        case .deletion: "- "
        case .context: "  "
        case .hunkHeader: ""
        }
    }

    private func foreground(_ line: DiffLine) -> Color {
        switch line.kind {
        case .addition: Theme.Status.approved
        case .deletion: Theme.Status.changesRequested
        case .hunkHeader: Theme.Neutral.n600
        case .context: Theme.Neutral.n400
        }
    }

    private func background(_ line: DiffLine) -> Color {
        switch line.kind {
        case .addition: Theme.Status.approved.opacity(0.10)
        case .deletion: Theme.Status.changesRequested.opacity(0.10)
        case .hunkHeader: Theme.Neutral.n900.opacity(0.6)
        case .context: .clear
        }
    }
}
