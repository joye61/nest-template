import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { createCaptcha, type CaptchaOptions } from './captcha/index';
import { RedisService } from './RedisService';
import { Utils } from 'src/common/Utils';
import { Errors } from 'src/errors';

/** 验证码 Redis key 前缀 */
const CAPTCHA_KEY_PREFIX = 'captcha:';

/** 验证码默认有效期（秒） */
const CAPTCHA_TTL = 300;

/**
 * 验证码生成结果
 */
export interface CaptchaCreateResult {
  /** 验证码令牌，用于后续校验 */
  token: string;
  /** 图片原始二进制数据 */
  buffer: Uint8Array;
  /** 图片 MIME 类型 */
  mime: string;
  /** 图片宽度（像素） */
  width: number;
  /** 图片高度（像素） */
  height: number;
  /** 有效期（秒） */
  ttl: number;
}

/**
 * 验证码服务
 *
 * 提供基于 go-captcha（wasm）的验证码生成与校验能力：
 * - `create()`  生成验证码图片，将答案存入 Redis，返回令牌 + base64 图片
 * - `verify()`  根据令牌从 Redis 取出答案进行比对，比对后立即删除（一次性）
 *
 * 使用示例：
 * ```typescript
 * // 生成
 * const { token, buffer, mime, ttl } = await this.captcha.create();
 *
 * // 校验
 * const ok = await this.captcha.verify(token, userInput);
 * if (!ok) Utils.error(Errors.CaptchaError[0], Errors.CaptchaError[1]);
 * ```
 */
@Injectable()
export class CaptchaService {
  constructor(private readonly redis: RedisService) {}

  /**
   * 生成验证码
   *
   * @param options  可选的验证码生成参数（宽高、难度、长度等），参见 CaptchaOptions
   * @param ttl      验证码有效期（秒），默认 300 秒
   * @returns        验证码令牌 + base64 图片等信息
   */
  async create(options: CaptchaOptions = {}, ttl: number = CAPTCHA_TTL): Promise<CaptchaCreateResult> {
    const result = await createCaptcha(options);

    // 生成随机令牌
    const token = randomBytes(16).toString('hex');

    // 将答案（转小写统一比对）写入 Redis，并设置过期时间
    const client = await this.redis.client();
    await client.set(`${CAPTCHA_KEY_PREFIX}${token}`, result.text.toLowerCase(), { EX: ttl });

    return {
      token,
      buffer: result.buffer,
      mime: result.mime,
      width: result.width,
      height: result.height,
      ttl,
    };
  }

  /**
   * 校验验证码
   *
   * 比对成功或失败后均会立即删除 Redis 中的记录（一次性令牌）。
   *
   * @param token   `create()` 返回的验证码令牌
   * @param answer  用户提交的答案（不区分大小写）
   * @returns       校验通过返回 `true`，令牌不存在/已过期/答案错误均返回 `false`
   */
  async verify(token: string, answer: string): Promise<boolean> {
    if (!token || !answer) return false;

    const client = await this.redis.client();
    const key = `${CAPTCHA_KEY_PREFIX}${token}`;
    const stored = await client.get(key);

    // 无论是否匹配，删除令牌（防止暴力枚举）
    if (stored !== null) {
      await client.del(key);
    }

    if (stored === null) return false;

    return stored === answer.toLowerCase();
  }

  /**
   * 校验验证码，失败时直接抛出业务异常
   *
   * @param token   验证码令牌
   * @param answer  用户提交的答案
   */
  async verifyOrThrow(token: string, answer: string): Promise<void> {
    const ok = await this.verify(token, answer);
    if (!ok) {
      Utils.error(Errors.CaptchaError[0], Errors.CaptchaError[1]);
    }
  }
}
