import type { AttributeValue } from '@aws-sdk/client-dynamodb';

export type ShipItem = Record<string, AttributeValue>;

export interface DeploymentState {
  region: string;
  bucketName: string;
  tableName: string;
  apiId: string;
  apiName: string;
  stageName: string;
  createdAt: string;
}
