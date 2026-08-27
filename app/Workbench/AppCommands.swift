import SwiftUI

/// The actions the Go menu invokes. ContentView publishes this as a focused scene
/// value, which is what lets Scene-level shortcuts reach view state without moving
/// that state into an app-level router.
struct PaletteCommands {
    let openPalette: () -> Void
    let navigate: (SidebarSection) -> Void
    let askAgent: () -> Void
}

private struct PaletteCommandsKey: FocusedValueKey {
    typealias Value = PaletteCommands
}

extension FocusedValues {
    var paletteCommands: PaletteCommands? {
        get { self[PaletteCommandsKey.self] }
        set { self[PaletteCommandsKey.self] = newValue }
    }
}

struct GoCommands: Commands {
    @FocusedValue(\.paletteCommands) private var commands

    var body: some Commands {
        CommandMenu("Go") {
            Button("Command palette") { commands?.openPalette() }
                .keyboardShortcut("k", modifiers: .command)
                .disabled(commands == nil)

            Divider()

            Button("Today") { commands?.navigate(.today) }
                .keyboardShortcut("1", modifiers: .command)
                .disabled(commands == nil)
            Button("Projects") { commands?.navigate(.projects) }
                .keyboardShortcut("2", modifiers: .command)
                .disabled(commands == nil)
            Button("Pull requests") { commands?.navigate(.pullRequests) }
                .keyboardShortcut("3", modifiers: .command)
                .disabled(commands == nil)
            Button("Jira") { commands?.navigate(.issues) }
                .keyboardShortcut("4", modifiers: .command)
                .disabled(commands == nil)

            Divider()

            Button("Ask the agent") { commands?.askAgent() }
                .keyboardShortcut("j", modifiers: .command)
                .disabled(commands == nil)
        }
    }
}
