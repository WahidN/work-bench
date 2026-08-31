import SwiftUI

/// Shown across the top of every screen while the engine does not answer. It exists
/// because an engine that is down renders as a screen with nothing in it, which is
/// indistinguishable from having no work to do.
struct EngineDownBanner: View {
    let isAgentInstalled: Bool
    let onStart: () -> Void
    let onOpenSettings: () -> Void

    var body: some View {
        HStack(spacing: Theme.Space.s3) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 13))
                .foregroundStyle(Theme.negative)

            Text("The engine is not running, so nothing on these screens is up to date.")
                .font(.system(size: Theme.FontSize.tableMeta))
                .foregroundStyle(Theme.nocturneText)

            Spacer()

            // Only offer to start it when there is something to start. Otherwise the
            // useful action is choosing the engine folder, which lives in Settings.
            if isAgentInstalled {
                Button("Start it", action: onStart)
            } else {
                Button("Set up in Settings", action: onOpenSettings)
            }
        }
        .padding(.vertical, Theme.Space.s3)
        .padding(.horizontal, Theme.Space.s8)
        .background(Theme.nocturneSurface)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Theme.Neutral.n900).frame(height: 1)
        }
    }
}
