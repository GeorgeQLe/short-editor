variable "aws_region" {
  type        = string
  description = "Customer data region; commercial beta is US-only."
  default     = "us-east-1"
  validation {
    condition     = var.aws_region == "us-east-1"
    error_message = "The commercial beta must be deployed in us-east-1."
  }
}

variable "environment" {
  type        = string
  description = "Isolated environment name."
  validation {
    condition     = contains(["development", "staging", "production"], var.environment)
    error_message = "Use development, staging, or production."
  }
}

variable "media_bucket_name" {
  type = string
}

variable "web_bucket_name" {
  type = string
}
