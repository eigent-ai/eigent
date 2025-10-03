# Installation Flow Testing Environment

This comprehensive testing environment allows you to test all installation flows end-to-end with mocked `uv sync`, `uvicorn`, and Electron APIs. It simulates different system states and provides utilities to change the environment during tests.

## Overview

The testing environment consists of three main components:

1. **Electron API Mocks** (`test/mocks/electronMocks.ts`) - Mock Electron's preload APIs
2. **Environment State Mocks** (`test/mocks/environmentMocks.ts`) - Mock filesystem, processes, and system state
3. **Test Scenarios** - Predefined scenarios for different installation flows

## Quick Start

```typescript
import { setupElectronMocks, TestScenarios } from '../mocks/electronMocks'
import { setupMockEnvironment } from '../mocks/environmentMocks'

describe('My Installation Test', () => {
  let electronAPI: MockedElectronAPI
  let mockEnv: ReturnType<typeof setupMockEnvironment>

  beforeEach(() => {
    // Set up mocks
    const { electronAPI: api } = setupElectronMocks()
    electronAPI = api
    mockEnv = setupMockEnvironment()
  })

  it('should handle version update', async () => {
    // Apply scenario
    TestScenarios.versionUpdate(electronAPI)
    
    // Your test code here
  })
})
```

## Electron API Mocks

### Available Mock Methods

- `checkAndInstallDepsOnUpdate()` - Simulates dependency installation
- `getInstallationStatus()` - Returns current installation status
- `exportLog()` - Simulates log export functionality
- Event listeners for installation events

### Simulation Functions

```typescript
// Simulate installation events
electronAPI.simulateInstallationStart()
electronAPI.simulateInstallationLog('stdout', 'Installing packages...')
electronAPI.simulateInstallationComplete(true) // or false for failure

// Simulate system changes
electronAPI.simulateVersionChange('2.0.0')
electronAPI.simulateVenvRemoval()
electronAPI.simulateUvicornStartup()
```

### Mock State Control

```typescript
// Control the mock state directly
electronAPI.mockState.venvExists = false
electronAPI.mockState.isInstalling = true
electronAPI.mockState.toolInstalled = false
```

## Environment State Mocks

### Filesystem Mock

Controls file system operations:

```typescript
// Control file existence
mockEnv.mockState.filesystem.venvExists = false
mockEnv.mockState.filesystem.versionFileExists = true
mockEnv.mockState.filesystem.installedLockExists = false

// Control file contents
mockEnv.mockState.filesystem.versionFileContent = '0.9.0'
```

### Process Mock

Controls process spawning and execution:

```typescript
// Control tool availability
mockEnv.mockState.processes.uvAvailable = false
mockEnv.mockState.processes.bunAvailable = true
mockEnv.mockState.processes.uvicornRunning = false

// Control network connectivity
mockEnv.mockState.network.canConnectToDefault = false
mockEnv.mockState.network.canConnectToMirror = true
```

## Predefined Test Scenarios

### Electron API Scenarios

Use `TestScenarios` from `electronMocks.ts`:

```typescript
// Fresh installation - no .venv, no version file
TestScenarios.freshInstall(electronAPI)

// Version update - version file exists but version changed
TestScenarios.versionUpdate(electronAPI)

// .venv removed - version file exists but .venv is missing
TestScenarios.venvRemoved(electronAPI)

// Installation in progress - when user opens app during installation
TestScenarios.installationInProgress(electronAPI)

// Installation error scenario
TestScenarios.installationError(electronAPI)

// Uvicorn startup with dependency installation
TestScenarios.uvicornDepsInstall(electronAPI)

// All good - no installation needed
TestScenarios.allGood(electronAPI)
```

### Environment Scenarios

Use `mockEnv.scenarios` from `environmentMocks.ts`:

```typescript
// Fresh installation
mockEnv.scenarios.freshInstall()

// Version update
mockEnv.scenarios.versionUpdate('0.9.0', '1.0.0')

// .venv removed
mockEnv.scenarios.venvRemoved()

// Network issues
mockEnv.scenarios.networkIssues()

// Complete failure
mockEnv.scenarios.completeFailure()

// Uvicorn startup installation
mockEnv.scenarios.uvicornStartupInstall()

// Installation in progress
mockEnv.scenarios.installationInProgress()
```

## Testing Different Installation States

### Installation Store States

Test all possible states from `installationStore.ts`:

- `'idle'` - Initial state
- `'checking-permissions'` - Checking system permissions
- `'showing-carousel'` - Showing onboarding carousel
- `'installing'` - Installation in progress
- `'error'` - Installation failed
- `'completed'` - Installation successful

```typescript
import { useInstallationStore } from '@/store/installationStore'

it('should transition through all states', () => {
  const store = useInstallationStore.getState()
  
  expect(store.state).toBe('idle')
  
  store.startInstallation()
  expect(store.state).toBe('installing')
  
  store.setError('Installation failed')
  expect(store.state).toBe('error')
  
  store.retryInstallation()
  expect(store.state).toBe('installing')
  
  store.setSuccess()
  expect(store.state).toBe('completed')
})
```

## Specific Test Cases

### 1. Testing .venv Removal

```typescript
it('should handle .venv removal', async () => {
  // Simulate .venv being removed
  TestScenarios.venvRemoved(electronAPI)
  // or
  mockEnv.scenarios.venvRemoved()
  
  // Test your component/hook
  const result = await electronAPI.checkAndInstallDepsOnUpdate()
  expect(result.success).toBe(true)
})
```

### 2. Testing Version File Changes

```typescript
it('should handle version file changes', async () => {
  // Simulate version change
  TestScenarios.versionUpdate(electronAPI)
  // or
  mockEnv.scenarios.versionUpdate('0.9.0', '1.0.0')
  
  // Your test assertions
})
```

### 3. Testing Uvicorn Startup Installation

```typescript
it('should handle uvicorn starting with dependency installation', async () => {
  // Simulate uvicorn detecting missing dependencies
  TestScenarios.uvicornDepsInstall(electronAPI)
  
  // Trigger uvicorn startup
  electronAPI.simulateUvicornStartup()
  
  // Wait for installation events
  await waitFor(() => {
    expect(mockInstallationStore.startInstallation).toHaveBeenCalled()
  })
})
```

### 4. Testing UI Installation States

```typescript
it('should show correct UI for each installation state', () => {
  const { result } = renderHook(() => useInstallationStore())
  
  // Test idle state
  expect(result.current.state).toBe('idle')
  expect(result.current.isVisible).toBe(false)
  
  // Test installing state
  act(() => result.current.startInstallation())
  expect(result.current.state).toBe('installing')
  expect(result.current.isVisible).toBe(true)
  
  // Test error state
  act(() => result.current.setError('Installation failed'))
  expect(result.current.state).toBe('error')
  expect(result.current.error).toBe('Installation failed')
  
  // Test completed state
  act(() => result.current.setSuccess())
  expect(result.current.state).toBe('completed')
  expect(result.current.progress).toBe(100)
})
```

## Advanced Testing Patterns

### Testing Event Sequences

```typescript
it('should handle complete installation flow', async () => {
  const events: string[] = []
  
  // Set up event tracking
  electronAPI.onInstallDependenciesStart(() => events.push('start'))
  electronAPI.onInstallDependenciesLog(() => events.push('log'))
  electronAPI.onInstallDependenciesComplete(() => events.push('complete'))
  
  // Trigger installation
  await electronAPI.checkAndInstallDepsOnUpdate()
  
  // Verify event sequence
  expect(events).toEqual(['start', 'log', 'log', 'complete'])
})
```

### Testing Error Recovery

```typescript
it('should recover from installation errors', async () => {
  // Set up error scenario
  TestScenarios.installationError(electronAPI)
  
  const store = useInstallationStore.getState()
  
  // Trigger installation
  await store.performInstallation()
  expect(store.state).toBe('error')
  
  // Simulate retry
  TestScenarios.allGood(electronAPI) // Fix the environment
  store.retryInstallation()
  
  await waitFor(() => {
    expect(store.state).toBe('completed')
  })
})
```

### Testing Concurrent Operations

```typescript
it('should handle concurrent installation attempts', async () => {
  const store = useInstallationStore.getState()
  
  // Start multiple installations
  const promise1 = store.performInstallation()
  const promise2 = store.performInstallation()
  
  // Should handle gracefully
  const [result1, result2] = await Promise.all([promise1, promise2])
  
  expect(store.state).toBe('completed')
})
```

## Debugging Tests

### Logging Mock State

```typescript
// Log current mock state
console.log('Electron API State:', electronAPI.mockState)
console.log('Environment State:', mockEnv.mockState)

// Check what functions were called
console.log('checkAndInstallDepsOnUpdate calls:', 
  electronAPI.checkAndInstallDepsOnUpdate.mock.calls)
```

### Waiting for Async Operations

```typescript
import { waitForStateChange } from '../mocks/environmentMocks'

// Wait for specific state changes
await waitForStateChange(
  () => mockEnv.mockState.processes.uvSyncInProgress,
  true,
  1000 // timeout
)
```

## Running the Tests

```bash
# Run all installation tests
npm test test/unit/store/installationStore.test.ts
npm test test/unit/hooks/useInstallationSetup.test.ts
npm test test/unit/electron/install-deps.test.ts

# Run with coverage
npm test -- --coverage

# Run in watch mode
npm test -- --watch
```

## Common Issues and Solutions

### 1. Mock Not Applied

**Problem**: Mock functions not being called
**Solution**: Ensure mocks are set up before importing modules

```typescript
beforeEach(async () => {
  setupMocks() // Set up first
  const module = await import('./module') // Import after
})
```

### 2. State Not Updating

**Problem**: Mock state changes not reflected
**Solution**: Use simulation functions instead of direct state mutation

```typescript
// Don't do this
electronAPI.mockState.isInstalling = true

// Do this instead
electronAPI.simulateInstallationStart()
```

### 3. Async Operations Not Completing

**Problem**: Tests timeout waiting for async operations
**Solution**: Use proper wait functions and increase timeouts

```typescript
await vi.waitFor(() => {
  expect(condition).toBe(true)
}, { timeout: 2000 })
```

## Best Practices

1. **Reset State**: Always reset mock state between tests
2. **Use Scenarios**: Prefer predefined scenarios over manual state setup
3. **Test Edge Cases**: Include error conditions and edge cases
4. **Verify Events**: Check that the correct events are emitted
5. **Test Cleanup**: Verify that resources are properly cleaned up
6. **Integration Tests**: Test the complete flow, not just individual functions

## Example Test Files

- `test/unit/store/installationStore.test.ts` - Store state management
- `test/unit/hooks/useInstallationSetup.test.ts` - Hook behavior
- `test/unit/electron/install-deps.test.ts` - Backend installation logic

These test files demonstrate all the patterns and scenarios described in this README.