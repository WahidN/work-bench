/*!
Probe 4: the launchd mechanics, in Rust.

This is deliberately narrow. `EngineAgent.plist` already encodes several expensive
lessons and none of them change with the language writing the file: `zsh -lic` needs
both flags because `.zprofile` supplies pnpm and `.zshrc` supplies node, asking node to
print `process.execPath` is what escapes a version-manager shim that hangs headless,
`KeepAlive` has to be a blanket `true` because pnpm traps SIGTERM and exits 0, and
`PATH` needs Claude's directory or every agent call fails with `spawn claude ENOENT`.

So the plist content is reused rather than rederived, and what is under test is only
whether Rust can do the five mechanics: resolve the toolchain through the user's shell,
serialize a plist, bind-test a port, bootstrap and bootout a job.

Everything here uses the spike's own label, port and log path. Sharing them with the
real agent would mean a mistake here takes down the engine, and `KeepAlive` plus an
occupied port produces an endless restart loop.
*/

use std::net::{Ipv4Addr, SocketAddrV4, TcpStream};
use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;

/// Deliberately not `nl.linku.workbench.engine`.
pub const LABEL: &str = "nl.linku.workbench.spike-engine";
/// Deliberately not 4173.
pub const PORT: u16 = 4174;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Toolchain {
    pub node_path: String,
    pub pnpm_path: String,
    pub claude_path: String,
}

impl Toolchain {
    /// The directories that go on the job's PATH, deduplicated in order, exactly as
    /// `EngineAgent.plist` does it.
    fn path_entries(&self) -> String {
        let mut seen = Vec::new();
        for path in [&self.node_path, &self.pnpm_path, &self.claude_path] {
            if let Some(parent) = PathBuf::from(path).parent() {
                let directory = parent.to_string_lossy().to_string();
                if !seen.contains(&directory) {
                    seen.push(directory);
                }
            }
        }
        for fallback in ["/usr/bin", "/bin", "/usr/sbin", "/sbin"] {
            let directory = fallback.to_string();
            if !seen.contains(&directory) {
                seen.push(directory);
            }
        }
        seen.join(":")
    }
}

/// Asks the user's own shell where the toolchain really lives.
///
/// `-lic` is both flags on purpose, and stderr is discarded rather than merged: a
/// login-interactive shell prints its own noise there (a failed `pyenv`, an unreadable
/// Java home) and merging it would corrupt the path being captured. This mirrors
/// `SystemAgentEnvironment.capture`, including taking the last non-empty line in case a
/// dotfile prints a banner on stdout.
fn capture(shell_command: &str) -> Result<String, String> {
    let output = Command::new("/bin/zsh")
        .args(["-lic", shell_command])
        .output()
        .map_err(|error| format!("could not run zsh: {error}"))?;

    let text = String::from_utf8_lossy(&output.stdout);
    text.lines()
        .map(str::trim)
        .rfind(|line| !line.is_empty())
        .map(str::to_string)
        .ok_or_else(|| format!("`{shell_command}` printed nothing on stdout"))
}

pub fn resolve_toolchain() -> Result<Toolchain, String> {
    let node_path = capture("node -e 'process.stdout.write(process.execPath)'")?;
    let pnpm_path = capture("command -v pnpm")?;
    let claude_path = capture("command -v claude")?;

    for (name, path) in [
        ("node", &node_path),
        ("pnpm", &pnpm_path),
        ("claude", &claude_path),
    ] {
        let metadata = std::fs::metadata(path)
            .map_err(|_| format!("resolved {name} to {path}, which does not exist"))?;
        if !metadata.is_file() {
            return Err(format!("resolved {name} to {path}, which is not a file"));
        }
    }

    Ok(Toolchain {
        node_path,
        pnpm_path,
        claude_path,
    })
}

/// A connect attempt rather than shelling out to lsof, matching
/// `SystemAgentEnvironment.isPortInUse`: it answers the question the job itself will
/// ask, which is whether the port can be bound.
pub fn is_port_in_use() -> bool {
    let address = SocketAddrV4::new(Ipv4Addr::LOCALHOST, PORT);
    TcpStream::connect_timeout(&address.into(), Duration::from_millis(500)).is_ok()
}

pub fn plist_path() -> PathBuf {
    home()
        .join("Library/LaunchAgents")
        .join(format!("{LABEL}.plist"))
}

pub fn log_path() -> PathBuf {
    home().join("Library/Logs").join(format!("{LABEL}.log"))
}

fn home() -> PathBuf {
    PathBuf::from(std::env::var("HOME").expect("HOME must be set"))
}

/// The same dictionary as `EngineAgent.plist`, with the spike's label, working
/// directory and log path.
pub fn plist(working_directory: &str, toolchain: &Toolchain) -> plist::Value {
    let mut dictionary = plist::Dictionary::new();
    dictionary.insert("Label".into(), LABEL.into());
    dictionary.insert(
        "ProgramArguments".into(),
        plist::Value::Array(vec![
            toolchain.node_path.clone().into(),
            toolchain.pnpm_path.clone().into(),
            "start".into(),
        ]),
    );
    dictionary.insert("WorkingDirectory".into(), working_directory.into());

    let mut environment = plist::Dictionary::new();
    environment.insert("PATH".into(), toolchain.path_entries().into());
    dictionary.insert(
        "EnvironmentVariables".into(),
        plist::Value::Dictionary(environment),
    );

    dictionary.insert("RunAtLoad".into(), true.into());
    dictionary.insert("KeepAlive".into(), true.into());
    let log = log_path().to_string_lossy().to_string();
    dictionary.insert("StandardOutPath".into(), log.clone().into());
    dictionary.insert("StandardErrorPath".into(), log.into());

    plist::Value::Dictionary(dictionary)
}

pub fn write_plist(value: &plist::Value) -> Result<PathBuf, String> {
    let path = plist_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("could not create {}: {error}", parent.display()))?;
    }
    value
        .to_file_xml(&path)
        .map_err(|error| format!("could not write {}: {error}", path.display()))?;
    Ok(path)
}

pub fn delete_plist() -> Result<(), String> {
    let path = plist_path();
    if !path.exists() {
        return Ok(());
    }
    std::fs::remove_file(&path)
        .map_err(|error| format!("could not delete {}: {error}", path.display()))
}

fn launchctl(arguments: &[&str]) -> Result<String, String> {
    let output = Command::new("/bin/launchctl")
        .args(arguments)
        .output()
        .map_err(|error| format!("could not run launchctl: {error}"))?;

    let combined = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    if !output.status.success() {
        return Err(format!(
            "launchctl {} exited {}: {}",
            arguments.join(" "),
            output.status,
            combined.trim()
        ));
    }
    Ok(combined)
}

/// The uid comes from the home directory's owner rather than from `libc::getuid`, which
/// keeps this free of both `unsafe` and an extra dependency for one number.
fn domain() -> String {
    use std::os::unix::fs::MetadataExt;
    let uid = std::fs::metadata(home())
        .expect("HOME must be readable")
        .uid();
    format!("gui/{uid}")
}

/// Whether launchd actually knows the job. Distinct from the plist existing: booting
/// out unloads the job and leaves the file.
pub fn is_loaded(label: &str) -> bool {
    launchctl(&["print", &format!("{}/{}", domain(), label)]).is_ok()
}

pub fn bootstrap() -> Result<String, String> {
    let path = plist_path();
    launchctl(&["bootstrap", &domain(), &path.to_string_lossy()])
}

pub fn bootout() -> Result<String, String> {
    launchctl(&["bootout", &format!("{}/{}", domain(), LABEL)])
}
