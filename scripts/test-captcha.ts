/**
 * 验证码生成测试脚本
 *
 * 运行方式（在项目根目录执行）：
 *   npx ts-node scripts/test-captcha.ts
 *
 * 成功后在 scripts/output/ 目录下生成多张验证码图片。
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createCaptcha } from '../src/services/base/captcha/index';

const OUTPUT_DIR = resolve(__dirname, 'output');

/** 测试用例 */
const cases = [
  { label: 'default',  options: {} },
  { label: 'easy',     options: { mode: 'easy'   as const, length: 4, format: 'png'  as const } },
  { label: 'normal',   options: { mode: 'normal' as const, length: 4, format: 'png'  as const } },
  { label: 'hard',     options: { mode: 'hard'   as const, length: 6, format: 'jpeg' as const } },
  { label: 'wide',     options: { width: 320, height: 100, length: 5 } },
];

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });

  console.log(`输出目录：${OUTPUT_DIR}\n`);

  for (const { label, options } of cases) {
    try {
      const result = await createCaptcha(options);
      const filename = `captcha-${label}.${result.mime.split('/')[1]}`;
      const filepath = resolve(OUTPUT_DIR, filename);
      await writeFile(filepath, Buffer.from(result.buffer));

      console.log(`[${label}]`);
      console.log(`  答案  : ${result.text}`);
      console.log(`  尺寸  : ${result.width} × ${result.height}`);
      console.log(`  格式  : ${result.mime}`);
      console.log(`  大小  : ${result.buffer.length} 字节`);
      console.log(`  文件  : ${filepath}`);
      console.log();
    } catch (err) {
      console.error(`[${label}] 生成失败:`, err);
      process.exitCode = 1;
    }
  }

  console.log('完成。');
}

main();
