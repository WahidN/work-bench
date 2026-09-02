use std::process::Command;

const SERVICE: &str = "workbench";
const ACCOUNT: &str = "api-token";

/// Reads the engine's bearer token out of the login keychain.
///
/// Shells out to `/usr/bin/security` rather than calling `SecItemCopyMatching`, which
/// is what `app/Workbench/Networking/KeychainClient.swift` does. That file records why
/// the native call is the worse bet here: a keychain item's ACL follows the calling
/// binary, so reading from a locally built, unsigned binary makes macOS ask for
/// authorization on every rebuild, and once hung a test run. `engine/src/keychain.ts`
/// already shells out to the same tool and has never had that problem, because the
/// caller macOS sees is the stable, already-trusted `/usr/bin/security`.
///
/// Absolute path on purpose: a launchd or GUI process inherits a minimal PATH, and
/// this must not depend on finding `security` by name.
pub fn read_api_token() -> Result<String, String> {
    let output = Command::new("/usr/bin/security")
        .args(["find-generic-password", "-s", SERVICE, "-a", ACCOUNT, "-w"])
        .output()
        .map_err(|error| format!("could not run /usr/bin/security: {error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("security exited with {}", output.status)
        } else {
            stderr
        });
    }

    let token = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if token.is_empty() {
        return Err("keychain returned an empty token".into());
    }
    Ok(token)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Reads the real login keychain, which is the point: the question probe 2 asks is
    /// whether a freshly built, unsigned binary triggers an authorization prompt, and
    /// only a real read can answer that. A prompt shows up here as a hang, which is
    /// exactly how the Swift app's `SecItemCopyMatching` path once hung a test run.
    ///
    /// Asserts on the length, never printing the token.
    #[test]
    fn reads_the_engine_token_without_prompting() {
        let token = read_api_token().expect("engine token should be in the login keychain");
        assert_eq!(token.len(), 64, "the engine generates a 32-byte hex token");
    }
}
