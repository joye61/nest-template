/**
 * Redis 类型定义
 */

/**
 * Redis 配置接口
 */
export interface RedisConfig {
  /** Redis 服务器地址 */
  host: string;
  /** Redis 服务器端口 */
  port: number;
  /** 用户名（Redis 6.0+） */
  username?: string;
  /** 密码 */
  password?: string;
  /** 数据库索引（0-15），默认 0 */
  database?: number;
  /** 连接超时时间（毫秒），默认 10000 */
  connectTimeout?: number;
  /** 命令超时时间（毫秒），默认 5000 */
  commandTimeout?: number;
  /** 最大重试次数，默认 3 */
  maxRetries?: number;
  /** 重试延迟（毫秒），默认 1000 */
  retryDelay?: number;
  /** 是否启用离线队列（连接断开时缓存命令），默认 true */
  enableOfflineQueue?: boolean;
  /** 是否启用自动重连，默认 true */
  enableAutoReconnect?: boolean;
  /** TLS 配置 */
  tls?: boolean;
}

