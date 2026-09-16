#!/bin/bash
# Setup script for CCTV Monitor Map on port 3001 at /opt/cctv_map

TARGET_DIR="/opt/cctv_map"
PORT="3003"
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== Setting up CCTV Monitor Map in $TARGET_DIR ==="

# Create directory if it doesn't exist
if [ ! -d "$TARGET_DIR" ]; then
    echo "Creating directory $TARGET_DIR..."
    if [ "$EUID" -ne 0 ]; then
        sudo mkdir -p "$TARGET_DIR"
        sudo chown -R $USER:$USER "$TARGET_DIR"
    else
        mkdir -p "$TARGET_DIR"
    fi
fi

# Copy project files
echo "Copying project files to $TARGET_DIR..."
cp -r "$SOURCE_DIR"/* "$TARGET_DIR"/
chmod -R 755 "$TARGET_DIR"

echo "Project files copied successfully."

# Start background server
echo "Starting PHP web server on 0.0.0.0:$PORT..."
pkill -f "php -S 0.0.0.0:$PORT" 2>/dev/null || true
nohup php -S 0.0.0.0:$PORT -t "$TARGET_DIR" > "$TARGET_DIR/server.log" 2>&1 &

echo "=== Setup complete! ==="
echo "Access local app at: http://localhost:$PORT or http://$(hostname -I | awk '{print $1}'):$PORT"
