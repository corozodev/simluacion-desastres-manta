# Image digests resolved and locally validated on 2026-10-26.
FROM golang:1.26.1-bookworm@sha256:ab3d6955bbc813a0f3fdf220c1d817dd89c0b3f283777db8ece4a32fe7858edd AS build
WORKDIR /src
ENV CGO_ENABLED=0 GOTOOLCHAIN=local
COPY services/evacuation/go.mod ./go.mod
COPY services/evacuation/internal ./internal
COPY services/evacuation/cmd ./cmd
COPY deploy/healthcheck/main.go /healthcheck.go
RUN go build -mod=readonly -trimpath -ldflags="-s -w" -o /out/server ./cmd/server \
    && go build -trimpath -ldflags="-s -w" -o /out/healthcheck /healthcheck.go

FROM debian:bookworm-slim@sha256:7ff6ba31527b9e336162fa061746c366c4b2032f4d2cff2078bea43f78efe3f8
WORKDIR /app
COPY --from=build /out/server /usr/local/bin/corodev-server
COPY --from=build /out/healthcheck /usr/local/bin/healthcheck
COPY --chown=65532:65532 services/evacuation/data ./data
COPY --chown=65532:65532 services/evacuation/scenarios ./scenarios
USER 65532:65532
ENV LISTEN_ADDR=0.0.0.0:8080 SIM_INTERVAL=2s GRAPH_PATH=data/manta-v2.json SCENARIO_PATH=scenarios/urban/round1.json
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 CMD ["/usr/local/bin/healthcheck"]
STOPSIGNAL SIGTERM
ENTRYPOINT ["/usr/local/bin/corodev-server"]
