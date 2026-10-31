#!/usr/bin/env bash
# Install the GitHub Actions self-hosted runner that performs deploys on this host.
# Run as root (SSM Session Manager). The registration token comes from
# GitHub → repo Settings → Actions → Runners → New self-hosted runner (valid ~1 hour, single use).
#
#   sudo RUNNER_TOKEN=<token> bash setup-runner.sh
#
# Why a self-hosted runner: the class AWS Organization denies creating an IAM OIDC provider,
# and long-lived AWS access keys are forbidden by the SRS. The runner runs on the EC2 host and
# uses the instance role for AWS (SSM secrets), so no AWS credential is stored in GitHub.
set -euo pipefail

: "${RUNNER_TOKEN:?set RUNNER_TOKEN from the GitHub 'New self-hosted runner' page}"
REPO_URL="${REPO_URL:-https://github.com/DevHocTap/shopfast-module6}"
RUNNER_USER="${RUNNER_USER:-runner}"
RUNNER_NAME="${RUNNER_NAME:-shopfast-ec2}"
RUNNER_LABELS="${RUNNER_LABELS:-shopfast-prod}"
RUNNER_DIR="/home/$RUNNER_USER/actions-runner"

echo "Creating user $RUNNER_USER (docker group, owns /opt/shopfast)"
id "$RUNNER_USER" > /dev/null 2>&1 || useradd --create-home --shell /bin/bash "$RUNNER_USER"
usermod -aG docker "$RUNNER_USER"
chown -R "$RUNNER_USER:$RUNNER_USER" /opt/shopfast

VERSION=$(curl -fsSL https://api.github.com/repos/actions/runner/releases/latest | jq -r .tag_name | sed 's/^v//')
ARCH=$(uname -m | sed 's/x86_64/x64/; s/aarch64/arm64/')
echo "Downloading actions/runner v$VERSION ($ARCH)"
sudo -u "$RUNNER_USER" mkdir -p "$RUNNER_DIR"
curl -fsSL "https://github.com/actions/runner/releases/download/v$VERSION/actions-runner-linux-$ARCH-$VERSION.tar.gz" |
  sudo -u "$RUNNER_USER" tar xz -C "$RUNNER_DIR"

cd "$RUNNER_DIR"
sudo -u "$RUNNER_USER" ./config.sh --unattended --replace \
  --url "$REPO_URL" --token "$RUNNER_TOKEN" \
  --name "$RUNNER_NAME" --labels "$RUNNER_LABELS" --work _work

./svc.sh install "$RUNNER_USER"
./svc.sh start
./svc.sh status | head -5
echo "Runner '$RUNNER_NAME' registered with labels: self-hosted, $RUNNER_LABELS"
