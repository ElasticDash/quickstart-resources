import { Anthropic } from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import readline from "readline/promises";
import dotenv from "dotenv";
dotenv.config(); // load environment variables from .env
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set");
}
class MCPClient {
    mcp;
    anthropic;
    transport = null;
    tools = [];
    constructor() {
        // Initialize Anthropic client and MCP client
        this.anthropic = new Anthropic({
            apiKey: ANTHROPIC_API_KEY,
        });
        this.mcp = new Client({ name: "mcp-client-cli", version: "1.0.0" });
    }
    async connectToServer() {
        /**
         * Connect to the Playwright MCP server using npx
         */
        try {
            // Use npx to launch playwright-mcp
            this.transport = new StdioClientTransport({
                command: 'npx',
                args: ["@playwright/mcp@latest"]
            });
            this.mcp.connect(this.transport);
            // List available tools
            const toolsResult = await this.mcp.listTools();
            this.tools = toolsResult.tools.map((tool) => {
                return {
                    name: tool.name,
                    description: tool.description,
                    input_schema: tool.inputSchema,
                };
            });
            console.log("Connected to server with tools:", this.tools.map(({ name }) => name));
        }
        catch (e) {
            console.log("Failed to connect to Playwright MCP server: ", e);
            throw e;
        }
    }
    async processQuery(query) {
        /**
         * Process a query using Claude and available tools
         *
         * @param query - The user's input query
         * @returns Processed response as a string
         */
        const messages = [
            {
                role: "user",
                content: query,
            },
        ];
        const finalText = [];
        let continueConversation = true;
        while (continueConversation) {
            // Call Claude API
            const response = await this.anthropic.messages.create({
                model: "claude-3-5-sonnet-20241022",
                max_tokens: 1000,
                messages,
                tools: this.tools,
            });
            // Add Claude's response to the conversation
            messages.push({
                role: "assistant",
                content: response.content,
            });
            let hasToolCalls = false;
            const toolResults = [];
            // Process each content block in Claude's response
            for (const content of response.content) {
                if (content.type === "text") {
                    finalText.push(content.text);
                }
                else if (content.type === "tool_use") {
                    hasToolCalls = true;
                    const toolName = content.name;
                    const toolArgs = content.input;
                    finalText.push(`[Calling tool ${toolName} with args ${JSON.stringify(toolArgs)}]`);
                    // Execute the tool call
                    const result = await this.mcp.callTool({
                        name: toolName,
                        arguments: toolArgs,
                    });
                    toolResults.push({
                        type: "tool_result",
                        tool_use_id: content.id,
                        content: result.content,
                    });
                }
            }
            // If there were tool calls, add their results to the conversation
            if (hasToolCalls) {
                messages.push({
                    role: "user",
                    content: toolResults,
                });
            }
            else {
                // No tool calls in this response, conversation is complete
                continueConversation = false;
            }
        }
        return finalText.join("\n");
    }
    async chatLoop() {
        /**
         * Run an interactive chat loop
         */
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });
        try {
            console.log("\nMCP Client Started!");
            console.log("Type your queries or 'quit' to exit.");
            while (true) {
                const message = await rl.question("\nQuery: ");
                if (message.toLowerCase() === "quit") {
                    break;
                }
                const response = await this.processQuery(message);
                console.log("\n" + response);
            }
        }
        finally {
            rl.close();
        }
    }
    async cleanup() {
        /**
         * Clean up resources
         */
        await this.mcp.close();
    }
}
async function main() {
    const mcpClient = new MCPClient();
    try {
        await mcpClient.connectToServer();
        await mcpClient.chatLoop();
    }
    finally {
        await mcpClient.cleanup();
        process.exit(0);
    }
}
main();
