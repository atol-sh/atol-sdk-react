import '@testing-library/jest-dom/vitest'

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => {
      values.delete(key)
    },
    setItem: (key, value) => {
      values.set(key, String(value))
    },
  }
}

if (
  typeof window !== 'undefined' &&
  typeof window.localStorage === 'undefined'
) {
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: memoryStorage(),
  })
}

// AtolProvider's mount effect shares one auth client across a React Strict
// Mode double-invoke via a module-scoped slot with a deferred (macrotask)
// teardown -- see the comment above `sharedClientSlot` in `src/provider.tsx`.
// React Testing Library's automatic per-test `cleanup()` unmounts
// synchronously without waiting for that timer, which -- left alone -- would
// leak a still-pending-teardown client into the next test that mounts a
// provider with the same config. Force it closed after every test so each
// test starts from a clean slate, matching the module's real-world
// single-app-lifetime usage.
//
// Imported DYNAMICALLY inside the hook (not statically at this file's top
// level) so this never triggers the FIRST evaluation of `src/provider.tsx`.
// A static top-level import here would resolve `../src/provider` -- and
// transitively its `@atol-sh/js` import -- before a test file's own
// `vi.mock('@atol-sh/js', ...)` (hoisted within that file) has a chance to
// intercept it, poisoning every test file's module cache with the REAL
// core client regardless of its mock. By the time `afterEach` runs, the
// test file has already done its own (correctly mocked, where applicable)
// `import { AtolProvider } from '../src/provider'`, so this dynamic import
// resolves to that same already-cached module.
afterEach(async () => {
  const { __resetAtolSharedClientForTests } = await import('../src/provider')
  __resetAtolSharedClientForTests()
  window.localStorage.clear()
})
