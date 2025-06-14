# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Essential Commands

**Development:**
- `pnpm run dev` - Start local development (runs wrangler on port 8080 + SES local on port 8005)
- `pnpm run test` - Run tests with vitest
- `pnpm run test:coverage` - Run tests with coverage report
- `pnpm run fix` - Format code with Biome (always run after code changes)
- `pnpm run lint` - Check code style
- `pnpm run typecheck` - TypeScript type checking

**Database:**
- `pnpm run db:makemigrations` - Generate Drizzle migrations
- `pnpm run db:migrate` - Apply migrations

**Authentication:**
- `pnpm run create-token` - Generate JWT token for API testing

## Architecture Overview

**Platform:** Cloudflare Workers with Hono framework, deployed via GitHub Actions

**Email Providers:** AWS SES (primary) and SendGrid (fallback), with automatic logging to D1 database

**Authentication:** JWT-based with bearer tokens, all API routes under `/api/*` are protected

**API Structure:**
- OpenAPI 3.0 schema served at `/schema/v1`
- All endpoints under `/api/v1/`
- Main routes: send email, send multiple emails, view logs
- Error handling with automatic notification service integration

**Database:** Cloudflare D1 (SQLite) with Drizzle ORM
- Schema: `mailLogs` table tracking all email attempts
- Supports both success/failure logging with provider info

**Key Environment Variables:**
- `TOKEN_SECRET` - JWT signing secret
- `ENVIRONMENT` - production/staging flag
- AWS SES and SendGrid credentials
- D1 database binding

**Development Notes:**
- Use TDD approach when making changes
- Local SES testing available at http://localhost:8005
- Staging environment auto-deploys from `staging` branch
- Production deploys from `main` branch
- Use Japanese to communicate with the developer
- Use English for code comments and documentation

**Implementation Guidelines:**
- Always present a detailed implementation plan before starting any code changes
- Get approval from the developer before proceeding with implementation
- Break down complex features into clear, manageable steps
- Explain the reasoning behind architectural decisions
