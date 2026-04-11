# Multi-stage Rust build for DCT TLSNotary Prover API
FROM rust:1.82-slim-bookworm AS builder

WORKDIR /app

# Cache dependencies
COPY Cargo.toml ./
RUN mkdir src && echo "fn main(){}" > src/main.rs
RUN cargo build --release 2>/dev/null || true
RUN rm src/main.rs

# Build the actual binary
COPY src ./src
RUN cargo build --release

# ── Runtime image ──────────────────────────────────────────────────────────
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app/target/release/prover-api ./prover-api

ENV NOTARY_HOST=notary
ENV NOTARY_PORT=7047
ENV PROVER_PORT=9080
ENV RUST_LOG=info

EXPOSE 9080

HEALTHCHECK --interval=10s --timeout=5s --retries=5 \
    CMD curl -sf http://localhost:9080/health || exit 1

ENTRYPOINT ["./prover-api"]
