import Foundation
@testable import Workbench

/// Hands APIClient a token without going near the real login keychain. The APIClient
/// suites used to write and then read a real keychain item, so every rebuild asked macOS
/// for authorization and the run stalled waiting on a password prompt.
struct StubSecretStore: SecretStore {
    let token: String?

    init(token: String? = "test-token") {
        self.token = token
    }

    func readSecret(account: String) throws -> String? { token }
}
