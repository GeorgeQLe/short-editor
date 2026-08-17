locals {
  prefix = "siftcut-${var.environment}"
  queue_visibility_ms = {
    ingest   = 900000
    analysis = 900000
    render   = 1800000
  }
}

resource "cloudflare_d1_database" "metadata" {
  account_id            = var.account_id
  name                  = "${local.prefix}-metadata"
  primary_location_hint = "enam"
}

resource "cloudflare_r2_bucket" "media" {
  account_id    = var.account_id
  name          = "${local.prefix}-media"
  location      = "enam"
  storage_class = "Standard"
}

resource "cloudflare_turnstile_widget" "beta_access" {
  account_id = var.account_id
  name       = "${local.prefix}-beta-access"
  domains    = [var.hostname]
  mode       = "managed"
}

resource "cloudflare_r2_bucket_lifecycle" "media" {
  account_id  = var.account_id
  bucket_name = cloudflare_r2_bucket.media.name
  rules = [
    {
      id         = "abort-incomplete-multipart-uploads"
      enabled    = true
      conditions = { prefix = "" }
      abort_multipart_uploads_transition = {
        condition = { max_age = 86400, type = "Age" }
      }
    },
    {
      id         = "expire-worker-scratch"
      enabled    = true
      conditions = { prefix = "temporary/" }
      delete_objects_transition = {
        condition = { max_age = 86400, type = "Age" }
      }
    }
  ]
}

resource "cloudflare_queue" "dead_letter" {
  for_each   = local.queue_visibility_ms
  account_id = var.account_id
  queue_name = "${local.prefix}-${each.key}-dlq"
  settings = {
    message_retention_period = 1209600
  }
}

resource "cloudflare_queue" "work" {
  for_each   = local.queue_visibility_ms
  account_id = var.account_id
  queue_name = "${local.prefix}-${each.key}"
  settings = {
    message_retention_period = 1209600
  }
}

resource "cloudflare_queue_consumer" "external_compute" {
  for_each          = local.queue_visibility_ms
  account_id        = var.account_id
  queue_id          = cloudflare_queue.work[each.key].queue_id
  type              = "http_pull"
  dead_letter_queue = cloudflare_queue.dead_letter[each.key].queue_name
  settings = {
    batch_size            = 1
    max_retries           = 5
    visibility_timeout_ms = each.value
  }
}

# Terraform owns the Worker identity and observability policy. Wrangler owns
# versions, code, static assets, and non-secret bindings for that identity.
resource "cloudflare_worker" "application" {
  account_id = var.account_id
  name       = var.worker_name
  subdomain = {
    enabled          = false
    previews_enabled = var.environment != "production"
  }
  observability = {
    enabled            = true
    head_sampling_rate = var.environment == "production" ? 0.1 : 1
    logs = {
      enabled            = true
      head_sampling_rate = 1
      invocation_logs    = true
      persist            = true
    }
    traces = {
      enabled            = true
      head_sampling_rate = var.environment == "production" ? 0.1 : 1
      persist            = true
    }
  }
  tags = ["siftcut", var.environment, "terraform-managed"]
}

resource "cloudflare_workers_route" "application" {
  zone_id = var.zone_id
  pattern = "${var.hostname}/*"
  script  = cloudflare_worker.application.name
}
