const {
  findServerless,
  findServerlessPath,
} = require('@conduitvc/aws-utils/findServerless');
const { PubSub } = require('graphql-subscriptions');
const fs = require('fs');
const path = require('path');
const { DynamoDB } = require('aws-sdk');
const { createSchema: createSchemaCore } = require('./schema');
const createServerCore = require('./serverCore');
const log = require('logdown')('appsync-emulator:server');

const DynamoDBDefaultConfig = {
  endpoint: 'http://localhost:61023',
  accessKeyId: 'fake',
  secretAccessKey: 'fake',
  region: 'fake',
};

const ensureDynamodbTables = async (
  dynamodb,
  serverlessConfig,
  appSyncConfig,
) => {
  const { dataSources } = appSyncConfig;
  const {
    resources: { Resources: resources },
  } = serverlessConfig;

  await Promise.all(
    Object.values(resources)
      .filter(resource => resource.Type === 'AWS::DynamoDB::Table')
      .map(async resource => {
        const { Properties: params } = resource;
        try {
          log.info('creating table', params);
          await dynamodb.createTable(params).promise();
        } catch (err) {
          if (err.code !== 'ResourceInUseException') throw err;
        }
      }),
  );

  return dataSources.filter(source => source.type === 'AMAZON_DYNAMODB').reduce(
    (sum, source) => ({
      ...sum,
      [source.config.tableName]: source.config.tableName,
    }),
    {},
  );
};

const createSchema = async ({ serverless, schemaPath = null, pubsub } = {}) => {
  const serverlessConfig = findServerless(serverless);
  const serverlessDirectory =
    typeof serverless === 'string'
      ? path.dirname(serverless)
      : findServerlessPath();

  // eslint-disable-next-line
  schemaPath = schemaPath || path.join(serverlessDirectory, 'schema.graphql');
  if (!fs.existsSync(schemaPath)) {
    throw new Error(`schema file: ${schemaPath} must exist`);
  }

  const graphqlSchema = fs.readFileSync(schemaPath, 'utf8');
  const { custom: { appSync: appSyncConfig } = {} } = serverlessConfig;
  const dynamodb = new DynamoDB(DynamoDBDefaultConfig);
  const dynamodbTables = await ensureDynamodbTables(
    dynamodb,
    serverlessConfig,
    appSyncConfig,
  );

  return createSchemaCore({
    dynamodb,
    dynamodbTables,
    graphqlSchema,
    serverlessDirectory,
    serverlessConfig,
    pubsub,
  });
};

const createServer = async ({ port, ...createSchemaOpts }) => {
  const pubsub = new PubSub();
  const { schema, subscriptions } = await createSchema({
    ...createSchemaOpts,
    pubsub,
  });

  return createServerCore({
    port,
    pubsub,
    schema,
    subscriptions,
  });
};

module.exports = createServer;
