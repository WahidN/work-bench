mod agent;
mod engine;
mod keychain;
mod menu;
// Public so the launchd_probe binary can drive it from the terminal.
pub mod launchd;
mod token;
mod tray;

/// Prints the probe results to stdout at startup.
///
/// This exists because of what probe 1 found: a Tauri window on macOS exposes no CDP
/// endpoint, and screen capture is not granted on this machine, so the window can be
/// neither driven nor photographed. Rust stdout does reach the terminal running
/// `tauri dev`, which makes it the only channel that can prove something happened
/// inside the real app process rather than in a test harness.
fn print_startup_probes(started: std::time::Instant) {
    match keychain::read_api_token() {
        Ok(token) => println!(
            "PROBE keychain PASS token_length={} at={}ms",
            token.len(),
            started.elapsed().as_millis()
        ),
        Err(error) => println!("PROBE keychain FAIL {error}"),
    }

    tauri::async_runtime::spawn(async move {
        for path in ["/today", "/prs"] {
            match engine::engine_get(path.to_string()).await {
                Ok(body) => println!(
                    "PROBE engine_get PASS {path} bytes={} at={}ms",
                    body.len(),
                    started.elapsed().as_millis()
                ),
                Err(error) => println!("PROBE engine_get FAIL {path} {error}"),
            }
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Task 8.4 wanted cold start for both apps timed to first painted list. The window
    // cannot be observed on this machine, and an external proxy did not work either:
    // reqwest's connections to the engine last milliseconds, so polling `lsof` for an
    // established socket on 4173 missed them every time. This instruments the Tauri
    // side instead. There is no matching number for the Swift app, because getting one
    // means editing `app/`, which this change forbids.
    let started = std::time::Instant::now();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .menu(menu::build)
        .on_menu_event(|app, event| menu::handle(app, event.id().as_ref()))
        .setup(move |app| {
            println!(
                "PROBE startup setup_reached at={}ms",
                started.elapsed().as_millis()
            );
            print_startup_probes(started);
            tray::create(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            engine::engine_get,
            engine::engine_post,
            engine::engine_patch,
            engine::engine_put,
            engine::engine_delete,
            agent::engine_agent_state,
            agent::engine_agent_install,
            agent::engine_agent_start,
            agent::engine_agent_remove,
            token::engine_token_state,
            token::engine_token_write,
            token::engine_token_delete,
            tray::set_tray_icon
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
