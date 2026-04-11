//! DCT TLSNotary Prover API
//!
//! Thin HTTP wrapper around the TLSNotary prover crate.
//! Exposes POST /prove so the Node.js server (server/lib/tlsn/prover.mjs)
//! can request real TLSNotary proofs without embedding Rust in the JS runtime.
//!
//! Flow:
//!   POST /prove  { url, method, headers, body?, secretRanges?, revealRanges? }
//!      → connects to notary via WebSocket
//!      → runs MPC-TLS with the target server
//!      → produces a signed attestation / presentation
//!      → returns proof JSON + sessionHash + notarySignatureHex
//!
//! Environment variables:
//!   NOTARY_HOST   (default: localhost)
//!   NOTARY_PORT   (default: 7047)
//!   PROVER_PORT   (default: 9080)
//!   RUST_LOG      (default: info)

use axum::{
    extract::Json,
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::net::SocketAddr;
use tower_http::cors::CorsLayer;
use tracing::{error, info};

// ── Request / Response types ──────────────────────────────────────────────

#[derive(Deserialize)]
struct ProveRequest {
    url: String,
    method: Option<String>,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
}

#[derive(Serialize)]
struct ProveResponse {
    url: String,
    method: String,
    status_code: u16,
    response_preview: String,
    session_hash: String,
    notary_signature_hex: String,
    notary_url: String,
    proof_json: String,
    backend: String,
}

#[derive(Serialize)]
struct ErrorResponse {
    error: String,
}

// ── Health check ──────────────────────────────────────────────────────────

async fn health() -> impl IntoResponse {
    let notary_host = std::env::var("NOTARY_HOST").unwrap_or_else(|_| "localhost".into());
    let notary_port = std::env::var("NOTARY_PORT").unwrap_or_else(|_| "7047".into());
    axum::Json(serde_json::json!({
        "status": "ok",
        "backend": "rust-prover-api",
        "notary": format!("{}:{}", notary_host, notary_port),
    }))
}

// ── Prove endpoint ────────────────────────────────────────────────────────

async fn prove(Json(req): Json<ProveRequest>) -> impl IntoResponse {
    let method = req.method.as_deref().unwrap_or("GET").to_uppercase();
    let notary_host = std::env::var("NOTARY_HOST").unwrap_or_else(|_| "localhost".into());
    let notary_port: u16 = std::env::var("NOTARY_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(7047);

    info!("Proving {} {} via notary {}:{}", method, req.url, notary_host, notary_port);

    match run_proof(&req.url, &method, &req.headers, &req.body, &notary_host, notary_port).await {
        Ok(resp) => (StatusCode::OK, axum::Json(serde_json::to_value(resp).unwrap())).into_response(),
        Err(e) => {
            error!("Proof failed: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                axum::Json(serde_json::json!({ "error": e })),
            )
                .into_response()
        }
    }
}

// ── Core TLSNotary proof logic ────────────────────────────────────────────

async fn run_proof(
    url: &str,
    method: &str,
    headers: &Option<HashMap<String, String>>,
    body: &Option<String>,
    notary_host: &str,
    notary_port: u16,
) -> Result<ProveResponse, String> {
    use tlsn_core::presentation::Presentation;
    use tlsn_prover::{Prover, ProverConfig};

    let parsed = url::Url::parse(url).map_err(|e| format!("Invalid URL: {e}"))?;
    let server_name = parsed.host_str().ok_or("No host in URL")?.to_string();
    let server_port = parsed.port_or_known_default().ok_or("Unknown port")?;

    // ── Connect to notary WebSocket ───────────────────────────────────────
    let notary_url = format!("ws://{}:{}/notarize", notary_host, notary_port);
    info!("Connecting to notary at {}", notary_url);

    // Open TCP connection to notary
    let notary_tcp = tokio::net::TcpStream::connect((notary_host, notary_port))
        .await
        .map_err(|e| format!("Cannot connect to notary: {e}"))?;

    // Setup session via notary REST API
    let http_notary_url = format!("http://{}:{}", notary_host, notary_port);
    let session_resp = reqwest::Client::new()
        .post(format!("{}/session", http_notary_url))
        .json(&serde_json::json!({ "clientType": "Tcp", "maxTranscriptSize": 32768 }))
        .send()
        .await
        .map_err(|e| format!("Notary session init failed: {e}"))?;

    let session: serde_json::Value = session_resp
        .json()
        .await
        .map_err(|e| format!("Notary session parse failed: {e}"))?;
    let session_id = session["sessionId"]
        .as_str()
        .ok_or("No sessionId in notary response")?
        .to_string();

    info!("Notary session id: {}", session_id);

    // ── Build prover config ───────────────────────────────────────────────
    let prover_config = ProverConfig::builder()
        .id(&session_id)
        .server_dns(&server_name)
        .build()
        .map_err(|e| format!("Prover config error: {e}"))?;

    let prover = Prover::new(prover_config)
        .setup(notary_tcp.compat())
        .await
        .map_err(|e| format!("Prover setup failed: {e}"))?;

    // ── Connect to target server via MPC-TLS ─────────────────────────────
    let target_tcp = tokio::net::TcpStream::connect((server_name.as_str(), server_port))
        .await
        .map_err(|e| format!("Cannot connect to target: {e}"))?;

    let (mpc_tls_connection, prover_fut) = prover
        .connect(target_tcp.compat())
        .await
        .map_err(|e| format!("MPC-TLS connect failed: {e}"))?;

    // Drive prover in background
    let prover_task = tokio::spawn(prover_fut);

    // ── Make HTTP request through MPC-TLS ─────────────────────────────────
    let (mut request_sender, connection) =
        hyper::client::conn::http1::handshake(mpc_tls_connection)
            .await
            .map_err(|e| format!("HTTP handshake failed: {e}"))?;
    tokio::spawn(connection);

    let path = parsed.path().to_string()
        + if let Some(q) = parsed.query() { &format!("?{q}") } else { "" };

    let mut req_builder = hyper::Request::builder()
        .method(method)
        .uri(&path)
        .header("Host", &server_name)
        .header("Connection", "close")
        .header("Accept", "*/*");

    if let Some(hdrs) = headers {
        for (k, v) in hdrs {
            req_builder = req_builder.header(k.as_str(), v.as_str());
        }
    }

    let request = req_builder
        .body(match body {
            Some(b) => http_body_util::Full::new(bytes::Bytes::from(b.clone())),
            None => http_body_util::Full::new(bytes::Bytes::new()),
        })
        .map_err(|e| format!("Request build failed: {e}"))?;

    let response = request_sender
        .send_request(request)
        .await
        .map_err(|e| format!("HTTP request failed: {e}"))?;

    let status_code = response.status().as_u16();

    use http_body_util::BodyExt;
    let body_bytes = response
        .collect()
        .await
        .map_err(|e| format!("Response body failed: {e}"))?
        .to_bytes();
    let response_text = String::from_utf8_lossy(&body_bytes).to_string();
    let response_preview = response_text.chars().take(500).collect::<String>();

    // ── Notarize ──────────────────────────────────────────────────────────
    let prover = prover_task
        .await
        .map_err(|e| format!("Prover task panicked: {e}"))?
        .map_err(|e| format!("Prover failed: {e}"))?;

    let mut prover = prover.start_notarize();

    // Reveal sent + received transcript (selective disclosure — reveal all in demo)
    let (sent_len, recv_len) = prover.transcript().len();
    prover
        .transcript_mut()
        .reveal_sent(&(0..sent_len))
        .map_err(|e| format!("Reveal sent failed: {e}"))?;
    prover
        .transcript_mut()
        .reveal_recv(&(0..recv_len))
        .map_err(|e| format!("Reveal recv failed: {e}"))?;

    let notarized = prover
        .finalize()
        .await
        .map_err(|e| format!("Finalize failed: {e}"))?;

    // ── Build presentation (proof) ────────────────────────────────────────
    let presentation: Presentation = notarized
        .presentation_builder()
        .build()
        .map_err(|e| format!("Presentation build failed: {e}"))?;

    let proof_json = serde_json::to_string(&presentation)
        .map_err(|e| format!("Proof serialize failed: {e}"))?;

    // Extract notary signature from presentation header
    let sig_bytes = presentation.signature().to_bytes();
    let notary_signature_hex = hex::encode(sig_bytes);

    // sessionHash = SHA-256 of the proof JSON (stable, deterministic)
    let mut hasher = Sha256::new();
    hasher.update(proof_json.as_bytes());
    let session_hash = format!("0x{}", hex::encode(hasher.finalize()));

    let notary_url_str = format!("http://{}:{}", notary_host, notary_port);

    info!(
        "Proof complete: status={}, proof_len={}, sig={}...",
        status_code,
        proof_json.len(),
        &notary_signature_hex[..16]
    );

    Ok(ProveResponse {
        url: url.to_string(),
        method: method.to_string(),
        status_code,
        response_preview,
        session_hash,
        notary_signature_hex,
        notary_url: notary_url_str,
        proof_json,
        backend: "rust-prover-api".to_string(),
    })
}

// ── Main ──────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "info".into()),
        )
        .init();

    let port: u16 = std::env::var("PROVER_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(9080);

    let app = Router::new()
        .route("/health", get(health))
        .route("/prove", post(prove))
        .layer(CorsLayer::permissive());

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    info!("DCT TLSNotary Prover API listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
