#!/usr/bin/env bash
# Local HTTPS certificates for the Docker stack (browsers allow the camera only on https,
# except on localhost). Needs mkcert once: sudo dnf install mkcert nss-tools
set -euo pipefail

cd "$(dirname "$0")/.."
command -v mkcert >/dev/null || { echo "mkcert not found: sudo dnf install mkcert nss-tools" >&2; exit 1; }

mkcert -install  # trust the local CA in this machine's browsers (asks for your password once)

LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
mkdir -p certs
mkcert -cert-file certs/cert.pem -key-file certs/key.pem localhost 127.0.0.1 ::1 ${LAN_IP:+"$LAN_IP"}

echo "Certificates in certs/ (git-ignored). Open https://localhost${LAN_IP:+ or https://$LAN_IP}"
echo "Other devices must trust the CA too: $(mkcert -CAROOT)/rootCA.pem"
