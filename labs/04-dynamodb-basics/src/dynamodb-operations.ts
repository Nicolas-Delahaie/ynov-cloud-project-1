// Import the DynamoDB client and commands
import {
  DynamoDBClient,
  CreateTableCommand,
  PutItemCommand,
  ScanCommand,
  DeleteTableCommand,
  DescribeTableCommand,
  PutItemCommandInput,
} from '@aws-sdk/client-dynamodb';

interface Coffee {
  id: string;
  name: string;
  size: string;
  price: string;
}

// Create DynamoDB client instance
const client = new DynamoDBClient({
  region: 'eu-west-1', // Région par défaut
});

// Define the table name with a unique suffix
const timestamp = new Date()
  .toISOString()
  .replace(/[^0-9]/g, '')
  .substring(0, 14);
const TableName = `coffee-${timestamp}`;

// Function to create the DynamoDB table
async function createTable() {
  const params = {
    TableName,
    KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' as const }],
    AttributeDefinitions: [
      { AttributeName: 'id', AttributeType: 'S' as const },
    ],
    BillingMode: 'PAY_PER_REQUEST' as const,
  };

  try {
    await client.send(new CreateTableCommand(params));
    console.log(`✅ Table créée: ${TableName}`);

    // Attendre que la table soit vraiment active
    console.log("⏳ En attente de l'activation de la table...");
    let isActive = false;
    let attempts = 0;

    while (!isActive && attempts < 30) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      try {
        const describeResponse = await client.send(
          new DescribeTableCommand({ TableName })
        );
        if (describeResponse.Table?.TableStatus === 'ACTIVE') {
          isActive = true;
          console.log('✅ Table active !');
        }
      } catch (error) {
        // Table pas encore créée, on continue
      }
      attempts++;
    }

    if (!isActive) {
      throw new Error("Table timeout - table n'est pas devenue active");
    }
  } catch (error) {
    console.error('❌ Erreur création table:', (error as any).message);
    throw error;
  }
}

// Function to insert coffee items into the table
async function insertCoffeeItems() {
  const coffees: Coffee[] = [
    { id: 'coffee-01', name: 'Espresso', size: 'Tall', price: '2.95' },
    { id: 'coffee-02', name: 'Latte', size: 'Grande', price: '4.20' },
    { id: 'coffee-03', name: 'Cappuccino', size: 'Venti', price: '4.80' },
  ];

  for (const coffee of coffees) {
    const params: PutItemCommandInput = {
      TableName,
      Item: {
        id: { S: coffee.id },
        name: { S: coffee.name },
        size: { S: coffee.size },
        price: { N: coffee.price },
      },
    };

    try {
      await client.send(new PutItemCommand(params));
      console.log(`✅ Inséré: ${coffee.name}`);
    } catch (error) {
      console.error(
        `❌ Erreur insertion ${coffee.name}:`,
        (error as any).message
      );
      throw error;
    }
  }
}

// Function to read and display all items
async function readAllItems() {
  const params = { TableName };
  try {
    const data = await client.send(new ScanCommand(params));
    console.log(`\n📖 Éléments dans la table (${data.Items?.length || 0}):`);
    data.Items?.forEach(item => {
      console.log(
        `  - ${item['id']?.S}: ${item['name']?.S} (${item['size']?.S}) - ${item['price']?.N}€`
      );
    });
  } catch (error) {
    console.error('❌ Erreur lecture:', (error as any).message);
    throw error;
  }
}

// Function to delete the table
async function deleteTable() {
  const params = { TableName };
  try {
    await client.send(new DeleteTableCommand(params));
    console.log(`✅ Table supprimée: ${TableName}`);
  } catch (error) {
    console.error('❌ Erreur suppression:', (error as any).message);
    throw error;
  }
}

// Main function to execute all operations
async function main() {
  try {
    console.log('🚀 Starting DynamoDB operations...\n');

    // Create table
    await createTable();

    // Insert 3 Starbucks coffee items
    await insertCoffeeItems();

    // Read and display all items
    await readAllItems();

    // Clean up: delete the table
    await deleteTable();

    console.log('\n✨ End of the execution...');
  } catch (error) {
    console.error('\n❌ Erreur fatale:', (error as any).message);
    process.exit(1);
  }
}

// Execute the main function
main();

// Export to make this a module and avoid global scope conflicts
export {};
