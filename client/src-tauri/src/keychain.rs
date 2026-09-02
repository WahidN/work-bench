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

/// Writes the engine's bearer token into the login keychain, replacing any that is there.
///
/// A separate command from the read, and separate from the delete, which is task 7.1's
/// whole point: the read runs on every request and the write runs when someone deliberately
/// pastes a token. One command taking a mode would let a bug in the frontend overwrite the
/// token on a path that only meant to read it.
///
/// `-U` is what makes it a replace rather than a second item with the same service and
/// account, which `find-generic-password` would then pick between by an order nobody
/// controls.
///
/// The token goes in `-w` and therefore into this process's argument list, where `ps` can
/// see it for as long as the call lasts. `security` offers no way to read a password from
/// stdin, and `engine/src/keychain.ts` already writes it exactly this way, so the exposure
/// is the engine's too and not something this adds.
pub fn write_api_token(token: &str) -> Result<(), String> {
    if token.trim().is_empty() {
        return Err("a token is required".into());
    }

    let output = Command::new("/usr/bin/security")
        .args([
            "add-generic-password",
            "-s",
            SERVICE,
            "-a",
            ACCOUNT,
            "-w",
            token.trim(),
            "-U",
        ])
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
    Ok(())
}

/// Removes the token.
///
/// A keychain with no item is not a failure: it is the state the user asked for. `security`
/// exits non-zero when there is nothing to delete, so that case is read and swallowed
/// rather than reported as an error the user can do nothing about.
pub fn delete_api_token() -> Result<(), String> {
    let output = Command::new("/usr/bin/security")
        .args(["delete-generic-password", "-s", SERVICE, "-a", ACCOUNT])
        .output()
        .map_err(|error| format!("could not run /usr/bin/security: {error}"))?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    if stderr.contains("could not be found") || stderr.contains("SecKeychainSearchCopyNext") {
        return Ok(());
    }
    Err(stderr.trim().to_string())
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
