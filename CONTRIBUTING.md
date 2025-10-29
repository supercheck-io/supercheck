# Contributing to Supercheck

First off, thank you for considering contributing to Supercheck! It's people like you that make Supercheck such a great tool.

## Code of Conduct

This project and everyone participating in it is governed by our [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check the [issue list](https://github.com/supercheck-io/supercheck/issues) as you might find out that you don't need to create one. When you are creating a bug report, please [include as many details as possible](#how-do-i-submit-a-good-bug-report):

- **Use a clear and descriptive title**
- **Describe the exact steps which reproduce the problem**
- **Provide specific examples to demonstrate the steps**
- **Describe the behavior you observed after following the steps**
- **Explain which behavior you expected to see instead and why**
- **Include screenshots and animated GIFs if possible**
- **Include your environment details** (OS, Node version, Docker version, etc.)

#### How Do I Submit A Good Bug Report?

Bugs are tracked as [GitHub issues](https://github.com/supercheck-io/supercheck/issues). Create an issue and provide the following information:

- **Use the bug report template** - We provide a template to make this easier
- **Environment**: OS, Node.js version, Docker version, Docker Compose version
- **Logs**: Include relevant error messages or logs
- **Reproduction Steps**: Clear step-by-step instructions
- **Expected vs Actual**: What should happen vs what actually happens

### Suggesting Enhancements

Enhancement suggestions are tracked as [GitHub issues](https://github.com/supercheck-io/supercheck/issues). When creating an enhancement suggestion, please include:

- **Clear and descriptive title**
- **Detailed description of the suggested enhancement**
- **Step-by-step description of the suggested enhancement**
- **Examples to demonstrate the steps**
- **Why this enhancement would be useful**
- **Related issues or feature requests**

### Pull Requests

Pull Requests are the best way to propose changes to the codebase. We actively welcome your pull requests:

1. **Fork the repo** and create your branch from `main`
2. **Create a feature branch**: `git checkout -b feat/your-amazing-feature`
3. **Make your changes** - See Development Setup below
4. **Follow our code style** - Run linting and formatting
5. **Write or update tests** if applicable
6. **Update documentation** for any changed functionality
7. **Commit with clear messages** - See Commit Message Guidelines
8. **Push to your fork**
9. **Open a Pull Request** - Use the PR template provided

#### Pull Request Process

1. Ensure all tests pass: `npm run test` (if applicable)
2. Ensure code passes linting: `npm run lint`
3. Add or update tests for new functionality
4. Update documentation if needed
5. Get a code review from maintainers
6. Keep your PR focused on a single feature or fix

## Development Setup

### Prerequisites

- **Node.js**: 18.0.0 or higher
- **npm**: 8.0.0 or higher (or yarn/pnpm)
- **Docker & Docker Compose** (optional, for full-stack testing)
- **Git**: 2.0.0 or higher

### Fork and Clone

```bash
# Fork the repository on GitHub

# Clone your fork
git clone https://github.com/YOUR-USERNAME/supercheck.git
cd supercheck

# Add upstream remote
git remote add upstream https://github.com/supercheck-io/supercheck.git
```

### Installation

**Using Docker (Recommended):**

```bash
# Copy environment file
cp .env.example .env

# Start all services
docker-compose up -d

# Run migrations
docker-compose exec app npm run db:migrate

# Create admin user
docker-compose exec app npm run setup:admin admin@supercheck.local
```

**Local Development:**

```bash
# Install root dependencies
npm install

# Install app dependencies
cd app
npm install
npm run db:generate
npm run db:migrate

# Install worker dependencies (in another terminal from root)
cd worker
npm install

# Return to root and start services
cd ..

# Terminal 1: Start app
cd app && npm run dev

# Terminal 2: Start worker
cd worker && npm run dev
```

### Environment Variables

Copy `.env.example` to `.env` (local) or `.env.local` and configure:

```bash
cp .env.example .env.local
```

**Important**: Never commit `.env` files. Only commit `.env.example` with dummy values.

### Running Tests

```bash
# App tests
cd app
npm run test          # Run test suite
npm run test:watch    # Run in watch mode

# Worker tests
cd worker
npm run test          # Run Jest tests
npm run test:watch    # Run in watch mode
```

### Linting and Formatting

```bash
# App linting
cd app
npm run lint          # Check and fix linting issues
npm run format        # Format code with Prettier

# Worker linting
cd worker
npm run lint          # Check and fix linting issues
npm run format        # Format code with Prettier
```

### Database Changes

When modifying the database schema:

```bash
# 1. Edit schema in app/src/db/schema/schema.ts
# 2. Generate migration
cd app
npm run db:generate

# 3. Review the generated migration in app/src/db/migrations/
# 4. Apply migration to your local database
npm run db:migrate

# 5. Open Drizzle Studio to verify (optional)
npm run db:studio
```

### Building for Production

```bash
# App build
cd app
npm run build

# Worker build
cd worker
npm run build

# Docker build
docker-compose build
```

## Commit Message Guidelines

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification for clear, semantic commit messages.

### Format

```
type(scope): subject

body

footer
```

### Types

- **feat**: A new feature
- **fix**: A bug fix
- **docs**: Documentation only changes
- **style**: Changes that don't affect code meaning (formatting, whitespace, etc.)
- **refactor**: Code changes that neither fix bugs nor add features
- **perf**: Code changes that improve performance
- **test**: Adding missing or updating tests
- **chore**: Changes to build process, dependencies, or tooling
- **ci**: Changes to CI/CD configuration
- **revert**: Reverts a previous commit

### Examples

```
feat(auth): add JWT token refresh mechanism

- Implement automatic token refresh on expiry
- Add refresh token validation
- Update authentication middleware

Closes #123
```

```
fix(worker): prevent job timeout on slow networks

- Increase default job timeout from 30s to 60s
- Add configurable timeout via environment variable
- Log timeout warnings for debugging

Fixes #456
```

```
docs: update installation instructions
```

## Code Style

### General Principles

- Keep it simple and readable
- Follow existing code patterns in the codebase
- Write self-documenting code with clear variable/function names
- Add comments only when "why" is not obvious

### TypeScript

- Use TypeScript for all new code
- No `any` types unless absolutely necessary
- Export types from your modules
- Use interfaces for public APIs

```typescript
// Good
interface UserCreateInput {
  email: string;
  name: string;
}

export function createUser(input: UserCreateInput): Promise<User> {
  // ...
}

// Avoid
export function createUser(input: any): any {
  // ...
}
```

### ESLint and Prettier

All code must pass linting and formatting checks:

```bash
# Run linter
npm run lint

# Format code
npm run format
```

These are run automatically on commit hooks.

### React Components

- Use functional components with hooks
- Keep components focused and single-purpose
- Use TypeScript for props
- Extract complex logic to custom hooks

```typescript
// Good
interface ButtonProps {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

export function Button({ label, onClick, disabled = false }: ButtonProps) {
  return (
    <button onClick={onClick} disabled={disabled}>
      {label}
    </button>
  );
}
```

### Naming Conventions

- **Files**: kebab-case for component files (e.g., `user-card.tsx`)
- **Classes**: PascalCase (e.g., `UserService`)
- **Functions**: camelCase (e.g., `getUserById`)
- **Constants**: UPPER_SNAKE_CASE (e.g., `MAX_RETRIES`)
- **Types/Interfaces**: PascalCase (e.g., `UserDTO`)

## Testing

### Writing Tests

- Write tests for all new features
- Update tests when changing existing functionality
- Aim for high coverage but prioritize important paths
- Use descriptive test names

```typescript
describe('UserService', () => {
  describe('getUserById', () => {
    it('should return user when found', async () => {
      const user = await service.getUserById('123');
      expect(user).toBeDefined();
      expect(user.id).toBe('123');
    });

    it('should throw error when user not found', async () => {
      await expect(service.getUserById('invalid')).rejects.toThrow();
    });
  });
});
```

### Running Tests

```bash
# Run all tests
npm run test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Run specific test file
npm run test -- userService.test.ts
```

## Documentation

### Update Documentation When

- Adding new features
- Changing API endpoints or parameters
- Modifying configuration options
- Fixing documented bugs
- Improving clarity of existing docs

### Documentation Files

- **README.md**: Project overview and quick start
- **Code comments**: Inline documentation for complex logic

## Review Process

1. **Automated Checks**: All PRs must pass linting and tests
2. **Code Review**: At least one maintainer review required
3. **Feedback Loop**: Address review comments promptly
4. **Approval**: PR approved when all comments resolved
5. **Merge**: Maintainer merges after approval

## Security Considerations

### Before Submitting

- [ ] No hardcoded secrets or credentials
- [ ] No sensitive data in logs or error messages
- [ ] Proper input validation and sanitization
- [ ] No SQL injection vulnerabilities
- [ ] Proper error handling (don't expose internal details)
- [ ] Environment variables for all configuration

### Review Checklist

- [ ] Security audit of changes
- [ ] No deprecated packages with vulnerabilities
- [ ] Proper authentication/authorization
- [ ] Data privacy compliance

## Recognition

Contributors will be recognized in:
- Release notes for significant contributions
- GitHub contributors page

## Questions?

- 📖 Check the [README](README.md) and [SUPPORT](SUPPORT.md)
- 💬 Start a [discussion](https://github.com/supercheck-io/supercheck/discussions)
- 🐛 [Open an issue](https://github.com/supercheck-io/supercheck/issues)

## License

By contributing to Supercheck, you agree that your contributions will be licensed under its MIT License.

---

Thank you for contributing to Supercheck! 🎉
