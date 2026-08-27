import SwiftUI

struct CommandPalette: View {
    let rows: [PaletteRow]
    let selection: Int
    @Binding var query: String
    let onRun: (PaletteRow) -> Void
    /// Arrow keys, a delta.
    let onMove: (Int) -> Void
    /// Hover, an absolute index. Hover moves the selection so exactly one row is
    /// ever highlighted; otherwise the mouse would point at one row while Enter
    /// ran another.
    let onHighlight: (Int) -> Void
    let onClose: () -> Void

    @FocusState private var isFieldFocused: Bool

    var body: some View {
        ZStack(alignment: .top) {
            Theme.paletteBackdrop
                .contentShape(Rectangle())
                .onTapGesture(perform: onClose)
            dialog
                // The handoff's 12vh at its 900pt design height. One number does
                // not justify a GeometryReader.
                .padding(.top, 108)
        }
        .onExitCommand(perform: onClose)
    }

    private var dialog: some View {
        VStack(spacing: 0) {
            inputRow
            Rectangle().fill(Theme.Neutral.n900).frame(height: 1)
            results
        }
        .frame(width: 560)
        .background(Theme.paletteSurface)
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.lg))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.lg)
                .strokeBorder(Theme.Neutral.n700, lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.65), radius: 20, x: 0, y: 16)
        .onMoveCommand { direction in
            switch direction {
            case .up: onMove(-1)
            case .down: onMove(1)
            default: break
            }
        }
    }

    private var inputRow: some View {
        HStack(spacing: Theme.Space.s3) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 14))
                .foregroundStyle(Theme.Neutral.n600)
            TextField("Search, or type a task to add it", text: $query)
                .textFieldStyle(.plain)
                .font(.system(size: 15))
                .foregroundStyle(Theme.nocturneText)
                .focused($isFieldFocused)
                .onSubmit {
                    guard rows.indices.contains(selection) else { return }
                    onRun(rows[selection])
                }
            Text("esc")
                .font(.system(size: Theme.FontSize.label))
                .foregroundStyle(Theme.Neutral.n600)
        }
        .padding(Theme.Space.s4)
        .onAppear { isFieldFocused = true }
    }

    private var results: some View {
        ScrollView {
            VStack(spacing: 2) {
                ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                    PaletteRowView(
                        row: row,
                        isSelected: index == selection,
                        onRun: { onRun(row) },
                        onHover: { onHighlight(index) }
                    )
                }
            }
            .padding(Theme.Space.s2)
        }
        .frame(maxHeight: 340)
    }
}

private struct PaletteRowView: View {
    let row: PaletteRow
    let isSelected: Bool
    let onRun: () -> Void
    let onHover: () -> Void

    var body: some View {
        Button(action: onRun) {
            HStack(spacing: Theme.Space.s3) {
                Image(systemName: row.symbol)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.Accent.a400)
                    .frame(width: 16)
                Text(row.label)
                    .font(.system(size: Theme.FontSize.secondary))
                    .foregroundStyle(Theme.nocturneText)
                    .lineLimit(1)
                Spacer()
                Text(row.hint)
                    .font(.system(size: Theme.FontSize.label))
                    .foregroundStyle(Theme.Neutral.n600)
            }
            .padding(Theme.Space.s3)
            .background(isSelected ? Theme.Neutral.n900 : Color.clear)
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md))
            .contentShape(RoundedRectangle(cornerRadius: Theme.Radius.md))
        }
        .buttonStyle(.plain)
        .onHover { if $0 { onHover() } }
    }
}

extension AnyTransition {
    /// The handoff's `wbIn`: translateY 6 -> 0 with a fade, 130ms ease-out.
    static var wbIn: AnyTransition {
        .modifier(
            active: PaletteInModifier(isActive: true),
            identity: PaletteInModifier(isActive: false)
        )
    }
}

private struct PaletteInModifier: ViewModifier {
    let isActive: Bool

    func body(content: Content) -> some View {
        content
            .offset(y: isActive ? 6 : 0)
            .opacity(isActive ? 0 : 1)
    }
}
