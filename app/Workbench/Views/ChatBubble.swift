import SwiftUI

struct ChatBubble: View {
    let role: ChatRole
    let content: String

    var body: some View {
        HStack {
            if role == .user { Spacer(minLength: 40) }
            Text(content)
                .foregroundStyle(Theme.textPrimary)
                .padding(10)
                .background(role == .user ? Theme.selectedBackground : Theme.cardBackground)
                .cornerRadius(8)
            if role == .assistant { Spacer(minLength: 40) }
        }
    }
}
