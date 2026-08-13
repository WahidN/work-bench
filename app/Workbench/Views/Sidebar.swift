import SwiftUI

struct Sidebar: View {
    let selection: SidebarSection
    let todos: [Todo]
    let tickets: [Ticket]
    let prs: [PullRequest]
    let projects: [Project]
    let onSelect: (SidebarSection) -> Void
    let onSelectProject: (Project) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s6) {
            brandRow
            searchButton
            navRows
            projectsList
            footer
        }
        .padding(.vertical, Theme.Space.s6)
        .padding(.horizontal, Theme.Space.s4)
        .frame(width: 228, alignment: .leading)
        .frame(maxHeight: .infinity)
        .background(
            LinearGradient(colors: [Theme.sidebarGradientTop, Theme.nocturneBg], startPoint: .top, endPoint: .bottom)
        )
        .overlay(alignment: .trailing) {
            Rectangle().fill(Theme.Neutral.n900).frame(width: 1)
        }
    }

    private var brandRow: some View {
        HStack(spacing: Theme.Space.s3) {
            RoundedRectangle(cornerRadius: 6)
                .strokeBorder(Theme.nocturneAccent, lineWidth: 1)
                .frame(width: 22, height: 22)
                .overlay {
                    Image(systemName: "wrench.and.screwdriver")
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.nocturneAccent)
                }
            Text("Workbench")
                .font(Theme.heading(15))
                .tracking(-0.15)
                .foregroundStyle(Theme.nocturneText)
        }
    }

    private var searchButton: some View {
        Button(action: {}) {
            HStack {
                HStack(spacing: Theme.Space.s2) {
                    Image(systemName: "magnifyingglass")
                    Text("Search or add")
                }
                Spacer()
                Text("⌘K")
                    .font(.system(size: Theme.FontSize.label))
                    .foregroundStyle(Theme.Neutral.n600)
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Theme.Neutral.n400)
        .padding(.vertical, Theme.Space.s2)
        .padding(.horizontal, Theme.Space.s3)
        .overlay(RoundedRectangle(cornerRadius: Theme.Radius.md).strokeBorder(Theme.Neutral.n800, lineWidth: 1))
    }

    private var navRows: some View {
        VStack(spacing: 2) {
            ForEach(SidebarSection.allCases) { section in
                let isSelected = section == selection
                Button {
                    onSelect(section)
                } label: {
                    HStack(spacing: Theme.Space.s3) {
                        Image(systemName: section.symbol).font(.system(size: 16))
                        Text(section.rawValue).font(.system(size: Theme.FontSize.body))
                        Spacer()
                        Text("\(SidebarLogic.navCount(for: section, todos: todos, tickets: tickets, prs: prs, projects: projects))")
                            .font(.system(size: Theme.FontSize.label))
                            .foregroundStyle(Theme.Neutral.n600)
                            .monospacedDigit()
                    }
                }
                .buttonStyle(.plain)
                .foregroundStyle(isSelected ? Theme.Accent.a200 : Theme.Neutral.n400)
                .padding(.vertical, Theme.Space.s2)
                .padding(.horizontal, Theme.Space.s3)
                .background(isSelected ? Theme.Accent.a900 : Color.clear)
                .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md))
            }
        }
    }

    private var projectsList: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s2) {
            HStack {
                Text("PROJECTS")
                    .font(.system(size: Theme.FontSize.label))
                    .tracking(0.8)
                    .foregroundStyle(Theme.Neutral.n600)
                Spacer()
                Text("\(projects.count)")
                    .font(.system(size: Theme.FontSize.label))
                    .foregroundStyle(Theme.Neutral.n700)
            }
            .padding(.horizontal, Theme.Space.s3)

            ScrollView {
                VStack(spacing: 2) {
                    ForEach(Array(projects.enumerated()), id: \.element.id) { index, project in
                        Button {
                            onSelectProject(project)
                        } label: {
                            HStack(spacing: Theme.Space.s3) {
                                Circle().fill(SidebarLogic.projectDotColor(at: index)).frame(width: 6, height: 6)
                                Text(project.name)
                                    .font(.system(size: Theme.FontSize.secondary))
                                    .lineLimit(1)
                                    .truncationMode(.tail)
                                Spacer()
                                Text("\(SidebarLogic.projectOpenCount(for: project, todos: todos))")
                                    .font(.system(size: Theme.FontSize.label))
                                    .foregroundStyle(Theme.Neutral.n600)
                                    .monospacedDigit()
                            }
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(Theme.Neutral.n500)
                        .padding(.vertical, Theme.Space.s2)
                        .padding(.horizontal, Theme.Space.s3)
                        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md))
                    }
                }
            }
        }
        .frame(maxHeight: .infinity)
    }

    private var footer: some View {
        HStack(spacing: Theme.Space.s3) {
            Circle()
                .fill(Theme.Accent.a800)
                .frame(width: 22, height: 22)
                .overlay {
                    Text(SidebarLogic.accountInitials(from: ProcessInfo.processInfo.fullUserName))
                        .font(.system(size: Theme.FontSize.tag))
                        .foregroundStyle(Theme.Accent.a200)
                }
            Text(ProcessInfo.processInfo.fullUserName)
                .font(.system(size: Theme.FontSize.tableMeta))
                .foregroundStyle(Theme.Neutral.n400)
            Spacer()
            Button(action: {}) {
                Image(systemName: "gearshape").font(.system(size: 14))
            }
            .buttonStyle(.plain)
            .foregroundStyle(Theme.Neutral.n600)
        }
        .padding(.vertical, Theme.Space.s2)
        .padding(.horizontal, Theme.Space.s3)
        .overlay(alignment: .top) {
            Rectangle().fill(Theme.Neutral.n900).frame(height: 1)
        }
    }
}
