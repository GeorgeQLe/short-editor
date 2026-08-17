terraform {
  required_version = ">= 1.8.0"

  # Bootstrap this private R2 bucket separately, then initialize with
  # `terraform init -backend-config=backend.s3.tfbackend`. Credentials are
  # supplied only through AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY.
  backend "s3" {
    key                         = "siftcut/platform.tfstate"
    region                      = "auto"
    skip_credentials_validation = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_metadata_api_check     = true
    skip_s3_checksum            = true
    use_path_style              = true
    use_lockfile                = true
  }

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.22.0"
    }
  }
}

provider "cloudflare" {}
