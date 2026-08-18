import Testing
import Foundation
@testable import Workbench

private func file(_ path: String, patch: String?) -> PrDetailFile {
    PrDetailFile(path: path, status: "modified", additions: 2, deletions: 1, patch: patch)
}

private func thread(_ path: String, line: Int?, outdated: Bool = false) -> PrReviewThread {
    PrReviewThread(
        path: path, line: line, isResolved: false, isOutdated: outdated,
        comments: [PrReviewComment(id: 1, author: "sana", body: "q", createdAt: "2026-08-14T09:00:00Z")]
    )
}

private let patch = """
@@ -14,3 +14,4 @@ import { ledger }
 const RETRYABLE = new Set([500]);
-const MAX_ATTEMPTS = 1;
+const MAX_ATTEMPTS = 3;
+const BASE_DELAY_MS = 200;
"""

@Test func diffLinesNumberBothSidesFromTheHunkHeader() {
    let lines = PrDetailLogic.diffLines(from: patch)
    #expect(lines.count == 5)
    #expect(lines[0].kind == .hunkHeader)
    #expect(lines[1].kind == .context)
    #expect(lines[1].oldNumber == 14)
    #expect(lines[1].newNumber == 14)
    #expect(lines[2].kind == .deletion)
    #expect(lines[2].oldNumber == 15)
    #expect(lines[2].newNumber == nil)
    #expect(lines[3].kind == .addition)
    #expect(lines[3].oldNumber == nil)
    #expect(lines[3].newNumber == 15)
    #expect(lines[4].newNumber == 16)
}

@Test func diffLinesOfAnEmptyPatchIsEmpty() {
    #expect(PrDetailLogic.diffLines(from: "").isEmpty)
}

@Test func aThreadAnchorsAfterTheLineItCommentsOn() {
    let detail = makeDetail(files: [file("a.ts", patch: patch)], threads: [thread("a.ts", line: 15)])
    let section = PrDetailLogic.sections(detail: detail)[0]
    #expect(section.rows[3].threads.map(\.path) == ["a.ts"])
    #expect(section.trailingThreads.isEmpty)
}

@Test func anOutdatedThreadFallsToTheEndOfItsFileInsteadOfDisappearing() {
    let detail = makeDetail(files: [file("a.ts", patch: patch)], threads: [thread("a.ts", line: nil, outdated: true)])
    let section = PrDetailLogic.sections(detail: detail)[0]
    #expect(section.trailingThreads.count == 1)
}

@Test func aThreadWhoseLineIsNotInTheDiffFallsToTheEnd() {
    let detail = makeDetail(files: [file("a.ts", patch: patch)], threads: [thread("a.ts", line: 999)])
    #expect(PrDetailLogic.sections(detail: detail)[0].trailingThreads.count == 1)
}

@Test func aFileWithNoPatchReportsItRatherThanRenderingEmpty() {
    let section = PrDetailLogic.sections(detail: makeDetail(files: [file("huge.bin", patch: nil)], threads: []))[0]
    #expect(section.rows.isEmpty)
    #expect(section.isTooLarge)
}

@Test func factsPartsReadLikeTheMockup() {
    let parts = PrDetailLogic.factsParts(detail: makeDetail(files: [], threads: []))
    #expect(parts.branches == "atlas/retry-card-capture → main")
    #expect(parts.commits == "4 commits")
    #expect(parts.files == "3 files changed")
    #expect(parts.churn == "+64 -7")
}

@Test func oneCommitAndOneFileAreNotPluralised() {
    let parts = PrDetailLogic.factsParts(
        detail: makeDetail(files: [], threads: [], commitCount: 1, changedFiles: 1)
    )
    #expect(parts.commits == "1 commit")
    #expect(parts.files == "1 file changed")
}

@Test func openedLineSaysByYouForYourOwnPullRequest() {
    let detail = makeDetail(files: [], threads: [])
    #expect(PrDetailLogic.openedLine(detail: detail, authoredByMe: true).hasSuffix("by you"))
    #expect(PrDetailLogic.openedLine(detail: detail, authoredByMe: false).hasSuffix("by wahid"))
}

@Test func tabCountsCountFilesAndConversationEntries() {
    let detail = makeDetail(files: [file("a.ts", patch: patch)], threads: [])
    let counts = PrDetailLogic.tabCounts(detail: detail)
    #expect(counts.files == 1)
    #expect(counts.conversation == 1)
}

private func makeDetail(
    files: [PrDetailFile],
    threads: [PrReviewThread],
    commitCount: Int = 4,
    changedFiles: Int = 3
) -> PrDetail {
    PrDetail(
        title: "Retry card capture on 5xx", url: "https://x/pull/23", state: "OPEN", isDraft: false,
        reviewState: .reviewRequired, author: "wahid", createdAt: "2026-08-12T15:11:00Z",
        baseRefName: "main", headRefName: "atlas/retry-card-capture",
        commitCount: commitCount, changedFiles: changedFiles, additions: 64, deletions: 7,
        files: files, threads: threads,
        conversation: [PrConversationItem(
            kind: .review, author: "sana", body: "ok",
            createdAt: "2026-08-14T09:00:00Z", state: "COMMENTED"
        )]
    )
}
