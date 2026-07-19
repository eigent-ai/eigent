# Host 抽象层

统一桌面（Electron）与 Web 的能力注入，避免在业务代码中显式判断运行环境。

## 使用方式

```tsx
import { useHost } from '@/host';

function MyComponent() {
  const host = useHost();
  // host.electronAPI / host.ipcRenderer 在 Web 下为 null
  if (host?.electronAPI?.someMethod) {
    host.electronAPI.someMethod();
  }
}
```

## 初始化

`main.tsx` 中通过 `createHost()` 创建 host，由 `HostProvider` 注入。`createHost()` 是唯一读取 `window` 的地方。

## 后续扩展

- 桌面端若用其他技术栈（Tauri、原生等）重构，只需提供新的 host 实现
- CLI、Browser Extension 等可复用同一套 React 组件，注入不同的 host
