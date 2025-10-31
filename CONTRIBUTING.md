# Contributing to Supercheck

Thank you for considering contributing to Supercheck!

## Code of Conduct

This project follows our [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you agree to uphold this code.

## How to Contribute

### Reporting Bugs

Use [GitHub Issues](https://github.com/supercheck-io/supercheck/issues) with the bug report template. Include:

- Clear, descriptive title
- Steps to reproduce
- Expected vs actual behavior
- Environment details (OS, Node.js, Docker versions)
- Relevant logs or screenshots

### Feature Requests

Submit via [GitHub Issues](https://github.com/supercheck-io/supercheck/issues) with:

- Clear description of the enhancement
- Use case and benefits
- Examples if applicable

### Pull Requests

1. Fork the repo and create a branch from `main`
2. Follow the naming convention: `feat/feature-name`, `fix/bug-name`, `docs/description`
3. Make your changes following our code style
4. Add or update tests if applicable
5. Ensure linting passes: `npm run lint`
6. Update documentation as needed
7. Use clear commit messages (see Commit Guidelines below)
8. Submit a pull request using the PR template

## Development Setup

### Prerequisites

- Node.js 20+
- Docker & Docker Compose
- PostgreSQL 18+
- Redis

### Quick Start

```bash
# Clone and setup
git clone https://github.com/YOUR-USERNAME/supercheck.git
cd supercheck
cp .env.example .env

# Using Docker (Recommended)
docker-compose up -d
docker-compose exec app npm run db:migrate

# Local Development
cd app && npm install && npm run db:migrate
cd ../worker && npm install
# Run app and worker in separate terminals
cd app && npm run dev
cd worker && npm run dev
```

## Commit Message Guidelines

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): description

[optional body]
```

**Types**: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

**Examples**:
```
feat(auth): add JWT refresh mechanism
fix(worker): increase job timeout to 60s
docs: update installation guide
```

## Code Style

- Use TypeScript with proper types (avoid `any`)
- Follow existing patterns in the codebase
- Pass linting: `npm run lint`
- Format code: `npm run format`
- Use descriptive names and keep code self-documenting

### Naming Conventions

- Files: `kebab-case.tsx`
- Classes: `PascalCase`
- Functions: `camelCase`
- Constants: `UPPER_SNAKE_CASE`

## Testing

Write tests for new features and run before submitting:

```bash
npm run test
```

## Security

Before submitting, ensure:

- No hardcoded secrets or credentials
- Proper input validation
- Environment variables for configuration
- No sensitive data in logs

See [SECURITY.md](SECURITY.md) for reporting vulnerabilities.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

## Questions

- [README](README.md) | [SUPPORT](SUPPORT.md)
- [Discussions](https://github.com/supercheck-io/supercheck/discussions)
- [Issues](https://github.com/supercheck-io/supercheck/issues)
