# AWS Cloud Labs - Guide de Revision

Ce depot contient 10 labs progressifs pour apprendre les services AWS (Master 2 Ynov).

## Structure du depot

```
labs/
  00-setup/              -> Configuration environnement AWS (CLI, SSO)
  01-ec2-basics/         -> Instances EC2, CloudFormation, VPC
  02-s3-basics/          -> Stockage objets S3, SDK TypeScript
  03-api-gateway-basics/ -> REST API, integration directe S3
  04-dynamodb-basics/    -> Base NoSQL, SDK TypeScript
  05-projet-capstone-one/-> Projet integrant API GW + DynamoDB + S3
  06-demo-loadbalancing-asg/ -> ALB + Auto Scaling Group
  07-lambda-basics/      -> Lambda, EventBridge, DynamoDB Streams
  08-ecs-basics/         -> ECS Fargate, ECR, conteneurs
  09-cost-estimation/    -> Estimation des couts AWS
```

## Services AWS couverts

| Categorie | Services |
|-----------|----------|
| Compute | EC2, Lambda, ECS, Fargate |
| Stockage | S3, DynamoDB, RDS (theorie) |
| Reseau | VPC, ALB, NAT Gateway, IGW, CloudFront |
| API | API Gateway |
| Conteneurs | ECR, Docker |
| Evenementiel | EventBridge, DynamoDB Streams |
| IaC | CloudFormation |
| Securite | IAM, Security Groups, SSO |
| Monitoring | CloudWatch |
| Scaling | Auto Scaling Groups |

## Patterns architecturaux

1. **Serverless** : API Gateway -> DynamoDB + S3 (Lab 05)
2. **Event-Driven** : EventBridge/Streams -> Lambda -> S3 (Lab 07)
3. **Containerise** : ALB -> ECS Fargate -> ECR (Lab 08)
4. **Load-Balanced** : ALB -> Auto Scaling Group EC2 (Lab 06)
5. **Integration directe** : API Gateway -> S3 sans compute (Lab 03)

## Stack technique

- **Langage** : TypeScript, AWS SDK v3
- **IaC** : CloudFormation (YAML)
- **Tests** : Jest
- **Conteneurs** : Docker, Buildx
- **Dev** : VS Code Dev Containers

## Convention pour la revision

Chaque lab possede son propre CLAUDE.md avec :
- Les concepts cles a maitriser
- Les questions de revision (flashcards)
- Les points d'attention pour l'examen
- Les commandes AWS CLI importantes

Pour reviser, demande-moi de te quizzer sur un lab specifique ou sur l'ensemble des notions.
