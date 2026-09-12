---
name: Shared React Query bundling
description: Prevent production-only QueryClient context failures when web apps consume the shared generated client.
---

Vite web artifacts that consume the shared generated API client must deduplicate `@tanstack/react-query` alongside React and React DOM.

**Why:** Development resolution can hide duplicate React Query contexts. A production bundle may then render a provider from one copy while generated hooks read another, causing a blank page with “No QueryClient set.”

**How to apply:** Preserve React Query in Vite’s dedupe list. After dependency or shared-client changes, verify the production bundle rather than relying only on the development server.