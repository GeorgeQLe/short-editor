output "wrangler_bindings" {
  description = "Non-secret inputs used to render wrangler.generated.jsonc."
  value = {
    worker_name = cloudflare_worker.application.name
    database = {
      binding       = "DB"
      database_name = cloudflare_d1_database.metadata.name
      database_id   = cloudflare_d1_database.metadata.id
    }
    media = {
      binding     = "MEDIA"
      bucket_name = cloudflare_r2_bucket.media.name
    }
    queues = {
      for name, queue in cloudflare_queue.work : name => {
        binding    = "${upper(name)}_QUEUE"
        queue_name = queue.queue_name
        queue_id   = queue.queue_id
      }
    }
    public_base_url    = "https://${var.hostname}"
    environment        = var.environment
    turnstile_site_key = cloudflare_turnstile_widget.beta_access.sitekey
  }
}

output "http_pull_queues" {
  value = { for name, queue in cloudflare_queue.work : name => {
    queue_id = queue.queue_id
    dlq_id   = cloudflare_queue.dead_letter[name].queue_id
  } }
}
