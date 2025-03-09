# Sketchfab MCP Server

A Model Context Protocol (MCP) server for interacting with Sketchfab's 3D model platform. This MCP allows you to search, view details, and download 3D models from Sketchfab directly through Claude or Cursor.

## Features

- **Search for 3D Models**: Find models on Sketchfab using keywords, tags, and categories
- **View Model Details**: Get comprehensive information about specific models
- **Download Models**: Download models in various formats (gltf, glb, usdz, source)

## Prerequisites

- Node.js 18 or higher
- A Sketchfab API key (for authentication)

## Installation

1. Clone this repository
2. Install dependencies:
   ```
   npm install
   ```
3. Build the project:
   ```
   npm run build
   ```

## Usage

### Running the MCP Server

```
npm start
```

To provide your Sketchfab API key, use the `--api-key` parameter:

```
node build/index.js --api-key YOUR_API_KEY
```

Alternatively, you can set the `SKETCHFAB_API_KEY` environment variable:

```
export SKETCHFAB_API_KEY=YOUR_API_KEY
npm start
```

### Available Tools

#### 1. sketchfab-search

Search for 3D models on Sketchfab based on keywords and filters.

Parameters:
- `query` (optional): Text search query (e.g., "car", "house", "character")
- `tags` (optional): Filter by specific tags (e.g., ["animated", "rigged", "pbr"])
- `categories` (optional): Filter by categories (e.g., ["characters", "architecture", "vehicles"])
- `downloadable` (optional): Set to true to show only downloadable models
- `limit` (optional): Maximum number of results to return (1-24, default: 10)

#### 2. sketchfab-model-details

Get detailed information about a specific Sketchfab model.

Parameters:
- `modelId`: The unique ID of the Sketchfab model

#### 3. sketchfab-download

Download a 3D model from Sketchfab.

Parameters:
- `modelId`: The unique ID of the Sketchfab model to download
- `format` (optional): Preferred format to download the model in (gltf, glb, usdz, source)
- `outputPath` (optional): Local directory or file path to save the downloaded file

## Using with Cursor

1. Go to Cursor Settings -> MCP -> Add new MCP server
2. Configure your MCP:
   - Name: Sketchfab MCP
   - Type: command
   - Command: `node /path/to/build/index.js --api-key YOUR_API_KEY`

## Using with Claude Desktop

Add the following MCP config to your Claude Desktop configuration:

```json
{
  "mcpServers": {
    "sketchfab": {
      "command": "node",
      "args": ["/path/to/build/index.js", "--api-key", "YOUR_API_KEY"]
    }
  }
}
```

## Environment Variables

You can set the following environment variables:

- `SKETCHFAB_API_KEY`: Your Sketchfab API key (alternative to passing it with the --api-key parameter)

## License

ISC
