#!/usr/bin/env node

const { spawn } = require('child_process');

async function testMCPConnection() {
  console.log('🧪 Testing Postgres MCP Server connection to local Supabase...');

  const mcpServer = spawn('npx', [
    '-y',
    '@modelcontextprotocol/server-postgres',
    'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
  ]);

  let output = '';
  let errorOutput = '';

  mcpServer.stdout.on('data', (data) => {
    output += data.toString();
    console.log('📤 MCP Output:', data.toString().trim());
  });

  mcpServer.stderr.on('data', (data) => {
    errorOutput += data.toString();
    console.log('⚠️ MCP Error:', data.toString().trim());
  });

  // Send MCP initialization message
  setTimeout(() => {
    console.log('🏓 Sending initialization to MCP server...');
    const initMessage = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: {
          name: "test-client",
          version: "1.0.0"
        }
      }
    };
    mcpServer.stdin.write(JSON.stringify(initMessage) + '\n');
  }, 1000);

  // Test listing tools
  setTimeout(() => {
    console.log('🔧 Requesting available tools...');
    const toolsMessage = {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list"
    };
    mcpServer.stdin.write(JSON.stringify(toolsMessage) + '\n');
  }, 2000);

  setTimeout(() => {
    console.log('🔚 Terminating test...');
    mcpServer.kill();
  }, 5000);

  mcpServer.on('close', (code) => {
    console.log(`✅ MCP server test completed with code ${code}`);
    if (errorOutput.includes('error') || code !== 0) {
      console.log('❌ MCP connection test failed');
      console.log('Error details:', errorOutput);
    } else {
      console.log('✅ MCP connection test appears successful');
      console.log('Output:', output);
    }
  });
}

testMCPConnection().catch(console.error);