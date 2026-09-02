/*!
The Tauri commands behind Settings' engine token field.

Three commands rather than one, matching `KeychainClient.swift`: reading happens on every
engine request, writing happens when someone pastes a token, and deleting happens when they
disconnect. Collapsing them into one command with a mode would let a frontend bug overwrite
the token on a path that only meant to read it.

The read answers whether a token is there and how long it is, never the token. There is no
screen that needs to show it, and a secret that reaches the webview can end up in a
devtools panel or a crash report.
*/

use crate::keychain;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenState {
    pub has_token: bool,
    /// So Settings can say "a 64-character token is stored" without showing it.
    pub length: usize,
}

#[tauri::command]
pub fn engine_token_state() -> TokenState {
    match keychain::read_api_token() {
        Ok(token) => TokenState {
            has_token: true,
            length: token.len(),
        },
        Err(_) => TokenState {
            has_token: false,
            length: 0,
        },
    }
}

#[tauri::command]
pub fn engine_token_write(token: String) -> Result<TokenState, String> {
    keychain::write_api_token(&token)?;
    Ok(engine_token_state())
}

#[tauri::command]
pub fn engine_token_delete() -> Result<TokenState, String> {
    keychain::delete_api_token()?;
    Ok(engine_token_state())
}
