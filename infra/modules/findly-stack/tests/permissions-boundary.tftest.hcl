mock_provider "aws" {}

variables {
  environment         = "production"
  frontend_domain_url = "https://findly.example.com"
  uploads_bucket_name = "findly-production-uploads-test"
}

run "production_without_boundary_rejected" {
  command         = plan
  expect_failures = [output._permissions_boundary_guard]
}

run "production_with_boundary_accepted" {
  command = plan
  variables {
    permissions_boundary_arn = "arn:aws:iam::123456789012:policy/findly-production-runtime-boundary"
  }
}

run "non_production_without_boundary_accepted" {
  command = plan
  variables {
    environment = "sandbox"
  }
}
