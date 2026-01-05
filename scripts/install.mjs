import { family } from 'detect-libc';
import path from 'path';
import { createWriteStream, existsSync } from 'fs';
import { mkdir, rm } from 'fs/promises';
import { createGunzip } from 'zlib';
import { pipeline } from 'stream/promises';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const libc = await family();
const triplets = [process.platform, process.arch, libc];
const triplet = triplets.filter((t) => t).join('-');

const baseUrl =
  'https://registry.npmmirror.com/-/binary/skia-canvas/v3.0.8';
const url = `${baseUrl}/${triplet}.gz`;

const dest = path.resolve(__dirname, "../assets/skia.node");

// 检查目标文件是否已经存在
if (existsSync(dest)) {
  console.log(`File already exists at ${dest}, skipping download.`);
  process.exit(0);
}

console.log(`Downloading prebuilt binary from ${url} to ${dest}...`);

try {
  // 如果目标文件存在,先删除
  await rm(dest, { force: true });
  
  // 确保目标目录存在
  await mkdir(path.dirname(dest), { recursive: true });
  
  // 使用 fetch 下载文件
  const response = await fetch(url);
  
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  
  // 创建哈希计算器、解压流和文件写入流
  const gunzip = createGunzip();
  const writeStream = createWriteStream(dest);
  
  // 使用 pipeline 将响应流 -> gunzip解压 -> 文件写入流 串联起来
  await pipeline(
    response.body,
    gunzip,
    writeStream
  );
  
  console.log(`Successfully downloaded and extracted to ${dest}`);
} catch (error) {
  console.error('Download failed:', error.message);
  // 如果下载失败,清理可能不完整的文件
  await rm(dest, { force: true });
  process.exit(1);
}
