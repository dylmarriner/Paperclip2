# @paperclipai/adapter-windsurf-docker

Windsurf Docker adapter for Paperclip - runs Windsurf's Cascade agent in a Docker container for headless operation.

## Overview

This adapter integrates Windsurf's Cascade AI agent with Paperclip by running it in a Docker container. This enables headless operation without requiring the Windsurf IDE to be installed or running.

## Requirements

- Docker must be installed and running on the host system
- The default Docker image `pfcoperez/windsurfinabox:latest` provides a headless Windsurf Cascade environment
- Sufficient disk space for Docker images and containers

## Installation

### As a Built-in Adapter

The windsurf_docker adapter is included in the Paperclip monorepo and registered as a built-in adapter type. No additional installation is required.

## Configuration

### Agent Configuration Fields

- **cwd** (string, optional): Default absolute working directory for the agent process
- **instructionsFilePath** (string, optional): Absolute path to a markdown instructions file
- **model** (string, optional): Windsurf Cascade model ID (e.g., "swe-1.6", "claude-sonnet-4-5")
- **dockerImage** (string, optional): Docker image to use (default: "pfcoperez/windsurfinabox:latest")
- **promptTemplate** (string, optional): Run prompt template
- **maxTurnsPerRun** (number, optional): Maximum turns for one run
- **env** (object, optional): KEY=VALUE environment variables for the Docker container
- **authToken** (string, optional): Windsurf authentication token (format: ott$...). Required for Windsurf API access
- **dockerVolumes** (array, optional): Docker volume mounts in format `[{ source: string, target: string }]`
- **dockerNetwork** (string, optional): Docker network to connect the container to
- **dockerAutoRemove** (boolean, optional): Automatically remove container after execution (default: true)
- **timeoutSec** (number, optional): Run timeout in seconds (default: 300)
- **graceSec** (number, optional): SIGTERM grace period in seconds (default: 10)
- **workspaceStrategy** (object, optional): Execution workspace strategy (git_worktree)
- **workspaceRuntime** (object, optional): Workspace runtime metadata

### Supported Models

- swe-1.6
- swe-1.5
- swe-1
- claude-sonnet-4-5
- claude-opus-4-5
- gpt-4o

## Usage

When creating an agent in Paperclip:

1. Select "Windsurf (Docker)" as the adapter type
2. Configure the Docker image and volume mounts as needed
3. Set the model to use (e.g., "swe-1.6")
4. **Required**: Set your Windsurf auth token in the `authToken` field
   - Format: `ott$...` (one-time token from Windsurf)
   - You can obtain this from the Windsurf IDE settings or Windsurf account
5. Optionally configure environment variables for the container

## Skills

Windsurf skills are discovered from `.windsurf/skills` directories in the workspace. Paperclip's skill scanning already includes this directory.

## Notes

- The workspace directory is automatically mounted into the Docker container at `/workspace`
- Paperclip injects `PAPERCLIP_WORKSPACE_*` and `PAPERCLIP_RUNTIME_*` environment variables for agent-side tooling
- Container IDs are tracked in session metadata for debugging
- The adapter uses Docker's `--rm` flag by default to automatically remove containers after execution
