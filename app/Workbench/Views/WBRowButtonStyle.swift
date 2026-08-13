import SwiftUI

struct WBRowButtonStyle: ButtonStyle {
    var isSelected: Bool = false
    var selectedBackground: Color = Theme.Accent.a900
    var hoverBackground: Color = Theme.Neutral.n900
    var verticalPadding: CGFloat = Theme.Space.s2
    var horizontalPadding: CGFloat = Theme.Space.s3
    var cornerRadius: CGFloat = Theme.Radius.md

    func makeBody(configuration: Configuration) -> some View {
        RowButtonBody(
            configuration: configuration, isSelected: isSelected,
            selectedBackground: selectedBackground, hoverBackground: hoverBackground,
            verticalPadding: verticalPadding, horizontalPadding: horizontalPadding,
            cornerRadius: cornerRadius
        )
    }

    private struct RowButtonBody: View {
        let configuration: Configuration
        let isSelected: Bool
        let selectedBackground: Color
        let hoverBackground: Color
        let verticalPadding: CGFloat
        let horizontalPadding: CGFloat
        let cornerRadius: CGFloat
        @State private var isHovered = false

        var body: some View {
            configuration.label
                .padding(.vertical, verticalPadding)
                .padding(.horizontal, horizontalPadding)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(background)
                .clipShape(RoundedRectangle(cornerRadius: cornerRadius))
                .contentShape(RoundedRectangle(cornerRadius: cornerRadius))
                .onHover { isHovered = $0 }
        }

        private var background: Color {
            if isSelected { return selectedBackground }
            return isHovered ? hoverBackground : .clear
        }
    }
}
