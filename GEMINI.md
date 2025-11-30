# Project: Drizzle Solid

## Project Overview

Drizzle Solid is a TypeScript library that serves as a type-safe Object-Relational Mapper (ORM) adapter for Solid Pods, built upon the Drizzle ORM framework. Its primary goal is to enable developers to interact with RDF (Resource Description Framework) data stored in Solid Pods using a familiar Drizzle ORM-like API, while ensuring strong type safety.

The library intelligently converts Drizzle queries into SPARQL (SPARQL Protocol and RDF Query Language) for execution against Solid Pods. It provides comprehensive support for common database operations, including Create, Read, Update, and Delete (CRUD), complex conditional queries, aggregations (like `count`, `sum`, `avg`, `min`, `max`), and joins. To ensure robustness and compatibility, Drizzle Solid incorporates intelligent fallback mechanisms, performing in-memory processing for filters, aggregations, and joins when the underlying Solid server's SPARQL 1.1 support (e.g., Comunica v2) is incomplete.

Key technologies and integrations include:
- **TypeScript**: For type safety and development experience.
- **Drizzle ORM**: The foundational ORM framework.
- **Solid Project**: The decentralized web platform for linked data.
- **SPARQL**: The query language for RDF data.
- **Comunica**: A modular SPARQL query engine used for executing queries against Solid Pods.
- **`@inrupt/solid-client-authn-node`**: For authentication and session management with Solid Pods.

## Building and Running

This section outlines the essential commands for building, testing, and running the Drizzle Solid project.

### Prerequisites

- Node.js (version specified in `package.json` or compatible)
- Yarn (or npm)

### Build

To compile the TypeScript source code into JavaScript:

```bash
yarn build
```

This command executes `tsc` for standard compilation and `tsc -p tsconfig.esm.json` for ES Module compilation.

### Testing

The project uses `vitest` for testing.

- **Run all tests:**
  ```bash
  yarn test
  ```
  This command first builds the project and then runs all unit and integration tests.

- **Run tests in watch mode:**
  ```bash
  yarn test:watch
  ```

- **Generate test coverage report:**
  ```bash
  yarn test:coverage
  ```

- **Run integration tests with a real Solid Pod:**
  ```bash
  SOLID_ENABLE_REAL_TESTS=true npx vitest run tests/integration/css --runInBand
  ```
  **Note:** Before running CSS-backed suites, ensure the isolated server runtime dependencies are installed:
  ```bash
  yarn css:install
  ```

### Linting and Quality Checks

To ensure code quality and adherence to style guidelines:

- **Run linter:**
  ```bash
  yarn lint
  ```

- **Fix linting issues automatically:**
  ```bash
  yarn lint:fix
  ```

- **Comprehensive quality check (build, lint, and test):**
  ```bash
  yarn quality
  ```

### Examples

The project includes several example scripts to demonstrate its usage. These can be run using `ts-node`.

- **Server setup and Pod creation:**
  ```bash
  yarn example:setup
  ```

- **Authentication and session reuse:**
  ```bash
  yarn example:auth
  ```

- **Basic CRUD operations:**
  ```bash
  yarn example:usage
  ```
  or
  ```bash
  yarn example:basic
  ```

## Development Conventions

Adherence to established development conventions is crucial for maintaining code quality and project consistency.

### General Workflow

1.  **Plan First**: Before writing any code, clearly define the desired behavior and update relevant tracking documents (e.g., `PROGRESS.md` or GitHub issues).
2.  **Implement Carefully**: Write modular code, prioritize using existing public APIs, and avoid exposing internal implementation details outside the `src/` directory.
3.  **Verify**: Always run `yarn quality` to execute linting and tests. For quicker iteration during development, `SOLID_ENABLE_REAL_TESTS=false yarn test` can be used for unit tests, but a full suite run is required before completion.
4.  **Document**: Update `README`, `docs/guides/`, or `examples/` to reflect any new features or changes in behavior, ensuring Drizzle users can easily understand and adopt them.

### Integration Testing Guidelines

-   Integration tests for the Community Solid Server (CSS) are located under `tests/integration/css`.
-   Tests should be idempotent and operate on timestamped containers (e.g., `/drizzle-tests/<timestamp>/`) to allow for parallel execution.
-   Utilize helper utilities from `tests/integration/css/helpers.ts` for common tasks like creating sessions, ensuring container existence, and cleanup.
-   Ensure CSS-backed suites have their dependencies installed via `yarn css:install`, which isolates Comunica v2 dependencies under `.internal/css-runtime`.

### Pull Request (PR) Guidelines

-   **Commit Structure**: Squash logical work into focused commits. Follow Conventional Commits specification (e.g., `feat(core): Add new feature`, `fix(utils): Resolve bug in helper function`, `docs(guides): Update authentication guide`).
-   **PR Body Content**: Each pull request should include:
    -   A concise summary of the changes.
    -   Evidence of testing (e.g., output from `yarn quality` or relevant test logs).
    -   Any manual testing steps required (e.g., `yarn server:start` commands).
    -   Migration notes if public APIs have been modified or deprecated.
-   **Reviewers**: Request reviewers who are knowledgeable about the specific areas of the codebase affected by the changes (`core`, `utils`, `examples`, `docs`, etc.).

For any questions or to discuss proposals before coding, please open an issue or start a discussion.