import {
  BatchWriteItemCommand,
  CreateTableCommand,
  DeleteItemCommand,
  DescribeTableCommand,
  DynamoDBClient,
  PutItemCommand,
} from '@aws-sdk/client-dynamodb';
import {
  type BucketLocationConstraint,
  CreateBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  CreateDeploymentCommand,
  CreateResourceCommand,
  CreateRestApiCommand,
  GetResourcesCommand,
  PutIntegrationCommand,
  PutIntegrationResponseCommand,
  PutMethodCommand,
  PutMethodResponseCommand,
  APIGatewayClient,
} from '@aws-sdk/client-api-gateway';
import { execSync } from 'child_process';
import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import { stateFilePath, saveState } from './shared/state';
import { sleep } from './shared/utils';
import type { ShipItem, DeploymentState } from './shared/types';

const region = process.env['AWS_REGION'] ?? process.env['AWS_DEFAULT_REGION'] ?? 'eu-west-1';
const stageName = 'dev';
const suffix = Date.now().toString();
const bucketName = `ships-capstone-${suffix}`;
const tableName = `ships-capstone-table-${suffix}`;
const apiName = `ships-capstone-api-${suffix}`;
const shipsDataPath = path.resolve(__dirname, '../data/ships.json');
const assetsDirPath = path.resolve(__dirname, '../assets');

const dynamoClient = new DynamoDBClient({ region });
const s3Client = new S3Client({ region });
const apiGatewayClient = new APIGatewayClient({ region });

const scanResponseTemplate = String.raw`#set($inputRoot = $input.path('$'))
{
  "ships": [
#foreach($item in $inputRoot.Items)
    {
      "id": "$item.id.S",
      "nom": "$item.nom.S",
      "type": "$item.type.S",
      "pavillon": "$item.pavillon.S",
      "taille": $item.taille.N,
      "nombre_marins": $item.nombre_marins.N,
      "s3_image_key": "$item.s3_image_key.S"
    }#if($foreach.hasNext),#end
#end
  ]
}`;

const getItemResponseTemplate = String.raw`#set($item = $input.path('$.Item'))
#if($item == "")
#set($context.responseOverride.status = 404)
{
  "message": "Ship not found"
}
#else
{
  "id": "$item.id.S",
  "nom": "$item.nom.S",
  "type": "$item.type.S",
  "pavillon": "$item.pavillon.S",
  "taille": $item.taille.N,
  "nombre_marins": $item.nombre_marins.N,
  "s3_image_key": "$item.s3_image_key.S"
}
#end`;

function readShips(): ShipItem[] {
  const raw = readFileSync(shipsDataPath, 'utf-8');
  return JSON.parse(raw) as ShipItem[];
}

function getIamRoleArnsFromReadmeCommands(): {
  dynamoRoleArn: string;
  s3RoleArn: string;
} {
  const dynamoCommand =
    "aws iam get-role --role-name APIGatewayDynamoDBServiceRole --query 'Role.Arn' --output text --profile aws-labs";
  const s3Command =
    "aws iam get-role --role-name APIGatewayS3ServiceRole --query 'Role.Arn' --output text --profile aws-labs";

  const dynamoRoleArn = execSync(dynamoCommand, { encoding: 'utf-8' }).trim();
  const s3RoleArn = execSync(s3Command, { encoding: 'utf-8' }).trim();

  if (!dynamoRoleArn || !dynamoRoleArn.startsWith('arn:aws:iam::')) {
    throw new Error("Impossible de récupérer l'ARN du rôle APIGatewayDynamoDBServiceRole.");
  }

  if (!s3RoleArn || !s3RoleArn.startsWith('arn:aws:iam::')) {
    throw new Error("Impossible de récupérer l'ARN du rôle APIGatewayS3ServiceRole.");
  }

  return { dynamoRoleArn, s3RoleArn };
}

async function createBucketAndUploadAssets(ships: ShipItem[]): Promise<void> {
  console.log(`🪣 Creating S3 bucket: ${bucketName}`);
  await s3Client.send(
    new CreateBucketCommand({
      Bucket: bucketName,
      ...(region === 'us-east-1'
        ? {}
        : {
            CreateBucketConfiguration: {
              LocationConstraint: region as BucketLocationConstraint,
            },
          }),
    }),
  );

  const assetFiles = readdirSync(assetsDirPath)
    .filter((name) => name.toLowerCase().endsWith('.jpg'))
    .sort();
  const targetKeys = ships
    .map((ship) => ship['s3_image_key'])
    .map((value) => (value && 'S' in value ? value.S : undefined))
    .filter((value): value is string => Boolean(value));

  if (targetKeys.length > assetFiles.length) {
    throw new Error(`Le dossier assets ne contient pas assez d'images pour les clés S3 définies.`);
  }

  for (let index = 0; index < targetKeys.length; index += 1) {
    const key = targetKeys[index];
    const fileName = assetFiles[index];
    if (!key || !fileName) {
      continue;
    }

    const filePath = path.join(assetsDirPath, fileName);
    const fileBody = readFileSync(filePath);

    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: fileBody,
        ContentType: 'image/jpeg',
      }),
    );

    console.log(`📤 Uploaded ${fileName} as ${key}`);
  }
}

async function waitForTableActive(targetTableName: string): Promise<void> {
  let tableStatus: string | undefined;
  do {
    await sleep();

    const describeResponse = await dynamoClient.send(
      new DescribeTableCommand({ TableName: targetTableName }),
    );
    tableStatus = describeResponse.Table?.TableStatus;
    console.log(`⏳ DynamoDB table status: ${tableStatus}`);
  } while (tableStatus !== 'ACTIVE');
}

async function createTableAndSeedData(ships: ShipItem[]): Promise<void> {
  console.log(`🧱 Creating DynamoDB table: ${tableName}`);
  await dynamoClient.send(
    new CreateTableCommand({
      TableName: tableName,
      KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
      AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }],
      BillingMode: 'PAY_PER_REQUEST',
    }),
  );

  await waitForTableActive(tableName);

  const putRequests = ships.map((item) => ({ PutRequest: { Item: item } }));
  await dynamoClient.send(
    new BatchWriteItemCommand({
      RequestItems: {
        [tableName]: putRequests,
      },
    }),
  );
  console.log(`✅ Inserted ${ships.length} ships into DynamoDB`);

  const removable = ships[1];
  const removableId = removable?.['id'];
  if (removable && removableId && 'S' in removableId && removableId.S) {
    await dynamoClient.send(
      new DeleteItemCommand({
        TableName: tableName,
        Key: {
          id: { S: removableId.S },
        },
      }),
    );
    console.log(`🗑️ Deleted sample ship ${removableId.S}`);

    await dynamoClient.send(
      new PutItemCommand({
        TableName: tableName,
        Item: removable,
      }),
    );
    console.log(`♻️ Restored sample ship ${removableId.S}`);
  }
}

async function putCorsForResource(restApiId: string, resourceId: string): Promise<void> {
  await apiGatewayClient.send(
    new PutMethodCommand({
      restApiId,
      resourceId,
      httpMethod: 'OPTIONS',
      authorizationType: 'NONE',
    }),
  );

  await apiGatewayClient.send(
    new PutIntegrationCommand({
      restApiId,
      resourceId,
      httpMethod: 'OPTIONS',
      type: 'MOCK',
      requestTemplates: {
        'application/json': '{"statusCode": 200}',
      },
    }),
  );

  await apiGatewayClient.send(
    new PutMethodResponseCommand({
      restApiId,
      resourceId,
      httpMethod: 'OPTIONS',
      statusCode: '200',
      responseParameters: {
        'method.response.header.Access-Control-Allow-Headers': true,
        'method.response.header.Access-Control-Allow-Methods': true,
        'method.response.header.Access-Control-Allow-Origin': true,
      },
    }),
  );

  await apiGatewayClient.send(
    new PutIntegrationResponseCommand({
      restApiId,
      resourceId,
      httpMethod: 'OPTIONS',
      statusCode: '200',
      responseParameters: {
        'method.response.header.Access-Control-Allow-Headers': "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'",
        'method.response.header.Access-Control-Allow-Methods': "'GET,OPTIONS'",
        'method.response.header.Access-Control-Allow-Origin': "'*'",
      },
    }),
  );
}

async function createApiGateway(
  dynamoRoleArn: string,
  s3RoleArn: string,
): Promise<{ apiId: string }> {
  const createApiResponse = await apiGatewayClient.send(
    new CreateRestApiCommand({
      name: apiName,
      description: 'Capstone ships API',
      endpointConfiguration: { types: ['REGIONAL'] },
      binaryMediaTypes: ['image/*'],
    }),
  );

  const apiId = createApiResponse.id;
  const rootResourceId = createApiResponse.rootResourceId;
  if (!apiId || !rootResourceId) {
    throw new Error('API Gateway creation failed: missing API identifiers.');
  }

  const shipsResource = await apiGatewayClient.send(
    new CreateResourceCommand({
      restApiId: apiId,
      parentId: rootResourceId,
      pathPart: 'ships',
    }),
  );
  const shipsResourceId = shipsResource.id;
  if (!shipsResourceId) {
    throw new Error('Unable to create /ships resource.');
  }

  const profileResource = await apiGatewayClient.send(
    new CreateResourceCommand({
      restApiId: apiId,
      parentId: shipsResourceId,
      pathPart: 'profile',
    }),
  );
  const profileResourceId = profileResource.id;
  if (!profileResourceId) {
    throw new Error('Unable to create /ships/profile resource.');
  }

  const profileKeyResource = await apiGatewayClient.send(
    new CreateResourceCommand({
      restApiId: apiId,
      parentId: profileResourceId,
      pathPart: '{key}',
    }),
  );
  const profileKeyResourceId = profileKeyResource.id;
  if (!profileKeyResourceId) {
    throw new Error('Unable to create /ships/profile/{key} resource.');
  }

  const photoResource = await apiGatewayClient.send(
    new CreateResourceCommand({
      restApiId: apiId,
      parentId: shipsResourceId,
      pathPart: 'photo',
    }),
  );
  const photoResourceId = photoResource.id;
  if (!photoResourceId) {
    throw new Error('Unable to create /ships/photo resource.');
  }

  const photoKeyResource = await apiGatewayClient.send(
    new CreateResourceCommand({
      restApiId: apiId,
      parentId: photoResourceId,
      pathPart: '{key}',
    }),
  );
  const photoKeyResourceId = photoKeyResource.id;
  if (!photoKeyResourceId) {
    throw new Error('Unable to create /ships/photo/{key} resource.');
  }

  await putCorsForResource(apiId, shipsResourceId);
  await putCorsForResource(apiId, profileKeyResourceId);
  await putCorsForResource(apiId, photoKeyResourceId);

  await apiGatewayClient.send(
    new PutMethodCommand({
      restApiId: apiId,
      resourceId: shipsResourceId,
      httpMethod: 'GET',
      authorizationType: 'NONE',
    }),
  );
  await apiGatewayClient.send(
    new PutIntegrationCommand({
      restApiId: apiId,
      resourceId: shipsResourceId,
      httpMethod: 'GET',
      type: 'AWS',
      integrationHttpMethod: 'POST',
      uri: `arn:aws:apigateway:${region}:dynamodb:action/Scan`,
      credentials: dynamoRoleArn,
      passthroughBehavior: 'NEVER',
      requestTemplates: {
        'application/json': JSON.stringify({ TableName: tableName }),
      },
    }),
  );
  await apiGatewayClient.send(
    new PutMethodResponseCommand({
      restApiId: apiId,
      resourceId: shipsResourceId,
      httpMethod: 'GET',
      statusCode: '200',
      responseModels: {
        'application/json': 'Empty',
      },
      responseParameters: {
        'method.response.header.Access-Control-Allow-Origin': true,
      },
    }),
  );
  await apiGatewayClient.send(
    new PutIntegrationResponseCommand({
      restApiId: apiId,
      resourceId: shipsResourceId,
      httpMethod: 'GET',
      statusCode: '200',
      responseTemplates: {
        'application/json': scanResponseTemplate,
      },
      responseParameters: {
        'method.response.header.Access-Control-Allow-Origin': "'*'",
      },
    }),
  );

  await apiGatewayClient.send(
    new PutMethodCommand({
      restApiId: apiId,
      resourceId: profileKeyResourceId,
      httpMethod: 'GET',
      authorizationType: 'NONE',
      requestParameters: {
        'method.request.path.key': true,
      },
    }),
  );
  await apiGatewayClient.send(
    new PutIntegrationCommand({
      restApiId: apiId,
      resourceId: profileKeyResourceId,
      httpMethod: 'GET',
      type: 'AWS',
      integrationHttpMethod: 'POST',
      uri: `arn:aws:apigateway:${region}:dynamodb:action/GetItem`,
      credentials: dynamoRoleArn,
      passthroughBehavior: 'NEVER',
      requestTemplates: {
        'application/json': `{"TableName":"${tableName}","Key":{"id":{"S":"$input.params('key')"}}}`,
      },
    }),
  );
  await apiGatewayClient.send(
    new PutMethodResponseCommand({
      restApiId: apiId,
      resourceId: profileKeyResourceId,
      httpMethod: 'GET',
      statusCode: '200',
      responseModels: {
        'application/json': 'Empty',
      },
      responseParameters: {
        'method.response.header.Access-Control-Allow-Origin': true,
      },
    }),
  );
  await apiGatewayClient.send(
    new PutMethodResponseCommand({
      restApiId: apiId,
      resourceId: profileKeyResourceId,
      httpMethod: 'GET',
      statusCode: '404',
      responseModels: {
        'application/json': 'Empty',
      },
      responseParameters: {
        'method.response.header.Access-Control-Allow-Origin': true,
      },
    }),
  );
  await apiGatewayClient.send(
    new PutIntegrationResponseCommand({
      restApiId: apiId,
      resourceId: profileKeyResourceId,
      httpMethod: 'GET',
      statusCode: '200',
      responseTemplates: {
        'application/json': getItemResponseTemplate,
      },
      responseParameters: {
        'method.response.header.Access-Control-Allow-Origin': "'*'",
      },
    }),
  );

  await apiGatewayClient.send(
    new PutMethodCommand({
      restApiId: apiId,
      resourceId: photoKeyResourceId,
      httpMethod: 'GET',
      authorizationType: 'NONE',
      requestParameters: {
        'method.request.path.key': true,
      },
    }),
  );
  await apiGatewayClient.send(
    new PutIntegrationCommand({
      restApiId: apiId,
      resourceId: photoKeyResourceId,
      httpMethod: 'GET',
      type: 'AWS',
      integrationHttpMethod: 'GET',
      uri: `arn:aws:apigateway:${region}:s3:path/${bucketName}/{key}`,
      credentials: s3RoleArn,
      requestParameters: {
        'integration.request.path.key': 'method.request.path.key',
      },
      passthroughBehavior: 'WHEN_NO_MATCH',
    }),
  );
  await apiGatewayClient.send(
    new PutMethodResponseCommand({
      restApiId: apiId,
      resourceId: photoKeyResourceId,
      httpMethod: 'GET',
      statusCode: '200',
      responseModels: {
        'application/json': 'Empty',
      },
      responseParameters: {
        'method.response.header.Content-Type': true,
        'method.response.header.Access-Control-Allow-Origin': true,
      },
    }),
  );
  await apiGatewayClient.send(
    new PutIntegrationResponseCommand({
      restApiId: apiId,
      resourceId: photoKeyResourceId,
      httpMethod: 'GET',
      statusCode: '200',
      responseParameters: {
        'method.response.header.Content-Type': 'integration.response.header.Content-Type',
        'method.response.header.Access-Control-Allow-Origin': "'*'",
      },
    }),
  );

  const resources = await apiGatewayClient.send(
    new GetResourcesCommand({
      restApiId: apiId,
      limit: 500,
    }),
  );
  console.log(`🔌 API resources created: ${(resources.items ?? []).length}`);

  await apiGatewayClient.send(
    new CreateDeploymentCommand({
      restApiId: apiId,
      stageName,
      description: 'Initial deployment',
    }),
  );

  return { apiId };
}

async function deploy(): Promise<void> {
  try {
    console.log('🚀 Starting Project Deployment...');
    console.log(`🌍 Region: ${region}`);

    const ships = readShips();
    await createBucketAndUploadAssets(ships);
    await createTableAndSeedData(ships);

    const { dynamoRoleArn, s3RoleArn } = getIamRoleArnsFromReadmeCommands();

    const { apiId } = await createApiGateway(dynamoRoleArn, s3RoleArn);

    const state: DeploymentState = {
      region,
      bucketName,
      tableName,
      apiId,
      apiName,
      stageName,
      createdAt: new Date().toISOString(),
    };
    saveState(state);

    const invokeUrl = `https://${apiId}.execute-api.${region}.amazonaws.com/${stageName}`;
    console.log('✅ Project deployed successfully.');
    console.log(`📌 API URL: ${invokeUrl}`);
    console.log(`📦 Bucket: ${bucketName}`);
    console.log(`🧱 Table: ${tableName}`);
    console.log(`📝 State saved in: ${stateFilePath}`);
  } catch (error) {
    console.error('❌ Error during deployment:', error);
    process.exitCode = 1;
  }
}

deploy();

export {};
