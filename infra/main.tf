locals {
  service_name = "knowledge-scribe"
  registry     = "${var.region}-docker.pkg.dev/${var.project}/services"
  image        = "${local.registry}/${local.service_name}:${var.image_tag}"
  database_url = "postgresql://scribe:${var.db_password}@${google_sql_database_instance.postgres.private_ip_address}:5432/study_notifier"
}

# ── Artifact Registry ────────────────────────────────────────────────────────

resource "google_artifact_registry_repository" "services" {
  location      = var.region
  repository_id = "services"
  format        = "DOCKER"
  description   = "Knowledge scribe Docker images"
}

# ── Service Account ──────────────────────────────────────────────────────────

resource "google_service_account" "scribe" {
  account_id   = local.service_name
  display_name = "Knowledge Scribe"
}

resource "google_project_iam_member" "scribe_logging" {
  project = var.project
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.scribe.email}"
}

# ── Cloud Run Service ────────────────────────────────────────────────────────

resource "google_cloud_run_v2_service" "scribe" {
  name     = local.service_name
  location = var.region

  template {
    service_account = google_service_account.scribe.email

    vpc_access {
      connector = google_vpc_access_connector.main.id
      egress    = "PRIVATE_RANGES_ONLY"
    }

    scaling {
      min_instance_count = 0
      max_instance_count = 3
    }

    containers {
      image = local.image

      ports {
        container_port = 3000
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }

      startup_probe {
        http_get {
          path = "/api/health"
        }
        initial_delay_seconds = 2
        period_seconds        = 5
        failure_threshold     = 3
      }

      liveness_probe {
        http_get {
          path = "/api/health"
        }
        period_seconds = 30
      }

      env {
        name  = "DATABASE_URL"
        value = local.database_url
      }
      env {
        name  = "ANTHROPIC_API_KEY"
        value = var.anthropic_api_key
      }
      env {
        name  = "OPENAI_API_KEY"
        value = var.openai_api_key
      }
      env {
        name  = "TEAM_TOKEN"
        value = var.team_token
      }
      env {
        name  = "GITHUB_TOKEN"
        value = var.github_token
      }
      env {
        name  = "PORT"
        value = "3000"
      }
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }

  depends_on = [
    google_artifact_registry_repository.services,
    google_sql_database.study_notifier,
    google_sql_user.scribe,
  ]
}

# ── Public access (MCP clients + Electron app need to reach it) ──────────────

resource "google_cloud_run_v2_service_iam_member" "public" {
  name     = google_cloud_run_v2_service.scribe.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}
