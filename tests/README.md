# Tests

This directory contains the test suite for the dependency change analyzer.

## Structure

```
tests/
├── unit/                 # Unit tests
│   ├── core/            # Tests for core logic modules
│   ├── utils/           # Tests for utility modules
│   ├── npm/             # Tests for npm-related modules
│   ├── git/             # Tests for git-related modules
│   └── external/        # Tests for external service modules
├── integration/         # Integration tests (future)
├── helpers/            # Test helper utilities
└── fixtures/           # Test data and fixtures (future)
```

## Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Run specific test file
node --test tests/unit/core/dependency-comparer.test.mjs
```

## Writing Tests

Tests use Node.js built-in test runner (available in Node 18+). Key patterns:

### Basic Test Structure

```javascript
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

describe('module-name', () => {
  beforeEach(() => {
    // Setup before each test
  });

  it('should do something', () => {
    // Test implementation
    assert.strictEqual(actual, expected);
  });
});
```

### Mocking

```javascript
import { mock } from 'node:test';

// Mock a module
const mockFunction = mock.fn();
mock.module('module-name', () => ({ export: mockFunction }));

// Configure mock behavior
mockFunction.mock.mockImplementation(() => 'mocked result');
```

### Testing Async Functions

```javascript
it('should handle async operations', async () => {
  const result = await asyncFunction();
  assert.strictEqual(result, expected);
});

it('should handle rejections', async () => {
  await assert.rejects(
    () => functionThatThrows(),
    /Expected error message/
  );
});
```

## Test Helpers

The `helpers/` directory contains utilities for testing:

- `mock-fs.mjs` - File system mocking utilities
- More helpers can be added as needed

## Coverage

Test coverage reports show which parts of the code are tested. Aim for:
- High coverage of core business logic
- Good coverage of error handling paths
- Focus on critical functionality over 100% coverage

## Best Practices

1. **Test behavior, not implementation** - Focus on what the function does, not how
2. **Use descriptive test names** - Should explain what is being tested
3. **Keep tests focused** - One concept per test
4. **Use setup/teardown** - Clean state between tests
5. **Mock external dependencies** - File system, network calls, etc.
6. **Test error cases** - Not just happy paths
