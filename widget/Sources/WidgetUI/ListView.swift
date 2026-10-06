import SwiftUI
import WidgetCore

public enum ListState: Equatable {
  case loading
  case loaded([PullRequest])
  case failed(String)
}

public let listSize = CGSize(width: 360, height: 440)

public struct ListView: View {
  var state: ListState
  var onOpen: (PullRequest) -> Void

  public init(state: ListState, onOpen: @escaping (PullRequest) -> Void) {
    self.state = state
    self.onOpen = onOpen
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(spacing: 8) {
        Text("Pull requests").font(.system(size: 14, weight: .medium)).foregroundStyle(Palette.text)
        if case .loaded(let prs) = state {
          Text("\(prs.count)").font(.system(size: 12)).foregroundStyle(Palette.ghost)
        }
        Spacer()
      }
      .padding(.horizontal, 16)
      .frame(height: 44)
      Rectangle().fill(Palette.border).frame(height: 1)
      content
    }
    .frame(width: listSize.width, height: listSize.height, alignment: .top)
    .background(Palette.canvas)
    .clipShape(RoundedRectangle(cornerRadius: 12))
    .overlay(RoundedRectangle(cornerRadius: 12).stroke(Palette.border, lineWidth: 1))
  }

  @ViewBuilder private var content: some View {
    switch state {
    case .loading:
      Message(text: "Loading pull requests", color: Palette.secondary)
    case .failed(let error):
      Message(text: error, color: Palette.error)
    case .loaded(let prs) where prs.isEmpty:
      Message(text: "No open pull requests", color: Palette.secondary)
    case .loaded(let prs):
      ScrollView {
        PullRequestRows(prs: prs, onOpen: onOpen)
      }
    }
  }
}

/// The rows on their own, so `ImageRenderer` can draw them: it leaves a `ScrollView` empty.
public struct PullRequestRows: View {
  var prs: [PullRequest]
  var onOpen: (PullRequest) -> Void

  public init(prs: [PullRequest], onOpen: @escaping (PullRequest) -> Void) {
    self.prs = prs
    self.onOpen = onOpen
  }

  public var body: some View {
    VStack(spacing: 2) {
      ForEach(prs) { pr in
        Row(pr: pr) { onOpen(pr) }
      }
    }
    .padding(6)
  }
}

private struct Message: View {
  var text: String
  var color: Color

  var body: some View {
    Text(text)
      .font(.system(size: 12))
      .foregroundStyle(color)
      .padding(16)
      .frame(maxWidth: .infinity, alignment: .leading)
  }
}

private struct Row: View {
  var pr: PullRequest
  var onOpen: () -> Void
  @State private var hovered = false

  var body: some View {
    Button(action: onOpen) {
      VStack(alignment: .leading, spacing: 4) {
        Text(pr.title)
          .font(.system(size: 13))
          .foregroundStyle(Palette.text)
          .lineLimit(2)
          .multilineTextAlignment(.leading)
        HStack(spacing: 6) {
          Text("\(pr.shortRepo)#\(pr.number)").foregroundStyle(Palette.secondary)
          Text(pr.author).foregroundStyle(Palette.ghost)
          ForEach(pr.reasons, id: \.self) { reason in
            Text(reason == "review" ? "Review" : "Assigned").foregroundStyle(Palette.accent)
          }
          if pr.commented {
            Text("Commented").foregroundStyle(Palette.secondary)
          }
        }
        .font(.system(size: 11))
      }
      .padding(.horizontal, 10)
      .padding(.vertical, 8)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(RoundedRectangle(cornerRadius: 8).fill(hovered ? Palette.hover : .clear))
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .onHover { hovered = $0 }
  }
}
