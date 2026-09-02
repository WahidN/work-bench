/*!
The signed-in user's full name, for the sidebar footer.

`Sidebar.swift` reads `ProcessInfo.processInfo.fullUserName`, which a webview cannot see;
the spike hard-coded "Wahid" and said so rather than pretending the problem was solved.
This is the real answer.

`id -F` is what Foundation itself ends up asking, and it is the only way to get the full
name rather than the short account name: `$USER` and `whoami` both give "wahidlinku", and
`SidebarLogic.accountInitials` splits on spaces to build the two initials, so a short name
yields one letter and the wrong one.
*/

use std::process::Command;

/// The full name, or the short account name when there is no full name recorded.
///
/// A machine with an empty full name is real, and an empty footer with no initials looks
/// broken. Falling back to the short name means the footer always says something true.
#[tauri::command]
pub fn account_name() -> String {
    if let Some(name) = capture(&["-F"]) {
        return name;
    }
    capture(&["-un"]).unwrap_or_default()
}

fn capture(arguments: &[&str]) -> Option<String> {
    // An absolute path: a GUI app inherits a minimal PATH and this must not depend on
    // finding `id` by name.
    let output = Command::new("/usr/bin/id").args(arguments).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let name = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if name.is_empty() {
        None
    } else {
        Some(name)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Reads the real account, which is the only way to know the command works on this
    /// machine at all. Asserts that it is non-empty rather than on a name, so the test does
    /// not depend on whose machine it runs on.
    #[test]
    fn reads_a_name() {
        assert!(!account_name().is_empty());
    }
}
