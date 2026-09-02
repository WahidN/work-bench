use tauri::image::Image;
use tauri::tray::{TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Runtime};

pub const TRAY_ID: &str = "workbench";

/// Creates the tray with no icon yet. The frontend supplies the pixels, because the
/// badge is drawn in a canvas: see `set_tray_icon`.
///
/// The click handler is `statusItemClicked` in AppDelegate.swift, which calls
/// `NSApp.activate(ignoringOtherApps: true)` and then brings every window forward. The
/// point of the badge is that it is read while the app is behind something else, so a
/// click that does not raise the window makes the count useless.
pub fn create<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("Workbench")
        // `show_menu_on_left_click(false)` is what leaves the left click for us. There is
        // no tray menu, so without this the click would be swallowed opening nothing.
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { .. } = event {
                bring_forward(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

/// `bringWindowForward`: raise every window and take focus.
fn bring_forward<R: Runtime>(app: &AppHandle<R>) {
    for window in app.webview_windows().values() {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Replaces the tray icon with raw RGBA pixels handed over from the webview.
///
/// The badge is drawn in a canvas rather than in Rust because `tiny-skia` or the
/// `image` crate would both need a font loaded to render the "9+" text, and a badge
/// count is a UI concern anyway. Tauri's tray takes raw bytes, so canvas output goes
/// straight in.
///
/// `is_template` mirrors `MenuBarIconRenderer.swift`, which sets `isTemplate` only when
/// the count is zero: macOS auto-tints a template image monochrome, which would erase
/// the red badge.
#[tauri::command]
pub fn set_tray_icon<R: Runtime>(
    app: AppHandle<R>,
    rgba: Vec<u8>,
    width: u32,
    height: u32,
    is_template: bool,
) -> Result<String, String> {
    // Cast before multiplying, not after: this is a command any webview JS can call, and
    // `width * height * 4` in u32 overflows at 65536 square, which panics in debug and
    // wraps in release, leaving the length check below comparing against a wrong number.
    let expected = width as usize * height as usize * 4;
    if rgba.len() != expected {
        return Err(format!(
            "expected {expected} bytes for {width}x{height} RGBA, got {}",
            rgba.len()
        ));
    }

    let tray = app
        .tray_by_id(TRAY_ID)
        .ok_or_else(|| format!("no tray with id {TRAY_ID}"))?;

    tray.set_icon(Some(Image::new_owned(rgba, width, height)))
        .map_err(|error| format!("could not set tray icon: {error}"))?;
    tray.set_icon_as_template(is_template)
        .map_err(|error| format!("could not set template flag: {error}"))?;

    // Printed because probe 3 cannot be seen: screen capture is not granted on this
    // machine and the menu bar is not photographable, so stdout is the only evidence
    // that the tray actually accepted the pixels.
    let report = format!("{width}x{height} template={is_template} bytes={expected}");
    println!("PROBE tray PASS {report}");
    Ok(report)
}
