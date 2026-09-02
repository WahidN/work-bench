use tauri::image::Image;
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Runtime};

pub const TRAY_ID: &str = "workbench-spike";

/// Creates the tray with no icon yet. The frontend supplies the pixels, because the
/// badge is drawn in a canvas: see `set_tray_icon`.
pub fn create<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("Workbench spike")
        .build(app)?;
    Ok(())
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
