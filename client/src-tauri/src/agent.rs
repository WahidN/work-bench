/*!
The Tauri commands behind Settings' engine section.

Thin on purpose: the rules live in `launchd::Installer` so they can be tested without
installing anything, and these four only choose the real config and turn an `AgentError`
into a string the webview can show.
*/

use crate::launchd::{AgentState, Config, Installer, SystemEnvironment};

fn installer() -> Installer<SystemEnvironment> {
    Installer::new(SystemEnvironment, Config::engine())
}

#[tauri::command]
pub fn engine_agent_state() -> AgentState {
    installer().state()
}

/// Installs the agent and reports the state afterwards, so the screen never has to guess
/// what the install did.
#[tauri::command]
pub fn engine_agent_install(directory: String) -> Result<AgentState, String> {
    installer()
        .install(&directory)
        .map_err(|error| error.to_string())?;
    Ok(installer().state())
}

#[tauri::command]
pub fn engine_agent_start() -> Result<AgentState, String> {
    installer().start().map_err(|error| error.to_string())?;
    Ok(installer().state())
}

/// Removes the agent, and answers with the state that is true straight after.
///
/// `is_loaded` is deliberately not re-read here for a moment and then trusted: `launchctl
/// bootout` returns before launchd has finished tearing the job down, so a `print` fired
/// immediately after can still succeed and report a job that is on its way out. The state
/// this returns comes from the same `state()` every other command uses, and Settings
/// refetches; what this comment exists to stop is someone adding an optimistic
/// `is_loaded: false` here, which would be a claim rather than a reading.
#[tauri::command]
pub fn engine_agent_remove() -> Result<AgentState, String> {
    installer().remove().map_err(|error| error.to_string())?;
    Ok(installer().state())
}
