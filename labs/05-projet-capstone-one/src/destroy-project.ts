import {
  DeleteTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  ScanCommand,
  BatchWriteItemCommand,
  type AttributeValue,
} from '@aws-sdk/client-dynamodb';
import {
  DeleteBucketCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  APIGatewayClient,
  DeleteRestApiCommand,
} from '@aws-sdk/client-api-gateway';
import { existsSync, unlinkSync } from 'fs';
import { loadState, stateFilePath } from './shared/state';
import { sleep, chunkArray, getAwsErrorName } from './shared/utils';

async function waitForTableDeletion(
  dynamoClient: DynamoDBClient,
  tableName: string,
): Promise<void> {
  while (true) {
    try {
      await dynamoClient.send(new DescribeTableCommand({ TableName: tableName }));
      console.log(`⏳ Waiting for table deletion: ${tableName}`);
      await sleep();
    } catch (error) {
      if (getAwsErrorName(error) === 'ResourceNotFoundException') {
        console.log(`✅ Table deleted: ${tableName}`);
        break;
      }
      throw error;
    }
  }
}

async function deleteAllDynamoItems(
  dynamoClient: DynamoDBClient,
  tableName: string,
): Promise<void> {
  const keys: Record<string, AttributeValue>[] = [];
  let lastEvaluatedKey: Record<string, AttributeValue> | undefined;

  do {
    const response = await dynamoClient.send(
      new ScanCommand({
        TableName: tableName,
        ProjectionExpression: 'id',
        ExclusiveStartKey: lastEvaluatedKey,
      }),
    );

    for (const item of response.Items ?? []) {
      const id = item['id'];
      if (id) {
        keys.push({ id });
      }
    }

    lastEvaluatedKey = response.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  if (keys.length === 0) {
    console.log('ℹ️ No DynamoDB items to delete.');
    return;
  }

  const keyChunks = chunkArray(keys, 25);
  for (const keyChunk of keyChunks) {
    await dynamoClient.send(
      new BatchWriteItemCommand({
        RequestItems: {
          [tableName]: keyChunk.map((key) => ({
            DeleteRequest: {
              Key: key,
            },
          })),
        },
      }),
    );
  }

  console.log(`🧹 Deleted ${keys.length} DynamoDB items from ${tableName}`);
}

async function deleteDynamoTable(
  dynamoClient: DynamoDBClient,
  tableName: string,
): Promise<void> {
  try {
    await deleteAllDynamoItems(dynamoClient, tableName);
    await dynamoClient.send(new DeleteTableCommand({ TableName: tableName }));
    await waitForTableDeletion(dynamoClient, tableName);
  } catch (error) {
    if (getAwsErrorName(error) === 'ResourceNotFoundException') {
      console.log(`ℹ️ Table already deleted: ${tableName}`);
      return;
    }
    throw error;
  }
}

async function emptyAndDeleteBucket(
  s3Client: S3Client,
  bucketName: string,
): Promise<void> {
  try {
    let continuationToken: string | undefined;

    do {
      const listResponse = await s3Client.send(
        new ListObjectsV2Command({
          Bucket: bucketName,
          ContinuationToken: continuationToken,
        }),
      );

      const objects = (listResponse.Contents ?? [])
        .map((object) => object.Key)
        .filter((key): key is string => Boolean(key));

      if (objects.length > 0) {
        await s3Client.send(
          new DeleteObjectsCommand({
            Bucket: bucketName,
            Delete: {
              Objects: objects.map((key) => ({ Key: key })),
            },
          }),
        );
        console.log(`🗑️ Deleted ${objects.length} objects from ${bucketName}`);
      }

      continuationToken = listResponse.IsTruncated
        ? listResponse.NextContinuationToken
        : undefined;
    } while (continuationToken);

    await s3Client.send(new DeleteBucketCommand({ Bucket: bucketName }));
    console.log(`✅ Deleted bucket: ${bucketName}`);
  } catch (error) {
    if (getAwsErrorName(error) === 'NoSuchBucket') {
      console.log(`ℹ️ Bucket already deleted: ${bucketName}`);
      return;
    }
    throw error;
  }
}

async function deleteApiGateway(apiGatewayClient: APIGatewayClient, apiId: string): Promise<void> {
  try {
    await apiGatewayClient.send(new DeleteRestApiCommand({ restApiId: apiId }));
    console.log(`✅ Deleted API Gateway: ${apiId}`);
  } catch (error) {
    if (getAwsErrorName(error) === 'NotFoundException') {
      console.log(`ℹ️ API already deleted: ${apiId}`);
      return;
    }
    throw error;
  }
}

async function main(): Promise<void> {
  try {
    console.log('🚀 Starting Project Deletion...');

    const state = loadState();
    const region = state.region ?? process.env['AWS_REGION'] ?? 'eu-west-1';

    const dynamoClient = new DynamoDBClient({ region });
    const s3Client = new S3Client({ region });
    const apiGatewayClient = new APIGatewayClient({ region });

    await deleteApiGateway(apiGatewayClient, state.apiId);
    await deleteDynamoTable(dynamoClient, state.tableName);
    await emptyAndDeleteBucket(s3Client, state.bucketName);

    if (existsSync(stateFilePath)) {
      unlinkSync(stateFilePath);
    }

    console.log('✅ Project deleted successfully.');
  } catch (error) {
    console.error('❌ Error during deletion:', error);
    process.exitCode = 1;
  }
}

main();

export {};
