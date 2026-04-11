# WebSocket→TCP proxy for TLSNotary browser prover (tlsn-js).
# Binds WebSocket on 55688 and forwards to REAL_SERVER_ADDR (e.g. example.com:443).
FROM rust:1-slim-bookworm AS build
RUN apt-get update && apt-get install -y pkg-config libssl-dev \
  && rm -rf /var/lib/apt/lists/*
RUN cargo install wstcp --version 0.2.0

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /usr/local/cargo/bin/wstcp /usr/local/bin/wstcp
EXPOSE 55688
ENTRYPOINT ["/usr/local/bin/wstcp"]
