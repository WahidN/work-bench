/*!
Runs probe 4 and prints what happened, one mechanic at a time.

A separate binary rather than a Tauri command because probe 4 has nothing to do with the
window: it writes a file, runs `launchctl`, and checks a port. Making it a CLI means the
evidence lands in the terminal, which matters here because the app window can be neither
driven nor photographed on this machine.

    cargo run --bin launchd_probe -- check      # read-only: resolve, serialize, port
    cargo run --bin launchd_probe -- install    # write the plist and bootstrap the job
    cargo run --bin launchd_probe -- remove     # bootout and delete the plist

`check` touches nothing. `install` refuses before writing anything if the port is
already held, which is the refusal `EngineAgentInstaller` implements and the reason it
matters: KeepAlive plus an occupied port is an endless restart loop.
*/

use tauri_client_lib::launchd;

const STANDIN: &str = "../tools/launchd-standin";

fn main() {
    let command = std::env::args().nth(1).unwrap_or_else(|| "check".into());

    match command.as_str() {
        "check" => check(),
        "install" => install(),
        "remove" => remove(),
        other => {
            eprintln!("unknown command {other}, expected check, install or remove");
            std::process::exit(2);
        }
    }
}

fn standin_directory() -> String {
    std::fs::canonicalize(STANDIN)
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|error| {
            eprintln!("could not resolve {STANDIN}: {error}");
            std::process::exit(1);
        })
}

fn resolved() -> launchd::Toolchain {
    match launchd::resolve_toolchain() {
        Ok(toolchain) => {
            println!("LAUNCHD toolchain node={}", toolchain.node_path);
            println!("LAUNCHD toolchain pnpm={}", toolchain.pnpm_path);
            println!("LAUNCHD toolchain claude={}", toolchain.claude_path);
            toolchain
        }
        Err(error) => {
            println!("LAUNCHD toolchain FAIL {error}");
            std::process::exit(1);
        }
    }
}

fn check() {
    let toolchain = resolved();
    let value = launchd::plist(&standin_directory(), &toolchain);

    // Printed rather than written, so `check` stays read-only.
    let mut buffer = Vec::new();
    plist::to_writer_xml(&mut buffer, &value).expect("plist should serialise");
    println!("LAUNCHD plist bytes={}", buffer.len());
    println!("{}", String::from_utf8_lossy(&buffer));

    println!(
        "LAUNCHD port {} in_use={}",
        launchd::PORT,
        launchd::is_port_in_use()
    );
    println!("LAUNCHD plist_path {}", launchd::plist_path().display());
    println!(
        "LAUNCHD spike_loaded={} real_engine_loaded={}",
        launchd::is_loaded(launchd::LABEL),
        launchd::is_loaded("nl.linku.workbench.engine")
    );
}

fn install() {
    let toolchain = resolved();

    // Every refusal happens before anything is written or run, so a rejected install
    // leaves the machine exactly as it was. That ordering is lifted from
    // EngineAgentInstaller and is the whole point of the check.
    if launchd::is_port_in_use() {
        println!(
            "LAUNCHD install REFUSED port {} is already in use",
            launchd::PORT
        );
        std::process::exit(1);
    }

    let value = launchd::plist(&standin_directory(), &toolchain);
    match launchd::write_plist(&value) {
        Ok(path) => println!("LAUNCHD wrote {}", path.display()),
        Err(error) => {
            println!("LAUNCHD write FAIL {error}");
            std::process::exit(1);
        }
    }

    match launchd::bootstrap() {
        Ok(_) => println!("LAUNCHD bootstrap ok"),
        Err(error) => {
            println!("LAUNCHD bootstrap FAIL {error}");
            std::process::exit(1);
        }
    }

    println!(
        "LAUNCHD spike_loaded={}",
        launchd::is_loaded(launchd::LABEL)
    );
}

fn remove() {
    match launchd::bootout() {
        Ok(_) => println!("LAUNCHD bootout ok"),
        Err(error) => println!("LAUNCHD bootout FAIL {error}"),
    }
    match launchd::delete_plist() {
        Ok(()) => println!("LAUNCHD plist deleted"),
        Err(error) => println!("LAUNCHD delete FAIL {error}"),
    }
    println!(
        "LAUNCHD spike_loaded={} plist_exists={}",
        launchd::is_loaded(launchd::LABEL),
        launchd::plist_path().exists()
    );
}
