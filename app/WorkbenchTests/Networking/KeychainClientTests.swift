import Testing
import Foundation
@testable import Workbench

@Suite(.serialized)
struct KeychainClientTests {
    let client = KeychainClient(service: "workbench-tests")
    let account = "round-trip-test"

    init() throws {
        try? client.deleteSecret(account: account)
    }

    @Test func writeThenReadReturnsTheSameValue() throws {
        try client.writeSecret("hello-keychain", account: account)
        let value = try client.readSecret(account: account)
        #expect(value == "hello-keychain")
        try client.deleteSecret(account: account)
    }

    @Test func readingAMissingAccountReturnsNilNotAnError() throws {
        let value = try client.readSecret(account: "does-not-exist-\(UUID().uuidString)")
        #expect(value == nil)
    }

    @Test func writingTwiceUpdatesInPlaceRatherThanThrowing() throws {
        try client.writeSecret("first", account: account)
        try client.writeSecret("second", account: account)
        let value = try client.readSecret(account: account)
        #expect(value == "second")
        try client.deleteSecret(account: account)
    }

    @Test func deletingAMissingAccountDoesNotThrow() throws {
        try client.deleteSecret(account: "does-not-exist-\(UUID().uuidString)")
    }
}
