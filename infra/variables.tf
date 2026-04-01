variable "project" {
  description = "GCP project ID"
  type        = string
  default     = "doorlistdev"
}

variable "region" {
  description = "GCP region"
  type        = string
  default     = "us-central1"
}

variable "image_tag" {
  description = "Docker image tag (git SHA or 'latest')"
  type        = string
  default     = "latest"
}

# ── Secrets (pass via tfvars or env TF_VAR_*) ────────────────────────────────

variable "db_password" {
  description = "Password for the 'scribe' Postgres user"
  type        = string
  sensitive   = true
}

variable "anthropic_api_key" {
  description = "Anthropic API key for Claude calls"
  type        = string
  sensitive   = true
}

variable "openai_api_key" {
  description = "OpenAI API key for embeddings"
  type        = string
  sensitive   = true
}

variable "team_token" {
  description = "Bearer token for authenticating clients"
  type        = string
  sensitive   = true
}

variable "github_token" {
  description = "GitHub token for PR review tool"
  type        = string
  sensitive   = true
  default     = ""
}
