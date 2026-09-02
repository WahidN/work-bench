use crate::keychain;
use reqwest::Method;
use serde_json::Value;
use std::sync::OnceLock;

const BASE: &str = "http://127.0.0.1:4173";

/// The bearer token, read once per app run.
///
/// `APIClient.makeRequest` in the Swift app reads the keychain on every single request,
/// and that is fine there because `SecItemCopyMatching` is an in-process call costing
/// microseconds. This client shells out to `/usr/bin/security`, which forks a process, so
/// copying that structure literally meant a subprocess per request: the query layer polls
/// five lists every 30 seconds, which is about 10 spawns a minute for as long as the app
/// is open.
///
/// So this diverges from the Swift on purpose. The observable behaviour is identical, a
/// bearer token on every request; only the number of processes changes. The cost is that a
/// token regenerated while the app is running needs a restart, and the engine only
/// generates one when the keychain has none.
static TOKEN: OnceLock<String> = OnceLock::new();

/// One client for the process, because the client owns the connection pool.
///
/// `reqwest::Client::new()` per request builds a fresh pool every time, so no connection
/// is ever reused and every request pays for a new TCP handshake. reqwest's own docs say
/// to hold on to the client.
static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

/// Cached on success only: a failed read must not be remembered, or an app that started
/// before the engine had written a token would never recover without a restart.
fn api_token() -> Result<&'static str, String> {
    if let Some(token) = TOKEN.get() {
        return Ok(token);
    }
    let token = keychain::read_api_token()?;
    Ok(TOKEN.get_or_init(|| token))
}

/// Every engine request goes through Rust rather than through the webview.
///
/// Two reasons, and the second is the better one. First, a Tauri window runs on a custom
/// protocol, so `http://127.0.0.1:4173` is cross-origin, and the engine sends no CORS
/// headers at all: `engine/src/api/server.ts` mounts `express.json`, the bearer check and
/// the routes, and nothing else. Measured during the spike, an unauthenticated request
/// comes back 401 with no `Access-Control-Allow-Origin` on it. Second, doing it here means
/// the bearer token never enters the webview.
async fn request(method: Method, path: &str, body: Option<Value>) -> Result<String, String> {
    // The spike allowlisted five paths so a half-built prototype could not merge a pull
    // request. That list is gone: with every screen ported it would name every route the
    // engine has and stop being a safeguard. What replaces it is the split into one
    // command per verb below, so a bug in the frontend cannot turn a read into a write by
    // supplying a method string.
    if !path.starts_with('/') {
        return Err(format!("path must start with a slash: {path}"));
    }

    let token = api_token()?;
    let mut builder = CLIENT
        .get_or_init(reqwest::Client::new)
        .request(method.clone(), format!("{BASE}{path}"))
        .bearer_auth(token);

    if let Some(json) = body {
        builder = builder.json(&json);
    }

    let response = builder
        .send()
        .await
        .map_err(|error| format!("engine unreachable: {error}"))?;

    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| format!("could not read body: {error}"))?;

    if !status.is_success() {
        // The engine answers errors as `{"error": "..."}`, so the body is the useful part
        // and the status alone would throw it away.
        return Err(format!("{method} {path} returned {status}: {text}"));
    }
    Ok(text)
}

#[tauri::command]
pub async fn engine_get(path: String) -> Result<String, String> {
    request(Method::GET, &path, None).await
}

#[tauri::command]
pub async fn engine_post(path: String, body: Option<Value>) -> Result<String, String> {
    request(Method::POST, &path, body).await
}

#[tauri::command]
pub async fn engine_patch(path: String, body: Option<Value>) -> Result<String, String> {
    request(Method::PATCH, &path, body).await
}

#[tauri::command]
pub async fn engine_put(path: String, body: Option<Value>) -> Result<String, String> {
    request(Method::PUT, &path, body).await
}

#[tauri::command]
pub async fn engine_delete(path: String) -> Result<String, String> {
    request(Method::DELETE, &path, None).await
}
