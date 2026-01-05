import * as redis from 'redis';
import type { RedisClientType } from 'redis';
import type { RedisConfig } from './types';
import { Log } from '../../../common/Log';

/**
 * Redis 管理类
 *
 * 使用示例：
 *
 * ```typescript
 * // 创建实例
 * const redis = Redis.create('redis://localhost:6379');
 *
 * // 获取托管的客户端（自动错误重试）
 * const client = redis.getClient();
 *
 * // 使用原生 node-redis API
 * await client.set('key', 'value');
 * await client.get('key');
 * await client.hSet('user:1', 'name', 'John');
 * ```
 */
export class Redis {
  /** Redis 实例缓存池（单例模式） */
  private static readonly instances = new Map<string, Redis>();

  /** Redis 原生客户端实例 */
  private client: RedisClientType | null = null;

  /** 代理客户端（带自动重试功能） */
  private proxiedClient: RedisClientType | null = null;

  /** 配置对象 */
  private readonly config: RedisConfig;

  /** 重连互斥锁（防止并发重连） */
  private reconnectLock: Promise<void> | null = null;

  /** 连接是否已失效 */
  private isConnectionDead = false;

  /** 健康检查定时器 */
  private healthCheckTimer: NodeJS.Timeout | null = null;

  /** 初始化 Promise（用于惰性初始化） */
  private initializePromise: Promise<void> | null = null;

  /** 常量配置 */
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY = 1000;
  private readonly HEALTH_CHECK_INTERVAL = 30000;

  /**
   * 构造函数（私有）
   *
   * 使用私有构造函数实现单例模式，外部必须通过 Redis.create() 创建实例。
   * 
   * 注意：不在构造函数中初始化连接，而是在首次调用 getClient() 时惰性初始化。
   * 这避免了在构造时抛出异步错误，同时保持 API 的同步性。
   */
  private constructor(config: string | RedisConfig) {
    this.config = this.parseConfig(config);
  }

  /**
   * 创建或获取 Redis 实例（单例模式）
   *
   * @param config - Redis 连接字符串或配置对象
   * @returns Redis 实例
   *
   * @example
   * ```typescript
   * // 使用连接字符串
   * const redis1 = Redis.create('redis://localhost:6379');
   * const redis2 = Redis.create('redis://:password@localhost:6379/1');
   *
   * // 使用配置对象
   * const redis3 = Redis.create({
   *   host: 'localhost',
   *   port: 6379,
   *   password: 'secret',
   *   database: 0,
   * });
   * ```
   */
  public static create(config: string | RedisConfig): Redis {
    const cacheKey = this.generateCacheKey(config);

    // 检查缓存，如果已存在则直接返回
    const cached = Redis.instances.get(cacheKey);
    if (cached) {
      return cached;
    }

    // 创建实例并缓存
    const instance = new Redis(config);
    Redis.instances.set(cacheKey, instance);

    Log.v(`[Redis] 创建新实例: ${this.getConnectionInfo(instance.config)}`);

    return instance;
  }

  /**
   * 生成缓存键
   */
  private static generateCacheKey(config: string | RedisConfig): string {
    if (typeof config === 'string') {
      return config; // URL 作为缓存键
    }

    // 配置对象转为 JSON 字符串（排除敏感信息）
    const keyConfig = {
      host: config.host,
      port: config.port,
      database: config.database || 0,
      username: config.username ? '[SET]' : undefined,
      password: config.password ? '[SET]' : undefined,
    };

    return JSON.stringify(keyConfig);
  }

  /**
   * 获取连接信息（用于日志）
   */
  private static getConnectionInfo(config: Readonly<RedisConfig>): string {
    const auth = config.password ? '(认证)' : '';
    return `${config.host}:${config.port}/${config.database} ${auth}`;
  }

  /**
   * 解析配置
   *
   * 支持两种格式：
   * 1. URL 字符串：redis://username:password@host:port/database
   * 2. 配置对象：{ host, port, password, ... }
   */
  private parseConfig(config: string | RedisConfig): RedisConfig {
    if (typeof config === 'string') {
      return this.parseURL(config);
    }

    // 合并默认配置
    return {
      connectTimeout: 10000,
      commandTimeout: 5000,
      maxRetries: 3,
      retryDelay: 1000,
      enableOfflineQueue: true,
      enableAutoReconnect: true,
      database: 0,
      ...config,
    };
  }

  /**
   * 解析 Redis URL
   *
   * 格式：redis://[username:password@]host[:port][/database]
   */
  private parseURL(url: string): RedisConfig {
    const match = url.match(
      /^redis:\/\/(?:([^:]+):([^@]+)@)?([^:\/]+)(?::(\d+))?(?:\/(\d+))?$/,
    );

    if (!match) {
      throw new Error(
        `无效的 Redis URL: ${url}\n` +
          `正确格式: redis://[username:password@]host[:port][/database]`,
      );
    }

    const [, username, password, host, port, database] = match;

    return {
      host,
      port: port ? parseInt(port, 10) : 6379,
      username,
      password,
      database: database ? parseInt(database, 10) : 0,
      connectTimeout: 10000,
      commandTimeout: 5000,
      maxRetries: 3,
      retryDelay: 1000,
      enableOfflineQueue: true,
      enableAutoReconnect: true,
    };
  }

  /**
   * 初始化连接（惰性初始化）
   */
  private async initialize(): Promise<void> {
    // 如果已有初始化任务，等待完成
    if (this.initializePromise) {
      return this.initializePromise;
    }

    // 如果已经初始化成功，直接返回
    if (this.client && this.client.isOpen && this.proxiedClient) {
      return;
    }

    // 创建并缓存初始化任务
    this.initializePromise = this.doInitialize();
    
    try {
      await this.initializePromise;
    } finally {
      // 无论成功失败，清除 Promise 缓存，允许重试
      this.initializePromise = null;
    }
  }

  /**
   * 执行实际的初始化逻辑
   */
  private async doInitialize(): Promise<void> {
    await this.createClient();
    this.createProxiedClient();
    this.startHealthCheck();
  }

  /**
   * 创建 Redis 客户端
   */
  private async createClient(): Promise<void> {
    try {
      const options: redis.RedisClientOptions = {
        socket: {
          host: this.config.host,
          port: this.config.port,
          connectTimeout: this.config.connectTimeout,
          reconnectStrategy: this.config.enableAutoReconnect
            ? (retries: number) => {
                // 重连策略：指数退避
                if (retries > 10) {
                  Log.e('[Redis] 重连次数过多，放弃重连');
                  return new Error('重连次数超过限制');
                }
                const delay = Math.min(retries * 100, 3000);
                Log.v(`[Redis] ${retries} 次重连，${delay}ms 后重试`);
                return delay;
              }
            : undefined,
        },
        database: this.config.database,
        commandsQueueMaxLength: this.config.enableOfflineQueue ? 1000 : 0,
      };

      // 添加认证信息
      if (this.config.username) {
        options.username = this.config.username;
      }

      if (this.config.password) {
        options.password = this.config.password;
      }

      // 创建客户端
      // 注意：使用 as any 是因为 RedisClientType 的泛型类型在不同版本间可能不兼容
      // 这是 node-redis 库的类型系统限制，不影响运行时功能
      this.client = redis.createClient(options) as any;

      // 设置事件监听器
      this.setupEventListeners();

      // 连接到 Redis 服务器
      if (this.client) {
        await this.client.connect();
      }

      Log.v(
        `[Redis] 连接成功: ${this.config.host}:${this.config.port} (DB: ${this.config.database})`,
      );

      this.isConnectionDead = false;
    } catch (error) {
      Log.e('[Redis] 创建连接失败:', error);
      throw error;
    }
  }

  /**
   * 设置事件监听器
   */
  private setupEventListeners(): void {
    if (!this.client) return;

    // 错误事件
    this.client.on('error', (error) => {
      Log.e('[Redis] 错误:', error.message);
      this.isConnectionDead = true;
    });

    // 就绪事件
    this.client.on('ready', () => {
      Log.v('[Redis] 连接就绪');
      this.isConnectionDead = false;
    });

    // 断开连接事件
    this.client.on('end', () => {
      Log.v('[Redis] 连接已断开');
      this.isConnectionDead = true;
    });
  }

  /**
   * 重建连接（使用互斥锁确保只执行一次）
   */
  private async recreateConnection(): Promise<void> {
    if (this.reconnectLock) {
      return this.reconnectLock;
    }

    this.reconnectLock = (async () => {
      try {
        Log.v('[Redis] 开始重建连接...');

        // 停止健康检查并清理旧连接
        this.stopHealthCheck();
        if (this.client) {
          this.client.destroy();
          this.client = null;
          this.proxiedClient = null;
        }

        // 重新初始化
        await this.doInitialize();

        Log.v('[Redis] 连接重建成功');
      } catch (error) {
        Log.e('[Redis] 连接重建失败:', error);
        throw error;
      } finally {
        this.reconnectLock = null;
      }
    })();

    return this.reconnectLock;
  }

  /**
   * 检查错误是否为连接错误
   */
  private isConnectionError(error: any): boolean {
    if (!error) return false;

    const connectionErrorMessages = [
      'ECONNREFUSED',
      'ECONNRESET',
      'ETIMEDOUT',
      'EHOSTUNREACH',
      'ENETUNREACH',
      'EPIPE',
      'Connection is closed',
      'Socket closed unexpectedly',
      'Connection timeout',
    ];

    return connectionErrorMessages.some(
      (msg) =>
        error.code === msg ||
        error.message?.includes(msg) ||
        error.message?.toLowerCase().includes('connect'),
    );
  }

  /**
   * 自动重试执行函数（支持连接重建）
   *
   * 策略：
   * 1. 第一次失败：直接重试（可能是临时网络抖动）
   * 2. 第二次失败：重建连接后重试（Redis 可能已恢复）
   * 3. 第三次失败：彻底放弃，抛出错误
   */
  private async retryOnConnectionError<T>(
    operation: () => Promise<T>,
  ): Promise<T> {
    let lastError: any;

    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        // 如果连接已失效且不是第一次尝试，先重建连接
        if (this.isConnectionDead && attempt > 1) {
          await this.recreateConnection();
        }

        return await operation();
      } catch (error) {
        lastError = error;

        // 检查是否为连接错误
        if (!this.isConnectionError(error)) {
          throw error; // 非连接错误，直接抛出
        }

        // 第一次失败：标记连接失效
        if (attempt === 1) {
          this.isConnectionDead = true;
        }

        // 最后一次尝试失败
        if (attempt === this.MAX_RETRIES) {
          Log.e(`[Redis] 重试 ${this.MAX_RETRIES} 次后仍然失败，放弃操作`);
          throw error;
        }

        // 等待后重试
        const delay = this.RETRY_DELAY * attempt;
        Log.v(`[Redis] 第 ${attempt} 次尝试失败，${delay}ms 后重试...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  }

  /**
   * 启动健康检查
   */
  private startHealthCheck(): void {
    this.stopHealthCheck(); // 确保不会重复启动

    this.healthCheckTimer = setInterval(async () => {
      try {
        // 健康检查不使用 Proxy,避免触发重试逻辑
        if (this.client?.isOpen) {
          // 直接调用原生 client,不触发自动重试
          await this.client.ping();
          this.isConnectionDead = false;
        }
      } catch (error) {
        Log.e('[Redis] 健康检查失败:', error);
        this.isConnectionDead = true;
        // 不在这里触发重连,留给业务请求触发
      }
    }, this.HEALTH_CHECK_INTERVAL);
  }

  /**
   * 停止健康检查
   */
  private stopHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  /**
   * 创建代理客户端（自动错误重试）
   */
  private createProxiedClient(): void {
    if (!this.client) {
      throw new Error('原生客户端未初始化');
    }

    const self = this; // 保存外层 this 引用
    
    this.proxiedClient = new Proxy(this.client, {
      get(target, prop, receiver) {
        const original = Reflect.get(target, prop, receiver);

        if (typeof original === 'function') {
          return (...args: any[]) => {
            const result = original.apply(target, args);

            // 对 Promise 结果添加重试逻辑
            if (result instanceof Promise) {
              return self.retryOnConnectionError(() =>
                original.apply(target, args),
              );
            }

            return result;
          };
        }

        return original;
      },
    }) as RedisClientType;
  }

  /**
   * 获取托管的 Redis 客户端实例
   *
   * 自动等待初始化完成，这是获取客户端的标准方式。
   * 
   * 返回的客户端具备：
   * 1. node-redis 的所有原生功能
   * 2. 自动错误重试和连接重建
   * 3. 完全透明的 API（类型安全）
   *
   * @returns 托管的 node-redis 客户端实例（RedisClientType）
   *
   * @example
   * ```typescript
   * const redis = Redis.create('redis://localhost:6379');
   * const client = await redis.getClient(); // 自动等待初始化
   * 
   * // 使用原生 node-redis API
   * await client.set('key', 'value');
   * const value = await client.get('key');
   * await client.hSet('user:1', 'name', 'John');
   * ```
   */
  public async getClient(): Promise<RedisClientType> {
    await this.initialize();
    
    if (!this.proxiedClient) {
      throw new Error('Redis 客户端初始化失败');
    }
    
    return this.proxiedClient;
  }

  /**
   * 检查连接是否健康
   */
  public async isHealthy(): Promise<boolean> {
    try {
      if (!this.client || !this.client.isOpen) {
        return false;
      }
      await this.client.ping();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 获取配置信息
   */
  public getConfig(): Readonly<RedisConfig> {
    return Object.freeze({ ...this.config });
  }

  /**
   * 关闭连接
   */
  public async close(): Promise<void> {
    this.stopHealthCheck();

    // 清理初始化和重连任务
    this.initializePromise = null;
    this.reconnectLock = null;

    if (this.client) {
      try {
        await this.client.quit();
        Log.v('[Redis] 连接已关闭');
      } catch (error) {
        Log.e('[Redis] 关闭连接出错:', error);
        this.client.destroy();
      } finally {
        this.client = null;
        this.proxiedClient = null;
      }
    }
  }

  /**
   * 关闭所有 Redis 连接
   *
   * 用于应用关闭时清理所有资源。
   *
   * @example
   * ```typescript
   * // 在应用关闭时调用
   * await Redis.closeAll();
   * ```
   */
  public static async closeAll(): Promise<void> {
    Log.v('[Redis] 关闭所有连接...');

    const closePromises = Array.from(Redis.instances.values()).map((instance) =>
      instance.close().catch((error) => {
        Log.e('[Redis] 关闭连接失败:', error);
      }),
    );

    await Promise.all(closePromises);

    Redis.instances.clear();
  }

  /**
   * 获取所有实例数量（用于监控）
   */
  public static getInstanceCount(): number {
    return Redis.instances.size;
  }

  /**
   * 获取所有实例的配置信息（用于调试）
   */
  public static getAllConfigs(): Readonly<RedisConfig>[] {
    return Array.from(Redis.instances.values()).map((instance) =>
      instance.getConfig(),
    );
  }
}
