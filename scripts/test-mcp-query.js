#!/usr/bin/env node

const { spawn } = require('child_process');

async function testMCPQuery() {
  console.log('🧪 Testing MCP Server with SQL query...');

  const mcpServer = spawn('npx', [
    '-y',
    '@modelcontextprotocol/server-postgres',
    'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
  ]);

  let responses = [];

  mcpServer.stdout.on('data', (data) => {
    const output = data.toString().trim();
    if (output) {
      console.log('📤 MCP Response:', output);
      try {
        const parsed = JSON.parse(output);
        responses.push(parsed);
      } catch (e) {
        // Ignore non-JSON output
      }
    }
  });

  mcpServer.stderr.on('data', (data) => {
    console.log('⚠️ MCP Error:', data.toString().trim());
  });

  // Initialize
  setTimeout(() => {
    console.log('🏓 1. Initializing MCP server...');
    mcpServer.stdin.write(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" }
      }
    }) + '\n');
  }, 1000);

  // Test SQL query
  setTimeout(() => {
    console.log('🔍 2. Running SQL query to list tables...');
    mcpServer.stdin.write(JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "query",
        arguments: {
          sql: "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;"
        }
      }
    }) + '\n');
  }, 2000);

  // Test another query
  setTimeout(() => {
    console.log('📊 3. Checking Profile table structure...');
    mcpServer.stdin.write(JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "query",
        arguments: {
          sql: "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'Profile' ORDER BY ordinal_position;"
        }
      }
    }) + '\n');
  }, 3000);

  setTimeout(() => {
    console.log('🔚 Terminating test...');
    mcpServer.kill();
  }, 5000);

  mcpServer.on('close', (code) => {
    console.log(`\n✅ MCP server test completed`);
    console.log(`📊 Total responses received: ${responses.length}`);

    // Check if we got meaningful responses
    const hasQueryResults = responses.some(r =>
      r.result && r.result.content && Array.isArray(r.result.content)
    );

    if (hasQueryResults) {
      console.log('🎉 MCP server successfully executed SQL queries!');
      console.log('✅ Your Supabase MCP integration is working correctly');
    } else {
      console.log('⚠️ MCP server responded but query results unclear');
    }
  });
}

testMCPQuery().catch(console.error);