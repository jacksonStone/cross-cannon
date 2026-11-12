# syntax=docker/dockerfile:1
FROM rust:1.99.1-bookworm@sha256:e6f2cff35d0f309acf8433b4f05878ed77092602c5065cc81801177da0bb3a9c AS build
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY rust ./rust
ARG SOURCE_REVISION=working-tree

# Integration tests use private local indexes and run in npm run verify.
# These Linux tests need no production data or credentials.
RUN --mount=type=cache,id=cross-canon-api-registry,target=/usr/local/cargo/registry \
    --mount=type=cache,id=cross-canon-api-git,target=/usr/local/cargo/git \
    --mount=type=cache,id=cross-canon-api-linux-amd64,target=/src/target \
    test "$(uname -m)" = x86_64 && \
    cargo test --locked --release -p r-cross-cannon -j 2 -- \
      --skip actual_readonly_indexes && \
    cargo build --locked --release -p r-cross-cannon -j 2 && \
    mkdir -p /out/target/release /out/rust/deploy && \
    install -m 755 target/release/r-cross-cannon /out/target/release/r-cross-cannon && \
    install -m 644 rust/deploy/r-cross-cannon.service /out/rust/deploy/r-cross-cannon.service && \
    { rustc --version; cargo --version; printf 'platform=linux/amd64\nsource_revision=%s\n' "$SOURCE_REVISION"; } > /out/BUILD-INFO && \
    cd /out && sha256sum target/release/r-cross-cannon rust/deploy/r-cross-cannon.service BUILD-INFO > SHA256SUMS

# Export release files only. This is not a production runtime container.
FROM scratch AS artifact
COPY --from=build /out/ /
