mock_provider "aws" {
  mock_data "aws_caller_identity" {
    defaults = {
      account_id = "123456789012"
    }
  }
  mock_resource "aws_cloudfront_distribution" {
    override_during = plan
    defaults = {
      domain_name = "d-demo-test.cloudfront.net"
    }
  }
}

variables {
  enable_web          = true
  web_bucket_name     = "findly-demo-web-test"
  uploads_bucket_name = "findly-demo-uploads-test"
  frontend_domain_url = "https://placeholder.example"
  data_class          = "biometric"
}

run "default_domain" {
  command = plan

  assert {
    condition     = output.frontend_origin == "https://d-demo-test.cloudfront.net"
    error_message = "Demo must use the generated CloudFront HTTPS origin instead of a placeholder."
  }
}

run "custom_domain" {
  command = plan
  variables {
    web_domain_name     = "demo.example.com"
    web_certificate_arn = "arn:aws:acm:us-east-1:123456789012:certificate/00000000-0000-0000-0000-000000000000"
  }
  assert {
    condition     = output.frontend_origin == "https://demo.example.com"
    error_message = "Custom domains must remain the exact frontend origin."
  }
}

run "local_frontend" {
  command = plan
  variables {
    enable_web          = false
    frontend_domain_url = "http://127.0.0.1:5173"
  }
  assert {
    condition     = output.frontend_origin == "http://127.0.0.1:5173"
    error_message = "Local frontends must retain their configured origin."
  }
}
