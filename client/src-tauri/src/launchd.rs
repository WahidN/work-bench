/*!
The launchd agent that keeps the engine running.

Promoted from probe 4. The plist content is unchanged, because none of the lessons in it
depend on the language writing the file: `zsh -lic` needs both flags because `.zprofile`
supplies pnpm and `.zshrc` supplies node, asking node to print `process.execPath` is what
escapes a version-manager shim that hangs headless, `KeepAlive` has to be a blanket `true`
because pnpm traps SIGTERM and exits 0, and `PATH` needs Claude's directory or every agent
call fails with `spawn claude ENOENT`.

What the probe did not have is the part above the mechanics: the refusal ordering, so a
rejected install leaves the machine exactly as it was, and a seam so those rules can be
tested without installing an agent on the machine running the tests. Both are ported from
`EngineAgentInstaller` and `AgentEnvironment`.

`Config` exists so the same code serves the app and the probe binary. The app uses the real
label and port 4173; the probe keeps its own, because sharing them would mean a mistake in
the probe takes down the engine, and `KeepAlive` plus an occupied port is an endless restart
loop.
*/

use std::net::{Ipv4Addr, SocketAddrV4, TcpStream};
use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;

/// What the agent is called and where it lives. See the module comment for why this is a
/// parameter rather than a constant.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Config {
    pub label: String,
    pub port: u16,
}

impl Config {
    /// The real engine's agent, matching `EngineAgent.label` and the port the engine binds.
    pub fn engine() -> Self {
        Config {
            label: "nl.linku.workbench.engine".into(),
            port: 4173,
        }
    }

    /// Deliberately neither of those, for the probe binary.
    pub fn probe() -> Self {
        Config {
            label: "nl.linku.workbench.spike-engine".into(),
            port: 4174,
        }
    }

    pub fn plist_path(&self) -> PathBuf {
        home()
            .join("Library/LaunchAgents")
            .join(format!("{}.plist", self.label))
    }

    pub fn log_path(&self) -> PathBuf {
        home()
            .join("Library/Logs")
            .join(format!("{}.log", self.label))
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Toolchain {
    pub node_path: String,
    pub pnpm_path: String,
    pub claude_path: String,
}

impl Toolchain {
    /// The directories that go on the job's PATH, deduplicated in order, exactly as
    /// `EngineAgent.plist` does it.
    ///
    /// Deduplicated because two tools often share a directory, pnpm and claude both being
    /// common in /opt/homebrew/bin, and a repeated PATH entry reads like a bug when
    /// someone is debugging this plist at 2am.
    fn path_entries(&self) -> String {
        let mut seen: Vec<String> = Vec::new();
        for path in [&self.node_path, &self.pnpm_path, &self.claude_path] {
            if let Some(parent) = PathBuf::from(path).parent() {
                let directory = parent.to_string_lossy().to_string();
                if !seen.contains(&directory) {
                    seen.push(directory);
                }
            }
        }
        for fallback in ["/usr/bin", "/bin", "/usr/sbin", "/sbin"] {
            if !seen.iter().any(|entry| entry == fallback) {
                seen.push(fallback.to_string());
            }
        }
        seen.join(":")
    }
}

/// The refusals, in the words `EngineAgentError` uses. The messages are the user-facing
/// half of this feature and they were written to be read by someone stuck, so they are
/// carried over rather than rephrased.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AgentError {
    NoDirectoryChosen,
    NotAnEngineDirectory,
    /// Carries the port, because `Config` makes it a parameter: the probe runs on 4174 and
    /// a message hardcoding 4173 would send someone to stop the wrong thing.
    PortAlreadyInUse(u16),
    NotInstalled,
    ToolchainNotFound(String),
    CommandFailed(String),
}

impl std::fmt::Display for AgentError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AgentError::NoDirectoryChosen => write!(formatter, "Choose the engine folder first."),
            AgentError::NotAnEngineDirectory => write!(
                formatter,
                "That folder does not look like the engine: it has no package.json."
            ),
            AgentError::PortAlreadyInUse(port) => write!(
                formatter,
                "Something is already listening on port {port}. Stop the engine you started by \
                 hand first, otherwise launchd would restart a copy that can never claim the port."
            ),
            AgentError::NotInstalled => write!(
                formatter,
                "The engine is not set up to start automatically yet. Choose the engine folder \
                 in Settings."
            ),
            AgentError::ToolchainNotFound(tool) => write!(
                formatter,
                "Could not work out where {tool} lives on this machine. Open a terminal and \
                 check that `{tool}` runs there, then try again."
            ),
            AgentError::CommandFailed(message) => write!(formatter, "{message}"),
        }
    }
}

/// Everything the installer needs from the outside world, behind one seam so the rules
/// above it can be tested without installing an agent on the test machine.
///
/// A direct port of `AgentEnvironment`, including the distinction the comment there draws:
/// the plist existing and launchd knowing the job are different questions, because booting
/// out unloads the job and leaves the file.
pub trait AgentEnvironment {
    fn is_engine_directory(&self, path: &str) -> bool;
    fn is_port_in_use(&self, port: u16) -> bool;
    fn resolve_toolchain(&self) -> Result<Toolchain, AgentError>;
    fn plist_file_exists(&self, path: &PathBuf) -> bool;
    fn is_agent_loaded(&self, label: &str) -> bool;
    fn write_plist(&self, value: &plist::Value, path: &PathBuf) -> Result<(), AgentError>;
    fn delete_plist(&self, path: &PathBuf) -> Result<(), AgentError>;
    fn run(&self, arguments: &[&str]) -> Result<String, AgentError>;
}

/// What the app shows about the agent. `EngineViewModel` reports the same two facts.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentState {
    pub is_installed: bool,
    pub is_loaded: bool,
    pub plist_path: String,
    pub log_path: String,
}

pub struct Installer<E: AgentEnvironment> {
    environment: E,
    config: Config,
}

impl<E: AgentEnvironment> Installer<E> {
    pub fn new(environment: E, config: Config) -> Self {
        Installer {
            environment,
            config,
        }
    }

    pub fn state(&self) -> AgentState {
        AgentState {
            is_installed: self.environment.plist_file_exists(&self.config.plist_path()),
            is_loaded: self.environment.is_agent_loaded(&self.config.label),
            plist_path: self.config.plist_path().to_string_lossy().to_string(),
            log_path: self.config.log_path().to_string_lossy().to_string(),
        }
    }

    /// Order matters: every refusal happens before anything is written or run, so a
    /// rejected install leaves the machine exactly as it was.
    pub fn install(&self, engine_directory: &str) -> Result<(), AgentError> {
        if engine_directory.is_empty() {
            return Err(AgentError::NoDirectoryChosen);
        }
        if !self.environment.is_engine_directory(engine_directory) {
            return Err(AgentError::NotAnEngineDirectory);
        }
        if self.environment.is_port_in_use(self.config.port) {
            return Err(AgentError::PortAlreadyInUse(self.config.port));
        }

        // Resolving the toolchain can fail, so it belongs with the refusals above, before
        // anything is written.
        let toolchain = self.environment.resolve_toolchain()?;

        let value = self.plist(engine_directory, &toolchain);
        self.environment
            .write_plist(&value, &self.config.plist_path())?;
        self.bootstrap()?;
        Ok(())
    }

    /// Starts an agent that is installed but not running.
    ///
    /// Which launchctl verb depends on whether launchd knows the job, and a plist on disk
    /// does not settle that: booting the agent out unloads the job and leaves the file, and
    /// kickstarting in that state fails with "Could not find service". So bootstrap when
    /// unloaded, kickstart when loaded. Bootstrap also starts it, because the plist sets
    /// RunAtLoad.
    ///
    /// The fallback is the spike's race, and it is a real hazard rather than a tidy-up.
    /// `launchctl bootout` returns before launchd has finished removing the job from the
    /// domain, so `is_agent_loaded` called soon after one answers true for a job that is on
    /// its way out. Kickstarting that job fails with exactly the error the branch above
    /// exists to avoid. Retrying as a bootstrap is the answer rather than sleeping first,
    /// because there is no interval that is both short enough not to be felt and long
    /// enough to be a guarantee.
    pub fn start(&self) -> Result<(), AgentError> {
        if !self.environment.plist_file_exists(&self.config.plist_path()) {
            return Err(AgentError::NotInstalled);
        }
        if !self.environment.is_agent_loaded(&self.config.label) {
            return self.bootstrap();
        }

        let target = format!("{}/{}", self.domain(), self.config.label);
        match self.environment.run(&["launchctl", "kickstart", "-k", &target]) {
            Ok(_) => Ok(()),
            Err(AgentError::CommandFailed(message)) if is_missing_service(&message) => {
                self.bootstrap()
            }
            Err(error) => Err(error),
        }
    }

    pub fn remove(&self) -> Result<(), AgentError> {
        let path = self.config.plist_path();
        if !self.environment.plist_file_exists(&path) {
            return Ok(());
        }
        // launchctl exits non-zero when the job is not loaded, which is exactly the state
        // after the engine has already died. Removing the plist is the part that must
        // happen, so a failure here is not allowed to stop it.
        let target = format!("{}/{}", self.domain(), self.config.label);
        let _ = self.environment.run(&["launchctl", "bootout", &target]);
        self.environment.delete_plist(&path)
    }

    fn bootstrap(&self) -> Result<(), AgentError> {
        let path = self.config.plist_path();
        let path = path.to_string_lossy().to_string();
        self.environment
            .run(&["launchctl", "bootstrap", &self.domain(), &path])?;
        Ok(())
    }

    fn domain(&self) -> String {
        format!("gui/{}", uid())
    }

    /// The same dictionary as `EngineAgent.plist`. See the module comment for what each
    /// key is defending against.
    fn plist(&self, working_directory: &str, toolchain: &Toolchain) -> plist::Value {
        let mut dictionary = plist::Dictionary::new();
        dictionary.insert("Label".into(), self.config.label.clone().into());
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
        let log = self.config.log_path().to_string_lossy().to_string();
        dictionary.insert("StandardOutPath".into(), log.clone().into());
        dictionary.insert("StandardErrorPath".into(), log.into());

        plist::Value::Dictionary(dictionary)
    }
}

/* ------------------------------------------------------ the real environment */

/// The only place in this feature that writes to the user's LaunchAgents folder, runs
/// launchctl, or opens a socket. Everything above it is pure so the rules can be tested
/// without any of that happening.
pub struct SystemEnvironment;

impl AgentEnvironment for SystemEnvironment {
    /// True when the directory looks like the engine. Checking for its package.json is what
    /// turns "that folder is not the engine" into a real answer rather than a guess.
    fn is_engine_directory(&self, path: &str) -> bool {
        !path.is_empty() && PathBuf::from(path).join("package.json").is_file()
    }

    /// A connect attempt rather than shelling out to lsof: it answers the question the
    /// engine itself will ask, which is whether the port can be bound.
    fn is_port_in_use(&self, port: u16) -> bool {
        let address = SocketAddrV4::new(Ipv4Addr::LOCALHOST, port);
        TcpStream::connect_timeout(&address.into(), Duration::from_millis(500)).is_ok()
    }

    /// Asks the user's own shell where its toolchain really lives, once, at install time.
    ///
    /// `-lic` is both flags on purpose: `.zprofile` (login) is what puts Homebrew's pnpm on
    /// PATH, and `.zshrc` (interactive) is what puts the version manager's node there.
    /// Measured with a deliberately minimal PATH, neither one alone yields both.
    ///
    /// `process.execPath` is the load-bearing trick: asking node to print its own binary
    /// makes a version-manager shim resolve to the real executable behind it, and only the
    /// real executable survives launchd. `claude` needs no such trick, because Claude Code
    /// installs a real binary behind a stable symlink, so the name `command -v` reports
    /// keeps working after an update repoints it.
    fn resolve_toolchain(&self) -> Result<Toolchain, AgentError> {
        let node = capture("node -e 'process.stdout.write(process.execPath)'", "node")?;
        let pnpm = capture("command -v pnpm", "pnpm")?;
        let claude = capture("command -v claude", "claude")?;

        for (name, path) in [("node", &node), ("pnpm", &pnpm), ("claude", &claude)] {
            if !PathBuf::from(path).is_file() {
                return Err(AgentError::ToolchainNotFound(name.into()));
            }
        }

        Ok(Toolchain {
            node_path: node,
            pnpm_path: pnpm,
            claude_path: claude,
        })
    }

    fn plist_file_exists(&self, path: &PathBuf) -> bool {
        path.exists()
    }

    /// `launchctl print` exits non-zero when the job is not in the domain, which is the
    /// state after a bootout even though the plist is still on disk.
    fn is_agent_loaded(&self, label: &str) -> bool {
        self.run(&["launchctl", "print", &format!("gui/{}/{}", uid(), label)])
            .is_ok()
    }

    fn write_plist(&self, value: &plist::Value, path: &PathBuf) -> Result<(), AgentError> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| {
                AgentError::CommandFailed(format!("could not create {}: {error}", parent.display()))
            })?;
        }
        value.to_file_xml(path).map_err(|error| {
            AgentError::CommandFailed(format!("could not write {}: {error}", path.display()))
        })
    }

    fn delete_plist(&self, path: &PathBuf) -> Result<(), AgentError> {
        if !path.exists() {
            return Ok(());
        }
        std::fs::remove_file(path).map_err(|error| {
            AgentError::CommandFailed(format!("could not delete {}: {error}", path.display()))
        })
    }

    fn run(&self, arguments: &[&str]) -> Result<String, AgentError> {
        let (program, rest) = arguments
            .split_first()
            .ok_or_else(|| AgentError::CommandFailed("no command given".into()))?;
        // An absolute path rather than the name: this runs from a GUI app with launchd's
        // near-empty PATH, and it must not depend on finding launchctl by name.
        let program = if *program == "launchctl" {
            "/bin/launchctl"
        } else {
            program
        };

        let output = Command::new(program)
            .args(rest)
            .output()
            .map_err(|error| AgentError::CommandFailed(format!("could not run {program}: {error}")))?;

        let combined = format!(
            "{}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        if !output.status.success() {
            return Err(AgentError::CommandFailed(format!(
                "{} {} exited {}: {}",
                program,
                rest.join(" "),
                output.status,
                combined.trim()
            )));
        }
        Ok(combined)
    }
}

/// stdout only, unlike `run`. A login-interactive shell prints its own noise on stderr
/// here (a failed `pyenv`, an unreadable Java home), and merging that into the output would
/// corrupt the path being captured.
fn capture(shell_command: &str, tool: &str) -> Result<String, AgentError> {
    let output = Command::new("/bin/zsh")
        .args(["-lic", shell_command])
        .output()
        .map_err(|_| AgentError::ToolchainNotFound(tool.into()))?;

    let text = String::from_utf8_lossy(&output.stdout);
    // The last non-empty line, in case a dotfile prints a banner on stdout.
    text.lines()
        .map(str::trim)
        .rfind(|line| !line.is_empty())
        .map(str::to_string)
        .ok_or_else(|| AgentError::ToolchainNotFound(tool.into()))
}

/// Whether launchctl said the job is not in the domain.
///
/// Matched on the message because launchctl's exit codes do not distinguish this from any
/// other failure: it exits 3 for a missing service and 3 for several other things. The
/// numeric form is in here too, because `launchctl kickstart` prints "Could not find
/// service" while some versions print only "No such process".
fn is_missing_service(message: &str) -> bool {
    let lowered = message.to_lowercase();
    lowered.contains("could not find service") || lowered.contains("no such process")
}

fn home() -> PathBuf {
    PathBuf::from(std::env::var("HOME").expect("HOME must be set"))
}

/// From the home directory's owner rather than `libc::getuid`, which keeps this free of
/// both `unsafe` and an extra dependency for one number.
fn uid() -> u32 {
    use std::os::unix::fs::MetadataExt;
    std::fs::metadata(home())
        .expect("HOME must be readable")
        .uid()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    /// A fake environment that records what was asked of it. This is what the seam is for:
    /// the refusal ordering is the rule worth testing, and testing it must not write a
    /// plist or run launchctl on the machine running the tests.
    #[derive(Default)]
    struct Fake {
        is_engine: bool,
        port_busy: bool,
        toolchain_fails: Option<String>,
        plist_exists: bool,
        loaded: bool,
        /// A command whose first word matches this fails with `failure_message`. Used to
        /// stage the bootout race, where kickstart is the one call that refuses.
        failing_command: Option<String>,
        failure_message: String,
        calls: RefCell<Vec<String>>,
    }

    impl Fake {
        fn healthy() -> Self {
            Fake {
                is_engine: true,
                ..Default::default()
            }
        }

        fn calls(&self) -> Vec<String> {
            self.calls.borrow().clone()
        }
    }

    impl AgentEnvironment for Fake {
        fn is_engine_directory(&self, _path: &str) -> bool {
            self.is_engine
        }
        fn is_port_in_use(&self, _port: u16) -> bool {
            self.port_busy
        }
        fn resolve_toolchain(&self) -> Result<Toolchain, AgentError> {
            match &self.toolchain_fails {
                Some(tool) => Err(AgentError::ToolchainNotFound(tool.clone())),
                None => Ok(Toolchain {
                    node_path: "/opt/node/bin/node".into(),
                    pnpm_path: "/opt/homebrew/bin/pnpm".into(),
                    claude_path: "/opt/homebrew/bin/claude".into(),
                }),
            }
        }
        fn plist_file_exists(&self, _path: &PathBuf) -> bool {
            self.plist_exists
        }
        fn is_agent_loaded(&self, _label: &str) -> bool {
            self.loaded
        }
        fn write_plist(&self, _value: &plist::Value, path: &PathBuf) -> Result<(), AgentError> {
            self.calls
                .borrow_mut()
                .push(format!("write {}", path.display()));
            Ok(())
        }
        fn delete_plist(&self, path: &PathBuf) -> Result<(), AgentError> {
            self.calls
                .borrow_mut()
                .push(format!("delete {}", path.display()));
            Ok(())
        }
        fn run(&self, arguments: &[&str]) -> Result<String, AgentError> {
            self.calls.borrow_mut().push(arguments.join(" "));
            if let Some(failing) = &self.failing_command {
                if arguments.contains(&failing.as_str()) {
                    return Err(AgentError::CommandFailed(self.failure_message.clone()));
                }
            }
            Ok(String::new())
        }
    }

    fn installer(fake: Fake) -> Installer<Fake> {
        Installer::new(fake, Config::probe())
    }

    #[test]
    fn refuses_an_empty_directory_without_touching_anything() {
        let subject = installer(Fake::healthy());
        assert_eq!(subject.install(""), Err(AgentError::NoDirectoryChosen));
        assert!(subject.environment.calls().is_empty());
    }

    #[test]
    fn refuses_a_directory_that_is_not_the_engine_without_touching_anything() {
        let subject = installer(Fake::default());
        assert_eq!(
            subject.install("/tmp/somewhere"),
            Err(AgentError::NotAnEngineDirectory)
        );
        assert!(subject.environment.calls().is_empty());
    }

    #[test]
    fn refuses_a_busy_port_without_touching_anything() {
        // The refusal that matters most: KeepAlive plus an occupied port is an endless
        // restart loop, so this has to happen before the plist is written.
        let subject = installer(Fake {
            is_engine: true,
            port_busy: true,
            ..Default::default()
        });
        assert_eq!(
            subject.install("/tmp/engine"),
            Err(AgentError::PortAlreadyInUse(Config::probe().port))
        );
        assert!(subject.environment.calls().is_empty());
    }

    #[test]
    fn refuses_a_missing_toolchain_before_writing_the_plist() {
        let subject = installer(Fake {
            is_engine: true,
            toolchain_fails: Some("pnpm".into()),
            ..Default::default()
        });
        assert_eq!(
            subject.install("/tmp/engine"),
            Err(AgentError::ToolchainNotFound("pnpm".into()))
        );
        assert!(subject.environment.calls().is_empty());
    }

    #[test]
    fn writes_the_plist_then_bootstraps() {
        let subject = installer(Fake::healthy());
        assert_eq!(subject.install("/tmp/engine"), Ok(()));
        let calls = subject.environment.calls();
        assert_eq!(calls.len(), 2);
        assert!(calls[0].starts_with("write "), "{:?}", calls);
        assert!(calls[1].starts_with("launchctl bootstrap "), "{:?}", calls);
    }

    #[test]
    fn start_refuses_when_nothing_is_installed() {
        let subject = installer(Fake::healthy());
        assert_eq!(subject.start(), Err(AgentError::NotInstalled));
        assert!(subject.environment.calls().is_empty());
    }

    #[test]
    fn start_bootstraps_when_launchd_does_not_know_the_job() {
        // The state after a bootout: the plist is there and the job is not. Kickstarting
        // here fails with "Could not find service".
        let subject = installer(Fake {
            plist_exists: true,
            loaded: false,
            ..Default::default()
        });
        assert_eq!(subject.start(), Ok(()));
        assert!(
            subject.environment.calls()[0].starts_with("launchctl bootstrap "),
            "{:?}",
            subject.environment.calls()
        );
    }

    #[test]
    fn start_kickstarts_when_launchd_already_knows_the_job() {
        let subject = installer(Fake {
            plist_exists: true,
            loaded: true,
            ..Default::default()
        });
        assert_eq!(subject.start(), Ok(()));
        assert_eq!(
            subject.environment.calls(),
            vec![format!(
                "launchctl kickstart -k gui/{}/{}",
                uid(),
                Config::probe().label
            )]
        );
    }

    #[test]
    fn start_falls_back_to_bootstrap_when_kickstart_finds_no_service() {
        /*
         * The spike's race. `launchctl bootout` returns before launchd has finished
         * removing the job, so `is_agent_loaded` answers true for a job on its way out,
         * this picks kickstart, and kickstart refuses with the very error the branch was
         * meant to avoid. Starting the engine has to work anyway.
         */
        let subject = installer(Fake {
            plist_exists: true,
            loaded: true,
            failing_command: Some("kickstart".into()),
            failure_message: "Could not find service \"nl.linku.workbench.spike-engine\"".into(),
            ..Default::default()
        });
        assert_eq!(subject.start(), Ok(()));
        let calls = subject.environment.calls();
        assert!(calls[0].contains("kickstart"), "{:?}", calls);
        assert!(calls[1].starts_with("launchctl bootstrap "), "{:?}", calls);
    }

    #[test]
    fn start_reports_a_kickstart_failure_that_is_not_the_race() {
        // A real failure is not retried as a bootstrap, which would hide it behind a
        // second error about the wrong thing.
        let subject = installer(Fake {
            plist_exists: true,
            loaded: true,
            failing_command: Some("kickstart".into()),
            failure_message: "Operation not permitted".into(),
            ..Default::default()
        });
        assert_eq!(
            subject.start(),
            Err(AgentError::CommandFailed("Operation not permitted".into()))
        );
        assert_eq!(subject.environment.calls().len(), 1);
    }

    #[test]
    fn remove_boots_out_then_deletes() {
        let subject = installer(Fake {
            plist_exists: true,
            ..Default::default()
        });
        assert_eq!(subject.remove(), Ok(()));
        let calls = subject.environment.calls();
        assert!(calls[0].starts_with("launchctl bootout "), "{:?}", calls);
        assert!(calls[1].starts_with("delete "), "{:?}", calls);
    }

    #[test]
    fn remove_does_nothing_when_nothing_is_installed() {
        let subject = installer(Fake::default());
        assert_eq!(subject.remove(), Ok(()));
        assert!(subject.environment.calls().is_empty());
    }

    #[test]
    fn path_entries_deduplicate_and_keep_their_order() {
        // pnpm and claude commonly share /opt/homebrew/bin, and a repeated PATH entry
        // reads like a bug when someone is debugging this plist at 2am.
        let toolchain = Toolchain {
            node_path: "/opt/node/bin/node".into(),
            pnpm_path: "/opt/homebrew/bin/pnpm".into(),
            claude_path: "/opt/homebrew/bin/claude".into(),
        };
        assert_eq!(
            toolchain.path_entries(),
            "/opt/node/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
        );
    }

    #[test]
    fn path_entries_do_not_repeat_a_system_directory_a_tool_already_lives_in() {
        let toolchain = Toolchain {
            node_path: "/usr/bin/node".into(),
            pnpm_path: "/usr/bin/pnpm".into(),
            claude_path: "/usr/bin/claude".into(),
        };
        assert_eq!(
            toolchain.path_entries(),
            "/usr/bin:/bin:/usr/sbin:/sbin"
        );
    }

    #[test]
    fn the_plist_says_what_the_engine_needs() {
        let subject = installer(Fake::healthy());
        let toolchain = subject.environment.resolve_toolchain().unwrap();
        let value = subject.plist("/tmp/engine", &toolchain);
        let dictionary = value.as_dictionary().expect("a dictionary");

        assert_eq!(
            dictionary.get("Label").unwrap().as_string(),
            Some(Config::probe().label.as_str())
        );
        assert_eq!(
            dictionary.get("WorkingDirectory").unwrap().as_string(),
            Some("/tmp/engine")
        );
        // Blanket true, not ["SuccessfulExit": false]: pnpm traps SIGTERM and exits 0, so
        // launchd records a clean shutdown and correctly declines to revive it.
        assert_eq!(dictionary.get("KeepAlive").unwrap().as_boolean(), Some(true));
        assert_eq!(dictionary.get("RunAtLoad").unwrap().as_boolean(), Some(true));

        // node runs pnpm directly. No shell: a wrapper would make the engine depend on the
        // user's dotfiles surviving launchd's near-empty environment.
        let arguments = dictionary
            .get("ProgramArguments")
            .unwrap()
            .as_array()
            .unwrap();
        assert_eq!(arguments[0].as_string(), Some("/opt/node/bin/node"));
        assert_eq!(arguments[1].as_string(), Some("/opt/homebrew/bin/pnpm"));
        assert_eq!(arguments[2].as_string(), Some("start"));

        // Claude's directory is on PATH, or every agent call fails with spawn claude ENOENT
        // while the engine itself looks perfectly healthy.
        let path = dictionary
            .get("EnvironmentVariables")
            .unwrap()
            .as_dictionary()
            .unwrap()
            .get("PATH")
            .unwrap()
            .as_string()
            .unwrap()
            .to_string();
        assert!(path.contains("/opt/homebrew/bin"), "{path}");
    }

    #[test]
    fn the_engine_config_is_the_real_label_and_port() {
        assert_eq!(Config::engine().label, "nl.linku.workbench.engine");
        assert_eq!(Config::engine().port, 4173);
        // And the probe's is neither, so a mistake there cannot take down the engine.
        assert_ne!(Config::probe().label, Config::engine().label);
        assert_ne!(Config::probe().port, Config::engine().port);
    }
}
