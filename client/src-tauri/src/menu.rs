/*!
The Go menu, ported from `app/Workbench/AppCommands.swift`.

Why it exists at all, when the webview already handles the same keystrokes: on macOS the
menu bar is where a user looks to find out what an app can do, and a shortcut that appears
nowhere is a shortcut nobody discovers. The Swift gets both from one `CommandMenu`, because
SwiftUI's `.keyboardShortcut` puts the binding in the menu and routes the key event.

Tauri splits those. The accelerators here make the menu the record of what exists and give
AppKit first refusal on the keystroke, which is also what makes the shortcuts work while
focus sits somewhere the webview is not listening. The window handler in `shortcuts.ts`
stays, because it is the half that knows whether the caret is in a text field.

Each item emits `go-menu` with its id. The frontend maps that onto the same table the key
handler uses, so the two cannot disagree about what ⌘3 does.
*/

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Runtime};

pub const EVENT: &str = "go-menu";

/// Id, label and accelerator, in the Swift's order. The ids match `SHORTCUTS` in
/// shortcuts.ts.
const ITEMS: [(&str, &str, &str); 6] = [
    ("palette", "Command palette", "CmdOrCtrl+K"),
    ("today", "Today", "CmdOrCtrl+1"),
    ("projects", "Projects", "CmdOrCtrl+2"),
    ("prs", "Pull requests", "CmdOrCtrl+3"),
    ("jira", "Jira", "CmdOrCtrl+4"),
    ("agent", "Ask the agent", "CmdOrCtrl+J"),
];

/// Builds the app menu: the default one, with Go added.
///
/// `Menu::default` is what keeps the standard macOS menus, so Quit, Copy and Paste all
/// still work. Building a menu from scratch would silently take those away, and a webview
/// with no Edit menu has no ⌘C.
pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let menu = Menu::default(app)?;

    let go = Submenu::new(app, "Go", true)?;
    for (index, (id, label, accelerator)) in ITEMS.iter().enumerate() {
        // The Swift puts a divider after the palette and before the agent, which is what
        // separates "open the palette", "go somewhere" and "ask something".
        if index == 1 || index == 5 {
            go.append(&PredefinedMenuItem::separator(app)?)?;
        }
        go.append(&MenuItem::with_id(
            app,
            *id,
            *label,
            true,
            Some(*accelerator),
        )?)?;
    }

    menu.append(&go)?;
    Ok(menu)
}

/// Forwards a Go menu click to the webview, and ignores everything else.
///
/// The predefined items handle themselves, so anything whose id is not in `ITEMS` is not
/// ours to forward. Emitting it anyway would have the frontend guessing at ids it has
/// never heard of.
pub fn handle<R: Runtime>(app: &AppHandle<R>, id: &str) {
    if !ITEMS.iter().any(|(item, _, _)| *item == id) {
        return;
    }
    if let Err(error) = app.emit(EVENT, id) {
        eprintln!("could not emit {EVENT} for {id}: {error}");
    }
}
