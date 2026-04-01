output "service_url" {
  description = "Knowledge Scribe Cloud Run URL"
  value       = google_cloud_run_v2_service.scribe.uri
}

output "mcp_url" {
  description = "MCP endpoint for Claude Code config"
  value       = "${google_cloud_run_v2_service.scribe.uri}/mcp"
}

output "db_instance" {
  description = "Cloud SQL instance name (for cloud_sql_proxy)"
  value       = google_sql_database_instance.postgres.connection_name
}

output "db_private_ip" {
  description = "Cloud SQL private IP"
  value       = google_sql_database_instance.postgres.private_ip_address
}
