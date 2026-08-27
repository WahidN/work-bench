import AppKit
import SwiftUI

struct SettingsSheet: View {
    @Bindable var viewModel: SettingsViewModel
    let onClose: () -> Void

    @State private var clientId = ""
    @State private var clientSecret = ""

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s6) {
            Text("Settings")
                .font(Theme.heading(Theme.FontSize.cardTitle))
                .foregroundStyle(Theme.nocturneText)

            jiraSection

            if let errorMessage = viewModel.errorMessage {
                Text(errorMessage)
                    .font(.system(size: Theme.FontSize.tableMeta))
                    .foregroundStyle(Theme.negative)
                    .fixedSize(horizontal: false, vertical: true)
            }

            HStack {
                Spacer()
                Button("Close", action: onClose)
            }
        }
        .padding(Theme.Space.s8)
        .frame(width: 460)
        .background(Theme.nocturneBg)
        .task { await viewModel.load() }
    }

    @ViewBuilder
    private var jiraSection: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s4) {
            Text("JIRA")
                .font(.system(size: Theme.FontSize.label))
                .tracking(0.8)
                .foregroundStyle(Theme.Neutral.n600)

            if let connection = viewModel.connection {
                if connection.connected {
                    connectedRows(connection)
                } else if !connection.availableSites.isEmpty {
                    sitePicker(connection.availableSites)
                } else if viewModel.isWaitingForBrowser {
                    waitingRows
                } else if connection.hasClientCredentials {
                    connectRows
                } else {
                    credentialRows(connection)
                }
            } else {
                ProgressView().controlSize(.small)
            }
        }
    }

    private func connectedRows(_ connection: JiraConnection) -> some View {
        VStack(alignment: .leading, spacing: Theme.Space.s3) {
            Text("Connected to \(connection.siteName ?? "Jira")")
                .font(.system(size: Theme.FontSize.body))
                .foregroundStyle(Theme.nocturneText)
            if let siteUrl = connection.siteUrl {
                Text(siteUrl)
                    .font(.system(size: Theme.FontSize.tableMeta))
                    .foregroundStyle(Theme.Neutral.n600)
            }
            Button("Disconnect") { Task { await viewModel.disconnect() } }
                .disabled(viewModel.isBusy)
        }
    }

    private func sitePicker(_ sites: [JiraSite]) -> some View {
        VStack(alignment: .leading, spacing: Theme.Space.s2) {
            Text("Choose which Jira site to use")
                .font(.system(size: Theme.FontSize.body))
                .foregroundStyle(Theme.nocturneText)
            ForEach(sites) { site in
                Button(site.name) { Task { await viewModel.chooseSite(site.id) } }
                    .disabled(viewModel.isBusy)
            }
        }
    }

    private var waitingRows: some View {
        HStack(spacing: Theme.Space.s3) {
            ProgressView().controlSize(.small)
            Text("Waiting for Atlassian…")
                .font(.system(size: Theme.FontSize.body))
                .foregroundStyle(Theme.nocturneText)
            Spacer()
            Button("Cancel") { viewModel.stopPolling() }
        }
    }

    private var connectRows: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s3) {
            Text("Client credentials saved.")
                .font(.system(size: Theme.FontSize.body))
                .foregroundStyle(Theme.nocturneText)
            Button("Connect Jira", action: startConnect)
                .disabled(viewModel.isBusy)
        }
    }

    private func credentialRows(_ connection: JiraConnection) -> some View {
        VStack(alignment: .leading, spacing: Theme.Space.s3) {
            Text("Create an OAuth 2.0 (3LO) app at developer.atlassian.com, give it the Jira "
                 + "platform scopes, and set its callback URL to exactly:")
                .font(.system(size: Theme.FontSize.tableMeta))
                .foregroundStyle(Theme.Neutral.n500)
                .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: Theme.Space.s2) {
                Text(connection.callbackUrl)
                    .font(.system(size: Theme.FontSize.tableMeta, design: .monospaced))
                    .foregroundStyle(Theme.nocturneText)
                Button("Copy") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(connection.callbackUrl, forType: .string)
                }
            }

            textInput("Client ID", text: $clientId)
            secretInput("Client secret", text: $clientSecret)

            Button("Save") {
                Task { await viewModel.saveClient(clientId: clientId, clientSecret: clientSecret) }
            }
            .disabled(viewModel.isBusy)
        }
    }

    private func startConnect() {
        Task {
            guard let url = await viewModel.connect(), let target = URL(string: url) else { return }
            NSWorkspace.shared.open(target)
            await viewModel.pollUntilConnected()
        }
    }

    private func textInput(_ title: String, text: Binding<String>) -> some View {
        TextField(title, text: text)
            .textFieldStyle(.plain)
            .font(.system(size: Theme.FontSize.body))
            .foregroundStyle(Theme.nocturneText)
            .padding(.vertical, Theme.Space.s2)
            .padding(.horizontal, Theme.Space.s3)
            .background(Theme.nocturneSurface)
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Radius.md)
                    .strokeBorder(Theme.Neutral.n800, lineWidth: 1)
            )
    }

    private func secretInput(_ title: String, text: Binding<String>) -> some View {
        SecureField(title, text: text)
            .textFieldStyle(.plain)
            .font(.system(size: Theme.FontSize.body))
            .foregroundStyle(Theme.nocturneText)
            .padding(.vertical, Theme.Space.s2)
            .padding(.horizontal, Theme.Space.s3)
            .background(Theme.nocturneSurface)
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Radius.md)
                    .strokeBorder(Theme.Neutral.n800, lineWidth: 1)
            )
    }
}
