#!/bin/bash
set -euo pipefail

APP_NAME="cross-cannon"
PACKAGE_DIR="${APP_NAME}"
ZIP_FILE="${APP_NAME}.zip"

cleanup() {
  rm -rf "$PACKAGE_DIR" "$ZIP_FILE"
}

cleanup
trap cleanup EXIT

npm run build

mkdir -p "$PACKAGE_DIR"
cp -r build public package.json package-lock.json README.md "$PACKAGE_DIR/"

(cd "$PACKAGE_DIR" && npm ci --omit=dev)

zip -r -X "$ZIP_FILE" "$PACKAGE_DIR"

scp -i "$EC2_PEM_PATH" "$ZIP_FILE" ubuntu@"$EC2_PUBLIC_IP":/home/ubuntu/.temp/

ssh -i "$EC2_PEM_PATH" ubuntu@"$EC2_PUBLIC_IP" << EOF
  set -e
  cd /home/ubuntu
  rm -rf cross-cannon
  unzip -q .temp/$ZIP_FILE -d .
  rm .temp/$ZIP_FILE
  sudo systemctl restart cross-cannon
EOF

echo "Deployed cross-cannon"
