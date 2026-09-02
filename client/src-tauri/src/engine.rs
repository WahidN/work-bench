use crate::keychain;
use reqwest::Method;
use serde_json::Value;

const BASE: &str = "http://127.0.0.1:4173";

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

    let token = keychain::read_api_token()?;
    let mut builder = reqwest::Client::new()
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
