output "media_bucket_arn" {
  value = aws_s3_bucket.media.arn
}

output "queue_urls" {
  value = { for name, queue in aws_sqs_queue.work : name => queue.url }
}

output "customer_data_key_arn" {
  value = aws_kms_key.customer_data.arn
}
