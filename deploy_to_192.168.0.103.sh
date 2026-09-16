#!/bin/bash
# Deployment script to sync project to 192.168.0.103 at /opt/cctv_map on port 3001

REMOTE_HOST="192.168.0.103"
REMOTE_USER="${1:-itcm}"
REMOTE_DIR="/opt/cctv_map"
PORT="3003"
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== Deploying CCTV Map to $REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR ==="

# Sync files using rsync/scp
echo "1. Syncing project files to $REMOTE_HOST..."
rsync -avz --exclude='.git' --exclude='.claude' "$SOURCE_DIR/" "$REMOTE_USER@$REMOTE_HOST:/tmp/cctv_map_pkg/"

# Execute remote setup commands
echo "2. Setting up /opt/cctv_map and running service on port $PORT..."
ssh -t "$REMOTE_USER@$REMOTE_HOST" "
    sudo mkdir -p $REMOTE_DIR && \
    sudo cp -r /tmp/cctv_map_pkg/* $REMOTE_DIR/ && \
    sudo chown -R $REMOTE_USER:$REMOTE_USER $REMOTE_DIR && \
    sudo bash -c 'cat <<EOF > /etc/systemd/system/cctv-map.service
[Unit]
Description=CCTV Monitor Map Service
After=network.target mysql.service

[Service]
Type=simple
User=$REMOTE_USER
WorkingDirectory=$REMOTE_DIR
ExecStart=/usr/bin/php -S 0.0.0.0:$PORT -t $REMOTE_DIR
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF' && \
    sudo systemctl daemon-reload && \
    sudo systemctl enable cctv-map && \
    sudo systemctl restart cctv-map && \
    echo '=== Deployment Complete! Service running on http://$REMOTE_HOST:$PORT ==='
"
