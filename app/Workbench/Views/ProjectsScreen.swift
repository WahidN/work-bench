import SwiftUI

struct ProjectsScreen: View {
    let cards: [ProjectCard]
    let onSelect: (Project) -> Void

    var body: some View {
        ScrollView {
            if cards.isEmpty {
                Text(ProjectsLogic.emptyStateText)
                    .font(.system(size: Theme.FontSize.secondary))
                    .foregroundStyle(Theme.Neutral.n600)
                    .padding(Theme.Space.s8)
            } else {
                LazyVGrid(
                    columns: [GridItem(.adaptive(minimum: 280), spacing: Theme.Space.s4)],
                    spacing: Theme.Space.s4
                ) {
                    ForEach(cards) { card in
                        ProjectCardView(card: card, onSelect: { onSelect(card.project) })
                    }
                }
                .frame(maxWidth: 1180, alignment: .topLeading)
                .padding(Theme.Space.s8)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Theme.nocturneBg)
    }
}

private struct ProjectCardView: View {
    let card: ProjectCard
    let onSelect: () -> Void
    @State private var isHovered = false

    var body: some View {
        Button(action: onSelect) {
            VStack(alignment: .leading, spacing: Theme.Space.s3) {
                HStack(alignment: .firstTextBaseline, spacing: Theme.Space.s3) {
                    Circle().fill(card.dot).frame(width: 7, height: 7)
                    Text(card.name)
                        .font(Theme.heading(Theme.FontSize.cardTitle))
                        .foregroundStyle(Theme.nocturneText)
                    Spacer()
                    Text(card.statusLabel)
                        .font(.system(size: Theme.FontSize.tag))
                        .foregroundStyle(Theme.Neutral.n400)
                        .padding(.vertical, 2)
                        .padding(.horizontal, 7)
                        .background(Theme.Neutral.n900)
                        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.sm))
                }

                if !card.blurb.isEmpty {
                    Text(card.blurb)
                        .font(.system(size: Theme.FontSize.tableMeta))
                        .foregroundStyle(Theme.Neutral.n500)
                        .lineSpacing(6)
                        .multilineTextAlignment(.leading)
                }

                Spacer(minLength: Theme.Space.s3)

                Text("\(card.openCount) open · \(ProjectsLogic.prCountLabel(card.prCount)) · \(card.activity)")
                    .font(.system(size: Theme.FontSize.tableMeta))
                    .foregroundStyle(Theme.Neutral.n600)
                    .padding(.top, Theme.Space.s3)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .overlay(alignment: .top) {
                        Rectangle().fill(Theme.Neutral.n900).frame(height: 1)
                    }
            }
            .frame(maxWidth: .infinity, minHeight: 140, alignment: .topLeading)
            .padding(Theme.Space.s6)
            .background(Theme.nocturneSurface)
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Radius.md)
                    .strokeBorder(isHovered ? Theme.Accent.a700 : Theme.Neutral.n900, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .onHover { isHovered = $0 }
        .help("Edit \(card.name)")
    }
}
