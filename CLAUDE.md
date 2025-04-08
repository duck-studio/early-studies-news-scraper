# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build and Test Commands
- Development: `pnpm dev` (local development with Wrangler)
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
- **Documentation**: JSDoc comments for functions and complex logic

Always run `pnpm check` before committing changes to ensure code meets style guidelines.