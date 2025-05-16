#!/usr/bin/env node
/*
 * Copyright (c) 2025 Bytedance, Inc. and its affiliates.
 * SPDX-License-Identifier: Apache-2.0
 */
import { program } from 'commander';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer, getBrowser } from './server.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

declare global {
  interface Window {
    mcpHelper: {
      logs: string[];
      originalConsole: Partial<typeof console>;
    };
  }
}

program
  .name(process.env.NAME || 'mcp-server-browser')
  .description(process.env.DESCRIPTION || 'MCP server for browser')
  .version(process.env.VERSION || '0.0.1')
  .option('--headless', 'Browser headless mode', false)
  .option('--executable-path <executablePath>', 'Browser executable path')
  .option(
    '--browser-type <browserType>',
    'browser or chrome channel to use, possible values: chrome, edge, firefox',
  )
  .option('--display <display>', 'Display number to use')
  .option(
    '--proxy-server <proxy>',
    'specify proxy server, for example "http://myproxy:3128" or "socks5://myproxy:8080"',
  )
  .action(async (options) => {
    try {
      console.log('[mcp-server-browser] options', options);

      const server: McpServer = createServer({
        launchOptions: {
          headless: options.headless,
          executablePath: options.executablePath,
          browserType: options.browserType,
          proxy: options.proxyServer,
          args: [options.display ? `--display=${options.display}` : ''],
        },
        logger: {
          info: (...args: any[]) => {
            server.server.notification({
              method: 'notifications/message',
              params: {
                level: 'warning',
                logger: 'mcp-server-browser',
                data: JSON.stringify(args),
              },
            });

            server.server.sendLoggingMessage({
              level: 'info',
              data: JSON.stringify(args),
            });
          },
          error: (...args: any[]) => {
            server.server.sendLoggingMessage({
              level: 'error',
              data: JSON.stringify(args),
            });
          },
          warn: (...args: any[]) => {
            server.server.sendLoggingMessage({
              level: 'warning',
              data: JSON.stringify(args),
            });
          },
          debug: (...args: any[]) => {
            server.server.sendLoggingMessage({
              level: 'debug',
              data: JSON.stringify(args),
            });
          },
        },
      });
      const transport = new StdioServerTransport();
      await server.connect(transport);
    } catch (error) {
      console.error('Error: ', error);
      process.exit(1);
    }
  });

program.parse();

process.stdin.on('close', () => {
  const { browser } = getBrowser();
  console.error('Puppeteer MCP Server closed');
  browser?.close();
});
