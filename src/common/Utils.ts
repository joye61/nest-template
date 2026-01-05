import { HttpException, HttpStatus } from '@nestjs/common';
import { createHash } from 'node:crypto';
import dayjs from 'dayjs';
import { Request } from 'express';
import fs from 'node:fs';
import { ApiResult, DbPageParams } from './types';

export type NormalizeMethod = 'left' | 'right' | 'both';

/**
 * 通用工具类
 * 提供常用的工具方法
 */
export class Utils {
  /**
   * 获取环境变量
   *
   * @param name 环境变量名称，不传则返回 NODE_ENV
   * @returns 环境变量值
   *
   * @example
   * ```typescript
   * Utils.env()           // 'development' | 'production' | 'test'
   * Utils.env('DB_HOST')  // 'localhost'
   * ```
   */
  static env(name?: string): string | undefined {
    if (name) {
      return process.env[name];
    }
    return process.env.NODE_ENV;
  }

  /**
   * 判断是否为开发环境
   */
  static isDev(): boolean {
    return Utils.env() === 'development';
  }

  /**
   * 判断是否为测试环境
   */
  static isTest(): boolean {
    return Utils.env() === 'test';
  }

  /**
   * 判断是否为生产环境
   */
  static isProd(): boolean {
    return Utils.env() === 'production';
  }

  /**
   * 创建标准 API 响应对象
   * @param data 响应数据
   * @param code 响应码，0表示成功
   * @param message 响应消息
   * @returns
   */
  static json<T = any>(
    data: T = null as any,
    code = 0,
    message = '成功',
  ): ApiResult<T> {
    return { data, code, message };
  }

  /**
   * 抛出成功响应（用于中断流程但返回成功结果）
   * @param data 响应数据
   * @param code 响应码
   * @param message 响应消息
   */
  static success<T = any>(
    data: T = null as any,
    code = 0,
    message = '成功',
  ): never {
    throw new HttpException(Utils.json(data, code, message), HttpStatus.OK);
  }

  /**
   * 抛出错误响应
   * @param code 错误码
   * @param message 错误消息
   */
  static error(code = -1, message = '错误'): never {
    throw new HttpException(Utils.json(null, code, message), HttpStatus.OK);
  }

  /**
   * 求字符串的md5值
   * @param data
   * @returns
   */
  static md5(data: string): string {
    const hash = createHash('md5');
    return hash.update(data).digest('hex');
  }

  /**
   * 求字符串的sha1值
   * @param data
   * @returns
   */
  static sha1(data: string): string {
    const hash = createHash('sha1');
    return hash.update(data).digest('hex');
  }

  /**
   * base64 编码
   *
   * @param input 待编码的字符串
   * @returns base64 编码结果
   *
   * @example
   * ```typescript
   * Utils.b64enc('hello')  // 'aGVsbG8='
   * ```
   */
  static b64enc(input: string): string {
    return Buffer.from(input).toString('base64');
  }

  /**
   * base64 解码
   *
   * @param input base64 编码的字符串
   * @returns 解码后的字符串
   *
   * @example
   * ```typescript
   * Utils.b64dec('aGVsbG8=')  // 'hello'
   * ```
   */
  static b64dec(input: string): string {
    return Buffer.from(input, 'base64').toString('utf8');
  }

  /**
   * 移除路径两端的斜杠
   *
   * @param path 路径字符串
   * @param side 移除方向：'both'(两端) | 'left'(左侧) | 'right'(右侧)
   * @returns 处理后的路径
   *
   * @example
   * ```typescript
   * Utils.trimSlash('/path/to/file/')    // 'path/to/file'
   * Utils.trimSlash('/path/to/file/', 'left')   // 'path/to/file/'
   * Utils.trimSlash('/path/to/file/', 'right')  // '/path/to/file'
   * ```
   */
  static trimSlash(path: string, side: NormalizeMethod = 'both'): string {
    let regexp = /^\/*|\/*$/g;
    if (side === 'left') {
      regexp = /^\/*/g;
    } else if (side === 'right') {
      regexp = /\/*$/g;
    }
    return path.replace(regexp, '');
  }

  /**
   * 获取请求客户端的真实 IP 地址
   *
   * 优先级（从高到低）：
   * 1. x-real-ip（Nginx 直连）
   * 2. x-forwarded-for 第一个 IP（多层代理）
   * 3. cf-connecting-ip（Cloudflare）
   * 4. x-client-ip（部分代理）
   * 5. req.socket.remoteAddress（直连）
   * 6. req.ip（Express 提取）
   *
   * @param req Express Request 对象
   * @returns 客户端 IP 地址，获取失败返回 'unknown'
   *
   * @example
   * ```typescript
   * // 直连
   * Utils.ip(req) // "192.168.1.100"
   *
   * // Nginx 代理
   * // x-real-ip: 120.230.45.67
   * Utils.ip(req) // "120.230.45.67"
   *
   * // 多层代理
   * // x-forwarded-for: 120.230.45.67, 10.0.0.1, 172.16.0.1
   * Utils.ip(req) // "120.230.45.67"
   * ```
   */
  static ip(req: Request): string {
    try {
      // 1. x-real-ip: Nginx 反向代理常用
      const realIp = req.headers['x-real-ip'];
      if (realIp && typeof realIp === 'string') {
        const ip = realIp.trim();
        if (ip && Utils.isValidIp(ip)) {
          return ip;
        }
      }

      // 2. x-forwarded-for: 多层代理时的客户端 IP 链
      // 格式: "client, proxy1, proxy2"，取第一个
      const forwardedFor = req.headers['x-forwarded-for'];
      if (forwardedFor) {
        const ips = (
          typeof forwardedFor === 'string' ? forwardedFor : forwardedFor[0]
        )
          .split(',')
          .map((ip) => ip.trim())
          .filter((ip) => ip && Utils.isValidIp(ip));

        if (ips.length > 0) {
          return ips[0];
        }
      }

      // 3. cf-connecting-ip: Cloudflare CDN
      const cfIp = req.headers['cf-connecting-ip'];
      if (cfIp && typeof cfIp === 'string') {
        const ip = cfIp.trim();
        if (ip && Utils.isValidIp(ip)) {
          return ip;
        }
      }

      // 4. x-client-ip: 部分代理服务器使用
      const clientIp = req.headers['x-client-ip'];
      if (clientIp && typeof clientIp === 'string') {
        const ip = clientIp.trim();
        if (ip && Utils.isValidIp(ip)) {
          return ip;
        }
      }

      // 5. socket.remoteAddress: 直连时的真实地址
      const socketIp = req.socket?.remoteAddress;
      if (socketIp) {
        // 去除 IPv6 前缀 "::ffff:"
        const ip = socketIp.replace(/^::ffff:/, '').trim();
        if (ip && Utils.isValidIp(ip)) {
          return ip;
        }
      }

      // 6. req.ip: Express 内置提取（trust proxy 配置）
      if (req.ip) {
        const ip = req.ip.replace(/^::ffff:/, '').trim();
        if (ip && Utils.isValidIp(ip)) {
          return ip;
        }
      }
    } catch (error) {}

    return '';
  }

  /**
   * 验证 IP 地址格式是否合法
   *
   * 支持 IPv4 和 IPv6 格式
   *
   * @param ip IP 地址字符串
   * @returns 是否为合法 IP
   *
   * @example
   * ```typescript
   * Utils.isValidIp('192.168.1.1')        // true
   * Utils.isValidIp('2001:db8::1')        // true
   * Utils.isValidIp('invalid')            // false
   * Utils.isValidIp('999.999.999.999')    // false
   * ```
   */
  private static isValidIp(ip: string): boolean {
    if (!ip || typeof ip !== 'string') {
      return false;
    }

    // IPv4 正则: 0-255.0-255.0-255.0-255
    const ipv4Regex =
      /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;

    // IPv6 正则（简化版，支持常见格式）
    const ipv6Regex =
      /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^::(?:[0-9a-fA-F]{1,4}:){0,6}[0-9a-fA-F]{1,4}$|^[0-9a-fA-F]{1,4}::(?:[0-9a-fA-F]{1,4}:){0,5}[0-9a-fA-F]{1,4}$/;

    return ipv4Regex.test(ip) || ipv6Regex.test(ip);
  }

  /**
   * 输出标准格式化后的时间
   * @param input
   * @returns
   */
  static time(input?: dayjs.ConfigType): string {
    input = typeof input === 'number' ? input * 1000 : input;
    const formatStr = 'YYYY-MM-DD HH:mm:ss';
    return input ? dayjs(input).format(formatStr) : dayjs().format(formatStr);
  }

  /**
   * 获取当前时间戳
   *
   * @param microsecond 是否返回微秒级时间戳（13位），默认 false（返回秒级10位）
   * @returns 时间戳（秒或微秒）
   *
   * @example
   * ```typescript
   * Utils.now()           // 1729612800 (秒，10位)
   * Utils.now(false)      // 1729612800 (秒，10位)
   * Utils.now(true)       // 1729612800000 (毫秒，13位)
   * ```
   */
  static now(microsecond = false): number {
    return microsecond ? Date.now() : Math.floor(Date.now() / 1000);
  }

  /**
   * 生成数据库分页参数
   *
   * 根据页码和每页数量计算数据库查询所需的 offset 和 limit 参数。
   *
   * @param page 页码（从 1 开始），默认 1
   * @param pageSize 每页数量，默认 10
   * @returns 分页参数对象 { offset, limit, page, pageSize }
   *
   * 参数处理规则：
   * - page 小于 1 时，自动调整为 1
   * - pageSize 小于 1 时，自动调整为 1
   * - pageSize 大于 1000 时，自动限制为 1000（防止性能问题）
   * - 非数字参数会使用默认值
   *
   * @example
   * ```typescript
   * // 基础用法
   * Utils.page(1, 10)
   * // { offset: 0, limit: 10, page: 1, pageSize: 10 }
   *
   * Utils.page(2, 20)
   * // { offset: 20, limit: 20, page: 2, pageSize: 20 }
   *
   * Utils.page(3, 15)
   * // { offset: 30, limit: 15, page: 3, pageSize: 15 }
   *
   * // 使用默认值
   * Utils.page()
   * // { offset: 0, limit: 10, page: 1, pageSize: 10 }
   *
   * // 自动修正无效参数
   * Utils.page(0, 10)     // page < 1 → page = 1
   * Utils.page(-5, 10)    // page < 1 → page = 1
   * Utils.page(1, 0)      // pageSize < 1 → pageSize = 1
   * Utils.page(1, 2000)   // pageSize > 1000 → pageSize = 1000
   *
   * // 在数据库查询中使用
   * const { offset, limit } = Utils.page(page, pageSize);
   * const users = await db.query(
   *   'SELECT * FROM users LIMIT ? OFFSET ?',
   *   [limit, offset]
   * );
   *
   * // 或使用 Table API
   * const params = Utils.page(page, pageSize);
   * const users = await db.table('users').gets({
   *   limit: params.limit,
   *   offset: params.offset
   * });
   * ```
   */
  static page(page: number = 1, pageSize: number = 10): DbPageParams {
    // 参数类型校验和默认值
    const safePage = typeof page === 'number' && !isNaN(page) ? page : 1;
    const safePageSize =
      typeof pageSize === 'number' && !isNaN(pageSize) ? pageSize : 10;

    // 参数范围校验
    const finalPage = Math.max(1, Math.floor(safePage));
    const finalPageSize = Math.max(1, Math.min(1000, Math.floor(safePageSize)));

    // 计算 offset
    const offset = (finalPage - 1) * finalPageSize;

    return {
      offset,
      limit: finalPageSize,
      page: finalPage,
      pageSize: finalPageSize,
    };
  }

  /**
   * 判断路径是否为文件
   *
   * @param path 文件路径
   * @returns 是否为文件
   *
   * @example
   * ```typescript
   * Utils.isFile('/path/to/file.txt')    // true
   * Utils.isFile('/path/to/directory')   // false
   * Utils.isFile('/not/exists')          // false
   * ```
   */
  static isFile(path: string): boolean {
    if (!path || typeof path !== 'string') {
      return false;
    }

    try {
      const stat = fs.statSync(path);
      return stat.isFile();
    } catch {
      return false;
    }
  }

  /**
   * 判断路径是否为目录
   *
   * @param path 目录路径
   * @returns 是否为目录
   *
   * @example
   * ```typescript
   * Utils.isDir('/path/to/directory')  // true
   * Utils.isDir('/path/to/file.txt')   // false
   * Utils.isDir('/not/exists')         // false
   * ```
   */
  static isDir(path: string): boolean {
    if (!path || typeof path !== 'string') {
      return false;
    }

    try {
      const stat = fs.statSync(path);
      return stat.isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * 判断路径是否存在
   *
   * @param path 文件或目录路径
   * @returns 是否存在
   *
   * @example
   * ```typescript
   * Utils.exists('/path/to/file.txt')      // true
   * Utils.exists('/path/to/directory')     // true
   * Utils.exists('/not/exists')            // false
   * ```
   */
  static exists(path: string): boolean {
    if (!path || typeof path !== 'string') {
      return false;
    }

    try {
      fs.statSync(path);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 将对象数组转换为 Map 对象
   *
   * 将数组转换为以指定字段为 key 的 Map，便于快速查找。
   *
   * @param data 对象数组
   * @param key 作为 Map key 的字段名，默认 'id'
   * @returns Map 对象 { [key]: object }
   *
   * @example
   * ```typescript
   * const users = [
   *   { id: 1, name: 'Alice' },
   *   { id: 2, name: 'Bob' },
   *   { id: 3, name: 'Charlie' }
   * ];
   *
   * const userMap = Utils.toMap(users);
   * // { '1': { id: 1, name: 'Alice' }, '2': { id: 2, name: 'Bob' }, ... }
   *
   * const userMapByName = Utils.toMap(users, 'name');
   * // { 'Alice': { id: 1, name: 'Alice' }, 'Bob': { id: 2, name: 'Bob' }, ... }
   *
   * // 快速查找
   * const user = userMap['2']; // { id: 2, name: 'Bob' }
   * ```
   */
  static toMap<T extends Record<string, any>>(
    data: T[],
    key: string = 'id',
  ): Record<string, T> {
    if (!Array.isArray(data)) {
      return {};
    }

    const map: Record<string, T> = {};

    for (const item of data) {
      if (item && typeof item === 'object' && key in item) {
        const keyValue = item[key];
        // 确保 key 值可以转为字符串
        if (keyValue !== null && keyValue !== undefined) {
          map[String(keyValue)] = item;
        }
      }
    }

    return map;
  }

  /**
   * 信息脱敏处理
   *
   * 将指定范围的字符替换为指定字符，常用于手机号、身份证等敏感信息的脱敏。
   *
   * @param text 需要脱敏的文本（字符串或数字）
   * @param start 开始脱敏的索引（包含），默认 3
   * @param end 结束脱敏的索引（包含），默认 6
   * @param mask 脱敏替换字符，默认 '*'
   * @returns 脱敏后的文本
   *
   * @example
   * ```typescript
   * // 手机号脱敏（默认）
   * Utils.mask('13812345678')           // "138****5678"
   * Utils.mask(13812345678)             // "138****5678"
   *
   * // 自定义范围
   * Utils.mask('13812345678', 3, 6)     // "138****5678"
   * Utils.mask('13812345678', 0, 2)     // "***12345678"
   *
   * // 自定义替换字符
   * Utils.mask('13812345678', 3, 6, 'X') // "138XXXX5678"
   *
   * // 身份证号脱敏
   * Utils.mask('110101199001011234', 6, 13) // "110101********1234"
   *
   * // 邮箱脱敏
   * const email = 'example@email.com';
   * const [local, domain] = email.split('@');
   * const masked = Utils.mask(local, 2, local.length - 1) + '@' + domain;
   * // "ex*****@email.com"
   * ```
   */
  static mask(
    text: string | number,
    start: number = 3,
    end: number = 6,
    mask: string = '*',
  ): string {
    if (text === null || text === undefined) {
      return '';
    }

    const str = String(text);

    if (str.length === 0) {
      return '';
    }

    // 参数校验和调整
    const safeStart = Math.max(0, Math.min(start, str.length - 1));
    const safeEnd = Math.max(safeStart, Math.min(end, str.length - 1));
    const safeMask = mask || '*';

    let output = '';
    for (let i = 0; i < str.length; i++) {
      if (i >= safeStart && i <= safeEnd) {
        output += safeMask;
      } else {
        output += str[i];
      }
    }

    return output;
  }

  /**
   * 移除路径两边的反斜杠
   * @param pathname
   * @returns
   */
  static normalize(pathname: string) {
    return pathname.replace(/^\/*|\/*$/g, '');
  }
}
