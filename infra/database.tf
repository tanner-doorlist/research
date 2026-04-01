# ── VPC + Private Services Access (Cloud SQL private IP) ─────────────────────

resource "google_compute_network" "main" {
  name                    = "knowledge-scribe"
  auto_create_subnetworks = true
}

resource "google_compute_global_address" "private_ip" {
  name          = "knowledge-scribe-db-ip"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = google_compute_network.main.id
}

resource "google_service_networking_connection" "private" {
  network                 = google_compute_network.main.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_ip.name]
}

# ── Cloud SQL (Postgres 17 + pgvector) ───────────────────────────────────────

resource "google_sql_database_instance" "postgres" {
  name             = "knowledge-scribe-db"
  database_version = "POSTGRES_17"
  region           = var.region

  depends_on = [google_service_networking_connection.private]

  settings {
    tier              = "db-f1-micro"
    availability_type = "ZONAL"
    disk_size         = 10
    disk_autoresize   = true

    ip_configuration {
      ipv4_enabled                                  = false
      private_network                               = google_compute_network.main.id
      enable_private_path_for_google_cloud_services = true
    }

    database_flags {
      name  = "cloudsql.enable_pgvector"
      value = "on"
    }

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
      start_time                     = "04:00"
      backup_retention_settings {
        retained_backups = 7
      }
    }
  }

  deletion_protection = true
}

resource "google_sql_database" "study_notifier" {
  name     = "study_notifier"
  instance = google_sql_database_instance.postgres.name
}

resource "google_sql_user" "scribe" {
  name     = "scribe"
  instance = google_sql_database_instance.postgres.name
  password = var.db_password
}

# ── VPC Connector (Cloud Run → Cloud SQL over private network) ───────────────

resource "google_vpc_access_connector" "main" {
  name          = "knowledge-scribe-vpc"
  region        = var.region
  network       = google_compute_network.main.name
  ip_cidr_range = "10.8.0.0/28"
  min_instances = 2
  max_instances = 3
}
