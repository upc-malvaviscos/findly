# ADR-002: Arquitectura serverless sin RDS ni VPC fija

## Estado

**ACEPTADO** (2026-09-03)

## Decisión

Findly usará API Gateway, Lambda, DynamoDB on-demand, S3, SQS y EventBridge. No utilizará RDS, EC2, NAT Gateway ni una VPC dedicada para el MVP.

## Consecuencias

La arquitectura evita costes fijos y reduce la operación de red. Los datos transaccionales y de estado se modelan en DynamoDB; los flujos asíncronos se desacoplan con SQS. Las integraciones AWS se autorizan mediante IAM de mínimo privilegio.
