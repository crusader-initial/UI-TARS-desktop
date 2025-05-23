/*
 * Copyright (c) 2025 Bytedance, Inc. and its affiliates.
 * SPDX-License-Identifier: Apache-2.0
 */
import express, { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

export interface McpServerEndpoint {
  url: string;
  port: number;
}

interface StartSseAndStreamableHttpMcpServerParams {
  port?: number;
  host?: string;
  /** Enable stateless mode for streamable http transports. Default is True */
  stateless?: boolean;
  createMcpServer: () => Promise<McpServer>;
}

export async function startSseAndStreamableHttpMcpServer(
  params: StartSseAndStreamableHttpMcpServerParams,
): Promise<McpServerEndpoint> {
  const { port, host, createMcpServer, stateless = true } = params;
  const transports = {
    streamable: {} as Record<string, StreamableHTTPServerTransport>,
    sse: {} as Record<string, SSEServerTransport>,
  };

  const app = express();
  app.use(express.json());

  app.get('/sse', async (req, res) => {
    const mcpServer: McpServer = await createMcpServer();
    console.info(`New SSE connection from ${req.ip}`);

    const sseTransport = new SSEServerTransport('/message', res);

    transports.sse[sseTransport.sessionId] = sseTransport;

    res.on('close', () => {
      delete transports.sse[sseTransport.sessionId];
    });

    await mcpServer.connect(sseTransport);
  });

  app.post('/message', async (req, res) => {
    const sessionId = req.query.sessionId as string;

    if (!sessionId) {
      res.status(400).send('Missing sessionId parameter');
      return;
    }

    const transport = transports.sse[sessionId];

    if (transport) {
      await transport.handlePostMessage(req, res, req.body);
    } else {
      res.status(400).send('No transport found for sessionId');
    }
  });

  app.post('/mcp', async (req: Request, res: Response) => {
    const mcpServer: McpServer = await createMcpServer();

    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    let transport: StreamableHTTPServerTransport;

    if (stateless) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // set to undefined for stateless servers
      });
    } else {
      if (sessionId && transports.streamable[sessionId]) {
        // Reuse existing transport
        transport = transports.streamable[sessionId];
      } else if (!sessionId && isInitializeRequest(req.body)) {
        // New initialization request
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sessionId) => {
            // Store the transport by session ID
            transports.streamable[sessionId] = transport!;
          },
        });

        // Clean up transport when closed
        transport.onclose = () => {
          if (transport?.sessionId) {
            delete transports.streamable[transport.sessionId];
          }
        };
      } else {
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Bad Request: No valid session ID provided',
          },
          id: null,
        });
        return;
      }
    }

    // Setup routes for the server
    await mcpServer.connect(transport);

    console.log('Received MCP request:', req.body);
    try {
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error('Error handling MCP request:', error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal server error',
          },
          id: null,
        });
      }
    }
  });

  app.get('/mcp', async (req: Request, res: Response) => {
    console.log('Received GET MCP request');
    res.writeHead(405).end(
      JSON.stringify({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Method not allowed.',
        },
        id: null,
      }),
    );
  });

  app.delete('/mcp', async (req: Request, res: Response) => {
    console.log('Received DELETE MCP request');
    res.writeHead(405).end(
      JSON.stringify({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Method not allowed.',
        },
        id: null,
      }),
    );
  });

  const HOST = host || '127.0.0.1';
  const PORT = Number(port || process.env.PORT || 8080);

  return new Promise((resolve, reject) => {
    const appServer = app.listen(PORT, HOST, (error: any) => {
      if (error) {
        console.error('Failed to start server:', error);
        reject(error);
        return;
      }
      const endpoint: McpServerEndpoint = {
        url: `http://${HOST}:${PORT}/mcp`,
        port: PORT,
      };
      console.log(
        `Browser Streamable HTTP MCP Server listening at ${endpoint.url}`,
      );
      console.log(
        `Browser Streamable SSE MCP Server listening at http://${HOST}:${PORT}/sse`,
      );
      resolve(endpoint);
    });

    // Handle server errors
    appServer.on('error', (error: any) => {
      console.error('Server error:', error);
      reject(error);
    });
  });
}
