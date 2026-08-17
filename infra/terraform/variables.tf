variable "account_id" {
  type        = string
  description = "Cloudflare account ID."
}

variable "zone_id" {
  type        = string
  description = "Cloudflare zone ID used for the application route."
}

variable "hostname" {
  type        = string
  description = "Version-aligned SPA and API hostname."
}

variable "environment" {
  type        = string
  description = "Isolated environment name."
  validation {
    condition     = contains(["development", "staging", "production"], var.environment)
    error_message = "Use development, staging, or production."
  }
}

variable "worker_name" {
  type        = string
  description = "Exact Worker script name bound by EnvBank and deployed by Wrangler."
}
