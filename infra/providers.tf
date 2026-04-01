terraform {
  required_version = ">= 1.5"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.8"
    }
  }

  backend "gcs" {
    prefix = "knowledge-scribe/"
  }
}

provider "google" {
  project = var.project
  region  = var.region
}
