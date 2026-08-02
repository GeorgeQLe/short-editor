data "aws_caller_identity" "current" {}

resource "aws_kms_key" "customer_data" {
  description             = "SiftCut ${var.environment} customer data"
  deletion_window_in_days = 30
  enable_key_rotation     = true
}

resource "aws_kms_alias" "customer_data" {
  name          = "alias/siftcut-${var.environment}-customer-data"
  target_key_id = aws_kms_key.customer_data.key_id
}

resource "aws_s3_bucket" "media" {
  bucket = var.media_bucket_name
}

resource "aws_s3_bucket_public_access_block" "media" {
  bucket                  = aws_s3_bucket.media.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "media" {
  bucket = aws_s3_bucket.media.id
  rule {
    apply_server_side_encryption_by_default {
      kms_master_key_id = aws_kms_key.customer_data.arn
      sse_algorithm     = "aws:kms"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "media" {
  bucket = aws_s3_bucket.media.id
  rule {
    id     = "cleanup-incomplete-work"
    status = "Enabled"
    abort_incomplete_multipart_upload { days_after_initiation = 1 }
    filter { prefix = "" }
  }
  rule {
    id     = "cleanup-worker-temporary-objects"
    status = "Enabled"
    expiration { days = 1 }
    filter { prefix = "temporary/" }
  }
}

resource "aws_s3_bucket" "web" {
  bucket = var.web_bucket_name
}

resource "aws_s3_bucket_public_access_block" "web" {
  bucket                  = aws_s3_bucket.web.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

locals {
  queues = toset(["ingest", "analysis", "render"])
}

resource "aws_sqs_queue" "dead_letter" {
  for_each                  = local.queues
  name                      = "siftcut-${var.environment}-${each.key}-dlq"
  kms_master_key_id         = aws_kms_key.customer_data.arn
  message_retention_seconds = 1209600
}

resource "aws_sqs_queue" "work" {
  for_each                   = local.queues
  name                       = "siftcut-${var.environment}-${each.key}"
  kms_master_key_id          = aws_kms_key.customer_data.arn
  visibility_timeout_seconds = each.key == "render" ? 1800 : 900
  receive_wait_time_seconds  = 20
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dead_letter[each.key].arn
    maxReceiveCount     = 5
  })
}

resource "aws_cloudwatch_log_group" "services" {
  for_each          = toset(["api", "ingest-worker", "analysis-worker", "render-worker"])
  name              = "/siftcut/${var.environment}/${each.key}"
  retention_in_days = 30
  kms_key_id        = aws_kms_key.customer_data.arn
}

resource "aws_cloudwatch_metric_alarm" "oldest_message" {
  for_each            = local.queues
  alarm_name          = "siftcut-${var.environment}-${each.key}-oldest-message"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateAgeOfOldestMessage"
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 2
  threshold           = each.key == "render" ? 1800 : 900
  comparison_operator = "GreaterThanThreshold"
  dimensions = {
    QueueName = aws_sqs_queue.work[each.key].name
  }
}

resource "aws_secretsmanager_secret" "service_credentials" {
  name       = "siftcut/${var.environment}/service-credentials"
  kms_key_id = aws_kms_key.customer_data.arn
}
