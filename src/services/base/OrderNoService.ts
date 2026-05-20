import { Injectable } from '@nestjs/common';
import { Utils } from 'src/common/Utils';
import { RedisService } from './RedisService';

/**
 * 分布式订单号生成服务
 *
 * 订单号格式：前缀（可选）+ 随机数（4位）+ 时间（12位 YYMMDDHHmmss）+ 序列号（≥4位，经混淆）
 *
 * 序列号由 Redis INCR 保证唯一，每天从 0 开始自增。
 * 当序列号超出当前位数上限时，自动扩展 2 位（4→6→8→10...）。
 */
@Injectable()
export class OrderNoService {
  /** 数字替换表，构成 0-9 的无不动点双射（derangement） */
  private readonly digitMap = [3, 7, 1, 9, 0, 8, 5, 2, 6, 4];

  /** 偏移种子（全部非零），按位循环取值 */
  private readonly offsetSeed = [1, 3, 7, 2, 5, 9, 4, 6, 8];

  /** 按长度缓存位置置换和偏移数组 */
  private readonly posCache = new Map<number, number[]>();
  private readonly offsetCache = new Map<number, number[]>();

  /** Lua 脚本：INCR + 条件 EXPIRE 原子执行 */
  private readonly incrScript = `
    local val = redis.call('INCR', KEYS[1])
    if val == 1 then
      redis.call('EXPIRE', KEYS[1], ARGV[1])
    end
    return val
  `;

  constructor(private readonly redis: RedisService) {}

  /**
   * 生成唯一订单号
   * @param prefix - 订单号前缀，默认为空字符串（不添加前缀）
   */
  async generate(prefix: string = ''): Promise<string> {
    const now = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    const random = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
    const time =
      p(now.getFullYear() % 100) +
      p(now.getMonth() + 1) +
      p(now.getDate()) +
      p(now.getHours()) +
      p(now.getMinutes()) +
      p(now.getSeconds());
    const dateKey = time.slice(0, 6); // YYMMDD

    const seq = await this.nextSequence(dateKey, prefix);
    const seqStr = this.obfuscate(seq);

    return prefix + random + time + seqStr;
  }

  /**
   * 通过 Redis Lua 脚本原子地执行 INCR + 条件 EXPIRE，获取当天下一个序列号（0-based）
   */
  private async nextSequence(dateKey: string, prefix: string): Promise<number> {
    // 不同前缀使用独立的计数器，避免不同业务类型相互消耗序列号
    const namespace = prefix || 'default';
    const redisKey = `order_seq:${namespace}:${dateKey}`;

    const client = await this.redis.client();
    const val = (await client.eval(this.incrScript, {
      keys: [redisKey],
      arguments: ['172800'], // 48 小时 TTL
    })) as number;

    if (typeof val !== 'number' || !Number.isFinite(val) || val < 1) {
      Utils.error(15000, '订单序列号生成失败');
    }

    return val - 1; // 从 0 开始
  }

  /**
   * 生成位置置换数组（交错排列，保证无不动点）
   * n=4: [2,0,3,1], n=6: [3,0,4,1,5,2], n=8: [4,0,5,1,6,2,7,3] ...
   */
  private getPosMap(len: number): number[] {
    let cached = this.posCache.get(len);
    if (!cached) {
      const half = len / 2;
      cached = Array.from({ length: len }, (_, i) =>
        i % 2 === 0 ? half + i / 2 : (i - 1) / 2,
      );
      this.posCache.set(len, cached);
    }
    return cached;
  }

  /** 生成偏移数组（从 offsetSeed 循环取值，全部非零） */
  private getOffsets(len: number): number[] {
    let cached = this.offsetCache.get(len);
    if (!cached) {
      cached = Array.from(
        { length: len },
        (_, i) => this.offsetSeed[i % this.offsetSeed.length],
      );
      this.offsetCache.set(len, cached);
    }
    return cached;
  }

  /**
   * 将序列号转换为混淆后的字符串
   * 最短 4 位，每 2 位递增：4 → 6 → 8 → 10 ...
   * 单次循环完成替换+置换+偏移，避免中间数组分配
   */
  private obfuscate(seq: number): string {
    // 从数字长度动态确定偶数位数（最少 4 位）
    const seqStr = String(seq);
    let padLen = Math.max(4, seqStr.length);
    if (padLen % 2 !== 0) padLen++;

    const padded = seqStr.padStart(padLen, '0');
    const posMap = this.getPosMap(padLen);
    const offsets = this.getOffsets(padLen);
    const result = new Array<string>(padLen);

    // 单次循环：对每个目标位 i，从 posMap[i] 取源位，经替换+偏移
    for (let i = 0; i < padLen; i++) {
      const srcDigit = Number(padded[posMap[i]]);
      result[i] = String((this.digitMap[srcDigit] + offsets[i]) % 10);
    }

    return result.join('');
  }
}
