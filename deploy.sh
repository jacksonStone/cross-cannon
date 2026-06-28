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
cp -r build public scripts scripture-cache package.json package-lock.json README.md "$PACKAGE_DIR/"

zip -r -X "$ZIP_FILE" "$PACKAGE_DIR"

scp -i "$EC2_PEM_PATH" "$ZIP_FILE" ubuntu@"$EC2_PUBLIC_IP":/home/ubuntu/.temp/

ssh -i "$EC2_PEM_PATH" ubuntu@"$EC2_PUBLIC_IP" << EOF
  set -e
  export PATH="/home/ubuntu/.nvm/versions/node/v20.15.0/bin:\$PATH"
  cd /home/ubuntu
  if [ -d cross-cannon/storage ]; then
    rm -rf .temp/cross-cannon-storage
    mv cross-cannon/storage .temp/cross-cannon-storage
  fi
  rm -rf cross-cannon
  unzip -q .temp/$ZIP_FILE -d .
  rm .temp/$ZIP_FILE
  if [ -d .temp/cross-cannon-storage ]; then
    mv .temp/cross-cannon-storage cross-cannon/storage
  fi
  cd cross-cannon
  npm ci --omit=dev
  sudo systemctl restart cross-cannon
EOF

echo "Deployed cross-cannon"
