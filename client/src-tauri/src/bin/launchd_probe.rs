/*!
Drives the launchd installer from the terminal.

Kept after the spike, and now running the shipped code rather than a copy of it: the
`Installer` here is the one the app's Settings screen uses, only handed `Config::probe()`
instead of `Config::engine()`. So exercising it exercises the real refusals, the real plist
and the real launchctl calls.

That split is not a nicety. `KeepAlive` plus an occupied port is an endless restart loop, so
a mistake made against the engine's own label and port 4173 would take the engine down.

It is behind the `probe` feature so release bundles do not carry it, hence the flag on
every line below.

    cargo run --features probe --bin launchd_probe -- check      # read-only: resolve, serialize, port, state
    cargo run --features probe --bin launchd_probe -- install    # write the plist and bootstrap the job
    cargo run --features probe --bin launchd_probe -- start      # bootstrap or kickstart, whichever fits
    cargo run --features probe --bin launchd_probe -- remove     # bootout and delete the plist

It also reports the real agent's state, because that is the reading Settings shows and this
is the only channel that can be read on a machine where the app window can be neither
driven nor photographed. It never installs, starts or removes the real one.
*/

use tauri_client_lib::launchd::{AgentEnvironment, Config, Installer, SystemEnvironment};

const STANDIN: &str = "../tools/launchd-standin";

fn main() {
    let command = std::env::args().nth(1).unwrap_or_else(|| "check".into());
    let probe = Installer::new(SystemEnvironment, Config::probe());

    match command.as_str() {
        "check" => check(&probe),
        "install" => act("install", probe.install(&standin_directory())),
        "start" => act("start", probe.start()),
        "remove" => act("remove", probe.remove()),
        other => {
            eprintln!("unknown command {other}, expected check, install, start or remove");
            std::process::exit(2);
        }
    }

    report("probe", &probe);
    report(
        "engine",
        &Installer::new(SystemEnvironment, Config::engine()),
    );
}

fn standin_directory() -> String {
    std::fs::canonicalize(STANDIN)
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|error| {
            eprintln!("could not resolve {STANDIN}: {error}");
            std::process::exit(1);
        })
}

/// Read-only. Resolves the toolchain and reports the port, so `check` can be run on a
/// machine without touching anything.
fn check(probe: &Installer<SystemEnvironment>) {
    match SystemEnvironment.resolve_toolchain() {
        Ok(toolchain) => {
            println!("LAUNCHD toolchain node={}", toolchain.node_path);
            println!("LAUNCHD toolchain pnpm={}", toolchain.pnpm_path);
            println!("LAUNCHD toolchain claude={}", toolchain.claude_path);
        }
        Err(error) => println!("LAUNCHD toolchain FAIL {error}"),
    }

    for config in [Config::probe(), Config::engine()] {
        println!(
            "LAUNCHD port {} in_use={}",
            config.port,
            SystemEnvironment.is_port_in_use(config.port)
        );
    }
    println!("LAUNCHD standin {}", standin_directory());
    let _ = probe;
}

fn act(name: &str, result: Result<(), tauri_client_lib::launchd::AgentError>) {
    match result {
        Ok(()) => println!("LAUNCHD {name} ok"),
        Err(error) => {
            println!("LAUNCHD {name} REFUSED {error}");
            std::process::exit(1);
        }
    }
}

fn report(name: &str, installer: &Installer<SystemEnvironment>) {
    let state = installer.state();
    println!(
        "LAUNCHD {name} installed={} loaded={} plist={}",
        state.is_installed, state.is_loaded, state.plist_path
    );
}
