#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import axios, { AxiosError } from "axios";
import fs from "fs";
import path from "path";
import os from "os";
import AdmZip from "adm-zip";

// Parse command line arguments
const args = process.argv.slice(2);
let apiKey = "";

// Extract API key from command line arguments
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--api-key" && i + 1 < args.length) {
    apiKey = args[i + 1];
    break;
  }
}

// Use environment variable as fallback
if (!apiKey) {
  apiKey = process.env.SKETCHFAB_API_KEY || "";
}

// Create server instance
const server = new McpServer({
  name: "3d-model-mcp-server",
  version: "0.0.1",
});

// Sketchfab model interface
interface SketchfabModel {
  uid: string;
  name: string;
  description?: string;
  viewerUrl?: string;
  thumbnails?: {
    images?: Array<{
      url: string;
      width: number;
      height: number;
    }>;
  };
  user?: {
    username: string;
    displayName?: string;
  };
  isDownloadable: boolean;
  downloadCount?: number;
  viewCount?: number;
  likeCount?: number;
  license?: string;
  createdAt?: string;
  faceCount?: number;
  vertexCount?: number;
  tags?: Array<{
    slug: string;
  }>;
  categories?: Array<{
    name: string;
    slug: string;
  }>;
}

// Simplified Sketchfab API client
class SketchfabApiClient {
  private apiKey: string;
  private static API_BASE = "https://api.sketchfab.com/v3";

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private getAuthHeader() {
    return {
      Authorization: `Token ${this.apiKey}`,
    };
  }

  async searchModels(options: {
    q?: string;
    tags?: string[];
    categories?: string[];
    downloadable?: boolean;
    count?: number;
  }): Promise<{
    results: SketchfabModel[];
    next?: string;
    previous?: string;
  }> {
    try {
      const { q, tags, categories, downloadable, count = 24 } = options;
      
      // Build query parameters
      const params: Record<string, any> = { type: "models" };
      
      if (q) params.q = q;
      if (tags?.length) params.tags = tags;
      if (categories?.length) params.categories = categories;
      if (downloadable !== undefined) params.downloadable = downloadable;
      if (count) params.count = Math.min(count, 24); // API limit is 24
      
      // Make API request
      const response = await axios.get(`${SketchfabApiClient.API_BASE}/search`, {
        params,
        headers: this.getAuthHeader(),
      });
      
      return {
        results: response.data.results || [],
        next: response.data.next,
        previous: response.data.previous,
      };
    } catch (error: unknown) {
      if (axios.isAxiosError(error) && error.response) {
        const status = error.response.status;
        
        if (status === 401) {
          throw new Error("Invalid Sketchfab API key");
        } else if (status === 429) {
          throw new Error("Sketchfab API rate limit exceeded. Try again later.");
        }
        throw new Error(`Sketchfab API error (${status}): ${error.message}`);
      }
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  async getModel(uid: string): Promise<SketchfabModel> {
    try {
      const response = await axios.get(
        `${SketchfabApiClient.API_BASE}/models/${uid}`,
        {
          headers: this.getAuthHeader(),
        }
      );
      
      return response.data;
    } catch (error: unknown) {
      if (axios.isAxiosError(error) && error.response) {
        const status = error.response.status;
        if (status === 404) {
          throw new Error(`Model with UID ${uid} not found`);
        } else if (status === 401) {
          throw new Error("Invalid Sketchfab API key");
        }
        throw new Error(`Sketchfab API error (${status}): ${error.message}`);
      }
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  async getModelDownloadLink(uid: string): Promise<{
    gltf?: { url: string; expires: number };
    usdz?: { url: string; expires: number };
    glb?: { url: string; expires: number };
    source?: { url: string; expires: number };
  }> {
    try {
      const response = await axios.get(
        `${SketchfabApiClient.API_BASE}/models/${uid}/download`,
        {
          headers: this.getAuthHeader(),
        }
      );
      
      return response.data;
    } catch (error: unknown) {
      if (axios.isAxiosError(error) && error.response) {
        const status = error.response.status;
        if (status === 404) {
          throw new Error(`Model with UID ${uid} not found`);
        } else if (status === 401) {
          throw new Error("Invalid Sketchfab API key");
        } else if (status === 400) {
          throw new Error("Model is not downloadable");
        } else if (status === 403) {
          throw new Error("You do not have permission to download this model");
        }
        throw new Error(`Sketchfab API error (${status}): ${error.message}`);
      }
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  async downloadModel(downloadUrl: string): Promise<Buffer> {
    try {
      const response = await axios.get(downloadUrl, {
        responseType: "arraybuffer",
        timeout: 300000, // 5 minutes
      });
      
      return Buffer.from(response.data);
    } catch (error: unknown) {
      if (axios.isAxiosError(error) && error.response) {
        const status = error.response.status;
        throw new Error(`Download error (${status}): ${error.message}`);
      }
      throw error instanceof Error ? error : new Error(String(error));
    }
  }
}

// Utility function to check if a buffer is a ZIP file
function isZipFile(buffer: Buffer): boolean {
  // Check for ZIP file signature (PK..)
  return buffer.length >= 4 && 
         buffer[0] === 0x50 && 
         buffer[1] === 0x4B && 
         (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07) && 
         (buffer[3] === 0x04 || buffer[3] === 0x06 || buffer[3] === 0x08);
}

// Utility function to extract a ZIP file
function extractZipFile(zipBuffer: Buffer, outputDir: string): string[] {
  try {
    const zip = new AdmZip(zipBuffer);
    const zipEntries = zip.getEntries();
    
    // Create output directory if it doesn't exist
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    // Extract all files
    zip.extractAllTo(outputDir, true);
    
    // Return list of extracted files
    return zipEntries.map(entry => path.join(outputDir, entry.entryName));
  } catch (error) {
    throw new Error(`Failed to extract ZIP file: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// Helper function to format model for display
function formatModelForDisplay(model: SketchfabModel): string {
  const thumbnailUrl = model.thumbnails?.images?.[0]?.url || "No thumbnail";
  const username = model.user?.username || "Unknown";
  const downloadable = model.isDownloadable ? "Yes" : "No";
  
  return `
[Model] ${model.name}
ID: ${model.uid}
Creator: ${username}
Downloadable: ${downloadable}
Thumbnail: ${thumbnailUrl}
${model.description ? `Description: ${model.description}` : ""}
`;
}

// Define a sample tool
server.tool(
  "sample-tool",
  "A sample tool for demonstration purposes",
  {
    input: z.string().describe("Input parameter for the sample tool"),
  },
  async ({ input }) => {
    // Process the input
    const output = `Processed: ${input}`;
    
    // Return the result
    return {
      content: [
        {
          type: "text",
          text: output,
        },
      ],
    };
  }
);

// Sketchfab Search Tool
server.tool(
  "sketchfab-search",
  "Search for 3D models on Sketchfab based on keywords and filters",
  {
    query: z.string().optional().describe("Text search query (e.g., \"car\", \"house\", \"character\") to find relevant models"),
    tags: z.array(z.string()).optional().describe("Filter by specific tags (e.g., [\"animated\", \"rigged\", \"pbr\"])"),
    categories: z.array(z.string()).optional().describe("Filter by categories (e.g., [\"characters\", \"architecture\", \"vehicles\"])"),
    downloadable: z.boolean().optional().describe("Set to true to show only downloadable models, false to show all models"),
    limit: z.number().optional().describe("Maximum number of results to return (1-24, default: 10)"),
  },
  async ({ query, tags, categories, downloadable, limit }) => {
    try {
      // Validate input
      if (!query && (!tags || tags.length === 0) && (!categories || categories.length === 0)) {
        return {
          content: [
            {
              type: "text",
              text: "Please provide at least one search parameter: query, tags, or categories.",
            },
          ],
        };
      }

      // Check if API key is available
      if (!apiKey) {
        return {
          content: [
            {
              type: "text",
              text: "No Sketchfab API key provided. Please provide an API key using the --api-key parameter or set the SKETCHFAB_API_KEY environment variable.",
            },
          ],
        };
      }

      // Create API client
      const client = new SketchfabApiClient(apiKey);
      
      // Search for models
      const searchResults = await client.searchModels({
        q: query,
        tags,
        categories,
        downloadable,
        count: limit || 10,
      });
      
      // Handle no results
      if (!searchResults.results || searchResults.results.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No models found matching your search criteria. Try different keywords or filters.",
            },
          ],
        };
      }
      
      // Format results
      const formattedResults = searchResults.results
        .map((model, index) => `[${index + 1}] ${model.name}\nID: ${model.uid}\nDownloadable: ${model.isDownloadable ? "Yes" : "No"}\n`)
        .join("\n");
      
      return {
        content: [
          {
            type: "text",
            text: `Found ${searchResults.results.length} models:\n\n${formattedResults}`,
          },
        ],
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      return {
        content: [
          {
            type: "text",
            text: `Error searching Sketchfab: ${errorMessage}`,
          },
        ],
      };
    }
  }
);

// Sketchfab Model Details Tool
server.tool(
  "sketchfab-model-details",
  "Get detailed information about a specific Sketchfab model",
  {
    modelId: z.string().describe("The unique ID of the Sketchfab model (found in URLs or search results)"),
  },
  async ({ modelId }) => {
    try {
      // Check if API key is available
      if (!apiKey) {
        return {
          content: [
            {
              type: "text",
              text: "No Sketchfab API key provided. Please provide an API key using the --api-key parameter or set the SKETCHFAB_API_KEY environment variable.",
            },
          ],
        };
      }

      // Create API client
      const client = new SketchfabApiClient(apiKey);
      
      // Get model details
      const model = await client.getModel(modelId);
      
      // Format model details
      const formattedModel = formatModelForDisplay(model);
      
      return {
        content: [
          {
            type: "text",
            text: formattedModel,
          },
        ],
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      return {
        content: [
          {
            type: "text",
            text: `Error getting model details: ${errorMessage}`,
          },
        ],
      };
    }
  }
);

// Sketchfab Download Tool
server.tool(
  "sketchfab-download",
  "Download a 3D model from Sketchfab",
  {
    modelId: z.string().describe("The unique ID of the Sketchfab model to download (must be downloadable)"),
    format: z.enum(["gltf", "glb", "usdz", "source"]).optional().describe("Preferred format to download the model in (defaults to gltf if available)"),
    outputPath: z.string().optional().describe("Local directory or file path to save the downloaded file (will use temp directory if not specified)"),
  },
  async ({ modelId, format = "gltf", outputPath }) => {
    try {
      // Check if API key is available
      if (!apiKey) {
        return {
          content: [
            {
              type: "text",
              text: "No Sketchfab API key provided. Please provide an API key using the --api-key parameter or set the SKETCHFAB_API_KEY environment variable.",
            },
          ],
        };
      }

      // Create API client
      const client = new SketchfabApiClient(apiKey);
      
      // Get model details
      const model = await client.getModel(modelId);
      
      // Check if model is downloadable
      if (!model.isDownloadable) {
        return {
          content: [
            {
              type: "text",
              text: `Model "${model.name}" is not downloadable.`,
            },
          ],
        };
      }
      
      // Get download links
      const downloadLinks = await client.getModelDownloadLink(modelId);
      
      // Check if requested format is available
      const requestedFormat = format as keyof typeof downloadLinks;
      if (!downloadLinks[requestedFormat]) {
        // Find available formats
        const availableFormats = Object.keys(downloadLinks).filter(
          (key) => downloadLinks[key as keyof typeof downloadLinks]
        );
        
        if (availableFormats.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "No download formats available for this model.",
              },
            ],
          };
        }
        
        // Use the first available format
        const fallbackFormat = availableFormats[0] as keyof typeof downloadLinks;
        const fallbackLink = downloadLinks[fallbackFormat]!;
        
        // Download the model
        const modelData = await client.downloadModel(fallbackLink.url);
        
        // Determine filename and path
        const filename = `${model.name.replace(/[^a-zA-Z0-9]/g, "_")}_${modelId}.${fallbackFormat}`;
        const savePath = outputPath || path.join(os.tmpdir(), filename);
        const saveDir = path.dirname(savePath);
        
        // Check if the downloaded file is a ZIP archive
        if (isZipFile(modelData)) {
          // Create a directory for extraction
          const extractDir = path.join(saveDir, `${path.basename(savePath, path.extname(savePath))}_extracted`);
          
          // Extract the ZIP file
          const extractedFiles = extractZipFile(modelData, extractDir);
          
          // Save the original ZIP file as well
          fs.writeFileSync(savePath, modelData);
          
          return {
            content: [
              {
                type: "text",
                text: `Downloaded model "${model.name}" in ${fallbackFormat} format (requested ${format} was not available).\nThe file was a ZIP archive and has been automatically extracted.\nOriginal ZIP saved to: ${savePath}\nExtracted files in: ${extractDir}\nExtracted ${extractedFiles.length} files.`,
              },
            ],
          };
        } else {
          // Write the file as is
          fs.writeFileSync(savePath, modelData);
          
          return {
            content: [
              {
                type: "text",
                text: `Downloaded model "${model.name}" in ${fallbackFormat} format (requested ${format} was not available).\nSaved to: ${savePath}`,
              },
            ],
          };
        }
      }
      
      // Download the model in the requested format
      const downloadUrl = downloadLinks[requestedFormat]!.url;
      const modelData = await client.downloadModel(downloadUrl);
      
      // Determine filename and path
      const filename = `${model.name.replace(/[^a-zA-Z0-9]/g, "_")}_${modelId}.${format}`;
      const savePath = outputPath || path.join(os.tmpdir(), filename);
      const saveDir = path.dirname(savePath);
      
      // Check if the downloaded file is a ZIP archive
      if (isZipFile(modelData)) {
        // Create a directory for extraction
        const extractDir = path.join(saveDir, `${path.basename(savePath, path.extname(savePath))}_extracted`);
        
        // Extract the ZIP file
        const extractedFiles = extractZipFile(modelData, extractDir);
        
        // Save the original ZIP file as well
        fs.writeFileSync(savePath, modelData);
        
        return {
          content: [
            {
              type: "text",
              text: `Downloaded model "${model.name}" in ${format} format.\nThe file was a ZIP archive and has been automatically extracted.\nOriginal ZIP saved to: ${savePath}\nExtracted files in: ${extractDir}\nExtracted ${extractedFiles.length} files.`,
            },
          ],
        };
      } else {
        // Write the file as is
        fs.writeFileSync(savePath, modelData);
        
        return {
          content: [
            {
              type: "text",
              text: `Downloaded model "${model.name}" in ${format} format.\nSaved to: ${savePath}`,
            },
          ],
        };
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      return {
        content: [
          {
            type: "text",
            text: `Error downloading model: ${errorMessage}`,
          },
        ],
      };
    }
  }
);

async function main() {
  // Log API key status
  if (apiKey) {
    console.log("Sketchfab API key provided");
  } else {
    console.log("No Sketchfab API key provided. Some functionality may be limited.");
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.log("MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
