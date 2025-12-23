# Feature Testing Examples

## 📋 Overview

This folder contains integration test examples that focus on product features. These tests verify complete user scenarios rather than internal implementation details.

## 🎯 Why Feature Tests?

Feature tests deliver higher ROI:

### Feature Tests vs Unit Tests

| Characteristic | Unit Tests | Feature Tests |
|-----|---------|---------|
| **Scope** | Single function/component | Full user scenario |
| **Number of tests** | Many (one per function) | Few (one per feature) |
| **Maintenance cost** | High (heavy churn during refactors) | Low (stable as long as behavior stays) |
| **Execution speed** | Fast | Relatively slower |
| **Bug discovery** | Internal logic issues | Real user experience issues |
| **Refactor friendliness** | Low | High |

### Example Comparison

**Unit-test style** (needs multiple tests):
```typescript
// ❌ Requires dedicated tests per function
it('handleInputChange should update state', ...)
it('validateMessage should reject empty input', ...)
it('sendMessage should call the API', ...)
it('clearInput should reset the field', ...)
```

**Feature-test style** (one test covers the flow):
```typescript
// ✅ One test verifies the full flow
it('user can type and send a message', () => {
  // User types text
  // Clicks the send button
  // Validates the message appears in the UI
  // Confirms the input box is cleared
})
```

## ✅ Testing Best Practices

### 1. Assert user-facing behavior, not implementation details

```typescript
// ❌ Wrong: assert internal state
expect(component.state.messages).toHaveLength(1)

// ✅ Correct: assert what the user sees
expect(screen.getByText('Hello')).toBeInTheDocument()
```

### 2. Query only what a user can perceive

```typescript
// ❌ Wrong: use test IDs
screen.getByTestId('message-list')

// ✅ Correct: use roles or visible text
screen.getByRole('list')
screen.getByText('Messages')
```

### 3. Cover the entire workflow

```typescript
// ❌ Wrong: test each handler separately
it('handleInput works', ...)
it('handleSubmit works', ...)

// ✅ Correct: cover the whole user scenario
it('user can type and send a message', ...)
```

### 4. Use descriptive test names

```typescript
// ❌ Wrong: vague names
it('test 1', ...)
it('works', ...)

// ✅ Correct: describe expected behavior
it('disables send button when the input is empty', ...)
it('clears the input after sending a message', ...)
```

### 5. Avoid excessive mocking

```typescript
// ❌ Wrong: mock everything
vi.mock('./MessageList')
vi.mock('./InputBox')
vi.mock('./SendButton')

// ✅ Correct: mock only external dependencies
vi.mock('@/api/http')  // API calls
vi.mock('electron')    // Electron APIs
// Let other components run normally
```

## 💡 Test Strategy Guidance

Consider this split:

1. **Core features** (80% effort) – cover with feature tests
   - User sign-in/sign-up
   - Message sending
   - File upload
   - Task management

2. **Utility helpers** (15% effort) – cover with unit tests
   - Data formatting
   - Validation helpers
   - Calculation helpers

3. **Edge cases** (5% effort) – add as needed
   - Extreme inputs
   - Concurrency scenarios
   - Performance tests

## ❓ FAQ

### Q: How do I debug a failing feature test?

A:
1. Inspect the test output to identify the failing assertion
2. Call `screen.debug()` to print the current DOM
3. Check whether you need `waitFor` for pending async work
4. Gradually simplify the test until you isolate the minimal failing scenario

### Q: What if the tests run too slowly?

A:
1. Use `npm run test:watch` to run only changed tests
2. Temporarily focus with `it.only`
3. Review any unnecessary `waitFor` timeouts
4. Consider splitting very large tests into smaller ones

### Q: How do I test flows that require authentication?

A:
1. Mock the logged-in state in `beforeEach`
2. Stub `authStore` to return an authenticated user
3. Or create a `setupLoggedInUser()` helper

## 📝 Takeaway

Keep this principle in mind:

> **Tests should exercise your app the way a user would**
>
> If a test must understand internal implementation, it is likely over-specified.
>
> Focus on what users can see and do.

