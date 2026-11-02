#!/usr/bin/env bash
# CloudWatch alarms for ShopFast (F07). Idempotent: re-running updates the alarms in place.
# Run once from AWS CloudShell (Sydney) or any shell with an admin profile — NOT from the EC2
# instance role, which deliberately has no cloudwatch:PutMetricAlarm permission.
#
#   INSTANCE_ID=i-0123456789abcdef0 ALERT_EMAIL=you@example.com ./infra/aws/alarms.sh
#
# Creates:
#   SNS topic shopfast-alerts (+ e-mail subscription: confirm the link AWS sends you)
#   shopfast-ec2-system-check   host hardware/network failed  → e-mail + automatic EC2 recovery
#   shopfast-ec2-instance-check OS unreachable                → e-mail
#   shopfast-cpu-high           CPU > 85 % for 15 minutes     → e-mail
#   shopfast-backup-missing     no successful backup in 26 h  → e-mail (backup.sh publishes the metric)
set -euo pipefail

: "${INSTANCE_ID:?set INSTANCE_ID (EC2 instance id)}"
: "${ALERT_EMAIL:?set ALERT_EMAIL (who receives alerts)}"
REGION="${AWS_REGION:-ap-southeast-2}" # the class SCP only allows Sydney
aws_() { aws --region "$REGION" "$@"; }

TOPIC_ARN=$(aws_ sns create-topic --name shopfast-alerts --query TopicArn --output text)
if ! aws_ sns list-subscriptions-by-topic --topic-arn "$TOPIC_ARN" \
  --query "Subscriptions[?Endpoint=='$ALERT_EMAIL'] | length(@)" --output text | grep -q '^[1-9]'; then
  aws_ sns subscribe --topic-arn "$TOPIC_ARN" --protocol email --notification-endpoint "$ALERT_EMAIL" > /dev/null
  echo "Subscription created: confirm the e-mail AWS sent to $ALERT_EMAIL"
fi

ec2_alarm() { # name metric threshold periods period description [extra actions...]
  local name=$1 metric=$2 threshold=$3 periods=$4 period=$5 description=$6
  shift 6
  aws_ cloudwatch put-metric-alarm --alarm-name "$name" --alarm-description "$description" \
    --namespace AWS/EC2 --metric-name "$metric" --dimensions "Name=InstanceId,Value=$INSTANCE_ID" \
    --statistic Maximum --period "$period" --evaluation-periods "$periods" \
    --threshold "$threshold" --comparison-operator GreaterThanOrEqualToThreshold \
    --treat-missing-data missing \
    --alarm-actions "$TOPIC_ARN" "$@" --ok-actions "$TOPIC_ARN"
  echo "✓ $name"
}

ec2_alarm shopfast-ec2-system-check StatusCheckFailed_System 1 2 60 \
  'AWS host problem: EC2 is recovered automatically onto healthy hardware' \
  "arn:aws:automate:$REGION:ec2:recover"
ec2_alarm shopfast-ec2-instance-check StatusCheckFailed_Instance 1 3 60 \
  'Operating system unreachable: check the instance console / reboot'

aws_ cloudwatch put-metric-alarm --alarm-name shopfast-cpu-high \
  --alarm-description 'CPU above 85% for 15 minutes: load test running, or the box is too small' \
  --namespace AWS/EC2 --metric-name CPUUtilization --dimensions "Name=InstanceId,Value=$INSTANCE_ID" \
  --statistic Average --period 300 --evaluation-periods 3 --threshold 85 \
  --comparison-operator GreaterThanThreshold --treat-missing-data missing \
  --alarm-actions "$TOPIC_ARN" --ok-actions "$TOPIC_ARN"
echo "✓ shopfast-cpu-high"

# backup.sh publishes ShopFast/BackupSucceeded=1 once a night. 26 hourly periods with no data point
# (missing = breaching) means a night was skipped; one successful backup makes the alarm OK again.
aws_ cloudwatch put-metric-alarm --alarm-name shopfast-backup-missing \
  --alarm-description 'No successful database backup to S3 in the last 26 hours' \
  --namespace ShopFast --metric-name BackupSucceeded --statistic Sum --period 3600 \
  --evaluation-periods 26 --datapoints-to-alarm 26 --threshold 1 \
  --comparison-operator LessThanThreshold --treat-missing-data breaching \
  --alarm-actions "$TOPIC_ARN" --ok-actions "$TOPIC_ARN"
echo "✓ shopfast-backup-missing"

echo
aws_ cloudwatch describe-alarms --alarm-name-prefix shopfast- \
  --query 'MetricAlarms[].[AlarmName,StateValue]' --output table
echo "Test the e-mail path: aws --region $REGION cloudwatch set-alarm-state --alarm-name shopfast-cpu-high --state-value ALARM --state-reason test"
