# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build and Test Commands
- Development: `pnpm dev` (local development with Wrangler)
- Scheduled Development: `pnpm dev:scheduled` (development with scheduled events)
- Build: `pnpm build`
- Lint: `pnpm lint` (runs Biome linter)
- Format: `pnpm format` (runs Biome formatter)
- Type Check: `pnpm check` (runs Biome check and auto-fixes issues)
- Run Tests: `pnpm test` (runs Vitest tests)
- Run Single Test: `pnpm test -- -t "test name pattern"` (runs tests matching pattern)

## Code Style Guidelines
- **Formatting**: Uses Biome with 2-space indentation, 100 character line width
- **Quotes**: Single quotes for strings
- **Semicolons**: Required
- **Types**: Strict TypeScript with no `any` allowed
- **Imports**: Organize imports automatically with Biome
- **Error Handling**: Robust error handling with try/catch and logger
- **Logging**: Use Pino logger with appropriate log levels
- **Naming**: Use descriptive, camelCase names for variables/functions

## Architecture
- **Routes**: Each endpoint group is in its own file in `src/routes/`
- **Middleware**: Common middleware is in `src/middleware/`
- **Services**: Business logic shared across routes is in `src/services/`
- **Utils**: Utility functions are organized by domain in `src/utils/`
- **DB**: Database queries and schema are in `src/db/`
- **Workflows**: Cloudflare Worker Workflows are in `src/workflows/`

## Development Notes
- Always run `pnpm check` before committing changes to ensure code meets style guidelines
- Use the `createApiResponse` helper for consistent API responses
- Error responses should follow the standard { data: null, success: false, error: {...} } format
- Successful responses should use { data: resultData, success: true, error: null }
- Date strings in user input should be in DD/MM/YYYY format
- The codebase is designed to run on Cloudflare Workers with D1 database