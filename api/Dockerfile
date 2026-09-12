FROM golang:1.22-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /out/api ./cmd

FROM alpine:3.20
RUN apk add --no-cache ca-certificates wget \
	&& adduser -D -H -u 65532 app
WORKDIR /app
COPY --from=build /out/api /app/api
USER 65532
EXPOSE 8088
HEALTHCHECK --interval=15s --timeout=3s --start-period=8s --retries=3 \
	CMD wget -qO- http://127.0.0.1:8088/v1/health >/dev/null || exit 1
ENTRYPOINT ["/app/api"]
