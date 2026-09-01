import SwiftUI

/// The draft: every remark the review produced, editable, before any of it
/// reaches the pull request.
///
/// A sheet rather than a panel because the review starts from two places, a row
/// in the list and the detail header, and this is the one presentation that
/// works over both without the list having to navigate somewhere first.
struct PrReviewSheet: View {
    @ObservedObject var viewModel: PrReviewViewModel
    let prId: Int
    let prTitle: String
    let onClose: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Divider().overlay(Theme.Neutral.n800)
            content
            Divider().overlay(Theme.Neutral.n800)
            footer
        }
        .frame(width: 640, height: 560)
        .background(Theme.nocturneBg)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s1) {
            Text("Review")
                .font(Theme.heading(Theme.FontSize.screenTitle))
                .foregroundStyle(Theme.nocturneText)
            Text(prTitle)
                .font(.system(size: Theme.FontSize.tableMeta))
                .foregroundStyle(Theme.Neutral.n600)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(Theme.Space.s4)
    }

    @ViewBuilder
    private var content: some View {
        if viewModel.isReviewing {
            centered("Reviewing the changes… this takes a few minutes.")
        } else if let empty = PrReviewLogic.emptyState(findings: viewModel.findings, discarded: viewModel.discarded) {
            centered(empty)
        } else {
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Space.s3) {
                    ForEach(Array(viewModel.findings.enumerated()), id: \.element.id) { index, finding in
                        findingCard(index: index, finding: finding)
                    }
                    if !viewModel.discarded.isEmpty {
                        discardedSection
                    }
                }
                .padding(Theme.Space.s4)
            }
        }
    }

    private func centered(_ text: String) -> some View {
        VStack {
            Spacer()
            Text(text)
                .font(.system(size: Theme.FontSize.secondary))
                .foregroundStyle(Theme.Neutral.n600)
                .multilineTextAlignment(.center)
                .padding(.horizontal, Theme.Space.s6)
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func findingCard(index: Int, finding: ReviewFinding) -> some View {
        VStack(alignment: .leading, spacing: Theme.Space.s2) {
            HStack {
                Text("\(finding.path):\(finding.line)")
                    .font(.system(size: Theme.FontSize.tableMeta, design: .monospaced))
                    .foregroundStyle(Theme.nocturneAccent)
                Spacer()
                Button {
                    viewModel.discard(findingAt: index)
                } label: {
                    Image(systemName: "trash")
                        .font(.system(size: Theme.FontSize.tableMeta))
                        .foregroundStyle(Theme.Neutral.n600)
                }
                .buttonStyle(.plain)
                .help("Do not post this comment")
                .accessibilityLabel("Discard this comment")
            }

            TextEditor(text: Binding(
                get: { finding.body },
                set: { viewModel.edit(findingAt: index, body: $0) }
            ))
            .font(.system(size: Theme.FontSize.secondary))
            .scrollContentBackground(.hidden)
            .frame(minHeight: 60)
            .padding(Theme.Space.s2)
            .background(Theme.nocturneSurface)
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.sm))
        }
        .padding(Theme.Space.s3)
        .background(Theme.Neutral.n900.opacity(0.5))
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md))
    }

    /// Shown so a trimmed review is visible. A review that quietly posted half of
    /// what it found would be worse than one that says what it dropped.
    private var discardedSection: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s2) {
            Text("Not posted")
                .font(Theme.heading(Theme.FontSize.secondary))
                .foregroundStyle(Theme.Neutral.n500)
            ForEach(viewModel.discarded) { item in
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(item.path):\(item.line)")
                        .font(.system(size: Theme.FontSize.tableMeta, design: .monospaced))
                        .foregroundStyle(Theme.Neutral.n600)
                    Text(item.reason)
                        .font(.system(size: Theme.FontSize.tableMeta))
                        .foregroundStyle(Theme.Neutral.n600)
                }
            }
        }
        .padding(.top, Theme.Space.s2)
    }

    private var footer: some View {
        HStack(spacing: Theme.Space.s3) {
            if let error = viewModel.errorMessage {
                Text(error)
                    .font(.system(size: Theme.FontSize.tableMeta))
                    .foregroundStyle(Theme.negative)
                    .lineLimit(2)
            } else if !viewModel.findings.isEmpty {
                Text(PrReviewLogic.summary(findings: viewModel.findings, discarded: viewModel.discarded))
                    .font(.system(size: Theme.FontSize.tableMeta))
                    .foregroundStyle(Theme.Neutral.n600)
            }
            Spacer()
            Button("Discard") {
                viewModel.reset()
                onClose()
            }
            .buttonStyle(.plain)
            .foregroundStyle(Theme.Neutral.n500)

            Button {
                Task {
                    await viewModel.publish(prId: prId)
                    if viewModel.didPublish { onClose() }
                }
            } label: {
                Text(viewModel.isPublishing ? "Posting…" : "Post to GitHub")
                    .font(Theme.heading(Theme.FontSize.secondary))
                    .padding(.vertical, Theme.Space.s2)
                    .padding(.horizontal, Theme.Space.s4)
                    .contentShape(RoundedRectangle(cornerRadius: Theme.Radius.md))
            }
            .buttonStyle(.plain)
            .foregroundStyle(Theme.Status.approved)
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Radius.md)
                    .strokeBorder(Theme.Status.approved, lineWidth: 1)
            )
            .disabled(!PrReviewLogic.canPublish(findings: viewModel.findings) || viewModel.isPublishing)
            .opacity(PrReviewLogic.canPublish(findings: viewModel.findings) ? 1 : 0.4)
        }
        .padding(Theme.Space.s4)
    }
}
