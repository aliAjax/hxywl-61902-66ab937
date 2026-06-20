# hxywl-61902 甜品合成店

做一个H5合成经营小游戏，玩家通过拖拽相同等级的甜品进行合成，解锁更高级甜品并获得金币。页面需要有合成棋盘、订单栏、金币数量、甜品图鉴和离线收益提示。游戏数据保存在浏览器本地，刷新后进度不能丢，适合后续扩展更多甜品和活动关卡。

## 技术栈

React 19 + Vite 7 + TypeScript 5.8 + Vitest 4 + Playwright

## 本地运行

```bash
npm install
npm run dev
```

开发端口：61902

## 构建生产版本

```bash
npm run build
```

构建产物位于 `dist` 目录。

---

## 🔍 本地验证流程

项目提供了完整的自动化验证流程，确保代码改动不会破坏核心功能。新接手的开发者可以通过一条命令完成主要回归验证。

### ✅ 快速验证（推荐：一条命令搞定）

```bash
npm run verify
```

执行内容：类型检查 → 单元测试 → 构建检查

### 🧪 完整验证（包含浏览器冒烟测试）

```bash
npm run verify:all
```

执行内容：类型检查 → 单元测试 → 构建检查 → 浏览器端到端冒烟测试

### 🏭 CI 环境验证

```bash
npm run verify:ci
```

与 `verify` 相同，但使用 JUnit 格式输出测试报告，适合集成到 CI 系统。

---

## 📋 验证项目详解

### 1️⃣ 类型检查

```bash
npm run typecheck
```

运行 TypeScript 编译器检查所有类型错误，使用 `--noEmit` 只做类型检查不生成产物。

### 2️⃣ 单元测试

```bash
npm run test:unit
```

运行所有单元测试，覆盖以下核心模块：

| 测试文件 | 覆盖范围 | 测试用例数 |
|---------|---------|-----------|
| [saveManager.test.ts](src/saveManager.test.ts) | 存档版本验证、数据迁移、损坏JSON处理 | 10+ |
| [gameConfig.test.ts](src/gameConfig.test.ts) | 合成奖励、离线收益、订单奖励、升级成本、成就系统、关卡配置 | 30+ |
| [gameBoardUtils.test.ts](src/gameBoardUtils.test.ts) | 棋盘初始化、订单生成、甜品统计、提交订单、合成提示 | 30+ |
| [economicSimulator.test.ts](src/economicSimulator.test.ts) | 经济模拟、瓶颈分析、多方案比较、离线收益、活动系统 | 20+ |
| [timelineManager.test.ts](src/timelineManager.test.ts) | 时间线记录、回放、统计分析 | 10+ |

**查看测试覆盖率：**
```bash
npm run test:unit -- --coverage
```

### 3️⃣ 构建检查

```bash
npm run build:check
```

使用开发模式构建项目，验证代码可以正常编译打包，提前发现构建问题。

### 4️⃣ 浏览器冒烟测试

```bash
npm run test:smoke
```

使用 Playwright 运行浏览器端到端测试，模拟真实用户操作。

**核心测试场景：**
- ✅ 页面正常加载，UI 元素正确显示
- ✅ 初始状态正确（金币、棋盘、订单）
- ✅ 生成甜品功能正常
- ✅ 拖拽合成功能正常（从生成到合成的完整流程）
- ✅ 图鉴更新正常
- ✅ 连续合成功能正常
- ✅ 存档持久化正常
- ✅ 订单系统功能正常
- ✅ 自动整理功能正常

**测试文件：** [e2e/core-flow.spec.ts](e2e/core-flow.spec.ts)

**首次运行需要安装浏览器：**
```bash
npx playwright install chromium
```

---

## 🛠 所有可用脚本

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动开发服务器 |
| `npm run build` | 构建生产版本 |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run build:check` | 开发模式构建检查 |
| `npm run test:unit` | 运行单元测试 |
| `npm run test:unit -- --watch` | 单元测试 watch 模式 |
| `npm run test:unit -- --coverage` | 单元测试并生成覆盖率报告 |
| `npm run test:smoke` | 运行浏览器冒烟测试 |
| `npm run test:smoke -- --ui` | Playwright UI 模式调试 |
| `npm run verify` | 快速验证（类型 + 单测 + 构建）|
| `npm run verify:all` | 完整验证（类型 + 单测 + 构建 + 冒烟）|
| `npm run verify:ci` | CI 环境验证 |

---

## 📁 项目结构

```
hxywl-61902/
├── src/
│   ├── App.tsx                 # 主应用组件
│   ├── saveManager.ts          # 存档管理（含版本迁移）
│   ├── saveManager.test.ts     # 存档管理单元测试
│   ├── gameConfig.ts           # 游戏配置与计算
│   ├── gameConfig.test.ts      # 游戏配置单元测试
│   ├── gameBoardUtils.ts       # 棋盘工具函数
│   ├── gameBoardUtils.test.ts  # 棋盘工具单元测试
│   ├── economicSimulator.ts    # 经济模拟器
│   ├── economicSimulator.test.ts # 经济模拟单元测试
│   ├── timelineManager.ts      # 时间线记录系统
│   ├── timelineManager.test.ts # 时间线单元测试
│   └── hooks/
│       └── useGameProgress.ts  # 游戏进度 Hook
├── e2e/
│   └── core-flow.spec.ts       # 浏览器冒烟测试
├── playwright.config.ts        # Playwright 配置
├── vite.config.ts              # Vite 配置（含 Vitest）
├── tsconfig.json               # TypeScript 配置
└── package.json                # 项目依赖与脚本
```

---

## 🎯 核心保障范围

验证流程重点保障以下核心功能不被破坏：

1. **存档迁移**：从 v1.0 单关卡格式迁移到 v2.0 多关卡格式
2. **经济平衡**：金币获取、消费、升级成本的平衡计算
3. **核心交互**：生成甜品、拖拽合成、完成订单
4. **离线收益**：离线期间收益正确计算
5. **图鉴系统**：甜品解锁与收集
6. **关卡系统**：多关卡切换与数据隔离
7. **活动系统**：限时步数挑战模式
8. **成就系统**：成就进度跟踪与奖励

---

## 💡 开发工作流建议

1. 编写代码
2. 运行 `npm run verify` 做快速检查
3. 提交 PR 前运行 `npm run verify:all` 确保完整通过
4. CI 系统自动运行 `npm run verify:ci` 做门禁检查
