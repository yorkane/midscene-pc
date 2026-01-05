# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands

- `pnpm run build` - Build JavaScript and TypeScript declarations
- `pnpm run build:js` - Build JavaScript only using esbuild
- `pnpm run build:types` - Generate TypeScript type declarations
- `pnpm run clean` - Remove dist directory
- `pnpm run demo` - Run demo script
- `pnpm run dev` - Run demo in watch mode with tsx

## Project Architecture

This is a PC automation agent library for midscene.js that enables AI-driven desktop automation through screen understanding and mouse/keyboard control.

### Core Components

**Device Abstraction Layer** (`src/pc.device.ts`)
- `PCDevice` - Main device class implementing `AbstractInterface` from @midscene/core
- Handles screen capture, coordinate translation, and action execution
- Supports targeting by monitor ID, window info (title/appName/id), or manual screen selection
- Uses a `ScreenTargetFinder` function to dynamically determine capture region and coordinate translation

**Service Architecture** (`src/interfaces/pc.service.interface.ts`)
- `IPCService` interface defines the contract for PC operations
- Two implementations:
  - `localPCService` (`src/services/local.pc.service.ts`) - Direct local access using nut-js and node-screenshots
  - `createRemotePCService()` (`src/services/remote.pc.service.ts`) - HTTP client for remote PC operations
- Service provides: mouse, keyboard, clipboard, monitors, windows, and screenshot operations

**Agent Layer** (`src/pc.agent.ts`)
- `PCAgent` extends `Agent<PCDevice>` from @midscene/core
- Provides `aiOutput(task)` method for tasks that require returning structured data
- Uses UUID-based listener pattern for collecting AI-generated output

**Server Layer** (`src/server.ts`, `src/index.server.ts`)
- Express server exposing PC operations as HTTP endpoints
- Auto-restart logic with exponential backoff for resilience
- CLI entry point (`src/cli.ts`) for running as standalone service

### Key Design Patterns

**Dual Operation Mode**
- Local mode: Direct access via localPCService
- Remote mode: HTTP client calling a remote server's endpoints
- Both expose the same `IPCService` interface

**Action Space Definition**
- Device actions (tap, scroll, input, etc.) defined in `actionSpace()` method
- Uses @midscene/core's action definition helpers
- Custom actions: `ClearInput`, `OutputFinalAnswer`
- Static config: `ACTION_TRANSFORM_TIME` (500ms), `MOUSE_WHEEL_ONCE_MAX` (1000), `MOUSE_WHEEL_TO_PIXEL` (1.6)

**Coordinate Systems**
- All coordinates are relative to the captured screen area
- `getScreenPos()` converts region-relative coordinates to global screen coordinates
- Supports multi-monitor setups with automatic coordinate translation

**Logging** (`src/logger.ts`)
- Uses winston with daily log rotation
- Replaces global console methods to capture all output
- Environment variables: `LOG_LEVEL`, `LOG_DIR`, `LOG_MAX_SIZE`, `LOG_MAX_FILES`

### Usage Patterns

1. **Direct Device Usage**: Create `PCDevice` with `localPCService`, call `launch()`, then use with `PCAgent`
2. **Server Mode**: Run CLI (`midscene-pc`) to start HTTP server, then use `createRemotePCService(url)` from client
3. **Demo Development**: Run `pnpm run dev` to execute `demo/run.ts` with hot reload

### Dependencies

- `@midscene/core` - Core agent framework
- `@nut-tree-fork/nut-js` - Mouse/keyboard automation
- `node-screenshots` - Screen/window capture
- `jimp` - Image processing for cropping and format conversion
- `express` - HTTP server for remote mode
- `winston` - Logging with daily rotation

### Type System

- All types exported from `src/index.ts`
- Key types: `PCDevice`, `PCAgent`, `IPCService`, `PCDeviceLaunchOptions`
- Enums: `KeyCode`, `MouseButton` defined in interface file
