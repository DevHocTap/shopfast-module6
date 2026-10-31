#!/usr/bin/env bash
# Run a shell command on the EC2 instance through SSM Run Command and stream the result.
# CI never opens SSH: the deploy role may only call ssm:SendCommand on the tagged instance.
#   ssm-run.sh "<command>"      (uses $INSTANCE_ID, $AWS_REGION)
set -euo pipefail

COMMAND="${1:?usage: ssm-run.sh <command>}"
PARAMS=$(jq -n --arg c "$COMMAND" '{commands: [$c], executionTimeout: ["900"]}')

COMMAND_ID=$(aws ssm send-command \
  --instance-ids "$INSTANCE_ID" \
  --document-name AWS-RunShellScript \
  --comment "shopfast ${GITHUB_RUN_ID:-manual}" \
  --parameters "$PARAMS" \
  --query Command.CommandId --output text)
echo "SSM command $COMMAND_ID"

STATUS=Pending
for _ in $(seq 1 180); do
  sleep 5
  STATUS=$(aws ssm get-command-invocation --command-id "$COMMAND_ID" --instance-id "$INSTANCE_ID" \
    --query Status --output text 2> /dev/null || echo Pending)
  case "$STATUS" in
    Pending | InProgress | Delayed) continue ;;
    *) break ;;
  esac
done

aws ssm get-command-invocation --command-id "$COMMAND_ID" --instance-id "$INSTANCE_ID" \
  --query '[StandardOutputContent, StandardErrorContent]' --output text || true
echo "SSM status: $STATUS"
[ "$STATUS" = Success ]
